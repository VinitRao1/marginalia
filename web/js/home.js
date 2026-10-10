// The question composer.
import { api } from './api.js';
import { html, raw, toast } from './util.js';

const DEPTHS = {
  quick: 'Skim: 3 sub-questions, one search round, about 10 sources. A few minutes.',
  standard: 'Survey: 4 sub-questions, two rounds with citation chasing, about 16 sources.',
  deep: 'Exhaustive: 5 sub-questions, three rounds, about 24 sources, 12 read in full.',
};
const SOURCES = [['openalex', 'OpenAlex'], ['semanticscholar', 'Semantic Scholar'], ['arxiv', 'arXiv'], ['europepmc', 'Europe PMC']];
const EXAMPLES = [
  'Does intermittent fasting improve metabolic health more than ordinary calorie restriction?',
  'Do efficient attention mechanisms actually beat standard attention for long-context language modelling?',
  'What is the evidence that microplastics harm human health?',
  'Does remote work reduce or increase productivity?',
];

export function renderHome(stage, app) {
  let depth = 'standard';
  let sources = new Set();
  const llmReady = app.status && app.status.llm && app.status.llm.ready;
  stage.innerHTML = html`<div class="home">
    ${raw(app.status && !llmReady ? `<div class="setup-banner">Research needs a language model key in <code>.env</code>. The sample review in the library works without one. <button id="openSetup">See setup</button></div>` : '')}
    <h1>Ask the literature a hard question.</h1>
    <p class="lede">Marginalia plans a search, reads across four scholarly databases, follows citations until each part of your question is covered, writes a cited review, checks every citation against the papers, and then argues it through with you out loud.</p>
    <form class="composer" id="composer">
      <label class="sr-only" for="q">Research question</label>
      <textarea id="q" rows="3" placeholder="What do you want to know?" maxlength="1500"></textarea>
      <div class="composer-foot">
        <div class="depth" role="group" aria-label="How deep to search">
          <button type="button" data-d="quick" aria-pressed="false">Skim</button>
          <button type="button" data-d="standard" aria-pressed="true">Survey</button>
          <button type="button" data-d="deep" aria-pressed="false">Exhaustive</button>
        </div>
        <span class="depth-note" id="depthNote">${DEPTHS.standard}</span>
        <button class="primary" type="submit" id="go">Start research</button>
      </div>
    </form>
    <div class="sources-row" role="group" aria-label="Databases to search">
      <span>Databases</span>
      <button type="button" class="chip-toggle" data-src="auto" aria-pressed="true">Choose for me</button>
      ${raw(SOURCES.map(([k, l]) => `<button type="button" class="chip-toggle" data-src="${k}" aria-pressed="false">${l}</button>`).join(''))}
    </div>
    <section class="examples">
      <h2>Try one of these</h2>
      ${raw(EXAMPLES.map((e) => `<button type="button" data-ex>${e}</button>`).join(''))}
    </section>
    <section class="how">
      <div><b>A search that knows when to stop</b>n8n runs the pipeline as a loop: it measures how well each sub-question is covered, writes follow-up queries for the gaps, and snowballs through citations.</div>
      <div><b>Read, not skimmed</b>Open-access PDFs are downloaded and parsed. Findings and the review are written from retrieved passages, not titles.</div>
      <div><b>Every citation checked</b>A separate pass compares each cited sentence with the source text and marks it supported, partial or unsupported.</div>
      <div><b>Argue with it</b>An ElevenLabs voice partner knows the review, checks claims mid-conversation, and can go find new evidence while you talk.</div>
    </section>
  </div>`;

  const q = stage.querySelector('#q');
  const note = stage.querySelector('#depthNote');
  const go = stage.querySelector('#go');
  q.focus();
  const grow = () => { q.style.height = 'auto'; q.style.height = Math.max(114, q.scrollHeight) + 'px'; };
  q.addEventListener('input', grow);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) stage.querySelector('#composer').requestSubmit(); });

  stage.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
    depth = b.dataset.d;
    stage.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    note.textContent = DEPTHS[depth];
  }));
  stage.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.src;
    if (k === 'auto') sources.clear();
    else sources.has(k) ? sources.delete(k) : sources.add(k);
    stage.querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.src === 'auto' ? sources.size === 0 : sources.has(x.dataset.src))));
  }));
  stage.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { q.value = b.textContent; grow(); q.focus(); }));
  const setup = stage.querySelector('#openSetup');
  if (setup) setup.addEventListener('click', () => app.openSetup());

  stage.querySelector('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = q.value.trim();
    if (question.length < 8) { toast('Write the question as a full sentence.'); q.focus(); return; }
    go.disabled = true;
    go.textContent = 'Starting…';
    try {
      const { id } = await api.start({ question, depth, sources: Array.from(sources) });
      await app.loadLibrary();
      location.hash = `#/s/${id}/review`;
    } catch (err) {
      toast(err.message, 5000);
      go.disabled = false;
      go.textContent = 'Start research';
    }
  });
  return null;
}
