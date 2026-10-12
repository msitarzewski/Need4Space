// The track deck's maps, generated on the GPU once at load: colour, normal and roughness for the 44 m x 40 m plate
// layout (4096 px: ~1 cm a texel) and a 4 m aggregate detail layer (2048 px: 2 mm). Everything is built from periodic
// noise in metres - round pebbles, worn paint, plates with bevelled seams and rivets, polished racing lanes - so it
// tiles without a seam. (The canvas version was square specks and a brushed grain of straight lines: "the road had
// like a lot of straight lines, kinda looks off".)
import * as THREE from 'three';
import { bakeLater, quadJob } from './bake.js';
import { Q } from './quality.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const W = 44, L = 40;                 // the deck texture's footprint (m): TRACK_W across, 40 m along
const DETAIL = 4;                     // the detail layer's tile (m)

const COMMON = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2 size;                  // metres the texture covers
  uniform float texel;                // metres a texel
  uniform int mode;
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  // value noise on a lattice repeating every per cells (p in cells), quintic
  float vnoise(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = h12(mod(i, per)), b = h12(mod(i + vec2(1.0, 0.0), per));
    float c = h12(mod(i + vec2(0.0, 1.0), per)), d = h12(mod(i + vec2(1.0, 1.0), per));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // fbm over metres: f cells a metre at the first octave, periodic over the texture
  float fbm(vec2 m, float f, int oct, float salt) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int o = 0; o < 7; o++) {
      if (o >= oct) break;
      vec2 per = max(vec2(1.0), floor(size * f + 0.5));
      s += a * vnoise(m / size * per + vec2(salt * 13.7 + float(o) * 5.31, salt * 7.3 - float(o) * 3.17), per);
      n += a; a *= 0.5; f *= 2.0;
    }
    return s / n;
  }
  // cellular: the nearest cell's distance (in cells) and its random value; periodic
  vec2 worley(vec2 m, float f, float salt) {
    vec2 per = max(vec2(1.0), floor(size * f + 0.5)), p = m / size * per;
    vec2 i = floor(p), fr = fract(p);
    float d1 = 9.0, id = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)), c = mod(i + o, per) + salt;
      vec2 r = o + 0.12 + 0.76 * h22(c) - fr;
      float d = dot(r, r);
      if (d < d1) { d1 = d; id = h12(c + 7.7); }
    }
    return vec2(sqrt(d1), id);
  }
`;

const MACRO = /* glsl */`
  // ---- the plate layout: 11 m x 5 m plates, kerbs 1.6 m wide each side (red / white blocks every 4 m), white edge
  // lines, a dashed centre line
  float seamDist(vec2 m) {
    float dy = abs(m.y - 5.0 * floor(m.y / 5.0 + 0.5));
    float dx = min(min(abs(m.x - 11.0), abs(m.x - 22.0)), abs(m.x - 33.0));
    return min(dx, dy);
  }
  float kerbMask(vec2 m) { return max(1.0 - smoothstep(1.57, 1.6, m.x), smoothstep(42.4, 42.43, m.x)); }
  float rivet(vec2 m) {                       // dome height 0..1: rows 9 cm off each seam, every 50 cm
    float ry = abs(abs(m.y - 5.0 * floor(m.y / 5.0 + 0.5)) - 0.09), rx = (abs(fract(m.x / 0.5) - 0.5)) * 0.5;
    float sx = 11.0 * floor(m.x / 11.0 + 0.5);
    float cx = abs(abs(m.x - sx) - 0.09), cy = (abs(fract(m.y / 0.5) - 0.5)) * 0.5;
    float d = min(length(vec2(rx, ry)), sx > 1.0 && sx < 43.0 ? length(vec2(cx, cy)) : 9.0);
    float r = 0.012;
    return d < r ? sqrt(1.0 - (d / r) * (d / r)) : 0.0;
  }
  float paintMask(vec2 m) {
    float e = max(1.0 - smoothstep(0.0, 0.006, abs(m.x - 1.9) - 0.15), 1.0 - smoothstep(0.0, 0.006, abs(m.x - 42.1) - 0.15));
    float dash = (1.0 - smoothstep(0.0, 0.006, abs(m.x - 22.0) - 0.15)) * (mod(m.y, 20.0) < 10.0 ? 1.0 : 0.0);
    float p = max(e, dash);
    float chip = smoothstep(0.64, 0.7, fbm(m, 18.0, 3, 3.0)) * (0.4 + 0.6 * fbm(m, 1.5, 2, 4.0));   // chipped in flecks
    return p * (1.0 - chip);
  }
  float laneMask(vec2 m) {                    // the racing lanes, polished by the hulls' magnetic skids
    float l = 0.0;
    for (int k = 0; k < 4; k++) {
      float c = k == 0 ? 8.5 : k == 1 ? 16.0 : k == 2 ? 28.0 : 35.5;
      l = max(l, 1.0 - smoothstep(1.4, 3.2, abs(m.x - c)));
    }
    return l * (0.55 + 0.45 * fbm(m, 0.6, 3, 5.0));
  }
  float height(vec2 m) {                      // mm
    float kerb = kerbMask(m);
    float h = (fbm(m, 1.1, 4, 1.0) - 0.5) * 0.9;                    // the plates' gentle warp
    float sd = seamDist(m);
    h -= 5.0 * (1.0 - smoothstep(0.003, 0.014, sd)) * (1.0 - kerb);  // rounded seam grooves
    h += 1.6 * rivet(m) * (1.0 - kerb);
    // kerb blocks stand 8 mm proud, bevelled, with a gap every 4 m
    float kb = smoothstep(0.0, 0.025, min(abs(m.x - 1.6), abs(m.x - 42.4)));
    float kg = 1.0 - smoothstep(0.004, 0.012, abs(m.y - 4.0 * floor(m.y / 4.0 + 0.5)));
    h += kerb * (8.0 * kb - 4.0 * kg);
    h += 0.35 * paintMask(m) * (1.0 - kerb);
    return h;
  }
  vec3 albedo(vec2 m) {
    float kerb = kerbMask(m), sd = seamDist(m);
    vec2 plate = vec2(floor(m.x / 11.0), floor(m.y / 5.0 + 0.5));
    float pid = h12(mod(plate, vec2(4.0, 8.0)) + 3.1);
    vec3 c = vec3(0.086, 0.097, 0.115) * (0.92 + 0.16 * pid) * mix(vec3(1.0), vec3(1.03, 1.0, 0.96), h12(plate + 9.2));
    float w = fbm(m, 0.3, 6, 2.0);
    c *= 0.82 + 0.36 * w;                                            // wear and grime, broad and soft
    c *= 0.9 + 0.2 * fbm(m, 4.0, 4, 8.0);                            // mottling
    c *= mix(0.5, 1.0, smoothstep(0.004, 0.07, sd));                 // dirt in and along the seams
    c *= 1.0 - 0.1 * laneMask(m);
    c = mix(c, vec3(0.16, 0.165, 0.17), rivet(m) * 0.7 * (1.0 - kerb));
    vec3 paint = vec3(0.62, 0.62, 0.6) * (0.9 + 0.1 * w);
    c = mix(c, paint, paintMask(m) * (1.0 - kerb));
    if (kerb > 0.0) {
      float blk = mod(floor(m.y / 4.0), 2.0);
      vec3 kc = blk > 0.5 ? vec3(0.6, 0.6, 0.57) : vec3(0.40, 0.022, 0.027);
      // worn through in small flecks, more of them along the inner edge the hulls brush
      float edgeWear = 1.0 - smoothstep(0.0, 0.35, min(abs(m.x - 1.6), abs(m.x - 42.4)));
      float wear = smoothstep(0.66 - 0.12 * edgeWear, 0.74 - 0.12 * edgeWear, fbm(m, 14.0, 3, 4.0)) * 0.75;
      float kg = 1.0 - smoothstep(0.004, 0.014, abs(m.y - 4.0 * floor(m.y / 4.0 + 0.5)));
      kc = mix(kc * (0.88 + 0.12 * w), vec3(0.07, 0.075, 0.08), max(wear, kg));
      c = mix(c, kc, kerb);
    }
    return c;
  }
  float rough(vec2 m) {
    float kerb = kerbMask(m), sd = seamDist(m);
    float r = 0.55 + (fbm(m, 0.8, 5, 6.0) - 0.5) * 0.16;
    r -= 0.12 * laneMask(m);
    r = mix(r, 0.88, 1.0 - smoothstep(0.004, 0.02, sd));
    r = mix(r, 0.4, paintMask(m) * (1.0 - kerb));
    r = mix(r, 0.34, rivet(m) * (1.0 - kerb));
    r = mix(r, 0.52, kerb);
    return clamp(r, 0.05, 1.0);
  }
`;

const DETAILS = /* glsl */`
  // ---- aggregate: round pebbles (~1.1 cm) in a finer grit, each pebble its own tone; no direction anywhere
  vec2 pebbles(vec2 m) { return worley(m, 90.0, 1.0); }
  float height(vec2 m) {
    vec2 p = pebbles(m), q = worley(m, 230.0, 5.0);
    float dome = pow(max(0.0, 1.0 - p.x / 0.62), 1.5) * (0.6 + 0.6 * p.y);
    float grit = pow(max(0.0, 1.0 - q.x / 0.7), 2.0) * 0.45;
    return (dome + grit + fbm(m, 400.0, 2, 3.0) * 0.25) * 0.55;  // mm
  }
  vec3 albedo(vec2 m) {
    vec2 p = pebbles(m);
    float t = 0.5 + (p.y - 0.5) * 0.42 + (fbm(m, 300.0, 2, 9.0) - 0.5) * 0.16;
    t -= (1.0 - smoothstep(0.0, 0.5, 1.0 - p.x)) * 0.06;            // the binder between the stones a shade darker
    return vec3(t);
  }
  float rough(vec2 m) { return 0.5; }
`;

const FRAG = /* glsl */`
  void main() {
    vec2 m = vUv * size;
    if (mode == 0) {
      gl_FragColor = vec4(albedo(m), 1.0);
    } else if (mode == 1) {
      // the normal from the height's slope (mm over metres): one texel either way
      float e = texel;
      float dx = (height(m + vec2(e, 0.0)) - height(m - vec2(e, 0.0))) * 0.001 / (2.0 * e);
      float dy = (height(m + vec2(0.0, e)) - height(m - vec2(0.0, e))) * 0.001 / (2.0 * e);
      vec3 n = normalize(vec3(-dx, -dy, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    } else {
      float r = rough(m);
      gl_FragColor = vec4(r, r, r, 1.0);
    }
  }
`;

function bake(renderer, body, metres, res, mode, srgb) {
  const rt = new THREE.WebGLRenderTarget(res, res, {
    depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { size: { value: new THREE.Vector2(...metres) }, texel: { value: metres[0] / res }, mode: { value: mode } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: COMMON + body + FRAG,
  }));
  bakeLater([quadJob(quad)], () => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    quad.render(renderer);                     // (the mip chain is built as the target is left)
    renderer.setRenderTarget(prev);
    quad.material.dispose();
    quad.dispose();
  });
  return rt.texture;
}

// (a phone: half each way - the five maps were ~230 MB with their mips)
export function bakeDeckMaps(renderer, res = Q.tier === 'low' ? 2048 : 4096, detailRes = Q.tier === 'low' ? 1024 : 2048) {
  return {
    map: bake(renderer, MACRO, [W, L], res, 0, true),
    normal: bake(renderer, MACRO, [W, L], res, 1, false),
    rough: bake(renderer, MACRO, [W, L], res >> 1, 2, false),
    detailAlbedo: bake(renderer, DETAILS, [DETAIL, DETAIL], detailRes, 0, false),
    detailNormal: bake(renderer, DETAILS, [DETAIL, DETAIL], detailRes, 1, false),
  };
}
