// The live research desk: the pipeline's progress, streamed from n8n.
import { html, raw, esc, fmtMs, qColor, authorShort } from './util.js';
import { ForceGraph } from './graph.js';

const TAIL = [
  ['select', 'Choosing what to read in full'],
  ['index', 'Reading full texts and building the index'],
  ['extract', 'Extracting evidence from each paper'],
  ['write', 'Writing the review'],
  ['audit', 'Checking every citation against its source'],
  ['script', 'Scripting the audio overview'],
  ['deliver', 'Assembling the session'],
];

let L = null;      // derived live state
let graph = null;
let root = null;

function fresh() {
  return { engine: '', plan: null, stages: [], found: 0, relevant: 0, scores: new Map(), papers: [], log: [], coverage: {}, followups: [], note: '', selected: 0, fullText: null, chunks: null, error: null, audit: null };
}

function fold(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'engine': L.engine = d.engine; break;
    case 'plan': L.plan = d; break;
    case 'stage': {
      const key = d.id + ':' + (['search', 'screen'].includes(d.id) ? d.round : 0);
      let st = L.stages.find((s) => s.key === key);
      if (!st) { st = { key, id: d.id, label: d.label }; L.stages.push(st); }
      Object.assign(st, { status: d.status, ms: d.ms, label: d.label });
      break;
    }
    case 'papers': L.found = d.total; L.papers.push(...(d.added || [])); break;
    case 'screened': for (const p of d.papers || []) L.scores.set(p.key, p); L.relevant = (d.papers || []).filter((p) => p.score >= 6).length; break;
    case 'coverage': L.coverage = d.coverage; L.followups = d.continue ? d.followups || [] : []; L.note = d.note || ''; break;
    case 'selected': L.selected = (d.references || []).length; L.selectedKeys = new Set((d.references || []).map((r) => r.key)); break;
    case 'indexed': L.fullText = d.fullText; L.chunks = d.chunks; break;
    case 'audit': L.audit = d; break;
    case 'log': L.log.push(d); if (L.log.length > 120) L.log.shift(); break;
    case 'error': L.error = d.message; { const st = L.stages.find((s) => s.status === 'running'); if (st) st.status = 'error'; } break;
    default: break;
  }
}

export function renderLive(stage, s, app) {
  L = fresh();
  for (const ev of s.events || []) fold(ev);
  if (s.status === 'error' && !L.error) L.error = s.error || 'The run stopped.';
  stage.innerHTML = html`<div class="live">
    <div class="live-main">
      <h1 class="q-title">${s.question}</h1>
      <div class="q-sub" id="liveSub"></div>
      <div id="liveError"></div>
      <div class="counters" id="counters"></div>
      <div id="planBox"></div>
      <h2 class="section-h">The pipeline <small id="engineNote"></small></h2>
      <ol class="ledger" id="ledger"></ol>
      <div id="followups"></div>
      <h2 class="section-h">Papers as they arrive <small>newest first</small></h2>
      <div class="stream" id="stream"></div>
    </div>
    <aside class="live-side">
      <div>
        <h2 class="section-h">Constellation <small>papers cluster around the sub-question they answer</small></h2>
        <canvas class="live-map" id="liveMap" aria-label="Live map of papers found"></canvas>
      </div>
      <div>
        <h2 class="section-h">What the engine is doing</h2>
        <div class="feed" id="feed"></div>
      </div>
    </aside>
  </div>`;
  root = stage;
  graph = new ForceGraph(stage.querySelector('#liveMap'), { interactive: false, labels: true });
  drawAll(s);
  stage.querySelector('#liveError').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-retry]')) return;
    const { api } = await import('./api.js');
    try {
      const { id } = await api.start({ question: s.question, depth: s.depth || 'standard' });
      await app.loadLibrary();
      location.hash = `#/s/${id}/review`;
    } catch (err) { alert(err.message); }
  });
  return () => { if (graph) graph.destroy(); graph = null; root = null; };
}

export function applyLiveEvent(ev, s) {
  if (!root || !L) return;
  fold(ev);
  if (ev.type === 'papers') appendStream(ev.data.added || []);
  drawAll(s, ev.type);
}

function drawAll(s, only) {
  if (!root) return;
  const q = (sel) => root.querySelector(sel);
  q('#liveSub').textContent = L.plan ? `${L.plan.depthLabel || ''} review${L.plan.sources ? ', searching ' + L.plan.sources.map(nameOf).join(', ') : ''}` : 'Planning the search…';
  q('#engineNote').textContent = L.engine === 'n8n' ? 'running as an n8n workflow' : L.engine ? 'running on the built-in engine' : '';
  q('#counters').innerHTML = html`
    <div><b>${L.found}</b><span>papers found</span></div>
    <div><b>${L.relevant}</b><span>judged relevant</span></div>
    <div><b>${L.selected || '–'}</b><span>selected</span></div>
    <div><b>${L.fullText == null ? '–' : L.fullText}</b><span>read in full</span></div>`;
  if (L.error) {
    q('#liveError').innerHTML = html`<div class="error-box"><h3>The research stopped</h3><p>${L.error}</p><button class="secondary" data-retry>Run it again</button></div>`;
  }
  if (L.plan) {
    const subs = L.plan.subQuestions || [];
    const max = Math.max(4, ...Object.values(L.coverage || {}));
    q('#planBox').innerHTML = html`<h2 class="section-h">${L.plan.title} <small>${L.plan.scope}</small></h2>
      <ul class="subqs">${raw(subs.map((sq) => {
        const c = (L.coverage || {})[sq.id] || 0;
        return `<li style="--qc:${qColor(sq.id)}"><span class="id">${sq.id.toUpperCase()}</span><span class="text">${esc(sq.question)}</span><span class="cov"><span class="bar"><i style="width:${Math.min(100, (c / max) * 100)}%"></i></span><span>${c} relevant</span></span></li>`;
      }).join(''))}</ul>`;
  }
  // Ledger: stages seen so far + the fixed tail still to come.
  const seen = new Set(L.stages.map((x) => x.id));
  const rows = [
    ...(L.stages.length ? [] : [{ id: 'plan', label: 'Breaking the question apart', status: 'running' }]),
    ...L.stages,
    ...TAIL.filter(([id]) => !seen.has(id)).map(([id, label]) => ({ id, label, status: 'pending' })),
  ];
  q('#ledger').innerHTML = rows.map((r) => `<li class="${r.status}"><span class="lbl">${esc(r.label)}</span><span class="ms">${r.status === 'done' && r.ms != null ? fmtMs(r.ms) : ''}</span></li>`).join('');
  q('#followups').innerHTML = L.followups.length
    ? html`<div class="followups">Next round looks for ${raw(L.followups.slice(0, 5).map((f) => `<em>${esc(f.q)}</em>`).join(', '))}${L.note ? raw('. ' + esc(L.note)) : ''}</div>`
    : '';
  q('#feed').innerHTML = L.log.slice(-14).reverse().map((l) => `<div class="${l.error ? 'err' : ''}">${esc(l.text)}</div>`).join('') || '<div>Waiting for the first results…</div>';
  if (only === 'screened' || only === 'selected') rescoreStream();
  if (!only && L.papers.length) { root.querySelector('#stream').innerHTML = ''; appendStream(L.papers.slice(-60)); }
  updateGraph();
}

const nameOf = (k) => ({ openalex: 'OpenAlex', semanticscholar: 'Semantic Scholar', arxiv: 'arXiv', europepmc: 'Europe PMC' }[k] || k);

function appendStream(papers) {
  const box = root && root.querySelector('#stream');
  if (!box) return;
  const frag = document.createDocumentFragment();
  for (const p of papers.slice(-25)) {
    const el = document.createElement('div');
    el.className = 'stream-item';
    el.dataset.key = p.key;
    el.innerHTML = html`<div><div class="t">${p.title}</div><div class="m">${authorShort(p)}, ${p.year || 'n.d.'}${p.venue ? raw(', ' + esc(p.venue)) : ''}. Found in ${(p.sources || []).map(nameOf).join(', ')}</div></div><span class="score"></span>`;
    frag.prepend(el);
  }
  box.prepend(frag);
  while (box.children.length > 60) box.lastChild.remove();
  rescoreStream();
}

function rescoreStream() {
  if (!root) return;
  root.querySelectorAll('.stream-item').forEach((el) => {
    const sc = L.scores.get(el.dataset.key);
    if (!sc) return;
    el.classList.toggle('relevant', sc.score >= 6);
    el.querySelector('.score').textContent = (L.selectedKeys && L.selectedKeys.has(el.dataset.key) ? 'Selected, ' : '') + sc.score + '/10';
  });
}

function updateGraph() {
  if (!graph) return;
  const subs = (L.plan && L.plan.subQuestions) || [];
  for (const sq of subs) graph.upsertNode({ id: 'hub:' + sq.id, r: 13, color: qColor(sq.id), filled: true, label: sq.id.toUpperCase() });
  const links = [];
  const papers = L.papers.slice(-160);
  for (const p of papers) {
    const sc = L.scores.get(p.key);
    const subq = sc && sc.subq && sc.subq[0];
    const selected = L.selectedKeys && L.selectedKeys.has(p.key);
    graph.upsertNode({ id: p.key, r: selected ? 6.5 : sc && sc.score >= 6 ? 5 : 3.2, color: subq ? qColor(subq) : 'var(--ink-3)', filled: !!(sc && sc.score >= 6), dim: !sc });
    if (subq) links.push({ source: p.key, target: 'hub:' + subq, kind: 'cites' });
  }
  graph.setLinks(links);
}
