// Keyboard, mouse (pointer-lock virtual stick), gamepad and the touch sticks (touch.js), merged into one control state
// per frame.
import { clamp } from './noise.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();          // edge-triggered this frame
    this.stick = { x: 0, y: 0 };       // mouse virtual stick, recentres by itself
    this.drag = { dx: 0, dy: 0, wheel: 0, down: false };
    this.invert = false;
    this.canvas = canvas;
    this.locked = false;
    this.padPrev = [];
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.drag.down = true;
      this.pressed.add('Mouse' + e.button);
    });
    addEventListener('mouseup', () => (this.drag.down = false));
    addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.stick.x = clamp(this.stick.x + e.movementX * 0.0035, -1, 1);
        this.stick.y = clamp(this.stick.y + e.movementY * 0.0035, -1, 1);
      } else if (this.drag.down) {
        this.drag.dx += e.movementX;
        this.drag.dy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.drag.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.stick.x = this.stick.y = 0;
    });
  }

  lock() { if (!this.locked) this.canvas.requestPointerLock?.(); }
  unlock() { if (this.locked) document.exitPointerLock?.(); }

  was(code) { return this.pressed.has(code); }

  // the control state for this frame
  read(dt) {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    // the mouse stick drifts back to centre: hold the mouse still and the ship stops rotating
    const back = Math.exp(-2.6 * dt);
    this.stick.x *= back;
    this.stick.y *= back;
    const s = {
      throttleUp: k('KeyW'), throttleDown: k('KeyS'), throttleAxis: null,
      pitch: k('ArrowUp') - k('ArrowDown') - this.stick.y,
      roll: k('ArrowRight') - k('ArrowLeft') + this.stick.x,
      yaw: k('KeyD') - k('KeyA'),
      climb: k('Space'), descend: k('KeyC'),
      boost: k('ShiftLeft') || k('ShiftRight'),
      engine: this.was('KeyE'), canopy: this.was('KeyF'), camera: this.was('KeyV'),
      reset: this.was('KeyR'), respawn: this.was('KeyT'), help: this.was('KeyH'), mute: this.was('KeyM'),
      assist: this.was('KeyL'), invert: this.was('KeyI'), click: this.was('Mouse0'), settings: this.was('KeyO'),
      airL: k('KeyZ'), airR: k('KeyX'),
    };
    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((g) => g && g.connected);
    if (p) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const edge = (i) => b(i) > 0.5 && !(this.padPrev[i] > 0.5);
      s.roll += dz(p.axes[0] || 0);
      s.pitch += dz(p.axes[1] || 0);          // a flight stick: push forward, nose down
      s.yaw += dz(p.axes[2] || 0);
      s.throttleUp = Math.max(s.throttleUp, b(7));
      s.throttleDown = Math.max(s.throttleDown, b(6));
      s.boost = s.boost || b(0) > 0.5;
      s.climb = Math.max(s.climb, b(5));
      s.descend = Math.max(s.descend, b(4));
      s.airL = Math.max(s.airL, b(4)); s.airR = Math.max(s.airR, b(5));     // race: the bumpers are airbrakes
      s.engine = s.engine || edge(3);
      s.canopy = s.canopy || edge(2);
      s.camera = s.camera || edge(1);
      s.reset = s.reset || edge(9);
      this.padPrev = p.buttons.map((x) => x.value);
    }
    // touch: left stick steer / roll and pitch, right stick the throttle lever (up / down, as W / S) and the airbrakes
    const t = this.touch?.on && this.touch.state;
    if (t) {
      s.roll += t.lx;
      s.pitch -= t.ly;                          // pushed up: as the up arrow
      if (t.ry > 0.35 && Math.abs(t.rx) > 0.35) { s.throttleUp = 1; s.throttleDown = 1; }    // down and to a side: drift
      else {
        if (t.ry < -0.35) s.throttleUp = 1;
        if (t.ry > 0.35) s.throttleDown = 1;
        if (t.rx < -0.55) s.airL = 1;
        if (t.rx > 0.55) s.airR = 1;
      }
      s.boost = s.boost || t.boost;
    }
    if (this.invert) s.pitch = -s.pitch;
    s.pitch = clamp(s.pitch, -1, 1);
    s.roll = clamp(s.roll, -1, 1);
    s.yaw = clamp(s.yaw, -1, 1);
    s.drag = { ...this.drag };
    this.drag.dx = this.drag.dy = this.drag.wheel = 0;
    this.pressed.clear();
    return s;
  }
}
