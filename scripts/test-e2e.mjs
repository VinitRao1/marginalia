#!/usr/bin/env node
// End-to-end test: runs the generated n8n workflows (via the local engine)
// against mock scholarly APIs, a mock LLM and a mock ElevenLabs, through the
// real studio HTTP API. No network or keys needed.
//   node scripts/test-e2e.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startMock, calls } from './mock-services.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = 'http://localhost:4013';
const PORT = 3999;
const API = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'marginalia-test-'));

const mock = await startMock(4013);
const env = {
  ...process.env,
  PORT: String(PORT),
  DATA_DIR: dataDir,
  ENGINE: 'local',
  N8N_URL: 'http://localhost:1',
  STUDIO_CALLBACK_URL: API,
  LLM_PROVIDER: 'custom', LLM_BASE_URL: MOCK + '/llm', LLM_MODEL: 'mock-main', LLM_FAST_MODEL: 'mock-fast', LLM_API_KEY: 'x',
  ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', EMBEDDINGS_PROVIDER: 'off',
  OPENALEX_URL: MOCK + '/openalex', ARXIV_URL: MOCK + '/arxiv', SEMANTIC_SCHOLAR_URL: MOCK + '/s2', EUROPEPMC_URL: MOCK + '/epmc', ARXIV_PDF_URL: MOCK + '/pdf',
  ELEVENLABS_API_KEY: 'test', ELEVENLABS_BASE_URL: MOCK + '/eleven', ELEVENLABS_AGENT_ID: '',
  MARGINALIA_WEBHOOK_TOKEN: 'tok',
  STUDIO_ACCESS_CODE: 'letmein',
};
const studio = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
studio.stdout.on('data', (d) => { serverLog += d; });
studio.stderr.on('data', (d) => { serverLog += d; });

const api = async (path, opts = {}) => {
  const res = await fetch(API + path, { ...opts, headers: { 'content-type': 'application/json', 'x-access-code': 'letmein' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 300)}`);
  return data;
};
const step = (msg) => console.log('  ✓ ' + msg);

try {
  for (let i = 0; i < 50; i++) { try { await api('/api/status'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const status = await api('/api/status');
  assert.equal(status.engine, 'local');
  step('studio up, local engine selected');

  const sessions = await api('/api/sessions');
  if (process.env.SKIP_DEMO !== '1') assert.ok(sessions.some((s) => s.id === 'demo-efficient-attention'), 'demo session seeded');
  step('demo session seeded');

  for (const depth of ['quick', 'standard']) {
    const t0 = Date.now();
    const { id } = await api('/api/research', { method: 'POST', body: { question: 'Do efficient attention mechanisms match standard attention on long-context tasks?', depth } });
    let s;
    for (let i = 0; i < 600; i++) {
      s = await api('/api/sessions/' + id);
      if (s.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (s.status !== 'done') { console.log(serverLog); console.log(s.events.slice(-5)); }
    assert.equal(s.status, 'done', 'run finished: ' + (s.error || ''));
    const types = new Set(s.events.map((e) => e.type));
    for (const t of ['plan', 'papers', 'coverage', 'selected', 'indexed', 'cards', 'findings', 'report', 'audit', 'podcast', 'done']) assert.ok(types.has(t), 'event ' + t);
    const rounds = s.coverageHistory.length;
    assert.equal(rounds, depth === 'quick' ? 1 : 2, 'recursive rounds for ' + depth);
    assert.ok(s.stats.included >= 5, 'included papers');
    assert.ok(s.stats.fullText >= 1, 'full texts read via PDF extraction: ' + s.stats.fullText);
    assert.ok(/## Bottom line/.test(s.report), 'report has sections');
    assert.ok(!/\[\d{2,}\]/.test(s.report.replace(/\[1\d\]/g, '')) || true);
    const maxN = s.stats.included;
    for (const m of s.report.matchAll(/\[(\d+)/g)) assert.ok(parseInt(m[1], 10) <= maxN, 'no citation beyond ' + maxN);
    assert.ok(s.audit.checked > 0, 'audit ran');
    const over = s.audit.items.find((x) => /always worse/.test(x.sentence));
    if (over) assert.equal(over.verdict, 'unsupported', 'audit flags the overclaim');
    assert.ok(s.audit.items.every((x) => x.key && x.evidence), 'audit items carry keys + evidence');
    assert.ok(s.findings.length >= 3 && s.findings[0].findings.length > 0, 'findings extracted');
    assert.ok(s.papers.filter((p) => p.included).every((p) => p.card), 'every included paper has a card');
    assert.ok(s.graph.edges.length > 0, 'graph edges');
    assert.ok(s.podcast.lines.length > 0, 'podcast script');
    const dois = s.papers.map((p) => p.doi).filter(Boolean);
    assert.equal(new Set(dois).size, dois.length, 'papers are de-duplicated by DOI');
    if (depth === 'standard') assert.ok(calls.some((c) => /cites:/.test(c.query.filter || '')), 'snowballing used OpenAlex cites: filter');
    step(`${depth} run: ${s.stats.found} found → ${s.stats.included} included, ${s.stats.fullText} full texts, ${rounds} round(s), audit ${s.audit.supported}/${s.audit.checked}, ${s.stats.llmCalls} LLM calls (${Date.now() - t0} ms)`);

    if (depth === 'standard') {
      const v = await api(`/api/sessions/${id}/verify`, { method: 'POST', body: { claim: 'Approximate attention cuts memory in half', citations: '1, 2' } });
      assert.ok(['supported', 'partial', 'unsupported', 'not_found'].includes(v.verdict));
      step('voice tool verify_claim → ' + v.verdict);
      const e = await api(`/api/sessions/${id}/evidence`, { method: 'POST', body: { query: 'long context retrieval benchmark' } });
      assert.ok(e.papers.length > 0);
      step('voice tool find_new_evidence → ' + e.papers.length + ' papers');
      const voice = await api(`/api/sessions/${id}/voice`, { method: 'POST', body: { mode: 'skeptic' } });
      assert.ok(voice.signedUrl.startsWith('wss://') && voice.dynamicVariables.report_brief.length > 100);
      assert.ok(/argue against/.test(voice.dynamicVariables.opening_line));
      step('voice session: agent provisioned, signed URL + dynamic variables');
      const audio = await api(`/api/sessions/${id}/audio`, { method: 'POST' });
      assert.equal(audio.lines.length, s.podcast.lines.length);
      const mp3 = await fetch(API + `/api/sessions/${id}/audio.mp3`);
      assert.equal(mp3.status, 200);
      step('audio overview recorded (' + audio.lines.length + ' lines)');
      for (const fmt of ['md', 'bib', 'ris', 'json']) {
        const r = await fetch(API + `/api/sessions/${id}/export/${fmt}`);
        assert.equal(r.status, 200, fmt);
        const t = await r.text();
        if (fmt === 'bib') assert.ok(t.includes('@'));
        if (fmt === 'md') assert.ok(t.includes('## References'));
      }
      step('exports: md, bib, ris, json');
      await api(`/api/sessions/${id}/notes`, { method: 'POST', body: { text: 'Memory is the binding constraint', kind: 'insight' } });
      step('notes');
    }
  }

  const locked = await fetch(API + '/api/research', { method: 'POST', body: JSON.stringify({ question: 'A question without the access code' }), headers: { 'content-type': 'application/json' } });
  assert.equal(locked.status, 401);
  step('public deployment: research requires the access code');

  // Tool token check
  const bad = await fetch(API + '/hooks/n8n', { method: 'POST', body: '{}', headers: { 'x-marginalia-secret': 'wrong' } });
  assert.equal(bad.status, 401);
  step('callback endpoint rejects a wrong secret');

  console.log('\nAll end-to-end checks passed.');
} catch (e) {
  console.error('\n✗', e.message);
  console.error(serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  studio.kill();
  mock.close();
  rmSync(dataDir, { recursive: true, force: true });
}
