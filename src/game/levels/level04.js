// 第 4 关 · 三通阀：三根脾气不同的管子——硬骨头撑形、脆管一拉就断、
// 气袋鼓着身体。目标序列必须按正确顺序下刀：先泄气但留骨头，最后才剪骨头。
import { ngon, circle, line, arc } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L4',
  name: '三通阀',
  dim: 2,
  timeLimit: 270,
  cutoff: 85,
  intro: '三根管子，三种脾气。下刀之前，先想想顺序。',
  body: {
    outline: ngon(CX, CY, 120, 5),
    edgeLen: 16,
    basePressure: 0.9,
  },
  pipes: [
    { path: line(CX - 90, CY, CX, CY, 6), type: 'rigid' },
    { path: line(CX, CY, CX + 62, CY - 62, 5), type: 'brittle', overrides: { breakStrain: 1.45 } },
    { path: circle(CX + 48, CY + 48, 30, 14), type: 'pressure', closed: true, overrides: { bodyInflation: 0.4 } },
  ],
  targets: [
    {
      name: '河豚',
      _expectFactor: 1.3,
      outlines: [circle(CX, CY + 5, 119)],
      pipes: [
        { points: line(CX - 105, CY + 5, CX - 10, CY + 5, 6), closed: false },
        { points: line(CX + 5, CY - 5, CX + 68, CY - 68, 5), closed: false },
        { points: circle(CX + 54, CY + 54, 37, 16), closed: true },
      ],
      hint: '先别切！它鼓着呢，捏圆就好。小心：有根管子很脆。',
    },
    {
      name: '风筝',
      _expectFactor: 0.9,
      outlines: [[
        { x: CX - 130, y: CY }, { x: CX + 40, y: CY - 118 },
        { x: CX + 130, y: CY }, { x: CX + 40, y: CY + 118 },
      ]],
      pipes: [
        { points: line(CX - 105, CY, CX - 10, CY, 6), closed: false },
        { points: line(CX + 5, CY - 5, CX + 68, CY - 68, 5), closed: false },
        { points: arc(CX + 52, CY + 52, 33, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '放掉右下角的气，但留着那根硬骨头，撑住风筝的左角。',
    },
    {
      name: '软气球',
      _expectFactor: 0.9,
      cutoff: 83,
      outlines: [circle(CX, CY, 99)],
      pipes: [
        { points: line(CX - 110, CY, CX - 65, CY, 4), closed: false },
        { points: line(CX - 50, CY, CX - 5, CY, 4), closed: false },
        { points: line(CX + 5, CY - 5, CX + 68, CY - 68, 5), closed: false },
        { points: arc(CX + 52, CY + 52, 33, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.8, pipes: 0.2 },
      hint: '现在，把最后那根硬骨头也剪断，让它彻底放松。',
    },
  ],
};
