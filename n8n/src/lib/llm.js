// ─── LLM client: Anthropic + any OpenAI-compatible endpoint ─────────────────

function parseJSONLoose(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) throw new Error('No JSON found in model output');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  let body = s.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (e) {
    // Common repairs: trailing commas, smart quotes.
    body = body.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    return JSON.parse(body);
  }
}

async function llm({ system = '', prompt, json = false, tier = 'main', maxTokens = 2500, temperature = 0.3, timeout = 240000 }) {
  const C = getConfig().llm;
  if (!C.ready) {
    throw new Error('No language model is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY (or LLM_PROVIDER + LLM_BASE_URL + LLM_MODEL) in .env and restart.');
  }
  const model = tier === 'fast' ? C.fastModel || C.model : C.model;
  const sys = json
    ? (system ? system + '\n\n' : '') + 'Respond with one valid JSON object and nothing else: no prose before or after, no code fences.'
    : system;
  let text = '';
  RT.usage.calls += 1;

  if (C.provider === 'anthropic') {
    const res = await http({
      method: 'POST',
      url: C.baseUrl + '/v1/messages',
      headers: { 'x-api-key': C.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: { model, max_tokens: maxTokens, system: sys || undefined, temperature, messages: [{ role: 'user', content: prompt }] },
      timeout,
      retries: 3,
    });
    text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (res.usage) {
      RT.usage.inputTokens += res.usage.input_tokens || 0;
      RT.usage.outputTokens += res.usage.output_tokens || 0;
    }
  } else {
    const messages = [];
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content: prompt });
    const body = { model, messages };
    const reasoning = C.provider === 'openai' && /^(gpt-5|o\d)/i.test(model);
    if (reasoning) {
      body.max_completion_tokens = maxTokens + 6000;
      body.reasoning_effort = 'low';
    } else {
      body.max_tokens = maxTokens;
      body.temperature = temperature;
    }
    if (json && (C.provider === 'openai' || C.provider === 'gemini')) body.response_format = { type: 'json_object' };
    const headers = { 'content-type': 'application/json' };
    if (C.apiKey) headers.authorization = 'Bearer ' + C.apiKey;
    if (C.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/marginalia-research';
      headers['X-Title'] = 'Marginalia';
    }
    const res = await http({ method: 'POST', url: C.baseUrl + '/chat/completions', headers, body, timeout, retries: 3 });
    const msg = (res.choices && res.choices[0] && res.choices[0].message) || {};
    text = Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : msg.content || '';
    if (res.usage) {
      RT.usage.inputTokens += res.usage.prompt_tokens || 0;
      RT.usage.outputTokens += res.usage.completion_tokens || 0;
    }
  }

  if (!json) return String(text).trim();
  try {
    return parseJSONLoose(text);
  } catch (e) {
    const fixed = await llm({
      system: 'You repair malformed JSON. Output only the corrected JSON.',
      prompt: 'Fix this so it is valid JSON, keeping all content:\n\n' + String(text).slice(0, 14000),
      tier: 'fast',
      maxTokens,
    });
    return parseJSONLoose(fixed);
  }
}

/** Merge this node's LLM usage into the running state. */
function recordUsage(state) {
  state.usage = state.usage || { calls: 0, inputTokens: 0, outputTokens: 0 };
  state.usage.calls += RT.usage.calls;
  state.usage.inputTokens += RT.usage.inputTokens;
  state.usage.outputTokens += RT.usage.outputTokens;
  RT.usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
}

async function embedTexts(texts) {
  const E = getConfig().embeddings;
  if (!E || !texts.length) return null;
  const out = [];
  for (const batch of chunkArray(texts, 64)) {
    const body = { model: E.model, input: batch.map((t) => String(t).slice(0, 6000)) };
    if (E.dimensions) body.dimensions = E.dimensions;
    const res = await http({
      method: 'POST',
      url: E.baseUrl + '/embeddings',
      headers: { authorization: 'Bearer ' + E.apiKey, 'content-type': 'application/json' },
      body,
      timeout: 60000,
      retries: 2,
    });
    for (const row of res.data || []) out.push((row.embedding || []).map((x) => Math.round(x * 1000) / 1000));
  }
  return out.length === texts.length ? out : null;
}
