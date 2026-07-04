# 生物物理循环 第 2 轮 Changelog（Generator）—— 「主动肌肉」

本轮专攻宪章评分第 4 项**肌肉行为**：把 contractile 脉管从"死弹簧"改成有
**主动收缩动态**的肌束——张力随长度变化（力-长度特性）、缓慢发力（强直上升）、
剪断后失神经瘫软。沿用材质档案铁律：新物理是**默认关闭的可选特性**，由
`THEMES.bio.fx.physics.pipeStyles.contractile.active`（单一数据源）在会话层激活。
lab 主题无此键 → 引擎 `_act=null、actSoftK=0`，**逐位不变**。关卡数据 / cutoff /
相似度 / 既有测试断言 / lab 主题与 lab 物理路径**一律未改**（新测试只增不改）。

## 硬门结果

1. `node --test 'tests/**/*.test.js'` **104/104 全绿**（97 → +6 muscle.test.js +1 solve-bio）。
2. solve 六基线（lab 物理）**逐位一致**：
   `87.685980 / 81.138015 / 87.293848 / 50.475188 / 78.903977 / 90.469726`。
3. `node tests/e2e/smoke.mjs` → **SMOKE PASS**（默认 lab，6 关全跑、拖拽/切割/胜负流程）。
4. solve-bio（bio 物理下作者解过各关 cutoff）**8/8 全绿**：L3-1「摊平的肌片」
   顶着主动肌腱仍达 **94.13（≥85 地板；第 1 轮被动 89.55 → 本轮主动 94.13）**。
5. bio 端到端集成核对（bioint 探针）：切断肌腱 → 两段失神经瘫软 + 近端痉挛反冲、
   完整肌腱续拉、300 帧无 NaN。

## 肌肉数学（activation 态）

每帧一次（`body.update()` 末尾，dt=1/60，与会话定步同一时钟）：

```
s     = len / rest0c                                  (对收缩静息长的应变)
aStar = den ? 0 : clamp(1 − flK·max(0, s−1), flMin, 1) (力-长度：过拉发不出力)
a    += (aStar − a) · min(1, riseK·dt)                 (强直上升 τ≈1/riseK)
rest  = rest0c·(slack − a·(slack−1))  夹在 [rest0c, slack·rest0c]
```

solve() 活性软化守卫（放在 hardenK 分支之后）：
`if (this.actSoftK) compliance *= (1 + this.actSoftK·(1 − this._act.a));`
`actSoftK=0`（lab 与全部被动约束）走**原样算术** → 逐位一致。

- **定参**（themes.js）：`riseK 2.0 / flK 1.2 / flMin 0.35 / softK 1.5`；
  `slack = 1/restFactor` 由 addPipe 现算注入。L3 肌腱 restFactor=0.55（关卡数据，未改）
  → **slack = 1.818 ≈ 1.82**（与 plan 验收数一致；PIPE_STYLES.contractile 缺省 0.58 未动）。

## T1 · 引擎（src/engine/xpbd.js）

- **DistanceConstraint** 构造：`opts.active` 存在时建
  `this._act = { rest0c:rest, slack, a:1, den:false, riseK, flK, flMin }`、
  `this.actSoftK = opts.active.softK ?? 0`；缺省 `_act=null、actSoftK=0`。既有位置签名不变。
- **新方法 updateActivation(ps, dt)**：`if(!this._act) return;` 后执行上述数学，
  写 `this.rest`，rest 硬夹 `[rest0c, slack·rest0c]`。（签名带 ps，与 relax(ps,dt) 一致；
  plan 速记 `updateActivation(1/60)` 实需粒子坐标算 len。）
- **solve() 守卫**如上。Solver 不改。
- 验收：lab 构造的任何约束 `_act===null && actSoftK===0`；`actSoftK=0` 时 solve() 与原版
  逐位一致（muscle③b：a=1 solve 与被动弹簧位逐位相等）。

## T2 · 接线 + 失神经（src/engine/softbody2d.js + src/game/themes.js）

- **addPipe**：`style.active` 存在时组 `actOpts = { active: { ...style.active, slack: 1/restFactor } }`，
  透传给 seg 约束、`buildPipeTie` 的 tieC、`buildPipeBends` 的 bendCs（三处 `new DistanceConstraint`
  补 opts）。contractile 的 bendCompliance=null 本就无 bend，故 bendCs 透传实际不产约束，但保留
  以泛化。`pipe.actOpts` 存于 pipe 对象，供 mkPipe(`{...pipe}`) 切割重建时继承。
- **body.update() 末尾活性 pass**：`for(pipe) if(!pipe.props.active||!pipe.alive) continue;`
  逐 seg/tie/bend 约束 `updateActivation(this.ps, 1/60)`。lab 管 `props.active===undefined` →
  整段跳过、零写入（muscle④：lab update() 前后粒子坐标 diff **0**）。
- **severPipeSegment 失神经**：切出的 contractile 片段（mkPipe 两个新管 + 环转开链自身）
  经 `denervatePipe()` 把 seg/tie/bend 约束 `_act.den=true` → 远端瘫软（a→0、rest→slack·rest0c、
  柔度×(1+softK)=2.5）；近端痉挛沿用 session2d 既有 cableRecoil。
- **renderState().pipes 增 activation 字段**：seg 约束 `_act.a` 均值，无 `_act` 为 null。
- 验收：bio L3 seg 约束 `_act` 存在且 slack≈1.818；lab 下 null。

## T3 · 手感浮现（src/render/render2d.js + src/game/session2d.js）

- **drawPipes 活性染色**：`pipe.activation != null` 时整根按 `pipeActivationColor(activation)`
  上色——高活性（收缩）偏红亮、失神经（a→0）褪灰白弛缓；16 档量化缓存、端点由 palette
  pipe 基色现算。lab（activation===null）走**原 pipeStrainColor 逐位不变**。
- **cableRecoil 痉挛可见度**：会话层 `recoilTip/recoilCap` = bio 260/290、lab **220/250**
  （从 phys 存在与否分支，lab 保持原常数逐位不变）。先反冲冲量、后失神经弛缓，时序自然衔接。
- **themes.js 定参**如上，附探针数字注释。

## T4 · 测试（tests/muscle.test.js · 6 条 + solve-bio 扩 1 条）

- **muscle.test.js**（从 `THEMES.bio.fx.physics` 取档，单一数据源）：
  ①强直上升沿（首帧 da=riseK·dt、0.5s 后 a≈0.63、rest 单调迁移、满收缩 rest→rest0c）；
  ②力-长度（s=1.8 稳态 a=0.35≤0.4，收敛到 aStar；对照 s≈1 满发力）；
  ③失神经（den 后 a→0、rest→slack·rest0c）；③b 活性软化（a=1 solve 与被动逐位一致、a→0 拉动更弱）；
  ④lab 逐位（lab contractile `_act===null、actSoftK===0`、renderState activation=null、
  update() 坐标 diff 0）；④b bio 接线（seg `_act` 在、slack≈1.818、rest0c=rest0、暴露 activation）。
- **solve-bio 扩**：L3-1 显式 ≥85 回归地板；新增 bio L3 主动肌肉暴力稳定性
  （3 点 1200px 拖拽 600 帧含活性 pass 不 NaN、肌腱 rest ∈ [rest0c, slack·rest0c]）。

## 肌肉行为探针数字

| 指标 | 数值 | 判据 |
|---|---|---|
| 强直上升沿（恒拉 a 从 0） | 首帧 da=0.0333=riseK·dt · 0.5s a=0.638 · rest 100→单调降 | ~2/s、单调 ✅ |
| 力-长度 s=1.8 稳态 | a=0.350（=flMin，过拉发不出力） | ≤0.4 ✅ |
| 力-长度 s≈1 稳态 | a>0.98（满发力） | 对照 ✅ |
| 失神经 den 后 | a: 1.000→0.000 · rest: 100→172.41=slack·rest0c | a→0、rest→slack ✅ |
| bio L3 肌腱 slack | 1.818（=1/0.55） | ≈1.82 ✅ |
| bio L3-1 作者解 | 89.55（第 1 轮被动）→ **94.13**（本轮主动） | ≥85 ✅ |
| 切肌腱端到端 | 2 段失神经 a→0.000/rest→slackRest、完整肌腱续拉 a=0.35、无 NaN | 剪断释放自然 ✅ |

## 砍除项（plan 已证伪，引用证据）

- **自由拖拽粘滞（dashpot）**：刚体平移下 dashpot 无效、惯性打穿 L2-2 硬门 —— plan.md 证伪。
- **J 锁死（大变形不锁死）**：细丝来自面积保积变细而非约束伸长，J 硬化参数对该现象无效 ——
  plan.md 证伪。

## 遗留（留后轮）

- 组织撕裂（过度拉伸局部撕开，宪章列为高风险可选）。
- 迟滞回环显式量化（creep+harden 已产生迟滞，未单列探针）。
- 主动肌肉的自主节律收缩（当前 activation 只对被动拉伸的力-长度反应，无自发搏动）。
