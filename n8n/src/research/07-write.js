// Write the cited literature review.
const state = $input.first().json;
const refs = state.references.map((k) => state.papers.find((p) => p.key === k));
const maxN = refs.length;

await stage(state, 'write', 'Writing the review', async () => {
  const bib = refs.map((p) => {
    const c = p.card || {};
    return `[${p.n}] ${authorShort(p)} (${p.year || 'n.d.'}). ${p.title}. ${p.venue || ''}
    Type: ${c.studyType || p.kind || 'unknown'}. Finding: ${c.keyResult || c.tldr || clampText(p.abstract, 240)} Limitations: ${c.limitations || 'not stated'}. Stance: ${c.stance || 'context'}.`;
  }).join('\n');
  const evidence = state.findings.map((f) => `### ${f.subq}: ${f.question}\nConsensus: ${f.consensus}\nSummary: ${f.summary}\n${f.findings.map((x) => `- ${x.claim} (supports: ${x.support.join(', ') || 'none'}; contradicts: ${x.contradict.join(', ') || 'none'}; strength: ${x.strength})`).join('\n')}`).join('\n\n');

  let md = await llm({
    tier: 'main',
    maxTokens: 7000,
    temperature: 0.35,
    system: 'You are an expert reviewer writing an evidence synthesis for an intelligent non-specialist. You are precise, calibrated and fair: you separate strong evidence from weak, give disagreement its due, and never cite a source for something it does not say.',
    prompt: `Question: ${state.question}

Numbered sources:
${bib}

Extracted evidence by sub-question:
${evidence}

Write the review in Markdown, ${state.D.words} words, using exactly these level-2 headings in this order:
## Bottom line
## Background
## What the evidence says
## Where studies disagree
## How good is the evidence
## Open questions
## Conclusion

Under "What the evidence says", use a level-3 heading for each sub-question, phrased as a short plain-English statement of the answer (not the question).

Citation rules:
- Cite with bracketed source numbers only, for example [3] or [2, 7]. Never use author-year citations or a reference list; the app renders references itself.
- Every sentence that states a finding carries at least one citation. Only cite a source for what its card or the evidence says.
- Use only sources 1 to ${maxN}.

Style: "Bottom line" is 2 to 3 sentences that directly answer the question and state confidence (high, moderate or low) with the reason. Prefer concrete numbers and named methods. No bullet lists except in "Open questions". No preamble before the first heading.`,
  });

  md = String(md).replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Drop citations to sources that don't exist.
  md = md.replace(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g, (m) => {
    const nums = parseCitations(m).filter((n) => n >= 1 && n <= maxN);
    return nums.length ? '[' + nums.join(', ') + ']' : '';
  });
  const bl = md.match(/##\s*Bottom line\s*\n+([\s\S]*?)(\n##\s|$)/i);
  state.report = md;
  state.bottomLine = bl ? bl[1].trim() : '';
  state.reportWords = md.split(/\s+/).length;
  await emit(state, 'report', { markdown: md, words: state.reportWords });
});

return [{ json: state }];
