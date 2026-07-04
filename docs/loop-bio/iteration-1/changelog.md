# 生物物理循环 第 1 轮 Changelog（Generator）—— 「粘弹性地基」

材质档案（Material Profile）架构落地：引擎新增的一切物理都是**默认关闭的可选特性**，
由 `THEMES.bio.fx.physics`（单一数据源）在会话层打开并配参。lab 主题**无 physics 键**，
引擎默认值 = 现行为，**逐位不变**。关卡数据 / cutoff / 相似度 / 既有测试断言 / lab 主题
一律未改（新测试只增不改）。

## 硬门结果

1. `node --test 'tests/**/*.test.js'` **97/97 全绿**（含新增 solve-bio.test.js 7 条）。
2. solve 六基线（lab 物理）**逐位一致**：
   `87.685980 / 81.138015 / 87.293848 / 50.475188 / 78.903977 / 90.469726`。
3. `node tests/e2e/smoke.mjs` → **SMOKE PASS**（默认 lab）。
4. solve-bio（bio 物理下作者解过各关 cutoff）**全绿**，最终分数：
   L1-1 88.31（≥78）· L1-2 83.13（≥80）· L2-1 87.21（≥85）·
   L2-2 lazy 48.55（< 68 负向门）/ 认真 73.55（≥72）· L3-1 89.55（≥85）。
5. Playwright 浏览器核对：切 bio → 标题「活体标本」、切 L2 环形血管→血滴喷发 +
   搏动性泄压可见 → 切回 lab 配色完整还原，`BIO PROBE PASS`。

## T1 · 材质档案接线（xpbd / softbody2d / themes / session2d / session3d）

- **themes.js**：`THEMES.bio.fx.physics = { solver, body:{membraneCreep,membraneHarden},
  pipeStyles:{}, bleed:{pulses:4} }`。lab.fx 不加 physics。
- **xpbd.js · DistanceConstraint**：加第 6 参 `opts={}`（既有位置签名不变），记 `rest0=rest`；
  新字段 creepK/recoverK/creepOnset/restLo/restHi/hardenK/hardenOnset 默认全 0/关。
  `Solver.viscoelastic=false` 开关。
- **softbody2d.js**：build config 认 membraneCreep/membraneHarden/pipeStyles（默认 null=现行为）；
  edge 约束透传 `membraneOpts`（creep+harden），**lattice 只透传 creep 不透传 harden**
  （内部凝胶必须能大变形，锁死会让 L2 作者解不可达）；bend 不透传。
  `addPipe` 内 `style = {...PIPE_STYLES[type], ...(pipeStyles?.[type] ?? {}), ...overrides}`。
- **session2d.js**：build 前解析 `fx.physics`，合入 `phys.body` + `pipeStyles`；build 后设
  `solver.damping / viscoelastic`（settle 内部临时 0.6 后恢复此值，无冲突）。
- **session3d.js**：同设 solver 两字段（3D 约束无 creep opts → relax no-op，只吃阻尼）。
- 验收：lab 下 84+ 测试全绿、solve 六基线逐位一致、smoke PASS；bio 会话
  `solver.damping===0.92 && viscoelastic===true`、edge 约束 creepK>0 且 hardenK>0、
  lattice creepK>0 且 hardenK===0（solve-bio 首条断言）。

## T2 · 亚临界阻尼

- bio 档 `damping 0.92`。**（偏离 Planner 原型 0.88）**：0.88 下 L2 目标二作者解仅 63.4
  过不了 72 cutoff（欠阻尼下按住塑形的净位移被回振吃掉）；0.92 拉到 72–74，且振铃指标
  同样达标（拉住 +100px 释放：过零 0、果冻振铃 0.62s 止息、reach 无损）。已在 themes.js
  注释记录取值理由。

## T3 · 膜粘弹性：SLS 蠕变 + J 形硬化（核心 · xpbd.js）

- `DistanceConstraint.relax(ps, dt)`（Solver.step 末尾整帧一次，非每子步；无 relax 的
  AreaConstraint2D/AnchorConstraint 自动跳过）：
  `d(rest) = creepK·(len−rest) − recoverK·(rest−rest0)`，应变死区 creepOnset
  （`|len/rest0−1| ≤ onset` 时只回复不蠕变），rest 硬夹取 `[restLo,restHi]×rest0`。
- `solve()` J 形硬化：`hardenK` 存在时 `effComp = compliance/(1+hardenK·excess²)`，
  `excess = max(0, len/rest − 1 − hardenOnset)`；`hardenK=0` 走**原样**柔度路径（lab 逐位）。
- bio 参数：creepK 0.5 / recoverK 0.3 / creepOnset 0.02 / restLo 0.7 / restHi 1.5 /
  hardenK 4 / hardenOnset 0.15（recoverK 由原型 0.15 上调到 0.3，让释放 8s 残余从 24% 降到
  12%，避免读作永久塑形）。

## T4 · 搏动性失血（session2d.js，纯会话层）

- `drainEvents` 见 `'deflate'`（且 bio pulse+bleed 档在）→ `startBleed`：把每个正在泄压的
  island 的 `pressureGoal` 抬回切前水平，再分 **N=4 跳**按权重 4:3:2:1 走回同一终值
  （早搏出血最多）；引擎 0.04 slew 软化每个台阶，终态 = 原平滑 slew 终值。
- `updateBleeds`：每个心搏收缩相（脉搏相位过 sin 峰 0.25）下调一档 + `bleedJet` 喷一股血滴
  （复用 `spawnJet`，新增 `intensity` 参数按台阶幅度递减；`intensity=1` 与原喷流逐位一致），
  血滴锚点跟随断口游离端。与既有 unpulse/applyPulse「还原-叠加」模式共存（bleed 操作的是
  pressureGoal 基准本身）。lab 无 pulse、无 bleedCfg → 一步不跑。

## T5 · 新测试（tests/solve-bio.test.js · 7 条）

- 复刻 solve.test.js 的 authorSolve，从 `THEMES.bio.fx.physics` 取档（单一数据源）注入。
- 接线断言（solver 吃档、edge 带 creep+harden、lattice 只 creep、rest0=rest、lab 归零）+
  L1/L2/L3 各目标 bio 物理下过 cutoff（保留 L2-2 lazy `<cutoff−4` 负向门）+
  暴力稳定性（3 点随机 1200px 拖拽 600 帧粒子全 finite 且 |·|<6000；恒拉 5s 后每条带
  creep 的 rest ∈ [restLo,restHi]×rest0）。
- 达标全靠**调档（themes.js physics）+ 每目标节奏**，未动任何关卡/cutoff。

## 四项力学探针 · 改造前后对比（同款探针 phys-probe.mjs）

| 指标 | 改造前（lab / 假） | 改造后（bio / 真） | 判据 |
|---|---|---|---|
| 蠕变（恒力 5s 位移再增） | **−10.6%**（纯弹性，反而回缩） | **+22.5%**（组织流动） | ≥ +8% ✅ |
| 释放 8s 残余 | 0.2% | 11.8%（非永久塑形） | ≤15% ✅ |
| 振铃（+100px 释放过零） | 2 次 / 果冻回摆止息 2.65s | **0 次 / 0.62s 止息** | ≤2、快速定形 ✅ |
| reach（拉 +400px 上限） | 312px | 326px（无损） | ≥270 ✅ |
| 非线性 F(1.1)/F(1.5)/F(2.0) | **1.0 / 5.0 / 10.0（线性）** | **1.0 / 6.4 / 24.4（J 形）** | F(2.0)/F(1.1)≥20 ✅ |
| 低应变(1.01×)割线力 | 0.015304px | 0.015304px（与 lab 逐位一致） | 死区内不硬化 ✅ |
| 失血台阶 | 0 台阶 / 1 股喷血 / 平滑指数 | **3 台阶 / 5 股搏动喷血** | ≥3 台阶 ✅ |
| 失血终态偏差 | 0%（vs 纯 slew） | 0.00%（终值不变） | ≤2% ✅ |

## 遗留（留后轮）

- 肌肉主动收缩动态（力-长度特性、缓慢发力）——本轮 pipeStyles 覆盖表已接好但为空。
- 组织撕裂（过度拉伸局部撕开，宪章列为高风险可选）。
- 迟滞回环的显式量化（当前 creep+harden 已产生迟滞，但未单列探针）。
