// Phones and tablets: two floating sticks and a few buttons over the game, read by Input like a gamepad.
//  - left stick: steer (free flight: roll, and pitch up / down)
//  - right stick: up throttle, down brake (the lever, as W / S), pushed sideways the airbrakes on that side
//  - Boost (held), Engines (free flight), pause, camera
// A stick appears where the thumb lands in its half of the screen (a faint ring shows where it rests). The first tap
// asks for full screen in landscape where the browser allows it; held upright, the page asks to be turned.
// On by the setting (Auto / On / Off): Auto is a phone or tablet - a touch screen and a mobile browser - or, failing
// that, the first finger on the screen. (A Galaxy S24 Ultra's S Pen makes it report a fine pointer that hovers: the
// first test, "(hover: none) and (pointer: coarse)", took it for a desktop - no sticks.)
export const isTouch = () => {
  const ua = navigator.userAgent || '';
  const screenTouch = navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches;
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return (screenTouch && mobile) || matchMedia('(hover: none) and (pointer: coarse)').matches;
};

const DEAD = 0.12;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class TouchControls {
  constructor(input) {
    this.input = input;
    input.touch = this;
    this.state = { lx: 0, ly: 0, rx: 0, ry: 0, boost: false };
    this.mode = null;
    this.on = false;
    this.pref = 'auto';
    this.auto = isTouch();
    const el = (this.el = document.createElement('div'));
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-zone" data-side="l"><div class="t-stick"><i></i></div></div>
      <div class="t-zone" data-side="r"><div class="t-stick"><i></i></div></div>
      <button class="t-btn t-boost" data-b="boost">Boost</button>
      <button class="t-btn t-engine" data-b="KeyE">Engines</button>
      <button class="t-btn t-small t-pause" data-b="pause" aria-label="Pause"><span class="t-bars"><i></i><i></i></span></button>
      <button class="t-btn t-small t-cam" data-b="KeyV" aria-label="Camera">Cam</button>`;
    document.body.appendChild(el);
    const turn = document.createElement('div');
    turn.id = 'rotate';
    turn.innerHTML = '<div><div class="r-phone"></div><b>Turn your phone sideways</b><span>Need4Space plays in landscape</span></div>';
    document.body.appendChild(turn);
    for (const z of el.querySelectorAll('.t-zone')) this.stick(z);
    for (const b of el.querySelectorAll('.t-btn')) this.button(b);
    // full screen and landscape on the first tap (a user gesture is needed; iPhones have no full screen for pages)
    let asked = false;
    const full = () => {
      const d = document.documentElement;
      if (asked || !this.on || document.fullscreenElement || !d.requestFullscreen) return;
      asked = true;
      d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    };
    addEventListener('pointerup', full);
    // Auto: a finger on the screen is enough (whatever the browser said it was)
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.auto) { this.auto = true; this.setPref(this.pref); }
    }, true);
    // no pinch or double-tap zoom (Safari ignores the viewport's user-scalable)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  // a floating stick in a zone: its centre where the thumb lands, its reach 13 % of the screen's short side
  stick(zone) {
    const side = zone.dataset.side, base = zone.querySelector('.t-stick'), knob = base.querySelector('i');
    let id = null, x0 = 0, y0 = 0;
    const reach = () => Math.min(innerWidth, innerHeight) * 0.13;
    const move = (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - x0, dy = e.clientY - y0;
      const r = reach(), d = Math.hypot(dx, dy);
      if (d > r) { dx *= r / d; dy *= r / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.state[side + 'x'] = dz(dx / r);
      this.state[side + 'y'] = dz(dy / r);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      zone.classList.remove('on');
      knob.style.transform = base.style.left = base.style.top = '';
      this.state[side + 'x'] = this.state[side + 'y'] = 0;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch { /* a pointer the browser no longer tracks */ }
      x0 = e.clientX; y0 = e.clientY;
      const rc = zone.getBoundingClientRect();
      base.style.left = `${x0 - rc.left}px`;
      base.style.top = `${y0 - rc.top}px`;
      zone.classList.add('on');
      move(e);
    });
    zone.addEventListener('pointermove', move);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, up);
  }

  // Boost while held; pause as the Esc key (the menu's own path); the rest as their keys pressed this frame
  button(b) {
    const k = b.dataset.b;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('on');
      if (k === 'boost') { this.state.boost = true; try { b.setPointerCapture(e.pointerId); } catch { /* (as above) */ } }
      else if (k === 'pause') dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
      else this.input.pressed.add(k);
    });
    const up = () => { b.classList.remove('on'); if (k === 'boost') this.state.boost = false; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
  }

  // the setting: 'auto' | 'on' | 'off'
  setPref(p) {
    this.pref = p || 'auto';
    const on = this.pref === 'on' || (this.pref === 'auto' && this.auto);
    if (on === this.on) return;
    this.on = on;
    document.body.classList.toggle('touch', on);
    if (!on) for (const k of ['lx', 'ly', 'rx', 'ry']) this.state[k] = 0;
    this.state.boost = false;
  }

  // race or free flight (the Engines button is free flight's)
  setMode(m) { if (m !== this.mode) { this.mode = m; this.el.dataset.mode = m; } }
}
