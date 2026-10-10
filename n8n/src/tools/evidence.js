// Voice tool: go find new evidence live, mid-conversation.
const req = $input.first().json.body || {};
requireToken(req);
const query = String(req.query || '').trim();
const question = String(req.question || query);
const exclude = new Set((req.exclude || []).map((t) => normTitle(t)));
const sources = chooseSources(req.domain || 'general', req.sources);

let result;
if (!query) {
  result = { ok: false, error: 'No search query was given.' };
} else {
  const found = [];
  await Promise.all(sources.map(async (s) => {
    try { found.push(...(await SEARCHERS[s](query, s === 'arxiv' ? 6 : 8))); } catch (e) { /* skip unreachable source */ }
  }));
  const papers = [];
  mergePapers(papers, found);
  const fresh = papers.filter((p) => !exclude.has(normTitle(p.title)) && (p.abstract || p.tldr));
  const index = buildBM25(fresh.map((p) => ({ key: p.key, text: p.title + ' ' + p.title + ' ' + (p.abstract || p.tldr) })));
  const top = bm25Search(index, query + ' ' + question, 12).map((r) => fresh.find((p) => p.key === r.doc.key));

  let picks = [];
  if (top.length) {
    const listing = top.map((p, i) => `[${i}] ${p.title} (${authorShort(p)}, ${p.year || 'n.d.'})\n${clampText(p.abstract || p.tldr, 500)}`).join('\n\n');
    try {
      const out = await llm({
        tier: 'fast',
        maxTokens: 1000,
        system: 'You triage newly found papers for someone debating a research question.',
        prompt: `Debate question: ${question}\nWhat they asked to find: ${query}\n\n${listing}\n\nReturn JSON: {"picks":[{"i":0,"relevance":0-10,"stance":"supports | challenges | neutral","why":"under 20 words, speakable"}]}`,
        json: true,
      });
      picks = (out.picks || []).filter((x) => top[x.i] && Number(x.relevance) >= 5).sort((a, b) => b.relevance - a.relevance).slice(0, 5);
    } catch (e) {
      picks = top.slice(0, 5).map((p, i) => ({ i, relevance: 5, stance: 'neutral', why: 'Keyword match' }));
    }
  }
  result = {
    ok: true,
    query,
    papers: picks.map((x) => {
      const p = top[x.i];
      return { key: p.key, title: p.title, authors: p.authors.slice(0, 6), year: p.year, venue: p.venue, doi: p.doi, url: p.url, citedBy: p.citedBy, abstract: clampText(p.abstract || p.tldr, 900), sources: p.sources, stance: x.stance, why: x.why, relevance: x.relevance };
    }),
  };
}

return [{ json: result }];
