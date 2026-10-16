// The old power line round the ocean circuit: a ring of colossal lattice towers striding over the sea round the whole
// track, a kilometre tall, carrying sagging cables from one to the next. Riveted steel gone to rust, a few braces fallen out;
// each leg on a concrete caisson standing out of the sea and going down into the dark; three cross-arms with insulator
// strings hanging off their tips, the cables hung from those; a maintenance deck at the waist with a hut and a sodium
// lamp; microwave relay dishes on some, facing along the line to the next; red warning lamps on the peaks and the arm
// tips pulsing slowly, none in time with another. One conductor has snapped: its two ends hang down into the sea.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { SEA_Y, SEA_GLSL } from './sea.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
export const PYLON_H = 1000;                     // a tower's height over the sea (m)
const BASE = 28;                                 // the caissons' tops, where the legs stand
const W0 = 105, W1 = 26, WAIST = 0.6 * PYLON_H;  // the half-width at the foot, above the waist; the waist's height
const ARMS = [[0.66, 205], [0.78, 178], [0.9, 150]];   // the cross-arms: height (of H), reach from the axis (m)
const INSUL = 34;                                // an insulator string's length (m)
const K_STEEL = 0, K_CONC = 1, K_INSUL = 2, K_DISH = 3, K_HUT = 4;

// the half-width of the tower at height y: a long taper to the waist, straight above it
const halfW = (y) => (y < WAIST ? W1 + (W0 - W1) * Math.pow(1 - (y - BASE) / (WAIST - BASE), 1.35) : W1);

// a builder of flat-shaded pieces: positions, normals and each vertex's kind
class Kit {
  constructor() { this.P = []; this.N = []; this.K = []; this.I = []; }
  // a flat face (its corners in order round it), turned to face n
  quad(a, b, c, d, n, k) {
    const o = this.P.length / 3;
    for (const p of [a, b, c, d]) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.K.push(k); }
    const f = b.clone().sub(a).cross(c.clone().sub(a)).dot(n) >= 0;
    this.I.push(...(f ? [o, o + 1, o + 2, o, o + 2, o + 3] : [o, o + 2, o + 1, o, o + 3, o + 2]));
  }
  // a square-section bar from a to b, t thick (its faces square to 'side' where it can)
  bar(a, b, t, k = K_STEEL, side = V(0, 1, 0)) {
    const d = b.clone().sub(a), L = d.length();
    if (L < 1e-3) return;
    d.divideScalar(L);
    let u = side.clone().addScaledVector(d, -side.dot(d));
    if (u.lengthSq() < 1e-4) u = V(1, 0, 0).addScaledVector(d, -d.x);
    if (u.lengthSq() < 1e-4) u = V(0, 0, 1).addScaledVector(d, -d.z);
    u.normalize();
    const v = d.clone().cross(u).normalize(), h = t / 2;
    const c = (p, su, sv) => p.clone().addScaledVector(u, su * h).addScaledVector(v, sv * h);
    // (its four faces, each between two corners round it)
    const R = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [s0, t0] = R[i], [s1, t1] = R[(i + 1) % 4];
      const n = u.clone().multiplyScalar(s0 + s1).addScaledVector(v, t0 + t1).normalize();
      this.quad(c(a, s0, t0), c(a, s1, t1), c(b, s1, t1), c(b, s0, t0), n, k);
    }
  }
  // a cylinder (or cone) from a to b, radii r0 / r1, its round faces smooth
  cyl(a, b, r0, r1, segs, k, caps = false) {
    const d = b.clone().sub(a).normalize();
    const u = Math.abs(d.y) < 0.9 ? V(0, 1, 0).cross(d).normalize() : V(1, 0, 0).cross(d).normalize(), v = d.clone().cross(u);
    const o = this.P.length / 3, slope = (r0 - r1) / Math.max(1e-3, a.distanceTo(b));
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * TAU, n = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
      const nn = n.clone().addScaledVector(d, slope).normalize();
      for (const [p, r] of [[a, r0], [b, r1]]) { const q = p.clone().addScaledVector(n, r); this.P.push(q.x, q.y, q.z); this.N.push(nn.x, nn.y, nn.z); this.K.push(k); }
    }
    for (let i = 0; i < segs; i++) { const q = o + i * 2; this.I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    if (caps) for (const [p, r, s] of [[a, r0, -1], [b, r1, 1]]) {
      const c0 = this.P.length / 3, n = d.clone().multiplyScalar(s);
      this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.K.push(k);
      for (let i = 0; i <= segs; i++) { const th = (i / segs) * TAU, q = p.clone().addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r); this.P.push(q.x, q.y, q.z); this.N.push(n.x, n.y, n.z); this.K.push(k); }
      for (let i = 0; i < segs; i++) this.I.push(...(s > 0 ? [c0, c0 + 1 + i, c0 + 2 + i] : [c0, c0 + 2 + i, c0 + 1 + i]));
    }
  }
  // a box, centre c, half-sizes h, turned by the frame (x, z)
  box(c, h, x, z, k) {
    const y = z.clone().cross(x).normalize();
    const p = (sx, sy, sz) => c.clone().addScaledVector(x, sx * h.x).addScaledVector(y, sy * h.y).addScaledVector(z, sz * h.z);
    const f = (n, a, b, cc, d) => this.quad(a, b, cc, d, n, k);
    f(x, p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
    f(x.clone().negate(), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1));
    f(y, p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1));
    f(y.clone().negate(), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
    f(z, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
    f(z.clone().negate(), p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('kind', new THREE.Float32BufferAttribute(this.K, 1));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

// one tower at c, its arms along 'out' (horizontal, unit), the line running along 'along'; dishes facing 'next' / 'prev'
// (unit, horizontal) if it carries them. Returns the arms' cable points (world) and its lamps
function tower(kit, c, out, rnd, { dishes = null } = {}) {
  const up = V(0, 1, 0), side = up.clone().cross(out).normalize();   // (out: x across the line, side: z along it)
  const at = (x, y, z) => c.clone().addScaledVector(out, x).addScaledVector(up, y).addScaledVector(side, z);
  const lamps = [], cables = [];
  const thick = (y) => 2.4 + 3.2 * (halfW(y) / W0);
  // ---- the caissons: one under each leg, out of the sea and down into the dark; a lip round each top
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = at(sx * W0, 0, sz * W0);
    kit.cyl(V(p.x, SEA_Y - 170, p.z), V(p.x, BASE - 2, p.z), 25, 22, 28, K_CONC);
    kit.cyl(V(p.x, BASE - 3, p.z), V(p.x, BASE, p.z), 25, 25, 28, K_CONC, true);
  }
  // ---- the body: the levels, a panel about as tall as it is wide
  const ys = [BASE];
  while (ys[ys.length - 1] < PYLON_H - 70) { const y = ys[ys.length - 1]; ys.push(Math.min(PYLON_H - 60, y + Math.min(46, Math.max(14, 1.1 * halfW(y))))); }
  const corner = (y, sx, sz) => at(sx * halfW(y), y, sz * halfW(y));
  const C4 = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i], t = thick(y);
    // the girts round each level
    for (let k = 0; k < 4; k++) { const [ax, az] = C4[k], [bx, bz] = C4[(k + 1) % 4]; kit.bar(corner(y, ax, az), corner(y, bx, bz), t * 0.45); }
    if (i % 3 === 1) for (const [ax, az] of [[1, 1], [1, -1]]) kit.bar(corner(y, ax, az), corner(y, -ax, -az), t * 0.35);   // (plan bracing)
    if (i === ys.length - 1) break;
    const y2 = ys[i + 1];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = C4[k], [bx, bz] = C4[(k + 1) % 4];
      // the leg up to the next level
      kit.bar(corner(y, ax, az), corner(y2, ax, az), t, K_STEEL, V(ax, 0, az));
      // the face's bracing: an X (a few fallen out over the years); wide panels low down braced to their middles too
      const a0 = corner(y, ax, az), b0 = corner(y, bx, bz), a1 = corner(y2, ax, az), b1 = corner(y2, bx, bz);
      if (rnd() > 0.05) kit.bar(a0, b1, t * 0.4);
      if (rnd() > 0.05) kit.bar(b0, a1, t * 0.4);
      if (halfW(y) > 55) {
        const m0 = a0.clone().lerp(b0, 0.5), m1 = a1.clone().lerp(b1, 0.5), mm = m0.clone().lerp(m1, 0.5);
        kit.bar(a0.clone().lerp(a1, 0.5), b0.clone().lerp(b1, 0.5), t * 0.35);
        kit.bar(m0, mm, t * 0.3); kit.bar(mm, m1, t * 0.3);
      }
    }
  }
  // ---- the peak: a pyramid from the body's top to a short mast, a red lamp on it
  const yt = ys[ys.length - 1], apex = at(0, PYLON_H, 0);
  for (const [sx, sz] of C4) kit.bar(corner(yt, sx, sz), apex, thick(yt) * 0.8);
  kit.bar(apex, at(0, PYLON_H + 26, 0), 1.6);
  lamps.push([at(0, PYLON_H + 27, 0), 0]);
  cables.push({ key: 'peak', p: at(0, PYLON_H, 0) });
  // ---- the cross-arms: triangular trusses out either side, insulator strings off their tips
  for (const [fy, L] of ARMS) {
    const y = fy * PYLON_H, w = halfW(y);
    for (const s of [-1, 1]) {
      const root = (dz) => at(s * w, y, dz), tip = at(s * L, y + 3, 0), top0 = at(s * w, y + 24, 0);
      const n = 8, bot = (f, dz) => at(s * (w + (L - w) * f), y + 3 * f, dz * (1 - f) + Math.sign(dz) * 2.5 * f);
      const topAt = (f) => top0.clone().lerp(tip, f);
      kit.bar(root(-w), bot(1, -w), 2.4); kit.bar(root(w), bot(1, w), 2.4); kit.bar(top0, tip, 2.0);
      for (let k = 0; k <= n; k++) {
        const f = k / n, f2 = (k + 0.5) / n;
        kit.bar(bot(f, -w), bot(f, w), 1.1);
        if (k < n) { kit.bar(bot(f, -w), topAt(f2), 1.0); kit.bar(bot(f, w), topAt(f2), 1.0); kit.bar(topAt(f2), bot(f + 1 / n, -w), 1.0); kit.bar(topAt(f2), bot(f + 1 / n, w), 1.0); }
      }
      // the insulator string: a rod and its discs, hanging from the tip
      const hang = at(s * L, y + 3, 0), low = at(s * L, y + 3 - INSUL, 0);
      kit.bar(hang, low, 0.7, K_INSUL);
      for (let k = 1; k <= 14; k++) { const q = hang.clone().lerp(low, k / 15); kit.cyl(q.clone().addScaledVector(up, 0.5), q.clone().addScaledVector(up, -0.5), 2.3, 1.6, 10, K_INSUL, true); }
      kit.cyl(low, low.clone().addScaledVector(up, -2.2), 1.4, 1.4, 8, K_STEEL, true);       // (the clamp)
      lamps.push([at(s * L, y + 4.5, 0), 0]);
      cables.push({ key: `${fy}:${s}`, p: low.clone().addScaledVector(up, -2) });
    }
  }
  // ---- the maintenance deck at the waist: a floor round the body, a rail, a hut, a sodium lamp by its door
  {
    const y = WAIST + 1, w = W1 + 12;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = C4[k], [bx, bz] = C4[(k + 1) % 4];
      const a = at(ax * w, y, az * w), b = at(bx * w, y, bz * w), ai = at(ax * (W1 - 1), y, az * (W1 - 1)), bi = at(bx * (W1 - 1), y, bz * (W1 - 1));
      const mid = a.clone().lerp(bi, 0.5).lerp(b.clone().lerp(ai, 0.5), 0.5), ex = b.clone().sub(a).normalize(), ez = ai.clone().sub(a).setY(0).normalize();
      kit.box(mid.setY(y - 0.6), V(a.distanceTo(b) / 2, 0.6, 6.5), ex, ez.addScaledVector(ex, -ez.dot(ex)).normalize(), K_STEEL);   // (the deck's floor)
      for (let j = 0; j <= 8; j++) { const p = a.clone().lerp(b, j / 8); kit.bar(p, p.clone().addScaledVector(up, 1.3), 0.25); }
      kit.bar(a.clone().addScaledVector(up, 1.3), b.clone().addScaledVector(up, 1.3), 0.25);
    }
    const hc = at(0, y + 3.5, W1 + 6.5);
    kit.box(hc, V(5, 3, 3.5), out, side, K_HUT);
    lamps.push([at(-3, y + 5.2, W1 + 10.2), 1]);
  }
  // ---- a red lamp on each leg partway up
  for (let y = 150; y < PYLON_H - 80; y += 150) for (const [sx, sz] of [[1, 1], [-1, -1]]) { const w = halfW(y) + thick(y) * 0.45; lamps.push([at(sx * w, y, sz * w), 0]); }
  // the floodlights: one on each caisson's lip, turned up the leg (their light on the steel: the material)
  for (const [sx, sz] of C4) { const p = at(sx * (W0 + 14), BASE + 1.2, sz * (W0 + 14)); kit.box(p, V(1.6, 1.2, 1.6), out, side, K_STEEL); lamps.push([p.clone().addScaledVector(up, 1.8), 1]); }
  // ---- the relay dishes: on booms off the body's face, each looking along the line to the next tower
  if (dishes) for (const [dir, y] of dishes) {
    const face = Math.sign(dir.dot(side)) || 1, base = at(W1, y, face * W1), mount = base.clone().addScaledVector(dir, 9);
    kit.bar(base, mount, 1.4);
    const back = mount.clone().addScaledVector(dir, 2), rim = back.clone().addScaledVector(dir, 4);
    kit.cyl(back, rim, 2, 11, 24, K_DISH, true);                                        // (the dish's bowl, open toward dir)
    kit.bar(rim, rim.clone().addScaledVector(dir, 7), 0.6);                               // (the feed's arm)
    kit.cyl(rim.clone().addScaledVector(dir, 7), rim.clone().addScaledVector(dir, 8.5), 1.2, 1.2, 8, K_STEEL, true);
  }
  return { lamps, cables };
}

export class PowerLine {
  // track: to keep clear of (a tower never nearer than 'clear' m to it); avoid: [{ x, z, r }] other things to keep off
  constructor(scene, track, { avoid = [], clear = 320 } = {}) {
    const rnd = mulberry32(8080), f = {};
    // the track's plan, to keep the towers off it
    const pts = [];
    for (let s = 0; s < track.length; s += 25) { track.frame(s, f); pts.push([f.P.x, f.P.z]); }
    let mx = [1e9, -1e9], mz = [1e9, -1e9];
    for (const [x, z] of pts) { mx = [Math.min(mx[0], x), Math.max(mx[1], x)]; mz = [Math.min(mz[0], z), Math.max(mz[1], z)]; }
    const cx = (mx[0] + mx[1]) / 2, cz = (mz[0] + mz[1]) / 2, rx = (mx[1] - mx[0]) / 2 + 380, rz = (mz[1] - mz[0]) / 2 + 420;
    const near = (x, z) => Math.min(...pts.map(([a, b]) => Math.hypot(a - x, b - z)));
    // the ring: eight towers on an ellipse round it all, pushed out wherever one comes too near the track or a landmark
    const N = 8, spots = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + 0.2;
      let r = 1;
      for (let i = 0; i < 40; i++) {
        const x = cx + Math.cos(a) * rx * r, z = cz + Math.sin(a) * rz * r;
        if (near(x, z) > clear + W0 && avoid.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + W0 + 60)) break;
        r += 0.03;
      }
      spots.push(V(cx + Math.cos(a) * rx * r, SEA_Y, cz + Math.sin(a) * rz * r));
    }
    // each tower's arms across the line: along the bisector of its two spans' crossings (the ring's outward way)
    const kit = [], all = [];
    this.lampList = [];
    spots.forEach((c, k) => {
      const prev = spots[(k + N - 1) % N], next = spots[(k + 1) % N];
      const tIn = c.clone().sub(prev).setY(0).normalize(), tOut = next.clone().sub(c).setY(0).normalize();
      const along = tIn.clone().add(tOut).normalize(), out = V(0, 1, 0).cross(along).normalize();
      const K = new Kit();
      const dishes = k % 3 === 0 ? [[tOut, 0.84 * PYLON_H], [tIn.clone().negate(), 0.8 * PYLON_H]] : null;
      const t = tower(K, c, out, rnd, { dishes });
      kit.push(K);
      all.push({ c, out, cables: t.cables });
      for (const [p, warm] of t.lamps) this.lampList.push([p, warm, rnd()]);
    });
    // ---- the steel: one mesh a tower (each culled on its own)
    this.mat = steelMaterial();
    this.meshes = kit.map((K, k) => {
      const m = new THREE.Mesh(K.geometry(), this.mat);
      m.name = 'pylon';
      m.layers.set(2);
      scene.add(m);
      return m;
    });
    // ---- the cables: from each tower to the next, the same point to the same point (outer to outer); one span's
    // middle conductor snapped - its ends hanging into the sea
    const cab = [];
    const snapped = 3;
    for (let k = 0; k < N; k++) {
      const A = all[k], B = all[(k + 1) % N];
      for (const ca of A.cables) {
        const cb = B.cables.find((q) => q.key === ca.key);
        if (!cb) continue;
        // (outer to outer: the arms point out of the ring on both towers - matched by their key, side and height)
        const span = ca.p.distanceTo(cb.p), sag = 0.055 * span;
        if (k === snapped && ca.key === `${ARMS[1][0]}:1`) {
          cab.push(hanging(ca.p, cb.p.clone().sub(ca.p).setY(0).normalize()), hanging(cb.p, ca.p.clone().sub(cb.p).setY(0).normalize()));
          continue;
        }
        const line = [];
        for (let i = 0; i <= 72; i++) { const t = i / 72; line.push(ca.p.clone().lerp(cb.p, t).addScaledVector(V(0, 1, 0), -sag * 4 * t * (1 - t))); }
        cab.push(line);
      }
    }
    this.cableU = { pxA: { value: 0.001 } };
    this.cables = new THREE.Mesh(cableGeometry(cab, 0.9), cableMaterial(this.cableU));
    this.cables.name = 'pylon-cables';
    this.cables.layers.set(2);
    this.cables.frustumCulled = false;
    scene.add(this.cables);
    // ---- the lamps
    this.lamps = lampPoints(this.lampList);
    this.lamps.name = 'pylon-lamps';
    this.lamps.layers.set(2);
    scene.add(this.lamps);
    this.spots = spots;
    this.all = [...this.meshes, this.cables, this.lamps];
    console.info(`power line: ${N} towers, ${cab.length} cables, ${this.meshes.reduce((n, m) => n + m.geometry.index.count / 3, 0)} triangles`);
  }

  setOn(on) { this.on = on; for (const m of this.all) m.visible = on; }

  // every frame: how wide a pixel is (the cables never thinner than one), the time (the lamps); not drawn from deep in
  // the sea (deep: nothing above the sea shows down there - ocean.js)
  update(t, camera, pr = 1, deep = false) {
    for (const m of this.all) m.visible = this.on !== false && !deep;
    this.cableU.pxA.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, window.innerHeight * pr);
    this.lamps.material.uniforms.time.value = t;
    this.lamps.material.uniforms.pr.value = pr;
  }
}

// a snapped conductor's end: from its clamp down into the sea, swinging out a little the way it used to run
function hanging(p, dir) {
  const line = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    line.push(p.clone().addScaledVector(dir, 70 * Math.sin(t * Math.PI * 0.5) * (1 - 0.4 * t)).setY(p.y + (SEA_Y - 6 - p.y) * Math.pow(t, 1.15)));
  }
  return line;
}

// the cables as tubes round their lines; each vertex knows its line's point (to widen to a pixel far off)
function cableGeometry(lines, r) {
  const P = [], C = [], N = [], I = [], S = 6;
  for (const line of lines) {
    const o = P.length / 3;
    line.forEach((p, i) => {
      const d = line[Math.min(i + 1, line.length - 1)].clone().sub(line[Math.max(i - 1, 0)]).normalize();
      const u = Math.abs(d.y) < 0.95 ? V(0, 1, 0).cross(d).normalize() : V(1, 0, 0).cross(d).normalize(), v = d.clone().cross(u);
      for (let j = 0; j < S; j++) {
        const th = (j / S) * TAU, n = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
        P.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r); C.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z);
      }
    });
    for (let i = 0; i < line.length - 1; i++) for (let j = 0; j < S; j++) {
      const a = o + i * S + j, b = o + i * S + (j + 1) % S, c = a + S, e = b + S;
      I.push(a, b, c, b, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aCtr', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

// a cable: dark, never drawn thinner than a pixel - wider and fainter instead (thinner, the far spans crawled)
function cableMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.6, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aCtr; uniform float pxA; varying float vCov;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
  {
    float r = length(position - aCtr), want = distance(aCtr, cameraPosition) * pxA * 0.6;
    float rr = max(r, want);
    transformed = aCtr + (position - aCtr) * (rr / max(r, 1e-4));
    vCov = r / rr;
  }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCov;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vCov;');
  };
  m.customProgramCacheKey = () => 'pylon-cable';
  return m;
}

// the steel: old paint (a dull oxide red-grey) gone to rust in streaks running down from the joints, darker low down
// where the spray reaches; the concrete stained by the tide - a dark band at the water, weed-black under it; the
// insulators dark glass; the dishes a faded white, rust-streaked; the huts corrugated rust
function steelMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.25 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float kind; varying float vKind; varying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vKind = kind; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vKind; varying vec3 vWP;
float plH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float plN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(plH(i), plH(i + vec3(1, 0, 0)), f.x), mix(plH(i + vec3(0, 1, 0)), plH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(plH(i + vec3(0, 0, 1)), plH(i + vec3(1, 0, 1)), f.x), mix(plH(i + vec3(0, 1, 1)), plH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = vWP;
    float n = plN(p * 0.08) * 0.6 + plN(p * 0.31) * 0.4;
    float streak = plN(vec3(p.x * 0.6, p.y * 0.012, p.z * 0.6)) * 0.7 + plN(p * vec3(1.4, 0.05, 1.4)) * 0.3;
    float rust = smoothstep(0.45, 0.8, streak * 0.7 + n * 0.5);
    vec3 c;
    if (vKind < 0.5) {
      c = mix(vec3(0.13, 0.085, 0.07), vec3(0.2, 0.19, 0.18), smoothstep(0.3, 0.7, n));                  // the paint
      c = mix(c, vec3(0.24, 0.1, 0.04), rust);                                                         // the rust
      c *= 0.75 + 0.25 * smoothstep(${SEA_Y.toFixed(1)}, 120.0, p.y);                                    // (the spray's grime)
    } else if (vKind < 1.5) {
      c = vec3(0.26, 0.25, 0.23) * (0.8 + 0.3 * n);
      c = mix(c, vec3(0.13, 0.08, 0.05), rust * 0.6 * smoothstep(30.0, 10.0, p.y));
      c *= mix(0.35, 1.0, smoothstep(${(SEA_Y - 1).toFixed(1)}, ${(SEA_Y + 9).toFixed(1)}, p.y));
      c = mix(c, vec3(0.03, 0.04, 0.03), smoothstep(${(SEA_Y + 1).toFixed(1)}, ${(SEA_Y - 3).toFixed(1)}, p.y));
    } else if (vKind < 2.5) {
      c = vec3(0.06, 0.08, 0.07);
    } else if (vKind < 3.5) {
      c = mix(vec3(0.42, 0.42, 0.4), vec3(0.22, 0.12, 0.06), rust * 0.8);
    } else {
      c = mix(vec3(0.2, 0.09, 0.04), vec3(0.12, 0.11, 0.1), n) * (0.85 + 0.3 * step(0.5, fract(p.y * 2.0 + p.x * 0.2)));
    }
    diffuseColor.rgb = c;
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // (the floodlights on the caissons, lighting the steel above them a dull sodium orange, fading up the legs)
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.6, 0.85, 0.35) * exp(-max(vWP.y - ${BASE.toFixed(1)}, 0.0) / 95.0) * (vKind < 0.5 ? 1.0 : vKind < 1.5 ? 0.4 : 0.0);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vKind > 1.5 && vKind < 2.5 ? 0.2 : vKind > 0.5 && vKind < 1.5 ? 0.95 : 0.8;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vKind < 0.5 || vKind > 3.5 ? 0.35 : 0.0;');
  };
  m.customProgramCacheKey = () => 'pylon-steel';
  return m;
}

// the lamps: red warning lamps pulsing slowly (each its own phase: old, unsynchronized), the sodium lamps steady;
// through the mist and the sea as everything else; never under a pixel and a half
function lampPoints(list) {
  const P = new Float32Array(list.length * 3), A = new Float32Array(list.length * 2);
  list.forEach(([p, warm, ph], i) => { P.set([p.x, p.y, p.z], i * 3); A.set([warm, ph], i * 2); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aL', new THREE.BufferAttribute(A, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pr: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float time, pr; attribute vec2 aL; varying vec3 vC;
      ${SEA_GLSL}
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        float px = 3.5 * pr * projectionMatrix[1][1] * 360.0 / max(d, 1.0);            // (a lamp ~3.5 m across)
        gl_PointSize = clamp(px, 2.0, 40.0);
        float pulse = aL.x > 0.5 ? 1.0 : 0.25 + 0.75 * pow(0.5 + 0.5 * sin(time * 2.4 + aL.y * 6.2832), 2.0);
        vec3 col = aL.x > 0.5 ? vec3(2.6, 1.5, 0.55) : vec3(3.4, 0.25, 0.12);
        vC = col * pulse * min(1.0, px / 2.0) * seFogT(cameraPosition, position, ${SEA_Y.toFixed(1)});
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 3.5), 1.0); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
