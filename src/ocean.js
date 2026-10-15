// The water planet: an ocean over the whole world at night, a great moon low in the north-north-east behind storm
// cloud. Off the grid the circuit runs north on a causeway low over the swell, swings east between sea stacks close
// enough to the water to feel its spray, threads a sea arch, climbs a viaduct to a jump, sweeps down a long banked
// left-hander - and dives into the sea: through the great gate of a drowned city, down its avenue, round its dome,
// through a temple's hall, under an aqueduct - then surges up out of the water off a kicker, rolls over the swell,
// passes the old lighthouse, loops, and comes home along the south.
import * as THREE from 'three';
import { Track, TRACK_W, layout } from './track.js';
import { hullMaps } from './hull.js';
import { bakeLater } from './bake.js';
import { Q } from './quality.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, SUN_E, SUN_COL, SEA_Y, seaSkyDome, seaLight, Ocean, waveHeight, UnderPass } from './sea.js';
import { mesaGeometry, archGeometry } from './sandstone.js';
import { sunOnly, setCave } from './look.js';
import { City, lighthouseGeometry, stoneMaterial } from './atlantis.js';
import { SeaLife } from './sealife.js';
import { TrackGrid } from './spires.js';
import { moonMesh } from './celestial.js';
import { mulberry32, smoothstep, fbm } from './noise.js';
import { fbm3 } from './spires.js';
export { SUN_DIR };
const TRACK_W_HALF = TRACK_W / 2;

// the moon's three shadow cascades, as in space (look.js reads them)
export const SHADOW_HALF = 10, SHADOW_NEAR = 300, SHADOW_FAR = 500;
export const MID_HALF = 45, MID_NEAR = 250, MID_FAR = 550;
export const FAR_HALF = 170, FAR_NEAR = 100, FAR_FAR = 900;
const MOON_DIR = SUN_DIR;

// The circuit (x east, y up, z south; the sea at y 0). The grid faces north, the moon ahead and to the right.
const P = [];
const pt = (x, y, z, bank = 0, name = null) => P.push([x, y, z, bank, name]);
pt(0, 9, 650); pt(0, 9, 330, 0, 'start'); pt(0, 9, 20);
// east between the sea stacks, low over the swell
pt(40, 8, -260, 6); pt(200, 6, -480, 14); pt(460, 5, -600, 8, 'spray'); pt(760, 5, -640, 0);
// through the sea arch, then up onto the viaduct and the jump
pt(1020, 6, -630, -4, 'arch'); pt(1260, 10, -580, -10);
pt(1480, 26, -470, -16); pt(1680, 46, -300, -14); pt(1800, 62, -80, -4); pt(1830, 66, 80, 0, 'crest1');
pt(1840, 58, 300); pt(1830, 60, 520, 0, 'breach');
// a long descending left-hander, banked
pt(1760, 54, 760, 18); pt(1580, 44, 930, 26); pt(1330, 30, 1010, 22); pt(1080, 16, 1000, 8);
// the dive: into the sea and down to the city's gate
pt(860, 4, 950, 0, 'diveIn'); pt(660, -18, 890); pt(470, -40, 830, 0, 'gate');
// over the lip of the abyss and down its wall, the drowned city spread out on its floor 400 m down: round its great
// dome, through the hall on the temple mount, under the aqueduct's top arcade
pt(260, -72, 790, 0, 'avenue'); pt(40, -118, 740, -8); pt(-190, -165, 655, -16);
pt(-370, -200, 480, -24, 'dome'); pt(-445, -224, 255, -16); pt(-418, -238, 30, -4);
pt(-368, -244, -170, 0, 'hallIn'); pt(-318, -242, -390, 0, 'hallOut');
pt(-228, -232, -600, 10, 'aqueduct'); pt(-68, -214, -790, 18); pt(170, -186, -905, 10);
// the long climb up out of the abyss, bursting out of the sea and off the kicker
pt(430, -150, -955); pt(690, -106, -972); pt(940, -60, -978, 0, 'surge'); pt(1170, -18, -980); pt(1360, 10, -982, 0, 'crest2');
pt(1580, 8, -990);
// a barrel roll over the swell
pt(1760, 12, -1005, 0, 'rollIn'); pt(1920, 12, -1018, 120); pt(2080, 12, -1031, 240); pt(2240, 12, -1044, 0, 'rollOut');
// the long sweep south past the lighthouse
pt(2420, 16, -940, 14); pt(2520, 20, -760, 24); pt(2560, 24, -480, 12, 'light'); pt(2560, 26, -150); pt(2520, 22, 200, -6);
pt(2440, 18, 560, -14); pt(2380, 16, 900, -18); pt(2200, 14, 1180, -24); pt(1900, 12, 1340, -14);
// west along the south, the loop
pt(1500, 10, 1420, 0); pt(1150, 10, 1440, 0, 'preLoop');
for (let k = 0; k <= 12; k++) {
  const a = (k / 12) * Math.PI * 2;
  pt(950 - 80 * Math.sin(a), 90 - 80 * Math.cos(a), 1440 + 40 * (1 - Math.cos(a / 2)), 0, k === 0 ? 'loopIn' : k === 12 ? 'loopOut' : null);
}
pt(720, 10, 1520); pt(420, 9, 1500, 10); pt(120, 9, 1380, 20); pt(-80, 9, 1150, 20); pt(-110, 9, 900, 8);

export const OCEAN_LAYOUT = layout(P, {
  start: [0, 9, 650],
  loops: [['loopIn', 'loopOut']],
  gaps: [['crest1', 35, 105], ['crest2', 35, 110]],
  // the temple's hall: no sky, its lamps and the ships light it
  caves: [['hallIn', -30, 'hallOut', 30]],
  pads: [['start', 330, 0], ['spray', 120, -10], ['arch', 180, 0], ['breach', 150, 0], ['gate', 140, 0], ['dome', 160, 10],
    ['hallOut', 130, 0], ['surge', -150, 0], ['rollOut', 200, 0], ['light', 160, -10], ['preLoop', -260, 0]],
  gates: [['start', -60, 0x30d8ff], ['arch', -120, 0xffa040], ['crest1', -90, 0xff40b0], ['diveIn', -60, 0x30d8ff],
    ['hallIn', -60, 0xffa040], ['surge', -60, 0x40ffc0], ['rollIn', -40, 0xff40b0], ['preLoop', -40, 0x30d8ff]],
  // its light: cyan barriers and lanes, aqua strips, warm gantries
  theme: { field: [0.05, 0.7, 1.0], fieldFlash: [0.6, 0.95, 1.0], strip: [0.0, 0.45, 0.9], stripCore: [0.6, 0.95, 1.0],
    lane: [0.0, 0.55, 1.0], laneCore: [0.65, 0.92, 1.0], spill: [0.0, 0.38, 0.7], stud: [0.6, 1.6, 2.6], trim: [0.05, 0.7, 1.3],
    gantry: [2.6, 1.9, 1.2], lamp: [2.8, 2.2, 1.5], flip: [0.1, 0.9, 0.95], moss: false, sand: false },
});

// the sea stacks' rock: dark basalt, wet and black where the swell reaches, pale with salt and lichen up high, weed and
// barnacles in a band at the waterline. Drawn from world position; lit by the moon and the sky alone
export function basaltMaterial({ key = 'basalt' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vBW = (modelMatrix * vec4(transformed, 1.0)).xyz; vBN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBW; varying vec3 vBN;
float bsH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bsN(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(bsH(i), bsH(i + vec3(1, 0, 0)), u.x), mix(bsH(i + vec3(0, 1, 0)), bsH(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(bsH(i + vec3(0, 0, 1)), bsH(i + vec3(1, 0, 1)), u.x), mix(bsH(i + vec3(0, 1, 1)), bsH(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float bsWet = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float n = bsN(vBW * 0.05) * 0.55 + bsN(vBW * 0.23) * 0.3 + bsN(vBW * 1.1) * 0.15;
    // columns of basalt: vertical joints round the stack
    float cols = smoothstep(0.86, 0.97, abs(sin(atan(vBN.z, vBN.x) * 9.0 + bsN(vBW * 0.04) * 4.0)));
    vec3 c = mix(vec3(0.045, 0.047, 0.05), vec3(0.11, 0.105, 0.1), n) * (1.0 - 0.45 * cols);
    float y = vBW.y - ${f(SEA_Y)};
    // salt and lichen up high where it looks up
    c = mix(c, vec3(0.2, 0.21, 0.19), smoothstep(0.55, 0.85, vBN.y + (n - 0.5) * 0.5) * smoothstep(8.0, 30.0, y) * 0.6);
    // weed and barnacles round the waterline, black and wet up to where the swell throws its spray
    float band = smoothstep(-6.0, -1.0, y) * (1.0 - smoothstep(2.5, 5.0, y + (n - 0.5) * 3.0));
    c = mix(c, vec3(0.03, 0.045, 0.03), band * 0.85);
    bsWet = 1.0 - smoothstep(4.0, 11.0, y + (n - 0.5) * 5.0);
    c *= 1.0 - 0.45 * bsWet;
    diffuseColor.rgb = c;
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.85, 0.32, bsWet);');
    sh.fragmentShader = sunOnly(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => `ocean-${key}`;
  return mat;
}
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(5)));

// A sea stack: a pillar of basalt out of the deep - its outline lobed and bitten, narrowing upward with ledges where a
// softer layer wore back, leaning a little, its top a broken crown of spires. x, z, r (its radius at the sea), h (its
// top over the sea)
function stackGeometry({ x, z, r, h, seed }) {
  const rnd = mulberry32(seed), NU = r > 40 ? 64 : 44, s1 = rnd() * 50, s2 = rnd() * 50;
  const lean = (rnd() - 0.5) * 0.12, leanA = rnd() * Math.PI * 2;
  const rows = [];
  const yBot = SEA_Y - 180, dy = Math.max(2.5, h / 40);
  for (let y = yBot; y < h; y += y < -20 ? 20 : dy) rows.push(y);
  rows.push(h);
  const crown = Array.from({ length: NU }, (_, j) => {
    const th = (j / NU) * Math.PI * 2;
    return h * (0.82 + 0.18 * fbm(Math.cos(th) * 2 + s1, Math.sin(th) * 2 + s2, 3)) + (rnd() < 0.12 ? rnd() * h * 0.12 : 0);
  });
  const pos = [], idx = [];
  for (const y of rows) {
    const t = Math.max(0, y - SEA_Y) / h;
    const taper = 1.18 - 0.5 * t - 0.12 * Math.pow(t, 3) + (y < SEA_Y ? 0.15 * Math.min(1, (SEA_Y - y) / 60) : 0);
    // ledges: a band now and then where the column steps in
    const ledge = 1 - 0.07 * Math.max(0, Math.sin(y * 0.11 + s1)) * (fbm3(y * 0.05, s1, s2, 2) > 0.5 ? 1 : 0);
    for (let j = 0; j < NU; j++) {
      const th = (j / NU) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const lobe = 1 + 0.38 * (fbm(c * 1.3 + s1, sn * 1.3 + s2, 4) - 0.5) - 0.3 * Math.abs(fbm(c * 3.5 + s2 + y * 0.004, sn * 3.5 - s1, 3) - 0.5);
      const rough = 1 + 0.09 * (fbm3((x + c * r) / 9, y / 7, (z + sn * r) / 9, 3) - 0.5);
      const rr = r * lobe * taper * ledge * rough;
      const top = Math.min(y, crown[j]);
      const lx = lean * Math.max(0, top) * Math.cos(leanA), lz = lean * Math.max(0, top) * Math.sin(leanA);
      pos.push(x + c * rr + lx, top, z + sn * rr + lz);
    }
  }
  const nr = rows.length;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < NU; j++) {
    const a = i * NU + j, b = i * NU + (j + 1) % NU, c = a + NU, d = b + NU;
    idx.push(a, c, b, b, c, d);
  }
  // the crown's cap: a fan to a point a little under its highest spire
  const ci = pos.length / 3, last = (nr - 1) * NU;
  const cy = Math.max(...crown) * 0.93;
  pos.push(x + lean * cy * Math.cos(leanA), cy, z + lean * cy * Math.sin(leanA));
  for (let j = 0; j < NU; j++) idx.push(last + j, ci, last + (j + 1) % NU);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class OceanWorld {
  constructor(scene, renderer, camera) {
    this.name = 'ocean';
    this.scene = scene;
    this.lightShafts = false;
    this.sunDir = SUN_DIR;
    this.dens = { high: 1, mid: 0.6, low: 0.4 }[Q.tier] ?? 1;
    const times = [];
    let t0 = performance.now();
    const lap = (name) => { const t = performance.now(); times.push(`${name} ${Math.round(t - t0)}`); t0 = t; };
    seaLight();
    // the backdrop: the moon beyond the cloud and the haze
    this.sky = new THREE.Scene();
    this.skyCam = new THREE.PerspectiveCamera(60, 1, 50, 200000);
    this.dome = seaSkyDome(renderer, Q.tier === 'low' ? 384 : 768);
    // (the moon lit from nearly behind us: just past full, its east limb shaded)
    this.moon = moonMesh(renderer, SUN_DIR.clone().negate().add(new THREE.Vector3(0.3, 0.12, 0)).normalize(), 3600);
    this.moon.position.copy(MOON_DIR).multiplyScalar(70000);
    this.sky.add(this.moon, this.dome);
    // reflections: the sky without the moon (the moonlight makes its own highlight)
    bakeLater([[this.sky, this.skyCam]], () => {
      this.moon.visible = false;
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(this.sky, 0.02, 50, 200000).texture;
      pm.dispose();
      this.moon.visible = true;
      scene.environment = this.env;
    });
    scene.environmentIntensity = 1.8;
    this.exposure = 1.0;
    this.grade = { contrast: 1.1, saturation: 1.12 };
    // (on: the sea's own chunk does the work, sea.js; its colour carries the clock and the sea's level at the camera)
    scene.fog = new THREE.FogExp2(0xffffff, 1e-4);
    this.fog = scene.fog;
    this.fog.color.setRGB(1, 0, SEA_Y);
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
    this.track = new Track(OCEAN_LAYOUT);
    hullMaps(renderer);
    setCave(this.track.caveLines, 40, 45);
    this.track.meshes(scene);
    this.track.bakeDeck(renderer);
    this.noAO = [];
    this.grid = new TrackGrid(this.track);
    lap('track');
    camera.layers.enable(2); camera.layers.enable(3); camera.layers.enable(4);
    // the sea: its surface, and the deep under it (a floor far down that the water hides entirely)
    this.ocean = new Ocean(renderer, this.dome.userData.cube);
    scene.add(this.ocean.mesh);
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2).translate(0, -700, 0), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    abyss.name = 'abyss';
    abyss.frustumCulled = false;
    scene.add(abyss);
    this.noAO.push(this.ocean.mesh, abyss);
    lap('sea');
    // the drowned city
    this.city = new City(this.track, this.grid, { dens: this.dens });
    const cm = this.city.meshes();
    for (const m of [...cm.stone, ...cm.floor]) { m.layers.set(2); m.receiveShadow = true; scene.add(m); }
    scene.add(cm.glow, cm.halo, cm.street);
    this.noAO.push(cm.halo, cm.street);
    this.cityMeshes = cm;
    lap('city');
    this.buildStacks(scene);
    lap('stacks');
    this.buildPylons(scene);
    lap('pylons');
    this.buildLighthouse(scene);
    // its life: leapers, leviathans, birds, the deep's shoals and jellyfish, spray
    this.life = new SeaLife(scene, this.track, { city: this.city, dens: this.dens });
    this.ocean.U.seRings.value = this.life.rings;
    this.noAO.push(...this.life.meshes);
    this.shipsWet = [];
    lap('life');
    this.worldShadow(scene);
    this.statics = [];
    scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.castShadow && o.layers.isEnabled(6)) this.statics.push(o); });
    for (const m of [this.track.parts.under]) { m.castShadow = true; this.statics.push(m); }
    this.staticsCast = true;
    // gantry lamps, as in space
    this.lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.65), 0, 70, 2); scene.add(l); return l; });
    this.minimap = this.track;
    this.startIndex = this.track.start;
    this.level = SEA_Y;
    this.nightLights = true;                         // (main.js: the ships' own lights on all the way round)
    // four real lights following the city's nearest big lamps: they light the ships and the deck going past
    this.cityLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffffff, 0, 100, 2); scene.add(l); return l; });
    this.bigLamps = this.city.lamps.filter((L) => L.I >= 1300);
    // the picture under the sea (main.js adds a map's own pass)
    this.heat = new UnderPass();
    lap('lights');
    console.info(`ocean built (ms): ${times.join(', ')}`);
  }

  // Sea stacks: basalt pillars standing out of the swell round the spray run and off the causeways, kept clear of the
  // track; the sea arch the track threads
  buildStacks(scene) {
    const tr = this.track, grid = this.grid, rnd = mulberry32(2207), f = {}, geos = [];
    const placed = [];
    const stack = (x, z, r, h, seed) => {
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < (q.r + r) * 1.5)) return false;
      const C = this.city.C, R = this.city.R;
      if (Math.hypot((x - C.x) / (R.x * 1.1), (z - C.z) / (R.z * 1.1)) < 1) return false;
      const g = stackGeometry({ x, z, r, h, seed });
      if (grid.geometryClear(g, 6, 7) < 0) return false;
      placed.push({ x, z, r });
      geos.push(g);
      return true;
    };
    // along the spray run and the arch, close in
    for (let s = tr.at('start', 300); s < tr.at('arch', 300); s += 50 + rnd() * 60) {
      tr.frame(s, f);
      const R = f.R.clone().setY(0).normalize(), sd = rnd() < 0.5 ? -1 : 1, lat = sd * (TRACK_W_HALF + 30 + rnd() * 140);
      stack(f.P.x + R.x * lat, f.P.z + R.z * lat, 9 + rnd() * 18, 30 + rnd() * 80, 40 + geos.length);
    }
    // out over the sea all round
    for (let k = 0; k < 2000 && geos.length < Math.round(60 * Math.max(0.5, this.dens)); k++) {
      const x = -1500 + rnd() * 5200, z = -2200 + rnd() * 4800;
      stack(x, z, 12 + rnd() * 40, 25 + Math.pow(rnd(), 1.4) * 150, 400 + k);
    }
    // the sea arch: a span of rock over the way from one stack to another
    tr.frame(tr.at('arch'), f);
    const Rh = f.R.clone().setY(0).normalize(), Th = f.T.clone().setY(0).normalize(), pts = [], rad = [];
    for (let i = 0; i <= 72; i++) {
      const u = i / 72 * 2 - 1, p = f.P.clone().addScaledVector(Rh, u * 120).addScaledVector(Th, 12 * Math.sin(u * 2.2));
      p.y = SEA_Y - 30 + (f.P.y + 58 - SEA_Y + 30) * (1 - Math.pow(Math.abs(u), 2.6));
      pts.push(p);
      rad.push(15 + 20 * Math.pow(Math.abs(u), 3) + 2.5 * Math.sin(u * 8));
    }
    const arch = archGeometry(pts, rad, { nr: 40, carve: 0.34, scale: 0.03, seed: 5 });
    console.info(`sea arch: clearance ${grid.geometryClear(arch, 0, 2).toFixed(1)} m`);
    geos.push(arch);
    for (const g of geos) { if (g.attributes.talus) g.deleteAttribute('talus'); if (g.attributes.uv) g.deleteAttribute('uv'); }
    const m = new THREE.Mesh(mergeGeometries(geos), (this.rockMat = basaltMaterial()));
    m.name = 'stacks';
    m.layers.set(2); m.layers.enable(6);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    console.info(`stacks: ${geos.length - 1}`);
  }

  // The old lighthouse out on its rock beside the far turn: its lantern's light swept round by a beam over the sea and
  // across the track every ~10 s
  buildLighthouse(scene) {
    const tr = this.track, f = tr.frame(tr.at('light', 30), {});
    const sd = tr.kh[Math.round(tr.at('light', 30) / tr.step) % tr.n] > 0 ? -1 : 1;           // (outside the turn)
    const R = f.R.clone().setY(0).normalize(), x = f.P.x + R.x * sd * 120, z = f.P.z + R.z * sd * 120, top = SEA_Y + 9;
    const rock = stackGeometry({ x, z, r: 24, h: top + 4, seed: 77 });
    const rm = new THREE.Mesh(rock, this.rockMat);
    rm.name = 'lighthouse-rock';
    rm.layers.set(2); rm.castShadow = rm.receiveShadow = true;
    const L = lighthouseGeometry(x, top + 2, z, 0.4);
    const tm = new THREE.Mesh(L.geometry, stoneMaterial({ key: 'lighthouse' }));
    tm.name = 'lighthouse';
    tm.layers.set(2); tm.castShadow = tm.receiveShadow = true;
    scene.add(rm, tm);
    // the lantern and its beam: two cones back to back, brightest along their middle, fading out along their length
    const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 11, 7) }));
    lamp.position.copy(L.lamp.p);
    const cone = new THREE.ConeGeometry(24, 900, 32, 1, true).rotateZ(Math.PI / 2).translate(-450, 0, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW; varying float vU;
        void main() { vU = -position.x / 900.0; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`varying vec3 vN; varying vec3 vW; varying float vU;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float core = pow(abs(dot(normalize(vN), v)), 4.0);
          float along = pow(1.0 - vU, 2.6) * smoothstep(0.0, 0.015, vU);
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * 0.09 * core * along * smoothstep(2.0, 40.0, distance(cameraPosition, vW)), 1.0);
        }`,
    });
    const beam = new THREE.Group();
    beam.position.copy(L.lamp.p);
    for (const a of [0, Math.PI]) { const m = new THREE.Mesh(cone, beamMat); m.rotation.y = a; m.rotation.z = -0.035; m.frustumCulled = false; beam.add(m); }
    scene.add(lamp, beam);
    this.beam = beam;
    this.noAO.push(lamp, ...beam.children);
  }

  // Pylons under the causeways and the viaduct: a tapered column out of the deep to a crosshead under the deck's
  // girders, every ~120 m wherever the deck runs level over the sea (none under the dive, the city, a cut, the loop)
  buildPylons(scene) {
    const tr = this.track, pos = [], idx = [];
    const box = (M, w, h, d, y0) => {
      const o = pos.length / 3, v = new THREE.Vector3();
      for (const [x, y, z] of [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) { v.set(x * w / 2, y0 + y * h, z * d / 2).applyMatrix4(M); pos.push(v.x, v.y, v.z); }
      for (const q of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) idx.push(o + q[0], o + q[1], o + q[2], o + q[0], o + q[2], o + q[3]);
    };
    const taper = (M, r0, r1, y0, y1) => {
      const o = pos.length / 3, v = new THREE.Vector3(), n = 10;
      for (let k = 0; k <= n; k++) for (const [y, r] of [[y0, r0], [y1, r1]]) {
        const a = (k / n) * Math.PI * 2;
        v.set(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(M); pos.push(v.x, v.y, v.z);
      }
      for (let k = 0; k < n; k++) { const a = o + k * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    };
    let n = 0;
    const M = new THREE.Matrix4(), deep = SEA_Y - 140;
    for (let s = 60; s < tr.length; s += 120) {
      if (tr.inGap(s, 50) || tr.inLoop(s, 80) || tr.inCave(s, 60)) continue;
      const f = tr.frame(s);
      if (f.U.y < 0.93 || f.P.y < SEA_Y + 3) continue;
      const top = f.P.y - 1.8 - 2.4 - 1.6 - deep;
      let clear = true;
      for (let y = 4; y < top - 8 && clear; y += 6) {
        const p = new THREE.Vector3(f.P.x, deep + y, f.P.z), i = tr.nearestIndex(p);
        if (Math.abs(tr.wrap(i * tr.step - s + tr.length / 2) - tr.length / 2) > 150 && tr.P[i].distanceTo(p) < 50) clear = false;
      }
      if (!clear) continue;
      const T = f.T.clone().setY(0).normalize(), R = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0));
      M.makeBasis(R, new THREE.Vector3(0, 1, 0), T.clone().negate()).setPosition(f.P.x, deep, f.P.z);
      const h = top;
      taper(M, 4.2, 2.2, 0, h - 3);
      box(M, 4.6, 3, 4.6, h - 3);
      box(M, 27, 1.6, 3.2, h - 0.2);
      for (const sd of [-1, 1]) box(new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(sd * 12, 0, 0)), 2.6, 0.6, 2.6, h + 1.4);
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const g = geo.toNonIndexed();
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.55, metalness: 0.5 }));
    m.name = 'pylons';
    m.layers.set(2); m.layers.enable(6);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    console.info(`pylons: ${n}`);
  }

  // The world's own shadow: a fourth light whose map (drawn once) covers the circuit and its scenery (desert.js)
  worldShadow(scene) {
    const box = new THREE.Box3().setFromPoints(this.track.P).expandByScalar(900);
    box.min.y = -160; box.max.y = Math.max(box.max.y, 260);
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
  }

  // Shadows (the setting), as on the desert
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

  setOptions(v) {
    this.life.setOn(v.seaLife !== false);
  }

  castStatics(on) {
    if (this.staticsCast === on) return;
    for (const o of this.statics) o.castShadow = on;
    this.staticsCast = on;
  }

  clearance(p) {
    const tr = this.track, i = tr.nearestIndex(p), d = p.clone().sub(tr.P[i]);
    const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
    if (Math.abs(x) < TRACK_W_HALF + 4 && y > -6 && y < 6.5) p.addScaledVector(tr.U[i], 6.5 - y);
  }

  // the camera coming up out of the sea: water on the lens (main.js)
  wetCheck(p) {
    const under = p.y < this.level, hit = this.camUnder === true && !under;
    this.camUnder = under;
    return hit;
  }

  // what the cameras and free flight stay over: the sea bed far down
  surface(x, z) { return this.city.basin.height(x, z); }
  height(x, z) { return this.city.basin.height(x, z); }
  hit() { return null; }

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
    if (this.staticsCast && !this.sunWorld.shadow.needsUpdate && !(this.worldOnly && this.sun.shadow.needsUpdate)) this.castStatics(false);
    this.skyCam.quaternion.copy(camera.quaternion);
    this.skyCam.fov = camera.fov;
    this.skyCam.aspect = camera.aspect;
    this.skyCam.updateProjectionMatrix();
    const dt = Math.max(0, t - (this.lastT ?? t));
    this.track.update(t, shipPos, dt);
    this.lastT = t;
    // the sea's level at the camera (the swell there): the fog's split, the dome's deep below it
    const cp = camera.position;
    this.level = waveHeight(cp.x, cp.z, t);
    this.fog.color.setRGB(1, t % 1000, this.level);
    this.dome.material.uniforms.under.value = Math.max(0, this.level - cp.y);
    const deep = smoothstep(0, 1.5, this.level - cp.y);
    // the eye opening up in the dark of the deep (main.js: the exposure times this)
    this.exposureK = 1 + 1.1 * smoothstep(10, 220, this.level - cp.y);
    this.heat.enabled = deep > 0;
    this.heat.quad.material.uniforms.time.value = t;
    this.heat.quad.material.uniforms.deep.value = deep;
    this.city.haloMat && (this.cityMeshes.halo.material.uniforms.lvl.value = this.level);
    this.ocean.update(t, camera);
    if (this.beam) this.beam.rotation.y = -t * (Math.PI * 2 / 10);
    // the city's nearest big lamps as real lights (only under the sea, and only near)
    {
      const near = cp.y < this.level + 5 ? this.bigLamps.map((L) => ({ L, d: L.p.distanceToSquared(cp) })).filter((e) => e.d < 250 * 250).sort((a, b) => a.d - b.d).slice(0, 4) : [];
      this.cityLights.forEach((l, k) => {
        const e = near[k];
        if (!e) { l.intensity = 0; return; }
        l.position.copy(e.L.p); l.color.setRGB(...e.L.col); l.distance = e.L.reach * 1.2; l.intensity = e.L.I * 2.2;
      });
    }
    // the city's chunks: drawn only as far as the water lets them be seen (from above the sea: what shows through it)
    {
      const reach = cp.y < this.level ? 1700 : 1100;
      for (const m of this.city.parts) {
        const sp = m.geometry.boundingSphere;
        m.visible = sp.center.distanceTo(cp) - sp.radius < reach;
      }
    }
    // the ships, for the life (splashes where they go into the sea or out of it, bubbles under it)
    const ws = this.shipsWet;
    if (this.race) this.race.entries.forEach((e, k) => {
      const w = (ws[k] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0 });
      w.pos.copy(e.ship.root.position);
      w.speed = e.racer.vel.length();
      w.dir.copy(e.racer.vel).normalize();
      w.near = w.pos.distanceTo(cp) < 160;
    });
    this.life.update(t, dt, camera, s, this.level, ws, renderer ? renderer.getPixelRatio() * (this.renderScale || 1) : 1);
    const tr = this.track, gi = tr.gantryIdx, sIdx = Math.floor(s / tr.step);
    gi.map((i) => ({ i, d: Math.min((i - sIdx + tr.n) % tr.n, (sIdx - i + tr.n) % tr.n) }))
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ i }, k) => {
        const l = this.lamps[k];
        l.position.copy(tr.P[i]).addScaledVector(tr.U[i], 12.9);
        l.color.set(i === gi[0] ? 0x60d0ff : 0xffe0b8);
        l.intensity = i === gi[0] ? 260 : 380;
      });
  }
}
