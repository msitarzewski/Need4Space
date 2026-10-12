// The forest moon's fliers:
//  - sky rays: manta-like, 14-26 m across, in pods on slow loops through the open air between the islands (some
//    over the track, high enough); their wings beat in a wave from the body out to the tips, the tail whips
//  - birds: flocks wheeling round the islands - every bird's flight worked out on the GPU from its flock's loop, its
//    own wandering offset and the time (no work a frame on the CPU), wings flapping
//  - sky whales: a few vast ones (~200 m) drifting high in the distance, fins rowing slowly
// Their paths keep clear of the islands (sampled against each island's bounds) and of the track.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
export const CREATURE_U = { cTime: { value: 0 } };

// ---------------------------------------------------------------- geometry
// a manta: a top and a bottom surface over its planform (x across -1..1, z along: +1 the head), a whip tail;
// 'span' (|x|) drives the wing's beat in the shader
function rayGeometry() {
  const NX = 24, NZ = 14, pos = [], span = [], idx = [];
  const lead = (x) => 0.42 - 0.62 * Math.pow(Math.abs(x), 1.3);        // the leading edge (z), swept back
  const trail = (x) => -0.3 + 0.5 * Math.pow(Math.abs(x), 1.1) - 0.2 * Math.pow(Math.abs(x), 4);
  const thick = (x, t) => 0.07 * Math.pow(1 - Math.abs(x), 1.6) * Math.sin(Math.PI * t) + 0.004;
  for (const side of [1, -1]) {                                       // top, then bottom
    const base = pos.length / 3;
    for (let i = 0; i <= NX; i++) {
      const x = -1 + (2 * i) / NX, zl = lead(x), zt = Math.min(trail(x), zl - 0.01);
      for (let j = 0; j <= NZ; j++) {
        const t = j / NZ, z = zt + (zl - zt) * t;
        pos.push(x, side * thick(x, t) * (side > 0 ? 1 : 0.6), z);
        span.push(Math.abs(x));
      }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const a = base + i * (NZ + 1) + j, b = a + 1, c = a + NZ + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // the tail: a thin tapering ribbon (cross) back from the body
  const tb = pos.length / 3;
  for (let k = 0; k <= 10; k++) {
    const z = -0.28 - k * 0.12, w = 0.02 * (1 - k / 11);
    pos.push(-w, 0, z, w, 0, z, 0, -w, z, 0, w, z);
    span.push(0, 0, 0, 0);
  }
  for (let k = 0; k < 10; k++) {
    const a = tb + k * 4;
    idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a bird: body, two wings (each two panels: the hand bends), tail - ~40 triangles; 'span' as for the ray
function birdGeometry() {
  const pos = [], span = [], idx = [];
  const v = (x, y, z, s) => { pos.push(x, y, z); span.push(s); return pos.length / 3 - 1; };
  // body: a thin double cone along z
  const nose = v(0, 0, 0.5, 0), tail = v(0, 0, -0.45, 0), ring = [];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ring.push(v(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.1, 0)); }
  for (let k = 0; k < 5; k++) { const a = ring[k], b = ring[(k + 1) % 5]; idx.push(nose, b, a, tail, a, b); }
  for (const sd of [1, -1]) {
    const r0 = v(sd * 0.05, 0, 0.2, 0.05), r1 = v(sd * 0.05, 0, -0.1, 0.05);
    const m0 = v(sd * 0.55, 0, 0.18, 0.55), m1 = v(sd * 0.55, 0, -0.12, 0.55);
    const t0 = v(sd * 1.0, 0, 0.0, 1.0), t1 = v(sd * 0.95, 0, -0.18, 1.0);
    const q = sd > 0 ? (a, b, c) => idx.push(a, b, c) : (a, b, c) => idx.push(a, c, b);
    q(r0, m0, r1); q(r1, m0, m1); q(m0, t0, m1); q(m1, t0, t1);
  }
  const t0 = v(0, 0, -0.35, 0), t1 = v(0.18, 0, -0.65, 0), t2 = v(-0.18, 0, -0.65, 0);
  idx.push(t0, t1, t2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a sky whale: a long body (a tube of varying girth along z, +z the head), four fins and a fluke; 'span' marks the
// fins (their rowing), 'along' the body's wave
function whaleGeometry() {
  const pos = [], span = [], along = [], idx = [];
  const NZ = 40, NA = 16;
  const girth = (t) => 0.11 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)), 0.75) * (1 - 0.35 * t);
  for (let i = 0; i <= NZ; i++) {
    const t = i / NZ, z = 0.5 - t, r = girth(t);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU;
      pos.push(Math.cos(a) * r * 1.1, Math.sin(a) * r * (0.85 + 0.15 * Math.sin(a)), z); span.push(0); along.push(t);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    idx.push(a, c, b, b, c, d);
  }
  // fins: flat, swept; two pairs, and the fluke
  const fin = (z0, len, w, sweep, y) => {
    for (const sd of [1, -1]) {
      const b = pos.length / 3;
      const pts = [[0.08, z0 + w / 2], [0.08, z0 - w / 2], [0.08 + len, z0 - w / 2 - sweep], [0.08 + len * 0.95, z0 - sweep + w * 0.1]];
      for (const [x, z] of pts) { pos.push(sd * x, y, z); span.push(Math.max(0, (x - 0.08) / len)); along.push(0.5 - z); }
      if (sd > 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
      else idx.push(b, b + 2, b + 1, b, b + 3, b + 2, b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  fin(0.22, 0.42, 0.14, 0.12, -0.03);
  fin(0.0, 0.26, 0.1, 0.08, -0.02);
  fin(-0.47, 0.16, 0.06, 0.05, 0.0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- materials
// the skin: dark above, pale beneath, mottled; rows of glowing spots along the wings' edges (rays, whales)
function skinMaterial({ top, belly, glow = null, beat, key }) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CREATURE_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float cTime; attribute float span; attribute float phase; varying vec3 vCL; varying float vSpan;
#ifdef WHALE
attribute float along;
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vCL = position; vSpan = span;
  ${beat}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float cTime; varying vec3 vCL; varying float vSpan;
float cH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float cN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(cH(i), cH(i + vec2(1, 0)), u.x), mix(cH(i + vec2(0, 1)), cH(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float up = step(0.0, vCL.y + 0.0005);
    float mott = cN(vCL.xz * 22.0) * 0.6 + cN(vCL.xz * 60.0) * 0.4;
    diffuseColor.rgb = mix(${belly}, ${top}, up) * (0.8 + 0.4 * mott);
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${glow ? `{
    // spots in rows along the edges and the back
    vec2 q = vCL.xz * vec2(28.0, 28.0);
    float spot = smoothstep(0.32, 0.1, length(fract(q) - 0.5)) * step(0.55, cH(floor(q)));
    float band = smoothstep(0.75, 0.9, vSpan) + smoothstep(0.03, 0.0, abs(vCL.x) - 0.04);
    totalEmissiveRadiance += ${glow} * spot * clamp(band, 0.0, 1.0) * (0.6 + 0.4 * sin(cTime * 2.0 + vCL.z * 20.0));
  }` : ''}`);
  };
  m.defines = key === 'whale' ? { WHALE: '' } : {};
  m.customProgramCacheKey = () => 'forest-' + key;
  return m;
}

// ---------------------------------------------------------------- paths through the open air
// a closed loop of `n` points round centre c (radius r, height wobble h), each pushed clear of every island (bounds
// grown by `margin`) and of the track (`over` m above it at least where it passes over)
function clearLoop(c, r, h, n, islands, nearTrack, over, rnd) {
  const pts = [];
  const ph = rnd() * TAU, e = 0.6 + rnd() * 0.6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + ph;
    const p = new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a * 2 + ph) * h, c.z + Math.sin(a) * r * e);
    for (let it = 0; it < 12; it++) {
      let moved = false;
      for (const I of islands) {
        const dx = p.x - I.x, dz = p.z - I.z, rr = Math.max(I.rx, I.rz) * 1.35 + 50;
        if (dx * dx + dz * dz < rr * rr && p.y < I.top + 60 && p.y > I.top - I.depth - 60) {
          // over it if it is near its top, else round it
          if (p.y > I.top - 80) p.y = I.top + 70;
          else { const d = Math.hypot(dx, dz) || 1; p.x = I.x + (dx / d) * rr; p.z = I.z + (dz / d) * rr; }
          moved = true;
        }
      }
      const t = nearTrack(p);
      if (t && t.y < over && t.y > -over) { p.y += over - t.y; moved = true; }
      if (!moved) break;
    }
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export class Creatures {
  // islands: [{ x, z, top, rx, rz, depth }]; nearTrack(p) -> { y: height over the deck } or null
  constructor(scene, islands, nearTrack, centre) {
    const rnd = mulberry32(1234);
    this.list = [];
    // ---- sky rays: pods on loops
    const rayGeo = rayGeometry();
    this.rayMat = skinMaterial({
      top: 'vec3(0.035, 0.045, 0.055)', belly: 'vec3(0.42, 0.44, 0.4)', glow: 'vec3(0.1, 0.9, 0.75) * 1.2', key: 'ray',
      beat: `{
        float s = span;
        float w = sin(cTime * 1.4 + phase - s * 2.4);
        transformed.y += w * 0.32 * pow(s, 1.5);
        transformed.z += sin(cTime * 1.4 + phase - s * 2.4 + 1.2) * 0.05 * s;
        // the tail whips
        if (position.z < -0.27) { float tz = -position.z - 0.27; transformed.x += sin(cTime * 2.2 + phase - tz * 4.0) * 0.12 * tz; transformed.y += sin(cTime * 1.4 + phase - tz * 3.0) * 0.08 * tz; }
      }` });
    this.pods = [];
    const podCentres = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + rnd() * 0.5, d = 600 + rnd() * 900;
      podCentres.push(new THREE.Vector3(centre.x + Math.cos(a) * d, -60 + rnd() * 260, centre.z + Math.sin(a) * d));
    }
    let nr = 0;
    for (const c of podCentres) {
      const curve = clearLoop(c, 350 + rnd() * 450, 40 + rnd() * 50, 14, islands, nearTrack, 45, rnd);
      const n = 2 + Math.floor(rnd() * 4), L = curve.getLength();
      const pod = { curve, L, speed: 16 + rnd() * 8, members: [] };
      for (let m = 0; m < n; m++) pod.members.push({ lag: m * (26 + rnd() * 20), side: (rnd() - 0.5) * 50, up: (rnd() - 0.5) * 24, size: 14 + rnd() * 12, phase: rnd() * TAU, i: nr++ });
      this.pods.push(pod);
    }
    const ph = new Float32Array(nr);
    this.pods.forEach((p) => p.members.forEach((m) => (ph[m.i] = m.phase)));
    rayGeo.setAttribute('phase', new THREE.InstancedBufferAttribute(ph, 1));
    this.rays = new THREE.InstancedMesh(rayGeo, this.rayMat, nr);
    this.rays.frustumCulled = false;
    this.rays.castShadow = true;
    scene.add(this.rays);

    // ---- birds: whole flocks on the GPU
    const birdGeo = new THREE.InstancedBufferGeometry().copy(birdGeometry());
    const flocks = [];
    for (const I of islands.filter((i) => !i.far).sort(() => rnd() - 0.5).slice(0, 9)) {
      flocks.push({ c: new THREE.Vector3(I.x, I.top + 30 + rnd() * 40, I.z), r: Math.max(I.rx, I.rz) * 1.2 + 40, n: 30 + Math.floor(rnd() * 40) });
    }
    const total = flocks.reduce((a, f) => a + f.n, 0), fa = new Float32Array(total * 4), fb = new Float32Array(total * 4);
    let b = 0;
    for (const f of flocks) for (let k = 0; k < f.n; k++, b++) {
      fa.set([f.c.x, f.c.y, f.c.z, f.r], b * 4);
      fb.set([rnd() * TAU, 0.05 + rnd() * 0.04, rnd() * 1000, 1.6 + rnd() * 1.4], b * 4);   // phase, angular speed, seed, size
    }
    birdGeo.setAttribute('flockA', new THREE.InstancedBufferAttribute(fa, 4));
    birdGeo.setAttribute('flockB', new THREE.InstancedBufferAttribute(fb, 4));
    birdGeo.instanceCount = total;
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.7, side: THREE.DoubleSide });
    birdMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, CREATURE_U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float cTime; attribute float span; attribute vec4 flockA; attribute vec4 flockB;
// a bird's place at time t: round its flock's loop, wandering about it
vec3 birdAt(float t) {
  float a = flockB.x + t * flockB.y, s = flockB.z;
  vec3 c = flockA.xyz + vec3(cos(a) * flockA.w, sin(a * 2.0 + s) * 12.0, sin(a) * flockA.w * 0.8);
  vec3 o = vec3(sin(t * 0.31 + s) * 22.0 + sin(t * 0.83 + s * 2.1) * 9.0, sin(t * 0.47 + s * 1.3) * 10.0, cos(t * 0.37 + s * 0.7) * 22.0 + sin(t * 0.91 + s) * 8.0);
  return c + o;
}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 bp = birdAt(cTime), bf = normalize(birdAt(cTime + 0.1) - bp);
  vec3 br = normalize(cross(vec3(0.0, 1.0, 0.0), bf)), bu = cross(bf, br);
  float flap = sin(cTime * 9.0 + flockB.z) * 0.55 * span;
  vec3 lp = transformed * flockB.w;
  lp.y += flap * flockB.w;
  transformed = bp + br * lp.x + bu * lp.y + bf * lp.z;`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = vec3(0.0, 1.0, 0.0);');
    };
    birdMat.customProgramCacheKey = () => 'forest-bird';
    this.birds = new THREE.Mesh(birdGeo, birdMat);
    this.birds.frustumCulled = false;
    scene.add(this.birds);

    // ---- sky whales: high and far, slow
    const wGeo = whaleGeometry();
    this.whaleMat = skinMaterial({
      top: 'vec3(0.09, 0.11, 0.14)', belly: 'vec3(0.55, 0.55, 0.52)', glow: 'vec3(0.3, 0.7, 1.0) * 0.6', key: 'whale',
      beat: `{
        float t = along;
        transformed.y += sin(cTime * 0.35 + phase - t * 4.0) * 0.025 * t;
        transformed.x += sin(cTime * 0.28 + phase - t * 3.0) * 0.012 * t;
        transformed.y += sin(cTime * 0.6 + phase - span * 1.5) * 0.12 * span * span;
      }` });
    this.whales = [];
    const wn = 3, wph = new Float32Array(wn);
    for (let k = 0; k < wn; k++) {
      const a = rnd() * TAU, d = 2800 + rnd() * 2600;
      const c = new THREE.Vector3(centre.x + Math.cos(a) * d * 0.4, 900 + rnd() * 450, centre.z + Math.sin(a) * d * 0.4);
      const curve = clearLoop(c, d, 60, 16, islands, nearTrack, 200, rnd);
      this.whales.push({ curve, L: curve.getLength(), speed: 9 + rnd() * 5, size: 170 + rnd() * 90, off: rnd() });
      wph[k] = rnd() * TAU;
    }
    wGeo.setAttribute('phase', new THREE.InstancedBufferAttribute(wph, 1));
    this.whaleMesh = new THREE.InstancedMesh(wGeo, this.whaleMat, wn);
    this.whaleMesh.frustumCulled = false;
    scene.add(this.whaleMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
  }

  // a creature on its loop at distance s: its matrix (facing along the loop, banking into the turn)
  place(curve, L, s, side, up, size, out, speed = 20) {
    const u = ((s / L) % 1 + 1) % 1, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const du = 0.004, t2 = curve.getTangentAt((u + du) % 1);
    // banked into the turn as a flier would be: tan(bank) = v^2 curvature / g
    const kappa = new THREE.Vector3().crossVectors(t, t2).y / (du * L);
    const right = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
    const bank = Math.max(-0.7, Math.min(0.7, -Math.atan(speed * speed * kappa / 9.8)));
    const upv = new THREE.Vector3(0, 1, 0).applyAxisAngle(t, bank);
    const r = new THREE.Vector3().crossVectors(upv, t).normalize().multiplyScalar(-1);
    p.addScaledVector(right, side).y += up;
    this._m.makeBasis(r.negate(), upv, t).scale(new THREE.Vector3(size, size, size)).setPosition(p);
    out.copy(this._m);
  }

  whalePos(k) {
    if (!this.whaleMesh || k >= this.whales.length) return null;
    this.whaleMesh.getMatrixAt(k, this._m);
    return new THREE.Vector3().setFromMatrixPosition(this._m);
  }

  update(t) {
    CREATURE_U.cTime.value = t;
    const M = new THREE.Matrix4();
    for (const pod of this.pods) for (const m of pod.members) {
      this.place(pod.curve, pod.L, t * pod.speed - m.lag, m.side, m.up + Math.sin(t * 0.3 + m.phase) * 4, m.size, M, pod.speed);
      this.rays.setMatrixAt(m.i, M);
    }
    this.rays.instanceMatrix.needsUpdate = true;
    this.whales.forEach((w, k) => {
      this.place(w.curve, w.L, t * w.speed + w.off * w.L, 0, 0, w.size, M, w.speed);
      this.whaleMesh.setMatrixAt(k, M);
    });
    this.whaleMesh.instanceMatrix.needsUpdate = true;
  }
}
