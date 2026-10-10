// Listen: the two-voice audio overview, performed by ElevenLabs (or the
// browser's own voices as a preview), with the transcript following along.
import { api } from './api.js';
import { html, raw, esc, toast } from './util.js';

const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

export function renderListen(stage, s, app) {
  const pod = s.podcast || { lines: [] };
  const el = (app.status && app.status.elevenlabs) || {};
  let audio = s.audio && s.audio.complete ? s.audio : null;
  let idx = 0;
  let playing = false;
  let mode = audio ? 'studio' : 'none';
  const player = new Audio();
  player.preload = 'auto';
  let unlisten = null;

  if (!pod.lines.length) {
    stage.innerHTML = '<div class="listen"><div class="empty">This session has no audio overview script.</div></div>';
    return null;
  }

  stage.innerHTML = html`<div class="listen">
    <h1>${pod.title || 'Audio overview'}</h1>
    <p class="sub">A ${Math.max(3, Math.round(pod.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / 150))}-minute conversation between Mira, who asks the questions, and Theo, who has read the papers. Written from the review, performed by ElevenLabs.</p>
    <div class="player">
      <button class="play" id="play" aria-label="Play">${raw(PLAY)}</button>
      <div class="prog" id="prog"><i></i></div>
      <span class="status" id="pstatus"></span>
      <span id="actions"></span>
    </div>
    <div class="lines" id="lines">${raw(pod.lines.map((l, i) => `<div class="line ${l.speaker}" data-i="${i}"><span class="who">${l.speaker === 'theo' ? 'Theo' : 'Mira'}</span><span class="txt">${esc(l.text)}</span></div>`).join(''))}</div>
  </div>`;

  const q = (sel) => stage.querySelector(sel);
  const status = q('#pstatus');
  const actions = q('#actions');

  const drawActions = () => {
    if (audio) {
      actions.innerHTML = `<a class="secondary" href="/api/sessions/${s.id}/audio.mp3" download>Download MP3</a>`;
      status.textContent = 'ElevenLabs voices';
    } else if (el.configured) {
      actions.innerHTML = '<button class="secondary" id="record">Record with ElevenLabs</button> <button class="secondary" id="preview">Preview with browser voice</button>';
      status.textContent = 'Not recorded yet';
    } else {
      actions.innerHTML = '<button class="secondary" id="preview">Preview with browser voice</button>';
      status.textContent = 'Add an ElevenLabs key for studio voices';
    }
    const rec = q('#record');
    if (rec) rec.addEventListener('click', record);
    const prev = q('#preview');
    if (prev) prev.addEventListener('click', () => { mode = 'browser'; idx = 0; play(); });
  };

  async function record() {
    const rec = q('#record');
    rec.disabled = true;
    rec.textContent = 'Recording…';
    unlisten = app.listenSession((ev) => { if (ev.type === 'audio') status.textContent = `Recording line ${ev.data.done} of ${ev.data.total}`; });
    try {
      audio = await api.audio(s.id);
      s.audio = audio;
      mode = 'studio';
      drawActions();
      toast('Audio overview recorded');
      idx = 0;
      play();
    } catch (e) {
      toast(e.message, 6000);
      rec.disabled = false;
      rec.textContent = 'Record with ElevenLabs';
    } finally {
      if (unlisten) { unlisten(); unlisten = null; }
    }
  }

  const mark = () => {
    stage.querySelectorAll('.line').forEach((x) => x.classList.toggle('now', +x.dataset.i === idx && playing));
    const cur = q(`.line[data-i="${idx}"]`);
    if (cur && playing) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    q('#prog i').style.width = `${(idx / pod.lines.length) * 100}%`;
    q('#play').innerHTML = playing ? PAUSE : PLAY;
    q('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };

  // Browser voices: a stand-in when there is no ElevenLabs key.
  const pickVoices = () => {
    const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const f = vs.find((v) => /female|samantha|victoria|karen|moira|zira|aria|jenny|google uk english female/i.test(v.name)) || vs[0];
    const m = vs.find((v) => v !== f && /male|daniel|alex|fred|david|guy|ryan|google uk english male/i.test(v.name)) || vs.find((v) => v !== f) || f;
    return { mira: f, theo: m };
  };

  function playLine() {
    if (!playing) return;
    if (idx >= pod.lines.length) { playing = false; idx = 0; mark(); return; }
    mark();
    const line = pod.lines[idx];
    if (mode === 'studio') {
      player.src = audio.lines[idx].url;
      player.play().catch(() => { playing = false; mark(); });
      const next = audio.lines[idx + 1];
      if (next) { const pre = new Audio(); pre.preload = 'auto'; pre.src = next.url; }
    } else {
      const u = new SpeechSynthesisUtterance(line.text);
      const v = pickVoices();
      u.voice = v[line.speaker] || null;
      u.rate = 1.03;
      u.pitch = line.speaker === 'theo' ? 0.9 : 1.08;
      u.onend = () => { if (playing) { idx++; playLine(); } };
      speechSynthesis.speak(u);
    }
  }
  player.addEventListener('ended', () => { idx++; playLine(); });

  function play() {
    if (mode === 'none') { mode = audio ? 'studio' : 'browser'; }
    playing = true;
    playLine();
  }
  function pause() {
    playing = false;
    player.pause();
    if (window.speechSynthesis) speechSynthesis.cancel();
    mark();
  }

  q('#play').addEventListener('click', () => (playing ? pause() : play()));
  q('#lines').addEventListener('click', (e) => {
    const l = e.target.closest('.line');
    if (!l) return;
    pause();
    idx = +l.dataset.i;
    play();
  });
  q('#prog').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    pause();
    idx = Math.floor(((e.clientX - r.left) / r.width) * pod.lines.length);
    play();
  });
  drawActions();
  mark();
  return () => { pause(); if (unlisten) unlisten(); };
}
