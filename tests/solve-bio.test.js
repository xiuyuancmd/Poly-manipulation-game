// Bio material-profile reachability + stability tests.
//
// The bio theme ships a physics profile (THEMES.bio.fx.physics — the single
// source of truth, read directly here) that turns on subcritical damping,
// membrane viscoelasticity (SLS creep + J-curve hardening) and pulsatile
// bleed-out. The charter requires the profile to carry its own reachability
// guarantee: the same ideal-player harness as solve.test.js, with the same
// 3-control budget, must still clear every 2D level cutoff under bio physics.
// Cutoffs and level data are untouchable — if a target fails, the PROFILE
// gets retuned, never the level.
//
// The harness mirrors solve.test.js's authorSolve; the only strategy freedom
// used is per-target pacing (frames / grip hold), exactly like solve.test.js
// varies `frames` per target — viscoelastic tissue rewards holding a grip
// longer so the creep can flow, which is how a human plays it too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, Solver, AnchorConstraint } from '../src/engine/xpbd.js';
import { SoftBody2D } from '../src/engine/softbody2d.js';
import { performCut } from '../src/engine/cut2d.js';
import { TargetSpec, evaluate, inverseTransform } from '../src/engine/similarity2d.js';
import { resamplePolyline } from '../src/engine/geom.js';
import { THEMES, setTheme } from '../src/game/themes.js';
import level01 from '../src/game/levels/level01.js';
import level02 from '../src/game/levels/level02.js';
import level03 from '../src/game/levels/level03.js';

const DT = 1 / 60;
const PHYS = THEMES.bio.fx.physics;

/** Build a level body under the bio material profile (exactly the config the
 *  session layer assembles from fx.physics). */
function bioBuild(level) {
  const ps = new ParticleSystem();
  const solver = new Solver(ps);
  const body = SoftBody2D.build(ps, solver, {
    ...level.body,
    pipes: level.pipes ?? [],
    ...(PHYS.body ?? {}),
    pipeStyles: PHYS.pipeStyles,
  });
  solver.damping = PHYS.solver.damping;
  solver.viscoelastic = !!PHYS.solver.viscoelastic;
  body.settle(150);
  return { ps, solver, body };
}

function authorSolve(level, targetIdx, { cuts = [], frames = 1200, controls = 3, gripFrames = 240 } = {}) {
  const { ps, solver, body } = bioBuild(level);
  for (const c of cuts) {
    performCut(body, c[0], c[1], c[2], c[3]);
    body.settle(60);
  }

  const target = level.targets[targetIdx];
  const spec = new TargetSpec(target);
  const island = body.aliveIslands().sort((a, b) => b.ring.length - a.ring.length)[0];
  const ring = island.ring;
  const tgt0 = resamplePolyline(target.outlines[0], ring.length, true);

  const playerState = () => ({
    rings: body.aliveIslands().map(isl => body.ringPoints(isl)),
    pipes: body.pipeChains(),
    topology: body.pipeTopology(),
  });

  let corrPts = tgt0;
  const realign = (sim) => {
    const world = sim?.transform ? inverseTransform(tgt0, sim.transform) : tgt0;
    let best = { cost: Infinity, k: 0, dir: 1 };
    for (const dir of [1, -1]) {
      for (let k = 0; k < ring.length; k++) {
        let cost = 0;
        for (let i = 0; i < ring.length; i += 4) {
          const t = world[(((i * dir + k) % ring.length) + ring.length) % ring.length];
          cost += Math.hypot(ps.x[ring[i]] - t.x, ps.y[ring[i]] - t.y);
        }
        if (cost < best.cost) best = { cost, k, dir };
      }
    }
    corrPts = ring.map((_, i) =>
      world[(((i * best.dir + best.k) % ring.length) + ring.length) % ring.length]);
  };
  realign(null);

  const DRAG_FRAMES = 100;
  let anchors = [];
  const regrip = (sim) => {
    realign(sim);
    for (const g of anchors) for (const a of g.group) solver.remove(a.c);
    anchors = [];
    const taken = new Set();
    for (let c = 0; c < controls; c++) {
      let worst = -1, worstD = -1;
      for (let i = 0; i < ring.length; i++) {
        if ([...taken].some(t => Math.min(Math.abs(t - i), ring.length - Math.abs(t - i)) < 6)) continue;
        const d = Math.hypot(ps.x[ring[i]] - corrPts[i].x, ps.y[ring[i]] - corrPts[i].y);
        if (d > worstD) { worstD = d; worst = i; }
      }
      if (worst < 0) break;
      taken.add(worst);
      const from = { x: ps.x[ring[worst]], y: ps.y[ring[worst]] };
      const group = [];
      for (let off = -2; off <= 2; off++) {
        const idx = ((worst + off) % ring.length + ring.length) % ring.length;
        const q = ring[idx];
        group.push({
          c: solver.add(new AnchorConstraint(q, ps.x[q], ps.y[q], 0, 4e-5)),
          ox: ps.x[q] - from.x,
          oy: ps.y[q] - from.y,
        });
      }
      anchors.push({ group, i: worst, from, t: 0 });
    }
  };

  let bestScore = 0;
  let lastSim = null;
  for (let f = 0; f < frames; f++) {
    if (f % gripFrames === 0) regrip(lastSim);
    for (const g of anchors) {
      g.t++;
      const ease = Math.min(1, g.t / DRAG_FRAMES);
      const to = corrPts[g.i];
      const hx = to.x + (to.x - g.from.x) * 0.35;
      const hy = to.y + (to.y - g.from.y) * 0.35;
      const cx = g.from.x + (hx - g.from.x) * ease;
      const cy = g.from.y + (hy - g.from.y) * ease;
      for (const a of g.group) a.c.setTarget(cx + a.ox, cy + a.oy);
    }
    solver.step(DT);
    body.update();
    if (f % 20 === 19) {
      lastSim = evaluate(playerState(), spec);
      bestScore = Math.max(bestScore, lastSim.total);
    }
  }
  return bestScore;
}

// ---- profile wiring ---------------------------------------------------------

test('bio 档案接线：Session2D 构造后 solver 吃到阻尼/粘弹开关，edge 约束带 creep', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    setTheme('bio');
    const { Session2D } = await import('../src/game/session2d.js');
    const s = new Session2D(level01);
    assert.equal(s.solver.damping, PHYS.solver.damping, 'bio 阻尼档生效');
    assert.equal(s.solver.viscoelastic, true, '粘弹性开关打开');
    const edge = s.body.aliveIslands()[0].edgeCs[0].c;
    assert.ok(edge.creepK > 0, 'edge 约束带 creepK');
    assert.ok(edge.hardenK > 0, 'edge 约束带 J 形硬化');
    assert.equal(edge.rest0, edge.rest, '构造时 rest0 = rest');
    const lat = s.body.latticeCs[0].c;
    assert.ok(lat.creepK > 0, 'lattice 约束带 creepK');
    assert.equal(lat.hardenK, 0, 'lattice 不硬化（内部凝胶不锁死，保可达性）');
    assert.ok(s.bleedCfg && s.bleedCfg.pulses >= 3, 'bleed 调度配置就位');

    setTheme('lab');
    const lab = new Session2D(level01);
    assert.equal(lab.solver.damping, 0.982, 'lab 无 physics 键：默认阻尼');
    assert.equal(lab.solver.viscoelastic, false, 'lab 粘弹关闭');
    assert.equal(lab.body.aliveIslands()[0].edgeCs[0].c.creepK, 0, 'lab edge 无 creep');
  } finally {
    delete globalThis.localStorage;
    setTheme('lab');
  }
});

// ---- reachability under bio physics ----------------------------------------

test('bio 物理下 L1 目标一「橄榄」作者解过 cutoff', () => {
  const score = authorSolve(level01, 0);
  const cutoff = level01.targets[0].cutoff ?? level01.cutoff;
  assert.ok(score >= cutoff, `bio author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('bio 物理下 L1 目标二「弯月」作者解过 cutoff', () => {
  // 弯月是摆位任务而非蠕变任务：快节奏换把（2s）跟得上 ghost 重对齐。
  const score = authorSolve(level01, 1, { frames: 1800, gripFrames: 120 });
  const cutoff = level01.targets[1].cutoff ?? level01.cutoff;
  assert.ok(score >= cutoff, `bio author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('bio 物理下 L2 目标一「饱满的蛋」作者解过 cutoff', () => {
  const score = authorSolve(level02, 0);
  const cutoff = level02.targets[0].cutoff ?? level02.cutoff;
  assert.ok(score >= cutoff, `bio author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('bio 物理下 L2 目标二「软枕头」：切血管白嫖不过，认真塑形能过', () => {
  const cutoff = level02.targets[1].cutoff ?? level02.cutoff;
  // 只放血不塑形必须离 cutoff 足够远（负向门与 lab 版一致）。
  const lazy = authorSolve(level02, 1, { cuts: [[200, 320, 296, 320]], frames: 60, controls: 0 });
  assert.ok(lazy < cutoff - 4, `post-cut no-work score ${lazy.toFixed(1)} must stay below ${cutoff - 4}`);
  // 粘弹组织要「按住等它流动」——每把抓 6s，总时长 60s（时限 210s 内）。
  const score = authorSolve(level02, 1, {
    cuts: [[200, 320, 296, 320]],
    frames: 3600,
    gripFrames: 360,
  });
  assert.ok(score >= cutoff, `bio author solve ${score.toFixed(1)} >= ${cutoff}`);
});

test('bio 物理下 L3 目标一「平板」作者解过 cutoff（主动肌肉不阻断可达性）', () => {
  // 主动收缩肌束会主动把两端拽拢，作者解须"顶着肌腱"绷平肌片。第 2 轮探针
  // 94.1（第 1 轮被动 89.5→主动 94.1）。显式设 ≥85 回归地板，独立于 cutoff。
  const score = authorSolve(level03, 0, { frames: 1800, gripFrames: 300 });
  const cutoff = level03.targets[0].cutoff ?? level03.cutoff;
  assert.ok(score >= cutoff, `bio author solve ${score.toFixed(1)} >= ${cutoff}`);
  assert.ok(score >= 85, `L3-1 主动肌肉下维持 ≥85（实测 ${score.toFixed(1)}）`);
});

// ---- numeric stability under abuse ------------------------------------------

/** mulberry32 — deterministic RNG so the abuse trajectory is reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('bio 稳定性：3 点随机 1200px 暴力拖拽 600+ 帧不 NaN 不爆炸，rest 不越夹取界', () => {
  const { ps, solver, body } = bioBuild(level02);
  const rng = makeRng(1337);
  const owned = [...body.owned].filter(i => ps.alive[i]);
  const anchors = [];
  for (let k = 0; k < 3; k++) {
    const p = owned[Math.floor(rng() * owned.length)];
    anchors.push(solver.add(new AnchorConstraint(p, ps.x[p], ps.y[p], 0, 1e-4)));
  }
  const cx = 480, cy = 320;
  for (let f = 0; f < 600; f++) {
    if (f % 40 === 0) {
      for (const a of anchors) a.setTarget(cx + (rng() * 2 - 1) * 1200, cy + (rng() * 2 - 1) * 1200);
    }
    solver.step(DT);
    body.update();
    if (f % 100 === 99) {
      for (const i of body.owned) {
        if (!ps.alive[i]) continue;
        assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]), `粒子 ${i} 坐标 finite (f=${f})`);
        assert.ok(Math.abs(ps.x[i]) < 6000 && Math.abs(ps.y[i]) < 6000, `粒子 ${i} 不飞出 6000px (f=${f})`);
      }
    }
  }
  // 恒拉 5s：creep 持续工作后，rest 必须仍在 [restLo, restHi]×rest0 夹取带内。
  for (const a of anchors) a.setTarget(cx + 900, cy);
  for (let f = 0; f < 300; f++) { solver.step(DT); body.update(); }
  const checkRest = (c, tag) => {
    if (!c.creepK) return;
    const lo = c.restLo * c.rest0 - 1e-9, hi = c.restHi * c.rest0 + 1e-9;
    assert.ok(c.rest >= lo && c.rest <= hi, `${tag} rest=${c.rest.toFixed(2)} ∈ [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
    assert.ok(Number.isFinite(c.rest), `${tag} rest finite`);
  };
  for (const isl of body.aliveIslands()) isl.edgeCs.forEach((e, k) => checkRest(e.c, `edge#${k}`));
  body.latticeCs.forEach((e, k) => checkRest(e.c, `lattice#${k}`));
});

test('bio 稳定性：L3 主动肌肉下 3 点 1200px 暴力拖拽 600 帧含活性 pass 不 NaN，肌腱 rest 不越界', () => {
  const { ps, solver, body } = bioBuild(level03);
  const rng = makeRng(9001);
  const owned = [...body.owned].filter(i => ps.alive[i]);
  const anchors = [];
  for (let k = 0; k < 3; k++) {
    const p = owned[Math.floor(rng() * owned.length)];
    anchors.push(solver.add(new AnchorConstraint(p, ps.x[p], ps.y[p], 0, 1e-4)));
  }
  const cx = 480, cy = 320;
  const checkTendonRest = (f) => {
    for (const pipe of body.pipes) {
      if (!pipe.alive) continue;
      const segs = [...pipe.segCs.map(s => s.c), pipe.tieC, ...(pipe.bendCs ?? []).map(b => b.c)];
      for (const c of segs) {
        if (!c || !c._act) continue;
        const lo = c._act.rest0c - 1e-9, hi = c._act.slack * c._act.rest0c + 1e-9;
        assert.ok(Number.isFinite(c.rest), `肌腱 rest finite (f=${f})`);
        assert.ok(c.rest >= lo && c.rest <= hi,
          `肌腱 rest=${c.rest.toFixed(2)} ∈ [${lo.toFixed(2)}, ${hi.toFixed(2)}] (f=${f})`);
      }
    }
  };
  for (let f = 0; f < 600; f++) {
    if (f % 40 === 0) {
      for (const a of anchors) a.setTarget(cx + (rng() * 2 - 1) * 1200, cy + (rng() * 2 - 1) * 1200);
    }
    solver.step(DT);
    body.update(); // 含主动肌肉活性 pass
    if (f % 100 === 99) {
      for (const i of body.owned) {
        if (!ps.alive[i]) continue;
        assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]), `粒子 ${i} finite (f=${f})`);
        assert.ok(Math.abs(ps.x[i]) < 6000 && Math.abs(ps.y[i]) < 6000, `粒子 ${i} 不飞出 6000px (f=${f})`);
      }
      checkTendonRest(f);
    }
  }
  // 收尾再核一次肌腱 rest 夹取带。
  checkTendonRest(600);
});
