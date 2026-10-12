// The skeleton: a creature the size of a mountain that died reaching up out of the jungle. Its neck rises 1.3 km from
// the canopy, its skull hangs at the circuit's height with the jaws agape, and the track runs in through its mouth -
// between the fangs, under the ribs of the palate - and out of the back of the skull, broken away. The body lies in the
// jungle behind, its ribs arching up out of the canopy. What has held it up since is what grew on it: lianas wound
// down the neck, trees on the cranium, curtains of vines from the jaws.
// The skull is built the way a reptile's is: a frame of bony bars round its openings (nostrils, the window in front of
// the eye, the eye socket, the openings behind it), the tooth rows along the jaws, a crest of horns at the back.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from './noise.js';
import { fbm3 } from './islands.js';
import { groundHeight } from './abyss.js';
import { sunOnly } from './look.js';
import { Q } from './quality.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = v(0, 1, 0);

// A bone: a bar swept along a smooth path through pts, its section an ellipse ([across, up] radii per point - `up` the
// direction its second radius keeps to, carried along the path without twist), rounded shut at both ends (or a closed
// ring), its surface lumpy and pitted (amp: a fraction of its radius). Returns the geometry and, if asked, the points
// along its top and its underside (where plants grow, where vines hang).
function bone(pts, radii, { seg = 14, per = 5, amp = 0.06, up = UP, closed = false, spots = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.5);
  const N = Math.max(2, (pts.length - (closed ? 0 : 1)) * per);
  const C = [], T = [];
  for (let i = 0; i <= N; i++) { C.push(curve.getPoint(i / N)); T.push(curve.getTangent(i / N).normalize()); }
  let u = up.clone().addScaledVector(T[0], -up.dot(T[0]));
  if (u.lengthSq() < 1e-4) u = v(1, 0, 0).addScaledVector(T[0], -T[0].x);
  u.normalize();
  const U = [], S = [], q = new THREE.Quaternion();
  for (let i = 0; i <= N; i++) {
    if (i > 0) { q.setFromUnitVectors(T[i - 1], T[i]); u.applyQuaternion(q).addScaledVector(T[i], -u.dot(T[i])).normalize(); }
    U.push(u.clone()); S.push(new THREE.Vector3().crossVectors(T[i], u).normalize());
  }
  const rad = (t) => {
    if (radii.length === 1) { const a = [].concat(radii[0]); return [a[0], a[1] ?? a[0]]; }
    const f = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(f)), w = f - k;
    const a = [].concat(radii[k]), b = [].concat(radii[k + 1]), ay = a[1] ?? a[0], by = b[1] ?? b[0];
    return [a[0] + (b[0] - a[0]) * w, ay + (by - ay) * w];
  };
  // the rings: the path's, and (open) three more past each end closing over a quarter circle
  const rings = [], K = 3, last = closed ? N - 1 : N;
  const r0 = rad(0), rN = rad(1), e0 = Math.min(r0[0], r0[1]), eN = Math.min(rN[0], rN[1]);
  if (!closed) for (let k = K; k >= 1; k--) {
    const a = (k / (K + 1)) * Math.PI / 2;
    rings.push([C[0].clone().addScaledVector(T[0], -Math.sin(a) * e0), S[0], U[0], r0[0] * Math.cos(a), r0[1] * Math.cos(a), false]);
  }
  for (let i = 0; i <= last; i++) { const r = rad(i / N); rings.push([C[i], S[i], U[i], r[0], r[1], true]); }
  if (!closed) for (let k = 1; k <= K; k++) {
    const a = (k / (K + 1)) * Math.PI / 2;
    rings.push([C[N].clone().addScaledVector(T[N], Math.sin(a) * eN), S[N], U[N], rN[0] * Math.cos(a), rN[1] * Math.cos(a), false]);
  }
  const pos = [], idx = [], P = new THREE.Vector3(), Nn = new THREE.Vector3();
  if (!closed) pos.push(...C[0].clone().addScaledVector(T[0], -e0).toArray());
  const base = closed ? 0 : 1;
  for (const [c, s, uu, rx, ry, main] of rings) {
    let top = null, bot = null;
    const rm = Math.max(3, Math.min(rx, ry)), f = 0.55 / rm;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      P.copy(c).addScaledVector(s, ca * rx).addScaledVector(uu, sa * ry);
      Nn.copy(s).multiplyScalar(ca * ry).addScaledVector(uu, sa * rx).normalize();
      // lumps a radius across, pits finer
      const d = ((fbm3(P.x * f, P.y * f, P.z * f, 2) - 0.5) * 2 + (fbm3(P.x * 0.09 + 7, P.y * 0.09, P.z * 0.09, 2) - 0.5) * 0.6) * amp * Math.min(rx, ry);
      P.addScaledVector(Nn, d);
      pos.push(P.x, P.y, P.z);
      if (main && spots) {
        if (!top || P.y > top.y) top = P.clone();
        if (!bot || P.y < bot.y) bot = P.clone();
      }
    }
    if (main && spots) { spots.top.push({ p: top, r: Math.min(rx, ry) }); spots.bottom.push({ p: bot, r: Math.min(rx, ry) }); }
  }
  const nr = rings.length;
  for (let i = 0; i < nr - (closed ? 0 : 1); i++) {
    const i2 = (i + 1) % nr;
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg, a = base + i * seg + j, b = base + i2 * seg + j, c = base + i * seg + j2, d = base + i2 * seg + j2;
      idx.push(a, b, d, a, d, c);
    }
  }
  if (!closed) {
    const apex = pos.length / 3;
    pos.push(...C[N].clone().addScaledVector(T[N], eN).toArray());
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      idx.push(0, base + j, base + j2);
      idx.push(apex, base + (nr - 1) * seg + j2, base + (nr - 1) * seg + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a plate of bone spanning between bars: rows of points across it (each row as many), its top face up, a skin `thick`
// thick under it, its edges closed
function plate(rows, thick) {
  const R = rows.length, Cn = rows[0].length, pos = [], idx = [];
  for (const row of rows) for (const p of row) pos.push(p.x, p.y, p.z);
  for (const row of rows) for (const p of row) pos.push(p.x, p.y - thick, p.z);
  const o = R * Cn, at = (i, j) => i * Cn + j;
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn - 1; j++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    idx.push(a, d, c, a, b, d, o + a, o + c, o + d, o + a, o + d, o + b);
  }
  // the rim: the four edges, top to underside
  const edge = (list) => { for (let k = 0; k < list.length - 1; k++) { const a = list[k], b = list[k + 1]; idx.push(a, b, o + b, a, o + b, o + a); } };
  edge([...Array(Cn).keys()].map((j) => at(0, j)).reverse());
  edge([...Array(Cn).keys()].map((j) => at(R - 1, j)));
  edge([...Array(R).keys()].map((i) => at(i, 0)));
  edge([...Array(R).keys()].map((i) => at(i, Cn - 1)).reverse());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// a tooth: rooted in the bone at `at`, pointing along dir, curving back along `back`
function tooth(at, dir, back, len, r) {
  const p = (k, b) => at.clone().addScaledVector(dir, len * k).addScaledVector(back, len * b);
  return bone([p(-0.12, 0), p(0.35, 0.04), p(0.7, 0.13), p(1, 0.28)], [[r, r * 0.85], [r * 0.78, r * 0.68], [r * 0.45, r * 0.4], [r * 0.08, r * 0.07]],
    { seg: 9, per: 3, amp: 0.04, up: back });
}

// weathered bone, painted per vertex (world space): ivory going grey-brown, dark underneath where the rain runs off,
// moss where the top holds water
function paint(g, moss = 1) {
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    const a = fbm3(x * 0.011, y * 0.011, z * 0.011, 3), b = fbm3(x * 0.035 + 5, y * 0.035, z * 0.035, 2), c = fbm3(x * 0.15, y * 0.04, z * 0.15, 2);
    let r = 0.44 + 0.16 * a, gg = 0.4 + 0.14 * a, bb = 0.31 + 0.1 * a;
    const under = smoothstep(0.15, -0.75, ny) * 0.5 + smoothstep(0.55, 0.75, c) * 0.22;      // the underside, rain streaks
    r *= 1 - under; gg *= 1 - under; bb *= 1 - under * 1.1;
    const m = moss * smoothstep(0.3, 0.8, ny) * smoothstep(0.44, 0.64, b);
    r += (0.04 - r) * m; gg += (0.07 - gg) * m; bb += (0.018 - bb) * m;
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = bb;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------------------------------------ the skull
// In its own frame: the road along -z through the middle at y = 0 (the deck), the snout at +z, x across.
// ~370 m from snout to the back of the skull, 220 m across the back, the jaws open ~35 deg.
function skull(spots) {
  const parts = [];
  const add = (pts, radii, o = {}) => parts.push(bone(pts, radii, { seg: 18, per: 6, spots, ...o }));
  const mir = (pts) => pts.map((p) => v(-p.x, p.y, p.z));
  const both = (pts, radii, o) => { add(pts, radii, o); add(mir(pts), radii, o); };
  const Z = v(0, 0, 1), NZ = v(0, 0, -1), cups = [];
  // the upper jaw's rim (the tooth row) and the cheek on back to the jaw joint
  const maxilla = [v(40, 42, 170), v(56, 44, 128), v(70, 46, 80), v(82, 49, 30), v(92, 52, -15)];
  const jugal = [v(92, 50, -15), v(100, 52, -60), v(106, 48, -105), v(108, 38, -148)];
  both(maxilla, [[9, 11], [10, 12], [11, 13], [11, 13], [10, 12]], { seg: 16 });
  both(jugal, [[10, 12], [9, 12], [9, 12], [12, 14]], { seg: 16 });
  // the snout's front, the ridge down the middle of the face to the crown
  add([v(40, 42, 170), v(22, 47, 181), v(0, 49, 184), v(-22, 47, 181), v(-40, 42, 170)], [[10, 11], [9, 10], [9, 10], [9, 10], [10, 11]]);
  add([v(0, 52, 184), v(0, 54, 152), v(0, 57, 110), v(0, 66, 66), v(0, 82, 22), v(0, 106, -30), v(0, 122, -95), v(0, 126, -150), v(0, 122, -180)],
    [[9, 7], [10, 7], [11, 8], [11, 8], [12, 9], [14, 10], [16, 11], [15, 12], [13, 12]], { seg: 16 });
  // round the nostril, the window in front of the eye
  both([v(36, 44, 174), v(26, 50, 171), v(12, 54, 166), v(0, 54, 163)], [[7, 8], [6, 7], [6, 7], [6, 7]], { up: Z });
  both([v(52, 46, 138), v(40, 54, 129), v(20, 57, 120), v(0, 57, 117)], [[8, 9], [7, 8], [7, 8], [8, 8]], { up: Z });
  both([v(64, 46, 100), v(52, 58, 88), v(30, 64, 78), v(0, 65, 72)], [[6, 7], [5, 6], [5, 6], [6, 6]], { up: Z, seg: 10 });
  both([v(76, 42, 62), v(68, 66, 44), v(52, 96, 34), v(34, 116, 30), v(14, 100, 8), v(0, 92, 2)], [[9, 10], [8, 9], [8, 9], [9, 9], [8, 8], [9, 9]], { up: Z });
  // the eye socket's rim, the bar behind it, the brow over it, the crown
  for (const sx of [1, -1]) {
    const c = v(64 * sx, 96, 4), n = v(sx * 0.6, 0.22, 0.77).normalize(), a = new THREE.Vector3().crossVectors(n, UP).normalize(), b = new THREE.Vector3().crossVectors(a, n);
    const ring = [];
    for (let k = 0; k < 14; k++) { const t = (k / 14) * Math.PI * 2; ring.push(c.clone().addScaledVector(a, Math.cos(t) * 31).addScaledVector(b, Math.sin(t) * 27)); }
    add(ring, [[10, 11]], { closed: true, up: n, seg: 14 });
    // the socket behind it: a hollow in shadow (painted dark - rotted, mossy)
    cups.push(bone([c.clone().addScaledVector(n, -8), c.clone().addScaledVector(n, -30)], [[27, 24], [21, 18]], { up: UP, seg: 18, per: 3, amp: 0.04 }));
  }
  both([v(86, 124, -26), v(94, 102, -34), v(98, 76, -40), v(100, 54, -44)], [[10, 10], [9, 9], [9, 9], [10, 11]], { up: Z });
  both([v(86, 46, 10), v(78, 62, 8), v(70, 74, 6)], [[9, 10], [8, 8], [8, 8]], { up: Z, per: 4 });
  both([v(30, 118, 34), v(56, 128, 22), v(80, 128, 0), v(90, 124, -40), v(88, 122, -96), v(80, 120, -140)], [[12, 9], [14, 11], [14, 11], [13, 10], [12, 10], [12, 11]], { seg: 16 });
  const parietal = [v(24, 112, 10), v(34, 122, -50), v(40, 127, -120), v(44, 127, -182)];
  both(parietal, [[8, 7], [9, 8], [10, 8], [10, 9]]);
  // the cap of the skull between them, domed (inside, the road runs in its shade)
  {
    const pc = new THREE.CatmullRomCurve3(parietal, false, 'centripetal'), rows = [];
    for (let k = 0; k <= 18; k++) {
      const z = -28 - (k / 18) * 150;
      let best = pc.getPoint(0);
      for (let q = 0; q <= 100; q++) { const p = pc.getPoint(q / 100); if (Math.abs(p.z - z) < Math.abs(best.z - z)) best = p; }
      const row = [];
      for (let j = 0; j <= 12; j++) { const u = j / 12, x = best.x * (1 - 2 * u); row.push(v(x, best.y + 1 + 7 * Math.sin(Math.PI * u), best.z)); }
      rows.push(row);
    }
    parts.push(plate(rows, 6));
    for (const row of rows) for (let j = 2; j <= 10; j += 4) spots.top.push({ p: row[j].clone(), r: 14 });
  }
  // the back: the bar down behind the openings to the jaw joint, the joint's knob, the arch over the broken-away back
  both([v(78, 120, -140), v(98, 94, -158), v(108, 56, -156), v(108, 38, -150)], [[11, 10], [10, 10], [11, 11], [13, 13]], { up: NZ });
  both([v(108, 46, -150), v(110, 24, -154)], [[15, 15], [16, 16]], { up: Z });
  add([v(108, 40, -152), v(104, 74, -172), v(84, 106, -184), v(46, 126, -190), v(0, 132, -193), v(-46, 126, -190), v(-84, 106, -184), v(-104, 74, -172), v(-108, 40, -152)],
    [[11, 14]], { up: NZ, seg: 16 });
  // under the road: the bars from the jaw joints in to the knob the neck hung from
  both([v(106, 26, -150), v(84, -2, -160), v(50, -26, -170), v(16, -38, -176)], [[9, 9], [8, 8], [8, 8], [10, 10]], { up: Z });
  add([v(0, -34, -170), v(0, -46, -186)], [[18, 16], [16, 14]], { up: Z });
  // the horns, swept back and up from the crown's corners
  both([v(80, 122, -168), v(98, 142, -212), v(114, 170, -256), v(122, 204, -296), v(118, 236, -326), v(108, 256, -344)],
    [[17, 17], [15, 15], [12, 12], [9, 9], [5, 5], [1.5, 1.5]], { up: Z, amp: 0.06 });
  both([v(46, 128, -186), v(52, 150, -222), v(56, 174, -250), v(54, 192, -268)], [[10, 10], [8, 8], [5, 5], [1.5, 1.5]], { up: Z, amp: 0.06 });
  // spines off the cheeks
  for (const [p, l] of [[v(100, 52, -60), 26], [v(105, 49, -95), 30], [v(108, 40, -130), 22]]) {
    const d = v(1, 0.15, -0.55).normalize();
    both([p.clone().addScaledVector(d, -4), p.clone().addScaledVector(d, l * 0.5), p.clone().addScaledVector(d, l)], [[6, 6], [4, 4], [1, 1]], { up: UP, per: 3 });
  }
  // the roof of the mouth over the road: arches from one jaw to the other, a keel along their crowns
  const rim = new THREE.CatmullRomCurve3([...maxilla, ...jugal.slice(1)], false, 'centripetal');
  const rimAt = (z) => { let best = null; for (let k = 0; k <= 200; k++) { const p = rim.getPoint(k / 200); if (!best || Math.abs(p.z - z) < Math.abs(best.z - z)) best = p; } return best; };
  const crowns = [];
  for (const z of [148, 104, 58, 12, -34, -80, -124]) {
    const r = rimAt(z), xr = r.x - 5, yr = r.y + 4;
    const arch = [v(xr, yr, z), v(xr * 0.55, yr + 16, z + 3), v(0, yr + 21, z + 5), v(-xr * 0.55, yr + 16, z + 3), v(-xr, yr, z)];
    add(arch, [[5, 7], [4, 6], [4, 6], [4, 6], [5, 7]], { up: Z, seg: 10 });
    crowns.push(v(0, yr + 21, z + 5));
  }
  add(crowns, [[5, 4]], { seg: 10 });
  // the lower jaw, hanging open from the joints, and its chin
  const jaw = [v(110, 22, -152), v(103, 2, -104), v(93, -16, -44), v(81, -30, 16), v(69, -40, 76), v(57, -47, 130), v(46, -50, 166)];
  both(jaw, [[13, 18], [13, 19], [12, 18], [11, 17], [10, 16], [10, 15], [11, 15]], { seg: 16 });
  add([v(46, -50, 166), v(24, -56, 177), v(0, -58, 180), v(-24, -56, 177), v(-46, -50, 166)], [[11, 15], [10, 14], [10, 14], [10, 14], [11, 15]]);
  both([v(98, 0, -82), v(97, 18, -92), v(96, 28, -104)], [[8, 10], [6, 8], [3, 4]], { up: Z, per: 3 });

  // the teeth: down from the upper jaw (fangs at the corners), up from the lower (tusks at its corners)
  const rnd = mulberry32(5), teeth = [];
  const row = (curve, from, to, step, f) => { const L = curve.getLength(); for (let s = from * L; s <= to * L; s += step * (0.85 + 0.3 * rnd())) f(curve.getPointAt(s / L), s / L); };
  for (const sx of [1, -1]) {
    const m = new THREE.CatmullRomCurve3(maxilla.map((p) => v(p.x * sx, p.y, p.z)), false, 'centripetal');
    row(m, 0.02, 0.97, 13, (p, t) => {
      const fang = t < 0.06, len = fang ? 46 : 15 + rnd() * 10 - t * 5, r = fang ? 8.5 : 4.2 + rnd() * 1.6;
      teeth.push(tooth(p.clone().add(v(-2 * sx, -9, 0)), v(-0.05 * sx, -1, 0.02).normalize(), v(0.08 * sx, 0, -1).normalize(), len, r));
    });
    const j = new THREE.CatmullRomCurve3(jaw.map((p) => v(p.x * sx, p.y, p.z)), false, 'centripetal');
    row(j, 0.38, 0.985, 12.5, (p, t) => {
      const tusk = t > 0.95, len = tusk ? 28 : 11 + rnd() * 7, r = tusk ? 7 : 3.8 + rnd() * 1.4;
      teeth.push(tooth(p.clone().add(v(-2 * sx, 12, 0)), v(-0.08 * sx, 1, 0.06).normalize(), v(0.05 * sx, 0, -1).normalize(), len, r));
    });
    // the incisors at the corners of the snout's front (none over the road itself)
    teeth.push(tooth(v(36 * sx, 36, 175), v(0, -1, 0.1).normalize(), v(0, 0, -1), 22, 5));
    for (const x of [7, 17, 27]) teeth.push(tooth(v(x * sx, 40, 181), v(0, -1, 0.08).normalize(), v(0, 0, -1), 13 - x * 0.08, 3.6));
    for (const x of [14, 30]) teeth.push(tooth(v(x * sx, -44, 177), v(0, 1, 0.12).normalize(), v(0, 0, -1), 12 + rnd() * 5, 4));
  }
  return { bone: mergeGeometries(parts), teeth: mergeGeometries(teeth), cups: mergeGeometries(cups) };
}

// ------------------------------------------------------------------------------------------------ the spine
// one vertebra, a metre long (z: toward the head, y: its back): the spool of its body, the arch and the spine over it
// raked back, the wings out to its sides, the joints fore and aft, the neck's ribs under its sides; spine: its height
function vertebra(spine = 1, neckRibs = true) {
  const parts = [], X = v(1, 0, 0), Z = v(0, 0, 1);
  parts.push(bone([v(0, 0, -0.5), v(0, 0, -0.42), v(0, 0, 0), v(0, 0, 0.42), v(0, 0, 0.5)], [[0.36, 0.33], [0.4, 0.37], [0.27, 0.25], [0.4, 0.37], [0.36, 0.33]],
    { seg: 16, per: 3, amp: 0.06, up: UP }));
  parts.push(bone([v(0, 0.18, 0.05), v(0, 0.42, 0), v(0, 0.42 + 0.33 * spine, -0.12 * spine), v(0, 0.42 + 0.55 * spine, -0.22 * spine)],
    [[0.09, 0.22], [0.08, 0.2], [0.05, 0.14], [0.03, 0.06]], { seg: 10, per: 3, amp: 0.06, up: Z }));
  for (const sx of [1, -1]) {
    parts.push(bone([v(0.22 * sx, 0.05, 0.05), v(0.5 * sx, 0.0, 0.06), v(0.74 * sx, -0.1, 0.14)], [[0.12, 0.06], [0.1, 0.05], [0.05, 0.03]], { seg: 8, per: 3, up: UP }));
    parts.push(bone([v(0.16 * sx, 0.3, 0.32), v(0.2 * sx, 0.36, 0.6)], [[0.07, 0.06], [0.06, 0.05]], { seg: 8, per: 2, up: UP }));
    parts.push(bone([v(0.16 * sx, 0.3, -0.3), v(0.2 * sx, 0.34, -0.55)], [[0.07, 0.06], [0.06, 0.05]], { seg: 8, per: 2, up: UP }));
    if (neckRibs) parts.push(bone([v(0.4 * sx, -0.16, 0.3), v(0.5 * sx, -0.28, -0.2), v(0.48 * sx, -0.32, -0.95)], [[0.07, 0.06], [0.05, 0.045], [0.02, 0.02]], { seg: 8, per: 3, up: X }));
  }
  return mergeGeometries(parts);
}

// ------------------------------------------------------------------------------------------------ the whole creature
// track: the circuit; at: the arc length of the skull's middle. Returns the geometries (world space) and what grows on
// it, and its plan (what the scenery and the fliers keep clear of).
export function skeleton(track, { dens = 1 } = {}) {
  const rnd = mulberry32(1313);
  const i0 = Math.round(track.at('skull') / track.step) % track.n;
  const O = track.P[i0].clone(), Tt = track.T[i0].clone(), Uu = UP.clone();
  // its frame: facing back up the track (the ships come at its open jaws), level
  const Zs = Tt.clone().setY(0).normalize().negate(), Xs = new THREE.Vector3().crossVectors(Uu, Zs).normalize();
  const M = new THREE.Matrix4().makeBasis(Xs, Uu, Zs).setPosition(O);
  const toW = (p) => p.clone().applyMatrix4(M);
  const spots = { top: [], bottom: [] };
  const sk = skull(spots);
  sk.bone.applyMatrix4(M); sk.teeth.applyMatrix4(M); sk.cups.applyMatrix4(M);
  for (const s of [...spots.top, ...spots.bottom]) s.p.applyMatrix4(M);
  // the neck: down from the knob under the back of the skull, back and away from the track, to the jungle
  const back = Zs.clone().negate(), side = Xs.clone().negate();
  const P0 = toW(v(0, -50, -196));
  const baseXZ = P0.clone().addScaledVector(back, 400).addScaledVector(side, 260);
  const P3 = baseXZ.setY(groundHeight(baseXZ.x, baseXZ.z) + 40);
  const P1 = P0.clone().addScaledVector(back, 230).add(v(0, -140, 0));
  const P2 = P3.clone().add(v(0, 620, 0)).addScaledVector(back, -60).addScaledVector(side, -80);
  const neckCurve = new THREE.CubicBezierCurve3(P0, P1, P2, P3);
  const neckLen = neckCurve.getLength();
  const parts = [], vert = vertebra(1, true), vertD = vertebra(1.5, false), m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), qq = new THREE.Quaternion();
  const place = (g, at, along, dorsal, size, out) => {
    const z = along.clone().normalize(), y = dorsal.clone().addScaledVector(z, -dorsal.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    m4.makeBasis(x, y, z).scale(sc.set(size, size, size)).setPosition(at);
    out.push(g.clone().applyMatrix4(m4));
  };
  const neck = [], neckPts = [];
  for (let s = 52, k = 0; s < neckLen - 30; k++) {
    const t = s / neckLen, size = 80 + 95 * Math.pow(t, 1.2), p = neckCurve.getPointAt(t), tan = neckCurve.getTangentAt(t);
    place(vert, p, tan.clone().negate(), UP.clone().add(back), size * (0.97 + rnd() * 0.06), neck);
    neckPts.push({ p, r: size * 0.75 });
    s += size * 1.04;
  }
  // the body: its spine on along the jungle's roof, ribs arching up out of the canopy and down into it
  const body = [], ribs = [];
  const dir = back.clone().multiplyScalar(0.75).addScaledVector(side, 0.66).normalize(), lat = new THREE.Vector3().crossVectors(UP, dir).normalize();
  let q = P3.clone();
  for (let k = 0; k < 15; k++) {
    const size = 170 - k * 5;
    q = q.clone().addScaledVector(dir, size * 1.06);
    q.y = groundHeight(q.x, q.z) + 30 + 18 * Math.sin(k * 0.7);
    place(vertD, q, dir.clone().negate(), UP, size, body);
    if (k < 1 || k > 12 || rnd() < 0.12) continue;
    const S = (130 - Math.abs(k - 5) * 7) * (0.92 + rnd() * 0.16);
    for (const sx of [1, -1]) {
      if (rnd() < 0.1) continue;                                   // (some fallen into the jungle)
      const broken = rnd() < 0.25 ? 0.55 + rnd() * 0.3 : 1;
      const R = (a, b, c) => q.clone().addScaledVector(lat, a * S * sx).addScaledVector(UP, b * S).addScaledVector(dir, c * S);
      const pts = [R(0.32, 0.15, 0), R(1.15, 0.85, 0.1), R(2.05, 0.65, 0.3), R(2.65, -0.35, 0.5), R(2.9, -1.6, 0.6)];
      const n = Math.max(2, Math.round(pts.length * broken));
      ribs.push(bone(pts.slice(0, n), [[0.09 * S, 0.14 * S], [0.075 * S, 0.12 * S], [0.065 * S, 0.1 * S], [0.055 * S, 0.08 * S], [0.045 * S, 0.06 * S]].slice(0, n),
        { seg: 12, per: 6, amp: 0.1, up: dir, spots }));
    }
  }
  const neckGeo = paint(mergeGeometries([...neck]), 1);
  const bodyGeo = paint(mergeGeometries([...body, ...ribs]), 1.2);
  paint(sk.bone, 1); paint(sk.teeth, 0.25); paint(sk.cups, 0);
  { const c = sk.cups.attributes.color.array; for (let i = 0; i < c.length; i += 3) { c[i] *= 0.16; c[i + 1] *= 0.2; c[i + 2] *= 0.14; } }

  // ---- what grows on it
  const leaves = [], strands = [], plants = { broadleaf: [], palm: [], bush: [] }, lianas = [];
  const PM = new THREE.Matrix4(), E = new THREE.Euler(), Qn = new THREE.Quaternion(), S3 = new THREE.Vector3();
  const tint = (k, h) => new THREE.Color(1 + k * 0.1 + h * 0.22, 1 + k * 0.1, 1 - k * 0.05 - h * 0.25).multiplyScalar(0.72 + 0.5 * Math.abs(k));
  const plant = (sp, p, s) => { E.set((rnd() - 0.5) * 0.3, rnd() * 6.283, (rnd() - 0.5) * 0.3); PM.compose(p, Qn.setFromEuler(E), S3.set(s, s, s)); plants[sp].push({ m: PM.clone(), c: tint(rnd() * 2 - 1, rnd() - 0.5) }); };
  for (const s of spots.top) {
    const up = s.p.clone();
    // moss cushions and leaves along every top; trees and bushes where a bone is broad enough to hold them
    if (rnd() < 0.55 * dens) leaves.push({ c: up.clone().add(v(0, 1, 0)), s: 2.6 + rnd() * 3.4, out: v(rnd() - 0.5, 0.6 + rnd() * 0.4, rnd() - 0.5), wind: 0.15, ao: 0.6 + 0.4 * rnd() });
    if (s.r > 9 && rnd() < 0.2 * dens) plant(rnd() < 0.6 ? 'bush' : rnd() < 0.7 ? 'broadleaf' : 'palm', up.clone().add(v(0, -0.8, 0)), 0.6 + rnd() * 0.6);
  }
  for (const s of spots.bottom) {
    if (rnd() < 0.3 * dens) strands.push({ p: s.p.clone().add(v(0, 1, 0)), len: 8 + Math.pow(rnd(), 1.3) * (s.r > 30 ? 120 : 60), wid: 1.6 + rnd() * 2.4 });
  }
  // the lianas that hold it: three wound down the neck from the skull to the canopy, thick as a tower's legs at the foot
  for (let k = 0; k < 3; k++) {
    const path = [], radii = [], ph = (k / 3) * Math.PI * 2, turns = 3.5 + k * 0.8;
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, p = neckCurve.getPointAt(t), tan = neckCurve.getTangentAt(t);
      const a = new THREE.Vector3().crossVectors(tan, UP).normalize(), b = new THREE.Vector3().crossVectors(a, tan).normalize();
      const r = (80 + 95 * Math.pow(t, 1.2)) * 0.6, ang = ph + t * turns * Math.PI * 2;
      path.push(p.clone().addScaledVector(a, Math.cos(ang) * r).addScaledVector(b, Math.sin(ang) * r));
      radii.push(2.8 + 4 * t);
    }
    lianas.push({ path, radii });
    for (let i = 4; i < path.length; i += 2) {
      if (rnd() < 0.5 * dens) leaves.push({ c: path[i].clone().add(v((rnd() - 0.5) * 8, rnd() * 4, (rnd() - 0.5) * 8)), s: 3 + rnd() * 3.5, out: v(rnd() - 0.5, rnd() * 0.8 - 0.1, rnd() - 0.5), wind: 0.2, ao: 0.55 + 0.45 * rnd() });
      if (rnd() < 0.18) strands.push({ p: path[i].clone(), len: 10 + rnd() * 50, wid: 1.8 + rnd() * 2 });
    }
  }
  // two hanging from the lower jaw's corners, sagging down to the neck
  for (const sx of [1, -1]) {
    const a = toW(v(60 * sx, -48, 120)), b = neckCurve.getPointAt(0.18 + 0.05 * sx), path = [], radii = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; path.push(a.clone().lerp(b, t).add(v(0, -Math.sin(Math.PI * t) * 90, 0))); radii.push(1.6 + 0.8 * Math.sin(Math.PI * t)); }
    lianas.push({ path, radii });
    for (let i = 2; i < path.length - 1; i++) if (rnd() < 0.45) strands.push({ p: path[i].clone(), len: 6 + rnd() * 30, wid: 1.5 + rnd() * 1.8 });
  }
  // where it stands: for the scenery and the fliers to keep clear of
  const centre = toW(v(0, 40, -20));
  const avoid = [{ x: centre.x, z: centre.z, rx: 260, rz: 260, top: centre.y + 320, depth: 520 }];
  for (let t = 0.1; t <= 1; t += 0.15) { const p = neckCurve.getPointAt(t); avoid.push({ x: p.x, z: p.z, rx: 160, rz: 160, top: p.y + 120, depth: 260 }); }
  const mid = P3.clone().addScaledVector(dir, 800);
  avoid.push({ x: mid.x, z: mid.z, rx: 700, rz: 700, top: mid.y + 380, depth: 500 });
  console.info(`skeleton: skull ${((sk.bone.index.count + sk.teeth.index.count) / 3000).toFixed(0)} k tris, neck ${neck.length} vertebrae (${(neckLen / 1000).toFixed(2)} km), ` +
    `${ribs.length} ribs, ${leaves.length} leaf cards, ${strands.length} strands, ${lianas.length} lianas`);
  return { skull: mergeGeometries([sk.bone, sk.teeth, sk.cups]), neck: neckGeo, body: bodyGeo, leaves, strands, plants, lianas, avoid, frame: M, neckCurve };
}

// the bone's material: its painted colour, pitted and cracked up close (world-space noise: a bump and a darkening),
// lit by the sun and the sky (no lamps), only the world's shadow (as the islands)
export function boneMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.defines = { ...mat.defines, FOLIAGE_SHADOW: '' };
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sunOnly(sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBW;
float bH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bH(i), bH(i + vec3(1, 0, 0)), f.x), mix(bH(i + vec3(0, 1, 0)), bH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bH(i + vec3(0, 0, 1)), bH(i + vec3(1, 0, 1)), f.x), mix(bH(i + vec3(0, 1, 1)), bH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  // cracks along the grain, pits: darker in them
  float bc = bN(vBW * 0.07 + bN(vBW * 0.025) * 2.5), bp = bN(vBW * 0.45);
  float crack = 1.0 - smoothstep(0.0, 0.035, abs(bc - 0.5));
  diffuseColor.rgb *= (1.0 - 0.55 * crack) * (0.82 + 0.3 * bp);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float bh = bN(vBW * 0.45) * 0.5 + bN(vBW * 1.6) * 0.2 - (1.0 - smoothstep(0.0, 0.05, abs(bc - 0.5))) * 0.6;
    vec2 dh = vec2(dFdx(bh), dFdy(bh)) * 1.6;
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  }`));
  };
  mat.customProgramCacheKey = () => 'forest-bone';
  return mat;
}
