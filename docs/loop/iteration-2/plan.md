# 第 2 轮 · plan.md —— 主题：「把切割做成事件」

（完整版由 Planner 产出、协调者转交 Generator 执行；此为存档摘要。）

- T1 短命粒子层 effects.js + 事件坐标 payload + 拒刀刀口刮痕反馈（miss/rejected 路径禁止新增事件类型——cut2d.test 全量 deepEqual）。
- T2 WebAudio 工业音效 sfx.js：hiss/snip/twang/crack/chime/thud；AudioContext 用户手势内懒创建 + try/catch 兜底（防炸 smoke）；禁节律声/循环声。
- T3 泄压塌陷 0.4s 缓降（recomputePressure→pressureGoal，update 每步 8% 逼近；初建立即到位）+ 褶皱/凹陷对比度翻倍 + 泄压降饱和。
- T4 工作台锚定：空闲缓回中（仅无抓取/图钉时统一平移全体粒子——物理等价、评分平移不变）+ 四角卡爪定位框视觉。
- T5 软锁检测（topologyOk 连续 5s false 且拓扑不可恢复→toast）+ 首次越线教学 + L2 提示 t:40→20。

不许动：几何/cutoff/相似度/切割几何/PIPE_STYLES/render3d/HUD 布局；硬门与红线同宪章。
