/*  Kurze Geräusche, ebenfalls synthetisch. */

class Sfx {
  constructor() { this.ctx = null; this.gain = null; this.enabled = true; this.volume = 0.6; }
  attach(ctx) {
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    this.gain.connect(lp); lp.connect(ctx.destination);
  }
  set(on, vol) {
    this.enabled = on;
    if (vol != null) this.volume = vol;
    if (this.gain) this.gain.gain.value = this.enabled ? this.volume : 0;
  }
  _env(t, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  }
  tone(freq, { type = 'sine', a = 0.006, d = 0.18, peak = 0.22, slide = 0, delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + a + d);
    const g = this._env(t, a, d, peak);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + a + d + 0.1);
  }
  noise(dur = 0.3, { freq = 900, q = 1.2, peak = 0.16, type = 'bandpass', sweep = 1 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    const g = this._env(t, 0.01, dur, peak);
    src.connect(f); f.connect(g); g.connect(this.gain);
    src.start(t);
  }

  click()    { this.tone(1900, { type: 'square', a: .002, d: .035, peak: .045 }); }
  hover()    { this.tone(2600, { a: .002, d: .028, peak: .022 }); }
  open()     { this.tone(420, { type: 'triangle', a: .006, d: .22, peak: .1, slide: 1.6 }); }
  close()    { this.tone(520, { type: 'triangle', a: .006, d: .2, peak: .08, slide: .62 }); }
  water()    { this.noise(.5, { freq: 1500, q: .7, peak: .1, sweep: .35 }); this.tone(300, { type: 'sine', a: .02, d: .4, peak: .05, slide: .7 }); }
  sow()      { this.noise(.22, { freq: 2600, q: 2, peak: .07, sweep: .5 }); }
  harvest()  { [0, .07, .14].forEach((d, i) => this.tone([523, 659, 784][i], { type: 'sine', a: .004, d: .5, peak: .12, delay: d })); }
  levelup()  { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { type: 'triangle', a: .006, d: .7, peak: .1, delay: i * .1 })); }
  mail()     { this.tone(1320, { a: .004, d: .3, peak: .09 }); this.tone(1760, { a: .004, d: .4, peak: .06, delay: .1 }); }
  dock()     { this.noise(1.1, { freq: 180, q: .5, peak: .14, type: 'lowpass', sweep: .5 }); this.tone(74, { type: 'sine', a: .05, d: 1.2, peak: .15 }); }
  error()    { this.tone(190, { type: 'sawtooth', a: .005, d: .22, peak: .08, slide: .75 }); }
  research() { [392, 523, 622].forEach((f, i) => this.tone(f, { type: 'sine', a: .01, d: .9, peak: .08, delay: i * .16 })); }
  whoosh()   { this.noise(.7, { freq: 700, q: .4, peak: .07, sweep: .25 }); }
}

export const sfx = new Sfx();
