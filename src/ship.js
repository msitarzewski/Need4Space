// The Feather S1: the exported GLB plus everything that makes it alive - rotors, canopy, glows, avionics lights,
// exhaust plumes and lights, vortex trails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// The hull's 8K normal map kept as two channels (RG8, 171 MB on the GPU instead of 341): a unit normal's z is
// rebuilt exactly from x and y in the shader. Copied on the GPU at load, the RGBA original freed.
function rgNormalMap(renderer, tex) {
  const img = tex.image, w = img.width, h = img.height;
  const rt = new THREE.WebGLRenderTarget(w, h, { format: THREE.RGFormat, type: THREE.UnsignedByteType, depthBuffer: false,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: tex.wrapS, wrapT: tex.wrapT,
    colorSpace: THREE.NoColorSpace });
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = vec4(textureLod(t, vUv, 0.0).rg, 0.0, 1.0); }' }));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); quad.render(renderer); renderer.setRenderTarget(prev);
  quad.material.dispose(); quad.dispose();
  rt.texture.channel = tex.channel; rt.texture.anisotropy = tex.anisotropy; rt.texture.userData.rg = true;
  tex.dispose(); tex.image?.close?.();
  return rt.texture;
}
const RG_FROM = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
const rgNormalChunk = (frag) => frag.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(RG_FROM,
  'vec3 mapN = vec3( texture2D( normalMap, vNormalMapUv ).xy * 2.0 - 1.0, 0.0 );\n\tmapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );'));
if (!THREE.ShaderChunk.normal_fragment_maps.includes(RG_FROM)) console.warn('normal chunk changed: the RG normal map would read z = 0');
// a texture's decoded image (an 8K ImageBitmap is 256 MB) let go once it is on the GPU
function releaseAfterUpload(tex) {
  if (!tex || tex.userData.release) return;
  tex.userData.release = true;
  const prev = tex.onUpdate;
  tex.onUpdate = (t) => { prev?.(t); t.image?.close?.(); };
}
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';
import { clamp, damp, smoothstep, noise2 } from './noise.js';
import { Q } from './quality.js';

// Blender (Z up) -> glTF / three (Y up): (x, y, z) -> (x, z, -y). The nose is at -Z, starboard at +X.
const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y).normalize();
const ease = (t) => t * t * (3 - 2 * t);
const _lq = new THREE.Quaternion(), _lv = new THREE.Vector3();

export async function loadShip(url, onProgress) {
  const [gltf] = await Promise.all([new GLTFLoader().loadAsync(url, onProgress), MeshoptSimplifier.ready]);
  const ship = new Ship(gltf);
  ship.buildLods();
  return ship;
}

function plumeMaterial(colour, core, inner) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, power: { value: 0 }, boost: { value: 0 }, len: { value: 1 },
      colour: { value: colour }, core: { value: core }, inner: { value: inner ? 1 : 0 },
      tailC: { value: colour.clone().multiplyScalar(0.55).lerp(new THREE.Color(0.35, 0.2, 1.0), 0.25) } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float time, power, boost, len, inner; uniform vec3 colour, core, tailC;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        // clamp before every pow(): interpolation overshoots 1.0 at the tip, pow(negative) is NaN, and the bloom
        // pass smeared one NaN pixel into a black square over the engines
        float t = clamp(vUv.y, 0.0, 1.0);                    // 0 at the nozzle, 1 at the tip
        float u = max(1.0 - t, 0.0);
        float face = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);   // thin at the cone's edges
        // turbulence: noise wrapped round the jet and scrolled down it, stronger toward the ragged tip
        vec2 q = vec2(vUv.x * 10.0, t * len * 1.6 - time * 9.0);
        float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 7.0) * 0.4;
        float turb = mix(1.0, 0.45 + 1.1 * n, smoothstep(0.05, 0.8, t));
        // Mach diamonds: bright knots near the nozzle, sharper on boost
        float knots = pow(0.5 + 0.5 * cos(t * len * 5.5 - time * 3.0), 6.0) * smoothstep(0.75, 0.0, t);
        float a = pow(face, 1.6) * pow(u, 1.25) * smoothstep(0.0, 0.05, t + 0.01) * turb;
        a *= 1.0 + knots * (0.35 + 1.2 * boost) * inner;
        // white-hot at the nozzle, through cyan to deep blue, violet in the thin tail
        vec3 tail = tailC;
        vec3 c = mix(colour, tail, smoothstep(0.35, 1.0, t));
        c = mix(c, core, pow(u, 4.0) * face);
        c = mix(c, core, boost * 0.35 * u);                // boost: hotter, whiter
        gl_FragColor = vec4(max(c * a * power, vec3(0.0)), 1.0);
      }`,
  });
}

function plumeGeo(rTip, rBase) {
  return new THREE.CylinderGeometry(rTip, rBase, 1, 32, 24, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
}

function glowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.12, 'rgba(255,255,255,0.6)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
}

const _hA = new THREE.Vector3(), _hB = new THREE.Vector3(), _hE = new THREE.Vector3();

class Plume {
  // eng: the engine's colour (each team's own); reverse: a retro-jet firing forward out of an inlet
  constructor(parent, at, r, scale, eng = new THREE.Color(0.12, 0.42, 1.0), reverse = false) {
    const white = new THREE.Color(1, 1, 1);
    this.outer = new THREE.Mesh(plumeGeo(r * 0.3, r * 1.02),
      plumeMaterial(eng.clone(), eng.clone().lerp(white, 0.7), false));
    this.inner = new THREE.Mesh(plumeGeo(r * 0.1, r * 0.6),
      plumeMaterial(eng.clone().lerp(white, 0.4), white.clone(), true));
    if (reverse) { this.outer.rotation.y = this.inner.rotation.y = Math.PI; }
    // (frustum-culled: the cone's bounds scale with the mesh - a plume off screen, or in the far depth slice while its
    // ship is near, is no draw at all; unculled, every ship's ten cones were drawn in both slices every frame)
    for (const m of [this.outer, this.inner]) {
      m.position.copy(at);
      m.renderOrder = 2;
      parent.add(m);
    }
    // the hot halo round the nozzle mouth (bloom does the rest)
    this.halo = new THREE.Sprite(glowSprite());
    this.halo.material.color.copy(eng).lerp(white, 0.45);
    this.halo.position.copy(at).add(new THREE.Vector3(0, 0, reverse ? -0.15 : 0.15));
    this.halo.renderOrder = 3;
    parent.add(this.halo);
    this.r = r;
    this.scale = scale;
  }

  update(t, power, thrust, boost) {
    const L = this.r * this.scale * (1.4 + 8 * thrust + 5 * boost);
    this.heat = power > 0.01 ? power * (0.3 + 0.45 * thrust + 0.6 * boost) : 0;     // (the heat shimmer behind it)
    const w = 1 + 0.2 * thrust + 0.15 * boost;
    this.outer.scale.set(w, w, L);
    this.inner.scale.set(1, 1, L * (0.42 + 0.15 * boost));
    for (const m of [this.outer, this.inner]) {
      const u = m.material.uniforms;
      u.time.value = t;
      u.power.value = power * (0.55 + 0.9 * thrust);
      u.boost.value = boost;
      u.len.value = L / this.r;
      m.visible = power > 0.01;
    }
    const h = this.r * (this.haloK ?? 1) * (2.2 + 1.6 * thrust + 1.2 * boost);
    this.halo.scale.set(h, h, 1);
    this.halo.material.opacity = Math.min(0.7, power * (0.2 + 0.35 * thrust + 0.3 * boost));
    this.halo.visible = power > 0.01;
  }
}

// A world-space ribbon's bounds, from the vertices it was just given: so it is frustum-culled like anything else (a
// trail off screen, or in the far depth slice while its ship is near, is no draw at all).
function ribbonBounds(g, pos) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const s = g.boundingSphere || (g.boundingSphere = new THREE.Sphere());
  s.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  s.radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

// a camera-facing ribbon behind a point (wingtip vortices)
class Trail {
  constructor(scene, n = 90) {
    this.n = n;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
      vertexShader: /* glsl */`attribute float alpha; varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`varying float vA; void main() { gl_FragColor = vec4(0.94, 0.96, 1.0, vA); }`,
    }));
    scene.add(this.mesh);
  }

  update(p, strength, cam) {
    const old = this.pts.length >= this.n ? this.pts.pop() : null;          // the oldest point, reused
    this.pts.unshift(old ? (old.p.copy(p), old.s = strength, old) : { p: p.clone(), s: strength });
    const side = this._side || (this._side = new THREE.Vector3()), tan = this._tan || (this._tan = new THREE.Vector3()), to = this._to || (this._to = new THREE.Vector3());
    let maxA = 0;
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[Math.min(i, this.pts.length - 1)];
      const nb = this.pts[Math.min(i + 1, this.pts.length - 1)];
      tan.subVectors(q.p, nb.p);
      if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
      to.subVectors(cam.position, q.p);
      side.crossVectors(tan, to).normalize();
      const f = i / (this.n - 1), w = 0.05 + 0.5 * f;
      const a = i < this.pts.length ? q.s * Math.pow(1 - f, 1.5) * 0.4 : 0;
      if (a > maxA) maxA = a;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3, sgn = k ? -1 : 1;
        this.pos[o] = q.p.x + side.x * w * sgn; this.pos[o + 1] = q.p.y + side.y * w * sgn; this.pos[o + 2] = q.p.z + side.z * w * sgn;
        this.alpha[i * 2 + k] = a;
      }
    }
    // all clear (not pulling hard, or not fast): nothing to draw - alpha 0 blends to nothing anyway
    this.mesh.visible = maxA > 0;
    if (this.mesh.visible) ribbonBounds(this.mesh.geometry, this.pos);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }

  clear() { this.pts.length = 0; }
}

// WipEout's light trails: a ribbon of each engine's light left hanging behind its nozzle, ~a quarter second long at
// speed (longer and whiter on boost), thinning and fading as it ages - a white-hot core in a sheath of the engine's
// colour. Kept faint near the camera, so the player's own never paints over the screen.
class EngineTrail {
  constructor(scene, colour, n = 44) {
    this.n = n;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    this.age = new Float32Array(n * 2);                // 0 at the nozzle .. 1 at the end of its life
    this.dist = new Float32Array(n * 2);               // metres back from the nozzle
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { side[i * 2] = 1; side[i * 2 + 1] = -1; }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    g.setAttribute('dist', new THREE.BufferAttribute(this.dist, 1));
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const white = new THREE.Color(1, 1, 1);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { colour: { value: colour.clone() }, hot: { value: colour.clone().lerp(white, 0.75) },
        tail: { value: colour.clone().multiplyScalar(0.6).lerp(new THREE.Color(0.45, 0.18, 1.0), 0.35) }, time: { value: 0 }, boost: { value: 0 } },
      vertexShader: /* glsl */`attribute float alpha; attribute float side; attribute float age; attribute float dist;
        varying float vA; varying float vS; varying float vF; varying float vD;
        void main() { vA = alpha; vS = side; vF = age; vD = dist; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // ("those look a bit flat": one even stripe of one colour.) A thin white-hot core in a soft glow; hot at the
      // nozzle, cooling through the engine's colour to violet as it ages; faint pulses of light running back along it,
      // stronger on boost - about as bright as it was
      fragmentShader: /* glsl */`uniform vec3 colour, hot, tail; uniform float time, boost;
        varying float vA; varying float vS; varying float vF; varying float vD;
        void main() {
          float x = vS * vS;
          float glow = exp(-x * 3.0), core = exp(-x * mix(30.0, 22.0, boost));
          vec3 c = mix(hot, colour, smoothstep(0.0, 0.35, vF));
          c = mix(c, tail, smoothstep(0.4, 1.0, vF));
          float pulse = 0.85 + (0.15 + 0.35 * boost) * pow(0.5 + 0.5 * sin(vD * 0.55 - time * 38.0), 3.0);
          gl_FragColor = vec4((c * glow * 0.8 + hot * core * (1.4 + 0.8 * boost) * (1.0 - 0.6 * vF)) * pulse * vA, 1.0);
        }`,
    }));
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.tan = new THREE.Vector3(); this.to = new THREE.Vector3(); this.sd = new THREE.Vector3();
  }

  update(p, t, strength, width, life, cam, boost = 0) {
    const head = this.pts[0];
    if (head && head.p.distanceToSquared(p) > 900) this.pts.length = 0;           // a respawn: no streak across the map
    if (!this.pts.length || this.pts[0].p.distanceToSquared(this.pts[1] ? this.pts[1].p : p) > 2.0) {
      const q = (this.spare || (this.spare = [])).pop();
      this.pts.unshift(q ? (q.p.copy(p), q.t = t, q) : { p: p.clone(), t });
    } else { this.pts[0].p.copy(p); this.pts[0].t = t; }
    while (this.pts.length > this.n || (this.pts.length > 2 && t - this.pts[this.pts.length - 1].t > life)) this.spare.push(this.pts.pop());
    const { tan, to, sd } = this, m = this.pts.length;
    const u = this.mesh.material.uniforms;
    u.time.value = t; u.boost.value = boost;
    let along = 0;
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[Math.min(i, m - 1)], nb = this.pts[Math.min(i + 1, m - 1)], pr = this.pts[Math.min(Math.max(i - 1, 0), m - 1)];
      tan.subVectors(pr.p, nb.p);
      if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
      to.subVectors(cam.position, q.p);
      const camD = to.length();
      sd.crossVectors(tan, to).normalize();
      const f = Math.min(1, (t - q.t) / life), w = width * (1 - 0.55 * f);
      if (i > 0 && i < m) along += q.p.distanceTo(pr.p);
      const a = i < m && m > 1 ? strength * (1 - f) * (1 - f) * smoothstep(12, 45, camD) : 0;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3, sg = k ? -w : w;
        this.pos[o] = q.p.x + sd.x * sg; this.pos[o + 1] = q.p.y + sd.y * sg; this.pos[o + 2] = q.p.z + sd.z * sg;
        this.alpha[i * 2 + k] = a;
        this.age[i * 2 + k] = f;
        this.dist[i * 2 + k] = along;
      }
    }
    this.mesh.visible = strength > 0.005 && m > 1;
    if (this.mesh.visible) ribbonBounds(this.mesh.geometry, this.pos);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.geometry.attributes.age.needsUpdate = true;
    this.mesh.geometry.attributes.dist.needsUpdate = true;
  }

  clear() { this.pts.length = 0; }
}

// The engines' trails as glowing gas ("more realistic particles for the trail"): soft wispy puffs laid every few tens
// of centimetres along the path each nozzle really flew (at 250 m/s a frame is 4 m of it), left hanging in the world,
// each growing and drifting a little as it ages and cooling from white-hot through the engine's colour to violet;
// overlapping, they read as one trail breaking up into wisps at its end. One mesh a ship (all its engines), every
// puff written once at its birth - the shader works out its age, size, drift, colour and fade. Same length and about
// the same light as the ribbons (EngineTrail, still the choice in Settings and on Low).
let WISP = null;
function wispTexture() {
  if (WISP) return WISP;
  const N = 128, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), im = g.createImageData(N, N);
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = h(i % 8, j % 8), b = h((i + 1) % 8, j % 8), cc = h(i % 8, (j + 1) % 8), d = h((i + 1) % 8, (j + 1) % 8);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1, r = Math.hypot(dx, dy);
    const fall = Math.max(0, 1 - r);
    const n = 0.55 * vn(x / 16, y / 16) + 0.3 * vn(x / 8 + 3, y / 8 + 7) + 0.15 * vn(x / 4 + 5, y / 4 + 1);
    const a = Math.pow(fall, 1.6) * (0.35 + 0.95 * n) * (0.6 + 0.4 * Math.exp(-r * r * 6));
    const o = (y * N + x) * 4;
    im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = Math.round(255 * Math.min(1, a));
  }
  g.putImageData(im, 0, 0);
  WISP = new THREE.CanvasTexture(c);
  return WISP;
}

class ExhaustTrail {
  constructor(scene, colour, engines, per = 220) {
    const n = this.n = engines * per;
    this.next = 0;
    this.lo = Infinity; this.hi = -1;                  // what was written this frame
    this.last = Array.from({ length: engines }, () => ({ p: new THREE.Vector3(), t: 0, on: false, acc: 0 }));
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.A = new Float32Array(n * 4).fill(-1e6); this.S = new Float32Array(n);
    for (const [k, arr, w] of [['iPos', this.P, 3], ['iVel', this.V, 3], ['iA', this.A, 4], ['iSeed', this.S, 1]]) {
      g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, w).setUsage(THREE.DynamicDrawUsage));
    }
    g.instanceCount = n;
    const white = new THREE.Color(1, 1, 1);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { time: { value: 0 }, map: { value: wispTexture() }, colour: { value: colour.clone() }, hot: { value: colour.clone().lerp(white, 0.7) },
        tail: { value: colour.clone().multiplyScalar(0.6).lerp(new THREE.Color(0.45, 0.18, 1.0), 0.35) } },
      vertexShader: /* glsl */`
        uniform float time;
        attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iA; attribute float iSeed;   // iA: born, life, size, light
        varying vec2 vUv; varying float vF; varying float vA;
        void main() {
          float age = time - iA.x, f = age / iA.y;
          vUv = uv; vF = f; vA = 0.0;
          if (f < 0.0 || f >= 1.0 || iA.w <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
          vec4 mv = modelViewMatrix * vec4(iPos + iVel * age, 1.0);
          float sz = iA.z * (1.0 + 1.7 * f);                                  // the gas spreading as it goes
          float rot = iSeed * 6.2832 + age * (iSeed - 0.5) * 4.0, c = cos(rot), s = sin(rot);
          mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * sz;
          // (the newest puffs, piled up just behind the nozzle, come in gently - on a rival ahead in the dark they burned
          // into one bright blob of its engine's colour; none in the camera's face)
          vA = iA.w * smoothstep(0.0, 0.16, f) * (1.0 - f) * (1.0 - f) * smoothstep(10.0, 35.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 colour, hot, tail; varying vec2 vUv; varying float vF; varying float vA;
        void main() {
          float m = texture2D(map, vUv).a;
          vec3 c = mix(hot * 0.95, colour, smoothstep(0.0, 0.3, vF));
          c = mix(c, tail, smoothstep(0.35, 1.0, vF));
          gl_FragColor = vec4(c * m * vA, 1.0);
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  // engine k's nozzle is at p (world) at time t: puffs along the way it came since the last frame
  emit(k, p, t, strength, width, life, boost) {
    const L = this.last[k];
    if (!L.on || L.p.distanceToSquared(p) > 1600 || strength < 0.005) { L.p.copy(p); L.t = t; L.on = true; L.acc = 0; return; }
    const d = L.p.distanceTo(p), size = width * (2.6 + 1.2 * boost), step = Math.max(0.25, size * 0.38);
    let along = step - L.acc;
    for (; along <= d; along += step) {
      const a = along / d, i = this.next;
      this.next = (this.next + 1) % this.n;
      this.lo = Math.min(this.lo, i); this.hi = Math.max(this.hi, i);
      const j = width * 0.35;
      this.P[i * 3] = L.p.x + (p.x - L.p.x) * a + (Math.random() - 0.5) * j;
      this.P[i * 3 + 1] = L.p.y + (p.y - L.p.y) * a + (Math.random() - 0.5) * j;
      this.P[i * 3 + 2] = L.p.z + (p.z - L.p.z) * a + (Math.random() - 0.5) * j;
      this.V[i * 3] = (Math.random() - 0.5) * 2.4; this.V[i * 3 + 1] = (Math.random() - 0.3) * 2.0; this.V[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
      this.A[i * 4] = L.t + (t - L.t) * a;
      this.A[i * 4 + 1] = life * 1.25 * (0.75 + 0.5 * Math.random());
      this.A[i * 4 + 2] = size * (0.75 + 0.5 * Math.random());
      this.A[i * 4 + 3] = strength * (0.4 + 0.2 * boost) * (0.8 + 0.4 * Math.random());
      this.S[i] = Math.random();
    }
    L.acc = d - (along - step);
    L.p.copy(p); L.t = t;
  }

  // after every engine's emit this frame: the new puffs to the GPU, the clock on
  finish(t) {
    this.mesh.material.uniforms.time.value = t;
    this.mesh.visible = true;
    if (this.hi < 0) return;
    const at = this.mesh.geometry.attributes, wrap = this.hi - this.lo > this.n / 2;   // (wrapped round the ring: all of it)
    for (const [k, w] of [['iPos', 3], ['iVel', 3], ['iA', 4], ['iSeed', 1]]) {
      const a = at[k];
      a.clearUpdateRanges();
      if (!wrap) a.addUpdateRange(this.lo * w, (this.hi - this.lo + 1) * w);
      a.needsUpdate = true;
    }
    this.lo = Infinity; this.hi = -1;
  }

  clear() {
    for (const L of this.last) L.on = false;
    this.A.fill(-1e6);
    const a = this.mesh.geometry.attributes.iA;
    a.clearUpdateRanges(); a.needsUpdate = true;
  }
}

// the ship's energy shield: invisible until hit, then a fresnel shell with hex cells, brightest round the point of
// contact, fading in half a second
function shieldMaterial(tint) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { hit: { value: new THREE.Vector3() }, amount: { value: 0 }, time: { value: 0 }, tint: { value: tint } },
    vertexShader: /* glsl */`
      varying vec3 vL; varying vec3 vN; varying vec3 vV;
      void main() {
        vL = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    // A hex-cell energy shell. The blow lights the cell it lands on white-hot; a front races out over the shell from
    // there and each cell flashes as it passes - filled, not just outlined, each at its own strength and with its
    // own flicker - then the whole shell fades. A faint fresnel rim holds the shape while it is up.
    fragmentShader: /* glsl */`
      uniform vec3 hit, tint; uniform float amount, time; varying vec3 vL; varying vec3 vN; varying vec3 vV;
      float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
      vec4 hexGrid(vec2 uv) {                     // (edge distance 0..0.5, cell id)
        const vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
        vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        return vec4(0.5 - hexDist(g), 0.0, uv - g);
      }
      void main() {
        vec3 L = normalize(vL);
        vec4 hx = hexGrid(vec2(atan(L.x, L.z) * 3.2, L.y * 5.5));
        float rnd = h12(hx.zw), edge = 1.0 - smoothstep(0.02, 0.07, hx.x);
        float d = distance(L, normalize(hit));
        float age = 1.0 - amount;                                     // 0 at the blow .. 1 gone
        float front = age * 2.4;
        float band = exp(-pow((d - front) / (0.22 + 0.1 * rnd), 2.0));           // the front passing this cell
        float lit = band * (0.35 + 0.65 * rnd) * (0.7 + 0.3 * sin(time * 40.0 + rnd * 31.0));
        float core = exp(-d * d / 0.03) * amount * amount;                         // the blow itself
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        float a = (lit * (0.12 + edge * 0.9) + rim * 0.12 + core * (2.0 + edge * 1.5)) * amount;
        vec3 c = mix(tint, vec3(1.0), clamp(core * 0.8 + band * edge * 0.3, 0.0, 1.0));
        gl_FragColor = vec4(c * a, 1.0);
      }`,
  });
}

const GLOWS = ['EngineGlow', 'EngineCore'];
const AVIONICS = ['LedCyan', 'LedAmber', 'BayLight', 'Screen', 'NavLamp', 'NavGreen', 'NavRed'];
const BAY_FILL = ['Chip', 'PCB', 'Cable', 'CableOrange', 'Copper', 'Gold'];
// the brake lights: the engine glow's long bars under the wings turn this red with the brake (linear; any green and
// ACES burns the core orange)
const BRAKE_RED = new THREE.Color(1, 0, 0.014), BRAKE_I = 1.15, _brakeC = new THREE.Color();
// the engine glow rings: [centre-line radius, width] (m), in each ring's own space (its own xy plane) - ThroatGlow:
// the rocket's throat insert, a band down the bell's wall whose glow fades from the throat toward the exit
// the side exits' shimmer: wider than the exit (x its radius) and reaching further behind (x the marker's reach)
const VENT_WIDTH = 1.5, VENT_REACH = 2.2;
const RINGS = { InletGlow: [0.51, 0.03], ExhaustGlow: [0.54, 0.035], TailGlow: [0.15, 0.016], ThroatGlow: [0.40, 0.05] };
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'displacementMap'];
const IDENTITY = new THREE.Matrix4();

// The parts atlas's material: a plain MeshStandardMaterial whose colour, roughness, metalness and emissive come per
// part from uniform arrays, read in the fragment shader by the part id - the very values its own material had, so each
// part shades exactly as before - the engine rings' gaussian glow included. One program for every ship; each ship its
// own uniforms. (The id travels as a plain interpolated float - the same on every vertex of a part, so it arrives
// exact - not a flat varying: on the RX 7900 XT any flat varying, even one vec4 of the part's values, made the parts
// ~0.03 ms slower to shade than all their separate draws; this way they shade faster.)
function partsMaterial(n, U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x000000 });
  m.name = 'Parts';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float partId;\nattribute vec2 ringP;\nvarying float vPartId;\nvarying vec2 vRingP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPartId = partId;\n  vRingP = ringP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vPartId;\nvarying vec2 vRingP;\nuniform vec4 partA[${n}];\nuniform vec4 partB[${n}];\nuniform vec2 partR[${n}];\nuniform vec3 ringEng, ringHot;\nuniform float ringK;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'int partI = int( vPartId + 0.5 );\n\tvec4 partCA = partA[ partI ], partCB = partB[ partI ];\n\tvec4 diffuseColor = vec4( partCA.rgb, opacity );')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = partCA.a;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = partCB.a;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = partCB.rgb;')
      // (the rings: as their own shader had it, `gain` included - the emissive here is the ring's emissive x intensity)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  vec2 partRW = partR[ partI ];
  if (partRW.y > 0.0) {
    float uu = (length(vRingP) - partRW.x) / partRW.y, core = exp(-uu * uu);
    float gain = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722)) / max(dot(partCB.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    totalEmissiveRadiance = mix(ringEng, ringHot, core * core) * (0.35 + 6.0 * core) * gain * 0.9 * ringK;
  }`);
  };
  m.customProgramCacheKey = () => 'feather-parts-' + n;
  return m;
}

// one detail level of an atlas for one ship: the shared vertex buffers and index, its own draw range
function partsGeometry(G, index) {
  const g = new THREE.BufferGeometry();
  for (const k in G.attrs) g.setAttribute(k, G.attrs[k]);
  g.setIndex(index);
  g.boundingSphere = G.sphere;
  return g;
}

// Glass that reads as glass. three.js scales a transparent surface's reflection by its opacity as well, so the canopy
// and the bay windows were a flat grey film ("the glass on the engine looks so bad"). Here the reflection goes on at
// full strength (premultiplied blending: the glass adds its reflection and dims what is behind by its opacity), and
// grazing angles reflect more and let less through (fresnel).
function glassify(m, tint, opacity) {
  m.color.set(tint);
  m.opacity = opacity;
  m.transparent = true;
  m.depthWrite = false;
  m.metalness = 0;
  m.roughness = 0.03;
  m.envMapIntensity = 1.0;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float glassF = 0.04 + 0.96 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
      gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance,
        diffuseColor.a + (1.0 - diffuseColor.a) * glassF);`);
  };
  m.customProgramCacheKey = () => 'feather-glass';
  m.needsUpdate = true;
}

// A rival's paint: the baked red livery swapped for its colour (scaled by the red's own value, so the wear, chips and
// grime it carries stay), the white body multiplied by a tint (1 = white, dark = a black ship). Dark charcoal
// pinstripes, the name lettering, metal and glass are left alone.
const TEAM_GLSL = /* glsl */`
#ifdef USE_MAP
{
  vec3 c = diffuseColor.rgb;
  float red = smoothstep(0.05, 0.11, c.r - max(c.g, c.b));
  vec3 liv = teamA * clamp(c.r / 0.19, 0.0, 1.6);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float white = smoothstep(0.22, 0.45, lum) * (1.0 - smoothstep(0.04, 0.14, mx - mn));
  c = mix(c, c * teamB, white);
  diffuseColor.rgb = mix(c, liv, red);
}
#endif
`;

// a mesh's connected pieces: vertices welded by position (0.5 mm), triangles joined into pieces. Per vertex its
// piece (of), per piece its bounding box (min xyz, max xyz) - in the space `matrix` puts it in.
function pieces(geo, matrix) {
  const pos = geo.attributes.position, n = pos.count, v = new THREE.Vector3();
  const P = new Float32Array(n * 3), weld = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    const k = Math.round(v.x * 2000) + ',' + Math.round(v.y * 2000) + ',' + Math.round(v.z * 2000);
    const w = seen.get(k);
    if (w === undefined) { seen.set(k, i); weld[i] = i; } else weld[i] = w;
  }
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const join = (a, b) => { a = find(weld[a]); b = find(weld[b]); if (a !== b) par[a] = b; };
  const idx = geo.index ? geo.index.array : null, tris = idx ? idx.length : n;
  for (let t = 0; t < tris; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    join(a, b); join(b, c);
  }
  const box = new Map(), of = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = (of[i] = find(weld[i]));
    let B = box.get(r);
    if (!B) box.set(r, (B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
    for (let k = 0; k < 3; k++) { const x = P[i * 3 + k]; if (x < B[k]) B[k] = x; if (x > B[k + 3]) B[k + 3] = x; }
  }
  return { of, box };
}

// the width of a mesh's thickest connected piece (m): each piece's second-largest extent is how wide it draws.
// Cached per geometry (the rivals' clones share them).
const _pieceW = new WeakMap();
function pieceWidth(geo, matrix) {
  if (_pieceW.has(geo)) return _pieceW.get(geo);
  let w = 0;
  for (const B of pieces(geo, matrix).box.values()) { const e = [B[3] - B[0], B[4] - B[1], B[5] - B[2]].sort((p, q) => p - q); w = Math.max(w, e[1]); }
  _pieceW.set(geo, w);
  return w;
}

// a geometry (position, normal, index) split by its pieces: [the pieces whose box passes `test`, the rest] (null for
// an empty side)
function splitPieces(geo, test) {
  const { of, box } = pieces(geo, IDENTITY), pass = new Map();
  for (const [r, B] of box) pass.set(r, test(B));
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const idx = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i);
  const side = (want) => {
    const map = new Int32Array(n).fill(-1), P = [], N = [], I = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (pass.get(of[idx[t]]) !== want) continue;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k];
        if (map[i] < 0) { map[i] = P.length / 3; P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); }
        I.push(map[i]);
      }
    }
    if (!I.length) return null;
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
      .setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)).setIndex(I);
  };
  return [side(true), side(false)];
}

export class Ship {
  // opts.cloneOf: a rival built from the player's loaded ship (geometry and textures shared, materials its own);
  // opts.team: { livery: [r, g, b], body: [r, g, b] } linear colours; opts.lights: false skips the exhaust lights
  constructor(gltf, opts = {}) {
    this.root = new THREE.Group();     // the flight transform (physics)
    this.visual = new THREE.Group();   // hover bob and shake, never fed back to the physics
    this.root.add(this.visual);
    const base = opts.cloneOf;
    this.model = base ? base.model.clone(true) : gltf.scene;
    if (base) {                        // each rival owns its materials: its glows follow its own engines
      const own = new Map();
      this.model.traverse((o) => {
        if (!o.isMesh || o.userData.parts != null) return;     // (the parts atlases get theirs in setupParts)
        if (!own.has(o.material)) own.set(o.material, o.material.clone());
        o.material = own.get(o.material);
      });
    }
    this.visual.add(this.model);
    this.clips = gltf ? gltf.animations : [];
    this.rotors = [];
    this.folds = [];
    this.canopy = null;
    this.mats = {};
    this.tris = 0;
    this.model.traverse((o) => {
      let m = o.userData && o.userData.motion;
      if (typeof m === 'string') m = JSON.parse(m);
      if (m && m.type === 'spin') {
        this.rotors.push({ node: o, axis: toThree(m.axis), rps: m.rpm / 60, base: o.quaternion.clone(), angle: 0,
          idle: m.idle || 0, spool: m.spool || 0, w: 0 });
      } else if (m && m.type === 'fold') {      // a nozzle tooth: folded out with the engine off, closed in running
        this.folds.push({ node: o, axis: toThree(m.axis), deg: m.deg, base: o.quaternion.clone() });
      } else if (m && m.type === 'hinge') {
        this.canopy = { node: o, axis: toThree(m.axis), deg: m.deg, base: o.quaternion.clone() };
      }
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        this.tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        if (o.userData.parts == null) this.mats[o.material.name] = o.material;
      }
    });
    // a copy made while the original's canopy stood open (or its nozzle's teeth folded out, its rotor turned) took that
    // pose as its rest: closing the canopy left it open. Every moving part's rest is the original's own.
    if (base) {
      const rest = new Map([...base.rotors, ...(base.folds || []), ...(base.canopy ? [base.canopy] : [])].map((r) => [r.node.name, r.base]));
      for (const r of [...this.rotors, ...this.folds, ...(this.canopy ? [this.canopy] : [])]) {
        const q = rest.get(r.node.name);
        if (q) { r.base.copy(q); r.node.quaternion.copy(q); }
      }
    }
    // the canopy: smoked; the bay windows: clear enough to see the electronics behind them
    if (this.mats.Glass) glassify(this.mats.Glass, 0x1c2433, 0.5);
    if (this.mats.BayGlass) glassify(this.mats.BayGlass, 0x223038, 0.12);
    // the bays' own light: in Cycles the bay lamps lit the electronics; here nothing reached them in the nacelle's
    // shade and the windows showed a black box. A fill in each part's own colour, on with the avionics.
    for (const n of BAY_FILL) {
      const m = this.mats[n];
      if (m) { m.emissive.copy(m.color).multiplyScalar(m.metalness > 0.5 ? 0.16 : 0.22); m.emissiveIntensity = 0; }
    }
    this.glowBase = {};
    // engine glows 0.6x the export's: at full strength they bloomed into white blobs
    for (const n of [...GLOWS, ...AVIONICS]) if (this.mats[n]) this.glowBase[n] = this.mats[n].emissiveIntensity * (GLOWS.includes(n) ? 0.6 : 1);

    if (base) {                        // same hull: same probes, tips and span, nozzles, parts atlas
      for (const k of ['probes', 'bottom', 'tipR', 'tipL', 'halfSpan', 'length', 'tangentsFixed', 'nozzles', 'parts']) this[k] = base[k];
    } else {
      this.repairTangents();
      this.root.updateMatrixWorld(true);
      this.measure();
    }
    if (opts.team) this.paint(opts.team);
    // the engine's colour: rings, cores, conduits, plumes, halos, sparks (each team its own)
    this.engineColor = new THREE.Color(...(opts.engine || [0.1, 0.42, 1.0]));
    const white = new THREE.Color(1, 1, 1);
    if (this.mats.EngineGlow) this.mats.EngineGlow.emissive.copy(this.engineColor);
    if (this.mats.EngineCore) this.mats.EngineCore.emissive.copy(this.engineColor).lerp(white, 0.6);
    // the glow rings as HDR light: white-hot along the ring's centre line, the engine colour at its edges (the Cycles
    // look's ring shader: a gaussian across the ring); each ring its own radius
    // (a rival has none of its own: its rings are in the parts atlas it cloned, lit through setupParts)
    this.ringMats = [];
    this.ringUs = [];
    this.model.traverse((o) => {
      const key = o.isMesh && Object.keys(RINGS).find((k) => o.name.startsWith(k));
      if (!key) return;
      const [rc, w] = RINGS[key], m = o.material.clone(), eng = this.engineColor.clone(), hot = eng.clone().lerp(white, 0.8);
      // (the ring's size and the team's colours as uniforms: one program for every ring of every ship)
      const U = { ringRW: { value: new THREE.Vector2(rc, w) }, ringEng: { value: eng }, ringHot: { value: hot }, ringK: { value: 1 } };
      this.ringUs.push(U);
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRingP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRingP = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRingP;\nuniform vec2 ringRW;\nuniform vec3 ringEng, ringHot;\nuniform float ringK;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float uu = (length(vRingP.xy) - ringRW.x) / ringRW.y, core = exp(-uu * uu);
    float gain = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722)) / max(dot(emissive, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    totalEmissiveRadiance = mix(ringEng, ringHot, core * core) * (0.35 + 6.0 * core) * gain * 0.9 * ringK;
  }`);
      };
      m.customProgramCacheKey = () => 'feather-ring';
      o.material = m;
      this.ringMats.push(m);
    });
    // the nozzles (the glow rings' boxes) - measured on the player's ship before its rings join the parts atlas
    this.nozzles ||= {};
    const nozzle = (name) => {
      if (!(name in this.nozzles)) { const n = this.model.getObjectByName(name); this.nozzles[name] = n ? new THREE.Box3().setFromObject(n) : null; }
      return this.nozzles[name];
    };
    this.plumes = [];
    // a model that marks its nozzles - empties named Plume_*, extras.plume = { r, halo } at the exit plane - has its
    // flames started there (the rocket's bell: a core jet inside the dark bell, its halo kept small so the bell's wall
    // and throat ring still read); the Feather's come from its glow rings below
    const marks = [];
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => { if (/^Plume_/.test(o.name) && o.userData.plume) marks.push(o); });
    // hot air out of side exits (the rocket's sponsons): marker empties Heat_*, extras.heat = { r, len, dir } - more
    // shimmer behind them with speed and throttle
    this.vents = [];
    this.ventHeat = 0;
    this.model.traverse((o) => {
      if (!/^Heat_/.test(o.name) || !o.userData.heat) return;
      const m = typeof o.userData.heat === 'string' ? JSON.parse(o.userData.heat) : o.userData.heat;
      this.vents.push({ node: o, r: m.r, len: m.len, dir: toThree(m.dir) });
    });
    for (const o of marks) {
      const m = typeof o.userData.plume === 'string' ? JSON.parse(o.userData.plume) : o.userData.plume;
      const p = new Plume(this.visual, new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), m.r, 1, this.engineColor);
      p.haloK = m.halo ?? 1;
      this.plumes.push(p);
    }
    for (const [name, scale] of marks.length ? [] : [['ExhaustGlow_R', 1], ['ExhaustGlow_L', 1], ['TailGlow', 1.4]]) {
      const b = nozzle(name);
      if (!b) { console.warn('no exhaust', name); continue; }
      const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      const r = 0.45 * Math.max(s.x, s.y);
      this.plumes.push(new Plume(this.visual, new THREE.Vector3(c.x, c.y, b.max.z - 0.05), r, scale * (r > 0.3 ? 1 : 2.2), this.engineColor));
    }
    // no brake lights: glow sprites at fixed points off the hull read as red lights hanging in the air ("red lights
    // appearing in thin air when breaking"); the brake shows in the collapsing plumes, the retro-jets and the nose dip
    this.brakeLights = [];
    // retro-jets: braking fires short jets forward out of both inlets
    this.retros = [];
    for (const name of ['InletGlow_R', 'InletGlow_L']) {
      const b = nozzle(name);
      if (!b) continue;
      const c = b.getCenter(new THREE.Vector3());
      this.retros.push(new Plume(this.visual, new THREE.Vector3(c.x, c.y, b.min.z - 0.1), 0.32, 1.6, this.engineColor, true));
    }
    this.exhaustLights = (opts.lights === false ? [] : this.plumes.slice(0, 2)).map((p) => {
      const l = new THREE.PointLight(this.engineColor.clone().lerp(new THREE.Color(1, 1, 1), 0.3), 0, 16, 2);
      l.position.copy(p.outer.position).add(new THREE.Vector3(0, 0, 2.5));
      this.visual.add(l);
      return l;
    });

    // the energy shield round the hull (an ellipsoid a little larger than the ship)
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32),
      shieldMaterial((opts.engine ? new THREE.Color(...opts.engine) : new THREE.Color(0.1, 0.42, 1.0)).lerp(new THREE.Color(0.35, 0.8, 1.0), 0.5)));
    this.shield.scale.set(this.halfSpan + 0.8, 2.6, (this.length || 13.3) / 2 + 0.9);
    this.shield.position.set(0, -0.1, (this.tipR ? 0 : 0));
    this.shield.visible = false;
    this.shield.renderOrder = 4;
    this.visual.add(this.shield);
    this.boostKick = 0;
    this.accelKick = 0;
    this.prevAccel = 0;

    // state
    this.engineOn = false;
    this.power = 0;        // reactor / hover systems 0..1
    this.spin = 0;         // rotor speed 0..1
    this.avionics = 0;     // cockpit, bays, nav lights 0..1
    this.canopyOpen = true;
    this.canopyT = 1;
    this.t = 0;
    this.trails = null;
    // one draw per material for the static hull, then the small parts into two atlases (a rival's clone copies the
    // merged meshes and shares their geometry)
    if (!base) { this.mergeStatic(); this.buildParts(); }
    this.setupParts();
    this.lod = 0;
    this.lodMeshes = base ? (base.lods || []).filter((l) => !l.parts)
      .map((l) => ({ mesh: this.model.getObjectByName(l.name), levels: l.levels })).filter((l) => l.mesh)
      .concat(this.partMeshes.map((pm) => ({ mesh: pm.mesh, levels: pm.levels, parts: true }))) : [];
    this.lodErr = base ? base.lodErr : null;
    this.buildDetails();
  }

  // Parts thinner than a fraction of a pixel on screen are left out of every pass (the frame, both depth slices, the AO
  // normals, the three shadow maps). A ship is 47 draws, most of them bay electronics, cables, chips and fittings a
  // few cm across - at 100 m a 1 cm cable is a tenth of a pixel wide, and so is its shadow - and nine ships made ~1200
  // draws a frame. A mesh is judged by its thickest connected piece (the export already merged every chip into one
  // object), by that piece's second-largest extent: how wide it draws, so a long thin cable counts as thin. Culled
  // under a third of a pixel (a quarter for glowing bits), through its layer (layer 0 off), so whatever else sets
  // .visible (canopy, shields) is left alone. Glass and glows cast no sun shadow. (The parts atlases cull each of
  // their parts by the same rule through their draw range: setLod.)
  buildDetails() {
    this.details = [];
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.isShaderMaterial || o.userData.parts != null) return;
      const m = o.material, glow = (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0) || /glow|led|nav|lamp|light|screen/i.test(m.name);
      if (glow || /glass/i.test(m.name)) o.castShadow = false;
      const w = pieceWidth(o.geometry, o.matrixWorld);
      if (w < 0.6) this.details.push({ mesh: o, w, thr: glow ? 0.25 : 0.34 });     // (big parts never get that thin)
    });
  }

  // Everything on the hull that never moves, merged into one mesh per material. The export's 70 meshes were 70 draw
  // calls per ship in every pass (the frame, the AO normals, both shadow cascades) - nine ships: most of the CPU's
  // frame. Rotors, the canopy and the engine rings (each ring its own shader, in its own local space) stay apart; the
  // merged meshes keep their materials and vertices, so nothing changes on screen.
  mergeStatic() {
    const moving = new Set([...this.rotors.map((r) => r.node), this.canopy && this.canopy.node].filter(Boolean));
    const rings = new Set(this.ringMats), groups = new Map();
    this.model.updateMatrixWorld(true);
    const inv = this.model.matrixWorld.clone().invert();
    this.model.traverse((o) => {
      // (named brake lights keep their names: buildParts finds them by it)
      if (!o.isMesh || rings.has(o.material) || o.children.length || /^BrakeLight/.test(o.name)) return;
      for (let p = o; p && p !== this.model; p = p.parent) if (moving.has(p)) return;
      if (!groups.has(o.material)) groups.set(o.material, []);
      groups.get(o.material).push(o);
    });
    let merged = 0;
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const geo = mergeGeometries(list.map((o) => o.geometry.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld))));
      if (!geo) continue;                       // attribute sets differ: left as they are
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.name = `${mat.name}_static`;
      m.castShadow = m.receiveShadow = true;
      this.model.add(m);
      for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
      merged += list.length;
    }
    let meshes = 0;
    this.model.traverse((o) => { if (o.isMesh) meshes++; });
    this.merged = { from: merged, meshes };
  }

  // The parts atlases. After mergeStatic a ship was still 32 draws in every pass, 22 of them small opaque parts each in
  // a plain material of its own - alloy, cables, chips, copper, gold, boards, engine faces and cores, LEDs, bay lights,
  // screens, nav lights and the five glow rings. They become two meshes: the parts that cast a sun shadow and the
  // glowing ones that don't (as before), each one draw with one material (partsMaterial: every part keeps its own
  // colour, roughness, metalness and emissive by its part id) - same triangles, same shading. Each atlas lists its parts
  // widest first (width over culling threshold), so the parts still on at a distance are always the front of its index:
  // buildDetails' per-part culling becomes a draw range (setLod), same widths, same thresholds; the distance level is
  // built per part (buildLods), each part simplified exactly as when it was a mesh of its own.
  buildParts() {
    const moving = new Set([...this.rotors.map((r) => r.node), this.canopy && this.canopy.node].filter(Boolean));
    this.model.updateMatrixWorld(true);
    const inv = this.model.matrixWorld.clone().invert(), list = [];
    this.model.traverse((o) => {
      if (!o.isMesh || o.children.length) return;
      const m = o.material, ring = this.ringMats.includes(m), n = m.name;
      if (!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.transparent || MAPS.some((k) => m[k])) return;
      if (!ring && m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
      for (let p = o; p && p !== this.model; p = p.parent) if (moving.has(p)) return;
      // (culled and shadowed exactly as buildDetails judged the mesh)
      const glow = (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0) || /glow|led|nav|lamp|light|screen/i.test(n);
      const w = pieceWidth(o.geometry, o.matrixWorld), M = inv.clone().multiply(o.matrixWorld);
      list.push({ id: list.length, name: o.name, mat: m, mesh: o, matrix: M, w, thr: glow ? 0.25 : 0.34, cull: w < 0.6, cast: !glow,
        geo: M.equals(IDENTITY) ? o.geometry : o.geometry.clone().applyMatrix4(M),
        ring: ring ? RINGS[Object.keys(RINGS).find((k) => o.name.startsWith(k))] : null,
        // how its emissive moves (update): engine glow and rings with the drive, avionics and bay fill with the
        // avionics, the rest fixed; the engine glow and cores take each ship's engine colour (eng: the white mixed in)
        kind: ring ? 'ring' : GLOWS.includes(n) ? 'glow' : AVIONICS.includes(n) ? 'avi' : BAY_FILL.includes(n) ? 'bay' : 'const',
        base: ring ? this.glowBase.EngineGlow : this.glowBase[n] ?? m.emissiveIntensity,
        eng: ring ? null : n === 'EngineGlow' ? 0 : n === 'EngineCore' ? 0.6 : null });
    });
    if (!list.length) return;
    // the brake lights: the engine glow's two long bars (from the fuselage out to each nacelle, under the wings) become a
    // part of their own - same glow, same culling rule - that updateParts turns red with the brake; the rest stays
    const eg = list.find((p) => p.kind === 'glow' && p.mat.name === 'EngineGlow');
    const bars = eg && splitPieces(eg.geo, (B) => Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2]) > 1.5);
    if (bars && bars[0] && bars[1]) {
      if (eg.geo !== eg.mesh.geometry) eg.geo.dispose();
      const w = pieceWidth(bars[0], IDENTITY);
      list.push({ ...eg, id: list.length, name: 'BrakeLights', geo: bars[0], w, cull: w < 0.6, brake: true });
      eg.geo = bars[1];
      eg.w = pieceWidth(bars[1], IDENTITY);
      eg.cull = eg.w < 0.6;
    }
    // a model may name its brake lights (BrakeLight_*: the rocket's bars in its trailing edge) - red with the brake too
    for (const p of list) if (/^BrakeLight/.test(p.name)) p.brake = true;
    const groups = [], key = (p) => (p.cull ? p.w / p.thr : Infinity);
    for (const [name, cast] of [['Parts_cast', true], ['Parts_glow', false]]) {
      const parts = list.filter((p) => p.cast === cast).sort((a, b) => (key(a) === key(b) ? 0 : key(b) - key(a)));
      if (!parts.length) continue;
      let nv = 0, ni = 0;
      for (const p of parts) { nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), ID = new Float32Array(nv), RP = new Float32Array(nv * 2);
      const I = new Uint32Array(ni), cum = [0];
      let v = 0, i = 0;
      for (const p of parts) {
        const pa = p.geo.attributes.position, na = p.geo.attributes.normal, lp = p.mesh.geometry.attributes.position;
        const c = pa.count, ix = p.geo.index ? p.geo.index.array : null, ci = ix ? ix.length : c;
        for (let k = 0; k < c; k++) {
          const o = (v + k) * 3;
          P[o] = pa.getX(k); P[o + 1] = pa.getY(k); P[o + 2] = pa.getZ(k);
          N[o] = na.getX(k); N[o + 1] = na.getY(k); N[o + 2] = na.getZ(k);
          ID[v + k] = p.id;
          if (p.ring) { RP[(v + k) * 2] = lp.getX(k); RP[(v + k) * 2 + 1] = lp.getY(k); }     // the ring's own space
        }
        for (let k = 0; k < ci; k++) I[i + k] = (ix ? ix[k] : k) + v;
        Object.assign(p, { v0: v, nv: c, i0: i, ni: ci });
        v += c; i += ci;
        cum.push(i);
      }
      const attrs = { position: new THREE.BufferAttribute(P, 3), normal: new THREE.BufferAttribute(N, 3),
        partId: new THREE.BufferAttribute(ID, 1), ringP: new THREE.BufferAttribute(RP, 2) };
      const bs = new THREE.BufferGeometry().setAttribute('position', attrs.position);
      bs.computeBoundingSphere();
      // levels[k]: the index at distance level k (buildLods adds the far one); cum[k][j]: where part j ends in it
      groups.push({ name, cast, parts, attrs, sphere: bs.boundingSphere, levels: [new THREE.BufferAttribute(I, 1)], cum: [cum] });
    }
    const A = new Float32Array(list.length * 4), R = new Float32Array(list.length * 2);
    for (const p of list) {
      A.set([p.mat.color.r, p.mat.color.g, p.mat.color.b, p.mat.roughness], p.id * 4);
      if (p.ring) R.set(p.ring, p.id * 2);
      p.mesh.removeFromParent();
      if (p.geo !== p.mesh.geometry) p.geo.dispose();
      p.mesh.geometry.dispose();
      delete p.geo; delete p.mesh;
    }
    // the materials now drawn only through the atlases leave the ship's list (and the rings their own)
    const used = new Set();
    this.model.traverse((o) => { if (o.isMesh) used.add(o.material); });
    for (const k of Object.keys(this.mats)) if (!used.has(this.mats[k])) delete this.mats[k];
    this.ringMats = [];
    this.parts = { list, groups, n: list.length, A, R };
  }

  // this ship's atlas meshes (the player's made here, a rival's cloned from it): its own material and uniforms (its
  // engine colour, its glows), its own geometry per distance level (shared buffers, its own draw range)
  setupParts() {
    const S = this.parts, white = new THREE.Color(1, 1, 1);
    this.partMeshes = [];
    this.partE = [];
    if (!S) return;
    const B = new Float32Array(S.n * 4);
    for (const p of S.list) {
      const e = p.eng != null ? this.engineColor.clone().lerp(white, p.eng) : p.mat.emissive.clone();
      B[p.id * 4 + 3] = p.mat.metalness;
      if (p.kind === 'const') B.set([e.r * p.base, e.g * p.base, e.b * p.base], p.id * 4);
      else this.partE.push({ o: p.id * 4, kind: p.kind, base: p.base, e, brake: !!p.brake });
    }
    this.partU = { partA: { value: S.A }, partB: { value: B }, partR: { value: S.R },
      ringEng: { value: this.engineColor.clone() }, ringHot: { value: this.engineColor.clone().lerp(white, 0.8) },
      ringK: { value: 1 } };
    this.partMat = partsMaterial(S.n, this.partU);
    S.groups.forEach((G, gi) => {
      const levels = G.levels.map((idx) => partsGeometry(G, idx));
      let mesh = this.model.getObjectByName(G.name);
      if (mesh) { mesh.geometry = levels[0]; mesh.material = this.partMat; } else {
        mesh = new THREE.Mesh(levels[0], this.partMat);
        mesh.name = G.name;
        mesh.userData.parts = gi;
        this.model.add(mesh);
      }
      mesh.castShadow = G.cast;
      mesh.receiveShadow = true;
      this.partMeshes.push({ mesh, G, levels, c: -1, k: -1 });
    });
  }

  // the atlas parts' emissive this frame (each exactly what its own material's emissive x intensity was):
  // f the spool-up, drive the throttle / boost / brake, av the avionics, lamp the brake lights (0..1)
  updateParts(f, drive, av, lamp = 0) {
    const B = this.partU.partB.value;
    for (const q of this.partE) {
      let I = q.kind === 'bay' ? av : q.kind === 'avi' ? q.base * av : q.base * f * drive, e = q.e;
      if (q.brake && lamp > 0) { I = q.base * f * (drive + (BRAKE_I - drive) * lamp); e = _brakeC.copy(q.e).lerp(BRAKE_RED, lamp); }
      B[q.o] = e.r * I; B[q.o + 1] = e.g * I; B[q.o + 2] = e.b * I;
    }
  }

  // A distance level for the big static meshes, by meshoptimizer with the error in metres: used only where its error
  // stays under ~0.6 px on screen (setLod; 2 cm: beyond ~40 m at 1440p). It shares the full mesh's vertex buffers -
  // only the index differs - and keeps its normals, UVs and seams; the atlas's UV seams hold it at about half the
  // triangles (a 7 cm level kept 98 % of those and faceted the nacelle rims - shown up close it read as "destroyed").
  buildLods(errs = [0.02]) {
    this.lods = [];
    this.lodErr = errs;
    this.model.traverse((o) => {
      const g = o.isMesh && o.userData.parts == null && o.geometry;
      if (!g || !g.index || g.index.count < 9000) return;
      const idx = g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array);
      const pos = g.attributes.position.array, levels = [g];
      if (!g.boundingSphere) g.computeBoundingSphere();
      for (const e of errs) {
        const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(idx.length / 3 * 0.02) * 3, e, ['ErrorAbsolute']);
        const l = new THREE.BufferGeometry();
        for (const k in g.attributes) l.setAttribute(k, g.attributes[k]);
        l.setIndex(new THREE.BufferAttribute(out, 1));
        l.boundingSphere = g.boundingSphere.clone();
        levels.push(l);
      }
      this.lods.push({ name: o.name, mesh: o, levels });
    });
    // the atlases: part by part (on its own vertices), the same rule - a part under 9000 indices stays whole
    for (const pm of this.partMeshes || []) {
      const G = pm.G;
      if (G.levels.length === 1) {
        const P = G.attrs.position.array, I0 = G.levels[0].array;
        for (const e of errs) {
          const outs = [], cum = [0];
          for (const p of G.parts) {
            let ix = I0.subarray(p.i0, p.i0 + p.ni);
            if (p.ni >= 9000) {
              const [out] = MeshoptSimplifier.simplify(Uint32Array.from(ix, (x) => x - p.v0), P.slice(p.v0 * 3, (p.v0 + p.nv) * 3), 3,
                Math.floor(p.ni / 3 * 0.02) * 3, e, ['ErrorAbsolute']);
              ix = Uint32Array.from(out, (x) => x + p.v0);
            }
            outs.push(ix);
            cum.push(cum[cum.length - 1] + ix.length);
          }
          const all = new Uint32Array(cum[cum.length - 1]);
          outs.forEach((a, j) => all.set(a, cum[j]));
          G.levels.push(new THREE.BufferAttribute(all, 1));
          G.cum.push(cum);
        }
      }
      pm.levels = G.levels.map((idx, k) => pm.levels[k] || partsGeometry(G, idx));
      this.lods.push({ name: pm.mesh.name, mesh: pm.mesh, levels: pm.levels, parts: true });
    }
    this.lodMeshes = this.lods;
    this.lodTris = [0, 1].map((k) => this.lods.reduce((n, l) => n + l.levels[k].index.count / 3, 0));
  }

  // the coarsest level whose error stays under 0.6 px at this distance (focalPx: the drawing height / 2 tan(fov / 2))
  setLod(dist, focalPx) {
    const errs = this.lodErr || [];
    let k = 0;
    // no screen scale (a caller passing something else): full detail - a wrong one showed a coarse hull up close
    if (!(focalPx > 100)) focalPx = Infinity;
    const px = focalPx / Math.max(dist, 1);
    for (const p of this.details || []) {
      const on = p.w * px >= p.thr;
      if (on !== p.on) { p.on = on; if (on) p.mesh.layers.enable(0); else p.mesh.layers.disable(0); }
    }
    for (let i = 0; i < errs.length; i++) if ((errs[i] * focalPx) / Math.max(dist, 1) < 0.6) k = i + 1;
    // an atlas: its parts still on are the front of its index (widest first) - drawn up to there; none: off (layer 0)
    for (const pm of this.partMeshes || []) {
      let c = 0;
      for (const p of pm.G.parts) { if (p.cull && !(p.w * px >= p.thr)) break; c++; }
      const kk = Math.min(k, pm.levels.length - 1), g = pm.levels[kk];
      if (c === pm.c && kk === pm.k && pm.mesh.geometry === g) continue;
      if (c !== pm.c) { if (c) pm.mesh.layers.enable(0); else pm.mesh.layers.disable(0); }
      pm.c = c; pm.k = kk;
      pm.mesh.geometry = g;
      g.setDrawRange(0, pm.G.cum[kk][c]);
    }
    if (k === this.lod) return;
    this.lod = k;
    for (const l of this.lodMeshes) if (!l.parts) l.mesh.geometry = l.levels[k];
  }

  // The GLB's baked material as a physical one: the paint gets the clear coat the Cycles look has (masked off the
  // metal by the ORM's metal channel), every texture gets full anisotropic filtering (GLTFLoader leaves it at 1, and
  // the hull smeared to mush at grazing angles).
  upgradeMaterials(maxAniso, renderer = null) {
    const old = this.mats.RacerBaked;
    if (old) {
      const nm = renderer && old.normalMap && old.normalMap.image?.width ? rgNormalMap(renderer, old.normalMap) : old.normalMap;
      const m = new THREE.MeshPhysicalMaterial({
        map: old.map, normalMap: nm, normalScale: old.normalScale.clone(), aoMap: old.aoMap,
        roughnessMap: old.roughnessMap, metalnessMap: old.metalnessMap, roughness: old.roughness,
        metalness: old.metalness, clearcoat: Q.lite ? 0 : 0.25, clearcoatRoughness: 0.24,
      });
      m.name = 'RacerBaked';
      m.userData.clearcoat = 0.25;                     // (Laptop mode drops it: quality.js setLite)
      const rg = !!nm?.userData.rg;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>',
          '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= clamp(1.0 - metalnessFactor, 0.0, 1.0);\n#endif');
        if (rg) sh.fragmentShader = rgNormalChunk(sh.fragmentShader);
      };
      m.customProgramCacheKey = () => (rg ? 'feather-hull-rg' : 'feather-hull');
      releaseAfterUpload(m.map); releaseAfterUpload(m.aoMap); releaseAfterUpload(m.roughnessMap); releaseAfterUpload(m.metalnessMap);
      this.model.traverse((o) => { if (o.isMesh && o.material === old) o.material = m; });
      old.dispose();
      this.mats.RacerBaked = m;
    }
    for (const mat of Object.values(this.mats)) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (mat[k]) { mat[k].anisotropy = maxAniso; mat[k].needsUpdate = true; }
      }
    }
  }

  paint(team) {
    const m = this.mats.RacerBaked;
    const A = new THREE.Color(...team.livery), B = new THREE.Color(...team.body);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.teamA = { value: A };
      sh.uniforms.teamB = { value: B };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 teamA;\nuniform vec3 teamB;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + TEAM_GLSL)
        .replace('#include <lights_physical_fragment>',
          '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= clamp(1.0 - metalnessFactor, 0.0, 1.0);\n#endif');
      if (m.normalMap?.userData.rg) sh.fragmentShader = rgNormalChunk(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => (m.normalMap?.userData.rg ? 'feather-team-rg' : 'feather-team');
    m.needsUpdate = true;
  }

  // A triangle whose UVs collapse to zero area exports a zero tangent; the normal-mapped shading normalises it into
  // NaN, and the bloom pass blew those few pixels up into a black square behind the engines (9 hull vertices).
  // Give each such vertex any unit tangent perpendicular to its normal.
  repairTangents() {
    let fixed = 0;
    const n = new THREE.Vector3(), t = new THREE.Vector3(), a = new THREE.Vector3();
    this.model.traverse((o) => {
      const T = o.isMesh && o.geometry.attributes.tangent, N = o.isMesh && o.geometry.attributes.normal;
      if (!T || !N) return;
      for (let i = 0; i < T.count; i++) {
        t.set(T.getX(i), T.getY(i), T.getZ(i));
        const l = t.length();
        if (l > 0.5 && Number.isFinite(l) && Number.isFinite(T.getW(i))) continue;
        n.fromBufferAttribute(N, i).normalize();
        a.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
        t.crossVectors(a, n).normalize();
        T.setXYZW(i, t.x, t.y, t.z, 1);
        fixed++;
      }
      T.needsUpdate = true;
    });
    this.tangentsFixed = fixed;
  }

  // extreme points of the hull in 26 directions (collision probes) and the vortex anchors at the tips
  measure() {
    const dirs = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
      if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
    const best = dirs.map(() => -1e9), pts = dirs.map(() => new THREE.Vector3());
    const v = new THREE.Vector3();
    let maxX = -1e9;
    const tipCandidates = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        for (let k = 0; k < dirs.length; k++) {
          const d = v.dot(dirs[k]);
          if (d > best[k]) { best[k] = d; pts[k].copy(v); }
        }
        if (v.x > maxX - 0.05) {
          if (v.x > maxX) maxX = v.x;
          tipCandidates.push(v.clone());
        }
      }
    });
    this.probes = pts;
    this.bottom = best[dirs.findIndex((d) => d.y < -0.99)];      // origin to the lowest point (m)
    const tip = tipCandidates.filter((p) => p.x > maxX - 0.05).reduce((a, b) => (b.z > a.z ? b : a));
    this.tipR = tip.clone();
    this.tipL = tip.clone().setX(-tip.x);
    this.halfSpan = maxX;
    this.length = best[dirs.findIndex((d) => d.z > 0.99)] + best[dirs.findIndex((d) => d.z < -0.99)];
  }

  setEngine(on) {
    this.engineOn = on;
    if (on) this.canopyOpen = false;
  }

  toggleCanopy() {
    if (this.engineOn) return false;     // the canopy is locked shut while the engines run
    this.canopyOpen = !this.canopyOpen;
    return true;
  }

  get ready() { return this.engineOn && this.power > 0.65 && this.canopyT < 0.02; }

  update(dt, ctrl, scene, camera) {
    this.t += dt;
    // start: avionics first, the reactor and rotors spool up over ~3 s; shut down: 4 s spool-down
    const on = this.engineOn;
    this.avionics = clamp(this.avionics + (on ? dt / 0.8 : -dt / 1.5), 0, 1);
    const pTarget = on && this.canopyT < 0.35 ? 1 : 0;
    this.power = clamp(this.power + (pTarget ? dt / 3.0 : -dt / 4.0), 0, 1);
    this.spin = ease(this.power);
    // canopy: 1.6 s each way, eased
    this.canopyT = clamp(this.canopyT + (this.canopyOpen ? dt : -dt) / 1.6, 0, 1);
    if (this.canopy) {
      const a = THREE.MathUtils.degToRad(this.canopy.deg) * ease(this.canopyT);
      this.canopy.node.quaternion.copy(this.canopy.base).multiply(new THREE.Quaternion().setFromAxisAngle(this.canopy.axis, a));
    }
    // rotors: the 24-blade fans and turbines stay under ~1.2 rev/s so the blades never strobe (wagon-wheel) at 60 Hz
    const thr = ctrl.throttle, boost = ctrl.boost;
    // (a rotor with a spool time has inertia: it starts turning slowly as the engine starts, then runs faster with the
    // throttle, the speed and the boost - the rocket's nozzle rotor. Never past 7.5 deg a frame: beyond half its 20 deg
    // tooth spacing the 18 teeth strobe and the spin reads backwards, so how fast it can look depends on the frame rate)
    const thr1 = clamp(thr, 0, 1), boost1 = clamp(boost + this.boostKick, 0, 1), sp = smoothstep(30, 340, ctrl.speed || 0);
    for (const r of this.rotors) {
      if (r.spool) {
        const target = Ship.nozzleMotion === false ? 0 : this.spin * (r.idle + 0.35 * thr1 + 1.1 * sp + 0.8 * boost1);
        r.w += (target - r.w) * (1 - Math.exp(-dt / (this.power < 0.99 ? r.spool : r.spool * 0.3)));
        r.angle += Math.min(r.rps * r.w, 7.5 / 360 / Math.max(dt, 1 / 360)) * 2 * Math.PI * dt;
      } else r.angle += r.rps * 2 * Math.PI * this.spin * (1 + 0.15 * thr + 0.05 * boost) * dt;
      r.node.quaternion.copy(r.base).multiply(_lq.setFromAxisAngle(r.axis, r.angle));
    }
    // the nozzle's teeth: folded out with the engine off, closing in as it starts; running, they fan out under the brake
    // (an air brake) and pull in tight on the throttle and the boost, a little open when coasting - eased, never snapping
    if (this.folds.length) {
      const run = ease(clamp((this.power - 0.05) / 0.7, 0, 1));
      const want = Ship.nozzleMotion === false ? 0
        : 1 - run * (1 - clamp(0.9 * (ctrl.brake ?? ctrl.brakeLight ?? 0) + 0.25 * (1 - thr1) * (1 - boost1), 0, 1));
      this.foldK = (this.foldK ?? 1) + (want - (this.foldK ?? 1)) * (1 - Math.exp(-dt / 0.16));
      for (const f of this.folds) f.node.quaternion.copy(f.base).multiply(_lq.setFromAxisAngle(f.axis, THREE.MathUtils.degToRad(f.deg) * this.foldK));
    }
    // the side exits' hot air: with the engine running, rising with speed and throttle
    // ("way more powerful": as strong as the main engine's at full throttle and spreading wider and further behind -
    // the pass caps every bend at the main engine's own, so the engine's shimmer is as it was)
    if (this.vents.length) this.ventHeat = this.power * smoothstep(5, 110, ctrl.speed || 0) * (0.9 + 0.8 * thr1 + 0.9 * boost1);
    // glows
    const brake = ctrl.brake || 0;
    const drive = (0.85 + 0.45 * thr + 0.6 * boost + 0.5 * this.boostKick) * (1 - 0.45 * brake);
    for (const n of GLOWS) {
      if (!this.mats[n]) continue;
      this.mats[n].emissiveIntensity = this.glowBase[n] * (0.03 + 0.97 * this.spin) * drive;
    }
    for (const m of this.ringMats) m.emissiveIntensity = this.glowBase.EngineGlow * (0.03 + 0.97 * this.spin) * drive;
    const ringK = 0.03 + 0.97 * this.spin;
    for (const U of this.ringUs) U.ringK.value = ringK;
    if (this.partU && this.partU.ringK) this.partU.ringK.value = ringK;
    for (const n of AVIONICS) {
      if (this.mats[n]) this.mats[n].emissiveIntensity = this.glowBase[n] * ease(this.avionics);
    }
    for (const n of BAY_FILL) if (this.mats[n]) this.mats[n].emissiveIntensity = ease(this.avionics);
    // the brake lights: red with the brake (or what the caller says is braking), if the setting has them on
    const lamp = Ship.brakeLights !== false ? smoothstep(0.08, 0.6, ctrl.brakeLight ?? brake) : 0;
    if (this.partE.length) this.updateParts(0.03 + 0.97 * this.spin, drive, ease(this.avionics), lamp);     // (the same, atlased)
    // plumes and exhaust light
    const kick = Math.max(this.boostKick, this.accelKick * 0.6);   // a pad or a hard launch: the plumes flare, then settle
    // braking: the main jets collapse to a flicker, the retro-jets fire forward
    const thrust = this.spin * clamp(0.12 + thr * 0.75 + boost * 0.9 + kick * 1.1, 0, 2.4) * (1 - 0.8 * brake);
    for (const r of this.retros) r.update(this.t, this.spin * brake, 0.25 + 0.6 * brake, 0);
    for (const b of this.brakeLights) {
      b.visible = brake > 0.02 && this.power > 0.2;
      b.material.opacity = Math.min(1, brake * 1.2);
      b.scale.setScalar(0.7 + 0.5 * brake);
    }
    // differential thrust: in a turn the outer engine works harder (plumes[0] is the right nacelle, [1] the left)
    const st = clamp(ctrl.steer || 0, -1, 1);
    this.plumes.forEach((p, k) => p.update(this.t, this.spin, thrust * (k === 0 ? 1 - 0.4 * st : k === 1 ? 1 + 0.4 * st : 1), Math.min(1, boost + kick)));
    // a hint of blue on the road under the nozzles (220 cd painted the whole road blue)
    for (const l of this.exhaustLights) l.intensity = 30 * this.spin * (0.25 + thrust);
    this.animate(dt, ctrl);
    // light trails off every nozzle: on with speed and thrust, longer and brighter on boost
    this.ensureTrails(scene);
    const puffs = Ship.trailStyle !== 'ribbon';
    const tr = this.spin * smoothstep(60, 220, ctrl.speed) * (0.25 + 0.3 * clamp(thr, 0, 1) + 0.6 * clamp(boost + kick, 0, 1)) * (1 - 0.8 * brake);
    const nz = this._nz || (this._nz = new THREE.Vector3());
    this.plumes.forEach((pl, k) => {
      nz.copy(pl.outer.position).applyMatrix4(this.visual.matrixWorld);
      const width = pl.r * (0.2 + 0.12 * boost), life = 0.07 + 0.12 * clamp(boost + kick, 0, 1), b = clamp(boost + kick, 0, 1);
      if (puffs) this.exhaust.emit(k, nz, this.t, tr, width, life, b);
      else this.engineTrails[k].update(nz, this.t, tr, width, life, camera, b);
    });
    if (puffs) { this.exhaust.finish(this.t); for (const e of this.engineTrails) e.mesh.visible = false; }
    else if (this.exhaust.mesh.visible) { this.exhaust.clear(); this.exhaust.mesh.visible = false; }
    // vortex trails from both tips when fast and pulling
    const s = smoothstep(80, 150, ctrl.speed) * (0.2 + 0.8 * smoothstep(0.15, 0.9, ctrl.turn));
    const tip = this._tip || (this._tip = new THREE.Vector3());
    this.trails[0].update(tip.copy(this.tipR).applyMatrix4(this.root.matrixWorld), s, camera);
    this.trails[1].update(tip.copy(this.tipL).applyMatrix4(this.root.matrixWorld), s, camera);
  }

  // The animation layer on the visual group - never fed back to the physics:
  //  steering: banks into the turn with a little overshoot, the nose leads in, the body swings out on hard turns,
  //  airbrakes tip it further, the nose lifts under acceleration and on climbs, dips braking and diving;
  //  levitation: a slow float and rock when slow or parked, a fine magnetic buzz at speed, a dip and rebound on
  //  touchdown. Each axis is a spring (stiffness k, damping ratio z), so nothing snaps.
  animate(dt, c) {
    const a = (this.anim ||= { lean: 0, leanV: 0, yaw: 0, yawV: 0, sway: 0, swayV: 0, pitch: 0, pitchV: 0, lift: 0, liftV: 0,
      yawOff: 0, jolt: 0, hum: 0, t: Math.random() * 50 });
    const spring = (key, target, k, z) => {
      a[key + 'V'] += (k * (target - a[key]) - 2 * z * Math.sqrt(k) * a[key + 'V']) * dt;
      a[key] += a[key + 'V'] * dt;
    };
    const steer = c.steer || 0, air = c.airbrake || 0, P = this.power;
    const flying = clamp(c.air || 0, 0, 1);             // 0 on the deck .. 1 in the air (TrackRacer.airT)
    const lat = clamp((c.lat || 0) / 45, -1, 1), acc = clamp((c.accel || 0) / 40, -1, 1);
    // drifting: a small hop into it; the slide's angle is the physics' own, the lean no more than a turn's
    if (this.driftHop) { a.liftV += 1.6; a.pitchV += 0.25; this.driftHop = 0; }
    const dr = Math.abs(c.drift || 0);
    spring('lean', -((steer * 0.2 + lat * 0.12) * (1 - 0.4 * dr) + air * 0.1) * P, 34, 0.55);
    spring('yaw', -(steer * 0.06 * (1 - dr) + air * 0.04) * P, 28, 0.6);
    spring('sway', -lat * 0.35 * P, 20, 0.6);
    // braking dips the nose hard; a launch (throttle opening, strong acceleration) squats the tail; boost lifts the nose;
    // the hover's climb rate tips it on the deck (in the air the racer's attitude already follows the flight path)
    const br = c.brake || 0, bo = c.boost || 0;
    spring('pitch', (acc * 0.05 - br * 0.075 + bo * 0.035 + clamp((c.vy || 0) * 0.015, -0.12, 0.12) * (1 - flying)) * P, 22, 0.6);
    if ((c.accel || 0) > 25 && this.prevAccel <= 25) this.accelKick = 1;   // the moment it bites
    this.prevAccel = c.accel || 0;
    this.accelKick = Math.max(0, (this.accelKick || 0) - dt * 1.6);
    if (c.land) a.liftV -= Math.min(c.land, 30) * 0.09;
    spring('lift', 0, 60, 0.35);
    // the nose glancing off a wall turns the racer's heading in one physics step: the hull takes that turn over a
    // few frames instead of snapping (the offset decays away in ~0.2 s)
    if (c.yawKick) a.yawOff += c.yawKick;
    a.yawOff *= Math.exp(-14 * dt);
    a.t += dt;
    const t = a.t, slow = P * (1 - smoothstep(15, 70, c.speed)), fast = P * smoothstep(60, 200, c.speed) * (1 - flying);
    const bob = (Math.sin(t * 1.6) * 0.07 + Math.sin(t * 2.65 + 1.3) * 0.03) * slow;
    const buzz = (Math.sin(t * 47.0) + Math.sin(t * 31.3 + 2.0)) * 0.003 * fast;
    const rockZ = (Math.sin(t * 1.13) * 0.014 + Math.sin(t * 2.3 + 0.7) * 0.005) * slow;
    const rockX = Math.sin(t * 0.87 + 0.5) * 0.009 * slow;
    // a knock: the springs take the blow (hit()); the hull rattles a little after it, smooth and low (it was a 10 Hz
    // shake that read as stutter on every touch). Boost: a fine hum.
    a.jolt = Math.max(0, a.jolt - dt * 2.5);
    a.hum += ((bo > 0.5 ? bo : 0) - a.hum) * damp(6, dt);
    const j = a.jolt * a.jolt, hz = a.hum * 0.0018;
    const jx = (noise2(t * 6.0, 3.1) - 0.5) * 0.03 * j, jy = (noise2(t * 5.0, 8.7) - 0.5) * 0.025 * j;
    const jr = (noise2(t * 4.5, 1.9) - 0.5) * 0.02 * j;
    this.visual.position.set(a.sway + jx + Math.sin(t * 61.0) * hz, a.lift + bob + buzz + jy + Math.sin(t * 53.0 + 1.0) * hz, 0);
    this.visual.rotation.set(a.pitch + rockX, a.yaw + a.yawOff, a.lean + rockZ + jr, 'YXZ');
    // the low side stays clear of the deck however hard it leans ("when they steer the engines hit the ground"): the
    // hull's extreme points under this frame's rotation; the body rises by whatever the lowest would go under the deck
    // plus 30 cm. Visual only - the physics never sees it.
    if (c.height != null && this.probes) {
      _lq.setFromEuler(this.visual.rotation);
      let low = Infinity;
      for (const p of this.probes) low = Math.min(low, _lv.copy(p).applyQuaternion(_lq).y);
      const under = -(this.bottom + c.height) + 0.3 - (low + this.visual.position.y);
      if (under > 0) this.visual.position.y += under;
    }
    const su = this.shield.material.uniforms;
    su.time.value = t;
    su.amount.value = Math.max(0, su.amount.value - dt * 1.8);
    this.shield.visible = su.amount.value > 0.01;
    this.boostKick = Math.max(0, this.boostKick - dt * 1.4);
  }

  // a knock: the body is shoved along dir (ship frame, metres-ish) and shudders; the shield lights at the contact
  // point (also in the ship frame). Visual only.
  hit(dir, strength, at) {
    const a = this.anim;
    if (!a) return;
    const k = Math.min(1.5, strength) * (1 - 0.6 * a.jolt);           // knocks in quick succession don't pile up
    a.swayV += dir.x * 2.2 * k;
    a.leanV += -dir.x * 0.9 * k;          // rolls away from the side that was hit
    a.yawV += -dir.x * 0.35 * k + dir.z * 0.1 * k;
    a.pitchV += dir.z * 0.25 * k;
    a.jolt = Math.min(1, a.jolt + k * 0.6);
    // the shield answers in proportion to the blow; a weaker knock while it is still lit doesn't restart its wave
    // (grinding along a wall knocks every quarter second)
    const su = this.shield.material.uniforms, amt = Math.min(1, 0.2 + k * 0.7);
    if (at && amt > su.amount.value * 0.8) {     // root frame -> the shell's unit sphere
      su.hit.value.copy(at).sub(this.shield.position).divide(this.shield.scale);
      su.amount.value = amt;
    }
  }

  // every glow and effect object on the ship: additive light, never a surface - kept out of the AO pass (a brake
  // light missing from that list rendered as a black square)
  fxObjects() {
    return [...this.plumes, ...(this.retros || [])].flatMap((p) => [p.outer, p.inner, p.halo])
      .concat(this.brakeLights || [], this.shield ? [this.shield] : [], (this.trails || []).map((t) => t.mesh),
        (this.engineTrails || []).map((t) => t.mesh), this.exhaust ? [this.exhaust.mesh] : []);
  }

  // the hot gas behind each main engine, for the heat shimmer (post.js EngineHeatPass): add(nozzle, the flame's end,
  // the radius at the nozzle, how hot) - world space, the vectors reused
  heatSources(add) {
    const a = _hA, b = _hB, e = _hE;
    for (const p of this.plumes) {
      if (!p.outer.visible || !(p.heat > 0.02)) continue;
      p.outer.localToWorld(a.set(0, 0, 0));
      p.outer.localToWorld(b.set(0, 0, 1));
      p.outer.localToWorld(e.set(p.r * 1.02, 0, 0));
      add(a, b, e.distanceTo(a), p.heat);
    }
    if (this.ventHeat > 0.02) {           // the side exits: hot air streaming aft out of each
      for (const v of this.vents) {
        v.node.getWorldPosition(a);
        b.copy(v.dir).transformDirection(v.node.matrixWorld).multiplyScalar(v.len * VENT_REACH).add(a);
        add(a, b, v.r * VENT_WIDTH, this.ventHeat);
      }
    }
  }

  ensureTrails(scene) {
    if (!this.engineTrails) this.engineTrails = this.plumes.map(() => new EngineTrail(scene, this.engineColor));
    if (!this.exhaust) this.exhaust = new ExhaustTrail(scene, this.engineColor || new THREE.Color(0.12, 0.42, 1.0), this.plumes.length);
    if (!this.trails) this.trails = [new Trail(scene), new Trail(scene)];
  }

  clearTrails() { for (const t of [...(this.trails || []), ...(this.engineTrails || []), ...(this.exhaust ? [this.exhaust] : [])]) t.clear(); }
}
