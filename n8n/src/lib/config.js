// ─── Configuration (read from environment variables) ────────────────────────

const PROVIDER_DEFAULTS = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', keyVar: 'ANTHROPIC_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', fastModel: 'gpt-5.4-mini', keyVar: 'OPENAI_API_KEY' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', fastModel: 'gemini-3.5-flash-lite', keyVar: 'GEMINI_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5.5', fastModel: 'openai/gpt-5.4-mini', keyVar: 'OPENROUTER_API_KEY' },
  ollama: { baseUrl: 'http://host.docker.internal:11434/v1', model: 'llama3.1', fastModel: '', keyVar: '' },
  custom: { baseUrl: '', model: '', fastModel: '', keyVar: '' },
};

const DEPTHS = {
  quick: { label: 'Skim', subq: 3, queriesPerSubq: 2, perSource: 8, rounds: 1, screenTop: 36, minPerSubq: 2, include: 10, fullText: 4, auditMax: 12, words: '700 to 900' },
  standard: { label: 'Survey', subq: 4, queriesPerSubq: 2, perSource: 10, rounds: 2, screenTop: 48, minPerSubq: 3, include: 16, fullText: 8, auditMax: 24, words: '1200 to 1600' },
  deep: { label: 'Exhaustive', subq: 5, queriesPerSubq: 3, perSource: 12, rounds: 3, screenTop: 60, minPerSubq: 4, include: 24, fullText: 12, auditMax: 40, words: '1800 to 2400' },
};

function getConfig() {
  const explicit = envGet('LLM_PROVIDER').toLowerCase();
  let provider = explicit;
  if (!provider) {
    if (envGet('ANTHROPIC_API_KEY')) provider = 'anthropic';
    else if (envGet('OPENAI_API_KEY')) provider = 'openai';
    else if (envGet('GEMINI_API_KEY')) provider = 'gemini';
    else if (envGet('OPENROUTER_API_KEY')) provider = 'openrouter';
    else if (envGet('LLM_BASE_URL')) provider = 'custom';
    else provider = 'none';
  }
  const d = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
  const apiKey = envGet('LLM_API_KEY') || (d.keyVar ? envGet(d.keyVar) : '');
  const model = envGet('LLM_MODEL', d.model);
  const llm = {
    provider,
    baseUrl: envGet('LLM_BASE_URL', d.baseUrl).replace(/\/+$/, ''),
    apiKey,
    model,
    fastModel: envGet('LLM_FAST_MODEL', d.fastModel || model),
  };
  llm.ready = provider !== 'none' && !!llm.baseUrl && !!llm.model && (!!apiKey || provider === 'ollama' || provider === 'custom');

  // Optional dense embeddings for hybrid retrieval (BM25 is always on).
  const embMode = envGet('EMBEDDINGS_PROVIDER', 'auto').toLowerCase();
  let embeddings = null;
  if (embMode !== 'off' && embMode !== 'none') {
    const pick = embMode === 'auto' ? (envGet('OPENAI_API_KEY') ? 'openai' : envGet('GEMINI_API_KEY') ? 'gemini' : '') : embMode;
    if (pick === 'openai' && envGet('OPENAI_API_KEY')) {
      embeddings = { baseUrl: 'https://api.openai.com/v1', apiKey: envGet('OPENAI_API_KEY'), model: envGet('EMBEDDINGS_MODEL', 'text-embedding-3-small'), dimensions: 256 };
    } else if (pick === 'gemini' && envGet('GEMINI_API_KEY')) {
      embeddings = { baseUrl: PROVIDER_DEFAULTS.gemini.baseUrl, apiKey: envGet('GEMINI_API_KEY'), model: envGet('EMBEDDINGS_MODEL', 'gemini-embedding-001'), dimensions: 256 };
    } else if (pick === 'custom' && envGet('EMBEDDINGS_BASE_URL')) {
      embeddings = { baseUrl: envGet('EMBEDDINGS_BASE_URL').replace(/\/+$/, ''), apiKey: envGet('EMBEDDINGS_API_KEY'), model: envGet('EMBEDDINGS_MODEL'), dimensions: parseInt(envGet('EMBEDDINGS_DIMENSIONS', '0'), 10) || undefined };
    }
  }

  return {
    llm,
    embeddings,
    contactEmail: envGet('CONTACT_EMAIL', ''),
    keys: {
      openalex: envGet('OPENALEX_API_KEY'),
      semanticScholar: envGet('SEMANTIC_SCHOLAR_API_KEY'),
    },
    urls: {
      openalex: envGet('OPENALEX_URL', 'https://api.openalex.org').replace(/\/+$/, ''),
      arxiv: envGet('ARXIV_URL', 'https://export.arxiv.org').replace(/\/+$/, ''),
      semanticScholar: envGet('SEMANTIC_SCHOLAR_URL', 'https://api.semanticscholar.org').replace(/\/+$/, ''),
      europepmc: envGet('EUROPEPMC_URL', 'https://www.ebi.ac.uk').replace(/\/+$/, ''),
      arxivPdf: envGet('ARXIV_PDF_URL', 'https://arxiv.org/pdf').replace(/\/+$/, ''),
    },
  };
}
