// Deterministic value noise + fbm (terrain, forests) and a seeded PRNG (tree scatter).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// value noise in [0, 1]
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fade(fx), v = fade(fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// fractal sum in [0, 1]
export function fbm(x, z, octaves = 5, lac = 2.03, gain = 0.5) {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * noise2(x * f + i * 17.3, z * f - i * 9.1);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return s / norm;
}

// ridged fbm in [0, 1]: sharp crests for the mountain ring
export function ridged(x, z, octaves = 5) {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * f + i * 31.7, z * f + i * 11.3) * 2 - 1);
    s += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return s / norm;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
