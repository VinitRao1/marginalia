// Renders the review's Markdown with sentence spans (for audit marks and the
// voice agent's highlighter) and clickable citations.
import { esc, splitSentences, sentenceKey, parseCitations } from './util.js';

function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\s?\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g, (m) => `<span class="cites">${parseCitations(m).map((n) => `<button class="cite" data-n="${n}" aria-label="Source ${n}">${n}</button>`).join('')}</span>`);
  return s;
}

function sentences(text, audit) {
  return splitSentences(text).map((s) => {
    const key = sentenceKey(s);
    const refs = parseCitations(s);
    const v = audit.get(key);
    const cls = v ? ` v-${v.verdict}` : '';
    const mark = v && v.verdict !== 'supported' ? `<span class="vmark v-${v.verdict}" title="Citation check: ${v.verdict === 'partial' ? 'partly supported' : 'not supported'}"></span>` : '';
    return `<span class="s${cls}" data-k="${esc(key)}"${refs.length ? ` data-refs="${refs.join(',')}"` : ''}>${inline(s)}${mark}</span>`;
  }).join(' ');
}

export const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function renderReport(md, auditItems = []) {
  const audit = new Map(auditItems.map((a) => [a.key, a]));
  const lines = String(md || '').split('\n');
  const out = [];
  let para = [];
  let list = [];
  let section = '';
  let firstInSection = true;
  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(' ');
    const cls = /bottom line/i.test(section) && firstInSection ? ' class="bottom-line"' : '';
    out.push(`<p${cls}>${sentences(text, audit)}</p>`);
    para = [];
    firstInSection = false;
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((li) => `<li>${sentences(li, audit)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const t = line.trim();
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const level = Math.min(3, Math.max(2, h[1].length));
      const text = h[2].replace(/\[[\d,\s–-]+\]/g, '').trim();
      if (level === 2) { section = text; firstInSection = true; }
      out.push(`<h${level} id="sec-${slug(text)}">${esc(text)}</h${level}>`);
    } else if (/^[-*]\s+/.test(t)) {
      flushPara();
      list.push(t.replace(/^[-*]\s+/, ''));
    } else if (!t) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(t);
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}
