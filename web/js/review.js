// The review: a reading column with sources surfacing in the margin.
import { api } from './api.js';
import { html, raw, esc, authorsLine, authorShort, fmtMs, toast } from './util.js';
import { renderReport, slug } from './md.js';

let S = null;       // current session
let root = null;
let pinned = null;  // the source card the reader clicked (survives hover)

const clip = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t);
const byN = (n) => (S.papers || []).find((p) => p.included && p.n === n);
const auditFor = (key) => (S.audit && S.audit.items || []).find((a) => a.key === key);

export function renderReview(stage, s, app) {
  S = s;
  const a = s.audit || {};
  const st = s.stats || {};
  const total = (a.supported || 0) + (a.partial || 0) + (a.unsupported || 0) || 1;
  stage.innerHTML = html`<div class="review">
    <div class="review-main">
      <article class="paper">
        <div class="kicker">
          ${raw(s.demo ? '<span class="badge">Sample session</span>' : '')}
          <span>${st.included || 0} sources</span>
          <span>${st.fullText || 0} read in full</span>
          <span>${st.found || 0} papers screened over ${st.rounds || 1} search ${st.rounds === 1 ? 'round' : 'rounds'}</span>
          ${raw(st.durationMs ? `<span>${fmtMs(st.durationMs)}</span>` : '')}
        </div>
        <h1>${s.title || s.question}</h1>
        <p class="asked">${s.question}</p>
        ${raw(a.checked ? html`<div class="integrity">
          <span class="score">${a.score}%</span>
          <span>citation integrity<br>${a.supported} of ${a.checked} checked sentences fully supported</span>
          <span class="bars" title="${a.supported} supported, ${a.partial} partial, ${a.unsupported} unsupported">
            <i style="width:${(a.supported / total) * 100}%"></i><i style="width:${(a.partial / total) * 100}%"></i><i style="width:${(a.unsupported / total) * 100}%"></i>
          </span>
          <label class="toggle"><input type="checkbox" id="marksToggle" checked> Show checks</label>
        </div>` : '')}
        <div class="prose marks" id="prose">${raw(renderReport(s.report, a.items))}</div>
      </article>
    </div>
    <aside class="margin" id="margin" aria-label="Sources in the margin"><div class="margin-inner" id="marginInner"></div></aside>
  </div>`;
  root = stage;
  pinned = null;
  drawMarginHome();

  const prose = stage.querySelector('#prose');
  const toggle = stage.querySelector('#marksToggle');
  if (toggle) toggle.addEventListener('change', () => prose.classList.toggle('marks', toggle.checked));

  prose.addEventListener('click', (e) => {
    const c = e.target.closest('.cite');
    if (!c) return;
    const sentence = c.closest('.s');
    pinned = { n: +c.dataset.n, key: sentence && sentence.dataset.k };
    markActive(sentence, c);
    showCards([+c.dataset.n], sentence && sentence.dataset.k);
  });
  let hoverT;
  prose.addEventListener('mouseover', (e) => {
    const c = e.target.closest('.cite');
    if (!c || window.innerWidth < 900) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => {
      const sentence = c.closest('.s');
      showCards([+c.dataset.n], sentence && sentence.dataset.k, true);
    }, 120);
  });
  prose.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.cite')) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => { if (pinned) showCards([pinned.n], pinned.key); else drawMarginHome(); }, 300);
  });
  return () => { root = null; };
}

function markActive(sentence, cite) {
  if (!root) return;
  root.querySelectorAll('.s.active, .s.sweep').forEach((x) => x.classList.remove('active', 'sweep'));
  root.querySelectorAll('.cite.on').forEach((x) => x.classList.remove('on'));
  if (sentence) sentence.classList.add('active');
  if (cite) cite.classList.add('on');
}

function drawMarginHome() {
  if (!root) return;
  const inner = root.querySelector('#marginInner');
  const flagged = (S.audit && S.audit.items || []).filter((x) => x.verdict !== 'supported');
  inner.innerHTML = html`<p class="margin-hint"><b>Sources live in this margin.</b> Hover or tap a citation number to see the paper, what it found, and whether the sentence holds up against its text. Select any passage to check it against the sources yourself.</p>
    ${raw(flagged.length ? html`<h3 class="section-h" style="margin-top:28px">Worth a second look <small>${flagged.length}</small></h3>
      ${raw(flagged.map((f) => html`<button class="srccard" data-jump="${f.key}" style="display:block;width:100%;text-align:left;cursor:pointer">
        <div class="verdict v-${f.verdict}" style="margin:0 0 8px"><b>${f.verdict === 'partial' ? 'Partly supported' : 'Not supported'}</b> ${f.note}</div>
        <div class="tl" style="margin:0">${clip(f.sentence.replace(/\s*\[[\d,\s–-]+\]/g, ''), 170)}</div>
      </button>`).join(''))}` : '')}
    ${raw((S.notes || []).length ? html`<h3 class="section-h" style="margin-top:28px">Your notes</h3>${raw(S.notes.map((n) => html`<div class="notecard"><small>${n.source === 'agent' ? 'From the debate' : 'You'}</small>${n.text}</div>`).join('<div style="height:10px"></div>'))}` : '')}`;
  inner.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const el = root.querySelector(`.s[data-k="${CSS.escape(b.dataset.jump)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const refs = (el.dataset.refs || '').split(',').map(Number).filter(Boolean);
    markActive(el);
    pinned = { n: refs[0], key: el.dataset.k };
    showCards(refs.slice(0, 2), el.dataset.k);
  }));
}

function cardHtml(p, key) {
  const c = p.card || {};
  const v = key ? auditFor(key) : null;
  const relevantV = v && (v.refs || []).includes(p.n) ? v : null;
  const link = p.doi && !/arxiv/i.test(p.doi) ? `https://doi.org/${p.doi}` : p.url;
  return html`<div class="srccard">
    <span class="n">${p.n}</span>
    <h4>${p.title}</h4>
    <div class="by">${authorsLine(p, 3)}. ${p.year || 'n.d.'}${p.venue ? raw('. <i>' + esc(p.venue) + '</i>') : ''}</div>
    ${raw(c.tldr ? `<p class="tl">${esc(c.tldr)}</p>` : p.abstract ? `<p class="tl">${esc(p.abstract.slice(0, 260))}…</p>` : '')}
    <dl>
      ${raw(c.studyType ? `<dt>Study</dt><dd>${esc(c.studyType)}</dd>` : '')}
      ${raw(c.keyResult ? `<dt>Result</dt><dd>${esc(c.keyResult)}</dd>` : '')}
      ${raw(c.data ? `<dt>Data</dt><dd>${esc(c.data)}</dd>` : '')}
      ${raw(c.limitations ? `<dt>Caveats</dt><dd>${esc(c.limitations)}</dd>` : '')}
    </dl>
    <div class="links">
      ${raw(p.hasFullText ? '<span class="badge full">Read in full</span>' : '<span class="badge">Abstract only</span>')}
      ${raw(c.stance && c.stance !== 'context' ? `<span class="badge ${esc(c.stance)}">${esc(c.stance)}</span>` : '')}
      ${raw(link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Open paper</a>` : '')}
      ${raw(p.pdfUrl ? `<a href="${esc(p.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : '')}
    </div>
    ${raw(relevantV ? html`<div class="verdict v-${relevantV.verdict}"><b>${relevantV.verdict === 'supported' ? 'Supported' : relevantV.verdict === 'partial' ? 'Partly supported' : 'Not supported'}</b> by the source text. ${relevantV.note}
      ${raw((relevantV.evidence || []).filter((e) => e.n === p.n).slice(0, 1).map((e) => `<blockquote>${esc(e.text.slice(0, 260))}…</blockquote>`).join(''))}</div>` : '')}
  </div>`;
}

function showCards(nums, key, preview = false) {
  if (!root) return;
  const inner = root.querySelector('#marginInner');
  const papers = nums.map(byN).filter(Boolean);
  if (!papers.length) return;
  inner.innerHTML = papers.map((p) => cardHtml(p, key)).join('');
  if (!preview && window.innerWidth < 900) {
    root.querySelector('#margin').classList.add('open');
    const close = (e) => { if (!e.target.closest('#margin') && !e.target.closest('.cite')) { root && root.querySelector('#margin').classList.remove('open'); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

/** Called by the voice agent (show_source) and other views. */
export function focusSource(n, { key, sweep = true } = {}) {
  if (!root) return;
  let el = key ? root.querySelector(`.s[data-k="${CSS.escape(key)}"]`) : null;
  if (!el) el = Array.from(root.querySelectorAll('.s[data-refs]')).find((x) => x.dataset.refs.split(',').includes(String(n)));
  pinned = { n, key: el && el.dataset.k };
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    markActive(el, el.querySelector(`.cite[data-n="${n}"]`));
    if (sweep) { el.classList.remove('active'); void el.offsetWidth; el.classList.add('sweep'); }
  }
  showCards([n], el && el.dataset.k);
}

export function showSection(name) {
  if (!root) return;
  const words = String(name || '').toLowerCase();
  const table = [
    ['bottom', 'bottom-line'], ['summary', 'bottom-line'], ['background', 'background'], ['evidence', 'what-the-evidence-says'],
    ['disagree', 'where-studies-disagree'], ['conflict', 'where-studies-disagree'], ['quality', 'how-good-is-the-evidence'],
    ['good', 'how-good-is-the-evidence'], ['open', 'open-questions'], ['gap', 'open-questions'], ['question', 'open-questions'], ['conclusion', 'conclusion'],
  ];
  const hit = table.find(([w]) => words.includes(w));
  let el = hit ? root.querySelector('#sec-' + hit[1]) : null;
  if (!el) el = Array.from(root.querySelectorAll('.prose h2, .prose h3')).find((h) => h.textContent.toLowerCase().includes(words.split(' ')[0]));
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Check a selected passage against the sources and show the verdict in the margin. */
export async function verifyInMargin(text, refs) {
  if (!root) return;
  const inner = root.querySelector('#marginInner');
  inner.innerHTML = html`<div class="srccard"><div class="toolcard" style="border:0;padding:0;background:none"><div class="h"><span class="spin"></span>Checking against ${refs ? 'sources ' + refs : 'all sources'}</div></div><p class="tl" style="margin-top:8px">“${text.slice(0, 240)}”</p></div>`;
  if (window.innerWidth < 900) root.querySelector('#margin').classList.add('open');
  try {
    const v = await api.verify(S.id, text, refs);
    const label = { supported: 'Supported', partial: 'Partly supported', unsupported: 'Not supported', not_found: 'Not found in the sources' }[v.verdict];
    inner.innerHTML = html`<div class="srccard">
      <p class="tl">“${text.slice(0, 240)}”</p>
      <div class="verdict v-${v.verdict}"><b>${label}</b> (${Math.round((v.confidence || 0) * 100)}% confidence). ${v.explanation}
        ${raw((v.evidence || []).map((e) => `<blockquote>[${e.n}] ${esc(e.quote)}</blockquote>`).join(''))}</div>
    </div>${raw((v.evidence || []).map((e) => byN(e.n)).filter(Boolean).slice(0, 2).map((p) => cardHtml(p)).join(''))}`;
  } catch (e) {
    inner.innerHTML = html`<div class="srccard"><div class="verdict v-unsupported"><b>Could not check this.</b> ${e.message}</div></div>`;
  }
}
