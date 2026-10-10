// Search the literature for this round's queries, then snowball through citations.
// This node sits inside a loop: "Screen & find gaps" sends new queries back here.
const state = $input.first().json;
state.round = (state.round || 0) + 1;
state.continueSearch = false;

await stage(state, 'search', `Searching the literature, round ${state.round}`, async () => {
  const seen = new Set(state.queriesRun.map((q) => q.toLowerCase()));
  const queries = (state.pendingQueries || []).filter((x) => x.q && !seen.has(x.q.toLowerCase()));
  const perSource = state.D.perSource;
  let newCount = 0;
  let failures = 0;
  let attempts = 0;

  const runOne = async (source, item) => {
    attempts++;
    try {
      const results = await SEARCHERS[source](item.q, perSource);
      results.forEach((p) => { p.foundBy = [{ q: item.q, subq: item.subq, round: state.round, source }]; });
      // Merge as results arrive so the studio can show papers landing live.
      const added = mergePapers(state.papers, results);
      newCount += added.length;
      state.sourceStats[source] = (state.sourceStats[source] || 0) + results.length;
      await emit(state, 'papers', { round: state.round, added: added.map(lightPaper), total: state.papers.length });
      await log(state, `${SOURCE_LABELS[source]}: ${results.length} results for “${item.q}”, ${added.length} new`, { source, count: results.length, q: item.q, subq: item.subq });
    } catch (err) {
      failures++;
      const why = err.status === 429 ? 'rate limited; an API key raises the limit' : String(err.message || err).slice(0, 140);
      await log(state, `${SOURCE_LABELS[source]} skipped “${item.q}” (${why})`, { source, error: true, q: item.q });
    }
  };

  const parallelSources = state.sources.filter((s) => s !== 'arxiv');
  const jobs = [];
  for (const s of parallelSources) for (const item of queries) jobs.push([s, item]);
  const arxivJob = async () => {
    if (!state.sources.includes('arxiv')) return;
    for (const item of queries) {
      await runOne('arxiv', item);
      await sleep(1100); // arXiv asks clients to pace requests
    }
  };
  await Promise.all([mapLimit(jobs, 4, ([s, item]) => runOne(s, item)), arxivJob()]);

  // Citation snowballing (forward + backward) from the strongest papers so far.
  const snowFrom = (state.snowballFrom || []).filter((id) => !state.snowballed.includes(id));
  if (snowFrom.length && state.sources.includes('openalex')) {
    await mapLimit(snowFrom, 3, async (id) => {
      try {
        const nb = await openAlexNeighbours(id, Math.ceil(perSource / 2));
        const tag = (p, dir) => { p.foundBy = [{ q: dir + ' of ' + id, subq: null, round: state.round, source: 'openalex', snowball: dir }]; return p; };
        const added = mergePapers(state.papers, [...nb.citing.map((p) => tag(p, 'cites')), ...nb.references.map((p) => tag(p, 'cited by'))]);
        newCount += added.length;
        state.snowballed.push(id);
        const seed = state.papers.find((p) => p.ids && p.ids.openalex === id);
        await emit(state, 'papers', { round: state.round, added: added.map(lightPaper), total: state.papers.length });
        await log(state, `Followed citations from “${clampText(seed ? seed.title : id, 60)}”: ${nb.citing.length} citing works, ${nb.references.length} references, ${added.length} new`, { snowball: true });
      } catch (e) { /* snowballing is best-effort */ }
    });
  }

  state.queriesRun.push(...queries.map((x) => x.q));
  state.pendingQueries = [];
  state.snowballFrom = [];

  if (state.round === 1 && attempts > 0 && failures === attempts) {
    throw new Error('None of the scholarly sources could be reached. Check the n8n container has internet access, then try again.');
  }

  await log(state, `Round ${state.round} added ${newCount} new papers; ${state.papers.length} in total`);
});

return [{ json: state }];
