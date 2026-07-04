# 第 1 轮 · Generator changelog

## 做了什么

### T1 · 红线文案清洗（完成）
- 六个关卡全部换成纯工程/质检语境，关卡名统一「试件 0N · XXX」：
  弹性标定 / 高压回路 / 预紧缆线 / 三通阀体 / 复合机构 / 立方充放（3D）。
- 目标名替换：橄榄→长轴椭圆坯、饱满的蛋→满压凸壳、马蹄→U 形槽、河豚→满充气罐。
- 所有 intro/hint/moreHints 逐条过了一遍：筋/肌肉→缆线，硬骨头/骨架→刚性撑杆/桁架，
  气袋→气囊，泄气→泄压（保留物理正当的「放气」表述），「脾气」→物性/材质，
  「身体/头顶/背」→试件/基体/顶部/弧顶，「第三只手」→第三个控制点，去掉「新朋友」等拟人。
- hud.js：粘合按钮 🩹→🔗；tagline 改为「一块物性未知的工程软材料」口径。
- game.js：失败语改「摸清每根管路的物性再来！」；snap toast「管子」→「管路」。
- 附带把 softbody2d/3d 引擎英文注释里的 tendon/muscle 全部换成 cable 术语（纯注释，零代码变动）。
- 验收：`grep -nE '肌|腱|骨|呼吸|皮|血|心跳|愈合|器官|脾气|朋友|蛋|河豚' src/` 零命中；
  英文 bio 词（tendon/muscle/bone…）同样零命中。
- **绝未改动**：任何几何坐标、cutoff、timeLimit、id、_expectFactor/_restBelow、目标顺序。

### T2 · 引擎导出力学读数（完成）
- `SoftBody2D.renderState()`：只读查询，返回
  islands[{points, edgeStrains}]（与环边序对齐）、
  pipes[{id, closed, deflated, points, segStrains, fill}]；
  fill = clamp(|currentArea|/targetArea, 0, 1.5)（有符号面积取绝对值），无 areaC 时为 null。
- 新增 tests/readouts.test.js 4 项：应变有限且在 (0.5,2.0)、压力环 fill 在 (0.5,1.2)、
  severPipeSegment 后 deflated===true 且 fill===null、renderState 为纯查询（不加约束不发事件）。

### T3 · render2d 材质分层渲染（完成，本轮核心）
drawBody 重写为六层管线（顺序即图层）：
1. 半透基体填充（alpha 0.60，硅胶浇注件；金色幽灵透过身体可见，可读性反而变好）；
2. 嵌入式管路：全部同一基色 #aab6c6 + 深色「孔道」衬底；每段颜色按 segStrains 应力泛白
   （strain 1.02→1.45 向白插值，量化 24 档缓存颜色串防 GC churn）；
3. 基体罩光（alpha 0.20 本体色盖在管路上，管路读作「嵌在材料里面」）；
4. 边界逐段描边：edgeStrains>1.01 受拉泛白（1.01→1.12 插值）；<0.97 在内侧画 2–3 根
   垂直于边的短褶皱刻线（相位由边索引决定，零随机数，不闪烁）；
5. 湿润高光：外法线朝固定光源 (-0.6,-0.8) 的边界段，内侧偏移 2.6px 细亮线，
   透明度随朝向和应变微增；
6. 抓取凹陷：被抓粒子处 30px 径向渐变暗斑 + 拉力反侧小亮弧，clip 在本体内不外溢；
   图钉样式原样保留。
- 无 ctx.filter/阴影模糊；全部是当前物理状态的纯函数（静止零动画）；
- render3d 只 import bg/grid/ghostStroke/pipe/pin/grab，全部未改值，3D 关截图确认无异样；
- drawTargetPreview 未动。

## 截图检查结论（亲自看图）
- shots/level1–6.png：六关零 console error。L1 半透基体 + 管路嵌入感 + 逐边描边成立；
  L2 充压态整圈边界泛白 + 湿润高光，读作绷紧的膜，物理正当；
  L3 两条预紧缆线因真实张力泛白绷直、被拽弯的板下缘受拉泛白——「可观察差异只来自力学状态」达成；
  L6（3D）与改动前一致。
- shots/level1-drag.png：拖拽中可见抓点凹陷暗斑与受拉侧泛白。
- shots/level2-deflated.png：切断压力环后整体松垮、边界出现压缩褶皱刻线与不均匀描边，泄压感成立。
- 遗留观察（供 Evaluator/下轮）：L4/L5 静息态压力环会顶出边界一小截（改动前物理即如此，
  本轮不许动物理参数，未处理）；褶皱刻线在缩略截图下偏含蓄，可下轮加强对比度。

## 没做什么、为什么
- 未动任何物理数值/相似度/切割/粘合算法/render3d——plan 明令禁止。
- 未做音效、HUD 仪器风、切割粒子——不在本轮任务内。
- 抓取凹陷由渲染层直接读 session.grabs，引擎不管（按 plan）。

## 硬门
- `node --test 'tests/**/*.test.js'`：57/57 全绿（53 旧 + 4 新 readouts）。
- `node tests/e2e/smoke.mjs`：PASS（6 关加载、拖拽响应、切割、胜负流程，零 console error）。
- push：见下方 commit 记录（403 已知问题时不阻塞）。
