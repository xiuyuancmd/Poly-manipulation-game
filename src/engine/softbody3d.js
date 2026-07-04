// 3D soft body: closed triangle-mesh surface (subdivided cube), edge + shear
// springs, a volume (gel) constraint, and internal pipe chains. Reuses the
// 3D-native XPBD solver. v1 scope: pipes can be snipped; no surface cutting.

import { DistanceConstraint, VolumeConstraint3D } from './xpbd.js';

export class SoftBody3D {
  constructor(ps, solver) {
    this.ps = ps;
    this.solver = solver;
    this.verts = [];
    this.tris = [];      // flat index triples, outward orientation
    this.edgeCs = [];
    this.volC = null;
    this.pipes = [];     // {id, parts, segCs, bendCs, coupleCs, alive}
    this.owned = new Set();
    this.events = [];
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /** Axis-aligned soft cube, `segments` quads per edge, centred at origin. */
  static buildCube(ps, solver, { size = 220, segments = 4, pressure = 1.0 } = {}) {
    const body = new SoftBody3D(ps, solver);
    const h = size / 2;
    const key = (x, y, z) => `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
    const cache = new Map();
    const vertex = (x, y, z) => {
      const k = key(x, y, z);
      if (cache.has(k)) return cache.get(k);
      const i = ps.add(x, y, z, 1);
      cache.set(k, i);
      body.verts.push(i);
      body.owned.add(i);
      return i;
    };
    // Each face: u,v axes and a fixed normal axis at +-h.
    const faces = [
      { o: [-h, -h, h], u: [1, 0, 0], v: [0, 1, 0] },   // +z
      { o: [h, -h, -h], u: [-1, 0, 0], v: [0, 1, 0] },  // -z
      { o: [h, -h, h], u: [0, 0, -1], v: [0, 1, 0] },   // +x
      { o: [-h, -h, -h], u: [0, 0, 1], v: [0, 1, 0] },  // -x
      { o: [-h, h, h], u: [1, 0, 0], v: [0, 0, -1] },   // +y
      { o: [-h, -h, -h], u: [1, 0, 0], v: [0, 0, 1] },  // -y
    ];
    const step = size / segments;
    for (const f of faces) {
      const grid = [];
      for (let r = 0; r <= segments; r++) {
        grid.push([]);
        for (let c = 0; c <= segments; c++) {
          grid[r].push(vertex(
            f.o[0] + f.u[0] * c * step + f.v[0] * r * step,
            f.o[1] + f.u[1] * c * step + f.v[1] * r * step,
            f.o[2] + f.u[2] * c * step + f.v[2] * r * step,
          ));
        }
      }
      for (let r = 0; r < segments; r++) {
        for (let c = 0; c < segments; c++) {
          const a = grid[r][c], b = grid[r][c + 1], d = grid[r + 1][c], e = grid[r + 1][c + 1];
          body.tris.push(a, b, e, a, e, d);
        }
      }
    }
    // Structural edges (unique tri edges) + both quad diagonals come from the
    // triangulation; add the missing anti-diagonal per quad for shear symmetry.
    const seen = new Set();
    const addEdge = (a, b, compliance) => {
      const k = Math.min(a, b) * 100000 + Math.max(a, b);
      if (seen.has(k)) return;
      seen.add(k);
      const rest = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a], ps.z[b] - ps.z[a]);
      body.edgeCs.push({ a, b, c: solver.add(new DistanceConstraint(a, b, rest, compliance)) });
    };
    for (let t = 0; t < body.tris.length; t += 3) {
      const [a, b, c] = [body.tris[t], body.tris[t + 1], body.tris[t + 2]];
      addEdge(a, b, 8e-5);
      addEdge(b, c, 8e-5);
      addEdge(c, a, 8e-5);
    }
    // Volume: incompressible gel at `pressure` x rest volume.
    const v0 = VolumeConstraint3D.meshVolume(ps, body.tris);
    body.volC = solver.add(new VolumeConstraint3D(body.tris, v0 * pressure, 2e-7));
    return body;
  }

  /** Straight pipe chain between two 3D points, rigid by default. */
  addPipe({ from, to, count = 8, compliance = 1e-6, bendCompliance = 2e-6 }) {
    const { ps, solver } = this;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const idx = ps.add(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
        1,
      );
      parts.push(idx);
      this.owned.add(idx);
    }
    const pipe = { id: this.pipes.length + 1, parts, segCs: [], bendCs: [], coupleCs: [], alive: true, compliance, bendCompliance };
    const d3 = (a, b) => Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a], ps.z[b] - ps.z[a]);
    for (let k = 0; k < count - 1; k++) {
      pipe.segCs.push({ a: parts[k], b: parts[k + 1], c: solver.add(new DistanceConstraint(parts[k], parts[k + 1], d3(parts[k], parts[k + 1]), compliance)) });
    }
    this.buildPipeBends(pipe);
    // Ends anchor bilaterally to their 2 nearest surface vertices; middles get
    // rope tethers (same cable end-fitting model as 2D).
    for (const p of parts) {
      const isEnd = p === parts[0] || p === parts[count - 1];
      const near = this.verts
        .map(v => ({ v, d: d3(p, v) }))
        .sort((u, w) => u.d - w.d)
        .slice(0, 2);
      for (const e of near) {
        const c = isEnd
          ? new DistanceConstraint(p, e.v, e.d, 1e-5, false)
          : new DistanceConstraint(p, e.v, e.d, 8e-4, true);
        pipe.coupleCs.push({ a: p, b: e.v, c: solver.add(c) });
      }
    }
    this.pipes.push(pipe);
    return pipe;
  }

  buildPipeBends(pipe) {
    const { ps, solver } = this;
    for (const b of pipe.bendCs) solver.remove(b.c);
    pipe.bendCs = [];
    const parts = pipe.parts;
    const d3 = (a, b) => Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a], ps.z[b] - ps.z[a]);
    for (let k = 0; k + 2 < parts.length; k++) {
      pipe.bendCs.push({ a: parts[k], b: parts[k + 2], c: solver.add(new DistanceConstraint(parts[k], parts[k + 2], d3(parts[k], parts[k + 2]), pipe.bendCompliance)) });
    }
  }

  /** Snip an open pipe chain at segment k -> two independent chains. */
  severPipeSegment(pipe, segIdx) {
    const seg = pipe.segCs[segIdx];
    if (!seg) return;
    this.solver.remove(seg.c);
    for (const b of pipe.bendCs) this.solver.remove(b.c);
    const partsA = pipe.parts.slice(0, segIdx + 1);
    const partsB = pipe.parts.slice(segIdx + 1);
    const out = [];
    for (const [parts, segCs] of [
      [partsA, pipe.segCs.slice(0, segIdx)],
      [partsB, pipe.segCs.slice(segIdx + 1)],
    ]) {
      if (parts.length < 2) {
        for (const p of parts) {
          for (const cc of pipe.coupleCs.filter(cc => cc.a === p)) this.solver.remove(cc.c);
          this.ps.kill(p);
          this.owned.delete(p);
        }
        continue;
      }
      const np = {
        ...pipe,
        id: this.pipes.length + 10 + out.length,
        parts,
        segCs,
        bendCs: [],
        coupleCs: pipe.coupleCs.filter(cc => parts.includes(cc.a)),
      };
      this.buildPipeBends(np);
      out.push(np);
    }
    pipe.alive = false;
    this.pipes.splice(this.pipes.indexOf(pipe), 1, ...out);
    this.emit('pipeCut', {});
  }

  pipeTopology() {
    return { chains: this.pipes.filter(p => p.alive).length, loops: 0 };
  }

  pipeChains() {
    const { ps } = this;
    return this.pipes.filter(p => p.alive).map(p => ({
      id: p.id,
      closed: false,
      points: p.parts.map(i => ({ x: ps.x[i], y: ps.y[i], z: ps.z[i] })),
    }));
  }

  centroid() {
    const { ps } = this;
    let x = 0, y = 0, z = 0, n = 0;
    for (const i of this.verts) {
      if (!ps.alive[i]) continue;
      x += ps.x[i]; y += ps.y[i]; z += ps.z[i]; n++;
    }
    return { x: x / n, y: y / n, z: z / n };
  }

  update() { /* no per-frame material checks in v1 */ }

  settle(steps = 60, dt = 1 / 60) {
    const prev = this.solver.damping;
    this.solver.damping = 0.6;
    for (let s = 0; s < steps; s++) this.solver.step(dt);
    this.solver.damping = prev;
    for (const i of this.owned) { this.ps.vx[i] = 0; this.ps.vy[i] = 0; this.ps.vz[i] = 0; }
  }
}
