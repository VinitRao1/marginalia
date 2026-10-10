// Voice tool: verify a claim the user (or the agent) made against the cited papers.
// Called mid-conversation, so it favours the fast model and a tight context.
const req = $input.first().json.body || {};
requireToken(req);
const claim = String(req.claim || '').trim();
const papers = Array.isArray(req.papers) ? req.papers : [];
const chunks = (Array.isArray(req.chunks) ? req.chunks : []).filter((c) => c && c.text);

let result;
if (!claim) {
  result = { ok: false, error: 'No claim was given to verify.' };
} else if (!chunks.length) {
  result = { ok: true, verdict: 'not_found', confidence: 0, explanation: 'There are no source passages for those papers in this session, so I cannot check that claim.', evidence: [] };
} else {
  const cited = (req.citations || []).map((n) => parseInt(n, 10)).filter(Boolean);
  const filter = cited.length ? (c) => cited.includes(c.n) : undefined;
  let hits = await retrieve(chunks, claim, 6, filter);
  if (!hits.length && filter) hits = await retrieve(chunks, claim, 6);
  const label = (n) => {
    const p = papers.find((x) => x.n === n);
    return p ? `${authorShort(p)} ${p.year || ''}`.trim() : 'source ' + n;
  };
  const ctx = hits.map((c) => `[${c.n}] (${label(c.n)}) ${clampText(c.text, 900)}`).join('\n\n');
  const out = await llm({
    tier: 'fast',
    maxTokens: 900,
    system: 'You are a rigorous fact-checker helping someone debate a research review out loud. Judge the claim only against the passages. Your explanation will be spoken, so keep it natural and short.',
    prompt: `Claim: "${claim}"\n${cited.length ? 'The claim cites sources: ' + cited.join(', ') + '\n' : ''}\nPassages:\n${ctx || '(none)'}\n\nReturn JSON: {"verdict":"supported | partial | unsupported | not_found","confidence":0.0-1.0,"explanation":"one or two spoken sentences naming the paper by author and year","evidence":[{"n":paper number,"quote":"verbatim excerpt under 30 words"}]}`,
    json: true,
  });
  const verdicts = ['supported', 'partial', 'unsupported', 'not_found'];
  result = {
    ok: true,
    claim,
    verdict: verdicts.includes(out.verdict) ? out.verdict : 'partial',
    confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0.5)),
    explanation: String(out.explanation || ''),
    evidence: (out.evidence || []).slice(0, 3).map((e) => ({ n: parseInt(e.n, 10) || null, quote: clampText(e.quote || '', 240) })),
    passages: hits.slice(0, 3).map((c) => ({ n: c.n, text: clampText(c.text, 400) })),
  };
}

return [{ json: result }];
