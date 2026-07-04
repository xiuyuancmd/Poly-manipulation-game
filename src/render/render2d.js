// Canvas 2D renderer for soft-body levels. Pure drawing: reads session/body
// state (via body.renderState() mechanical readouts), never mutates it.
// The body renders as a translucent cast-silicone part with pipes embedded
// INSIDE the matrix. Pipes share one base colour regardless of material type —
// the only visible differences come from real mechanical state (per-segment
// stress whitening). No idle animation: everything below is a pure function
// of the current physics state.

export const COLORS = {
  bg: '#14171c',
  grid: 'rgba(255,255,255,0.035)',
  bodyFill: 'rgba(56,116,98,0.60)',   // translucent matrix base coat
  bodyGlaze: 'rgba(56,116,98,0.20)',  // over-pipe glaze: pipes sit inside the material
  bodyStroke: '#7ee0c3',
  pipe: '#aab6c6',
  pipeCasing: 'rgba(15,22,27,0.50)',  // dark channel bore around every pipe
  pipeEnd: '#c9d4e2',
  ghostStroke: 'rgba(232,198,106,0.85)',
  ghostFill: 'rgba(232,198,106,0.07)',
  ghostPipe: 'rgba(232,198,106,0.55)',
  grab: '#ffd166',
  pin: '#ff7d6b',
  cut: '#ff5c5c',
  glue: '#66a3ff',
  weld: '#8fb7ff',
};

// Fixed studio light for the wet-highlight pass (unit vector, up-left).
const LIGHT_X = -0.6, LIGHT_Y = -0.8;

/** Quantized strain -> colour ramp (base -> white). Caches the CSS strings so
 *  per-edge strokes do not churn new strings every frame. */
function makeStrainRamp(base, white, s0, s1) {
  const N = 24;
  const cache = new Array(N + 1);
  return (strain) => {
    const t = Math.min(1, Math.max(0, (strain - s0) / (s1 - s0)));
    const b = Math.round(t * N);
    if (!cache[b]) {
      const f = b / N;
      const r = Math.round(base[0] + (white[0] - base[0]) * f);
      const g = Math.round(base[1] + (white[1] - base[1]) * f);
      const bl = Math.round(base[2] + (white[2] - base[2]) * f);
      cache[b] = `rgb(${r},${g},${bl})`;
    }
    return cache[b];
  };
}

// Pipes whiten visibly once stretched past rest (real stress readout).
const pipeStrainColor = makeStrainRamp([170, 182, 198], [246, 250, 253], 1.02, 1.45);

// Deflation desaturation: a body below rest pressure loses colour and gloss.
// Four QUANTIZED tint steps (pressure >= 1.0 -> pristine, ~0.8 -> about 16%
// desaturated/darker), all colours precomputed — no per-frame string churn.
function dimmedRgb([r, g, b], f) {
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const d = c => Math.round((c + (gray - c) * f) * (1 - f));
  return [d(r), d(g), d(b)];
}
const PRESSURE_TINTS = [0, 1, 2, 3].map(i => {
  const f = (i / 3) * 0.16;
  const [fr, fg, fb] = dimmedRgb([56, 116, 98], f);
  return {
    fill: `rgba(${fr},${fg},${fb},0.60)`,
    // Boundary membrane whitens under tension (silicone stress-whitening);
    // its base colour dims with the island's pressure tint.
    edgeRamp: makeStrainRamp(dimmedRgb([126, 224, 195], f), [242, 255, 250], 1.01, 1.12),
  };
});
function pressureTint(p) {
  if (!(p < 1.0)) return PRESSURE_TINTS[0]; // covers >=1, undefined, NaN
  const t = Math.min(1, (1.0 - p) / 0.2);
  return PRESSURE_TINTS[Math.round(t * 3)];
}

/** Sign that turns a 90-degree rotation of an edge direction into the INWARD
 *  normal for this ring (+1: ring has positive signed area). */
function ringInwardSign(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? 1 : -1;
}

export function drawScene(ctx, session, view = {}) {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx);
  if (view.restBBox) drawClampFrame(ctx, view.restBBox, view.anchor);
  if (view.ghost) drawGhost(ctx, view.ghost);
  drawBody(ctx, session);
  drawControls(ctx, session);
  if (view.cutDrag) drawCutLine(ctx, view.cutDrag);
  if (view.glueSel) drawGlueSelection(ctx, session, view.glueSel, view.gluePos);
  view.effects?.draw(ctx);
}

/** Static workbench fixture around the specimen's rest pose: a bench band the
 *  piece sits on (with a soft contact shadow), four corner clamp BLOCKS —
 *  double-line steel with gripper teeth on the inner faces — and a crosshair
 *  datum at the rest centroid. Everything is a pure function of the rest
 *  geometry: zero animation, and it explains WHY the released piece drifts
 *  (and rotates) back into place. */
function drawClampFrame(ctx, bbox, anchor) {
  const M = 14, L = 20;
  const x0 = bbox.minX - M, y0 = bbox.minY - M;
  const x1 = bbox.maxX + M, y1 = bbox.maxY + M;
  ctx.save();
  ctx.lineCap = 'butt';
  // Bench band just below the fixture: the rail the specimen is mounted on.
  const bandY = bbox.maxY + M + 8;
  ctx.strokeStyle = 'rgba(170,182,198,0.22)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x0 - 24, bandY);
  ctx.lineTo(x1 + 24, bandY);
  ctx.stroke();
  // Static contact shadow between bench and specimen (under the body layer).
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(anchor ? anchor.x : (x0 + x1) / 2, bandY - 3.5,
    Math.max(20, (bbox.maxX - bbox.minX) * 0.35), 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Corner clamp blocks: outer 3 px + inner 1 px contour, 2 gripper teeth
  // per corner biting toward the specimen.
  const corner = (cx, cy, ax, ay) => {
    ctx.strokeStyle = 'rgba(170,182,198,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + ax * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + ay * L);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,212,226,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + ax * L, cy + ay * 3);
    ctx.lineTo(cx + ax * 3, cy + ay * 3);
    ctx.lineTo(cx + ax * 3, cy + ay * L);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,182,198,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + ax * 11, cy + ay * 3);
    ctx.lineTo(cx + ax * 11, cy + ay * 7);
    ctx.moveTo(cx + ax * 3, cy + ay * 11);
    ctx.lineTo(cx + ax * 7, cy + ay * 11);
    ctx.stroke();
  };
  corner(x0, y0, 1, 1);
  corner(x1, y0, -1, 1);
  corner(x1, y1, -1, -1);
  corner(x0, y1, 1, -1);
  ctx.strokeStyle = 'rgba(170,182,198,0.28)';
  if (anchor) {
    const r = 9, g = 3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchor.x - r, anchor.y); ctx.lineTo(anchor.x - g, anchor.y);
    ctx.moveTo(anchor.x + g, anchor.y); ctx.lineTo(anchor.x + r, anchor.y);
    ctx.moveTo(anchor.x, anchor.y - r); ctx.lineTo(anchor.x, anchor.y - g);
    ctx.moveTo(anchor.x, anchor.y + g); ctx.lineTo(anchor.x, anchor.y + r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrid(ctx) {
  const { width, height } = ctx.canvas;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let y = 0; y <= height; y += 40) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();
}

/** Ghost target overlay, already transformed into world coordinates. */
function drawGhost(ctx, ghost) {
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 2;
  for (const poly of ghost.outlines) {
    tracePoly(ctx, poly);
    ctx.fillStyle = COLORS.ghostFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.ghostStroke;
    ctx.stroke();
  }
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ghostPipe;
  for (const pipe of ghost.pipes) {
    tracePolyline(ctx, pipe.points, pipe.closed);
    ctx.stroke();
  }
  ctx.restore();
}

/** Layered material pipeline (order = layers): translucent matrix, embedded
 *  pipes with stress whitening, over-pipe glaze, per-edge boundary (tension
 *  whitening / compression wrinkles), wet highlight, grab dents. */
function drawBody(ctx, session) {
  const { body, ps } = session;
  const rs = body.renderState();

  // 1 — translucent silicone matrix (tinted down when its island deflates).
  for (const island of rs.islands) {
    tracePoly(ctx, island.points);
    ctx.fillStyle = pressureTint(island.pressure).fill;
    ctx.fill();
  }

  // 2 — embedded pipes: one shared base colour for every material type; the
  //     only per-segment variation is genuine stress whitening.
  drawPipes(ctx, rs.pipes);

  // 3 — glaze: a faint coat of body colour OVER the pipes, so they read as
  //     channels inside the material rather than lines painted on top.
  for (const island of rs.islands) {
    tracePoly(ctx, island.points);
    ctx.fillStyle = COLORS.bodyGlaze;
    ctx.fill();
  }

  // 3b — interior top light: a broad radial gradient pooled toward the fixed
  //      studio light, so the slab reads as a volume instead of a flat coat.
  //      Follows the light through the LIGHT_X/LIGHT_Y vector and dies with
  //      the island's internal pressure (a slack casting stops pooling light:
  //      full brightness at rest pressure, fully dark by p <= 0.8).
  for (const island of rs.islands) {
    drawInteriorLight(ctx, island);
  }

  // Welds as stitches (above the glaze — they live at the surface).
  ctx.strokeStyle = COLORS.weld;
  ctx.lineWidth = 2;
  for (const w of body.welds) {
    const mx = (ps.x[w.a] + ps.x[w.b]) / 2, my = (ps.y[w.a] + ps.y[w.b]) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 4 + 5 — boundary per-edge strokes, wrinkles and wet highlight.
  for (const island of rs.islands) {
    const inw = ringInwardSign(island.points);
    drawBoundary(ctx, island, inw, pressureTint(island.pressure).edgeRamp);
    drawWetHighlight(ctx, island, inw, island.pressure);
  }

  // 6 — grab dents (clipped to the body so the shading never spills out).
  drawGrabDents(ctx, session, rs.islands);
}

/** Interior volume light: one radial gradient per island, centred a quarter
 *  radius toward the studio light from the island centroid, clipped by the
 *  island polygon (the gradient IS the fill of the traced poly). Pure
 *  function of island geometry + pressure — zero idle animation. */
function drawInteriorLight(ctx, island) {
  const p = island.pressure;
  // Pool gloss: 1 at/above rest pressure, linear to 0 at p <= 0.8. Stricter
  // than the rim gloss on purpose — the volume light dies with a deflation.
  const poolGloss = p < 1 ? Math.max(0, 1 - (1 - p) / 0.2) : 1;
  if (poolGloss <= 0) return;
  const pts = island.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0;
  for (const q of pts) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    cx += q.x; cy += q.y;
  }
  cx /= pts.length; cy /= pts.length;
  const R = 0.75 * Math.max(maxX - minX, maxY - minY);
  if (!(R > 1e-6)) return;
  const lx = cx + LIGHT_X * 0.25 * R, ly = cy + LIGHT_Y * 0.25 * R;
  const A = 0.09 * poolGloss;
  const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
  grad.addColorStop(0, `rgba(224,255,245,${A.toFixed(3)})`);
  grad.addColorStop(0.55, `rgba(224,255,245,${(A * 0.35).toFixed(3)})`);
  grad.addColorStop(1, 'rgba(224,255,245,0)');
  tracePoly(ctx, pts);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawPipes(ctx, pipes) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pipe of pipes) {
    const pts = pipe.points, n = pts.length;
    // Channel bore: a slightly wider dark pass under the pipe body.
    ctx.strokeStyle = COLORS.pipeCasing;
    ctx.lineWidth = 6.5;
    tracePolyline(ctx, pts, pipe.closed);
    ctx.stroke();
    // Pipe body, segment by segment: colour tracks the segment's real strain.
    ctx.lineWidth = 4.4;
    const segN = pipe.segStrains.length;
    for (let k = 0; k < segN; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      ctx.strokeStyle = pipeStrainColor(pipe.segStrains[k]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    if (!pipe.closed) {
      ctx.fillStyle = COLORS.pipeEnd;
      for (const e of [pts[0], pts[n - 1]]) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Per-edge boundary: tension whitens the stroke, compression carves short
 *  wrinkle ticks perpendicular to the edge (deterministic phase — no RNG,
 *  so nothing flickers between frames). */
function drawBoundary(ctx, island, inw, edgeRamp) {
  const pts = island.points, n = pts.length;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.5;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const s = island.edgeStrains[k] ?? 1;
    ctx.strokeStyle = edgeRamp(s);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (s < 0.97) drawWrinkles(ctx, a, b, k, s, inw);
  }
}

function drawWrinkles(ctx, a, b, k, s, inw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = (-dy / len) * inw, ny = (dx / len) * inw; // inward normal
  const depth = Math.min(1, (0.97 - s) / 0.12);
  const count = 2 + (k & 1); // 2 or 3 ticks, phase fixed by edge index
  ctx.strokeStyle = `rgba(10,26,21,${(0.5 + 0.4 * depth).toFixed(2)})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const f = (i + 1) / (count + 1);
    const px = a.x + dx * f, py = a.y + dy * f;
    const l1 = 2 + 4 + 6 * depth;
    ctx.moveTo(px + nx * 2, py + ny * 2);
    ctx.lineTo(px + nx * l1, py + ny * l1);
  }
  ctx.stroke();
}

/** Thin bright line just inside boundary edges whose outward normal faces the
 *  fixed light — a wet sheen. Brightness grows slightly with edge strain and
 *  fades as the island deflates (a slack membrane loses its gloss): below
 *  rest pressure the alpha is linearly cut down to x0.5 at p<=0.8.
 *  Colour strings come from a quantized cache — zero per-frame churn. */
const HIGHLIGHT_CACHE = [];
function highlightColor(alpha) {
  const q = Math.max(0, Math.min(60, Math.round(alpha * 100)));
  return HIGHLIGHT_CACHE[q] ?? (HIGHLIGHT_CACHE[q] = `rgba(224,255,245,${(q / 100).toFixed(2)})`);
}
function drawWetHighlight(ctx, island, inw, pressure) {
  const pts = island.points, n = pts.length;
  const gloss = pressure < 1 ? 1 - 0.5 * Math.min(1, (1 - pressure) / 0.2) : 1;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.4;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * inw, ny = (dx / len) * inw; // inward
    const facing = -nx * LIGHT_X - ny * LIGHT_Y;         // outward · light
    if (facing < 0.28) continue;
    const s = island.edgeStrains[k] ?? 1;
    const alpha = Math.min(0.6,
      0.14 + (facing - 0.28) * 0.5 + Math.max(0, s - 1) * 1.5) * gloss;
    ctx.strokeStyle = highlightColor(alpha);
    ctx.beginPath();
    ctx.moveTo(a.x + nx * 2.6, a.y + ny * 2.6);
    ctx.lineTo(b.x + nx * 2.6, b.y + ny * 2.6);
    ctx.stroke();
  }
  // Second sheen band: a broad, faint glaze 6 px inside the light-facing rim
  // (facing > 0.45) — the soft body of the specular smear on a cast gel
  // surface. Same quantized colour cache; fades with the island's gloss, so
  // it dies with a deflation like the rim line does.
  const bandColor = highlightColor(0.10 * gloss);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = bandColor;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * inw, ny = (dx / len) * inw;
    const facing = -nx * LIGHT_X - ny * LIGHT_Y;
    if (facing < 0.45) continue;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * 6, a.y + ny * 6);
    ctx.lineTo(b.x + nx * 6, b.y + ny * 6);
    ctx.stroke();
  }
}

/** Finger-press response at each live grab: a radial dark dent around the
 *  grabbed particle plus a small bright bulge arc on the side away from the
 *  pull — pure function of grab state, nothing animates on its own. */
function drawGrabDents(ctx, session, islands) {
  const { ps } = session;
  if (session.grabs.size === 0) return;
  ctx.save();
  ctx.beginPath();
  for (const island of islands) {
    const pts = island.points;
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.clip();
  for (const [, g] of session.grabs) {
    const p = g.particle;
    if (!ps.alive[p]) continue;
    const px = ps.x[p], py = ps.y[p];
    const grad = ctx.createRadialGradient(px, py, 2, px, py, 42);
    grad.addColorStop(0, 'rgba(5,14,11,0.60)');
    grad.addColorStop(0.65, 'rgba(5,14,11,0.24)');
    grad.addColorStop(1, 'rgba(5,14,11,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, 42, 0, Math.PI * 2);
    ctx.fill();
    // Material piles up on the far side of the pull direction.
    const dx = g.x - px, dy = g.y - py;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const ang = Math.atan2(-dy, -dx);
      ctx.strokeStyle = 'rgba(228,255,246,0.50)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 13, ang - 0.85, ang + 0.85);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawControls(ctx, session) {
  const { ps } = session;
  for (const [, g] of session.grabs) {
    if (!ps.alive[g.particle]) continue;
    ctx.strokeStyle = COLORS.grab;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(ps.x[g.particle], ps.y[g.particle]);
    ctx.stroke();
    ctx.fillStyle = COLORS.grab;
    ctx.beginPath();
    ctx.arc(ps.x[g.particle], ps.y[g.particle], 6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const i of session.pins) {
    if (!ps.alive[i]) continue;
    ctx.fillStyle = COLORS.pin;
    ctx.beginPath();
    ctx.arc(ps.x[i], ps.y[i], 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ps.x[i], ps.y[i], 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCutLine(ctx, drag) {
  ctx.save();
  ctx.strokeStyle = COLORS.cut;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(drag.x0, drag.y0);
  ctx.lineTo(drag.x1, drag.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.cut;
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlueSelection(ctx, session, sel, pos) {
  const { ps } = session;
  ctx.save();
  ctx.strokeStyle = COLORS.glue;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  sel.particles.forEach((p, k) => {
    if (k === 0) ctx.moveTo(ps.x[p], ps.y[p]);
    else ctx.lineTo(ps.x[p], ps.y[p]);
  });
  ctx.stroke();
  if (pos) {
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    const c = sel.particles[Math.floor(sel.particles.length / 2)];
    ctx.beginPath();
    ctx.moveTo(ps.x[c], ps.y[c]);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
  ctx.restore();
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function tracePolyline(ctx, pts, closed) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (closed) ctx.closePath();
}

/** Draw a normalized target thumbnail into a small preview canvas. */
export function drawTargetPreview(canvas, spec) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const all = spec.outlines.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const scale = 0.82 * Math.min(W / (maxX - minX + 1), H / (maxY - minY + 1));
  const ox = W / 2 - ((minX + maxX) / 2) * scale;
  const oy = H / 2 - ((minY + maxY) / 2) * scale;
  const T = p => ({ x: p.x * scale + ox, y: p.y * scale + oy });
  for (const poly of spec.outlines) {
    tracePoly(ctx, poly.map(T));
    ctx.fillStyle = 'rgba(232,198,106,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,198,106,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(170,182,198,0.95)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const pipe of spec.pipes) {
    tracePolyline(ctx, pipe.points.map(T), pipe.closed);
    ctx.stroke();
  }
}
