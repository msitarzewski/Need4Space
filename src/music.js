// The race music: three original tracks composed here and rendered into buffers (OfflineAudioContext, on the audio
// thread) - no samples, no licensed music. They play as a playlist, one after another.
//  1. Ring Runner  - 144 BPM, A minor (Am F C G): four-to-the-floor, claps, a rolling 16th bass, a square arpeggio
//  2. Nebula Drift - 128 BPM, D minor (Dm Bb F C): progressive, an offbeat bass, a saw arpeggio in threes, long lines
//  3. Hyperlane    - 160 BPM, E minor (Em C G D): breakbeat drums, a sustained detuned "reese" bass, punchy stabs
// Each is 64 bars: intro (0-8), groove (8-24), build (24-32), drop (32-48), breakdown (48-56), rebuild (56-64), its
// last bars fading out into the next one's intro. Supersaw pads, a lead in the drop, risers and crashes at the section
// changes; the pads, bass and arp duck under every kick.
// Rendered in eight 8-bar segments (the first alone, so the music starts within seconds, the rest in parallel), each
// with 8 s of the music before it rendered and dropped - everything still sounding at its start (pads, tails, the
// delay, the compressor) is there, and every random number is seeded by time, so the segments join sample-exact. The
// tempos make a segment a whole number of samples at 44.1 and 48 kHz, so they chain without a gap.
export const SEG_BARS = 8, SEGMENTS = 8;
const BARS = SEG_BARS * SEGMENTS;
const PRE = 8;                                                  // seconds of lead-in rendered before each segment
const hash = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const within = (bar, ranges) => ranges.some(([a, b]) => bar >= a && bar < b);

// the arrangement every song shares (bars)
const KICK = [[8, 30], [32, 48], [56, 64]], BACK = [[12, 30], [32, 48], [58, 64]], HATS = [[8, 48], [56, 64]];
const OPEN = [[16, 30], [32, 48], [60, 64]], BASS_ON = [[8, 48], [56, 64]], ARP_ON = [[4, 48], [56, 64]];

// A song: tempo, four chords (two bars each) and their bass roots, the lead's 8-bar round (beat, length, note), the
// bass's 16ths (R root, O octave, F fifth, - rest), the arpeggio's chord tones, drum steps and the sound of it all.
const SONGS = [
  {
    name: 'Ring Runner', bpm: 144, gain: 0.66,
    chords: [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]], roots: [33, 29, 36, 31],
    lead: [
      [0, 1.5, 69], [1.5, 0.5, 72], [2, 1, 76], [3, 1, 74], [4, 1, 72], [5, 1, 69], [6, 2, 72],
      [8, 1.5, 72], [9.5, 0.5, 77], [10, 1, 76], [11, 1, 72], [12, 2, 69], [14, 1, 72], [15, 1, 74],
      [16, 1.5, 76], [17.5, 0.5, 79], [18, 1, 76], [19, 1, 74], [20, 1, 72], [21, 1, 74], [22, 2, 76],
      [24, 1.5, 74], [25.5, 0.5, 71], [26, 1, 67], [27, 1, 71], [28, 3, 74], [31, 1, 76],
    ],
    bass: '-RRO-RRR-ROR-RRF', sustain: false, bassCut: 320, bassDetune: 9, bassQ: 5,
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 3, 2, 1, 2], arpWave: 'square', arpLevel: 0.085,
    kick: [0, 4, 8, 12], back: 'clap', backSteps: [4, 12], open: [2, 6, 10, 14],
    hatV: [0.45, 0.22, 0.8, 0.28, 0.5, 0.22, 0.8, 0.3, 0.45, 0.22, 0.8, 0.28, 0.55, 0.25, 0.85, 0.35],
    padCut: 1, padLevel: 1, leadCut: 1,
  },
  {
    name: 'Nebula Drift', bpm: 128, gain: 0.78,
    chords: [[50, 53, 57, 62], [46, 50, 53, 58], [53, 57, 60, 65], [48, 52, 55, 60]], roots: [38, 34, 41, 36],
    lead: [
      [0, 2, 74], [2, 1, 72], [3, 1, 69], [4, 3, 74], [7, 1, 76],
      [8, 2, 77], [10, 1, 74], [11, 1, 72], [12, 4, 70],
      [16, 2, 72], [18, 1, 74], [19, 1, 77], [20, 3, 76], [23, 1, 72],
      [24, 2, 76], [26, 2, 74], [28, 4, 72],
    ],
    bass: '--R---R---R---O-', sustain: false, bassCut: 380, bassDetune: 12, bassQ: 4,
    arp: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 3], arpWave: 'sawtooth', arpLevel: 0.075,
    kick: [0, 4, 8, 12], back: 'clap', backSteps: [4, 12], open: [2, 6, 10, 14],
    hatV: [0.3, 0.12, 0.6, 0.18, 0.35, 0.12, 0.6, 0.2, 0.3, 0.12, 0.6, 0.18, 0.4, 0.15, 0.65, 0.22],
    padCut: 1.25, padLevel: 1.2, leadCut: 0.85,
  },
  {
    name: 'Hyperlane', bpm: 160, gain: 0.74,
    chords: [[52, 55, 59, 64], [48, 52, 55, 60], [55, 59, 62, 67], [50, 54, 57, 62]], roots: [28, 24, 31, 26],
    lead: [
      [0, 0.75, 76], [0.75, 0.75, 79], [1.5, 0.5, 83], [2, 1.5, 81], [3.5, 0.5, 79], [4, 1, 76], [5, 1, 74], [6, 2, 76],
      [8, 0.75, 76], [8.75, 0.75, 79], [9.5, 0.5, 84], [10, 2, 83], [12, 1, 79], [13, 1, 76], [14, 2, 79],
      [16, 0.75, 79], [16.75, 0.75, 83], [17.5, 0.5, 86], [18, 1.5, 83], [19.5, 0.5, 81], [20, 2, 79], [22, 2, 83],
      [24, 0.75, 81], [24.75, 0.75, 78], [25.5, 0.5, 74], [26, 2, 78], [28, 2, 81], [30, 2, 78],
    ],
    bass: 'R-------R-----O-', sustain: true, bassCut: 240, bassDetune: 22, bassQ: 2,
    arp: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 2, 1, 0, 1], arpWave: 'square', arpLevel: 0.065,
    kick: [0, 10], back: 'snare', backSteps: [4, 12], open: [14],
    hatV: [0.6, 0.15, 0.5, 0.2, 0.6, 0.15, 0.5, 0.25, 0.6, 0.15, 0.5, 0.2, 0.6, 0.2, 0.55, 0.3],
    padCut: 0.8, padLevel: 0.9, leadCut: 1.15,
  },
];
export const SONG_COUNT = SONGS.length;
export const SONG_NAMES = SONGS.map((s) => s.name);

function impulse(c, seconds, decay) {
  const n = Math.floor(seconds * c.sampleRate), b = c.createBuffer(2, n, c.sampleRate), rnd = seeded(77);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      y = y * 0.55 + (rnd() * 2 - 1) * 0.45;                         // a darker tail
      d[i] = y * Math.exp(-i / (c.sampleRate * decay)) * Math.min(1, i / (c.sampleRate * 0.008));
    }
  }
  return b;
}

// song si's segment k (bars 8k .. 8k + 8) as its own buffer
export async function renderSegment(si, k, sr = 48000) {
  const S = SONGS[si], BEAT = 60 / S.bpm, S16 = BEAT / 4, BAR = BEAT * 4, SEG_DUR = SEG_BARS * BAR;
  const chordOf = (bar) => Math.floor(bar / 2) % 4;
  const segStart = k * SEG_DUR, w0 = Math.max(0, segStart - PRE), w1 = segStart + SEG_DUR;
  const pre = Math.round((segStart - w0) * sr), len = Math.round(SEG_DUR * sr);
  const c = new OfflineAudioContext(2, pre + len, sr);
  // only what starts inside the window, in its own time (seconds from the window's start)
  const at = (t) => (t >= w0 - 1e-6 && t < w1 ? t - w0 : null);
  const noise = c.createBuffer(1, sr * 2, sr), nd = noise.getChannelData(0), rnd = seeded(1234);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
  const gain = (v, ...to) => { const g = c.createGain(); g.gain.value = v; for (const t of to) g.connect(t); return g; };
  const filter = (type, f, q = 0.7) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const noiseAt = (t, dur) => { const s = c.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t, hash(t + w0 + dur) * 1.5); s.stop(t + dur); return s; };

  // ---- the mix: master -> glue compressor; a plate-ish reverb and a 3/16 delay as sends; a kick-keyed duck
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3.5; comp.knee.value = 8; comp.attack.value = 0.006; comp.release.value = 0.14;
  comp.connect(c.destination);
  const out = gain(S.gain, comp);
  const rev = c.createConvolver(); rev.buffer = impulse(c, 2.8, 0.6);
  rev.connect(gain(0.3, out));
  const dl = c.createDelay(2); dl.delayTime.value = S16 * 3;
  const dlf = filter('lowpass', 2600), fb = gain(0.36);
  dl.connect(dlf); dlf.connect(fb); fb.connect(dl);
  dlf.connect(gain(0.32, out, rev));
  const duck = gain(1, out);
  const drums = gain(1, out), kickBus = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
  kickBus.curve = curve;
  kickBus.connect(gain(0.85, drums));
  const revSend = gain(1, rev), dlSend = gain(1, dl);

  // ---- drums
  const kick = (t) => {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.075); o.frequency.exponentialRampToValueAtTime(41, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.002); g.gain.setTargetAtTime(0, t + 0.07, 0.085);
    o.connect(g).connect(kickBus); o.start(t); o.stop(t + 0.7);
    const n = noiseAt(t, 0.02), hp = filter('highpass', 2500), cg = c.createGain();
    cg.gain.setValueAtTime(0.22, t); cg.gain.setTargetAtTime(0, t + 0.001, 0.003);
    n.connect(hp).connect(cg).connect(drums);
    duck.gain.setTargetAtTime(0.42, t, 0.004); duck.gain.setTargetAtTime(1, t + 0.035, 0.085);
  };
  const clap = (t, v = 1) => {
    const n = noiseAt(t, 0.4), bp = filter('bandpass', 1350, 1.1), g = c.createGain();
    g.gain.setValueAtTime(0, t);
    for (let q = 0; q < 3; q++) { g.gain.setValueAtTime(0.45 * v, t + q * 0.011); g.gain.setTargetAtTime(0, t + q * 0.011 + 0.001, 0.0035); }
    g.gain.setValueAtTime(0.38 * v, t + 0.034); g.gain.setTargetAtTime(0, t + 0.035, 0.055);
    n.connect(bp).connect(g); g.connect(drums); g.connect(gain(0.35, revSend));
  };
  const hat = (t, v, open = false) => {
    const n = noiseAt(t, open ? 0.45 : 0.08), hp = filter('highpass', open ? 6500 : 7800, 0.9), g = c.createGain();
    g.gain.setValueAtTime(v * (open ? 0.12 : 0.15), t); g.gain.setTargetAtTime(0, t + 0.002, open ? 0.07 : 0.013);
    n.connect(hp).connect(g).connect(drums);
    if (open) g.connect(gain(0.15, revSend));
  };
  const snare = (t, v) => {
    const n = noiseAt(t, 0.25), bp = filter('bandpass', 1900, 0.8), g = c.createGain();
    g.gain.setValueAtTime(0.32 * v, t); g.gain.setTargetAtTime(0, t + 0.002, 0.045);
    n.connect(bp).connect(g); g.connect(drums); g.connect(gain(0.25, revSend));
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(195, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    og.gain.setValueAtTime(0.25 * v, t); og.gain.setTargetAtTime(0, t + 0.002, 0.03);
    o.connect(og).connect(drums); o.start(t); o.stop(t + 0.3);
  };
  const crash = (t) => {
    const n = noiseAt(t, 3), hp = filter('highpass', 3800, 0.6), g = c.createGain();
    g.gain.setValueAtTime(0.22, t); g.gain.setTargetAtTime(0, t + 0.01, 0.65);
    n.connect(hp).connect(g); g.connect(drums); g.connect(gain(0.5, revSend));
  };
  const sweep = (t, dur, f0, f1, g0, g1) => {
    const n = noiseAt(t, dur + 0.05), bp = filter('bandpass', f0, 2.5), g = c.createGain();
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(g0, t); g.gain.linearRampToValueAtTime(g1, t + dur); g.gain.setValueAtTime(g1, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    n.connect(bp).connect(g); g.connect(out); g.connect(gain(0.6, revSend));
  };

  // ---- the synths play a voice per note (a free-running oscillator's phase would depend on when the segment's render
  // began, and the seams would not match)
  // bass: two detuned saws through a resonant low-pass and a sine for the weight - a pluck, or held to the next note
  // with the filter opening and closing (the reese)
  const bassOut = gain(0.36, duck);
  const bassNote = (t, m, d, v, cut) => {
    const f = filter('lowpass', cut + 900, S.bassQ), a = c.createGain();
    if (S.sustain) {
      f.frequency.setValueAtTime(cut, t); f.frequency.linearRampToValueAtTime(cut * 3.2, t + d * 0.5); f.frequency.linearRampToValueAtTime(cut * 1.4, t + d);
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(v, t + 0.01); a.gain.setTargetAtTime(0, t + d * 0.94, 0.02);
    } else {
      f.frequency.setValueAtTime(cut + 900, t); f.frequency.setTargetAtTime(cut, t + 0.008, 0.05);
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(v, t + 0.004); a.gain.setTargetAtTime(0, t + d * 0.78, 0.012);
    }
    for (const dt of [-S.bassDetune, S.bassDetune]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = dt; o.connect(f); o.start(t); o.stop(t + d + 0.12); }
    const so = c.createOscillator(); so.frequency.value = hz(m); so.connect(gain(0.65, a)); so.start(t); so.stop(t + d + 0.12);
    f.connect(a); a.connect(bassOut);
  };
  // arp: a pluck
  const arpBus = gain(1, gain(S.arpLevel, duck));
  arpBus.connect(gain(0.05, dlSend)); arpBus.connect(gain(0.04, revSend));
  const arpNote = (t, m, v, open) => {
    const o = c.createOscillator(), f = filter('lowpass', open, 3), a = c.createGain();
    o.type = S.arpWave; o.frequency.value = hz(m);
    f.frequency.setValueAtTime(open, t); f.frequency.setTargetAtTime(open * 0.3, t + 0.01, 0.07);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(v, t + 0.002); a.gain.setTargetAtTime(0, t + 0.012, 0.06);
    o.connect(f).connect(a).connect(arpBus); o.start(t); o.stop(t + 0.4);
  };
  // lead: two saws, a little glide from the note before, vibrato after the attack
  const leadBus = gain(1, gain(0.13, out));
  leadBus.connect(gain(0.08, dlSend)); leadBus.connect(gain(0.1, revSend));
  const leadNote = (t, m, from, d, v, cut) => {
    const f = filter('lowpass', cut * 1.6, 1.2), a = c.createGain(), lfo = c.createOscillator(), vg = c.createGain();
    f.frequency.setValueAtTime(cut * 1.6, t); f.frequency.setTargetAtTime(cut, t + 0.03, 0.12);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(0.9 * v, t + 0.008); a.gain.setTargetAtTime(0.65 * v, t + 0.06, 0.2); a.gain.setTargetAtTime(0, t + d * 0.92, 0.04);
    lfo.frequency.value = 5.4; vg.gain.setValueAtTime(0, t); vg.gain.setTargetAtTime(13, t + 0.22, 0.12); lfo.connect(vg);
    for (const dt of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.detune.value = dt;
      o.frequency.setValueAtTime(hz(from), t); o.frequency.setTargetAtTime(hz(m), t, 0.018);
      vg.connect(o.detune); o.connect(f); o.start(t); o.stop(t + d + 0.35);
    }
    lfo.start(t); lfo.stop(t + d + 0.35);
    f.connect(a).connect(leadBus);
  };

  const kicks = new Set(S.kick), backs = new Set(S.backSteps), opens = new Set(S.open);
  // a held bass note lasts to the next one in the bar (or the bar's end)
  const bassLen = (st) => { let n = 1; while (st + n < 16 && S.bass[st + n] === '-') n++; return n; };
  const bar0 = Math.max(0, Math.floor(w0 / BAR) - 1), bar1 = Math.min(BARS, Math.ceil(w1 / BAR));
  for (let bar = bar0; bar < bar1; bar++) {
    const T0 = bar * BAR, ci = chordOf(bar), chord = S.chords[ci], root = S.roots[ci];
    // build tension: the bass filter opens through the builds
    const build = bar >= 24 && bar < 32 ? (bar - 24) / 8 : bar >= 56 ? (bar - 56) / 8 : 0;
    for (let st = 0; st < 16; st++) {
      const t = at(T0 + st * S16);
      if (t === null) continue;
      if (kicks.has(st) && within(bar, KICK)) kick(t);
      if (backs.has(st) && within(bar, BACK)) { if (S.back === 'snare') snare(t, 1); else clap(t); }
      if (within(bar, HATS) && !(bar >= 30 && bar < 32) && S.hatV[st] > 0) hat(t, S.hatV[st]);
      if (opens.has(st) && within(bar, OPEN)) hat(t, 0.8, true);
      if (within(bar, BASS_ON)) {
        const q = S.bass[st];
        if (q !== '-') bassNote(t, root + (q === 'O' ? 12 : q === 'F' ? 7 : 0), S.sustain ? bassLen(st) * S16 : S16,
          q === 'R' && st % 4 === 1 ? 0.95 : 0.75 + (S.sustain ? 0.1 : 0), S.bassCut * Math.pow(4.2, build + st / 16 / 8));
      }
      if (within(bar, ARP_ON)) {
        const m = chord[S.arp[st]] + 12 + (bar % 2 === 1 && st >= 12 ? 12 : 0);
        arpNote(t, m, st % 4 === 0 ? 1 : 0.7, bar < 8 ? 600 * Math.pow(5.5, (bar - 4 + st / 16) / 4) : bar >= 32 ? 3600 : 3000);
      }
    }
    // pads: a chord every two bars, slow attack and release, darker in the groove, open in the breakdown
    const t0 = at(T0);
    if (bar % 2 === 0 && t0 !== null) {
      const dur = 2 * BAR, cut = S.padCut * (bar < 8 ? 450 * Math.pow(5, bar / 8) : bar >= 48 && bar < 56 ? 3000 : bar >= 32 && bar < 48 ? 2200 : 1500);
      const pf = filter('lowpass', cut, 0.6), pa = c.createGain(), lvl = S.padLevel * (bar >= 48 && bar < 56 ? 0.16 : bar < 8 ? 0.22 : 0.09);
      pa.gain.setValueAtTime(0, t0); pa.gain.setTargetAtTime(lvl, t0, 0.18); pa.gain.setTargetAtTime(0, t0 + dur - 0.05, 0.25);
      pf.connect(pa); pa.connect(duck); pa.connect(gain(0.5, revSend));
      for (const m of [...chord, root + 24]) for (const dt of [-11, 0, 11]) {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = dt + (hash(T0 + m * 0.37 + dt) - 0.5) * 4;
        o.connect(gain(0.16, pf)); o.start(t0); o.stop(t0 + dur + 1.6);
      }
    }
    // the breakdown's sub: whole bars of the root under the pads
    if (bar >= 48 && bar < 56 && t0 !== null) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = hz(root + 12); g.gain.setValueAtTime(0, t0); g.gain.setTargetAtTime(0.28, t0, 0.05); g.gain.setTargetAtTime(0, t0 + BAR - 0.08, 0.04);
      o.connect(g).connect(out); o.start(t0); o.stop(t0 + BAR + 0.3);
    }
  }
  // the lead: two rounds in the drop, one softer and darker in the breakdown
  for (const [start, v, cut] of [[32, 1, 2800], [40, 1, 3200], [48, 0.6, 1500]]) {
    S.lead.forEach(([b, n, m], i) => {
      const t = at(start * BAR + b * BEAT);
      if (t !== null) leadNote(t, m, S.lead[(i + S.lead.length - 1) % S.lead.length][2], n * BEAT, v, cut * S.leadCut);
    });
  }
  // snare rolls into the drop and back into the groove, risers, crashes, a downlifter into the breakdown
  for (const [bar, steps, v0] of [[28, 2, 0.35], [29, 2, 0.45], [30, 1, 0.55], [31, 0.5, 0.7], [62, 1, 0.5], [63, 0.5, 0.7]]) {
    for (let s = 0; s < 16; s += steps) { const t = at(bar * BAR + s * S16); if (t !== null) snare(t, v0 + (s / 16) * 0.3); }
  }
  for (const [b, n, f0, f1, g0, g1] of [[4, 4, 300, 6000, 0, 0.16], [28, 4, 250, 7500, 0, 0.2], [60, 4, 250, 7500, 0, 0.2], [48, 2, 6000, 200, 0.18, 0]]) {
    const t = at(b * BAR);
    if (t !== null) sweep(t, n * BAR, f0, f1, g0, g1);
  }
  for (const bar of [8, 32, 40, 56]) { const t = at(bar * BAR); if (t !== null) crash(t); }
  const full = await c.startRendering();
  const res = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) {
    const d = full.getChannelData(ch).slice(pre, pre + len);
    // the song's end: its last bar and a half fade out into the next song's intro
    if (k === SEGMENTS - 1) {
      const n = Math.round(1.5 * BAR * sr);
      for (let i = 0; i < n; i++) d[len - n + i] *= Math.cos((i / n) * Math.PI / 2) ** 2;
    }
    res.copyToChannel(d, ch);
  }
  return res;
}
