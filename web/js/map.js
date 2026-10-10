// Citation map: included papers (filled) and related ones (hollow), joined by
// real citation links and topical similarity.
import { html, raw, esc, authorShort, qColor } from './util.js';
import { ForceGraph } from './graph.js';

export function renderMap(stage, s, app) {
  const subs = (s.plan && s.plan.subQuestions) || [];
  const byKey = new Map((s.papers || []).map((p) => [p.key, p]));
  const cites = (s.graph && s.graph.edges || []).filter((e) => e.kind === 'cites').length;
  stage.innerHTML = html`<div class="map-view">
    <canvas id="mapCanvas" aria-label="Citation map"></canvas>
    <div class="map-key">
      <h2>How the sources connect</h2>
      ${raw(subs.map((q) => `<div><i style="background:${qColor(q.id)}"></i><span>${esc(q.question)}</span></div>`).join(''))}
      <span class="note">Filled circles are in the review, hollow ones are related papers. Solid lines are citations (${cites} found), dashed lines join papers on similar topics. Size reflects how often a paper is cited. Drag to rearrange, scroll to zoom, click a paper to read where it is cited.</span>
    </div>
    <div class="map-tip" id="mapTip" hidden></div>
  </div>`;
  const tip = stage.querySelector('#mapTip');
  const g = new ForceGraph(stage.querySelector('#mapCanvas'), {
    onHover: (n, x, y) => {
      if (!n) { tip.hidden = true; return; }
      const p = byKey.get(n.id);
      if (!p) return;
      tip.hidden = false;
      tip.innerHTML = html`${raw(p.n ? `<b>[${p.n}]</b> ` : '')}${p.title}<br><span style="opacity:.75">${authorShort(p)}, ${p.year || 'n.d.'}${p.citedBy != null ? raw(`, ${p.citedBy} citations`) : ''}</span>`;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    },
    onClick: (n) => { const p = byKey.get(n.id); if (p && p.n) app.showSource(p.n); },
  });
  for (const key of (s.graph && s.graph.nodes) || []) {
    const p = byKey.get(key);
    if (!p) continue;
    const weight = p.citedBy != null ? Math.log10(p.citedBy + 1) : (p.score || 5) / 3.3;
    const r = p.included ? 7 + Math.min(12, weight * 3.4) : 4.5 + Math.min(6, weight * 1.6);
    g.upsertNode({ id: key, r, color: qColor((p.subq || [])[0]), filled: !!p.included, label: p.n ? String(p.n) : '' });
  }
  g.setLinks((s.graph && s.graph.edges) || []);
  return () => g.destroy();
}
