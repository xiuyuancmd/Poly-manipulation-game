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
 *  stretching only, so tethered parts can move closer but not further apart. */
export class DistanceConstraint {
  constructor(i, j, rest, compliance = 0, unilateral = false) {
    this.i = i; this.j = j;
    this.rest = rest;
    this.compliance = compliance;
    this.unilateral = unilateral;
    this.broken = false;
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
    const alphaT = this.compliance / (h * h);
    const dl = -C / (w + alphaT);
    dx /= len; dy /= len; dz /= len;
    ps.x[i] -= wi * dl * dx; ps.y[i] -= wi * dl * dy; ps.z[i] -= wi * dl * dz;
    ps.x[j] += wj * dl * dx; ps.y[j] += wj * dl * dy; ps.z[j] += wj * dl * dz;
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
  }
}
