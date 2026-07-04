# 第 4 轮 Changelog（Generator）

引擎零改动：`src/engine/` 全目录一行未碰。L1/L2/L3/L5/L6 关卡文件一行未碰；
level04 只动了脆撑一行 + 三处 ghost（计划点名额度内）。规则常数
（PIPE_STYLES/MAX_CONTROLS/HOLD/HYSTERESIS）未动。

## T1 · 管路静息外露清零（level04.js / session2d.js / levels.test.js）

- level04：脆撑 tip `(CX+62,CY−62)→(CX+56,CY−56)`；三个目标 ghost 的脆撑段
  tip 按比例 `(CX+68,CY−68)→(CX+62,CY−62)`。其余 ghost/cutoff/weights/
  _expectFactor 未动。
- session2d **containPipes()**（step() 最末尾，回中/回转之后）：存活管路粒子
  若在所有存活岛之外、外露 ≤24px、无抓取，则平移（x/y 与 px/py 同步，不碰
  速度分量）到最近岛边界内侧 2px。工程口径：浇注工装的「导缆槽」。
- *与计划的偏差①（速度门）*：计划的纯 `<30px/s` 速度门实测在 L3 失效——绷紧
  弓弦缆每帧把入槽粒子往外扯出 100–500px/s（探针实录），门被自己的反拉顶死，
  收容停摆在外露 4.2px 且肉眼可见进出闪烁。改为：**30px/s 门只管初次入槽**；
  入槽后粘滞（无视速度重新落座 + 消去向外法向速度分量——单侧槽壁接触，纯耗散），
  直到粒子**自行**深入体内 >4px 才释放（先试过 0.5s 计时释放，会以 ~1s 周期
  呼吸进出，弃用）。回甩保护：cableRecoil 给被剪碎段全体粒子 1.2s 豁免窗
  （并解除落座），端粒 220px/s 回甩不受收容钳制。
- levels.test.js 新增**会话层**静息包含审计（5 个 2D 关：`new Session2D` +
  step(1/60)×90，全部存活管路粒子须在岛内或外露 ≤1px）；原引擎层 pressure
  审计保留，注释里 L3/L4 豁免说明已删（改为说明双层审计分工）。
- **验收**（Node 探针，scratchpad 不入库）：L3/L4 静置 10s 外露 **0.000px**；
  L3 剪上缆仍 spawnWhip×2、缆粒瞬时峰值 444px/s（释放弹性 + 回甩注速叠加，
  ≥220 达标），6s 后全体 ≤1.8px/s 且外露 0px。
- *与计划的偏差②（<0.1px 微振荡指标）*：5s 后每帧位移实测 L3 0.49px、L4
  1.06px——但**关掉收容逐位复测数值完全相同**（同粒子同帧同幅值），且纯引擎
  L4 达 2.7px/帧（气环被顺序求解器持续泵旋，会话层三件套已把它压掉一半）、
  L3 纯引擎 0.037px（残余来自第 3 轮的 despin/rotateHome 空闲互动）。即：
  **导缆槽自身零振荡**（计划该验收的本意），残余是引擎既有尾巴，本轮
  src/engine 禁改，遗留给下轮。浏览器静置 12s 连拍两帧逐像素一致（见 T4）。

## T2 · 甩飞保险（session2d.js / session3d.js / game.js）

- 2D 回中速度 `90*dt → max(90, 0.9d)*dt`（clamp 到 d 防过冲）：1050px 甩飞
  3.68s 回锚位 ±2px；100px 近距离回中 1.100s vs 旧法则解析值 1.089s（同一
  法则，差值为帧离散）。
- session3d：settle 后快照 rest 质心；step() 末尾 grabs/pins 均空时全体存活
  粒子 x/y/z 与 px/py/pz 向 rest 质心平移，速率 `max(60, 0.9d)/s` clamp 到 d。
  **不做 3D despin/rotateHome**：3D 刚体去旋需完整惯量张量 + 3D Kabsch，超本轮
  预算，且 L6 立方体有体积约束兜底、实测拖拽位移 717 单位、松手 5s 质心残差
  0.04（≤5 达标），平移回中已覆盖玩家可见问题。
- game.js：playing 下质心出画（2D 超 [−60,1020]×[−60,700]；3D 距原点 >480）
  持续逾 2s → toast『试件正在归位——稍候，或按 R 立即复位』，每目标一次。
  注：新回中法则下 2D 无控出画 <1.2s 即回，此 toast 实际只在玩家钉住/抓着
  试件把它挂在画外时出现（Playwright 钉住 +1200px 探针：2.4s 时 toast 在显，
  文案正确——t2-away-toast.png）。

## T3 · 高光第二梯队（effects.js / session3d.js / render3d.js / game.js / effects.test.js）

- 残影：life 0.3→0.45s、线宽 4→1 渐细、色 `rgb(200,255,240)` 亮青、初始
  alpha 0.8（t3-l3-whip.png：残影在基体绿上清晰可读）。
- 碎屑：14–18 粒、重力 600px/s²、每粒种子化虚拟微面（生成点下 12–22px）
  一次 ×0.4 反弹、二次触面熄灭、寿命 ≤0.65s、确定性种子（t3-l4-debris.png /
  t3-l4-debris-bounce.png：实测 15 粒、1.35s 后 effects 归零）。
- L6 断口火花：Session3D 构造挂 `Effects`，step() 里 update(dt)；剪断分支在
  severPipeSegment **之前**取段中点 → camera.project → 屏幕坐标喂新增
  `spawnSparks()`（6–8 粒亮白蓝 2px 拖尾，寿命 ≤0.45s）；drawScene3D 最后
  `session.effects?.draw(ctx)`。3D pipeCut 事件无坐标，game.js 的
  spawnFromEvent 不识别 pipeCut → 无重复出粒（t3-l6-sparks.png：火花 6 粒 +
  同帧拓扑 toast，1.2s 后归零）。
- game.js：`topologyOk` false→true 跳变 toast『管路结构对上了——照着虚线框
  继续塑形』，每目标一次（L6 剪斜撑实测同帧出现）。
- effects.test.js：总量断言 ≥14→≥22（爆发 8–10 + 碎屑 14–18）；新增碎屑
  用例（数量 14–18、微面 12–22px、y 永不低于自家微面、1s 内死绝、微面种子
  确定性）。结构性断言原样通过。

## T4 · L1 第一印象（render2d.js / render3d.js）

- drawWetHighlight：基础项 0.10→0.14、facing 阈值 0.35→0.28；新增第二道
  高光带（facing>0.45 的边内侧 6px、4.5px 宽、alpha=0.10×gloss、量化缓存），
  随 gloss 熄灭——泄压即变暗（t4-l1-rest-highlight.png 上缘双层高光可读；
  t4-l2-deflate-gloss.png 泄压后整体哑光）。
- render3d：faceWhiteStep 阈值 1.03→1.02、斜率除数 0.22→0.17
  （t4-l6-press-whiten.png 下压泛白更明显）。
- 静置 12s 后连拍两帧 SHA1 逐像素一致（高光带是物理状态纯函数，零闲时动画）。

## T5 · 达标演出（hud.js / game.js / styles.css）

- completeTarget：gauge 加一次性 `.locked`（0.6s `steps(1)` 定格闪烁，
  iteration-count 1，animationend 自除——实测动画后 class 已移除）；banner
  改『检验通过 · 目标「X」已锁定』（t5-locked-banner.png）。smoke win-flow 过。

## 硬门数字

- `node --test 'tests/**/*.test.js'`：开工 **69 pass / 0 fail** → 收工
  **75 pass / 0 fail**（+5 会话层包含审计 +1 碎屑用例）。
- solve 六基线（开工实测 = 收工实测，**逐位一致**）：
  87.685980 / 81.138015 / 87.293848 / 50.475188（lazy）/ 78.903977 / 90.469726。
- `SHOT_DIR=docs/loop/iteration-4/shots node tests/e2e/smoke.mjs`：**SMOKE PASS**
  （全部改动落地后运行）；关键截图全部人工过目（各任务段已引用）。
- 浏览器探针零 console error（三轮 Playwright 探针均零）。

## 没做 / 遗留

- 引擎空闲尾巴：L4 气环被顺序求解器持续泵旋（纯引擎 2.7px/帧、会话层压到
  ~1.0px/帧，环形自转视觉上不可辨），L3 despin/rotateHome 空闲互动残余
  0.49px/帧——本源都在 src/engine（本轮禁改），建议下轮点名。
- 3D 无 despin/rotateHome（见 T2 取舍）：大力拖拽后立方体可能带小角度残转，
  质心回位不受影响。
- L4 脆撑用 Playwright 真实拖拽未复现拉断（本轮碎屑演出经真实事件链
  severPipeSegment+snap 验证）；拉断难度本身是关卡设计参数，未动。
