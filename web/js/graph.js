// A small force-directed graph on canvas: used for the live map while research
// runs and for the full citation map. No dependencies.
import { cssVar } from './util.js';

export class ForceGraph {
  constructor(canvas, { onHover, onClick, interactive = true, labels = true } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.links = [];
    this.byId = new Map();
    this.onHover = onHover;
    this.onClick = onClick;
    this.labels = labels;
    this.view = { x: 0, y: 0, k: 1 };
    this.alpha = 1;
    this.hover = null;
    this.drag = null;
    this.highlight = null;
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    if (interactive) this.bind();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this._ro.disconnect(); this.dead = true; }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.c.width = this.w * dpr;
    this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.reheat(0.3);
  }

  reheat(a = 0.6) { this.alpha = Math.max(this.alpha, a); }

  upsertNode(n) {
    const ex = this.byId.get(n.id);
    if (ex) { Object.assign(ex, n, { x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy }); return ex; }
    const a = Math.random() * Math.PI * 2;
    const rad = 40 + Math.random() * 60;
    const node = { x: Math.cos(a) * rad, y: Math.sin(a) * rad, vx: 0, vy: 0, r: 6, ...n };
    this.nodes.push(node);
    this.byId.set(node.id, node);
    this.reheat(0.8);
    return node;
  }

  setLinks(links) {
    this.links = links.filter((l) => this.byId.has(l.source) && this.byId.has(l.target)).map((l) => ({ ...l, s: this.byId.get(l.source), t: this.byId.get(l.target) }));
    this.reheat(0.6);
  }

  step() {
    const N = this.nodes;
    const a = this.alpha;
    for (let i = 0; i < N.length; i++) {
      const p = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const q = N[j];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const min = p.r + q.r + 6;
        const f = (900 * a) / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        p.vx -= dx * f; p.vy -= dy * f; q.vx += dx * f; q.vy += dy * f;
        if (d < min) { const push = (min - d) * 0.5; p.x -= dx * push; p.y -= dy * push; q.x += dx * push; q.y += dy * push; }
      }
    }
    for (const l of this.links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = l.kind === 'cites' ? 70 : 95;
      const k = (l.kind === 'cites' ? 0.04 : 0.018 * (l.weight || 0.5) * 2) * a;
      const f = (d - target) * k;
      l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f; l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f;
    }
    for (const p of N) {
      p.vx -= p.x * 0.006 * a; p.vy -= p.y * 0.006 * a;
      if (p === this.drag) continue;
      p.vx *= 0.82; p.vy *= 0.82;
      p.x += p.vx; p.y += p.vy;
    }
    this.alpha = Math.max(0.02, this.alpha * 0.985);
  }

  fit() {
    if (!this.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) { minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r); minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r); }
    const pad = 40;
    const k = Math.min((this.w - pad * 2) / (maxX - minX || 1), (this.h - pad * 2) / (maxY - minY || 1), 1.8);
    this.view.k += (k - this.view.k) * 0.08;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.view.x += (-cx * this.view.k - this.view.x) * 0.08;
    this.view.y += (-cy * this.view.k - this.view.y) * 0.08;
  }

  toScreen(n) { return [this.w / 2 + this.view.x + n.x * this.view.k, this.h / 2 + this.view.y + n.y * this.view.k]; }
  toWorld(x, y) { return [(x - this.w / 2 - this.view.x) / this.view.k, (y - this.h / 2 - this.view.y) / this.view.k]; }

  hit(x, y) {
    const [wx, wy] = this.toWorld(x, y);
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < n.r + 5 / this.view.k && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  bind() {
    const pos = (e) => { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let panning = null;
    this.c.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      const n = this.hit(x, y);
      this.c.setPointerCapture(e.pointerId);
      if (n) { this.drag = n; this.dragMoved = false; } else panning = { x, y, vx: this.view.x, vy: this.view.y };
      this.userMoved = true;
    });
    this.c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (this.drag) {
        const [wx, wy] = this.toWorld(x, y);
        this.drag.x = wx; this.drag.y = wy; this.drag.vx = 0; this.drag.vy = 0; this.dragMoved = true; this.reheat(0.3);
      } else if (panning) {
        this.view.x = panning.vx + (x - panning.x); this.view.y = panning.vy + (y - panning.y);
      } else {
        const n = this.hit(x, y);
        if (n !== this.hover) { this.hover = n; this.onHover && this.onHover(n, x, y); }
        else if (n && this.onHover) this.onHover(n, x, y);
        this.c.style.cursor = n ? 'pointer' : '';
      }
    });
    this.c.addEventListener('pointerup', (e) => {
      if (this.drag && !this.dragMoved && this.onClick) this.onClick(this.drag);
      this.drag = null; panning = null;
    });
    this.c.addEventListener('pointerleave', () => { this.hover = null; this.onHover && this.onHover(null); });
    this.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      const [wx, wy] = this.toWorld(x, y);
      const k = Math.min(4, Math.max(0.25, this.view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      this.view.k = k;
      this.view.x = x - this.w / 2 - wx * k;
      this.view.y = y - this.h / 2 - wy * k;
      this.userMoved = true;
    }, { passive: false });
  }

  loop() {
    if (this.dead) return;
    if (this.alpha > 0.021) this.step();
    if (!this.userMoved) this.fit();
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  draw() {
    const { ctx } = this;
    const ink = cssVar('--ink');
    const ink3 = cssVar('--ink-3');
    const paper = cssVar('--sheet');
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.w / 2 + this.view.x, this.h / 2 + this.view.y);
    ctx.scale(this.view.k, this.view.k);
    const focus = this.hover || this.highlight;
    for (const l of this.links) {
      const on = focus && (l.s === focus || l.t === focus);
      ctx.globalAlpha = on ? 0.9 : l.kind === 'cites' ? 0.38 : 0.16;
      ctx.strokeStyle = on ? ink : ink3;
      ctx.lineWidth = (l.kind === 'cites' ? 1.2 : 1) / this.view.k;
      ctx.setLineDash(l.kind === 'cites' ? [] : [3 / this.view.k, 4 / this.view.k]);
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const n of this.nodes) {
      const col = n.color ? (n.color.startsWith('var(') ? cssVar(n.color.slice(4, -1)) : n.color) : ink3;
      ctx.globalAlpha = n.dim ? 0.35 : 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (n.filled) { ctx.fillStyle = col; ctx.fill(); }
      else { ctx.fillStyle = paper; ctx.fill(); ctx.lineWidth = 1.6 / this.view.k; ctx.strokeStyle = col; ctx.stroke(); }
      if (n === focus) { ctx.lineWidth = 2.5 / this.view.k; ctx.strokeStyle = ink; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / this.view.k, 0, Math.PI * 2); ctx.stroke(); }
      if (this.labels && n.label && n.r * this.view.k > 7) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = n.filled ? '#fff' : ink;
        ctx.font = `600 ${Math.max(9, n.r * 0.9)}px Familjen Grotesk, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n.label, n.x, n.y + 0.5);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
