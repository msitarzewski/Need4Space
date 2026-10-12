// GPU time per composer pass (EXT_disjoint_timer_query_webgl2), plus the scene with / without the shadow update
export async function profile(W = 2560, H = 1440, frames = 16, opts = {}) {
  const F = window.__feather, r = F.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const comp = F.composer;
  const ow = innerWidth, oh = innerHeight, pr = r.getPixelRatio();
  r.setPixelRatio(1); r.setSize(W, H, false); comp.setPixelRatio(1); comp.setSize(W, H);
  F.camera.aspect = W / H; F.camera.updateProjectionMatrix();
  const names = comp.passes.map((p, i) => (p.constructor.name || 'pass') + '#' + i);
  const pending = [];
  const time = (name, fn) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([name, q]); };
  const origs = comp.passes.map((p) => p.render);
  comp.passes.forEach((p, i) => { const o = origs[i].bind(p); p.render = (...a) => time(names[i], () => o(...a)); });
  const sums = {}, info = { calls: 0, tris: 0 };
  const rt = new F.THREE.WebGLRenderTarget(W, H, { type: F.THREE.HalfFloatType, samples: 4 });
  let cpu = 0;
  try {
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      F.advance(1 / 60);
      cpu += performance.now() - t0;
      if (opts.split) {
        r.setRenderTarget(rt);
        r.shadowMap.autoUpdate = false;
        r.shadowMap.needsUpdate = true;
        time('scene+shadows', () => r.render(F.scene, F.camera));
        r.shadowMap.needsUpdate = false;
        time('scene only', () => r.render(F.scene, F.camera));
        info.calls = r.info.render.calls; info.tris = r.info.render.triangles;
        r.setRenderTarget(null);
      }
    }
    await new Promise((res) => setTimeout(res, 400));
    gl.finish();
    await new Promise((res) => setTimeout(res, 400));
    for (const [n, q] of pending) {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      (sums[n] ||= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  } finally {
    comp.passes.forEach((p, i) => (p.render = origs[i]));
    rt.dispose();
    r.setPixelRatio(pr); r.setSize(ow, oh, false); comp.setPixelRatio(pr); comp.setSize(ow, oh);
    F.camera.aspect = ow / oh; F.camera.updateProjectionMatrix();
  }
  const out = {};
  let tot = 0;
  for (const [n, v] of Object.entries(sums)) {
    v.sort((a, b) => a - b);
    out[n] = +v[v.length >> 1].toFixed(3);
    if (n.includes('#')) tot += out[n];
  }
  out.passTotal = +tot.toFixed(2);
  out.cpuTickPlusSubmit = +(cpu / frames).toFixed(2);
  out.info = info;
  return out;
}


// repeatable scenes for profiling and checks: 'grid' (the countdown, all nine ships in view) and 'pack' (racing,
// the player's ship on an AI autopilot, `sec` seconds after the start)
export async function scenario(name, sec = 20) {
  const F = window.__feather, { Driver } = await import('./race.js');
  F.input.read = F.input.__read || F.input.read;
  F.input.__read = F.input.read;
  F.race.reset();
  F.ship.setEngine(true);
  F.advance(5);
  for (let i = 0; i < 600 && F.race.state !== 'countdown'; i++) F.advance(0.05);
  if (name === 'grid') { F.advance(1); return F.race.state; }
  const e = F.race.player, rnd = () => 0.5;
  const d = new Driver(e, F.race, rnd, e.slot);
  F.input.read = (dt) => ({ ...F.input.__read(dt), ...(F.race.racing ? d.think(dt) : {}) });
  for (let i = 0; i < 400 && F.race.state !== 'racing'; i++) F.advance(0.05);
  F.advance(sec);
  return F.race.state + ' s=' + F.racer.s.toFixed(0) + ' pos=' + F.race.position();
}

// GPU + CPU of rendering one frozen frame (no simulation), median of `frames` after `warm` warm-up renders
export async function still(frames = 30, warm = 20) {
  const F = window.__feather, r = F.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  for (let i = 0; i < warm; i++) F.render();
  const qs = [], cpu = [];
  for (let i = 0; i < frames; i++) {
    const q = gl.createQuery(), t0 = performance.now();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    F.render();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    cpu.push(performance.now() - t0);
    qs.push(q);
  }
  await new Promise((res) => setTimeout(res, 300)); gl.finish(); await new Promise((res) => setTimeout(res, 300));
  const gpu = qs.filter((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
  qs.forEach((q) => gl.deleteQuery(q));
  const med = (a) => { a = [...a].sort((x, y) => x - y); return +a[a.length >> 1].toFixed(3); };
  return { gpu: med(gpu), cpu: med(cpu), calls: r.info.render.calls, tris: r.info.render.triangles };
}

// the grid at the lights (all nine ships in view from the chase camera): reset, engines on, stop in the countdown
export async function gridView() {
  const F = window.__feather;
  F.race.reset();
  F.ship.setEngine(true);
  F.rig.mode = 'chase';
  for (let i = 0; i < 400 && F.race.state !== 'countdown'; i++) F.advance(0.05);
  F.rig.snap(F.ctl);
  F.advance(0.3);
  return F.race.state;
}

// a whole race simulated (no rendering): every ship on the AI, the player too; stats for the checks.
// opts.level: the rivals' AI difficulty; opts.player: the autopilot's level ('hard' drives like the rivals' best);
// opts.playerScale: the autopilot's engine (1 = the player's). Stutter: the largest step-to-step lurch of a rival's
// position (|p+ - 2p + p-|, m - the loop's pull alone is ~0.08 m) and how many steps lurched over 0.3 m; stuck: rival
// ship-seconds under 60 m/s once racing; flicker: rivals' boost bursts under 0.2 s + airbrake pulses under 0.1 s.
export async function simRace(maxT = 260, opts = {}) {
  const F = window.__feather, { Driver } = await import('./race.js');
  const race = F.race, dt = 1 / 120, level0 = race.level;
  if (opts.level) race.setDifficulty(opts.level);
  race.reset();
  for (const e of race.entries) { e.ship.setEngine(true); e.ship.power = 1; e.ship.spin = 1; e.ship.canopyT = 0; e.ship.canopyOpen = false; }
  const keep = race.level;
  race.level = opts.player || race.level;
  const pd = new Driver(race.player, race, () => 0.5, race.player.slot);
  race.level = keep;
  race.player.racer.thrustScale = opts.playerScale ?? 1;
  const HOLD = { throttleUp: 0, throttleDown: 0, throttleAxis: 0, boost: 0, yaw: 0, roll: 0, airL: 0, airR: 0 };
  let t = 0, nan = 0, minV = 1e9, lurch = 0, lurches = 0, stuck = 0, pads = 0, boostT = 0, step = 0, flicker = 0;
  for (const e of race.entries) e.flick = null;
  const where = [];
  const falls = [], P = race.entries.map(() => []);
  const hooks = race.entries.map((e) => { const o = e.racer.onEvent; e.racer.onEvent = (ev) => { if (ev.type === 'fall') falls.push([e.team.name, e.racer.s.toFixed(0), t.toFixed(1)]); if (ev.type === 'pad' && !e.player && race.racing) { pads++; e.padStep = step; } if (ev.type === 'scrape' && ev.wall) e.padStep = step; o(ev); }; return o; });
  while (t < maxT) {
    race.step(dt, race.racing ? pd.think(dt) : HOLD, true);
    race.entries.forEach((e, k) => {
      e.racer.animState();
      if (!Number.isFinite(e.racer.s + e.racer.x + e.racer.y)) nan++;
      if (race.racing && race.time > 5 && !e.finished) minV = Math.min(minV, e.racer.vs);
      if (e.player || !race.racing || e.finished) return;
      if (race.time > 5 && e.racer.vs < 60) stuck += dt;
      if (e.racer.boosting > 0.5) boostT += dt;
      // flicker: a boost burst under 0.2 s or an airbrake pulse under 0.1 s (flames / flaps blinking)
      const di = e.driver.inp, b = di.boost, a = di.airL ? -1 : di.airR ? 1 : 0, f = (e.flick ||= { b: 0, bT: 0, a: 0, aT: 0 });
      if (b !== f.b) { if (f.b && race.time - f.bT < 0.2) flicker++; f.b = b; f.bT = race.time; }
      if (a !== f.a) { if (f.a && race.time - f.aT < 0.1) flicker++; f.a = a; f.aT = race.time; }
      const p = P[k];
      p.push(e.racer.pos.clone());
      if (p.length > 3) p.shift();
      if (p.length === 3) {
        const d = p[2].clone().sub(p[1]).sub(p[1]).add(p[0]).length();
        // (over 5 m: a respawn after a fall; a pad's kick (a 55 m/s step) and a wall knock (the drift reversed) are
        // single-step changes by design - the player's too)
        if (d < 5 && !(step - (e.padStep ?? -9) < 3)) {
          lurch = Math.max(lurch, d);
          if (d > 0.3) { lurches++; if (where.length < 12) where.push([e.team.name, e.racer.s | 0, +d.toFixed(2), +race.time.toFixed(2)]); }
        }
      }
    });
    race.events.length = 0;
    t += dt;
    step++;
    if (race.entries.every((e) => e.finished)) break;
  }
  race.entries.forEach((e, k) => (e.racer.onEvent = hooks[k]));
  const ai = race.entries.filter((e) => !e.player), all = ai.flatMap((e) => e.laps.slice(1));
  const med = (a) => { a = [...a].sort((x, y) => x - y); return a.length ? +a[a.length >> 1].toFixed(2) : NaN; };
  const out = { t: +t.toFixed(1), state: race.state, level: race.level, stats: race.stats, nan, falls, minSpeed: +minV.toFixed(0),
    finished: race.entries.filter((e) => e.finished).length, wallsPerShipLap: +(race.stats.walls / 8 / 3).toFixed(2),
    lurch: +lurch.toFixed(3), lurches, lurchAt: where, flicker, stuck: +stuck.toFixed(2), aiPadsPerLap: +(pads / 8 / 3).toFixed(2), aiBoost: +(boostT / 8 / Math.max(1, race.time)).toFixed(3),
    aiBestLap: +Math.min(...ai.map((e) => e.best)).toFixed(2), aiMedianFlyingLap: med(all), playerPos: race.position(),
    order: race.standings().map((e) => e.team.name + (e.finishTime ? ' ' + e.finishTime.toFixed(1) : '')),
    laps: race.entries.map((e) => e.team.name + ' ' + e.laps.map((x) => x.toFixed(1)).join('/')) };
  if (opts.level) race.setDifficulty(level0);
  race.player.racer.thrustScale = 1;
  return out;
}

// one ship alone on the circuit (no traffic, no rubber band): the player's racer driven by the rivals' AI at `level`
// with engine `scale` - with level 'brutal' and scale 1 it is the benchmark for a flawless player (every pad, the
// boost spent where it pays, the least-curvature line). Laps from a standing start; flying laps are the 2nd on.
// opts.tune: Driver.tune overrides for this run only.
export async function timeTrial(opts = {}) {
  const F = window.__feather, race = F.race, tr = F.track, dt = 1 / 120, { Driver } = await import('./race.js');
  race.reset();
  const e = race.player, r = e.racer;
  e.ship.setEngine(true); e.ship.power = 1; e.ship.spin = 1; e.ship.canopyT = 0; e.ship.canopyOpen = false;
  const solo = Object.create(race);
  solo.entries = [e];
  solo.level = opts.level || 'brutal';
  const d = new Driver(e, solo, () => 0.5, e.slot), tune0 = { ...Driver.tune };
  const replan = opts.tune && ['lineM', 'A', 'brakeD'].some((k) => k in opts.tune);
  if (opts.tune) { Object.assign(Driver.tune, opts.tune); if (replan) race.replan(); }
  r.locked = false; r.thrustScale = opts.scale ?? 1; r.draft = 0;
  let prog = 0, lastS = r.s, t = 0, lt = 0, walls = 0, pads = 0, boostT = 0, minV = 1e9, falls = 0, err = 0, air = 0, e2 = 0, ne = 0;
  const laps = [], o = r.onEvent;
  r.onEvent = (ev) => { if (ev.type === 'scrape' && ev.wall) walls++; if (ev.type === 'pad') pads++; if (ev.type === 'fall') falls++; };
  try {
    while (laps.length < (opts.laps || 3) && t < 400) {
      const inp = d.think(dt);
      r.step(dt, inp);
      r.events.length = 0;
      r.animState();
      prog += race.gap(r.s, lastS); lastS = r.s; t += dt;
      if (r.boosting > 0.5) boostT += dt;
      if (inp.airL || inp.airR) air += dt;
      if (t > 4) { const ex = Math.abs(r.x - race.plan.x[Math.floor(r.s / tr.step) % tr.n]); minV = Math.min(minV, r.vs); err = Math.max(err, ex); e2 += ex * ex; ne++; }
      if (prog >= (laps.length + 1) * tr.length) { laps.push(+(t - lt).toFixed(2)); lt = t; }
    }
  } finally {
    r.onEvent = o;
    r.thrustScale = 1;
    Object.assign(Driver.tune, tune0);
    if (replan) race.replan();
  }
  race.reset();
  return { laps, walls, pads, falls, boost: +(boostT / t).toFixed(3), airbrake: +(air / t).toFixed(3), minV: minV | 0, maxLineErr: +err.toFixed(1), rmsLineErr: +Math.sqrt(e2 / Math.max(1, ne)).toFixed(2) };
}

// The music, exported: each song of music.js rendered whole and saved as 16-bit WAV through the dev server
// (racer/wip/shots/music_<name>.png - the PNG name is the server's; it is a WAV), then encoded with ffmpeg to
// assets/music/<name>.ogg (Opus) and .m4a (AAC). The game streams those files instead of synthesising at runtime.
export async function exportMusic() {
  const m = await import('./music.js');
  const done = [];
  for (let si = 0; si < m.SONG_COUNT; si++) {
    const segs = [];
    for (let k = 0; k < m.SEGMENTS; k++) segs.push(await m.renderSegment(si, k));
    const sr = segs[0].sampleRate, n = segs.reduce((a, b) => a + b.length, 0);
    const buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
    let o = 44;
    for (const b of segs) {
      const L = b.getChannelData(0), R = b.getChannelData(1);
      for (let i = 0; i < b.length; i++) {
        for (const x of [L[i], R[i]]) {          // TPDF dither, then 16 bits
          const d = (Math.random() - Math.random()) / 32768;
          v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round((x + d) * 32767))), true); o += 2;
        }
      }
    }
    const name = 'music_' + m.SONG_NAMES[si].toLowerCase().replace(/[^a-z0-9]+/g, '_');
    await fetch('/shot/' + name, { method: 'POST', body: buf });
    done.push([name, +(n / sr).toFixed(1)]);
  }
  return done;
}
