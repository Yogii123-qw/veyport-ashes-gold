// weather.js - Veyport sky: an 18-minute day cycle and 4 weather states.
// Clear, Rain, Fog, Storm. Weather changes by a Markov roll every 2-4
// minutes. Rain cuts grip and visibility; fog cuts visibility harder;
// storm cuts both and makes the sea rough (phase B visual).

const DAY_LENGTH = 1080; // 18 minutes per full day
export const WEATHERS = ['clear', 'rain', 'fog', 'storm'];

const GRIP = { clear: 1.0, rain: 0.82, fog: 0.96, storm: 0.72 };
const VIS = { clear: 1000, rain: 420, fog: 150, storm: 260 };

// Markov transition weights: rows from-state, columns to-state.
const FLOW = {
  clear: { clear: 0.72, rain: 0.16, fog: 0.10, storm: 0.02 },
  rain: { clear: 0.45, rain: 0.40, fog: 0.05, storm: 0.10 },
  fog: { clear: 0.55, rain: 0.15, fog: 0.28, storm: 0.02 },
  storm: { clear: 0.30, rain: 0.55, fog: 0.05, storm: 0.10 },
};

export class Weather {
  constructor(seed) {
    this.clock = 0; // seconds since cycle start; 0 = 06:00
    this.state = 'clear';
    this.nextChange = 150 + ((seed % 90));
    this.blend = 1; // 0..1 transition progress to the new state
    this.sunAngle = 0;
    this.rainDrops = [];
    this.rainAmount = 0;
  }

  step(dt) {
    this.clock = (this.clock + dt) % DAY_LENGTH;
    // Sun: rises 06:00 (t=0), noon at t=540, sets at t=1080 (00:00).
    this.sunAngle = (this.clock / DAY_LENGTH) * Math.PI * 2;
    this.nextChange -= dt;
    if (this.nextChange <= 0) {
      this.state = this._roll();
      this.nextChange = 120 + Math.random() * 120;
      this.blend = 0;
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / 8);
    const target = this.state === 'rain' ? 0.7 : this.state === 'storm' ? 1 : 0;
    this.rainAmount += (target - this.rainAmount) * Math.min(1, dt * 0.3);
    if (this.rainAmount > 0.05) {
      for (let i = 0; i < 2; i++) {
        this.rainDrops.push({ x: (Math.random() - 0.5) * 60, y: 25 + Math.random() * 10, z: (Math.random() - 0.5) * 60 });
      }
    }
  }

  _roll() {
    const row = FLOW[this.state];
    let r = Math.random();
    for (const w of WEATHERS) {
      r -= row[w];
      if (r <= 0) return w;
    }
    return 'clear';
  }

  // 0 = dawn, 0.5 = noon, 1 = midnight.
  daylight() {
    const s = Math.sin(this.sunAngle);
    return Math.max(0, Math.min(1, 0.25 + s * 0.75));
  }

  // Human clock: the 1080 s cycle IS one full day compressed (18 min
  // real), so the clock maps the cycle onto 24 hours: 06:00 at cycle
  // start, 21:00 at clock 675, midnight at 810. M4 sets clock 675 for
  // its 21:00 night race, and the sun angle agrees (night at 675).
  timeString() {
    const total = 6 * 3600 + (this.clock / DAY_LENGTH) * 24 * 3600;
    const h = Math.floor(total / 3600) % 24;
    const m = Math.floor((total % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  gripFactor() {
    return GRIP[this.state];
  }

  visibility() {
    return VIS[this.state];
  }

  isWet() {
    return this.state === 'rain' || this.state === 'storm';
  }
}
