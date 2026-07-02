// 第 3 关 · 收缩肌腱：两条肌肉管把板子拽弯。先跟它们较劲摆平板，
// 再顺着它们的力气对折身体，用粘合固定折痕。剪断肌腱会让第二个目标报废。
import { roundedRect, uShape, line } from './shapes.js';

const CX = 360, CY = 330;

export default {
  id: 'L3',
  name: '收缩肌腱',
  dim: 2,
  timeLimit: 240,
  cutoff: 85,
  intro: '它总是蜷着……里面好像有两条筋在使劲。',
  body: {
    outline: roundedRect(CX, CY, 300, 150, 30),
    edgeLen: 16,
    basePressure: 1.0,
    // Softer shear web + stiffer boundary bending: wrinkling the surface costs
    // more than curving globally, so the tendons fold the slab instead of
    // ruching its top edge.
    lattice: { strides: [0.5], compliance: 1.6e-3 },
    bendCompliance: 2e-4,
  },
  // Two "bowstring" tendons spanning the slab's full width. Contracting a
  // bowstring pulls the slab's ends together, so it buckles into a C — edge
  // lengths stay intact, which a surface-hugging muscle could never achieve.
  // Both strings sit in the TOP half: asymmetric contraction folds the slab
  // into a C (symmetric strings would just bulge it into a barrel).
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
      hint: '两条筋在把它往一起拽。把两端钉远一点，它就直了。',
    },
    {
      name: '马蹄',
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
      hint: '顺着筋的力气把它对折，捏拢两端，再用粘合缝住。要是筋断了……只能重开。',
    },
  ],
};
