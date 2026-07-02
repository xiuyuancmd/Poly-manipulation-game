import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { performCut } from '../src/engine/cut2d.js';
import { selectStretch, weldStretches } from '../src/engine/glue2d.js';
import { ringSignedArea } from '../src/engine/geom.js';
import { roundedRect, circle, line } from '../src/game/levels/shapes.js';

function makeBody(def) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, def);
  body.settle(60);
  body.drainEvents();
  return { ps, solver, body };
}

const totalArea = (ps, body) =>
  body.aliveIslands().reduce((s, i) => s + Math.abs(ringSignedArea(ps, i.ring)), 0);

test('full vertical cut bisects a slab into two live islands, conserving area', () => {
  const { ps, body } = makeBody({ outline: roundedRect(0, 0, 260, 140, 24), pipes: [] });
  const before = totalArea(ps, body);
  performCut(body, 0, -200, 0, 200);
  const events = body.drainEvents().map(e => e.type);
  assert.ok(events.includes('bisect'), `events: ${events}`);
  assert.equal(body.aliveIslands().length, 2);
  for (const island of body.aliveIslands()) {
    assert.ok(island.ring.length >= 3);
    assert.ok(ringSignedArea(ps, island.ring) > 0, 'rings stay CCW');
  }
  body.settle(120);
  const after = totalArea(ps, body);
  assert.ok(Math.abs(after - before) / before < 0.12, `area ${before} -> ${after}`);
  // The halves must be structurally independent: no lattice spring bridges them.
  const home = new Map();
  for (const isl of body.aliveIslands()) for (const i of isl.ring) home.set(i, isl.id);
  for (const e of body.latticeCs) {
    assert.equal(home.get(e.a), home.get(e.b), 'no cross-island lattice spring');
  }
});

test('partial cut opens a slit: one island, longer ring, severed lattice', () => {
  const { ps, body } = makeBody({ outline: roundedRect(0, 0, 260, 140, 24), pipes: [] });
  const ringBefore = body.islands[0].ring.length;
  const latticeBefore = body.latticeCs.length;
  performCut(body, -200, 0, -20, 0); // enter from the left, stop before centre
  const events = body.drainEvents().map(e => e.type);
  assert.ok(events.includes('slit'), `events: ${events}`);
  assert.equal(body.aliveIslands().length, 1);
  assert.ok(body.islands[0].ring.length > ringBefore, 'slit adds wall particles');
  assert.ok(body.latticeCs.length < latticeBefore, 'crossed lattice springs severed');
  body.settle(120);
  for (const i of body.owned) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]));
  }
});

test('cut reaching a pressure loop deflates the body', () => {
  const { ps, body } = makeBody({
    outline: circle(0, 0, 95),
    basePressure: 0.85,
    pipes: [{ path: circle(0, 0, 55, 24), type: 'pressure', closed: true }],
  });
  const inflated = totalArea(ps, body);
  // Knife from outside, through the boundary, across the loop, ending at centre.
  performCut(body, -160, 0, 0, 0);
  const events = body.drainEvents().map(e => e.type);
  assert.ok(events.includes('deflate'), `events: ${events}`);
  assert.deepEqual(body.pipeTopology(), { chains: 1, loops: 0 });
  body.settle(300);
  const after = totalArea(ps, body);
  assert.ok(after < inflated * 0.8, `deflated ${after} << inflated ${inflated}`);
});

test('knife fully crossing a ring pipe splits it into two chains', () => {
  const { body } = makeBody({
    outline: circle(0, 0, 95),
    basePressure: 0.85,
    pipes: [{ path: circle(0, 0, 55, 24), type: 'pressure', closed: true }],
  });
  performCut(body, 0, -200, 0, 200); // bisect body AND the loop twice
  const events = body.drainEvents().map(e => e.type);
  assert.ok(events.includes('bisect'));
  assert.ok(events.includes('deflate'));
  assert.equal(body.pipeTopology().loops, 0);
  assert.equal(body.pipeTopology().chains, 2);
  assert.equal(body.aliveIslands().length, 2);
});

test('cut entirely outside the body is a miss', () => {
  const { body } = makeBody({ outline: circle(0, 0, 90), pipes: [] });
  performCut(body, 200, 200, 400, 400);
  const events = body.drainEvents().map(e => e.type);
  assert.deepEqual(events, ['miss']);
  assert.equal(body.aliveIslands().length, 1);
});

test('cut starting inside the body is rejected', () => {
  const { body } = makeBody({ outline: circle(0, 0, 90), pipes: [] });
  performCut(body, 0, 0, 300, 0);
  const events = body.drainEvents().map(e => e.type);
  assert.deepEqual(events, ['rejected']);
});

test('welds can be glued and then cut again', () => {
  const { ps, body } = makeBody({ outline: circle(0, 0, 100), pipes: [] });
  const selA = selectStretch(body, 0, -100, 30);
  const selB = selectStretch(body, 0, 100, 30);
  assert.ok(selA && selB);
  const res = weldStretches(body, selA, selB);
  assert.equal(res.ok, true);
  assert.ok(body.welds.length >= 5);
  body.settle(240);
  // The welded points must have come together.
  const w = body.welds[0];
  assert.ok(Math.hypot(ps.x[w.a] - ps.x[w.b], ps.y[w.a] - ps.y[w.b]) < 8);
  // Now slice through the weld seam from outside, aiming at where the welds
  // actually settled (the welded body may drift while folding shut).
  const mid = body.welds[Math.floor(body.welds.length / 2)];
  const mx = (ps.x[mid.a] + ps.x[mid.b]) / 2, my = (ps.y[mid.a] + ps.y[mid.b]) / 2;
  performCut(body, mx - 260, my, mx + 12, my);
  const events = body.drainEvents().map(e => e.type);
  assert.ok(events.includes('weldCut'), `events: ${events}`);
  assert.ok(body.welds.length < 5);
});

test('degenerate self-glue is rejected', () => {
  const { body } = makeBody({ outline: circle(0, 0, 100), pipes: [] });
  const selA = selectStretch(body, 0, -100, 30);
  const selB = selectStretch(body, 20, -98, 30);
  const res = weldStretches(body, selA, selB);
  assert.equal(res.ok, false);
});
