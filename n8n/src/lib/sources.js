// ─── Scholarly sources: OpenAlex, arXiv, Semantic Scholar, Europe PMC ───────

const SOURCE_LABELS = { openalex: 'OpenAlex', arxiv: 'arXiv', semanticscholar: 'Semantic Scholar', europepmc: 'Europe PMC' };

function cleanDoi(doi) {
  if (!doi) return '';
  return String(doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '').trim();
}

function arxivIdFrom(str) {
  if (!str) return '';
  const s = String(str).toLowerCase();
  let m = s.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/);
  if (m) return m[1];
  m = s.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (m) return m[1];
  m = s.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  return m ? m[1] : '';
}

function emptyPaper() {
  return {
    key: '', title: '', authors: [], year: null, venue: '', abstract: '', tldr: '',
    doi: '', url: '', pdfUrl: '', citedBy: null, sources: [], ids: {}, refs: [], type: '', foundBy: [],
  };
}

function finishPaper(p) {
  p.doi = cleanDoi(p.doi);
  const ax = p.ids.arxiv || arxivIdFrom(p.doi) || arxivIdFrom(p.url);
  if (ax) {
    p.ids.arxiv = ax;
    if (!p.pdfUrl) p.pdfUrl = getConfig().urls.arxivPdf + '/' + ax;
    if (!p.url) p.url = 'https://arxiv.org/abs/' + ax;
  }
  if (!p.url && p.doi) p.url = 'https://doi.org/' + p.doi;
  p.title = decodeEntities(stripTags(p.title)).replace(/\s+/g, ' ').trim();
  p.abstract = clampText(decodeEntities(stripTags(p.abstract)), 2400);
  p.key = p.doi && !arxivIdFrom(p.doi) ? 'doi:' + p.doi : ax ? 'arxiv:' + ax : 'title:' + normTitle(p.title);
  return p;
}

// OpenAlex ------------------------------------------------------------------

function openAlexAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(inv)) for (const pos of positions) words[pos] = word;
  return words.filter(Boolean).join(' ');
}

const OPENALEX_SELECT = 'id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,cited_by_count,abstract_inverted_index,referenced_works,type,ids';

function fromOpenAlex(w) {
  const p = emptyPaper();
  p.title = w.display_name || w.title || '';
  p.year = w.publication_year || null;
  p.authors = (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean);
  p.venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '';
  p.abstract = openAlexAbstract(w.abstract_inverted_index);
  p.doi = w.doi || '';
  p.citedBy = typeof w.cited_by_count === 'number' ? w.cited_by_count : null;
  p.pdfUrl = (w.best_oa_location && w.best_oa_location.pdf_url) || (w.primary_location && w.primary_location.pdf_url) || '';
  p.url = (w.primary_location && w.primary_location.landing_page_url) || '';
  p.ids.openalex = String(w.id || '').replace('https://openalex.org/', '');
  if (w.ids && w.ids.pmid) p.ids.pmid = String(w.ids.pmid).replace(/\D/g, '');
  p.refs = (w.referenced_works || []).map((r) => String(r).replace('https://openalex.org/', ''));
  p.type = w.type || '';
  p.sources = ['openalex'];
  return finishPaper(p);
}

function openAlexAuth(C) {
  return { mailto: C.contactEmail || undefined, api_key: C.keys.openalex || undefined };
}

async function searchOpenAlex(q, n) {
  const C = getConfig();
  const res = await http({
    url: C.urls.openalex + '/works',
    query: { search: q, 'per-page': n, select: OPENALEX_SELECT, ...openAlexAuth(C) },
    timeout: 25000,
  });
  return (res.results || []).map(fromOpenAlex);
}

/** Snowballing: works that cite `id` (forward) and works `id` cites (backward). */
async function openAlexNeighbours(id, n = 6) {
  const C = getConfig();
  const common = { 'per-page': n, select: OPENALEX_SELECT, sort: 'cited_by_count:desc', ...openAlexAuth(C) };
  const [citing, cited] = await Promise.all([
    http({ url: C.urls.openalex + '/works', query: { ...common, filter: 'cites:' + id }, timeout: 25000 }).catch(() => ({ results: [] })),
    http({ url: C.urls.openalex + '/works', query: { ...common, filter: 'cited_by:' + id }, timeout: 25000 }).catch(() => ({ results: [] })),
  ]);
  return {
    citing: (citing.results || []).map(fromOpenAlex),
    references: (cited.results || []).map(fromOpenAlex),
  };
}

// arXiv -----------------------------------------------------------------------

function arxivQuery(q) {
  const terms = String(q).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 6);
  if (!terms.length) return 'all:' + encodeURIComponent(q);
  return terms.map((t) => 'all:' + t).join(' AND ');
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

async function searchArxiv(q, n) {
  const C = getConfig();
  const xml = await http({
    url: C.urls.arxiv + '/api/query',
    query: { search_query: arxivQuery(q), start: 0, max_results: n, sortBy: 'relevance' },
    responseType: 'text',
    timeout: 30000,
  });
  const entries = String(xml).split(/<entry>/i).slice(1);
  return entries.map((e) => {
    const p = emptyPaper();
    const idUrl = xmlTag(e, 'id');
    p.ids.arxiv = arxivIdFrom(idUrl);
    p.title = xmlTag(e, 'title');
    p.abstract = xmlTag(e, 'summary');
    const published = xmlTag(e, 'published');
    p.year = published ? parseInt(published.slice(0, 4), 10) : null;
    p.authors = Array.from(e.matchAll(/<name>([\s\S]*?)<\/name>/gi)).map((m) => decodeEntities(m[1]).trim());
    p.doi = xmlTag(e, 'arxiv:doi');
    p.venue = xmlTag(e, 'arxiv:journal_ref') || 'arXiv';
    p.url = p.ids.arxiv ? 'https://arxiv.org/abs/' + p.ids.arxiv : idUrl;
    p.pdfUrl = p.ids.arxiv ? C.urls.arxivPdf + '/' + p.ids.arxiv : '';
    p.type = 'preprint';
    p.sources = ['arxiv'];
    return finishPaper(p);
  }).filter((p) => p.title);
}

// Semantic Scholar ----------------------------------------------------------

async function searchSemanticScholar(q, n) {
  const C = getConfig();
  const headers = C.keys.semanticScholar ? { 'x-api-key': C.keys.semanticScholar } : {};
  const res = await http({
    url: C.urls.semanticScholar + '/graph/v1/paper/search',
    query: { query: q, limit: n, fields: 'title,abstract,year,authors,venue,citationCount,externalIds,openAccessPdf,url,publicationTypes,tldr' },
    headers,
    timeout: 25000,
    retries: C.keys.semanticScholar ? 2 : 3,
  });
  return (res.data || []).map((r) => {
    const p = emptyPaper();
    const ext = r.externalIds || {};
    p.title = r.title || '';
    p.abstract = r.abstract || '';
    p.tldr = (r.tldr && r.tldr.text) || '';
    p.year = r.year || null;
    p.authors = (r.authors || []).map((a) => a.name).filter(Boolean);
    p.venue = r.venue || '';
    p.citedBy = typeof r.citationCount === 'number' ? r.citationCount : null;
    p.doi = ext.DOI || '';
    if (ext.ArXiv) p.ids.arxiv = ext.ArXiv;
    if (ext.PubMed) p.ids.pmid = String(ext.PubMed);
    p.ids.s2 = r.paperId || '';
    p.pdfUrl = (r.openAccessPdf && r.openAccessPdf.url) || '';
    p.url = r.url || '';
    p.type = (r.publicationTypes || []).join(',').toLowerCase();
    p.sources = ['semanticscholar'];
    return finishPaper(p);
  }).filter((p) => p.title);
}

// Europe PMC ------------------------------------------------------------------

async function searchEuropePMC(q, n) {
  const C = getConfig();
  const res = await http({
    url: C.urls.europepmc + '/europepmc/webservices/rest/search',
    query: { query: q, format: 'json', resultType: 'core', pageSize: n, synonym: 'true' },
    timeout: 25000,
  });
  const rows = (res.resultList && res.resultList.result) || [];
  return rows.map((r) => {
    const p = emptyPaper();
    p.title = r.title || '';
    p.abstract = r.abstractText || '';
    p.year = r.pubYear ? parseInt(r.pubYear, 10) : null;
    p.authors = (r.authorList && r.authorList.author ? r.authorList.author.map((a) => a.fullName) : String(r.authorString || '').split(/,\s*/)).filter(Boolean);
    p.venue = (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || r.journalTitle || '';
    p.doi = r.doi || '';
    p.citedBy = typeof r.citedByCount === 'number' ? r.citedByCount : null;
    if (r.pmid) p.ids.pmid = String(r.pmid);
    if (r.pmcid) p.ids.pmcid = r.pmcid;
    const urls = (r.fullTextUrlList && r.fullTextUrlList.fullTextUrl) || [];
    const pdf = urls.find((u) => u.documentStyle === 'pdf' && /open|free/i.test(u.availability || ''));
    p.pdfUrl = pdf ? pdf.url : r.pmcid ? 'https://europepmc.org/articles/' + r.pmcid + '?pdf=render' : '';
    p.url = r.pmcid ? 'https://europepmc.org/article/PMC/' + r.pmcid : r.pmid ? 'https://pubmed.ncbi.nlm.nih.gov/' + r.pmid + '/' : '';
    p.type = String(r.pubType || '').toLowerCase();
    p.sources = ['europepmc'];
    return finishPaper(p);
  }).filter((p) => p.title);
}

const SEARCHERS = {
  openalex: searchOpenAlex,
  arxiv: searchArxiv,
  semanticscholar: searchSemanticScholar,
  europepmc: searchEuropePMC,
};

// Merging -------------------------------------------------------------------

function aliasesOf(p) {
  const a = [];
  if (p.doi) a.push('doi:' + p.doi);
  if (p.ids && p.ids.arxiv) a.push('arxiv:' + p.ids.arxiv);
  if (p.ids && p.ids.openalex) a.push('oa:' + p.ids.openalex);
  if (p.ids && p.ids.pmid) a.push('pmid:' + p.ids.pmid);
  const t = normTitle(p.title);
  if (t.length > 20) a.push('title:' + t);
  return a;
}

function mergeInto(target, p) {
  if ((p.abstract || '').length > (target.abstract || '').length) target.abstract = p.abstract;
  if (!target.tldr && p.tldr) target.tldr = p.tldr;
  if (!target.doi && p.doi) target.doi = p.doi;
  if (!target.venue || target.venue === 'arXiv') target.venue = p.venue || target.venue;
  if (!target.year && p.year) target.year = p.year;
  if ((p.authors || []).length > (target.authors || []).length) target.authors = p.authors;
  if (p.citedBy != null) target.citedBy = Math.max(target.citedBy || 0, p.citedBy);
  if (!target.pdfUrl && p.pdfUrl) target.pdfUrl = p.pdfUrl;
  if (/arxiv\.org\/pdf/.test(p.pdfUrl || '') && !/arxiv\.org\/pdf/.test(target.pdfUrl || '')) target.pdfUrl = p.pdfUrl;
  if (!target.url && p.url) target.url = p.url;
  target.ids = { ...p.ids, ...target.ids };
  if ((p.refs || []).length > (target.refs || []).length) target.refs = p.refs;
  target.sources = uniq([...(target.sources || []), ...(p.sources || [])]);
  target.foundBy = [...(target.foundBy || []), ...(p.foundBy || [])].slice(0, 12);
  if (!target.type && p.type) target.type = p.type;
  return target;
}

/** Adds `incoming` to `papers` in place, merging duplicates. Returns the newly added papers. */
function mergePapers(papers, incoming) {
  const alias = new Map();
  papers.forEach((p, i) => aliasesOf(p).forEach((a) => alias.set(a, i)));
  const added = [];
  for (const p of incoming) {
    if (!p.title || p.title.length < 8) continue;
    const hit = aliasesOf(p).map((a) => alias.get(a)).find((i) => i !== undefined);
    if (hit !== undefined) {
      mergeInto(papers[hit], p);
      aliasesOf(papers[hit]).forEach((a) => alias.set(a, hit));
    } else {
      papers.push(p);
      added.push(p);
      aliasesOf(p).forEach((a) => alias.set(a, papers.length - 1));
    }
  }
  return added;
}

function lightPaper(p) {
  return {
    key: p.key, title: p.title, authors: (p.authors || []).slice(0, 6), year: p.year, venue: p.venue,
    citedBy: p.citedBy, sources: p.sources, score: p.score != null ? p.score : null, n: p.n || null,
  };
}

function authorShort(p) {
  const a = p.authors || [];
  if (!a.length) return 'Unknown';
  const last = (name) => String(name).trim().split(/\s+/).pop();
  if (a.length === 1) return last(a[0]);
  if (a.length === 2) return last(a[0]) + ' & ' + last(a[1]);
  return last(a[0]) + ' et al.';
}

function chooseSources(domain, requested) {
  const valid = Object.keys(SEARCHERS);
  if (Array.isArray(requested) && requested.length) {
    const r = requested.map((s) => String(s).toLowerCase().replace(/\s+/g, '')).filter((s) => valid.includes(s));
    if (r.length) return r;
  }
  const s = ['openalex', 'semanticscholar'];
  if (domain === 'computing' || domain === 'physical-sciences') s.push('arxiv');
  if (domain === 'biomedical') s.push('europepmc');
  if (domain === 'general') s.push('arxiv');
  return s;
}
