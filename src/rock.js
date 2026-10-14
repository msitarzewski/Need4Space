// Rock for every asteroid, the meteorite and its boulders. A rock surface is painted once on the GPU into one tile -
// relief (craters of every size, lumps, ridges, sparse fractures, grit) as a normal map with its height, and a gentle
// albedo variation with the roughness - then projected onto any rock from the three world axes at three scales
// (~5x, 1x and ~1/6 of the "big" tile) and HEX-TILED: each projection is three randomly rotated and shifted copies of
// the tile blended over a hex grid by their heights (Mikkelsen 2022), so the tile never repeats. ("you see those dots
// that repeat themselves? ... it looks fake": one 60 m tile laid in a grid showed its dark blotches and pits as rows
// of dots. Real asteroids are near-uniform grey: the detail is relief and shadow, not paint.)
// The meteorite also gets the sun's shadow baked once from the sun (bakeRockShadow): crater rims and boulders throw
// real shadows at any distance; and an ambient occlusion per vertex (crater floors, boulder feet).
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { cachedBake } from './bakedtextures.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const GEN = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  float vn(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float fbm(vec2 p, float per, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vn(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; } return s / n; }
  vec3 cell(vec2 p, float per) {
    vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0, id = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), c = mod(i + o, per), r = o + 0.1 + 0.8 * h22(c) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h12(c + 5.7); } else if (d < d2) d2 = d;
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
  // craters where a cell's dice say so, each its own size (mostly small): a parabolic bowl ~0.2 of its diameter deep,
  // a raised rim, a skirt of ejecta. x: height (tile units), y: brightness (a few fresh ones, their floors and halo)
  vec2 craters(vec2 uv, float per, float dens, float salt) {
    vec2 p = uv * per, i = floor(p), f = fract(p);
    float h = 0.0, b = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), c = mod(i + o, per);
      // regions: heavily cratered ground next to smooth, sparse ground (an even spread read as polka dots)
      float region = smoothstep(0.3, 0.72, fbm((c + 0.5) / per * 2.0 + salt * 0.37, 2.0, 3));
      if (h12(c + salt) > dens * (0.15 + 1.25 * region)) continue;
      float R = 0.1 + 0.4 * pow(h12(c + salt + 3.1), 2.5);
      vec2 d = o + 0.15 + 0.7 * h22(c * 1.3 + salt) - f;
      float r = length(d) / R;
      if (r > 2.4) continue;
      float D = 2.0 * R / per;
      float bowl = r < 1.0 ? r * r - 1.0 : 0.0;
      float rim = exp(-pow((r - 1.0) / 0.2, 2.0));
      float skirt = r > 1.0 ? exp(-(r - 1.0) * 2.2) : 0.0;
      h += (0.2 * bowl + 0.045 * rim + 0.012 * skirt) * D;
      float fresh = step(0.82, h12(c + salt + 9.2));
      b += fresh * (r < 1.0 ? 0.22 : 0.12 * exp(-(r - 1.0) * 1.5));
    }
    return vec2(h, b);
  }
  // fractures: here and there only, each its own width
  float cracks(vec2 uv) {
    vec2 wp = 0.7 * vec2(fbm(uv * 5.0, 5.0, 3), fbm(uv * 5.0 + 9.0, 5.0, 3));
    vec3 a = cell(uv * 6.0 + wp, 6.0);
    float maskA = smoothstep(0.6, 0.7, fbm(uv * 3.0 + 7.0, 3.0, 4)) * step(0.55, a.z);
    float wA = 0.015 + 0.04 * fbm(uv * 20.0, 20.0, 2);
    // (only the short network: the long tile-wide cracks read as hairlines scratched across the rock)
    return (1.0 - smoothstep(0.0, wA, a.y - a.x)) * maskA;
  }
  vec2 craterSum(vec2 uv) {
    return craters(uv, 3.0, 0.5, 1.0) + craters(uv, 7.0, 0.5, 2.0) + craters(uv, 17.0, 0.55, 3.0) + craters(uv, 41.0, 0.6, 4.0);
  }
  // height (tile units: slopes are true slopes)
  float height(vec2 uv) {
    float lumps = (fbm(uv * 3.0, 3.0, 6) - 0.5) * 0.035;
    float rg = 1.0 - abs(2.0 * fbm(uv * 5.0 + 2.0, 5.0, 4) - 1.0);
    vec3 gr = cell(uv * 260.0, 260.0);
    float grit = pow(max(0.0, 1.0 - gr.x / 0.7), 2.0) * 0.0005 * (0.5 + gr.z);
    return lumps + rg * rg * 0.009 + craterSum(uv).x - cracks(uv) * 0.0015 + grit + (fbm(uv * 150.0, 150.0, 3) - 0.5) * 0.0012;
  }
  void main() {
    vec2 uv = vUv;
    #if BAKE_MODE == 1                                                // normal from the relief, height in alpha
      float e = 1.0 / 2048.0;
      float dx = (height(uv + vec2(e, 0.0)) - height(uv - vec2(e, 0.0))) / (2.0 * e);
      float dy = (height(uv + vec2(0.0, e)) - height(uv - vec2(0.0, e))) / (2.0 * e);
      gl_FragColor = vec4(normalize(vec3(-dx, -dy, 1.0)) * 0.5 + 0.5, clamp(0.5 + height(uv) * 9.0, 0.0, 1.0));
    #else
    // albedo VARIATION round 1 (stored halved): gentle, no blotches - weathered vs fresher patches, darker fractures,
    // a few bright young craters, mineral flecks
    float cr = cracks(uv);
    vec2 cs = craterSum(uv);
    float v = (0.9 + 0.2 * fbm(uv * 2.0 + 4.0, 2.0, 5)) * (0.95 + 0.1 * fbm(uv * 13.0 + 3.0, 13.0, 4));
    v *= mix(1.0, 0.88, cr);
    v *= 1.0 + cs.y;
    v *= 1.0 + 0.6 * step(0.993, h12(floor(uv * 1024.0)));
    vec3 tint = mix(vec3(1.0), vec3(1.05, 0.99, 0.93), smoothstep(0.35, 0.7, fbm(uv * 2.0 + 13.0, 2.0, 4)));
    float rough = 0.86 + 0.08 * cr - 0.06 * fbm(uv * 9.0 + 1.0, 9.0, 3);
    gl_FragColor = vec4(clamp(v * tint * 0.5, 0.0, 1.0), rough);
    #endif
  }
`;

// the maps (and the meteorite's shadow), shared: materials made before the bakes take them as soon as they are done
const U = {
  rockCol: { value: null }, rockNrm: { value: null },
  rkSh: { value: null }, rkShM: { value: new THREE.Matrix4() }, rkShP: { value: new THREE.Vector4(0, 0.6, 0, 0.0008) },
};
let maps = null;
export function rockMaps(renderer) {
  if (maps) return maps;
  const bake = (mode) => {
    const S = Q.tier === 'low' ? 1024 : 2048;                     // (a phone: 1024)
    const cached = cachedBake(renderer, `rock-${mode ? 'normal' : 'albedo'}`, S, renderer.capabilities.getMaxAnisotropy());
    if (cached) return cached;
    const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({ defines: { BAKE_MODE: mode },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: GEN }));
    // in four strips, each a bake of its own (the colour pass is ~50 ms in one go on a fast GPU; mips after the last)
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
  maps = { color: bake(0), normal: bake(1) };
  U.rockCol.value = maps.color; U.rockNrm.value = maps.normal;
  return maps;
}

// The sun's shadow of the given (static) meshes, rendered once into a depth map from the sun - an orthographic box
// round them all. Materials made with { shadow: true } read it.
export function bakeRockShadow(renderer, meshes, sunDir, res = Q.tier === 'low' ? 2048 : 4096) {
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const sph = box.getBoundingSphere(new THREE.Sphere()), R = sph.radius;
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 1, 2 * R + 20);
  cam.position.copy(sph.center).addScaledVector(sunDir, R + 10);
  cam.lookAt(sph.center);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(res, res, { depthTexture: new THREE.DepthTexture(res, res), depthBuffer: true });
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const m of meshes) {
    const c = m.isInstancedMesh ? new THREE.InstancedMesh(m.geometry, mat, m.count) : new THREE.Mesh(m.geometry, mat);
    if (m.isInstancedMesh) c.instanceMatrix = m.instanceMatrix;
    c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.frustumCulled = false;
    scene.add(c);
  }
  bakeLater([[scene, cam]], () => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    mat.dispose();
  });
  U.rkSh.value = rt.depthTexture;
  U.rkShM.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  // (x: the filter's radius in uv, 1.5 texels; y: normal offset in m; z: on; w: depth bias, 0.4 m of the box's depth)
  U.rkShP.value.set(1.5 / res, Math.max(0.3, (2 * R / res) * 3), 1, 0.4 / (2 * R + 19));
  return rt;
}

// a MeshStandardMaterial with the rock projected from the world axes. vertexColors: a tint round 1 per vertex.
// ao: the geometry carries a 'rockAO' attribute (ambient light only); shadow: reads the baked sun shadow.
export function rockMaterial({ big = 45, small = 7, macro = big * 5.3, albedo = [0.07, 0.064, 0.058], vertexColors = true,
  side = THREE.FrontSide, key = 'rock', ao = false, shadow = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors, roughness: 1.0, metalness: 0.0, side });
  mat.color.setRGB(...albedo);
  const f = (x) => x.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { rockCol: U.rockCol, rockNrm: U.rockNrm });
    if (shadow) Object.assign(sh.uniforms, { rkSh: U.rkSh, rkShM: U.rkShM, rkShP: U.rkShP });
    const defs = (ao ? '#define ROCK_AO\n' : '') + (shadow ? '#define ROCK_SHADOW\n' : '') + (Q.lite ? '#define ROCK_LITE\n' : '');
    sh.vertexShader = defs + sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTpW; varying vec3 vTpN;
#ifdef ROCK_AO
attribute float rockAO; varying float vRockAO;
#endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
  #endif
    vTpW = (modelMatrix * tw).xyz; vTpN = normalize(mat3(modelMatrix) * tn);
  #ifdef ROCK_AO
    vRockAO = rockAO;
  #endif
  }`);
    sh.fragmentShader = defs + sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D rockCol, rockNrm; varying vec3 vTpW; varying vec3 vTpN;
#ifdef ROCK_AO
varying float vRockAO;
#endif
vec2 rkHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// one copy of the tile for hex vertex v: rotated and shifted at random; colour, and the relief's slope turned back
void rkTap(vec2 v, vec2 uv, vec2 gx, vec2 gy, out vec4 c, out vec2 g, out float h) {
  vec2 r = rkHash(v + 0.37);
  float a = r.x * 6.2831853, ca = cos(a), sa = sin(a);
  mat2 R = mat2(ca, sa, -sa, ca);
  vec2 u2 = R * uv + rkHash(v * 1.71 + 5.3) * 7.0;
  c = textureGrad(rockCol, u2, R * gx, R * gy);
  vec4 n = textureGrad(rockNrm, u2, R * gx, R * gy);
  vec3 nn = n.xyz * 2.0 - 1.0;
  g = transpose(R) * (-nn.xy / max(nn.z, 0.25));
  h = n.a;
}
// hex-tiled sample of the tile at uv (tile units): albedo variation + roughness, and the relief's slope
void rkHex(vec2 uv, out vec4 col, out vec2 slope) {
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec2 st = uv * 2.4;
  vec2 sk = vec2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
  vec2 b = floor(sk);
  vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  vec4 c0, c1, c2; vec2 g0, g1, g2; float h0, h1, h2;
  rkTap(b + vec2(s), uv, gx, gy, c0, g0, h0);
  rkTap(b + vec2(s, 1.0 - s), uv, gx, gy, c1, g1, h1);
  rkTap(b + vec2(1.0 - s, s), uv, gx, gy, c2, g2, h2);
  vec3 W = pow(max(w, 0.0), vec3(5.0)) * pow(vec3(0.15) + vec3(h0, h1, h2), vec3(3.0));
  W /= W.x + W.y + W.z;
  col = c0 * W.x + c1 * W.y + c2 * W.z;
  slope = g0 * W.x + g1 * W.y + g2 * W.z;
}
// one projection (p: 2-D coordinates in metres) at the three scales
void rkProj(vec2 p, float fs, out vec4 col, out vec2 slope) {
#ifdef ROCK_LITE
  // (Laptop mode: the middle scale alone)
  vec4 cb; vec2 gb;
  rkHex(p / ${f(big)}, cb, gb);
  col = vec4(cb.rgb * 2.0, cb.a); slope = gb;
#else
  vec4 cm, cb, cs = vec4(0.5); vec2 gm, gb, gs = vec2(0.0);
  rkHex(p / ${f(macro)}, cm, gm);
  rkHex(p / ${f(big)}, cb, gb);
  if (fs > 0.01) rkHex(p / ${f(small)}, cs, gs);
  col = vec4(sqrt(cm.rgb * 2.0) * cb.rgb * 2.0 * mix(vec3(1.0), cs.rgb * 2.0, 0.6 * fs), mix(cb.a, cs.a, 0.5 * fs));
  slope = gm * 0.8 + gb + gs * fs;
#endif
}
float rkN3(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  vec2 o = vec2(0.0, 1.0);
  #define RH(q) fract(sin(dot(q, vec3(127.1, 311.7, 74.7))) * 43758.5453)
  return mix(mix(mix(RH(i), RH(i + o.yxx), u.x), mix(RH(i + o.xyx), RH(i + o.yyx), u.x), u.y),
             mix(mix(RH(i + o.xxy), RH(i + o.yxy), u.x), mix(RH(i + o.xyy), RH(i + o.yyy), u.x), u.y), u.z);
}
#ifdef ROCK_SHADOW
uniform sampler2D rkSh; uniform mat4 rkShM; uniform vec4 rkShP;
float rkShadow() {
  if (rkShP.z < 0.5) return 1.0;
  vec3 sc = (rkShM * vec4(vTpW + normalize(vTpN) * rkShP.y, 1.0)).xyz * 0.5 + 0.5;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float lit = 0.0, rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
#ifdef ROCK_LITE
  const int RK_TAPS = 4;
#else
  const int RK_TAPS = 12;
#endif
  for (int i = 0; i < RK_TAPS; i++) {
    float r = sqrt((float(i) + 0.5) / float(RK_TAPS)), a = float(i) * 2.39996323 + rot;
    lit += step(sc.z - rkShP.w, texture2D(rkSh, sc.xy + r * vec2(cos(a), sin(a)) * rkShP.x).x);
  }
  return lit / float(RK_TAPS);
}
#endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 n0 = normalize(vTpN);
  vec3 tpw = pow(abs(n0), vec3(6.0));
  tpw = max(tpw / (tpw.x + tpw.y + tpw.z) - 0.04, 0.0);
  tpw /= tpw.x + tpw.y + tpw.z;
  // the small scale only where its texels can show (metres a pixel against its tile)
  float rkFs = 1.0 - smoothstep(${f(small / 240)}, ${f(small / 50)}, length(fwidth(vTpW)));
  vec4 rkC = vec4(0.0); vec3 rkTX = vec3(0.0, 0.0, 1.0), rkTY = rkTX, rkTZ = rkTX;
  if (tpw.x > 0.0) { vec4 c; vec2 g; rkProj(vTpW.zy, rkFs, c, g); rkC += c * tpw.x; rkTX = vec3(-g, 1.0); }
  if (tpw.y > 0.0) { vec4 c; vec2 g; rkProj(vTpW.xz, rkFs, c, g); rkC += c * tpw.y; rkTY = vec3(-g, 1.0); }
  if (tpw.z > 0.0) { vec4 c; vec2 g; rkProj(vTpW.xy, rkFs, c, g); rkC += c * tpw.z; rkTZ = vec3(-g, 1.0); }
  // and a broad drift that repeats nowhere: weathered and fresher regions
  float rkDrift = 0.86 + 0.28 * (rkN3(vTpW / 160.0) * 0.6 + rkN3(vTpW / 55.0 + 7.0) * 0.4);
  diffuseColor.rgb *= rkC.rgb * rkDrift;
  float rockRough = rkC.a;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = rockRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // whiteout blend of each projection's slope onto the surface's own normal
    vec3 tx = vec3(normalize(rkTX).xy + n0.zy, abs(normalize(rkTX).z) * n0.x);
    vec3 ty = vec3(normalize(rkTY).xy + n0.xz, abs(normalize(rkTY).z) * n0.y);
    vec3 tz = vec3(normalize(rkTZ).xy + n0.xy, abs(normalize(rkTZ).z) * n0.z);
    vec3 nw = normalize(tx.zyx * tpw.x + ty.xzy * tpw.y + tz.xyz * tpw.z);
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz) * (gl_FrontFacing ? 1.0 : -1.0);
  }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
#ifdef ROCK_AO
  reflectedLight.indirectDiffuse *= vRockAO;
  reflectedLight.indirectSpecular *= vRockAO;
#endif`);
    if (shadow) {
      const L = THREE.ShaderChunk.lights_fragment_begin, at = 'getDirectionalLightInfo( directionalLight, directLight );';
      if (!L.includes(at)) throw new Error('lights chunk changed: rock shadow not applied');
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>',
        L.replace(at, `${at}\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= rkShadow();\n\t\t#endif`));
    }
  };
  mat.customProgramCacheKey = () => `feather-${key}-${big}-${small}-${macro}-${ao}-${shadow}-${Q.lite}`;
  return mat;
}
