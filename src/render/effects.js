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
    this.emitters = [];  // {x,y,base,rng,age,life,rate,carry} — sustained jets
    this.whips = [];     // {pts:[{x,y}...],age,life} — cable recoil after-images
  }

  get active() {
    return this.sparks.length > 0 || this.scratches.length > 0 || this.labels.length > 0
      || this.emitters.length > 0 || this.whips.length > 0;
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

  /** deflate: an 8–10 particle first-frame burst along `dir`, then a 0.45 s
   *  emitter keeps blowing ~150 particles/s (2–3 per frame) out of the cut —
   *  a pressure loop does not empty in one frame. Everything is dead well
   *  under a second after the emitter stops. */
  spawnJet(x, y, dirX, dirY) {
    const rng = makeRng(this.seed(x, y));
    const base = Math.atan2(dirY, dirX);
    const burst = 8 + Math.floor(rng() * 3);
    for (let i = 0; i < burst; i++) this.jetSpark(x, y, base, rng);
    this.emitters.push({ x, y, base, rng, age: 0, life: 0.45, rate: 150, carry: 0 });
  }

  /** One escaping-air particle in a ±0.45 rad cone around `base`. */
  jetSpark(x, y, base, rng) {
    const ang = base + (rng() - 0.5) * 0.9;
    const sp = 130 + rng() * 160; // 130–290 px/s
    this.sparks.push({
      x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      age: 0, life: 0.3 + rng() * 0.35, // <= 0.65 s
      size: 1.2 + rng() * 1.6,
      color: rng() < 0.5 ? 'rgb(224,246,255)' : 'rgb(255,255,255)',
      drag: 2.6,
    });
  }

  /** Cable recoil after-image: fading, thinning snapshots of the severed
   *  fragments' polylines (0.45 s one-shot; polylines are copied). */
  spawnWhip(polylines) {
    for (const pts of polylines ?? []) {
      if (!pts || pts.length < 2) continue;
      this.whips.push({ pts: pts.map(p => ({ x: p.x, y: p.y })), age: 0, life: 0.45 });
    }
  }

  /** snap: 14–18 bright shards scattering from the break point — fresh
   *  fracture faces catch the light, so they read pale grey-white / faint
   *  cyan against the dark bench, falling under gravity onto a per-particle
   *  virtual micro-facet 12–22 px below the spawn (seeded); ONE damped bounce
   *  there, the second contact snuffs the shard. Dead within 0.65 s. */
  spawnDebris(x, y) {
    const rng = makeRng(this.seed(x, y));
    const n = 14 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const ang = rng() * TAU;
      const sp = 70 + rng() * 130;
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        age: 0, life: 0.35 + rng() * 0.3,
        size: 1.4 + rng() * 1.8,
        color: rng() < 0.5 ? 'rgb(226,234,236)' : 'rgb(188,226,222)',
        w: 1.4 + rng() * 1.8, // seeded stroke width, 1.4–3.2 px
        drag: 1.6,
        ay: 600,
        floor: y + 12 + rng() * 10,
        bounced: false,
      });
    }
  }

  /** Fracture sparks (pipe snip): 10–12 bright blue-white 3 px streaks. */
  spawnSparks(x, y) {
    const rng = makeRng(this.seed(x, y));
    const n = 10 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const ang = rng() * TAU;
      const sp = 120 + rng() * 140;
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        age: 0, life: 0.25 + rng() * 0.2,
        size: 2,
        color: rng() < 0.5 ? 'rgb(214,238,255)' : 'rgb(255,255,255)',
        w: 3,
        drag: 3.2,
      });
    }
  }

  /** rejected: white scuff along the blade direction (clamped to 40 px)
   *  fading over 0.5 s, plus a 14 px caption fading over 1.05 s. */
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
    this.labels.push({ x: x0 + 14, y: y0 - 14, text: '只能从外部下刀', age: 0, life: 1.05 });
  }

  update(dt) {
    if (!this.active) return;
    // Emitters run BEFORE the ageing pass, so one large catch-up step also
    // ages whatever it just emitted — no particle can outlive a big dt.
    let we = 0;
    for (const em of this.emitters) {
      em.carry += Math.min(em.rate * dt, 8); // per-call cap
      while (em.carry >= 1) {
        em.carry -= 1;
        this.jetSpark(em.x, em.y, em.base, em.rng);
      }
      em.age += dt;
      if (em.age < em.life) this.emitters[we++] = em;
    }
    this.emitters.length = we;
    const sparks = this.sparks;
    let w = 0;
    for (const p of sparks) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k;
      if (p.ay) p.vy += p.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      // Virtual micro-facet under debris: one damped bounce, then snuff on
      // the second contact (deterministic — floor was seeded at spawn).
      if (p.floor != null && p.y >= p.floor && p.vy > 0) {
        if (p.bounced) continue; // second touch: dead, don't keep
        p.bounced = true;
        p.y = p.floor;
        p.vy = -p.vy * 0.4;
      }
      sparks[w++] = p;
    }
    sparks.length = w;
    this.scratches = this.scratches.filter(s => (s.age += dt) < s.life);
    this.labels = this.labels.filter(s => (s.age += dt) < s.life);
    this.whips = this.whips.filter(s => (s.age += dt) < s.life);
  }

  draw(ctx) {
    if (!this.active) return; // idle scene: zero cost, zero animation
    ctx.save();
    ctx.lineCap = 'round';
    // Sparks as short motion-trail segments, read as streaks not dots.
    // Per-particle stroke width when seeded at spawn; 2 px otherwise (the
    // pressure-jet particles carry no `w` and keep their reference look).
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.max(0, (1 - p.age / p.life) * 0.85);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.w ?? 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
    // Cable-recoil after-images: fading, thinning polyline snapshots in a
    // bright cyan-white (reads against the matrix green even at speed).
    for (const wp of this.whips) {
      const f = Math.max(0, 1 - wp.age / wp.life);
      ctx.globalAlpha = f * 0.9;
      ctx.strokeStyle = 'rgb(200,255,240)';
      ctx.lineWidth = 1 + 4 * f; // 5 -> 1
      ctx.beginPath();
      wp.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    for (const s of this.scratches) {
      // Blade-skid shiver: a deterministic, decaying sine offset (±2 px,
      // pure function of age — no RNG, dead in 0.5 s with the scratch).
      const f = 1 - s.age / s.life;
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      const len = Math.hypot(dx, dy) || 1;
      const off = 2 * f * Math.sin(s.age * 45);
      const ox = (-dy / len) * off, oy = (dx / len) * off;
      ctx.globalAlpha = Math.max(0, f * 0.8);
      ctx.strokeStyle = 'rgb(255,255,255)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x0 + ox, s.y0 + oy);
      ctx.lineTo(s.x1 + ox, s.y1 + oy);
      ctx.stroke();
    }
    for (const l of this.labels) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - l.age / l.life) * 1.4));
      ctx.fillStyle = 'rgb(255,236,230)';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(l.text, l.x, l.y);
    }
    ctx.restore();
  }
}
