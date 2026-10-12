// The desert's wind, on the GPU: every particle's motion is worked out in its vertex shader from its seed and the time
// (the CPU writes only what is newly emitted).
//  - sand blowing across the circuit: low veils of fine sand and single grains streaking past, gathered into bands that
//    drift with the wind, hugging the deck (thicker and redder in the sandstorm)
//  - wakes: sand torn off the dunes under a ship skimming them low, billowing out and drifting downwind
//  - dust devils: whirling columns wandering over the dunes, a funnel of dust twisting up off a skirt of sand
// And the heat shimmer over the sand: a pass that bends the picture along the horizon, rising.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mulberry32 } from './noise.js';
import { DUST_GLSL, WIND, stormDepth } from './haze.js';

const WIND_V = WIND.clone().multiplyScalar(24);                 // m/s

const NOISE = /* glsl */`
float smH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float smN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(smH(i), smH(i + vec3(1, 0, 0)), f.x), mix(smH(i + vec3(0, 1, 0)), smH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(smH(i + vec3(0, 0, 1)), smH(i + vec3(1, 0, 1)), f.x), mix(smH(i + vec3(0, 1, 1)), smH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
// sand in the air, lit by the low sun: bright looking toward it (grains scatter forward), the sky's rose away from it;
// deep: how deep in the storm (darker, redder)
const SAND_LIGHT = /* glsl */`
vec3 smLight(vec3 dir, float deep) {
  float fw = max(dot(dir, DA_SUN), 0.0);
  vec3 c = vec3(0.2, 0.1, 0.07) + DA_SUNRAD * vec3(0.5, 0.36, 0.24) * (0.05 + 0.25 * pow(fw, 4.0) + 0.7 * pow(fw, 24.0));
  return mix(c, vec3(0.3, 0.09, 0.025), deep);
}`;
// a camera-facing quad stretched along a velocity (the camera's own taken off)
const STRETCH = /* glsl */`
vec4 smStreak(vec3 p, vec3 vel, float size, float shutter, float maxLen, out float k) {
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 d = normalize(mv.xyz), tr = (viewMatrix * vec4(vel, 0.0)).xyz * shutter;
  tr -= d * dot(tr, d);
  tr *= min(1.0, maxLen / max(length(tr), 1e-4));
  float len = length(tr);
  vec3 ax = len > 1e-5 ? tr / len : vec3(0.0, 1.0, 0.0);
  vec3 sd = normalize(cross(d, ax));
  mv.xyz += sd * position.x * size + ax * (position.y * (len + size)) - tr * 0.5;
  k = len / max(size, 1e-4);
  return projectionMatrix * mv;
}`;

function quads(n, seedFn) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  const seed = new Float32Array(n * 4), rnd = mulberry32(n + 7);
  for (let i = 0; i < n; i++) seed.set(seedFn(rnd, i), i * 4);
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = n;
  return g;
}

export class Simoom {
  // devils: [{ x, z, y (the sand), r: wander radius }]
  constructor(scene, dens = 1, devils = []) {
    this.camVel = new THREE.Vector3();
    this.cam = new THREE.Vector3();
    const U = { time: { value: 0 }, cam: { value: this.cam }, camVel: { value: this.camVel }, wind: { value: WIND_V.clone() },
      pr: { value: 1 }, deep: { value: 0 } };
    this.U = U;
    // ---- the blowing sand
    const NS = Math.round(5600 * dens), BOX = 150, BOXV = 24;
    this.deckP = new THREE.Vector3(); this.deckU = new THREE.Vector3(0, 1, 0);
    this.streams = new THREE.Mesh(quads(NS, (r) => [r(), r(), r(), r()]), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...U, k: { value: 1 }, deckP: { value: this.deckP }, deckU: { value: this.deckU } },
      vertexShader: /* glsl */`
        ${DUST_GLSL}
        ${NOISE}
        ${STRETCH}
        ${SAND_LIGHT}
        uniform float time, k, deep; uniform vec3 cam, camVel, wind, deckP, deckU;
        attribute vec4 seed;
        varying vec2 vUv; varying float vA; varying float vK; varying vec3 vC; varying float vVeil;
        void main() {
          vUv = uv;
          float veil = step(seed.w, 0.5);
          float spd = 0.7 + 0.6 * fract(seed.w * 7.3) + deep * 0.8;
          vec3 box = vec3(${BOX.toFixed(1)}, ${BOXV.toFixed(1)}, ${BOX.toFixed(1)}), ctr = cam - vec3(0.0, 3.0, 0.0);
          vec3 p = seed.xyz * box + wind * spd * time + vec3(0.0, sin(time * 2.1 + seed.w * 40.0) * 0.5, 0.0);
          p = mod(p - ctr + box * 0.5, box) - box * 0.5 + ctr;
          // the bands the wind carries it in (in the storm, everywhere)
          float n = smN((p - wind * time * 0.8) * vec3(0.014, 0.05, 0.014)) * 0.75 + smN(p * 0.045 - time * 0.25) * 0.25;
          float on = mix(smoothstep(0.45, 0.66, n), 0.8 + 0.2 * n, deep);
          // hugging the deck: thickest in its first metres, none under it (in the storm: the whole air)
          float h = dot(p - deckP, deckU);
          float slab = mix(smoothstep(-0.4, 0.6, h) * smoothstep(9.0, 1.5, h), 1.0, deep * 0.85);
          vec3 rel = p - cam; float d = length(rel);
          float a = on * slab * mix(smoothstep(${(BOX * 0.5).toFixed(1)}, ${(BOX * 0.2).toFixed(1)}, d), smoothstep(52.0, 18.0, d), veil) * smoothstep(1.5, 6.0, d);
          float kk;
          float size = veil > 0.5 ? 0.6 + 1.4 * fract(seed.w * 13.1) : 0.06 + 0.07 * fract(seed.w * 5.7);
          gl_Position = a > 0.003 ? smStreak(p, wind * spd - camVel, size, veil > 0.5 ? 0.3 : 0.03, veil > 0.5 ? 14.0 : 6.0, kk) : vec4(0.0, 0.0, -2.0, 1.0);
          vK = kk; vVeil = veil;
          vA = a * (veil > 0.5 ? 0.45 + 0.25 * deep : 0.9) * (1.0 + 0.35 * kk) / (1.0 + kk) * k;
          vC = smLight(normalize(rel), deep) * (veil > 0.5 ? 1.2 : 2.2);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying float vK; varying vec3 vC; varying float vVeil;
        void main() {
          vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0 * (vK + 1.0));
          q.y = max(abs(q.y) - vK, 0.0);
          float m = max(1.0 - length(q), 0.0);
          gl_FragColor = vec4(vC, (vVeil > 0.5 ? m : m * m) * vA);
        }`,
    }));
    // ---- wakes: a ring of emitted puffs (p0, t0 | v0, size)
    const NW = (this.NW = 3072);
    const wq = new THREE.PlaneGeometry(1, 1), wg = new THREE.InstancedBufferGeometry();
    wg.index = wq.index;
    wg.setAttribute('position', wq.attributes.position);
    wg.setAttribute('uv', wq.attributes.uv);
    this.wA = new THREE.InstancedBufferAttribute(new Float32Array(NW * 4).fill(-1e4), 4);
    this.wB = new THREE.InstancedBufferAttribute(new Float32Array(NW * 4), 4);
    this.wA.setUsage(THREE.DynamicDrawUsage); this.wB.setUsage(THREE.DynamicDrawUsage);
    wg.setAttribute('wa', this.wA);
    wg.setAttribute('wb', this.wB);
    wg.instanceCount = NW;
    this.wakes = new THREE.Mesh(wg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...U },
      vertexShader: /* glsl */`
        ${DUST_GLSL}
        ${SAND_LIGHT}
        uniform float time, deep; uniform vec3 cam, wind;
        attribute vec4 wa; attribute vec4 wb;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        void main() {
          vUv = uv; vR = fract(wa.w * 13.7);
          float age = time - wa.w, life = 2.6;
          if (age < 0.0 || age > life) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vA = 0.0; return; }
          float f = age / life;
          // thrown up and out off the sand, braked by the air, carried off downwind, settling
          vec3 p = wa.xyz + wb.xyz * (1.0 - exp(-2.5 * age)) / 2.5 + wind * 0.5 * age + vec3(0.0, -1.5 * age * age, 0.0);
          float size = wb.w * (1.2 + 4.0 * sqrt(f));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float rot = vR * 6.28 + age * 0.6;
          vec2 c = vec2(cos(rot), sin(rot));
          mv.xy += mat2(c.x, c.y, -c.y, c.x) * position.xy * size;
          gl_Position = projectionMatrix * mv;
          vec3 rel = p - cam; float d = length(rel);
          vA = smoothstep(0.0, 0.06, f) * (1.0 - f) * (1.0 - f) * smoothstep(3.0, 12.0, d) * 0.75;
          vec3 T, L;
          daPath(cam, rel / max(d, 1e-3), d, T, L);
          vC = smLight(rel / max(d, 1e-3), deep) * 1.3 * T + L;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        ${NOISE}
        void main() {
          vec2 q = vUv - 0.5;
          float lump = smN(vec3(q * 4.0, vR * 7.0)) * 0.7 + smN(vec3(q * 9.0, vR * 3.0)) * 0.3;
          float m = smoothstep(1.0, 0.1, length(q) * 2.0 + (lump - 0.5) * 0.8);
          gl_FragColor = vec4(vC, m * vA);
        }`,
    }));
    this.wI = 0;
    // ---- dust devils: each a funnel of puffs (seed: devil, height share, angle, size)
    const per = 280, ND = devils.length;
    this.devilList = devils;
    const dg = quads(Math.max(1, ND * per), (r, i) => [Math.floor(i / per), r(), r(), r()]);
    this.devilC = new Float32Array(Math.max(1, ND) * 4);
    devils.forEach((d, k) => this.devilC.set([d.x, d.y, d.z, d.h], k * 4));
    this.devilU = { value: [] };
    for (let k = 0; k < Math.max(1, ND); k++) this.devilU.value.push(new THREE.Vector4(...(devils[k] ? [devils[k].x, devils[k].y, devils[k].z, devils[k].h] : [0, -1e4, 0, 1])));
    this.devils = new THREE.Mesh(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...U, dv: this.devilU },
      vertexShader: /* glsl */`
        ${DUST_GLSL}
        ${SAND_LIGHT}
        uniform float time, pr; uniform vec3 cam; uniform vec4 dv[${Math.max(1, ND)}];
        attribute vec4 seed;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        void main() {
          vUv = uv; vR = seed.w;
          vec4 D = dv[int(seed.x + 0.5)];
          // up the funnel over ~4 s, round and round; wider and thinner as it climbs
          float u = fract(seed.y + time * (0.18 + 0.08 * seed.w));
          float H = D.w, y = u * u * H;
          float r = 2.0 + 0.16 * y + 9.0 * exp(-y / 4.0) * seed.z;
          float ang = seed.z * 6.2831853 + time * (3.4 - 1.4 * u) + y * 0.05;
          // the column sways
          vec3 c = D.xyz + vec3(sin(time * 0.31 + seed.x) * 6.0 + sin(y * 0.03 + time * 0.7) * y * 0.08, 0.0, cos(time * 0.27 + seed.x * 2.0) * 6.0);
          vec3 p = c + vec3(cos(ang) * r, y, sin(ang) * r);
          float size = 4.0 + 0.13 * y + 7.0 * exp(-y / 6.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
          vec3 rel = p - cam; float d = length(rel);
          vA = smoothstep(0.0, 0.06, u) * (1.0 - u * 0.8) * 0.5 * smoothstep(8.0, 40.0, d);
          vec3 T, L;
          daPath(cam, rel / max(d, 1e-3), d, T, L);
          vC = smLight(rel / max(d, 1e-3), 0.0) * 1.5 * T + L;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        ${NOISE}
        void main() {
          vec2 q = vUv - 0.5;
          float lump = smN(vec3(q * 5.0, vR * 9.0));
          float m = smoothstep(1.0, 0.15, length(q) * 2.0 + (lump - 0.5) * 0.9);
          gl_FragColor = vec4(vC, m * vA);
        }`,
    }));
    this.devils.visible = ND > 0;
    for (const m of [this.streams, this.wakes, this.devils]) { m.frustumCulled = false; m.renderOrder = 3; scene.add(m); }
    this.meshes = [this.streams, this.wakes, this.devils];
    this.last = null;
    this._v = new THREE.Vector3();
  }

  // n puffs of sand off the dunes at p, thrown up and out at a share of the ship's velocity
  emit(p, vel, n, t) {
    const A = this.wA.array, B = this.wB.array;
    for (let k = 0; k < n; k++) {
      const i = this.wI++ % this.NW, r = () => Math.random() - 0.5, up = 10 + Math.random() * 16;
      A[i * 4] = p.x + r() * 10; A[i * 4 + 1] = p.y + Math.random(); A[i * 4 + 2] = p.z + r() * 10; A[i * 4 + 3] = t - Math.random() * 0.016;
      B[i * 4] = vel.x * 0.35 + r() * 24; B[i * 4 + 1] = up; B[i * 4 + 2] = vel.z * 0.35 + r() * 24;
      B[i * 4 + 3] = 1.4 + Math.random() * 2.4;
    }
    this.dirty = true;
  }

  // ships: [{ pos, vel, sides (the sand beside the deck either side of it), low (0..1: the deck near the sand) }]
  // deck: the track's frame by the camera ({ P, U }): the blowing sand hugs its plane
  update(t, dt, camera, pr, ships, inCave = 0, deck = null) {
    if (deck) { this.deckP.copy(deck.P); this.deckU.copy(deck.U); }
    const U = this.U;
    U.time.value = t;
    U.pr.value = pr;
    U.deep.value = this.stormOn ? Math.min(1, stormDepth(camera.position) * 2.2) : 0;
    if (this.last && dt > 0) this.camVel.lerp(this._v.subVectors(camera.position, this.last).divideScalar(dt), 0.5);
    if (this.camVel.lengthSq() > 1e6) this.camVel.set(0, 0, 0);
    (this.last ||= new THREE.Vector3()).copy(camera.position);
    this.cam.copy(camera.position);
    this.streams.material.uniforms.k.value = 1 - inCave;
    if (this.wakes.visible && dt > 0) {
      for (const s of ships) {
        if (s.low <= 0 || s.pos.distanceToSquared(camera.position) > 400 * 400) continue;
        const sp = s.vel.length();
        if (sp < 40) continue;
        s.acc = (s.acc || 0) + dt * Math.min(70, sp * 0.22) * s.low;
        const n = Math.floor(s.acc);
        s.acc -= n;
        for (let j = 0; j < n; j++) this.emit(s.sides[(this.wI + j) & 1], s.vel, 1, t);
      }
    }
    if (this.dirty) { this.wA.needsUpdate = this.wB.needsUpdate = true; this.dirty = false; }
  }
}

// The heat shimmer: the picture bent a pixel or two along the horizon (over the hot sand, where the light runs
// longest through the air near it), the ripples rising; strongest just over the horizon line, fading up and down
export class HeatPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.camera = null;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, invProj: { value: new THREE.Matrix4() }, camRot: { value: new THREE.Matrix4() },
        px: { value: new THREE.Vector2(1, 1) }, strength: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float time, strength; uniform mat4 invProj, camRot; uniform vec2 px; varying vec2 vUv;
        ${NOISE}
        void main() {
          vec4 v = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 d = normalize((camRot * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
          float k = exp(-abs(d.y - 0.004) / 0.03) * strength;
          vec2 uv = vUv;
          if (k > 0.01) {
            // the ripples: fine and rising, in the sky's angles (they stay put as the view turns)
            float az = atan(d.z, d.x);
            vec3 q = vec3(az * 380.0, d.y * 900.0 - time * 7.0, time * 0.9);
            vec2 o = vec2(smN(q) - 0.5, smN(q * 1.7 + 11.0) - 0.5);
            uv += o * px * vec2(1.4, 2.6) * k;
          }
          gl_FragColor = texture2D(tDiffuse, uv);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.quad.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    if (this.camera) { u.invProj.value.copy(this.camera.projectionMatrixInverse); u.camRot.value.extractRotation(this.camera.matrixWorld); }
    u.px.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
