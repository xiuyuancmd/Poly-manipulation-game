// A running 2D level: physics world + tool interactions. The Game orchestrator
// owns timing, similarity evaluation and HUD; the session owns the body and
// translates pointer gestures into physics operations.

import { ParticleSystem, Solver, AnchorConstraint } from '../engine/xpbd.js';
import { SoftBody2D } from '../engine/softbody2d.js';
import { performCut } from '../engine/cut2d.js';
import { selectStretch, weldStretches } from '../engine/glue2d.js';
import { TargetSpec, evaluate, inverseTransform } from '../engine/similarity2d.js';
import { pointInPolygon } from '../engine/geom.js';
import { drawScene } from '../render/render2d.js';
import { Effects } from '../render/effects.js';
import { themeFx } from './themes.js';

export const MAX_CONTROLS = 3;   // grabs + pins combined (game rule)
const GRAB_RADIUS = 34;
const GRAB_COMPLIANCE = 1e-4;

export class Session2D {
  constructor(def) {
    this.def = def;
    this.ps = new ParticleSystem();
    this.solver = new Solver(this.ps);
    // pressureSlew: live games ease runtime pressure changes over ~0.4 s so a
    // punctured loop audibly AND visibly collapses instead of teleporting.
    // (The raw engine default stays instant — deterministic tests untouched.)
    this.body = SoftBody2D.build(this.ps, this.solver, {
      ...def.body,
      pipes: def.pipes ?? [],
      pressureSlew: def.body.pressureSlew ?? 0.04,
    });
    // Authored-pose snapshot BEFORE the settle transient: the pressure/cable
    // transient can spin the whole specimen tens of degrees while settling,
    // leaving the live piece visibly rotated against its HUD preview.
    const prePose = [];
    for (const i of this.body.owned) {
      if (this.ps.alive[i]) prePose.push({ i, x: this.ps.x[i], y: this.ps.y[i] });
    }
    this.body.settle(150);
    this.body.drainEvents();
    this.derotate(prePose);

    // Workbench datum: where the clamped specimen rests. Drives the idle
    // re-centering in step() and the clamp-frame renderer.
    const rest = this.measureBody();
    this.anchor = { x: rest.cx, y: rest.cy };
    this.restBBox = rest.bbox;
    // Rest-pose snapshot (per-particle) for the idle ROTATION ease-back:
    // 2D Kabsch against this pose tells us how far the released specimen has
    // spun away from its clamped orientation.
    this.restPose = new Map();
    for (const i of this.body.owned) {
      if (this.ps.alive[i]) this.restPose.set(i, { x: this.ps.x[i], y: this.ps.y[i] });
    }

    // Theme fx (session layer only). In Node tests themeFx() safely resolves
    // to the lab defaults: pulse=false (the pulse code below never runs) and
    // reference particle styles — behaviour is bit-identical to pre-theme.
    const fx = themeFx();
    this.effects = new Effects(fx);
    // Bio theme heartbeat: a gentle sinusoidal modulation of each island's
    // pressure target. pulseT is the shared phase clock (game.js syncs the
    // ambient thump to it).
    this.pulse = !!fx.pulse;
    this.pulseT = 0;
    this.grabs = new Map();   // pointerId -> {anchor, particle}
    this.pins = new Set();    // particle indices
    // Cable-guide groove state (containPipes): seated particles and
    // per-particle exemption deadlines (cable recoil must whip freely
    // before the groove re-seats it).
    this.seated = new Set();
    this.freeUntil = new Map();
    this.t = 0;
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
      effects: this.effects,
      anchor: this.anchor,
      restBBox: this.restBBox,
    });
  }

  /** Centre of mass + bounding box over the live owned particles. */
  measureBody() {
    const { ps } = this;
    let cx = 0, cy = 0, n = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of this.body.owned) {
      if (!ps.alive[i]) continue;
      cx += ps.x[i]; cy += ps.y[i]; n++;
      if (ps.x[i] < minX) minX = ps.x[i];
      if (ps.x[i] > maxX) maxX = ps.x[i];
      if (ps.y[i] < minY) minY = ps.y[i];
      if (ps.y[i] > maxY) maxY = ps.y[i];
    }
    return {
      cx: n ? cx / n : 0,
      cy: n ? cy / n : 0,
      n,
      bbox: { minX, minY, maxX, maxY },
    };
  }

  controlCount() { return this.grabs.size + this.pins.size; }

  step(dt) {
    this.t += dt;
    // Bio pulse bookkeeping: restore the RAW (unmodulated) pressure targets
    // before physics, so the engine's pressureSlew always integrates on the
    // clean value and the modulation never compounds frame over frame.
    if (this.pulse) this.unpulse();
    // Fixed timestep with an accumulator; cap catch-up to avoid death spirals.
    this.accumulator = Math.min(this.accumulator + dt, 3 / 60);
    while (this.accumulator >= 1 / 60 - 1e-9) {
      this.solver.step(1 / 60);
      this.body.update();
      this.accumulator -= 1 / 60;
    }
    if (this.pulse) this.applyPulse(dt);
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
    this.effects.update(dt);
    // Workbench anchoring: with no live controls, ease the specimen back to
    // its clamped rest position (max 90 px/s). A UNIFORM translation of x/y
    // AND px/py leaves every constraint residual and velocity untouched, and
    // similarity is translation-invariant — physically and score-wise inert.
    if (this.grabs.size === 0 && this.pins.size === 0 && this.anchor) {
      // Rotation first (it preserves the centroid, so the translation below
      // stays valid). Intact single specimen only — cut fragments keep the
      // orientation the player left them in.
      if (this.body.aliveIslands().length === 1) {
        this.despin();
        if (this.restPose) this.rotateHome(dt);
      }
      const m = this.measureBody();
      if (m.n > 0) {
        const dx = this.anchor.x - m.cx, dy = this.anchor.y - m.cy;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          // Adaptive glide: 90 px/s near home (unchanged feel), proportional
          // boost far away so a violently flung specimen returns within ~4 s
          // instead of drifting for half a minute. Clamp to d: no overshoot.
          const s = Math.min(d, Math.max(90, 0.9 * d) * dt) / d;
          const mx = dx * s, my = dy * s;
          const { ps } = this;
          for (const i of this.body.owned) {
            if (!ps.alive[i]) continue;
            ps.x[i] += mx; ps.y[i] += my;
            ps.px[i] += mx; ps.py[i] += my;
          }
        }
      }
    }
    this.containPipes();
  }

  /** Bio pulse, part 1: undo last frame's modulation so the slew/goal logic
   *  in the engine only ever sees the clean target value. Session layer only
   *  — reads/writes areaC.targetArea exactly like the workbench code does. */
  unpulse() {
    for (const island of this.body.islands) {
      if (island._rawTarget == null || !island.areaC) continue;
      island.areaC.targetArea = island._rawTarget;
      island._rawTarget = null;
    }
  }

  /** Bio pulse, part 2: multiply the slewed pressure target of every live
   *  island by 1 + 1.8%·sin(2π·1.15Hz·t). The amplitude dies as the island's
   *  pressure goal falls below its rest area (goal/rest 0.95 -> 0.90 fades
   *  1 -> 0): a bled-out chamber stops beating — the core feedback. */
  applyPulse(dt) {
    this.pulseT += dt;
    const s = Math.sin(2 * Math.PI * 1.15 * this.pulseT) * 0.018;
    for (const island of this.body.aliveIslands()) {
      if (!island.areaC || island.baseRestArea <= 1e-9) continue;
      const rel = (island.pressureGoal ?? island.areaC.targetArea) / island.baseRestArea;
      const fade = Math.max(0, Math.min(1, (rel - 0.90) / 0.05));
      if (fade <= 0) continue;
      island._rawTarget = island.areaC.targetArea;
      island.areaC.targetArea = island._rawTarget * (1 + s * fade);
    }
  }

  /** Cable-guide grooves ("导缆槽") of the casting fixture: a pipe particle
   *  that has come to REST just outside the specimen wall is seated back to
   *  2 px inside the nearest island boundary. Session-layer containment only —
   *  no engine change. The groove wall is a NORMAL one-sided contact — purely
   *  dissipative, it only ever removes outward motion. Gates:
   *    - INITIAL seating requires OUTWARD-normal speed < 30 px/s — a
   *      recoiling cable tip punching outward (~220 px/s) whips freely, but a
   *      pinned specimen's rest-length oscillation (fast yet mostly
   *      tangential/alternating) is caught the moment its outward component
   *      dips — and freshly severed fragments carry a 1.2 s exemption window
   *      on top (set by cableRecoil);
   *    - protrusion <= 24 px — a fragment flung far away is NOT teleported
   *      across the bench (beyond that the seat releases entirely);
   *    - no live grabs — never fights the player's hand.
   *  Once seated the groove is STICKY: a taut bowstring cable yanks the
   *  particle back out with 100+ px/s every frame (measured on L3), so a
   *  plain speed gate would stall into a visible in/out shimmer. A seated
   *  particle is re-seated regardless of speed and its OUTWARD velocity
   *  component is cancelled — the same one-sided groove-wall contact — and
   *  the seat releases only once the particle sits >4 px INSIDE on its own
   *  AND has calmed below 30 px/s (a fast pass through the deep interior is
   *  the cable still oscillating, not a settled seat; releasing on depth
   *  alone let a pinned snap fragment ratchet back out every half-cycle).
   *  The seat moves x/y and px/py together, so it adds no velocity of its
   *  own. */
  containPipes() {
    if (this.grabs.size > 0) return;
    const { ps } = this;
    const islands = this.body.aliveIslands().map(i => this.body.ringPoints(i));
    if (islands.length === 0) return;
    for (const pipe of this.body.pipes) {
      if (!pipe.alive) continue;
      for (const p of pipe.parts) {
        if (!ps.alive[p]) continue;
        if ((this.freeUntil.get(p) ?? 0) > this.t) { this.seated.delete(p); continue; }
        const seated = this.seated.has(p);
        const x = ps.x[p], y = ps.y[p];
        const inside = islands.some(poly => pointInPolygon(poly, x, y));
        if (inside && !seated) continue;
        // Nearest point on any island boundary — needed by the entry gate
        // below too (its normal defines the outward direction).
        let bx = 0, by = 0, bd = Infinity;
        for (const poly of islands) {
          for (let i = 0, n = poly.length; i < n; i++) {
            const a = poly[i], b = poly[(i + 1) % n];
            const ex = b.x - a.x, ey = b.y - a.y;
            const L2 = ex * ex + ey * ey;
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / L2)) : 0;
            const qx = a.x + ex * t, qy = a.y + ey * t;
            const d = Math.hypot(x - qx, y - qy);
            if (d < bd) { bd = d; bx = qx; by = qy; }
          }
        }
        if (inside) {
          // Deep inside AND slow: the yank is genuinely gone, release the
          // seat. (Only seated particles reach here — see the early exit.)
          if (seated && bd > 4 && Math.hypot(ps.vx[p], ps.vy[p]) < 30) this.seated.delete(p);
          continue;
        }
        if (bd > 24 || bd < 1e-6) { this.seated.delete(p); continue; }
        const nx = (bx - x) / bd, ny = (by - y) / bd; // inward unit
        const vOut = -(ps.vx[p] * nx + ps.vy[p] * ny); // outward speed
        // Entry gate on the NORMAL component only: the groove wall is a
        // one-sided contact, so tangential speed is irrelevant to seating.
        if (!seated && vOut >= 30) continue;
        // Seat 2 px INSIDE along the outward->inward direction and cancel the
        // outward velocity component (one-sided contact, dissipative).
        const mx = bx + nx * 2 - x, my = by + ny * 2 - y;
        ps.x[p] += mx; ps.y[p] += my;
        ps.px[p] += mx; ps.py[p] += my;
        if (vOut > 0) { ps.vx[p] += vOut * nx; ps.vy[p] += vOut * ny; }
        this.seated.add(p);
      }
    }
  }

  /** Undo the settle transient's net rigid rotation (2D Kabsch vs the
   *  authored layout), so the specimen greets the player in the same
   *  orientation as its HUD preview. A uniform rigid rotation of positions
   *  (velocities are zero after settle) is physics- and score-inert. */
  derotate(prePose) {
    const { ps } = this;
    let rcx = 0, rcy = 0, ccx = 0, ccy = 0, n = 0;
    for (const p of prePose) {
      if (!ps.alive[p.i]) continue;
      rcx += p.x; rcy += p.y; ccx += ps.x[p.i]; ccy += ps.y[p.i]; n++;
    }
    if (n < 3) return;
    rcx /= n; rcy /= n; ccx /= n; ccy /= n;
    let sinS = 0, cosS = 0;
    for (const p of prePose) {
      if (!ps.alive[p.i]) continue;
      const rx = p.x - rcx, ry = p.y - rcy;
      const cx = ps.x[p.i] - ccx, cy = ps.y[p.i] - ccy;
      sinS += rx * cy - ry * cx;
      cosS += rx * cx + ry * cy;
    }
    const theta = Math.atan2(sinS, cosS);
    if (Math.abs(theta) < 1e-4) return;
    const cos = Math.cos(-theta), sin = Math.sin(-theta);
    for (const i of this.body.owned) {
      if (!ps.alive[i]) continue;
      const dx = ps.x[i] - ccx, dy = ps.y[i] - ccy;
      ps.x[i] = ccx + dx * cos - dy * sin;
      ps.y[i] = ccy + dx * sin + dy * cos;
      ps.px[i] = ps.x[i]; ps.py[i] = ps.y[i];
    }
  }

  /** Remove the net rigid-body angular velocity about the centroid. The
   *  sequential (Gauss-Seidel) constraint solver pumps a small steady angular
   *  momentum into pressure-loaded bodies — un-held specimens on L2/L4/L5
   *  slowly pirouette at rest, dragging their pipes with them. The clamp
   *  fixture holds the specimen instead: subtracting the UNIFORM rigid
   *  rotation field leaves every deformation velocity and constraint residual
   *  untouched (similarity is rotation-invariant too), so this is as inert as
   *  the translation re-centering below. */
  despin() {
    const { ps } = this;
    const m = this.measureBody();
    if (m.n < 3) return;
    let L = 0, I = 0;
    for (const i of this.body.owned) {
      if (!ps.alive[i]) continue;
      const dx = ps.x[i] - m.cx, dy = ps.y[i] - m.cy;
      L += dx * ps.vy[i] - dy * ps.vx[i];
      I += dx * dx + dy * dy;
    }
    if (I < 1e-9) return;
    const omega = L / I;
    if (Math.abs(omega) < 1e-6) return;
    for (const i of this.body.owned) {
      if (!ps.alive[i]) continue;
      ps.vx[i] += (ps.y[i] - m.cy) * omega;
      ps.vy[i] -= (ps.x[i] - m.cx) * omega;
    }
  }

  /** Idle rotation ease-back: 2D Kabsch of the surviving particles against the
   *  rest-pose snapshot gives the residual spin θ; rotate the whole live body
   *  a bounded step (max 20°/s) back toward θ = 0 about its CURRENT centroid.
   *  A uniform rotation of x/y and px/py leaves every constraint residual
   *  untouched and similarity is rotation-invariant — physically and
   *  score-wise inert, exactly like the translation above. Dead zone 0.01 rad
   *  so a settled specimen never micro-hunts. */
  rotateHome(dt) {
    const { ps } = this;
    // Matched subset: particles alive now AND present in the rest snapshot.
    let rcx = 0, rcy = 0, ccx = 0, ccy = 0, n = 0;
    for (const [i, r] of this.restPose) {
      if (!ps.alive[i]) continue;
      rcx += r.x; rcy += r.y; ccx += ps.x[i]; ccy += ps.y[i]; n++;
    }
    if (n < 3) return;
    rcx /= n; rcy /= n; ccx /= n; ccy /= n;
    let sinS = 0, cosS = 0;
    for (const [i, r] of this.restPose) {
      if (!ps.alive[i]) continue;
      const rx = r.x - rcx, ry = r.y - rcy;
      const cx = ps.x[i] - ccx, cy = ps.y[i] - ccy;
      sinS += rx * cy - ry * cx;
      cosS += rx * cx + ry * cy;
    }
    const theta = Math.atan2(sinS, cosS); // rest -> current spin
    if (Math.abs(theta) < 0.01) return;   // dead zone
    // Near home: gentle 20°/s glide. Far from home (a wild drag can wind the
    // piece up >100°): proportional boost so ANY windup squares itself away
    // within ~4 s — a fixed 20°/s would need up to 9 s from 180°. The clamp
    // to |theta| makes overshoot impossible, so this stays monotone.
    const BASE_RATE = 20 * Math.PI / 180;
    const rate = Math.max(BASE_RATE, Math.abs(theta) * 0.7);
    const d = -Math.sign(theta) * Math.min(Math.abs(theta), rate * dt);
    const cos = Math.cos(d), sin = Math.sin(d);
    const m = this.measureBody();
    for (const i of this.body.owned) {
      if (!ps.alive[i]) continue;
      const dx = ps.x[i] - m.cx, dy = ps.y[i] - m.cy;
      ps.x[i] = m.cx + dx * cos - dy * sin;
      ps.y[i] = m.cy + dx * sin + dy * cos;
      const qx = ps.px[i] - m.cx, qy = ps.py[i] - m.cy;
      ps.px[i] = m.cx + qx * cos - qy * sin;
      ps.py[i] = m.cy + qx * sin + qy * cos;
    }
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

  drainEvents() {
    const evts = this.body.drainEvents();
    // Cable recoil: a severed tension cable stores real elastic energy — kick
    // the freed fragment tips back along the chain and leave a brief
    // after-image. Session layer only: writes pipe-particle velocities,
    // never constraints, never boundary/matrix particles.
    for (const e of evts) {
      if (e.type === 'pipeCut' && e.pipeType === 'contractile'
          && Number.isFinite(e.x) && Number.isFinite(e.y)) {
        this.cableRecoil(e.x, e.y);
      }
    }
    return evts;
  }

  /** Find the (at most two) live contractile fragments whose freed end sits
   *  within 40 px of the cut, throw their 3–4 tip particles back along the
   *  local chain tangent (220 px/s at the tip decaying to 60 px/s, capped at
   *  250 px/s per particle) and hand a snapshot to the whip after-image. */
  cableRecoil(x, y) {
    const { ps } = this;
    const frags = [];
    for (const pipe of this.body.pipes) {
      if (!pipe.alive || pipe.type !== 'contractile' || pipe.closed || pipe.parts.length < 2) continue;
      const first = pipe.parts[0], last = pipe.parts[pipe.parts.length - 1];
      const dFirst = Math.hypot(ps.x[first] - x, ps.y[first] - y);
      const dLast = Math.hypot(ps.x[last] - x, ps.y[last] - y);
      const d = Math.min(dFirst, dLast);
      if (d < 40) frags.push({ pipe, fromStart: dFirst <= dLast, d });
    }
    frags.sort((a, b) => a.d - b.d);
    const snapshots = [];
    for (const { pipe, fromStart } of frags.slice(0, 2)) {
      const parts = pipe.parts;
      // The whole fragment whips: exempt it from the cable-guide groove for
      // 1.2 s (and unseat it), or the containment would clamp the recoil dead.
      for (const q of parts) {
        this.seated.delete(q);
        this.freeUntil.set(q, this.t + 1.2);
      }
      const tipN = Math.min(4, parts.length);
      for (let k = 0; k < tipN; k++) {
        // k = 0 is the freed tip; recoil points AWAY from the cut, along the
        // local chain tangent, fading toward the anchored end.
        const idx = fromStart ? k : parts.length - 1 - k;
        const nxt = fromStart ? Math.min(idx + 1, parts.length - 1) : Math.max(idx - 1, 0);
        const p = parts[idx], q = parts[nxt];
        if (p === q || !ps.alive[p] || !ps.alive[q]) continue;
        let tx = ps.x[q] - ps.x[p], ty = ps.y[q] - ps.y[p];
        const tl = Math.hypot(tx, ty);
        if (tl < 1e-6) continue;
        tx /= tl; ty /= tl;
        const v = 220 - (220 - 60) * (k / 3);
        ps.vx[p] += tx * v;
        ps.vy[p] += ty * v;
        const sp = Math.hypot(ps.vx[p], ps.vy[p]);
        if (sp > 250) { const f = 250 / sp; ps.vx[p] *= f; ps.vy[p] *= f; }
      }
      snapshots.push(parts.filter(i => ps.alive[i]).map(i => ({ x: ps.x[i], y: ps.y[i] })));
    }
    if (snapshots.length) this.effects.spawnWhip(snapshots);
  }
}
