// A small interpreter for the subset of n8n used by the Marginalia workflows.
// It executes the *generated workflow JSON* — the same Code-node source n8n
// runs — so the studio can work without n8n, and tests exercise the real code.
//
// Supported node types: webhook, code, if (v1), httpRequest (file download),
// extractFromFile (pdf, best-effort), respondToWebhook, stickyNote.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Emulates n8n's this.helpers.httpRequest closely enough for our code. */
async function httpRequest(opts) {
  const { method = 'GET', url, headers = {}, body, json, timeout = 30000 } = opts;
  const h = { ...headers };
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`Request failed with status code ${res.status}`);
    e.httpCode = String(res.status);
    e.response = { status: res.status, data: text.slice(0, 500) };
    throw e;
  }
  const ct = res.headers.get('content-type') || '';
  if (json || ct.includes('json')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

// ─── Minimal PDF text extraction (fallback only; n8n does this properly) ────
function extractPdfText(buf) {
  const src = buf.toString('latin1');
  if (!src.startsWith('%PDF')) throw new Error('Not a PDF');
  const out = [];
  const streamRe = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(src))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    if (/\/(Image|XObject|FontFile|Metadata)/.test(dict) && !/\/Type\s*\/XObject\s*\/Subtype\s*\/Form/.test(dict)) continue;
    let data = Buffer.from(src.slice(start, end), 'latin1');
    if (/FlateDecode/.test(dict)) {
      try { data = inflateSync(data); } catch { continue; }
    } else if (/\/Filter/.test(dict)) continue;
    const content = data.toString('latin1');
    if (!/(Tj|TJ)/.test(content)) continue;
    const parts = [];
    const opRe = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm|ET)/g;
    let o;
    while ((o = opRe.exec(content))) {
      if (o[1] !== undefined) {
        const seg = o[1].replace(/\(((?:[^)\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g, (_, s, num) => (s !== undefined ? unescapePdf(s) : parseFloat(num) < -200 ? ' ' : ''));
        parts.push(seg);
      } else if (o[2] !== undefined) parts.push(unescapePdf(o[2]));
      else parts.push(o[3] === 'ET' ? '\n' : ' ');
    }
    out.push(parts.join(''));
  }
  const text = out.join('\n').replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const words = text.split(/\s+/);
  const wordy = words.filter((w) => /^[A-Za-z][a-z]{2,}[.,;:]?$/.test(w)).length;
  if (words.length < 200 || wordy / words.length < 0.35) throw new Error('PDF text could not be decoded reliably');
  return text;
}
function unescapePdf(s) {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c]))
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/­/g, '');
}

// ─── Expression evaluation (only `={{ ... }}` with $json) ──────────────────
function evalExpr(expr, json) {
  if (typeof expr !== 'string' || !expr.startsWith('=')) return expr;
  const m = expr.match(/^=\{\{([\s\S]*)\}\}$/);
  if (!m) return expr.slice(1);
  // eslint-disable-next-line no-new-func
  return new Function('$json', `return (${m[1]});`)(json);
}

export function loadWorkflow(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Run a workflow from the webhook node whose path matches `path`.
 * Resolves with the respondToWebhook payload (if any) once execution ends.
 */
export async function runWorkflow(wf, { path, body = {}, query = {}, env = process.env, onNode } = {}) {
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const start = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === path);
  if (!start) throw new Error(`No webhook with path ${path}`);
  const runData = new Map();
  const envProxy = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? env[k] : undefined) });
  const ctx = { helpers: { httpRequest } };
  let response;
  const queue = [{ name: start.name, items: [{ json: { body, query, headers: {}, params: {} } }] }];
  let steps = 0;

  const accessor = (items) => ({
    first: () => items[0],
    last: () => items[items.length - 1],
    all: () => items,
    get item() { return items[0]; },
  });

  while (queue.length) {
    if (++steps > 300) throw new Error('Workflow exceeded the step limit (possible infinite loop)');
    const { name, items } = queue.shift();
    const n = byName.get(name);
    let outputs = [[]];
    const t0 = Date.now();
    if (onNode) onNode({ name, status: 'running' });
    try {
      switch (n.type) {
        case 'n8n-nodes-base.webhook':
          outputs = [items];
          break;
        case 'n8n-nodes-base.code': {
          const $ = (nodeName) => {
            const runs = runData.get(nodeName);
            if (!runs || !runs.length) throw new Error(`Referenced node "${nodeName}" hasn't run yet`);
            return accessor(runs[runs.length - 1][0] || []);
          };
          const fn = new AsyncFunction('$input', '$env', '$', '$json', '$execution', n.parameters.jsCode);
          const result = await fn.call(ctx, accessor(items), envProxy, $, items[0] && items[0].json, { id: 'local-' + Date.now() });
          outputs = [(Array.isArray(result) ? result : [result]).filter(Boolean).map((r) => (r.json ? r : { json: r }))];
          break;
        }
        case 'n8n-nodes-base.if': {
          const cond = (n.parameters.conditions.boolean || [])[0];
          const t = [], f = [];
          for (const it of items) (evalExpr(cond.value1, it.json) === cond.value2 ? t : f).push(it);
          outputs = [t, f];
          break;
        }
        case 'n8n-nodes-base.httpRequest': {
          outputs = [await Promise.all(items.map(async (it) => {
            try {
              const url = evalExpr(n.parameters.url, it.json);
              if (!url) throw new Error('Invalid URL');
              const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Marginalia)' }, signal: AbortSignal.timeout(n.parameters.options?.timeout || 45000), redirect: 'follow' });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              const buf = Buffer.from(await res.arrayBuffer());
              return { json: {}, binary: { data: { buffer: buf, mimeType: res.headers.get('content-type') || '' } } };
            } catch (e) {
              if (n.onError === 'continueRegularOutput') return { json: { error: String(e.message || e) } };
              throw e;
            }
          }))];
          break;
        }
        case 'n8n-nodes-base.extractFromFile': {
          outputs = [items.map((it) => {
            try {
              const b = it.binary && it.binary.data;
              if (!b) throw new Error(it.json && it.json.error ? 'Download failed: ' + it.json.error : 'No binary data');
              const text = extractPdfText(b.buffer);
              return { json: { text, numpages: (b.buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null } };
            } catch (e) {
              if (n.onError === 'continueRegularOutput') return { json: { error: String(e.message || e) } };
              throw e;
            }
          })];
          break;
        }
        case 'n8n-nodes-base.respondToWebhook':
          response = items[0] ? items[0].json : {};
          outputs = [items];
          break;
        default:
          outputs = [items];
      }
    } catch (err) {
      if (n.type === 'n8n-nodes-base.code' && n.onError === 'continueRegularOutput') {
        outputs = [[{ json: { error: String(err.message || err) } }]];
      } else {
        if (onNode) onNode({ name, status: 'error', error: String(err.message || err) });
        throw err;
      }
    }
    if (onNode) onNode({ name, status: 'done', ms: Date.now() - t0 });
    if (!runData.has(name)) runData.set(name, []);
    runData.get(name).push(outputs);
    const conns = (wf.connections[name] && wf.connections[name].main) || [];
    conns.forEach((targets, outIdx) => {
      const out = outputs[outIdx] || [];
      if (!out.length) return;
      for (const t of targets) queue.push({ name: t.node, items: out.map((i) => ({ json: i.json, binary: i.binary })) });
    });
  }
  return response;
}

export const _test = { extractPdfText, evalExpr };
