// The forest moon's air: ONE model for the sky and for everything seen through it, so a far island fades into exactly
// the sky behind it. Two layers of extinction, each falling off with height (integrated in closed form along a ray):
//  - the air: thin, scale height 8 km, much thicker in the blue (the zenith's deep blue, the blue of far islands)
//  - the jungle's haze: grey, scale height 350 m, thick down at the canopy (the abyss under the circuit fades into it)
// What a ray picks up on its way is the light both scatter toward the eye (the sun through the air's phase and the
// haze's strong forward lobe - the glare round the sun - and the light of the sky itself) times 1 - transmittance.
// Two cloud decks: one in the abyss under the circuit (the canopy shows through its gaps) and one high overhead; each a
// slab of 2-D noise density, crossed by the ray over the length it runs inside it.
// The sky dome (in the backdrop scene) evaluates it to infinity; every lit material, through the fog chunk
// (look.js patchShaders fogChunk), from the camera to its pixel.
import * as THREE from 'three';
import { bakeLater } from './bake.js';

export const SUN_DIR = new THREE.Vector3(-0.475, 0.407, -0.781).normalize(); // toward the sun: north-west, 24 deg up
export const SUN_E = 5.6;                                                    // its irradiance (three units)
export const SUN_COL = new THREE.Color(1.0, 0.88, 0.72);                     // after the air: an afternoon's warm white
export const GIANT_DIR = new THREE.Vector3(0.55, 0.37, 0.75).normalize();    // the gas giant: south-east, 22 deg up
export const CANOPY_Y = -1300;                                               // the jungle's roof, far below
export const LOW_CLOUD = [-1060, -900];                                      // the abyss's cloud deck (m)
export const HIGH_CLOUD = [1700, 2100];                                      // the clouds overhead (m)

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

// (constants baked in: every lit material includes this - no uniforms to hand round)
export const ATMO_GLSL = /* glsl */`
#ifndef ATMO_DEFINED
#define ATMO_DEFINED
const vec3 ATMO_SUN = ${v3(SUN_DIR)};
const vec3 ATMO_SUNRAD = vec3(${f(SUN_E * SUN_COL.r)}, ${f(SUN_E * SUN_COL.g)}, ${f(SUN_E * SUN_COL.b)});
const vec3 ATMO_BA = vec3(0.4e-5, 1.0e-5, 2.75e-5);      // the air's extinction at y = 0 (per m): clear, deep blue
// the sunlight the air scatters (up in it, before the air has warmed it: whiter than what reaches the circuit)
const vec3 ATMO_SKYSUN = vec3(${f(SUN_E)}) * vec3(1.0, 0.95, 0.9);
const float ATMO_HA = 8000.0;
const float ATMO_BB = 0.24e-3;                             // the haze's at the canopy
const float ATMO_YB = ${f(CANOPY_Y)};
const float ATMO_HB = 300.0;
// the optical depth of a density exp(-(y - y0) / H) along o + d t, t in [0, dist]
float atmoExp(float oy, float dy, float dist, float y0, float H) {
  float a = exp(-(oy - y0) / H), k = clamp(dy * dist / H, -60.0, 60.0);
  return abs(k) < 1e-4 ? a * dist : a * H / dy * (1.0 - exp(-k));
}
float atmoPhaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float atmoPhaseHG(float mu, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
// what the air and the haze scatter toward the eye looking along d (radiance of a saturated path)
vec3 atmoSourceA(float mu) { return ATMO_SKYSUN * (atmoPhaseR(mu) * 3.0 + vec3(0.02, 0.04, 0.085)); }
vec3 atmoSourceB(float mu, float dy) {
  // the haze: the sun's forward glare, the sky's light on it, a little of the jungle's green from below
  return ATMO_SKYSUN * (atmoPhaseHG(mu, 0.72) * 0.42 + atmoPhaseHG(mu, -0.2) * 0.14) * vec3(0.9, 0.96, 1.0)
    + ATMO_SKYSUN * vec3(0.01, 0.018, 0.03) + vec3(0.004, 0.013, 0.007) * ATMO_SUNRAD * smoothstep(0.2, -0.6, dy);
}
// along o + d t (t < dist): transmittance and the light picked up
void atmoPath(vec3 o, vec3 d, float dist, out vec3 T, out vec3 L) {
  vec3 odA = ATMO_BA * atmoExp(o.y, d.y, dist, 0.0, ATMO_HA);
  float odB = ATMO_BB * atmoExp(o.y, d.y, dist, ATMO_YB, ATMO_HB);
  vec3 od = odA + odB;
  T = exp(-od);
  float mu = dot(d, ATMO_SUN);
  L = (odA * atmoSourceA(mu) + odB * atmoSourceB(mu, d.y)) / max(od, vec3(1e-6)) * (1.0 - T);
}
// ---- cloud decks
float atmoH(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float atmoN(vec2 p) {
  vec2 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(atmoH(i), atmoH(i + vec2(1, 0)), u.x), mix(atmoH(i + vec2(0, 1)), atmoH(i + vec2(1, 1)), u.x), u.y);
}
float atmoFbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * atmoN(p); n += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; }
  return s / n;
}
// a deck's density at xz (0 in its gaps); cover: how much of the sky it fills
float atmoDeck(vec2 xz, float scale, float cover, float seed, int oct) {
  vec2 p = xz / scale + seed;
  // (oct < 4: the cheap deck for what is seen through the air - no swirl)
  float n = oct < 4 ? atmoFbm(p, oct) : atmoFbm(p + 0.6 * vec2(atmoFbm(p * 0.5 + 3.1, 3), atmoFbm(p * 0.5 - 7.7, 3)), oct);
  return smoothstep(1.0 - cover, 1.0 - cover + 0.22, n);
}
// a ray through a deck [y0, y1] up to dist: the length inside it and where it crosses its middle
bool atmoSlab(vec3 o, vec3 d, float dist, float y0, float y1, out float len, out vec2 xz) {
  len = 0.0; xz = vec2(0.0);
  if (abs(d.y) < 1e-4) return false;
  float t0 = (y0 - o.y) / d.y, t1 = (y1 - o.y) / d.y;
  float a = max(min(t0, t1), 0.0), b = min(max(t0, t1), dist);
  if (b <= a) return false;
  len = b - a;
  xz = (o + d * (0.5 * (a + b))).xz;
  return true;
}
// the cloud deck the ray crosses on its way (it can only ever cross one: the camera flies between them) -
// its transmittance and its light (col = col * T + C * (1 - T))
void atmoClouds(vec3 o, vec3 d, float dist, out float T, out vec3 C, int oct) {
  float len; vec2 xz;
  T = 1.0; C = vec3(0.0);
  float mu = dot(d, ATMO_SUN);
  if (atmoSlab(o, d, dist, ${f(LOW_CLOUD[0])}, ${f(LOW_CLOUD[1])}, len, xz)) {
    float den = atmoDeck(xz, 2200.0, 0.22, 3.7, oct);
    if (den > 0.0) {
      T = exp(-den * len * 0.022);
      // lit from above: a bright top, the sun's silver edge looking toward it
      float lit = atmoDeck(xz + ATMO_SUN.xz * 260.0, 2200.0, 0.22, 3.7, 2);
      C = ATMO_SUNRAD * (0.2 + 0.1 * (1.0 - lit) + atmoPhaseHG(mu, 0.6) * 0.18) * vec3(0.97, 0.99, 1.02) * (1.1 - 0.3 * lit * den);
    }
  } else if (atmoSlab(o, d, dist, ${f(HIGH_CLOUD[0])}, ${f(HIGH_CLOUD[1])}, len, xz)) {
    float den = atmoDeck(xz, 3400.0, 0.36, 11.2, oct);
    if (den > 0.0) {
      T = exp(-den * len * 0.012);
      // seen from below: grey-white bases, the sun shining through their thin edges
      float thick = atmoDeck(xz + ATMO_SUN.xz * 400.0, 3400.0, 0.36, 11.2, 2);
      C = ATMO_SUNRAD * (0.16 + 0.12 * (1.0 - thick) + atmoPhaseHG(mu, 0.75) * 0.35 * (1.0 - 0.7 * den)) * vec3(1.0, 0.99, 0.97);
    }
  }
}
#endif
`;

// the fog chunk for every lit material: the clouds, then the air, between the camera and the pixel
export const ATMO_FOG_CHUNK = /* glsl */`#ifdef USE_FOG
	{
		vec3 fogRay = vFogWorld - cameraPosition;
		float fogDist = length( fogRay );
		vec3 fogDir = fogRay / max( fogDist, 1e-3 );
		float fogCT; vec3 fogCC;
		atmoClouds( cameraPosition, fogDir, fogDist, fogCT, fogCC, 3 );
		gl_FragColor.rgb = gl_FragColor.rgb * fogCT + fogCC * ( 1.0 - fogCT );
		vec3 fogT, fogL;
		atmoPath( cameraPosition, fogDir, fogDist, fogT, fogL );
		// (the air's light thinned over the middle distance, all of it again far off where things meet the sky: an
		// island a few km off keeps its own shading instead of turning into a flat blue cut-out)
		gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL * ( 1.0 - 0.45 * dot( fogT, vec3( 0.3333 ) ) );
	}
#endif`;

// The sky dome: the backdrop scene's sphere round the camera - the air to infinity, the clouds, the sun's disc. Drawn
// last in the backdrop, over what lies beyond the air (the gas giant, its rings, the moon - drawn first, as in space):
// they are dimmed by the air's transmittance (the blend: dst x (1 - alpha)) and the air's own light is added.
// The air and the clouds never change: they are worked out once at load into a cube (rgb: their light, a: how much
// of what lies beyond they hide) and the dome looks that up - per pixel, every frame, they cost ~0.6 ms at 1080p.
// Only the sun's disc is drawn live.
const DOME_BAKE = /* glsl */`
  varying vec3 vDir;
  ${ATMO_GLSL}
  // the jungle's roof seen from far above: its leaves in the sun, a third of them in their own shade (radiance)
  const vec3 JUNGLE = vec3(0.05, 0.068, 0.02);
  void main() {
    vec3 d = normalize(vDir), o = vec3(0.0);
    // below the horizon the ray ends on the jungle (the abyss's own mesh covers the nearer part of it; this, what
    // lies past its edge and what the reflections see down there) - not on haze without end
    bool down = d.y < -1e-4;
    float dist = down ? (ATMO_YB - o.y) / d.y : 1e7;
    float cT; vec3 cC;
    atmoClouds(o, d, dist, cT, cC, 5);
    vec3 T, L;
    atmoPath(o, d, dist, T, L);
    gl_FragColor = vec4(cC * (1.0 - cT) * T + L + (down ? JUNGLE * T * cT : vec3(0.0)), down ? 1.0 : 1.0 - dot(T, vec3(0.3333)) * cT);
  }`;
export function skyDome(renderer, size = 768) {
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
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { sky: { value: rt.texture }, camPos: { value: new THREE.Vector3() }, sunDisc: { value: 1 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform samplerCube sky; uniform float sunDisc; varying vec3 vDir;
      ${ATMO_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec4 a = textureCube(sky, d);
        // what lies beyond: the sun, a disc 1.1 deg across, its limb darker, a tight glow round it - through the air
        float c = dot(d, ATMO_SUN), r = acos(clamp(c, -1.0, 1.0)) / 0.0096;
        vec3 beyond = ATMO_SUNRAD * (420.0 * (r < 1.0 ? 0.55 + 0.45 * sqrt(1.0 - r * r) : 0.0) * smoothstep(1.0, 0.9, r)
          + 2.0 * exp(-r * 0.9)) * sunDisc;
        gl_FragColor = vec4(a.rgb + beyond * (1.0 - a.a), a.a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return mesh;
}

// how much of the sun's light gets through the air to a body in the sky along d (for the gas giant and the moon,
// drawn additively over the dome: the sky's own light is in front of them)
export const ATMO_TRANS_GLSL = /* glsl */`
  vec3 atmoTrans(vec3 o, vec3 d) { vec3 T, L; atmoPath(o, d, 1e7, T, L); return T; }`;
