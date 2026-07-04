// 第 1 关 · 弹性标定：一块标准软材料试件和一根普通管路。教会玩家牵拉、钉住和读仪表。
import { ngon, ellipse, arcCapsule, line, arc } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L1',
  name: '试件 01 · 弹性标定',
  dim: 2,
  timeLimit: 180,
  cutoff: 80,
  intro: '先拖一拖，感受试件的弹性响应。双击可以把点钉住。',
  body: {
    outline: ngon(CX, CY, 110, 6),
    edgeLen: 16,
    basePressure: 1.0,
  },
  pipes: [
    { path: line(CX - 70, CY, CX + 70, CY, 6), type: 'normal' },
  ],
  targets: [
    {
      // Both conservation laws respected: area ~ hexagon area (gel), and
      // perimeter ~671 vs hexagon 660 (elastic boundary allows ~2% stretch).
      name: '长轴椭圆坯',
      cutoff: 78,
      outlines: [ellipse(CX, CY, 135, 74)],
      pipes: [{ points: line(CX - 90, CY, CX + 90, CY, 8), closed: false }],
      hint: '抓住左右两端往外拉；或者钉住一端，拖另一端。',
      moreHints: [
        { t: 45, text: '双击试件上的点可以钉住它。钉住左端，抓右端往外拉。' },
        { t: 90, text: '跟着金色虚影走——它显示的就是目标位置。读数过线后保持 3 秒。' },
      ],
    },
    {
      name: '弯月',
      outlines: [arcCapsule(CX, CY + 90, 130, 62, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6)],
      pipes: [{ points: arc(CX, CY + 90, 130, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6, 10), closed: false }],
      hint: '钉住一端，把另一端往下掰。管路会跟着基体一起变形。',
      moreHints: [
        { t: 45, text: '先钉住一端，抓另一端绕一个弧线拖下去。' },
        { t: 90, text: '两端就位后，用第三个控制点把中段往上顶出弯月的弧顶。' },
      ],
    },
  ],
};
