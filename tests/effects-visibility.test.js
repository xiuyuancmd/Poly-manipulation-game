// Visibility audit for the fracture-moment effects: shards and snip sparks
// must read as BRIGHT strokes against the dark bench, and the cable recoil
// after-image must open at a clearly visible stroke width. Uses a method-stub
// ctx with a lineWidth setter so draw() is exercised without a real canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Effects } from '../src/render/effects.js';

function parseRgb(s) {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(s.replace(/\s/g, ''));
  assert.ok(m, `parseable rgb() color, got ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function recordingCtx() {
  const calls = [];
  const widths = [];
  const rec = name => (...args) => calls.push([name, args]);
  const ctx = {
    calls, widths,
    save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), arc: rec('arc'), fill: rec('fill'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'),
    fillText: rec('fillText'),
  };
  Object.defineProperty(ctx, 'lineWidth', {
    set(v) { widths.push(v); },
    get() { return widths[widths.length - 1] ?? 0; },
  });
  return ctx;
}

test('snap debris shards are bright (channel mean >= 180) with seeded 1.4-3.2px widths', () => {
  const fx = new Effects();
  fx.spawnFromEvent({ type: 'snap', x: 40, y: 80 });
  assert.ok(fx.sparks.length >= 14, 'debris spawned');
  for (const p of fx.sparks) {
    const [r, g, b] = parseRgb(p.color);
    assert.ok((r + g + b) / 3 >= 180, `shard reads bright, got ${p.color}`);
    assert.ok(p.w >= 1.4 - 1e-9 && p.w <= 3.2 + 1e-9, `shard width 1.4-3.2px, got ${p.w}`);
  }
});

test('snip sparks: 10-12 streaks at 3px stroke width', () => {
  const fx = new Effects();
  fx.spawnSparks(120, 90);
  assert.ok(fx.sparks.length >= 10 && fx.sparks.length <= 12,
    `spark count 10-12, got ${fx.sparks.length}`);
  for (const p of fx.sparks) assert.equal(p.w, 3, 'snip spark stroke width is 3px');
});

test('per-particle width flows to ctx.lineWidth; jet particles keep 2px', () => {
  const fx = new Effects();
  fx.spawnSparks(0, 0);
  const ctx = recordingCtx();
  fx.draw(ctx);
  assert.ok(ctx.widths.length >= fx.sparks.length, 'lineWidth set per spark');
  assert.ok(ctx.widths.every(w => w === 3), 'all snip sparks drawn at 3px');

  const fx2 = new Effects();
  fx2.spawnFromEvent({ type: 'deflate', x: 0, y: 0, dirX: 1, dirY: 0 });
  const ctx2 = recordingCtx();
  fx2.draw(ctx2);
  assert.ok(ctx2.widths.length > 0 && ctx2.widths.every(w => w === 2),
    'pressure-jet particles keep the reference 2px stroke');
});

test('whip after-image opens at >=4.8px stroke width at age 0', () => {
  const fx = new Effects();
  fx.spawnWhip([[{ x: 0, y: 0 }, { x: 40, y: 10 }]]);
  const ctx = recordingCtx();
  fx.draw(ctx);
  assert.ok(ctx.widths.some(w => w >= 4.8), `fresh whip stroke >= 4.8px, got ${ctx.widths}`);
});
