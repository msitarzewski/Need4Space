// The ocean's life, every creature's motion worked out on the GPU from a few numbers written once (where, when, which
// way) and the clock - the CPU only decides when something new begins:
//  - leapers: schools of silver fish bursting out of the swell ahead of the player in arcs, now and then a few big
//    ones (dolphin-sized); each leap throws spray where it leaves and where it falls back
//  - leviathans: vast creatures (~60 m) breaching at set places as the player comes - one clean over the causeway -
//    rising out of the sea, twisting at the top, falling back in a burst of spray; their flanks lit with rows of light
//  - the giant: one gliding slowly over the drowned avenue, its lights seen from the ships under it
//  - birds: flocks of seabirds wheeling over the swell round the sea stacks
//  - under the sea: shoals of small fish circling the city, glowing jellyfish drifting and pulsing, and the specks of
//    drifting life round the camera
//  - spray: one pool of droplets for every splash (and the ships' bubbles under water); ripple rings on the sea where
//    something broke it (Ocean reads them)
import * as THREE from 'three';
import { mulberry32, smoothstep } from './noise.js';
import { SEA_Y, SEA_GLSL, waveHeight } from './sea.js';

const TAU = Math.PI * 2, G = 9.81;
export const LIFE_U = { lTime: { value: 0 } };

// ---------------------------------------------------------------- shapes (length 1 along +z, the head at +0.5)
// a fish: a spindle of revolution, a forked tail, a dorsal fin and two side fins; 'along' 0 at the nose .. 1 the tail
function fishGeometry(NZ = 12, NA = 8) {
  const pos = [], along = [], idx = [];
  const girth = (t) => 0.13 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.8) * (1 - 0.55 * t);
  for (let i = 0; i <= NZ; i++) {
    const t = i / NZ, z = 0.5 - t * 0.82, r = girth(t);
    for (let j = 0; j < NA; j++) { const a = (j / NA) * TAU; pos.push(Math.cos(a) * r * 0.7, Math.sin(a) * r, z); along.push(t * 0.82); }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    idx.push(a, c, b, b, c, d);
  }
  const fin = (pts) => { const b = pos.length / 3; for (const [x, y, z] of pts) { pos.push(x, y, z); along.push(0.5 - z + 0.0); } idx.push(b, b + 1, b + 2, b, b + 2, b + 1); if (pts.length > 3) idx.push(b, b + 2, b + 3, b, b + 3, b + 2); };
  fin([[0, 0.02, -0.3], [0, 0.17, -0.5], [0, 0.0, -0.4]]);                 // the tail, two lobes
  fin([[0, -0.02, -0.3], [0, -0.17, -0.5], [0, 0.0, -0.4]]);
  fin([[0, 0.11, 0.12], [0, 0.2, -0.02], [0, 0.09, -0.08]]);              // dorsal
  for (const sd of [1, -1]) fin([[sd * 0.08, -0.04, 0.22], [sd * 0.2, -0.09, 0.1], [sd * 0.07, -0.05, 0.12]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a leviathan: a long body, a blunt head, a ridge down its back, two long pectoral fins and a broad fluke; 'along' as
// for the fish, 'span' out along a fin
function leviathanGeometry() {
  const pos = [], along = [], span = [], idx = [];
  const NZ = 64, NA = 24;
  const girth = (t) => 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.03 + t * 0.97)), 0.6) * (1 - 0.6 * Math.pow(t, 1.5)) + 0.004;
  for (let i = 0; i <= NZ; i++) {
    const t = i / NZ, z = 0.5 - t, r = girth(t);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU, s = Math.sin(a), c = Math.cos(a);
      // flatter below, a ridge along the top
      const ridge = Math.max(0, s) * Math.pow(Math.max(0, Math.cos((a - Math.PI / 2) * 3)), 6) * 0.02 * Math.sin(Math.PI * t);
      pos.push(c * r * 1.08, s * r * (s < 0 ? 0.8 : 1.0) + ridge, z); along.push(t); span.push(0);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    idx.push(a, c, b, b, c, d);
  }
  const fin = (z0, len, w, sweep, y, droop) => {
    for (const sd of [1, -1]) {
      const b = pos.length / 3;
      const pts = [[0.07, y, z0 + w / 2], [0.07, y, z0 - w / 2], [0.07 + len, y - droop, z0 - w / 2 - sweep], [0.07 + len * 0.96, y - droop, z0 - sweep + w * 0.15]];
      for (const [x, yy, z] of pts) { pos.push(sd * x, yy, z); along.push(0.5 - z); span.push(Math.max(0, (x - 0.07) / len)); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
    }
  };
  fin(0.26, 0.3, 0.09, 0.14, -0.04, 0.05);         // the long pectorals
  fin(-0.46, 0.13, 0.05, 0.06, 0.0, 0.0);          // the fluke
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a seabird: a slim body, long narrow wings (each two panels: the hand bends), a forked tail; 'span' out along a wing
function birdGeometry() {
  const pos = [], span = [], idx = [];
  const v = (x, y, z, s) => { pos.push(x, y, z); span.push(s); return pos.length / 3 - 1; };
  const nose = v(0, 0, 0.45, 0), tail = v(0, 0, -0.35, 0), ring = [];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ring.push(v(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.12, 0)); }
  for (let k = 0; k < 5; k++) { const a = ring[k], b = ring[(k + 1) % 5]; idx.push(nose, b, a, tail, a, b); }
  for (const sd of [1, -1]) {
    const r0 = v(sd * 0.04, 0, 0.2, 0.04), r1 = v(sd * 0.04, 0, -0.04, 0.04);
    const m0 = v(sd * 0.62, 0.02, 0.16, 0.6), m1 = v(sd * 0.62, 0.02, -0.06, 0.6);
    const t0 = v(sd * 1.2, -0.02, 0.0, 1.0), t1 = v(sd * 1.1, -0.02, -0.12, 1.0);
    const q = sd > 0 ? (a, b, c) => idx.push(a, b, c) : (a, b, c) => idx.push(a, c, b);
    q(r0, m0, r1); q(r1, m0, m1); q(m0, t0, m1); q(m1, t0, t1);
  }
  const t0 = v(0, 0, -0.28, 0), t1 = v(0.14, 0, -0.55, 0), t2 = v(-0.14, 0, -0.55, 0), t3 = v(0, 0, -0.42, 0);
  idx.push(t0, t1, t3, t0, t3, t2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a jellyfish: a bell (a frilled dome) and a skirt of tentacles; 'along' 0 at the bell's crown .. 1 the tentacles' ends
function jellyGeometry() {
  const pos = [], along = [], idx = [];
  const NA = 16, NB = 6;
  for (let i = 0; i <= NB; i++) {
    const t = i / NB, a0 = t * Math.PI * 0.5;
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU, r = Math.sin(a0) * (1 + 0.08 * Math.sin(a * 8) * t);
      pos.push(Math.cos(a) * r * 0.5, Math.cos(a0) * 0.35, Math.sin(a) * r * 0.5); along.push(t * 0.25);
    }
  }
  for (let i = 0; i < NB; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    idx.push(a, b, c, b, d, c);
  }
  for (let k = 0; k < 8; k++) {                      // tentacles: thin ribbons hanging from the rim
    const a = (k / 8) * TAU + 0.2, b0 = pos.length / 3;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, r = 0.42 * (1 - 0.3 * t);
      for (const w of [-0.02, 0.02]) { pos.push(Math.cos(a) * r + w * Math.sin(a), -t * 1.6, Math.sin(a) * r - w * Math.cos(a)); along.push(0.25 + t * 0.75); }
    }
    for (let i = 0; i < 8; i++) { const q = b0 + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const inst = (base, attrs, count) => {
  const g = new THREE.InstancedBufferGeometry().copy(base);
  for (const [k, n] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = count;
  return g;
};
// (a GLSL basis from a forward direction: x right, y up, z forward)
const BASIS = /* glsl */`
mat3 lfBasis(vec3 f, float roll) {
  vec3 z = normalize(f), x = normalize(cross(vec3(0.0, 1.0, 0.0), z));
  if (abs(z.y) > 0.999) x = vec3(1.0, 0.0, 0.0);
  vec3 y = cross(z, x);
  float c = cos(roll), s = sin(roll);
  return mat3(x * c + y * s, y * c - x * s, z);
}`;

// a lit material whose vertices the shader places (begin: GLSL setting 'transformed' and 'objectNormal' in world space)
function lifeMaterial({ key, pars, place, color, emissive = '', fpars = '', side = THREE.FrontSide, roughness = 0.4, metalness = 0.3 }) {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness, side });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float lTime; varying vec3 vLL; varying float vHide;
${BASIS}
${pars}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
	vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 transformed = vec3(position);
vLL = position; vHide = 0.0;
${place}`)
      .replace('#include <begin_vertex>', '');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float lTime; varying vec3 vLL; varying float vHide;
${fpars}
float lfH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vHide > 0.5) discard;
  ${color}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${emissive}`);
  };
  m.customProgramCacheKey = () => 'ocean-life-' + key;
  return m;
}

// ---------------------------------------------------------------- spray
// a pool of droplets: each born at a time and place with a velocity, flying ballistic with drag, fading; white in the
// moonlight with the plankton's cyan; under water (bubbles) they rise and wobble and burst at the surface
class Spray {
  constructor(n = 6000) {
    this.n = n; this.next = 0;
    const g = new THREE.BufferGeometry();
    this.P = new Float32Array(n * 4); this.Vv = new Float32Array(n * 4);   // x y z birth | vx vy vz (life | kind)
    for (let i = 0; i < n; i++) this.P[i * 4 + 3] = -1e6;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aP', new THREE.BufferAttribute(this.P, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aV', new THREE.BufferAttribute(this.Vv, 4).setUsage(THREE.DynamicDrawUsage));
    this.U = { lTime: LIFE_U.lTime, pr: { value: 1 }, lvl: { value: 0 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform float lTime, pr, lvl; attribute vec4 aP, aV; varying vec3 vC; varying float vA;
        ${SEA_GLSL}
        void main() {
          float t = lTime - aP.w, life = floor(aV.w), kind = fract(aV.w) * 10.0;
          vA = 0.0;
          if (t < 0.0 || t > life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          vec3 p;
          float size;
          if (kind < 0.5) {
            // a droplet: thrown out, slowed by the air, falling; the bigger ones (mist: kind 2) hang longer
            float k = 1.6, e = (1.0 - exp(-k * t)) / k;
            p = aP.xyz + aV.xyz * e + vec3(0.0, -${G.toFixed(2)} * (t - e) / k, 0.0);
            size = 0.14;
            if (p.y < ${SEA_Y.toFixed(1)} - 0.3) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
            vC = vec3(0.55, 0.75, 0.85) * 0.9 + vec3(0.0, 0.9, 1.2) * 0.8 * step(0.6, fract(aP.x * 7.3 + aP.z * 3.1));
          } else if (kind < 1.5) {
            // mist: a soft puff swelling and drifting with the wind
            p = aP.xyz + aV.xyz * (1.0 - exp(-0.8 * t)) / 0.8 + vec3(0.9, 0.4 - 0.25 * t, -0.5) * t;
            size = 1.5 + 2.6 * t;
            vC = vec3(0.035, 0.045, 0.055);
          } else {
            // a bubble: rising, wobbling, gone at the surface
            p = aP.xyz + aV.xyz * (1.0 - exp(-2.0 * t)) / 2.0 + vec3(sin(t * 9.0 + aP.x) * 0.2, 2.2 * t, cos(t * 7.0 + aP.z) * 0.2);
            size = 0.08 + 0.05 * fract(aP.y * 13.1);
            if (p.y > lvl) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
            vC = vec3(0.35, 0.65, 0.75);
          }
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * pr * projectionMatrix[1][1] * 360.0 / -mv.z, 1.0, 90.0);
          vA = (1.0 - smoothstep(life * 0.55, life, t)) * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 4.0, -mv.z);
          vC *= seTrans(cameraPosition, p, lvl);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(q, q);
          if (r2 > 1.0 || vA <= 0.0) discard;
          gl_FragColor = vec4(vC * vA * (1.0 - r2), 1.0);
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.name = 'spray';
    this.dirty = false;
  }
  // one particle: p (birth place), v, birth time, life (s), kind (0 droplet, 1 mist, 2 bubble)
  add(p, vx, vy, vz, t, life, kind) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.P.set([p.x, p.y, p.z, t], i * 4);
    this.Vv.set([vx, vy, vz, Math.max(1, Math.round(life)) + kind / 10 + 0.001], i * 4);       // (whole seconds of life, the kind in tenths)
    this.dirty = true;
  }
  // a splash where something broke the sea at p at time t: a crown of droplets (size: how big the thing was), mist
  splash(p, t, size, rnd, along = null) {
    const n = Math.min(900, Math.round(30 + size * size * 4));
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU, up = 3 + rnd() * (4 + size * 1.6), out = (1 + rnd() * 3) * (0.6 + size * 0.25);
      let vx = Math.cos(a) * out, vz = Math.sin(a) * out;
      if (along) { vx += along.x * rnd() * size * 0.8; vz += along.z * rnd() * size * 0.8; }
      this.add(p, vx, up * (0.6 + 0.4 * rnd()), vz, t + rnd() * 0.12, 1.2 + size * 0.12 + rnd(), 0);
    }
    const nm = Math.min(60, Math.round(2 + size * 2));
    for (let k = 0; k < nm; k++) {
      const a = rnd() * TAU, r = rnd() * size * 0.6;
      this.add({ x: p.x + Math.cos(a) * r, y: p.y + rnd() * size * 0.3, z: p.z + Math.sin(a) * r }, Math.cos(a) * size * 0.3, 1 + rnd() * size * 0.5, Math.sin(a) * size * 0.3, t + rnd() * 0.3, 3 + size * 0.15, 1);
    }
  }
  flush() {
    if (!this.dirty) return;
    const g = this.points.geometry;
    g.attributes.aP.needsUpdate = true; g.attributes.aV.needsUpdate = true;
    this.dirty = false;
  }
}

// ---------------------------------------------------------------- the life
export class SeaLife {
  // track: the circuit; city: where the drowned city lies (C, R); stacks: [{x, z, r}]
  constructor(scene, track, { city, stacks = [], dens = 1 } = {}) {
    this.track = track; this.city = city; this.dens = dens;
    const rnd = (this.rnd = mulberry32(5150));
    this.spray = new Spray(Math.round(7000 * Math.max(0.5, dens)));
    scene.add(this.spray.points);
    // ripple rings on the sea: the latest breaks (x, z, time, size) - the ocean draws them
    this.rings = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -1e6, 0));
    this.ringNext = 0;
    this.buildLeapers(scene);
    this.buildLeviathans(scene);
    this.buildBirds(scene, stacks);
    this.buildDeep(scene);
    this.meshes = [this.leap, ...this.levs.map((L) => L.mesh), this.giant.mesh, this.birds, this.shoal, this.jelly, this.snow, this.spray.points];
    this.events = [];                                  // leviathan breaches due (by the player's place on the lap)
    this.lastS = null;
  }

  ring(x, z, t, size) {
    this.rings[this.ringNext].set(x, z, t, size);
    this.ringNext = (this.ringNext + 1) % this.rings.length;
  }

  // ---- fish leaping out of the swell
  buildLeapers(scene) {
    const N = (this.nLeap = Math.round(240 * Math.max(0.5, this.dens)));
    const g = inst(fishGeometry(), { iA: 4, iB: 4 }, N);
    for (let i = 0; i < N; i++) g.attributes.iA.array[i * 4 + 3] = -1e6;
    const mat = lifeMaterial({
      key: 'leap', metalness: 0.55, roughness: 0.28,
      pars: 'attribute float along; attribute vec4 iA, iB; varying float vAlong;',
      // iA: x, z (where it leaves the sea), heading, t0; iB: time in the air, height, length, run (m)
      place: /* glsl */`
  vAlong = along;
  float T = iB.x, s = (lTime - iA.w) / T;
  if (s < -0.25 || s > 1.25) { vHide = 1.0; transformed = vec3(0.0, -1e5, 0.0); }
  else {
    vec2 dir = vec2(cos(iA.z), sin(iA.z));
    float H = iB.y, D = iB.w;
    float y = s < 0.0 ? ${SEA_Y.toFixed(1)} + s * 6.0 * H : s > 1.0 ? ${SEA_Y.toFixed(1)} - (s - 1.0) * 6.0 * H : ${SEA_Y.toFixed(1)} + 4.0 * H * s * (1.0 - s);
    float dy = (s < 0.0 || s > 1.0) ? (s < 0.0 ? 6.0 * H : -6.0 * H) : 4.0 * H * (1.0 - 2.0 * s);
    vec3 P = vec3(iA.x + dir.x * D * s, y, iA.y + dir.y * D * s);
    mat3 B = lfBasis(vec3(dir.x * D, dy, dir.y * D), sin(lTime * 3.0 + iA.x) * 0.3);
    vec3 q = position;
    q.x += sin(along * 5.0 - lTime * 18.0 + iA.y) * 0.07 * along;           // the tail beating
    transformed = P + B * (q * iB.z);
    objectNormal = B * normal;
  }`,
      color: `diffuseColor.rgb = mix(vec3(0.62, 0.68, 0.72), vec3(0.08, 0.14, 0.2), smoothstep(-0.02, 0.06, vLL.y));`,
    });
    this.leap = new THREE.Mesh(g, mat);
    this.leap.frustumCulled = false;
    this.leap.name = 'leapers';
    scene.add(this.leap);
    this.leapNext = 0;
  }

  // a school leaping at p (x, z) heading a, its first fish at t0
  school(x, z, a, t0, big) {
    const rnd = this.rnd, g = this.leap.geometry, A = g.attributes.iA, B = g.attributes.iB;
    const n = big ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 12);
    for (let k = 0; k < n; k++) {
      const i = this.leapNext; this.leapNext = (this.leapNext + 1) % this.nLeap;
      const len = big ? 3 + rnd() * 2.5 : 0.7 + rnd() * 0.9, T = big ? 1.5 + rnd() * 0.6 : 0.75 + rnd() * 0.45;
      const H = big ? 3.5 + rnd() * 3.5 : 0.9 + rnd() * 1.6, run = (big ? 9 : 5) * T * (0.8 + rnd() * 0.5);
      const ox = (rnd() - 0.5) * (big ? 14 : 9), oz = (rnd() - 0.5) * (big ? 14 : 9), aa = a + (rnd() - 0.5) * 0.35, ts = t0 + rnd() * (big ? 1.8 : 1.4);
      A.array.set([x + ox, z + oz, aa, ts], i * 4);
      B.array.set([T, H, len, run], i * 4);
      // spray where it leaves and where it falls back
      const p0 = { x: x + ox, y: SEA_Y, z: z + oz }, p1 = { x: x + ox + Math.cos(aa) * run, y: SEA_Y, z: z + oz + Math.sin(aa) * run };
      this.spray.splash(p0, ts, len * 0.9, rnd);
      this.spray.splash(p1, ts + T, len * 1.1, rnd);
      if (big || k % 3 === 0) { this.ring(p0.x, p0.z, ts, len); this.ring(p1.x, p1.z, ts + T, len * 1.2); }
    }
    A.needsUpdate = B.needsUpdate = true;
  }

  // ---- leviathans
  buildLeviathans(scene) {
    const geo = leviathanGeometry();
    const make = (key, len) => {
      const mat = lifeMaterial({
        key, metalness: 0.1, roughness: 0.22, side: THREE.DoubleSide, fpars: 'varying float vAlong; varying float vSpan;',
        pars: 'attribute float along; attribute float span; uniform float bend; varying float vAlong; varying float vSpan;',
        place: /* glsl */`
  vAlong = along; vSpan = span;
  vec3 q = position;
  // a slow wave down the body, the fins rowing
  q.x += sin(along * 4.0 - lTime * 1.6) * 0.012 * along;
  q.y += sin(along * 3.0 - lTime * 1.6) * 0.01 * along + span * sin(lTime * 1.3) * 0.04 + bend * along * along * 0.06;
  transformed = q * ${len.toFixed(1)};
  objectNormal = normal;`,
        color: `diffuseColor.rgb = mix(vec3(0.24, 0.27, 0.28), vec3(0.03, 0.045, 0.06), smoothstep(-0.02, 0.03, vLL.y)) * (0.8 + 0.4 * lfH(floor(vLL.xz * 300.0)));`,
        emissive: /* glsl */`{
    // rows of lights down the flanks and along the fins' edges, breathing slowly
    vec2 q = vec2(vLL.z * 90.0, (vLL.y + 0.02) * 120.0);
    float spot = smoothstep(0.34, 0.12, length(fract(q) - 0.5)) * step(0.45, lfH(floor(q)));
    float flank = smoothstep(0.03, 0.0, abs(abs(vLL.y + 0.005) - 0.025)) * (1.0 - smoothstep(0.85, 1.0, vAlong));
    float fin = smoothstep(0.7, 0.95, vSpan);
    float breathe = 0.65 + 0.35 * sin(lTime * 0.9 + vLL.z * 30.0);
    totalEmissiveRadiance += vec3(0.1, 0.85, 1.0) * 7.0 * spot * clamp(flank + fin, 0.0, 1.0) * breathe;
    // two lines of light along each flank, a pale glow through the belly, chevrons down the back
    float line = smoothstep(0.004, 0.0, abs(abs(vLL.x) - 0.075 * (1.0 - 0.6 * vAlong)) - 0.0015) * step(vLL.y, 0.02) * (1.0 - smoothstep(0.8, 0.95, vAlong));
    float chev = smoothstep(0.08, 0.0, abs(fract(vLL.z * 14.0 + abs(vLL.x) * 9.0) - 0.5) - 0.38) * smoothstep(0.02, 0.05, vLL.y) * step(abs(vLL.x), 0.035);
    totalEmissiveRadiance += vec3(0.15, 0.9, 1.0) * (line * 5.0 + chev * 2.2) * breathe + vec3(0.02, 0.09, 0.12) * smoothstep(0.02, -0.04, vLL.y);
    // the eyes
    totalEmissiveRadiance += vec3(0.4, 1.0, 0.9) * 6.0 * smoothstep(0.014, 0.006, length(vec2(abs(vLL.x) - 0.055, vLL.z - 0.44)) * 1.0) * step(0.0, vLL.y);
  }`,
      });
      mat.onBeforeCompile = ((ob) => (sh) => { ob(sh); sh.uniforms.bend = mat.userData.bend; })(mat.onBeforeCompile);
      mat.userData.bend = { value: 0 };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    // the breaching ones: at set places on the lap; the one over the causeway crosses it
    const tr = this.track, f = {};
    const spot = (name, off, lat, across, apex, len) => {
      tr.frame(tr.at(name, off), f);
      const R = f.R.clone().setY(0).normalize(), T = f.T.clone().setY(0).normalize();
      const L = new THREE.Vector3(f.P.x + R.x * lat, SEA_Y, f.P.z + R.z * lat);
      const dir = across ? R.clone().multiplyScalar(-Math.sign(lat)) : T.clone().multiplyScalar(0.4).addScaledVector(R, -Math.sign(lat) * 0.3).normalize();
      return { s: tr.at(name, off), L, dir, apex, len, across };
    };
    this.levs = [
      { ...spot('spray', 260, -46, true, 62, 58), mesh: make('lev0', 58) },
      { ...spot('breach', 240, 150, false, 48, 64), mesh: make('lev1', 64) },
      { ...spot('preLoop', -500, -170, false, 55, 70), mesh: make('lev2', 70) },
    ];
    for (const E of this.levs) {
      const vv = Math.sqrt(2 * G * E.apex), th = THREE.MathUtils.degToRad(E.across === false ? 62 : 70);
      E.vv = vv; E.vh = vv / Math.tan(th); E.T = (2 * vv) / G; E.t0 = -1e9;
    }
    // the giant over the avenue: its way along the track from the gate to the dome, ~40 m over the deck, never higher
    // than 14 m under the sea
    const gl = 90, gm = make('giant', gl), way = [];
    for (let s = tr.at('gate', -200); tr.inSpan(s, tr.at('gate', -200), tr.at('dome', 200)); s = tr.wrap(s + 40)) {
      tr.frame(s, f);
      way.push(new THREE.Vector3(f.P.x + f.R.x * 30, Math.min(f.P.y + 42, SEA_Y - 15), f.P.z + f.R.z * 30));
    }
    this.giant = { mesh: gm, curve: new THREE.CatmullRomCurve3(way, false, 'centripetal'), len: gl, speed: 9 };
    this.giant.length = this.giant.curve.getLength();
  }

  // place a leviathan for its breach at time t (its launch at E.t0)
  leviathanAt(E, t) {
    const m = E.mesh, dt = t - E.t0;
    if (dt < -6 || dt > E.T + 6) { m.visible = false; return; }
    m.visible = true;
    // under water before (rising along its line), the arc through the air, then deeper again
    const p = E.L.clone(), v = new THREE.Vector3();
    if (dt < 0) { p.addScaledVector(E.dir, E.vh * dt); p.y += E.vv * dt; v.copy(E.dir).multiplyScalar(E.vh).setY(E.vv); }
    else if (dt < E.T) { p.addScaledVector(E.dir, E.vh * dt); p.y += E.vv * dt - 0.5 * G * dt * dt; v.copy(E.dir).multiplyScalar(E.vh).setY(E.vv - G * dt); }
    else { const u = dt - E.T; p.addScaledVector(E.dir, E.vh * E.T + E.vh * 0.6 * u); p.y -= E.vv * 0.8 * u; v.copy(E.dir).multiplyScalar(E.vh * 0.6).setY(-E.vv * 0.8); }
    const fwd = v.normalize(), x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize(), y = new THREE.Vector3().crossVectors(fwd, x);
    // a twist at the top of the leap
    const roll = smoothstep(0.15, 0.85, dt / E.T) * Math.PI * 0.9;
    const xr = x.clone().multiplyScalar(Math.cos(roll)).addScaledVector(y, Math.sin(roll)), yr = y.clone().multiplyScalar(Math.cos(roll)).addScaledVector(x, -Math.sin(roll));
    m.matrix.makeBasis(xr, yr, fwd).setPosition(p);
    m.material.userData.bend.value = Math.sin(Math.min(1, Math.max(0, dt / E.T)) * Math.PI) * -1.2;
  }

  // ---- seabirds wheeling over the swell
  buildBirds(scene, stacks) {
    const rnd = this.rnd, tr = this.track, f = {};
    const flocks = [];
    // round the sea stacks near the spray run, and along the south
    for (const [name, off, lat] of [['spray', -150, 160], ['arch', 200, -180], ['light', 0, -220], ['preLoop', -400, 200], ['start', -300, -150]]) {
      tr.frame(tr.at(name, off), f);
      flocks.push({ c: new THREE.Vector3(f.P.x + f.R.x * lat, 30 + rnd() * 30, f.P.z + f.R.z * lat), r: 50 + rnd() * 70 });
    }
    const per = Math.round(26 * Math.max(0.5, this.dens)), N = flocks.length * per;
    const g = inst(birdGeometry(), { iA: 4, iB: 4 }, N);
    flocks.forEach((F, k) => {
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        g.attributes.iA.array.set([F.c.x, F.c.y, F.c.z, F.r * (0.7 + rnd() * 0.6)], i * 4);
        g.attributes.iB.array.set([rnd() * TAU, 0.08 + rnd() * 0.06, (rnd() - 0.5) * 18, 1.4 + rnd() * 0.6], i * 4);
      }
    });
    const mat = lifeMaterial({
      key: 'birds', metalness: 0, roughness: 0.8, side: THREE.DoubleSide,
      pars: 'attribute float span; attribute vec4 iA, iB;',
      // iA: the flock's middle, its loop's radius; iB: phase, angular speed, height offset, wingspan
      place: /* glsl */`
  float a = iB.x + lTime * iB.y, r = iA.w * (1.0 + 0.25 * sin(lTime * 0.21 + iB.x * 3.0));
  vec3 P = iA.xyz + vec3(cos(a) * r, iB.z + sin(lTime * 0.4 + iB.x) * 6.0, sin(a) * r * 0.7);
  vec3 F = vec3(-sin(a) * r, cos(lTime * 0.4 + iB.x) * 2.4, cos(a) * r * 0.7);
  mat3 B = lfBasis(F, 0.35);
  vec3 q = position;
  float flap = sin(lTime * 7.0 + iB.x * 11.0) * (0.5 + 0.5 * step(0.3, sin(lTime * 0.6 + iB.x)));
  q.y += flap * span * span * 0.55;
  transformed = P + B * (q * iB.w);
  objectNormal = B * normal;`,
      color: 'diffuseColor.rgb = vec3(0.16, 0.17, 0.19);',
    });
    this.birds = new THREE.Mesh(g, mat);
    this.birds.frustumCulled = false;
    this.birds.name = 'birds';
    scene.add(this.birds);
  }

  // ---- under the sea: shoals, jellyfish, drifting specks
  buildDeep(scene) {
    const rnd = this.rnd, C = this.city ? this.city.C : new THREE.Vector3(), tr = this.track, f = {};
    // shoals: each a ring of fish circling a spot over the city's streets, its fish spread through a tube round it
    const spots = [];
    for (const [name, off, lat] of [['gate', 120, 70], ['avenue', 200, -70], ['dome', -150, 80], ['hallOut', 120, -90], ['aqueduct', 80, 80], ['avenue', -40, 90]]) {
      tr.frame(tr.at(name, off), f);
      spots.push(new THREE.Vector3(f.P.x + f.R.x * lat, f.P.y - 4, f.P.z + f.R.z * lat));
    }
    const per = Math.round(110 * Math.max(0.5, this.dens)), N = spots.length * per;
    const g = inst(fishGeometry(8, 6), { iA: 4, iB: 4 }, N);
    spots.forEach((S, k) => {
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        g.attributes.iA.array.set([S.x, S.y, S.z, 14 + rnd() * 10], i * 4);
        g.attributes.iB.array.set([rnd() * TAU, (0.25 + rnd() * 0.08) * (k % 2 ? 1 : -1), (rnd() - 0.5) * 7, 0.45 + rnd() * 0.4], i * 4);
      }
    });
    const shoalMat = lifeMaterial({
      key: 'shoal', metalness: 0.6, roughness: 0.3,
      pars: 'attribute float along; attribute vec4 iA, iB;',
      place: /* glsl */`
  float a = iB.x + lTime * iB.y, r = iA.w + sin(iB.x * 7.0 + lTime * 0.5) * 3.0;
  vec3 P = iA.xyz + vec3(cos(a) * r, iB.z + sin(a * 2.0 + iB.x) * 2.0, sin(a) * r);
  vec3 F = vec3(-sin(a), cos(a * 2.0 + iB.x) * 0.2, cos(a)) * sign(iB.y);
  mat3 B = lfBasis(F, 0.0);
  vec3 q = position;
  q.x += sin(along * 5.0 - lTime * 16.0 + iB.x * 5.0) * 0.08 * along;
  transformed = P + B * (q * iB.w);
  objectNormal = B * normal;`,
      color: `diffuseColor.rgb = mix(vec3(0.7, 0.74, 0.76), vec3(0.12, 0.2, 0.26), smoothstep(-0.02, 0.06, vLL.y));`,
    });
    this.shoal = new THREE.Mesh(g, shoalMat);
    this.shoal.frustumCulled = false;
    this.shoal.name = 'shoals';
    scene.add(this.shoal);
    // jellyfish drifting through the city's water, between the street and the surface, pulsing; their own light
    const NJ = Math.round(150 * Math.max(0.5, this.dens)), gj = inst(jellyGeometry(), { iA: 4, iB: 4 }, NJ);
    const R = this.city ? this.city.R : new THREE.Vector3(600, 0, 600);
    for (let i = 0; i < NJ; i++) {
      let x, z, y;
      for (let k = 0; k < 20; k++) {
        x = C.x + (rnd() * 2 - 1) * R.x * 0.9; z = C.z + (rnd() * 2 - 1) * R.z * 0.9; y = SEA_Y - 8 - rnd() * 60;
        const n = tr.nearestIndex(new THREE.Vector3(x, y, z));
        if (tr.P[n].distanceTo(new THREE.Vector3(x, y, z)) > 40) break;
      }
      gj.attributes.iA.array.set([x, y, z, 1.6 + rnd() * 3.2], i * 4);
      gj.attributes.iB.array.set([rnd() * TAU, rnd(), 0.5 + rnd() * 0.4, rnd()], i * 4);
    }
    const jm = new THREE.ShaderMaterial({
      uniforms: { lTime: LIFE_U.lTime, lvl: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform float lTime, lvl; attribute float along; attribute vec4 iA, iB; varying float vAlong; varying vec3 vC; varying float vF;
        ${SEA_GLSL}
        void main() {
          float ph = iB.x + lTime * iB.z * 1.6, pulse = 0.5 + 0.5 * sin(ph);
          vec3 q = position;
          // the bell squeezes and opens, the tentacles trail and sway
          float bell = 1.0 - step(0.25, along);
          q.xz *= 1.0 + bell * (pulse - 0.5) * 0.3;
          q.y *= 1.0 - bell * (pulse - 0.5) * 0.2;
          q.x += (1.0 - bell) * sin(lTime * 1.3 + along * 6.0 + iB.x) * 0.15 * along;
          vec3 P = iA.xyz + vec3(sin(lTime * 0.05 + iB.x) * 6.0, sin(lTime * 0.2 + iB.x * 3.0) * 2.0, cos(lTime * 0.04 + iB.x) * 6.0);
          vec3 wp = P + q * iA.w;
          vAlong = along;
          vec3 base = iB.w < 0.5 ? vec3(0.15, 0.7, 1.0) : iB.w < 0.8 ? vec3(0.9, 0.25, 0.85) : vec3(0.3, 1.0, 0.6);
          vC = base * (0.6 + 0.8 * pulse) * seTrans(cameraPosition, wp, lvl);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vF = smoothstep(2.0, 8.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vAlong; varying vec3 vC; varying float vF;
        void main() {
          float k = vAlong < 0.25 ? 0.5 + 0.9 * smoothstep(0.15, 0.25, vAlong) : 0.8 * (1.0 - vAlong);
          gl_FragColor = vec4(vC * k * vF * 1.4, 1.0);
        }`,
    });
    this.jelly = new THREE.Mesh(gj, jm);
    this.jelly.frustumCulled = false;
    this.jelly.name = 'jellyfish';
    this.jellyMat = jm;
    scene.add(this.jelly);
    // the specks: a box of points that wraps round the camera, drifting slowly; seen only under the sea
    const NS = Math.round(2500 * Math.max(0.5, this.dens)), sp = new Float32Array(NS * 3);
    for (let i = 0; i < NS; i++) sp.set([rnd() * 60, rnd() * 60, rnd() * 60], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { lTime: LIFE_U.lTime, lvl: { value: 0 }, pr: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform float lTime, lvl, pr; varying float vA;
        void main() {
          vec3 c = cameraPosition, p = position + vec3(lTime * 0.3, -lTime * 0.15, lTime * 0.1);
          p = c + mod(p - c + 30.0, 60.0) - 30.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = (c.y < lvl && p.y < lvl) ? smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(16.0, 30.0, d)) : 0.0;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.012 * pr * projectionMatrix[1][1] * 360.0 / d, 1.0, 3.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(vec3(0.12, 0.2, 0.22) * vA, 1.0); }`,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.name = 'marine-snow';
    scene.add(this.snow);
  }

  // every frame: the clock; new schools ahead of the player over open water; breaches when the player comes; the
  // giant along its way; splashes and bubbles where ships cross the sea or run under it
  update(t, dt, camera, s, lvl, ships, pr = 1) {
    LIFE_U.lTime.value = t;
    if (this.on === false) return;
    this.spray.U.lvl.value = lvl; this.spray.U.pr.value = pr;
    this.jellyMat.uniforms.lvl.value = lvl; this.snowMat.uniforms.lvl.value = lvl; this.snowMat.uniforms.pr.value = pr;
    const tr = this.track, rnd = this.rnd, f = {};
    // schools: one every ~0.5-1.2 s somewhere 150-450 m ahead, off to a side, where the track runs over the sea
    if (s !== null && t > (this.nextSchool ?? 0)) {
      this.nextSchool = t + 0.5 + rnd() * 0.7;
      const ahead = tr.wrap(s + 90 + rnd() * 220);
      tr.frame(ahead, f);
      if (f.P.y > SEA_Y + 1.5 && f.P.y < SEA_Y + 40) {
        const sd = rnd() < 0.5 ? -1 : 1, lat = sd * (36 + rnd() * 90);
        const x = f.P.x + f.R.x * lat, z = f.P.z + f.R.z * lat;
        const a = Math.atan2(f.T.z, f.T.x) + (rnd() - 0.5) * 2.2;
        this.school(x, z, a, t + 0.4, rnd() < 0.18);
      }
    }
    // breaches: each leviathan's launch timed so it tops its leap as the player comes past (at their speed)
    if (s !== null && this.lastS !== null) {
      const v = Math.max(80, Math.min(350, tr.wrap(s - this.lastS) / Math.max(dt, 1e-3)));
      for (const E of this.levs) {
        const lead = v * (E.T * 0.5 + 0.5);
        const trig = tr.wrap(E.s - lead);
        const crossed = tr.inSpan(trig, this.lastS, s) && tr.wrap(s - this.lastS) < 400;
        if (crossed && t - E.t0 > E.T + 20) {
          E.t0 = t + 0.5;
          // spray: bursting out, crashing back
          const out = E.L.clone(), back = E.L.clone().addScaledVector(E.dir, E.vh * E.T);
          this.spray.splash(out, E.t0, 16, rnd, E.dir);
          this.spray.splash(back, E.t0 + E.T, 22, rnd, E.dir);
          this.ring(out.x, out.z, E.t0, 14); this.ring(back.x, back.z, E.t0 + E.T, 20);
        }
      }
    }
    this.lastS = s;
    for (const E of this.levs) {
      this.leviathanAt(E, t);
      const dt0 = t - E.t0;
      if (E.mesh.visible && dt0 > 0 && dt0 < E.T) {
        const M = E.mesh.matrix, p = new THREE.Vector3();
        for (let k = 0; k < 14; k++) {
          p.set((rnd() - 0.5) * 0.12, -0.05 + rnd() * 0.06, rnd() - 0.5).multiplyScalar(E.len).applyMatrix4(M);
          this.spray.add(p, (rnd() - 0.5) * 3, -1 - rnd() * 2, (rnd() - 0.5) * 3, t, 2, 0);
        }
      }
    }
    // the giant: along its way and back, slowly
    {
      const G2 = this.giant, L2 = 2 * G2.length, d = (((t * G2.speed) % L2) + L2) % L2, u = Math.min(1, Math.max(0, (d < G2.length ? d : L2 - d) / G2.length));
      const p = G2.curve.getPointAt(u), tg = G2.curve.getTangentAt(u).multiplyScalar(d < G2.length ? 1 : -1);
      const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tg).normalize(), y = new THREE.Vector3().crossVectors(tg, x);
      G2.mesh.matrix.makeBasis(x, y, tg).setPosition(p);
      G2.mesh.visible = camera.position.y < lvl + 30 && camera.position.distanceTo(p) < 900;
    }
    // ships crossing the sea: a splash where they go in or come out; bubbles behind them under it
    for (const e of ships) {
      const p = e.pos, w = waveHeight(p.x, p.z, t), under = p.y < w;
      if (e.under !== undefined && e.under !== under && e.speed > 20) {
        const sz = 6 + Math.min(10, e.speed / 30);
        this.spray.splash({ x: p.x, y: w, z: p.z }, t, sz, rnd, e.dir);
        this.ring(p.x, p.z, t, sz);
      }
      e.under = under;
      if (under && e.near) for (let k = 0; k < 3; k++) {
        this.spray.add({ x: p.x - e.dir.x * 6 + (rnd() - 0.5) * 2, y: p.y + (rnd() - 0.5), z: p.z - e.dir.z * 6 + (rnd() - 0.5) * 2 },
          (rnd() - 0.5) * 2, rnd(), (rnd() - 0.5) * 2, t, 3, 2);
      }
    }
    this.spray.flush();
  }

  // the setting: all of it shown or none
  setOn(on) {
    this.on = on;
    for (const m of this.meshes) m.visible = on && m !== this.giant.mesh && !this.levs.some((L) => L.mesh === m);
    if (!on) { this.giant.mesh.visible = false; for (const E of this.levs) E.mesh.visible = false; }
  }
}
