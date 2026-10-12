// The derelict: a colossal old ship, broken in two, that the space circuit threads. The track comes round its bow,
// along its flank and in through a breach where the hull burst outward; down the hangar under a gash in its back, through
// the great bulkhead's jammed door and the spine corridor to where it snapped; across the gap between the two halves;
// through the aft half's reactor hall and out of the hole its main engine left in the engine block.
//
// Everything is built round the track (the halves' axes are fitted to it), from one description of the hull: a long
// octagon in section, tapered at the bow, its holes and torn ends given in (z along the axis, angle round it). The same
// description is
//  - the plating's mesh: cells cut where a hole's edge runs (marching squares, finer near an edge), the edge given its
//    thickness and the plates round it bent outward; an inner skin, ring frames every 24 m, stringers;
//  - the sun's light inside (every lit material, look.js's light loop): a ray from each pixel toward the sun is tested
//    against the two halves - their faces, holes, frames and bulkheads - so the sun only comes in where the hull is
//    open, in shafts striped by the frames, with a penumbra as wide as the sun's disc makes it;
//  - the sky light inside (an ambient cube per 12 m cell, rays through the same holes).
// No text, numbers, signs or markings anywhere: plates, seams, hatches, vents, wear and soot only.
import * as THREE from 'three';
import { mulberry32, noise2, fbm, smoothstep, clamp } from './noise.js';
import { hullMaps } from './hull.js';
import { Q } from './quality.js';

// ---- the hull's section: a long octagon (m) round the axis, counter-clockwise seen from the bow (x, y)
const HW = 115, HH = 80, CT = 46, CB = 36;             // half width, half height, top and bottom chamfers
const OCT = [[HW - CT, HH], [-(HW - CT), HH], [-HW, HH - CT], [-HW, -HH + CB], [-(HW - CB), -HH], [HW - CB, -HH],
  [HW, -HH + CB], [HW, HH - CT]];
const SKIN = 1.6;                                        // outer skin to inner skin (m)
const RIB_EVERY = 24, RIB_W = 0.9, RIB_D = 3.2;          // ring frames: spacing, web half-thickness... (m)
const TAU = Math.PI * 2;
const ihash = (n) => { let h = Math.imul(n | 0, 374761393) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const f5 = (x) => (Math.abs(x) < 1e-9 ? '0.0' : x.toFixed(5));
const g3v = (v) => `vec3(${f5(v.x)}, ${f5(v.y)}, ${f5(v.z)})`;
// a hole's (or the frames' cut's) coordinates at (z, angle): the offsets from its centre in (z, 100 x angle), turned by
// its rot, over its radii (rz m, rt rad); inside its plain ellipse where u^2 + v^2 < 1
function holeUV(h, z, th) {
  const dz = z - h.z, dt = wrapA(th - h.t) * 100, c = Math.cos(h.rot || 0), sn = Math.sin(h.rot || 0);
  return [(dz * c + dt * sn) / h.rz, (-dz * sn + dt * c) / (h.rt * 100)];
}
function holeUVglsl(h) {
  const c = Math.cos(h.rot || 0), sn = Math.sin(h.rot || 0);
  return `float dz = z - ${f5(h.z)}, dt = wkWrap( th - ${f5(h.t)} ) * 100.0;
	  float u = ( dz * ${f5(c)} + dt * ${f5(sn)} ) * ${f5(1 / h.rz)}, v = ( dt * ${f5(c)} - dz * ${f5(sn)} ) * ${f5(1 / (h.rt * 100))};`;
}

// outward normals of the octagon's faces, and the polygon inset by d (offset lines meet at the bisectors)
const OCTN = OCT.map((a, i) => { const b = OCT[(i + 1) % 8], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; });
function inset(k, d) {
  return OCT.map((v, i) => {
    const na = OCTN[(i + 7) % 8], nb = OCTN[i], s = 1 + na[0] * nb[0] + na[1] * nb[1];
    return [k * v[0] - d * (na[0] + nb[0]) / s, k * v[1] - d * (na[1] + nb[1]) / s];
  });
}

// ---------------------------------------------------------------- geometry accumulation
// per vertex: position, normal, wUV (metres across / along the face), wT (direction u runs in), wA (kind, sky light,
// soot, seed), wC (paint colour, or a lamp's colour)
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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('wUV', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('wT', new THREE.Float32BufferAttribute(this.T, 3));
    g.setAttribute('wA', new THREE.Float32BufferAttribute(this.A, 4));
    g.setAttribute('wC', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- a half of the ship
// Its frame: x across, y up, z along the axis from the bow (fore half) or the torn end (aft half) toward the stern.
// The hull: the octagon, scaled k0..1 over the first `taper` m (the bow), holes in (z, angle round the axis),
// torn ends, frames every 24 m (they stay across a hole: shafts of light are striped by them), bulkheads.
class Half {
  constructor({ O, X, Y, Z, len, taper = 0, tip = 1, cap0 = 'closed', cap1 = 'closed', holes = [], edge0 = null, edge1 = null,
    bulkheads = [], sternHole = null, ribFrom = 0, ribTo = null }) {
    Object.assign(this, { O, X, Y, Z, len, taper, tip, cap0, cap1, holes, edge0, edge1, bulkheads, sternHole, ribFrom, ribTo: ribTo ?? len });
    this.boxes = [];                                     // solid blocks outside the hull that throw shadows too
    this.M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(O);
    this.Mi = this.M.clone().invert();
    // the faces as planes n.p <= d (local): 8 sides, 8 taper faces (the bow), the two ends
    this.planes = [];
    OCT.forEach((a, i) => { const n = OCTN[i]; this.planes.push({ n: new THREE.Vector3(n[0], n[1], 0), d: n[0] * a[0] + n[1] * a[1], face: i }); });
    if (taper > 0) {
      OCT.forEach((a, i) => {
        const b = OCT[(i + 1) % 8];
        const p0 = new THREE.Vector3(tip * a[0], tip * a[1], 0), p1 = new THREE.Vector3(tip * b[0], tip * b[1], 0), p2 = new THREE.Vector3(a[0], a[1], taper);
        const n = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0)).normalize();
        if (n.x * OCTN[i][0] + n.y * OCTN[i][1] < 0) n.negate();
        this.planes.push({ n, d: n.dot(p0), face: 8 + i });
      });
    }
    this.planes.push({ n: new THREE.Vector3(0, 0, -1), d: 0, face: 16 });
    this.planes.push({ n: new THREE.Vector3(0, 0, 1), d: len, face: 17 });
  }

  k(z) { return this.taper > 0 && z < this.taper ? this.tip + (1 - this.tip) * Math.max(0, z) / this.taper : 1; }
  toLocal(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.Mi); }
  toWorld(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.M); }
  dirLocal(d, out = new THREE.Vector3()) { return out.set(d.dot(this.X), d.dot(this.Y), d.dot(this.Z)); }
  dirWorld(d, out = new THREE.Vector3()) { return out.set(0, 0, 0).addScaledVector(this.X, d.x).addScaledVector(this.Y, d.y).addScaledVector(this.Z, d.z); }

  // the plating's field at (z, angle): > 0 plate, < 0 a hole (about metres from the edge); the hole it is nearest
  field(z, th, out = null) {
    let f = 1e4, which = -1;
    this.holes.forEach((h, i) => {
      const [u, v] = holeUV(h, z, th), r2 = u * u + v * v;
      if (r2 >= 2.2 * 2.2) return;
      const ph = Math.atan2(v, u);
      const b = 1 + h.a[0] * Math.sin(2 * ph + h.p[0]) + h.a[1] * Math.sin(5 * ph + h.p[1]) + h.a[2] * Math.sin(11 * ph + h.p[2]) + h.a[3] * Math.sin(23 * ph + h.p[3]);
      const val = (Math.sqrt(r2) - b) * h.s;
      if (val < f) { f = val; which = i; }
    });
    for (const [e, sign, end] of [[this.edge0, 1, 0], [this.edge1, -1, this.len]]) {
      if (!e) continue;
      const lim = end + sign * (e.d + e.a[0] * (0.5 + 0.5 * Math.sin(3 * th + e.p[0])) + e.a[1] * Math.sin(7 * th + e.p[1]) + e.a[2] * Math.sin(17 * th + e.p[2]));
      const val = sign * (z - lim);
      if (val < f) { f = val; which = 100 + end; }
    }
    if (out) out.which = which;
    return f;
  }
  ribBand(z, th = null) {
    if (z < this.ribFrom - RIB_W || z > this.ribTo + RIB_W) return 0;
    if (this.ribCut && th != null) { const [u, v] = holeUV(this.ribCut, z, th); if (u * u + v * v < 1) return 0; }
    const m = ((z - this.ribFrom) % RIB_EVERY + RIB_EVERY) % RIB_EVERY, d = Math.min(m, RIB_EVERY - m);
    return d < RIB_W ? 1 : 0;
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
  // the light reaching local point p along local direction d (1 .. 0)
  ray(p, d) {
    for (const b of this.boxes) {
      const q = p.clone().sub(b.c), o = [q.dot(b.ax), q.dot(b.ay), q.dot(b.az)], dd = [d.dot(b.ax), d.dot(b.ay), d.dot(b.az)];
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
    const e = new THREE.Vector3();
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

  // the same test in GLSL: name(p world, offset along the normal done by the caller) -> 1 lit .. 0 in shadow
  glsl(name, sunL) {
    const D = sunL, P = this.planes;
    const holes = this.holes.map((h) => `
	if ( abs( z - ${f5(h.z)} ) < ${f5(2.3 * Math.max(h.rz, h.rt * 100))} ) { ${holeUVglsl(h)} float r2 = u * u + v * v;
	  if ( r2 < ${f5(2.2 * 2.2)} ) { float ph = atan( v, u );
	    float b = 1.0 + ${f5(h.a[0])} * sin( 2.0 * ph + ${f5(h.p[0])} ) + ${f5(h.a[1])} * sin( 5.0 * ph + ${f5(h.p[1])} ) + ${f5(h.a[2])} * sin( 11.0 * ph + ${f5(h.p[2])} ) + ${f5(h.a[3])} * sin( 23.0 * ph + ${f5(h.p[3])} );
	    f = min( f, ( sqrt( r2 ) - b ) * ${f5(h.s)} ); } }`).join('');
    const edges = [[this.edge0, 1, 0], [this.edge1, -1, this.len]].filter(([e]) => e).map(([e, sign, end]) => `
	f = min( f, ${f5(sign)} * ( z - ( ${f5(end)} + ${f5(sign)} * ( ${f5(e.d)} + ${f5(e.a[0])} * ( 0.5 + 0.5 * sin( 3.0 * th + ${f5(e.p[0])} ) ) + ${f5(e.a[1])} * sin( 7.0 * th + ${f5(e.p[1])} ) + ${f5(e.a[2])} * sin( 17.0 * th + ${f5(e.p[2])} ) ) ) ) );`).join('');
    const cap = (c, end) => (c === 'open' ? '1.0' : c === 'closed' || !this.sternHole ? '0.0'
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
    return `
float ${name}_field( float z, float th ) {
	float f = 1e4;${holes}${edges}
	return f;
}
float ${name}_pass( vec3 e, int face, float w ) {
	if ( face == 16 ) return ${cap(this.cap0, 0)};
	if ( face == 17 ) return ${cap(this.cap1, 1)};
	float f = ${name}_field( e.z, atan( e.y, e.x ) );
	float open = 1.0 - smoothstep( -w, w, f );
	float m = mod( e.z - ${f5(this.ribFrom)}, ${f5(RIB_EVERY)} ), rd = min( m, ${f5(RIB_EVERY)} - m );
	float rib = ( e.z > ${f5(this.ribFrom - RIB_W)} && e.z < ${f5(this.ribTo + RIB_W)} ) ? 1.0 - smoothstep( ${f5(RIB_W)} - w, ${f5(RIB_W)} + w, rd ) : 0.0;${this.ribCut ? `
	{ float z = e.z, th = atan( e.y, e.x ); ${holeUVglsl(this.ribCut)} if ( u * u + v * v < 1.0 ) rib = 0.0; }` : ''}
	return open * ( 1.0 - rib );
}
float ${name}( vec3 w ) {
	{ vec3 c = ${g3v(this.bound.c)} - w; float tca = dot( c, ${g3v(this.sunW)} );
	  if ( tca < ${f5(-this.bound.r)} || dot( c, c ) - tca * tca > ${f5(this.bound.r * this.bound.r)} ) return 1.0; }
	vec3 q = w - ${g3v(this.O)};
	vec3 p = vec3( dot( q, ${g3v(this.X)} ), dot( q, ${g3v(this.Y)} ), dot( q, ${g3v(this.Z)} ) );
	const vec3 D = ${g3v(D)};
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

// ---------------------------------------------------------------- the material
// One program for all of it (few draws): plates and seams worked out per pixel in metres on each face (as the track's
// steel, hull.js), each kind its own layout - armour panels in staggered rows with hatches and louvred vents, the inner
// skin's corrugated panels, frames with lightening holes, machinery, torn and burnt edges, tread plate; paint faded
// and chipped to bare metal at the edges, soot round the holes, grime streaks. The emergency lamps' light (the eight
// nearest the camera, flickering) is added per pixel; the sky's light is scaled by each vertex's view of the sky.
export function wreckMaterial() {
  const U = { wTime: { value: 0 }, wLampP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e6, 0, 1)) },
    wLampC: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, wFlick: { value: new Float32Array(96).fill(1) },
    hullNoise: { value: null }, wSway: { value: 1 } };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.hullNoise.value = hullMaps();
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 wUV; attribute vec3 wT; attribute vec4 wA; attribute vec3 wC;
varying vec2 vWUV; varying vec3 vWT; varying vec4 vWA; varying vec3 vWC;
uniform float wFlick[96]; uniform float wTime, wSway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  if ( wA.x > 6.5 ) {
    float ph = dot( position, vec3( 0.013, 0.021, 0.017 ) );
    transformed += vec3( sin( wTime * 0.43 + ph ), 0.4 * sin( wTime * 0.31 + ph * 1.7 ), cos( wTime * 0.37 + ph * 1.3 ) ) * wA.w * wSway;
  }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vWUV = wUV; vWA = wA; vWC = wC;
  if ( wA.x > 6.5 ) vWA = vec4( 3.0, wA.y, wA.z, 0.0 );
  {
    vec3 ht = wT;
  #ifdef USE_INSTANCING
    ht = mat3( instanceMatrix ) * ht;
  #endif
    vWT = normalize( ( viewMatrix * vec4( mat3( modelMatrix ) * ht, 0.0 ) ).xyz );
  }
  if ( wA.x > 5.5 ) vWC *= wFlick[ int( wA.w ) ];`);
    sh.fragmentShader = (Q.lite ? '#define WRECK_LITE\n' : '') + sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D hullNoise; uniform vec4 wLampP[8]; uniform vec3 wLampC[8];
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
		// frames: seams every 6 m; on a web deeper than 2.5 m, lightening slots (dark) every 4 m, each with a flanged rim
		id = vec2( 0.0, floor( uv.y / 6.0 ) );
		float sv = mod( uv.y, 6.0 );
		h -= 10.0 * wGroove( min( sv, 6.0 - sv ), 0.03, fp );
		if ( W > 1e5 ) {
			float cy = mod( uv.y, 4.0 ) - 2.0;
			float d = wRoundBox( vec2( uv.x - W * 0.5, cy ), vec2( W * 0.2, 1.0 ), W * 0.18 );
			feat.z = 1.0 - smoothstep( -fp, fp, d );
			h += 12.0 * wGroove( abs( d + 0.07 ), 0.05, fp );
		}
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
	// v runs to ~1 km: split into a 96 m period's index and the metres into it (float steps)
	float wvi = floor( wuv.y / 96.0 );
	vec2 wq = vec2( wuv.x, wuv.y - wvi * 96.0 );
	float wfp = max( length( vec2( dFdx( wq.x ), dFdy( wq.x ) ) ), length( vec2( dFdx( wq.y ), dFdy( wq.y ) ) ) );
	vec2 wid; vec3 wFeat;
	float wW = vWA.w;
	float wh = wRelief( wq, wKind, wfp, wW, wid, wFeat );
	vec2 wGrad = vec2( 0.0 );
#ifndef WRECK_LITE
	// (the screen-space changes taken here, outside any branch: they are undefined inside one that differs per pixel)
	vec2 dU = dFdx( vWUV ), dV = dFdy( vWUV );
	float dhx = dFdx( wh ), dhy = dFdy( wh ), det = dU.x * dV.y - dU.y * dV.x;
	if ( wfp < 0.02 ) {
		// near: the relief's slope by finite differences (a step no smaller than the pixel)
		float we = max( 0.004, wfp * 0.75 );
		vec2 wd1; vec3 wd2;
		float whx = wRelief( wq + vec2( we, 0.0 ), wKind, wfp, wW, wd1, wd2 ), why = wRelief( wq + vec2( 0.0, we ), wKind, wfp, wW, wd1, wd2 );
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
	wPaint *= 1.0 - 0.3 * smoothstep( 0.55, 0.85, wStreak );
	if ( wKind < 0.5 ) wPaint *= mix( 1.0, 0.72, step( 0.9, wHash( wid + 9.1 ) ) );                    // replaced panels
	wPaint *= 1.0 - 0.6 * clamp( -wh / 50.0, 0.0, 1.0 );                                                  // seams, recesses
	wPaint = mix( wPaint, vec3( 0.006 ), wFeat.y * step( wh, -30.0 ) );                                  // the vents' depths
	wPaint = mix( wPaint, vec3( 0.004 ), wFeat.z );                                                       // lightening holes
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
	// the emergency lamps (the eight nearest): a pool of light each, wrapped a little round the surface
	vec3 wNw = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
	for ( int i = 0; i < 8; i ++ ) {
		vec3 L = wLampP[ i ].xyz - vCaveW;
		float d2 = dot( L, L ), r = wLampP[ i ].w;
		if ( d2 > r * r ) continue;
		vec3 l = L * inversesqrt( d2 );
		float nl = dot( wNw, l );
		float fall = 1.0 / ( d2 + 4.0 ) * pow( clamp( 1.0 - d2 / ( r * r ), 0.0, 1.0 ), 2.0 );
		reflectedLight.directDiffuse += wLampC[ i ] * fall * clamp( nl * 0.85 + 0.15, 0.0, 1.0 ) * BRDF_Lambert( material.diffuseColor );
	}`);
  };
  mat.customProgramCacheKey = () => `wreck-${Q.lite}`;
  mat.userData.U = U;
  return mat;
}

// ---------------------------------------------------------------- the build
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();

export class Wreck {
  constructor(track, sunDir) {
    this.track = track;
    this.sunDir = sunDir.clone().normalize();
    const rnd = (this.rnd = mulberry32(1977));
    this.fitHalves();
    this.mat = wreckMaterial();
    this.chunks = new Map();                       // geometry per (half, 120 m of its length, layer)
    this.lamps = [];
    this.effects = true;                           // (the setting: flicker, sparks, drifting debris)
    for (const H of this.halves) {
      this.trackTable(H);
      this.plating(H);
      this.frames(H);
      this.caps(H);
      this.floor(H);
      this.pylons(H);
    }
    this.hangar(this.fore);
    for (const H of this.halves) this.markers(H);
    this.bulkhead(this.fore);
    this.corridor(this.fore);
    this.exterior(this.fore);
    this.engineRoom(this.aft);
    this.gap();
    for (const H of this.halves) { this.belts(H); this.greebles(H); }
    this.skyLight();
    this.meshes = [];
    for (const [key, g] of this.chunks) {
      const geo = g.build();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mat);
      m.name = 'wreck-' + key;
      m.castShadow = false; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.userData.detail = key.endsWith('-detail');
      this.meshes.push(m);
    }
    this.debris();
    this.sparks = new Sparks(this.sparkSites());
    // the asteroids and towers keep clear of it
    for (const H of this.halves) {
      const c = H.toWorld(new THREE.Vector3(0, 0, H.len / 2));
      track.keepOut.push({ c, r: Math.hypot(H.len / 2 + 60, HW, HH) });
    }
  }

  geo(H, z, layer = 'main') {
    if (this.target) return this.target;
    const key = `${H.name}-${Math.floor(clamp(z, -200, H.len + 200) / 120)}-${layer}`;
    let g = this.chunks.get(key);
    if (!g) this.chunks.set(key, (g = new Geo()));
    return g;
  }

  // The two halves' frames, from the track: each axis along the track's line through it, the deck `yOff` under the
  // axis, the half rolled about its axis (a derelict drifts: neither half is level with the track, nor with the other)
  fitHalves() {
    const tr = this.track, f = {};
    const sIn = tr.at('wreckIn'), sBrk = tr.at('wreckBrk'), sOut = tr.at('wreckOut');
    const fit = (s0, s1, yOff, roll) => {
      const A = tr.frame(s0, f).P.clone(), Ua = f.U.clone(), B = tr.frame(s1, f).P.clone(), Ub = f.U.clone();
      const Z = B.clone().sub(A).normalize(), Y0 = Ua.add(Ub).addScaledVector(Z, -Ua.dot(Z)).normalize();
      const Y = Y0.clone().applyAxisAngle(Z, THREE.MathUtils.degToRad(roll)), X = new THREE.Vector3().crossVectors(Y, Z);
      return { A, Z, Y, X, up: Y0.clone().multiplyScalar(yOff) };
    };
    // fore half: the axis 30 m over the deck from inside the breach to the break; the break at the track's wreckBrk
    const F = fit(sIn + 160, sBrk - 30, 30, 22);
    const zOf = (P, O, Z) => P.clone().sub(O).dot(Z);
    const brkP = tr.frame(sBrk, f).P.clone();
    let O = F.A.clone().add(F.up);
    const zBrk = zOf(brkP.clone().add(F.up), O, F.Z);
    // where the track goes through the side: the first point of the approach inside the octagon
    const local = (p, O, H) => { const q = p.clone().sub(O); return [q.dot(H.X), q.dot(H.Y), q.dot(H.Z)]; };
    let sCross = sIn;
    for (let s = sIn - 300; s < sIn + 200; s += 1) {
      const [x, y] = local(tr.frame(s, f).P, O, F);
      if (Math.abs(x) < HW && Math.abs(y) < HH) { sCross = s; break; }
    }
    const zCross = zOf(tr.frame(sCross, f).P.clone().add(F.up), O, F.Z);
    const bow = 330;                                            // the bow's tip that far ahead of the breach
    const Lf = zBrk - zCross + bow;
    O = O.addScaledVector(F.Z, zCross - bow);                   // z = 0 at the bow's tip
    this.sCross = sCross;
    const crossL = local(tr.frame(sCross, f).P, O, F);
    const th = Math.atan2(crossL[1], crossL[0] > 0 ? HW : -HW);
    const side = Math.sign(crossL[0]);
    const R = this.rnd;
    const jag = (s) => ({ a: [0.16 + R() * 0.06, 0.08 + R() * 0.04, 0.045, 0.028 * s], p: [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28] });
    const hole = (z, t, rz, rt, peel, soot, s = 1) => ({ z, t, rz, rt, s: Math.min(rz, rt * 100), peel, soot, ...jag(s) });
    const zb = bow;                                             // (the breach's centre, z)
    this.zBulk = zb + 300;
    const tSide = side > 0 ? 0 : Math.PI;
    const fore = new Half({ O, X: F.X, Y: F.Y, Z: F.Z, len: Lf, taper: 250, tip: 0.36, cap0: 'closed', cap1: 'open',
      holes: [
        hole(zb + 8, wrapA(tSide + side * -0.1), 118, 0.62, 7, 1),                   // the breach, round the track
        hole(zb + 175, Math.PI / 2 + 0.05, 120, 0.33, 5, 0.8),                        // the gash along its back
        hole(Lf - 70, wrapA(Math.PI / 2 - side * 0.55), 110, 0.75, 6, 0.9),           // torn open where it broke
        hole(zb + 70, wrapA(tSide + side * 0.56), 86, 0.24, 6, 1),                     // torn up over the breach to the shoulder

        hole(zb - 120, wrapA(tSide + side * 0.75), 28, 0.18, 3, 1),                    // smaller holes: shoulder, flanks
        hole(zb + 430, wrapA(Math.PI - tSide - 0.1), 45, 0.28, 4, 1),
        hole(zb + 90, wrapA(Math.PI - tSide + 0.25), 30, 0.2, 3, 1),
        hole(zb + 520, -Math.PI / 2 + 0.3, 36, 0.2, 3, 1),
      ],
      edge1: { d: 12, a: [26, 8, 3.5], p: [R() * 6.28, R() * 6.28, R() * 6.28] },
      bulkheads: [], ribFrom: 270, ribTo: Lf - 2 });
    fore.name = 'fore';
    fore.breachSide = side;
    this.fitBreach(fore);
    // the great bulkhead between the hangar and the spine: its door round the track
    {
      const sB = this.sAtZ(fore, this.zBulk), q = fore.toLocal(tr.frame(sB, f).P.clone());
      fore.bulkheads.push({ z: this.zBulk, x: q.x, y: q.y + 14, hx: 46, hy: 30 });
    }
    // aft half: drifted 130 m off the break and turned on its own axis the other way
    const A = fit(sBrk + 170, sOut - 15, 30, -12);
    const gap = 130;
    let Oa = A.A.clone().add(A.up);
    const zA0 = zOf(brkP.clone().add(A.up), Oa, A.Z) + gap;
    const zOut = zOf(tr.frame(sOut, f).P.clone().add(A.up), Oa, A.Z);
    Oa = Oa.addScaledVector(A.Z, zA0);
    const La = zOut - zA0;
    const sh = (() => { const q = tr.frame(sOut, f).P.clone().sub(Oa); return { x: q.dot(A.X), y: q.dot(A.Y) + 4 }; })();
    const aft = new Half({ O: Oa, X: A.X, Y: A.Y, Z: A.Z, len: La, cap0: 'open', cap1: 'stern',
      holes: [
        hole(60, Math.PI / 2 + 0.4, 70, 0.4, 5, 0.9),
        hole(La - 110, wrapA(Math.PI - 0.3), 30, 0.2, 3, 1),
      ],
      edge0: { d: 10, a: [24, 7, 3.5], p: [R() * 6.28, R() * 6.28, R() * 6.28] },
      sternHole: { x: sh.x, y: sh.y, r: 36 }, ribFrom: 6, ribTo: La - 22 });
    aft.name = 'aft';
    this.fore = fore; this.aft = aft; this.halves = [fore, aft];
    this.sunL = this.halves.map((H) => H.dirLocal(this.sunDir));
  }

  // The breach: wherever the space round the track (40 m wide, from 10 m under the deck to 24 m over it) meets the
  // hull's skin on the way in, the hull must be open - the hole is fitted round those points (its jagged edge never
  // reaching in past them), and the frames there are torn away
  fitBreach(H) {
    const tr = this.track, f = {}, pts = [], q = new THREE.Vector3();
    const scale = (p) => { const k = H.k(p.z); let m = 0; OCT.forEach((v, i) => { m = Math.max(m, (OCTN[i][0] * p.x + OCTN[i][1] * p.y) / (k * (OCTN[i][0] * v[0] + OCTN[i][1] * v[1]))); }); return m; };
    for (let s = this.sCross - 260; s < this.sCross + 260; s += 3) {
      tr.frame(s, f);
      for (let x = -40; x <= 40; x += 5) for (const y of [-10, -2, 6, 14, 24]) {
        H.toLocal(q.copy(f.P).addScaledVector(f.R, x).addScaledVector(f.U, y), q);
        const m = scale(q);
        if (m > 0.86 && m < 1.12 && q.z > 0 && q.z < H.len) pts.push([q.z, Math.atan2(q.y, q.x)]);
      }
    }
    // in (z, 100 x angle): the centre, the principal direction, the half extents along and across it
    const t0 = pts[0][1], P = pts.map(([z, t]) => [z, (t0 + wrapA(t - t0)) * 100]);
    const mz = P.reduce((a, q) => a + q[0], 0) / P.length, mt = P.reduce((a, q) => a + q[1], 0) / P.length;
    let szz = 0, stt = 0, szt = 0;
    for (const [z, t] of P) { szz += (z - mz) ** 2; stt += (t - mt) ** 2; szt += (z - mz) * (t - mt); }
    const rot = 0.5 * Math.atan2(2 * szt, szz - stt), c = Math.cos(rot), sn = Math.sin(rot);
    const U = P.map(([z, t]) => [(z - mz) * c + (t - mt) * sn, -(z - mz) * sn + (t - mt) * c]);
    const u0 = Math.min(...U.map((q) => q[0])), u1 = Math.max(...U.map((q) => q[0])), v0 = Math.min(...U.map((q) => q[1])), v1 = Math.max(...U.map((q) => q[1]));
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, A = (u1 - u0) / 2, B = (v1 - v0) / 2;
    const cz = mz + uc * c - vc * sn, ct = mt + uc * sn + vc * c;
    let k = 0;
    for (const [u, v] of U) k = Math.max(k, Math.hypot((u - uc) / A, (v - vc) / B));
    const h = H.holes[0], bmin = 1 - h.a[0] - h.a[1] - h.a[2] - h.a[3];
    Object.assign(h, { z: cz, t: wrapA(ct / 100), rot, rz: (A * k + 12) / bmin, rt: (B * k + 9) / bmin / 100 });
    h.s = Math.min(h.rz, h.rt * 100);
    H.ribCut = { z: cz, t: h.t, rot, rz: A * k + 18, rt: (B * k + 14) / 100 };
    this.breach = { cz, ct, rot, A, B, k };
  }

  // arc length where the track is at z of a half
  sAtZ(H, z) {
    const tr = this.track, f = {};
    let best = 1e9, bs = 0;
    for (let s = tr.at('wreckIn') - 400; s < tr.at('wreckOut') + 200; s += 2) {
      const q = H.toLocal(tr.frame(s, f).P, _v);
      if (Math.abs(q.x) < HW && Math.abs(q.z - z) < best) { best = Math.abs(q.z - z); bs = s; }
    }
    return bs;
  }

  // the sun's light at a world point (1 .. 0), both halves: the CPU twin of the shader's
  sunAt(p) {
    let k = 1;
    this.halves.forEach((H, i) => { if (k > 0) k *= H.ray(H.toLocal(p, _w), this.sunL[i]); });
    return k;
  }

  // ---- the plating: per face, cells of ~8 m along x the face's width / 8; near an edge 2 m cells, cut along the
  // edge (marching squares); the edge's thickness; the inner skin; the plates within ~9 m of an edge bent outward
  plating(H) {
    const nk = H.taper > 0 ? [0, H.taper] : [0];
    const zEnd = H.len;
    const info = {};
    for (let face = 0; face < 8; face++) {
      const a = OCT[face], b = OCT[(face + 1) % 8], W = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nu = Math.max(2, Math.round(W / 8));
      // rows of z: 8 m, a row edge on the bow's kink
      const zs = [];
      for (let z = 0; z < zEnd; z += 8) { if (H.taper > 0 && z < H.taper && z + 8 > H.taper) { zs.push(z, H.taper); continue; } zs.push(z); }
      zs.push(zEnd);
      const zz = [...new Set(zs)].sort((p, q) => p - q);
      // the point at (z, u in 0..1) on the outer skin (local), the inner skin, the outward normal
      const outer = (z, u, o) => { const k = H.k(z); return o.set(k * (a[0] + (b[0] - a[0]) * u), k * (a[1] + (b[1] - a[1]) * u), z); };
      const inner = (z, u, o) => { const q = inset(H.k(z), SKIN), qa = q[face], qb = q[(face + 1) % 8]; return o.set(qa[0] + (qb[0] - qa[0]) * u, qa[1] + (qb[1] - qa[1]) * u, z); };
      const nrm = (z) => (H.taper > 0 && z < H.taper ? H.planes[8 + face].n : H.planes[face].n);
      const fld = (z, u) => { outer(z, u, _v); return H.field(z, Math.atan2(_v.y, _v.x), info); };
      const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], 0).normalize();
      // a vertex of both skins at (z, u): the outer one, the inner one (bent outward together near an edge)
      const emit = (g, z, u, f, which, soot) => {
        const n = nrm(z), peel = this.peel(H, z, u, f, which, face);
        const po = outer(z, u, new THREE.Vector3()).addScaledVector(n, peel), pi = inner(z, u, new THREE.Vector3()).addScaledVector(n, peel);
        const nW = H.dirWorld(n, new THREE.Vector3()), tW = H.dirWorld(T, new THREE.Vector3());
        const uv = u * W;
        const o = g.v(H.toWorld(po, _w), nW, uv, z, tW, [K_HULL, 1, soot, face], PAINT_HULL);
        const i = g.v(H.toWorld(pi, _w), nW.clone().negate(), uv, z, tW, [K_INNER, 0, soot * 0.7, face], PAINT_INNER);
        return [o, i, po, pi];
      };
      const sootAt = (f, which) => {
        const h = which >= 0 && which < 100 ? H.holes[which] : null;
        return h ? h.soot * smoothstep(22, 0, f) : which >= 100 ? 0.8 * smoothstep(16, 0, f) : 0;
      };
      for (let j = 0; j < zz.length - 1; j++) {
        const z0 = zz[j], z1 = zz[j + 1];
        for (let c = 0; c < nu; c++) {
          const u0 = c / nu, u1 = (c + 1) / nu;
          const fs = [fld(z0, u0), fld(z1, u0), fld(z1, u1), fld(z0, u1), fld((z0 + z1) / 2, (u0 + u1) / 2)];
          const lo = Math.min(...fs), hi = Math.max(...fs);
          if (hi < -14) continue;                                  // all hole
          const g = this.geo(H, (z0 + z1) / 2);
          if (lo > 14) { this.cellQuad(g, emit, z0, z1, u0, u1, fs.slice(0, 4), info, sootAt); continue; }
          const N = 4;
          for (let sj = 0; sj < N; sj++) for (let sc = 0; sc < N; sc++) {
            const za = z0 + (z1 - z0) * sj / N, zb = z0 + (z1 - z0) * (sj + 1) / N, ua = u0 + (u1 - u0) * sc / N, ub = u0 + (u1 - u0) * (sc + 1) / N;
            this.cellCut(g, H, face, emit, za, zb, ua, ub, fld, info, sootAt, nrm, outer, inner, W, T);
          }
        }
      }
    }
  }

  // the plates bend outward near a hole's edge (each hole its own amount), more at the very edge, unevenly
  peel(H, z, u, f, which, face) {
    if (f > 9 || f < -1) return 0;
    const amp = which >= 0 && which < 100 ? H.holes[which].peel : which >= 100 ? 4 : 0;
    const k = 1 - clamp(f, 0, 9) / 9;
    return amp * k * k * (0.35 + 0.9 * noise2(z * 0.11 + face * 3.1, u * 2.3 + face));
  }

  cellQuad(g, emit, z0, z1, u0, u1, fs, info, sootAt) {
    const vs = [[z0, u0], [z1, u0], [z1, u1], [z0, u1]].map(([z, u], k) => emit(g, z, u, fs[k], -1, 0));
    this.poly(g, vs);
  }

  // one small cell cut along the edge: the plate's polygon (corners inside, crossings on the edges), both skins, and
  // the edge's thickness between them
  cellCut(g, H, face, emit, za, zb, ua, ub, fld, info, sootAt, nrm, outer, inner, W, T) {
    const C = [[za, ua], [zb, ua], [zb, ub], [za, ub]];
    const F = [], Wh = [];
    for (const [z, u] of C) { F.push(fld(z, u)); Wh.push(info.which); }
    if (F.every((x) => x <= 0)) return;
    const poly = [], cross = [];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4, fa = F[k], fb = F[k2];
      if (fa > 0) poly.push({ z: C[k][0], u: C[k][1], f: fa, w: Wh[k] });
      if ((fa > 0) !== (fb > 0)) {
        const t = fa / (fa - fb), z = C[k][0] + (C[k2][0] - C[k][0]) * t, u = C[k][1] + (C[k2][1] - C[k][1]) * t;
        const w = fa < fb ? Wh[k] : Wh[k2];
        poly.push({ z, u, f: 0, w, x: true });
      }
    }
    const vs = poly.map((p) => emit(g, p.z, p.u, p.f, p.w, sootAt(p.f, p.w)));
    this.poly(g, vs);
    // the torn edge's thickness: between consecutive crossings
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      if (!(p.x && q.x)) continue;
      const A = vs[k], B = vs[(k + 1) % poly.length];
      // outward from the plate into the hole: the edge's direction crossed with the face normal
      const n = nrm((p.z + q.z) / 2), e = B[2].clone().sub(A[2]);
      const side = e.clone().cross(n).normalize();
      const mid = A[2].clone().add(B[2]).multiplyScalar(0.5);
      // (toward lower field: the hole)
      const probe = mid.clone().addScaledVector(side, 0.5);
      if (H.field(probe.z, Math.atan2(probe.y, probe.x)) > 0) side.negate();
      const nW = H.dirWorld(side, new THREE.Vector3()), tW = H.dirWorld(n, new THREE.Vector3());
      const len = e.length(), soot = sootAt(0, p.w);
      const v0 = g.v(H.toWorld(A[2], _w), nW, 0, 0, tW, [K_TORN, 1, soot, 3], PAINT_TORN);
      const v1 = g.v(H.toWorld(B[2], _w), nW, 0, len, tW, [K_TORN, 1, soot, 3], PAINT_TORN);
      const v2 = g.v(H.toWorld(B[3], _w), nW, SKIN, len, tW, [K_TORN, 0.5, soot, 3], PAINT_TORN);
      const v3 = g.v(H.toWorld(A[3], _w), nW, SKIN, 0, tW, [K_TORN, 0.5, soot, 3], PAINT_TORN);
      this.quadFacing(g, [v0, v1, v2, v3], nW);
    }
  }

  // a convex polygon of both skins' vertex pairs: the outer one facing out, the inner one in
  poly(g, vs) {
    if (vs.length < 3) return;
    const n = new THREE.Vector3().fromArray(g.N, vs[0][0] * 3);
    const tri = (a, b, c, flip) => {
      const pa = new THREE.Vector3().fromArray(g.P, a * 3), pb = new THREE.Vector3().fromArray(g.P, b * 3), pc = new THREE.Vector3().fromArray(g.P, c * 3);
      const cr = pb.sub(pa).cross(pc.sub(pa));
      return cr.dot(n) * (flip ? -1 : 1) >= 0;
    };
    const ccw = tri(vs[0][0], vs[1][0], vs[2][0], false);
    for (let k = 1; k < vs.length - 1; k++) {
      if (ccw) { g.tri(vs[0][0], vs[k][0], vs[k + 1][0]); g.tri(vs[0][1], vs[k + 1][1], vs[k][1]); }
      else { g.tri(vs[0][0], vs[k + 1][0], vs[k][0]); g.tri(vs[0][1], vs[k][1], vs[k + 1][1]); }
    }
  }

  // a quad (4 vertex indices, any order round it) wound to face n
  quadFacing(g, q, n) {
    const P = (i) => new THREE.Vector3().fromArray(g.P, i * 3);
    const cr = P(q[1]).sub(P(q[0])).cross(P(q[2]).sub(P(q[0])));
    if (cr.dot(n) >= 0) { g.tri(q[0], q[1], q[2]); g.tri(q[0], q[2], q[3]); }
    else { g.tri(q[0], q[2], q[1]); g.tri(q[0], q[3], q[2]); }
  }

  // ---- the track through a half: its centre line's local position and frame, every 2 m (for placing parts round it)
  trackTable(H) {
    const tr = this.track, f = {}, rows = [];
    for (let s = tr.at('wreckIn') - 520; s < tr.at('wreckOut') + 200; s += 2) {
      tr.frame(s, f);
      const p = H.toLocal(f.P, new THREE.Vector3());
      if (p.z < -60 || p.z > H.len + 60) continue;
      rows.push({ s, p, R: H.dirLocal(f.R, new THREE.Vector3()), U: H.dirLocal(f.U, new THREE.Vector3()) });
    }
    H.tt = rows;
  }

  // the track's local position and frame at a half's z (nearest row; inside the hull)
  trackAt(H, z) {
    let best = null, bd = 1e9;
    for (const r of H.tt) { const d = Math.abs(r.p.z - z) + (Math.abs(r.p.x) < HW && Math.abs(r.p.y) < HH ? 0 : 1000); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // what of the wreck reaches into the space the ships and the chase camera need round the deck (|x| < 26 m, from
  // 8 m under to 15 m over it): vertices, triangle centres and edge middles, by the nearest track sample
  clearance(xMax = 26, yLo = -8, yHi = 15) {
    const tr = this.track, f = {}, pts = [];
    for (let s = tr.at('back'); s < tr.at('wreckOut') + 400; s += 2) { tr.frame(s, f); pts.push({ P: f.P.clone(), R: f.R.clone(), U: f.U.clone(), T: f.T.clone(), s }); }
    const cell = 24, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
    pts.forEach((q, i) => { const k = key(Math.floor(q.P.x / cell), Math.floor(q.P.y / cell), Math.floor(q.P.z / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    const hits = [], d = new THREE.Vector3();
    const test = (p, what) => {
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
      let best = -1, bd = 1e18;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const i of grid.get(key(cx + a, cy + b, cz + c)) || []) { const dd = pts[i].P.distanceToSquared(p); if (dd < bd) { bd = dd; best = i; } }
      }
      if (best < 0) return;
      const q = pts[best];
      d.subVectors(p, q.P);
      const x = d.dot(q.R), y = d.dot(q.U), t = d.dot(q.T);
      if (Math.abs(x) < xMax && y > yLo && y < yHi && Math.abs(t) < 3) hits.push({ what, s: Math.round(q.s), x: +x.toFixed(1), y: +y.toFixed(1) });
    };
    for (const m of this.meshes) {
      const P = m.geometry.attributes.position, I = m.geometry.index, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) test(A.fromBufferAttribute(P, i), m.name);
      for (let i = 0; i < I.count; i += 3) {
        A.fromBufferAttribute(P, I.getX(i)); B.fromBufferAttribute(P, I.getX(i + 1)); C.fromBufferAttribute(P, I.getX(i + 2));
        if (A.distanceToSquared(B) + B.distanceToSquared(C) + C.distanceToSquared(A) < 30) continue;
        test(A.clone().add(B).add(C).divideScalar(3), m.name + ' tri');
        test(A.clone().add(B).multiplyScalar(0.5), m.name + ' edge'); test(B.clone().add(C).multiplyScalar(0.5), m.name + ' edge'); test(C.clone().add(A).multiplyScalar(0.5), m.name + ' edge');
      }
    }
    return { n: hits.length, first: hits.slice(0, 20) };
  }

  // ---------------------------------------------------------------- the structures
  // the ends: the bow's nose plate (the fore half), the engine block (the aft half: a wall 24 m thick, the hole its
  // main engine left through it - the track goes out through that)
  caps(H) {
    const g = this.geo(H, H.cap0 === 'closed' ? 0 : H.len);
    const wall = (z, k, dz, hole, kind, paint, sky) => {
      // a face at z (normal along dz): the octagon scaled k, minus a round hole (local x, y, r)
      const contour = OCT.map(([x, y]) => new THREE.Vector2(k * x, k * y));
      const holes = hole ? [Array.from({ length: 40 }, (_, i) => { const a = -(i / 40) * TAU; return new THREE.Vector2(hole.x + hole.r * Math.cos(a), hole.y + hole.r * Math.sin(a)); })] : [];
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = [...contour, ...holes.flat()];
      const n = new THREE.Vector3(0, 0, dz), t = new THREE.Vector3(1, 0, 0), gg = this.geo(H, z);
      const vs = all.map((q) => this.pv(gg, H, Wreck.F(new THREE.Vector3()), new THREE.Vector3(q.x, q.y, z), n, q.x + 200, q.y + 200, t, { kind, paint, sky }));
      const nw = H.dirWorld(n, new THREE.Vector3());
      for (const [a, b, c] of tris) {
        const A = new THREE.Vector3().fromArray(gg.P, vs[a] * 3), B = new THREE.Vector3().fromArray(gg.P, vs[b] * 3), C = new THREE.Vector3().fromArray(gg.P, vs[c] * 3);
        if (B.sub(A).cross(C.sub(A)).dot(nw) >= 0) gg.tri(vs[a], vs[b], vs[c]); else gg.tri(vs[a], vs[c], vs[b]);
      }
    };
    void g;
    if (H.cap0 === 'closed') wall(0, H.tip, -1, null, K_HULL, PAINT_HULL, 1);
    if (H.cap1 === 'stern') {
      const h = H.sternHole, T = 24;
      wall(H.len, 1, 1, h, K_HULL, PAINT_HULL, 1);
      wall(H.len - T, 1 - 2 * SKIN / HW, -1, h, K_INNER, PAINT_INNER, 0);
      // the hole's bore through the block: torn round its edge (the mount ring ripped out), blackened
      const segs = 40;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const jag = (a) => 1 + 0.05 * Math.sin(7 * a + 1.3) + 0.03 * Math.sin(17 * a);
        const P = [[a0, H.len - T], [a1, H.len - T], [a1, H.len], [a0, H.len]].map(([a, z]) => new THREE.Vector3(h.x + h.r * Math.cos(a) * (z > H.len - 1 ? jag(a) : 1), h.y + h.r * Math.sin(a) * (z > H.len - 1 ? jag(a) : 1), z));
        const n = new THREE.Vector3(-Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2), 0);
        const gg = this.geo(H, H.len), F0 = Wreck.F(new THREE.Vector3());
        const vs = P.map((q, m) => this.pv(gg, H, F0, q, n, (m === 1 || m === 2 ? a1 : a0) * h.r, q.z, new THREE.Vector3(0, 0, 1), { kind: K_TORN, paint: PAINT_TORN, soot: 0.9, sky: 0.3 }));
        this.quadFacing(gg, vs, H.dirWorld(n, new THREE.Vector3()));
      }
      // the mount's stumps: the brackets that held the main engine, torn off round the hole
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3, r = h.r + 7;
        const c = new THREE.Vector3(h.x + r * Math.cos(a), h.y + r * Math.sin(a), H.len + 3);
        const ax = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), ay = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
        this.box(H, Wreck.F(c, ax, ay, new THREE.Vector3(0, 0, 1)), 5, 3, 3 + (i % 3), { kind: K_MACH, paint: PAINT_MACH, sky: 1, soot: 0.5 });
      }
    }
  }

  // the decks the hangar and the spine stand on (60 m under the axis), plated in 30 m strips per 24 m bay on transverse
  // beams from frame to frame; torn away near the breach and where the ship broke
  floor(H) {
    const y = -62, xr = 89, R = this.rnd, beams = new Set();
    H.floorSet = new Set();
    const z0 = H === this.fore ? 270 : 14, z1 = H === this.fore ? H.len - 8 : H.len - 26, zFirst = Math.ceil((z0 - H.ribFrom) / RIB_EVERY) * RIB_EVERY + H.ribFrom;
    // the beams, frame to frame, in pieces (gone where the track comes through)
    for (let z = zFirst; z <= z1 + 12; z += RIB_EVERY) for (let k = 0; k < 6; k++) {
      const xa = -xr + (k * 2 * xr) / 6, xb = xa + (2 * xr) / 6, xc = (xa + xb) / 2;
      if (!this.free(H, new THREE.Vector3(xc, y - 1.5, z), 16)) continue;
      beams.add(`${Math.round(z)}:${k}`);
      this.beam(H, new THREE.Vector3(xa, y - 1.5, z), new THREE.Vector3(xb, y - 1.5, z), 1.2, 2.2, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
    }
    // the plates, each on the beams at both its ends; torn where the hull is open beside it, a few missing
    for (let z = zFirst; z + RIB_EVERY <= z1 + 12; z += RIB_EVERY) for (let k = 0; k < 6; k++) {
      const xa = -xr + (k * 2 * xr) / 6, xb = xa + (2 * xr) / 6, xc = (xa + xb) / 2, zc = z + RIB_EVERY / 2;
      const f = H.field(zc, Math.atan2(y, xc > 0 ? HW : -HW));
      if ((Math.abs(xc) > 40 && f < 25) || R() < 0.06 || zc > z1 || !this.free(H, new THREE.Vector3(xc, y, zc), 18)) continue;
      if (!beams.has(`${Math.round(z)}:${k}`) || !beams.has(`${Math.round(z + RIB_EVERY)}:${k}`)) continue;
      H.floorSet.add(`${Math.round(z)}:${k}`);
      this.box(H, Wreck.F(new THREE.Vector3(xc, y, zc)), (xb - xa) / 2 - 0.15, 0.35, RIB_EVERY / 2 - 0.15, { kind: K_DECK, paint: PAINT_DECK, b: 0.08 });
    }
  }

  // a floor plate under local (x, z)
  onFloor(H, x, z) {
    const zi = Math.floor((z - H.ribFrom) / RIB_EVERY) * RIB_EVERY + H.ribFrom, k = Math.floor((x + 89) / (178 / 6));
    return k >= 0 && k < 6 && H.floorSet.has(`${Math.round(zi)}:${k}`);
  }

  // the track's supports where it runs through: a column from the deck below up to a cross-head under its girders,
  // every 72 m, braced
  pylons(H) {
    let last = -1e9;
    for (const r of H.tt) {
      if (r.p.z < 40 || r.p.z > H.len - 30 || Math.abs(r.p.x) > 60 || r.p.z - last < 72) continue;
      if ((H === this.fore && r.p.z < 300) || r.p.y - 4.9 + 61.6 < 16) continue;      // (a column worth building)
      if (!this.onFloor(H, r.p.x, r.p.z)) continue;                                    // (and a deck to stand on)
      last = r.p.z;
      const top = r.p.clone().addScaledVector(r.U, -4.9);
      const o = { kind: K_FRAME, paint: PAINT_PYLON, sky: 0 };
      this.beam(H, top.clone().addScaledVector(r.R, -15), top.clone().addScaledVector(r.R, 15), 1.6, 1.4, r.U, o);
      const foot = new THREE.Vector3(top.x, -61.6, top.z), head = top.clone().addScaledVector(r.U, -0.7);
      this.beam(H, foot, head, 3.2, 3.2, new THREE.Vector3(0, 0, 1), o);
      this.box(H, Wreck.F(foot.clone().add(new THREE.Vector3(0, 0.5, 0))), 4.5, 0.5, 4.5, o);
      for (const sd of [-1, 1]) this.beam(H, head.clone().addScaledVector(r.R, sd * 12).addScaledVector(r.U, -0.2), new THREE.Vector3(top.x + sd * 1.6 * r.R.x, (top.y - 61.6) / 2 + 4, top.z + sd * 1.6 * r.R.z), 0.9, 0.9, new THREE.Vector3(0, 0, 1), o);
    }
  }

  // the hangar (fore, from the breach to the bulkhead): galleries along both sides on brackets from the frames, cargo
  // pods stacked on the deck and toppled, a gantry crane on rails under the roof with its hoist hanging
  hangar(H) {
    const R = this.rnd, z0 = 286, z1 = this.zBulk - 6, yG = 14, xIn = 84, xOut = HW - SKIN - RIB_D - 0.6;
    for (const sd of [-1, 1]) {
      for (let z = z0; z + RIB_EVERY <= z1; z += RIB_EVERY) {
        const zc = z + RIB_EVERY / 2, th = Math.atan2(yG, sd * HW), f = H.field(zc, th);
        if (f < 30) continue;                                          // gone where the hull burst
        const o = { kind: K_DECK, paint: PAINT_DECK };
        this.box(H, Wreck.F(new THREE.Vector3(sd * (xIn + xOut) / 2, yG, zc)), (xOut - xIn) / 2, 0.35, RIB_EVERY / 2 - 0.1, o);
        this.beam(H, new THREE.Vector3(sd * xIn, yG - 0.9, z + 0.2), new THREE.Vector3(sd * xIn, yG - 0.9, z + RIB_EVERY - 0.2), 0.8, 1.6, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
        // railing along the inner edge
        const od = { kind: K_FRAME, paint: PAINT_RAIL, layer: 'detail' };
        for (let k = 0; k < 8; k++) this.box(H, Wreck.F(new THREE.Vector3(sd * (xIn + 0.3), yG + 0.9, z + 1.5 + k * 3)), 0.15, 0.55, 0.15, od);
        for (const hh of [0.75, 1.45]) this.beam(H, new THREE.Vector3(sd * (xIn + 0.3), yG + hh, z + 0.4), new THREE.Vector3(sd * (xIn + 0.3), yG + hh, z + RIB_EVERY - 0.4), 0.14, 0.14, new THREE.Vector3(0, 1, 0), od);
        // a bracket down to the frame
        this.beam(H, new THREE.Vector3(sd * (xIn + 2), yG - 1.6, z), new THREE.Vector3(sd * (xOut - 0.5), yG - 22, z), 0.9, 0.9, new THREE.Vector3(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME });
      }
    }
    // cargo pods on the deck: stacks along both walls, a few knocked over or adrift off the deck
    const pods = [[0.1, 0.045, 0.03], [0.035, 0.05, 0.065], [0.07, 0.068, 0.06], [0.085, 0.07, 0.03], [0.05, 0.058, 0.045]];
    for (let z = z0 + 8; z < z1 - 14; z += 23 + R() * 6) for (const sd of [-1, 1]) {
      const th = Math.atan2(-60, sd * HW);
      if (H.field(z, th) < 25 && R() < 0.8) continue;
      const stack = 1 + Math.floor(R() * 3), xc = sd * (58 + R() * 18);
      for (let k = 0; k < stack; k++) {
        const tip = k === stack - 1 && R() < 0.3 ? (R() - 0.5) * 0.5 : 0;
        const ax = new THREE.Vector3(Math.cos(tip), Math.sin(tip), 0), ay = new THREE.Vector3(-Math.sin(tip), Math.cos(tip), 0);
        const pc = new THREE.Vector3(xc + (R() - 0.5) * 2, -62 + 0.4 + 5 + k * 10.1 + Math.abs(tip) * 5, z + (R() - 0.5) * 2), pk = pods[Math.floor(R() * pods.length)];
        // (on the deck: every corner of it over a plate, and the stack on it)
        const onDeck = [[-5, -10], [5, -10], [-5, 10], [5, 10]].every(([dx, dz]) => this.onFloor(H, pc.x + dx, pc.z + dz));
        if (!onDeck) break;
        if (this.free(H, pc, 12)) this.pod(H, Wreck.F(pc, ax, ay, new THREE.Vector3(0, 0, 1)), pk); else break;
      }
    }
    // the gantry crane: rails hung from the roof frames, a box-girder bridge on end trucks, a trolley, its hoist
    const yR = 66, xr = 58, zc = 470;
    for (const sd of [-1, 1]) {
      this.beam(H, new THREE.Vector3(sd * xr, yR, z0), new THREE.Vector3(sd * xr, yR, z1), 2.2, 2.6, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_CRANE });
      for (let z = H.ribFrom + RIB_EVERY * Math.ceil((z0 - H.ribFrom) / RIB_EVERY); z < z1; z += RIB_EVERY) this.beam(H, new THREE.Vector3(sd * xr, yR + 1.3, z), new THREE.Vector3(sd * xr, HH - SKIN - RIB_D - 0.6, z), 1.0, 1.4, new THREE.Vector3(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME });
      this.box(H, Wreck.F(new THREE.Vector3(sd * xr, yR - 2.6, zc)), 3.2, 2.2, 9, { kind: K_MACH, paint: PAINT_CRANE });
    }
    this.box(H, Wreck.F(new THREE.Vector3(0, yR - 6.4, zc)), xr + 2, 3.2, 4.2, { kind: K_MACH, paint: PAINT_CRANE });
    for (const dz of [-4.6, 4.6]) this.beam(H, new THREE.Vector3(-xr, yR - 9.8, zc + dz), new THREE.Vector3(xr, yR - 9.8, zc + dz), 1.2, 0.9, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_CRANE });
    const xT = 21;
    this.box(H, Wreck.F(new THREE.Vector3(xT, yR - 11.5, zc)), 5, 1.8, 6, { kind: K_MACH, paint: PAINT_MACH });
    for (const dx of [-1.2, 1.2]) this.cyl(H, new THREE.Vector3(xT + dx, yR - 13.3, zc), new THREE.Vector3(xT + dx * 1.6, 24, zc + 0.8), 0.35, { kind: K_MACH, paint: PAINT_CABLE, caps: false, segs: 6, layer: 'detail' });
    this.box(H, Wreck.F(new THREE.Vector3(xT, 22, zc + 0.8)), 3.2, 2.4, 1.8, { kind: K_MACH, paint: PAINT_CLAMP });
    this.tube(H, [new THREE.Vector3(xT, 19.5, zc + 0.8), new THREE.Vector3(xT, 17.5, zc + 0.8), new THREE.Vector3(xT + 1.2, 16.2, zc + 0.8), new THREE.Vector3(xT + 2.4, 17.2, zc + 0.8)], 0.55, { kind: K_MACH, paint: PAINT_MACH, layer: 'detail' });
    // emergency lamps on the frames, both sides, every other frame
    for (let z = H.ribFrom + RIB_EVERY * 2; z < z1; z += RIB_EVERY * 2) for (const sd of [-1, 1]) {
      if (H.field(z, Math.atan2(-20, sd * HW)) < 20) continue;
      this.lamp(H, new THREE.Vector3(sd * (xOut - 0.4), -22, z), new THREE.Vector3(-sd, 0, 0), (z / RIB_EVERY) % 3 === 0 ? 'amber' : 'red');
    }
  }

  // small red marker lamps high on the frames' flanges at the roof's corners, every other frame
  markers(H) {
    const q = inset(1, SKIN + RIB_D + 0.6 + 0.45 * 0.7);      // (the housing's back on the flange's face)
    for (let z = H.ribFrom + RIB_EVERY; z < H.ribTo - 10; z += RIB_EVERY * 2) {
      if (H === this.fore && z < 300) continue;
      for (const i of [0, 1]) {
        const [x, y] = q[i];
        const th = Math.atan2(y, x);
        if (H.field(z, th) < 16) continue;
        const out = new THREE.Vector3(-x, -y, 0).normalize();
        this.lamp(H, new THREE.Vector3(x, y, z), out, 'red', 0.7);
      }
    }
  }

  // a cargo pod (20 x 10 x 10 m): a box with corner posts, ribbed sides, a door end
  pod(H, F, paint) {
    const o = { kind: K_MACH, paint, sky: 0 };
    this.box(H, F, 4.9, 4.9, 9.8, { ...o, b: 0.4 });
    const ox = { ...o, kind: K_FRAME, paint: paint.map((c) => c * 0.7) };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ax, sx * 4.9).addScaledVector(F.ay, sy * 4.9), F.ax, F.ay, F.az), 0.45, 0.45, 10, ox);
    for (const sx of [-1, 1]) for (let k = -3; k <= 3; k++) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ax, sx * 5).addScaledVector(F.az, k * 2.6), F.ax, F.ay, F.az), 0.2, 4.3, 0.3, { ...ox, layer: 'detail' });
  }

  // an emergency lamp: a caged housing on a bracket, its lens lit (flickering: update)
  lamp(H, p, out, col, size = 1) {
    const i = this.lamps.length;
    if (i >= GLOW_I) return;                    // (the last index is the reactors' glow)
    const ay = new THREE.Vector3(0, 1, 0), az = out.clone().normalize(), ax = new THREE.Vector3().crossVectors(ay, az).normalize();
    const F = Wreck.F(p.clone(), ax, new THREE.Vector3().crossVectors(az, ax), az);
    this.box(H, F, 1.4 * size, 0.5 * size, 0.45 * size, { kind: K_MACH, paint: PAINT_MACH });
    this.box(H, Wreck.F(p.clone().addScaledVector(az, 0.5 * size), F.ax, F.ay, F.az), 1.15 * size, 0.3 * size, 0.1 * size, { kind: K_LAMP, paint: LAMP[col], seed: i, b: 0.03 });
    for (const k of [-1, 0, 1]) this.box(H, Wreck.F(p.clone().addScaledVector(az, 0.62 * size).addScaledVector(F.ax, k * 0.55 * size), F.ax, F.ay, F.az), 0.05 * size, 0.42 * size, 0.06 * size, { kind: K_FRAME, paint: PAINT_FRAME, layer: 'detail' });
    const w = H.toWorld(p.clone().addScaledVector(az, 1.5 * size), new THREE.Vector3());
    this.lamps.push({ p: w, col: LAMP[col], i, fail: this.rnd() < 0.35, ph: this.rnd() * 6.28, half: H, big: size > 1.4, small: size < 1, f: 1 });
  }

  // the great bulkhead (fore, between the hangar and the spine): a wall 3 m thick across the hull, its door opening
  // round the track framed by a heavy jamb, stiffeners on its face, one sliding leaf jammed a third of the way across
  bulkhead(H) {
    const b = H.bulkheads[0], z = b.z, k = 1, T = 1.5;
    const ring = inset(k, SKIN);
    const face = (zz, dz) => {
      const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
      const hole = [[b.x - b.hx, b.y - b.hy], [b.x - b.hx, b.y + b.hy], [b.x + b.hx, b.y + b.hy], [b.x + b.hx, b.y - b.hy]].map(([x, y]) => new THREE.Vector2(x, y));
      const tris = THREE.ShapeUtils.triangulateShape(contour, [hole]), all = [...contour, ...hole];
      const n = new THREE.Vector3(0, 0, dz), g = this.geo(H, zz), F0 = Wreck.F(new THREE.Vector3());
      const vs = all.map((q) => this.pv(g, H, F0, new THREE.Vector3(q.x, q.y, zz), n, q.x + 200, q.y + 200, new THREE.Vector3(1, 0, 0), { kind: K_INNER, paint: PAINT_BULK }));
      const nw = H.dirWorld(n, new THREE.Vector3());
      for (const [a, bb, c] of tris) {
        const A = new THREE.Vector3().fromArray(g.P, vs[a] * 3), B = new THREE.Vector3().fromArray(g.P, vs[bb] * 3), C = new THREE.Vector3().fromArray(g.P, vs[c] * 3);
        if (B.sub(A).cross(C.sub(A)).dot(nw) >= 0) g.tri(vs[a], vs[bb], vs[c]); else g.tri(vs[a], vs[c], vs[bb]);
      }
    };
    face(z - T, -1); face(z + T, 1);
    // the jamb: a frame 4 m wide round the opening, standing 2 m proud of both faces
    const jo = { kind: K_FRAME, paint: PAINT_JAMB, b: 0.5 };
    const x0 = b.x - b.hx - 2, x1 = b.x + b.hx + 2, y0 = b.y - b.hy - 2, y1 = b.y + b.hy + 2;
    this.box(H, Wreck.F(new THREE.Vector3(b.x, y1, z)), b.hx + 4, 2, T + 2, jo);
    this.box(H, Wreck.F(new THREE.Vector3(b.x, y0, z)), b.hx + 4, 2, T + 2, jo);
    this.box(H, Wreck.F(new THREE.Vector3(x0, b.y, z)), 2, b.hy, T + 2, jo);
    this.box(H, Wreck.F(new THREE.Vector3(x1, b.y, z)), 2, b.hy, T + 2, jo);
    // stiffeners on both faces, every 16 m across, clear of the opening
    const yRange = (x) => {
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 8; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % 8];
        if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
        const y = ay + (by - ay) * (x - ax) / (bx - ax);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      return [lo, hi];
    };
    for (let x = -96; x <= 96; x += 16) for (const dz of [-1, 1]) {
      const [lo, hi] = yRange(x), o = { kind: K_FRAME, paint: PAINT_FRAME };
      const zz = z + dz * (T + 0.9);
      const runs = x > x0 - 2 && x < x1 + 2 ? [[lo + 1, y0 - 2.5], [y1 + 2.5, hi - 1]] : [[lo + 1, hi - 1]];
      for (const [a, c] of runs) if (c - a > 3) this.beam(H, new THREE.Vector3(x, a, zz), new THREE.Vector3(x, c, zz), 1.2, 1.8, new THREE.Vector3(0, 0, dz), o);
    }
    // the sliding leaf (hangar side), jammed 12 m into the opening, in its rails
    const lx = b.x + b.hx - 12 + 25, lz = z - T - 3.4;
    this.box(H, Wreck.F(new THREE.Vector3(lx, b.y, lz)), 25, b.hy + 1, 1.6, { kind: K_HULL, paint: PAINT_DOOR, b: 0.4 });
    for (const yy of [-0.6, 0, 0.6]) this.box(H, Wreck.F(new THREE.Vector3(lx, b.y + yy * b.hy, lz - 1.9)), 24, 1.1, 0.5, { kind: K_FRAME, paint: PAINT_DOOR });
    this.box(H, Wreck.F(new THREE.Vector3(lx - 24.4, b.y, lz - 1.2)), 0.9, b.hy, 0.9, { kind: K_TORN, paint: PAINT_TORN, soot: 0.6 });
    for (const sy of [-1, 1]) this.beam(H, new THREE.Vector3(b.x + b.hx - 18, b.y + sy * (b.hy + 2.6), lz), new THREE.Vector3(b.x + b.hx + 56, b.y + sy * (b.hy + 2.6), lz), 1.6, 2.2, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
    // two big lamps over the opening
    for (const sx of [-1, 1]) this.lamp(H, new THREE.Vector3(b.x + sx * (b.hx - 8), y1 + 2.5, z - T - 2.3), new THREE.Vector3(0, 0, -1), 'amber', 1.8);
  }

  // the spine (fore, from the bulkhead toward the break): a corridor 112 m wide between plated walls on the deck, a
  // roof deck 30 m up; pipes along both walls on brackets and clamps, cable trays under the roof, cables hanging in
  // loops; lamps on the walls; the walls and roof end torn where the ship broke
  corridor(H) {
    const R = this.rnd, z0 = this.zBulk + 3, half = 56, yTop = 30, yBot = -61.5;
    const tz = (z) => this.trackAt(H, z).p.x;
    const zEnd = (x) => H.len - 115 + 18 * Math.sin(x * 0.08 + 1.1) + 9 * Math.sin(x * 0.31);   // the torn end
    for (const sd of [-1, 1]) {
      for (let z = z0; z < H.len - 90; z += RIB_EVERY) {
        const xc = tz(z + 12) + sd * half, ze = Math.min(z + RIB_EVERY, zEnd(xc + z));
        if (ze - z < 4) continue;
        const o = { kind: K_INNER, paint: PAINT_INNER };
        this.box(H, Wreck.F(new THREE.Vector3(xc, (yTop + yBot) / 2, (z + ze) / 2)), 0.6, (yTop - yBot) / 2, (ze - z) / 2, o);
        this.beam(H, new THREE.Vector3(xc - sd * 1.5, yBot, z + 0.6), new THREE.Vector3(xc - sd * 1.5, yTop, z + 0.6), 1.2, 1.8, new THREE.Vector3(sd, 0, 0), { kind: K_FRAME, paint: PAINT_FRAME });
        // the roof
        if (sd > 0) for (let q = 0; q < 4; q++) {
          const xa = tz(z + 12) - half + q * half / 2, zq = Math.min(ze, zEnd(xa + 30 + z) - 6);
          if (zq - z > 3) this.box(H, Wreck.F(new THREE.Vector3(xa + half / 4, yTop + 0.5, (z + zq) / 2)), half / 4 - 0.1, 0.5, (zq - z) / 2 - 0.05, { kind: K_INNER, paint: PAINT_INNER });
        }
      }
      // pipes along the wall: three runs, clamped to brackets every 8 m
      const runs = [[-46, 1.7], [-40, 1.1], [8, 2.3], [14, 1.0]];
      for (const [y, r] of runs) {
        const pts = [], zz1 = H.len - 100 + R() * 30;
        for (let z = z0 + 2; z < zz1; z += 6) pts.push(new THREE.Vector3(tz(z) + sd * (half - 0.6 - 1.3 - r), y, z));
        this.tube(H, pts, r, { kind: K_MACH, paint: r > 2 ? PAINT_PIPE2 : PAINT_PIPE, clampEvery: 8, segs: r > 1.5 ? 10 : 8 });
        for (let z = z0 + 6; z < zz1; z += 8) this.box(H, Wreck.F(new THREE.Vector3(tz(z) + sd * (half - 0.6 - 0.65), y, z)), 0.65, 0.3, 0.3, { kind: K_FRAME, paint: PAINT_FRAME, layer: 'detail' });
      }
      // a cable tray under the roof edge, its bundle
      const tray = [];
      for (let z = z0 + 2; z < H.len - 110; z += 6) tray.push(new THREE.Vector3(tz(z) + sd * (half - 6), yTop - 2.2, z));
      this.beam(H, tray[0], tray[tray.length - 1], 4, 0.6, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
      for (const dx of [-1.2, 0, 1.2]) this.tube(H, tray.map((q) => q.clone().add(new THREE.Vector3(dx, 0.75, 0))), 0.45, { kind: K_MACH, paint: PAINT_CABLE, segs: 6, layer: 'detail' });
      // lamps on the wall, every 36 m, the sides alternating
      for (let z = z0 + (sd > 0 ? 18 : 36); z < H.len - 120; z += 72) this.lamp(H, new THREE.Vector3(tz(z) + sd * (half - 1.1), -6, z), new THREE.Vector3(-sd, 0, 0), sd > 0 ? 'red' : 'amber');
    }
    // cables hanging from the roof in loops (sagging: the ship spun slowly as it died and they settled that way)
    for (let k = 0; k < 14; k++) {
      const z = z0 + 10 + R() * (H.len - 140 - z0), x = tz(z) + (R() - 0.5) * 80, span = 10 + R() * 24, sag = 8 + R() * 18;
      const a = new THREE.Vector3(x, yTop - 0.2, z), b = new THREE.Vector3(x + (R() - 0.5) * 16, yTop - 0.2, z + span), pts = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12, c = a.clone().lerp(b, t); c.y -= sag * 4 * t * (1 - t); pts.push(c); }
      this.tube(H, pts, 0.32 + R() * 0.3, { kind: K_MACH, paint: PAINT_CABLE, segs: 6, layer: 'detail', sway: 0.25 + sag * 0.04 });
    }
  }

  // a frame on the outer skin: face i, u across it (0..1), at z; ay its outward normal, az along the axis, ax = ay x az
  onHull(H, face, u, z, lift = 0) {
    const k = H.k(z), a = OCT[face], b = OCT[(face + 1) % 8];
    const n = (H.taper > 0 && z < H.taper ? H.planes[8 + face].n : H.planes[face].n).clone();
    const az = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize(), ax = new THREE.Vector3().crossVectors(n, az);
    const p = new THREE.Vector3(k * (a[0] + (b[0] - a[0]) * u), k * (a[1] + (b[1] - a[1]) * u), z).addScaledVector(n, lift);
    return Wreck.F(p, ax, n, az);
  }

  // plating there (not a hole) for a footprint of +-du across and +-dz along
  solid(H, face, u, z, du = 0.05, dz = 10, margin = 4) {
    const a = OCT[face], b = OCT[(face + 1) % 8];
    for (const uu of [u - du, u, u + du]) for (const zz of [z - dz, z, z + dz]) {
      const k = H.k(zz), x = k * (a[0] + (b[0] - a[0]) * uu), y = k * (a[1] + (b[1] - a[1]) * uu);
      if (H.field(zz, Math.atan2(y, x)) < margin) return false;
    }
    return true;
  }

  // ---- the fore half's outside: a spine along its back, the command tower, sponsons along both flanks, the hangar
  // door (port), hardpoints on the lower chamfers, thruster housings and a sensor dome at the bow, a snapped mast
  exterior(H) {
    const R = this.rnd, ox = { kind: K_HULL, paint: PAINT_HULL, sky: 1 }, side = H.breachSide;
    // the spine: a ridge 18 m wide along the top, broken where the back is torn open; vents and a pipe along it
    const run = (face, lift, h, from, to) => {             // a run of blocks: one shadow box
      if (to - from < 12) return;
      const F = this.onHull(H, face, 0.5, (from + to) / 2, lift);
      H.boxes.push({ c: F.o, ax: F.ax, ay: F.ay, az: F.az, h: [h[0] - 1.6, h[1] - 1.6, (to - from) / 2 - 1.6] });   // (in from the chamfers)
    };
    let r0 = null;
    for (let z = 262; z < H.len - 40; z += 12) {
      if (!this.solid(H, 0, 0.5, z + 6, 0.08, 7, 6)) { if (r0 != null) run(0, 4.5, [9, 4.5], r0, z); r0 = null; continue; }
      if (r0 == null) r0 = z;
      const F = this.onHull(H, 0, 0.5, z + 6, 4.5);
      this.box(H, F, 9, 4.5, 6.05, { ...ox, b: 2.2 });
      if ((z / 12) % 2 === 0) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, 4.7), F.ax, F.ay, F.az), 3, 0.5, 2.2, { kind: K_MACH, paint: PAINT_MACH, sky: 1, layer: 'detail' });
    }
    if (r0 != null) run(0, 4.5, [9, 4.5], r0, H.len - 40);
    // the command tower: stepped blocks aft of the gash, the bridge at the front of the top tier with its windows (dark,
    // some blown out), masts (one snapped), a dish
    {
      const z = 748, F0 = this.onHull(H, 0, 0.5, z, 0), at = (dy, dz, dx = 0) => F0.o.clone().addScaledVector(F0.ay, dy).addScaledVector(F0.az, dz).addScaledVector(F0.ax, dx);
      const T = (o) => Wreck.F(o, F0.ax, F0.ay, F0.az);
      this.box(H, T(at(8, 0)), 34, 8, 76, { ...ox, b: 3 });
      this.box(H, T(at(23, 8)), 26, 7, 56, { ...ox, b: 2.5 });
      this.box(H, T(at(35, -38)), 29, 5, 15, { ...ox, b: 2 });
      for (const [c, h] of [[at(8, 0), [34, 8, 76]], [at(23, 8), [26, 7, 56]], [at(35, -38), [29, 5, 15]]]) H.boxes.push({ c, ax: F0.ax, ay: F0.ay, az: F0.az, h: h.map((x) => x - 1.6) });
      // windows: a dark band round the bridge, its frames
      this.box(H, T(at(35.6, -38)), 29.25, 1.6, 15.25, { kind: K_INNER, paint: [0.012, 0.014, 0.016], sky: 1, b: 0.2 });
      for (let k = -6; k <= 6; k++) this.box(H, T(at(35.6, -53.4, k * 4.6)), 0.35, 1.7, 0.4, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
      this.box(H, T(at(41.5, -38)), 22, 1.5, 11, { ...ox, b: 1 });
      // masts
      for (const [dx, dz, hgt, snapped] of [[-14, -40, 34, false], [10, -30, 26, true], [0, 20, 40, false]]) {
        const base = at(43, dz, dx), top = base.clone().addScaledVector(F0.ay, hgt);
        this.cyl(H, base, top, 0.9, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 8 });
        if (snapped) this.cyl(H, top, top.clone().addScaledVector(F0.ay, 4).addScaledVector(F0.ax, 9).addScaledVector(F0.az, 3), 0.8, { kind: K_TORN, paint: PAINT_TORN, sky: 1, segs: 8, soot: 0.5 });
        else for (const yy of [0.6, 0.85]) this.beam(H, base.clone().addScaledVector(F0.ay, hgt * yy).addScaledVector(F0.ax, -5), base.clone().addScaledVector(F0.ay, hgt * yy).addScaledVector(F0.ax, 5), 0.5, 0.5, F0.az, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
      }
      // the dish on its pylon, its face to the sky
      const dp = at(30, 40, 18);
      this.cyl(H, at(15, 40, 18), dp, 1.6, { kind: K_MACH, paint: PAINT_MACH, sky: 1 });
      const dax = new THREE.Vector3().copy(F0.ay).applyAxisAngle(F0.az, 0.6).applyAxisAngle(F0.ax, 0.4).normalize();
      const dbx = new THREE.Vector3().crossVectors(dax, F0.az).normalize(), dbz = new THREE.Vector3().crossVectors(dbx, dax);
      this.lathe(H, Wreck.F(dp.clone(), dbx, dax, dbz), [[0, 0], [5, 0.6], [10, 2.2], [14, 4.6], [14.6, 5.1]], { kind: K_MACH, paint: [0.09, 0.09, 0.088], sky: 1, segs: 28 });
      this.lathe(H, Wreck.F(dp.clone().addScaledVector(dax, 0.15), dbx, dax, dbz), [[14.2, 4.9], [9.8, 2.4], [4.8, 0.8], [0, 0.2]], { kind: K_MACH, paint: [0.05, 0.05, 0.05], sky: 1, segs: 28 });
      this.cyl(H, dp, dp.clone().addScaledVector(dax, 9), 0.5, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 6, layer: 'detail' });
      // a beacon on top, still blinking
      this.lamp(H, at(43.6, -8, 0), F0.ay, 'red', 1.4);
    }
    // sponsons: blisters 10 m out, 30 m tall, along both flanks (the port one stops at the hangar door), in 24 m
    // sections - gone where the hull is torn
    for (const sd of [-1, 1]) {
      const face = sd > 0 ? 6 : 2, from = sd === side ? 470 : 590;
      let s0 = null, zl = from;
      for (let z = from; z < H.len - 50; z += 24) {
        zl = z + 24;
        if (!this.solid(H, face, 0.5, z + 12, 0.3, 13, 6)) { if (s0 != null) run(face, 5, [15, 5], s0, z); s0 = null; continue; }
        if (s0 == null) s0 = z;
        const F = this.onHull(H, face, 0.5, z + 12, 5);
        this.box(H, F, 15, 5, 12.05, { ...ox, b: 3.2 });
        // on its face: a vent and a hatch row; a running light, still blinking, on every fourth
        if ((z / 24) % 2 === 0) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, 5.2), F.ax, F.ay, F.az), 6, 0.4, 3, { kind: K_MACH, paint: PAINT_MACH, sky: 1, layer: 'detail' });
        else if (Math.round((z - from) / 24) % 4 === 1) this.lamp(H, F.o.clone().addScaledVector(F.ay, 5 + 0.32).addScaledVector(F.ax, 9), F.ay, 'red', 0.9);
      }
      if (s0 != null) run(face, 5, [15, 5], s0, zl);
    }
    for (const face of [1, 7]) for (const z of [140, 210]) { const F = this.onHull(H, face, 0.5, z, 0.32); this.lamp(H, F.o, F.ay, 'amber', 0.9); }
    // the hangar door, port side: a heavy frame proud of the hull, eight segments closed in it, rails above and below
    {
      const face = side > 0 ? 2 : 6, z0 = 384, z1 = 566, zc = (z0 + z1) / 2, Fc = this.onHull(H, face, 0.5, zc, 0);
      const at = (dx, dy, dz) => Fc.o.clone().addScaledVector(Fc.ax, dx).addScaledVector(Fc.ay, dy).addScaledVector(Fc.az, dz);
      const T = (o) => Wreck.F(o, Fc.ax, Fc.ay, Fc.az), half = (z1 - z0) / 2, hh = 32;
      for (const sx of [-1, 1]) this.box(H, T(at(sx * (hh + 2.5), 2, 0)), 2.5, 2, half + 5, { ...ox, b: 0.8, kind: K_FRAME, paint: PAINT_JAMB });
      for (const sz of [-1, 1]) this.box(H, T(at(0, 2, sz * (half + 2.5))), hh, 2, 2.5, { ...ox, b: 0.8, kind: K_FRAME, paint: PAINT_JAMB });
      for (let k = 0; k < 8; k++) {
        const dz = -half + (k + 0.5) * (2 * half / 8);
        this.box(H, T(at(0, 0.7, dz)), hh - 0.2, 0.7, half / 8 - 0.25, { ...ox, kind: K_HULL, paint: k === 5 ? [0.06, 0.064, 0.07] : PAINT_DOOR, b: 0.3 });
        for (const yy of [-0.5, 0, 0.5]) this.box(H, T(at(yy * hh, 1.6, dz)), 1.2, 0.3, half / 8 - 1.5, { kind: K_FRAME, paint: PAINT_DOOR, sky: 1, layer: 'detail' });
      }
    }
    // hardpoints along the lower chamfers: brackets with a ring, every 48 m
    for (const face of [3, 5]) for (let z = 300; z < H.len - 60; z += 48) {
      if (!this.solid(H, face, 0.5, z, 0.2, 5, 4)) continue;
      const F = this.onHull(H, face, 0.5, z, 2);
      this.box(H, F, 3, 2, 6, { kind: K_MACH, paint: PAINT_MACH, sky: 1 });
      this.cyl(H, F.o.clone().addScaledVector(F.ay, 1.5).addScaledVector(F.az, -1.2), F.o.clone().addScaledVector(F.ay, 1.5).addScaledVector(F.az, 1.2), 3.2, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 16 });
    }
    // the keel: a long block under the hull (docking bays along it), in 24 m sections, gone where the bottom is torn
    for (let z = 300; z < 900; z += 24) {
      if (!this.solid(H, 4, 0.5, z + 12, 0.25, 13, 8)) continue;
      const F = this.onHull(H, 4, 0.5, z + 12, 8);
      this.box(H, F, 21, 8, 12.05, { ...ox, b: 2.6 });
      if ((z / 24) % 3 === 1) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, 7.6), F.ax, F.ay, F.az), 12, 0.6, 8, { kind: K_INNER, paint: [0.02, 0.021, 0.022], sky: 1, b: 0.3 });
    }
    // stepped blocks aft of the tower
    for (const [dz, hx, hy, hz] of [[880, 22, 6, 32], [890, 15, 11, 16]]) {
      if (!this.solid(H, 0, 0.5, dz, 0.2, hz, 8)) continue;
      const F = this.onHull(H, 0, 0.5, dz, hy);
      this.box(H, F, hx, hy, hz, { ...ox, b: 2 });
      H.boxes.push({ c: F.o, ax: F.ax, ay: F.ay, az: F.az, h: [hx - 1.4, hy - 1.4, hz - 1.4] });
    }
    // the bow: thruster housings on its four chamfers (three nozzles each), the sensor dome on its nose, a ram plate
    for (const face of [1, 3, 5, 7]) {
      const F = this.onHull(H, face, 0.5, 70, 4.5);
      this.box(H, F, 9, 4.5, 11, { ...ox, b: 2 });
      for (const k of [-1, 0, 1]) {
        const c = F.o.clone().addScaledVector(F.ax, k * 5).addScaledVector(F.ay, 4.4);
        this.cyl(H, c, c.clone().addScaledVector(F.ay, 3.2), 1.2, { kind: K_MACH, paint: PAINT_NOZZLE, sky: 1, r1: 2.1, caps: false, segs: 12 });
      }
    }
    {
      const k0 = H.tip, nose = new THREE.Vector3(0, 0, 0);
      this.lathe(H, Wreck.F(nose, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)),
        [[18, -0.5], [18, 1.5], [16.5, 6], [12, 10.5], [6.5, 13.2], [0, 14]], { kind: K_MACH, paint: [0.07, 0.072, 0.075], sky: 1, segs: 32 });
      this.box(H, Wreck.F(new THREE.Vector3(0, -HH * k0 + 11, -4.5)), HW * k0 - 10, 10, 4.6, { ...ox, b: 2.5 });
      // a mast on the bow's back, snapped and bent over
      const F = this.onHull(H, 0, 0.62, 175, 0), top = F.o.clone().addScaledVector(F.ay, 22);
      this.cyl(H, F.o, top, 1.1, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 8 });
      this.cyl(H, top, top.clone().addScaledVector(F.ax, -12).addScaledVector(F.ay, 3).addScaledVector(F.az, 7), 1.0, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 8 });
      this.lamp(H, this.onHull(H, 0, 0.5, 120, 0.4).o, this.onHull(H, 0, 0.5, 120).ay, 'red', 1.2);
      // the sensor boom: a lattice truss 150 m out of the nose, buckled two thirds of the way and bent down
      const w = 4.5, of = { kind: K_FRAME, paint: PAINT_FRAME, sky: 1 }, kink = -105, bend = 0.42;
      const at = (z, cx, cy) => {
        if (z >= kink) return new THREE.Vector3(cx, cy, z);
        const d = kink - z;
        return new THREE.Vector3(cx, cy * Math.cos(bend) - d * Math.sin(bend), kink - d * Math.cos(bend) - cy * Math.sin(bend));
      };
      const C4 = [[-w, -w], [w, -w], [w, w], [-w, w]];
      for (let z = -8; z > -150; z -= 10) {
        const z1 = Math.max(-150, z - 10);
        for (const [cx, cy] of C4) this.beam(H, at(z, cx, cy), at(z1, cx, cy), 0.9, 0.9, new THREE.Vector3(0, 1, 0), of);
        for (let e = 0; e < 4; e++) {
          const [ax, ay] = C4[e], [bx, by] = C4[(e + 1) % 4];
          this.beam(H, at(z1, ax, ay), at(z1, bx, by), 0.5, 0.5, new THREE.Vector3(0, 0, 1), { ...of, layer: 'detail' });
          this.beam(H, at(z, ax, ay), at(z1, bx, by), 0.4, 0.4, new THREE.Vector3(0, 0, 1), { ...of, layer: 'detail' });
        }
      }
      this.cyl(H, new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -12), 9, { kind: K_MACH, paint: PAINT_MACH, sky: 1, segs: 20 });
      const tip = at(-150, 0, 0), tipD = at(-151, 0, 0).sub(tip).normalize();
      const tx = new THREE.Vector3(1, 0, 0), ty = tipD.clone(), tz = new THREE.Vector3().crossVectors(tx, ty);
      this.lathe(H, Wreck.F(tip, tx, ty, tz), [[0, 0], [7, 0.5], [12, 2.5], [12.6, 3.2], [12.6, 4.2], [8, 4.4]], { kind: K_MACH, paint: [0.07, 0.07, 0.072], sky: 1, segs: 24 });
      this.lamp(H, tip.clone().addScaledVector(tipD, 4.6), tipD, 'red', 1.0);
    }
    void R;
  }

  // what already stands on the skin there (face, u across 0..1, z): the spine, the tower, sponsons, the hangar door,
  // hardpoints, the bow's thrusters, the radiators, the belts
  taken(H, face, u0, u1, z0, z1) {
    const ov = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
    const side = this.fore.breachSide, port = side > 0 ? 2 : 6, star = side > 0 ? 6 : 2;
    if (H === this.fore) {
      if (face === 0 && ov(u0, u1, 0.38, 0.62) && z1 > 255) return true;
      if (face === 0 && ov(u0, u1, 0.18, 0.82) && ov(z0, z1, 660, 836)) return true;
      if ((face === star && z1 > 462) || (face === port && z1 > 582)) if (ov(u0, u1, 0.28, 0.72)) return true;
      if (face === port && ov(z0, z1, 370, 580)) return true;
      if ((face === 3 || face === 5) && ov(u0, u1, 0.36, 0.64)) for (let z = 300; z < H.len - 60; z += 48) if (ov(z0, z1, z - 8, z + 8)) return true;
      if ([1, 3, 5, 7].includes(face) && ov(z0, z1, 52, 88) && ov(u0, u1, 0.2, 0.8)) return true;
      if (face === 4 && ov(u0, u1, 0.26, 0.74) && ov(z0, z1, 296, 904)) return true;
      if (face === 0 && ov(u0, u1, 0.2, 0.8) && ov(z0, z1, 836, 952)) return true;
      if ((face === 1 || face === 7) && ov(u0, u1, 0.42, 0.58) && (ov(z0, z1, 134, 146) || ov(z0, z1, 204, 216))) return true;
    } else {
      if ((face === 1 || face === 7) && ov(z0, z1, 14, 154)) return true;
      if ([1, 3, 5, 7].includes(face) && z1 > H.len - 112) return true;
    }
    for (const zb of H.beltZ || []) if (ov(z0, z1, zb - 7, zb + 7)) return true;
    return false;
  }

  // armour belts: raised bands round the hull (8 m wide, 2.4 m proud), torn where it is torn
  belts(H) {
    H.beltZ = H === this.fore ? [272, 520, 640, 880] : [40, 200];
    for (const z of H.beltZ) for (let face = 0; face < 8; face++) {
      const a = OCT[face], b = OCT[(face + 1) % 8], W = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(W / 12));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        if (!this.solid(H, face, u, z, 0.5 / n, 4.5, 7)) continue;
        const F = this.onHull(H, face, u, z, 1.2);
        this.box(H, F, (W * H.k(z)) / n / 2 + 0.05, 1.2, 4, { kind: K_HULL, paint: PAINT_BELT, sky: 1, b: 0.6 });
      }
    }
  }

  // the skin's own relief, in sections along each face (24-72 m), each section one kind of work: a row of armour
  // plates across the face (some layered two deep), raised strips along it, a row of vent housings - or left plain
  greebles(H) {
    const R = this.rnd, ok = (face, u0, u1, z0, z1) => u0 > 0.01 && u1 < 0.99 && !this.taken(H, face, u0, u1, z0, z1) && this.solid(H, face, (u0 + u1) / 2, (z0 + z1) / 2, (u1 - u0) / 2, (z1 - z0) / 2, 11);
    for (let face = 0; face < 8; face++) {
      const a = OCT[face], b = OCT[(face + 1) % 8], W0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let z = 6; z < H.len - 12;) {
        const L = 24 + Math.floor(R() * 4) * 16, z1 = Math.min(H.len - 8, z + L), Wm = W0 * H.k((z + z1) / 2), r = R();
        const tone = PAINT_HULL.map((c) => c * (0.82 + R() * 0.36));
        if (r < 0.36) {                                               // armour plates in a row across
          const n = Math.max(1, Math.round(Wm / (8 + R() * 6))), t = 0.5 + R() * 0.7, gap = 1.2 / Wm;
          for (let k = 0; k < n; k++) {
            const u0 = k / n + gap, u1 = (k + 1) / n - gap;
            if (!ok(face, u0, u1, z + 1, z1 - 1)) continue;
            const F = this.onHull(H, face, (u0 + u1) / 2, (z + z1) / 2, t);
            this.box(H, F, ((u1 - u0) * Wm) / 2, t, (z1 - z - 2) / 2, { kind: K_HULL, paint: tone, sky: 1, b: Math.min(0.45, t * 0.6) });
            if (R() < 0.3) {
              const h2 = 0.35 + R() * 0.4, hu = ((u1 - u0) * Wm) / 2 * (0.5 + R() * 0.3), hz = (z1 - z - 2) / 2 * (0.3 + R() * 0.4);
              this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, t + h2), F.ax, F.ay, F.az), hu, h2, hz, { kind: K_HULL, paint: tone.map((c) => c * 0.88), sky: 1, b: h2 * 0.5 });
            }
          }
        } else if (r < 0.55) {                                        // raised strips along it
          const m = 2 + Math.floor(R() * 2), hw = 1 + R() * 1.5, t = 0.8 + R() * 1.2;
          for (let k = 0; k < m; k++) {
            const uc = (k + 1) / (m + 1), hu = hw / Wm;
            if (!ok(face, uc - hu, uc + hu, z + 1, z1 - 1)) continue;
            this.box(H, this.onHull(H, face, uc, (z + z1) / 2, t), hw, t, (z1 - z - 2) / 2, { kind: K_HULL, paint: tone, sky: 1, b: Math.min(0.5, t * 0.5) });
          }
        } else if (r < 0.68) {                                        // vent housings in a row
          const uc = 0.25 + R() * 0.5, hv = 0.7 + R() * 0.8, hu = (1.5 + R() * 2) / Wm;
          for (let zz = z + 5; zz < z1 - 4; zz += 9) {
            if (!ok(face, uc - hu, uc + hu, zz - 3, zz + 3)) continue;
            this.box(H, this.onHull(H, face, uc, zz, hv), hu * Wm, hv, 3, { kind: K_HULL, paint: tone, sky: 1, b: 0.3 });
          }
        } else if (r < 0.74) {                                        // small domes (sensors, lamp housings)
          for (let k = 0; k < 3; k++) {
            const uc = 0.15 + R() * 0.7, zz = z + 4 + R() * (z1 - z - 8), rr = 0.9 + R() * 1.5;
            if (!ok(face, uc - rr / Wm, uc + rr / Wm, zz - rr, zz + rr)) continue;
            const F = this.onHull(H, face, uc, zz, 0);
            this.lathe(H, F, [[rr, 0], [rr, 0.4], [rr * 0.72, rr * 0.72], [0, rr]], { kind: K_MACH, paint: [0.06, 0.06, 0.062], sky: 1, segs: 12, layer: 'detail' });
          }
        }
        z = z1 + 2;
      }
    }
    // pipe runs along the skin, on brackets; broken off at the holes
    for (let k = 0; k < (H === this.fore ? 16 : 5); k++) {
      const face = Math.floor(R() * 8), uc = 0.1 + R() * 0.8, r = 0.6 + R() * 0.9;
      let z = 20 + R() * (H.len - 200), pts = [];
      const zEnd = z + 60 + R() * 160;
      const flush = () => { if (pts.length > 3) this.tube(H, pts, r, { kind: K_MACH, paint: R() < 0.5 ? PAINT_PIPE : PAINT_PIPE2, sky: 1, clampEvery: 6, segs: 8 }); pts = []; };
      for (; z < Math.min(zEnd, H.len - 10); z += 5) {
        const a = OCT[face], b = OCT[(face + 1) % 8], Wm = Math.hypot(b[0] - a[0], b[1] - a[1]) * H.k(z);
        if (!this.solid(H, face, uc, z, (r + 1) / Wm, 3, 11) || this.taken(H, face, uc - 0.02, uc + 0.02, z - 3, z + 3)) { flush(); continue; }
        const F = this.onHull(H, face, uc, z, r + 2.6);
        pts.push(F.o);
        if (Math.round(z) % 10 === 0) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, -(r + 2.6) / 2), F.ax, F.ay, F.az), 0.45, (r + 2.6) / 2, 0.35, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, layer: 'detail' });
      }
      flush();
    }
  }

  // ---- the aft half: the reactor hall (two reactors on cradles either side of the track, rings round them, coolant
  // runs to the engine block, catwalks over the track), radiators outside, the engine bells round the empty mount
  engineRoom(H) {
    const R = this.rnd, om = { kind: K_MACH, paint: PAINT_REACTOR }, of = { kind: K_FRAME, paint: PAINT_FRAME };
    for (const sd of [-1, 1]) {
      const x = sd * 70, y = -16, r = 22, z0 = 42, z1 = 232;
      this.cyl(H, new THREE.Vector3(x, y, z0), new THREE.Vector3(x, y, z1), r, { ...om, caps: false, segs: 40 });
      for (const [zc, dir] of [[z0, -1], [z1, 1]]) {
        const ay = new THREE.Vector3(0, 0, dir), ax = new THREE.Vector3(1, 0, 0), az = new THREE.Vector3().crossVectors(ax, ay);
        const dome = [[r, 0]];
        for (let k = 1; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; dome.push([r * Math.cos(a), 1.5 + 13 * Math.sin(a)]); }
        dome[0] = [r, 0]; dome.splice(1, 0, [r, 1.5]);
        this.lathe(H, Wreck.F(new THREE.Vector3(x, y, zc), ax, ay, az), dome, { ...om, segs: 40, smooth: true });
        // a flange where the dome bolts on, a manway hatch in it
        this.cyl(H, new THREE.Vector3(x, y, zc - dir * 0.2), new THREE.Vector3(x, y, zc + dir * 1.6), r + 0.9, { kind: K_FRAME, paint: PAINT_CLAMP, segs: 40 });
        this.cyl(H, new THREE.Vector3(x, y, zc + dir * 13.5), new THREE.Vector3(x, y, zc + dir * 15.8), 3.2, { kind: K_MACH, paint: PAINT_MACH, segs: 16 });
      }
      for (let z = z0 + 14; z < z1 - 6; z += 24) {
        this.cyl(H, new THREE.Vector3(x, y, z - 1.2), new THREE.Vector3(x, y, z + 1.2), r + 1.3, { kind: K_FRAME, paint: PAINT_CLAMP, segs: 40 });
        for (const dz of [-1.75, 1.75]) this.cyl(H, new THREE.Vector3(x, y, z + dz - 0.25), new THREE.Vector3(x, y, z + dz + 0.25), r + 0.08, { kind: K_LAMP, paint: REACTOR_GLOW, seed: GLOW_I, segs: 40, caps: false });
        // on top: an instrument housing and a valve block, pipes over the shell between the rings
        const top = new THREE.Vector3(x, y + r + 1.2, z + 12);
        this.box(H, Wreck.F(top), 3.5, 1.4, 5, { kind: K_MACH, paint: PAINT_MACH });
        this.tube(H, [new THREE.Vector3(x - sd * 6, y + r * 0.95 + 0.9, z + 2), new THREE.Vector3(x - sd * 6, y + r * 0.95 + 0.9, z + 22)], 0.7, { kind: K_MACH, paint: PAINT_PIPE, segs: 8, clampEvery: 5, layer: 'detail' });
      }
      // a wrap of conduits round its middle, and its inner side's access ladder rails
      for (const dz of [0, 3.2]) {
        const pts = [];
        for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 1.2 - 0.1; pts.push(new THREE.Vector3(x + Math.cos(a) * (r + 1.1) * -sd, y + Math.sin(a) * (r + 1.1), 128 + dz)); }
        this.tube(H, pts, 0.75, { kind: K_MACH, paint: PAINT_PIPE2, segs: 8 });
      }
      // cradles: saddles from the deck up round its belly
      for (const z of [70, 137, 204]) {
        this.box(H, Wreck.F(new THREE.Vector3(x, -50, z)), 17, 11.6, 3, { kind: K_FRAME, paint: PAINT_FRAME });
        this.lamp(H, new THREE.Vector3(x - sd * 17.6, -48, z), new THREE.Vector3(-sd, 0, 0), z === 137 ? 'amber' : 'red');
      }
      // coolant runs: from its back end over to the engine block, on brackets
      for (const [dx, dy, rr] of [[-sd * 14, 16, 2.6], [sd * 10, 18, 1.8]]) {
        const pts = [new THREE.Vector3(x + dx, y + 8, z1 + 10), new THREE.Vector3(x + dx, y + dy + 8, z1 + 22), new THREE.Vector3(x + dx, y + dy + 8, H.len - 30), new THREE.Vector3(x + dx * 0.6, y + dy + 8, H.len - 25.5)];
        this.tube(H, pts, rr, { kind: K_MACH, paint: PAINT_PIPE2, clampEvery: 9, segs: 10 });
      }
      // radiators outside: three fins standing off each upper chamfer
      const face = sd > 0 ? 7 : 1;
      for (let k = 0; k < 2; k++) {
        const F = this.onHull(H, face, 0.5, 50 + k * 68, 16);
        this.box(H, F, 0.9, 16, 32, { kind: K_HULL, paint: [0.11, 0.105, 0.095], sky: 1, b: 0.4 });
        this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, -15.5), F.ax, F.ay, F.az), 3, 1.2, 30, { kind: K_MACH, paint: PAINT_MACH, sky: 1 });
      }
    }
    // catwalks across the hall over the reactors and the track, frame to frame (at two frames): two chords, a grating,
    // a handrail on posts
    const xs = HW - SKIN - RIB_D - 0.65;
    for (const z of [H.ribFrom + RIB_EVERY * 4, H.ribFrom + RIB_EVERY * 7]) {
      for (const dz of [-2.2, 2.2]) {
        this.beam(H, new THREE.Vector3(-xs, 22, z + dz), new THREE.Vector3(xs, 22, z + dz), 0.9, 1.1, new THREE.Vector3(0, 1, 0), of);
        this.beam(H, new THREE.Vector3(-xs, 26.5, z + dz), new THREE.Vector3(xs, 26.5, z + dz), 0.5, 0.5, new THREE.Vector3(0, 1, 0), { ...of, layer: 'detail' });
      }
      this.box(H, Wreck.F(new THREE.Vector3(0, 22.8, z)), xs, 0.25, 2.1, { kind: K_DECK, paint: PAINT_DECK });
      for (let k = -18; k <= 18; k++) for (const dz of [-2.2, 2.2]) this.box(H, Wreck.F(new THREE.Vector3(k * 6, 24.6, z + dz)), 0.15, 1.9, 0.15, { ...of, layer: 'detail' });
    }
    // engine nacelles on the four chamfers of the stern: blocks 80 m long standing 14 m off, their own nozzles aft
    for (const face of [1, 3, 5, 7]) {
      const F = this.onHull(H, face, 0.5, H.len - 52, 14);
      this.box(H, F, 15, 14, 52, { kind: K_HULL, paint: PAINT_HULL, sky: 1, b: 3.5 });
      H.boxes.push({ c: F.o, ax: F.ax, ay: F.ay, az: F.az, h: [13.6, 12.6, 50.6] });
      for (const k of [-1, 1]) {
        const c = F.o.clone().addScaledVector(F.az, 52).addScaledVector(F.ax, k * 7);
        this.cyl(H, c, c.clone().addScaledVector(F.az, 9), 4.5, { kind: K_MACH, paint: PAINT_NOZZLE, sky: 1, r1: 6.2, caps: false, segs: 18 });
        this.cyl(H, c.clone().addScaledVector(F.az, 0.1), c.clone().addScaledVector(F.az, 8.9), 4.3, { kind: K_MACH, paint: [0.02, 0.018, 0.016], sky: 0.4, r1: 6.0, caps: false, segs: 18, inside: true });
      }
      for (const dz of [-30, 0, 30]) this.box(H, Wreck.F(F.o.clone().addScaledVector(F.ay, 14).addScaledVector(F.az, dz), F.ax, F.ay, F.az), 10, 0.8, 6, { kind: K_MACH, paint: PAINT_MACH, sky: 1, layer: 'detail' });
    }
    // the engine block's inner face: pump housings round the bore, lamps on it
    const h = H.sternHole, zw = H.len - 24;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2, rr = h.r + 18 + (k % 2) * 6;
      const c = new THREE.Vector3(h.x + rr * Math.cos(a), h.y + rr * Math.sin(a), zw - 5);
      if (Math.abs(c.x) > 95 || Math.abs(c.y) > 65 || !this.free(H, c, 9)) continue;
      this.box(H, Wreck.F(c), 6 + (k % 3), 6, 5, { kind: K_MACH, paint: PAINT_MACH });
      this.cyl(H, c.clone().add(new THREE.Vector3(0, 0, -5)), c.clone().add(new THREE.Vector3(0, 0, -9)), 3.4, { kind: K_MACH, paint: PAINT_PIPE, segs: 14 });
    }
    for (const sx of [-1, 1]) this.lamp(H, new THREE.Vector3(h.x + sx * (h.r + 6), h.y + 10, zw - 0.6), new THREE.Vector3(0, 0, -1), 'amber', 1.6);
    // the bells: four round the torn mount on the stern, each on its gimbal ring, flared, banded; one cracked open
    const sternZ = H.len;
    for (const [bx, by, br, cracked] of [[-66, 36, 25, false], [66, 36, 25, true], [-68, -44, 22, false], [68, -44, 22, false]]) {
      const F = Wreck.F(new THREE.Vector3(bx, by, sternZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
      this.lathe(H, F, [[br * 0.62, 0], [br * 0.66, 5]], { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, segs: 32 });
      this.lathe(H, F, [[br * 0.42, 5], [br * 0.38, 9], [br * 0.42, 13], [br * 0.6, 22], [br * 0.8, 34], [br * 0.95, 48], [br, 58], [br * 1.04, 58.5], [br * 1.04, 60]],
        { kind: K_MACH, paint: PAINT_BELL, sky: 1, segs: 36, a0: cracked ? 0.6 : 0, a1: cracked ? TAU - 0.15 : TAU });
      this.lathe(H, F, [[br * 1.0, 59.5], [br * 0.93, 47], [br * 0.77, 33.5], [br * 0.57, 21.5], [br * 0.39, 13]],
        { kind: K_MACH, paint: [0.03, 0.028, 0.026], sky: 0.6, soot: 0.6, segs: 36, a0: cracked ? 0.6 : 0, a1: cracked ? TAU - 0.15 : TAU });
      for (const yb of [28, 44]) this.lathe(H, F, [[br * (yb < 30 ? 0.68 : 0.9) + 0.2, yb - 1], [br * (yb < 30 ? 0.71 : 0.93) + 0.5, yb], [br * (yb < 30 ? 0.68 : 0.9) + 0.2, yb + 1]],
        { kind: K_FRAME, paint: PAINT_CLAMP, sky: 1, segs: 36, a0: cracked ? 0.6 : 0, a1: cracked ? TAU - 0.15 : TAU });
    }
    void R;
  }

  // ---- the gap where it broke: the keel's box truss snapped out of both ends, bent; cables still strung across;
  // others hanging loose out of the fore half's torn end
  gap() {
    const Fh = this.fore, A = this.aft, R = this.rnd;
    const truss = (H, z0, z1, bendDir) => {
      const y = -70, w = 4, pts = (zz, k) => {
        const t = clamp((zz - z0) / (z1 - z0), 0, 1), bend = bendDir * Math.max(0, t - 0.55) ** 2 * 26;
        return new THREE.Vector3(k[0] * w, y + k[1] * w + bend, zz);
      };
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], step = 8;
      for (const c of corners) for (let z = z0; z < z1; z += step) this.beam(H, pts(z, c), pts(Math.min(z1, z + step), c), 1.1, 1.1, new THREE.Vector3(0, 1, 0), { kind: K_FRAME, paint: PAINT_FRAME });
      for (let z = z0; z <= z1; z += step) for (let e = 0; e < 4; e++) {
        const a = corners[e], b = corners[(e + 1) % 4];
        this.beam(H, pts(z, a), pts(z, b), 0.6, 0.6, new THREE.Vector3(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, layer: 'detail' });
        if (z + step <= z1) this.beam(H, pts(z, a), pts(z + step, b), 0.5, 0.5, new THREE.Vector3(0, 0, 1), { kind: K_FRAME, paint: PAINT_FRAME, layer: 'detail' });
      }
    };
    truss(Fh, Fh.len - 70, Fh.len + 34, -1);
    truss(A, -26, 20, 1);
    // cables across: from the fore half's last frames to the aft half's first, slack
    const w = new THREE.Vector3();
    for (let k = 0; k < 5; k++) {
      const a = new THREE.Vector3(-60 + k * 30 + (R() - 0.5) * 8, 58 + R() * 12, Fh.len - 6), b = new THREE.Vector3(-56 + k * 28 + (R() - 0.5) * 8, 56 + R() * 12, 7);
      const aw = Fh.toWorld(a, new THREE.Vector3()), bw = A.toWorld(b, new THREE.Vector3()), pts = [], sag = 10 + R() * 22;
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, q = aw.clone().lerp(bw, t);
        q.addScaledVector(Fh.Y, -sag * 4 * t * (1 - t));
        pts.push(Fh.toLocal(q, w).clone());
      }
      this.tube(Fh, pts, 0.7 + R() * 0.6, { kind: K_MACH, paint: PAINT_CABLE, segs: 8, sway: 1.2 });
    }
    // loose ones out of the torn end, drifting
    for (let k = 0; k < 9; k++) {
      const x = (R() - 0.5) * 170, y = -40 + R() * 100, L = 18 + R() * 40, pts = [];
      const th = Math.atan2(y, x), r = Math.max(Math.abs(x) / HW, Math.abs(y) / HH);
      if (r > 0.92) continue;
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(x + Math.sin(t * 2.2 + k) * 4 * t, y - 9 * t * t, Fh.len - 10 + L * t)); }
      if (pts.every((q) => this.free(Fh, q, 4))) this.tube(Fh, pts.map((q, i) => q), 0.35 + R() * 0.4, { kind: K_MACH, paint: PAINT_CABLE, segs: 6, layer: 'detail', sway: 1.4 });
      void th;
    }
  }

  // ---- debris: fragments of the hull and its frames, cargo pods - blown out of the breach, drifting in the gap and
  // round the torn ends, a thin cloud round the whole wreck; each one turning slowly and drifting a few metres to
  // and fro about where it is (update: drawn where they are, so the AO sees them where they are drawn)
  debris() {
    const R = this.rnd, I = { toWorld: (p, o = new THREE.Vector3()) => o.copy(p), dirWorld: (d, o = new THREE.Vector3()) => o.copy(d), k: () => 1 };
    const shape = (build) => { this.target = new Geo(); build(); const g = this.target.build(); this.target = null; return g; };
    const ho = { kind: K_HULL, paint: PAINT_HULL, sky: 1, soot: 0.3 }, to = { kind: K_TORN, paint: PAINT_TORN, sky: 1, soot: 0.6 };
    const shapes = [
      shape(() => {                                    // a hull plate, bent along a fold, its torn edge bare
        this.box(I, Wreck.F(new THREE.Vector3(-2.5, 0, 0)), 2.5, 0.35, 4, ho);
        const ax = new THREE.Vector3(Math.cos(0.5), Math.sin(0.5), 0), ay = new THREE.Vector3(-Math.sin(0.5), Math.cos(0.5), 0);
        this.box(I, Wreck.F(new THREE.Vector3(2.2, 1.2, 0.3), ax, ay, new THREE.Vector3(0, 0, 1)), 2.6, 0.35, 3.6, ho);
        this.box(I, Wreck.F(new THREE.Vector3(4.6, 2.5, 0.3), ax, ay, new THREE.Vector3(0, 0, 1)), 0.25, 0.4, 3.4, to);
      }),
      shape(() => {                                    // a frame's stub: web and flange, one end torn
        this.box(I, Wreck.F(new THREE.Vector3(0, 0, 0)), 0.45, 1.6, 6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, soot: 0.4 });
        this.box(I, Wreck.F(new THREE.Vector3(0, 1.8, 0)), 1.0, 0.3, 6, { kind: K_FRAME, paint: PAINT_FRAME, sky: 1, soot: 0.4 });
        this.box(I, Wreck.F(new THREE.Vector3(0, 0.8, 6.2)), 0.9, 1.4, 0.25, to);
      }),
      shape(() => {                                    // a crumpled chunk: plates and a block wrenched together
        for (let k = 0; k < 4; k++) {
          const a = k * 1.7, ax = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), ay = new THREE.Vector3(0, 1, 0).applyAxisAngle(ax, 0.4 * (k - 1.5)), az = new THREE.Vector3().crossVectors(ax, ay);
          this.box(I, Wreck.F(new THREE.Vector3((k - 1.5) * 0.9, (k % 2) * 0.8, 0), ax, ay.normalize(), az.normalize()), 1.8 - k * 0.2, 0.3 + k * 0.15, 1.4, k === 3 ? to : ho);
        }
      }),
      shape(() => this.pod(I, Wreck.F(new THREE.Vector3()), [0.09, 0.05, 0.035])),
    ];
    const lists = shapes.map(() => []), tr = this.track, f = {};
    const clear = (p, r) => {                          // clear of the track (the space round it), outside the hull
      const i = tr.nearestIndex(p); tr.frame(i * tr.step, f);
      const d = p.clone().sub(f.P), x = d.dot(f.R), y = d.dot(f.U);
      if (Math.abs(x) < 34 + r && y > -14 - r && y < 26 + r && p.distanceTo(f.P) < 200) return false;
      for (const H of this.halves) { const q = H.toLocal(p, new THREE.Vector3()), k = H.k(q.z); if (q.z > -r && q.z < H.len + r && Math.abs(q.x) < k * HW + r && Math.abs(q.y) < k * HH + r) return false; }
      return true;
    };
    const add = (p, kind, size, drift) => {
      if (!clear(p, size * 6)) return false;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3));
      const axis = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      lists[kind].push({ p, q, s: size, axis, w: (0.02 + R() * 0.1) * (R() < 0.5 ? -1 : 1), bob: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(drift), ph: R() * 6.3, per: 18 + R() * 30 });
      return true;
    };
    const Fh = this.fore, A = this.aft;
    // out of the breach: along its outward normal, spreading
    const bz = Fh.holes[0].z, bt = Fh.holes[0].t, bc = Fh.toWorld(new THREE.Vector3(Math.cos(bt) * HW, Math.sin(bt) * HH, bz));
    const bn = Fh.dirWorld(new THREE.Vector3(Math.cos(bt), Math.sin(bt), 0), new THREE.Vector3()).normalize();
    for (let k = 0, n = 0; k < 600 && n < 70; k++) {
      const d = 30 + R() * 260, p = bc.clone().addScaledVector(bn, d).add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(40 + d * 0.9));
      if (add(p, R() < 0.12 ? 3 : Math.floor(R() * 3), 0.5 + R() * 1.2, 2 + R() * 3)) n++;
    }
    // in the gap and round the torn ends
    const g0 = Fh.toWorld(new THREE.Vector3(0, 0, Fh.len)), g1 = A.toWorld(new THREE.Vector3(0, 0, 0));
    for (let k = 0, n = 0; k < 900 && n < 60; k++) {
      const p = g0.clone().lerp(g1, -0.4 + R() * 1.8).add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(320));
      if (add(p, R() < 0.06 ? 3 : Math.floor(R() * 3), 0.4 + R() * 1.0, 1.5 + R() * 2.5)) n++;
    }
    // a thin cloud round all of it
    for (let k = 0, n = 0; k < 1200 && n < 90; k++) {
      const H = R() < 0.75 ? Fh : A, q = new THREE.Vector3((R() - 0.5) * 700, (R() - 0.5) * 500, -150 + R() * (H.len + 300));
      if (add(H.toWorld(q, new THREE.Vector3()), Math.floor(R() * 3), 0.6 + R() * 1.6, 3 + R() * 4)) n++;
    }
    this.debrisMeshes = shapes.map((g, k) => {
      const m = new THREE.InstancedMesh(g, this.mat, Math.max(1, lists[k].length));
      m.count = lists[k].length;
      m.userData.list = lists[k];
      m.castShadow = false; m.receiveShadow = true;
      m.frustumCulled = false;
      m.name = 'wreck-debris';
      return m;
    });
    this.placeDebris(0);
  }

  placeDebris(t) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    for (const m of this.debrisMeshes) {
      m.userData.list.forEach((d, i) => {
        Q.setFromAxisAngle(d.axis, d.w * t).multiply(d.q);
        P.copy(d.p).addScaledVector(d.bob, Math.sin((t * TAU) / d.per + d.ph));
        m.setMatrixAt(i, M.compose(P, Q, S.setScalar(d.s)));
      });
      m.instanceMatrix.needsUpdate = true;
    }
  }

  // where sparks fly: the ends of pipes and conduits torn through (the spine's runs near the break, the breach's
  // edge, the aft half's coolant runs) - position, the way they spray
  sparkSites() {
    const R = this.rnd, out = [], Fh = this.fore, A = this.aft;
    const site = (H, p, d) => { if (this.free(H, p, 6)) out.push({ p: H.toWorld(p, new THREE.Vector3()), d: H.dirWorld(d.normalize(), new THREE.Vector3()) }); };
    for (const sd of [-1, 1]) site(Fh, new THREE.Vector3(this.trackAt(Fh, Fh.len - 110).p.x + sd * 52, 8, Fh.len - 104), new THREE.Vector3(-sd * 0.4, -0.3, 1));
    site(Fh, new THREE.Vector3(this.trackAt(Fh, Fh.len - 200).p.x - 50, -40, Fh.len - 200), new THREE.Vector3(1, 0.2, 0.3));
    site(Fh, new THREE.Vector3(60, 40, 520), new THREE.Vector3(-0.6, -1, 0.2));
    site(A, new THREE.Vector3(-44, 12, 260), new THREE.Vector3(1, -0.3, -0.2));
    site(A, new THREE.Vector3(48, -30, 120), new THREE.Vector3(-1, 0.4, 0));
    void R;
    return out;
  }

  // ---------------------------------------------------------------- the parts kit (all in a half's own frame)
  // a part's frame: origin o, axes ax ay az (local unit vectors)
  static F(o, ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3(0, 0, 1)) { return { o, ax, ay, az }; }

  // emit a vertex of a part: p, n, t in the part's coordinates
  pv(g, H, F, p, n, u, v, t, o) {
    const ph = _v.copy(F.o).addScaledVector(F.ax, p.x).addScaledVector(F.ay, p.y).addScaledVector(F.az, p.z);
    const pw = H.toWorld(ph, new THREE.Vector3());
    const nh = _n.set(0, 0, 0).addScaledVector(F.ax, n.x).addScaledVector(F.ay, n.y).addScaledVector(F.az, n.z);
    const nw = H.dirWorld(nh, new THREE.Vector3()).normalize();
    const th = _t.set(0, 0, 0).addScaledVector(F.ax, t.x).addScaledVector(F.ay, t.y).addScaledVector(F.az, t.z);
    const tw = H.dirWorld(th, new THREE.Vector3());
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
          this.cyl(H, c.clone().addScaledVector(d, -0.4 * r - 0.1), c.clone().addScaledVector(d, 0.4 * r + 0.1), r * 1.3 + 0.05, { ...o, kind: K_FRAME, paint: PAINT_CLAMP, segs: 10, seed: 0 });
          acc += o.clampEvery;
        }
        acc -= L;
      }
    }
  }

  // ---- ring frames every 24 m: an I-section (a web from the inner skin, an inner flange), mitred at the octagon's
  // corners (each segment between the inset polygons' corners)
  frames(H) {
    const a = RIB_W * 0.5, b = RIB_W, D = RIB_D;
    const prof = [[0, a], [D, a], [D, b], [D + 0.6, b], [D + 0.6, -b], [D, -b], [D, -a], [0, -a]];   // (depth, along z)
    for (let z = H.ribFrom; z <= H.ribTo + 1e-6; z += RIB_EVERY) {
      // near a torn end: pieces wrenched out of the last frames, more the nearer the end
      const torn = H.edge1 ? smoothstep(H.len - 80, H.len - 4, z) : H.edge0 ? smoothstep(80, 4, z) : 0;
      this.ring(H, z, prof, K_FRAME, PAINT_FRAME, 'main', torn > 0 ? (th) => noise2(th * 2.3 + z * 0.17, z * 0.05) < torn * 0.75 : null);
    }
  }

  // a profile (depth in from the inner skin, offset along z) swept round the inset octagon at z; where the frame is
  // torn (H.ribCut: the breach) it is cut in pieces of ~4 m, the stumps bent outward and their ends capped
  ring(H, z, prof, kind, paint, layer = 'main', tear = null) {
    const g = this.geo(H, z, layer), k = H.k(z), F0 = Wreck.F(new THREE.Vector3());
    const cutAt = (x, y) => (H.ribCut && this.inRibCut(H, z, Math.atan2(y, x))) || (tear && tear(Math.atan2(y, x)));
    const qs = prof.map(([d]) => inset(k, SKIN + d)), outerQ = inset(k, 0);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8, segL = Math.hypot(outerQ[j][0] - outerQ[i][0], outerQ[j][1] - outerQ[i][1]);
      // pieces along the segment, and which are gone
      const m = (H.ribCut && Math.abs(z - H.ribCut.z) < H.ribCut.rz) || tear ? Math.max(1, Math.ceil(segL / 4)) : 1, gone = [];
      for (let q = 0; q < m; q++) { const t = (q + 0.5) / m; gone.push(cutAt(outerQ[i][0] + (outerQ[j][0] - outerQ[i][0]) * t, outerQ[i][1] + (outerQ[j][1] - outerQ[i][1]) * t)); }
      const nOut = new THREE.Vector3(OCTN[i][0], OCTN[i][1], 0);
      for (let q = 0; q < m; q++) {
        if (gone[q]) continue;
        const t0 = q / m, t1 = (q + 1) / m;
        const bend0 = q > 0 && gone[q - 1], bend1 = q < m - 1 && gone[q + 1];
        // the point of profile vertex e at t along the segment (a stump's free end bent out by ~3-5 m)
        const at = (e, t) => {
          const Q = qs[e], P = new THREE.Vector3(Q[i][0] + (Q[j][0] - Q[i][0]) * t, Q[i][1] + (Q[j][1] - Q[i][1]) * t, z + prof[e][1]);
          const bend = (t === t0 && bend0) || (t === t1 && bend1) ? 3 + 2 * noise2(z * 0.3 + i, t * 9) : 0;
          return P.addScaledVector(nOut, bend);
        };
        for (let e = 0; e < prof.length - 1 + (prof.closed ? 1 : 0); e++) {
          const e2 = (e + 1) % prof.length, [d0, w0] = prof[e], [d1, w1] = prof[e2];
          const W = Math.hypot(d1 - d0, w1 - w0), nd = -(w1 - w0) / W, nw = (d1 - d0) / W;
          const nl = new THREE.Vector3(-OCTN[i][0] * nd, -OCTN[i][1] * nd, nw);
          const P = [at(e, t0), at(e, t1), at(e2, t1), at(e2, t0)];
          const len = P[0].distanceTo(P[1]), tl = P[3].clone().sub(P[0]).normalize();
          const uvs = [[0, segL * t0], [0, segL * t1], [W, segL * t1], [W, segL * t0]];
          const vs = P.map((pp, mm) => this.pv(g, H, F0, pp, nl, uvs[mm][0], uvs[mm][1], tl, { kind, paint, seed: W, sky: 0 }));
          void len;
          this.quadFacing(g, vs, H.dirWorld(nl, new THREE.Vector3()));
        }
        // a torn stump's end: the profile, capped
        for (const [bend, t, sgn] of [[bend0, t0, -1], [bend1, t1, 1]]) {
          if (!bend) continue;
          const dir = new THREE.Vector3(outerQ[j][0] - outerQ[i][0], outerQ[j][1] - outerQ[i][1], 0).normalize().multiplyScalar(sgn);
          const pts = prof.map((_, e) => at(e, t)), c = pts.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(pts.length);
          const cv = this.pv(g, H, F0, c, dir, 0, 0, new THREE.Vector3(0, 0, 1), { kind: K_TORN, paint: PAINT_TORN, soot: 0.7 });
          const vs = pts.map((pp) => this.pv(g, H, F0, pp, dir, pp.z - z, 0, new THREE.Vector3(0, 0, 1), { kind: K_TORN, paint: PAINT_TORN, soot: 0.7 }));
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

  inRibCut(H, z, th) {
    const [u, v] = holeUV(H.ribCut, z, th);
    return u * u + v * v < 1;
  }

  // a part of radius r at local p clear of the space round the track (its deck, walls, the ships and the camera)
  free(H, p, r = 0) {
    for (const row of H.tt) {
      if (Math.abs(row.p.z - p.z) > 60 + r) continue;
      const d = _w.subVectors(p, row.p), x = d.dot(row.R), y = d.dot(row.U);
      const T = _t.crossVectors(row.R, row.U), t = d.dot(T);
      if (Math.abs(t) < 2 + r && Math.abs(x) < 30 + r && y > -10 - r && y < 20 + r) return false;
    }
    return true;
  }

  // ---- the sky's light on the inside: an ambient cube per 14 m cell (rays through the same holes), each vertex of the
  // inner parts lit by it along its normal; the outside sees the sky
  skyLight() {
    const dirs = [];
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = new THREE.Vector3(x, y, z), t1 = new THREE.Vector3(y, z, x), t2 = new THREE.Vector3().crossVectors(a, t1);
      dirs.push([a, ...[[0.7, 0.4], [-0.7, 0.4], [0, -0.8]].map(([p, q]) => a.clone().addScaledVector(t1, p).addScaledVector(t2, q).normalize())]);
    }
    const cell = 14;
    this.halves.forEach((H) => {
      const nx = Math.ceil((2 * HW) / cell) + 1, ny = Math.ceil((2 * HH) / cell) + 1, nz = Math.ceil(H.len / cell) + 1;
      const cube = new Float32Array(nx * ny * nz * 6);
      const p = new THREE.Vector3(), d = new THREE.Vector3();
      for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
        // (a cell's point outside the frames moved in toward the axis: the wall's own vertices read inside light)
        p.set(-HW + ix * cell, -HH + iy * cell, clamp(iz * cell, 1, H.len - 1));
        const k = H.k(p.z);
        let sc = 1;
        OCT.forEach((v, i) => { const np = OCTN[i][0] * p.x + OCTN[i][1] * p.y, dd = k * (OCTN[i][0] * v[0] + OCTN[i][1] * v[1]) - SKIN - 3; if (np > dd) sc = Math.min(sc, dd / np); });
        p.x *= sc; p.y *= sc;
        const o = ((iz * ny + iy) * nx + ix) * 6;
        dirs.forEach((ds, a) => {
          let s = 0;
          for (const dl of ds) {
            // the other half too (light from the gap's side)
            let kk = H.ray(p, dl);
            if (kk > 0) { const O = H.toWorld(p, _w); for (const G of this.halves) if (G !== H && kk > 0) kk *= G.ray(G.toLocal(O, _t), G.dirLocal(H.dirWorld(dl, d), _n)); }
            s += kk;
          }
          cube[o + a] = s / ds.length;
        });
      }
      H.sky = { cube, nx, ny, nz, cell };
    });
    // apply: every vertex with sky light 0 (the inside's) gets the cube's light along its normal
    for (const [key, g] of this.chunks) {
      const H = key.startsWith('fore') ? this.fore : this.aft;
      for (let i = 0; i < g.n; i++) {
        if (g.A[i * 4 + 1] > 0.99) continue;
        const pl = H.toLocal(_v.fromArray(g.P, i * 3), _w), nl = H.dirLocal(_n.fromArray(g.N, i * 3), _t);
        g.A[i * 4 + 1] = Math.max(g.A[i * 4 + 1], this.skyCube(H, pl, nl));
      }
    }
  }

  skyCube(H, p, n) {
    const { cube, nx, ny, nz, cell } = H.sky;
    const fx = clamp((p.x + HW) / cell, 0, nx - 1.001), fy = clamp((p.y + HH) / cell, 0, ny - 1.001), fz = clamp(p.z / cell, 0, nz - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const w = [n.x > 0 ? n.x * n.x : 0, n.x < 0 ? n.x * n.x : 0, n.y > 0 ? n.y * n.y : 0, n.y < 0 ? n.y * n.y : 0, n.z > 0 ? n.z * n.z : 0, n.z < 0 ? n.z * n.z : 0];
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      const o = (((iz + dz) * ny + (iy + dy)) * nx + (ix + dx)) * 6;
      for (let a = 0; a < 6; a++) s += wt * w[a] * cube[o + a];
    }
    return 0.045 + 0.955 * s;
  }

  // each frame: the lamps' flicker (a third of them failing: dropping out, stuttering), the eight nearest the camera
  // lighting the wreck (its material), the small parts only within 450 m
  update(t, camera) {
    const U = this.mat.userData.U, cam = camera.position;
    U.wTime.value = t;
    for (const L of this.lamps) {
      let f = 0.86 + 0.14 * Math.sin(t * 1.7 + L.ph);
      if (L.fail && this.effects) {
        const k = Math.floor(t * 9 + L.ph * 13), h = ihash(k * 31 + L.i * 977);
        const long = ihash(Math.floor(t * 0.4 + L.ph) * 7 + L.i * 131) < 0.3;      // out for a while now and then
        f *= long ? 0.03 : h < 0.22 ? 0.06 : h < 0.35 ? 0.45 : 1;
      }
      L.f = f;
      U.wFlick.value[L.i] = f;
    }
    U.wFlick.value[GLOW_I] = 0.55 + 0.25 * Math.sin(t * 0.7) * (this.effects ? 1 : 0);
    const cands = this.lamps.map((L) => [L, L.p.distanceToSquared(cam)]);
    if (this.effects && this.sparks) for (const e of this.sparks.sites) if (e.flash > 0.02) cands.push([{ p: e.p, col: [1.0, 0.62, 0.3], f: e.flash, big: false }, e.p.distanceToSquared(cam) * 0.6]);
    const near = cands.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < 8; k++) {
      const e = near[k];
      if (!e || e[1] > 400 * 400) { U.wLampP.value[k].set(0, -1e6, 0, 1); U.wLampC.value[k].set(0, 0, 0); continue; }
      const L = e[0], I = L.big ? 2600 : L.small ? 380 : 900;
      U.wLampP.value[k].set(L.p.x, L.p.y, L.p.z, L.big ? 110 : L.small ? 50 : 75);
      U.wLampC.value[k].set(L.col[0] * I * L.f, L.col[1] * I * L.f, L.col[2] * I * L.f);
    }
    for (const m of this.meshes) if (m.userData.detail) {
      const sp = m.geometry.boundingSphere;
      m.visible = sp.center.distanceTo(cam) - sp.radius < 450;
    }
    // the debris drifting (only near: from far nothing moves enough to see), the sparks
    const near2 = this.fore.toLocal(cam, _v);
    const nearWreck = Math.abs(near2.x) < 1600 && Math.abs(near2.y) < 1200 && near2.z > -1500 && near2.z < this.fore.len + 1800;
    if (this.effects && nearWreck) this.placeDebris(t);
    this.sparks.mesh.visible = this.effects && nearWreck;
    if (this.sparks.mesh.visible) this.sparks.update(t, cam);
  }

  // the setting (sparks, flicker, drifting debris)
  setEffects(on) {
    this.effects = on;
    this.mat.userData.U.wSway.value = on ? 1 : 0;
    if (!on) this.placeDebris(0);
  }

  // the lamps nearest p (for the scene's real lights: the deck and the ships lit red and amber inside)
  nearLamps(p, n = 3) {
    return this.lamps.map((L) => [L, L.p.distanceToSquared(p)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(([L, d]) => ({ L, d: Math.sqrt(d) }));
  }

  // the shader patch: the sun's light in every lit material passes this test (both halves); call before anything
  // lit compiles. The planet's light inside is cut with the sky's (the shade lines round the deck).
  patchShaders() {
    const C = THREE.ShaderChunk;
    if (C.lights_pars_begin.includes('wreckSun')) return;
    for (const H of this.halves) {
      H.sunW = this.sunDir;
      // everything of the half that throws a shadow (with its blocks outside the hull) inside one sphere
      const pts = [];
      for (const [x, y] of OCT) for (const z of [0, H.len]) pts.push(H.toWorld(new THREE.Vector3(x * H.k(z), y * H.k(z), z)));
      for (const b of H.boxes) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(H.toWorld(b.c.clone().addScaledVector(b.ax, sx * b.h[0]).addScaledVector(b.ay, sy * b.h[1]).addScaledVector(b.az, sz * b.h[2])));
      const c = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(pts.length);
      H.bound = { c, r: Math.max(...pts.map((v) => v.distanceTo(c))) + 2 };
    }
    const src = this.halves.map((H, i) => H.glsl(`wreckH${i}`, this.sunL[i])).join('\n');
    C.lights_pars_begin += `
float wkWrap( float a ) { return a - 6.2831853 * floor( ( a + 3.1415927 ) / 6.2831853 ); }
${src}
float wreckSun( vec3 w ) { float k = wreckH0( w ); if ( k > 0.0 ) k *= wreckH1( w ); return k; }
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

const PAINT_HULL = [0.052, 0.056, 0.06], PAINT_INNER = [0.045, 0.047, 0.044], PAINT_FRAME = [0.048, 0.046, 0.042], PAINT_TORN = [0.2, 0.195, 0.19];
const PAINT_MACH = [0.05, 0.052, 0.055], PAINT_CLAMP = [0.09, 0.075, 0.04], PAINT_DECK = [0.06, 0.06, 0.058];
const PAINT_PYLON = [0.055, 0.058, 0.062], PAINT_RAIL = [0.1, 0.085, 0.035], PAINT_CRANE = [0.12, 0.09, 0.025], PAINT_CABLE = [0.02, 0.02, 0.022];
const PAINT_BULK = [0.065, 0.066, 0.062], PAINT_JAMB = [0.07, 0.06, 0.04], PAINT_DOOR = [0.075, 0.072, 0.066], PAINT_PIPE = [0.06, 0.055, 0.05], PAINT_PIPE2 = [0.075, 0.05, 0.035];
const PAINT_BELT = [0.06, 0.062, 0.064], PAINT_REACTOR = [0.034, 0.036, 0.04], PAINT_NOZZLE = [0.045, 0.04, 0.036], PAINT_BELL = [0.09, 0.082, 0.075];
const REACTOR_GLOW = [0.5, 0.11, 0.025], GLOW_I = 95;          // (lamp index 95: the reactors' slow glow)
// the emergency lamps' light (linear, x the lens's brightness)
const LAMP = { red: [1.0, 0.07, 0.03], amber: [1.0, 0.42, 0.07] };

// Sparks from torn conduits: bursts every so often at each site (a spray of hot streaks for ~0.4 s, flying straight
// and fading - no air, no gravity), each burst a flash of light on what is near it (update: the lamps' list). All
// in the vertex shader: one draw, nothing per frame but the bursts' start times.
const SPARKS_PER = 48;
class Sparks {
  constructor(sites) {
    this.sites = sites.slice(0, 8).map((s) => ({ ...s, next: Math.random() * 3, start: -100, flash: 0 }));
    const n = this.sites.length * SPARKS_PER, pos = new Float32Array(n * 4 * 3), a = new Float32Array(n * 4 * 4), idx = [];
    const R = mulberry32(31);
    for (let i = 0; i < n; i++) {
      const e = Math.floor(i / SPARKS_PER), dl = R() * 0.45, sp = 18 + R() * 55, life = 0.25 + R() * 0.5, sd = R() * 1000;
      for (let c = 0; c < 4; c++) {
        pos.set([c & 1, c >> 1, 0], (i * 4 + c) * 3);
        a.set([e, dl, sp, life + sd * 0], (i * 4 + c) * 4);
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
    const S = this.sites.length;
    this.U = { time: { value: 0 }, sP: { value: this.sites.map((s) => s.p.clone()) }, sD: { value: this.sites.map((s) => s.d.clone()) }, sT: { value: new Float32Array(Math.max(1, S)).fill(-100) } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: this.U,   // (a streak's winding turns with it)
      vertexShader: /* glsl */`
        uniform float time; uniform vec3 sP[${Math.max(1, S)}]; uniform vec3 sD[${Math.max(1, S)}]; uniform float sT[${Math.max(1, S)}];
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

  update(t) {
    this.U.time.value = t;
    this.sites.forEach((s, i) => {
      if (t >= s.next) { s.start = t; this.U.sT.value[i] = t; s.next = t + 0.4 + Math.random() * (Math.random() < 0.3 ? 4 : 1.6); }
      const a = t - s.start;
      s.flash = a < 0 ? 0 : Math.exp(-a * 9) * (a < 0.45 ? 1 : 0.3);
    });
  }
}
