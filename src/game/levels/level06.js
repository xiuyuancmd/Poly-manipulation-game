// 第 6 关 · 立方充放（3D）：软立方体里一根沿体对角线的刚性斜撑。
// 不剪断它，立方体永远压不成板砖；剪断之后再拔成方柱。
// 3D 关操作：拖拽/双击钉住表面顶点，切割工具点击管路剪断；拖空白处旋转视角。

const S = 220; // cube edge

export default {
  id: 'L6',
  name: '试件 06 · 立方充放',
  dim: 3,
  timeLimit: 240,
  cutoff: 78,
  intro: '拖动顶点感受它的弹性；拖住空白处可以转动视角。读数先别急。',
  body3d: { size: S, segments: 4, pressure: 1.0 },
  pipes3d: [
    { from: [-S / 2 + 8, -S / 2 + 8, -S / 2 + 8], to: [S / 2 - 8, S / 2 - 8, S / 2 - 8], count: 9 },
  ],
  targets: [
    {
      // Volume conserved: 320*104*320 ~ 220^3. The rigid diagonal strut makes
      // this pose impossible until it is snipped (chains 1 -> 2).
      name: '板砖',
      box: [320, 104, 320],
      pipes: [
        [{ x: -120, y: -30, z: -120 }, { x: -12, y: -6, z: -12 }],
        [{ x: 12, y: 6, z: 12 }, { x: 120, y: 30, z: 120 }],
      ],
      topology: { chains: 2, loops: 0 },
      weights: { outline: 0.8, pipes: 0.2 },
      hint: '开局读数只有十几分是正常的——斜撑没剪断，「管路结构不符」会把读数压到四分之一。按 2 换切割工具，对准斜撑点一下。',
      moreHints: [
        { t: 40, text: '换切割工具（按 2），对准那根斜撑点一下。' },
        { t: 85, text: '剪断后：钉住底面，抓顶面往下压扁，跟着虚线框走。' },
      ],
    },
    {
      name: '方柱',
      box: [160, 416, 160],
      pipes: [
        [{ x: -40, y: -170, z: -40 }, { x: -5, y: -15, z: -5 }],
        [{ x: 5, y: 15, z: 5 }, { x: 40, y: 170, z: 40 }],
      ],
      topology: { chains: 2, loops: 0 },
      weights: { outline: 0.8, pipes: 0.2 },
      hint: '钉住底面一角，抓住顶面往上拔。慢慢来。',
      moreHints: [
        { t: 45, text: '双击钉住底面两个角，抓顶面中心往上拔高。' },
        { t: 90, text: '拖空白处转个视角，检查四面是否都收窄了。' },
      ],
    },
  ],
};
