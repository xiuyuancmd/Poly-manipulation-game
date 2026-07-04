# 第 3 轮 Changelog（Generator）

引擎零改动：`src/engine/` 全目录一行未碰。所有改动在会话层（session2d）、表现层
（render2d / render3d / effects / hud / styles）与 L4–L6 关卡数据的点名数字内。

## T1 · 夹具实体化 + 空闲回正旋转（session2d.js / render2d.js）

- **rotateHome()**：构造时快照 restPose（settle 后全体存活粒子），step() 末尾在
  「无抓取、无图钉、单岛」门控下做 2D Kabsch，算出残余转角 θ；死区 |θ|<0.01 rad，
  否则绕当前质心统一旋转 x/y 与 px/py 回正。
  *与计划的偏差①*：回转速率 = max(20°/s, 0.7·|θ|/s)。固定 20°/s 上限从 180° 回正
  需 9 s，计划自身的验收（≤5 s）在乱拖卷到 >100° 时数学上不可满足；近零区仍是
  20°/s 缓滑，clamp 到 |θ| 保证无过冲。
- **despin()**（计划外，但为 T1 验收所必需）：顺序求解器会给带压载荷的试件持续
  泵入角动量——纯引擎实测 L2/L4/L5 静置时整体自旋 50–120°/s（第 1、2 轮截图里
  「管路飘走/转位」的真正根源）。会话层在同一门控下减去质心系净刚体角速度场：
  变形速度分量与约束残差完全不受影响，相似度对旋转不变——与平移回中同级惰性。
- **derotate()**（计划外，同因）：settle(150) 的整定瞬态本身就会把整个试件转走
  几十度（L5 实测 ~40°），导致活体与 HUD 预览图方向对不上。构造时快照 settle 前
  的作者姿态，settle 后做一次 Kabsch 整体回转。纯位置刚体旋转，物理/分数惰性。
- **夹具（drawClampFrame）**：四角 L 夹块双线描边（外 3px + 内 1px）+ 每角 2 条
  咬向试件的短齿；restBBox 正下方 5px 钢灰工作台横带（alpha 0.22）；台带与试件
  间静态椭圆接触投影（宽 = bbox 的 0.7 倍，alpha 0.12，画在 body 之下）。
  全部由 restBBox/anchor 决定，纯静态。
- *与计划的偏差②*：T3 注速与本引擎的速度载体——本求解器 px/py 在每个子步开头
  被覆写，计划中的「px/py -= v/60」是空操作；实际速度存于 vx/vy，故一切注速/
  去旋都写 vx/vy。语义相同，机制修正。

**验收**：临时 Playwright 脚本（scratchpad，不入库）乱拖 L1 松手——释放时
θ=−15.2°、偏移 101px → 5 s 后 θ=−0.25°、偏移 0.5px；7→8 s 最大粒子位移
0.646px（亚像素蠕变为引擎既有阻尼尾巴，Node 纯机制探针为 0.0000px）。
更狠的甩到 −104° 的用例 5 s 后 θ=0.46°。
L4/L5 静置 10 s：θ≤0.6°，气环外露 0px，管路纹丝不动（despin 前：整体 1–2 rad/s
自旋、环外露 25–30px）。

## T2 · 泄压喷流做满 + 泄压哑光加档（effects.js / render2d.js）

- deflate：首帧爆发 8–10 粒 + 0.45 s 发射器（rate 150 粒/s×dt，每帧 2–3 粒），
  发射逻辑在老化循环之前（update(1.0) 大步内新粒子同步过期）；锥角 ±0.45 rad、
  初速 130–290 px/s、粒子寿命 ≤0.65 s。粒子渲染改为 2px 拖尾线段
  (x,y)→(x−vx·0.035, y−vy·0.035)。
- PRESSURE_TINTS 降饱和 (i/3)·0.08 → (i/3)·0.16；drawWetHighlight 增加 pressure
  参数，p<1 时高光 alpha 线性打折至 ×0.5（p≤0.8 封底），色串走量化缓存
  （0.01 步进，预生成后零字符串churn）。
- *与计划的偏差③*：effects.test 原断言 `sparks.length >= 18`（旧爆发 12–18 粒）
  按新模型改为 `>= 14`（爆发 8–10 + 碎屑 6–10）；计划点名保护的断言
  （update(0.1)+update(1.0) 后 active===false、坐标有限、空 draw 零调用）原样通过。
  新增 2 个用例：发射器生命周期、回甩残影生命周期。

**验收**：L2 切环 0.2s / 0.5s 截图（action-l2-jet-*.png）可见沿泄口方向的锥形
拖尾喷流，0.5s 时发射器仍在补粒；1.7s 截图画面彻底静止。

## T3 · 缆线剪断回甩（session2d.js / effects.js）

- drainEvents() 改写：遍历 `pipeCut && pipeType==='contractile'` 事件，在存活
  contractile 碎段中找端点距切口 <40px 的（至多 2 段），对每段靠切口端 3–4 个
  管路粒子沿「远离切口的链向切线」注速（端粒 220 px/s 衰减到 60 px/s，单粒
  合速度 ≤250 px/s，只碰管路粒子）；同帧把碎段折线快照传 spawnWhip()。
- spawnWhip()：0.3 s 渐隐、线宽 3→1 渐细的残影折线，计入 active。

**验收**：Node 探针（L3 剪上缆）：事件同帧 spawnWhip×2、端粒 220 px/s，4 s 后
最大速度 9.3 px/s 且持续衰减、坐标全有限、effects 归零。截图
action-l3-whip.png / action-l3-settled.png：碎段回缩卷曲后稳定，无震荡。

## T4 · L6 引导 + 拓扑警告强化 + L4/L5 越界清理

- level06：intro 加「读数先别急。」；目标一 hint 改为解释 25% 压读数 + 按 2 切割。
- hud.js：#topo-warn 文案『⚠ 管路结构不符 · 读数被压至 25%』；setScore 跟踪上帧
  topologyOk，true/undefined→false 跳变瞬间加一次性 .flash（styles.css 中
  topo-flash 1.05 s 闪 3 次即止，animation-iteration-count:1，animationend 移除）。
- level04：pressure 环 (CX+48,CY+48,30)→(CX+38,CY+38,28)；目标一 ghost 环
  (…54,37)→(…44,34)；目标二/三 arc (…52,33)→(…42,31)。
- level05：pressure 环 (CX−45,CY+45,30)→(CX−36,CY+36,28)；目标一 ghost 环
  (…−50,37)→(…−41,34)；目标二 arc (CX−48,CY+42,32)→(CX−39,CY+33,30)；
  目标三/四 ghost 未动。cutoff/weights/_expectFactor/timeLimit/本体 outline 全未动。
- levels.test.js 新增静息包含审计（settle 后管路粒子须在存活岛内，边界容差 3px）。
  *与计划的偏差④*：审计收窄到 **pressure 环**——L3 缆线（12.9px）与 L4 脆撑
  （10.3px）在**旧几何下就外露**（纯引擎复测确认），而它们的 path 不在本轮许改
  清单内；pressure 审计五关全绿，锁住本轮修复。

**验收**：level4.png / level5.png：充气环整环在体内，且（derotate 后）管路布局
与 HUD 预览图方向一致——此前 L4/L5 活体相对预览图整体转了 40–90°。

## T5 · 3D 一层材质（仅 render3d.js）

- WeakMap 按 body 缓存边→rest 查找表（来自 body.edgeCs）；每帧 per-face 三边
  应变均值 >1.03 起向白插值（本地 24 档量化 ramp，render2d 导出未动）。
- 管道改逐段着色：casing 暗色底线（6.5px）+ segCs 逐段应变泛白（4.5px），与 2D
  管路同一语言。不加粒子、不加投影、不动相机。

**验收**：smoke L6 零 console error；action-l6-press-whiten.png：剪斜撑后下压，
受拉面明显泛白；action-l6-rest.png 静息帧无任何变化。

## T6（可选项，已做）

拒刀小字 12→14px、驻留 0.9→1.05 s（<1.1 s 测试上限）；刮痕 0.5 s 生命内叠
±2px 确定性正弦衰减偏移（纯 age 函数，非随机）。未做：读数 gamma 拉伸（按计划）。

## 硬门数字

- `node --test 'tests/**/*.test.js'`：**69 pass / 0 fail**（62 原有 + 2 effects
  + 5 包含审计）。
- solve 基线（开工 = 收工，**逐位一致**）：87.685980 / 81.138015 / 87.293848 /
  LAZY 50.475188 / 78.903977 / 90.469726。
- `SHOT_DIR=docs/loop/iteration-3/shots node tests/e2e/smoke.mjs`：**SMOKE PASS**，
  全部关键截图已人工过目（结论见各任务验收段）。

## 没做 / 遗留

- L4 脆性斜撑静息外露 ~10px、L3 缆线外露 ~13px：作者几何问题，path 不在本轮
  许改清单，建议下轮点名收编。
- 3D 关无工作台回中/去自旋：大力拖拽可把立方体拖出画面中心不回来
  （action-l6-released.png），本轮 T5 明确只许动 render3d.js，未处理。
- despin/rotateHome 只在单岛时生效：切开后的碎块仍可能带引擎自旋残留。
- 引擎自旋泵本源在顺序求解器（src/engine 不可动），会话层三件套
  （despin/derotate/rotateHome）只是把它在玩家可见层面彻底压住。
