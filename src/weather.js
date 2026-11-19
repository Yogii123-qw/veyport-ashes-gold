// weather.js — the 18-minute day and the four weathers, rewritten in phase 2.
//
// One game day = 18 real minutes (SPEC §3.5). The sun moves on a real
// arc: white-hot at noon, orange at dusk, moonlight at night; street
// lights and lit windows come on after dark (city.js reads
// nightFactor). Weather is a Markov chain — clear tends to hold, storms
// are rare and short — and it changes the game: rain cuts grip to 0.85
// and police sight by 20%, storm cuts grip to 0.75 and sight by 35%.
// The public API is unchanged from phase 1 (dayTime fraction, setTime
// in hours, forecast() as a method, gripFactor / sightFactor as
// getters, nightFactor() as a method); this rewrite splits the update
// into named steps, adds a wind vector the rain leans into, and adds
// forceWeather() for missions and the menu.

import * as THREE from '../vendor/three.min.js';

export const DAY_LENGTH = 1080; // seconds per game day

export const WEATHERS = {
  clear: { grip: 1.0, sight: 1.0, fog: 0.00045, rain: 0, label: { en: 'Clear', id: 'Cerah' } },
  cloudy: { grip: 1.0, sight: 0.95, fog: 0.0007, rain: 0, label: { en: 'Cloudy', id: 'Berawan' } },
  rain: { grip: 0.85, sight: 0.8, fog: 0.0011, rain: 1, label: { en: 'Rain', id: 'Hujan' } },
  storm: { grip: 0.75, sight: 0.65, fog: 0.0016, rain: 2, label: { en: 'Storm', id: 'Badai' } },
};

// Row = current weather, columns = next. Clear holds; storms are brief.
const TRANSITIONS = {
  clear: [['clear', 0.72], ['cloudy', 0.2], ['rain', 0.07], ['storm', 0.01]],
  cloudy: [['cloudy', 0.55], ['clear', 0.25], ['rain', 0.18], ['storm', 0.02]],
  rain: [['rain', 0.55], ['cloudy', 0.25], ['clear', 0.12], ['storm', 0.08]],
  storm: [['storm', 0.35], ['rain', 0.4], ['cloudy', 0.2], ['clear', 0.05]],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickNext(rng, from) {
  const row = TRANSITIONS[from];
  let r = rng();
  for (const [name, p] of row) {
    r -= p;
    if (r <= 0) return name;
  }
  return row[0][0];
}

/** Sky + fog + sun colours keyed by sun elevation (-1..1). */
function skyFor(elev) {
  if (elev > 0.35) return { sky: 0x87b5e0, fog: 0x9ab8d0, sun: 0xfff2d8 };
  if (elev > 0.05) return { sky: 0xe8a06a, fog: 0xd89a72, sun: 0xffb35a };
  if (elev > -0.12) return { sky: 0x5a4a6a, fog: 0x4a3f55, sun: 0xff8a4a };
  return { sky: 0x0e1424, fog: 0x0e1424, sun: 0x8aa8d8 };
}

export function createWeather(scene) {
  const rng = mulberry32(777);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4038, 1.25);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(0x9ab8d0, 0.00045);

  // Rain: one Points cloud, recycled around the player, visible in rain.
  const RAIN_COUNT = 700;
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = (rng() - 0.5) * 60;
    rainPos[i * 3 + 1] = rng() * 30;
    rainPos[i * 3 + 2] = (rng() - 0.5) * 60;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    color: 0x9ab8d8, size: 0.35, transparent: true, opacity: 0.55, sizeAttenuation: true,
  }));
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);

  const state = {
    dayTime: 9 / 24, // 09:00 start — morning sun over the Docks
    weather: 'clear',
    weatherTimer: 60 + rng() * 60,
    blend: 1, // 0..1 transition blend toward the current weather
    lightning: 0,
    lightningTimer: 4 + rng() * 8,
    windX: 0.15, // wind the rain streaks lean into; drifts slowly
    windZ: -0.1,
  };

  function sunElevation() {
    // dayTime 0 = midnight, 0.5 = noon. Elevation peaks at noon.
    return Math.sin((state.dayTime - 0.25) * Math.PI * 2);
  }

  function nightFactor() {
    const e = sunElevation();
    if (e > 0.08) return 0;
    if (e < -0.12) return 1;
    return (0.08 - e) / 0.2;
  }

  function hourMinute() {
    const h = Math.floor(state.dayTime * 24);
    const m = Math.floor((state.dayTime * 24 - h) * 60);
    return { h, m };
  }

  /** Forecast: simulate the Markov chain forward, honestly. */
  function forecast() {
    const out = [];
    let w = state.weather;
    const sim = mulberry32(Math.floor(state.dayTime * 100000) + 42);
    for (let i = 1; i <= 3; i++) {
      w = pickNext(sim, w);
      out.push({ hoursAhead: i, weather: w });
    }
    return out;
  }

  function stepClock(dt) {
    state.dayTime = (state.dayTime + dt / DAY_LENGTH) % 1;
    state.blend = Math.min(1, state.blend + dt / 8);
  }

  function stepWeather(dt) {
    state.weatherTimer -= dt;
    if (state.weatherTimer <= 0) {
      const next = pickNext(rng, state.weather);
      if (next !== state.weather) {
        state.weather = next;
        state.blend = 0;
      }
      state.weatherTimer = 45 + rng() * 75;
    }
    // Wind drifts so the rain never leans the same way twice.
    state.windX += (rng() - 0.5) * dt * 0.02;
    state.windZ += (rng() - 0.5) * dt * 0.02;
    state.windX = Math.max(-0.6, Math.min(0.6, state.windX));
    state.windZ = Math.max(-0.6, Math.min(0.6, state.windZ));
  }

  function stepRain(dt, playerPos) {
    const w = WEATHERS[state.weather];
    const rainLevel = w.rain;
    rain.visible = rainLevel > 0;
    if (rainLevel <= 0) return;
    const px = playerPos ? playerPos.x : 0;
    const pz = playerPos ? playerPos.z : 0;
    const arr = rainGeo.attributes.position.array;
    const fall = (rainLevel === 2 ? 26 : 16) * dt;
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr[i * 3 + 1] -= fall * (0.7 + ((i * 37) % 10) / 25);
      arr[i * 3] += state.windX * dt * 6;
      arr[i * 3 + 2] += state.windZ * dt * 6;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3] = px + (rng() - 0.5) * 60;
        arr[i * 3 + 1] = 22 + rng() * 8;
        arr[i * 3 + 2] = pz + (rng() - 0.5) * 60;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  function stepLightning(dt) {
    if (state.weather === 'storm') {
      state.lightningTimer -= dt;
      if (state.lightningTimer <= 0) {
        state.lightning = 0.12;
        state.lightningTimer = 3 + rng() * 9;
      }
    }
    if (state.lightning > 0) {
      state.lightning -= dt;
      sun.intensity += 3.5;
      scene.background = new THREE.Color(0x8a9ab8);
    }
  }

  function update(dt, playerPos) {
    stepClock(dt);
    stepWeather(dt);
    const w = WEATHERS[state.weather];
    const elev = sunElevation();
    const night = nightFactor();
    const palette = skyFor(elev);

    // Sun position follows the arc; moonlight (dim, blue) at night.
    const ang = (state.dayTime - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const px = playerPos ? playerPos.x : 0;
    const pz = playerPos ? playerPos.z : 0;
    sun.position.set(px + sunDir.x * 220, Math.max(30, sunDir.y * 220), pz + sunDir.z * 220);
    sun.target.position.set(px, 0, pz);
    sun.color.setHex(palette.sun);
    sun.intensity = 0.25 + (1 - night) * 2.3;
    hemi.intensity = 0.5 + (1 - night) * 0.75;

    scene.background = new THREE.Color(palette.sky);
    scene.fog.color.setHex(palette.fog);
    scene.fog.density = w.fog * (0.6 + 0.4 * state.blend) + night * 0.0002;

    stepRain(dt, playerPos);
    stepLightning(dt);
  }

  /** Force a weather now (missions, menu). Resets the roll timer. */
  function forceWeather(w) {
    if (!WEATHERS[w]) return false;
    if (w !== state.weather) {
      state.weather = w;
      state.blend = 0;
    }
    state.weatherTimer = 45 + rng() * 75;
    return true;
  }

  return {
    state,
    update,
    forecast,
    hourMinute,
    nightFactor,
    sunElevation,
    forceWeather,
    setTime(hours) {
      state.dayTime = ((hours % 24) + 24) % 24 / 24;
    },
    get dayTime() { return state.dayTime; },
    get weather() { return state.weather; },
    get gripFactor() { return WEATHERS[state.weather].grip; },
    get sightFactor() { return WEATHERS[state.weather].sight; },
    get wind() { return { x: state.windX, z: state.windZ }; },
    weatherLabel(lang) {
      return WEATHERS[state.weather].label[lang] || WEATHERS[state.weather].label.en;
    },
  };
}
