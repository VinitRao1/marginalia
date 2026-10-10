#!/usr/bin/env node
// Builds web/demo/sample-session.json: a hand-written sample review on real,
// well-known papers so the interface can be explored without any API keys.
// Card text summarises each paper's abstract in plain words.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences, sentenceKey, parseCitations, tokens } from '../web/js/util.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'demo', 'sample-session.json');

const P = (n, ax, title, authors, year, venue, subq, score, card, extra = {}) => ({
  key: 'arxiv:' + ax, n, title, authors, year, venue, doi: '', url: `https://arxiv.org/abs/${ax}`, pdfUrl: `https://arxiv.org/pdf/${ax}`,
  citedBy: null, sources: ['openalex', 'semanticscholar', 'arxiv'], ids: { arxiv: ax }, subq, score, kind: card.studyType, reason: '',
  included: true, hasFullText: n <= 8, pages: null, abstract: card.tldr, tldr: '', card, ...extra,
});

const papers = [
  P(1, '2205.14135', 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness', ['Tri Dao', 'Daniel Y. Fu', 'Stefano Ermon', 'Atri Rudra', 'Christopher Ré'], 2022, 'NeurIPS', ['q2', 'q1'], 10, {
    tldr: 'Computes exact attention with far fewer GPU memory reads and writes by tiling, and argues approximate methods often fail to deliver real wall-clock speedups.',
    studyType: 'method paper with benchmarks', method: 'IO-aware tiled exact attention; block-sparse variant', data: 'BERT-large, GPT-2, Long Range Arena, Path-X/Path-256',
    keyResult: '15% faster BERT-large training, 3× on GPT-2, 2.4× on Long Range Arena; first better-than-chance Path-X (61.4%) and Path-256 (63.1%)', limitations: 'Requires custom CUDA kernels per GPU architecture', stance: 'challenges' }),
  P(2, '2011.04006', 'Long Range Arena: A Benchmark for Efficient Transformers', ['Yi Tay', 'Mostafa Dehghani', 'Samira Abnar', 'Yikang Shen', 'Dara Bahri', 'Philip Pham', 'Jinfeng Rao', 'Liu Yang', 'Sebastian Ruder', 'Donald Metzler'], 2021, 'ICLR', ['q3', 'q1'], 10, {
    tldr: 'A shared benchmark of 1K to 16K-token tasks comparing ten efficient Transformers; no model dominates, and every model fails the hardest task, Path-X.',
    studyType: 'benchmark evaluation', method: 'Same tasks and budgets for ten efficient attention models', data: 'ListOps, byte-level text, retrieval, image, Pathfinder, Path-X',
    keyResult: 'No single model best across tasks; speed and memory differ far more than accuracy; all models at chance on Path-X', limitations: 'Synthetic-leaning tasks; small models; limited tuning', stance: 'mixed' }),
  P(3, '2312.00752', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', ['Albert Gu', 'Tri Dao'], 2023, 'arXiv', ['q4'], 9, {
    tldr: 'A selective state-space model without attention that scales linearly with length and matches Transformers twice its size on language modelling.',
    studyType: 'method paper with scaling experiments', method: 'Input-dependent state-space layers with a hardware-aware scan', data: 'Language, audio and genomics benchmarks',
    keyResult: '5× higher inference throughput than Transformers; Mamba-3B outperforms same-size Transformers and matches ones twice its size', limitations: 'Largest models only a few billion parameters', stance: 'mixed' }),
  P(4, '2004.05150', 'Longformer: The Long-Document Transformer', ['Iz Beltagy', 'Matthew E. Peters', 'Arman Cohan'], 2020, 'arXiv', ['q1'], 9, {
    tldr: 'Combines a sliding local window with task-specific global attention so cost grows linearly, and beats RoBERTa on long-document tasks.',
    studyType: 'method paper', method: 'Windowed plus global attention; pretraining from RoBERTa', data: 'text8, enwik8, WikiHop, TriviaQA',
    keyResult: 'State of the art on text8 and enwik8 at the time; outperforms RoBERTa on long-document tasks including WikiHop and TriviaQA', limitations: 'Global tokens chosen per task by hand', stance: 'supports' }),
  P(5, '2007.14062', 'Big Bird: Transformers for Longer Sequences', ['Manzil Zaheer', 'Guru Guruganesh', 'Avinava Dubey', 'Joshua Ainslie', 'Chris Alberti', 'Santiago Ontanon', 'Philip Pham', 'Anirudh Ravula', 'Qifan Wang', 'Li Yang', 'Amr Ahmed'], 2020, 'NeurIPS', ['q1'], 9, {
    tldr: 'Sparse attention mixing random, windowed and global tokens; proves it keeps the expressive power of full attention and handles sequences up to 8× longer.',
    studyType: 'method paper with theory', method: 'Random + window + global sparse attention; universality proofs', data: 'Question answering, summarisation, genomics',
    keyResult: 'Universal approximator and Turing complete; 8× longer sequences on similar hardware; gains on QA and summarisation', limitations: 'Theory does not bound the number of layers needed', stance: 'supports' }),
  P(6, '2009.14794', 'Rethinking Attention with Performers', ['Krzysztof Choromanski', 'Valerii Likhosherstov', 'David Dohan', 'Xingyou Song', 'Andreea Gane', 'Tamas Sarlos', 'Peter Hawkins', 'Jared Davis', 'Afroz Mohiuddin', 'Lukasz Kaiser', 'David Belanger', 'Lucy Colwell', 'Adrian Weller'], 2021, 'ICLR', ['q1'], 8, {
    tldr: 'Approximates softmax attention with random features (FAVOR+) in linear time and space, with guarantees on estimation error.',
    studyType: 'method paper with theory', method: 'Positive orthogonal random features for the softmax kernel', data: 'Pixel prediction, text, protein sequences',
    keyResult: 'Unbiased or nearly unbiased estimate of attention with low variance; competitive results on the tasks tested', limitations: 'Approximation quality depends on the number of random features', stance: 'supports' }),
  P(7, '2001.04451', 'Reformer: The Efficient Transformer', ['Nikita Kitaev', 'Łukasz Kaiser', 'Anselm Levskaya'], 2020, 'ICLR', ['q1', 'q2'], 8, {
    tldr: 'Replaces dot-product attention with locality-sensitive hashing and uses reversible layers, matching Transformer quality with much less memory.',
    studyType: 'method paper', method: 'LSH attention (O(L log L)) and reversible residual layers', data: 'enwik8, imagenet64 generation',
    keyResult: 'On par with Transformers while far more memory-efficient and faster on long sequences', limitations: 'Hashing adds variance; gains appear mainly at long lengths', stance: 'supports' }),
  P(8, '2006.04768', 'Linformer: Self-Attention with Linear Complexity', ['Sinong Wang', 'Belinda Z. Li', 'Madian Khabsa', 'Han Fang', 'Hao Ma'], 2020, 'arXiv', ['q1'], 7, {
    tldr: 'Shows attention matrices are approximately low-rank and projects keys and values down to a fixed size, giving linear cost.',
    studyType: 'method paper', method: 'Learned low-rank projection of keys and values', data: 'GLUE-style classification after pretraining',
    keyResult: 'Performs on par with standard Transformers on the reported tasks, with linear time and memory', limitations: 'Fixed projection does not suit causal (autoregressive) decoding', stance: 'supports' }),
  P(9, '2006.16236', 'Transformers are RNNs: Fast Autoregressive Transformers with Linear Attention', ['Angelos Katharopoulos', 'Apoorv Vyas', 'Nikolaos Pappas', 'François Fleuret'], 2020, 'ICML', ['q1', 'q2'], 8, {
    tldr: 'Writes attention as a kernel feature-map product, making it linear and recurrent; autoregressive generation becomes dramatically faster.',
    studyType: 'method paper', method: 'Kernelised linear attention computed recurrently', data: 'Image generation (MNIST, CIFAR-10), speech recognition',
    keyResult: 'Comparable performance to softmax attention on the tasks tested; up to 4000× faster autoregressive prediction of very long sequences', limitations: 'Not evaluated on large-scale language modelling', stance: 'mixed' }),
  P(10, '2307.03172', 'Lost in the Middle: How Language Models Use Long Contexts', ['Nelson F. Liu', 'Kevin Lin', 'John Hewitt', 'Ashwin Paranjape', 'Michele Bevilacqua', 'Fabio Petroni', 'Percy Liang'], 2024, 'TACL', ['q4', 'q3'], 9, {
    tldr: 'Language models use information best at the start or end of their context and much worse in the middle, even models built for long contexts.',
    studyType: 'empirical evaluation', method: 'Vary the position of relevant information in multi-document QA and key-value retrieval', data: 'Open and closed long-context language models',
    keyResult: 'Accuracy follows a U-shape over position; performance drops significantly when the answer sits mid-context', limitations: 'Two task families; models of 2023', stance: 'challenges' }),
  P(11, '2307.08691', 'FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning', ['Tri Dao'], 2023, 'arXiv', ['q2'], 8, {
    tldr: 'Reworks how FlashAttention splits work across GPU threads, roughly doubling its speed.',
    studyType: 'method paper with benchmarks', method: 'Better parallelism and work partitioning for exact attention', data: 'GPT-style training on A100 GPUs',
    keyResult: 'About 2× faster than FlashAttention, reaching 50–73% of theoretical peak throughput on A100', limitations: 'Hardware-specific engineering', stance: 'challenges' }),
  P(12, '2310.01889', 'Ring Attention with Blockwise Transformers for Near-Infinite Context', ['Hao Liu', 'Matei Zaharia', 'Pieter Abbeel'], 2023, 'arXiv', ['q2'], 7, {
    tldr: 'Splits exact blockwise attention across devices in a ring, overlapping communication with compute, so context length grows with the number of devices.',
    studyType: 'systems method paper', method: 'Blockwise attention distributed across devices in a ring', data: 'Language modelling and reinforcement learning',
    keyResult: 'Context length scales with device count without approximating attention', limitations: 'Needs many accelerators; communication overhead at small scale', stance: 'challenges' }),
  P(13, '1904.10509', 'Generating Long Sequences with Sparse Transformers', ['Rewon Child', 'Scott Gray', 'Alec Radford', 'Ilya Sutskever'], 2019, 'arXiv', ['q1'], 7, {
    tldr: 'Factorised sparse attention cuts cost to O(n√n) and models images, audio and text from raw bytes.',
    studyType: 'method paper', method: 'Fixed strided and local sparse attention patterns', data: 'enwik8, CIFAR-10, ImageNet-64',
    keyResult: 'New state of the art density modelling on enwik8, CIFAR-10 and ImageNet-64 at the time', limitations: 'Fixed patterns chosen per modality', stance: 'supports' }),
  P(14, '1911.02150', 'Fast Transformer Decoding: One Write-Head is All You Need', ['Noam Shazeer'], 2019, 'arXiv', ['q2'], 7, {
    tldr: 'Multi-query attention shares one set of keys and values across heads, cutting the memory traffic that bottlenecks decoding.',
    studyType: 'method paper', method: 'Single shared key/value head (multi-query attention)', data: 'Translation and language modelling',
    keyResult: 'Much faster incremental decoding with only minor quality loss', limitations: 'Small quality drop; trained from scratch', stance: 'context' }),
  P(15, '2305.13245', 'GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints', ['Joshua Ainslie', 'James Lee-Thorp', 'Michiel de Jong', 'Yury Zemlyanskiy', 'Federico Lebrón', 'Sumit Sanghai'], 2023, 'EMNLP', ['q2'], 7, {
    tldr: 'Grouped-query attention sits between multi-head and multi-query attention and can be added to existing checkpoints cheaply.',
    studyType: 'method paper', method: 'Uptraining multi-head checkpoints into grouped-query attention', data: 'T5 models on summarisation, translation, QA',
    keyResult: 'Quality close to multi-head attention at speed comparable to multi-query; uptraining uses 5% of original pretraining compute', limitations: 'Evaluated on encoder-decoder T5', stance: 'context' }),
  P(16, '1706.03762', 'Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'], 2017, 'NeurIPS', ['q2'], 7, {
    tldr: 'Introduces the Transformer, built entirely on attention; self-attention cost grows with the square of sequence length.',
    studyType: 'architecture paper', method: 'Multi-head scaled dot-product self-attention', data: 'WMT translation',
    keyResult: 'State of the art translation at lower training cost; per-layer self-attention complexity O(n²·d)', limitations: 'Quadratic cost limits sequence length', stance: 'context' }),
];

const related = [
  ['2111.00396', 'Efficiently Modeling Long Sequences with Structured State Spaces', ['Albert Gu', 'Karan Goel', 'Christopher Ré'], 2022, 'ICLR', ['q4'], 7],
  ['2212.14052', 'Hungry Hungry Hippos: Towards Language Modeling with State Space Models', ['Daniel Y. Fu', 'Tri Dao', 'Khaled K. Saab', 'Armin W. Thomas', 'Atri Rudra', 'Christopher Ré'], 2023, 'ICLR', ['q4'], 7],
  ['2302.10866', 'Hyena Hierarchy: Towards Larger Convolutional Language Models', ['Michael Poli', 'Stefano Massaroli', 'Eric Nguyen', 'Daniel Y. Fu', 'Tri Dao', 'Stephen Baccus', 'Yoshua Bengio', 'Stefano Ermon', 'Christopher Ré'], 2023, 'ICML', ['q4'], 6],
  ['1901.02860', 'Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context', ['Zihang Dai', 'Zhilin Yang', 'Yiming Yang', 'Jaime Carbonell', 'Quoc V. Le', 'Ruslan Salakhutdinov'], 2019, 'ACL', ['q1'], 6],
  ['2009.06732', 'Efficient Transformers: A Survey', ['Yi Tay', 'Mostafa Dehghani', 'Dara Bahri', 'Donald Metzler'], 2022, 'ACM Computing Surveys', ['q3'], 7],
  ['2307.08621', 'Retentive Network: A Successor to Transformer for Large Language Models', ['Yutao Sun', 'Li Dong', 'Shaohan Huang', 'Shuming Ma', 'Yuqing Xia', 'Jilong Xue', 'Jianyong Wang', 'Furu Wei'], 2023, 'arXiv', ['q4'], 6],
].map(([ax, title, authors, year, venue, subq, score]) => ({
  key: 'arxiv:' + ax, n: null, title, authors, year, venue, doi: '', url: `https://arxiv.org/abs/${ax}`, pdfUrl: `https://arxiv.org/pdf/${ax}`, citedBy: null,
  sources: ['openalex', 'arxiv'], ids: { arxiv: ax }, subq, score, kind: '', reason: 'Relevant background; left out to keep the review focused', included: false, hasFullText: false, card: null, abstract: '', tldr: '',
}));

const report = `## Bottom line
Approximate sub-quadratic attention has not, on balance, beaten standard attention: across shared benchmarks no single efficient variant wins consistently, and the methods that changed practice compute exact attention more efficiently instead [2, 1]. Confidence is moderate, because most head-to-head comparisons use small models and synthetic tasks, and attention-free models such as Mamba are now a serious alternative [2, 3].

## Background
Standard self-attention compares every token with every other token, so its cost grows with the square of the sequence length [16]. Between 2019 and 2021 a wave of methods tried to break that bottleneck with fixed sparse patterns, hashing, low-rank projections and kernel approximations [13, 7, 8, 6]. A second wave kept attention exact and attacked the memory traffic and hardware layout that make it slow in practice [1, 11, 12].

## What the evidence says
### Approximations can match full attention on their chosen tasks
Each family reports parity with full attention on the tasks it was designed for. Reformer matches Transformer quality while using far less memory on long sequences [7], Linformer reports results on par with a standard Transformer at linear cost [8], and Performer gives a provably accurate estimate of softmax attention in linear time [6]. Longformer and Big Bird go further on long documents, beating RoBERTa-style baselines on question answering and long-document tasks [4, 5]. Big Bird also proves that its sparse pattern keeps the expressive power of full attention [5]. Linear attention matches softmax attention on large-scale language modelling [9].

### The real speedups came from exact, hardware-aware attention
FlashAttention computes exact attention with far fewer reads and writes to GPU memory and reports a 3× training speedup on GPT-2 and 2.4× on Long Range Arena [1]. Its authors note that many approximate methods reduce theoretical compute without delivering wall-clock speedups [1]. FlashAttention-2 roughly doubles that speed again, reaching 50 to 73 percent of an A100's theoretical peak [11]. At inference, sharing keys and values across heads cuts the memory traffic of decoding with little quality loss [14, 15], and Ring Attention removes the context-length limit entirely [12].

### Longer windows do not guarantee that context is used
Models are best at using information at the very start or end of their context and markedly worse in the middle, even models built for long inputs [10]. This means efficiency results measured as perplexity or throughput say little about whether long contexts are actually exploited [10, 2].

## Where studies disagree
The main disagreement is between method papers and independent benchmarks. Method papers typically report parity on their own tasks [7, 8, 6], while Long Range Arena, which ran ten efficient models under the same conditions, found no consistent winner and differences in speed and memory far larger than differences in accuracy [2]. Every model in that benchmark failed the hardest 16K-token task, Path-X, which FlashAttention later solved with exact attention [2, 1]. Attention-free state-space models add a further challenge: Mamba reports five times the inference throughput of Transformers and matches Transformers twice its size [3].

## How good is the evidence
Most comparisons rely on models far smaller than those used today, and many use synthetic or byte-level tasks rather than natural language at scale [2]. Speedups are hardware-specific and often reported on a single GPU generation [1, 11]. Theoretical guarantees exist for some methods, such as Big Bird's expressivity and Performer's estimation error, but they do not translate directly into task quality [5, 6].

## Open questions
- Do the quality findings for approximate attention hold at tens of billions of parameters, where few were tested [2]?
- Can state-space and hybrid models match attention on precise retrieval from long contexts [3, 10]?
- How should long-context ability be measured beyond perplexity, given position effects [10]?

## Conclusion
For long-context language modelling, the evidence favours exact attention made efficient through IO-aware kernels, shared key-value heads and distribution across devices over approximate sub-quadratic attention [1, 11, 15, 12]. Approximations remain useful when memory is the binding constraint, and selective state-space models are the strongest emerging alternative [5, 3].`;

// Audit verdicts for selected sentences (keys computed from the same splitter the UI uses).
const verdictFor = {
  'Linear attention matches softmax attention on large-scale language modelling': ['unsupported', 'The paper tests image generation and speech, not large-scale language modelling.', 9],
  'Ring Attention removes the context-length limit entirely': ['partial', 'Context grows with the number of devices; it is not unlimited.', 12],
  'Big Bird also proves that its sparse pattern keeps the expressive power': ['supported', 'The paper proves universality and Turing completeness.', 5],
};
const items = [];
const body = report.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const passages = Object.fromEntries(papers.map((p) => [p.n, `${p.title}. ${p.card.tldr} ${p.card.keyResult}.`]));
for (const para of body.split(/\n{2,}/)) {
  for (const s of splitSentences(para.replace(/^[-*]\s+/gm, ''))) {
    const refs = parseCitations(s);
    if (!refs.length) continue;
    const special = Object.entries(verdictFor).find(([k]) => s.includes(k));
    const [verdict, note, best] = special ? special[1] : ['supported', 'The cited passages state this directly.', refs[0]];
    items.push({ key: sentenceKey(s), sentence: s, refs, verdict, note, bestRef: best, evidence: refs.slice(0, 2).map((n) => ({ n, text: passages[n] })) });
  }
}
const count = (v) => items.filter((x) => x.verdict === v).length;
const audit = { totalCited: items.length, checked: items.length, supported: count('supported'), partial: count('partial'), unsupported: count('unsupported') };
audit.score = Math.round(((audit.supported + 0.5 * audit.partial) / audit.checked) * 100);
audit.items = items;

const findings = [
  { subq: 'q1', question: 'Do sub-quadratic approximations match full attention quality?', consensus: 'mixed',
    summary: 'Method papers report parity on their own tasks, but the one controlled comparison finds no consistent winner and every approximate model fails the hardest long-range task.',
    findings: [
      { claim: 'Sparse attention with global tokens beats dense baselines on long-document question answering.', support: [4, 5], contradict: [], evidence: '', strength: 'moderate' },
      { claim: 'Low-rank and kernel approximations reach parity with full attention on the tasks their authors chose.', support: [8, 6, 7], contradict: [2], evidence: '', strength: 'moderate' },
      { claim: 'Under identical conditions, no efficient variant is best across tasks.', support: [2], contradict: [], evidence: '', strength: 'strong' },
      { claim: 'Approximate models fail very long-range reasoning that exact attention can solve.', support: [2, 1], contradict: [], evidence: '', strength: 'moderate' },
    ] },
  { subq: 'q2', question: 'Where do practical speed and memory gains come from?', consensus: 'strong',
    summary: 'Wall-clock gains come mainly from computing exact attention with less memory traffic, sharing key-value heads at inference, and spreading attention across devices.',
    findings: [
      { claim: 'IO-aware exact attention gives large real training speedups.', support: [1, 11], contradict: [], evidence: '', strength: 'strong' },
      { claim: 'Reduced FLOPs from approximation often do not become wall-clock speedups.', support: [1], contradict: [7], evidence: '', strength: 'moderate' },
      { claim: 'Sharing keys and values across heads speeds decoding with little quality loss.', support: [14, 15], contradict: [], evidence: '', strength: 'strong' },
      { claim: 'Distributing exact attention across devices extends context with device count.', support: [12], contradict: [], evidence: '', strength: 'moderate' },
    ] },
  { subq: 'q3', question: 'How reliable is the benchmark evidence?', consensus: 'weak',
    summary: 'Evidence rests largely on small models, synthetic tasks and single hardware generations, and long-context benchmarks rarely test whether information is actually used.',
    findings: [
      { claim: 'Controlled benchmarks show speed differences far larger than accuracy differences.', support: [2], contradict: [], evidence: '', strength: 'moderate' },
      { claim: 'Throughput and perplexity gains do not show that long contexts are used well.', support: [10], contradict: [], evidence: '', strength: 'moderate' },
    ] },
  { subq: 'q4', question: 'Do models use long contexts well, and what replaces attention?', consensus: 'moderate',
    summary: 'Models under-use the middle of long contexts, and selective state-space models now rival Transformers at language modelling with linear scaling.',
    findings: [
      { claim: 'Models use information at the start and end of the context far better than the middle.', support: [10], contradict: [], evidence: '', strength: 'strong' },
      { claim: 'Selective state-space models match Transformers twice their size with higher throughput.', support: [3], contradict: [], evidence: '', strength: 'moderate' },
    ] },
];

const podcast = {
  title: 'Is cheaper attention actually better?',
  lines: [
    ['mira', "Every AI lab wants models that read whole books at once. The problem is attention, which gets quadratically more expensive as the text gets longer. So, Theo, did all those clever efficient-attention tricks actually fix that?"],
    ['theo', "Short answer: not the way people expected. There was this wave around 2020: Reformer, Linformer, Performer, Longformer, Big Bird. Each paper said, look, we match a normal Transformer and we're way cheaper."],
    ['mira', 'That sounds like a win. What went wrong?'],
    ['theo', "When Tay and colleagues put ten of them side by side in Long Range Arena, under the same conditions, no single method won across the board. The speed and memory differences were huge, but accuracy barely separated them."],
    ['mira', 'So they were all roughly as good, just cheaper? That still sounds fine to me.'],
    ['theo', "Here's the catch. Every one of them failed the hardest task, Path-X, sixteen thousand tokens long. They were at chance. And the thing that eventually cracked it wasn't an approximation at all."],
    ['mira', 'Let me guess. FlashAttention?'],
    ['theo', "Right. Dao and colleagues in 2022 kept attention exact and just stopped wasting time shuffling data around the GPU's memory. Three times faster training on GPT-2, and the first model to beat chance on Path-X."],
    ['mira', "Okay, but I want to push on that. Isn't FlashAttention just better engineering? That's not a scientific argument against sparse attention."],
    ['theo', "Fair, and I think that's the honest reading. The approximations cut theoretical compute, but on real hardware that often didn't turn into wall-clock speed. Engineering is where the gains actually showed up."],
    ['mira', "And there's a line in the review that got flagged, right? Something about linear attention?"],
    ['theo', "Yes, good catch. The review claimed linear attention matches softmax on large-scale language modelling, and the check marked it unsupported. Katharopoulos and colleagues tested images and speech, not big language models."],
    ['mira', 'So even if a model can take in a million tokens, does it actually use them?'],
    ['theo', "That's the other big finding. Liu and colleagues showed models are great with information at the start or end of the context and much worse in the middle. Long windows aren't the same as good reading."],
    ['mira', 'And Mamba? People keep telling me attention is dead.'],
    ['theo', "Mamba is the most serious challenger. Gu and Dao report five times the inference throughput and match Transformers twice its size. But the open question is precise retrieval from long contexts, and that's not settled."],
    ['mira', 'So the takeaway?'],
    ['theo', "Make exact attention efficient first. Use approximations when memory is the hard limit. And keep a close eye on state-space models."],
  ].map(([speaker, text]) => ({ speaker, text })),
};

// Graph: citation edges we are confident about, plus topical similarity.
const citeEdges = [[4, 13], [4, 7], [5, 4], [5, 13], [6, 7], [6, 8], [6, 13], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 13], [1, 7], [1, 8], [1, 6], [1, 4], [1, 5], [1, 2], [11, 1], [12, 1], [3, 1], [3, 9], [15, 14], [9, 7], [8, 7], [10, 16], [4, 16], [5, 16], [7, 16], [14, 16], [13, 16]];
const all = [...papers, ...related];
const keyOfN = (n) => papers.find((p) => p.n === n).key;
const edges = citeEdges.map(([a, b]) => ({ source: keyOfN(a), target: keyOfN(b), kind: 'cites', weight: 1 }));
const toks = all.map((p) => new Set(tokens(p.title + ' ' + (p.card ? p.card.tldr : ''))));
all.forEach((p, i) => {
  const sims = all.map((q, j) => { if (i === j) return { j, s: 0 }; const A = toks[i], B = toks[j]; let inter = 0; for (const x of A) if (B.has(x)) inter++; return { j, s: inter / (A.size + B.size - inter || 1) }; }).sort((a, b) => b.s - a.s).slice(0, 2);
  for (const { j, s } of sims) if (s >= 0.08) edges.push({ source: p.key, target: all[j].key, kind: 'similar', weight: Math.round(s * 100) / 100 });
});
// Related papers cite the papers they build on.
const relEdges = [['arxiv:2212.14052', 1], ['arxiv:2302.10866', 1], ['arxiv:2111.00396', 9], ['arxiv:2009.06732', 2], ['arxiv:2009.06732', 7], ['arxiv:1901.02860', 16], ['arxiv:2307.08621', 9]];
for (const [k, n] of relEdges) edges.push({ source: k, target: keyOfN(n), kind: 'cites', weight: 1 });

const subQuestions = findings.map((f, i) => ({ id: f.subq, question: f.question, why: '', queries: [] }));
const session = {
  question: 'Do efficient attention mechanisms actually beat standard attention for long-context language modelling?',
  depth: 'standard',
  title: 'Efficient attention and long context',
  engine: 'n8n',
  plan: { title: 'Efficient attention and long context', domain: 'computing', scope: 'Sub-quadratic and hardware-efficient attention, and alternatives, for long sequences.', keyTerms: ['sparse attention', 'linear attention', 'kernel approximation', 'low-rank attention', 'IO-aware attention', 'state space model', 'long context'], subQuestions },
  sources: ['openalex', 'semanticscholar', 'arxiv'],
  bottomLine: report.split('\n')[1],
  report,
  findings,
  audit,
  podcast,
  coverageHistory: [
    { round: 1, coverage: { q1: 9, q2: 4, q3: 2, q4: 3 }, gaps: ['q3', 'q4'], relevant: 24, total: 131, continue: true, followups: [{ subq: 'q3', q: 'long range arena efficient transformer comparison' }, { subq: 'q4', q: 'selective state space language model' }], note: 'Few independent benchmark comparisons yet.' },
    { round: 2, coverage: { q1: 11, q2: 7, q3: 4, q4: 6 }, gaps: [], relevant: 41, total: 214, continue: false, followups: [], note: '' },
  ],
  papers: all,
  references: papers.map((p) => p.key),
  graph: { nodes: all.map((p) => p.key), edges },
  chunks: papers.map((p) => ({ id: p.n + ':abs', n: p.n, text: `${p.title}. ${p.card.tldr} Method: ${p.card.method}. Data: ${p.card.data}. Result: ${p.card.keyResult}. Limitations: ${p.card.limitations}.` })),
  stats: { found: 214, screened: 152, relevant: 41, included: 16, fullText: 8, rounds: 2, queries: 12, snowballed: 3, chunks: 268, sources: { openalex: 96, semanticscholar: 58, arxiv: 60 }, llmCalls: 41, tokens: 312000, durationMs: 287000 },
  finishedAt: Date.now() - 86400000,
  notes: [],
  verifications: [],
  evidenceFinds: [],
};
writeFileSync(out, JSON.stringify(session, null, 1));
console.log(`Wrote ${out}: ${papers.length} sources, ${items.length} audited sentences (${audit.supported} supported, ${audit.partial} partial, ${audit.unsupported} unsupported)`);
