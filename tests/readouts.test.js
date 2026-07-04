// renderState() readout audit: the renderer-facing mechanical readouts must be
// finite, physically plausible, aligned with the constraint arrays, and must
// reflect deflation after pipe surgery. Uses level 2 (pressure loop) as the
// reference body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import level02 from '../src/game/levels/level02.js';

function settledBody() {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, { ...level02.body, pipes: level02.pipes ?? [] });
  body.settle(150);
  return body;
}

test('renderState: islands expose finite, plausible per-edge strains aligned with the ring', () => {
  const body = settledBody();
  const rs = body.renderState();
  assert.equal(rs.islands.length, body.aliveIslands().length);
  for (const island of rs.islands) {
    assert.ok(island.points.length >= 3, 'island has a real ring');
    assert.equal(island.edgeStrains.length, island.points.length,
      'one strain per ring edge (closed ring: edges == points)');
    for (const s of island.edgeStrains) {
      assert.ok(Number.isFinite(s), 'strain is finite');
      assert.ok(s > 0.5 && s < 2.0, `edge strain ${s.toFixed(3)} in (0.5, 2.0)`);
    }
  }
});

test('renderState: pipe segments expose finite strains; pressure loop reports fill', () => {
  const body = settledBody();
  const rs = body.renderState();
  assert.equal(rs.pipes.length, 1);
  const loop = rs.pipes[0];
  assert.equal(loop.closed, true);
  assert.equal(loop.deflated, false);
  assert.equal(loop.points.length, body.pipes[0].parts.length);
  assert.equal(loop.segStrains.length, body.pipes[0].segCs.length);
  for (const s of loop.segStrains) {
    assert.ok(Number.isFinite(s), 'segment strain is finite');
    assert.ok(s > 0.5 && s < 2.0, `segment strain ${s.toFixed(3)} in (0.5, 2.0)`);
  }
  assert.ok(loop.fill !== null, 'live pressure loop reports a fill fraction');
  assert.ok(loop.fill > 0.5 && loop.fill < 1.2, `fill ${loop.fill.toFixed(3)} in (0.5, 1.2)`);
});

test('renderState: severing the pressure loop flips deflated and clears fill', () => {
  const body = settledBody();
  body.severPipeSegment(body.pipes[0], 0);
  body.settle(60);
  const rs = body.renderState();
  assert.equal(rs.pipes.length, 1, 'severed loop stays one open chain');
  const chain = rs.pipes[0];
  assert.equal(chain.closed, false);
  assert.equal(chain.deflated, true);
  assert.equal(chain.fill, null, 'no area constraint -> no fill readout');
  assert.equal(chain.segStrains.length, chain.points.length - 1,
    'open chain: one strain per segment');
  for (const s of chain.segStrains) assert.ok(Number.isFinite(s));
});

test('renderState is a pure query: does not add constraints or emit events', () => {
  const body = settledBody();
  body.drainEvents();
  const nBefore = body.solver.constraints.size;
  body.renderState();
  body.renderState();
  assert.equal(body.solver.constraints.size, nBefore, 'constraint count unchanged');
  assert.equal(body.drainEvents().length, 0, 'no events emitted');
});
