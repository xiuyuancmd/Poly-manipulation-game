// 第 5 关 · 复合机构：撑杆、缆线、气囊混在一起，四个目标走完
// 「捏形 → 泄压 → 一分为二 → 粘回重组」的完整流程。
import { circle, ellipse, roundedRect, line, arc } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L5',
  name: '试件 05 · 复合机构',
  dim: 2,
  timeLimit: 300,
  cutoff: 87,
  intro: '这是结业测验：每根管路的材质都不一样。',
  body: {
    outline: circle(CX, CY, 103),
    edgeLen: 16,
    basePressure: 1.0,
  },
  pipes: [
    { path: line(CX - 75, CY, CX + 75, CY, 6), type: 'rigid' },
    { path: line(CX - 50, CY - 70, CX + 50, CY - 70, 5), type: 'contractile' },
    { path: circle(CX - 36, CY + 36, 28, 14), type: 'pressure', overrides: { bodyInflation: 0.35 }, closed: true },
  ],
  targets: [
    {
      name: '圆球',
      _expectFactor: 1.35,
      outlines: [circle(CX, CY, 119)],
      pipes: [
        { points: line(CX - 75, CY, CX + 75, CY, 6), closed: false },
        { points: line(CX - 32, CY - 75, CX + 32, CY - 75, 4), closed: false },
        { points: circle(CX - 41, CY + 41, 34, 16), closed: true },
      ],
      hint: '先把试件揉圆。顺便试探一下每根管路的物性。',
      moreHints: [
        { t: 45, text: '顶上那根缆线把顶部拽平了——揉圆时重点补顶部和底部。' },
      ],
    },
    {
      name: '宽饼',
      _expectFactor: 1.0,
      outlines: [ellipse(CX, CY, 145, 73)],
      pipes: [
        { points: line(CX - 75, CY, CX + 75, CY, 6), closed: false },
        { points: line(CX - 32, CY - 45, CX + 32, CY - 45, 4), closed: false },
        { points: arc(CX - 39, CY + 33, 30, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '左下角埋着一个气囊。给它泄压，但别切到别的管路。',
      moreHints: [
        { t: 40, text: '从左下角外面斜着切一小刀，刚好够到那个小环就停。' },
        { t: 85, text: '泄压后钉住左右两端，把试件压成宽饼。' },
      ],
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
      moreHints: [
        { t: 40, text: '从正上方外面往下垂直一刀切到底，把试件劈成两半。' },
        { t: 85, text: '抓住其中一半拖远一点，摆成左右两团。' },
      ],
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
      hint: '把两团摞起来，用粘合固定接缝，堆成一座塔。',
      moreHints: [
        { t: 40, text: '把一团拖到另一团的正上方，让它们贴在一起。' },
        { t: 85, text: '换粘合工具：按住上团的下边缘，拖到下团的上边缘松开，缝两针更牢。' },
      ],
    },
  ],
};
