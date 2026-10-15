// The kraken off the start: a giant squid lying on the level crown of a sea stack ahead and to the left of the grid,
// looking out at the track. Its head rests on the rim, two great eyes glowing; its mantle lies back over the crown and
// rises behind it to the fins. Six arms and a tentacle grip down the rock into the sea, two arms and the other
// tentacle are raised, curling slowly. Over minutes it creeps a way round the rock and back, its arms trailing; the
// mantle breathes, the fins ripple, dark clouds pass over its skin and faint lights pulse out along it. Everything
// moves on the GPU from the clock: each shape is built along its own line (the mantle's spine, each arm's) and the
// shaders lay those lines on the rock (a table of its surface, angle x height, in a texture)
import * as THREE from 'three';
import { LIFE_U } from './sealife.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const NU = 150, NV = 14;                        // an arm's segments along and round
const K = 1.35;                                 // its size (1: a mantle 62 m long)
const ML = 62 * K;                              // the mantle's length, the front of the head to the tip (m)

// its girth along the mantle (s 0 the front of the head .. 1 the tip): the head, the neck, the mantle's collar, then
// widest and tapering to the tip
function prof(s) { return K * prof1(s); }
function prof1(s) {
  if (s < 0.1) return 4.2 + 1.6 * Math.sin((s / 0.1) * Math.PI / 2);
  if (s < 0.14) return 5.8 - 0.5 * Math.sin(((s - 0.1) / 0.04) * Math.PI / 2);
  if (s < 0.17) return 5.3 + 2.4 * Math.sin(((s - 0.14) / 0.03) * Math.PI / 2);
  if (s < 0.32) return 7.7 + 0.8 * Math.sin(((s - 0.17) / 0.15) * Math.PI / 2);
  return 0.5 + 8.0 * Math.pow(1 - (s - 0.32) / 0.68, 0.8);
}

// the arms, round the mouth from its side (0 deg) over its top (90) and down under it (-90). Those down the rock: how
// far round it they reach (rad), their end's height (above the sea: the tip lifts off the stone), how far behind the
// head they follow it as it creeps (s). Those raised: their start (out from the rock, up, round it), the way they bend,
// how much at first and how much they curl at the end, how far they sway and how fast
const ARMS = [
  { at: -10, L: 118, r: 2.0, reach: 1.5, end: 16, lag: 34 },
  { at: -40, L: 116, r: 2.3, reach: 0.95, end: -14, lag: 26 },
  { at: -68, L: 112, r: 2.4, reach: 0.42, end: -14, lag: 20 },
  { at: -90, L: 115, r: 1.05, tent: 1, reach: -0.06, end: -16, lag: 16 },
  { at: -112, L: 112, r: 2.4, reach: -0.42, end: -14, lag: 20 },
  { at: -140, L: 116, r: 2.3, reach: -0.95, end: -14, lag: 26 },
  { at: -170, L: 118, r: 2.0, reach: -1.5, end: 22, lag: 34 },
  { up: 1, at: 35, L: 62, r: 2.0, d0: [0.45, 0.85, 0.35], n: [0.3, -0.6, 0.75], bend: 0.6, curl: 1.9, sway: 0.3, rate: 0.15 },
  { up: 1, at: 170, L: 56, r: 2.0, d0: [0.9, 0.3, -0.35], n: [0, 1, 0], bend: 0.2, curl: 2.4, sway: 0.28, rate: 0.13 },
  { up: 1, at: 125, L: 96, r: 1.2, tent: 1, d0: [-0.3, 1, -0.5], n: [1, 0, 0.25], bend: -0.2, curl: 2.7, sway: 0.3, rate: 0.11 },
];
const NA = ARMS.length;

// a lit material whose vertices its shader places (place: GLSL setting 'transformed' and 'objectNormal' in world
// space); a matt, wet skin - not a mirror
function squidMaterial({ key, uniforms, pars, place, color, emissive, rough = '', fpars = '' }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE_U, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float lTime;
${SQ_V}
${pars}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
	vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 transformed = vec3(position);
${place}`)
      .replace('#include <begin_vertex>', '');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float lTime;
${SKIN}
${fpars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  ${color}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  ${rough}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${emissive}
  // (a faint sheen at its edges, so it stands out from the dark rock)
  totalEmissiveRadiance += vec3(0.035, 0.025, 0.04) * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);`);
  };
  m.customProgramCacheKey = () => 'squid-' + key;
  return m;
}

// where it is: the rock, its surface, its crown; where the squid looks out from, how far it creeps round and how fast
const SQ_V = /* glsl */`
uniform vec3 sqC;
uniform sampler2D sqRock;
uniform vec4 sqY, sqP;
const float sqK = ${K.toFixed(3)};
vec3 sqRockAt(float a, float y) { return texture2D(sqRock, vec2(a / 6.2831853, clamp((y - sqY.x) / (sqY.y - sqY.x), 0.0, 1.0))).rgb; }
float sqAng(float lag) { return sqP.x + sqP.y * sin(sqP.z * (lTime - lag)); }
vec3 sqEr(float a) { return vec3(cos(a), 0.0, sin(a)); }
vec3 sqEp(float a) { return vec3(-sin(a), 0.0, cos(a)); }
// the mantle's line: in from the front of the head over the crown, then rising behind it to the tip; swinging a little
// to the side toward its end, slowly
vec3 sqDir(float s, vec3 er, vec3 ep) {
  float al = 1.02 * smoothstep(0.34, 0.95, s) + 0.08 * sin(lTime * 0.13) * smoothstep(0.5, 1.0, s);
  float be = 0.16 * sin(lTime * 0.083) * smoothstep(0.4, 1.0, s);
  return (ep * sin(be) - er * cos(be)) * cos(al) + vec3(0.0, sin(al), 0.0);
}
// its place and frame at s (R: its girth there - its underside lies on the stone): T along it to the tip, D up its
// back, S to its side
void sqSpine(float s, float R, out vec3 P, out vec3 T, out vec3 S, out vec3 D) {
  float a = sqAng(0.0);
  vec3 er = sqEr(a), ep = sqEp(a);
  float crown = sqRockAt(a, sqY.y).b, rim = length(sqRockAt(a, crown - 1.0).rg);
  P = sqC + er * (rim + 2.0 * sqK) + vec3(0.0, crown + 4.06 * sqK, 0.0);
  if (s > 0.0) {
    float ds = s * 0.1;
    for (int i = 0; i < 10; i++) P += sqDir((float(i) + 0.5) * ds, er, ep) * (ds * sqY.z);
  }
  P.y += 0.72 * (R - 5.8 * sqK) * (1.0 - smoothstep(0.35, 0.7, s));
  T = sqDir(s, er, ep);
  D = normalize(vec3(0.0, 1.0, 0.0) - T * T.y);
  S = cross(D, T);
}`;

// the skin: deep maroon, mottled and freckled, dark clouds drifting over it; paler underneath. And its lights: a few
// in each patch of skin, at random, of random sizes
const SKIN = /* glsl */`
float sqH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sqN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(sqH(i), sqH(i + vec2(1, 0)), u.x), mix(sqH(i + vec2(0, 1)), sqH(i + vec2(1, 1)), u.x), u.y); }
vec3 sqSkin(vec2 q, float back) {
  float n = sqN(q * 1.3) * 0.6 + sqN(q * 4.1) * 0.4;
  vec3 c = mix(vec3(0.075, 0.01, 0.014), vec3(0.15, 0.022, 0.045), n);
  c = mix(c, vec3(0.03, 0.005, 0.009), smoothstep(0.62, 0.8, sqN(q * 2.3 + 7.0)) * 0.8);
  c *= 0.8 + 0.4 * smoothstep(0.72, 0.9, sqN(q * 13.0));
  c *= 0.7 + 0.3 * smoothstep(-0.3, 0.7, sin(q.x * 0.3 - lTime * 0.4 + n * 3.0));
  return mix(vec3(0.2, 0.11, 0.1), c, back);
}
float sqSpots(vec2 p, float dens) {
  vec2 i = floor(p), f = fract(p);
  vec2 c = vec2(0.25 + 0.5 * sqH(i + 3.1), 0.25 + 0.5 * sqH(i + 7.7));
  float r = 0.1 + 0.13 * sqH(i + 11.3);
  return step(1.0 - dens, sqH(i)) * smoothstep(r, r * 0.35, length(f - c));
}`;

// the mantle and the head in one shell, with the fins and the eyes: each vertex at its place along the spine (s) and
// its offset in the spine's frame there (side, back, along), placed by the shader
function mantleGeometry() {
  const pos = [], nrm = [], sA = [], oA = [], pA = [], idx = [];
  // one piece: verts [side, back, along (beyond s), s, fin span]; tris [a, b, c, out?] (each face turned outward:
  // out, or out(centre)); normals given, or worked out from its faces
  const piece = (verts, tris, { part, normals = null, out = null }) => {
    const b = pos.length / 3, V = (i) => new THREE.Vector3(verts[i][0], verts[i][1], verts[i][2] + verts[i][3] * ML), tri = [];
    for (const [a, c, d, o] of tris) {
      const w = o || out?.(V(a).add(V(c)).add(V(d)).multiplyScalar(1 / 3));
      const n = V(c).sub(V(a)).cross(V(d).sub(V(a)));
      tri.push(...(w && n.dot(w) < 0 ? [a, d, c] : [a, c, d]));
    }
    let nn = normals;
    if (!nn) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flatMap((_, i) => V(i).toArray()), 3));
      g.setIndex(tri);
      g.computeVertexNormals();
      nn = g.attributes.normal.array;
    }
    verts.forEach((v, i) => {
      pos.push(...V(i).toArray()); oA.push(v[0], v[1], v[2]); sA.push(v[3], prof(v[3]), v[4] || 0); pA.push(part);
      nrm.push(nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]);
    });
    for (const t of tri) idx.push(t + b);
  };
  const fromGeo = (g, s, part) => {
    const P = g.attributes.position, N = g.attributes.normal, v = [], t = [], I = g.index.array;
    for (let i = 0; i < P.count; i++) v.push([P.getX(i), P.getY(i), P.getZ(i), s, 0]);
    for (let i = 0; i < I.length; i += 3) t.push([I[i], I[i + 1], I[i + 2]]);
    piece(v, t, { part, normals: N.array });
  };
  // the body: rings along it, flatter underneath (it lies on that); the front of the head closed in a dome (the arms
  // come out of it), the tip in a point
  {
    const NS = 96, NR = 40, v = [], t = [], fl = (sn) => (sn < 0 ? 0.75 : 1);
    for (let i = 0; i <= NS; i++) {
      const s = i / NS, R = prof(s);
      for (let j = 0; j < NR; j++) { const a = (j / NR) * TAU, sn = Math.sin(a); v.push([R * Math.cos(a), R * sn * fl(sn), 0, s]); }
    }
    const R0 = prof(0);
    for (let k = 1; k <= 4; k++) {
      const q = (k / 5) * Math.PI / 2;
      for (let j = 0; j < NR; j++) { const a = (j / NR) * TAU, sn = Math.sin(a); v.push([R0 * Math.cos(q) * Math.cos(a), R0 * Math.cos(q) * sn * fl(sn), -2.4 * K * Math.sin(q), 0]); }
    }
    const apex = v.length; v.push([0, 0, -2.4 * K, 0]);
    const tip = v.length; v.push([0, 0, 1.2 * K, 1]);
    const ring = (i, j) => i * NR + (j % NR), dome = (k, j) => (k === 0 ? ring(0, j) : ring(NS + k, j));
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) t.push([ring(i, j), ring(i, j + 1), ring(i + 1, j)], [ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j)]);
    for (let k = 0; k < 4; k++) for (let j = 0; j < NR; j++) t.push([dome(k, j), dome(k, j + 1), dome(k + 1, j)], [dome(k, j + 1), dome(k + 1, j + 1), dome(k + 1, j)]);
    for (let j = 0; j < NR; j++) t.push([dome(4, j), dome(4, j + 1), apex], [ring(NS, j), ring(NS, j + 1), tip]);
    piece(v, t, { part: 0, out: (c) => new THREE.Vector3(c.x, c.y, c.z < 0.01 ? c.z : c.z > ML - 0.01 ? c.z - ML : 0) });
  }
  // the fins: a broad blade either side of the last third, rooted in the mantle, thinning to its edge
  for (const sd of [-1, 1]) {
    const NF = 26, NW = 9, v = [], t = [], at = (i, k, top) => (i * (NW + 1) + k) * 2 + (top ? 0 : 1);
    for (let i = 0; i <= NF; i++) {
      const s = 0.7 + (i / NF) * 0.295, u = (s - 0.7) / 0.295, F = 10.5 * K * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.7), x0 = prof(s) * 0.8;
      for (let k = 0; k <= NW; k++) {
        // (no thicker at its root than the mantle there: it goes into it)
        const w = k / NW, ht = Math.min(((0.12 + 0.45 * (1 - w)) * Math.min(1, F / 3) + 0.04) * K, 0.4 * prof(s));
        v.push([sd * (x0 + w * F), ht, 0, s, w], [sd * (x0 + w * F), -ht, 0, s, w]);
      }
    }
    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0), edge = new THREE.Vector3(sd, 0, 0);
    for (let i = 0; i < NF; i++) {
      for (let k = 0; k < NW; k++) {
        t.push([at(i, k, 1), at(i, k + 1, 1), at(i + 1, k, 1), up], [at(i, k + 1, 1), at(i + 1, k + 1, 1), at(i + 1, k, 1), up]);
        t.push([at(i, k, 0), at(i, k + 1, 0), at(i + 1, k, 0), down], [at(i, k + 1, 0), at(i + 1, k + 1, 0), at(i + 1, k, 0), down]);
      }
      t.push([at(i, NW, 1), at(i, NW, 0), at(i + 1, NW, 1), edge], [at(i, NW, 0), at(i + 1, NW, 0), at(i + 1, NW, 1), edge]);
    }
    piece(v, t, { part: 2 });
  }
  // the eyes: great spheres set into the sides of the head, looking out and forward, a rim of skin round each
  for (const sd of [-1, 1]) {
    const se = 0.075, c = new THREE.Vector3(sd * prof(se) * 0.8, 0.9 * K, 0), look = new THREE.Vector3(sd * 0.8, 0.2, -0.56).normalize();
    fromGeo(new THREE.SphereGeometry(2.7 * K, 32, 20).translate(c.x, c.y, c.z), se, 1);
    const lid = new THREE.TorusGeometry(Math.sqrt(2.7 * 2.7 - 1.25 * 1.25) * K, 0.5 * K, 12, 40)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), look));
    const lc = c.clone().addScaledVector(look, 1.25 * K);
    fromGeo(lid.translate(lc.x, lc.y, lc.z), se, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sA, 3));
  g.setAttribute('aO', new THREE.Float32BufferAttribute(oA, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(pA, 1));
  g.setIndex(idx);
  return g;
}

export class GiantSquid {
  // rockTex: the rock's surface (dx, dz from its axis at x, z) by angle (u) and height (v: y0 .. y1), its crown's
  // height in b; face: the angle round the rock it looks out at
  constructor(scene, { x, z, rockTex, y0, y1, face }) {
    const V4 = (a, b, c, d) => new THREE.Vector4(a, b, c, d);
    this.U = {
      sqC: { value: new THREE.Vector3(x, 0, z) }, sqRock: { value: rockTex },
      sqY: { value: V4(y0, y1, ML, 0) },
      // (it creeps 0.55 rad either way round the rock and back, over about 200 s)
      sqP: { value: V4(face, 0.55, TAU / 200, 0) },
      sqA: { value: [] }, sqB: { value: [] }, sqD: { value: [] }, sqN: { value: [] },
    };
    // per arm - A: raised?, its place round the mouth, length, root girth; B: (down the rock) reach, end height, phase,
    // lag | (raised) bend, curl, phase, sway; D: start direction, tentacle?; N: the way it bends, sway rate
    ARMS.forEach((m, k) => {
      const ph = k * 2.39;
      this.U.sqA.value.push(V4(m.up ? 1 : 0, m.at * DEG, m.L * (m.up ? K : 1), m.r * K));
      this.U.sqB.value.push(m.up ? V4(m.bend, m.curl, ph, m.sway) : V4(m.reach, m.end, ph, m.lag));
      this.U.sqD.value.push(V4(...(m.d0 || [0, 0, 0]), m.tent ? 1 : 0));
      this.U.sqN.value.push(V4(...(m.n || [0, 0, 0]), m.rate || 0));
    });
    // ---- the arms: tubes, each vertex its place along (u) and round (v: from the inner side's middle, round) and its arm
    {
      const uv = [], arm = [], idx = [];
      for (let k = 0; k < NA; k++) {
        const b = uv.length / 2;
        for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) { uv.push(i / NU, Math.PI + (j / NV) * TAU); arm.push(k); }
        for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
          const a = b + i * (NV + 1) + j, c = a + 1, d = a + NV + 1, e = d + 1;
          idx.push(a, c, d, c, e, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(arm.length * 3), 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(arm.length * 3), 3));
      g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aArm', new THREE.Float32BufferAttribute(arm, 1));
      g.setIndex(idx);
      const mat = squidMaterial({
        key: 'arms', uniforms: this.U,
        pars: /* glsl */`
uniform vec4 sqA[${NA}], sqB[${NA}], sqD[${NA}], sqN[${NA}];
attribute vec2 aUV; attribute float aArm; varying vec2 vUV; varying float vArm, vOut, vLen, vSuck;
float sqArmR(float u, int k) {
  vec4 A = sqA[k];
  float r = sqD[k].w > 0.5 ? A.w * (1.0 - 0.45 * u) + A.w * 0.85 * exp(-pow((u - 0.9) / 0.045, 2.0))      // a tentacle: thin, its club
                           : A.w * pow(1.0 - 0.9 * u, 0.9);
  return r * mix(1.0, 0.06, smoothstep(0.955, 1.0, u)) + 0.04;
}
// down the rock: from its root at the mouth over the rim and down the stone, reaching round it, trailing behind the
// head as it creeps and rippling; the tips of those that end above the sea lift off the stone and curl
vec3 sqArmRock(float u, int k, vec3 root, vec3 dir, float r) {
  vec4 A = sqA[k], B = sqB[k];
  float t = lTime;
  float a = sqAng(B.w * u) + B.x * pow(min(u / 0.65, 1.0), 0.75) + 0.1 * sin(u * 7.0 + B.z + t * 0.05) * u;
  float crown = sqRockAt(a, sqY.y).b;
  float y = mix(crown - 3.0, B.y, u) + 1.2 * sin(u * 9.0 - t * 0.35 + B.z) * u * (1.0 - u);
  float rr = length(sqRockAt(a, y).rg) + r * 0.72 + 0.25 + 0.15 * sin(u * 26.0 - t * 0.7 + B.z) * smoothstep(0.1, 0.3, u);
  float lift = step(0.0, B.y) * smoothstep(0.72, 1.0, u) * (6.0 + 2.5 * sin(t * 0.21 + B.z)) * sqK;
  rr += lift;
  y += lift * (0.5 + 0.4 * sin(t * 0.17 + B.z * 2.0));
  vec3 p = sqC + sqEr(a) * rr + vec3(0.0, y, 0.0);
  return mix(root + dir * (u * A.z), p, smoothstep(0.0, 0.13, u));
}
// raised: from its root along a line that bends one way, curls at its end and sways, the way it bends turning a little
// (a slow wave running along it too, bending it in S curves)
float sqTh(float w, vec4 B, float rate) {
  return B.x * w + B.y * w * w * w + B.w * (sin(lTime * rate + B.z + w * 2.5) * w + 0.9 * sin(w * 6.0 - lTime * rate * 1.7 + B.z) * w * (1.0 - w));
}
vec3 sqArmUp(float u, int k, vec3 root, mat3 Bs, out vec3 T, out vec3 Nin) {
  vec4 A = sqA[k], B = sqB[k];
  vec3 d0 = normalize(Bs * sqD[k].xyz), n = Bs * sqN[k].xyz;
  n = normalize(n - d0 * dot(n, d0));
  float ps = 0.35 * sin(lTime * 0.05 + B.z);
  n = n * cos(ps) + cross(d0, n) * sin(ps);
  float rate = sqN[k].w, ds = u / 16.0;
  vec3 p = root;
  for (int i = 0; i < 16; i++) { float th = sqTh((float(i) + 0.5) * ds, B, rate); p += (cos(th) * d0 + sin(th) * n) * (ds * A.z); }
  float th = sqTh(u, B, rate);
  T = cos(th) * d0 + sin(th) * n;
  Nin = cos(th) * n - sin(th) * d0;
  return p;
}`,
        place: /* glsl */`
  int k = int(aArm + 0.5);
  float u = aUV.x, v = aUV.y;
  vec3 P0, T0, S0, D0;
  sqSpine(0.0, 4.2 * sqK, P0, T0, S0, D0);
  vec4 A = sqA[k];
  vec3 ring = cos(A.y) * S0 + sin(A.y) * D0;
  vec3 root = P0 + (ring * 3.3 + T0 * 1.2) * sqK;
  float r = sqArmR(u, k), fl;
  vec3 c, T, N;
  if (A.x < 0.5) {
    vec3 dir = normalize(ring * 0.7 - T0);
    c = sqArmRock(u, k, root, dir, r);
    T = normalize(sqArmRock(min(u + 0.004, 1.0), k, root, dir, r) - sqArmRock(max(u - 0.004, 0.0), k, root, dir, r));
    vec3 o = normalize(mix(ring, normalize(vec3(c.x - sqC.x, 0.0, c.z - sqC.z)), smoothstep(0.0, 0.13, u)));
    N = normalize(o - T * dot(o, T));
    fl = 0.72;                                   // (pressed flat against the stone)
  } else {
    float a0 = sqAng(0.0);
    vec3 Nin;
    c = sqArmUp(u, k, root, mat3(sqEr(a0), vec3(0.0, 1.0, 0.0), sqEp(a0)), T, Nin);
    N = -Nin;
    fl = 0.9;
  }
  vec3 Bn = cross(T, N);
  transformed = c + (cos(v) * N * fl + sin(v) * Bn) * r;
  objectNormal = normalize(cos(v) * N / fl + sin(v) * Bn);
  vUV = aUV; vArm = aArm; vOut = cos(v); vLen = A.z;
  vSuck = sqD[k].w > 0.5 ? smoothstep(0.8, 0.84, u) : 1.0;       // (a tentacle's suckers only on its club)`,
        fpars: 'varying vec2 vUV; varying float vArm, vOut, vLen, vSuck;',
        // (its back the skin; its inner side the suckers: pale rings in two staggered rows, closer toward the tip)
        color: /* glsl */`{
    float back = max(smoothstep(-0.35, 0.3, vOut), 1.0 - vSuck), w = vUV.y - 6.2831853, m = 3.14159 - abs(w);
    vec3 c = sqSkin(vec2(vUV.x * vLen / 1.4, w * 1.1 + vArm * 5.3), back);
    float sx = vUV.x * vLen * (1.0 + 0.5 * vUV.x) / 0.95 + 0.5 * step(0.0, w);
    vec2 sp = vec2(fract(sx) - 0.5, (m - 0.4) * 2.2);
    float rr = length(sp);
    float ring = smoothstep(0.38, 0.31, rr) * smoothstep(0.15, 0.22, rr) * step(m, 0.9) * vSuck;
    c = mix(c, vec3(0.36, 0.25, 0.23), ring * 0.85) * (1.0 - 0.6 * smoothstep(0.17, 0.08, rr) * step(m, 0.9) * vSuck);
    diffuseColor.rgb = c;
  }`,
        emissive: /* glsl */`{
    float w = vUV.y - 6.2831853;
    float sp = sqSpots(vec2(vUV.x * vLen / 1.8, w * 1.3 + vArm * 3.1), 0.35) * smoothstep(0.3, 0.8, vOut);
    float pulse = exp(-pow((vUV.x - fract(lTime * 0.045 + vArm * 0.137)) * 8.0, 2.0));
    totalEmissiveRadiance += vec3(0.12, 0.55, 0.9) * sp * (0.15 + 1.5 * pulse);
  }`,
      });
      this.arms = new THREE.Mesh(g, mat);
      this.arms.name = 'squid-arms';
    }
    // ---- the mantle, the head, the fins and the eyes
    {
      const mat = squidMaterial({
        key: 'mantle', uniforms: this.U,
        pars: 'attribute vec3 aS, aO; attribute float aPart; varying vec3 vS, vO, vLN; varying float vPart;',
        place: /* glsl */`
  vec3 P, T, S, D;
  sqSpine(aS.x, aS.y, P, T, S, D);
  // breathing: the mantle swelling and easing, slowly; the fins rippling, their edges most
  float b = 1.0 + 0.06 * sin(lTime * 0.5) * smoothstep(0.16, 0.3, aS.x) * (1.0 - smoothstep(0.85, 1.0, aS.x));
  vec3 o = vec3(aO.xy * b, aO.z);
  if (aPart > 1.5) o.y += pow(aS.z, 1.5) * 1.4 * sqK * sin(lTime * 0.8 - aS.x * 10.0);
  transformed = P + S * o.x + D * o.y + T * o.z;
  objectNormal = normalize(S * normal.x + D * normal.y + T * normal.z);
  vS = aS; vO = aO; vLN = normal; vPart = aPart;`,
        fpars: 'varying vec3 vS, vO, vLN; varying float vPart;',
        // (the skin laid on by two flat projections across it, blended by which way it faces - no seam round it; paler
        // underneath; the fins lighter toward their edges; the eyes dark and glossy)
        color: /* glsl */`{
    float z = vS.x * ${ML.toFixed(1)}, sx = smoothstep(0.4, 0.6, abs(vLN.x));
    float back = smoothstep(-0.5, 0.25, vLN.y);
    vec3 c = mix(sqSkin(vec2(z, vO.x) / 1.4, back), sqSkin(vec2(z, vO.y) / 1.4 + 9.0, back), sx);
    if (vPart > 1.5) c *= 0.9 + 0.6 * vS.z;
    if (vPart > 0.5 && vPart < 1.5) c = vec3(0.01, 0.008, 0.01);
    diffuseColor.rgb = c;
  }`,
        rough: 'if (vPart > 0.5 && vPart < 1.5) roughnessFactor = 0.18;',
        emissive: /* glsl */`{
    float z = vS.x * ${ML.toFixed(1)}, sx = smoothstep(0.4, 0.6, abs(vLN.x));
    float sp = mix(sqSpots(vec2(z, vO.x) / 1.6, 0.3), sqSpots(vec2(z, vO.y) / 1.6 + 17.0, 0.3), sx);
    sp *= smoothstep(0.0, 0.5, vLN.y) * step(vPart, 0.5) * step(0.17, vS.x);
    float pulse = exp(-pow((vS.x - fract(lTime * 0.035)) * 6.0, 2.0));
    totalEmissiveRadiance += vec3(0.12, 0.55, 0.9) * sp * (0.15 + 1.4 * pulse);
    if (vPart > 0.5 && vPart < 1.5) {
      // the eye: a glowing amber iris streaked round a great dark pupil that widens and narrows, slowly
      vec3 L = normalize(vec3(sign(vO.x) * 0.8, 0.2, -0.56)), n = normalize(vLN);
      float f = dot(n, L), pup = 0.9 - 0.025 * sin(lTime * 0.31);
      vec3 tA = normalize(cross(L, vec3(0.0, 1.0, 0.0))), tB = cross(L, tA);
      float ang = atan(dot(n, tB), dot(n, tA));
      float iris = smoothstep(0.64, 0.7, f) * (1.0 - smoothstep(pup - 0.02, pup + 0.01, f));
      float st = 0.75 + 0.25 * sin(ang * 23.0) * sin(ang * 7.0 + 1.3);
      totalEmissiveRadiance += vec3(0.95, 0.36, 0.05) * iris * st * (1.1 + 0.2 * sin(lTime * 0.4)) * (0.55 + 0.7 * smoothstep(0.7, pup, f));
    }
  }`,
      });
      this.mantle = new THREE.Mesh(mantleGeometry(), mat);
      this.mantle.name = 'squid-mantle';
    }
    this.meshes = [this.arms, this.mantle];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.layers.set(2);
      scene.add(m);
    }
  }

  setOn(on) { for (const m of this.meshes) m.visible = on; }
}
