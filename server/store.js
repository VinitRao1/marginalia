// Session storage: one JSON file per session (+ a separate file for RAG chunks),
// cached in memory, with an event bus for live streaming.
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';

const dir = join(config.dataDir, 'sessions');
const cache = new Map();
export const bus = new EventEmitter();
bus.setMaxListeners(200);

const pending = new Map();
function persist(s) {
  clearTimeout(pending.get(s.id));
  pending.set(s.id, setTimeout(() => {
    pending.delete(s.id);
    const tmp = join(dir, s.id + '.json.tmp');
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, join(dir, s.id + '.json'));
  }, 150));
}

export function newId() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(4).toString('hex');
}

export function create(fields) {
  const s = {
    id: newId(),
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    seq: 0,
    livePapers: [],
    verifications: [],
    evidenceFinds: [],
    notes: [],
    ...fields,
  };
  cache.set(s.id, s);
  persist(s);
  return s;
}

export function get(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const f = join(dir, id + '.json');
  if (!existsSync(f)) return null;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  cache.set(id, s);
  return s;
}

export function update(id, patch) {
  const s = get(id);
  if (!s) return null;
  Object.assign(s, patch, { updatedAt: Date.now() });
  persist(s);
  return s;
}

export function pushEvent(id, type, data) {
  const s = get(id);
  if (!s) return null;
  const ev = { seq: ++s.seq, type, data, at: Date.now() };
  if (type !== 'result') {
    s.events.push(ev);
    if (s.events.length > 2000) s.events.splice(0, s.events.length - 2000);
  }
  s.updatedAt = Date.now();
  persist(s);
  bus.emit('event:' + id, ev);
  return ev;
}

export function list() {
  const ids = new Set(readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.chunks.json')).map((f) => f.replace(/\.json$/, '')));
  for (const id of cache.keys()) ids.add(id);
  return Array.from(ids)
    .map((id) => { try { return get(id); } catch { return null; } })
    .filter(Boolean)
    .map((s) => ({
      id: s.id, title: s.title || s.question, question: s.question, status: s.status, depth: s.depth,
      createdAt: s.createdAt, demo: !!s.demo, papers: s.stats ? s.stats.included : null, score: s.audit ? s.audit.score : null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function remove(id) {
  const s = get(id);
  if (!s) return false;
  cache.delete(id);
  for (const f of [id + '.json', id + '.chunks.json']) rmSync(join(dir, f), { force: true });
  rmSync(join(config.dataDir, 'media', id), { recursive: true, force: true });
  return true;
}

export function saveChunks(id, chunks) {
  writeFileSync(join(dir, id + '.chunks.json'), JSON.stringify(chunks || []));
}

export function loadChunks(id) {
  const f = join(dir, id + '.chunks.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
}

/** Everything except the event log — what the UI needs to render a session. */
export function publicView(s, { events = true } = {}) {
  const { events: evs, ...rest } = s;
  return events ? { ...rest, events: evs } : rest;
}
