// The ice planet's ground: a frozen sea under the circuit - black ice clear enough to mirror the sky, cracked into
// plates whose seams glow cyan from the water below, milky patches, drifts of snow combed by the wind into sastrugi,
// pressure ridges, two rifts the track jumps; off the ice shelf the sea ice broken into floes, open water glowing
// between them - and a ring of dark peaks round the horizon.
// The surface is one tile (masks + relief) painted on the GPU at load and laid over the ground hex-tiled (each hex a
// shifted copy, blended by height: no repeat to see); broad fields (drifts, the rifts' walls, the mountains) are per
// vertex. Lit by the sun and the sky alone (look.js sunOnly) and the world's shadow map (no cascade search).
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { sunOnly } from './look.js';
import { fbm, noise2, ridged, smoothstep } from './noise.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const ICE_TILE = 160;                   // the ground tile's size (m)

// ---------------------------------------------------------------- the tile
const TILE_GEN = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform int mode;
  uniform float texel;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  float vn(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float fbm(vec2 p, vec2 per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 7; i++) { if (i >= oct) break; s += a * vn(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n; }
  // cell edges: distance to the nearest edge between two cells (F2 - F1, halved), tiling with period per
  float edges(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), c = mod(i + o, per), r = o + 0.1 + 0.8 * h22(c) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; m2 = m1; d1 = d; m1 = r; } else if (d < d2) { d2 = d; m2 = r; }
    }
    return dot(0.5 * (m1 + m2), normalize(m2 - m1));
  }
  // x crack glow, y snow, z milky ice, w height (m)
  vec4 field(vec2 uv) {
    vec2 w = vec2(fbm(uv * 4.0, vec2(4.0), 4), fbm(uv * 4.0 + 5.2, vec2(4.0), 4)) - 0.5;
    // the plates: ~27 m, their seams warped; fractures inside some of them; a fine crazing
    float e1 = edges(uv * 6.0 + w * 0.9, 6.0);
    float e2 = edges(uv * 18.0 + w * 2.0 + 3.7, 18.0);
    float e3 = edges(uv * 64.0 + w * 5.0, 64.0);
    float reg2 = smoothstep(0.45, 0.7, fbm(uv * 3.0 + 9.1, vec2(3.0), 3));
    float wid = 0.012 + 0.02 * fbm(uv * 40.0, vec2(40.0), 2);
    float c1 = 1.0 - smoothstep(wid * 0.3, wid, e1);
    float g1 = exp(-e1 / 0.05) * 0.35;
    float c2 = (1.0 - smoothstep(0.01, 0.035, e2)) * reg2;
    float crack = max(c1 + g1, c2 * 0.7);
    // snow: drifts combed along the wind (x), sastrugi ripples across them
    float sn = fbm(vec2(uv.x * 3.0, uv.y * 9.0) + w * 0.6, vec2(3.0, 9.0), 5);
    float snow = smoothstep(0.5, 0.62, sn);
    float rip = (0.5 + 0.5 * sin((uv.y * 90.0 + fbm(uv * vec2(6.0, 18.0), vec2(6.0, 18.0), 3) * 14.0) * 6.2831853)) * smoothstep(0.55, 0.8, fbm(uv * 7.0 + 2.0, vec2(7.0), 3));
    float milky = smoothstep(0.42, 0.7, fbm(uv * 5.0 + 1.3, vec2(5.0), 4)) * (1.0 - crack);
    // height: snow stands proud (to 0.4 m), the seams sunk, the crazing a scratch
    float h = snow * (0.25 + 0.03 * rip) + smoothstep(0.4, 0.75, sn) * 0.1 - c1 * 0.12 - c2 * 0.05
      - (1.0 - smoothstep(0.0, 0.02, e3)) * 0.008 + (fbm(uv * 90.0, vec2(90.0), 3) - 0.5) * 0.02;
    return vec4(clamp(crack, 0.0, 1.0), snow, milky, h);
  }
  void main() {
    vec4 F = field(vUv);
    if (mode == 0) { gl_FragColor = vec4(F.xyz, clamp(F.w * 2.0 + 0.3, 0.0, 1.0)); return; }
    // relief: the height's slope (m per m), the tile being ${ICE_TILE.toFixed(1)} m
    float e = texel;
    float hx = field(vUv + vec2(e, 0.0)).w - field(vUv - vec2(e, 0.0)).w;
    float hy = field(vUv + vec2(0.0, e)).w - field(vUv - vec2(0.0, e)).w;
    vec2 g = vec2(hx, hy) / (2.0 * e * ${ICE_TILE.toFixed(1)});
    gl_FragColor = vec4(clamp(g * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);
  }
`;

const U = { iceMask: { value: null }, iceNrm: { value: null }, iceGlow: { value: null }, iceGlowT: { value: new THREE.Vector4(0, 0, 1, 1) },
  floeMask: { value: null }, floeT: { value: new THREE.Vector4(0, 0, 0, 0) } };
// the light pooled on the ice round what stands on it (a map over the ground: x0, z0, 1 / size)
export function setGroundGlow(tex, x0, z0, size) { U.iceGlow.value = tex; U.iceGlowT.value.set(x0, z0, 1 / size, 1 / size); }
// where the sea ice is broken (a map: r how open, g all water - under the shelf, its crevasse's floor)
export function setFloes(tex, x0, z0, size) { U.floeMask.value = tex; U.floeT.value.set(x0, z0, 1 / size, 1 / size); }
let maps = null;
export function iceMaps(renderer) {
  if (maps) return maps;
  const S = Q.tier === 'low' ? 1024 : 2048;
  const bake = (mode) => {
    const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { mode: { value: mode }, texel: { value: 1 / S } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: TILE_GEN }));
    for (let k = 0; k < 4; k++) {
      bakeLater(k ? [] : [quadJob(quad)], () => {
        const prev = renderer.getRenderTarget();
        rt.scissor.set(0, k * S / 4, S, S / 4); rt.scissorTest = true;
        rt.texture.generateMipmaps = k === 3;
        renderer.setRenderTarget(rt); quad.render(renderer);
        rt.scissorTest = false;
        renderer.setRenderTarget(prev);
        if (k === 3) { quad.material.dispose(); quad.dispose(); }
      });
    }
    return rt.texture;
  };
  maps = { mask: bake(0), normal: bake(1) };
  U.iceMask.value = maps.mask; U.iceNrm.value = maps.normal;
  return maps;
}

// the tile, hex-tiled: three shifted copies blended over a hex grid by their heights (no rotation: the drifts keep the
// wind's direction)
const HEX = /* glsl */`
uniform sampler2D iceMask, iceNrm;
vec2 ihHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
void ihTap(vec2 v, vec2 uv, vec2 gx, vec2 gy, out vec4 m, out vec2 g) {
  vec2 u2 = uv + ihHash(v * 1.71 + 5.3) * 7.0;
  m = textureGrad(iceMask, u2, gx, gy);
  g = textureGrad(iceNrm, u2, gx, gy).xy * 2.0 - 1.0;
}
void iceHex(vec2 uv, out vec4 m, out vec2 g) {
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec2 st = uv * 2.2;
  vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
  vec2 b = floor(sk);
  vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  vec4 m0, m1, m2; vec2 g0, g1, g2;
  ihTap(b + vec2(s), uv, gx, gy, m0, g0);
  ihTap(b + vec2(s, 1.0 - s), uv, gx, gy, m1, g1);
  ihTap(b + vec2(1.0 - s, s), uv, gx, gy, m2, g2);
  vec3 W = pow(max(w, 0.0), vec3(5.0)) * pow(vec3(0.15) + vec3(m0.a, m1.a, m2.a), vec3(3.0));
  W /= W.x + W.y + W.z;
  m = m0 * W.x + m1 * W.y + m2 * W.z;
  g = g0 * W.x + g1 * W.y + g2 * W.z;
}
// the tile's masks alone, at a broad scale (the snow fields and the big seams seen from the track, hundreds of metres)
void iceHexM(vec2 uv, out vec4 m) {
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec2 st = uv * 2.2;
  vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
  vec2 b = floor(sk);
  vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  vec4 m0 = textureGrad(iceMask, uv + ihHash((b + vec2(s)) * 1.71 + 2.3) * 7.0, gx, gy);
  vec4 m1 = textureGrad(iceMask, uv + ihHash((b + vec2(s, 1.0 - s)) * 1.71 + 2.3) * 7.0, gx, gy);
  vec4 m2 = textureGrad(iceMask, uv + ihHash((b + vec2(1.0 - s, s)) * 1.71 + 2.3) * 7.0, gx, gy);
  vec3 W = pow(max(w, 0.0), vec3(5.0)) * pow(vec3(0.15) + vec3(m0.a, m1.a, m2.a), vec3(3.0));
  m = (m0 * W.x + m1 * W.y + m2 * W.z) / (W.x + W.y + W.z);
}
float ihH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// the floes: distance to the nearest edge between two cells (F2 - F1, halved)
float ihCell(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)), r = o + 0.1 + 0.8 * ihHash(i + o) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; m2 = m1; d1 = d; m1 = r; } else if (d < d2) { d2 = d; m2 = r; }
  }
  return dot(0.5 * (m1 + m2), normalize(m2 - m1));
}
`;

// ---------------------------------------------------------------- the ground's shape
// rifts: [{ c: Vector3 (middle), dir: unit (along it, horizontal), len, wid, depth }]
export class IceSheet {
  // calm(x, z): 0..1 where the sea ice is broken into floes (flat: no drifts, no ridges)
  constructor(centre, rifts = [], calm = null) {
    this.C = centre.clone();
    this.rifts = rifts.map((r) => ({ ...r, nrm: new THREE.Vector3(-r.dir.z, 0, r.dir.x) }));
    this.calm = calm;
  }

  // { h: height (m), rift: 0..1 how deep in a rift, rock: 0..1 how much mountain, drift: 0..1 snow lying there }
  sample(x, z) {
    let h = 4 * (fbm(x / 700, z / 700, 3) - 0.5);
    // drifts of snow combed out along the wind (from the north-east): long low ridges, black ice swept bare between
    const a = x * -0.72 + z * 0.69, c = -x * 0.69 - z * 0.72;
    const dn = fbm(a / 300 + 4.1, c / 75 - 2.3, 4) + 0.12 * (noise2(x / 1800, z / 1800) - 0.5);
    const flat = 1 - (this.calm ? this.calm(x, z) : 0);
    const drift = smoothstep(0.47, 0.6, dn) * flat;
    h += drift * (1.6 + 2.6 * smoothstep(0.55, 0.75, dn));
    // pressure ridges: sparse, sharp, wandering
    const wx = x + 160 * (noise2(x / 900, z / 900) - 0.5), wz = z + 160 * (noise2(x / 900 + 7.3, z / 900 + 3.1) - 0.5);
    const r = 1 - Math.abs(2 * noise2(wx / 380, wz / 380) - 1);
    h += Math.pow(r, 16) * 8 * smoothstep(0.35, 0.6, noise2(x / 1500 + 2, z / 1500)) * flat;
    let rift = 0;
    for (const R of this.rifts) {
      const dx = x - R.c.x, dz = z - R.c.z, along = dx * R.dir.x + dz * R.dir.z, across = dx * R.nrm.x + dz * R.nrm.z;
      const ends = smoothstep(R.len / 2, R.len / 2 - 120, Math.abs(along));
      if (ends <= 0) continue;
      const hw = R.wid / 2 * (0.75 + 0.5 * noise2(along / 60, R.c.x * 0.01)) * (0.4 + 0.6 * ends);
      const k = smoothstep(hw, hw * 0.45, Math.abs(across) + 6 * (noise2(along / 14, across / 14) - 0.5));
      rift = Math.max(rift, k);
      h -= k * R.depth * (0.75 + 0.25 * noise2(along / 40, 3.3));
    }
    const dx = x - this.C.x, dz = z - this.C.z, d = Math.hypot(dx, dz);
    const m = smoothstep(4300, 9000, d + 1400 * (noise2(Math.atan2(dz, dx) * 2.5, 1.7) - 0.5));
    let rock = 0;
    if (m > 0) {
      const rr = ridged(x / 2400 + 11, z / 2400 - 4, 6);
      // a great massif across the north (under the aurora), the ring low in the south-west (under the sunset)
      const north = Math.max(0, -dz / Math.max(d, 1)), sw = Math.max(0, (-dx * 0.62 + dz * 0.76) / Math.max(d, 1));
      const tall = (0.5 + 1.1 * Math.pow(north, 1.5) - 0.35 * Math.pow(sw, 2)) * (0.55 + 0.45 * noise2(x / 6000, z / 6000));
      h += m * (120 + 2100 * Math.pow(rr, 1.7) * tall);
      rock = m;
    }
    return { h, rift, rock, drift };
  }

  height(x, z) { return this.sample(x, z).h; }

  // the ground as polar rings round the circuit's middle (fine near it, coarse out at the peaks), cut into sectors
  // that are culled on their own; r0..r1 (m), nA segments round
  build(r0, r1, nA, sectors, mat) {
    const rings = [];
    for (let r = r0; r < r1;) { rings.push(r); r += Math.min(420, Math.max(9, r * 0.019)); }
    rings.push(r1);
    const nR = rings.length, pos = new Float32Array(nR * nA * 3), attr = new Float32Array(nR * nA * 3);
    const hs = new Float32Array(nR * nA);
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nA; j++) {
        const a = (j / nA) * Math.PI * 2, x = this.C.x + Math.cos(a) * Math.max(rings[i], 0.01), z = this.C.z + Math.sin(a) * Math.max(rings[i], 0.01);
        const s = this.sample(x, z), k = i * nA + j;
        pos.set([x, s.h, z], k * 3);
        hs[k] = s.h;
        attr.set([s.drift * (1 - Math.min(1, s.rift * 4)), s.rock, s.rift], k * 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('ice', new THREE.BufferAttribute(attr, 3));
    const idx = [];
    for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nA; j++) {
      const a = i * nA + j, b = i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    // the sectors: the same vertices, each its own triangles (normals worked out over the whole, no seams)
    const out = [];
    for (let s = 0; s < sectors; s++) {
      const j0 = Math.floor((s * nA) / sectors), j1 = Math.floor(((s + 1) * nA) / sectors), si = [];
      for (let i = 0; i < nR - 1; i++) for (let j = j0; j < j1; j++) {
        const a = i * nA + j, b = i * nA + ((j + 1) % nA), c = a + nA, d = b + nA;
        si.push(a, b, c, b, d, c);
      }
      const sg = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'ice']) sg.setAttribute(k, g.attributes[k]);
      sg.setIndex(si);
      sg.computeBoundingSphere();
      sg.computeBoundingBox();
      const m = new THREE.Mesh(sg, mat);
      m.receiveShadow = true;
      m.castShadow = false;
      out.push(m);
    }
    return { meshes: out, tris: idx.length / 3 };
  }
}

// ---------------------------------------------------------------- the material
export function iceSheetMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0 });
  // (the world's shadow only, one bilinear tap: no cascade search)
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '', FOLIAGE_ONE_TAP: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const lite = Q.lite ? '#define ICE_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 ice; varying vec3 vIce; varying vec3 vTW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vIce = ice;
  vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = lite + sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vIce; varying vec3 vTW;
uniform sampler2D iceGlow, floeMask; uniform vec4 iceGlowT, floeT;
${HEX}
float iceCrack = 0.0, iceSnow = 0.0, iceWater = 0.0, iceLead = 0.0;
vec2 iceG = vec2(0.0);`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec4 im = vec4(0.14, 0.48, 0.51, 0.63), ib;
  // the fine tile only where its texels can show (a pixel under ~1.5 m): beyond, its average
  float iceFp = length(fwidth(vTW.xz));
#ifdef ICE_LITE
  float iceFine = 0.0;                                    // (Laptop mode: the broad scale alone)
#else
  float iceFine = 1.0 - smoothstep(0.6, 1.5, iceFp);
#endif
  if (iceFine > 0.0) {
    vec4 m; vec2 g;
    iceHex(vTW.xz / ${ICE_TILE.toFixed(1)}, m, g);
    im = mix(im, m, iceFine); iceG = g * iceFine;
  }
  iceHexM(vTW.xz / ${(ICE_TILE * 7.3).toFixed(1)} + 0.37, ib);
  vec3 n0 = normalize(vNormal);
  float up = normalize((vec4(n0, 0.0) * viewMatrix).xyz).y;          // (the normal back in world space)
  // snow: broad fields of it (the tile at the broad scale, the vertices' drift field) ragged at their edges by the
  // fine drifts; patches of it out on the bare ice. None down the rifts' walls; on the peaks, wherever it can lie
  float sf = vIce.x * 0.75 + ib.g * 0.4 + im.g * 0.35 - 0.38;
  float snow = smoothstep(0.4, 0.54, sf) * (1.0 - smoothstep(0.05, 0.25, vIce.z)) * smoothstep(0.72, 0.9, up);
  // off the shelf: floes ~60 m across (broken again into ~20 m pieces where it is most open), leads of open water
  // between them as wide as the map says; the thin new ice along their edges
  {
    vec2 fu = (vTW.xz - floeT.xy) * floeT.zw;
    if (fu.x > 0.0 && fu.y > 0.0 && fu.x < 1.0 && fu.y < 1.0) {
      vec2 fm = texture2D(floeMask, fu).rg;
      if (fm.x > 0.01) {
        vec2 q = vTW.xz / 62.0;
        float e = ihCell(q + 0.2 * vec2(sin(q.y * 1.7), sin(q.x * 1.3))), aw = fwidth(e) + 0.003, gw = 0.2 * fm.x * fm.x;
        iceWater = 1.0 - smoothstep(gw - aw, gw + aw, e);
        iceLead = (1.0 - smoothstep(gw, gw + 0.06, e)) * (1.0 - iceWater) * step(0.002, gw);
#ifndef ICE_LITE
        float e2 = ihCell(vTW.xz / 19.0 + 7.3), aw2 = fwidth(e2) + 0.003, g2 = 0.12 * smoothstep(0.6, 1.0, fm.x);
        iceWater = max(iceWater, (1.0 - smoothstep(g2 - aw2, g2 + aw2, e2)) * step(0.001, g2));
#endif
      }
      iceWater = max(iceWater, fm.y);
    }
  }
  snow *= 1.0 - max(iceWater, iceLead * 0.7);
  float rock = vIce.y * smoothstep(0.78, 0.55, up + (im.g - 0.5) * 0.2);
  snow = mix(snow, smoothstep(0.42, 0.62, up + (ib.g - 0.5) * 0.35), vIce.y);
  vec3 blackIce = vec3(0.004, 0.012, 0.022), milk = vec3(0.07, 0.17, 0.25);
  vec3 alb = mix(blackIce, milk, max(im.b, ib.b * 0.6) * 0.8);
  alb = mix(alb, vec3(0.012, 0.07, 0.13), smoothstep(0.1, 0.4, vIce.z));   // the rifts' walls: blue glacier ice
  alb = mix(alb, vec3(0.012, 0.016, 0.028) * (0.7 + 0.6 * im.b), rock);
  alb = mix(alb, vec3(0.6, 0.76, 1.0) * (0.9 + 0.1 * im.g) * (1.0 - 0.4 * vIce.y), snow);
  alb = mix(alb, vec3(0.0012, 0.0035, 0.007), iceWater);
  diffuseColor.rgb = alb;
  iceSnow = snow;
  // the seams: the big plates' (hundreds of metres, metres wide) and the fine ones
  iceCrack = (ib.r * (0.15 + 1.35 * smoothstep(0.55, 0.2, ib.b)) + im.r * 0.07) * (1.0 - snow) * (1.0 - vIce.y) * (1.0 - smoothstep(0.1, 0.4, vIce.z)) * (1.0 - iceWater);
  float iceRough = mix(mix(mix(mix(0.09, 0.28, im.b), 0.6, rock), 0.72, snow), 0.025, iceWater);
  iceG *= 1.0 - iceWater;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = iceRough;')
      // (the sun's own glint off the black ice held to a glow: on a mirror-smooth sheet a low sun's highlight filled a
      // quarter of the frame with bloom)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(2.2));')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    nw = normalize(nw - vec3(iceG.x, 0.0, iceG.y) * (0.6 + 0.6 * iceSnow));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // the seams: the sea's light through them, cyan, strongest at the cores; the rifts glow deeper down
  totalEmissiveRadiance += vec3(0.03, 0.55, 1.0) * iceCrack * 0.9 + vec3(0.0, 0.12, 0.3) * smoothstep(0.3, 1.0, vIce.z);
  // the open water lit from below, the edges of the floes brightest
  totalEmissiveRadiance += vec3(0.0, 0.03, 0.08) * iceWater * (0.5 + 0.8 * ib.b) + vec3(0.03, 0.5, 1.0) * iceLead * 0.4;
  {
    // what stands on the ice lights it: the crystals' colours pooled round their feet, stronger on snow
    vec2 gu = (vTW.xz - iceGlowT.xy) * iceGlowT.zw;
    if (gu.x > 0.0 && gu.y > 0.0 && gu.x < 1.0 && gu.y < 1.0) totalEmissiveRadiance += texture2D(iceGlow, gu).rgb * (0.35 + 0.9 * iceSnow + 0.6 * iceCrack);
  }
#ifndef ICE_LITE
  // glitter: a facet here and there in the snow catching the sun (near only: past ~10 cm a pixel it would shimmer)
  if (iceFp < 0.12 && iceSnow > 0.0) {
    vec3 gc = floor(vTW * 9.0);
    float gh = ihH3(gc);
    vec3 gn = normalize(vec3(ihH3(gc + 3.1) - 0.5, 1.3, ihH3(gc + 7.7) - 0.5));
    vec3 Hw = normalize(normalize(cameraPosition - vTW) + IA_SUN);
    float near = 1.0 - smoothstep(0.03, 0.12, iceFp);
    totalEmissiveRadiance += IA_SUNRAD * step(0.965, gh) * pow(max(dot(gn, Hw), 0.0), 600.0) * iceSnow * near * 6.0;
  }
#endif`);
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `ice-sheet-${Q.lite}`;
  return mat;
}
