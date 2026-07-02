// Author-solve reachability tests: an "ideal player" with the game's real
// 3-control budget (anchors pulling matched particles toward target positions,
// plus scripted knife cuts) must be able to raise the similarity readout above
// the cutoff. This proves the shapes are physically reachable, not just
// area-consistent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver, AnchorConstraint } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { performCut } from '../src/engine/cut2d.js';
import { TargetSpec, evaluate, inverseTransform } from '../src/engine/similarity2d.js';
import { resamplePolyline } from '../src/engine/geom.js';
import level01 from '../src/game/levels/level01.js';
import level02 from '../src/game/levels/level02.js';
import level03 from '../src/game/levels/level03.js';

const DT = 1 / 60;

function authorSolve(level, targetIdx, { cuts = [], frames = 1200, controls = 3, axial = false } = {}) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, { ...level.body, pipes: level.pipes ?? [] });
  body.settle(150);
  for (const c of cuts) {
    performCut(body, c[0], c[1], c[2], c[3]);
    body.settle(60);
  }

  const target = level.targets[targetIdx];
  const spec = new TargetSpec(target);
  const island = body.aliveIslands().sort((a, b) => b.ring.length - a.ring.length)[0];
  const ring = island.ring;
  const tgt0 = resamplePolyline(target.outlines[0], ring.length, true);

  const playerState = () => ({
    rings: body.aliveIslands().map(isl => body.ringPoints(isl)),
    pipes: body.pipeChains(),
    topology: body.pipeTopology(),
  });

  // The human player sees the GHOST — the target projected onto the body's
  // current pose by the similarity transform. Re-project and re-match the
  // ring/target correspondence on every grip, exactly like a player would.
  let corrPts = tgt0;
  const realign = (sim) => {
    const world = sim?.transform ? inverseTransform(tgt0, sim.transform) : tgt0;
    let best = { cost: Infinity, k: 0, dir: 1 };
    for (const dir of [1, -1]) {
      for (let k = 0; k < ring.length; k++) {
        let cost = 0;
        for (let i = 0; i < ring.length; i += 4) {
          const t = world[(((i * dir + k) % ring.length) + ring.length) % ring.length];
          cost += Math.hypot(ps.x[ring[i]] - t.x, ps.y[ring[i]] - t.y);
        }
        if (cost < best.cost) best = { cost, k, dir };
      }
    }
    corrPts = ring.map((_, i) =>
      world[(((i * best.dir + best.k) % ring.length) + ring.length) % ring.length]);
  };
  realign(null);

  // Grab the worst-matched points, drag them smoothly a bit PAST where they
  // belong (players overshoot against elastic pull-back), hold, re-grip.
  const GRIP_FRAMES = 240;
  const DRAG_FRAMES = 100;
  let anchors = [];
  const regrip = (sim) => {
    realign(sim);
    for (const g of anchors) for (const a of g.group) solver.remove(a.c);
    anchors = [];
    const taken = new Set();
    const picks = [];
    if (axial) {
      // Human "stretch it long" strategy: two grips at the target's farthest
      // point pair (its long axis), the rest chase worst deviations.
      let bi = 0, bj = 0, bd = -1;
      for (let i = 0; i < ring.length; i += 2) {
        for (let j = i + 2; j < ring.length; j += 2) {
          const d = Math.hypot(corrPts[i].x - corrPts[j].x, corrPts[i].y - corrPts[j].y);
          if (d > bd) { bd = d; bi = i; bj = j; }
        }
      }
      picks.push(bi, bj);
    }
    for (let c = 0; c < controls; c++) {
      let worst = picks[c] ?? -1;
      if (worst < 0) {
        let worstD = -1;
        for (let i = 0; i < ring.length; i++) {
          if ([...taken].some(t => Math.min(Math.abs(t - i), ring.length - Math.abs(t - i)) < 6)) continue;
          const d = Math.hypot(ps.x[ring[i]] - corrPts[i].x, ps.y[ring[i]] - corrPts[i].y);
          if (d > worstD) { worstD = d; worst = i; }
        }
      }
      if (worst < 0) break;
      taken.add(worst);
      const from = { x: ps.x[ring[worst]], y: ps.y[ring[worst]] };
      // Soft-hand grip like the real game: the point and its ring neighbours
      // move as one handle.
      const group = [];
      for (let off = -2; off <= 2; off++) {
        const idx = ((worst + off) % ring.length + ring.length) % ring.length;
        const q = ring[idx];
        group.push({
          c: solver.add(new AnchorConstraint(q, ps.x[q], ps.y[q], 0, 4e-5)),
          ox: ps.x[q] - from.x,
          oy: ps.y[q] - from.y,
        });
      }
      anchors.push({ group, i: worst, from, t: 0 });
    }
  };

  let bestScore = 0;
  let lastSim = null;
  for (let f = 0; f < frames; f++) {
    if (f % GRIP_FRAMES === 0) regrip(lastSim);
    for (const g of anchors) {
      g.t++;
      const ease = Math.min(1, g.t / DRAG_FRAMES);
      const to = corrPts[g.i];
      // 35% overshoot beyond the ghost point, relative to the grip origin.
      const hx = to.x + (to.x - g.from.x) * 0.35;
      const hy = to.y + (to.y - g.from.y) * 0.35;
      const cx = g.from.x + (hx - g.from.x) * ease;
      const cy = g.from.y + (hy - g.from.y) * ease;
      for (const a of g.group) a.c.setTarget(cx + a.ox, cy + a.oy);
    }
    solver.step(DT);
    body.update();
    if (f % 20 === 19) {
      lastSim = evaluate(playerState(), spec);
      bestScore = Math.max(bestScore, lastSim.total);
    }
  }
  return bestScore;
}

test('L1 目标一「橄榄」 is reachable with 3 controls', () => {
  const score = authorSolve(level01, 0);
  const cutoff = level01.targets[0].cutoff ?? level01.cutoff;
  assert.ok(score >= cutoff, `author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('L1 目标二「弯月」 is reachable with 3 controls', () => {
  const score = authorSolve(level01, 1, { frames: 1800 });
  const cutoff = level01.targets[1].cutoff ?? level01.cutoff;
  assert.ok(score >= cutoff, `author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('L2 目标一「饱满的蛋」 is reachable while inflated', () => {
  const score = authorSolve(level02, 0);
  const cutoff = level02.targets[0].cutoff ?? level02.cutoff;
  assert.ok(score >= cutoff, `author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('L2 目标二「软枕头」 is reachable after cutting the pressure loop, but not for free', () => {
  const cutoff = level02.targets[1].cutoff ?? level02.cutoff;
  // Cutting alone (no shaping work) must NOT complete the target...
  const lazy = authorSolve(level02, 1, { cuts: [[200, 320, 296, 320]], frames: 60, controls: 0 });
  assert.ok(lazy < cutoff - 4, `post-cut no-work score ${lazy.toFixed(1)} must stay below ${cutoff - 4}`);
  // ...but honest shaping gets there.
  const score = authorSolve(level02, 1, {
    // Shallow radial nick: just deep enough to sever the pressure loop.
    cuts: [[200, 320, 296, 320]],
    frames: 2400,
  });
  assert.ok(score >= cutoff, `author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('L3 目标一「平板」 is reachable against the tendons', () => {
  const score = authorSolve(level03, 0, { frames: 1800 });
  const cutoff = level03.targets[0].cutoff ?? level03.cutoff;
  assert.ok(score >= cutoff, `author solve ${score.toFixed(1)} >= ${cutoff}`);
});
