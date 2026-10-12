// The storm: a front of thunderheads over the eastern horizon, where the blizzard blows from - towers and anvils dark
// against the dusk, their tops lit rose by the sun going down behind the circuit, their bases in the world's shadow;
// lightning inside them every few seconds (the clouds flaring from within, two or three pulses, now and then a bolt
// down to the ice behind the peaks) and a faint flicker over everything.
// The clouds are baked once into a band of the sky (azimuth round, elevation up to ~30 deg) and drawn over the air in
// the sky's own scene: a texture lookup a pixel. The lightning is a few uniforms, the bolt a ribbon rebuilt per strike.
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { ICE_GLSL } from './frost.js';
import { mulberry32 } from './noise.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const EL0 = -0.04, EL1 = 0.52;                // the band's elevations (rad)
const AZ0 = 1.35, AZW = 1.25;                 // the storm's middle (rad from north toward east) and half its width
const R = 40000;                              // the band's radius (in the sky's scene)

const NOISE = /* glsl */`
  float sh2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float sn2(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sh2(mod(i, per)), sh2(mod(i + vec2(1, 0), per)), u.x), mix(sh2(mod(i + vec2(0, 1), per)), sh2(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float sfbm(vec2 p, float per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 7; i++) { if (i >= oct) break; s += a * sn2(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n; }
`;

// the clouds over the band (u: azimuth 0..1 from north toward east, v: elevation EL0..EL1): r density, g how deep
// inside the cloud (0 at its edge), b the light on it (the billows' tops lit, their undersides in their own shade)
const BAKE = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  ${NOISE}
  float hh(float x) { return sh2(vec2(x * 7.31, x * 1.73 + 11.0)); }
  // how much storm there is round azimuth u (0..1): the front in the east
  float frontAt(float u) {
    float da = abs(mod(u * 6.2831853 - ${AZ0.toFixed(3)} + 3.14159265, 6.2831853) - 3.14159265);
    return smoothstep(${AZW.toFixed(3)}, ${(AZW * 0.3).toFixed(3)}, da);
  }
  // the thunderheads: domes of their own widths and heights along the front over a low deck of cloud all round, the
  // tallest spreading an anvil at the top; density at (u, el), and how deep inside
  float dens(float u, float el, vec2 w, out float inner) {
    float uw = u + w.x * 0.01;
    float top = 0.035 + 0.025 * sfbm(vec2(uw * 48.0, 2.0), 48.0, 3) + frontAt(uw) * 0.03, anvil = 0.0;
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float c = ${(AZ0 / (2 * Math.PI)).toFixed(4)} + ((fi + 0.2 + 0.6 * hh(fi + 0.3)) / 18.0 - 0.5) * ${((AZW * 1.7) / (2 * Math.PI)).toFixed(4)};
      float wd = 0.012 + 0.02 * hh(fi + 3.1), h = (0.12 + 0.22 * hh(fi + 7.7)) * frontAt(c);
      float x = (fract(uw - c + 0.5) - 0.5) / wd;
      if (abs(x) < 1.0) top = max(top, 0.03 + h * pow(1.0 - x * x, 0.35));
      // an anvil: the tallest flatten out and spread at their tops
      float xa = (fract(uw - c + 0.5) - 0.5) / (wd * 2.6);
      if (h > 0.24 && abs(xa) < 1.0) anvil = max(anvil, (1.0 - xa * xa) * exp(-pow((el - 0.03 - h + 0.008) / (0.011 + 0.006 * (1.0 - xa * xa)), 2.0)));
    }
    vec2 p = vec2(u * 64.0, el * 64.0 / 6.2831853);
    float e = (top - el) / 0.022 + (sfbm(p * 1.5 + w * 5.0, 96.0, 5) - 0.5) * 2.6;
    inner = e;
    return clamp(smoothstep(0.0, 0.5, e) + anvil * smoothstep(0.35, 0.6, sfbm(p * 2.0 + 9.0, 128.0, 4)), 0.0, 1.0) * smoothstep(${EL0.toFixed(3)}, 0.0, el);
  }
  void main() {
    float u = vUv.x, el = ${EL0.toFixed(3)} + vUv.y * ${(EL1 - EL0).toFixed(3)};
    vec2 p = vec2(u * 64.0, el * 64.0 / 6.2831853);
    vec2 w = vec2(sfbm(p * 0.5 + 3.1, 32.0, 4), sfbm(p * 0.5 + 7.7, 32.0, 4)) - 0.5;
    float inner, q;
    float d = dens(u, el, w, inner);
    // the light: what of the cloud lies just over this point (a billow's top is lit, under it its own shade)
    float over = dens(u, el + 0.005, w, q) + dens(u, el + 0.012, w, q) * 0.8 + dens(u, el + 0.024, w, q) * 0.6;
    float light = exp(-1.4 * over);
    gl_FragColor = vec4(d, clamp(inner * 0.4, 0.0, 1.0), light, 1.0);
  }`;

export class Storm {
  constructor(renderer, scene) {
    const W = Q.tier === 'low' ? 1024 : 2048, H = W / 4;
    this.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: BAKE }));
    // (in strips: one long full-screen job can trip a slow GPU's watchdog)
    for (let k = 0; k < 4; k++) {
      bakeLater(k ? [] : [quadJob(quad)], () => {
        const prev = renderer.getRenderTarget();
        this.rt.scissor.set(0, (k * H) / 4, W, H / 4); this.rt.scissorTest = true;
        this.rt.texture.generateMipmaps = k === 3;
        renderer.setRenderTarget(this.rt); quad.render(renderer); renderer.setRenderTarget(prev);
        this.rt.scissorTest = false;
        if (k === 3) { quad.material.dispose(); quad.dispose(); }
      });
    }
    // three flashes at a time: direction (az, el), strength
    this.flashes = [0, 1, 2].map(() => new THREE.Vector4(0, 0.1, 0, 0));
    const U = { clouds: { value: this.rt.texture }, flash: { value: this.flashes }, flashK: { value: 1 } };
    this.U = U;
    // the band: a slice of a sphere round the sky's camera
    const g = new THREE.SphereGeometry(R, 128, 24, 0, Math.PI * 2, Math.PI / 2 - EL1, EL1 - EL0);
    this.clouds = new THREE.Mesh(g, new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: U,
      vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D clouds; uniform vec4 flash[3]; uniform float flashK; varying vec3 vDir;
        ${ICE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
          vec2 uv = vec2(fract(az / 6.2831853), (el - ${EL0.toFixed(3)}) / ${(EL1 - EL0).toFixed(3)});
          // (the seam at north: the gradient taken from the wrapped coordinate where it jumps)
          vec2 dx = dFdx(uv), dy = dFdy(uv);
          float u2 = fract(uv.x + 0.5);
          if (abs(dFdx(u2)) < abs(dx.x)) dx.x = dFdx(u2);
          if (abs(dFdy(u2)) < abs(dy.x)) dy.x = dFdy(u2);
          vec4 c = textureGrad(clouds, uv, dx, dy);
          if (c.r < 0.003) discard;
          // its own light: the dusk's (the air's glow in its direction, dimmed - a cloud is lit from above and the
          // side, not through), the tops rose where they rise into the low sun's light over the world's shadow
          vec3 sky = iaGlow(normalize(vec3(d.x, max(d.y, 0.02), d.z)));
          vec3 col = sky * (0.3 + 0.7 * c.b) + vec3(0.008, 0.011, 0.022) * (0.25 + 1.3 * c.b);
          float lit = smoothstep(0.02, 0.3, el) * c.b * c.b;
          col += IA_SUNRAD * vec3(0.55, 0.3, 0.36) * 0.045 * lit * (0.6 + 0.4 * max(dot(d, -IA_SUN), 0.0));
          // the lightning inside: each flash lights the cloud round it, the thinner edges the most
          for (int k = 0; k < 3; k++) {
            vec4 f = flash[k];
            if (f.z <= 0.0) continue;
            vec3 fd = vec3(sin(f.x) * cos(f.y), sin(f.y), -cos(f.x) * cos(f.y));
            float a = acos(clamp(dot(d, fd), -1.0, 1.0));
            col += vec3(0.55, 0.62, 1.0) * f.z * exp(-a * a / 0.006) * (0.3 + 0.7 * (1.0 - c.g)) * (0.4 + 0.6 * c.b) * 5.0 * flashK;
          }
          // far down at the horizon the air hides it
          float haze = smoothstep(0.0, 0.08, el);
          gl_FragColor = vec4(col * c.r * haze, c.r * haze);
        }`,
    }));
    this.clouds.renderOrder = 12;
    this.clouds.frustumCulled = false;
    // the bolt: a ribbon of up to 160 segments (a trunk and its branches), rebuilt per strike
    const NB = 160;
    this.boltG = new THREE.BufferGeometry();
    this.boltG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.boltG.setAttribute('k', new THREE.BufferAttribute(new Float32Array(NB * 4), 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < NB; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    this.boltG.setIndex(idx);
    this.boltG.setDrawRange(0, 0);
    this.boltMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { I: { value: 0 } },
      vertexShader: /* glsl */`attribute float k; varying float vK; void main() { vK = k; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float I; varying float vK; void main() { gl_FragColor = vec4(vec3(0.75, 0.8, 1.0) * I * vK * 32.0, 1.0); }`,
    });
    this.bolt = new THREE.Mesh(this.boltG, this.boltMat);
    this.bolt.renderOrder = 13;
    this.bolt.frustumCulled = false;
    scene.add(this.clouds, this.bolt);
    this.rnd = mulberry32(911);
    this.next = 3;
    this.strikes = [];                    // [{ t0, az, el, pulses: [[dt, k]], bolt }]
    this.flash = 0;                       // how bright the sky is from it now (0..1: main.js / ice.js)
  }

  // a jagged path down from the cloud's base to under the horizon, a branch or two off it
  buildBolt(az, el) {
    const rnd = this.rnd, pos = this.boltG.attributes.position.array, kk = this.boltG.attributes.k.array;
    let n = 0;
    const dir = (a, e) => new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(R * 0.98);
    const seg = (a0, e0, a1, e1, w, k) => {
      if (n >= 160) return;
      const A = dir(a0, e0), B = dir(a1, e1), side = new THREE.Vector3().crossVectors(B.clone().sub(A), A).normalize().multiplyScalar(w);
      [A.clone().sub(side), A.clone().add(side), B.clone().sub(side), B.clone().add(side)].forEach((v, j) => { pos.set([v.x, v.y, v.z], (n * 4 + j) * 3); kk[n * 4 + j] = k; });
      n++;
    };
    const walk = (a, e, eEnd, w, k, depth) => {
      const steps = Math.round((e - eEnd) / 0.0035);
      for (let i = 0; i < steps; i++) {
        const a1 = a + (rnd() - 0.5) * 0.006, e1 = e - 0.0035 * (0.6 + 0.8 * rnd());
        seg(a, e, a1, e1, w, k);
        if (depth < 1 && rnd() < 0.06) walk(a1, e1, e1 - 0.02 - 0.03 * rnd(), w * 0.6, k * 0.5, depth + 1);
        a = a1; e = e1;
      }
    };
    walk(az, el, -0.01, 45, 1, 0);
    this.boltG.attributes.position.needsUpdate = this.boltG.attributes.k.needsUpdate = true;
    this.boltG.setDrawRange(0, n * 6);
  }

  update(t) {
    const rnd = this.rnd;
    if (t > this.next) {
      // a strike: somewhere along the front, two to four pulses over half a second, a bolt one time in three
      const az = AZ0 + (rnd() - 0.5) * AZW * 1.4, el = 0.07 + 0.08 * rnd(), pulses = [];
      let dt = 0;
      for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) { pulses.push([dt, 0.5 + 0.5 * rnd()]); dt += 0.05 + 0.14 * rnd(); }
      const bolt = rnd() < 0.35;
      if (bolt) this.buildBolt(az, el);
      this.strikes.push({ t0: t, az, el, pulses, bolt });
      if (this.strikes.length > 3) this.strikes.shift();
      this.next = t + 1.5 + 5 * rnd() * rnd();
    }
    let sky = 0, boltI = 0;
    this.strikes.forEach((s, i) => {
      let I = 0;
      for (const [d, k] of s.pulses) { const a = t - s.t0 - d; if (a >= 0) I += k * Math.exp(-a / 0.06) * (a < 0.02 ? a / 0.02 : 1); }
      this.flashes[i].set(s.az, s.el + 0.04, I, 0);
      sky = Math.max(sky, I);
      if (s.bolt && i === this.strikes.length - 1) boltI = I;
    });
    for (let i = this.strikes.length; i < 3; i++) this.flashes[i].z = 0;
    this.boltMat.uniforms.I.value = boltI;
    this.bolt.visible = this.clouds.visible && boltI > 0.02;
    this.flash = Math.min(1, sky);
  }

  // the storm off: no clouds, no lightning
  set visible(on) { this.clouds.visible = on; if (!on) this.bolt.visible = false; }
}
