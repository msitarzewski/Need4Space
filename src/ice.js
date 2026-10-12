// The ice planet: the circuit floats over a frozen sea at the end of a day - the sun on the south-western horizon, a
// crescent ice giant over the south-east, the aurora over the north. The lap jumps a rift off the grid, weaves through
// a garden of giant crystals, threads a wind-carved arch, rolls twice down a gallery of ice, bores through a glacier
// (the dark section: an ice cave lit by its own blue and the ships), corkscrews down past frozen falls, loops over the
// sea, jumps the second rift and climbs to the ice shelf in the south: down the crevasse that splits it, out of its
// western face and off the cliff among its bergs, then north over the broken sea ice - upside down under its own deck
// for half a kilometre (two gravity flips), the floes and the bergs overhead - and home.
import * as THREE from 'three';
import { Track, TRACK_W, layout } from './track.js';
import { setCave } from './look.js';
import { hullMaps } from './hull.js';
import { bakeLater } from './bake.js';
import { Q } from './quality.js';
import { SUN_DIR, SUN_E, SUN_COL, iceSkyDome, iceStars, iceGiant, aurora } from './frost.js';
import { IceSheet, iceMaps, iceSheetMaterial, setGroundGlow, setFloes } from './glacier.js';
import { glacierMaterial, crystalMaterial, crystalGeometry, spireGeometry, sweptIce, TrackGrid, crystalField, glacier,
  icicleGeometry, frozenFall, mergeGeometries } from './spires.js';
import { mulberry32, smoothstep } from './noise.js';
import { Blizzard, WIND } from './blizzard.js';
import { IceShelf, bergGeometry, bergField } from './shelf.js';
import { Storm } from './storm.js';
export { SUN_DIR };
const TRACK_W_HALF = TRACK_W / 2;

// the sun's three shadow cascades, as in space (look.js reads them)
export const SHADOW_HALF = 10, SHADOW_NEAR = 300, SHADOW_FAR = 500;
export const MID_HALF = 45, MID_NEAR = 250, MID_FAR = 550;
export const FAR_HALF = 170, FAR_NEAR = 100, FAR_FAR = 900;
// the ice cave's reach round its centre line and its mouths' fade (m)
const CAVE_R = 52, CAVE_MOUTH = 50;
// the ice shelf's outline (shelf.js roughens it), the field of bergs off its western face, and where the sea ice is
// broken into floes (x, z, radius: soft discs)
const SHELF = [[330, 1760], [740, 1790], [1150, 1790], [1300, 2300], [1280, 2900], [1150, 3400], [800, 3640], [400, 3600],
  [130, 3450], [150, 3200], [220, 2700], [300, 2200]];
const BERGS = { c: new THREE.Vector3(-450, 0, 2500), r: 1000 };
const FLOES = [[-450, 2500, 1300], [700, 2700, 1250], [780, 1450, 650]];
const calm = (x, z) => FLOES.reduce((k, [cx, cz, r]) => Math.max(k, smoothstep(r, r * 0.55, Math.hypot(x - cx, z - cz))), 0);

// The circuit (x east, y up, z south; the ice at y = 0). The grid faces north up the causeway toward the aurora.
const P = [];
const pt = (x, y, z, bank = 0, name = null) => P.push([x, y, z, bank, name]);
// a run of circular arcs from (x, z) heading h (rad, from south toward east), the height easing from y0 to y1:
// [[length, turn (deg, + to the left)]], a point every ~70 m, banked into each arc by its radius; the last one named
const arcs = (x, z, h, y0, y1, list, last) => {
  const total = list.reduce((a, [L]) => a + L, 0);
  let d = 0;
  list.forEach(([L, turn], j) => {
    const n = Math.max(1, Math.round(L / 70)), dh = THREE.MathUtils.degToRad(turn) / n, R = turn ? L / Math.abs(dh * n) : 0;
    for (let k = 0; k < n; k++) {
      h += dh / 2; x += Math.sin(h) * L / n; z += Math.cos(h) * L / n; h += dh / 2; d += L / n;
      pt(x, y0 + (y1 - y0) * d / total, z, turn ? -Math.sign(turn) * Math.min(24, 4200 / R) : 0, j === list.length - 1 && k === n - 1 ? last : null);
    }
  });
  return { x, z, h };
};
pt(-30, 44, 800); pt(0, 44, 560, 0, 'start'); pt(0, 46, 300);
pt(0, 62, 40, 0, 'crest1'); pt(0, 44, -120); pt(-30, 40, -380);                              // the first rift
// the crystal garden: sweepers among the giant crystals, climbing to a crest ~150 m over the ice (each banked into its
// bend: one leant away)
pt(-180, 50, -640, -16); pt(-430, 74, -760, 14); pt(-700, 104, -940, 16, 'garden'); pt(-860, 132, -1230, 12); pt(-830, 146, -1540, 24);
// diving through the great arch, then the gallery: two barrel rolls between walls of crystal
pt(-640, 100, -1800, 10, 'arch'); pt(-360, 68, -1960, 0);
pt(-120, 58, -2010, 0, 'rollIn'); pt(50, 58, -2015, 120); pt(220, 58, -2020, 240); pt(390, 58, -2025, 0, 'rollOut'); pt(620, 66, -1990, 14);
// through the glacier (the bend into it banked into it, not away)
pt(880, 80, -1820, 26); pt(1060, 88, -1560, 8, 'caveIn'); pt(1130, 84, -1260, 0); pt(1150, 76, -960, 0, 'caveOut');
// down the frozen falls in a corkscrew, the loop over the sea
pt(1150, 70, -760, 0, 'preCork'); pt(1140, 52, -580, 120); pt(1120, 34, -400, 240); pt(1090, 24, -220, 0, 'cork');
// (in line with the corkscrew's way out: it was a bend, the pad before the loop in it; the loop's way out 80 m to the
// side of its way in, the step eased across it - taken evenly it kinked the way in and out)
pt(1068, 24, 60, 0, 'preLoop');
for (let k = 0; k <= 12; k++) {
  const a = (k / 12) * Math.PI * 2;
  pt(1065 - 40 * (1 - Math.cos(a / 2)), 104 - 80 * Math.cos(a), 220 + 80 * Math.sin(a), 0, k === 0 ? 'loopIn' : k === 12 ? 'loopOut' : null);
}
// the second rift, then the long climb south to the ice shelf
pt(950, 30, 420); pt(905, 48, 600, 0, 'crest2'); pt(890, 30, 760); pt(830, 38, 1030, -8, 'back'); pt(790, 72, 1330);
pt(730, 112, 1600); pt(700, 132, 1800, 0, 'canyonIn');
// down the crevasse that splits it: an S of ~300 m bends between its walls, a long right-hander, out of its western face
// (shelf.js)
const exit = arcs(700, 1800, Math.atan2(-30, 200), 132, 100,
  [[60, 0], [170, 18], [300, -36], [300, 36], [170, -18], [100, 0], [500, -76], [60, 0]], 'canyonOut');
// the dive off the cliff past the falls to the broken sea ice, among the bergs; a long sweep right (~375 m: it was a
// bend of ~220 m at the dive's foot) onto the way north over the floes, and home
pt(exit.x + Math.sin(exit.h) * 260, 58, exit.z + Math.cos(exit.h) * 260, 0, 'dive');
pt(exit.x + Math.sin(exit.h) * 400, 34, exit.z + Math.cos(exit.h) * 400);
{
  const px = exit.x + Math.sin(exit.h) * 500, pz = exit.z + Math.cos(exit.h) * 500, hx = Math.sin(exit.h), hz = Math.cos(exit.h);
  const R = (px + 714) / (1 + hz), cx = px - hz * R, cz = pz + hx * R, a0 = Math.atan2(pz - cz, px - cx), n = 8;
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((Math.PI - a0) * k) / n;
    pt(cx + R * Math.cos(a), 24 + 4 * k / n, cz + R * Math.sin(a), k === 0 ? 0 : Math.round(16 * Math.sin((Math.PI * k) / n)));
  }
}
// gravity flips: up onto the underside of the deck overhead, half a kilometre upside down over the floes (the bergs
// hanging overhead, the aurora under the nose), and back down
pt(-714, 30, 2560, 0, 'flipA'); pt(-714, 56, 2340, 180, 'flipB'); pt(-704, 58, 2060, 180, 'floes');
pt(-680, 58, 1830, 180, 'flipC'); pt(-650, 36, 1630, 0, 'flipD');
// home: 130 m on from the flip (a ship comes out of it in the air - the bend began there), then an S of two 400 m bends
// onto the run to the line
pt(-631, 37, 1501); pt(-613, 38, 1431, 8); pt(-584, 39, 1365, 13); pt(-543, 40, 1305, 13); pt(-491, 41, 1254, 8); pt(-432, 42, 1212);
pt(-230, 44, 1099); pt(-169, 44, 1056, -8); pt(-117, 44, 1003, -13); pt(-75, 44, 941, -13); pt(-46, 44, 873, -8);

export const ICE_LAYOUT = layout(P, {
  start: [0, 44, 560],
  loops: [['loopIn', 'loopOut']],
  gaps: [['crest1', 35, 105], ['crest2', 35, 105]],
  caves: [['caveIn', -20, 'caveOut', 20]],
  flips: [['flipA', 'flipB'], ['flipC', 'flipD']],
  pads: [['start', 330, 0], ['garden', -260, -10], ['garden', -260, 10], ['arch', 120, 0], ['rollOut', 140, 0],
    ['caveIn', 160, -10], ['preLoop', 20, 0], ['back', -120, 10], ['back', 260, -10], ['canyonOut', -30, 0],
    ['flipA', -180, -10], ['floes', 40, 0], ['flipD', 100, -10]],
  gates: [['start', -60, 0xff3aa8], ['crest1', -90, 0xffb020], ['garden', -40, 0x40ffd0], ['rollIn', -40, 0xb060ff],
    ['caveIn', -70, 0x40c8ff], ['preLoop', -40, 0xff3aa8], ['crest2', -90, 0xffb020], ['canyonIn', -80, 0x40c8ff],
    ['dive', -60, 0xffb020]],
  // its light: magenta barriers, ice-white lanes, cold gantries
  theme: { field: [1.0, 0.14, 0.62], fieldFlash: [1.0, 0.75, 0.95], strip: [1.0, 0.06, 0.42], stripCore: [1.0, 0.8, 0.92],
    lane: [0.05, 0.7, 1.0], laneCore: [0.85, 0.97, 1.0], spill: [0.04, 0.5, 0.9], stud: [1.0, 2.2, 2.8], trim: [1.2, 0.12, 0.6],
    gantry: [1.6, 2.4, 3.2], lamp: [2.2, 2.7, 3.4], moss: false, frost: true, flip: [0.36, 0.42, 1.0] },
});

export class IceWorld {
  constructor(scene, renderer, camera) {
    this.name = 'ice';
    this.lightShafts = true;                        // (main.js: the shafts pass, and where the sun is)
    this.sunDir = SUN_DIR;
    this.dens = { high: 1, mid: 0.6, low: 0.4 }[Q.tier] ?? 1;
    const times = [];
    let t0 = performance.now();
    const lap = (name) => { const t = performance.now(); times.push(`${name} ${Math.round(t - t0)}`); t0 = t; };
    // the backdrop: stars and the ringed giant beyond the air, the air over them, the aurora in front
    this.sky = new THREE.Scene();
    this.skyCam = new THREE.PerspectiveCamera(60, 1, 50, 200000);
    this.stars = iceStars();
    this.giant = iceGiant(renderer);
    this.dome = iceSkyDome(renderer, Q.tier === 'low' ? 384 : 768);
    this.aurora = aurora();
    this.sky.add(this.stars, this.giant, this.dome, this.aurora);
    // the storm in the east: its clouds in the reflections too (baked before them)
    this.storm = new Storm(renderer, this.sky);
    // reflections: the sky without the sun's disc (the sun light makes its own highlight)
    bakeLater([[this.sky, this.skyCam]], () => {
      this.dome.material.uniforms.sunDisc.value = 0;
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(this.sky, 0.02, 50, 200000).texture;
      pm.dispose();
      this.dome.material.uniforms.sunDisc.value = 1;
      scene.environment = this.env;
    });
    scene.environmentIntensity = this.envK = 0.6;
    this.scene = scene;
    this.exposure = 1.0;
    scene.fog = new THREE.FogExp2(0xffffff, 1e-4);       // (on: the air's own chunk does the work, frost.js)
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
    this.track = new Track(ICE_LAYOUT);
    hullMaps(renderer);
    setCave(this.track.caveLines, CAVE_R, CAVE_MOUTH);
    this.shelf = new IceShelf(this.track, SHELF, [this.track.at('canyonIn', -500), this.track.at('canyonOut', 500)]);
    this.track.meshes(scene);
    this.track.bakeDeck(renderer);
    // (the flips' tubes of light: no occluders to the ambient occlusion)
    this.noAO = (this.track.parts.flips || []).filter((m) => m.material.transparent);
    lap('track');
    // (layer 2: seen, but in no cascade's shadow - the scenery; 3 and 4: drawn only in the far / the near depth slice)
    camera.layers.enable(2); camera.layers.enable(3); camera.layers.enable(4);
    this.buildGround(scene, renderer);
    lap('ground');
    this.buildFormations(scene);
    lap('formations');
    this.worldShadow(scene);
    // what casts only into the world's map (drawn once): the scenery on layer 6 and the track's own body (its shadow on
    // the ice far below). three picks a shadow's casters by the main camera's layers, not the shadow camera's - so they
    // cast while that map is drawn and stop after
    this.statics = [];
    scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.castShadow && o.layers.isEnabled(6)) this.statics.push(o); });
    for (const m of [this.track.parts.under]) { m.castShadow = true; this.statics.push(m); }
    this.staticsCast = true;
    // gantry lamps, as in space
    this.lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(new THREE.Color(0.8, 0.9, 1.0), 0, 70, 2); scene.add(l); return l; });
    // the weather: snow streaming across the circuit, diamond dust, the ships' wakes of ice dust (blizzard.js)
    this.snow = new Blizzard(scene, this.dens);
    this.snow.plumes(scene, this.plumeTips);
    this.snow.geysers(scene, this.ventSpots());
    this.noAO.push(...this.snow.meshes);
    this.wakeShips = [];
    this.minimap = this.track;
    this.startIndex = this.track.start;
    lap('lights');
    console.info(`ice built (ms): ${times.join(', ')}`);
  }

  // the frozen sea and the peaks round it; the rifts under the two jumps
  buildGround(scene, renderer) {
    const tr = this.track, box = new THREE.Box3().setFromPoints(tr.P), C = box.getCenter(new THREE.Vector3()).setY(0);
    const f = {};
    const rifts = tr.gaps.filter((g) => !tr.flips.includes(g)).map(([s0, s1]) => {
      tr.frame((s0 + tr.wrap(s1 - s0) / 2), f);
      const dir = f.R.clone().setY(0).normalize();
      return { c: f.P.clone().setY(0), dir, len: 1100, wid: 95, depth: 90 };
    });
    this.ground = new IceSheet(C, rifts, calm);
    iceMaps(renderer);
    this.floeMap();
    const mat = (this.groundMat = iceSheetMaterial());
    // (an integrated GPU or a phone: fewer segments round - the drifts are tens of metres across)
    const seg = this.dens < 1 ? 0.7 : 1;
    const near = this.ground.build(0, 3800, Math.round(480 * seg), 16, mat), far = this.ground.build(3800, 20000, Math.round(640 * seg), 8, mat);
    for (const m of near.meshes) { m.layers.set(2); m.name = 'ice-sheet'; scene.add(m); }
    for (const m of far.meshes) { m.layers.set(3); m.name = 'ice-peaks'; scene.add(m); }
    this.groundMeshes = [...near.meshes, ...far.meshes];
    // (drawn after every other opaque thing - the deck, the ships, the formations hide most of it, and the depth test
    // then skips its pixels; and out of the ambient occlusion's own pass: flat ice, 300 k triangles drawn again)
    for (const m of this.groundMeshes) m.renderOrder = 1;
    this.noAO.push(...this.groundMeshes);
    console.info(`ground: ${((near.tris + far.tris) / 1000).toFixed(0)} k tris, ${rifts.length} rifts`);
  }

  // what stands on the ice: the crystals, the spires, the arch, the glacier and its cave, the frozen falls. Static:
  // layer 2 (seen; no cascade) and 6 (into the world's shadow map, drawn once)
  buildFormations(scene) {
    const tr = this.track, G = this.ground, grid = (this.tgrid = new TrackGrid(tr)), rnd = mulberry32(2718), f = {};
    const add = (m, name, { cast = true, far = false } = {}) => {
      m.name = name;
      m.layers.set(far ? 3 : 2);
      if (cast) m.layers.enable(6);
      m.castShadow = cast; m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const side = (s, lat, out = {}) => {
      tr.frame(s, out);
      const R = out.R.clone().setY(0).normalize();
      const x = out.P.x + R.x * lat, z = out.P.z + R.z * lat;
      return new THREE.Vector3(x, G.height(x, z), z);
    };
    const ice = (this.iceMat = glacierMaterial({ glow: 1.6 }));
    // ---- the crystals: the garden (sweepers among them), the gallery's walls (the rolls), scattered over the sea, and
    // a few enormous ones out toward the peaks
    const clusters = [];
    for (let s = tr.at('crest1', 260); s < tr.at('arch', -120); s += 110 + rnd() * 90) {
      const sd = rnd() < 0.5 ? -1 : 1;
      clusters.push({ c: side(s, sd * (80 + rnd() * 150)), n: 4 + Math.floor(rnd() * 7), size: 90 + rnd() * 130 });
    }
    for (let s = tr.at('rollIn', -80); s < tr.at('rollOut', 80); s += 34 + rnd() * 18) {
      for (const sd of [-1, 1]) clusters.push({ c: side(s, sd * (64 + rnd() * 30)), n: 3 + Math.floor(rnd() * 4), size: 60 + rnd() * 70 });
    }
    const box = new THREE.Box3().setFromPoints(tr.P), ctr = box.getCenter(new THREE.Vector3());
    for (let k = 0; k < 900 && clusters.length < 105; k++) {
      const x = box.min.x - 900 + rnd() * (box.max.x - box.min.x + 1800), z = box.min.z - 900 + rnd() * (box.max.z - box.min.z + 1800);
      const p = new THREE.Vector3(x, 0, z), i = grid.nearest(p, 1e9);
      const d = i < 0 ? 1e9 : Math.hypot(tr.P[i].x - x, tr.P[i].z - z);
      if (d < 140 || G.sample(x, z).rift > 0.05 || this.byShelf(x, z, 160)) continue;
      p.y = G.height(x, z);
      clusters.push({ c: p, n: 3 + Math.floor(rnd() * 8), size: 40 + 200 * Math.pow(rnd(), 1.8) });
    }
    const giants = [];
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, d = 2200 + rnd() * 1800, x = ctr.x + Math.cos(a) * d, z = ctr.z + Math.sin(a) * d;
      if (this.byShelf(x, z, 400)) continue;
      giants.push({ c: new THREE.Vector3(x, G.height(x, z), z), n: 5 + Math.floor(rnd() * 6), size: 260 + rnd() * 380 });
    }
    const cMat = (this.crystalMat = crystalMaterial()), cGeo = crystalGeometry();
    const place = (list, name, far) => {
      const cf = crystalField(list, grid, G, name.length * 7);
      const im = new THREE.InstancedMesh(cGeo, cMat, Math.max(1, cf.mats.length));
      cf.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cf.cols[i]); });
      im.count = cf.mats.length;
      im.computeBoundingSphere();
      add(im, name, { far });
      return cf;
    };
    const cf = place(clusters, 'crystals', false), cg = place(giants, 'crystals-far', true);
    this.glowMap([...cf.pools, ...cg.pools], ctr);
    // ---- spires of glacier ice: near the circuit and along the skyline
    const spires = [], farSpires = [];
    for (let k = 0; k < 2000 && spires.length < 46; k++) {
      const x = box.min.x - 700 + rnd() * (box.max.x - box.min.x + 1400), z = box.min.z - 700 + rnd() * (box.max.z - box.min.z + 1400);
      const i = grid.nearest(new THREE.Vector3(x, 0, z), 1e9), d = i < 0 ? 1e9 : Math.hypot(tr.P[i].x - x, tr.P[i].z - z);
      const h = 90 + 260 * Math.pow(rnd(), 1.5), r = h * (0.1 + 0.06 * rnd());
      if (d < r + 90 || G.sample(x, z).rift > 0.05 || this.byShelf(x, z, r + 120)) continue;
      const g = spireGeometry(h, r, 100 + k).translate(x, G.height(x, z), z);
      if (grid.geometryClear(g, 4, 3) < 0) continue;
      spires.push(g);
    }
    // and needles of it right by the track, their tips over the deck (the speed against them)
    const rn = mulberry32(5150);
    let needles = 0;
    for (let s = 200; s < tr.length - 100; s += 90 + rn() * 110) {
      if (tr.inGap(s, 120) || tr.inLoop(s, 160) || tr.inCave(s, 120)) continue;
      tr.frame(s, f);
      const R = f.R.clone().setY(0).normalize(), sd = rn() < 0.5 ? -1 : 1;
      const h = Math.min(260, Math.max(30, f.P.y) * (0.9 + 1.4 * rn()) + 20), r = h * (0.08 + 0.05 * rn()), lat = TRACK_W_HALF + 16 + r + 40 * rn();
      const x = f.P.x + R.x * sd * lat, z = f.P.z + R.z * sd * lat;
      if (this.byShelf(x, z, r + 40) || G.sample(x, z).rift > 0.05) continue;
      const g = spireGeometry(h, r, 300 + needles, { seg: 14, rows: 28 }).translate(x, G.height(x, z), z);
      if (grid.geometryClear(g, 3, 2) < 0) continue;
      spires.push(g);
      needles++;
    }
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, d = 2600 + rnd() * 2600, x = ctr.x + Math.cos(a) * d, z = ctr.z + Math.sin(a) * d;
      const h = 300 + 500 * rnd();
      if (this.byShelf(x, z, 300)) continue;
      farSpires.push(spireGeometry(h, h * (0.09 + 0.05 * rnd()), 900 + k, { seg: 14, rows: 32 }).translate(x, G.height(x, z), z));
    }
    add(new THREE.Mesh(mergeGeometries(spires), ice), 'spires');
    add(new THREE.Mesh(mergeGeometries(farSpires), ice), 'spires-far', { far: true });
    // the high points the wind tears snow off (blizzard.js plumes): the tall spires' needles
    const tipOf = (g) => { const p = g.attributes.position; let bi = 0; for (let i = 1; i < p.count; i++) if (p.getY(i) > p.getY(bi)) bi = i; return new THREE.Vector3().fromBufferAttribute(p, bi); };
    this.plumeTips = [];
    for (const g of [...spires, ...farSpires]) {
      const t = tipOf(g);
      g.computeBoundingBox();
      const h = t.y - g.boundingBox.min.y;
      if (h > 150) this.plumeTips.push({ p: t, s: Math.min(1.6, h / 260) });
    }
    // ---- the great arch over the track, carved by the wind: feet on the ice either side, its crown ~75 m over the deck
    {
      tr.frame(tr.at('arch'), f);
      const R = f.R.clone().setY(0).normalize(), T = f.T.clone().setY(0).normalize(), pts = [], rad = [];
      for (let i = 0; i <= 96; i++) {
        const t = i / 96, u = t * 2 - 1;
        const lat = u * 175, h = (1 - Math.pow(Math.abs(u), 2.3)) * (f.P.y + 78);
        const p = f.P.clone().setY(0).addScaledVector(R, lat).addScaledVector(T, 18 * Math.sin(t * Math.PI * 1.3));
        p.y = h + (1 - Math.abs(u)) * 0 - 20 * Math.pow(Math.abs(u), 6);
        pts.push(p);
        rad.push(24 + 22 * Math.pow(Math.abs(u), 3) + 6 * Math.sin(t * 9));
      }
      const g = sweptIce(pts, rad, { nr: 40, carve: 0.4, carveScale: 0.018, seed: 4, glowFn: (t, r) => 0.35 + 0.65 * smoothstep(40, 20, r) });
      const c = grid.geometryClear(g, 6, 2);
      console.info(`arch clearance ${c.toFixed(1)} m`);
      add(new THREE.Mesh(g, ice), 'arch');
    }
    // ---- the glacier and its cave
    {
      const [s0, s1] = tr.caves[0];
      const gl = (this.glacier = glacier(tr, s0, s1));
      const boreMat = (this.boreMat = glacierMaterial({ key: 'bore', lamps: true, glow: 2.4, snow: 0, shadows: false }));
      add(new THREE.Mesh(gl.shell, ice), 'glacier');
      // (inside the cave the sun is cut: its walls and icicles look up no shadow map at all - with the cascades'
      // search on every pixel of a screen full of cave they cost a third of a millisecond)
      const bore = add(new THREE.Mesh(gl.bore, boreMat), 'glacier-bore', { cast: false });
      const ig = icicleGeometry(), icm = new THREE.InstancedMesh(ig, boreMat, gl.icicles.length);
      gl.icicles.forEach((m, i) => icm.setMatrixAt(i, m));
      icm.computeBoundingSphere();
      add(icm, 'icicles', { cast: false });
      bore.receiveShadow = icm.receiveShadow = false;
      // frozen falls down its flanks: found by casting in from beside the body at a few places along it
      const shellMesh = new THREE.Mesh(gl.shell), rc = new THREE.Raycaster(), falls = [];
      shellMesh.updateMatrixWorld();
      for (const [along, sd, w, seed] of [[-0.55, 1, 70, 1], [-0.15, 1, 55, 2], [0.35, 1, 80, 3], [-0.4, -1, 60, 4], [0.1, -1, 75, 5], [0.6, -1, 50, 6]]) {
        const o = gl.O.clone().addScaledVector(gl.Z, along * gl.half).addScaledVector(gl.X, sd * 900);
        o.y = gl.O.y + 60;
        rc.set(o, gl.X.clone().multiplyScalar(-sd).setY(0).normalize());
        const hit = rc.intersectObject(shellMesh)[0];
        if (!hit) continue;
        const out = gl.X.clone().multiplyScalar(sd).setY(0).normalize();
        const top = hit.point.clone().addScaledVector(out, -6);
        top.y = gl.O.y + 95;
        falls.push(frozenFall(top, out, w, top.y - G.height(top.x, top.z) + 8, seed));
      }
      if (falls.length) add(new THREE.Mesh(mergeGeometries(falls), glacierMaterial({ key: 'falls', glow: 2.0, snow: 0.3 })), 'frozen-falls');
      // and the snow streaming off its crest: the highest point of each stretch along it
      const sp = gl.shell.attributes.position, bins = new Map(), v = new THREE.Vector3();
      for (let i = 0; i < sp.count; i += 3) {
        v.fromBufferAttribute(sp, i);
        const b = Math.round(v.clone().sub(gl.O).dot(gl.Z) / 90);
        if (!bins.has(b) || bins.get(b).y < v.y) bins.set(b, v.clone());
      }
      for (const t of bins.values()) this.plumeTips.push({ p: t, s: 0.9 });
      console.info(`glacier: ${(gl.shell.index.count / 3000).toFixed(0)} k tris, bore ${(gl.bore.index.count / 3000).toFixed(0)} k, ${gl.icicles.length} icicles, ${falls.length} falls`);
    }
    // ---- the ice shelf (shelf.js): its faces and top, the bridges over its crevasse, falls down its cliffs, its bergs
    {
      const sh = this.shelf, fallMat = glacierMaterial({ key: 'falls', glow: 2.0, snow: 0.3 });
      add(new THREE.Mesh(sh.geometry(), (this.shelfMat = glacierMaterial({ key: 'shelf', glow: 2.2, walls: true }))), 'ice-shelf');
      const br = sh.bridges(grid), fl = sh.falls();
      if (br.length) add(new THREE.Mesh(mergeGeometries(br), ice), 'ice-bridges');
      if (fl.length) add(new THREE.Mesh(mergeGeometries(fl), fallMat), 'shelf-falls');
      const bergs = (this.bergs = bergField(tr, sh, BERGS.c, BERGS.r, 70));
      for (const kind of [0, 1, 2]) for (const v of [0, 1]) {
        const list = bergs.filter((b) => b.kind === kind && b.v === v);
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(bergGeometry(kind, 7 + kind * 2 + v), ice, list.length);
        list.forEach((b, i) => im.setMatrixAt(i, b.m));
        im.computeBoundingSphere();
        add(im, `bergs-${kind}${v}`);
      }
      this.plumeTips.push(...sh.plumeTips(WIND));
      console.info(`shelf: ${(sh.tris / 1000).toFixed(0)} k tris, crevasse ${(sh.sOut - sh.sIn).toFixed(0)} m, ${br.length} bridges, ${fl.length} falls, ${bergs.length} bergs`);
    }
    console.info(`crystals: ${cf.mats.length} (+${cg.mats.length} far, ${cf.dropped} dropped clear of the track), spires ${spires.length} (${needles} by the track) + ${farSpires.length}`);
  }

  // on the shelf or in its bergs' field (within m)
  byShelf(x, z, m) {
    return this.shelf.near(x, z, m) || Math.hypot(x - BERGS.c.x, z - BERGS.c.z) < BERGS.r + m;
  }

  // the floes' map over the shelf's sea: r how open the sea ice is, g under the shelf (all water: its crevasse's floor
  // is the sea) - a small map; glacier.js breaks it into floes per pixel
  floeMap() {
    const N = 512, pad = 200;
    const x0 = Math.min(...FLOES.map(([x, , r]) => x - r)) - pad, z0 = Math.min(...FLOES.map(([, z, r]) => z - r)) - pad;
    const size = Math.max(...FLOES.map(([x, , r]) => x + r - x0), ...FLOES.map(([, z, r]) => z + r - z0)) + pad;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 4;
      img.data[k] = 255 * calm(x0 + ((i + 0.5) / N) * size, z0 + ((j + 0.5) / N) * size);
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#00ff00';
    g.beginPath();
    this.shelf.coast.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](((x - x0) / size) * N, ((z - z0) / size) * N));
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    setFloes(tex, x0, z0, size);
  }

  // the crystals' light pooled on the ice round them: painted once into a map over the ground (glacier.js reads it)
  glowMap(pools, ctr) {
    const N = 1024, SIZE = 9000, x0 = ctr.x - SIZE / 2, z0 = ctr.z - SIZE / 2, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    for (const q of pools) {
      const px = ((q.x - x0) / SIZE) * N, pz = ((q.z - z0) / SIZE) * N, pr = Math.max(2, (q.r / SIZE) * N * 1.6);
      const col = q.col.clone().multiplyScalar(0.55 * q.k), rgb = (a) => `rgba(${Math.round(Math.min(1, col.r) * 255)},${Math.round(Math.min(1, col.g) * 255)},${Math.round(Math.min(1, col.b) * 255)},${a})`;
      const gr = g.createRadialGradient(px, pz, 0, px, pz, pr);
      gr.addColorStop(0, rgb(1)); gr.addColorStop(0.25, rgb(0.55)); gr.addColorStop(1, rgb(0));
      g.fillStyle = gr;
      g.fillRect(px - pr, pz - pr, pr * 2, pr * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    setGroundGlow(tex, x0, z0, SIZE);
  }

  // The world's own shadow: a fourth sun light whose map (drawn once) covers the circuit and its scenery - the track's
  // shadow on the ice, the crystals', the arch's and the glacier's (look.js)
  worldShadow(scene) {
    const box = new THREE.Box3().setFromPoints(this.track.P).expandByScalar(450);
    box.min.y = -120; box.max.y = Math.max(box.max.y, 420);
    const ctr = box.getCenter(new THREE.Vector3()), v = new THREE.Vector3();
    let hx = 0, hy = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v.set(x, y, z).sub(ctr);
      hx = Math.max(hx, Math.abs(v.dot(this.lx))); hy = Math.max(hy, Math.abs(v.dot(this.ly)));
    }
    const l = new THREE.DirectionalLight(SUN_COL, 0), size = Q.tier === 'high' ? 4096 : 2048, D = 6000;
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
    const snow = v.iceSnow !== false;
    this.snow.streams.visible = this.snow.wakes.visible = snow;
    if (this.snow.plume) this.snow.plume.visible = snow;
    this.snow.dust.visible = v.iceDust !== false;
    this.aurora.visible = v.aurora !== false;
    this.storm.visible = v.iceStorm !== false;
    this.snow.vents.visible = v.iceGeysers !== false;
  }

  // the geysers' vents: in the leads of the broken sea ice along the climb to the shelf and over the floes, out to
  // either side of the track, clear of the shelf and of the bergs
  ventSpots() {
    const tr = this.track, rnd = mulberry32(4040), f = {}, out = [];
    for (const [a, b] of [[tr.at('back', 300), tr.at('canyonIn', -120)], [tr.at('dive', 200), tr.at('flipD', 300)]]) {
      for (let s = a; s < b; s += 200 + rnd() * 160) {
        tr.frame(s, f);
        const R = f.R.clone().setY(0).normalize(), sd = rnd() < 0.5 ? -1 : 1, lat = 75 + rnd() * 80;
        const x = f.P.x + R.x * sd * lat, z = f.P.z + R.z * sd * lat;
        if (calm(x, z) < 0.3 || this.shelf.near(x, z, 60) || this.bergs.some((g) => Math.hypot(g.x - x, g.z - z) < g.r + 25)) continue;
        out.push({ p: new THREE.Vector3(x, this.ground.height(x, z) - 1, z), s: 0.8 + 0.5 * rnd() });
      }
    }
    return out;
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

  // the ice under a point (the cameras and free flight stay over it)
  surface(x, z) { return this.ground.height(x, z); }
  height(x, z) { return this.ground.height(x, z); }
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
    const pr = renderer.getPixelRatio() * (this.renderScale || 1);
    this.stars.material.uniforms.pr.value = pr;
    this.stars.material.uniforms.time.value = t;
    this.aurora.material.uniforms.time.value = t;
    // the lightning: a flicker of the sky's light over everything
    if (this.storm.clouds.visible) {
      this.storm.update(t);
      this.scene.environmentIntensity = this.envK * (1 + 0.7 * this.storm.flash);
    }
    const dt = Math.max(0, t - (this.lastT ?? t));
    this.track.update(t, shipPos, dt);
    this.lastT = t;
    // the ships' wakes: under each ship on the deck, behind it (none in the air, none over a cut)
    const tr0 = this.track, ws = this.wakeShips;
    if (this.race) {
      this.race.entries.forEach((e, k) => {
        const r = e.racer, w = (ws[k] ||= { pos: new THREE.Vector3(), vel: new THREE.Vector3(), tail: new THREE.Vector3(), up: new THREE.Vector3(), f: {} });
        tr0.frame(r.s, w.f);
        w.pos.copy(e.ship.root.position);
        w.vel.copy(r.vel);
        w.up.copy(w.f.U);
        w.tail.copy(w.f.P).addScaledVector(w.f.R, r.x).addScaledVector(w.f.T, -7).addScaledVector(w.f.U, 0.4);
        w.low = e.ship.engineOn && !tr0.inGap(r.s, 4) ? 1 - smoothstep(2.5, 6, r.y) : 0;
      });
    }
    // (the crevasse is out of the wind: its snow was a white smear piled up ahead in the dark between the walls)
    const sh = this.shelf, inCrack = sh && sh.sOut > sh.sIn ? smoothstep(0, 80, Math.min(this.track.wrap(s - sh.sIn), this.track.wrap(sh.sOut - s))) * (this.track.inSpan(s, sh.sIn, sh.sOut) ? 1 : 0) : 0;
    this.snow.update(t, dt, camera, pr, ws, Math.max(1 - this.track.caveLight(camera.position), 0.85 * inCrack), this.track.frame(s - 12, this.camDeck ||= {}));
    const tr = this.track, gi = tr.gantryIdx, sIdx = Math.floor(s / tr.step);
    gi.map((i) => ({ i, d: Math.min((i - sIdx + tr.n) % tr.n, (sIdx - i + tr.n) % tr.n) }))
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ i }, k) => {
        const l = this.lamps[k];
        l.position.copy(tr.P[i]).addScaledVector(tr.U[i], 12.9);
        l.color.set(i === gi[0] ? 0xff6a8a : 0xd8ecff);
        l.intensity = i === gi[0] ? 260 : 400;
      });
  }
}
