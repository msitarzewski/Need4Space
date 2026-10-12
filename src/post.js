// Post passes: a NaN guard before the bloom, and Blender's own AgX view transform as the final pass.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// One NaN pixel (a degenerate tangent, pow() of a negative) became a black square once the bloom blurred it.
// Whatever produces one, it is zeroed here before any blur sees it; extreme fireflies are capped too.
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      // no isnan(): ANGLE's D3D compiler may fold it away ("value cannot be NaN"); its max() returns the
      // non-NaN operand, so the clamp alone maps NaN to 0 and Inf to the cap
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(min(max(c.rgb, vec3(0.0)), vec3(512.0)), 1.0);
    }`,
};
export function sanitizePass() {
  return new ShaderPass(SANITIZE);                       // (ShaderPass clones the uniforms)
}

// The look renders' view transform (AgX, "Medium High Contrast", sRGB), baked by blender/make_agx_lut_web.py into a
// 3D LUT over log2(x / 0.18). three's own AgX is the bare base curve: grey and flat next to the Cycles renders.
export async function agxPass(urls) {
  const luts = [];
  let meta = null;
  for (const url of urls) {
    meta = await (await fetch(url.replace(/\.bin$/, '.json'))).json();
    const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const N = meta.N;
    if (data.length !== N * N * N * 4) throw new Error(`AgX LUT ${url}: ${data.length} bytes, expected ${N * N * N * 4}`);
    const lut = new THREE.Data3DTexture(data, N, N, N);
    lut.format = THREE.RGBAFormat;
    lut.type = THREE.UnsignedByteType;
    lut.minFilter = lut.magFilter = THREE.LinearFilter;
    lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
    lut.unpackAlignment = 1;
    lut.needsUpdate = true;
    luts.push(lut);
  }
  const N = meta.N, lut = luts[0];
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, lut: { value: lut }, exposure: { value: 1 },
      evMin: { value: meta.ev_min }, evMax: { value: meta.ev_max }, n: { value: N } },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      precision highp sampler3D;
      uniform sampler2D tDiffuse; uniform sampler3D lut; uniform float exposure, evMin, evMax, n;
      varying vec2 vUv;
      void main() {
        vec3 c = max(texture2D(tDiffuse, vUv).rgb * exposure, vec3(0.0));
        vec3 e = (log2(max(c, vec3(1e-10)) / 0.18) - evMin) / (evMax - evMin);
        vec3 d = texture(lut, clamp(e, 0.0, 1.0) * ((n - 1.0) / n) + 0.5 / n).rgb;
        vec2 vq = (vUv - 0.5) * vec2(1.0, 0.75);
        d *= 1.0 - 0.28 * smoothstep(0.2, 0.78, length(vq));      // a lens vignette, gentle
        float r = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        gl_FragColor = vec4(d + (r - 0.5) / 255.0, 1.0);        // display-encoded already; dithered
      }`,
  });
  pass.luts = luts;
  pass.setLook = (i) => { pass.uniforms.lut.value = luts[i]; };
  return pass;
}

// Speed blur: the frame smeared toward its centre, only out at the edges, with speed and boost
export function speedBlurPass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, strength: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
      void main() {
        vec2 dir = vUv - 0.5;
        float m = smoothstep(0.12, 0.65, length(dir * vec2(1.0, 0.7))) * strength;
        if (m < 2e-4) { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); return; }   // the sharp middle
        vec3 c = vec3(0.0);
        for (int i = 0; i < 12; i++) c += texture2D(tDiffuse, vUv - dir * m * (float(i) / 11.0)).rgb;
        gl_FragColor = vec4(c / 12.0, 1.0);
      }`,
  });
}

// The backdrop (planet, sun, stars: its own scene and camera, 200 km of depth) first, then the depth cleared and the
// game scene over it - no depth-precision fight between a 2 cm bolt and a 14,000 km planet. Both go into this pass's
// own multisampled target; the NaN / Inf guard resolves it into the chain. Every pass after this one runs on plain
// targets (the composer's were multisampled too: each full-screen pass wrote four samples a pixel and resolved them
// again - a millisecond of nothing).
// The scene itself is drawn in two depth slices: everything beyond `split` metres first, with its own near plane, then
// the near slice over it (depth cleared between). One 0.2 m .. 30 km range left the depth buffer ~7 m steps at 5 km,
// so at the ring station the hub's cone, the spoke roots and the docking lights fought the surfaces behind them for
// the same depth and flickered ("this still flickers, especially in the middle"); the far slice resolves ~3 mm there.
// Each pixel is still shaded once; things that span the split are drawn in both slices, each clipped to its own.
export class LayeredRenderPass extends Pass {
  constructor(sky, skyCam, scene, camera, samples = 4, split = 500) {
    super();
    Object.assign(this, { sky, skyCam, scene, camera, split });
    this.msaa = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.clean = new FullScreenQuad(new THREE.ShaderMaterial({ ...SANITIZE, uniforms: { tDiffuse: { value: null } } }));
    this.farCam = new THREE.PerspectiveCamera();
    this.nearCam = new THREE.PerspectiveCamera();
    for (const c of [this.farCam, this.nearCam]) { c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; }
  }

  slice(c, near, far) {
    const cam = this.camera;
    c.fov = cam.fov; c.aspect = cam.aspect; c.zoom = cam.zoom; c.near = near; c.far = far;
    c.layers.mask = cam.layers.mask;
    c.updateProjectionMatrix();
    c.matrixWorld.copy(cam.matrixWorld);
    c.matrixWorldInverse.copy(cam.matrixWorldInverse);
    return c;
  }

  setSize(w, h) { this.msaa.setSize(w, h); }

  render(renderer, writeBuffer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.msaa);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;               // consumed by the scene render below (the sky has no shadows)
    if (this.sky) renderer.render(this.sky, this.skyCam);
    renderer.clearDepth();
    const cam = this.camera;
    if (this.split > 0 && cam.isPerspectiveCamera && cam.far > this.split * 2) {
      renderer.render(this.scene, this.slice(this.farCam, this.split, cam.far));      // (the shadow maps update here)
      renderer.clearDepth();
      renderer.render(this.scene, this.slice(this.nearCam, cam.near, this.split));
    } else renderer.render(this.scene, cam);
    renderer.autoClear = ac;
    this.clean.material.uniforms.tDiffuse.value = this.msaa.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.clean.render(renderer);
  }
}

// Screen-space reflections on the deck: the deck alone is drawn into a depth mask (layer 5), then for every deck
// pixel a ray is marched in view space against the AO pass's depth (its normal + depth targets are reused, so the
// scene is not drawn again), the hit's colour taken from the frame, weighted by fresnel and faded at the screen's
// edges, blurred a little (a glossy deck) at half resolution and added on.
// "the reflections flicker": a ray either hit or missed and its fixed steps landed on or off a thin ship or a lamp
// from one frame to the next, and a lamp's 40x-HDR pixel came and went. Now the ray's start is jittered each frame,
// a hit near the edge of the depth's thickness fades instead of switching, bright hits are compressed, and the result
// is accumulated over frames, the history clamped to the current neighbourhood so nothing ghosts.
// "fix the reflections, kinda flicker sometimes": at race speed the camera moves ~5 m a frame and what the rays find
// changes from frame to frame (an edge, a light strip, a gate's glowing arch) - measured as the reflection's own frame-
// to-frame change, that was as large as the reflection. Now:
//  - the history is fetched where the mirror image was last frame (as far behind the deck as the hit is in front of
//    it; each pixel carries its ray's length in the alpha, the composite adds the colour only), not where the deck's
//    point was - at 5 m a frame that warp's error is 60 % instead of 92 %
//  - the history is clamped to the neighbourhood's mean +- 1.5 sigma (its min / max emptied a reflection whenever all
//    its rays missed for one frame), and dropped on a cut (the fly-by camera's next shot, a respawn, another view)
//  - bright hits are compressed harder (a light's reflection blooms less) and a last, wider blur pass spreads what is
//    left: pixels jumping visibly from one frame to the next along a wall at race speed 3883 -> 652, under a gate
//    1529 -> 467 (a satin deck's reflection is soft anyway)
export class DeckSSRPass extends Pass {
  constructor(scene, camera, gtao, layer = 5) {
    super();
    Object.assign(this, { scene, camera, gtao, layer });
    this.strength = 1.0;
    this.wide = 6;                                         // (the last blur's reach, texels of the half-size target)
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    const half = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.ssrRT = half();
    this.blurRT = half();
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ssr = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null }, tMask: { value: null },
        proj: { value: new THREE.Matrix4() }, invProj: { value: new THREE.Matrix4() }, near: { value: 0.1 }, far: { value: 1000 },
        frame: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tColor, tDepth, tNormal, tMask; uniform mat4 proj, invProj; uniform float near, far, frame;
        varying vec2 vUv;
        float viewZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
        vec3 viewPos(vec2 uv, float vz) {
          vec4 p = invProj * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
          p.xyz /= p.w;
          return p.xyz * (vz / p.z);
        }
        vec2 project(vec3 q) { vec4 c = proj * vec4(q, 1.0); return c.xy / c.w * 0.5 + 0.5; }
        void main() {
          gl_FragColor = vec4(0.0);
          float d = texture2D(tDepth, vUv).x, md = texture2D(tMask, vUv).x;
          if (d >= 1.0 || md >= 1.0) return;
          float vz = perspectiveDepthToViewZ(d, near, far);
          if (abs(perspectiveDepthToViewZ(md, near, far) - vz) > 0.25) return;       // something stands on the deck here
          vec3 P = viewPos(vUv, vz), N = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0), V = normalize(P);
          vec3 R = normalize(reflect(V, N));
          float step = 0.4 + length(P) * 0.01;
          // interleaved gradient noise, a new pattern each frame: the steps' aliasing becomes noise the history averages
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + frame * 5.588238, vec2(0.06711056, 0.00583715))));
          vec3 Q = P + N * 0.05 + R * step * jit, prev = Q;
          vec2 hit = vec2(-1.0);
          float t = 0.0, conf = 0.0;
          for (int i = 0; i < 56; i++) {
            prev = Q;
            Q += R * step;
            step *= 1.07;
            vec2 s = project(Q);
            if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || Q.z > -near) break;
            float sz = viewZ(s), diff = sz - Q.z;
            float thick = step * 3.0 + 0.4;
            if (diff > 0.0 && diff < thick) {
              conf = 1.0 - smoothstep(0.55, 1.0, diff / thick);    // behind a thin edge: fades, not switches
              vec3 a = prev, b = Q;                         // refine between the last two points
              for (int k = 0; k < 6; k++) {
                vec3 m = (a + b) * 0.5;
                if (viewZ(project(m)) > m.z) b = m; else a = m;
              }
              hit = project(b);
              t = float(i) / 56.0;
              break;
            }
          }
          if (hit.x < 0.0) return;
          // a satin deck, not a mirror ("the road looks too reflective now and fake"): dielectric fresnel scaled by the
          // deck's roughness and capped, fading with the reflection's length and the deck's distance from the camera
          float edge = min(min(hit.x, 1.0 - hit.x), min(hit.y, 1.0 - hit.y));
          float rayLen = distance(viewPos(hit, viewZ(hit)), P);
          // ("increase ... reflection distance a bit": the reflection's length 30 -> 55 m, the deck's distance 160 -> 260 m)
          float fade = smoothstep(0.0, 0.12, edge) * (1.0 - smoothstep(0.45, 0.95, t)) * smoothstep(0.3, -0.1, R.z)
            * exp(-rayLen / 55.0) * (1.0 - smoothstep(100.0, 260.0, -P.z));
          float F = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
          float w = min(F, 0.45) * 0.35 * fade * conf;
          vec3 hc = texture2D(tColor, hit).rgb;
          hc /= 1.0 + dot(hc, vec3(0.2126, 0.7152, 0.0722)) / 5.0;    // a lamp's core reflects, it doesn't sparkle (or bloom)
          gl_FragColor = vec4(hc * w, w > 0.0 ? rayLen : 0.0);         // (alpha: the ray's length, for the history)
        }`,
    }));
    this.histA = half();
    this.histB = half();
    this.prevViewProj = new THREE.Matrix4();
    this.frame = 0;
    this.valid = false;
    this.resolve = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, tMask: { value: null },
        invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, prevViewProj: { value: new THREE.Matrix4() },
        near: { value: 0.1 }, far: { value: 1000 }, texel: { value: new THREE.Vector2() }, blend: { value: 0.9 }, valid: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tCur, tHist, tDepth, tMask; uniform mat4 invProj, camWorld, prevViewProj;
        uniform float near, far, blend, valid; uniform vec2 texel;
        varying vec2 vUv;
        void main() {
          vec4 cur = texture2D(tCur, vUv);
          float d = texture2D(tDepth, vUv).x, md = texture2D(tMask, vUv).x;
          float vz = perspectiveDepthToViewZ(d, near, far);
          if (d >= 1.0 || md >= 1.0 || abs(perspectiveDepthToViewZ(md, near, far) - vz) > 0.25) { gl_FragColor = vec4(0.0); return; }
          // the neighbourhood: its mean and spread, and the length of its rays that hit
          vec3 m1 = vec3(0.0), m2 = vec3(0.0);
          float len = 0.0, nl = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 c = texture2D(tCur, vUv + vec2(float(x), float(y)) * texel);
            m1 += c.rgb; m2 += c.rgb * c.rgb;
            if (c.a > 0.0) { len += c.a; nl += 1.0; }
          }
          m1 /= 9.0;
          vec3 sg = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
          len = nl > 0.0 ? len / nl : 0.0;
          // the mirror image: down the view ray, the hit's distance beyond the deck
          vec4 v = invProj * vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
          vec3 P = v.xyz / v.w;
          P *= vz / P.z;
          vec3 Pw = (camWorld * vec4(P, 1.0)).xyz, Vw = Pw + normalize(Pw - camWorld[3].xyz) * len;
          vec4 pc = prevViewProj * vec4(Vw, 1.0);
          vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
          if (valid < 0.5 || pc.w <= 0.0 || puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) { gl_FragColor = cur; return; }
          vec4 h = texture2D(tHist, puv);
          h.rgb = clamp(h.rgb, m1 - 1.5 * sg, m1 + 1.5 * sg);
          gl_FragColor = vec4(mix(cur.rgb, h.rgb, blend), cur.a);
        }`,
    }));
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D tIn; uniform vec2 dir; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tIn, vUv) * 0.227;
          c += (texture2D(tIn, vUv + dir * 1.385) + texture2D(tIn, vUv - dir * 1.385)) * 0.316;
          c += (texture2D(tIn, vUv + dir * 3.231) + texture2D(tIn, vUv - dir * 3.231)) * 0.070;
          gl_FragColor = c;
        }`,
    }));
    this.comp = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tSSR: { value: null }, strength: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D tColor, tSSR; uniform float strength; varying vec2 vUv;
        void main() { vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(c.rgb + texture2D(tSSR, vUv).rgb * strength, c.a); }`,
    }));
  }

  setSize(w, h) {
    this.maskRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.ssrRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.blurRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.histA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.histB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.w = w >> 1; this.h = h >> 1;
    this.valid = false;                                    // the history is another size's: start over
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, prevLayers = cam.layers.mask, prevOverride = this.scene.overrideMaterial;
    cam.layers.set(this.layer);
    this.scene.overrideMaterial = this.maskMat;
    renderer.setRenderTarget(this.maskRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, cam);
    this.scene.overrideMaterial = prevOverride;
    cam.layers.mask = prevLayers;
    const u = this.ssr.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = this.gtao.normalRenderTarget.depthTexture;
    u.tNormal.value = this.gtao.normalRenderTarget.texture;
    u.tMask.value = this.maskRT.depthTexture;
    u.proj.value.copy(cam.projectionMatrix);
    u.invProj.value.copy(cam.projectionMatrixInverse);
    u.near.value = cam.near; u.far.value = cam.far;
    u.frame.value = this.frame = (this.frame + 1) % 64;
    renderer.setRenderTarget(this.ssrRT);
    this.ssr.render(renderer);
    // temporal: last frame's result, reprojected and clamped, blended with this frame's
    const r = this.resolve.material.uniforms;
    r.tCur.value = this.ssrRT.texture; r.tHist.value = this.histA.texture;
    r.tDepth.value = u.tDepth.value; r.tMask.value = u.tMask.value;
    r.invProj.value.copy(cam.projectionMatrixInverse); r.camWorld.value.copy(cam.matrixWorld);
    r.prevViewProj.value.copy(this.prevViewProj);
    r.near.value = cam.near; r.far.value = cam.far;
    r.texel.value.set(1 / this.w, 1 / this.h);
    // a cut (the fly-by camera's next shot, a respawn, another view): last frame's history is of somewhere else
    const cp = cam.matrixWorld.elements, moved = this.lastCam ? Math.hypot(cp[12] - this.lastCam[0], cp[13] - this.lastCam[1], cp[14] - this.lastCam[2]) : 0;
    const turned = this.lastCam ? cp[8] * this.lastCam[3] + cp[9] * this.lastCam[4] + cp[10] * this.lastCam[5] : 1;
    if (moved > 30 || turned < 0.94) this.valid = false;
    this.lastCam = [cp[12], cp[13], cp[14], cp[8], cp[9], cp[10]];
    r.valid.value = this.valid ? 1 : 0;
    renderer.setRenderTarget(this.histB);
    this.resolve.render(renderer);
    [this.histA, this.histB] = [this.histB, this.histA];
    this.prevViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.valid = true;
    const b = this.blur.material.uniforms;
    b.tIn.value = this.histA.texture; b.dir.value.set(1 / this.w, 0);
    renderer.setRenderTarget(this.blurRT); this.blur.render(renderer);
    b.tIn.value = this.blurRT.texture; b.dir.value.set(0, 1 / this.h);
    renderer.setRenderTarget(this.ssrRT); this.blur.render(renderer);
    b.tIn.value = this.ssrRT.texture; b.dir.value.set(2.5 / this.w, 0);
    renderer.setRenderTarget(this.blurRT); this.blur.render(renderer);
    b.tIn.value = this.blurRT.texture; b.dir.value.set(0, 2.5 / this.h);
    renderer.setRenderTarget(this.ssrRT); this.blur.render(renderer);
    // and a wider one: a satin deck's reflection is soft, and what a fast camera's rays pick up differently from frame
    // to frame (an edge, a lamp, a gate's arch) spreads out instead of flickering
    for (const k of this.wide ? [this.wide] : []) {
      b.tIn.value = this.ssrRT.texture; b.dir.value.set(k / this.w, 0);
      renderer.setRenderTarget(this.blurRT); this.blur.render(renderer);
      b.tIn.value = this.blurRT.texture; b.dir.value.set(0, k / this.h);
      renderer.setRenderTarget(this.ssrRT); this.blur.render(renderer);
    }
    const c = this.comp.material.uniforms;
    c.tColor.value = readBuffer.texture; c.tSSR.value = this.ssrRT.texture; c.strength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.comp.render(renderer);
  }
}

// Anamorphic streaks: only the very brightest lights (engine cores, the sun, light-strip cores) are pulled out at a
// quarter resolution and smeared sideways into thin blue lines - the lens look of a high-contrast HDR image.
export class StreakPass extends Pass {
  constructor() {
    super();
    this.strength = 0.14;
    this.threshold = 6.0;
    const q = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.a = q(); this.b = q();
    const vs = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.bright = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, threshold: { value: 3 } }, vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D tIn; uniform float threshold; varying vec2 vUv;
        void main() {
          vec3 c = min(texture2D(tIn, vUv).rgb, vec3(60.0));
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * max(l - threshold, 0.0) / max(l, 1e-4), 1.0);
        }`,
    }));
    this.smear = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, stepX: { value: 0 } }, vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D tIn; uniform float stepX; varying vec2 vUv;
        void main() {
          vec3 c = vec3(0.0); float wsum = 0.0;
          for (int i = -7; i <= 7; i++) {
            float w = exp(-float(i * i) / 18.0);
            c += texture2D(tIn, vUv + vec2(float(i) * stepX, 0.0)).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(c / wsum, 1.0);
        }`,
    }));
    this.comp = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tStreak: { value: null }, strength: { value: 0.2 } }, vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D tColor, tStreak; uniform float strength; varying vec2 vUv;
        void main() { vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(c.rgb + texture2D(tStreak, vUv).rgb * vec3(0.45, 0.7, 1.0) * strength, c.a); }`,
    }));
  }

  setSize(w, h) { this.a.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); this.b.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); this.w = w >> 2; }

  render(renderer, writeBuffer, readBuffer) {
    this.bright.material.uniforms.tIn.value = readBuffer.texture;
    this.bright.material.uniforms.threshold.value = this.threshold;
    renderer.setRenderTarget(this.a); this.bright.render(renderer);
    let src = this.a, dst = this.b;
    for (const k of [1, 4, 12]) {                          // three smears, each wider: a long thin streak
      this.smear.material.uniforms.tIn.value = src.texture;
      this.smear.material.uniforms.stepX.value = k / this.w;
      renderer.setRenderTarget(dst); this.smear.render(renderer);
      [src, dst] = [dst, src];
    }
    const c = this.comp.material.uniforms;
    c.tColor.value = readBuffer.texture; c.tStreak.value = src.texture; c.strength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.comp.render(renderer);
  }
}

// Bloom, the dual-filter way (Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare"): a chain of
// half-size levels made with a 13-tap downsample - the first one thresholded (soft knee) and Karis-averaged, so a single
// hot pixel (a sun glint, a lamp's core) cannot dominate its block - then a 9-tap tent upsample back up, each level
// added to the one above it, weighted by `radius` per level (low: a tight glow). UnrealBloom's half-size taps on a
// 2-pixel glint drew squares.
export class BloomPass extends Pass {
  constructor({ threshold = 2.6, knee = 1.0, strength = 0.12, radius = 0.6, levels = 6 } = {}) {
    super();
    Object.assign(this, { threshold, knee, strength, radius, levels });
    this.mips = [];
    for (let i = 0; i < levels; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    const vs = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.down = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, texel: { value: new THREE.Vector2() }, prefilter: { value: 0 },
        threshold: { value: threshold }, knee: { value: knee } },
      vertexShader: vs,
      fragmentShader: /* glsl */`
        uniform sampler2D tIn; uniform vec2 texel; uniform float prefilter, threshold, knee; varying vec2 vUv;
        vec3 S(vec2 o) { return min(texture2D(tIn, vUv + o * texel).rgb, vec3(1000.0)); }
        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {       // a box of four, each weighted down by its brightness
          vec4 w = 1.0 / (1.0 + vec4(luma(a), luma(b), luma(c), luma(d)));
          return (a * w.x + b * w.y + c * w.z + d * w.w) / (w.x + w.y + w.z + w.w);
        }
        vec3 bright(vec3 c) {                               // the threshold with a soft knee
          float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
          rq = rq * rq / (4.0 * knee + 1e-4);
          return c * max(rq, br - threshold) / max(br, 1e-4);
        }
        void main() {
          vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
          vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0, 0.0)), f = S(vec2(2.0, 0.0));
          vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
          vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
          vec3 o;
          if (prefilter > 0.5) {
            o = karis(j, k, l, m) * 0.5 + karis(a, b, d, e) * 0.125 + karis(b, c, e, f) * 0.125
              + karis(d, e, g, h) * 0.125 + karis(e, f, h, i) * 0.125;
            o = bright(o);
          } else {
            o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
          }
          gl_FragColor = vec4(o, 1.0);
        }`,
    }));
    this.up = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tIn: { value: null }, texel: { value: new THREE.Vector2() }, weight: { value: 1 } },
      vertexShader: vs, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
      fragmentShader: /* glsl */`
        uniform sampler2D tIn; uniform vec2 texel; uniform float weight; varying vec2 vUv;
        void main() {
          vec4 d = texel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
          vec3 s = texture2D(tIn, vUv - d.xy).rgb + texture2D(tIn, vUv - d.wy).rgb * 2.0 + texture2D(tIn, vUv - d.zy).rgb
            + texture2D(tIn, vUv + d.zw).rgb * 2.0 + texture2D(tIn, vUv).rgb * 4.0 + texture2D(tIn, vUv + d.xw).rgb * 2.0
            + texture2D(tIn, vUv + d.zy).rgb + texture2D(tIn, vUv + d.wy).rgb * 2.0 + texture2D(tIn, vUv + d.xy).rgb;
          gl_FragColor = vec4(s * (weight / 16.0), 1.0);
        }`,
    }));
    this.comp = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tBloom: { value: null }, strength: { value: strength } },
      vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D tColor, tBloom; uniform float strength; varying vec2 vUv;
        void main() { vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(c.rgb + texture2D(tBloom, vUv).rgb * strength, c.a); }`,
    }));
    this.size = [1, 1];
  }

  setSize(w, h) {
    this.size = [w, h];
    let x = w, y = h;
    for (const m of this.mips) { x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); m.setSize(x, y); }
  }

  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear, d = this.down.material.uniforms, u = this.up.material.uniforms;
    let src = readBuffer.texture, sw = this.size[0], sh = this.size[1];
    d.threshold.value = this.threshold; d.knee.value = this.knee;
    for (let i = 0; i < this.levels; i++) {
      d.tIn.value = src; d.texel.value.set(1 / sw, 1 / sh); d.prefilter.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.mips[i]);
      this.down.render(renderer);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    renderer.autoClear = false;                       // each level adds onto the one above it
    for (let i = this.levels - 2; i >= 0; i--) {
      const lo = this.mips[i + 1];
      u.tIn.value = lo.texture; u.texel.value.set(1 / lo.width, 1 / lo.height); u.weight.value = this.radius;
      renderer.setRenderTarget(this.mips[i]);
      this.up.render(renderer);
    }
    renderer.autoClear = ac;
    const c = this.comp.material.uniforms;
    c.tColor.value = readBuffer.texture; c.tBloom.value = this.mips[0].texture; c.strength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.comp.render(renderer);
  }
}

// The render scale's last step: the frame is drawn at a fraction of the screen's pixels and brought up to it here -
// Catmull-Rom (in five bilinear taps) and a contrast-adaptive sharpen held inside its neighbours' range (no halos).
// (Before, a lower scale just made the canvas smaller and the browser stretched it: soft.) Above 1, a box down.
export class ResamplePass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.sharpen = 0.35;
    this.down = false;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, sharpen: { value: 0 }, down: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec2 texel; uniform float sharpen, down; varying vec2 vUv;
        vec3 catmullRom(vec2 uv) {
          vec2 sp = uv / texel, tc = floor(sp - 0.5) + 0.5, f = sp - tc;
          vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
          vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
          vec2 w12 = w1 + w2, t0 = (tc - 1.0) * texel, t3 = (tc + 2.0) * texel, t12 = (tc + w2 / w12) * texel;
          vec3 c = texture2D(tDiffuse, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y) + texture2D(tDiffuse, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
            + texture2D(tDiffuse, t12).rgb * (w12.x * w12.y) + texture2D(tDiffuse, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
            + texture2D(tDiffuse, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
          return c / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y);
        }
        void main() {
          if (down > 0.5) {
            vec2 q = 0.25 * fwidth(vUv);                           // quarter of an output pixel
            gl_FragColor = vec4((texture2D(tDiffuse, vUv + vec2(-q.x, -q.y)).rgb + texture2D(tDiffuse, vUv + vec2(q.x, -q.y)).rgb
              + texture2D(tDiffuse, vUv + vec2(-q.x, q.y)).rgb + texture2D(tDiffuse, vUv + vec2(q.x, q.y)).rgb) * 0.25, 1.0);
            return;
          }
          vec3 c = catmullRom(vUv);
          vec3 a = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb, b = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
          vec3 d = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb, e = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
          vec3 mn = min(min(a, b), min(d, e)), mx = max(max(a, b), max(d, e));
          c = clamp(c + (c - (a + b + d + e) * 0.25) * sharpen, min(mn, c), max(mx, c));
          gl_FragColor = vec4(max(c, 0.0), 1.0);
        }`,
    }));
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.quad.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.texel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.sharpen.value = this.sharpen;
    u.down.value = this.down ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
