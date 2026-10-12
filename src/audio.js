// The game's sound, all synthesised (no samples) and placed in 3D. The listener rides the camera; every ship, hit,
// pad and passing gantry is a source at its position - quieter and duller with distance (the air takes the highs),
// its pitch bent by the Doppler shift as it closes and passes, panned with HRTF.
//  - the player's ship: turbine whine, jet roar, the anti-grav drone (its pulse quickening with speed), the
//    afterburner's crackle, the airbrakes' hiss, wind; metal screaming on a wall, the barrier's crackle as the ship
//    nears it, a thump on landing
//  - rivals: the nearest five engines, each its own pitch
//  - the world: whooshes under gantries and light gates, echo inside the glass tunnel and the meteorite
//  - the race: countdown beeps, GO, lap chime, finish; menu blips (ui())
//  - music: three songs composed in music.js, exported once to assets/music (Opus / AAC) and streamed as a playlist
// Starts on the first key press or click (browsers block audio before a gesture). M mutes.
import * as THREE from 'three';
// the songs (music.js composes them; profile.js exportMusic() + ffmpeg made the files)
const SONGS = ['ring_runner', 'nebula_drift', 'hyperlane'];
import { TRACK_W } from './track.js';

const MUSIC_LV = { off: 0, low: 0.3, mid: 0.5, high: 0.72 };     // (+2 dB on the first levels: "a bit louder")
const SFX_LV = { low: 0.4, mid: 0.65, high: 0.9 };
const C_SOUND = 700;            // a stylised speed of sound for the Doppler shift (m/s): ships pass at ~300 m/s
const VOICES = 5;               // rival engines heard at once (the nearest)
const ENV_WET = { open: 0.05, tunnel: 0.42, cave: 0.8 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// Recorded hits: Kenney's Impact Sounds and Sci-fi Sounds packs (CC0, assets/sfx) - "the hit sound is really shitty"
// (it was synthesised). Fetched and decoded while the game loads; each play takes a different take from the last one,
// its pitch and level nudged, and each kind of hit is rate-limited ("too many repetitive sound effects").
const SFX_DIR = 'assets/sfx/';
const BANKS = {
  plateHeavy: { n: 'impactPlate_heavy', gain: 0.7 }, metalHeavy: { n: 'impactMetal_heavy', gain: 0.75 },
  metalMedium: { n: 'impactMetal_medium', gain: 0.75 }, plateMedium: { n: 'impactPlate_medium', gain: 1.0 },
  soft: { n: 'impactSoft_heavy', gain: 0.5 }, field: { n: 'forceField', gain: 0.38, offset: 0.12 },
  sciMetal: { n: 'sciMetal', gain: 1.1 }, crunch: { n: 'explosionCrunch', gain: 0.45, takes: [0, 1, 3] },
  boom: { n: 'lowFrequency_explosion', gain: 0.5, offset: 0.13, takes: [0, 1] },
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.levels = { music: 'mid', sfx: 'high' };
    this.decks = null; this.song = 0; this.deck = 0; this.musicIn = null;
    this.L = new THREE.Vector3(); this.camPrev = new THREE.Vector3(); this.camVel = new THREE.Vector3(); this.hasPrev = false;
    this.lastCount = 0; this.passDone = -1; this.env = 'open'; this.airTime = 0; this.frame = {};
    this.gates = {};
    this.loadSfx();
  }

  // the recorded takes: decoded with a throwaway offline context (an AudioBuffer plays in any context)
  loadSfx() {
    this.banks = {};
    let dec = null;
    try { dec = new OfflineAudioContext(1, 1, 48000); } catch { return; }
    for (const [name, B] of Object.entries(BANKS)) {
      const takes = B.takes || [0, 1, 2, 3, 4];
      Promise.all(takes.map((k) => fetch(`${SFX_DIR}${B.n}_00${k}.ogg`).then((r) => r.arrayBuffer()).then((a) => dec.decodeAudioData(a))))
        .then((bufs) => { this.banks[name] = bufs; })
        .catch((e) => console.warn('sfx', name, e));
    }
  }

  // one take from a bank into dst: never the one just played, pitch and level nudged
  take(name, dst, { gain = 1, rate = 1 } = {}) {
    const B = BANKS[name], bufs = this.banks[name];
    if (!bufs?.length) return false;
    let i = Math.floor(Math.random() * bufs.length);
    if (bufs.length > 1 && i === B.last) i = (i + 1 + Math.floor(Math.random() * (bufs.length - 1))) % bufs.length;
    B.last = i;
    const src = this.ctx.createBufferSource(), g = this.gain(B.gain * gain * (0.85 + Math.random() * 0.3));
    src.buffer = bufs[i];
    src.playbackRate.value = rate * (0.93 + Math.random() * 0.14);
    src.connect(g).connect(dst);
    src.start(this.ctx.currentTime, B.offset || 0);
    return true;
  }

  // at most one of a kind every `gap` seconds
  gate(key, gap) {
    const t = this.ctx.currentTime;
    if (t - (this.gates[key] ?? -9) < gap) return false;
    this.gates[key] = t;
    return true;
  }

  // ---------------------------------------------------------------- setup
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.12;
    this.master.connect(lim).connect(c.destination);
    this.sfxBus = this.gain(SFX_LV[this.levels.sfx] ?? 0.9, this.master);
    this.musicBus = this.gain(MUSIC_LV[this.levels.music] ?? 0.36, this.master);
    // echo for enclosed places: a send from everything, its return opened inside
    this.conv = c.createConvolver();
    this.conv.buffer = this.impulse(2.4, 0.55);
    this.envRet = this.gain(ENV_WET.open, this.sfxBus);
    this.conv.connect(this.envRet);
    this.envSend = this.gain(1, this.conv);
    const mk = (fill) => { const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); fill(d); return b; };
    this.white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.pink = mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    });
    this.brown = mk((d) => { let b = 0; for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; } });
    this.buildPlayer();
    this.voices = Array.from({ length: VOICES }, (_, k) => this.buildVoice(k));
    this.musicIn = this.gain(0, this.musicBus);
    this.musicIn.gain.setTargetAtTime(1, c.currentTime + 0.3, 1.0);       // fade in
    this.prepareMusic();
    for (const el of this.decks) c.createMediaElementSource(el).connect(this.musicIn);
    this.decks[this.deck].play().catch((e) => console.warn('music:', e));
  }

  gain(v, ...to) { const g = this.ctx.createGain(); g.gain.value = v; for (const x of to) g.connect(x); return g; }
  filt(type, f, q = 0.7) { const x = this.ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
  osc(type, f, detune = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(); return o; }
  loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.5); return s; }
  impulse(seconds, decay) {
    const c = this.ctx, n = Math.floor(seconds * c.sampleRate), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) { y = y * 0.5 + (Math.random() * 2 - 1) * 0.5; d[i] = y * Math.exp(-i / (c.sampleRate * decay)) * Math.min(1, i / (c.sampleRate * 0.012)); }
    }
    return b;
  }
  panner(ref = 20, roll = 1.1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 20000;
    return p;
  }
  place(p, v, snap = false) {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      if (snap) { p.positionX.setValueAtTime(v.x, t); p.positionY.setValueAtTime(v.y, t); p.positionZ.setValueAtTime(v.z, t); }
      else { p.positionX.setTargetAtTime(v.x, t, 0.012); p.positionY.setTargetAtTime(v.y, t, 0.012); p.positionZ.setTargetAtTime(v.z, t, 0.012); }
    } else p.setPosition(v.x, v.y, v.z);
  }

  // the player's ship: everything into one bus at the ship's position
  buildPlayer() {
    const P = (this.p = {});
    P.pan = this.panner(30, 1);
    P.pan.connect(this.sfxBus);
    P.bus = this.gain(0.72, P.pan);                                  // the ship's own sound, under the music
    P.bus.connect(this.gain(0.3, this.envSend));
    // turbine whine: two detuned saws and the second harmonic through a resonant band
    P.whF = this.filt('bandpass', 900, 5);
    P.osc = [this.osc('sawtooth', 300, -6), this.osc('sawtooth', 300, 6)];
    P.osc.forEach((o) => o.connect(P.whF));
    P.osc2 = this.osc('sine', 600);
    P.osc2.connect(this.gain(0.4, P.whF));
    P.whG = this.gain(0, P.bus);
    P.whF.connect(P.whG);
    // jet roar
    P.roarF = this.filt('lowpass', 300, 0.8);
    P.roarG = this.gain(0, P.bus);
    this.loop(this.pink).connect(P.roarF).connect(P.roarG);
    // the anti-grav drone, pulsing
    P.drone = this.osc('square', 46);
    P.droneF = this.filt('lowpass', 380, 2);
    P.trem = this.gain(0.65);
    P.lfo = this.osc('sine', 8);
    P.lfo.connect(this.gain(0.35, P.trem.gain));
    P.droneG = this.gain(0, P.bus);
    P.drone.connect(P.droneF).connect(P.trem).connect(P.droneG);
    // afterburner: rumbling brown noise, crackling (its level shaken by slow noise), and a high whine
    P.burnF = this.filt('lowpass', 900, 0.7);
    P.crackle = this.gain(0.5);
    this.loop(this.white).connect(this.filt('lowpass', 40, 0.7)).connect(this.gain(6, P.crackle.gain));
    P.burnG = this.gain(0, P.bus);
    this.loop(this.brown).connect(P.burnF).connect(P.crackle).connect(P.burnG);
    P.bwF = this.filt('bandpass', 2400, 6);
    P.bw = this.osc('sawtooth', 900);
    P.bwG = this.gain(0, P.bus);
    P.bw.connect(P.bwF).connect(P.bwG);
    // airbrakes
    P.airG = this.gain(0, P.bus);
    this.loop(this.white).connect(this.filt('highpass', 3000, 0.7)).connect(P.airG);
    // wind and whistle, round the listener (no position)
    P.windF = this.filt('bandpass', 400, 0.7);
    P.windG = this.gain(0, this.sfxBus);
    this.loop(this.pink).connect(P.windF).connect(P.windG);
    P.whistleG = this.gain(0, this.sfxBus);
    this.loop(this.white).connect(this.filt('bandpass', 3300, 9)).connect(P.whistleG);
    // metal on the wall: three resonances of white noise, shaken, at the contact
    P.grindPan = this.panner(12, 1);
    P.grindPan.connect(this.sfxBus);
    P.grindG = this.gain(0, P.grindPan);
    P.grindG.connect(this.gain(0.4, this.envSend));
    const gin = this.gain(1), gam = this.gain(0.5);
    this.loop(this.white).connect(gin);
    for (const [f, q] of [[1650, 14], [2700, 16], [4300, 12]]) gin.connect(this.filt('bandpass', f, q)).connect(gam);
    this.loop(this.white).connect(this.filt('lowpass', 30, 0.7)).connect(this.gain(5, gam.gain));
    gam.connect(this.gain(2.2, P.grindG));
    // the barrier's crackle as the ship nears it
    P.buzzPan = this.panner(10, 1.2);
    P.buzzPan.connect(this.sfxBus);
    P.buzzG = this.gain(0, P.buzzPan);
    const bF = this.filt('bandpass', 700, 1.5), bAM = this.gain(0.5);
    this.osc('sawtooth', 98).connect(bF);
    this.osc('sawtooth', 147.5).connect(bF);
    const am = this.osc('square', 31);
    am.connect(this.gain(0.5, bAM.gain));
    bF.connect(bAM).connect(P.buzzG);
    this.loop(this.white).connect(this.filt('highpass', 5000, 0.7)).connect(this.gain(0.15, P.buzzG));
  }

  // a rival's engine voice: turbine, roar, drone, through a low-pass (distance) into its panner
  buildVoice(k) {
    const V = { pitch: [1, 0.94, 1.06, 0.9, 1.1][k % 5], dop: 1, ent: null };
    V.pan = this.panner(22, 1.15);
    V.pan.connect(this.sfxBus);
    V.g = this.gain(0, V.pan);
    V.g.connect(this.gain(0.3, this.envSend));
    V.lp = this.filt('lowpass', 2000, 0.9);
    V.lp.connect(V.g);
    V.o = [this.osc('sawtooth', 300, -8), this.osc('sawtooth', 300, 8)];
    const of = this.filt('bandpass', 900, 3);
    V.o.forEach((o) => o.connect(of));
    of.connect(this.gain(0.6, V.lp));
    V.roarF = this.filt('lowpass', 600, 0.8);
    this.loop(this.pink).connect(V.roarF).connect(this.gain(0.9, V.lp));
    V.drone = this.osc('square', 48);
    V.drone.connect(this.filt('lowpass', 300, 1.5)).connect(this.gain(0.35, V.lp));
    return V;
  }

  // ---------------------------------------------------------------- settings
  setLevels(music, sfx) {
    if (music) this.levels.music = music;
    if (sfx) this.levels.sfx = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(MUSIC_LV[this.levels.music] ?? 0.36, t, 0.1);
    this.sfxBus.gain.setTargetAtTime((SFX_LV[this.levels.sfx] ?? 0.9) * (this.paused ? 0.15 : 1), t, 0.1);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // The music: the songs streamed from files, one after another (each ends on a fade into the next one's intro). Two
  // audio elements take turns, the next song already loading in the idle one, so they follow without a gap. (They
  // were synthesised in the page at runtime: ~5 s of work per song and pauses in the frames.)
  prepareMusic() {
    if (this.decks) return;
    const probe = document.createElement('audio');
    this.ext = probe.canPlayType('audio/ogg; codecs="opus"') ? 'ogg' : 'm4a';
    this.decks = [0, 1].map(() => { const el = new Audio(); el.preload = 'auto'; return el; });
    this.decks.forEach((el, k) => el.addEventListener('ended', () => this.nextSong(k)));
    this.load(0, this.song);
    this.load(1, (this.song + 1) % SONGS.length);
  }

  load(deck, song) {
    const el = this.decks[deck];
    el.src = `assets/music/${SONGS[song]}.${this.ext}`;
    el.load();
  }

  nextSong(deck) {
    if (deck !== this.deck) return;
    this.song = (this.song + 1) % SONGS.length;
    this.deck ^= 1;
    this.decks[this.deck].play().catch((e) => console.warn('music:', e));
    this.load(deck, (this.song + 1) % SONGS.length);                  // the one after, into the deck just freed
  }

  // ---------------------------------------------------------------- per frame
  update(dt, { camera, ship, ctl, race, track, mode, inp }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime, P = this.p;
    // paused (the menu over the game): the ship and the race fall back, the music plays on
    const paused = !!window.__feather?.paused;
    if (paused !== !!this.paused) { this.paused = paused; this.setLevels(); }
    // the listener rides the camera (its velocity for the Doppler shift; a jump of the camera is not a velocity)
    const L = camera.getWorldPosition(this.L);
    if (this.hasPrev && dt > 0) {
      _w.copy(L).sub(this.camPrev);
      if (_w.length() < 60) this.camVel.lerp(_w.divideScalar(dt), 0.3); else this.camVel.set(0, 0, 0);
    }
    this.camPrev.copy(L); this.hasPrev = true;
    _f.set(0, 0, -1).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const li = c.listener;
    if (li.positionX) {
      li.positionX.setTargetAtTime(L.x, t, 0.01); li.positionY.setTargetAtTime(L.y, t, 0.01); li.positionZ.setTargetAtTime(L.z, t, 0.01);
      li.forwardX.setTargetAtTime(_f.x, t, 0.01); li.forwardY.setTargetAtTime(_f.y, t, 0.01); li.forwardZ.setTargetAtTime(_f.z, t, 0.01);
      li.upX.setTargetAtTime(_u.x, t, 0.01); li.upY.setTargetAtTime(_u.y, t, 0.01); li.upZ.setTargetAtTime(_u.z, t, 0.01);
    } else { li.setPosition(L.x, L.y, L.z); li.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }

    // ---- the player's ship
    const spin = ship.spin, thr = ctl.throttle || 0, bo = ctl.boosting || 0, v = ctl.speed || 0, vn = v / 320;
    const f = 140 + 900 * spin * (0.75 + 0.25 * thr + 0.15 * bo);
    P.osc.forEach((o) => o.frequency.setTargetAtTime(f, t, 0.06));
    P.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.06);
    P.whF.frequency.setTargetAtTime(f * 1.6, t, 0.06);
    P.whG.gain.setTargetAtTime(0.05 * spin * (0.55 + 0.45 * thr), t, 0.06);
    P.roarF.frequency.setTargetAtTime(220 + 1800 * thr * spin + 1500 * bo, t, 0.08);
    P.roarG.gain.setTargetAtTime(spin * (0.04 + 0.3 * thr + 0.25 * bo), t, 0.08);
    P.drone.frequency.setTargetAtTime(44 + 16 * ship.power + v * 0.03, t, 0.1);
    P.lfo.frequency.setTargetAtTime(6 + v * 0.05, t, 0.1);
    P.droneG.gain.setTargetAtTime(0.15 * ship.power * (ship.avionics ?? 1), t, 0.1);
    P.burnG.gain.setTargetAtTime(0.42 * bo * spin, t, 0.04);
    P.burnF.frequency.setTargetAtTime(500 + 900 * bo, t, 0.05);
    P.bw.frequency.setTargetAtTime(f * 2.6, t, 0.06);
    P.bwF.frequency.setTargetAtTime(f * 2.6, t, 0.06);
    P.bwG.gain.setTargetAtTime(0.03 * bo * spin, t, 0.05);
    const ab = ctl.airIn != null ? Math.abs(ctl.airIn) : (inp ? Math.max(inp.airL || 0, inp.airR || 0) : 0);
    P.airG.gain.setTargetAtTime(Math.min(1, ab) * Math.min(1, v / 120) * 0.2, t, 0.05);
    P.windF.frequency.setTargetAtTime(300 + 1500 * vn, t, 0.1);
    P.windG.gain.setTargetAtTime(Math.min(0.3, vn * vn * 0.3), t, 0.1);
    P.whistleG.gain.setTargetAtTime(Math.max(0, vn - 0.5) * 0.05, t, 0.1);
    this.place(P.pan, ship.root.position);
    // on the track: walls, barriers, landing, echo, gantries
    const onTrack = track && mode === 'race' && ctl.s != null;
    let grind = 0, buzz = 0;
    if (onTrack) {
      const fr = track.frame(ctl.s, this.frame), side = Math.sign(ctl.x) || 1;
      if (ctl.grind > 0) {
        grind = Math.min(1, Math.abs(ctl.vs || v) / 180) * 0.55;
        this.place(P.grindPan, _v.copy(fr.P).addScaledVector(fr.R, side * TRACK_W / 2).addScaledVector(fr.U, 1));
      }
      const gap = TRACK_W / 2 - Math.abs(ctl.x) - 5.2;
      buzz = 0.16 * clamp((6 - gap) / 5.5, 0, 1) * clamp(v / 60, 0, 1);
      if (buzz > 0) this.place(P.buzzPan, _v.copy(fr.P).addScaledVector(fr.R, side * TRACK_W / 2).addScaledVector(fr.U, 2.5));
      // landing after a real jump
      const air = ctl.airT || 0;
      if (air > 0.5) this.airTime += dt;
      else if (air <= 0.01) { if (this.airTime > 0.35) this.land(Math.min(1, this.airTime / 1.5)); this.airTime = 0; }
      // inside the tunnel or the meteorite: the echo opens
      const env = track.inCave?.(ctl.s) ? 'cave' : track.inTunnel?.(ctl.s) ? 'tunnel' : 'open';
      if (env !== this.env) { if (env !== 'open') this.whoomp(); this.env = env; }
      // gantries and light gates passing overhead
      this.passes(track, ctl.s, v);
    } else if (this.env !== 'open') this.env = 'open';
    this.envRet.gain.setTargetAtTime(ENV_WET[this.env], t, 0.25);
    P.grindG.gain.setTargetAtTime(grind, t, grind > 0 ? 0.01 : 0.06);
    P.buzzG.gain.setTargetAtTime(buzz, t, 0.05);

    // ---- the rivals' engines: the nearest five
    const ents = race && mode === 'race' ? race.entries.filter((e) => !e.player) : [];
    for (const e of ents) {
      const p = e.ship.root.position;
      e._ad = p.distanceTo(L);
      if (!e._ap) { e._ap = p.clone(); e._av = new THREE.Vector3(); }
      if (dt > 0) { _w.copy(p).sub(e._ap).divideScalar(dt); if (_w.length() < 900) e._av.lerp(_w, 0.35); }
      e._ap.copy(p);
    }
    const near = ents.filter((e) => e._ad < 900 && e.ship.engineOn).sort((a, b) => a._ad - b._ad).slice(0, VOICES);
    for (const V of this.voices) if (V.ent && !near.includes(V.ent)) V.ent = null;
    for (const e of near) {
      if (this.voices.some((V) => V.ent === e)) continue;
      const V = this.voices.find((x) => !x.ent);
      if (!V) continue;
      V.ent = e; V.dop = 1;
      V.g.gain.setValueAtTime(0, t);                                    // a new ship in this voice: from silence
      this.place(V.pan, e.ship.root.position, true);
    }
    for (const V of this.voices) {
      if (!V.ent) { V.g.gain.setTargetAtTime(0, t, 0.08); continue; }
      const e = V.ent, r = e.racer, sh = e.ship, p = sh.root.position;
      _u.copy(L).sub(p);
      const d = Math.max(1, _u.length());
      _u.divideScalar(d);
      // Doppler: the source's speed toward the listener, the listener's toward the source
      const dop = clamp((C_SOUND - this.camVel.dot(_u)) / (C_SOUND - e._av.dot(_u)), 0.55, 1.8);
      V.dop += (dop - V.dop) * 0.3;
      const rf = (140 + 900 * sh.spin * (0.75 + 0.25 * (r.throttle || 0) + 0.15 * (r.boosting || 0))) * V.pitch * V.dop;
      V.o.forEach((o) => o.frequency.setTargetAtTime(rf, t, 0.04));
      V.drone.frequency.setTargetAtTime(48 * V.pitch * V.dop, t, 0.04);
      V.roarF.frequency.setTargetAtTime((300 + 1400 * (r.throttle || 0) + 1200 * (r.boosting || 0)) * V.dop, t, 0.05);
      V.lp.frequency.setTargetAtTime(Math.min(700 + 9000 * Math.exp(-d / 200), 12000), t, 0.05);   // the air takes the highs
      V.g.gain.setTargetAtTime(0.3 * sh.spin * (0.45 + 0.4 * (r.throttle || 0) + 0.3 * (r.boosting || 0)), t, 0.06);
      this.place(V.pan, p);
    }

    // ---- the countdown
    if (race && mode === 'race' && race.state === 'countdown') {
      const n = Math.ceil(race.count);
      if (n !== this.lastCount && n >= 1 && n <= 3) this.beep(660, 0.16, 0.35);
      this.lastCount = n;
    } else this.lastCount = 0;
  }

  // whooshes as the gantries and light gates pass over: started a little before, peaking overhead
  passes(track, s, v) {
    if (!this.passList) {
      const st = track.step;
      this.passList = [...(track.gantryIdx || []).map((i) => ({ s: i * st, h: 14.5 })), ...(track.gates || []).map((g) => ({ s: g.s, h: 20 }))]
        .sort((a, b) => a.s - b.s);
    }
    if (v < 150) return;
    const ahead = v * 0.2, L = track.length;
    for (let k = 0; k < this.passList.length; k++) {
      const g = this.passList[k];
      const d = ((g.s - s) % L + L) % L;
      if (d < ahead && this.passDone !== k) {
        this.passDone = k;
        if (!this.gate('pass', 0.7)) continue;
        const fr = track.frame(g.s, {});
        this.passby(fr.P.clone().addScaledVector(fr.U, g.h), v);
      }
    }
  }

  // ---------------------------------------------------------------- one-shots
  far(pos, max = 1500) { return pos && pos.distanceTo(this.L) > max; }
  // a one-shot's input: positioned (with a send to the echo) or round the listener
  out(pos, ref = 25, level = 1) {
    const g = this.gain(level);
    if (pos) {
      const p = this.panner(ref);
      this.place(p, pos, true);
      g.connect(p); p.connect(this.sfxBus);
      g.connect(this.gain(0.35, this.envSend));
    } else g.connect(this.sfxBus);
    return g;
  }
  burst(t, dur, dst, { type = 'bandpass', f = 1000, f1 = null, q = 0.8, v = 1, tau = null, buf = this.white } = {}) {
    const s = this.ctx.createBufferSource(), x = this.filt(type, f, q), g = this.ctx.createGain();
    s.buffer = buf; s.loop = true;
    if (f1) x.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(v, t);
    if (tau) g.gain.setTargetAtTime(0, t + 0.002, tau); else g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(x).connect(g).connect(dst);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return g;
  }
  tone(t, dur, dst, { type = 'sine', f = 440, f1 = null, v = 1, tau = 0.1, attack = 0.002 } = {}) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + attack); g.gain.setTargetAtTime(0, t + attack, tau);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + dur + tau * 5);
    return o;
  }

  // ship on ship: a heavy plate, a metal clank over it and, when it's hard, a body thud; light contacts between rivals
  // further off are a single smaller hit
  hit(pos, strength, light = false) {
    if (!this.ctx || this.far(pos, light ? 350 : 1200) || !this.gate(light ? 'hitL' : 'hit', light ? 0.18 : 0.09)) return;
    const sv = clamp(strength, 0.05, 1), o = this.out(pos, light ? 15 : 25, 1);
    if (light) { if (!this.take(Math.random() < 0.5 ? 'metalMedium' : 'plateMedium', o, { gain: 0.3 + 0.5 * sv })) this.clang(pos, sv * 0.6); return; }
    if (!this.take('plateHeavy', o, { gain: 0.45 + 0.55 * sv, rate: 1.05 - 0.15 * sv })) { this.clang(pos, sv); return; }
    this.take('metalHeavy', o, { gain: 0.25 + 0.45 * sv, rate: 1.1 - 0.1 * sv });
    if (sv > 0.35) this.take('soft', o, { gain: sv });
  }
  // the energy barrier taking a hit: a force-field zap, a low metal thunk, and a plate when it's hard
  wall(pos, v, player) {
    if (!this.ctx || this.far(pos) || !this.gate(player ? 'wallP' : 'wall', player ? 0.12 : 0.2)) return;
    const sv = clamp(v / 25, 0.15, 1) * (player ? 1 : 0.7), o = this.out(pos, player ? 30 : 20, 1);
    if (!this.take('field', o, { gain: 0.35 + 0.65 * sv, rate: 1.1 - 0.2 * sv })) { this.zap(o, sv); return; }
    this.take('sciMetal', o, { gain: 0.3 + 0.7 * sv });
    if (sv > 0.3) this.take('plateHeavy', o, { gain: 0.6 * sv, rate: 0.95 });
  }
  bump(pos, v) { this.hit(pos, clamp(v / 15, 0.15, 1)); }
  scrape(pos, v) { this.hit(pos, clamp(v / 20, 0.1, 0.8), true); }
  // the player's own knocks (free flight) and landings
  thud(strength) {
    if (!this.ctx || !this.gate('thud', 0.1)) return;
    const sv = clamp(strength, 0, 1), o = this.out(null, 0, 1);
    if (!this.take('soft', o, { gain: 0.3 + 0.7 * sv })) { this.tone(this.ctx.currentTime, 0.6, o, { f: 92, f1: 30, v: sv, tau: 0.16 }); return; }
    this.take('metalMedium', o, { gain: 0.5 * sv });
  }
  land(strength) {
    if (!this.ctx || !this.gate('land', 0.3)) return;
    const o = this.out(null, 0, 1);
    if (!this.take('soft', o, { gain: 0.35 + 0.65 * strength, rate: 0.9 })) { this.tone(this.ctx.currentTime, 0.5, o, { f: 75, f1: 36, v: 0.3 + 0.7 * strength, tau: 0.12 }); return; }
    this.take('sciMetal', o, { gain: 0.25 + 0.5 * strength });
  }
  // (synthesised stand-ins while the takes load)
  clang(pos, strength = 1) {
    if (!this.ctx || this.far(pos)) return;
    const t = this.ctx.currentTime, o = this.out(pos, 18, clamp(strength, 0.05, 1)), f0 = 170 + Math.random() * 170;
    [[1, 0.5, 0.45], [2.76, 0.35, 0.28], [5.4, 0.25, 0.16], [8.93, 0.15, 0.09]].forEach(([k, a, d]) => this.tone(t, d, o, { f: f0 * k, v: a, tau: d / 2.5 }));
    this.burst(t, 0.12, o, { f: 2600, q: 0.9, v: 0.6, tau: 0.03 });
  }
  zap(o, sv) {
    const t = this.ctx.currentTime;
    this.tone(t, 0.3, o, { type: 'sawtooth', f: 1600, f1: 220, v: 0.18 * sv, tau: 0.08 });
    this.tone(t, 0.3, o, { f: 85, f1: 38, v: 0.7 * sv, tau: 0.08 });
  }
  // a boost pad: the player's is a rush round the listener, a rival's is heard where it is
  whoosh() { this.pad(null, true); }
  pad(pos, player = false) {
    if (!this.ctx || this.far(pos, 250) || (!player && !this.gate('padR', 0.8))) return;
    const t = this.ctx.currentTime, o = this.out(player ? null : pos, 25, player ? 1 : 0.45);
    this.burst(t, 0.7, o, { f: 250, f1: 3600, q: 1.4, v: 0.55, buf: this.pink });
    this.tone(t, 0.45, o, { type: 'sawtooth', f: 220, f1: 900, v: 0.06, tau: 0.15, attack: 0.05 });
    this.tone(t, 0.3, o, { f: 70, f1: 45, v: 0.5, tau: 0.08 });
  }
  // a gantry or gate going over at speed: the air it shoves, falling in pitch as it passes
  passby(pos, v) {
    const t = this.ctx.currentTime, k = clamp(v / 320, 0, 1.2), o = this.out(pos, 12, 0.24 * Math.pow(k, 1.3) * (0.75 + Math.random() * 0.5));
    const s = this.ctx.createBufferSource(), x = this.filt('bandpass', 3200, 1.2), g = this.ctx.createGain();
    s.buffer = this.pink; s.loop = true;
    const f0 = 2600 + Math.random() * 1200;
    x.frequency.setValueAtTime(f0, t); x.frequency.exponentialRampToValueAtTime(f0 * (0.12 + Math.random() * 0.06), t + 0.55);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.18); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(x).connect(g).connect(o);
    s.start(t, Math.random()); s.stop(t + 0.65);
  }
  // into the tunnel or the meteorite: the pressure of the air closing in
  whoomp() {
    const t = this.ctx.currentTime, o = this.out(null, 0, 0.5);
    this.tone(t, 0.9, o, { f: 55, f1: 32, v: 0.8, tau: 0.25, attack: 0.04 });
    this.burst(t, 0.8, o, { type: 'lowpass', f: 1500, f1: 150, v: 0.5, buf: this.pink });
  }
  fall(player) {
    if (!this.ctx || !player) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, 0.5);
    this.tone(t, 1.1, o, { f: 1400, f1: 180, v: 0.12, tau: 0.5, attack: 0.05 });
    this.burst(t, 1.2, o, { f: 900, f1: 120, q: 1, v: 0.4, buf: this.pink });
  }
  crash(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, 1);
    if (this.take('crunch', o) && this.take('boom', o)) { this.take('plateHeavy', o, { gain: 0.8, rate: 0.85 }); return; }
    this.tone(t, 1.4, o, { f: 70, f1: 24, v: 1, tau: 0.35 });
    this.burst(t, 1.4, o, { type: 'lowpass', f: 1800, f1: 120, v: 0.9, buf: this.brown });
    this.clang(null, 0.8);
  }

  // ---------------------------------------------------------------- the race and the menus
  beep(f, dur, v = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, v), lp = this.filt('lowpass', 4500, 0.7);
    lp.connect(o);
    this.tone(t, dur, lp, { f, v: 0.8, tau: dur * 0.6 });
    this.tone(t, dur, lp, { type: 'triangle', f: f * 2, v: 0.25, tau: dur * 0.4 });
  }
  bell(t, f, v, dst) {
    [[1, 1, 0.9], [2.4, 0.4, 0.5], [3.9, 0.2, 0.3]].forEach(([k, a, d]) => this.tone(t, d * 2, dst, { f: f * k, v: v * a, tau: d }));
  }
  go() { if (this.ctx) this.beep(1320, 0.6, 0.4); }
  lap() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, 0.35);
    this.bell(t, 880, 0.6, o); this.bell(t + 0.12, 1320, 0.6, o);
  }
  finish() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, 0.4);
    [440, 554.4, 659.3, 880].forEach((f, i) => this.bell(t + i * 0.11, f, 0.55, o));
  }
  ui(kind = 'move') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(null, 0, 0.25);
    if (kind === 'move') this.tone(t, 0.06, o, { type: 'triangle', f: 2200, v: 0.5, tau: 0.018 });
    else if (kind === 'select') { this.tone(t, 0.1, o, { type: 'triangle', f: 1320, v: 0.5, tau: 0.03 }); this.tone(t + 0.06, 0.14, o, { type: 'triangle', f: 1980, v: 0.5, tau: 0.05 }); }
    else if (kind === 'back') { this.tone(t, 0.1, o, { type: 'triangle', f: 1600, v: 0.5, tau: 0.03 }); this.tone(t + 0.06, 0.14, o, { type: 'triangle', f: 1000, v: 0.5, tau: 0.05 }); }
    else if (kind === 'difficulty') {
      this.burst(t, 0.5, o, { f: 400, f1: 4000, q: 1.2, v: 0.5, buf: this.pink });
      [220, 330, 440].forEach((f) => this.tone(t + 0.05, 0.5, o, { type: 'sawtooth', f, v: 0.08, tau: 0.18, attack: 0.02 }));
    }
  }
}

// (the old name, for anything still importing it)
export { GameAudio as EngineAudio };
