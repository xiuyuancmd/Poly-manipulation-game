// Cutting surgery on SoftBody2D boundary rings.
//
// A cut is a straight knife segment that must START outside the body.
//  - Knife fully crosses an island  -> bisection: the ring splits into two rings,
//    each closed along the cut line with its own copies of the cut-line particles.
//  - Knife ends inside an island    -> slit: the ring detours into the body along
//    doubled "wall" particles and back, leaving an open notch.
//  - Anything the blade geometrically crosses (lattice springs, pipe segments,
//    glue welds) is severed. Severing a pressurized loop deflates it, which in
//    turn lowers the body's area target (see SoftBody2D.recomputePressure).
//
// All events are emitted through body.emit() for the game layer / tests.

import { segSegIntersect, ringSignedArea, pointInPolygon, distPointToSeg } from './geom.js';

const MIN_CRUMB_AREA = 250;   // islands smaller than this are discarded as crumbs
const OFFSET = 0.9;           // separation between the two new faces of a cut

export function performCut(body, ax, ay, bx, by) {
  const { ps } = body;
  if (body.containsPoint(ax, ay)) {
    body.emit('rejected', { reason: 'insideStart' });
    return;
  }

  const gatherHits = (x0, y0, x1, y1) => {
    const out = [];
    for (const island of body.aliveIslands()) {
      const ring = island.ring, m = ring.length;
      for (let k = 0; k < m; k++) {
        const A = ring[k], B = ring[(k + 1) % m];
        const hit = segSegIntersect(x0, y0, x1, y1, ps.x[A], ps.y[A], ps.x[B], ps.y[B]);
        if (hit) out.push({ island, edge: k, ...hit });
      }
    }
    return out;
  };

  // A knife passing exactly through a boundary VERTEX hits both adjacent edges
  // at u~0/u~1 and the ring surgery degenerates. Nudge the blade sideways by an
  // imperceptible amount until every crossing is cleanly mid-edge.
  const dlen = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / dlen, ny = (bx - ax) / dlen;
  let hits = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const off = attempt * 1.0;
    const x0 = ax + nx * off, y0 = ay + ny * off;
    const x1 = bx + nx * off, y1 = by + ny * off;
    hits = gatherHits(x0, y0, x1, y1);
    if (hits.every(h => h.u > 0.04 && h.u < 0.96)) {
      ax = x0; ay = y0; bx = x1; by = y1;
      break;
    }
  }

  // The blade severs whatever it crosses, regardless of ring surgery.
  severCrossedConstraints(body, ax, ay, bx, by);

  if (hits.length === 0) {
    body.emit('miss');
    return;
  }
  hits.sort((u, v) => u.t - v.t);
  const entry = hits[0];
  const island = entry.island;
  const sameIsland = hits.filter(h => h.island === island);

  if (sameIsland.length >= 2 && sameIsland[1].edge !== entry.edge) {
    bisect(body, island, entry, sameIsland[1]);
  } else if (sameIsland.length >= 2) {
    body.emit('graze'); // in and out through the same edge
  } else if (pointInPolygon(body.ringPoints(island), bx, by)) {
    slit(body, island, entry, bx, by);
  } else {
    body.emit('graze');
  }

  removeCrossIslandLattice(body);
  sweepDeadConstraints(body);
}

// ---- bisection ---------------------------------------------------------------

function bisect(body, island, entry, exit) {
  const { ps } = body;
  const ring = island.ring, m = ring.length;
  const dirX = exit.x - entry.x, dirY = exit.y - entry.y;
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6) { body.emit('graze'); return; }
  const nX = -dirY / len, nY = dirX / len; // left-perp of entry->exit

  // Side A contains ring[entry.edge + 1]; offset new particles into their side.
  const sideOf = (i) => {
    const cross = dirX * (ps.y[i] - entry.y) - dirY * (ps.x[i] - entry.x);
    return cross > 0 ? 1 : -1;
  };
  const aSign = sideOf(ring[(entry.edge + 1) % m]);

  const mk = (x, y, sign) => body.addParticle(x + nX * OFFSET * sign, y + nY * OFFSET * sign);
  const PA = mk(entry.x, entry.y, aSign), PB = mk(entry.x, entry.y, -aSign);
  const QA = mk(exit.x, exit.y, aSign), QB = mk(exit.x, exit.y, -aSign);

  // Interior points along the cut line, one copy per side.
  const innerCount = Math.max(1, Math.floor(len / body.edgeLen) - 1);
  const closureA = [], closureB = [];
  for (let i = 1; i <= innerCount; i++) {
    const f = i / (innerCount + 1);
    const x = entry.x + dirX * f, y = entry.y + dirY * f;
    closureA.push(mk(x, y, aSign));
    closureB.push(mk(x, y, -aSign));
  }

  const arcA = circSlice(ring, (entry.edge + 1) % m, exit.edge);          // entry+1 .. exit
  const arcB = circSlice(ring, (exit.edge + 1) % m, entry.edge);          // exit+1 .. entry
  const ringA = [PA, ...arcA, QA, ...closureA.slice().reverse()];         // close Q -> P
  const ringB = [QB, ...arcB, PB, ...closureB];                           // close P -> Q

  // Rest area is a material property: conserve it through surgery, split in
  // proportion to the current geometric areas of the two halves. (Recomputing it
  // from current geometry would silently absorb any in-flight deflation.)
  const oldBase = island.baseRestArea;
  const areaA = Math.abs(ringSignedArea(body.ps, ringA));
  const areaB = Math.abs(ringSignedArea(body.ps, ringB));
  const total = Math.max(1e-9, areaA + areaB);

  body.retireIsland(island);
  const islA = finishRing(body, ringA);
  const islB = finishRing(body, ringB);
  if (islA) islA.baseRestArea = oldBase * (areaA / total);
  if (islB) islB.baseRestArea = oldBase * (areaB / total);
  body.recomputePressure();
  body.emit('bisect');
}

// ---- slit ---------------------------------------------------------------------

function slit(body, island, entry, ex, ey) {
  const { ps } = body;
  const depth = Math.hypot(ex - entry.x, ey - entry.y);
  if (depth < body.edgeLen * 1.5) { body.emit('nick'); return; }

  const ring = island.ring, m = ring.length;
  const dirX = (ex - entry.x) / depth, dirY = (ey - entry.y) / depth;
  const nX = -dirY, nY = dirX; // left-perp of the knife direction

  // Which slit wall is adjacent to ring[edge+1]?
  const eNext = ring[(entry.edge + 1) % m], ePrev = ring[entry.edge];
  const dot = (ps.x[eNext] - ps.x[ePrev]) * nX + (ps.y[eNext] - ps.y[ePrev]) * nY;
  const aSign = dot > 0 ? 1 : -1; // PA (adjacent to ring[edge+1]) offset sign

  const mk = (x, y, sign) => body.addParticle(x + nX * OFFSET * sign, y + nY * OFFSET * sign);
  const PA = mk(entry.x, entry.y, aSign), PB = mk(entry.x, entry.y, -aSign);
  const innerCount = Math.max(1, Math.floor(depth / body.edgeLen) - 1);
  const wallA = [], wallB = [];
  for (let i = 1; i <= innerCount; i++) {
    const f = (i / (innerCount + 1)) * depth;
    const x = entry.x + dirX * f, y = entry.y + dirY * f;
    wallA.push(mk(x, y, aSign));
    wallB.push(mk(x, y, -aSign));
  }
  const tip = body.addParticle(ex, ey);

  // ... ring[edge] -> PB -> wallB(in) -> tip -> wallA(out) -> PA -> ring[edge+1] ...
  const at = (entry.edge + 1) % m;
  const before = circSlice(ring, at, entry.edge); // full ring starting at edge+1, ending at edge
  const newRing = [...before, PB, ...wallB, tip, ...wallA.slice().reverse(), PA];

  // A slit removes no material: the island keeps its rest area.
  const oldBase = island.baseRestArea;
  body.retireIsland(island);
  const isl = finishRing(body, newRing);
  if (isl) isl.baseRestArea = oldBase;
  body.recomputePressure();
  body.emit('slit');
}

// ---- shared helpers -------------------------------------------------------------

function finishRing(body, ring) {
  const { ps } = body;
  if (ring.length < 3 || Math.abs(ringSignedArea(ps, ring)) < MIN_CRUMB_AREA) {
    // Degenerate crumb: discard the exclusive particles.
    for (const i of ring) {
      if (!ringUsedElsewhere(body, i)) { ps.kill(i); body.owned.delete(i); }
    }
    body.emit('crumb');
    return null;
  }
  if (ringSignedArea(ps, ring) < 0) ring.reverse();
  return body.makeIsland(ring); // caller assigns baseRestArea, then recomputePressure
}

function ringUsedElsewhere(body, particle) {
  for (const isl of body.aliveIslands()) if (isl.ring.includes(particle)) return true;
  return false;
}

function circSlice(ring, from, to) {
  const m = ring.length;
  const out = [];
  let i = from;
  for (;;) {
    out.push(ring[i]);
    if (i === to) break;
    i = (i + 1) % m;
  }
  return out;
}

function severCrossedConstraints(body, ax, ay, bx, by) {
  const { ps, solver } = body;
  const crosses = (i, j) =>
    segSegIntersect(ax, ay, bx, by, ps.x[i], ps.y[i], ps.x[j], ps.y[j]) !== null;

  body.latticeCs = body.latticeCs.filter(e => {
    if (crosses(e.a, e.b)) { solver.remove(e.c); return false; }
    return true;
  });
  // A tight weld has near-zero length, so a pure crossing test can never hit
  // it: also cut welds whose midpoint lies within blade reach.
  body.welds = body.welds.filter(w => {
    const mx = (ps.x[w.a] + ps.x[w.b]) / 2, my = (ps.y[w.a] + ps.y[w.b]) / 2;
    if (crosses(w.a, w.b) || distPointToSeg(mx, my, ax, ay, bx, by) < 6) {
      solver.remove(w.c);
      body.emit('weldCut');
      return false;
    }
    return true;
  });
  for (const pipe of body.pipes) {
    if (!pipe.alive) continue;
    pipe.coupleCs = pipe.coupleCs.filter(e => {
      if (crosses(e.a, e.b)) { solver.remove(e.c); return false; }
      return true;
    });
  }
  // Pipe chains: sever every crossed segment. severPipeSegment mutates the pipe
  // list, so re-scan from scratch after each hit until clean.
  let again = true;
  while (again) {
    again = false;
    outer:
    for (const pipe of body.pipes) {
      if (!pipe.alive) continue;
      for (let k = 0; k < pipe.segCs.length; k++) {
        const s = pipe.segCs[k];
        if (crosses(s.a, s.b)) {
          body.severPipeSegment(pipe, k);
          again = true;
          break outer;
        }
      }
    }
  }
}

/** Lattice springs whose endpoints ended up in different islands act like
 *  invisible threads between the halves — remove them. */
function removeCrossIslandLattice(body) {
  const home = new Map();
  for (const island of body.aliveIslands()) {
    for (const i of island.ring) home.set(i, island.id);
  }
  body.latticeCs = body.latticeCs.filter(e => {
    const ha = home.get(e.a), hb = home.get(e.b);
    if (ha !== undefined && hb !== undefined && ha !== hb) {
      body.solver.remove(e.c);
      return false;
    }
    return true;
  });
}

/** Remove any constraint that references a killed particle. */
function sweepDeadConstraints(body) {
  const { ps, solver } = body;
  const dead = (e) => !ps.alive[e.a] || !ps.alive[e.b];
  body.latticeCs = body.latticeCs.filter(e => (dead(e) ? (solver.remove(e.c), false) : true));
  body.welds = body.welds.filter(e => (dead(e) ? (solver.remove(e.c), false) : true));
  for (const pipe of body.pipes) {
    if (!pipe.alive) continue;
    pipe.coupleCs = pipe.coupleCs.filter(e => (dead(e) ? (solver.remove(e.c), false) : true));
  }
}
