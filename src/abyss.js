// The jungle far below the circuit: a canopy to the horizon, ~1.3 km down, rolling hills cut by rivers. One mesh on
// a polar grid round the circuit (fine under it, coarse far out); the crowns, their colours, the clearings and the
// rivers are drawn per pixel from world position (cellular noise: each cell a crown, lit as a dome).
import * as THREE from 'three';
import { fbm } from './noise.js';
import { CANOPY_Y, SUN_DIR } from './atmo.js';
import { Q } from './quality.js';
import { sunOnly } from './look.js';
import { bakeLater, quadJob } from './bake.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const R_MAX = 34000;

// the rivers: sinuous lines across the jungle, their distance at xz (m)
const RIVERS = [
  { z0: 2600, a: 520, l: 2300, p: 0.7, w: 46 }, { z0: -2400, a: 650, l: 2900, p: 2.1, w: 60 },
  { x0: 3600, a: 420, l: 2100, p: 4.0, w: 38 }, { x0: -3900, a: 600, l: 2600, p: 1.3, w: 52 },
];
const RIVER_GLSL = /* glsl */`
  float riverDist(vec2 p, out float w) {
    float d = 1e9; w = 40.0;
    ${RIVERS.map((r) => (r.z0 !== undefined
    ? `{ float c = ${r.z0.toFixed(1)} + ${r.a.toFixed(1)} * sin(p.x / ${r.l.toFixed(1)} + ${r.p.toFixed(3)}) + 160.0 * sin(p.x / 610.0 + ${(r.p * 3).toFixed(3)}) + 50.0 * sin(p.x / 170.0);
         float dd = abs(p.y - c) * 0.85; if (dd < d) { d = dd; w = ${r.w.toFixed(1)}; } }`
    : `{ float c = ${r.x0.toFixed(1)} + ${r.a.toFixed(1)} * sin(p.y / ${r.l.toFixed(1)} + ${r.p.toFixed(3)}) + 160.0 * sin(p.y / 590.0 + ${(r.p * 3).toFixed(3)}) + 50.0 * sin(p.y / 190.0);
         float dd = abs(p.x - c) * 0.85; if (dd < d) { d = dd; w = ${r.w.toFixed(1)}; } }`)).join('\n    ')}
    return d;
  }`;
// (the same in JS, for the heights: the rivers run in valleys)
function riverDist(x, z) {
  let d = 1e9, w = 40;
  for (const r of RIVERS) {
    const c = r.z0 !== undefined
      ? r.z0 + r.a * Math.sin(x / r.l + r.p) + 160 * Math.sin(x / 610 + r.p * 3) + 50 * Math.sin(x / 170)
      : r.x0 + r.a * Math.sin(z / r.l + r.p) + 160 * Math.sin(z / 590 + r.p * 3) + 50 * Math.sin(z / 190);
    const dd = Math.abs((r.z0 !== undefined ? z : x) - c) * 0.85;
    if (dd < d) { d = dd; w = r.w; }
  }
  return { d, w };
}

// rugged hills: broad swells, ridges (karst), smaller knolls - and the rivers in their valleys
export function groundHeight(x, z) {
  const ridge = 1 - Math.abs(2 * fbm(x * 0.0009 + 1.7, z * 0.0009 - 3.1, 4) - 1);
  const hills = (fbm(x * 0.00035 + 4.1, z * 0.00035 - 2.3, 5) - 0.45) * 420 + ridge * ridge * 260 + (fbm(x * 0.0022, z * 0.0022, 3) - 0.5) * 90;
  const { d, w } = riverDist(x, z);
  const valley = Math.exp(-((d / (w * 9)) ** 2));
  return CANOPY_Y + hills * (1 - 0.7 * valley) - 70 * valley;
}

export class Abyss {
  constructor(scene, renderer, track) {
    // the circuit's middle
    const c = new THREE.Vector3();
    for (const p of track.P) c.add(p);
    c.divideScalar(track.P.length);
    this.centre = c;
    const NA = 320, rings = [];
    for (let r = 0, dr = 14; r < R_MAX; r += dr, dr *= 1.035) rings.push(r);
    rings.push(R_MAX);
    const NR = rings.length, pos = new Float32Array((1 + (NR - 1) * NA) * 3);
    let k = 0;
    const put = (x, z) => { pos[k++] = x; pos[k++] = groundHeight(x, z); pos[k++] = z; };
    put(c.x, c.z);
    for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      put(c.x + Math.cos(a) * rings[i], c.z + Math.sin(a) * rings[i]);
    }
    const idx = [];
    for (let j = 0; j < NA; j++) idx.push(0, 1 + ((j + 1) % NA), 1 + j);
    for (let i = 1; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
      const a = 1 + (i - 1) * NA + j, b = 1 + (i - 1) * NA + ((j + 1) % NA), d = a + NA, e = b + NA;
      idx.push(a, b, d, b, e, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // The jungle's colour - stands of trees in patches, their clumping, the rivers and their sand - painted once at load
    // into a map 20 km across round the circuit (per pixel it was ~20 noise lookups over half the screen)
    const MAPS = 20000, mapRes = Q.tier === 'low' ? 2048 : 4096;
    const rt = new THREE.WebGLRenderTarget(mapRes, mapRes, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { org: { value: new THREE.Vector2(c.x, c.z) } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec2 org; varying vec2 vUv;
        float gH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float gN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
          return mix(mix(gH(i), gH(i + vec2(1, 0)), u.x), mix(gH(i + vec2(0, 1)), gH(i + vec2(1, 1)), u.x), u.y); }
        float gF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gN(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }
        ${RIVER_GLSL}
        void main() {
          vec2 gp = org + (vUv - 0.5) * ${MAPS.toFixed(1)};
          float gpx = ${(MAPS / 4096).toFixed(3)};
          float region = gF(gp / 900.0), region2 = gF(gp / 260.0 + 5.0), region3 = gF(gp / 95.0 + 9.0);
          vec3 g1 = vec3(0.04, 0.085, 0.02), g2 = vec3(0.15, 0.19, 0.04), g3 = vec3(0.04, 0.11, 0.07), g4 = vec3(0.13, 0.12, 0.05);
          vec3 alb = mix(g1, g2, smoothstep(0.3, 0.75, region));
          alb = mix(alb, g3, smoothstep(0.45, 0.75, region2) * 0.75);
          alb = mix(alb, g4, smoothstep(0.62, 0.8, region3) * 0.5);
          alb *= 0.8 + 0.4 * gF(gp / 38.0 + 3.0);
          float rw; float rd = riverDist(gp, rw);
          float water = 1.0 - smoothstep(rw * 0.5 - gpx, rw * 0.5 + gpx, rd);
          float bank = (1.0 - smoothstep(rw * 0.5, rw * 0.5 + 18.0, rd)) * (1.0 - water);
          alb = mix(alb, vec3(0.16, 0.13, 0.08), bank * 0.6);
          alb = mix(alb, vec3(0.012, 0.024, 0.022), water);
          gl_FragColor = vec4(alb * 4.0, water);
        }` }));
    for (let k = 0; k < 4; k++) {
      bakeLater(k ? [] : [quadJob(quad)], () => {
        const prev = renderer.getRenderTarget();
        rt.scissor.set(0, k * mapRes / 4, mapRes, mapRes / 4); rt.scissorTest = true;
        rt.texture.generateMipmaps = k === 3;
        renderer.setRenderTarget(rt); quad.render(renderer);
        rt.scissorTest = false;
        renderer.setRenderTarget(prev);
        if (k === 3) { quad.material.dispose(); quad.dispose(); }
      });
    }
    const jungleMap = { value: rt.texture };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    // (never in a cascade's box: the world's map alone, one soft tap)
    mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '', FOLIAGE_ONE_TAP: '' };
    const sxz = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize(), tanE = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const L = THREE.ShaderChunk.lights_fragment_begin, at = 'getDirectionalLightInfo( directionalLight, directLight );';
    if (!L.includes(at)) throw new Error('lights chunk changed: canopy shadow not applied');
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.jungleMap = jungleMap;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vGN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGW; varying vec3 vGN; uniform sampler2D jungleMap;
float gH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 gH2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float gN(vec2 p) { vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(gH(i), gH(i + vec2(1, 0)), u.x), mix(gH(i + vec2(0, 1)), gH(i + vec2(1, 1)), u.x), u.y); }
float gF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gN(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }
// One layer of crowns: a dome round each jittered point of a grid S metres apart (some cells empty), the highest dome
// over p wins - crowns overlap, crease where they meet and leave dark gaps. x: height (m), yz: its slope, w: the crown
const vec2 CANOPY_SUN = vec2(${sxz.x.toFixed(4)}, ${sxz.y.toFixed(4)});
vec4 crownLayer(vec2 p, float S, float salt, float fill, float lift) {
  vec2 q = p / S, i = floor(q), f = fract(q);
  float best = -1e4; vec2 g = vec2(0.0); float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)), c = i + o + salt;
    if (gH(c + 9.9) > fill) continue;
    vec2 d = (o + 0.15 + 0.7 * gH2(c) - f) * S;
    float R = S * (0.55 + 0.35 * gH(c + 1.3)), dd = dot(d, d);
    if (dd >= R * R) continue;
    float sq = sqrt(R * R - dd), h = lift + gH(c + 7.1) * S * 0.3 + sq * (0.6 + 0.4 * gN(p * 0.45 + c));
    if (h > best) { best = h; g = d / max(sq, 0.2 * R) * 0.8; id = gH(c + 3.7); }
  }
  return vec4(best, g, id);
}
// (fine: the smaller crowns too - only close enough for them to show)
vec4 canopyAt(vec2 p, bool fine) {
  p += vec2(gN(p * 0.21), gN(p * 0.21 + 5.3)) * 4.0 - 2.0;              // warped: irregular crowns
  vec4 a = crownLayer(p, 24.0, 0.0, 0.42, 9.0);
  if (!fine) return a.x > -100.0 ? vec4(a.x, a.yz, a.w + 2.0) : vec4(0.0, 0.0, 0.0, 0.5);       // (between: the mass of smaller crowns)
  vec4 b = crownLayer(p, 9.5, 31.0, 0.93, 0.0);
  return a.x > b.x ? vec4(a.x, a.yz, a.w + 2.0) : b;          // (w > 2: an emergent's crown)
}
${RIVER_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
  vec2 gp = vGW.xz;
  float gpx = length(fwidth(gp));                                        // metres a pixel
  float detail = 1.0 - smoothstep(1.0, 2.4, gpx);
  bool fine = gpx < 1.1;
  ${Q.lite ? 'detail = 0.0;                                         // (Laptop mode: the crowns as their average)' : ''}
  vec4 cn = vec4(0.0);
  float crownSun = 1.0, crownAO = 0.8;
  // the painted map (stands of trees, their clumping, rivers): out past its edge, its average under the haze
  vec2 ju = (gp - vec2(${c.x.toFixed(1)}, ${c.z.toFixed(1)})) / ${MAPS.toFixed(1)} + 0.5;
  vec4 jm = texture2D(jungleMap, ju);
  float inMap = step(max(abs(ju.x - 0.5), abs(ju.y - 0.5)), 0.499);
  vec3 alb = mix(vec3(0.075, 0.115, 0.035), jm.rgb * 0.25, inMap);
  float water = jm.a * inMap;
  // lighter on the ridges, darker in the hollows
  alb *= 0.75 + 0.5 * smoothstep(${(CANOPY_Y - 150).toFixed(1)}, ${(CANOPY_Y + 250).toFixed(1)}, vGW.y);
  if (detail > 0.0) {
    cn = canopyAt(gp, fine);
    // the sun's shadow from the crowns toward it (one step up the sun's ray)
    float occ = smoothstep(-1.5, 1.5, canopyAt(gp + CANOPY_SUN * 6.0, false).x - (cn.x + 6.0 * ${tanE.toFixed(4)})) * 1.4;
    crownSun = mix(1.0, 1.0 - 0.8 * min(occ, 1.0), detail);
    float covered = step(-100.0, cn.x);
    crownAO = mix(0.8, mix(0.25, 0.55 + 0.45 * smoothstep(2.0, 16.0, cn.x), covered), detail);
    // each crown its own shade, a leafy grain in it; now and then one in flower
    float id = fract(cn.w);
    vec3 own = mix(vec3(0.85, 0.92, 0.88), vec3(1.15, 1.1, 0.85), id) * (cn.w > 2.0 ? 1.1 : 1.0);
    float leaf = gN(gp * 0.9) * 0.6 + gN(gp * 2.3 + 4.0) * 0.4;
    own *= 0.78 + 0.44 * leaf;
    vec3 fl = id > 0.994 ? vec3(0.3, 0.08, 0.14) : id > 0.989 ? vec3(0.32, 0.16, 0.04) : id > 0.985 ? vec3(0.28, 0.25, 0.06)
      : id > 0.982 ? vec3(0.15, 0.08, 0.22) : vec3(-1.0);
    alb = mix(alb, alb * own, detail);
    if (fl.x > 0.0 && cn.x > -100.0) alb = mix(alb, fl * (0.7 + 0.5 * leaf), 0.6 * detail);
  }
  alb = mix(alb, vec3(0.012, 0.024, 0.022), water);
  crownSun = mix(crownSun, 1.0, water); crownAO = mix(crownAO, 1.0, water);
  diffuseColor.rgb = alb;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.9, 0.06, water);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // the hills' own slope, each crown a dome on it (flat over water), a leafy roughness on the crowns
    vec3 nw = normalize(vGN);
    vec2 t = -cn.yz * detail * (1.0 - water);
    vec2 lg = vec2(gN(gp * 1.7 + 0.5) - gN(gp * 1.7 - 0.5), gN(gp * 1.7 + vec2(3.0, 0.5)) - gN(gp * 1.7 + vec2(3.0, -0.5))) * 0.9 * detail;
    nw = normalize(nw + vec3(t.x + lg.x, 0.0, t.y + lg.y));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`)
        .replace('#include <lights_fragment_begin>', L.replace(at, `${at}\n\t\t#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= crownSun;\n\t\t#endif`))
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= crownAO;
  reflectedLight.directDiffuse *= 0.6 + 0.4 * crownAO;`);
      sh.fragmentShader = sunOnly(sh.fragmentShader);
    };
    mat.customProgramCacheKey = () => `forest-abyss-${Q.lite}`;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(3);                                       // (always beyond the near depth slice)
    scene.add(this.mesh);
  }

  update() {}
}
