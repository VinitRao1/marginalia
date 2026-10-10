// Screen new papers for relevance, measure coverage per sub-question and
// decide whether another (recursive) search round is needed.
const state = $input.first().json;
const D = state.D;
const subs = state.plan.subQuestions;

await stage(state, 'screen', `Screening papers, round ${state.round}`, async () => {
  const unscreened = state.papers.filter((p) => p.score == null);

  // Cheap lexical pre-filter so the model only reads plausible candidates.
  const queryText = [state.question, ...state.plan.keyTerms, ...subs.map((s) => s.question)].join(' ');
  const index = buildBM25(unscreened.map((p) => ({ key: p.key, text: p.title + ' ' + p.title + ' ' + (p.abstract || p.tldr || '') })));
  const ranked = bm25Search(index, queryText, D.screenTop);
  const shortlist = new Set(ranked.map((r) => r.doc.key));
  for (const p of unscreened) {
    if (!shortlist.has(p.key)) { p.score = 0; p.reason = 'Low overlap with the question'; p.subq = []; }
  }
  const toRate = unscreened.filter((p) => shortlist.has(p.key));
  await log(state, `Reading ${toRate.length} of ${unscreened.length} new papers closely`);

  const subList = subs.map((s) => `${s.id}: ${s.question}`).join('\n');
  await mapLimit(chunkArray(toRate, 14), 3, async (batch) => {
    const listing = batch.map((p, i) => `[${i}] ${p.title} (${p.year || 'n.d.'}${p.venue ? ', ' + p.venue : ''})\n${clampText(p.abstract || p.tldr || 'No abstract available.', 650)}`).join('\n\n');
    try {
      const out = await llm({
        tier: 'fast',
        maxTokens: 1800,
        system: 'You screen papers for a systematic review. Be strict: a paper is relevant only if its findings bear directly on the question or a sub-question.',
        prompt: `Main question: ${state.question}\nSub-questions:\n${subList}\n\nPapers:\n${listing}\n\nRate every paper. Return JSON: {"ratings":[{"i":0,"score":0-10,"subq":["q1"],"kind":"empirical|review|meta-analysis|theory|method|benchmark|other","reason":"under 15 words"}]}\nScore 8-10: directly answers a sub-question with evidence. 5-7: useful context. 0-4: off-topic.`,
        json: true,
      });
      for (const r of out.ratings || []) {
        const p = batch[r.i];
        if (!p) continue;
        p.score = Math.max(0, Math.min(10, Number(r.score) || 0));
        p.subq = (r.subq || []).filter((id) => subs.some((s) => s.id === id));
        p.kind = r.kind || '';
        p.reason = String(r.reason || '').slice(0, 140);
      }
    } catch (e) {
      await log(state, 'One screening batch failed; falling back to keyword relevance for it', { error: true });
    }
    for (const p of batch) {
      if (p.score == null) {
        const hit = ranked.find((r) => r.doc.key === p.key);
        p.score = hit ? Math.min(6, Math.round(hit.score)) : 2;
        p.subq = p.subq || [];
        p.reason = p.reason || 'Keyword match';
      }
    }
  });

  const coverage = {};
  for (const s of subs) coverage[s.id] = state.papers.filter((p) => p.score >= 6 && (p.subq || []).includes(s.id)).length;
  const gaps = subs.filter((s) => coverage[s.id] < D.minPerSubq);
  const relevant = state.papers.filter((p) => p.score >= 6).length;

  let followups = [];
  state.continueSearch = state.round < D.rounds;
  if (state.continueSearch) {
    const found = state.papers.filter((p) => p.score >= 6).sort((a, b) => b.score - a.score).slice(0, 25)
      .map((p) => `- ${p.title} (${(p.subq || []).join(',')})`).join('\n');
    const targets = gaps.length ? gaps : subs;
    try {
      const out = await llm({
        tier: 'main',
        maxTokens: 1200,
        system: 'You are a research librarian refining a literature search after a first pass.',
        prompt: `Question: ${state.question}\n\nSub-questions with the number of relevant papers found so far:\n${subs.map((s) => `${s.id} (${coverage[s.id]} papers): ${s.question}`).join('\n')}\n\nRelevant papers found so far:\n${found || '(none yet)'}\n\nQueries already run:\n${state.queriesRun.slice(-30).join('\n')}\n\nWrite follow-up queries for these sub-questions: ${targets.map((s) => s.id).join(', ')}. Use different terminology from the queries already run: synonyms, adjacent fields, named methods or datasets that appear in the papers above, and queries that would find contradicting evidence.\nReturn JSON: {"queries":[{"subq":"q2","q":"3 to 7 word query"}],"note":"one sentence on what is missing"}\nAt most ${Math.min(8, targets.length * 2)} queries.`,
        json: true,
      });
      followups = (out.queries || []).filter((x) => x && x.q).map((x) => ({ q: String(x.q).trim(), subq: subs.some((s) => s.id === x.subq) ? x.subq : targets[0].id })).slice(0, 8);
      state.gapNote = String(out.note || '');
    } catch (e) {
      followups = targets.map((s) => ({ q: s.question.split(/\s+/).slice(0, 8).join(' '), subq: s.id }));
    }
    state.pendingQueries = followups;
    state.snowballFrom = state.papers
      .filter((p) => p.score >= 7 && p.ids && p.ids.openalex && !state.snowballed.includes(p.ids.openalex))
      .sort((a, b) => (b.score * 100 + (b.citedBy || 0) / 100) - (a.score * 100 + (a.citedBy || 0) / 100))
      .slice(0, 3)
      .map((p) => p.ids.openalex);
    if (!followups.length && !state.snowballFrom.length) state.continueSearch = false;
  }

  const entry = { round: state.round, coverage, gaps: gaps.map((s) => s.id), relevant, total: state.papers.length, followups, continue: state.continueSearch, note: state.gapNote || '' };
  state.coverageHistory.push(entry);
  await emit(state, 'coverage', entry);
  await emit(state, 'screened', {
    round: state.round,
    papers: state.papers.filter((p) => p.score != null && p.score >= 5).map((p) => ({ key: p.key, score: p.score, subq: p.subq, reason: p.reason })),
  });
});

return [{ json: state }];
