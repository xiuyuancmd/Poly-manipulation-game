// Minimal software 3D renderer: perspective projection + painter's algorithm.
// No WebGL, no dependencies — keeps the game clone-and-play offline.

import { COLORS } from './render2d.js';

export class Camera3D {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.yaw = 0.65;
    this.pitch = 0.38;
    this.dist = 640;
    this.f = 780;
    this.center = { x: 0, y: 0, z: 0 };
  }

  basis() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const eye = {
      x: this.center.x + this.dist * cp * sy,
      y: this.center.y + this.dist * sp,
      z: this.center.z + this.dist * cp * cy,
    };
    const fwd = norm({ x: this.center.x - eye.x, y: this.center.y - eye.y, z: this.center.z - eye.z });
    const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
    const up = cross(right, fwd);
    return { eye, fwd, right, up };
  }

  project(x, y, z, basis = this.basis()) {
    const { eye, fwd, right, up } = basis;
    const vx = x - eye.x, vy = y - eye.y, vz = z - eye.z;
    const d = vx * fwd.x + vy * fwd.y + vz * fwd.z;
    if (d < 12) return null;
    const px = vx * right.x + vy * right.y + vz * right.z;
    const py = vx * up.x + vy * up.y + vz * up.z;
    return { sx: this.W / 2 + (this.f * px) / d, sy: this.H / 2 - (this.f * py) / d, depth: d };
  }

  /** Intersection of the cursor ray with the camera-parallel plane through P. */
  planeHit(P, sx, sy, basis = this.basis()) {
    const { eye, fwd, right, up } = basis;
    const dir = norm({
      x: fwd.x + (right.x * (sx - this.W / 2)) / this.f + (up.x * (this.H / 2 - sy)) / this.f,
      y: fwd.y + (right.y * (sx - this.W / 2)) / this.f + (up.y * (this.H / 2 - sy)) / this.f,
      z: fwd.z + (right.z * (sx - this.W / 2)) / this.f + (up.z * (this.H / 2 - sy)) / this.f,
    });
    const denom = dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z;
    const t = ((P.x - eye.x) * fwd.x + (P.y - eye.y) * fwd.y + (P.z - eye.z) * fwd.z) / denom;
    return { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
  }
}

const norm = v => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const LIGHT = norm({ x: 0.5, y: 0.8, z: 0.35 });

// ---- material readouts (stress whitening) -----------------------------------
// Per-body edge rest-length lookup, built once per body (WeakMap keyed — the
// 3D mesh is never re-meshed, so the cache stays valid for the body's life).
const EDGE_REST = new WeakMap();
function edgeRestMap(body) {
  let m = EDGE_REST.get(body);
  if (!m) {
    m = new Map();
    for (const e of body.edgeCs) {
      m.set(Math.min(e.a, e.b) * 100000 + Math.max(e.a, e.b), e.c.rest);
    }
    EDGE_REST.set(body, m);
  }
  return m;
}

// 24-step quantized whitening ramps — LOCAL copies (render2d's exports stay
// untouched). Faces whiten from the matrix green; a face's strain is the mean
// current/rest ratio of its three edges, whitening from +3% stretch.
const FACE_N = 24;
const FACE_WHITE = [];
for (let i = 0; i <= FACE_N; i++) {
  const f = i / FACE_N;
  FACE_WHITE.push([
    56 + (245 - 56) * f,
    150 + (255 - 150) * f,
    125 + (242 - 125) * f,
  ]);
}
function faceWhiteStep(strain) {
  const t = Math.min(1, Math.max(0, (strain - 1.03) / 0.22));
  return Math.round(t * FACE_N);
}

// Pipe segments whiten from steel grey under real stretch (same visual
// language as the 2D pipes); colour strings are cached per quantized step.
function makeStrainRamp(base, white, s0, s1) {
  const N = 24;
  const cache = new Array(N + 1);
  return (strain) => {
    const t = Math.min(1, Math.max(0, (strain - s0) / (s1 - s0)));
    const b = Math.round(t * N);
    if (!cache[b]) {
      const f = b / N;
      cache[b] = `rgb(${Math.round(base[0] + (white[0] - base[0]) * f)},${
        Math.round(base[1] + (white[1] - base[1]) * f)},${
        Math.round(base[2] + (white[2] - base[2]) * f)})`;
    }
    return cache[b];
  };
}
const pipeStrainColor3D = makeStrainRamp([170, 182, 198], [246, 250, 253], 1.02, 1.35);

export function drawScene3D(ctx, session, view = {}) {
  const { canvas } = ctx;
  const cam = session.camera;
  const { ps, body } = session;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const basis = cam.basis();

  // Faint reference ground grid below the body.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -4; i <= 4; i++) {
    line3(ctx, cam, basis, { x: i * 90, y: 230, z: -360 }, { x: i * 90, y: 230, z: 360 });
    line3(ctx, cam, basis, { x: -360, y: 230, z: i * 90 }, { x: 360, y: 230, z: i * 90 });
  }
  ctx.stroke();

  // Ghost target: translation-aligned wireframe box.
  if (view.ghost?.box) {
    const [sx, sy, sz] = view.ghost.box;
    const c = view.ghost.at;
    ctx.save();
    ctx.strokeStyle = COLORS.ghostStroke;
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const s = [sx / 2, sy / 2, sz / 2];
    const corners = [];
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) {
      corners.push({ x: c.x + dx * s[0], y: c.y + dy * s[1], z: c.z + dz * s[2] });
    }
    const E = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E) line3(ctx, cam, basis, corners[a], corners[b]);
    ctx.stroke();
    ctx.restore();
  }

  // Body triangles, painter's order, flat shaded + per-face stress whitening
  // (mean edge strain of the triangle, quantized — a pressed or stretched
  // face pales exactly where the material actually carries the load).
  const rests = edgeRestMap(body);
  const eLen = (a, b) =>
    Math.hypot(ps.x[b] - ps.x[a], ps.y[b] - ps.y[a], ps.z[b] - ps.z[a]);
  const eStrain = (a, b) => {
    const r = rests.get(Math.min(a, b) * 100000 + Math.max(a, b));
    return r ? eLen(a, b) / r : 1;
  };
  const tris = body.tris;
  const faces = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const pa = cam.project(ps.x[a], ps.y[a], ps.z[a], basis);
    const pb = cam.project(ps.x[b], ps.y[b], ps.z[b], basis);
    const pc = cam.project(ps.x[c], ps.y[c], ps.z[c], basis);
    if (!pa || !pb || !pc) continue;
    const ux = ps.x[b] - ps.x[a], uy = ps.y[b] - ps.y[a], uz = ps.z[b] - ps.z[a];
    const vx = ps.x[c] - ps.x[a], vy = ps.y[c] - ps.y[a], vz = ps.z[c] - ps.z[a];
    const n = norm({ x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx });
    const shade = 0.45 + 0.55 * Math.max(0, n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
    const white = faceWhiteStep((eStrain(a, b) + eStrain(b, c) + eStrain(c, a)) / 3);
    faces.push({ pa, pb, pc, depth: (pa.depth + pb.depth + pc.depth) / 3, shade, white });
  }
  faces.sort((u, v) => v.depth - u.depth);
  for (const f of faces) {
    ctx.beginPath();
    ctx.moveTo(f.pa.sx, f.pa.sy);
    ctx.lineTo(f.pb.sx, f.pb.sy);
    ctx.lineTo(f.pc.sx, f.pc.sy);
    ctx.closePath();
    const [br, bg, bb] = FACE_WHITE[f.white];
    ctx.fillStyle = `rgba(${Math.round(br * f.shade)}, ${Math.round(bg * f.shade)}, ${Math.round(bb * f.shade)}, 0.94)`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(126,224,195,0.18)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Pipes: dark casing bore underlay + per-segment stress-whitened body —
  // the same material language as the 2D pipes.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;
  for (const pipe of body.pipes) {
    if (!pipe.alive) continue;
    const proj = pipe.parts.map(i =>
      ps.alive[i] ? cam.project(ps.x[i], ps.y[i], ps.z[i], basis) : null);
    ctx.strokeStyle = 'rgba(15,22,27,0.55)';
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    let started = false;
    for (const p of proj) {
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
    ctx.lineWidth = 4.5;
    for (let k = 0; k < pipe.segCs.length; k++) {
      const pa = proj[k], pb = proj[k + 1];
      if (!pa || !pb) continue;
      ctx.strokeStyle = pipeStrainColor3D(pipe.segCs[k].c.currentStrain(ps));
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Pins and grabs.
  for (const i of session.pins) {
    const p = cam.project(ps.x[i], ps.y[i], ps.z[i], basis);
    if (!p) continue;
    ctx.fillStyle = COLORS.pin;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [, g] of session.grabs) {
    const p = cam.project(ps.x[g.vertex], ps.y[g.vertex], ps.z[g.vertex], basis);
    if (!p) continue;
    ctx.fillStyle = COLORS.grab;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function line3(ctx, cam, basis, a, b) {
  const pa = cam.project(a.x, a.y, a.z, basis);
  const pb = cam.project(b.x, b.y, b.z, basis);
  if (!pa || !pb) return;
  ctx.moveTo(pa.sx, pa.sy);
  ctx.lineTo(pb.sx, pb.sy);
}

/** Tiny isometric wireframe preview of a 3D target for the HUD card. */
export function drawTargetPreview3D(canvas, spec) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const [sx, sy, sz] = spec.box;
  const iso = (x, y, z) => ({
    x: W / 2 + (x - z) * 0.72,
    y: H / 2 + (x + z) * 0.36 - y * 0.78,
  });
  const scale = 0.72 * Math.min(W, H) / Math.max(sx, sy, sz) / 1.7;
  const s = [sx * scale, sy * scale, sz * scale];
  const corners = [];
  for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
    corners.push(iso(dx * s[0], dy * s[1], dz * s[2]));
  }
  const E = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  ctx.strokeStyle = 'rgba(232,198,106,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of E) {
    ctx.moveTo(corners[a].x, corners[a].y);
    ctx.lineTo(corners[b].x, corners[b].y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(170,182,198,0.95)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const pipe of spec.pipes) {
    ctx.beginPath();
    pipe.forEach((q, k) => {
      const p = iso(q.x * scale, q.y * scale, q.z * scale);
      if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
}
