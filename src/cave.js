// The Hollow: a hill of rock floating over the abyss, the track looping through a cave inside it for 2 km - in under
// its own way out, down into a cavern over a lake, out again higher up. The cave is one tube swept along the track, its
// section changing from chamber to chamber (a gallery of glowworms, the cavern with a waterfall and a chasm, a crystal
// throat, a hall of stalactites, the roots of the jungle overhead, a forest of glowing fungi, a river, a fissure), its
// walls lumpy (3-D noise in world space) and pushed clear of the deck and the ships' way. The hill is an island
// (islands.js) whose outline is drawn round the cave: its cliffs open where the cave's mouths are, its top where
// sinkholes let the jungle's daylight down into the chambers. Inside, the dark (look.js setCave): everything inside
// the hill's outline loses the sun and the sky, save down the sinkholes' shafts and near the mouths.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep, clamp } from './noise.js';
import { islandShape, islandMaterial, fbm3, n3 } from './islands.js';
import { TRACK_W } from './track.js';
import { sheet, NOISE } from './water.js';
import { barkTube } from './flora.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const f3 = (v, k = 2) => `vec3(${v.x.toFixed(k)}, ${v.y.toFixed(k)}, ${v.z.toFixed(k)})`;

// The chambers, by metres in from the mouth (d): the section's half-widths at the deck's height (left, right), the roof
// over the deck and the floor under it, how square it is (2 round .. 4 boxy), how lumpy (m), and how far its floor runs
// off to one side (dx: the river's bed beside the way - to the left, inside the bend, where the deck banks down to it)
export const CHAMBERS = [
  { name: 'mouth', d0: -90, d1: 50, wl: 48, wr: 48, up: 44, down: 26, sq: 2.2, amp: 5 },
  { name: 'gallery', d0: 70, d1: 225, wl: 46, wr: 46, up: 50, down: 26, sq: 2.4, amp: 5 },
  { name: 'cavern', d0: 265, d1: 440, wl: 105, wr: 205, up: 140, down: 235, sq: 2.0, amp: 15 },
  { name: 'throat', d0: 478, d1: 560, wl: 50, wr: 50, up: 54, down: 32, sq: 2.3, amp: 6 },
  { name: 'hall', d0: 592, d1: 790, wl: 92, wr: 92, up: 62, down: 46, sq: 3.0, amp: 7 },
  { name: 'roots', d0: 822, d1: 1080, wl: 74, wr: 74, up: 96, down: 46, sq: 2.4, amp: 9 },
  { name: 'fungi', d0: 1112, d1: 1380, wl: 72, wr: 108, up: 72, down: 92, sq: 2.2, amp: 10 },
  { name: 'river', d0: 1412, d1: 1640, wl: 110, wr: 52, up: 54, down: 34, sq: 2.6, amp: 6, dx: -58 },
  { name: 'fissure', d0: 1672, d1: 1980, wl: 38, wr: 38, up: 104, down: 96, sq: 4.0, amp: 4 },
  { name: 'exit', d0: 2012, d1: 9999, wl: 50, wr: 50, up: 46, down: 28, sq: 2.2, amp: 5 },
];
// the sinkholes: down from the hill's top into a chamber (d, lateral offset from the track, radius); the first pours
// the jungle's river into the cavern
// the faint light of each chamber (its glowworms, its moss; linear): teal galleries, a blue-black cavern, the violet
// of the crystal throat, the hall's amber, the roots' green, the fungi's teal, the river's blue-green
const TINT = { mouth: [0.004, 0.011, 0.01], gallery: [0.004, 0.012, 0.011], cavern: [0.002, 0.005, 0.011], throat: [0.008, 0.003, 0.014],
  hall: [0.013, 0.007, 0.002], roots: [0.005, 0.011, 0.003], fungi: [0.005, 0.011, 0.012], river: [0.002, 0.009, 0.012],
  fissure: [0.003, 0.005, 0.007], exit: [0.004, 0.009, 0.009] };
export const SHAFTS = [{ d: 392, x: 96, r: 30, fall: true }, { d: 948, x: -16, r: 26 }, { d: 1522, x: 12, r: 21 }];
const XC = TRACK_W / 2 + 9, YB = -14, YT = 32;    // the walls stop this far out, the floor this far under, the roof over

// how much of each chamber at d (weights summing to 1) and the section there
function section(d, L) {
  const B = 32, w = CHAMBERS.map((c) => smoothstep(c.d0 - B, c.d0 + B, d) * (1 - smoothstep(c.d1 - B, c.d1 + B, d)));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum < 1e-4) { let bi = 0, bd = 1e9; CHAMBERS.forEach((c, i) => { const q = Math.min(Math.abs(d - c.d0), Math.abs(d - c.d1)); if (q < bd) { bd = q; bi = i; } }); w[bi] = sum = 1; }
  const out = { w: {} };
  for (const k of ['wl', 'wr', 'up', 'down', 'sq', 'amp', 'dx']) out[k] = CHAMBERS.reduce((a, c, i) => a + (c[k] ?? 0) * w[i], 0) / sum;
  CHAMBERS.forEach((c, i) => (out.w[c.name] = w[i] / sum));
  // the mouths flare out
  const fl = 1 + 0.28 * smoothstep(30, -30, d) + 0.28 * smoothstep(L - 30, L + 30, d) + 0.5 * smoothstep(-10, -60, d) + 0.5 * smoothstep(L + 10, L + 60, d);
  out.wl *= fl; out.wr *= fl; out.up *= fl;
  return out;
}

// I: the hill's island parameters (top, cliff, depth, hill, seed ...). Returns the tube (its grid and chunks), the hill's
// shape, the sinkholes, the water levels, and the dark (GLSL for look.js, and the same in JS)
export function hollowCave(track, I) {
  const t0 = performance.now();
  const sIn = track.at('caveIn'), sOut = track.at('caveOut'), L = track.wrap(sOut - sIn);
  const STEP = 3, NJ = 96, PAD = 75, nR = Math.ceil((L + 2 * PAD) / STEP);
  const rows = [], grid = [], f = {}, wv = new THREE.Vector3();
  for (let r = 0; r <= nR; r++) {
    const d = -PAD + (r / nR) * (L + 2 * PAD), s = sIn + d;
    track.frame(s, f);
    const T = f.T.clone(), Ul = UP.clone().addScaledVector(T, -T.y).normalize(), Rl = new THREE.Vector3().crossVectors(T, Ul);
    const sec = section(d, L), P = f.P.clone(), U = f.U.clone(), R = f.R.clone();
    const ring = [];
    for (let j = 0; j < NJ; j++) {
      const a = (j / NJ) * TAU, c = Math.cos(a), sn = Math.sin(a), e = 2 / sec.sq;
      let x = (c >= 0 ? sec.wr : sec.wl) * Math.sign(c) * Math.pow(Math.abs(c), e);
      let y = (sn >= 0 ? sec.up : sec.down) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      if (sn < 0) x += sec.dx * Math.pow(-sn, 1.5);
      wv.copy(P).addScaledVector(Rl, x).addScaledVector(Ul, y);
      // lumps, a chamber's size across (and finer ones)
      const k = 1 / (16 + sec.amp * 3.5);
      const nz = (fbm3(wv.x * k, wv.y * k * 1.4, wv.z * k, 3) - 0.5) * 2 + (n3(wv.x * k * 3.1, wv.y * k * 3.1, wv.z * k * 3.1) - 0.5) * 0.6;
      const sc = 1 + (sec.amp * nz) / Math.max(10, Math.hypot(x, y));
      x *= sc; y *= sc;
      // clear of the deck, its walls and the ships' way, in the deck's own (banked) frame
      for (let it = 0; it < 60; it++) {
        wv.copy(Rl).multiplyScalar(x).addScaledVector(Ul, y);
        const xb = wv.dot(R), yb = wv.dot(U);
        if (!(Math.abs(xb) < XC && yb > YB && yb < YT)) break;
        x *= 1.03; y *= 1.03;
      }
      ring.push(P.clone().addScaledVector(Rl, x).addScaledVector(Ul, y));
    }
    rows.push({ s, d, P, T, U, R, Ul, Rl, sec });
    grid.push(ring);
  }
  const rowAt = (d) => rows[clamp(Math.round(((d + PAD) / (L + 2 * PAD)) * nR), 0, nR)];

  // ---- the hill round it: its outline from the cave's footprint (a rock wall ~40 m thick, none at the mouths), kept
  // off the rest of the track
  const C = new THREE.Vector3();
  let cn = 0;
  rows.forEach((rw, r) => { if (rw.d < 0 || rw.d > L) return; for (const p of grid[r]) { C.add(p); cn++; } });
  C.divideScalar(cn).setY(0);
  const NU = 288, Rb = new Float32Array(NU).fill(0);
  const bin = (x, z) => ((Math.round((Math.atan2(z - C.z, x - C.x) / TAU) * NU) % NU) + NU) % NU;
  rows.forEach((rw, r) => {
    if (rw.d < 40 || rw.d > L - 40) return;
    const m = 40 * smoothstep(40, 130, Math.min(rw.d, L - rw.d));
    for (const p of grid[r]) { const j = bin(p.x, p.z), q = Math.hypot(p.x - C.x, p.z - C.z) + m; if (q > Rb[j]) Rb[j] = q; }
  });
  // (a bin the footprint missed: its neighbours'), a max over ±2 bins, rounded off - but never inside the footprint
  for (let j = 0; j < NU; j++) if (!Rb[j]) { let a = j, b = j; while (!Rb[a]) a = (a + NU - 1) % NU; while (!Rb[b]) b = (b + 1) % NU; Rb[j] = Math.max(Rb[a], Rb[b]); }
  const blur = (src, rad, op) => Float32Array.from(src, (_, j) => { let v = 0, n = 0; for (let k = -rad; k <= rad; k++) { const q = src[(j + k + NU) % NU]; if (op === 'max') v = Math.max(v, q); else { const wk = Math.exp(-(k * k) / (rad * rad * 0.4)); v += q * wk; n += wk; } } return op === 'max' ? v : v / n; });
  const foot = blur(Rb, 2, 'max');
  let Ro = blur(blur(Rb, 4, 'max'), 9, 'avg').map((v, j) => Math.max(v, foot[j]));
  // bays and headlands, outward only
  const rnd = mulberry32(I.seed);
  const ph = rnd() * 9;
  Ro = Ro.map((v, j) => v * (1 + 0.035 * (fbm3(Math.cos((j / NU) * TAU) * 2 + ph, Math.sin((j / NU) * TAU) * 2, 1.7, 3))));
  const mouthIn = rowAt(0).P, mouthOut = rowAt(L).P, tf = {};
  // the rest of the track stays outside: its slab's edges (and middle) 4 m and more off the cliffs, more further from
  // the mouths (the cliff stands right at them)
  for (let i = 0; i < track.n; i++) {
    const s = i * track.step;
    if (track.inSpan(s, sIn, sOut)) continue;
    const p = track.P[i];
    if (Math.hypot(p.x - C.x, p.z - C.z) > 1600 || p.y > I.top + 60 || p.y < I.top - I.cliff - 60) continue;
    const out = Math.min(track.wrap(sIn - s), track.wrap(s - sOut)), m = 3 + Math.min(6, out * 0.05);
    track.frame(s, tf);
    for (const x of [-XC, -XC / 2, 0, XC / 2, XC]) for (const y of [0, 16]) {
      const q = tf.P.clone().addScaledVector(tf.R, x).addScaledVector(tf.U, y), j0 = bin(q.x, q.z), lim = Math.hypot(q.x - C.x, q.z - C.z) - m;
      for (let k = -1; k <= 1; k++) { const j = (j0 + k + NU) % NU; Ro[j] = Math.min(Ro[j], lim + Math.abs(k) * 3); }
    }
  }
  const Rm = Math.max(...Ro);
  const H = { ...I, x: C.x, z: C.z, rx: Rm, rz: Rm, rot: 0, outline: Ro.map((v) => v / Rm), res: NU, rows: 30,
    // (no crags round the mouths: the cliff stands where the cave's walls meet it)
    cragAt: (x, y, z) => smoothstep(150, 250, Math.min(Math.hypot(x - mouthIn.x, y - mouthIn.y, z - mouthIn.z), Math.hypot(x - mouthOut.x, y - mouthOut.y, z - mouthOut.z))) };
  const shape = islandShape(H);
  const outR = (x, z) => { const a = (Math.atan2(z - C.z, x - C.x) / TAU) * NU, j = Math.floor(a), t = a - j; return Ro[((j % NU) + NU) % NU] * (1 - t) + Ro[(((j + 1) % NU) + NU) % NU] * t; };
  const baseAt = (x, z) => { const a = (Math.atan2(z - C.z, x - C.x) / TAU) * NU, j = Math.floor(a), t = a - j; return I.top - (shape.base[((j % NU) + NU) % NU] * (1 - t) + shape.base[(((j + 1) % NU) + NU) % NU] * t); };
  // how far p is outside the hill's cliffs (their bulge, islands.js, included)
  const rimY = I.top - 9;
  const outside = (p) => {
    const t = clamp((rimY - p.y) / (rimY - baseAt(p.x, p.z)), 0, 1);
    return Math.hypot(p.x - C.x, p.z - C.z) - outR(p.x, p.z) * (1 + 0.03 * Math.sin(Math.PI * t));
  };

  // ---- the mouths: where the track goes through the cliff (from 80 m in, out to where the way meets it)
  const crossing = (d0, dir) => {
    for (let d = d0 - dir * 80; dir * (d - d0) < PAD; d += dir * 2) { const rw = rowAt(d); if (outside(rw.P.clone().addScaledVector(rw.U, 6)) > 0) return rw; }
    return rowAt(d0 + dir * PAD);
  };
  const gateIn = crossing(0, -1), gateOut = crossing(L, 1);
  let pierced = 0;
  grid.forEach((ring, r) => { if (rows[r].d > gateIn.d + 45 && rows[r].d < gateOut.d - 45) for (const p of ring) if (outside(p) > 0) pierced++; });
  const nearRows = rows.filter((rw) => rw.d < gateIn.d + 120 || rw.d > gateOut.d - 120);
  const nearest = (p) => { let br = null, bd = 1e18; for (const rw of nearRows) { const q = p.distanceToSquared(rw.P); if (q < bd) { bd = q; br = rw; } } return br; };
  // inside the tube's section there (less a margin), and in the ships' way
  const inTube = (p, margin) => {
    const br = nearest(p), r = rows.indexOf(br), dv = p.clone().sub(br.P), x = dv.dot(br.Rl), y = dv.dot(br.Ul);
    if (Math.abs(dv.dot(br.T)) > 8) return false;
    const a = Math.atan2(y, x), j = ((Math.round((a / TAU) * NJ) % NJ) + NJ) % NJ, q = grid[r][j].clone().sub(br.P);
    return Math.hypot(x, y) < Math.hypot(q.dot(br.Rl), q.dot(br.Ul)) - margin;
  };
  const inWay = (p) => {
    const br = nearest(p), dv = p.clone().sub(br.P), x = dv.dot(br.R), y = dv.dot(br.U);
    return Math.abs(dv.dot(br.T)) < 8 && Math.abs(x) < XC + 2 && y > -3 && y < YT + 12;
  };
  // the cliff round each mouth, finer than the hill's own (2 m): a patch of it laid over the hill's, with the mouth cut
  // out of it where the tube runs through (the tube stands a little out of it: no gap between them)
  const outRA = (a) => { const f = (a / TAU) * NU, j = Math.floor(f), t = f - j; return Ro[((j % NU) + NU) % NU] * (1 - t) + Ro[(((j + 1) % NU) + NU) % NU] * t; };
  const portals = [gateIn, gateOut].map((gate) => {
    const M = gate.P, a0 = Math.atan2(M.z - C.z, M.x - C.x), R0 = outRA(a0), W = 96, ylo = M.y - 76, yhi = M.y + 92, NX = 96, NYp = 84;
    const pos = [], idx = [], isl = [], hole = [], way = [], v = new THREE.Vector3();
    for (let i = 0; i <= NYp; i++) for (let j = 0; j <= NX; j++) {
      const a = a0 + (-W + (2 * W * j) / NX) / R0, y = ylo + ((yhi - ylo) * i) / NYp;
      const t = clamp((rimY - y) / (rimY - baseAt(C.x + Math.cos(a) * 100, C.z + Math.sin(a) * 100)), 0, 1), rho = outRA(a) * (1 + 0.03 * Math.sin(Math.PI * t)) + 0.6;
      v.set(C.x + Math.cos(a) * rho, y, C.z + Math.sin(a) * rho);
      pos.push(v.x, v.y, v.z); isl.push(0, 0);
      hole.push(inTube(v, 1.5) ? 1 : 0); way.push(inWay(v) ? 1 : 0);
    }
    for (let i = 0; i < NYp; i++) for (let j = 0; j < NX; j++) {
      const a = i * (NX + 1) + j, b = a + 1, c = a + NX + 1, d = c + 1;
      for (const [p0, p1, p2] of [[a, c, b], [b, c, d]]) if (!(hole[p0] && hole[p1] && hole[p2]) && !(way[p0] || way[p1] || way[p2])) idx.push(p0, p1, p2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('isl', new THREE.Float32BufferAttribute(isl, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // facing out of the hill
    const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0), p0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 0).sub(C).setY(0);
    if (n0.dot(p0) < 0) { const ix = g.index.array; for (let q = 0; q < ix.length; q += 3) { const tq = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = tq; } g.computeVertexNormals(); }
    g.computeBoundingSphere();
    return { g, a0, R0, W, ylo, yhi };
  });
  const underPortal = (p) => portals.some((q) => {
    let da = Math.atan2(p.z - C.z, p.x - C.x) - q.a0;
    da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return Math.abs(da * q.R0) < q.W - 16 && p.y > q.ylo + 16 && p.y < q.yhi - 16;
  });
  // ---- the sinkholes: from the roof of their chamber up through the hill's top
  const shafts = SHAFTS.map((q) => {
    const rw = rowAt(q.d), sec = rw.sec, ax = rw.P.clone().addScaledVector(rw.Rl, q.x);
    // the roof over the axis: the ring point above it
    let roof = rw.P.y + sec.up;
    const ring = grid[rows.indexOf(rw)];
    let best = 1e9;
    for (const p of ring) if (p.y > rw.P.y) { const dh = Math.hypot(p.x - ax.x, p.z - ax.z); if (dh < best) { best = dh; roof = p.y; } }
    const top = shape.topHeight(ax.x, ax.z) ?? I.top;
    // the floor under it (the lowest ring point near the axis)
    let floor = rw.P.y - sec.down;
    best = 1e9;
    for (const p of ring) if (p.y < rw.P.y) { const dh = Math.hypot(p.x - ax.x, p.z - ax.z); if (dh < best) { best = dh; floor = p.y; } }
    return { ...q, axis: new THREE.Vector3(ax.x, 0, ax.z), roof, top, floor, row: rw };
  });
  const inShaft = (p, k = 1, above = -1e9) => shafts.some((q) => p.y > Math.max(above, q.roof - 25) && Math.hypot(p.x - q.axis.x, p.z - q.axis.z) < q.r * k);

  // ---- the hill's shell: gone under the mouths' patches and over each sinkhole (a triangle goes when all its corners
  // are in)
  {
    const g = shape.geometry, pos = g.attributes.position, idx = g.index.array, keep = [], v = new THREE.Vector3();
    const flag = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); flag[i] = underPortal(v) || (v.y > I.top - 60 && inShaft(v, 1.35)) ? 1 : 0; }
    for (let t = 0; t < idx.length; t += 3) if (!(flag[idx[t]] && flag[idx[t + 1]] && flag[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    g.setIndex(keep);
  }
  // planting: none in a sinkhole or on its lip
  const topInfo = (x, z) => (shafts.some((q) => Math.hypot(x - q.axis.x, z - q.axis.z) < q.r * 1.3 + 3) ? null : shape.topInfo(x, z));

  // ---- the tube's chunks: quads gone where they stand out of the hill, and under the sinkholes
  const tubeFlag = grid.map((ring, r) => ring.map((p) => {
    const rw = rows[r];
    if ((rw.d < gateIn.d + 45 || rw.d > gateOut.d - 45) && outside(p) > 3) return 1;
    return shafts.some((q) => p.y > rw.P.y + 18 && Math.hypot(p.x - q.axis.x, p.z - q.axis.z) < q.r * 0.92) ? 1 : 0;
  }));
  // normals from the grid (into the tube); per vertex: the island's attributes (no grass, a little deep)
  const nrm = grid.map((ring, r) => ring.map((p, j) => {
    const a = ring[(j + 1) % NJ], b = ring[(j + NJ - 1) % NJ], c = grid[Math.min(nR, r + 1)][j], e = grid[Math.max(0, r - 1)][j];
    return new THREE.Vector3().crossVectors(a.clone().sub(b), c.clone().sub(e)).normalize();
  }));
  const CH = 48, chunks = [];
  for (let r0 = 0; r0 < nR; r0 += CH) {
    const r1 = Math.min(nR, r0 + CH), pos = [], nr = [], isl = [], idx = [];
    for (let r = r0; r <= r1; r++) {
      for (let j = 0; j < NJ; j++) {
        const p = grid[r][j], n = nrm[r][j];
        pos.push(p.x, p.y, p.z); nr.push(n.x, n.y, n.z);
        isl.push(0, 0.12 + 0.2 * smoothstep(0, -60, p.y - rows[r].P.y));
      }
    }
    for (let r = r0; r < r1; r++) for (let j = 0; j < NJ; j++) {
      const j2 = (j + 1) % NJ;
      if (tubeFlag[r][j] && tubeFlag[r][j2] && tubeFlag[r + 1][j] && tubeFlag[r + 1][j2]) continue;
      const a = (r - r0) * NJ + j, b = (r - r0) * NJ + j2, d = a + NJ, e = b + NJ;
      idx.push(a, b, d, b, e, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3));
    g.setAttribute('isl', new THREE.Float32BufferAttribute(isl, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.userData.row0 = r0;
    chunks.push(g);
  }

  // ---- the sinkholes' shafts: lumpy cylinders from under the chamber's roof up to the top, flaring out under the
  // grass (the top's hole is cut smaller than the flare)
  const shaftGeo = shafts.map((q, k) => {
    const pos = [], isl = [], idx = [], NS = 40, y0 = q.roof - 12, y1 = q.top - 5, nRing = Math.ceil((y1 - y0) / 4);
    const ringsY = [];
    for (let i = 0; i <= nRing; i++) ringsY.push(y0 + (i / nRing) * (y1 - y0));
    ringsY.push(q.top - 3);
    const rads = ringsY.map((y, i) => (i === ringsY.length - 1 ? q.r * 2.2 + 6 : q.r * (1.12 - 0.12 * smoothstep(y0, y0 + 20, y)) * (1 + 0.5 * smoothstep(y1 - 22, y1, y))));
    ringsY.forEach((y, i) => {
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * TAU, x = q.axis.x + Math.cos(a) * rads[i], z = q.axis.z + Math.sin(a) * rads[i];
        const last = i === ringsY.length - 1, nz = (fbm3(x * 0.05 + k, y * 0.07, z * 0.05, 3) - 0.5) * 2 * (last ? 0 : q.r * 0.16);
        // (the flare's rim under the grass, following the ground)
        const yy = last ? (shape.topHeight(x, z) ?? q.top) - 2.5 : i === ringsY.length - 2 ? Math.min(y, (shape.topHeight(x, z) ?? q.top) - 7) : y;
        pos.push(x + Math.cos(a) * nz, yy, z + Math.sin(a) * nz);
        isl.push(i === ringsY.length - 1 ? 0.6 : 0, 0.1);
      }
    });
    for (let i = 0; i < ringsY.length - 1; i++) for (let j = 0; j < NS; j++) {
      const j2 = (j + 1) % NS, a = i * NS + j, b = i * NS + j2, d = a + NS, e = b + NS;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('isl', new THREE.Float32BufferAttribute(isl, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });

  // ---- water: the lake in the cavern and the river along the floor of the last chambers - each a strip across the
  // tube at its level, wall to wall
  const lakeRow = rowAt(392), lakeY = lakeRow.P.y - 172;
  // (the river 12 m under the deck in its gallery - in sight beyond the walls, its bed off to the left - down in the
  // fissure's slot after)
  const riverY = (d) => { const rw = rowAt(d), k = rw.sec.w.fissure + rw.sec.w.exit; return rw.P.y - (12 * (1 - k) + (rw.sec.down - 9) * k); };
  const strip = (dFrom, dTo, yAt) => {
    const pos = [], uv = [], idx = [];
    let n = 0, along = 0, last = null, prev = -1;
    for (let r = 0; r <= nR; r++) {
      const rw = rows[r];
      if (rw.d < dFrom || rw.d > dTo) continue;
      const y = yAt(rw.d), ring = grid[r];
      // the two crossings of the ring's lower half with y
      let lo = null, hi = null;
      for (let j = 0; j < NJ; j++) {
        const a = ring[j], b = ring[(j + 1) % NJ];
        if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
        const t = (y - a.y) / (b.y - a.y), p = a.clone().lerp(b, t), x = p.clone().sub(rw.P).dot(rw.Rl);
        if (p.y > rw.P.y) continue;
        if (!lo || x < lo.x) lo = { p, x };
        if (!hi || x > hi.x) hi = { p, x };
      }
      if (!lo || !hi || hi.x - lo.x < 4) { last = null; prev = -1; continue; }
      if (last) along += rw.P.distanceTo(last);
      last = rw.P;
      pos.push(lo.p.x, y, lo.p.z, hi.p.x, y, hi.p.z);
      uv.push(lo.x, along, hi.x, along);
      if (prev >= 0) idx.push(prev, n, prev + 1, prev + 1, n, n + 1);
      prev = n;
      n += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  const lake = strip(150, 470, () => lakeY);
  const river = strip(1400, 2010, riverY);

  // ---- the dark: everything inside the hill's outline, under its top and over its cliffs' foot, save near the mouths
  // (light reaches ~60 m in) and down the sinkholes (the sky's light down the shaft, a beam of it on the floor)
  const NB = 96, RB = Array.from({ length: NB }, (_, k) => outR(C.x + Math.cos((k / NB) * TAU) * 100, C.z + Math.sin((k / NB) * TAU) * 100));
  const BB = Array.from({ length: NB }, (_, k) => baseAt(C.x + Math.cos((k / NB) * TAU) * 100, C.z + Math.sin((k / NB) * TAU) * 100));
  const mouths = [[gateIn.P, gateIn.T.clone()], [gateOut.P, gateOut.T.clone().negate()]].map(([p, d]) => ({ p: p.clone().addScaledVector(UP, 6), d }));
  const topD = I.top - (I.hill ?? 8) - 4, bMin = Math.min(...BB), rMax = Math.max(...RB);
  const light = (p) => {
    const rho = Math.hypot(p.x - C.x, p.z - C.z);
    if (rho > rMax || p.y > topD || p.y < bMin) return 1;
    const a = ((Math.atan2(p.z - C.z, p.x - C.x) / TAU) * NB + NB) % NB, i0 = Math.floor(a) % NB, i1 = (i0 + 1) % NB, t = a - Math.floor(a);
    const R = RB[i0] * (1 - t) + RB[i1] * t, Bf = BB[i0] * (1 - t) + BB[i1] * t;
    const inside = smoothstep(R - 4, R - 20, rho) * smoothstep(topD, topD - 20, p.y) * smoothstep(Bf + 4, Bf + 20, p.y);
    let m = 0;
    for (const q of mouths) {
      const dv = p.clone().sub(q.p), din = dv.dot(q.d), lat = dv.addScaledVector(q.d, -din).length();
      m = Math.max(m, (1 - smoothstep(-6, 60, din)) * (1 - smoothstep(60, 90, lat)));
    }
    return 1 - inside * (1 - m);
  };
  const arr = (a) => a.map((v) => v.toFixed(1)).join(', ');
  const glsl = `
const float HOL_R[${NB}] = float[${NB}]( ${arr(RB)} );
const float HOL_B[${NB}] = float[${NB}]( ${arr(BB)} );
float caveExtra( vec3 w ) {
	vec2 q = w.xz - vec2( ${C.x.toFixed(2)}, ${C.z.toFixed(2)} );
	float rho = length( q );
	if ( rho > ${rMax.toFixed(1)} || w.y > ${topD.toFixed(1)} || w.y < ${bMin.toFixed(1)} ) return 1.0;
	float a = atan( q.y, q.x ) * ${(NB / TAU).toFixed(6)} + ${NB.toFixed(1)};
	int i0 = int( a ) % ${NB}, i1 = ( i0 + 1 ) % ${NB};
	float t = fract( a ), R = mix( HOL_R[ i0 ], HOL_R[ i1 ], t ), B = mix( HOL_B[ i0 ], HOL_B[ i1 ], t );
	float inside = smoothstep( R - 4.0, R - 20.0, rho ) * smoothstep( ${topD.toFixed(1)}, ${(topD - 20).toFixed(1)}, w.y ) * smoothstep( B + 4.0, B + 20.0, w.y );
	float m = 0.0, din, lat; vec3 d;
${mouths.map((q) => `	d = w - ${f3(q.p)}; din = dot( d, ${f3(q.d, 4)} ); lat = length( d - ${f3(q.d, 4)} * din );
	m = max( m, ( 1.0 - smoothstep( -6.0, 60.0, din ) ) * ( 1.0 - smoothstep( 60.0, 90.0, lat ) ) );`).join('\n')}
	return 1.0 - inside * ( 1.0 - m );
}
// down a sinkhole: the sky's light in its shaft (more toward the top), a beam of it to the floor under it
float cavePixel( vec3 w, float k0 ) {
	if ( k0 > 0.995 ) return 0.0;
	float k = 0.0, dh;
${shafts.map((q) => `	dh = length( w.xz - vec2( ${q.axis.x.toFixed(2)}, ${q.axis.z.toFixed(2)} ) );
	k = max( k, ( 1.0 - smoothstep( ${(q.r * 0.55).toFixed(1)}, ${(q.r * 1.12).toFixed(1)}, dh ) ) * ( w.y > ${q.roof.toFixed(1)} ? mix( 0.4, 1.0, smoothstep( ${q.roof.toFixed(1)}, ${q.top.toFixed(1)}, w.y ) ) : 0.42 * smoothstep( ${(q.floor - 12).toFixed(1)}, ${(q.floor + 10).toFixed(1)}, w.y ) ) );`).join('\n')}
	return k;
}
`;
  console.info(`hollow: cave ${(L / 1000).toFixed(2)} km, ${grid.length} rows, hill ${Math.round(Rm)} m across its widest, ${shafts.length} sinkholes, ` +
    `mouths ${Math.round(gateIn.d)} / ${Math.round(gateOut.d - L)} m from caveIn / caveOut${pierced ? `, ${pierced} points of the cave out of the hill!` : ''} (${Math.round(performance.now() - t0)} ms)`);
  return { L, sIn, sOut, rows, grid, NJ, rowAt, chunks, shape, topInfo, rimAt: shape.rimAt, I: { ...H, outline: undefined, cragAt: undefined }, C, outside,
    shafts, shaftGeo, lake, lakeY, river, riverY, light, glsl, mouths, mouthIn: gateIn.P, mouthOut: gateOut.P, gates: [gateIn.d, gateOut.d], pierced,
    portals: portals.map((q) => q.g) };
}

// ---------------------------------------------------------------- the dressing
// glowworm threads: thin silk lines from the roof, beads of light down them (instanced, additive, facing the camera)
function threadMaterial(time) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time },
    vertexShader: /* glsl */`
      attribute vec3 anchor; attribute vec2 thread; varying vec2 vT; varying float vLen; varying float vSeed;
      void main() {
        float t = -position.y;
        vec3 camL = cameraPosition - anchor;
        vec2 f = normalize(camL.xz + 1e-4);
        vec3 across = vec3(-f.y, 0.0, f.x) * 0.35;
        vec3 w = anchor + vec3(0.0, -t * thread.x, 0.0) + across * position.x;
        vT = vec2(position.x, t); vLen = thread.x; vSeed = thread.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec2 vT; varying float vLen; varying float vSeed;
      void main() {
        float x = abs(vT.x) * 2.0, m = vT.y * vLen;               // across 0..1, metres down
        float line = exp(-x * x * 60.0) * 0.06;
        float k = fract(m / 0.45 + vSeed * 7.0), bead = exp(-pow((k - 0.5) * 0.45 / 0.05, 2.0) - x * x * 6.0);
        float tw = 0.7 + 0.3 * sin(time * 1.3 + vSeed * 40.0 + floor(m / 0.45) * 2.1);
        vec3 c = vec3(0.25, 0.95, 0.85) * (line + bead * 1.4 * tw) * smoothstep(1.0, 0.7, vT.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// emissive, unlit: crystals (their facets catching an inner light, brighter to their tips) and the like
function crystalMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute float tipK; varying vec3 vN; varying vec3 vV; varying float vTip; varying vec3 vC;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        vTip = tipK; vC = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vTip; varying vec3 vC;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - f, 3.0);
        vec3 c = vC * (0.12 + 0.95 * vTip * vTip + 0.5 * rim) + vec3(0.8, 0.9, 1.0) * pow(f, 40.0) * 0.4;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// the falls under the hill: a sheet (water.js's) lit by the daylight coming down the shaft with it, fading to the
// glow of the cave as it falls; spray where it lands
function caveFallMaterial(time) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { waterTime: time },
    vertexShader: /* glsl */`
      attribute vec2 wAux; varying vec2 vUv; varying vec2 vAux; varying float vY;
      void main() { vUv = uv; vAux = wAux; vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float waterTime; varying vec2 vUv; varying vec2 vAux; varying float vY;
      ${NOISE}
      void main() {
        float t = vUv.y, x = vUv.x * vAux.x, tf = t - waterTime;
        float st = wN(vec2(x / 1.4, tf * 2.2)) * 0.5 + wN(vec2(x / 0.55, tf * 5.0 + 3.0)) * 0.3 + wN(vec2(x / 3.5, tf * 0.8 + 7.0)) * 0.2;
        float ropes = wN(vec2(x / (2.0 + t * 0.6), tf * 0.6 + 11.0));
        float cover = smoothstep(0.2, 0.5, ropes + 0.9 - t * 0.07);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float a = cover * edge * (0.6 + 0.4 * st);
        if (a < 0.01) discard;
        float foam = clamp(smoothstep(0.45, 0.8, st) * 0.7 + smoothstep(1.0, 0.0, t) * 0.5 + smoothstep(2.0, 6.0, t) * 0.4, 0.0, 1.0);
        float day = exp(-t * 0.42);                                  // the shaft's daylight, left behind as it falls
        vec3 lit = vec3(1.0, 0.97, 0.85) * 1.6 * day + vec3(0.12, 0.42, 0.38) * 0.35;
        gl_FragColor = vec4(mix(vec3(0.1, 0.16, 0.15), vec3(0.85, 0.9, 0.92), foam) * lit, a * mix(0.6, 0.95, foam));
      }`,
  });
}

// still water in the dark: black, the glow and the shaft's light in it (a fake reflection by the angle), rings
// spreading from where the fall lands; the river: the same, flowing (streaks running along it, foam at its banks)
function caveWaterMaterial(time, { flow = 0, hit = new THREE.Vector3(), beam = new THREE.Vector3() } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time, hit: { value: hit }, beam: { value: beam } },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 hit; uniform vec3 beam; varying vec2 vUv; varying vec3 vW;
      ${NOISE}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
        vec2 p = vW.xz;
        float flowT = time * ${flow.toFixed(1)};
        float n = wN(vec2(vUv.x / 3.0, (vUv.y - flowT) / 9.0)) * 0.6 + wN(p / 1.7 + time * 0.3) * 0.4;
        float d = length(vW.xz - hit.xz), ring = sin(d * 0.6 - time * 4.0) * exp(-d / 70.0) * 0.5 + 0.5;
        float foam = smoothstep(0.62, 0.8, n) * (${flow > 0 ? '0.5' : '0.0'} + exp(-d / 45.0));
        vec3 deep = vec3(0.006, 0.02, 0.02) * (0.6 + 0.8 * n);
        vec3 refl = vec3(0.04, 0.16, 0.15) * (0.6 + 0.8 * n) + vec3(1.0, 0.95, 0.8) * 0.9 * exp(-length(vW.xz - beam.xz) / 40.0) * (0.6 + 0.4 * ring);
        vec3 c = mix(deep, refl, fres) + vec3(0.6, 0.7, 0.68) * foam * 0.18 * (0.4 + 0.6 * ring)
          + vec3(0.55, 0.7, 0.75) * 0.3 * exp(-d / 26.0) * (0.5 + 0.5 * ring);                 // the churn where the fall lands
        // (running water: long streaks of the glow on it, carried along)
        c += vec3(0.3, 0.6, 0.58) * 0.14 * ${flow > 0 ? '1.0' : '0.0'} * smoothstep(0.55, 0.78, wN(vec2(vUv.x / 1.6, (vUv.y - flowT * 1.3) / 16.0)));
        gl_FragColor = vec4(c, 0.92);
      }`,
  });
}

// a beam of daylight down a sinkhole: a soft column (brightest seen across its middle, fading at its sides and toward
// the floor), motes drifting in it
function beamMaterial(time) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { time },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW; varying float vH;
      attribute float h;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = h; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec3 vN; varying vec3 vW; varying float vH;
      ${NOISE}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float f = abs(dot(normalize(vN), V));
        float n = wN(vec2(atan(vN.z, vN.x) * 3.0, vW.y * 0.02 - time * 0.05)) * 0.6 + 0.4;
        float a = pow(f, 1.6) * (0.25 + 0.75 * vH) * smoothstep(0.0, 0.08, vH) * n;
        float near = smoothstep(4.0, 30.0, length(cameraPosition - vW));
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.82) * a * 0.32 * near, 1.0);
      }`,
  });
}

// The cave's dressing: what glows (glowworm threads and their sky of lights on the roofs, fungi shelving out of the
// walls, a forest of giant fungi, crystals), the stalactites and columns, the roots of the jungle, the falls and the
// lake, the river, the beams of daylight. mats: { rock (the cave's), bark (with lamps) }
export function caveDressing(scene, H, track, mats, dens = 1) {
  const rnd = mulberry32(808), out = [], noAO = [], time = { value: 0 }, f = {};
  const { rows, grid, NJ } = H;
  const local = (r, p) => { const rw = rows[r], dv = p.clone().sub(rw.P); return { x: dv.dot(rw.R), y: dv.dot(rw.U), xl: dv.dot(rw.Rl), yl: dv.dot(rw.Ul) }; };
  const inward = (r, p) => rows[r].P.clone().addScaledVector(rows[r].U, 8).sub(p).normalize();
  // (a point clear of the ships' way: the nearest row's banked frame)
  const clearOfWay = (p, ri) => {
    let best = ri, bd = 1e18;
    for (let r = Math.max(0, ri - 40); r < Math.min(rows.length, ri + 40); r++) { const q = rows[r].P.distanceToSquared(p); if (q < bd) { bd = q; best = r; } }
    const dv = p.clone().sub(rows[best].P), x = dv.dot(rows[best].R), y = dv.dot(rows[best].U);
    return !(Math.abs(x) < XC + 2 && y > YB && y < YT + 4);
  };
  const threads = [], dots = [], caps = [], crystals = [], drips = [], shrooms = [];
  for (let r = 4; r < grid.length - 4; r++) {
    const rw = rows[r], w = rw.sec.w;
    if (rw.d < 20 || rw.d > H.L - 20) continue;
    const roofK = 0.3 + 0.7 * (w.gallery + w.river + w.mouth * 0.4 + w.fissure * 0.6 + w.exit * 0.5 + w.roots * 0.4) + 1.2 * w.cavern;
    for (let j = 0; j < NJ; j++) {
      const p = grid[r][j], q = local(r, p);
      if (q.yl > 24 && q.y > 30) {                                       // the roof
        if (rnd() < 0.5 * roofK * dens) dots.push(Object.assign(p.clone().addScaledVector(UP, -0.4), { r }));
        if (rnd() < 0.2 * roofK * dens) threads.push({ r, p: p.clone().addScaledVector(UP, -0.5), len: Math.min(q.y - 26, 2 + Math.pow(rnd(), 1.4) * (w.cavern > 0.5 ? 45 : 14)), seed: rnd() });
      }
      if (q.yl > -40 && q.yl < 30 && Math.abs(q.x) > XC && rnd() < (0.04 + 0.1 * w.fungi + 0.04 * w.gallery + 0.05 * w.hall) * dens) caps.push({ r, p, n: inward(r, p), hue: w.hall > 0.5 ? 0.9 + rnd() * 0.1 : rnd() * 0.88 });
      // crystals: the throat's walls, here and there in the fissure and the cavern
      const ck = w.throat * 0.09 + w.fissure * 0.006;
      if (Math.abs(q.x) > XC + 2 && rnd() < ck * dens) crystals.push({ p, n: inward(r, p), s: 2 + Math.pow(rnd(), 2) * 7, hue: rnd() });
      // stalactites from the hall's roof (and the cavern's), stalagmites off its floor
      const sk = w.hall * 0.3 + w.cavern * 0.07 + w.throat * 0.035 + w.fissure * 0.025;
      if (q.yl > 20 && rnd() < sk * dens) drips.push({ r, p, down: true, len: Math.min((q.y - YT - 3) * 0.95, 6 + Math.pow(rnd(), 1.6) * (w.cavern > 0.5 ? 70 : 34)) });
      if (q.yl < -16 && rnd() < sk * 0.6 * dens) drips.push({ r, p, down: false, len: Math.min(Math.abs(q.x) > XC + 4 ? 60 : (YB - q.y - 3), 4 + Math.pow(rnd(), 1.5) * 26) });
      // the giant fungi on the floor of their chamber
      if (w.fungi > 0.5 && q.yl < -30 && rnd() < 0.03 * w.fungi) shrooms.push({ p, r, s: 0.5 + rnd() * 0.8 });
    }
  }
  // (each kind of thing in stretches of ~300 m: a draw a stretch, culled with it)
  const REG = 100, regions = (list) => { const m = new Map(); for (const q of list) { const k = Math.floor(q.r / REG); if (!m.has(k)) m.set(k, []); m.get(k).push(q); } return [...m.values()]; };
  const sphereOf = (pts, pad) => { const sp = new THREE.Sphere().setFromPoints(pts); sp.radius += pad; return sp; };
  // threads (instanced quads, the length down from the anchor)
  const threadMat = threadMaterial(time);
  for (const list of regions(threads)) {
    const g = new THREE.InstancedBufferGeometry(), N = 10, pos = [], idx = [];
    for (let i = 0; i <= N; i++) pos.push(-0.5, -i / N, 0, 0.5, -i / N, 0);
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const an = new Float32Array(list.length * 3), th = new Float32Array(list.length * 2);
    list.forEach((q, i) => { an.set([q.p.x, q.p.y, q.p.z], i * 3); th.set([Math.max(1, q.len), q.seed], i * 2); });
    g.setAttribute('anchor', new THREE.InstancedBufferAttribute(an, 3));
    g.setAttribute('thread', new THREE.InstancedBufferAttribute(th, 2));
    g.instanceCount = list.length;
    g.boundingSphere = sphereOf(list.map((q) => q.p), 50);
    const m = new THREE.Mesh(g, threadMat);
    m.renderOrder = 3; m.name = 'cave-threads';
    out.push(m); noAO.push(m);
  }
  // the roofs' sky of lights
  const pr = { value: 1 };
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time, pr },
    vertexShader: /* glsl */`attribute float seed; uniform float time, pr; varying float vB;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vB = (0.55 + 0.45 * sin(time * (0.6 + seed) + seed * 30.0)) * (0.5 + seed);
        gl_PointSize = pr * clamp(90.0 / -mv.z, 1.2, 3.5); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`varying float vB;
      void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.3, 0.9, 1.0) * vB * smoothstep(0.5, 0.0, r) * 1.4, 1.0); }`,
  });
  for (const list of regions(dots)) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(list.length * 3), sd = new Float32Array(list.length);
    list.forEach((v, i) => { p.set([v.x + (rnd() - 0.5) * 3, v.y + (rnd() - 0.5) * 2, v.z + (rnd() - 0.5) * 3], i * 3); sd[i] = rnd(); });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    g.computeBoundingSphere();
    const m = new THREE.Points(g, dotMat);
    m.name = 'cave-lights';
    out.push(m); noAO.push(m);
  }
  // fungi: shelf caps in clusters out of the walls, glowing (teal, violet, amber), lit too by the ships' lights
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), c = new THREE.Color(), S3 = new THREE.Vector3();
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 1 });
  const capG = new THREE.SphereGeometry(1, 8, 3, 0, TAU, 0, Math.PI / 2).scale(1, 0.32, 1);
  for (const list of regions(caps)) {
    const im = new THREE.InstancedMesh(capG, capMat, list.length * 3);
    let n = 0;
    for (const q of list) {
      const col = q.hue < 0.55 ? [0.02, 0.7, 0.55] : q.hue < 0.85 ? [0.45, 0.06, 0.8] : [0.8, 0.35, 0.03];
      for (let k = 0; k < 3; k++) {
        const s = 0.35 + rnd() * 0.85, p = q.p.clone().addScaledVector(q.n, 0.1).add(new THREE.Vector3((rnd() - 0.5) * 2, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 2));
        Qn.setFromUnitVectors(UP, UP.clone().lerp(q.n, 0.35).normalize());
        M.compose(p, Qn, S3.set(s, s, s));
        im.setMatrixAt(n, M);
        im.setColorAt(n, c.setRGB(...col).multiplyScalar(0.6 + rnd() * 0.6));
        n++;
      }
    }
    im.count = n;
    capMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  #ifdef USE_COLOR
    totalEmissiveRadiance = vColor * 0.55 * (0.3 + 0.7 * pow(max(dot(normalize(vNormal), mat3(viewMatrix) * vec3(0.0, -1.0, 0.0)), 0.0), 2.0));
  #endif`).replace('#include <color_fragment>', '');
    };
    capMat.customProgramCacheKey = () => 'forest-fungi';
    im.computeBoundingSphere();
    im.name = 'cave-fungi';
    out.push(im);
  }
  // the giant fungi: a pale stalk, a broad cap glowing underneath (its gills), on the floor of their chamber
  if (shrooms.length) {
    const parts = [];
    {
      const stalk = new THREE.CylinderGeometry(0.06, 0.1, 1, 10, 6, true).translate(0, 0.5, 0);
      const sp = stalk.attributes.position;
      for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); sp.setX(i, sp.getX(i) + Math.sin(y * 2.4) * 0.05); }
      const capG = new THREE.SphereGeometry(0.42, 18, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.38, 1).translate(0, 0.98, 0);
      const gills = new THREE.CircleGeometry(0.41, 18).rotateX(Math.PI / 2).translate(0, 0.985, 0);
      for (const [g, k] of [[stalk, 0], [capG, 0.25], [gills, 1]]) { const x = g.toNonIndexed(); x.deleteAttribute('uv'); x.setAttribute('glowK', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count).fill(k), 1)); parts.push(x); }
    }
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x161614, roughness: 0.85, emissive: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glowK; varying float vGlowK;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlowK = glowK;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlowK;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  #ifdef USE_COLOR
    totalEmissiveRadiance = vColor * (vGlowK * 0.9 + 0.025);
  #endif`).replace('#include <color_fragment>', '');
    };
    mat.customProgramCacheKey = () => 'forest-shroom';
    const im = new THREE.InstancedMesh(geo, mat, shrooms.length);
    shrooms.forEach((q, i) => {
      // as tall as it can be with its stalk and cap clear of the ships' way
      let hgt = (26 + rnd() * 44) * q.s, wid = 0;
      const kw = 0.55 + rnd() * 0.45;
      for (let k = 0; k < 6 && !wid; k++, hgt *= 0.78) {
        const top = q.p.clone().addScaledVector(UP, hgt * 0.98 - 1.5), rc = hgt * kw * 0.44;
        const pts = [0.3, 0.6, 1.1].map((t) => q.p.clone().addScaledVector(UP, hgt * t * 0.98))
          .concat(Array.from({ length: 8 }, (_, a) => top.clone().add(new THREE.Vector3(Math.cos((a * TAU) / 8) * rc, 0, Math.sin((a * TAU) / 8) * rc))));
        if (pts.every((p) => clearOfWay(p, q.r))) wid = hgt * kw;
      }
      if (!wid || hgt < 6) { M.makeScale(0, 0, 0); im.setMatrixAt(i, M); return; }
      Qn.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.12, rnd() * TAU, (rnd() - 0.5) * 0.12));
      M.compose(q.p.clone().addScaledVector(UP, -1.5), Qn, S3.set(wid, hgt, wid));
      im.setMatrixAt(i, M);
      im.setColorAt(i, c.setRGB(...(rnd() < 0.7 ? [0.05, 0.75, 0.6] : [0.35, 0.2, 0.95])).multiplyScalar(0.7 + rnd() * 0.5));
    });
    im.computeBoundingSphere();
    im.name = 'cave-giant-fungi';
    out.push(im);
  }
  // crystals: clusters of six-sided prisms out of the walls, violet and cyan, lit from inside
  if (crystals.length) {
    const prisms = [];
    for (let k = 0; k < 7; k++) {
      const len = k ? 0.45 + rnd() * 0.6 : 1, r = len * (0.15 + rnd() * 0.09);
      const g = new THREE.CylinderGeometry(r * 0.15, r, len, 6, 1).translate(0, len / 2, 0);
      g.rotateX((rnd() - 0.5) * 1.3); g.rotateZ((rnd() - 0.5) * 1.3);
      g.translate((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
      const x = g.toNonIndexed(), p = x.attributes.position, tk = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) tk[i] = clamp(p.getY(i) / len, 0, 1);
      x.setAttribute('tipK', new THREE.Float32BufferAttribute(tk, 1));
      x.deleteAttribute('uv');
      prisms.push(x);
    }
    const geo = mergeGeometries(prisms);
    const im = new THREE.InstancedMesh(geo, crystalMaterial(), crystals.length);
    crystals.forEach((q, i) => {
      Qn.setFromUnitVectors(UP, q.n.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6)).normalize());
      M.compose(q.p.clone().addScaledVector(q.n, -0.5), Qn, S3.set(q.s, q.s, q.s));
      im.setMatrixAt(i, M);
      im.setColorAt(i, c.setRGB(...(q.hue < 0.6 ? [0.45, 0.12, 1.0] : q.hue < 0.9 ? [0.1, 0.65, 1.0] : [0.9, 0.3, 0.9])).multiplyScalar(0.8 + rnd() * 0.5));
    });
    im.computeBoundingSphere();
    im.name = 'cave-crystals';
    out.push(im);
  }
  // stalactites and stalagmites: lumpy cones of the cave's rock; columns where one met the other, beside the way
  {
    const cone = new THREE.ConeGeometry(1, 1, 7, 4, false).rotateX(Math.PI).translate(0, -0.5, 0);     // tip down, base at 0
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 + 0.22 * Math.sin(y * 9 + p.getX(i) * 3) * (1 + y); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    cone.computeVertexNormals();
    cone.setAttribute('isl', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2).map((_, i) => (i % 2 ? 0.25 : 0)), 2));
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), mats4 = [];
    for (const q of drips) {
      if (q.len <= 3) continue;
      const r = q.len * (0.1 + rnd() * 0.08);
      M.compose(q.p.clone().addScaledVector(UP, q.down ? 2 : -2), q.down ? new THREE.Quaternion() : flip, S3.set(r, q.len + 2, r));
      mats4.push({ r: q.r, m: M.clone() });
    }
    rows.forEach((rw, ri) => {
      if (rw.sec.w.hall < 0.6 || rnd() > 0.08) return;
      // a column: a stalactite and a stalagmite run together (each down / up past the middle), beside the way
      const side = rnd() < 0.5 ? -1 : 1, base = rw.P.clone().addScaledVector(rw.Rl, side * (XC + 15 + rnd() * 26)), cr = 5 + rnd() * 6;
      const top = rw.P.y + rw.sec.up + 8, bot = rw.P.y - rw.sec.down - 8, mid = (top + bot) / 2;
      mats4.push({ r: ri, m: new THREE.Matrix4().compose(new THREE.Vector3(base.x, top, base.z), new THREE.Quaternion(), new THREE.Vector3(cr, top - mid + 6, cr)) });
      mats4.push({ r: ri, m: new THREE.Matrix4().compose(new THREE.Vector3(base.x, bot, base.z), flip, new THREE.Vector3(cr * 1.15, mid - bot + 6, cr * 1.15)) });
    });
    for (const list of regions(mats4)) {
      const im = new THREE.InstancedMesh(cone, mats.rock, list.length);
      list.forEach((q, i) => im.setMatrixAt(i, q.m));
      im.computeBoundingSphere();
      im.name = 'cave-drips';
      out.push(im);
    }
  }
  // the roots of the jungle overhead: down through the roof of their hall, twisting, down the walls into the floor
  // beside the way or arching over it high up; thin ones hanging
  {
    const tubes = [];
    const roots = rows.filter((rw) => rw.sec.w.roots > 0.55);
    for (let k = 0; k < Math.round(16 * Math.max(0.6, dens)); k++) {
      const rw = roots[Math.floor(rnd() * roots.length)], side = rnd() < 0.5 ? -1 : 1;
      const ri = rows.indexOf(rw), over = rnd() < 0.3;
      const top = rw.P.clone().addScaledVector(rw.Rl, side * (10 + rnd() * 50)).addScaledVector(UP, rw.sec.up + 12);
      const path = [], radii = [], R0 = 3 + rnd() * 4.5, tw = rnd() * TAU;
      const along = rw.T.clone().setY(0).normalize().multiplyScalar((rnd() - 0.5) * 60);
      const end = over ? rows[Math.min(rows.length - 1, ri + 15 + Math.floor(rnd() * 15))].P.clone().addScaledVector(rw.Rl, -side * (XC + 18)).addScaledVector(UP, 34 + rnd() * 25)
        : rw.P.clone().addScaledVector(rw.Rl, side * (XC + 10 + rnd() * 22)).addScaledVector(UP, -rw.sec.down - 6).add(along);
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, p = top.clone().lerp(end, t);
        // sagging out from the wall, a lazy twist round its line
        p.addScaledVector(rw.Rl, side * Math.sin(Math.PI * t) * (over ? -10 : 16));
        if (over) p.y += Math.sin(Math.PI * t) * 18;
        p.x += Math.sin(t * 7 + tw) * 3; p.z += Math.cos(t * 6 + tw) * 3;
        path.push(p); radii.push(R0 * (1 - 0.65 * t) + 0.4);
      }
      if (!path.every((p, i) => clearOfWay(p.clone().addScaledVector(UP, -radii[i]), ri))) continue;
      tubes.push(barkTube(path, radii, 10));
      // its rootlets hanging off it
      for (let q = 0; q < 6; q++) {
        const i0 = 3 + Math.floor(rnd() * 16), a = path[i0], len = 6 + rnd() * 22, pp = [], rr = [];
        for (let i = 0; i <= 6; i++) { const t = i / 6; pp.push(a.clone().add(new THREE.Vector3(Math.sin(t * 4 + q) * 1.5, -len * t, Math.cos(t * 3 + q) * 1.5))); rr.push(0.5 * (1 - t) + 0.08); }
        if (!pp.every((p) => clearOfWay(p, ri))) continue;
        tubes.push(barkTube(pp, rr, 5));
      }
    }
    // tangles hanging from the roof all over the hall
    for (const rw of roots) {
      if (rnd() > 0.5) continue;
      const ri = rows.indexOf(rw);
      const a = rw.P.clone().addScaledVector(rw.Rl, (rnd() - 0.5) * 2 * rw.sec.wl * 0.8).addScaledVector(UP, rw.sec.up * 0.9);
      const lp = a.clone().sub(rw.P), room = Math.abs(lp.dot(rw.R)) < XC + 4 ? lp.dot(rw.U) - YT - 6 : 60;
      if (room < 6) continue;
      const len = Math.min(room, 6 + rnd() * 36), pp = [], rr = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; pp.push(a.clone().add(new THREE.Vector3(Math.sin(t * 5 + len) * 2, 4 - (len + 4) * t, Math.cos(t * 4 + len) * 2))); rr.push(1.2 * (1 - t) + 0.12); }
      if (!pp.every((p) => clearOfWay(p, ri))) continue;
      tubes.push(barkTube(pp, rr, 6));
    }
    if (tubes.length) {
      const m = new THREE.Mesh(mergeGeometries(tubes), mats.bark);
      m.name = 'cave-roots';
      out.push(m);
    }
  }
  // the falls: the jungle's river down the first sinkhole into the cavern's lake; spray where it lands
  const falls = [];
  for (const q of H.shafts.filter((s) => s.fall)) {
    const out2 = H.C.clone().setY(0).sub(q.axis).normalize();
    const lip = q.axis.clone().setY(q.roof + 6).addScaledVector(out2, -q.r * 0.35);
    const tEnd = Math.sqrt((2 * (lip.y - H.lakeY)) / 9.8);
    const g = sheet({ lip, out: out2, width: q.r * 0.9, v: 1.6, tEnd, seed: 41 });
    const m = new THREE.Mesh(g, caveFallMaterial(time));
    m.renderOrder = 3; m.name = 'cave-fall';
    out.push(m); noAO.push(m);
    const hit = lip.clone().addScaledVector(out2, 1.6 * tEnd).setY(H.lakeY);
    falls.push({ lip, out: out2, hit, q });
  }
  // the lake and the river
  const hit = falls[0]?.hit || new THREE.Vector3(), beamAt = H.shafts[0].axis.clone();
  for (const [g, flow, name] of [[H.lake, 0, 'cave-lake'], [H.river, 1.4, 'cave-river']]) {
    if (!g.index || !g.index.count) continue;
    const m = new THREE.Mesh(g, caveWaterMaterial(time, { flow, hit, beam: flow ? H.shafts[2].axis : beamAt }));
    m.renderOrder = 2; m.name = name;
    out.push(m); noAO.push(m);
  }
  // spray: soft puffs over where the fall lands, lit by the beam
  if (falls.length) {
    const n = Math.round(26 * Math.max(0.5, dens)), g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const cc = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const h = falls[0].hit, a = rnd() * TAU, r = Math.pow(rnd(), 0.7) * 34; cc.set([h.x + Math.cos(a) * r, h.y + 4 + rnd() * 40, h.z + Math.sin(a) * r, 18 + rnd() * 26], i * 4); }
    g.setAttribute('puff', new THREE.InstancedBufferAttribute(cc, 4));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { time },
      vertexShader: /* glsl */`attribute vec4 puff; uniform float time; varying vec2 vQ; varying float vA;
        void main() {
          float age = fract(time / 7.0 + puff.x * 0.013 + puff.z * 0.007);
          vec3 c = puff.xyz + vec3(0.0, age * 14.0, 0.0);
          float size = puff.w * (0.7 + 0.6 * age);
          vA = smoothstep(0.0, 0.25, age) * smoothstep(1.0, 0.5, age);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vQ = uv; gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * uv.x + up * uv.y) * size, 1.0);
        }`,
      fragmentShader: /* glsl */`varying vec2 vQ; varying float vA;
        void main() { float r = length(vQ) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vec3(0.55, 0.62, 0.6), vA * exp(-r * r * 3.0) * 0.16); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 4; m.name = 'cave-spray';
    out.push(m); noAO.push(m);
  }
  // the beams of daylight down the sinkholes, to the floor
  {
    const parts = [];
    for (const q of H.shafts) {
      const y0 = q.floor - 4, y1 = q.top - 4, r = q.r * 0.82, N = 28, K = 10, pos = [], nrm = [], hh = [], idx = [];
      for (let i = 0; i <= K; i++) {
        const t = i / K, y = y0 + (y1 - y0) * t, rr = r * (0.85 + 0.15 * t);
        for (let j = 0; j <= N; j++) { const a = (j / N) * TAU; pos.push(q.axis.x + Math.cos(a) * rr, y, q.axis.z + Math.sin(a) * rr); nrm.push(Math.cos(a), 0, Math.sin(a)); hh.push(t); }
      }
      for (let i = 0; i < K; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + 1, d = a + N + 1, e = d + 1; idx.push(a, b, d, b, e, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('h', new THREE.Float32BufferAttribute(hh, 1));
      g.setIndex(idx);
      parts.push(g);
    }
    const bm = beamMaterial(time);
    for (const g of parts) {
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, bm);
      m.renderOrder = 5; m.name = 'cave-beams';
      out.push(m); noAO.push(m);
    }
  }
  // what all this glow lights: a colour per vertex of the cave's rock (and the shafts'), added to its light - a faint
  // teal everywhere (the glowworms), pools round the fungi and the crystals, the daylight round the beams and the fall
  {
    const src = [];
    for (const q of caps) src.push([q.p, q.hue < 0.55 ? [0.02, 0.7, 0.55] : q.hue < 0.85 ? [0.45, 0.06, 0.8] : [0.8, 0.35, 0.03], 16, 0.05]);
    for (const q of shrooms) src.push([q.p.clone().addScaledVector(UP, 20), [0.05, 0.6, 0.55], 55, 0.12]);
    for (const q of crystals) src.push([q.p, q.hue < 0.6 ? [0.45, 0.12, 1.0] : [0.1, 0.65, 1.0], 24, 0.03 * q.s / 4]);
    for (let i = 0; i < dots.length; i += 6) src.push([dots[i], [0.2, 0.75, 0.85], 26, 0.035]);
    for (const q of H.shafts) {
      for (const y of [q.floor + 10, (q.floor + q.roof) / 2, q.roof, q.roof + 30]) src.push([q.axis.clone().setY(y), [1.0, 0.92, 0.75], q.r * 2.6, 0.3]);
    }
    for (const fl of falls) for (let t = 0; t <= 1; t += 0.2) src.push([fl.lip.clone().lerp(fl.hit, t), [0.7, 0.85, 0.85], 70, 0.12]);
    const cell = 90, hash = new Map(), key = (x, y, z) => `${x},${y},${z}`;
    for (const q of src) { const k = key(Math.floor(q[0].x / cell), Math.floor(q[0].y / cell), Math.floor(q[0].z / cell)); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(q); }
    const v = new THREE.Vector3(), tints = rows.map((rw) => [0, 1, 2].map((k) => CHAMBERS.reduce((a, c) => a + TINT[c.name][k] * rw.sec.w[c.name], 0)));
    const bake = (g, k0 = 1) => {
      const p = g.attributes.position, out3 = new Float32Array(p.count * 3), r0 = g.userData.row0;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        // (the chamber's own faint light, uneven: more of it in some reaches than others)
        const kb = k0 * (0.35 + 1.3 * n3(v.x * 0.012, v.y * 0.02, v.z * 0.012)), base = r0 == null ? TINT.roots : tints[Math.min(rows.length - 1, r0 + Math.floor(i / NJ))];
        let r = base[0] * kb, gg = base[1] * kb, b = base[2] * kb;
        const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
        for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c2 = -1; c2 <= 1; c2++) {
          for (const [sp, col, R, I] of hash.get(key(cx + a, cy + bb, cz + c2)) || []) {
            const d2 = v.distanceToSquared(sp) / (R * R);
            if (d2 > 6) continue;
            const w = I * Math.exp(-d2);
            r += col[0] * w; gg += col[1] * w; b += col[2] * w;
          }
        }
        out3.set([r, gg, b], i * 3);
      }
      g.setAttribute('camb', new THREE.BufferAttribute(out3, 3));
    };
    H.chunks.forEach((g) => bake(g));
    H.shaftGeo.forEach((g) => bake(g, 0.5));
  }
  for (const m of out) scene.add(m);
  console.info(`cave dressing: ${threads.length} threads, ${dots.length} lights, ${caps.length} fungi clusters, ${shrooms.length} giant fungi, ${crystals.length} crystals, ${drips.length} drips`);
  const fx = out.filter((m) => /cave-(beams|spray|threads|lights)/.test(m.name));
  return { meshes: out, noAO, falls, fx, update: (t, pixelRatio) => { time.value = t; pr.value = pixelRatio; } };
}

// The cave's rock: the islands' (lit by the ships' lights too), and the glow of what shines in the cave on it ('camb'
// per vertex, worked out once: caveDressing)
export function caveRock() {
  const mat = islandMaterial({ key: 'cave', side: THREE.DoubleSide, lamps: true });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 camb; varying vec3 vCamb;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vCamb = camb;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCamb;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vCamb;');
  };
  const key0 = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key0() + '-glow';
  return mat;
}
