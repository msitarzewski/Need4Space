// The ship showroom (the menu's Ship screen): the ships alone in a dark studio instead of the circuit behind the menu,
// so a player can look at them - each on a slowly turning stand of polished black glass, under studio softboxes that
// lay long highlights along the paint, the camera turned round it by dragging and drawn in or out by the wheel. Drawn
// through the game's own picture (main.js points the scene pass and the AO at it and turns off what only belongs on a
// circuit). The ship on show starts up as it does on the grid: the canopy closing, the engines spooling up (the
// Comet's nozzle teeth closing in round it, its rotor turning).
// Everything it needs is made ready in the background while the title shows (prepare): the studio's reflections, the
// ships' shaders compiled in parallel, the other ship's maps uploaded before it appears - the first open stalled on all
// of it at once.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Ship, loadShip } from './ship.js';
import { SHIP_URLS } from './ships.js';

const HOVER = 0.75;                       // the hull's lowest point over the stand (m)
const LOWEST = 1.63949;                   // every ship's lowest point under its origin (the exports share it)
const STAND = { r: 8.6, h: 0.16 };
// an idling engine on the stand: a breath of throttle, standing still
const IDLE = { throttle: 0.2, boost: 0, speed: 0, turn: 0, brake: 0, steer: 0, lat: 0, accel: 0, vy: 0, airbrake: 0,
  land: 0, air: 0, yawKick: 0, height: 1, drift: 0, slip: 0 };
const DOME = 'vec3(0.004, 0.005, 0.007)';

// the stand's top: black glass - a dim reflection of the ship, a lighter pool under it, darker to its rim
const GLASS = {
  name: 'ShowroomGlass',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vL;
    void main() { vUv = textureMatrix * vec4(position, 1.0); vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv; varying vec3 vL;
    void main() {
      float r = length(vL.xy) / ${STAND.r.toFixed(2)};
      vec3 refl = texture2DProj(tDiffuse, vUv).rgb;
      vec3 base = vec3(0.010, 0.012, 0.015) * (1.0 + 1.6 * (1.0 - smoothstep(0.0, 0.8, r)));
      gl_FragColor = vec4(base + refl * color * (1.0 - 0.45 * smoothstep(0.5, 1.0, r)), 1.0);
    }`,
};

export class Showroom {
  // player: the loaded Ship (cloned - geometry and maps shared); playerId; others: { id: a loaded Ship } (the rivals'
  // Feather when the player flies another ship); tier: the model size to load a ship not yet in memory
  constructor(renderer, { player, playerId, others = {}, tier = 'mid', layers = null }) {
    this.renderer = renderer;
    this.active = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 600);
    if (layers != null) this.camera.layers.mask = layers;
    this.sources = { [playerId]: player, ...others };
    this.playerId = playerId;
    this.tier = tier;
    this.ships = {};
    this.loading = {};
    this.id = null;
    this.yaw = 2.5; this.pitch = 0.17; this.dist = 20;          // a rear three-quarter view: the engines first
    this.held = 0; this.t = 0; this.last = 0;
    // (shaders compiled for an offscreen target, as the game draws the picture: compiled with none bound, the screen's
    // variants were made and the real ones still stalled the first open)
    this.warmRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.build();
    this.bindInput();
  }

  build() {
    const S = this.scene, R = this.renderer;
    // reflections: a dark studio with softboxes - a long panel overhead, tall strips behind each side (cool, warm), a
    // low one in front - the highlights that run along a showroom car's paint
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.010, 0.012, 0.016), side: THREE.BackSide })));
    const box = (w, h, pos, k, c = [1, 1, 1]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(0, 1.5, 0);
      env.add(m);
    };
    box(16, 5, [0, 15, 0], 7);
    box(2.4, 13, [-15, 6, -11], 6, [0.78, 0.88, 1.0]);
    box(2.4, 13, [15, 6, -10], 5, [1.0, 0.9, 0.78]);
    box(12, 2.2, [0, 2.5, 17], 2.2);
    box(2.0, 9, [-17, 4, 9], 1.4);
    const pm = new THREE.PMREMGenerator(R);
    this.envTex = pm.fromScene(env, 0.0).texture;
    pm.dispose();
    S.environment = this.envTex;
    S.environmentIntensity = 0.9;
    // the room: a dark dome, a faint glow low behind the stand
    S.add(new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD;
        void main() {
          vec3 c = mix(${DOME}, vec3(0.016, 0.021, 0.030), smoothstep(-0.05, 0.7, vD.y));
          c += vec3(0.016, 0.026, 0.042) * pow(max(0.0, 1.0 - abs(vD.y - 0.06) * 3.0), 3.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));
    // the floor: dark, fading into the dome's colour toward the horizon (no edge where it ends); it takes the shadow
    const fm = new THREE.MeshStandardMaterial({ color: 0x060709, roughness: 0.6, metalness: 0.0 });
    fm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectSpecular *= 0.1;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, ${DOME}, smoothstep(20.0, 70.0, length(vFloorW.xz)));`);
    };
    fm.customProgramCacheKey = () => 'showroom-floor';
    const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 96), fm);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    S.add(floor);
    // the turning stand: a brushed-metal drum, its top black glass reflecting the ship, a lit ring round its edge
    this.stand = new THREE.Group();
    S.add(this.stand);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(STAND.r, STAND.r + 0.1, STAND.h, 160, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.28, metalness: 0.9 }));
    drum.position.y = STAND.h / 2;
    this.stand.add(drum);
    const s = Math.min(2, R.getPixelRatio());
    this.glass = new Reflector(new THREE.CircleGeometry(STAND.r, 128), { shader: GLASS, color: new THREE.Color(0.28, 0.30, 0.33),
      textureWidth: Math.round(innerWidth * s * 0.5), textureHeight: Math.round(innerHeight * s * 0.5), clipBias: 0.002, multisample: 4 });
    this.glass.rotation.x = -Math.PI / 2;
    this.glass.position.y = STAND.h;
    this.stand.add(this.glass);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(STAND.r + 0.02, 0.028, 8, 220),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.75, 2.6) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = STAND.h;
    this.stand.add(ring);
    // lights: a warm key over the front quarter (the ship's own shadows), strong cool and warm rims cutting its
    // outline out of the dark, a little light straight down on its back
    const key = new THREE.DirectionalLight(0xfff0e0, 2.0);
    key.position.set(9, 15, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 60 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    const rimC = new THREE.DirectionalLight(0x9fc4ff, 3.4);
    rimC.position.set(-12, 7, -12);
    const rimW = new THREE.DirectionalLight(0xffc896, 2.4);
    rimW.position.set(13, 5, -10);
    const top = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    top.position.set(0, 20, 0);
    S.add(key, rimC, rimW, top);
  }

  // dragging turns the camera round the ship (anywhere but the menu's own buttons), the wheel draws it in or out
  bindInput() {
    let drag = null;
    const busy = (e) => !this.active || e.target.closest?.('button, a, input, select, .m-list, .m-hints, #settings, #board');
    addEventListener('pointerdown', (e) => { if (!busy(e)) drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointermove', (e) => {
      if (!drag || !this.active) return;
      this.yaw -= (e.clientX - drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - drag.y) * 0.004, -0.02, 1.2);
      drag = { x: e.clientX, y: e.clientY };
      this.held = 3;
    });
    addEventListener('pointerup', () => { drag = null; });
    addEventListener('wheel', (e) => {
      if (busy(e)) return;
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 11, 34);
    }, { passive: true });
  }

  // a ship for the stand, made once: its copy, its maps on the GPU, its shaders compiled (in parallel, no stall) -
  // all before it is ever drawn
  ensure(id) {
    if (!this.loading[id]) {
      this.loading[id] = (this.sources[id] ? Promise.resolve(this.sources[id]) : loadShip(SHIP_URLS[id][this.tier]))
        .then(async (src) => {
          if (!this.sources[id]) src.upgradeMaterials?.(this.renderer.capabilities.getMaxAnisotropy(), this.renderer);
          const ship = new Ship(null, { cloneOf: src, lights: false });
          ship.root.position.y = STAND.h + HOVER + LOWEST;
          ship.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          this.stand.add(ship.root);
          const maps = new Set();
          ship.root.traverse((o) => {
            for (const m of [].concat(o.material || [])) for (const k in m) if (m[k] && m[k].isTexture) maps.add(m[k]);
          });
          maps.forEach((t) => this.renderer.initTexture(t));
          ship.root.visible = true;
          try { await this.compile(); } catch { /* compiled on first draw instead */ }
          ship.root.visible = id === this.id;
          this.ships[id] = ship;
          return ship;
        });
    }
    return this.loading[id];
  }

  // every shader the studio draws, compiled in parallel (no stall) for an offscreen target
  compile() {
    const R = this.renderer, keep = R.getRenderTarget();
    R.setRenderTarget(this.warmRT);
    try { return R.compileAsync(this.scene, this.camera); } finally { R.setRenderTarget(keep); }
  }

  // in the background while the title shows: the studio and every ship already in memory (the one flown, the rivals'),
  // ready before the Ship screen opens
  async prepare() {
    for (const id of [this.playerId, ...Object.keys(this.sources).filter((k) => k !== this.playerId)]) {
      try { await this.ensure(id); } catch { /* made on first show instead */ }
    }
  }

  // put a ship on the stand, engines off and canopy open, then start it up
  async show(id) {
    if (this.id === id) return;
    this.id = id;
    for (const k in this.ships) this.ships[k].root.visible = k === id;
    const s = await this.ensure(id);
    if (this.id !== id) { s.root.visible = false; return; }
    s.root.visible = true;
    s.setEngine(false);
    Object.assign(s, { canopyOpen: true, canopyT: 1, power: 0, spin: 0, avionics: 0 });
    this.startAt = this.t + 1.2;
  }

  // the glows, plumes and trails of the ship on show: kept out of the AO, as on the circuit
  fxObjects() { const s = this.ships[this.id]; return s ? s.fxObjects() : []; }

  // one frame: the stand turning (held still a moment after a drag), the ship's own motion, the camera
  update() {
    const now = performance.now() / 1000, dt = this.last ? Math.min(0.1, now - this.last) : 0;
    this.last = now;
    this.t += dt;
    this.held = Math.max(0, this.held - dt);
    if (!this.held) this.stand.rotation.y += 0.13 * dt;
    const s = this.ships[this.id];
    if (s && s.root.visible) {
      if (this.startAt && this.t > this.startAt) { s.setEngine(true); this.startAt = 0; }
      s.update(dt, IDLE, this.scene, this.camera);
    }
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    this.camera.aspect = w / Math.max(1, h);
    // the ship right of the middle: the menu stands on the left
    const c = Math.cos(this.pitch), at = new THREE.Vector3(0, STAND.h + HOVER + 1.1, 0);
    this.camera.position.set(Math.sin(this.yaw) * c * this.dist, at.y + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * c * this.dist);
    this.camera.lookAt(at);
    this.camera.setViewOffset(w, h, -w * 0.14, 0, w, h);
    this.camera.updateProjectionMatrix();
    this.scene.updateMatrixWorld();
  }
}
