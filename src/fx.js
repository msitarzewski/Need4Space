// Effects: hover wash, exhaust ions, scrape sparks, the crash explosion (fireball, smoke column, sparks, flash,
// shock ring) and speed streaks past the camera.
import * as THREE from 'three';
import { TRACK_W } from './track.js';
import { mulberry32, smoothstep } from './noise.js';

const TRACK_HALF = TRACK_W / 2;           // the walls' inner faces

function canvas(n, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  draw(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// a round glow (sparks, ions, fire)
const glowTex = () => canvas(64, (g, n) => {
  const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, n, n);
});

// a soft, lumpy smoke puff: overlapping blobs, the edge broken up so it never reads as a disc
const puffTex = () => canvas(128, (g, n) => {
  const rnd = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    // every blob stays inside the square (centre <= 0.18 n out, radius <= 0.28 n): a blob touching the edge showed
    // each puff's square outline on the road
    const a = rnd() * Math.PI * 2, d = rnd() * n * 0.18, x = n / 2 + Math.cos(a) * d, y = n / 2 + Math.sin(a) * d;
    const rr = n * (0.10 + rnd() * 0.18), r = g.createRadialGradient(x, y, 0, x, y, rr);
    r.addColorStop(0, `rgba(255,255,255,${0.20 + rnd() * 0.18})`);
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, n, n);
  }
});

// Instanced camera-facing particles. Options per pool:
//  additive: HDR light (added, not blended: a spark's core can sit far above white for the bloom);
//  stretch: velocity-stretched streaks (motion blur: a capsule from where the particle was `stretch` seconds ago to
//    where it is - round dots read as a cheap effect at these speeds);
//  ramp: 1 = heat (a spark cools white-hot -> yellow -> orange -> a red ember over its life), 2 = ion (hot, then the
//    engine's own colour, dimming).
// Per particle: a plane (the deck there) to fall toward and bounce off, with a restitution.
const CAM_VEL = new THREE.Vector3();      // the camera's velocity (FX.update): the streaks are motion blur

class Pool {
  constructor(scene, n, { additive = false, map, order = 3, stretch = false, ramp = 0 }) {
    this.n = n;
    const f = (k) => new Float32Array(n * k);
    Object.assign(this, { p: f(3), v: f(3), c: f(3), a: f(1), s: f(1), rot: f(1), spin: f(1), life: f(1), grow: f(1),
      drag: f(1), grav: f(1), a0: f(1), fadeIn: f(1), str: f(1), fr: f(1), pl: f(6), bounce: f(1) });
    this.age = new Float32Array(n).fill(1e9);
    this.next = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    for (const [k, arr, w] of [['iPos', this.p, 3], ['iVel', this.v, 3], ['iCol', this.c, 3], ['iAlpha', this.a, 1],
      ['iSize', this.s, 1], ['iRot', this.rot, 1], ['iStr', this.str, 1], ['iF', this.fr, 1]]) {
      g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, w));
    }
    g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      defines: { STRETCH: stretch ? 1 : 0, RAMP: ramp, ADDITIVE: additive ? 1 : 0 },
      uniforms: { map: { value: map }, camVel: { value: CAM_VEL } },
      vertexShader: /* glsl */`
        uniform vec3 camVel;
        attribute vec3 iPos; attribute vec3 iVel; attribute vec3 iCol; attribute float iAlpha; attribute float iSize;
        attribute float iRot; attribute float iStr; attribute float iF;
        varying vec2 vUv; varying float vA; varying vec3 vC; varying float vF; varying float vK;
        void main() {
          vUv = uv; vA = iAlpha; vC = iCol; vF = iF; vK = 0.0;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float sz = max(iSize, 0.0);
          #if STRETCH
            // the streak: its motion across the view in the last iStr seconds - relative to the camera, which moves too
            // (a spark keeping pace with the ship stays short, one left behind on the deck streaks), at most 7 m
            vec3 d = normalize(mv.xyz), tr = (modelViewMatrix * vec4(iVel - camVel, 0.0)).xyz * iStr;
            tr -= d * dot(tr, d);
            tr *= min(1.0, 7.0 / max(length(tr), 1e-4));
            float len = length(tr);
            vec3 ax = len > 1e-5 ? tr / len : vec3(0.0, 1.0, 0.0);
            vec3 sd = normalize(cross(d, ax));          // (cross(ax, d) mirrored the quad: back-face culled)
            mv.xyz += sd * position.x * sz + ax * (position.y * (len + sz)) - tr * 0.5;
            vK = len / max(sz, 1e-4);
            vA *= (1.0 + 0.35 * vK) / (1.0 + vK);           // the same light spread along the streak (mostly)
          #else
            float c = cos(iRot), s = sin(iRot);
            mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * sz;
          #endif
          gl_Position = iAlpha > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec2 vUv; varying float vA; varying vec3 vC; varying float vF; varying float vK;
        vec3 heat(float f) {
          vec3 c = mix(vec3(1.0, 0.96, 0.9) * 2.2, vec3(1.0, 0.78, 0.32) * 1.6, smoothstep(0.0, 0.22, f));
          c = mix(c, vec3(1.0, 0.36, 0.06), smoothstep(0.18, 0.55, f));
          return mix(c, vec3(0.55, 0.06, 0.015), smoothstep(0.5, 1.0, f));
        }
        void main() {
          #if STRETCH
            vec2 q = vec2((vUv.x - 0.5) * 2.0, (vUv.y - 0.5) * 2.0 * (vK + 1.0));
            q.y = max(abs(q.y) - vK, 0.0);
            float r = length(q);
            float m = max(1.0 - r, 0.0);
            m = m * m * (0.6 + 2.4 * exp(-r * r * 9.0));           // a white-hot core in a soft sheath
          #else
            float m = texture2D(map, vUv).a * smoothstep(0.5, 0.36, length(vUv - 0.5));
          #endif
          vec3 col = vC;
          #if RAMP == 1
            col *= heat(vF);
          #elif RAMP == 2
            col = mix(mix(vC, vec3(1.0), 0.6) * 2.0, vC * 0.6, smoothstep(0.0, 0.7, vF));
          #endif
          #if ADDITIVE
            gl_FragColor = vec4(col * m * vA, 1.0);
          #else
            gl_FragColor = vec4(col, clamp(m * vA, 0.0, 1.0));
          #endif
        }`,
    });
    this.points = new THREE.Mesh(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = order;
    scene.add(this.points);
  }

  // plane: { P, N } - the deck under the emitter: the particle falls toward it (grav along -N) and bounces off it
  emit(p, v, col, { size = 1, grow = 0, life = 1, alpha = 1, drag = 1, grav = 0, spin = 0, fadeIn = 0.15, stretch = 0,
    plane = null, bounce = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p.set([p.x, p.y, p.z], i * 3);
    this.v.set([v.x, v.y, v.z], i * 3);
    this.c.set([col.r, col.g, col.b], i * 3);
    this.s[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha;
    this.drag[i] = drag; this.grav[i] = grav; this.rot[i] = Math.random() * 6.283; this.spin[i] = spin; this.fadeIn[i] = fadeIn;
    this.str[i] = stretch; this.fr[i] = 0;
    if (plane) this.pl.set([plane.P.x, plane.P.y, plane.P.z, plane.N.x, plane.N.y, plane.N.z], i * 6);
    else this.pl.set([0, 0, 0, 0, 0, 0], i * 6);
    this.bounce[i] = plane ? bounce : 0;
  }

  update(dt) {
    const pl = this.pl;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) { this.a[i] = 0; continue; }
      this.age[i] = Math.min(this.life[i], this.age[i] + dt);
      const f = this.age[i] / this.life[i], k = Math.exp(-this.drag[i] * dt), o = i * 3, q = i * 6;
      const nx = pl[q + 3], ny = pl[q + 4], nz = pl[q + 5], hasPlane = nx || ny || nz;
      const gx = hasPlane ? -nx : 0, gy = hasPlane ? -ny : -1, gz = hasPlane ? -nz : 0, gr = this.grav[i] * dt;
      this.v[o] = this.v[o] * k + gx * gr; this.v[o + 1] = this.v[o + 1] * k + gy * gr; this.v[o + 2] = this.v[o + 2] * k + gz * gr;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      if (hasPlane) {                          // under the deck: back on it, the normal speed reflected, skidding on
        const d = (this.p[o] - pl[q]) * nx + (this.p[o + 1] - pl[q + 1]) * ny + (this.p[o + 2] - pl[q + 2]) * nz;
        if (d < 0) {
          this.p[o] -= nx * d; this.p[o + 1] -= ny * d; this.p[o + 2] -= nz * d;
          const vn = this.v[o] * nx + this.v[o + 1] * ny + this.v[o + 2] * nz;
          if (vn < 0) {                        // a real impact skips (and scuffs a little speed); resting, it slides
            const e = 1 + this.bounce[i], fr = vn < -1.5 ? 0.9 : 1;
            this.v[o] = (this.v[o] - nx * vn * e) * fr; this.v[o + 1] = (this.v[o + 1] - ny * vn * e) * fr;
            this.v[o + 2] = (this.v[o + 2] - nz * vn * e) * fr;
          }
        }
      }
      this.s[i] = Math.max(0, this.s[i] + this.grow[i] * dt);
      this.rot[i] += this.spin[i] * dt;
      this.fr[i] = f;
      this.a[i] = this.a0[i] * smoothstep(0, this.fadeIn[i], f) * (1 - f) * (1 - f);
    }
    const at = this.points.geometry.attributes;
    for (const k of ['iPos', 'iVel', 'iAlpha', 'iSize', 'iCol', 'iRot', 'iStr', 'iF']) at[k].needsUpdate = true;
  }
}

// thin bright streaks rushing past the camera at speed (they live in camera space)
class Streaks {
  constructor(camera, n = 140) {
    this.n = n;
    this.pts = [];
    const rnd = mulberry32(5);
    for (let i = 0; i < n; i++) this.pts.push(this.spawn(rnd, -5 - rnd() * 90));
    this.rnd = rnd;
    this.pos = new Float32Array(n * 6);
    this.alpha = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute float alpha; varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`varying float vA; void main() { gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vA, 1.0); }`,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    camera.add(this.lines);
  }

  spawn(rnd, z) {
    const a = rnd() * Math.PI * 2, r = 6 + rnd() * 10;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, z, k: 0.5 + rnd() };
  }

  update(dt, speed, boost) {
    const on = smoothstep(110, 260, speed) * (0.45 + 0.55 * boost);
    const len = Math.min(22, speed * 0.05);
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i];
      p.z += speed * dt * p.k * 1.1;
      if (p.z > -1) this.pts[i] = this.spawn(this.rnd, -60 - this.rnd() * 40);
      const q = this.pts[i], o = i * 6;
      this.pos.set([q.x, q.y, q.z, q.x, q.y, q.z - len * q.k], o);
      const fade = smoothstep(-100, -60, q.z) * smoothstep(-1, -8, q.z);
      this.alpha[i * 2] = on * fade * 0.28;
      this.alpha[i * 2 + 1] = 0;
    }
    this.lines.visible = on > 0.01;
    const at = this.lines.geometry.attributes;
    at.position.needsUpdate = at.alpha.needsUpdate = true;
  }
}

// Molten scrape marks: where a hull grinds along a wall the metal glows - white-orange, cooling through red to
// nothing in ~2 s - a streak on the wall's face for each frame of contact.
class WallMarks {
  constructor(scene, n = 160) {
    this.n = n;
    this.i = 0;
    this.t = 0;
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    g.instanceCount = n;
    this.born = new Float32Array(n).fill(-99);
    this.heat = new Float32Array(n);
    g.setAttribute('iBorn', new THREE.InstancedBufferAttribute(this.born, 1));
    g.setAttribute('iHeat', new THREE.InstancedBufferAttribute(this.heat, 1));
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { time: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float iBorn; attribute float iHeat; uniform float time; varying vec2 vUv; varying float vAge; varying float vHeat;
        void main() {
          vUv = uv; vAge = time - iBorn; vHeat = iHeat;
          gl_Position = vAge < 2.2 ? projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vAge; varying float vHeat;
        float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main() {
          float f = clamp(vAge / 2.2, 0.0, 1.0);
          // a gouge: hottest along its middle line, ragged along its length
          float across = abs(vUv.y - 0.5) * 2.0;
          float rag = 0.65 + 0.35 * h12(floor(vec2(vUv.x * 24.0, 0.0)) + vHeat * 17.0);
          float m = smoothstep(rag, 0.0, across) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          vec3 c = mix(vec3(2.4, 1.9, 1.2), vec3(1.6, 0.5, 0.08), smoothstep(0.0, 0.18, f));
          c = mix(c, vec3(0.35, 0.03, 0.005), smoothstep(0.18, 0.75, f));
          gl_FragColor = vec4(c * m * vHeat * (1.0 - f) * (1.0 - f), 1.0);
        }`,
    }), n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const M = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < n; k++) this.mesh.setMatrixAt(k, M);
    scene.add(this.mesh);
    this.M = new THREE.Matrix4();
  }

  // at: on the wall face; T: along the track; N: out of the wall into the track; len (m) of this frame's gouge
  add(at, T, N, len, heat) {
    const k = this.i++ % this.n, B = new THREE.Vector3().crossVectors(N, T);
    this.M.makeBasis(T, B, N).scale(new THREE.Vector3(Math.max(0.4, len), 0.12 + 0.18 * heat, 1)).setPosition(at);
    this.mesh.setMatrixAt(k, this.M);
    this.born[k] = this.t;
    this.heat[k] = heat;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.iBorn.needsUpdate = this.mesh.geometry.attributes.iHeat.needsUpdate = true;
  }

  update(dt) { this.t += dt; this.mesh.material.uniforms.time.value = this.t; }
}

export class FX {
  constructor(scene, camera) {
    const glow = glowTex(), puff = puffTex();
    this.scene = scene;
    this.dust = new Pool(scene, 900, { map: puff });
    this.smoke = new Pool(scene, 500, { map: puff });
    this.fire = new Pool(scene, 400, { additive: true, map: puff, order: 4 });
    this.sparks = new Pool(scene, 2200, { additive: true, map: glow, order: 5, stretch: true, ramp: 1 });
    this.ions = new Pool(scene, 1600, { additive: true, map: glow, order: 5, stretch: true, ramp: 2 });
    this.glints = new Pool(scene, 64, { additive: true, map: glow, order: 6 });
    this.spray = new Pool(scene, 900, { map: glow, order: 4, stretch: true });         // water: drops on arcs, not lights
    this.marks = new WallMarks(scene);
    this.track = null;                        // set by main: sparks fall to its deck and bounce
    this.streaks = new Streaks(camera);
    this.acc = 0;
    this.ionAcc = 0;
    this.flash = new THREE.PointLight(0xff9a4a, 0, 120, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: 0xffc890, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringT = 1;
    // deck shockwaves for boost pads and hits: a small pool of rings lying on the track's surface
    this.waves = [0, 1, 2, 3, 4, 5].map(() => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false;
      m.renderOrder = 3;
      m.userData = { t: 1, size: 10, life: 0.5, col: new THREE.Color() };
      scene.add(m);
      return m;
    });
    this.waveN = 0;
    this.kick = 0;
  }

  // a ring racing out over the deck at `at`, lying in the plane of `basis` (a matrix with the deck's axes)
  wave(at, basis, colour, size = 12, life = 0.5) {
    const m = this.waves[this.waveN++ % this.waves.length];
    m.position.copy(at);
    m.quaternion.setFromRotationMatrix(basis);
    Object.assign(m.userData, { t: 0, size, life });
    m.userData.col.copy(colour);
    m.visible = true;
  }

  // a boost pad fires: a deck shockwave, a fountain of hot motes, and (for the player) a kick for the camera / streaks
  padBurst(at, basis, player) {
    this.wave(at, basis, new THREE.Color(2.2, 0.9, 0.15), 16, 0.55);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(basis));
    const fwd = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(basis));
    const c1 = new THREE.Color(1.0, 0.55, 0.12), c2 = new THREE.Color(1.0, 0.85, 0.5), P = new THREE.Vector3(), V = new THREE.Vector3();
    for (let i = 0; i < 70; i++) {
      P.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 8, 0.2, (Math.random() - 0.5) * 16).applyMatrix4(new THREE.Matrix4().extractRotation(basis)));
      V.copy(up).multiplyScalar(4 + Math.random() * 12).addScaledVector(fwd, (Math.random() - 0.3) * 20);
      this.sparks.emit(P, V, Math.random() < 0.6 ? c1 : c2, { size: 0.07 + Math.random() * 0.06, life: 0.4 + Math.random() * 0.6,
        alpha: 1.6, drag: 1.2, grav: 4, fadeIn: 0.02, stretch: 0.045 });
    }
    if (player) this.kick = 1;
  }

  // a hull grinding along a wall, every frame of contact: a stream of sparks thrown back and out of the contact,
  // falling to the deck and skipping along it, cooling as they go; the wall's face glows where it is gouged.
  // f: the track frame at the contact (P on the centre line, T along, U up, R right); side: the wall (+1 right)
  grind(at, vel, side, dt, f = null) {
    const white = new THREE.Color(1, 1, 1), V = new THREE.Vector3();
    const plane = f ? { P: f.P, N: f.U } : null, out = f ? f.R.clone().multiplyScalar(-side) : new THREE.Vector3();
    const sp = vel.length(), n = Math.min(24, Math.ceil(dt * (260 + sp * 1.6)));
    for (let i = 0; i < n; i++) {
      // torn off at nearly the hull's speed: they trail 5-20 m behind the contact (thrown back harder they were past
      // the chase camera in a blink)
      V.copy(vel).multiplyScalar(0.8 + Math.random() * 0.15).addScaledVector(out, 3 + Math.random() * 9);
      if (f) V.addScaledVector(f.U, 1 + Math.random() * 7);
      V.add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4));
      this.sparks.emit(at, V, white, { size: 0.05 + Math.random() * 0.07, life: 0.3 + Math.random() * 0.45, alpha: 2.0,
        drag: 0.25, grav: 22, fadeIn: 0.01, stretch: 0.025, plane, bounce: 0.35 });
    }
    if (f) {                                              // the gouge on the wall's face, this frame's length of it
      const face = f.P.clone().addScaledVector(f.R, side * (TRACK_HALF - 0.02)).addScaledVector(f.U, 0.75 + Math.random() * 0.15);
      this.marks.add(face, f.T, out, sp * dt + 0.25, 0.7 + Math.random() * 0.3);
    }
  }

  get pools() { return [this.dust, this.smoke, this.fire, this.sparks, this.ions, this.glints, this.spray]; }

  // a ship through a curtain of falling water (at, its velocity v): the water bursts off its nose and over it - a
  // cloud of white spray left hanging in its wake, and drops flung out on arcs, falling
  splash(at, v) {
    const V = new THREE.Vector3(), P = new THREE.Vector3(), white = new THREE.Color(1.1, 1.15, 1.2), drop = new THREE.Color(0.95, 1.0, 1.06);
    for (let i = 0; i < 46; i++) {
      V.set(Math.random() - 0.5, Math.random() * 0.8 - 0.25, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 12).addScaledVector(v, 0.2 + 0.25 * Math.random());
      P.copy(at).addScaledVector(V, 0.06);
      this.smoke.emit(P, V, white, { size: 1.5 + Math.random() * 3, grow: 5 + Math.random() * 4, life: 0.7 + Math.random() * 1.1, alpha: 0.42,
        drag: 2.2, grav: 2.5, spin: (Math.random() - 0.5) * 1.5, fadeIn: 0.03 });
    }
    for (let i = 0; i < 260; i++) {
      V.set(Math.random() - 0.5, Math.random() * 0.9 - 0.1, Math.random() - 0.5).normalize().multiplyScalar(8 + Math.random() * 26).addScaledVector(v, 0.35 + 0.4 * Math.random());
      P.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5).add(at);
      this.spray.emit(P, V, drop, { size: 0.05 + Math.random() * 0.08, life: 0.5 + Math.random() * 0.9, alpha: 0.75,
        drag: 0.6, grav: 9.8, fadeIn: 0.02, stretch: 0.035 });
    }
  }

  // the deck under a point (for sparks to land on): the track frame there
  deckAt(p) {
    if (!this.track) return null;
    const i = this.track.nearestIndex(p);
    return { P: this.track.P[i], N: this.track.U[i], T: this.track.T[i], R: this.track.R[i] };
  }

  setScale() { /* billboards are sized in metres: nothing to do */ }

  // hover wash: the downdraft rolls dust out from under the hull; more the lower and the harder the ship works,
  // lit like the ground it comes off (sunlit tone, a little darker underneath)
  hover(flight, terrain, onRoad, dt) {
    const ship = flight.ship, agl = flight.agl;
    if (ship.power < 0.2 || agl > 10) return;
    const k = (1 - agl / 10) * ship.power * (0.5 + flight.throttle + flight.boosting) * (1 - 0.7 * Math.min(1, flight.speed / 100));
    this.acc += dt * 55 * k;
    const col = onRoad ? new THREE.Color(0.40, 0.38, 0.35) : new THREE.Color(0.42, 0.38, 0.27);
    const P = new THREE.Vector3(), V = new THREE.Vector3();
    while (this.acc > 1) {
      this.acc -= 1;
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5.5;
      P.set(flight.pos.x + Math.cos(a) * r, 0, flight.pos.z + Math.sin(a) * r);
      P.y = terrain.surface(P.x, P.z) + 0.25;
      const out = 5 + Math.random() * 9;
      V.set(Math.cos(a) * out + flight.vel.x * 0.35, 0.4 + Math.random() * 1.2, Math.sin(a) * out + flight.vel.z * 0.35);
      this.dust.emit(P, V, col, { size: 1.2 + Math.random() * 1.2, grow: 2.2, life: 1.4 + Math.random() * 1.2, alpha: 0.32,
        drag: 1.5, grav: -0.15, spin: (Math.random() - 0.5) * 1.2, fadeIn: 0.2 });
    }
  }

  // a light sprinkle of motes out of the nozzles on boost and a pad's kick only - drifting a few metres back from the
  // ship, slowly (a constant fast stream "is too much and too fast")
  exhaust(ship, flight, dt) {
    const k = ship.spin * Math.max(0, Math.min(1, flight.boosting + 0.7 * (ship.boostKick || 0)) - 0.15);
    if (k <= 0) return;
    ship.ionAcc = (ship.ionAcc || 0) + dt * 45 * k;
    const M = ship.root.matrixWorld, back = new THREE.Vector3(0, 0, 1).transformDirection(M);
    const eng = ship.engineColor || new THREE.Color(0.1, 0.42, 1.0);
    const c1 = eng.clone().lerp(new THREE.Color(1, 1, 1), 0.35), c2 = eng.clone().lerp(new THREE.Color(1, 1, 1), 0.8);
    while (ship.ionAcc > 1) {
      ship.ionAcc -= 1;
      const pl = ship.plumes[(Math.random() * ship.plumes.length) | 0];
      const r = pl.r * Math.sqrt(Math.random()) * 0.8, a = Math.random() * 6.283;
      const p = pl.outer.position.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.3)).applyMatrix4(M);
      const v = back.clone().multiplyScalar(5 + Math.random() * 7).add(flight.vel)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.5));
      this.ions.emit(p, v, Math.random() < 0.6 ? c1 : c2, { size: pl.r * (0.035 + Math.random() * 0.04), grow: -0.02,
        life: 0.3 + Math.random() * 0.25, alpha: 0.9, drag: 0.03, fadeIn: 0.05, stretch: 0.004 });
    }
  }

  // a knock (a wall, another ship): a burst of sparks on the deck, a white flash, a puff of smoke
  scrape(at, v, strength = 1) {
    const white = new THREE.Color(1, 1, 1), V = new THREE.Vector3(), d = this.deckAt(at);
    const plane = d ? { P: d.P, N: d.N } : null, up = d ? d.N : new THREE.Vector3(0, 1, 0);
    const n = Math.round(30 + 40 * Math.min(1, strength));
    for (let i = 0; i < n; i++) {
      V.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 18)
        .addScaledVector(up, 3 + Math.random() * 6).addScaledVector(v, 0.85);
      this.sparks.emit(at, V, white, { size: 0.05 + Math.random() * 0.06, life: 0.4 + Math.random() * 0.6, alpha: 1.8,
        drag: 0.3, grav: 20, fadeIn: 0.01, stretch: 0.03, plane, bounce: 0.4 });
    }
    this.glints.emit(at, v.clone().multiplyScalar(0.95), new THREE.Color(1.0, 0.85, 0.65), { size: 2.2 + 2.5 * Math.min(1, strength),
      grow: 9, life: 0.16, alpha: 3.0, drag: 4, fadeIn: 0.01 });
    const grey = new THREE.Color(0.32, 0.31, 0.3);
    for (let i = 0; i < 6; i++) {
      V.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5).multiplyScalar(4).addScaledVector(v, 0.5);
      this.smoke.emit(at, V, grey, { size: 0.8 + Math.random(), grow: 2.5, life: 0.8 + Math.random() * 0.6, alpha: 0.18,
        drag: 2.5, grav: -0.3, spin: (Math.random() - 0.5) * 1.5, fadeIn: 0.1 });
    }
  }

  explode(at, v) {
    const V = new THREE.Vector3(), P = new THREE.Vector3();
    const fireA = new THREE.Color(1.0, 0.55, 0.18), fireB = new THREE.Color(1.0, 0.82, 0.45);
    for (let i = 0; i < 60; i++) {           // fireball: hot puffs that expand and burn out in under a second
      V.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 16).addScaledVector(v, 0.3);
      P.copy(at).addScaledVector(V, 0.08);
      this.fire.emit(P, V, Math.random() < 0.5 ? fireA : fireB, { size: 2 + Math.random() * 2.5, grow: 6, life: 0.45 + Math.random() * 0.6,
        alpha: 0.5, drag: 2.2, grav: -2, spin: (Math.random() - 0.5) * 2, fadeIn: 0.04 });
    }
    const grey = new THREE.Color(0.11, 0.10, 0.10), grey2 = new THREE.Color(0.22, 0.21, 0.20);
    for (let i = 0; i < 120; i++) {          // smoke: rises and spreads for seconds after the fire is out
      V.set(Math.random() - 0.5, 0.4 + Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 7);
      P.copy(at).addScaledVector(V, 0.3);
      this.smoke.emit(P, V, Math.random() < 0.5 ? grey : grey2, { size: 3 + Math.random() * 4, grow: 3.5, life: 3 + Math.random() * 4,
        alpha: 0.7, drag: 0.8, grav: -1.4, spin: (Math.random() - 0.5) * 0.6, fadeIn: 0.12 });
    }
    const hot = new THREE.Color(1.0, 0.6, 0.22), white = new THREE.Color(1.0, 0.92, 0.75);
    for (let i = 0; i < 260; i++) {          // sparks and debris glints on ballistic arcs
      V.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 38).addScaledVector(v, 0.3);
      this.sparks.emit(at, V, Math.random() < 0.6 ? hot : white, { size: 0.06 + Math.random() * 0.07, life: 0.6 + Math.random() * 1.6,
        alpha: 1.6, drag: 0.35, grav: 9.8, fadeIn: 0.01, stretch: 0.03 });
    }
    this.flash.position.copy(at).add(new THREE.Vector3(0, 2, 0));
    this.flashT = 1;
    this.ring.position.copy(at);
    this.ring.visible = true;
    this.ringT = 0;
  }

  update(dt, camera, flight) {
    if (this.camLast && dt > 0) CAM_VEL.lerp(camera.position.clone().sub(this.camLast).divideScalar(dt), 0.5);
    (this.camLast ||= new THREE.Vector3()).copy(camera.position);
    if (CAM_VEL.lengthSq() > 1e6) CAM_VEL.set(0, 0, 0);       // a cut: no blur
    for (const p of this.pools) p.update(dt);
    this.marks.update(dt);
    this.kick = Math.max(0, this.kick - dt * 1.2);
    this.streaks.update(dt, flight.speed, Math.min(1, flight.boosting + this.kick));
    for (const m of this.waves) {
      const u = m.userData;
      if (!m.visible) continue;
      u.t += dt / u.life;
      const r = 1 + u.size * Math.sqrt(u.t);
      m.scale.set(r, 1, r);
      m.material.color.copy(u.col).multiplyScalar(Math.max(0, 1 - u.t));
      m.visible = u.t < 1;
    }
    this.flashT = Math.max(0, this.flashT - dt * 1.6);
    this.flash.intensity = 5000 * this.flashT * this.flashT;
    if (this.ring.visible) {
      this.ringT += dt / 0.7;
      const s = 2 + 38 * Math.sqrt(this.ringT);
      this.ring.scale.set(s, 1, s);
      this.ring.material.opacity = Math.max(0, 1 - this.ringT) * 0.8;
      this.ring.visible = this.ringT < 1;
    }
  }
}
