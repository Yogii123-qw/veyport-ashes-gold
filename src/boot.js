// boot.js - Veyport entry module.
// Owns the renderer, the fixed-timestep loop with render interpolation,
// world wiring, HUD + minimap, menu/pause/map overlays, and the
// BUSTED/WASTED flow. The camera updates LAST in every frame (P7).

import { buildCity } from './city.js';
import { buildRoadGraph } from './roadgraph.js';
import { buildPlayerCar, buildTrafficCar, buildHeli } from './vehicles.js';
import { Player } from './player.js';
import { GameInput } from './input.js';
import { CameraRig } from './camera.js';
import { Weather } from './weather.js';
import { Economy } from './economy.js';
import { Lang } from './langData.js';
import { DialogSys } from './dialogs.js';
import { SaveSys } from './save.js';
import { AudioSys } from './audio.js';
import { FxSys } from './effects.js';
import { applyDrive } from './physics.js';
import { CombatSys } from './combat.js';
import { PedSys } from './pedestrians.js';
import { TrafficSys } from './traffic.js';
import { WantedSys } from './wanted.js';
import { MissionSys } from './missions.js';
import { ContractSys } from './contracts.js';
import { UiSys } from './ui.js';
import { HudSys } from './hud.js';
import { MinimapSys } from './minimap.js';

const THREE = window.THREE;
const STEP = 1 / 60;

function el(id) {
  return document.getElementById(id);
}

function shortArc(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// A random road node near a point (traffic spawns and respawns).
function randomNodeNear(graph, x, z, radius) {
  const near = graph.nodes.filter((n) => Math.hypot(n.x - x, n.z - z) <= radius);
  if (near.length > 0) return near[Math.floor(Math.random() * near.length)];
  return graph.nodePos(graph.nearestNode(x, z));
}

export function boot() {
  const canvas = el('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8c8);
  scene.fog = new THREE.Fog(0x87a8c8, 120, 900);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3230, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 300;
  scene.add(sun);
  scene.add(sun.target);

  // World.
  const graph = buildRoadGraph();
  const city = buildCity(scene);
  const colliders = city.colliders;
  const weather = new Weather(7);
  const economy = new Economy(800);

  // Player starts on foot at the safehouse, next to the parked Seraph.
  const player = new Player(city.playerStart.x, city.playerStart.z, city.playerStart.heading);
  scene.add(player.group);

  // Cars: the parked spots from the city are all drivable; the safehouse
  // Seraph (first spot) is the player's first car.
  const cars = [];
  for (const spot of city.parkedSpots) {
    cars.push(buildPlayerCar(scene, spot.classId, spot.x, spot.z, spot.heading));
  }
  const seraph = cars[0];
  const traffic = [];
  const trafficClasses = ['pico', 'swift', 'bulldog', 'komodo', 'longnose', 'cab', 'vagabond', 'hauler'];
  for (let i = 0; i < 8; i++) {
    const n = randomNodeNear(graph, (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800, 200);
    const cls = trafficClasses[i % trafficClasses.length];
    const t = buildTrafficCar(scene, cls, n.x, n.z, Math.random() * Math.PI * 2);
    t.route = [];
    t.stuck = 0;
    cars.push(t);
    traffic.push(t);
  }

  // Police helicopter, hovering over the station (visual; F5 crane target).
  const heli = buildHeli(scene, 350, 60, -450);
  heli.group.rotation.y = 0.8;

  // Camera.
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  const rig = new CameraRig(camera, colliders);
  rig.snapTo({ x: player.x, y: 1.4, z: player.z, heading: player.heading });

  // Input.
  const input = new GameInput(canvas);

  // Phase B systems, sharing one world context. Systems reference each
  // other through `w` (w.wanted, w.missions, ...) so no module imports
  // another gameplay module directly.
  const lang = new Lang('id');
  const stats = { playSeconds: 0, distanceM: 0, carsStolen: 0, shots: 0, hits: 0, missionsFailed: 0 };
  const settings = { lang: 'id', master: 0.8, music: 0.5, sfx: 0.8 };
  const w = {
    scene, graph, city, colliders, player, cars, traffic, heli,
    weather, economy, rig, input, lang, stats, settings,
    onBustedStart: null, onWastedStart: null, onRespawn: null,
  };
  const dialogs = new DialogSys();
  const save = new SaveSys();
  const audio = new AudioSys();
  const fx = new FxSys(scene);
  const combat = new CombatSys(w);
  const peds = new PedSys(w);
  const trafficSys = new TrafficSys(w);
  const wanted = new WantedSys(w);
  const missions = new MissionSys(w);
  const contracts = new ContractSys(w);
  const ui = new UiSys(w);
  const hud = new HudSys(w);
  const minimap = new MinimapSys(w);
  Object.assign(w, { dialogs, save, audio, fx, combat, peds, trafficSys, wanted, missions, contracts, ui, hud, minimap, physics: { applyDrive } });
  // The heli belongs to the wanted system for the F5 crane shot.
  w.heli = heli;

  // Game state.
  let mode = 'menu'; // menu | playing | paused | map | busted | wasted
  let prevMode = 'playing';
  let simTime = 0;
  let accumulator = 0;
  let lastNow = performance.now();
  let frames = 0;
  let fpsTime = 0;
  let fps = 0;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

  // Render-interpolation snapshots of the focus entity.
  let prevFocus = { x: player.x, y: 1.4, z: player.z, heading: player.heading, speed: 0 };
  let currFocus = { ...prevFocus };

  function focusOf() {
    if (player.onFoot) {
      return { x: player.x, y: 1.4, z: player.z, heading: player.heading, speed: player.speed, mode: 'foot' };
    }
    const v = player.vehicle;
    return { x: v.x, y: 1.2, z: v.z, heading: v.heading, speed: Math.abs(v.speed), mode: 'drive', vx: v.vx || 0, vz: v.vz || 0 };
  }

  function snapshotFocus() {
    prevFocus = currFocus;
    currFocus = focusOf();
  }

  function interpFocus(alpha) {
    return {
      x: prevFocus.x + (currFocus.x - prevFocus.x) * alpha,
      y: prevFocus.y + (currFocus.y - prevFocus.y) * alpha,
      z: prevFocus.z + (currFocus.z - prevFocus.z) * alpha,
      heading: prevFocus.heading + shortArc(prevFocus.heading, currFocus.heading) * alpha,
      speed: currFocus.speed,
      mode: currFocus.mode,
      vx: currFocus.vx || 0, vz: currFocus.vz || 0,
    };
  }

  // --- Simulation step (fixed 60 Hz) ---
  function step(dt) {
    simTime += dt;
    weather.step(dt);
    // Sun follows the day cycle.
    const day = weather.daylight();
    const ang = weather.sunAngle;
    sun.position.set(Math.cos(ang) * 120, 40 + Math.sin(ang) * 80, Math.sin(ang) * 120);
    sun.intensity = 0.4 + day * 1.3;
    hemi.intensity = 0.35 + day * 0.55;
    scene.background.setHex(day > 0.55 ? 0x87a8c8 : day > 0.15 ? 0x9a7a5a : 0x1a2438);
    scene.fog.color.copy(scene.background);
    scene.fog.far = Math.min(900, weather.visibility());
    heli.group.rotation.y += dt * 0.15;
    if (heli.rotor) heli.rotor.rotation.y += dt * 22;

    // The wanted flow timer runs on EVERY step, dialogs or not (P5):
    // a busted/wasted sequence never freezes behind an open dialog.
    wanted.tickFlow(dt);

    // A dialog freezes the player's control, traffic, pedestrians,
    // missions and contracts, but never the flow timer above, the
    // weather, the wanted AI, or the effects.
    const dialogOpen = dialogs.isOpen;
    const playing = mode === 'playing' && !dialogOpen;

    // Player.
    if (playing) {
      const mv = input.moveVector();
      const ctrl = { moveX: mv.x, moveY: mv.y, run: input.run };
      const camYaw = rig.yaw;
      player.aiming = input.fireHeld && player.onFoot;
      // Aiming turns the player toward the camera yaw.
      if (player.aiming) {
        let dh = camYaw - player.heading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        player.heading += dh * Math.min(1, dt * 14);
        player.group.rotation.y = player.heading;
      }
      player.step(dt, ctrl, colliders, camYaw);
      // Enter / exit.
      if (input.takeAction()) {
        if (player.onFoot) {
          const car = player.tryEnter(cars);
          if (car) {
            setTimeout(() => rig.snapTo(focusOf()), 650);
          }
        } else {
          if (player.tryExit()) setTimeout(() => rig.snapTo(focusOf()), 450);
        }
      }
      // Weapons.
      const wq = input.takeWeapon();
      if (wq !== null) {
        const ids = Object.keys(player.owned);
        const id = ids[wq - 1];
        if (id) player.switchWeapon(id);
      }
      if (input.takeReload()) player.reload();
      if (input.fireHeld && player.onFoot) combat.tryShoot();
      // Drive the player's car.
      if (!player.onFoot && player.vehicle) {
        const dc = input.driveControls();
        const v = player.vehicle;
        const res = applyDrive(v, { throttle: dc.throttle, brake: dc.brake, steer: dc.steer, handbrake: dc.handbrake }, dt, colliders, weather.gripFactor());
        const crash = res.crash;
        if (crash && crash.impact > 4) {
          fx.crashSparks(v.x, 1, v.z, crash.impact);
          audio.crash(crash.impact);
          wanted.addHeat(2, 'crash');
        }
        if (res.drifting) {
          fx.tireSmoke(v.x - Math.sin(v.heading) * 1.4, 0.2, v.z - Math.cos(v.heading) * 1.4);
        }
        // Car wrecked under the player: eject with damage.
        if (v.wrecked) {
          fx.explosion(v.x, 1, v.z);
          audio.explosion();
          player.hp -= 30;
          const px = v.x + Math.cos(v.heading) * 2.2;
          const pz = v.z - Math.sin(v.heading) * 2.2;
          player.vehicle = null;
          player.onFoot = true;
          player.group.visible = true;
          player.x = px; player.z = pz;
          player.group.position.set(px, 0, pz);
          rig.snapTo(focusOf());
        }
        // Camera trauma only from the player's own impacts (P7).
        if (crash && crash.impact > 4) rig.addTrauma(Math.min(0.5, crash.impact * 0.03), 0, crash.impact, true);
      }
    }

    // World systems (frozen while a dialog is open).
    if (!dialogOpen) {
      trafficSys.update(dt);
      peds.update(dt);
      missions.update(dt);
      contracts.update(dt);
    }
    wanted.update(dt);
    combat.update(dt);
    fx.update(dt);
    audio.update(dt);
    dialogs.update(dt);
    ui.update(dt);
    // Engine hum + rain follow the player's car and the weather.
    const pv = player.vehicle;
    const rpm = pv ? Math.min(1, Math.abs(pv.speed) / pv.def.top) : 0;
    const throttle = pv ? (input.driveControls().throttle || 0) : 0;
    audio.setEngine(rpm, throttle);
    audio.setRain(weather.rainAmount);
    audio.setMusicMode(wanted.stars >= 2 ? 'tension' : (missions.isActive ? 'mission' : 'explore'));
    stats.playSeconds += dt;
    stats.distanceM += (player.onFoot ? player.speed : (pv ? Math.abs(pv.speed) : 0)) * dt;
    snapshotFocus();
  }

  // --- Overlays ---
  function setMode(m) {
    mode = m;
    el('menu').style.display = m === 'menu' ? 'flex' : 'none';
    el('pauseMenu').style.display = m === 'paused' ? 'flex' : 'none';
    el('mapOverlay').style.display = m === 'map' ? 'flex' : 'none';
    el('bustedOverlay').style.display = m === 'busted' ? 'flex' : 'none';
    // The WASTED overlay is owned by the wanted flow: it appears only
    // after the F5 crane finishes, and hides when the flow ends.
    el('hud').style.display = (m === 'playing' || m === 'busted' || m === 'wasted') ? 'block' : 'none';
  }

  function showWasted() {
    prevMode = 'playing';
    // F5: the camera rises to the police helicopter and watches the scene.
    rig.startCrane({ x: heli.group.position.x, y: heli.group.position.y, z: heli.group.position.z });
    setMode('wasted');
  }

  function showBusted() {
    prevMode = 'playing';
    setMode('busted');
  }

  function respawn() {
    player.hp = 100;
    player.armor = 0;
    economy.spend(150, 'Biaya rumah sakit / denda');
    player.x = city.playerStart.x;
    player.z = city.playerStart.z;
    player.heading = city.playerStart.heading;
    player.onFoot = true;
    player.vehicle = null;
    player.group.visible = true;
    player.group.position.set(player.x, 0, player.z);
    rig.setMode('foot');
    rig.snapTo(focusOf());
    setMode('playing');
  }

  // The wanted flow owns the BUSTED/WASTED buttons: tapping LANJUTKAN
  // tells the flow to finish (penalties + respawn), it never respawns
  // directly, so the flow timer stays in charge (P5).
  w.onBustedStart = showBusted;
  w.onWastedStart = showWasted;
  w.onRespawn = respawn;

  el('btnStart').addEventListener('click', () => {
    audio.ensure();
    setMode('playing');
    rig.snapTo(focusOf());
    // First play: mission 1 starts at the bar.
    if (!missions.isActive && missions.completed.length === 0 && !save.hasAutosave()) {
      missions.start('m1');
    }
  });
  el('btnResume').addEventListener('click', () => setMode('playing'));
  el('btnQuitToMenu').addEventListener('click', () => setMode('menu'));
  el('btnWastedContinue').addEventListener('click', () => wanted.continueFlow());
  el('btnBustedContinue').addEventListener('click', () => wanted.continueFlow());
  el('btnCloseMap').addEventListener('click', () => setMode('playing'));
  // Audio needs a gesture: unlock on the first key or touch anywhere.
  const unlockAudio = () => audio.ensure();
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true });

  // --- HUD + minimap (owned by hud.js / minimap.js) ---
  const mm = el('minimap').getContext('2d');
  const bigMap = el('bigMap').getContext('2d');

  function mapData() {
    return {
      waypoint: missions.waypoint,
      routePoints: missions.routePoints,
      police: wanted.units,
      contractWp: contracts.waypoint(),
    };
  }

  function updateHud() {
    hud.update();
    minimap.draw(mm, 150, 150, 150 / 500, player.x, player.z, mapData());
  }

  // --- Main loop ---
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Save on exit (autosave slot) and load it back on boot.
  window.addEventListener('beforeunload', () => {
    save.autosave(w);
  });
  const loadedSave = save.readAutosave();
  if (loadedSave) {
    save.apply(loadedSave, w);
    if (w.lang && loadedSave.settings && loadedSave.settings.lang) {
      lang.set(loadedSave.settings.lang);
      settings.lang = loadedSave.settings.lang;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dtRaw = Math.min(0.25, (now - lastNow) / 1000);
    lastNow = now;
    frames += 1;
    fpsTime += dtRaw;
    if (fpsTime >= 1) {
      fps = Math.round(frames / fpsTime);
      frames = 0; fpsTime = 0;
    }
    // Input-level toggles (work in every mode).
    if (input.takePause()) {
      if (mode === 'playing') setMode('paused');
      else if (mode === 'paused') setMode('playing');
    }
    if (input.takeMap()) {
      if (mode === 'playing') setMode('map');
      else if (mode === 'map') setMode('playing');
    }
    // Pause freezes physics but keeps rendering; busted/wasted keep the
    // world ticking behind the dialog (P5).
    const ticking = mode === 'playing' || mode === 'busted' || mode === 'wasted';
    if (ticking) {
      accumulator += dtRaw;
      let guard = 0;
      while (accumulator >= STEP && guard < 5) {
        step(STEP);
        accumulator -= STEP;
        guard += 1;
      }
      if (guard >= 5) accumulator = 0;
    }
    // Camera LAST, reading the interpolated focus (P7).
    const alpha = Math.min(1, accumulator / STEP);
    const focus = interpFocus(alpha);
    const look = input.consumeLook();
    rig.setMode(mode === 'menu' ? 'menu' : (player.onFoot ? (player.aiming ? 'aim' : 'foot') : 'drive'));
    if (mode !== 'menu') rig.update(dtRaw, focus, { look });
    else rig.update(dtRaw, { x: 0, y: 8, z: -200, heading: 0.6, speed: 0, mode: 'menu' }, {});
    renderer.render(scene, camera);
    if (mode === 'map') minimap.draw(bigMap, 520, 520, 520 / 1400, 0, 0, mapData());
    updateHud();
  }

  window.__veyport = {
    version: 'r4-b',
    scene, renderer, player, cars, traffic, weather, economy, rig, colliders,
    graph, city, input, heli, lang, stats, settings,
    systems: { dialogs, save, audio, fx, combat, peds, trafficSys, wanted, missions, contracts, ui, hud, minimap },
    missions, wanted, combat, peds, contracts, dialogs, save, audio, fx, ui,
    mode: () => mode,
    showWasted, showBusted, respawn,
    errors,
    get drawCalls() { return renderer.info.render.calls; },
    get fps() { return fps; },
    get ready() { return true; },
    // Test hook: run the fixed-timestep simulation synchronously for
    // `seconds` of game time, without waiting on the render loop.
    // Drives the real step() (physics, missions, wanted, combat) so a
    // headless probe can play missions at full speed.
    simulate(seconds) {
      const n = Math.max(0, Math.round(seconds / STEP));
      for (let i = 0; i < n; i++) step(STEP);
      return { steps: n, mode };
    },
  };
  setMode('menu');
  snapshotFocus();
  requestAnimationFrame(frame);
}
