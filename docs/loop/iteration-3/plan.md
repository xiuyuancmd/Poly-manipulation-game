# 第 3 轮 · plan.md —— 主题：「夹具坐实，两个高光做满」

总原则：引擎全目录零改动（作者解测试混沌敏感）；开工先跑 solve 基线，收工逐位一致；零闲时动画。

- T1 夹具实体化（夹块双线+短齿、工作台横带、静态投影椭圆）+ 空闲回中同步缓回旋转（2D Kabsch，仅单岛时，20°/s，死区 0.01rad，x/y 与 px/py 同旋——物理与评分双惰性，只写会话层）。
- T2 泄压喷流做满：发射器 0.45s×150粒/s、拖尾线段渲染；泄压降饱和加倍 + 湿润高光随泄压变哑。
- T3 缆线剪断回甩：会话层对切口端 3-4 个管路粒子注速（≤250px/s，绝不碰边界/基体粒子）+ effects.spawnWhip 残影 0.3s；solve 免疫（不实例化 Session2D）。
- T4 L6 文案点破低读数 + topo-warn 文案强化与一次性 flash（禁 infinite）+ L4/L5 压力环几何内收（圆心到边界 ≥ 充气半径+8px）+ levels.test 新增静息管道包含审计。
- T5 3D 一层材质：面按边应变泛白、管道逐段应力着色 + casing 底线（只动 render3d.js）。
- T6（可选）拒刀反馈三常数。

不许动：src/engine/ 全目录、L1–L3 关卡数据、cutoff/weights/timeLimit/_expectFactor/本体 outline、PIPE_STYLES、pressureSlew、sfx 音色、HUD 布局。
硬门与红线同宪章；砍尾不砍头 T1→T6。
