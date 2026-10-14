// Pure loading jobs. Dependencies arrive explicitly so module workers use the page's stamped versions too.
export function caveLight({ geometries, sources, tints, rootTint, nj }, { n3 }) {
  const cell = 90, hash = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const q of sources) {
    const k = key(Math.floor(q[0][0] / cell), Math.floor(q[0][1] / cell), Math.floor(q[0][2] / cell));
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(q);
  }
  return geometries.map(({ position, row0, strength }) => {
    const out = new Float32Array(position.length);
    for (let i = 0; i < position.length / 3; i++) {
      const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2];
      const kb = strength * (0.35 + 1.3 * n3(x * 0.012, y * 0.02, z * 0.012));
      const base = row0 == null ? rootTint : tints[Math.min(tints.length - 1, row0 + Math.floor(i / nj))];
      let r = base[0] * kb, g = base[1] * kb, b = base[2] * kb;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) {
        for (const [sp, col, R, I] of hash.get(key(cx + a, cy + bb, cz + c)) || []) {
          const dx = x - sp[0], dy = y - sp[1], dz = z - sp[2];
          const d2 = (dx * dx + dy * dy + dz * dz) / (R * R);
          if (d2 > 6) continue;
          const w = I * Math.exp(-d2);
          r += col[0] * w; g += col[1] * w; b += col[2] * w;
        }
      }
      out.set([r, g, b], i * 3);
    }
    return out;
  });
}
