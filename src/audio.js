// audio.js - all Veyport sound is synthesized in WebAudio at runtime.
// No audio files, no network. Engine hum follows RPM, each weapon has its
// own gunshot recipe, the siren is a two-tone wail, rain is filtered
// noise, and a small step sequencer plays three adaptive music stems
// (explore / tension / mission). Everything is guarded: if the browser
// refuses audio, the game stays silent and never throws.

const SHOT_RECIPES = {
  pistol: { noise: 0.09, bp: 1600, q: 1.2, thump: 0.12, thumpHz: 120, gain: 0.5 },
  smg: { noise: 0.06, bp: 2100, q: 1.0, thump: 0.08, thumpHz: 150, gain: 0.38 },
  scattergun: { noise: 0.16, bp: 700, q: 0.8, thump: 0.2, thumpHz: 70, gain: 0.65 },
  rifle: { noise: 0.12, bp: 1100, q: 1.4, thump: 0.15, thumpHz: 95, gain: 0.55 },
  melee: { noise: 0.05, bp: 500, q: 1.0, thump: 0.05, thumpHz: 200, gain: 0.2 },
};

// Adaptive music: three 8-step bass patterns, one per mood.
const MUSIC_PATTERNS = {
  explore: [55, 0, 65.4, 0, 49, 0, 58.3, 0],
  tension: [55, 55, 58.3, 55, 65.4, 58.3, 55, 49],
  mission: [55, 65.4, 82.4, 65.4, 73.4, 82.4, 98, 82.4],
};

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this.master = 0.8;
    this.musicLevel = 0.5;
    this.sfxLevel = 0.8;
    this.ambientLevel = 0.6;
    this.muted = false;
    this.engine = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.rainSrc = null;
    this.rainGain = null;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.musicMode = 'explore';
    this.shotsFired = 0;
    this.noiseBuf = null;
    try {
      const saved = JSON.parse(localStorage.getItem('veyport-r4-audio') || '{}');
      if (typeof saved.master === 'number') this.master = saved.master;
      if (typeof saved.music === 'number') this.musicLevel = saved.music;
      if (typeof saved.sfx === 'number') this.sfxLevel = saved.sfx;
    } catch (e) { /* no saved audio settings */ }
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (this.ok) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.master;
      this.masterGain.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxLevel;
      this.sfxBus.connect(this.masterGain);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicLevel * 0.35;
      this.musicBus.connect(this.masterGain);
      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = this.ambientLevel * 0.25;
      this.ambBus.connect(this.masterGain);
      // Shared white-noise buffer for all noise-based sounds.
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._startEngine();
      this._startRain();
      this.ok = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  _startEngine() {
    const c = this.ctx;
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc.start();
  }

  _startRain() {
    const c = this.ctx;
    this.rainSrc = c.createBufferSource();
    this.rainSrc.buffer = this.noiseBuf;
    this.rainSrc.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.4;
    this.rainGain = c.createGain();
    this.rainGain.gain.value = 0;
    this.rainSrc.connect(f);
    f.connect(this.rainGain);
    this.rainGain.connect(this.ambBus);
    this.rainSrc.start();
  }

  // Engine pitch follows speed 0..1 (0 = idle, 1 = top speed).
  setEngine(rpm01, throttle) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const f = 52 + rpm01 * 165 + throttle * 12;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(380 + rpm01 * 900, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.02 + rpm01 * 0.05 + throttle * 0.02, t, 0.08);
  }

  setRain(amount) {
    if (!this.ok) return;
    this.rainGain.gain.setTargetAtTime(amount * 0.5, this.ctx.currentTime, 0.5);
  }

  // One gunshot, from the weapon kind recipe. Pan -1..1 by relative angle.
  shot(kind, pan = 0) {
    if (!this.ok) return;
    this.shotsFired += 1;
    const c = this.ctx;
    const r = SHOT_RECIPES[kind] || SHOT_RECIPES.pistol;
    const t = c.currentTime;
    const panNode = c.createStereoPanner ? c.createStereoPanner() : null;
    if (panNode) {
      panNode.pan.value = Math.max(-1, Math.min(1, pan));
      panNode.connect(this.sfxBus);
    }
    const out = panNode || this.sfxBus;
    // Noise crack through a bandpass.
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = r.bp;
    bp.Q.value = r.q;
    const g = c.createGain();
    g.gain.setValueAtTime(r.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + r.noise);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5, r.noise + 0.02);
    // Low thump.
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(r.thumpHz, t);
    o.frequency.exponentialRampToValueAtTime(38, t + r.thump);
    const og = c.createGain();
    og.gain.setValueAtTime(r.gain * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + r.thump);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + r.thump + 0.02);
  }

  // Short click for dry fire / UI.
  click(freq = 1200) {
    if (!this.ok) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
    o.connect(g); g.connect(this.sfxBus);
    o.start(); o.stop(c.currentTime + 0.06);
  }

  hitmarker(kill) {
    if (!this.ok) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = kill ? 1900 : 1500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.07);
    o.connect(g); g.connect(this.sfxBus);
    o.start(); o.stop(c.currentTime + 0.08);
  }

  explosion(pan = 0) {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    src.start(t, 0, 1.0);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = c.createGain();
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.85);
  }

  crash(strength) {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = c.createGain();
    const v = Math.min(0.7, strength * 0.05);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random() * 0.4, 0.3);
  }

  glass() {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.8;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random() * 0.4, 0.4);
  }

  setSiren(on) {
    if (!this.ok) return;
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (on && !this.sirenOsc) {
      const c = this.ctx;
      this.sirenOsc = c.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = c.createGain();
      this.sirenGain.gain.value = 0.05;
      this.sirenLfo = c.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.55;
      this.sirenLfoGain = c.createGain();
      this.sirenLfoGain.gain.value = 180;
      this.sirenLfo.connect(this.sirenLfoGain);
      this.sirenLfoGain.connect(this.sirenOsc.frequency);
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.sfxBus);
      this.sirenOsc.start();
      this.sirenLfo.start();
    } else if (!on && this.sirenOsc) {
      try {
        this.sirenOsc.stop();
        this.sirenLfo.stop();
      } catch (e) { /* already stopped */ }
      this.sirenOsc = null;
      this.sirenLfo = null;
      this.sirenGain = null;
    }
  }

  // Adaptive music sequencer: one bass note per step, 4 steps per second.
  // The mode follows the game: explore, tension (wanted >= 2), mission.
  setMusicMode(mode) {
    if (MUSIC_PATTERNS[mode]) this.musicMode = mode;
  }

  update(dt) {
    if (!this.ok) return;
    this.musicTimer += dt;
    const stepDur = 0.28;
    while (this.musicTimer >= stepDur) {
      this.musicTimer -= stepDur;
      const pat = MUSIC_PATTERNS[this.musicMode];
      const note = pat[this.musicStep % pat.length];
      this.musicStep += 1;
      if (note > 0) this._pluck(note);
    }
  }

  _pluck(freq) {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.05, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.musicBus);
    o2.connect(g2); g2.connect(this.musicBus);
    o.start(t); o.stop(t + 0.55);
    o2.start(t); o2.stop(t + 0.35);
  }

  setMaster(v) {
    this.master = Math.max(0, Math.min(1, v));
    if (this.ok) this.masterGain.gain.value = this.muted ? 0 : this.master;
    this._persist();
  }

  setMusic(v) {
    this.musicLevel = Math.max(0, Math.min(1, v));
    if (this.ok) this.musicBus.gain.value = this.musicLevel * 0.35;
    this._persist();
  }

  setSfx(v) {
    this.sfxLevel = Math.max(0, Math.min(1, v));
    if (this.ok) this.sfxBus.gain.value = this.sfxLevel;
    this._persist();
  }

  _persist() {
    try {
      localStorage.setItem('veyport-r4-audio', JSON.stringify({
        master: this.master, music: this.musicLevel, sfx: this.sfxLevel,
      }));
    } catch (e) { /* storage unavailable */ }
  }
}
