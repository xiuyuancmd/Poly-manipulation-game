# 生物物理循环 第 1 轮 · plan.md —— 主题：「粘弹性地基」

诊断实测（假在哪）：蠕变 −3%（纯弹性）；振铃过零 13 次/3.85s 定形（果冻）；恢复力比 1.0/5.0/10.0（完全线性）；失血平滑指数 0 台阶。

处方（原型已验证）：
- T1 材质档案接线：THEMES.bio.fx.physics 单一数据源（solver/body/pipeStyles/bleed），lab 无 physics 键→逐位不变；session2d/3d 读档并透传。
- T2 亚临界阻尼：bio damping 0.88（扫描数据：过零 2、0.6s 定形、reach 无损）。
- T3 膜粘弹性：DistanceConstraint 加 opts（creepK/recoverK/creepOnset/restLo/restHi/hardenK/hardenOnset）+ rest0 + relax(dt) SLS 迁移 + J 形硬化守卫；Solver.viscoelastic 开关。验收：蠕变 +8%/5s、残余 8s 内 ≤15%（不永久塑形）、F(2.0)/F(1.1) ≥20、低应变割线力与 lab 一致。
- T4 搏动性失血：会话层 bleed 调度——每个心搏收缩相阶梯下调 pressureGoal（N=4 跳、幅度随余压递减）+ 同步血滴喷发；终态与平滑 slew 终值差 ≤2%。验收：面积曲线 ≥3 个可辨台阶。
- T5 新测试：solve-bio（bio 档案可达性，共用 authorSolve）+ bio 暴力拖拽稳定性（10s 不 NaN、rest 夹取不 runaway）。

硬门：84+ 测试全绿、solve 六基线逐位一致、smoke PASS、solve-bio 绿。
不许动：关卡数据/cutoff/相似度/既有测试断言/lab 主题；引擎新物理默认关闭。
肌肉与撕裂留后轮。
