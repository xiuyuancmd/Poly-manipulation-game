// Level-data validation: every target must be PHYSICALLY REACHABLE under the
// gel model (area conservation x pressure factor) and must SCORE above its
// cutoff when matched perfectly. Catches authoring mistakes mechanically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levels } from '../src/game/levels/index.js';
import { TargetSpec, evaluate } from '../src/engine/similarity2d.js';
import { signedArea, pointInPolygon } from '../src/engine/geom.js';
import { ParticleSystem, Solver } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { Session2D } from '../src/game/session2d.js';

const area = poly => Math.abs(signedArea(poly));

/** Distance from a point to a polygon boundary (min over edges). */
function distToPoly(poly, x, y) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

function settledBody(level) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, { ...level.body, pipes: level.pipes ?? [] });
  body.settle(150);
  return body;
}

for (const level of levels.filter(l => l.dim !== 3)) {
  test(`${level.id} ${level.name}: body/pipe geometry is sane`, () => {
    const bodyArea = area(level.body.outline);
    assert.ok(bodyArea > 5000, 'body has meaningful area');
    assert.ok(level.timeLimit >= 60 && level.timeLimit <= 600);
    for (const pipe of level.pipes) {
      for (const p of pipe.path) {
        assert.ok(pointInPolygon(level.body.outline, p.x, p.y),
          `pipe point (${p.x},${p.y}) must start inside the body`);
      }
    }
  });

  test(`${level.id}: every target area is reachable under the pressure model`, () => {
    const bodyArea = area(level.body.outline);
    for (const t of level.targets) {
      const targetArea = t.outlines.reduce((s, o) => s + area(o), 0);
      const expect = bodyArea * (t._expectFactor ?? 1.0);
      const tol = t._foldTarget ? 0.22 : 0.12;
      const err = Math.abs(targetArea - expect) / expect;
      assert.ok(err < tol,
        `${t.name}: target area ${Math.round(targetArea)} vs expected ${Math.round(expect)} (err ${(err * 100).toFixed(1)}%)`);
    }
  });

  test(`${level.id}: body builds, settles stably, and rest state needs real work`, () => {
    const body = settledBody(level);
    for (const i of body.owned) {
      assert.ok(Number.isFinite(body.ps.x[i]) && Number.isFinite(body.ps.y[i]), 'settle stays finite');
    }
    const state = {
      rings: body.aliveIslands().map(i => body.ringPoints(i)),
      pipes: body.pipeChains(),
      topology: body.pipeTopology(),
    };
    for (const t of level.targets) {
      if (t._restBelow == null) continue;
      const sim = evaluate(state, new TargetSpec(t));
      assert.ok(sim.total < t._restBelow,
        `${t.name}: rest-state score ${sim.total.toFixed(1)} must stay below ${t._restBelow} (design requires effort)`);
    }
  });

  test(`${level.id}: settled pressure loops stay inside the body (<=3px tolerance)`, () => {
    // ENGINE-layer rest-state containment audit: after settling, every
    // particle of a live PRESSURE loop must sit inside an alive island — an
    // inflated ring must never poke through the specimen's edge (it reads as
    // a rendering bug). Kept scoped to pressure pipes: the raw engine has no
    // cable-guide grooves; full-material containment is the SESSION-layer
    // audit below.
    const body = settledBody(level);
    const islands = body.aliveIslands().map(i => body.ringPoints(i));
    for (const pipe of body.pipes) {
      if (!pipe.alive || pipe.type !== 'pressure') continue;
      for (const p of pipe.parts) {
        const x = body.ps.x[p], y = body.ps.y[p];
        if (islands.some(poly => pointInPolygon(poly, x, y))) continue;
        const d = Math.min(...islands.map(poly => distToPoly(poly, x, y)));
        assert.ok(d <= 3,
          `pressure loop particle (${x.toFixed(1)},${y.toFixed(1)}) sticks out ${d.toFixed(1)}px`);
      }
    }
  });

  test(`${level.id}: session-layer rest state contains ALL pipe materials (<=1px)`, () => {
    // SESSION-layer containment audit: the game session adds cable-guide
    // grooves (containPipes) on top of the raw engine, so after 1.5 s of
    // undisturbed play EVERY live pipe particle of EVERY material must sit
    // inside an alive island (1 px boundary tolerance).
    const session = new Session2D(level);
    for (let f = 0; f < 90; f++) session.step(1 / 60);
    const { ps, body } = session;
    const islands = body.aliveIslands().map(i => body.ringPoints(i));
    for (const pipe of body.pipes) {
      if (!pipe.alive) continue;
      for (const p of pipe.parts) {
        if (!ps.alive[p]) continue;
        const x = ps.x[p], y = ps.y[p];
        if (islands.some(poly => pointInPolygon(poly, x, y))) continue;
        const d = Math.min(...islands.map(poly => distToPoly(poly, x, y)));
        assert.ok(d <= 1,
          `${pipe.type} particle (${x.toFixed(1)},${y.toFixed(1)}) sticks out ${d.toFixed(1)}px at rest`);
      }
    }
  });

  test(`${level.id}: a perfect match beats the cutoff with margin`, () => {
    for (const t of level.targets) {
      const spec = new TargetSpec(t);
      const state = {
        rings: t.outlines,
        pipes: t.pipes.map(p => ({ points: p.points, closed: !!p.closed })),
        topology: spec.topology,
      };
      const sim = evaluate(state, spec);
      const cutoff = t.cutoff ?? level.cutoff;
      assert.ok(sim.total >= cutoff + 5,
        `${t.name}: perfect-shape score ${sim.total.toFixed(1)} must exceed cutoff ${cutoff} + 5`);
    }
  });
}
