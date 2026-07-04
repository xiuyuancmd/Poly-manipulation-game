// Minimal XPBD (extended position-based dynamics) solver, 3D-native.
// 2D bodies simply keep z = 0. Small-steps scheme: many substeps, one
// constraint iteration per substep (Macklin et al. 2019).

export class ParticleSystem {
  constructor() {
    this.x = []; this.y = []; this.z = [];
    this.px = []; this.py = []; this.pz = [];
    this.vx = []; this.vy = []; this.vz = [];
    this.invMass = [];
    this.baseInvMass = [];
    this.alive = [];
  }

  get count() { return this.x.length; }

  add(x, y, z = 0, invMass = 1) {
    this.x.push(x); this.y.push(y); this.z.push(z);
    this.px.push(x); this.py.push(y); this.pz.push(z);
    this.vx.push(0); this.vy.push(0); this.vz.push(0);
    this.invMass.push(invMass);
    this.baseInvMass.push(invMass);
    this.alive.push(true);
    return this.x.length - 1;
  }

  kill(i) { this.alive[i] = false; this.vx[i] = this.vy[i] = this.vz[i] = 0; }

  pin(i) { this.invMass[i] = 0; }
  unpin(i) { this.invMass[i] = this.baseInvMass[i]; }
  isPinned(i) { return this.invMass[i] === 0 && this.baseInvMass[i] !== 0; }
}

/** Distance constraint between two particles. `unilateral` = rope: resists
 *  stretching only, so tethered parts can move closer but not further apart.
 *
 *  Optional viscoelastic material opts (all default OFF = legacy behaviour):
 *    creepK      1/s — SLS creep: sustained stretch migrates `rest` toward the
 *                current length (tissue flows under held load);
 *    recoverK    1/s — `rest` relaxes back toward the built rest0 once the
 *                load is gone (no permanent set unless held very long);
 *    creepOnset  strain dead zone: |len/rest0 - 1| <= onset only recovers,
 *                never creeps (small handling doesn't remodel the membrane);
 *    restLo/Hi   clamp on rest as a fraction of rest0 (runaway guard);
 *    hardenK/hardenOnset — J-curve collagen recruitment: above `hardenOnset`
 *                strain the effective compliance divides by
 *                (1 + hardenK·excess²), so large stretches lock up.
 *  relax() is only ever called when the owning Solver has viscoelastic=true.
 *
 *  Optional ACTIVE contraction (muscle) opts.active (default absent = passive
 *  spring, bit-exact legacy behaviour). When present the constraint is a
 *  contractile fibre driven once per frame by updateActivation():
 *    riseK   1/s — tetanic rise rate of activation a toward its force-length
 *                target (τ ≈ 1/riseK); a∈[0,1], built a=1 (pre-tensioned);
 *    flK, flMin  — force-length falloff: over-stretched fibres can't pull
 *                (aStar = clamp(1 − flK·max(0, s−1), flMin, 1), s=len/rest0c);
 *    softK   — activation softening: solve() multiplies compliance by
 *                (1 + softK·(1 − a)), so a relaxed/denervated fibre goes limp;
 *    slack   1/restFactor — the fully-relaxed rest as a multiple of rest0c.
 *  `rest` migrates between rest0c (a=1, contracted) and slack·rest0c (a=0). */
export class DistanceConstraint {
  constructor(i, j, rest, compliance = 0, unilateral = false, opts = {}) {
    this.i = i; this.j = j;
    this.rest = rest;
    this.rest0 = rest;
    this.compliance = compliance;
    this.unilateral = unilateral;
    this.broken = false;
    this.creepK = opts.creepK ?? 0;
    this.recoverK = opts.recoverK ?? 0;
    this.creepOnset = opts.creepOnset ?? 0;
    this.restLo = opts.restLo ?? 0.5;
    this.restHi = opts.restHi ?? 2.0;
    this.hardenK = opts.hardenK ?? 0;
    this.hardenOnset = opts.hardenOnset ?? 0;
    // Active contraction state: null unless opts.active is supplied (bio
    // contractile pipes only). `rest` is the contracted built length (already
    // ×restFactor); slack·rest0c is the fully-relaxed length. den = denervated
    // (severed distal fragment goes limp: activation target forced to 0).
    if (opts.active) {
      this._act = {
        rest0c: rest,
        slack: opts.active.slack,
        a: 1,
        den: false,
        riseK: opts.active.riseK ?? 0,
        flK: opts.active.flK ?? 0,
        flMin: opts.active.flMin ?? 0,
      };
      this.actSoftK = opts.active.softK ?? 0;
    } else {
      this._act = null;
      this.actSoftK = 0;
    }
  }

  solve(ps, h) {
    const { i, j } = this;
    const wi = ps.invMass[i], wj = ps.invMass[j];
    const w = wi + wj;
    if (w === 0) return;
    let dx = ps.x[j] - ps.x[i], dy = ps.y[j] - ps.y[i], dz = ps.z[j] - ps.z[i];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return;
    const C = len - this.rest;
    if (this.unilateral && C < 0) return;
    // J-curve hardening: hardenK = 0 takes the exact legacy arithmetic.
    let compliance = this.compliance;
    if (this.hardenK) {
      const excess = Math.max(0, len / this.rest - 1 - this.hardenOnset);
      compliance = this.compliance / (1 + this.hardenK * excess * excess);
    }
    // Active softening: a relaxed / denervated muscle fibre (a -> 0) goes limp.
    // actSoftK = 0 (all passive constraints) takes the exact legacy arithmetic.
    if (this.actSoftK) compliance *= (1 + this.actSoftK * (1 - this._act.a));
    const alphaT = compliance / (h * h);
    const dl = -C / (w + alphaT);
    dx /= len; dy /= len; dz /= len;
    ps.x[i] -= wi * dl * dx; ps.y[i] -= wi * dl * dy; ps.z[i] -= wi * dl * dz;
    ps.x[j] += wj * dl * dx; ps.y[j] += wj * dl * dy; ps.z[j] += wj * dl * dz;
  }

  /** SLS viscoelastic rest-length migration (once per FRAME, driven by the
   *  Solver when viscoelastic=true). d(rest)/dt = creepK·(len - rest)
   *  - recoverK·(rest - rest0), with a strain dead zone (below creepOnset the
   *  membrane only recovers) and a hard [restLo, restHi]×rest0 clamp. */
  relax(ps, dt) {
    if (!this.creepK && !this.recoverK) return;
    if (this.rest0 < 1e-9) return;
    const len = Math.hypot(
      ps.x[this.j] - ps.x[this.i],
      ps.y[this.j] - ps.y[this.i],
      ps.z[this.j] - ps.z[this.i],
    );
    let d = -this.recoverK * (this.rest - this.rest0);
    if (Math.abs(len / this.rest0 - 1) > this.creepOnset) d += this.creepK * (len - this.rest);
    if (d === 0) return;
    this.rest += d * dt;
    const lo = this.restLo * this.rest0, hi = this.restHi * this.rest0;
    if (this.rest < lo) this.rest = lo;
    else if (this.rest > hi) this.rest = hi;
  }

  /** Active-contraction rest migration (once per FRAME, driven by the body's
   *  update() for bio contractile pipes). No-op unless opts.active was given.
   *    s     = len / rest0c (strain against the CONTRACTED built length);
   *    aStar = den ? 0 : clamp(1 − flK·max(0, s−1), flMin, 1)  (force-length);
   *    a    += (aStar − a)·min(1, riseK·dt)                    (tetanic rise);
   *    rest  = rest0c·(slack − a·(slack−1)), clamped to [rest0c, slack·rest0c].
   *  a→1 pulls `rest` to the contracted length; a→0 lets it slacken. */
  updateActivation(ps, dt) {
    if (!this._act) return;
    const act = this._act;
    const rest0c = act.rest0c;
    if (rest0c < 1e-9) return;
    const len = Math.hypot(
      ps.x[this.j] - ps.x[this.i],
      ps.y[this.j] - ps.y[this.i],
      ps.z[this.j] - ps.z[this.i],
    );
    const s = len / rest0c;
    const aStar = act.den ? 0 : Math.min(1, Math.max(act.flMin, 1 - act.flK * Math.max(0, s - 1)));
    act.a += (aStar - act.a) * Math.min(1, act.riseK * dt);
    const slack = act.slack;
    let rest = rest0c * (slack - act.a * (slack - 1));
    const hi = slack * rest0c;
    if (rest < rest0c) rest = rest0c;
    else if (rest > hi) rest = hi;
    this.rest = rest;
  }

  currentStrain(ps) {
    const len = Math.hypot(ps.x[this.j] - ps.x[this.i], ps.y[this.j] - ps.y[this.i], ps.z[this.j] - ps.z[this.i]);
    return this.rest < 1e-9 ? 0 : len / this.rest;
  }
}

/** Pulls one particle toward a movable target point (used for mouse grabs). */
export class AnchorConstraint {
  constructor(i, tx, ty, tz = 0, compliance = 1e-4) {
    this.i = i;
    this.tx = tx; this.ty = ty; this.tz = tz;
    this.compliance = compliance;
    this.broken = false;
  }

  setTarget(x, y, z = 0) { this.tx = x; this.ty = y; this.tz = z; }

  solve(ps, h) {
    const i = this.i;
    const w = ps.invMass[i];
    if (w === 0) return;
    let dx = this.tx - ps.x[i], dy = this.ty - ps.y[i], dz = this.tz - ps.z[i];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return;
    const alphaT = this.compliance / (h * h);
    const dl = len / (w + alphaT) * w;
    const f = dl / len;
    ps.x[i] += dx * f; ps.y[i] += dy * f; ps.z[i] += dz * f;
  }
}

/**
 * Polygon area constraint over an ordered ring of particle indices (2D, xy plane).
 * Acts as incompressible-gel / balloon pressure: targetArea is settable at runtime.
 */
export class AreaConstraint2D {
  constructor(ring, targetArea, compliance = 1e-6) {
    this.ring = ring;            // shared, mutable array of particle indices
    this.targetArea = targetArea;
    this.compliance = compliance;
    this.broken = false;
  }

  solve(ps, h) {
    const ring = this.ring;
    const n = ring.length;
    if (n < 3) return;
    let area = 0;
    for (let k = 0; k < n; k++) {
      const p = ring[k], q = ring[(k + 1) % n];
      area += ps.x[p] * ps.y[q] - ps.x[q] * ps.y[p];
    }
    area /= 2;
    const C = area - this.targetArea;
    // Gradient of the signed area wrt vertex k.
    let denom = 0;
    for (let k = 0; k < n; k++) {
      const prev = ring[(k - 1 + n) % n], next = ring[(k + 1) % n];
      const gx = 0.5 * (ps.y[next] - ps.y[prev]);
      const gy = 0.5 * (ps.x[prev] - ps.x[next]);
      denom += ps.invMass[ring[k]] * (gx * gx + gy * gy);
    }
    const alphaT = this.compliance / (h * h);
    if (denom + alphaT < 1e-12) return;
    const dl = -C / (denom + alphaT);
    for (let k = 0; k < n; k++) {
      const i = ring[k];
      const w = ps.invMass[i];
      if (w === 0) continue;
      const prev = ring[(k - 1 + n) % n], next = ring[(k + 1) % n];
      ps.x[i] += w * dl * 0.5 * (ps.y[next] - ps.y[prev]);
      ps.y[i] += w * dl * 0.5 * (ps.x[prev] - ps.x[next]);
    }
  }

  currentArea(ps) {
    let area = 0;
    const ring = this.ring, n = ring.length;
    for (let k = 0; k < n; k++) {
      const p = ring[k], q = ring[(k + 1) % n];
      area += ps.x[p] * ps.y[q] - ps.x[q] * ps.y[p];
    }
    return area / 2;
  }
}

/** Closed-triangle-mesh volume constraint (3D bodies). tris = flat index triples. */
export class VolumeConstraint3D {
  constructor(tris, targetVolume, compliance = 1e-6) {
    this.tris = tris;
    this.targetVolume = targetVolume;
    this.compliance = compliance;
    this.broken = false;
    this._grad = new Map();
  }

  static meshVolume(ps, tris) {
    let v = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      v += (ps.x[a] * (ps.y[b] * ps.z[c] - ps.z[b] * ps.y[c])
          - ps.y[a] * (ps.x[b] * ps.z[c] - ps.z[b] * ps.x[c])
          + ps.z[a] * (ps.x[b] * ps.y[c] - ps.y[b] * ps.x[c]));
    }
    return v / 6;
  }

  solve(ps, h) {
    const tris = this.tris;
    const V = VolumeConstraint3D.meshVolume(ps, tris);
    const C = V - this.targetVolume;
    const grad = this._grad;
    grad.clear();
    const addG = (i, gx, gy, gz) => {
      let g = grad.get(i);
      if (!g) { g = [0, 0, 0]; grad.set(i, g); }
      g[0] += gx; g[1] += gy; g[2] += gz;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      // dV/da = (b x c)/6 etc.
      addG(a, (ps.y[b] * ps.z[c] - ps.z[b] * ps.y[c]) / 6,
              (ps.z[b] * ps.x[c] - ps.x[b] * ps.z[c]) / 6,
              (ps.x[b] * ps.y[c] - ps.y[b] * ps.x[c]) / 6);
      addG(b, (ps.y[c] * ps.z[a] - ps.z[c] * ps.y[a]) / 6,
              (ps.z[c] * ps.x[a] - ps.x[c] * ps.z[a]) / 6,
              (ps.x[c] * ps.y[a] - ps.y[c] * ps.x[a]) / 6);
      addG(c, (ps.y[a] * ps.z[b] - ps.z[a] * ps.y[b]) / 6,
              (ps.z[a] * ps.x[b] - ps.x[a] * ps.z[b]) / 6,
              (ps.x[a] * ps.y[b] - ps.y[a] * ps.x[b]) / 6);
    }
    let denom = 0;
    for (const [i, g] of grad) denom += ps.invMass[i] * (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
    const alphaT = this.compliance / (h * h);
    if (denom + alphaT < 1e-12) return;
    const dl = -C / (denom + alphaT);
    for (const [i, g] of grad) {
      const w = ps.invMass[i];
      if (w === 0) continue;
      ps.x[i] += w * dl * g[0];
      ps.y[i] += w * dl * g[1];
      ps.z[i] += w * dl * g[2];
    }
  }
}

const MAX_SPEED = 4000; // units/s, explosion guard

export class Solver {
  constructor(ps) {
    this.ps = ps;
    this.constraints = new Set();
    this.substeps = 8;
    this.damping = 0.982;   // per-frame velocity retain factor
    // Viscoelastic material pass: OFF by default (legacy behaviour). When on,
    // constraints exposing relax() migrate their rest state once per frame.
    this.viscoelastic = false;
  }

  add(c) { this.constraints.add(c); return c; }
  remove(c) { c.broken = true; this.constraints.delete(c); }

  step(dt) {
    const ps = this.ps;
    const n = ps.count;
    const h = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      for (let i = 0; i < n; i++) {
        if (!ps.alive[i]) continue;
        ps.px[i] = ps.x[i]; ps.py[i] = ps.y[i]; ps.pz[i] = ps.z[i];
        if (ps.invMass[i] === 0) continue;
        ps.x[i] += ps.vx[i] * h;
        ps.y[i] += ps.vy[i] * h;
        ps.z[i] += ps.vz[i] * h;
      }
      for (const c of this.constraints) {
        if (!c.broken) c.solve(ps, h);
      }
      const invH = 1 / h;
      for (let i = 0; i < n; i++) {
        if (!ps.alive[i] || ps.invMass[i] === 0) continue;
        let vx = (ps.x[i] - ps.px[i]) * invH;
        let vy = (ps.y[i] - ps.py[i]) * invH;
        let vz = (ps.z[i] - ps.pz[i]) * invH;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > MAX_SPEED) { const f = MAX_SPEED / sp; vx *= f; vy *= f; vz *= f; }
        ps.vx[i] = vx; ps.vy[i] = vy; ps.vz[i] = vz;
      }
    }
    const d = this.damping;
    for (let i = 0; i < n; i++) {
      if (!ps.alive[i]) continue;
      ps.vx[i] *= d; ps.vy[i] *= d; ps.vz[i] *= d;
    }
    // Viscoelastic rest migration: once per FRAME (not per substep), so the
    // creep rates in the material profiles read directly in 1/s.
    if (this.viscoelastic) {
      for (const c of this.constraints) {
        if (!c.broken) c.relax?.(ps, dt);
      }
    }
  }
}
