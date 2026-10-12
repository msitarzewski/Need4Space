// Laptop mode (Settings > Performance): an integrated GPU is ~30x slower than a desktop card, and with every effect
// off the frame was still the sum of many things (structure 23 %, ships 17 %, rocks 12 %, a dozen lights in every
// lit pixel ...). Lite: the heaviest shaders in cheaper versions - rocks one texture scale of their three (18 taps a
// pixel, not 54), the structure's plates without their relief normal (one evaluation of the layout, not three), the
// ships without clear coat - fewer lights, 4x texture filtering, no blur behind the HUD (settings.js sets the rest:
// 100 % scale, SMAA only, effects off).
// Shaders read Q.lite as they compile and key their programs by it.
export const Q = { lite: false, tier: 'high' };

// How much the device can hold, decided once before anything loads: 'low' a phone or tablet (or a browser reporting
// <= 4 GB), 'mid' an integrated GPU or Laptop mode, else 'high'. It picks the ship's maps (8K / 4K / 2K: ~1 GB, 256 MB,
// 64 MB on the GPU) and, 'low', the size of what is baked at load (clouds, deck, rocks, the meteorite's shadow, the
// nebula). A phone lost its WebGL context loading everything at full size.
export function memoryTier(renderer, gpuName, touch, laptop) {
  const max = renderer.capabilities.maxTextureSize, mem = navigator.deviceMemory;
  if (touch || (mem && mem <= 4) || max < 4096) return 'low';
  if (integratedGPU(gpuName) || laptop || max < 8192) return 'mid';
  return 'high';
}

// switch it: every material of the roots recompiled where its program depends on it (the rest come from the cache)
export function setLite(on, roots) {
  if (Q.lite === on) return false;
  Q.lite = on;
  for (const root of roots) root?.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      if (m.userData.clearcoat != null) m.clearcoat = on ? 0 : m.userData.clearcoat;
      m.needsUpdate = true;
    }
  });
  return true;
}

// an integrated (or software) GPU, from the renderer's name: Intel's built-in graphics (not an Arc A/B card), AMD's
// APUs, phones' GPUs, software renderers
export function integratedGPU(name = '') {
  if (/SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR/i.test(name)) return true;
  if (/Intel/i.test(name) && !/Arc\(TM\) [AB]\d{3}/i.test(name)) return true;
  if (/Radeon\(TM\) (Graphics|\d{3}M\b|Vega)/i.test(name)) return true;
  return false;
}

// Laptop mode's texture filtering: anisotropic 4x at most (16x was ~7 % of the frame even on a desktop card: the road
// seen at a glancing angle samples its maps many times over, and an integrated GPU shares slow memory). Textures on
// the GPU already are set there directly (some have no image left to upload again); the materials' own maps and their
// compiled shaders' uniforms are both looked through (run again once the warm-up has compiled them).
export function liteFiltering(renderer, roots) {
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
  if (!ext) return;
  const seen = new Set(), max = renderer.capabilities.getMaxAnisotropy();
  const visit = (t) => {
    if (!t || !t.isTexture || seen.has(t) || t.isCubeTexture || t.isData3DTexture || t.isDataArrayTexture) return;
    seen.add(t);
    const a0 = (t.userData.aniso0 ??= t.anisotropy), a = Q.lite ? Math.min(4, a0) : a0;
    if (a0 <= 1) return;
    t.anisotropy = a;
    const p = renderer.properties.get(t);
    if (p.__webglTexture && p.__currentAnisotropy !== a) {
      renderer.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(a, max));
      p.__currentAnisotropy = a;
    }
  };
  for (const root of roots) root?.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) visit(v);
      for (const u of Object.values(m.uniforms || {})) visit(u?.value);
      for (const u of Object.values(renderer.properties.get(m).uniforms || {})) visit(u?.value);
    }
  });
}
