import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver, VolumeConstraint3D } from '../src/engine/xpbd.js';
import { SoftBody3D } from '../src/engine/softbody3d.js';
import { TargetSpec3D, evaluate3D } from '../src/engine/similarity3d.js';
import level06 from '../src/game/levels/level06.js';

function makeCube() {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody3D.buildCube(ps, solver, level06.body3d);
  for (const pd of level06.pipes3d) body.addPipe(pd);
  return { ps, solver, body };
}

const state = (ps, body) => ({
  ps,
  tris: body.tris,
  verts: body.verts,
  centroid: body.centroid(),
  pipes: body.pipeChains(),
  topology: body.pipeTopology(),
});

test('soft cube builds, settles stably and conserves volume', () => {
  const { ps, body } = makeCube();
  body.settle(200);
  for (const i of body.owned) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]) && Number.isFinite(ps.z[i]));
  }
  const v = VolumeConstraint3D.meshVolume(ps, body.tris);
  const v0 = 220 ** 3;
  assert.ok(Math.abs(v - v0) / v0 < 0.06, `volume ${v} vs ${v0}`);
});

test('level 6 target volumes match the cube volume (gel conservation)', () => {
  const v0 = 220 ** 3;
  for (const t of level06.targets) {
    const vt = t.box[0] * t.box[1] * t.box[2];
    assert.ok(Math.abs(vt - v0) / v0 < 0.05, `${t.name} volume ${vt}`);
  }
});

test('rest cube scores low on 板砖 and is topology-gated until the strut is snipped', () => {
  const { ps, body } = makeCube();
  body.settle(120);
  const spec = new TargetSpec3D(level06.targets[0]);
  const rest = evaluate3D(state(ps, body), spec);
  assert.equal(rest.topologyOk, false, 'uncut strut fails the topology gate');
  const cutoff = level06.targets[0].cutoff ?? level06.cutoff;
  assert.ok(rest.total < cutoff - 5, `rest score ${rest.total.toFixed(1)} stays below cutoff`);
  // Snip the strut mid-segment.
  const pipe = body.pipes[0];
  body.severPipeSegment(pipe, Math.floor(pipe.segCs.length / 2));
  assert.deepEqual(body.pipeTopology(), { chains: 2, loops: 0 });
});

test('a perfectly slab-shaped mesh beats the 板砖 cutoff with margin', () => {
  const { ps, body } = makeCube();
  const pipe = body.pipes[0];
  body.severPipeSegment(pipe, Math.floor(pipe.segCs.length / 2));
  // Teleport the mesh into the exact slab shape (kinematics only: the volume
  // is conserved by construction, so physics permits this configuration).
  const [sx, sy, sz] = level06.targets[0].box;
  for (const i of body.owned) {
    ps.x[i] *= sx / 220;
    ps.y[i] *= sy / 220;
    ps.z[i] *= sz / 220;
  }
  const spec = new TargetSpec3D(level06.targets[0]);
  const sim = evaluate3D(state(ps, body), spec);
  const cutoff = level06.targets[0].cutoff ?? level06.cutoff;
  assert.ok(sim.total >= cutoff + 5, `slab mesh ${sim.total.toFixed(1)} >= ${cutoff + 5}`);
  assert.equal(sim.topologyOk, true);
});

test('a perfectly column-shaped mesh beats the 方柱 cutoff with margin', () => {
  const { ps, body } = makeCube();
  const pipe = body.pipes[0];
  body.severPipeSegment(pipe, Math.floor(pipe.segCs.length / 2));
  const [sx, sy, sz] = level06.targets[1].box;
  for (const i of body.owned) {
    ps.x[i] *= sx / 220;
    ps.y[i] *= sy / 220;
    ps.z[i] *= sz / 220;
  }
  const spec = new TargetSpec3D(level06.targets[1]);
  const sim = evaluate3D(state(ps, body), spec);
  const cutoff = level06.targets[1].cutoff ?? level06.cutoff;
  assert.ok(sim.total >= cutoff + 5, `column mesh ${sim.total.toFixed(1)} >= ${cutoff + 5}`);
});

test('translation invariance: drifting the cube does not change its score', () => {
  const { ps, body } = makeCube();
  body.settle(60);
  const spec = new TargetSpec3D(level06.targets[0]);
  const before = evaluate3D(state(ps, body), spec);
  for (const i of body.owned) { ps.x[i] += 300; ps.y[i] -= 150; ps.z[i] += 80; }
  const after = evaluate3D(state(ps, body), spec);
  assert.ok(Math.abs(before.total - after.total) < 2, `${before.total} vs ${after.total}`);
});
