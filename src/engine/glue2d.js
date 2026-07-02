// Gluing (welding) two stretches of soft-body boundary together.
//
// The player picks a boundary stretch (centre particle + `SPAN` neighbours on
// each side), drags it near another stretch and releases. Particles are paired
// in whichever orientation is geometrically closer and joined by stiff
// zero-rest welds. Welds are recorded on body.welds so the knife can cut them.

import { DistanceConstraint } from './xpbd.js';

const SPAN = 2;                    // stretch = 2*SPAN+1 particles
const WELD_COMPLIANCE = 5e-6;
const MIN_RING_SEPARATION = 6;     // reject degenerate self-glue

/** Pick the boundary stretch nearest (x,y), or null. */
export function selectStretch(body, x, y, maxDist = 24) {
  const near = body.nearestBoundary(x, y, maxDist);
  if (!near) return null;
  const ring = near.island.ring, m = ring.length;
  if (m < SPAN * 4 + 2) return null; // ring too small to glue safely
  const idxs = [];
  for (let k = -SPAN; k <= SPAN; k++) idxs.push((near.ringIdx + k + m) % m);
  return {
    island: near.island,
    center: near.ringIdx,
    ringIdxs: idxs,
    particles: idxs.map(i => ring[i]),
  };
}

/**
 * Weld two selected stretches. Returns {ok, reason?}.
 * Welding different islands (re-attaching a cut piece) is allowed.
 */
export function weldStretches(body, selA, selB) {
  if (!selA || !selB) return { ok: false, reason: 'no-selection' };
  if (selA.island === selB.island) {
    const m = selA.island.ring.length;
    const d = Math.abs(selA.center - selB.center);
    const ringDist = Math.min(d, m - d);
    if (ringDist < MIN_RING_SEPARATION) return { ok: false, reason: 'too-close' };
    // Overlapping stretches would weld a particle to itself.
    if (selA.particles.some(p => selB.particles.includes(p))) return { ok: false, reason: 'overlap' };
  }
  const { ps, solver } = body;
  const A = selA.particles;
  const forward = selB.particles;
  const reverse = selB.particles.slice().reverse();
  const total = (B) => {
    let s = 0;
    for (let k = 0; k < A.length; k++) s += Math.hypot(ps.x[B[k]] - ps.x[A[k]], ps.y[B[k]] - ps.y[A[k]]);
    return s;
  };
  const B = total(forward) <= total(reverse) ? forward : reverse;
  for (let k = 0; k < A.length; k++) {
    const c = solver.add(new DistanceConstraint(A[k], B[k], 0, WELD_COMPLIANCE));
    body.welds.push({ a: A[k], b: B[k], c });
  }
  body.emit('weld');
  return { ok: true };
}
