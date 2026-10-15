// The drowned city under the sea: a city of pale stone that sank whole, still lit. The track dives through its great
// gate (its attic and braziers stand out of the waves), runs its avenue between colonnades as tall as the deck is high
// over the street, sweeps round the great dome (its lantern above the sea), passes through the hypostyle hall of a
// temple, under an aqueduct's arcade and out past the towers. Round the way: ziggurats, towers with lit crowns, houses
// packed into blocks, plazas - on a plateau of silt ~80 m down.
// Everything is one stone, drawn from each face's own coordinates in metres ('fac': along, up, kind): ashlar courses,
// polished shafts fluted, mouldings, inlaid glowing lines, lit windows, dome tiles gone green. Its lamps' light is
// baked into every vertex at load (they never move); the moon and the sky reach it as little as the depth lets (sea.js).
import * as THREE from 'three';
import { mulberry32, smoothstep, fbm } from './noise.js';
import { TRACK_W } from './track.js';
import { SEA_Y, SEA_GLSL } from './sea.js';
import { sunOnly } from './look.js';

const TAU = Math.PI * 2;
export const FLOOR = SEA_Y - 900;                    // the abyss's floor, the city's streets
// face kinds
const ASHLAR = 0, SMOOTH = 1, TRIM = 2, GLOW = 3, WINDOW = 4, ROOF = 5, FLUTED = 6, DARK = 7;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- the builder
// vertices with their own (u, v) in metres and a kind; parts are made in a local frame and placed by a matrix.
// Faces never share vertices across a hard edge (normals worked out at the end: smooth only round a lathe's rings)
class Builder {
  constructor() { this.pos = []; this.fac = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(p, u, w, k) { this.pos.push(p.x, p.y, p.z); this.fac.push(u, w, k); return this.n - 1; }
  // a flat panel from corner o along a (its u) and b (its v), cells at most `step` m
  panel(o, a, b, k, step = 3, u0 = 0, v0 = 0) {
    const la = a.length(), lb = b.length(), na = Math.max(1, Math.ceil(la / step)), nb = Math.max(1, Math.ceil(lb / step)), base = this.n, p = new THREE.Vector3();
    for (let i = 0; i <= nb; i++) for (let j = 0; j <= na; j++) {
      p.copy(o).addScaledVector(a, j / na).addScaledVector(b, i / nb);
      this.v(p, u0 + (la * j) / na, v0 + (lb * i) / nb, k);
    }
    for (let i = 0; i < nb; i++) for (let j = 0; j < na; j++) {
      const q = base + i * (na + 1) + j;
      this.idx.push(q, q + 1, q + na + 2, q, q + na + 2, q + na + 1);
    }
  }
  // a box from y 0 to h, w along x, d along z, centred; faces outward
  box(w, h, d, k, { step = 3, top = true, bottom = false, kTop = k } = {}) {
    const x = w / 2, z = d / 2;
    this.panel(V(-x, 0, z), V(w, 0, 0), V(0, h, 0), k, step, 0, 0);            // +z
    this.panel(V(x, 0, -z), V(-w, 0, 0), V(0, h, 0), k, step, 0, 0);           // -z
    this.panel(V(x, 0, z), V(0, 0, -d), V(0, h, 0), k, step, w, 0);            // +x
    this.panel(V(-x, 0, -z), V(0, 0, d), V(0, h, 0), k, step, w, 0);           // -x
    if (top) this.panel(V(-x, h, z), V(w, 0, 0), V(0, 0, -d), kTop, step, 0, 0);
    if (bottom) this.panel(V(-x, 0, -z), V(w, 0, 0), V(0, 0, d), k, step, 0, 0);
  }
  // a turned profile [[r, y, kind], ...] round y, `seg` round; each span of the profile its own band (crisp
  // mouldings), smooth round. flute: grooves cut round a shaft's spans of that kind
  lathe(prof, seg, { flute = 0, a0 = 0, a1 = TAU } = {}) {
    const full = Math.abs(a1 - a0 - TAU) < 1e-6, cols = full ? seg : seg + 1, p = new THREE.Vector3();
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0, k] = prof[i], [r1, y1] = prof[i + 1];
      if (Math.abs(r0 - r1) < 1e-6 && Math.abs(y0 - y1) < 1e-6) continue;
      const base = this.n, len = Math.hypot(r1 - r0, y1 - y0);
      for (const [r, y, v] of [[r0, y0, 0], [r1, y1, len]]) {
        for (let j = 0; j < cols; j++) {
          const a = a0 + ((a1 - a0) * j) / seg;
          const rr = flute && k === FLUTED ? r * (1 - flute * Math.pow(Math.abs(Math.sin(a * seg / 2)), 0.7)) : r;
          p.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
          this.v(p, a * Math.max(r0, r1), y0 + v * (y1 - y0) / Math.max(len, 1e-6), k);
        }
      }
      for (let j = 0; j < seg; j++) {
        const a = base + j, b = base + ((j + 1) % cols), c = a + cols, d = b + cols;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }
  // a section [[x, y], ...] (x out to the right of the way, y up) swept along points with their frames {P, R, U}
  sweep(frames, section, k, closed = false) {
    const ns = section.length, base = this.n, p = new THREE.Vector3();
    let along = 0;
    frames.forEach((F, i) => {
      if (i) along += F.P.distanceTo(frames[i - 1].P);
      let around = 0;
      section.forEach(([x, y], j) => {
        if (j) around += Math.hypot(x - section[j - 1][0], y - section[j - 1][1]);
        p.copy(F.P).addScaledVector(F.R, x).addScaledVector(F.U, y);
        this.v(p, along, around, k);
      });
    });
    const segs = closed ? ns : ns - 1, i0 = this.idx.length;
    for (let i = 0; i < frames.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = base + i * ns + j, b = base + i * ns + ((j + 1) % ns), c = a + ns, d = b + ns;
      this.idx.push(a, b, c, b, d, c);
    }
    // outward: the first real face's normal must point away from the section's middle
    const cx = section.reduce((t, q) => t + q[0], 0) / ns, cy = section.reduce((t, q) => t + q[1], 0) / ns, P = this.pos;
    const pv = (k) => V(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    for (let j = 0; j < segs; j++) {
      const [x0, y0] = section[j], [x1, y1] = section[(j + 1) % ns];
      if (Math.hypot(x1 - x0, y1 - y0) < 1e-6) continue;
      const a = pv(base + j), nrm = new THREE.Vector3().crossVectors(pv(base + ((j + 1) % ns)).sub(a), pv(base + ns + j).sub(a));
      const out = frames[0].R.clone().multiplyScalar((x0 + x1) / 2 - cx).addScaledVector(frames[0].U, (y0 + y1) / 2 - cy);
      if (nrm.dot(out) < 0) for (let k = i0; k < this.idx.length; k += 3) { const t = this.idx[k + 1]; this.idx[k + 1] = this.idx[k + 2]; this.idx[k + 2] = t; }
      break;
    }
  }
  // the geometry added by fn, placed by M
  place(M, fn) {
    const s = this.n;
    fn(this);
    const p = new THREE.Vector3();
    for (let i = s; i < this.n; i++) {
      p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(M);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('fac', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
const hard = (pts) => pts.flatMap((p, i) => [p, pts[(i + 1) % pts.length]]);
const at = (x, y, z, rotY = 0, s = 1) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rotY), V(s, s, s));

// ---------------------------------------------------------------- the parts
// a column: plinth, a torus base, a fluted shaft tapering a little, a flared capital, an abacus. h: its whole height
function column(B, h, r) {
  const ph = Math.min(1.2, h * 0.04);
  B.box(r * 2.6, ph, r * 2.6, TRIM, { step: 2 });
  const sh0 = ph + r * 0.6, sh1 = h - r * 1.3;
  B.lathe([[r * 1.25, ph, TRIM], [r * 1.3, ph + r * 0.18, TRIM], [r * 1.18, ph + r * 0.42, TRIM], [r * 1.02, sh0, TRIM],
    [r, sh0, FLUTED], [r * 0.86, sh1, FLUTED], [r * 0.9, sh1, TRIM], [r * 0.92, sh1 + r * 0.2, TRIM], [r * 1.35, h - r * 0.55, TRIM],
    [r * 1.45, h - r * 0.5, TRIM]], 24, { flute: 0.06 });
  B.place(at(0, h - r * 0.5, 0), (b) => b.box(r * 3.1, r * 0.5, r * 3.1, TRIM, { step: 2 }));
}

// an entablature over a run of columns from a to b (heights y): architrave, a frieze with a glowing inlay, a cornice
function entablature(B, a, b, y, depth) {
  const d = new THREE.Vector3().subVectors(b, a).setY(0), len = d.length();
  if (len < 0.5) return;
  const rot = Math.atan2(-d.z, d.x);
  B.place(at((a.x + b.x) / 2, y, (a.z + b.z) / 2, rot), (q) => {
    q.box(len + depth * 0.4, 1.8, depth, ASHLAR, { step: 3 });
    q.place(at(0, 1.8, 0), (r) => r.box(len + depth * 0.4, 1.6, depth * 0.92, SMOOTH, { step: 3 }));
    q.place(at(0, 2.45, depth * 0.47), (r) => r.box(len + depth * 0.4, 0.28, 0.1, GLOW, { step: 4 }));
    q.place(at(0, 2.45, -depth * 0.47), (r) => r.box(len + depth * 0.4, 0.28, 0.1, GLOW, { step: 4 }));
    q.place(at(0, 3.4, 0), (r) => r.box(len + depth * 0.7, 0.9, depth * 1.25, TRIM, { step: 3 }));
  });
}

// a monumental arch over the way: two piers, a ring of voussoirs, an attic with a glowing band; braziers on top.
// span: between the piers' faces; rise: the springing line over its feet; at the piers' tops lamps
function gateArch(B, span, spring, pierW, depth, lamps, M) {
  const R = span / 2, top = spring + R;
  B.place(M, (q) => {
    for (const sd of [-1, 1]) {
      q.place(at(sd * (R + pierW / 2), 0, 0), (p) => {
        p.box(pierW + 4, 6, depth + 4, TRIM, { step: 3 });
        p.place(at(0, 6, 0), (r) => r.box(pierW, spring - 6, depth, ASHLAR, { step: 3 }));
        p.place(at(0, spring - 2.5, 0), (r) => r.box(pierW + 2.2, 2.5, depth + 2.2, TRIM, { step: 3 }));
        // pilasters with a glowing groove up the front and back
        for (const fz of [-1, 1]) for (const fx of [-1, 1]) p.place(at(fx * pierW * 0.32, 6, fz * (depth / 2 + 0.4)), (r) => r.box(2.2, spring - 8.5, 0.8, SMOOTH, { step: 3 }));
        for (const fz of [-1, 1]) p.place(at(0, 8, fz * (depth / 2 + 0.06)), (r) => r.box(0.35, spring - 14, 0.14, GLOW, { step: 4 }));
      });
    }
    // the ring: a section swept round a half circle (intrados R, extrados R + 7)
    const frames = [];
    for (let i = 0; i <= 48; i++) {
      const a = Math.PI * (i / 48), c = Math.cos(a), s = Math.sin(a);
      frames.push({ P: V(c * R, spring + s * R, 0), R: V(c, s, 0), U: V(0, 0, 1) });
    }
    q.sweep(frames, hard([[0, -depth / 2], [0, depth / 2], [7, depth / 2], [7, -depth / 2]]), ASHLAR);
    // the spandrels up to the attic, and the attic
    for (const sd of [-1, 1]) q.place(at(sd * (R * 0.72 + 1.5), spring + R * 0.25, 0), (p) => p.box(R * 0.56 + 3, R * 0.75 + 7.5 - R * 0.25, depth, ASHLAR, { step: 3 }));
    q.place(at(0, top + 7, 0), (p) => {
      p.box(span + pierW * 2 + 4, 3, depth + 3, TRIM, { step: 3 });
      p.place(at(0, 3, 0), (r) => r.box(span + pierW * 2, 9, depth, ASHLAR, { step: 3 }));
      for (const fz of [-1, 1]) p.place(at(0, 6.5, fz * (depth / 2 + 0.06)), (r) => r.box(span + pierW * 2 - 6, 0.5, 0.14, GLOW, { step: 4 }));
      p.place(at(0, 12, 0), (r) => r.box(span + pierW * 2 + 5, 1.6, depth + 4, TRIM, { step: 3 }));
    });
    // the braziers on the attic's ends
    for (const sd of [-1, 1]) {
      q.place(at(sd * (R + pierW / 2), top + 20.6, 0), (p) => p.lathe([[0, 0, TRIM], [2.6, 0, TRIM], [3, 1.2, TRIM], [1.4, 2, SMOOTH], [1.6, 4.5, SMOOTH], [4.2, 6.5, TRIM], [4.4, 7.4, TRIM], [3.6, 7.4, DARK], [0, 6.8, DARK]], 20));
      const p = V(sd * (R + pierW / 2), top + 29.5, 0).applyMatrix4(M);
      lamps.push({ p, col: [1.0, 0.55, 0.18], I: 9000, reach: 140, size: 3.2, kind: 'brazier' });
    }
  });
}

// a dome on a drum, on a podium ringed by a colonnade: lantern on top with a light
function domeTemple(B, rDome, lamps, M, rnd) {
  const pod = 8, colR = rDome + 12, colH = 26, nCol = 36;
  B.place(M, (q) => {
    // the podium: three steps
    q.lathe([[colR + 10, 0, TRIM], [colR + 10, 3, TRIM], [colR + 7, 3, TRIM], [colR + 7, 5.5, TRIM], [colR + 4, 5.5, TRIM], [colR + 4, pod, TRIM], [0, pod, ASHLAR]], 64);
    // the peristyle
    for (let k = 0; k < nCol; k++) {
      const a = (k / nCol) * TAU;
      q.place(at(Math.cos(a) * colR, pod, Math.sin(a) * colR), (c) => column(c, colH, 1.5));
    }
    // its ring beam (an entablature round), its glowing band
    q.lathe([[colR + 2.6, pod + colH, ASHLAR], [colR + 2.6, pod + colH + 3.2, ASHLAR], [colR + 2.7, pod + colH + 3.2, GLOW], [colR + 2.7, pod + colH + 3.7, GLOW],
      [colR + 2.6, pod + colH + 3.7, ASHLAR], [colR + 2.6, pod + colH + 5, ASHLAR], [colR + 3.8, pod + colH + 5.6, TRIM], [colR + 3.8, pod + colH + 6.4, TRIM],
      [colR - 2.6, pod + colH + 6.4, TRIM], [colR - 2.6, pod + colH, ASHLAR]], 72);
    // the cella's drum: windows between pilasters, lit; then the dome, ribbed, its tiles green
    const d0 = pod, d1 = pod + colH + 14;
    q.lathe([[rDome, d0, WINDOW], [rDome, d1, TRIM], [rDome + 2.5, d1 + 1, TRIM], [rDome + 2.5, d1 + 2.6, TRIM], [rDome, d1 + 2.6, ROOF]], 64);
    const dp = [];
    for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI / 2; dp.push([rDome * Math.cos(a) + (i === 20 ? 0 : 0), d1 + 2.6 + rDome * 0.92 * Math.sin(a), ROOF]); }
    dp[20][0] = 7.5;
    q.lathe(dp, 64);
    // ribs down the dome
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, frames = [];
      for (let i = 0; i <= 18; i++) {
        const t = (i / 18) * Math.PI / 2 * 0.93, r = rDome * Math.cos(t) + 0.6, y = d1 + 2.6 + rDome * 0.92 * Math.sin(t) + 0.5;
        const n = V(Math.cos(t) * Math.cos(a), Math.sin(t) / 0.92, Math.cos(t) * Math.sin(a)).normalize();
        frames.push({ P: V(Math.cos(a) * r, y, Math.sin(a) * r), R: V(-Math.sin(a), 0, Math.cos(a)), U: n });
      }
      q.sweep(frames, hard([[-0.9, -0.6], [-0.7, 0.8], [0.7, 0.8], [0.9, -0.6]]), TRIM);
    }
    // the lantern: a ring of columns round a crystal light
    const ly = d1 + 2.6 + rDome * 0.92;
    q.place(at(0, ly - 0.5, 0), (p) => {
      p.lathe([[9, 0, TRIM], [9, 1.5, TRIM], [0, 1.5, TRIM]], 32);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; p.place(at(Math.cos(a) * 6.5, 1.5, Math.sin(a) * 6.5), (c) => column(c, 11, 0.55)); }
      p.place(at(0, 12.5, 0), (c) => c.lathe([[8, 0, TRIM], [8, 1.4, TRIM], [5.5, 3.5, ROOF], [1.2, 8, ROOF], [0.6, 11, TRIM], [0, 11.5, TRIM]], 32));
    });
    lamps.push({ p: V(0, ly + 7, 0).applyMatrix4(M), col: [0.25, 0.85, 1.0], I: 26000, reach: 260, size: 4, kind: 'crystal' });
    // lamps round the colonnade's top
    for (let k = 0; k < 12; k++) {
      const a = ((k + 0.5) / 12) * TAU;
      lamps.push({ p: V(Math.cos(a) * (colR + 4.4), pod + colH + 7.8, Math.sin(a) * (colR + 4.4)).applyMatrix4(M), col: [1.0, 0.6, 0.25], I: 900, reach: 60, size: 1.5, kind: 'orb' });
    }
  });
}

// a stepped pyramid: tiers, a stair up its front, a shrine on top with a beacon
function ziggurat(B, w, tiers, th, lamps, M) {
  B.place(M, (q) => {
    let y = 0;
    for (let i = 0; i < tiers; i++) {
      const s = w * (1 - (i / tiers) * 0.78);
      q.place(at(0, y, 0), (p) => p.box(s, th, s, ASHLAR, { step: 3, kTop: TRIM }));
      q.place(at(0, y + th - 0.6, 0), (p) => p.box(s + 0.6, 0.6, s + 0.6, GLOW, { step: 4, top: false }));
      y += th;
    }
    // the stair
    const n = Math.round(y / 1.2), sw = w * 0.16;
    for (let i = 0; i < n; i++) q.place(at(0, i * 1.2, w / 2 - (i / n) * w * 0.39), (p) => p.box(sw, 1.2, 1.6, TRIM, { step: 3 }));
    // the shrine: four squat columns round a light under a cap
    const top = w * (1 - 0.78 * (tiers - 1) / tiers) * 0.3;
    q.place(at(0, y, 0), (p) => {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.place(at(sx * top, 0, sz * top), (c) => column(c, 8, 0.9));
      p.place(at(0, 8, 0), (c) => c.box(top * 2 + 4, 2.2, top * 2 + 4, TRIM, { step: 3 }));
      p.place(at(0, 10.2, 0), (c) => c.lathe([[top + 2, 0, ROOF], [0.5, top * 0.9 + 2, ROOF], [0, top * 0.9 + 2.3, TRIM]], 4, { a0: Math.PI / 4, a1: Math.PI / 4 + TAU }));
    });
    lamps.push({ p: V(0, y + 4, 0).applyMatrix4(M), col: [0.2, 0.95, 0.85], I: 5000, reach: 120, size: 2.5, kind: 'crystal' });
  });
}

// a slender tower: a base, a shaft in sections with ring balconies, a lit crown
function tower(B, r, h, lamps, M, rnd) {
  // three kinds: a stepped spire on a square or eight-sided plan; a round tower of galleried stages under a ribbed
  // dome and a lantern; a slender needle bundled with two lower shafts. Every stage: a plinth band, a shaft of windows,
  // a cornice with a glowing band under it
  const kind = rnd(), sq = kind < 0.45, seg = sq ? (rnd() < 0.5 ? 4 : 8) : 24, opts = sq ? { a0: Math.PI / seg, a1: Math.PI / seg + TAU } : {};
  const sk = sq ? 1 / Math.cos(Math.PI / seg) : 1;          // (a polygon's corner radius for its face's distance)
  B.place(M, (q) => {
    q.lathe([[r * 2.1 * sk, 0, TRIM], [r * 2.1 * sk, 4, TRIM], [r * 1.75 * sk, 4, TRIM], [r * 1.75 * sk, 8, TRIM], [r * 1.35 * sk, 8, TRIM], [r * 1.35 * sk, 11, TRIM], [0, 11, TRIM]], seg, opts);
    const stages = 3 + Math.floor(rnd() * 3), topH = kind < 0.45 ? h * 0.24 : kind < 0.8 ? r * 1.6 : h * 0.18;
    let y = 11, rr = r * 1.2;
    const body = h - topH - 11;
    for (let i = 0; i < stages; i++) {
      const sh = body * (i === 0 ? 0.34 : 0.66 / (stages - 1)), gallery = !sq && i > 0 && rnd() < 0.6;
      const prof = [[rr * 1.04 * sk, y, TRIM], [rr * 1.04 * sk, y + 2.2, TRIM], [rr * sk, y + 2.2, WINDOW], [rr * 0.97 * sk, y + sh - 4.5, GLOW],
        [rr * 0.97 * sk, y + sh - 3.8, TRIM], [rr * 1.16 * sk, y + sh - 2.6, TRIM], [rr * 1.18 * sk, y + sh, TRIM], [rr * 0.9 * sk, y + sh, TRIM]];
      q.lathe(prof, seg, opts);
      if (gallery) {
        // a gallery: a ring of columns round a recessed core, a lamp-lit ring beam over them
        const gh = Math.min(16, sh * 0.35), n = Math.max(8, Math.round(rr * 1.4));
        q.lathe([[rr * 0.72, y + sh, WINDOW], [rr * 0.72, y + sh + gh, TRIM]], seg);
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU; q.place(at(Math.cos(a) * rr * 0.98, y + sh, Math.sin(a) * rr * 0.98), (c) => column(c, gh, Math.max(0.5, rr * 0.06))); }
        q.lathe([[rr * 1.1, y + sh + gh, TRIM], [rr * 1.1, y + sh + gh + 1.6, GLOW], [rr * 1.1, y + sh + gh + 2.2, TRIM], [rr * 0.9, y + sh + gh + 2.6, TRIM]], seg);
        y += gh + 2.6;
      }
      y += sh;
      rr *= 0.8;
    }
    if (kind < 0.45) {
      // the spire, a crystal at its tip
      q.lathe([[rr * 1.1 * sk, y, TRIM], [rr * 1.1 * sk, y + 1.5, TRIM], [rr * 0.95 * sk, y + 1.5, ROOF], [rr * 0.12 * sk, y + topH - 3, ROOF], [rr * 0.2 * sk, y + topH - 2.5, TRIM], [0, y + topH, TRIM]], seg, opts);
      lamps.push({ p: V(0, y + topH + 2, 0).applyMatrix4(M), col: rnd() < 0.5 ? [0.25, 0.85, 1.0] : [0.35, 1.0, 0.8], I: 2400, reach: 90, size: r * 0.5, kind: 'crown' });
    } else if (kind < 0.8) {
      // a ribbed dome and its lantern
      const dp = [[rr, y, TRIM], [rr * 1.08, y + 1.6, TRIM], [rr, y + 1.6, ROOF]];
      for (let i = 1; i <= 12; i++) { const t = (i / 12) * Math.PI / 2; dp.push([rr * Math.cos(t) + (i === 12 ? 0.1 : 0), y + 1.6 + rr * 1.15 * Math.sin(t), ROOF]); }
      q.lathe(dp, seg);
      const ly = y + 1.6 + rr * 1.15;
      q.lathe([[rr * 0.28, ly - 0.5, WINDOW], [rr * 0.28, ly + rr * 0.35, TRIM], [rr * 0.36, ly + rr * 0.4, ROOF], [0, ly + rr * 0.75, TRIM]], 12);
      lamps.push({ p: V(0, ly + rr * 0.15, 0).applyMatrix4(M), col: rnd() < 0.5 ? [1.0, 0.62, 0.25] : [0.25, 0.85, 1.0], I: 2600, reach: 90, size: r * 0.6, kind: 'crown' });
    } else {
      // a needle, two lower shafts bound to it
      q.lathe([[rr * 0.8, y, WINDOW], [rr * 0.5, y + topH - 4, GLOW], [rr * 0.5, y + topH - 2, TRIM], [0, y + topH + 8, TRIM]], 16);
      for (const sd of [-1, 1]) q.place(at(sd * r * 1.55, 11, 0), (c) => c.lathe([[r * 0.55, 0, WINDOW], [r * 0.5, h * 0.55, TRIM], [r * 0.62, h * 0.55 + 1.5, TRIM], [r * 0.3, h * 0.55 + r * 1.2, ROOF], [0, h * 0.55 + r * 1.3, TRIM]], 16));
      lamps.push({ p: V(0, y + topH + 9, 0).applyMatrix4(M), col: [0.4, 0.9, 1.0], I: 2200, reach: 90, size: r * 0.4, kind: 'crown' });
    }
  });
}

// a house: one to three storeys of ashlar, dark doors and windows (now and then one lit), a flat roof with a parapet
function house(B, w, d, floors, M, rnd) {
  B.place(M, (q) => {
    const fh = 6;
    q.box(w, floors * fh, d, WINDOW, { step: 6, kTop: ASHLAR });
    for (let f = 0; f < floors; f++) {
      const y = f * fh + (f ? 2 : 0.2);
      for (const [sx, sz, len, rot] of [[0, d / 2 + 0.05, w, 0], [0, -d / 2 - 0.05, w, Math.PI], [w / 2 + 0.05, 0, d, -Math.PI / 2], [-w / 2 - 0.05, 0, d, Math.PI / 2]]) {
        const n = Math.max(1, Math.floor(len / 5));
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.35) continue;
          const off = -len / 2 + (len * (i + 0.5)) / n;
          const lit = rnd() < 0.12;
          q.place(at(sx + Math.cos(rot) * off, y, sz - Math.sin(rot) * off, rot), (p) => p.box(1.6, f ? 2.4 : 3.4, 0.1, lit ? WINDOW : DARK, { step: 4, top: false }));
        }
      }
    }
    q.place(at(0, floors * fh, 0), (p) => {
      for (const [sx, sz, a, b] of [[0, d / 2 - 0.4, w, 0.8], [0, -d / 2 + 0.4, w, 0.8], [w / 2 - 0.4, 0, 0.8, d], [-w / 2 + 0.4, 0, 0.8, d]]) p.place(at(sx, 0, sz), (c) => c.box(a, 1.4, b, TRIM, { step: 3 }));
    });
  });
}

// ---------------------------------------------------------------- the material
export function stoneMaterial({ key = 'city' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 fac; attribute vec3 lit; varying vec3 vFac; varying vec3 vLit; varying vec3 vCW; varying vec3 vCN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vFac = fac; vLit = lit; vCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFac; varying vec3 vLit; varying vec3 vCW; varying vec3 vCN;
float ctH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float ctN3(vec3 p) {
  vec3 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  float a = ctH(i.xy + i.z * 17.1), b = ctH(i.xy + vec2(1, 0) + i.z * 17.1), c = ctH(i.xy + vec2(0, 1) + i.z * 17.1), d = ctH(i.xy + vec2(1, 1) + i.z * 17.1);
  float e = ctH(i.xy + (i.z + 1.0) * 17.1), f = ctH(i.xy + vec2(1, 0) + (i.z + 1.0) * 17.1), g = ctH(i.xy + vec2(0, 1) + (i.z + 1.0) * 17.1), h = ctH(i.xy + vec2(1, 1) + (i.z + 1.0) * 17.1);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f, u.x), mix(g, h, u.x), u.y), u.z);
}
vec3 ctGlow = vec3(0.0); float ctRough = 0.7, ctWet = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float kind = floor(vFac.z + 0.5);
    vec2 m = vFac.xy;
    vec3 n = normalize(vCN);
    float w1 = ctN3(vCW * 0.07), w2 = ctN3(vCW * 0.6);
    // the stone: pale limestone, a little warm, weathered in patches
    vec3 stone = mix(vec3(0.52, 0.5, 0.45), vec3(0.66, 0.64, 0.58), w1) * (0.9 + 0.2 * w2);
    vec3 c = stone;
    float aw = max(fwidth(m.x), fwidth(m.y));
    if (kind < 0.5) {
      // ashlar: courses 0.9 m, blocks 1.8 m, each course offset
      vec2 cell = vec2(m.x / 1.8 + 0.5 * floor(m.y / 0.9), m.y / 0.9), f = fract(cell);
      float j = max(smoothstep(0.96 - aw * 2.0, 0.985, f.x) + smoothstep(0.04 + aw * 2.0, 0.015, f.x), smoothstep(0.94 - aw, 0.97, f.y));
      float far = smoothstep(0.2, 0.6, aw);
      c *= mix(0.86 + 0.24 * ctH(floor(cell)), 1.0, far) * (1.0 - 0.5 * j * (1.0 - far));
    } else if (kind < 1.5 || kind > 5.5 && kind < 6.5) {
      c = mix(vec3(0.62, 0.62, 0.6), vec3(0.78, 0.77, 0.74), w1);         // polished: whiter, smoother
      ctRough = 0.38;
    } else if (kind < 2.5) {
      c = stone * 1.08;
    } else if (kind < 3.5) {
      // the inlaid lines: light running along them now and then
      c = vec3(0.05);
      float run = 0.6 + 0.4 * sin(m.x * 0.15 - fogColor.g * 1.3);
      ctGlow = vec3(0.12, 0.85, 1.0) * 9.0 * run;
    } else if (kind < 4.5) {
      // windows: a grid of openings (2.4 x 3.6 m), more than a third of them lit from within - warm, white or sea-green -
      // so a tower reads from far off as a column of lights; finer than the pixels, their average
      vec2 wc = vec2((vCW.x + vCW.z) / 2.4, vCW.y / 3.6), wf = fract(wc), wid = floor(wc);
      float waw = max(fwidth(wc.x), fwidth(wc.y));
      float glass = smoothstep(0.1, 0.1 + waw, wf.x) * smoothstep(0.9, 0.9 - waw, wf.x) * smoothstep(0.14, 0.14 + waw, wf.y) * smoothstep(0.86, 0.86 - waw, wf.y);
      glass = mix(glass, 0.55, smoothstep(0.25, 0.6, waw));
      float r = ctH(wid + floor(vCW.xz / 40.0) * 7.3), hue = ctH(wid * 1.7 + 3.1);
      vec3 wcol = hue < 0.5 ? vec3(1.0, 0.62, 0.3) : hue < 0.8 ? vec3(0.75, 0.9, 1.0) : vec3(0.35, 1.0, 0.85);
      c = mix(vec3(0.14, 0.135, 0.12) * (0.8 + 0.4 * w2), vec3(0.015), glass);
      ctGlow = wcol * 7.0 * step(0.62, r) * glass * (0.75 + 0.25 * ctH(wid + 9.0));
    } else if (kind < 5.5) {
      // the dome's tiles: scales of copper gone green
      vec2 sc = vec2(m.x / 1.4 + 0.5 * floor(m.y / 1.0), m.y / 1.0), f = fract(sc);
      float edge = smoothstep(0.3, 0.5, length(f - vec2(0.5, 0.0)));
      c = mix(vec3(0.07, 0.24, 0.2), vec3(0.15, 0.36, 0.3), w1) * (0.75 + 0.25 * edge);
      ctRough = 0.45;
    } else {
      c = vec3(0.025, 0.025, 0.03);
    }
    // the sea's growth: silt on whatever looks up, weed and crust low down, darker toward the street
    float up = smoothstep(0.55, 0.9, n.y + (w2 - 0.5) * 0.3);
    c = mix(c, vec3(0.2, 0.21, 0.17) * (0.8 + 0.4 * w2), up * 0.65);
    float low = 1.0 - smoothstep(${(FLOOR + 2).toFixed(1)}, ${(FLOOR + 22).toFixed(1)}, vCW.y + (w1 - 0.5) * 10.0);
    c = mix(c, vec3(0.1, 0.16, 0.12) * (0.6 + 0.6 * w2), low * 0.7);
    c *= 0.85 + 0.15 * smoothstep(0.3, 0.7, ctN3(vCW * 0.015));
    diffuseColor.rgb = c;
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = ctRough;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // the lamps' light (baked), and what glows of itself
  totalEmissiveRadiance += diffuseColor.rgb * vLit + ctGlow;`);
    // (the scene's lamps follow the city's own - their light is baked in already: twice, the hall's columns went white)
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `ocean-${key}`;
  return mat;
}

// ---------------------------------------------------------------- the floor
// The abyss: a basin ~430 m deep under the city, its walls climbing in terraces to a rim ~70 m down (the gate stands on
// it), the open sea bed beyond falling away again; carved under the track wherever it runs low (never within 32 m
// under its deck)
export class Basin {
  constructor(track, grid, C, R) { Object.assign(this, { track, grid, C, R }); this._p = new THREE.Vector3(); }
  natural(x, z) {
    const C = this.C, R = this.R, d = Math.hypot((x - C.x) / R.x, (z - C.z) / R.z);
    const n1 = fbm(x / 320, z / 320, 4) - 0.5, n2 = fbm(x / 70, z / 70, 3) - 0.5;
    const e = d + n1 * 0.14, wall = smoothstep(0.64, 1.0, e), steps = Math.floor(wall * 6 + 0.5) / 6;
    const inside = FLOOR + n2 * 7 + (SEA_Y - 72 - FLOOR) * (wall * 0.4 + steps * 0.6);
    const out = smoothstep(1.02, 1.4, e);
    return inside * (1 - out) + (SEA_Y - 240 + n1 * 90) * out;
  }
  height(x, z) {
    let y = this.natural(x, z);
    const i = this.grid.nearest(this._p.set(x, y, z), 1e9);
    if (i >= 0) {
      const P = this.track.P[i], dl = Math.hypot(P.x - x, P.z - z);
      y = Math.min(y, P.y - 32 + Math.max(0, dl - 50) * 1.2);
    }
    return y;
  }
}

function floorGeometry(basin) {
  const C = basin.C, R = basin.R, W = R.x * 2.7, D = R.z * 2.7, step = 9, nx = Math.ceil(W / step), nz = Math.ceil(D / step);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), fac = new Float32Array((nx + 1) * (nz + 1) * 3), idx = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) {
    const x = C.x - W / 2 + j * step, z = C.z - D / 2 + i * step, k = (i * (nx + 1) + j) * 3;
    pos[k] = x; pos[k + 1] = basin.height(x, z); pos[k + 2] = z;
    fac[k] = x; fac[k + 1] = z; fac[k + 2] = 8;
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('fac', new THREE.BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function siltMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 lit; varying vec3 vLit; varying vec3 vSW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vLit = lit; vSW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLit; varying vec3 vSW;
float slH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float slN(vec2 x) { vec2 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(slH(i), slH(i + vec2(1, 0)), u.x), mix(slH(i + vec2(0, 1)), slH(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float n = slN(vSW.xz * 0.05) * 0.6 + slN(vSW.xz * 0.4) * 0.4;
    // ripples in the silt, and dark patches of weed
    float rip = 0.5 + 0.5 * sin(dot(vSW.xz, vec2(0.9, 0.45)) + n * 4.0);
    vec3 c = mix(vec3(0.24, 0.23, 0.2), vec3(0.34, 0.32, 0.27), n) * (0.88 + 0.12 * rip);
    c = mix(c, vec3(0.06, 0.1, 0.07), smoothstep(0.62, 0.8, slN(vSW.xz * 0.02 + 7.0)) * 0.8);
    diffuseColor.rgb = c;
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vLit;');
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'ocean-silt';
  return mat;
}

// one geometry cut into chunks on a grid (cell m): each its own triangles over the shared vertices, its own bounds - drawn
// only where the camera can see it (frustum, and the distance the water lets it see)
export function chunks(g, cell) {
  const I = g.index.array, P = g.attributes.position.array, cells = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const k = `${Math.floor((P[a] + P[b] + P[c]) / 3 / cell)},${Math.floor((P[a + 2] + P[b + 2] + P[c + 2]) / 3 / cell)}`;
    (cells.get(k) || cells.set(k, []).get(k)).push(I[t], I[t + 1], I[t + 2]);
  }
  const out = [], box = new THREE.Box3(), v = new THREE.Vector3();
  for (const idx of cells.values()) {
    const q = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) q.setAttribute(k, a);
    q.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint32BufferAttribute(idx, 1));
    box.makeEmpty();
    for (const i of idx) box.expandByPoint(v.fromArray(P, i * 3));
    q.boundingBox = box.clone();
    q.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------- the lamps' light, baked into every vertex
function bakeLamps(g, lamps) {
  const CELL = 60, grid = new Map();
  for (const L of lamps) {
    const r = L.reach = L.reach * 1.35;
    for (let x = Math.floor((L.p.x - r) / CELL); x <= Math.floor((L.p.x + r) / CELL); x++)
      for (let y = Math.floor((L.p.y - r) / CELL); y <= Math.floor((L.p.y + r) / CELL); y++)
        for (let z = Math.floor((L.p.z - r) / CELL); z <= Math.floor((L.p.z + r) / CELL); z++) {
          const k = `${x},${y},${z}`;
          (grid.get(k) || grid.set(k, []).get(k)).push(L);
        }
  }
  const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    let r = 0, gg = 0, b = 0;
    for (const L of grid.get(`${Math.floor(px / CELL)},${Math.floor(py / CELL)},${Math.floor(pz / CELL)}`) || []) {
      const lx = L.p.x - px, ly = L.p.y - py, lz = L.p.z - pz, d2 = lx * lx + ly * ly + lz * lz, rr = L.reach * L.reach;
      if (d2 > rr) continue;
      const nl = Math.min(1, Math.max(0, (N[i * 3] * lx + N[i * 3 + 1] * ly + N[i * 3 + 2] * lz) / Math.sqrt(d2 + 1e-6) * 0.85 + 0.15));
      const q = 1 - d2 / rr, k = (L.I * 2.2 * nl * q * q) / (d2 + L.size * L.size) / Math.PI;
      r += L.col[0] * k; gg += L.col[1] * k; b += L.col[2] * k;
    }
    out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
  }
  g.setAttribute('lit', new THREE.BufferAttribute(out, 3));
}

// ---------------------------------------------------------------- the lighthouse
// the old lighthouse on its rock out at sea: a stepped plinth, a tapering shaft in three stages ringed with cornices and
// lit slit windows, a gallery of columns round the lantern, a cone of green tiles over it. y0: the rock's top
export function lighthouseGeometry(x, y0, z, rot = 0) {
  const B = new Builder(), lamps = [], M = at(x, y0, z, rot);
  B.place(M, (q) => {
    q.lathe([[17, -2, TRIM], [17, 3, TRIM], [14, 3, TRIM], [14, 6, TRIM], [11, 6, ASHLAR]], 32);
    q.lathe([[11, 6, WINDOW], [10, 28, TRIM], [11.6, 29, TRIM], [11.6, 31, TRIM], [9.6, 31, WINDOW], [8.8, 52, TRIM], [10.4, 53, TRIM], [10.4, 55, TRIM],
      [8.6, 55, ASHLAR], [8, 66, ASHLAR], [8.4, 66.5, GLOW], [8.4, 67.2, GLOW], [8, 67.2, ASHLAR], [8, 69, ASHLAR], [11.5, 70.5, TRIM], [11.5, 72, TRIM], [0, 72, TRIM]], 32);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; q.place(at(Math.cos(a) * 7.6, 72, Math.sin(a) * 7.6), (c) => column(c, 11, 0.55)); }
    q.place(at(0, 83, 0), (c) => c.lathe([[10, 0, TRIM], [10, 1.6, TRIM], [8, 3.5, ROOF], [1.4, 12, ROOF], [0.7, 15, TRIM], [0, 15.5, TRIM]], 32));
  });
  lamps.push({ p: V(0, 78, 0).applyMatrix4(M), col: [1.0, 0.86, 0.62], I: 40000, reach: 150, size: 3, kind: 'beacon' });
  const g = B.geometry();
  bakeLamps(g, lamps);
  return { geometry: g, lamp: lamps[0] };
}

// ---------------------------------------------------------------- the city
export class City {
  constructor(track, grid, { dens = 1, avoid = [] } = {}) {
    this.track = track; this.grid = grid;
    const tr = track, rnd = mulberry32(8080), f = {}, lamps = [], B = new Builder();
    this.lamps = lamps;
    // where it lies: the abyss round the way from the gate down and back up the climb
    const s0 = tr.at('gate', -60), s1 = tr.at('surge', -60), pts = [];
    for (let s = s0; tr.inSpan(s, s0, s1); s = tr.wrap(s + 20)) pts.push(tr.frame(s, {}).P.clone());
    const box = new THREE.Box3().setFromPoints(pts);
    this.C = box.getCenter(new THREE.Vector3());
    this.R = V((box.max.x - box.min.x) / 2 + 420, 0, (box.max.z - box.min.z) / 2 + 420);
    const basin = (this.basin = new Basin(tr, grid, this.C, this.R));
    const ground = (x, z) => basin.height(x, z);
    const inside = (x, z) => Math.hypot((x - this.C.x) / this.R.x, (z - this.C.z) / this.R.z);
    const occupied = avoid.map((a) => ({ ...a }));
    const clear = (g, margin) => grid.geometryClear(g, margin, 3);
    const side = (s, lat) => { tr.frame(s, f); const R = f.R.clone().setY(0).normalize(); return { x: f.P.x + R.x * lat, z: f.P.z + R.z * lat, y: f.P.y, R, T: f.T.clone().setY(0).normalize() }; };
    // (lamps added by a part built at scale s: their light and reach scaled with it)
    const scaleLamps = (from, s) => { for (let i = from; i < lamps.length; i++) { lamps[i].I *= s * s; lamps[i].reach *= s; lamps[i].size *= s; } };

    // the great gate on the rim: over the way 20 m before the named point
    {
      const s = tr.at('gate', -20), p = side(s, 0), span = TRACK_W + 34, g0 = ground(p.x, p.z);
      if (p.y - g0 < 120) {
        gateArch(B, span, p.y + 6 - g0, 13, 18, lamps, at(p.x, g0 - 2, p.z, Math.atan2(-p.R.z, p.R.x)));
        occupied.push({ x: p.x, z: p.z, r: span / 2 + 20 });
      }
    }
    // the colonnade down the lip of the abyss: a column every 16 m both sides, their tops 16 m over the deck - until the
    // floor falls away under it
    {
      const a0 = tr.at('gate', 40), a1 = tr.at('dome', -80), lat = TRACK_W / 2 + 15;
      for (const sd of [-1, 1]) {
        let prev = null, k = 0;
        for (let s = a0; tr.inSpan(s, a0, a1); s = tr.wrap(s + 16), k++) {
          const p = side(s, sd * lat), g0 = ground(p.x, p.z), h = p.y + 16 - g0;
          if (h > 140) { prev = null; continue; }
          B.place(at(p.x, g0 - 1, p.z), (q) => column(q, h + 1, 1.6 + h * 0.008));
          const top = V(p.x, g0 + h, p.z);
          if (prev) entablature(B, prev, top, Math.min(prev.y, top.y), 4.2);
          if (k % 2 === 0) {
            B.place(at(p.x, g0 + h + 4.3, p.z), (q) => q.lathe([[0.9, 0, TRIM], [0.5, 0.6, TRIM], [0.4, 2.2, SMOOTH], [1.1, 2.8, TRIM], [0, 3.2, TRIM]], 10));
            lamps.push({ p: V(p.x, g0 + h + 8.6, p.z), col: k % 4 === 0 ? [1.0, 0.6, 0.24] : [0.3, 0.85, 1.0], I: 2200, reach: 80, size: 1.4, kind: 'orb' });
          }
          prev = top;
          occupied.push({ x: p.x, z: p.z, r: 6 });
        }
      }
    }
    // the great dome, inside the turn round the named point: the temple of before at 2.4 times the size, standing on the
    // abyss's floor and rising past the track
    {
      const s = tr.at('dome', 40), sd = tr.kh[Math.round(s / tr.step) % tr.n] > 0 ? 1 : -1, S = 2.4;
      for (const extra of [0, 60, 120]) {
        const p = side(s, sd * (TRACK_W / 2 + 40 + 158 + extra)), g0 = ground(p.x, p.z), M = at(p.x, g0 - 4, p.z, 0, S);
        const tmp = new Builder();
        domeTemple(tmp, 44, [], M, rnd);
        if (clear(tmp.geometry(), 6) < 0 && extra < 120) continue;
        const n0 = lamps.length;
        domeTemple(B, 44, lamps, M, rnd);
        scaleLamps(n0, S);
        // (its lantern: a soft source - at the building's scale its light whited out the dome under it)
        for (let i = n0; i < lamps.length; i++) if (lamps[i].kind === 'crystal') Object.assign(lamps[i], { I: 9000, size: 14, reach: 420 });
        occupied.push({ x: p.x, z: p.z, r: 170 });
        this.dome = p;
        break;
      }
    }
    // the hall on the temple mount: the way runs through a hypostyle hall standing on a stepped platform built up from
    // the floor - two rows of columns a side, walls with lit niches, a roof 30 m over the deck; pylons at each end
    {
      const h0 = tr.at('hallIn', -26), h1 = tr.at('hallOut', 26);
      const in1 = TRACK_W / 2 + 9, in2 = TRACK_W / 2 + 22, wall = TRACK_W / 2 + 34;
      for (let s = h0, k = 0; tr.inSpan(s, h0, h1); s = tr.wrap(s + 12), k++) {
        tr.frame(s, f);
        const R = f.R.clone().setY(0).normalize(), rot = Math.atan2(-R.z, R.x), roofY = f.P.y + 30, base = f.P.y - 14;
        // the mount under it: three tiers out from the hall, a glowing band along each tier's edge
        const g0 = Math.min(ground(f.P.x, f.P.z), base - 40);
        B.place(at(f.P.x, 0, f.P.z, rot), (q) => {
          for (const [w, top] of [[wall * 2 + 120, base - 110], [wall * 2 + 70, base - 50], [wall * 2 + 24, base]]) {
            if (top <= g0) continue;
            q.place(at(0, g0, 0), (r) => r.box(w, top - g0, 12.4, ASHLAR, { step: 6, kTop: TRIM }));
            for (const sd2 of [-1, 1]) q.place(at(sd2 * (w / 2 + 0.05), top - 2.2, 0), (r) => r.box(0.12, 0.45, 12.4, GLOW, { step: 6, top: false }));
          }
        });
        for (const sd of [-1, 1]) {
          for (const lat of [in1, in2]) {
            const x = f.P.x + R.x * sd * lat, z = f.P.z + R.z * sd * lat;
            B.place(at(x, base - 1, z), (q) => column(q, roofY - base + 1, lat === in1 ? 2.2 : 1.9));
          }
          const x = f.P.x + R.x * sd * wall, z = f.P.z + R.z * sd * wall;
          B.place(at(x, base - 1, z, rot), (q) => {
            q.box(4, roofY - base + 5, 12.4, ASHLAR, { step: 3 });
            if (k % 2 === 0) {
              q.place(at(-sd * 2.05, f.P.y - base + 2, 0), (r) => r.box(0.12, 9, 4, DARK, { top: false }));
              lamps.push({ p: V(x - R.x * sd * 3.2, f.P.y + 7, z - R.z * sd * 3.2), col: [1.0, 0.58, 0.22], I: 1400, reach: 55, size: 1.2, kind: 'niche' });
            }
          });
          // lamps along the mount's top edge outside the walls
          if (k % 3 === 0) {
            const lx = f.P.x + R.x * sd * (wall + 9), lz = f.P.z + R.z * sd * (wall + 9);
            B.place(at(lx, base, lz), (q) => q.lathe([[0.8, 0, TRIM], [0.4, 1, TRIM], [0.35, 6, SMOOTH], [0.9, 6.4, TRIM], [0, 7, TRIM]], 8));
            lamps.push({ p: V(lx, base + 7.6, lz), col: [0.3, 0.85, 1.0], I: 1500, reach: 70, size: 1.0, kind: 'orb' });
          }
        }
        B.place(at(f.P.x, roofY + 2.5, f.P.z, rot), (q) => {
          q.box(wall * 2 + 4, 4, 12.4, ASHLAR, { step: 3 });
          q.place(at(0, -1.2, 0), (r) => r.box(wall * 2, 1.2, 1.6, TRIM, { step: 3 }));
        });
        if (k % 2 === 1) for (const sd of [-1, 1]) {
          const x = f.P.x + R.x * sd * (in1 + in2) / 2, z = f.P.z + R.z * sd * (in1 + in2) / 2;
          B.place(at(x, roofY - 7, z), (q) => q.lathe([[0, 7, TRIM], [0.25, 7, TRIM], [0.25, 2.4, TRIM], [1.1, 2, TRIM], [1.1, 0.4, DARK], [0.4, 0, TRIM], [0, 0, TRIM]], 8));
          lamps.push({ p: V(x, roofY - 6, z), col: [0.3, 0.85, 1.0], I: 1800, reach: 60, size: 1.3, kind: 'lantern' });
        }
        occupied.push({ x: f.P.x, z: f.P.z, r: wall + 66 });
      }
      for (const [nm, off] of [['hallIn', -26], ['hallOut', 26]]) {
        const s = tr.at(nm, off), p = side(s, 0), roofY = p.y + 30, base = p.y - 14, rot = Math.atan2(-p.R.z, p.R.x);
        for (const sd of [-1, 1]) {
          const x = p.x + p.R.x * sd * (wall + 12), z = p.z + p.R.z * sd * (wall + 12), h = roofY + 16 - base;
          B.place(at(x, base - 2, z, rot + Math.PI / 4), (q) => q.lathe([[22, 0, TRIM], [22, 3, TRIM], [19, 3, ASHLAR], [14, h - 4, ASHLAR], [16, h - 3, TRIM], [16, h, TRIM], [0, h, TRIM]], 4));
          lamps.push({ p: V(x, base - 2 + h + 3, z), col: [1.0, 0.55, 0.2], I: 9000, reach: 140, size: 2.6, kind: 'brazier' });
        }
        B.place(at(p.x, roofY + 6.5, p.z, rot), (q) => {
          q.box(wall * 2 + 24, 6, 14, ASHLAR, { step: 3 });
          for (const fz of [-1, 1]) q.place(at(0, 2.6, fz * 7.06), (r) => r.box(wall * 2 + 16, 0.5, 0.14, GLOW, { step: 4 }));
        });
      }
    }
    // the aqueduct: arcades stacked from the floor of the abyss up to a top tier whose middle arch spans the track, a
    // channel on top
    {
      const s = tr.at('aqueduct'), p = side(s, 0), g0 = ground(p.x, p.z);
      const dir = p.R.clone().applyAxisAngle(V(0, 1, 0), 0.35), big = 100, small = 30, pier = 8;
      let len = 1100;
      const O = g0 - 2, top = (p.y - 6) - O + big / 2 + 9;
      const rot = Math.atan2(-dir.z, dir.x), M = at(p.x, O, p.z, rot);
      const ring = (q, c, R, spring, d) => {
        const frames = [];
        for (let i = 0; i <= 24; i++) { const t = Math.PI * (i / 24); frames.push({ P: V(c + Math.cos(t) * R, spring + Math.sin(t) * R, 0), R: V(Math.cos(t), Math.sin(t), 0), U: V(0, 0, 1) }); }
        q.sweep(frames, hard([[0, -d], [0, d], [3.4, d], [3.4, -d]]), ASHLAR);
      };
      const localGround = (x) => ground(p.x + dir.x * x, p.z + dir.z * x) - 2 - O;
      const arcade = (q) => {
        const spans = [];
        for (let x = big / 2 + pier; x < len / 2; x += small + pier) spans.push([x, x + small]);
        const all = [[-big / 2, big / 2], ...spans, ...spans.map(([a, b]) => [-b, -a])];
        for (const [a, b] of all) {
          const span = b - a, c = (a + b) / 2, R = span / 2, spring = top - 9 - R;
          const gb = Math.min(localGround(a - pier / 2), localGround(b + pier / 2), localGround(c));
          if (gb > spring - 6) continue;                          // (the floor up the wall is over it here)
          for (const x of [a - pier / 2, b + pier / 2]) q.place(at(x, gb, 0), (r) => r.box(pier, spring + 2 - gb, 9, ASHLAR, { step: 6, top: false }));
          ring(q, c, R, spring, 4.5);
          for (const sd of [-1, 1]) q.place(at(c + sd * (R * 0.75 + 1.5), spring + R * 0.3, 0), (r) => r.box(R * 0.5 + 3 + pier / 2, top - (spring + R * 0.3) - 6, 9, ASHLAR, { step: 4, top: false }));
          // the tiers below: arches between the same piers every 70 m down, a glowing band at each
          for (let lv = spring - 70; lv > gb + R + 10; lv -= 70) {
            ring(q, c, R, lv, 4.5);
            q.place(at(c, lv + R + 3.4, 0), (r) => r.box(span + pier, 4, 9, TRIM, { step: 4 }));
            for (const fz of [-1, 1]) q.place(at(c, lv + R + 5.2, fz * 4.56), (r) => r.box(span + pier, 0.4, 0.12, GLOW, { step: 6, top: false }));
          }
        }
        q.place(at(0, top - 6, 0), (r) => {
          r.box(len, 3, 11, TRIM, { step: 4 });
          for (const sd of [-1, 1]) r.place(at(0, 3, sd * 5), (w) => w.box(len, 2.6, 1, ASHLAR, { step: 4 }));
          for (const sd of [-1, 1]) r.place(at(0, 1.2, sd * 5.56), (w) => w.box(len, 0.35, 0.12, GLOW, { step: 6 }));
        });
      };
      // (as long as it can be without crossing the track anywhere but under its middle arch)
      for (; len > 300; len -= 100) { const tb = new Builder(); tb.place(M, arcade); if (clear(tb.geometry(), 4) >= 0) break; }
      B.place(M, arcade);
      for (let x = -len / 2 + 40; x < len / 2; x += 60) {
        if (localGround(x) > top - 20) continue;
        lamps.push({ p: V(x, top - 6 + 5.6 + 1.5, 0).applyMatrix4(M), col: [1.0, 0.6, 0.25], I: 2400, reach: 80, size: 1.4, kind: 'orb' });
      }
      occupied.push({ x: p.x, z: p.z, r: 40 });
      this.aqueduct = { p, dir, len };
    }
    // the city on the floor: towers with lit windows and crowns, ziggurats, buildings packed in blocks, lamps along the
    // streets - clear of the track, of each other and of the aqueduct's line
    const place = (r, tries, fn, dMax = 0.86) => {
      for (let t = 0; t < tries; t++) {
        const x = this.C.x + (rnd() * 2 - 1) * this.R.x, z = this.C.z + (rnd() * 2 - 1) * this.R.z;
        if (inside(x, z) > dMax) continue;
        if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r)) continue;
        if (this.aqueduct) { const a = this.aqueduct, d = V(x - a.p.x, 0, z - a.p.z); if (Math.abs(d.dot(V(-a.dir.z, 0, a.dir.x))) < r + 14 && Math.abs(d.dot(a.dir)) < a.len / 2 + r) continue; }
        if (fn(x, z)) { occupied.push({ x, z, r }); return true; }
      }
      return false;
    };
    const test = (build) => { const tb = new Builder(); build(tb, []); return clear(tb.geometry(), 4) >= 0; };
    let nz = 0, nt = 0, nh = 0;
    for (let k = 0; k < 7; k++) {
      const w = 140 + rnd() * 90, tiers = 6 + Math.floor(rnd() * 3), th = 13 + rnd() * 5, rot = rnd() * TAU;
      if (place(w * 0.75, 300, (x, z) => {
        const M = at(x, ground(x, z) - 3, z, rot);
        if (!test((tb, l) => ziggurat(tb, w, tiers, th, l, M))) return false;
        const n0 = lamps.length; ziggurat(B, w, tiers, th, lamps, M); scaleLamps(n0, 2.2); return true;
      })) nz++;
    }
    const nearTrack = (r) => {                       // a spot 50 - 260 m off the way's underwater stretch
      for (let k = 0; k < 40; k++) {
        const s = tr.wrap(s0 + rnd() * tr.wrap(s1 - s0)), p = side(s, (rnd() < 0.5 ? -1 : 1) * (TRACK_W / 2 + 30 + r * 2 + rnd() * 210));
        if (inside(p.x, p.z) < 0.95) return p;
      }
      return null;
    };
    for (let k = 0; k < Math.round(150 * Math.max(0.6, dens)); k++) {
      const r = 9 + rnd() * 14, h = 170 + Math.pow(rnd(), 0.7) * 300, close = k % 2 === 0;
      if (place(r * 2.2 + 10, 120, (x, z) => {
        if (close) { const p = nearTrack(r); if (!p) return false; x = p.x; z = p.z; if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r * 2.2 + 10)) return false; }
        const g0 = ground(x, z);
        if (g0 > FLOOR + 160) return false;
        const M = at(x, g0 - 3, z, rnd() * TAU);
        if (!test((tb, l) => tower(tb, r, h, l, M, mulberry32(k)))) return false;
        const n0 = lamps.length; tower(B, r, h, lamps, M, mulberry32(k)); scaleLamps(n0, r / 6);
        if (close) occupied.push({ x, z, r: r * 2.2 + 10 });
        return true;
      }, close ? 1.2 : 0.86)) nt++;
    }
    for (let k = 0; k < Math.round(650 * Math.max(0.5, dens)); k++) {
      const w = 12 + rnd() * 22, d = 12 + rnd() * 20, floors = 2 + Math.floor(rnd() * 5);
      if (place(Math.max(w, d) * 0.62 + 3, 10, (x, z) => {
        const M = at(x, ground(x, z) - 2, z, Math.round(rnd() * 4) * Math.PI / 2 + (rnd() - 0.5) * 0.3);
        if (!test((tb) => house(tb, w, d, floors, M, mulberry32(k)))) return false;
        house(B, w, d, floors, M, mulberry32(k)); return true;
      }, 0.8)) nh++;
    }
    for (let k = 0; k < 220; k++) {
      place(5, 20, (x, z) => {
        const g0 = ground(x, z);
        B.place(at(x, g0 - 0.5, z), (q) => q.lathe([[1, 0, TRIM], [0.8, 1.2, TRIM], [0.4, 1.6, SMOOTH], [0.35, 10, SMOOTH], [0.9, 10.5, TRIM], [0.9, 11, DARK], [0, 11.5, TRIM]], 8));
        lamps.push({ p: V(x, g0 + 12, z), col: rnd() < 0.65 ? [1.0, 0.6, 0.24] : [0.3, 0.85, 1.0], I: 900, reach: 45, size: 1.0, kind: 'street' });
        return true;
      }, 0.8);
    }
    {
      const pts = [], cols = [], step = 58, C = this.C, R = this.R;
      for (let gx = -R.x; gx <= R.x; gx += step) for (let z = -R.z; z <= R.z; z += 11) {
        for (const [x, zz] of [[C.x + gx + (rnd() - 0.5) * 3, C.z + z], [C.x + z * R.x / R.z, C.z + gx * R.z / R.x + (rnd() - 0.5) * 3]]) {
          if (inside(x, zz) > 0.62 || rnd() < 0.18) continue;
          pts.push(x, ground(x, zz) + 5, zz);
          const warm = rnd() < 0.7;
          cols.push(...(warm ? [1.0, 0.62, 0.3] : [0.4, 0.9, 1.0]).map((c) => c * (0.6 + 0.6 * rnd())));
        }
      }
      this.street = { pts: new Float32Array(pts), cols: new Float32Array(cols) };
    }
    this.stone = B.geometry();
    bakeLamps(this.stone, lamps);
    this.floor = floorGeometry(basin);
    bakeLamps(this.floor, lamps);
    console.info(`city: ${nz} ziggurats, ${nt} towers, ${nh} buildings, ${lamps.length} lamps, ${(this.stone.index.count / 3 / 1000).toFixed(0)}k tris (stone), floor ${(this.floor.index.count / 3 / 1000).toFixed(0)}k`);
  }

  // the meshes: the stone and the floor in chunks, the lamps' glowing bodies (an orb each, sized by kind), their halos
  meshes() {
    const sm = stoneMaterial(), fm = siltMaterial();
    const stone = chunks(this.stone, 260).map((g) => { const m = new THREE.Mesh(g, sm); m.name = 'city'; return m; });
    const floor = chunks(this.floor, 400).map((g) => { const m = new THREE.Mesh(g, fm); m.name = 'city-floor'; return m; });
    this.parts = [...stone, ...floor];
    const orb = new THREE.IcosahedronGeometry(1, 2);
    const glow = new THREE.InstancedMesh(orb, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.lamps.length);
    const M = new THREE.Matrix4(), c = new THREE.Color();
    this.lamps.forEach((L, i) => {
      const s = Math.min(4, ({ brazier: 2.6, crystal: 2.4, crown: 1.6, orb: 1.0, lantern: 0.75, niche: 0.7, street: 0.55 }[L.kind] || 1) * Math.max(1, Math.sqrt(L.I / 20000)));
      M.compose(L.p, new THREE.Quaternion(), V(s, L.kind === 'brazier' ? s * 0.6 : s, s));
      glow.setMatrixAt(i, M);
      const k = L.kind === 'brazier' ? 12 : L.kind === 'crystal' ? 6 : 10;
      glow.setColorAt(i, c.setRGB(L.col[0] * k, L.col[1] * k, L.col[2] * k));
    });
    glow.name = 'city-lamps';
    // the glow round each lamp: a soft billboard, its size by the lamp's reach, faded near the camera
    const hq = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
    const hp = new Float32Array(this.lamps.length * 4), hc = new Float32Array(this.lamps.length * 3);
    this.lamps.forEach((L, i) => {
      hp.set([L.p.x, L.p.y, L.p.z, Math.min(28, L.reach * 0.2 + 3)], i * 4);
      const k = ({ brazier: 0.5, crystal: 0.3 }[L.kind] || 0.3) * Math.min(1, 3000 / L.I + 0.25);
      hc.set([L.col[0] * k, L.col[1] * k, L.col[2] * k], i * 3);
    });
    hq.setAttribute('hP', new THREE.InstancedBufferAttribute(hp, 4));
    hq.setAttribute('hC', new THREE.InstancedBufferAttribute(hc, 3));
    hq.instanceCount = this.lamps.length;
    const halo = new THREE.Mesh(hq, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { lvl: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec4 hP; attribute vec3 hC; uniform float lvl; varying vec2 vQ; varying vec3 vC;
        ${SEA_GLSL}
        void main() {
          vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = hP.xyz + (cr * position.x + cu * position.y) * hP.w;
          vQ = position.xy;
          float d = distance(hP.xyz, cameraPosition);
          vC = hC * seTrans(cameraPosition, hP.xyz, lvl) * smoothstep(4.0, 20.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vQ; varying vec3 vC;
        void main() {
          float r2 = dot(vQ, vQ);
          if (r2 > 1.0) discard;
          float k = exp(-r2 * 5.0) * 0.8 + exp(-r2 * 28.0) * 1.6;
          gl_FragColor = vec4(vC * k * (1.0 - r2), 1.0);
        }`,
    }));
    halo.name = 'city-halos';
    // the street lights: points of light along the streets far below, dimmed by the water between
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.street.pts, 3));
    sg.setAttribute('col', new THREE.BufferAttribute(this.street.cols, 3));
    const street = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { lvl: halo.material.uniforms.lvl, pr: { value: 1 } },
      vertexShader: /* glsl */`
        uniform float lvl, pr; attribute vec3 col; varying vec3 vC;
        ${SEA_GLSL}
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = clamp(2.2 * pr * projectionMatrix[1][1] * 360.0 / d, 1.5, 14.0);
          vC = col * 6.0 * seTrans(cameraPosition, position, lvl) * clamp(2.2 * projectionMatrix[1][1] * 360.0 / d / 1.5, 0.2, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 4.0), 1.0); }`,
    }));
    street.name = 'city-streets';
    street.frustumCulled = false;
    halo.frustumCulled = false;
    halo.renderOrder = 2;
    this.haloMat = halo.material;
    return { stone, floor, glow, halo, street };
  }
}
