// Pinned-specimen containment audit: with a pin holding the hub, a snapped
// brittle stub oscillates for a long time (the pin blocks the usual glide-home
// damping path), so the cable-guide groove must catch it through its NORMAL
// velocity gate — the total-speed gate never opened and the stub flickered
// 5–65 px proud of the wall indefinitely. Replays the exact probe: pin the
// hub, drag the brittle tip until it snaps, release the grab (keep the pin),
// then demand every live pipe particle stays within 1 px of the wall for a
// sustained window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session2D } from '../src/game/session2d.js';
import { pointInPolygon } from '../src/engine/geom.js';
import level04 from '../src/game/levels/level04.js';

const DT = 1 / 60;

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

/** Worst protrusion (px) of any live pipe particle outside every island. */
function maxProtrusion(session) {
  const { ps, body } = session;
  const islands = body.aliveIslands().map(i => body.ringPoints(i));
  let worst = 0;
  for (const pipe of body.pipes) {
    if (!pipe.alive) continue;
    for (const p of pipe.parts) {
      if (!ps.alive[p]) continue;
      const x = ps.x[p], y = ps.y[p];
      if (islands.some(poly => pointInPolygon(poly, x, y))) continue;
      worst = Math.max(worst, Math.min(...islands.map(poly => distToPoly(poly, x, y))));
    }
  }
  return worst;
}

test('L4 pinned hub + snapped brittle stub: groove re-seats it within 1px, sustained', () => {
  const session = new Session2D(level04);

  // Pin the pipe hub, then grab the brittle tip and drag it out along the
  // pipe axis at 1.6 px/frame (up-right, +x/-y) until the conduit snaps.
  session.togglePin(360, 320);
  assert.equal(session.pins.size, 1, 'hub pinned');
  assert.ok(session.pointerDown('pull', 416, 264, 1), 'grabbed the brittle tip');

  let gx = 416, gy = 264;
  let snapped = false;
  for (let f = 0; f < 600 && !snapped; f++) {
    gx += 1.6; gy -= 1.6;
    session.pointerMove('pull', gx, gy, 1);
    session.step(DT);
    const evts = session.drainEvents();
    if (evts.some(e => e.type === 'snap'
      || (e.type === 'pipeCut' && e.pipeType === 'brittle'))) snapped = true;
  }
  assert.ok(snapped, 'brittle conduit must snap within 600 frames of dragging');

  // Release the grab, keep the pin — this is the state the total-speed gate
  // could never contain (the stub oscillated 5-65px proud indefinitely).
  session.pointerUp('pull', gx, gy, 1);
  assert.equal(session.grabs.size, 0, 'grab released');
  assert.equal(session.pins.size, 1, 'pin still holding');

  // From 2s after release, sample every 0.5s for 4 continuous seconds:
  // every live pipe particle of every material must sit within 1px.
  let frame = 0;
  const samples = [];
  for (frame = 1; frame <= 360; frame++) {
    session.step(DT);
    session.drainEvents();
    if (frame >= 120 && frame % 30 === 0) {
      const d = maxProtrusion(session);
      samples.push(d);
      assert.ok(d <= 1,
        `pipe protrusion ${d.toFixed(3)}px at t=${(frame * DT).toFixed(2)}s must stay <= 1px`);
    }
  }
  assert.equal(samples.length, 9, 'sampled 2.0s..6.0s every 0.5s');
});
