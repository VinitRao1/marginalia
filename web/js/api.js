// Thin client for the studio API.
const readCode = () => { try { return localStorage.getItem('marginalia-code') || ''; } catch { return ''; } };
const saveCode = (c) => { try { localStorage.setItem('marginalia-code', c); } catch { /* private mode */ } };

async function call(path, { method = 'GET', body } = {}, retried = false) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  const code = readCode();
  if (code) headers['x-access-code'] = code;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (res.status === 401 && data.code === 'access_code' && !retried) {
    const entered = window.prompt(code ? 'That access code did not work. Enter the access code:' : 'Enter the access code for this deployment:');
    if (entered) { saveCode(entered.trim()); return call(path, { method, body }, true); }
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  status: () => call('/api/status'),
  sessions: () => call('/api/sessions'),
  session: (id) => call(`/api/sessions/${id}`),
  start: (body) => call('/api/research', { method: 'POST', body }),
  remove: (id) => call(`/api/sessions/${id}`, { method: 'DELETE' }),
  verify: (id, claim, citations) => call(`/api/sessions/${id}/verify`, { method: 'POST', body: { claim, citations } }),
  evidence: (id, query) => call(`/api/sessions/${id}/evidence`, { method: 'POST', body: { query } }),
  note: (id, text, kind, source) => call(`/api/sessions/${id}/notes`, { method: 'POST', body: { text, kind, source } }),
  voice: (id, mode) => call(`/api/sessions/${id}/voice`, { method: 'POST', body: { mode } }),
  audio: (id) => call(`/api/sessions/${id}/audio`, { method: 'POST' }),
  stream(id, after, onEvent) {
    const es = new EventSource(`/api/sessions/${id}/stream?after=${after || 0}`);
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
    return es;
  },
};
