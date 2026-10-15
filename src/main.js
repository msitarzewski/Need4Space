// Feather S1 flight test: boots the map (the space circuit, or ?map=meadow), loads the ship, runs the loop.
// Space has two modes: RACE (anti-grav on the track, WipEout-style) and FREE flight (G toggles).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { MeadowWorld, SUN_DIR as MEADOW_SUN, SUN_FOG } from './world.js';
import { SpaceWorld, SUN_DIR as SPACE_SUN, SHADOW_HALF, SHADOW_NEAR, SHADOW_FAR, MID_HALF, MID_NEAR, MID_FAR, FAR_HALF, FAR_NEAR, FAR_FAR } from './space.js';
import { ForestWorld, SUN_DIR as FOREST_SUN } from './forest.js';
import { IceWorld, SUN_DIR as ICE_SUN } from './ice.js';
import { DesertWorld, SUN_DIR as DESERT_SUN } from './desert.js';
import { DUST_GLSL, DUST_FOG_CHUNK } from './haze.js';
import { ICE_GLSL, ICE_FOG_CHUNK } from './frost.js';
import { ATMO_GLSL, ATMO_FOG_CHUNK } from './atmo.js';
import { TrackRacer, TRACK_W, PERKS } from './track.js';
import { patchShaders } from './look.js';
import { smoothstep } from './noise.js';
import { loadShip, Ship } from './ship.js';
import { SHIP_URLS, RIVAL_TIER, HANDLING, shipChoice, shipName } from './ships.js';
import { Flight } from './flight.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { TouchControls, isTouch } from './touch.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import { agxPass, speedBlurPass, LayeredRenderPass, DeckSSRPass, StreakPass, BloomPass, ResamplePass, ShaftPass, LensWaterPass, GradePass, EngineHeatPass } from './post.js';
import { Settings, savedSettings } from './settings.js';
import { Race, Driver } from './race.js';
import { Menu } from './menu.js';
import { compileAll, deferBakes, runBakes, gpuIdle, postJobs } from './bake.js';
import { Q, setLite, integratedGPU, liteFiltering, memoryTier } from './quality.js';
import { preloadBakedTextures } from './bakedtextures.js';
import { beginLoadJobs, finishLoadJobs, stopLoadJobs } from './load-jobs.js';
import { Showroom } from './showroom.js';

// the map: the circuit chosen in the menu (saved), or ?map=space / forest / ice / desert / meadow (the meadow: the old test range)
const MAP = { meadow: 'meadow', forest: 'forest', space: 'space', ice: 'ice', desert: 'desert' }[new URLSearchParams(location.search).get('map') || savedSettings().map] || 'space';
// the ship: the one chosen in the menu (saved), or ?ship=feather / rocket (ships.js); its model by memory tier
const SHIP = shipChoice(savedSettings().ship), SHIP_URL = SHIP_URLS[SHIP], SHIP_NAME = shipName(SHIP);
const LUTS = ['assets/agx_punchy_lut65.bin', 'assets/agx_mhc_lut65.bin'];   // Blender's AgX looks: Punchy, Medium High Contrast
const status = (t) => (document.getElementById('loadtext').textContent = t);
// The loading bar: each step's share of it (by how long it usually takes) and how far into it. The page's first script
// had the first tenth (the files arriving); it only ever grows.
const STEPS = { circuit: [10, 16], bakes: [16, 38], paint: [38, 46], ship: [46, 68], rivals: [68, 72], colour: [72, 74],
  compile: [74, 90], textures: [90, 97], warm: [97, 100] };
let shown = 0;
const progress = (step, f = 0) => {
  const [a, b] = STEPS[step], p = Math.max(shown, a + (b - a) * Math.min(1, Math.max(0, f)));
  shown = p;
  window.__loadTaken = true;
  document.getElementById('lfill').style.transform = `scaleX(${p / 100})`;
  document.getElementById('loadpct').textContent = `${Math.floor(p)} %`;
};
// let the loading text paint between steps (a timer too: a hidden tab never gets an animation frame)
const nextFrame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
async function boot() {
  if (new URLSearchParams(location.search).has('bootprof')) (await import('./profile.js')).bootProfile();
  const sunDir = { space: SPACE_SUN, forest: FOREST_SUN, ice: ICE_SUN, desert: DESERT_SUN, meadow: MEADOW_SUN }[MAP];
  // (the forest uses the space map's cascades - the same boxes - and its own air for fog: atmo.js)
  patchShaders({ sunDir, sunFog: SUN_FOG, shadowHalf: MAP !== 'meadow' ? FAR_HALF : 22, shadowDepth: 200,
    cascades: MAP !== 'meadow' ? [{ half: SHADOW_HALF, depth: SHADOW_FAR - SHADOW_NEAR }, { half: MID_HALF, depth: MID_FAR - MID_NEAR },
      { half: FAR_HALF, depth: FAR_FAR - FAR_NEAR }] : null,
    ...(MAP === 'forest' ? { fogChunk: ATMO_FOG_CHUNK, fogPars: ATMO_GLSL, worldOnly: true } : {}),
    ...(MAP === 'ice' ? { fogChunk: ICE_FOG_CHUNK, fogPars: ICE_GLSL, worldOnly: true } : {}),
    ...(MAP === 'desert' ? { fogChunk: DUST_FOG_CHUNK, fogPars: DUST_GLSL, worldOnly: true } : {}) });
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // the GPU driver reset (too long a job for a slow GPU, or out of memory): say so rather than a frozen screen
  canvas.addEventListener('webglcontextlost', () => {
    status('The graphics driver stopped responding - reload the page (lower settings in Settings may help)');
    document.getElementById('loading').classList.remove('done');
    document.getElementById('loading').classList.add('error');
  });
  const agxLoad = agxPass(LUTS);                           // (the colour transform's tables load meanwhile)
  const gpuName = (() => {
    const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
    return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  })();
  // what the device can hold: the ship's maps and the bakes' sizes (quality.js)
  Q.tier = memoryTier(renderer, gpuName, isTouch(), !!savedSettings().laptop);
  const jobLoad = beginLoadJobs(MAP === 'forest');
  const bakedLoad = preloadBakedTextures(MAP);
  console.info(`GPU: ${gpuName} - memory tier ${Q.tier}${integratedGPU(gpuName) ? ' (integrated: Low graphics on a first visit)' : ''}`);
  agxLoad.catch(() => {});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;    // used only by the ACES setting (OutputPass)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;           // the filtering is PCSS (look.js)

  const scene = new THREE.Scene();
  // world matrices are brought up to date once a frame (render()), not by each of the frame's six scene renders
  scene.matrixWorldAutoUpdate = false;
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 30000);
  scene.add(camera);                                       // the speed streaks ride on the camera

  // the ship's download first: it runs on while the circuit is built and baked
  let baking = true, got = '', gotF = 0;
  const shipLoad = loadShip(SHIP_URL[Q.tier], (e) => {
    if (!e.total) return;
    got = `  ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`;
    gotF = e.loaded / e.total;
    if (!baking) { status(`Loading the ${SHIP_NAME}` + got); progress('ship', gotF); }
  });
  shipLoad.catch(() => {});
  // the rivals are Feathers whichever ship the player flies: another ship brings the Feather along for them
  const rivalLoad = SHIP !== 'feather' ? loadShip(SHIP_URLS.feather[RIVAL_TIER[Q.tier]]) : null;
  rivalLoad?.catch(() => {});
  status(MAP === 'meadow' ? 'Raising the hills' : 'Building the circuit');
  progress('circuit');
  await Promise.all([nextFrame(), bakedLoad, jobLoad]);
  deferBakes(true);
  const world = MAP === 'space' ? new SpaceWorld(scene, renderer, camera) : MAP === 'forest' ? new ForestWorld(scene, renderer, camera)
    : MAP === 'ice' ? new IceWorld(scene, renderer, camera) : MAP === 'desert' ? new DesertWorld(scene, renderer, camera) : new MeadowWorld(scene, renderer);
  deferBakes(false);
  await finishLoadJobs();
  progress('circuit', 1);
  await runBakes(renderer, (what, k, n) => { status(`${what}  ${k} / ${n}`); progress(/Painting/.test(what) ? 'paint' : 'bakes', k / n); });
  baking = false;
  status(`Loading the ${SHIP_NAME}` + got);
  progress('ship', gotF);
  const ship = await shipLoad;
  const rivalShip = rivalLoad ? await rivalLoad : ship;
  await world.ready;                                   // (a world's own models: the space station's - before the warm-up)
  ship.upgradeMaterials(renderer.capabilities.getMaxAnisotropy(), renderer);
  if (rivalShip !== ship) rivalShip.upgradeMaterials(renderer.capabilities.getMaxAnisotropy(), renderer);
  scene.add(ship.root);
  console.info(`ship: ${Math.round(ship.tris)} tris, ${ship.rotors.length} rotors, canopy ${!!ship.canopy}, ` +
    `plumes ${ship.plumes.length}, tangents repaired ${ship.tangentsFixed}`);

  const flight = new Flight(ship, world, world);
  if (MAP !== 'meadow') flight.gravity = 0;
  const track = world.track || null;
  const racer = track ? new TrackRacer(ship, track) : null;
  if (racer) racer.handling = HANDLING[SHIP] || HANDLING.feather;      // how the chosen ship flies (ships.js)
  // eight rivals, cloned before the player's ship first animates (their canopies and rotors start at rest)
  status('Rolling out the rivals');
  progress('rivals');
  const race = racer ? new Race(scene, track, ship, racer, { rivals: rivalShip, name: SHIP_NAME }) : null;
  world.race = race;                                       // (a world may read the ships: the ice planet's wakes)
  let mode = racer ? 'race' : 'free';
  let ctl = racer || flight;
  const rig = new CameraRig(camera, world);
  const START = world.startIndex;
  const mm = world.minimap;
  const heading = (i) => { const j = (i + 15) % mm.n; return Math.atan2(-(mm.px[j] - mm.px[i]), -(mm.pz[j] - mm.pz[i])); };
  const placeStart = (hover) => {
    if (mode === 'race') { race.reset(); dispatchEvent(new CustomEvent('need4space:race-reset', { detail: race.level })); }
    else if (MAP === 'meadow') flight.place(mm.px[START], mm.pz[START], heading(START), hover);
    else {                                               // free flight in space starts over the start line
      flight.place(0, 0, 0, false);
      flight.pos.copy(track.P[track.start]).addScaledVector(track.U[track.start], 6);
      flight.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(track.R[track.start], track.U[track.start], track.T[track.start].clone().negate()));
    }
    ship.clearTrails();
    rig.snap(ctl);
  };
  const setMode = (m) => {
    if (!racer || m === mode) return;
    if (m === 'free') {                                  // leave the track with the racer's pose and speed
      flight.pos.copy(racer.pos); flight.q.copy(racer.q); flight.vel.copy(racer.vel);
      flight.throttle = racer.throttle; flight.rate.set(0, 0, 0);
    } else {                                             // back onto the deck nearest the ship
      const i = track.nearestIndex(flight.pos);
      racer.place(i * track.step, ship.engineOn);
      racer.vs = Math.max(0, flight.vel.dot(track.T[i]));
      racer.throttle = flight.throttle;
    }
    mode = m;
    ctl = m === 'race' ? racer : flight;
    rig.rollFollow = m === 'race' ? 1 : 0.6;
    rig.anchorFn = m === 'race' ? trackAnchor : null;
    rig.snap(ctl);
    ship.clearTrails();
  };
  // the fly-by camera on the track: ahead along the circuit, outside a wall, above the deck there
  const trackAnchor = (lead) => {
    const f = track.frame(racer.s + lead);
    return f.P.clone().addScaledVector(f.R, (Math.random() < 0.5 ? -1 : 1) * (TRACK_W / 2 + 12 + Math.random() * 10))
      .addScaledVector(f.U, 6 + Math.random() * 10);
  };
  rig.rollFollow = mode === 'race' ? 1 : 0.6;
  rig.anchorFn = mode === 'race' ? trackAnchor : null;
  // the chase camera stays at least 2.4 m over the deck under it, and sees the ship over the deck (inside a loop the
  // deck curves up behind the ship). It was held over the deck 15 m behind the ship, not under the camera (17-26 m
  // back): on the rolling straight the deck turns about its centre line, so off the centre the deck under the camera
  // stood metres above that plane - "when i rotate on a road, it goes thru the road and looks off"
  const camF = {}, camD = new THREE.Vector3(), camS = new THREE.Vector3();
  // p's height over the deck at its own slice of the track (searched from s0) and its offset across it; null in a gap
  const overDeck = (p, s0) => {
    let s = s0;
    for (let k = 0; k < 3; k++) { track.frame(s, camF); s += camD.subVectors(p, camF.P).dot(camF.T); }
    if (track.inGap(s)) return null;
    track.frame(s, camF);
    camD.subVectors(p, camF.P);
    return { h: camD.dot(camF.U), x: camD.dot(camF.R), U: camF.U };
  };
  rig.deckFn = (p) => {
    if (mode !== 'race' || !track) return;
    let d = overDeck(p, racer.s - 20);
    if (d && Math.abs(d.x) < TRACK_W / 2 + 6 && d.h < 2.4) p.addScaledVector(d.U, 2.4 - d.h);
    // (and the view of the ship: the points between them over the deck too)
    const sp = ship.root.position;
    for (const k of [0.3, 0.6, 0.85]) {
      d = overDeck(camS.lerpVectors(sp, p, k), racer.s - 20 * k);
      if (d && Math.abs(d.x) < TRACK_W / 2 + 2 && d.h < 0.8) p.addScaledVector(d.U, (0.8 - d.h) / k);
    }
  };
  placeStart(false);
  // ship lights for the meteorite tunnel: the player's headlight (faint in daylight, full in the dark) and three
  // lights that follow the nearest rivals' engines through it (a fixed number: no shader recompiles mid-race)
  const headlight = new THREE.SpotLight(0xe4ecff, 0, 300, 0.45, 0.6, 1.5);
  headlight.position.set(0, 0.9, -6.5);
  headlight.target.position.set(0, -4, -70);
  ship.root.add(headlight, headlight.target);
  const rivalLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 70, 1.6); l.userData.rivalLight = true; scene.add(l); return l; });
  const RIVAL_LIGHT = { y: 0.3, z: 9.5, cd: 320 };
  const input = new Input(canvas);
  const touch = new TouchControls(input);              // phones and tablets: sticks and buttons on screen (the setting)
  const fx = new FX(scene, camera);
  fx.track = track;
  const hud = new HUD(mm, START);
  const audio = new GameAudio();

  // post: sky + scene (HDR, 4x MSAA in the first pass only) + NaN guard -> AO -> deck reflections -> bloom -> streaks
  // -> speed blur -> Blender's AgX (or ACES); the chain's own targets are plain (no samples, no depth)
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, depthBuffer: false });
  const composer = new EffectComposer(renderer, rt);
  const scenePass = new LayeredRenderPass(world.sky || null, world.skyCam || null, scene, camera);
  composer.addPass(scenePass);
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2.0, scale: 1.15, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  const aoOccluders = world.aoOccluders && new Set(world.aoOccluders);
  const canyonAO = { value: 1 };
  if (aoOccluders?.size) {
    // Alpha below 0.5 carries a wall's baked ambient visibility, scaled by 1/4.
    // Its depth still blocks buried objects; its shading remains fixed to the terrain.
    const depth = 'float depth = getDepth(vUv.xy);';
    const mask = 'float wallAO = textureLod(tNormal, vUv, 0.0).a;\n'
      + 'if (wallAO < 0.5) { gl_FragColor = vec4(vec3(mix(1.0, wallAO * 4.0, canyonAO)), 1.0); return; }\n';
    for (const m of [gtao.gtaoMaterial, gtao.pdMaterial]) {
      if (!m.fragmentShader.includes(depth)) throw new Error('AO shader changed: occluder mask not applied');
      m.fragmentShader = 'uniform float canyonAO;\n' + m.fragmentShader.replace(depth, mask + depth);
      m.uniforms.canyonAO = canyonAO;
    }
  }
  // Keep each mesh layout's normal-program state instead of changing it for every draw.
  const normalMaterials = [gtao.normalMaterial], normalOverride = gtao.renderOverride.bind(gtao);
  gtao.renderOverride = (renderer, material, ...args) => {
    if (material !== gtao.normalMaterial) return normalOverride(renderer, material, ...args);
    const direct = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (camera, scene, geometry, drawMaterial, object, group) {
      if (drawMaterial === material) {
        const key = (object.isInstancedMesh ? 1 : 0) | (object.instanceColor ? 2 : 0) | (object.isSkinnedMesh ? 4 : 0)
          | (geometry.morphAttributes.position ? 8 : 0) | (geometry.morphAttributes.normal ? 16 : 0)
          | (aoOccluders?.has(object) ? 32 : 0);
        if (!normalMaterials[key]) {
          normalMaterials[key] = material.clone();
          if (key & 32) {
            normalMaterials[key].onBeforeCompile = (sh) => {
              sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float canyonAO; varying float vCanyonAO;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCanyonAO = canyonAO;');
              const alpha = 'gl_FragColor.a = 1.0;';
              if (!sh.fragmentShader.includes(alpha)) throw new Error('Normal shader changed: wall AO not applied');
              sh.fragmentShader = 'varying float vCanyonAO;\n' + sh.fragmentShader.replace(/}\s*$/, 'gl_FragColor.a = vCanyonAO * 0.25;\n}');
            };
            normalMaterials[key].customProgramCacheKey = () => 'canyon-ao-normal';
          }
        }
        drawMaterial = normalMaterials[key];
      }
      return direct.call(this, camera, scene, geometry, drawMaterial, object, group);
    };
    try { return normalOverride(renderer, material, ...args); }
    finally { renderer.renderBufferDirect = direct; }
  };
  const gtaoDispose = gtao.dispose.bind(gtao);
  gtao.dispose = () => { normalMaterials.forEach((m, i) => { if (i) m.dispose(); }); gtaoDispose(); };
  // Point and line pools are all created before warm-up; only their visibility changes during a race.
  let aoNonMeshes;
  const aoHidden = [];
  gtao.overrideVisibility = () => {
    if (!aoNonMeshes) {
      aoNonMeshes = [];
      scene.traverse((o) => { if (o.isPoints || o.isLine) aoNonMeshes.push(o); });
    }
    aoHidden.length = 0;
    for (const o of aoNonMeshes) if (o.visible) { aoHidden.push(o); o.visible = false; }
  };
  gtao.restoreVisibility = () => { for (const o of aoHidden) o.visible = true; aoHidden.length = 0; };
  const gtaoRender = gtao.render.bind(gtao);
  // AO at half resolution when asked (or by itself above 1440p): its own targets at half size, blended back onto the
  // full frame (2.1 ms -> ~0.6 ms at 4K; AO is soft anyway)
  const gtaoSetSize = gtao.setSize.bind(gtao);
  let aoHalf = false;
  gtao.setSize = (w, h) => { gtao.fullSize = [w, h]; gtaoSetSize(aoHalf ? Math.max(1, w >> 1) : w, aoHalf ? Math.max(1, h >> 1) : h); };
  const tp = track ? track.parts : null;
  let showroom = null;                                   // the Ship screen's studio (showroom.js; made below)
  const noAO = () => [...(world.noAO || []), ...ship.fxObjects(), ...fx.pools.map((p) => p.points), fx.streaks.lines, fx.ring, fx.marks.mesh, fx.trails.mesh,
    ...(tp ? [...tp.fields, ...tp.pads, ...tp.lanes, ...tp.gates.filter((m) => m.material.isShaderMaterial), ...(tp.flips || []).filter((m) => m.material.transparent), tp.tunnel[0]].filter(Boolean) : []), ...(race ? race.noAO() : []), ...fx.waves,
    ...(world.dust ? [world.dust] : []), ...(showroom && showroom.active ? showroom.fxObjects() : [])];
  gtao.render = (renderer, writeBuffer, readBuffer, ...args) => { // glows, plumes, trails, particles, fields and decals must not occlude anything
    const hide = noAO().filter((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const output = gtao.output, inPlace = output === GTAOPass.OUTPUT.Default && !gtao.renderToScreen;
    gtao.needsSwap = !inPlace;
    try {
      if (inPlace) gtao.output = GTAOPass.OUTPUT.Off;
      gtaoRender(renderer, writeBuffer, readBuffer, ...args);
      if (inPlace) {
        // Multiply AO into the existing HDR colour buffer, saving its full-frame copy.
        const blend = gtao.blendMaterial;
        blend.uniforms.intensity.value = gtao.blendIntensity;
        blend.uniforms.tDiffuse.value = gtao.pdRenderTarget.texture;
        gtao.renderPass(renderer, blend, readBuffer);
      }
    } finally {
      gtao.output = output;
      hide.forEach((o) => (o.visible = true));
    }
  };
  // The dust between the camera and what the AO darkens is not occluded: the AO fades with the air's transmittance to
  // the pixel (in the desert's sandstorm the mesas, towers and posts deep in the dust were darkened out of it as dark
  // shapes)
  if (MAP === 'desert') {
    const b = gtao.blendMaterial, g = gtao.gtaoMaterial.uniforms, tex = 'vec4 texel = texture2D( tDiffuse, vUv );';
    if (!b.fragmentShader.includes(tex)) throw new Error('AO blend shader changed: dust fade not applied');
    Object.assign(b.uniforms, { tDepth: g.tDepth, cameraProjectionMatrixInverse: g.cameraProjectionMatrixInverse,
      cameraWorldMatrix: g.cameraWorldMatrix, fogColor: { value: scene.fog.color } });
    b.fragmentShader = 'uniform sampler2D tDepth;\nuniform mat4 cameraProjectionMatrixInverse, cameraWorldMatrix;\nuniform vec3 fogColor;\n'
      + DUST_GLSL + b.fragmentShader.replace(tex, tex + /* glsl */`
			float z = texture2D( tDepth, vUv ).r;
			if ( z < 1.0 ) {
				vec4 vp = cameraProjectionMatrixInverse * vec4( vec3( vUv, z ) * 2.0 - 1.0, 1.0 );
				vec3 v = vp.xyz / vp.w, o = cameraWorldMatrix[ 3 ].xyz, d = normalize( mat3( cameraWorldMatrix ) * v );
				vec3 aT, aL, sT, sL;
				daPath( o, d, length( v ), aT, aL );
				daStorm( o, d, length( v ), fogColor.r, fogColor.g, 2, sT, sL );   // (as the fog chunk: strength, clock)
				texel.rgb = mix( vec3( 1.0 ), texel.rgb, dot( aT * sT, vec3( 1.0 / 3.0 ) ) );
			}`);
    b.needsUpdate = true;
  }
  composer.addPass(gtao);
  // reflections on the deck (uses the AO pass's depth and normals: off with AO)
  const ssr = new DeckSSRPass(scene, camera, gtao);
  if (track) {
    track.parts.deck.layers.enable(5);
    ssr.setReflector(track.parts.deck);
    composer.addPass(ssr);
  } else ssr.enabled = false;
  // light shafts through the gaps of what stands in front of the sun (a map with air: the forest moon)
  const shafts = new ShaftPass();
  composer.addPass(shafts);
  // the engines' heat shimmer - before the bloom, so the plumes' glow bends with the air behind them
  const heat = new EngineHeatPass();
  heat.camera = camera;
  composer.addPass(heat);
  // only what is really bright, a tight halo (at 0.45 / threshold 1.1 every light strip hazed into white); the
  // dual-filter bloom (post.js): no squares round a glint
  const bloom = new BloomPass({ threshold: 2.6, knee: 1.0, strength: 0.9, radius: 0.62 });
  composer.addPass(bloom);
  const streaks = new StreakPass();
  composer.addPass(streaks);
  const blur = speedBlurPass();
  composer.addPass(blur);
  // a map's own pass over the picture (the desert's heat shimmer)
  if (world.heat) { world.heat.camera = camera; composer.addPass(world.heat); }
  // the map's own grade (a map under a bright sky: its contrast and colour back)
  const grade = new GradePass();
  Object.assign(grade, world.grade || {});
  grade.enabled = !!world.grade;
  composer.addPass(grade);
  status('Loading the colour transform');
  progress('colour');
  const agx = await agxLoad;
  const output = new OutputPass();
  composer.addPass(agx);
  composer.addPass(output);
  // SMAA on the finished, tone-mapped picture: MSAA smooths geometry edges only (and its HDR resolve leaves bright
  // edges stepped); SMAA also takes the stair-steps off shading, highlights and thin glowing lines
  // water on the lens after flying through a waterfall (on the finished picture)
  const lens = new LensWaterPass();
  composer.addPass(lens);
  const smaa = new SMAAPass(innerWidth, innerHeight);
  composer.addPass(smaa);
  // the render scale: the frame drawn at a fraction (or a multiple) of the screen's pixels, resampled to it here
  const resample = new ResamplePass();
  composer.addPass(resample);
  const fleet = () => (race ? race.entries.map((e) => e.ship) : [ship]);
  // The deck's light on the ships (ship.js setDeckLight): the deck's mean colour, and per ship this frame the sun on the
  // deck under it, the sky's share over it (none in a cave) and the engine lights, lamps and headlight round it.
  const deckColour = track ? track.deckAlbedo(renderer) : new THREE.Color(0.25, 0.25, 0.25);
  const deck = { k: 1, up: new THREE.Vector3(), sun: new THREE.Vector3(), E: new THREE.Color(), p: new THREE.Vector3() };
  let deckLights = null;
  // over a jump's gap the deck below is gone: 1 on the deck, down to a quarter 15 m into the gap
  const deckGap = (s) => {
    let k = 1;
    for (const [s0, s1] of track.gaps) {
      const d = track.wrap(s - s0), L = track.wrap(s1 - s0);
      if (d <= L) k = Math.min(k, 1 - 0.75 * smoothstep(0, 15, Math.min(d, L - d)));
    }
    return k;
  };
  const deckLight = () => {
    const sun = world.sun || world.sunL?.sun, D = deck;
    if (sun) D.sun.copy(sun.position).sub(sun.target.position).normalize();
    const lights = (deckLights ||= [...rivalLights, ...(world.lamps || []), ...fleet().flatMap((s) => s.exhaustLights)]);
    for (const e of race ? race.entries : [{ ship, racer }]) {
      const s = e.ship, p = s.root.position;
      D.up.set(0, 1, 0).applyQuaternion(s.root.quaternion);
      const cave = track ? track.caveLight(p) : 1;
      D.E.setRGB(0, 0, 0);
      if (sun) D.E.copy(sun.color).multiplyScalar(sun.intensity * Math.max(0, D.sun.dot(D.up)) * cave);
      // a light's mean irradiance over the deck within 6 m of the ship, h over it, fading with its distance away
      for (const l of lights) {
        if (!l.visible || !(l.intensity > 0)) continue;
        D.p.setFromMatrixPosition(l.matrixWorld).sub(p);                    // (the world's matrices are up to date)
        const y = D.p.dot(D.up), h = Math.max(0.5, y + 1.2), r2 = D.p.lengthSq() - y * y;
        const w = 2 * (1 - h / Math.sqrt(36 + h * h)) / 36 * Math.exp(-r2 / 64);
        if (w > 1e-4) D.E.r += l.color.r * l.intensity * w, D.E.g += l.color.g * l.intensity * w, D.E.b += l.color.b * l.intensity * w;
      }
      // the player's headlight (the meteorite): its pool lies ahead, a little of it under the ship
      if (s === ship && headlight.intensity > 0) D.E.r += headlight.color.r * headlight.intensity * 1e-4, D.E.g += headlight.color.g * headlight.intensity * 1e-4,
        D.E.b += headlight.color.b * headlight.intensity * 1e-4;
      const gap = track && e.racer ? deckGap(e.racer.s) : 1;
      s.setDeckLight(D.up, deckColour, D.E, 0.012 + 0.988 * cave, deck.k * gap);
    }
  };
  // before each frame's draw (the world's matrices up to date): every ship's deck light and the engines' heat sources
  const shipLook = () => { deckLight(); if (heat.enabled) heat.gather(camera, fleet()); };
  let pixelRatio = Math.min(devicePixelRatio, 2), renderScale = 1, blurOn = true, aoRes = 'auto';
  // half-size AO: asked for, or 'auto' with more than ~1440p of pixels to fill
  const applyAoRes = () => {
    const half = aoRes === 'half' || (aoRes === 'auto' && innerWidth * innerHeight * (pixelRatio * renderScale) ** 2 > 2560 * 1440 * 1.1);
    if (half !== aoHalf) { aoHalf = half; if (gtao.fullSize) gtao.setSize(...gtao.fullSize); }
  };
  let redraw = 2;                                          // frames still to draw while paused (see frame())
  // A setting that changes what the materials' programs are (Low's lite shaders and fewer lights, shadows on / off,
  // a pass turned on): every program of the world built again at once, in parallel, then one draw of everything at an
  // eighth of the size off screen (the shadow, depth and AO variants) - as the loading screen does - rather than one
  // by one as each thing comes into view in the race (High -> Low mid-session: a 300 ms freeze, then 12-30 ms hitches
  // for ~20 more programs over the next lap, on a fast desktop).
  let warmed = false, programSig = '', warming = null, warmAgain = false;
  const rewarm = () => {
    if (warming) { warmAgain = true; return warming; }
    warming = (async () => {
      do {
        warmAgain = false;
        const keep = [];
        const showAll = () => { for (const root of [scene, world.sky].filter(Boolean)) root.traverse((o) => { if (o.isLight) return; keep.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; }); };
        const restore = () => { for (const [o, v, f] of keep) { o.visible = v; o.frustumCulled = f; } keep.length = 0; };
        const jobs = [[scene, camera]];
        if (world.sky) jobs.push([world.sky, world.skyCam]);
        // (compileAll hands every program over before its first wait: shown only for that moment, no frame between)
        showAll();
        renderer.setRenderTarget(scenePass.msaa);
        const built = compileAll(renderer, [...jobs, ...postJobs(composer.passes.filter((p) => p.enabled || p === lens))]);
        renderer.setRenderTarget(null);
        restore();
        await built;
        showAll();
        composer.setPixelRatio(pixelRatio * renderScale / 8);
        composer.setSize(innerWidth, innerHeight);
        composer.renderToScreen = false;
        scene.updateMatrixWorld(); shipLook(); composer.render();
        composer.renderToScreen = true;
        restore();
        resize();
      } while (warmAgain);
      warming = null;
    })();
    return warming;
  };
  const resize = () => {
    redraw = 2;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);                      // the canvas: the screen's own pixels
    composer.setPixelRatio(pixelRatio * renderScale);       // the frame: at the render scale (resampled at the end)
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    applyAoRes();
    world.renderScale = renderScale;                         // (point sprites size themselves in frame pixels)
  };
  addEventListener('resize', resize);
  const fpsEl = document.getElementById('fps');
  const sunLights = world.sun ? [world.sun, world.sunMid, world.sunFar] : [world.sunL.sun];
  const settings = new Settings((v) => {
    agx.enabled = v.tonemap !== 'aces';
    agx.setLook(v.tonemap === 'agx' ? 1 : 0);
    output.enabled = !agx.enabled;
    agx.uniforms.exposure.value = Math.pow(2, v.exposure) * (world.exposure ?? 1);       // (a map can set its own)
    renderer.toneMappingExposure = 0.95 * Math.pow(2, v.exposure) * (world.exposure ?? 1);
    gtao.enabled = v.ao;
    canyonAO.value = v.canyonAO ? 1 : 0;
    smaa.enabled = v.aa !== 'msaa';
    const samples = v.aa === 'high' ? 8 : v.aa === 'fast' ? 2 : v.aa === 'smaa1' ? 0 : 4;   // the scene's MSAA (a new target when it changes)
    if (scenePass.msaa.samples !== samples) { scenePass.msaa.samples = samples; scenePass.msaa.dispose(); }
    ssr.enabled = !!track && v.ao && v.reflections;
    streaks.enabled = v.streaks;
    shafts.enabled = !!world.lightShafts && v.shafts !== false;
    lens.allowed = v.lensWater !== false;
    world.setOptions?.(v);                           // (a world's own effects: the ice planet's weather, its aurora)
    world.wreck?.setEffects(v.wreckFx !== false);       // the derelict's sparks, flickering lamps, drifting debris, arcs
    world.wreck?.setMist(v.wreckMist !== false);        // the coolant mist in its reactor and machinery halls
    TrackRacer.drifting = v.drift !== false;
    TrackRacer.airPitch = v.airPitch !== false;
    bloom.enabled = v.bloom;
    heat.enabled = v.engineHeat !== false;
    Ship.trailStyle = v.engineTrails || 'puffs';
    Ship.nozzleMotion = v.nozzleMotion !== false;
    blurOn = v.blur;
    Ship.brakeLights = v.brakeLights;
    deck.k = v.deckLight !== false ? 1 : 0;           // the deck's light on the ships
    Ship.microShadow = v.hullShadows !== false ? 1 : 0;   // their seams and recesses shaded from the sun
    Ship.engineFace = v.engineFaces === 'glow' ? 0 : 1;   // dark engine faces, the ring alone glowing
    Ship.paintFinish = v.shipPaint === 'classic' ? 0 : 1;  // the deep gloss paint with its metal flake
    Ship.trimFinish = v.shipTrim === 'classic' ? 0 : 1;    // the dark satin metal
    Ship.accentLights = v.shipAccents !== false ? 1 : 0;   // the accent light strips
    const size = { high: 4096, medium: 2048 }[v.shadows];
    if (world.shadowMode) world.shadowMode(size, renderer, scene);
    else if (renderer.shadowMap.enabled !== !!size) {
      renderer.shadowMap.enabled = !!size;
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    for (const l of sunLights) {
      if (size && l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
    pixelRatio = Math.min(devicePixelRatio, 2);
    renderScale = v.scale;
    resample.enabled = v.scale !== 1;
    resample.down = v.scale > 1;
    resample.sharpen = v.scale < 0.7 ? 0.5 : v.scale < 1 ? 0.35 : 0;
    // Laptop mode: the lite shaders (quality.js) and fewer lights - the rivals' lights in the cave, the exhaust's
    // glow on the road and two of the three gantry lamps (each light costs every lit pixel)
    setLite(!!v.laptop, [scene, world.sky]);
    liteFiltering(renderer, [scene, world.sky]);
    document.body.classList.toggle('lite', !!v.laptop);    // (ui.css: no backdrop blur behind the HUD's panels)
    for (const l of [...rivalLights, ...ship.exhaustLights, ...(world.lamps || []).slice(1)]) l.visible = !v.laptop;
    aoRes = v.aoRes || 'auto';
    resize();
    fpsEl.style.display = v.fps ? '' : 'none';
    race?.setDifficulty(v.ai);                       // the rivals' AI difficulty (race.js AI_LEVELS)
    if (racer) racer.perks = PERKS[v.ai] || PERKS.brutal;  // and the player's help by it
    touch.setPref(v.touch);                           // the on-screen sticks: Auto (a phone or tablet) / On / Off
    audio.lite = !!v.laptop;                          // (fewer rival voices; its buffer is set when the sound starts)
    audio.setLevels(v.music, v.sfx);                 // music and effects volume
    redraw = 2;                                      // (a paused picture shows the change behind the settings)
    // what the programs are built for: the lite shaders, the lights on, the shadows, the passes in use - a change
    // (a graphics preset, shadows on / off) builds them all again now, in the menu (rewarm below)
    const sig = [Q.lite, renderer.shadowMap.enabled, world.worldOnly, ...rivalLights.map((l) => l.visible),
      ...composer.passes.map((p) => p.enabled)].join();
    if (warmed && sig !== programSig) rewarm();
    programSig = sig;
  }, integratedGPU(gpuName) || isTouch());             // (a phone or tablet: Laptop mode on a first visit too)

  const lap = { started: false, time: 0, last: Infinity, best: Infinity, lap: 1, idx: START, progress: 0, s: 0 };
  let autoChase = false, wasCrashed = false, t = 0;
  // Warm-up behind the loading screen: everything drawn once - hidden things too, every ship at both detail levels,
  // the trails - so every shader is compiled and every buffer and texture is on the GPU before the race. The first lap
  // stuttered: ~20 shaders compiled and the ships' far detail levels uploaded the first time each came into view.
  status('Warming up the shaders');
  await nextFrame();
  {
    const keep = [];
    for (const e of race ? race.entries : [{ ship }]) e.ship.ensureTrails(scene);
    // Keep shadow program state separate on maps with consistent measured gains.
    const instanceDepth = [];
    if (['forest', 'ice', 'desert'].includes(MAP)) scene.traverse((o) => {
      if (!o.isInstancedMesh || o.customDepthMaterial || Array.isArray(o.material)
        || o.material.alphaTest > 0 || o.material.displacementMap || o.material.clipShadows) return;
      const key = o.instanceColor ? 1 : 0;
      o.customDepthMaterial = instanceDepth[key] ||= new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    });
    // (the sky's backdrop too: its hidden pieces - the sun's eruption and the like - compiled when they first showed)
    // (lights left as they are: a hidden one - Laptop mode's - would compile every lit program for a light count the
    // race never has)
    for (const root of [scene, world.sky].filter(Boolean)) root.traverse((o) => { if (o.isLight) return; keep.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    const ships = race ? race.entries.map((e) => e.ship) : [ship];
    const lods = ships.flatMap((s) => (s.lodMeshes || []).map((l) => [l.mesh, l.mesh.geometry, l.levels]));
    const t0 = performance.now();
    // every material's program first, all at once (scene and sky, bound to the scene's own target: a render target
    // drops the tone mapping from the program) - compiled in parallel, the page alive meanwhile
    renderer.setRenderTarget(scenePass.msaa);
    const jobs = [[scene, camera]];
    if (world.sky) jobs.push([world.sky, world.skyCam]);
    // Submit post shaders with the scene shaders instead of blocking on each warm-up draw.
    // OutputPass uses these defines for the renderer's ACES/sRGB output on its first draw.
    if (output.enabled) output.material.defines = { SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' };
    const post = postJobs(composer.passes.filter((p) => p.enabled || p === lens));
    await compileAll(renderer, [...jobs, ...post], (k, n) => { status(`Compiling shaders  ${k} / ${n}`); progress('compile', k / n); });
    renderer.setRenderTarget(null);
    // the textures onto the GPU one at a time (an 8K map and its mips is one long job on a slow GPU)
    const texs = new Set();
    for (const root of jobs.map((j) => j[0])) root.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture) texs.add(v);
        for (const u of Object.values(m.uniforms || {})) if (u && u.value && u.value.isTexture && !u.value.isRenderTargetTexture) texs.add(u.value);
      }
    });
    let ti = 0;
    for (const tx of texs) {
      renderer.initTexture(tx);
      await gpuIdle(renderer);
      status(`Uploading textures  ${++ti} / ${texs.size}`);
      progress('textures', ti / texs.size);
    }
    // the warm-up draws themselves at an eighth of the size: what they are for (programs, buffers) does not depend on
    // it, and a slow GPU drew three full frames of everything at once
    status('Warming up the shaders');
    progress('warm');
    composer.setPixelRatio(pixelRatio * renderScale / 8);
    composer.setSize(innerWidth, innerHeight);
    await nextFrame();
    lens.enabled = true;                               // (its shader too: else compiled at the first splash)
    for (const level of [0, 1]) {
      for (const [m, , levels] of lods) if (levels[level]) m.geometry = levels[level];
      scene.updateMatrixWorld(); shipLook(); composer.render();
    }
    lens.enabled = false;
    for (const [m, g] of lods) m.geometry = g;
    for (const [o, v, f] of keep) { o.visible = v; o.frustumCulled = f; }
    resize();
    scene.updateMatrixWorld(); composer.render();
    await gpuIdle(renderer);
    liteFiltering(renderer, [scene, world.sky]);           // (the shaders' own maps, now compiled and uploaded)
    console.info(`warm-up: ${renderer.info.programs.length} programs, ${Math.round(performance.now() - t0)} ms`);
  }
  progress('warm', 1);
  warmed = true;
  document.getElementById('loading').classList.add('done');
  audio.prepareMusic();                              // (the songs load once the game has: not over the ship's download)

  const FIXED = 1 / 120;
  const _sprayV = new THREE.Vector3();
  const _sunP = new THREE.Vector3(), _camF = new THREE.Vector3();
  let acc = 0, last = performance.now();
  // the Ship screen's showroom (showroom.js): its studio through the same picture - the scene pass pointed at it, the
  // passes that only belong on a circuit off - and everything put back after
  const circuitOnly = () => [ssr, shafts, heat, streaks, blur, world.heat, grade, lens].filter(Boolean);
  const drawShowroom = () => {
    showroom.update();
    const keepPass = { sky: scenePass.sky, skyCam: scenePass.skyCam, scene: scenePass.scene, camera: scenePass.camera };
    const off = circuitOnly(), was = off.map((p) => p.enabled);
    Object.assign(scenePass, { sky: null, skyCam: null, scene: showroom.scene, camera: showroom.camera });
    gtao.scene = showroom.scene; gtao.camera = showroom.camera;
    off.forEach((p) => (p.enabled = false));
    renderer.shadowMap.needsUpdate = true;
    try { composer.render(); } finally {
      Object.assign(scenePass, keepPass);
      gtao.scene = scene; gtao.camera = camera;
      off.forEach((p, i) => (p.enabled = was[i]));
      renderer.shadowMap.needsUpdate = true;
    }
  };
  const makeShowroom = () => (showroom ||= new Showroom(renderer, { player: ship, playerId: SHIP,
    others: rivalShip !== ship ? { feather: rivalShip } : {}, tier: RIVAL_TIER[Q.tier], layers: camera.layers.mask }));
  const showcase = (on, id) => {
    if (!on || settings.v.showroom === false) { if (showroom) showroom.active = false; return; }
    makeShowroom().active = true;
    if (id) showroom.show(id);
  };
  // made ready in the background a few seconds into the title: the first open no longer stalls on it all at once
  setTimeout(() => {
    if (settings.v.showroom === false || showroom) return;
    const go = () => makeShowroom().prepare();
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else go();
  }, 3500);
  const render = () => {
    if (showroom && showroom.active) { drawShowroom(); return; }
    scene.updateMatrixWorld(); shipLook(); composer.render();
  };
  // drawn between the last two physics steps: at 144 Hz a frame got 0, 1 or 2 steps of 8.3 ms, and everything that
  // moves juddered against the camera
  const keep = (m) => {
    (m.pPos ||= new THREE.Vector3()).copy(m.pos);
    (m.pQ ||= new THREE.Quaternion()).copy(m.q);
    (m.pCamQ ||= new THREE.Quaternion()).copy(m.camQ || m.q);
  };
  const between = (m, a) => {
    if (!m.pPos || m.pPos.distanceToSquared(m.pos) > 400) keep(m);     // a reset or a respawn: nothing in between
    (m.rPos ||= new THREE.Vector3()).lerpVectors(m.pPos, m.pos, a);
    (m.rQ ||= new THREE.Quaternion()).slerpQuaternions(m.pQ, m.q, a);
    (m.rCamQ ||= new THREE.Quaternion()).slerpQuaternions(m.pCamQ, m.camQ || m.q, a);
  };
  // test hooks: __feather.state(), __feather.advance(seconds) (ticks without frames), __feather.shot(name)
  window.__feather = { ship, flight, racer, race, rig, world, track, input, lap, THREE, scene, renderer, composer, bloom, gtao, ssr, streaks, heat, RIVAL_LIGHT, deck,
    agx, camera, fx, settings, render, audio,
    get ctl() { return ctl; }, get mode() { return mode; }, setMode, get rewarming() { return warming; },
    state: () => ({ mode, x: ctl.pos.x, y: ctl.pos.y, z: ctl.pos.z, s: racer ? racer.s : 0, lat: racer ? racer.x : 0,
      speed: ctl.speed, agl: ctl.agl, power: ship.power, spin: ship.spin, canopy: ship.canopyT, throttle: ctl.throttle,
      cam: rig.mode, crashed: ctl.crashed, lap: lap.lap, lapTime: lap.time }) };

  let fpsN = 0, fpsT = 0;
  // A paused game is a still picture: drawn twice after anything changes (pausing, a setting, the window), then left
  // on the screen - the menus over it no longer cost a whole frame of the world at every refresh. (Drawing only every
  // other frame behind the title's darker screens made the browser throttle the page to ~1 frame a second: every frame
  // is drawn while the world moves.)
  let wasPaused = false;
  function frame(now) {
    // (a frame's time held to 0.1 s at most: with 0.05 a slow GPU's long frames each lost time - a hitch in the motion)
    const raw = (now - last) / 1000, dt = Math.min(0.1, raw);
    last = now;
    if (menu.paused !== wasPaused) { wasPaused = menu.paused; redraw = 2; }
    tick(menu.paused ? 0 : dt);                          // paused: a frame with no time in it (no physics, nothing moves)
    // (while the programs are rebuilt the picture holds still: a draw would wait for each one still compiling)
    if (warming) redraw = 0;
    else if (!menu.paused) render();
    else if (redraw > 0) { redraw--; render(); }
    fpsN++; fpsT += raw;
    if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsT)} fps  ${(1000 * fpsT / fpsN).toFixed(1)} ms`; fpsN = fpsT = 0; }
    requestAnimationFrame(frame);
  }
  window.__feather.shot = async (name, w = 1920, h = 1080) => {
    const ow = innerWidth, oh = innerHeight, pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false); composer.setPixelRatio(1); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    world.update?.(t, camera, ship.root.position, racer ? racer.s : 0, renderer);
    render();
    const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/png'));
    renderer.setPixelRatio(pr);
    renderer.setSize(ow, oh, false); composer.setPixelRatio(pr * renderScale); composer.setSize(ow, oh); camera.aspect = ow / oh; camera.updateProjectionMatrix();
    await fetch('/shot/' + name, { method: 'POST', body: blob });
    return name;
  };
  window.__feather.advance = (sec, step = 1 / 60) => {
    for (let k = 0; k < sec; k += step) tick(step);
    render();
    return window.__feather.state();
  };

  // the menus (menu.js): the title over the grid, difficulty, pause (Esc), settings (O), controls, the results' actions
  const resetLap = () => Object.assign(lap, { started: false, time: 0, idx: START, progress: 0 });
  const engines = () => {                                // the engines on, as E does; the chase camera takes over once ready
    if (ship.engineOn) return;
    ship.setEngine(true);
    hud.hideHelp();
    autoChase = true;
    hud.message(ship.canopyT > 0.05 ? 'Canopy closing  -  engines starting' : 'Engines starting');
  };
  const heroOrbit = () => { rig.mode = 'orbit'; Object.assign(rig.orbit, { yaw: 2.35, pitch: 0.16, dist: 22 }); rig.anchor = null; rig.idle = 0; };
  let pilot = null;                                      // past the flag the rivals' AI flies the player's cool-down lap
  const menu = new Menu({ settings, hud, input, rig, camera, race, track, ship, world, map: MAP, shipId: SHIP, showroom: showcase,
    mode: () => mode, engineOn: () => ship.engineOn, focus: () => ship.root.position,
    status: () => ({ race: race && mode === 'race' ? race.hud() : null }),
    startRace: () => { hud.hideResults(); setMode('race'); placeStart(false); resetLap(); heroOrbit(); engines(); },
    restart: () => {
      if (race && mode === 'race') hud.hideResults();
      placeStart(ship.engineOn);
      resetLap();
      hud.message(race && mode === 'race' ? 'Back on the grid' : 'Back at the start', 1.5);
    },
    quit: () => {                                        // back to the title: the grid, engines winding down, canopies open
      hud.hideResults();
      hud.hideHelp();
      setMode('race');
      for (const e of race ? race.entries : [{ ship }]) { e.ship.setEngine(false); e.ship.canopyOpen = true; }
      wasCrashed = autoChase = false;
      placeStart(false);
      resetLap();
      rig.mode = 'orbit';
    } });
  window.__feather.menu = menu;
  window.__feather.showroom = () => showroom;
  Object.defineProperty(window.__feather, 'paused', { get: () => menu.paused, enumerable: true });
  menu.showTitle();

  function tick(dt) {
    t += dt;
    const inp = input.read(dt);
    menu.filter(inp);                                    // a menu up: the keys and buttons are its, not the game's
    if (race && mode === 'race' && race.player.finished) {
      if (!pilot) { pilot = new Driver(race.player, race, () => 0.5, race.player.slot); pilot.odo = 1e4; }
      Object.assign(inp, pilot.coast(dt));               // past the flag: the AI flies the cool-down lap
    } else pilot = null;
    if (inp.engine || inp.click || inp.canopy) audio.start();

    if (inp.engine && ctl.crashed <= 0) {
      if (!ship.engineOn) {
        ship.setEngine(true);
        hud.hideHelp();                          // H brings it back
        autoChase = rig.mode === 'orbit';
        hud.message(ship.canopyT > 0.05 ? 'Canopy closing  -  engines starting' : 'Engines starting');
      } else if (ctl.speed < 15 && (mode === 'race' || ctl.agl < 4)) {
        ship.setEngine(false);
        hud.message('Engines shutting down');
      } else hud.message(mode === 'race' ? 'Slow down to shut the engines down' : 'Slow down and descend to shut the engines down');
    }
    if (inp.canopy && !ship.toggleCanopy()) hud.message('The canopy is locked while the engines run');
    if (inp.camera) {
      rig.next();
      autoChase = false;
      if (rig.mode === 'orbit') input.unlock();
      hud.message(rig.name, 1.2);
    }
    if (inp.click && rig.mode !== 'orbit' && !settings.open) input.lock();
    if (inp.help) hud.toggleHelp();
    if (inp.settings) menu.openSettings();             // O: the settings over the paused game
    if (inp.mute) hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.2);
    if (inp.assist) { ctl.assist = !ctl.assist; hud.message(`Assist ${ctl.assist ? 'on' : 'off'}`, 1.5); }
    if (inp.invert) { input.invert = !input.invert; hud.message(`Pitch ${input.invert ? 'flight-sim (inverted)' : 'arcade'}`, 1.5); }
    if (inp.reset) {
      if (race) { setMode('race'); hud.hideResults(); }
      placeStart(ship.engineOn);
      Object.assign(lap, { started: false, time: 0, idx: START, progress: 0 });
      hud.message('Back at the start', 1.5);
    }
    if (inp.respawn) {
      if (mode === 'race') { racer.place(racer.s, ship.engineOn); }
      else if (MAP === 'meadow') { const n = world.road.nearest(flight.pos.x, flight.pos.z); flight.place(mm.px[n.i], mm.pz[n.i], heading(n.i), ship.engineOn); }
      else setMode('race');
      ship.clearTrails();
      rig.snap(ctl);
      hud.message(MAP === 'meadow' ? 'Back on the road' : 'Back on the track', 1.5);
    }
    if (autoChase && ship.ready) {
      autoChase = false;
      if (rig.mode === 'orbit') { menu.blend(1.3); rig.mode = 'chase'; rig.snap(ctl); hud.message('Ready  -  W throttle, A / D steer, Shift boost', 3); }
    }

    // physics at a fixed 120 Hz
    const movers = race ? race.entries.map((e) => e.racer) : [];
    if (!movers.includes(ctl)) movers.push(ctl);
    acc += dt;
    while (acc >= FIXED) {
      for (const m of movers) keep(m);
      if (race && mode === 'race') race.step(FIXED, inp, true);
      else { ctl.step(FIXED, inp); race?.step(FIXED, null, false); }
      acc -= FIXED;
    }
    if (race) {
      for (const e of race.events) {
        if (e.type === 'padfx') {
          const pad = track.pads[e.i];
          track.padFlash(e.i);
          if (camera.position.distanceTo(e.at) < 400) fx.padBurst(pad.at, pad.basis, e.player && mode === 'race');
          if (!(e.player && mode === 'race')) audio.pad(pad.at);
          if (e.player && mode === 'race') {
            ship.boostKick = 1;
            rig.shake = Math.max(rig.shake, 0.4);
            audio.whoosh();
            hud.flash('rgba(255,140,30,0.55)');
          }
        } else if (e.type === 'wallfx') {
          track.fieldHit(e.at, e.v / 14);
          audio.wall(e.at, e.v, e.player && mode === 'race');
          if (e.player && mode === 'race') hud.flash('rgba(90,170,255,0.35)', 0.35);
        } else if (e.type === 'fall') {
          audio.fall(e.player && mode === 'race');
          if (e.player && mode === 'race') {
            hud.message('Fell into the gap!', 2);
            hud.flash('rgba(255,60,40,0.4)', 0.5);
            ship.clearTrails();
            rig.snap(ctl);
          }
        } else if (e.type === 'drift') {
          const mine = e.player && mode === 'race';
          if (camera.position.distanceTo(e.at) < 300) { const f = track.frame(e.s); fx.driftKick(e.at, new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()), e.tier, mine); }
          if (mine) {
            audio.driftKick(e.tier);
            hud.pulse('bst');
            ship.boostKick = Math.max(ship.boostKick, 0.4 + 0.2 * e.tier);
            rig.shake = Math.max(rig.shake, 0.15 + 0.08 * e.tier);
            hud.flash(['', 'rgba(60,140,255,0.3)', 'rgba(255,140,40,0.32)', 'rgba(210,90,255,0.36)'][e.tier], 0.35);
          }
        } else if (e.type === 'driftTier') {
          if (camera.position.distanceTo(e.at) < 220) fx.driftTier(e.entry.ship, e.entry.racer, track.frame(e.s), e.tier);
          if (e.player && mode === 'race') { audio.driftTier(e.tier); hud.pulse('dft'); }
        } else if (e.type === 'driftChain') {
          if (camera.position.distanceTo(e.at) < 220) fx.driftChain(e.entry.ship, e.entry.racer, track.frame(e.s), e.tier);
          if (e.player && mode === 'race') { audio.driftChain(e.tier); hud.pulse('dft'); rig.shake = Math.max(rig.shake, 0.12); }
        } else if (e.type === 'flip') {
          if (e.player && mode === 'race') { audio.flip(); hud.flash('rgba(150,70,255,0.22)', 0.6); }
        } else if (e.type === 'go') { hud.message('GO!', 1.2); audio.go(); }
        else if (e.type === 'lap') { audio.lap(); hud.message(`Lap ${e.lap}: ${e.time.toFixed(2)} s${e.clean ? '  -  clean lap +5' : ''}`, 3); }
        else if (e.type === 'finish') { audio.finish(); hud.message(`Finished P${e.pos}!`, 3); }
        else if (e.type === 'bump') { fx.scrape(e.at, ctl.vel, e.v / 15); rig.shake = Math.max(rig.shake, Math.min(0.7, e.v / 15)); audio.bump(e.at, e.v); }
        else if (e.type === 'scrape') {
          if (camera.position.distanceTo(e.at) < 200) fx.scrape(e.at, new THREE.Vector3(), e.v / 20);
          audio.scrape(e.at, e.v);
        }
      }
      race.events.length = 0;
      if (race.state === 'finished' && !race.shown && race.time - race.finishedAt > 2) {
        race.shown = true;
        hud.showResults(race.results(), race.score, race.total);
      }
    }
    for (const e of ctl.events) {
      if (e.type === 'crash') {
        fx.explode(e.at, ctl.vel);
        rig.shake = 1.4;
        audio.crash(e.at);
        ship.engineOn = false;
        wasCrashed = true;
        hud.message(e.kind === 'tree' ? 'Hit a tree!' : 'Crashed!', 2.5);
      } else if (e.type === 'scrape') {
        fx.scrape(e.at, ctl.vel, e.v / 20);
        rig.shake = Math.max(rig.shake, Math.min(0.6, e.v / 20));
        audio.thud(Math.min(0.6, e.v / 20));
      }
    }
    ctl.events.length = 0;
    if (wasCrashed && ctl.crashed <= 0) {
      wasCrashed = false;
      if (MAP === 'meadow') { const n = world.road.nearest(flight.pos.x, flight.pos.z); flight.place(mm.px[n.i], mm.pz[n.i], heading(n.i), true); }
      else setMode('race');
      ship.engineOn = true;
      ship.power = ship.spin = ship.avionics = 1;
      ship.canopyOpen = false;
      ship.canopyT = 0;
      rig.snap(ctl);
      hud.message('Respawned', 2);
    }

    for (const m of movers.includes(ctl) ? movers : [...movers, ctl]) between(m, acc / FIXED);
    const view = Object.create(ctl);                     // the controller as drawn: its in-between pose
    view.pos = ctl.rPos; view.q = ctl.rQ; view.camQ = ctl.rCamQ;
    ship.root.position.copy(ctl.rPos);
    ship.root.quaternion.copy(ctl.rQ);
    ship.root.updateMatrixWorld(true);
    ship.update(dt, { throttle: ctl.throttle, boost: ctl.boosting, speed: ctl.speed, turn: ctl.turn,
      ...(mode === 'race' ? racer.animState() : { brakeLight: flight.brakeS || 0 }) }, scene, camera);
    if (MAP === 'meadow') fx.hover(flight, world, world.road.distance(flight.pos.x, flight.pos.z) < 12, dt);
    const focalPx = renderer.domElement.height * renderScale * (Q.lite ? 0.7 : 1) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    race?.visuals(dt, camera, fx, scene, focalPx);
    fx.exhaust(ship, ctl, dt);
    fx.update(dt, camera, ctl);
    const sb = blurOn ? 0.035 * smoothstep(160, 330, ctl.speed) + 0.03 * ctl.boosting + 0.04 * fx.kick : 0;
    blur.uniforms.strength.value = sb;
    blur.enabled = sb > 0.001;
    rig.kick = fx.kick;
    if (track) {
      const dark = 1 - track.caveLight(ship.root.position);
      headlight.intensity = ship.power * 16000 * dark;          // only in the meteorite ("start flashlights only in the meteorite")
      for (const l of ship.exhaustLights) l.intensity *= 1 + 4 * dark;
      const inCave = race ? race.entries.filter((e) => !e.player && track.caveLight(e.ship.root.position) < 0.7)
        .sort((a, b) => a.ship.root.position.distanceToSquared(camera.position) - b.ship.root.position.distanceToSquared(camera.position)) : [];
      rivalLights.forEach((l, k) => {
        const e = inCave[k];
        if (!e) { l.intensity = 0; return; }
        // (behind the nozzles, the engines' light on the road and the ship's tail: at 0.8 m over the ship's middle and
        // 900 cd it lit its own hull white, "a very bright colour ... coming from the top of the ship")
        l.position.set(0, RIVAL_LIGHT.y, RIVAL_LIGHT.z).applyMatrix4(e.ship.root.matrixWorld);
        l.color.copy(e.ship.engineColor).lerp(new THREE.Color(1, 1, 1), 0.35);
        l.intensity = RIVAL_LIGHT.cd * e.ship.power * (1 - track.caveLight(e.ship.root.position));
      });
    }
    rig.update(dt, view, inp, ctl.boosting);
    menu.camera(dt);                                     // the title's shots, or a blend between two camera views
    world.follow(ctl.rPos, camera);
    world.update?.(t, camera, ship.root.position, racer ? racer.s : 0, renderer);
    // the sun's place on screen for the shafts (fading out as it goes behind the camera)
    if (shafts.enabled) {
      const sp = _sunP.copy(camera.position).addScaledVector(world.sunDir, 5000).project(camera);
      shafts.sunUV.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      shafts.facing = smoothstep(0.05, 0.45, _camF.set(0, 0, -1).applyQuaternion(camera.quaternion).dot(world.sunDir));
    }
    // through a waterfall: water on the lens, and the splash
    if (world.wetCheck?.(camera.position)) { lens.hit(); audio.splash?.(); }
    // and every ship through one: spray off it (once a pass)
    if (world.inFall && dt > 0) for (const s of race ? race.entries.map((e) => e.ship) : [ship]) {
      const p = s.root.position, f = world.inFall(p, 6), was = s.inFall;
      s.inFall = !!f;
      if (f && !was && s.lastP) fx.splash(p, _sprayV.subVectors(p, s.lastP).divideScalar(dt));
      (s.lastP ||= new THREE.Vector3()).copy(p);
    }
    lens.update(dt, ctl.speed);

    // lap timing: progress along the circuit (the track's arc length, or the road's samples near the road)
    if (!race && !lap.started && ship.ready && ctl.speed > 3) { lap.started = true; lap.time = 0; }
    if (!race && lap.started && ctl.crashed <= 0) {
      lap.time += dt;
      let d = 0, total = 1;
      if (MAP === 'meadow') {
        const n = world.road.nearest(flight.pos.x, flight.pos.z);
        if (n.d < 160) {
          d = n.i - lap.idx;
          if (d > mm.n / 2) d -= mm.n;
          if (d < -mm.n / 2) d += mm.n;
          if (Math.abs(d) > 250) d = 0;
          lap.idx = n.i;
        }
        total = mm.n;
      }
      lap.progress += d;
      if (lap.progress >= total) {
        lap.progress -= total;
        lap.last = lap.time;
        const best = lap.time < lap.best;
        lap.best = Math.min(lap.best, lap.time);
        hud.message(`Lap ${lap.lap}: ${lap.time.toFixed(2)} s${best ? '  -  best!' : ''}`, 4);
        lap.lap++;
        lap.time = 0;
      }
    }

    let state = touch.on ? 'ENGINES OFF  -  tap Engines' : 'ENGINES OFF  -  press E', cls = 'off';
    if (ctl.crashed > 0) { state = 'CRASHED'; cls = 'bad'; }
    else if (ship.engineOn && !ship.ready) { state = ship.canopyT > 0.02 ? 'CANOPY CLOSING' : 'ENGINES STARTING'; cls = 'warn'; }
    else if (race && mode === 'race' && race.state === 'grid' && ship.engineOn) { state = 'ON THE GRID'; cls = 'warn'; }
    else if (race && mode === 'race' && race.state === 'countdown') { state = 'GET READY'; cls = 'warn'; }
    else if (ship.engineOn) { state = ctl.boosting > 0.5 ? 'BOOST' : (mode === 'race' ? 'RACE' : 'FREE FLIGHT'); cls = 'ok'; }
    else if (ship.power > 0.01) { state = 'SHUTTING DOWN'; cls = 'warn'; }
    const f = ctl.forward;
    hud.update(dt, { speed: ctl.speed, agl: MAP !== 'meadow' && mode === 'free' ? NaN : ctl.agl, throttle: ctl.throttle,
      boostEnergy: ctl.boostEnergy, boosting: ctl.boosting, state, stateClass: cls, camera: rig.name, assist: ctl.assist,
      drifting: mode === 'race' && !!ctl.drift, driftCharge: ctl.driftCharge, driftTier: ctl.driftTier || 0, driftChain: ctl.chain || 0,
      invert: input.invert, lapTime: lap.started ? lap.time : NaN, lastLap: lap.last, bestLap: lap.best, lap: lap.lap,
      x: ctl.pos.x, z: ctl.pos.z, fx: f.x, fz: f.z, race: race ? race.hud() : null, mode });
    audio.update(dt, { camera, ship, ctl, race, track, mode, inp, world });
    touch.setMode(mode);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  stopLoadJobs();
  console.error(e);
  const gl = document.getElementById('view').getContext('webgl2');
  if (gl?.isContextLost?.() || /WebGLShader|WebGLProgram|context/i.test(String(e.message)))
    status('The graphics ran out of memory loading the game - close other tabs and reload (Settings > Graphics quality > Low helps)');
  else status(`Failed to start: ${e.message || e}`);
  document.getElementById('loading').classList.add('error');
});
