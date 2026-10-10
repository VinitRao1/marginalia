// Marginalia web app: routing, library, live sessions and shared actions.
import { api } from './api.js';
import { $, $$, esc, html, raw, timeAgo, toast } from './util.js';
import { renderHome } from './home.js';
import { renderLive, applyLiveEvent } from './live.js';
import { renderReview, focusSource, showSection } from './review.js';
import { renderEvidence } from './evidence.js';
import { renderSources } from './sources.js';
import { renderMap } from './map.js';
import { renderListen } from './listen.js';
import { Debate } from './debate.js';

const stage = $('#stage');
const VIEWS = [
  ['review', 'Review'],
  ['evidence', 'Evidence'],
  ['sources', 'Sources'],
  ['map', 'Map'],
  ['listen', 'Listen'],
];

export const app = {
  status: null,
  sessions: [],
  session: null,
  view: 'review',
  stream: null,
  cleanup: null,
  debate: null,

  go(view, opts = {}) {
    if (!this.session) return;
    const target = `#/s/${this.session.id}/${view}`;
    if (location.hash !== target) { this.pendingFocus = opts; location.hash = target; }
    else if (opts.source) focusSource(opts.source, opts);
  },

  async showSource(n, opts = {}) {
    if (this.view !== 'review') { this.go('review', { ...opts, source: n }); return; }
    focusSource(n, opts);
  },

  showSection(name) {
    const map = { sources: 'sources', matrix: 'evidence', evidence_matrix: 'evidence', map: 'map', listen: 'listen' };
    const key = String(name || '').toLowerCase().replace(/\s+/g, '_');
    if (map[key]) return this.go(map[key]);
    if (this.view !== 'review') { this.go('review', { section: name }); return; }
    showSection(name);
  },

  async refreshSession() {
    if (!this.session) return;
    this.session = await api.session(this.session.id);
    return this.session;
  },
};
window.marginalia = app;

// ─── Theme ──────────────────────────────────────────────────────────────────
const savedTheme = (() => { try { return localStorage.getItem('marginalia-theme'); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('marginalia-theme', next); } catch { /* private mode */ }
});

// ─── Library ────────────────────────────────────────────────────────────────
export async function loadLibrary() {
  try { app.sessions = await api.sessions(); } catch { app.sessions = []; }
  drawLibrary();
}

function drawLibrary() {
  const list = $('#libraryList');
  const cur = app.session && app.session.id;
  const yours = app.sessions.filter((s) => !s.demo);
  const demos = app.sessions.filter((s) => s.demo);
  const item = (s) => html`<a class="lib-item" href="#/s/${s.id}/review" ${raw(s.id === cur ? 'aria-current="page"' : '')}>
      <span class="t">${s.title || s.question}</span>
      <span class="m"><i class="dot ${s.status}"></i>${s.status === 'running' ? 'Researching' : s.status === 'error' ? 'Stopped' : [s.papers ? `${s.papers} sources` : '', s.score != null ? `${s.score}% verified` : '', s.demo ? '' : timeAgo(s.createdAt)].filter(Boolean).join(', ')}</span>
    </a>`;
  list.innerHTML =
    (yours.length ? html`<div class="lib-group">Your research</div>${raw(yours.map(item).join(''))}` : html`<div class="lib-group">Your research appears here</div>`) +
    (demos.length ? html`<div class="lib-group">Sample</div>${raw(demos.map(item).join(''))}` : '');
}

const library = $('#library');
$('#libraryToggle').addEventListener('click', () => {
  const open = !library.classList.contains('open');
  library.classList.toggle('open', open);
  $('#libraryToggle').setAttribute('aria-expanded', String(open));
});
library.addEventListener('click', (e) => { if (e.target.closest('a')) library.classList.remove('open'); });

// ─── Status & setup ─────────────────────────────────────────────────────────
export async function loadStatus() {
  try { app.status = await api.status(); } catch { app.status = null; }
  const pill = $('#enginePill');
  if (app.status) {
    pill.hidden = false;
    pill.innerHTML = app.status.engine === 'n8n' ? 'Engine <b>n8n</b>' : 'Engine <b>built-in</b>';
    pill.title = app.status.engine === 'n8n' ? `Research runs as an n8n workflow at ${app.status.n8n.url}` : 'n8n is not reachable, so the studio runs the same workflow with its built-in runner';
  }
  return app.status;
}

export function openSetup() {
  const s = app.status || {};
  const mark = (ok, warn) => raw(`<span class="${ok ? 'ok-mark' : warn ? 'warn-mark' : 'no-mark'}">${ok ? '✓' : '!'}</span>`);
  const n8n = s.n8n || {};
  const llm = s.llm || {};
  const el = s.elevenlabs || {};
  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = html`<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
    <h2 id="setupTitle">Setup and status</h2>
    <p>Marginalia needs a language model to research. n8n and ElevenLabs make it complete.</p>
    <div class="check">${mark(llm.ready)}<div><b>Language model${llm.ready ? ` (${esc(llm.provider)})` : ''}</b>
      <p>${llm.ready ? raw(`Writing with <code>${esc(llm.model)}</code>${llm.fastModel ? `, screening with <code>${esc(llm.fastModel)}</code>` : ''}.`) : raw('Add <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>GEMINI_API_KEY</code> or <code>OPENROUTER_API_KEY</code> to <code>.env</code>, then restart.')}</p></div></div>
    <div class="check">${mark(s.engine === 'n8n', true)}<div><b>n8n research engine</b>
      <p>${s.engine === 'n8n' ? raw(`Running at <a href="${esc(n8n.url)}" target="_blank" rel="noopener">${esc(n8n.url)}</a>. Open it to watch each run's execution.`) : raw(`${esc(n8n.error || 'Not reachable.')} The studio is running the same workflow with its built-in runner, which reads abstracts and simple PDFs. Start n8n with <code>docker compose up -d</code> for full-text PDF parsing and execution history.`)}</p></div></div>
    <div class="check">${mark(el.configured && !el.error, el.configured)}<div><b>ElevenLabs voice</b>
      <p>${el.configured ? (el.error ? raw(`Key found, but the agent could not be created: ${esc(el.error)}`) : raw(`Ready. ${el.managed ? 'Marginalia created and manages its own agent with client tools.' : `Using your agent <code>${esc(el.agentId)}</code>.`}`)) : raw('Add <code>ELEVENLABS_API_KEY</code> to <code>.env</code> to debate the review out loud and record the two-voice audio overview.')}</p></div></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="primary" data-close>Done</button></div>
  </div>`;
  const backdrop = $('#sheetBackdrop');
  backdrop.hidden = false;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); backdrop.hidden = true; };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  wrap.querySelector('[data-close]').focus();
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
}
$('#setupLink').addEventListener('click', async () => { await loadStatus(); openSetup(); });

// ─── Tabs ───────────────────────────────────────────────────────────────────
function drawTabs() {
  const tabs = $('#tabs');
  const s = app.session;
  if (!s || s.status !== 'done') { tabs.hidden = true; return; }
  tabs.hidden = false;
  tabs.innerHTML = VIEWS.map(([v, label]) => `<a href="#/s/${s.id}/${v}" ${v === app.view ? 'aria-current="page"' : ''}>${label}</a>`).join('');
}

// ─── Debate panel ───────────────────────────────────────────────────────────
const debateBtn = $('#debateBtn');
debateBtn.addEventListener('click', () => {
  if (!app.debate) app.debate = new Debate($('#debate'), app);
  app.debate.toggle();
  debateBtn.setAttribute('aria-pressed', String(app.debate.open));
});

// ─── Routing ────────────────────────────────────────────────────────────────
async function route() {
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  const m = location.hash.match(/^#\/s\/([\w-]+)(?:\/(\w+))?/);
  if (!m) {
    closeStream();
    app.session = null;
    drawTabs();
    debateBtn.hidden = true;
    if (app.debate) app.debate.hide();
    drawLibrary();
    app.cleanup = renderHome(stage, app);
    return;
  }
  const [, id, view = 'review'] = m;
  if (!app.session || app.session.id !== id) {
    closeStream();
    stage.innerHTML = '<div class="loading">Opening…</div>';
    try {
      app.session = await api.session(id);
    } catch (e) {
      stage.innerHTML = html`<div class="empty">This session could not be opened. ${e.message}</div>`;
      return;
    }
    if (app.debate) app.debate.sessionChanged();
  }
  app.view = VIEWS.some(([v]) => v === view) ? view : 'review';
  drawLibrary();
  render();
  stage.scrollTop = 0;
}

function render() {
  const s = app.session;
  drawTabs();
  debateBtn.hidden = s.status !== 'done';
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  if (s.status !== 'done') {
    app.cleanup = renderLive(stage, s, app);
    if (s.status === 'running') openStream();
    return;
  }
  const views = { review: renderReview, evidence: renderEvidence, sources: renderSources, map: renderMap, listen: renderListen };
  app.cleanup = views[app.view](stage, s, app);
  const pf = app.pendingFocus;
  app.pendingFocus = null;
  if (pf && pf.source && app.view === 'review') setTimeout(() => focusSource(pf.source, pf), 60);
  if (pf && pf.section && app.view === 'review') setTimeout(() => showSection(pf.section), 60);
}

function openStream() {
  closeStream();
  const s = app.session;
  const after = s.events && s.events.length ? s.events[s.events.length - 1].seq : 0;
  app.stream = api.stream(s.id, after, async (ev) => {
    if (!app.session || app.session.id !== s.id) return;
    app.session.events.push(ev);
    if (ev.type === 'done') {
      closeStream();
      await app.refreshSession();
      toast('Review ready');
      loadLibrary();
      if (app.view !== 'review') location.hash = `#/s/${s.id}/review`; else render();
      return;
    }
    if (ev.type === 'error') {
      app.session.status = 'error';
      app.session.error = ev.data.message;
      loadLibrary();
    }
    if (ev.type === 'plan') app.session.title = ev.data.title;
    applyLiveEvent(ev, app.session);
  });
}
function closeStream() { if (app.stream) { app.stream.close(); app.stream = null; } }

// Session-level events also matter after completion (audio progress, debate tools).
app.listenSession = (onEvent) => {
  const s = app.session;
  const es = api.stream(s.id, s.seq || 0, onEvent);
  return () => es.close();
};
app.loadLibrary = loadLibrary;
app.loadStatus = loadStatus;
app.openSetup = openSetup;

// ─── Selection popover: check any sentence against the sources ─────────────
const pop = $('#selectionPop');
let selText = '';
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const inProse = sel && sel.rangeCount && sel.toString().trim().length > 12 && sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('.prose');
  if (!inProse || !app.session || app.session.status !== 'done') { pop.hidden = true; return; }
  selText = sel.toString().trim();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
  pop.style.top = Math.max(64, r.top - 44) + 'px';
  pop.querySelector('[data-act="debate"]').hidden = !(app.debate && app.debate.connected);
});
pop.addEventListener('mousedown', (e) => e.preventDefault());
pop.addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  pop.hidden = true;
  const text = selText;
  const anchor = window.getSelection().anchorNode;
  const sentenceEl = anchor && anchor.parentElement && anchor.parentElement.closest('.s');
  const refs = sentenceEl && sentenceEl.dataset.refs ? sentenceEl.dataset.refs : '';
  window.getSelection().removeAllRanges();
  if (act === 'verify') {
    const { verifyInMargin } = await import('./review.js');
    verifyInMargin(text, refs);
  } else if (act === 'debate' && app.debate) {
    app.debate.raise(text);
  } else if (act === 'note') {
    try { await api.note(app.session.id, text, 'quote', 'you'); toast('Pinned to your notes'); app.session.notes.push({ text, kind: 'quote', source: 'you', at: Date.now() }); } catch (err) { toast(err.message); }
  }
});

// ─── Boot ───────────────────────────────────────────────────────────────────
window.addEventListener('hashchange', route);
await Promise.all([loadLibrary(), loadStatus()]);
route();
setInterval(() => { if (app.sessions.some((s) => s.status === 'running')) loadLibrary(); }, 8000);
