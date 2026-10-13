// HUD: position and lap, lap times, speed, boost energy, thrust, engine state, the countdown and the race banners
// (lap, final lap, finish), messages, edge flashes, the minimap, the controls card (H) and the results table.
const $ = (id) => document.getElementById(id);

export const fmt = (t) => {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
export const ordinal = (n) => n + ((n % 100 > 10 && n % 100 < 14) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// the controls, shown by the in-game card (H) and the menu's Controls screen
export const CONTROLS = [
  ['Flight', [
    [['W', 'S'], 'Throttle up / down (S at zero: brake)'],
    [['A', 'D'], 'Steer'],
    [['←', '→', '↑', '↓'], 'Steer; in the air ↓ nose down, ↑ nose up'],
    [['Shift'], 'Boost (orange pads on the track kick too)'],
    [['Z', 'X'], 'Airbrakes left / right: sharper turns'],
    [['Mouse'], 'Click to steer (Esc releases)'],
  ]],
  ['Ship and track', [
    [['E'], 'Engines start / stop'],
    [['F'], 'Canopy open / close (engines off)'],
    [['T'], 'Back on the track'],
    [['R'], 'Back to the start: restart the race'],
  ]],
  ['View and game', [
    [['V'], 'Camera: chase, far, canopy, fly-by, orbit'],
    [['L'], 'Flight assist on / off'],
    [['I'], 'Invert pitch'],
    [['M'], 'Sound on / off'],
    [['O'], 'Settings'],
    [['H'], 'Show / hide the controls card'],
    [['Esc'], 'Pause menu'],
  ]],
];
export const GAMEPAD = 'Left stick steer (in the air: nose up / down), RT / LT throttle, A boost, B camera, LB / RB airbrakes. ' +
  'In the menus: d-pad, A select, B back; View pauses.';

export const controlsHTML = () => CONTROLS.map(([group, rows]) => `<div class="c-group"><div class="c-title">${group}</div>${rows.map(([keys, what]) =>
  `<div class="c-row"><span class="c-keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span><span>${what}</span></div>`).join('')}</div>`).join('');

// restart a one-shot CSS animation
const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const SEGS = 32;

export class HUD {
  constructor(road, start = 0) {
    this.road = road;
    this.msgT = 0;
    this.goT = 0;
    this.countN = -1;
    this.cache = new Map();
    this.splits = [];
    this.lapRows = [];
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    // the circuit drawn once into an offscreen canvas
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < road.n; i++) {
      x0 = Math.min(x0, road.px[i]); x1 = Math.max(x1, road.px[i]);
      z0 = Math.min(z0, road.pz[i]); z1 = Math.max(z1, road.pz[i]);
    }
    const pad = 260, W = this.map.width;
    this.mapX0 = x0 - pad; this.mapZ0 = z0 - pad;
    this.mapS = W / Math.max(x1 - x0 + 2 * pad, z1 - z0 + 2 * pad);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = W;
    const g = this.base.getContext('2d');
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = 'rgba(5,8,12,0.9)'; g.lineWidth = 13; this.trace(g); g.stroke();
    g.strokeStyle = 'rgba(232,238,244,0.92)'; g.lineWidth = 4.5; this.trace(g); g.stroke();
    const [sx, sy] = this.m(road.px[start], road.pz[start]);       // the start / finish line
    g.fillStyle = '#ffffff'; g.fillRect(sx - 10, sy - 4, 20, 8);
    g.fillStyle = '#10141a'; g.fillRect(sx - 10, sy - 4, 5, 4); g.fillRect(sx, sy - 4, 5, 4); g.fillRect(sx - 5, sy, 5, 4); g.fillRect(sx + 5, sy, 5, 4);
    // the speed bar's segments, the controls card
    $('spdbar').innerHTML = '<i></i>'.repeat(SEGS);
    this.segs = [...$('spdbar').children];
    this.lit = -1;
    $('help').innerHTML = `<div class="h-head"><span class="lbl">Controls</span><span class="lbl">H hides</span></div>${controlsHTML()}
      <div class="h-opt">Assist <b id="assist">on</b> &middot; pitch <b id="pitchmode">arcade</b></div>`;
  }

  m(x, z) { return [(x - this.mapX0) * this.mapS, (z - this.mapZ0) * this.mapS]; }

  trace(g) {
    g.beginPath();
    for (let i = 0; i <= this.road.n; i++) {
      const k = i % this.road.n, [x, y] = this.m(this.road.px[k], this.road.pz[k]);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
  }

  // text into an element only when it changed (the HUD is redrawn every frame)
  set(id, v) {
    const s = String(v);
    if (this.cache.get(id) === s) return;
    this.cache.set(id, s);
    $(id).textContent = s;
  }

  message(text, secs = 2.5) {
    // the race's own events come as text from main.js: shown as designed banners instead
    if (text === 'GO!') return;                                 // the countdown shows GO
    let m = /^Lap (\d+): ([\d.]+) s(.*)$/.exec(text);
    if (m) { this.lapBanner(+m[1], +m[2], m[3]); return; }
    m = /^Finished P(\d+)!?$/.exec(text);
    if (m) {
      const p = +m[1];
      this.banner(p === 1 ? 'Winner' : 'Finish', `${ordinal(p)} place${this.lastLap ? ` · ${this.lastLap}` : ''}`, 'finish');
      return;
    }
    $('msg').textContent = text;
    $('msg').style.opacity = 1;
    this.msgT = secs;
  }

  // a lap done: the next lap's banner (FINAL LAP before the last), with the lap's time and bonus
  lapBanner(k, t, rest) {
    const laps = this.laps, chips = (/clean/.test(rest) ? '<em>Clean lap +5</em>' : '') + (/best/.test(rest) ? '<em>Best</em>' : '');
    const sub = `Lap ${k}<b>${fmt(t)}</b>${chips}`;
    this.lastLap = `Lap ${k} ${fmt(t)}`;
    if (!laps) { this.banner(`Lap ${k}`, `<b>${fmt(t)}</b>${chips}`); return; }
    if (k >= laps) return;                                      // the last lap: the finish banner follows
    const final = k + 1 === laps;
    this.banner(final ? 'Final lap' : `Lap ${k + 1}`, sub, final ? 'final' : '');
  }

  banner(title, sub = '', kind = '') {
    const b = $('banner');
    b.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    b.dataset.kind = kind;
    retrigger(b, 'show');
  }

  // the start lights: n = 3, 2, 1, then 0 = GO
  showCount(n) {
    const c = $('count');
    c.dataset.n = n;
    $('countnum').textContent = n ? n : 'GO';
    c.classList.add('on');
    if (n) { c.classList.remove('go'); retrigger(c, 'tick'); } else { c.classList.remove('tick'); retrigger(c, 'go'); this.goT = 1.4; }
  }

  hideCount() { $('count').classList.remove('on', 'tick', 'go'); this.countN = -1; }

  toggleHelp() { $('help').classList.toggle('hidden'); }

  hideHelp() { $('help').classList.add('hidden'); }

  // a glow round the screen's edge (boost pad: orange, wall hit: blue), fading out
  // a short pulse on an element (the drift meter reaching a step)
  pulse(id) { retrigger($(id).parentElement, 'pulse'); }

  flash(colour, secs = 0.7) {
    const el = $('edgeflash');
    el.style.transition = 'none';
    el.style.boxShadow = `inset 0 0 140px 40px ${colour}`;
    el.style.opacity = 1;
    void el.offsetWidth;
    el.style.transition = `opacity ${secs}s ease-out`;
    el.style.opacity = 0;
  }

  hideResults() {
    const was = !$('results').classList.contains('hidden');
    $('results').classList.add('hidden');
    if (was) this.onHideResults?.();
  }

  showResults(rows, score, total) {
    const winner = rows[0].time, me = rows.findIndex((r) => r.player) + 1;
    const level = document.documentElement.dataset.level || 'normal';
    const tr = rows.map((r, i) => `<tr class="${r.player ? 'me' : ''}" style="--i:${i}"><td>${i + 1}</td>
      <td><span class="sw" style="background:${r.css}"></span>${r.name}${r.player ? '<small>You</small>' : ''}</td>
      <td>${r.est ? '~' : ''}${fmt(r.time)}</td><td class="r-gap">${i ? '+' + (r.time - winner).toFixed(2) : ''}</td>
      <td>${Number.isFinite(r.best) ? fmt(r.best) : '-'}</td></tr>`).join('');
    $('results').innerHTML = `
      <div class="r-head">
        <div><div class="m-kicker">Race complete &middot; ${level}</div>
          <div class="r-place">${me ? ordinal(me) : '-'}<small>of ${rows.length}</small></div></div>
        <div class="r-total"><span class="lbl">Score</span><b>${total}</b></div>
      </div>
      <table class="r-table"><thead><tr><th>Pos</th><th>Ship</th><th>Time</th><th>Gap</th><th>Best lap</th></tr></thead><tbody>${tr}</tbody></table>
      <div class="r-score">
        <div><span>Finishing position</span><b>${score.position}</b></div>
        <div><span>Boost pads (2 each)</span><b>${score.pads}</b></div>
        <div><span>Clean laps (5 each)</span><b>${score.clean}</b></div>
        <div><span>Fastest lap of the race</span><b>${score.fastest}</b></div>
      </div>
      <div class="r-actions">
        <button class="m-item" data-act="again" tabindex="-1"><kbd>R</kbd>Race again</button>
        <button class="m-item" data-act="difficulty" tabindex="-1">Difficulty</button>
        <button class="m-item" data-act="scoreboard" tabindex="-1">Global scoreboard</button>
        <button class="m-item" data-act="menu" tabindex="-1"><kbd>Esc</kbd>Main menu</button>
      </div>`;
    $('results').classList.remove('hidden');
    this.onResults?.();
  }

  // the race's lap list (one row per lap, built when the lap count is known)
  buildLaps(n) {
    $('splits').innerHTML = Array.from({ length: n }, (_, i) => `<div class="trow"><span>Lap ${i + 1}</span><b>--:--.--</b></div>`).join('');
    this.lapRows = [...$('splits').children];
    this.lapRowsN = n;
    this.lapRowText = [];
  }

  update(dt, s) {
    // what kind of HUD: a race on the track, free flight in space, or laps of the meadow's road (no race there)
    const r = s.race && s.mode !== 'free' ? s.race : null;
    const kind = r ? 'race' : s.race ? 'free' : 'laps';
    if (kind !== this.kind) { this.kind = kind; $('hud').dataset.kind = kind; }

    // speed, the speed bar, energy and thrust
    this.set('spd', Math.round(s.speed * 3.6));
    const lit = Math.round(Math.min(1, s.speed / 360) * SEGS);
    if (lit !== this.lit) { this.segs.forEach((e, i) => e.classList.toggle('on', i < lit)); this.lit = lit; }
    $('bst').style.transform = `scaleX(${Math.max(0, Math.min(1, s.boostEnergy))})`;
    const over = Math.max(0, Math.min(1, (s.boostEnergy - 1) / 0.5));
    if (over !== this.over) { $('bstx').style.transform = `scaleX(${over})`; this.over = over; }
    $('thr').style.transform = `scaleX(${Math.max(0, Math.min(1, s.throttle))})`;
    // the drift's charge: shown while drifting, coloured by the step it has reached
    const dr = !!s.drifting;
    if (dr !== this.drifting) { $('hud-speed').classList.toggle('drifting', dr); this.drifting = dr; }
    if (dr) {
      $('dft').style.transform = `scaleX(${Math.min(1, (s.driftCharge || 0) / 1.8)})`;
      if (s.driftTier !== this.driftTier) { $('dft').dataset.t = s.driftTier; this.driftTier = s.driftTier; }
      if (s.driftChain !== this.driftChain) { $('dchain').dataset.c = s.driftChain; this.driftChain = s.driftChain; }
    }
    const sp = $('hud-speed'), boosting = s.boosting > 0.5, low = s.boostEnergy < 0.2;
    if (boosting !== this.boosting) { sp.classList.toggle('boost', boosting); this.boosting = boosting; }
    if (low !== this.low) { sp.classList.toggle('low', low); this.low = low; }
    this.set('state', s.state);
    if (s.stateClass !== this.stateClass) { $('state').className = 'chip ' + s.stateClass; this.stateClass = s.stateClass; }
    this.set('alt', Number.isFinite(s.agl) ? Math.max(0, s.agl).toFixed(s.agl < 10 ? 1 : 0) : '-');
    this.set('cam', s.camera);
    if ($('assist')) { this.set('assist', s.assist ? 'on' : 'off'); this.set('pitchmode', s.invert ? 'flight-sim' : 'arcade'); }

    if (r) {
      this.laps = r.laps;
      if (this.lapRowsN !== r.laps) this.buildLaps(r.laps);
      this.set('rpos', r.pos);
      this.set('rtot', r.total);
      this.set('lapn', r.lap);
      this.set('lapt', r.laps);
      // the laps so far: a new "last lap" is the next split; back on the grid they start over
      const st = r.state;
      if (st === 'grid' || st === 'countdown' || !Number.isFinite(r.time)) this.splits.length = 0;
      else if (Number.isFinite(r.last) && r.last !== this.splits[this.splits.length - 1]) this.splits.push(r.last);
      const done = this.splits.reduce((a, b) => a + b, 0), n = this.splits.length;
      const over = st === 'finished' && n >= r.laps;
      const cur = !Number.isFinite(r.time) ? NaN : over ? this.splits[n - 1] : r.time - done;
      this.set('lap', fmt(cur));
      const bestI = n ? this.splits.indexOf(Math.min(...this.splits)) : -1;
      this.lapRows.forEach((row, i) => {
        const live = i === n && !over && Number.isFinite(r.time);
        const text = i < n ? fmt(this.splits[i]) : live ? fmt(cur) : '--:--.--';
        const cls = 'trow' + (live ? ' live' : '') + (i === bestI && n > 1 ? ' best' : '');
        if (this.lapRowText[i] !== text) { row.lastChild.textContent = text; this.lapRowText[i] = text; }
        if (row.className !== cls) row.className = cls;
      });
      this.set('best', fmt(r.best));
      this.set('total', fmt(r.time));
      this.set('rscore', r.score);
      // the lights: 3, 2, 1 over the grid, then GO
      if (st === 'countdown') {
        const k = Math.max(1, Math.ceil(r.count));
        if (k !== this.countN) { this.countN = k; this.showCount(k); }
      } else if (st === 'racing' && this.prevState === 'countdown') { this.countN = 0; this.showCount(0); }
      else if (st === 'grid' && this.countN >= 0) this.hideCount();
      // places won and lost
      if (st === 'racing' && this.prevPos && r.pos !== this.prevPos) retrigger($('hud-race'), r.pos < this.prevPos ? 'up' : 'down');
      if (st === 'grid') $('hud-race').classList.remove('up', 'down');
      this.prevPos = r.pos;
      this.prevState = st;
    } else {
      this.laps = null;
      this.prevState = null;
      if (this.countN >= 0 && !(this.goT > 0)) this.hideCount();
      this.set('lap', fmt(s.lapTime));
      this.set('last', fmt(s.lastLap));
      this.set('best', fmt(s.bestLap));
      this.set('lapn', s.lap);
    }
    if (this.goT > 0) { this.goT -= dt; if (this.goT <= 0) this.hideCount(); }
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) $('msg').style.opacity = 0;
    }

    // minimap: circuit + the rivals as dots + the ship as an arrow along its heading
    const g = this.mctx, W = this.map.width;
    g.clearRect(0, 0, W, W);
    g.drawImage(this.base, 0, 0);
    for (const o of (s.race && s.race.others) || []) {
      const [ox, oy] = this.m(o.x, o.z);
      g.fillStyle = o.css; g.strokeStyle = '#0a0d12'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(ox, oy, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    const [x, y] = this.m(s.x, s.z);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(s.fx, -s.fz));
    g.fillStyle = '#ff5a3c'; g.strokeStyle = '#0a0d12'; g.lineWidth = 3;
    g.shadowColor = 'rgba(255,90,60,0.8)'; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath();
    g.fill(); g.shadowBlur = 0; g.stroke();
    g.restore();
  }
}
