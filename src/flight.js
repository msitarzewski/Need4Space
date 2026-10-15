// Arcade flight model for a hover racer: anti-grav lift while powered, a ground-effect cushion, thrust against
// quadratic drag, velocity that follows the nose (grip), coordinated banked turns, collision probes on the hull.
import * as THREE from 'three';
import { clamp, damp, smoothstep } from './noise.js';

const G = 9.81;
const THRUST = 42;        // m/s2 at full throttle      -> ~140 m/s (510 km/h) top speed
const BOOST = 45;         // extra m/s2 on boost         -> ~200 m/s (730 km/h)
const DRAG_Q = 0.0021;
const DRAG_L = 0.035;
const AIRBRAKE = 0.7;
const LIFT = 15;          // vertical thrusters, m/s2
const HOVER = 1.3;        // hover clearance under the lowest point (m)
const RATES = { pitch: 1.45, roll: 2.7, yaw: 0.85 };
const CRASH_V = 15;       // m/s into the ground / a tree that wrecks the ship

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class Flight {
  constructor(ship, terrain, forest) {
    this.ship = ship;
    this.terrain = terrain;
    this.forest = forest;
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.rate = new THREE.Vector3();   // body rates: x pitch (+ nose up), y yaw (+ nose left), z roll (+ right wing up)
    this.throttle = 0;
    this.boostEnergy = 1;
    this.boosting = 0;
    this.assist = true;
    this.crashed = 0;                  // seconds left in the crash state
    this.events = [];                  // 'crash', 'scrape', 'tree' for the effects / audio / HUD
    this.agl = 0;
    this.turn = 0;
    this.scrape = 0;
    this.gravity = G;                  // 0 in space
  }

  place(x, z, heading, hover) {
    const s = this.terrain.surface(x, z);
    this.pos.set(x, s + this.ship.bottom + (hover ? HOVER : 0.002), z);
    this.q.setFromAxisAngle(Y, heading);
    this.vel.set(0, 0, 0);
    this.rate.set(0, 0, 0);
    this.throttle = 0;
    this.crashed = 0;
  }

  get speed() { return this.vel.length(); }
  get forward() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.q); }
  get up() { return Y.clone().applyQuaternion(this.q); }
  get right() { return X.clone().applyQuaternion(this.q); }
  get bank() { const r = this.right, u = this.up; return Math.atan2(-r.y, u.y); }
  get pitch() { return Math.asin(clamp(this.forward.y, -1, 1)); }

  step(dt, inp) {
    const ship = this.ship, power = ship.power, live = this.crashed <= 0;
    if (!live) this.crashed -= dt;
    // ---- throttle lever and boost
    if (live && ship.ready) {
      this.throttle = clamp(this.throttle + (inp.throttleUp - inp.throttleDown) * 0.65 * dt, 0, 1);
      if (inp.throttleAxis !== null) this.throttle = inp.throttleAxis;
    } else if (!ship.engineOn) this.throttle = Math.max(0, this.throttle - dt);
    const wantBoost = live && inp.boost && this.boostEnergy > 0.02 && ship.ready;
    this.boosting += ((wantBoost ? 1 : 0) - this.boosting) * damp(6, dt);
    this.boostEnergy = clamp(this.boostEnergy + (wantBoost ? -0.22 : 0.09) * dt, 0, 1);
    const airbrake = inp.throttleDown && this.throttle <= 0.001 ? 1 : 0;
    this.brakeS = (this.brakeS || 0) + ((live && ship.ready && inp.throttleDown > 0.5 ? 1 : 0) - (this.brakeS || 0)) * damp(9, dt);

    // ---- rotation: rates chase the stick; the assist levels the wings, and the nose near the ground
    const fwd = this.forward, up = this.up, right = this.right;
    const ctl = live ? power : 0;
    const roll = clamp(inp.roll + (inp.rollKeys || 0), -1, 1);
    const tgt = new THREE.Vector3(inp.pitch * RATES.pitch, -inp.yaw * RATES.yaw, -roll * RATES.roll).multiplyScalar(ctl);
    const bank = this.bank, pitch = this.pitch;
    const groundS = this.terrain.surface(this.pos.x, this.pos.z);
    this.agl = this.pos.y - this.ship.bottom - groundS;
    if (this.assist && live) {
      if (Math.abs(roll) < 0.1) tgt.z += 3.0 * (bank - inp.yaw * 0.45) * ctl;
      if (Math.abs(inp.pitch) < 0.1 && this.agl < 14) tgt.x += -2.2 * pitch * ctl * smoothstep(14, 4, this.agl);
    }
    this.rate.lerp(tgt, damp(7, dt));
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rate.x * dt, this.rate.y * dt, this.rate.z * dt, 'YXZ'));
    this.q.multiply(dq);
    // banked flight turns the heading (a coordinated turn), stronger with speed
    const spd = this.vel.length();
    const yawW = -Math.sin(bank) * 0.95 * smoothstep(6, 60, spd) * Math.max(0, up.y) * ctl;
    this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, yawW * dt)).normalize();
    this.turn = clamp(Math.abs(this.rate.x) / RATES.pitch + Math.abs(yawW) / 0.95, 0, 1.5);

    // ---- forces
    const acc = new THREE.Vector3(0, -this.gravity, 0);
    acc.y += this.gravity * power;                                       // anti-grav carries the weight while powered
    const thrust = (this.throttle * THRUST + this.boosting * BOOST) * power * (live ? 1 : 0);
    acc.addScaledVector(fwd, thrust);
    acc.addScaledVector(up, (inp.climb - inp.descend) * LIFT * power * (live ? 1 : 0));
    acc.addScaledVector(this.vel, -(DRAG_L + DRAG_Q * spd + airbrake * AIRBRAKE * power));
    // ground-effect cushion: holds the hover clearance, lifts the ship as the reactor spools up
    const reach = HOVER + 3.5;
    if (this.agl < reach && power > 0) {
      const f = 1 - smoothstep(HOVER + 0.5, reach, this.agl);
      acc.y += (26 * (HOVER * power - this.agl) - 7.5 * this.vel.y) * f * power;
    }
    if (this.pos.y > 2600) acc.y -= (this.pos.y - 2600) * 0.08;  // service ceiling
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 3700) acc.addScaledVector(new THREE.Vector3(-this.pos.x, 0, -this.pos.z).normalize(), (r - 3700) * 0.1);
    this.vel.addScaledVector(acc, dt);

    // ---- grip: the velocity follows the nose; side and vertical slip bleed off, mostly into forward speed
    if (power > 0) {
      const qi = this.q.clone().invert();
      const vb = this.vel.clone().applyQuaternion(qi);
      const before = Math.hypot(vb.x, vb.y);
      vb.x *= Math.exp(-3.2 * power * dt);
      vb.y *= Math.exp(-1.6 * power * dt);
      const lost = before - Math.hypot(vb.x, vb.y);
      if (vb.z < 0) vb.z -= lost * 0.55;
      this.vel.copy(vb.applyQuaternion(this.q));
    }
    this.pos.addScaledVector(this.vel, dt);

    // ---- collisions: every hull probe stays above the surface
    let pen = 0, nrm = null;
    const w = new THREE.Vector3();
    for (const p of ship.probes) {
      w.copy(p).applyQuaternion(this.q).add(this.pos);
      const s = this.terrain.surface(w.x, w.z), d = s - w.y;
      if (d > pen) { pen = d; nrm = w.clone(); }
    }
    this.scrape = Math.max(0, this.scrape - dt * 3);
    if (pen > 0) {
      const e = 2, x = nrm.x, z = nrm.z, t = this.terrain;
      const n = new THREE.Vector3(t.height(x - e, z) - t.height(x + e, z), 2 * e, t.height(x, z - e) - t.height(x, z + e)).normalize();
      this.pos.y += pen;
      const vn = this.vel.dot(n);
      if (vn < 0) {
        if (-vn > CRASH_V && live) this.crash('ground');
        this.vel.addScaledVector(n, -vn * (vn < -3 ? 1.25 : 1.0));    // a hard hit bounces a little, resting does not
        if (-vn > 2) { this.scrape = 1; this.events.push({ type: 'scrape', at: nrm, v: -vn }); }
      }
      const tang = this.vel.clone().addScaledVector(n, -this.vel.dot(n));
      this.vel.addScaledVector(tang, -Math.min(1, (power > 0.5 ? 0.6 : 3.0) * dt));
      if (!power) this.rate.multiplyScalar(Math.exp(-6 * dt));
    }
    // ---- trees
    const tree = this.forest.hit(this.pos, Math.min(this.ship.halfSpan, 5) * 0.8);
    if (tree) {
      const away = new THREE.Vector3(this.pos.x - tree.x, 0, this.pos.z - tree.z).normalize();
      if (this.vel.length() > CRASH_V && live) this.crash('tree');
      const vn = this.vel.dot(away);
      if (vn < 0) this.vel.addScaledVector(away, -vn * 1.5);
      this.pos.addScaledVector(away, 0.5);
    }
  }

  crash(kind) {
    this.crashed = 3.0;
    this.events.push({ type: 'crash', kind, at: this.pos.clone(), v: this.vel.length() });
    this.vel.multiplyScalar(0.12);
    this.rate.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4);
    this.throttle = 0;
    this.boosting = 0;
  }
}
