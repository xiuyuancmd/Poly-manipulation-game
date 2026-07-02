// 第 5 关 · 自由塑形：骨头、肌肉、气袋混在一起，四个目标走完
// 「捏形 → 泄气 → 一分为二 → 粘回重组」的完整旅程。
import { circle, ellipse, roundedRect, line, arc } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L5',
  name: '自由塑形',
  dim: 2,
  timeLimit: 300,
  cutoff: 87,
  intro: '这是毕业考试：它的每根管子脾气都不一样。',
  body: {
    outline: circle(CX, CY, 103),
    edgeLen: 16,
    basePressure: 1.0,
  },
  pipes: [
    { path: line(CX - 75, CY, CX + 75, CY, 6), type: 'rigid' },
    { path: line(CX - 50, CY - 70, CX + 50, CY - 70, 5), type: 'contractile' },
    { path: circle(CX - 45, CY + 45, 30, 14), type: 'pressure', overrides: { bodyInflation: 0.35 }, closed: true },
  ],
  targets: [
    {
      name: '圆球',
      _expectFactor: 1.35,
      outlines: [circle(CX, CY, 119)],
      pipes: [
        { points: line(CX - 75, CY, CX + 75, CY, 6), closed: false },
        { points: line(CX - 32, CY - 75, CX + 32, CY - 75, 4), closed: false },
        { points: circle(CX - 50, CY + 50, 37, 16), closed: true },
      ],
      hint: '先把它揉圆。感受一下每根管子的脾气。',
    },
    {
      name: '宽饼',
      _expectFactor: 1.0,
      outlines: [ellipse(CX, CY, 145, 73)],
      pipes: [
        { points: line(CX - 75, CY, CX + 75, CY, 6), closed: false },
        { points: line(CX - 32, CY - 45, CX + 32, CY - 45, 4), closed: false },
        { points: arc(CX - 48, CY + 42, 32, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '左下角藏着一个气袋。放了它，但别伤到别的管子。',
    },
    {
      name: '双丸',
      _expectFactor: 1.0,
      cutoff: 84,
      outlines: [circle(CX - 85, CY, 73), circle(CX + 85, CY, 73)],
      pipes: [
        { points: line(CX - 130, CY, CX - 65, CY, 4), closed: false },
        { points: line(CX + 65, CY, CX + 130, CY, 4), closed: false },
        { points: line(CX - 110, CY - 45, CX - 60, CY - 45, 3), closed: false },
        { points: line(CX + 60, CY - 45, CX + 110, CY - 45, 3), closed: false },
        { points: arc(CX - 110, CY + 40, 30, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.85, pipes: 0.15 },
      hint: '手起刀落，一分为二，再把两团分开摆好。',
    },
    {
      name: '方塔',
      _expectFactor: 1.0,
      cutoff: 84,
      outlines: [roundedRect(CX, CY, 125, 290, 40)],
      pipes: [
        { points: line(CX - 40, CY - 70, CX + 40, CY - 70, 4), closed: false },
        { points: line(CX - 40, CY + 70, CX + 40, CY + 70, 4), closed: false },
        { points: line(CX - 30, CY - 115, CX + 30, CY - 115, 3), closed: false },
        { points: line(CX - 30, CY + 25, CX + 30, CY + 25, 3), closed: false },
        { points: arc(CX - 25, CY + 120, 28, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.85, pipes: 0.15 },
      hint: '把两团摞起来，用粘合缝住接缝，堆成一座塔。',
    },
  ],
};
