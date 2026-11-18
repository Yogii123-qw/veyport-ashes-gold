// The sky over Veyport: an 18-minute day, a sun that warms and cools
// with the hour, and four weathers on a Markov chain that change grip,
// visibility, heat decay and sound. The forecast in the pause menu is
// the same chain run forward, so it is a real prediction, not a prop.

import { clamp, lerp, mulberry32 } from './utils.js';

const DAY_SECONDS = 18 * 60;
const WEATHERS = ['clear', 'cloudy', 'rain', 'storm'];
const TRANSITIONS = {
  clear: { clear: 0.72, cloudy: 0.2, rain: 0.07, storm: 0.01 },
  cloudy: { clear: 0.3, cloudy: 0.45, rain: 0.22, storm: 0.03 },
  rain: { clear: 0.18, cloudy: 0.32, rain: 0.4, storm: 0.1 },
  storm: { clear: 0.1, cloudy: 0.3, rain: 0.45, storm: 0.15 },
};
const GRIP = { clear: 1, cloudy: 1, rain: 0.85, storm: 0.75 };
const VISION = { clear: 1, cloudy: 0.95, rain: 0.8, storm: 0.65 };
const RAIN_INTENSITY = { clear: 0, cloudy: 0, rain: 0.6, storm: 1 };
const SKY_GRAY = { clear: 0, cloudy: 0.25, rain: 0.45, storm: 0.7 };

export function createWeather(game) {
  let hours = 8;
  let current = 'clear';
  let previous = 'clear';
  let blend = 1;
  let rollTimer = 25;
  let lightningTimer = 8 + Math.random() * 10;
  let flash = 0;
  let nightFactor = 0;
  let chainSeed = 4242;

  function sunElevation(hour) {
    // Sunrise 6:00, noon peak, sunset 19:00.
    const dayT = (hour - 6) / 13;
    return Math.sin(clamp(dayT, -0.2, 1.2) * Math.PI);
  }

  function computeNight() {
    const elev = sunElevation(hours);
    return clamp(1 - (elev + 0.08) / 0.35, 0, 1);
  }

  function rollWeather() {
    const table = TRANSITIONS[current];
    const r = Math.random();
    let acc = 0;
    let next = current;
    for (const key of WEATHERS) {
      acc += table[key];
      if (r <= acc) { next = key; break; }
    }
    if (next !== current) {
      previous = current;
      current = next;
      blend = 0;
      game.events.emit('weather', { kind: current, previous });
      game.hud.notify(game.lang(current), 'good');
    }
  }

  function effective(name) {
    const table = name === 'grip' ? GRIP : VISION;
    return lerp(table[previous], table[current], blend);
  }

  function forecast() {
    const random = mulberry32(chainSeed + Math.floor(hours * 4));
    const out = [];
    let state = current;
    for (let step = 1; step <= 3; step += 1) {
      const table = TRANSITIONS[state];
      const r = random();
      let acc = 0;
      for (const key of WEATHERS) {
        acc += table[key];
        if (r <= acc) { state = key; break; }
      }
      out.push({ hour: (Math.floor(hours) + step) % 24, weather: state });
    }
    return out;
  }

  function update(dt) {
    hours = (hours + dt / (DAY_SECONDS / 24)) % 24;
    blend = Math.min(1, blend + dt / 5);
    rollTimer -= dt;
    if (rollTimer <= 0) {
      rollTimer = 22 + Math.random() * 14;
      rollWeather();
    }
    nightFactor += (computeNight() - nightFactor) * Math.min(1, dt * 0.5);
    const elev = sunElevation(hours);
    const { sun, hemi, ambient } = game.lights;
    const azimuth = ((hours - 6) / 13) * Math.PI;
    const sunX = Math.cos(azimuth) * 160;
    const sunZ = Math.sin(azimuth) * 90 + 40;
    const sunY = Math.max(12, elev * 220 + 30);
    sun.position.set(game.player.x + sunX, sunY, game.player.z + sunZ);
    const warmth = clamp(1 - Math.abs(elev - 0.35), 0, 1);
    const dayColor = { r: 1, g: 0.95, b: 0.87 };
    const duskColor = { r: 1, g: 0.55, b: 0.3 };
    const nightColor = { r: 0.35, g: 0.45, b: 0.65 };
    let cr;
    let cg;
    let cb;
    if (nightFactor > 0.5) {
      const t = (nightFactor - 0.5) * 2;
      cr = lerp(duskColor.r, nightColor.r, t);
      cg = lerp(duskColor.g, nightColor.g, t);
      cb = lerp(duskColor.b, nightColor.b, t);
    } else {
      const t = nightFactor * 2;
      cr = lerp(dayColor.r, duskColor.r, t * warmth);
      cg = lerp(dayColor.g, duskColor.g, t * warmth);
      cb = lerp(dayColor.b, duskColor.b, t * warmth);
    }
    sun.color.setRGB(cr, cg, cb);
    sun.intensity = lerp(2.6, 0.35, nightFactor);
    if (flash > 0) {
      flash -= dt;
      sun.intensity += Math.max(0, flash) * 14;
    }
    hemi.intensity = lerp(0.9, 0.25, nightFactor);
    ambient.intensity = lerp(0.15, 0.08, nightFactor);
    // Sky + fog follow the weather BLEND, not the new state alone, so
    // a storm rolling in darkens and closes the fog over five seconds
    // instead of popping in one frame.
    const sky = game.scene.background;
    const daySky = [0.74, 0.85, 0.9];
    const nightSky = [0.03, 0.05, 0.09];
    const stormSky = [0.32, 0.36, 0.4];
    const rainBlend = lerp(RAIN_INTENSITY[previous], RAIN_INTENSITY[current], blend);
    const weatherGray = lerp(SKY_GRAY[previous], SKY_GRAY[current], blend);
    const mixed = daySky.map((v, i) => lerp(lerp(v, stormSky[i], weatherGray * (1 - nightFactor)), nightSky[i], nightFactor));
    if (sky && sky.isColor) sky.setRGB(mixed[0], mixed[1], mixed[2]);
    if (game.scene.fog) {
      game.scene.fog.color.setRGB(mixed[0], mixed[1], mixed[2]);
      const near = lerp(300, 60, rainBlend);
      const far = lerp(1100, 380, rainBlend);
      game.scene.fog.near += (near - game.scene.fog.near) * Math.min(1, dt);
      game.scene.fog.far += (far - game.scene.fog.far) * Math.min(1, dt);
    }
    // Rain + lightning.
    game.particles.setRain(rainBlend);
    game.audio.setRain(rainBlend);
    if (current === 'storm') {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningTimer = 6 + Math.random() * 12;
        flash = 0.22;
        setTimeout(() => game.audio.thunder(), 350 + Math.random() * 700);
      }
    }
    game.city.update(dt, nightFactor, flash > 0);
  }

  function setTime(nextHours) {
    hours = ((nextHours % 24) + 24) % 24;
    nightFactor = computeNight();
  }

  function setWeather(kind) {
    if (!WEATHERS.includes(kind)) return;
    previous = current;
    current = kind;
    blend = 0;
    game.events.emit('weather', { kind: current, previous });
  }

  function advanceHours(amount) {
    setTime(hours + amount);
  }

  return {
    get hours() { return hours; },
    get current() { return current; },
    get nightFactor() { return nightFactor; },
    get flash() { return flash; },
    update, setTime, setWeather, advanceHours, forecast,
    gripMultiplier() { return effective('grip'); },
    visionMultiplier() { return effective('vision'); },
    isNight() { return nightFactor > 0.6; },
    setState(nextHours, kind) {
      hours = nextHours;
      current = kind;
      previous = kind;
      blend = 1;
      nightFactor = computeNight();
    },
  };
}
