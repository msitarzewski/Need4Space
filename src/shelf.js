// The ice shelf: a slab of glacier ice ~270 m thick standing out of the frozen sea south of the circuit, split from
// top to bottom by the crevasse the track runs down. Its walls stand a few metres off the barriers - banded blue ice,
// scalloped by meltwater, veined with light - leaning in overhead until the sky is a slit, and closing under the deck
// to a slot lit from the water far below; bridges of ice span it. Round the outside, sheer calving cliffs with frozen
// falls down them; out in front of its western face the bergs it has calved, in sea ice broken into floes (glacier.js
// draws the open water between them).
// Each half of the shelf is one surface: its face (the crevasse's wall, then on round the cliffs and back to the wall)
// swept up from under the sea ice to a rounded lip, and the lip's inner ring closed over as its top - the same
// vertices, no seam. Static: lit by the sun and the sky alone and the world's shadow map (spires.js glacierMaterial).
import * as THREE from 'three';
import { TRACK_W } from './track.js';
import { fbm3, noise3, sweptIce, frozenFall } from './spires.js';
import { fbm, noise2, mulberry32, smoothstep } from './noise.js';

const EDGE = TRACK_W / 2 + 0.7;            // the barrier's outer face from the centre line (m)
const BOT = -40;                           // the faces' foot, under the sea ice
const LEVELS = 54;                         // rows up a face

export function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export class IceShelf {
  // outline: [[x, z]] round the shelf (coarse - the coast is roughened); span: [s0, s1] on the lap, where the track
  // crosses the outline (in at one face, out at another)
  constructor(track, outline, span, { top = 265, seed = 5 } = {}) {
    this.track = track;
    this.top = top;
    const f = {};
    // the coast: smooth through the outline, a point every ~8 m, roughened along its normal
    const curve = new THREE.CatmullRomCurve3(outline.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const N = Math.round(curve.getLength() / 8), raw = curve.getSpacedPoints(N).slice(0, N);
    this.coast = raw.map((p, i) => {
      const a = raw[(i + N - 1) % N], b = raw[(i + 1) % N], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz);
      const d = 70 * (fbm(p.x / 420 + seed, p.z / 420, 4) - 0.5) + 16 * (noise2(p.x / 50, p.z / 50) - 0.5);
      return [p.x + (tz / l) * d, p.z - (tx / l) * d];
    });
    const coast = this.coast, inside = (x, z) => inPoly(coast, x, z);
    // where the track runs inside it
    let sIn = null, sOut = null;
    for (let s = span[0]; s < span[1]; s += 2) {
      track.frame(s, f);
      if (inside(f.P.x, f.P.z)) { if (sIn === null) sIn = s; sOut = s; }
    }
    this.sIn = sIn; this.sOut = sOut;
    // the crevasse: how far each wall stands off the barrier (opening out at the mouths), how far it leans in overhead
    const mouth = (s) => smoothstep(80, 0, Math.min(s - sIn, sOut - s));
    this.gap = (s, sd) => 9 + 14 * noise2(s * 0.009 + sd * 13.7, 3.1) + 22 * mouth(s);
    this.lean = (s, sd) => (-0.3 + 1.3 * noise2(s * 0.006 + sd * 5.3, 8.8)) * (1 - mouth(s));
    this.topAt = (x, z) => top + 24 * (fbm(x / 500 + 3, z / 500, 3) - 0.5);
    // each wall's foot line: the run of it inside the coast
    const walls = [-1, 1].map((sd) => {
      const pts = [];
      for (let s = sIn - 120; s <= sOut + 120; s += 4) {
        track.frame(s, f);
        const rl = Math.hypot(f.R.x, f.R.z), w = EDGE + this.gap(s, sd);
        const x = f.P.x + (f.R.x / rl) * sd * w, z = f.P.z + (f.R.z / rl) * sd * w;
        if (inside(x, z)) pts.push({ x, z, s, sd, yd: f.P.y, w, wall: 1 });
      }
      return pts;
    });
    // the coast either side of the crevasse: each point's side of it (0 in its mouths)
    const samples = [];
    for (let s = sIn - 160; s <= sOut + 160; s += 6) { track.frame(s, f); samples.push({ s, x: f.P.x, z: f.P.z, rx: f.R.x, rz: f.R.z }); }
    const sideOf = coast.map(([x, z]) => {
      let best = 1e18, q = null;
      for (const c of samples) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < best) { best = d; q = c; } }
      const lat = ((x - q.x) * q.rx + (z - q.z) * q.rz) / Math.hypot(q.rx, q.rz), sd = Math.sign(lat);
      return Math.abs(lat) < EDGE + this.gap(Math.min(sOut, Math.max(sIn, q.s)), sd) + 10 ? 0 : sd;
    });
    this.pieces = walls.map((W, k) => this.piece(W, this.run(sideOf, k ? 1 : -1)));
  }

  // the longest cyclic run of the coast's points on side sd
  run(sideOf, sd) {
    const n = sideOf.length;
    let start = sideOf.findIndex((v) => v !== sd);
    if (start < 0) start = 0;
    let best = [], cur = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (sideOf[i] === sd) cur.push(i); else { if (cur.length > best.length) best = cur; cur = []; }
    }
    if (cur.length > best.length) best = cur;
    return best;
  }

  // one half: its outline (the wall's foot, then the coast back round to it), each point's outward normal, and how
  // much of the crevasse's wall it is (eased over the corners)
  piece(W, run) {
    let arc = run.map((i) => ({ x: this.coast[i][0], z: this.coast[i][1], wall: 0 }));
    const end = W[W.length - 1], d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
    if (d2(arc[arc.length - 1], end) < d2(arc[0], end)) arc.reverse();
    const poly = [...W.map((p) => ({ ...p })), ...arc], n = poly.length, nw = W.length;
    // the coast takes its crevasse numbers from the nearer end of the wall (the faces' shapes blend over the corners)
    for (let i = nw; i < n; i++) {
      const q = d2(poly[i], W[0]) < d2(poly[i], end) ? W[0] : end;
      Object.assign(poly[i], { s: q.s, sd: q.sd, yd: q.yd, w: q.w });
    }
    // the corners rounded
    for (const j of [nw - 1, n - 1]) {
      for (let pass = 0; pass < 6; pass++) {
        const old = poly.map((p) => [p.x, p.z]);
        for (let k = -6; k <= 6; k++) {
          const i = (j + k + n) % n, a = old[(i + n - 1) % n], b = old[(i + 1) % n];
          poly[i].x = (a[0] + 2 * old[i][0] + b[0]) / 4; poly[i].z = (a[1] + 2 * old[i][1] + b[1]) / 4;
        }
      }
    }
    let wk = poly.map((p) => p.wall);
    for (let pass = 0; pass < 3; pass++) wk = wk.map((_, i) => { let a = 0; for (let k = -5; k <= 5; k++) a += wk[(i + k + n) % n]; return a / 11; });
    // outward: away from the inside (the polygon's turning sense)
    let area = 0;
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.x * b.z - b.x * a.z; }
    const sg = area > 0 ? 1 : -1;
    poly.forEach((p, i) => {
      const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      p.nx = (sg * tz) / l; p.nz = (-sg * tx) / l; p.wk = wk[i];
    });
    return poly;
  }

  // how far the face stands out (along its normal) at height h: the crevasse's wall (into the crevasse: closing under
  // the deck, clear of the track round it, leaning in overhead) blended with the calving cliff (fluted, a shoulder at
  // the top, a foot spreading into the sea ice), scalloped all over
  out(p, h, tp) {
    const { yd, w, wk } = p;
    let dw = smoothstep(yd - 18, yd - 115, h) * (w - 15);
    const up = smoothstep(yd + 24, tp - 6, h);
    dw += Math.min(this.lean(p.s, p.sd) * up * up * (tp - yd) * 0.3, w - 11);     // (a slit of sky left between them)
    let dc = 7 * smoothstep(10, -14, h) - 6 * Math.pow(smoothstep(tp - 30, tp - 2, h), 2);
    dc += 5 * (fbm3(p.x * 0.028, h * 0.009, p.z * 0.028, 3) - 0.5) * 2;
    let d = wk * dw + (1 - wk) * dc + 2.8 * (fbm3(p.x * 0.05 + 3, h * 0.06, p.z * 0.05, 3) - 0.5) * 2;
    if (wk > 0.02 && h > yd - 16 && h < yd + 30) d = Math.min(d, w - (EDGE + 6.5));
    return d;
  }

  // the light through it: the slot under the deck lit from the water, the thin overhangs, veins of clear ice
  glowAt(p, h, tp) {
    const v = smoothstep(0.045, 0, Math.abs(noise3(p.x * 0.02, h * 0.045, p.z * 0.02) - 0.5));
    return 0.22 + 0.2 * noise2(p.x * 0.03, h * 0.03) + p.wk * (1.2 * smoothstep(p.yd - 40, p.yd - 130, h) + 0.3 * smoothstep(p.yd + 40, tp, h)) + 0.9 * v;
  }

  // the surface: both halves, faces and tops
  geometry() {
    const pos = [], glow = [], idx = [];
    for (const poly of this.pieces) {
      const n = poly.length, C = LEVELS + 3, o = pos.length / 3, ring = [];
      for (const p of poly) {
        const tp = this.topAt(p.x, p.z);
        let d = 0;
        for (let k = 0; k < LEVELS; k++) {
          const h = BOT + ((tp - 3 - BOT) * k) / (LEVELS - 1);
          d = this.out(p, h, tp);
          pos.push(p.x + p.nx * d, h, p.z + p.nz * d);
          glow.push(this.glowAt(p, h, tp));
        }
        // the lip: rounded over onto the top
        for (const [dd, dh, g] of [[-3, 0.6, 0.3], [-9, 1.4, 0.2], [-17, 1.0, 0.15]]) {
          pos.push(p.x + p.nx * (d + dd), tp + dh, p.z + p.nz * (d + dd));
          glow.push(g);
        }
        ring.push(new THREE.Vector2(p.x + p.nx * (d - 17), p.z + p.nz * (d - 17)));
      }
      // (the faces look out: along the outline x up against the outward normal)
      const q0 = poly[0], q1 = poly[1], out = (q1.x - q0.x) * q0.nz - (q1.z - q0.z) * q0.nx > 0;
      for (let i = 0; i < n; i++) for (let k = 0; k < C - 1; k++) {
        const a = o + i * C + k, b = o + ((i + 1) % n) * C + k;
        if (out) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      // the top: the lip's inner ring closed over (facing up)
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring, [])) {
        const A = ring[a], B = ring[b], Cc = ring[c], up = (B.y - A.y) * (Cc.x - A.x) - (B.x - A.x) * (Cc.y - A.y);
        if (up > 0) idx.push(o + a * C + C - 1, o + b * C + C - 1, o + c * C + C - 1);
        else idx.push(o + a * C + C - 1, o + c * C + C - 1, o + b * C + C - 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.tris = idx.length / 3;
    return g;
  }

  // a point on a crevasse wall: side sd, at s along the track, h high
  wallPoint(s, sd, h) {
    const f = this.track.frame(s, {}), rl = Math.hypot(f.R.x, f.R.z), w = EDGE + this.gap(s, sd);
    const p = { x: f.P.x + (f.R.x / rl) * sd * w, z: f.P.z + (f.R.z / rl) * sd * w, s, sd, yd: f.P.y, w, wk: 1, nx: (-sd * f.R.x) / rl, nz: (-sd * f.R.z) / rl };
    const d = this.out(p, h, this.topAt(p.x, p.z));
    return { p: new THREE.Vector3(p.x + p.nx * d, h, p.z + p.nz * d), n: new THREE.Vector3(p.nx, 0, p.nz) };
  }

  // bridges of ice across the crevasse, high over the deck (each checked clear of the track's slab - grid: TrackGrid)
  bridges(grid, seed = 17) {
    const rnd = mulberry32(seed), out = [];
    for (const t of [0.16, 0.37, 0.55, 0.74, 0.9]) {
      const s = this.sIn + (this.sOut - this.sIn) * t, yd = this.track.frame(s, {}).P.y;
      for (let tries = 0; tries < 4; tries++) {
        const hb = 46 + 34 * rnd() + tries * 12, skew = (rnd() - 0.5) * 70;
        const a = this.wallPoint(s - skew / 2, -1, yd + hb), b = this.wallPoint(s + skew / 2, 1, yd + hb + (rnd() - 0.5) * 16);
        a.p.addScaledVector(a.n, -16); b.p.addScaledVector(b.n, -16);
        const sag = 4 + 8 * rnd(), thick = 7 + 5 * rnd(), pts = [], rad = [];
        for (let i = 0; i <= 40; i++) {
          const u = i / 40, c = a.p.clone().lerp(b.p, u);
          c.y -= sag * Math.sin(u * Math.PI);
          pts.push(c);
          rad.push(thick * (1 + 1.4 * Math.pow(Math.abs(u * 2 - 1), 3)) * (0.85 + 0.3 * noise2(u * 6, s)));
        }
        const g = sweptIce(pts, rad, { nr: 20, carve: 0.4, carveScale: 0.05, seed: 30 + out.length,
          glowFn: (q, r) => 0.45 + 0.75 * smoothstep(16, 7, r) });
        if (grid.geometryClear(g, 4, 2) < 0) continue;
        out.push(g);
        break;
      }
    }
    return out;
  }

  // frozen falls down the cliffs either side of the crevasse's mouths (and a few more along the faces)
  falls(seed = 3) {
    const rnd = mulberry32(seed), out = [];
    for (const poly of this.pieces) {
      const n = poly.length;
      let nw = 0;
      while (nw < n && poly[nw].wall) nw++;
      // along the coast from each end of the wall: ~70 m out, and further on
      for (const [from, dir] of [[nw, 1], [n - 1, -1]]) {
        for (const along of [9 + Math.floor(rnd() * 4), 30 + Math.floor(rnd() * 20)]) {
          const p = poly[(from + dir * along + n) % n];
          if (p.wk > 0.05) continue;
          const tp = this.topAt(p.x, p.z), d = this.out(p, tp - 6, tp);
          const top = new THREE.Vector3(p.x + p.nx * (d - 5), tp - 1, p.z + p.nz * (d - 5));
          out.push(frozenFall(top, new THREE.Vector3(p.nx, 0, p.nz), 45 + 45 * rnd(), tp + 10, 40 + out.length));
        }
      }
    }
    return out;
  }

  // where the wind tears snow off its edges: along the crevasse's rims and the cliffs that face downwind
  plumeTips(wind) {
    const wd = wind.clone().normalize(), out = [];
    for (const poly of this.pieces) {
      poly.forEach((p, i) => {
        const faces = p.nx * wd.x + p.nz * wd.z;
        if (i % (p.wall ? 22 : 16) || faces < 0.15) return;
        const tp = this.topAt(p.x, p.z), d = this.out(p, tp - 3, tp);
        out.push({ p: new THREE.Vector3(p.x + p.nx * d, tp + 2, p.z + p.nz * d), s: p.wall ? 0.5 : 0.75 });
      });
    }
    return out;
  }

  // inside the coast, or within m of it
  near(x, z, m = 0) {
    if (inPoly(this.coast, x, z)) return true;
    if (m <= 0) return false;
    const m2 = m * m;
    for (const [cx, cz] of this.coast) if ((cx - x) ** 2 + (cz - z) ** 2 < m2) return true;
    return false;
  }
}

// ---------------------------------------------------------------- the bergs
// one berg (unit: ~1 across, its waterline at y = 0, its top at y ~1), rings up a profile [[y, r]]: kind 0 tabular (sheer
// sides, a flat top), 1 a dome broken into peaks, 2 a small lump
export function bergGeometry(kind, seed) {
  const rnd = mulberry32(seed), ph = rnd() * 50, seg = kind === 2 ? 18 : 36;
  const prof = kind === 0
    ? [[-0.7, 1.04], [-0.3, 1.02], [0, 1], [0.3, 1], [0.6, 0.99], [0.85, 0.98], [0.95, 0.94], [1.0, 0.86], [1.02, 0.7], [1.03, 0.45], [1.035, 0.2], [1.04, 0]]
    : [[-0.7, 1.0], [-0.2, 1.0], [0.05, 0.97], [0.16, 0.86], [0.24, 0.84], [0.36, 0.72], [0.46, 0.7], [0.58, 0.56], [0.66, 0.52],
      [0.76, 0.38], [0.84, 0.3], [0.92, 0.17], [0.97, 0.08], [1.0, 0]];
  const rough = kind === 0 ? 0.08 : 0.3, pos = [], glow = [], idx = [];
  // broken off along fractures: its outline a polygon of 5-9 corners (the radius along a ray to its edges)
  const K = 5 + Math.floor(rnd() * 5), cx = [], cz = [];
  for (let k = 0; k < K; k++) { const a = ((k + 0.15 + 0.7 * rnd()) / K) * Math.PI * 2, r = 0.7 + 0.45 * rnd(); cx.push(Math.cos(a) * r); cz.push(Math.sin(a) * r); }
  const edge = (a) => {
    const dx = Math.cos(a), dz = Math.sin(a);
    let best = 2;
    for (let k = 0; k < K; k++) {
      const x0 = cx[k], z0 = cz[k], ex = cx[(k + 1) % K] - x0, ez = cz[(k + 1) % K] - z0, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-6) continue;
      const t = (x0 * ez - z0 * ex) / den, u = (x0 * dz - z0 * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
    }
    return best;
  };
  const tilt = (rnd() - 0.5) * 0.16, ta = rnd() * Math.PI * 2;
  prof.forEach(([y, r], i) => {
    const top = i / (prof.length - 1);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let k = r * edge(a) * (1 + rough * (fbm3(ca * 1.3 + ph, y * 1.5, sa * 1.3, 3) - 0.5) * 2 + 0.04 * Math.abs(Math.sin(a * 9 + ph)));
      let yy = y + (y > 0 ? tilt * Math.cos(a - ta) * k * y : 0);
      if (kind !== 0 && y > 0.2) yy += 0.45 * (fbm3(ca * 1.1 + ph, 3.3, sa * 1.1, 2) - 0.5) * y;      // the peaks
      if (kind === 0 && y > 0.9) yy += 0.03 * (noise2(ca * 4 + ph, sa * 4) - 0.5);
      if (r === 0) k = 0;
      pos.push(ca * k, yy, sa * k);
      glow.push(0.35 + 0.5 * top * (kind === 0 ? 0.3 : 1) + 0.2 * rnd());
    }
  });
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward: a vertex on the side must face away from the axis
  const v = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 3 * seg), nv = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 3 * seg);
  if (nv.x * v.x + nv.z * v.z < 0) { for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  // the broken ones faceted: each face flat, as fractured ice is
  if (kind === 0) return g;
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

// bergs scattered over a field round centre c (radius R): clear of the track (by their own size over its slab) and of
// the shelf; [{ kind, v (one of two shapes of it), m: Matrix4 }]
export function bergField(track, shelf, c, R, n, seed = 61) {
  const rnd = mulberry32(seed), out = [], M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const P = track.P, step = 6;
  for (let k = 0; k < n * 12 && out.length < n; k++) {
    const a = rnd() * Math.PI * 2, d = R * Math.sqrt(rnd()), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    const kind = rnd() < 0.45 ? 0 : rnd() < 0.6 ? 1 : 2;
    const r = kind === 0 ? 40 + 110 * rnd() : kind === 1 ? 24 + 46 * rnd() : 7 + 12 * rnd();
    const h = kind === 0 ? r * (0.22 + 0.18 * rnd()) : kind === 1 ? r * (0.9 + 0.9 * rnd()) : r * (0.5 + 0.4 * rnd());
    if (shelf.near(x, z, r + 60)) continue;
    // the track: no closer than its slab's edge + 18 m anywhere the berg reaches up to the ships' way (under the deck
    // where they ride upside down, 30 m of it)
    let ok = true;
    for (let i = 0; i < P.length && ok; i += step) {
      const p = P[i], dx = p.x - x, dz = p.z - z, way = track.U[i].y < 0 || track.inFlip(i * track.step, 40) ? 34 : 14;
      if (dx * dx + dz * dz < (r * 1.25 + EDGE + 18) ** 2 && p.y - way < h * 1.1) ok = false;
    }
    if (!ok) continue;
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 12)) continue;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    out.push({ kind, v: rnd() < 0.5 ? 0 : 1, x, z, r, m: M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(r, h, r * (0.7 + 0.5 * rnd()))).clone() });
  }
  return out;
}
