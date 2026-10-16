// The water planet: an ocean over the whole world at night, a great moon low in the north-north-east behind storm
// cloud. Off the grid the circuit runs north on a causeway low over the swell, swings east between sea stacks close
// enough to the water to feel its spray, threads a sea arch, climbs a viaduct to a jump, sweeps down a long banked
// left-hander - and dives into the sea: through the great gate of a drowned city, down its avenue, round its dome,
// through a temple's hall, under an aqueduct - then surges up out of the water off a kicker, rolls over the swell,
// passes the old lighthouse, loops, and comes home along the south.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track, TRACK_W, layout } from './track.js';
import { hullMaps } from './hull.js';
import { bakeLater } from './bake.js';
import { Q } from './quality.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, SUN_E, SUN_COL, SEA_Y, seaSkyDome, seaLight, Ocean, waveHeight, UnderPass, Shafts, Lightning } from './sea.js';
import { mesaGeometry, archGeometry } from './sandstone.js';
import { sunOnly, setCave } from './look.js';
import { City, lighthouseGeometry, stoneMaterial, castleGeometry, bakedGeometry } from './atlantis.js';
import { SeaLife } from './sealife.js';
import { GiantSquid } from './squid.js';
import { Rain } from './rain.js';
import { AlienPillars } from './pillars.js';
import { Seabed } from './seabed.js';
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
// the Keeper: the colossus standing on the abyss's floor, its feet 900 m down, its head and lantern over the sea
export const KEEPER = { x: 900, z: 250, foot: SEA_Y - 520, floor: SEA_Y - 900, scale: 0.65, yaw: THREE.MathUtils.degToRad(340), plinth: 250 };

// The circuit (x east, y up, z south; the sea at y 0). The grid faces north, the moon ahead and to the right.
const P = [];
const pt = (x, y, z, bank = 0, name = null) => P.push([x, y, z, bank, name]);
pt(0, 9, 650); pt(0, 9, 330, 0, 'start'); pt(0, 9, 20);
// east between the sea stacks, low over the swell (9.5 m: at 5 m the deck's girders and the pylons' heads lay in the
// waves, black slabs the swell washed over)
pt(40, 9.5, -260, 6); pt(200, 9.5, -480, 14); pt(460, 9.5, -600, 8, 'spray'); pt(760, 9.5, -640, 0);
// through the sea arch, then up onto the viaduct and the jump
pt(1020, 9.5, -630, -4, 'arch'); pt(1260, 11, -580, -10);
pt(1480, 26, -470, -16); pt(1680, 46, -300, -14); pt(1800, 62, -80, -4); pt(1830, 66, 80, 0, 'crest1');
pt(1840, 58, 300); pt(1830, 60, 520, 0, 'breach');
// a long descending left-hander, banked, and south of the Keeper the dive
pt(1760, 54, 760, 18); pt(1580, 44, 930, 26); pt(1400, 30, 905, 20); pt(1292, 16, 740, 10); pt(1272, 5, 520, 0, 'diveIn');
// down twice round the Keeper, the colossus standing out of the sea - 290 m out from its axis, to 620 m under the sea
for (let k = 0; k <= 32; k++) {
  const a = -(k / 32) * Math.PI * 4;
  pt(KEEPER.x + 290 * Math.cos(a), -22 - 598 * (k / 32), KEEPER.z + 290 * Math.sin(a), -28, k === 0 ? 'gate' : k === 16 ? 'spiralMid' : k === 32 ? 'spiralOut' : null);
}
// through the city at its feet, among the towers: round the great dome, through the hall on the temple mount, under
// the aqueduct, round and back
pt(1160, -632, 20, -8, 'avenue'); pt(1000, -642, -230, -14); pt(780, -648, -420, -18, 'dome'); pt(520, -650, -520, -6);
pt(280, -650, -560, 0, 'hallIn'); pt(40, -645, -590, 0, 'hallOut');
pt(-170, -632, -680, -14, 'aqueduct'); pt(-420, -620, -820, -26); pt(-560, -600, -1060, -32); pt(-480, -582, -1320, -30); pt(-230, -560, -1440, -18); pt(60, -540, -1430, -6);
// the long climb up out of the abyss, bursting out of the sea and off the kicker
pt(380, -485, -1330); pt(750, -385, -1210); pt(1120, -265, -1120); pt(1460, -150, -1065); pt(1760, -60, -1035, 0, 'surge');
pt(1990, -12, -1022); pt(2190, 10, -1012, 0, 'crest2'); pt(2410, 16, -1010);
// a barrel roll high over the swell (the road 56 m wide: rolled at 12 m its low edge went 16 m under the sea, and the
// ship and the camera with it - in and out of the water through the roll)
pt(2590, 48, -1015, 0, 'rollIn'); pt(2750, 48, -1025, 120); pt(2910, 48, -1035, 240); pt(3070, 48, -1045, 0, 'rollOut');
// the long sweep south past the lighthouse
pt(3250, 30, -940, 14); pt(3350, 20, -760, 24); pt(3390, 24, -480, 12, 'light'); pt(3390, 26, -150); pt(3350, 22, 200, -6);
pt(3270, 18, 560, -14); pt(3150, 16, 900, -18); pt(2900, 14, 1180, -24); pt(2550, 12, 1340, -14);
pt(2100, 10, 1420, 0);
// west along the south, the loop
pt(1600, 10, 1440, 0); pt(1150, 10, 1440, 0, 'preLoop');
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
    gantry: [2.6, 1.9, 1.2], lamp: [2.8, 2.2, 1.5], flip: [0.1, 0.9, 0.95], moss: false, sand: false, seaMoss: true },
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

// The light of the braziers round the Keeper's feet on its stone (and the pedestal's): each thrown up in a broad cone,
// worked out here and nowhere else (as scene lights they would cost every lit pixel of the map). U: kLP (x, y, z,
// strength) x 10, kLC its colour
function keeperLit(mat, U, key) {
  const ob = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    ob.call(mat, sh);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vKW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKW;\nuniform vec4 kLP[10];\nuniform vec3 kLC;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    vec3 kN = inverseTransformDirection( geometryNormal, viewMatrix );
    for ( int i = 0; i < 10; i++ ) {
      vec3 kL = kLP[ i ].xyz - vKW;
      float kd2 = dot( kL, kL );
      kL *= inversesqrt( kd2 );
      // (a broad cone up; its light carried far up the stone, gently - the colossus is 500 m tall beside the dive)
      float kUp = smoothstep( 0.05, 0.5, -kL.y ) + 0.15;
      reflectedLight.directDiffuse += kLC * kLP[ i ].w * max( dot( kN, kL ), 0.0 ) * kUp / ( kd2 * 0.35 + 3000.0 ) * BRDF_Lambert( material.diffuseColor );
    }
  }`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// A sea stack: a pillar of basalt out of the deep - its outline lobed and bitten, narrowing upward with ledges where a
// softer layer wore back, leaning a little, its top a broken crown of spires. x, z, r (its radius at the sea), h (its
// top over the sea)
function stackGeometry({ x, z, r, h, seed, calm = false }) {
  const rnd = mulberry32(seed), NU = r > 40 ? 64 : 44, s1 = rnd() * 50, s2 = rnd() * 50;
  const lean = (rnd() - 0.5) * 0.12, leanA = rnd() * Math.PI * 2;
  const rows = [];
  const yBot = SEA_Y - 180, dy = Math.max(2.5, h / 40);
  for (let y = yBot; y < h; y += y < -20 ? 20 : dy) rows.push(y);
  rows.push(h);
  const crown = Array.from({ length: NU }, (_, j) => {
    const th = (j / NU) * Math.PI * 2;
    if (calm) return h * (0.97 + 0.03 * fbm(Math.cos(th) * 2 + s1, Math.sin(th) * 2 + s2, 3));
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
  const cy = Math.max(...crown) * (calm ? 0.99 : 0.93);
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
    this.lightning = new Lightning();
    scene.add(this.lightning.mesh);
    // the rain over the sea (rain.js; the rings it makes on the sea: sea.js)
    this.rain = new Rain(scene, this.dens);
    this.shafts = new Shafts();
    scene.add(this.shafts.mesh);
    this.noAO.push(abyss, this.shafts.mesh);
    // the sea's surface is the AO's ground, not hidden from it: left out of its depth, the AO was worked out on what lies
    // under the sea and painted onto the surface over it - the drowned deck, rocks and pylons seen through the water as
    // dark shapes. In it as an occluder it hides them, and takes no AO itself (its canyonAO 1: main.js)
    this.aoOccluders = [this.ocean.mesh];
    lap('sea');
    // the drowned city
    this.city = new City(this.track, this.grid, { dens: this.dens, avoid: [{ x: KEEPER.x, z: KEEPER.z, r: 300 }] });
    this.buildKeeper(scene);
    const cm = this.city.meshes();
    for (const m of [...cm.stone, ...cm.floor]) { m.layers.set(2); m.receiveShadow = true; scene.add(m); }
    scene.add(cm.glow, cm.halo, cm.street);
    this.noAO.push(cm.halo, cm.street);
    this.cityMeshes = cm;
    this.bakeTrackLight();
    lap('city');
    this.buildStacks(scene);
    lap('stacks');
    this.buildPylons(scene);
    lap('pylons');
    this.buildLighthouse(scene);
    // the alien pillars: a ring of colossal ancient columns round the whole circuit (pillars.js)
    {
      const lh = this.lighthouseRock.geometry.boundingSphere || (this.lighthouseRock.geometry.computeBoundingSphere(), this.lighthouseRock.geometry.boundingSphere);
      this.pillars = new AlienPillars(scene, this.track, { avoid: [{ x: lh.center.x, z: lh.center.z, r: 140 }, { x: -130, z: -200, r: 120 }], skyCube: this.ocean.U.seSky.value });
      this.noAO.push(this.pillars.lights);
    }
    lap('pillars');
    // its life: leapers, leviathans, birds, the deep's shoals and jellyfish, spray
    this.life = new SeaLife(scene, this.track, { city: this.city, dens: this.dens });
    this.ocean.U.seRings.value = this.life.rings;
    this.noAO.push(...this.life.meshes);
    // round the way under the sea: pinnacles, kelp, weed off the track's edges, sea grass, anemones, vents, shoals
    this.seabed = new Seabed(scene, this.track, { grid: this.grid, basin: this.city.basin, keeper: KEEPER, rockMat: this.rockMat, dens: this.dens });
    this.noAO.push(...this.seabed.meshes.filter((m) => m !== this.seabed.rocks));
    this.noAO.push(...this.rain.meshes);
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
    this.headlight = { pos: [0, 0.55, -6.6], at: [0, -7.5, -36], angle: 0.62, penumbra: 0.8, distance: 170 };
    this.headlightK = 0.5;                           // (the headlights at half: the night darker round them)
    // four real lights following the city's nearest big lamps: they light the ships and the deck going past
    this.cityLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffffff, 0, 100, 2); scene.add(l); return l; });
    this.bigLamps = this.city.lamps.filter((L) => L.I >= 1300);
    // the picture under the sea (main.js adds a map's own pass)
    this.heat = new UnderPass();
    lap('lights');
    // The sea's floor and walls, the pinnacles, the Keeper's pedestal, the stacks: steep rock, kept out of the AO's own
    // shading as the desert's canyons are (main.js aoOccluders: their depth hides what lies behind them, a canyonAO of 1
    // leaves them unshaded) - under the sea the AO's false self-occlusion on steep ground drew dark squares on the walls
    // either side of the way that slid as the camera moved. One attribute shared by the floor's chunks
    {
      const ground = [...cm.floor, this.keeper.mesh, this.stacks, this.lighthouseRock, this.seabed.rocks].filter(Boolean), open = new Map();
      for (const m of ground) {
        if (m.geometry.attributes.canyonAO) continue;                 // (baked: the floor, the pinnacles, the pedestal)
        const pa = m.geometry.attributes.position;
        if (!open.has(pa)) open.set(pa, new THREE.BufferAttribute(new Float32Array(pa.count).fill(1), 1));
        m.geometry.setAttribute('canyonAO', open.get(pa));
      }
      this.aoOccluders.push(...ground);
    }
    console.info(`ocean built (ms): ${times.join(', ')}`);
  }

  // The city's lamps' light on the track under the sea, baked into its vertices (deck, belly, walls, girders) as on the
  // city's own stone: the road ahead lies lit in the lamps' pools as it comes into sight. Lit before only by the four
  // nearest lamps as real lights, the light came on round the ship as it got there
  bakeTrackLight() {
    const lamps = this.city.lamps, CELL = 60, grid = new Map(), tp = this.track.parts;
    for (const L of lamps) {
      const r = L.reach;
      for (let x = Math.floor((L.p.x - r) / CELL); x <= Math.floor((L.p.x + r) / CELL); x++)
        for (let y = Math.floor((L.p.y - r) / CELL); y <= Math.floor((L.p.y + r) / CELL); y++)
          for (let z = Math.floor((L.p.z - r) / CELL); z <= Math.floor((L.p.z + r) / CELL); z++) {
            const k = `${x},${y},${z}`;
            (grid.get(k) || grid.set(k, []).get(k)).push(L);
          }
    }
    const bake = (g) => {
      const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3, out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        if (py > SEA_Y - 2) continue;
        let r = 0, gg = 0, b = 0;
        for (const L of grid.get(`${Math.floor(px / CELL)},${Math.floor(py / CELL)},${Math.floor(pz / CELL)}`) || []) {
          const lx = L.p.x - px, ly = L.p.y - py, lz = L.p.z - pz, d2 = lx * lx + ly * ly + lz * lz, rr = L.reach * L.reach;
          if (d2 > rr) continue;
          const nl = Math.min(1, Math.max(0, (N[i * 3] * lx + N[i * 3 + 1] * ly + N[i * 3 + 2] * lz) / Math.sqrt(d2 + 1e-6) * 0.85 + 0.15));
          const q = 1 - d2 / rr, k = (L.I * 2.2 * nl * q * q) / (d2 + L.size * L.size) / Math.PI;
          r += L.col[0] * k; gg += L.col[1] * k; b += L.col[2] * k;
        }
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      }
      g.setAttribute('seaLit', new THREE.BufferAttribute(out, 3));
    };
    const meshes = [tp.deck, tp.under, ...tp.walls, ...tp.girders.filter((m) => !m.isInstancedMesh)];
    for (const m of meshes) bake(m.geometry);
    // the deck's and the hull plates' materials add it (other meshes of theirs read none: 0)
    for (const mat of new Set(meshes.map((m) => m.material))) {
      const ob = mat.onBeforeCompile, key = mat.customProgramCacheKey;
      mat.onBeforeCompile = (sh, r) => {
        ob.call(mat, sh, r);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 seaLit;\nvarying vec3 vSeaLit;')
          .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vSeaLit = seaLit;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaLit;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vSeaLit;');
      };
      mat.customProgramCacheKey = () => key.call(mat) + '-sealit';
    }
  }

  // The Keeper (assets/keeper.glb): an old hooded colossus of basalt and green bronze, worn and broken, its raised
  // lantern over the sea, a staff in its other hand, teal inlay runs still glowing here and there. Built 1.3 km tall;
  // at that size its shoulders and its staff crossed the dive's road wherever it faced - stood at two thirds on a basalt
  // pedestal out of the abyss's floor (its feet 520 m down) and turned so the road runs between its robe and its staff,
  // it clears the road by 17 m at the nearest (the road's real frames tested against every point of the model).
  // Three levels of detail by the camera's distance; the dead inlay only close up; the bands' glow uneven along them.
  buildKeeper(scene) {
    const K = KEEPER, yF = K.floor - 5, yT = K.foot;
    // braziers round the pedestal's lip throwing their light up the colossus (under the sea it was a dark shape, its
    // robe flat blue panels beside the dive): their light worked out in the stone's own shader (keeperLit), their flames
    // and glows the city's lamps'. Kept clear of the dive's road
    const ups = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.17, p = new THREE.Vector3(K.x + Math.cos(a) * 254, yT - 12.3, K.z + Math.sin(a) * 254);
      if (this.track.P[this.track.nearestIndex(p)].distanceTo(p) < 34) continue;
      ups.push(p);
    }
    this.keeperU = { kLP: { value: Array.from({ length: 10 }, (_, i) => (ups[i] ? new THREE.Vector4(ups[i].x, ups[i].y + 7, ups[i].z, 70000) : new THREE.Vector4(0, -1e5, 0, 0))) },
      kLC: { value: new THREE.Color(1.0, 0.62, 0.32) } };
    const pedMat = keeperLit(basaltMaterial({ key: 'keeper-ped' }), this.keeperU, 'keeper-ped');
    // (the bowls their own stone, not lit by their own fire's up-light: a few metres from it, they shone white)
    const bowlMat = basaltMaterial({ key: 'keeper-bowls' });
    const bowl = [[0, 0], [1.7, 0], [1.9, 0.5], [1.1, 1.1], [0.8, 3.0], [2.6, 3.9], [2.9, 4.5], [2.4, 4.6], [0, 4.1]].map(([r, y]) => new THREE.Vector2(r * 1.4, y * 1.4));
    const bowls = ups.map((p) => new THREE.LatheGeometry(bowl, 16).translate(p.x, p.y, p.z));
    for (const p of ups) this.city.lamps.push({ p: p.clone().setY(p.y + 7.2), col: [1.0, 0.55, 0.2], I: 16000, reach: 180, size: 3.2, kind: 'brazier' });
    // the pedestal: a column of basalt, flared where it stands on the floor, a lip under the statue's hem (<= 250 m), and
    // a ledge round it 12 m under the lip that the braziers stand on (set out past the lip, they floated in the water)
    const prof = [[0, yF], [268, yF], [262, yF + 30], [250, yF + 64], [238, yF + 130], [232, (yF + yT) / 2], [234, yT - 70],
      [244, yT - 36], [252, yT - 22], [262, yT - 16], [262, yT - 12.4], [249, yT - 12], [246, yT - 8], [245, yT], [0, yT]].map(([r, y]) => new THREE.Vector2(r, y));
    const pg = new THREE.LatheGeometry(prof, 96).translate(K.x, 0, K.z).deleteAttribute('uv');
    if (bowls.length) {
      const bm = new THREE.Mesh(mergeGeometries(bowls.map((g) => g.deleteAttribute('uv'))), bowlMat);
      bm.name = 'keeper-braziers';
      bm.layers.set(2);
      scene.add(bm);
    }
    // (its ambient baked, darker down where it stands on the floor: kept out of the AO's own, as the floor is)
    const pao = new Uint8Array(pg.attributes.position.count);
    for (let v = 0; v < pao.length; v++) pao[v] = Math.round(255 * (0.55 + 0.45 * smoothstep(yF, yF + 90, pg.attributes.position.getY(v))));
    pg.setAttribute('canyonAO', new THREE.Uint8BufferAttribute(pao, 1, true));
    const ped = new THREE.Mesh(pg, pedMat);
    ped.name = 'keeper-pedestal';
    ped.layers.set(2); ped.receiveShadow = true;
    scene.add(ped);
    // the lantern's light (made now: a light added after the warm-up recompiles every material); set where the model's
    // marker says once it is in
    const top = new THREE.Vector3(K.x - 256, K.foot + 725, K.z + 24);
    const light = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.3), 6e5, 1400, 2);
    light.position.copy(top);
    scene.add(light);
    this.keeper = { mesh: ped, light, top, lods: null, inlay: null };
    this.ready = new GLTFLoader().loadAsync('assets/keeper.glb').then((gltf) => {
      const root = gltf.scene;
      root.name = 'keeper';
      root.scale.setScalar(K.scale);
      root.rotation.y = K.yaw;
      root.position.set(K.x, K.foot, K.z);
      const part = (n) => root.getObjectByName(n);
      const lods = ['Keeper_LOD0', 'Keeper_LOD1', 'Keeper_LOD2'].map(part).filter(Boolean);
      const glows = ['glow_bands_live', 'glow_bands_dim', 'glow_eyes', 'glow_lantern'].map(part).filter(Boolean);
      const meshes = (o) => { const m = []; o.traverse((c) => { if (c.isMesh) m.push(c); }); return m; };
      // the stone: the broken pieces lying out past the pedestal's lip trimmed away (they lay on the floor at full size)
      const stone = new Set();
      for (const l of lods) for (const m of meshes(l)) stone.add(m.material);
      for (const mat of stone) {
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKeepP;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vKeepP = position;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKeepP;')
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vKeepP.y < 40.0 && length(vKeepP.xz) > ${(245 / K.scale).toFixed(1)}) discard;`);
        };
        mat.customProgramCacheKey = () => 'keeper-stone';
        keeperLit(mat, this.keeperU, 'keeper-stone');
      }
      // the bands: their glow along each run as baked (the vertex colour), dim and broken
      for (const g of glows.slice(0, 2)) for (const m of meshes(g)) {
        m.material.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_COLOR
  totalEmissiveRadiance *= vColor.r;
#endif`);
        };
        m.material.customProgramCacheKey = () => 'keeper-band';
      }
      root.traverse((o) => { if (o.isMesh) { o.layers.set(2); o.castShadow = false; o.receiveShadow = true; } });
      for (const g of glows) for (const m of meshes(g)) { m.receiveShadow = false; this.noAO.push(m); }
      root.updateMatrixWorld(true);
      const mark = part('light_lantern');
      if (mark) { mark.getWorldPosition(top); light.position.copy(top); }
      scene.add(root);
      Object.assign(this.keeper, { root, lods, inlay: part('Keeper_inlay_dead') });
    });
  }

  // the Keeper's detail by the camera's distance (LOD0 close, LOD1 past ~1 km, LOD2 past ~3.3 km)
  keeperLod(cp) {
    const k = this.keeper;
    if (!k || !k.lods || !k.lods.length) return;
    const d = Math.hypot(cp.x - KEEPER.x, cp.y - (KEEPER.foot + 300), cp.z - KEEPER.z);
    const l = d < 1000 ? 0 : d < 3300 ? 1 : 2;
    if (l === k.level) return;
    k.level = l;
    k.lods.forEach((o, i) => (o.visible = i === Math.min(l, k.lods.length - 1)));
    if (k.inlay) k.inlay.visible = l === 0;
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
      placed.push({ x, z, r, h });
      geos.push(g);
      return true;
    };
    // the kraken's rock: a great stack ahead and to the left of the grid, the giant squid on it (squid.js) - first, so
    // the others keep off it
    {
      // (over the drowned city's ground, where the other stacks are kept off: placed here by hand, clear of the track)
      const kx = -130, kz = -200, kr = 34, kh = 100, seed = 3131, kg = stackGeometry({ x: kx, z: kz, r: kr, h: kh, seed, calm: true });
      if (grid.geometryClear(kg, 6, 7) >= 0) {
        placed.push({ x: kx, z: kz, r: kr, h: kh });
        geos.push(kg);
        this.buildSquid(scene, kg, kx, kz, kr, kh);
      } else console.warn('the rock for the giant squid crosses the track: left out');
    }
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
    this.stacks = m;
    m.layers.set(2); m.layers.enable(6);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    // the tallest stacks within sight of the track crowned with a lit castle each (clear of the track)
    const builders = [], lamps = [], crnd = mulberry32(31);
    for (const q of placed.filter((q) => q.h > 45 && q.r > 14).sort((a, b) => b.h - a.h)) {
      if (builders.length >= Math.round(14 * Math.max(0.5, this.dens))) break;
      const i = tr.nearestIndex(new THREE.Vector3(q.x, 0, q.z)), d = Math.hypot(tr.P[i].x - q.x, tr.P[i].z - q.z);
      if (d > 1100) continue;
      const c = castleGeometry(q.x, q.h * 0.86, q.z, Math.min(q.r * 0.75, 26), crnd);
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(c.B.pos, 3));
      if (grid.geometryClear(tg, 4, 5) < 0) continue;
      builders.push(c.B); lamps.push(...c.lamps);
    }
    if (builders.length) {
      const cm = new THREE.Mesh(bakedGeometry(builders, lamps), stoneMaterial({ key: 'castles' }));
      cm.name = 'castles';
      cm.layers.set(2); cm.castShadow = cm.receiveShadow = true;
      scene.add(cm);
      const orb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), lamps.length);
      lamps.forEach((L, k) => {
        const sz = L.kind === 'brazier' ? 1.8 : 1.2;
        orb.setMatrixAt(k, new THREE.Matrix4().compose(L.p, new THREE.Quaternion(), new THREE.Vector3(sz, sz * 0.7, sz)));
        orb.setColorAt(k, new THREE.Color(L.col[0] * 12, L.col[1] * 12, L.col[2] * 12));
      });
      orb.name = 'castle-lamps';
      scene.add(orb);
      this.noAO.push(orb);
      this.castleLamps = lamps;
    }
    console.info(`stacks: ${geos.length - 1}, castles: ${builders.length}`);
  }

  // The giant squid on its rock: the rock's surface as a table - its angle round the axis by height - for the arms to
  // lie on, and the crown's height at each angle for the head to rest on (a texture for the shaders); it looks out
  // toward the grid
  buildSquid(scene, g, x, z, r, h) {
    const P = g.attributes.position.array, NUr = r > 40 ? 64 : 44, rows = Math.floor((P.length / 3 - 1) / NUr);
    const ry = [];
    for (let i = 0; i < rows; i++) { let m = -1e9; for (let j = 0; j < NUr; j++) m = Math.max(m, P[(i * NUr + j) * 3 + 1]); ry.push(m); }
    const y0 = -40, y1 = ry[rows - 1], NL = 64, tab = new Float32Array(NUr * NL * 4);
    const at = (i, j, c) => P[(i * NUr + (j % NUr)) * 3 + c];
    // (the crown: the top row's heights, each texel halfway between two columns, smoothed over its neighbours)
    const cr = Array.from({ length: NUr }, (_, j) => (at(rows - 1, j, 1) + at(rows - 1, j + 1, 1)) / 2);
    const crown = cr.map((_, j) => { let m = 0; for (let d = -2; d <= 2; d++) m += cr[(j + d + NUr) % NUr]; return m / 5; });
    for (let L = 0; L < NL; L++) {
      const y = y0 + ((L + 0.5) / NL) * (y1 - y0);
      let i = 0;
      while (i < rows - 2 && ry[i + 1] < y) i++;
      const t = Math.min(1, Math.max(0, (y - ry[i]) / Math.max(1e-3, ry[i + 1] - ry[i])));
      for (let j = 0; j < NUr; j++) {
        const px = (at(i, j, 0) + at(i, j + 1, 0)) / 2 * (1 - t) + (at(i + 1, j, 0) + at(i + 1, j + 1, 0)) / 2 * t;
        const pz = (at(i, j, 2) + at(i, j + 1, 2)) / 2 * (1 - t) + (at(i + 1, j, 2) + at(i + 1, j + 1, 2)) / 2 * t;
        tab.set([px - x, pz - z, crown[j], 0], (L * NUr + j) * 4);
      }
    }
    const half = new Uint16Array(tab.length);
    for (let k = 0; k < tab.length; k++) half[k] = THREE.DataUtils.toHalfFloat(tab[k]);
    const tex = new THREE.DataTexture(half, NUr, NL, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const grid = this.track.frame(this.track.at('start', 120), {}).P;
    this.squid = new GiantSquid(scene, { x, z, rockTex: tex, y0, y1, face: Math.atan2(grid.z - z, grid.x - x) });
    this.noAO.push(...this.squid.meshes);
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
    this.lighthouseRock = rm;
    rm.layers.set(2); rm.castShadow = rm.receiveShadow = true;
    const L = lighthouseGeometry(x, top + 2, z, 0.4);
    this.lightLamp = L.lamp;
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
    const M = new THREE.Matrix4();
    for (let s = 60; s < tr.length; s += 120) {
      if (tr.inGap(s, 50) || tr.inLoop(s, 80) || tr.inCave(s, 60)) continue;
      const f = tr.frame(s), deep = this.city ? this.city.basin.natural(f.P.x, f.P.z) - 6 : SEA_Y - 140;
      // (only where the deck stands high enough for the pylon's head to clear the swell's crests)
      if (f.U.y < 0.93 || f.P.y < SEA_Y + 9) continue;
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
    this.pylons = m;
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
    this.seabed.setOn(v.seaLife !== false);
    if (this.seabed.rocks) this.seabed.rocks.visible = true;
    this.mirrorOn = v.seaReflect !== false;
    this.stormOn = v.oceanStorm !== false;
    this.wetOn = v.shipWet !== false;
    this.squid?.setOn(v.kraken !== false);
    this.rainOn = v.oceanRain !== false;
    this.pillars.setOn(v.oceanPillars !== false);
    this.rain.setOn(this.rainOn);
    if (this.track.deckRainU) this.track.deckRainU.deckRain.value = this.rainOn ? 1 : 0;
    if (!this.mirrorOn) this.ocean.U.seReflOn.value = 0;
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

  // The lights that show in the sea as streaks of their own: the lighthouse's lantern and the Keeper's, always (the
  // rest show in the sea's mirror). Picked before as the twelve brightest of every big light round the sea, the set
  // changed all the time as the camera moved and the streaks swelled and faded in and out: the lights in the water
  // flickered
  reflectLights() {
    const U = this.ocean.U, fixed = [];
    if (this.lightLamp) fixed.push([this.lightLamp.p, [1.0, 0.86, 0.62], 30000]);
    if (this.keeper) fixed.push([this.keeper.top, [1.0, 0.8, 0.55], 120000]);
    for (let j = 0; j < 12; j++) {
      const q = fixed[j];
      if (!q) { U.seLP.value[j].set(0, -1e5, 0, 0); continue; }
      U.seLP.value[j].set(q[0].x, q[0].y, q[0].z, q[2]);
      U.seLC.value[j].set(q[1][0], q[1][1], q[1][2]);
    }
  }

  // (the race is handed over before the warm-up: the beams are made then, so their shaders compile with the rest)
  set race(r) { this._race = r; if (r) this.shipBeams(null); }
  get race() { return this._race; }

  // Every ship's headlight seen in the water: its beam, a soft cone ahead and down along the light's aim (no glow on
  // the hull itself - a lit ball on the nose looked wrong)
  shipBeams(cp) {
    if (!this.race) return;
    if (!this.beams) {
      const h = this.headlight, from = new THREE.Vector3(...h.pos), to = new THREE.Vector3(...h.at), len = 46;
      const dir = to.clone().sub(from).normalize();
      const cone = new THREE.ConeGeometry(Math.tan(h.angle * 0.62) * len, len, 24, 1, true).translate(0, -len / 2, 0)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)).translate(from.x, from.y, from.z);
      this.beams = this.race.entries.map((e) => {
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { k: { value: 0 }, from: { value: from }, len: { value: len } },
          vertexShader: /* glsl */`uniform vec3 from; uniform float len; varying vec3 vN; varying vec3 vW; varying float vU;
            void main() { vU = min(distance(position, from) / len, 1.0); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: /* glsl */`uniform float k; varying vec3 vN; varying vec3 vW; varying float vU;
            void main() {
              float core = pow(abs(dot(normalize(vN), normalize(cameraPosition - vW))), 2.5);
              gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * k * core * pow(max(1.0 - vU, 0.0), 1.8) * smoothstep(0.0, 0.08, vU), 1.0);
            }`,
        });
        const beam = new THREE.Mesh(cone, mat);
        beam.frustumCulled = false;
        e.ship.root.add(beam);
        this.noAO.push(beam);
        return { e, mat };
      });
    }
    if (!cp) return;
    for (const b of this.beams) {
      const p = b.e.ship.root.position, under = p.y < this.level;
      b.mat.uniforms.k.value = (b.e.ship.power ?? 1) * (under ? 0.05 : 0);
    }
  }

  // before each frame's draw: the sea's mirror (main.js), with what lies under the sea left out of it - and the dark
  // bulk of the track over it (its belly, girders, walls, the pylons): backlit by the moon they are black, and mirrored
  // in its glade the waves cut them into black slabs ("the black bug"). Its lights - strips, lamps, gantries - stay in
  preRender(renderer) {
    if (!this.mirrorOn || !this.cam) return;
    const tp = this.track.parts;
    const under = (this._under ||= [...this.city.parts, this.cityMeshes.halo, this.cityMeshes.street, this.cityMeshes.glow, this.shafts.mesh,
      this.life.shoal, this.life.jelly, this.life.snow, this.life.giant.mesh, ...this.scene.children.filter((o) => o.name === 'abyss'),
      tp.under, ...tp.girders, ...tp.walls, this.pylons, ...this.rain.meshes].filter(Boolean));
    this.ocean.reflect(renderer, this.scene, this.cam, this.sky, this.skyCam, this.fog, under);
  }

  // the things wholly above the sea and wholly under it (update: each not drawn from the other side) - none holding a
  // light: a light hidden would change every lit shader's light count
  sides() {
    const named = (re) => { const l = []; this.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && re.test(o.name)) l.push(o); }); return l; };
    const cm = this.cityMeshes;
    this.highOnly = named(/^(castles|stacks|lighthouse|lighthouse-rock)$/);
    this.deepOnly = [...named(/^(abyss|keeper-pedestal|keeper-braziers)$/), cm.street, cm.halo, cm.glow].filter(Boolean);
    for (const o of [...this.highOnly, ...this.deepOnly]) o.traverse((c) => { if (c.isLight) throw new Error(`a light under ${o.name}: not hidden by side`); });
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
    this.cam = camera;
    this.keeperLod(cp);
    this.level = waveHeight(cp.x, cp.z, t);
    this.fog.color.setRGB(1, t, this.level);         // (the clock as the surface's: the water's edge on things laps with its swell)
    this.dome.material.uniforms.under.value = Math.max(0, this.level - cp.y);
    const deep = smoothstep(0, 1.5, this.level - cp.y);
    this.underK = deep;                              // (audio.js: the sound heard through the water)
    // the exposure: over the sea a darker night (the track's lights, the headlights and the moon carry it); the eye
    // opening up in the dark of the deep (main.js: the exposure times this)
    this.exposureK = 0.78 + 1.02 * smoothstep(10, 220, this.level - cp.y);
    this.heat.enabled = deep > 0;
    this.heat.quad.material.uniforms.time.value = t;
    this.heat.quad.material.uniforms.deep.value = deep;
    // the camera going into the sea: a brief froth over the lens, and a burst of bubbles round the way ahead - off to
    // the sides and out of the way (260 of them a few metres ahead for 3 s and the froth for a second: nothing could
    // be seen for the first seconds under)
    const wentIn = this.camWasUnder === false && deep > 0.5;
    this.camWasUnder = deep > 0.5;
    if (wentIn) {
      this.frothT = t;
      const rnd = this.life.rnd, q = camera.quaternion, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      for (let k = 0; k < 70; k++) {
        const sd = rnd() < 0.5 ? -1 : 1;
        const p = cp.clone().addScaledVector(fwd, 6 + rnd() * 14).addScaledVector(side, sd * (3 + rnd() * 6)).add(new THREE.Vector3(0, (rnd() - 0.6) * 4, 0));
        this.life.spray.add(p, (rnd() - 0.5) * 2, rnd() * 1.5, (rnd() - 0.5) * 2, t, 1 + Math.round(rnd()), 2);
      }
    }
    const fr = this.frothT !== undefined ? Math.max(0, 1 - (t - this.frothT) / 0.45) : 0;
    this.heat.quad.material.uniforms.froth.value = fr * fr * deep;
    this.city.haloMat && (this.cityMeshes.halo.material.uniforms.lvl.value = this.level);
    this.ocean.update(t, camera);
    this.shafts.update(t, this.level);
    // the storm out to sea: the flash on the cloud, on everything (the moon's light and the sky's, a moment), thunder
    const fk = this.stormOn !== false ? this.lightning.update(t, cp, this.life.rnd) : 0;
    this.dome.material.uniforms.flashK.value = fk;
    this.dome.material.uniforms.flashDir.value.copy(this.lightning.dir);
    this.sun.intensity = SUN_E * (1 + 1.2 * fk * (cp.y > this.level ? 1 : 0.2));
    // (the sky's soft light weaker: the night's shadows deeper, the lights' pools stand out)
    this.scene.environmentIntensity = 1.15 * (1 + 0.8 * fk);
    if (this.lightning.thunderAt && t > this.lightning.thunderAt) { this.lightning.thunderAt = 0; this.thunder = true; }
    if (this.beam) this.beam.rotation.y = -t * (Math.PI * 2 / 10);
    // the city's nearest big lamps as real lights (only under the sea, and only near)
    {
      // (each kept on its lamp while that stays near, and faded in and out by its distance: they came on at full the
      // moment a lamp was among the four nearest)
      const near = cp.y < this.level + 5 ? this.bigLamps.map((L) => ({ L, d: L.p.distanceTo(cp) })).filter((e) => e.d < 250).sort((a, b) => a.d - b.d).slice(0, 6) : [];
      const held = (this._held ||= [null, null, null, null]);
      for (let k = 0; k < 4; k++) if (held[k] && !near.some((e) => e.L === held[k])) held[k] = null;
      for (const e of near) if (!held.includes(e.L)) { const k = held.indexOf(null); if (k >= 0) held[k] = e.L; }
      this.cityLights.forEach((l, k) => {
        const L = held[k];
        if (!L) { l.intensity = 0; return; }
        const d = L.p.distanceTo(cp);
        l.position.copy(L.p); l.color.setRGB(...L.col); l.distance = L.reach * 1.2; l.intensity = L.I * 2.2 * (1 - smoothstep(150, 245, d));
      });
    }
    // the city's chunks: drawn only as far as the water lets them be seen - from above the sea, not at all (the sea is
    // all but opaque from above, with hundreds of metres of water under it: nothing of the city shows through)
    {
      const reach = cp.y < this.level + 1 ? 1700 : -1e9;
      for (const m of this.city.parts) {
        const sp = m.geometry.boundingSphere;
        m.visible = sp.center.distanceTo(cp) - sp.radius < reach;
      }
    }
    this.reflectLights();
    this.shipBeams(cp);
    // the ships, for the life (splashes where they go into the sea or out of it, bubbles under it)
    const ws = this.shipsWet;
    if (this.race) this.race.entries.forEach((e, k) => {
      const w = (ws[k] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0 });
      w.pos.copy(e.ship.root.position);
      w.vel.copy(e.racer.vel);
      w.speed = e.racer.vel.length();
      w.dir.copy(e.racer.vel).normalize();
      w.near = w.pos.distanceTo(cp) < 160;
      // out of the sea: wet, drying over ~4.5 s (the hull's film and rivulets; water flung off it - sealife.js)
      const under = w.pos.y < waveHeight(w.pos.x, w.pos.z, t) - 0.5;
      if (w.wasUnder && !under) w.wetT = t;
      w.wasUnder = under;
      w.wet = this.wetOn !== false && w.wetT !== undefined ? Math.max(0, 1 - (t - w.wetT) / 4.5) : 0;
      const U = e.ship.deckU;
      if (U?.shipWet) { U.shipWet.value = w.wet; U.shipWetT.value = t; }
    });
    const pr = renderer ? renderer.getPixelRatio() * (this.renderScale || 1) : 1;
    this.life.update(t, dt, camera, s, this.level, ws, pr);
    this.seabed.update(t, this.level, ws.slice().sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp)), pr, cp);
    // what stands wholly above the sea is not drawn from deep in it, nor what lies wholly under it from above it:
    // nothing of either shows through the water and the surface between (frame for frame the same, from 165 m down)
    {
      if (!this.highOnly) this.sides();
      const deep = cp.y < this.level - 150, under = cp.y < this.level + 1;
      for (const o of this.highOnly) o.visible = !deep;
      for (const o of this.deepOnly) o.visible = under;
      this.squid?.update(dt, camera.position, deep);
      this.pillars.update(t, camera, pr, deep);
    }
    // the rain: falling round the camera, splashing on the deck ahead of it, lit by the nearest ships' headlights; the
    // sea's rings where it falls (none of it under the sea)
    if (this.rainOn !== false) {
      const under = cp.y < this.level, lamps = (this._lamps ||= []);
      lamps.length = 0;
      if (this.race) {
        for (const e of this.race.entries) {
          const r = e.ship.root, pw = e.ship.engineOn === false ? 0 : (e.ship.power ?? 1) * (this.headlightK ?? 1);
          lamps.push({ pos: r.position, fwd: (e._fwd ||= new THREE.Vector3()).set(0, 0, -1).applyQuaternion(r.quaternion), power: pw, d: r.position.distanceToSquared(cp) });
        }
        lamps.sort((a, b) => a.d - b.d);
      }
      const fr = (this._rainFr ||= Array.from({ length: 4 }, () => ({})));
      fr.forEach((f, i) => this.track.frame(this.track.wrap(s - 15 + i * 25), f));
      this.rain.update(t, dt, camera, under, lamps, fr, this.ocean.U.seTime.value);
      if (this.track.deckRainU) this.track.deckRainU.deckTime.value = t;
      this.ocean.U.seRain.value = under ? 0 : 1;
      this.rainLevel = under ? 0 : 1;                   // (its sound: audio.js)
    } else { this.ocean.U.seRain.value = 0; this.rainLevel = 0; }
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
