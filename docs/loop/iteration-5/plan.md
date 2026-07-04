# 第 5 轮 · plan.md —— 主题：「份量与仪表」（收官轮：材质/手感/惊喜 8→8.5）

三项裁定：① 读数 gamma 走"表盘弧视觉映射拉伸 + 数字真值一位小数"（不做数字 pow，结构上杜绝欺骗感）；② L1 目标一 cutoff 80→78（对关卡铁律的点名单行豁免，solve/levels 断言余量均变宽）；③ 不动 HYSTERESIS/HOLD 等全局规则常数。

- T1 高光份量三连：碎屑亮色两色混（玻璃碎碴抓光）、火花 10–12 粒 w=3、残影 1+4f/alpha0.9；泄压喷流一切不动。新增 effects-visibility.test。
- T2 仪表化读数：src/ui/dial.js（DIAL_GAMMA≈2.2 契约测试锁单调+不欺骗）、#ring-score gamma 刻度弧 + 达标刻度线（同一映射，弧过刻度⟺真值过线）、score-num 真值一位小数、「读数会跟着爬升」半句。
- T3 L1 目标一 cutoff: 78 单行。
- T4 L1 内部顶光径向渐变（随压强熄灭 poolGloss，p≤0.8 全灭；静置连拍逐像素一致核验）。
- T5 钉住态断口收容：containPipes 入槽门改"外向法向速度<30px/s"制 + 体内释放收紧（Planner 探针实测：原版 4.8–65px 振荡不收敛 → 补丁版 0.5s 起 0.000px；回甩豁免未破坏 716px/s）。

不许动：src/engine/；L2–L6 关卡文件；L1 除 cutoff 一行；game.js 除一句文案；规则常数；既有测试只加不改；泄压喷流参数。
硬门：75→≥78 pass 全绿；smoke PASS；solve 六基线逐位一致；零生物词；零闲时动画；changelog+commit+push。
预算：T1 12' → T2 20' → T3 5' → T4 13' → T5 10'；超时先砍 T5（附配方），绝不砍 T1/T2。
