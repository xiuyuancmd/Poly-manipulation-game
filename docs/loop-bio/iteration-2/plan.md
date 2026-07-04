# 生物物理循环 第 2 轮 · plan.md —— 主题：「主动肌肉」

判断：肌肉 3.0 是最大杠杆且探针证明安全（L3-1 solve-bio 89.5→91.6）；两个手感项证伪砍除（自由拖拽粘滞：刚体平移 dashpot 无效、惯性打穿 L2-2 硬门；J 锁死：细丝来自面积保积变细，参数无效——证据入档）。

肌肉数学（activation 态，默认关=lab 逐位不变，bio pipeStyles.contractile.active 激活）：
- s = len/rest0c；aStar = den?0 : clamp(1−flK·max(0,s−1), flMin, 1)（力-长度）；a += (aStar−a)·min(1,riseK·dt)（强直上升 τ≈0.5s）；rest = rest0c·(slack−a·(slack−1))；solve 守卫 effComp = comp·(1+softK·(1−a))。
- 定参：riseK 2.0 / flK 1.2 / flMin 0.35 / softK 1.5 / slack=1/restFactor。

- T1 xpbd：DistanceConstraint opts.active（_act 态）+ updateActivation(dt) + solve 活性软化守卫（actSoftK=0 原样）。
- T2 softbody2d：addPipe 透传 active 到 seg/tie/bend；body.update() 活性 pass（lab 无 props.active 整段跳过）；severPipeSegment 失神经（den=true→远端瘫软，近端沿用 cableRecoil 痉挛）；renderState 暴露 activation。themes.js 定参。
- T3 手感浮现：drawPipes 活性染色（收缩红亮、失神经灰白弛缓，bio-only）；痉挛可见度微调。
- T4 tests/muscle.test.js（强直上升/力-长度/失神经/lab 逐位四条）+ solve-bio L3-1 ≥85 维持 + 暴力稳定性扩展。

硬门：97+ 测试全绿、solve 六基线逐位一致、smoke PASS、solve-bio 全绿。
