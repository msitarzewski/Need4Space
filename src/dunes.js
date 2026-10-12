// The desert planet's ground: a sea of dunes - long transverse ridges across the wind (a gentle windward slope, a
// steep slip face, sharp crests), on broad swells, interdune flats of darker gravel between - combed by the wind into
// ripples (a tile painted once on the GPU, hex-tiled, laid along the wind). Under the circuit the sand is scoured into a
// trough below the deck; along the canyon stretch it is cut down into a gorge of layered sandstone, its walls stepping
// back at the hard beds; under the two jumps a chasm.
// The near ground is square tiles of a uniform grid, finer where the track runs (4 m in the canyon, 8 m near the track,
// 16 / 32 m further out), skirted (their edges hang down: no cracks between tiles of two sizes); beyond, rings out to
// the horizon. The sun is ~7.5 deg up: each vertex's own shadow from the dunes and the gorge (the horizon toward the sun,
// marched through a height raster at load) is baked in; what stands on the sand shades it through the world's map.
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { sunOnly } from './look.js';
import { fbm, noise2, smoothstep } from './noise.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { STRATA_GLSL } from './sandstone.js';
import { WIND, SUN_DIR } from './haze.js';

export const SAND_TILE = 48;                   // the ripple tile's size (m)
const SUN_TAN = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
const SUN_H = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();

// ---------------------------------------------------------------- the track's footprint
// the nearest sample of the centre line to any point (x, z): a raster of nearest samples (8 m cells, propagated from
// the samples outward), refined over the samples round it
class TrackField {
  constructor(track, reach = 520, cell = 8) {
    const box = new THREE.Box3().setFromPoints(track.P);
    this.tr = track; this.cell = cell; this.reach = reach;
    this.x0 = box.min.x - reach; this.z0 = box.min.z - reach;
    this.nx = Math.ceil((box.max.x - box.min.x + 2 * reach) / cell); this.nz = Math.ceil((box.max.z - box.min.z + 2 * reach) / cell);
    const N = this.nx * this.nz, idx = (this.idx = new Int32Array(N).fill(-1)), dist = new Float32Array(N).fill(1e9);
    const P = track.P, px = track.px, pz = track.pz;
    const cd = (k, i) => { const cx = this.x0 + ((k % this.nx) + 0.5) * cell, cz = this.z0 + (Math.floor(k / this.nx) + 0.5) * cell; return Math.hypot(px[i] - cx, pz[i] - cz); };
    for (let i = 0; i < P.length; i++) {
      const cx = Math.floor((px[i] - this.x0) / cell), cz = Math.floor((pz[i] - this.z0) / cell), k = cz * this.nx + cx;
      const d = cd(k, i);
      if (d < dist[k]) { dist[k] = d; idx[k] = i; }
    }
    // two sweeps, each cell taking its neighbours' nearest sample when that is nearer
    const relax = (k, kn) => { const i = idx[kn]; if (i < 0) return; const d = cd(k, i); if (d < dist[k]) { dist[k] = d; idx[k] = i; } };
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const k = z * this.nx + x;
      if (x > 0) relax(k, k - 1);
      if (z > 0) { relax(k, k - this.nx); if (x > 0) relax(k, k - this.nx - 1); if (x < this.nx - 1) relax(k, k - this.nx + 1); }
    }
    for (let z = this.nz - 1; z >= 0; z--) for (let x = this.nx - 1; x >= 0; x--) {
      const k = z * this.nx + x;
      if (x < this.nx - 1) relax(k, k + 1);
      if (z < this.nz - 1) { relax(k, k + this.nx); if (x < this.nx - 1) relax(k, k + this.nx + 1); if (x > 0) relax(k, k + this.nx - 1); }
    }
    for (let k = 0; k < N; k++) if (dist[k] > reach) idx[k] = -1;
    this.out = { i: -1, d: 0, side: 0 };
  }
  // { i, d (horizontal distance to the centre line), side (+1 right of it) } or null
  near(x, z) {
    const cx = Math.floor((x - this.x0) / this.cell), cz = Math.floor((z - this.z0) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return null;
    const i0 = this.idx[cz * this.nx + cx];
    if (i0 < 0) return null;
    const tr = this.tr, n = tr.n, px = tr.px, pz = tr.pz;
    let best = 1e18, bi = i0;
    for (let k = -6; k <= 6; k++) {
      const i = (i0 + k + n) % n, d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const T = tr.T[bi], o = this.out;
    o.i = bi; o.d = Math.sqrt(best);
    o.side = Math.sign(T.x * (z - pz[bi]) - T.z * (x - px[bi])) || 1;
    return o;
  }
}

// ---------------------------------------------------------------- the ground's shape
// opts: canyons [[s0, s1]] (arc lengths: the gorge), rifts [{ c, dir, len, wid, depth }], piles [{ x, z, r, h }]
export class Dunes {
  constructor(track, { canyons = [], rifts = [], piles = [] } = {}) {
    this.tr = track;
    this.field = new TrackField(track, 1100);
    const n = track.n, W = 28 + 0.7;
    // per sample: the deck's lowest point (its bank and its girders), its half-width across in plan, the gorge's share
    this.low = new Float32Array(n); this.half = new Float32Array(n); this.kc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const P = track.P[i], R = track.R[i], U = track.U[i];
      this.low[i] = P.y - W * Math.abs(R.y) - Math.max(1.8, 4.2 * Math.abs(U.y));
      this.half[i] = W * Math.hypot(R.x, R.z) + 2;
      let k = 0;
      for (const [s0, s1] of canyons) {
        const s = i * track.step, d0 = track.wrap(s - s0), len = track.wrap(s1 - s0);
        if (d0 <= len) k = Math.max(k, smoothstep(0, 160, d0) * smoothstep(0, 160, len - d0));
      }
      this.kc[i] = k;
    }
    this.rifts = rifts.map((r) => ({ ...r, nrm: new THREE.Vector3(-r.dir.z, 0, r.dir.x) }));
    // the piles bucketed in 400 m cells (each in every cell its reach touches)
    this.piles = new Map();
    for (const p of piles) {
      const R = p.r * 4;
      for (let cx = Math.floor((p.x - R) / 400); cx <= Math.floor((p.x + R) / 400); cx++) for (let cz = Math.floor((p.z - R) / 400); cz <= Math.floor((p.z + R) / 400); cz++) {
        const k = cx * 100003 + cz;
        if (!this.piles.has(k)) this.piles.set(k, []);
        this.piles.get(k).push(p);
      }
    }
    this.wx = WIND.x; this.wz = WIND.z;
    this.out = { h: 0, rock: 0 };
  }

  // the dunes as the wind left them (far: their mean - finer than the far ground's rings can show)
  natural(x, z, far = false) {
    const a = x * this.wx + z * this.wz, c = -x * this.wz + z * this.wx;      // along the wind, across it
    let h = 26 * (fbm(x / 1500 + 7.1, z / 1500 - 3.3, 3) - 0.42);             // broad swells
    const amp = 4 + 24 * smoothstep(0.32, 0.68, fbm(c / 900 + 2.2, a / 1300, 3));
    if (far) return h + amp * 0.42;
    // transverse ridges: crests across the wind, sinuous; the slip face downwind
    const warp = 190 * (fbm(c / 650 + 3.1, a / 1000, 3) - 0.5) + 60 * (noise2(c / 230, a / 260) - 0.5);
    const ph = (a + warp) / 330, p = ph - Math.floor(ph);
    const pc = 0.74;
    const prof = p < pc ? Math.pow(Math.sin((Math.PI / 2) * (p / pc)), 1.6) : Math.pow(Math.cos((Math.PI / 2) * ((p - pc) / (1 - pc))), 1.25);
    h += amp * prof;
    // a second, finer set crossing them, and the sand's own swell
    const ph2 = (a * 0.8 + c * 0.6 + warp * 0.5) / 120, p2 = ph2 - Math.floor(ph2);
    h += amp * 0.16 * (p2 < 0.7 ? p2 / 0.7 : (1 - p2) / 0.3) * smoothstep(0.45, 0.7, fbm(x / 500, z / 500, 2));
    h += 2.2 * (fbm(x / 70, z / 70, 2) - 0.5);
    return h;
  }

  // { h: height, rock: 0..1 bare sandstone (the gorge's and the chasms' walls) }
  sample(x, z, far = false) {
    let h = this.natural(x, z, far), rock = 0;
    // sand piled against what stands in it (the ruined towers), a tail of it downwind
    for (const p of this.piles.get(Math.floor(x / 400) * 100003 + Math.floor(z / 400)) || []) {
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dx) > p.r * 4 || Math.abs(dz) > p.r * 4) continue;
      const along = dx * this.wx + dz * this.wz, across = -dx * this.wz + dz * this.wx;
      const e = (across * across) / (p.r * p.r * 1.4) + (along > 0 ? (along * along) / (p.r * p.r * 7) : (along * along) / (p.r * p.r * 1.2));
      h = Math.max(h, h * 0.3 + p.h * Math.exp(-e));
    }
    const n = this.field.near(x, z);
    if (n) {
      const i = n.i, kc = this.kc[i];
      let dd = n.d - this.half[i] - 5;
      if (kc > 0) dd -= kc * 24 * noise2(i * this.tr.step / 110 + (n.side > 0 ? 40 : 0), 3.7);   // (bays: only ever wider)
      const floor = this.low[i] - 4 - 6 * kc;
      let rise = Math.max(0, dd) * (0.5 + 3.4 * kc);
      if (kc > 0) {                                  // the gorge's walls step back at the hard beds
        const T = 14, t = rise / T, ft = t - Math.floor(t);
        rise += kc * 0.7 * ((Math.floor(t) + smoothstep(0.45, 0.95, ft)) * T - rise);
      }
      const g = floor + rise;
      if (g < h) {
        h = g;
        rock = kc * smoothstep(1, 8, rise);
      }
    }
    for (const R of this.rifts) {
      const dx = x - R.c.x, dz = z - R.c.z, along = dx * R.dir.x + dz * R.dir.z, across = dx * R.nrm.x + dz * R.nrm.z;
      const ends = smoothstep(R.len / 2, R.len / 2 - 160, Math.abs(along));
      if (ends <= 0) continue;
      const hw = (R.wid / 2) * (0.7 + 0.6 * noise2(along / 70, R.c.x * 0.01)) * (0.35 + 0.65 * ends);
      const k = smoothstep(hw, hw * 0.55, Math.abs(across) + 8 * (noise2(along / 16, across / 16) - 0.5));
      if (k <= 0) continue;
      const d = R.depth * (0.8 + 0.2 * noise2(along / 50, 2.1));
      // stepped walls
      const T = 11, t = (k * d) / T, ft = t - Math.floor(t), kd = (Math.floor(t) + smoothstep(0.4, 0.95, ft)) * T;
      h -= kd;
      rock = Math.max(rock, smoothstep(0.02, 0.2, k));
    }
    this.out.h = h; this.out.rock = rock;
    return this.out;
  }

  height(x, z) { return this.sample(x, z).h; }

  // the near ground: square tiles over a disc round the circuit's middle, each its own grid (4 / 8 / 16 / 32 m by how
  // near the track runs), in blocks (a mesh each, culled on its own); the far rings beyond
  build(mat, { rIn = 4400, rFar = 22000, dens = 1 } = {}) {
    const t0 = performance.now();
    const tr = this.tr, box = new THREE.Box3().setFromPoints(tr.P), C = box.getCenter(new THREE.Vector3());
    this.C = C;
    // a height raster (8 m) over the disc: the tiles at 8 m and coarser read it, the shadows march through it
    const RC = 8, half = Math.ceil((rIn + 400) / RC);
    const rn = 2 * half + 1, rx0 = Math.round(C.x / RC) * RC - half * RC, rz0 = Math.round(C.z / RC) * RC - half * RC;
    const H = new Float32Array(rn * rn), K = new Float32Array(rn * rn);
    const rr2 = (half + 2) * (half + 2);
    for (let j = 0; j < rn; j++) for (let i = 0; i < rn; i++) {
      // (the corners outside the disc: the far ground's own heights)
      const x = rx0 + i * RC, z = rz0 + j * RC, out = (i - half) ** 2 + (j - half) ** 2 > rr2;
      const s = out ? { h: this.natural(x, z, true), rock: 0 } : this.sample(x, z);
      H[j * rn + i] = s.h; K[j * rn + i] = s.rock;
    }
    this.raster = { H, K, rn, rx0, rz0, RC };
    const t1 = performance.now();
    const rH = (x, z) => {
      const fx = (x - rx0) / RC, fz = (z - rz0) / RC, i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= rn - 1 || j >= rn - 1) return -1e4;
      const u = fx - i, v = fz - j, k = j * rn + i;
      return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + rn] * (1 - u) + H[k + rn + 1] * u) * v;
    };
    // the sun's horizon over a point: lit 1 .. in the shadow of a dune or the gorge 0 (soft over ~1.4 deg)
    const shade = (x, y, z) => {
      let worst = -1;
      for (let t = 10; t < 1600; t *= 1.075) {
        const hy = rH(x + SUN_H.x * t, z + SUN_H.y * t);
        if (hy < -9e3) break;
        const e = (hy - y - 0.6) / t - SUN_TAN;
        if (e > worst) worst = e;
        if (worst > 0.03) break;
      }
      return 1 - smoothstep(-0.012, 0.012, worst);
    };
    // the tiles
    const TS = 192, nT = Math.ceil(rIn / TS), tiles = [];
    for (let tz = -nT; tz < nT; tz++) for (let tx = -nT; tx < nT; tx++) {
      const x0 = rx0 + half * RC + tx * TS, z0 = rz0 + half * RC + tz * TS;
      const cxT = x0 + TS / 2 - C.x, czT = z0 + TS / 2 - C.z;
      if (Math.hypot(cxT, czT) > rIn + TS * 0.71) continue;
      // how near the track runs (and whether the gorge does)
      let dmin = 1e9, kc = 0;
      for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
        const n = this.field.near(x0 + (a / 4) * TS, z0 + (b / 4) * TS);
        if (n) { dmin = Math.min(dmin, n.d); if (n.d < 170) kc = Math.max(kc, this.kc[n.i]); }
      }
      const res = kc > 0.3 ? 6 : dmin < 300 * Math.sqrt(dens) ? 8 : dmin < 800 ? 16 : Math.hypot(cxT, czT) < rIn * 0.62 ? 32 : 48;
      tiles.push({ x0, z0, res, cast: kc > 0.05 });
    }
    // blocks of 6 x 6 tiles
    const blocks = new Map();
    for (const t of tiles) {
      const k = `${Math.floor((t.x0 - C.x) / (TS * 6))},${Math.floor((t.z0 - C.z) / (TS * 6))},${t.cast ? 1 : 0}`;
      if (!blocks.has(k)) blocks.set(k, []);
      blocks.get(k).push(t);
    }
    const meshes = [];
    let nv = 0, ntri = 0;
    for (const [key, list] of blocks) {
      const pos = [], nrm = [], att = [], idx = [];
      for (const t of list) {
        const m = TS / t.res, n1 = m + 1, base = pos.length / 3;
        const hs = new Float32Array((n1 + 2) * (n1 + 2)), ks = new Float32Array(n1 * n1);
        // heights with a one-cell apron (the normals' central differences)
        for (let j = -1; j <= m + 1; j++) for (let i = -1; i <= m + 1; i++) {
          const x = t.x0 + i * t.res, z = t.z0 + j * t.res;
          let h;
          if (t.res >= RC) {
            const ri = Math.round((x - rx0) / RC), rj = Math.round((z - rz0) / RC);
            h = ri >= 0 && rj >= 0 && ri < rn && rj < rn ? H[rj * rn + ri] : this.sample(x, z).h;
            if (i >= 0 && j >= 0 && i <= m && j <= m) ks[j * n1 + i] = ri >= 0 && rj >= 0 && ri < rn && rj < rn ? K[rj * rn + ri] : 0;
          } else {
            const s = this.sample(x, z);
            h = s.h;
            if (i >= 0 && j >= 0 && i <= m && j <= m) ks[j * n1 + i] = s.rock;
          }
          hs[(j + 1) * (n1 + 2) + (i + 1)] = h;
        }
        const v = new THREE.Vector3();
        for (let j = 0; j <= m; j++) for (let i = 0; i <= m; i++) {
          const x = t.x0 + i * t.res, z = t.z0 + j * t.res, k = (j + 1) * (n1 + 2) + (i + 1), y = hs[k];
          v.set(-(hs[k + 1] - hs[k - 1]) / (2 * t.res), 1, -(hs[k + n1 + 2] - hs[k - n1 - 2]) / (2 * t.res)).normalize();
          pos.push(x, y, z); nrm.push(v.x, v.y, v.z);
          att.push(ks[j * n1 + i], shade(x, y, z));
        }
        for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
          const a = base + j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        // the skirt: each edge's vertices again, 14 m lower (a strip hanging down; faces out of the tile)
        const edge = (list2, flip) => {
          const s0 = pos.length / 3;
          for (const q of list2) {
            pos.push(pos[(base + q) * 3], pos[(base + q) * 3 + 1] - 14, pos[(base + q) * 3 + 2]);
            nrm.push(nrm[(base + q) * 3], nrm[(base + q) * 3 + 1], nrm[(base + q) * 3 + 2]);
            att.push(att[(base + q) * 2], att[(base + q) * 2 + 1]);
          }
          for (let k = 0; k < list2.length - 1; k++) {
            const a = base + list2[k], b = base + list2[k + 1], c = s0 + k, d = s0 + k + 1;
            if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
          }
        };
        const row = (j) => Array.from({ length: n1 }, (_, i) => j * n1 + i), col = (i) => Array.from({ length: n1 }, (_, j) => j * n1 + i);
        edge(row(0), false); edge(row(m), true); edge(col(0), true); edge(col(m), false);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('dune', new THREE.Float32BufferAttribute(att, 2));
      g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'dunes ' + key;
      mesh.receiveShadow = true;
      mesh.castShadow = key.endsWith(',1');               // (the gorge's tiles shade the deck in it: the world's map)
      meshes.push(mesh);
      nv += pos.length / 3; ntri += idx.length / 3;
    }
    const t2 = performance.now();
    // the far rings: from inside the disc's edge (sunk under the tiles there) out to the horizon
    const far = [], nA = Math.round(360 * Math.max(0.6, dens)), rings = [];
    for (let r = rIn - 260; r < rFar;) { rings.push(r); r += Math.max(40, r * 0.045); }
    rings.push(rFar);
    const nR = rings.length, fpos = new Float32Array(nR * nA * 3), fatt = new Float32Array(nR * nA * 2);
    for (let i = 0; i < nR; i++) for (let j = 0; j < nA; j++) {
      const a = (j / nA) * Math.PI * 2, x = C.x + Math.cos(a) * rings[i], z = C.z + Math.sin(a) * rings[i];
      const blend = smoothstep(rIn + 600, rIn + 2400, rings[i]);
      let h = this.sample(x, z, blend > 0.5).h;
      if (rings[i] < rIn + 200) h -= 6;
      const k = i * nA + j;
      fpos.set([x, h, z], k * 3);
      fatt.set([0, rings[i] < rIn + 2000 ? shade(x, h, z) : 1], k * 2);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fg.setAttribute('dune', new THREE.BufferAttribute(fatt, 2));
    const fidx = [];
    for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nA; j++) {
      const a = i * nA + j, b = i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
      fidx.push(a, b, c, b, d, c);
    }
    fg.setIndex(fidx);
    fg.computeVertexNormals();
    for (let s = 0; s < 8; s++) {
      const j0 = Math.floor((s * nA) / 8), j1 = Math.floor(((s + 1) * nA) / 8), si = [];
      for (let i = 0; i < nR - 1; i++) for (let j = j0; j < j1; j++) {
        const a = i * nA + j, b = i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
        si.push(a, b, c, b, d, c);
      }
      const sg = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'dune']) sg.setAttribute(k, fg.attributes[k]);
      sg.setIndex(si);
      sg.computeBoundingSphere(); sg.computeBoundingBox();
      const m = new THREE.Mesh(sg, mat);
      m.name = 'dunes-far';
      m.receiveShadow = true;
      far.push(m);
    }
    const byRes = {}; for (const t of tiles) byRes[t.res] = (byRes[t.res] || 0) + 1;
    console.info(`dunes: tiles by size ${JSON.stringify(byRes)}`);
    console.info(`dunes: raster ${(t1 - t0).toFixed(0)} ms, tiles ${(t2 - t1).toFixed(0)} ms (${tiles.length} tiles, ${meshes.length} blocks, ` +
      `${(nv / 1000).toFixed(0)} k verts, ${(ntri / 1000).toFixed(0)} k tris), far ${(performance.now() - t2).toFixed(0)} ms`);
    return { near: meshes, far, tris: ntri + fidx.length / 3 };
  }
}

// ---------------------------------------------------------------- the ripple tile
// rgb: ripple height (0..1), gravel, the megaripples' crest; a: height for the hex blend. Normal: the slope (m / m)
const TILE_GEN = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform int mode;
  uniform float texel;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vn(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float fbm(vec2 p, vec2 per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vn(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n; }
  // an asymmetric ripple (gentle stoss, steep lee), crest rounded
  float rip(float ph) { float p = fract(ph); return p < 0.72 ? smoothstep(0.0, 0.72, p) : 1.0 - smoothstep(0.72, 1.0, p); }
  // x along the wind (u), y across: rgb as above, w height (m)
  vec4 field(vec2 uv) {
    vec2 w = vec2(fbm(uv * 3.0, vec2(3.0), 4), fbm(uv * 3.0 + 7.3, vec2(3.0), 4)) - 0.5;
    // ripples ~1.2 m: sinuous, forking (a phase noise along their crests)
    float ph1 = uv.x * 40.0 + w.x * 1.6 + fbm(vec2(uv.x * 2.0, uv.y * 12.0), vec2(2.0, 12.0), 3) * 1.1;
    float r1 = rip(ph1);
    // megaripples ~6 m, here and there
    float ph2 = uv.x * 8.0 + w.y * 0.9 + fbm(vec2(uv.x * 1.0, uv.y * 4.0) + 3.1, vec2(1.0, 4.0), 3) * 0.6;
    float r2 = rip(ph2);
    float megaK = smoothstep(0.42, 0.66, fbm(uv * 2.0 + 1.7, vec2(2.0), 3));
    float gravel = smoothstep(0.55, 0.75, fbm(uv * 4.0 + 4.4, vec2(4.0), 4)) * (1.0 - megaK * 0.5);
    float fineK = 0.6 + 0.4 * fbm(uv * 6.0, vec2(6.0), 2);
    float h = r1 * 0.03 * fineK * (1.0 - gravel * 0.8) + r2 * 0.1 * megaK + (fbm(uv * 60.0, vec2(60.0), 2) - 0.5) * 0.006;
    return vec4(r1 * fineK, gravel, r2 * megaK, h);
  }
  void main() {
    vec4 F = field(vUv);
    if (mode == 0) { gl_FragColor = vec4(F.xyz, clamp(F.w * 4.0 + 0.2, 0.0, 1.0)); return; }
    float e = texel;
    float hx = field(vUv + vec2(e, 0.0)).w - field(vUv - vec2(e, 0.0)).w;
    float hy = field(vUv + vec2(0.0, e)).w - field(vUv - vec2(0.0, e)).w;
    vec2 g = vec2(hx, hy) / (2.0 * e * ${SAND_TILE.toFixed(1)});
    gl_FragColor = vec4(clamp(g * 2.0 + 0.5, 0.0, 1.0), 0.0, 1.0);
  }
`;

const U = { sandMask: { value: null }, sandNrm: { value: null } };
let maps = null;
export function sandMaps(renderer) {
  if (maps) return maps;
  const S = Q.tier === 'low' ? 1024 : 2048;
  const bake = (mode) => {
    const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { mode: { value: mode }, texel: { value: 1 / S } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: TILE_GEN }));
    for (let k = 0; k < 4; k++) {
      bakeLater(k ? [] : [quadJob(quad)], () => {
        const prev = renderer.getRenderTarget();
        rt.scissor.set(0, k * S / 4, S, S / 4); rt.scissorTest = true;
        rt.texture.generateMipmaps = k === 3;
        renderer.setRenderTarget(rt); quad.render(renderer);
        rt.scissorTest = false;
        renderer.setRenderTarget(prev);
        if (k === 3) { quad.material.dispose(); quad.dispose(); }
      });
    }
    return rt.texture;
  };
  maps = { mask: bake(0), normal: bake(1) };
  U.sandMask.value = maps.mask; U.sandNrm.value = maps.normal;
  return maps;
}

// the tile hex-tiled (three shifted copies blended over a hex grid by their heights; no rotation: the ripples keep the
// wind's line)
const HEX = /* glsl */`
uniform sampler2D sandMask, sandNrm;
vec2 sdHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
void sdTap(vec2 v, vec2 uv, vec2 gx, vec2 gy, out vec4 m, out vec2 g) {
  vec2 u2 = uv + sdHash(v * 1.71 + 5.3) * 7.0;
  m = textureGrad(sandMask, u2, gx, gy);
  g = (textureGrad(sandNrm, u2, gx, gy).xy - 0.5) * 0.5;
}
void sandHex(vec2 uv, out vec4 m, out vec2 g) {
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec2 st = uv * 2.0;
  vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
  vec2 b = floor(sk);
  vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  vec4 m0, m1, m2; vec2 g0, g1, g2;
  sdTap(b + vec2(s), uv, gx, gy, m0, g0);
  sdTap(b + vec2(s, 1.0 - s), uv, gx, gy, m1, g1);
  sdTap(b + vec2(1.0 - s, s), uv, gx, gy, m2, g2);
  vec3 W = pow(max(w, 0.0), vec3(5.0)) * pow(vec3(0.15) + vec3(m0.a, m1.a, m2.a), vec3(3.0));
  W /= W.x + W.y + W.z;
  m = m0 * W.x + m1 * W.y + m2 * W.z;
  g = g0 * W.x + g1 * W.y + g2 * W.z;
}
float sdH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sdN3(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(sdH3(i), sdH3(i + vec3(1, 0, 0)), u.x), mix(sdH3(i + vec3(0, 1, 0)), sdH3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(sdH3(i + vec3(0, 0, 1)), sdH3(i + vec3(1, 0, 1)), u.x), mix(sdH3(i + vec3(0, 1, 1)), sdH3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
`;

// ---------------------------------------------------------------- the material
// 'dune' per vertex: x bare rock (the gorge's walls), y lit by the sun (1) or in a dune's / the gorge's shadow (0)
export function sandMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  const W2 = new THREE.Vector2(WIND.x, WIND.z).normalize();
  const f = (x) => x.toFixed(5);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const lite = Q.lite ? '#define SAND_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 dune; varying vec2 vDune; varying vec3 vTW; varying float vDrift;
${STRATA_GLSL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vDune = dune;
  vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vDrift = ssN3(vTW * 0.006) * 22.0 + ssN3(vTW * 0.03) * 4.0;`);
    sh.fragmentShader = lite + sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vDune; varying vec3 vTW; varying float vDrift;
${HEX}
${STRATA_GLSL}
float sdRock = 0.0, sdGroove = 0.0;
vec2 sdG = vec2(0.0);`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 n0 = normalize(vNormal);
  float up = normalize((vec4(n0, 0.0) * viewMatrix).xyz).y;       // (the normal back in world space)
  vec2 wuv = vec2(dot(vTW.xz, vec2(${f(W2.x)}, ${f(W2.y)})), dot(vTW.xz, vec2(${f(-W2.y)}, ${f(W2.x)})));
  float sdFp = length(fwidth(vTW.xz));
  vec4 sm = vec4(0.45, 0.25, 0.3, 0.4); vec2 sg = vec2(0.0);
#ifdef SAND_LITE
  float sdFine = 0.0;
#else
  float sdFine = 1.0 - smoothstep(1.2, 3.0, sdFp);                 // (the tile only where its texels can show)
#endif
  if (sdFine > 0.0) { vec4 m; vec2 g; sandHex(wuv / ${SAND_TILE.toFixed(1)}, m, g); sm = mix(sm, m, sdFine); sg = g * sdFine; }
  // ripples lie on the gentler slopes; the slip faces are smooth
  float ripK = smoothstep(0.82, 0.95, up);
  sdG = sg * ripK;
  // the sand: orange, paler on the crests and the windward faces, redder in the hollows; gravel flats between
  float broad = sdN3(vTW * 0.0016) * 0.6 + sdN3(vTW * 0.006 + 3.0) * 0.4;
  vec3 sand = mix(vec3(0.42, 0.22, 0.1), vec3(0.54, 0.33, 0.17), broad);
  sand *= 0.92 + 0.12 * sm.r * ripK;
  float pav = smoothstep(0.985, 0.998, up) * smoothstep(0.55, 0.75, sdN3(vTW * 0.004 + 9.0));
  sand = mix(sand, vec3(0.2, 0.11, 0.065) * (0.8 + 0.4 * sm.g), max(sm.g * 0.55 * ripK, pav * 0.7));
  // the gorge's and the chasms' walls: the beds, sand on their ledges
  float lip, groove;
  vec3 bed = ssStrata(vTW.y + vDrift, lip, groove);
  float vn = sdN3(vec3(vTW.x * 0.11, vTW.y * 0.008, vTW.z * 0.11));
  bed *= (1.0 - 0.5 * smoothstep(0.55, 0.8, vn)) * (1.0 + 0.25 * lip);
  sdRock = vDune.x * (1.0 - smoothstep(0.78, 0.92, up + (sdN3(vTW * 0.08) - 0.5) * 0.3));
  sdGroove = groove * sdRock;
  diffuseColor.rgb = mix(sand, bed, sdRock);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.93, 0.85, sdRock);')
      // (the light the sunlit sand round it throws back: warm, into the shade too)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.07, 0.03, 0.012);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    // the ripples' slope, from the wind's frame back to the world's
    vec2 gw = vec2(${f(W2.x)}, ${f(W2.y)}) * sdG.x + vec2(${f(-W2.y)}, ${f(W2.x)}) * sdG.y;
    nw = normalize(nw - vec3(gw.x, 0.0, gw.y) * 1.7 * (1.0 - sdRock));
    nw = normalize(nw + vec3(0.0, sdGroove * 0.9, 0.0));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`);
    // the sun's light: in the shadow of the dunes and the gorge (baked per vertex)
    const L = THREE.ShaderChunk.lights_fragment_begin, at = 'getDirectionalLightInfo( directionalLight, directLight );';
    if (!L.includes(at)) throw new Error('lights chunk changed: dune shadow not applied');
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>',
      L.replace(at, `${at}\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= vDune.y;\n\t\t#endif`));
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `desert-sand-${Q.lite}`;
  return mat;
}
