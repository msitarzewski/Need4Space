// The derelict's zones (wreck.js builds the hulls, the materials and the culling; this file what is in and on them),
// each built round the way through it (wreckplan.js): its pieces' own coordinates - x to starboard, y up, z aft.
//  - the track's supports inside: a cross-head under its girders every ~100 m, a column to the deck below (or to the
//    roof when the way runs upside down), braced, an emergency lamp at each end;
//  - the stern piece: the main engine's bell the way flies into, its throat through the engine block, the outer bells;
//    the reactor hall - the core, still burning in its containment rings, arcing to the conductors round it, coolant
//    lines and pumps; the machinery hall's dead generator drums (one over the way, one under it), flywheels, conduits;
//    the ruptured fore end, decks hanging out of it into the sun;
//  - the middle piece, the fore piece's holds and hangar, the graveyard, the trench on its back, the command tower.
// No text, numbers, signs or markings anywhere.
import * as THREE from 'three';
import { smoothstep, clamp, noise2 } from './noise.js';
import { K_HULL, K_INNER, K_FRAME, K_MACH, K_TORN, K_DECK, K_LAMP, PAINT_HULL, PAINT_INNER, PAINT_FRAME, PAINT_TORN, PAINT_MACH,
  PAINT_CLAMP, LAMP } from './wreck.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const F = (o, ax = V(1, 0, 0), ay = V(0, 1, 0), az = V(0, 0, 1)) => ({ o, ax, ay, az });
const TAU = Math.PI * 2;
const TRACK_HALF = 28;
// paints (linear albedo): dark, worn, each kind of thing a little its own
const P = {
  deck: [0.06, 0.06, 0.058], pylon: [0.055, 0.058, 0.062], pipe: [0.06, 0.055, 0.05], pipe2: [0.075, 0.05, 0.035],
  cable: [0.02, 0.02, 0.022], bell: [0.09, 0.082, 0.075], nozzle: [0.045, 0.04, 0.036], reactor: [0.034, 0.036, 0.04],
  drum: [0.07, 0.068, 0.062], hazard: [0.12, 0.08, 0.02], soot: [0.02, 0.018, 0.016], crane: [0.12, 0.09, 0.025],
};

export function buildZones(w) {
  const z = new Zones(w);
  z.decks();
  z.supports();
  z.engine();
  z.reactor();
  z.machinery();
  z.rupture();
  z.midPiece();
  z.holds();
  z.hangar();
  z.trench();
  z.tower();
  z.outside();
  z.graveyard();
  z.breakZone();
  z.sparks();
  z.windows();
  new Mist(w, w.aft, 600, w.aft.len - w.aft.block - 4, [-124, -104, -86]);
  new Beams(w, [w.aft, w.mid, w.fore, ...w.hulls.filter((h) => h.hulk?.how === 'through')]);
}

class Zones {
  constructor(w) {
    this.w = w;
    this.tr = w.track;
    this.R = w.rnd;
    this.great = [w.fore, w.mid, w.aft, ...w.hulls.filter((h) => h.hulk?.how === 'through')];
  }

  // the great piece the track is inside of at s (and that frame there), or null
  pieceAt(s, margin = 12) {
    for (const H of this.great) {
      const t = this.w.tl(H, s), k = H.k(t.p.z);
      if (t.p.z > 0 && t.p.z < H.len && Math.abs(t.p.x) < k * H.HW - margin && Math.abs(t.p.y) < k * H.HH - margin) return { H, t };
    }
    return null;
  }

  // the inner surface (in from the skin by the frames' depth) on a piece's floor or roof at x (y; sign -1 the floor)
  innerY(H, x, z, sign = -1, depth = H.SKIN + H.RIBD + 1) {
    const q = H.inset(H.k(z), depth);
    let best = sign * -1e9;
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8];
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const y = ay + (by - ay) * (x - ax) / (bx - ax);
      if (sign < 0 ? y < 0 && (best > 0 || y > best) : y > 0 && (best < 0 || y < best)) best = y;
    }
    return best;
  }

  // ---- the track's supports where it runs inside a great piece: every ~100 m a cross-head under its girders (or over
  // them, upside down), a column from its middle to the deck below (to the roof), two braces, a lamp at each end
  supports() {
    const w = this.w, tr = this.tr, o = { kind: K_FRAME, paint: P.pylon }, od = { ...o, layer: 'detail' };
    for (const [s0, s1] of tr.wrecks) {
      const len = tr.wrap(s1 - s0);
      for (let d = 30; d < len - 20; d += 104) {
        const s = s0 + d;
        if (tr.inGap(s, 24) || tr.inFlip(s, 50)) continue;
        const at = this.pieceAt(s);
        if (!at) continue;
        const { H, t } = at, down = t.U.y > 0 ? -1 : 1;          // (upside down: up to the roof)
        if (Math.abs(t.U.y) < 0.6) continue;
        const ch = t.p.clone().addScaledVector(t.U, -5.6);
        w.beam(H, ch.clone().addScaledVector(t.R, -36), ch.clone().addScaledVector(t.R, 36), 2.2, 1.8, t.U, o);
        const yEnd = down < 0 ? (this.floorAt(H, ch.x, ch.z) ?? this.innerY(H, ch.x, ch.z, -1)) : this.innerY(H, ch.x, ch.z, 1);
        const foot = V(ch.x, yEnd, ch.z), head = ch.clone().addScaledVector(t.U, -1.2);
        if (Math.abs(head.y - foot.y) > 8) {
          w.beam(H, foot, head, 3.4, 3.4, V(0, 0, 1), o);
          w.box(H, F(foot.clone().add(V(0, down < 0 ? 0.6 : -0.6, 0))), 5, 0.6, 5, o);
          const reach = Math.min(28, Math.abs(head.y - foot.y) * 0.4);
          for (const sd of [-1, 1]) w.beam(H, ch.clone().addScaledVector(t.R, sd * 20).addScaledVector(t.U, -0.8), V(ch.x, head.y + down * reach, ch.z), 1.2, 1.2, V(0, 0, 1), o);
          // service rungs up the column
          for (let y = Math.min(foot.y, head.y) + 4; y < Math.max(foot.y, head.y) - 3; y += 6) w.box(H, F(V(ch.x + 1.9, y, ch.z)), 0.1, 0.1, 0.9, od);
        }
        for (const sd of [-1, 1]) w.lamp(H, ch.clone().addScaledVector(t.R, sd * 34.5).addScaledVector(t.U, 1.2), t.U.clone().multiplyScalar(0.6).addScaledVector(t.R, -sd * 0.8), (Math.round(d / 104) + (sd > 0 ? 1 : 0)) % 3 ? 'red' : 'amber');
      }
    }
  }

  // the pieces' decks (first: the track's columns stand on them)
  decks() {
    const w = this.w;
    this.floor(w.aft, 1000, w.aft.len - w.aft.block - 2, -150);
    this.floor(w.aft, 590, 1000, -150, 0.08);
    this.floor(w.mid, 30, w.mid.len - 30, -150, 0.3);
    this.floor(w.fore, 1240, w.fore.len - 30, -150, 0.06);
    this.floor(w.fore, 560, 1240, -150, 0.03);
  }

  // the deck plates' top at x, z of a piece (a deck built by floor()), or undefined
  floorAt(H, x, z) {
    for (const f of H.floors || []) if (z > f.z0 && z < f.z1 && Math.abs(x) < f.xr && (!f.has || f.has(x, z))) return f.y + 0.35;
    return undefined;
  }

  // A deck across a piece: plates 32 m along (frame to frame) by ~40 m across on transverse beams; torn away where the
  // hull is open beside it, a few missing (each `gone` its own chance), none where the way passes
  floor(H, z0, z1, y, gone = 0.05) {
    const w = this.w, R = this.R, q = H.inset(1, H.SKIN + H.RIBD + 0.5);
    let xr = 1e9;                                               // its half width at y: where the inner surface is
    for (let i = 0; i < 8; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8]; if ((ay - y) * (by - y) <= 0 && ay !== by) xr = Math.min(xr, Math.abs(ax + (bx - ax) * (y - ay) / (by - ay))); }
    const n = Math.max(4, Math.round((2 * xr) / 40)), wx = (2 * xr) / n, rib = H.RIB, first = Math.ceil((z0 - H.ribFrom) / rib) * rib + H.ribFrom;
    const set = new Set(), beams = new Set();
    for (let z = first; z <= z1; z += rib) for (let k = 0; k < n; k++) {
      const xa = -xr + k * wx, xc = xa + wx / 2;
      if (!w.free(H, V(xc, y - 1.5, z), wx / 2)) continue;
      beams.add(`${Math.round(z)}:${k}`);
      w.beam(H, V(xa, y - 1.6, z), V(xa + wx, y - 1.6, z), 1.6, 2.6, V(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
    }
    for (let z = first; z + rib <= z1; z += rib) for (let k = 0; k < n; k++) {
      const xa = -xr + k * wx, xc = xa + wx / 2, zc = z + rib / 2;
      const f = H.field(zc, Math.atan2(y, xc > 0 ? H.HW : -H.HW));
      if ((Math.abs(xc) > xr * 0.6 && f < 30) || R() < gone || !w.free(H, V(xc, y, zc), Math.max(wx, rib) / 2)) continue;
      if (!beams.has(`${Math.round(z)}:${k}`) || !beams.has(`${Math.round(z + rib)}:${k}`)) continue;
      set.add(`${Math.round(z)}:${k}`);
      w.box(H, F(V(xc, y, zc)), wx / 2 - 0.15, 0.35, rib / 2 - 0.15, { kind: K_DECK, paint: P.deck, b: 0.1 });
    }
    (H.floors ||= []).push({ z0, z1, xr, y, has: (x, z) => set.has(`${Math.round(Math.floor((z - H.ribFrom) / rib) * rib + H.ribFrom)}:${Math.floor((x + xr) / wx)}`) });
  }

  // emergency lamps on the frames down both walls of a stretch, every other frame, at height y (skipping holes)
  wallLamps(H, z0, z1, y, every = 2, cols = ['red', 'red', 'amber']) {
    let k = 0;
    for (let z = Math.ceil((z0 - H.ribFrom) / H.RIB) * H.RIB + H.ribFrom; z < z1; z += H.RIB * every) for (const sd of [-1, 1]) {
      const q = H.inset(H.k(z), H.SKIN + H.RIBD + 0.9), x = sd * this.halfWidth(q, y);
      if (H.field(z, Math.atan2(y, x)) < 20 * H.scale || !this.onFrame(H, q, z, x, y, 1.7)) continue;
      this.w.lamp(H, V(x, y, z), V(-sd, 0, 0), cols[k++ % cols.length], 1.2);
    }
  }
  // rings of small marker lights round the frames' flanges (every `every`-th frame), a light every ~22 m round: in the
  // dark the hall's shape is drawn by them, receding (no light of their own: only lit lenses, each failing its own way)
  markerRings(H, z0, z1, every = 4, col = 'red') {
    const w = this.w, c = (LAMP[col] || col).map((x) => x * 0.4);
    for (let z = Math.ceil((z0 - H.ribFrom) / (H.RIB * every)) * H.RIB * every + H.ribFrom; z < z1; z += H.RIB * every) {
      const q = H.inset(H.k(z), H.SKIN + H.RIBD + 0.6 + 0.3);
      for (let i = 0; i < 8; i++) {
        const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / 22));
        const nIn = V(-H.OCTN[i][0], -H.OCTN[i][1], 0), tA = V(bx - ax, by - ay, 0).normalize();
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          if (H.inRibCut(z, Math.atan2(y, x)) || H.field(z, Math.atan2(y, x)) < -40 * H.scale) continue;
          const bent = w.frameAt(H, z, i, t, 0.8 / L);           // (on a piece of frame still standing, not bent away)
          if (bent === null || bent > 0.15) continue;
          w.box(H, F(V(x, y, z), tA, nIn, V(0, 0, 1)), 0.7, 0.18, 0.28, { kind: K_LAMP, paint: c, seed: 20000 + (w.markers = (w.markers || 0) + 1), b: 0, layer: 'main' });
        }
      }
    }
  }

  // how far the plating at local point p (on it, or just off it) is bent outward near a hole's edge (Wreck.peel), as a
  // vector: what something set on the plate there must move by
  curl(H, p) {
    const ft = this.faceAt(H, p);
    if (!ft) return V(0, 0, 0);
    const info = {}, f = H.field(p.z, Math.atan2(p.y, p.x), info);
    return this.faceN(H, ft[0], p.z).multiplyScalar(this.w.peel(H, p.z, ft[1], f, info.which, ft[0]));
  }
  // the face of the octagon the line from the axis through local p crosses, and where along it (0..1): [face, t]
  faceAt(H, p) {
    const q = H.inset(H.k(p.z), 0);
    for (let face = 0; face < 8; face++) {
      const [ax, ay] = q[face], [bx, by] = q[(face + 1) % 8], ex = bx - ax, ey = by - ay;
      if (H.OCTN[face][0] * p.x + H.OCTN[face][1] * p.y <= 0) continue;
      const den = ex * p.y - ey * p.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = (p.x * ay - p.y * ax) / den;
      if (t >= 0 && t <= 1) return [face, t];
    }
    return null;
  }
  // a face's outward normal at z (the tapered nose's own)
  faceN(H, face, z) { return (H.taper > 0 && z < H.taper ? H.planes[8 + face].n : H.planes[face].n).clone(); }
  // a hanger's mount on the plating's inner face straight above (sign 1) or below (-1) local point b: [point, normal]
  plateMount(H, b, sign) {
    const m = V(b.x, this.innerY(H, b.x, b.z, sign, H.SKIN - 0.1), b.z), ft = this.faceAt(H, m);
    return [m.add(this.curl(H, m)), ft ? this.faceN(H, ft[0], m.z).negate() : V(0, -sign, 0)];
  }

  // the frame standing at (x, y) of inset octagon q at z (+-half m of it): not torn out, not bent away
  onFrame(H, q, z, x, y, half = 0) {
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8], L2 = (bx - ax) ** 2 + (by - ay) ** 2, t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2;
      if (t < 0 || t > 1 || Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y) > 0.05) continue;
      const bent = this.w.frameAt(H, z, i, t, half / Math.sqrt(L2));
      return bent !== null && bent <= 0.15;
    }
    return false;
  }

  // a flood: a big lamp (reaching ~280 m, lighting a hall) in a housing on a hanger, aimed along `out`; mount(back) is
  // where the hanger meets what holds it (default: straight up to the plating overhead)
  flood(H, p, out, col = 'amber', reach = 650, I = 1.2e6, mount = (b) => this.plateMount(H, b, 1)) {
    this.w.lamp(H, p, out, col, 2.6, { reach, I, area: 90, layer: 'main', mount });
  }

  halfWidth(q, y) {
    let xr = 1e9;
    for (let i = 0; i < 8; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8]; if ((ay - y) * (by - y) <= 0 && ay !== by) xr = Math.min(xr, Math.abs(ax + (bx - ax) * (y - ay) / (by - ay))); }
    return xr;
  }

  // ---- the stern: the main engine's bell (the way flies into its mouth and through its throat), four outer bells round
  // it on their gimbal rings, the thrust frame between them; inside the block, turbopumps round the bore
  engine() {
    const w = this.w, H = w.aft, L = H.len, h = H.sternHole;
    const bell = (c, prof, inner, o, a0 = 0, a1 = TAU) => {
      const Fb = F(c, V(1, 0, 0), V(0, 0, 1), V(0, -1, 0));
      w.lathe(H, Fb, prof, { kind: K_MACH, paint: P.bell, sky: 1, segs: 48, a0, a1, layer: 'shell', ...o });
      w.lathe(H, Fb, inner, { kind: K_MACH, paint: P.soot, sky: 0.25, soot: 0.7, segs: 48, a0, a1, layer: 'shell', ...o });
      return Fb;
    };
    // the main bell: from the throat at the stern to a mouth 150 m across, 220 m aft; a wedge of it torn away
    const r0 = h.r, len = 220, prof = [], inner = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12, r = r0 + 8 + (150 - r0 - 8) * Math.pow(t, 1.35); prof.push([r, 6 + t * len]); inner.unshift([r - 3.2, 6 + t * len]); }
    prof.unshift([r0 + 14, 0], [r0 + 10, 6]); prof.push([150 + 4, len + 6], [150 + 4, len + 8], [150 - 3.2, len + 8]);
    inner.unshift([150 - 3.2, len + 8]);
    const crack0 = 1.9, crack1 = 2.5;                            // (the torn wedge: below, to port)
    bell(V(h.x, h.y, L), prof, inner, {}, crack1, crack0 + TAU);
    // its cooling bands and the gimbal ring at the throat
    for (let k = 1; k <= 6; k++) {
      const t = k / 7, r = r0 + 8 + (150 - r0 - 8) * Math.pow(t, 1.35) + 1.5;
      w.lathe(H, F(V(h.x, h.y, L), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), [[r - 1.5, 6 + t * len - 1.6], [r + 1.4, 6 + t * len - 0.8], [r + 1.4, 6 + t * len + 0.8], [r - 1.5, 6 + t * len + 1.6]],
        { kind: K_FRAME, paint: PAINT_CLAMP, sky: 1, segs: 48, a0: crack1, a1: crack0 + TAU, layer: 'shell' });
    }
    w.lathe(H, F(V(h.x, h.y, L), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), [[r0 + 26, -2], [r0 + 26, 9], [r0 + 13, 9], [r0 + 13, -2]], { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 48, layer: 'shell' });
    // the torn wedge's edges: strips of bare metal along the tear
    for (const a of [crack0 + TAU, crack1]) for (let k = 0; k < 12; k++) {
      const t0 = k / 12, t1 = (k + 1) / 12, rr = (t) => r0 + 8 + (150 - r0 - 8) * Math.pow(t, 1.35) - 1.6;
      const p0 = V(h.x + Math.cos(a) * rr(t0), h.y - Math.sin(a) * rr(t0), L + 6 + t0 * len), p1 = V(h.x + Math.cos(a) * rr(t1), h.y - Math.sin(a) * rr(t1), L + 6 + t1 * len);
      w.beam(H, p0, p1, 3.4, 1.0, V(Math.cos(a), -Math.sin(a), 0), { kind: K_TORN, paint: PAINT_TORN, soot: 0.8, sky: 0.5, layer: 'main' });
    }
    // the outer bells: four round the main one, each on its gimbal and actuators; one hangs cracked
    for (const [bx, by, br, cracked] of [[-205, 90, 34, false], [205, 90, 34, true], [-200, -120, 30, false], [200, -120, 30, false]]) {
      const c = V(bx, by, L), Fb = F(c, V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), a0 = cracked ? 0.7 : 0, a1 = cracked ? TAU - 0.2 : TAU;
      w.lathe(H, Fb, [[br * 0.9, -4], [br * 0.95, 8]], { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 36, layer: 'shell' });
      w.lathe(H, Fb, [[br * 0.6, 8], [br * 0.55, 16], [br * 0.62, 26], [br * 0.9, 50], [br * 1.25, 90], [br * 1.55, 130], [br * 1.65, 150], [br * 1.7, 152]],
        { kind: K_MACH, paint: P.bell, sky: 1, segs: 40, a0, a1, layer: 'shell' });
      w.lathe(H, Fb, [[br * 1.66, 151.5], [br * 1.5, 128], [br * 1.2, 88], [br * 0.86, 49], [br * 0.58, 25]],
        { kind: K_MACH, paint: P.soot, sky: 0.5, soot: 0.6, segs: 40, a0, a1, layer: 'shell' });
      for (const yb of [60, 110]) { const rb = br * (yb < 80 ? 1.05 : 1.42) + 1; w.lathe(H, Fb, [[rb - 0.4, yb - 1.4], [rb + 1.4, yb], [rb - 0.4, yb + 1.4]], { kind: K_FRAME, paint: PAINT_CLAMP, sky: 1, segs: 40, a0, a1, layer: 'main' }); }
      // the actuators: two rams from the stern to its collar
      for (const s of [-1, 1]) w.cyl(H, V(bx + s * br * 1.1, by + br * 0.4, L + 2), V(bx + s * br * 0.62, by + br * 0.2, L + 30), 2.2, { kind: K_MACH, paint: PAINT_MACH, sky: 1, segs: 10, layer: 'main' });
    }
    // the thrust frame: heavy beams between the bells' mounts on the stern
    for (const [a, b] of [[[-205, 90], [-90, 40]], [[205, 90], [90, 40]], [[-200, -120], [-90, -100]], [[200, -120], [90, -100]], [[-205, 90], [-200, -120]], [[205, 90], [200, -120]]]) {
      w.beam(H, V(a[0], a[1], L + 5), V(b[0], b[1], L + 5), 8, 8, V(0, 0, 1), { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 1.2, layer: 'shell' });
    }
    // the block's inner face: turbopump housings round the bore, lamps on it
    const zw = L - H.block;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + 0.2, rr = h.r + 40 + (k % 2) * 20, c = V(h.x + rr * Math.cos(a), h.y + rr * Math.sin(a), zw - 9);
      if (Math.abs(c.x) > 250 || Math.abs(c.y) > 140 || !w.free(H, c, 16)) continue;
      w.box(H, F(c), 11 + (k % 3) * 2, 11, 9, { kind: K_MACH, paint: PAINT_MACH, b: 1.2 });
      w.cyl(H, c.clone().add(V(0, 0, -9)), c.clone().add(V(0, 0, -17)), 6, { kind: K_MACH, paint: P.pipe, segs: 16 });
      w.cyl(H, c.clone().add(V(0, 11, -2)), c.clone().add(V(0, 26, -2)), 2.4, { kind: K_MACH, paint: P.pipe2, segs: 10, layer: 'detail' });
    }
    for (const sx of [-1, 1]) w.lamp(H, V(h.x + sx * (h.r + 22), h.y + 24, zw - 1), V(0, 0, -1), 'amber', 2.2, { reach: 160, I: 5200 });
    // floods on the stern, between the bells, aimed at the main bell's mouth (what power is left); red lights on its rim
    for (const sx of [-1, 1]) this.flood(H, V(sx * 120, 150, L + 4), V(-sx * 0.3, -0.5, 0.8).normalize(), 'amber', 650, 1.2e6, (b) => [V(b.x, b.y, L - 0.1), V(0, 0, 1)]);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      if (a > crack0 - 0.1 && a < crack1 + 0.1) continue;
      // (on the rim's flat facet there: 48 round from crack1)
      const seg = (crack0 + TAU - crack1) / 48, am = crack1 + (Math.floor((((a - crack1) % TAU) + TAU) % TAU / seg) + 0.5) * seg;
      const rf = 154 * Math.cos(seg / 2) / Math.cos(a - am) + (0.45 * 0.9 - 0.03) / Math.cos(a - am);
      w.lamp(H, V(h.x + Math.cos(a) * rf, h.y - Math.sin(a) * rf, L + len + 7), V(Math.cos(am), -Math.sin(am), 0), 'red', 0.9, { sky: 1, along: V(Math.sin(am), Math.cos(am), 0) });
    }
    // the bore's mouth inside: a collar of heavy brackets, torn
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU, rr = h.r + 9, c = V(h.x + rr * Math.cos(a), h.y + rr * Math.sin(a), zw - 3);
      w.box(H, F(c, V(Math.cos(a), Math.sin(a), 0), V(-Math.sin(a), Math.cos(a), 0), V(0, 0, 1)), 6, 3, 3 + (k % 3), { kind: K_MACH, paint: PAINT_MACH, soot: 0.5 });
    }
  }

  // ---- the reactor hall: the core - a ball of plasma held in three rings, still burning, unstable, its light on all of
  // it; arcs from it to the conductors round the hall (one reaching over the way); a cradle from the deck, coolant
  // lines to the walls, pumps; amber floods on the walls
  reactor() {
    const w = this.w, H = w.aft, c = V(-48, 30, 1180), rc = 34, rr = 60, o = { kind: K_MACH, paint: P.reactor };
    // the rings: three, tilted to each other, each a box section with a glowing inner band
    const rings = [[0, 0], [1.05, 0.5], [-1.05, 0.5]].map(([a, b]) => {
      const ax = V(1, 0, 0).applyAxisAngle(V(0, 0, 1), a), ay = V(0, 1, 0).applyAxisAngle(V(0, 0, 1), a).applyAxisAngle(ax, b), az = new THREE.Vector3().crossVectors(ax, ay);
      return F(c.clone(), ax, ay, az);
    });
    for (const [k, Fr] of rings.entries()) {
      const R0 = rr + k * 7;
      w.lathe(H, Fr, [[R0 + 3, -3.5], [R0 + 3, 3.5], [R0 - 2.5, 3.5], [R0 - 2.5, -3.5], [R0 + 3, -3.5]], { ...o, paint: PAINT_FRAME, segs: 72, layer: 'main' });
      w.lathe(H, Fr, [[R0 - 2.6, -1.6], [R0 - 2.6, 1.6]], { kind: K_LAMP, paint: LAMP.cyan, seed: -1, segs: 72, inside: true, layer: 'main' });
      // clamps round it
      for (let q = 0; q < 12; q++) {
        const a = (q / 12) * TAU, p = Fr.o.clone().addScaledVector(Fr.ax, Math.cos(a) * (R0 + 1)).addScaledVector(Fr.az, Math.sin(a) * (R0 + 1));
        const rad = Fr.ax.clone().multiplyScalar(Math.cos(a)).addScaledVector(Fr.az, Math.sin(a));
        w.box(H, F(p, rad, Fr.ay.clone(), new THREE.Vector3().crossVectors(rad, Fr.ay)), 4.5, 4.6, 2.2, { ...o, paint: PAINT_CLAMP, layer: 'detail' });
      }
    }
    // the outer ring's struts to the hull: six heavy beams out to the frames
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * TAU + 0.3, d = V(Math.cos(a), Math.sin(a), 0);
      const p0 = c.clone().addScaledVector(d, rr + 17), end = this.toWall(H, c, d, c.z);
      if (!end || !this.clearLine(H, p0, end, 6)) continue;
      w.beam(H, p0, end, 5, 5, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, b: 0.8 });
    }
    // the cradle: from the deck up under the rings - two legs, a saddle
    for (const sx of [-1, 1]) {
      const top = V(c.x + sx * 34, c.y - rr - 10, c.z), foot = V(c.x + sx * 58, -149.5, c.z);
      w.beam(H, foot, top, 9, 9, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, b: 1 });
      w.box(H, F(foot.clone().add(V(0, 1.5, 0))), 12, 1.5, 12, { kind: K_FRAME, paint: PAINT_FRAME });
    }
    w.box(H, F(V(c.x, c.y - rr - 12, c.z)), 44, 4, 10, { kind: K_FRAME, paint: PAINT_FRAME, b: 1 });
    // coolant lines from the saddle to the walls, along the deck; pumps on them
    for (const [sx, dz, r] of [[-1, -30, 5], [-1, 30, 4], [1, -24, 4.5]]) {
      const pts = [V(c.x + sx * 40, c.y - rr - 16, c.z + dz), V(c.x + sx * 70, -100, c.z + dz), V(c.x + sx * 90, -140, c.z + dz * 1.4)];
      const x2 = sx > 0 ? 150 : -215;
      pts.push(V(x2, -140, c.z + dz * 1.6), V(x2, -140, c.z + dz * 1.6 + sx * 160));
      if (pts.every((p) => w.free(H, p, r + 4))) w.tube(H, pts, r, { kind: K_MACH, paint: P.pipe2, clampEvery: 14, segs: 14 });
      w.box(H, F(V(x2, -133, c.z + dz * 1.6 + sx * 60)), 9, 7, 12, { kind: K_MACH, paint: PAINT_MACH, b: 1 });
    }
    // the conductors: masts from the deck and the roof, a ball at each tip - what the arcs strike
    const tips = [];
    for (const [x, y0, y1, zz] of [[120, -150, -6, 1235], [140, 170, 70, 1110], [-170, -150, -20, 1290], [-160, 170, 80, 1070], [30, 170, 95, 1300], [-120, -150, -40, 1080]]) {
      const a = V(x, y0 > 0 ? this.innerY(H, x, zz, 1) : -149.5, zz), b = V(x, y1, zz);
      if (!w.free(H, b, 10) || !this.clearLine(H, a, b, 4)) continue;
      w.cyl(H, a, b, 2.4, { kind: K_MACH, paint: PAINT_MACH, segs: 12, r1: 1.4 });
      for (let k = 1; k <= 4; k++) w.cyl(H, a.clone().lerp(b, k / 5).addScaledVector(b.clone().sub(a).normalize(), -1), a.clone().lerp(b, k / 5).addScaledVector(b.clone().sub(a).normalize(), 1), 4.2, { kind: K_FRAME, paint: PAINT_CLAMP, segs: 12, layer: 'detail' });
      w.lathe(H, F(b.clone(), V(1, 0, 0), b.clone().sub(a).normalize(), new THREE.Vector3().crossVectors(V(1, 0, 0), b.clone().sub(a).normalize()).normalize()), [[0, -5], [3.2, -4], [5, 0], [3.2, 4], [0, 5]], { kind: K_MACH, paint: PAINT_CLAMP, segs: 16, smooth: true });
      tips.push(H.toWorld(b.clone()));
    }
    // amber floods high on the walls, reds low, marker rings
    this.wallLamps(H, 1000, 1380, 60, 3, ['amber']);
    this.wallLamps(H, 1010, 1380, -110, 3, ['red', 'amber']);
    this.markerRings(H, 1000, 1390, 3, 'amber');
    // the core itself (its own material), its light, the arcs
    w.core = new Core(w, H.toWorld(c.clone()), rc, tips, H);
  }

  // where a ray from local p along d (in the section) meets the inner surface (the frames' faces) of a piece at z
  toWall(H, p, d, z) {
    const q = H.inset(H.k(z), H.SKIN + H.RIBD + 0.5);
    let best = null, bt = 1e9;
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 8], ex = bx - ax, ey = by - ay, den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - p.x) * ey - (ay - p.y) * ex) / den, u = ((ax - p.x) * d.y - (ay - p.y) * d.x) / den;
      if (t > 0 && u >= 0 && u <= 1 && t < bt) { bt = t; best = V(p.x + d.x * t, p.y + d.y * t, z); }
    }
    return best;
  }
  // a part along a to b (radius r) clear of the track all the way
  clearLine(H, a, b, r) {
    const n = Math.ceil(a.distanceTo(b) / 12);
    for (let k = 0; k <= n; k++) if (!this.w.free(H, a.clone().lerp(b, k / n), r)) return false;
    return true;
  }

  // ---- the machinery hall: generator drums lying across it - one high over the way, one on the deck under it, more
  // to both sides - on their bearing blocks, banded; flywheels standing on the deck; conduits along the walls
  machinery() {
    const w = this.w, H = w.aft, R = this.R;
    const drum = (x0, x1, y, z, r) => {
      const a = V(x0, y, z), b = V(x1, y, z);
      w.cyl(H, a, b, r, { kind: K_MACH, paint: P.drum, segs: 40 });
      for (let k = 1; k < 8; k++) { const p = a.clone().lerp(b, k / 8); w.cyl(H, p.clone().add(V(-1.2, 0, 0)), p.clone().add(V(1.2, 0, 0)), r + 1.2, { kind: K_FRAME, paint: PAINT_CLAMP, segs: 40, layer: 'main' }); }
      for (const e of [a, b]) {
        const s = Math.sign(e.x - (x0 + x1) / 2);
        w.cyl(H, e, e.clone().add(V(s * 6, 0, 0)), r * 0.55, { kind: K_MACH, paint: PAINT_MACH, segs: 24 });
        w.box(H, F(e.clone().add(V(s * 12, 0, 0))), 6, r * 0.9, r * 0.75, { kind: K_MACH, paint: PAINT_MACH, b: 1 });
      }
    };
    const t1 = this.w.tl(H, this.sAt(H, 800, 'wreckIn')), t2 = this.w.tl(H, this.sAt(H, 680, 'wreckIn'));
    // over the way: its underside 45 m over the deck, from wall to wall, held at both ends on pillars to the deck
    const y1 = t1.p.y + 45 + 30, half = this.halfWidth(H.inset(1, H.SKIN + H.RIBD + 2), y1) - 24;
    drum(-half, half, y1, 800, 30);
    for (const sx of [-1, 1]) w.beam(H, V(sx * (half + 12), -149.5, 800), V(sx * (half + 12), y1 - 24, 800), 14, 30, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, b: 1.5 });
    // under it, on the deck: its top 34 m under the way
    const y2 = t2.p.y - 34 - 32;
    drum(-150, 120, y2, 680, 32);
    for (const x of [-120, 0, 100]) w.box(H, F(V(x, (y2 - 32 + -149.5) / 2, 680)), 10, ((y2 - 32) - -149.5) / 2, 22, { kind: K_FRAME, paint: PAINT_FRAME, b: 1 });
    // to the sides: drums on the deck, flywheels standing
    for (const [x0, x1, z, r] of [[-230, -110, 900, 26], [110, 230, 930, 26], [130, 230, 610, 22], [-235, -130, 620, 24]]) {
      const ok = [x0, (x0 + x1) / 2, x1].every((x) => w.free(H, V(x, -150 + r + 8, z), r + 4));
      if (ok) { drum(x0, x1, -150 + r + 8, z, r); for (const x of [x0 + 10, x1 - 10]) w.box(H, F(V(x, -150 + 4, z)), 6, 4, r * 0.8, { kind: K_FRAME, paint: PAINT_FRAME }); }
    }
    for (const [x, z, r] of [[-200, 760, 52], [190, 780, 48], [-205, 700, 44]]) {
      const c = V(x, -150 + r + 6, z);
      if (!w.free(H, c, r)) continue;
      w.cyl(H, c.clone().add(V(-5, 0, 0)), c.clone().add(V(5, 0, 0)), r, { kind: K_MACH, paint: P.drum, segs: 48 });
      w.cyl(H, c.clone().add(V(-9, 0, 0)), c.clone().add(V(9, 0, 0)), r * 0.25, { kind: K_MACH, paint: PAINT_MACH, segs: 20 });
      for (const sx of [-1, 1]) w.box(H, F(V(x + sx * 11, -150 + (r + 6) / 2, z)), 2.5, (r + 6) / 2, r * 0.3, { kind: K_FRAME, paint: PAINT_FRAME });
    }
    // conduits along both walls, low and high
    for (const sx of [-1, 1]) for (const [y, r] of [[-120, 3.2], [-108, 2.2], [40, 2.8]]) {
      const x = sx * (this.halfWidth(H.inset(1, H.SKIN + H.RIBD + 1), y) - r - 2), pts = [];
      for (let z = 600; z <= 1000; z += 20) pts.push(V(x, y, z));
      w.tube(H, pts, r, { kind: K_MACH, paint: R() < 0.5 ? P.pipe : P.pipe2, clampEvery: 16, segs: 12 });
    }
    this.wallLamps(H, 600, 1000, -60, 2, ['red', 'red', 'amber']);
    this.markerRings(H, 590, 1000, 3, 'red');
    // floods under the roof, aimed down across the hall
    for (const [x, z] of [[-150, 700], [150, 900], [0, 620]]) this.flood(H, V(x, this.innerY(H, x, z, 1) - 4, z), V(-x * 0.002, -1, 0.15).normalize(), 'amber');
  }

  // ---- the middle piece: a deck half gone, containers spilled across it and adrift in it, pipes torn off
  midPiece() {
    const w = this.w, H = w.mid, R = this.R;
    w.module('container', (M) => container(w, M), 650);
    for (let k = 0; k < 26; k++) {
      const z = 40 + R() * (H.len - 80), x = (R() < 0.5 ? -1 : 1) * (60 + R() * 170), adrift = R() < 0.45;
      const y = adrift ? -100 + R() * 220 : -150 + 6.4;
      const a = R() * TAU, ax = adrift ? V(Math.cos(a), R() - 0.5, Math.sin(a)).normalize() : V(Math.cos(a * 0.1), 0, Math.sin(a * 0.1));
      const ay0 = adrift ? V(R() - 0.5, 1, R() - 0.5) : V(0, 1, 0), az = new THREE.Vector3().crossVectors(ax, ay0).normalize(), ay = new THREE.Vector3().crossVectors(az, ax);
      const p = V(x, y, z);
      if (!w.free(H, p, 22) || (!adrift && this.floorAt(H, x, z) === undefined)) continue;
      (adrift ? w.drift : w.place).call(w, 'container', H, F(p, ax, ay, az), 1, TINTS[Math.floor(R() * TINTS.length)]);
    }
    this.markerRings(H, 20, H.len - 20, 3, 'red');
    this.wallLamps(H, 30, H.len - 30, -60, 2, ['red', 'amber']);
  }

  // A collapsed bulkhead across a piece at z: a wall 3 m thick, torn open round the way (the opening jagged, its
  // plates bent back), stiffeners on both faces, the torn steel bare; the sun stopped by it but for the opening
  bulkhead(H, z, at) {
    const w = this.w, R = this.R, T = 1.5, ring = H.inset(1, H.SKIN);
    const c = V(at.x, at.y + 8, z), hx = 46, hy = 32, n = 40;
    const hole = Array.from({ length: n }, (_, i) => {
      const a = -(i / n) * TAU, rough = 1 + 0.18 * noise2(i * 0.9 + z, 3.1) + 0.1 * Math.sin(i * 2.7 + z), cx = Math.cos(a), cy = Math.sin(a);
      const k = Math.pow(Math.pow(Math.abs(cx), 4) + Math.pow(Math.abs(cy), 4), -0.25) * rough;          // (a squarish blob)
      return [c.x + cx * hx * k, c.y + cy * hy * k];
    });
    for (const [zz, dz] of [[z - T, -1], [z + T, 1]]) {
      const contour = ring.map(([x, y]) => new THREE.Vector2(x, y)), holeV = hole.map(([x, y]) => new THREE.Vector2(x, y));
      const tris = THREE.ShapeUtils.triangulateShape(contour, [holeV]), all = [...contour, ...holeV];
      const nn = V(0, 0, dz), g = w.geo(H, zz, 'main'), F0 = F(V());
      const vs = all.map((q) => w.pv(g, H, F0, V(q.x, q.y, zz), nn, q.x + 400, q.y + 400, V(1, 0, 0), { kind: K_INNER, paint: [0.065, 0.066, 0.062] }));
      const nw = H.dirWorld(nn, V());
      for (const [a, b, cc] of tris) {
        const A = V().fromArray(g.P, vs[a] * 3), B = V().fromArray(g.P, vs[b] * 3), C = V().fromArray(g.P, vs[cc] * 3);
        if (B.sub(A).cross(C.sub(A)).dot(nw) >= 0) g.tri(vs[a], vs[b], vs[cc]); else g.tri(vs[a], vs[cc], vs[b]);
      }
    }
    // the opening's torn edge: strips between the faces, bent back toward the far side in places
    for (let i = 0; i < n; i++) {
      const [x0, y0] = hole[i], [x1, y1] = hole[(i + 1) % n], bend = noise2(i * 0.7, z * 0.01) > 0.55 ? 6 + R() * 8 : 0;
      const mx = (x0 + x1) / 2 - c.x, my = (y0 + y1) / 2 - c.y, l = Math.hypot(mx, my), out = V(mx / l, my / l, 0);
      w.beam(H, V(x0, y0, z), V(x1, y1, z), 2 * T + 0.4, 0.8, out, { kind: K_TORN, paint: PAINT_TORN, soot: 0.6 });
      if (bend) w.box(H, F(V((x0 + x1) / 2, (y0 + y1) / 2, z + bend * 0.6).addScaledVector(out, bend * 0.3), V(x1 - x0, y1 - y0, 0).normalize(), out, V(0, 0, 1)), Math.hypot(x1 - x0, y1 - y0) / 2, 0.5, bend / 2, { kind: K_INNER, paint: [0.06, 0.06, 0.058], soot: 0.5 });
    }
    // stiffeners, every 24 m across, clear of the opening
    for (let x = -264; x <= 264; x += 24) for (const dz of [-1, 1]) {
      const yr = this.yRange(ring, x), zz = z + dz * (T + 1.2), o = { kind: K_FRAME, paint: PAINT_FRAME };
      const top = c.y + hy * 1.35, bot = c.y - hy * 1.35, inside = Math.abs(x - c.x) < hx * 1.35;
      for (const [a, b] of inside ? [[yr[0] + 2, bot], [top, yr[1] - 2]] : [[yr[0] + 2, yr[1] - 2]]) if (b - a > 4) w.beam(H, V(x, a, zz), V(x, b, zz), 1.6, 2.4, V(0, 0, dz), o);
    }
    H.bulkheads.push({ z, x: c.x, y: c.y, hx: hx * 0.9, hy: hy * 0.9 });
    // lamps either side of the opening
    for (const sx of [-1, 1]) w.lamp(H, V(c.x + sx * (hx + 10), c.y + hy * 0.4, z + T + 0.5), V(0, 0, 1), 'amber', 1.8, { reach: 140, I: 3400 });
  }
  yRange(ring, x) {
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % 8];
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      const y = ay + (by - ay) * (x - ax) / (bx - ax);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return [lo, hi];
  }

  // ---- the fore piece's holds: containers stacked in rows down both sides on the deck, aisles between, frames of
  // posts between the stacks; containers adrift in the space over them; crane rails under the roof, spreaders hanging
  // on their cables; two collapsed bulkheads the way threads (the hold between them is where gravity turns over)
  holds() {
    const w = this.w, H = w.fore, R = this.R, z0 = 1260, z1 = H.len - 40;
    w.module('container', (M) => container(w, M), 650);
    const bh = [this.sAt(H, 2090, 'jump2'), this.sAt(H, 1245, 'jump2')].map((s) => this.w.tl(H, s));
    for (const t of bh) this.bulkhead(H, t.p.z, t.p);
    // the stacks: columns 13 m apart from 76 m out to the wall, slots 40 m along, up to 7 high (higher near the wall)
    for (const sd of [-1, 1]) for (let z = z0 + 24; z < z1 - 20; z += 40) {
      if (bh.some((t) => Math.abs(t.p.z - z) < 34)) continue;
      for (let c = 0; c < 11; c++) {
        const x = sd * (76 + c * 13);
        if (c === 4 || c === 8) continue;                                     // the aisles
        const max = Math.round(1 + (c / 10) * 4 + R() * 1.5), n = R() < 0.15 ? 0 : Math.max(1, Math.round(max * (0.5 + 0.5 * R())));
        for (let k = 0; k < n; k++) {
          const p = V(x + (R() - 0.5) * 0.6, -149.65 + 6 + k * 12.05, z + (R() - 0.5) * 1.2);
          if (this.floorAt(H, x, z) === undefined || !w.free(H, p, 20)) break;
          const yaw = k === n - 1 && R() < 0.2 ? (R() - 0.5) * 0.3 : 0;
          w.place('container', H, F(p, V(Math.cos(yaw), 0, -Math.sin(yaw)), V(0, 1, 0), V(Math.sin(yaw), 0, Math.cos(yaw))), 1, TINTS[Math.floor(R() * TINTS.length)], 160);
        }
      }
      // the posts between the stacks (the aisles' frames), and their tie beams high
      for (const c of [4, 8]) {
        const x = sd * (76 + c * 13);
        if (!w.free(H, V(x, -100, z - 20), 4)) continue;
        w.beam(H, V(x, -149.5, z - 20), V(x, -60, z - 20), 1.4, 1.4, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME });
      }
    }
    // adrift over the stacks
    for (let k = 0; k < 60; k++) {
      const z = z0 + R() * (z1 - z0), x = (R() - 0.5) * 420, y = -40 + R() * 180, a = R() * TAU, b = R() * TAU;
      const p = V(x, y, z);
      if (!w.free(H, p, 26) || bh.some((t) => Math.abs(t.p.z - z) < 30)) continue;
      const ax = V(Math.cos(a), Math.sin(b) * 0.5, Math.sin(a)).normalize(), az = new THREE.Vector3().crossVectors(ax, V(Math.sin(b), 1, 0).normalize()).normalize();
      w.drift('container', H, F(p, ax, new THREE.Vector3().crossVectors(az, ax), az), 1, TINTS[Math.floor(R() * TINTS.length)], 4);
    }
    // crane rails under the roof down the hold, spreaders hanging from trolleys on cables
    const yR = this.innerY(H, 60, 1800, 1) - 8;
    for (const sx of [-1, 1]) {
      w.beam(H, V(sx * 90, yR, z0), V(sx * 90, yR, z1), 3, 4, V(0, 1, 0), { kind: K_FRAME, paint: P.crane });
      for (let z = H.ribFrom + Math.ceil((z0 - H.ribFrom) / H.RIB) * H.RIB; z < z1; z += H.RIB * 2) w.beam(H, V(sx * 90, yR + 2, z), V(sx * 90, this.innerY(H, sx * 90, z, 1), z), 1.4, 2, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME });
    }
    for (const z of [1380, 1560, 1720, 1960, 2200]) {
      const x = (R() - 0.5) * 160, drop = 30 + R() * 50, top = V(x, yR - 4, z), sp = V(x, yR - 4 - drop, z);
      if (!this.clearLine(H, top, sp, 6)) continue;
      w.box(H, F(top), 9, 3, 6, { kind: K_MACH, paint: P.crane });
      for (const dx of [-3, 3]) w.cyl(H, top.clone().add(V(dx, -3, 0)), sp.clone().add(V(dx, 2, 0)), 0.35, { kind: K_MACH, paint: P.cable, segs: 6, caps: false, layer: 'detail' });
      w.box(H, F(sp), 7, 1.6, 19, { kind: K_FRAME, paint: P.crane, b: 0.4 });
    }
    this.markerRings(H, z0, z1, 3, 'red');
    this.wallLamps(H, z0, z1, -40, 2, ['red', 'red', 'amber']);
    for (const z of [1500, 1900]) for (const sx of [-1, 1]) this.flood(H, V(sx * 150, this.innerY(H, sx * 150, z, 1) - 4, z), V(-sx * 0.3, -1, 0).normalize(), 'amber');
  }

  // ---- the hangar: galleries down both walls in four tiers, a fighter in each bay on its cradle, its nose to the
  // hall; dropships on the deck in rows on their launch rails; a crane bridge across under the roof, a dropship
  // hanging from it; floods under the roof, the galleries' edges lit
  hangar() {
    const w = this.w, H = w.fore, R = this.R, z0 = 600, z1 = 1230;
    w.module('fighter', (M) => fighter(w, M), 900);
    w.module('fighterW', (M) => fighter(w, M, true), 900);
    w.module('cradle', (M) => cradle(w, M), 700);
    w.module('dropship', (M) => dropship(w, M), 1200);
    const q = H.inset(1, H.SKIN + H.RIBD + 0.6);
    for (const sd of [-1, 1]) for (const y of [-112, -62, -12, 38]) {
      const xw = this.halfWidth(q, y), xIn = xw - 40;
      for (let z = z0; z + H.RIB <= z1; z += H.RIB) {
        const zc = z + H.RIB / 2, open = H.field(zc, Math.atan2(y, sd * H.HW)) < 34 || !w.free(H, V(sd * (xIn + 20), y, zc), 24);
        if (open) continue;
        // the gallery's deck in this bay, its front edge beam, a post
        w.box(H, F(V(sd * (xIn + xw) / 2, y, zc)), (xw - xIn) / 2, 0.4, H.RIB / 2 - 0.1, { kind: K_DECK, paint: P.deck });
        w.beam(H, V(sd * xIn, y - 1.2, z + 0.2), V(sd * xIn, y - 1.2, z + H.RIB - 0.2), 1.0, 2.2, V(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
        w.beam(H, V(sd * xIn, y - 2.3, z), V(sd * xIn, y + 48, z), 1.2, 1.2, V(1, 0, 0), { kind: K_FRAME, paint: PAINT_FRAME });
        w.box(H, F(V(sd * (xIn + 0.6), y + 1.0, zc)), 0.12, 0.6, H.RIB / 2 - 0.4, { kind: K_FRAME, paint: P.hazard, layer: 'detail' });
        w.box(H, F(V(sd * (xIn - 0.2), y + 0.55, zc)), 0.14, 0.12, 1.2, { kind: K_LAMP, paint: LAMP.amber.map((c) => c * 0.5), seed: 30000 + Math.floor(R() * 1e4), b: 0 });
        // the fighter on its cradle (a few bays empty, a few wrecked)
        const r = R();
        if (r < 0.12) continue;
        // (heavy fighters: ~32 m, a bay's width)
        const nose = V(-sd, 0, 0), Fc = F(V(sd * (xIn + 19), y + 1.1, zc), V(0, 0, sd), V(0, 1, 0), nose);
        w.place('cradle', H, Fc, 1.6);
        w.place(r < 0.22 ? 'fighterW' : 'fighter', H, F(V(sd * (xIn + 19), y + 5.0, zc + (R() - 0.5)), V(0, 0, sd), V(0, 1, 0), nose), 1.6, r > 0.85 ? [0.9, 0.85, 0.8] : null);
      }
    }
    // rack towers down both sides of the way: posts from the deck, a platform every 22 m, a fighter on each (its nose
    // to the way), the platforms' edges lit; every ~120 m, sides alternating
    let side = 1;
    const towers = [];
    for (let s = this.sAt(H, 1180, 'jump2'); s < this.tr.at('breach') - 160; s += 110 + R() * 30, side = -side) {
      const t = w.tl(H, s), c = t.p.clone().addScaledVector(t.R, side * (98 + R() * 12));
      c.y = -150;
      const top = Math.min(t.p.y + 30, -60), n = Math.floor((top + 150) / 22), out = V(t.R.x, 0, t.R.z).normalize().multiplyScalar(-side);
      if (n < 2 || !w.free(H, V(c.x, (top - 150) / 2, c.z), 24) || this.floorAt(H, c.x, c.z) === undefined) continue;
      const ax = new THREE.Vector3().crossVectors(V(0, 1, 0), out).normalize(), o = { kind: K_FRAME, paint: PAINT_FRAME };
      towers.push(c);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = c.clone().addScaledVector(ax, dx * 17).addScaledVector(out, dz * 17);
        w.beam(H, V(q.x, -149.6, q.z), V(q.x, -150 + n * 22 + 3, q.z), 2.2, 2.2, V(0, 0, 1), o);
      }
      for (let k = 1; k <= n; k++) {
        const y = -150 + k * 22, pc = V(c.x, y, c.z);
        w.box(H, F(pc, ax, V(0, 1, 0), out), 18, 0.5, 18, { kind: K_DECK, paint: P.deck });
        w.box(H, F(pc.clone().addScaledVector(out, 18.2).add(V(0, 0.7, 0)), ax, V(0, 1, 0), out), 17, 0.12, 0.12, { kind: K_LAMP, paint: LAMP.amber.map((x) => x * 0.45), seed: 30000 + Math.floor(R() * 1e4), b: 0 });
        if (R() < 0.15) continue;
        w.place('cradle', H, F(pc.clone().add(V(0, 1.1, 0)), ax, V(0, 1, 0), out), 1.6);
        w.place(R() < 0.15 ? 'fighterW' : 'fighter', H, F(pc.clone().add(V(0, 5.0, 0)), ax, V(0, 1, 0), out), 1.6, R() > 0.8 ? [0.9, 0.85, 0.8] : null);
      }
      // its lamp on the top of a front corner post (clear of the fighter parked on the top deck), aimed out and down
      const post = c.clone().addScaledVector(ax, 17).addScaledVector(out, 17), postTop = -150 + n * 22 + 3;
      w.lamp(H, V(post.x, postTop + 1.4, post.z).addScaledVector(out, 0.5), out.clone().add(V(0, -0.4, 0)).normalize(), 'cold', 1.6, { reach: 120, I: 6000, mount: (b) => [V(b.x, postTop - 0.1, b.z), V(0, 1, 0)] });
    }
    // dropships on the deck in rows, on their rails; one knocked off its rail
    for (const sx of [-1, 1]) {
      const x = sx * 140;
      w.box(H, F(V(x, -149.3, (z0 + z1) / 2)), 3, 0.5, (z1 - z0) / 2, { kind: K_FRAME, paint: P.hazard });
      for (let z = z0 + 60; z < z1 - 40; z += 110) {
        const tilt = sx > 0 && Math.abs(z - 890) < 60 ? 0.35 : 0, p = V(x + (tilt ? 18 : 0), -150 + 10.2 + (tilt ? 4 : 0), z);
        if (!w.free(H, p, 30) || this.floorAt(H, p.x, z) === undefined || towers.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60)) continue;
        const ay = V(Math.sin(tilt) * -1, Math.cos(tilt), 0), ax = new THREE.Vector3().crossVectors(ay, V(0, 0, -1)).normalize();
        w.place('dropship', H, F(p, ax, ay, V(0, 0, -1)), 1, R() < 0.5 ? null : [0.8, 0.82, 0.85]);
      }
    }
    // the crane bridge across under the roof, on rails down both walls; its trolley, a dropship hanging on cables
    const yb = this.innerY(H, 0, 900, 1) - 18, zc = 940, xr = this.halfWidth(q, yb) - 4;
    for (const sx of [-1, 1]) w.beam(H, V(sx * xr, yb + 6, z0), V(sx * xr, yb + 6, z1), 4, 5, V(0, 1, 0), { kind: K_FRAME, paint: P.crane });
    for (const dz of [-7, 7]) w.beam(H, V(-xr, yb, zc + dz), V(xr, yb, zc + dz), 4, 9, V(0, 1, 0), { kind: K_MACH, paint: P.crane, b: 0.6 });
    for (const sx of [-1, 1]) w.box(H, F(V(sx * (xr - 6), yb + 4, zc)), 8, 6, 14, { kind: K_MACH, paint: P.crane });
    const xt = -60, hang = yb - 70;
    w.box(H, F(V(xt, yb - 7, zc)), 9, 3.5, 11, { kind: K_MACH, paint: PAINT_MACH });
    for (const dx of [-5, 5]) for (const dz of [-8, 8]) w.cyl(H, V(xt + dx, yb - 10, zc + dz), V(xt + dx * 1.3, hang + 6, zc + dz * 1.1), 0.4, { kind: K_MACH, paint: P.cable, segs: 6, caps: false, layer: 'detail' });
    if (w.free(H, V(xt, hang, zc), 30)) w.place('dropship', H, F(V(xt, hang, zc), V(-1, 0, 0).applyAxisAngle(V(0, 1, 0), 0.25), V(0, 1, 0), V(0, 0, -1).applyAxisAngle(V(0, 1, 0), 0.25)));
    // light: floods under the roof, lamps down the walls, marker rings
    for (const [x, z] of [[-120, 700], [120, 820], [-120, 1000], [120, 1150]]) this.flood(H, V(x, this.innerY(H, x, z, 1) - 4, z), V(-x * 0.003, -1, 0.1).normalize(), 'cold', 650, 1.4e6);
    this.markerRings(H, z0, z1, 4, 'amber');
  }

  // ---- where it broke: the keel's box trusses snapped out of the torn ends and bent, cables still strung across the
  // gaps between the pieces, slack, others hanging loose; plates and chunks adrift in the gaps
  breakZone() {
    const w = this.w, R = this.R, { fore, mid, aft } = w;
    const truss = (H, z0, z1, bend, y = -150, x = 0) => {
      const wd = 6, pts = (zz, c) => { const t = clamp((zz - z0) / (z1 - z0), 0, 1), b = bend * Math.max(0, t - 0.5) ** 2 * 60; return V(x + c[0] * wd, y + c[1] * wd + b, zz); };
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], step = 10, o = { kind: K_FRAME, paint: PAINT_FRAME }, od = { ...o, layer: 'detail' };
      for (const c of corners) for (let z = z0; z < z1; z += step) w.beam(H, pts(z, c), pts(Math.min(z1, z + step), c), 1.6, 1.6, V(0, 1, 0), o);
      for (let z = z0; z <= z1; z += step) for (let e = 0; e < 4; e++) {
        const a = corners[e], b = corners[(e + 1) % 4];
        w.beam(H, pts(z, a), pts(z, b), 0.9, 0.9, V(0, 0, 1), od);
        if (z + step <= z1) w.beam(H, pts(z, a), pts(z + step, b), 0.7, 0.7, V(0, 0, 1), od);
      }
    };
    truss(fore, fore.len - 90, fore.len + 40, -1, -150, 60);
    truss(fore, fore.len - 70, fore.len + 22, 1, -150, -90);
    truss(aft, -36, 60, 1, -150, 40);
    truss(mid, -30, 40, -1, -150, -70);
    truss(mid, mid.len - 40, mid.len + 34, 1, -150, 90);
    // cables across the gaps: from a torn end's last frame to the next piece's, slack
    const across = (A, za, B, zb, n) => {
      for (let k = 0; k < n; k++) {
        const a = A.toWorld(V(-200 + R() * 400, -120 + R() * 260, za)), b = B.toWorld(V(-200 + R() * 400, -120 + R() * 260, zb)), sag = 14 + R() * 30, pts = [];
        for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(fore.toLocal(a.clone().lerp(b, t).add(V(0, -sag * 4 * t * (1 - t), 0)))); }
        if (pts.every((q) => w.free(fore, q, 4))) w.tube(fore, pts, 0.8 + R() * 0.8, { kind: K_MACH, paint: P.cable, segs: 8, sway: 1.4 });
      }
    };
    across(fore, fore.len - 6, mid, 6, 6);
    across(mid, mid.len - 6, aft, 6, 6);
    // adrift in the gaps
    const kinds = ['plate', 'stub', 'chunk', 'plate', 'container'], gaps = [[fore, fore.len, mid, 0], [mid, mid.len, aft, 0]];
    for (const [A, za, B, zb] of gaps) {
      const a = A.toWorld(V(0, 0, za)), b = B.toWorld(V(0, 0, zb));
      for (let k = 0, n = 0; k < 400 && n < 40; k++) {
        const p = a.clone().lerp(b, R()).add(V((R() - 0.5) * 520, (R() - 0.5) * 360, (R() - 0.5) * 160)), kind = kinds[Math.floor(R() * kinds.length)];
        const size = kind === 'container' ? 1 : 2 + R() * 5;
        if (!this.clearOfTrack(p, size * 7 + 10)) continue;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3));
        w.drift(kind, fore, F(fore.toLocal(p), fore.dirLocal(V(1, 0, 0).applyQuaternion(q)), fore.dirLocal(V(0, 1, 0).applyQuaternion(q)), fore.dirLocal(V(0, 0, 1).applyQuaternion(q))), size, kind === 'container' ? TINTS[Math.floor(R() * TINTS.length)] : null, 2 + R() * 3);
        n++;
      }
    }
  }
  // a world point clear of the track (the space round it)
  clearOfTrack(p, r) {
    for (const q of this.w.near(p, r + 50)) {
      const d = p.clone().sub(q.P), x = d.dot(q.R), y = d.dot(q.U);
      if (Math.abs(x) < 36 + r && y > -16 - r && y < 28 + r) return false;
    }
    return true;
  }

  // ---- where sparks fly (wreck.js Sparks): torn conduits - the ruptured front's, the reactor's coolant lines, the holds'
  // bulkheads, the hangar's breach, the hulk the way flies through
  sparks() {
    const w = this.w, list = (w.sparkList = []);
    const site = (H, p, d) => { if (w.free(H, p, 8)) list.push({ p: H.toWorld(p.clone()), d: H.dirWorld(d.clone().normalize()) }); };
    const A = w.aft, Fo = w.fore;
    for (const s of [this.sAt(A, 330, 'wreckIn'), this.sAt(A, 140, 'wreckIn'), this.sAt(A, 1240, 'wreckIn')]) {
      const t = w.tl(A, s);
      site(A, t.p.clone().addScaledVector(t.R, 46).addScaledVector(t.U, 22), V(-0.4, -0.5, 0.3));
    }
    site(A, V(-140, -100, 1120), V(0.6, 0.4, -0.2));
    for (const s of [this.sAt(Fo, 2090, 'jump2'), this.sAt(Fo, 1245, 'jump2')]) {
      const t = w.tl(Fo, s);
      site(Fo, t.p.clone().addScaledVector(t.R, -52).addScaledVector(t.U, 30), V(0.5, -0.6, 0.2));
    }
    const tb = w.tl(Fo, this.tr.at('breach'));
    site(Fo, tb.p.clone().addScaledVector(tb.U, 40).addScaledVector(tb.T, 30), V(0, -1, 0.3));
    const fr = w.hulls.find((h) => h.hulk?.how === 'through');
    if (fr) site(fr, V(30, 18, fr.len * 0.5), V(-0.5, -0.6, 0));
  }

  // ---- windows: rows down the upper chamfers of the great pieces and the hulks' flanks, dark - but here and there a
  // run of them still lit (cold or warm, failing), on what power is left
  windows() {
    const w = this.w, R = this.R;
    for (const H of w.hulls.filter((h) => h.name !== 'tower')) {
      const big = H.HW > 100, faces = big ? [1, 7] : [2, 6], rows = big ? [0.3, 0.42, 0.54] : [0.35, 0.5, 0.65];
      for (const face of faces) for (const u of rows) {
        let z = 10 + R() * 40;
        while (z < H.len - 10) {
          const run = 30 + R() * 120, lit = R() < (big ? 0.35 : 0.5), col = R() < 0.6 ? [0.5, 0.62, 0.8] : [0.9, 0.62, 0.32], id = 40000 + Math.floor(R() * 19000);
          if (lit) for (let zz = z; zz < Math.min(z + run, H.len - 10); zz += big ? 7 : 5) {
            if (!this.solid(H, face, u, zz, 0.01, 2, 3) || this.taken(H, face, u - 0.02, u + 0.02, zz - 2, zz + 2)) continue;
            const Fw = this.onHull(H, face, u, zz, 0.06);
            // (its tint drawn first either way: the rest of the derelict's random stream stays as it was)
            const paint = col.map((c) => c * (0.25 + R() * 0.2)), seed = R() < 0.3 ? id : 60002;
            if (this.curl(H, Fw.o).lengthSq() > 0.3 * 0.3) continue;      // (not where the plate bends well out near a hole)
            w.box(H, Fw, big ? 1.6 : 1.0, 0.08, big ? 1.1 : 0.7, { kind: K_LAMP, paint, seed, b: 0, layer: 'main' });
          }
          z += run + 20 + R() * 120;
        }
      }
    }
  }

  // ---------------------------------------------------------------- outside
  // a frame on a piece's outer skin: face i, u across it (0..1), at z; ay its outward normal, az along the axis
  onHull(H, face, u, z, lift = 0) {
    const k = H.k(z), a = H.OCT[face], b = H.OCT[(face + 1) % 8];
    const n = (H.taper > 0 && z < H.taper ? H.planes[8 + face].n : H.planes[face].n).clone();
    const az = V(0, 0, 1).addScaledVector(n, -n.z).normalize(), ax = new THREE.Vector3().crossVectors(n, az);
    const p = V(k * (a[0] + (b[0] - a[0]) * u), k * (a[1] + (b[1] - a[1]) * u), z).addScaledVector(n, lift);
    return F(p, ax, n, az);
  }
  // plating there (not a hole) for a footprint of +-du across and +-dz along
  solid(H, face, u, z, du = 0.05, dz = 10, margin = 4) {
    const a = H.OCT[face], b = H.OCT[(face + 1) % 8];
    for (const uu of [u - du, u, u + du]) for (const zz of [z - dz, z, z + dz]) {
      if (zz < 0 || zz > H.len) return false;
      const k = H.k(zz), x = k * (a[0] + (b[0] - a[0]) * uu), y = k * (a[1] + (b[1] - a[1]) * uu);
      if (H.field(zz, Math.atan2(y, x)) < margin) return false;
    }
    return true;
  }
  // what already stands on the skin (face, u0..u1, z0..z1): one thing on another never
  taken(H, face, u0, u1, z0, z1) { return (H.taken || []).some((t) => t.face === face && t.u0 < u1 && u0 < t.u1 && t.z0 < z1 && z0 < t.z1); }
  mark(H, face, u0, u1, z0, z1) { (H.taken ||= []).push({ face, u0, u1, z0, z1 }); }
  // the face's u at a local x (top / bottom faces) or y (sides)
  faceU(H, face, q, z) {
    const k = H.k(z), a = H.OCT[face], b = H.OCT[(face + 1) % 8], i = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 0 : 1;
    return (q / k - a[i]) / (b[i] - a[i]);
  }

  // where the way runs over a piece's back at s: the piece, the track's frame in it, the back's height there
  topAt(s, margin = 30) {
    for (const H of [this.w.fore, this.w.aft]) {
      const t = this.w.tl(H, s), k = H.k(t.p.z);
      if (t.p.z < 4 || t.p.z > H.len - 4 || Math.abs(t.p.x) > (H.HW - H.sec.ct) * k - margin || t.p.y < H.HH * k) continue;
      return { H, t, top: (z) => this.topY(H, z) };
    }
    return null;
  }
  topY(H, z) { const pl = H.taper > 0 && z < H.taper ? H.planes[8] : H.planes[0]; return (pl.d - pl.n.z * z) / pl.n.y; }

  // ---- the trench along the back: walls of armour either side of the way (slabs 36-76 m long, 32-56 m high - over
  // the deck - with gaps), turrets beyond them high on their barbettes (a third wrecked), the way bolted down to the
  // back on short columns; running lights on the walls. The walls and turrets throw shadows (the cascades): across the
  // deck
  trench() {
    const w = this.w, tr = this.tr, R = this.R, s0 = tr.at('trench') + 150, s1 = tr.at('tower') - 210;
    w.module('turret', (M) => turret(w, M, false), 4000, true);
    w.module('turretW', (M) => turret(w, M, true), 4000, true);
    // (nothing of the skin's relief right under the way)
    for (let s = s0 - 260; s < s1 + 120; s += 8) {
      const at = this.topAt(s, 0);
      if (!at) continue;
      const { H, t } = at, W = 2 * (H.HW - H.sec.ct), u = this.faceU(H, 0, t.p.x, t.p.z);
      this.mark(H, 0, u - 46 / W, u + 46 / W, t.p.z - 6, t.p.z + 6);
    }
    let n = 0;
    for (const sd of [-1, 1]) {
      for (let s = s0 + R() * 40; s < s1;) {
        const L = 36 + R() * 40, gap = 10 + R() * 28, at = this.topAt(s + L / 2, 60);
        if (at) {
          const { H, t } = at, hx = 7 + R() * 5, hy = 16 + R() * 12, off = 40 + hx + R() * 6;
          const c = t.p.clone().addScaledVector(t.R, sd * off), top = this.topY(H, c.z);
          const fz = c.z, pl = H.taper > 0 && fz < H.taper ? H.planes[8] : H.planes[0], ny = pl.n.clone();
          const az = t.T.clone().addScaledVector(ny, -t.T.dot(ny)).normalize(), ax = new THREE.Vector3().crossVectors(ny, az);
          c.y = top + hy - 1.2;
          const o = { kind: K_HULL, paint: PAINT_HULL.map((x) => x * (0.9 + R() * 0.3)), sky: 1, layer: 'cast' };
          w.box(H, F(c, ax, ny, az), hx, hy, L / 2, { ...o, b: 2.2 });
          w.box(H, F(c.clone().addScaledVector(ny, hy + 1.2).addScaledVector(ax, -sd * 2), ax, ny, az), hx * 0.6, 1.4, L / 2 - 4, { ...o, b: 0.8 });
          // vents down its outer face, a hatch row on its inner
          for (let k = -1; k <= 1; k += 2) w.box(H, F(c.clone().addScaledVector(ax, sd * (hx + 0.4)).addScaledVector(az, k * L * 0.22), ax, ny, az), 0.6, hy * 0.6, L * 0.12, { kind: K_MACH, paint: PAINT_MACH, sky: 1, layer: 'detail' });
          if (n++ % 2 === 0) w.lamp(H, c.clone().addScaledVector(ny, hy + 2.8).addScaledVector(ax, -sd * (hx * 0.6 - 0.5)), ny.clone().addScaledVector(ax, -sd * 0.6).normalize(), 'red', 1.0, { sky: 1, layer: 'main' });
          const u = this.faceU(H, 0, c.x, c.z);
          this.mark(H, 0, u - (hx + 4) / (2 * (H.HW - H.sec.ct)), u + (hx + 4) / (2 * (H.HW - H.sec.ct)), c.z - L / 2 - 4, c.z + L / 2 + 4);
        }
        s += L + gap;
      }
    }
    // turrets: every ~150 m, sides alternating, 100-135 m off the way, their barrels outward or along
    let side = 1;
    for (let s = s0 + 40; s < s1; s += 130 + R() * 60, side = -side) {
      const at = this.topAt(s, 175);
      if (!at) continue;
      const { H, t } = at, off = 100 + R() * 35, c = t.p.clone().addScaledVector(t.R, side * off);
      const pl = H.taper > 0 && c.z < H.taper ? H.planes[8] : H.planes[0], ny = pl.n.clone();
      if (Math.abs(c.x) > (H.HW - H.sec.ct) * H.k(c.z) - 24) continue;
      // its barbette's tower, up past the walls: the guns over them
      const top = this.topY(H, c.z), up = 20 + R() * 10;
      w.cyl(H, V(c.x, top - 0.5, c.z), V(c.x, top + up, c.z), 19, { kind: K_HULL, paint: PAINT_HULL, sky: 1, segs: 28, layer: 'cast' });
      for (const y of [top + up * 0.3, top + up * 0.7]) w.cyl(H, V(c.x, y - 0.8, c.z), V(c.x, y + 0.8, c.z), 19.8, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 28, layer: 'main' });
      c.y = top + up - 0.5;
      const yaw = -side * (0.4 + R() * 1.0), along = t.T.clone().addScaledVector(ny, -t.T.dot(ny)).normalize();
      const az = along.applyAxisAngle(ny, yaw), ax = new THREE.Vector3().crossVectors(ny, az);
      const wrecked = R() < 0.35;
      w.place(wrecked ? 'turretW' : 'turret', H, F(c, ax, ny, az), 1, null, 600);
      // (their shadows: the cascades' - no blocks in the sun test, every lit pixel would pay for each)
      const u = this.faceU(H, 0, c.x, c.z);
      this.mark(H, 0, u - 30 / (2 * (H.HW - H.sec.ct)), u + 30 / (2 * (H.HW - H.sec.ct)), c.z - 30, c.z + 30);
    }
    // the way bolted down to the back: a short column every ~96 m, a cross-head under its girders
    for (let s = s0 - 120; s < tr.at('tower') - 40; s += 96) {
      const at = this.topAt(s, 40);
      if (!at || tr.inGap(s, 20)) continue;
      const { H, t } = at, ch = t.p.clone().addScaledVector(t.U, -5.4), top = this.topY(H, ch.z);
      if (ch.y - top < 3) continue;
      const o = { kind: K_FRAME, paint: P.pylon, sky: 1, layer: 'cast' };
      w.beam(H, ch.clone().addScaledVector(t.R, -24), ch.clone().addScaledVector(t.R, 24), 2.2, 1.6, t.U, o);
      for (const sd of [-1, 1]) {
        const a = ch.clone().addScaledVector(t.R, sd * 14);
        w.beam(H, V(a.x, top - 0.5, a.z), a, 2.4, 2.4, V(0, 0, 1), o);
        w.box(H, F(V(a.x, top + 0.3, a.z)), 3.6, 0.6, 3.6, { ...o, layer: 'main' });
      }
    }
  }

  // ---- the command tower on the stern piece's back: a base block from the back up to its control deck (the way runs
  // through the deck: that is a piece of its own - its plating, frames and walls built with the hulls), the bridge
  // tier over it with its windows, the top tier, masts, a dish; inside the deck, rows of consoles (their screens still
  // faintly lit), pillars; the window frames across its open front
  tower() {
    const w = this.w, B = w.aft, T = w.tower, R = this.R, ox = { kind: K_HULL, paint: PAINT_HULL, sky: 1 };
    const zt0 = 742, zt1 = 742 + T.len;
    const blk = (x, y, z, hx, hy, hz, o = {}) => {
      const c = V(x, y, z);
      w.box(B, F(c), hx, hy, hz, { ...ox, b: Math.min(4, hy * 0.25), ...o });
      if (!o.noShade) T.boxes.push({ c: T.toLocal(B.toWorld(c.clone())), ax: V(1, 0, 0), ay: V(0, 1, 0), az: V(0, 0, 1), h: [hx - 1.5, hy - 1.5, hz - 1.5] });
    };
    // the base: from the back to under the deck; a step at its front; the bridge tier; the top tier
    const yb0 = this.topY(B, 900), yd0 = 254 - 32;
    blk(0, (yb0 + yd0) / 2 + 0.5, (zt0 + zt1) / 2 + 10, 110, (yd0 - yb0) / 2 + 0.5, (zt1 - zt0) / 2 + 30);
    blk(0, (yb0 + 205) / 2, zt0 - 40, 70, (205 - yb0) / 2, 40);
    blk(0, 286 + 18, 880, 80, 18, 120);
    blk(0, 322 + 12, 900, 52, 12, 70);
    // windows round the bridge tier: a dark band, frames, some blown out (no glass at all)
    w.box(B, F(V(0, 300, 880)), 80.4, 4, 120.4, { kind: K_INNER, paint: [0.01, 0.012, 0.014], sky: 1, b: 0.4 });
    for (let k = -14; k <= 14; k++) w.box(B, F(V(k * 5.6, 300, 759.4)), 0.4, 4.2, 0.6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
    // masts and a dish on the top tier, a beacon still blinking
    for (const [dx, dz, h, snapped] of [[-30, 860, 60, false], [24, 880, 44, true], [6, 940, 70, false]]) {
      const a = V(dx, 346, dz), b = V(dx, 346 + h, dz);
      w.cyl(B, a, b, 1.6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 8 });
      if (snapped) w.cyl(B, b, b.clone().add(V(16, 6, 5)), 1.4, { kind: K_TORN, paint: PAINT_TORN, sky: 1, segs: 8, soot: 0.5 });
      else for (const y of [0.6, 0.85]) w.beam(B, V(dx - 9, 346 + h * y, dz), V(dx + 9, 346 + h * y, dz), 0.8, 0.8, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
      if (!snapped) w.lamp(B, b.clone().add(V(0, 0.45 * 1.4 - 0.05, 0)), V(0, 1, 0), 'red', 1.4, { sky: 1, layer: 'main' });
    }
    const dp = V(40, 372, 930), dax = V(0.3, 1, -0.4).normalize(), dbx = new THREE.Vector3().crossVectors(dax, V(0, 0, 1)).normalize(), dbz = new THREE.Vector3().crossVectors(dbx, dax);
    w.cyl(B, V(40, 346, 930), dp, 2.6, { kind: K_MACH, paint: PAINT_MACH, sky: 1 });
    w.lathe(B, F(dp.clone(), dbx, dax, dbz), [[0, 0], [8, 1], [16, 3.6], [23, 7.4], [24, 8.2]], { kind: K_MACH, paint: [0.09, 0.09, 0.088], sky: 1, segs: 28 });
    w.lathe(B, F(dp.clone().addScaledVector(dax, 0.25), dbx, dax, dbz), [[23.4, 7.9], [15.6, 3.9], [7.6, 1.3], [0, 0.3]], { kind: K_MACH, paint: [0.05, 0.05, 0.05], sky: 1, segs: 28 });
    // the control deck inside: its floor, consoles in rows both sides of the way, pillars to its roof
    const yF = -32 + T.SKIN + T.RIBD + 1.4;
    w.box(T, F(V(0, yF, T.len / 2)), 84, 0.4, T.len / 2 - 10, { kind: K_DECK, paint: P.deck });
    w.module('console', (M) => consoleDesk(w, M), 600);
    for (const sd of [-1, 1]) for (let z = 30; z < T.len - 30; z += 22) for (const x of [44, 58, 72]) {
      if (R() < 0.15) continue;
      const p = V(sd * x, yF + 0.4, z + (R() - 0.5) * 2);
      if (!w.free(T, p, 6)) continue;
      w.place('console', T, F(p, V(-sd, 0, 0).applyAxisAngle(V(0, 1, 0), Math.PI / 2), V(0, 1, 0), V(-sd, 0, 0)), 1, null, 200);
    }
    for (const sd of [-1, 1]) for (let z = 40; z < T.len - 20; z += 64) {
      const p = V(sd * 48, 0, z);
      if (!w.free(T, p, 4)) continue;
      w.beam(T, V(sd * 48, yF, z), V(sd * 48, 32 - T.SKIN - T.RIBD - 1, z), 3, 3, V(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME });
    }
    // its front's window frames, round the way (where they are clear of it)
    for (let x = -84; x <= 84; x += 12) for (let y = -26; y <= 26; y += 13) {
      const p = V(x, y, 1.2);
      if (!w.free(T, p, 3)) continue;
      w.box(T, F(p), 0.5, 6.5, 0.6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1 });
      w.box(T, F(V(x + 6, y + 6.5, 1.2)), 6, 0.4, 0.6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
    }
    this.wallLamps(T, 10, T.len - 10, 6, 2, ['red', 'amber']);
    this.markerRings(T, 10, T.len - 10, 4, 'red');
  }

  // ---- the great pieces' outsides: sponsons down both flanks (gone where torn), the keel under the fore piece, the
  // stern's radiator fins, the bow's thrusters, dome and ram plate; armour belts round them; then the skin's own relief
  outside() {
    const w = this.w, R = this.R;
    for (const H of [w.fore, w.aft]) {
      // sponsons: blocks 14 m out of each flank, in 32 m sections, a running light on every fourth
      for (const face of [2, 6]) {
        let k = 0;
        for (let z = (H.taper || 0) + 40; z < H.len - 60; z += 32) {
          if (!this.solid(H, face, 0.5, z + 16, 0.36, 18, 8) || this.taken(H, face, 0.12, 0.88, z, z + 32)) continue;
          const Fs = this.onHull(H, face, 0.5, z + 16, 14);
          w.box(H, Fs, 56, 14, 16.05, { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 4, layer: 'shell' });
          if (k++ % 4 === 1) w.lamp(H, Fs.o.clone().addScaledVector(Fs.ay, 14.4).addScaledVector(Fs.ax, 40), Fs.ay, 'red', 1.0, { sky: 1, layer: 'main' });
          this.mark(H, face, 0.1, 0.9, z, z + 32);
        }
      }
    }
    // the keel under the fore piece: docking bays along it
    for (let z = 700, k = 0; z < w.fore.len - 120; z += 32, k++) {
      const H = w.fore;
      if (!this.solid(H, 4, 0.5, z + 16, 0.25, 18, 8)) continue;
      const Fk = this.onHull(H, 4, 0.5, z + 16, 15);
      w.box(H, Fk, 70, 15, 16.05, { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 4, layer: 'shell' });
      if (k % 3 === 1) w.box(H, F(Fk.o.clone().addScaledVector(Fk.ay, 14.6), Fk.ax, Fk.ay, Fk.az), 40, 0.8, 12, { kind: K_INNER, paint: [0.015, 0.016, 0.017], sky: 1, b: 0.4 });
      this.mark(H, 4, 0.25, 0.75, z, z + 32);
    }
    // the stern piece's radiator fins: standing off its upper chamfers on posts
    for (const face of [1, 7]) for (const z of [180, 330, 480]) {
      const H = w.aft;
      if (!this.solid(H, face, 0.5, z, 0.3, 60, 6)) continue;
      const Fr = this.onHull(H, face, 0.5, z, 34);
      w.box(H, Fr, 2, 30, 56, { kind: K_HULL, paint: [0.1, 0.095, 0.088], sky: 1, b: 0.8, layer: 'shell' });
      for (const dz of [-40, 0, 40]) w.beam(H, this.onHull(H, face, 0.5, z + dz, 0).o, this.onHull(H, face, 0.5, z + dz, 5).o, 5, 5, Fr.az, { kind: K_MACH, paint: PAINT_MACH, sky: 1, layer: 'shell' });
      this.mark(H, face, 0.3, 0.7, z - 60, z + 60);
      H.boxes.push({ c: Fr.o.clone(), ax: Fr.ax, ay: Fr.ay, az: Fr.az, h: [1.2, 29, 55] });
    }
    // the bow: thruster housings on its chamfers, a sensor dome on its nose, a ram plate under it
    const A = w.fore;
    for (const face of [1, 3, 5, 7]) {
      const Ft = this.onHull(A, face, 0.5, 260, 9);
      w.box(A, Ft, 20, 9, 26, { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 3, layer: 'shell' });
      for (const k of [-1, 0, 1]) {
        const c = Ft.o.clone().addScaledVector(Ft.ax, k * 11).addScaledVector(Ft.ay, 8.8);
        w.cyl(A, c, c.clone().addScaledVector(Ft.ay, 7), 3, { kind: K_MACH, paint: P.nozzle, sky: 1, r1: 5, caps: false, segs: 14, layer: 'main' });
      }
      this.mark(A, face, 0.2, 0.8, 230, 290);
    }
    const k0 = A.tip;
    w.lathe(A, F(V(0, 0, 0), V(1, 0, 0), V(0, 0, -1), V(0, 1, 0)), [[40, -1], [40, 3], [36, 13], [26, 23], [14, 29], [0, 31]], { kind: K_MACH, paint: [0.07, 0.072, 0.075], sky: 1, segs: 36, layer: 'shell' });
    w.box(A, F(V(0, -A.HH * k0 + 22, -9)), A.HW * k0 - 20, 20, 9.5, { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 4, layer: 'shell' });
    for (const H of [w.fore, w.mid, w.aft]) { this.belts(H); this.relief(H); }
    void R;
  }

  // armour belts: raised bands round a piece (16 m wide, 4 m proud), torn where it is torn
  belts(H) {
    const zs = H === this.w.fore ? [700, 1240, 1800, 2240] : H === this.w.aft ? [80, 590, 1000] : [160];
    for (const z of zs) for (let face = 0; face < 8; face++) {
      const a = H.OCT[face], b = H.OCT[(face + 1) % 8], W = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(W / 24));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        if (!this.solid(H, face, u, z, 0.5 / n, 9, 10) || this.taken(H, face, u - 0.5 / n, u + 0.5 / n, z - 8, z + 8)) continue;
        this.w.box(H, this.onHull(H, face, u, z, 2), (W * H.k(z)) / n / 2 + 0.1, 2, 8, { kind: K_HULL, paint: [0.06, 0.062, 0.064], sky: 1, b: 1, layer: 'relief' });
      }
      this.mark(H, face, 0, 1, z - 9, z + 9);
    }
  }

  // the skin's own relief, in sections along each face (48-144 m), each one kind of work: a row of armour plates
  // across the face (some layered two deep), raised strips along it, a row of vent housings - or plain
  relief(H) {
    const w = this.w, R = this.R, sc = H.scale;
    const ok = (face, u0, u1, z0, z1) => u0 > 0.01 && u1 < 0.99 && !this.taken(H, face, u0, u1, z0, z1) && this.solid(H, face, (u0 + u1) / 2, (z0 + z1) / 2, (u1 - u0) / 2, (z1 - z0) / 2, 11 * sc);
    for (let face = 0; face < 8; face++) {
      const a = H.OCT[face], b = H.OCT[(face + 1) % 8], W0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let z = 6; z < H.len - 12;) {
        const L = (24 + Math.floor(R() * 4) * 16) * sc, z1 = Math.min(H.len - 8, z + L), Wm = W0 * H.k((z + z1) / 2), r = R();
        const tone = H.paint.map((c) => c * (0.82 + R() * 0.36)), o = { kind: K_HULL, paint: tone, sky: 1, layer: 'relief' };
        if (r < 0.4) {                                                 // armour plates in a row across
          const n = Math.max(1, Math.round(Wm / ((8 + R() * 6) * sc))), t = (0.5 + R() * 0.7) * sc, gap = 1.2 * sc / Wm;
          for (let k = 0; k < n; k++) {
            const u0 = k / n + gap, u1 = (k + 1) / n - gap;
            if (!ok(face, u0, u1, z + 1, z1 - 1)) continue;
            const Fp = this.onHull(H, face, (u0 + u1) / 2, (z + z1) / 2, t);
            w.box(H, Fp, ((u1 - u0) * Wm) / 2, t, (z1 - z - 2) / 2, { ...o, b: t > 1.5 ? Math.min(0.45 * sc, t * 0.6) : 0 });
            if (R() < 0.3) {
              const h2 = (0.35 + R() * 0.4) * sc, hu = ((u1 - u0) * Wm) / 2 * (0.5 + R() * 0.3), hz = (z1 - z - 2) / 2 * (0.3 + R() * 0.4);
              w.box(H, F(Fp.o.clone().addScaledVector(Fp.ay, t + h2), Fp.ax, Fp.ay, Fp.az), hu, h2, hz, { ...o, paint: tone.map((c) => c * 0.88), b: h2 * 0.5 });
            }
          }
        } else if (r < 0.58) {                                         // raised strips along it
          const m = 2 + Math.floor(R() * 2), hw = (1 + R() * 1.5) * sc, t = (0.8 + R() * 1.2) * sc;
          for (let k = 0; k < m; k++) {
            const uc = (k + 1) / (m + 1), hu = hw / Wm;
            if (!ok(face, uc - hu, uc + hu, z + 1, z1 - 1)) continue;
            w.box(H, this.onHull(H, face, uc, (z + z1) / 2, t), hw, t, (z1 - z - 2) / 2, { ...o, b: t > 1.5 ? Math.min(0.5 * sc, t * 0.5) : 0 });
          }
        } else if (r < 0.7) {                                          // vent housings in a row
          const uc = 0.25 + R() * 0.5, hv = (0.7 + R() * 0.8) * sc, hu = (1.5 + R() * 2) * sc / Wm;
          for (let zz = z + 5 * sc; zz < z1 - 4 * sc; zz += 9 * sc) {
            if (!ok(face, uc - hu, uc + hu, zz - 3 * sc, zz + 3 * sc)) continue;
            w.box(H, this.onHull(H, face, uc, zz, hv), hu * Wm, hv, 3 * sc, { ...o, b: 0.3 * sc, layer: 'main' });
          }
        }
        z = z1 + 2 * sc;
      }
    }
  }

  // ---- the graveyard: each hulk's own relief and belts, a bridge block or an engine block on its back, a beacon;
  // debris adrift all round the way through it - hull plates, frames' stubs, crumpled chunks, containers, a fighter
  graveyard() {
    const w = this.w, R = this.R, tr = this.tr;
    for (const H of w.hulls.filter((x) => x.hulk)) {
      this.belts(H);
      if (H.hulk.how !== 'far') this.relief(H);
      const z = H.len * (0.55 + R() * 0.2), Fb = this.onHull(H, 0, 0.5, z, 9);
      if (this.solid(H, 0, 0.5, z, 0.3, 30, 4)) {
        w.box(H, Fb, 26, 9, 34, { kind: K_HULL, paint: H.paint, sky: 1, b: 2, layer: 'shell' });
        w.box(H, F(Fb.o.clone().addScaledVector(Fb.ay, 12), Fb.ax, Fb.ay, Fb.az), 16, 4, 14, { kind: K_HULL, paint: H.paint, sky: 1, b: 1.2, layer: 'shell' });
        w.box(H, F(Fb.o.clone().addScaledVector(Fb.ay, 12).addScaledVector(Fb.az, -14.2), Fb.ax, Fb.ay, Fb.az), 15, 1.4, 0.4, { kind: K_INNER, paint: [0.01, 0.012, 0.014], sky: 1 });
        w.lamp(H, Fb.o.clone().addScaledVector(Fb.ay, 16.6), Fb.ay, 'red', 1.2, { sky: 1, layer: 'main' });
      }
      if (H.cap1 === 'closed') for (const [bx, by] of [[-24, 0], [24, 0], [0, 18]]) {
        const c = V(bx, by, H.len);
        w.lathe(H, F(c, V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), [[7, 0], [6.5, 4], [9, 16], [13, 30], [13.6, 31]], { kind: K_MACH, paint: P.bell, sky: 1, segs: 24, layer: 'shell' });
        w.lathe(H, F(c, V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), [[13.1, 30.6], [8.6, 16], [6.2, 4.2]], { kind: K_MACH, paint: P.soot, sky: 0.5, segs: 24, layer: 'shell' });
      }
      if (H.hulk.how === 'through') { this.markerRings(H, 10, H.len - 10, 3, 'red'); this.wallLamps(H, 10, H.len - 10, 0, 2, ['red', 'amber']); }
      if (H.hulk.how !== 'far') for (const [face, z] of [[0, H.len * 0.2], [4, H.len * 0.5], [0, H.len * 0.85]]) {
        if (!this.solid(H, face, 0.5, z, 0.1, 4, 3)) continue;
        const Fl = this.onHull(H, face, 0.5, z, 1.5);
        const onPlate = (b) => { const m = b.clone().addScaledVector(Fl.ay, -b.clone().sub(Fl.o).dot(Fl.ay) - 1.5 - 0.1); return [m.add(this.curl(H, m)), Fl.ay.clone()]; };
        w.lamp(H, Fl.o, Fl.ay.clone().multiplyScalar(0.35).addScaledVector(Fl.az, z > H.len / 2 ? -1 : 1).normalize(), R() < 0.5 ? 'amber' : 'cold', 1.6, { sky: 1, reach: 420, I: 2.6e5, area: 30, layer: 'main', mount: onPlate });
      }
    }
    // debris: shapes built once, adrift, round the way from the breach to the trench
    w.module('plate', (M) => { const ho = { kind: K_HULL, paint: PAINT_HULL, sky: 1, soot: 0.3 }, to = { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.6 };
      w.box(M, F(V(-2.5, 0, 0)), 2.5, 0.35, 4, ho);
      const ax = V(Math.cos(0.5), Math.sin(0.5), 0), ay = V(-Math.sin(0.5), Math.cos(0.5), 0);
      w.box(M, F(V(2.2, 1.2, 0.3), ax, ay, V(0, 0, 1)), 2.6, 0.35, 3.6, ho);
      w.box(M, F(V(4.6, 2.5, 0.3), ax, ay, V(0, 0, 1)), 0.25, 0.4, 3.4, to); }, 900);
    w.module('stub', (M) => { const fo = { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, soot: 0.4 };
      w.box(M, F(V(0, 0, 0)), 0.45, 1.6, 6, fo); w.box(M, F(V(0, 1.8, 0)), 1.0, 0.3, 6, fo);
      w.box(M, F(V(0, 0.8, 6.2)), 0.9, 1.4, 0.25, { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.6 }); }, 900);
    w.module('chunk', (M) => {
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7, ax = V(Math.cos(a), 0, Math.sin(a)), ay = V(0, 1, 0).applyAxisAngle(ax, 0.4 * (k - 1.5)).normalize(), az = new THREE.Vector3().crossVectors(ax, ay).normalize();
        w.box(M, F(V((k - 1.5) * 0.9, (k % 2) * 0.8, 0), ax, ay, az), 1.8 - k * 0.2, 0.3 + k * 0.15, 1.4, k === 3 ? { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.6 } : { kind: K_HULL, paint: PAINT_HULL, sky: 1, soot: 0.3 });
      } }, 900);
    const kinds = ['plate', 'stub', 'chunk', 'plate', 'chunk', 'container', 'fighterW'], b0 = tr.at('breach'), b1 = tr.at('trench');
    for (let k = 0, n = 0; k < 4000 && n < 420; k++) {
      const s = b0 + R() * tr.wrap(b1 - b0), f = tr.frame(s, {}), d = 50 + Math.pow(R(), 1.6) * 700;
      const dir = V(R() - 0.5, (R() - 0.5) * 0.8, R() - 0.5).normalize();
      const p = f.P.clone().addScaledVector(dir, d), kind = kinds[Math.floor(R() * kinds.length)];
      const size = kind === 'container' || kind === 'fighterW' ? 1 : 2 + R() * 6;
      if (!this.clearOf(p, size * 7 + 12)) continue;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3));
      const ax = V(1, 0, 0).applyQuaternion(q), ay = V(0, 1, 0).applyQuaternion(q), az = V(0, 0, 1).applyQuaternion(q);
      w.drift(kind, w.fore, F(w.fore.toLocal(p), w.fore.dirLocal(ax), w.fore.dirLocal(ay), w.fore.dirLocal(az)), size, kind === 'container' ? TINTS[Math.floor(R() * TINTS.length)] : null, 3 + R() * 4);
      n++;
    }
  }
  // a world point clear of the track (the space round it) and outside every piece's hull
  clearOf(p, r) {
    for (const q of this.w.near(p, r + 50)) {
      const d = p.clone().sub(q.P), x = d.dot(q.R), y = d.dot(q.U);
      if (Math.abs(x) < 36 + r && y > -16 - r && y < 28 + r) return false;
    }
    for (const H of this.w.hulls) {
      const l = H.toLocal(p), k = H.k(l.z);
      if (l.z > -r && l.z < H.len + r && Math.abs(l.x) < k * H.HW + r && Math.abs(l.y) < k * H.HH + r) return false;
    }
    return true;
  }

  // the arc length where the track is nearest a piece's z after named point `from` (inside the piece)
  sAt(H, z, from, span = 4000) {
    const tr = this.tr, s0 = tr.at(from);
    let best = s0, bd = 1e9;
    for (let d = 0; d < span; d += 4) {
      const t = this.w.tl(H, s0 + d), k = Math.abs(t.p.z - z) + (Math.abs(t.p.x) < H.HW && Math.abs(t.p.y) < H.HH ? 0 : 1e4);
      if (k < bd) { bd = k; best = s0 + d; }
    }
    return best;
  }

  // ---- the stern piece's ruptured fore end: what is left of its decks hanging out into the light, broken frames
  // bent, cables trailing out of the torn front
  rupture() {
    const w = this.w, H = w.aft, R = this.R;
    // decks: two levels, broken off in places, the plates near a hole bent down into it
    for (const [y, z0, z1] of [[-150, 40, 590], [-20, 60, 380]]) {
      const q = H.inset(1, H.SKIN + H.RIBD + 0.5), xr = this.halfWidth(q, y), n = Math.round((2 * xr) / 40), wx = (2 * xr) / n;
      for (let z = z0; z < z1; z += H.RIB) for (let k = 0; k < n; k++) {
        const xc = -xr + (k + 0.5) * wx, zc = z + H.RIB / 2, f = H.field(zc, Math.atan2(y, xc > 0 ? H.HW : -H.HW));
        if (R() < 0.25 || (y > -100 && Math.abs(xc) < xr * 0.45)) continue;
        // torn near a hole or the front: tipped down
        const tip = f < 60 || zc < 120 ? (0.15 + R() * 0.5) * (xc > 0 ? -1 : 1) : 0;
        const ax = V(Math.cos(tip), Math.sin(tip), 0), ay = V(-Math.sin(tip), Math.cos(tip), 0);
        const p = V(xc + (tip ? -Math.sign(xc) * 4 : 0), y - Math.abs(tip) * wx * 0.4, zc);
        if (!w.free(H, p, Math.max(wx, H.RIB) / 2)) continue;
        w.box(H, F(p, ax, ay, V(0, 0, 1)), wx / 2 - 0.2, 0.4, H.RIB / 2 - 0.2, { kind: K_DECK, paint: P.deck, b: 0.1, soot: tip ? 0.4 : 0 });
        if (!tip) w.beam(H, V(xc - wx / 2, y - 1.6, z), V(xc + wx / 2, y - 1.6, z), 1.6, 2.6, V(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
      }
    }
    // cables trailing out of the torn front into space, drifting
    for (let k = 0; k < 14; k++) {
      const x = (R() - 0.5) * 460, y = -120 + R() * 260, L = 30 + R() * 70, pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(V(x + Math.sin(t * 2.2 + k) * 6 * t, y - 14 * t * t, 30 - L * t)); }
      if (pts.every((q) => w.free(H, q, 4))) w.tube(H, pts, 0.5 + R() * 0.6, { kind: K_MACH, paint: P.cable, segs: 6, layer: 'detail', sway: 1.6 });
    }
    this.wallLamps(H, 380, 600, -80, 2, ['red']);
    this.wallLamps(H, 120, 600, 40, 3, ['red', 'amber']);
    this.markerRings(H, 60, 590, 3, 'red');
    for (const [x, z] of [[-170, 420], [150, 200]]) this.flood(H, V(x, -this.innerY(H, x, z, 1) + 30, z), V(-x * 0.004, 0.6, 0.4).normalize(), 'amber', 520, 7e5,
      (b) => { const fl = this.floorAt(H, b.x, b.z); return fl !== undefined ? [V(b.x, fl - 0.1, b.z), V(0, 1, 0)] : this.plateMount(H, b, -1); });
  }
}

// ---------------------------------------------------------------- modules (built once, instanced)
// a cargo container, 36 m long, 12 x 12 m: corner posts, ribbed sides, a door frame (tinted per instance)
function container(w, M) {
  const o = { kind: K_MACH, paint: [1, 1, 1], sky: 1 }, of = { kind: K_FRAME, paint: [0.75, 0.75, 0.75], sky: 1 };
  w.box(M, F(V()), 5.9, 5.9, 17.9, { ...o, b: 0.35 });
  for (const sx of [-1, 1]) for (const k of [-1, 1]) w.box(M, F(V(sx * 6.0, 0, k * 7)), 0.15, 5.3, 0.4, { ...of, b: 0 });
  w.box(M, F(V(0, 0, 18.05)), 5.5, 5.5, 0.15, { ...of, b: 0 });
}
// a fighter, ~20 m, nose along +z: fuselage, nose cone, canopy, swept wings, two engines, a fin, pods
function fighter(w, M, wrecked = false) {
  const o = { kind: K_HULL, paint: [0.085, 0.088, 0.092], sky: 1 }, om = { kind: K_MACH, paint: PAINT_MACH, sky: 1 };
  w.box(M, F(V(0, 0, 0)), 1.7, 1.4, 6.5, { ...o, b: 0.45 });
  w.lathe(M, F(V(0, -0.1, 6.4), V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)), [[1.55, 0], [1.2, 2.2], [0.5, 4.2], [0, 4.8]], { ...o, segs: 10 });
  w.box(M, F(V(0, 1.45, 3.2)), 0.95, 0.55, 2.2, { kind: K_INNER, paint: [0.008, 0.01, 0.012], sky: 1, b: 0.3 });
  const sweep = 0.42;
  for (const sx of [-1, 1]) {
    if (wrecked && sx > 0) { w.box(M, F(V(2.6, -0.3, -1.6), V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)), 1.0, 0.25, 2.0, { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.8 }); continue; }
    const ax = V(sx * Math.cos(sweep), 0, -Math.sin(sweep)), az = new THREE.Vector3().crossVectors(ax, V(0, 1, 0)).multiplyScalar(sx);
    w.box(M, F(V(sx * 5.2, -0.3, -2.4), ax, V(0, 1, 0), az), 3.9, 0.22, 2.0, { ...o, b: 0.12 });
    w.cyl(M, V(sx * 7.6, -0.65, 0.5), V(sx * 7.6, -0.65, -5.5), 0.32, { ...om, segs: 6 });
  }
  for (const sx of [-1, 1]) {
    w.cyl(M, V(sx * 1.9, -0.1, -4.5), V(sx * 1.9, -0.1, -8.2), 0.95, { ...om, segs: 12 });
    w.cyl(M, V(sx * 1.9, -0.1, -8.2), V(sx * 1.9, -0.1, -9.4), 0.85, { kind: K_MACH, paint: P.nozzle, sky: 1, r1: 1.1, caps: false, segs: 12 });
  }
  w.box(M, F(V(0, 2.4, -5.4), V(1, 0, 0), V(0, 1, 0).applyAxisAngle(V(1, 0, 0), -0.35), V(0, 0, 1).applyAxisAngle(V(1, 0, 0), -0.35)), 0.18, 1.6, 1.5, { ...o, b: 0.08 });
}
// a dropship, ~50 m, nose along +z: a heavy hull, a wedge nose, engine pods, legs, a ramp
function dropship(w, M) {
  const o = { kind: K_HULL, paint: [0.07, 0.072, 0.07], sky: 1 }, om = { kind: K_MACH, paint: PAINT_MACH, sky: 1 };
  w.box(M, F(V(0, 0, 0)), 6.5, 5.2, 18, { ...o, b: 1.4 });
  const tip = V(0, 0, 1).applyAxisAngle(V(1, 0, 0), 0.32);
  w.box(M, F(V(0, -0.8, 21.5), V(1, 0, 0), new THREE.Vector3().crossVectors(tip, V(1, 0, 0)), tip), 5.4, 3.6, 5.2, { ...o, b: 1.2 });
  w.box(M, F(V(0, 1.6, 24.8)), 3.4, 0.7, 1.6, { kind: K_INNER, paint: [0.008, 0.01, 0.012], sky: 1, b: 0.4 });
  w.box(M, F(V(0, 6.0, -2)), 2.2, 1.0, 13, { ...o, b: 0.5 });
  for (const sx of [-1, 1]) {
    w.box(M, F(V(sx * 10, -0.6, -5)), 2.8, 3.4, 11, { ...o, b: 0.9 });
    w.beam(M, V(sx * 6, 0, -2), V(sx * 8, -0.5, -2), 1.6, 3, V(0, 1, 0), om);
    for (const dy of [-1.4, 1.4]) w.cyl(M, V(sx * 10, -0.6 + dy, -16), V(sx * 10, -0.6 + dy, -18.6), 1.3, { kind: K_MACH, paint: P.nozzle, sky: 1, r1: 1.6, caps: false, segs: 12 });
    for (const dz of [-11, 10]) { w.beam(M, V(sx * 5, -4.8, dz), V(sx * 7.6, -9.6, dz + 1), 0.9, 0.9, V(0, 0, 1), om); w.box(M, F(V(sx * 7.8, -9.9, dz + 1)), 1.6, 0.25, 2, om); }
  }
  w.box(M, F(V(0, -4.6, -19.5), V(1, 0, 0), V(0, 1, 0).applyAxisAngle(V(1, 0, 0), 0.5), V(0, 0, 1).applyAxisAngle(V(1, 0, 0), 0.5)), 5.0, 0.4, 3.6, { ...om, b: 0.2 });
}
// a cradle a fighter stands on: two rails, a cross piece, clamps
function cradle(w, M) {
  const o = { kind: K_FRAME, paint: [0.06, 0.058, 0.055], sky: 1 };
  for (const sx of [-1, 1]) w.box(M, F(V(sx * 2.4, 0, 0)), 0.5, 0.5, 9, { ...o, b: 0 });
  for (const z of [-6, 3]) w.box(M, F(V(0, 0.2, z)), 3.2, 0.4, 0.6, { ...o, b: 0 });
  for (const sx of [-1, 1]) w.box(M, F(V(sx * 2.4, 1.2, -1)), 0.35, 0.8, 0.35, { kind: K_MACH, paint: PAINT_CLAMP, sky: 1, b: 0 });
}
// a gun turret, ~80 m with its barrels: a barbette and its ring, the house with a sloped front, three barrels along +z,
// a rangefinder; wrecked: the house knocked askew and burnt, one barrel snapped short, one drooping
function turret(w, M, wrecked) {
  const soot = wrecked ? 0.65 : 0, o = { kind: K_HULL, paint: [0.072, 0.074, 0.076], sky: 1, soot }, om = { kind: K_MACH, paint: PAINT_MACH, sky: 1, soot };
  w.cyl(M, V(0, 0, 0), V(0, 7, 0), 17, { ...om, segs: 32 });
  w.cyl(M, V(0, 7, 0), V(0, 8.4, 0), 18.6, { kind: K_FRAME, paint: PAINT_CLAMP, sky: 1, segs: 32 });
  const tilt = wrecked ? 0.12 : 0, ax = V(1, 0, 0).applyAxisAngle(V(0, 0, 1), tilt), ay = V(0, 1, 0).applyAxisAngle(V(0, 0, 1), tilt), az = V(0, 0, 1);
  const at = (x, y, z) => V(0, 8.4, 0).addScaledVector(ax, x).addScaledVector(ay, y).addScaledVector(az, z);
  w.box(M, F(at(0, 7, -3), ax, ay, az), 15, 7, 19, { ...o, b: 3 });
  const ga = -0.55, gy = ay.clone().applyAxisAngle(ax, ga), gz = az.clone().applyAxisAngle(ax, ga);
  w.box(M, F(at(0, 5.2, 16.6), ax, gy, gz), 14, 4.6, 4, { ...o, b: 1.5 });
  for (const [k, x] of [[0, -6.5], [1, 0], [2, 6.5]]) {
    const droop = wrecked && k === 0 ? -0.32 : 0.07, len = wrecked && k === 2 ? 15 : 54;
    const d = az.clone().applyAxisAngle(ax, -droop), b0 = at(x, 6, 19), b1 = b0.clone().addScaledVector(d, len);
    w.box(M, F(b0.clone().addScaledVector(d, 1.5), ax, ay, d), 2.6, 2.6, 2.2, { ...om, b: 0.6 });
    w.cyl(M, b0, b1, 1.9, { ...om, r1: 1.45, segs: 12 });
    if (len > 20) w.cyl(M, b1, b1.clone().addScaledVector(d, 3), 2.3, { ...om, segs: 12 });
    else w.cyl(M, b1, b1.clone().addScaledVector(d, 1.2), 1.5, { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.8, segs: 10 });
  }
  if (!wrecked) w.box(M, F(at(0, 15.6, -12), ax, ay, az), 13, 1.6, 2.4, { ...om, b: 0.6 });
  else w.box(M, F(at(3, 14.2, -2), ax, ay, az), 7, 0.3, 9, { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.9 });
  for (const sx of [-1, 1]) for (const z of [-12, 0]) w.box(M, F(at(sx * 15.3, 6, z), ax, ay, az), 0.5, 2.2, 3.2, { ...om, b: 0.2 });
}
// a console of the control deck: a desk, its sloped top, a screen still faintly lit (steady, breathing), a seat
function consoleDesk(w, M) {
  const o = { kind: K_MACH, paint: [0.045, 0.047, 0.05] };
  w.box(M, F(V(0, 0.55, 0)), 2.2, 0.55, 0.7, { ...o, b: 0.08 });
  const ay = V(0, 1, 0).applyAxisAngle(V(1, 0, 0), -0.6), az = V(0, 0, 1).applyAxisAngle(V(1, 0, 0), -0.6);
  w.box(M, F(V(0, 1.3, -0.15), V(1, 0, 0), ay, az), 2.1, 0.1, 0.62, { ...o, b: 0.04 });
  w.box(M, F(V(0, 1.42, -0.12), V(1, 0, 0), ay, az), 1.7, 0.02, 0.46, { kind: K_LAMP, paint: [0.04, 0.22, 0.2], seed: 60001, b: 0 });
  w.box(M, F(V(0, 0.45, 1.5)), 0.5, 0.06, 0.5, { ...o, b: 0 });
  w.box(M, F(V(0, 0.95, 1.95)), 0.5, 0.5, 0.06, { ...o, b: 0 });
  w.box(M, F(V(0, 0.2, 1.5)), 0.08, 0.2, 0.08, { ...o, b: 0 });
}
const TINTS = [[0.11, 0.045, 0.02], [0.03, 0.065, 0.065], [0.065, 0.065, 0.062], [0.095, 0.03, 0.022], [0.055, 0.06, 0.032], [0.025, 0.04, 0.075], [0.1, 0.08, 0.03]];

// ---------------------------------------------------------------- the coolant mist
// Layers of mist lying over the decks of the stern piece's halls (coolant boiled off and hanging there): a few big
// sheets, each its own drifting noise, thicker where looked at edge on, faded out toward their edges and near the
// camera; the core's light in them near it, the floods' amber further off. (Setting: Derelict: coolant mist.)
class Mist {
  constructor(w, H, z0, z1, heights) {
    const xr = H.HW - 70, len = z1 - z0, c = w.core;
    this.U = { time: { value: 0 }, core: { value: c ? c.c.clone() : V(0, -1e6, 0) }, glow: { value: 1 }, size: { value: new THREE.Vector2(2 * xr, len) } };
    w.mist = heights.map((y, k) => {
      const g = new THREE.PlaneGeometry(2 * xr, len, 1, 1).rotateX(-Math.PI / 2).translate(0, y, z0 + len / 2);
      g.applyMatrix4(H.M);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { ...this.U, seed: { value: k * 17.3 } },
        vertexShader: /* glsl */`varying vec3 vW; varying vec2 vUv; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */`uniform float time, glow, seed; uniform vec3 core; uniform vec2 size; varying vec3 vW; varying vec2 vUv;
          float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
          float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            vec2 p = vUv * size / 70.0 + seed;
            float d = n(p + vec2(time * 0.031, time * 0.017)) * 0.55 + n(p * 2.3 - vec2(time * 0.05, -time * 0.02)) * 0.3 + n(p * 5.1 + time * 0.07) * 0.15;
            vec2 e = min(vUv, 1.0 - vUv) * size;
            float edge = smoothstep(0.0, 90.0, min(e.x, e.y));
            vec3 v = cameraPosition - vW;
            float dist = length(v), grazing = 1.0 / max(abs(v.y) / dist, 0.18);
            float a = smoothstep(0.38, 0.85, d) * edge * smoothstep(12.0, 60.0, dist) * 0.07 * grazing;
            float k = exp(-distance(vW, core) / 170.0);
            vec3 c = mix(vec3(0.05, 0.03, 0.015), vec3(0.18, 0.42, 0.75) * glow, k);
            gl_FragColor = vec4(c * a, min(a, 0.6));
          }`,
      }));
      m.renderOrder = 2;
      m.name = 'wreck-mist';
      w.fxMeshes.push(m);
      return m;
    });
    this.c = H.toWorld(V(0, heights[0], z0 + len / 2));
    w.updaters.push((t, cam) => {
      const near = cam.distanceTo(this.c) < 1400;
      for (const m of w.mist) m.visible = near && w.mistOn !== false;
      this.U.time.value = t;
      this.U.glow.value = c ? c.L.f / 2 : 1;
    });
  }
}

// ---------------------------------------------------------------- the sun's beams
// Where the sun comes in through a big hole, the dust inside lit in beams: a few from points in each hole the sun shines
// through, along its light to the hull's far side - ribbons turned to face the camera about their own axis, faded at
// their ends and edges, motes drifting in them. (Setting: Derelict: coolant mist, sun's beams.)
class Beams {
  constructor(w, hulls) {
    const R = w.rnd, list = [];
    for (const H of hulls) {
      const sun = H.dirLocal(w.sunDir), into = sun.clone().negate();
      for (const h of H.holes) {
        const out = V(Math.cos(h.t), Math.sin(h.t), 0);
        if (out.dot(sun) < 0.15 || Math.max(h.rz, h.rt) < 30) continue;
        for (let k = 0, n = 0; k < 24 && n < 5; k++) {
          const a = R() * TAU, r = Math.sqrt(R()) * 0.55, z = h.z + Math.cos(a) * r * h.rz, th = h.t + (Math.sin(a) * r * h.rt) / H.ang;
          if (z < 10 || z > H.len - 10 || H.field(z, th) > -12) continue;
          // the entry: where the hull's skin is at that angle; the beam runs on until it leaves the hull
          const e = this.skinAt(H, z, th);
          if (!e) continue;
          const p0 = H.toWorld(e.clone().addScaledVector(into, 4));
          if (w.sunAt(p0.clone().addScaledVector(w.sunDir, 30)) < 0.5) continue;
          let len = 40;
          while (len < 700 && this.inHull(H, e.clone().addScaledVector(into, len + 10))) len += 10;
          if (len < 80) continue;
          list.push({ a: p0, b: H.toWorld(e.clone().addScaledVector(into, len)), r: 8 + R() * 14 + Math.max(h.rz, h.rt) * 0.05 });
          n++;
        }
      }
    }
    // one mesh: a ribbon of 2 x 12 vertices a beam, its sides pushed out in the vertex shader
    const N = 12, pos = [], ax = [], uv = [], idx = [];
    list.forEach((b, i) => {
      for (let k = 0; k < N; k++) for (const sd of [-1, 1]) {
        const t = k / (N - 1);
        pos.push(...b.a.clone().lerp(b.b, t).toArray());
        ax.push(...b.b.clone().sub(b.a).normalize().toArray(), b.r * sd);
        uv.push(t, sd * 0.5 + 0.5, i * 7.3, b.a.distanceTo(b.b));
      }
      for (let k = 0; k < N - 1; k++) { const o = i * N * 2 + k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    });
    if (!list.length) { w.beams = []; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('axis', new THREE.Float32BufferAttribute(ax, 4));
    g.setAttribute('buv', new THREE.Float32BufferAttribute(uv, 4));
    g.setIndex(idx);
    this.U = { time: { value: 0 } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.U,
      vertexShader: /* glsl */`attribute vec4 axis; attribute vec4 buv; varying vec4 vB; varying float vFace;
        void main() {
          vec3 side = normalize(cross(axis.xyz, cameraPosition - position));
          vec3 p = position + side * axis.w;
          vFace = abs(dot(normalize(cameraPosition - position), axis.xyz));
          vB = buv; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform float time; varying vec4 vB; varying float vFace;
        float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float t = vB.x, x = vB.y * 2.0 - 1.0, L = vB.w;
          float across = exp(-x * x * 3.0), ends = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t));
          float dust = 0.55 + 0.45 * n(vec2(t * L / 18.0 - time * 0.12, x * 2.0 + vB.z));
          float motes = smoothstep(0.82, 0.95, n(vec2(t * L / 2.5 + time * 0.3, x * 9.0 + vB.z)));
          float a = across * ends * (dust + motes * 1.5) * (1.0 - 0.7 * vFace);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * 0.05, 1.0);
        }`,
    }));
    m.frustumCulled = false;
    m.renderOrder = 3;
    m.name = 'wreck-beams';
    w.fxMeshes.push(m);
    w.beams = [m];
    w.updaters.push((t) => { this.U.time.value = t; });
  }
  // the outer skin's point at (z, angle) of a piece
  skinAt(H, z, th) {
    const k = H.k(z), d = V(Math.cos(th), Math.sin(th), 0);
    let best = null;
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = H.OCT[i], [bx, by] = H.OCT[(i + 1) % 8], ex = k * (bx - ax), ey = k * (by - ay), den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (k * ax * ey - k * ay * ex) / den, u = (k * ax * d.y - k * ay * d.x) / den;
      if (t > 0 && u >= 0 && u <= 1) best = V(d.x * t, d.y * t, z);
    }
    return best;
  }
  inHull(H, p) { const k = H.k(p.z); return p.z > 0 && p.z < H.len && H.OCT.every((v, i) => H.OCTN[i][0] * p.x + H.OCTN[i][1] * p.y < k * (H.OCTN[i][0] * v[0] + H.OCTN[i][1] * v[1]) - H.SKIN); }
}

// ---------------------------------------------------------------- the core
// A ball of plasma in the reactor hall: its own shader (churning, white-hot cells under a cooler skin, a rim of light),
// a halo round it, the light it throws (a lamp of the wreck's that reaches across the hall, pulsing and flaring with
// each arc), and the arcs: jagged bolts from its surface to the conductors' tips, struck again every few tenths of a
// second, each a ribbon facing the camera (one draw for all of them, rebuilt each frame).
const ARCS = 5, ARC_N = 22;
class Core {
  constructor(w, c, r, tips, H) {
    this.w = w; this.c = c; this.r = r; this.tips = tips; this.H = H;
    this.U = { time: { value: 0 }, flare: { value: 0 } };
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 5), new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: /* glsl */`varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() { vP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`uniform float time, flare; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
        void main() {
          vec3 p = normalize(vP) * 3.0;
          float a = n3(p * 1.3 + vec3(0.0, time * 0.35, time * 0.2)), b = n3(p * 3.1 - vec3(time * 0.6, 0.0, time * 0.4));
          float cells = smoothstep(0.35, 0.85, a * 0.65 + b * 0.45);
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
          float fil = pow(1.0 - abs(2.0 * n3(p * 5.0 + vec3(time * 0.9, -time * 0.5, 0.0)) - 1.0), 6.0);
          vec3 col = mix(vec3(0.02, 0.12, 0.45), vec3(0.5, 1.1, 2.2), cells) * (0.9 + 0.25 * sin(time * 2.3 + a * 6.0));
          col += vec3(0.9, 1.6, 3.0) * fil * 1.4 + vec3(0.3, 0.7, 1.8) * rim * 1.4;
          gl_FragColor = vec4(col * (1.0 + flare * 1.5), 1.0);
        }`,
    }));
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.55, 4), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.U,
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`uniform float time, flare; varying vec3 vN; varying vec3 vV;
        void main() { float f = abs(dot(normalize(vN), normalize(vV))); float g = pow(f, 3.0) * (0.35 + 0.1 * sin(time * 3.1)) * (1.0 + flare * 2.0);
          gl_FragColor = vec4(vec3(0.25, 0.6, 1.4) * g, 1.0); }`,
    }));
    for (const m of [core, halo]) { m.position.copy(c); m.name = 'wreck-core'; m.castShadow = false; }
    halo.renderOrder = 3;
    // the arcs
    this.arcs = Array.from({ length: ARCS }, () => ({ pts: [], next: 0, life: 0, t0: -1, a: null, b: null }));
    const n = ARCS * ARC_N * 2;
    this.pos = new Float32Array(n * 3);
    this.fade = new Float32Array(n);
    const across = new Float32Array(n);
    for (let i = 0; i < n; i++) across[i] = i % 2 ? 1 : -1;
    const idx = [];
    for (let a = 0; a < ARCS; a++) for (let i = 0; i < ARC_N - 1; i++) { const b = (a * ARC_N + i) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('fade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('across', new THREE.BufferAttribute(across, 1));
    g.setIndex(idx);
    const arcs = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`attribute float fade, across; varying float vF, vX; void main() { vF = fade; vX = across; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // (a white-hot core down its middle, a violet-blue glow either side)
      fragmentShader: /* glsl */`varying float vF, vX; void main() { float x = abs(vX); vec3 c = vec3(2.4, 3.2, 4.5) * exp(-x * x * 40.0) + vec3(0.35, 0.5, 1.6) * exp(-x * x * 4.0);
        gl_FragColor = vec4(c * vF, 1.0); }`,
    }));
    arcs.frustumCulled = false;
    arcs.name = 'wreck-arcs';
    this.meshes = [core, halo, arcs];
    this.arcMesh = arcs;
    w.fxMeshes.push(core, halo, arcs);
    // its light: one of the eight always (reach across the hall)
    this.lampI = w.lamps.length;
    w.lamps.push({ p: c.clone(), col: [0.45, 0.75, 1.0], i: -1, reach: 520, I: 2.4e5, f: 1, fixed: true, size: 40, real: 0.12 });
    this.L = w.lamps[this.lampI];
    w.updaters.push((t, cam) => this.update(t, cam));
  }

  strike(A, t) {
    const R = Math.random;
    const tip = this.tips[Math.floor(R() * this.tips.length)];
    const dir = tip.clone().sub(this.c).normalize();
    const a = this.c.clone().addScaledVector(dir, this.r * 0.98).add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(this.r * 0.5));
    const b = tip.clone(), L = a.distanceTo(b), side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(side, dir);
    // midpoint displacement: big bends, then smaller kinks on them
    const off = Array.from({ length: ARC_N }, () => [0, 0]);
    for (let step = ARC_N - 1, amp = 0.16; step > 1; step = Math.floor(step / 2), amp *= 0.55) {
      for (let i = step; i < ARC_N - 1; i += step) { off[i][0] += (R() - 0.5) * L * amp; off[i][1] += (R() - 0.5) * L * amp; }
    }
    A.pts = [];
    for (let i = 0; i < ARC_N; i++) {
      const u = i / (ARC_N - 1), env = Math.sin(Math.PI * u) ** 0.7;
      A.pts.push(a.clone().lerp(b, u).addScaledVector(side, off[i][0] * env).addScaledVector(up, off[i][1] * env));
    }
    A.t0 = t; A.life = 0.12 + R() * 0.2; A.next = t + 0.15 + R() * (R() < 0.3 ? 1.6 : 0.6);
  }

  update(t, cam) {
    const fx = this.w.effects, near = cam.distanceTo(this.c) < 1600;
    this.U.time.value = t;
    for (const m of this.meshes) m.visible = near;
    this.arcMesh.visible = near && fx;
    let flare = 0;
    if (near && fx) {
      for (const A of this.arcs) { if (t >= A.next) this.strike(A, t); flare = Math.max(flare, A.t0 >= 0 ? Math.max(0, 1 - (t - A.t0) / A.life) : 0); }
      // the ribbons, a few metres wide, square to the view
      const d = new THREE.Vector3(), s = new THREE.Vector3(), v = new THREE.Vector3();
      this.arcs.forEach((A, a) => {
        const age = A.t0 < 0 ? 1e9 : t - A.t0, k = age < A.life ? (1 - age / A.life) * (0.6 + 0.4 * Math.random()) : 0;
        for (let i = 0; i < ARC_N; i++) {
          const p = A.pts[i] || this.c, q = A.pts[Math.min(i + 1, ARC_N - 1)] || this.c, pr = A.pts[Math.max(i - 1, 0)] || this.c;
          d.subVectors(q, pr).normalize(); v.subVectors(cam, p).normalize(); s.crossVectors(d, v).normalize().multiplyScalar(2.2 + 2.5 * k);
          const o = (a * ARC_N + i) * 2;
          this.pos.set([p.x - s.x, p.y - s.y, p.z - s.z, p.x + s.x, p.y + s.y, p.z + s.z], o * 3);
          this.fade[o] = this.fade[o + 1] = k;
        }
      });
      this.arcMesh.geometry.attributes.position.needsUpdate = true;
      this.arcMesh.geometry.attributes.fade.needsUpdate = true;
    }
    this.U.flare.value = flare;
    const glow = this.w.mat.userData.U.wGlow.value;
    this.L.f = glow * (1 + 1.6 * flare);
  }
}
