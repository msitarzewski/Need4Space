// The city the sand took: towers of a future that ended - slabs and octagonal shafts with set-backs and fins, glass
// curtain walls between bands of pale panelling - leaning, their tops broken off, half buried, sand drifted against
// them; one fallen across the way, the track straight through its hollow length (its floors' edges ribs round the road,
// its windows lit by the sunset from inside); and two colossal stepped pyramids far off to the north-west.
// Every face carries its own coordinates in metres ('fac': along the face, up it, its kind), so the windows, panels and
// sand are drawn per pixel from them. Lit by the sun and the sky alone, and the world's shadow map.
import * as THREE from 'three';
import { Q } from './quality.js';
import { sunOnly } from './look.js';
import { mulberry32, noise2, smoothstep } from './noise.js';

// face kinds
export const GLASS = 0, PANEL = 1, BROKEN = 2, INSIDE = 3, STEP = 4;

// a mesh builder: quads with their own (u, v) in metres and a kind
class Builder {
  constructor() { this.pos = []; this.fac = []; this.idx = []; }
  // a quad a-b-c-d (counter-clockwise seen from outside), uv per corner
  quad(a, b, c, d, ua, ub, uc, ud, kind) {
    const o = this.pos.length / 3;
    for (const [p, u] of [[a, ua], [b, ub], [c, uc], [d, ud]]) { this.pos.push(p.x, p.y, p.z); this.fac.push(u[0], u[1], kind); }
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  tri(a, b, c, ua, ub, uc, kind) {
    const o = this.pos.length / 3;
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) { this.pos.push(p.x, p.y, p.z); this.fac.push(u[0], u[1], kind); }
    this.idx.push(o, o + 1, o + 2);
  }
  geometry(M) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('fac', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.idx);
    if (M) g.applyMatrix4(M);
    g.computeVertexNormals();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// one section of a shaft: a rectangle a x b (half sizes) with chamfered corners c, from y0 to y1; its sides split into
// columns ~6 m wide (the top's broken edge: top(u) gives each column's height, or null for a clean cut)
function shaft(B, a, b, c, y0, y1, top = null, kind = GLASS, fins = 0) {
  const ring = [V(a - c, 0, -b), V(a, 0, -b + c), V(a, 0, b - c), V(a - c, 0, b), V(-a + c, 0, b), V(-a, 0, b - c), V(-a, 0, -b + c), V(-a + c, 0, -b)];
  const cols = [];
  let u = 0;
  for (let k = 0; k < 8; k++) {
    const p = ring[k], q = ring[(k + 1) % 8], len = p.distanceTo(q), n = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < n; i++) cols.push({ p: p.clone().lerp(q, i / n), q: p.clone().lerp(q, (i + 1) / n), u0: u + (len * i) / n, u1: u + (len * (i + 1)) / n, chamfer: k % 2 === 0 });
    u += len;
  }
  const tops = cols.map((cl) => (top ? top(cl.u0) : y1));
  cols.forEach((cl, k) => {
    const t0 = tops[k], t1 = tops[(k + 1) % cols.length];
    const kd = cl.chamfer ? PANEL : kind;
    B.quad(V(cl.p.x, y0, cl.p.z), V(cl.q.x, y0, cl.q.z), V(cl.q.x, t1, cl.q.z), V(cl.p.x, t0, cl.p.z),
      [cl.u0, y0], [cl.u1, y0], [cl.u1, t1], [cl.u0, t0], kd);
  });
  // the top: a clean roof, or the broken floors (a fan down to the core, a dark jagged mess)
  const mid = top ? Math.min(...tops) - 6 : y1;
  cols.forEach((cl, k) => {
    const t0 = tops[k], t1 = tops[(k + 1) % cols.length];
    B.tri(V(cl.q.x, t1, cl.q.z), V(0, mid, 0), V(cl.p.x, t0, cl.p.z), [cl.q.x, cl.q.z], [0, 0], [cl.p.x, cl.p.z], top ? BROKEN : PANEL);
  });
  // fins up the faces' middles
  for (let f = 0; f < fins; f++) {
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const off = (f - (fins - 1) / 2) * 7, w = 0.6, d = 2.4;
      const cx = sx ? sx * a : off, cz = sz ? sz * b : off;
      const ax = sx ? V(0, 0, 1) : V(1, 0, 0), out = V(sx, 0, sz), ft = top ? Math.min(...tops) - 2 : y1 + 3;
      const c0 = V(cx, 0, cz);
      const P = (s, o, y) => c0.clone().addScaledVector(ax, s * w).addScaledVector(out, o * d).setY(y);
      B.quad(P(-1, 0, y0), P(-1, 1, y0), P(-1, 1, ft), P(-1, 0, ft), [0, y0], [d, y0], [d, ft], [0, ft], PANEL);
      B.quad(P(-1, 1, y0), P(1, 1, y0), P(1, 1, ft), P(-1, 1, ft), [0, y0], [2 * w, y0], [2 * w, ft], [0, ft], PANEL);
      B.quad(P(1, 1, y0), P(1, 0, y0), P(1, 0, ft), P(1, 1, ft), [0, y0], [d, y0], [d, ft], [0, ft], PANEL);
      B.quad(P(-1, 1, ft), P(1, 1, ft), P(1, 0, ft), P(-1, 0, ft), [0, 0], [1, 0], [1, 1], [0, 1], PANEL);
    }
  }
}

// A tower (local: base at the origin, y up): S { w, d, h, kind 0 slab / 1 octagonal / 2 stepped, sections, broken,
// seed, fins }; placed: its foot at (x, ground - sink, z), turned by rot and leaned (lean: radians, leanAz)
export function towerGeometry(S) {
  const rnd = mulberry32(S.seed), B = new Builder();
  let a = S.w / 2, b = S.d / 2, y = 0;
  const c = S.kind === 1 ? Math.min(a, b) * 0.42 : S.kind === 2 ? Math.min(a, b) * 0.12 : 1.2;
  const n = S.sections;
  for (let k = 0; k < n; k++) {
    const y1 = y + S.h * (k === n - 1 ? 1 - y / S.h : (0.5 + 0.2 * rnd()) / n * (n === 1 ? 2 : 1.6));
    const last = k === n - 1;
    const ph = rnd() * 50;
    const top = last && S.broken ? (u) => y1 - S.broken * (0.25 + 0.75 * noise2(u / 9 + ph, 1.3)) - (u % 12 < 3 ? S.broken * 0.4 : 0) : null;
    shaft(B, a, b, Math.min(c, a * 0.6, b * 0.6), y, Math.min(y1, S.h), top, GLASS, S.fins && k === 0 ? S.fins : 0);
    if (!last) {
      // a ledge where it steps back
      shaft(B, a + 1.2, b + 1.2, Math.min(c, a * 0.6, b * 0.6) + 0.6, y1 - 2.2, y1, null, PANEL);
    }
    y = y1;
    a *= 0.72 + 0.12 * rnd(); b *= 0.72 + 0.12 * rnd();
    if (y >= S.h - 1) break;
  }
  const M = new THREE.Matrix4().compose(V(S.x, S.ground - S.sink, S.z),
    new THREE.Quaternion().setFromAxisAngle(V(Math.cos(S.leanAz), 0, Math.sin(S.leanAz)), S.lean).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), S.rot)),
    V(1, 1, 1));
  return B.geometry(M);
}

// A stepped pyramid: tiers of a square (half size a at the foot) up to h, each riser glass-banded, each tread sand;
// its foot at ground - sink, turned by rot
export function pyramidGeometry({ x, z, a, h, tiers, ground, sink, rot }) {
  const B = new Builder();
  for (let k = 0; k < tiers; k++) {
    const y0 = (h * k) / tiers, y1 = (h * (k + 1)) / tiers, s0 = a * (1 - k / tiers), s1 = a * (1 - (k + 1) / tiers) + a / tiers * 0.35;
    const r = s0 - a / tiers * 0.15;
    const sq = (s) => [V(s, 0, -s), V(s, 0, s), V(-s, 0, s), V(-s, 0, -s)];
    const lo = sq(r), hi = sq(s1), tread = sq(s0);
    for (let i = 0; i < 4; i++) {
      const p = lo[i], q = lo[(i + 1) % 4], P2 = hi[i], Q2 = hi[(i + 1) % 4], L = 2 * r;
      // the riser: steep, glass bands
      B.quad(V(p.x, y0, p.z), V(q.x, y0, q.z), V(Q2.x, y1, Q2.z), V(P2.x, y1, P2.z), [0, y0], [L, y0], [L, y1], [0, y1], GLASS);
      // the tread at its foot (sand on it)
      const T0 = tread[i], T1 = tread[(i + 1) % 4];
      if (k > 0) B.quad(V(T0.x, y0, T0.z), V(T1.x, y0, T1.z), V(q.x, y0, q.z), V(p.x, y0, p.z), [0, 0], [1, 0], [1, 1], [0, 1], STEP);
    }
  }
  // the cap
  const s = a / tiers * 0.35;
  B.quad(V(s, h, -s), V(-s, h, -s), V(-s, h, s), V(s, h, s), [0, 0], [1, 0], [1, 1], [0, 1], PANEL);
  const M = new THREE.Matrix4().compose(V(x, ground - sink, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rot), V(1, 1, 1));
  return B.geometry(M);
}

// The fallen tower the track runs through (straight between s0 and s1): its shell lying along the way (facades of
// windows, both ends torn off ragged) and its hollow inside round the deck - the floors' edges as ribs every 4.2 m,
// the window openings between them. Returns { shell, bore } (world)
export function fallenTower(track, s0, s1, { half = 46, below = 17, above = 52, wall = 3 } = {}) {
  const f = {}, rnd = mulberry32(77);
  track.frame(s0, f);
  const A = f.P.clone(), T = track.frame(s1).P.clone().sub(A), len = T.length();
  T.normalize();
  const Up = V(0, 1, 0), R = V().crossVectors(T, Up).normalize(), U = V().crossVectors(R, T).normalize();
  const base = A.clone();                             // the deck's height at the entry: the tube's frame
  const W = (x, y, s) => base.clone().addScaledVector(R, x).addScaledVector(U, y).addScaledVector(T, s);
  const jag = (s, k) => 10 * noise2(k * 0.37 + s * 0.01, s * 3.1) + 6 * noise2(k * 1.3, s);
  // the cross-section's corners (x, y), round from the floor's left
  const sec = [[-half, -below], [half, -below], [half, above], [-half, above]];
  const shellB = new Builder(), boreB = new Builder();
  const per = sec.map((p, i) => { const q = sec[(i + 1) % 4]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
  // ---- the shell: four facades, out by the wall's thickness, each split into columns ~8 m round and rows along
  const S0 = -30, S1 = len + 12;
  for (let side = 0; side < 4; side++) {
    const [px, py] = sec[side], [qx, qy] = sec[(side + 1) % 4];
    const nx = (qy - py) / per[side], ny = -(qx - px) / per[side];          // outward
    const n = Math.max(2, Math.round(per[side] / 8));
    let u0 = per.slice(0, side).reduce((x, y) => x + y, 0);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, k0 = side * 40 + i, k1 = side * 40 + i + 1;
      const x0 = px + (qx - px) * t0 + nx * wall, y0 = py + (qy - py) * t0 + ny * wall, x1 = px + (qx - px) * t1 + nx * wall, y1 = py + (qy - py) * t1 + ny * wall;
      // ragged ends: each column's own length
      const a0 = S0 + jag(0, k0), a1 = S0 + jag(0, k1), b0 = S1 - jag(1, k0), b1 = S1 - jag(1, k1);
      const ua = u0 + per[side] * t0, ub = u0 + per[side] * t1;
      // (the facade's floors run along the way now: u = along, v = round)
      shellB.quad(W(x0, y0, a0), W(x0, y0, b0), W(x1, y1, b1), W(x1, y1, a1), [a0, ua], [b0, ua], [b1, ub], [a1, ub], GLASS);
      // the torn ends: the wall's thickness
      const ix0 = x0 - nx * wall, iy0 = y0 - ny * wall, ix1 = x1 - nx * wall, iy1 = y1 - ny * wall;
      shellB.quad(W(ix0, iy0, a0), W(x0, y0, a0), W(x1, y1, a1), W(ix1, iy1, a1), [0, 0], [wall, 0], [wall, 8], [0, 8], BROKEN);
      shellB.quad(W(x0, y0, b0), W(ix0, iy0, b0), W(ix1, iy1, b1), W(x1, y1, b1), [0, 0], [wall, 0], [wall, 8], [0, 8], BROKEN);
    }
  }
  // ---- the bore: the inside faces, ribs (the floors' edges) every 4.2 m standing in 1.4 m
  const ribs = [];
  for (let s = S0 + 14; s < S1 - 14; s += 4.2) ribs.push(s);
  for (let side = 0; side < 4; side++) {
    const [px, py] = sec[side], [qx, qy] = sec[(side + 1) % 4];
    const nx = -(qy - py) / per[side], ny = (qx - px) / per[side];          // inward
    const n = Math.max(2, Math.round(per[side] / 8));
    let u0 = per.slice(0, side).reduce((x, y) => x + y, 0);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, k0 = side * 40 + i, k1 = side * 40 + i + 1;
      const x0 = px + (qx - px) * t0, y0 = py + (qy - py) * t0, x1 = px + (qx - px) * t1, y1 = py + (qy - py) * t1;
      const a0 = S0 + jag(0, k0), a1 = S0 + jag(0, k1), b0 = S1 - jag(1, k0), b1 = S1 - jag(1, k1);
      const ua = u0 + per[side] * t0, ub = u0 + per[side] * t1;
      // the inner face (seen from inside: wound the other way), kind INSIDE, v = which side (0 floor, 1 right, 2 roof, 3 left)
      boreB.quad(W(x0, y0, a0), W(x1, y1, a1), W(x1, y1, b1), W(x0, y0, b0), [a0, side], [a1, side], [b1, side], [b0, side], INSIDE);
      // the ribs across it: a box section standing in from the face
      for (const s of ribs) {
        const ra = s, rb = s + 0.9, d = 1.4;
        const p0 = [x0 + nx * d, y0 + ny * d], p1 = [x1 + nx * d, y1 + ny * d];
        boreB.quad(W(x0, y0, ra), W(x1, y1, ra), W(p1[0], p1[1], ra), W(p0[0], p0[1], ra), [ua, 0], [ub, 0], [ub, d], [ua, d], PANEL);
        boreB.quad(W(p0[0], p0[1], ra), W(p1[0], p1[1], ra), W(p1[0], p1[1], rb), W(p0[0], p0[1], rb), [ua, 0], [ub, 0], [ub, 0.9], [ua, 0.9], PANEL);
        boreB.quad(W(p0[0], p0[1], rb), W(p1[0], p1[1], rb), W(x1, y1, rb), W(x0, y0, rb), [ua, d], [ub, d], [ub, 0], [ua, 0], PANEL);
      }
    }
  }
  return { shell: shellB.geometry(), bore: boreB.geometry(), A, T, R, U, len, half, below, above };
}

// ---------------------------------------------------------------- the material
const GLSL_N = /* glsl */`
float ruH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float ruH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ruN3(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(ruH3(i), ruH3(i + vec3(1, 0, 0)), u.x), mix(ruH3(i + vec3(0, 1, 0)), ruH3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(ruH3(i + vec3(0, 0, 1)), ruH3(i + vec3(1, 0, 1)), u.x), mix(ruH3(i + vec3(0, 1, 1)), ruH3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}`;

// The ruins' material. inside: the fallen tower's hollow (the ships' lights reach it; its windows lit from outside by
// the sunset - the west side amber, the roof's the sky's rose, the east side dim)
export function ruinMaterial({ key = 'ruin', inside = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
  if (inside) mat.envMapIntensity = 0;
  else mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  mat.onBeforeCompile = (sh) => {
    const lite = Q.lite ? '#define RU_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 fac; varying vec3 vFac; varying vec3 vRW; varying vec3 vRN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vFac = fac; vRW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = lite + sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFac; varying vec3 vRW; varying vec3 vRN;
${GLSL_N}
float ruGlass = 0.0, ruSand = 0.0;
vec3 ruGlow = vec3(0.0);`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float kind = floor(vFac.z + 0.5);
    vec2 m = vFac.xy;
    vec3 rn = normalize(vRN);
    float weather = ruN3(vRW * 0.02) * 0.6 + ruN3(vRW * 0.11) * 0.4;
    vec3 panel = mix(vec3(0.34, 0.31, 0.27), vec3(0.5, 0.45, 0.38), weather) ;
    vec3 c = panel;
    if (kind < 0.5) {
      // the curtain wall: floors every 4.2 m, mullions every 3 m; a band of panelling at each floor's slab
      vec2 cell = vec2(m.x / 3.0, m.y / 4.2), id = floor(cell), f = fract(cell);
      float aw = max(fwidth(cell.x), fwidth(cell.y));
      float frame = max(smoothstep(0.92 - aw, 0.92, f.x), smoothstep(0.7 - aw, 0.7, f.y));
      float far = smoothstep(0.25, 0.6, aw);                 // (finer than the pixels: their average)
      float r = ruH(id + floor(vRW.xz / 400.0) * 7.0);
      vec3 glass = vec3(0.025, 0.03, 0.035);
      float broken = step(0.86, r);
      glass = mix(glass, vec3(0.008, 0.006, 0.005), broken);
      c = mix(mix(glass, panel * 0.85, frame), mix(glass, panel * 0.85, 0.42), far);
      ruGlass = (1.0 - frame) * (1.0 - far) * (1.0 - broken) + far * 0.5;
      // now and then a window still lit
      ruGlow = vec3(1.0, 0.55, 0.22) * step(0.996, r) * (1.0 - frame) * (1.0 - far) * 1.1;
    } else if (kind < 1.5) {
      c = panel * (0.9 + 0.2 * step(0.5, fract(m.y / 2.1)));
    } else if (kind < 2.5) {
      c = vec3(0.12, 0.1, 0.09) * (0.6 + 0.8 * weather);      // the broken floors: concrete, rebar, the dark inside
    } else if (kind < 3.5) {
      // the hollow inside: soot-dark walls, the window openings between the floors' ribs lit from outside
      float rib = fract((m.x - 14.0) / 4.2);
      float win = smoothstep(0.34, 0.4, rib) * smoothstep(0.8, 0.74, rib);
      // the openings: 2.2 m wide between the mullions, most still blind (panels, dust); the glazing gone in some
      float cu = (vRW.y + vRW.x * 0.7 + vRW.z * 0.7) / 3.0;
      float col = smoothstep(0.18, 0.26, fract(cu)) * smoothstep(0.92, 0.84, fract(cu));
      float sideK = m.y;
      vec3 light = sideK < 0.5 ? vec3(0.18, 0.07, 0.025) : sideK < 1.5 ? vec3(0.22, 0.1, 0.14) : sideK < 2.5 ? vec3(0.6, 0.28, 0.2) : vec3(1.7, 0.72, 0.22);
      float open = step(0.62, ruH(floor(vec2((m.x - 14.0) / 4.2, cu)) + sideK * 7.0));
      // a stretch of the hollow where the floors fell in: dark
      float rubble = smoothstep(0.55, 0.7, ruN3(vec3(m.x * 0.02, sideK, 0.0)));
      c = vec3(0.05, 0.045, 0.04) * (0.6 + 0.8 * weather);
      ruGlow = light * win * col * open * (1.0 - rubble) * (0.6 + 0.8 * ruN3(vRW * 0.05));
    } else {
      c = vec3(0.5, 0.29, 0.14);                                // a pyramid's tread: sand
    }
    // sand on whatever looks up, and up the walls from the dunes; sand-blasted and stained low down
    float up = rn.y + (ruN3(vRW * 0.15) - 0.5) * 0.4;
    ruSand = max(smoothstep(0.55, 0.8, up), kind > 3.5 ? 1.0 : 0.0);
    c = mix(c, c * vec3(1.15, 0.95, 0.75), 0.4 * smoothstep(0.4, 0.8, weather));
    vec3 sandC = vec3(0.5, 0.3, 0.15) * (0.85 + 0.3 * weather);
    diffuseColor.rgb = mix(c, sandC, ruSand);
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(0.62, 0.12, ruGlass), 0.93, ruSand);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(0.15, 0.5, ruGlass) * (1.0 - ruSand);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += ruGlow;');
    if (!inside) sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `desert-${key}-${inside}-${Q.lite}`;
  return mat;
}
