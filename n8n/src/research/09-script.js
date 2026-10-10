// Script a two-voice audio overview that ElevenLabs will perform.
const state = $input.first().json;
const refs = state.references.map((k) => state.papers.find((p) => p.key === k));

await stage(state, 'script', 'Scripting the audio overview', async () => {
  const who = refs.map((p) => `[${p.n}] = ${authorShort(p)}, ${p.year || 'n.d.'}`).join('; ');
  try {
    const out = await llm({
      tier: 'main',
      maxTokens: 3500,
      temperature: 0.7,
      system: 'You write sharp, warm, intelligent two-person audio explainers. They sound like real people thinking out loud, never like a script being read.',
      prompt: `Turn this literature review into a 4 to 5 minute conversation between two hosts.
Mira is the curious host who asks what a smart listener would ask, and pushes back. Theo has read all the papers and explains clearly, with honest uncertainty.

Review:
${clampText(state.report, 9000)}

Source numbers map to: ${who}

Rules:
- 16 to 24 turns. Each turn 1 to 4 sentences, written for speech: contractions, short sentences, no lists, no markdown, no bracketed citation numbers.
- Refer to studies naturally, e.g. "Dao and colleagues found in 2022…".
- Open with a hook about why the question matters. Include one moment where Mira challenges a weak spot in the evidence. End with a one-line takeaway.
- No stage directions, sound effects or speaker labels inside the text.

Return JSON: {"title":"episode title under 9 words","lines":[{"speaker":"mira" or "theo","text":"..."}]}`,
      json: true,
    });
    state.podcast = {
      title: String(out.title || state.plan.title),
      lines: (out.lines || []).map((l) => ({ speaker: /theo/i.test(l.speaker) ? 'theo' : 'mira', text: String(l.text || '').replace(/\[[\d,\s–-]+\]/g, '').trim() })).filter((l) => l.text),
    };
  } catch (e) {
    state.podcast = { title: state.plan.title, lines: [] };
    await log(state, 'The audio overview script failed; the review is unaffected', { error: true });
  }
  await emit(state, 'podcast', { title: state.podcast.title, lines: state.podcast.lines.length });
});

return [{ json: state }];
