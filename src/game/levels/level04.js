// 第 4 关 · 三通阀体：三根材质不同的管路——刚性撑杆撑形、脆性导管一拉就断、
// 气囊鼓着试件。目标序列必须按正确顺序下刀：先泄压但留撑杆，最后才剪撑杆。
import { ngon, circle, line, arc } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L4',
  name: '试件 04 · 三通阀体',
  dim: 2,
  timeLimit: 270,
  cutoff: 85,
  intro: '三根管路，三种材质。下刀之前，先想想顺序。',
  body: {
    outline: ngon(CX, CY, 120, 5),
    edgeLen: 16,
    basePressure: 0.9,
  },
  pipes: [
    { path: line(CX - 90, CY, CX, CY, 6), type: 'rigid' },
    // Tip pulled in from (+62,−62) so the settled strut stays fully inside the
    // pentagon (rest-containment audit: was 10.3px proud at the corner).
    { path: line(CX, CY, CX + 56, CY - 56, 5), type: 'brittle', overrides: { breakStrain: 1.45 } },
    // Pulled toward the centre so the INFLATED ring (rest 28 x sqrt(1.5))
    // stays fully inside the settled body — no more poking through the edge.
    { path: circle(CX + 38, CY + 38, 28, 14), type: 'pressure', closed: true, overrides: { bodyInflation: 0.4 } },
  ],
  targets: [
    {
      name: '满充气罐',
      _expectFactor: 1.3,
      outlines: [circle(CX, CY + 5, 119)],
      pipes: [
        { points: line(CX - 105, CY + 5, CX - 10, CY + 5, 6), closed: false },
        { points: line(CX + 5, CY - 5, CX + 62, CY - 62, 5), closed: false },
        { points: circle(CX + 44, CY + 44, 34, 16), closed: true },
      ],
      hint: '先别切！内部气压撑着它，捏圆就好。小心：有根导管很脆。',
      moreHints: [
        { t: 45, text: '把五个角轻轻往里揉圆。动作轻点——猛拉会把脆管拉断。' },
      ],
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
        { points: line(CX + 5, CY - 5, CX + 62, CY - 62, 5), closed: false },
        { points: arc(CX + 42, CY + 42, 31, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '放掉右下角的气，但留着那根刚性撑杆，顶住风筝的左角。',
      moreHints: [
        { t: 40, text: '从右下角外面斜着切一小刀，只切断那个小环。' },
        { t: 85, text: '左边那根横着的硬管别动——它是撑住风筝左角的桁架。' },
      ],
    },
    {
      name: '软气球',
      _expectFactor: 0.9,
      cutoff: 83,
      outlines: [circle(CX, CY, 99)],
      pipes: [
        { points: line(CX - 110, CY, CX - 65, CY, 4), closed: false },
        { points: line(CX - 50, CY, CX - 5, CY, 4), closed: false },
        { points: line(CX + 5, CY - 5, CX + 62, CY - 62, 5), closed: false },
        { points: arc(CX + 42, CY + 42, 31, 0.8, 5.5, 8), closed: false },
      ],
      weights: { outline: 0.8, pipes: 0.2 },
      hint: '现在，把最后那根刚性撑杆也剪断，让试件彻底松弛。',
      moreHints: [
        { t: 40, text: '从左边外面横着切进去，切断那根硬管，然后揉圆。' },
      ],
    },
  ],
};
