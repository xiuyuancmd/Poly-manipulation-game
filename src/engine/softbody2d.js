// 2D soft body: boundary ring(s) + area (pressure/gel) constraint + internal
// spring lattice + embedded pipe chains with hidden material properties.
// The ring representation (ordered particle indices) is what cut2d.js operates on.

import { DistanceConstraint, AreaConstraint2D } from './xpbd.js';
import { pointInPolygon, resamplePolyline, ringSignedArea, polylineLength } from './geom.js';

// Hidden per-pipe material presets. Pipes all LOOK identical in game; these
// numbers are what the player discovers by experimenting.
export const PIPE_STYLES = {
  //                stretch      rest      bending (skip-2; null = floppy)
  normal:      { compliance: 3e-4, restFactor: 1.0, bendCompliance: 6e-4 },
  rigid:       { compliance: 1e-6, restFactor: 1.0, bendCompliance: 2e-6 },
  contractile: { compliance: 3e-5, restFactor: 0.58, bendCompliance: null },
  pressure:    { compliance: 2e-4, restFactor: 1.0, bendCompliance: null, loopCompliance: 2e-6, inflate: 1.5, bodyInflation: 0.5 },
  brittle:     { compliance: 1e-4, restFactor: 1.0, bendCompliance: 8e-5, breakStrain: 1.8 },
};

let nextIslandId = 1;
let nextPipeId = 1;

export class SoftBody2D {
  constructor(ps, solver, config = {}) {
    this.ps = ps;
    this.solver = solver;
    this.edgeLen = config.edgeLen ?? 16;
    this.basePressure = config.basePressure ?? 1.0;
    // Elastic membrane: the boundary can stretch noticeably under sustained
    // pull — target shapes may demand up to ~10% more perimeter than the rest
    // outline (a hard-inextensible ring would make elongated targets unreachable).
    this.boundaryCompliance = config.boundaryCompliance ?? 6e-5;
    // Bend: smooth boundary (suppresses wrinkle noise on deflated bodies).
    // Lattice: gentle shape memory — strong enough to spring back, weak enough
    // that 3 pins can hold a 2:1 aspect change (else most targets are unreachable).
    this.bendCompliance = config.bendCompliance ?? 8e-4;
    this.latticeCompliance = config.latticeCompliance ?? 1.5e-3;
    this.coupleCompliance = config.coupleCompliance ?? 8e-4;

    this.islands = [];   // {id, ring:[particle...], areaC, baseRestArea, alive, edgeCs:[], bendCs:[]}
    this.latticeCs = []; // {c, a, b}
    this.pipes = [];     // {id, type, props, parts:[...], segCs:[{c,a,b}], coupleCs:[], areaC, closed, deflated, alive}
    this.welds = [];     // {c, a, b}
    this.owned = new Set();
    this.events = [];    // consumed by the game layer for toasts/sfx
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---- construction -------------------------------------------------------

  static build(ps, solver, def) {
    const body = new SoftBody2D(ps, solver, def);
    // Boundary ring at ~edgeLen spacing, oriented to positive signed area.
    const perim = polylineLength(def.outline, true);
    const n = Math.max(24, Math.round(perim / body.edgeLen));
    let pts = resamplePolyline(def.outline, n, true);
    let a = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    if (a < 0) pts = pts.reverse();

    const ring = pts.map(p => body.addParticle(p.x, p.y));
    const island = body.makeIsland(ring);
    body.buildLattice(island, def.lattice);
    for (const pd of def.pipes ?? []) body.addPipe(pd);
    body.recomputePressure();
    return body;
  }

  addParticle(x, y) {
    const i = this.ps.add(x, y, 0, 1);
    this.owned.add(i);
    return i;
  }

  /** Creates an island record from an ordered ring, with edge/bend/area constraints
   *  built from CURRENT particle positions (so post-cut rings start relaxed). */
  makeIsland(ring) {
    const island = {
      id: nextIslandId++,
      ring,
      alive: true,
      edgeCs: [],
      bendCs: [],
      areaC: null,
      baseRestArea: 0,
    };
    this.buildRingConstraints(island);
    const area = Math.abs(ringSignedArea(this.ps, ring));
    island.baseRestArea = area;
    island.areaC = this.solver.add(new AreaConstraint2D(ring, area, 1e-6));
    this.islands.push(island);
    return island;
  }

  buildRingConstraints(island) {
    const { ps, solver } = this;
    for (const e of island.edgeCs) solver.remove(e.c);
    for (const e of island.bendCs) solver.remove(e.c);
    island.edgeCs = [];
    island.bendCs = [];
    const ring = island.ring, n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const rest = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a]);
      island.edgeCs.push({ a, b, c: solver.add(new DistanceConstraint(a, b, rest, this.boundaryCompliance)) });
    }
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 2) % n];
      const rest = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a]);
      island.bendCs.push({ a, b, c: solver.add(new DistanceConstraint(a, b, rest, this.bendCompliance)) });
    }
  }

  buildLattice(island, latticeDef = {}) {
    const { ps, solver } = this;
    const ring = island.ring, n = ring.length;
    const strides = latticeDef.strides ?? [0.25, 0.5];
    const compliance = latticeDef.compliance ?? this.latticeCompliance;
    const pts = this.ringPoints(island);
    const seen = new Set();
    for (const frac of strides) {
      const s = Math.max(3, Math.round(frac * n));
      for (let i = 0; i < n; i++) {
        const j = (i + s) % n;
        const key = Math.min(i, j) * 10000 + Math.max(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        const A = ring[i], B = ring[j];
        // Keep only chords that stay inside the body (matters for concave outlines).
        let inside = true;
        for (const f of [0.25, 0.5, 0.75]) {
          const mx = ps.x[A] + (ps.x[B] - ps.x[A]) * f;
          const my = ps.y[A] + (ps.y[B] - ps.y[A]) * f;
          if (!pointInPolygon(pts, mx, my)) { inside = false; break; }
        }
        if (!inside) continue;
        const rest = Math.hypot(ps.x[B] - ps.x[A], ps.y[B] - ps.y[A]);
        this.latticeCs.push({ a: A, b: B, c: solver.add(new DistanceConstraint(A, B, rest, compliance)) });
      }
    }
  }

  addPipe(pd) {
    const { ps, solver } = this;
    const style = { ...PIPE_STYLES[pd.type ?? 'normal'], ...(pd.overrides ?? {}) };
    const spacing = this.edgeLen * 0.9;
    const len = polylineLength(pd.path, !!pd.closed);
    const count = Math.max(3, Math.round(len / spacing) + (pd.closed ? 0 : 1));
    const pts = resamplePolyline(pd.path, count, !!pd.closed);
    const parts = pts.map(p => this.addParticle(p.x, p.y));
    const pipe = {
      id: nextPipeId++,
      type: pd.type ?? 'normal',
      props: style,
      parts,
      segCs: [],
      coupleCs: [],
      areaC: null,
      closed: !!pd.closed,
      deflated: false,
      alive: true,
    };
    // A pressurized loop must be ABLE to hold its inflated area: by the
    // isoperimetric inequality the chain rest lengths must grow by sqrt(inflate),
    // otherwise the area and distance constraints fight forever and pump energy.
    let restFactor = style.restFactor;
    if (pipe.closed && pipe.type === 'pressure') restFactor *= Math.sqrt(style.inflate ?? 1.5);
    const segN = pipe.closed ? count : count - 1;
    for (let k = 0; k < segN; k++) {
      const a = parts[k], b = parts[(k + 1) % count];
      const rest = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a]) * restFactor;
      pipe.segCs.push({ a, b, c: solver.add(new DistanceConstraint(a, b, rest, style.compliance)) });
    }
    if (pipe.closed && pipe.type === 'pressure') {
      const area = Math.abs(ringSignedArea(ps, parts)) * (style.inflate ?? 1.5);
      pipe.areaC = solver.add(new AreaConstraint2D(parts, area, style.loopCompliance ?? 2e-6));
    }
    this.buildPipeTie(pipe);
    this.buildPipeBends(pipe);
    // Couple pipe particles to their 2 nearest boundary particles. Mid-chain
    // particles get rope tethers (resist stretch only, so an inflating loop can
    // drift freely); the ENDS of open pipes are anchored bilaterally — tendon
    // insertions — so muscles and struts actually transmit force to the wall.
    const ringAll = [];
    for (const isl of this.islands) if (isl.alive) ringAll.push(...isl.ring);
    const coupleMax = this.edgeLen * 8;
    for (const p of parts) {
      const isEnd = !pipe.closed && (p === parts[0] || p === parts[parts.length - 1]);
      const near = ringAll
        .map(r => ({ r, d: Math.hypot(ps.x[r] - ps.x[p], ps.y[r] - ps.y[p]) }))
        .filter(e => e.d < coupleMax)
        .sort((u, v) => u.d - v.d)
        .slice(0, 2);
      for (const e of near) {
        const c = isEnd
          ? new DistanceConstraint(p, e.r, e.d, 1.2e-4, false)
          : new DistanceConstraint(p, e.r, e.d, this.coupleCompliance, true);
        pipe.coupleCs.push({ a: p, b: e.r, c: solver.add(c) });
      }
    }
    this.pipes.push(pipe);
    return pipe;
  }

  /** A muscle must pull its ENDS together — per-segment contraction alone lets
   *  the chain coil up slack. Tie the endpoints with the contracted total length.
   *  Severing the chain removes the tie: cutting a tendon releases its pull. */
  buildPipeTie(pipe) {
    if (pipe.tieC) { this.solver.remove(pipe.tieC); pipe.tieC = null; }
    if (pipe.closed || pipe.type !== 'contractile' || pipe.parts.length < 3) return;
    const rest = pipe.segCs.reduce((s, e) => s + e.c.rest, 0);
    const a = pipe.parts[0], b = pipe.parts[pipe.parts.length - 1];
    pipe.tieC = this.solver.add(new DistanceConstraint(a, b, rest, pipe.props.compliance));
  }

  /** Skip-2 bending springs along a chain, per material. Rebuilt after surgery. */
  buildPipeBends(pipe) {
    const { ps, solver } = this;
    for (const b of pipe.bendCs ?? []) solver.remove(b.c);
    pipe.bendCs = [];
    const bc = pipe.props.bendCompliance;
    if (bc == null) return;
    const parts = pipe.parts, n = parts.length;
    const m = pipe.closed ? n : n - 2;
    for (let k = 0; k < m; k++) {
      const a = parts[k], b = parts[(k + 2) % n];
      const rest = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a]) * pipe.props.restFactor;
      pipe.bendCs.push({ a, b, c: solver.add(new DistanceConstraint(a, b, rest, bc)) });
    }
  }

  // ---- pressure coupling ---------------------------------------------------

  /** Pressure factor of an island: base + contributions of live pressure pipes inside it. */
  computeFactor(island) {
    let factor = this.basePressure;
    const pts = this.ringPoints(island);
    for (const pipe of this.pipes) {
      if (!pipe.alive || pipe.type !== 'pressure' || pipe.deflated) continue;
      const mid = pipe.parts[Math.floor(pipe.parts.length / 2)];
      if (pointInPolygon(pts, this.ps.x[mid], this.ps.y[mid])) {
        factor += pipe.props.bodyInflation ?? 0.5;
      }
    }
    return factor;
  }

  /** Body area target = rest area x (base pressure + live pressure-pipe contributions). */
  recomputePressure() {
    for (const island of this.islands) {
      if (!island.alive) continue;
      island.areaC.targetArea = island.baseRestArea * this.computeFactor(island);
    }
  }

  /** Remove an island's constraints but KEEP its particles (they get re-used by
   *  the replacement rings during cut surgery). */
  retireIsland(island) {
    island.alive = false;
    for (const e of island.edgeCs) this.solver.remove(e.c);
    for (const e of island.bendCs) this.solver.remove(e.c);
    if (island.areaC) this.solver.remove(island.areaC);
    const idx = this.islands.indexOf(island);
    if (idx >= 0) this.islands.splice(idx, 1);
  }

  // ---- pipe surgery (shared by cutting and brittle failure) ----------------

  severPipeSegment(pipe, segIdx) {
    const seg = pipe.segCs[segIdx];
    if (!seg) return;
    this.solver.remove(seg.c);
    if (pipe.closed) {
      // Ring pipe becomes one open chain starting just after the removed segment.
      const n = pipe.parts.length;
      const at = (segIdx + 1) % n;
      pipe.parts = pipe.parts.slice(at).concat(pipe.parts.slice(0, at));
      pipe.segCs = pipe.segCs.slice(segIdx + 1).concat(pipe.segCs.slice(0, segIdx));
      pipe.closed = false;
      this.buildPipeTie(pipe);
      this.buildPipeBends(pipe);
      if (pipe.areaC) {
        this.solver.remove(pipe.areaC);
        pipe.areaC = null;
        pipe.deflated = true;
        this.recomputePressure();
        this.emit('deflate', { pipe: pipe.id });
      }
      this.emit('pipeCut', { pipe: pipe.id });
      return;
    }
    // Open chain splits in two.
    const partsA = pipe.parts.slice(0, segIdx + 1);
    const partsB = pipe.parts.slice(segIdx + 1);
    const segA = pipe.segCs.slice(0, segIdx);
    const segB = pipe.segCs.slice(segIdx + 1);
    for (const b of pipe.bendCs ?? []) this.solver.remove(b.c);
    if (pipe.tieC) { this.solver.remove(pipe.tieC); pipe.tieC = null; }
    const splitCouples = (parts) => pipe.coupleCs.filter(cc => parts.includes(cc.a));
    const mkPipe = (parts, segCs) => {
      const np = {
        ...pipe,
        id: nextPipeId++,
        parts,
        segCs,
        coupleCs: splitCouples(parts),
        bendCs: [],
        tieC: null,
        areaC: null,
        closed: false,
      };
      this.buildPipeTie(np); // each fragment keeps contracting along itself
      this.buildPipeBends(np);
      return np;
    };
    const out = [];
    for (const [parts, segCs] of [[partsA, segA], [partsB, segB]]) {
      if (parts.length >= 2) {
        out.push(mkPipe(parts, segCs));
      } else {
        // Degenerate 1-particle stub: remove entirely.
        for (const p of parts) {
          for (const cc of pipe.coupleCs.filter(cc => cc.a === p)) this.solver.remove(cc.c);
          this.ps.kill(p);
          this.owned.delete(p);
        }
      }
    }
    pipe.alive = false;
    const idx = this.pipes.indexOf(pipe);
    this.pipes.splice(idx, 1, ...out);
    this.emit('pipeCut', { pipe: pipe.id });
  }

  /** Per-frame material checks (brittle pipes snapping under overstretch). */
  update() {
    for (const pipe of [...this.pipes]) {
      if (!pipe.alive || !pipe.props.breakStrain) continue;
      for (let k = 0; k < pipe.segCs.length; k++) {
        if (pipe.segCs[k].c.currentStrain(this.ps) > pipe.props.breakStrain) {
          this.severPipeSegment(pipe, k);
          this.emit('snap', {});
          break;
        }
      }
    }
  }

  // ---- queries --------------------------------------------------------------

  ringPoints(island) {
    const { ps } = this;
    return island.ring.map(i => ({ x: ps.x[i], y: ps.y[i] }));
  }

  aliveIslands() { return this.islands.filter(i => i.alive); }

  pipeChains() {
    const { ps } = this;
    return this.pipes
      .filter(p => p.alive)
      .map(p => ({
        id: p.id,
        closed: p.closed,
        points: p.parts.map(i => ({ x: ps.x[i], y: ps.y[i] })),
      }));
  }

  /** (chains, loops) — the similarity topology gate. */
  pipeTopology() {
    let chains = 0, loops = 0;
    for (const p of this.pipes) {
      if (!p.alive) continue;
      if (p.closed) loops++; else chains++;
    }
    return { chains, loops };
  }

  containsPoint(x, y) {
    for (const island of this.islands) {
      if (island.alive && pointInPolygon(this.ringPoints(island), x, y)) return island;
    }
    return null;
  }

  nearestParticle(x, y, maxDist = Infinity) {
    const { ps } = this;
    let best = -1, bestD = maxDist;
    for (const i of this.owned) {
      if (!ps.alive[i]) continue;
      const d = Math.hypot(ps.x[i] - x, ps.y[i] - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  nearestBoundary(x, y, maxDist = Infinity) {
    const { ps } = this;
    let best = null, bestD = maxDist;
    for (const island of this.aliveIslands()) {
      for (let k = 0; k < island.ring.length; k++) {
        const i = island.ring[k];
        const d = Math.hypot(ps.x[i] - x, ps.y[i] - y);
        if (d < bestD) { bestD = d; best = { island, ringIdx: k, particle: i }; }
      }
    }
    return best;
  }

  /** Drop an island that became degenerate (used by cut surgery). */
  dropIsland(island) {
    island.alive = false;
    for (const e of island.edgeCs) this.solver.remove(e.c);
    for (const e of island.bendCs) this.solver.remove(e.c);
    if (island.areaC) this.solver.remove(island.areaC);
    for (const i of island.ring) { this.ps.kill(i); this.owned.delete(i); }
  }

  settle(steps = 90, dt = 1 / 60) {
    const { ps } = this;
    const com = () => {
      let x = 0, y = 0, n = 0;
      for (const i of this.owned) {
        if (!ps.alive[i]) continue;
        x += ps.x[i]; y += ps.y[i]; n++;
      }
      return { x: x / n, y: y / n };
    };
    const before = com();
    // Heavy damping while the initial constraint transient (pressure targets,
    // muscle contraction) plays out, so it cannot fold pipes or throw the body.
    const prevDamping = this.solver.damping;
    this.solver.damping = 0.6;
    for (let s = 0; s < steps; s++) {
      this.solver.step(dt);
      this.update();
    }
    this.solver.damping = prevDamping;
    // Sequential (Gauss-Seidel) solves don't conserve momentum under violent
    // transients: put the centre of mass back where the level author placed it.
    const after = com();
    const dx = before.x - after.x, dy = before.y - after.y;
    for (const i of this.owned) {
      if (!ps.alive[i]) continue;
      ps.x[i] += dx; ps.y[i] += dy;
      ps.vx[i] = 0; ps.vy[i] = 0;
    }
  }
}
