// Chunk full texts (or abstracts when no PDF could be read) into a retrieval
// index: BM25 always, dense embeddings when an embeddings key is configured.
const queued = $('Pick papers to read').all();
const state = queued[0].json.state;
const extracted = $input.all();

await stage(state, 'index', 'Reading full texts and building the index', async () => {
  const byKey = new Map(state.papers.map((p) => [p.key, p]));
  let read = 0;
  for (let i = 0; i < queued.length; i++) {
    const meta = queued[i].json;
    const out = (extracted[i] && extracted[i].json) || {};
    if (!meta.key) continue;
    const p = byKey.get(meta.key);
    const text = Array.isArray(out.text) ? out.text.join('\n\n') : typeof out.text === 'string' ? out.text : '';
    if (p && text.length > 2500 && !out.error) {
      p.fullText = clampText(cleanPdfText(text), 140000);
      p.pages = out.numpages || null;
      p.hasFullText = true;
      read++;
      await log(state, `Read the full text of [${p.n}] ${clampText(p.title, 80)}${p.pages ? ' (' + p.pages + ' pages)' : ''}`);
    } else if (p) {
      const why = out.error ? String(out.error.message || out.error).slice(0, 120) : text ? 'too little text extracted' : 'no text extracted';
      await log(state, `Could not read the PDF for [${p.n}] (${why}); using its abstract`, { error: true });
    }
  }

  const chunks = [];
  for (const key of state.references) {
    const p = byKey.get(key);
    const head = `${p.title}. ${p.tldr ? p.tldr + ' ' : ''}`;
    if (p.fullText) {
      const parts = chunkText(p.fullText, 1100, 160, 70);
      parts.forEach((t, j) => chunks.push({ id: p.n + ':' + j, n: p.n, text: t }));
      chunks.push({ id: p.n + ':abs', n: p.n, text: head + (p.abstract || '') });
    } else {
      chunks.push({ id: p.n + ':abs', n: p.n, text: head + (p.abstract || 'No abstract available.') });
    }
    delete p.fullText; // keep the state small; chunks carry the text from here on
  }

  let dense = false;
  try {
    const vectors = await embedTexts(chunks.map((c) => c.text));
    if (vectors) { vectors.forEach((v, i) => { chunks[i].v = v; }); dense = true; }
  } catch (e) {
    await log(state, 'Embeddings unavailable; using keyword retrieval only', { error: true });
  }

  state.chunks = chunks;
  state.fullTextCount = read;
  await emit(state, 'indexed', { fullText: read, chunks: chunks.length, dense });
});

return [{ json: state }];
