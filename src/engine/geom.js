// Pure 2D geometry helpers. DOM-free: shared by the physics engine,
// the similarity engine and node unit tests.

/** Signed area of a polygon given as [{x,y},...]. Positive = CCW in math coords. */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Signed area of a particle-index ring against a ParticleSystem. */
export function ringSignedArea(ps, ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += ps.x[p] * ps.y[q] - ps.x[q] * ps.y[p];
  }
  return a / 2;
}

/** Area-weighted centroid of a simple polygon; falls back to vertex mean. */
export function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    return { x: mx / pts.length, y: my / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Even-odd point-in-polygon test (simple rings). */
export function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Segment/segment intersection. Returns {t,u,x,y} with t along AB and u along CD
 * in [0,1], or null. Endpoint touches count (with small epsilon slack).
 */
export function segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rX = bx - ax, rY = by - ay;
  const sX = dx - cx, sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-12) return null;
  const qpX = cx - ax, qpY = cy - ay;
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)), x: ax + rX * t, y: ay + rY * t };
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function polylineLength(pts, closed) {
  let len = 0;
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    len += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return len;
}

/** Resample a polyline (open or closed) into n points at uniform arc length. */
export function resamplePolyline(pts, n, closed) {
  const total = polylineLength(pts, closed);
  if (total < 1e-9) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  const out = [];
  const m = pts.length;
  const segCount = closed ? m : m - 1;
  const step = closed ? total / n : total / (n - 1);
  let si = 0;
  let p = pts[0], q = pts[1 % m];
  let segLen = Math.hypot(q.x - p.x, q.y - p.y);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    let want = k * step;
    if (!closed && k === n - 1) want = total - 1e-9;
    while (acc + segLen < want && si < segCount - 1) {
      acc += segLen;
      si++;
      p = pts[si % m];
      q = pts[(si + 1) % m];
      segLen = Math.hypot(q.x - p.x, q.y - p.y);
    }
    const f = segLen < 1e-9 ? 0 : (want - acc) / segLen;
    out.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
  }
  return out;
}

/** Max distance from (cx,cy) to any point. */
export function boundingRadius(pts, cx, cy) {
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return r;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Deterministic LCG for anything that needs jitter. */
export function makeLCG(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
