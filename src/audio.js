// Sound, synthesized live: no audio files, no network. Oscillators and
// filtered noise make engines, gunshots, sirens, rain and thunder; a
// step sequencer plays three adaptive music stems from note data. Every
// call is safe before the audio context exists (browsers require a user
// gesture first) and safe when audio is unavailable.

import { ENGINE_PROFILES, MUSIC, SFX_RECIPES } from '../data/audioData.js';
import { clamp } from './utils.js';

export function createAudio(game) {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let ambientBus = null;
  let noiseBuffer = null;
  let musicTimer = null;
  let nextStepTime = 0;
  let stepIndex = 0;
  let musicMode = 'explore';
  let stemGains = { bass: 0.5, pad: 0.3, arp: 0, drums: 0.5 };
  let targetStems = { ...stemGains };
  let rainNode = null;
  let rainGain = null;
  let ambientNode = null;
  const engineVoices = new Map();
  let sirenVoice = null;
  let skidVoice = null;
  // Play counters: incremented only when nodes are actually scheduled,
  // so playtests can assert a sound really fired (never a fake count).
  let sfxCount = 0;
  const sfxCounts = {};

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.connect(master);
      ambientBus = ctx.createGain();
      ambientBus.connect(master);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      applyVolumes();
      startAmbient();
      startMusic();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function applyVolumes() {
    if (!ctx) return;
    const s = game.settings;
    master.gain.value = (s.master / 100) * (s.master / 100);
    sfxBus.gain.value = s.sfx / 100;
    musicBus.gain.value = s.music / 100;
    ambientBus.gain.value = s.ambient / 100;
  }

  function panAndGain(x, z) {
    if (x === undefined || !game.player) return { pan: 0, gain: 1 };
    const dx = x - game.player.x;
    const dz = z - game.player.z;
    const d = Math.hypot(dx, dz);
    if (d > 140) return { pan: 0, gain: 0 };
    const angle = Math.atan2(dx, dz) - game.cameraRig.yaw;
    return { pan: clamp(Math.sin(angle), -1, 1) * 0.8, gain: 1 / (1 + d / 28) };
  }

  function noiseBurst(when, duration, filterHz, gainValue, pan, bus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(bus);
    src.start(when);
    src.stop(when + duration + 0.05);
  }

  function thump(when, duration, startHz, gainValue, pan, bus) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, startHz * 0.35), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(bus);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  function tone(when, freq, duration, gainValue, type, bus) {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  function playSfx(name, x, z) {
    if (!ctx || ctx.state !== 'running') return;
    const recipe = SFX_RECIPES[name];
    if (!recipe) return;
    try {
      const { pan, gain } = panAndGain(x, z);
      if (gain <= 0) return;
      const when = ctx.currentTime + 0.005;
      const g = (recipe.gain || 0.4) * gain;
      sfxCount += 1;
      sfxCounts[name] = (sfxCounts[name] || 0) + 1;
      if (recipe.tones) {
        recipe.tones.forEach((freq, i) => tone(when + i * 0.07, freq, recipe.dur / recipe.tones.length + 0.06, g, 'triangle', sfxBus));
        return;
      }
      if (recipe.clicks) {
        recipe.clicks.forEach((t) => noiseBurst(when + t, 0.03, 3200, g, pan, sfxBus));
        return;
      }
      if (recipe.noise) noiseBurst(when, recipe.noise, recipe.noiseHz, g, pan, sfxBus);
      if (recipe.thump) thump(when, recipe.thump, recipe.thumpHz, g * 0.9, pan, sfxBus);
    } catch { /* Audio must never break the game. */ }
  }

  function startAmbient() {
    // City hum: a low detuned pair, always under everything.
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 55;
    const oscB = ctx.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.value = 55.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ambientBus);
    oscA.start();
    oscB.start();
    ambientNode = { oscA, oscB, gain };
    // Rain bed: looped noise through a lowpass, gain driven by weather.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    src.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(ambientBus);
    src.start();
    rainNode = src;
  }

  function midiToFreq(semitones) {
    return 110 * Math.pow(2, semitones / 12);
  }

  function scheduleStep(step, when) {
    const pattern = MUSIC[musicMode];
    const bassNote = pattern.bass[step % 8];
    if (bassNote !== null && bassNote !== undefined) {
      tone(when, midiToFreq(bassNote), 0.3, 0.32 * stemGains.bass, 'triangle', musicBus);
    }
    const arpNote = pattern.arp[step % 8];
    if (arpNote !== null && arpNote !== undefined && stemGains.arp > 0.05) {
      tone(when, midiToFreq(arpNote), 0.16, 0.16 * stemGains.arp, 'square', musicBus);
    }
    if (step % 8 === 0) {
      const chord = pattern.pad;
      for (const note of chord) {
        tone(when, midiToFreq(note + 12), 2.4, 0.05 * stemGains.pad, 'sawtooth', musicBus);
      }
    }
    if (pattern.drums[step % 8]) {
      thump(when, 0.12, 110, 0.5 * stemGains.drums, 0, musicBus);
      noiseBurst(when + 0.14, 0.04, 7000, 0.1 * stemGains.drums, 0, musicBus);
    }
  }

  function startMusic() {
    if (musicTimer) return;
    nextStepTime = ctx.currentTime + 0.1;
    const stepDur = 60 / MUSIC.bpm / 2;
    musicTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      // Crossfade stems toward the current mode's mix.
      for (const key of Object.keys(stemGains)) {
        stemGains[key] += (targetStems[key] - stemGains[key]) * 0.25;
      }
      while (nextStepTime < ctx.currentTime + 0.35) {
        scheduleStep(stepIndex, nextStepTime);
        stepIndex += 1;
        nextStepTime += stepDur;
      }
    }, 100);
  }

  const STEM_MIX = {
    explore: { bass: 0.6, pad: 0.5, arp: 0, drums: 0.35 },
    tension: { bass: 0.8, pad: 0.4, arp: 0.55, drums: 0.7 },
    mission: { bass: 1, pad: 0.35, arp: 0.9, drums: 1 },
  };

  function setMusicMode(mode) {
    if (STEM_MIX[mode]) {
      musicMode = mode;
      targetStems = { ...STEM_MIX[mode] };
    }
  }

  function createEngineVoice(profileName) {
    if (!ctx) return null;
    const profile = ENGINE_PROFILES[profileName] || ENGINE_PROFILES.mid;
    const osc = ctx.createOscillator();
    osc.type = profile.wave;
    osc.frequency.value = profile.base;
    const osc2 = ctx.createOscillator();
    osc2.type = profile.wave;
    osc2.frequency.value = profile.base * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(sfxBus);
    osc.start();
    osc2.start();
    return {
      profile,
      set(rpmFrac, x, z, audible) {
        if (!ctx) return;
        const when = ctx.currentTime;
        const freq = profile.base + rpmFrac * (profile.top - profile.base);
        osc.frequency.setTargetAtTime(freq, when, 0.06);
        osc2.frequency.setTargetAtTime(freq * 0.5, when, 0.06);
        const { pan, gain: distGain } = panAndGain(x, z);
        panner.pan.setTargetAtTime(pan, when, 0.1);
        const target = audible ? profile.gain * distGain * (0.35 + rpmFrac * 0.65) : 0;
        gain.gain.setTargetAtTime(target, when, 0.09);
      },
      stop() {
        try { osc.stop(); osc2.stop(); } catch { /* already stopped */ }
      },
    };
  }

  function engineFor(key, profileName) {
    if (!engineVoices.has(key)) {
      const voice = createEngineVoice(profileName);
      if (voice) engineVoices.set(key, voice);
    }
    return engineVoices.get(key) || null;
  }

  function dropEngine(key) {
    const voice = engineVoices.get(key);
    if (voice) voice.stop();
    engineVoices.delete(key);
  }

  function setSiren(active, x, z, approach) {
    if (!ctx) return;
    if (!active) {
      if (sirenVoice) {
        try { sirenVoice.osc.stop(); } catch { /* stopped */ }
        sirenVoice = null;
      }
      return;
    }
    if (!sirenVoice) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createStereoPanner();
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(sfxBus);
      osc.start();
      sirenVoice = { osc, gain, panner, phase: 0 };
    }
    const when = ctx.currentTime;
    sirenVoice.phase = (sirenVoice.phase + 1) % 2;
    const base = sirenVoice.phase === 0 ? 660 : 880;
    sirenVoice.osc.frequency.setTargetAtTime(base * (1 + (approach || 0) * 0.06), when, 0.08);
    const { pan, gain: distGain } = panAndGain(x, z);
    sirenVoice.panner.pan.setTargetAtTime(pan, when, 0.1);
    sirenVoice.gain.gain.setTargetAtTime(0.12 * distGain, when, 0.1);
  }

  function setSkid(active, intensity) {
    if (!ctx) return;
    if (!skidVoice) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBus);
      src.start();
      skidVoice = { gain };
    }
    skidVoice.gain.gain.setTargetAtTime(active ? 0.16 * clamp(intensity, 0, 1) : 0, ctx.currentTime, 0.08);
  }

  function setRain(intensity) {
    if (rainGain && ctx) rainGain.gain.setTargetAtTime(0.22 * clamp(intensity, 0, 1), ctx.currentTime, 0.6);
  }

  return {
    init,
    get ready() { return !!ctx && ctx.state === 'running'; },
    get sfxCount() { return sfxCount; },
    sfxCountFor(name) { return sfxCounts[name] || 0; },
    applyVolumes,
    playSfx,
    setMusicMode,
    engineFor,
    dropEngine,
    setSiren,
    setSkid,
    setRain,
    thunder() { playSfx('thunder'); },
  };
}
