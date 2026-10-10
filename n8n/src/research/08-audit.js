// Audit the review: check cited sentences against the cited papers' own text.
const state = $input.first().json;

await stage(state, 'audit', 'Checking every citation against its source', async () => {
  const body = state.report.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const cited = [];
  for (const para of body.split(/\n{2,}/)) {
    for (const s of splitSentences(para.replace(/^[-*]\s+/gm, ''))) {
      const nums = parseCitations(s);
      if (nums.length) cited.push({ sentence: s, refs: nums, key: sentenceKey(s) });
    }
  }
  // Spread the budget evenly across the review.
  const max = state.D.auditMax;
  const step = cited.length > max ? cited.length / max : 1;
  const picked = [];
  for (let i = 0; i < cited.length && picked.length < max; i += step) picked.push(cited[Math.floor(i)]);

  for (const item of picked) {
    const claim = item.sentence.replace(/\[[\d,\s–-]+\]/g, '').trim();
    const hits = await retrieve(state.chunks, claim, 4, (c) => item.refs.includes(c.n));
    item.evidence = hits.map((c) => ({ n: c.n, text: clampText(c.text, 700) }));
  }

  await mapLimit(chunkArray(picked, 6), 3, async (batch) => {
    const listing = batch.map((it, i) => `Claim ${i}: ${it.sentence}\nCited: ${it.refs.join(', ')}\nSource passages:\n${it.evidence.map((e) => `[${e.n}] ${e.text}`).join('\n') || '(no passages found)'}`).join('\n\n---\n\n');
    try {
      const out = await llm({
        tier: 'fast',
        maxTokens: 1600,
        system: 'You are a strict fact-checker. Judge only whether the source passages support the claim as worded. Overstatement, wrong numbers or a wrong direction of effect is not support.',
        prompt: `${listing}\n\nReturn JSON: {"results":[{"i":0,"verdict":"supported | partial | unsupported","note":"under 20 words explaining the verdict","bestRef":paper number}]}\n"partial" means the gist is right but the claim overstates, generalises or adds detail the passages lack. "unsupported" means the passages do not back it or contradict it. If the passages are only an abstract that is consistent with the claim, use "supported".`,
        json: true,
      });
      for (const r of out.results || []) {
        const it = batch[r.i];
        if (!it) continue;
        it.verdict = ['supported', 'partial', 'unsupported'].includes(r.verdict) ? r.verdict : 'partial';
        it.note = String(r.note || '').slice(0, 200);
        it.bestRef = parseInt(r.bestRef, 10) || it.refs[0];
      }
    } catch (e) { /* leave unverified */ }
  });

  const checked = picked.filter((x) => x.verdict);
  const count = (v) => checked.filter((x) => x.verdict === v).length;
  const supported = count('supported');
  const partial = count('partial');
  state.audit = {
    totalCited: cited.length,
    checked: checked.length,
    supported,
    partial,
    unsupported: count('unsupported'),
    score: checked.length ? Math.round(((supported + 0.5 * partial) / checked.length) * 100) : null,
    items: checked.map((x) => ({ key: x.key, sentence: x.sentence, refs: x.refs, verdict: x.verdict, note: x.note, bestRef: x.bestRef, evidence: x.evidence.slice(0, 2).map((e) => ({ n: e.n, text: clampText(e.text, 320) })) })),
  };
  await emit(state, 'audit', { ...state.audit, items: undefined });
});

return [{ json: state }];
