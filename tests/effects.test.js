// Effects-layer audit: physics events must carry finite world coordinates for
// the particle layer, and the Effects system itself must spawn, expire, and
// draw without touching a real canvas (method-stub ctx only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { performCut } from '../src/engine/cut2d.js';
import { Effects } from '../src/render/effects.js';
import level02 from '../src/game/levels/level02.js';

function level02Body() {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, { ...level02.body, pipes: level02.pipes ?? [] });
  body.settle(150);
  body.drainEvents();
  return body;
}

test('deflate/pipeCut events carry finite world coordinates and pipe type', () => {
  const body = level02Body();
  // The author-solution nick: enters from the left, severs the pressure loop.
  performCut(body, 200, 320, 296, 320);
  const events = body.drainEvents();

  const deflate = events.find(e => e.type === 'deflate');
  assert.ok(deflate, `expected a deflate event, got: ${events.map(e => e.type)}`);
  for (const k of ['x', 'y', 'dirX', 'dirY']) {
    assert.ok(Number.isFinite(deflate[k]), `deflate.${k} is finite`);
  }
  assert.ok(Math.abs(Math.hypot(deflate.dirX, deflate.dirY) - 1) < 1e-6, 'dir is unit length');

  const pipeCut = events.find(e => e.type === 'pipeCut');
  assert.ok(pipeCut, 'expected a pipeCut event');
  assert.equal(pipeCut.pipeType, 'pressure');
  assert.ok(Number.isFinite(pipeCut.x) && Number.isFinite(pipeCut.y));
});

test('rejected events carry the attempted knife segment (and ONLY add fields)', () => {
  const body = level02Body();
  performCut(body, 360, 320, 620, 320); // starts inside the specimen
  const events = body.drainEvents();
  assert.deepEqual(events.map(e => e.type), ['rejected'], 'no new event types on this path');
  const r = events[0];
  for (const k of ['x0', 'y0', 'x1', 'y1']) {
    assert.ok(Number.isFinite(r[k]), `rejected.${k} is finite`);
  }
});

test('snap events carry the fracture point', () => {
  const body = level02Body();
  const pipe = body.pipes[0];
  // Force a brittle-style break through the same emit path used by update():
  // sever manually and check the event coordinates midpoint a real segment.
  const seg = pipe.segCs[3];
  const mx = (body.ps.x[seg.a] + body.ps.x[seg.b]) / 2;
  body.severPipeSegment(pipe, 3);
  const pc = body.drainEvents().find(e => e.type === 'pipeCut');
  assert.ok(Number.isFinite(pc.x) && Number.isFinite(pc.y));
  assert.ok(Math.abs(pc.x - mx) < 1e-9, 'midpoint captured before surgery');
});

function stubCtx() {
  const calls = [];
  const rec = name => (...args) => calls.push([name, args]);
  return {
    calls,
    save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), arc: rec('arc'), fill: rec('fill'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'),
    fillText: rec('fillText'),
  };
}

test('Effects: spawn populates, update(1s) clears, draw never throws', () => {
  const fx = new Effects();
  assert.equal(fx.active, false);

  fx.spawnFromEvent({ type: 'deflate', x: 100, y: 50, dirX: 1, dirY: 0 });
  fx.spawnFromEvent({ type: 'snap', x: 10, y: 20 });
  fx.spawnFromEvent({ type: 'rejected', x0: 0, y0: 0, x1: 300, y1: 0 });
  fx.spawnFromEvent({ type: 'bisect' }); // unknown-to-effects event: ignored
  assert.ok(fx.sparks.length >= 14, 'jet burst (>=8) + debris (>=6) spawned');
  assert.equal(fx.emitters.length, 1, 'deflate leaves a sustained-jet emitter');
  assert.equal(fx.scratches.length, 1);
  assert.equal(fx.labels.length, 1);
  const scr = fx.scratches[0];
  assert.ok(Math.hypot(scr.x1 - scr.x0, scr.y1 - scr.y0) <= 40 + 1e-9, 'scratch clamped to 40px');

  const ctx = stubCtx();
  fx.draw(ctx); // live particles: must not throw with a method-stub ctx
  assert.ok(ctx.calls.length > 0);

  fx.update(0.1);
  assert.ok(fx.active, 'still alive after 0.1s');
  fx.update(1.0);
  assert.equal(fx.active, false, 'everything expired within 1s');
  const ctx2 = stubCtx();
  fx.draw(ctx2); // empty: early return, zero canvas calls
  assert.equal(ctx2.calls.length, 0);
});

test('Effects: particles carry finite positions while alive', () => {
  const fx = new Effects();
  fx.spawnFromEvent({ type: 'deflate', x: 0, y: 0, dirX: 0, dirY: -1 });
  for (let i = 0; i < 30; i++) {
    fx.update(1 / 60);
    for (const p of fx.sparks) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    }
  }
});

test('Effects: deflate emitter keeps feeding the jet, then dies inside its 0.5s budget', () => {
  const fx = new Effects();
  fx.spawnFromEvent({ type: 'deflate', x: 0, y: 0, dirX: 1, dirY: 0 });
  const burst = fx.sparks.length;
  assert.ok(burst >= 8 && burst <= 10, `first-frame burst 8-10, got ${burst}`);
  fx.update(0.1);
  assert.ok(fx.sparks.length > burst, 'emitter added particles after the burst');
  assert.equal(fx.emitters.length, 1, 'emitter still alive at 0.1s');
  fx.update(1.0);
  assert.equal(fx.emitters.length, 0, 'emitter expired');
  assert.equal(fx.active, false, 'nothing survives the big catch-up step');
});

test('Effects: whip after-images draw, fade and never survive 1s', () => {
  const fx = new Effects();
  fx.spawnWhip([[{ x: 0, y: 0 }, { x: 10, y: 5 }], [{ x: 20, y: 0 }, { x: 30, y: 5 }]]);
  assert.equal(fx.whips.length, 2);
  assert.ok(fx.active);
  const ctx = stubCtx();
  fx.draw(ctx);
  assert.ok(ctx.calls.length > 0, 'whips render');
  fx.update(0.1);
  assert.ok(fx.active, 'still fading at 0.1s');
  fx.update(1.0);
  assert.equal(fx.active, false, 'after-images cleared');
});
