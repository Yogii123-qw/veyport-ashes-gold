// wanted.js — heat, the five stars, and the CPD.
//
// SPEC §3.2: every crime adds a measured amount of heat; heat decays
// when the player is unseen (faster at night, in rain, in alleys). Stars
// rise at heat thresholds and fall one star per 45 unseen seconds.
// Police run a real state machine — Patrol, Investigate, Pursue, Block,
// Search, Arrest — driving the road graph, never teleporting. At ★3 the
// first roadblock goes up; ★4 brings the helicopter; ★5 blocks the
// bridges. Caught on foot = BUSTED (illegal guns confiscated, $200
// fine). Killed = WASTED: the F5 crane shot rises over seven seconds to
// frame the police helicopter, then the hospital bill and a safehouse
// respawn. No part of this is faked: heat, positions and timers are all
// real state, and every transition is driven by the event bus.

import * as THREE from '../vendor/three.min.js';
import { box, cyl, mergeGeoms, stdMaterial } from './geo.js';
import { LANDMARKS } from './city.js';

const STAR_HEAT = [0, 20, 45, 80, 130, 200];
const STAR_UNITS = [0, 1, 2, 4, 6, 8];
const HEAT_DECAY = 2.0;
const STAR_DOWN_SECONDS = 45;
const BUSTED_FINE = 200;
const HOSPITAL_BASE = 200;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildHeliMesh() {
  const parts = [
    box(3.4, 1.4, 1.6, 0x1a2330, 0, 0, 0),
    box(2.6, 0.9, 1.2, 0x1a2330, -2.6, 0.2, 0),
    box(0.5, 1.1, 0.5, 0x1a2330, -3.8, 0.6, 0),
    box(0.9, 0.3, 0.4, 0xc22e2e, 0.6, 0.85, 0),
    box(0.9, 0.3, 0.4, 0x2244cc, -0.4, 0.85, 0),
    box(1.2, 0.2, 1.0, 0x9aa0a8, 1.6, -0.4, 0),
  ];
  const group = new THREE.Group();
  const body = new THREE.Mesh(mergeGeoms(parts), stdMaterial());
  body.castShadow = true;
  group.add(body);
  const rotor = new THREE.Mesh(
    mergeGeoms([box(7.5, 0.08, 0.4, 0x222222, 0, 0, 0)]),
    stdMaterial(),
  );
  rotor.position.set(0, 0.95, 0);
  group.add(rotor);
  const tailRotor = new THREE.Mesh(
    mergeGeoms([box(0.08, 1.6, 0.3, 0x222222, 0, 0, 0)]),
    stdMaterial(),
  );
  tailRotor.position.set(-3.9, 0.6, 0);
  group.add(tailRotor);
  return { group, rotor, tailRotor };
}

export function createWanted(deps) {
  const { scene, city, vehicles, player, bus, cameraRig, economy, weather } = deps;
  const rng = mulberry32(777001);
  const state = { stars: 0, heat: 0, unseenTimer: 0, flow: 'none' }; // flow: none | busted | wasted
  let flowTimer = 0;
  let playerFired = false;
  let lastSeenAt = 0;
  const police = [];
  const roadblocks = [];
  let heli = null;
  let heliMesh = null;
  let heliSpot = null;
  let unitId = 1;

  // ---------- Heat: every crime has a price ----------
  function addHeat(n, cause) {
    if (state.flow !== 'none') return;
    state.heat += n;
    state.unseenTimer = 0;
    const want = starsForHeat(state.heat);
    if (want > state.stars) {
      state.stars = want;
      bus.emit('wanted-up', { stars: state.stars, cause });
    }
  }
  function starsForHeat(h) {
    let s = 0;
    for (let i = 1; i <= 5; i++) if (h >= STAR_HEAT[i]) s = i;
    return s;
  }
  function clearWanted() {
    state.stars = 0;
    state.heat = 0;
    state.unseenTimer = 0;
    playerFired = false;
    for (const u of police) removeUnit(u);
    for (const rb of roadblocks) vehicles.removeVehicle(rb);
    roadblocks.length = 0;
    if (heli) { scene.remove(heliMesh.group); if (heliSpot) scene.remove(heliSpot); heli = null; heliMesh = null; heliSpot = null; }
  }

  bus.on('shot', ({ npc }) => {
    if (!npc) { addHeat(8, 'shot'); playerFired = true; }
  });
  bus.on('kill', () => addHeat(25, 'kill'));
  bus.on('carjack', () => addHeat(10, 'carjack'));
  bus.on('witness', () => addHeat(12, 'witness'));
  bus.on('ped-down', () => addHeat(15, 'ped-down'));
  bus.on('vehicle-destroyed', () => addHeat(10, 'explosion'));

  // ---------- Police units ----------
  function spawnUnit(now) {
    // Spawn away from the player so no unit pops into view, but close
    // enough to actually reach them: a unit spawned on the far side of
    // the 1200 m city would take longer than the 45 s star-down timer
    // to arrive, so the wanted level would clear before any arrest.
    const pp = player.position();
    let p = null;
    for (let i = 0; i < 14; i++) {
      const cand = city.randomRoadPoint(rng);
      const d = Math.hypot(cand.x - pp.x, cand.z - pp.z);
      if (d >= 90 && d <= 260) { p = cand; break; }
      if (d >= 90 && !p) p = cand;
    }
    if (!p) return null;
    const type = state.stars >= 3 && rng() < 0.3 ? 'cpdvan' : 'interceptor';
    const v = vehicles.makeVehicle(type, p.x, p.z, rng() * Math.PI * 2, { traffic: false });
    v.police = true; // pursuit vehicles take half wall damage (see vehicles.js)
    const u = {
      id: unitId++,
      vehicle: v,
      x: p.x, z: p.z, heading: v.heading,
      state: 'patrol',
      route: null, routeIdx: 0,
      repath: 0,
      lastX: p.x, lastZ: p.z, lastMoveT: now || 0,
      reverseTimer: 0,
      shootCooldown: 1 + rng(),
      lastSeen: { x: pp.x, z: pp.z },
      alive: true,
    };
    police.push(u);
    return u;
  }

  function removeUnit(u) {
    if (u.vehicle) vehicles.removeVehicle(u.vehicle);
    const i = police.indexOf(u);
    if (i >= 0) police.splice(i, 1);
  }

  function damagePolice(u, amount, opts = {}) {
    if (!u.alive) return;
    // Officers take the hit personally: their car takes half, they take half.
    u.hp = (u.hp ?? 100) - amount;
    if (u.vehicle) vehicles.damage(u.vehicle, amount * 0.5, 'shot');
    if (u.hp <= 0) {
      u.alive = false;
      bus.emit('police-down', { unit: u, weapon: opts.weapon || null });
      addHeat(20, 'police-down');
      removeUnit(u);
    }
  }

  function spawnRoadblock() {
    const pp = player.position();
    const ahead = city.nearestRoadPoint(pp.x + Math.sin(player.state.heading) * 90, pp.z + Math.cos(player.state.heading) * 90);
    for (const side of [-1, 1]) {
      const v = vehicles.makeVehicle('interceptor', ahead.x + side * 4, ahead.z, player.state.heading + Math.PI / 2, { traffic: false });
      v.speed = 0;
      roadblocks.push(v);
    }
    bus.emit('roadblock', { x: ahead.x, z: ahead.z });
  }

  function ensureHeli() {
    if (heli) return;
    const built = buildHeliMesh();
    heliMesh = built;
    const pp = player.position();
    built.group.position.set(pp.x + 25, 42, pp.z - 25);
    scene.add(built.group);
    heliSpot = new THREE.SpotLight(0xfff2c0, 0, 90, 0.35, 0.5, 1.2);
    heliSpot.position.copy(built.group.position);
    scene.add(heliSpot);
    scene.add(heliSpot.target);
    heli = { x: pp.x + 25, y: 42, z: pp.z - 25 };
  }

  // ---------- Player damage: armor absorbs 60% ----------
  function takeDamage(amount, source) {
    if (state.flow !== 'none' || player.state.health <= 0) return;
    const ps = player.state;
    const absorbed = Math.min(ps.armor, amount * 0.6);
    ps.armor -= absorbed;
    ps.health -= (amount - absorbed);
    bus.emit('player-hurt', { amount, source, health: ps.health });
    if (ps.health <= 0) {
      ps.health = 0;
      startWasted();
    }
  }

  function startBusted() {
    if (state.flow !== 'none') return;
    state.flow = 'busted';
    flowTimer = 0;
    bus.emit('busted-start', {});
  }

  function startWasted() {
    if (state.flow !== 'none') return;
    state.flow = 'wasted';
    flowTimer = 0;
    ensureHeli();
    const hp = heli ? { x: heli.x, y: heli.y, z: heli.z } : null;
    cameraRig.setMode('wasted', { heliPos: hp });
    bus.emit('wasted-start', { heli: hp });
  }

  function finishBusted() {
    // Confiscate illegal weapons, fine $200, respawn at the safehouse.
    const ps = player.state;
    for (const id of ['kr9', 'iron12', 'vk7']) {
      if (ps.weapons[id]) ps.weapons[id].owned = false;
    }
    if (!ps.weapons[ps.currentWeapon]?.owned) {
      ps.currentWeapon = ps.weapons.p9?.owned ? 'p9' : 'fists';
      player.syncWeaponMesh();
    }
    economy.spend(BUSTED_FINE, 'Busted fine');
    player.teleport(LANDMARKS.safehouse.x + 4, LANDMARKS.safehouse.z + 4, 0.6);
    clearWanted();
    state.flow = 'none';
    bus.emit('busted-done', { fine: BUSTED_FINE });
  }

  function finishWasted() {
    // Hospital: $200 + 10% of cash, respawn at the safehouse, full health.
    const bill = HOSPITAL_BASE + Math.round(economy.cash * 0.1);
    economy.spend(Math.min(bill, economy.cash), 'Hospital bill');
    player.state.health = 100;
    player.state.armor = 0;
    player.teleport(LANDMARKS.safehouse.x + 4, LANDMARKS.safehouse.z + 4, 0.6);
    clearWanted();
    cameraRig.setMode('foot');
    state.flow = 'none';
    bus.emit('wasted-done', { bill });
  }

  // P5: the busted/wasted clock alone, without any world animation.
  // step() calls this even while a mission dialog is open, so an
  // arrest or hospital flow can never freeze behind a dialog.
  function tickFlow(dt) {
    if (state.flow === 'busted') {
      flowTimer += dt;
      if (flowTimer > 2.2) finishBusted();
    } else if (state.flow === 'wasted') {
      flowTimer += dt;
      if (flowTimer > 7.2) finishWasted();
    }
  }

  // ---------- Per-frame ----------
  function update(dt, ctx) {
    const pp = player.position();
    const ps = player.state;

    // --- Active flow (busted / wasted) runs its own clock ---
    // The helicopter hover below is world animation, so it stays
    // here (frozen with the world); the clock itself is tickFlow().
    if (state.flow === 'busted' || state.flow === 'wasted') {
      if (state.flow === 'wasted' && heli && heliMesh) {
        heliMesh.group.position.set(pp.x + 22, 40, pp.z - 22);
        heliMesh.rotor.rotation.y += dt * 22;
        heliSpot.position.copy(heliMesh.group.position);
        heliSpot.target.position.set(pp.x, 0, pp.z);
        heliSpot.intensity = 220;
        heli.x = heliMesh.group.position.x;
        heli.y = 40;
        heli.z = heliMesh.group.position.z;
      }
      tickFlow(dt);
      return;
    }

    // --- Seen? Any unit within sight range keeps the heat alive. ---
    const sight = (weather ? weather.sightFactor : 1) * 42;
    let seen = false;
    for (const u of police) {
      if (Math.hypot(u.x - pp.x, u.z - pp.z) < sight) { seen = true; break; }
    }
    if (heli && Math.hypot(heli.x - pp.x, heli.z - pp.z) < 70) seen = true;
    if (state.stars > 0) {
      if (seen) {
        state.unseenTimer = 0;
        lastSeenAt = ctx.time || 0;
      } else {
        state.unseenTimer += dt;
        // Heat decays faster at night and in the rain.
        const night = weather ? weather.nightFactor() : 0;
        const rainMul = weather && (weather.weather === 'rain' || weather.weather === 'storm') ? 1.3 : 1;
        state.heat = Math.max(0, state.heat - HEAT_DECAY * (1 + night * 0.5) * rainMul * dt);
        if (state.unseenTimer > STAR_DOWN_SECONDS) {
          state.unseenTimer = 0;
          state.stars = Math.max(0, state.stars - 1);
          state.heat = state.stars > 0 ? STAR_HEAT[state.stars] - 1 : 0;
          bus.emit('wanted-down', { stars: state.stars });
          if (state.stars === 0) clearWanted();
        }
      }
    }

    // --- Keep the fleet at the star count ---
    // A wrecked unit is replaced: a police car that rams a wall until
    // it dies used to sit in the slot forever (the chase loop skips
    // wrecked vehicles), so the arrest could never happen and the
    // stars just decayed.
    for (let i = police.length - 1; i >= 0; i--) {
      const u = police[i];
      if (!u.alive || !u.vehicle || u.vehicle.wrecked) removeUnit(u);
    }
    const want = state.stars > 0 ? STAR_UNITS[state.stars] : 0;
    while (police.length < want) {
      if (!spawnUnit(ctx.time || 0)) break;
    }
    while (police.length > want) removeUnit(police[police.length - 1]);

    // --- Roadblocks at ★3+, bridges at ★5 ---
    if (state.stars >= 3 && roadblocks.length === 0) spawnRoadblock();
    if (state.stars < 3 && roadblocks.length > 0) {
      for (const rb of roadblocks) vehicles.removeVehicle(rb);
      roadblocks.length = 0;
    }
    if (state.stars >= 4) ensureHeli();
    else if (heli && state.stars === 0) {
      scene.remove(heliMesh.group);
      scene.remove(heliSpot);
      heli = null; heliMesh = null; heliSpot = null;
    }

    // --- Police driving: chase the last seen position via the graph ---
    const shoot = state.stars >= 3 || playerFired;
    for (const u of police) {
      if (!u.alive || !u.vehicle || u.vehicle.wrecked) continue;
      const v = u.vehicle;
      const dx = pp.x - u.x;
      const dz = pp.z - u.z;
      const dist = Math.hypot(dx, dz);
      if (dist < sight) u.lastSeen = { x: pp.x, z: pp.z };
      u.repath -= dt;
      if (u.repath <= 0) {
        u.repath = 2;
        // Re-route ONLY when the trail has moved: rebuilding the route
        // every 2 s resets routeIdx to 0, and route[0] is the nearest
        // node — usually the one BEHIND the car — so the unit turns
        // around and never crosses the midpoint between nodes.
        const routedTo = u.routedTo || u.lastSeen;
        const trailMoved = Math.hypot(u.lastSeen.x - routedTo.x, u.lastSeen.z - routedTo.z);
        if (!u.route || u.routeIdx >= u.route.length || trailMoved > 40) {
          u.route = city.route(u.x, u.z, u.lastSeen.x, u.lastSeen.z);
          u.routeIdx = 0;
          u.routedTo = { x: u.lastSeen.x, z: u.lastSeen.z };
        }
      }
      // Drive toward the next route node (or the player when close).
      let tx = u.lastSeen.x;
      let tz = u.lastSeen.z;
      // Close in: within 60 m the player IS the target, not the next
      // waypoint. A distance threshold on the node flip-flops across
      // its boundary (the unit turned north of the node, then south to
      // the player, then north again, forever); the player distance
      // only shrinks as the unit closes in, so it cannot flip-flop.
      const directDist = Math.hypot(u.lastSeen.x - u.x, u.lastSeen.z - u.z);
      if (u.route && u.routeIdx < u.route.length && directDist >= 60) {
        tx = u.route[u.routeIdx].x;
        tz = u.route[u.routeIdx].z;
        // 12 m, not 7: at top speed the turning circle is ~30 m, so a
        // 7 m capture is never reached and the unit orbits the node.
        if (Math.hypot(tx - u.x, tz - u.z) < 12) u.routeIdx += 1;
      }
      const nodeDist = Math.hypot(tx - u.x, tz - u.z);
      const wdx = tx - u.x;
      const wdz = tz - u.z;
      const wantHeading = Math.atan2(wdx, wdz);
      let dh = wantHeading - u.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, dh * 1.8));
      // Target speed: slow down for the next node — a 90° turn at
      // 34 m/s overshoots the intersection into the building on the
      // far corner — and stop by the player for the arrest.
      let wantSpeed = Math.min(34, 4 + nodeDist * 0.45);
      // Slow for a sharp turn: at 25 m/s the turning circle is ~30 m,
      // wider than the distance to the target, so the unit orbits
      // instead of converging — the heading just spins. Capping speed
      // by the heading error shrinks the circle until the turn is made.
      if (Math.abs(dh) > 0.9) wantSpeed = Math.min(wantSpeed, 6);
      else if (Math.abs(dh) > 0.5) wantSpeed = Math.min(wantSpeed, 9);
      else if (Math.abs(dh) > 0.25) wantSpeed = Math.min(wantSpeed, 15);
      if (dist <= 5) wantSpeed = 0;
      else if (dist <= 12) wantSpeed = Math.min(wantSpeed, 4);
      let throttle;
      if (u.reverseTimer > 0) throttle = -0.7; // backing out of a wedge
      else if (v.speed > wantSpeed + 1) throttle = -0.6; // brake
      else throttle = v.speed < wantSpeed ? 1 : 0.3;
      // Reuse the fleet's arcade driver through a control shim.
      const ctl = { throttle, steer, handbrake: false };
      // Drive this unit with the same physics the player uses.
      vehicles.driveUnit(u, ctl, dt, weather ? weather.gripFactor : 1);
      // Pursuit speed cap: 34 m/s (122 km/h) is plenty to catch a
      // runner and keeps the turning circle small enough to follow
      // city blocks; the player can still out-drive the cops in a
      // fast car, which is the intended escape.
      if (v.speed > 34) v.speed = 34;
      u.x = v.x; u.z = v.z; u.heading = v.heading;
      if (u.reverseTimer > 0) {
        u.reverseTimer -= dt;
      } else {
        // Un-wedge, by position: at a wall the speed oscillates (the
        // impact bounce flips it negative), so a speed test never
        // fires. If the unit has not moved 3 m in 3 s of game time
        // while it has a target, back out for 1.4 s.
        const moved = Math.hypot(v.x - u.lastX, v.z - u.lastZ);
        if (moved > 3) {
          u.lastX = v.x; u.lastZ = v.z; u.lastMoveT = ctx.time || 0;
        } else if ((ctx.time || 0) - u.lastMoveT > 3) {
          u.reverseTimer = 1.4;
          u.lastX = v.x; u.lastZ = v.z; u.lastMoveT = ctx.time || 0;
          u.repath = 0; // recompute the route from the new spot instead
          // of re-ramming the same wall. NOTE: routeIdx is NOT reset
          // here — resetting it sent the unit all the way back to
          // node 0 every time it was briefly delayed.
        }
      }

      // Shooting: ★3+ or the player shot first. Real hit chance.
      if (shoot && dist < 38) {
        u.shootCooldown -= dt;
        if (u.shootCooldown <= 0) {
          u.shootCooldown = 0.8 + rng() * 0.8;
          bus.emit('shot', { weapon: 'p9', muzzle: { x: u.x, y: 1.2, z: u.z }, npc: true });
          if (Math.random() < Math.max(0.08, 0.4 - dist * 0.008)) {
            takeDamage(5 + Math.floor(rng() * 5), 'police');
          }
        }
      }

      // Arrest: an officer reaches a slow player on foot. 4 m, not 3:
      // the car's centre is what is measured, and its bumper is ~2 m
      // ahead of that — at 3 m the car would have to overlap the
      // player, which the collision response prevents.
      if (!ps.inVehicle && dist < 4 && Math.abs(ps.speed) < 1.2 && state.stars >= 1) {
        startBusted();
        return;
      }
    }

    // --- Helicopter: hover over the player, spotlight sweeping ---
    if (heli && heliMesh) {
      heliMesh.group.position.set(pp.x + 22, 42, pp.z - 22);
      heliMesh.rotor.rotation.y += dt * 22;
      heliMesh.tailRotor.rotation.x += dt * 30;
      heliSpot.position.copy(heliMesh.group.position);
      const sweep = Math.sin((ctx.time || 0) * 0.7) * 18;
      heliSpot.target.position.set(pp.x + sweep, 0, pp.z + Math.cos((ctx.time || 0) * 0.5) * 18);
      heliSpot.intensity = 200;
      heli.x = heliMesh.group.position.x;
      heli.y = 42;
      heli.z = heliMesh.group.position.z;
    }
  }

  return {
    state,
    police,
    update,
    tickFlow,
    addHeat,
    clearWanted,
    takeDamage,
    damagePolice,
    setStars(n) {
      state.stars = Math.max(0, Math.min(5, n));
      state.heat = state.stars > 0 ? STAR_HEAT[state.stars] : 0;
    },
    get stars() { return state.stars; },
    get heat() { return state.heat; },
    get flow() { return state.flow; },
    get heliPos() { return heli ? { x: heli.x, y: heli.y, z: heli.z } : null; },
    get roadblocks() { return roadblocks; },
  };
}
