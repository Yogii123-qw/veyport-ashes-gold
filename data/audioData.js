// Audio as data: synthesis recipes for effects and note patterns for the
// adaptive music sequencer. audio.js turns these into WebAudio nodes;
// nothing here is a recording, a file, or a borrowed tune.

export const SFX_RECIPES = {
  pistol: { noise: 0.09, noiseHz: 2600, thump: 0.12, thumpHz: 150, gain: 0.55 },
  smg: { noise: 0.06, noiseHz: 3000, thump: 0.08, thumpHz: 170, gain: 0.42 },
  scatter: { noise: 0.16, noiseHz: 1500, thump: 0.2, thumpHz: 95, gain: 0.7 },
  rifle: { noise: 0.11, noiseHz: 2200, thump: 0.15, thumpHz: 120, gain: 0.6 },
  punch: { noise: 0.05, noiseHz: 700, thump: 0.09, thumpHz: 110, gain: 0.4 },
  swing: { noise: 0.08, noiseHz: 1400, thump: 0, thumpHz: 0, gain: 0.22 },
  hit: { tones: [2400], dur: 0.05, gain: 0.2 },
  casing: { clicks: [0], gain: 0.1 },
  reload: { clicks: [0, 0.12, 0.3], gain: 0.3 },
  explosion: { noise: 0.9, noiseHz: 500, thump: 0.7, thumpHz: 55, gain: 0.9 },
  glass: { noise: 0.18, noiseHz: 5200, thump: 0, thumpHz: 0, gain: 0.4 },
  crash: { noise: 0.22, noiseHz: 900, thump: 0.25, thumpHz: 80, gain: 0.6 },
  door: { noise: 0.05, noiseHz: 500, thump: 0.08, thumpHz: 130, gain: 0.35 },
  horn: { tones: [392, 494], dur: 0.35, gain: 0.3 },
  pickup: { tones: [660, 880], dur: 0.16, gain: 0.3 },
  cash: { tones: [880, 1174, 1568], dur: 0.24, gain: 0.3 },
  fail: { tones: [220, 174], dur: 0.5, gain: 0.35 },
  success: { tones: [523, 659, 784, 1046], dur: 0.5, gain: 0.35 },
  click: { tones: [1200], dur: 0.04, gain: 0.2 },
  type: { tones: [1800], dur: 0.02, gain: 0.08 },
  step: { noise: 0.04, noiseHz: 400, thump: 0.03, thumpHz: 90, gain: 0.12 },
  thunder: { noise: 1.4, noiseHz: 220, thump: 1.0, thumpHz: 45, gain: 0.7 },
  siren: { tones: [660, 880], dur: 0.5, gain: 0.0 },
};

export const ENGINE_PROFILES = {
  small: { base: 55, top: 150, wave: 'sawtooth', gain: 0.1 },
  mid: { base: 48, top: 130, wave: 'sawtooth', gain: 0.12 },
  sport: { base: 62, top: 190, wave: 'sawtooth', gain: 0.13 },
  v8: { base: 42, top: 115, wave: 'square', gain: 0.14 },
  diesel: { base: 38, top: 95, wave: 'square', gain: 0.13 },
  // Supercars: high-revving wail that climbs far past the sport profile.
  hyper: { base: 78, top: 270, wave: 'sawtooth', gain: 0.13 },
};

// Music: 8-step patterns per stem, semitone offsets from A2 (110 Hz).
// Explore is sparse, tension adds the arp, mission runs the full pattern.
export const MUSIC = {
  bpm: 92,
  explore: {
    bass: [0, null, 0, null, 3, null, 0, null],
    pad: [0, 3, 7, 10],
    arp: [null, null, null, null, null, null, null, null],
    drums: [1, 0, 0, 0, 1, 0, 0, 0],
  },
  tension: {
    bass: [0, 0, null, 0, 3, 0, null, 2],
    pad: [0, 3, 7, 10],
    arp: [12, null, 15, null, 19, null, 15, null],
    drums: [1, 0, 1, 0, 1, 0, 1, 1],
  },
  mission: {
    bass: [0, 0, 3, 0, 5, 3, 0, 2],
    pad: [0, 3, 7, 10],
    arp: [12, 15, 19, 15, 12, 15, 22, 19],
    drums: [1, 1, 0, 1, 1, 0, 1, 1],
  },
};

export const AMBIENT_ZONES = [
  { district: 'bazaar', kind: 'market' },
  { district: 'ember', kind: 'waves' },
  { district: 'docks', kind: 'harbor' },
  { district: 'neon', kind: 'city' },
];
