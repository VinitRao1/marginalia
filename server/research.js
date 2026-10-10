// Orchestrates runs: sends work to n8n (or the local engine), receives the
// progress callbacks, and relays voice-agent tool calls.
import { join } from 'node:path';
import { config, ROOT } from './config.js';
import * as store from './store.js';
import { loadWorkflow, runWorkflow } from './engine.js';

const WF_DIR = join(ROOT, 'n8n', 'workflows');
let researchWf, toolsWf;
const wf = (name) => {
  if (name === 'research') return (researchWf ||= loadWorkflow(join(WF_DIR, 'marginalia-research.json')));
  return (toolsWf ||= loadWorkflow(join(WF_DIR, 'marginalia-voice-tools.json')));
};

// ─── Engine detection ───────────────────────────────────────────────────────
let healthCache = { at: 0, value: null };
export async function n8nHealth(force = false) {
  if (!force && Date.now() - healthCache.at < 15000 && healthCache.value) return healthCache.value;
  let value;
  try {
    const res = await fetch(`${config.n8nUrl}/webhook/marginalia/health`, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    if (res.ok) value = { reachable: true, ...JSON.parse(text || '{}') };
    else if (res.status === 404) value = { reachable: true, workflowsActive: false, error: 'n8n is running but the Marginalia workflows are not published. Run the import step in the README, or open n8n and publish both workflows.' };
    else value = { reachable: true, error: `n8n answered ${res.status}` };
  } catch (e) {
    value = { reachable: false, error: `Cannot reach n8n at ${config.n8nUrl}` };
  }
  healthCache = { at: Date.now(), value };
  return value;
}

export async function chooseEngine() {
  if (config.engine === 'local') return 'local';
  const h = await n8nHealth();
  const usable = h.reachable && h.ok && h.workflowsActive !== false;
  if (config.engine === 'n8n') return 'n8n';
  return usable ? 'n8n' : 'local';
}

// ─── Starting a run ─────────────────────────────────────────────────────────
export async function startResearch({ question, depth, sources }) {
  const engine = await chooseEngine();
  const session = store.create({ question, depth, sources: sources || null, engine, title: question });
  const payload = {
    sessionId: session.id,
    question,
    depth,
    sources,
    callbackUrl: `${config.callbackBase}/hooks/n8n`,
    callbackSecret: config.callbackSecret,
    token: config.webhookToken || undefined,
  };
  store.pushEvent(session.id, 'engine', { engine });

  if (engine === 'n8n') {
    try {
      const res = await fetch(`${config.n8nUrl}/webhook/marginalia/research`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`n8n answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      fail(session.id, `Could not start the n8n workflow. ${e.message}`);
    }
  } else {
    // Local engine: same workflow, same code, run in-process. Events arrive
    // through the same callback endpoint over HTTP, exactly like n8n.
    runWorkflow(wf('research'), { path: 'marginalia/research', body: payload })
      .catch((e) => {
        const s = store.get(session.id);
        if (s && s.status === 'running') fail(session.id, e.message);
      });
  }
  watch(session.id);
  return session;
}

function fail(id, message) {
  store.pushEvent(id, 'error', { message });
  store.update(id, { status: 'error', error: message });
}

// A run that goes silent for too long is marked as failed.
const watchers = new Map();
function watch(id) {
  clearInterval(watchers.get(id));
  watchers.set(id, setInterval(() => {
    const s = store.get(id);
    if (!s || s.status !== 'running') { clearInterval(watchers.get(id)); watchers.delete(id); return; }
    if (Date.now() - s.updatedAt > 12 * 60 * 1000) {
      fail(id, 'The research engine stopped sending progress for 12 minutes. Check the execution log in n8n for the failing step.');
    }
  }, 30000));
}

// ─── Callbacks from n8n / local engine ─────────────────────────────────────
export function handleCallback(evt) {
  const s = store.get(evt.sessionId);
  if (!s) return false;
  const { type, data } = evt;
  if (type === 'result') {
    store.saveChunks(s.id, data.chunks);
    const { chunks, ...rest } = data;
    store.update(s.id, { ...rest, status: 'done', finishedAt: Date.now() });
    store.pushEvent(s.id, 'done', { stats: data.stats });
    return true;
  }
  if (type === 'plan') store.update(s.id, { title: data.title, plan: data });
  if (type === 'papers') {
    s.livePapers.push(...(data.added || []));
    if (s.livePapers.length > 600) s.livePapers.splice(0, s.livePapers.length - 600);
  }
  if (type === 'error') store.update(s.id, { status: 'error', error: data.message });
  store.pushEvent(s.id, type, data);
  return true;
}

// ─── Voice tools ────────────────────────────────────────────────────────────
async function callTool(path, body) {
  const engine = await chooseEngine();
  const payload = { ...body, token: config.webhookToken || undefined };
  if (engine === 'n8n') {
    const res = await fetch(`${config.n8nUrl}/webhook/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(110000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`n8n tool ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text || '{}');
  }
  return runWorkflow(wf('tools'), { path, body: payload });
}

const paperMeta = (p) => ({ n: p.n, title: p.title, authors: (p.authors || []).slice(0, 4), year: p.year });

export async function verifyClaim(sessionId, { claim, citations }) {
  const s = store.get(sessionId);
  if (!s) throw new Error('Session not found');
  const nums = String(citations || '').match(/\d+/g)?.map(Number) || [];
  const chunks = store.loadChunks(sessionId).filter((c) => !nums.length || nums.includes(c.n));
  const papers = (s.papers || []).filter((p) => p.included);
  const result = await callTool('marginalia/verify', { claim, citations: nums, chunks, papers: papers.map(paperMeta) });
  if (result.error) throw new Error(result.error);
  const record = { ...result, citations: nums, at: Date.now() };
  s.verifications.push(record);
  store.update(sessionId, {});
  store.pushEvent(sessionId, 'verification', record);
  return record;
}

export async function findEvidence(sessionId, { query }) {
  const s = store.get(sessionId);
  if (!s) throw new Error('Session not found');
  const exclude = (s.papers || []).map((p) => p.title);
  const result = await callTool('marginalia/evidence', {
    query, question: s.question, exclude, domain: s.plan && s.plan.domain, sources: s.sources || undefined,
  });
  if (result.error) throw new Error(result.error);
  const record = { query, papers: result.papers || [], at: Date.now() };
  s.evidenceFinds.push(record);
  store.update(sessionId, {});
  store.pushEvent(sessionId, 'evidence', record);
  return record;
}
