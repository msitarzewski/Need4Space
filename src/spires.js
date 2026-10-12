// The ice planet's formations: crystals grown up out of the sea ice (hexagonal prisms tens to hundreds of metres long,
// lit from inside), spires of glacier ice like icicles stood on end, the great arch the wind carved, the glacier the
// track bores through (its cave: blue ice glowing all round, icicles from the roof), and the frozen falls down its
// cliffs. Geometry built once at load (instanced where it repeats: a draw a kind); lit by the sun and the sky alone
// and the world's shadow map (drawn once), save the cave's walls, which the ships' lights reach.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Q } from './quality.js';
import { TRACK_W } from './track.js';
import { sunOnly } from './look.js';
import { fbm, noise2, mulberry32, smoothstep } from './noise.js';

// ---------------------------------------------------------------- 3-D value noise (JS, for shapes)
function h3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v), w);
}
export const fbm3 = (x, y, z, o = 4) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5; } return s / n; };

// ---------------------------------------------------------------- materials
const GLSL_N = /* glsl */`
float spH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float spN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(spH(i), spH(i + vec3(1, 0, 0)), f.x), mix(spH(i + vec3(0, 1, 0)), spH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(spH(i + vec3(0, 0, 1)), spH(i + vec3(1, 0, 1)), f.x), mix(spH(i + vec3(0, 1, 1)), spH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec2 spH2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// meltwater scallops on a wall: the nearest cup's middle from p (cells of 1), and how far
vec2 spCup(vec2 p, out float d1) {
  vec2 i = floor(p), f = fract(p), m = vec2(0.0);
  d1 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)), r = o + 0.15 + 0.7 * spH2(i + o) - f;
    float d = dot(r, r);
    if (d < d1) { d1 = d; m = r; }
  }
  return m;
}`;

// Glacier ice: bands of old ice laid down year on year (deep blue, pale, a line of grit), warped; frost dulling it in
// patches; snow wherever a face looks up; and its own light - the blue the ice lets through, strongest where it is
// thin (the geometry's 'glow' per vertex) and seen straight on. lamps: the point and spot lights too (the cave)
// shadows: false - no shadow map looked up at all (the cave, where the sun is cut)
// walls: a sheer face's own look (the shelf's crevasse and cliffs) - the strata level and crisp, darker with depth,
// meltwater scallops a few metres across all over it, sharp-rimmed (they catch the light at race speed)
export function glacierMaterial({ key = 'glacier', lamps = false, glow = 1, side = THREE.FrontSide, snow = 1, shadows = true, walls = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0, side });
  if (!lamps) mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  if (walls) mat.defines = { ...mat.defines, SP_WALLS: '' };
  mat.onBeforeCompile = (sh) => {
    const lite = Q.lite ? '#define SP_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute float glow; varying float vGlow; varying vec3 vGW; varying vec3 vGN; varying vec4 vGA;
${GLSL_N}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vGlow = glow;
  {
    vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
  #endif
    vGW = (modelMatrix * tw).xyz; vGN = normalize(mat3(modelMatrix) * tn);
    // (the noises that vary over tens of metres, per vertex: the bands' warp, the frost's patches, the grit's, the snow's
    // edge - per pixel they were most of the shader, and the cave's walls fill the screen)
    vGA = vec4(spN(vGW * 0.012) * 26.0 + spN(vGW * 0.05) * 5.0, spN(vGW * 0.035 + 7.0), spN(vGW * 0.03 + 4.0), spN(vGW * 0.08));
  }`);
    sh.fragmentShader = lite + (shadows ? '' : '#undef USE_SHADOWMAP\n') + sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vGlow; varying vec3 vGW; varying vec3 vGN; varying vec4 vGA;
${GLSL_N}
// a line every period (m) along y, halfW wide, anti-aliased (fading to its average once thinner than a pixel)
float spLine(float y, float period, float halfW) {
  float d = abs(fract(y / period) - 0.5) * period, aw = fwidth(y) * 0.75;
  return (1.0 - smoothstep(halfW - aw, halfW + aw, d)) * min(1.0, halfW / max(aw, 1e-4));
}
float gSnow = 0.0, gBand = 0.0, gSeam = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 gn = normalize(vGN);
#ifdef SP_WALLS
  float y = vGW.y + vGA.x * 0.2;
  float band = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(y * 0.3)) * (0.5 + 0.5 * sin(y * 0.057 + 1.3)) * smoothstep(-20.0, 90.0, vGW.y);
  float grit = smoothstep(0.95, 0.99, 0.5 + 0.5 * sin(y * 0.115 + 0.7)) * smoothstep(0.3, 0.6, vGA.z);
#else
  float y = vGW.y + vGA.x;
  float band = 0.5 + 0.5 * sin(y * 0.21) * (0.6 + 0.4 * sin(y * 0.047 + 1.3));
  float grit = smoothstep(0.93, 0.99, 0.5 + 0.5 * sin(y * 0.083 + 0.7)) * smoothstep(0.4, 0.7, vGA.z);
#endif
  gBand = band;
  vec3 deep = vec3(0.008, 0.05, 0.1), pale = vec3(0.1, 0.34, 0.48);
  vec3 alb = mix(deep, pale, band * 0.8 + 0.2 * spN(vGW * 0.11));
  alb = mix(alb, vec3(0.03, 0.03, 0.035), grit * 0.7);
  float frost = smoothstep(0.45, 0.75, vGA.y * 0.7 + spN(vGW * 0.2) * 0.3);
  alb = mix(alb, vec3(0.32, 0.45, 0.55), frost * 0.45);
  gSnow = smoothstep(0.55, 0.75, gn.y + (vGA.w - 0.5) * 0.5) * ${snow.toFixed(2)};
#ifdef SP_WALLS
  // ledges along the strata, snow lying on them; seams of clear ice the light comes through
  // (not every band has one, and each comes and goes along the face)
  float ledge = spLine(y + 7.0, 23.0, 0.55) * step(0.45, fract(sin(floor((y + 7.0) / 23.0) * 91.7) * 437.5)) * smoothstep(0.3, 0.55, vGA.y);
  float seam = spLine(y, 37.0, 0.3) * smoothstep(0.35, 0.6, vGA.z) * step(0.3, fract(sin(floor(y / 37.0) * 47.3) * 437.5));
  gSnow = max(gSnow, ledge * 0.85 * ${snow.toFixed(2)});
  gSeam = seam;
  alb = mix(alb, vec3(0.012, 0.012, 0.016), spLine(y + 3.0, 11.0, 0.18) * 0.6 * smoothstep(0.35, 0.6, vGA.w));
#endif
  alb = mix(alb, vec3(0.62, 0.78, 1.0), gSnow);
  diffuseColor.rgb = alb;
  float gRough = mix(mix(0.08, 0.45, frost), 0.75, gSnow);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifndef SP_LITE
  {
    // wind-scoured relief: the noise's slope across the face
    float e = 0.6, n0 = spN(vGW * 0.33);
    vec3 g = vec3(spN((vGW + vec3(e, 0.0, 0.0)) * 0.33) - n0, spN((vGW + vec3(0.0, e, 0.0)) * 0.33) - n0, spN((vGW + vec3(0.0, 0.0, e)) * 0.33) - n0) / e;
    vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
    normal = normalize(normal - (gv - normal * dot(gv, normal)) * 0.6 * (1.0 - gSnow));
  }
#ifdef SP_WALLS
  {
    // the scallops: shallow cups (~8 m across, 6 m high, of uneven sizes) on the face's own plane, the normal tipped
    // toward each cup's middle, steepest at its rim
    vec3 nw = normalize(vGN);
    bool xs = abs(nw.x) > abs(nw.z);
    vec2 q = (xs ? vGW.zy : vGW.xy) * vec2(0.125, 0.17);
    q += vec2(vGA.y, vGA.z) * 1.6;
    float d1;
    vec2 m = spCup(q, d1);
    vec3 g = (xs ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)) * m.x + vec3(0.0, 1.0, 0.0) * m.y;
    vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
    normal = normalize(normal + (gv - normal * dot(gv, normal)) * (0.18 + 0.5 * d1) * (1.0 - gSnow));
  }
#endif
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float ndv = abs(dot(normal, normalize(vViewPosition)));
    // the light through the ice: blue, brighter in the paler bands, where it is thin, looked into straight
    float thru = vGlow * (0.35 + 0.65 * gBand) * (0.4 + 0.6 * ndv) * (1.0 - gSnow);
    totalEmissiveRadiance += vec3(0.02, 0.32, 0.8) * thru * ${(0.32 * glow).toFixed(3)} + vec3(0.1, 0.65, 1.0) * gSeam * ${(0.7 * glow).toFixed(3)};
  }`);
    if (!lamps) sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `ice-${key}-${lamps}-${glow}-${snow}-${shadows}-${walls}-${Q.lite}`;
  return mat;
}

// The crystals: dark, glass-smooth faces (the sky and the sun in them) over a light inside - each crystal its own
// colour (per instance), brightest down its core where it grows out of the ice, fading up the shaft, flaring at the
// tip; planes of fracture inside it catch the light in bands
export function crystalMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.04, metalness: 0.2, color: new THREE.Color(0.006, 0.014, 0.024) });
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float cy; varying float vCy; varying vec3 vCL; varying vec3 vCC;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vCy = cy; vCL = position;
  #ifdef USE_INSTANCING_COLOR
  vCC = instanceColor;
  #else
  vCC = vec3(0.1, 0.8, 1.0);
  #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vCy; varying vec3 vCL; varying vec3 vCC;
${GLSL_N}`)
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float ndv = abs(dot(normal, normalize(vViewPosition)));
    // its edges: the angle round the axis against the six corners (0 on an edge), the shoulder where the point begins
    float a = atan(vCL.z, vCL.x) / 1.0471976 - 0.5;
    // (the angle wraps by a whole turn down the middle of one face: its fwidth there drew a dashed false edge - take
    // the change of whichever of a and fract(a) is continuous at the pixel)
    float ed = abs(fract(a + 0.5) - 0.5), aw = min(fwidth(a), fwidth(fract(a))) * 1.5;
    float edge = 1.0 - smoothstep(0.0, 0.025 + aw, ed);
    float shoulder = 1.0 - smoothstep(0.0, 0.01 + fwidth(vCy) * 1.5, abs(vCy - 0.8));
    float base = exp(-vCy * 4.5);                             // fed from the ice below: bright at its foot
    float tip = smoothstep(0.84, 1.0, vCy);
    float planes = smoothstep(0.55, 0.9, spN(vec3(vCL.x * 1.5, vCL.y * 14.0, vCL.z * 1.5) + vCC * 9.0));
    float inner = pow(ndv, 3.0);                              // looking straight in: into its depth
    vec3 c = vCC * (inner * (0.12 + 1.3 * base + 0.18 * planes) + edge * (0.35 + 1.6 * base + 1.0 * tip) + shoulder * 0.7 + tip * inner * 0.8);
    c += vec3(0.85, 0.97, 1.0) * (tip * tip * 0.35 + edge * tip * 0.5);
    totalEmissiveRadiance += c * 0.7;
  }`);
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'ice-crystal';
  return mat;
}

// ---------------------------------------------------------------- shapes
// one crystal: a hexagonal prism (radius 1, from y = -0.1 to 0.8) and its point (to y = 1); flat faces; cy along it
export function crystalGeometry() {
  const pos = [], cy = [], R = 1, top = 0.8, bot = -0.1, tipY = 1.0;
  const ring = (y, r) => Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  const lo = ring(bot, R), hi = ring(top, R * 0.97);
  const tri = (a, b, c) => { pos.push(...a, ...b, ...c); cy.push(Math.max(a[1], 0), Math.max(b[1], 0), Math.max(c[1], 0)); };
  for (let k = 0; k < 6; k++) {
    const k2 = (k + 1) % 6;
    tri(lo[k], hi[k2], lo[k2]); tri(lo[k], hi[k], hi[k2]);
    tri(hi[k], [0, tipY, 0], hi[k2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('cy', new THREE.Float32BufferAttribute(cy, 1));
  g.computeVertexNormals();
  return g;
}

// a spire of glacier ice: a fluted, twisting, tapering column, its point a needle; h tall, r at its foot
export function spireGeometry(h, r, seed, { seg = 20, rows = 48, twist = 0.6, lean = null } = {}) {
  const rnd = mulberry32(seed), pos = [], glow = [], idx = [];
  const ph = rnd() * 10, flutes = 5 + Math.floor(rnd() * 4), lx = lean ? lean.x : (rnd() - 0.5) * 0.15, lz = lean ? lean.z : (rnd() - 0.5) * 0.15;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = -0.08 * h + t * h * 1.08;
    // the profile: a broad foot, a waist, a bulge, the long taper to the needle
    let rr = r * Math.pow(1 - t, 1.25) * (1 + 0.35 * Math.exp(-t * 9)) * (1 + 0.18 * Math.sin(t * 7 + ph)) * (0.8 + 0.4 * noise2(t * 6, ph));
    if (i === rows) rr = 0;
    const tw = twist * t * Math.PI * 2;
    const cx = lx * y * y / h, cz = lz * y * y / h;            // a lean that grows with height
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, f = 1 + 0.16 * Math.abs(Math.sin((a + tw) * flutes * 0.5)) - 0.08;
      const n = 0.85 + 0.3 * noise3(Math.cos(a) * 2 + ph, t * 9, Math.sin(a) * 2);
      const k = rr * f * n;
      pos.push(cx + Math.cos(a) * k, y, cz + Math.sin(a) * k);
      glow.push(0.3 + 0.7 * smoothstep(0.25, 0.95, t));      // (thinner up the needle: more light through it)
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a tube swept along points (world), radius per point, ring of nr; displaced by a 3-D noise (wind-carved)
export function sweptIce(pts, radii, { nr = 28, carve = 0.35, carveScale = 0.025, seed = 1, glowFn = null } = {}) {
  const pos = [], glow = [], idx = [], n = pts.length;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  let prevN = null;
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    if (!prevN) N.crossVectors(T, up).normalize(); else N.copy(prevN).addScaledVector(T, -prevN.dot(T)).normalize();
    prevN = N.clone();
    B.crossVectors(T, N).normalize();
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      p.copy(pts[i]).addScaledVector(N, ca * radii[i]).addScaledVector(B, sa * radii[i]);
      const d = 1 + carve * (fbm3(p.x * carveScale + seed, p.y * carveScale * 1.6, p.z * carveScale - seed, 4) - 0.5) * 2;
      p.copy(pts[i]).addScaledVector(N, ca * radii[i] * d).addScaledVector(B, sa * radii[i] * d);
      pos.push(p.x, p.y, p.z);
      glow.push(glowFn ? glowFn(i / (n - 1), radii[i] * d) : 0.6);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + (j + 1) % nr, c = a + nr, d = b + nr;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the track's slab, for clearance
// the track's samples in 40 m cells (x, z): what is near a point, fast
export class TrackGrid {
  constructor(track) {
    this.track = track;
    const C = 40, g = new Map();
    track.P.forEach((p, i) => { const k = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
    this.g = g;
  }
  // the nearest sample within ~80 m (x, z) and maxDy of height: index or -1
  nearest(p, maxDy = 200) {
    const C = 40, cx = Math.floor(p.x / C), cz = Math.floor(p.z / C), tr = this.track;
    let best = 1e18, bi = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      for (const i of this.g.get(`${cx + a},${cz + b}`) || []) {
        const q = tr.P[i]; if (Math.abs(q.y - p.y) > maxDy) continue;
        const d = q.distanceToSquared(p); if (d < best) { best = d; bi = i; }
      }
    }
    return bi;
  }
  // how far p is from the track's slab (the deck, the walls, the fields, the ships' way over it): < 0 inside
  clear(p, margin = 0) {
    const tr = this.track, i = this.nearest(p);
    if (i < 0) return 1e9;
    const d = p.clone().sub(tr.P[i]);
    // round a gravity flip: its rings and its tube (37 m round the way) and the half roll through them - a ball
    if (tr.inFlip?.(i * tr.step, 60)) return d.length() - (TRACK_W / 2 + 18 + margin);
    const x = Math.abs(d.dot(tr.R[i])), y = d.dot(tr.U[i]), along = Math.abs(d.dot(tr.T[i]));
    if (along > 30) return Math.min(1e9, d.length() - 30);
    const dx = x - (TRACK_W / 2 + 6 + margin), dy = y > 0 ? y - (26 + margin) : -y - (12 + margin);
    return Math.max(dx, dy);
  }
  // the least clearance of any vertex of a geometry (world positions)
  geometryClear(g, margin = 0, step = 1) {
    const p = g.attributes.position, v = new THREE.Vector3();
    let m = 1e9;
    for (let k = 0; k < p.count; k += step) { v.fromBufferAttribute(p, k); m = Math.min(m, this.clear(v, margin)); }
    return m;
  }
}

// ---------------------------------------------------------------- placement
// Crystal clusters: [{ c: Vector3 on the ice, n: crystals, size }] -> instanced crystals (each kept clear of the track)
export function crystalField(clusters, grid, ground, seed = 7) {
  const rnd = mulberry32(seed), M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const mats = [], cols = [], ax = new THREE.Vector3(), p = new THREE.Vector3();
  // mostly the ice's own cyan and a deep blue; now and then violet, sea-green, rarely magenta
  const HUES = [[0.08, 0.72, 1.0], [0.08, 0.72, 1.0], [0.06, 0.55, 1.0], [0.1, 0.85, 1.0], [0.15, 0.32, 1.0], [0.15, 0.32, 1.0],
    [0.45, 0.25, 1.0], [0.1, 0.95, 0.62], [0.85, 0.2, 1.0]].map((c) => new THREE.Color(...c));
  let dropped = 0;
  const pools = [];
  for (const cl of clusters) {
    const hue = HUES[Math.floor(rnd() * HUES.length)];
    const n0 = mats.length;
    for (let k = 0; k < cl.n; k++) {
      const L = cl.size * (0.35 + 0.65 * Math.pow(rnd(), 0.7)) * (k === 0 ? 1.25 : 1), r = L * (0.09 + rnd() * 0.07);
      // tilted out from the cluster's middle (the first one stands up)
      const az = rnd() * Math.PI * 2, tilt = k === 0 ? rnd() * 0.15 : 0.2 + rnd() * 0.75;
      ax.set(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
      const off = k === 0 ? 0 : cl.size * 0.12 * rnd();
      const bx = cl.c.x + Math.cos(az) * off, bz = cl.c.z + Math.sin(az) * off;
      p.set(bx, ground.height(bx, bz) - r * 0.3, bz);
      q.setFromUnitVectors(up, ax).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
      s.set(r, L, r);
      // clear of the track: its axis sampled every few metres, its girth as the margin
      let ok = true;
      for (let t = 0; t <= 1.0001 && ok; t += 0.05) if (grid.clear(p.clone().addScaledVector(ax, L * t), r * (1 - t * 0.7)) < 0) ok = false;
      if (!ok) { dropped++; continue; }
      mats.push(M.compose(p, q, s).clone());
      cols.push(hue.clone().multiplyScalar(0.75 + 0.5 * rnd()).lerp(HUES[Math.floor(rnd() * HUES.length)], 0.25 * rnd()));
    }
    if (mats.length > n0) pools.push({ x: cl.c.x, z: cl.c.z, r: cl.size * 0.75, col: hue, k: Math.min(1, (mats.length - n0) / 5) });
  }
  return { mats, cols, dropped, pools };
}

// ---------------------------------------------------------------- the glacier and its cave
// The track bores through a glacier between s0 and s1: a rough bore round the deck (scalloped, as meltwater leaves an
// ice cave; flaring at the mouths) and ONE body of ice round it, built in rows from the bore's entrance ring out over
// the mouth's face (the very same vertices: no seam), round a boxy body (cliffs, a broken top of seracs, crevasses
// down its walls) and back in over the exit's face onto the bore's exit ring. Icicles hang from the bore's roof, well
// over the ships' way.
const sgnPow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
export function glacier(track, s0, s1, { A = 280, B = 190, rimOut = 40, seed = 91 } = {}) {
  const rnd = mulberry32(seed), f = {};
  const len = track.wrap(s1 - s0), nk = Math.ceil(len / 3), nj = 64, pos = [], glow = [], idx = [];
  for (let k = 0; k <= nk; k++) {
    const s = s0 + (k / nk) * len, d = (k / nk) * len, flare = smoothstep(40, 0, Math.min(d, len - d));
    track.frame(s, f);
    for (let j = 0; j < nj; j++) {
      const a = (j / nj) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const n1 = fbm(ca * 1.6 + s * 0.012, sa * 1.6 - s * 0.009, 4), n2 = noise2(a * 7 + s * 0.11, s * 0.04 - a * 2);
      // scallops: dimples a few metres across all over the walls
      const sc = Math.pow(Math.abs(Math.sin(a * 11 + s * 0.21 + n2 * 3) * Math.sin(s * 0.17 - a * 5)), 0.5);
      const r = 31 + 10 * (n1 - 0.5) + 2.2 * sc + flare * 12;
      // (wide and low: the 56 m road and its barriers clear by ~8 m at the narrowest)
      const x = ca * r * 1.42, y = 5 + sa * r * 0.88;
      pos.push(f.P.x + f.R.x * x + f.U.x * y, f.P.y + f.R.y * x + f.U.y * y, f.P.z + f.R.z * x + f.U.z * y);
      glow.push(0.45 + 0.55 * flare + 0.25 * (n2 - 0.5));
    }
  }
  for (let k = 0; k < nk; k++) for (let j = 0; j < nj; j++) {
    const a = k * nj + j, b = k * nj + ((j + 1) % nj), d = a + nj, e = b + nj;
    idx.push(a, d, b, b, d, e);
  }
  const bore = new THREE.BufferGeometry();
  bore.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bore.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  bore.setIndex(idx);
  bore.computeVertexNormals();
  // the faces look into the bore (toward its centre line)
  track.frame(s0 + len / 2, f);
  const centre = f.P.clone().addScaledVector(f.U, 5), i0 = Math.floor(nk / 2) * nj;
  const vp = new THREE.Vector3().fromBufferAttribute(bore.attributes.position, i0), vn = new THREE.Vector3().fromBufferAttribute(bore.attributes.normal, i0);
  if (vn.dot(centre.clone().sub(vp)) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    bore.setIndex(idx); bore.computeVertexNormals();
  }
  // the body: its frame from the bore's end rings
  const ring = (k) => Array.from({ length: nj }, (_, j) => new THREE.Vector3().fromBufferAttribute(bore.attributes.position, k * nj + j));
  const r0 = ring(0), r1 = ring(nk);
  const A0 = r0.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(nj);
  const B0 = r1.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(nj);
  const O = A0.clone().add(B0).multiplyScalar(0.5), Z = B0.clone().sub(A0), half = Z.length() / 2;
  Z.normalize();
  const Y = new THREE.Vector3(0, 1, 0).addScaledVector(Z, -Z.y).normalize(), X = new THREE.Vector3().crossVectors(Z, Y);
  const drop = 30;                                        // (the body's foot pushed down, well under the ice)
  const SUB = 6, nc = nj * SUB;
  const fine = (rr) => Array.from({ length: nc }, (_, c) => rr[Math.floor(c / SUB)].clone().lerp(rr[(Math.floor(c / SUB) + 1) % nj], (c % SUB) / SUB));
  const f0 = fine(r0), f1 = fine(r1);
  const rimR = 115, thR = Math.asin(Math.min(0.95, rimR / A)), Rz = (half + rimOut) / Math.cos(thR);
  const dirL = new THREE.Vector3();
  let lastGlow = 0.3;
  const relief = (lx, ly, lz) => {
    dirL.set(lx, ly, lz).normalize();
    let h = 1 + 0.12 * (fbm3(dirL.x * 1.8 + 3.1, dirL.y * 1.8, dirL.z * 1.8 + 1.1, 4) - 0.5);
    // crevasses: deep slots down the walls, across the body
    const cv = Math.abs(Math.sin(dirL.z * 23 + 3 * fbm3(dirL.x * 3, dirL.y * 3, dirL.z * 3, 2)));
    const slot = smoothstep(0.93, 0.995, cv) * smoothstep(-0.3, 0.4, dirL.y);
    h -= 0.12 * slot;
    // seracs over the top: broken blocks
    const top = smoothstep(0.55, 0.85, dirL.y);
    h += top * 0.2 * Math.pow(fbm3(dirL.x * 11 + 7, dirL.y * 4, dirL.z * 11, 3), 2.0) * (0.6 + 0.4 * Math.sign(Math.sin(dirL.x * 40 + dirL.z * 31)));
    lastGlow = 0.25 + 0.6 * slot + 0.2 * (1 - top);
    return h;
  };
  const body = (th, phi) => {
    const cx = Math.cos(phi) * Math.sin(th), cy = Math.sin(phi) * Math.sin(th), cz = -Math.cos(th);
    // a boxy body: cliffs, a broad top
    const lx = sgnPow(cx, 0.3) * A, ly = sgnPow(cy, 0.32) * B, lz = sgnPow(cz, 0.35) * Rz;
    const h = relief(lx / A, ly / B, lz / Rz);
    return O.clone().addScaledVector(X, lx * h).addScaledVector(Y, ly * h - (ly < 0 ? drop * Math.min(1, -ly / B * 2) : 0)).addScaledVector(Z, lz * (0.94 + 0.06 * h));
  };
  const rows = [], grows = [];
  const crater = (ringPts, sign, rimTh) => {
    const out = [], og = [];
    const CR = 14;
    for (let i = 0; i < CR; i++) {
      const t = i / CR, tr2 = Math.pow(t, 0.8), tz = Math.sin(t * Math.PI / 2);
      const row = [], gr = [];
      ringPts.forEach((v, c) => {
        const rim = body(rimTh, (c / nc) * Math.PI * 2);
        const a = v.clone().sub(O), b = rim.clone().sub(O);
        const ax = a.dot(X), ay = a.dot(Y), az = a.dot(Z), bx = b.dot(X), by = b.dot(Y), bz = b.dot(Z);
        const x = ax + (bx - ax) * tr2, y = ay + (by - ay) * tr2, z = az + (bz - az) * tz;
        const jag = i === 0 ? 0 : (noise2(c * 0.21 + sign * 7, i * 0.7) - 0.5) * 7 * Math.sin(t * Math.PI);
        const radial = new THREE.Vector3(x, y, 0).normalize();
        row.push(O.clone().addScaledVector(X, x + radial.x * jag).addScaledVector(Y, y + radial.y * jag).addScaledVector(Z, z));
        gr.push(0.9 - 0.5 * t);
      });
      out.push(row); og.push(gr);
    }
    return [out, og];
  };
  {
    const [cr, cg] = crater(f0, -1, thR);
    rows.push(...cr); grows.push(...cg);
  }
  const BR = 150;
  for (let i = 0; i <= BR; i++) {
    const th = thR + (Math.PI - 2 * thR) * (i / BR), gr = [];
    rows.push(Array.from({ length: nc }, (_, c) => { const v = body(th, (c / nc) * Math.PI * 2); gr.push(lastGlow); return v; }));
    grows.push(gr);
  }
  {
    const [cr, cg] = crater(f1, 1, Math.PI - thR);
    rows.push(...cr.reverse()); grows.push(...cg.reverse());
  }
  const mp = [], mg = [], mi = [];
  rows.forEach((row, i) => row.forEach((v, c) => { mp.push(v.x, v.y, v.z); mg.push(grows[i][c]); }));
  for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < nc; c++) {
    const a = i * nc + c, b = i * nc + ((c + 1) % nc), d = a + nc, e = b + nc;
    mi.push(a, b, d, b, e, d);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  shell.setAttribute('glow', new THREE.Float32BufferAttribute(mg, 1));
  shell.setIndex(mi);
  shell.computeVertexNormals();
  // outward: a vertex on the body's equator must face away from its middle
  const ie = (14 + Math.floor(BR / 2)) * nc, ve = new THREE.Vector3().fromBufferAttribute(shell.attributes.position, ie), ne = new THREE.Vector3().fromBufferAttribute(shell.attributes.normal, ie);
  if (ne.dot(ve.clone().sub(O)) < 0) {
    for (let q = 0; q < mi.length; q += 3) { const t = mi[q + 1]; mi[q + 1] = mi[q + 2]; mi[q + 2] = t; }
    shell.setIndex(mi); shell.computeVertexNormals();
  }
  // icicles from the roof: where the bore's roof is 21 m and more over the deck, tips 15 m and more over it
  const ici = [], M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), down = new THREE.Vector3();
  for (let k = 2; k < nk - 2; k++) {
    const s = s0 + (k / nk) * len;
    track.frame(s, f);
    for (let j = 0; j < nj; j++) {
      if (rnd() > 0.32) continue;
      P.fromBufferAttribute(bore.attributes.position, k * nj + j);
      const up = P.clone().sub(f.P).dot(f.U);
      if (up < 21) continue;
      const L = Math.min(up - 15, 3 + 11 * Math.pow(rnd(), 1.7)), r = L * (0.07 + 0.05 * rnd());
      down.copy(f.U).negate();
      Qn.setFromUnitVectors(new THREE.Vector3(0, -1, 0), down).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28));
      ici.push(M.compose(P.clone().addScaledVector(f.U, 1.2), Qn, S.set(r, L, r)).clone());
    }
  }
  return { bore, shell, icicles: ici, O, X, Y, Z, half };
}

// an icicle (base at y = 0, its point at y = -1), for instancing
export function icicleGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 7, 4, true).rotateX(Math.PI).translate(0, -0.5, 0);
  const p = g.attributes.position, glow = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) glow[i] = 0.6 + 0.4 * Math.min(1, -p.getY(i));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  g.deleteAttribute('uv');
  return g;
}

// A frozen fall: a curtain of ice columns down a cliff - fluted, bulging over the ledges, its foot spreading in a
// frozen pool. top: Vector3 (the lip, middle), out: horizontal unit (away from the cliff), w wide, h tall
export function frozenFall(top, out, w, h, seed = 1) {
  const rnd = mulberry32(seed), nx = 48, ny = 64, pos = [], glow = [], idx = [];
  const side = new THREE.Vector3(-out.z, 0, out.x), ph = rnd() * 10;
  for (let i = 0; i <= ny; i++) {
    const t = i / ny, y = -t * h;
    const bulge = 4 + 6 * Math.pow(Math.sin(t * Math.PI * 2.3 + ph), 2) * (1 - t) + 18 * Math.pow(smoothstep(0.82, 1, t), 2);
    const wid = w * (0.55 + 0.45 * Math.sin(t * Math.PI * 0.9 + 0.3)) * (1 + 0.8 * smoothstep(0.85, 1, t));
    for (let j = 0; j <= nx; j++) {
      const u = j / nx - 0.5, x = u * wid;
      const flute = 1.6 * Math.abs(Math.sin(u * 30 + noise2(t * 5, j * 0.3) * 2)) + 2.2 * noise2(u * 9 + ph, t * 14);
      const edge = Math.pow(Math.cos(u * Math.PI), 0.6);          // thinning to the cliff at its sides
      const o = (bulge + flute) * edge;
      pos.push(top.x + side.x * x + out.x * o, top.y + y, top.z + side.z * x + out.z * o);
      glow.push(0.5 + 0.5 * (1 - edge) + 0.3 * smoothstep(0.3, 1, Math.abs(Math.sin(u * 30))));
    }
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, Math.floor(ny / 2) * (nx + 1) + nx / 2);
  if (n0.dot(out) < 0) { for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

export { mergeGeometries };
