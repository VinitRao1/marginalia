#!/usr/bin/env node
// Structural checks on the generated n8n workflow files.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'n8n', 'workflows');
const KNOWN = {
  'n8n-nodes-base.webhook': [2], 'n8n-nodes-base.code': [2], 'n8n-nodes-base.if': [1],
  'n8n-nodes-base.httpRequest': [4.2], 'n8n-nodes-base.extractFromFile': [1],
  'n8n-nodes-base.respondToWebhook': [1.1], 'n8n-nodes-base.stickyNote': [1],
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let problems = 0;
const fail = (wf, msg) => { problems++; console.error(`✗ ${wf}: ${msg}`); };

for (const file of ['marginalia-research.json', 'marginalia-voice-tools.json']) {
  const wf = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!/^[A-Za-z0-9]{16}$/.test(wf.id)) fail(file, 'workflow id must be 16 alphanumerics');
  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) fail(file, 'duplicate node name ' + n.name);
    if (ids.has(n.id)) fail(file, 'duplicate node id ' + n.id);
    names.add(n.name); ids.add(n.id);
    if (!KNOWN[n.type] || !KNOWN[n.type].includes(n.typeVersion)) fail(file, `unexpected ${n.type} v${n.typeVersion}`);
    if (!Array.isArray(n.position) || n.position.length !== 2) fail(file, 'bad position on ' + n.name);
    if (n.type === 'n8n-nodes-base.webhook' && !n.webhookId) fail(file, 'webhook without webhookId: ' + n.name);
    if (n.type === 'n8n-nodes-base.code') {
      try { new AsyncFunction('$input', '$env', '$', '$json', '$execution', n.parameters.jsCode); } catch (e) { fail(file, `syntax error in ${n.name}: ${e.message}`); }
      for (const ref of n.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g)) if (!wf.nodes.some((x) => x.name === ref[1])) fail(file, `${n.name} references missing node "${ref[1]}"`);
    }
  }
  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) fail(file, 'connection from unknown node ' + from);
    for (const out of c.main) for (const t of out) if (!names.has(t.node)) fail(file, 'connection to unknown node ' + t.node);
  }
  const paths = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.parameters.path);
  if (new Set(paths).size !== paths.length) fail(file, 'duplicate webhook paths');
  const responders = wf.nodes.filter((n) => n.parameters.responseMode === 'responseNode');
  for (const w of responders) {
    // Every responseNode webhook must reach a respondToWebhook node.
    const seen = new Set([w.name]);
    const stack = [w.name];
    let ok = false;
    while (stack.length) {
      const cur = stack.pop();
      for (const out of (wf.connections[cur] || { main: [] }).main) for (const t of out) {
        if (wf.nodes.find((x) => x.name === t.node).type === 'n8n-nodes-base.respondToWebhook') ok = true;
        if (!seen.has(t.node)) { seen.add(t.node); stack.push(t.node); }
      }
    }
    if (!ok) fail(file, `${w.name} never reaches a Respond to Webhook node`);
  }
  console.log(`${problems ? '•' : '✓'} ${file}: ${wf.nodes.length} nodes, webhooks ${paths.join(', ')}`);
}
process.exit(problems ? 1 : 0);
