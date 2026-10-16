// The ocean planet's rain, on the GPU: every particle's motion is worked out in its vertex shader from its seed and the
// time (as blizzard.js's snow).
//  - streaks falling round the camera, slanting in the wind, drawn out by their speed against the camera's (at racing
//    speed they fly at the lens), faint but where light catches them: the moon's glow ahead, the ships' headlights
//  - splashes leaping off the deck round the camera, each a crown of droplets for a moment, then somewhere else
//  - splashes off the sea round the camera: a crown and a jet up out of the middle of it, on the swell itself
// None under the sea. (The rings the drops make on the sea are the sea's own: sea.js, seRain.)
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { SEA_GLSL } from './sea.js';
import { STRETCH } from './blizzard.js';
import { TRACK_W } from './track.js';

export const RAIN_WIND = new THREE.Vector3(3.5, 0, -2.0);       // the wind carrying it (m/s)
const FALL = 11;                                                    // how fast it falls (m/s)
const BOX = 70, BOXV = 40;                                          // the box of it round the camera (m)
const SPAN = 75, SEGS = 3;                                          // the splashes: the stretch of deck (m), its pieces

// the light a drop catches (dir: from the camera to it): the night's own, the moon's glow looking toward it, a ship's
// headlight shining through it (hP: where the lamp is, w its strength; hF: the way it shines)
const LIGHT = /* glsl */`
uniform vec4 hP[4]; uniform vec3 hF[4];
vec3 rnLight(vec3 p, vec3 dir) {
  vec3 L = vec3(0.03, 0.036, 0.046) + SE_SUNRAD * 0.02 * pow(max(dot(dir, SE_SUN), 0.0), 8.0);
  for (int i = 0; i < 4; i++) {
    vec3 sp = p - hP[i].xyz; float sd = length(sp);
    float cone = smoothstep(0.8, 0.95, dot(sp / max(sd, 1e-3), hF[i])) * smoothstep(80.0, 6.0, sd);
    L += vec3(0.85, 0.9, 1.0) * 1.1 * cone * hP[i].w;
  }
  return L;
}`;

function quads(n, seedFn, seed) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  const S = new Float32Array(n * 4), rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) S.set(seedFn(rnd, i), i * 4);
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(S, 4));
  g.instanceCount = n;
  return g;
}

export class Rain {
  constructor(scene, dens = 1) {
    this.cam = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this._v = new THREE.Vector3();
    const U = (this.U = {
      time: { value: 0 }, k: { value: 1 }, cam: { value: this.cam }, camVel: { value: this.camVel }, wind: { value: RAIN_WIND.clone() },
      hP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, hF: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, -1)) },
    });
    // ---- the streaks
    const NS = Math.round(12000 * dens);
    this.streaks = new THREE.Mesh(quads(NS, (r) => [r(), r(), r(), r()], 5151), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: U,
      vertexShader: /* glsl */`
        ${SEA_GLSL}
        ${STRETCH}
        ${LIGHT}
        uniform float time, k; uniform vec3 cam, camVel, wind;
        attribute vec4 seed;
        varying vec2 vUv; varying float vA, vK; varying vec3 vC;
        void main() {
          vUv = uv;
          vec3 box = vec3(${BOX.toFixed(1)}, ${BOXV.toFixed(1)}, ${BOX.toFixed(1)}), ctr = cam + vec3(0.0, 6.0, 0.0);
          vec3 vel = wind + vec3(0.0, -${FALL.toFixed(1)} * (0.85 + 0.3 * seed.w), 0.0);
          vec3 p = seed.xyz * box + vel * time;
          p = mod(p - ctr + box * 0.5, box) - box * 0.5 + ctr;
          vec3 rel = p - cam; float d = length(rel);
          // (none in the last metres before the lens; thinning out toward the box's edge; none in the sea)
          float a = smoothstep(${(BOX * 0.5).toFixed(1)}, ${(BOX * 0.25).toFixed(1)}, d) * smoothstep(2.5, 7.0, d) * step(SE_Y + 0.3, p.y) * k;
          // never thinner than a pixel and a half: wider and fainter instead (thinner, the far ones glittered)
          float w0 = 0.028, w = max(w0, d * 0.0009);
          float kk;
          // (drawn out by its fall and a little of the camera's own speed: all of it - even a third - at racing speed made
          // a tunnel of lines out of the middle of the screen, warp, not rain; the drops still rush past as it goes)
          gl_Position = a > 0.002 ? bzStreak(p, vel - camVel * 0.08, w, 0.06, min(2.4, d * 0.1), kk) : vec4(0.0, 0.0, -2.0, 1.0);
          vK = kk;
          vC = rnLight(p, rel / max(d, 1e-3));
          vA = a * (w0 / w) * 0.9;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA, vK; varying vec3 vC;
        void main() {
          vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0 * (vK + 1.0));
          q.y = max(abs(q.y) - vK, 0.0);
          float m = max(1.0 - length(q), 0.0);
          gl_FragColor = vec4(vC * m * vA, 1.0);
        }`,
    }));
    // ---- the splashes on the deck: each in turn at a new place on the stretch ahead of the camera, a crown of droplets
    // thrown up and falling back over a fifth of a second (the deck's line: dP / dR / dU at SEGS + 1 points along it)
    const NP = Math.round(1600 * dens);
    this.dP = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3(0, -1e5, 0));
    this.dR = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3(1, 0, 0));
    this.dU = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3(0, 1, 0));
    this.splashes = new THREE.Mesh(quads(NP, (r) => [r(), r(), r(), r()], 6262), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, dP: { value: this.dP }, dR: { value: this.dR }, dU: { value: this.dU } },
      vertexShader: /* glsl */`
        ${SEA_GLSL}
        ${LIGHT}
        uniform float time, k; uniform vec3 cam; uniform vec3 dP[${SEGS + 1}], dR[${SEGS + 1}], dU[${SEGS + 1}];
        attribute vec4 seed;
        varying vec2 vUv; varying float vA, vT; varying vec3 vC; varying vec2 vJ;
        vec2 rnH(vec2 p) { p = mod(p, 289.0); return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        void main() {
          vUv = uv;
          float per = 0.5 + 0.7 * seed.w, cyc = time / per + seed.z, life = fract(cyc) * per;
          vec2 h = rnH(seed.xy * 97.0 + floor(cyc) * 1.37);
          float along = h.x * ${(SPAN / SEGS).toFixed(3)} * ${SEGS.toFixed(1)}, lat = (h.y * 2.0 - 1.0) * ${(TRACK_W / 2 - 0.8).toFixed(2)};
          float fi = min(floor(along / ${(SPAN / SEGS).toFixed(3)}), ${(SEGS - 1).toFixed(1)}), f = along / ${(SPAN / SEGS).toFixed(3)} - fi;
          int i = int(fi);
          vec3 P = mix(dP[i], dP[i + 1], f), R = normalize(mix(dR[i], dR[i + 1], f)), Up = normalize(mix(dU[i], dU[i + 1], f));
          vec3 base = P + R * lat + Up * 0.03;
          vT = clamp(life / 0.2, 0.0, 1.0);
          float a = (1.0 - smoothstep(0.12, 0.2, life)) * smoothstep(0.0, 0.015, life) * step(SE_Y + 0.5, base.y) * k;
          vec3 toCam = cam - base; float d = length(toCam);
          a *= smoothstep(70.0, 40.0, d) * smoothstep(1.5, 4.0, d);
          vec3 side = normalize(cross(Up, toCam / max(d, 1e-3)));
          float wd = 0.26 + 0.55 * vT, ht = 0.08 + 0.3 * smoothstep(0.0, 0.5, vT);
          vJ = h * 6.2831853;
          vec3 wp = base + side * position.x * wd + Up * (position.y + 0.5) * ht;
          vC = rnLight(base, -toCam / max(d, 1e-3)) * 1.5 + vec3(0.05, 0.06, 0.07);
          vA = a;
          gl_Position = a > 0.002 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA, vT; varying vec3 vC; varying vec2 vJ;
        void main() {
          // the crown: droplets on an arc rising out of the hit and spreading, the drops at its rim, a fleck at its foot
          vec2 q = vUv * 2.0 - 1.0;
          float arc = 0.0;
          for (int j = 0; j < 5; j++) {
            float fj = (float(j) - 2.0) / 2.0, r = fract(sin(float(j) * 12.9 + vJ.x) * 437.58);
            if (r < 0.3) continue;
            vec2 c = vec2((fj + (r - 0.5) * 0.4) * (0.35 + 0.55 * vT), -1.0 + (1.0 - fj * fj) * (0.4 + 1.2 * vT) * (0.6 + 0.6 * fract(r * 7.3 + vJ.y)) * (1.0 - 0.35 * vT));
            arc += smoothstep(0.15, 0.03, length((q - c) * vec2(1.0, 0.7))) * (0.5 + 0.5 * r);
          }
          float foot = smoothstep(0.5, 0.0, length((q - vec2(0.0, -0.95)) * vec2(1.0, 3.0))) * (1.0 - vT);
          gl_FragColor = vec4(vC * min(1.0, arc + foot) * vA, 1.0);
        }`,
    }));
    // ---- the splashes on the sea: each at a new place in a disc round the camera every so often, on the swell there
    // (the sea's own waves: seHeight), a crown thrown up and a jet out of its middle, over a quarter of a second
    const NW = Math.round(1400 * dens);
    this.seaU = { seT: { value: 0 } };
    this.seaSplashes = new THREE.Mesh(quads(NW, (r) => [r(), r(), r(), r()], 7373), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, ...this.seaU },
      vertexShader: /* glsl */`
        ${SEA_GLSL}
        ${LIGHT}
        uniform float time, k, seT; uniform vec3 cam;
        attribute vec4 seed;
        varying vec2 vUv; varying float vA, vT; varying vec3 vC; varying vec2 vJ;
        vec2 rnH(vec2 p) { p = mod(p, 289.0); return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        void main() {
          vUv = uv;
          float per = 0.6 + 0.8 * seed.w, cyc = time / per + seed.z, life = fract(cyc) * per;
          vec2 h = rnH(seed.xy * 97.0 + floor(cyc) * 1.37);
          float ang = h.x * 6.2831853, rad = 4.0 + sqrt(h.y) * 110.0;
          vec2 xz = cam.xz + vec2(cos(ang), sin(ang)) * rad;
          vec3 base = vec3(xz.x, seHeight(xz, seT), xz.y);
          vT = clamp(life / 0.26, 0.0, 1.0);
          float a = (1.0 - smoothstep(0.16, 0.26, life)) * smoothstep(0.0, 0.015, life) * k;
          vec3 toCam = cam - base; float d = length(toCam);
          a *= smoothstep(115.0, 70.0, d) * smoothstep(2.0, 6.0, d) * step(SE_Y + 0.5, cam.y);
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam / max(d, 1e-3)));
          float wd = 0.35 + 0.7 * vT, ht = 0.15 + 0.55 * smoothstep(0.0, 0.45, vT);
          vec3 wp = base + side * position.x * wd + vec3(0.0, (position.y + 0.5) * ht, 0.0);
          vC = rnLight(base, -toCam / max(d, 1e-3)) * 1.6 + vec3(0.07, 0.085, 0.1);         // (the spray white of itself)
          vA = a;
          vJ = h * 6.2831853;
          gl_Position = a > 0.002 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA, vT; varying vec3 vC; varying vec2 vJ;
        void main() {
          // the crown's droplets on an arc, the jet rising out of its middle and breaking into a drop at its top
          vec2 q = vUv * 2.0 - 1.0;
          float arc = 0.0;
          for (int j = 0; j < 6; j++) {
            float fj = (float(j) - 2.5) / 2.5, r = fract(sin(float(j) * 12.9 + vJ.x) * 437.58);
            vec2 c = vec2((fj + (r - 0.5) * 0.3) * (0.35 + 0.6 * vT), -1.0 + (1.0 - fj * fj) * (0.25 + 0.6 * vT) * (0.6 + 0.6 * fract(r * 7.3 + vJ.y)) * (1.0 - 0.4 * vT));
            arc += smoothstep(0.13, 0.03, length((q - c) * vec2(1.0, 0.7))) * (0.5 + 0.5 * r);
          }
          float jh = -1.0 + 1.8 * smoothstep(0.1, 0.6, vT) * (1.0 - 0.6 * smoothstep(0.6, 1.0, vT));
          float jet = smoothstep(0.07, 0.02, abs(q.x)) * step(-1.0, q.y) * step(q.y, jh) + smoothstep(0.14, 0.04, length(q - vec2(0.0, jh + 0.06)));
          float foot = smoothstep(0.6, 0.0, length((q - vec2(0.0, -0.95)) * vec2(1.0, 4.0))) * (1.0 - vT);
          gl_FragColor = vec4(vC * min(1.0, arc + jet * 0.8 + foot) * vA, 1.0);
        }`,
    }));
    this.meshes = [this.streaks, this.splashes, this.seaSplashes];
    for (const m of this.meshes) { m.frustumCulled = false; scene.add(m); }
    this.streaks.name = 'rain';
    this.splashes.name = 'rain-splashes';
    this.seaSplashes.name = 'rain-sea-splashes';
  }

  setOn(on) { this.on = on; for (const m of this.meshes) m.visible = on; }

  // every frame: the camera (its speed draws the streaks out), under the sea or not, the ships' headlights
  // ([{ pos, fwd, power }], nearest first), the deck's line ahead of the camera (frames: SEGS + 1 of { P, R, U })
  // seT: the sea's own clock (its swell: where a splash on it stands)
  update(t, dt, camera, under, lamps, frames, seT = t) {
    const U = this.U;
    U.time.value = t;
    this.seaU.seT.value = seT;
    if (this.last && dt > 0) this.camVel.lerp(this._v.subVectors(camera.position, this.last).divideScalar(dt), 0.5);
    if (this.camVel.lengthSq() > 1e6) this.camVel.set(0, 0, 0);
    (this.last ||= new THREE.Vector3()).copy(camera.position);
    this.cam.copy(camera.position);
    U.k.value = under ? 0 : 1;
    for (const m of this.meshes) m.visible = this.on !== false && !under;
    for (let i = 0; i < 4; i++) {
      const L = lamps[i];
      if (L) { U.hP.value[i].set(L.pos.x, L.pos.y, L.pos.z, L.power); U.hF.value[i].copy(L.fwd); } else U.hP.value[i].set(0, -1e5, 0, 0);
    }
    frames.forEach((f, i) => { this.dP[i].copy(f.P); this.dR[i].copy(f.R); this.dU[i].copy(f.U); });
  }
}
