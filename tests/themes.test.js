// 双主题系统审计：bio 文案表必须完整覆盖全部关卡与目标；setTheme 在有
// localStorage 时持久化、在无 localStorage 的环境（本测试进程）下安全兜底
// lab；applyPalette 切到 bio 后再切回 lab 必须完整还原每一个颜色值。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES, currentTheme, setTheme, themeLevel, themeTarget, themeToast, themeString, themeFx,
} from '../src/game/themes.js';
import { COLORS, applyPalette } from '../src/render/render2d.js';
import { Effects } from '../src/render/effects.js';
import { levels } from '../src/game/levels/index.js';

test('无 localStorage 环境：currentTheme() 安全兜底 lab', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined', '本测试进程无 localStorage');
  assert.equal(currentTheme().meta.id, 'lab');
  assert.equal(themeFx().pulse, false);
  assert.equal(themeLevel('L1'), null, 'lab text 为空表：直接用关卡原文');
  assert.equal(themeToast('deflate'), null, 'lab toasts 为空表');
  assert.equal(themeString('先点住软体的边缘'), '先点住软体的边缘', 'lab strings 原样返回');
});

test('setTheme 持久化（注入 localStorage）与非法 id 兜底', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    assert.equal(setTheme('bio').meta.id, 'bio');
    assert.equal(store.get('polyform.theme'), 'bio', '写入 polyform.theme');
    assert.equal(currentTheme().meta.id, 'bio');
    assert.equal(themeFx().pulse, true);
    assert.equal(setTheme('no-such-theme').meta.id, 'lab', '非法 id 兜底 lab');
    assert.equal(setTheme('lab').meta.id, 'lab');
    assert.equal(store.get('polyform.theme'), 'lab');
    assert.equal(currentTheme().meta.id, 'lab');
  } finally {
    delete globalThis.localStorage;
    setTheme('lab');
  }
});

test('bio 文案表覆盖全部关卡：每关 name+intro，每个目标 name+hint+moreHints 平行', () => {
  const bio = THEMES.bio;
  for (const lv of levels) {
    const t = bio.text.levels[lv.id];
    assert.ok(t, `bio 覆盖关卡 ${lv.id}`);
    assert.ok(t.name?.length > 0, `${lv.id} 有主题关卡名`);
    assert.ok(t.intro?.length > 0, `${lv.id} 有主题 intro`);
    assert.equal(t.targets.length, lv.targets.length, `${lv.id} 目标数一致`);
    lv.targets.forEach((orig, i) => {
      const tt = t.targets[i];
      assert.ok(tt.name?.length > 0, `${lv.id} 目标 ${i} 有主题名`);
      assert.ok(tt.hint?.length > 0, `${lv.id} 目标 ${i} 有主题 hint`);
      assert.equal(tt.moreHints?.length ?? 0, orig.moreHints?.length ?? 0,
        `${lv.id} 目标 ${i} moreHints 逐条平行`);
    });
  }
});

test('bio 文案不残留工程口径（试件/管路），lab 关卡原文不受影响', () => {
  const walk = (node, out = []) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(v => walk(v, out));
    else if (node && typeof node === 'object') Object.values(node).forEach(v => walk(v, out));
    return out;
  };
  for (const s of walk(THEMES.bio.text)) {
    assert.ok(!s.includes('试件'), `bio 文案不含「试件」：${s}`);
    assert.ok(!s.includes('管路'), `bio 文案不含「管路」：${s}`);
  }
  // 关卡文件本身一行未动：原文仍是工程口径。
  assert.equal(levels[0].name, '试件 01 · 弹性标定');
});

test('applyPalette：bio 覆盖后切回 lab，COLORS 完整还原', () => {
  const before = { ...COLORS };
  applyPalette(THEMES.bio.palette);
  assert.equal(COLORS.bodyFill, 'rgba(164,74,86,0.60)', 'bio 组织红生效');
  assert.equal(COLORS.bg, before.bg, 'bg 不在 bio 覆盖集内，保持默认');
  assert.equal(COLORS.grab, before.grab, 'grab 不动');
  applyPalette(THEMES.lab.palette);
  assert.deepEqual({ ...COLORS }, before, 'lab 逐键还原');
});

test('Effects 风格注入：默认=lab 基准；fluid 泄压粒子为带重力的圆点', () => {
  const lab = new Effects();
  lab.spawnFromEvent({ type: 'deflate', x: 0, y: 0, dirX: 1, dirY: 0 });
  assert.ok(lab.sparks.every(p => !p.dot && p.ay == null), 'lab 泄压粒子保持拖尾流光');
  assert.equal(lab.style.rejectLabel, '只能从外部下刀');

  const bio = new Effects(THEMES.bio.fx);
  bio.spawnFromEvent({ type: 'deflate', x: 0, y: 0, dirX: 1, dirY: 0 });
  assert.ok(bio.sparks.length >= 8, '首帧喷射数量规则不变');
  for (const p of bio.sparks) {
    assert.equal(p.dot, true, 'bio 液滴是圆点');
    assert.equal(p.ay, 400, 'bio 液滴受 400px/s² 重力');
    assert.equal(p.size, 2.5, 'bio 液滴 2.5px');
    assert.ok(p.life <= 0.65 + 1e-9, '寿命规则不变');
  }
  bio.update(1.0);
  bio.update(1.0);
  assert.equal(bio.active, false, '1 秒后死绝（含发射器）');
  assert.equal(bio.style.rejectLabel, '只能从标本外部下刀');
});
