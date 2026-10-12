// The Hollow: a floating island the track bores straight through. One closed surface (as the space circuit's
// meteorite): the bore round the deck, its two mouths flaring out in funnels to the island's cliffs, and the island's
// body - grassy top, cliffs, an underside hanging in lobes - whose surface is found along rays from the bore's middle
// (the island's shape as a solid: inside if under its top, over its underside, within its outline). Inside the dark
// (look.js setCave: no sun, no sky): fungi glowing on the walls, glowworm threads hanging from the roof, their beads
// shining, a sky of their lights overhead. Out of the west mouth a waterfall drops across the jump.
import * as THREE from 'three';
import { mulberry32, fbm, noise2, smoothstep } from './noise.js';
import { islandMaterial } from './islands.js';

const TAU = Math.PI * 2;

export function hollowIsland(track, I) {
  const rnd = mulberry32(I.seed), [s0, s1] = track.caves[0], f = {};
  const len = track.wrap(s1 - s0), nk = Math.ceil(len / 3), nj = 64;
  // ---- the bore
  const bore = [];
  for (let k = 0; k <= nk; k++) {
    const s = s0 + (k / nk) * len, d = (k / nk) * len, flare = smoothstep(40, 0, Math.min(d, len - d));
    track.frame(s, f);
    const row = [];
    for (let j = 0; j < nj; j++) {
      const a = (j / nj) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const n1 = fbm(ca * 1.6 + s * 0.012, sa * 1.6 - s * 0.009, 4), n2 = noise2(a * 9 + s * 0.13, s * 0.05 - a * 3);
      const r = 34 + 10 * (n1 - 0.5) + 3 * (n2 - 0.5) + flare * 12;
      const x = ca * r * 1.1, y = 6 + sa * r * 0.85;
      row.push(f.P.clone().addScaledVector(f.R, x).addScaledVector(f.U, y));
    }
    bore.push(row);
  }
  const ctrOf = (row) => row.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(row.length);
  const A0 = ctrOf(bore[0]), B0 = ctrOf(bore[nk]), O = A0.clone().add(B0).multiplyScalar(0.5), Z = B0.clone().sub(A0);
  const half = Z.length() / 2;
  Z.normalize();
  track.frame(s0 + len / 2, f);
  const Y = f.U.clone().addScaledVector(Z, -f.U.dot(Z)).normalize(), X = new THREE.Vector3().crossVectors(Z, Y);
  // ---- the island as a solid (its long axis along the bore)
  const hz = new THREE.Vector3(Z.x, 0, Z.z).normalize(), hx = new THREE.Vector3(-hz.z, 0, hz.x);
  const s1n = rnd() * 40, s2n = rnd() * 40;
  const lobes = Array.from({ length: 4 }, () => { const a = rnd() * TAU, r = 0.2 + rnd() * 0.45; return { u: Math.cos(a) * r, w: Math.sin(a) * r, d: 0.6 + rnd() * 0.4, s: 0.2 + rnd() * 0.2 }; });
  const local = (x, z) => { const dx = x - cx, dz = z - cz; return [(dx * hz.x + dz * hz.z) / rx, (dx * hx.x + dz * hx.z) / rz]; };
  const Rof = (th) => 1 + (fbm(Math.cos(th) * 1.3 + s1n, Math.sin(th) * 1.3 + s2n, 4) - 0.5) * 0.35;
  // long enough to hold the whole bore, its cliffs ~40 m past each mouth
  const cx = O.x, cz = O.z, rx = Math.max(I.rx, (half + 45) / Math.min(Rof(0), Rof(Math.PI))), rz = I.rz;
  const topY = (x, z, rho) => I.top + I.hill * ((fbm(x / 110 + s1n, z / 110 + s2n, 4) - 0.5) * 2 * (1 - smoothstep(0.6, 1, rho)) + 0.3 * (1 - rho * rho));
  const cliffBase = I.top - I.cliff;
  const bottomY = (u, w, rhoN) => {
    let h = Math.pow(Math.max(0, 1 - rhoN), I.taper);
    for (const L of lobes) h = Math.max(h, L.d * Math.exp(-((u - L.u) ** 2 + (w - L.w) ** 2) / (L.s * L.s)) * smoothstep(1, 0.75, rhoN));
    return cliffBase - (I.depth - I.cliff) * h;
  };
  const inside = (p) => {
    const [u, w] = local(p.x, p.z), rho = Math.hypot(u, w), R = Rof(Math.atan2(w, u));
    if (rho >= R) return false;
    return p.y < topY(p.x, p.z, rho / R) && p.y > bottomY(u, w, rho / R);
  };
  const tmp = new THREE.Vector3();
  const rDir = (d) => {
    let a = 0, b = 0;
    for (let t = 20; t < 1500; t += 24) { if (!inside(tmp.copy(O).addScaledVector(d, t))) { b = t; break; } a = t; }
    if (!b) return a;
    for (let it = 0; it < 11; it++) { const m = (a + b) / 2; if (inside(tmp.copy(O).addScaledVector(d, m))) a = m; else b = m; }
    return a;
  };
  const dir = new THREE.Vector3();
  const body = (th, phi) => {
    dir.copy(X).multiplyScalar(Math.cos(phi) * Math.sin(th)).addScaledVector(Y, Math.sin(phi) * Math.sin(th)).addScaledVector(Z, -Math.cos(th)).normalize();
    return O.clone().addScaledVector(dir, rDir(dir));
  };
  // ---- one surface: bore, entry funnel, body, exit funnel (rows of nc columns)
  const SUB = 4, nc = nj * SUB;
  const fine = (rr) => Array.from({ length: nc }, (_, c) => rr[Math.floor(c / SUB)].clone().lerp(rr[(Math.floor(c / SUB) + 1) % nj], (c % SUB) / SUB));
  const ringR = Math.max(...bore[0].map((v) => v.distanceTo(A0)));
  const thR = Math.atan2(ringR + 40, half + 25);
  const funnel = (ringPts, sign, rimTh) => {
    const out = [], CR = 12;
    for (let i = 0; i < CR; i++) {
      const t = i / CR, tr2 = Math.pow(t, 0.8), tz = Math.sin(t * Math.PI / 2);
      out.push(ringPts.map((v, c) => {
        const rim = body(rimTh, (c / nc) * TAU);
        const a = v.clone().sub(O), b = rim.clone().sub(O);
        const ax = a.dot(X), ay = a.dot(Y), az = a.dot(Z), bx = b.dot(X), by = b.dot(Y), bz = b.dot(Z);
        const x = ax + (bx - ax) * tr2, y = ay + (by - ay) * tr2, z = az + (bz - az) * tz;
        const jag = i === 0 ? 0 : (noise2(c * 0.21 + sign * 7, i * 0.7) - 0.5) * 5 * Math.sin(t * Math.PI);
        const radial = new THREE.Vector3(x, y, 0).normalize();
        return O.clone().addScaledVector(X, x + radial.x * jag).addScaledVector(Y, y + radial.y * jag).addScaledVector(Z, z);
      }));
    }
    return out;
  };
  const rows = [];
  rows.push(...funnel(fine(bore[0]), -1, thR));
  const BR = 110;
  for (let i = 0; i <= BR; i++) {
    const th = thR + (Math.PI - 2 * thR) * (i / BR);
    rows.push(Array.from({ length: nc }, (_, c) => body(th, (c / nc) * TAU)));
  }
  rows.push(...funnel(fine(bore[nk]), 1, Math.PI - thR).reverse());
  const shell = buildRows(rows, nc, O, true);
  // the bore itself, its own mesh (seen from inside)
  const boreGeo = buildRows(bore, nj, null, false, track, s0, len);
  // the island's attributes: grass on the top, deep under it
  for (const g of [shell, boreGeo]) {
    const p = g.attributes.position, n = g.attributes.normal, isl = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), ny = n.getY(i);
      const [u, w] = local(p.getX(i), p.getZ(i)), rho = Math.hypot(u, w), R = Rof(Math.atan2(w, u));
      const top = topY(p.getX(i), p.getZ(i), Math.min(1, rho / R));
      isl[i * 2] = g === shell ? smoothstep(0.55, 0.85, ny) * smoothstep(top - 14, top - 3, y) : 0;
      isl[i * 2 + 1] = g === shell ? smoothstep(cliffBase, I.top - I.depth, y) : 0.15;
    }
    g.setAttribute('isl', new THREE.BufferAttribute(isl, 2));
  }
  // planting interface (as islands.js's): the top's height and how far in from the rim; a point on the rim
  const avgR = (rx + rz) / 2;
  const topInfo = (x, z) => {
    const [u, w] = local(x, z), rho = Math.hypot(u, w), R = Rof(Math.atan2(w, u));
    if (rho > R - 8 / avgR) return null;
    return { y: topY(x, z, rho / R), edge: (R - rho) * avgR };
  };
  const rimAt = (th) => {
    const R = Rof(th) - 2 / avgR, u = Math.cos(th) * R, w = Math.sin(th) * R;
    const x = cx + u * rx * hz.x + w * rz * hx.x, z = cz + u * rx * hz.z + w * rz * hx.z;
    const out = hz.clone().multiplyScalar(Math.cos(th) / rx).addScaledVector(hx, Math.sin(th) / rz).normalize();
    return { p: new THREE.Vector3(x, topY(x, z, R / Rof(th)), z), out, y: topY(x, z, 0.98) };
  };
  return { shell, boreGeo, bore, A0, B0, O, X, Y, Z, half, topInfo, rimAt, topHeight: (x, z) => topInfo(x, z)?.y ?? null,
    I: { ...I, x: cx, z: cz }, hz, hx };
}

// rows of points (closed round) into an indexed surface; flip so it faces away from `centre` (or, for the bore,
// toward the track's middle)
function buildRows(rows, nc, centre, out, track, s0, len) {
  const pos = [], idx = [];
  for (const row of rows) for (const v of row) pos.push(v.x, v.y, v.z);
  for (let i = 0; i < rows.length - 1; i++) for (let c = 0; c < nc; c++) {
    const a = i * nc + c, b = i * nc + ((c + 1) % nc), d = a + nc, e = b + nc;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mid = Math.floor(rows.length / 2) * nc, vp = new THREE.Vector3().fromBufferAttribute(g.attributes.position, mid), vn = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, mid);
  let target;
  if (out) target = vp.clone().sub(centre);
  else { const f = track.frame(s0 + len / 2); target = f.P.clone().addScaledVector(f.U, 6).sub(vp); }
  if (vn.dot(target) < 0) {
    for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------- the glow inside
// glowworm threads: thin silk lines from the roof, beads of light down them (instanced, additive, facing the camera)
function threadMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 anchor; attribute vec2 thread; varying vec2 vT; varying float vLen; varying float vSeed;
      void main() {
        float t = -position.y;
        vec3 camL = cameraPosition - anchor;
        vec2 f = normalize(camL.xz + 1e-4);
        vec3 across = vec3(-f.y, 0.0, f.x) * 0.35;
        vec3 w = anchor + vec3(0.0, -t * thread.x, 0.0) + across * position.x;
        vT = vec2(position.x, t); vLen = thread.x; vSeed = thread.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec2 vT; varying float vLen; varying float vSeed;
      void main() {
        float x = abs(vT.x) * 2.0, m = vT.y * vLen;               // across 0..1, metres down
        float line = exp(-x * x * 60.0) * 0.06;
        float k = fract(m / 0.45 + vSeed * 7.0), bead = exp(-pow((k - 0.5) * 0.45 / 0.05, 2.0) - x * x * 6.0);
        float tw = 0.7 + 0.3 * sin(time * 1.3 + vSeed * 40.0 + floor(m / 0.45) * 2.1);
        vec3 c = vec3(0.25, 0.95, 0.85) * (line + bead * 1.4 * tw) * smoothstep(1.0, 0.7, vT.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// The glow, placed on the bore: fungi on the lower walls (clear of the deck), threads and a sky of lights on the roof
export function caveGlow(scene, cave, track) {
  const rnd = mulberry32(808), [s0] = track.caves[0], len = track.wrap(track.caves[0][1] - s0), f = {};
  const bore = cave.bore, nk = bore.length - 1, nj = bore[0].length;
  const threads = [], dots = [], caps = [];
  for (let k = 3; k < nk - 3; k++) {
    const s = s0 + (k / nk) * len;
    track.frame(s, f);
    for (let j = 0; j < nj; j++) {
      const p = bore[k][j], d = p.clone().sub(f.P), x = d.dot(f.R), y = d.dot(f.U);
      if (y > 22) {                                                  // the roof
        if (rnd() < 0.5) dots.push(p.clone().addScaledVector(f.U, -0.3));
        if (rnd() < 0.22) threads.push({ p: p.clone().addScaledVector(f.U, -0.5), len: Math.min(y - 15, 2 + Math.pow(rnd(), 1.4) * 14), seed: rnd() });
      } else if (Math.abs(x) > 27 && y > -14 && y < 18 && rnd() < 0.06) {  // the walls beside the deck
        caps.push({ p, n: f.P.clone().addScaledVector(f.U, 6).sub(p).normalize(), hue: rnd() });
      }
    }
  }
  const out = [];
  // threads
  {
    const g = new THREE.InstancedBufferGeometry(), N = 10, pos = [], idx = [];
    for (let i = 0; i <= N; i++) pos.push(-0.5, -i / N, 0, 0.5, -i / N, 0);
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const an = new Float32Array(threads.length * 3), th = new Float32Array(threads.length * 2);
    threads.forEach((q, i) => { an.set([q.p.x, q.p.y, q.p.z], i * 3); th.set([q.len, q.seed], i * 2); });
    g.setAttribute('anchor', new THREE.InstancedBufferAttribute(an, 3));
    g.setAttribute('thread', new THREE.InstancedBufferAttribute(th, 2));
    g.instanceCount = threads.length;
    const m = new THREE.Mesh(g, threadMaterial());
    m.frustumCulled = false; m.renderOrder = 3;
    out.push(m);
  }
  // the roof's sky of lights
  {
    const g = new THREE.BufferGeometry(), p = new Float32Array(dots.length * 3), sd = new Float32Array(dots.length);
    dots.forEach((v, i) => { p.set([v.x + (rnd() - 0.5) * 3, v.y + (rnd() - 0.5) * 2, v.z + (rnd() - 0.5) * 3], i * 3); sd[i] = rnd(); });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: out[0].material.uniforms.time, pr: { value: 1 } },
      vertexShader: /* glsl */`attribute float seed; uniform float time, pr; varying float vB;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vB = (0.55 + 0.45 * sin(time * (0.6 + seed) + seed * 30.0)) * (0.5 + seed);
          gl_PointSize = pr * clamp(90.0 / -mv.z, 1.2, 3.5); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying float vB;
        void main() { float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.3, 0.9, 1.0) * vB * smoothstep(0.5, 0.0, r) * 1.4, 1.0); }`,
    }));
    m.frustumCulled = false;
    out.push(m);
  }
  // fungi: shelf caps in clusters, glowing (teal, violet, amber), lit too by the ships' lights
  {
    const cap = new THREE.SphereGeometry(1, 8, 3, 0, TAU, 0, Math.PI / 2).scale(1, 0.32, 1);
    const im = new THREE.InstancedMesh(cap, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 1 }), caps.length * 4);
    const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let n = 0;
    for (const q of caps) {
      const col = q.hue < 0.55 ? [0.02, 0.7, 0.55] : q.hue < 0.85 ? [0.45, 0.06, 0.8] : [0.8, 0.35, 0.03];
      for (let k = 0; k < 4; k++) {
        const s = 0.22 + rnd() * 0.55, p = q.p.clone().addScaledVector(q.n, 0.1).add(new THREE.Vector3((rnd() - 0.5) * 1.6, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.6));
        // a shelf: its cap up, sticking out of the wall
        Qn.setFromUnitVectors(up, up.clone().lerp(q.n, 0.35).normalize());
        M.compose(p, Qn, new THREE.Vector3(s, s, s));
        im.setMatrixAt(n, M);
        im.setColorAt(n, c.setRGB(...col).multiplyScalar(0.6 + rnd() * 0.6));
        n++;
      }
    }
    im.count = n;
    im.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  #ifdef USE_INSTANCING_COLOR
    totalEmissiveRadiance = vColor * 1.2 * (0.35 + 0.5 * pow(max(dot(normalize(vNormal), mat3(viewMatrix) * vec3(0.0, -1.0, 0.0)), 0.0), 2.0));
  #endif`).replace('#include <color_fragment>', '');
    };
    im.material.customProgramCacheKey = () => 'forest-fungi';
    im.computeBoundingSphere();
    out.push(im);
  }
  for (const m of out) scene.add(m);
  return { meshes: out, update: (t, pr) => { out[0].material.uniforms.time.value = t; out[1].material.uniforms.pr.value = pr; } };
}
