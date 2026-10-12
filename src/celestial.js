// The sky's bodies in high detail ("make the sun and the planets way more detailed, and high quality"). The gas
// giant's clouds, the rings' ringlets and the moon's craters are painted once at load on the GPU into big textures
// (static: no cost per frame beyond a lookup); the sun's surface boils live (granulation, spots) inside a corona.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const NOISE = /* glsl */`
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * n3(p); n += a; p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / n; }
  // the nearest cell's distance and the second's (cellular, 3-D)
  vec2 cells(vec3 p) {
    vec3 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(x, y, z), r = o + vec3(h3(i + o), h3(i + o + 3.1), h3(i + o + 7.7)) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
  vec3 dirOf(vec2 uv) { float lon = (uv.x - 0.5) * 6.2831853, lat = (uv.y - 0.5) * 3.1415927; return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)); }
`;

function bake(renderer, frag, w, h, srgb, uniforms = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace });
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms, vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: 'precision highp float;\nvarying vec2 vUv;\n' + NOISE + frag,
  }));
  const prev = renderer.getRenderTarget();
  // in strips: one huge full-screen pass of heavy noise can trip the GPU watchdog
  const strips = Math.ceil(h / 512);
  for (let k = 0; k < strips; k++) {
    rt.scissor.set(0, k * 512, w, 512); rt.scissorTest = true;
    renderer.setRenderTarget(rt);                       // (a target's scissor is applied when it is bound)
    quad.render(renderer);
  }
  rt.scissorTest = false;
  renderer.setRenderTarget(prev);
  quad.material.dispose(); quad.dispose();
  rt.texture.userData.rt = rt;
  return rt.texture;
}

// a baked map halved: one bilinear tap at each 2x2 block's centre is its exact average (the map's own mip 1); the
// full-size target is freed
function halve(renderer, tex, srgb) {
  const src = tex.userData.rt, w = src.width >> 1, h = src.height >> 1;
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace });
  rt.texture.anisotropy = tex.anisotropy;
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: tex } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = textureLod(t, vUv, 0.0); }` }));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); quad.render(renderer); renderer.setRenderTarget(prev);
  quad.material.dispose(); quad.dispose();
  src.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- the gas giant's clouds (equirectangular)
const GIANT = /* glsl */`
  vec3 bandCol(float b, float v) {
    // zones (light) and belts (dark), each a shade of its own
    vec3 zone = mix(vec3(0.90, 0.83, 0.68), vec3(0.84, 0.70, 0.50), v);
    vec3 belt = mix(vec3(0.48, 0.27, 0.15), vec3(0.34, 0.19, 0.12), v);
    vec3 rust = vec3(0.66, 0.34, 0.18);
    float s = 0.5 + 0.5 * sin(b);
    vec3 c = mix(belt, zone, smoothstep(0.25, 0.75, s));
    return mix(c, rust, smoothstep(0.55, 0.9, v) * (1.0 - s) * 0.7);
  }
  void main() {
    vec3 d = dirOf(vUv);
    float lat = d.y;
    // zonal flow: features stretched along the bands - the noise is sampled squeezed across them
    vec3 p = vec3(d.x * 2.2, d.y * 11.0, d.z * 2.2);
    vec3 w1 = vec3(fbm(p + 1.7, 5), fbm(p + 9.2, 5), fbm(p + 3.3, 5));
    vec3 w2 = vec3(fbm(p * 1.8 + 3.0 * w1 + 5.1, 5), fbm(p * 1.8 + 3.0 * w1 + 1.3, 5), fbm(p * 1.8 + 3.0 * w1 + 7.9, 5));
    float turb = fbm(p * 2.4 + 4.0 * w2, 7);
    // the band pattern: latitude, bent by the turbulence (more at the belt edges)
    float b = lat * 23.0 + 1.1 * (w2.y - 0.5) + 0.65 * (turb - 0.5);      // bent, not scrambled: the belts must read
    float v = fbm(vec3(d.x * 3.0, d.y * 4.0, d.z * 3.0) + 11.0, 4);
    vec3 col = bandCol(b, v);
    // fine streaks along the flow
    float streak = fbm(vec3(d.x * 6.0, d.y * 90.0, d.z * 6.0) + 6.0 * w1, 6);
    col *= 0.86 + 0.28 * streak;
    // eddies: white ovals along the belt edges
    vec2 c1 = cells(vec3(d.x * 9.0, d.y * 30.0, d.z * 9.0));
    float edge = 1.0 - abs(sin(b));
    float oval = smoothstep(0.35, 0.1, c1.x) * smoothstep(0.55, 0.85, edge) * step(0.6, h3(floor(vec3(d.x * 9.0, d.y * 30.0, d.z * 9.0))));
    col = mix(col, vec3(0.97, 0.93, 0.86), oval * 0.75);
    // the great storm: an oval spiral in the southern belt
    float lon = atan(d.z, d.x);
    vec2 sp = vec2((lon - 0.9) * 2.6, (asin(lat) + 0.38) * 7.5);
    float r = length(sp), ang = atan(sp.y, sp.x) + 3.0 * exp(-r * 1.6);
    vec2 sw = r * vec2(cos(ang), sin(ang));
    float storm = smoothstep(1.0, 0.75, r);
    float swirl = fbm(vec3(sw * 3.0, 4.0), 5);
    vec3 stormC = mix(vec3(0.74, 0.28, 0.14), vec3(0.90, 0.55, 0.32), swirl);
    col = mix(col, stormC, storm * 0.92);
    col = mix(col, vec3(0.95, 0.88, 0.78), smoothstep(1.15, 1.0, r) * smoothstep(0.85, 1.0, r) * 0.6);    // its pale collar
    // the poles: darker, bluish, mottled
    float pole = smoothstep(0.72, 0.95, abs(lat));
    col = mix(col, vec3(0.36, 0.34, 0.36) * (0.7 + 0.6 * fbm(d * 14.0, 5)), pole * 0.75);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- the rings: colour + density across their width
const RINGS = /* glsl */`
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h3(vec3(i, 1.3, 2.7)), h3(vec3(i + 1.0, 1.3, 2.7)), f); }
  void main() {
    float x = vUv.x;
    // thousands of ringlets: noise at many scales across the width
    float d = 0.0, a = 0.5;
    for (int i = 0; i < 9; i++) { float f = 12.0 * pow(2.3, float(i)); d += a * n1(x * f + float(i) * 13.1); a *= 0.62; }
    d = 0.25 + 0.95 * (d - 0.45);
    d *= smoothstep(0.0, 0.035, x) * smoothstep(1.0, 0.95, x);
    d *= 1.0 - 0.95 * exp(-pow((x - 0.63) / 0.022, 2.0));      // the great gap
    d *= 1.0 - 0.85 * exp(-pow((x - 0.88) / 0.004, 2.0));      // a narrow one in the outer ring
    d *= 1.0 - 0.6 * exp(-pow((x - 0.31) / 0.006, 2.0));
    d *= mix(0.35, 1.0, smoothstep(0.08, 0.3, x));               // the faint inner ring
    vec3 c = mix(vec3(0.62, 0.55, 0.47), vec3(0.92, 0.86, 0.76), smoothstep(0.2, 0.7, x));
    c = mix(c, vec3(0.78, 0.66, 0.54), n1(x * 40.0) * 0.5);
    gl_FragColor = vec4(c, clamp(d, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------- the moon: albedo + height (alpha)
const MOON = /* glsl */`
  float craters(vec3 p) {
    vec3 i = floor(p), f = fract(p); float c = 0.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(x, y, z), r = o + vec3(h3(i + o), h3(i + o + 3.1), h3(i + o + 7.7)) - f;
      float dd = length(r), rad = 0.18 + 0.32 * h3(i + o + 1.3);
      if (h3(i + o + 9.1) < 0.35) continue;
      float u = dd / rad;
      c += u < 1.0 ? -0.6 * (1.0 - u * u) + 0.25 * smoothstep(0.0, 0.25, 1.0 - u) * exp(-u * 3.0) : 0.35 * exp(-pow((u - 1.0) / 0.18, 2.0));
    }
    return c;
  }
  void main() {
    vec3 d = dirOf(vUv);
    float maria = smoothstep(0.48, 0.62, fbm(d * 2.0 + 3.0, 5));
    float h = craters(d * 4.0) * 0.6 + craters(d * 11.0) * 0.3 + craters(d * 29.0) * 0.15 + craters(d * 70.0) * 0.06 + (fbm(d * 60.0, 4) - 0.5) * 0.08;
    h -= maria * 0.15;
    vec3 alb = mix(vec3(0.46, 0.45, 0.44), vec3(0.19, 0.19, 0.2), maria) * (0.82 + 0.3 * fbm(d * 30.0, 4));
    // bright ray systems round a few young craters
    float ray = pow(fbm(d * 18.0 + 4.0, 3), 6.0) * 2.5;
    alb += vec3(ray * 0.12);
    gl_FragColor = vec4(alb, clamp(h * 0.5 + 0.5, 0.0, 1.0));
  }
`;

const SEAM = /* glsl */`
  // an equirectangular lookup without the seam: the mip level from whichever longitude parameter is continuous here
  vec4 equirect(sampler2D t, vec3 q) {
    float lon = atan(q.z, q.x), lat = asin(clamp(q.y, -1.0, 1.0));
    float u1 = lon / 6.2831853 + 0.5, u2 = fract(u1 + 0.5), v = lat / 3.1415927 + 0.5;
    vec2 dx = vec2(dFdx(u1), dFdx(v)), dy = vec2(dFdy(u1), dFdy(v));
    if (abs(dFdx(u2)) < abs(dx.x)) dx.x = dFdx(u2);
    if (abs(dFdy(u2)) < abs(dy.x)) dy.x = dFdy(u2);
    return textureGrad(t, vec2(u1, v), dx, dy);
  }
`;

export function giantMaterial(renderer, shared) {
  shared.cloudTex = { value: halve(renderer, bake(renderer, GIANT, 8192, 4096, true), true) };
  return new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, center, ringN; uniform float R, sunE; uniform mat3 rot; uniform sampler2D cloudTex, ringTex;
      varying vec3 vN; varying vec3 vW;
      ${SEAM}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW), q = rot * N;
        vec3 alb = equirect(cloudTex, q).rgb;
        float ndl = dot(N, sunDir), mu = max(dot(N, V), 0.0);
        // a soft terminator (the light wraps a little through the upper atmosphere, reddened), limb darkening
        float lit = smoothstep(-0.1, 0.3, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
        vec3 tint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0), smoothstep(-0.05, 0.35, ndl));
        alb *= 0.18 + 0.82 * pow(mu, 0.55);                                        // a dark limb all round
        // the rings' shadow on the clouds (the ringlets themselves, from the same texture as the rings)
        float den = dot(sunDir, ringN);
        if (abs(den) > 1e-3) {
          float t = dot(center - vW, ringN) / den;
          if (t > 0.0) {
            float rr = length(vW + sunDir * t - center) / R, x = (rr - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)};
            if (x > 0.0 && x < 1.0) lit *= 1.0 - 0.85 * texture2D(ringTex, vec2(x, 0.5)).a;
          }
        }
        vec3 c = alb * tint * lit * sunE / 3.14159 * 0.62;
        // the atmosphere: a haze round the lit limb, blue-white high up, warm at the terminator
        // only a thread of atmosphere at the very edge of the lit side
        float rim = pow(1.0 - mu, 8.0);
        c += vec3(0.55, 0.62, 0.8) * rim * smoothstep(0.0, 0.4, ndl) * 0.18;
        c += alb * 0.0025;                                                         // the night side, barely
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export const RING_IN = 1.32, RING_OUT = 2.25;

export function ringMaterial(renderer, shared) {
  shared.ringTex = { value: bake(renderer, RINGS, 8192, 4, false) };
  shared.ringTex.value.wrapS = THREE.ClampToEdgeWrapping;
  return new THREE.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir, center, ringN; uniform float R, sunE; uniform sampler2D ringTex; varying vec3 vW;
      void main() {
        float r = length(vW - center) / R, x = (r - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)};
        if (x < 0.0 || x > 1.0) discard;
        vec4 t = texture2D(ringTex, vec2(x, 0.5));
        // a faint pattern of spokes round the ring
        float az = atan(dot(vW - center, cross(ringN, vec3(1, 0, 0))), dot(vW - center, vec3(1, 0, 0)));
        float d = t.a * (0.94 + 0.06 * sin(az * 60.0 + x * 30.0));
        // the planet's shadow
        vec3 o = vW - center; float b = dot(o, sunDir), c2 = dot(o, o) - R * R;
        float shadow = (b < 0.0 && b * b - c2 > 0.0) ? 0.02 : 1.0;
        vec3 V = normalize(cameraPosition - vW);
        float sunSide = dot(ringN, sunDir), viewSide = dot(ringN, V);
        // the lit face scatters back; seen from the dark face, the light comes through the thin parts; both glow
        // looking toward the sun (forward scattering off the ice)
        float back = abs(sunSide) * (sunSide * viewSide > 0.0 ? 1.0 : 0.35 * (1.0 - d));
        float fwd = pow(max(dot(-V, sunDir), 0.0), 6.0) * (1.0 - d * 0.6) * 1.5;
        vec3 col = t.rgb * sunE / 3.14159 * (0.12 + back + fwd) * shadow;
        gl_FragColor = vec4(col, d * 0.92);
      }`,
  });
}

export function moonMesh(renderer, sunDir, radius) {
  const tex = bake(renderer, MOON, 2048, 1024, false);
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir.clone() }, tex: { value: tex }, texel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vL; varying vec3 vW;
      void main() { vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 sunDir; uniform sampler2D tex; uniform vec2 texel; varying vec3 vN; varying vec3 vL; varying vec3 vW;
      ${SEAM}
      void main() {
        vec4 a = equirect(tex, vL);
        // relief: the height's slope east and north turns the normal (a low sun picks out every crater rim)
        vec3 E = normalize(cross(vec3(0.0, 1.0, 0.0), vL)), Nn = cross(vL, E);
        float lon = atan(vL.z, vL.x), lat = asin(clamp(vL.y, -1.0, 1.0));
        vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
        float hx = texture2D(tex, uv + vec2(texel.x, 0.0)).a - texture2D(tex, uv - vec2(texel.x, 0.0)).a;
        float hy = texture2D(tex, uv + vec2(0.0, texel.y)).a - texture2D(tex, uv - vec2(0.0, texel.y)).a;
        vec3 n = normalize(normalize(vN) - (E * hx + Nn * hy) * 6.0);
        float lit = max(dot(n, sunDir), 0.0) * smoothstep(-0.02, 0.06, dot(normalize(vN), sunDir));
        float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
        gl_FragColor = vec4((a.rgb * lit * 4.2 + a.rgb * 0.01) * (0.35 + 0.65 * pow(mu, 0.4)), 1.0);   // darker limb
      }`,
  }));
}

// ---------------------------------------------------------------- the sun: a globe of plasma
// "a realistic globe of the sun, with ejected matter sometimes": a turbulent orange surface (convection cells, warped
// plasma flow, dark filaments, sunspots in bright active regions), darkening and reddening to its limb; a thin red
// chromosphere round it, prominences arching off the limb and now and then an eruption - a plume of ejected matter
// rising and spreading out over ~12 s (Sun.erupt, scheduled in space.js). Kept inside the display range so the
// surface reads; only the hottest cores bloom.
export function sunMeshes(R) {
  const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vL; varying vec3 vN; varying vec3 vW;
      void main() { vL = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float time; varying vec3 vL; varying vec3 vN; varying vec3 vW;
      ${NOISE}
      vec3 heatRamp(float h) {                             // cool deep red -> orange -> yellow -> white-hot
        vec3 c = mix(vec3(0.45, 0.06, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.0, 0.4, h));
        c = mix(c, vec3(1.0, 0.62, 0.16), smoothstep(0.35, 0.7, h));
        return mix(c, vec3(1.0, 0.92, 0.72), smoothstep(0.7, 1.0, h));
      }
      void main() {
        float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
        float t = time * 0.015;
        vec3 p = vL;
        // the plasma's flow: warped noise, slowly churning
        vec3 q = p * 3.0 + vec3(t, -t * 0.6, t * 0.3);
        vec3 w = vec3(fbm(q + 1.0, 4), fbm(q + 5.2, 4), fbm(q + 9.1, 4));
        float flow = fbm(p * 6.0 + 2.2 * w + t * 2.0, 6);
        // convection cells (granulation), each with a bright middle and dark lanes
        vec2 c = cells(p * 48.0 + w * 2.0 + vec3(0.0, t * 4.0, 0.0));
        float gran = smoothstep(0.0, 0.45, c.y - c.x);
        // dark filaments snaking over the disc
        float fil = 1.0 - smoothstep(0.0, 0.025, abs(fbm(p * 4.0 + w * 1.4 + 17.0, 5) - 0.5));
        // sunspots in active regions: dark umbrae, ragged penumbrae, bright plage round them
        // (small and few: a few spots in a couple of active regions, not continents)
        float region = smoothstep(0.58, 0.68, fbm(p * 1.8 + 31.0, 3));
        float act = fbm(p * 7.0 + 13.0, 4) * region;
        float pen = smoothstep(0.54, 0.58, act + (fbm(p * 40.0, 3) - 0.5) * 0.04), umb = smoothstep(0.61, 0.64, act);
        float plage = region * 0.6 * (1.0 - pen);
        float h = 0.3 + 0.38 * flow + 0.16 * gran - 0.2 * fil - 0.12 * pen - 0.1 * umb + 0.1 * plage;
        // limb darkening: dimmer and redder toward the edge
        float limb = pow(mu, 0.5);
        h *= 0.55 + 0.45 * limb;
        vec3 col = heatRamp(clamp(h, 0.0, 1.0)) * (0.25 + 0.75 * limb);
        col *= 1.0 - 0.45 * pen - 0.5 * umb;                          // spots: dark brown penumbrae, near-black cores
        gl_FragColor = vec4(col * (2.4 + 2.2 * smoothstep(0.75, 1.0, h)), 1.0);
      }`,
  }));
  // round the globe, on a camera-facing plane 4 radii out each way: the chromosphere, prominences, an eruption, a
  // faint corona
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { time: { value: 0 }, eruA: { value: 0 }, eruT: { value: -100 } },
    vertexShader: /* glsl */`varying vec2 vP; void main() { vP = position.xy * 2.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float time, eruA, eruT; varying vec2 vP;
      ${NOISE}
      // a loop of plasma: an arch standing on the limb at angle a, footpoints span apart, hgt high (sun radii)
      float arch(vec2 P, float a, float span, float hgt, float seed) {
        vec2 n = vec2(cos(a), sin(a)), tng = vec2(-n.y, n.x);
        vec2 l = vec2(dot(P, tng), dot(P, n) - 1.0);           // along the limb, up from it
        float u = l.x / span;                                    // -1 .. 1 between the feet
        if (abs(u) > 1.15 || l.y < -0.02) return 0.0;
        float top = hgt * sqrt(max(0.0, 1.0 - u * u));          // the arch's centre line
        float wob = (fbm(vec3(u * 3.0, seed, time * 0.05), 4) - 0.5) * hgt * 0.5;
        float d = abs(l.y - top - wob);
        float th = 0.018 + 0.03 * fbm(vec3(u * 9.0, seed + 3.0, time * 0.08), 3);
        float strands = 0.6 + 0.8 * fbm(vec3(u * 30.0, l.y * 40.0, seed + time * 0.1), 3);
        return exp(-d * d / (th * th)) * strands * smoothstep(1.15, 0.9, abs(u));
      }
      void main() {
        vec2 P = vP * 4.0;                                       // sun radii
        float r = length(P), a = atan(P.y, P.x);
        if (r < 0.995) discard;                                  // the globe covers the middle
        float o = r - 1.0;
        // the chromosphere: a thin ragged red ring of spicules
        float spic = 0.6 + 0.8 * fbm(vec3(cos(a) * 40.0, sin(a) * 40.0, time * 0.2), 3);
        float chrom = exp(-o / (0.012 + 0.02 * spic)) * 1.3;
        // prominences: a handful of sites round the limb, each breathing on its own
        float prom = 0.0;
        for (int k = 0; k < 5; k++) {
          float fk = float(k), ak = fk * 1.37 + 0.6 + 0.15 * sin(time * 0.01 + fk);
          float life = 0.5 + 0.5 * sin(time * 0.04 + fk * 2.1);
          prom += arch(P, ak, 0.12 + 0.1 * fract(fk * 0.618), 0.1 + 0.16 * life, fk * 5.3) * (0.4 + 0.6 * life);
        }
        // an eruption: ejected matter rising from the limb and spreading, fading over ~12 s
        float age = time - eruT, eru = 0.0;
        if (age > 0.0 && age < 14.0) {
          vec2 n = vec2(cos(eruA), sin(eruA)), tng = vec2(-n.y, n.x);
          // an expanding loop of plasma still standing on the limb: a bubble whose base sits on the surface, its
          // rim bright and stringy, a column of matter inside it
          float up = dot(P, n) - 1.0, side = dot(P, tng);
          float rad = 0.04 + age * 0.09;
          vec2 cE = n * (1.0 + rad * 0.35);                         // most of the bubble below the limb: a loop rising off it
          vec2 dE = P - cE;
          float rimD = abs(length(dE) - rad);
          float topness = smoothstep(-0.6, 0.4, dot(normalize(dE), n));   // brightest over the top, thinning down its legs
          float shell = exp(-pow(rimD / (0.015 + rad * 0.12), 2.0)) * step(-0.02, up) * topness;
          float stem = exp(-pow(side / (0.02 + rad * 0.25), 2.0)) * smoothstep(rad * 1.9, 0.0, up) * step(0.0, up) * 0.5;
          float tex = 0.35 + 1.3 * fbm(vec3(side * 14.0, up * 12.0 - age * 0.6, eruA), 4);
          eru = (shell * 1.6 + stem) * tex * smoothstep(14.0, 5.0, age) * smoothstep(0.0, 0.8, age);
        }
        // a faint corona
        float cor = exp(-o * 3.0) * 0.18 * (0.7 + 0.6 * fbm(vec3(cos(a) * 3.0, sin(a) * 3.0, o * 0.5), 3));
        vec3 c = vec3(1.0, 0.22, 0.06) * chrom + vec3(1.0, 0.36, 0.1) * (prom * 1.6 + eru * 1.5) + vec3(1.0, 0.75, 0.5) * cor;
        gl_FragColor = vec4(c * smoothstep(4.0, 3.0, r), 1.0);
      }`,
  }));
  halo.scale.setScalar(R * 8);
  return { surf, corona: halo };
}
