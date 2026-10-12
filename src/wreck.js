// The derelict: a colossal old ship lying off the space circuit, broken in three, and the graveyard of smaller wrecks
// drifting off its bow (where everything lies, and the way through: wreckplan.js). The way threads it for ~12 km: in
// through the bell of its main engine, the reactor hall where the core still burns in its rings, arcing, the dead
// machinery, the ruptured fore end of the stern piece in the sun; two jumps across where it broke, through the piece
// that snapped out between; the cargo holds (collapsed bulkheads, the hold where gravity turns over), the hangar's
// racks of fighters, out through a breach in its flank among the graveyard's hulks; back along its back in a trench
// between armour and turret ruins, over the break, through the command tower and down off the stern.
//
// Every piece is built round one description of its hull: a long octagon in section (tapered at the bow), its holes and
// torn ends given in (z along the axis, metres round it). The same description is
//  - the plating's mesh: cells cut where a hole's edge runs (marching squares, finer near an edge), the edge given its
//    thickness and the plates round it bent outward; an inner skin, ring frames;
//  - the sun's light inside (every lit material, look.js's light loop): a ray from each pixel toward the sun is tested
//    against every piece - its faces, holes, frames and bulkheads - so the sun only comes in where the hull is open, in
//    shafts striped by the frames, with a penumbra as wide as the sun's disc makes it;
//  - the sky light inside (an ambient cube per cell, rays through the same holes, worked out only where it is used).
// Drawn in chunks: each piece's geometry in 160 m lengths and three layers - the shell (both skins, the big things
// outside: seen from anywhere on the circuit), the main (frames, decks, machinery: within 1.8 km), the detail (small
// parts: within 500 m). What repeats (fighters, containers, turrets, racks, debris) is instanced in groups, each drawn
// within its own reach.
// No text, numbers, signs or markings anywhere: plates, seams, hatches, vents, wear and soot only.
import * as THREE from 'three';
import { mulberry32, noise2, smoothstep, clamp } from './noise.js';
import { hullMaps } from './hull.js';
import { Q } from './quality.js';
import { PIECES, FRIGATE, GRAVEYARD } from './wreckplan.js';
import { buildZones } from './wreckzones.js';

const TAU = Math.PI * 2;
const CHUNK = 160;                                            // a chunk's length along its piece (m)
// how far each layer is drawn (m, to its chunk's sphere); 'cast' is the shell's that throws shadows (the trench's walls)
const RANGE = { shell: 1e9, cast: 1e9, main: 1800, detail: 500 };
const ihash = (n) => { let h = Math.imul(n | 0, 374761393) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const f5 = (x) => (Math.abs(x) < 1e-9 ? '0.0' : x.toFixed(5));
const g3v = (v) => `vec3(${f5(v.x)}, ${f5(v.y)}, ${f5(v.z)})`;

// a lamp's brightness at t (the shader's wFlicker, the same numbers): a slow breath, and a third of them failing -
// dropping out, stuttering, out for a while now and then. Ids from 60000: screens, breathing slowly
export function lampFlicker(i, t, fx = true) {
  if (i >= 60000) return 0.75 + 0.25 * Math.sin(t * 0.6 + i);
  const ph = ihash(i * 7919 + 3) * 6.2832;
  let f = 0.86 + 0.14 * Math.sin(t * 1.7 + ph);
  if (fx && ihash(i * 104729 + 5) < 0.35) {
    const h = ihash(Math.floor(t * 9 + ph * 13) * 31 + i * 977), out = ihash(Math.floor(t * 0.4 + ph) * 7 + i * 131) < 0.3;
    f *= out ? 0.03 : h < 0.22 ? 0.06 : h < 0.35 ? 0.45 : 1;
  }
  return f;
}

// ---- a section: the long octagon (x, y) round the axis, counter-clockwise seen from the bow
const octOf = ({ hw, hh, ct, cb }) => [[hw - ct, hh], [-(hw - ct), hh], [-hw, hh - ct], [-hw, -hh + cb], [-(hw - cb), -hh], [hw - cb, -hh],
  [hw, -hh + cb], [hw, hh - ct]];

// ---------------------------------------------------------------- geometry accumulation
// per vertex: position, normal, wUV (metres across / along the face), wT (direction u runs in), wA (kind, sky light,
// soot, seed), wC (paint colour, or a lamp's colour). Built packed (40 bytes, not 72): the directions in bytes, wA in
// 16-bit integers (sky and soot x 60000; the seed a lamp's number - 65535 the reactor's glow - or a cable's sway x 1000),
// the colour in bytes
export const K_HULL = 0, K_INNER = 1, K_FRAME = 2, K_MACH = 3, K_TORN = 4, K_DECK = 5, K_LAMP = 6, K_CABLE = 7;
class Geo {
  constructor() { this.P = []; this.N = []; this.UV = []; this.T = []; this.A = []; this.C = []; this.I = []; this.n = 0; }
  v(p, n, u, v, t, a, c) {
    this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.UV.push(u, v); this.T.push(t.x, t.y, t.z);
    this.A.push(a[0], a[1], a[2], a[3]); this.C.push(c[0], c[1], c[2]);
    return this.n++;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  build() {
    if (!this.n) return null;
    const n = this.n, A = this.A, nrm = new Int8Array(n * 3), tan = new Int8Array(n * 3), wa = new Uint16Array(n * 4), wc = new Uint8Array(n * 3);
    const q8 = (x) => Math.max(-127, Math.min(127, Math.round(x * 127)));
    for (let i = 0; i < n * 3; i++) { nrm[i] = q8(this.N[i]); tan[i] = q8(this.T[i]); wc[i] = Math.max(0, Math.min(255, Math.round(this.C[i] * 255))); }
    for (let i = 0; i < n; i++) {
      const k = A[i * 4], s = A[i * 4 + 3];
      wa[i * 4] = k; wa[i * 4 + 1] = Math.round(clamp(A[i * 4 + 1], 0, 1) * 60000); wa[i * 4 + 2] = Math.round(clamp(A[i * 4 + 2], 0, 1) * 60000);
      wa[i * 4 + 3] = k === K_CABLE ? Math.round(clamp(s, 0, 60) * 1000) : s < 0 ? 65535 : Math.min(65534, Math.round(Math.abs(s)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('wUV', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('wT', new THREE.BufferAttribute(tan, 3, true));
    g.setAttribute('wA', new THREE.BufferAttribute(wa, 4));
    g.setAttribute('wC', new THREE.BufferAttribute(wc, 3, true));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- a piece's hull
// Its frame: x across (starboard), y up, z along the axis aft from its forward end. The hull: the octagon, scaled
// tip..1 over the first `taper` m (a bow), holes in (z, angle round the axis), torn ends, frames every few tens of
// metres (they stay across a hole: shafts of light are striped by them), bulkheads.
class Hull {
  constructor(d) {
    Object.assign(this, { cap0: 'closed', cap1: 'closed', holes: [], edge0: null, edge1: null, bulkheads: [], sternHole: null,
      taper: 0, tip: 1, shade: true, ribFrom: 0 }, d);
    const v3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
    this.O = v3(d.O); this.X = v3(d.X); this.Y = v3(d.Y); this.Z = v3(d.Z);
    const s = d.sec;
    this.OCT = octOf(s);
    this.OCTN = this.OCT.map((a, i) => { const b = this.OCT[(i + 1) % 8], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; });
    this.HW = s.hw; this.HH = s.hh; this.SKIN = s.skin; this.RIB = s.ribEvery; this.RIBW = s.ribW; this.RIBD = s.ribD;
    this.ribTo ??= this.len;
    let per = 0;
    this.OCT.forEach((a, i) => { const b = this.OCT[(i + 1) % 8]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); });
    this.ang = per / TAU;                                // metres round the hull per radian (near enough, an octagon)
    this.scale = clamp(this.HW / 115, 0.4, 2);           // the old 230 m hull's sizes: peel, cells, lamps
    this.boxes = [];                                     // solid blocks outside the hull that throw shadows too
    this.ribCuts = [];                                   // where frames are torn away (a breach): holes' ellipses
    this.M = new THREE.Matrix4().makeBasis(this.X, this.Y, this.Z).setPosition(this.O);
    this.Mi = this.M.clone().invert();
    // the faces as planes n.p <= d (local): 8 sides, 8 taper faces (a bow), the two ends
    this.planes = [];
    this.OCT.forEach((a, i) => { const n = this.OCTN[i]; this.planes.push({ n: new THREE.Vector3(n[0], n[1], 0), d: n[0] * a[0] + n[1] * a[1], face: i }); });
    if (this.taper > 0) {
      this.OCT.forEach((a, i) => {
        const b = this.OCT[(i + 1) % 8], tip = this.tip;
        const p0 = new THREE.Vector3(tip * a[0], tip * a[1], 0), p1 = new THREE.Vector3(tip * b[0], tip * b[1], 0), p2 = new THREE.Vector3(a[0], a[1], this.taper);
        const n = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).normalize();
        if (n.x * this.OCTN[i][0] + n.y * this.OCTN[i][1] < 0) n.negate();
        this.planes.push({ n, d: n.dot(p0), face: 8 + i });
      });
    }
    this.planes.push({ n: new THREE.Vector3(0, 0, -1), d: 0, face: 16 });
    this.planes.push({ n: new THREE.Vector3(0, 0, 1), d: this.len, face: 17 });
  }

  // the octagon scaled k, inset by d (offset lines meet at the bisectors)
  inset(k, d) {
    return this.OCT.map((v, i) => {
      const na = this.OCTN[(i + 7) % 8], nb = this.OCTN[i], s = 1 + na[0] * nb[0] + na[1] * nb[1];
      return [k * v[0] - d * (na[0] + nb[0]) / s, k * v[1] - d * (na[1] + nb[1]) / s];
    });
  }
  k(z) { return this.taper > 0 && z < this.taper ? this.tip + (1 - this.tip) * Math.max(0, z) / this.taper : 1; }
  toLocal(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.Mi); }
  toWorld(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.M); }
  dirLocal(d, out = new THREE.Vector3()) { return out.set(d.dot(this.X), d.dot(this.Y), d.dot(this.Z)); }
  dirWorld(d, out = new THREE.Vector3()) { return out.set(0, 0, 0).addScaledVector(this.X, d.x).addScaledVector(this.Y, d.y).addScaledVector(this.Z, d.z); }

  // a hole's (or a frames' cut's) coordinates at (z, angle): the offsets from its centre in (z, metres round), turned by
  // its rot, over its radii (rz, rt m); inside its plain ellipse where u^2 + v^2 < 1
  holeUV(h, z, th) {
    const dz = z - h.z, dt = wrapA(th - h.t) * this.ang, c = Math.cos(h.rot || 0), sn = Math.sin(h.rot || 0);
    return [(dz * c + dt * sn) / h.rz, (-dz * sn + dt * c) / h.rt];
  }
  holeGLSL(h) {
    const c = Math.cos(h.rot || 0), sn = Math.sin(h.rot || 0);
    return `float dz = z - ${f5(h.z)}, dt = wkWrap( th - ${f5(h.t)} ) * ${f5(this.ang)};
	  float u = ( dz * ${f5(c)} + dt * ${f5(sn)} ) * ${f5(1 / h.rz)}, v = ( dt * ${f5(c)} - dz * ${f5(sn)} ) * ${f5(1 / h.rt)};`;
  }

  // the plating's field at (z, angle): > 0 plate, < 0 a hole (about metres from the edge); the hole it is nearest
  field(z, th, out = null) {
    let f = 1e4, which = -1;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i], [u, v] = this.holeUV(h, z, th), r2 = u * u + v * v;
      if (r2 >= 2.2 * 2.2) continue;
      const ph = Math.atan2(v, u);
      const b = 1 + h.a[0] * Math.sin(2 * ph + h.p[0]) + h.a[1] * Math.sin(5 * ph + h.p[1]) + h.a[2] * Math.sin(11 * ph + h.p[2]) + h.a[3] * Math.sin(23 * ph + h.p[3]);
      const val = (Math.sqrt(r2) - b) * h.s;
      if (val < f) { f = val; which = i; }
    }
    for (const [e, sign, end] of [[this.edge0, 1, 0], [this.edge1, -1, this.len]]) {
      if (!e) continue;
      const lim = end + sign * (e.d + e.a[0] * (0.5 + 0.5 * Math.sin(3 * th + e.p[0])) + e.a[1] * Math.sin(7 * th + e.p[1]) + e.a[2] * Math.sin(17 * th + e.p[2]));
      const val = sign * (z - lim);
      if (val < f) { f = val; which = 100 + end; }
    }
    if (out) out.which = which;
    return f;
  }
  inRibCut(z, th) {
    for (const c of this.ribCuts) { const [u, v] = this.holeUV(c, z, th); if (u * u + v * v < 1) return true; }
    return false;
  }
  ribBand(z, th = null) {
    if (z < this.ribFrom - this.RIBW || z > this.ribTo + this.RIBW) return 0;
    if (th != null && this.inRibCut(z, th)) return 0;
    const m = ((z - this.ribFrom) % this.RIB + this.RIB) % this.RIB, d = Math.min(m, this.RIB - m);
    return d < this.RIBW ? 1 : 0;
  }
  // light through a point e of the surface (local) on face `face` (1 open .. 0 blocked)
  pass(e, face) {
    if (face === 16) return this.cap0 === 'open' ? 1 : 0;
    if (face === 17) {
      if (this.cap1 === 'open') return 1;
      const h = this.sternHole;
      return h && Math.hypot(e.x - h.x, e.y - h.y) < h.r ? 1 : 0;
    }
    const th = Math.atan2(e.y, e.x);
    if (this.field(e.z, th) > 0) return 0;
    return 1 - this.ribBand(e.z, th);
  }
  // the box round the piece and its blocks outside (its own axes), once they are all there
  bounds() {
    const b = new THREE.Box3(new THREE.Vector3(-this.HW, -this.HH, 0), new THREE.Vector3(this.HW, this.HH, this.len));
    for (const x of this.boxes) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.expandByPoint(x.c.clone().addScaledVector(x.ax, sx * x.h[0]).addScaledVector(x.ay, sy * x.h[1]).addScaledVector(x.az, sz * x.h[2]));
    this.aabb = b.expandByScalar(2);
  }
  // the light reaching local point p along local direction d (1 .. 0)
  ray(p, d) {
    if (this.aabb) {
      const b = this.aabb;
      let t0 = 0, t1 = 1e9;
      for (const k of ['x', 'y', 'z']) {
        if (Math.abs(d[k]) < 1e-9) { if (p[k] < b.min[k] || p[k] > b.max[k]) return 1; continue; }
        const a = (b.min[k] - p[k]) / d[k], c = (b.max[k] - p[k]) / d[k];
        t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      }
      if (t1 <= t0) return 1;
    }
    for (const b of this.boxes) {
      const q = _r0.copy(p).sub(b.c), o = [q.dot(b.ax), q.dot(b.ay), q.dot(b.az)], dd = [d.dot(b.ax), d.dot(b.ay), d.dot(b.az)];
      let tn = -1e9, tf = 1e9;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(dd[i]) < 1e-9) { if (Math.abs(o[i]) > b.h[i]) { tn = 1e9; break; } continue; }
        const t0 = (-b.h[i] - o[i]) / dd[i], t1 = (b.h[i] - o[i]) / dd[i];
        tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
      }
      if (tf > Math.max(tn, 0)) return 0;
    }
    let tx = 1e9, tn = -1e9, fx = -1, fn = -1;
    for (const pl of this.planes) {
      const den = pl.n.dot(d), num = pl.d - pl.n.dot(p);
      if (Math.abs(den) < 1e-9) { if (num < 0) return 1; continue; }
      const t = num / den;
      if (den > 0) { if (t < tx) { tx = t; fx = pl.face; } } else if (t > tn) { tn = t; fn = pl.face; }
    }
    if (tx <= Math.max(tn, 0)) return 1;
    const e = _r1;
    let k = 1;
    if (tn > 0) k *= this.pass(e.copy(p).addScaledVector(d, tn), fn);
    if (k > 0) k *= this.pass(e.copy(p).addScaledVector(d, tx), fx);
    for (const b of this.bulkheads) {
      if (k <= 0) break;
      const t = (b.z - p.z) / d.z;
      if (!(t > Math.max(tn, 0) && t < tx)) continue;
      e.copy(p).addScaledVector(d, t);
      if (Math.abs(e.x - b.x) > b.hx || Math.abs(e.y - b.y) > b.hy) k = 0;
    }
    return k;
  }

  // the same test in GLSL: name(p world) -> 1 lit .. 0 in shadow
  glsl(name, sunL) {
    const D = sunL, P = this.planes;
    const holes = this.holes.map((h) => `
	if ( abs( z - ${f5(h.z)} ) < ${f5(2.3 * Math.max(h.rz, h.rt))} ) { ${this.holeGLSL(h)} float r2 = u * u + v * v;
	  if ( r2 < ${f5(2.2 * 2.2)} ) { float ph = atan( v, u );
	    float b = 1.0 + ${f5(h.a[0])} * sin( 2.0 * ph + ${f5(h.p[0])} ) + ${f5(h.a[1])} * sin( 5.0 * ph + ${f5(h.p[1])} ) + ${f5(h.a[2])} * sin( 11.0 * ph + ${f5(h.p[2])} ) + ${f5(h.a[3])} * sin( 23.0 * ph + ${f5(h.p[3])} );
	    f = min( f, ( sqrt( r2 ) - b ) * ${f5(h.s)} ); } }`).join('');
    const edges = [[this.edge0, 1, 0], [this.edge1, -1, this.len]].filter(([e]) => e).map(([e, sign, end]) => `
	f = min( f, ${f5(sign)} * ( z - ( ${f5(end)} + ${f5(sign)} * ( ${f5(e.d)} + ${f5(e.a[0])} * ( 0.5 + 0.5 * sin( 3.0 * th + ${f5(e.p[0])} ) ) + ${f5(e.a[1])} * sin( 7.0 * th + ${f5(e.p[1])} ) + ${f5(e.a[2])} * sin( 17.0 * th + ${f5(e.p[2])} ) ) ) ) );`).join('');
    const cap = (c) => (c === 'open' ? '1.0' : c === 'closed' || !this.sternHole ? '0.0'
      : `1.0 - smoothstep( ${f5(this.sternHole.r)} - w, ${f5(this.sternHole.r)} + w, length( e.xy - vec2( ${f5(this.sternHole.x)}, ${f5(this.sternHole.y)} ) ) )`);
    const lines = [];
    for (const pl of P) {
      const den = pl.n.dot(D);
      if (Math.abs(den) < 1e-6) { lines.push(`\tif ( ${f5(pl.d)} - dot( ${g3v(pl.n)}, p ) < 0.0 ) return 1.0;`); continue; }
      const t = `( ${f5(pl.d)} - dot( ${g3v(pl.n)}, p ) ) * ${f5(1 / den)}`;
      lines.push(den > 0 ? `\t{ float t = ${t}; if ( t < tx ) { tx = t; fx = ${pl.face}; } }` : `\t{ float t = ${t}; if ( t > tn ) { tn = t; fn = ${pl.face}; } }`);
    }
    const bulk = this.bulkheads.map((b) => {
      if (Math.abs(D.z) < 1e-6) return '';
      return `
	{ float t = ( ${f5(b.z)} - p.z ) * ${f5(1 / D.z)};
	  if ( t > max( tn, 0.0 ) && t < tx ) { vec2 q = abs( ( p + t * D ).xy - vec2( ${f5(b.x)}, ${f5(b.y)} ) ) - vec2( ${f5(b.hx)}, ${f5(b.hy)} );
	    float w = 0.05 + 0.0047 * t; k *= 1.0 - smoothstep( -w, w, max( q.x, q.y ) ); } }`;
    }).join('');
    const cuts = this.ribCuts.map((c) => `
	{ ${this.holeGLSL(c)} if ( u * u + v * v < 1.0 ) rib = 0.0; }`).join('');
    return `
float ${name}_field( float z, float th ) {
	float f = 1e4;${holes}${edges}
	return f;
}
float ${name}_pass( vec3 e, int face, float w ) {
	if ( face == 16 ) return ${cap(this.cap0)};
	if ( face == 17 ) return ${cap(this.cap1)};
	float z = e.z, th = atan( e.y, e.x );
	float f = ${name}_field( z, th );
	float open = 1.0 - smoothstep( -w, w, f );
	if ( open <= 0.0 ) return 0.0;
	float m = mod( z - ${f5(this.ribFrom)}, ${f5(this.RIB)} ), rd = min( m, ${f5(this.RIB)} - m );
	float rib = ( z > ${f5(this.ribFrom - this.RIBW)} && z < ${f5(this.ribTo + this.RIBW)} ) ? 1.0 - smoothstep( ${f5(this.RIBW)} - w, ${f5(this.RIBW)} + w, rd ) : 0.0;${cuts}
	return open * ( 1.0 - rib );
}
float ${name}( vec3 w ) {
	vec3 q = w - ${g3v(this.O)};
	vec3 p = vec3( dot( q, ${g3v(this.X)} ), dot( q, ${g3v(this.Y)} ), dot( q, ${g3v(this.Z)} ) );
	const vec3 D = ${g3v(D)};
	// the ray against the box round the piece and its blocks (its own axes): most rays miss it - nothing more to test
	{ vec3 t0 = ( ${g3v(this.box.min)} - p ) * ${g3v(this.box.inv)}, t1 = ( ${g3v(this.box.max)} - p ) * ${g3v(this.box.inv)};
	  vec3 a = min( t0, t1 ), c = max( t0, t1 );
	  if ( min( min( c.x, c.y ), c.z ) <= max( max( max( a.x, a.y ), a.z ), 0.0 ) ) return 1.0; }
	float k = 1.0, tx = 1e9, tn = -1e9; int fx = -1, fn = -1;
${lines.join('\n')}
	if ( tx > max( tn, 0.0 ) ) {
		if ( tn > 0.0 ) k *= ${name}_pass( p + tn * D, fn, 0.05 + 0.0047 * tn );
		if ( k > 0.0 ) k *= ${name}_pass( p + tx * D, fx, 0.05 + 0.0047 * tx );${bulk}
		if ( k <= 0.0 ) return 0.0;
	}
	${this.boxes.map((b) => {
    const dd = [D.dot(b.ax), D.dot(b.ay), D.dot(b.az)].map((x) => (Math.abs(x) < 1e-6 ? 1e-6 : x));
    return `
	{ vec3 o = p - ${g3v(b.c)}; o = vec3( dot( o, ${g3v(b.ax)} ), dot( o, ${g3v(b.ay)} ), dot( o, ${g3v(b.az)} ) );
	  vec3 inv = vec3( ${dd.map((x) => f5(1 / x)).join(', ')} ), h = vec3( ${b.h.map(f5).join(', ')} );
	  vec3 t0 = ( -h - o ) * inv, t1 = ( h - o ) * inv, a = min( t0, t1 ), c = max( t0, t1 );
	  float tn = max( max( a.x, a.y ), a.z ), tf = min( min( c.x, c.y ), c.z );
	  k *= 1.0 - smoothstep( 0.0, 0.3 + 0.01 * max( tn, 0.0 ), tf - max( tn, 0.0 ) ); }`;
  }).join('')}

	return k;
}
`;
  }
}
const _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3();

// ---------------------------------------------------------------- the material
// One program for all of it (few draws): plates and seams worked out per pixel in metres on each face (as the track's
// steel, hull.js), each kind its own layout - armour panels in staggered rows with hatches and louvred vents, the inner
// skin's corrugated panels, frames, machinery, torn and burnt edges, tread plate; paint faded and chipped to bare metal
// at the edges, soot round the holes, grime streaks. The emergency lamps' light (the eight nearest the camera,
// flickering - worked out here from each lamp's number, as lampFlicker) is added per pixel; the sky's light is scaled
// by each vertex's view of the sky (an instance's: iSky). An instance's colour tints its paint.
export function wreckMaterial() {
  const U = { wTime: { value: 0 }, wLampP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e6, 0, 1)) },
    wLampC: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, wLampS: { value: new Float32Array(8).fill(4) }, wFx: { value: 1 }, wGlow: { value: 1 },
    hullNoise: { value: null }, wSway: { value: 1 } };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.hullNoise.value = hullMaps();
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 wUV; attribute vec3 wT; attribute vec4 wA; attribute vec3 wC;
#ifdef USE_INSTANCING
attribute float iSky;
#endif
varying vec2 vWUV; varying vec3 vWT; varying vec4 vWA; varying vec3 vWC;
uniform float wTime, wSway, wFx, wGlow;
float wIh( int n ) { uint h = uint( n ) * 374761393u ^ 0x5bd1e995u; h = ( h ^ ( h >> 13u ) ) * 1274126177u; return float( h ^ ( h >> 16u ) ) * 2.3283064e-10; }
float wFlicker( float id ) {
	int i = int( id );
	if ( i >= 60000 ) return 0.75 + 0.25 * sin( wTime * 0.6 + id );
	float ph = wIh( i * 7919 + 3 ) * 6.2832, f = 0.86 + 0.14 * sin( wTime * 1.7 + ph );
	if ( wFx > 0.5 && wIh( i * 104729 + 5 ) < 0.35 ) {
		float h = wIh( int( floor( wTime * 9.0 + ph * 13.0 ) ) * 31 + i * 977 );
		bool gone = wIh( int( floor( wTime * 0.4 + ph ) ) * 7 + i * 131 ) < 0.3;
		f *= gone ? 0.03 : h < 0.22 ? 0.06 : h < 0.35 ? 0.45 : 1.0;
	}
	return f;
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  if ( wA.x > 6.5 ) {
    float ph = dot( position, vec3( 0.013, 0.021, 0.017 ) );
    transformed += vec3( sin( wTime * 0.43 + ph ), 0.4 * sin( wTime * 0.31 + ph * 1.7 ), cos( wTime * 0.37 + ph * 1.3 ) ) * wA.w * 0.001 * wSway;
  }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vWUV = wUV; vWA = vec4( wA.x, wA.yz * ( 1.0 / 60000.0 ), wA.w ); vWC = wC;
  if ( wA.x > 6.5 ) vWA = vec4( 3.0, vWA.yz, 0.0 );
  {
    vec3 ht = wT;
  #ifdef USE_INSTANCING
    ht = mat3( instanceMatrix ) * ht;
    vWA.y *= iSky;
  #endif
    vWT = normalize( ( viewMatrix * vec4( mat3( modelMatrix ) * ht, 0.0 ) ).xyz );
  }
  if ( wA.x > 5.5 && wA.x < 6.5 ) vWC *= wA.w > 65000.0 ? wGlow : wFlicker( wA.w );`);
    sh.fragmentShader = (Q.lite ? '#define WRECK_LITE\n' : '') + sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D hullNoise; uniform vec4 wLampP[8]; uniform vec3 wLampC[8]; uniform float wLampS[8];
varying vec2 vWUV; varying vec3 vWT; varying vec4 vWA; varying vec3 vWC;
float wHash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
// a seam of half-width hw at distance d (>= 0) from its line, box-filtered over a pixel fp m wide: how much of the
// pixel it covers (a seam thinner than the pixel fades instead of drawing a pixel-wide line: no brick pattern far off)
float wGroove( float d, float hw, float fp ) {
	float w = max( fp, 1e-4 );
	return clamp( ( min( d + 0.5 * w, hw ) - max( d - 0.5 * w, -hw ) ) / w, 0.0, 1.0 );
}
float wRoundBox( vec2 p, vec2 b, float r ) { vec2 q = abs( p ) - b + r; return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r; }
// the relief (mm) of a kind's layout at uv (m); id: the plate's identity; feat: x hatch, y vent, z hole (frames)
float wRelief( vec2 uv, float kind, float fp, float W, out vec2 id, out vec3 feat ) {
	feat = vec3( 0.0 ); id = vec2( 0.0 );
	float h = 0.0;
	if ( kind < 0.5 ) {
		// armour: rows 8 m across, each row's panels its own length (12, 16 or 20 m) and offset; each panel raised its
		// own few mm; plates of 4 x 4.5 m inside
		float row = floor( uv.x / 8.0 ), rh = wHash( vec2( row, 7.3 ) );
		vec2 P = vec2( 8.0, 12.0 + 4.0 * floor( rh * 2.999 ) );
		vec2 q = vec2( uv.x, uv.y + rh * P.y );
		id = floor( q / P );
		vec2 c = q - id * P, e = min( c, P - c );
		float r = wHash( id + 3.7 );
		h += 14.0 * r;
		h -= ( 40.0 + 14.0 * r ) * wGroove( min( e.x, e.y ), 0.07, fp );
		vec2 c2 = mod( c, vec2( 4.0, 4.5 ) ), e2 = min( c2, vec2( 4.0, 4.5 ) - c2 );
		h -= 9.0 * wGroove( min( e2.x, e2.y ), 0.025, fp ) * ( 1.0 - smoothstep( 0.05, 0.15, fp ) );
		vec2 m = c - P * 0.5;
		if ( r > 0.8 ) {                                           // a hatch: inset, its own seam, hinge blocks
			vec2 d = abs( m ) - vec2( 1.6, 2.4 );
			float dh = max( d.x, d.y );
			feat.x = 1.0 - smoothstep( -fp, fp, dh );
			h -= 18.0 * wGroove( abs( dh ), 0.04, fp ) + 6.0 * feat.x;
			vec2 hg = abs( vec2( m.x + 1.75, abs( m.y ) - 1.2 ) ) - vec2( 0.12, 0.35 );
			h += 25.0 * ( 1.0 - smoothstep( -fp, fp, max( hg.x, hg.y ) ) );
		} else if ( r > 0.62 ) {                                   // a louvred vent: slats every 0.3 m in a recess
			vec2 d = abs( m ) - vec2( 2.2, 3.4 );
			float dv = max( d.x, d.y );
			feat.y = 1.0 - smoothstep( -fp, fp, dv );
			float sl = fract( m.y / 0.3 );
			h += feat.y * ( -60.0 + 45.0 * mix( smoothstep( 0.0, 0.7, sl ) * ( 1.0 - smoothstep( 0.7, 1.0, sl ) ), 0.5, smoothstep( 0.03, 0.09, fp ) ) );
			h -= 12.0 * wGroove( abs( dv ), 0.05, fp );
		}
	} else if ( kind < 1.5 ) {
		// the inner skin: panels 3 m x 6 m, corrugated across
		vec2 P = vec2( 3.0, 6.0 );
		id = floor( uv / P );
		vec2 c = uv - id * P, e = min( c, P - c );
		h -= 20.0 * wGroove( min( e.x, e.y ), 0.05, fp );
		h += 8.0 * sin( c.x / 0.5 * 6.2832 ) * ( 1.0 - smoothstep( 0.04, 0.12, fp ) );
	} else if ( kind < 2.5 ) {
		// frames: seams every 6 m
		id = vec2( 0.0, floor( uv.y / 6.0 ) );
		float sv = mod( uv.y, 6.0 );
		h -= 10.0 * wGroove( min( sv, 6.0 - sv ), 0.03, fp );
	} else if ( kind < 3.5 ) {
		id = floor( uv / vec2( 2.0, 3.0 ) );
		vec2 c = mod( uv, vec2( 2.0, 3.0 ) ), e = min( c, vec2( 2.0, 3.0 ) - c );
		h -= 6.0 * wGroove( min( e.x, e.y ), 0.02, fp );
	} else if ( kind < 4.5 ) {
		h += 6.0 * ( wHash( floor( uv * 3.0 ) ) - 0.5 );
	} else {
		// tread plate: plates 2 x 4 m, raised diamonds every 0.12 m
		id = floor( uv / vec2( 2.0, 4.0 ) );
		vec2 c = mod( uv, vec2( 2.0, 4.0 ) ), e = min( c, vec2( 2.0, 4.0 ) - c );
		h -= 8.0 * wGroove( min( e.x, e.y ), 0.02, fp );
		vec2 g = fract( vec2( uv.x + uv.y, uv.x - uv.y ) / 0.17 ) - 0.5;
		h += 2.5 * ( 1.0 - smoothstep( 0.1, 0.2, abs( g.x ) * abs( g.y ) * 8.0 ) ) * ( 1.0 - smoothstep( 0.006, 0.02, fp ) );
	}
	return h;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	float wKind = vWA.x, wSoot = vWA.z, wSeed = vWA.w;
	vec2 wuv = vWUV;
	// v runs to kilometres: split into a 96 m period's index and the metres into it (float steps)
	float wvi = floor( wuv.y / 96.0 );
	vec2 wq = vec2( wuv.x, wuv.y - wvi * 96.0 );
	float wfp = max( length( vec2( dFdx( wq.x ), dFdy( wq.x ) ) ), length( vec2( dFdx( wq.y ), dFdy( wq.y ) ) ) );
	vec2 wid; vec3 wFeat;
	float wh = wRelief( wq, wKind, wfp, wSeed, wid, wFeat );
	vec2 wGrad = vec2( 0.0 );
#ifndef WRECK_LITE
	// (the screen-space changes taken here, outside any branch: they are undefined inside one that differs per pixel)
	vec2 dU = dFdx( vWUV ), dV = dFdy( vWUV );
	float dhx = dFdx( wh ), dhy = dFdy( wh ), det = dU.x * dV.y - dU.y * dV.x;
	if ( wfp < 0.02 ) {
		// near: the relief's slope by finite differences (a step no smaller than the pixel)
		float we = max( 0.004, wfp * 0.75 );
		vec2 wd1; vec3 wd2;
		float whx = wRelief( wq + vec2( we, 0.0 ), wKind, wfp, wSeed, wd1, wd2 ), why = wRelief( wq + vec2( 0.0, we ), wKind, wfp, wSeed, wd1, wd2 );
		wGrad = vec2( whx - wh, why - wh ) / we * 0.001;
	} else if ( wfp < 0.09 ) {
		// further: from the screen-space change of the one relief worked out (the uv's change solved for it)
		if ( abs( det ) > 1e-12 ) wGrad = vec2( dhx * dV.y - dhy * dU.y, dhy * dU.x - dhx * dV.x ) / det * 0.001 * ( 1.0 - smoothstep( 0.05, 0.09, wfp ) );
	}
#endif
	wid += vec2( wKind > 1.5 && wKind < 2.5 ? 0.0 : wSeed * 17.0, wvi * 7.0 );
	float wr = wHash( wid * vec2( 1.7, 3.1 ) + 0.5 );
	// grime (metres: broad 24 m, fine 6 m, flecks 1.5 m, streaks along v)
	vec2 wm = vec2( wq.y + mod( wvi, 8.0 ) * 96.0, wq.x );
	vec4 wn1 = texture2D( hullNoise, wm / 24.0 ), wn2 = texture2D( hullNoise, wm / 6.0 + 0.37 );
	vec2 wq3 = wm / 1.5 + 0.71, wq3x = dFdx( wq3 ), wq3y = dFdy( wq3 );
	vec4 wn3 = wfp < 0.05 ? textureGrad( hullNoise, wq3, wq3x, wq3y ) : vec4( 0.5 );
	float wStreak = wn2.a;
	// tone: whole sections of 40 x 56 m refitted or faded at different times, each panel a little its own, broad grime
	float wz = wHash( floor( vec2( wq.x / 40.0 + wSeed * 3.0, ( wq.y + mod( wvi, 64.0 ) * 96.0 ) / 56.0 ) ) + 1.3 );
	vec3 wPaint = vWC * ( 0.86 + 0.24 * wz ) * ( 0.94 + 0.12 * wr ) * ( 0.84 + 0.32 * wn1.r ) * ( 0.92 + 0.16 * wn2.g );
#ifdef USE_COLOR
	if ( wKind < 5.5 ) wPaint *= vColor;
#endif
	wPaint *= 1.0 - 0.3 * smoothstep( 0.55, 0.85, wStreak );
	if ( wKind < 0.5 ) wPaint *= mix( 1.0, 0.72, step( 0.9, wHash( wid + 9.1 ) ) );                    // replaced panels
	wPaint *= 1.0 - 0.6 * clamp( -wh / 50.0, 0.0, 1.0 );                                                  // seams, recesses
	wPaint = mix( wPaint, vec3( 0.006 ), wFeat.y * step( wh, -30.0 ) );                                  // the vents' depths
	// bare metal: chipped paint round raised edges and in flecks; torn edges all bare
	float wEdge = smoothstep( 0.0, 1.0, length( wGrad ) * 6.0 );
	float wWear = smoothstep( 0.78, 0.86, wn3.b * 0.6 + 0.4 * wEdge + 0.15 * wn2.g ) * ( 1.0 - smoothstep( 0.02, 0.06, wfp ) );
	if ( wKind > 3.5 && wKind < 4.5 ) wWear = 0.85;
	vec3 wBare = vec3( 0.2, 0.195, 0.19 ) * ( 0.7 + 0.4 * wn2.g );
	// soot and heat round the holes: black, and the bare metal blued / browned by the heat
	float wBurn = smoothstep( 0.2, 0.75, wSoot * ( 0.6 + 0.7 * wn1.r ) + 0.25 * ( wn2.g - 0.5 ) );
	wBare = mix( wBare, vec3( 0.12, 0.1, 0.16 ) + vec3( 0.18, 0.1, 0.0 ) * wn3.b, smoothstep( 0.1, 0.6, wSoot ) );
	diffuseColor.rgb = mix( wPaint, wBare, wWear );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.012, 0.011, 0.01 ) * ( 0.6 + 0.8 * wn2.g ), wBurn * 0.92 );
	float wRough = mix( 0.48 + 0.3 * wn1.r + 0.12 * wz, 0.32, wWear );
	wRough = mix( wRough, 0.92, wBurn );
	float wMetal = mix( 0.35, 0.85, wWear ) * ( 1.0 - 0.7 * wBurn );`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = wRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor = wMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{
		vec3 tu = normalize( vWT - normal * dot( vWT, normal ) ), tv = cross( normal, tu );
		normal = normalize( normal - tu * wGrad.x - tv * wGrad.y );
	}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	if ( wKind > 5.5 ) { totalEmissiveRadiance += vWC * 6.0; diffuseColor.rgb = vec3( 0.05 ); }`)
      .replace('#include <lights_fragment_end>', `{
		// (its own view of the sky in place of the shade round the deck - look.js's, applied after this)
		float wSky = vWA.y / max( vCaveK.y, 1e-3 );
		irradiance *= wSky; iblIrradiance *= wSky;
	#if defined( RE_IndirectSpecular )
		radiance *= wSky;
	#endif
	}
#include <lights_fragment_end>
	// the emergency lamps (the eight nearest): a pool of light each, wrapped a little round the surface (a flood's
	// light from an area as big as its size: even across a hall, not a hot spot)
	vec3 wNw = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
	for ( int i = 0; i < 8; i ++ ) {
		vec3 L = wLampP[ i ].xyz - vCaveW;
		float d2 = dot( L, L ), r = abs( wLampP[ i ].w );
		if ( d2 > r * r ) continue;
		// (a lamp inside the hull - its reach given negative - lights only what is inside: nothing stops its light)
		float wIn = wLampP[ i ].w < 0.0 ? 1.0 - smoothstep( 0.72, 0.98, vWA.y ) : 1.0;
		vec3 l = L * inversesqrt( d2 );
		float nl = dot( wNw, l );
		float fall = 1.0 / ( d2 + wLampS[ i ] ) * pow( clamp( 1.0 - d2 / ( r * r ), 0.0, 1.0 ), 2.0 );
		reflectedLight.directDiffuse += wLampC[ i ] * fall * wIn * clamp( nl * 0.85 + 0.15, 0.0, 1.0 ) * BRDF_Lambert( material.diffuseColor );
	}`);
  };
  mat.customProgramCacheKey = () => `wreck2-${Q.lite}`;
  mat.userData.U = U;
  return mat;
}

// ---------------------------------------------------------------- the build
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _pw = new THREE.Vector3(), _nw = new THREE.Vector3(), _tw = new THREE.Vector3();
// a frame at the origin of the world (modules are built there, then instanced)
const ORIGIN = { name: 'module', toWorld: (p, o = new THREE.Vector3()) => o.copy(p), dirWorld: (d, o = new THREE.Vector3()) => o.copy(d), k: () => 1, scale: 1 };

export class Wreck {
  constructor(track, sunDir) {
    this.track = track;
    this.sunDir = sunDir.clone().normalize();
    this.rnd = mulberry32(1977);
    this.mat = wreckMaterial();
    this.chunks = new Map();                       // geometry per (piece, 160 m of its length, layer)
    this.mods = new Map();                         // module geometries (instanced)
    this.placed = new Map();                       // their instances, per group
    this.lamps = [];
    this.big = [];                                 // lights that reach far (the core): always among the eight
    this.effects = true;                           // (the setting: flicker, sparks, drift, arcs)
    this.fxMeshes = [];                            // the core, its arcs, the coolant's fog (own materials)
    this.updaters = [];                            // what moves with them each frame (t, camera position)
    this.trackSamples();
    this.makeHulls();
    for (const H of this.hulls) { this.plating(H); this.frames(H); this.caps(H); }
    this.zones();
    for (const H of this.hulls) H.bounds();
    this.skyLight();
    this.buildMeshes();
    this.debris();
    this.sparks = new Sparks(this.sparkSites());
    // the asteroids and towers keep clear of it (spheres along each piece)
    for (const H of this.hulls) {
      const r = Math.hypot(H.HW, H.HH) + 60, n = Math.max(1, Math.round(H.len / r));
      for (let k = 0; k < n; k++) track.keepOut.push({ c: H.toWorld(new THREE.Vector3(0, 0, (k + 0.5) * H.len / n)), r: Math.hypot(r, H.len / n / 2) });
    }
  }

  // the chunk a part goes into: its piece, 160 m of its length, its layer (a module being built: its own)
  geo(H, z, layer = 'main') {
    if (this.target) return this.target;
    const key = `${H.name}|${Math.floor(clamp(z, -2000, H.len + 2000) / CHUNK)}|${layer}`;
    let g = this.chunks.get(key);
    if (!g) this.chunks.set(key, (g = new Geo()));
    return g;
  }

  // ---- the track round the derelict: samples every 2 m in a grid (what is clear of it), and its frame in a piece's
  // own coordinates
  trackSamples() {
    const tr = this.track, f = {}, s0 = tr.at('wreckIn') - 1200, s1 = tr.at('wreckOut') + 900, cell = 64;
    this.ts = [];
    this.tgrid = new Map();
    for (let s = s0; s < s1; s += 2) {
      tr.frame(s, f);
      const q = { s: tr.wrap(s), P: f.P.clone(), T: f.T.clone(), U: f.U.clone(), R: f.R.clone() };
      const k = `${Math.floor(q.P.x / cell)},${Math.floor(q.P.y / cell)},${Math.floor(q.P.z / cell)}`;
      (this.tgrid.get(k) || this.tgrid.set(k, []).get(k)).push(this.ts.length);
      this.ts.push(q);
    }
    this.tcell = cell;
  }
  // track samples within r of a world point
  near(p, r) {
    const c = this.tcell, out = [], n = Math.ceil(r / c);
    const cx = Math.floor(p.x / c), cy = Math.floor(p.y / c), cz = Math.floor(p.z / c);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let d = -n; d <= n; d++) {
      for (const i of this.tgrid.get(`${cx + a},${cy + b},${cz + d}`) || []) if (this.ts[i].P.distanceToSquared(p) < r * r) out.push(this.ts[i]);
    }
    return out;
  }
  // the track's frame at s in a piece's coordinates: p, T, U, R
  tl(H, s) {
    const f = this.track.frame(s, {});
    return { p: H.toLocal(f.P), T: H.dirLocal(f.T), U: H.dirLocal(f.U), R: H.dirLocal(f.R), s };
  }

  // a part of radius r at a piece's local p clear of the space round the track (the deck, its walls, the ships and the
  // chase camera; a flip's whole tube)
  free(H, p, r = 0) {
    const w = H.toWorld(p, _w), XM = TRACK_HALF + 6;
    for (const q of this.near(w, r + 60)) {
      const d = _v.subVectors(w, q.P), x = d.dot(q.R), y = d.dot(q.U), t = d.dot(q.T);
      const flip = this.track.inFlip(q.s, 40);
      if (Math.abs(t) < 2 + r && Math.abs(x) < (flip ? 44 : XM) + r && y > (flip ? -44 : -10) - r && y < (flip ? 48 : 20) + r) return false;
    }
    return true;
  }

  // what of the wreck reaches into the space the ships and the chase camera need round the deck (|x| < 32 m, from the
  // girders under it to 15 m over it): every vertex, triangle centre and edge middle (instances too), by the nearest
  // track sample
  clearance(xMax = TRACK_HALF + 4, yLo = -4.3, yHi = 15) {
    const hits = [], d = new THREE.Vector3();
    const test = (p, what) => {
      let best = null, bd = 1e18;
      for (const q of this.near(p, 40)) { const dd = q.P.distanceToSquared(p); if (dd < bd) { bd = dd; best = q; } }
      if (!best) return;
      d.subVectors(p, best.P);
      const x = d.dot(best.R), y = d.dot(best.U), t = d.dot(best.T);
      if (Math.abs(x) < xMax && y > yLo && y < yHi && Math.abs(t) < 3) hits.push({ what, s: Math.round(best.s), x: +x.toFixed(1), y: +y.toFixed(1) });
    };
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), M = new THREE.Matrix4();
    for (const m of [...this.meshes, ...this.instMeshes]) {
      const P = m.geometry.attributes.position, I = m.geometry.index, n = m.isInstancedMesh ? m.count : 1;
      for (let k = 0; k < n; k++) {
        if (m.isInstancedMesh) m.getMatrixAt(k, M); else M.identity();
        for (let i = 0; i < P.count; i++) test(A.fromBufferAttribute(P, i).applyMatrix4(M), m.name);
        for (let i = 0; i < I.count; i += 3) {
          A.fromBufferAttribute(P, I.getX(i)).applyMatrix4(M); B.fromBufferAttribute(P, I.getX(i + 1)).applyMatrix4(M); C.fromBufferAttribute(P, I.getX(i + 2)).applyMatrix4(M);
          if (A.distanceToSquared(B) + B.distanceToSquared(C) + C.distanceToSquared(A) < 30) continue;
          test(A.clone().add(B).add(C).divideScalar(3), m.name + ' tri');
          test(A.clone().add(B).multiplyScalar(0.5), m.name + ' edge'); test(B.clone().add(C).multiplyScalar(0.5), m.name + ' edge'); test(C.clone().add(A).multiplyScalar(0.5), m.name + ' edge');
        }
      }
    }
    // (runs of hits: what, from s to s, how far in across, how low and high)
    const runs = [];
    for (const h of hits.sort((p, q) => (p.what < q.what ? -1 : p.what > q.what ? 1 : p.s - q.s))) {
      const r = runs[runs.length - 1], what = h.what.replace(/ (tri|edge)$/, '');
      if (r && r[0] === what && h.s - r[2] < 30) { r[2] = h.s; r[3] = Math.min(r[3], Math.abs(h.x)); r[4] = Math.min(r[4], h.y); r[5] = Math.max(r[5], h.y); r[6]++; }
      else runs.push([what, h.s, h.s, Math.abs(h.x), h.y, h.y, 1]);
    }
    return { n: hits.length, runs };
  }

  // ---------------------------------------------------------------- the pieces and their holes
  // A hole: centre z, angle t round the axis (0 starboard, pi/2 the back, pi port), radii rz along and rt round (m),
  // how far its plates bend out, its soot; a jagged edge (harmonics)
  hole(z, t, rz, rt, peel, soot, jag = 1) {
    const R = this.rnd;
    return { z, t: wrapA(t), rz, rt, s: Math.min(rz, rt), peel, soot, a: [0.16 + R() * 0.06, 0.08 + R() * 0.04, 0.045, 0.028 * jag], p: [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28] };
  }
  edge(d, a) { const R = this.rnd; return { d, a, p: [R() * 6.28, R() * 6.28, R() * 6.28] }; }

  makeHulls() {
    const P = Object.fromEntries(PIECES.map((p) => [p.name, p])), h = (...a) => this.hole(...a);
    const H = Math.PI / 2;
    // the stern piece: torn open at its front, its fore end ruptured (the back and the starboard flank all but gone),
    // a hole over the reactor hall and one under the machinery; the main engine's mount through the engine block
    const aft = new Hull({ ...P.aft, cap0: 'open', cap1: 'stern', edge0: this.edge(18, [44, 14, 6]),
      holes: [h(250, H - 0.35, 210, 250, 10, 1), h(400, -0.25, 130, 150, 8, 1), h(150, Math.PI + 0.35, 120, 120, 8, 1),
        h(1170, H + 0.7, 60, 70, 6, 0.9), h(820, -H + 0.5, 55, 60, 5, 1), h(560, Math.PI - 0.2, 40, 50, 5, 1)],
      sternHole: { x: 0, y: -35, r: 66 }, block: 60, ribFrom: 8, ribTo: P.aft.len - 64 });
    // the middle piece: torn at both ends, holed through
    const mid = new Hull({ ...P.mid, cap0: 'open', cap1: 'open', edge0: this.edge(14, [36, 12, 5]), edge1: this.edge(14, [40, 12, 5]),
      holes: [h(150, H + 0.2, 90, 120, 8, 1), h(200, -H - 0.3, 70, 90, 7, 1)], ribFrom: 20, ribTo: P.mid.len - 20 });
    // the fore piece: torn where it broke, the breach the way leaves the hangar by (fitted to it), the hangar's roof
    // holed, the holds' flank, the bow's chamfers
    const fore = new Hull({ ...P.fore, cap0: 'closed', cap1: 'open', edge1: this.edge(16, [40, 14, 6]),
      holes: [h(600, Math.PI, 120, 120, 10, 1), h(900, H + 0.62, 110, 70, 9, 1), h(1650, -0.15, 60, 70, 6, 1),
        h(2150, H - 0.6, 90, 110, 8, 1), h(300, H + 0.9, 50, 40, 5, 1)],
      ribFrom: 660, ribTo: P.fore.len - 8 });
    // the command tower's control deck on the stern piece's back (the way runs through it): open at the front (its
    // windows blown out), the way out through a hole in its back wall; the tiers over and under it are blocks
    const tower = new Hull({ name: 'tower', O: aft.toWorld(new THREE.Vector3(0, 254, 742)), X: aft.X, Y: aft.Y, Z: aft.Z, len: 356,
      sec: { hw: 90, hh: 32, ct: 12, cb: 4, ribEvery: 16, ribD: 2, ribW: 0.7, skin: 1.2 }, cap0: 'open', cap1: 'stern',
      sternHole: { x: 0, y: 0, r: 40 }, block: 6, ribFrom: 8, ribTo: 348 });
    this.hulls = [fore, mid, aft, tower];
    Object.assign(this, { fore, mid, aft, tower });
    for (const g of GRAVEYARD) this.hulls.push(this.hulk(g));
    this.fitHole(fore, fore.holes[0], this.track.at('breach') - 300, this.track.at('breach') + 300);
    this.sunL = this.hulls.map((H) => H.dirLocal(this.sunDir));
  }

  // A hulk of the graveyard (wreckplan.js GRAVEYARD): its frame from the way's - through it, beside it (one half of a
  // broken one, its torn end toward the way), over it (lying across it), or further out; torn, holed, rolled
  hulk(g) {
    const tr = this.track, f = {}, b0 = tr.at('breach'), R = this.rnd, h = (...a) => this.hole(...a), deg = Math.PI / 180;
    let A, B, up;
    if (g.how === 'through') {
      const P0 = tr.frame(b0 + g.from, f).P.clone(), U0 = f.U.clone(), P1 = tr.frame(b0 + g.to, f).P.clone(), U1 = f.U.clone();
      up = U0.add(U1).normalize();
      const Z = P1.clone().sub(P0).normalize();
      A = P0.addScaledVector(up, g.y).addScaledVector(Z, -40); B = P1.addScaledVector(up, g.y).addScaledVector(Z, 40);
    } else if (g.how === 'beside' || g.how === 'over') {
      tr.frame(b0 + g.at, f);
      const out = f.R.clone().multiplyScalar(g.side || 1).applyAxisAngle(f.U, g.yaw || 0);
      up = f.U.clone();
      const c = f.P.clone().addScaledVector(f.U, g.how === 'over' ? g.clear + FRIGATE.hh : g.y);
      A = g.how === 'over' ? c.clone().addScaledVector(out, -g.len / 2) : c.clone().addScaledVector(out, g.gap);
      B = A.clone().addScaledVector(out, g.len);
    } else {
      const fo = this.fore, d = fo.dirWorld(new THREE.Vector3(...g.dir).normalize());
      A = fo.toWorld(new THREE.Vector3(...g.p)); B = A.clone().addScaledVector(d, g.len); up = new THREE.Vector3(0, 1, 0);
    }
    const Z = B.clone().sub(A).normalize(), Y0 = up.clone().addScaledVector(Z, -up.dot(Z)).normalize(), Y = Y0.applyAxisAngle(Z, (g.roll || 0) * deg);
    const X = new THREE.Vector3().crossVectors(Y, Z), len = A.distanceTo(B);
    const holes = [h(len * (0.3 + R() * 0.4), R() * 6.28, 30 + R() * 30, 30 + R() * 30, 3, 1), h(len * (0.2 + R() * 0.6), R() * 6.28, 18 + R() * 20, 20 + R() * 20, 2, 1)];
    const torn = (k) => this.edge(6 + R() * 4, [14 * k, 5 * k, 2 * k]);
    const def = { name: g.name, O: A, X, Y, Z, len, sec: FRIGATE, holes, ribFrom: 6, ribTo: len - 6, shade: g.how !== 'far', taper: 0, tip: 1 };
    if (g.how === 'through') Object.assign(def, { cap0: 'open', cap1: 'open', edge0: torn(1), edge1: torn(1.2) });
    else if (g.how === 'beside') Object.assign(def, { cap0: 'open', cap1: 'closed', edge0: torn(1.3) });
    else Object.assign(def, { cap0: 'closed', cap1: R() < 0.5 ? 'open' : 'closed', taper: len * 0.22, tip: 0.3 });
    if (def.cap1 === 'open') def.edge1 = torn(1);
    const H = new Hull(def);
    H.hulk = g;
    return H;
  }

  // A hole fitted round where the way goes through the skin: wherever the space round the track (60 m wide, from 12 m
  // under the deck to 26 m over it) meets the skin between s0 and s1, the hull must be open - the hole is fitted round
  // those points (its jagged edge never reaching in past them), and the frames there are torn away
  fitHole(H, h, s0, s1) {
    const tr = this.track, f = {}, pts = [], q = new THREE.Vector3();
    const scale = (p) => { const k = H.k(p.z); let m = 0; H.OCT.forEach((v, i) => { m = Math.max(m, (H.OCTN[i][0] * p.x + H.OCTN[i][1] * p.y) / (k * (H.OCTN[i][0] * v[0] + H.OCTN[i][1] * v[1]))); }); return m; };
    for (let s = s0; s < s1; s += 3) {
      tr.frame(s, f);
      for (let x = -30; x <= 30; x += 5) for (const y of [-12, -2, 8, 18, 26]) {
        H.toLocal(q.copy(f.P).addScaledVector(f.R, x).addScaledVector(f.U, y), q);
        const m = scale(q);
        if (m > 0.93 && m < 1.07 && q.z > 0 && q.z < H.len) pts.push([q.z, Math.atan2(q.y, q.x)]);
      }
    }
    if (!pts.length) return;
    // in (z, metres round): the centre, the principal direction, the half extents along and across it
    const t0 = pts[0][1], A = H.ang, Pm = pts.map(([z, t]) => [z, (t0 + wrapA(t - t0)) * A]);
    const mz = Pm.reduce((a, p) => a + p[0], 0) / Pm.length, mt = Pm.reduce((a, p) => a + p[1], 0) / Pm.length;
    let szz = 0, stt = 0, szt = 0;
    for (const [z, t] of Pm) { szz += (z - mz) ** 2; stt += (t - mt) ** 2; szt += (z - mz) * (t - mt); }
    const rot = 0.5 * Math.atan2(2 * szt, szz - stt), c = Math.cos(rot), sn = Math.sin(rot);
    const Uv = Pm.map(([z, t]) => [(z - mz) * c + (t - mt) * sn, -(z - mz) * sn + (t - mt) * c]);
    const u0 = Math.min(...Uv.map((p) => p[0])), u1 = Math.max(...Uv.map((p) => p[0])), v0 = Math.min(...Uv.map((p) => p[1])), v1 = Math.max(...Uv.map((p) => p[1]));
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, a = Math.max(8, (u1 - u0) / 2), b = Math.max(8, (v1 - v0) / 2);
    const cz = mz + uc * c - vc * sn, ct = mt + uc * sn + vc * c;
    let k = 0;
    for (const [u, v] of Uv) k = Math.max(k, Math.hypot((u - uc) / a, (v - vc) / b));
    const bmin = 1 - h.a[0] - h.a[1] - h.a[2] - h.a[3], m = 14 * H.scale;
    Object.assign(h, { z: cz, t: wrapA(ct / A), rot, rz: (a * k + m) / bmin, rt: (b * k + m) / bmin });
    h.s = Math.min(h.rz, h.rt);
    H.ribCuts.push({ z: cz, t: h.t, rot, rz: a * k + m * 1.4, rt: b * k + m * 1.4 });
  }

  // the sun's light at a world point (1 .. 0), every piece: the CPU twin of the shader's
  sunAt(p) {
    let k = 1;
    this.hulls.forEach((H, i) => { if (k > 0 && H.shade) k *= H.ray(H.toLocal(p, _w), this.sunL[i]); });
    return k;
  }

  // ---- the plating: per face, cells the face's width / ~16 m across (6 m on the small hulls); near an edge cells a
  // quarter of that, cut along the edge (marching squares); the edge's thickness; the inner skin; the plates within
  // ~9 m (scaled) of an edge bent outward
  plating(H) {
    const cell = H.HW > 100 ? 16 : 12, zEnd = H.len, info = {}, SKIN = H.SKIN, edgeK = 1.75 * cell;
    for (let face = 0; face < 8; face++) {
      const a = H.OCT[face], b = H.OCT[(face + 1) % 8], W = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nu = Math.max(2, Math.round(W / cell));
      const zs = [];
      for (let z = 0; z < zEnd; z += cell) { if (H.taper > 0 && z < H.taper && z + cell > H.taper) { zs.push(z, H.taper); continue; } zs.push(z); }
      zs.push(zEnd);
      const zz = [...new Set(zs)].sort((p, q) => p - q);
      const outer = (z, u, o) => { const k = H.k(z); return o.set(k * (a[0] + (b[0] - a[0]) * u), k * (a[1] + (b[1] - a[1]) * u), z); };
      const inner = (z, u, o) => { const q = H.inset(H.k(z), SKIN), qa = q[face], qb = q[(face + 1) % 8]; return o.set(qa[0] + (qb[0] - qa[0]) * u, qa[1] + (qb[1] - qa[1]) * u, z); };
      const nrm = (z) => (H.taper > 0 && z < H.taper ? H.planes[8 + face].n : H.planes[face].n);
      const fld = (z, u) => { outer(z, u, _v); return H.field(z, Math.atan2(_v.y, _v.x), info); };
      const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], 0).normalize(), tW = H.dirWorld(T, new THREE.Vector3());
      // a vertex of both skins at (z, u): the outer one, the inner one (bent outward together near an edge)
      const emit = (g, z, u, f, which, soot) => {
        const n = nrm(z), peel = this.peel(H, z, u, f, which, face);
        const po = outer(z, u, new THREE.Vector3()).addScaledVector(n, peel), pi = inner(z, u, new THREE.Vector3()).addScaledVector(n, peel);
        const nW = H.dirWorld(n, _nw), uv = u * W;
        const o = g.v(H.toWorld(po, _pw), nW, uv, z, tW, [K_HULL, 1, soot, face], PAINT_HULL);
        const i = g.v(H.toWorld(pi, _pw), nW.negate(), uv, z, tW, [K_INNER, 0, soot * 0.7, face], PAINT_INNER);
        return [o, i, po, pi];
      };
      const sootAt = (f, which) => {
        const h = which >= 0 && which < 100 ? H.holes[which] : null, r = 22 * H.scale;
        return h ? h.soot * smoothstep(r, 0, f) : which >= 100 ? 0.8 * smoothstep(r * 0.75, 0, f) : 0;
      };
      for (let j = 0; j < zz.length - 1; j++) {
        const z0 = zz[j], z1 = zz[j + 1];
        for (let c = 0; c < nu; c++) {
          const u0 = c / nu, u1 = (c + 1) / nu;
          const fs = [fld(z0, u0), fld(z1, u0), fld(z1, u1), fld(z0, u1), fld((z0 + z1) / 2, (u0 + u1) / 2)];
          const lo = Math.min(...fs), hi = Math.max(...fs);
          if (hi < -edgeK) continue;                               // all hole
          const g = this.geo(H, (z0 + z1) / 2, 'shell');
          if (lo > edgeK) { this.poly(g, [[z0, u0], [z1, u0], [z1, u1], [z0, u1]].map(([z, u], k) => emit(g, z, u, fs[k], -1, 0))); continue; }
          const N = 4;
          for (let sj = 0; sj < N; sj++) for (let sc = 0; sc < N; sc++) {
            const za = z0 + (z1 - z0) * sj / N, zb = z0 + (z1 - z0) * (sj + 1) / N, ua = u0 + (u1 - u0) * sc / N, ub = u0 + (u1 - u0) * (sc + 1) / N;
            this.cellCut(g, H, emit, za, zb, ua, ub, fld, info, sootAt, nrm);
          }
        }
      }
    }
  }

  // the plates bend outward near a hole's edge (each hole its own amount), more at the very edge, unevenly
  peel(H, z, u, f, which, face) {
    const reach = 9 * H.scale;
    if (f > reach || f < -1) return 0;
    const amp = which >= 0 && which < 100 ? H.holes[which].peel : which >= 100 ? 4 * H.scale : 0;
    const k = 1 - clamp(f, 0, reach) / reach;
    return amp * k * k * (0.35 + 0.9 * noise2(z * 0.11 / H.scale + face * 3.1, u * 2.3 + face));
  }

  // one small cell cut along the edge: the plate's polygon (corners inside, crossings on the edges), both skins, and
  // the edge's thickness between them
  cellCut(g, H, emit, za, zb, ua, ub, fld, info, sootAt, nrm) {
    const C = [[za, ua], [zb, ua], [zb, ub], [za, ub]];
    const F = [], Wh = [];
    for (const [z, u] of C) { F.push(fld(z, u)); Wh.push(info.which); }
    if (F.every((x) => x <= 0)) return;
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4, fa = F[k], fb = F[k2];
      if (fa > 0) poly.push({ z: C[k][0], u: C[k][1], f: fa, w: Wh[k] });
      if ((fa > 0) !== (fb > 0)) {
        const t = fa / (fa - fb), z = C[k][0] + (C[k2][0] - C[k][0]) * t, u = C[k][1] + (C[k2][1] - C[k][1]) * t;
        poly.push({ z, u, f: 0, w: fa < fb ? Wh[k] : Wh[k2], x: true });
      }
    }
    const vs = poly.map((p) => emit(g, p.z, p.u, p.f, p.w, sootAt(p.f, p.w)));
    this.poly(g, vs);
    // the torn edge's thickness: between consecutive crossings
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      if (!(p.x && q.x)) continue;
      const A = vs[k], B = vs[(k + 1) % poly.length];
      const n = nrm((p.z + q.z) / 2), e = B[2].clone().sub(A[2]);
      const side = e.clone().cross(n).normalize();
      const probe = A[2].clone().add(B[2]).multiplyScalar(0.5).addScaledVector(side, 0.5);
      if (H.field(probe.z, Math.atan2(probe.y, probe.x)) > 0) side.negate();       // (toward the hole)
      const nW = H.dirWorld(side, new THREE.Vector3()), tW = H.dirWorld(n, new THREE.Vector3());
      const len = e.length(), soot = sootAt(0, p.w), sk = H.SKIN;
      const v0 = g.v(H.toWorld(A[2], _pw), nW, 0, 0, tW, [K_TORN, 1, soot, 3], PAINT_TORN);
      const v1 = g.v(H.toWorld(B[2], _pw), nW, 0, len, tW, [K_TORN, 1, soot, 3], PAINT_TORN);
      const v2 = g.v(H.toWorld(B[3], _pw), nW, sk, len, tW, [K_TORN, 0.5, soot, 3], PAINT_TORN);
      const v3 = g.v(H.toWorld(A[3], _pw), nW, sk, 0, tW, [K_TORN, 0.5, soot, 3], PAINT_TORN);
      this.quadFacing(g, [v0, v1, v2, v3], nW);
    }
  }

  // a convex polygon of both skins' vertex pairs: the outer one facing out, the inner one in
  poly(g, vs) {
    if (vs.length < 3) return;
    const n = _n.fromArray(g.N, vs[0][0] * 3);
    const pa = _v.fromArray(g.P, vs[0][0] * 3), pb = _w.fromArray(g.P, vs[1][0] * 3).sub(pa), pc = _t.fromArray(g.P, vs[2][0] * 3).sub(pa);
    const ccw = pb.cross(pc).dot(n) >= 0;
    for (let k = 1; k < vs.length - 1; k++) {
      if (ccw) { g.tri(vs[0][0], vs[k][0], vs[k + 1][0]); g.tri(vs[0][1], vs[k + 1][1], vs[k][1]); }
      else { g.tri(vs[0][0], vs[k + 1][0], vs[k][0]); g.tri(vs[0][1], vs[k][1], vs[k + 1][1]); }
    }
  }

  // a quad (4 vertex indices, any order round it) wound to face n
  quadFacing(g, q, n) {
    const a = _v.fromArray(g.P, q[0] * 3), b = _w.fromArray(g.P, q[1] * 3).sub(a), c = _t.fromArray(g.P, q[2] * 3).sub(a);
    if (b.cross(c).dot(n) >= 0) { g.tri(q[0], q[1], q[2]); g.tri(q[0], q[2], q[3]); }
    else { g.tri(q[0], q[2], q[1]); g.tri(q[0], q[3], q[2]); }
  }

  // ---- ring frames: an I-section (a web from the inner skin, an inner flange), mitred at the octagon's corners
  frames(H) {
    const a = H.RIBW * 0.5, b = H.RIBW, D = H.RIBD, fl = Math.max(0.6, D * 0.1);
    const prof = [[0, a], [D, a], [D, b], [D + fl, b], [D + fl, -b], [D, -b], [D, -a], [0, -a]];   // (depth, along z)
    for (let z = H.ribFrom; z <= H.ribTo + 1e-6; z += H.RIB) {
      // near a torn end: pieces wrenched out of the last frames, more the nearer the end
      const reach = 80 * H.scale, torn = Math.max(H.edge1 ? smoothstep(H.len - reach, H.len - 4, z) : 0, H.edge0 ? smoothstep(reach, 4, z) : 0);
      this.ring(H, z, prof, K_FRAME, PAINT_FRAME, 'main', torn > 0 ? (th) => noise2(th * 2.3 + z * 0.17, z * 0.05) < torn * 0.75 : null);
    }
  }

  // a profile (depth in from the inner skin, offset along z) swept round the inset octagon at z; where the frame is
  // torn (a breach, a torn end) it is cut in pieces of a few metres, the stumps bent outward and their ends capped
  ring(H, z, prof, kind, paint, layer = 'main', tear = null) {
    const g = this.geo(H, z, layer), k = H.k(z), F0 = Wreck.F(new THREE.Vector3());
    const cutAt = (x, y) => H.inRibCut(z, Math.atan2(y, x)) || (tear && tear(Math.atan2(y, x)));
    const qs = prof.map(([d]) => H.inset(k, H.SKIN + d)), outerQ = H.inset(k, 0), piece = 4 * H.scale;
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8, segL = Math.hypot(outerQ[j][0] - outerQ[i][0], outerQ[j][1] - outerQ[i][1]);
      const m = Math.max(1, Math.ceil(segL / piece)), gone = [];
      for (let q = 0; q < m; q++) { const t = (q + 0.5) / m; gone.push(cutAt(outerQ[i][0] + (outerQ[j][0] - outerQ[i][0]) * t, outerQ[i][1] + (outerQ[j][1] - outerQ[i][1]) * t)); }
      const nOut = new THREE.Vector3(H.OCTN[i][0], H.OCTN[i][1], 0);
      // runs of pieces still there: one stretch of frame each
      for (let q = 0; q < m; q++) {
        if (gone[q] || (q > 0 && !gone[q - 1])) continue;
        let q1 = q;
        while (q1 + 1 < m && !gone[q1 + 1]) q1++;
        const t0 = q / m, t1 = (q1 + 1) / m, bend0 = q > 0, bend1 = q1 < m - 1;
        const at = (e, t) => {
          const Q = qs[e], P = new THREE.Vector3(Q[i][0] + (Q[j][0] - Q[i][0]) * t, Q[i][1] + (Q[j][1] - Q[i][1]) * t, z + prof[e][1]);
          const bend = (t === t0 && bend0) || (t === t1 && bend1) ? (3 + 2 * noise2(z * 0.3 + i, t * 9)) * H.scale : 0;
          return P.addScaledVector(nOut, bend);
        };
        for (let e = 0; e < prof.length - 1; e++) {
          const e2 = e + 1, [d0, w0] = prof[e], [d1, w1] = prof[e2];
          const W = Math.hypot(d1 - d0, w1 - w0), nd = -(w1 - w0) / W, nw = (d1 - d0) / W;
          const nl = new THREE.Vector3(-H.OCTN[i][0] * nd, -H.OCTN[i][1] * nd, nw);
          const P = [at(e, t0), at(e, t1), at(e2, t1), at(e2, t0)], tl = P[3].clone().sub(P[0]).normalize();
          const uvs = [[0, segL * t0], [0, segL * t1], [W, segL * t1], [W, segL * t0]];
          const vs = P.map((pp, mm) => this.pv(g, H, F0, pp, nl, uvs[mm][0], uvs[mm][1], tl, { kind, paint, seed: W, sky: 0 }));
          this.quadFacing(g, vs, H.dirWorld(nl, new THREE.Vector3()));
        }
        // a torn stump's end: the profile, capped
        for (const [bend, t, sgn] of [[bend0, t0, -1], [bend1, t1, 1]]) {
          if (!bend) continue;
          const dir = new THREE.Vector3(outerQ[j][0] - outerQ[i][0], outerQ[j][1] - outerQ[i][1], 0).normalize().multiplyScalar(sgn);
          const pts = prof.map((_, e) => at(e, t)), c = pts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(pts.length);
          const o = { kind: K_TORN, paint: PAINT_TORN, soot: 0.7 };
          const cv = this.pv(g, H, F0, c, dir, 0, 0, new THREE.Vector3(0, 0, 1), o);
          const vs = pts.map((pp) => this.pv(g, H, F0, pp, dir, pp.z - z, 0, new THREE.Vector3(0, 0, 1), o));
          const dw = H.dirWorld(dir, new THREE.Vector3());
          for (let e = 0; e < vs.length; e++) {
            const A = vs[e], B = vs[(e + 1) % vs.length];
            const pa = new THREE.Vector3().fromArray(g.P, A * 3), pb = new THREE.Vector3().fromArray(g.P, B * 3), pc = new THREE.Vector3().fromArray(g.P, cv * 3);
            if (pb.sub(pa).cross(pc.sub(pa)).dot(dw) >= 0) g.tri(A, B, cv); else g.tri(A, cv, B);
          }
        }
      }
    }
  }

  // ---- the ends: a bow's nose plate, a stern's engine block (a wall as thick as `block`, the hole of its main
  // engine through it, the bore torn and blackened); torn ends are open
  caps(H) {
    const wall = (z, k, dz, hole, kind, paint, sky, layer) => {
      // a face at z (normal along dz): the octagon scaled k (or inset), minus a round hole (local x, y, r)
      const contour = (k.length ? k : H.OCT.map(([x, y]) => [k * x, k * y])).map(([x, y]) => new THREE.Vector2(x, y));
      const holes = hole ? [Array.from({ length: 48 }, (_, i) => { const a = -(i / 48) * TAU; return new THREE.Vector2(hole.x + hole.r * Math.cos(a), hole.y + hole.r * Math.sin(a)); })] : [];
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes), all = [...contour, ...holes.flat()];
      const n = new THREE.Vector3(0, 0, dz), t = new THREE.Vector3(1, 0, 0), g = this.geo(H, z, layer);
      const vs = all.map((q) => this.pv(g, H, Wreck.F(new THREE.Vector3()), new THREE.Vector3(q.x, q.y, z), n, q.x + 400, q.y + 400, t, { kind, paint, sky }));
      const nw = H.dirWorld(n, new THREE.Vector3());
      for (const [a, b, c] of tris) {
        const A = new THREE.Vector3().fromArray(g.P, vs[a] * 3), B = new THREE.Vector3().fromArray(g.P, vs[b] * 3), C = new THREE.Vector3().fromArray(g.P, vs[c] * 3);
        if (B.sub(A).cross(C.sub(A)).dot(nw) >= 0) g.tri(vs[a], vs[b], vs[c]); else g.tri(vs[a], vs[c], vs[b]);
      }
    };
    if (H.cap0 === 'closed') wall(0, H.tip, -1, null, K_HULL, PAINT_HULL, 1, 'shell');
    if (H.cap1 === 'stern' || H.cap1 === 'closed') {
      const h = H.cap1 === 'stern' ? H.sternHole : null, T = H.block ?? 24 * H.scale;
      wall(H.len, 1, 1, h, K_HULL, PAINT_HULL, 1, 'shell');
      wall(H.len - T, H.inset(1, H.SKIN), -1, h, K_INNER, PAINT_INNER, 0, 'shell');
      if (!h) return;
      // the hole's bore through the block: torn round its edge (the mount ripped out), blackened
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const jag = (a) => 1 + 0.05 * Math.sin(7 * a + 1.3) + 0.03 * Math.sin(17 * a);
        const P = [[a0, H.len - T], [a1, H.len - T], [a1, H.len], [a0, H.len]].map(([a, z]) => new THREE.Vector3(h.x + h.r * Math.cos(a) * (z > H.len - 1 ? jag(a) : 1), h.y + h.r * Math.sin(a) * (z > H.len - 1 ? jag(a) : 1), z));
        const n = new THREE.Vector3(-Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2), 0);
        const g = this.geo(H, H.len, 'shell'), F0 = Wreck.F(new THREE.Vector3());
        const vs = P.map((q, m) => this.pv(g, H, F0, q, n, (m === 1 || m === 2 ? a1 : a0) * h.r, q.z, new THREE.Vector3(0, 0, 1), { kind: K_TORN, paint: PAINT_TORN, soot: 0.9, sky: 0.3 }));
        this.quadFacing(g, vs, H.dirWorld(n, new THREE.Vector3()));
      }
    }
  }

  // ---------------------------------------------------------------- the zones (wreckzones.js)
  zones() { buildZones(this); }

  // ---------------------------------------------------------------- the parts kit (all in a piece's own frame)
  // a part's frame: origin o, axes ax ay az (local unit vectors)
  static F(o, ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3(0, 0, 1)) { return { o, ax, ay, az }; }

  // emit a vertex of a part: p, n, t in the part's coordinates
  pv(g, H, F, p, n, u, v, t, o) {
    const ph = _v.copy(F.o).addScaledVector(F.ax, p.x).addScaledVector(F.ay, p.y).addScaledVector(F.az, p.z);
    const pw = H.toWorld(ph, _pw);
    const nh = _n.set(0, 0, 0).addScaledVector(F.ax, n.x).addScaledVector(F.ay, n.y).addScaledVector(F.az, n.z);
    const nw = H.dirWorld(nh, _nw).normalize();
    const th = _t.set(0, 0, 0).addScaledVector(F.ax, t.x).addScaledVector(F.ay, t.y).addScaledVector(F.az, t.z);
    const tw = H.dirWorld(th, _tw);
    return g.v(pw, nw, u, v, tw, [o.kind ?? K_MACH, o.sky ?? 0, o.soot ?? 0, o.seed ?? 0], o.paint ?? PAINT_MACH);
  }

  // a part's direction in world space
  pdir(H, F, n) { return H.dirWorld(new THREE.Vector3().addScaledVector(F.ax, n.x).addScaledVector(F.ay, n.y).addScaledVector(F.az, n.z), new THREE.Vector3()); }

  // a box with chamfered edges (b), half sizes hx hy hz, centred on the frame's origin
  box(H, F, hx, hy, hz, o = {}) {
    const g = this.geo(H, F.o.z, o.layer);
    let b = Math.min(o.b ?? 0.12 * Math.min(hx, hy, hz), 0.45 * Math.min(hx, hy, hz));
    if (b < 0.06) b = 0;
    const h = [hx, hy, hz], E = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const P = (c) => new THREE.Vector3(c[0], c[1], c[2]);
    const oo = { ...o, seed: o.seed ?? (o.kind === K_FRAME ? 2 * Math.min(hx, hy, hz) : 0) };
    const quad = (pts, n, uAxis, du) => {
      // u along uAxis (metres), v along the other in-face direction
      const vAxis = new THREE.Vector3().crossVectors(n, uAxis);
      const vs = pts.map((p) => this.pv(g, H, F, p, n, p.dot(uAxis) + du, p.dot(vAxis) + 100, uAxis, oo));
      this.quadFacing(g, vs, this.pdir(H, F, n));
    };
    for (let i = 0; i < 3; i++) for (const si of [-1, 1]) {
      if (o.open === i * 2 + (si > 0 ? 1 : 0)) continue;              // (an open side: a housing's mouth)
      const j = (i + 1) % 3, k = (i + 2) % 3, pts = [];
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = [0, 0, 0]; q[i] = si * h[i]; q[j] = a * (h[j] - b); q[k] = c * (h[k] - b); pts.push(P(q)); }
      const short = h[j] < h[k] ? j : k;
      quad(pts, E[i].clone().multiplyScalar(si), E[short], h[short]);
    }
    if (b <= 1e-4) return;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) for (const si of [-1, 1]) for (const sj of [-1, 1]) {
      const k = 3 - i - j, pts = [];
      for (const [t, w] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        const q = [0, 0, 0]; q[k] = t * (h[k] - b);
        q[i] = si * (w ? h[i] - b : h[i]); q[j] = sj * (w ? h[j] : h[j] - b);
        pts.push(P(q));
      }
      const n = new THREE.Vector3().addScaledVector(E[i], si).addScaledVector(E[j], sj).normalize();
      const across = new THREE.Vector3().addScaledVector(E[i], -si).addScaledVector(E[j], sj).normalize();
      quad(pts, n, across, 0);
    }
    // the corners: one coordinate at its full extent, the other two in by b
    for (const si of [-1, 1]) for (const sj of [-1, 1]) for (const sk of [-1, 1]) {
      const s3 = [si, sj, sk];
      const tri = [0, 1, 2].map((m) => P([0, 1, 2].map((q) => s3[q] * (q === m ? h[q] : h[q] - b))));
      const n = new THREE.Vector3(si, sj, sk).normalize();
      const vs = tri.map((p) => this.pv(g, H, F, p, n, 0, 0, E[0], oo));
      const A = new THREE.Vector3().fromArray(g.P, vs[0] * 3), B = new THREE.Vector3().fromArray(g.P, vs[1] * 3), C = new THREE.Vector3().fromArray(g.P, vs[2] * 3);
      if (B.sub(A).cross(C.sub(A)).dot(this.pdir(H, F, n)) >= 0) g.tri(vs[0], vs[1], vs[2]); else g.tri(vs[0], vs[2], vs[1]);
    }
  }

  // a box between two local points (a beam): width w, height h (along `up` made square to it)
  beam(H, a, b, w, h, up = new THREE.Vector3(0, 1, 0), o = {}) {
    const az = b.clone().sub(a), len = az.length();
    az.normalize();
    let ay = up.clone().addScaledVector(az, -up.dot(az));
    if (ay.lengthSq() < 1e-6) ay = new THREE.Vector3(1, 0, 0).addScaledVector(az, -az.x);
    ay.normalize();
    const ax = new THREE.Vector3().crossVectors(ay, az);
    this.box(H, Wreck.F(a.clone().add(b).multiplyScalar(0.5), ax, ay, az), w / 2, h / 2, len / 2, o);
  }

  // a surface of revolution about the frame's y: profile [[r, y], ...]; each profile segment its own band (crisp rims)
  lathe(H, F, prof, o = {}) {
    const g = this.geo(H, F.o.z, o.layer), segs = o.segs ?? 24, a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU;
    let vacc = 0;
    const segN = prof.map((_, e) => {                              // each segment's normal in (r, y): outward for a profile
      if (e >= prof.length - 1) return null;                       // listed bottom to top
      const [r0, y0] = prof[e], [r1, y1] = prof[e + 1], L = Math.hypot(r1 - r0, y1 - y0);
      return L < 1e-5 ? null : [(y1 - y0) / L, -(r1 - r0) / L];
    });
    const vN = (e, end) => {                                       // a profile point's normal: its segment's, or shared
      const own = segN[e];
      if (!o.smooth) return own;
      const other = end ? segN[e + 1] : segN[e - 1];
      if (!other) return own;
      const x = own[0] + other[0], y = own[1] + other[1], l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    for (let e = 0; e < prof.length - 1; e++) {
      const [r0, y0] = prof[e], [r1, y1] = prof[e + 1], L = Math.hypot(r1 - r0, y1 - y0);
      if (L < 1e-5) continue;
      const [nr0, ny0] = vN(e, false), [nr1, ny1] = vN(e, true);
      const flip = o.inside ? -1 : 1, rows = [], ra = Math.max(0.2, (r0 + r1) / 2);
      for (let k = 0; k <= segs; k++) {
        const a = a0 + (a1 - a0) * k / segs, c = Math.cos(a), sn = Math.sin(a), t = new THREE.Vector3(-sn, 0, c);
        const n0 = new THREE.Vector3(c * nr0 * flip, ny0 * flip, sn * nr0 * flip), n1 = new THREE.Vector3(c * nr1 * flip, ny1 * flip, sn * nr1 * flip);
        rows.push([this.pv(g, H, F, new THREE.Vector3(c * r0, y0, sn * r0), n0, a * ra, vacc, t, o),
          this.pv(g, H, F, new THREE.Vector3(c * r1, y1, sn * r1), n1, a * ra, vacc + L, t, o)]);
      }
      for (let k = 0; k < segs; k++) {
        const [p0, p1] = rows[k], [q0, q1] = rows[k + 1];
        this.quadFacing(g, [p0, q0, q1, p1], new THREE.Vector3().fromArray(g.N, p0 * 3).add(new THREE.Vector3().fromArray(g.N, q1 * 3)));
      }
      vacc += L;
    }
  }

  // a cylinder (or a cone: o.r1) from local a to b, smooth round, its ends capped (o.caps !== false)
  cyl(H, a, b, r, o = {}) {
    const ay = b.clone().sub(a), len = ay.length();
    ay.normalize();
    const ref = Math.abs(ay.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const ax = new THREE.Vector3().crossVectors(ref, ay).normalize(), az = new THREE.Vector3().crossVectors(ax, ay);
    const r1 = o.r1 ?? r, prof = [[r, 0], [r1, len]];
    if (o.caps !== false) { prof.unshift([0, 0]); prof.push([0, len]); }
    this.lathe(H, Wreck.F(a.clone(), ax, ay, az), prof, { segs: o.segs ?? Math.max(6, Math.min(28, Math.round(r * 3 + 5))), ...o });
  }

  // a pipe along a local polyline (smooth round), clamps every o.clampEvery m
  tube(H, pts, r, o = {}) {
    const g = this.geo(H, pts[Math.floor(pts.length / 2)].z, o.layer), segs = o.segs ?? 8, F0 = Wreck.F(new THREE.Vector3());
    let prevN = null, vacc = 0, prevRow = null, total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], tA = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      let n;
      if (prevN) n = prevN.clone().addScaledVector(tA, -prevN.dot(tA));
      else { n = Math.abs(tA.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); n.addScaledVector(tA, -n.dot(tA)); }
      n.normalize(); prevN = n;
      const bN = new THREE.Vector3().crossVectors(tA, n);
      if (i > 0) vacc += p.distanceTo(pts[i - 1]);
      const row = [], oo = o.sway ? { ...o, kind: K_CABLE, seed: o.sway * Math.sin(Math.PI * vacc / total) } : o;
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * TAU, d = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(bN, Math.sin(a));
        row.push(this.pv(g, H, F0, p.clone().addScaledVector(d, r), d, a * r, vacc, tA, oo));
      }
      if (prevRow) for (let k = 0; k < segs; k++) this.quadFacing(g, [prevRow[k], row[k], row[k + 1], prevRow[k + 1]], new THREE.Vector3().fromArray(g.N, row[k] * 3).add(new THREE.Vector3().fromArray(g.N, prevRow[k + 1] * 3)));
      prevRow = row;
    }
    if (o.clampEvery) {
      let acc = o.clampEvery * 0.5;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = a.distanceTo(b);
        while (acc < L) {
          const c = a.clone().lerp(b, acc / L), d = b.clone().sub(a).normalize();
          this.cyl(H, c.clone().addScaledVector(d, -0.4 * r - 0.1), c.clone().addScaledVector(d, 0.4 * r + 0.1), r * 1.3 + 0.05, { ...o, kind: K_FRAME, paint: PAINT_CLAMP, segs: 10, seed: 0, sway: 0 });
          acc += o.clampEvery;
        }
        acc -= L;
      }
    }
  }

  // an emergency lamp: a caged housing on a bracket, its lens lit (flickering: the shader, by its number)
  lamp(H, p, out, col, size = 1, o = {}) {
    const i = this.lamps.length;
    const ay0 = Math.abs(out.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const az = out.clone().normalize(), ax = new THREE.Vector3().crossVectors(ay0, az).normalize();
    const F = Wreck.F(p.clone(), ax, new THREE.Vector3().crossVectors(az, ax), az), c = LAMP[col] || col;
    const layer = o.layer ?? (size >= 1.4 ? 'main' : 'detail');
    this.box(H, F, 1.4 * size, 0.5 * size, 0.45 * size, { kind: K_MACH, paint: PAINT_MACH, layer, sky: o.sky ?? 0 });
    this.box(H, Wreck.F(p.clone().addScaledVector(az, 0.5 * size), F.ax, F.ay, F.az), 1.15 * size, 0.3 * size, 0.1 * size, { kind: K_LAMP, paint: c, seed: i, b: 0.03, layer });
    if (size >= 0.8) for (const k of [-1, 0, 1]) this.box(H, Wreck.F(p.clone().addScaledVector(az, 0.62 * size).addScaledVector(F.ax, k * 0.55 * size), F.ax, F.ay, F.az), 0.05 * size, 0.42 * size, 0.06 * size, { kind: K_FRAME, paint: PAINT_FRAME, layer: 'detail' });
    const w = H.toWorld(p.clone().addScaledVector(az, 1.5 * size), new THREE.Vector3());
    // its light: how far it reaches (m) and how bright; inside a hull it lights only what is inside
    const reach = o.reach ?? (size > 1.4 ? 110 : size < 1 ? 50 : 75), I = o.I ?? (size > 1.4 ? 2600 : size < 1 ? 380 : 900);
    this.lamps.push({ p: w, col: c, i, reach, I, f: 1, size: o.area ?? 2, inside: o.sky !== 1 && this.within(w, -4) });
    return i;
  }

  // a world point inside a piece's hull (by margin m; negative: that far in)
  within(p, margin = 0) {
    return this.hulls.some((H) => {
      const q = H.toLocal(p, _w), k = H.k(q.z);
      return q.z > -margin && q.z < H.len + margin && Math.abs(q.x) < k * H.HW + margin && Math.abs(q.y) < k * H.HH + margin;
    });
  }

  // ---- modules: a part built once at the origin (its own frame), placed many times as instances, in groups of a few
  // hundred metres (each group one draw, drawn within the module's reach)
  module(name, build, reach = 900, cast = false) {
    if (!this.mods.has(name)) {
      this.target = new Geo();
      build(ORIGIN);
      const g = this.target.build();
      this.target = null;
      this.mods.set(name, { g, reach, cast });
    }
    return name;
  }
  // place a module in a piece: frame F (local o, ax ay az), uniform scale, colour tint (paint), group size (m along and
  // across the piece: each group is culled as one)
  place(name, H, F, s = 1, tint = null, group = 400) {
    const M = new THREE.Matrix4().makeBasis(F.ax, F.ay, F.az).scale(_v.set(s, s, s)).setPosition(F.o).premultiply(H.M);
    const key = `${name}|${H.name}|${Math.floor(F.o.z / group)}|${Math.floor(F.o.x / group)}`;
    let l = this.placed.get(key);
    if (!l) {
      // (a group inside a piece is hidden while the camera is outside it, past 300 m: the hull hides it then)
      const k = H.k(F.o.z), inside = H.HW > 100 && F.o.z > 0 && F.o.z < H.len && Math.abs(F.o.x) < k * H.HW && Math.abs(F.o.y) < k * H.HH;
      this.placed.set(key, (l = { name, H, list: [], inside }));
    }
    l.list.push({ M, o: F.o.clone(), tint });
    return l.list[l.list.length - 1];
  }
  // the same, adrift: turning slowly about its own axis and swaying a few metres to and fro about where it is (drawn
  // where it is each frame, near the camera: the AO sees it where it is drawn)
  drift(name, H, F, s = 1, tint = null, sway = 3) {
    const R = this.rnd, e = this.place(name, H, F, s, tint, 600);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    e.M.decompose(p, q, sc);
    Object.assign(e, { p, q, s: sc.x, axis: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), w: (0.02 + R() * 0.08) * (R() < 0.5 ? -1 : 1),
      bob: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(sway), ph: R() * 6.3, per: 18 + R() * 30 });
  }

  // ---- the sky's light on the inside: an ambient cube per cell (rays through the same holes), worked out the first
  // time a vertex near it asks (most of the hull's volume is far from any opening: dark without a ray cast); each
  // vertex of the inner parts lit by it along its normal; the outside sees the sky
  skyLight() {
    const dirs = [];
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = new THREE.Vector3(x, y, z), t1 = new THREE.Vector3(y, z, x), t2 = new THREE.Vector3().crossVectors(a, t1);
      dirs.push([a, ...[[0.7, 0.4], [-0.7, 0.4], [0, -0.8]].map(([p, q]) => a.clone().addScaledVector(t1, p).addScaledVector(t2, q).normalize())]);
    }
    this.skyDirs = dirs;
    for (const H of this.hulls) {
      const cell = H.HW > 100 ? 28 : 10, nx = Math.ceil((2 * H.HW) / cell) + 1, ny = Math.ceil((2 * H.HH) / cell) + 1, nz = Math.ceil(H.len / cell) + 1;
      // what lets the sky in: the holes, the open ends, a stern's hole (centre, reach)
      const opens = H.holes.map((h) => ({ c: new THREE.Vector3(Math.cos(h.t) * H.HW, Math.sin(h.t) * H.HH, h.z), r: 2.5 * Math.max(h.rz, h.rt) + 40 }));
      for (const [c, z] of [[H.cap0, 0], [H.cap1, H.len]]) if (c === 'open') opens.push({ z, r: 260 * H.scale });
      if (H.sternHole) opens.push({ c: new THREE.Vector3(H.sternHole.x, H.sternHole.y, H.len), r: 3 * H.sternHole.r + 40 });
      H.sky = { cube: new Float32Array(nx * ny * nz * 6).fill(-1), nx, ny, nz, cell, opens };
    }
    for (const [key, g] of this.chunks) {
      const H = this.hullBy[key.split('|')[0]];
      for (let i = 0; i < g.n; i++) {
        if (g.A[i * 4 + 1] > 0.99) continue;
        const pl = H.toLocal(_v.fromArray(g.P, i * 3), _w), nl = H.dirLocal(_n.fromArray(g.N, i * 3), _t);
        g.A[i * 4 + 1] = Math.max(g.A[i * 4 + 1], this.skyCube(H, pl, nl));
      }
    }
  }
  get hullBy() { return this._hb ||= Object.fromEntries(this.hulls.map((H) => [H.name, H])); }

  skyCell(H, ix, iy, iz) {
    const S = H.sky, o = ((iz * S.ny + iy) * S.nx + ix) * 6;
    if (S.cube[o] >= 0) return o;
    const p = new THREE.Vector3(-H.HW + ix * S.cell, -H.HH + iy * S.cell, clamp(iz * S.cell, 1, H.len - 1));
    // (a cell's point outside the frames moved in toward the axis: the wall's own vertices read inside light)
    const k = H.k(p.z);
    let sc = 1;
    H.OCT.forEach((v, i) => { const np = H.OCTN[i][0] * p.x + H.OCTN[i][1] * p.y, dd = k * (H.OCTN[i][0] * v[0] + H.OCTN[i][1] * v[1]) - H.SKIN - 3; if (np > dd) sc = Math.min(sc, dd / np); });
    p.x *= sc; p.y *= sc;
    const lit = S.opens.some((q) => (q.c ? q.c.distanceTo(p) : Math.abs(p.z - q.z)) < q.r);
    const d = new THREE.Vector3(), O = new THREE.Vector3(), L = new THREE.Vector3();
    this.skyDirs.forEach((ds, a) => {
      let s = 0;
      if (lit) for (const dl of ds) {
        // the other pieces too (light from the gaps' sides)
        let kk = H.ray(p, dl);
        if (kk > 0) { H.toWorld(p, O); for (const G of this.hulls) if (G !== H && G.shade && kk > 0) kk *= G.ray(G.toLocal(O, L), G.dirLocal(H.dirWorld(dl, d), _r1.clone())); }
        s += kk;
      }
      S.cube[o + a] = s / ds.length;
    });
    return o;
  }

  skyCube(H, p, n) {
    const S = H.sky;
    const fx = clamp((p.x + H.HW) / S.cell, 0, S.nx - 1.001), fy = clamp((p.y + H.HH) / S.cell, 0, S.ny - 1.001), fz = clamp(p.z / S.cell, 0, S.nz - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const w = n ? [n.x > 0 ? n.x * n.x : 0, n.x < 0 ? n.x * n.x : 0, n.y > 0 ? n.y * n.y : 0, n.y < 0 ? n.y * n.y : 0, n.z > 0 ? n.z * n.z : 0, n.z < 0 ? n.z * n.z : 0] : [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (wt < 1e-4) continue;
      const o = this.skyCell(H, ix + dx, iy + dy, iz + dz);
      for (let a = 0; a < 6; a++) s += wt * w[a] * H.sky.cube[o + a];
    }
    return 0.045 + 0.955 * s;
  }

  // a point's sky light, every direction alike (an instance's): inside a piece its cube, else the open sky
  skyAt(w) {
    for (const H of this.hulls) {
      const p = H.toLocal(w, _w), k = H.k(p.z);
      if (p.z > 0 && p.z < H.len && Math.abs(p.x) < k * H.HW && Math.abs(p.y) < k * H.HH) return this.skyCube(H, p.clone(), null);
    }
    return 1;
  }

  // ---- the meshes: a chunk per (piece, length, layer); a group's instances per module
  buildMeshes() {
    this.meshes = [];
    for (const [key, g] of this.chunks) {
      const geo = g.build();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mat), layer = key.split('|')[2];
      m.name = 'wreck-' + key;
      m.castShadow = layer === 'cast'; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.userData.range = RANGE[layer];
      // (drawn after the rest of the scene's opaque things - three sorts by material before depth, and the deck and the
      // ships cover much of it - and the skins last: from inside they are behind all the rest)
      m.renderOrder = layer === 'shell' ? 0.6 : 0.5;
      this.meshes.push(m);
    }
    this.chunks.clear();
    this.instMeshes = [];
    for (const [key, { name, list, H, inside }] of this.placed) {
      const { g, reach, cast } = this.mods.get(name);
      const m = new THREE.InstancedMesh(g, this.mat, list.length), sky = new Float32Array(list.length);
      list.forEach((e, i) => {
        m.setMatrixAt(i, e.M);
        sky[i] = this.skyAt(_v.setFromMatrixPosition(e.M).clone());
        if (e.tint) m.setColorAt(i, _c.setRGB(...e.tint));
      });
      if (m.instanceColor) list.forEach((e, i) => { if (!e.tint) m.setColorAt(i, _c.setRGB(1, 1, 1)); });
      // (the module's attributes shared - uploaded once - and the group's own sky light)
      const geo = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(g.attributes)) geo.setAttribute(k, a);
      geo.setIndex(g.index);
      geo.setAttribute('iSky', new THREE.InstancedBufferAttribute(sky, 1));
      m.geometry = geo;
      m.computeBoundingSphere();
      m.name = 'wreck-' + key;
      m.castShadow = cast; m.receiveShadow = true;
      m.userData.range = reach;
      m.renderOrder = 0.5;
      if (list.some((e) => e.axis)) m.userData.drift = list;
      if (inside) m.userData.inside = H;
      this.instMeshes.push(m);
    }
  }

  // ---- debris (wreckzones.js places it, adrift); what drifts is drawn where it is now, in the groups being drawn
  debris() { this.debrisMeshes = []; }
  placeDebris(t) {
    const M = _m4, Q = _q, S = _v, P = _w;
    for (const m of this.instMeshes) {
      const list = m.userData.drift;
      if (!list || (!m.visible && t > 0)) continue;
      list.forEach((d, i) => {
        if (!d.axis) return;
        Q.setFromAxisAngle(d.axis, d.w * t).multiply(d.q);
        P.copy(d.p).addScaledVector(d.bob, Math.sin((t * TAU) / d.per + d.ph));
        m.setMatrixAt(i, M.compose(P, Q, S.setScalar(d.s)));
      });
      m.instanceMatrix.needsUpdate = true;
    }
  }
  sparkSites() { return this.sparkList || []; }

  // each frame: what is drawn (each chunk and group within its reach), the eight lamps nearest the camera lighting the
  // wreck (its material; the core always among them), the drifting debris, the sparks
  update(t, camera) {
    const U = this.mat.userData.U, cam = camera.position;
    U.wTime.value = t;
    U.wGlow.value = 0.8 + 0.2 * Math.sin(t * 0.7) * (this.effects ? 1 : 0);
    for (const m of this.meshes) { const sp = m.geometry.boundingSphere; m.visible = sp.center.distanceTo(cam) - sp.radius < m.userData.range; }
    const out = new Map();
    for (const m of this.instMeshes) {
      const sp = m.boundingSphere, d = sp.center.distanceTo(cam) - sp.radius, H = m.userData.inside;
      if (H && !out.has(H)) { const p = H.toLocal(cam, _v), k = H.k(p.z) + 0.1; out.set(H, !(p.z > -40 && p.z < H.len + 40 && Math.abs(p.x) < k * H.HW && Math.abs(p.y) < k * H.HH)); }
      m.visible = d < (H && out.get(H) ? Math.min(300, m.userData.range) : m.userData.range);
    }
    const near = this.nearLamps(cam, 8, 450, t);
    for (let k = 0; k < 8; k++) {
      const e = near[k];
      if (!e) { U.wLampP.value[k].set(0, -1e6, 0, 1); U.wLampC.value[k].set(0, 0, 0); continue; }
      const L = e.L;
      U.wLampP.value[k].set(L.p.x, L.p.y, L.p.z, L.inside ? -L.reach : L.reach);
      U.wLampS.value[k] = (L.size || 2) ** 2;
      U.wLampC.value[k].set(L.col[0] * L.I * L.f, L.col[1] * L.I * L.f, L.col[2] * L.I * L.f);
    }
    for (const fn of this.updaters || []) fn(t, cam);
    const nearWreck = this.hulls.some((H) => { const p = H.toLocal(cam, _v); return p.z > -1500 && p.z < H.len + 1500 && Math.abs(p.x) < H.HW + 1500 && Math.abs(p.y) < H.HH + 1200; });
    if (this.effects && nearWreck) this.placeDebris(t, cam);
    this.sparks.mesh.visible = this.effects && nearWreck && this.sparks.sites.length > 0;
    if (this.sparks.mesh.visible) this.sparks.update(t, cam);
  }

  // the setting: the coolant mist (wreckzones.js Mist) - layers over the halls' decks
  setMist(on) { this.mistOn = on; for (const m of [...(this.mist || []), ...(this.beams || [])]) m.visible = on; }

  // the setting (sparks, flicker, drifting debris, the core's arcs)
  setEffects(on) {
    this.effects = on;
    const U = this.mat.userData.U;
    U.wSway.value = on ? 1 : 0;
    U.wFx.value = on ? 1 : 0;
    if (!on) this.placeDebris(0, null);
  }

  // the lamps nearest p (within `within` m, the far-reaching ones always counted), their brightness now (for the
  // material's eight and the scene's real lights: the deck and the ships lit red and amber inside)
  nearLamps(p, n = 3, within = 400, t = this.mat.userData.U.wTime.value, floods = true) {
    if (!this.lgrid) {
      this.lgrid = new Map();
      for (const L of this.lamps) {
        if (L.reach > 200) { this.big.push(L); continue; }
        const k = `${Math.floor(L.p.x / 200)},${Math.floor(L.p.y / 200)},${Math.floor(L.p.z / 200)}`;
        (this.lgrid.get(k) || this.lgrid.set(k, []).get(k)).push(L);
      }
    }
    const out = [], cx = Math.floor(p.x / 200), cy = Math.floor(p.y / 200), cz = Math.floor(p.z / 200), r2 = within * within;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
      for (const L of this.lgrid.get(`${cx + a},${cy + b},${cz + c}`) || []) { const d = L.p.distanceToSquared(p); if (d < r2) out.push({ L, d }); }
    }
    if (this.effects) for (const e of this.sparks?.sites || []) if (e.flash > 0.02) out.push({ L: { p: e.p, col: [1.0, 0.62, 0.3], I: 900, reach: 75, f: e.flash, spark: true }, d: e.p.distanceToSquared(p) * 0.6 });
    out.sort((a, b) => a.d - b.d);
    // the far-reaching ones (floods, the core) first - the nearest half of the slots at most - then the nearest small ones
    const big = this.big.filter((L) => floods || L.fixed).map((L) => ({ L, d: L.p.distanceToSquared(p) })).filter((e) => e.d < (e.L.reach + 60) ** 2).sort((a, b) => a.d - b.d);
    big.length = Math.min(big.length, Math.ceil(n / 2));
    out.length = Math.min(out.length, n - big.length);
    out.unshift(...big);
    for (const e of out) { e.d = Math.sqrt(e.d); if (!e.L.spark && !e.L.fixed) e.L.f = lampFlicker(e.L.i, t, this.effects); }
    return out;
  }

  // the shader patch: the sun's light in every lit material passes this test (every piece that throws shade); call
  // before anything lit compiles. The planet's light inside is cut with the sky's (the shade lines round the deck).
  patchShaders() {
    const C = THREE.ShaderChunk;
    if (C.lights_pars_begin.includes('wreckSun')) return;
    const shade = this.hulls.map((H, i) => [H, i]).filter(([H]) => H.shade);
    // each piece's box in its own axes (with its blocks outside the hull), for the slab test (the sun's direction's inverse)
    for (const [H, i] of shade) {
      const b = H.aabb, D = this.sunL[i];
      H.box = { min: b.min, max: b.max, inv: new THREE.Vector3(...[D.x, D.y, D.z].map((x) => 1 / (Math.abs(x) < 1e-6 ? 1e-6 : x))) };
    }
    const src = shade.map(([H, i]) => H.glsl(`wreckH${i}`, this.sunL[i])).join('\n');
    C.lights_pars_begin += `
float wkWrap( float a ) { return a - 6.2831853 * floor( ( a + 3.1415927 ) / 6.2831853 ); }
${src}
float wreckSun( vec3 w ) { float k = 1.0;${shade.map(([, i]) => ` if ( k > 0.0 ) k *= wreckH${i}( w );`).join('')} return k; }
`;
    const L = C.lights_fragment_begin, a = 'directLight.color *= caveK;';
    if (!L.includes(a)) throw new Error('lights chunk changed: wreck patch not applied (setCave first)');
    const b = 'IncidentLight directLight;';
    if (L.split(b).length !== 2) throw new Error('lights chunk changed: wreck patch not applied');
    C.lights_fragment_begin = L.replace(b, `${b}
	vec3 wreckN = ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz;
	float wreckK = dot( wreckN, ${g3v(this.sunDir)} ) > 0.0 ? wreckSun( vCaveW + wreckN * 0.6 ) : 1.0;`)
      .replace(a, `directLight.color *= caveK * ( UNROLLED_LOOP_INDEX == 0 ? wreckK : vCaveK.y );`);
    // where no sun gets in (the derelict's shadow, the meteorite) its shadow maps need not be looked up at all
    const sh = 'directLight.color *= ( directLight.visible && receiveShadow ) ? cascadeShadow() * worldShadow() : 1.0;';
    if (C.lights_fragment_begin.split(sh).length !== 2) throw new Error('lights chunk changed: wreck shadow skip not applied');
    C.lights_fragment_begin = C.lights_fragment_begin.replace(sh, 'directLight.color *= ( directLight.visible && receiveShadow && wreckK * caveK > 0.0 ) ? cascadeShadow() * worldShadow() : 1.0;');
  }
}
const _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();
const TRACK_HALF = 28;                                       // (track.js TRACK_W / 2)

export const PAINT_HULL = [0.052, 0.056, 0.06], PAINT_INNER = [0.045, 0.047, 0.044], PAINT_FRAME = [0.048, 0.046, 0.042], PAINT_TORN = [0.2, 0.195, 0.19];
export const PAINT_MACH = [0.05, 0.052, 0.055], PAINT_CLAMP = [0.09, 0.075, 0.04];
// the emergency lamps' light (linear, x the lens's brightness)
export const LAMP = { red: [1.0, 0.07, 0.03], amber: [1.0, 0.42, 0.07], white: [1.0, 0.85, 0.7], cyan: [0.35, 0.8, 1.0], cold: [0.5, 0.68, 1.0] };

// Sparks from torn conduits: bursts every so often at each site (a spray of hot streaks for ~0.4 s, flying straight
// and fading - no air, no gravity), each burst a flash of light on what is near it (nearLamps). All in the vertex
// shader: one draw, nothing per frame but the bursts' start times.
const SPARKS_PER = 48;
class Sparks {
  constructor(sites) {
    this.sites = sites.slice(0, 12).map((s) => ({ ...s, next: Math.random() * 3, start: -100, flash: 0 }));
    const n = Math.max(1, this.sites.length) * SPARKS_PER, pos = new Float32Array(n * 4 * 3), a = new Float32Array(n * 4 * 4), idx = [];
    const R = mulberry32(31);
    for (let i = 0; i < n; i++) {
      const e = Math.floor(i / SPARKS_PER), dl = R() * 0.45, sp = 18 + R() * 55, life = 0.25 + R() * 0.5;
      for (let c = 0; c < 4; c++) {
        pos.set([c & 1, c >> 1, 0], (i * 4 + c) * 3);
        a.set([e, dl, sp, life], (i * 4 + c) * 4);
      }
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const seed = new Float32Array(n * 4 * 3);
    for (let i = 0; i < n; i++) { const v = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]; for (let c = 0; c < 4; c++) seed.set(v, (i * 4 + c) * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('spark', new THREE.BufferAttribute(a, 4));
    g.setAttribute('jitter', new THREE.BufferAttribute(seed, 3));
    g.setIndex(idx);
    const S = Math.max(1, this.sites.length);
    this.U = { time: { value: 0 }, sP: { value: Array.from({ length: S }, (_, i) => (this.sites[i]?.p || new THREE.Vector3()).clone()) },
      sD: { value: Array.from({ length: S }, (_, i) => (this.sites[i]?.d || new THREE.Vector3(0, 1, 0)).clone()) }, sT: { value: new Float32Array(S).fill(-100) } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.U,   // (a streak's winding turns with it)
      vertexShader: /* glsl */`
        uniform float time; uniform vec3 sP[${S}]; uniform vec3 sD[${S}]; uniform float sT[${S}];
        attribute vec4 spark; attribute vec3 jitter; varying float vA; varying vec2 vQ;
        void main() {
          int e = int( spark.x );
          float age = time - sT[ e ] - spark.y, life = spark.w;
          vQ = position.xy;
          if ( age < 0.0 || age > life ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vA = 0.0; return; }
          vec3 dir = normalize( sD[ e ] + jitter * 0.75 );
          vec3 vel = dir * spark.z * ( 1.0 - 0.35 * age / life );
          vec3 head = sP[ e ] + dir * spark.z * age * ( 1.0 - 0.17 * age / life );
          vec3 tail = head - vel * 0.035;
          // the streak in view space: from its tail to its head, as wide across the screen as 0.12 m
          vec3 vH = ( viewMatrix * vec4( head, 1.0 ) ).xyz, vT = ( viewMatrix * vec4( tail, 1.0 ) ).xyz;
          vec2 d2 = vH.xy - vT.xy;
          vec2 across = length( d2 ) > 1e-5 ? normalize( vec2( -d2.y, d2.x ) ) : vec2( 1.0, 0.0 );
          vec3 p = mix( vT, vH, position.y ) + vec3( across * 0.06 * ( position.x * 2.0 - 1.0 ), 0.0 );
          vA = 1.0 - age / life;
          gl_Position = projectionMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */`varying float vA; varying vec2 vQ;
        void main() {
          float w = 1.0 - abs( vQ.x * 2.0 - 1.0 );
          vec3 c = mix( vec3( 1.0, 0.22, 0.03 ), vec3( 1.0, 0.62, 0.25 ), vA * vA ) * vA * w * 5.0;
          gl_FragColor = vec4( c, 1.0 );
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'wreck-sparks';
  }

  // (only the sites within 600 m burst: the rest wait)
  update(t, cam) {
    this.U.time.value = t;
    this.sites.forEach((s, i) => {
      if (t >= s.next && (!cam || s.p.distanceTo(cam) < 600)) { s.start = t; this.U.sT.value[i] = t; s.next = t + 0.4 + Math.random() * (Math.random() < 0.3 ? 4 : 1.6); }
      const a = t - s.start;
      s.flash = a < 0 ? 0 : Math.exp(-a * 9) * (a < 0.45 ? 1 : 0.3);
    });
  }
}
