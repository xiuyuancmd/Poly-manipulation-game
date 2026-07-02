// A running 2D level: physics world + tool interactions. The Game orchestrator
// owns timing, similarity evaluation and HUD; the session owns the body and
// translates pointer gestures into physics operations.

import { ParticleSystem, Solver, AnchorConstraint } from '../engine/xpbd.js';
import { SoftBody2D } from '../engine/softbody2d.js';
import { performCut } from '../engine/cut2d.js';
import { selectStretch, weldStretches } from '../engine/glue2d.js';
import { TargetSpec, evaluate, inverseTransform } from '../engine/similarity2d.js';
import { drawScene } from '../render/render2d.js';

export const MAX_CONTROLS = 3;   // grabs + pins combined (game rule)
const GRAB_RADIUS = 34;
const GRAB_COMPLIANCE = 1e-4;

export class Session2D {
  constructor(def) {
    this.def = def;
    this.ps = new ParticleSystem();
    this.solver = new Solver(this.ps);
    this.body = SoftBody2D.build(this.ps, this.solver, { ...def.body, pipes: def.pipes ?? [] });
    this.body.settle(150);
    this.body.drainEvents();

    this.grabs = new Map();   // pointerId -> {anchor, particle}
    this.pins = new Set();    // particle indices
    this.cutDrag = null;      // {x0,y0,x1,y1}
    this.glueSel = null;
    this.gluePos = null;
    this.accumulator = 0;
    this.specs = def.targets.map(t => new TargetSpec(t));
  }

  get dim() { return 2; }

  evaluate(targetIdx) {
    return evaluate(this.state(), this.specs[targetIdx]);
  }

  /** World-space ghost of the target under the latest alignment, for rendering. */
  ghost(targetIdx, sim) {
    if (!sim?.transform) return null;
    const spec = this.specs[targetIdx];
    return {
      outlines: spec.outlines.map(o => inverseTransform(o, sim.transform)),
      pipes: spec.pipes.map(p => ({ points: inverseTransform(p.points, sim.transform), closed: p.closed })),
    };
  }

  render(ctx, view) {
    drawScene(ctx, this, {
      ...view,
      cutDrag: this.cutDrag,
      glueSel: this.glueSel,
      gluePos: this.gluePos,
    });
  }

  controlCount() { return this.grabs.size + this.pins.size; }

  step(dt) {
    // Fixed timestep with an accumulator; cap catch-up to avoid death spirals.
    this.accumulator = Math.min(this.accumulator + dt, 3 / 60);
    while (this.accumulator >= 1 / 60 - 1e-9) {
      this.solver.step(1 / 60);
      this.body.update();
      this.accumulator -= 1 / 60;
    }
    // Drop controls whose particles died in a cut.
    for (const [id, g] of [...this.grabs]) {
      g.anchors = g.anchors.filter(a => {
        if (this.ps.alive[a.c.i]) return true;
        this.solver.remove(a.c);
        return false;
      });
      if (g.anchors.length === 0) this.grabs.delete(id);
    }
    for (const i of [...this.pins]) if (!this.ps.alive[i]) this.pins.delete(i);
  }

  /** Player state snapshot for the similarity engine. */
  state() {
    return {
      rings: this.body.aliveIslands().map(i => this.body.ringPoints(i)),
      pipes: this.body.pipeChains(),
      topology: this.body.pipeTopology(),
    };
  }

  // ---- tools -------------------------------------------------------------

  pointerDown(tool, x, y, id) {
    if (tool === 'pull') return this.grabStart(x, y, id);
    if (tool === 'cut') {
      this.cutDrag = { x0: x, y0: y, x1: x, y1: y };
      return true;
    }
    if (tool === 'glue') {
      const sel = selectStretch(this.body, x, y, 28);
      if (!sel) { this.body.emit('hint', { text: '先点住软体的边缘' }); return false; }
      this.glueSel = sel;
      this.gluePos = { x, y };
      return true;
    }
    return false;
  }

  pointerMove(tool, x, y, id) {
    const g = this.grabs.get(id);
    if (g) {
      g.x = x; g.y = y;
      for (const a of g.anchors) a.c.setTarget(x + a.ox, y + a.oy);
    }
    if (tool === 'cut' && this.cutDrag) { this.cutDrag.x1 = x; this.cutDrag.y1 = y; }
    if (tool === 'glue' && this.glueSel) this.gluePos = { x, y };
  }

  pointerUp(tool, x, y, id) {
    const g = this.grabs.get(id);
    if (g) {
      for (const a of g.anchors) this.solver.remove(a.c);
      this.grabs.delete(id);
    }
    if (tool === 'cut' && this.cutDrag) {
      const { x0, y0 } = this.cutDrag;
      this.cutDrag = null;
      if (Math.hypot(x - x0, y - y0) > 8) performCut(this.body, x0, y0, x, y);
    }
    if (tool === 'glue' && this.glueSel) {
      const selA = this.glueSel;
      this.glueSel = null;
      this.gluePos = null;
      const selB = selectStretch(this.body, x, y, 28);
      if (!selB) { this.body.emit('hint', { text: '要贴到另一段边缘上' }); return; }
      const res = weldStretches(this.body, selA, selB);
      if (!res.ok) {
        const msg = { 'too-close': '离得太近，粘不出名堂', overlap: '不能自己粘自己', 'no-selection': '先选中一段边缘' }[res.reason];
        this.body.emit('hint', { text: msg ?? '粘合失败' });
      }
    }
  }

  grabStart(x, y, id) {
    if (this.controlCount() >= MAX_CONTROLS) {
      this.body.emit('hint', { text: `最多同时控制 ${MAX_CONTROLS} 个点（含图钉）` });
      return false;
    }
    const p = this.body.nearestParticle(x, y, GRAB_RADIUS);
    if (p < 0) return false;
    // Soft-hand grip: everything within GRIP_SPREAD moves as one rigid handle,
    // so dragging pulls a patch of material instead of tent-poling one vertex.
    const { ps } = this;
    const GRIP_SPREAD = 30;
    const anchors = [];
    for (const q of this.body.owned) {
      if (!ps.alive[q]) continue;
      const dx = ps.x[q] - x, dy = ps.y[q] - y;
      if (dx * dx + dy * dy > GRIP_SPREAD * GRIP_SPREAD) continue;
      anchors.push({
        c: this.solver.add(new AnchorConstraint(q, ps.x[q], ps.y[q], 0, GRAB_COMPLIANCE)),
        ox: dx, oy: dy,
      });
    }
    if (anchors.length === 0) return false;
    this.grabs.set(id, { anchors, particle: p, x, y });
    return true;
  }

  /** Double-click: toggle a pin at the nearest particle. */
  togglePin(x, y) {
    const p = this.body.nearestParticle(x, y, GRAB_RADIUS);
    if (p < 0) return;
    if (this.pins.has(p)) {
      this.ps.unpin(p);
      this.pins.delete(p);
      this.body.emit('unpinned');
      return;
    }
    if (this.controlCount() >= MAX_CONTROLS) {
      this.body.emit('hint', { text: `最多同时控制 ${MAX_CONTROLS} 个点（含图钉）` });
      return;
    }
    this.ps.pin(p);
    this.pins.add(p);
    this.body.emit('pinned');
  }

  drainEvents() { return this.body.drainEvents(); }
}
