#!/usr/bin/env node
// Assembles the n8n workflow JSON files from the sources in n8n/src.
// Every Code node = shared libraries + its own body, so the logic lives in
// plain files you can read, diff and test, while n8n gets self-contained nodes.
//
//   node n8n/build.mjs          → writes n8n/workflows/*.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, 'src', p), 'utf8');

const LIBS = ['runtime', 'config', 'llm', 'text', 'sources', 'progress'].map((name) => src(`lib/${name}.js`));
const HEADER = `// Marginalia · generated from n8n/src by n8n/build.mjs.\n// Shared helpers come first; this node's own logic is at the bottom, after "NODE LOGIC".\n`;

export function codeFor(bodyPath) {
  return `${HEADER}\n${LIBS.join('\n')}\n\n// ════════════════════════════ NODE LOGIC ════════════════════════════\n{\n${src(bodyPath)}\n}\n`;
}

const uuid = (seed) => {
  const h = createHash('sha1').update('marginalia:' + seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: uuid(name), name, type, typeVersion, position, parameters, ...extra,
});
const code = (name, body, position, extra = {}) => node(name, 'n8n-nodes-base.code', 2, position, { jsCode: codeFor(body) }, extra);
const webhook = (name, path, position, { method = 'POST', respond = 'responseNode' } = {}) =>
  node(name, 'n8n-nodes-base.webhook', 2, position, { httpMethod: method, path, responseMode: respond, options: {} }, { webhookId: uuid('hook:' + path) });
const respond = (name, position) => node(name, 'n8n-nodes-base.respondToWebhook', 1.1, position, { respondWith: 'firstIncomingItem', options: {} });
const sticky = (name, content, position, width, height, color = 7) =>
  node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, width, height, color });

function connect(pairs) {
  const c = {};
  for (const [from, to, output = 0] of pairs) {
    c[from] = c[from] || { main: [] };
    while (c[from].main.length <= output) c[from].main.push([]);
    c[from].main[output].push({ node: to, type: 'main', index: 0 });
  }
  return c;
}

function workflow({ id, name, nodes, connections, tags }) {
  return {
    id,
    name,
    active: false,
    nodes,
    connections,
    pinData: {},
    settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
    versionId: uuid(name + ':version:' + createHash('sha1').update(JSON.stringify(nodes)).digest('hex')),
    meta: { templateCredsSetupCompleted: true },
    tags: tags || [],
  };
}

// ─── Research pipeline ──────────────────────────────────────────────────────
const R = 'research/';
const research = workflow({
  id: 'MarginaliaResrch',
  name: 'Marginalia · Deep research pipeline',
  nodes: [
    sticky('Overview', [
      '## Marginalia deep research pipeline',
      'Triggered by the Marginalia studio. Every stage posts live progress back to the studio, which streams it to the browser.',
      '',
      '**Loop:** *Search → Screen & find gaps → Another round?* repeats until each sub-question is covered or the depth budget is spent. Each round runs follow-up queries written from what is missing and snowballs through OpenAlex citations.',
      '',
      '**RAG:** open-access PDFs are downloaded, parsed by *Extract from File*, chunked and indexed (BM25, plus embeddings when a key is set). Findings, the review and the citation audit are all grounded in retrieved passages.',
      '',
      'Keys come from environment variables (see `.env`). Edit logic in `n8n/src` and run `npm run build:workflows`, or edit nodes here directly.',
    ].join('\n'), [-40, -40], 760, 300, 7),
    sticky('Loop note', '### Recursive search\nThe IF node sends the state back to *Search the literature* with new queries and citation seeds.', [460, 200], 520, 120, 5),
    sticky('RAG note', '### Full-text RAG\nPDFs that fail to download or parse fall back to abstracts, so the run never stops here.', [1180, 680], 720, 110, 4),
    webhook('Research request', 'marginalia/research', [0, 340], { respond: 'onReceived' }),
    code('Plan the research', R + '01-plan.js', [240, 340]),
    code('Search the literature', R + '02-search.js', [480, 340]),
    code('Screen & find gaps', R + '03-screen.js', [720, 340]),
    node('Another round?', 'n8n-nodes-base.if', 1, [960, 340], {
      conditions: { boolean: [{ value1: '={{ $json.continueSearch }}', value2: true }] },
    }),
    code('Pick papers to read', R + '04-pick.js', [1200, 540]),
    node('Download open-access PDFs', 'n8n-nodes-base.httpRequest', 4.2, [1440, 540], {
      url: '={{ $json.pdfUrl }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (compatible; Marginalia research assistant)' },
        { name: 'Accept', value: 'application/pdf,*/*;q=0.8' },
      ] },
      options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } }, timeout: 45000 },
    }, { onError: 'continueRegularOutput' }),
    node('Read PDF text', 'n8n-nodes-base.extractFromFile', 1, [1680, 540], {
      operation: 'pdf', binaryPropertyName: 'data', options: { joinPages: true, maxPages: 40 },
    }, { onError: 'continueRegularOutput' }),
    code('Chunk & index', R + '05-index.js', [1920, 540]),
    code('Extract findings', R + '06-extract.js', [2160, 540]),
    code('Write the review', R + '07-write.js', [2400, 540]),
    code('Audit every citation', R + '08-audit.js', [2640, 540]),
    code('Script the audio overview', R + '09-script.js', [2880, 540]),
    code('Deliver to studio', R + '10-deliver.js', [3120, 540]),
  ],
  connections: connect([
    ['Research request', 'Plan the research'],
    ['Plan the research', 'Search the literature'],
    ['Search the literature', 'Screen & find gaps'],
    ['Screen & find gaps', 'Another round?'],
    ['Another round?', 'Search the literature', 0],
    ['Another round?', 'Pick papers to read', 1],
    ['Pick papers to read', 'Download open-access PDFs'],
    ['Download open-access PDFs', 'Read PDF text'],
    ['Read PDF text', 'Chunk & index'],
    ['Chunk & index', 'Extract findings'],
    ['Extract findings', 'Write the review'],
    ['Write the review', 'Audit every citation'],
    ['Audit every citation', 'Script the audio overview'],
    ['Script the audio overview', 'Deliver to studio'],
  ]),
});

// ─── Voice tools (called by the ElevenLabs agent via the studio) ───────────
const T = 'tools/';
const tools = workflow({
  id: 'MarginaliaVoiceT',
  name: 'Marginalia · Voice agent tools',
  nodes: [
    sticky('Tools overview', [
      '## Tools for the ElevenLabs research partner',
      'During a voice debate the agent calls client tools; the browser relays them through the studio to these webhooks and speaks the answer.',
      '',
      '- **verify** checks a claim against the cited papers\' passages (RAG + strict judge)',
      '- **evidence** searches the live literature for new support or counter-evidence',
      '- **health** reports configuration to the studio\'s setup screen',
    ].join('\n'), [-40, -60], 700, 220, 7),
    webhook('Verify claim', 'marginalia/verify', [0, 220]),
    code('Judge the claim', T + 'verify.js', [260, 220], { onError: 'continueRegularOutput' }),
    respond('Return verdict', [520, 220]),
    webhook('Find evidence', 'marginalia/evidence', [0, 420]),
    code('Search & triage', T + 'evidence.js', [260, 420], { onError: 'continueRegularOutput' }),
    respond('Return papers', [520, 420]),
    webhook('Health', 'marginalia/health', [0, 620], { method: 'GET' }),
    code('Report health', T + 'health.js', [260, 620], { onError: 'continueRegularOutput' }),
    respond('Return health', [520, 620]),
  ],
  connections: connect([
    ['Verify claim', 'Judge the claim'],
    ['Judge the claim', 'Return verdict'],
    ['Find evidence', 'Search & triage'],
    ['Search & triage', 'Return papers'],
    ['Health', 'Report health'],
    ['Report health', 'Return health'],
  ]),
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(here, 'workflows');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'marginalia-research.json'), JSON.stringify(research, null, 2));
  writeFileSync(join(out, 'marginalia-voice-tools.json'), JSON.stringify(tools, null, 2));
  console.log('Wrote', ['marginalia-research.json', 'marginalia-voice-tools.json'].map((f) => join('n8n/workflows', f)).join(', '));
}

export { research, tools };
