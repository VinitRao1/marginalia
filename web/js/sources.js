// Sources: the reading list, related papers that didn't make the cut, exports.
import { html, raw, esc, authorsLine, fmtNum } from './util.js';

const NAMES = { openalex: 'OpenAlex', semanticscholar: 'Semantic Scholar', arxiv: 'arXiv', europepmc: 'Europe PMC' };

export function renderSources(stage, s, app) {
  let showRelated = false;
  let query = '';
  stage.innerHTML = html`<div class="wide">
    <h1>Sources</h1>
    <p class="sub">The ${(s.papers || []).filter((p) => p.included).length} papers the review is built on, ranked by relevance and influence. Related papers were screened as relevant but left out to keep the review focused.</p>
    <div class="toolbar">
      <input class="search-in" id="filter" type="search" placeholder="Filter by title, author or venue" aria-label="Filter sources">
      <button class="chip-toggle" id="relToggle" aria-pressed="false">Include related papers</button>
      <span class="spacer"></span>
      <a class="secondary" href="/api/sessions/${s.id}/export/md" download>Markdown</a>
      <a class="secondary" href="/api/sessions/${s.id}/export/bib" download>BibTeX</a>
      <a class="secondary" href="/api/sessions/${s.id}/export/ris" download>RIS</a>
      <a class="secondary" href="/api/sessions/${s.id}/export/json" download>JSON</a>
    </div>
    <div class="src-list" id="srcList"></div>
  </div>`;

  const list = stage.querySelector('#srcList');
  const draw = () => {
    const q = query.toLowerCase();
    const rows = (s.papers || [])
      .filter((p) => p.included || (showRelated && p.score >= 6))
      .filter((p) => !q || (p.title + ' ' + (p.authors || []).join(' ') + ' ' + (p.venue || '')).toLowerCase().includes(q))
      .sort((a, b) => (a.n || 999) - (b.n || 999) || (b.score || 0) - (a.score || 0));
    list.innerHTML = rows.map((p) => {
      const c = p.card || {};
      return html`<div class="src-row" ${raw(p.included ? `data-n="${p.n}" tabindex="0" role="button"` : '')}>
        <span class="num">${p.n || ''}</span>
        <div>
          <div class="t">${p.title}</div>
          <div class="m">${authorsLine(p, 4)}. ${p.year || 'n.d.'}${p.venue ? raw('. <i>' + esc(p.venue) + '</i>') : ''}</div>
          ${raw(c.tldr || p.reason ? `<div class="tl">${esc(c.tldr || p.reason)}</div>` : '')}
        </div>
        <div class="side">
          ${raw(p.included ? (p.hasFullText ? '<span class="badge full">Read in full</span>' : '<span class="badge">Abstract</span>') : '<span class="badge">Related</span>')}
          <span title="Relevance judged during screening">relevance ${p.score ?? '–'}/10</span>
          <span class="relbar"><i style="width:${(p.score || 0) * 10}%"></i></span>
          <span>${p.citedBy != null ? fmtNum(p.citedBy) + ' citations' : ''}</span>
          <span>${(p.sources || []).map((x) => NAMES[x] || x).join(', ')}</span>
        </div>
      </div>`;
    }).join('') || '<div class="empty">No sources match that filter.</div>';
  };
  draw();
  stage.querySelector('#filter').addEventListener('input', (e) => { query = e.target.value; draw(); });
  stage.querySelector('#relToggle').addEventListener('click', (e) => { showRelated = !showRelated; e.currentTarget.setAttribute('aria-pressed', String(showRelated)); draw(); });
  list.addEventListener('click', (e) => { const r = e.target.closest('[data-n]'); if (r && !e.target.closest('a')) app.showSource(+r.dataset.n); });
  list.addEventListener('keydown', (e) => { const r = e.target.closest('[data-n]'); if (r && e.key === 'Enter') app.showSource(+r.dataset.n); });
  return null;
}
