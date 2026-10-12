// The desert planet's air and sky at the golden hour: the sun ~7.5 deg over the west-north-western horizon, a big hazy
// glow round it (the dust's forward scatter), the sky warm rose near the horizon deepening to violet overhead, the
// world's shadow rising opposite. Dust hangs thick in the low air (scale height 700 m): distant mesas and towers fade
// into a pink-orange haze. A pale moon rises in the east.
// One air model for the sky and for everything seen through it (the fog chunk): what a ray picks up is the sky's own
// glow in its direction times 1 - transmittance, so a far mesa fades into exactly the horizon behind it. Below the
// horizon the dome's rays end on the sand (its radiance), not on endless haze: no grey band, no grey light from below.
// The sandstorm: a towering body of dust over part of the circuit (an ellipsoid, density highest at its heart), its
// optical depth along any ray in closed form; seen from outside a red wall on the horizon, inside everything deep
// orange-red and the far end of the deck lost in it.
import * as THREE from 'three';
import { bakeLater } from './bake.js';

export const SUN_DIR = new THREE.Vector3(-0.88, 0.19, -0.45).normalize();   // toward the sun: west-north-west, ~11 deg
export const SUN_E = 5.8;                                                    // its irradiance (three units)
export const SUN_COL = new THREE.Color(1.0, 0.66, 0.4);                     // through a long path of dusty air: gold
export const MOON_DIR = new THREE.Vector3(0.82, 0.22, 0.45).normalize();    // the moon: east-south-east, ~13 deg up
// the storm: its heart and radii (m), how dense at the heart (per m)
export const STORM_C = new THREE.Vector3(380, 0, -2480), STORM_R = new THREE.Vector3(820, 820, 680);
export const STORM_K = 0.0105;
export const WIND = new THREE.Vector3(-0.95, 0, 0.3).normalize();            // where the wind blows (toward the sun's side)

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(7)));
const v3 = (v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

// (constants baked in: every lit material includes this)
export const DUST_GLSL = /* glsl */`
#ifndef DA_DEFINED
#define DA_DEFINED
const vec3 DA_SUN = ${v3(SUN_DIR)};
const vec3 DA_SUNRAD = vec3(${f(SUN_E * SUN_COL.r)}, ${f(SUN_E * SUN_COL.g)}, ${f(SUN_E * SUN_COL.b)});
const vec3 DA_WIND = ${v3(WIND)};
const float DA_HD = 700.0;          // the dust's scale height (m)
const float DA_BD = 3.3e-4;         // its extinction at the sand (per m)
const float DA_BA = 1.2e-5;         // the thin air's, scale height 8 km
// the sand far below the horizon, lit by the low sun and the sky (radiance)
const vec3 DA_GROUND = vec3(0.21, 0.1, 0.045);
// the optical depth of a density exp(-y / H) along o + d t, t in [0, dist]
float daExp(float oy, float dy, float dist, float H) {
  float a = exp(-max(oy, -150.0) / H), k = clamp(dy * dist / H, -60.0, 60.0);
  return abs(k) < 1e-4 ? a * dist : a * H / dy * (1.0 - exp(-k));
}
// the sky's own light looking along d (no sun disc): rose at the horizon deepening to violet overhead; the dust over the
// horizon all round, gold under the sun; the big hazy glow round the sun; opposite, the world's shadow and its belt
vec3 daGlow(vec3 d) {
  float h = max(d.y, 0.0);
  vec2 dh = d.xz / max(length(d.xz), 1e-4);
  float az = dot(dh, normalize(DA_SUN.xz));             // 1 under the sun, -1 opposite
  float mu = max(dot(d, DA_SUN), 0.0);
  float side = 0.5 + 0.5 * az, s2 = side * side;
  vec3 c = vec3(0.07, 0.055, 0.16) + vec3(0.5, 0.25, 0.25) * exp(-h / 0.32);
  c += vec3(0.5, 0.24, 0.12) * exp(-h / 0.08) * (0.35 + 0.65 * s2);
  c += vec3(1.25, 0.52, 0.12) * exp(-h / 0.07) * pow(side, 5.0);
  c += vec3(1.0, 0.5, 0.2) * 0.55 * pow(mu, 9.0);
  c += DA_SUNRAD * (0.07 * pow(mu, 60.0) + 0.4 * pow(mu, 900.0));
  float anti = max(-az, 0.0);
  anti *= anti;
  c *= 1.0 - 0.32 * anti * exp(-h / 0.08);
  c += vec3(0.22, 0.08, 0.13) * anti * exp(-pow((h - 0.12) / 0.07, 2.0)) * 0.6;
  return c;
}
// along o + d t (t < dist): transmittance and the light picked up (a little more of the blue lost: far things warm)
void daPath(vec3 o, vec3 d, float dist, out vec3 T, out vec3 L) {
  float od = DA_BD * daExp(o.y, d.y, dist, DA_HD) + DA_BA * daExp(o.y, d.y, dist, 8000.0);
  T = exp(-od * vec3(0.82, 1.0, 1.22));
  L = daGlow(normalize(vec3(d.x, max(d.y, 0.0), d.z))) * (1.0 - T);
}
// ---- the storm
float daH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float daN3(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(daH3(i), daH3(i + vec3(1, 0, 0)), u.x), mix(daH3(i + vec3(0, 1, 0)), daH3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(daH3(i + vec3(0, 0, 1)), daH3(i + vec3(1, 0, 1)), u.x), mix(daH3(i + vec3(0, 1, 1)), daH3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
const vec3 DA_SC = ${v3(STORM_C)};
const vec3 DA_SR = ${v3(new THREE.Vector3(1 / STORM_R.x, 1 / STORM_R.y, 1 / STORM_R.z))};
// the dust a ray picks up crossing the storm up to dist: density k (r^2 - q), q the squared distance from its heart in
// the radii's units, r its reach that way - billowing (a noise over the directions out of its heart, taken where the ray
// passes nearest it: the outline heaps up in domes) - its integral a cubic; gusting (a noise drifting with the wind).
// k: its strength (0: no storm); oct: the outline's octaves (the sky's dome: more)
void daStorm(vec3 o, vec3 d, float dist, float k, float time, int oct, out vec3 T, out vec3 L) {
  T = vec3(1.0); L = vec3(0.0);
  if (k <= 0.0) return;
  vec3 p = (o - DA_SC) * DA_SR, q = d * DA_SR;
  float A = dot(q, q), B = 2.0 * dot(p, q);
  vec3 drift = DA_WIND * time;
  vec3 cp = p - q * (0.5 * B / A), dir = normalize(cp + vec3(0.0, 1e-4, 0.0));
  float bump = 0.0, amp = 0.5, nrm = 0.0;
  vec3 bq = dir * 2.6 - drift * 0.0006;
  for (int i = 0; i < 4; i++) { if (i >= oct) break; bump += amp * daN3(bq); nrm += amp; bq = bq * 2.3 + 3.1; amp *= 0.5; }
  bump /= nrm;
  // (rounder up top, ragged low and along its front)
  float rr = 0.82 + 0.42 * bump * (0.7 + 0.3 * smoothstep(0.6, -0.2, dir.y));
  float r2 = rr * rr, C = dot(p, p) - r2, disc = B * B - 4.0 * A * C;
  if (disc <= 0.0) return;
  float sq = sqrt(disc), t0 = max((-B - sq) / (2.0 * A), 0.0), t1 = min((-B + sq) / (2.0 * A), dist);
  if (t1 <= t0) return;
  // integral of r^2 - (A t^2 + B t + |p|^2) over [t0, t1]
  float I = -(A * (t1 * t1 * t1 - t0 * t0 * t0) / 3.0 + B * (t1 * t1 - t0 * t0) * 0.5 + C * (t1 - t0));
  vec3 mid = o + d * (0.5 * (t0 + t1)), ent = o + d * t0;
  float g = daN3(mid / 230.0 - drift * 0.1) * 0.6 + daN3(ent / 90.0 - drift * 0.25) * 0.4;
  float od = ${f(STORM_K)} * k * I * (0.35 + 1.5 * g * g) / max(r2, 0.3);
  T = exp(-od * vec3(0.72, 1.0, 1.45));
  // deep orange-red: lit gold on its sunward face, brown-red in its own shade and at its heart
  vec3 n = normalize((ent - DA_SC) * DA_SR);
  float lit = clamp(0.45 + 0.6 * dot(n, DA_SUN) + 0.25 * (bump - 0.5), 0.0, 1.0) * clamp(1.0 - od * 0.12, 0.35, 1.0);
  float mu = max(dot(d, DA_SUN), 0.0);
  vec3 col = mix(vec3(0.15, 0.045, 0.016), vec3(0.62, 0.27, 0.1), lit) * (0.8 + 0.4 * g) + DA_SUNRAD * vec3(0.1, 0.04, 0.012) * pow(mu, 5.0);
  L = col * (1.0 - T);
}
#endif
`;

// the fog chunk for every lit material: the dusty air, then the storm, between the camera and the pixel. (The storm's
// strength and its clock ride in on three's fog colour: r the strength, g the time.)
export const DUST_FOG_CHUNK = /* glsl */`#ifdef USE_FOG
	{
		vec3 fogRay = vFogWorld - cameraPosition;
		float fogDist = length( fogRay );
		vec3 fogDir = fogRay / max( fogDist, 1e-3 );
		vec3 fogT, fogL;
		daPath( cameraPosition, fogDir, fogDist, fogT, fogL );
		gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
		daStorm( cameraPosition, fogDir, fogDist, fogColor.r, fogColor.g, 2, fogT, fogL );
		gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
	}
#endif`;

// ---------------------------------------------------------------- the dome
// baked once into a cube: rgb the air's light, a how much of what lies beyond (the moon) it hides. Below the horizon a
// ray ends on the sand seen from ~80 m up (through the dust between).
const DOME_BAKE = /* glsl */`
  varying vec3 vDir;
  ${DUST_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    vec3 o = vec3(0.0, 80.0, 0.0);
    if (d.y < -1e-4) {
      float dist = min(o.y / -d.y, 1e6);
      vec3 T, L;
      daPath(o, d, dist, T, L);
      gl_FragColor = vec4(DA_GROUND * T + L, 1.0);
      return;
    }
    float h = max(d.y, 0.002);
    float od = DA_BD * DA_HD / h + DA_BA * 8000.0 / h;
    vec3 T = exp(-od * vec3(0.82, 1.0, 1.22));
    gl_FragColor = vec4(daGlow(d), 1.0 - dot(T, vec3(0.3333)));
  }`;

export function dustSkyDome(renderer, size = 768) {
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
  // drawn over what lies beyond the air (the moon): dimmed by its transmittance, the air's light added; the sun's disc
  // and the storm live (the storm from where the camera really is)
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { sky: { value: rt.texture }, sunDisc: { value: 1 }, camPos: { value: new THREE.Vector3() }, storm: { value: 1 }, time: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform samplerCube sky; uniform float sunDisc, storm, time; uniform vec3 camPos; varying vec3 vDir;
      ${DUST_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec4 a = textureCube(sky, d);
        // the sun: a disc 1 deg across, flattened by the long path through the air, reddened toward its lower limb
        vec3 q = d - DA_SUN;
        float r = length(vec2(dot(q, normalize(cross(DA_SUN, vec3(0.0, 1.0, 0.0)))), dot(q, vec3(0.0, 1.0, 0.0)) * 1.15)) / 0.0087;
        float od = (${f(3.3e-4 * 700)} + ${f(1.2e-5 * 8000)}) / max(d.y, 0.01);
        vec3 T = exp(-od * vec3(0.82, 1.0, 1.22));
        vec3 disc = DA_SUNRAD * (700.0 * (r < 1.0 ? 0.6 + 0.4 * sqrt(1.0 - r * r) : 0.0) * smoothstep(1.0, 0.9, r) + 5.0 * exp(-r * 0.6));
        // (in the reflections' bake - no disc - the glow round the sun is damped too: blurred over a glossy deck it
        // greyed the whole road racing into the sunset)
        vec3 c = a.rgb * mix(1.0, mix(0.35, 1.0, sunDisc), smoothstep(0.6, 0.97, dot(d, DA_SUN)));
        c += disc * T * sunDisc * step(0.0, d.y) * step(0.95, dot(d, DA_SUN));
        float alpha = a.a;
        vec3 sT, sL;
        daStorm(camPos, d, 1e6, storm, time, 4, sT, sL);
        c = c * sT + sL;
        alpha = 1.0 - (1.0 - alpha) * dot(sT, vec3(0.3333));
        gl_FragColor = vec4(c, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return mesh;
}

// how much of the sun gets through the storm to p (the light on what is inside it: main thread, once a frame)
const _p = new THREE.Vector3(), _q = new THREE.Vector3();
export function stormSunT(p, k = 1) {
  if (k <= 0) return 1;
  _p.subVectors(p, STORM_C).divide(STORM_R); _q.copy(SUN_DIR).divide(STORM_R);
  const A = _q.dot(_q), B = 2 * _p.dot(_q), C = _p.dot(_p) - 1, disc = B * B - 4 * A * C;
  if (disc <= 0) return 1;
  const sq = Math.sqrt(disc), t0 = Math.max((-B - sq) / (2 * A), 0), t1 = (-B + sq) / (2 * A);
  if (t1 <= t0) return 1;
  const I = -(A * (t1 ** 3 - t0 ** 3) / 3 + B * (t1 * t1 - t0 * t0) / 2 + C * (t1 - t0));
  return Math.exp(-STORM_K * k * I * 0.9);
}
// how deep in the storm p is (0 outside .. 1 at its heart)
export function stormDepth(p) {
  _p.subVectors(p, STORM_C).divide(STORM_R);
  return Math.max(0, 1 - _p.lengthSq());
}
