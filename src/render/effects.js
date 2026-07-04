// Short-lived world-space effect particles, spawned from physics events and
// drawn as the top scene layer. Strictly transient — every spark dies well
// under a second and draw() exits immediately when nothing is alive, so an
// idle scene costs (and animates) nothing. All randomness is seeded once per
// event from its time and place; nothing is re-rolled per frame.
//
// Three effects, all purely mechanical:
//   deflate  -> cone of escaping air along the outward jet direction
//   snap     -> dark shards scattering from the fracture point
//   rejected -> a fading white scuff where the blade skidded off, + caption

const TAU = Math.PI * 2;

/** mulberry32 — tiny deterministic PRNG (seeded per spawn, never per frame). */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Effects {
  constructor() {
    this.sparks = [];    // {x,y,vx,vy,age,life,size,color,drag}
    this.scratches = []; // {x0,y0,x1,y1,age,life}
    this.labels = [];    // {x,y,text,age,life}
  }

  get active() {
    return this.sparks.length > 0 || this.scratches.length > 0 || this.labels.length > 0;
  }

  spawnFromEvent(e) {
    if (e.type === 'deflate' && Number.isFinite(e.x) && Number.isFinite(e.y)) {
      this.spawnJet(e.x, e.y, e.dirX ?? 1, e.dirY ?? 0);
    } else if (e.type === 'snap' && Number.isFinite(e.x) && Number.isFinite(e.y)) {
      this.spawnDebris(e.x, e.y);
    } else if (e.type === 'rejected' && Number.isFinite(e.x0) && Number.isFinite(e.y0)) {
      this.spawnRejection(e.x0, e.y0, e.x1 ?? e.x0 + 1, e.y1 ?? e.y0);
    }
  }

  seed(x, y) {
    return (Date.now() & 0xfffff)
      ^ (Math.round(x * 1000) * 73856093)
      ^ (Math.round(y * 1000) * 19349663);
  }

  /** deflate: 12–18 pale air particles blasting out along `dir`, slowing down. */
  spawnJet(x, y, dirX, dirY) {
    const rng = makeRng(this.seed(x, y));
    const base = Math.atan2(dirY, dirX);
    const n = 12 + Math.floor(rng() * 7);
    for (let i = 0; i < n; i++) {
      const ang = base + (rng() - 0.5) * 0.9; // tight cone
      const sp = 130 + rng() * 160;
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        age: 0, life: 0.35 + rng() * 0.35,
        size: 1.2 + rng() * 1.6,
        color: rng() < 0.5 ? 'rgb(224,246,255)' : 'rgb(255,255,255)',
        drag: 2.6,
      });
    }
  }

  /** snap: 6–10 dark shards scattering from the break point. */
  spawnDebris(x, y) {
    const rng = makeRng(this.seed(x, y));
    const n = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const ang = rng() * TAU;
      const sp = 70 + rng() * 130;
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        age: 0, life: 0.3 + rng() * 0.3,
        size: 1.4 + rng() * 1.8,
        color: 'rgb(30,41,38)',
        drag: 1.6,
      });
    }
  }

  /** rejected: white scuff along the blade direction (clamped to 40 px)
   *  fading over 0.5 s, plus a 12 px caption fading over 0.9 s. */
  spawnRejection(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const l = Math.min(40, len);
    this.scratches.push({
      x0, y0,
      x1: x0 + (dx / len) * l,
      y1: y0 + (dy / len) * l,
      age: 0, life: 0.5,
    });
    this.labels.push({ x: x0 + 14, y: y0 - 14, text: '只能从外部下刀', age: 0, life: 0.9 });
  }

  update(dt) {
    if (!this.active) return;
    const sparks = this.sparks;
    let w = 0;
    for (const p of sparks) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      sparks[w++] = p;
    }
    sparks.length = w;
    this.scratches = this.scratches.filter(s => (s.age += dt) < s.life);
    this.labels = this.labels.filter(s => (s.age += dt) < s.life);
  }

  draw(ctx) {
    if (!this.active) return; // idle scene: zero cost, zero animation
    ctx.save();
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.max(0, (1 - p.age / p.life) * 0.85);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (const s of this.scratches) {
      ctx.globalAlpha = Math.max(0, (1 - s.age / s.life) * 0.8);
      ctx.strokeStyle = 'rgb(255,255,255)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    }
    for (const l of this.labels) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - l.age / l.life) * 1.4));
      ctx.fillStyle = 'rgb(255,236,230)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(l.text, l.x, l.y);
    }
    ctx.restore();
  }
}
