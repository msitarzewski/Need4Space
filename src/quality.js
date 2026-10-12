// Laptop mode (Settings > Performance): an integrated GPU is ~30x slower than a desktop card, and with every effect
// off the frame was still the sum of many things (structure 23 %, ships 17 %, rocks 12 %, a dozen lights in every
// lit pixel ...). Lite: the heaviest shaders in cheaper versions - rocks one texture scale of their three (18 taps a
// pixel, not 54), the structure's plates without their relief normal (one evaluation of the layout, not three), the
// ships without clear coat - and fewer lights (settings.js sets the rest: 50 % scale, SMAA only, effects off).
// Shaders read Q.lite as they compile and key their programs by it.
export const Q = { lite: false };

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
