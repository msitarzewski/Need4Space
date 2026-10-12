// The space map's far scenery: a ring station turning on its axis (lit windows, spokes, a hub), a jump gate (a
// ring of machinery round a swirling energy field), freighters crossing the distance (container stacks, a bridge,
// engines burning, nav lights blinking) and a cratered moon in the sky. Everything is far from the circuit (2-7 km),
// lit by the sun, built from simple solids - silhouettes and lights are what reads at that distance.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { moonMesh } from './celestial.js';

const merge = (gs) => {
  const all = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = all.reduce((a, g) => a + g.attributes.position.count, 0), pp = new Float32Array(n * 3), nr = new Float32Array(n * 3);
  let o = 0;
  for (const g of all) { pp.set(g.attributes.position.array, o * 3); nr.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  return g;
};
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// hull plating with rows of lit windows: the window pattern from the surface's own uv, in the emissive
function windowed(color, rows, cols, lit = 0.35, glow = new THREE.Color(1.0, 0.82, 0.55)) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.55 });
  m.defines = { USE_UV: '' };                     // vUv without a map
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      float wh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      // a periodic pulse [a, b) of each cell, box-filtered over a pixel w cells wide (its running integral's slope)
      float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
      float pulseAA(float x, float a, float b, float w) { w = max(w, 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec2 c = vUv * vec2(${cols.toFixed(1)}, ${rows.toFixed(1)}), fw = fwidth(c) * 1.3;
        float on = step(${(1 - lit).toFixed(2)}, wh(floor(c)));
        // each window's edges box-filtered (hard steps crawled as the station turned: "still flickering"), and
        // windows under ~8 pixels a cell fade into their average glow
        float win = pulseAA(c.x, 0.25, 0.75, fw.x) * pulseAA(c.y, 0.3, 0.7, fw.y);
        float sharp = 1.0 - smoothstep(0.12, 0.4, max(fw.x, fw.y));
        float lightOn = mix(${(lit * 0.2).toFixed(3)}, win * on, sharp);
        totalEmissiveRadiance += vec3(${glow.r.toFixed(2)}, ${glow.g.toFixed(2)}, ${glow.b.toFixed(2)}) * lightOn * 3.0;
      }`);
  };
  m.customProgramCacheKey = () => `windowed-${rows}-${cols}-${lit}`;
  return m;
}

// Point lights seen from far away (beacons, docking and nav lights): screen-facing glows never smaller than 3 pixels,
// their light spread over the bigger disc so a distant one dims instead of popping in and out between pixels (cubes
// of 10-16 m were a pixel or less at 3-7 km: "lights flicker too"). Each light: position, colour, size (m), blink
// (0: steady, else its rate) and phase; blinking fades in and out.
function glowLights(list) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), aux = new Float32Array(n * 3);
  list.forEach(({ p, c, size, blink = 0, phase = 0 }, i) => { pos.set(p, i * 3); col.set([c.r, c.g, c.b], i * 3); aux.set([size, blink, phase], i * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aux', new THREE.BufferAttribute(aux, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { scale: { value: 1000 }, time: { value: 0 } },
    vertexShader: /* glsl */`uniform float scale, time; attribute vec3 color; attribute vec3 aux; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = aux.x * scale / max(-mv.z, 1.0), ps = max(px, 3.0);
        float on = aux.y > 0.0 ? smoothstep(0.55, 0.8, sin(time * aux.y + aux.z)) * 0.92 + 0.08 : 1.0;
        vC = color * on * min(1.0, (px * px) / (ps * ps) * 2.2);
        gl_PointSize = ps * 2.2;
      }`,
    fragmentShader: /* glsl */`varying vec3 vC;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vC * (exp(-r * r * 9.0) + 0.12 * exp(-r * r * 2.5)), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  const v = new THREE.Vector2();
  pts.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(v);
    mat.uniforms.scale.value = v.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 60) / 2));
  };
  pts.frustumCulled = false;
  pts.userData.mat = mat;
  return pts;
}

function ringStation() {
  const g = new THREE.Group();
  const R = 900, tube = 46;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 24, 240), windowed(0x7d848e, 4, 420, 0.4));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(130, 130, 260, 48), windowed(0x6f7680, 10, 60, 0.3));
  hub.rotation.x = Math.PI / 2;
  const caps = [-1, 1].map((sd) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(60, 130, 80, 48), new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.5, metalness: 0.7 })); c.rotation.x = sd * Math.PI / 2; c.position.z = sd * 170; return c; });
  g.add(ring, hub, ...caps);
  for (let k = 0; k < 6; k++) {                                         // spokes, each a lit corridor
    // (from inside the hub to the ring's core: a flat end laid on the hub's curve fought it for the same pixels)
    const a = (k / 6) * Math.PI * 2, s = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, R - 118, 12), windowed(0x666d77, 24, 3, 0.5, new THREE.Color(0.6, 0.85, 1.0)));
    s.position.set(Math.cos(a) * (R + 118) / 2, Math.sin(a) * (R + 118) / 2, 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }
  // docking lights, steady, round each docking mouth (the cones' ends - the first ones sat half inside the cone),
  // and beacons on the ring's rim, blinking slowly in turn
  const lights = [], dock = new THREE.Color(3.2, 0.7, 0.45), beacon = new THREE.Color(4, 0.6, 0.4);
  for (const sd of [-1, 1]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    lights.push({ p: [Math.cos(a) * 63, Math.sin(a) * 63, sd * 212], c: dock, size: 6 });
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    lights.push({ p: [Math.cos(a) * (R + tube + 3), Math.sin(a) * (R + tube + 3), 0], c: beacon, size: 12, blink: 1.6, phase: k * 0.52 });
  }
  const glow = glowLights(lights);
  g.add(glow);
  g.userData.lights = glow.userData.mat;
  return g;
}

function jumpGate() {
  const g = new THREE.Group(), R = 520;
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 34, 16, 160), new THREE.MeshStandardMaterial({ color: 0x5b626c, roughness: 0.45, metalness: 0.75 })));
  const pods = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pods.push(box(110, 90, 120, Math.cos(a) * R, Math.sin(a) * R, 0).rotateZ(0)); }
  const podG = merge(pods.map((p, k) => { const a = (k / 8) * Math.PI * 2; return p.translate(0, 0, 0); }));
  g.add(new THREE.Mesh(podG, windowed(0x4c535c, 4, 12, 0.5, new THREE.Color(0.5, 0.8, 1.0))));
  // the field: a swirl of light, brightest at the rim, slowly turning
  const field = new THREE.Mesh(new THREE.CircleGeometry(R - 20, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float time; varying vec2 vP;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // the swirl: the plane turned by an angle that grows with the radius (no atan: its seam showed as a cut)
        float r = length(vP) / ${(R - 20).toFixed(1)}, ang = r * 7.0 - time * 0.5;
        vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (vP / ${(R - 20).toFixed(1)});
        float arms = n(q * 5.0 + 3.0) * 0.6 + n(q * 13.0 - time * 0.15) * 0.4;
        float rim = smoothstep(0.6, 1.0, r), core = exp(-r * r * 8.0);
        vec3 c = mix(vec3(0.15, 0.35, 1.0), vec3(0.6, 0.25, 1.0), arms) * (arms * (0.35 + rim * 1.4) + core * 0.6);
        gl_FragColor = vec4(c * smoothstep(1.0, 0.94, r), 1.0);
      }`,
  }));
  g.add(field);
  g.userData.field = field.material;
  g.userData.fieldMesh = field;
  return g;
}

function freighter(rnd) {
  const L = 160 + rnd() * 180, g = new THREE.Group(), hull = [], cont = [], glow = [];
  hull.push(box(14, 14, L, 0, 0, 0));                                   // the spine
  hull.push(box(46, 34, 40, 0, 6, L / 2 + 10));                         // the engine block (aft = +z)
  hull.push(box(26, 26, 22, 0, 32, L / 2 - 6));                         // the bridge on top of it
  hull.push(box(30, 18, 26, 0, 0, -L / 2 - 8));                         // the bow
  const cols = new THREE.Color();
  const contMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 });
  const colours = [0x6a3a30, 0x34485e, 0x6a6036, 0x46543e, 0x5a5c60, 0x6e4c2e, 0x4a4c50];   // weathered, not toy-bright
  const cGeos = [];
  for (let z = -L / 2 + 12; z < L / 2 - 20; z += 13) {
    for (const [x, y] of [[-14, 0], [14, 0], [-14, 13], [14, 13], [0, 13], [-14, -13], [14, -13]]) {
      if (rnd() < 0.18) continue;
      const b = box(12, 12, 12, x, y, z).toNonIndexed();
      cols.set(colours[(rnd() * colours.length) | 0]).multiplyScalar(0.7 + rnd() * 0.4);
      const c = new Float32Array(b.attributes.position.count * 3);
      for (let i = 0; i < c.length; i += 3) { c[i] = cols.r; c[i + 1] = cols.g; c[i + 2] = cols.b; }
      b.setAttribute('color', new THREE.BufferAttribute(c, 3));
      cGeos.push(b);
    }
  }
  const cg = merge(cGeos);
  const ca = new Float32Array(cGeos.reduce((a, b) => a + b.attributes.color.array.length, 0)); let o = 0;
  for (const b of cGeos) { ca.set(b.attributes.color.array, o); o += b.attributes.color.array.length; }
  cg.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  g.add(new THREE.Mesh(merge(hull), windowed(0x6c737c, 8, 40, 0.25)), new THREE.Mesh(cg, contMat));
  for (const x of [-13, 0, 13]) glow.push(new THREE.CircleGeometry(7, 20).translate(x, 6, L / 2 + 30.2));
  g.add(new THREE.Mesh(merge(glow), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 6.0) })));
  // nav lights: red to port, green to starboard, white on the bridge, blinking
  const nav = glowLights([{ p: [-25, 6, L / 2 - 6], c: new THREE.Color(5, 0.3, 0.2), size: 4, blink: 3, phase: 0 },
    { p: [25, 6, L / 2 - 6], c: new THREE.Color(0.3, 5, 0.6), size: 4, blink: 3, phase: 2.1 },
    { p: [0, 47, L / 2 - 6], c: new THREE.Color(5, 5, 5), size: 4, blink: 3, phase: 4.2 }]);
  g.add(nav);
  g.userData.nav = nav.userData.mat;
  g.userData.len = L;
  return g;
}

function moon(sunDir) {
  return new THREE.Mesh(new THREE.SphereGeometry(2200, 96, 48), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir.clone() } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vL;
      void main() { vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 sunDir; varying vec3 vN; varying vec3 vL;
      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      float craters(vec3 p) {
        vec3 i = floor(p), f = fract(p); float c = 0.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 o = vec3(x, y, z), r = o + vec3(h3(i + o), h3(i + o + 3.1), h3(i + o + 7.7)) - f;
          float d = length(r), rad = 0.25 + 0.3 * h3(i + o + 1.3);
          c += (d < rad ? -0.6 * (1.0 - d * d / (rad * rad)) : 0.3 * exp(-pow((d - rad) / 0.06, 2.0)));
        }
        return c;
      }
      void main() {
        float maria = smoothstep(0.45, 0.65, n3(vL * 2.2));
        float cr = craters(vL * 7.0) * 0.6 + craters(vL * 19.0) * 0.3;
        vec3 alb = mix(vec3(0.42, 0.41, 0.4), vec3(0.2, 0.2, 0.21), maria) * (0.85 + 0.15 * n3(vL * 40.0));
        // the craters as shading: a slope toward / away from the sun along the surface
        float lit = max(dot(normalize(vN), sunDir), 0.0);
        float rel = clamp(lit + cr * 0.25 * lit, 0.0, 1.2);
        gl_FragColor = vec4(alb * rel * 4.5 + alb * 0.012, 1.0);
      }`,
  }));
}

export class Scenery {
  constructor(scene, sky, sunDir, renderer) {
    const rnd = mulberry32(919);
    this.station = ringStation();
    this.station.position.set(-2600, 950, -5400);
    this.station.rotation.set(0.35, 0.6, 0);
    this.gate = jumpGate();
    this.gate.position.set(6400, 300, 900);
    this.gate.rotation.set(0.1, -1.2, 0);
    this.freighters = [];
    for (let k = 0; k < 6; k++) {
      const f = freighter(rnd);
      const dir = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.15, rnd() - 0.5).normalize();
      const centre = new THREE.Vector3(1800 + (rnd() - 0.5) * 7000, (rnd() < 0.5 ? -1 : 1) * (600 + rnd() * 700), 200 + (rnd() - 0.5) * 7000);
      f.userData.path = { centre, dir, span: 9000, speed: 35 + rnd() * 40, t: rnd() };
      f.lookAt(f.position.clone().sub(dir));                            // the bow (-z) leads
      this.freighters.push(f);
    }
    for (const o of [this.station, this.gate, ...this.freighters]) {
      o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = true; } });
      scene.add(o);
    }
    this.moon = renderer ? moonMesh(renderer, sunDir, 2200) : moon(sunDir);      // baked craters and relief
    this.moon.position.copy(new THREE.Vector3(-0.72, 0.38, 0.58).normalize().multiplyScalar(52000));
    sky.add(this.moon);
  }

  update(t, dt) {
    this.station.rotateZ(dt * 0.025);
    this.station.userData.lights.uniforms.time.value = t;
    this.gate.userData.field.uniforms.time.value = t;
    for (const f of this.freighters) {
      const p = f.userData.path;
      p.t = (p.t + (p.speed * dt) / p.span) % 1;
      f.position.copy(p.centre).addScaledVector(p.dir, (p.t - 0.5) * p.span);
      f.userData.nav.uniforms.time.value = t;
    }
  }
}
