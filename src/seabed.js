// Life round the underwater track, so being under the sea feels like it: everything here worked out on the GPU from a
// few numbers written once (where, how big, its phase) and the clock.
//  - pinnacles: spires of rock rising out of the abyss beside the way (60-200 m off it), their tops near the deck's
//    height, crusted with weed; glowing anemones on their tops
//  - kelp: tall swaying fronds on the pinnacles, round the Keeper's feet and on the floor wherever it comes near the way;
//    weed hanging off the track's own edges, trailing in the current
//  - sea grass: tufts in meadows on the pinnacles' tops and the floor near the way
//  - vents: streams of bubbles rising slowly out of the rock and the floor, many of them up past the deck
//  - shoals: thousands of fish in schools all along the way under the sea, circling - and scattering from a ship
//    that comes through them
import * as THREE from 'three';
import { mulberry32, fbm } from './noise.js';
import { TRACK_W } from './track.js';
import { SEA_Y, SEA_GLSL } from './sea.js';
import { LIFE_U, fishGeometry } from './sealife.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2, V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- shapes
// a frond: two crossed ribbons, 12 segments up, narrowing, with leaf-like bulges; 'along' 0 at the holdfast .. 1 the tip
function frondGeometry(n = 12) {
  const pos = [], along = [], idx = [];
  for (const rot of [0, Math.PI / 2]) {
    const base = pos.length / 3, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = i / n, w = 0.5 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08))) * (1 + 0.35 * Math.sin(t * 19));
      for (const sd of [-1, 1]) { pos.push(c * sd * w, t, s * sd * w); along.push(t); }
    }
    for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// a tuft of grass: five blades fanned round, each two segments
function tuftGeometry() {
  const pos = [], along = [], idx = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3, lean = 0.25 + 0.1 * (k % 2), base = pos.length / 3, c = Math.cos(a), s = Math.sin(a);
    for (const [t, w] of [[0, 0.06], [0.55, 0.045], [1, 0.0]]) {
      const ox = c * lean * t, oz = s * lean * t;
      pos.push(ox - s * w, t, oz + c * w, ox + s * w, t, oz - c * w); along.push(t, t);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// A crab (1 = ~1 m across its shell): the shell broad at the front and narrowing back, domed with a ridge, a row of
// spines along its front edge; a pale belly plate under it; eyes on stalks; four legs a side in three joints to a
// pointed tip; two claws held forward, each a heavy hand with a fixed finger and a moving one. Attributes: 'leg' (0
// the body, 1..8 the legs, 9 / 10 the claws: they step and work in the shader), 'part' (0 shell, 1 belly, 2 legs,
// 3 claw, 4 claw tips, 5 eyes: their colours). Its x across it (it walks that way, sideways), y up, z forward (its face)
export function crabGeometry() {
  const parts = [];
  const add = (g, leg, part) => {
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    g.setAttribute('leg', new THREE.Float32BufferAttribute(new Float32Array(n).fill(leg), 1));
    g.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    parts.push(g);
  };
  // the shell: a squashed sphere pushed into shape - wide in front, narrow behind, a ridge down the middle, the front
  // edge raised in a lip
  {
    const g = new THREE.SphereGeometry(1, 28, 14), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const front = Math.max(0, z), back = Math.max(0, -z);
      x *= 0.52 * (1 + 0.22 * front - 0.28 * back);
      z *= 0.4;
      y = y > 0 ? y * 0.2 * (1 + 0.35 * Math.exp(-x * x * 40)) : y * 0.09;
      y += 0.04 * front * front;
      P.setXYZ(i, x, y + 0.36, z);
    }
    g.computeVertexNormals();
    add(g, 0, 0);
  }
  // spines along the front edge, either side
  for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {
    const a = 0.25 + k * 0.28, g = new THREE.ConeGeometry(0.035, 0.12, 5).rotateZ(-sd * Math.PI / 2).rotateY(sd * a * 0.6);
    add(g.translate(sd * (0.36 + k * 0.06), 0.37, 0.28 - k * 0.11), 0, 0);
  }
  // the belly plate
  add(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.4, 0.07, 0.3).translate(0, 0.33, -0.02), 0, 1);
  // the eyes on their stalks
  for (const sd of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.022, 0.03, 0.14, 6).rotateX(0.35).translate(sd * 0.1, 0.48, 0.33), 0, 0);
    add(new THREE.SphereGeometry(0.045, 10, 6).translate(sd * 0.1, 0.55, 0.36), 0, 5);
  }
  // a limb's piece from a to b, tapered
  const seg = (a, b, r0, r1) => {
    const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r1, r0, d.length(), 7);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  const ball = (p, r) => new THREE.SphereGeometry(r, 7, 5).translate(p.x, p.y, p.z);
  let n = 1;
  for (const sd of [-1, 1]) for (let k = 0; k < 4; k++, n++) {
    const z = 0.14 - k * 0.13, spread = 1 - k * 0.06;
    const root = new THREE.Vector3(sd * 0.4, 0.32, z), knee = new THREE.Vector3(sd * 0.78 * spread, 0.58, z - 0.04 - k * 0.04);
    const ankle = new THREE.Vector3(sd * 1.05 * spread, 0.22, z - 0.08 - k * 0.06), tip = new THREE.Vector3(sd * 1.14 * spread, 0.0, z - 0.1 - k * 0.07);
    add(seg(root, knee, 0.055, 0.045), n, 2);
    add(ball(knee, 0.047), n, 2);
    add(seg(knee, ankle, 0.045, 0.034), n, 2);
    add(ball(ankle, 0.035), n, 2);
    add(seg(ankle, tip, 0.032, 0.006), n, 4);
  }
  // the claws: an arm in two pieces to a heavy hand, a fixed finger off it and a moving one hinged under it
  for (const sd of [-1, 1]) {
    const leg = sd < 0 ? 9 : 10, a = new THREE.Vector3(sd * 0.3, 0.33, 0.3), elbow = new THREE.Vector3(sd * 0.5, 0.42, 0.52), wrist = new THREE.Vector3(sd * 0.44, 0.4, 0.74);
    add(seg(a, elbow, 0.07, 0.06), leg, 3);
    add(ball(elbow, 0.062), leg, 3);
    add(seg(elbow, wrist, 0.06, 0.07), leg, 3);
    add(new THREE.SphereGeometry(1, 12, 8).scale(0.13, 0.1, 0.2).translate(sd * 0.44, 0.42, 0.9), leg, 3);
    add(new THREE.ConeGeometry(0.05, 0.24, 7).rotateX(Math.PI / 2).translate(sd * 0.45, 0.45, 1.18), leg, 4);
    // (the moving finger: lowest point of the hand, opening down - the shader works it by its height there)
    add(new THREE.ConeGeometry(0.045, 0.22, 7).rotateX(Math.PI / 2 + 0.25).translate(sd * 0.43, 0.35, 1.15), leg + 10, 4);
  }
  return mergeGeometries(parts);
}

const inst = (base, attrs, count) => {
  const g = new THREE.InstancedBufferGeometry().copy(base);
  for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, a.length / count));
  g.instanceCount = count;
  return g;
};

// Fish too far off for their shape (or a whole school out over the abyss): each a glint as long as it is on the screen,
// along the way it swims there, faintly lit of itself (lanternfish: a school reads as a shimmer of blue far off) and
// flashing silver now and then as it turns. Never drawn thinner than a pixel or shorter than a pixel and a half: dimmed
// in proportion instead, so a far school shimmers and never sparkles - but never below a quarter, and the water dims
// them only half as much as it dims everything else: schools read from far off, as clouds of glints. The schools circle
// as the shoals' meshes do (the same numbers: A x y z radius, B phase speed height length). d0..d1 its fade in, f0..f1
// its fade out (m)
function fishPoints(A, B, n, { d0 = 0, d1 = 1, f0 = 650, f1 = 760 } = {}, Cc = null, Dg = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('iA', new THREE.BufferAttribute(A, 4));
  g.setAttribute('iB', new THREE.BufferAttribute(B, 4));
  // (each school's colour and its own glow: lanternfish schools shine from far off)
  g.setAttribute('iC', new THREE.BufferAttribute(Cc || new Float32Array(n * 4).fill(0.5), 4));
  g.setAttribute('iD', new THREE.BufferAttribute(Dg || new Float32Array(n * 4), 4));
  const m = new THREE.ShaderMaterial({
    uniforms: { lTime: LIFE_U.lTime, lvl: { value: 0 }, pr: { value: 1 }, fade: { value: new THREE.Vector4(d0, d1, f0, f1) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float lTime, lvl, pr; uniform vec4 fade; attribute vec4 iA, iB, iC, iD; varying vec3 vC; varying vec2 vDir; varying vec3 vE;
      ${SEA_GLSL}
      void main() {
        float a = iB.x + lTime * iB.y, r = iA.w + sin(iB.x * 7.0 + lTime * 0.5) * 2.0;
        vec3 P = iA.xyz + vec3(cos(a) * r, iB.z + sin(a * 2.0 + iB.x) * 1.5, sin(a) * r);
        vec3 F = normalize(vec3(-sin(a), cos(a * 2.0 + iB.x) * 0.15, cos(a)) * sign(iB.y));
        vec4 mv = viewMatrix * vec4(P, 1.0), mf = viewMatrix * vec4(P + F, 1.0);
        float d = -mv.z, k = pr * projectionMatrix[1][1] * 360.0;
        vec2 sd = mf.xy / max(-mf.z, 0.1) - mv.xy / max(d, 0.1);
        float lp = iB.w * k * length(sd), wp = iB.w * 0.2 * k / max(d, 1.0);    // (its length and its depth on the screen, px)
        float S = clamp(max(lp, 1.5), 1.5, 40.0);
        vDir = length(sd) > 1e-6 ? normalize(sd) : vec2(1.0, 0.0);
        vE = vec3(lp, max(wp, 1.0), S);
        float flash = pow(0.5 + 0.5 * sin(lTime * 0.8 + iB.x * 13.0), 12.0);
        float cover = max(min(1.0, lp / 1.5) * min(1.0, wp), 0.25);
        float de = length(mv.xyz);                   // (as the meshes' cut: the distance, not the depth)
        float vis = smoothstep(fade.x, fade.y, de) * (1.0 - smoothstep(fade.z, fade.w, de)) * step(cameraPosition.y, lvl) * step(P.y, lvl - 1.0);
        vec3 glow = iD.rgb * (0.7 + 0.3 * sin(lTime * 1.7 + iB.x * 5.0));
        vC = (iC.rgb * 0.4 + vec3(0.05, 0.17, 0.22) + vec3(0.35, 0.5, 0.55) * flash + glow) * 1.25 * cover * vis * sqrt(seTrans(cameraPosition, P, lvl));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vis > 0.0 ? S : 0.0;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying vec2 vDir; varying vec3 vE;
      void main() {
        vec2 q = (gl_PointCoord - 0.5) * vec2(1.0, -1.0) * vE.z;
        float u = dot(q, vDir) / (0.5 * max(vE.x, 1.5)), v = dot(q, vec2(-vDir.y, vDir.x)) / (0.5 * vE.y);
        float e = u * u + v * v;
        if (e > 1.0) discard;
        gl_FragColor = vec4(vC * (1.0 - e * e), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// a lit material whose vertices the shader places in the world (as sealife.js does)
function placedMaterial({ key, pars, place, color, emissive = '', fpars = '', side = THREE.DoubleSide, roughness = 0.7, metalness = 0 }) {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness, side });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE_U, m.userData.uniforms || {});
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float lTime; varying float vAl; varying vec3 vSeed;
${pars}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
	vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 transformed = vec3(position);
${place}`)
      .replace('#include <begin_vertex>', '');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float lTime; varying float vAl; varying vec3 vSeed;
${fpars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  ${color}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${emissive}`);
  };
  m.customProgramCacheKey = () => 'ocean-bed-' + key;
  return m;
}

// ---------------------------------------------------------------- the pinnacles' rock
function pinnacleGeometry({ x, z, y0, y1, r, seed }) {
  const rnd = mulberry32(seed), NU = 28, s1 = rnd() * 40, s2 = rnd() * 40, rows = [], pos = [], idx = [];
  const h = y1 - y0, dy = Math.max(6, h / 30);
  for (let y = y0; y < y1; y += dy) rows.push(y);
  rows.push(y1);
  const crown = Array.from({ length: NU }, (_, j) => { const th = (j / NU) * TAU; return y1 - h * 0.06 * fbm(Math.cos(th) * 2 + s1, Math.sin(th) * 2 + s2, 3) * 2; });
  for (const y of rows) {
    const t = (y - y0) / h, taper = 1.5 - 0.75 * t;
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * TAU, c = Math.cos(th), s = Math.sin(th);
      const lobe = 1 + 0.4 * (fbm(c * 1.4 + s1, s * 1.4 + s2 + t * 2, 4) - 0.5) + 0.12 * Math.sin(y * 0.07 + th * 3);
      const top = Math.min(y, crown[j]);
      pos.push(x + c * r * lobe * taper, top, z + s * r * lobe * taper);
    }
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < NU; j++) {
    const a = i * NU + j, b = i * NU + (j + 1) % NU, c = a + NU, d = b + NU;
    idx.push(a, c, b, b, c, d);
  }
  const ci = pos.length / 3, last = (rows.length - 1) * NU, yc = y1 - h * 0.02;
  pos.push(x, yc, z);
  // a point on its top (a: the angle round it, f: 0 the middle .. 1 the top ring's edge), on the rock itself: the crown is
  // ragged, up to an eighth of its height down from the highest - set at that height, the weed and grass on it floated
  const top = (a, f) => {
    const u = ((a / TAU) % 1 + 1) % 1 * NU, j0 = Math.floor(u) % NU, j1 = (j0 + 1) % NU, w = u - Math.floor(u);
    const c = Math.cos(a), sn = Math.sin(a), lobe = 1 + 0.4 * (fbm(c * 1.4 + s1, sn * 1.4 + s2 + 2, 4) - 0.5) + 0.12 * Math.sin(y1 * 0.07 + a * 3);
    const R = r * lobe * 0.75, yr = crown[j0] * (1 - w) + crown[j1] * w;
    return [x + c * R * f, yc + (yr - yc) * f, z + sn * R * f];
  };
  for (let j = 0; j < NU; j++) idx.push(last + j, ci, last + (j + 1) % NU);
  // its ambient, baked: darker down where it stands in the floor (the AO's own on its steep sides drew squares)
  const ao = new Uint8Array(pos.length / 3);
  for (let v = 0; v < ao.length; v++) { const t = Math.min(1, Math.max(0, (pos[v * 3 + 1] - y0) / 60)); ao[v] = Math.round(255 * (0.5 + 0.5 * t * t * (3 - 2 * t))); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('canyonAO', new THREE.Uint8BufferAttribute(ao, 1, true));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { g, topR: r * 0.75, top };
}

// ---------------------------------------------------------------- the life round the way
export class Seabed {
  // track; grid (TrackGrid); basin (the abyss's floor); keeper: {x, z, foot}; rockMat: the pinnacles' material
  constructor(scene, track, { grid, basin, keeper, rockMat, dens = 1 }) {
    this.track = track;
    const tr = track, rnd = (this.rnd = mulberry32(7171)), f = {}, D = Math.max(0.4, dens);
    // the way's stretch under the sea (its samples well under the surface)
    const under = [];
    for (let s = 0; s < tr.length; s += 6) { tr.frame(s, f); if (f.P.y < SEA_Y - 8) under.push(s); }
    this.under = under;
    const near = [];                                   // spots for weed and grass: [x, y, z, normal-up?]
    // ---- the pinnacles
    const rocks = [], tops = [];
    let last = -1e9;
    for (const s of under) {
      if (s - last < 150 + rnd() * 120) continue;
      tr.frame(s, f);
      const R = f.R.clone().setY(0).normalize(), sd = rnd() < 0.5 ? -1 : 1, lat = sd * (TRACK_W / 2 + 45 + rnd() * 140);
      const x = f.P.x + R.x * lat, z = f.P.z + R.z * lat;
      if (keeper && Math.hypot(x - keeper.x, z - keeper.z) < (keeper.plinth || 190) + 40) continue;
      const y0 = basin.height(x, z) - 10, y1 = f.P.y + (rnd() - 0.35) * 70;
      if (y1 - y0 < 40) continue;
      const r = 14 + rnd() * 26, P = pinnacleGeometry({ x, z, y0, y1, r, seed: 900 + rocks.length });
      if (grid.geometryClear(P.g, 8, 3) < 0) continue;
      rocks.push(P.g);
      tops.push({ x, z, y: y1, r: P.topR, top: P.top });
      last = s;
    }
    if (rocks.length) {
      const m = new THREE.Mesh(mergeAll(rocks), rockMat);
      m.name = 'pinnacles';
      m.layers.set(2); m.receiveShadow = true;
      scene.add(m);
      this.rocks = m;
    }
    // ---- kelp: on the pinnacles' tops and shoulders, round the Keeper's feet, on the floor where it is near the way
    const kelp = [];                                   // x, y, z, height | phase, width, yaw, hang (0 up, 1 hanging)
    const frond = (x, y, z, h, w, hang = 0) => kelp.push([x, y, z, h, rnd() * TAU, w, rnd() * TAU, hang]);
    for (const T of tops) {
      const n = Math.round((20 + T.r * 1.2) * D);
      for (let k = 0; k < n; k++) {
        const a = rnd() * TAU, ff = Math.sqrt(rnd()) * 0.92, p = T.top(a, ff);
        frond(p[0], p[1] - 0.6, p[2], 8 + rnd() * 26, 1.2 + rnd() * 1.6);
        near.push([p[0], p[1], p[2], T, a, ff]);
      }
    }
    if (keeper) for (let k = 0; k < Math.round(260 * D); k++) {
      const r0 = (keeper.plinth || 175) + 22, a = rnd() * TAU, rr = r0 + rnd() * 60, x = keeper.x + Math.cos(a) * rr, z = keeper.z + Math.sin(a) * rr;
      frond(x, basin.height(x, z) - 1, z, 25 + rnd() * 55, 2 + rnd() * 2.5);
    }
    // the floor near the way (within ~140 m under the deck): kelp beds and meadows
    for (const s of under) {
      if (rnd() > 0.35) continue;
      tr.frame(s, f);
      const R = f.R.clone().setY(0).normalize();
      for (let k = 0; k < 3; k++) {
        const lat = (rnd() - 0.5) * 2 * (TRACK_W / 2 + 120), x = f.P.x + R.x * lat, z = f.P.z + R.z * lat, g = basin.height(x, z);
        if (f.P.y - g > 140) continue;
        if (rnd() < 0.45) frond(x, g - 1, z, 10 + rnd() * 30, 1.2 + rnd() * 1.8);
        near.push([x, g, z]);
      }
    }
    // the road itself overgrown under the sea: short weed along the foot of both walls, grass in tufts thick along them
    // and thinning out across the deck (its own random: the rest of the deep keeps its places)
    const rnd2 = mulberry32(9191), deckTufts = [];
    for (const s of under) {
      tr.frame(s, f);
      if (f.P.y > SEA_Y - 10) continue;
      for (const sd of [-1, 1]) {
        if (rnd2() < 0.5) {
          const p = f.P.clone().addScaledVector(f.R, sd * (TRACK_W / 2 - 0.5 - rnd2() * 1.2)).addScaledVector(f.U, -0.2);
          frond(p.x, p.y, p.z, 1.2 + rnd2() * 3.5, 0.4 + rnd2() * 0.6);
        }
        for (let k = 0; k < 10; k++) {
          const lat = sd * (TRACK_W / 2 - 0.3 - Math.pow(rnd2(), 2.4) * (TRACK_W / 2 - 1)), edge = (TRACK_W / 2 - Math.abs(lat)) / (TRACK_W / 2);
          const p = f.P.clone().addScaledVector(f.T, (rnd2() - 0.5) * 6).addScaledVector(f.R, lat).addScaledVector(f.U, -0.05);
          deckTufts.push([p.x, p.y, p.z, (0.45 + rnd2() * 1.6) * (1 - 0.6 * edge)]);
        }
      }
    }
    // weed hanging off the track's own edges under the sea, trailing
    for (const s of under) {
      if (rnd() > 0.55) continue;
      tr.frame(s, f);
      for (const sd of [-1, 1]) {
        if (rnd() > 0.7) continue;
        const p = f.P.clone().addScaledVector(f.R, sd * (TRACK_W / 2 + 0.9 + rnd() * 0.6)).addScaledVector(f.U, -1.2 - rnd() * 0.6);
        frond(p.x, p.y, p.z, 2 + rnd() * 9, 0.5 + rnd() * 0.7, 1);
      }
    }
    {
      const n = kelp.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      kelp.forEach((k, i) => { A.set(k.slice(0, 4), i * 4); B.set(k.slice(4), i * 4); });
      const g = inst(frondGeometry(), { iA: A, iB: B }, n);
      const mat = placedMaterial({
        key: 'kelp', roughness: 0.55,
        pars: 'attribute float along; attribute vec4 iA, iB;',
        // (sways with the current: more toward its tip, a slow wave up it; hanging weed trails along the way)
        place: /* glsl */`
  vAl = along; vSeed = vec3(iB.x, iB.y, iB.w);
  float t = lTime, ph = iB.x, h = iA.w, up = iB.w > 0.5 ? -1.0 : 1.0;
  float c = cos(iB.z), s = sin(iB.z);
  vec3 q = vec3(position.x * iB.y, position.y * h * up, position.z * iB.y);
  q = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  float k = along * along;
  q.x += (sin(t * 0.7 + ph + along * 2.4) * 0.12 + sin(t * 1.9 + ph * 2.0 + along * 5.0) * 0.04) * h * k;
  q.z += (cos(t * 0.6 + ph * 1.3 + along * 2.1) * 0.1) * h * k;
  transformed = iA.xyz + q;
  objectNormal = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);`,
        color: `diffuseColor.rgb = mix(vec3(0.05, 0.09, 0.03), vec3(0.18, 0.24, 0.06), vAl) * (0.75 + 0.5 * fract(vSeed.x * 3.7));`,
        // (a faint glow of its own, more toward the tip: the beds read out of the dark from afar and come up gradually -
        // as dark as the water round them, they were seen only once the headlights reached them, close)
        emissive: `totalEmissiveRadiance += vec3(0.004, 0.034, 0.02) * (0.35 + 0.65 * vAl);`,
      });
      this.kelp = new THREE.Mesh(g, mat);
      this.kelp.frustumCulled = false;
      this.kelp.name = 'kelp';
      scene.add(this.kelp);
    }
    // ---- sea grass: tufts in meadows round the spots found
    {
      const per = Math.round(26 * D), n = near.length * per + deckTufts.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      let i = 0;
      for (const [x, y, z, h] of deckTufts) { A.set([x, y, z, h], i * 4); B.set([rnd() * TAU, rnd() * TAU, rnd(), 0], i * 4); i++; }
      for (const [x, y, z, T, a0, f0] of near) for (let k = 0; k < per; k++, i++) {
        // (each tuft on the ground under it: on a spire's top by its crown, on the floor by the floor's height)
        let p;
        if (T) p = T.top(a0 + (rnd() - 0.5) * 0.7, Math.min(0.95, Math.max(0, f0 + (rnd() - 0.5) * 0.35)));
        else { const a = rnd() * TAU, r = Math.sqrt(rnd()) * 9, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r; p = [qx, basin.height(qx, qz), qz]; }
        A.set([p[0], p[1] - 0.3, p[2], 0.9 + rnd() * 2.6], i * 4);
        B.set([rnd() * TAU, rnd() * TAU, rnd(), 0], i * 4);
      }
      const g = inst(tuftGeometry(), { iA: A, iB: B }, n);
      const mat = placedMaterial({
        key: 'grass', roughness: 0.6,
        pars: 'attribute float along; attribute vec4 iA, iB;',
        place: /* glsl */`
  vAl = along; vSeed = vec3(iB.x, iB.z, 0.0);
  float c = cos(iB.y), s = sin(iB.y), h = iA.w;
  vec3 q = position * h;
  q = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  q.x += sin(lTime * 1.1 + iB.x + iA.x * 0.05) * 0.18 * h * along * along;
  q.z += cos(lTime * 0.9 + iB.x * 1.7 + iA.z * 0.05) * 0.14 * h * along * along;
  transformed = iA.xyz + q;
  objectNormal = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);`,
        color: `diffuseColor.rgb = mix(vec3(0.04, 0.07, 0.03), vec3(0.14, 0.2, 0.07), vAl) * (0.8 + 0.4 * vSeed.y);`,
        emissive: `totalEmissiveRadiance += vec3(0.003, 0.026, 0.015) * (0.3 + 0.7 * vAl);`,
      });
      this.grass = new THREE.Mesh(g, mat);
      this.grass.frustumCulled = false;
      this.grass.name = 'sea-grass';
      scene.add(this.grass);
    }
    // ---- anemones: glowing on the pinnacles' tops, pulsing slowly (cyan, violet, green)
    {
      const list = [];
      for (const T of tops) for (let k = 0; k < Math.round(10 * D); k++) {
        const p = T.top(rnd() * TAU, Math.sqrt(rnd()) * 0.9);
        list.push([p[0], p[1] - 0.2, p[2], 0.5 + rnd() * 1.1, rnd() * TAU, rnd(), 0, 0]);
      }
      const n = list.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      list.forEach((q, i) => { A.set(q.slice(0, 4), i * 4); B.set(q.slice(4), i * 4); });
      const g = inst(new THREE.IcosahedronGeometry(1, 1), { iA: A, iB: B }, Math.max(1, n));
      const mat = new THREE.ShaderMaterial({
        uniforms: { lTime: LIFE_U.lTime },
        vertexShader: /* glsl */`uniform float lTime; attribute vec4 iA, iB; varying vec3 vC;
          void main() {
            float p = 0.6 + 0.4 * sin(lTime * 0.8 + iB.x);
            vec3 wp = iA.xyz + position * iA.w * vec3(1.0, 0.6, 1.0) * (0.85 + 0.15 * p);
            vC = (iB.y < 0.45 ? vec3(0.1, 0.9, 1.0) : iB.y < 0.75 ? vec3(0.7, 0.25, 1.0) : vec3(0.3, 1.0, 0.5)) * (3.0 + 4.0 * p);
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: 'varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }',
      });
      mat.fog = false;
      this.anemones = new THREE.Mesh(g, mat);
      this.anemones.frustumCulled = false;
      this.anemones.name = 'anemones';
      this.anemones.visible = n > 0;
      scene.add(this.anemones);
    }
    // ---- vents: bubbles rising slowly out of the rock and the floor, many up past the deck
    {
      const cols = [];
      for (const T of tops) for (let k = 0; k < 2; k++) cols.push(T.top(rnd() * TAU, rnd() * 0.9));
      for (const [x, y, z] of near) if (rnd() < 0.25) cols.push([x, y, z]);
      for (const s of under) {
        if (rnd() > 0.06) continue;
        tr.frame(s, f);
        const lat = (rnd() < 0.5 ? -1 : 1) * (TRACK_W / 2 + 6 + rnd() * 40), x = f.P.x + f.R.x * lat, z = f.P.z + f.R.z * lat;
        cols.push([x, Math.max(basin.height(x, z), f.P.y - 120), z]);
      }
      const per = 46, n = cols.length * per, P = new Float32Array(n * 3), Q = new Float32Array(n * 4);
      let i = 0;
      for (const [x, y, z] of cols) {
        const H = 60 + rnd() * 140, sp = 1.2 + rnd() * 1.6;
        for (let k = 0; k < per; k++, i++) { P.set([x + (rnd() - 0.5) * 2, y, z + (rnd() - 0.5) * 2], i * 3); Q.set([rnd(), H, sp * (0.8 + rnd() * 0.4), 0.05 + rnd() * 0.14], i * 4); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('aQ', new THREE.BufferAttribute(Q, 4));
      this.ventMat = new THREE.ShaderMaterial({
        uniforms: { lTime: LIFE_U.lTime, lvl: { value: 0 }, pr: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
          uniform float lTime, lvl, pr; attribute vec4 aQ; varying float vA;
          ${SEA_GLSL}
          void main() {
            float u = fract(aQ.x + lTime * aQ.z / aQ.y), y = u * aQ.y;
            vec3 p = position + vec3(sin(lTime * 2.3 + aQ.x * 40.0 + y * 0.3) * 0.5 * u, y, cos(lTime * 1.9 + aQ.x * 31.0 + y * 0.27) * 0.5 * u);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            float d = -mv.z;
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(aQ.w * (1.0 + u) * pr * projectionMatrix[1][1] * 360.0 / d, 1.0, 40.0);
            vA = (p.y < lvl - 0.5 ? 1.0 : 0.0) * smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.85, 1.0, u)) * (1.0 - smoothstep(120.0, 220.0, d))
              * dot(seTrans(cameraPosition, p, lvl), vec3(0.333));
          }`,
        fragmentShader: /* glsl */`
          varying float vA;
          void main() {
            vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
            if (r2 > 1.0 || vA <= 0.0) discard;
            float rim = smoothstep(0.45, 0.95, r2) * (1.0 - smoothstep(0.95, 1.0, r2)) + 0.25 * smoothstep(0.35, 0.0, length(q - vec2(-0.3, 0.35)));
            gl_FragColor = vec4(vec3(0.35, 0.6, 0.65) * rim * vA, 1.0);
          }`,
      });
      this.vents = new THREE.Points(g, this.ventMat);
      this.vents.frustumCulled = false;
      this.vents.name = 'vents';
      scene.add(this.vents);
    }
    // ---- shoals: schools all along the way under the sea, each circling a spot near the deck; fish scatter from ships
    {
      const spots = [];
      let lastS = -1e9;
      const g2 = {};
      for (const s of under) {
        if (s - lastS < 28 + rnd() * 26) continue;
        lastS = s;
        tr.frame(s, f);
        // (some over the deck itself, high enough to part round the ships - and clear of the highest of the deck under
        // the whole circle they swim, which climbs and banks within it: set by the middle only, fish dipped into the
        // road there, a tail standing out of it; the rest off to the sides, their circle clear of the track)
        const r = 8 + rnd() * 16, lat0 = (rnd() - 0.5) * 2 * (TRACK_W / 2 + 45), over = Math.abs(lat0) < TRACK_W / 2 + 6;
        let lat = lat0, y;
        if (over) {
          let top = -1e9;
          for (let ds = -r - 6; ds <= r + 6; ds += 3) { tr.frame(tr.wrap(s + ds), g2); top = Math.max(top, g2.P.y + Math.abs(g2.R.y) * (TRACK_W / 2 + 1.5) + 1.5); }
          tr.frame(s, f);
          y = top + 8 + r * 0.25 + rnd() * 14;
        } else {
          lat = Math.sign(lat0) * Math.max(Math.abs(lat0), TRACK_W / 2 + 8 + r * 1.15);
          y = f.P.y + (rnd() - 0.2) * 22;
        }
        spots.push([f.P.x + f.R.x * lat, y, f.P.z + f.R.z * lat, r]);
      }
      // the kinds: [back colour, glow, body depth, length range (m), how many in a school, speed, weight]
      const KINDS = [
        [[0.35, 0.45, 0.55], [0, 0, 0], 0.8, [0.4, 0.8], 260, 0.3, 5],          // sardines: silver, slim, many
        [[0.12, 0.35, 0.3], [0, 0, 0], 0.85, [0.6, 1.1], 170, 0.26, 3],          // mackerel: green-blue backs
        [[0.75, 0.16, 0.1], [0, 0, 0], 1.3, [0.8, 1.6], 70, 0.18, 2],            // snappers: red, deep-bodied
        [[0.95, 0.75, 0.08], [0, 0, 0], 1.8, [0.35, 0.7], 110, 0.22, 2],         // yellow, round
        [[0.1, 0.22, 0.7], [0, 0, 0], 1.2, [0.6, 1.0], 120, 0.24, 2],            // blue
        [[0.08, 0.12, 0.22], [0, 0, 0], 1.0, [2.0, 3.6], 26, 0.12, 1],           // tuna: big, few, slow
        [[0.05, 0.08, 0.12], [0.05, 0.6, 0.8], 0.9, [0.35, 0.7], 160, 0.28, 2],   // lanternfish: cyan glow
        [[0.06, 0.05, 0.1], [0.6, 0.15, 0.7], 0.9, [0.35, 0.7], 120, 0.28, 1],   // lanternfish: violet glow
      ];
      const kw = KINDS.reduce((a, k) => a + k[6], 0);
      const kind = () => { let u = rnd() * kw; for (const k of KINDS) { u -= k[6]; if (u <= 0) return k; } return KINDS[0]; };
      const Ar = [], Br = [], Cr = [], Dr = [];
      for (const [x, y, z, r] of spots) {
        const K = kind(), dir = rnd() < 0.5 ? 1 : -1, sp = (K[5] + rnd() * 0.1) * dir, per = Math.max(8, Math.round(K[4] * 1.3 * D));
        const tint = 0.85 + rnd() * 0.3;
        for (let k = 0; k < per; k++) {
          Ar.push(x, y, z, r * (0.75 + rnd() * 0.5));
          Br.push(rnd() * TAU, sp * (0.9 + rnd() * 0.2), (rnd() - 0.5) * r * 0.5, K[3][0] + rnd() * (K[3][1] - K[3][0]));
          Cr.push(K[0][0] * tint, K[0][1] * tint, K[0][2] * tint, K[2]);
          Dr.push(K[1][0], K[1][1], K[1][2], 0);
        }
      }
      const n = Ar.length / 4, A = new Float32Array(Ar), B = new Float32Array(Br), C = new Float32Array(Cr), Dg = new Float32Array(Dr);
      const g = inst(fishGeometry(6, 5, false), { iA: A, iB: B, iC: C, iD: Dg }, n);
      this.shipU = { shipP: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -1e5, 0, 0)) } };
      const mat = placedMaterial({
        key: 'shoals', side: THREE.FrontSide, metalness: 0.65, roughness: 0.3,
        pars: 'attribute float along; attribute vec4 iA, iB, iC, iD; uniform vec4 shipP[4]; varying float vFY; varying vec3 vGlow;',
        fpars: 'varying float vFY; varying vec3 vGlow;',
        place: /* glsl */`
  vAl = along; vSeed = iC.rgb; vFY = position.y / 0.13; vGlow = iD.rgb;
  float a = iB.x + lTime * iB.y, r = iA.w + sin(iB.x * 7.0 + lTime * 0.5) * 2.0;
  vec3 P = iA.xyz + vec3(cos(a) * r, iB.z + sin(a * 2.0 + iB.x) * 1.5, sin(a) * r);
  vec3 F = vec3(-sin(a), cos(a * 2.0 + iB.x) * 0.15, cos(a)) * sign(iB.y);
  // scattering: away from a ship that comes near (within ~22 m), darting off its way
  for (int i = 0; i < 4; i++) {
    vec3 dv = P - shipP[i].xyz;
    float d2 = dot(dv, dv), k = shipP[i].w * exp(-d2 / 140.0);
    // (sideways only: pushed down they went into the road)
    vec3 dh = normalize(vec3(dv.x, 0.0, dv.z) + vec3(0.001, 0.0, 0.0));
    P += dh * k * 9.0;
    F = normalize(F + dh * k * 3.0);
  }
  mat3 B = lfBasis(F, 0.0);
  vec3 q = position;
  q.y *= iC.w;                                         // (its kind's build: slim, or deep-bodied)
  q.x += sin(along * 5.0 - lTime * 18.0 + iB.x * 5.0) * 0.08 * along;
  transformed = P + B * (q * iB.w);
  objectNormal = B * normal;
  // (past ~200 m a glint each instead - fishPoints - fading in as the shape goes)
  if (distance(P, cameraPosition) > 235.0) transformed = vec3(0.0, -1e5, 0.0);`,
        // (its kind's colour on its back, pale under the belly)
        color: `diffuseColor.rgb = mix(vec3(0.72, 0.75, 0.78), vSeed, smoothstep(-0.35, 0.45, vFY)) * (0.85 + 0.3 * vAl);`,
        // (a glow of their own and a glint: a school reads as a shimmering cloud from a few hundred metres - as dim as the
        // water round them, they were seen only once the headlights caught them, in the face; lanternfish their own light)
        emissive: `totalEmissiveRadiance += vSeed * 0.18 + vec3(0.03, 0.12, 0.16) + vGlow * (0.75 + 0.25 * sin(lTime * 2.0 + vAl * 7.0)) * 1.6 + vec3(0.55, 0.8, 0.85) * 0.5 * pow(abs(dot(normal, normalize(vViewPosition))), 6.0);`,
      });
      mat.userData.uniforms = this.shipU;
      mat.onBeforeCompile = ((ob) => (sh) => {
        ob(sh);
        sh.vertexShader = sh.vertexShader.replace('uniform float lTime;', `uniform float lTime;
mat3 lfBasis(vec3 f, float roll) {
  vec3 z = normalize(f), x = normalize(cross(vec3(0.0, 1.0, 0.0), z));
  if (abs(z.y) > 0.999) x = vec3(1.0, 0.0, 0.0);
  vec3 y = cross(z, x);
  return mat3(x, y, z);
}`);
      })(mat.onBeforeCompile);
      this.shoals = new THREE.Mesh(g, mat);
      this.shoals.frustumCulled = false;
      this.shoals.name = 'shoals-way';
      scene.add(this.shoals);
      this.shoalsFar = fishPoints(A, B, n, { d0: 175, d1: 235, f0: 1000, f1: 1200 }, C, Dg);
      this.shoalsFar.name = 'shoals-way-far';
      scene.add(this.shoalsFar);
      // the schools all round the way, off it: big clouds 60 - 300 m out at every depth, and further ones out over the
      // abyss and the city (180 - 750 m): seen only from some way off, as glints
      const far = [];
      const school = (lat0, lat1, gap, rMin, rMax, dy) => {
        const s = under[Math.floor(rnd() * under.length)];
        tr.frame(s, f);
        const R = f.R.clone().setY(0).normalize(), lat = (rnd() < 0.5 ? -1 : 1) * (lat0 + rnd() * (lat1 - lat0)), x = f.P.x + R.x * lat, z = f.P.z + R.z * lat;
        const r = rMin + rnd() * (rMax - rMin), floor = basin.height(x, z), y = Math.min(SEA_Y - 30 - r * 0.3, f.P.y + (rnd() - 0.3) * dy);
        if (y < floor + 20 + r * 0.3) return;
        const p = new THREE.Vector3(x, y, z);
        if (tr.P[tr.nearestIndex(p)].distanceTo(p) < gap + r) return;
        far.push([x, y, z, r]);
      };
      for (let k = 0; k < 2400 && far.length < Math.round(260 * D); k++) school(TRACK_W / 2 + 50, 300, 45, 10, 26, 90);
      for (let k = 0; k < 2400 && far.length < Math.round(480 * D); k++) school(180, 750, 130, 18, 46, 150);
      const per2 = 380, n2 = far.length * per2, A2 = new Float32Array(n2 * 4), B2 = new Float32Array(n2 * 4), C2 = new Float32Array(n2 * 4), D2 = new Float32Array(n2 * 4);
      let i = 0;
      for (const [x, y, z, r] of far) {
        const dir = rnd() < 0.5 ? 1 : -1, sp = (0.12 + rnd() * 0.1) * dir, K = rnd() < 0.4 ? KINDS[6 + Math.floor(rnd() * 2)] : kind();
        for (let k = 0; k < per2; k++, i++) {
          C2.set([K[0][0], K[0][1], K[0][2], K[2]], i * 4);
          D2.set([K[1][0] * 1.6, K[1][1] * 1.6, K[1][2] * 1.6, 0], i * 4);
          A2.set([x, y, z, r * (0.55 + rnd() * 0.6)], i * 4);
          B2.set([rnd() * TAU, sp * (0.9 + rnd() * 0.2), (rnd() - 0.5) * r * 0.7, 0.7 + rnd() * 1.1], i * 4);
        }
      }
      this.schools = fishPoints(A2, B2, n2, { d0: 45, d1: 75, f0: 1050, f1: 1250 }, C2, D2);
      this.schools.name = 'schools-far';
      scene.add(this.schools);
      console.info(`seabed: ${rocks.length} pinnacles, ${kelp.length} fronds, ${this.grass.geometry.instanceCount} tufts, ${n} fish in ${spots.length} shoals, ${n2} in ${far.length} schools far off`);
    }
    // ---- crabs: along the foot of both walls on the road under the sea, walking sideways to and fro, their legs stepping
    // and their claws working; red to orange, the odd big one
    {
      const rnd3 = mulberry32(4242), list = [];
      let next = 0;
      for (const s of under) {
        if (s < next) continue;
        next = s + 9 + rnd3() * 16;
        tr.frame(s, f);
        if (f.P.y > SEA_Y - 10) continue;
        // (out on the road as well as along the walls: those on the deck cross it, those by a wall walk along it)
        const sd = rnd3() < 0.5 ? -1 : 1, size = rnd3() < 0.15 ? 1.5 + rnd3() * 0.5 : 0.8 + rnd3() * 0.5, onDeck = rnd3() < 0.55;
        const lat = onDeck ? (rnd3() - 0.5) * 2 * (TRACK_W / 2 - 4) : sd * (TRACK_W / 2 - 1.2 - size * 0.7);
        const p = f.P.clone().addScaledVector(f.R, lat);
        const dir = onDeck ? f.R : f.T;
        list.push([p.x, p.y, p.z, size, dir.x, dir.z, rnd3() * TAU, onDeck ? 3 + rnd3() * 6 : 1.5 + rnd3() * 4, f.U.x, f.U.y, f.U.z, sd * (0.2 + rnd3() * 0.8)]);
      }
      const nc = list.length, A = new Float32Array(nc * 4), B = new Float32Array(nc * 4), Uu = new Float32Array(nc * 4);
      list.forEach((q, k) => { A.set(q.slice(0, 4), k * 4); B.set(q.slice(4, 8), k * 4); Uu.set(q.slice(8, 12), k * 4); });
      const g = inst(crabGeometry(), { iA: A, iB: B, iU: Uu }, Math.max(1, nc));
      const mat = placedMaterial({
        key: 'crabs', side: THREE.FrontSide, roughness: 0.45, metalness: 0.1,
        pars: 'attribute float leg, part; attribute vec4 iA, iB, iU; varying float vPart; varying vec3 vCP;',
        fpars: 'varying float vPart; varying vec3 vCP;',
        place: /* glsl */`
  vAl = leg; vSeed = vec3(abs(iU.w), position.y, 0.0); vPart = part; vCP = position;
  vec3 up = normalize(iU.xyz), along = normalize(vec3(iB.x, 0.0, iB.y));
  along = normalize(along - up * dot(along, up));
  vec3 face = cross(along, up) * sign(iU.w);
  // sideways along the wall and back, slowly, a pause at each end
  float w = sin(lTime * 0.22 + iB.z);
  vec3 P = iA.xyz + along * iB.w * w * (1.5 - 0.5 * abs(w));
  vec3 q = position;
  float stepK = abs(cos(lTime * 0.22 + iB.z));
  if (leg > 0.5 && leg < 8.5) q.y += max(0.0, sin(lTime * 7.0 + leg * 1.9 + iB.z)) * 0.09 * abs(q.x) * stepK;
  if (leg > 8.5) q.y += sin(lTime * 1.3 + leg * 2.0 + iB.z) * 0.05 * max(0.0, q.z - 0.3);
  // (the moving fingers open and shut)
  if (leg > 18.5) q.y -= (0.5 + 0.5 * sin(lTime * 2.3 + leg + iB.z)) * 0.12 * max(0.0, q.z - 1.04);
  mat3 B = mat3(along, up, face);
  transformed = P + B * (q * iA.w);
  objectNormal = B * normal;`,
        // (the shell deep red on top to orange at its rim, speckled; the belly cream; the legs orange-red banded paler at
        // the joints; the claws red with dark tips; the eyes black and glossy. A faint warm glow of their own: they read in
        // the dark past the headlights)
        color: `{
    float spk = fract(sin(dot(floor(vCP.xz * 22.0), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 shell = mix(vec3(0.62, 0.08, 0.04), vec3(0.95, 0.38, 0.1), smoothstep(0.42, 0.3, vCP.y + 0.06 * abs(vCP.x)));
    shell *= 0.85 + 0.25 * step(0.86, spk);
    vec3 c = vPart < 0.5 ? shell : vPart < 1.5 ? vec3(0.9, 0.78, 0.6) : vPart < 2.5 ? mix(vec3(0.85, 0.3, 0.08), vec3(0.95, 0.6, 0.3), smoothstep(0.0, 0.03, abs(fract(length(vCP.xz) * 3.2) - 0.5) - 0.42))
      : vPart < 3.5 ? vec3(0.78, 0.12, 0.05) : vPart < 4.5 ? vec3(0.12, 0.05, 0.04) : vec3(0.02);
    diffuseColor.rgb = c;
  }`,
        emissive: `totalEmissiveRadiance += diffuseColor.rgb * 0.09 + vec3(0.5, 0.9, 0.8) * step(4.5, vPart) * 0.25;`,
      });
      this.crabs = new THREE.Mesh(g, mat);
      this.crabs.frustumCulled = false;
      this.crabs.name = 'crabs';
      this.crabs.visible = nc > 0;
      scene.add(this.crabs);
      console.info(`seabed: ${deckTufts.length} tufts on the road, ${nc} crabs`);
    }
    this.meshes = [this.rocks, this.kelp, this.grass, this.anemones, this.vents, this.shoals, this.shoalsFar, this.schools, this.crabs].filter(Boolean);
  }

  // every frame: the sea's level at the camera, the ships near it (the fish scatter from them)
  update(t, lvl, ships, pr = 1, cam = null) {
    this.ventMat.uniforms.lvl.value = lvl; this.ventMat.uniforms.pr.value = pr;
    // (above the sea none of it is seen through the surface: not drawn)
    if (cam && this.on !== false) { const under = cam.y < lvl + 2; for (const m of [this.grass, this.kelp, this.shoals, this.shoalsFar, this.schools, this.vents, this.anemones, this.crabs]) m.visible = under; }
    for (const m of [this.shoalsFar, this.schools]) { m.material.uniforms.lvl.value = lvl; m.material.uniforms.pr.value = pr; }
    const sp = this.shipU.shipP.value;
    for (let k = 0; k < 4; k++) {
      const e = ships[k];
      if (e && e.pos) sp[k].set(e.pos.x, e.pos.y, e.pos.z, Math.min(1, (e.speed || 0) / 120)); else sp[k].set(0, -1e5, 0, 0);
    }
  }

  setOn(on) { this.on = on; for (const m of this.meshes) m.visible = on; }
}

function mergeAll(gs) {
  let n = 0, ni = 0;
  for (const g of gs) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), idx = new Uint32Array(ni), ao = new Uint8Array(n).fill(255);
  let o = 0, oi = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3);
    if (g.attributes.canyonAO) ao.set(g.attributes.canyonAO.array, o);
    for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + o;
    o += g.attributes.position.count; oi += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('canyonAO', new THREE.Uint8BufferAttribute(ao, 1, true));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
