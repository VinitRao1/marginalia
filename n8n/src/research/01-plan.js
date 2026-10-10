// Plan the research: decompose the question into sub-questions and search queries.
const incoming = $input.first().json;
const req = incoming.body && typeof incoming.body === 'object' ? incoming.body : incoming;

requireToken(req);
const question = String(req.question || '').trim();
if (!question) throw new Error('The request has no "question".');
const depth = DEPTHS[req.depth] ? req.depth : 'standard';
const D = DEPTHS[depth];

const state = {
  sessionId: req.sessionId || 'run-' + Date.now(),
  question,
  depth,
  D,
  requestedSources: req.sources || null,
  callbackUrl: req.callbackUrl || '',
  callbackSecret: req.callbackSecret || '',
  startedAt: Date.now(),
  round: 0,
  papers: [],
  queriesRun: [],
  pendingQueries: [],
  snowballed: [],
  snowballFrom: [],
  coverageHistory: [],
  sourceStats: {},
  usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
};

await stage(state, 'plan', 'Breaking the question apart', async () => {
  const plan = await llm({
    tier: 'main',
    maxTokens: 2200,
    system:
      'You are a senior research librarian who designs systematic literature searches. You know how academics phrase titles and abstracts in every field, and you design searches that surface mechanisms, empirical evidence, competing explanations and limitations, not just confirming studies.',
    prompt: `Research question:
"""${question}"""

Design the search. Return JSON with exactly this shape:
{
  "title": "a short title for this review, at most 8 words",
  "domain": "one of: biomedical, computing, physical-sciences, social-sciences, humanities, general",
  "scope": "one sentence on what is in and out of scope",
  "keyTerms": ["6 to 10 technical terms and synonyms researchers use"],
  "subQuestions": [
    { "id": "q1", "question": "a focused sub-question", "why": "what answering it contributes, under 20 words",
      "queries": ["academic search query of 3 to 7 words"] }
  ]
}

Rules:
- Exactly ${D.subq} sub-questions, each with exactly ${D.queriesPerSubq} queries.
- Together the sub-questions must cover: the core effect or claim, mechanisms or explanations, the strength and quality of the evidence, and where evidence conflicts or is missing.
- Queries use the vocabulary found in paper titles and abstracts. No boolean operators, quotes or site filters. Vary terminology between queries.`,
    json: true,
  });

  const subs = (Array.isArray(plan.subQuestions) ? plan.subQuestions : []).slice(0, D.subq + 1).map((s, i) => ({
    id: 'q' + (i + 1),
    question: String(s.question || '').trim(),
    why: String(s.why || '').trim(),
    queries: (Array.isArray(s.queries) ? s.queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, D.queriesPerSubq + 1),
  })).filter((s) => s.question);
  if (!subs.length) {
    subs.push({ id: 'q1', question, why: 'Direct evidence on the question', queries: [question.slice(0, 120)] });
  }
  subs.forEach((s) => { if (!s.queries.length) s.queries = [s.question.slice(0, 120)]; });

  state.plan = {
    title: String(plan.title || question).slice(0, 90),
    domain: String(plan.domain || 'general').toLowerCase(),
    scope: String(plan.scope || ''),
    keyTerms: (plan.keyTerms || []).map(String).slice(0, 12),
    subQuestions: subs,
  };
  state.sources = chooseSources(state.plan.domain, state.requestedSources);
  state.pendingQueries = subs.flatMap((s) => s.queries.map((q) => ({ q, subq: s.id })));

  await emit(state, 'plan', { ...state.plan, sources: state.sources, depth, depthLabel: D.label });
});

return [{ json: state }];
