// The forest moon's plants: broadleaf trees, emergent giants with buttress roots, palms, fern bushes, and the vines and
// roots that hang off everything. Leaves are painted once at load into an atlas (canvas: each shape drawn twice - in
// colour over a leaf-green ground, and in white for its coverage, so the mips never bleed black into the edges); the
// trees are built in code - tubes for wood, leaf cards in clusters whose normals point out of the cluster (a crown
// shades as one soft mass, not as flat cards). Leaves sway in the wind, flutter, and glow where the sun shines
// through them. Everything is instanced, per sector of the island field (a far sector swaps to coarser trees).
import * as THREE from 'three';
import { mulberry32, smoothstep } from './noise.js';
import { Q } from './quality.js';
import { SUN_DIR } from './atmo.js';
import { sunOnly } from './look.js';

export const FLORA_U = { floraTime: { value: 0 } };
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- textures
// atlas cells (canvas pixels, 1024 square): A broadleaf cluster, B fern clump, C palm frond (tall), D weeping strand (tall)
const S = 1024;
const CELL = { A: [0, 0, 512, 512], B: [0, 512, 512, 1024], C: [512, 0, 768, 1024], D: [768, 0, 1024, 1024] };
const cellUV = (k) => { const [x0, y0, x1, y1] = CELL[k]; return [x0 / S, 1 - y1 / S, x1 / S, 1 - y0 / S]; };

function paint(w, h, draw, ground) {
  const col = document.createElement('canvas'), msk = document.createElement('canvas');
  col.width = msk.width = w; col.height = msk.height = h;
  const gc = col.getContext('2d'), gm = msk.getContext('2d');
  gc.fillStyle = ground; gc.fillRect(0, 0, w, h);
  gm.fillStyle = '#000'; gm.fillRect(0, 0, w, h);
  draw(gc, false); draw(gm, true);
  const a = gc.getImageData(0, 0, w, h), m = gm.getImageData(0, 0, w, h);
  for (let i = 0; i < a.data.length; i += 4) a.data[i + 3] = m.data[i];
  const t = new THREE.DataTexture(a.data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// a leaf: a pointed oval from (x, y) along angle ang (canvas), its midrib
function leaf(g, mask, x, y, ang, len, wid, col, rib = true) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(wid, -len * 0.22, wid * 0.85, -len * 0.72, 0, -len);
  g.bezierCurveTo(-wid * 0.85, -len * 0.72, -wid, -len * 0.22, 0, 0);
  g.fillStyle = mask ? '#fff' : col; g.fill();
  if (rib && !mask) { g.strokeStyle = 'rgba(230,255,190,0.22)'; g.lineWidth = Math.max(1, wid * 0.09); g.beginPath(); g.moveTo(0, -len * 0.05); g.lineTo(0, -len * 0.9); g.stroke(); }
  g.restore();
}
const green = (r, l = 0.5) => `hsl(${(72 + r() * 50) | 0}, ${(26 + r() * 30) | 0}%, ${(9 + l * 19 * (0.55 + 0.9 * r())) | 0}%)`;

export function leafAtlas() {
  return paint(S, S, (g, mask) => {
    // A: a cluster of twigs, each with its leaves, round a middle; the inner leaves darker
    let r = mulberry32(5);
    const [ax0, ay0, ax1, ay1] = CELL.A, acx = (ax0 + ax1) / 2, acy = (ay0 + ay1) / 2;
    for (let k = 0; k < 34; k++) {
      const a = r() * TAU, L = 90 + r() * 140, n = 3 + ((r() * 5) | 0);
      if (!mask) { g.strokeStyle = '#3b2e1e'; g.lineWidth = 2.5; }
      g.beginPath(); g.moveTo(acx, acy); g.lineTo(acx + Math.cos(a) * L, acy + Math.sin(a) * L); if (!mask) g.stroke();
      for (let i = 0; i < n; i++) {
        const t = 0.35 + 0.65 * (i + r() * 0.5) / n, x = acx + Math.cos(a) * L * t, y = acy + Math.sin(a) * L * t;
        const side = i % 2 ? 1 : -1, la = a + Math.PI / 2 + side * (0.5 + r() * 0.5);
        leaf(g, mask, x, y, la, 42 + r() * 34, 13 + r() * 9, green(r, 0.35 + 0.65 * t));
      }
    }
    // B: a fern clump - fronds of small leaflets fanning up from the bottom middle
    r = mulberry32(6);
    const [bx0, by0, bx1, by1] = CELL.B, bcx = (bx0 + bx1) / 2, bcy = by1 - 20;
    for (let k = 0; k < 13; k++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6, L = 230 + r() * 210, bend = (r() - 0.5) * 0.8;
      const pts = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20, aa = a + bend * t; pts.push([bcx + Math.cos(aa) * L * t, bcy + Math.sin(aa) * L * t + 60 * t * t, aa]); }
      if (!mask) { g.strokeStyle = '#2f3d17'; g.lineWidth = 3; }
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (!mask) g.stroke();
      const col = green(r, 0.7);
      for (let i = 2; i < 20; i++) {
        const [x, y, aa] = pts[i], s = Math.sin(Math.PI * i / 20) * (1 - i / 26);
        for (const sd of [-1, 1]) leaf(g, mask, x, y, aa + Math.PI / 2 + sd * 1.1, 40 * s + 8, 7 * s + 3, col, false);
      }
    }
    // C: a palm frond - a midrib up the cell, long leaflets both sides, drooping toward the tip
    r = mulberry32(7);
    const [cx0, cy0, cx1, cy1] = CELL.C, ccx = (cx0 + cx1) / 2;
    if (!mask) { g.strokeStyle = '#5a5a2a'; g.lineWidth = 5; }
    g.beginPath(); g.moveTo(ccx, cy1); g.lineTo(ccx, cy0 + 8); if (!mask) g.stroke();
    for (let y = cy1 - 30; y > cy0 + 14; y -= 13) {
      const t = (cy1 - y) / (cy1 - cy0), L = 120 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), 0.7) + 10;
      for (const sd of [-1, 1]) leaf(g, mask, ccx, y, sd * (0.55 + 0.35 * t) + (r() - 0.5) * 0.12, L, 8 + r() * 3, green(r, 0.55), true);
    }
    // D: a weeping strand - a thin stem hanging down the cell, small leaves along it
    r = mulberry32(8);
    const [dx0, dy0, dx1, dy1] = CELL.D, dcx = (dx0 + dx1) / 2;
    for (let k = 0; k < 5; k++) {
      const x0 = dcx + (r() - 0.5) * 120, ph = r() * 6;
      if (!mask) { g.strokeStyle = '#3d4a1c'; g.lineWidth = 2; }
      g.beginPath();
      for (let y = dy0; y <= dy1; y += 8) { const x = x0 + Math.sin(y / 90 + ph) * 14; y === dy0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      if (!mask) g.stroke();
      for (let y = dy0 + 10; y < dy1 - 10; y += 14 + r() * 10) {
        const x = x0 + Math.sin(y / 90 + ph) * 14, sd = r() < 0.5 ? -1 : 1;
        leaf(g, mask, x, y, Math.PI + sd * (0.4 + r() * 0.6), 22 + r() * 16, 8 + r() * 4, green(r, 0.5 + 0.4 * r()));
      }
    }
  }, '#2b4114');
}

// a curtain of lianas, tileable down its length: three wiggling stems, big heart-shaped leaves overlapping, hanging
export function vineTexture() {
  const W = 256, H = 1024;
  return paint(W, H, (g, mask) => {
    const r = mulberry32(9);
    for (let st = 0; st < 3; st++) {
      const x0 = W * (0.25 + 0.25 * st), ph = r() * 6.28, amp = 10 + r() * 14;
      const xAt = (y) => x0 + Math.sin((y / H) * TAU * 2 + ph) * amp + Math.sin((y / H) * TAU * 5 + ph * 2) * 5;
      if (!mask) { g.strokeStyle = '#3a3a1a'; g.lineWidth = 5; }
      g.beginPath(); for (let y = -10; y <= H + 10; y += 6) (y < 0 ? g.moveTo(xAt(y), y) : g.lineTo(xAt(y), y)); if (!mask) g.stroke();
      for (let y = 4 + r() * 20, k = 0; y < H; y += 20 + r() * 16, k++) {
        const sd = k % 2 ? 1 : -1, len = 46 + r() * 34, col = green(r, 0.35 + 0.55 * r());
        for (const dy of [0, -H, H]) {
          const x = xAt(y + dy) + sd * 3, ang = Math.PI + sd * (0.5 + r() * 0.7);
          leaf(g, mask, x, y + dy, ang - 0.22 * sd, len, len * 0.42, col);
          leaf(g, mask, x, y + dy, ang + 0.2 * sd, len * 0.85, len * 0.36, col, false);
        }
      }
    }
  }, '#2a3c13');
}

// ---------------------------------------------------------------- geometry builders
// a growing set of attribute arrays
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.wind = []; this.ao = []; this.idx = []; this.n = 0; }
  v(p, n, u, v, w, ao = 1) { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(u, v); this.wind.push(w); this.ao.push(ao); return this.n++; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setAttribute('leafAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
// a tube along a path of points, radius per point, `seg` sides; uv: u round, v along in metres / 2; wind from windAt(p)
// (barkTube: one on its own, a geometry - lianas)
export function barkTube(path, radii, seg) { const B = new Builder(); tube(B, path, radii, seg, () => 0); return B.geometry(); }
function tube(B, path, radii, seg, windAt, flare = null) {
  let N = new THREE.Vector3(1, 0, 0);
  const T0 = path[1].clone().sub(path[0]).normalize();
  if (Math.abs(T0.dot(N)) > 0.9) N.set(0, 0, 1);
  N.addScaledVector(T0, -N.dot(T0)).normalize();
  let along = 0, base = B.n;
  for (let i = 0; i < path.length; i++) {
    const T = (i < path.length - 1 ? path[i + 1].clone().sub(path[i]) : path[i].clone().sub(path[i - 1])).normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    const Bn = new THREE.Vector3().crossVectors(T, N);
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
      let r = radii[i];
      if (flare) r *= flare(i, a);
      const n = N.clone().multiplyScalar(c).addScaledVector(Bn, s);
      const p = path[i].clone().addScaledVector(n, r);
      B.v(p, n, j / seg, along / 2, windAt(p));
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * (seg + 1) + j, b = a + 1, d = a + seg + 1, e = d + 1;
    B.tri(a, b, d); B.tri(b, e, d);
  }
}

// a leaf card: centre c, axes ex (width) ey (height), a cell of the atlas; normals bent out of `ctr` (the cluster's middle)
function card(B, c, ex, ey, cellKey, ctr, bend, wind, ao) {
  const [u0, v0, u1, v1] = cellUV(cellKey), fn = new THREE.Vector3().crossVectors(ex, ey).normalize();
  const corners = [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]];
  const ids = corners.map(([x, y, u, v]) => {
    const p = c.clone().addScaledVector(ex, x).addScaledVector(ey, y);
    const n = ctr ? p.clone().sub(ctr).normalize().multiplyScalar(bend).addScaledVector(fn, 1 - bend).normalize() : fn;
    return B.v(p, n, u, v, wind, ao);
  });
  B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
}

const randDir = (r, upBias = 0) => { const v = new THREE.Vector3(); do v.set(r() * 2 - 1, r() * 2 - 1 + upBias, r() * 2 - 1); while (v.lengthSq() < 0.05 || v.lengthSq() > 1 + upBias * upBias); return v.normalize(); };
const curve = (a, b, c, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return a.clone().multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(c, t * t); });

// a cluster of leaf cards round ctr
function cluster(B, r, ctr, rad, n, size, cellKey, windK) {
  for (let k = 0; k < n; k++) {
    const d = randDir(r, 0.35), p = ctr.clone().addScaledVector(d, rad * (0.35 + 0.65 * Math.sqrt(r())));
    const ex = randDir(r).cross(d).normalize(), ey = new THREE.Vector3().crossVectors(d, ex).normalize();
    const s = size * (0.75 + 0.5 * r());
    const ao = 0.45 + 0.55 * smoothstep(-0.6, 0.8, p.clone().sub(ctr).dot(new THREE.Vector3(0, 1, 0)) / rad) * smoothstep(0.1, 0.9, p.distanceTo(ctr) / rad);
    card(B, p, ex.multiplyScalar(s), ey.multiplyScalar(s), cellKey, ctr, 0.75, windK, ao);
  }
}

// species: { wood, leaves } geometries at two detail levels. H is the height (m) the geometry is built at (instances scale it)
function broadleaf(seed, lod) {
  const r = mulberry32(seed), W = new Builder(), L = new Builder(), H = 18;
  const windAt = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.6;
  const lean = new THREE.Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
  const fork = lean.clone().multiplyScalar(H * 0.42);
  const trunk = curve(new THREE.Vector3(0, -1.2, 0), new THREE.Vector3(0, H * 0.2, 0), fork, lod ? 2 : 5);
  const r0 = H * 0.034;
  tube(W, trunk, trunk.map((_, i) => r0 * (1 - 0.35 * i / trunk.length)), lod ? 4 : 7, windAt,
    lod ? null : (i, a) => (i < 2 ? 1 + 0.9 * (1 - i / 2) * Math.pow(Math.max(0, Math.cos(a * 5 + 0.7)), 6) : 1));
  const nb = 4 + ((r() * 2) | 0), clusters = [];
  for (let k = 0; k < nb; k++) {
    const az = (k / nb) * TAU + r() * 0.8, el = 0.6 + r() * 0.45, len = H * (0.32 + r() * 0.14);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const end = fork.clone().addScaledVector(dir, len);
    const mid = fork.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, len * 0.18, 0));
    const br = curve(fork, mid, end, lod ? 1 : 3);
    tube(W, br, br.map((_, i) => r0 * 0.62 * (1 - 0.7 * i / br.length)), lod ? 3 : 4, windAt);
    clusters.push(end.clone().add(new THREE.Vector3(0, H * 0.04, 0)), mid.clone().addScaledVector(dir, len * 0.15).add(new THREE.Vector3(0, H * 0.06, 0)));
  }
  clusters.push(fork.clone().add(new THREE.Vector3(0, H * 0.45, 0)));
  for (const c of clusters) {
    const rad = H * (0.15 + r() * 0.06);
    if (lod) cluster(L, r, c, rad, 4, rad * 1.9, 'A', windAt(c) + 0.3);
    else cluster(L, r, c, rad, 8, rad * 1.45, 'A', windAt(c) + 0.3);
  }
  return { wood: W.geometry(), leaves: L.geometry(), H };
}

function emergent(seed, lod) {
  const r = mulberry32(seed), W = new Builder(), L = new Builder(), H = 38;
  const windAt = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.4;
  const top = new THREE.Vector3((r() - 0.5) * 2, H * 0.74, (r() - 0.5) * 2);
  const trunk = curve(new THREE.Vector3(0, -1.5, 0), new THREE.Vector3(0, H * 0.4, 0), top, lod ? 2 : 6);
  const r0 = H * 0.028;
  // buttress roots: thin fins flaring out round the foot
  tube(W, trunk, trunk.map((_, i) => r0 * (1 - 0.3 * i / trunk.length)), lod ? 5 : 10, windAt,
    lod ? null : (i, a) => (i < 3 ? 1 + 2.6 * Math.pow(1 - i / 3, 1.6) * Math.pow(Math.max(0, Math.cos(a * 3 + 0.4)), 10) : 1));
  const nb = 6, clusters = [];
  for (let k = 0; k < nb; k++) {
    const az = (k / nb) * TAU + r() * 0.5, len = H * (0.26 + r() * 0.1);
    const end = top.clone().add(new THREE.Vector3(Math.cos(az) * len, H * (0.1 + r() * 0.08), Math.sin(az) * len));
    const br = curve(top, top.clone().lerp(end, 0.5).add(new THREE.Vector3(0, H * 0.06, 0)), end, lod ? 1 : 3);
    tube(W, br, br.map((_, i) => r0 * 0.55 * (1 - 0.7 * i / br.length)), lod ? 3 : 4, windAt);
    clusters.push(end, top.clone().lerp(end, 0.55).add(new THREE.Vector3(0, H * 0.07, 0)));
  }
  clusters.push(top.clone().add(new THREE.Vector3(0, H * 0.14, 0)));
  for (const c of clusters) {
    const rad = H * (0.1 + r() * 0.04);
    // flattened: an umbrella crown
    const ctr = c;
    if (lod) cluster(L, r, ctr, rad, 4, rad * 2.0, 'A', windAt(c) + 0.25);
    else cluster(L, r, ctr, rad, 9, rad * 1.5, 'A', windAt(c) + 0.25);
  }
  return { wood: W.geometry(), leaves: L.geometry(), H };
}

function palm(seed, lod) {
  const r = mulberry32(seed), W = new Builder(), L = new Builder(), H = 15;
  const windAt = (p) => Math.pow(Math.max(0, p.y) / H, 1.6) * 0.7;
  const lean = (r() - 0.5) * 0.5, az = r() * TAU;
  const top = new THREE.Vector3(Math.cos(az) * H * 0.25 * lean * 2, H, Math.sin(az) * H * 0.25 * lean * 2);
  const trunk = curve(new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(top.x * 0.1, H * 0.5, top.z * 0.1), top, lod ? 2 : 5);
  tube(W, trunk, trunk.map((_, i) => 0.3 * (1 - 0.3 * i / trunk.length)), lod ? 4 : 6, windAt);
  const nf = lod ? 8 : 13;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * TAU + r() * 0.4, el = 0.75 - r() * 1.0, len = 5.5 + r() * 2.0, wid = 1.7 + r() * 0.5;
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const segs = lod ? 2 : 5, [u0, v0, u1, v1] = cellUV('C'), ids = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, p = top.clone().addScaledVector(d, len * t).add(new THREE.Vector3(0, -len * 0.55 * t * t, 0));
      const tan = d.clone().add(new THREE.Vector3(0, -len * 1.1 * t / len, 0)).normalize();
      const n = new THREE.Vector3().crossVectors(side, tan).normalize();
      if (n.y < 0) n.negate();
      const w = wid * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.15 + t)));
      // the leaflets droop down from the rib: the strip's edges a little below its middle
      const droop = new THREE.Vector3(0, -0.35 * w, 0);
      const wk = windAt(top) + 0.3 * t;
      ids.push([B2(L, p.clone().addScaledVector(side, -w / 2).add(droop), n, u0, v0 + (v1 - v0) * t, wk),
        B2(L, p.clone().addScaledVector(side, w / 2).add(droop), n, u1, v0 + (v1 - v0) * t, wk)]);
    }
    for (let i = 0; i < segs; i++) { const [a1, b1] = ids[i], [a2, b2] = ids[i + 1]; L.tri(a1, b1, b2); L.tri(a1, b2, a2); }
  }
  return { wood: W.geometry(), leaves: L.geometry(), H };
}
function B2(B, p, n, u, v, w) { return B.v(p, n, u, v, w, 0.8); }

function bush(seed, lod) {
  const r = mulberry32(seed), L = new Builder(), H = 3;
  const n = lod ? 4 : 9, ctr = new THREE.Vector3(0, 0.6, 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + r() * 0.5, tilt = 0.35 + r() * 0.6, s = 2.6 + r() * 1.2;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const ey = out.clone().multiplyScalar(Math.sin(tilt)).add(new THREE.Vector3(0, Math.cos(tilt), 0)).normalize();
    const ex = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    card(L, ey.clone().multiplyScalar(s * 0.5).add(new THREE.Vector3(0, -0.2, 0)), ex.multiplyScalar(s), ey.multiplyScalar(s), 'B', ctr, 0.6, 0.35 + r() * 0.2, 0.75);
  }
  return { wood: null, leaves: L.geometry(), H };
}

// leaf cards for growth on structures: [{ c: centre, s: size, out: the way it faces, wind?, ao? }] (one geometry)
export function leafCards(list, cellKey = 'A', seed = 3) {
  const r = mulberry32(seed), B = new Builder();
  for (const L of list) {
    const d = L.out.clone().normalize().add(randDir(r).multiplyScalar(0.55)).normalize();
    const ex = randDir(r).cross(d).normalize(), ey = new THREE.Vector3().crossVectors(d, ex).normalize();
    const s = L.s;
    card(B, L.c, ex.multiplyScalar(s), ey.multiplyScalar(s), cellKey, L.c.clone().addScaledVector(L.out, -s), 0.6, L.wind ?? 0.15, L.ao ?? 0.85);
  }
  return B.geometry();
}

// the far level of any tree: three crossed cards and a flat one for its crown, a three-sided trunk (~14 triangles)
function crownCards(H, cy, R, flat = 1, trunkTop = cy - R * 0.6) {
  const W = new Builder(), L = new Builder(), windAt = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.5;
  if (trunkTop > 0) tube(W, [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, trunkTop, 0)], [H * 0.03, H * 0.022], 3, windAt);
  const c = new THREE.Vector3(0, cy, 0), up = new THREE.Vector3(0, R * 2 / flat, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, ex = new THREE.Vector3(Math.cos(a) * R * 2, 0, Math.sin(a) * R * 2);
    card(L, c, ex, up.clone(), 'A', c, 0.8, windAt(c), 0.8);
  }
  card(L, c.clone().add(new THREE.Vector3(0, R * 0.25, 0)), new THREE.Vector3(R * 2.1, 0, 0), new THREE.Vector3(0, 0, R * 2.1), 'A', c.clone().add(new THREE.Vector3(0, -R, 0)), 0.8, windAt(c), 0.9);
  return { wood: trunkTop > 0 ? W.geometry() : null, leaves: L.geometry(), H };
}
const FAR = {
  broadleaf: () => crownCards(18, 18 * 0.72, 18 * 0.36),
  emergent: () => crownCards(38, 38 * 0.86, 38 * 0.36, 1.6),
  palm: () => crownCards(15, 15, 5, 1.3),
  bush: () => crownCards(3, 0.9, 1.6, 1, 0),
};

// ---------------------------------------------------------------- materials
let atlas = null, vineTex = null;
const SUN_GLSL = `vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})`;
const WIND_VERT = /* glsl */`
  attribute float wind;
  uniform float floraTime;
  vec3 floraWind(vec3 p, vec3 wpos, float w) {
    float ph = dot(wpos, vec3(0.031, 0.0, 0.027));
    vec2 sway = vec2(sin(floraTime * 0.7 + ph) + 0.4 * sin(floraTime * 1.9 + ph * 2.3), cos(floraTime * 0.55 + ph * 1.3) * 0.6);
    return p + vec3(sway.x, 0.0, sway.y) * w * 0.45;
  }`;
const LIGHTS = () => THREE.ShaderChunk.lights_fragment_begin;
const AT = 'getDirectionalLightInfo( directionalLight, directLight );';

export function leafMaterial() {
  atlas ||= leafAtlas();
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
  mat.alphaToCoverage = true;
  // (leaves take only the world's shadow - 8 soft taps: the cascades' search ran for every layer of overlapping
  // leaves, ~4 ms in a tunnel of vines)
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '', FOLIAGE_ONE_TAP: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLORA_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${WIND_VERT}\nattribute float leafAO; varying float vLeafAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vLeafAO = leafAO;
  {
    vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
    transformed = floraWind(transformed, ip, wind);
    // the leaves' own flutter
    transformed += normal * sin(floraTime * 7.0 + dot(position, vec3(3.1, 2.3, 1.7)) + ip.x) * 0.06 * wind;
  }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLeafAO;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= 0.55 + 0.45 * vLeafAO;`)
      // light through the leaves: looking toward the sun through them, and on the leaves' far side
      .replace('#include <lights_fragment_begin>', LIGHTS().replace(AT, `${AT}
		#if UNROLLED_LOOP_INDEX == 0
		{
			float thru = pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 4.0) * 1.6 + max(dot(-geometryNormal, directLight.direction), 0.0) * 0.35;
			reflectedLight.directDiffuse += directLight.color * material.diffuseColor * thru * 0.55;
		}
		#endif`))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= 0.5 + 0.5 * vLeafAO;`);
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'forest-leaf';
  return mat;
}

// bark: vertical fissures (palms: rings), lighter grey on the old giants; moss up the shady side (lamps: lit by the
// ships' lights too - the roots in the cave)
export function barkMaterial({ lamps = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLORA_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${WIND_VERT}\nvarying vec2 vBark; varying vec3 vBW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vBark = uv;
  {
    vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
    transformed = floraWind(transformed, ip, wind);
  }`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vBark; varying vec3 vBW;
float bH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(bH(i), bH(i + vec2(1, 0)), u.x), mix(bH(i + vec2(0, 1)), bH(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec2 bq = vec2(vBark.x * 9.0, vBark.y * 0.9);
  float fis = 1.0 - abs(bN(bq + vec2(0.0, bN(bq * 0.5) * 2.0)) * 2.0 - 1.0);
  float barkV = 0.75 + 0.3 * bN(bq * 3.0) - 0.35 * pow(fis, 6.0);
  float mossB = smoothstep(0.45, 0.7, bN(vBW.xz * 0.3 + vBW.y * 0.2) + 0.25 * (1.0 - normalize(vNormal).y));
  vec3 barkC = diffuseColor.rgb * vec3(0.24, 0.21, 0.17) * barkV;
  diffuseColor.rgb = mix(barkC, vec3(0.05, 0.085, 0.02), mossB * 0.55);`);
    if (!lamps) sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => (lamps ? 'forest-bark-lamps' : 'forest-bark');
  return mat;
}

// hanging vines: long strips that turn round their own vertical axis to face the camera, swinging from the top.
// Each instance: its anchor (the instance matrix: a translation only) and its length and width (vineLW).
export function vineMaterial() {
  vineTex ||= vineTexture();
  vineTex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: vineTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
  mat.alphaToCoverage = true;
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '', FOLIAGE_ONE_TAP: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLORA_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float floraTime; attribute vec2 vineLW; varying float vVineAO;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
  vMapUv.y *= vineLW.x / 6.0;                                    // the texture: 6 m of vine a repeat`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
    float len = vineLW.x, wid = vineLW.y, t = -position.y;     // t: 0 at the anchor .. 1 at the end
    vec3 camL = cameraPosition - ip;
    vec2 f = normalize(camL.xz + 1e-4);
    vec3 across = vec3(-f.y, 0.0, f.x) * wid;
    float ph = dot(ip, vec3(0.05, 0.0, 0.043));
    vec3 swing = vec3(sin(floraTime * 0.8 + ph), 0.0, cos(floraTime * 0.63 + ph * 1.7)) * 0.03 * len * t * t;
    transformed = vec3(0.0, -t * len, 0.0) + across * position.x + swing;
    vVineAO = 1.0 - 0.35 * t;
  }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  {
    vec3 ipn = vec3(0.0);
  #ifdef USE_INSTANCING
    ipn = instanceMatrix[3].xyz;
  #endif
    vec3 c = cameraPosition - ipn; c.y *= 0.3;
    transformedNormal = normalize((viewMatrix * vec4(normalize(c), 0.0)).xyz);
  }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVineAO;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= vVineAO;')
      .replace('#include <lights_fragment_begin>', LIGHTS().replace(AT, `${AT}
		#if UNROLLED_LOOP_INDEX == 0
		reflectedLight.directDiffuse += directLight.color * material.diffuseColor * pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 4.0) * 0.8;
		#endif`));
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'forest-vine';
  return mat;
}

// a vine strip: x across (-0.5..0.5), y down 0..-1 (the shader scales it by the instance's length)
function vineStrip(n = 10) {
  const g = new THREE.BufferGeometry(), pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pos.push(-0.5, -t, 0, 0.5, -t, 0);
    uv.push(0, -t, 1, -t);
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- the planting
export const SPECIES = ['broadleaf', 'emergent', 'palm', 'bush'];
const BUILD = { broadleaf, emergent, palm, bush };

// The planting, drawn in a fixed number of instanced meshes - one per species, part and level of detail (~25 draws
// for all of it, wherever the camera is): every plant's matrix kept once, and every ~0.3 s (or 40 m of travel) each
// one copied into the level its distance calls for - full near, coarse further, crossed cards far. The vines the
// same: those within reach in one mesh. (Drawn per sector, the island field cost ~270 instanced draws a pass:
// the CPU, not the GPU, set the frame rate.) Layer 4: drawn only in the near depth slice, 3: only in the far one.
const NEAR_ONLY = 4, FAR_ONLY = 3;
export class Flora {
  constructor(scene) {
    this.scene = scene;
    this.leafMat = leafMaterial();
    this.barkMat = barkMaterial();
    this.vineMat = vineMaterial();
    this.geo = {};
    // three levels: full (near), coarse (mid), crossed cards (far)
    for (const s of SPECIES) this.geo[s] = [BUILD[s](31 + s.length, 0), BUILD[s](31 + s.length, 1), FAR[s]()];
    this.strip = vineStrip();
    this.plants = Object.fromEntries(SPECIES.map((s) => [s, []]));
    this.vines = [];
    this.tris = 0;
    this.meshes = [];
  }

  // plants: per species [{ m: Matrix4, c: Color }]; vines: [{ p, len, wid }]; far: the far islands' (never full detail)
  addSector(name, plants, vines, far = false) {
    for (const s of SPECIES) for (const q of plants[s] || []) this.plants[s].push({ m: q.m.elements, c: q.c, far });
    for (const v of vines) this.vines.push(v);
  }

  // the instanced meshes, once everything is planted; the plants kept in flat arrays (position, matrix, colour)
  finish() {
    const big = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.sp = {};
    for (const s of SPECIES) {
      const list = this.plants[s], n = list.length;
      if (!n) continue;
      const P = { n, pos: new Float32Array(n * 3), mat: new Float32Array(n * 16), col: new Float32Array(n * 3), far: new Uint8Array(n), lods: [[], [], []] };
      list.forEach((q, i) => { P.mat.set(q.m, i * 16); P.pos.set([q.m[12], q.m[13], q.m[14]], i * 3); P.col.set([q.c.r, q.c.g, q.c.b], i * 3); P.far[i] = q.far ? 1 : 0; });
      this.sp[s] = P;
      for (let lod = 0; lod < 3; lod++) {
        for (const part of ['wood', 'leaves']) {
          const g = this.geo[s][lod][part];
          if (!g) continue;
          const im = new THREE.InstancedMesh(g, part === 'wood' ? this.barkMat : this.leafMat, n);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
          im.instanceColor.setUsage(THREE.DynamicDrawUsage);
          im.count = 0;
          im.boundingSphere = big;
          // seen (2), in the world's shadow (6), not in the cascades; full detail only near, crossed cards only far
          im.layers.set(2); im.layers.enable(6);
          if (lod === 0) { im.layers.disable(2); im.layers.enable(NEAR_ONLY); }
          if (lod === 2) { im.layers.disable(2); im.layers.enable(FAR_ONLY); }
          im.castShadow = true; im.receiveShadow = true;
          this.scene.add(im);
          this.meshes.push(im);
          P.lods[lod].push(im);
        }
      }
    }
    this.plants = null;
    const nv = this.vines.length;
    if (nv) {
      this.vp = new Float32Array(nv * 3); this.vl = new Float32Array(nv * 2);
      this.vines.forEach((v, i) => { this.vp.set([v.p.x, v.p.y, v.p.z], i * 3); this.vl.set([v.len, v.wid], i * 2); });
      const g = this.strip.clone();
      this.vineLW = new THREE.InstancedBufferAttribute(new Float32Array(nv * 2), 2);
      this.vineLW.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('vineLW', this.vineLW);
      const im = (this.vineMesh = new THREE.InstancedMesh(g, this.vineMat, nv));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // (translation-only matrices: the identity part written once)
      const arr = im.instanceMatrix.array;
      for (let i = 0; i < nv; i++) { arr[i * 16] = arr[i * 16 + 5] = arr[i * 16 + 10] = arr[i * 16 + 15] = 1; }
      im.count = 0;
      im.boundingSphere = big;
      im.layers.set(2);
      im.castShadow = false; im.receiveShadow = true;           // (no depth material that bends them: no shadow)
      this.scene.add(im);
      this.meshes.push(im);
      this.vines = null;
    }
    // the world's shadow is drawn once with everything at its coarse level and nothing culled
    this.rebucket(null, null);
  }

  // every plant into the level its distance calls for, and only those ahead of the camera (within ~80 deg of where it
  // looks: the frame never shows more, and a turn or a cut re-sorts at once); cam null: all coarse, nothing culled
  rebucket(cam, fwd) {
    const n0 = Q.lite ? 260 : 420, n1 = Q.lite ? 900 : 1400, nv = Q.lite ? 1200 : 1800;
    const n02 = n0 * n0, n12 = n1 * n1, nv2 = nv * nv, cone = Math.cos(THREE.MathUtils.degToRad(80));
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0, fx = fwd ? fwd.x : 0, fy = fwd ? fwd.y : 0, fz = fwd ? fwd.z : 0;
    for (const s of SPECIES) {
      const P = this.sp[s];
      if (!P) continue;
      const cnt = [0, 0, 0];
      for (let i = 0; i < P.n; i++) {
        let lod = P.far[i] ? 2 : 1;
        if (cam) {
          const dx = P.pos[i * 3] - cx, dy = P.pos[i * 3 + 1] - cy, dz = P.pos[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 3600 && dx * fx + dy * fy + dz * fz < cone * Math.sqrt(d2)) continue;      // behind, out to the sides
          if (!P.far[i]) lod = d2 > n12 ? 2 : d2 > n02 ? 1 : 0;
        }
        const k = cnt[lod]++;
        for (const im of P.lods[lod]) {
          const A = im.instanceMatrix.array, C = im.instanceColor.array, o = k * 16, m = i * 16;
          for (let j = 0; j < 16; j++) A[o + j] = P.mat[m + j];
          C[k * 3] = P.col[i * 3]; C[k * 3 + 1] = P.col[i * 3 + 1]; C[k * 3 + 2] = P.col[i * 3 + 2];
        }
      }
      for (let lod = 0; lod < 3; lod++) for (const im of P.lods[lod]) {
        const n = cnt[lod];
        im.count = n;
        im.visible = n > 0;
        if (!n) continue;
        im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true;
        im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, n * 3); im.instanceColor.needsUpdate = true;
      }
    }
    if (this.vineMesh) {
      const im = this.vineMesh, arr = im.instanceMatrix.array, lw = this.vineLW.array, V = this.vp, Lw = this.vl, n = V.length / 3;
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (cam) {
          const dx = V[i * 3] - cx, dy = V[i * 3 + 1] - cy, dz = V[i * 3 + 2] - cz, d2 = dx * dx + dz * dz;
          if (d2 > nv2) continue;
          if (d2 > 3600 && dx * fx + dy * fy + dz * fz < cone * Math.sqrt(d2 + dy * dy)) continue;
        }
        arr[k * 16 + 12] = V[i * 3]; arr[k * 16 + 13] = V[i * 3 + 1]; arr[k * 16 + 14] = V[i * 3 + 2];
        lw[k * 2] = Lw[i * 2]; lw[k * 2 + 1] = Lw[i * 2 + 1];
        k++;
      }
      im.count = k;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, k * 16); im.instanceMatrix.needsUpdate = true;
      this.vineLW.clearUpdateRanges(); this.vineLW.addUpdateRange(0, k * 2); this.vineLW.needsUpdate = true;
    }
    this.lastAt = cam ? cam.clone() : null;
    this.lastFwd = fwd ? fwd.clone() : null;
  }

  update(t, camera) {
    FLORA_U.floraTime.value = t;
    const p = camera.position, f = (this._f ||= new THREE.Vector3()).set(0, 0, -1).applyQuaternion(camera.quaternion);
    // re-sorted after 50 m of travel or a turn of ~20 deg (a camera cut too), and now and then on the move
    if (!this.lastAt || p.distanceToSquared(this.lastAt) > 2500 || f.dot(this.lastFwd) < 0.94 ||
      (t - (this.lastT ?? -9) > 1 && p.distanceToSquared(this.lastAt) > 4)) {
      this.rebucket(p, f);
      this.lastT = t;
    }
  }
}
