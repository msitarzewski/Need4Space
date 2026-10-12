// The desert's rock: layered sandstone - beds of deep red, orange, cream and a purple shale now and then, each its own
// thickness, hard caprocks standing out as ledges, fine laminations, dark streaks of desert varnish down the cliffs and
// sand lying wherever a face looks up. Drawn from world position (the bands run level across every mesa, butte, arch
// and canyon wall alike); lit by the sun and the sky alone (look.js sunOnly) and the world's shadow map.
// The shapes: mesas and buttes (a wobbly outline with bays, a caprock's cliff, a bench where a softer bed wore back,
// the main cliff fluted by erosion, a talus skirt sunk into the dunes), natural arches and bridges (a tube swept along an arc).
import * as THREE from 'three';
import { Q } from './quality.js';
import { sunOnly } from './look.js';
import { fbm, noise2, mulberry32, smoothstep } from './noise.js';
import { noise3, fbm3 } from './spires.js';

const TAU = Math.PI * 2;

// the beds, from a point's height (warped by drift, per vertex) - shared with the canyon walls in the dunes' material
export const STRATA_GLSL = /* glsl */`
float ssH1(float n) { return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
float ssH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ssN3(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(ssH3(i), ssH3(i + vec3(1, 0, 0)), u.x), mix(ssH3(i + vec3(0, 1, 0)), ssH3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(ssH3(i + vec3(0, 0, 1)), ssH3(i + vec3(1, 0, 1)), u.x), mix(ssH3(i + vec3(0, 1, 1)), ssH3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
// albedo of the bed at height y; lip: 1 at a bed's hard top edge (a ledge), groove: the profile's slope (for relief)
vec3 ssStrata(float y, out float lip, out float groove) {
  float b = y / 7.5, id = floor(b), fb = fract(b);
  float r = ssH1(id), r2 = ssH1(id + 31.0);
  // thick beds and thin: a bed splits in two now and then
  if (r2 > 0.62) { fb = fract(fb * 2.0); id += 0.5 * step(0.5, fract(b)); r = ssH1(id * 3.7); }
  vec3 c = r < 0.32 ? vec3(0.42, 0.12, 0.05) : r < 0.62 ? vec3(0.55, 0.22, 0.085) : r < 0.8 ? vec3(0.6, 0.33, 0.16)
    : r < 0.91 ? vec3(0.64, 0.43, 0.26) : vec3(0.3, 0.11, 0.09);
  c *= 0.9 + 0.1 * sin(y * 5.3 + r2 * 6.0);                 // laminations
  lip = smoothstep(0.72, 0.97, fb) * step(0.4, r2);          // the harder beds' tops stand out
  groove = (smoothstep(0.72, 0.97, fb) - smoothstep(0.0, 0.08, fb)) * step(0.4, r2);
  return c;
}`;

// The sandstone material: per vertex 'talus' (0 bare cliff .. 1 the sand-covered skirt) when the geometry has it
export function sandstoneMaterial({ key = 'sandstone', side = THREE.FrontSide, varnish = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side });
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  mat.onBeforeCompile = (sh) => {
    const lite = Q.lite ? '#define SS_LITE\n' : '';
    sh.vertexShader = lite + sh.vertexShader.replace('#include <common>', `#include <common>
attribute float talus; varying float vTalus; varying vec3 vSW; varying vec3 vSN; varying vec2 vSD;
${STRATA_GLSL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
  #endif
    vSW = (modelMatrix * tw).xyz; vSN = normalize(mat3(modelMatrix) * tn);
    vTalus = talus;
    // (the beds' warp and the varnish's patches vary over tens of metres: per vertex)
    vSD = vec2(ssN3(vSW * 0.006) * 22.0 + ssN3(vSW * 0.03) * 4.0, ssN3(vSW * 0.02 + 3.0));
  }`);
    sh.fragmentShader = lite + sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vTalus; varying vec3 vSW; varying vec3 vSN; varying vec2 vSD;
${STRATA_GLSL}
float ssSand = 0.0, ssGroove = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 sn = normalize(vSN);
  float lip, groove;
  vec3 alb = ssStrata(vSW.y + vSD.x, lip, groove);
  ssGroove = groove;
  // desert varnish: dark streaks down the cliffs from the ledges
  float vn = ssN3(vec3(vSW.x * 0.11, vSW.y * 0.008, vSW.z * 0.11)) * 0.7 + ssN3(vec3(vSW.x * 0.33, vSW.y * 0.02, vSW.z * 0.33)) * 0.3;
  float varn = smoothstep(0.55, 0.8, vn) * smoothstep(0.4, 0.75, vSD.y) * (1.0 - smoothstep(0.3, 0.7, sn.y)) * ${varnish.toFixed(2)};
  alb *= 1.0 - 0.55 * varn;
  alb *= 1.0 + 0.25 * lip;
  // sand: on whatever looks up (the tops, the ledges), and the talus skirt
  float up = sn.y + (ssN3(vSW * 0.09) - 0.5) * 0.35;
  ssSand = max(smoothstep(0.62, 0.85, up), smoothstep(0.35, 0.8, vTalus + (ssN3(vSW * 0.05) - 0.5) * 0.4));
  vec3 sandC = vec3(0.5, 0.29, 0.14) * (0.9 + 0.2 * ssN3(vSW * 0.13));
  diffuseColor.rgb = mix(alb, sandC, ssSand);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.86, 0.95, ssSand);')
      // (the light the sunlit sand and rock round it throw back: warm, into the shade too)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.08, 0.035, 0.014);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifndef SS_LITE
  {
    // the ledges as grooves across the faces, and a rough grain (the noise's slope)
    vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float e = 0.5, n0 = ssN3(vSW * 0.6);
    vec3 g = vec3(ssN3((vSW + vec3(e, 0.0, 0.0)) * 0.6) - n0, ssN3((vSW + vec3(0.0, e, 0.0)) * 0.6) - n0, ssN3((vSW + vec3(0.0, 0.0, e)) * 0.6) - n0) / e;
    g.y -= ssGroove * 2.2;
    nw = normalize(nw - (g - nw * dot(g, nw)) * 0.55 * (1.0 - ssSand));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
#endif`);
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `desert-${key}-${varnish}-${Q.lite}`;
  return mat;
}

// ---------------------------------------------------------------- mesas and buttes
// M: { x, z, r (mean radius at the top), h (top over the ground), ground (the sand's height there), seed, far }
// the caprock's cliff, a bench, the main cliff (fluted), a talus slope sunk into the sand
export function mesaGeometry(M) {
  const rnd = mulberry32(M.seed), far = !!M.far;
  const NU = far ? 72 : M.r > 200 ? 200 : 144;
  const s1 = rnd() * 40, s2 = rnd() * 40;
  const R = new Float32Array(NU);
  for (let j = 0; j < NU; j++) {
    const th = (j / NU) * TAU, c = Math.cos(th), s = Math.sin(th);
    // bays and headlands (an abs() of the noise: bays bite in sharply)
    R[j] = 1 + 0.62 * (fbm(c * 1.1 + s1, s * 1.1 + s2, 4) - 0.5) - 0.5 * Math.abs(fbm(c * 3.2 + s2, s * 3.2 - s1, 3) - 0.5);
  }
  // long and narrow or round, turned any way
  const ax = 1, az = M.aspect ?? 0.55 + 0.45 * rnd(), rot = rnd() * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
  // the profile down from the top: [height fraction, radius factor, talus]. The caprock's cliff, a narrow bench where
  // a softer bed has worn back (sand on it), the main cliff, then the talus slope (~35 deg) into the sand
  const prof = [], bench = 0.62 + 0.15 * rnd(), foot = 0.2 + 0.1 * rnd(), talusOut = Math.min(0.9, 0.42 * M.h / M.r);
  prof.push([1, 0.0, 1], [1, 0.45, 1], [1, 0.82, 1], [0.997, 0.97, 0.6], [0.99, 1.0, 0]);
  const cliff = (y0, y1, r0, r1) => {
    const rows = far ? 3 : Math.max(3, Math.round((y0 - y1) * M.h / 8));
    for (let i = 1; i <= rows; i++) { const t = i / rows; prof.push([y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, 0]); }
  };
  cliff(0.99, bench, 1.0, 1.01);
  prof.push([bench - 0.006, 1.035, 0.7], [bench - 0.014, 1.045, 0.2]);
  cliff(bench - 0.014, foot, 1.045, 1.06);
  // the talus: from the cliff's foot out and down into the sand
  const tr = far ? 3 : 7;
  for (let i = 1; i <= tr; i++) { const t = i / tr; prof.push([foot * (1 - t) - 0.15 * t * t, 1.06 + talusOut * Math.pow(t, 0.85), Math.min(1, 0.35 + t)]); }
  const nv = prof.length * NU, pos = new Float32Array(nv * 3), tal = new Float32Array(nv), idx = [];
  const amp = M.r * (far ? 0.05 : 0.07);
  for (let i = 0; i < prof.length; i++) {
    const [fy, fr, ta] = prof[i], y = M.ground + M.h * fy - (fy < 0 ? 30 : 0);
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, c = Math.cos(th), s = Math.sin(th);
      let rr = M.r * R[j] * fr;
      // fluted cliffs: gullies down them (a noise stretched up the face), the caprock's edge crumbled
      if (fr > 0.9 && ta < 0.75) {
        const px = M.x + c * rr, pz = M.z + s * rr;
        rr += amp * ((fbm3(px / 22, y / 70, pz / 22, far ? 2 : 3) - 0.5) * 2.4 + 0.45 * (noise3(px / 6, y / 24, pz / 6) - 0.5));
      }
      const lx = c * rr * ax, lz = s * rr * az, k = i * NU + j;
      pos[k * 3] = M.x + lx * cr - lz * sr; pos[k * 3 + 1] = y; pos[k * 3 + 2] = M.z + lx * sr + lz * cr;
      tal[k] = ta;
    }
  }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < NU; j++) {
    const a = i * NU + j, b = i * NU + (j + 1) % NU, c = a + NU, d = b + NU;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('talus', new THREE.BufferAttribute(tal, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward: a vertex on the cliff must face away from the middle
  const k0 = 8 * NU, n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, k0), p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, k0);
  if (n.x * (p.x - M.x) + n.z * (p.z - M.z) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  return g;
}

// A natural arch or bridge: a tube of rock swept along points (world), its radius per point, wind-carved (3-D noise);
// 'talus' 0 (bare rock; its top takes sand where it looks up)
export function archGeometry(pts, radii, { nr = 36, carve = 0.3, scale = 0.03, seed = 1 } = {}) {
  const pos = [], tal = [], idx = [], n = pts.length;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  let prevN = null;
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    if (!prevN) N.crossVectors(T, up).normalize(); else N.copy(prevN).addScaledVector(T, -prevN.dot(T)).normalize();
    prevN = N.clone();
    B.crossVectors(T, N).normalize();
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      p.copy(pts[i]).addScaledVector(N, ca * radii[i]).addScaledVector(B, sa * radii[i]);
      // flatter on top and below (a bridge of bedded rock), carved
      const d = 1 + carve * (fbm3(p.x * scale + seed, p.y * scale * 2.2, p.z * scale - seed, 4) - 0.5) * 2;
      const flat = 1 - 0.18 * Math.abs(B.y * sa + N.y * ca);
      p.copy(pts[i]).addScaledVector(N, ca * radii[i] * d).addScaledVector(B, sa * radii[i] * d * flat);
      pos.push(p.x, p.y, p.z);
      tal.push(0);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + (j + 1) % nr, c = a + nr, d = b + nr;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('talus', new THREE.Float32BufferAttribute(tal, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward
  const m = Math.floor(n / 2) * nr, vn = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, m), vp = new THREE.Vector3().fromBufferAttribute(g.attributes.position, m);
  if (vn.dot(vp.sub(pts[Math.floor(n / 2)])) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  return g;
}

export { noise2, smoothstep };
