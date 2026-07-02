// 第 2 关 · 高压水管：闭环加压管把身体撑得鼓鼓的。第二个目标在充气状态下
// 不可能完成——玩家必须发现"切断环管会泄气"，并接受切割不可逆。
import { circle, ellipse, capsule } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L2',
  name: '高压水管',
  dim: 2,
  timeLimit: 210,
  cutoff: 85,
  intro: '这团东西鼓得很结实……里面那圈管道是干什么的？',
  body: {
    outline: circle(CX, CY, 95),
    edgeLen: 16,
    basePressure: 0.8,
    // Smooth "balloon skin": suppresses wrinkle noise once deflated.
    bendCompliance: 3e-4,
  },
  pipes: [
    { path: circle(CX, CY, 55, 24), type: 'pressure', closed: true, overrides: { bodyInflation: 0.55 } },
  ],
  targets: [
    {
      name: '饱满的蛋',
      _expectFactor: 1.35,
      outlines: [ellipse(CX, CY, 125, 97)],
      pipes: [{ points: circle(CX, CY, 67, 24), closed: true }],
      hint: '它天生就是鼓的——轻轻按两下就能凑出形状。',
    },
    {
      name: '软枕头',
      _expectFactor: 0.8,
      // Discovery target: the lesson is "cut the loop to deflate", not shape
      // precision — a deflated floppy bag is inherently hard to mold exactly.
      cutoff: 75,
      // Area needs the deflated factor AND perimeter matches the rest outline
      // (593 vs 597) — the bag can relax into this shape without any stretch.
      outlines: [capsule(CX, CY, 235, 54)],
      // The severed loop (chain length ~420) physically lies as a flattened
      // hairpin inside the pillow — author what the material can actually do.
      pipes: [{ points: ellipse(CX, CY, 88, 36, 24), closed: false }],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '怎么压都压不瘪？也许该请出剪刀。切下去就回不了头了。',
    },
  ],
};
