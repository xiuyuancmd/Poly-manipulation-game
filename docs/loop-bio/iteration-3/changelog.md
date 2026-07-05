# 生物物理循环 第 3 轮 Changelog（冲刺轮 · Generator）—— 「肌肉动态范围」

本轮唯一目标 = 补 iteration-2/evaluation.md「剩余差距」第 1、2 条：**把肌肉的动态范围
在 L3 实战里打出来**。终评病灶：L3 肌腱被板材刚度恒拉在 s≈1.8，activation 卡在力-长度
地板 flMin=0.35；拉平前后活性仅 0.377→0.351，颜色几乎不变（同一量化桶，RGB 差=0）。

处方（只调**表现/档案**，引擎数学、关卡数据、lab 主题、既有测试断言一律未动）：
1. `themes.js` 的 bio 物理档案 `pipeStyles.contractile.active`：`flMin 0.35→0.12`、`softK 1.5→2.5`；
2. `render2d.js` 的 `makeActivationRamp`（bio 收缩肌染色 ramp，lab activation=null 不走此路径）：
   16 桶线性 → 32 桶 + 凹伽马 `t=a^0.6`，并加宽 slack/hot 端点对比。

## 探针前后对比（终评场景：L3 settle → 钉两端拉平 5s → 解钉 10s）

| 指标 | 调参前(flMin0.35/softK1.5/16桶线性) | 调参后(flMin0.12/softK2.5/32桶 a^0.6) |
|---|---|---|
| 拉平前活性（settled a） | 0.4015 | 0.3255 |
| 拉平后活性（flat a） | 0.3500 | 0.1713 |
| **拉平前后活性差** | **0.0515** | **0.1542**（×3 摆幅） |
| **settled↔flat 染色 RGB 差** | **0**（[225,140,147] 同桶） | **20**（[233,123,130]红 ↔ [225,141,147]淡） |
| 解钉 10s 后活性（松弛） | 0.35 | 0.1274，染色 [223,148,153] 更淡 |
| 解钉 10s aspect（宽/高） | 1.838→1.886 | 1.914→2.039 |
| solve-bio L3-1 作者解 | 94.13 | **94.68**（≥85 地板，升不降） |

结论：**力-长度"褪色"现在肉眼可见了**——被拉平时肌腱明显褪成淡肉色、settle 回弹时
泛红收紧，染色梯度贯穿 settled→flat→松弛三态（红→中→淡，RGB 距 0→20）。动态范围
（活性摆幅）×3。lower flMin + higher softK 让过牵肌腱更"松劲/更软"，反而**更易绷平**，
故 L3-1 分数升不降。

## "收缩赢一次"（招牌折弯）—— 探针证伪，未强行交付

处方方向 2 想让解钉后肌腱把板材拉回可见弯折（aspect 明显下降）。探针实测：**任何参数组合
下 aspect 都不降反升**（调参后 flat 1.914 → 解钉 10s 2.039，即松手后板材回弹更平）。根因：
- L3 收缩肌的 `compliance` 被**关卡数据**在 `level03.js` 覆盖为 `1.2e-4`（`pd.overrides` 在
  样式合并里最后生效，压过主题 `pipeStyles.contractile.compliance`）——处方提的"档案覆盖
  compliance 增强收缩力"**到不了 L3**，而关卡数据禁改；
- 既有测试②（`s=1.8 稳态 a≤0.4`）把过牵活性硬性封顶 ≤0.4 ⇒ `flMin≤0.4 且 flK≥0.75`，
  肌肉在满牵态发不出足以对抗板材弯曲刚度 + 膜蠕变重塑的力。

在"引擎数学/关卡数据不许动"的铁律下，"折弯赢一次"无法靠调参兑现，**不带病上线**。但松手后
肌腱**可见地褪色瘫软**（[223,148,153] 淡肉色）已是真实的"失力"信号，非静态死粉。

## 硬门结果

1. `node --test tests/*.test.js` **104/104 全绿**（本轮无新增测试，既有断言全部适配读档，未改）。
   注：`npm test`（`node --test tests/`）在本机 Node 22.22 下把 `tests/` 当模块解析报错——
   **既有环境怪癖，非本轮引入**；规范跑法 `tests/*.test.js` 104 绿。
2. solve 六基线（lab 物理，独立复算）**逐位一致**：
   `87.685980 / 81.138015 / 87.293848 / 50.475188 / 78.903977 / 90.469726`。
3. `node tests/e2e/smoke.mjs` → **SMOKE PASS**。
4. solve-bio **8/8 全绿**：L3-1「摊平的肌片」**94.68 ≥ 85**（升不降）。
5. lab 逐位不变：activation ramp 改动只在 `activation != null`（bio 收缩肌）路径生效；
   themes.test.js 的 `applyPalette` COLORS 往返、muscle.test.js ④ lab `_act=null` 逐位断言全绿。

## 最终参数

```
THEMES.bio.fx.physics.pipeStyles.contractile.active = { riseK: 2.0, flK: 1.2, flMin: 0.12, softK: 2.5 }
render2d makeActivationRamp: N=32, t=pow(a,0.6),
  slack=[base·0.42+216·0.58, base·0.38+206·0.62, base·0.38+204·0.62]  (更淡的松弛端)
  hot  =[min(255,base+60), base·0.48, base·0.52]                      (更深的收缩红)
```

（riseK 保持 2.0：既有测试① `0.5s 后 a<0.72` 把 riseK 封在 ≤2.5，且 activation 卡在地板时
提高上升率无助，故不冒险动它。）
