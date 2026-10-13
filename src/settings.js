// Settings (O): every look feature has a switch that changes the picture and costs what it costs; saved per browser.
import { VERSION } from './changelog.js';

const KEY = 'feather.settings.v4';
export const DEFAULTS = { tonemap: 'aces', ao: true, bloom: true, shadows: 'high', scale: 1, exposure: 0, fps: true,
  blur: true, reflections: true, streaks: true, ai: 'easy', music: 'high', sfx: 'high', aa: 'smaa', aoRes: 'auto',
  brakeLights: true, laptop: false, touch: 'auto', map: 'space', shafts: true, lensWater: true, iceSnow: true, iceDust: true, aurora: true,
  iceStorm: true, iceGeysers: true, wreckFx: true, wreckMist: true, drift: false, airPitch: true, sandFx: true, dustDevils: true, heatHaze: true,
  sandstorm: true, caveFx: true };
// Laptop mode's picture (quality.js has what else it cuts); turned off, the rows go back to what they were. The render
// scale stays at 100 %: with the rest cut, a laptop's integrated GPU holds it (tested on a Core Ultra 5 235U)
const LAPTOP = { scale: 1, aa: 'smaa1', ao: false, reflections: false, shadows: 'off', streaks: false, blur: false, shafts: false,
  iceSnow: false, iceDust: false, iceGeysers: false, wreckFx: false, wreckMist: false, sandFx: false, dustDevils: false, heatHaze: false, caveFx: false };
// (AI difficulty: the rivals, race.js AI_LEVELS - Normal a fair fight, Hard close to a flawless lap, Brutal at it)
const ROWS = [
  ['ai', 'AI difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']]],
  ['drift', 'Drift (touch the brake, turn hard)', [[true, 'On'], [false, 'Off']]],
  ['airPitch', 'Nose control in the air', [[true, 'On'], [false, 'Off']]],
  ['music', 'Music', [['off', 'Off'], ['low', 'Low'], ['mid', 'Medium'], ['high', 'High']]],
  ['sfx', 'Sound effects', [['low', 'Low'], ['mid', 'Medium'], ['high', 'High']]],
  ['touch', 'Touch controls', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]],
  ['tonemap', 'Tone mapping', [['punchy', 'AgX Punchy'], ['agx', 'AgX Medium'], ['aces', 'ACES']]],
  ['exposure', 'Exposure', [[-1.5, '-1.5'], [-1, '-1'], [-0.5, '-0.5'], [0, '0'], [0.5, '+0.5']]],
  ['aa', 'Anti-aliasing', [['smaa1', 'SMAA'], ['msaa', 'MSAA 4x'], ['fast', 'MSAA 2x + SMAA'], ['smaa', 'MSAA 4x + SMAA'], ['high', 'MSAA 8x + SMAA']]],
  ['ao', 'Ambient occlusion', [[true, 'On'], [false, 'Off']]],
  ['aoRes', 'AO resolution', [['auto', 'Auto'], ['full', 'Full'], ['half', 'Half']]],
  ['bloom', 'Bloom', [[true, 'On'], [false, 'Off']]],
  ['reflections', 'Deck reflections (needs AO)', [[true, 'On'], [false, 'Off']]],
  ['streaks', 'Light streaks', [[true, 'On'], [false, 'Off']]],
  ['blur', 'Speed blur', [[true, 'On'], [false, 'Off']]],
  ['shafts', 'Light shafts (forest moon, ice planet, desert)', [[true, 'On'], [false, 'Off']]],
  ['iceSnow', 'Blowing snow (ice planet)', [[true, 'On'], [false, 'Off']]],
  ['iceDust', 'Diamond dust (ice planet)', [[true, 'On'], [false, 'Off']]],
  ['aurora', 'Aurora (ice planet)', [[true, 'On'], [false, 'Off']]],
  ['iceStorm', 'Storm and lightning (ice planet)', [[true, 'On'], [false, 'Off']]],
  ['iceGeysers', 'Steam geysers (ice planet)', [[true, 'On'], [false, 'Off']]],
  ['sandFx', 'Blowing sand and wakes (desert)', [[true, 'On'], [false, 'Off']]],
  ['dustDevils', 'Dust devils (desert)', [[true, 'On'], [false, 'Off']]],
  ['heatHaze', 'Heat shimmer (desert)', [[true, 'On'], [false, 'Off']]],
  ['sandstorm', 'Sandstorm (desert)', [[true, 'On'], [false, 'Off']]],
  ['lensWater', 'Water on the lens', [[true, 'On'], [false, 'Off']]],
  ['wreckFx', 'Derelict: sparks, flicker, drift, arcs (space)', [[true, 'On'], [false, 'Off']]],
  ['wreckMist', 'Derelict: coolant mist, sun beams (space)', [[true, 'On'], [false, 'Off']]],
  ['caveFx', 'Cave: daylight beams, spray, glowworms (forest moon)', [[true, 'On'], [false, 'Off']]],
  ['brakeLights', 'Brake lights', [[true, 'On'], [false, 'Off']]],
  ['laptop', 'Laptop mode (integrated GPU)', [[false, 'Off'], [true, 'On']]],
  ['shadows', 'Shadows', [['high', 'High'], ['medium', 'Medium'], ['off', 'Off']]],
  ['scale', 'Render scale', [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']]],
  ['fps', 'FPS readout', [[true, 'On'], [false, 'Off']]],
];

// the headings the rows fall under (in the menu's Settings screen)
const GROUPS = { ai: 'Race', music: 'Audio', touch: 'Controls', tonemap: 'Picture', ao: 'Effects', laptop: 'Performance' };

// the saved settings as they are (main.js reads Laptop mode before the ship loads)
export function savedSettings() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export class Settings {
  // integrated: the GPU looks built-in (quality.js) - a first visit starts in Laptop mode
  constructor(apply, integrated = false) {
    this.apply = apply;
    this.v = { ...DEFAULTS };
    let saved = null;
    try { saved = localStorage.getItem(KEY); Object.assign(this.v, JSON.parse(saved || '{}')); } catch { /* private window */ }
    if (!saved && integrated) this.laptop(true);
    // Normal is the default difficulty: a Hard saved before the player ever chose one goes back to it
    if (!this.v.aiPicked) this.v.ai = DEFAULTS.ai;
    // and the music's level High, unless one was chosen
    if (!this.v.musicPicked) this.v.music = DEFAULTS.music;
    // ("skip drifting for now": braking into a bend with the stick over slid the ship where the rivals just brake -
    // off unless the player turns it on)
    if (!this.v.driftPicked) this.v.drift = DEFAULTS.drift;
    this.focus = 0;                                  // the row the keyboard / gamepad is on
    this.onSet = null;                               // (k, value) after every change (menu.js: the difficulty accent)
    this.el = document.getElementById('settings');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      this.focus = +b.closest('.srow').dataset.r;
      this.set(b.dataset.k, JSON.parse(b.dataset.v));
    });
    this.el.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.srow');
      if (row && +row.dataset.r !== this.focus) { this.focus = +row.dataset.r; this.mark(); }
    });
    this.draw();
    apply(this.v);
  }

  // Laptop mode on: its rows set (what they were kept); off: those rows back
  laptop(on) {
    if (on && !this.v.laptop) {
      this.v.beforeLaptop = Object.fromEntries(Object.keys(LAPTOP).map((k) => [k, this.v[k]]));
      Object.assign(this.v, LAPTOP);
    } else if (!on && this.v.laptop) {
      Object.assign(this.v, this.v.beforeLaptop || Object.fromEntries(Object.keys(LAPTOP).map((k) => [k, DEFAULTS[k]])));
      delete this.v.beforeLaptop;
    }
    this.v.laptop = on;
  }

  set(k, val) {
    if (k === 'laptop') this.laptop(val);
    this.v[k] = val;
    if (k === 'ai') this.v.aiPicked = true;
    if (k === 'music') this.v.musicPicked = true;
    if (k === 'drift') this.v.driftPicked = true;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* storage blocked */ }
    this.apply(this.v);
    this.draw();
    this.onSet?.(k, val);
  }

  get open() { return !this.el.classList.contains('hidden'); }

  toggle() { this.el.classList.toggle('hidden'); return this.open; }

  get focusKey() { return ROWS[this.focus][0]; }

  // keyboard / gamepad: the next row up or down, the focused row's option one step left or right
  move(d) {
    this.focus = (this.focus + d + ROWS.length) % ROWS.length;
    this.mark();
    this.el.querySelector('.srow.focus')?.scrollIntoView({ block: 'nearest' });
  }

  cycle(d, wrap = false) {
    const [k, , opts] = ROWS[this.focus], n = opts.length;
    const i = opts.findIndex(([val]) => val === this.v[k]);
    let j = i + d;
    if (wrap) j = (j + n) % n; else j = Math.max(0, Math.min(n - 1, j));
    if (j !== i) this.set(k, opts[j][0]);
    return j !== i;
  }

  mark() { this.el.querySelectorAll('.srow').forEach((r) => r.classList.toggle('focus', +r.dataset.r === this.focus)); }

  draw() {
    this.el.innerHTML = ROWS.map(([k, label, opts], r) => (GROUPS[k] ? `<div class="s-group">${GROUPS[k]}</div>` : '') +
      `<div class="srow${r === this.focus ? ' focus' : ''}" data-r="${r}"><span>${label}</span><div class="seg">${opts.map(([val, t]) =>
        `<button tabindex="-1" data-k="${k}" data-v='${JSON.stringify(val)}'${k === 'ai' ? ` data-lv="${val}"` : ''} class="${this.v[k] === val ? 'on' : ''}">${t}</button>`)
        .join('')}</div></div>`).join('') +
      // which version is running (tools/stamp.py; a phone can keep an old one a while after an update)
      `<div class="s-ver">Version ${VERSION} &middot; build ${document.querySelector('meta[name="build"]')?.content || 'dev'}</div>` +
      `<div class="s-ver">© 2026 vengeful180. All rights reserved.</div>`;
  }
}
