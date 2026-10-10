// ─── Progress events back to the Marginalia studio ──────────────────────────

async function emit(state, type, data) {
  if (!state || !state.callbackUrl) return;
  try {
    await http({
      method: 'POST',
      url: state.callbackUrl,
      headers: { 'x-marginalia-secret': state.callbackSecret || '' },
      body: { sessionId: state.sessionId, type, data, at: Date.now() },
      timeout: type === 'result' ? 60000 : 8000,
      retries: type === 'result' ? 3 : 0,
    });
  } catch (e) {
    if (type === 'result') throw e;
  }
}

async function stage(state, id, label, fn) {
  await emit(state, 'stage', { id, status: 'running', label, round: state.round || 0 });
  const t0 = Date.now();
  try {
    const result = await fn();
    recordUsage(state);
    await emit(state, 'stage', { id, status: 'done', label, ms: Date.now() - t0, round: state.round || 0, usage: state.usage });
    return result;
  } catch (err) {
    await emit(state, 'error', { stage: id, label, message: String((err && err.message) || err) });
    throw err;
  }
}

/** Optional shared secret so only the studio can trigger these webhooks. */
function requireToken(req) {
  const expected = envGet('MARGINALIA_WEBHOOK_TOKEN');
  if (expected && String((req && req.token) || '') !== expected) {
    throw new Error('Rejected: missing or wrong webhook token. Set the same MARGINALIA_WEBHOOK_TOKEN for n8n and the studio.');
  }
}

function log(state, text, extra) {
  return emit(state, 'log', { text, ...(extra || {}) });
}
