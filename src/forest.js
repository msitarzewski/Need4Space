// The forest moon: the circuit floats in the sky of a jungle world, ~1.3 km over an endless canopy, threading a
// field of floating islands - under an arch of falling water, across a jump between the Twins, through a canyon of
// rock pillars hung with vines, down a spiral round the trunk of a colossal tree, through a cave in a hollow island
// and out over the abyss through a waterfall. The gas giant the space circuit floats over hangs in its sky.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Track, TRACK_W, layout } from './track.js';
import { setCave } from './look.js';
import { hullMaps } from './hull.js';
import { rockMaps } from './rock.js';
import { bakeLater } from './bake.js';
import { mulberry32 } from './noise.js';
import { SUN_DIR, SUN_E, SUN_COL, GIANT_DIR, skyDome } from './atmo.js';
import { Abyss, groundHeight } from './abyss.js';
import { islandShape, islandMaps, islandMaterial, trackClearance } from './islands.js';
import { Flora, leafCards, barkTube } from './flora.js';
import { trackVines, gantryIvy, vineCanopy, canyonBridges } from './overgrowth.js';
import { Waters } from './water.js';
import { hollowIsland, caveGlow } from './cave.js';
import { greatTree } from './greattree.js';
import { Creatures } from './creatures.js';
import { Q } from './quality.js';
import { fbm, smoothstep } from './noise.js';
import { giantMaterial, ringMaterial, moonMesh, RING_IN, RING_OUT } from './celestial.js';
export { SUN_DIR };
const TRACK_W_HALF = TRACK_W / 2;

// the sun's three shadow cascades, as in space (look.js reads them)
export const SHADOW_HALF = 10, SHADOW_NEAR = 300, SHADOW_FAR = 500;
export const MID_HALF = 45, MID_NEAR = 250, MID_FAR = 550;
export const FAR_HALF = 170, FAR_NEAR = 100, FAR_FAR = 900;

// The circuit (x east, y up, z south; the start straight runs north on the west side, then clockwise)
const P = [];
const pt = (x, y, z, bank = 0, name = null) => P.push([x, y, z, bank, name]);
pt(-1155, -28, 860); pt(-1150, -6, 620); pt(-1150, 0, 400, 0, 'start'); pt(-1150, 3, 100);
// the north-west corner, climbing to the falls: a river arcs off the Cascade's cliff over the track
pt(-1110, 22, -170); pt(-960, 48, -410, 22); pt(-700, 64, -545, 12, 'fallsIn');
pt(-380, 72, -600, 0, 'falls'); pt(-80, 68, -590, -4, 'fallsOut');
// under the Lantern island's hanging roots, the north-east corner, the jump between the Twins
pt(220, 52, -560, -8, 'under'); pt(500, 44, -470, 0);
pt(740, 50, -300, 28); pt(840, 46, -40, 6); pt(860, 56, 160, 0, 'crest1'); pt(855, 34, 300); pt(845, 22, 450);
// the canyon of pillars, rolling twice round the ship under the vines
pt(835, 14, 600, 0, 'canyonIn'); pt(825, 8, 760, 120); pt(815, 2, 920, 240); pt(805, -4, 1080, 0, 'canyonOut');
// down round the Great Tree's trunk: one turn, 125 m of descent, under its own entry
pt(750, -40, 1300, 25); pt(560, -80, 1440, 18);
export const TREE_C = new THREE.Vector3(300, 0, 1290), TREE_R = 175;
for (let k = 0; k <= 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  pt(Math.round(TREE_C.x - TREE_R * Math.sin(a)), Math.round(-100 - 125 * k / 8), Math.round(TREE_C.z + TREE_R * Math.cos(a)),
    k > 0 && k < 8 ? 30 : 22, k === 0 ? 'treeIn' : k === 8 ? 'treeOut' : null);
}
// through the Hollow island, out of its cave over the abyss through a waterfall (the second jump), the loop
pt(60, -228, 1480, 0, 'caveIn'); pt(-170, -226, 1475); pt(-400, -214, 1462, 0, 'caveOut'); pt(-560, -228, 1452); pt(-660, -216, 1450, 0, 'preLoop');
for (let k = 0; k <= 12; k++) {
  const a = (k / 12) * Math.PI * 2;
  pt(-790 - 80 * Math.sin(a), -136 - 80 * Math.cos(a), 1450 - 80 * k / 12, 0, k === 0 ? 'loopIn' : k === 12 ? 'loopOut' : null);
}
// the long climb home
pt(-960, -212, 1355); pt(-1100, -170, 1220, 22); pt(-1170, -100, 1040, 10);

export const FOREST_LAYOUT = layout(P, {
  start: [-1150, 0, 400],
  loops: [['loopIn', 'loopOut']],
  gaps: [['crest1', 35, 105], ['caveOut', 14, 86]],
  caves: [['caveIn', -30, 'caveOut', 12]],
  pads: [['start', 330, 0], ['fallsIn', -170, -10], ['fallsIn', -170, 10], ['under', 60, 0], ['canyonOut', 120, 0],
    ['treeIn', -170, 0], ['caveIn', -110, 10], ['preLoop', 30, 0], ['loopOut', 260, -10]],
  gates: [['start', -60, 0x60ffb0], ['crest1', -90, 0xffb020], ['canyonIn', -40, 0x9cff40], ['treeIn', -60, 0x40d8ff],
    ['caveIn', -60, 0xffb020], ['preLoop', -40, 0xff4a8a]],
  // the tunnels of vines over the deck
  canopies: [['under', 90, 'under', 420], ['canyonOut', 70, 'canyonOut', 360], ['loopOut', 150, 'loopOut', 470]],
  // its light: emerald barriers, firefly lanes, warm gantries; moss on the steel and the deck's edges
  theme: { field: [0.1, 0.85, 0.4], fieldFlash: [0.75, 1.0, 0.7], strip: [0.06, 0.75, 0.25], stripCore: [0.8, 1.0, 0.7],
    lane: [0.35, 0.85, 0.05], laneCore: [0.95, 1.0, 0.65], spill: [0.3, 0.75, 0.08], stud: [1.6, 2.4, 0.8], trim: [0.15, 0.95, 0.35],
    gantry: [2.6, 2.3, 1.4], lamp: [2.8, 2.5, 1.8], moss: true },
});

// The islands named in the circuit's plan: placed where the set pieces need them (settle: pushed clear of the track
// sideways, or up for the Lantern the track runs under)
const HERO = [
  // (east of the start straight: the afternoon sun is north-west - west of it, its shadow lay over the whole grid)
  { name: 'Mother', x: -850, z: 380, top: 62, rx: 190, rz: 320, rot: 0.05, cliff: 95, depth: 420, seed: 11, hill: 10, lobes: 4, res: 224 },
  { name: 'Cascade', x: -380, z: -800, top: 230, rx: 310, rz: 150, rot: 0.03, cliff: 130, depth: 430, seed: 12, hill: 6, lobes: 4, res: 224 },
  // the island the track bores through (its middle and long axis come from the bore: cave.js)
  { name: 'Hollow', x: -170, z: 1470, top: -105, rx: 270, rz: 210, cliff: 200, depth: 520, seed: 31, hill: 8, taper: 1.3, hollow: true },
  // the rock the Great Tree's roots grip, far under the spiral
  { name: 'Roots', x: 300, z: 1290, top: -470, rx: 150, rz: 140, rot: 0.3, cliff: 60, depth: 260, seed: 41, hill: 4, lobes: 3, taper: 1.0, res: 160 },
  { name: 'Lantern', x: 225, z: -560, top: 235, rx: 150, rz: 175, rot: 0.4, cliff: 70, depth: 150, seed: 13, hill: 8, lobes: 2, taper: 0.7, settle: 'up', res: 192 },
  { name: 'TwinW', x: 690, z: 205, top: 102, rx: 105, rz: 150, rot: -0.2, cliff: 70, depth: 260, seed: 14, lobes: 2, res: 160 },
  { name: 'TwinE', x: 1020, z: 190, top: 132, rx: 115, rz: 160, rot: 0.3, cliff: 85, depth: 300, seed: 15, lobes: 3, res: 160 },
  // the canyon's pillars, either side of the rolls
  { name: 'PillarW1', x: 735, z: 600, top: 150, rx: 58, rz: 64, rot: 0.2, cliff: 250, depth: 330, seed: 21, hill: 3, taper: 2.2, lobes: 1, crag: 1.4, res: 128 },
  { name: 'PillarE1', x: 930, z: 690, top: 205, rx: 66, rz: 60, rot: 0.9, cliff: 300, depth: 370, seed: 22, hill: 3, taper: 2.2, lobes: 1, crag: 1.4, res: 128 },
  { name: 'PillarW2', x: 718, z: 840, top: 185, rx: 62, rz: 70, rot: 1.4, cliff: 280, depth: 350, seed: 23, hill: 3, taper: 2.2, lobes: 1, crag: 1.4, res: 128 },
  { name: 'PillarE2', x: 915, z: 960, top: 165, rx: 55, rz: 60, rot: 0.4, cliff: 260, depth: 330, seed: 24, hill: 3, taper: 2.2, lobes: 1, crag: 1.4, res: 128 },
  { name: 'PillarW3', x: 700, z: 1080, top: 130, rx: 50, rz: 55, rot: 2.1, cliff: 230, depth: 300, seed: 25, hill: 3, taper: 2.2, lobes: 1, crag: 1.4, res: 128 },
];

// the rest: scattered round the circuit (near: full detail; far: a ring out to 9 km, coarser, merged)
// dens: how much of the far scenery the device gets (1 a desktop card, less an integrated GPU or a phone: Q.tier)
function scatterIslands(track, rnd, dens = 1) {
  const out = [], box = new THREE.Box3().setFromPoints(track.P);
  const coarse = track.P.filter((_, i) => i % 8 === 0);
  // (and clear of the Great Tree's crown and roots)
  const crown = { x: TREE_C.x, z: TREE_C.z, rx: 360, rz: 360 };
  const clearOf = (x, z, r, list) => [...list, crown].every((q) => Math.hypot(q.x - x, q.z - z) > (q.rx + q.rz) / 2 + r + 40);
  for (let k = 0; k < 4000 && out.length < 34; k++) {
    const x = box.min.x - 900 + rnd() * (box.max.x - box.min.x + 1800), z = box.min.z - 900 + rnd() * (box.max.z - box.min.z + 1800);
    const r = 45 + 230 * Math.pow(rnd(), 2.2);
    let dmin = 1e9;
    for (const p of coarse) dmin = Math.min(dmin, Math.hypot(p.x - x, p.z - z));
    if (dmin < r * 1.25 + 60 || dmin > 1100 || !clearOf(x, z, r, [...HERO, ...out])) continue;
    const top = -330 + rnd() * 620, e = 0.7 + rnd() * 0.6;
    out.push({ name: 'isle' + out.length, x, z, top, rx: r * e, rz: r / e, rot: rnd() * 6.28, cliff: 30 + r * (0.25 + rnd() * 0.35),
      depth: r * (1.2 + rnd() * 1.1), seed: 100 + k, hill: 3 + r * 0.04, lobes: 1 + Math.floor(rnd() * 4), taper: 0.8 + rnd() * 1.2,
      res: r > 140 ? 160 : 112 });
  }
  const far = [];
  for (let k = 0; k < 4000 && far.length < Math.round(70 * dens); k++) {
    const a = rnd() * Math.PI * 2, d = 2600 + 6500 * Math.sqrt(rnd());
    const x = (box.min.x + box.max.x) / 2 + Math.cos(a) * d, z = (box.min.z + box.max.z) / 2 + Math.sin(a) * d;
    const r = 80 + 420 * Math.pow(rnd(), 2.0);
    if (!clearOf(x, z, r, [...HERO, ...out, ...far])) continue;
    const e = 0.7 + rnd() * 0.6;
    far.push({ name: 'far' + far.length, far: true, x, z, top: -500 + rnd() * 1100, rx: r * e, rz: r / e, rot: rnd() * 6.28,
      cliff: 40 + r * (0.2 + rnd() * 0.4), depth: r * (1.3 + rnd() * 1.2), seed: 900 + k, hill: 4 + r * 0.03,
      lobes: 1 + Math.floor(rnd() * 4), taper: 0.8 + rnd() * 1.2, res: 48 });
  }
  // karst towers standing up out of the jungle far below, round the field (their feet in the canopy)
  const karst = [];
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  for (let k = 0; k < 4000 && karst.length < Math.round(30 * dens); k++) {
    const a = rnd() * Math.PI * 2, d = 1400 + 7500 * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, r = 60 + 170 * Math.pow(rnd(), 1.6);
    const top = -980 + rnd() * 430, ground = groundHeight(x, z);
    if (top - ground < 120) continue;
    // under no island (their lowest tips come down to here)
    if (![...HERO, ...out, ...far, ...karst].every((q) => Math.hypot(q.x - x, q.z - z) > (q.rx + q.rz) / 2 + r + 60 || q.top - q.depth > top + 80)) continue;
    const e = 0.8 + rnd() * 0.4;
    karst.push({ name: 'karst' + karst.length, far: true, x, z, top, rx: r * e, rz: r / e, rot: rnd() * 6.28,
      depth: top - ground + 120, cliff: (top - ground) * 0.9, seed: 3000 + k, hill: 5, lobes: 1, taper: 3, crag: 1.3, res: 48 });
  }
  return [...out, ...far, ...karst];
}

const _d = new THREE.Vector3();

export class ForestWorld {
  constructor(scene, renderer, camera) {
    this.name = 'forest';
    this.lightShafts = true;                        // (main.js: the shafts pass, and where the sun is)
    this.sunDir = SUN_DIR;
    // the planting and far scenery by what the device can take (memory tier: a desktop card, an integrated GPU, a phone)
    this.dens = { high: 1, mid: 0.6, low: 0.4 }[Q.tier] ?? 1;
    // (what building the world costs, step by step: the console's 'forest built' line)
    const times = [];
    let t0 = performance.now();
    const lap = (name) => { const t = performance.now(); times.push(`${name} ${Math.round(t - t0)}`); t0 = t; };
    // the backdrop: the gas giant, its rings and a moon beyond the air, then the air itself over them
    this.sky = new THREE.Scene();
    this.skyCam = new THREE.PerspectiveCamera(60, 1, 50, 200000);
    this.dome = skyDome(renderer, Q.tier === 'low' ? 384 : 768);
    this.bodies = this.skyBodies(renderer);
    this.sky.add(this.bodies, this.dome);
    // reflections: the sky without the sun's disc (the sun light makes its own highlight)
    bakeLater([[this.sky, this.skyCam]], () => {
      this.dome.material.uniforms.sunDisc.value = 0;
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(this.sky, 0.02, 50, 200000).texture;
      pm.dispose();
      this.dome.material.uniforms.sunDisc.value = 1;
      scene.environment = this.env;
    });
    // (the sky's light ~a fifth of the sun's on a lit face: more washed everything out - "no shadow detail")
    scene.environmentIntensity = 0.4;
    this.exposure = 0.9;
    scene.fog = new THREE.FogExp2(0xffffff, 1e-4);       // (on: the atmosphere's own chunk does the work, atmo.js)
    // the sun: three cascades (the first carries the light)
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
    // the circuit
    lap('sky');
    this.track = new Track(FOREST_LAYOUT);
    this.trackGrid();
    rockMaps(renderer);
    hullMaps(renderer);
    // the cave's dark, and the shade under the tunnels of vines (their centre lines: overgrowth.js)
    this.canopy = vineCanopy(this.track, (list) => leafCards(list, 'A', 17));
    setCave(this.track.caveLines, 40, 45, { lines: this.canopy.lines, R: 27, mouth: 22, amb: 0.3 });
    this.track.meshes(scene);
    this.track.bakeDeck(renderer);
    this.noAO = [];
    lap('track');
    // the islands
    islandMaps(renderer);
    this.buildIslands(scene);
    lap('islands');
    // (layer 2: seen, but in no cascade's shadow - the plants; 3 and 4: drawn only in the far / the near depth slice)
    camera.layers.enable(2); camera.layers.enable(3); camera.layers.enable(4);
    this.flora = new Flora(scene);
    this.plant();
    lap('planting');
    this.growTree(scene);
    lap('tree');
    // the fliers: their loops clear of every island, the tree's crown, and the track (45 m over it at least)
    const tr = this.track;
    this.creatures = new Creatures(scene, [...this.islands.map((i) => i.I), { x: TREE_C.x, z: TREE_C.z, top: 280, rx: 360, rz: 360, depth: 900 }],
      (p) => { const i = this.nearTrack(p, 150); if (i < 0) return null; const d = p.clone().sub(tr.P[i]);
        return Math.abs(d.dot(tr.R[i])) < 60 ? { y: d.dot(tr.U[i]) } : null; }, tr.P.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(tr.P.length));
    this.noAO.push(this.creatures.rays, this.creatures.birds, this.creatures.whaleMesh);      // (thin wings: no AO)
    lap('creatures');
    this.overgrow(scene);
    lap('overgrowth');
    this.waters = new Waters(scene, this.dens);
    this.pourFalls();
    lap('falls');
    this.worldShadow(scene);
    // What casts only into the world's map (drawn once): the islands, the planting, the Great Tree. three picks a
    // shadow's casters by the main camera's layers, not the shadow camera's - so they cast while that map is drawn and
    // stop after (they were drawn into all three cascades every frame: most of the forest's extra cost)
    this.statics = [];
    scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.castShadow && o.layers.isEnabled(6)) this.statics.push(o); });
    this.staticsCast = true;
    // the jungle far below
    this.abyss = new Abyss(scene, renderer, this.track);
    // (a kilometre down, and kilometres off: no ambient occlusion to see - out of its depth pass)
    this.noAO.push(this.abyss.mesh, ...scene.children.filter((o) => o.name === 'far-islands'));
    // gantry lamps, as in space
    this.lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(new THREE.Color(1.0, 0.92, 0.78), 0, 70, 2); scene.add(l); return l; });
    // pollen and spores in the sunlight round the camera
    const dn = 1600, dpos = new Float32Array(dn * 3), rnd = mulberry32(9);
    for (let i = 0; i < dn * 3; i++) dpos[i] = (rnd() - 0.5) * 240;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { cam: { value: new THREE.Vector3() }, pr: { value: 1 }, time: { value: 0 } },
      vertexShader: /* glsl */`uniform vec3 cam; uniform float pr, time; varying float vA;
        void main() {
          vec3 q = position + vec3(sin(time * 0.3 + position.y) * 3.0, sin(time * 0.21 + position.x * 0.1) * 2.0, cos(time * 0.27 + position.z) * 3.0);
          vec3 p = mod(q - cam + 120.0, 240.0) - 120.0 + cam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(110.0, 30.0, d) * smoothstep(1.0, 5.0, d);
          gl_PointSize = pr * clamp(50.0 / d, 1.0, 3.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * 0.35 * vA * smoothstep(0.5, 0.0, r), 1.0); }`,
    }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.minimap = this.track;
    this.startIndex = this.track.start;
    lap('abyss');
    console.info(`forest built (ms): ${times.join(', ')}`);
  }

  buildIslands(scene) {
    const rnd = mulberry32(4711), list = [...HERO, ...scatterIslands(this.track, rnd, this.dens)];
    const mat = islandMaterial(), near = [], far = [];
    this.islands = [];
    let pushed = 0;
    for (const I of list) {
      if (I.hollow) {
        // (built round the bore: no clearance to settle)
        const h = (this.hollow = hollowIsland(this.track, I));
        const shell = new THREE.Mesh(h.shell, mat), bore = new THREE.Mesh(h.boreGeo, islandMaterial({ key: 'island-bore', side: THREE.DoubleSide, lamps: true }));
        shell.castShadow = shell.receiveShadow = bore.receiveShadow = true;
        shell.layers.set(2); shell.layers.enable(6);
        shell.name = 'Hollow'; bore.name = 'Hollow-bore';
        scene.add(shell, bore);
        this.islands.push({ geometry: h.shell, I: h.I, topInfo: h.topInfo, topHeight: h.topHeight, rimAt: h.rimAt, mesh: shell });
        continue;
      }
      let isl = islandShape(I);
      // clear of the track: pushed away from it (or up) until no rock is in the slab round the deck
      for (let it = 0; it < 8; it++) {
        const bad = trackClearance(this.track, [[I.name, isl.geometry]], { nearest: (p) => this.nearTrack(p, 60) });
        if (!bad.length) break;
        pushed++;
        if (I.settle === 'up') I.top += 6 + Math.max(...bad.map((b) => 22 - b.y));
        else {
          const c = new THREE.Vector3(I.x, 0, I.z), i = this.track.nearestIndex(c), d = c.clone().sub(this.track.P[i]).setY(0).normalize();
          I.x += d.x * 12; I.z += d.z * 12;
        }
        isl = islandShape(I);
      }
      this.islands.push(isl);
      (I.far ? far : near).push(isl);
    }
    this.glow = caveGlow(scene, this.hollow, this.track);
    // the near ones merged by 700 m cells (a draw a cell, not one an island; each still culled as a cell)
    const cells = new Map();
    for (const isl of near) {
      const k = `${Math.floor(isl.I.x / 700)},${Math.floor(isl.I.z / 700)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(isl);
    }
    for (const [k, list] of cells) {
      const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list.map((i) => i.geometry)) : list[0].geometry, mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'islands ' + k;
      // (their shadows come from the world's map, drawn once: in the cascades every island near one was drawn into
      // all three every frame - a third of the islands' cost)
      m.layers.set(2); m.layers.enable(6);
      scene.add(m);
    }
    // the far ones in one mesh (one draw)
    const merged = mergeGeometries(far.map((i) => i.geometry));
    const fm = new THREE.Mesh(merged, mat);
    // (seen, and in the world's shadow - never in the cascades: they are far beyond them, and drawn there every frame)
    fm.receiveShadow = true; fm.castShadow = true; fm.layers.set(3); fm.layers.enable(6);       // (3: the far depth slice only)
    fm.name = 'far-islands';
    scene.add(fm);
    this.islandMat = mat;
    console.info(`islands: ${near.length} near (${cells.size} meshes), ${far.length} far, ${pushed} pushes clear of the track`);
  }

  // trees on every island's top, vines hanging off its rim and from under it - grouped in sectors of the field
  plant() {
    const rnd = mulberry32(77), SECT = 500, sectors = new Map(), far = { plants: {}, vines: [] };
    // each plant its own shade: darker or lighter, olive or blue-green
    const tint = (k, h) => new THREE.Color(1 + k * 0.1 + h * 0.22, 1 + k * 0.1, 1 - k * 0.05 - h * 0.25).multiplyScalar(0.72 + 0.5 * Math.abs(k));
    const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), Sc = new THREE.Vector3(), P = new THREE.Vector3();
    const add = (bucket, sp, x, y, z, s, tilt = 0, tiltAz = 0) => {
      E.set(Math.cos(tiltAz) * tilt, rnd() * 6.283, Math.sin(tiltAz) * tilt);
      M.compose(P.set(x, y, z), Qn.setFromEuler(E), Sc.set(s * (0.9 + rnd() * 0.2), s, s * (0.9 + rnd() * 0.2)));
      (bucket.plants[sp] ||= []).push({ m: M.clone(), c: tint(rnd() * 2 - 1, rnd() - 0.5) });
    };
    let nt = 0, nv = 0;
    for (const isl of this.islands) {
      const I = isl.I;
      let bucket = far;
      if (!I.far) {
        const key = `${Math.floor(I.x / SECT)},${Math.floor(I.z / SECT)}`;
        if (!sectors.has(key)) sectors.set(key, { plants: {}, vines: [] });
        bucket = sectors.get(key);
      }
      // trees: a jittered grid over the top, thinned by a noise (clearings), species by place
      const r = Math.max(I.rx, I.rz) * 1.4, step = (I.far ? 26 : 10) / Math.sqrt(this.dens);
      for (let gx = -r; gx <= r; gx += step) for (let gz = -r; gz <= r; gz += step) {
        const x = I.x + gx + (rnd() - 0.5) * step, z = I.z + gz + (rnd() - 0.5) * step;
        const t = isl.topInfo(x, z);
        if (!t) continue;
        const dens = fbm(x / 140 + I.seed, z / 140, 3);
        if (dens < 0.36 && t.edge > 14) continue;                  // a clearing
        const rim = t.edge < 16, q = rnd();
        if (I.far) {
          if (t.edge > 30 && q < 0.7) continue;                     // far: mostly the skyline at the rim
          add(bucket, q < 0.75 ? 'broadleaf' : 'palm', x, t.y - 0.6, z, 0.9 + rnd() * 0.6); nt++;
          continue;
        }
        if (q < 0.035 && t.edge > 30) add(bucket, 'emergent', x, t.y - 1, z, 0.8 + rnd() * 0.45);
        else if (q < (rim ? 0.2 : 0.1)) add(bucket, 'palm', x, t.y - 0.5, z, 0.75 + rnd() * 0.6, rim ? 0.12 + rnd() * 0.25 : rnd() * 0.12, rnd() * 6.28);
        else if (q < 0.42) add(bucket, 'broadleaf', x, t.y - 0.6, z, 0.65 + rnd() * 0.75);
        else if (q < (rim ? 0.95 : 0.7)) add(bucket, 'bush', x, t.y - 0.3, z, 0.7 + rnd() * 0.9);
        else continue;
        nt++;
      }
      if (I.far) continue;
      // vines: curtains over the rim, strands from the underside (its vertices facing down)
      const g = isl.geometry, pos = g.attributes.position, nrm = g.attributes.normal, il = g.attributes.isl;
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      // (curtains: a few strands side by side round each spot)
      const nRim = Math.round((I.rx + I.rz) * 0.16 * this.dens);
      for (let k = 0; k < nRim; k++) {
        const a = rnd() * Math.PI * 2, n0 = 2 + Math.floor(rnd() * 6), L0 = 8 + Math.pow(rnd(), 1.6) * Math.min(60, I.cliff * 0.75);
        for (let q = 0; q < n0; q++) {
          const ri = isl.rimAt(a + (q - n0 / 2) * 2.6 / ((I.rx + I.rz) / 2));
          bucket.vines.push({ p: ri.p.clone().addScaledVector(ri.out, 1.2 + rnd() * 1.6).add(new THREE.Vector3(0, -0.8, 0)),
            len: L0 * (0.55 + 0.6 * rnd()), wid: 2.4 + rnd() * 2.2 });
          nv++;
        }
      }
      for (let i = 0; i < pos.count; i += 1) {
        if (il.getY(i) < 0.04 || rnd() > 0.05 * this.dens) continue;
        n.fromBufferAttribute(nrm, i);
        if (n.y > -0.35) continue;
        v.fromBufferAttribute(pos, i);
        const L0 = 5 + Math.pow(rnd(), 1.5) * 38;
        for (let q = 0; q < 3; q++) {
          bucket.vines.push({ p: v.clone().add(new THREE.Vector3((rnd() - 0.5) * 6, 0.8, (rnd() - 0.5) * 6)), len: L0 * (0.5 + 0.7 * rnd()), wid: 2.0 + rnd() * 2.4 });
          nv++;
        }
      }
    }
    let clipped = 0;
    for (const [k, b] of sectors) {
      const vines = b.vines.map((v) => { const c = this.clipStrand(v); if (c !== v) clipped++; return c; }).filter(Boolean);
      this.flora.addSector(k, b.plants, vines);
    }
    console.info(`vines: ${clipped} shortened or removed clear of the track`);
    this.flora.addSector('far', far.plants, [], true);
    console.info(`flora: ${nt} plants, ${nv} vines`);
  }

  // the track's samples in 40 m cells (x, z): what is near a point, fast
  trackGrid() {
    const C = 40, g = new Map(), tr = this.track;
    tr.P.forEach((p, i) => { const k = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
    this.grid = g;
  }
  nearTrack(p, maxDy = 80) {
    const C = 40, cx = Math.floor(p.x / C), cz = Math.floor(p.z / C), tr = this.track;
    let best = 1e18, bi = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const i of this.grid.get(`${cx + a},${cz + b}`) || []) {
        const q = tr.P[i]; if (Math.abs(q.y - p.y) > maxDy) continue;
        const d = q.distanceToSquared(p); if (d < best) { best = d; bi = i; }
      }
    }
    return bi;
  }
  // a hanging strand shortened to stop clear of the track (deck, walls, fields, ships' way): null if nothing is left
  clipStrand(v) {
    const tr = this.track, q = new THREE.Vector3(), d = new THREE.Vector3();
    for (let t = 0; t <= v.len; t += 2.5) {
      q.copy(v.p).y -= t;
      const i = this.nearTrack(q);
      if (i < 0) continue;
      d.subVectors(q, tr.P[i]);
      const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
      if (Math.abs(x) < 34 && y > -14 && y < 28) { const len = t - 4; return len > 2 ? { ...v, len } : null; }
    }
    return v;
  }

  // the Great Tree on its rock, round which the track spirals
  growTree(scene) {
    const rock = this.islands.find((i) => i.I.name === 'Roots');
    const T = (this.tree = greatTree(TREE_C, rock, (list) => leafCards(list, 'A', 41)));
    const wood = new THREE.Mesh(T.wood, this.flora.barkMat), crown = new THREE.Mesh(T.leaves, this.flora.leafMat);
    for (const m of [wood, crown]) { m.layers.set(2); m.layers.enable(6); m.castShadow = m.receiveShadow = true; scene.add(m); }
    wood.name = 'great-tree'; crown.name = 'great-tree-crown';
    const strands = T.strands.map((v) => this.clipStrand(v)).filter(Boolean);
    this.flora.addSector('tree', {}, strands);
    this.noAO.push(crown);
    const bad = trackClearance(this.track, [['great-tree', T.wood], ['great-tree-crown', T.leaves]], { nearest: (p) => this.nearTrack(p, 60) });
    console.info(`great tree: ${(T.wood.index.count / 3 / 1000).toFixed(0)} k wood tris, ${T.leaves.index.count / 6} leaf cards, ${strands.length} strands` +
      (bad.length ? ` - ${bad.length} points in the track's way!` : ''));
  }

  // where a fall's water would come near the deck (the slab round it, 30 m up): null if it never does
  fallHits(at, tMax) {
    const tr = this.track, d = new THREE.Vector3();
    for (let t = 0; t <= tMax; t += 0.2) {
      const p = at(t), i = this.nearTrack(p);
      if (i < 0) continue;
      d.subVectors(p, tr.P[i]);
      const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
      if (Math.abs(x) < 34 && y > -20 && y < 30 && Math.abs(d.dot(tr.T[i])) < 6) return { t, x, y };
    }
    return null;
  }

  // The falls: the Cascade's river arching over the track (fast enough to clear its far edge by 12 m), one off the
  // Mother island, and some off other islands - each turned until its water clears the track, side-on to it if it can
  pourFalls() {
    const tr = this.track, W = this.waters, rnd = mulberry32(606), G = 9.8;
    const isl = (name) => this.islands.find((i) => i.I.name === name);
    const nearestRim = (I, target) => {
      let best = null;
      for (let k = 0; k < 360; k++) {
        const r = I.rimAt((k / 360) * Math.PI * 2), d = r.p.clone().setY(0).distanceTo(target.clone().setY(0));
        if (!best || d < best.d) best = { ...r, d };
      }
      return best;
    };
    // the arch over the track
    {
      const s = tr.at('falls'), f = tr.frame(s), C = isl('Cascade'), r = nearestRim(C, f.P);
      const lip = r.p.clone().addScaledVector(r.out, 1.0).add(new THREE.Vector3(0, -1.0, 0));
      const out = f.P.clone().sub(lip).setY(0).normalize();
      const dFar = f.P.clone().sub(lip).setY(0).length() + 24 + 8, h = lip.y - f.P.y;
      const v = Math.max(10, 1.12 * dFar / Math.sqrt((2 * Math.max(h - 12, 5)) / G));
      this.archFall = W.add({ lip, out, width: 54, v, drop: 1100, seed: 11, name: 'cascade' });
      console.info(`cascade fall: lip ${h.toFixed(0)} m over the deck, ${v.toFixed(1)} m/s - clears the far edge at ${(h - 0.5 * G * (dFar / v) ** 2).toFixed(0)} m`);
    }
    // the Hollow's: off the cliff over the cave's west mouth, down across the jump
    {
      const H = this.hollow, r = H.rimAt(0);
      const lip = r.p.clone().addScaledVector(H.hz, 1.0).add(new THREE.Vector3(0, -1.0, 0));
      this.caveFall = W.add({ lip, out: H.hz, width: 62, v: 3.2, drop: 1100, seed: 13, name: 'hollow' });
    }
    // the others: islands big enough, high enough to be seen
    const cands = this.islands.filter((i) => !i.I.far && !/Pillar|Cascade|Lantern|Hollow/.test(i.I.name) && (i.I.rx + i.I.rz) / 2 > 80 && i.I.top > -200);
    cands.sort((a, b) => (a.I.name === 'Mother' ? -1 : b.I.name === 'Mother' ? 1 : rnd() - 0.5));
    let n = 0;
    for (const I of cands) {
      if (n >= 8) break;
      const c = new THREE.Vector3(I.I.x, 0, I.I.z), ti = tr.P[tr.nearestIndex(c)], toT = ti.clone().sub(c).setY(0).normalize();
      let best = null;
      for (let k = 0; k < 24; k++) {
        const r = I.rimAt((k / 24) * Math.PI * 2 + rnd() * 0.1), v = 3 + rnd() * 4;
        const lip = r.p.clone().addScaledVector(r.out, 1.0).add(new THREE.Vector3(0, -0.8, 0));
        const at = (t) => lip.clone().addScaledVector(r.out, v * t).add(new THREE.Vector3(0, -0.5 * G * t * t, 0));
        if (this.fallHits(at, 14)) continue;
        const score = -Math.abs(r.out.dot(toT)) + 0.4 * r.out.dot(toT);   // side-on, a little toward the track
        if (!best || score > best.score) best = { score, lip, out: r.out, v };
      }
      if (!best) continue;
      W.add({ lip: best.lip, out: best.out, width: I.I.name === 'Mother' ? 18 : 8 + rnd() * 14, v: best.v, drop: 900, seed: 20 + n, name: I.I.name });
      n++;
    }
    W.finish();
    this.noAO.push(...W.falls.map((f) => f.mesh), W.mist);
    console.info(`waterfalls: ${W.falls.length}, ${W.puffs.length} mist puffs`);
  }

  // the track overgrown: vines off its edges and over its walls, ivy on the gantries, the tunnels of vines
  overgrow(scene) {
    const tr = this.track, cn = this.canopy, ivy = gantryIvy(tr, (list) => leafCards(list, 'A', 23));
    // the lianas strung between the canyon's pillars, over the rolls
    const pil = (n) => this.islands.find((i) => i.I.name === n);
    const br = canyonBridges(tr, [['PillarW1', 'PillarE1'], ['PillarE1', 'PillarW2'], ['PillarW2', 'PillarE2'], ['PillarE2', 'PillarW3']]
      .map(([a, b]) => [pil(a), pil(b)]).filter(([a, b]) => a && b), barkTube);
    if (br.tubes.length) {
      // (near the track: they cast into the cascades - their shadows across the deck - and stay casting)
      const wood = new THREE.Mesh(mergeGeometries(br.tubes), this.flora.barkMat), leaves = new THREE.Mesh(leafCards(br.leaves, 'A', 29), this.flora.leafMat);
      for (const m of [wood, leaves]) { m.castShadow = m.receiveShadow = true; m.name = 'canyon-lianas'; scene.add(m); }
      this.noAO.push(leaves);
    }
    const strands = [...trackVines(tr), ...ivy.strands, ...cn.strands, ...br.strands.map((v) => this.clipStrand(v)).filter(Boolean)];
    this.flora.addSector('track', {}, strands);
    // the planting's meshes, now that all of it is in - out of the ambient occlusion's depth (drawn there whole,
    // each card was a dark square)
    this.flora.finish();
    this.noAO.push(...this.flora.meshes);
    const M = new THREE.Matrix4();
    const ivyM = new THREE.InstancedMesh(ivy.geo, this.flora.leafMat, tr.gantryIdx.length);
    tr.gantryIdx.forEach((i, k) => ivyM.setMatrixAt(k, tr.basisAt(i, M)));
    ivyM.computeBoundingSphere();
    ivyM.castShadow = ivyM.receiveShadow = true;
    scene.add(ivyM);
    this.noAO.push(ivyM);
    // the tunnels: ribs (mossy steel) and the roof of leaves - both in the cascades' shadows (dappled light)
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x2c312b, roughness: 0.7, metalness: 0.5 });
    ribMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vRW = worldPosition.xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRW;
float rH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rH(i), rH(i + vec3(1, 0, 0)), f.x), mix(rH(i + vec3(0, 1, 0)), rH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rH(i + vec3(0, 0, 1)), rH(i + vec3(1, 0, 1)), f.x), mix(rH(i + vec3(0, 1, 1)), rH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
  float rm = smoothstep(0.42, 0.6, rN(vRW * 0.6) * 0.6 + rN(vRW * 2.3) * 0.4 + 0.15 * normalize(vNormal).y);
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.7 + 0.5 * rN(vRW * 1.7)), vec3(0.035, 0.065, 0.016), rm);`);
    };
    ribMat.customProgramCacheKey = () => 'forest-rib';
    const ribs = new THREE.InstancedMesh(cn.ribGeo, ribMat, cn.mats.length);
    cn.mats.forEach((m, k) => ribs.setMatrixAt(k, m));
    ribs.computeBoundingSphere();
    ribs.castShadow = ribs.receiveShadow = true;
    scene.add(ribs);
    if (cn.leaves) {
      const roof = new THREE.Mesh(cn.leaves, this.flora.leafMat);
      roof.castShadow = roof.receiveShadow = true;
      scene.add(roof);
      this.noAO.push(roof);
    }
    console.info(`overgrowth: ${strands.length} strands, ${cn.mats.length} arches, ${cn.leaves ? cn.leaves.index.count / 6 : 0} roof leaves`);
  }

  // The world's own shadow: a fourth sun light whose map (drawn once, layer 6: the islands and their trees) covers
  // the whole island field - an island's shadow on the track, on another island, on the jungle far below (look.js)
  worldShadow(scene) {
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const isl of this.islands) if (!isl.I.far) { isl.geometry.computeBoundingBox(); box.union(isl.geometry.boundingBox); }
    if (this.tree) for (const g of [this.tree.wood, this.tree.leaves]) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const ctr = box.getCenter(new THREE.Vector3());
    let half = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v.set(x, y, z).sub(ctr);
      half = Math.max(half, Math.abs(v.dot(this.lx)), Math.abs(v.dot(this.ly)));
    }
    const l = new THREE.DirectionalLight(SUN_COL, 0), size = Q.tier === 'high' ? 4096 : 2048, D = 6000;
    l.castShadow = true;
    l.shadow.mapSize.set(size, size);
    const c = l.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 10; c.far = D * 2;
    c.layers.set(6);
    l.position.copy(ctr).addScaledVector(SUN_DIR, D);
    l.target.position.copy(ctr);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 1.2;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
    scene.add(l, l.target);
    l.updateMatrixWorld(); l.target.updateMatrixWorld();
    this.sunWorld = l;
    console.info(`world shadow: ${size} px over ${(2 * half / 1000).toFixed(1)} km (${(2 * half / size).toFixed(2)} m a texel)`);
  }

  // the camera inside a curtain of falling water (the sheet's arc within 2.5 m, inside its width) - once per pass
  // through it (main.js: water on the lens, a splash)
  wetCheck(p) {
    const inside = !!this.inFall(p);
    const hit = inside && !this.wasWet;
    this.wasWet = inside;
    return hit;
  }

  // the fall whose curtain p is in (within r m of the sheet's arc, inside its width), or null
  inFall(p, r = 2.5) {
    for (const f of this.waters.falls) {
      const d = _d.copy(p).sub(f.lip), h = d.x * f.out.x + d.z * f.out.z;
      if (h < -5 || h > f.v * 9 + 10 || d.y > 5 || d.y < -330) continue;
      // the nearest point of the arc (x = v t, y = -g t^2 / 2) in its own plane
      let best = 1e9, bt = 0;
      for (let t = 0; t <= 8; t += 0.08) { const x = f.v * t - h, y = -4.9 * t * t - d.y, q = x * x + y * y; if (q < best) { best = q; bt = t; } }
      const lat = Math.abs(d.x * -f.out.z + d.z * f.out.x), w = f.width * (1 + 0.07 * bt) + 2 * bt;
      if (best < r * r && lat < w / 2 - 1) return f;
    }
    return null;
  }

  // the gas giant (the space circuit's), its rings and a cratered moon - beyond the air (the dome dims them)
  skyBodies(renderer) {
    const g = new THREE.Group(), D = 60000, R = D * Math.sin(THREE.MathUtils.degToRad(9));
    const C = GIANT_DIR.clone().multiplyScalar(D);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.9, -0.5));
    const ringN = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt);
    const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(tilt.clone().invert()));
    const shared = { sunDir: { value: SUN_DIR }, center: { value: C }, R: { value: R }, ringN: { value: ringN },
      rot: { value: rot }, sunE: { value: SUN_E } };
    const ringMat = ringMaterial(renderer, shared);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), giantMaterial(renderer, shared));
    planet.position.copy(C);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * RING_IN, R * RING_OUT, 384, 1).rotateX(-Math.PI / 2), ringMat);
    ring.position.copy(C);
    ring.quaternion.copy(tilt);
    ring.renderOrder = 2;
    const moon = moonMesh(renderer, SUN_DIR, 1400);
    moon.position.copy(new THREE.Vector3(0.82, 0.3, 0.48).normalize().multiplyScalar(70000));
    g.add(planet, ring, moon);
    return g;
  }

  // Shadows (the setting): High / Medium - the sun's three cascades and the world's map; Off - no cascades drawn a
  // frame, the sun itself carries the world's map, drawn once (the islands' and trees' shadows stay: Laptop mode)
  shadowMode(size, renderer) {
    const worldOnly = !size, S = this.sun, W = this.sunWorld;
    renderer.shadowMap.enabled = true;
    if (this.worldOnly === worldOnly) return;
    this.worldOnly = worldOnly;
    const cam = (l, src) => { const c = l.shadow.camera; Object.assign(c, src); c.updateProjectionMatrix(); };
    if (worldOnly) {
      const c = W.shadow.camera;
      cam(S, { left: c.left, right: c.right, top: c.top, bottom: c.bottom, near: c.near, far: c.far });
      S.shadow.camera.layers.set(6);
      S.shadow.mapSize.copy(W.shadow.mapSize);
      S.shadow.bias = W.shadow.bias; S.shadow.normalBias = W.shadow.normalBias;
      S.position.copy(W.position); S.target.position.copy(W.target.position);
      S.updateMatrixWorld(); S.target.updateMatrixWorld();
      S.shadow.autoUpdate = false;
      for (const l of [this.sunMid, this.sunFar, W]) l.castShadow = false;
    } else {
      cam(S, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: SHADOW_NEAR, far: SHADOW_FAR });
      S.shadow.camera.layers.set(0);
      S.shadow.bias = -0.0001; S.shadow.normalBias = 0.005;
      S.shadow.autoUpdate = true;
      for (const l of [this.sunMid, this.sunFar, W]) l.castShadow = true;
      W.shadow.needsUpdate = true;
    }
    S.shadow.map?.dispose();
    S.shadow.map = null;
    S.shadow.needsUpdate = true;
    this.castStatics?.(true);                        // (the world's map drawn again: the statics cast for it)
  }

  // keep a camera out of the track slab (deck, walls, fields): over the barrier tops if it is inside
  clearance(p) {
    const tr = this.track, i = tr.nearestIndex(p), d = p.clone().sub(tr.P[i]);
    const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
    if (Math.abs(x) < TRACK_W_HALF + 4 && y > -6 && y < 6.5) p.addScaledVector(tr.U[i], 6.5 - y);
  }

  surface() { return -1e9; }
  height() { return -1e9; }
  hit() { return null; }

  // the cascades round the ship, the pack and ahead (space.js), each snapped to its texels
  follow(p, camera) {
    if (this.worldOnly) return;                      // (the sun's map is the world's, fixed)
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

  // the static casters on (the world's map is about to be drawn) or off (it has been)
  castStatics(on) {
    if (this.staticsCast === on) return;
    for (const o of this.statics) o.castShadow = on;
    this.staticsCast = on;
    // (all the planting in the map, not only what the camera faced)
    if (on) this.flora?.rebucket(null, null);
  }

  update(t, camera, shipPos, s, renderer) {
    // the world's map drawn (three clears needsUpdate when it has): the statics stop casting
    if (this.staticsCast && !this.sunWorld.shadow.needsUpdate && !(this.worldOnly && this.sun.shadow.needsUpdate)) this.castStatics(false);
    this.skyCam.quaternion.copy(camera.quaternion);
    this.skyCam.fov = camera.fov;
    this.skyCam.aspect = camera.aspect;
    this.skyCam.updateProjectionMatrix();
    const pr = renderer.getPixelRatio() * (this.renderScale || 1);
    this.dust.material.uniforms.pr.value = pr;
    this.dust.material.uniforms.cam.value.copy(camera.position);
    this.dust.material.uniforms.time.value = t;
    const dt = Math.max(0, t - (this.lastT ?? t));
    this.track.update(t, shipPos, dt);
    this.abyss.update(t, camera);
    if (!this.staticsCast) this.flora.update(t, camera);    // (while the world's map waits to be drawn: all of it, as it is)
    else (this.flora && (this.flora.lastAt = null));
    this.waters.update(t);
    this.glow.update(t, pr);
    this.creatures.update(t);
    this.lastT = t;
    const tr = this.track, gi = tr.gantryIdx, sIdx = Math.floor(s / tr.step);
    gi.map((i) => ({ i, d: Math.min((i - sIdx + tr.n) % tr.n, (sIdx - i + tr.n) % tr.n) }))
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ i }, k) => {
        const l = this.lamps[k];
        l.position.copy(tr.P[i]).addScaledVector(tr.U[i], 12.9);
        l.color.set(i === gi[0] ? 0xff6a55 : 0xffe8c8);
        l.intensity = i === gi[0] ? 260 : 380;
      });
  }
}
