// Pick the papers that make it into the review and queue open-access PDFs
// for the HTTP Request + Extract From File nodes that follow.
const state = $input.first().json;
const D = state.D;
const subs = state.plan.subQuestions;
const thisYear = new Date().getFullYear();

let items = [];
await stage(state, 'select', 'Choosing what to read in full', async () => {
  const rank = (p) =>
    (p.score || 0) * 10 +
    Math.log10((p.citedBy || 0) + 1) * 4 +
    (p.abstract ? 3 : 0) +
    (p.year && p.year >= thisYear - 5 ? 2 : 0) +
    (/review|meta/.test(p.kind || p.type || '') ? 2 : 0);
  const pool = state.papers.filter((p) => (p.score || 0) >= 5).sort((a, b) => rank(b) - rank(a));
  const chosen = [];
  const take = (p) => { if (p && !chosen.includes(p) && chosen.length < D.include) chosen.push(p); };
  // Guarantee breadth: the best two papers for every sub-question first.
  for (const s of subs) pool.filter((p) => (p.subq || []).includes(s.id)).slice(0, 2).forEach(take);
  pool.forEach(take);
  chosen.sort((a, b) => rank(b) - rank(a));
  chosen.forEach((p, i) => { p.n = i + 1; p.included = true; });
  state.references = chosen.map((p) => p.key);

  if (!chosen.length) {
    throw new Error('No relevant papers were found. Try rephrasing the question with the terms researchers would use, or pick a deeper search.');
  }

  const reliable = (u) => /arxiv\.org\/pdf|europepmc\.org|ncbi\.nlm\.nih\.gov\/pmc|biorxiv|medrxiv|\.pdf(\?|$)/i.test(u || '');
  const candidates = chosen.filter((p) => p.pdfUrl).sort((a, b) => (reliable(b.pdfUrl) ? 1 : 0) - (reliable(a.pdfUrl) ? 1 : 0)).slice(0, D.fullText);
  items = candidates.map((p) => ({ json: { pdfUrl: p.pdfUrl, key: p.key, n: p.n } }));
  if (!items.length) items = [{ json: { pdfUrl: '', key: null, skip: true } }];

  await emit(state, 'selected', {
    references: chosen.map(lightPaper),
    fullTextQueued: candidates.length,
  });
  await log(state, `Selected ${chosen.length} papers; downloading ${candidates.length} open-access PDFs`);
});

items[0].json.state = state;
return items;
