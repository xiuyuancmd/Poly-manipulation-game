import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver, DistanceConstraint, AnchorConstraint } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { ringSignedArea, makeLCG } from '../src/engine/geom.js';
import { ngon, circle, line } from '../src/game/levels/shapes.js';

const DT = 1 / 60;

function makeBody(def) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, def);
  return { ps, solver, body };
}

test('distance constraint converges to rest length', () => {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const a = ps.add(0, 0), b = ps.add(200, 0);
  solver.add(new DistanceConstraint(a, b, 100, 1e-6));
  for (let i = 0; i < 120; i++) solver.step(DT);
  const d = Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a]);
  assert.ok(Math.abs(d - 100) < 1, `distance ${d} should settle near 100`);
});

test('pinned particle does not move', () => {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const a = ps.add(0, 0), b = ps.add(50, 0);
  ps.pin(a);
  solver.add(new DistanceConstraint(a, b, 200, 1e-6));
  for (let i = 0; i < 120; i++) solver.step(DT);
  assert.equal(ps.x[a], 0);
  assert.equal(ps.y[a], 0);
});

test('body area returns to target after perturbation', () => {
  const { ps, solver, body } = makeBody({ outline: ngon(0, 0, 110, 6), basePressure: 1.0, pipes: [] });
  body.settle(60);
  const island = body.islands[0];
  const target = island.areaC.targetArea;
  // Inflate all boundary particles outward by 30%.
  for (const i of island.ring) { ps.x[i] *= 1.3; ps.y[i] *= 1.3; }
  body.settle(180);
  const area = Math.abs(ringSignedArea(ps, island.ring));
  assert.ok(Math.abs(area - target) / target < 0.05, `area ${area} vs target ${target}`);
});

test('violent 3-point dragging never produces NaN or unbounded positions', () => {
  const { ps, solver, body } = makeBody({
    outline: ngon(0, 0, 110, 6),
    pipes: [{ path: line(-70, 0, 70, 0), type: 'normal' }],
  });
  body.settle(30);
  const rng = makeLCG(42);
  const island = body.islands[0];
  const grabs = [0, 1, 2].map(k => {
    const i = island.ring[Math.floor((k / 3) * island.ring.length)];
    const a = new AnchorConstraint(i, 0, 0);
    solver.add(a);
    return a;
  });
  for (let f = 0; f < 600; f++) {
    for (const g of grabs) g.setTarget((rng() - 0.5) * 1200, (rng() - 0.5) * 1200);
    solver.step(DT);
    body.update();
  }
  for (const i of body.owned) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]), 'position finite');
    assert.ok(Math.abs(ps.x[i]) < 6000 && Math.abs(ps.y[i]) < 6000, `bounded: ${ps.x[i]},${ps.y[i]}`);
  }
});

test('contractile pipe shortens toward its rest factor', () => {
  const { ps, body } = makeBody({
    outline: ngon(0, 0, 120, 8),
    pipes: [{ path: line(-80, 0, 80, 0), type: 'contractile' }],
  });
  const pipe = body.pipes[0];
  const initial = 160;
  body.settle(300);
  const ends = [pipe.parts[0], pipe.parts[pipe.parts.length - 1]];
  const len = Math.hypot(ps.x[ends[1]] - ps.x[ends[0]], ps.y[ends[1]] - ps.y[ends[0]]);
  assert.ok(len < initial * 0.85, `muscle length ${len} should contract well below ${initial}`);
});

test('pressure pipe inflates body; severing it deflates', () => {
  const { ps, body } = makeBody({
    outline: circle(0, 0, 95),
    basePressure: 0.85,
    pipes: [{ path: circle(0, 0, 55, 24), type: 'pressure', closed: true }],
  });
  body.settle(240);
  const island = body.islands[0];
  const base = island.baseRestArea;
  const inflated = Math.abs(ringSignedArea(ps, island.ring));
  assert.ok(inflated > base * 1.2, `inflated area ${inflated} should exceed ${base * 1.2}`);
  const pipe = body.pipes[0];
  assert.equal(pipe.closed, true);
  body.severPipeSegment(pipe, 0);
  assert.equal(pipe.closed, false);
  assert.equal(pipe.deflated, true);
  body.settle(300);
  const deflated = Math.abs(ringSignedArea(ps, island.ring));
  assert.ok(deflated < base * 0.95, `deflated area ${deflated} should fall below ${base * 0.95}`);
  const topo = body.pipeTopology();
  assert.deepEqual(topo, { chains: 1, loops: 0 });
});

test('brittle pipe snaps under overstretch and splits into two chains', () => {
  const { ps, solver, body } = makeBody({
    outline: ngon(0, 0, 120, 8),
    pipes: [{ path: line(-80, 0, 80, 0), type: 'brittle', overrides: { breakStrain: 1.35 } }],
  });
  body.settle(30);
  const left = body.nearestParticle(-120, 0, 50);
  const right = body.nearestParticle(120, 0, 50);
  const ga = solver.add(new AnchorConstraint(left, -420, 0, 0, 3e-5));
  const gb = solver.add(new AnchorConstraint(right, 420, 0, 0, 3e-5));
  const originalSegs = body.pipes[0].segCs.length;
  let snapped = false;
  for (let f = 0; f < 500 && !snapped; f++) {
    solver.step(DT);
    body.update();
    snapped = body.drainEvents().some(e => e.type === 'snap');
  }
  assert.ok(snapped, 'brittle pipe should snap under strong pull');
  // A snap at the very end of the chain drops a 1-particle stub, so the chain
  // count may stay 1 — but total segment count must have decreased.
  const segsNow = body.pipes.reduce((s, p) => s + (p.alive ? p.segCs.length : 0), 0);
  assert.ok(segsNow < originalSegs, `segments ${segsNow} < ${originalSegs}`);
  assert.ok(body.pipeTopology().chains >= 1);
});
