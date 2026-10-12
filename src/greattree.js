// The Great Tree: a colossus whose roots grip a floating rock - they pour over its rim and hang hundreds of metres
// into the abyss below it - and whose trunk rises ~500 m through the track's spiral (one turn round it, 175 m out)
// into a crown of limbs 600 m across, hung with vines, the light coming through it in shafts. Built like the small
// trees (tubes, leaf cards in clusters) at its own scale: fluted bark, buttresses running down into the roots.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm, smoothstep } from './noise.js';

const TAU = Math.PI * 2;
const curve3 = (pts, n) => new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(n);

// a tube along a path: radius per point, flutes (deep grooves round it), uv in bark units (the bark shader's)
function tube(path, radii, seg, { flutes = 0, flute = 0, twist = 0, barkScale = 1.5 } = {}) {
  const pos = [], nrm = [], uv = [], idx = [], wind = [];
  let N = new THREE.Vector3(1, 0, 0);
  const T0 = path[1].clone().sub(path[0]).normalize();
  if (Math.abs(T0.dot(N)) > 0.9) N.set(0, 0, 1);
  N.addScaledVector(T0, -N.dot(T0)).normalize();
  let along = 0;
  for (let i = 0; i < path.length; i++) {
    const T = (i < path.length - 1 ? path[i + 1].clone().sub(path[i]) : path[i].clone().sub(path[i - 1])).normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    const B = new THREE.Vector3().crossVectors(T, N);
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    const r0 = radii[i], circ = TAU * r0;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU + twist * along;
      const fl = flutes ? 1 + flute * (Math.pow(Math.max(0, Math.cos(a * flutes)), 3) - 0.3) : 1;
      const n = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      const p = path[i].clone().addScaledVector(n, r0 * fl);
      pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z);
      uv.push((j / seg) * circ / (barkScale * 9), along / 2 / barkScale); wind.push(0);
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, d = a + seg + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// C: the trunk's axis (x, z); rock: the root island's shape (islands.js islandShape) - its top and rim
export function greatTree(C, rock, leafCards) {
  const rnd = mulberry32(2718);
  const base = rock.I.top + 2, fork = 60;
  const wood = [], leaves = [], strands = [];
  // the trunk: fluted, leaning a little, narrowing from 62 m at the rock to 34 m at the fork
  const trunkPath = curve3([new THREE.Vector3(C.x, base - 20, C.z), new THREE.Vector3(C.x + 4, base + 120, C.z - 3),
    new THREE.Vector3(C.x - 3, -150, C.z + 2), new THREE.Vector3(C.x + 2, -20, C.z - 4), new THREE.Vector3(C.x, fork, C.z)], 48);
  const r0 = 62, r1 = 34, ys = trunkPath.map((p) => p.y);
  const trunkR = (y) => r1 + (r0 - r1) * Math.pow(smoothstep(fork, base, y), 1.6) + 26 * Math.pow(smoothstep(base + 70, base, y), 2);
  wood.push(tube(trunkPath, ys.map(trunkR), 72, { flutes: 9, flute: 0.22, twist: 0.0015 }));
  // roots: from the trunk's foot over the rock's top, over its rim, and down into the abyss - tapering tendrils
  const NR = 13;
  for (let k = 0; k < NR; k++) {
    const a = (k / NR) * TAU + rnd() * 0.3, rim = rock.rimAt(a - (rock.I.rot || 0));
    const out = rim.out, p0 = new THREE.Vector3(C.x, base + 10, C.z).addScaledVector(out, 40);
    const p1 = new THREE.Vector3(C.x, base + 4, C.z).lerp(rim.p, 0.55).setY(base + 2);
    const p2 = rim.p.clone().addScaledVector(out, 8).setY(rim.y + 2);
    const p3 = rim.p.clone().addScaledVector(out, 16).setY(rim.y - 40);
    const hang = 180 + rnd() * 280, drift = new THREE.Vector3((rnd() - 0.5) * 60, 0, (rnd() - 0.5) * 60);
    const p4 = p3.clone().addScaledVector(out, 20 + rnd() * 30).add(new THREE.Vector3(0, -hang * 0.5, 0)).add(drift);
    const p5 = p4.clone().addScaledVector(out, rnd() * 25).add(new THREE.Vector3(0, -hang * 0.5, 0)).add(drift);
    const path = curve3([p0, p1, p2, p3, p4, p5], 40), R0 = 9 + rnd() * 6;
    wood.push(tube(path, path.map((_, i) => R0 * Math.pow(1 - i / path.length, 1.25) + 0.6), 14, { flutes: 3, flute: 0.15 }));
    // finer roots off it, hanging
    for (let q = 0; q < 3; q++) {
      const s = path[Math.floor(20 + rnd() * 14)], L = 60 + rnd() * 160;
      const sp = curve3([s, s.clone().add(new THREE.Vector3((rnd() - 0.5) * 20, -L * 0.5, (rnd() - 0.5) * 20)), s.clone().add(new THREE.Vector3((rnd() - 0.5) * 40, -L, (rnd() - 0.5) * 40))], 14);
      wood.push(tube(sp, sp.map((_, i) => 2.2 * (1 - i / sp.length) + 0.3), 7));
    }
  }
  // the limbs: from the fork, out and up, drooping at their ends; each with branches, each branch's end a crown cluster
  const NL = 11, clusters = [];
  for (let k = 0; k < NL; k++) {
    const a = (k / NL) * TAU + rnd() * 0.35, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const L = 230 + rnd() * 110, rise = 70 + rnd() * 90;
    const q0 = new THREE.Vector3(C.x, fork - 25 + rnd() * 30, C.z).addScaledVector(d, 10);
    const q1 = q0.clone().addScaledVector(d, L * 0.35).add(new THREE.Vector3(0, rise * 0.9, 0));
    const q2 = q0.clone().addScaledVector(d, L * 0.75).add(new THREE.Vector3(0, rise, 0));
    const q3 = q0.clone().addScaledVector(d, L).add(new THREE.Vector3(0, rise * 0.55, 0));
    const path = curve3([q0, q1, q2, q3], 26), R0 = 14 + rnd() * 5;
    wood.push(tube(path, path.map((_, i) => R0 * (1 - 0.8 * i / path.length) + 1), 18, { flutes: 4, flute: 0.12 }));
    for (let b = 0; b < 4; b++) {
      const at = path[Math.floor(8 + rnd() * 16)], side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(rnd() < 0.5 ? -1 : 1);
      const bl = 50 + rnd() * 70, e = at.clone().addScaledVector(side, bl * 0.7).addScaledVector(d, bl * 0.5).add(new THREE.Vector3(0, bl * 0.35, 0));
      const bp = curve3([at, at.clone().lerp(e, 0.5).add(new THREE.Vector3(0, bl * 0.15, 0)), e], 10);
      wood.push(tube(bp, bp.map((_, i) => 4.5 * (1 - 0.75 * i / bp.length) + 0.5), 9));
      clusters.push(e);
    }
    clusters.push(q3, q2.clone().add(new THREE.Vector3(0, 18, 0)));
    // vines off the limb: long where it is far out (beyond the spiral), short over it
    for (let v = 0; v < 26; v++) {
      const p = path[Math.floor(4 + rnd() * 21)], r = Math.hypot(p.x - C.x, p.z - C.z);
      const maxLen = r < 240 ? Math.max(0, p.y - -40) : 160;
      if (maxLen < 4) continue;
      strands.push({ p: p.clone().add(new THREE.Vector3(0, -R0 * 0.5, 0)), len: Math.min(maxLen, 8 + Math.pow(rnd(), 1.3) * 150), wid: 2.5 + rnd() * 3 });
    }
  }
  clusters.push(new THREE.Vector3(C.x, fork + 120, C.z));
  // the crown: big clusters of leaf cards (a few metres each - the leaves themselves at their own size)
  for (const c of clusters) {
    const R = 28 + rnd() * 18;
    for (let n = 0; n < 190; n++) {
      const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.4 - 0.4, rnd() * 2 - 1).normalize();
      const p = c.clone().addScaledVector(d, R * Math.cbrt(rnd()));
      leaves.push({ c: p, s: 8 + rnd() * 8, out: p.clone().sub(c).normalize(), wind: 0.25, ao: 0.35 + 0.65 * smoothstep(-R, R, p.y - c.y) });
      // strands hanging from the crown's underside
      if (d.y < -0.2 && rnd() < 0.07) {
        const r = Math.hypot(p.x - C.x, p.z - C.z), maxLen = r < 240 ? Math.max(0, p.y + 40) : 200;
        if (maxLen > 6) strands.push({ p: p.clone(), len: Math.min(maxLen, 10 + rnd() * 90), wid: 3 + rnd() * 3 });
      }
    }
  }
  return { wood: mergeGeometries(wood), leaves: leafCards(leaves), strands, base, fork, trunkR };
}
