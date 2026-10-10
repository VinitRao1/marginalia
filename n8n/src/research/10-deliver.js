// Build the citation map and deliver the finished session to the studio.
const state = $input.first().json;

let summary = {};
await stage(state, 'deliver', 'Assembling the session', async () => {
  const included = state.references.map((k) => state.papers.find((p) => p.key === k));
  const related = state.papers
    .filter((p) => !p.included && (p.score || 0) >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
  const nodes = [...included, ...related];
  const byOa = new Map(nodes.filter((p) => p.ids && p.ids.openalex).map((p) => [p.ids.openalex, p]));

  const edges = [];
  const seenEdge = new Set();
  const addEdge = (a, b, kind, w) => {
    if (a.key === b.key) return;
    const id = [a.key, b.key].sort().join('|') + kind;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    edges.push({ source: a.key, target: b.key, kind, weight: w });
  };
  // Real citation links from OpenAlex reference lists.
  for (const p of nodes) for (const r of p.refs || []) { const q = byOa.get(r); if (q) addEdge(p, q, 'cites', 1); }
  // Topical similarity links so papers without citation data still cluster.
  const toks = nodes.map((p) => uniq(tokenize(p.title + ' ' + (p.abstract || '').slice(0, 700))));
  nodes.forEach((p, i) => {
    const sims = nodes.map((q, j) => ({ j, s: i === j ? 0 : jaccard(toks[i], toks[j]) })).sort((a, b) => b.s - a.s).slice(0, 2);
    for (const { j, s } of sims) if (s >= 0.1) addEdge(p, nodes[j], 'similar', Math.round(s * 100) / 100);
  });

  const paperOut = (p) => ({
    key: p.key, n: p.n || null, title: p.title, authors: (p.authors || []).slice(0, 12), year: p.year, venue: p.venue,
    doi: p.doi, url: p.url, pdfUrl: p.pdfUrl, citedBy: p.citedBy, sources: p.sources, ids: p.ids,
    abstract: p.abstract, tldr: p.tldr, score: p.score, subq: p.subq || [], kind: p.kind || p.type || '', reason: p.reason || '',
    included: !!p.included, hasFullText: !!p.hasFullText, pages: p.pages || null, card: p.card || null,
    foundBy: (p.foundBy || []).slice(0, 4),
  });

  const durationMs = Date.now() - state.startedAt;
  const stats = {
    found: state.papers.length,
    screened: state.papers.filter((p) => (p.score || 0) > 0).length,
    relevant: state.papers.filter((p) => (p.score || 0) >= 6).length,
    included: included.length,
    fullText: state.fullTextCount || 0,
    rounds: state.round,
    queries: state.queriesRun.length,
    snowballed: state.snowballed.length,
    chunks: state.chunks.length,
    sources: state.sourceStats,
    llmCalls: state.usage.calls,
    tokens: state.usage.inputTokens + state.usage.outputTokens,
    durationMs,
  };

  const result = {
    question: state.question,
    depth: state.depth,
    title: state.plan.title,
    plan: state.plan,
    sources: state.sources,
    bottomLine: state.bottomLine,
    report: state.report,
    findings: state.findings,
    audit: state.audit,
    podcast: state.podcast,
    coverageHistory: state.coverageHistory,
    papers: state.papers.filter((p) => p.included || (p.score || 0) >= 5).map(paperOut),
    references: state.references,
    graph: { nodes: nodes.map((p) => p.key), edges },
    chunks: state.chunks.map((c) => ({ id: c.id, n: c.n, text: c.text })),
    stats,
  };
  await emit(state, 'result', result);
  summary = { ok: true, sessionId: state.sessionId, stats };
});

return [{ json: summary }];
