// A running 3D level. Same interface as Session2D. v1 scope: drag/pin surface
// vertices, snip pipes with the cut tool, orbit the camera by dragging empty
// space. No surface cutting or gluing in 3D.

import { ParticleSystem, Solver, AnchorConstraint } from '../engine/xpbd.js';
import { SoftBody3D } from '../engine/softbody3d.js';
import { TargetSpec3D, evaluate3D } from '../engine/similarity3d.js';
import { Camera3D, drawScene3D } from '../render/render3d.js';
import { Effects } from '../render/effects.js';
import { MAX_CONTROLS } from './session2d.js';
import { themeFx } from './themes.js';

const PICK_RADIUS = 22;   // px
const GRIP_SPREAD = 48;   // world units, soft-hand radius
const GRAB_COMPLIANCE = 8e-5;

export class Session3D {
  constructor(def, canvas) {
    this.def = def;
    this.ps = new ParticleSystem();
    this.solver = new Solver(this.ps);
    this.body = SoftBody3D.buildCube(this.ps, this.solver, def.body3d);
    for (const pd of def.pipes3d ?? []) this.body.addPipe(pd);
    this.body.settle(150);
    this.body.drainEvents();
    // Workbench datum: the settled centroid. Drives the idle re-centering in
    // step(). Translation only — a 3D despin/rotate-home needs the full
    // inertia tensor and is out of this round's budget.
    this.restCentroid = this.body.centroid();
    this.specs = def.targets.map(t => new TargetSpec3D(t));
    this.camera = new Camera3D(canvas.width, canvas.height);
    // Screen-space effect particles (fracture sparks at pipe cuts). The 3D
    // pipeCut event carries no coordinates, so the cut branch projects the
    // severed segment's midpoint itself and feeds Effects directly.
    // Theme fx style injected here (no pulse in 3D levels by design).
    this.effects = new Effects(themeFx());
    this.grabs = new Map();   // pointerId -> {vertex, anchors:[{c,ox,oy,oz}], plane}
    this.pins = new Set();
    this.orbit = null;
    this.accumulator = 0;
  }

  get dim() { return 3; }

  controlCount() { return this.grabs.size + this.pins.size; }

  drainEvents() { return this.body.drainEvents(); }

  step(dt) {
    this.accumulator = Math.min(this.accumulator + dt, 3 / 60);
    while (this.accumulator >= 1 / 60 - 1e-9) {
      this.solver.step(1 / 60);
      this.body.update();
      this.accumulator -= 1 / 60;
    }
    this.effects.update(dt);
    // Workbench anchoring (translation only, same contract as 2D): with no
    // live controls, glide the whole specimen back to its settled centroid at
    // max(60, 0.9·d) units/s, clamped to d. Moving x/y/z AND px/py/pz
    // uniformly leaves every constraint residual and velocity untouched.
    if (this.grabs.size === 0 && this.pins.size === 0 && this.restCentroid) {
      const c = this.body.centroid();
      const dx = this.restCentroid.x - c.x;
      const dy = this.restCentroid.y - c.y;
      const dz = this.restCentroid.z - c.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.5) {
        const s = Math.min(d, Math.max(60, 0.9 * d) * dt) / d;
        const { ps } = this;
        for (const i of this.body.owned) {
          if (!ps.alive[i]) continue;
          ps.x[i] += dx * s; ps.y[i] += dy * s; ps.z[i] += dz * s;
          ps.px[i] += dx * s; ps.py[i] += dy * s; ps.pz[i] += dz * s;
        }
      }
    }
  }

  evaluate(targetIdx) {
    return evaluate3D({
      ps: this.ps,
      tris: this.body.tris,
      verts: this.body.verts,
      centroid: this.body.centroid(),
      pipes: this.body.pipeChains(),
      topology: this.body.pipeTopology(),
    }, this.specs[targetIdx]);
  }

  ghost(targetIdx, sim) {
    if (!sim?.transform) return null;
    return { box: this.specs[targetIdx].box, at: sim.transform.centroid };
  }

  render(ctx, view) {
    drawScene3D(ctx, this, view);
  }

  // ---- picking helpers ------------------------------------------------------

  pickVertex(sx, sy) {
    const basis = this.camera.basis();
    let best = -1, bestD = PICK_RADIUS;
    for (const v of this.body.verts) {
      if (!this.ps.alive[v]) continue;
      const p = this.camera.project(this.ps.x[v], this.ps.y[v], this.ps.z[v], basis);
      if (!p) continue;
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  pickPipeSegment(sx, sy) {
    const basis = this.camera.basis();
    let best = null, bestD = 16;
    for (const pipe of this.body.pipes) {
      if (!pipe.alive) continue;
      for (let k = 0; k < pipe.segCs.length; k++) {
        const s = pipe.segCs[k];
        const mx = (this.ps.x[s.a] + this.ps.x[s.b]) / 2;
        const my = (this.ps.y[s.a] + this.ps.y[s.b]) / 2;
        const mz = (this.ps.z[s.a] + this.ps.z[s.b]) / 2;
        const p = this.camera.project(mx, my, mz, basis);
        if (!p) continue;
        const d = Math.hypot(p.sx - sx, p.sy - sy);
        if (d < bestD) { bestD = d; best = { pipe, k }; }
      }
    }
    return best;
  }

  // ---- tools ------------------------------------------------------------------

  pointerDown(tool, x, y, id) {
    if (tool === 'cut') {
      const hit = this.pickPipeSegment(x, y);
      if (hit) {
        // Fracture sparks at the break: take the segment midpoint BEFORE the
        // surgery mutates the pipe, project it to the screen, feed Effects.
        const s = hit.pipe.segCs[hit.k];
        const p = this.camera.project(
          (this.ps.x[s.a] + this.ps.x[s.b]) / 2,
          (this.ps.y[s.a] + this.ps.y[s.b]) / 2,
          (this.ps.z[s.a] + this.ps.z[s.b]) / 2,
        );
        if (p) this.effects.spawnSparks(p.sx, p.sy);
        this.body.severPipeSegment(hit.pipe, hit.k);
        this.body.emit('snip');
      } else {
        this.body.emit('hint', { text: '对准管道点一下，就能剪断它' });
      }
      return false;
    }
    const v = this.pickVertex(x, y);
    if (v >= 0) {
      if (this.controlCount() >= MAX_CONTROLS) {
        this.body.emit('hint', { text: `最多同时控制 ${MAX_CONTROLS} 个点（含图钉）` });
        return false;
      }
      const { ps } = this;
      const plane = { x: ps.x[v], y: ps.y[v], z: ps.z[v] };
      const anchors = [];
      for (const q of this.body.owned) {
        if (!ps.alive[q]) continue;
        const dx = ps.x[q] - plane.x, dy = ps.y[q] - plane.y, dz = ps.z[q] - plane.z;
        if (dx * dx + dy * dy + dz * dz > GRIP_SPREAD * GRIP_SPREAD) continue;
        anchors.push({
          c: this.solver.add(new AnchorConstraint(q, ps.x[q], ps.y[q], ps.z[q], GRAB_COMPLIANCE)),
          ox: dx, oy: dy, oz: dz,
        });
      }
      this.grabs.set(id, { vertex: v, anchors, plane });
      return true;
    }
    // Empty space: orbit the camera.
    this.orbit = { id, x, y };
    return true;
  }

  pointerMove(tool, x, y, id) {
    const g = this.grabs.get(id);
    if (g) {
      const hit = this.camera.planeHit(g.plane, x, y);
      for (const a of g.anchors) a.c.setTarget(hit.x + a.ox, hit.y + a.oy, hit.z + a.oz);
      return;
    }
    if (this.orbit && this.orbit.id === id) {
      this.camera.yaw -= (x - this.orbit.x) * 0.0075;
      this.camera.pitch = Math.max(-1.2, Math.min(1.2, this.camera.pitch + (y - this.orbit.y) * 0.006));
      this.orbit.x = x;
      this.orbit.y = y;
    }
  }

  pointerUp(tool, x, y, id) {
    const g = this.grabs.get(id);
    if (g) {
      for (const a of g.anchors) this.solver.remove(a.c);
      this.grabs.delete(id);
    }
    if (this.orbit && this.orbit.id === id) this.orbit = null;
  }

  togglePin(x, y) {
    const v = this.pickVertex(x, y);
    if (v < 0) return;
    if (this.pins.has(v)) {
      this.ps.unpin(v);
      this.pins.delete(v);
      this.body.emit('unpinned');
      return;
    }
    if (this.controlCount() >= MAX_CONTROLS) {
      this.body.emit('hint', { text: `最多同时控制 ${MAX_CONTROLS} 个点（含图钉）` });
      return;
    }
    this.ps.pin(v);
    this.pins.add(v);
    this.body.emit('pinned');
  }
}
