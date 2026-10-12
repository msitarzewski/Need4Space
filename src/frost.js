// The ice planet's air and sky: a world at the end of its day. The sun sits ~11 deg over the south-western horizon, a
// small hot disc through a thin band of orange and red; the rest of the sky darkens through rose and violet into a
// deep indigo night, stars out over most of it. A crescent ice giant - the world's primary, ringed - hangs over the
// south-east, and the aurora burns in curtains over the north. Ice crystals in the low air throw the sun's halo (22
// deg), two sun dogs and a pillar of light.
// One air model for the sky and for everything seen through it (the fog chunk), so far ice fades into exactly the
// horizon behind it: an ice fog thick near the ground (scale height 260 m) and a thin air above; what a ray picks up
// is the sky's own glow in its direction (iaGlow) times 1 - transmittance.
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { mulberry32 } from './noise.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.2, 0.76).normalize();   // toward the sun: south-west, ~11 deg up
export const SUN_E = 5.2;                                                  // its irradiance (three units)
export const SUN_COL = new THREE.Color(1.0, 0.76, 0.6);                   // through a long path of air: a sunset's
export const GIANT_DIR = new THREE.Vector3(0.38, 0.44, 0.82).normalize();  // the ice giant: south-east, ~25 deg up
const GIANT_D = 60000, GIANT_R = GIANT_D * Math.sin(THREE.MathUtils.degToRad(12.5));

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)));
const v3 = (v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;

// (constants baked in: every lit material includes this)
export const ICE_GLSL = /* glsl */`
#ifndef IA_DEFINED
#define IA_DEFINED
const vec3 IA_SUN = ${v3(SUN_DIR)};
const vec3 IA_SUNRAD = vec3(${f(SUN_E * SUN_COL.r)}, ${f(SUN_E * SUN_COL.g)}, ${f(SUN_E * SUN_COL.b)});
const float IA_HB = 260.0;          // the ice fog's scale height (m)
const float IA_BB = 1.6e-4;         // its extinction at the ice (per m)
const float IA_BA = 1.4e-5;         // the thin air's, scale height 8 km
// the optical depth of a density exp(-y / H) along o + d t, t in [0, dist]
float iaExp(float oy, float dy, float dist, float H) {
  float a = exp(-max(oy, -50.0) / H), k = clamp(dy * dist / H, -60.0, 60.0);
  return abs(k) < 1e-4 ? a * dist : a * H / dy * (1.0 - exp(-k));
}
// the sky's own light looking along d (no sun disc, no halos): the blue hour's gradient; the sunset along the horizon
// toward the sun, rose and violet over it; opposite, the world's shadow rising dark blue with the pink belt above it
vec3 iaGlow(vec3 d) {
  float h = max(d.y, 0.0);
  vec2 dh = d.xz / max(length(d.xz), 1e-4);
  float az = dot(dh, normalize(IA_SUN.xz));            // 1 under the sun, -1 opposite
  float mu = dot(d, IA_SUN);
  vec3 c = mix(vec3(0.016, 0.022, 0.05), vec3(0.0016, 0.0024, 0.0085), pow(h, 0.4));
  float side = 0.5 + 0.5 * az, s3 = side * side * side;
  c += vec3(1.0, 0.27, 0.05) * 0.42 * exp(-h / 0.045) * s3 * s3;           // the burning band
  c += vec3(0.62, 0.17, 0.2) * 0.16 * exp(-h / 0.16) * s3;                 // rose
  c += vec3(0.16, 0.06, 0.26) * 0.12 * exp(-h / 0.42) * side * side;       // violet over it
  c += IA_SUNRAD * (0.03 * pow(max(mu, 0.0), 40.0) + 0.006 * pow(max(mu, 0.0), 6.0));   // the glow round the sun
  float anti = max(-az, 0.0);
  anti *= anti;
  c *= 1.0 - 0.5 * anti * exp(-h / 0.06);                                  // the world's shadow
  c += vec3(0.07, 0.025, 0.05) * anti * exp(-pow((h - 0.11) / 0.06, 2.0)) * 0.5;   // the belt over it
  return c;
}
// along o + d t (t < dist): transmittance and the light picked up
void iaPath(vec3 o, vec3 d, float dist, out vec3 T, out vec3 L) {
  float od = IA_BB * iaExp(o.y, d.y, dist, IA_HB) + IA_BA * iaExp(o.y, d.y, dist, 8000.0);
  T = exp(-od * vec3(0.8, 0.95, 1.15));
  L = iaGlow(normalize(vec3(d.x, max(d.y, 0.0), d.z))) * (1.0 - T);
}
#endif
`;

// the fog chunk for every lit material: the air between the camera and the pixel
export const ICE_FOG_CHUNK = /* glsl */`#ifdef USE_FOG
	{
		vec3 fogRay = vFogWorld - cameraPosition;
		float fogDist = length( fogRay );
		vec3 fogT, fogL;
		iaPath( cameraPosition, fogRay / max( fogDist, 1e-3 ), fogDist, fogT, fogL );
		gl_FragColor.rgb = gl_FragColor.rgb * fogT + fogL;
	}
#endif`;

// ---------------------------------------------------------------- the dome
// baked once into a cube: rgb the air's light (and the crystals' halo round the sun), a how much of what lies beyond
// (stars, the giant, its rings) it hides
const DOME_BAKE = /* glsl */`
  varying vec3 vDir;
  ${ICE_GLSL}
  // the ice crystals' optics round the sun: the 22 deg halo (red inside, fading bluish out), the two sun dogs at its
  // height either side (bright, coloured, a tail outward), the pillar standing on the sun
  vec3 halo(vec3 d) {
    float r = acos(clamp(dot(d, IA_SUN), -1.0, 1.0));
    vec3 ring = vec3(1.0, 0.35, 0.15) * exp(-pow((r - 0.378) / 0.006, 2.0)) + vec3(1.0, 0.85, 0.6) * exp(-pow((r - 0.392) / 0.012, 2.0))
      + vec3(0.6, 0.75, 1.0) * 0.5 * exp(-pow((r - 0.41) / 0.02, 2.0));
    vec3 c = ring * 0.016;
    float se = asin(IA_SUN.y), el = asin(clamp(d.y, -1.0, 1.0));
    float sa = atan(IA_SUN.x, IA_SUN.z), a = atan(d.x, d.z);
    float da = mod(a - sa + 3.14159265, 6.2831853) - 3.14159265;
    float dog = 0.4 / max(cos(se), 0.3);                   // (the dogs sit a little wider than 22 deg off a raised sun)
    for (int k = 0; k < 2; k++) {
      float s = k == 0 ? 1.0 : -1.0, x = (da * s - dog) * cos(el), y = el - se;
      float spot = exp(-x * x / 0.00012 - y * y / 0.0004) + 0.25 * exp(-max(x, 0.0) / 0.06 - y * y / 0.0003) * step(0.0, x);
      vec3 col = mix(vec3(1.0, 0.3, 0.1), vec3(0.9, 0.95, 1.0), smoothstep(-0.006, 0.012, x));
      c += col * spot * 0.12;
    }
    float pil = exp(-pow(da * cos(el) / 0.006, 2.0)) * exp(-abs(el - se) / 0.05) * step(0.0, el - se + 0.02) * step(abs(da), 1.0);
    c += vec3(1.0, 0.55, 0.3) * pil * 0.25;
    return c * IA_SUNRAD;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.002);
    float od = IA_BB * IA_HB / h + IA_BA * 8000.0 / h;
    vec3 T = exp(-od * vec3(0.8, 0.95, 1.15)) * step(0.0, d.y);
    gl_FragColor = vec4(iaGlow(d) + halo(d), 1.0 - dot(T, vec3(0.3333)));
  }`;

export function iceSkyDome(renderer, size = 768) {
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
  // drawn over what lies beyond the air (stars, the giant, its rings): dimmed by its transmittance, the air's light
  // added; the sun's disc live (its colour through the air from the cube's alpha)
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { sky: { value: rt.texture }, sunDisc: { value: 1 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform samplerCube sky; uniform float sunDisc; varying vec3 vDir;
      ${ICE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec4 a = textureCube(sky, d);
        // the sun: a disc 0.9 deg across, flattened a little by the air, reddened toward its lower limb
        vec3 q = d - IA_SUN;
        float r = length(vec2(dot(q, normalize(cross(IA_SUN, vec3(0.0, 1.0, 0.0)))), dot(q, vec3(0.0, 1.0, 0.0)) * 1.12)) / 0.0078;
        float od = (${f(1.6e-4 * 260)} + ${f(1.4e-5 * 8000)}) / max(d.y, 0.01);
        vec3 T = exp(-od * vec3(0.8, 0.95, 1.15));
        vec3 disc = IA_SUNRAD * (900.0 * (r < 1.0 ? 0.6 + 0.4 * sqrt(1.0 - r * r) : 0.0) * smoothstep(1.0, 0.92, r) + 4.0 * exp(-r * 0.7));
        gl_FragColor = vec4(a.rgb + disc * T * sunDisc * step(0.0, d.y) * step(0.9, dot(d, IA_SUN)), a.a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- stars
export function iceStars(n = 7000) {
  const rnd = mulberry32(4242), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const band = new THREE.Vector3(-0.35, 0.8, 0.5).normalize();           // the galaxy's plane, across the north
  for (let i = 0; i < n; i++) {
    do v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (rnd() < 0.4) v.addScaledVector(band, -v.dot(band) * (0.7 + rnd() * 0.3)).normalize();
    if (v.y < -0.05) v.y = -v.y;                                           // (none under the ice)
    v.multiplyScalar(85000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = rnd();
    c.setRGB(...(t < 0.15 ? [1.0, 0.66, 0.46] : t < 0.4 ? [1.0, 0.88, 0.74] : t < 0.85 ? [0.92, 0.95, 1.0] : [0.68, 0.8, 1.0]));
    const b = 0.3 + 4.0 * Math.pow(rnd(), 8);
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    size[i] = 1.1 + 2.2 * Math.pow(rnd(), 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { pr: { value: 1 }, time: { value: 0 } },
    vertexShader: /* glsl */`attribute float size; varying vec3 vC; uniform float pr, time;
      void main() {
        // a twinkle through the cold air (faster and deeper toward the horizon)
        float tw = 0.75 + 0.25 * sin(time * (3.0 + 9.0 * fract(position.x * 0.013)) + position.z);
        vC = color * mix(1.0, tw, smoothstep(0.6, 0.05, normalize(position).y));
        gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`varying vec3 vC;
      void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * 0.7 * smoothstep(0.5, 0.1, r), 1.0); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// ---------------------------------------------------------------- the ice giant and its rings
const NOISE = /* glsl */`
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * n3(p); n += a; p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / n; }
  vec3 dirOf(vec2 uv) { float lon = (uv.x - 0.5) * 6.2831853, lat = (uv.y - 0.5) * 3.1415927; return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)); }
`;

// a texture painted once on the GPU, in strips of 256 rows (one long full-screen job can trip a slow GPU's watchdog)
function bakeTex(renderer, frag, w, h, { srgb = false, wrapT = THREE.ClampToEdgeWrapping } = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace });
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: 'precision highp float;\nvarying vec2 vUv;\n' + NOISE + frag,
  }));
  const strips = Math.max(1, Math.ceil(h / 256));
  for (let k = 0; k < strips; k++) {
    bakeLater(k ? [] : [quadJob(quad)], () => {
      const prev = renderer.getRenderTarget();
      rt.scissor.set(0, k * 256, w, 256); rt.scissorTest = true;
      rt.texture.generateMipmaps = k === strips - 1;
      renderer.setRenderTarget(rt);
      quad.render(renderer);
      rt.scissorTest = false;
      renderer.setRenderTarget(prev);
      if (k === strips - 1) { quad.material.dispose(); quad.dispose(); }
    });
  }
  return rt.texture;
}

// the giant's cloud bands: pale aqua and cyan, a deep blue belt, white zones, eddies along the shears and one great
// dark storm - an ice giant's (methane-blue), not the space circuit's banded gold
const GIANT_BANDS = /* glsl */`
  void main() {
    vec3 p = dirOf(vUv);
    float lat = (vUv.y - 0.5) * 3.1415927;
    float w = fbm(p * 3.0 + 4.0, 5) - 0.5;
    float sw = lat * 9.0 + w * 1.6 + (fbm(p * 11.0 - 2.0, 4) - 0.5) * 0.5;
    float b1 = 0.5 + 0.5 * sin(sw), b2 = 0.5 + 0.5 * sin(sw * 2.7 + 1.3);
    vec3 c = mix(vec3(0.32, 0.62, 0.72), vec3(0.62, 0.86, 0.9), b1);
    c = mix(c, vec3(0.1, 0.28, 0.52), smoothstep(0.55, 0.9, b2) * 0.55);
    c = mix(c, vec3(0.86, 0.95, 0.97), smoothstep(0.82, 0.98, b1) * 0.6);
    float belt = exp(-pow((lat + 0.32) / 0.07, 2.0));
    c = mix(c, vec3(0.08, 0.2, 0.42), belt * (0.6 + 0.4 * fbm(p * 20.0, 3)));
    // the storm: an oval in the southern belt, its spiral arms
    vec2 sp = vec2((vUv.x - 0.62) * 6.2831853 * cos(lat), lat + 0.33);
    float sr = length(sp * vec2(1.0, 2.2));
    float arm = 0.5 + 0.5 * sin(atan(sp.y, sp.x) * 2.0 - sr * 60.0);
    c = mix(c, mix(vec3(0.04, 0.1, 0.26), vec3(0.5, 0.75, 0.9), arm * smoothstep(0.02, 0.09, sr)), smoothstep(0.12, 0.05, sr));
    c *= 0.9 + 0.2 * fbm(p * 40.0, 3);
    gl_FragColor = vec4(c, 1.0);
  }`;
// the rings across their width (u 0 inner .. 1 outer): rgb colour, a density
const RINGLETS = /* glsl */`
  float hh(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  float nn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hh(i), hh(i + 1.0), f); }
  void main() {
    float u = vUv.x;
    float d = 0.55 + 0.3 * nn(u * 9.0) + 0.25 * nn(u * 41.0) + 0.2 * nn(u * 173.0) + 0.12 * nn(u * 610.0) - 0.4;
    d *= smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.9, u);
    d *= 1.0 - 0.95 * exp(-pow((u - 0.58) / 0.018, 2.0));            // the big gap
    d *= 1.0 - 0.7 * exp(-pow((u - 0.83) / 0.006, 2.0));             // a thin one
    d = mix(d, d * 0.35, smoothstep(0.62, 0.66, u) * smoothstep(0.8, 0.76, u));   // a fainter band
    vec3 c = mix(vec3(0.7, 0.82, 0.9), vec3(0.92, 0.95, 0.97), nn(u * 23.0));
    c = mix(c, vec3(0.75, 0.68, 0.6), 0.3 * smoothstep(0.65, 0.95, nn(u * 7.0 + 3.0)));
    gl_FragColor = vec4(c, clamp(d, 0.0, 1.0));
  }`;
const RING_IN = 1.4, RING_OUT = 2.35;

export function iceGiant(renderer) {
  const C = GIANT_DIR.clone().multiplyScalar(GIANT_D), R = GIANT_R;
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, -0.6, 0.42));
  const ringN = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt);
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(tilt.clone().invert()));
  const low = Q.tier === 'low';
  const bands = bakeTex(renderer, GIANT_BANDS, low ? 1024 : 2048, low ? 512 : 1024, { srgb: true });
  const rings = bakeTex(renderer, RINGLETS, 4096, 4);
  const shared = { sunDir: { value: SUN_DIR }, center: { value: C }, R: { value: R }, ringN: { value: ringN }, rot: { value: rot },
    bands: { value: bands }, rings: { value: rings }, sunE: { value: SUN_E } };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, center, ringN; uniform float R, sunE; uniform mat3 rot; uniform sampler2D bands, rings;
      varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW), q = rot * N;
        float lon = atan(q.z, q.x), lat = asin(clamp(q.y, -1.0, 1.0));
        vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
        // (the longitude's seam: the gradient taken from the wrapped coordinate where it jumps)
        float u2 = fract(uv.x + 0.5) - 0.5;
        vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y)), dy = vec2(dFdy(uv.x), dFdy(uv.y));
        if (abs(dFdx(u2)) < abs(dx.x)) dx.x = dFdx(u2);
        if (abs(dFdy(u2)) < abs(dy.x)) dy.x = dFdy(u2);
        vec3 alb = textureGrad(bands, uv, dx, dy).rgb;
        float ndl = dot(N, sunDir), mu = max(dot(N, V), 0.0);
        float lit = smoothstep(-0.08, 0.25, ndl) * (0.3 + 0.7 * max(ndl, 0.0));
        vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(-0.02, 0.3, ndl));
        alb *= 0.25 + 0.75 * pow(mu, 0.5);
        // the rings' shadow across the clouds
        float den = dot(sunDir, ringN);
        if (abs(den) > 1e-3) {
          float t = dot(center - vW, ringN) / den;
          if (t > 0.0) {
            float rr = length(vW + sunDir * t - center) / R, x = (rr - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)};
            if (x > 0.0 && x < 1.0) lit *= 1.0 - 0.8 * texture2D(rings, vec2(x, 0.5)).a;
          }
        }
        vec3 c = alb * tint * lit * sunE / 3.14159 * 0.7;
        // a thin cyan haze on the lit limb; the night side faintly lit by the rings' light
        c += vec3(0.25, 0.75, 1.0) * pow(1.0 - mu, 6.0) * smoothstep(-0.1, 0.3, ndl) * 0.35;
        c += alb * vec3(0.004, 0.009, 0.012) * (0.4 + 0.6 * smoothstep(0.3, -0.3, ndl));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  planet.position.copy(C);
  const ring = new THREE.Mesh(new THREE.RingGeometry(R * RING_IN, R * RING_OUT, 512, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, center, ringN; uniform float R, sunE; uniform sampler2D rings; varying vec3 vW;
      void main() {
        float r = length(vW - center) / R, x = (r - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)};
        if (x < 0.0 || x > 1.0) discard;
        vec4 t = texture2D(rings, vec2(x, 0.5));
        vec3 o = vW - center; float b = dot(o, sunDir), c2 = dot(o, o) - R * R;
        float shadow = (b < 0.0 && b * b - c2 > 0.0) ? 0.03 : 1.0;
        vec3 V = normalize(cameraPosition - vW);
        float sunSide = dot(ringN, sunDir), viewSide = dot(ringN, V);
        float back = abs(sunSide) * (sunSide * viewSide > 0.0 ? 1.0 : 0.4 * (1.0 - t.a));
        float fwd = pow(max(dot(-V, sunDir), 0.0), 5.0) * (1.0 - t.a * 0.5) * 2.0;
        vec3 col = t.rgb * sunE / 3.14159 * (0.1 + back + fwd) * shadow * 0.8;
        gl_FragColor = vec4(col, t.a * 0.9);
      }`,
  }));
  ring.position.copy(C);
  ring.quaternion.copy(tilt);
  ring.renderOrder = 2;
  planet.renderOrder = 1;
  const g = new THREE.Group();
  g.add(planet, ring);
  return g;
}

// ---------------------------------------------------------------- the aurora
// Curtains over the north: ribbons in the sky's directions (azimuth along, elevation up), their folds drifting and
// rippling; rays running up them, a hard bright lower edge (green-white), fading upward through green into crimson
// and violet tops. Additive, in front of the stars and the giant, behind nothing else in the sky.
export function aurora() {
  // [centre azimuth (rad, from north toward east), span, base elevation, height, brightness, seed, fold amplitude]
  const RIB = [
    [0.1, 1.9, 0.1, 0.42, 1.0, 1.0, 0.11],
    [-0.45, 1.3, 0.22, 0.34, 0.65, 2.0, 0.08],
    [0.75, 1.1, 0.07, 0.3, 0.55, 3.0, 0.07],
    [0.2, 1.6, 0.36, 0.3, 0.35, 4.0, 0.1],
  ];
  const N = 480, pos = [], uv = [], prm = [], seed = [], idx = [];
  RIB.forEach(([az, span, el, h, k, s, fa]) => {
    const o = pos.length / 3;
    for (let i = 0; i <= N; i++) for (let j = 0; j < 2; j++) {
      pos.push(0, 0, 0);
      uv.push(i / N, j);
      prm.push(az, span, el, h);
      seed.push(s, k, fa);
    }
    for (let i = 0; i < N; i++) { const a = o + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('prm', new THREE.Float32BufferAttribute(prm, 4));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 3));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 prm; attribute vec3 seed; uniform float time;
      varying vec2 vUv; varying float vK; varying float vS; varying float vEl; varying float vFold;
      void main() {
        vUv = uv; vK = seed.y; vS = seed.x;
        float u = uv.x, t = time, A = seed.z;
        // the folds: the curtain's foot swings back and forth along its length (where it doubles back, two layers of
        // it overlap: the bright folds), drifting slowly; a ripple runs through it
        float ph = u * 19.0 + t * 0.05 + seed.x * 3.0, ph2 = u * 41.0 - t * 0.13 + seed.x;
        float fold = A * sin(ph) + A * 0.45 * sin(ph2) + 0.006 * sin(u * 97.0 + t * 0.7);
        vFold = abs(cos(ph));                               // (0 where the curtain is seen edge-on: brightest)
        float az = prm.x + (u - 0.5) * prm.y + fold;
        float el = prm.z + 0.04 * sin(u * 4.0 + seed.x * 1.7 + t * 0.03) + 0.02 * cos(ph) + uv.y * prm.w * (0.8 + 0.2 * sin(u * 9.0 + seed.x));
        vEl = el;
        vec3 d = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(d * 40000.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time, strength; varying vec2 vUv; varying float vK; varying float vS; varying float vEl; varying float vFold;
      float hh(float x) { return fract(sin(x * 91.7 + vS * 13.1) * 43758.5453); }
      float nn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hh(i), hh(i + 1.0), f); }
      void main() {
        float u = vUv.x, v = vUv.y, t = time;
        // where along it the curtain burns at all (it breaks into lengths, the lengths brighten and fade)
        float on = smoothstep(0.35, 0.75, nn(u * 7.0 + t * 0.03) * 0.7 + nn(u * 23.0 - t * 0.05) * 0.3);
        // rays: fine streaks drifting along, gathered into bundles
        float rays = nn(u * 300.0 + t * 0.8) * 0.55 + nn(u * 820.0 - t * 1.6) * 0.45;
        float I = (0.25 + 1.1 * rays * rays) * on * (1.0 + 1.6 * (1.0 - vFold) * (1.0 - vFold));
        // the hard lower edge, the fade upward (the rays reach higher than the glow)
        float edge = smoothstep(0.0, 0.03, v) * (1.0 + 2.5 * exp(-v / 0.04));
        float fade = exp(-v * (3.2 - 1.6 * rays)) * smoothstep(1.0, 0.55, v);
        vec3 lo = vec3(0.1, 1.0, 0.38), hi = vec3(0.9, 0.08, 0.5), top = vec3(0.4, 0.1, 0.95);
        vec3 c = mix(lo, hi, smoothstep(0.25, 0.65, v));
        c = mix(c, top, smoothstep(0.6, 0.95, v));
        c += vec3(0.6, 1.0, 0.8) * exp(-v / 0.025) * 0.7;
        float ends = smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.9, u);
        float horizon = smoothstep(0.0, 0.08, vEl);
        gl_FragColor = vec4(c * I * edge * fade * ends * horizon * vK * strength * 0.42, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  return mesh;
}
