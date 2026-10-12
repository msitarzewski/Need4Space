// The forest circuit's track, overgrown: vines hanging off the deck's edges and draped over its walls (thick in some
// stretches, bare in others), ivy wound up the gantries' pillars and along their beams with strands hanging from them.
// The strands hang straight down - from the edge, clear of the deck at any bank (none in the loop, the rolls or over
// the jumps); none reaches into the ships' way (the gantries' stop ~8 m over the deck).
import * as THREE from 'three';
import { TRACK_W } from './track.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm } from './noise.js';

const W = TRACK_W / 2, WALL_T = 0.7, WALL_H = 1.2, DECK = 1.8;

// the strands along the track: [{ p, len, wid }]
export function trackVines(track) {
  const rnd = mulberry32(31), out = [], f = {};
  const rolling = (s) => { track.frame(s, f); return f.U.y < 0.75; };
  for (let s = 0; s < track.length; s += 2.2 + rnd() * 2.6) {
    if (track.inGap(s, 12) || track.inLoop(s, 40) || track.inCave(s, 20) || rolling(s)) continue;
    const dens = fbm(s / 210 + 3.3, 0.7, 3);                  // overgrown stretches and bare ones
    if (dens < 0.42) continue;
    track.frame(s, f);
    for (const sd of [-1, 1]) {
      if (rnd() > (dens - 0.3) * 1.6) continue;
      const kind = rnd();
      if (kind < 0.45) {
        // over the wall: a short drape down its outer face
        out.push({ p: f.P.clone().addScaledVector(f.R, sd * (W + WALL_T + 0.25)).addScaledVector(f.U, WALL_H + 0.1), len: 1.5 + rnd() * 4, wid: 1.2 + rnd() * 1.2 });
      } else {
        // off the deck's edge: long strands into the air below
        const L = 2.5 + Math.pow(rnd(), 1.7) * 24 * (0.5 + dens);
        out.push({ p: f.P.clone().addScaledVector(f.R, sd * (W + WALL_T + 0.3)).addScaledVector(f.U, -DECK * 0.5), len: L, wid: 1.4 + rnd() * 1.6 });
      }
    }
    // and now and then from the girders underneath
    if (rnd() < 0.12 * dens) out.push({ p: f.P.clone().addScaledVector(f.R, (rnd() < 0.5 ? -12 : 12)).addScaledVector(f.U, -DECK - 2.4), len: 3 + rnd() * 14, wid: 1.5 + rnd() * 1.4 });
  }
  return out;
}

// Tunnels of vines: old steel arches every 10 m standing on the wall tops (base plates bolted on), overgrown - a roof
// of leaves on and between them with gaps the sun comes through, strands hanging from the high parts (their ends
// 9 m or more over the deck). The leaves cast real shadows (the cascades: they are near the track); inside, the
// sky's light is cut (look.js setCave shade). Returns the rib geometry and their matrices, the leaves (world space),
// the strands, and the centre lines for the shade.
export const CANOPY_A = W + WALL_T / 2, CANOPY_H = 17, CANOPY_SP = 10;
export function vineCanopy(track, cards) {
  const rnd = mulberry32(91), A = CANOPY_A, H = CANOPY_H, SP = CANOPY_SP, f = {};
  // a rib: a box section (0.55 along the track, 0.7 deep) swept round the arch; base plates
  const rib = new THREE.BufferGeometry(), pos = [], nrm = [], NK = 36;
  const arc = (k) => { const t = Math.PI * (1 - k / NK); return [A * Math.cos(t), WALL_H + 0.25 + H * Math.sin(t)]; };
  const nAt = (k) => { const t = Math.PI * (1 - k / NK), nx = Math.cos(t) / A, ny = Math.sin(t) / H, l = Math.hypot(nx, ny); return [nx / l, ny / l]; };
  const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) { pos.push(...p); nrm.push(...n); } };
  for (let k = 0; k < NK; k++) {
    const [x0, y0] = arc(k), [x1, y1] = arc(k + 1), [n0x, n0y] = nAt(k), [n1x, n1y] = nAt(k + 1), d = 0.7, w = 0.275;
    const o0 = [x0 + n0x * d, y0 + n0y * d], o1 = [x1 + n1x * d, y1 + n1y * d];
    const nm = [(n0x + n1x) / 2, (n0y + n1y) / 2];
    quad([x0, y0, -w], [x1, y1, -w], [x1, y1, w], [x0, y0, w], [-nm[0], -nm[1], 0]);           // inner face
    quad([o0[0], o0[1], w], [o1[0], o1[1], w], [o1[0], o1[1], -w], [o0[0], o0[1], -w], [nm[0], nm[1], 0]); // outer
    quad([x0, y0, w], [x1, y1, w], [o1[0], o1[1], w], [o0[0], o0[1], w], [0, 0, 1]);
    quad([o0[0], o0[1], -w], [o1[0], o1[1], -w], [x1, y1, -w], [x0, y0, -w], [0, 0, -1]);
  }
  rib.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rib.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const plate = new THREE.BoxGeometry(1.4, 0.25, 1.4).toNonIndexed();
  const parts = [rib];
  for (const sd of [-1, 1]) parts.push(plate.clone().translate(sd * A, WALL_H + 0.125, 0));
  const ribGeo = mergeGeometries(parts.map((g) => { const x = g.clone(); x.deleteAttribute('uv'); return x; }));
  const mats = [], leaves = [], strands = [], lines = [];
  const local = (s, x, y, z) => { track.frame(s + z, f); return f.P.clone().addScaledVector(f.R, x).addScaledVector(f.U, y); };
  for (const [s0, s1] of track.canopies) {
    const len = track.wrap(s1 - s0);
    for (let d = 0; d <= len; d += SP) {
      track.frame(s0 + d, f);
      mats.push(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()).setPosition(f.P));
    }
    // the roof: leaves on the arch's outside, thick low on the sides (climbing from the walls), with holes
    for (let d = 0; d < len; d += 0.8) {
      for (let q = 0; q < 26; q++) {
        const t = Math.PI * (0.03 + 0.94 * rnd()), side = Math.abs(Math.cos(t));
        const hole = fbm((s0 + d) / 26, t * 2.2, 3);
        if (hole < 0.3 - 0.25 * side) continue;
        const o = 0.5 + rnd() * 1.4, x = (A + o) * Math.cos(t), y = WALL_H + 0.25 + (H + o) * Math.sin(t);
        const out = new THREE.Vector3(Math.cos(t) / A, Math.sin(t) / H, 0).normalize();
        track.frame(s0 + d, f);
        const outW = f.R.clone().multiplyScalar(out.x).addScaledVector(f.U, out.y);
        leaves.push({ c: local(s0, x, y, d), s: 2.0 + rnd() * 2.2, out: outW, wind: 0.06, ao: 0.45 + 0.55 * rnd() });
      }
      // strands from the high part of the arch, ends >= 9 m over the deck
      for (let q = 0; q < 2; q++) if (rnd() < 0.6) {
        const t = Math.PI * (0.25 + 0.5 * rnd()), y = WALL_H + 0.25 + H * Math.sin(t);
        if (y > 12.5) strands.push({ p: local(s0, A * Math.cos(t), y - 0.3, d), len: 1.5 + rnd() * (y - 10), wid: 1.1 + rnd() * 1.2 });
      }
    }
    // the shade's centre line
    const pts = [], n = Math.max(4, Math.round(len / 18));
    for (let k = 0; k <= n; k++) { track.frame(s0 + (k / n) * len, f); pts.push(f.P.clone().addScaledVector(f.U, 6)); }
    lines.push({ pts, len });
  }
  return { ribGeo, mats, leaves: leaves.length ? cards(leaves) : null, strands, lines };
}

// ivy up the gantry pillars and along the beam: leaf cards on helices (in the gantry's own frame: x across, y up the
// deck's up, z along -T) - one geometry, instanced with the gantries' own matrices; and the strands hanging from the
// beams (world anchors)
export function gantryIvy(track, card) {
  const rnd = mulberry32(57), X = W + WALL_T / 2, BOT = 13.6, TOP = 15.3;
  const leaves = [];
  for (const sd of [-1, 1]) {
    // two stems spiralling up each pillar
    for (let st = 0; st < 2; st++) {
      const ph = rnd() * 6.28, turns = 2 + rnd() * 1.5;
      for (let y = WALL_H + 0.3; y < BOT; y += 0.28 + rnd() * 0.2) {
        const t = (y - WALL_H) / (BOT - WALL_H), a = ph + t * turns * 6.283, r = 0.95 + 0.15 * rnd();
        if (rnd() < 0.15 + 0.3 * t * t) continue;             // thinner up high
        leaves.push({ c: new THREE.Vector3(sd * X + Math.cos(a) * r, y, Math.sin(a) * r * 1.1), s: 0.55 + rnd() * 0.45, out: new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)) });
      }
    }
  }
  // along the beam's top and hanging off it
  for (let x = -X; x <= X; x += 0.5 + rnd() * 0.6) {
    if (rnd() < 0.35) continue;
    const z = (rnd() - 0.5) * 1.4;
    leaves.push({ c: new THREE.Vector3(x, TOP + 0.2 + rnd() * 0.3, z), s: 0.6 + rnd() * 0.5, out: new THREE.Vector3(0, 1, z) });
    if (rnd() < 0.5) leaves.push({ c: new THREE.Vector3(x, BOT - 0.2 - rnd() * 0.5, z), s: 0.5 + rnd() * 0.4, out: new THREE.Vector3(0, -1, z) });
  }
  const geo = card(leaves);
  // the strands from the beam, at each gantry
  const strands = [], M = new THREE.Matrix4(), v = new THREE.Vector3();
  const local = [];
  for (let x = -X + 1; x <= X - 1; x += 1.1 + rnd() * 1.8) if (rnd() < 0.55) local.push([x, BOT - 0.3, (rnd() - 0.5) * 1.2, 1.5 + Math.pow(rnd(), 1.5) * 4.4]);
  for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) local.push([sd * (X + 0.9), BOT - 1 - rnd() * 4, (rnd() - 0.5) * 1.5, 2 + rnd() * 5]);
  for (const i of track.gantryIdx) {
    track.basisAt(i, M);
    for (const [x, y, z, len] of local) {
      if (rnd() < 0.25) continue;
      strands.push({ p: v.set(x, y, z).applyMatrix4(M).clone(), len, wid: 1.0 + rnd() * 0.9 });
    }
  }
  return { geo, strands };
}
