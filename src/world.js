// The test range: a closed road circuit through rolling meadows and forests, a mountain ring, sky, sun.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, ridged, noise2, smoothstep, mulberry32, clamp } from './noise.js';

export const ROAD_HALF = 9;          // asphalt half width (m): the Feather spans 10.3 m
export const SHOULDER = 3;           // gravel shoulder each side
export const ROAD_Y = 0.06;          // asphalt sits 6 cm over the flattened ground
const TERRAIN_SIZE = 8000;
const TERRAIN_N = 400;               // 20 m grid
const STEP = TERRAIN_SIZE / TERRAIN_N;
const DF_CELL = 10;                  // road distance field resolution (m)
const DF_N = TERRAIN_SIZE / DF_CELL;

// the circuit (x, z): a long main straight heading -Z from the start, a hairpin, esses and a sweeping return
const CIRCUIT = [
  [0, 380], [0, 120], [0, -300], [0, -620], [0, -900], [60, -1230], [330, -1440], [700, -1420], [960, -1180], [1060, -820],
  [900, -470], [1080, -120], [1260, 300], [1170, 720], [820, 980], [420, 1040], [130, 880],
];
export const CENTRE = new THREE.Vector2(560, -200);   // middle of the circuit: the mountain ring is round it

export class Road {
  constructor() {
    const pts = CIRCUIT.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    const n = Math.round(this.length / 4);
    const sp = this.curve.getSpacedPoints(n);
    this.n = n;
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = sp[i].x; this.pz[i] = sp[i].z;
      const a = sp[(i + n - 1) % n], b = sp[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    this.step = this.length / n;
    this.buildDistanceField();
  }

  // min distance to the centre line on a 10 m grid (only stamped within 260 m: farther is "far")
  buildDistanceField() {
    const df = new Float32Array((DF_N + 1) * (DF_N + 1)).fill(1e4);
    const R = 260, rc = Math.ceil(R / DF_CELL), h = TERRAIN_SIZE / 2;
    for (let i = 0; i < this.n; i++) {
      const cx = Math.round((this.px[i] + h) / DF_CELL), cz = Math.round((this.pz[i] + h) / DF_CELL);
      for (let j = Math.max(0, cz - rc); j <= Math.min(DF_N, cz + rc); j++) {
        const z = j * DF_CELL - h;
        for (let k = Math.max(0, cx - rc); k <= Math.min(DF_N, cx + rc); k++) {
          const x = k * DF_CELL - h;
          const d = Math.hypot(x - this.px[i], z - this.pz[i]);
          const o = j * (DF_N + 1) + k;
          if (d < df[o]) df[o] = d;
        }
      }
    }
    this.df = df;
  }

  distance(x, z) {
    const h = TERRAIN_SIZE / 2;
    const fx = clamp((x + h) / DF_CELL, 0, DF_N - 1e-3), fz = clamp((z + h) / DF_CELL, 0, DF_N - 1e-3);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = DF_N + 1;
    const a = this.df[j * W + i], b = this.df[j * W + i + 1], c = this.df[(j + 1) * W + i], d = this.df[(j + 1) * W + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // nearest centre-line sample: { i, d, x, z, tx, tz }
  nearest(x, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x, dz = this.pz[i] - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, d: Math.sqrt(best), x: this.px[bi], z: this.pz[bi], tx: this.tx[bi], tz: this.tz[bi] };
  }

  mesh() {
    const n = this.n, cols = [-(ROAD_HALF + SHOULDER), -ROAD_HALF, ROAD_HALF, ROAD_HALF + SHOULDER];
    const us = [0, SHOULDER / (2 * (ROAD_HALF + SHOULDER)), 1 - SHOULDER / (2 * (ROAD_HALF + SHOULDER)), 1];
    const ys = [ROAD_Y - 0.035, ROAD_Y, ROAD_Y, ROAD_Y - 0.035];
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, rx = -this.tz[k], rz = this.tx[k];
      for (let c = 0; c < 4; c++) {
        pos.push(this.px[k] + rx * cols[c], ys[c], this.pz[k] + rz * cols[c]);
        uv.push(us[c], (i * this.step) / 24);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const a = i * 4 + c, b = a + 1, d = a + 4, e = a + 5;
        idx.push(a, b, d, b, e, d);           // counter-clockwise from above: the road faces up
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.88, metalness: 0 }));
    m.receiveShadow = true;
    return m;
  }

  // white reflector posts every 50 m on both verges: they make speed readable
  posts() {
    const geo = new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.55, 0);
    const every = Math.round(50 / this.step), count = Math.floor(this.n / every) * 2;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.5 }), count);
    const M = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i + every <= this.n; i += every) {
      for (const s of [-1, 1]) {
        const o = ROAD_HALF + SHOULDER + 0.8;
        M.makeTranslation(this.px[i] - this.tz[i] * o * s, 0, this.pz[i] + this.tx[i] * o * s);
        im.setMatrixAt(k++, M);
      }
    }
    im.count = k;
    im.castShadow = true;
    return im;
  }
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx, w, h, n, colours, size = 1.6) {
  const r = mulberry32(7);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colours[(r() * colours.length) | 0];
    const s = size * (0.5 + r());
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

// 24 m of road per tile: gravel shoulders, asphalt, solid edge lines, a 6 m / 6 m dashed centre line
function roadTexture() {
  const t = canvasTex(1024, 1024, (ctx, w, h) => {
    const W = 2 * (ROAD_HALF + SHOULDER), px = w / W, py = h / 24;
    const sh = SHOULDER * px;
    ctx.fillStyle = '#6d665b'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 60000, ['#5b554c', '#7d766a', '#888073', '#4f4a43'], 2.2);
    ctx.fillStyle = '#2c2e31'; ctx.fillRect(sh, 0, w - 2 * sh, h);
    ctx.save(); ctx.beginPath(); ctx.rect(sh, 0, w - 2 * sh, h); ctx.clip();
    speckle(ctx, w, h, 90000, ['#26282b', '#34363a', '#3b3d41', '#222427'], 1.6);
    // tyre-worn lanes: a little darker and smoother
    ctx.fillStyle = 'rgba(15,16,18,0.22)';
    for (const c of [-6.2, -2.8, 2.8, 6.2]) ctx.fillRect((W / 2 + c - 0.6) * px, 0, 1.2 * px, h);
    ctx.restore();
    ctx.fillStyle = '#e9e7e1';
    ctx.fillRect(sh + 0.3 * px, 0, 0.25 * px, h);
    ctx.fillRect(w - sh - 0.55 * px, 0, 0.25 * px, h);
    for (const v0 of [0, 12]) ctx.fillRect(w / 2 - 0.1 * px, v0 * py, 0.2 * px, 6 * py);
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

function grassDetail() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e6e6e6'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 50000, ['#c8c8c8', '#d6d6d6', '#f2f2f2', '#bdbdbd', '#ffffff'], 2.5);
  });
}

export class Terrain {
  constructor(road) {
    this.road = road;
    const N = TERRAIN_N + 1, half = TERRAIN_SIZE / 2;
    this.h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * STEP - half, z = j * STEP - half;
        this.h[j * N + i] = this.raw(x, z) * smoothstep(32, 210, road.distance(x, z));
      }
    }
  }

  raw(x, z) {
    const hills = (fbm(x * 0.0011, z * 0.0011, 5) - 0.42) * 110 + (fbm(x * 0.006, z * 0.006, 3) - 0.5) * 8;
    const r = Math.hypot(x - CENTRE.x, z - CENTRE.y);
    const ring = smoothstep(2100, 3500, r);
    const peaks = ring * (180 + 520 * ridged(x * 0.0008 + 3.1, z * 0.0008 - 1.7, 5));
    return hills + peaks;
  }

  // the ground under (x, z), interpolated on the mesh's own triangles (collision matches what is drawn)
  height(x, z) {
    const N = TERRAIN_N + 1, half = TERRAIN_SIZE / 2;
    const fx = clamp((x + half) / STEP, 0, TERRAIN_N - 1e-4), fz = clamp((z + half) / STEP, 0, TERRAIN_N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h00 = this.h[j * N + i], h10 = this.h[j * N + i + 1], h01 = this.h[(j + 1) * N + i], h11 = this.h[(j + 1) * N + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // the surface the ship hovers on: the road where there is road, the ground elsewhere
  surface(x, z) {
    const g = this.height(x, z);
    return this.road.distance(x, z) < ROAD_HALF + SHOULDER ? Math.max(g, ROAD_Y) : g;
  }

  slope(x, z) {
    const e = 4;
    const dx = this.height(x + e, z) - this.height(x - e, z), dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  mesh() {
    const N = TERRAIN_N + 1, half = TERRAIN_SIZE / 2;
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const o = j * N + i, x = i * STEP - half, z = j * STEP - half;
        pos[o * 3] = x; pos[o * 3 + 1] = this.h[o]; pos[o * 3 + 2] = z;
        uv[o * 2] = x / 7; uv[o * 2 + 1] = z / 7;
      }
    }
    const idx = new Uint32Array(TERRAIN_N * TERRAIN_N * 6);
    let k = 0;
    for (let j = 0; j < TERRAIN_N; j++) {
      for (let i = 0; i < TERRAIN_N; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const nrm = g.attributes.normal.array;
    const C = (hex) => new THREE.Color(hex);
    const grassA = C(0x3b5a1c), grassB = C(0x5d7a26), dry = C(0x7f7a3a), dirt = C(0x6a5a42),
      rock = C(0x6d6a66), rockD = C(0x4c4a48), snow = C(0xeef1f4), verge = C(0x4f6524);
    const t = new THREE.Color();
    for (let o = 0; o < N * N; o++) {
      const x = pos[o * 3], y = pos[o * 3 + 1], z = pos[o * 3 + 2], ny = nrm[o * 3 + 1];
      const n1 = fbm(x * 0.004, z * 0.004, 4), n2 = noise2(x * 0.03, z * 0.03);
      t.copy(grassA).lerp(grassB, smoothstep(0.3, 0.7, n1));
      t.lerp(dry, smoothstep(0.62, 0.8, fbm(x * 0.0015 + 9, z * 0.0015, 3)) * 0.7);
      t.lerp(dirt, smoothstep(0.7, 0.85, n2) * 0.35);
      const dr = this.road.distance(x, z);
      t.lerp(verge, smoothstep(30, 14, dr) * 0.5);
      const steep = smoothstep(0.86, 0.7, ny);
      t.lerp(rock, Math.max(steep, smoothstep(260, 380, y) * 0.85));
      t.lerp(rockD, steep * 0.35 * n2);
      t.lerp(snow, smoothstep(430, 520, y + n1 * 60) * smoothstep(0.55, 0.8, ny));
      col[o * 3] = t.r; col[o * 3 + 1] = t.g; col[o * 3 + 2] = t.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const detail = grassDetail();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.97 }));
    m.receiveShadow = true;
    return m;
  }
}

// ------------------------------------------------------------------ trees
function coloured(geo, hex) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function wobble(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise2(x * 9 + seed, z * 9 + y * 7) - 0.5;
    p.setXYZ(i, x * (1 + n * amp), y * (1 + n * amp * 0.5), z * (1 + n * amp));
  }
  geo.computeVertexNormals();
  return geo;
}

function coniferGeo() {
  const parts = [coloured(new THREE.CylinderGeometry(0.022, 0.034, 0.26, 6).translate(0, 0.13, 0), 0x4a3524)];
  const tiers = [[0.30, 0.46, 0.17], [0.24, 0.40, 0.40], [0.17, 0.36, 0.62]];
  tiers.forEach(([r, h, y], i) =>
    parts.push(coloured(new THREE.ConeGeometry(r, h, 9, 1).translate(0, y + h / 2, 0), [0x1f3d22, 0x23452a, 0x284c2c][i])));
  return mergeGeometries(parts);
}

function broadleafGeo() {
  const parts = [coloured(new THREE.CylinderGeometry(0.03, 0.05, 0.48, 6).translate(0, 0.24, 0), 0x55402c)];
  const blobs = [[0, 0.66, 0, 0.30], [0.17, 0.56, 0.06, 0.21], [-0.15, 0.6, -0.1, 0.23], [0.02, 0.8, 0.05, 0.2]];
  blobs.forEach(([x, y, z, r], i) => {
    const g = wobble(new THREE.IcosahedronGeometry(r, 1), 0.28, i * 3.7);
    parts.push(coloured(g.translate(x, y, z), [0x3f6a24, 0x4a7428, 0x37601f, 0x4f7a2d][i]));
  });
  return mergeGeometries(parts);
}

export class Forest {
  constructor(terrain, road) {
    this.terrain = terrain;
    const rnd = mulberry32(1337), half = TERRAIN_SIZE / 2 - 200;
    const items = [];
    for (let k = 0; k < 90000 && items.length < 11000; k++) {
      const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
      const dens = smoothstep(0.47, 0.62, fbm(x * 0.0024 + 40, z * 0.0024 - 11, 4));
      if (rnd() > dens * 0.9 + 0.025) continue;
      if (road.distance(x, z) < 24 + rnd() * 10) continue;
      const y = terrain.height(x, z);
      if (y > 330 + rnd() * 40 || terrain.slope(x, z) > 0.75) continue;
      const conifer = rnd() < 0.35 + smoothstep(60, 260, y) * 0.6;
      const s = conifer ? 11 + rnd() * 10 : 8 + rnd() * 7;
      items.push({ x, y, z, s, conifer, rot: rnd() * Math.PI * 2, tint: 0.8 + rnd() * 0.35 });
    }
    this.items = items;
    // collision grid: 40 m cells
    this.cell = 40;
    this.grid = new Map();
    items.forEach((t, i) => {
      const key = Math.floor(t.x / this.cell) * 100003 + Math.floor(t.z / this.cell);
      (this.grid.get(key) || this.grid.set(key, []).get(key)).push(i);
    });
  }

  meshes() {
    const out = [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    for (const conifer of [true, false]) {
      const list = this.items.filter((t) => t.conifer === conifer);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
      const im = new THREE.InstancedMesh(conifer ? coniferGeo() : broadleafGeo(), mat, list.length);
      list.forEach((t, i) => {
        Q.setFromAxisAngle(Y, t.rot);
        S.set(t.s * (0.85 + 0.3 * ((i * 7919) % 13) / 13), t.s, t.s * (0.85 + 0.3 * ((i * 104729) % 11) / 11));
        P.set(t.x, t.y - 0.2, t.z);
        M.compose(P, Q, S);
        im.setMatrixAt(i, M);
        im.setColorAt(i, c.setRGB(t.tint, t.tint * (0.95 + 0.1 * ((i % 7) / 7)), t.tint * 0.95));
      });
      im.castShadow = false;           // the shadow map is a tight box round the ship: trees get ground blobs
      im.receiveShadow = true;
      out.push(im);
    }
    out.push(this.blobs());
    return out;
  }

  // a soft shadow under every tree, stretched away from the sun and laid on the slope
  blobs() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,0.62)');
    r.addColorStop(0.55, 'rgba(0,0,0,0.42)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, this.items.length);
    const sh = new THREE.Vector3(-SUN_DIR.x, 0, -SUN_DIR.z).normalize();
    const reach = 1 / Math.tan(Math.asin(SUN_DIR.y));          // ground shadow length per metre of height
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Qy = new THREE.Quaternion(), P = new THREE.Vector3();
    const S = new THREE.Vector3(), N = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const yaw = Math.atan2(sh.x, sh.z);
    this.items.forEach((t, i) => {
      const crown = (t.conifer ? 0.24 : 0.3) * t.s, len = crown * 2 + t.s * 0.55 * reach;
      const off = t.s * 0.32 * reach;
      const x = t.x + sh.x * off, z = t.z + sh.z * off;
      const e = 3, h = (a, b) => this.terrain.height(a, b);
      N.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize();
      Q.setFromUnitVectors(Y, N).multiply(Qy.setFromAxisAngle(Y, yaw));
      P.set(x, h(x, z) + 0.12, z);
      S.set(crown * 2.1, 1, len);
      M.compose(P, Q, S);
      im.setMatrixAt(i, M);
    });
    im.renderOrder = 1;
    return im;
  }

  // trees whose trunk or crown a sphere (centre p, radius r) touches
  hit(p, r) {
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.grid.get(i * 100003 + j);
        if (!list) continue;
        for (const k of list) {
          const t = this.items[k];
          const top = t.y + t.s * 0.97;
          if (p.y - r > top) continue;
          const crown = (t.conifer ? 0.2 : 0.26) * t.s;            // average crown radius
          const d = Math.hypot(p.x - t.x, p.z - t.z);
          if (d < crown + r * 0.8) return t;
        }
      }
    }
    return null;
  }
}

// ------------------------------------------------------------------ sky, fog, sun
// a late-afternoon sun (21 deg) behind the start line: the chase camera sees the ship's lit side, shadows run long
export const SUN_DIR = new THREE.Vector3(0.55, 0.36, 0.75).normalize();
export const SHADOW_HALF = 16;        // the sun's shadow box round the ship (m)
export const SHADOW_NEAR = 300, SHADOW_FAR = 500;
export const SUN_FOG = new THREE.Color(1.05, 0.82, 0.58);   // haze toward the sun
const ZENITH = new THREE.Color(0.035, 0.12, 0.40), HORIZON = new THREE.Color(0.50, 0.58, 0.68);
const GROUND = new THREE.Color(0.30, 0.33, 0.34), SUNC = new THREE.Color(1.0, 0.86, 0.68);

const ENV_GROUND = new THREE.Color(0.045, 0.05, 0.035);

function skyMaterial(sunDisc, ground = GROUND) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: ZENITH }, horizon: { value: HORIZON }, ground: { value: ground },
      sunDir: { value: SUN_DIR }, sunColor: { value: SUNC }, disc: { value: sunDisc }, sunFog: { value: SUN_FOG } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith, horizon, ground, sunDir, sunColor, sunFog; uniform float disc;
      varying vec3 vDir;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float s = max(dot(d, sunDir), 0.0);
        vec3 col = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.45)) : mix(horizon, ground, pow(min(-d.y * 5.0, 1.0), 0.7));
        col += sunColor * (pow(s, 80.0) * 0.6 + pow(s, 8.0) * 0.12);
        // the same warm in-scatter the height fog has, so terrain and sky meet without a seam
        col = mix(col, sunFog, pow(s, 6.0) * 0.65 * (1.0 - smoothstep(0.0, 0.35, abs(d.y))));
        if (d.y > 0.0) {
          // fair-weather cumulus on a plane: lit tops toward the sun, grey bellies, thinning to the horizon
          vec2 cp = d.xz / (d.y + 0.06) * 1.3;
          float n = fbm(cp + vec2(3.1, 7.7)), m = fbm(cp * 2.7 - 5.0);
          float cov = smoothstep(0.50, 0.72, n) * smoothstep(0.01, 0.16, d.y);
          vec3 belly = vec3(0.52, 0.56, 0.62), top = vec3(1.25, 1.2, 1.12);
          vec3 cloud = mix(belly, top, clamp(0.35 + 0.65 * m + 0.5 * pow(s, 6.0), 0.0, 1.0));
          col = mix(col, cloud, cov * 0.9);
        }
        col += sunColor * disc * smoothstep(0.99985, 0.99992, s) * 60.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function sky() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial(1.0));
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

export function environment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(0.0, ENV_GROUND)));
  const rt = pm.fromScene(s, 0.02, 0.1, 1000);
  pm.dispose();
  return rt.texture;
}

// height fog (look.js): extinction per metre at sea level, thinning with height
export const FOG = () => new THREE.FogExp2(HORIZON.clone(), 0.00032);

export function lights(scene) {
  const sun = new THREE.DirectionalLight(0xffdcb4, 4.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const c = sun.shadow.camera;
  c.left = -SHADOW_HALF; c.right = SHADOW_HALF; c.top = SHADOW_HALF; c.bottom = -SHADOW_HALF; c.near = SHADOW_NEAR; c.far = SHADOW_FAR;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa9c4ea, 0x3d3a2c, 0.10);
  scene.add(hemi);
  // the light camera's own axes (lookAt with up = +Y): snapping the box to its texels in THESE axes stops the
  // shadow edges crawling as the ship moves
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const ly = new THREE.Vector3().crossVectors(SUN_DIR, lx).normalize();
  const texel = (2 * SHADOW_HALF) / 4096, q = new THREE.Vector3();
  return {
    sun,
    follow(p) {
      const a = Math.round(p.dot(lx) / texel) * texel, b = Math.round(p.dot(ly) / texel) * texel, c = p.dot(SUN_DIR);
      q.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(SUN_DIR, c);
      sun.target.position.copy(q);
      sun.position.copy(q).addScaledVector(SUN_DIR, 400);
    },
  };
}

// the first test range (?map=meadow): the same interface as SpaceWorld
export class MeadowWorld {
  constructor(scene, renderer) {
    this.name = 'meadow';
    this.road = new Road();
    this.terrain = new Terrain(this.road);
    scene.add(this.terrain.mesh(), this.road.mesh(), this.road.posts());
    this.forest = new Forest(this.terrain, this.road);
    this.trees = this.forest.meshes();
    this.trees.forEach((m) => scene.add(m));
    this.skyMesh = sky();
    scene.add(this.skyMesh);
    scene.environment = environment(renderer);
    scene.environmentIntensity = 0.45;
    scene.fog = FOG();
    this.sunL = lights(scene);
    this.minimap = this.road;
    this.startIndex = this.road.nearest(0, 60).i;
    this.noAO = [this.skyMesh, this.trees[2]];
  }

  surface(x, z) { return this.terrain.surface(x, z); }
  height(x, z) { return this.terrain.height(x, z); }
  hit(p, r) { return this.forest.hit(p, r); }
  follow(p) { this.sunL.follow(p); }
  update(t, camera) { this.skyMesh.position.copy(camera.position); }
}
