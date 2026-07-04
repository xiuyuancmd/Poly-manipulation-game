// Dial-mapping audit: the gauge arc is a gamma-stretched VIEW of the raw
// score. It must anchor at both ends, be strictly monotonic, and — the
// consistency contract with the cutoff tick — the arc passes the tick if and
// only if the raw score passes the cutoff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAL_GAMMA, dialFrac } from '../src/ui/dial.js';

test('dial anchors: 0 -> 0 and 100 -> 1, clamped outside', () => {
  assert.equal(dialFrac(0), 0);
  assert.equal(dialFrac(100), 1);
  assert.equal(dialFrac(-15), 0);
  assert.equal(dialFrac(140), 1);
});

test('dial gamma stays in the sanctioned band', () => {
  assert.ok(DIAL_GAMMA >= 1.8 && DIAL_GAMMA <= 2.4, `gamma ${DIAL_GAMMA} in [1.8, 2.4]`);
});

test('dial is strictly monotonic on a fine grid', () => {
  let prev = dialFrac(0);
  for (let v = 0.25; v <= 100; v += 0.25) {
    const cur = dialFrac(v);
    assert.ok(cur > prev, `dialFrac strictly increases at ${v} (${prev} -> ${cur})`);
    prev = cur;
  }
});

test('arc-past-tick agrees with score-past-cutoff for every (score, cutoff) pair', () => {
  const grid = [];
  for (let v = 0; v <= 100; v += 2.5) grid.push(v);
  grid.push(77.9, 78, 78.1, 79.95, 80, 80.05); // straddle the real cutoffs
  for (const c of grid) {
    for (const s of grid) {
      assert.equal(dialFrac(s) >= dialFrac(c), s >= c,
        `visual and numeric verdicts must agree at score=${s} cutoff=${c}`);
    }
  }
});
