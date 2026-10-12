// The track's structural steel - the deck's sides and underside, the walls, the girders and their cross-ribs, the gap
// caps: painted plates worked out per pixel in metres on each face, so they are sharp at any distance and fit every
// face exactly. ("this lower part of the road looks pretty bad and low res": one 512 px canvas of grey specks and
// grid lines was stretched over all of it - the 1.8 m deck side got 25 px of it.)
// Each face carries its own coordinates (hullUV: u metres across the face from one edge, v metres along), its width
// and kind (hullF), and the direction u runs in (hullT). Plates 3 m long in rows (one row on a narrow face, staggered
// 1.6 m rows on the underside) with bevelled seams, bolt rows along every edge, access hatches, louvred vents, darker
// grime in the seams and in fine streaks, chipped paint on edges and bolt heads showing bare steel; small lamps in
// the girders' bellies.
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const HULL_SIDE = 0, HULL_UNDER = 1, HULL_GIRDER = 2;

// tiling noise for the grime: R broad, G fine, B wear flecks, A streaks (fine across, long along y)
const NOISE = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vn(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), u.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), u.x), u.y);
  }
  float fbm(vec2 uv, vec2 per, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 7; i++) { if (i >= oct) break; s += a * vn(uv * per, per); n += a; per *= 2.0; a *= 0.5; }
    return s / n;
  }
  void main() {
    gl_FragColor = vec4(fbm(vUv, vec2(4.0), 6), fbm(vUv + 0.3, vec2(16.0), 5), fbm(vUv + 0.7, vec2(32.0), 5), fbm(vUv, vec2(96.0, 3.0), 4));
  }
`;

const U = { hullNoise: { value: null } };
export function hullMaps(renderer) {
  if (U.hullNoise.value) return U.hullNoise.value;
  const rt = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace });
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: NOISE }));
  bakeLater([quadJob(quad)], () => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); quad.render(renderer); renderer.setRenderTarget(prev);
    quad.material.dispose(); quad.dispose();
  });
  U.hullNoise.value = rt.texture;
  return rt.texture;
}

const LAYOUT = /* glsl */`
  uniform sampler2D hullNoise;
  varying vec2 vHullUV; varying vec2 vHullF; varying vec3 vHullT;
  float hHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  // where a point lies in the plate layout: x,y metres inside its plate (from the plate's corner), z,w the plate's
  // size; id the plate's identity
  struct HullCell { vec2 p; vec2 size; vec2 id; };
  HullCell hullCell(float u, float vl, float vi, float W, float kind) {
    HullCell c;
    bool under = kind > 0.5 && kind < 1.5;
    float rows = under ? max(1.0, floor(W / 2.8 + 0.5)) : 1.0;
    float rh = W / rows, row = clamp(floor(u / rh), 0.0, rows - 1.0);
    // plates 3 m long (6 m under the deck, its rows staggered by half a plate); vl: metres into a 12 m period, vi: its
    // index
    float pl = under ? 6.0 : 3.0, sh = mod(row, 2.0) * pl * 0.5, vv = vl + sh;
    float k = floor(vv / pl);
    c.p = vec2(u - row * rh, vv - k * pl);
    c.size = vec2(rh, pl);
    c.id = vec2(row, vi * 12.0 / pl + k);
    return c;
  }
  float hullBolt(vec2 q, float r) { float d = length(q); return d < r ? sqrt(1.0 - d * d / (r * r)) : 0.0; }
  // relief in mm: seams, bolts, hatches, vents. (fp: metres a pixel - detail smaller than that fades)
  float hullHeight(HullCell c, float fp, float kind, out float hatch, out float vent) {
    vec2 p = c.p, s = c.size;
    vec2 e = min(p, s - p);                                         // to the plate's edges
    float g = min(e.x, e.y);
    float w = 0.004 + fp;
    float h = -3.0 * (1.0 - smoothstep(w * 0.4, w * 1.6, g)) * min(1.0, 0.012 / (fp * 2.0 + 0.004));   // bevelled seam
    // under the deck the rows are framed by raised stiffener bars (12 cm wide) running along the track
    if (kind > 0.5 && kind < 1.5) {
      float bar = 1.0 - smoothstep(0.055, 0.065 + fp, e.x);
      h = mix(h, 6.0 - 3.0 * (1.0 - smoothstep(0.0, 0.01 + fp, e.x)), bar);
    }
    float rnd = hHash(c.id * vec2(1.7, 3.1) + 0.5);
    // bolt rows 45 mm in from every edge, every 25 cm (fade out once a bolt is under ~3 pixels)
    float bf = 1.0 - smoothstep(0.004, 0.009, fp);
    if (bf > 0.0) {
      float b = max(hullBolt(vec2(e.x - 0.045, (fract(p.y / 0.25 + 0.5) - 0.5) * 0.25), 0.011),
                    hullBolt(vec2(e.y - 0.045, (fract(p.x / 0.25 + 0.5) - 0.5) * 0.25), 0.011));
      h += 1.8 * b * bf;
    }
    // an access hatch on some plates: an inset cover with its own seam and four bolts
    hatch = 0.0; vent = 0.0;
    vec2 cen = p - s * 0.5;
    float hatchP = kind > 0.5 && kind < 1.5 ? 0.9 : 0.72, ventP = kind > 0.5 && kind < 1.5 ? 0.86 : 0.6;
    if (rnd > hatchP && s.x > 0.9) {
      vec2 hs = vec2(min(0.32, s.x * 0.28), 0.42);
      vec2 dq = abs(cen) - hs;
      float dh = max(dq.x, dq.y);
      hatch = 1.0 - smoothstep(-0.002, 0.002, dh);
      h -= 2.4 * (1.0 - smoothstep(w * 0.4, w * 1.6, abs(dh)));
      h -= 0.6 * hatch;
      if (bf > 0.0) h += 1.6 * bf * hullBolt(abs(cen) - (hs - 0.035), 0.009);
    } else if (rnd > ventP && s.x > 0.9) {
      // a louvred vent: slats every 4 cm across a recess
      vec2 vs = vec2(min(0.22, s.x * 0.2), 0.6);
      vec2 dq = abs(cen) - vs;
      float dv = max(dq.x, dq.y);
      vent = 1.0 - smoothstep(-0.002, 0.002, dv);
      float slat = fract(cen.y / 0.04);
      h += vent * (-4.0 + 3.0 * mix(slat, 0.5, smoothstep(0.003, 0.008, fp)));
      h -= 1.5 * (1.0 - smoothstep(w * 0.4, w * 1.6, abs(dv)));
    }
    // the girders' lamps: a lens in the belly every 12 m
    return h;
  }
`;

// opts.color: the paint (linear)
export function hullMaterial({ color = [0.12, 0.13, 0.145], key = 'hull' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 });
  mat.color.setRGB(...color);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.hullNoise = U.hullNoise;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 hullUV; attribute vec2 hullF; attribute vec3 hullT;
varying vec2 vHullUV; varying vec2 vHullF; varying vec3 vHullT;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vHullUV = hullUV; vHullF = hullF;
  {
    vec3 ht = hullT;
  #ifdef USE_INSTANCING
    ht = mat3(instanceMatrix) * ht;
  #endif
    vHullT = normalize((viewMatrix * vec4(mat3(modelMatrix) * ht, 0.0)).xyz);
  }`);
    sh.fragmentShader = (Q.lite ? '#define HULL_LITE\n' : '') + sh.fragmentShader.replace('#include <common>', '#include <common>\n' + LAYOUT)
      .replace('#include <map_fragment>', `#include <map_fragment>
  float hu = vHullUV.x, hW = vHullF.x, hK = vHullF.y;
  // v split into a 12 m period's index and the metres into it: v runs to 14 km and its float steps are ~2 mm there
  float hvi = floor(vHullUV.y / 12.0), hvl = vHullUV.y - hvi * 12.0;
  float hfp = max(length(vec2(dFdx(hu), dFdy(hu))), length(vec2(dFdx(hvl), dFdy(hvl))));
  HullCell hc = hullCell(hu, hvl, hvi, hW, hK);
  float hHatch, hVent;
  float hh = hullHeight(hc, hfp, hK, hHatch, hVent);
  // the relief's slope by finite differences (a step no smaller than the pixel), in mm per metre
#ifdef HULL_LITE
  vec2 hGrad = vec2(0.0);                                            // (Laptop mode: flat plates, the seams painted)
#else
  float he = max(0.0015, hfp * 0.75), hd1, hd2;
  float hx = hullHeight(hullCell(hu + he, hvl, hvi, hW, hK), hfp, hK, hd1, hd2);
  float hy = hullHeight(hullCell(hu, hvl + he, hvi, hW, hK), hfp, hK, hd1, hd2);
  vec2 hGrad = vec2(hx - hh, hy - hh) / he * 0.001;
#endif
  // grime and wear (noise in metres: broad 8 m, fine 2 m, flecks 1 m, streaks running across the face)
  vec2 hm = vec2(hvl + mod(hvi, 64.0) * 12.0, hu);                  // (wrapped at 768 m, a whole number of every tile)
  vec4 n1 = texture2D(hullNoise, hm / 8.0), n2 = texture2D(hullNoise, hm / 2.0 + 0.37), n3 = texture2D(hullNoise, hm / 1.0 + 0.71);
  float streak = texture2D(hullNoise, vec2(hm.x / 4.0, hm.y / 5.0)).a;
  float hRnd = hHash(hc.id * vec2(1.7, 3.1) + 0.5);
  vec2 he2 = min(hc.p, hc.size - hc.p);
  float seamDirt = 1.0 - smoothstep(0.004, 0.06, min(he2.x, he2.y));
  float grime = (0.8 + 0.4 * n1.r) * (0.9 + 0.2 * n2.g) * (1.0 - 0.25 * seamDirt) * (1.0 - 0.18 * smoothstep(0.55, 0.8, streak));
  vec3 paint = diffuseColor.rgb * (0.92 + 0.16 * hRnd) * grime;
  paint *= mix(1.0, 0.82, hHatch * step(0.86, hRnd));                // some hatches a replaced, darker panel
  paint *= mix(1.0, 0.35, hVent * step(hh, -1.5));                  // the vent's depths
  paint *= 1.0 - 0.45 * clamp(-hh / 3.0, 0.0, 1.0);                  // cavities: seams, recesses
  // chipped paint: only along plate edges and on bolt heads, in small flecks (all over, it read as camouflage)
  float edgeW = 1.0 - smoothstep(0.0, 0.035, min(he2.x, he2.y) - 0.004);
  float wear = smoothstep(0.8, 0.86, n3.b * 0.55 + 0.45 * max(edgeW, step(0.5, hh)) * (0.6 + 0.6 * n2.g)) * (1.0 - smoothstep(0.006, 0.02, hfp));
  diffuseColor.rgb = mix(paint, vec3(0.5, 0.5, 0.52) * (0.85 + 0.3 * n2.g), wear);
  float hullRough = mix(0.5 + 0.2 * n1.r + 0.2 * seamDirt, 0.38, wear);
  float hullMetal = mix(0.3, 0.8, wear);
  // lamps in the girders' bellies: a 0.8 m lens every 12 m, on the face's middle
  float lampV = abs(hvl - 6.0), lampU = abs(hu - hW * 0.5);
  float hLamp = hK > 1.5 ? (1.0 - smoothstep(0.38, 0.4, lampV)) * (1.0 - smoothstep(0.11, 0.13, lampU)) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), hLamp);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(hullRough, 0.2, hLamp);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = hullMetal * (1.0 - hLamp);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 tu = normalize(vHullT - normal * dot(vHullT, normal)), tv = cross(normal, tu);
    normal = normalize(normal - tu * hGrad.x - tv * hGrad.y);
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.55, 0.85, 1.6) * 2.2 * hLamp * (0.8 + 0.2 * smoothstep(0.38, 0.0, lampV));`);
  };
  mat.customProgramCacheKey = () => `feather-${key}-${Q.lite}`;
  return mat;
}

// hull coordinates for a box (any BoxGeometry, one segment a side): on each face u runs across its shorter side,
// v along its longer
export function hullBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
  const uv = new Float32Array(n * 2), f = new Float32Array(n * 2), t = new Float32Array(n * 3);
  const dims = { x: w, y: h, z: d }, axes = ['x', 'y', 'z'];
  for (let i = 0; i < n; i++) {
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const normalAxis = Math.abs(nx) > 0.5 ? 'x' : Math.abs(ny) > 0.5 ? 'y' : 'z';
    const [a, b] = axes.filter((k) => k !== normalAxis).sort((p, q) => dims[p] - dims[q]);   // a: shorter, b: longer
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    uv[i * 2] = p[a] + dims[a] / 2; uv[i * 2 + 1] = p[b] + dims[b] / 2;
    f[i * 2] = dims[a]; f[i * 2 + 1] = HULL_SIDE;
    t[i * 3 + axes.indexOf(a)] = 1;
  }
  g.setAttribute('hullUV', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('hullF', new THREE.BufferAttribute(f, 2));
  g.setAttribute('hullT', new THREE.BufferAttribute(t, 3));
  return g;
}
