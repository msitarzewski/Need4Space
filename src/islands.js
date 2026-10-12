// The floating islands: each one a grassy top (gentle hills), a rounded rim, cliffs of layered rock and an underside
// that hangs below it in lobes - ONE closed surface, generated in rows from the top's middle down to the lowest tip
// (no pieces butted together). The rock is a tile painted once on the GPU (blocks split by joints, weathering, pits,
// grit) laid on from the three world axes at two scales; strata, water streaks down the cliffs, moss creeping over
// the rim and down the wet streaks, and the grass on top are drawn from world position.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { mulberry32, fbm, smoothstep, clamp } from './noise.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 3-D value noise (displacement)
function h3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function n3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), fx), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), fx), fy),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), fx), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * n3(x, y, z); n += a; x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5; }
  return s / n;
}

// ---------------------------------------------------------------- the shape
// I: { x, z, top, rx, rz, rot, cliff, depth, seed, hill = 8, crag = 1, taper = 1.2, lobes = 3, res = 160 }
// Returns { geometry, top(x, z) -> height of the top surface or null, rim(θ) -> world point on the rim, ... }
export function islandShape(I) {
  const rnd = mulberry32(I.seed);
  const NU = I.res || 160, NT = 12, NRIM = 6, NC = Math.max(6, Math.round(I.cliff / 9)), NB = Math.max(18, Math.round((I.depth - I.cliff) / 9));
  const rx = I.rx, rz = I.rz, cr = Math.cos(I.rot || 0), sr = Math.sin(I.rot || 0), avgR = (rx + rz) / 2;
  const hill = I.hill ?? 8, crag = I.crag ?? 1, taper = I.taper ?? 1.2;
  const s1 = rnd() * 50, s2 = rnd() * 50;
  // the outline: a wobbly ellipse (bays and headlands)
  const R = new Float32Array(NU), base = new Float32Array(NU);
  for (let j = 0; j < NU; j++) {
    const th = (j / NU) * TAU, c = Math.cos(th), s = Math.sin(th);
    R[j] = 1 + (fbm(c * 1.2 + s1, s * 1.2 + s2, 4) - 0.5) * 0.7 + (fbm(c * 3.5 + s2, s * 3.5 - s1, 3) - 0.5) * 0.18;
    base[j] = I.cliff * (0.75 + 0.5 * fbm(c * 1.6 - s1, s * 1.6 + s2, 3));     // the cliff's height there
  }
  const toWorld = (u, w, y) => [I.x + u * rx * cr - w * rz * sr, y, I.z + u * rx * sr + w * rz * cr];
  // the top: gentle hills, flattening toward the rim
  const topAt = (u, w, rho) => {
    const [x, , z] = toWorld(u, w, 0);
    return I.top + hill * ((fbm(x / 110 + s1, z / 110 + s2, 4) - 0.5) * 2 * (1 - smoothstep(0.55, 1.0, rho)) + 0.35 * (1 - rho * rho));
  };
  // the underside: a taper to a tip, and lobes hanging below it here and there (by their depth below the cliffs' foot)
  const lobes = Array.from({ length: I.lobes ?? 3 }, () => {
    const a = rnd() * TAU, r = 0.25 + rnd() * 0.45;
    return { u: Math.cos(a) * r, w: Math.sin(a) * r, d: 0.55 + rnd() * 0.45, s: 0.18 + rnd() * 0.22 };
  });
  const under = (u, w, rho) => {
    let h = Math.pow(Math.max(0, 1 - rho), taper);
    for (const L of lobes) h = Math.max(h, L.d * Math.exp(-((u - L.u) ** 2 + (w - L.w) ** 2) / (L.s * L.s)) * smoothstep(1.0, 0.75, rho));
    return h * (I.depth - I.cliff);
  };
  const rows = [];                 // each: { pts: [[u, w, y]...], grass, deep, kind }
  const rrM = Math.min(9, I.cliff * 0.3), rr = rrM / avgR;
  const rimY = new Float32Array(NU);
  for (let j = 0; j < NU; j++) {
    const th = (j / NU) * TAU, rho = R[j] - rr;
    rimY[j] = topAt(Math.cos(th) * rho, Math.sin(th) * rho, rho / R[j]);
  }
  // top (row 0 is the single middle point)
  for (let i = 1; i <= NT; i++) {
    const t = i / NT, pts = [];
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, rho = (R[j] - rr) * Math.pow(t, 0.85), u = Math.cos(th) * rho, w = Math.sin(th) * rho;
      pts.push([u, w, i === NT ? rimY[j] : topAt(u, w, rho / R[j])]);
    }
    rows.push({ pts, grass: 1, deep: 0 });
  }
  // the rim, rounded over
  for (let k = 1; k <= NRIM; k++) {
    const a = (k / NRIM) * Math.PI / 2, pts = [];
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, rho = R[j] - rr + rr * Math.sin(a);
      pts.push([Math.cos(th) * rho, Math.sin(th) * rho, rimY[j] - rrM + rrM * Math.cos(a)]);
    }
    rows.push({ pts, grass: 1 - k / NRIM, deep: 0 });
  }
  // the cliffs: down to their foot, bulging a little
  for (let k = 1; k <= NC; k++) {
    const t = k / NC, pts = [];
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, rho = R[j] * (1 + 0.03 * Math.sin(Math.PI * t));
      pts.push([Math.cos(th) * rho, Math.sin(th) * rho, rimY[j] - rrM - (rimY[j] - rrM - (I.top - base[j])) * t]);
    }
    rows.push({ pts, grass: 0, deep: 0 });
  }
  // the underside, in to the tip
  for (let k = 1; k < NB; k++) {
    const t = k / NB, pts = [];
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, rho = R[j] * (1 - Math.pow(t, 0.9)), u = Math.cos(th) * rho, w = Math.sin(th) * rho;
      pts.push([u, w, I.top - base[j] - under(u, w, rho / R[j])]);
    }
    rows.push({ pts, grass: 0, deep: t });
  }
  // vertices: middle point, the rows, the tip
  const nv = 2 + rows.length * NU, pos = new Float32Array(nv * 3), isl = new Float32Array(nv * 2);
  let v = 0;
  const put = (u, w, y, grass, deep, out) => {
    let [x, yy, z] = toWorld(u, w, y);
    if (out) {                                   // craggy rock: pushed in and out along the outward direction
      const f = 1 / (avgR * 0.22), amp = avgR * 0.045 * crag;
      const d = (fbm3(x * f, yy * f * 1.4, z * f, I.far ? 2 : 4) - 0.5) * 2 * amp + (I.far ? 0 : (n3(x * f * 4, yy * f * 0.6, z * f * 4) - 0.5) * amp * 0.5);
      x += out[0] * d; yy += out[1] * d; z += out[2] * d;
    }
    pos.set([x, yy, z], v * 3); isl.set([grass, deep], v * 2); v++;
  };
  put(0, 0, topAt(0, 0, 0), 1, 0, null);
  rows.forEach((row, ri) => {
    row.pts.forEach(([u, w, y], j) => {
      const th = (j / NU) * TAU, ca = Math.cos(th), sa = Math.sin(th);
      // outward: sideways on the cliffs, turning down under the island; the top and the rim stay smooth
      const ow = row.grass >= 0.5 ? null : (() => {
        const dn = row.deep, ox = ca * rx * cr - sa * rz * sr, oz = ca * rx * sr + sa * rz * cr, l = Math.hypot(ox, oz);
        const o = [ox / l * (1 - dn), -dn, oz / l * (1 - dn)], m = Math.hypot(...o);
        return o.map((q) => (q / m) * (1 - row.grass * 2));
      })();
      put(u, w, y, row.grass, row.deep, ow);
    });
  });
  const tipY = I.top - I.cliff - under(0, 0, 0);
  put(0, 0, tipY, 0, 1, null);
  const idx = [];
  for (let j = 0; j < NU; j++) idx.push(0, 1 + ((j + 1) % NU), 1 + j);
  for (let r = 0; r < rows.length - 1; r++) for (let j = 0; j < NU; j++) {
    const a = 1 + r * NU + j, b = 1 + r * NU + ((j + 1) % NU), d = a + NU, e = b + NU;
    idx.push(a, b, d, b, e, d);
  }
  const last = 1 + (rows.length - 1) * NU, tip = nv - 1;
  for (let j = 0; j < NU; j++) idx.push(last + j, last + ((j + 1) % NU), tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('isl', new THREE.BufferAttribute(isl, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // facing out: the middle of the top must face up
  if (g.attributes.normal.getY(0) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  // the top surface's height at a world point (null: off the top), for planting
  const topHeight = (x, z) => topInfo(x, z)?.y ?? null;
  // and how far in from the rim (m)
  const topInfo = (x, z) => {
    const dx = x - I.x, dz = z - I.z, lu = (dx * cr + dz * sr) / rx, lw = (-dx * sr + dz * cr) / rz;
    const rho = Math.hypot(lu, lw), th = Math.atan2(lw, lu), j = Math.round(((th / TAU) + 1) % 1 * NU) % NU;
    if (rho > R[j] - rr) return null;
    return { y: topAt(lu, lw, rho / R[j]), edge: (R[j] - rr - rho) * avgR };
  };
  // a point on the rim (lip) at angle th (local), its outward direction (world)
  const rimAt = (th) => {
    const j = Math.round(((th / TAU) % 1 + 1) % 1 * NU) % NU, a = (j / NU) * TAU, rho = R[j];
    const p = toWorld(Math.cos(a) * rho, Math.sin(a) * rho, rimY[j]);
    const ox = Math.cos(a) * rx * cr - Math.sin(a) * rz * sr, oz = Math.cos(a) * rx * sr + Math.sin(a) * rz * cr, l = Math.hypot(ox, oz);
    return { p: new THREE.Vector3(...p), out: new THREE.Vector3(ox / l, 0, oz / l), y: rimY[j] };
  };
  return { geometry: g, I, topHeight, topInfo, rimAt, R, NU, rows: rows.length, bottom: tipY };
}

// ---------------------------------------------------------------- the rock tile
const GEN = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform int mode;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  float vn(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float fbm(vec2 p, float per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vn(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n; }
  vec3 cell(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0, id = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), c = mod(i + o, per), r = o + 0.1 + 0.8 * h22(c) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h12(c + 5.7); } else if (d < d2) d2 = d;
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
  // weathered rock: rounded relief and sharp ridges running down the face (the tile's v is up the world on the
  // sides), a few long cracks, faint bedding, pits and grit - joint: how deep in a crack, blockId: the patch's shade
  float height(vec2 uv, out float joint, out float blockId) {
    vec2 w = vec2(fbm(uv * 3.0, 3.0, 4), fbm(uv * 3.0 + 7.3, 3.0, 4)) * 0.25;
    float ridge = 1.0 - abs(2.0 * fbm(vec2((uv.x + w.x) * 7.0, (uv.y + w.y) * 2.0), 7.0, 5) - 1.0);
    float relief = fbm(uv * 5.0 + w, 5.0, 6);
    // long cracks: the edges of big warped cells, kept only where a mask allows (most of the face is unbroken)
    vec3 a = cell(vec2((uv.x + w.x) * 3.0, (uv.y + w.y) * 1.5), 3.0);
    float crack = (1.0 - smoothstep(0.0, 0.035, a.y - a.x)) * smoothstep(0.55, 0.7, fbm(uv * 2.0 + 5.0, 2.0, 3));
    joint = crack;
    blockId = fbm(uv * 2.0 + 11.0, 2.0, 3);
    float bed = smoothstep(0.85, 1.0, sin((uv.y + w.y * 0.5) * 6.2831853 * 6.0) * 0.5 + 0.5) * 0.004;
    float h = relief * 0.05 + ridge * ridge * 0.022 - crack * 0.012 - bed;
    vec3 pit = cell(uv * 37.0, 37.0);
    h -= pow(max(0.0, 1.0 - pit.x / 0.3), 2.0) * 0.003 * step(0.55, pit.z);
    h += (fbm(uv * 160.0, 160.0, 3) - 0.5) * 0.0018;
    return h;
  }
  void main() {
    vec2 uv = vUv;
    float joint, bid;
    if (mode == 1) {
      float e = 1.0 / 2048.0, j2, b2;
      float dx = (height(uv + vec2(e, 0.0), j2, b2) - height(uv - vec2(e, 0.0), j2, b2)) / (2.0 * e);
      float dy = (height(uv + vec2(0.0, e), j2, b2) - height(uv - vec2(0.0, e), j2, b2)) / (2.0 * e);
      float h = height(uv, joint, bid);
      gl_FragColor = vec4(normalize(vec3(-dx, -dy, 1.0)) * 0.5 + 0.5, clamp(0.5 + h * 12.0, 0.0, 1.0));
      return;
    }
    float h = height(uv, joint, bid);
    // albedo variation round 1 (stored halved): block faces each their own shade, darker joints and pits, lichen
    float v = 0.82 + 0.36 * bid;
    v *= 1.0 - 0.3 * joint;
    v *= 0.92 + 0.16 * fbm(uv * 23.0 + 1.0, 23.0, 4);
    v *= 1.0 + clamp(h * 8.0, -0.25, 0.2);
    float lichen = smoothstep(0.66, 0.74, fbm(uv * 31.0 + 9.0, 31.0, 4)) * (1.0 - joint);
    vec3 c = vec3(v) * mix(vec3(1.0), vec3(1.25, 1.2, 0.95), lichen);
    float rough = 0.82 + 0.1 * joint - 0.06 * lichen;
    gl_FragColor = vec4(clamp(c * 0.5, 0.0, 1.0), rough);
  }
`;
const U = { islCol: { value: null }, islNrm: { value: null } };
let maps = null;
export function islandMaps(renderer) {
  if (maps) return maps;
  const bake = (mode) => {
    const S = Q.tier === 'low' ? 1024 : 2048;
    const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { mode: { value: mode } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: GEN }));
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
  maps = { color: bake(0), normal: bake(1) };
  U.islCol.value = maps.color; U.islNrm.value = maps.normal;
  return maps;
}

// ---------------------------------------------------------------- the material
// rock from the tile (three axes, two scales), strata, streaks, moss; grass where the geometry says top ('isl'.x);
// 'isl'.y deep under the island (darker, rootier)
export function islandMaterial({ key = 'island', side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const lite = Q.lite ? '#define ISL_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 isl; varying vec2 vIsl; varying vec3 vIW; varying vec3 vIN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vIsl = isl;
  {
    vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
  #endif
    vIW = (modelMatrix * tw).xyz; vIN = normalize(mat3(modelMatrix) * tn);
  }`);
    sh.fragmentShader = lite + sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D islCol, islNrm; varying vec2 vIsl; varying vec3 vIW; varying vec3 vIN;
float iH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float iN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(iH(i), iH(i + vec3(1, 0, 0)), f.x), mix(iH(i + vec3(0, 1, 0)), iH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(iH(i + vec3(0, 0, 1)), iH(i + vec3(1, 0, 1)), f.x), mix(iH(i + vec3(0, 1, 1)), iH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float iF(vec3 p) { return iN(p) * 0.5 + iN(p * 2.07 + 3.1) * 0.3 + iN(p * 4.3 - 1.7) * 0.2; }
// one axis' projection at one scale: the tile turned by a fixed angle per axis (no two faces line up)
void iTap(vec2 p, float rot, out vec4 c, out vec2 g) {
  float ca = cos(rot), sa = sin(rot);
  mat2 R = mat2(ca, sa, -sa, ca);
  vec2 u = R * p;
  c = texture2D(islCol, u);
  vec3 n = texture2D(islNrm, u).xyz * 2.0 - 1.0;
  g = transpose(R) * (-n.xy / max(n.z, 0.25));
}
void iProj(vec2 p, float rot, out vec4 c, out vec2 g) {
  vec4 ca, cb; vec2 ga, gb;
  iTap(p / 21.0, rot, ca, ga);
#ifdef ISL_LITE
  c = vec4(ca.rgb * 2.0, ca.a); g = ga;
#else
  iTap(p / 4.7 + 0.37, rot, cb, gb);
  c = vec4(ca.rgb * cb.rgb * 4.0, mix(ca.a, cb.a, 0.5)); g = ga + gb;
#endif
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 iN0 = normalize(vIN);
  // (the sides' tiles stand upright; the top's is turned)
  vec3 tpw = pow(abs(iN0), vec3(5.0));
  tpw /= tpw.x + tpw.y + tpw.z;
  vec4 iC = vec4(0.0); vec2 gX = vec2(0.0), gY = vec2(0.0), gZ = vec2(0.0);
  if (tpw.x > 0.02) { vec4 c; iProj(vIW.zy, 0.0, c, gX); iC += c * tpw.x; }
  if (tpw.y > 0.02) { vec4 c; iProj(vIW.xz, 1.3, c, gY); iC += c * tpw.y; }
  if (tpw.z > 0.02) { vec4 c; iProj(vIW.xy, 0.0, c, gZ); iC += c * tpw.z; }
  iC /= max(tpw.x * step(0.02, tpw.x) + tpw.y * step(0.02, tpw.y) + tpw.z * step(0.02, tpw.z), 1e-3);
  // the rock: pale limestone in strata (bands warped through the island), darker water streaks down the faces
  float strata = iN(vec3(vIW.x * 0.004, vIW.y * 0.09 + iN(vIW * 0.008) * 4.0, vIW.z * 0.004)) * 0.7 + iN(vIW * 0.03) * 0.3;
  vec3 rock = mix(vec3(0.17, 0.16, 0.145), vec3(0.25, 0.235, 0.205), strata);
  rock = mix(rock, vec3(0.26, 0.18, 0.11), smoothstep(0.6, 0.8, iN(vec3(vIW.xz * 0.006, vIW.y * 0.06))) * 0.55);   // iron stains
  float streak = smoothstep(0.5, 0.85, iN(vec3(vIW.x * 0.13, vIW.y * 0.006, vIW.z * 0.13)) * 0.7 + iN(vec3(vIW.x * 0.5, vIW.y * 0.02, vIW.z * 0.5)) * 0.3);
  rock *= 1.0 - 0.5 * streak;
  // deep under the island: darker, roots and old soil showing
  rock = mix(rock, vec3(0.16, 0.12, 0.09), smoothstep(0.15, 0.7, vIsl.y) * 0.65 * smoothstep(0.4, 0.7, iF(vIW * 0.03)));
  rock *= iC.rgb;
  // moss: over the rim and down the wet streaks, on faces that see the sky, in patches
  float up = iN0.y;
  float mossN = iF(vIW * vec3(0.09, 0.05, 0.09) + 2.0) * 0.7 + iN(vIW * 0.4) * 0.3;
  float ledge = smoothstep(0.6, 0.8, iN(vec3(vIW.x * 0.02, vIW.y * 0.25, vIW.z * 0.02)));                // ledges here and there
  float moss = smoothstep(0.5, 0.66, mossN + streak * 0.3 + ledge * 0.25 * smoothstep(-0.3, 0.3, up) + vIsl.x * 0.6 - vIsl.y * 0.5)
    * smoothstep(-0.6, 0.0, up);
  vec3 mossC = mix(vec3(0.03, 0.055, 0.014), vec3(0.075, 0.11, 0.025), iN(vIW * 0.25));
  // grass on top: two greens in drifts, flowers' specks, darker under the trees (the planting's own noise)
  float gn = iF(vIW * 0.02), gn2 = iN(vIW * 0.35);
  vec3 grass = mix(vec3(0.06, 0.11, 0.025), vec3(0.13, 0.17, 0.04), gn) * (0.8 + 0.4 * gn2);
  grass = mix(grass, vec3(0.09, 0.08, 0.03), smoothstep(0.62, 0.72, iN(vIW * 0.06 + 9.0)) * 0.5);
  float grassK = smoothstep(0.25, 0.6, vIsl.x + (up - 0.8) * 0.8) * smoothstep(0.35, 0.65, up);
  vec3 alb = mix(rock, mossC * (0.8 + 0.4 * iC.r), moss * (1.0 - grassK));
  alb = mix(alb, grass, grassK);
  diffuseColor.rgb = alb;
  float iRough = mix(mix(iC.a, 0.95, moss), 0.92, grassK) - 0.25 * streak * (1.0 - grassK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = iRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // the tile's relief (whiteout blend per axis), softened under moss and grass; the strata's ledges
    float k = 1.0 - 0.7 * max(moss, grassK);
    vec3 tx = vec3(gX * k + iN0.zy, iN0.x), ty = vec3(gY * k + iN0.xz, iN0.y), tz = vec3(gZ * k + iN0.xy, iN0.z);
    vec3 nw = normalize(tx.zyx * tpw.x + ty.xzy * tpw.y + tz.xyz * tpw.z);
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz) * (gl_FrontFacing ? 1.0 : -1.0);
  }`);
  };
  mat.customProgramCacheKey = () => `forest-${key}-${Q.lite}`;
  return mat;
}

// ---------------------------------------------------------------- clearance
// any vertex of these geometries inside the track's slab (|x| < half + 6, -9 < y < 22 over the deck): a list of them
// (nearest(p): the nearest track sample's index, or -1 if none is within reach - a grid lookup)
export function trackClearance(track, geometries, { half = 23 + 6, below = -9, above = 22, nearest = null } = {}) {
  const bad = [], v = new THREE.Vector3(), d = new THREE.Vector3();
  const coarse = [];
  for (let i = 0; i < track.n; i += 4) coarse.push(i);
  for (const [name, g] of geometries) {
    const p = g.attributes.position;
    g.computeBoundingSphere();
    const bs = g.boundingSphere;
    let near = false;
    for (const i of coarse) if (track.P[i].distanceTo(bs.center) < bs.radius + 60) { near = true; break; }
    if (!near) continue;
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      let bi = -1;
      if (nearest) bi = nearest(v);
      else {
        let best = 1e18;
        for (const i of coarse) { const q = track.P[i].distanceToSquared(v); if (q < best) { best = q; bi = i; } }
        if (best > 200 * 200) bi = -1;
      }
      if (bi < 0) continue;
      for (let i = bi - 4; i <= bi + 4; i++) {
        const ii = (i + track.n) % track.n;
        if (!track.solid[ii]) continue;
        d.subVectors(v, track.P[ii]);
        if (Math.abs(d.dot(track.T[ii])) > track.step) continue;
        const x = d.dot(track.R[ii]), y = d.dot(track.U[ii]);
        if (Math.abs(x) < half && y > below && y < above) { bad.push({ name, at: v.clone(), s: ii * track.step, x, y }); break; }
      }
    }
  }
  return bad;
}

export { clamp };
