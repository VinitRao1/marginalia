// Marginalia studio: serves the web app, streams live research progress,
// receives n8n callbacks, and brokers ElevenLabs. Zero npm dependencies.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { config, ROOT } from './config.js';
import * as store from './store.js';
import { startResearch, handleCallback, n8nHealth, chooseEngine, verifyClaim, findEvidence } from './research.js';
import { agentStatus, ensureAgent, startVoice, renderPodcast, podcastMp3Paths } from './elevenlabs.js';
import { toBibtex, toRis, toMarkdown } from './exports.js';

const WEB = join(ROOT, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

async function readJson(req, limit = 80 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function serveFile(res, file, req) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
  const type = MIME[extname(file)] || 'application/octet-stream';
  const stat = statSync(file);
  const range = req.headers.range;
  if (range && type === 'audio/mpeg') {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': type.startsWith('text/html') ? 'no-store' : 'no-cache' });
  createReadStream(file).pipe(res);
}

// ─── Demo session (explorable without any keys) ────────────────────────────
function seedDemo() {
  const id = 'demo-efficient-attention';
  if (store.get(id)) return;
  const file = join(WEB, 'demo', 'sample-session.json');
  if (!existsSync(file)) return;
  const demo = JSON.parse(readFileSync(file, 'utf8'));
  const { chunks, ...rest } = demo;
  store.create({ ...rest, id, demo: true, status: 'done', createdAt: Date.now() - 86400000 });
  store.saveChunks(id, chunks || []);
}

// ─── Access code for public deployments ───────────────────────────────────
function requireCode(req) {
  if (!config.accessCode) return;
  if (String(req.headers['x-access-code'] || '') !== config.accessCode) {
    throw Object.assign(new Error('This deployment needs an access code to run research or use voice. Browsing the sample is free.'), { status: 401, code: 'access_code' });
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/status', async () => {
  const [health, engine] = await Promise.all([n8nHealth(true), chooseEngine()]);
  return {
    version: '1.0.0',
    engine,
    engineSetting: config.engine,
    n8n: { url: config.n8nPublicUrl, ...health },
    llm: health.llm || localLlmStatus(),
    elevenlabs: agentStatus(),
    accessCodeRequired: !!config.accessCode,
  };
});

function localLlmStatus() {
  const e = process.env;
  const provider = e.LLM_PROVIDER || (e.ANTHROPIC_API_KEY ? 'anthropic' : e.OPENAI_API_KEY ? 'openai' : e.GEMINI_API_KEY ? 'gemini' : e.OPENROUTER_API_KEY ? 'openrouter' : e.LLM_BASE_URL ? 'custom' : 'none');
  return { provider, ready: provider !== 'none', model: e.LLM_MODEL || 'default', local: true };
}

route('GET', '/api/sessions', () => store.list());

route('POST', '/api/research', async (req) => {
  requireCode(req);
  const running = store.list().filter((x) => x.status === 'running').length;
  if (running >= config.maxConcurrentRuns) throw Object.assign(new Error(`${running} research runs are already in progress. Try again in a few minutes.`), { status: 429 });
  const body = await readJson(req);
  const question = String(body.question || '').trim();
  if (question.length < 8) throw Object.assign(new Error('Write a full research question (at least a few words).'), { status: 400 });
  if (question.length > 1500) throw Object.assign(new Error('Keep the question under 1,500 characters.'), { status: 400 });
  const depth = ['quick', 'standard', 'deep'].includes(body.depth) ? body.depth : 'standard';
  const s = await startResearch({ question, depth, sources: Array.isArray(body.sources) && body.sources.length ? body.sources : null });
  return { id: s.id, engine: s.engine };
});

route('GET', '/api/sessions/:id', (req, p) => {
  const s = store.get(p.id);
  if (!s) throw Object.assign(new Error('Session not found'), { status: 404 });
  return store.publicView(s);
});

route('DELETE', '/api/sessions/:id', (req, p) => {
  requireCode(req);
  if (p.id.startsWith('demo-')) throw Object.assign(new Error('The sample session cannot be deleted.'), { status: 400 });
  return { ok: store.remove(p.id) };
});

route('GET', '/api/sessions/:id/stream', (req, p, res, url) => {
  const s = store.get(p.id);
  if (!s) return send(res, 404, { error: 'Session not found' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const after = parseInt(url.searchParams.get('after') || '0', 10);
  for (const ev of s.events.filter((e) => e.seq > after)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const onEv = (ev) => res.write(`data: ${JSON.stringify(ev.type === 'result' ? { ...ev, data: undefined } : ev)}\n\n`);
  store.bus.on('event:' + p.id, onEv);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); store.bus.off('event:' + p.id, onEv); });
  return undefined;
});

route('POST', '/api/sessions/:id/notes', async (req, p) => {
  requireCode(req);
  const s = store.get(p.id);
  if (!s) throw Object.assign(new Error('Session not found'), { status: 404 });
  const { text, kind = 'insight', source = 'you' } = await readJson(req);
  if (!text) throw Object.assign(new Error('The note is empty.'), { status: 400 });
  const note = { text: String(text).slice(0, 600), kind, source, at: Date.now() };
  s.notes.push(note);
  store.update(p.id, {});
  store.pushEvent(p.id, 'note', note);
  return note;
});

route('DELETE', '/api/sessions/:id/notes/:at', (req, p) => {
  const s = store.get(p.id);
  if (!s) throw Object.assign(new Error('Session not found'), { status: 404 });
  s.notes = s.notes.filter((n) => String(n.at) !== p.at);
  store.update(p.id, {});
  return { ok: true };
});

route('POST', '/api/sessions/:id/verify', async (req, p) => { requireCode(req); return verifyClaim(p.id, await readJson(req)); });
route('POST', '/api/sessions/:id/evidence', async (req, p) => { requireCode(req); return findEvidence(p.id, await readJson(req)); });

route('POST', '/api/sessions/:id/voice', async (req, p) => {
  requireCode(req);
  const { mode } = await readJson(req);
  return startVoice(p.id, mode);
});

route('POST', '/api/sessions/:id/audio', (req, p) => { requireCode(req); return renderPodcast(p.id); });

route('GET', '/api/sessions/:id/audio.mp3', (req, p, res) => {
  const files = podcastMp3Paths(p.id);
  if (!files) return send(res, 404, { error: 'Record the audio overview first.' });
  const buf = Buffer.concat(files.filter(existsSync).map((f) => readFileSync(f)));
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-disposition': `attachment; filename="marginalia-${p.id}.mp3"` });
  res.end(buf);
  return undefined;
});

route('GET', '/api/sessions/:id/export/:fmt', (req, p, res) => {
  const s = store.get(p.id);
  if (!s || s.status !== 'done') return send(res, 404, { error: 'Nothing to export yet.' });
  const name = `marginalia-${(s.title || 'review').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`;
  const out = {
    md: [toMarkdown(s), 'text/markdown; charset=utf-8', '.md'],
    bib: [toBibtex(s), 'application/x-bibtex; charset=utf-8', '.bib'],
    ris: [toRis(s), 'application/x-research-info-systems; charset=utf-8', '.ris'],
    json: [JSON.stringify({ ...store.publicView(s, { events: false }), chunks: store.loadChunks(p.id) }, null, 2), 'application/json', '.json'],
  }[p.fmt];
  if (!out) return send(res, 400, { error: 'Unknown format. Use md, bib, ris or json.' });
  res.writeHead(200, { 'content-type': out[1], 'content-disposition': `attachment; filename="${name}${out[2]}"` });
  res.end(out[0]);
  return undefined;
});

route('POST', '/hooks/n8n', async (req) => {
  if (req.headers['x-marginalia-secret'] !== config.callbackSecret) throw Object.assign(new Error('Bad callback secret'), { status: 401 });
  const evt = await readJson(req);
  if (!handleCallback(evt)) throw Object.assign(new Error('Unknown session'), { status: 404 });
  return { ok: true };
});

route('GET', '/media/:id/:file', (req, p, res) => {
  if (!/^[\w-]+$/.test(p.id) || !/^[\w.-]+\.mp3$/.test(p.file)) return send(res, 400, { error: 'Bad path' });
  return serveFile(res, join(config.dataDir, 'media', p.id, p.file), req);
});

// ─── Server ─────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler(req, params, res, url);
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return;
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || !extname(path)) path = '/index.html';
    serveFile(res, join(WEB, path), req);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[studio]', req.method, url.pathname, err.message);
    if (!res.headersSent) send(res, status, { error: err.message || 'Something went wrong', code: err.code });
  }
});

seedDemo();
server.listen(config.port, config.host, async () => {
  const engine = await chooseEngine();
  console.log(`\n  Marginalia studio → http://localhost:${config.port}`);
  console.log(`  Research engine: ${engine === 'n8n' ? `n8n at ${config.n8nUrl}` : 'local (n8n not reachable; using the built-in runner)'}`);
  const el = agentStatus();
  console.log(`  ElevenLabs: ${el.configured ? 'configured' : 'not configured (voice + audio disabled)'}\n`);
  if (el.configured && !config.elevenlabs.agentId) {
    ensureAgent().then((id) => console.log(`  Voice research partner ready (agent ${id})`)).catch((e) => console.warn('  Could not provision the ElevenLabs agent yet:', e.message));
  }
});

export default server;
