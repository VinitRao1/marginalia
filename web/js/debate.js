// Voice debate with an ElevenLabs agent that knows the review.
// The agent's client tools run here in the browser: some drive the UI
// (show_source, show_section, pin_note), others relay to n8n through the
// studio (verify_claim, find_new_evidence) and return the result to the agent.
import { api } from './api.js';
import { html, raw, esc, authorShort, tokens, splitSentences, toast, cssVar } from './util.js';

const MODES = [
  ['partner', 'Partner', 'Balanced colleague'],
  ['skeptic', 'Skeptic', 'Argues against it'],
  ['examiner', 'Examiner', 'Tests what you know'],
];

async function loadSdk() {
  const urls = ['https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm', 'https://esm.sh/@elevenlabs/client'];
  let last;
  for (const u of urls) {
    try { const m = await import(u); if (m.Conversation) return m; } catch (e) { last = e; }
  }
  throw new Error('Could not load the ElevenLabs client library. Check your internet connection. ' + (last ? last.message : ''));
}

export class Debate {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.open = false;
    this.mode = 'partner';
    this.conv = null;
    this.connected = false;
    this.inBuf = [];
    this.outBuf = [];
    this.agentMode = 'listening';
    this.onCite = (e) => {
      const c = e.target.closest('.cite');
      if (c && this.connected && this.conv) {
        const p = this.paper(+c.dataset.n);
        if (p) this.conv.sendContextualUpdate(`The user is now looking at source ${p.n}: ${authorShort(p)} (${p.year}), "${p.title}".`);
      }
    };
  }

  get session() { return this.app.session; }
  paper(n) { return (this.session.papers || []).find((p) => p.included && p.n === n); }

  toggle() { this.open ? this.hide() : this.show(); }
  show() { this.open = true; this.el.hidden = false; document.getElementById('shell').classList.add('debate-open'); this.render(); document.addEventListener('click', this.onCite); }
  hide() {
    this.open = false;
    this.el.hidden = true;
    document.getElementById('shell').classList.remove('debate-open');
    document.removeEventListener('click', this.onCite);
    document.getElementById('debateBtn').setAttribute('aria-pressed', 'false');
  }
  async sessionChanged() { if (this.connected) await this.stop(); if (this.open) this.render(); }

  render() {
    const el = (this.app.status && this.app.status.elevenlabs) || {};
    if (!el.configured) {
      this.el.innerHTML = html`<div class="debate-head"><h2>Debate the review</h2><button class="icon-btn" data-close aria-label="Close">${raw('<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>')}</button></div>
        <div class="debate-empty"><h3>Talk it through out loud</h3>
        <p>Add <code>ELEVENLABS_API_KEY</code> to your <code>.env</code> and restart the studio. Marginalia creates its own ElevenLabs agent that has read this review, checks claims against the papers while you talk, and can search for new evidence on request.</p>
        <p>Three ways to talk: a balanced <b>partner</b>, a <b>skeptic</b> who argues against the conclusions, or an <b>examiner</b> who quizzes you on the evidence.</p></div>`;
      this.el.querySelector('[data-close]').addEventListener('click', () => this.hide());
      return;
    }
    this.el.innerHTML = html`<div class="debate-head"><h2>Debate the review</h2><button class="icon-btn" data-close aria-label="Close">${raw('<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>')}</button></div>
      <div class="modes" role="group" aria-label="Debate style">${raw(MODES.map(([k, l, d]) => `<button data-mode="${k}" aria-pressed="${k === this.mode}" ${this.connected ? 'disabled' : ''}><b>${l}</b>${d}</button>`).join(''))}</div>
      <div class="trace-wrap"><canvas class="trace" id="trace" aria-hidden="true"></canvas>
        <div class="trace-legend"><span><i></i>Marginalia</span><span><i class="you"></i>You</span></div></div>
      <div class="talk-row">
        <button class="primary talk ${this.connected ? 'on-air' : ''}" id="talk">${this.connected ? 'End conversation' : 'Start talking'}</button>
        <button class="mute" id="mute" aria-pressed="false" aria-label="Mute microphone" ${this.connected ? '' : 'disabled'}>${raw('<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>')}</button>
      </div>
      <div class="agent-state" id="agentState">${this.connected ? '' : 'Uses your microphone. Ask about any finding, or say “I don’t buy that”.'}</div>
      <div class="convo" id="convo" aria-live="polite"></div>
      <form class="typebox" id="typebox"><input id="typed" placeholder="Or type to the agent" autocomplete="off" aria-label="Type a message"><button class="secondary" type="submit">Send</button></form>`;
    const q = (s) => this.el.querySelector(s);
    q('[data-close]').addEventListener('click', () => this.hide());
    this.el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.render(); }));
    q('#talk').addEventListener('click', () => (this.connected ? this.stop() : this.start()));
    q('#mute').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      if (this.conv) this.conv.setMicMuted(on);
    });
    q('#typebox').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = q('#typed').value.trim();
      if (!t) return;
      if (!this.connected) { toast('Start the conversation first'); return; }
      this.conv.sendUserMessage(t);
      this.say('user', t);
      q('#typed').value = '';
    });
    this.convo = q('#convo');
    for (const item of this.history || []) this.convo.appendChild(item);
    if (!(this.history || []).length) {
      const refs = (this.session.papers || []).filter((p) => p.included);
      const a = refs[0], b = refs[2] || refs[1];
      this.convo.innerHTML = html`<div class="convo-hint"><b>Things to try</b>
        <q>What's the single strongest piece of evidence here?</q>
        ${raw(a ? `<q>I don't buy the ${esc(authorShort(a))} result. Check it.</q>` : '')}
        <q>Find anything newer that disagrees with the bottom line.</q>
        ${raw(b ? `<q>Show me where the review relies on ${esc(authorShort(b))}.</q>` : '')}</div>`;
    }
    this.startTrace();
  }

  setState(text) { const s = this.el.querySelector('#agentState'); if (s) s.textContent = text; }

  say(who, text) {
    if (!this.convo) return;
    const d = document.createElement('div');
    d.className = `msg ${who}`;
    d.innerHTML = html`<span class="who">${who === 'ai' ? 'Marginalia' : 'You'}</span>${text}`;
    this.push(d);
  }
  push(node) {
    this.history = this.history || [];
    this.history.push(node);
    if (this.convo) { this.convo.appendChild(node); this.convo.scrollTop = this.convo.scrollHeight; }
    return node;
  }
  card(cls, inner) {
    const d = document.createElement('div');
    d.className = 'toolcard ' + cls;
    d.innerHTML = inner;
    return this.push(d);
  }

  async start() {
    const btn = this.el.querySelector('#talk');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const [{ Conversation }, voice] = await Promise.all([loadSdk(), api.voice(this.session.id, this.mode)]);
      this.history = [];
      this.convo.innerHTML = '';
      this.conv = await Conversation.startSession({
        signedUrl: voice.signedUrl,
        connectionType: 'websocket',
        dynamicVariables: voice.dynamicVariables,
        clientTools: this.tools(),
        onConnect: () => { this.connected = true; this.render(); this.setState('Listening'); },
        onDisconnect: () => { this.connected = false; this.conv = null; if (this.open) this.render(); this.setState('Conversation ended'); },
        onError: (msg) => { toast(typeof msg === 'string' ? msg : 'Voice connection error', 5000); },
        onModeChange: ({ mode }) => { this.agentMode = mode; this.setState(mode === 'speaking' ? 'Speaking' : 'Listening'); },
        onMessage: (m) => {
          const who = (m.source || m.role) === 'user' ? 'user' : 'ai';
          if (m.message) this.say(who, m.message);
        },
      });
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Allow microphone access to talk. You can still read the review.' : e.message, 6000);
      this.connected = false;
      this.render();
    }
  }

  async stop() {
    try { if (this.conv) await this.conv.endSession(); } catch { /* already closed */ }
    this.conv = null;
    this.connected = false;
    if (this.open) this.render();
  }

  raise(text) {
    if (!this.connected) { toast('Start the conversation first'); return; }
    const msg = `About this passage in the review: "${text}". Is it right? Check it against the sources.`;
    this.conv.sendUserMessage(msg);
    this.say('user', msg);
  }

  // ─── Client tools ─────────────────────────────────────────────────────────
  tools() {
    const s = () => this.session;
    return {
      verify_claim: async ({ claim, citation_numbers }) => {
        const card = this.card('', html`<div class="h"><span class="spin"></span>Checking the papers</div><div>${claim}</div>`);
        const nums = String(citation_numbers || '').match(/\d+/g) || [];
        if (nums[0]) this.app.showSource(+nums[0], { sweep: true });
        try {
          const v = await api.verify(s().id, claim, nums.join(','));
          const label = { supported: 'Supported', partial: 'Partly supported', unsupported: 'Not supported', not_found: 'Not in the sources' }[v.verdict];
          card.className = `toolcard v-${v.verdict}`;
          card.innerHTML = html`<div class="h">${label}</div><div>${claim}</div>${raw((v.evidence || []).map((e) => `<div style="margin-top:6px;font-style:italic">[${e.n}] “${esc(e.quote)}”</div>`).join(''))}`;
          return JSON.stringify({ verdict: v.verdict, confidence: v.confidence, explanation: v.explanation, quotes: v.evidence });
        } catch (e) {
          card.className = 'toolcard v-not_found';
          card.innerHTML = html`<div class="h">Could not check</div><div>${e.message}</div>`;
          return `The check failed: ${e.message}`;
        }
      },
      find_new_evidence: async ({ query }) => {
        const card = this.card('', html`<div class="h"><span class="spin"></span>Searching the literature</div><div>${query}</div>`);
        try {
          const r = await api.evidence(s().id, query);
          card.innerHTML = html`<div class="h">${r.papers.length ? `Found ${r.papers.length} new papers` : 'Nothing new and relevant'}</div><div>${query}</div>
            <ul>${raw(r.papers.map((p) => `<li><a href="${esc(p.url || (p.doi ? 'https://doi.org/' + p.doi : '#'))}" target="_blank" rel="noopener">${esc(p.title)}</a> (${esc(authorShort(p))}, ${p.year || 'n.d.'}) <span class="badge ${p.stance === 'challenges' ? 'challenges' : p.stance === 'supports' ? 'supports' : ''}">${esc(p.stance)}</span></li>`).join(''))}</ul>`;
          if (!r.papers.length) return 'No new relevant papers were found for that query.';
          return JSON.stringify(r.papers.map((p) => ({ title: p.title, authors: authorShort(p), year: p.year, venue: p.venue, stance: p.stance, why: p.why, abstract: (p.abstract || '').slice(0, 500) })));
        } catch (e) {
          card.innerHTML = html`<div class="h">Search failed</div><div>${e.message}</div>`;
          return `The search failed: ${e.message}`;
        }
      },
      search_report: async ({ query }) => {
        const q = new Set(tokens(query));
        const pool = [];
        for (const sent of splitSentences(s().report.replace(/^#+.*$/gm, ''))) pool.push({ text: sent, src: 'review' });
        for (const p of (s().papers || []).filter((x) => x.included)) {
          const c = p.card || {};
          pool.push({ text: `[${p.n}] ${authorShort(p)} ${p.year}: ${p.title}. ${c.studyType || ''}. ${c.keyResult || c.tldr || ''} Caveats: ${c.limitations || 'not stated'}.`, src: 'source ' + p.n });
        }
        const scored = pool.map((x) => ({ ...x, score: tokens(x.text).filter((w) => q.has(w)).length })).filter((x) => x.score).sort((a, b) => b.score - a.score).slice(0, 6);
        return scored.length ? scored.map((x) => `(${x.src}) ${x.text}`).join('\n') : 'Nothing in the review matches that.';
      },
      show_source: ({ citation_number }) => {
        const n = parseInt(String(citation_number).match(/\d+/) || '0', 10);
        if (n) this.app.showSource(n, { sweep: true });
        return 'shown';
      },
      show_section: ({ section }) => { this.app.showSection(section); return 'shown'; },
      pin_note: async ({ note, kind }) => {
        try {
          const saved = await api.note(s().id, note, kind || 'insight', 'agent');
          (s().notes = s().notes || []).push(saved);
          const d = document.createElement('div');
          d.className = 'notecard';
          d.innerHTML = html`<small>Pinned ${kind || 'insight'}</small>${note}`;
          this.push(d);
        } catch { /* non-critical */ }
        return 'pinned';
      },
    };
  }

  // ─── Pen trace: a two-channel strip chart of the conversation ───────────
  startTrace() {
    cancelAnimationFrame(this.raf);
    const c = this.el.querySelector('#trace');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const fit = () => { const r = c.getBoundingClientRect(); c.width = r.width * dpr; c.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return r; };
    let r = fit();
    let t = 0;
    const len0 = Math.floor(r.width / 2);
    while (this.inBuf.length < len0) { this.inBuf.push(Math.random() * 0.006); this.outBuf.push(Math.random() * 0.006); }
    const draw = () => {
      if (!this.open || !c.isConnected) return;
      if (c.width !== Math.round(c.getBoundingClientRect().width * dpr)) r = fit();
      const W = r.width, H = r.height, mid = H / 2;
      const len = Math.floor(W / 2);
      const vin = this.conv ? this.conv.getInputVolume() : 0;
      const vout = this.conv ? this.conv.getOutputVolume() : 0;
      t++;
      const idle = () => (Math.sin(t / 9) * 0.006 + (Math.random() - 0.5) * 0.008);
      this.inBuf.push(this.connected ? Math.min(1, vin * 1.6) : Math.abs(idle()));
      this.outBuf.push(this.connected ? Math.min(1, vout * 1.4) : Math.abs(idle()));
      while (this.inBuf.length > len) this.inBuf.shift();
      while (this.outBuf.length > len) this.outBuf.shift();
      ctx.clearRect(0, 0, W, H);
      // Recorder paper: moving vertical rules.
      ctx.strokeStyle = cssVar('--rule-2');
      ctx.lineWidth = 1;
      const off = (t * 2) % 24;
      for (let x = W - off; x > 0; x -= 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.strokeStyle = cssVar('--rule');
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
      const pen = (buf, color, dir) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const start = W - buf.length * 2;
        buf.forEach((v, i) => {
          const wobble = Math.sin((i + t) * 0.9) * v * 0.35;
          const y = mid + dir * (2 + (v + wobble) * (mid - 8));
          i ? ctx.lineTo(start + i * 2, y) : ctx.moveTo(start + i * 2, y);
        });
        ctx.stroke();
        const last = buf[buf.length - 1] || 0;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(W - 2, mid + dir * (2 + last * (mid - 8)), 2.6, 0, Math.PI * 2); ctx.fill();
      };
      pen(this.outBuf, cssVar('--ink'), -1);
      pen(this.inBuf, cssVar('--verdigris'), 1);
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }
}
