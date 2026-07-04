// 第 2 关 · 高压回路：闭环加压管把试件撑得鼓鼓的。第二个目标在充压状态下
// 不可能完成——玩家必须发现"切断环管会泄压"，并接受切割不可逆。
import { circle, ellipse, capsule } from './shapes.js';

const CX = 360, CY = 320;

export default {
  id: 'L2',
  name: '试件 02 · 高压回路',
  dim: 2,
  timeLimit: 210,
  cutoff: 85,
  intro: '这块试件鼓得很结实……里面那圈管路是干什么的？',
  body: {
    outline: circle(CX, CY, 95),
    edgeLen: 16,
    basePressure: 0.8,
    // Smooth "balloon membrane": suppresses wrinkle noise once deflated.
    bendCompliance: 3e-4,
  },
  pipes: [
    { path: circle(CX, CY, 55, 24), type: 'pressure', closed: true, overrides: { bodyInflation: 0.55 } },
  ],
  targets: [
    {
      name: '满压凸壳',
      _expectFactor: 1.35,
      _restBelow: 83,
      outlines: [ellipse(CX, CY, 140, 86.5)],
      pipes: [{ points: circle(CX, CY, 67, 24), closed: true }],
      hint: '内部气压让它保持鼓胀——轻轻按两下就能凑出形状。',
      moreHints: [
        { t: 20, text: '抓住上下两侧往里按，把它压成横躺的凸壳。' },
        { t: 80, text: '双击可以钉住一个点，腾出手来压另一边。' },
      ],
    },
    {
      name: '软枕头',
      _expectFactor: 0.8,
      // Discovery target: the lesson is "cut the loop to deflate", not shape
      // precision — a deflated floppy bag is inherently hard to mold exactly.
      cutoff: 72,
      // Area needs the deflated factor AND perimeter matches the rest outline
      // (593 vs 597) — the bag can relax into this shape without any stretch.
      outlines: [capsule(CX, CY, 235, 54)],
      // The severed loop (chain length ~420) physically lies as a flattened
      // hairpin inside the pillow — author what the material can actually do.
      pipes: [{ points: ellipse(CX, CY, 88, 36, 24), closed: false }],
      weights: { outline: 0.7, pipes: 0.3 },
      hint: '怎么压都压不瘪？也许该请出剪刀。切下去就回不了头了。',
      moreHints: [
        { t: 30, text: '它充着压，光靠按是压不瘪的。想想里面那圈管路是干什么的。' },
        { t: 60, text: '换切割工具（按 2），从试件外面往里划一刀，切断里面那圈环形管路。' },
        { t: 105, text: '泄压之后：双击钉住左右两端，再把上下压扁，凑成枕头的比例。' },
      ],
    },
  ],
};
