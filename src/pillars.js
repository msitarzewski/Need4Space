// The alien pillars round the ocean circuit: the drowned civilisation's oldest works, a ring of colossal columns
// standing out of the sea round the whole track and going up out of sight - kilometres tall, their heights lost in the
// cloud: from a kilometre up each fades into the sky through drifting wisps, and nobody sees where one ends. Each a
// fluted shaft of five to seven lobes twisting up it, built of segments with narrow joints and heavier collars every
// few, worn and gouged low down; root buttresses flaring from its foot into the sea; great conduits clamped up its sides
// into its collars; a ring gallery round it carrying emitter nodes. Girders reach from one pillar toward the next - most
// broken off part way, one or two still whole. Their light is the city's cyan: faint veins in the flutes, most long
// dead, the few still alive pulsing slowly upward; the nodes glowing, breathing slowly. No markings.
import * as THREE from 'three';
import { mulberry32, fbm } from './noise.js';
import { SEA_Y, SEA_GLSL } from './sea.js';
import { LIFE_U } from './sealife.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const K_BODY = 0, K_METAL = 1, K_NODE = 2;
const DEEP = SEA_Y - 150;                                     // how far down they go (none of it seen from above)
const FADE0 = 900, FADE1 = 2600;                              // where they go into the cloud: from here, gone by here (m)

// a builder: positions, normals, kinds and each vertex's place on its pillar's skin (lobe phase, height, segment)
class Kit {
  constructor() { this.P = []; this.N = []; this.K = []; this.A = []; this.I = []; }
  vert(p, n, k, a = [0, 0, 0]) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.K.push(k); this.A.push(...a); return this.P.length / 3 - 1; }
  // a flat face (its corners in order round it), turned to face n
  quad(a, b, c, d, n, k) {
    const o = this.P.length / 3;
    for (const p of [a, b, c, d]) this.vert(p, n, k);
    const f = b.clone().sub(a).cross(c.clone().sub(a)).dot(n) >= 0;
    this.I.push(...(f ? [o, o + 1, o + 2, o, o + 2, o + 3] : [o, o + 2, o + 1, o, o + 3, o + 2]));
  }
  // a box between two points (its length along a - b), w wide (across, level) and h high
  beam(a, b, w, h, k) {
    const x = b.clone().sub(a), L = x.length();
    if (L < 1e-3) return;
    x.divideScalar(L);
    let z = V(0, 1, 0).cross(x);
    if (z.lengthSq() < 1e-4) z = V(1, 0, 0);
    this.box(a.clone().lerp(b, 0.5), V(L / 2, h / 2, w / 2), x, z.normalize(), k);
  }
  // a box, centre c, half-sizes h, along x / across z (and the third way, y = z x x)
  box(c, h, x, z0, k) {
    const z = z0.clone().addScaledVector(x, -z0.dot(x)).normalize(), y = z.clone().cross(x).normalize();
    const p = (sx, sy, sz) => c.clone().addScaledVector(x, sx * h.x).addScaledVector(y, sy * h.y).addScaledVector(z, sz * h.z);
    const f = (n, a, b, cc, d) => this.quad(a, b, cc, d, n, k);
    f(x, p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
    f(x.clone().negate(), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1));
    f(y, p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1));
    f(y.clone().negate(), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
    f(z, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
    f(z.clone().negate(), p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
  }
  // a cylinder (or cone) from a to b, radii r0 / r1, its round faces smooth
  cyl(a, b, r0, r1, segs, k, caps = false) {
    const d = b.clone().sub(a).normalize();
    const u = Math.abs(d.y) < 0.9 ? V(0, 1, 0).cross(d).normalize() : V(1, 0, 0).cross(d).normalize(), v = d.clone().cross(u);
    const o = this.P.length / 3, slope = (r0 - r1) / Math.max(1e-3, a.distanceTo(b));
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * TAU, n = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
      const nn = n.clone().addScaledVector(d, slope).normalize();
      for (const [p, r] of [[a, r0], [b, r1]]) this.vert(p.clone().addScaledVector(n, r), nn, k);
    }
    for (let i = 0; i < segs; i++) { const q = o + i * 2; this.I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    if (caps) for (const [p, r, s] of [[a, r0, -1], [b, r1, 1]]) {
      if (r <= 0.01) continue;
      const n = d.clone().multiplyScalar(s), c0 = this.vert(p, n, k);
      for (let i = 0; i <= segs; i++) { const th = (i / segs) * TAU; this.vert(p.clone().addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r), n, k); }
      for (let i = 0; i < segs; i++) this.I.push(...(s > 0 ? [c0, c0 + 1 + i, c0 + 2 + i] : [c0, c0 + 2 + i, c0 + 1 + i]));
    }
  }
  sphere(c, r, k) {
    const g = new THREE.SphereGeometry(r, 16, 10), P = g.attributes.position, N = g.attributes.normal, o = this.P.length / 3;
    for (let i = 0; i < P.count; i++) this.vert(V(P.getX(i), P.getY(i), P.getZ(i)).add(c), V(N.getX(i), N.getY(i), N.getZ(i)), k);
    for (const i of g.index.array) this.I.push(i + o);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('kind', new THREE.Float32BufferAttribute(this.K, 1));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.A, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

// one pillar's shape: its radius at height y and angle th (round its own axis); P: its numbers
function pillarShape(P) {
  const { H, R0, lobes, twist, seg, seed, gouges } = P;
  return (y, th) => {
    const t = Math.max(0, y) / H;
    let r = R0 * (1 - 0.25 * t) * (1 + 0.5 * Math.exp(-Math.max(0, y) / 120) + (y < 0 ? 0.25 * Math.min(1, -y / 80) : 0));
    // the segments: a narrow joint between each, a heavier collar every fourth
    const sf = ((y + 9999 * seg) / seg) % 1, si = Math.floor((y + 9999 * seg) / seg);
    r *= 1 - 0.07 * Math.pow(1 - Math.sin(Math.PI * sf), 6) + (si % 4 === 0 ? 0.07 * Math.pow(Math.sin(Math.PI * sf), 0.3) : 0);
    // the lobes, twisting up it; the flutes between them
    const a = lobes * (th + twist * Math.max(0, y) / 1000);
    r *= 1 + 0.11 * Math.cos(a) - 0.05 * Math.pow(Math.abs(Math.sin(a / 2)), 24);
    // worn: a broad unevenness and gouges where pieces have fallen away
    r *= 1 - 0.04 * fbm(Math.cos(th) * 3 + seed, y * 0.012 + Math.sin(th) * 3, 3);
    for (const g of gouges) {
      const dy = (y - g.y) / g.h, dth = Math.atan2(Math.sin(th - g.th), Math.cos(th - g.th)) / g.w;
      const q = dy * dy + dth * dth;
      if (q < 1) r *= 1 - g.d * (1 - q) * (1 - q);
    }
    return r;
  };
}

// the skin: rows round the axis from deep under the sea up into the cloud (fine low down, where it is seen close,
// coarser going up), capped far up; the lobe phase and the height on every vertex (the veins: the material)
function pillarBody(kit, c, P, rad) {
  const NA = 60, rows = [];
  for (let y = DEEP; y < P.H; y += y < 600 ? 6 : y < 1500 ? 12 : y < 3000 ? 40 : 150) rows.push(y);
  rows.push(P.H);
  const jag = () => P.H;
  const o = kit.P.length / 3;
  for (const y0 of rows) for (let j = 0; j <= NA; j++) {
    const th = (j / NA) * TAU, y = Math.min(y0, jag(th)), r = rad(y, th);
    kit.vert(V(c.x + Math.cos(th) * r, y, c.z + Math.sin(th) * r), V(0, 1, 0), K_BODY, [P.lobes * (th + P.twist * Math.max(0, y) / 1000), y, P.seed]);
  }
  const W = NA + 1;
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < NA; j++) {
    const a = o + i * W + j, b = a + 1, d = a + W, e = d + 1;
    kit.I.push(a, d, b, b, d, e);
  }
  // the cap, far up in the cloud
  const last = o + (rows.length - 1) * W, cy = P.H;
  const ci = kit.vert(V(c.x, cy, c.z), V(0, 1, 0), K_BODY, [0, cy, P.seed]);
  for (let j = 0; j < NA; j++) kit.I.push(last + j, last + j + 1, ci);
  return { o, W, rows: rows.length };
}

// smooth normals for the skin (its seam's two copies of each vertex averaged: no line down it)
function skinNormals(g, skins) {
  g.computeVertexNormals();
  const N = g.attributes.normal;
  for (const { o, W, rows } of skins) for (let i = 0; i < rows; i++) {
    const a = o + i * W, b = a + W - 1;
    const n = V(N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)).normalize();
    N.setXYZ(a, n.x, n.y, n.z); N.setXYZ(b, n.x, n.y, n.z);
  }
}

export class AlienPillars {
  // track: to keep clear of; avoid: [{ x, z, r }] other things to keep off
  // skyCube: the sky as the sea sees it (the moon left out): what the pillars fade into going up
  constructor(scene, track, { avoid = [], clear = 320, skyCube = null } = {}) {
    const rnd = mulberry32(4711), f = {};
    const pts = [];
    for (let s = 0; s < track.length; s += 25) { track.frame(s, f); pts.push([f.P.x, f.P.z]); }
    let mx = [1e9, -1e9], mz = [1e9, -1e9];
    for (const [x, z] of pts) { mx = [Math.min(mx[0], x), Math.max(mx[1], x)]; mz = [Math.min(mz[0], z), Math.max(mz[1], z)]; }
    const cx = (mx[0] + mx[1]) / 2, cz = (mz[0] + mz[1]) / 2, rx = (mx[1] - mx[0]) / 2 + 380, rz = (mz[1] - mz[0]) / 2 + 420;
    const near = (x, z) => Math.min(...pts.map(([a, b]) => Math.hypot(a - x, b - z)));
    // the ring: eight round it all, pushed out wherever one comes too near the track or a landmark
    const N = 8, pil = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + 0.2 + (rnd() - 0.5) * 0.25;
      const R0 = 110 + rnd() * 60;
      let r = 1;
      for (let i = 0; i < 40; i++) {
        const x = cx + Math.cos(a) * rx * r, z = cz + Math.sin(a) * rz * r;
        if (near(x, z) > clear + R0 * 2.1 && avoid.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + R0 * 2.2 + 60)) break;
        r += 0.03;
      }
      const H = 5500 + rnd() * 3500, seed = rnd() * 100;
      const gouges = Array.from({ length: 4 + Math.floor(rnd() * 4) }, () => ({ y: 120 + rnd() * 1000, th: rnd() * TAU, h: 25 + rnd() * 60, w: 0.2 + rnd() * 0.3, d: 0.08 + rnd() * 0.12 }));
      pil.push({ c: V(cx + Math.cos(a) * rx * r, SEA_Y, cz + Math.sin(a) * rz * r), H, R0, lobes: 5 + Math.floor(rnd() * 3), twist: (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.6),
        seg: 45 + rnd() * 25, seed, gouges });
    }
    this.glow = [];
    const kits = pil.map(() => new Kit()), skins = pil.map(() => null);
    pil.forEach((P, k) => {
      const kit = kits[k], c = P.c, rad = pillarShape(P);
      P.rad = rad;
      skins[k] = pillarBody(kit, c, P, rad);
      const at = (y, th, off = 0) => { const r = rad(y, th) + off; return V(c.x + Math.cos(th) * r, y, c.z + Math.sin(th) * r); };
      const outAt = (th) => V(Math.cos(th), 0, Math.sin(th));
      // ---- the root buttresses: plates flaring from the foot out into the sea, between the lobes
      const nf = 5;
      for (let i = 0; i < nf; i++) {
        const th = (i / nf) * TAU + rnd() * 0.3, d = outAt(th), sd = V(-d.z, 0, d.x), half = 8 + P.R0 * 0.07;
        const top = at(170, th, -4), foot = at(DEEP, th, -4), tipW = c.clone().addScaledVector(d, P.R0 * 1.95).setY(SEA_Y + 5), tipD = c.clone().addScaledVector(d, P.R0 * 2.2).setY(DEEP);
        const q = (p, s) => p.clone().addScaledVector(sd, s * half);
        const faces = [[q(top, 1), q(tipW, 1), q(tipD, 1), q(foot, 1), sd], [q(top, -1), q(foot, -1), q(tipD, -1), q(tipW, -1), sd.clone().negate()],
          [q(top, 1), q(top, -1), q(tipW, -1), q(tipW, 1), tipW.clone().sub(top).cross(sd).normalize().negate()],
          [q(tipW, 1), q(tipW, -1), q(tipD, -1), q(tipD, 1), d]];
        for (const [a, b, cc, dd, n] of faces) kit.quad(a, b, cc, dd, n.y < -0.2 ? n.negate() : n, K_BODY);
      }
      // ---- the conduits: two great pipes up the lobes' crests into the collars, clamped every forty metres
      for (let i = 0; i < 2; i++) {
        const th0 = (Math.floor(rnd() * P.lobes) + i * Math.floor(P.lobes / 2)) * TAU / P.lobes, y0 = 60, y1 = FADE1 + 200, r = 9 + rnd() * 4;
        const thAt = (y) => th0 - P.twist * (y / 1000);
        let prev = null;
        for (let y = y0; y <= y1; y += y < 1200 ? 10 : 40) {
          const th = thAt(y), p = at(y, th, r * 0.8);
          if (prev) kit.cyl(prev, p, r, r, 10, K_METAL);
          if (y < 1200 && Math.round(y - y0) % 40 === 0) kit.cyl(p.clone().addScaledVector(V(0, 1, 0), -2.2), p.clone().addScaledVector(V(0, 1, 0), 2.2), r * 1.4, r * 1.4, 12, K_METAL, true);
          prev = p;
        }
      }
      // ---- the gallery: a ring round it at about half its height on struts, nodes standing on it
      {
        const y = 320 + rnd() * 260, segs = 64;
        let rMin = 1e9, rMax = 0;
        for (let j = 0; j < 72; j++) { const r = rad(y, (j / 72) * TAU); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
        const Ri = rMin * 0.9, Ro = rMax + 36;
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
          const pi0 = c.clone().addScaledVector(outAt(a0), Ri).setY(y), pi1 = c.clone().addScaledVector(outAt(a1), Ri).setY(y);
          const po0 = c.clone().addScaledVector(outAt(a0), Ro).setY(y), po1 = c.clone().addScaledVector(outAt(a1), Ro).setY(y);
          const up = V(0, 4, 0);
          kit.quad(pi0.clone().add(up), po0.clone().add(up), po1.clone().add(up), pi1.clone().add(up), V(0, 1, 0), K_METAL);
          kit.quad(pi0, pi1, po1, po0, V(0, -1, 0), K_METAL);
          kit.quad(po0, po1, po1.clone().add(up), po0.clone().add(up), outAt((a0 + a1) / 2), K_METAL);
          if (i % 4 === 0) {
            // a strut from under the ring's outer edge down and in to the skin
            const th = a0, s0 = c.clone().addScaledVector(outAt(th), Ro - 4).setY(y), s1 = at(y - 45, th, -1);
            kit.cyl(s0, s1, 2.4, 3.2, 8, K_METAL);
          }
          if (i % 8 === 2) {
            // a node: a sphere in a socket on the ring, glowing
            const p = c.clone().addScaledVector(outAt((a0 + a1) / 2), Ro - 6).setY(y + 4);
            kit.cyl(p, p.clone().addScaledVector(V(0, 1, 0), 2.5), 4.5, 4.0, 12, K_METAL, true);
            kit.sphere(p.clone().addScaledVector(V(0, 1, 0), 5.5), 3.2, K_NODE);
            this.glow.push([p.clone().addScaledVector(V(0, 1, 0), 5.5), 1, rnd()]);
          }
        }
      }
      // ---- nodes on the collars up the shaft, into the cloud: its lights going up out of sight
      for (let y = 700; y < FADE1; y += 260 + rnd() * 200) {
        const th = rnd() * TAU, p = at(y, th, 2);
        kit.sphere(p, 6, K_NODE);
        this.glow.push([p, 1.2, rnd()]);
      }
    });
    // ---- the girders: from each pillar toward the next, 350 - 700 m up; most broken off
    pil.forEach((A, k) => {
      const B = pil[(k + 1) % N], y = 350 + rnd() * 350, roll = rnd();
      if (roll < 0.2) return;
      const d = B.c.clone().sub(A.c).setY(0), gap = d.length();
      d.divideScalar(gap);
      const thA = Math.atan2(d.z, d.x), thB = thA + Math.PI;
      const a0 = A.c.clone().addScaledVector(d, A.rad(y, thA) * 0.7).setY(y), b0 = B.c.clone().addScaledVector(d, -B.rad(y, thB) * 0.7).setY(y);
      const span = a0.distanceTo(b0), whole = roll > 0.85;
      const reachA = whole ? span : span * (0.18 + rnd() * 0.22), reachB = whole ? 0 : span * (0.12 + rnd() * 0.2);
      const girder = (kit, from, dir, len) => {
        const to = from.clone().addScaledVector(dir, len);
        kit.beam(from, to, 40, 52, K_METAL);
        for (let s = 40; s < len - 10; s += 60) { const p = from.clone().addScaledVector(dir, s); kit.beam(p.clone().addScaledVector(V(0, 1, 0), -28), p.clone().addScaledVector(V(0, 1, 0), -28).addScaledVector(dir, 9), 46, 8, K_METAL); }
        if (len < span - 1) for (let i = 0; i < 7; i++) {
          // (the broken end: the members inside it standing out of the break)
          const p = to.clone().add(V((rnd() - 0.5) * 30, (rnd() - 0.5) * 40, 0).applyAxisAngle(V(0, 1, 0), -Math.atan2(dir.z, dir.x) + Math.PI / 2));
          kit.cyl(p.clone().addScaledVector(dir, -5), p.clone().addScaledVector(dir, 10 + rnd() * 30).add(V(0, (rnd() - 0.6) * 10, 0)), 2.2, 0.4, 6, K_METAL, true);
        }
      };
      girder(kits[k], a0, d, reachA);
      if (reachB > 0) girder(kits[(k + 1) % N], b0, d.clone().negate(), reachB);
    });
    // ---- the meshes: one a pillar (each culled on its own)
    this.mat = alienMaterial(skyCube);
    this.meshes = kits.map((kit, k) => {
      const g = kit.geometry();
      skinNormals(g, [skins[k]]);
      const m = new THREE.Mesh(g, this.mat);
      m.name = 'alien-pillar';
      m.layers.set(2);
      scene.add(m);
      return m;
    });
    this.lights = glowPoints(this.glow);
    this.lights.name = 'alien-pillar-glow';
    this.lights.layers.set(2);
    scene.add(this.lights);
    this.spots = pil.map((P) => P.c);
    this.all = [...this.meshes, this.lights];
    console.info(`alien pillars: ${N}, ${this.meshes.reduce((n, m) => n + m.geometry.index.count / 3, 0)} triangles`);
  }

  setOn(on) { this.on = on; for (const m of this.all) m.visible = on; }

  // every frame: not drawn from deep in the sea (nothing above it shows down there - ocean.js)
  update(t, camera, pr = 1, deep = false) {
    for (const m of this.all) m.visible = this.on !== false && !deep;
    this.lights.material.uniforms.pr.value = pr;
  }
}

// the stone-metal: near black, a green-grey patina streaking down it, a pale salt crust low down and a dark wet band at
// the sea; the fittings (conduits, gallery, girders) a dark bronze gone to verdigris; the veins in the flutes: most
// dead, a few alive, cyan pulses running up them slowly; the nodes glowing, breathing
function alienMaterial(skyCube) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE_U, { apSky: { value: skyCube } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float kind; attribute vec3 aux; varying float vKind; varying vec3 vAux, vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vKind = kind; vAux = aux; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float lTime; uniform samplerCube apSky;
varying float vKind; varying vec3 vAux, vWP;
float apH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float apN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(apH(i), apH(i + vec3(1, 0, 0)), f.x), mix(apH(i + vec3(0, 1, 0)), apH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(apH(i + vec3(0, 0, 1)), apH(i + vec3(1, 0, 1)), f.x), mix(apH(i + vec3(0, 1, 1)), apH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
vec3 apGlow = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = vWP;
    float n = apN(p * 0.05) * 0.6 + apN(p * 0.23) * 0.4;
    float streak = apN(vec3(p.x * 0.18, p.y * 0.006, p.z * 0.18)) * 0.75 + apN(p * vec3(0.7, 0.03, 0.7)) * 0.25;
    vec3 c;
    if (vKind < 0.5) {
      c = mix(vec3(0.05, 0.055, 0.06), vec3(0.09, 0.1, 0.1), n);
      c = mix(c, vec3(0.07, 0.12, 0.11), smoothstep(0.5, 0.8, streak) * 0.8);                       // (the patina)
      c = mix(c, vec3(0.3, 0.31, 0.29), smoothstep(45.0, 6.0, p.y) * smoothstep(0.35, 0.65, n) * 0.7);  // (the salt)
      c *= mix(0.45, 1.0, smoothstep(${(SEA_Y - 1).toFixed(1)}, ${(SEA_Y + 7).toFixed(1)}, p.y));
      // the veins: down the middle of each flute, alive in some segments only, a pulse climbing them every so often
      float fl = 1.0 - abs(sin(vAux.x * 0.5)), above = step(${SEA_Y.toFixed(1)}, p.y);
      float line = smoothstep(0.02, 0.0, fl), halo = smoothstep(0.16, 0.0, fl);
      float seg = floor(vAux.y / 45.0), alive = step(0.6, apH(vec3(seg, floor(vAux.x / 6.2832 + 0.5), vAux.z)));
      float pulse = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(vAux.y * 0.015 - lTime * 0.7 + vAux.z), 6.0);
      // (a vein's light on the stone round it; and every fourth collar - where it is alive - a ring of it)
      float ring = smoothstep(0.35, 0.0, abs(fract(vAux.y / 180.0 + vAux.z) - 0.5) * 2.0 * 90.0 / 6.0 - 0.0) * step(0.55, apH(vec3(floor(vAux.y / 180.0 + vAux.z), 3.0, vAux.z)));
      apGlow = vec3(0.08, 0.75, 0.95) * above * ((line * 1.7 + halo * 0.12) * alive * pulse + line * 0.05 + ring * 0.5 * (0.6 + 0.4 * pulse));
    } else if (vKind < 1.5) {
      c = mix(vec3(0.09, 0.07, 0.05), vec3(0.06, 0.12, 0.1), smoothstep(0.4, 0.75, streak));
      c *= 0.8 + 0.4 * n;
      c *= mix(0.5, 1.0, smoothstep(${(SEA_Y - 1).toFixed(1)}, ${(SEA_Y + 7).toFixed(1)}, p.y));
    } else {
      c = vec3(0.05, 0.3, 0.36);
      apGlow = vec3(0.3, 1.6, 2.0) * (0.7 + 0.3 * sin(lTime * 0.6 + vAux.z));
    }
    diffuseColor.rgb = c;
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vKind > 1.5 ? 0.2 : vKind > 0.5 ? 0.55 : 0.8;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vKind > 0.5 && vKind < 1.5 ? 0.6 : 0.1;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += apGlow;')
      // (into the cloud: the sky behind it, in the way it is seen, taken over through drifting wisps - none of it from
      // under the sea's surface)
      .replace('#include <fog_fragment>', `{
    float wisp = apN(vec3(vWP.x * 0.004, vWP.y * 0.0025 - lTime * 0.01, vWP.z * 0.004)) * 0.65 + apN(vWP * 0.013 + lTime * 0.02) * 0.35;
    float up = smoothstep(${FADE0.toFixed(1)}, ${FADE1.toFixed(1)}, vWP.y + (wisp - 0.5) * 700.0);
    vec3 dir = normalize(vWP - cameraPosition);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, textureLod(apSky, vec3(dir.x, abs(dir.y), dir.z), 1.0).rgb, up);
  }
  #include <fog_fragment>`);
  };
  m.customProgramCacheKey = () => 'alien-pillar';
  return m;
}

// the nodes' glow, seen from far off: soft points breathing slowly (each its own phase), through the mist and the sea
// as everything else, gone into the cloud as the pillars are; never under two pixels
function glowPoints(list) {
  const P = new Float32Array(list.length * 3), A = new Float32Array(list.length * 2);
  list.forEach(([p, size, ph], i) => { P.set([p.x, p.y, p.z], i * 3); A.set([size, ph], i * 2); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aL', new THREE.BufferAttribute(A, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { lTime: LIFE_U.lTime, pr: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float lTime, pr; attribute vec2 aL; varying vec3 vC;
      ${SEA_GLSL}
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        float px = 14.0 * aL.x * pr * projectionMatrix[1][1] * 360.0 / max(d, 1.0);
        gl_PointSize = clamp(px, 2.5, 64.0);
        float breathe = 0.55 + 0.45 * sin(lTime * 0.6 + aL.y * 6.2832);
        vC = vec3(0.25, 1.4, 1.8) * breathe * min(1.0, px / 2.5) * seFogT(cameraPosition, position, ${SEA_Y.toFixed(1)}) * (1.0 - smoothstep(${(FADE0 + 200).toFixed(1)}, ${(FADE1 - 300).toFixed(1)}, position.y));
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 3.0), 1.0); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
