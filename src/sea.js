// The water planet's air, sea and sky. Night over an ocean that covers the world: a great pale moon low in the north-
// north-east behind ragged storm cloud (the key light, cold silver), the last of the dusk a dark red band low in the
// west, the sea black-teal under a long swell running east-north-east.
// One model for everything seen through the air and the water (the fog chunk): above the sea a ray gathers the
// night's haze; below it the water swallows red first, then green - its murk teal, darker the deeper it is lit from.
// A lit material under the sea gets the moon's light and the sky's less the deeper it lies, rippled by caustics near
// the top: the drowned city lives by its own lamps.
// The surface: a camera-centred polar grid displaced by six Gerstner swells (vertex shader), two scrolling layers of
// fine ripples (a periodic wave sum baked once), the sky reflected, the moon's glade glittering on it, light through
// the crests, foam where they fold - and plankton glowing in it. Seen from below: the sky through Snell's window, the
// mirror of the deep outside it.
import * as THREE from 'three';
import { bakeLater } from './bake.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const SUN_DIR = new THREE.Vector3(0.42, 0.3, -0.86).normalize();     // toward the moon: north-north-east, ~17 deg up
export const SUN_E = 2.9;                                                   // its light (three units)
export const SUN_COL = new THREE.Color(0.6, 0.72, 1.0);                     // cold silver
export const SEA_Y = 0;                                                     // the mean sea level
const WIND = new THREE.Vector2(0.86, -0.51).normalize();                    // where the swell runs (east-north-east)

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(7)));
const v3 = (v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

// ---------------------------------------------------------------- the swell
// six Gerstner waves: wavelength (m), height (m), turn off the wind (deg); steepness shared out so no crest loops
const G = 9.81, STEEP = 0.62;
export const WAVES = [[150, 1.5, 0], [92, 0.85, 19], [58, 0.52, -26], [35, 0.3, 41], [21, 0.17, -38], [12.5, 0.09, 63]].map(([L, A, deg], i) => {
  const a = THREE.MathUtils.degToRad(deg), k = (2 * Math.PI) / L;
  const D = new THREE.Vector2(WIND.x * Math.cos(a) - WIND.y * Math.sin(a), WIND.x * Math.sin(a) + WIND.y * Math.cos(a));
  return { D, k, A, Q: STEEP / (k * A * 6), w: Math.sqrt(G * k), ph: i * 1.7 + 0.4 };
});

// the displacement of the undisplaced point (x, z) at time t
const _d = new THREE.Vector3();
export function waveDisp(x, z, t, out = _d) {
  out.set(0, 0, 0);
  for (const W of WAVES) {
    const ph = W.k * (W.D.x * x + W.D.y * z) - W.w * t + W.ph, c = Math.cos(ph), s = Math.sin(ph);
    out.x += W.Q * W.A * W.D.x * c; out.z += W.Q * W.A * W.D.y * c; out.y += W.A * s;
  }
  return out;
}
// the water's height over (x, z) at time t (the displaced surface: its source point found by iterating)
export function waveHeight(x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 4; i++) { waveDisp(px, pz, t); px = x - _d.x; pz = z - _d.z; }
  return SEA_Y + waveDisp(px, pz, t).y;
}

// ---------------------------------------------------------------- the air and the water (every lit material)
const KW = [0.012, 0.0062, 0.0046];       // the water's extinction (per m): clear - the city's lights show from far off
const KD = [0.1, 0.034, 0.025];           // how fast the light from above fades with depth (per m of depth)
const MURK = [0.004, 0.022, 0.03];        // the murk's own radiance near the top, in equilibrium (dark teal)
export const SEA_GLSL = /* glsl */`
#ifndef SE_DEFINED
#define SE_DEFINED
const vec3 SE_SUN = ${v3(SUN_DIR)};
const vec3 SE_SUNRAD = vec3(${f(SUN_E * SUN_COL.r)}, ${f(SUN_E * SUN_COL.g)}, ${f(SUN_E * SUN_COL.b)});
const vec3 SE_KW = vec3(${KW.map(f).join(', ')});
const vec3 SE_KD = vec3(${KD.map(f).join(', ')});
const vec3 SE_MURK = vec3(${MURK.map(f).join(', ')});
const float SE_Y = ${f(SEA_Y)};
// the deep's own glow (the drowned city's light scattered through the water), and the fill it throws on what is down there
const vec3 SE_DEEP = vec3(0.004, 0.02, 0.045);
const vec3 SE_FILL = vec3(0.012, 0.045, 0.085);
const float SE_HA = 360.0;          // the night haze's scale height (m)
const float SE_BA = 1.5e-4;         // its extinction over the sea (per m)
// the optical depth of a density exp(-y / H) along o + d t, t in [0, dist]
float seExp(float oy, float dy, float dist, float H) {
  float a = exp(-max(oy, -50.0) / H), k = clamp(dy * dist / H, -60.0, 60.0);
  return abs(k) < 1e-4 ? a * dist : a * H / dy * (1.0 - exp(-k));
}
// the night sky's own light along d (no moon disc): near-black overhead, a dark blue-grey band over the sea, the moon's
// glow round it, the dusk's last red low in the west
vec3 seGlow(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(vec3(0.03, 0.042, 0.07), vec3(0.005, 0.007, 0.015), pow(h, 0.45));
  float mu = max(dot(d, SE_SUN), 0.0);
  c += SE_SUNRAD * (0.006 * pow(mu, 5.0) + 0.03 * pow(mu, 48.0));
  vec2 dh = d.xz / max(length(d.xz), 1e-4);
  float west = max(dot(dh, vec2(-0.93, 0.36)), 0.0);
  c += vec3(0.07, 0.014, 0.02) * pow(west, 3.0) * exp(-h / 0.07);
  return c;
}
// along o + d t (t < dist) through the air: transmittance and the light picked up
void seAir(vec3 o, vec3 d, float dist, out vec3 T, out vec3 L) {
  float od = SE_BA * seExp(o.y - SE_Y, d.y, dist, SE_HA);
  T = exp(-od * vec3(0.9, 1.0, 1.1));
  L = seGlow(normalize(vec3(d.x, max(d.y, 0.0), d.z))) * (1.0 - T);
}
// through the water (o under the sea): the light from above at depth z falls as exp(-KD z); the murk scatters it -
// the integral along the ray in closed form, a little more looking up toward the moon's light coming down
void seWater(vec3 o, vec3 d, float dist, out vec3 T, out vec3 L) {
  float z0 = max(SE_Y - o.y, 0.0);
  vec3 a = SE_KD * d.y - SE_KW;                         // (always < 0: the water dims faster than the depth darkens)
  T = exp(-SE_KW * dist);
  float ph = 1.0 + 1.8 * pow(max(dot(d, normalize(SE_SUN * vec3(0.75, 1.0, 0.75))), 0.0), 6.0);
  L = SE_MURK * SE_KW * ph * exp(-SE_KD * z0) * (exp(a * dist) - 1.0) / a;
  float zm = SE_Y - (o.y + d.y * dist * 0.5);
  L += SE_DEEP * smoothstep(60.0, 260.0, zm) * (1.0 - T);
}
// how much of a light at p reaches the camera at o through the air and the water (lvl: the sea at the camera)
vec3 seTrans(vec3 o, vec3 p, float lvl) {
  vec3 r = p - o, T, L;
  float dist = length(r);
  vec3 d = r / max(dist, 1e-3);
  float s = abs(d.y) > 1e-5 ? (lvl - o.y) / d.y : -1.0;
  bool cross = s > 0.0 && s < dist;
  if (o.y < lvl) return cross ? exp(-SE_KW * s) : exp(-SE_KW * dist);
  return cross ? exp(-SE_KW * (dist - s)) : vec3(1.0);
}
// the moon's light reaching depth z under the sea (its ray bent steeper going in), rippled by caustics near the top
float seCaustic(vec2 p, float t) {
  float c = sin(dot(p, vec2(0.21, 0.13)) + t * 0.9 + 1.6 * sin(dot(p, vec2(-0.07, 0.17)) + t * 0.6))
    + sin(dot(p, vec2(-0.16, 0.19)) - t * 0.8 + 1.6 * sin(dot(p, vec2(0.15, 0.05)) - t * 0.5))
    + sin(dot(p, vec2(0.05, -0.24)) + t * 0.7 + 1.6 * sin(dot(p, vec2(0.11, -0.13)) + t * 0.45));
  float net = pow(1.0 - abs(c) / 3.0, 7.0);
  return 0.62 + 2.6 * net;
}
vec3 seSunUnder(vec3 w, float t) {
  float z = SE_Y - w.y;
  if (z <= 0.0) return vec3(1.0);
  float cy = sqrt(1.0 - (1.0 - SE_SUN.y * SE_SUN.y) / 1.777);
  float near = exp(-z / 18.0) * (1.0 - smoothstep(60.0, 140.0, distance(w, cameraPosition)));
  return exp(-SE_KD * z / cy) * mix(1.0, seCaustic(w.xz, t), near * smoothstep(0.0, 1.5, z));
}
vec3 seSkyUnder(vec3 w) {
  float z = SE_Y - w.y;
  return z <= 0.0 ? vec3(1.0) : exp(-SE_KD * z * 1.3) * mix(vec3(1.0), vec3(0.35, 0.85, 1.0), smoothstep(0.0, 6.0, z));
}
#endif
`;

// the fog chunk for every lit material: the air and the water between the camera and the pixel, split where the ray
// meets the sea (its level at the camera, the swell there: fogColor.b; the clock: fogColor.g). Seen from under the sea,
// what is above it gets only the air beyond the surface here - the surface itself brings the water's share (Ocean).
export const SEA_FOG_CHUNK = /* glsl */`#ifdef USE_FOG
	{
		vec3 fogO = cameraPosition, fogRay = vFogWorld - fogO;
		float fogDist = length( fogRay );
		vec3 fogDir = fogRay / max( fogDist, 1e-3 ), fogT, fogL;
		float fogLvl = fogColor.b, fogS = abs( fogDir.y ) > 1e-5 ? ( fogLvl - fogO.y ) / fogDir.y : -1.0;
		bool fogCross = fogS > 0.0 && fogS < fogDist;
		if ( fogO.y < fogLvl ) {
			if ( fogCross ) {
				seAir( fogO + fogDir * fogS, fogDir, fogDist - fogS, fogT, fogL );
			} else {
				seWater( fogO, fogDir, fogDist, fogT, fogL );
			}
			gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
		} else {
			if ( fogCross ) {
				seWater( fogO + fogDir * fogS, fogDir, fogDist - fogS, fogT, fogL );
				gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
				seAir( fogO, fogDir, fogS, fogT, fogL );
			} else {
				seAir( fogO, fogDir, fogDist, fogT, fogL );
			}
			gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
		}
	}
#endif`;

// Under the sea the moon's light (the first directional light: the cascades' others carry no light) and the sky's
// fade with depth, every lit material alike; lamps and the ships' lights are untouched. Before any lit material compiles.
export function seaLight() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes('seSunUnder')) return;
  const a = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!C.lights_fragment_begin.includes(a)) throw new Error('lights chunk changed: sea light not applied');
  C.lights_fragment_begin = C.lights_fragment_begin.replace(a, a + `
		#ifdef USE_FOG
		directLight.color *= seSunUnder( vFogWorld, fogColor.g );
		#endif`);
  C.lights_fragment_end = `#ifdef USE_FOG
{
	vec3 seAmb = seSkyUnder( vFogWorld );
	irradiance *= seAmb;
	iblIrradiance *= seAmb;
	// deep down, the city's light all round: a blue fill (shapes read against the dark)
	vec3 seFill = SE_FILL * smoothstep( 50.0, 220.0, SE_Y - vFogWorld.y );
	irradiance += seFill;
	#if defined( RE_IndirectSpecular )
		radiance = radiance * seAmb + seFill * 0.35;
		clearcoatRadiance *= seAmb;
	#endif
}
#endif
` + C.lights_fragment_end;
}

// ---------------------------------------------------------------- the sky
const SKY_GLSL = /* glsl */`
float skH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float skN(vec2 x) {
  vec2 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(skH(i), skH(i + vec2(1, 0)), u.x), mix(skH(i + vec2(0, 1)), skH(i + vec2(1, 1)), u.x), u.y);
}
float skF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * skN(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// the cloud deck over d (d.y > 0): cover, and how lit its edge is by the moon behind it
vec2 skCloud(vec3 d) {
  vec2 uv = d.xz / (d.y + 0.07);
  float mu = max(dot(d, SE_SUN), 0.0);
  float n = skF(uv * 0.85 + vec2(3.0, 1.0)), m = skF(uv * 2.6 + 11.0);
  // a gap round the moon, ragged; heavier toward the south and low down
  float cover = smoothstep(0.38, 0.66, n + 0.18 * m + 0.22 * (1.0 - d.y) - 0.42 * pow(mu, 7.0) + 0.08 * d.z);
  float edge = smoothstep(0.0, 0.5, cover) * (1.0 - smoothstep(0.55, 1.0, cover));
  return vec2(cover * smoothstep(0.0, 0.04, d.y), edge);
}
vec3 skSky(vec3 d) {
  vec3 c = seGlow(d);
  float h = max(d.y, 0.0), mu = max(dot(d, SE_SUN), 0.0);
  // stars where the cloud breaks, fewer near the moon and the horizon
  vec3 sd = d * 420.0, si = floor(sd);
  float st = skH(si.xy + si.z * 17.31), sb = skH(si.yz + 3.7);
  vec3 sp = fract(sd) - 0.5;
  float star = step(0.985, st) * smoothstep(0.32, 0.0, length(sp)) * (0.4 + 2.0 * sb * sb);
  c += vec3(0.55, 0.62, 0.8) * star * smoothstep(0.03, 0.25, h) * (1.0 - smoothstep(0.6, 0.98, mu));
  vec2 cl = skCloud(d);
  // the cloud: dark, its body faintly lit, its edges silver toward the moon
  vec3 cloud = vec3(0.01, 0.013, 0.02) + SE_SUNRAD * (0.006 * pow(mu, 3.0) + (0.02 + 0.5 * cl.y) * pow(mu, 22.0));
  return mix(c, cloud, cl.x);
}`;

// the dome's bake: rgb the sky's light, a how much of what lies beyond (the moon) it hides. Below the horizon a ray
// ends on the far sea seen from 25 m up: the sky mirrored at a grazing angle, the deep's murk, the haze between.
const DOME_BAKE = /* glsl */`
  varying vec3 vDir;
  ${SEA_GLSL}
  ${SKY_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    if (d.y < -1e-4) {
      float dist = min(25.0 / -d.y, 3e5);
      vec3 r = vec3(d.x, -d.y, d.z), T, L;
      float F = 0.02 + 0.98 * pow(1.0 - min(-d.y * 3.0, 1.0), 5.0);
      vec3 c = skSky(r) * F + SE_MURK * 0.6 * (1.0 - F);
      seAir(vec3(0.0, SE_Y + 25.0, 0.0), d, dist, T, L);
      gl_FragColor = vec4(c * T + L, 1.0);
      return;
    }
    vec3 c = skSky(d);
    float hide = max(skCloud(d).x * 0.97, 1.0 - exp(-SE_BA * SE_HA / max(d.y, 0.01)));
    gl_FragColor = vec4(c, hide);
  }`;

export function seaSkyDome(renderer, size = 768) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const geo = new THREE.SphereGeometry(100000, 96, 48);
  const bakeScene = new THREE.Scene(), cube = new THREE.CubeCamera(10, 200000, rt);
  bakeScene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: DOME_BAKE })));
  bakeLater([[bakeScene, cube.children[0]]], () => {
    cube.update(renderer, bakeScene);
    bakeScene.children[0].material.dispose();
  });
  // drawn over what lies beyond the air (the moon): dimmed by how much the cloud and haze hide it, their light added.
  // Under the sea: what would be seen past the surface's reach (rays a hair off level) is the deep's murk
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { sky: { value: rt.texture }, under: { value: 0 }, flashDir: { value: new THREE.Vector3(0, 0.1, 1) }, flashK: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform samplerCube sky; uniform float under, flashK; uniform vec3 flashDir; varying vec3 vDir;
      ${SEA_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec4 a = textureCube(sky, d);
        if (under > 0.0 && d.y < under / 24000.0) { gl_FragColor = vec4(SE_MURK * 0.5 * exp(-SE_KD * under), 1.0); return; }
        // a lightning flash: the cloud round it lit from inside, the sky round it a little
        if (flashK > 0.0) {
          float m = max(dot(d, normalize(flashDir)), 0.0);
          a.rgb += vec3(0.55, 0.6, 0.9) * flashK * (pow(m, 40.0) * 1.6 + pow(m, 10.0) * 0.35) * a.a;
        }
        gl_FragColor = a;
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.userData.cube = rt.texture;
  return mesh;
}

// ---------------------------------------------------------------- the surface
// the ripples: a periodic sum of waves on integer wave vectors (one tile repeats seamlessly): rg its slope, b its
// height, a a foam-breaking noise
const DETAIL_BAKE = /* glsl */`
  varying vec2 vUv;
  float h1(float n) { return fract(sin(n * 12.9898 + 1.7) * 43758.5453); }
  void main() {
    vec2 p = vUv * 6.2831853;
    float h = 0.0, fo = 0.0; vec2 g = vec2(0.0);
    for (int i = 0; i < 48; i++) {
      float fi = float(i);
      vec2 kv = floor(vec2(h1(fi * 1.7), h1(fi * 3.1 + 0.5)) * 25.0) - 12.0;
      if (dot(kv, kv) < 1.0) continue;
      float kl = length(kv), along = max(dot(kv / kl, vec2(0.86, -0.51)), -0.2);
      float amp = (0.5 + 0.5 * h1(fi * 5.3)) * pow(kl, -1.55) * (0.35 + 0.65 * along * along);
      float ph = dot(kv, p) + h1(fi * 7.7) * 6.2831853;
      h += amp * sin(ph); g += amp * kv * cos(ph);
    }
    for (int i = 0; i < 24; i++) {
      float fi = float(i) + 60.0;
      vec2 kv = floor(vec2(h1(fi * 1.3), h1(fi * 2.9)) * 61.0) - 30.0;
      fo += sin(dot(kv, p) + h1(fi * 4.1) * 6.2831853) / max(length(kv), 1.0);
    }
    gl_FragColor = vec4(clamp(g * 0.045 + 0.5, 0.0, 1.0), clamp(h * 0.18 + 0.5, 0.0, 1.0), clamp(fo * 0.35 + 0.5, 0.0, 1.0));
  }`;

function rippleTexture(renderer) {
  const rt = new THREE.WebGLRenderTarget(512, 512, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false });
  rt.texture.anisotropy = 8;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: DETAIL_BAKE })));
  bakeLater([[scene, cam]], () => {
    const keep = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(keep);
    scene.children[0].material.dispose();
  });
  return rt.texture;
}

// the grid: rings out from the camera, ~0.5 m apart under it to ~1 km at the horizon (30 km), 256 round
function polarGrid(NR = 170, NA = 256) {
  const pos = [], sp = [], idx = [];
  const r = (u) => 10 * (Math.exp(8 * u) - 1);
  for (let i = 0; i <= NR; i++) {
    const R = r(i / NR), S = Math.max(r((i + 1) / NR) - R, (2 * Math.PI * R) / NA);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      pos.push(Math.cos(a) * R, 0, Math.sin(a) * R); sp.push(S);
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSpace', new THREE.Float32BufferAttribute(sp, 1));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor(renderer, skyCube) {
    const wa = WAVES.map((W) => new THREE.Vector4(W.D.x, W.D.y, W.k, W.A)), wb = WAVES.map((W) => new THREE.Vector4(W.Q, W.w, W.ph, 0));
    this.U = { seCenter: { value: new THREE.Vector3() }, seTime: { value: 0 }, seWaveA: { value: wa }, seWaveB: { value: wb },
      seSky: { value: skyCube }, seDetail: { value: rippleTexture(renderer) }, seBio: { value: 1 },
      seRings: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -1e6, 0)) },
      seLP: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, -1e5, 0, 0)) }, seLC: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) },
      seRefl: { value: null }, seReflM: { value: new THREE.Matrix4() }, seReflOn: { value: 0 } };
    // the mirror: the scene drawn from the camera reflected in the sea's mean level, at half size (Ocean.reflect)
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.U.seRefl.value = this.rt.texture;
    this.mcam = new THREE.PerspectiveCamera();
    this.mskyCam = new THREE.PerspectiveCamera();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, side: THREE.DoubleSide, transparent: true, depthWrite: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: /* glsl */`
        uniform vec3 seCenter; uniform float seTime; uniform vec4 seWaveA[6], seWaveB[6];
        attribute float aSpace;
        varying vec3 vW; varying vec3 vN0; varying float vJac; varying float vCrest;
        void main() {
          vec2 xz = seCenter.xz + position.xz;
          vec3 disp = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
          float jac = 1.0;
          for (int i = 0; i < 6; i++) {
            vec4 a = seWaveA[i], b = seWaveB[i];
            // (a wave finer than ~4 grid steps here is left out: it would alias into a shimmer)
            float k = a.z, A = a.w * clamp(6.2831853 / k / (aSpace * 4.0) - 0.5, 0.0, 1.0);
            float ph = k * dot(a.xy, xz) - b.y * seTime + b.z, c = cos(ph), s = sin(ph);
            disp.xz += b.x * A * a.xy * c; disp.y += A * s;
            n.xz -= a.xy * k * A * c; n.y -= b.x * k * A * s;
            jac -= b.x * k * A * s;
          }
          vW = vec3(xz.x + disp.x, ${f(SEA_Y)} + disp.y, xz.y + disp.z);
          vN0 = n; vJac = jac; vCrest = disp.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform samplerCube seSky; uniform sampler2D seDetail; uniform float seTime, seBio; uniform vec4 seRings[16]; uniform vec4 seLP[12]; uniform vec3 seLC[12];
        uniform sampler2D seRefl; uniform mat4 seReflM; uniform float seReflOn;
        varying vec3 vW; varying vec3 vN0; varying float vJac; varying float vCrest;
        ${SEA_GLSL}
        void main() {
          vec3 V = cameraPosition - vW;
          float dist = length(V);
          V /= dist;
          vec3 Ng = normalize(vN0);
          // the ripples: two layers drifting across each other, fading out far off (their mips flatten them anyway)
          vec4 r1 = texture2D(seDetail, vW.xz / 41.0 + seTime * vec2(0.012, -0.007));
          vec4 r2 = texture2D(seDetail, vW.xz / 14.0 + seTime * vec2(-0.009, -0.018));
          float far = smoothstep(120.0, 2600.0, dist);
          vec2 sl = ((r1.xy - 0.5) * 0.9 + (r2.xy - 0.5) * 0.6) * (1.0 - 0.75 * far);
          vec3 N = normalize(Ng + vec3(sl.x, 0.0, sl.y));
          float foamN = r1.a * 0.55 + r2.a * 0.45;
          float foam = smoothstep(0.62, 0.2, vJac) * smoothstep(0.42, 0.7, foamN);
          // rings spreading where something broke the sea (a leap, a splash, a ship going in): foam, and the plankton lit
          float ringK = 0.0;
          for (int i = 0; i < 16; i++) {
            vec4 rg = seRings[i];
            float age = seTime - rg.z;
            if (age < 0.0 || age > 7.0) continue;
            float d = distance(vW.xz, rg.xy), rad = 1.5 + age * (3.0 + rg.w * 0.35), w = 0.6 + rg.w * 0.12 + age * 0.4;
            float band = exp(-pow((d - rad) / w, 2.0)) + 0.7 * exp(-pow((d - rad * 0.62) / (w * 0.8), 2.0));
            ringK += band * (1.0 - smoothstep(1.5, 7.0, age)) * smoothstep(0.0, 0.2, age) + (1.0 - smoothstep(0.0, rad * 0.7 + 2.0, d)) * (1.0 - smoothstep(0.0, 2.5, age)) * 0.9;
          }
          foam = max(foam, clamp(ringK * 0.7, 0.0, 0.8) * smoothstep(0.4, 0.62, foamN + 0.1));
          // plankton: points of cyan where the foam churns, flaring and fading
          float spark = smoothstep(0.78, 0.98, fract(r2.b * 7.0 + r1.a * 3.0 + seTime * 0.35)) * smoothstep(0.55, 0.85, foamN);
          float bloom = smoothstep(0.58, 0.82, texture2D(seDetail, vW.xz / 1900.0 + seTime * 0.0008).b * 0.6 + texture2D(seDetail, vW.xz / 700.0 - seTime * 0.0011).a * 0.4);
          float crestGlow = bloom * smoothstep(0.4, 2.2, vCrest) * smoothstep(0.35, 0.75, foamN) * (0.6 + 0.4 * sin(seTime * 1.3 + foamN * 9.0));
          vec3 bio = vec3(0.05, 0.9, 1.25) * crestGlow * 1.6 * seBio * (1.0 - far * 0.7) + vec3(0.05, 0.9, 1.25) * (spark * (foam * 5.0 + 0.06) + clamp(ringK, 0.0, 1.0) * 0.3 * smoothstep(0.5, 0.85, foamN)) * seBio * (1.0 - far);
          vec3 T, L;
          if (dot(V, Ng) >= 0.0) {
            // from above: the sky mirrored, the moon's glade, light through the thin crests, foam
            float nv = max(dot(N, V), 0.0), F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
            vec3 R = reflect(-V, N); R.y = abs(R.y);
            vec3 refl = textureLod(seSky, R, far * 3.0).rgb;
            // the mirror: what stands over the sea and the sky, broken up by the waves (the slope shifts where it is read)
            if (seReflOn > 0.5) {
              vec4 rp = seReflM * vec4(vW.x, ${f(SEA_Y)}, vW.z, 1.0);
              vec2 ruv = rp.xy / rp.w + vec2(N.x, N.z) * 0.07 * (1.0 - 0.6 * far);
              float inScr = smoothstep(0.0, 0.02, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
              refl = mix(refl, texture2D(seRefl, clamp(ruv, 0.001, 0.999)).rgb, inScr);
            }
            float rough = mix(0.13, 0.3, far), a2 = rough * rough * rough * rough;
            vec3 H = normalize(SE_SUN + V);
            float nh = max(dot(N, H), 0.0), dd = nh * nh * (a2 - 1.0) + 1.0;
            float spec = a2 / (3.14159 * dd * dd) * (0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0)) * max(dot(N, SE_SUN), 0.0) / max(4.0 * nv, 0.15);
            float thin = smoothstep(0.2, 2.6, vCrest), back = pow(max(dot(-V, SE_SUN) * 0.5 + 0.5 + 0.3 * dot(N, -V), 0.0), 3.0);
            vec3 sss = vec3(0.004, 0.03, 0.034) * thin * (0.4 + back) * (1.0 - far);
            vec3 foamC = SE_SUNRAD * 0.07 * (0.4 + 0.6 * max(dot(N, SE_SUN), 0.0)) + vec3(0.016, 0.02, 0.026);
            vec3 c = refl * F + SE_SUNRAD * spec + sss * (1.0 - F);
            // the lights near the sea (the track's lamps, the gantries, the lighthouse, the braziers, the ships' engines)
            // in it: each a long shimmering streak broken up by the waves
            for (int i = 0; i < 12; i++) {
              vec4 lp = seLP[i];
              if (lp.w <= 0.0) continue;
              vec3 Lv = lp.xyz - vW;
              float d2 = dot(Lv, Lv);
              vec3 l = Lv * inversesqrt(d2), hh = normalize(l + V);
              float nhl = max(dot(N, hh), 0.0), ar = 0.0025, dl = nhl * nhl * (ar - 1.0) + 1.0;
              float Fl = 0.02 + 0.98 * pow(1.0 - max(dot(hh, V), 0.0), 5.0);
              c += seLC[i] * lp.w * (ar / (3.14159 * dl * dl)) * Fl * max(dot(N, l), 0.0) / max(4.0 * nv, 0.12) / d2;
            }
            float a = F;
            c = mix(c, foamC, foam); a = mix(a, 1.0, foam * 0.92);
            c += bio;
            seAir(cameraPosition, -V, dist, T, L);
            gl_FragColor = vec4(c * T + L * a, a);
          } else {
            // from below: Snell's window - the sky through it; outside it the deep mirrored back
            vec3 Nd = -N;
            float ci = max(dot(Nd, V), 0.0), st2 = 1.777 * (1.0 - ci * ci);
            float Fr = st2 >= 1.0 ? 1.0 : 0.02 + 0.98 * pow(1.0 - sqrt(1.0 - st2), 5.0);
            float rip = 0.5 + 0.5 * sin((r1.b * 0.6 + r2.b * 0.4) * 18.0 + seTime * 0.7);
            // through the window: the sky bent down to it, the moon a bright blur in it
            vec3 refr = refract(-V, Nd, 1.333);
            vec3 win = st2 < 1.0 ? (textureLod(seSky, refr, 2.0).rgb * 1.4 + SE_SUNRAD * (0.6 * pow(max(dot(refr, SE_SUN), 0.0), 60.0) + 0.06 * pow(max(dot(refr, SE_SUN), 0.0), 6.0))) * (1.0 - Fr) : vec3(0.0);
            vec3 c = SE_MURK * (0.35 + 1.6 * rip * rip) * Fr + SE_SUNRAD * 0.012 * pow(rip, 6.0) * (1.0 - far) + foam * SE_SUNRAD * 0.02 + bio * 0.6 + win * (0.7 + 0.6 * rip);
            float a = 1.0 - (1.0 - Fr) * (1.0 - foam * 0.5);
            seWater(cameraPosition, -V, dist, T, L);
            float tw = dot(T, vec3(0.3333));
            gl_FragColor = vec4(c * T + L, 1.0 - (1.0 - a) * tw);
          }
        }`,
    });
    this.mesh = new THREE.Mesh(polarGrid(), mat);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;                 // (the first of the see-through things: what is drawn after it tests its depth)
  }

  // Draw the mirror: the camera reflected in the sea's mean level, the sea's floor clipped away by an oblique near plane
  // (no shader variants), the sky first; the fog told the sea is far below (all of it air); no shadow maps redrawn.
  // hide: what is under the sea (it is not in the mirror), shown again after
  reflect(renderer, scene, camera, sky, skyCam, fog, hide) {
    const U = this.U;
    if (camera.position.y < SEA_Y + 0.5) { U.seReflOn.value = 0; return; }
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, Math.round(sz.x / 2)), h = Math.max(2, Math.round(sz.y / 2));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const m = this.mcam, cp = camera.getWorldPosition(new THREE.Vector3());
    m.copy(camera, false);
    m.position.set(cp.x, 2 * SEA_Y - cp.y, cp.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    fwd.y = -fwd.y; up.y = -up.y;
    m.up.copy(up);
    m.lookAt(m.position.clone().add(fwd));
    m.updateMatrixWorld();
    m.projectionMatrix.copy(camera.projectionMatrix);
    // the oblique near plane: the sea's plane in the mirror camera's space
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, SEA_Y, 0)).applyMatrix4(m.matrixWorldInverse);
    const c = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant), e = m.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    c.multiplyScalar(2 / c.dot(q));
    e[2] = c.x; e[6] = c.y; e[10] = c.z + 1 - 0.003; e[14] = c.w;
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();
    U.seReflM.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(camera.projectionMatrix).multiply(m.matrixWorldInverse);
    const sc = this.mskyCam;
    sc.copy(skyCam, false); sc.position.set(0, 0, 0); sc.quaternion.copy(m.quaternion); sc.updateMatrixWorld();
    const keepRT = renderer.getRenderTarget(), ac = renderer.autoClear, su = renderer.shadowMap.autoUpdate, lvl = fog.color.b;
    const vis = hide.map((o) => o.visible);
    try {
      hide.forEach((o) => (o.visible = false));
      this.mesh.visible = false;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      if (sky) renderer.render(sky, sc);
      renderer.clearDepth();
      fog.color.b = -1e5;
      renderer.render(scene, m);
    } finally {
      fog.color.b = lvl;
      hide.forEach((o, i) => (o.visible = vis[i]));
      this.mesh.visible = true;
      renderer.shadowMap.autoUpdate = su;
      renderer.autoClear = ac;
      renderer.setRenderTarget(keepRT);
    }
    U.seReflOn.value = 1;
  }

  update(t, camera) {
    // the grid follows the camera in whole metres (the swell itself stays where it is)
    this.U.seCenter.value.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
    this.U.seTime.value = t;
  }
}

// Under the sea, the picture itself: a slow wobble (the water's own refraction moving), darker toward the edges. On only
// while the camera is under (on at first, so the warm-up compiles it)
export class UnderPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 }, deep: { value: 1 }, froth: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float time, aspect, deep, froth; varying vec2 vUv;
        float uh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main() {
          vec2 q = vUv * vec2(aspect, 1.0);
          vec2 o = vec2(sin(q.y * 23.0 + time * 1.9 + sin(q.x * 7.0 + time * 0.7)), cos(q.x * 19.0 + time * 1.6 + sin(q.y * 9.0 - time * 0.5))) * 0.0016 * deep;
          vec3 c = texture2D(tDiffuse, vUv + o).rgb;
          vec2 e = vUv - 0.5;
          c *= 1.0 - 0.4 * deep * smoothstep(0.15, 0.75, dot(e, e) * 2.4);
          // going in: the froth over the lens - bubbles of every size rushing up and away, the picture whitened through them
          if (froth > 0.0) {
            float b = 0.0;
            for (int i = 0; i < 3; i++) {
              float sc = 9.0 + float(i) * 11.0;
              vec2 g = q * sc + vec2(0.0, time * (1.5 + float(i)) * 2.5), id = floor(g), f = fract(g) - 0.5;
              vec2 o2 = (vec2(uh(id), uh(id + 7.3)) - 0.5) * 0.6;
              float r = 0.18 + 0.22 * uh(id + 3.1), d = length(f - o2);
              b = max(b, step(0.45, uh(id + 1.7)) * (smoothstep(r, r * 0.7, d) - 0.6 * smoothstep(r * 0.6, 0.0, d)));
            }
            c = mix(c, c * 0.6 + vec3(0.32, 0.5, 0.55), clamp(b * froth * 1.4 + froth * 0.25, 0.0, 1.0));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.quad.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.aspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// Moonlight shafts under the sea near the surface: long faint beams hanging from it along the moon's light bent going
// in, flickering with the waves over them, fading with depth and off round the camera. Billboards turned about their
// own axis, worked out round the camera every frame on the GPU (a fixed lattice that wraps)
export class Shafts {
  constructor(n = 90) {
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0));
    const a = new Float32Array(n * 4), rnd = (i) => (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
    for (let i = 0; i < n; i++) a.set([Math.abs(rnd(i)) * 220, Math.abs(rnd(i + 0.5)) * 220, 1.2 + Math.abs(rnd(i + 0.7)) * 3, 50 + Math.abs(rnd(i + 0.9)) * 90], i * 4);
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4));
    g.instanceCount = n;
    const cy = Math.sqrt(1 - (1 - SUN_DIR.y * SUN_DIR.y) / 1.777), k = Math.sqrt(1 - cy * cy) / Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const down = new THREE.Vector3(-SUN_DIR.x * k, -cy, -SUN_DIR.z * k).normalize();
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, lvl: { value: 0 }, down: { value: down } },
      vertexShader: /* glsl */`
        uniform float time, lvl; uniform vec3 down; attribute vec4 aS; varying float vA; varying vec2 vQ;
        void main() {
          vec3 c = cameraPosition;
          // its foot on the surface, on a lattice round the camera that wraps as it moves
          vec2 p = c.xz + mod(aS.xy - c.xz + 110.0, 220.0) - 110.0;
          vec3 top = vec3(p.x, lvl, p.y) - down * 2.0;
          vec3 axis = down, toCam = normalize(c - top), side = normalize(cross(axis, toCam));
          vec3 wp = top + side * position.x * aS.z + axis * (-position.y) * aS.w;
          vQ = vec2(position.x * 2.0, -position.y);
          float d = distance(c.xz, p);
          vA = (1.0 - smoothstep(60.0, 110.0, d)) * smoothstep(18.0, 40.0, d) * (1.0 - smoothstep(10.0, 70.0, lvl - c.y)) * step(c.y, lvl)
            * (0.55 + 0.45 * sin(time * 0.7 + aS.x * 0.37) * sin(time * 0.43 + aS.y * 0.21));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec2 vQ;
        void main() {
          float k = (1.0 - vQ.x * vQ.x) * pow(1.0 - vQ.y, 1.5) * smoothstep(0.0, 0.05, vQ.y);
          gl_FragColor = vec4(vec3(0.035, 0.09, 0.105) * k * vA, 1.0);
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'moon-shafts';
  }
  update(t, lvl) { const u = this.mesh.material.uniforms; u.time.value = t; u.lvl.value = lvl; }
}

// A lightning storm out to sea: now and then a bolt (a jagged ribbon from the cloud down to the water, a branch or two),
// its flash lighting the cloud round it and the whole scene, thunder after it
export class Lightning {
  constructor(dir = new THREE.Vector3(0.75, 0.06, 0.66).normalize(), dist = 6000) {
    this.dir = dir; this.dist = dist; this.next = 6; this.t0 = -99;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(240 * 3), 3));
    this.geo.setAttribute('w', new THREE.BufferAttribute(new Float32Array(240), 1));
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { k: { value: 0 } },
      vertexShader: 'attribute float w; varying float vW; void main() { vW = w; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float k; varying float vW; void main() { gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * k * 30.0 * (1.0 - abs(vW)), 1.0); }',
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'lightning';
  }
  // a bolt's ribbon: down from the cloud (a random walk), facing the camera
  build(cam, rnd) {
    const P = this.geo.attributes.position.array, W = this.geo.attributes.w.array;
    const right = new THREE.Vector3().crossVectors(this.dir, new THREE.Vector3(0, 1, 0)).normalize();
    let n = 0;
    const strand = (p, steps, width) => {
      const q = p.clone();
      for (let i = 0; i < steps && n < 236; i++) {
        const nq = q.clone().add(new THREE.Vector3((rnd() - 0.5) * 120, -(25 + rnd() * 45), (rnd() - 0.5) * 120));
        for (const [a, b] of [[q, nq]]) {
          const off = right.clone().multiplyScalar(width);
          P.set([a.x - off.x, a.y, a.z - off.z, a.x + off.x, a.y, a.z + off.z, b.x - off.x, b.y, b.z - off.z, b.x + off.x, b.y, b.z + off.z], n * 3);
          W.set([-1, 1, -1, 1], n);
          n += 4;
        }
        q.copy(nq);
        if (q.y < 0) break;
      }
      return q;
    };
    const top = cam.clone().addScaledVector(this.dir, this.dist).setY(700 + rnd() * 300);
    strand(top, 40, 16);
    strand(top.clone().add(new THREE.Vector3(0, -150 - rnd() * 200, 0)), 6, 7);
    for (let i = n; i < 240; i++) P[i * 3 + 1] = -1e5;
    this.count = n;
    const idx = [];
    for (let i = 0; i + 3 < n; i += 4) idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    this.geo.setIndex(idx);
    this.geo.attributes.position.needsUpdate = this.geo.attributes.w.needsUpdate = true;
  }
  // every frame: the flash's strength now (0..1) - a bolt every 7-20 s, flickering in two or three strokes
  update(t, cam, rnd) {
    if (t > this.next) { this.t0 = t; this.next = t + 7 + rnd() * 13; this.build(cam, rnd); this.strokes = [0, 0.09 + rnd() * 0.06, 0.24 + rnd() * 0.1]; this.thunderAt = t + 1.2 + rnd() * 1.5; }
    const dt = t - this.t0;
    let k = 0;
    for (const s of this.strokes || []) { const u = dt - s; if (u >= 0 && u < 0.12) k = Math.max(k, Math.exp(-u * 30)); }
    this.mesh.visible = k > 0.01;
    this.mesh.material.uniforms.k.value = k;
    return k;
  }
}
