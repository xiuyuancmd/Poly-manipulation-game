// Continuous 2D shape-similarity readout.
//
// Outline score: player rings are centroid-aligned to the target, best rotation
// found by coarse-to-fine search, then scored as rasterized IoU on a GRID x GRID
// occupancy grid (nonzero-winding fill, so folded/self-overlapping rings count
// as their union — important after glue-folds).
//
// Pipe score: symmetric Chamfer distance between resampled pipe polylines under
// the same transform, plus a topology gate on (chain count, loop count) that
// encodes "this target requires cutting pipe X".
//
// Total = 100 * (wOutline * outlineScore + wPipes * pipeScore).

import { polygonCentroid, resamplePolyline, boundingRadius, bbox, signedArea } from './geom.js';

const GRID = 96;
const PIPE_SAMPLES = 32;

// IoU -> score remap: IoU 0.92 already counts as a perfect match, IoU <= 0.30
// counts as zero. Hand-shaping a soft blob to IoU > 0.92 is unrealistic.
const IOU_FULL = 0.92;
const IOU_ZERO = 0.30;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export class TargetSpec {
  /**
   * def: {
   *   name, outlines: [poly,...] (or outline: poly), pipes: [{points, closed}...],
   *   topology: {chains, loops}, weights: {outline, pipes},
   *   scaleInvariant?: false, mirrorAllowed?: false,
   * }
   */
  constructor(def) {
    this.name = def.name ?? '';
    this.outlines = def.outlines ?? [def.outline];
    this.pipes = (def.pipes ?? []).map(p => Array.isArray(p) ? { points: p, closed: false } : p);
    this.weights = def.weights ?? { outline: 0.6, pipes: 0.4 };
    this.scaleInvariant = !!def.scaleInvariant;
    this.mirrorAllowed = !!def.mirrorAllowed;
    this.topology = def.topology ?? { chains: this.pipes.filter(p => !p.closed).length, loops: this.pipes.filter(p => p.closed).length };

    // Reference frame: target bbox expanded 30%, mapped onto GRID x GRID.
    const all = this.outlines.flat();
    const bb = bbox(all);
    const spanX = bb.maxX - bb.minX, spanY = bb.maxY - bb.minY;
    const span = Math.max(spanX, spanY) * 1.6;
    this.frame = {
      cx: (bb.minX + bb.maxX) / 2,
      cy: (bb.minY + bb.maxY) / 2,
      scale: GRID / span,
    };
    // Area-weighted centroid over all target outline polygons.
    this.centroid = multiCentroid(this.outlines);
    this.radius = boundingRadius(all, this.centroid.x, this.centroid.y);
    this.grid = new Uint8Array(GRID * GRID);
    rasterizePolys(this.outlines.map(o => o.map(p => this.toGrid(p.x, p.y))), this.grid);
    this.gridCount = count(this.grid);
    this.pipesResampled = this.pipes.map(p => resamplePolyline(p.points, PIPE_SAMPLES, !!p.closed));
    this.pipesCheap = this.pipes.map(p => resamplePolyline(p.points, 10, !!p.closed));
  }

  toGrid(x, y) {
    return {
      x: (x - this.frame.cx) * this.frame.scale + GRID / 2,
      y: (y - this.frame.cy) * this.frame.scale + GRID / 2,
    };
  }
}

/**
 * Evaluate similarity of a player state against a target.
 * state: { rings: [poly,...], pipes: [{points, closed}...], topology: {chains, loops} }
 * Returns { total, outline, pipes, iou, transform, topologyOk }.
 */
export function evaluate(state, spec) {
  const rings = state.rings.filter(r => r.length >= 3);
  if (rings.length === 0) {
    return { total: 0, outline: 0, pipes: 0, iou: 0, transform: null, topologyOk: false };
  }
  const pc = multiCentroid(rings);

  let scale = 1;
  if (spec.scaleInvariant) {
    const pr = Math.max(1e-6, ringsRadius(rings, pc));
    scale = spec.radius / pr;
  }

  // Coarse-to-fine rotation search about the player centroid (mirrored too if
  // allowed). Candidates are ranked by the COMBINED outline+pipe score: for
  // symmetric outlines (hexagons, circles) several rotations tie on IoU and only
  // the pipe layout disambiguates them.
  const mirrors = spec.mirrorAllowed ? [1, -1] : [1];
  const playerPipesCheap = (state.pipes ?? [])
    .filter(p => p.points.length >= 2)
    .map(p => resamplePolyline(p.points, 10, !!p.closed));
  const scratch = new Uint8Array(GRID * GRID);
  let best = { combined: -1, iou: 0, angle: 0, mirror: 1 };
  const tryAngle = (angle, mirror) => {
    const iou = iouAt(rings, pc, angle, mirror, scale, spec, scratch);
    let combined = clamp01((iou - IOU_ZERO) / (IOU_FULL - IOU_ZERO)) * spec.weights.outline;
    if (spec.pipesCheap.length > 0) {
      const tf = { pc, angle, mirror, scale, spec };
      const moved = playerPipesCheap.map(p => applyTransform(p, tf));
      combined += matchPipes(moved, spec.pipesCheap, spec.radius) * spec.weights.pipes;
    }
    if (combined > best.combined) best = { combined, iou, angle, mirror };
  };
  for (const m of mirrors) {
    for (let k = 0; k < 24; k++) tryAngle((k / 24) * Math.PI * 2, m);
  }
  let step = (Math.PI * 2) / 24 / 2;
  for (let r = 0; r < 3; r++) {
    const center = best.angle, m = best.mirror;
    tryAngle(center - step, m);
    tryAngle(center + step, m);
    step /= 2;
  }

  const transform = { pc, angle: best.angle, mirror: best.mirror, scale, spec };
  const outline = clamp01((best.iou - IOU_ZERO) / (IOU_FULL - IOU_ZERO));

  // Pipes under the same transform.
  const playerPipes = (state.pipes ?? [])
    .filter(p => p.points.length >= 2)
    .map(p => resamplePolyline(applyTransform(p.points, transform), PIPE_SAMPLES, !!p.closed));
  let pipeScore;
  if (spec.pipesResampled.length === 0) {
    pipeScore = 1;
  } else {
    pipeScore = matchPipes(playerPipes, spec.pipesResampled, spec.radius);
  }
  const topologyOk = !state.topology
    || (state.topology.chains === spec.topology.chains && state.topology.loops === spec.topology.loops);
  if (!topologyOk) pipeScore *= 0.25;

  const w = spec.weights;
  const total = 100 * (w.outline * outline + w.pipes * pipeScore);
  return { total, outline: outline * 100, pipes: pipeScore * 100, iou: best.iou, transform, topologyOk };
}

/** Map world points into the target grid frame using a found transform. */
export function applyTransform(points, tf) {
  const { pc, angle, mirror, scale, spec } = tf;
  const c = Math.cos(angle), s = Math.sin(angle);
  return points.map(p => {
    let dx = (p.x - pc.x) * scale, dy = (p.y - pc.y) * scale;
    dx *= tfMirror(mirror);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return { x: spec.centroid.x + rx, y: spec.centroid.y + ry };
  });
}

/** Inverse transform: target-space points -> world space (for the ghost overlay). */
export function inverseTransform(points, tf) {
  const { pc, angle, mirror, scale, spec } = tf;
  const c = Math.cos(-angle), s = Math.sin(-angle);
  return points.map(p => {
    const dx = p.x - spec.centroid.x, dy = p.y - spec.centroid.y;
    let rx = dx * c - dy * s, ry = dx * s + dy * c;
    rx *= tfMirror(mirror);
    return { x: pc.x + rx / scale, y: pc.y + ry / scale };
  });
}

const tfMirror = m => (m === -1 ? -1 : 1);

function iouAt(rings, pc, angle, mirror, scale, spec, scratch) {
  const c = Math.cos(angle), s = Math.sin(angle);
  scratch.fill(0);
  const polys = rings.map(ring => ring.map(p => {
    let dx = (p.x - pc.x) * scale, dy = (p.y - pc.y) * scale;
    dx *= tfMirror(mirror);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return spec.toGrid(spec.centroid.x + rx, spec.centroid.y + ry);
  }));
  rasterizePolys(polys, scratch);
  let inter = 0, union = 0;
  const tg = spec.grid;
  for (let i = 0; i < tg.length; i++) {
    const a = tg[i], b = scratch[i];
    if (a & b) inter++;
    if (a | b) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/**
 * Nonzero-winding scanline fill of multiple polygons into a GRID x GRID Uint8Array.
 * Winding accumulates across polygons of the same shape, so disjoint islands OR
 * together and folded (self-overlapping) rings fill as their union.
 */
export function rasterizePolys(polys, grid) {
  for (let row = 0; row < GRID; row++) {
    const yMid = row + 0.5;
    // Collect crossings with winding direction.
    const xs = [];
    for (const poly of polys) {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if ((a.y <= yMid && b.y > yMid) || (b.y <= yMid && a.y > yMid)) {
          const t = (yMid - a.y) / (b.y - a.y);
          xs.push({ x: a.x + (b.x - a.x) * t, w: b.y > a.y ? 1 : -1 });
        }
      }
    }
    if (xs.length === 0) continue;
    xs.sort((u, v) => u.x - v.x);
    let winding = 0;
    let spanStart = 0;
    for (let k = 0; k < xs.length; k++) {
      const prev = winding;
      winding += xs[k].w;
      if (prev === 0 && winding !== 0) {
        spanStart = xs[k].x;
      } else if (prev !== 0 && winding === 0) {
        const c0 = Math.max(0, Math.ceil(spanStart - 0.5));
        const c1 = Math.min(GRID - 1, Math.floor(xs[k].x - 0.5));
        for (let col = c0; col <= c1; col++) grid[row * GRID + col] = 1;
      }
    }
  }
  return grid;
}

function count(grid) {
  let c = 0;
  for (let i = 0; i < grid.length; i++) c += grid[i];
  return c;
}

/** Symmetric Chamfer distance between two point lists. */
function chamfer(A, B) {
  const one = (P, Q) => {
    let sum = 0;
    for (const p of P) {
      let best = Infinity;
      for (const q of Q) {
        const d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return sum / P.length;
  };
  return (one(A, B) + one(B, A)) / 2;
}

/**
 * Match player pipe chains to target pipes (greedy on Chamfer distance) and
 * convert mean distance to a score normalized by the target radius.
 */
function matchPipes(playerPipes, targetPipes, radius) {
  if (playerPipes.length === 0) return 0;
  const usable = playerPipes.slice();
  let sum = 0;
  for (const t of targetPipes) {
    let bestD = Infinity, bestI = -1;
    for (let i = 0; i < usable.length; i++) {
      if (!usable[i]) continue;
      const d = chamfer(usable[i], t);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI === -1) { sum += 0; continue; }
    usable[bestI] = null;
    sum += clamp01(1 - bestD / (0.30 * radius));
  }
  return sum / targetPipes.length;
}

function multiCentroid(polys) {
  let ax = 0, ay = 0, aw = 0;
  for (const poly of polys) {
    const c = polygonCentroid(poly);
    const w = Math.abs(signedArea(poly)) || 1;
    ax += c.x * w; ay += c.y * w; aw += w;
  }
  return { x: ax / aw, y: ay / aw };
}

function ringsRadius(rings, c) {
  let r = 0;
  for (const ring of rings) r = Math.max(r, boundingRadius(ring, c.x, c.y));
  return r;
}

export const SIM_GRID = GRID;
