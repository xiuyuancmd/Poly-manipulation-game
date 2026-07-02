// Canvas 2D renderer for soft-body levels. Pure drawing: reads session/body
// state, never mutates it. Pipes all render identically — their material is
// the level's hidden secret.

export const COLORS = {
  bg: '#14171c',
  grid: 'rgba(255,255,255,0.035)',
  bodyFill: 'rgba(56,116,98,0.92)',
  bodyStroke: '#7ee0c3',
  pipe: '#aab6c6',
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

export function drawScene(ctx, session, view = {}) {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx);
  if (view.ghost) drawGhost(ctx, view.ghost);
  drawBody(ctx, session);
  drawControls(ctx, session);
  if (view.cutDrag) drawCutLine(ctx, view.cutDrag);
  if (view.glueSel) drawGlueSelection(ctx, session, view.glueSel, view.gluePos);
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

function drawBody(ctx, session) {
  const { body, ps } = session;
  for (const island of body.aliveIslands()) {
    const pts = body.ringPoints(island);
    tracePoly(ctx, pts);
    ctx.fillStyle = COLORS.bodyFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.bodyStroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  // Welds as stitches.
  ctx.strokeStyle = COLORS.weld;
  ctx.lineWidth = 2;
  for (const w of body.welds) {
    const mx = (ps.x[w.a] + ps.x[w.b]) / 2, my = (ps.y[w.a] + ps.y[w.b]) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Pipes: identical look for every material type.
  for (const chain of body.pipeChains()) {
    ctx.strokeStyle = COLORS.pipe;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracePolyline(ctx, chain.points, chain.closed);
    ctx.stroke();
    if (!chain.closed) {
      ctx.fillStyle = COLORS.pipeEnd;
      for (const e of [chain.points[0], chain.points[chain.points.length - 1]]) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
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
