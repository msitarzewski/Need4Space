// The derelict's plan: where the great ship lies, how it broke, the frames of its pieces and of the smaller wrecks
// drifting off its bow, and the circuit's way through and round all of it. Numbers only (no three.js): track.js lays
// its control points from here, wreck.js builds the hulls on the same frames.
//
// The way: in through the bell of its main engine, the engine block, the reactor hall (the core still burning, held
// in its rings), the machinery, the ruptured fore end of the stern piece in the sun; a jump across where it broke
// into the snapped-off middle piece, another into the fore piece; its cargo holds (collapsed bulkheads, the long
// straight down the hold), the hangar, out through a breach in its flank into the graveyard of smaller wrecks off
// its bow; round in front of the bow and back along its back in a trench between armour and turrets, over the
// break, up into the command tower's control deck and down off the stern.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const madd = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
// v turned by ang (rad) about the unit axis k
const turn = (v, k, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang), kv = cross(k, v), kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
};
const deg = Math.PI / 180;

// the great ship as it lay before it broke: its stern's centre, the way to its bow (local z of its pieces runs aft)
const S = [3790, -215, 2480], ZS = unit([0.42, 0, 0.91]), UP = [0, 1, 0], XS = cross(UP, ZS);
// a point in the ship's frame: zeta from the stern toward the bow, x to port, y up
export const shipAt = (zeta, x = 0, y = 0) => madd(madd(madd(S, ZS, zeta), XS, x), UP, y);
export const SHIP_LEN = 4300;

// sections (m): the long octagon's half width, half height, top and bottom chamfers; the frames' spacing and depth
export const GREAT = { hw: 300, hh: 175, ct: 105, cb: 85, ribEvery: 32, ribD: 6, ribW: 1.4, skin: 2.4 };

// A piece: local x to starboard, y up, z aft from its forward end F to its aft end A, rolled about its own axis
// (deg) - a derelict drifts: no piece is level with another
function piece(name, F, A, roll, sec, extra = {}) {
  const Z = unit(sub(A, F)), Y0 = unit(madd(UP, Z, -dot(UP, Z))), Y = turn(Y0, Z, roll * deg), X = cross(Y, Z);
  return { name, O: F, X, Y, Z, len: Math.hypot(...sub(A, F)), roll, sec, ...extra };
}
// the three pieces of the great ship: the fore piece (bow to where it broke), the middle piece that snapped out of
// it, the stern piece (from its torn front to the engine block)
export const PIECES = [
  piece('fore', shipAt(SHIP_LEN, -35, 30), shipAt(1990, 0, 0), 8, GREAT, { taper: 650, tip: 0.22 }),
  piece('mid', shipAt(1880, 25, -14), shipAt(1560, -30, -30), 26, GREAT),
  piece('aft', shipAt(1450, 0, 0), shipAt(0, 0, 0), -5, GREAT),
];
export const pieceOf = (name) => PIECES.find((p) => p.name === name);
export const toWorld = (P, x, y, z) => madd(madd(madd(P.O, P.X, x), P.Y, y), P.Z, z);

// the graveyard off the bow: frigates and smaller hulks, some broken, placed by the way (m after the breach): one it
// flies through (from .. to, its axis y m over the deck, rolled to it), the two halves of one it threads between,
// one it passes under, the rest further out (x y z in the fore piece's frame: ahead of the bow z is negative)
export const FRIGATE = { hw: 58, hh: 36, ct: 20, cb: 14, ribEvery: 12, ribD: 2.4, ribW: 0.6, skin: 1.1 };
export const GRAVEYARD = [
  { name: 'frig1', how: 'through', from: 840, to: 1070, y: 6, roll: 7 },
  { name: 'frig2a', how: 'beside', at: 1640, side: 1, gap: 66, len: 300, yaw: 0.35, y: 10, roll: -18 },
  { name: 'frig2b', how: 'beside', at: 1700, side: -1, gap: 70, len: 240, yaw: -0.5, y: -14, roll: 24 },
  { name: 'frig3', how: 'over', at: 2420, clear: 64, len: 380, yaw: 1.1, roll: 160 },
  { name: 'frig4', how: 'far', p: [-1250, -180, -900], dir: [0.3, 0.1, 1], len: 520, roll: 40 },
  { name: 'frig5', how: 'far', p: [900, 420, -1300], dir: [1, -0.2, 0.4], len: 440, roll: -70 },
  { name: 'frig6', how: 'far', p: [-900, 380, 300], dir: [0.1, 0.3, 1], len: 360, roll: 110 },
];

// ---- the way through: [piece, x, y, z, bank (deg, on the piece's own deck: + = right edge down), name]; a point
// 'world' is x y z in the world. Going toward the bow (z falling) starboard (+x) is on the right; going aft, on the left.
const WAY = [
  // the main engine's bell, its throat through the engine block
  ['aft', 0, -35, 1720, 0, 'wreckIn'],
  ['aft', 0, -36, 1560],
  ['aft', 0, -38, 1420],
  // the reactor hall: round the core (it hangs left of the way, high)
  ['aft', 22, -44, 1300, -4],
  ['aft', 55, -52, 1170, -8],
  ['aft', 38, -48, 1040, -4],
  ['aft', 0, -50, 920],
  // the machinery: under one drum, over the next
  ['aft', -25, -60, 800, 4],
  ['aft', -32, -46, 680, 2],
  ['aft', -14, -22, 560],
  // the ruptured fore end of the stern piece, climbing in the sun to the crest; across the cut (the line runs straight
  // on through the middle piece, the stern piece's frame ahead of its torn front) and the next crest
  ['aft', 10, 6, 430, -3],
  ['aft', 10, 34, 300],
  ['aft', 0, 56, 180],
  ['aft', 0, 68, 70, 0, 'jump1'],
  ['aft', 0, 62, -30],
  ['aft', 0, 54, -150],
  ['aft', 0, 52, -270],
  ['aft', 0, 59, -370, 0, 'jump2'],
  ['aft', 0, 50, -470],
  // the fore piece: its torn end, the cargo holds - a bulkhead's gaps left then right, the long hold where gravity
  // turns over (up onto the deck overhead, along it upside down, back down), another collapsed bulkhead (the jinks
  // through the gaps ~7 m: at ~15 the ships went into the flip, and came out of it, sliding into the wall)
  ['fore', 0, 30, 2230],
  ['fore', 0, 12, 2140],
  ['fore', -7, -12, 2060, 2],
  ['fore', 6, -36, 1960, -2],
  ['fore', 0, -45, 1910],
  ['fore', 0, -45, 1860, 0, 'flipA'],
  ['fore', 0, -21, 1680, 180, 'flipB'],
  ['fore', 0, -21, 1580, 180, 'flipC'],
  ['fore', 0, -45, 1400, 0, 'flipD'],
  ['fore', 0, -48, 1330],
  ['fore', -8, -55, 1230, 2],
  ['fore', 7, -70, 1120, -2],
  // the hangar: down among the racks, up and out through the breach in its port flank
  ['fore', 5, -100, 1010],
  ['fore', -10, -122, 880],
  ['fore', -25, -108, 760],
  ['fore', -80, -75, 680, -10],
  ['fore', -175, -40, 610, -18, 'breach'],
  ['fore', -330, -20, 540, 0],
  // the graveyard: out to port, round in front of the bow, back down its starboard side and onto its back (banked into
  // the long right-hander round the bow and the left onto the back, not away)
  ['fore', -520, 0, 420, 14],
  ['fore', -650, 28, 160, 22],
  ['fore', -670, 58, -190, 28],
  ['fore', -540, 88, -520, 32],
  ['fore', -240, 116, -720, 34],
  ['fore', 100, 136, -740, 34],
  ['fore', 380, 156, -560, 30],
  ['fore', 500, 168, -250, 20],
  ['fore', 440, 172, 80, 0],
  ['fore', 230, 166, 290, -16],
  ['fore', 50, 172, 480, -14, 'trench'],
  // the trench along its back (going aft: starboard on the left), banked sweepers between its turrets (swinging ~28 m:
  // at ~40 its pad threw the ships into the next one)
  ['fore', 0, 196, 720, -10],
  ['fore', 28, 192, 1020, 8],
  ['fore', -28, 192, 1370, -8],
  ['fore', 25, 193, 1720, 6],
  ['fore', 0, 198, 2050, 0],
  // over the break (the stern piece's frame ahead of its torn front)
  ['aft', 0, 230, -420],
  ['aft', 0, 236, -260],
  ['aft', 0, 218, -100],
  // the stern piece's back; the ramp up to the command tower's control deck, through it, down off the stern
  ['aft', -24, 194, 140, -6],
  ['aft', 8, 194, 400, 3],
  ['aft', 0, 206, 590],
  ['aft', 0, 246, 770, 0, 'tower'],
  ['aft', 0, 250, 940],
  ['aft', 0, 244, 1080, 0, 'towerOut'],
  ['aft', 0, 210, 1250],
  ['aft', -20, 196, 1450],
  ['aft', -60, 152, 1720, 0, 'wreckOut'],
];

// the circuit's control points for the way: [x, y, z, bank, name] in the world; each bank turned by the piece's own
// roll, as seen along the way there
export function wreckRoute() {
  const pts = WAY.map(([pc, x, y, z]) => (pc === 'world' ? [x, y, z] : toWorld(pieceOf(pc), x, y, z)));
  return WAY.map((w, i) => {
    const [pc, , , , bank = 0, name = null] = w, p = pts[i];
    if (pc === 'world') return [...p, bank, name];
    const T = unit(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const u0 = unit(madd(UP, T, -dot(UP, T))), r0 = cross(T, u0), Y = pieceOf(pc).Y, up = unit(madd(Y, T, -dot(Y, T)));
    return [...p, bank + Math.atan2(dot(up, r0), dot(up, u0)) / deg, name];
  });
}
