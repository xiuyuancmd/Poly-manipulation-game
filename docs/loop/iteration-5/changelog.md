# 第 5 轮 Changelog（Generator）

引擎零改动：`src/engine/` 全目录一行未碰。level02–06 关卡文件一行未碰；
level01 只加了目标一的 `cutoff: 78,` 一行；game.js 只改了一句文案。
规则常数（HYSTERESIS/HOLD_SECONDS/SIM_INTERVAL/MAX_CONTROLS/PIPE_STYLES）
与泄压喷流参数全部未动。既有测试与 smoke 只加未改。

## T1 · 高光份量三连（effects.js / 新增 effects-visibility.test.js）

- spawnDebris 碎屑弃用暗色 `rgb(30,41,38)`（黑底上近乎隐形），按种子 rng
  五五开亮灰白 `rgb(226,234,236)` / 淡青 `rgb(188,226,222)`——新断面朝光，
  工程口径成立；每粒新增种子化描边宽 `w: 1.4–3.2px`。数量/重力/微面/寿命
  一律未动（effects.test 原样全绿锁死）。
- spawnSparks（3D 剪管火花）：`6+⌊rng·3⌋ → 10+⌊rng·3⌋`，每粒 `w: 3`。
- draw() 火花描边 `lineWidth = p.w ?? 2`：泄压喷流粒子不带 w，保持 2px
  标杆原样。
- whip 残影：`lineWidth 1+3f → 1+4f`（初宽 4→5px），初始 alpha 0.8→0.9。
- 新测试 4 条：碎屑三通道均值 ≥180 且 w∈[1.4,3.2]；火花 10–12 粒且 w=3；
  带 lineWidth setter 的 stub ctx 验证逐粒宽度下发、喷流仍 2px；whip age=0
  描边 ≥4.8px。
- 截图：`l4-snap-debris.png`（拉断瞬间亮色碎屑清晰可见）、
  `l6-snip-sparks.png`（剪撑火花明显加粗变密），对照上轮明显加强。

## T2 · 仪表化读数（新增 ui/dial.js + dial.test.js；hud.js / styles.css / game.js 一句）

- `dial.js`：`DIAL_GAMMA = 2.2`，`dialFrac(v) = pow(clamp(v,0,100)/100, γ)`。
  **纯视觉映射**——数字、达标判定、hold 全用原始分。
- hud.js：`#score-num` 显示真值一位小数（`toFixed(1)`），passing 用未取整值
  对 cutoff；gauge SVG 加外圈 `#ring-score`（r=47、宽 4、#5aa0e8，passing
  变 #7ee0c3），`dashoffset = (1−dialFrac(total))·周长`；加达标刻度线
  `#ring-tick`（r=43→51），setTarget 按 `360°·dialFrac(cutoff)` 旋转就位——
  弧与刻度同一映射，pow 严格单调 ⇒ 弧过刻度 ⇔ 分过线，帧级一致。
- styles.css：`#score-num` 34→26px；外弧/刻度样式；弧 transition 0.1s linear。
- game.js 唯一一句：拓扑修复 toast 尾部加「读数会跟着爬升」。
- dial.test.js 4 条：端点锚定、γ∈[1.8,2.4]、0.25 步长网格严格单调、
  ∀(s,c) `(dialFrac(s)≥dialFrac(c)) === (s≥c)`。
- Playwright 探针实测（L1 钉左端慢拉右端十六步）：score-num **16/16 步**
  变化（上轮取整显示常整段死住）；弧与数字全样本单调一致；越线帧弧已过
  刻度、数字与弧的 passing 色同帧点亮。注意：一位小数会把 77.96 显示成
  「78.0」而 passing 按未取整值判 false——这正是计划钦定的口径（数字显示
  真值、判定不取整），探针改判 passing-class ↔ 弧过刻度一致后全绿。
- 截图：`gauge-rest-closeup.png`（63.4，蓝弧未及金刻度）、
  `gauge-passing-closeup.png`（82.2，弧变薄荷色越过刻度）。

## T3 · L1 目标一 cutoff 80→78（level01.js 一行）

- solve L1-1 基线 87.69 对 78 余量更宽；levels.test「完美形 ≥ cutoff+5」
  85→83 更宽；该目标无 `_restBelow`，静息 74.3 距 78 仍需真实塑形。

## T4 · L1 内部顶光径向渐变（render2d.js）

- drawBody glaze 层后、焊点前插 `drawInteriorLight`：逐岛质心+bbox，
  `R = 0.75·max(bboxW,bboxH)`，光心 = 质心 + `(LIGHT_X, LIGHT_Y)·0.25R`；
  径向渐变 `rgba(224,255,245,A) → 0.55 处 0.35A → 透明`，`A = 0.09·poolGloss`，
  `poolGloss = p<1 ? max(0,1−(1−p)/0.2) : 1`（满压全亮、p≤0.8 全灭——比
  边缘湿高光的 ×0.5 更狠，体积光随泄压熄灭）。tracePoly 渐变填充，纯几何+
  压强函数，零闲时动画。
- 截图：`l1-interior-light.png`（内部读出体积，管路与金色虚影不被冲淡）、
  `l2-inflated-light.png` 光斑在 → `l2-deflated-lightoff.png` 泄压光灭。
- 静置验收：L1 空置 12s 后隔 0.4s 连拍两帧 canvas.toDataURL，SHA1 逐位一致
  （`7f18f0135422d52a221d7ac01e2d7020a9388902`）。

## T5 · 钉住态断口收容：法向速度门（session2d.js / 新增 containment-pinned.test.js）

- containPipes 三处改动（其余逐字保留：grabs 早退、freeUntil 豁免、24px
  释放、2px 落座、粘滞逻辑）：
  1. 最近边界点计算提前到入槽门之前（门要用它的法向）；
  2. 初次入槽门「总速度<30px/s」改「**外向法向速度 vOut<30px/s**」——槽壁
     是法向单侧接触，切向速度与入槽无关；钉住试件的断桩振荡快但外向分量
     周期性过零，落座窗口必然出现；
  3. 体内释放收紧为 `seated && bd>4 && 总速度<30px/s`——高速穿过体内深处
     是缆还在荡，不是坐稳，按深度单独释放会让断桩半周期一次棘轮外逃。
- 新测试复刻 Planner 探针：L4 钉 hub(360,320) → 抓 (416,264) 每帧 ±1.6
  拖至 snap（600 帧内必断，实测 173 帧）→ 松抓保钉 → 自 2s 起至 6s 每
  0.5s 采样九次，全管路外露全部 ≤1px（原版门下探针实录 4.8–65px 振荡
  永不收敛）。
- L3 回甩未破坏（Node 探针）：剪上缆管粒峰值 **753.4px/s**（≥220 达标，
  freeUntil 豁免窗完好），6s 后外露 **0.000px**。既有会话层/引擎层包含
  审计原样全绿。

## 硬门数字

- `node --test`：开工 75 pass / 0 fail → 收工 **84 pass / 0 fail**（+9）。
- solve 六基线开工=收工逐位一致：87.685980 / 81.138015 / 87.293848 /
  50.475188 / 78.903977 / 90.469726。
- `SHOT_DIR=docs/loop/iteration-5/shots node tests/e2e/smoke.mjs` → SMOKE PASS。
- 新增文案/注释/标识符过中英生物词 grep：仅 “can**cell**ed”“qu**arter**”
  两个子串误报，无生物联想。

## 没做什么 / 为什么

- γ 未微调（2.2 出厂值截图观感已达标：静息 74 分落弧 51%，爬升段肉眼可见）。
- 引擎残余微振荡（第 4 轮遗留）依旧未碰——src/engine 禁改红线。
