import test from 'node:test';
import assert from 'node:assert/strict';
import { TargetSpec, evaluate } from '../src/engine/similarity2d.js';
import { ngon, ellipse, circle, line, translate, rotateAround } from '../src/game/levels/shapes.js';

function state(rings, pipes = [], topology = null) {
  return { rings, pipes, topology };
}

const hexTarget = () => new TargetSpec({
  name: 'hex',
  outline: ngon(400, 300, 110, 6),
  pipes: [{ points: line(330, 300, 470, 300, 8), closed: false }],
});

test('identical shape scores near-perfect', () => {
  const spec = hexTarget();
  const r = evaluate(state([ngon(400, 300, 110, 6)], [{ points: line(330, 300, 470, 300, 8), closed: false }]), spec);
  assert.ok(r.total > 97, `total ${r.total}`);
  assert.ok(r.iou > 0.93, `iou ${r.iou}`);
});

test('similarity is translation and rotation invariant', () => {
  const spec = hexTarget();
  const movedRing = rotateAround(translate(ngon(400, 300, 110, 6), 900, -350), 0.7, 1300, -50);
  const movedPipe = rotateAround(translate(line(330, 300, 470, 300, 8), 900, -350), 0.7, 1300, -50);
  const r = evaluate(state([movedRing], [{ points: movedPipe, closed: false }]), spec);
  assert.ok(r.total > 93, `total ${r.total} should survive rigid motion`);
});

test('a much smaller blob cannot cheese the IoU', () => {
  const spec = hexTarget();
  const r = evaluate(state([ngon(400, 300, 45, 6)], [{ points: line(370, 300, 430, 300, 4), closed: false }]), spec);
  assert.ok(r.total < 45, `small blob total ${r.total} must stay low`);
});

test('wrong shape scores clearly below cutoff, similar shape in between', () => {
  const spec = new TargetSpec({
    name: 'ellipse',
    outline: ellipse(400, 300, 150, 66),
    pipes: [{ points: line(280, 300, 520, 300, 8), closed: false }],
  });
  const thin = evaluate(state([ellipse(400, 300, 190, 30)], [{ points: line(240, 300, 560, 300, 8), closed: false }]), spec);
  const close = evaluate(state([ellipse(400, 300, 140, 72)], [{ points: line(290, 300, 510, 300, 8), closed: false }]), spec);
  assert.ok(thin.total < 75, `thin ${thin.total}`);
  assert.ok(close.total > 85, `close ${close.total}`);
  assert.ok(close.total > thin.total);
});

test('pipe topology mismatch is heavily penalized', () => {
  const spec = new TargetSpec({
    name: 'cut required',
    outline: circle(400, 300, 100),
    pipes: [
      { points: line(340, 300, 390, 300, 4), closed: false },
      { points: line(410, 300, 460, 300, 4), closed: false },
    ],
    topology: { chains: 2, loops: 0 },
  });
  const uncut = evaluate(
    state([circle(400, 300, 100)], [{ points: line(340, 300, 460, 300, 8), closed: false }], { chains: 1, loops: 0 }),
    spec,
  );
  const cut = evaluate(
    state([circle(400, 300, 100)], [
      { points: line(340, 300, 390, 300, 4), closed: false },
      { points: line(410, 300, 460, 300, 4), closed: false },
    ], { chains: 2, loops: 0 }),
    spec,
  );
  assert.ok(cut.total > 95, `cut ${cut.total}`);
  assert.ok(uncut.total < cut.total - 15, `uncut ${uncut.total} must trail cut ${cut.total}`);
  assert.equal(uncut.topologyOk, false);
});

test('disjoint target outlines (two blobs) rasterize as union', () => {
  const spec = new TargetSpec({
    name: 'two blobs',
    outlines: [circle(300, 300, 70), circle(520, 300, 70)],
    pipes: [],
  });
  const good = evaluate(state([circle(300, 300, 70), circle(520, 300, 70)]), spec);
  const half = evaluate(state([circle(300, 300, 70)]), spec);
  assert.ok(good.total > 90, `both blobs ${good.total}`);
  assert.ok(half.total < good.total - 20, `one blob ${half.total}`);
});

test('mirror is rejected unless allowed', () => {
  // Strongly chiral L: 220-long vertical arm, 90-long horizontal arm.
  const lPoly = [
    { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 170 },
    { x: 140, y: 170 }, { x: 140, y: 220 }, { x: 0, y: 220 },
  ];
  const mirrored = lPoly.map(p => ({ x: -p.x, y: p.y }));
  const strict = new TargetSpec({ outline: lPoly, pipes: [] });
  const loose = new TargetSpec({ outline: lPoly, pipes: [], mirrorAllowed: true });
  const rStrict = evaluate(state([mirrored]), strict);
  const rLoose = evaluate(state([mirrored]), loose);
  assert.ok(rLoose.total > rStrict.total + 8, `mirrorAllowed ${rLoose.total} vs strict ${rStrict.total}`);
});
