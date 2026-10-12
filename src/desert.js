// The desert planet: the circuit runs over a sea of dunes at the golden hour - the sun low in the west-north-west, the
// sky rose and violet, dust hazing the distance. Off the grid it jumps a chasm, threads the ruins of a city half buried
// in sand (leaning, broken towers; through one that fell), rolls high over the dunes into a sandstorm, loops, dives
// into a gorge of layered sandstone under two natural bridges, rides a banked wall almost upright round a hairpin,
// skims the dunes to the second chasm, turns over (a gravity flip) to race the sunset upside down, turns back and
// sweeps onto the grid.
import * as THREE from 'three';
import { Track, TRACK_W, layout } from './track.js';
import { hullMaps } from './hull.js';
import { bakeLater } from './bake.js';
import { Q } from './quality.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, SUN_E, SUN_COL, MOON_DIR, dustSkyDome, stormSunT, stormDepth, STORM_C, STORM_R } from './haze.js';
import { Dunes, sandMaps, sandMaterial } from './dunes.js';
import { sandstoneMaterial, mesaGeometry, archGeometry } from './sandstone.js';
import { towerGeometry, pyramidGeometry, fallenTower, ruinMaterial } from './ruins.js';
import { setCave } from './look.js';
import { Simoom, HeatPass } from './simoom.js';
import { GLASS, PANEL } from './ruins.js';
import { TrackGrid } from './spires.js';
import { moonMesh } from './celestial.js';
import { mulberry32, smoothstep, fbm } from './noise.js';
export { SUN_DIR };
const TRACK_W_HALF = TRACK_W / 2;

// the sun's three shadow cascades, as in space (look.js reads them)
export const SHADOW_HALF = 10, SHADOW_NEAR = 300, SHADOW_FAR = 500;
export const MID_HALF = 45, MID_NEAR = 250, MID_FAR = 550;
export const FAR_HALF = 170, FAR_NEAR = 100, FAR_FAR = 900;

// The circuit (x east, y up, z south; the dunes' mean ~y 10). The grid faces north up the west side, the sun ahead-left.
const P = [];
const pt = (x, y, z, bank = 0, name = null) => P.push([x, y, z, bank, name]);
pt(-1320, 40, 560, 0, 'start'); pt(-1320, 42, 260); pt(-1320, 58, 20, 0, 'crest1'); pt(-1320, 40, -140); pt(-1310, 34, -380);
// the ruined city: a slalom between leaning towers (swinging ~25 m either way: at ~40 the bends asked ~270 m/s, the pads
// in them more; each banked into its bend, not away), then straight through the one that fell across the way
pt(-1268, 30, -640, -9); pt(-1316, 28, -1000, 10, 'city'); pt(-1266, 28, -1380, -10); pt(-1300, 30, -1700, 0, 'towerIn'); pt(-1300, 30, -2000, 0, 'towerOut');
// up onto the high road over the dunes (a quarter turn of 540 m from the tower: it was ~300, and the pad after the
// tower ran into it): two barrel rolls, the storm, the loop
pt(-1282, 42, -2140, 8); pt(-1228, 53, -2270, 16); pt(-1142, 65, -2382, 20);
pt(-1030, 77, -2468, 20); pt(-900, 88, -2522, 16); pt(-760, 100, -2540, 8);
pt(-600, 105, -2540, 0, 'rollIn'); pt(-430, 105, -2540, 120); pt(-260, 105, -2540, 240); pt(-90, 105, -2540, 0, 'rollOut');
pt(250, 112, -2500, 6, 'storm'); pt(650, 115, -2440, -6); pt(1000, 110, -2480, 0, 'preLoop');
// (its way out 80 m to the side of its way in, the step eased across it: taken evenly it kinked the way in and out)
for (let k = 0; k <= 12; k++) {
  const a = (k / 12) * Math.PI * 2;
  pt(1150 + 80 * Math.sin(a), 190 - 80 * Math.cos(a), -2480 + 40 * (1 - Math.cos(a / 2)), 0, k === 0 ? 'loopIn' : k === 12 ? 'loopOut' : null);
}
// the dive into the gorge: S-bends banked like a half-pipe under two natural bridges (swinging ~25 m either way: at
// ~38 a ship at 280 m/s could not turn its slide over from one bend to the next)
pt(1330, 104, -2390, 8); pt(1620, 80, -2260, 26); pt(1820, 40, -2030, 26); pt(1880, 0, -1760, 8, 'canyonIn');
pt(1896, -40, -1450, 24); pt(1844, -60, -1120, -45, 'arch1'); pt(1896, -64, -760, 45); pt(1846, -66, -400, -45, 'arch2');
pt(1868, -65, -230, -20); pt(1890, -64, -60, -4);
// out of the gorge a bend of ~400 m (it was ~180) and a straight to the wall: a hairpin round the gorge's end, banked
// almost upright, climbing out
pt(1917, -64, 41, -12); pt(1970, -64, 132, -18); pt(2044, -64, 207, -12); pt(2134, -63, 259, -2); pt(2280, -62, 320, 20, 'wallIn'); pt(2421, -52, 379, 70); pt(2480, -38, 520, 80, 'wall'); pt(2421, -22, 661, 70); pt(2280, -6, 720, 25, 'wallOut');
// low over the dunes to the second chasm, then the flip: upside down into the sunset, and back
pt(2080, 15, 745); pt(1850, 18, 790, -6); pt(1550, 16, 860); pt(1330, 26, 910); pt(1130, 42, 960, 0, 'crest2'); pt(960, 26, 1000); pt(760, 40, 1050);
pt(560, 58, 1100, 0, 'flipA'); pt(350, 84, 1160, 180, 'flipB'); pt(100, 86, 1235, 180); pt(-110, 86, 1300, 180, 'flipC'); pt(-320, 60, 1370, 0, 'flipD');
pt(-640, 56, 1460, 14); pt(-960, 52, 1440, 26); pt(-1200, 48, 1290, 28); pt(-1315, 44, 1060, 12); pt(-1320, 42, 820);

export const DESERT_LAYOUT = layout(P, {
  start: [-1320, 40, 560],
  loops: [['loopIn', 'loopOut']],
  gaps: [['crest1', 35, 105], ['crest2', 35, 105]],
  // the fallen tower's hollow: no sun, no sky - its windows and the ships light it
  caves: [['towerIn', -40, 'towerOut', 15]],
  flips: [['flipA', 'flipB'], ['flipC', 'flipD']],
  pads: [['start', 330, 0], ['city', -170, 10], ['city', 200, -10], ['towerOut', 120, 0], ['rollOut', 220, 0], ['canyonIn', 130, 0],
    ['arch2', 150, 10], ['wallOut', 180, 0], ['crest2', -330, 0], ['flipD', 260, -10], ['flipD', 260, 10]],
  gates: [['start', -60, 0xffa020], ['crest1', -90, 0xff6a18], ['towerIn', -80, 0x20e0c8], ['rollIn', -40, 0xffa020],
    ['preLoop', -40, 0xff5a1a], ['canyonIn', -60, 0x20e0c8], ['wallIn', -50, 0xffa020], ['crest2', -90, 0xff6a18]],
  // its light: amber barriers and strips, teal lanes, warm gantries; sand blown over the deck's edges
  theme: { field: [1.0, 0.42, 0.06], fieldFlash: [1.0, 0.85, 0.6], strip: [1.0, 0.3, 0.03], stripCore: [1.0, 0.82, 0.55],
    lane: [0.0, 0.75, 0.66], laneCore: [0.7, 1.0, 0.94], spill: [0.0, 0.5, 0.44], stud: [2.6, 1.3, 0.35], trim: [1.4, 0.42, 0.06],
    gantry: [2.8, 2.0, 1.2], lamp: [3.0, 2.3, 1.5], flip: [0.0, 0.85, 0.75], moss: false, sand: true },
});

export class DesertWorld {
  constructor(scene, renderer, camera) {
    this.name = 'desert';
    this.scene = scene;
    this.lightShafts = true;                        // (main.js: the shafts pass, and where the sun is)
    this.sunDir = SUN_DIR;
    this.dens = { high: 1, mid: 0.6, low: 0.4 }[Q.tier] ?? 1;
    const times = [];
    let t0 = performance.now();
    const lap = (name) => { const t = performance.now(); times.push(`${name} ${Math.round(t - t0)}`); t0 = t; };
    // the backdrop: the moon beyond the air, the air over it
    this.sky = new THREE.Scene();
    this.skyCam = new THREE.PerspectiveCamera(60, 1, 50, 200000);
    this.dome = dustSkyDome(renderer, Q.tier === 'low' ? 384 : 768);
    this.moon = moonMesh(renderer, SUN_DIR, 2000);
    this.moon.position.copy(MOON_DIR).multiplyScalar(70000);
    this.sky.add(this.moon, this.dome);
    // reflections: the sky without the sun's disc (the sun light makes its own highlight)
    bakeLater([[this.sky, this.skyCam]], () => {
      const u = this.dome.material.uniforms;
      u.sunDisc.value = 0;
      u.camPos.value.set(-1320, 60, 560);
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(this.sky, 0.02, 50, 200000).texture;
      pm.dispose();
      u.sunDisc.value = 1;
      scene.environment = this.env;
    });
    scene.environmentIntensity = 0.62;
    this.exposure = 1.0;
    this.grade = { contrast: 1.16, saturation: 1.15 };      // (post.js GradePass)
    // (on: the air's own chunk does the work, haze.js; its colour carries the storm's strength and clock)
    scene.fog = new THREE.FogExp2(0xffffff, 1e-4);
    this.fog = scene.fog;
    this.fog.color.setRGB(1, 0, 0);
    const sunLight = (intensity, half, near, far, normalBias) => {
      const l = new THREE.DirectionalLight(SUN_COL, intensity);
      l.castShadow = true;
      l.shadow.mapSize.set(4096, 4096);
      const c = l.shadow.camera;
      c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = near; c.far = far;
      l.shadow.bias = -0.0001;
      l.shadow.normalBias = normalBias;
      scene.add(l, l.target);
      return l;
    };
    this.sun = sunLight(SUN_E, SHADOW_HALF, SHADOW_NEAR, SHADOW_FAR, 0.005);
    this.sunMid = sunLight(0, MID_HALF, MID_NEAR, MID_FAR, 0.02);
    this.sunFar = sunLight(0, FAR_HALF, FAR_NEAR, FAR_FAR, 0.07);
    this.lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
    this.ly = new THREE.Vector3().crossVectors(SUN_DIR, this.lx).normalize();
    lap('sky');
    // the circuit
    this.track = new Track(DESERT_LAYOUT);
    hullMaps(renderer);
    setCave(this.track.caveLines, 40, 45);
    this.track.meshes(scene);
    this.track.bakeDeck(renderer);
    // (the flips' field tubes glow, they occlude nothing: out of the ambient occlusion - it drew them as black tubes)
    this.noAO = (this.track.parts.flips || []).filter((m) => m.material.transparent);
    this.grid = new TrackGrid(this.track);
    lap('track');
    // (layer 2: seen, but in no cascade's shadow - the scenery; 3 and 4: drawn only in the far / the near depth slice)
    camera.layers.enable(2); camera.layers.enable(3); camera.layers.enable(4);
    this.planCity();
    this.buildGround(scene, renderer);
    lap('ground');
    this.buildCity(scene);
    lap('city');
    this.buildRock(scene);
    lap('rock');
    this.buildPylons(scene);
    lap('pylons');
    this.worldShadow(scene);
    // what casts only into the world's map (drawn once): the scenery on layer 6 and the track's own body (its long
    // shadow over the dunes). three picks a shadow's casters by the main camera's layers - so they cast while that map
    // is drawn and stop after
    this.statics = [];
    scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.castShadow && o.layers.isEnabled(6)) this.statics.push(o); });
    for (const m of [this.track.parts.under]) { m.castShadow = true; this.statics.push(m); }
    this.staticsCast = true;
    // gantry lamps, as in space
    this.lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.65), 0, 70, 2); scene.add(l); return l; });
    // the wind: sand blowing over the deck, the ships' wakes off the dunes, dust devils; the heat shimmer (main.js)
    this.sand = new Simoom(scene, this.dens, this.devilSpots());
    this.noAO.push(...this.sand.meshes);
    this.heat = new HeatPass();
    this.wakeShips = [];
    this.minimap = this.track;
    this.startIndex = this.track.start;
    this.stormK = 1;
    lap('lights');
    console.info(`desert built (ms): ${times.join(', ')}`);
  }

  // the dunes, the gorge and the chasms (dunes.js)
  buildGround(scene, renderer) {
    const tr = this.track, f = {};
    const rifts = tr.gaps.filter((g) => !tr.flips.includes(g)).map(([s0, s1]) => {
      tr.frame(s0 + tr.wrap(s1 - s0) / 2, f);
      return { c: f.P.clone().setY(0), dir: f.R.clone().setY(0).normalize(), len: 1100, wid: 110, depth: 150 };
    });
    this.dunes = new Dunes(tr, { canyons: [[tr.at('canyonIn', -140), tr.at('wallOut', 60)]], rifts, piles: this.piles || [] });
    sandMaps(renderer);
    const mat = (this.sandMat = sandMaterial());
    const g = this.dunes.build(mat, { dens: this.dens });
    for (const m of g.near) { m.layers.set(2); if (m.castShadow) m.layers.enable(6); scene.add(m); }
    for (const m of g.far) { m.layers.set(3); scene.add(m); }
    this.groundMeshes = [...g.near, ...g.far];
    // (drawn after every other opaque thing - the deck, the ships hide much of it and the depth test skips those
    // pixels; and out of the ambient occlusion's own pass)
    for (const m of this.groundMeshes) m.renderOrder = 1;
    this.noAO.push(...this.groundMeshes);
  }

  // Where the city's towers stand (before the dunes: sand piles against them): along the slalom either side, two
  // leaning in over the road like a gate, more off to the north-west and a few east; the fallen one along the way
  planCity() {
    const tr = this.track, rnd = mulberry32(4040), f = {}, list = [];
    const side = (s, lat) => { tr.frame(s, f); const R = f.R.clone().setY(0).normalize(); return { x: f.P.x + R.x * lat, z: f.P.z + R.z * lat, R }; };
    const tower = (x, z, o = {}) => {
      const big = rnd();
      return { x, z, w: 26 + 34 * rnd(), d: 24 + 30 * rnd(), h: 110 + 230 * Math.pow(big, 0.7), kind: Math.floor(rnd() * 3), sections: 1 + Math.floor(rnd() * 3),
        broken: rnd() < 0.7 ? 12 + 50 * rnd() : 0, seed: list.length * 13 + 5, fins: rnd() < 0.4 ? 2 + Math.floor(rnd() * 2) : 0, rot: rnd() * Math.PI,
        lean: rnd() < 0.6 ? 0.03 + 0.2 * rnd() : 0.01, leanAz: rnd() * Math.PI * 2, sink: 15 + 45 * rnd(), ...o };
    };
    // along the slalom
    for (let s = tr.at('crest1', 260); s < tr.at('towerIn', -60); s += 70 + rnd() * 60) {
      const sd = rnd() < 0.5 ? -1 : 1, p = side(s, sd * (78 + rnd() * 150));
      list.push(tower(p.x, p.z));
    }
    // the gate: two leaning in over the road
    {
      const s = tr.at('city', 40), a = side(s, -84), b = side(s, 84);
      const az = (p, q) => Math.atan2(q.z - p.z, q.x - p.x);
      list.push(tower(a.x, a.z, { w: 44, d: 40, h: 300, kind: 0, sections: 2, broken: 40, lean: 0.24, leanAz: az(a, b) - Math.PI / 2, sink: 30, fins: 2 }));
      list.push(tower(b.x, b.z, { w: 38, d: 46, h: 280, kind: 1, sections: 2, broken: 34, lean: 0.26, leanAz: az(b, a) - Math.PI / 2, sink: 30, fins: 0 }));
    }
    // the city round it: north-west of the track, a few east
    for (let k = 0; k < 600 && list.length < Math.round(70 * Math.max(0.6, this.dens)); k++) {
      const x = -2900 + rnd() * 2300 + (rnd() < 0.2 ? 1800 : 0), z = -2700 + rnd() * 2500;
      const i = tr.nearestIndex(new THREE.Vector3(x, tr.P[0].y, z));
      if (Math.hypot(tr.P[i].x - x, tr.P[i].z - z) < 120) continue;
      if (list.some((t) => Math.hypot(t.x - x, t.z - z) < 70)) continue;
      list.push(tower(x, z, { h: 90 + 320 * Math.pow(rnd(), 1.3) }));
    }
    this.towers = list;
    this.piles = list.map((t) => ({ x: t.x, z: t.z, r: Math.max(t.w, t.d) * 0.75, h: 10 + 14 * rnd() }));
  }

  // the towers on the dunes, kept clear of the track; the fallen tower; the pyramids far off
  buildCity(scene) {
    const tr = this.track, D = this.dunes, grid = this.grid, geos = [];
    let dropped = 0;
    for (const t of this.towers) {
      t.ground = D.height(t.x, t.z);
      let g = towerGeometry(t);
      if (grid.geometryClear(g, 8, 1) < 0) { t.lean *= 0.3; g = towerGeometry(t); }
      if (grid.geometryClear(g, 8, 1) < 0) { dropped++; continue; }
      geos.push(g);
    }
    const mat = (this.ruinMat = ruinMaterial());
    const add = (g, name, farSlice = false) => {
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.layers.set(farSlice ? 3 : 2); m.layers.enable(6);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    add(mergeGeometries(geos), 'towers');
    // the fallen tower: its shell (in the world's shadow) and its hollow (the ships' lights reach it)
    const ft = (this.fallen = fallenTower(tr, tr.at('towerIn', -12), tr.at('towerOut', 6)));
    add(ft.shell, 'fallen-tower');
    const bore = new THREE.Mesh(ft.bore, (this.boreMat = ruinMaterial({ key: 'ruin-inside', inside: true })));
    bore.name = 'fallen-tower-inside';
    bore.layers.set(2);
    bore.receiveShadow = true;
    scene.add(bore);
    console.info(`fallen tower: clearance ${grid.geometryClear(ft.shell, 0, 1).toFixed(1)} m (shell), ${grid.geometryClear(ft.bore, 0, 1).toFixed(1)} m (inside)`);
    // the pyramids
    const pyr = [];
    for (const [x, z, a, h, rot] of [[-3500, -2700, 430, 340, 0.3], [-4400, -1350, 300, 240, 0.75]]) {
      pyr.push(pyramidGeometry({ x, z, a, h, tiers: Math.round(h / 24), ground: D.natural(x, z, true), sink: 70, rot }));
    }
    add(mergeGeometries(pyr), 'pyramids', true);
    console.info(`city: ${geos.length} towers (${dropped} dropped clear of the track)`);
  }

  // mesas and buttes round the circuit and along the skyline; the natural bridges over the gorge
  buildRock(scene) {
    const tr = this.track, D = this.dunes, grid = this.grid, rnd = mulberry32(1913), f = {};
    const C = D.C, near = [], far = [];
    const clear = (g) => grid.geometryClear(g, 6, 7);
    // near: 0.4 - 2 km off the track; kept clear of it and of each other
    const placed = [];
    for (let k = 0; k < 3000 && near.length < Math.round(16 * Math.max(0.6, this.dens)); k++) {
      const a = rnd() * Math.PI * 2, d = 600 + rnd() * 3300, x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      const butte = rnd() < 0.35, r = butte ? 45 + rnd() * 60 : 110 + rnd() * 230, h = butte ? 110 + rnd() * 130 : 70 + rnd() * 120;
      const n = D.field.near(x, z);
      if (n && n.d < r * 1.6 + 120) continue;
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < (q.r + r) * 1.7)) continue;
      if (Math.hypot(x - STORM_C.x, z - STORM_C.z) < 500) continue;
      const ground = Math.min(D.height(x, z), D.height(x + r, z), D.height(x - r, z), D.height(x, z + r), D.height(x, z - r)) - 4;
      const g = mesaGeometry({ x, z, r, h, ground, seed: 300 + k });
      if (clear(g) < 0) continue;
      placed.push({ x, z, r });
      near.push(g);
    }
    for (let k = 0; k < Math.round(42 * Math.max(0.5, this.dens)); k++) {
      const a = rnd() * Math.PI * 2, d = 5200 + Math.pow(rnd(), 0.8) * 9000, x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      const butte = rnd() < 0.3, r = butte ? 80 + rnd() * 120 : 250 + rnd() * 700, h = butte ? 180 + rnd() * 220 : 110 + rnd() * 260;
      far.push(mesaGeometry({ x, z, r, h, ground: D.natural(x, z, true) - 6, seed: 900 + k, far: true }));
    }
    const mat = (this.rockMat = sandstoneMaterial());
    const add = (g, name, farSlice) => {
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.layers.set(farSlice ? 3 : 2); m.layers.enable(6);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    if (near.length) add(mergeGeometries(near), 'mesas', false);
    add(mergeGeometries(far), 'mesas-far', true);
    // the natural bridges over the gorge: a thick span of rock from wall to wall, its underside ~40 m over the deck
    const bridges = [];
    for (const [name, lift, span] of [['arch1', 44, 150], ['arch2', 38, 140]]) {
      tr.frame(tr.at(name), f);
      const Rh = f.R.clone().setY(0).normalize(), pts = [], rad = [];
      for (let i = 0; i <= 64; i++) {
        const u = i / 64 * 2 - 1, p = f.P.clone().addScaledVector(Rh, u * span).addScaledVector(f.T.clone().setY(0).normalize(), 10 * Math.sin(u * 2));
        p.y = f.P.y + lift + 14 + 26 * Math.pow(Math.abs(u), 1.6);
        pts.push(p);
        rad.push(14 + 18 * Math.pow(Math.abs(u), 2.2) + 2 * Math.sin(u * 9));
      }
      const g = archGeometry(pts, rad, { nr: 40, carve: 0.32, scale: 0.025, seed: lift });
      console.info(`${name}: clearance ${grid.geometryClear(g, 0, 2).toFixed(1)} m`);
      bridges.push(g);
    }
    // and a great arch standing alone on the dunes over the low run to the second chasm: its legs ~170 m out either
    // side, its span ~50 m over the deck
    {
      tr.frame(tr.at('crest2', -640), f);
      const Rh = f.R.clone().setY(0).normalize(), Th = f.T.clone().setY(0).normalize(), pts = [], rad = [];
      const g0 = D.height(f.P.x - Rh.x * 175, f.P.z - Rh.z * 175), g1 = D.height(f.P.x + Rh.x * 175, f.P.z + Rh.z * 175), top = f.P.y + 66;
      for (let i = 0; i <= 72; i++) {
        const u = i / 72 * 2 - 1, foot = u < 0 ? g0 : g1;
        const p = f.P.clone().addScaledVector(Rh, u * 175).addScaledVector(Th, 14 * Math.sin(u * 2.4));
        p.y = foot - 14 + (top - foot + 14) * (1 - Math.pow(Math.abs(u), 2.4));
        pts.push(p);
        rad.push(16 + 16 * Math.pow(Math.abs(u), 3) + 3 * Math.sin(u * 7));
      }
      const g = archGeometry(pts, rad, { nr: 40, carve: 0.34, scale: 0.022, seed: 9 });
      console.info(`great arch: clearance ${grid.geometryClear(g, 0, 2).toFixed(1)} m`);
      bridges.push(g);
    }
    add(mergeGeometries(bridges), 'bridges', false);
    console.info(`rock: ${near.length} mesas and buttes near, ${far.length} far`);
  }

  // Slender pylons under the high road: a tapered column from the sand to a crosshead under the deck's girders, every
  // ~120 m wherever the deck runs level and well clear of the sand (none under a cut, a loop, a flip or upside down)
  buildPylons(scene) {
    const tr = this.track, D = this.dunes, pos = [], fac = [], idx = [];
    const box = (M, w, h, d, y0, kind) => {
      const o = pos.length / 3, v = new THREE.Vector3();
      const c = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]];
      for (const [x, y, z] of c) { v.set(x * w / 2, y0 + y * h, z * d / 2).applyMatrix4(M); pos.push(v.x, v.y, v.z); fac.push(x * w / 2 + z * d / 2, y0 + y * h, kind); }
      for (const q of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) idx.push(o + q[0], o + q[1], o + q[2], o + q[0], o + q[2], o + q[3]);
    };
    const taper = (M, r0, r1, y0, y1) => {
      const o = pos.length / 3, v = new THREE.Vector3(), n = 8;
      for (let k = 0; k <= n; k++) for (const [y, r] of [[y0, r0], [y1, r1]]) {
        const a = (k / n) * Math.PI * 2;
        v.set(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(M); pos.push(v.x, v.y, v.z); fac.push((k / n) * 2 * Math.PI * r0, y, PANEL);
      }
      for (let k = 0; k < n; k++) { const a = o + k * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    };
    let n = 0;
    const M = new THREE.Matrix4();
    for (let s = 60; s < tr.length; s += 120) {
      if (tr.inGap(s, 50) || tr.inLoop(s, 80) || tr.inFlip(s, 60) || tr.inCave(s, 60)) continue;
      const f = tr.frame(s);
      if (f.U.y < 0.93) continue;
      const g = D.height(f.P.x, f.P.z), top = f.P.y - 1.8 - 2.4 - 1.6 - g;
      if (top < 16) continue;
      // nothing of the track's other parts in the column's way
      let clear = true;
      for (let y = 4; y < top - 8 && clear; y += 6) {
        const p = new THREE.Vector3(f.P.x, g + y, f.P.z), i = tr.nearestIndex(p);
        if (Math.abs(tr.wrap(i * tr.step - s + tr.length / 2) - tr.length / 2) > 150 && tr.P[i].distanceTo(p) < 40) clear = false;
      }
      if (!clear) continue;
      // the column's frame: on the sand under the deck, turned with it
      const T = f.T.clone().setY(0).normalize(), R = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0));
      M.makeBasis(R, new THREE.Vector3(0, 1, 0), T.clone().negate()).setPosition(f.P.x, g - 6, f.P.z);
      const h = top + 6;
      taper(M, 3.2, 1.9, 0, h - 3);
      box(M, 4.2, 3, 4.2, h - 3, PANEL);                                  // the head
      box(M, 27, 1.6, 3.2, h - 0.2, PANEL);                               // the crosshead under the girders
      for (const sd of [-1, 1]) box(new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(sd * 12, 0, 0)), 2.6, 0.6, 2.6, h + 1.4, PANEL);
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('fac', new THREE.Float32BufferAttribute(fac, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.ruinMat);
    m.name = 'pylons';
    m.layers.set(2); m.layers.enable(6);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    console.info(`pylons: ${n}`);
  }

  // where the dust devils wander: on the dunes a few hundred metres off the track, clear of the city and the storm
  devilSpots() {
    const tr = this.track, D = this.dunes, rnd = mulberry32(66), out = [];
    for (let k = 0; k < 400 && out.length < 7; k++) {
      const i = Math.floor(rnd() * tr.n), f = tr.frame(i * tr.step), R = f.R.clone().setY(0).normalize();
      const lat = (rnd() < 0.5 ? -1 : 1) * (140 + rnd() * 420), x = f.P.x + R.x * lat, z = f.P.z + R.z * lat;
      const n = D.field.near(x, z);
      if (n && n.d < 110) continue;
      if (Math.hypot(x - STORM_C.x, z - STORM_C.z) < STORM_R.x + 200 || (x < -1000 && z < -300)) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < 900)) continue;
      out.push({ x, z, y: D.height(x, z) - 2, h: 110 + rnd() * 120 });
    }
    return out;
  }

  // The world's own shadow: a fourth sun light whose map (drawn once) covers the circuit and its scenery - the track's
  // long shadow over the dunes, the mesas', the gorge's on the deck in it (look.js)
  worldShadow(scene) {
    const box = new THREE.Box3().setFromPoints(this.track.P).expandByScalar(900);
    box.min.y = -160; box.max.y = Math.max(box.max.y, 420);
    const ctr = box.getCenter(new THREE.Vector3()), v = new THREE.Vector3();
    let hx = 0, hy = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v.set(x, y, z).sub(ctr);
      hx = Math.max(hx, Math.abs(v.dot(this.lx))); hy = Math.max(hy, Math.abs(v.dot(this.ly)));
    }
    const l = new THREE.DirectionalLight(SUN_COL, 0), size = Q.tier === 'high' ? 4096 : 2048, D = 8000;
    l.castShadow = true;
    l.shadow.mapSize.set(size, size);
    const c = l.shadow.camera;
    c.left = -hx; c.right = hx; c.top = hy; c.bottom = -hy; c.near = 10; c.far = D * 2;
    l.position.copy(ctr).addScaledVector(SUN_DIR, D);
    l.target.position.copy(ctr);
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 1.0;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
    scene.add(l, l.target);
    l.updateMatrixWorld(); l.target.updateMatrixWorld();
    this.sunWorld = l;
    console.info(`world shadow: ${size} px over ${(2 * hx / 1000).toFixed(1)} x ${(2 * hy / 1000).toFixed(1)} km`);
  }

  // Shadows (the setting): High / Medium - the sun's three cascades and the world's map; Off - no cascades drawn a
  // frame, the sun itself carries the world's map, drawn once (Laptop mode)
  shadowMode(size, renderer) {
    const worldOnly = !size, S = this.sun, W = this.sunWorld;
    renderer.shadowMap.enabled = true;
    if (this.worldOnly === worldOnly) return;
    this.worldOnly = worldOnly;
    const cam = (l, src) => { const c = l.shadow.camera; Object.assign(c, src); c.updateProjectionMatrix(); };
    if (worldOnly) {
      const c = W.shadow.camera;
      cam(S, { left: c.left, right: c.right, top: c.top, bottom: c.bottom, near: c.near, far: c.far });
      S.shadow.mapSize.copy(W.shadow.mapSize);
      S.shadow.bias = W.shadow.bias; S.shadow.normalBias = W.shadow.normalBias;
      S.position.copy(W.position); S.target.position.copy(W.target.position);
      S.updateMatrixWorld(); S.target.updateMatrixWorld();
      S.shadow.autoUpdate = false;
      for (const l of [this.sunMid, this.sunFar, W]) l.castShadow = false;
    } else {
      cam(S, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: SHADOW_NEAR, far: SHADOW_FAR });
      S.shadow.bias = -0.0001; S.shadow.normalBias = 0.005;
      S.shadow.autoUpdate = true;
      for (const l of [this.sunMid, this.sunFar, W]) l.castShadow = true;
      W.shadow.needsUpdate = true;
    }
    S.shadow.map?.dispose();
    S.shadow.map = null;
    S.shadow.needsUpdate = true;
    this.castStatics?.(true);
  }

  // the settings' switches for this world's own effects (main.js, on every change)
  setOptions(v) {
    this.stormK = v.sandstorm !== false ? 1 : 0;
    const fx = v.sandFx !== false;
    this.sand.streams.visible = this.sand.wakes.visible = fx;
    this.sand.devils.visible = v.dustDevils !== false && this.sand.devilList.length > 0;
    this.sand.stormOn = !!this.stormK;
    this.heat.enabled = v.heatHaze !== false;
  }

  // the static casters on (the world's map is about to be drawn) or off (it has been)
  castStatics(on) {
    if (this.staticsCast === on) return;
    for (const o of this.statics) o.castShadow = on;
    this.staticsCast = on;
  }

  // keep a camera out of the track slab (deck, walls, fields): over the barrier tops if it is inside
  clearance(p) {
    const tr = this.track, i = tr.nearestIndex(p), d = p.clone().sub(tr.P[i]);
    const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
    if (Math.abs(x) < TRACK_W_HALF + 4 && y > -6 && y < 6.5) p.addScaledVector(tr.U[i], 6.5 - y);
  }

  // the sand under a point (the cameras and free flight stay over it)
  surface(x, z) { return this.dunes.height(x, z); }
  height(x, z) { return this.dunes.height(x, z); }
  hit() { return null; }

  // the cascades round the ship, the pack and ahead (space.js), each snapped to its texels
  follow(p, camera) {
    if (this.worldOnly) return;
    const place = (light, half, centre) => {
      const texel = (2 * half) / light.shadow.mapSize.x, c = light.shadow.camera;
      const a = Math.round(centre.dot(this.lx) / texel) * texel, b = Math.round(centre.dot(this.ly) / texel) * texel;
      const q = this.lx.clone().multiplyScalar(a).addScaledVector(this.ly, b).addScaledVector(SUN_DIR, centre.dot(SUN_DIR));
      light.target.position.copy(q);
      light.position.copy(q).addScaledVector(SUN_DIR, (c.near + c.far) / 2);
    };
    place(this.sun, SHADOW_HALF, p);
    const fwd = camera ? new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion) : null;
    place(this.sunMid, MID_HALF, camera ? camera.position.clone().addScaledVector(fwd, 30) : p);
    place(this.sunFar, FAR_HALF, camera ? camera.position.clone().addScaledVector(fwd, 140) : p);
  }

  update(t, camera, shipPos, s, renderer) {
    // the world's map drawn (three clears needsUpdate when it has): the statics stop casting
    if (this.staticsCast && !this.sunWorld.shadow.needsUpdate && !(this.worldOnly && this.sun.shadow.needsUpdate)) this.castStatics(false);
    this.skyCam.quaternion.copy(camera.quaternion);
    this.skyCam.fov = camera.fov;
    this.skyCam.aspect = camera.aspect;
    this.skyCam.updateProjectionMatrix();
    const dt = Math.max(0, t - (this.lastT ?? t));
    this.track.update(t, shipPos, dt);
    this.lastT = t;
    // the storm: its strength and clock to every lit material (the fog colour) and the dome; the sun through it
    const u = this.dome.material.uniforms;
    u.camPos.value.copy(camera.position); u.time.value = t; u.storm.value = this.stormK;
    this.fog.color.setRGB(this.stormK, t % 1000, 0);
    // the ships' wakes off the dunes: under each one skimming the sand (the deck within ~30 m of it)
    const pr = renderer.getPixelRatio() * (this.renderScale || 1), ws = this.wakeShips;
    if (this.race) {
      this.race.entries.forEach((e, k) => {
        const w = (ws[k] ||= { pos: new THREE.Vector3(), vel: new THREE.Vector3(), sides: [new THREE.Vector3(), new THREE.Vector3()] });
        const p = e.ship.root.position, n = this.track.n, i = ((Math.floor(e.racer.s / this.track.step) % n) + n) % n, R = this.track.R[i];
        const g = this.dunes.height(p.x, p.z), rl = Math.hypot(R.x, R.z) || 1;
        w.pos.copy(p); w.vel.copy(e.racer.vel);
        // (the field's downwash blows the sand out from under the deck: it boils up past both its edges)
        for (const [j, sd] of [[0, -1], [1, 1]]) {
          const x = p.x + (R.x / rl) * sd * (33 - e.racer.x * sd * 0.3), z = p.z + (R.z / rl) * sd * (33 - e.racer.x * sd * 0.3);
          w.sides[j].set(x, this.dunes.height(x, z), z);
        }
        w.low = e.ship.engineOn && this.track.U[i].y > 0.5 ? 1 - smoothstep(10, 26, p.y - g) : 0;
      });
    }
    this.sand.update(t, dt, camera, pr, ws, 1 - this.track.caveLight(camera.position), this.track.frame(s - 12, this.camDeck ||= {}));
    this.heat.quad.material.uniforms.time.value = t;
    const sunT = stormSunT(camera.position, this.stormK), deep = stormDepth(camera.position) * this.stormK;
    this.sun.intensity = SUN_E * (0.15 + 0.85 * sunT);
    this.sun.color.copy(SUN_COL).lerp(new THREE.Color(1.0, 0.45, 0.2), 1 - sunT);
    this.scene.environmentIntensity = 0.62 * (1 - 0.55 * smoothstep(0, 0.5, deep));
    const tr = this.track, gi = tr.gantryIdx, sIdx = Math.floor(s / tr.step);
    gi.map((i) => ({ i, d: Math.min((i - sIdx + tr.n) % tr.n, (sIdx - i + tr.n) % tr.n) }))
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ i }, k) => {
        const l = this.lamps[k];
        l.position.copy(tr.P[i]).addScaledVector(tr.U[i], 12.9);
        l.color.set(i === gi[0] ? 0xff6a40 : 0xffe0b8);
        l.intensity = i === gi[0] ? 260 : 380;
      });
  }
}
