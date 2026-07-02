// 3D similarity: voxel-occupancy IoU on an N^3 grid, translation-aligned by
// centroid (orientation is fixed by design — the ghost box shows the player
// the expected pose), plus 3D pipe Chamfer and the same topology gate as 2D.

const N = 20;
const IOU_FULL = 0.80;
const IOU_ZERO = 0.25;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export class TargetSpec3D {
  /**
   * def: { name, box: [sx, sy, sz] (axis-aligned, centred), pipes: [[{x,y,z},...]],
   *        topology: {chains, loops}, weights: {outline, pipes} }
   */
  constructor(def) {
    this.name = def.name ?? '';
    this.box = def.box;
    this.pipes = def.pipes ?? [];
    this.weights = def.weights ?? { outline: 0.8, pipes: 0.2 };
    this.topology = def.topology ?? { chains: this.pipes.length, loops: 0 };
    this.is3D = true;
    const span = Math.max(...def.box) * 1.5;
    this.frame = { span, cell: span / N };
    this.radius = Math.hypot(def.box[0], def.box[1], def.box[2]) / 2;
    // Analytic occupancy of the axis-aligned box, centred in the frame.
    this.grid = new Uint8Array(N * N * N);
    let count = 0;
    for (let iz = 0; iz < N; iz++) {
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const x = (ix + 0.5) * this.frame.cell - span / 2;
          const y = (iy + 0.5) * this.frame.cell - span / 2;
          const z = (iz + 0.5) * this.frame.cell - span / 2;
          if (Math.abs(x) <= def.box[0] / 2 && Math.abs(y) <= def.box[1] / 2 && Math.abs(z) <= def.box[2] / 2) {
            this.grid[(iz * N + iy) * N + ix] = 1;
            count++;
          }
        }
      }
    }
    this.gridCount = count;
  }
}

/**
 * state: { ps, tris, verts, centroid: {x,y,z}, pipes: [{points:[{x,y,z}]}], topology }
 * Voxelizes the player mesh by casting z-columns and parity-filling crossings.
 */
export function evaluate3D(state, spec) {
  const { ps, tris, centroid } = state;
  const span = spec.frame.span, cell = spec.frame.cell;
  const grid = new Uint8Array(N * N * N);

  // Column crossings: for each (x,y) column centre, z-values where the ray
  // pierces a triangle; sort and fill between pairs.
  const cols = Array.from({ length: N * N }, () => []);
  const x0 = centroid.x - span / 2, y0 = centroid.y - span / 2, z0 = centroid.z - span / 2;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = ps.x[a], ay = ps.y[a], bx = ps.x[b], by = ps.y[b], cx = ps.x[c], cy = ps.y[c];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((minX - x0) / cell - 0.5));
    const i1 = Math.min(N - 1, Math.ceil((maxX - x0) / cell - 0.5));
    const j0 = Math.max(0, Math.floor((minY - y0) / cell - 0.5));
    const j1 = Math.min(N - 1, Math.ceil((maxY - y0) / cell - 0.5));
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-9) continue; // edge-on in xy
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell;
        const w1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
        const w2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        cols[j * N + i].push(w1 * ps.z[a] + w2 * ps.z[b] + w3 * ps.z[c]);
      }
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const zs = cols[j * N + i];
      if (zs.length < 2) continue;
      zs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < zs.length; k += 2) {
        const k0 = Math.max(0, Math.ceil((zs[k] - z0) / cell - 0.5));
        const k1 = Math.min(N - 1, Math.floor((zs[k + 1] - z0) / cell - 0.5));
        for (let iz = k0; iz <= k1; iz++) grid[(iz * N + j) * N + i] = 1;
      }
    }
  }

  let inter = 0, union = 0;
  for (let i = 0; i < grid.length; i++) {
    if (spec.grid[i] & grid[i]) inter++;
    if (spec.grid[i] | grid[i]) union++;
  }
  const iou = union === 0 ? 0 : inter / union;
  const outline = clamp01((iou - IOU_ZERO) / (IOU_FULL - IOU_ZERO));

  // Pipes: Chamfer in target-local (centroid-relative) coordinates.
  let pipeScore = 1;
  if (spec.pipes.length > 0) {
    const player = (state.pipes ?? []).map(p =>
      p.points.map(q => ({ x: q.x - centroid.x, y: q.y - centroid.y, z: q.z - centroid.z })));
    pipeScore = matchPipes3D(player, spec.pipes, spec.radius);
  }
  const topologyOk = !state.topology
    || (state.topology.chains === spec.topology.chains && state.topology.loops === spec.topology.loops);
  if (!topologyOk) pipeScore *= 0.25;

  const w = spec.weights;
  const total = 100 * (w.outline * outline + w.pipes * pipeScore);
  return {
    total,
    outline: outline * 100,
    pipes: pipeScore * 100,
    iou,
    topologyOk,
    transform: { centroid },
  };
}

function chamfer3D(A, B) {
  const one = (P, Q) => {
    let sum = 0;
    for (const p of P) {
      let best = Infinity;
      for (const q of Q) {
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return sum / P.length;
  };
  return (one(A, B) + one(B, A)) / 2;
}

function matchPipes3D(playerPipes, targetPipes, radius) {
  if (playerPipes.length === 0) return 0;
  const usable = playerPipes.slice();
  let sum = 0;
  for (const t of targetPipes) {
    let bestD = Infinity, bestI = -1;
    for (let i = 0; i < usable.length; i++) {
      if (!usable[i]) continue;
      const d = chamfer3D(usable[i], t);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI === -1) continue;
    usable[bestI] = null;
    sum += clamp01(1 - bestD / (0.35 * radius));
  }
  return sum / targetPipes.length;
}

export const SIM3D_GRID = N;
