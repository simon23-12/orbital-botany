/*  Generativer Weltraum-Soundtrack.
 *
 *  Kein Audiomaterial, alles wird im Browser erzeugt: eine tiefe Drone,
 *  langsam wandernde Akkordflächen, gelegentliche Glockentöne und das
 *  Rauschen der Lüftung. Die Akkordfolge läuft in sehr langsamen Zyklen
 *  und verschiebt sich gegen die Zufallsereignisse — dadurch wiederholt
 *  sich das Ganze praktisch nie.
 */

const A4 = 440;
const note = n => A4 * Math.pow(2, (n - 69) / 12);       // MIDI → Hz

/* Akkordfolgen, in MIDI-Noten. Bewusst modal und schwebend. */
const PROGRESSIONS = [
  { name: 'Terminator', root: 50, chords: [[0, 7, 12, 15, 22], [-4, 3, 8, 12, 19], [-7, 0, 5, 12, 16], [-2, 5, 9, 14, 21]] },
  { name: 'Nachtseite', root: 45, chords: [[0, 7, 12, 16, 19], [5, 12, 17, 21, 24], [-3, 4, 9, 12, 16], [2, 7, 14, 17, 21]] },
  { name: 'Perigäum',  root: 48, chords: [[0, 5, 12, 14, 19], [-5, 2, 7, 12, 16], [-2, 5, 10, 14, 17], [3, 10, 15, 19, 22]] },
  { name: 'Lichtjahre',root: 43, chords: [[0, 7, 12, 19, 23], [4, 11, 16, 19, 26], [-1, 6, 11, 18, 23], [-5, 2, 9, 14, 21]] },
];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 19, 22, 24];

export class Music {
  constructor() {
    this.ctx = null; this.started = false; this.enabled = true;
    this.volume = 0.55; this.extra = 0;
    this.timer = null; this.chordIdx = 0; this.progIdx = 0; this.voices = [];
    this.trackName = '—';
  }

  async start(volume = this.volume) {
    if (this.started) { this.setVolume(volume); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    this.volume = volume;

    /* ── Signalkette: Quellen → Hall/Trocken → Kompressor → Master ── */
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.knee.value = 24; comp.ratio.value = 3.2;
    comp.attack.value = 0.05; comp.release.value = 0.7;
    comp.connect(master); master.connect(ctx.destination);

    const verb = this.verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 7.5, 2.6);
    const wet = this.wet = ctx.createGain(); wet.gain.value = 0.62;
    const dry = this.dry = ctx.createGain(); dry.gain.value = 0.55;
    verb.connect(wet); wet.connect(comp); dry.connect(comp);

    const bus = this.bus = ctx.createGain();
    bus.connect(verb); bus.connect(dry);

    /* ── Drone: zwei sehr tiefe, leicht verstimmte Sägezähne ── */
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.16;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass'; dlp.frequency.value = 220; dlp.Q.value = 0.7;
    this.droneFilter = dlp;
    dlp.connect(this.droneGain); this.droneGain.connect(bus);
    this.droneOscs = [];
    for (const det of [-5, 4, -11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = note(31) * Math.pow(2, det / 1200);
      const g = ctx.createGain(); g.gain.value = 0.33;
      o.connect(g); g.connect(dlp); o.start();
      this.droneOscs.push({ o, g });
    }
    /* langsame Filterbewegung — das „Atmen" der Station */
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.018;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 110;
    lfo.connect(lfoAmt); lfoAmt.connect(dlp.frequency); lfo.start();
    this.lfo = lfo;

    /* ── Lüftungsrauschen ── */
    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoise(ctx, 8); noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass';
    nf.frequency.value = 420; nf.Q.value = 0.45;
    const ng = ctx.createGain(); ng.gain.value = 0.035;
    noise.connect(nf); nf.connect(ng); ng.connect(bus); noise.start();
    this.noise = { noise, nf, ng };
    const nlfo = ctx.createOscillator(); nlfo.frequency.value = 0.037;
    const nAmt = ctx.createGain(); nAmt.gain.value = 180;
    nlfo.connect(nAmt); nAmt.connect(nf.frequency); nlfo.start();
    this.nlfo = nlfo;

    this.started = true;
    this.progIdx = Math.floor(Math.random() * PROGRESSIONS.length);
    this.trackName = PROGRESSIONS[this.progIdx].name;
    this.setVolume(volume);
    this.schedule();
    return this;
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx) return;
    const g = this.enabled ? v * 0.85 : 0;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 1.4);
  }
  setEnabled(on) { this.enabled = on; this.setVolume(this.volume); }
  /** Freigeschaltete Zusatzstimmen (Plattenspieler, Gitarre). */
  setExtra(n) { this.extra = n; }

  /* ── Ein Akkord ── */
  playChord() {
    const ctx = this.ctx; if (!ctx) return;
    const prog = PROGRESSIONS[this.progIdx];
    const chord = prog.chords[this.chordIdx % prog.chords.length];
    const now = ctx.currentTime;
    const dur = 26 + Math.random() * 10;

    for (let i = 0; i < chord.length; i++) {
      const midi = prog.root + chord[i];
      if (i > 2 && Math.random() < 0.35) continue;          // Stimmen ausdünnen
      for (const det of [-6, 7]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = note(midi) * Math.pow(2, det / 1200);
        const g = ctx.createGain();
        const peak = (0.085 / Math.sqrt(chord.length)) * (i === 0 ? 1.5 : 1);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(peak, now + 5 + Math.random() * 4);
        g.gain.setTargetAtTime(0.0001, now + dur * 0.55, dur * 0.32);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 1400; f.Q.value = 0.5;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.7;
        o.connect(g); g.connect(f);
        if (pan) { f.connect(pan); pan.connect(this.bus); } else f.connect(this.bus);
        o.start(now); o.stop(now + dur + 6);
        this.voices.push(o);
      }
    }
    /* Drone folgt dem Grundton */
    const rootHz = note(prog.root - 12);
    for (let k = 0; k < this.droneOscs.length; k++) {
      const { o } = this.droneOscs[k];
      const det = [-5, 4, -11][k];
      o.frequency.setTargetAtTime(rootHz * Math.pow(2, det / 1200), now, 8);
    }
    this.chordIdx++;
    if (this.chordIdx % (prog.chords.length * 2) === 0 && Math.random() < 0.6) {
      this.progIdx = (this.progIdx + 1 + Math.floor(Math.random() * 2)) % PROGRESSIONS.length;
      this.trackName = PROGRESSIONS[this.progIdx].name;
    }
    if (this.voices.length > 80) this.voices.splice(0, 40);
  }

  /* ── Einzelner Glockenton ── */
  playBell(delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const prog = PROGRESSIONS[this.progIdx];
    const midi = prog.root + 12 + PENTA[Math.floor(Math.random() * PENTA.length)];
    const t = ctx.currentTime + delay;
    const f = note(midi);
    const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 2.01;
    const modG = ctx.createGain(); modG.gain.setValueAtTime(f * 1.6, t);
    modG.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
    mod.connect(modG); modG.connect(carrier.frequency);
    const g = ctx.createGain();
    const peak = 0.055 * (0.6 + Math.random() * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5 + Math.random() * 3);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    carrier.connect(g);
    if (pan) { pan.pan.value = (Math.random() * 2 - 1) * 0.85; g.connect(pan); pan.connect(this.bus); }
    else g.connect(this.bus);
    carrier.start(t); mod.start(t);
    carrier.stop(t + 9); mod.stop(t + 9);
  }

  /* ── Zusatzstimme: gezupfte Saite (freigeschaltet) ── */
  playPluck() {
    const ctx = this.ctx; if (!ctx || this.extra < 1) return;
    const prog = PROGRESSIONS[this.progIdx];
    const t = ctx.currentTime;
    const midi = prog.root + PENTA[Math.floor(Math.random() * 6)];
    const f = note(midi);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(320, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(lp); lp.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + 4);
  }

  schedule() {
    if (!this.started) return;
    clearTimeout(this.timer);
    const tick = () => {
      if (!this.ctx) return;
      if (this.enabled) {
        this.playChord();
        const bells = Math.random() < 0.75 ? 1 + Math.floor(Math.random() * 3) : 0;
        for (let i = 0; i < bells; i++) this.playBell(2 + Math.random() * 20);
        if (this.extra > 0 && Math.random() < 0.5) setTimeout(() => this.playPluck(), 3000 + Math.random() * 14000);
      }
      this.timer = setTimeout(tick, 20000 + Math.random() * 12000);
    };
    tick();
  }

  suspend() { this.ctx?.suspend?.(); }
  resume() { this.ctx?.resume?.(); }
}

/* ── Impulsantwort für den Hall: exponentiell abfallendes Rauschen ── */
function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // etwas Vorverzögerung, damit der Raum groß wirkt
      const pre = i < rate * 0.02 ? 0 : 1;
      d[i] = pre * (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

/* ── Rosa Rauschen (Voss-McCartney, vereinfacht) ── */
function pinkNoise(ctx, seconds) {
  const rate = ctx.sampleRate, len = rate * seconds;
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

export const music = new Music();
