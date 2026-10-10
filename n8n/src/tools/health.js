// Health check used by the studio's setup screen.
const C = getConfig();
return [{
  json: {
    ok: true,
    engine: 'n8n',
    version: '1.0.0',
    llm: { provider: C.llm.provider, model: C.llm.model, fastModel: C.llm.fastModel, ready: C.llm.ready },
    embeddings: C.embeddings ? C.embeddings.model : null,
    keys: { openalex: !!C.keys.openalex, semanticScholar: !!C.keys.semanticScholar },
    envAccess: (() => { try { void $env.N8N_PORT; return true; } catch (e) { return false; } })(),
  },
}];
