// Evidence: claims by sub-question, and which papers back or contradict each.
import { html, raw, esc, qColor, authorShort } from './util.js';

const LEVELS = ['insufficient', 'weak', 'mixed', 'moderate', 'strong'];

export function renderEvidence(stage, s, app) {
  const refs = (s.papers || []).filter((p) => p.included).sort((a, b) => a.n - b.n);
  const types = {};
  for (const p of refs) { const t = ((p.card && p.card.studyType) || p.kind || 'unclassified').toLowerCase().replace(/\.$/, ''); types[t] = (types[t] || 0) + 1; }
  const years = refs.map((p) => p.year).filter(Boolean);
  const stance = { supports: 0, challenges: 0, mixed: 0 };
  for (const p of refs) if (p.card && stance[p.card.stance] !== undefined) stance[p.card.stance]++;
  const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3);

  stage.innerHTML = html`<div class="wide">
    <h1>The evidence, claim by claim</h1>
    <p class="sub">Each row is a specific claim drawn from the retrieved passages. Columns are the numbered sources; click a number to see where the review cites it.</p>
    <div class="quality">
      <div><b>${refs.length}</b><span>sources, ${s.stats ? s.stats.fullText : 0} read in full</span></div>
      <div><b>${years.length ? Math.min(...years) + '–' + Math.max(...years) : '–'}</b><span>publication years</span></div>
      <div><b>${topTypes.length ? topTypes[0][1] : 0}</b><span>${topTypes.length ? topTypes[0][0] : 'no study types recorded'}${topTypes.slice(1).map(([t, n]) => `, ${n} ${t}`).join('')}</span></div>
      <div><b>${stance.supports} / ${stance.challenges}</b><span>sources leaning for / against the question${stance.mixed ? `, ${stance.mixed} mixed` : ''}</span></div>
    </div>
    <div class="legend"><span><i class="mk sup"></i> supports the claim</span><span><i class="mk con"></i> contradicts or qualifies it</span></div>
    ${raw((s.findings || []).map((f) => block(f, refs, s)).join(''))}
  </div>`;

  stage.querySelectorAll('[data-n]').forEach((el) => el.addEventListener('click', () => app.showSource(+el.dataset.n)));
  return null;
}

function block(f, refs, s) {
  const used = Array.from(new Set(f.findings.flatMap((x) => [...x.support, ...x.contradict]))).sort((a, b) => a - b);
  const level = Math.max(0, LEVELS.indexOf(f.consensus));
  const sq = (s.plan && s.plan.subQuestions || []).find((q) => q.id === f.subq);
  return html`<section class="ev-block" style="--qc:${qColor(f.subq)}">
    <div class="ev-head">
      <h2><small>${f.subq.toUpperCase()}</small>${(sq && sq.question) || f.question}</h2>
      <div class="consensus" title="How much the sources agree">
        <span class="steps">${raw(LEVELS.slice(1).map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join(''))}</span>
        <span>${f.consensus} consensus</span>
      </div>
    </div>
    ${raw(f.summary ? `<p class="ev-summary">${esc(f.summary)}</p>` : '')}
    ${raw(f.findings.length ? html`<div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>Claim</th><th>Strength</th>${raw(used.map((n) => {
        const p = refs.find((r) => r.n === n);
        return `<th class="n" data-n="${n}" title="${esc(p ? authorShort(p) + ', ' + (p.year || '') + ': ' + p.title : 'Source ' + n)}">${n}</th>`;
      }).join(''))}</tr></thead>
      <tbody>${raw(f.findings.map((x) => html`<tr>
        <td class="claim">${x.claim}${raw(x.evidence ? `<small>“${esc(x.evidence)}”</small>` : '')}</td>
        <td><span class="strength">${x.strength}</span></td>
        ${raw(used.map((n) => `<td class="cell">${x.support.includes(n) ? '<i class="mk sup" title="supports"></i>' : x.contradict.includes(n) ? '<i class="mk con" title="contradicts"></i>' : ''}</td>`).join(''))}
      </tr>`).join(''))}</tbody>
    </table></div>` : '<p class="ev-summary">No specific claims could be extracted for this sub-question; the evidence was too thin.</p>')}
  </section>`;
}
