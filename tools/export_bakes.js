// Run after loading a circuit: (await import('./tools/export_bakes.js')).exportBakes()
// Save the downloaded JSON files, then load the next circuit. Run both memory tiers.
export async function exportBakes() {
  const F = window.__feather;
  if (!F) throw new Error('Wait for the circuit to finish loading');
  const { Q } = await import('../src/quality.js');
  const tier = Q.tier === 'low' ? 'low' : 'high';
  const r = F.renderer, gl = r.getContext(), textures = {};
  const map = new URLSearchParams(location.search).get('map') || F.settings.v.map;
  const token = Date.now();
  // New module instances have empty texture caches; the initial asset queue was
  // consumed during boot, so these calls run the original procedural generators.
  if (map === 'space' || map === 'forest') {
    textures['rock-normal'] = (await import(`../src/rock.js?export=${token}`)).rockMaps(r).normal;
  }
  if (map === 'forest') {
    textures['island-normal'] = (await import(`../src/islands.js?export=${token}`)).islandMaps(r).normal;
  }
  if (map === 'ice') {
    const m = (await import(`../src/glacier.js?export=${token}`)).iceMaps(r);
    textures['ice-mask'] = m.mask; textures['ice-normal'] = m.normal;
  }
  if (map === 'desert') {
    textures['sand-normal'] = (await import(`../src/dunes.js?export=${token}`)).sandMaps(r).normal;
  }
  const digest = async (a) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', a)))
    .map((v) => v.toString(16).padStart(2, '0')).join('');
  const exports = [];
  for (const [name, texture] of Object.entries(textures)) {
    const width = texture.image.width, height = texture.image.height;
    const pixels = new Uint8Array(width * height * 4), fb = gl.createFramebuffer();
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
        r.properties.get(texture).__webglTexture, 0);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete bake');
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); gl.deleteFramebuffer(fb);
    }
    const compressed = new Uint8Array(await new Response(new Blob([pixels]).stream()
      .pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let binary = '';
    for (let i = 0; i < compressed.length; i += 16384) binary += String.fromCharCode(...compressed.subarray(i, i + 16384));
    exports.push({ id: `${tier}-${name}`, width, height, colorSpace: texture.colorSpace,
      rawSHA256: await digest(pixels), gzipBase64: btoa(binary) });
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(exports)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${tier}-${map}-bakes.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return exports.map(({ id, width, height, rawSHA256 }) => ({ id, width, height, rawSHA256 }));
}
