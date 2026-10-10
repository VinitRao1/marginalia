#!/usr/bin/env node
// Offline stand-ins for every external service Marginalia talks to:
// OpenAlex, arXiv, Semantic Scholar, Europe PMC, open-access PDFs,
// an OpenAI-compatible LLM, and the ElevenLabs API. Used by scripts/test-e2e.mjs.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PORT = parseInt(process.env.MOCK_PORT || '4010', 10);
let BASE = `http://localhost:${PORT}`;
export const calls = [];

const h = (s) => parseInt(createHash('md5').update(String(s)).digest('hex').slice(0, 8), 16);
const pick = (arr, seed) => arr[h(seed) % arr.length];
const WORDS = ['evidence', 'model', 'effect', 'performance', 'trial', 'analysis', 'benchmark', 'cohort', 'mechanism', 'outcome', 'scaling', 'efficiency', 'accuracy', 'memory', 'context', 'attention', 'sparse', 'linear', 'kernel', 'approximation'];
const FIRST = ['Ana', 'Wei', 'Priya', 'Tomás', 'Lena', 'Kofi', 'Mei', 'Arjun', 'Sofia', 'Jonas'];
const LAST = ['Okafor', 'Zhang', 'Raman', 'Silva', 'Novak', 'Mensah', 'Tanaka', 'Iyer', 'Rossi', 'Berg'];
const VENUES = ['NeurIPS', 'ICLR', 'Nature Communications', 'JAMA', 'ACL', 'The Lancet', 'PLOS ONE', 'ICML'];

function fakePaper(query, source, i) {
  // The first three results of any query are shared across sources (same DOI) to exercise de-duplication.
  const shared = i < 3;
  const seed = shared ? `${query}|shared|${i}` : `${query}|${source}|${i}`;
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const t1 = terms[h(seed) % Math.max(1, terms.length)] || 'method';
  const t2 = pick(WORDS, seed + 'w');
  const id = h(seed).toString(36);
  const title = `${pick(['Revisiting', 'On the', 'Measuring', 'A large-scale study of', 'Rethinking', 'Limits of'], seed)} ${t1} and ${t2} in ${query.split(' ').slice(0, 3).join(' ')} (${id})`;
  const authors = [0, 1, 2].map((k) => `${pick(FIRST, seed + k)} ${pick(LAST, seed + 'l' + k)}`);
  const abstract = `We study ${query}. Using a ${pick(['randomised', 'controlled', 'longitudinal', 'benchmark'], seed)} design across ${100 + (h(seed) % 900)} samples, we find that ${t1} improves ${t2} by ${5 + (h(seed + 'p') % 30)}% relative to baseline, although the effect weakens at larger scales. Limitations include ${pick(['small samples', 'a single dataset', 'short follow-up', 'compute constraints'], seed)}.`;
  return { id, title, authors, abstract, year: 2015 + (h(seed + 'y') % 11), venue: pick(VENUES, seed + 'v'), doi: `10.5555/mock.${id}`, cited: h(seed + 'c') % 4000 };
}

function invertedIndex(text) {
  const inv = {};
  text.split(/\s+/).forEach((w, i) => { (inv[w] ||= []).push(i); });
  return inv;
}

function makePdf(id) {
  const sentences = [];
  for (let i = 0; i < 60; i++) sentences.push(`Section ${i} reports that the proposed method improves accuracy while reducing memory use across several benchmark datasets and longer context lengths in controlled experiments number ${i}.`);
  const lines = sentences.map((s) => `(${s}) Tj T*`).join('\n');
  const content = `BT /F1 10 Tf 12 TL 72 760 Td\n${lines}\nET`;
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  objs.forEach((o, i) => {
    if (o === null) {
      out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    } else out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]);
  });
  return Buffer.concat([out, Buffer.from(`trailer\n<< /Root 1 0 R >>\n%%EOF ${id}\n`, 'latin1')]);
}

// ─── LLM mock: returns well-formed answers for each prompt the pipeline uses ─
function llmAnswer(system, prompt) {
  const all = system + '\n' + prompt;
  const nums = (re) => Array.from(prompt.matchAll(re)).map((m) => parseInt(m[1], 10));
  if (/Design the search/.test(prompt)) {
    const n = parseInt((prompt.match(/Exactly (\d+) sub-questions/) || [])[1] || '3', 10);
    const m = parseInt((prompt.match(/exactly (\d+) queries/) || [])[1] || '2', 10);
    const q = (prompt.match(/"""([\s\S]*?)"""/) || [])[1] || 'topic';
    const base = q.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 4).join(' ');
    return JSON.stringify({
      title: 'Efficient attention for long context',
      domain: 'computing',
      scope: 'Peer-reviewed and preprint evidence on efficient attention mechanisms.',
      keyTerms: ['sparse attention', 'linear attention', 'long context', 'memory efficiency', 'kernel approximation', 'state space models'],
      subQuestions: Array.from({ length: n }, (_, i) => ({
        id: 'q' + (i + 1),
        question: ['Does efficient attention match quality?', 'Why do approximations lose accuracy?', 'How strong is the benchmark evidence?', 'Where do results conflict?', 'What alternatives exist?'][i % 5],
        why: 'Covers a distinct part of the question',
        queries: Array.from({ length: m }, (_, j) => `${base} ${['quality', 'mechanism', 'benchmark', 'conflict', 'alternative'][i % 5]} ${['evaluation', 'scaling', 'analysis'][j % 3]}`),
      })),
    });
  }
  if (/Rate every paper/.test(prompt)) {
    const idx = nums(/^\[(\d+)\]/gm);
    return JSON.stringify({ ratings: idx.map((i) => ({ i, score: 4 + (h(prompt.slice(0, 200) + i) % 7), subq: ['q' + (1 + (i % 3))], kind: pick(['empirical', 'review', 'benchmark', 'theory'], i), reason: 'Directly measures the effect in question' })) });
  }
  if (/follow-up queries/.test(prompt)) {
    return JSON.stringify({ queries: [{ subq: 'q2', q: 'kernel approximation error long sequences' }, { subq: 'q3', q: 'long range arena benchmark comparison' }], note: 'Mechanistic explanations are thin.' });
  }
  if (/evidence cards/.test(system)) {
    const idx = nums(/^\[(\d+)\] /gm);
    return JSON.stringify({ cards: idx.map((n) => ({ n, tldr: `Paper ${n} finds a modest quality cost for large memory savings.`, studyType: pick(['benchmark evaluation', 'method paper', 'survey', 'theoretical analysis'], n), method: 'Compares attention variants on shared tasks', data: 'Long-sequence benchmarks', keyResult: `${10 + n}% lower memory with ${n % 3}.${n % 10} point accuracy change`, limitations: 'Single model scale', stance: pick(['supports', 'challenges', 'mixed', 'context'], n) })) });
  }
  if (/Sub-question:/.test(prompt) && /findings/.test(prompt)) {
    const refs = Array.from(new Set(nums(/^\[(\d+)\]/gm)));
    const r = (k) => refs[k % refs.length];
    return JSON.stringify({
      summary: `The passages suggest efficient variants trade a small amount of quality for large efficiency gains [${r(0)}].`,
      consensus: pick(['strong', 'moderate', 'mixed'], prompt.length),
      findings: [
        { claim: 'Approximate attention reduces memory use substantially on long inputs.', support: [r(0), r(1)], contradict: [], evidence: 'the proposed method improves accuracy while reducing memory use', strength: 'strong' },
        { claim: 'Quality losses grow on tasks needing precise long-range retrieval.', support: [r(2)], contradict: [r(3)], evidence: 'the effect weakens at larger scales', strength: 'moderate' },
        { claim: 'Benchmarks disagree on which variant is best overall.', support: [r(1)], contradict: [r(4)], evidence: 'across several benchmark datasets', strength: 'weak' },
      ],
    });
  }
  if (/Write the review in Markdown/.test(prompt)) {
    const max = parseInt((prompt.match(/Use only sources 1 to (\d+)/) || [])[1] || '5', 10);
    const c = (k) => 1 + (k % max);
    return `## Bottom line
Efficient attention reliably cuts memory and compute on long inputs, but quality holds up only for some tasks [${c(0)}, ${c(1)}]. Confidence is moderate because most evidence comes from benchmarks rather than deployed systems [${c(2)}].

## Background
Standard attention scales quadratically with sequence length, which motivated sparse, low-rank and kernel approximations [${c(3)}]. Exact but IO-aware implementations later changed the picture [${c(4)}].

## What the evidence says
### Memory savings are large and consistent
Several studies report memory reductions of more than half on long sequences [${c(0)}][${c(5)}]. These gains appear across model sizes [${c(6)}].

### Accuracy depends on the task
On retrieval-heavy tasks, approximate methods lose accuracy compared with exact attention [${c(2)}]. On classification tasks the gap is small [${c(7)}].

## Where studies disagree
Benchmarks rank methods differently, and some report no quality cost at all [${c(8)}], while others find consistent degradation [${c(1)}]. This study proves that sparse attention is always worse [${c(3)}].

## How good is the evidence
Most studies use a single model scale and few seeds [${c(4)}]. Independent replications are rare [${c(9)}].

## Open questions
- Do the savings hold at frontier scale? [${c(0)}]
- Which tasks are most sensitive to approximation? [${c(2)}]
- Invented reference that should be stripped [${max + 5}].

## Conclusion
Use exact, IO-efficient attention by default and reach for approximations when memory is the binding constraint [${c(4)}, ${c(5)}].`;
  }
  if (/strict fact-checker/.test(system)) {
    const idx = nums(/^Claim (\d+):/gm);
    return JSON.stringify({ results: idx.map((i) => ({ i, verdict: /always worse/.test(prompt.split(`Claim ${i}:`)[1].split('\n')[0]) ? 'unsupported' : i % 4 === 3 ? 'partial' : 'supported', note: 'Passages report the same direction and magnitude.', bestRef: 1 })) });
  }
  if (/two hosts/.test(prompt) || /audio explainers/.test(system)) {
    return JSON.stringify({ title: 'Is cheaper attention good enough?', lines: Array.from({ length: 6 }, (_, i) => ({ speaker: i % 2 ? 'theo' : 'mira', text: i % 2 ? `Here's the thing: the savings are real, but the accuracy story depends on the task. Point ${i}.` : `So should everyone switch to efficient attention? Question ${i}.` })) });
  }
  if (/helping someone debate/.test(system)) {
    const n = nums(/^\[(\d+)\]/gm)[0] || 1;
    return JSON.stringify({ verdict: 'partial', confidence: 0.7, explanation: 'Mostly. The paper reports the memory saving, but only at one model size.', evidence: [{ n, quote: 'improves accuracy while reducing memory use' }] });
  }
  if (/triage newly found papers/.test(system)) {
    const idx = nums(/^\[(\d+)\]/gm).slice(0, 4);
    return JSON.stringify({ picks: idx.map((i) => ({ i, relevance: 8 - i, stance: i % 2 ? 'challenges' : 'supports', why: 'A newer benchmark that tests the same claim' })) });
  }
  return JSON.stringify({ ok: true });
}

// ─── HTTP server ────────────────────────────────────────────────────────────
async function body(req) {
  const c = [];
  for await (const x of req) c.push(x);
  return c.length ? Buffer.concat(c).toString('utf8') : '';
}
const json = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function startMock(port = PORT) {
  BASE = `http://localhost:${port}`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    const raw = await body(req);
    calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams) });
    try {
      if (p === '/openalex/works') {
        const n = parseInt(url.searchParams.get('per-page') || '10', 10);
        const q = url.searchParams.get('search') || url.searchParams.get('filter') || 'seed';
        const results = Array.from({ length: n }, (_, i) => {
          const f = fakePaper(q, 'openalex', i);
          return {
            id: 'https://openalex.org/W' + h(f.id), doi: 'https://doi.org/' + f.doi, display_name: f.title, publication_year: f.year,
            authorships: f.authors.map((a) => ({ author: { display_name: a } })), primary_location: { source: { display_name: f.venue }, landing_page_url: 'https://example.org/' + f.id },
            best_oa_location: i % 2 === 0 ? { pdf_url: `${BASE}/pdf/${f.id}.pdf` } : null, cited_by_count: f.cited,
            abstract_inverted_index: invertedIndex(f.abstract), referenced_works: [1, 2, 3].map((k) => 'https://openalex.org/W' + h(fakePaper(q, 'openalex', (i + k) % n).id)), type: 'article', ids: {},
          };
        });
        return json(res, { results });
      }
      if (p === '/arxiv/api/query') {
        const n = parseInt(url.searchParams.get('max_results') || '5', 10);
        const q = (url.searchParams.get('search_query') || '').replace(/all:/g, '').replace(/ AND /g, ' ');
        const entries = Array.from({ length: n }, (_, i) => {
          const f = fakePaper(q, 'arxiv', i);
          const ax = `24${String(10 + (h(f.id) % 89)).padStart(2, '0')}.${String(10000 + (h(f.id + 'x') % 89999))}`;
          return `<entry><id>http://arxiv.org/abs/${ax}v1</id><published>${f.year}-03-01T00:00:00Z</published><title>${f.title}</title><summary>${f.abstract}</summary>${f.authors.map((a) => `<author><name>${a}</name></author>`).join('')}<link title="pdf" href="${BASE}/pdf/${f.id}.pdf"/></entry>`;
        }).join('');
        res.writeHead(200, { 'content-type': 'application/atom+xml' });
        return res.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`);
      }
      if (p === '/s2/graph/v1/paper/search') {
        const n = parseInt(url.searchParams.get('limit') || '10', 10);
        const q = url.searchParams.get('query') || '';
        if (h(q) % 7 === 0) return json(res, { message: 'Too Many Requests' }, 429);
        return json(res, { data: Array.from({ length: n }, (_, i) => {
          const f = fakePaper(q, 's2', i);
          return { paperId: f.id, title: f.title, abstract: f.abstract, year: f.year, authors: f.authors.map((name) => ({ name })), venue: f.venue, citationCount: f.cited, externalIds: { DOI: f.doi }, openAccessPdf: null, url: 'https://semanticscholar.org/p/' + f.id, tldr: { text: 'A short machine summary of ' + f.title.slice(0, 40) } };
        }) });
      }
      if (p === '/epmc/europepmc/webservices/rest/search') {
        const n = parseInt(url.searchParams.get('pageSize') || '10', 10);
        const q = url.searchParams.get('query') || '';
        return json(res, { resultList: { result: Array.from({ length: n }, (_, i) => { const f = fakePaper(q, 'epmc', i); return { title: f.title, abstractText: `<p>${f.abstract}</p>`, pubYear: String(f.year), authorString: f.authors.join(', '), journalTitle: f.venue, doi: f.doi, citedByCount: f.cited, pmid: String(h(f.id)) }; }) } });
      }
      if (p.startsWith('/pdf/')) {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end(makePdf(p));
      }
      if (p === '/llm/chat/completions') {
        const b = JSON.parse(raw);
        const sys = (b.messages.find((m) => m.role === 'system') || {}).content || '';
        const usr = (b.messages.find((m) => m.role === 'user') || {}).content || '';
        await new Promise((r) => setTimeout(r, 30));
        return json(res, { choices: [{ message: { role: 'assistant', content: llmAnswer(sys, usr) } }], usage: { prompt_tokens: Math.round(usr.length / 4), completion_tokens: 200 } });
      }
      // ElevenLabs
      if (p === '/eleven/v1/convai/tools' && req.method === 'GET') return json(res, { tools: [{ id: 'tool_existing', tool_config: { type: 'client', name: 'verify_claim' } }] });
      if (p.startsWith('/eleven/v1/convai/tools/') && req.method === 'PATCH') return json(res, {});
      if (p === '/eleven/v1/convai/agents' && req.method === 'GET') return json(res, { agents: [] });
      if (p === '/eleven/v1/convai/tools' && req.method === 'POST') return json(res, { id: 'tool_' + h(raw).toString(36) });
      if (p.startsWith('/eleven/v1/convai/tools/') && req.method === 'DELETE') return json(res, {});
      if (p === '/eleven/v1/convai/agents/create') { JSON.parse(raw); return json(res, { agent_id: 'agent_mock123' }); }
      if (p.startsWith('/eleven/v1/convai/agents/') && req.method === 'PATCH') return json(res, {});
      if (p === '/eleven/v1/convai/conversation/get-signed-url') return json(res, { signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_mock123&token=mock' });
      if (p.startsWith('/eleven/v1/text-to-speech/')) {
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        return res.end(Buffer.from('ID3mockmp3' + JSON.parse(raw).text.slice(0, 20)));
      }
      if (p === '/eleven/v1/voices') return json(res, { voices: [{ voice_id: 'v1', labels: { gender: 'female' } }, { voice_id: 'v2', labels: { gender: 'male' } }] });
      json(res, { error: 'mock: no route ' + p }, 404);
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('mock-services.mjs')) {
  startMock().then(() => console.log('Mock services on ' + BASE));
}
