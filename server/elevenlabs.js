// ElevenLabs: provisions the voice research partner (agent + client tools),
// mints signed conversation URLs, and records the two-voice audio overview.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config } from './config.js';
import * as store from './store.js';

const E = config.elevenlabs;
const agentFile = join(config.dataDir, 'elevenlabs-agent.json');

async function xi(path, { method = 'GET', body, raw = false, timeout = 60000 } = {}) {
  if (!E.apiKey) throw new Error('ELEVENLABS_API_KEY is not set.');
  const res = await fetch(E.baseUrl + path, {
    method,
    headers: { 'xi-api-key': E.apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`ElevenLabs ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ─── The research partner ───────────────────────────────────────────────────
export const AGENT_PROMPT = `You are Marginalia, a research partner. You and the user have just finished a systematic literature review together, and now you are talking it through out loud, like two colleagues after a seminar.

# The review you both know
Question: {{research_question}}
Title: {{review_title}}

{{report_brief}}

# Sources (the numbers match the citations in the review)
{{sources_brief}}

# Citation audit
{{audit_brief}}

# Your stance in this conversation
{{mode_instructions}}

# How you speak
- This is a spoken conversation. Keep turns to one to three sentences. No lists, no markdown, no headings.
- Never read bracketed citation numbers aloud. Refer to studies by author and year, for example "Dao and colleagues in 2022".
- Be calibrated: say how strong the evidence is, and say plainly when it is thin, mixed or missing.
- Never invent studies, numbers, quotes or results. If you don't know, say so and offer to check or search.

# Tools
- show_source: whenever you bring up a specific source, call it with that source's number so the user sees the paper.
- verify_claim: whenever the user doubts, disputes or asks whether something is true, or when you are about to rely on a specific number, check it first. Say a few words such as "let me check the paper" before calling it. Report the verdict honestly and quote briefly.
- find_new_evidence: when the user asks for newer, more, or contrary evidence, or about something the review doesn't cover. Tell them the results were not part of the original review.
- search_report: to look up a detail from the review or the evidence cards you don't remember.
- show_section: to bring a part of the review onto the user's screen when you discuss it.
- pin_note: when the conversation produces a sharp insight, a strong objection, or an open question worth keeping. One sentence.`;

const MODES = {
  partner: {
    instructions: 'Be a candid, balanced colleague. Explain clearly, steelman both sides of any disagreement, and give your own calibrated view when asked.',
    opening: (v) => `I've been through all ${v.paper_count} papers on ${v.review_title}. Do you want the headline first, or shall we start with the part you find hardest to believe?`,
  },
  skeptic: {
    instructions: "Play devil's advocate. Challenge the review's conclusions and every confident claim the user makes. Probe weak methods, small samples, missing comparisons, conflicts of interest and alternative explanations. Concede only when the evidence, checked with your tools, really supports the point. Stay good-humoured and fair.",
    opening: (v) => `Fair warning: I'm going to argue against this review. ${v.paper_count} papers sounds like a lot, but I'm not convinced. Tell me which conclusion you trust most, and I'll try to take it apart.`,
  },
  examiner: {
    instructions: 'Act as a friendly but rigorous examiner. Ask the user one probing question at a time about the evidence, wait for their answer, evaluate it against the sources (verify when needed), then follow up or move on. After five or six questions, give a short assessment of how well they know the evidence.',
    opening: (v) => `Let's see how well you know the evidence on ${v.review_title}. First question: in one or two sentences, what is the strongest finding in this review, and which study is it based on?`,
  },
};

export const CLIENT_TOOLS = [
  {
    type: 'client', name: 'verify_claim', expects_response: true, response_timeout_secs: 60,
    description: 'Check a specific claim against the full text and abstracts of the cited papers. Use whenever a claim is disputed or a number matters. Returns a verdict (supported, partial, unsupported, not_found), an explanation and short quotes.',
    parameters: { type: 'object', required: ['claim'], properties: {
      claim: { type: 'string', description: 'The exact claim to check, as one sentence.' },
      citation_numbers: { type: 'string', description: 'Comma-separated source numbers the claim relies on, e.g. "3, 7". Empty string to search all sources.' },
    } },
  },
  {
    type: 'client', name: 'find_new_evidence', expects_response: true, response_timeout_secs: 90,
    description: 'Search scholarly databases live for papers not in the review, e.g. newer studies or counter-evidence. Returns up to five papers with whether each supports or challenges the question.',
    parameters: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'A 3 to 8 word academic search query.' },
    } },
  },
  {
    type: 'client', name: 'search_report', expects_response: true, response_timeout_secs: 15,
    description: 'Look up passages in the review text and the evidence cards for each source.',
    parameters: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'What to look for.' },
    } },
  },
  {
    type: 'client', name: 'show_source', expects_response: false,
    description: 'Show a source on the user\'s screen. Call whenever you mention a specific source.',
    parameters: { type: 'object', required: ['citation_number'], properties: {
      citation_number: { type: 'string', description: 'The source number, e.g. "4".' },
    } },
  },
  {
    type: 'client', name: 'show_section', expects_response: false,
    description: 'Scroll the user\'s screen to a part of the review: bottom line, background, evidence, disagreements, quality, open questions, conclusion, sources, matrix, or map.',
    parameters: { type: 'object', required: ['section'], properties: {
      section: { type: 'string', description: 'Which part to show.' },
    } },
  },
  {
    type: 'client', name: 'pin_note', expects_response: false,
    description: 'Save a one-sentence note to the user\'s debate notes.',
    parameters: { type: 'object', required: ['note'], properties: {
      note: { type: 'string', description: 'The note, one sentence.' },
      kind: { type: 'string', description: 'insight, objection, or question.' },
    } },
  },
];

const PLACEHOLDERS = {
  research_question: 'the research question',
  review_title: 'the review',
  report_brief: '(no review loaded)',
  sources_brief: '(no sources loaded)',
  audit_brief: '(no audit)',
  mode_instructions: MODES.partner.instructions,
  opening_line: 'Hi, shall we talk through the review?',
  paper_count: '0',
};

function agentConfig(toolIds) {
  const prompt = { prompt: AGENT_PROMPT, llm: E.agentLlm, temperature: 0.5 };
  if (toolIds) prompt.tool_ids = toolIds;
  else prompt.tools = CLIENT_TOOLS;
  const conversation_config = {
    agent: {
      first_message: '{{opening_line}}',
      language: 'en',
      prompt,
      dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
    },
  };
  if (E.agentVoice) conversation_config.tts = { voice_id: E.agentVoice };
  return { name: 'Marginalia research partner', conversation_config, tags: ['marginalia'] };
}

const specHash = createHash('sha1').update(JSON.stringify([AGENT_PROMPT, CLIENT_TOOLS, E.agentLlm, E.agentVoice, PLACEHOLDERS])).digest('hex').slice(0, 12);
let ensuring = null;
let lastAgentError = '';

export function agentStatus() {
  if (!E.apiKey) return { configured: false, ready: false, message: 'Add ELEVENLABS_API_KEY to .env to enable voice debate and audio overviews.' };
  if (E.agentId) return { configured: true, ready: true, agentId: E.agentId, managed: false };
  const saved = existsSync(agentFile) ? JSON.parse(readFileSync(agentFile, 'utf8')) : null;
  return { configured: true, ready: !!(saved && saved.agentId && saved.spec === specHash), agentId: saved && saved.agentId, managed: true, error: lastAgentError || undefined };
}

export async function ensureAgent() {
  if (E.agentId) return E.agentId;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    const saved = existsSync(agentFile) ? JSON.parse(readFileSync(agentFile, 'utf8')) : null;
    if (saved && saved.agentId && saved.spec === specHash) return saved.agentId;

    // Tools are standalone resources referenced by id; fall back to inline tools on older APIs.
    // Reuse tools and the agent by name, so redeploys on hosts with no persistent disk
    // (Render, Railway) don't pile up copies in your ElevenLabs workspace.
    let existingTools = [];
    try { existingTools = (await xi('/v1/convai/tools')).tools || []; } catch (e) { existingTools = []; }
    let toolIds = null;
    try {
      toolIds = [];
      for (const t of CLIENT_TOOLS) {
        const found = existingTools.find((x) => x.tool_config && x.tool_config.name === t.name && x.tool_config.type === 'client');
        if (found) {
          try { await xi(`/v1/convai/tools/${found.id}`, { method: 'PATCH', body: { tool_config: t } }); } catch (e) { /* keep the existing definition */ }
          toolIds.push(found.id);
        } else {
          toolIds.push((await xi('/v1/convai/tools', { method: 'POST', body: { tool_config: t } })).id);
        }
      }
    } catch (e) {
      toolIds = null;
    }

    let agentId = saved && saved.agentId;
    if (!agentId) {
      try {
        const list = await xi('/v1/convai/agents?search=' + encodeURIComponent('Marginalia research partner'));
        const hit = (list.agents || []).find((a) => a.name === 'Marginalia research partner');
        if (hit) agentId = hit.agent_id;
      } catch (e) { /* listing is optional */ }
    }
    const body = agentConfig(toolIds);
    if (agentId) {
      try { await xi(`/v1/convai/agents/${agentId}`, { method: 'PATCH', body }); } catch (e) { if (e.status === 404) agentId = null; else throw e; }
    }
    if (!agentId) {
      try {
        agentId = (await xi('/v1/convai/agents/create', { method: 'POST', body })).agent_id;
      } catch (e) {
        if (e.status !== 422) throw e;
        delete body.conversation_config.agent.dynamic_variables; // older schema
        agentId = (await xi('/v1/convai/agents/create', { method: 'POST', body })).agent_id;
      }
    }
    if (saved && saved.toolIds && toolIds) for (const id of saved.toolIds) if (!toolIds.includes(id)) xi(`/v1/convai/tools/${id}`, { method: 'DELETE' }).catch(() => {});
    writeFileSync(agentFile, JSON.stringify({ agentId, toolIds, spec: specHash, createdAt: Date.now() }, null, 2));
    lastAgentError = '';
    return agentId;
  })();
  try { return await ensuring; } catch (e) { lastAgentError = e.message; throw e; } finally { ensuring = null; }
}

function briefFor(s) {
  const refs = (s.papers || []).filter((p) => p.included).sort((a, b) => a.n - b.n);
  const short = (p) => {
    const a = p.authors || [];
    const last = (x) => String(x).trim().split(/\s+/).pop();
    return a.length > 2 ? `${last(a[0])} et al.` : a.map(last).join(' & ') || 'Unknown';
  };
  const sources = refs.map((p) => `[${p.n}] ${short(p)}, ${p.year || 'n.d.'}: ${p.title}. ${p.card ? (p.card.studyType ? p.card.studyType + '. ' : '') + (p.card.keyResult || p.card.tldr || '') : ''}`).join('\n');
  const a = s.audit;
  const flagged = a && a.items ? a.items.filter((x) => x.verdict !== 'supported').slice(0, 5).map((x) => `- "${x.sentence.slice(0, 160)}" → ${x.verdict}: ${x.note}`).join('\n') : '';
  return {
    report: (s.report || '').replace(/\n{3,}/g, '\n\n').slice(0, 11000),
    sources: sources.slice(0, 7000),
    audit: a ? `${a.checked} cited sentences were checked against their sources: ${a.supported} supported, ${a.partial} partly supported, ${a.unsupported} unsupported (integrity ${a.score}%).${flagged ? '\nFlagged sentences:\n' + flagged : ''}` : 'No audit available.',
    count: refs.length,
  };
}

export async function startVoice(sessionId, mode = 'partner') {
  const s = store.get(sessionId);
  if (!s || s.status !== 'done') throw Object.assign(new Error('Finish a research run before starting a debate.'), { status: 400 });
  const agentId = await ensureAgent();
  const { signed_url } = await xi(`/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  const m = MODES[mode] || MODES.partner;
  const b = briefFor(s);
  const vars = {
    research_question: s.question,
    review_title: s.title || s.question,
    report_brief: b.report,
    sources_brief: b.sources,
    audit_brief: b.audit,
    mode_instructions: m.instructions,
    paper_count: String(b.count),
  };
  vars.opening_line = m.opening(vars);
  return { signedUrl: signed_url, agentId, dynamicVariables: vars, mode };
}

// ─── Audio overview (two voices, one file per line for transcript sync) ────
let voiceFallback = null;
async function fallbackVoices() {
  if (voiceFallback) return voiceFallback;
  const { voices = [] } = await xi('/v1/voices');
  const female = voices.find((v) => (v.labels && v.labels.gender) === 'female') || voices[0];
  const male = voices.find((v) => (v.labels && v.labels.gender) === 'male' && v !== female) || voices[1] || voices[0];
  voiceFallback = { mira: female && female.voice_id, theo: male && male.voice_id };
  return voiceFallback;
}

async function tts(text, voiceId, prev, next) {
  return xi(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    raw: true,
    timeout: 120000,
    body: {
      text,
      model_id: E.ttsModel,
      voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
      previous_text: prev || undefined,
      next_text: next || undefined,
    },
  });
}

export async function renderPodcast(sessionId) {
  const s = store.get(sessionId);
  if (!s || !s.podcast || !s.podcast.lines || !s.podcast.lines.length) throw Object.assign(new Error('This session has no audio overview script.'), { status: 400 });
  if (s.audio && s.audio.lines && s.audio.lines.length === s.podcast.lines.length && s.audio.complete) return s.audio;
  const dir = join(config.dataDir, 'media', sessionId);
  mkdirSync(dir, { recursive: true });
  let voices = { mira: E.voiceMira, theo: E.voiceTheo };
  const lines = s.podcast.lines;
  const files = new Array(lines.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < lines.length) {
      const i = next++;
      const l = lines[i];
      const file = `line-${String(i).padStart(2, '0')}.mp3`;
      const path = join(dir, file);
      if (!existsSync(path)) {
        let buf;
        try {
          buf = await tts(l.text, voices[l.speaker], lines[i - 1] && lines[i - 1].text, lines[i + 1] && lines[i + 1].text);
        } catch (e) {
          if (![400, 404, 422].includes(e.status)) throw e;
          voices = await fallbackVoices();
          buf = await tts(l.text, voices[l.speaker]);
        }
        writeFileSync(path, buf);
      }
      files[i] = file;
      done++;
      store.pushEvent(sessionId, 'audio', { done, total: lines.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const audio = { complete: true, voices, model: E.ttsModel, lines: lines.map((l, i) => ({ ...l, url: `/media/${sessionId}/${files[i]}` })), at: Date.now() };
  store.update(sessionId, { audio });
  return audio;
}

export function podcastMp3Paths(sessionId) {
  const s = store.get(sessionId);
  if (!s || !s.audio || !s.audio.complete) return null;
  return s.audio.lines.map((l) => join(config.dataDir, 'media', sessionId, l.url.split('/').pop()));
}
