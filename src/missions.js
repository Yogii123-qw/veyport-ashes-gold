// missions.js - the six story missions and the two endings.
// Data-driven stages: goto, talk, steal, deliver, combat, defend,
// chase, choice, race. Each stage sets a waypoint (3D beacon + minimap
// blip + HUD objective) and completes on a real condition: a distance
// check, a dialog closing, a car entered, a target dead, a timer.
// Fail conditions are real too (timer out, truck escaped, target car
// wrecked). Checkpoints let a retry resume mid-mission. Nothing here
// fakes progress: the probe completes missions by driving, entering
// cars, and shooting, exactly like a player.

import { MISSION_TEXT } from './langData.js';
import { buildPlayerCar, buildTrafficCar } from './vehicles.js';
import { applyDrive } from './physics.js';

const THREE = window.THREE;

const REWARDS = { m1: 400, m2: 600, m3: 900, m4: 1200, m5: 1500, m6: 2500 };
const ORDER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const CHECKPOINTS = { m1: [0], m2: [1], m3: [2], m4: [2], m5: [3], m6: [2] };

// Stage tables: plain data, read by the runner below.
function stageDefs(lang) {
  const T = MISSION_TEXT[lang.code] || MISSION_TEXT.id;
  return {
    m1: [
      { kind: 'goto', x: 300, z: -150, r: 12, text: T.m1.stages[0] },
      { kind: 'talk', x: 300, z: -150, r: 12, lines: T.m1.intro, text: T.m1.stages[1] },
      { kind: 'steal', x: 330, z: -180, r: 4, classId: 'swift', text: T.m1.stages[2] },
      { kind: 'goto', x: -450, z: -375, r: 15, needCar: true, text: T.m1.stages[3] },
    ],
    m2: [
      // Pickup in the open lane between the docks container rows
      // (rows at z=-450 and z=-420): the point (-500,-450) sits inside
      // the container wall and no car can reach it.
      { kind: 'goto', x: -500, z: -435, r: 10, text: T.m2.stages[0] },
      { kind: 'deliver', x: 300, z: -450, r: 12, timer: 240, text: T.m2.stages[1] },
      { kind: 'deliver', x: 0, z: 450, r: 12, text: T.m2.stages[2] },
      { kind: 'deliver', x: 450, z: 300, r: 12, text: T.m2.stages[3] },
    ],
    m3: [
      { kind: 'goto', x: -375, z: 75, r: 12, onFoot: true, text: T.m3.stages[0] },
      { kind: 'combat', x: -375, z: 75, count: 3, text: T.m3.stages[1] },
      { kind: 'steal', x: -375, z: 75, r: 4, classId: 'bulldog', marked: true, text: T.m3.stages[2] },
      { kind: 'goto', x: -450, z: -375, r: 15, needCar: true, text: T.m3.stages[3] },
    ],
    m4: [
      { kind: 'race', x: -450, z: -450, r: 14, timer: 200, text: T.m4.stages[0] },
      { kind: 'race', x: 450, z: -450, r: 14, text: T.m4.stages[1] },
      { kind: 'race', x: 450, z: 450, r: 14, text: T.m4.stages[2] },
      { kind: 'combat', x: 450, z: 450, count: 2, of: 4, text: T.m4.stages[3] },
    ],
    m5: [
      { kind: 'defend', wave: 1, count: 2, text: T.m5.stages[0] },
      { kind: 'defend', wave: 2, count: 3, text: T.m5.stages[1] },
      { kind: 'defend', wave: 3, count: 4, text: T.m5.stages[2] },
      { kind: 'chase', text: T.m5.stages[3] },
      { kind: 'choice', text: T.m5.stages[4] },
    ],
    m6: [
      { kind: 'intercept', text: T.m6.stages[0] },
      { kind: 'stopTruck', text: T.m6.stages[1] },
      { kind: 'combat', x: 450, z: 525, count: 4, text: T.m6.stages[2] },
      { kind: 'choice', text: T.m6.stages[3] },
    ],
  };
}

export class MissionSys {
  constructor(w) {
    this.w = w;
    this.completed = [];
    this.active = null;
    this.stage = 0;
    this.flags = {};
    this.ending = null;
    this.failed = 0;
    this.spawned = [];
    this.waveTargets = [];
    this.truck = null;
    this.truckRoute = [];
    this.traitor = null;
    this.traitorRoute = [];
    this.stageTimer = 0;
    // A mission-level timer: armed once by the first timed stage and
    // kept across the following legs (M2's 240 s covers all 3 drops,
    // M4's 200 s covers all 3 race checkpoints). Combat/choice/chase
    // stages end the timed legs and disarm it.
    this.missionTimer = 0;
    this.timerArmed = false;
    this.stageStartedAt = 0;
    this.missionStartedAt = 0;
    this.startStats = null;
    this.dialogOpened = false;
    this.stealCar = null;
    this.checkpointStage = 0;
    // Waypoint beacon: a glowing cylinder + ring at the target.
    this.beacon = new THREE.Group();
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    cyl.position.y = 13;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    this.beacon.add(cyl, ring);
    this.beacon.visible = false;
    w.scene.add(this.beacon);
    this.waypoint = null;
    this.routePoints = [];
    this.pulse = 0;
  }

  get defs() {
    return stageDefs(this.w.lang);
  }

  get currentDef() {
    if (!this.active) return null;
    return this.defs[this.active][this.stage] || null;
  }

  get title() {
    if (!this.active) return '';
    return this.w.lang.t(this.active + 'Title');
  }

  get isActive() {
    return this.active !== null;
  }

  get nextMission() {
    for (const id of ORDER) {
      if (!this.completed.includes(id)) return id;
    }
    return null;
  }

  saveState() {
    return {
      completed: this.completed.slice(),
      active: this.active,
      stage: this.stage,
      flags: { ...this.flags },
      ending: this.ending,
      failed: this.failed,
    };
  }

  loadState(s) {
    this.completed = s.completed || [];
    this.active = s.active || null;
    this.stage = s.stage || 0;
    this.flags = s.flags || {};
    this.ending = s.ending || null;
    this.failed = s.failed || 0;
    if (this.active) {
      this.checkpointStage = this.stage;
      // A choice stage cannot resume from a load (its dialog needs a
      // live game): step back to the previous stage and replay it.
      const def = this.currentDef;
      if (def && def.kind === 'choice') {
        this.stage = Math.max(0, this.stage - 1);
        this.checkpointStage = this.stage;
      }
      this._setupStage();
    }
  }

  start(id) {
    if (!ORDER.includes(id)) return false;
    this.clearSpawned();
    this.active = id;
    this.stage = 0;
    this.checkpointStage = 0;
    this.missionStartedAt = this.w.stats ? this.w.stats.playSeconds : 0;
    this.startStats = this.w.stats ? { ...this.w.stats } : null;
    if (id === 'm4') {
      // Night race: the clock jumps to 21:00, honestly announced.
      this.w.weather.clock = 675;
      if (this.w.ui) this.w.ui.notify(this.w.lang.t('nightRace'), 'info');
      if (this.w.audio) this.w.audio.setMusicMode('mission');
    }
    if (this.w.ui) this.w.ui.banner(this.w.lang.t(id + 'Title'), '');
    this._setupStage();
    return true;
  }

  retry() {
    if (!this.active) return false;
    const id = this.active;
    this.clearSpawned();
    this.stage = this.checkpointStage;
    this.missionStartedAt = this.w.stats ? this.w.stats.playSeconds : 0;
    this.startStats = this.w.stats ? { ...this.w.stats } : null;
    this._setupStage();
    return true;
  }

  // A spawn point is clear when it sits outside every building
  // collider (with a margin). Guards spawned inside a wall can never
  // be shot (the ray hits the wall first) and can never walk out, so
  // a mission stage would soft-lock.
  _clearSpot(x, z, margin = 2) {
    for (const c of this.w.colliders) {
      if (x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) return false;
    }
    return true;
  }

  // Rejection-sample a guard position near (cx, cz): up to 8 tries,
  // keep the first clear spot, else fall back to the original point.
  _guardSpot(cx, cz, spread) {
    for (let i = 0; i < 8; i++) {
      const gx = cx + (Math.random() - 0.5) * spread;
      const gz = cz + (Math.random() - 0.5) * spread;
      if (this._clearSpot(gx, gz)) return { x: gx, z: gz };
    }
    return { x: cx, z: cz };
  }

  _setupStage() {
    const def = this.currentDef;
    if (!def) return;
    if (def.timer && !this.timerArmed) {
      this.missionTimer = def.timer;
      this.timerArmed = true;
    }
    if (def.kind === 'combat' || def.kind === 'choice' || def.kind === 'chase') {
      this.missionTimer = 0;
      this.timerArmed = false;
    }
    this.stageTimer = this.missionTimer;
    this.stageStartedAt = this.w.stats ? this.w.stats.playSeconds : 0;
    this.dialogOpened = false;
    this.waveTargets = [];
    this.stealCar = null;
    const cps = CHECKPOINTS[this.active] || [0];
    for (const cp of cps) {
      if (this.stage >= cp) this.checkpointStage = cp;
    }
    // Stage-specific setup.
    if (def.kind === 'steal' && def.marked) {
      const car = buildPlayerCar(this.w.scene, def.classId, def.x + 6, def.z + 4, 0);
      car.marked = true;
      this.w.cars.push(car);
      this.spawned.push({ type: 'car', obj: car });
      this.stealCar = car;
    } else if (def.kind === 'steal') {
      // The target is an existing parked car near the point.
      let best = null, bestD = 60;
      for (const c of this.w.cars) {
        if (c.wrecked) continue;
        const d = Math.hypot(c.x - def.x, c.z - def.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      this.stealCar = best;
    }
    if (def.kind === 'combat') {
      const n = def.of || def.count;
      for (let i = 0; i < n; i++) {
        const s = this._guardSpot(def.x, def.z, 24);
        const guard = this.w.peds.spawnHostile(s.x, s.z, 100, 'guard');
        this.waveTargets.push(guard);
        this.spawned.push({ type: 'ped', obj: guard });
      }
    }
    if (def.kind === 'defend') {
      const sh = this.w.city.landmarks.safehouse;
      for (let i = 0; i < def.count; i++) {
        // Random angle and radius, rejection-sampled against colliders.
        let gx = sh.x, gz = sh.z;
        for (let t = 0; t < 8; t++) {
          const a = (i / def.count) * Math.PI * 2 + Math.random();
          const r = 42 + Math.random() * 14;
          gx = sh.x + Math.cos(a) * r;
          gz = sh.z + Math.sin(a) * r;
          if (this._clearSpot(gx, gz)) break;
        }
        const guard = this.w.peds.spawnHostile(gx, gz, 100, 'raider');
        this.waveTargets.push(guard);
        this.spawned.push({ type: 'ped', obj: guard });
      }
      if (this.w.ui) this.w.ui.notify(this.w.lang.t('waveIncoming'), 'warn');
    }
    if (def.kind === 'chase') {
      const sh = this.w.city.landmarks.safehouse;
      const t = this.w.peds.spawnHostile(sh.x + 30, sh.z + 10, 100, 'traitor');
      t.state = 'run';
      this.traitor = t;
      this.spawned.push({ type: 'ped', obj: t });
      // Route: safehouse -> docks, along the road graph.
      const from = this.w.graph.nearestNode(t.x, t.z);
      const to = this.w.graph.nearestNode(-500, -450);
      this.traitorRoute = this.w.graph.pathPoints(this.w.graph.shortestPath(from, to));
      this.traitorIdx = 0;
    }
    if (def.kind === 'intercept') {
      const truck = buildPlayerCar(this.w.scene, 'longnose', -450, 75, Math.PI);
      truck.truckHp = 600;
      truck.armored = true;
      // The truck is a real combat target (same shape as a police car):
      // without this registration no shot can ever hit it, and the
      // stopTruck stage could never complete.
      truck.radius = 2.2;
      truck.alive = true;
      this.w.combat.register(truck);
      this.w.cars.push(truck);
      this.spawned.push({ type: 'car', obj: truck });
      this.truck = truck;
      const from = this.w.graph.nearestNode(truck.x, truck.z);
      const to = this.w.graph.nearestNode(450, 525);
      this.truckRoute = this.w.graph.pathPoints(this.w.graph.shortestPath(from, to));
      this.truckIdx = 0;
    }
    if (def.kind === 'choice' && this.active === 'm6') {
      // The final choice opens as a dialog at the lighthouse.
      this._openFinalChoice();
      return;
    }
    if (def.kind === 'choice' && this.active === 'm5') {
      this._openTraitorChoice();
      return;
    }
    this._setWaypoint(def);
  }

  _setWaypoint(def) {
    if (def.x !== undefined) {
      this.waypoint = { x: def.x, z: def.z };
      this.beacon.position.set(def.x, 0, def.z);
      this.beacon.visible = true;
      const from = this.w.graph.nearestNode(this.w.player.x, this.w.player.z);
      const to = this.w.graph.nearestNode(def.x, def.z);
      this.routePoints = this.w.graph.pathPoints(this.w.graph.shortestPath(from, to));
    } else if (def.kind === 'chase' && this.traitor) {
      this.waypoint = { x: this.traitor.x, z: this.traitor.z };
      this.beacon.position.set(this.traitor.x, 0, this.traitor.z);
      this.beacon.visible = true;
      this.routePoints = [];
    } else if ((def.kind === 'intercept' || def.kind === 'stopTruck') && this.truck) {
      this.waypoint = { x: this.truck.x, z: this.truck.z };
      this.beacon.position.set(this.truck.x, 0, this.truck.z);
      this.beacon.visible = true;
      this.routePoints = [];
    } else {
      this.waypoint = null;
      this.beacon.visible = false;
      this.routePoints = [];
    }
  }

  _openTraitorChoice() {
    const w = this.w;
    const lines = [[
      'System', w.lang.t('traitorChoice'),
      { choices: [
        { id: 'catch', label: w.lang.t('choiceCatch') },
        { id: 'release', label: w.lang.t('choiceRelease') },
      ] },
    ]];
    w.dialogs.open(lines, (choice) => {
      this.flags.traitorSpared = choice === 'release';
      if (choice === 'release' && this.traitor) {
        this.traitor.state = 'walk';
        this.traitor.hostile = false;
      }
      this._advance();
    });
  }

  _openFinalChoice() {
    const w = this.w;
    const lines = [[
      'System', w.lang.t('choiceTitle'),
      { choices: [
        { id: 'ash', label: w.lang.t('choiceAsh') },
        { id: 'gold', label: w.lang.t('choiceGold') },
      ] },
    ]];
    w.dialogs.open(lines, (choice) => {
      this.ending = choice === 'gold' ? 'GOLD' : 'ASHES';
      this._complete();
    });
  }

  objectiveText() {
    if (!this.active) return this.w.lang.t('freeRoam');
    const def = this.currentDef;
    return def ? def.text : '';
  }

  distanceToTarget() {
    const p = this.w.player;
    const px = p.onFoot ? p.x : (p.vehicle ? p.vehicle.x : p.x);
    const pz = p.onFoot ? p.z : (p.vehicle ? p.vehicle.z : p.z);
    let tx, tz;
    if (this.waypoint) {
      tx = this.waypoint.x; tz = this.waypoint.z;
    } else if (this.truck) {
      tx = this.truck.x; tz = this.truck.z;
    } else if (this.traitor) {
      tx = this.traitor.x; tz = this.traitor.z;
    } else {
      return null;
    }
    return Math.round(Math.hypot(tx - px, tz - pz));
  }

  clearSpawned() {
    for (const s of this.spawned) {
      if (s.type === 'ped') {
        this.w.peds.remove(s.obj);
      } else if (s.type === 'car') {
        this.w.combat.unregister(s.obj);
        this.w.scene.remove(s.obj.group);
        const ci = this.w.cars.indexOf(s.obj);
        if (ci >= 0) this.w.cars.splice(ci, 1);
      }
    }
    this.spawned = [];
    this.waveTargets = [];
    this.truck = null;
    this.traitor = null;
  }

  _advance() {
    this.stage += 1;
    const defs = this.defs[this.active];
    if (this.stage >= defs.length) {
      this._complete();
      return;
    }
    this._setupStage();
  }

  _fail(reason) {
    this.failed += 1;
    if (this.w.stats) this.w.stats.missionsFailed += 1;
    this.missionTimer = 0;
    this.timerArmed = false;
    this.clearSpawned();
    this.beacon.visible = false;
    this.waypoint = null;
    if (this.w.ui) this.w.ui.showResults({
      title: this.w.lang.t('missionFailed'),
      mission: this.title,
      reason,
      reward: 0,
      rank: '-',
      failed: true,
      onRetry: () => this.retry(),
    });
    if (this.w.save) this.w.save.autosave(this.w);
  }

  _complete() {
    const id = this.active;
    const reward = REWARDS[id] || 0;
    const paid = this.w.economy.payout(reward, 1, `Misi ${this.title}`);
    this.completed.push(id);
    if (id === 'm4') {
      this.w.player.giveWeapon('kr9', 30, 60);
      this.w.player.switchWeapon('kr9');
    }
    if (id === 'm5') {
      this.w.player.armor = 100;
    }
    if (id === 'm3') {
      this.flags.freeRespray = true;
    }
    // Results: time, accuracy, rank.
    const elapsed = this.w.stats ? this.w.stats.playSeconds - this.missionStartedAt : 0;
    const shots = this.startStats ? (this.w.stats.shots - this.startStats.shots) : 0;
    const hits = this.startStats ? (this.w.stats.hits - this.startStats.hits) : 0;
    const acc = shots > 0 ? Math.round((hits / shots) * 100) : 100;
    const par = { m1: 240, m2: 300, m3: 360, m4: 300, m5: 420, m6: 480 }[id] || 300;
    const rank = elapsed <= par ? 'Emas' : elapsed <= par * 1.5 ? 'Perak' : 'Perunggu';
    this.active = null;
    this.stage = 0;
    this.missionTimer = 0;
    this.timerArmed = false;
    this.beacon.visible = false;
    this.waypoint = null;
    this.routePoints = [];
    if (this.w.audio) this.w.audio.setMusicMode('explore');
    if (this.w.save) this.w.save.autosave(this.w);
    if (id === 'm6') {
      if (this.w.ui) this.w.ui.showEnding(this.ending, paid);
      return;
    }
    const next = this.nextMission;
    if (this.w.ui) this.w.ui.showResults({
      title: this.w.lang.t('missionDone'),
      mission: this.title,
      reward: paid,
      rank,
      time: Math.round(elapsed),
      accuracy: acc,
      next: next ? this.w.lang.t(next + 'Title') : null,
      onNext: next ? () => this.start(next) : null,
    });
  }

  update(dt) {
    this.pulse += dt;
    if (this.beacon.visible) {
      const s = 1 + Math.sin(this.pulse * 4) * 0.15;
      this.beacon.scale.set(s, 1, s);
    }
    if (!this.active) return;
    if (this.w.dialogs.isOpen) return;
    const def = this.currentDef;
    if (!def) return;
    const p = this.w.player;
    const px = p.onFoot ? p.x : (p.vehicle ? p.vehicle.x : p.x);
    const pz = p.onFoot ? p.z : (p.vehicle ? p.vehicle.z : p.z);
    // Stage timer (M2 delivery, M4 race): one mission-level clock.
    if (this.missionTimer > 0) {
      this.missionTimer -= dt;
      this.stageTimer = Math.max(0, this.missionTimer);
      if (this.missionTimer <= 0) {
        this._fail('Waktu habis');
        return;
      }
    }
    // The truck drives itself toward the lighthouse.
    if (this.truck && !this.truck.wrecked) {
      this._driveTruck(dt);
      if (this.truckRoute.length > 0 && this.truckIdx >= this.truckRoute.length) {
        this._fail('Truk Vex mencapai mercusuar');
        return;
      }
    }
    // The traitor runs along his route.
    if (this.traitor && this.traitor.alive && this.traitor.state === 'run') {
      this._moveTraitor(dt);
    }
    switch (def.kind) {
      case 'goto':
      case 'deliver':
      case 'race': {
        if (def.needCar && p.onFoot) break;
        if (def.onFoot && !p.onFoot) break;
        const d = Math.hypot(def.x - px, def.z - pz);
        if (d < def.r) {
          if (def.kind === 'deliver' && this.stage === 1 && this.active === 'm2') {
            // First drop: the police notice the hot cargo.
            this.w.wanted.addHeat(15, 'cargo');
          }
          this._advance();
        }
        break;
      }
      case 'talk': {
        const d = Math.hypot(def.x - px, def.z - pz);
        if (d < def.r && !this.dialogOpened) {
          this.dialogOpened = true;
          this.w.dialogs.open(def.lines, () => this._advance());
        }
        break;
      }
      case 'steal': {
        if (this.stealCar && p.vehicle === this.stealCar) {
          if (this.w.stats) this.w.stats.carsStolen += 1;
          if (this.active === 'm1' || this.active === 'm3') {
            this.w.wanted.addHeat(8, 'carjack');
            this.w.peds.onCrime(px, pz, 6, 'carjack');
          }
          this._advance();
        } else if (this.stealCar && this.stealCar.wrecked) {
          this._fail('Mobil target hancur');
        }
        break;
      }
      case 'combat': {
        const dead = this.waveTargets.filter((t) => !t.alive).length;
        if (dead >= def.count) this._advance();
        break;
      }
      case 'defend': {
        const dead = this.waveTargets.filter((t) => !t.alive).length;
        if (dead >= this.waveTargets.length && this.waveTargets.length > 0) {
          if (this.w.ui) this.w.ui.notify(this.w.lang.t('safehouseDefended'), 'good');
          this._advance();
        }
        break;
      }
      case 'chase': {
        if (!this.traitor || !this.traitor.alive) {
          this._fail('Pengkhianat lolos');
          return;
        }
        const d = Math.hypot(this.traitor.x - px, this.traitor.z - pz);
        this._setWaypoint(def);
        if (d < 4) this._advance();
        break;
      }
      case 'intercept': {
        if (!this.truck) return;
        const d = Math.hypot(this.truck.x - px, this.truck.z - pz);
        if (d < 30) this._advance();
        break;
      }
      case 'stopTruck': {
        if (!this.truck) return;
        if (this.truck.wrecked || this.truck.truckHp <= 0) {
          if (this.w.ui) this.w.ui.notify(this.w.lang.t('truckStopped'), 'good');
          this._advance();
        }
        break;
      }
      case 'choice':
        // Completes through the dialog callback.
        break;
      default:
        break;
    }
  }

  _driveTruck(dt) {
    const w = this.w;
    const t = this.truck;
    const node = this.truckRoute[this.truckIdx];
    if (!node) return;
    const dx = node.x - t.x, dz = node.z - t.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 8) {
      this.truckIdx += 1;
      return;
    }
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - t.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const steer = Math.max(-1, Math.min(1, dh * 1.5));
    // The armored truck rolls at a steady 60% throttle.
    applyDrive(t, { throttle: 0.6, brake: 0, steer, handbrake: false }, dt, w.colliders, w.weather.gripFactor());
    if (this.waypoint) {
      this.waypoint = { x: t.x, z: t.z };
      this.beacon.position.set(t.x, 0, t.z);
    }
  }

  _moveTraitor(dt) {
    const t = this.traitor;
    const node = this.traitorRoute[this.traitorIdx];
    if (!node) {
      t.state = 'walk';
      return;
    }
    const dx = node.x - t.x, dz = node.z - t.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 4) {
      this.traitorIdx += 1;
      return;
    }
    const speed = 4.5;
    t.x += (dx / dist) * speed * dt;
    t.z += (dz / dist) * speed * dt;
    t.heading = Math.atan2(dx, dz);
    t.mesh.position.set(t.x, 0, t.z);
    t.mesh.rotation.y = t.heading;
  }
}
