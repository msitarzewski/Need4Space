// Space: the backdrop (nebula, Milky Way band, stars, a ringed gas giant, the sun) rendered in its own scene and
// camera (huge distances, its own depth range), then the circuit. One hard sun, a faint warm planet-shine, starlight.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { Track, TRACK_W, CAVE_R, CAVE_MOUTH } from './track.js';
import { setCave } from './look.js';
import { rockMaps, bakeRockShadow } from './rock.js';
import { hullMaps } from './hull.js';
import { Scenery } from './scenery.js';
import { giantMaterial, ringMaterial, sunMeshes, RING_IN, RING_OUT } from './celestial.js';
const TRACK_W_HALF = TRACK_W / 2;

export const SUN_DIR = new THREE.Vector3(0.74, 0.55, 0.38).normalize();      // toward the sun (33 deg up)
export const PLANET_DIR = new THREE.Vector3(-0.2, -0.3, -0.93).normalize();   // toward the planet: ahead, below
export const SUN_E = 5.5;                                                      // sun irradiance (three units)
// the sun's shadow in three cascades: a tight box on the player's ship (hull detail: the first single map stair-stepped
// a pipe's shadow on the hull), a box round the pack ahead (the rivals' hulls) and a wide one reaching ~300 m ahead of
// the camera ("shadow distance is also crazy low"; "increase shadow distance ... a bit": it was ~105 m)
export const SHADOW_HALF = 10, SHADOW_NEAR = 300, SHADOW_FAR = 500;    // (the ship fits in 20 m: 4.9 mm texels)
export const MID_HALF = 45, MID_NEAR = 250, MID_FAR = 550;
export const FAR_HALF = 170, FAR_NEAR = 100, FAR_FAR = 900;
const PLANET_D = 32000, PLANET_R = 14000, SUN_D = 60000;

const NOISE3 = /* glsl */`
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n3(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

const BAND_N = new THREE.Vector3(0.3, 0.85, -0.42).normalize();     // the Milky Way's great circle

function nebula() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { bandN: { value: BAND_N } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 bandN; varying vec3 vDir;
      ${NOISE3}
      void main() {
        vec3 d = normalize(vDir);
        float band = exp(-pow(dot(d, bandN) / 0.2, 2.0));
        float n = fbm3(d * 2.6), m = fbm3(d * 6.0 + 5.0), k = fbm3(d * 4.5 + 2.0);
        vec3 col = mix(vec3(0.010, 0.004, 0.022), vec3(0.045, 0.012, 0.035), smoothstep(0.45, 0.8, n)) * smoothstep(0.38, 0.72, n);
        col += vec3(0.006, 0.018, 0.04) * smoothstep(0.52, 0.85, m);
        col += vec3(0.035, 0.026, 0.020) * band * (0.5 + smoothstep(0.4, 0.8, k));       // the band's star glow
        col *= 1.0 - 0.75 * band * smoothstep(0.55, 0.72, fbm3(d * 9.0 - 3.0));           // dark dust lanes
        gl_FragColor = vec4(col * 0.5, 1.0);                                              // "a bit darker"
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(90000, 64, 32), m);
}

function stars() {
  const rnd = mulberry32(77), n = 9000;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    do v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (rnd() < 0.45) {                                    // crowd toward the band
      const off = v.dot(BAND_N);
      v.addScaledVector(BAND_N, -off * (0.75 + rnd() * 0.25)).normalize();
    }
    v.multiplyScalar(85000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = rnd();                                       // temperature: red dwarfs to blue giants
    c.setRGB(...(t < 0.15 ? [1.0, 0.62, 0.42] : t < 0.4 ? [1.0, 0.86, 0.7] : t < 0.85 ? [0.95, 0.96, 1.0] : [0.7, 0.8, 1.0]));
    const b = 0.25 + 3.5 * Math.pow(rnd(), 8);            // most faint, a few bright
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    size[i] = 1.1 + 2.2 * Math.pow(rnd(), 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { pr: { value: 1 } },
    vertexShader: /* glsl */`attribute float size; varying vec3 vC; uniform float pr;
      void main() { vC = color; gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`varying vec3 vC;
      void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * 0.75 * smoothstep(0.5, 0.1, r), 1.0); }`,
  });
  return new THREE.Points(g, m);
}

// the ringed gas giant: clouds and ringlets painted once on the GPU (celestial.js), lit by the sun
function planetGroup(renderer) {
  const C = PLANET_DIR.clone().multiplyScalar(PLANET_D);
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, 0.5, -0.22));
  const ringN = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt);
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(tilt.clone().invert()));
  const shared = { sunDir: { value: SUN_DIR }, center: { value: C }, R: { value: PLANET_R }, ringN: { value: ringN },
    rot: { value: rot }, sunE: { value: SUN_E } };
  const ringMat = ringMaterial(renderer, shared);                  // (first: the clouds read the ringlets for their shadow)
  const planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 192, 96), giantMaterial(renderer, shared));
  planet.position.copy(C);
  const ring = new THREE.Mesh(new THREE.RingGeometry(PLANET_R * RING_IN, PLANET_R * RING_OUT, 512, 1).rotateX(-Math.PI / 2), ringMat);
  ring.position.copy(C);
  ring.quaternion.copy(tilt);
  ring.renderOrder = 2;
  const g = new THREE.Group();
  g.add(planet, ring);
  return g;
}

// the sun: a globe of plasma 4.8 deg across, prominences and eruptions round it (celestial.js)
function sunGroup() {
  const g = new THREE.Group();
  const R = SUN_D * Math.tan(THREE.MathUtils.degToRad(2.4));
  const { surf, corona } = sunMeshes(R);
  surf.position.copy(SUN_DIR).multiplyScalar(SUN_D);
  corona.position.copy(surf.position);
  corona.renderOrder = 1;
  g.add(surf, corona);
  g.userData.surf = surf;
  g.userData.corona = corona;
  return g;
}

// The nebula never changes: its four six-octave noise fields are drawn once into a cube map at load, and the sky
// samples that (the fields cost ~0.4 ms of every 1440p frame). 1024 a face holds its finest dust lanes.
function bakedNebula(renderer, nebula, size = 1024) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const scene = new THREE.Scene(), parent = nebula.parent;
  scene.add(nebula);
  new THREE.CubeCamera(10, 200000, rt).update(renderer, scene);
  parent.add(nebula);
  nebula.material.dispose();
  nebula.material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { cube: { value: rt.texture } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform samplerCube cube; varying vec3 vDir;
      void main() { gl_FragColor = vec4(textureCube(cube, vDir).rgb, 1.0); }`,
  });
  nebula.renderOrder = -1;                                   // the backdrop of the backdrop: first
  return rt;
}

export class SpaceWorld {
  bakeNebula(renderer) {
    if (this.nebulaLive) return;
    this.nebulaLive = this.nebula.material;                   // kept for comparisons (__feather.world.nebulaLive)
    this.nebulaLive = this.nebula.material.clone();
    this.nebulaCube = bakedNebula(renderer, this.nebula);
  }

  constructor(scene, renderer, camera) {
    this.name = 'space';
    this.sky = new THREE.Scene();
    this.skyCam = new THREE.PerspectiveCamera(60, 1, 50, 200000);
    this.nebula = nebula();
    this.stars = stars();
    this.planet = planetGroup(renderer);
    this.sunG = sunGroup();
    this.sky.add(this.nebula, this.stars, this.planet, this.sunG);
    this.bakeNebula(renderer);
    // environment for reflections: the same sky without the sun's disc (the sun light makes its own highlight)
    this.sunG.visible = false;
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromScene(this.sky, 0.015, 50, 200000).texture;
    pm.dispose();
    this.sunG.visible = true;
    scene.environment = this.env;
    scene.environmentIntensity = 0.55;
    scene.fog = null;
    // lights: the sun (PCSS shadows round the ship), planet-shine, starlight
    const sunLight = (intensity, half, near, far, normalBias) => {
      const l = new THREE.DirectionalLight(new THREE.Color(1.0, 0.96, 0.9), intensity);
      l.castShadow = true;
      l.shadow.mapSize.set(4096, 4096);
      const c = l.shadow.camera;
      c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = near; c.far = far;
      l.shadow.bias = -0.0001;
      l.shadow.normalBias = normalBias;
      scene.add(l, l.target);
      return l;
    };
    this.sun = sunLight(SUN_E, SHADOW_HALF, SHADOW_NEAR, SHADOW_FAR, 0.005);   // added first: directional shadow 0
    this.sunMid = sunLight(0, MID_HALF, MID_NEAR, MID_FAR, 0.02);               // no light, only the mid cascade's map
    this.sunFar = sunLight(0, FAR_HALF, FAR_NEAR, FAR_FAR, 0.07);               // no light, only the far cascade's map
    const shine = new THREE.DirectionalLight(new THREE.Color(1.0, 0.7, 0.48), 0.35);
    shine.position.copy(PLANET_DIR).multiplyScalar(100);
    scene.add(shine);
    scene.add(new THREE.HemisphereLight(0x8090b0, 0x302018, 0.03));
    this.lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
    this.ly = new THREE.Vector3().crossVectors(SUN_DIR, this.lx).normalize();
    // the circuit
    this.track = new Track();
    rockMaps(renderer);                                            // every rock's maps, before the first frame
    hullMaps(renderer);                                            // the structure's grime noise
    setCave(this.track.caveLines, CAVE_R, CAVE_MOUTH);              // before any lit material compiles
    this.track.meshes(scene);
    this.scenery = new Scenery(scene, this.sky, SUN_DIR, renderer);
    this.noAO = [this.scenery.gate.userData.fieldMesh];
    this.track.bakeDeck(renderer);
    // the meteorite's own shadow from the sun, once (crater rims, boulders - at any distance)
    if (this.track.meteor) bakeRockShadow(renderer, [this.track.meteor.mesh, ...this.track.meteor.boulders], SUN_DIR);
    this.rocks = this.track.asteroids(scene);
    // gantry lamps: three real lights hop along the gantries ahead, so the ship is lit as it flies under them
    this.lamps = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(new THREE.Color(0.75, 0.88, 1.0), 0, 70, 2);
      scene.add(l);
      return l;
    });
    // dust drifting round the camera: a box of motes that wraps with it, so near space has depth
    const dn = 1400, dpos = new Float32Array(dn * 3), rnd = mulberry32(9);
    for (let i = 0; i < dn * 3; i++) dpos[i] = (rnd() - 0.5) * 240;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { cam: { value: new THREE.Vector3() }, pr: { value: 1 } },
      vertexShader: /* glsl */`uniform vec3 cam; uniform float pr; varying float vA;
        void main() {
          vec3 p = mod(position - cam + 120.0, 240.0) - 120.0 + cam;    // wrap round the camera
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(120.0, 40.0, d) * smoothstep(1.0, 6.0, d);
          gl_PointSize = pr * clamp(60.0 / d, 1.0, 3.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.55, 0.6, 0.7) * vA * smoothstep(0.5, 0.0, r), 1.0); }`,
    }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.minimap = this.track;
    this.startIndex = this.track.start;
  }

  // keep a camera out of the track slab (deck, walls, fields): lift it over the barrier tops if it is inside
  clearance(p) {
    const tr = this.track, i = tr.nearestIndex(p), d = p.clone().sub(tr.P[i]);
    const x = d.dot(tr.R[i]), y = d.dot(tr.U[i]);
    if (Math.abs(x) < TRACK_W_HALF + 4 && y > -6 && y < 6.5) p.addScaledVector(tr.U[i], 6.5 - y);
  }

  surface() { return -1e9; }
  height() { return -1e9; }
  hit() { return null; }

  // the near cascade on the ship, the mid one centred 30 m ahead of the camera (~15 m behind it to ~75 m ahead), the
  // far one 140 m ahead (~30 m behind to ~310 m ahead); each box snapped to its own texels in the light's axes so
  // shadow edges do not crawl
  follow(p, camera) {
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
    this.skyCam.quaternion.copy(camera.quaternion);
    this.skyCam.fov = camera.fov;
    this.skyCam.aspect = camera.aspect;
    this.skyCam.updateProjectionMatrix();
    this.stars.material.uniforms.pr.value = renderer.getPixelRatio() * (this.renderScale || 1);
    this.dust.material.uniforms.pr.value = renderer.getPixelRatio() * (this.renderScale || 1);
    this.dust.material.uniforms.cam.value.copy(camera.position);
    this.track.update(t, shipPos, Math.max(0, t - (this.lastT ?? t)));
    this.scenery.update(t, Math.max(0, t - (this.lastT ?? t)));
    this.sunG.userData.surf.material.uniforms.time.value = t;
    const cu = this.sunG.userData.corona.material.uniforms;
    cu.time.value = t;
    // now and then the sun throws off a plume of matter (every 25-50 s, somewhere round the limb)
    if (t > (this.nextEruption ??= 8)) { cu.eruA.value = Math.random() * Math.PI * 2; cu.eruT.value = t; this.nextEruption = t + 25 + Math.random() * 25; }
    this.lastT = t;
    // lamps on the three gantries nearest the ship (by track distance, either side); the start gantry's is red
    const tr = this.track, gi = tr.gantryIdx, sIdx = Math.floor(s / tr.step);
    gi.map((i) => ({ i, d: Math.min((i - sIdx + tr.n) % tr.n, (sIdx - i + tr.n) % tr.n) }))
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ i }, k) => {
        const l = this.lamps[k];
        l.position.copy(tr.P[i]).addScaledVector(tr.U[i], 12.9);
        l.color.set(i === gi[0] ? 0xff6a55 : 0xc4ddff);
        l.intensity = i === gi[0] ? 260 : 420;
      });
  }
}
