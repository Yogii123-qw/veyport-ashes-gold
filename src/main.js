// VEYPORT: Ashes & Gold — boot, wiring, and the fixed-step loop.
// Every system is built once, in dependency order, around one shared
// `game` object. The loop steps gameplay at a fixed 60 Hz, renders
// every animation frame, and routes input, interaction scanning and
// camera work from here. Nothing in this file invents game rules —
// those live in the systems and the data files.

import * as THREE from 'three';
import { textFor } from '../data/langData.js';
import { PLAYER_SPAWN, POIS, poiById } from '../data/cityData.js';
import { createEventBus } from './events.js';
import { createRoadGraph } from './roadgraph.js';
import { createPhysics } from './physics.js';
import { createCity } from './city.js';
import { createParticles } from './particles.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createCameraRig } from './camera.js';
import { createVehicles } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { createPlayer } from './player.js';
import { createWanted } from './wanted.js';
import { createCombat } from './combat.js';
import { createTraffic } from './traffic.js';
import { createGangs } from './gangs.js';
import { createPolice } from './police.js';
import { createWeather } from './weather.js';
import { createEconomy } from './economy.js';
import { createMissions } from './missions.js';
import { createContracts } from './contracts.js';
import { createSave } from './save.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { createDialogs } from './dialogs.js';
import { createMenus } from './menus.js';
import { stageShot } from './shots.js';
import { dist2, mulberry32 } from './utils.js';

const STEP = 1 / 60;

function newProgress() {
  return {
    money: 300,
    ledger: [],
    stats: {
      playSeconds: 0, kills: 0, carsStolen: 0, distanceWalked: 0, distanceDriven: 0,
      shots: 0, hits: 0, hpLost: 0, moneyEarned: 0, moneySpent: 0,
      missionsCompleted: 0, missionsFailed: 0, contractsCompleted: 0,
    },
    reputation: { harbormen: 50, foundry: 50 },
    contractRep: 50,
    flags: {
      safehouse: false, contactDrayke: false, freeRespray: 0, heavyArmor: false,
      garageUpgraded: false, armoryUpgraded: false, lastRefillDay: -1, debtResolved: false,
    },
    garage: [],
    cachesTaken: new Set(),
    stunts: {},
    trials: {},
    missionsCompleted: new Set(),
    contractsCompleted: 0,
    contractSeed: 7,
    ending: null,
  };
}

function boot() {
  const params = new URLSearchParams(window.location.search);
  const shotName = params.get('shot');
  const seed = Number(params.get('seed')) || 99;
  const loadingFill = document.getElementById('loadingFill');
  const loadingText = document.getElementById('loadingText');
  const setProgress = (pct, text) => {
    loadingFill.style.width = `${pct}%`;
    if (text) loadingText.textContent = text;
  };

  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd8e8);

  const game = {
    canvas, scene, renderer,
    time: 0,
    dialogOpen: false,
    mode: 'menu',
    settings: {
      language: 'en', master: 80, sfx: 80, music: 60, ambient: 60,
      sensitivity: 100, quality: 'auto', touch: 'auto', reduceShake: false, colorblind: false,
    },
    progress: newProgress(),
  };
  game.lang = (key) => textFor(game.settings.language, key);
  game.events = createEventBus();
  game.roadgraph = createRoadGraph();
  game.physics = createPhysics(game);
  setProgress(35, 'Building the city…');
  game.city = createCity(game);
  setProgress(60, 'Waking the harbor…');
  game.particles = createParticles(game);
  game.audio = createAudio(game);
  game.input = createInput(game);
  game.cameraRig = createCameraRig(game);
  game.vehicles = createVehicles(game);
  game.pedestrians = createPedestrians(game);
  game.player = createPlayer(game);
  game.wanted = createWanted(game);
  game.combat = createCombat(game);
  game.traffic = createTraffic(game);
  game.gangs = createGangs(game);
  game.police = createPolice(game);
  game.weather = createWeather(game);
  game.economy = createEconomy(game);
  game.missions = createMissions(game);
  game.contracts = createContracts(game);
  game.save = createSave(game);
  game.hud = createHud(game);
  game.minimap = createMinimap(game);
  game.dialogs = createDialogs(game);
  game.menus = createMenus(game);
  game.ui = game.menus;

  // Adaptive quality: shadows, resolution and crowd density step down
  // when the frame rate falls, and step back up when it recovers.
  const QUALITY_LEVELS = {
    high: { ped: 32, traffic: 18, shadow: true, shadowSize: 2048, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) },
    medium: { ped: 24, traffic: 14, shadow: true, shadowSize: 1024, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) },
    low: { ped: 14, traffic: 8, shadow: false, shadowSize: 1024, pixelRatio: 1 },
  };
  const quality = {
    level: 'high',
    auto: true,
    fpsEma: 60,
    adjustTimer: 0,
    get pedCap() { return QUALITY_LEVELS[this.level].ped; },
    get trafficCap() { return QUALITY_LEVELS[this.level].traffic; },
    apply(name) {
      if (name === 'auto') {
        this.auto = true;
        this.applyLevel('high');
        return;
      }
      this.auto = false;
      this.applyLevel(name);
    },
    applyLevel(name) {
      this.level = name;
      const spec = QUALITY_LEVELS[name];
      game.city.setShadowQuality(spec.shadow, spec.shadowSize);
      renderer.setPixelRatio(spec.pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
    update(dt, fps) {
      if (!this.auto) return;
      this.fpsEma += (fps - this.fpsEma) * Math.min(1, dt * 0.8);
      this.adjustTimer += dt;
      if (this.adjustTimer < 3) return;
      this.adjustTimer = 0;
      if (this.fpsEma < 28 && this.level !== 'low') {
        this.applyLevel(this.level === 'high' ? 'medium' : 'low');
      } else if (this.fpsEma > 55 && this.level !== 'high') {
        this.applyLevel(this.level === 'low' ? 'medium' : 'high');
      }
    },
  };
  game.quality = quality;

  // Headlight: one spotlight that follows the player's car at night.
  const headlight = new THREE.SpotLight(0xfff2cc, 0, 55, 0.5, 0.45, 1.2);
  scene.add(headlight);
  scene.add(headlight.target);

  game.save.loadSettings();
  game.hud.applyI18n();
  quality.apply(game.settings.quality);

  // Touch weapon bar: one button per owned weapon.
  const touchWeaponsEl = document.getElementById('touchWeapons');
  let touchWeaponSig = '';
  function renderTouchWeapons() {
    const owned = Object.keys(game.player.weapons);
    const sig = `${owned.join(',')}|${game.player.currentWeapon}`;
    if (sig === touchWeaponSig) return;
    touchWeaponSig = sig;
    touchWeaponsEl.innerHTML = '';
    for (const id of owned) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tBtn small${id === game.player.currentWeapon ? ' current' : ''}`;
      btn.textContent = id.toUpperCase();
      btn.addEventListener('click', () => {
        game.player.currentWeapon = id;
        game.audio.playSfx('click');
        renderTouchWeapons();
      });
      touchWeaponsEl.appendChild(btn);
    }
  }

  function applyTouchVisibility() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const show = game.mode === 'playing' && (game.settings.touch === 'on' || (game.settings.touch === 'auto' && (game.input.touchSeen() || coarse)));
    document.getElementById('touch').classList.toggle('hidden', !show);
  }

  function setTouchVisible(on) {
    document.getElementById('touch').classList.toggle('hidden', !on);
  }

  function startPlaying() {
    game.mode = 'playing';
    game.cameraRig.snapBehind(game.player.heading);
    game.input.resetTransient();
  }

  function quitToMenu() {
    game.mode = 'menu';
    game.input.resetTransient();
    game.audio.setMusicMode('explore');
  }

  function newGame() {
    game.missions.cancelActive(false);
    game.contracts.cancelActive(false);
    game.vehicles.reset(mulberry32(seed));
    game.pedestrians.reset();
    game.gangs.reset();
    game.police.reset();
    game.combat.reset();
    game.progress = newProgress();
    game.player.reset(PLAYER_SPAWN);
    game.wanted.setState(0, 0);
    game.weather.setState(8, 'clear');
    game.hud.clearObjective();
    game.cameraRig.snapBehind(PLAYER_SPAWN.heading);
    startPlaying();
    // The gun path must be obvious without a guide: say it out loud.
    game.hud.notify(game.lang('startingGun'), 'good');
  }

  game.main = { startPlaying, quitToMenu, newGame, applyTouchVisibility, setTouchVisible };

  // Initial world state.
  game.vehicles.reset(mulberry32(seed));
  game.player.reset(PLAYER_SPAWN);
  game.weather.setState(8, 'clear');
  game.cameraRig.resize(window.innerWidth, window.innerHeight);
  game.cameraRig.snapBehind(PLAYER_SPAWN.heading);
  setProgress(90, 'Opening the gates…');

  // ---------- interaction scanning ----------
  function scanInteract() {
    const player = game.player;
    // Time trial gates.
    if (!player.vehicle && !game.missions.active && !game.contracts.active && !game.contracts.trial) {
      const trial = game.contracts.trialNear();
      if (trial) {
        return { kind: 'trial', trial, text: trial.name[game.settings.language] || trial.name.en };
      }
    }
    for (const poi of POIS) {
      const d = dist2(player.x, player.z, poi.x, poi.z);
      if (d > 16) continue;
      // Mission talk / mission start takes priority at its POI.
      const mission = game.missions.availableAt(poi.id);
      if (mission) {
        return { kind: 'mission', poi, text: `${game.lang('talkTo')} · ${mission.title[game.settings.language] || mission.title.en}` };
      }
      if (game.missions.active) {
        const stage = game.missions.active.mission.stages[game.missions.active.stageIndex];
        if (stage && stage.type === 'talk' && stage.poi === poi.id) {
          return { kind: 'mission', poi, text: game.lang('talkTo') };
        }
      }
      if (poi.kind === 'bar' && !player.vehicle) return { kind: 'board', poi, text: game.lang('openBoard') };
      if (poi.kind === 'gunshop' && !player.vehicle) return { kind: 'gunshop', poi, text: game.lang('openShop') };
      if (poi.kind === 'food' && !player.vehicle) return { kind: 'food', poi, text: game.lang('eatFood') };
      if (poi.kind === 'respray' && player.vehicle) return { kind: 'respray', poi, text: game.lang('resprayHere') };
      if (poi.kind === 'chopshop' && player.vehicle) return { kind: 'chopshop', poi, text: game.lang('sellVehicle') };
      if (poi.kind === 'safehouse') {
        if (!game.progress.flags.safehouse) return { kind: 'locked', poi, text: poi.name[game.settings.language] || poi.name.en };
        return { kind: 'safehouse', poi, text: poi.name[game.settings.language] || poi.name.en };
      }
      if (poi.id === 'harborHq' && game.progress.flags.contactDrayke && !player.vehicle) {
        return { kind: 'bribe', poi, text: game.lang('bribeHere') };
      }
    }
    return null;
  }

  function doInteract(target) {
    if (!target) return;
    if (target.kind === 'trial') {
      game.contracts.startTrial(target.trial);
      return;
    }
    if (target.kind === 'mission') {
      game.missions.onInteract(target.poi.id);
      return;
    }
    if (target.kind === 'locked') {
      game.hud.notify(game.settings.language === 'id' ? 'Gudang Cole — belum milikmu. Selesaikan misi pertama.' : "Cole's warehouse — not yours yet. Finish the first mission.", 'bad');
      return;
    }
    game.menus.openShop(target.kind);
  }

  // ---------- the loop ----------
  let lastNow = performance.now();
  let accumulator = 0;
  let fpsFrames = 0;
  let fpsTimer = 0;
  let fps = 60;
  let musicTimer = 0;
  let insideSafehouse = false;

  function stepGame(dt, pressed) {
    game.time += dt;
    // Dialog freezes the world; only the typewriter runs.
    if (game.dialogOpen) {
      if (pressed.has('dialogAdvance') || pressed.has('interact') || pressed.has('enter') || pressed.has('jump')) {
        game.dialogs.advance();
      }
      return;
    }
    // Any overlay freezes the world, except pause toggling itself.
    if (game.menus.paused || game.menus.resultsOpen || game.menus.modalOpen || game.menus.settingsOpen || game.menus.creditsOpen || game.menus.slotsOpen) {
      if (pressed.has('pause') && game.menus.paused) game.menus.togglePause(false);
      return;
    }
    if (game.mode === 'menu') {
      game.weather.update(dt);
      game.traffic.update(dt);
      game.pedestrians.update(dt);
      game.gangs.update(dt);
      game.police.update(dt);
      game.vehicles.update(dt);
      game.vehicles.resolveCollisions();
      game.particles.update(dt);
      game.cameraRig.updateMenu(dt);
      return;
    }

    if (pressed.has('pause')) {
      game.menus.togglePause(true);
      return;
    }
    if (pressed.has('map')) {
      game.menus.togglePause(true);
      game.menus.showTab('map');
      return;
    }

    // During the WASTED crane shot the world keeps living but the
    // player cannot interact; prompts stay hidden until respawn.
    if (!game.wanted.wastedActive) {
      const target = scanInteract();
      if (pressed.has('interact')) doInteract(target);
      if (target) game.hud.showPrompt(target.text, 'F');
      else if (!game.player.vehicle && game.player.nearestVehicle(4.2)) {
        const vehicle = game.player.nearestVehicle(4.2);
        game.hud.showPrompt(vehicle.driver === 'traffic' ? game.lang('carjack') : game.lang('enterVehicle'), 'E');
      } else if (game.player.vehicle) {
        game.hud.showPrompt(game.lang('exitVehicle'), 'E');
      } else {
        game.hud.hidePrompt();
      }
    } else {
      game.hud.hidePrompt();
    }

    game.player.update(dt, game.input, pressed);
    game.vehicles.update(dt);
    game.vehicles.resolveCollisions();
    game.traffic.update(dt);
    game.pedestrians.update(dt);
    game.gangs.update(dt);
    game.police.update(dt);
    game.wanted.update(dt);
    game.combat.update(dt, game.input, pressed);
    game.missions.update(dt);
    game.contracts.update(dt);
    game.weather.update(dt);
    game.particles.update(dt);
    game.progress.stats.playSeconds += dt;

    // Adaptive music: tension overrides explore, missions override all.
    musicTimer -= dt;
    if (musicTimer <= 0) {
      musicTimer = 0.5;
      if (game.missions.active || game.contracts.active) game.audio.setMusicMode('mission');
      else if (game.wanted.stars >= 2) game.audio.setMusicMode('tension');
      else game.audio.setMusicMode('explore');
    }

    // Safehouse entry autosaves.
    const safehouse = poiById('safehouse');
    const nearSafehouse = dist2(game.player.x, game.player.z, safehouse.x, safehouse.z) < 12;
    if (nearSafehouse && !insideSafehouse && game.progress.flags.safehouse) {
      game.save.autosave('safehouse');
    }
    insideSafehouse = nearSafehouse;

    // Camera follows the player or the car — or runs the WASTED crane
    // shot until the respawn flow ends it.
    if (game.wanted.wastedActive) {
      game.wanted.updateWasted(dt);
    } else {
      const focus = { x: game.player.x, y: game.player.y, z: game.player.z };
      const heading = game.player.vehicle ? game.player.vehicle.heading : game.player.heading;
      game.cameraRig.updateFollow(dt, focus, heading, game.player.speed, !!game.player.vehicle, game.player.aiming);
    }

    // Headlights.
    const lightsOn = game.player.lightsOn && game.player.vehicle;
    headlight.intensity = lightsOn ? 60 : 0;
    if (lightsOn) {
      const v = game.player.vehicle;
      headlight.position.set(v.x, 2.2, v.z);
      headlight.target.position.set(v.x + Math.sin(v.heading) * 30, 0, v.z + Math.cos(v.heading) * 30);
      headlight.target.updateMatrixWorld();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameDt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    fpsFrames += 1;
    fpsTimer += frameDt;
    if (fpsTimer >= 0.5) {
      fps = fpsFrames / fpsTimer;
      fpsFrames = 0;
      fpsTimer = 0;
      quality.update(0.5, fps);
    }
    const pressed = game.input.takePressed();
    accumulator += frameDt;
    let steps = 0;
    let first = true;
    while (accumulator >= STEP && steps < 4) {
      stepGame(STEP, first ? pressed : new Set());
      first = false;
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 4) accumulator = 0;
    game.dialogs.update(frameDt);
    if (game.mode === 'playing') {
      game.hud.update();
      game.minimap.update(frameDt);
      renderTouchWeapons();
    }
    renderer.render(scene, game.cameraRig.camera);
  }

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    game.cameraRig.resize(window.innerWidth, window.innerHeight);
  });
  // First gesture wakes the audio context.
  const wakeAudio = () => game.audio.init();
  window.addEventListener('pointerdown', wakeAudio, { once: false });
  window.addEventListener('keydown', wakeAudio, { once: false });

  // Test hooks: the playtest harness drives the game through these.
  window.__veyport = { game, THREE, renderer, version: 1 };
  window.__veyportReady = true;

  document.getElementById('loading').remove();
  setProgress(100);
  if (shotName) {
    game.menus.hideMenu();
    startPlaying();
    stageShot(game, shotName);
  } else {
    game.menus.showMenu();
  }
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (error) {
  console.error('[veyport] boot failed:', error);
  const loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.textContent = `Failed to start: ${error.message}`;
}
