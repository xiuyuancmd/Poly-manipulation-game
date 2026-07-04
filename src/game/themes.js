// 双主题系统：工程主题「软体试验台」(lab，默认) 与生物主题「活体标本」(bio)。
// 主题只影响表现层——文案、配色、粒子、音效、脉搏调制；物理规则、相似度
// 与判定在两个主题下完全一致。lab 主题的 text/toasts 为空表：所有取值处都
// 以 `theme?.xxx ?? 原值` 兜底，因此 lab 下一切行为与无主题系统时逐位相同。
// 本模块必须能在无 localStorage 的 Node 测试环境下安全工作（兜底 lab）。

const STORAGE_KEY = 'polyform.theme';

export const THEMES = {
  lab: {
    meta: {
      id: 'lab',
      label: '软体试验台',
      title: '形变工坊',
      subtitle: 'PolyForm',
      tagline: '拉扯、切割、粘合一块物性未知的工程软材料——内部管路的材质，要靠你亲手试出来。',
      help: '操作：拖拽=抓取（最多 3 个控制点）· 双击=钉住/解除 · 切割须从软体外下刀 · 相似度达标并保持 3 秒即完成目标',
      tools: { pull: '🖐 牵拉', cut: '✂️ 切割', glue: '🔗 粘合' },
      pipesLabel: '管道',
    },
    palette: {},              // 空 = render2d 默认配色，逐位不变
    text: { levels: {} },     // 空 = 直接用关卡文件原文
    toasts: {},               // 空 = game.js 原文案
    strings: {},              // 空 = 会话层 hint 原文
    fx: { pulse: false, deflateStyle: 'air', debrisStyle: 'ceramic', sfx: 'industrial' },
  },
};

let current = null;

function storedThemeId() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'lab';
  } catch {
    return 'lab'; // 无 localStorage（Node 测试 / 隐私模式）：兜底 lab
  }
}

/** 当前主题；无 localStorage 环境下安全返回 lab。 */
export function currentTheme() {
  if (!current) current = THEMES[storedThemeId()] ?? THEMES.lab;
  return current;
}

/** 切换主题并持久化（localStorage 'polyform.theme'）。 */
export function setTheme(id) {
  current = THEMES[id] ?? THEMES.lab;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, current.meta.id);
  } catch { /* 隐私模式：仅本次会话生效 */ }
  return current;
}

// ---- 兜底取值 helpers（lab 主题全部返回 null / 原文） ------------------------

/** 关卡级主题文案 { name, intro, targets } | null。 */
export function themeLevel(levelId) {
  return currentTheme().text?.levels?.[levelId] ?? null;
}

/** 目标级主题文案 { name, hint, moreHints } | null。 */
export function themeTarget(levelId, targetIdx) {
  return themeLevel(levelId)?.targets?.[targetIdx] ?? null;
}

/** 事件 toast / 固定短语覆盖；无覆盖返回 null。 */
export function themeToast(key) {
  return currentTheme().toasts?.[key] ?? null;
}

/** 会话层 hint 原文 -> 主题平行文案；无映射原样返回。 */
export function themeString(text) {
  return currentTheme().strings?.[text] ?? text;
}

/** 表现层 fx 参数（脉搏 / 粒子风格 / 音色组）。 */
export function themeFx() {
  return currentTheme().fx;
}
