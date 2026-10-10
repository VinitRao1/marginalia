// ─── Runtime: HTTP, env, small async helpers ────────────────────────────────
// This file is inlined at the top of every Code node by n8n/build.mjs.
// Inside n8n, `this.helpers.httpRequest` is used; the local engine provides a
// compatible shim, so the exact same code runs in both places.

// n8n's task runner exposes `helpers` as a sandbox global (and as `this.helpers`
// in its default mode); check both so the code works in every runner mode.
const RT = {
  // eslint-disable-next-line no-undef
  helpers: (typeof this !== 'undefined' && this && this.helpers) ? this.helpers : (typeof helpers !== 'undefined' ? helpers : null),
  usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
};

function envGet(key, fallback = '') {
  try {
    // eslint-disable-next-line no-undef
    const v = $env[key];
    return v === undefined || v === null || v === '' ? fallback : String(v).trim();
  } catch (e) {
    return fallback;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    .join('&');
}

function httpStatusOf(err) {
  if (!err) return 0;
  const candidates = [
    err.status,
    err.statusCode,
    err.httpCode,
    err.response && err.response.status,
    err.cause && err.cause.status,
    err.context && err.context.data && err.context.data.status,
  ];
  for (const c of candidates) {
    const n = parseInt(c, 10);
    if (n >= 100 && n < 600) return n;
  }
  const m = String(err.message || '').match(/\b(4\d\d|5\d\d)\b/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * http({ method, url, query, headers, body, timeout, responseType: 'json'|'text', retries })
 * Retries on 429 / 5xx / network failures with exponential backoff.
 */
async function http(opts) {
  const {
    method = 'GET',
    url,
    query,
    headers = {},
    body,
    timeout = 30000,
    responseType = 'json',
    retries = 2,
  } = opts;
  const fullUrl = query ? url + (url.includes('?') ? '&' : '?') + encodeQuery(query) : url;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let data;
      if (RT.helpers && typeof RT.helpers.httpRequest === 'function') {
        const req = { method, url: fullUrl, headers: { ...headers }, timeout };
        if (body !== undefined) {
          req.body = body;
          req.json = true;
          if (!req.headers['content-type'] && !req.headers['Content-Type']) req.headers['content-type'] = 'application/json';
        }
        if (responseType === 'json') req.json = true;
        data = await RT.helpers.httpRequest(req);
      } else {
        const res = await fetch(fullUrl, {
          method,
          headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeout),
        });
        const text = await res.text();
        if (!res.ok) {
          const e = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
          e.status = res.status;
          throw e;
        }
        data = text;
      }
      if (responseType === 'json' && typeof data === 'string') data = data.trim() ? JSON.parse(data) : {};
      if (responseType === 'text' && typeof data !== 'string') {
        data = data && typeof data.toString === 'function' && !(data.constructor === Object) ? data.toString('utf8') : JSON.stringify(data);
      }
      return data;
    } catch (err) {
      lastErr = err;
      const status = httpStatusOf(err);
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(900 * Math.pow(2, attempt) + Math.floor(Math.random() * 400));
    }
  }
  const status = httpStatusOf(lastErr);
  const msg = (lastErr && lastErr.message) || String(lastErr);
  const host = String(fullUrl).replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  const wrapped = new Error(`${method} ${host} failed${status ? ' (' + status + ')' : ''}: ${msg.slice(0, 400)}`);
  wrapped.status = status;
  throw wrapped;
}

/** Run `fn` over `items` with at most `limit` in flight. Keeps order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clampText(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}
