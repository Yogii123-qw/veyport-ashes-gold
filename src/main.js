// main.js — boot, the fixed-timestep loop, screens, and the wiring.
//
// This module is deliberately thin: it owns the renderer, the screen
// state, and the per-frame step that calls every system in the right
// order. The systems themselves own their behaviour (HUD in hud.js,
// minimap in minimap.js, menus in menus.js, missions in missions.js,
// wanted in wanted.js, combat in combat.js, audio in audio.js).
// Nothing here touches the network: every file is local, every number
// on the HUD is bound to real state.
//
// Screens: menu (cinematic orbit over the real city) -> play -> pause /
// shop / map. The simulation runs at a fixed 60 Hz; rendering is free.
// While a dialog is open the simulation freezes — the player cannot act
// during a conversation, so neither can the world.

import * as THREE from '../vendor/three.min.js';
import { t } from './langData.js';
import { createCity, LANDMARKS } from './city.js';
import { createVehicles } from './vehicles.js';
import { vehicleName } from './vehiclesData.js';
import { createPlayer, WEAPONS, weaponName } from './player.js';
import { createInput } from './input.js';
import { createCameraRig, CAM_DT_MAX } from './camera.js';
import { createWeather, WEATHERS } from './weather.js';
import { createEconomy } from './economy.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createPedestrians } from './pedestrians.js';
import { createCombat } from './combat.js';
import { createWanted } from './wanted.js';
import { createDialogs } from './dialogs.js';
import { createMissions } from './missions.js';
import { createContracts } from './contracts.js';
import { createSave } from './save.js';
import { createUI } from './ui.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { createMenus } from './menus.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const AUTOSAVE_EVERY = 45; // seconds of play between autosaves (slot 1)

/** Tiny event bus: systems announce, others react. No hidden coupling. */
function createBus() {
  const handlers = new Map();
  return {
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, []);
      handlers.get(evt).push(fn);
    },
    emit(evt, data) {
      const list = handlers.get(evt);
      if (list) for (const fn of list) fn(data);
    },
  };
}

const params = new URLSearchParams(window.location.search);
const autostart = params.get('autostart') === '1';

// ---------- Settings (persisted; every option does something real) ----------
const DEFAULT_SETTINGS = { sensitivity: 1, quality: 'high', lang: 'id', reduceShake: false };
let settings = { ...DEFAULT_SETTINGS };
try {
  const saved = JSON.parse(window.localStorage.getItem('veyport-settings') || '{}');
  settings = { ...DEFAULT_SETTINGS, ...saved };
} catch { /* corrupted settings fall back to defaults */ }
function saveSettings() {
  try { window.localStorage.setItem('veyport-settings', JSON.stringify(settings)); } catch { /* private mode */ }
}
const lang = () => settings.lang;

// ---------- Renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

function applyQuality() {
  const q = settings.quality;
  renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
  renderer.shadowMap.enabled = q !== 'low';
}
applyQuality();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Systems (creation order follows the dependency graph) ----------
const bus = createBus();
const audio = createAudio();
const weather = createWeather(scene);
const city = createCity(scene);
const vehicles = createVehicles(scene, city, bus);
const player = createPlayer(scene, city, vehicles, bus);
const input = createInput();
const cameraRig = createCameraRig(camera, city);
const economy = createEconomy(bus);
economy.bind(player, vehicles);
const effects = createEffects(scene, bus);

// Late-bound references: pedestrians and dialogs are created before the
// systems they call back into, so their callbacks close over these.
let wantedRef = null;
let uiRef = null;
const pedestrians = createPedestrians(scene, city, bus, {
  damagePlayer: (amount, source) => { if (wantedRef) wantedRef.takeDamage(amount, source); },
});
const combat = createCombat({ city, vehicles, player, bus, effects, audio, cameraRig });
const wanted = createWanted({ scene, city, vehicles, player, bus, cameraRig, economy, weather });
wantedRef = wanted;
combat.setSystems({ pedestrians, wanted });
player.setFireHandler(combat.tryFire);
const dialogs = createDialogs({ audio, getLang: lang, notify: (m) => { if (uiRef) uiRef.notify(m); } });
const missions = createMissions({
  player, vehicles, city, economy, bus, dialogs, wanted, weather, pedestrians,
  notify: (m) => { if (uiRef) uiRef.notify(m); },
});
const contracts = createContracts({
  player, vehicles, city, economy, bus, wanted,
  notify: (m) => { if (uiRef) uiRef.notify(m); },
});
contracts.buildCaches(THREE, scene);
const save = createSave({
  player, vehicles, economy, weather, missions, contracts, wanted,
  getSettings: () => settings,
  onAutosave: () => { if (uiRef) uiRef.notify('autosaved'); },
});
const ui = createUI({ bus, economy, missions, contracts, wanted, save, getLang: lang });
uiRef = ui;
const hud = createHud({ player, vehicles, economy, weather, city, cameraRig, wanted, bus, getLang: lang });
const minimap = createMinimap({ player, vehicles, city });
const menus = createMenus({
  economy, vehicles, weather, player, cameraRig, ui,
  getLang: lang, getSettings: () => settings, saveSettings, applyQuality,
});

// Headlight cone for the player's car at night (one real spotlight).
const headlight = new THREE.SpotLight(0xfff2c0, 0, 60, 0.5, 0.6, 1.4);
const headlightTarget = new THREE.Object3D();
scene.add(headlightTarget);
headlight.target = headlightTarget;
scene.add(headlight);

// ---------- Screen state (kept in sync with menus.js) ----------
let screen = 'menu'; // menu | play | pause | shop | map
let simTime = 0;
let prevFire = false;
let p9NoticeShown = false;
let autosaveTimer = AUTOSAVE_EVERY;

function setScreen(s) {
  screen = s;
  menus.setScreen(s);
}

function startGame(fresh) {
  if (fresh) resetGame();
  setScreen('play');
  document.getElementById('hud').classList.remove('hidden');
  if (input.isTouch()) {
    document.getElementById('touchUI').classList.remove('hidden');
    // One map/pause set only: the touch set (PETA/II) replaces the
    // desktop set (Peta/II) on touch devices — same detection that
    // shows the touch UI, so the two can never double up (P1).
    document.body.classList.add('touch');
  }
  cameraRig.setMode('foot');
  audio.resume();
  if (!p9NoticeShown) {
    ui.notify('gotP9', 5000);
    p9NoticeShown = true;
  }
  ui.announce('Playing Veyport.');
}

function resetGame() {
  economy.state.cash = 500;
  economy.state.ledger.length = 0;
  economy.state.garage.length = 0;
  economy.state.freeResprays = 0;
  economy.state.safehouseLevel = 0;
  player.state.health = 100;
  player.state.armor = 0;
  player.state.weapons = { fists: { owned: true, ammo: Infinity, reserve: 0, mag: Infinity } };
  player.state.weapons.p9 = { owned: true, ammo: 12, reserve: 48, mag: 12 };
  player.state.currentWeapon = 'p9';
  player.syncWeaponMesh();
  player.teleport(-452, -372, 0.6);
  weather.setTime(9);
  weather.state.weather = 'clear';
  wanted.clearWanted();
  const ms = missions.state;
  ms.activeIndex = -1; ms.stageIdx = 0; ms.stageState = {};
  ms.completed.length = 0; ms.choices = {};
  ms.storyComplete = false; ms.ending = null; ms.nextDelay = 0; ms.failed = 0;
  const cs = contracts.state;
  cs.reputation = 0; cs.active = null; cs.offers = [];
  cs.done = 0; cs.failed = 0; cs.cachesFound.length = 0;
  cs.stuntBest = {}; cs.trialBest = {}; cs.contractSeq = 0;
  hud.renderWeaponKeys();
  autosaveTimer = AUTOSAVE_EVERY;
}

function openPause() {
  setScreen('pause');
}

function closePause() {
  setScreen('play');
}

menus.bindButtons({
  newGame: () => startGame(true),
  continueGame: () => startGame(false),
  resume: closePause,
  quitToMenu: () => {
    setScreen('menu');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touchUI').classList.add('hidden');
    document.body.classList.remove('touch');
    cameraRig.setMode('menu');
  },
  closeShop: () => setScreen('play'),
  pause: openPause,
  onLangChange: () => { hud.renderWeaponKeys(); },
});
minimap.bind();

// ---------- Bus reactions (only what no system owns) ----------
bus.on('hit', () => {
  const hm = document.getElementById('hitmarker');
  hm.classList.remove('hidden');
  window.setTimeout(() => hm.classList.add('hidden'), 120);
});
bus.on('entered-vehicle', ({ vehicle }) => {
  ui.notify('enteredCar');
  ui.announce(vehicleName(vehicle.def, settings.lang));
});
bus.on('carjack', () => ui.notify('carjack'));
bus.on('vehicle-destroyed', ({ vehicle }) => {
  ui.notify(`${vehicleName(vehicle.def, settings.lang)} ${t('vehicleDestroyed', settings.lang)}`);
  if (vehicles.getPlayerVehicle() === vehicle) {
    player.state.inVehicle = false;
    player.state.vehicle = null;
    vehicles.setPlayerVehicle(null);
    player.teleport(vehicle.x + 3, vehicle.z + 3, vehicle.heading);
    cameraRig.setMode('foot');
  }
});
bus.on('crash', ({ vehicle, speed, x, z }) => {
  // P7: only crashes involving the focus shake the camera. The physics
  // emits 'crash' for EVERY vehicle on any wall touch, and traffic AI
  // scrapes walls constantly — before this gate, distant traffic
  // crashes shook the player's camera while just walking (measured
  // trauma spikes 0.16-0.25 with no player involvement). The player's
  // own car keeps the full shake; a nearby crash shakes less with
  // distance, and anything beyond 45 m or slower than 4 m/s is silent.
  const pv = vehicles.getPlayerVehicle();
  if (vehicle && pv && vehicle === pv) {
    cameraRig.addTrauma(settings.reduceShake ? 0.08 : 0.3);
    return;
  }
  const impact = Math.abs(speed || 0);
  if (impact <= 4) return;
  const p = player.position();
  const d = Math.hypot((x || 0) - p.x, (z || 0) - p.z);
  if (d >= 45) return;
  const amount = (settings.reduceShake ? 0.08 : 0.3) * (1 - d / 45) * Math.min(1, impact / 12);
  cameraRig.addTrauma(amount);
});
bus.on('wasted-start', ({ heli }) => {
  cameraRig.setMode('wasted', { heliPos: heli });
});
bus.on('busted-start', () => {
  // The player is led away; the camera stays where it is.
});

// ---------- Simulation step ----------
const WEAPON_ORDER = ['fists', 'p9', 'kr9', 'iron12', 'vk7'];

function step(dt) {
  simTime += dt;
  const actions = input.takeActions();

  if (actions.has('pause')) {
    if (screen === 'play') openPause();
    else if (screen === 'pause') closePause();
    else if (screen === 'map' || screen === 'shop') setScreen('play');
  }
  if (screen !== 'play') return;
  if (actions.has('map')) { setScreen('map'); return; }

  // A dialog freezes the world: the player cannot act, so neither can it.
  // P5: the busted/wasted clock is NOT the world — it keeps running
  // behind a dialog, so an arrest/hospital flow can never freeze there.
  if (dialogs.isOpen) {
    dialogs.update(dt);
    wanted.tickFlow(dt);
    return;
  }

  const ps = player.state;
  const p = player.position();

  // Enter / exit vehicle, or open the nearest shop.
  if (actions.has('enter')) {
    if (ps.inVehicle) player.exitVehicle();
    else {
      const shop = menus.nearestShopLandmark();
      if (shop) menus.openShop(shop.shop);
      else player.tryEnter();
    }
  }
  if (actions.has('interact')) {
    const shop = menus.nearestShopLandmark();
    if (shop) menus.openShop(shop.shop);
  }
  if (actions.has('reload')) player.reload();
  for (let i = 1; i <= 5; i++) {
    if (actions.has(`weapon${i}`)) {
      const id = WEAPON_ORDER[i - 1];
      if (id && player.switchWeapon(id)) hud.renderWeaponKeys();
    }
  }

  // Fire: semi-auto weapons fire on the rising edge, auto on hold.
  const firing = input.fire && !ps.inVehicle;
  const def = player.currentWeaponDef();
  if (firing && def) {
    if (def.auto) player.tryFire(camera, simTime);
    else if (!prevFire) player.tryFire(camera, simTime);
  }
  prevFire = input.fire;

  // Drive or walk. focusPos is where the action is (the car, when driving).
  // player.update runs every frame: it owns the enter/exit transitions,
  // which must keep counting down even while the player sits in the car.
  const focusPos = ps.inVehicle && ps.vehicle ? { x: ps.vehicle.x, z: ps.vehicle.z } : p;
  player.update(dt, input, cameraRig.yaw);
  if (ps.inVehicle && ps.vehicle) {
    const ctl = input.driveControls();
    vehicles.update(dt, ctl, focusPos, weather.gripFactor);
  } else {
    vehicles.update(dt, { throttle: 0, steer: 0, handbrake: false }, focusPos, weather.gripFactor);
  }

  // The world systems all run on the same clock and the same focus point.
  const ctx = { playerPos: focusPos, time: simTime };
  pedestrians.update(dt, ctx);
  missions.update(dt, ctx);
  contracts.update(dt, ctx);
  wanted.update(dt, ctx);
  dialogs.update(dt);
  effects.update(dt);
  ui.update(dt);

  // Camera mode follows the state.
  if (wanted.flow === 'wasted' && cameraRig.mode !== 'wasted') {
    cameraRig.setMode('wasted', { heliPos: wanted.heliPos });
  } else if (wanted.flow === 'none' && cameraRig.mode === 'wasted') {
    cameraRig.setMode('foot');
  } else if (ps.inVehicle && cameraRig.mode !== 'drive') {
    cameraRig.setMode('drive', { heading: ps.vehicle.heading, x: ps.vehicle.x, z: ps.vehicle.z });
  } else if (!ps.inVehicle && cameraRig.mode === 'drive') {
    cameraRig.setMode(ps.aim ? 'aim' : 'foot');
  } else if (!ps.inVehicle && ps.aim && cameraRig.mode === 'foot') {
    cameraRig.setMode('aim');
  } else if (!ps.inVehicle && !ps.aim && cameraRig.mode === 'aim') {
    cameraRig.setMode('foot');
  }

  // Headlight follows the player's car at night.
  const pv = vehicles.getPlayerVehicle();
  if (pv) {
    const night = weather.nightFactor();
    headlight.intensity = night * 120;
    headlight.position.set(pv.x + Math.sin(pv.heading) * 2, 1.2, pv.z + Math.cos(pv.heading) * 2);
    headlightTarget.position.set(pv.x + Math.sin(pv.heading) * 30, 0, pv.z + Math.cos(pv.heading) * 30);
  } else {
    headlight.intensity = 0;
  }

  // World clock + weather (centred on where the action is).
  weather.update(dt, focusPos);
  city.update(dt, weather.dayTime, weather.nightFactor());

  // Audio follows the car, the weather, the sirens and the story.
  let sirenPan = 0;
  if (wanted.police.length) {
    let nearest = null;
    let nearestD = Infinity;
    for (const u of wanted.police) {
      const d = Math.hypot(u.x - p.x, u.z - p.z);
      if (d < nearestD) { nearestD = d; nearest = u; }
    }
    if (nearest) sirenPan = Math.max(-1, Math.min(1, (nearest.x - p.x) / 60));
  }
  audio.update(dt, {
    rpmFrac: pv ? Math.abs(pv.speed) / pv.def.topSpeed : 0,
    engineKind: pv ? pv.def.engine : 'mid',
    rainLevel: WEATHERS[weather.weather].rain,
    siren: wanted.stars > 0,
    sirenPan,
    inMission: !!missions.active,
    wanted: wanted.stars,
  });

  // Autosave (slot 1) while playing.
  autosaveTimer -= dt;
  if (autosaveTimer <= 0) {
    autosaveTimer = AUTOSAVE_EVERY;
    save.autosave();
  }

  // Interact prompt.
  const prompt = document.getElementById('interactPrompt');
  const nearVehicle = !ps.inVehicle && vehicles.nearestVehicle(ps.x, ps.z, 4.5);
  const shop = menus.nearestShopLandmark();
  if (shop) {
    prompt.textContent = `${t('openShop', settings.lang)} — ${LANDMARKS[shop.key].label[settings.lang] || LANDMARKS[shop.key].label.en} (F)`;
    prompt.classList.remove('hidden');
  } else if (nearVehicle) {
    prompt.textContent = `${t('enterVehicle', settings.lang)} — ${vehicleName(nearVehicle.def, settings.lang)} (E)`;
    prompt.classList.remove('hidden');
  } else {
    prompt.classList.add('hidden');
  }

  hud.update();
  minimap.update(performance.now(), {
    waypoint: missions.waypoint(),
    contractWp: contracts.active ? contracts.waypoint() : null,
    police: wanted.stars > 0 ? wanted.police : null,
    full: screen === 'map',
  });
}

// ---------- Render interpolation (P7 rule 4) ----------
// The camera reads the focus interpolated between the previous and
// current physics states, so a render never shows a raw stepped state
// (at 90/120 Hz the same state would otherwise repeat for 1-2 frames
// and then jump — the judder Monch reported). Follows Fiedler's fixed
// timestep pattern: prev is the state before the last step, curr the
// state after it, alpha = accumulator / STEP. STEP and the physics are
// untouched; only the camera's input is interpolated.
let focusPrev = null;
let focusCurr = null;

function readFocus() {
  const ps = player.state;
  const pv = vehicles.getPlayerVehicle();
  if (ps.inVehicle && pv) {
    return { key: pv.id, x: pv.x, z: pv.z, y: 0, heading: pv.heading, speed: pv.speed };
  }
  return { key: 'p', x: ps.x, z: ps.z, y: 0, heading: ps.heading, speed: ps.speed || 0 };
}

function interpFocus(alpha) {
  if (!focusPrev || !focusCurr) return readFocus();
  let dh = focusCurr.heading - focusPrev.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    x: focusPrev.x + (focusCurr.x - focusPrev.x) * alpha,
    z: focusPrev.z + (focusCurr.z - focusPrev.z) * alpha,
    y: 0,
    heading: focusPrev.heading + dh * alpha,
    speed: focusPrev.speed + (focusCurr.speed - focusPrev.speed) * alpha,
  };
}

// ---------- Main loop ----------
let last = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  if (!focusCurr) {
    focusCurr = readFocus();
    focusPrev = focusCurr;
  }
  let stepsRun = 0;
  if (screen === 'play') {
    accumulator += frameDt;
    while (accumulator >= STEP) {
      // Snapshot around the step: prev = state before, curr = after.
      focusPrev = focusCurr;
      step(STEP);
      focusCurr = readFocus();
      // No interpolation across an entity switch (enter/exit vehicle)
      // or a teleport/respawn (a single step moves at most ~1.2 m at
      // top speed, so a > 3 m jump is a teleport, not motion).
      if (focusPrev.key !== focusCurr.key) {
        focusPrev = focusCurr;
      } else {
        const dx = focusCurr.x - focusPrev.x;
        const dz = focusCurr.z - focusPrev.z;
        if (dx * dx + dz * dz > 9) focusPrev = focusCurr;
      }
      accumulator -= STEP;
      stepsRun++;
      if (screen !== 'play') { accumulator = 0; break; }
    }
    // P7 rule 1: the camera updates ONCE per render frame, LAST before
    // the render, after the physics accumulator — never inside step().
    // P7 rule 2: its dt is the render frame dt clamped to 0.05 s.
    const alpha = Math.max(0, Math.min(1, accumulator / STEP));
    const interp = interpFocus(alpha);
    const frameDtCam = Math.min(frameDt, CAM_DT_MAX);
    cameraRig.updateTarget(interp, frameDtCam);
    const look = input.takeLook();
    const pv = vehicles.getPlayerVehicle();
    const ps = player.state;
    // The WASTED crane rise follows the GAME clock (7 s), so it gets
    // the sim time advanced this frame, not the render dt.
    const camDt = cameraRig.mode === 'wasted' ? stepsRun * STEP : frameDtCam;
    cameraRig.update(camDt, {
      look,
      speed: interp.speed,
      topSpeed: pv ? pv.def.topSpeed : 8.5,
      aspect: camera.aspect,
      sensitivity: settings.sensitivity,
      aiming: ps.aim,
      playerPos: { x: interp.x, y: 0, z: interp.z },
    });
  } else if (screen === 'menu') {
    // The menu orbits the live city; the world itself stays frozen.
    cameraRig.update(frameDt, { playerPos: { x: 0, y: 0, z: 0 }, look: { dx: 0, dy: 0 }, aspect: camera.aspect });
    effects.update(frameDt);
  } else {
    // Paused / map / shop: the camera is frozen. Drain accumulated
    // look deltas so no stale drag jumps the camera on resume.
    input.takeLook();
  }
  renderer.render(scene, camera);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play') openPause();
});

// ---------- Boot ----------
hud.renderWeaponKeys();
cameraRig.setMode('menu');
ui.announce('Veyport: Ashes and Gold. Press New Game to start.');
if (autostart) startGame(true);
else if (params.get('pos')) {
  const [x, z] = params.get('pos').split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(z)) player.teleport(x, z, 0);
}
requestAnimationFrame(frame);

// Test hooks (read-only state for the automated playtest).
window.__veyport = {
  version: 2,
  get screen() { return screen; },
  get cash() { return economy.cash; },
  get time() { return simTime; }, // game seconds since New Game (fixed-step clock)
  camera,
  get drawCalls() { return renderer.info.render.calls; },
  get triangles() { return renderer.info.render.triangles; },
  player,
  vehicles,
  economy,
  weather,
  city,
  cameraRig,
  input,
  wanted,
  missions,
  contracts,
  dialogs,
  save,
  ui,
  hud,
  minimap,
  menus,
  combat,
  pedestrians,
  audio,
  effects,
  startGame,
  setScreen,
  showNotice: (msg, ms) => ui.notify(msg, ms),
  get settings() { return settings; },
};
