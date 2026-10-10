// Small shared helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? (vals[i] && vals[i].__html !== undefined ? vals[i].__html : Array.isArray(vals[i]) ? vals[i].map((v) => (v && v.__html !== undefined ? v.__html : esc(v))).join('') : esc(vals[i])) : ''), '');
}
export const raw = (s) => ({ __html: String(s ?? '') });

export function authorShort(p) {
  const a = p.authors || [];
  const last = (n) => String(n).trim().split(/\s+/).pop();
  if (!a.length) return 'Unknown';
  if (a.length === 1) return last(a[0]);
  if (a.length === 2) return `${last(a[0])} & ${last(a[1])}`;
  return `${last(a[0])} et al.`;
}

export function authorsLine(p, max = 4) {
  const a = p.authors || [];
  return a.length > max ? a.slice(0, max).join(', ') + ' et al' : a.join(', ') || 'Unknown authors';
}

export const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
export const fmtNum = (n) => (n == null ? '–' : n >= 10000 ? Math.round(n / 1000) + 'k' : n.toLocaleString());

export function timeAgo(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' h ago';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' d ago';
  return new Date(t).toLocaleDateString();
}

// Must mirror n8n/src/lib/text.js so audit verdicts line up with sentences.
export function splitSentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9“"(\[])/).map((s) => s.trim()).filter(Boolean);
}
export function sentenceKey(s) {
  return String(s || '').replace(/\[[\d,\s–-]+\]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
}
export function parseCitations(text) {
  const out = [];
  for (const m of String(text).matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(',')) {
      const r = part.split(/[-–]/).map((x) => parseInt(x.trim(), 10));
      if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 20) for (let n = r[0]; n <= r[1]; n++) out.push(n);
      else if (!isNaN(r[0])) out.push(r[0]);
    }
  }
  return Array.from(new Set(out));
}

const STOP = new Set('a an and are as at be by for from has have in is it of on or that the this to was were with which what how does do why'.split(' '));
export const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

let toastTimer;
export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export const QCOLORS = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)'];
export const qColor = (id) => QCOLORS[(parseInt(String(id || 'q1').slice(1), 10) - 1) % QCOLORS.length] || 'var(--ink-3)';

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
