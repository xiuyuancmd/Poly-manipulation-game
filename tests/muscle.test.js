// Active-muscle (contractile) dynamics tests.
//
// The bio theme turns contractile pipes into active fibres via
// THEMES.bio.fx.physics.pipeStyles.contractile.active (the single source of
// truth, read directly here). Each fibre has an activation a∈[0,1] that rises
// tetanically toward a force-length target and drags the constraint rest length
// between its contracted built length (rest0c, a=1) and slack·rest0c (a=0).
// Severing a fibre denervates it (a→0, limp). lab has NO active key, so its
// contractile constraints stay passive springs, bit-for-bit as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver, DistanceConstraint } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { THEMES } from '../src/game/themes.js';
import level03 from '../src/game/levels/level03.js';

const DT = 1 / 60;
const PHYS = THEMES.bio.fx.physics;
const ACTIVE = PHYS.pipeStyles.contractile.active; // { riseK, flK, flMin, softK }

/** A single contractile fibre between two PINNED particles a fixed `len` apart,
 *  so updateActivation() sees a constant strain and we can watch a/rest evolve
 *  in isolation. slack mirrors the L3 authored restFactor (0.55). */
function fibre(len, rest0c = 100, restFactor = 0.55) {
  const ps = new ParticleSystem();
  ps.add(0, 0, 0, 0);
  ps.add(len, 0, 0, 0);
  const opts = { active: { ...ACTIVE, slack: 1 / restFactor } };
  const c = new DistanceConstraint(0, 1, rest0c, 1.2e-4, false, opts);
  return { ps, c, slack: 1 / restFactor };
}

// ---- ① tetanic rise ---------------------------------------------------------

test('肌肉①强直上升沿：恒拉后 a 以 ~riseK/s 上升，rest 单调向 rest0c 迁移', () => {
  const rest0c = 100;
  const { ps, c, slack } = fibre(rest0c, rest0c); // len = rest0c => force-length target = 1
  // Start relaxed (freshly de-activated) so we can watch the rise from zero.
  c._act.a = 0;
  c.rest = slack * rest0c;

  // First-frame slope must equal the tetanic rate: da ≈ riseK·dt toward aStar=1.
  const a0 = c._act.a;
  c.updateActivation(ps, DT);
  const da = c._act.a - a0;
  assert.ok(Math.abs(da - ACTIVE.riseK * DT) < 1e-9,
    `首帧 da=${da.toFixed(5)} ≈ riseK·dt=${(ACTIVE.riseK * DT).toFixed(5)}`);

  // Over the rise a increases monotonically and rest falls monotonically.
  // Run to exactly τ = 1/riseK (0.5 s = 30 frames total, 29 more after frame 1).
  let prevA = c._act.a, prevRest = c.rest;
  for (let f = 1; f < 30; f++) {
    c.updateActivation(ps, DT);
    assert.ok(c._act.a >= prevA - 1e-12, 'a 单调不降');
    assert.ok(c.rest <= prevRest + 1e-9, 'rest 单调不升（向 rest0c 收缩）');
    prevA = c._act.a; prevRest = c.rest;
  }
  // After τ ≈ 1/riseK (0.5 s) a should be near 1−1/e ≈ 0.63.
  assert.ok(c._act.a > 0.55 && c._act.a < 0.72, `0.5s 后 a=${c._act.a.toFixed(3)} ≈ 0.63`);
  assert.ok(c.rest < slack * rest0c - 10, 'rest 已明显向 rest0c 迁移');
  // Drive to full activation and confirm rest converges to rest0c, staying in band.
  for (let f = 0; f < 300; f++) c.updateActivation(ps, DT);
  assert.ok(c._act.a > 0.98, `恒拉数秒后 a=${c._act.a.toFixed(3)} → 满收缩`);
  assert.ok(c.rest >= rest0c - 1e-9 && c.rest <= slack * rest0c + 1e-9, 'rest 在 [rest0c, slack·rest0c] 夹取带内');
  assert.ok(Math.abs(c.rest - rest0c) < 3, `rest=${c.rest.toFixed(2)} → rest0c=${rest0c}`);
});

// ---- ② force-length ---------------------------------------------------------

test('肌肉②力-长度：拉到 s≈1.8 稳态活性 a≤0.4（过拉发不出力）', () => {
  const rest0c = 100;
  const { ps, c } = fibre(1.8 * rest0c, rest0c); // s = len/rest0c = 1.8
  c._act.a = 0;
  for (let f = 0; f < 600; f++) c.updateActivation(ps, DT);
  const aStar = Math.min(1, Math.max(ACTIVE.flMin, 1 - ACTIVE.flK * 0.8));
  assert.ok(c._act.a <= 0.4, `s=1.8 稳态 a=${c._act.a.toFixed(4)} ≤ 0.4`);
  assert.ok(Math.abs(c._act.a - aStar) < 1e-3, `收敛到力-长度目标 aStar=${aStar.toFixed(4)}`);
  // Contrast: a fibre near its optimum (s≈1) reaches full activation.
  const opt = fibre(rest0c, rest0c);
  opt.c._act.a = 0;
  for (let f = 0; f < 600; f++) opt.c.updateActivation(opt.ps, DT);
  assert.ok(opt.c._act.a > 0.95, `s≈1 稳态 a=${opt.c._act.a.toFixed(4)} → 满发力`);
});

// ---- ③ denervation ----------------------------------------------------------

test('肌肉③失神经：den 后 rest→slack·rest0c、a→~0（远端瘫软）', () => {
  const rest0c = 100;
  const { ps, c, slack } = fibre(rest0c, rest0c);
  for (let f = 0; f < 180; f++) c.updateActivation(ps, DT); // drive to contracted a≈1
  assert.ok(c._act.a > 0.95, `失神经前已收缩 a=${c._act.a.toFixed(3)}`);
  c._act.den = true;
  for (let f = 0; f < 600; f++) c.updateActivation(ps, DT);
  assert.ok(c._act.a < 0.02, `失神经后 a=${c._act.a.toFixed(4)} → ~0`);
  assert.ok(Math.abs(c.rest - slack * rest0c) < 1e-3,
    `失神经后 rest=${c.rest.toFixed(3)} → slack·rest0c=${(slack * rest0c).toFixed(3)}`);
});

// ---- ③b denervation softens the solve (limp fibre) --------------------------

test('肌肉③b活性软化：a=1 时 solve 与被动弹簧逐位一致；a→0 时柔度放大', () => {
  // Two identical stretched setups; A passive, B active at a=1. The softening
  // factor (1 + softK·(1−a)) is exactly 1 at a=1, so the solves must match bit
  // for bit — proving the guard is a no-op at full activation.
  const mk = (opts) => {
    const ps = new ParticleSystem();
    ps.add(0, 0, 0, 1); ps.add(140, 0, 0, 1);
    return { ps, c: new DistanceConstraint(0, 1, 100, 3e-5, false, opts) };
  };
  const A = mk({});
  const B = mk({ active: { ...ACTIVE, slack: 1 / 0.55 } });
  B.c._act.a = 1;
  assert.equal(A.c.actSoftK, 0, '被动约束 actSoftK=0（守卫跳过）');
  assert.equal(A.c._act, null, '被动约束 _act=null');
  A.c.solve(A.ps, DT / 8);
  B.c.solve(B.ps, DT / 8);
  assert.equal(B.ps.x[0], A.ps.x[0], 'a=1 solve x[0] 逐位一致');
  assert.equal(B.ps.x[1], A.ps.x[1], 'a=1 solve x[1] 逐位一致');
  // At a→0 the effective compliance is (1+softK)× larger, so the same overstretch
  // corrects LESS per solve (limp) — the fibre pulls its endpoints less.
  const limp = mk({ active: { ...ACTIVE, slack: 1 / 0.55 } });
  limp.c._act.a = 0;
  limp.c.solve(limp.ps, DT / 8);
  const stiffPull = A.ps.x[0];          // passive moved endpoint 0 this much
  const limpPull = limp.ps.x[0];
  assert.ok(limpPull < stiffPull, `失神经拉动更弱 limp x0=${limpPull.toFixed(3)} < 刚 x0=${stiffPull.toFixed(3)}`);
});

// ---- ④ lab bit-exactness ----------------------------------------------------

function buildL3(withPhys) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const cfg = withPhys
    ? { ...level03.body, pipes: level03.pipes ?? [], ...(PHYS.body ?? {}), pipeStyles: PHYS.pipeStyles }
    : { ...level03.body, pipes: level03.pipes ?? [] };
  const body = SoftBody2D.build(ps, solver, cfg);
  if (withPhys) { solver.damping = PHYS.solver.damping; solver.viscoelastic = !!PHYS.solver.viscoelastic; }
  body.settle(150);
  return { ps, solver, body };
}

test('肌肉④lab 逐位：lab contractile 约束 _act===null、actSoftK===0，update() 零写入', () => {
  const { ps, body } = buildL3(false);
  const contractile = body.pipes.filter(p => p.alive && p.type === 'contractile');
  assert.ok(contractile.length >= 1, 'L3 有收缩肌束');
  for (const p of contractile) {
    for (const s of p.segCs) {
      assert.equal(s.c._act, null, 'lab seg 约束 _act===null');
      assert.equal(s.c.actSoftK, 0, 'lab seg 约束 actSoftK===0');
    }
    if (p.tieC) { assert.equal(p.tieC._act, null, 'lab tie _act===null'); }
  }
  // renderState activation is null for every lab pipe.
  for (const rp of body.renderState().pipes) assert.equal(rp.activation, null, 'lab renderState activation null');
  // body.update() must not move a single particle in lab (no active pass fires).
  const before = [...body.owned].filter(i => ps.alive[i]).map(i => [ps.x[i], ps.y[i]]);
  body.update();
  const after = [...body.owned].filter(i => ps.alive[i]).map(i => [ps.x[i], ps.y[i]]);
  let maxDiff = 0;
  for (let k = 0; k < before.length; k++) {
    maxDiff = Math.max(maxDiff, Math.abs(before[k][0] - after[k][0]), Math.abs(before[k][1] - after[k][1]));
  }
  assert.equal(maxDiff, 0, 'lab update() 前后粒子坐标逐位不变');
});

test('肌肉④b bio 接线：L3 contractile seg 约束 _act 存在、slack≈1.82、renderState 有 activation', () => {
  const { body } = buildL3(true);
  const contractile = body.pipes.filter(p => p.alive && p.type === 'contractile');
  assert.ok(contractile.length >= 1, 'bio L3 有收缩肌束');
  for (const p of contractile) {
    const seg = p.segCs[0].c;
    assert.ok(seg._act, 'bio seg 约束带 _act');
    assert.ok(Math.abs(seg._act.slack - 1 / 0.55) < 1e-9, `slack=${seg._act.slack.toFixed(4)} ≈ 1/0.55 ≈ 1.818`);
    assert.equal(seg.actSoftK, ACTIVE.softK, 'actSoftK 来自档案');
    assert.equal(seg._act.rest0c, seg.rest0, '_act.rest0c = 建构静息长');
  }
  const acts = body.renderState().pipes.map(p => p.activation).filter(a => a != null);
  assert.ok(acts.length >= 1, 'bio renderState 暴露 activation');
  for (const a of acts) assert.ok(a >= 0 && a <= 1, `activation ${a} ∈ [0,1]`);
});
