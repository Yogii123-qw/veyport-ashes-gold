// audio.js — every sound in Veyport, synthesized live with WebAudio.
//
// No audio files, no network: oscillators + filtered noise + a tiny
// step sequencer. Three buses (sfx / music / ambient) with volumes the
// player can change in settings. The context only starts after a real
// user gesture (a menu click), so browsers never block it.

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let ambBus = null;
  let noiseBuf = null;
  const vols = { master: 0.9, sfx: 0.9, music: 0.55, ambient: 0.5 };
  let musicMode = 'explore'; // explore | tension | mission
  let musicTimer = null;
  let engineNodes = null;
  let rainNodes = null;
  let started = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = vols.master;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = vols.sfx;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = vols.music;
      musicBus.connect(master);
      ambBus = ctx.createGain();
      ambBus.gain.value = vols.ambient;
      ambBus.connect(master);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      started = true;
      startMusic();
      return true;
    } catch {
      return false;
    }
  }

  /** Call from any real user gesture (menu click, key press). */
  function resume() {
    if (!ensure() || ctx.state !== 'suspended') return;
    // Without a real user activation Chrome logs a warning per resume()
    // and refuses anyway; the autostart path in headless has none, so
    // skip it there instead of spamming the console.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    ctx.resume().catch(() => {});
  }

  /**
   * True only when the context exists and is actually running. Starting
   * nodes on a suspended context logs one Chrome warning per node — the
   * music sequencer alone would spam a warning per beat until the first
   * real user gesture resumes the context. So every sound starter
   * checks this first; the sequencer keeps its timer so the music
   * begins the moment the context runs.
   */
  function live() {
    return !!ctx && ctx.state === 'running';
  }

  function setVolume(busName, v) {
    vols[busName] = Math.max(0, Math.min(1, v));
    if (!ctx) return;
    const node = busName === 'master' ? master : busName === 'sfx' ? sfxBus : busName === 'music' ? musicBus : ambBus;
    if (node) node.gain.value = vols[busName];
  }

  function noiseSrc() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }

  function blip(freq, dur, type = 'sine', gain = 0.2, when = 0) {
    if (!live()) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseHit(dur, filterFreq, gain = 0.3, type = 'lowpass', when = 0) {
    if (!live()) return;
    const t0 = ctx.currentTime + when;
    const s = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }

  /** Pan a sound left/right from the camera-relative direction (-1..1). */
  function panNode(pan) {
    if (!ctx.createStereoPanner) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    p.connect(sfxBus);
    return p;
  }

  const RECIPES = {
    // weaponId -> {noiseDur, noiseFreq, thump, crack}
    p9: { dur: 0.12, freq: 2400, gain: 0.5, thump: 130 },
    kr9: { dur: 0.09, freq: 3000, gain: 0.38, thump: 150 },
    iron12: { dur: 0.28, freq: 1400, gain: 0.7, thump: 90 },
    vk7: { dur: 0.16, freq: 1900, gain: 0.6, thump: 110 },
  };

  function gunshot(weaponId, pan = 0) {
    if (!ctx) return;
    const r = RECIPES[weaponId] || RECIPES.p9;
    const out = panNode(pan) || sfxBus;
    const t0 = ctx.currentTime;
    const s = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = r.freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(r.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + r.dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t0); s.stop(t0 + r.dur + 0.02);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(r.thump, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    o.connect(og); og.connect(out);
    o.start(t0); o.stop(t0 + 0.12);
  }

  function play(name, opts = {}) {
    if (!ctx) return;
    const pan = opts.pan || 0;
    switch (name) {
      case 'shot': gunshot(opts.weapon || 'p9', pan); break;
      case 'dry': blip(900, 0.05, 'square', 0.12); break;
      case 'reload': blip(500, 0.05, 'square', 0.12); blip(700, 0.05, 'square', 0.12, 0.12); break;
      case 'melee': noiseHit(0.1, 900, 0.35); break;
      case 'hit': blip(1200, 0.06, 'triangle', 0.25); break;
      case 'kill': blip(700, 0.1, 'triangle', 0.25); blip(500, 0.14, 'triangle', 0.25, 0.08); break;
      case 'crash': noiseHit(0.3, 500, 0.6); blip(70, 0.25, 'sine', 0.5); break;
      case 'explosion':
        noiseHit(0.9, 300, 0.9);
        blip(55, 0.8, 'sine', 0.7);
        blip(40, 1.1, 'sine', 0.5, 0.05);
        break;
      case 'glass': noiseHit(0.18, 5200, 0.4, 'highpass'); break;
      case 'door': noiseHit(0.08, 800, 0.25); blip(180, 0.07, 'square', 0.1); break;
      case 'horn': blip(370, 0.28, 'sawtooth', 0.22); blip(466, 0.28, 'sawtooth', 0.22); break;
      case 'pickup': blip(880, 0.08, 'sine', 0.25); blip(1320, 0.12, 'sine', 0.25, 0.07); break;
      case 'cash': blip(1040, 0.07, 'sine', 0.2); blip(1560, 0.1, 'sine', 0.2, 0.06); break;
      case 'mission': [523, 659, 784].forEach((f, i) => blip(f, 0.16, 'triangle', 0.25, i * 0.1)); break;
      case 'fail': [400, 300, 220].forEach((f, i) => blip(f, 0.18, 'triangle', 0.22, i * 0.12)); break;
      case 'siren-wail': break; // sirens are continuous, see startSiren
      case 'skid': noiseHit(0.25, 1100, 0.2, 'bandpass'); break;
      case 'step': noiseHit(0.05, 400, 0.1); break;
      case 'thunder': noiseHit(1.6, 180, 0.7); blip(48, 1.4, 'sine', 0.5); break;
      case 'click': blip(1000, 0.04, 'square', 0.15); break;
      case 'type': blip(1600 + Math.random() * 400, 0.02, 'square', 0.06); break;
      default: blip(600, 0.08, 'sine', 0.15); break;
    }
  }

  // ---- Continuous: engine hum follows RPM, rain is filtered noise. ----
  function startEngine() {
    if (!live() || engineNodes) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 60;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(sfxBus);
    o.start();
    engineNodes = { o, f, g };
  }

  function setEngine(rpmFrac, engineKind = 'mid') {
    if (!live()) return;
    startEngine();
    const base = { small: 55, mid: 70, sport: 90, v8: 65, diesel: 45, hyper: 110 }[engineKind] || 70;
    const t = ctx.currentTime;
    engineNodes.o.frequency.setTargetAtTime(base + rpmFrac * 160, t, 0.08);
    engineNodes.f.frequency.setTargetAtTime(300 + rpmFrac * 1400, t, 0.1);
    engineNodes.g.gain.setTargetAtTime(rpmFrac > 0.02 ? 0.05 + rpmFrac * 0.09 : 0, t, 0.1);
  }

  function setRain(level) {
    if (!ctx) return;
    if (level <= 0) {
      if (rainNodes) { rainNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); }
      return;
    }
    if (!rainNodes) {
      if (!live()) return;
      const s = noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(ambBus);
      s.start();
      rainNodes = { g };
    }
    rainNodes.g.gain.setTargetAtTime(level === 2 ? 0.3 : 0.16, ctx.currentTime, 0.4);
  }

  // ---- Siren: two-tone, loops while police are close. ----
  let sirenNodes = null;
  function setSiren(on, pan = 0) {
    if (!ctx) return;
    if (!on) {
      if (sirenNodes) {
        sirenNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        const n = sirenNodes;
        window.setTimeout(() => { try { n.o.stop(); } catch { /* already stopped */ } }, 600);
        sirenNodes = null;
      }
      return;
    }
    if (sirenNodes) return;
    if (!live()) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 750;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); o.connect(g); g.connect(p); p.connect(sfxBus); }
    else { o.connect(g); g.connect(sfxBus); }
    o.start();
    lfo.start();
    sirenNodes = { o, lfo, g };
  }

  // ---- Adaptive music: three tiny step-sequencer stems. ----
  const STEMS = {
    explore: { bpm: 92, bass: [55, 0, 65.4, 0, 49, 0, 58.3, 0], pad: [220, 261.6, 329.6], lead: [] },
    tension: { bpm: 120, bass: [55, 55, 65.4, 55, 49, 55, 58.3, 65.4], pad: [220, 207.6], lead: [440, 0, 466, 0, 440, 0, 415, 0] },
    mission: { bpm: 132, bass: [55, 0, 55, 65.4, 55, 0, 73.4, 65.4], pad: [220, 261.6, 329.6, 392], lead: [440, 523, 659, 523, 587, 659, 784, 659] },
  };
  let musicStep = 0;
  function startMusic() {
    if (!ctx || musicTimer) return;
    const tick = () => {
      if (!ctx) return;
      const stem = STEMS[musicMode] || STEMS.explore;
      const beat = 60 / stem.bpm / 2;
      if (!live()) {
        // Keep the timer alive so the music starts on its own the
        // moment a real gesture resumes the context.
        musicTimer = window.setTimeout(tick, beat * 1000);
        return;
      }
      const i = musicStep % 8;
      const bass = stem.bass[i];
      if (bass) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = bass;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.16, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + beat * 1.8);
        o.connect(g); g.connect(musicBus);
        o.start(); o.stop(ctx.currentTime + beat * 1.9);
      }
      if (i === 0 && stem.pad.length) {
        for (const f of stem.pad) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.035, ctx.currentTime);
          g.gain.setTargetAtTime(0.001, ctx.currentTime + beat * 8, beat * 2);
          o.connect(g); g.connect(musicBus);
          o.start(); o.stop(ctx.currentTime + beat * 9);
        }
      }
      const lead = stem.lead[i];
      if (lead) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = lead;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.045, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + beat * 0.9);
        o.connect(g); g.connect(musicBus);
        o.start(); o.stop(ctx.currentTime + beat);
      }
      musicStep += 1;
      musicTimer = window.setTimeout(tick, beat * 1000);
    };
    tick();
  }

  function setMusicMode(mode) {
    if (STEMS[mode]) musicMode = mode;
  }

  function update(dt, ctxState) {
    if (!ctx) return;
    // Engine follows the player's car; rain follows the weather; the
    // siren follows the nearest police unit. All continuous, all real.
    if (ctxState) {
      setEngine(ctxState.rpmFrac || 0, ctxState.engineKind || 'mid');
      setRain(ctxState.rainLevel || 0);
      setSiren(!!ctxState.siren, ctxState.sirenPan || 0);
      const want = ctxState.inMission ? 'mission' : ctxState.wanted >= 2 ? 'tension' : 'explore';
      if (want !== musicMode) setMusicMode(want);
    }
  }

  return {
    resume,
    play,
    setVolume,
    setMusicMode,
    setEngine,
    setRain,
    setSiren,
    update,
    get ready() { return started && !!ctx; },
    get mode() { return musicMode; },
  };
}
