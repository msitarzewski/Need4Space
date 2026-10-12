// Waterfalls off the floating islands: a river leaves a lip at some speed and falls along its ballistic arc
// (p = lip + out v t - g t^2 / 2) - a sheet whose texture flows at the water's own speed (the mesh is laid out in
// time since the lip, so features ride down it accelerating), solid and foaming at the lip, tearing into ropes lower
// down, then gone into spray: soft mist plumes (lit by the sun, a rainbow where the sun is at your back at 42 deg)
// that drift down into the abyss. The Cascade's river shoots far enough to arch over the track.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { ATMO_GLSL } from './atmo.js';

export const WATER_U = { waterTime: { value: 0 } };
const G = 9.8;

// the sheet: rows in time since the lip (finer near it), columns across
export function sheet({ lip, out, width, v, tEnd, seed }) {
  const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize();
  const rnd = mulberry32(seed), NR = 46, NC = 14, pos = [], nrm = [], uv = [], aux = [], idx = [];
  const ph = rnd() * 10;
  for (let i = 0; i <= NR; i++) {
    const t = tEnd * Math.pow(i / NR, 1.6);
    const P = lip.clone().addScaledVector(out, v * t).add(new THREE.Vector3(0, -0.5 * G * t * t, 0));
    const T = out.clone().multiplyScalar(v).add(new THREE.Vector3(0, -G * t, 0)).normalize();
    const N = new THREE.Vector3().crossVectors(across, T).normalize();
    const w = width * (1 + 0.07 * t) + 2 * t;
    // the sheet sways a little sideways as it falls, and bows out in its middle
    const sway = Math.sin(t * 0.7 + ph) * t * 0.6;
    for (let j = 0; j <= NC; j++) {
      const u = j / NC, x = (u - 0.5) * w;
      const p = P.clone().addScaledVector(across, x + sway).addScaledVector(N, Math.cos((u - 0.5) * Math.PI) * w * 0.06);
      pos.push(p.x, p.y, p.z); nrm.push(N.x, N.y, N.z); uv.push(u, t); aux.push(w, v);
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) {
    const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('wAux', new THREE.Float32BufferAttribute(aux, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export const NOISE = /* glsl */`
  float wH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float wN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
    return mix(mix(wH(i), wH(i + vec2(1, 0)), u.x), mix(wH(i + vec2(0, 1)), wH(i + vec2(1, 1)), u.x), u.y); }`;

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: WATER_U,
    vertexShader: /* glsl */`
      attribute vec2 wAux; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec2 vAux;
      void main() { vUv = uv; vAux = wAux; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float waterTime; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec2 vAux;
      ${ATMO_GLSL}
      ${NOISE}
      void main() {
        float t = vUv.y, x = vUv.x * vAux.x;                      // seconds since the lip, metres across
        float tf = t - waterTime;                                    // a parcel of water keeps its tf: the pattern rides down
        // streaks: long along the flow at the lip (smooth, fast), shorter and wilder lower down
        float st = wN(vec2(x / 1.4, tf * 2.2)) * 0.5 + wN(vec2(x / 0.55, tf * 5.0 + 3.0)) * 0.3 + wN(vec2(x / 3.5, tf * 0.8 + 7.0)) * 0.2;
        float ropes = wN(vec2(x / (2.0 + t * 0.8), tf * 0.6 + 11.0));
        // coverage: a solid sheet at the lip tearing into ropes, gone into spray after ~6 s
        float cover = smoothstep(0.15, 0.45, ropes + 0.95 - t * 0.15) * smoothstep(8.0, 4.0, t);
        float edge = smoothstep(0.0, 0.1 + 0.06 * wN(vec2(tf * 3.0, 1.0)), vUv.x) * smoothstep(1.0, 0.9 - 0.06 * wN(vec2(tf * 3.0, 5.0)), vUv.x);
        float a = cover * edge * (0.7 + 0.3 * st);
        if (a < 0.01) discard;
        float foam = clamp(smoothstep(0.45, 0.8, st) * 0.7 + smoothstep(1.2, 0.0, t) * 0.6 + smoothstep(1.5, 5.0, t) * 0.5, 0.0, 1.0);
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        if (dot(N, V) < 0.0) N = -N;
        float mu = dot(-V, ATMO_SUN);
        // lit: foam scatters the sun every way; the clear water lets it through toward you (bright looking into the sun)
        vec3 sun = ATMO_SUNRAD * (0.16 + 0.34 * max(dot(N, ATMO_SUN), 0.0) + atmoPhaseHG(mu, 0.55) * 0.5);
        vec3 sky = ATMO_SUNRAD * vec3(0.055, 0.07, 0.085);
        vec3 water = vec3(0.10, 0.17, 0.15), white = vec3(0.82, 0.88, 0.9);
        vec3 col = mix(water, white, foam) * (sun + sky);
        // glints on the sheet's ripples
        vec3 Nr = normalize(N + vec3(st - 0.5, 0.0, wN(vec2(x, tf * 9.0)) - 0.5) * 0.5);
        col += ATMO_SUNRAD * pow(max(dot(reflect(-ATMO_SUN, Nr), V), 0.0), 60.0) * 1.5 * (1.0 - foam);
        vec3 T, L;
        float dist = length(vW - cameraPosition);
        atmoPath(cameraPosition, (vW - cameraPosition) / dist, dist, T, L);
        gl_FragColor = vec4(col * T + L, a * mix(0.75, 0.97, foam));
      }`,
  });
}

// mist: soft billboards, instanced (centre, size, seed, birth time offset), drifting down and spreading
function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: WATER_U,
    vertexShader: /* glsl */`
      attribute vec3 centre; attribute vec4 mist; attribute vec3 drift; varying vec2 vQ; varying vec3 vW; varying float vA; varying float vSeed;
      uniform float waterTime;
      void main() {
        // each puff lives 10 s: born at its spot, sinking and swelling, then reborn (its phase in w)
        float age = fract(waterTime / 10.0 + mist.w);
        vec3 c = centre + drift * age * 10.0;
        float size = mist.x * (0.6 + 0.8 * age);
        vA = smoothstep(0.0, 0.2, age) * smoothstep(1.0, 0.6, age) * mist.y;
        vSeed = mist.z;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vW = c + (right * uv.x + up * uv.y) * size;
        vQ = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ; varying vec3 vW; varying float vA; varying float vSeed;
      uniform float waterTime;
      ${ATMO_GLSL}
      ${NOISE}
      void main() {
        float r = length(vQ) * 2.0;
        if (r > 1.0) discard;
        float n = wN(vQ * 3.0 + vSeed * 17.0 + waterTime * 0.05) * 0.6 + wN(vQ * 7.0 - vSeed * 9.0) * 0.4;
        float a = vA * exp(-r * r * 3.0) * (0.55 + 0.6 * n);
        vec3 V = normalize(vW - cameraPosition);
        float mu = dot(V, ATMO_SUN);
        vec3 col = ATMO_SUNRAD * (0.13 + atmoPhaseHG(mu, 0.6) * 0.45) * vec3(0.95, 0.98, 1.0);
        // the rainbow: 40.5 to 42.5 deg from the point opposite the sun, red outside
        float th = degrees(acos(clamp(dot(V, -ATMO_SUN), -1.0, 1.0)));
        float k = (th - 40.4) / 2.2;
        if (k > -0.2 && k < 1.2) {
          vec3 bow = clamp(vec3(abs(k * 6.0 - 3.0) - 1.0, 2.0 - abs(k * 6.0 - 2.0), 2.0 - abs(k * 6.0 - 4.0)), 0.0, 1.0).bgr;
          col += ATMO_SUNRAD * bow * 0.09 * smoothstep(-0.2, 0.1, k) * smoothstep(1.2, 0.9, k);
        }
        vec3 T, L;
        float dist = length(vW - cameraPosition);
        atmoPath(cameraPosition, V, dist, T, L);
        gl_FragColor = vec4(col * T + L, a);
      }`,
  });
}

export class Waters {
  constructor(scene, dens = 1) {
    this.scene = scene;
    this.dens = dens;
    this.mat = waterMaterial();
    this.falls = [];
    this.puffs = [];
  }

  // a fall: lip (world), out (horizontal unit, the way it leaves), width (m), v (m/s off the lip), drop (m to the
  // end of the spray)
  add({ lip, out, width, v, drop = 900, seed = 1, name = '' }) {
    const tEnd = Math.min(8, Math.sqrt((2 * drop) / G));
    const geo = sheet({ lip, out: out.clone().setY(0).normalize(), width, v, tEnd, seed });
    const m = new THREE.Mesh(geo, this.mat);
    m.renderOrder = 3;
    m.name = 'waterfall-' + name;
    this.scene.add(m);
    const rnd = mulberry32(seed * 7 + 1), o = out.clone().setY(0).normalize();
    const at = (t) => lip.clone().addScaledVector(o, v * t).add(new THREE.Vector3(0, -0.5 * G * t * t, 0));
    // spray: where the sheet tears (from ~2.5 s) and all the way down, bigger and fainter as it goes
    const tMax = Math.sqrt((2 * drop) / G);
    for (let k = 0; k < Math.round(46 * this.dens); k++) {
      const t = 2.2 + (tMax - 2.2) * Math.pow(rnd(), 0.8), p = at(t);
      const spread = width * 0.4 + t * 3;
      p.x += (rnd() - 0.5) * spread; p.z += (rnd() - 0.5) * spread;
      this.puffs.push({ p, size: (12 + t * 5) * (0.7 + 0.6 * rnd()), a: 0.35 * (0.6 + 0.4 * rnd()) * Math.min(1, 6 / t), drift: new THREE.Vector3((rnd() - 0.5) * 2, -3 - rnd() * 4, (rnd() - 0.5) * 2) });
    }
    // a little spray off the lip too
    for (let k = 0; k < 6; k++) {
      const p = at(0.3 + rnd() * 0.8);
      this.puffs.push({ p: p.addScaledVector(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), o), (rnd() - 0.5) * width), size: 6 + rnd() * 6, a: 0.25, drift: new THREE.Vector3(0, -2, 0) });
    }
    // (where its roar comes from: the nearest of these to the listener)
    const fall = { mesh: m, lip, out: o, v, width, at, name, samples: [0, 1, 2, 3.5, 5, 7, 9].map(at) };
    this.falls.push(fall);
    return fall;
  }

  // the mist, once every fall is in: one instanced draw
  finish() {
    const n = this.puffs.length, g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const c = new Float32Array(n * 3), mi = new Float32Array(n * 4), dr = new Float32Array(n * 3), rnd = mulberry32(3);
    this.puffs.forEach((q, i) => { c.set([q.p.x, q.p.y, q.p.z], i * 3); mi.set([q.size, q.a, rnd(), rnd()], i * 4); dr.set([q.drift.x, q.drift.y, q.drift.z], i * 3); });
    g.setAttribute('centre', new THREE.InstancedBufferAttribute(c, 3));
    g.setAttribute('mist', new THREE.InstancedBufferAttribute(mi, 4));
    g.setAttribute('drift', new THREE.InstancedBufferAttribute(dr, 3));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, mistMaterial());
    m.frustumCulled = false;
    m.renderOrder = 4;
    this.scene.add(m);
    this.mist = m;
  }

  update(t) { WATER_U.waterTime.value = t; }
}
