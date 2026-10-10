// Extract structured evidence: one card per paper, and claim-level findings
// per sub-question, grounded in retrieved passages (RAG).
const state = $input.first().json;
const subs = state.plan.subQuestions;
const refs = state.references.map((k) => state.papers.find((p) => p.key === k));
const validN = new Set(refs.map((p) => p.n));
const cleanRefs = (arr) => uniq((Array.isArray(arr) ? arr : []).map((x) => parseInt(x, 10)).filter((n) => validN.has(n)));

await stage(state, 'extract', 'Extracting evidence from each paper', async () => {
  // 1) Paper cards
  await mapLimit(chunkArray(refs, 5), 3, async (batch) => {
    const blocks = [];
    for (const p of batch) {
      const passages = (await retrieve(state.chunks, state.question, 3, (c) => c.n === p.n))
        .filter((c) => !String(c.id).endsWith(':abs'))
        .map((c) => c.text);
      blocks.push(`[${p.n}] ${p.title} (${authorShort(p)}, ${p.year || 'n.d.'}; ${p.venue || 'venue unknown'})
Abstract: ${clampText(p.abstract || p.tldr || 'none', 1400)}
${passages.length ? 'Full-text passages:\n' + passages.map((t) => '> ' + clampText(t, 900)).join('\n') : ''}`);
    }
    try {
      const out = await llm({
        tier: 'fast',
        maxTokens: 2400,
        system: 'You write precise evidence cards for a systematic review. Use only the text provided. Keep numbers exactly as written.',
        prompt: `Review question: ${state.question}\n\n${blocks.join('\n\n')}\n\nReturn JSON: {"cards":[{"n":1,"tldr":"one plain sentence on what the paper found","studyType":"e.g. randomised trial, cohort, meta-analysis, benchmark evaluation, theoretical analysis, survey, method paper","method":"under 20 words","data":"population, dataset or corpus, under 15 words","keyResult":"the main result with numbers if given, under 35 words","limitations":"under 20 words; say 'not stated' if absent","stance":"supports | challenges | mixed | context — relative to the review question"}]}`,
        json: true,
      });
      for (const c of out.cards || []) {
        const p = batch.find((x) => x.n === parseInt(c.n, 10));
        if (p) p.card = { tldr: c.tldr || '', studyType: c.studyType || '', method: c.method || '', data: c.data || '', keyResult: c.keyResult || '', limitations: c.limitations || '', stance: c.stance || 'context' };
      }
    } catch (e) {
      await log(state, 'One batch of evidence cards failed; those papers keep their abstracts only', { error: true });
    }
    for (const p of batch) if (!p.card) p.card = { tldr: p.tldr || clampText(p.abstract, 200), studyType: p.kind || '', method: '', data: '', keyResult: '', limitations: '', stance: 'context' };
  });
  await emit(state, 'cards', { cards: refs.map((p) => ({ n: p.n, ...p.card })) });

  // 2) Findings per sub-question
  state.findings = await mapLimit(subs, 3, async (s) => {
    const passages = await retrieve(state.chunks, [s.question, ...s.queries].join(' '), 16);
    const ctx = passages.map((c) => {
      const p = refs.find((x) => x.n === c.n);
      return `[${c.n}] (${authorShort(p)}, ${p.year || 'n.d.'}) ${clampText(c.text, 1000)}`;
    }).join('\n\n');
    try {
      const out = await llm({
        tier: 'main',
        maxTokens: 2600,
        system: 'You are a careful scientist extracting claims from source passages. Every claim must be traceable to the passages. Never invent numbers, and say so when evidence is thin.',
        prompt: `Sub-question: ${s.question}\n\nPassages (the number in brackets identifies the paper):\n${ctx}\n\nReturn JSON:
{"summary":"2 to 3 sentences answering the sub-question from this evidence",
 "consensus":"strong | moderate | mixed | weak | insufficient",
 "findings":[{"claim":"one specific, falsifiable statement","support":[paper numbers that support it],"contradict":[paper numbers that contradict or qualify it],"evidence":"a short verbatim excerpt (under 30 words) from one passage that backs the claim","strength":"strong | moderate | weak"}]}
Write 3 to 6 findings. Include at least one finding about limitations or disagreement if the passages show any.`,
        json: true,
      });
      return {
        subq: s.id,
        question: s.question,
        summary: String(out.summary || ''),
        consensus: String(out.consensus || 'insufficient'),
        findings: (out.findings || []).map((f) => ({
          claim: String(f.claim || ''),
          support: cleanRefs(f.support),
          contradict: cleanRefs(f.contradict),
          evidence: clampText(f.evidence || '', 260),
          strength: String(f.strength || 'moderate'),
        })).filter((f) => f.claim && (f.support.length || f.contradict.length)),
      };
    } catch (e) {
      await log(state, `Could not extract findings for ${s.id}`, { error: true });
      return { subq: s.id, question: s.question, summary: '', consensus: 'insufficient', findings: [] };
    }
  });
  await emit(state, 'findings', { findings: state.findings });
});

return [{ json: state }];
