// Analytic shape generators for body outlines, pipe paths and target silhouettes.
// All return arrays of {x,y}. Angles in radians.

export function ngon(cx, cy, r, n = 6, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function ellipse(cx, cy, rx, ry, n = 48, rot = 0) {
  const pts = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    pts.push({ x: cx + x * cr - y * sr, y: cy + x * sr + y * cr });
  }
  return pts;
}

export const circle = (cx, cy, r, n = 48) => ellipse(cx, cy, r, r, n);

/** Stadium/capsule of total length `length`, half-width `halfW`, rotated by rot. */
export function capsule(cx, cy, length, halfW, rot = 0, segs = 12) {
  const half = Math.max(0, length / 2 - halfW);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI / 2 + (i / segs) * Math.PI;
    pts.push({ x: half + halfW * Math.cos(a), y: halfW * Math.sin(a) });
  }
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI / 2 + (i / segs) * Math.PI;
    pts.push({ x: -half + halfW * Math.cos(a), y: halfW * Math.sin(a) });
  }
  return rotateAround(pts, rot, 0, 0).map(p => ({ x: p.x + cx, y: p.y + cy }));
}

/** Bent capsule (banana): centerline is an arc of `radius` spanning [a0,a1],
 *  with semicircular caps at both arc endpoints. Assumes a1 > a0. */
export function arcCapsule(cx, cy, radius, halfW, a0, a1, segs = 28) {
  const pts = [];
  const at = (R, a) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  // Outer arc a0 -> a1.
  for (let i = 0; i <= segs; i++) pts.push(at(radius + halfW, a0 + (i / segs) * (a1 - a0)));
  // End cap: semicircle around the a1 endpoint, sweeping radially-out -> radially-in
  // through the forward tangent direction.
  const e1 = at(radius, a1);
  for (let i = 1; i < 8; i++) {
    const th = a1 + (i / 8) * Math.PI;
    pts.push({ x: e1.x + halfW * Math.cos(th), y: e1.y + halfW * Math.sin(th) });
  }
  // Inner arc a1 -> a0.
  for (let i = 0; i <= segs; i++) pts.push(at(radius - halfW, a1 - (i / segs) * (a1 - a0)));
  // Start cap: semicircle around the a0 endpoint through the backward tangent.
  const e0 = at(radius, a0);
  for (let i = 1; i < 8; i++) {
    const th = a0 + Math.PI + (i / 8) * Math.PI;
    pts.push({ x: e0.x + halfW * Math.cos(th), y: e0.y + halfW * Math.sin(th) });
  }
  return pts;
}

export function roundedRect(cx, cy, w, h, r, segs = 6) {
  const hw = w / 2 - r, hh = h / 2 - r;
  const corners = [
    { x: hw, y: hh, a0: 0 },
    { x: -hw, y: hh, a0: Math.PI / 2 },
    { x: -hw, y: -hh, a0: Math.PI },
    { x: hw, y: -hh, a0: -Math.PI / 2 },
  ];
  const pts = [];
  for (const c of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = c.a0 + (i / segs) * (Math.PI / 2);
      pts.push({ x: cx + c.x + r * Math.cos(a), y: cy + c.y + r * Math.sin(a) });
    }
  }
  return pts;
}

export function star(cx, cy, rOut, rIn, points = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** U / horseshoe silhouette: outer box minus a top slot. */
export function uShape(cx, cy, outerW, outerH, slotW, slotD, r = 18) {
  const raw = [
    { x: -outerW / 2, y: -outerH / 2 },
    { x: -slotW / 2, y: -outerH / 2 },
    { x: -slotW / 2, y: -outerH / 2 + slotD },
    { x: slotW / 2, y: -outerH / 2 + slotD },
    { x: slotW / 2, y: -outerH / 2 },
    { x: outerW / 2, y: -outerH / 2 },
    { x: outerW / 2, y: outerH / 2 },
    { x: -outerW / 2, y: outerH / 2 },
  ];
  return chamfer(raw, r).map(p => ({ x: p.x + cx, y: p.y + cy }));
}

/** L silhouette. legW = thickness of both legs. */
export function lShape(cx, cy, w, h, legW, r = 16) {
  const raw = [
    { x: -w / 2, y: -h / 2 },
    { x: -w / 2 + legW, y: -h / 2 },
    { x: -w / 2 + legW, y: h / 2 - legW },
    { x: w / 2, y: h / 2 - legW },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  return chamfer(raw, r).map(p => ({ x: p.x + cx, y: p.y + cy }));
}

/** Rounds polygon corners by clipping each vertex with two points at distance r. */
export function chamfer(pts, r) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
    const ra = Math.min(r, la / 2.5), rb = Math.min(r, lb / 2.5);
    out.push({ x: p.x + ((a.x - p.x) / la) * ra, y: p.y + ((a.y - p.y) / la) * ra });
    out.push({ x: p.x + ((b.x - p.x) / lb) * rb, y: p.y + ((b.y - p.y) / lb) * rb });
  }
  return out;
}

// ---- pipe path helpers ------------------------------------------------------

export function line(x1, y1, x2, y2, n = 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  }
  return pts;
}

export function arc(cx, cy, r, a0, a1, n = 16) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / (n - 1)) * (a1 - a0);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function rotateAround(pts, ang, cx, cy) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(p => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  }));
}

export { rotateAround };

export function translate(pts, dx, dy) {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}
