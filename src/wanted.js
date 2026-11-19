// wanted.js - heat, five wanted stars, police AI, roadblocks, the
// helicopter, and the BUSTED / WASTED flow.
// Heat is the currency: crimes add it, hiding bleeds it off. Stars are
// derived from heat, so a star only falls when the heat does.
// The flow (arrest / hospital) is a state machine driven by tickFlow,
// which boot calls on EVERY step, even while a mission dialog is open
// (P5): the timer never freezes behind a dialog.
// WASTED runs the F5 crane first: the camera rises to the police
// helicopter and only then does the WASTED screen appear.

import { buildTrafficCar } from './vehicles.js';
import { applyDrive } from './physics.js';

const THREE = window.THREE;

export const HEAT_THRESHOLDS = [12, 28, 48, 72, 92];
export const UNITS_PER_STAR = [0, 1, 2, 4, 6, 8];
export const HEAT_VALUES = {
  crash: 2, carjack: 8, shot: 10, killPed: 15, killHostile: 6,
  killCop: 25, witness: 6, explosion: 12, runover: 10, speeding: 0,
};
const SAFEHOUSE_HIDE_R = 22;
const BUSTED_FINE = 200;
const HOSPITAL_FINE = 200;

export class WantedSys {
  constructor(w) {
    this.w = w;
    this.heat = 0;
    this.stars = 0;
    this.units = [];
    this.roadblocks = [];
    this.unseenTimer = 0;
    this.lastKnown = null;
    this.playerShotFirst = false;
    this.flow = { kind: null, phase: 'idle', t: 0, continueRequested: false };
    this.heliHome = { x: 350, y: 60, z: -450 };
    this.bustedHold = 0;
  }

  starsFor(heat) {
    let s = 0;
    for (let i = 0; i < HEAT_THRESHOLDS.length; i++) {
      if (heat >= HEAT_THRESHOLDS[i]) s = i + 1;
    }
    return s;
  }

  addHeat(amount, source) {
    if (amount <= 0) return;
    // Vigilante amnesty: while a vigilante contract runs, the takedown
    // itself (shots, hostile kills) never raises wanted. Other crimes
    // still count, and the contract fails if stars rise anyway.
    const ct = this.w.contracts;
    if (ct && ct.active && ct.active.type === 'vigilante' && (source === 'shot' || source === 'kill-hostile')) return;
    const before = this.stars;
    this.heat = Math.min(100, this.heat + amount);
    this.stars = this.starsFor(this.heat);
    this.lastKnown = { x: this.w.player.x, z: this.w.player.z };
    if (this.stars > before) {
      if (this.w.ui) this.w.ui.notify(this.w.lang.t('heatRising'), 'warn');
      if (this.w.audio) this.w.audio.setSiren(true);
    }
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.playerShotFirst = false;
    this._despawnUnits();
    this._clearRoadblocks();
    if (this.w.audio) this.w.audio.setSiren(false);
  }

  onPlayerShot() {
    this.playerShotFirst = true;
    this.addHeat(HEAT_VALUES.shot, 'shot');
    if (this.w.peds) this.w.peds.onGunshot(this.w.player.x, this.w.player.z);
  }

  // --- Police units ---
  _spawnUnit() {
    const w = this.w;
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 60;
    const x = Math.max(-600, Math.min(600, w.player.x + Math.cos(a) * r));
    const z = Math.max(-600, Math.min(600, w.player.z + Math.sin(a) * r));
    const edge = w.graph.nearestEdge(x, z);
    const sx = edge ? edge.x : x;
    const sz = edge ? edge.z : z;
    const car = buildTrafficCar(w.scene, 'interceptor', sx, sz, edge ? edge.heading : 0);
    car.route = [];
    car.stuck = 0;
    // The car itself is the combat target: its live x/z, its damage
    // pool, and the wreck rule in combat do the work.
    car.radius = 2.2;
    car.alive = true;
    car.onHit = (dmg) => { /* damage already applied to car.damage */ };
    car.onDie = () => { this._onCopKilled(unit); };
    w.cars.push(car);
    const unit = {
      car, state: 'pursue', stateTimer: 0, shootTimer: 1 + Math.random(),
      target: null, route: [], nodeIdx: 0, searchAngle: Math.random() * Math.PI * 2,
    };
    this.units.push(unit);
    w.combat.register(car);
    unit.combatTarget = car;
    return unit;
  }

  _onCopKilled(unit) {
    this.addHeat(HEAT_VALUES.killCop, 'kill-cop');
    unit.car.wrecked = true;
    unit.car.speed = 0;
    if (this.w.fx) this.w.fx.explosion(unit.car.x, 1, unit.car.z);
    if (this.w.audio) this.w.audio.explosion();
  }

  _despawnUnits() {
    const w = this.w;
    for (const u of this.units) {
      if (u.combatTarget) w.combat.unregister(u.combatTarget);
      w.scene.remove(u.car.group);
      const ci = w.cars.indexOf(u.car);
      if (ci >= 0) w.cars.splice(ci, 1);
    }
    this.units = [];
  }

  _syncUnits() {
    const want = UNITS_PER_STAR[this.stars] || 0;
    while (this.units.length < want) this._spawnUnit();
    while (this.units.length > want) {
      const u = this.units.pop();
      if (u.combatTarget) this.w.combat.unregister(u.combatTarget);
      this.w.scene.remove(u.car.group);
      const ci = this.w.cars.indexOf(u.car);
      if (ci >= 0) this.w.cars.splice(ci, 1);
    }
  }

  // --- Roadblocks ---
  _spawnRoadblock() {
    const w = this.w;
    const p = w.player;
    const hx = p.onFoot ? Math.sin(p.heading) : Math.sin(p.vehicle.heading);
    const hz = p.onFoot ? Math.cos(p.heading) : Math.cos(p.vehicle.heading);
    const ax = p.x + hx * 85, az = p.z + hz * 85;
    const edge = w.graph.nearestEdge(ax, az);
    if (!edge) return;
    const bx = edge.x, bz = edge.z;
    const perpX = -Math.cos(edge.heading), perpZ = Math.sin(edge.heading);
    const cars = [];
    for (const side of [-1, 1]) {
      const car = buildTrafficCar(w.scene, 'interceptor', bx + perpX * side * 4.5, bz + perpZ * side * 4.5, edge.heading + Math.PI / 2);
      w.cars.push(car);
      cars.push(car);
    }
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xc03028 });
    const barriers = [];
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 0.5), barrierMat);
      b.position.set(bx + perpX * side * 1.2, 0.55, bz + perpZ * side * 1.2);
      b.rotation.y = edge.heading;
      w.scene.add(b);
      const s = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 0.52), stripeMat);
      s.position.set(bx + perpX * side * 1.2, 0.95, bz + perpZ * side * 1.2);
      s.rotation.y = edge.heading;
      w.scene.add(s);
      barriers.push(b, s);
    }
    this.roadblocks.push({ x: bx, z: bz, cars, barriers });
    if (w.ui) w.ui.notify(w.lang.t('roadblockAhead'), 'warn');
  }

  _clearRoadblocks() {
    const w = this.w;
    for (const rb of this.roadblocks) {
      for (const c of rb.cars) {
        w.scene.remove(c.group);
        const ci = w.cars.indexOf(c);
        if (ci >= 0) w.cars.splice(ci, 1);
      }
      for (const b of rb.barriers) w.scene.remove(b);
    }
    this.roadblocks = [];
  }

  _syncRoadblocks() {
    if (this.stars >= 3 && this.roadblocks.length === 0) {
      this._spawnRoadblock();
    } else if (this.stars < 3 && this.roadblocks.length > 0) {
      this._clearRoadblocks();
    }
    // Remove a roadblock the player already passed.
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      const d = Math.hypot(rb.x - this.w.player.x, rb.z - this.w.player.z);
      if (d < 18) {
        for (const c of rb.cars) {
          this.w.scene.remove(c.group);
          const ci = this.w.cars.indexOf(c);
          if (ci >= 0) this.w.cars.splice(ci, 1);
        }
        for (const b of rb.barriers) this.w.scene.remove(b);
        this.roadblocks.splice(i, 1);
      }
    }
  }

  // --- Per-frame update (heat, units, roadblocks, heli, arrest) ---
  update(dt) {
    const w = this.w;
    const p = w.player;
    // Seen: a unit within 90 m, unless hiding at the safehouse.
    const sh = w.city.landmarks.safehouse;
    const hiding = Math.hypot(p.x - sh.x, p.z - sh.z) < SAFEHOUSE_HIDE_R && this.stars <= 2;
    let seen = false;
    for (const u of this.units) {
      if (Math.hypot(u.car.x - p.x, u.car.z - p.z) < 90) { seen = true; break; }
    }
    if (seen && !hiding) {
      this.unseenTimer = 0;
      this.lastKnown = { x: p.x, z: p.z };
    } else {
      this.unseenTimer += dt;
      if (this.unseenTimer > 5) {
        const night = w.weather.daylight() < 0.25;
        const decay = 1.2 * (night || w.weather.isWet() ? 1.6 : 1);
        const before = this.stars;
        this.heat = Math.max(0, this.heat - decay * dt);
        this.stars = this.starsFor(this.heat);
        if (this.stars < before && this.stars === 0 && w.audio) w.audio.setSiren(false);
      }
    }
    this._syncUnits();
    this._syncRoadblocks();
    // Helicopter: stars >= 4 parks it over the player, else it goes home.
    if (w.heli) {
      const target = this.stars >= 4
        ? { x: p.x, y: 55, z: p.z }
        : this.heliHome;
      const hg = w.heli.group.position;
      hg.x += (target.x - hg.x) * Math.min(1, dt * 0.5);
      hg.y += (target.y - hg.y) * Math.min(1, dt * 0.5);
      hg.z += (target.z - hg.z) * Math.min(1, dt * 0.5);
      if (this.stars >= 4) w.heli.group.lookAt(p.x, 0, p.z);
    }
    // Police AI + arrest check.
    for (const u of this.units) this._unitStep(u, dt);
    // Roadblock cars are solid to the player's car.
    if (!p.onFoot && p.vehicle) {
      for (const rb of this.roadblocks) {
        for (const c of rb.cars) {
          const dx = c.x - p.vehicle.x, dz = c.z - p.vehicle.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.01 && d < 4.2) {
            const push = (4.2 - d) / 2;
            p.vehicle.x -= (dx / d) * push;
            p.vehicle.z -= (dz / d) * push;
          }
        }
      }
    }
    // Wasted check (hp hit zero by any source).
    if (p.hp <= 0 && this.flow.kind === null) this.triggerWasted();
    // Busted check: a unit touching a stopped player.
    if (this.stars >= 1 && this.flow.kind === null) {
      const speed = p.onFoot ? p.speed : Math.abs(p.vehicle ? p.vehicle.speed : 0);
      let touching = false;
      for (const u of this.units) {
        if (Math.hypot(u.car.x - p.x, u.car.z - p.z) < 3.5) { touching = true; break; }
      }
      if (touching && speed < 1.5) {
        this.bustedHold += dt;
        if (this.bustedHold > 1.2) {
          this.bustedHold = 0;
          this.triggerBusted();
        }
      } else {
        this.bustedHold = 0;
      }
    }
  }

  _unitStep(u, dt) {
    const w = this.w;
    const p = w.player;
    const car = u.car;
    if (car.wrecked) return;
    const px = p.onFoot ? p.x : p.vehicle.x;
    const pz = p.onFoot ? p.z : p.vehicle.z;
    const d = Math.hypot(car.x - px, car.z - pz);
    u.stateTimer -= dt;
    // State picks: pursue while the player is seen, search when lost.
    if (this.stars >= 1 && this.lastKnown && d < 160) {
      if (u.state !== 'pursue' && u.state !== 'block') u.state = 'pursue';
    } else if (this.lastKnown) {
      u.state = 'search';
    } else {
      u.state = 'patrol';
    }
    // One unit cuts ahead to block at the next intersection (stars >= 3).
    if (this.stars >= 3 && this.units.indexOf(u) === 0 && u.stateTimer <= 0) {
      u.state = 'block';
      u.stateTimer = 14;
      const ahead = 70;
      const hx = p.onFoot ? Math.sin(p.heading) : Math.sin(p.vehicle.heading);
      const hz = p.onFoot ? Math.cos(p.heading) : Math.cos(p.vehicle.heading);
      const node = w.graph.nearestNode(px + hx * ahead, pz + hz * ahead);
      u.blockTarget = w.graph.nodePos(node);
    }
    let tx, tz, throttle = 0.8;
    if (u.state === 'pursue') {
      // Chase the predicted position, not the current one.
      const pvx = p.onFoot ? 0 : (p.vehicle.vx || 0);
      const pvz = p.onFoot ? 0 : (p.vehicle.vz || 0);
      tx = px + pvx * 1.2;
      tz = pz + pvz * 1.2;
      throttle = 1;
      // Shoot when provoked or at 3+ stars.
      u.shootTimer -= dt;
      if ((this.stars >= 3 || this.playerShotFirst) && d < 42 && d > 6 && u.shootTimer <= 0) {
        u.shootTimer = 1.4 + Math.random() * 0.8;
        if (w.combat) w.combat.npcShoot({ x: car.x, z: car.z }, px, pz);
      }
    } else if (u.state === 'block' && u.blockTarget) {
      tx = u.blockTarget.x;
      tz = u.blockTarget.z;
      if (Math.hypot(car.x - tx, car.z - tz) < 8) {
        throttle = 0;
        tx = car.x; tz = car.z;
      }
    } else if (u.state === 'search' && this.lastKnown) {
      u.searchAngle += dt * 0.25;
      tx = this.lastKnown.x + Math.cos(u.searchAngle) * 26;
      tz = this.lastKnown.z + Math.sin(u.searchAngle) * 26;
      throttle = 0.5;
    } else {
      // Patrol: pick a random far node and drive to it.
      if (!u.route || u.route.length === 0 || u.nodeIdx >= u.route.length) {
        const from = w.graph.nearestNode(car.x, car.z);
        const to = w.graph.nodes[Math.floor(Math.random() * w.graph.nodes.length)].id;
        u.route = w.graph.pathPoints(w.graph.shortestPath(from, to));
        u.nodeIdx = 0;
      }
      const node = u.route[u.nodeIdx];
      if (!node) { u.route = []; return; }
      tx = node.x; tz = node.z;
      if (Math.hypot(car.x - tx, car.z - tz) < 6) u.nodeIdx += 1;
      throttle = 0.5;
    }
    const dx = tx - car.x, dz = tz - car.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3 && u.state !== 'block') {
      applyDrive(car, { throttle: 0, brake: 1, steer: 0, handbrake: false }, dt, w.colliders, w.weather.gripFactor());
      return;
    }
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - car.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const steer = Math.max(-1, Math.min(1, dh * 1.6));
    const speedCap = u.state === 'pursue' ? car.def.top * 0.92 : car.def.top * 0.5;
    if (Math.abs(car.speed) > speedCap) throttle = 0;
    applyDrive(car, { throttle, brake: 0, steer, handbrake: false }, dt, w.colliders, w.weather.gripFactor());
  }

  // --- BUSTED / WASTED flow (tickFlow runs every step, dialogs or not) ---
  triggerBusted() {
    if (this.flow.kind !== null) return;
    this.flow = { kind: 'busted', phase: 'overlay', t: 0, continueRequested: false };
    if (this.w.onBustedStart) this.w.onBustedStart();
  }

  triggerWasted() {
    if (this.flow.kind !== null) return;
    const w = this.w;
    const p = w.player;
    // F5: park the helicopter over the player for the crane shot.
    if (w.heli) {
      w.heli.group.position.set(p.x + 12, 55, p.z - 8);
    }
    this.flow = { kind: 'wasted', phase: 'crane', t: 0, continueRequested: false };
    if (w.onWastedStart) w.onWastedStart();
  }

  continueFlow() {
    this.flow.continueRequested = true;
  }

  tickFlow(dt) {
    const f = this.flow;
    if (f.kind === null) return;
    const w = this.w;
    f.t += dt;
    if (f.phase === 'crane') {
      // Wait for the crane to finish (or a 5 s hard cap), then show the screen.
      const done = (w.rig && w.rig.crane && w.rig.crane.done) || f.t > 5;
      if (done) {
        f.phase = 'overlay';
        f.t = 0;
        const ov = document.getElementById('wastedOverlay');
        if (ov) ov.style.display = 'flex';
      }
      return;
    }
    if (f.phase === 'overlay') {
      // Lanjutkan button, or the 2.6 s auto-hide fallback.
      if (f.continueRequested || f.t > 2.6) {
        this._finishFlow();
      }
    }
  }

  _finishFlow() {
    const w = this.w;
    const kind = this.flow.kind;
    const p = w.player;
    // Penalties: busted = $200 fine + illegal weapons seized; wasted =
    // $200 hospital + 10% of cash.
    if (kind === 'busted') {
      w.economy.balance = Math.max(0, w.economy.balance - BUSTED_FINE);
      w.economy.spent += BUSTED_FINE;
      w.economy.ledger.push({ t: Date.now(), delta: -BUSTED_FINE, reason: 'Denda penangkapan' });
      for (const id of ['kr9', 'iron12', 'vk7']) {
        if (p.owned[id]) delete p.owned[id];
      }
      if (p.weapon && !p.owned[p.weapon]) {
        p.weapon = 'p9';
        p.showWeapon();
      }
      if (w.ui) w.ui.notify(w.lang.t('finePaid') + ' $' + BUSTED_FINE, 'warn');
    } else {
      const cashLoss = Math.round(w.economy.balance * 0.1);
      const total = HOSPITAL_FINE + cashLoss;
      w.economy.balance = Math.max(0, w.economy.balance - total);
      w.economy.spent += total;
      w.economy.ledger.push({ t: Date.now(), delta: -total, reason: 'Tagihan rumah sakit' });
      if (w.ui) w.ui.notify(w.lang.t('hospitalBill') + ' $' + total, 'warn');
    }
    this.clear();
    this.flow = { kind: null, phase: 'idle', t: 0, continueRequested: false };
    const ov = document.getElementById('wastedOverlay');
    if (ov) ov.style.display = 'none';
    if (w.onRespawn) w.onRespawn();
  }
}
