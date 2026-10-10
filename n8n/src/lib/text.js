// ─── Text: tokenising, BM25 retrieval, chunking, citations ──────────────────

const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also however thus using based use used via within without among across may might must shall study studies paper results result show shows shown method methods approach approaches new et al').split(' '));

function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

function countMap(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function buildBM25(docs) {
  const toks = docs.map((d) => tokenize(d.text));
  const tfs = toks.map(countMap);
  const df = new Map();
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length || 1;
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / N || 1;
  return { docs, tfs, lens: toks.map((t) => t.length), df, N, avgdl };
}

function bm25Search(index, query, k = 10, filter) {
  const q = uniq(tokenize(query));
  const k1 = 1.4;
  const b = 0.72;
  const scored = [];
  for (let i = 0; i < index.docs.length; i++) {
    if (filter && !filter(index.docs[i])) continue;
    const tf = index.tfs[i];
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * index.lens[i]) / index.avgdl)));
    }
    if (s > 0) scored.push({ doc: index.docs[i], score: s, i });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Hybrid retrieval over chunks: BM25 always, plus dense vectors when the
 * chunks carry them. Fused with reciprocal-rank fusion.
 */
async function retrieve(chunks, query, k = 8, filter) {
  const index = buildBM25(chunks);
  const lexical = bm25Search(index, query, Math.max(k * 3, 30), filter);
  const hasVectors = chunks.length && Array.isArray(chunks[0].v);
  if (!hasVectors) return lexical.slice(0, k).map((r) => r.doc);
  let qv = null;
  try { qv = (await embedTexts([query]) || [])[0]; } catch (e) { qv = null; }
  if (!qv) return lexical.slice(0, k).map((r) => r.doc);
  const dense = chunks
    .map((c, i) => ({ doc: c, i, score: filter && !filter(c) ? -1 : cosine(qv, c.v) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.max(k * 3, 30));
  const fused = new Map();
  lexical.forEach((r, rank) => fused.set(r.i, (fused.get(r.i) || 0) + 1 / (60 + rank)));
  dense.forEach((r, rank) => fused.set(r.i, (fused.get(r.i) || 0) + 1 / (60 + rank)));
  return Array.from(fused.entries()).sort((x, y) => y[1] - x[1]).slice(0, k).map(([i]) => chunks[i]);
}

function cleanPdfText(text) {
  let t = String(text || '')
    .replace(/\r/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  const m = t.match(/\n\s*(references|bibliography|literature cited)\s*\n/gi);
  if (m) {
    const idx = t.toLowerCase().lastIndexOf(m[m.length - 1].toLowerCase());
    if (idx > t.length * 0.5) t = t.slice(0, idx);
  }
  return t.trim();
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function chunkText(text, size = 1100, overlap = 160, maxChunks = 80) {
  const sentences = splitSentences(text);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > size && cur) {
      chunks.push(cur.trim());
      if (chunks.length >= maxChunks) break;
      cur = cur.slice(-overlap) + ' ' + s;
    } else {
      cur += ' ' + s;
    }
  }
  if (cur.trim() && chunks.length < maxChunks) chunks.push(cur.trim());
  return chunks;
}

/** "[3]", "[3, 5]", "[3–5]", "[3][7]" → [3, 5, ...] */
function parseCitations(text) {
  const out = [];
  const re = /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g;
  let m;
  while ((m = re.exec(text))) {
    for (const part of m[1].split(',')) {
      const range = part.split(/[-–]/).map((x) => parseInt(x.trim(), 10));
      if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < 20) {
        for (let n = range[0]; n <= range[1]; n++) out.push(n);
      } else if (!isNaN(range[0])) out.push(range[0]);
    }
  }
  return uniq(out);
}

function sentenceKey(s) {
  return String(s || '').replace(/\[[\d,\s–-]+\]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
}

function normTitle(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}
