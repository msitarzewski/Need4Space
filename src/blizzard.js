// The ice planet's weather, on the GPU: every particle's motion is worked out in its vertex shader from its seed and
// the time (the CPU writes only what is newly emitted).
//  - streams of snow blowing across the circuit: wisps carried on the wind in bands (a noise field drifting with the
//    wind decides where the air is full of it), each streaked by its motion against the camera's
//  - diamond dust: ice crystals hanging in the air, twinkling - flaring where they lie toward the sun (forward glints)
//  - wakes: frost and ice dust torn off the deck behind every ship, billowing, drifting downwind, thinning out
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { ICE_GLSL } from './frost.js';

export const WIND = new THREE.Vector3(-0.72, 0, 0.69).normalize().multiplyScalar(26);   // from the north-east (m/s)

const NOISE = /* glsl */`
float bzH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bzN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bzH(i), bzH(i + vec3(1, 0, 0)), f.x), mix(bzH(i + vec3(0, 1, 0)), bzH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bzH(i + vec3(0, 0, 1)), bzH(i + vec3(1, 0, 1)), f.x), mix(bzH(i + vec3(0, 1, 1)), bzH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
// snow lit by the dusk: the sky's blue on it, the sun's warmth through it looking toward the sun
const SNOW_LIGHT = /* glsl */`
vec3 bzLight(vec3 dir) {
  float fw = max(dot(dir, IA_SUN), 0.0);
  return vec3(0.07, 0.1, 0.17) + IA_SUNRAD * (0.018 + 0.12 * pow(fw, 6.0) + 0.5 * pow(fw, 40.0));
}`;

// a camera-facing quad stretched along a velocity (the camera's own taken off): fx.js's streaks
const STRETCH = /* glsl */`
vec4 bzStreak(vec3 p, vec3 vel, float size, float shutter, float maxLen, out float k) {
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
  const seed = new Float32Array(n * 4), rnd = mulberry32(n);
  for (let i = 0; i < n; i++) seed.set(seedFn(rnd, i), i * 4);
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = n;
  return g;
}

export class Blizzard {
  constructor(scene, dens = 1) {
    this.camVel = new THREE.Vector3();
    this.cam = new THREE.Vector3();
    const U = { time: { value: 0 }, cam: { value: this.cam }, camVel: { value: this.camVel }, wind: { value: WIND.clone() },
      pr: { value: 1 }, k: { value: 1 } };
    this.U = U;
    // ---- the streams: low over the deck (its plane at the camera: deckP, deckU), veils of fine snow and single
    // flakes streaking past, gathered into bands that drift across the track with the wind
    const NS = Math.round(5200 * dens), BOX = 140, BOXV = 26;
    this.deckP = new THREE.Vector3(); this.deckU = new THREE.Vector3(0, 1, 0);
    this.streams = new THREE.Mesh(quads(NS, (r) => [r(), r(), r(), r()]), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...U, k: { value: 1 }, deckP: { value: this.deckP }, deckU: { value: this.deckU } },
      vertexShader: /* glsl */`
        ${ICE_GLSL}
        ${NOISE}
        ${STRETCH}
        ${SNOW_LIGHT}
        uniform float time, k; uniform vec3 cam, camVel, wind, deckP, deckU;
        attribute vec4 seed;
        varying vec2 vUv; varying float vA; varying float vK; varying vec3 vC; varying float vVeil;
        void main() {
          vUv = uv;
          float veil = step(seed.w, 0.45);
          float spd = 0.75 + 0.5 * fract(seed.w * 7.3);
          vec3 box = vec3(${BOX.toFixed(1)}, ${BOXV.toFixed(1)}, ${BOX.toFixed(1)}), ctr = cam - vec3(0.0, 4.0, 0.0);
          vec3 p = seed.xyz * box + wind * spd * time + vec3(0.0, sin(time * 1.7 + seed.w * 40.0) * 0.7, 0.0);
          p = mod(p - ctr + box * 0.5, box) - box * 0.5 + ctr;
          // the bands of driven snow: a field drifting with the wind, thin in its gaps
          float n = bzN((p - wind * time * 0.85) * vec3(0.016, 0.06, 0.016)) * 0.75 + bzN(p * 0.05 - time * 0.2) * 0.25;
          float on = smoothstep(0.42, 0.62, n);
          // hugging the deck: thickest in its first metres, none under it
          float h = dot(p - deckP, deckU);
          float slab = smoothstep(-0.4, 0.8, h) * smoothstep(13.0, 2.5, h);
          vec3 rel = p - cam; float d = length(rel);
          float a = on * slab * smoothstep(${(BOX * 0.5).toFixed(1)}, ${(BOX * 0.22).toFixed(1)}, d) * smoothstep(1.5, 6.0, d);
          float kk;
          float size = veil > 0.5 ? 0.5 + 1.1 * fract(seed.w * 13.1) : 0.12 + 0.12 * fract(seed.w * 5.7);
          gl_Position = a > 0.003 ? bzStreak(p, wind * spd - camVel, size, veil > 0.5 ? 0.3 : 0.05, veil > 0.5 ? 12.0 : 9.0, kk) : vec4(0.0, 0.0, -2.0, 1.0);
          vK = kk; vVeil = veil;
          vA = a * (veil > 0.5 ? 0.5 : 1.0) * (1.0 + 0.35 * kk) / (1.0 + kk) * k;
          vC = bzLight(normalize(rel)) * (veil > 0.5 ? 1.6 : 3.2);
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
    // ---- diamond dust
    const ND = Math.round(3000 * dens), DB = 120;
    const dpos = new Float32Array(ND * 3), dseed = new Float32Array(ND), rnd = mulberry32(77);
    for (let i = 0; i < ND; i++) { dpos.set([rnd() * DB, rnd() * DB * 0.5, rnd() * DB], i * 3); dseed[i] = rnd(); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dg.setAttribute('seed', new THREE.BufferAttribute(dseed, 1));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, k: { value: 1 } },
      vertexShader: /* glsl */`
        ${ICE_GLSL}
        uniform float time, pr, k; uniform vec3 cam, wind;
        attribute float seed;
        varying float vA;
        void main() {
          vec3 box = vec3(${DB.toFixed(1)}, ${(DB * 0.5).toFixed(1)}, ${DB.toFixed(1)});
          vec3 p = position + wind * 0.12 * time + vec3(sin(time * 0.4 + seed * 30.0), sin(time * 0.3 + seed * 17.0) * 0.6, cos(time * 0.35 + seed * 23.0)) * 1.5;
          p = mod(p - cam + box * 0.5, box) - box * 0.5 + cam;
          vec3 rel = p - cam; float d = length(rel);
          vec3 dir = rel / max(d, 1e-3);
          // a crystal's glint: now and then, as it turns; far brighter toward the sun
          float tw = pow(max(sin(time * (2.0 + 9.0 * seed) + seed * 97.0), 0.0), 14.0);
          float fw = max(dot(dir, IA_SUN), 0.0);
          vA = tw * (0.4 + 5.0 * pow(fw, 5.0)) * smoothstep(${(DB * 0.5).toFixed(1)}, ${(DB * 0.2).toFixed(1)}, d) * smoothstep(1.0, 3.0, d) * k;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = pr * clamp(40.0 / d, 1.2, 3.0);
          gl_Position = vA > 0.002 ? projectionMatrix * mv : vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.0, length(q)) + 0.6 * smoothstep(0.08, 0.0, min(abs(q.x), abs(q.y))) * smoothstep(0.5, 0.2, length(q));
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.86) * m * vA * 1.4, 1.0);
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
      uniforms: { ...U, k: { value: 1 } },
      vertexShader: /* glsl */`
        ${ICE_GLSL}
        ${SNOW_LIGHT}
        ${STRETCH}
        uniform float time, k; uniform vec3 cam, camVel, wind;
        attribute vec4 wa; attribute vec4 wb;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vK;
        void main() {
          vUv = uv;
          float age = time - wa.w, life = 1.4;
          if (age < 0.0 || age > life) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vA = 0.0; return; }
          float f = age / life;
          // flung off at the ship's pace, braked hard by the air, carried off downwind, rising a little; streaked by
          // its motion against the camera's (a spray, not puffs)
          vec3 p = wa.xyz + wb.xyz * (1.0 - exp(-4.0 * age)) / 4.0 + wind * 0.4 * age + vec3(0.0, 1.2 * age, 0.0);
          vec3 v = wb.xyz * exp(-4.0 * age) + wind * 0.4 + vec3(0.0, 1.2, 0.0);
          float size = wb.w * (0.45 + 2.0 * sqrt(f)), kk;
          gl_Position = bzStreak(p, v - camVel, size, 0.02, 7.0, kk);
          vK = kk;
          float d = length(p - cam);
          vA = smoothstep(0.0, 0.05, f) * (1.0 - f) * (1.0 - f) * smoothstep(2.0, 8.0, d) * 0.75 * k * (1.0 + 0.5 * kk) / (1.0 + kk);
          vC = vec3(0.1, 0.13, 0.19) + bzLight(normalize(p - cam)) * 1.8;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vK;
        void main() {
          vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0 * (vK + 1.0));
          q.y = max(abs(q.y) - vK, 0.0);
          float m = max(1.0 - length(q), 0.0);
          gl_FragColor = vec4(vC, m * m * vA);
        }`,
    }));
    this.wI = 0;
    for (const m of [this.streams, this.dust, this.wakes]) { m.frustumCulled = false; m.renderOrder = 3; scene.add(m); }
    this.meshes = [this.streams, this.dust, this.wakes];
    this.last = null;
    this._v = new THREE.Vector3();
  }

  // Spindrift: snow torn off the high points (spire tips, the glacier's crest) and streamed out downwind for hundreds of
  // metres - a train of soft puffs per plume, each running out along it and fading, the train drooping and swaying;
  // lit gold and rose looking toward the low sun (snow scatters forward), blue-grey away from it.
  // tips: [{ p: Vector3, s: scale (~1 for a 200 m spire) }]
  plumes(scene, tips, per = 22) {
    const n = tips.length * per, rnd = mulberry32(5150);
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
    tips.forEach((tp, i) => {
      for (let k = 0; k < per; k++) {
        const j = i * per + k;
        a.set([tp.p.x, tp.p.y, tp.p.z, tp.s], j * 4);
        b.set([(k + rnd() * 0.6) / per, rnd(), i * 1.37 + rnd() * 0.2, 0.7 + 0.6 * rnd()], j * 4);
      }
    });
    g.setAttribute('pa', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('pb', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = n;
    this.plume = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...this.U, k: { value: 1 } },
      vertexShader: /* glsl */`
        ${ICE_GLSL}
        ${SNOW_LIGHT}
        uniform float time, k; uniform vec3 cam, wind;
        attribute vec4 pa; attribute vec4 pb;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        void main() {
          vUv = uv; vR = pb.y;
          float S = pa.w, L = 380.0 * S * pb.w;
          // each puff runs out along the plume and starts again at the tip (the plume itself stays)
          float f = fract(pb.x + time * length(wind) * 0.9 / L);
          vec3 wd = normalize(wind);
          vec3 side = normalize(cross(wd, vec3(0.0, 1.0, 0.0)));
          float sway = sin(f * 5.0 + time * 0.6 + pb.z) * 14.0 * S * f + sin(f * 13.0 - time * 1.1 + pb.z * 2.0) * 4.0 * S * f;
          vec3 p = pa.xyz + wd * f * L + side * sway + vec3(0.0, -40.0 * S * f * f + (pb.y - 0.5) * 10.0 * S * f, 0.0);
          float size = S * (8.0 + 70.0 * f) * (0.7 + 0.6 * pb.y);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float rot = pb.y * 6.28 + time * 0.2;
          vec2 c = vec2(cos(rot), sin(rot));
          mv.xy += mat2(c.x, c.y, -c.y, c.x) * position.xy * size;
          gl_Position = projectionMatrix * mv;
          vA = smoothstep(0.0, 0.06, f) * pow(1.0 - f, 1.6) * 0.16 * k * smoothstep(20.0, 120.0, -mv.z);
          vC = bzLight(normalize(p - cam)) * 1.5;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vR;
        ${NOISE}
        void main() {
          vec2 q = vUv - 0.5;
          float lump = bzN(vec3(q * 4.0, vR * 7.0)) * 0.7 + bzN(vec3(q * 9.0, vR * 3.0)) * 0.3;
          float m = smoothstep(1.0, 0.1, length(q) * 2.0 + (lump - 0.5) * 0.7);
          gl_FragColor = vec4(vC, m * vA);
        }`,
    }));
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 3;
    scene.add(this.plume);
    this.meshes.push(this.plume);
    return this.plume;
  }

  // one ship's wake this frame: n puffs at its tail p on the deck (up: the deck's up), thrown at a share of its velocity
  emit(p, vel, up, n, t) {
    const A = this.wA.array, B = this.wB.array;
    for (let k = 0; k < n; k++) {
      const i = this.wI++ % this.NW, r = () => Math.random() - 0.5, u = 2 + Math.random() * 6;
      A[i * 4] = p.x + r() * 7; A[i * 4 + 1] = p.y + r() * 1.2; A[i * 4 + 2] = p.z + r() * 7; A[i * 4 + 3] = t - Math.random() * 0.016;
      B[i * 4] = vel.x * 0.55 + r() * 16 + up.x * u; B[i * 4 + 1] = vel.y * 0.55 + r() * 6 + up.y * u; B[i * 4 + 2] = vel.z * 0.55 + r() * 16 + up.z * u;
      B[i * 4 + 3] = 0.5 + Math.random() * 1.1;
    }
    this.dirty = true;
  }

  // ships: [{ pos, vel, up (deck's up y), low (on the deck: 0..1) }]
  // deck: the track's frame by the camera ({ P, U }): the streams hug its plane
  update(t, dt, camera, pr, ships, inCave = 0, deck = null) {
    if (deck) { this.deckP.copy(deck.P); this.deckU.copy(deck.U); }
    const U = this.U;
    U.time.value = t;
    U.pr.value = pr;
    if (this.last && dt > 0) this.camVel.lerp(this._v.subVectors(camera.position, this.last).divideScalar(dt), 0.5);
    if (this.camVel.lengthSq() > 1e6) this.camVel.set(0, 0, 0);
    (this.last ||= new THREE.Vector3()).copy(camera.position);
    this.cam.copy(camera.position);
    // (no wind in the glacier's cave)
    this.streams.material.uniforms.k.value = 1 - inCave;
    this.dust.material.uniforms.k.value = 1 - 0.8 * inCave;
    if (this.wakes.visible && dt > 0) {
      for (const s of ships) {
        if (s.low <= 0 || s.pos.distanceToSquared(camera.position) > 360 * 360) continue;
        const sp = s.vel.length();
        if (sp < 30) continue;
        s.acc = (s.acc || 0) + dt * Math.min(110, sp * 0.36) * s.low;
        const n = Math.floor(s.acc);
        s.acc -= n;
        if (n) this.emit(s.tail, s.vel, s.up, n, t);
      }
    }
    if (this.dirty) { this.wA.needsUpdate = this.wB.needsUpdate = true; this.dirty = false; }
  }
}
