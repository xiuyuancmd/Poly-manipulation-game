// 第 3 关 · 预紧缆线：两条预紧缆线把板材拽弯。先跟拉力较劲摆平板，
// 再顺着缆线的拉力对折试件，用粘合固定折痕。剪断缆线会让第二个目标报废。
import { roundedRect, uShape, line } from './shapes.js';

const CX = 360, CY = 330;

export default {
  id: 'L3',
  name: '试件 03 · 预紧缆线',
  dim: 2,
  timeLimit: 240,
  cutoff: 85,
  intro: '试件总是蜷着……内部好像有两条缆线在收紧。',
  body: {
    outline: roundedRect(CX, CY, 300, 150, 30),
    edgeLen: 16,
    basePressure: 1.0,
    // Softer shear web + stiffer boundary bending: wrinkling the surface costs
    // more than curving globally, so the cables fold the slab instead of
    // ruching its top edge.
    lattice: { strides: [0.5], compliance: 1.6e-3 },
    bendCompliance: 2e-4,
  },
  // Two "bowstring" cables spanning the slab's full width. A shortened
  // bowstring pulls the slab's ends together, so it buckles into a C — edge
  // lengths stay intact, which a surface-hugging cable could never achieve.
  // Both cables sit in the TOP half: asymmetric tension folds the slab
  // into a C (symmetric cables would just bulge it into a barrel).
  pipes: [
    { path: line(CX - 128, CY - 45, CX + 128, CY - 45, 10), type: 'contractile', overrides: { restFactor: 0.55, compliance: 1.2e-4 } },
    { path: line(CX - 130, CY - 12, CX + 130, CY - 12, 10), type: 'contractile', overrides: { restFactor: 0.55, compliance: 1.2e-4 } },
  ],
  targets: [
    {
      name: '平板',
      _expectFactor: 1.0,
      _restBelow: 76,
      outlines: [roundedRect(CX, CY, 310, 145, 28)],
      pipes: [
        { points: line(CX - 120, CY - 45, CX + 120, CY - 45, 8), closed: false },
        { points: line(CX - 122, CY - 12, CX + 122, CY - 12, 8), closed: false },
      ],
      hint: '两条缆线在把两端往一起拽。把两端钉远一点，板材就绷平了。',
      moreHints: [
        { t: 45, text: '双击钉住左端（拉开些），再钉住右端，试件就绷直了。' },
        { t: 90, text: '还差一点？用第三个控制点把鼓起的区域往下抹平。千万别切缆线——后面有用。' },
      ],
    },
    {
      name: 'U 形槽',
      _expectFactor: 0.56,
      _foldTarget: true,
      _restBelow: 76,
      cutoff: 82,
      outlines: [uShape(CX, CY, 190, 185, 80, 110)],
      pipes: [
        { points: line(CX - 55, CY - 60, CX + 55, CY - 55, 6), closed: false },
        { points: line(CX - 60, CY - 20, CX + 60, CY - 15, 6), closed: false },
      ],
      weights: { outline: 0.75, pipes: 0.25 },
      hint: '顺着缆线的拉力把试件对折，捏拢两端，再用粘合固定。要是缆线断了……只能重开。',
      moreHints: [
        { t: 45, text: '解开所有图钉，让缆线把试件拽弯，再抓两端往一起凑。' },
        { t: 90, text: '两端凑近后：换粘合工具（按 3），按住一端的边缘，拖到另一端的边缘松开。' },
      ],
    },
  ],
};
