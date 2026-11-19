// player.js — Rook Calloway on foot, rewritten in phase 2.
//
// Walk 5.0 m/s, run 8.5 m/s while Shift or the hold-to-run touch button
// is held (F2). The player starts with fists AND a P9 Sidearm with ammo
// (F1): the gun is obtainable and obvious from the first second, and a
// visible weapon mesh sits in the right hand in third person, changing
// with the equipped weapon. The heavy weapons arrive through
// registerWeapon() — combat.js registers KR-9 / Iron-12 / VK-7 — and
// firing itself is delegated to the handler combat.js installs; this
// module keeps a minimal vehicle-only fallback so the gun still works
// if combat is ever absent. Armor absorbs 60% of incoming damage;
// health only returns through medkits, street food, or sleeping.

import * as THREE from '../vendor/three.min.js';
import { box, mergeGeoms, stdMaterial } from './geo.js';

export const WALK_SPEED = 5.0;
export const RUN_SPEED = 8.5;
export const PLAYER_RADIUS = 0.55;
export const ARMOR_ABSORB = 0.6;

/** Weapon table. Phase 2 adds KR-9 / Iron-12 / VK-7 via registerWeapon. */
export const WEAPONS = {
  fists: {
    id: 'fists', name: { en: 'Fists', id: 'Tinju' }, kind: 'melee',
    damage: 15, range: 2.0, auto: false, reloadTime: 0, price: 0,
    ammoPrice: 0, ammoPack: 0, magSize: Infinity, fireInterval: 0.45,
  },
  p9: {
    id: 'p9', name: { en: 'P9 Sidearm', id: 'P9 Sidearm' }, kind: 'pistol',
    damage: 25, range: 40, auto: false, reloadTime: 1.1, price: 150,
    ammoPrice: 20, ammoPack: 24, magSize: 12, fireInterval: 0.22,
  },
};

export function registerWeapon(def) {
  WEAPONS[def.id] = def;
}

export function weaponName(def, lang) {
  return def.name[lang] || def.name.en;
}

/** Weapon meshes, built from a parts table per weapon (F1). */
const WEAPON_PARTS = {
  p9: [
    [0.34, 0.09, 0.06, 0x1c1c20, 0.12, 0, 0],
    [0.1, 0.16, 0.06, 0x6a4a2a, 0.0, -0.1, 0],
    [0.1, 0.06, 0.06, 0x6a6f76, 0.3, 0.02, 0],
    [0.06, 0.06, 0.06, 0x6a6f76, 0.24, 0.06, 0],
    [0.36, 0.02, 0.065, 0x8a8f96, 0.12, 0.055, 0],
  ],
  kr9: [
    [0.55, 0.09, 0.07, 0x1c1c20, 0.1, 0, 0],
    [0.08, 0.2, 0.06, 0x1c1c20, -0.08, -0.1, 0],
    [0.2, 0.07, 0.06, 0x6a6f76, 0.38, 0, 0],
    [0.3, 0.06, 0.05, 0x6a4a2a, -0.28, -0.02, 0],
  ],
  iron12: [
    [0.62, 0.11, 0.08, 0x1c1c20, 0.12, 0, 0],
    [0.34, 0.08, 0.07, 0x6a6f76, 0.32, -0.01, 0],
    [0.08, 0.18, 0.06, 0x6a4a2a, -0.14, -0.1, 0],
    [0.22, 0.07, 0.06, 0x6a4a2a, -0.3, -0.02, 0],
  ],
  vk7: [
    [0.72, 0.1, 0.07, 0x1c1c20, 0.1, 0, 0],
    [0.08, 0.2, 0.06, 0x1c1c20, -0.05, -0.1, 0],
    [0.24, 0.06, 0.05, 0x6a6f76, 0.48, 0, 0],
    [0.06, 0.1, 0.06, 0x6a6f76, 0.18, 0.09, 0],
    [0.3, 0.07, 0.06, 0x6a4a2a, -0.3, -0.02, 0],
  ],
};

function buildWeaponMesh(weaponId) {
  const parts = WEAPON_PARTS[weaponId];
  if (!parts) return null; // fists: no mesh — bare hands
  return mergeGeoms(parts.map(([w, h, d, c, x, y, z]) => box(w, h, d, c, x, y, z)));
}

/** Low-poly Rook: jacket, head, limbs. Limbs swing while walking. */
function buildPlayerMesh() {
  const skin = 0xc89878;
  const jacket = 0x3a3f4a;
  const pants = 0x2a2d33;
  const body = new THREE.Group();
  const bodyMesh = new THREE.Mesh(mergeGeoms([
    box(0.55, 0.7, 0.32, jacket, 0, 1.15, 0),
    box(0.56, 0.1, 0.33, 0x222222, 0, 0.82, 0),
    box(0.34, 0.34, 0.32, skin, 0, 1.68, 0),
    box(0.36, 0.1, 0.34, 0x1a1a1a, 0, 1.86, 0),
    box(0.2, 0.62, 0.2, jacket, 0.36, 1.15, 0),
    box(0.2, 0.62, 0.2, pants, -0.16, 0.42, 0),
    box(0.2, 0.62, 0.2, pants, 0.16, 0.42, 0),
  ]), stdMaterial());
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  // Right arm is separate: it holds the weapon and aims with the camera.
  // Body-local -X is the character's right side (forward = (sin h, cos h)).
  const arm = new THREE.Group();
  const armMesh = new THREE.Mesh(mergeGeoms([
    box(0.2, 0.62, 0.2, jacket, 0, -0.31, 0),
    box(0.18, 0.18, 0.18, skin, 0, -0.66, 0),
  ]), stdMaterial());
  armMesh.castShadow = true;
  arm.add(armMesh);
  arm.position.set(-0.36, 1.46, 0);
  body.add(arm);
  // Weapon anchor at the right hand.
  const hand = new THREE.Group();
  hand.position.set(0, -0.68, 0.06);
  arm.add(hand);
  return { body, arm, hand };
}

export function createPlayer(scene, city, vehicles, bus) {
  const { body, arm, hand } = buildPlayerMesh();
  scene.add(body);
  const weaponMat = stdMaterial({ roughness: 0.4, metalness: 0.5 });
  let weaponMesh = null;
  let fireHandler = null;

  const state = {
    x: -452,
    z: -372,
    heading: 0.6,
    health: 100,
    armor: 0,
    speed: 0,
    inVehicle: false,
    vehicle: null,
    entering: 0, // >0 while the 0.6 s enter animation runs
    exiting: 0,
    weapons: { fists: { owned: true, ammo: Infinity, reserve: 0, mag: Infinity } },
    currentWeapon: 'p9',
    reloading: 0,
    walkPhase: 0,
    aim: false,
  };

  // New game starts with the P9 Sidearm equipped, 12 in the mag + 48 in
  // reserve (F1). The notice is shown by the HUD in main.js.
  state.weapons.p9 = { owned: true, ammo: 12, reserve: 48, mag: 12 };
  state.currentWeapon = 'p9';

  const muzzleWorld = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  let lastShotAt = -10;

  /** Minimal fallback fire (vehicles + walls only). Combat installs the
   *  full handler; this keeps the gun working if it ever does not. */
  function fallbackFire(camera, now) {
    const def = currentWeaponDef();
    if (!def || now - lastShotAt < def.fireInterval) return false;
    if (state.reloading > 0) return false;
    const w = state.weapons[state.currentWeapon];
    if (def.kind !== 'melee' && w.ammo <= 0) { reload(); return false; }
    lastShotAt = now;
    if (def.kind !== 'melee') w.ammo -= 1;
    hand.getWorldPosition(muzzleWorld);
    camera.getWorldDirection(rayDir);
    let bestT = def.range;
    let bestVehicle = null;
    for (const v of vehicles.vehicles) {
      if (v.wrecked) continue;
      const cx = v.x - muzzleWorld.x;
      const cz = v.z - muzzleWorld.z;
      const cy = 0.9 - muzzleWorld.y;
      const t = cx * rayDir.x + cy * rayDir.y + cz * rayDir.z;
      if (t < 0 || t > bestT) continue;
      const px = muzzleWorld.x + rayDir.x * t;
      const pz = muzzleWorld.z + rayDir.z * t;
      const py = muzzleWorld.y + rayDir.y * t;
      if (Math.hypot(px - v.x, py - 0.9, pz - v.z) < 1.5) { bestT = t; bestVehicle = v; }
    }
    const wallT = city.raycastBuildings(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, rayDir.x, rayDir.y, rayDir.z, def.range);
    const endT = Math.min(bestT, wallT);
    const end = new THREE.Vector3(
      muzzleWorld.x + rayDir.x * endT,
      muzzleWorld.y + rayDir.y * endT,
      muzzleWorld.z + rayDir.z * endT,
    );
    if (bestVehicle && bestT <= wallT) {
      vehicles.damage(bestVehicle, def.damage, 'shot');
      bus.emit('hit', { x: end.x, z: end.z, weapon: def.id, vehicle: bestVehicle });
    } else if (wallT < Infinity) {
      bus.emit('impact', { x: end.x, y: end.y, z: end.z, weapon: def.id });
    }
    bus.emit('shot', { weapon: def.id, hit: !!bestVehicle, muzzle: { x: muzzleWorld.x, y: muzzleWorld.y, z: muzzleWorld.z } });
    return true;
  }

  function tryFire(camera, now) {
    if (state.inVehicle || state.entering > 0) return false;
    if (fireHandler) return fireHandler(camera, now);
    return fallbackFire(camera, now);
  }

  function syncWeaponMesh() {
    if (weaponMesh) {
      hand.remove(weaponMesh);
      weaponMesh.geometry.dispose();
      weaponMesh = null;
    }
    const geom = buildWeaponMesh(state.currentWeapon);
    if (geom) {
      weaponMesh = new THREE.Mesh(geom, weaponMat);
      weaponMesh.castShadow = true;
      // The mesh is built with its barrel along +X; rotate it onto the
      // arm's pointing direction (-Y in hand space) so the gun points
      // where the arm points — down at the side while walking, forward
      // while aiming — instead of sideways. Scaled up a touch: a
      // true-scale pistol vanishes at third-person distance.
      weaponMesh.rotation.z = -Math.PI / 2;
      weaponMesh.scale.setScalar(1.45);
      hand.add(weaponMesh);
    }
  }
  syncWeaponMesh();

  function switchWeapon(id) {
    if (!state.weapons[id] || !state.weapons[id].owned) return false;
    if (state.currentWeapon === id) return false;
    state.currentWeapon = id;
    state.reloading = 0;
    syncWeaponMesh();
    bus.emit('weapon-switched', { weapon: id });
    return true;
  }

  function giveWeapon(id, ammo = 0) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (!state.weapons[id]) {
      state.weapons[id] = { owned: true, ammo: 0, reserve: 0, mag: def.magSize };
    }
    state.weapons[id].owned = true;
    state.weapons[id].reserve += ammo;
    return true;
  }

  function currentWeaponDef() {
    return WEAPONS[state.currentWeapon];
  }

  function reload() {
    const def = currentWeaponDef();
    const w = state.weapons[state.currentWeapon];
    if (!def || def.kind === 'melee') return false;
    if (state.reloading > 0 || w.ammo >= def.magSize || w.reserve <= 0) return false;
    state.reloading = def.reloadTime;
    return true;
  }

  function finishReload() {
    const def = currentWeaponDef();
    const w = state.weapons[state.currentWeapon];
    const need = def.magSize - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
  }

  function heal(amount) {
    state.health = Math.min(100, state.health + amount);
  }

  function addArmor(amount) {
    state.armor = Math.min(100, state.armor + amount);
  }

  /** Enter the nearest car (0.6 s) or carjack a moving one. */
  function tryEnter() {
    if (state.inVehicle || state.entering > 0) return false;
    const v = vehicles.nearestVehicle(state.x, state.z, 4.5);
    if (!v) return false;
    state.entering = 0.6;
    state.pendingVehicle = v;
    if (v.traffic && Math.abs(v.speed) > 1) {
      // Carjack: the driver bails and the car stops for the player.
      v.traffic = false;
      v.speed = 0;
      bus.emit('carjack', { vehicle: v });
    }
    return true;
  }

  function exitVehicle() {
    if (!state.inVehicle || state.exiting > 0) return;
    state.exiting = 0.4;
    state.pendingExit = true;
  }

  function turnToward(want, rate, dt) {
    let dh = want - state.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    state.heading += dh * Math.min(1, rate * dt);
  }

  function update(dt, input, camYaw) {
    // --- entering / exiting vehicle (real timed transitions) ---
    if (state.entering > 0) {
      state.entering -= dt;
      if (state.entering <= 0) {
        const v = state.pendingVehicle;
        state.pendingVehicle = null;
        if (v && !v.wrecked) {
          state.inVehicle = true;
          state.vehicle = v;
          v.traffic = false;
          v.parked = false;
          vehicles.setPlayerVehicle(v);
          bus.emit('entered-vehicle', { vehicle: v });
        }
      }
      return;
    }
    if (state.exiting > 0) {
      state.exiting -= dt;
      if (state.exiting <= 0 && state.pendingExit) {
        state.pendingExit = false;
        const v = state.vehicle;
        state.inVehicle = false;
        state.vehicle = null;
        vehicles.setPlayerVehicle(null);
        if (v) {
          // Step out to the driver's side.
          state.x = v.x + Math.cos(v.heading) * 2.2;
          state.z = v.z - Math.sin(v.heading) * 2.2;
          state.heading = v.heading;
          v.speed = 0;
        }
        bus.emit('exited-vehicle', { vehicle: v });
      }
      return;
    }

    if (state.inVehicle) return; // driving is handled by vehicles.update

    // --- on foot ---
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) finishReload();
    }

    const sprint = input.sprint;
    const topSpeed = sprint ? RUN_SPEED : WALK_SPEED;
    const mx = input.moveX;
    const mz = input.moveY;
    const mag = Math.hypot(mx, mz);
    state.aim = input.aim;

    if (mag > 0.01) {
      // Movement is relative to the camera yaw: forward always walks
      // away from the camera (camera regression rule, SPEC §2.4).
      const nx = mx / Math.max(mag, 1);
      const nz = mz / Math.max(mag, 1);
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      const wx = nz * sin - nx * cos;
      const wz = nz * cos + nx * sin;
      state.speed += (topSpeed - state.speed) * Math.min(1, 10 * dt);
      const res = city.resolveCircle(state.x + wx * state.speed * dt, state.z + wz * state.speed * dt, PLAYER_RADIUS);
      state.x = res.x;
      state.z = res.z;
      turnToward(state.aim ? camYaw : Math.atan2(wx, wz), 12, dt);
      state.walkPhase += dt * state.speed * 1.6;
    } else {
      state.speed -= state.speed * Math.min(1, 10 * dt);
      if (state.aim) turnToward(camYaw, 12, dt);
    }

    // World bounds: the island ends at the sea.
    state.x = Math.max(-595, Math.min(595, state.x));
    state.z = Math.max(-595, Math.min(595, state.z));

    // --- visuals ---
    body.position.set(state.x, 0, state.z);
    body.rotation.y = state.heading;
    const swing = Math.sin(state.walkPhase) * Math.min(1, state.speed / WALK_SPEED) * 0.5;
    body.rotation.z = swing * 0.06;
    // Right arm: points forward while aiming, relaxed otherwise.
    arm.rotation.x = state.aim ? -Math.PI / 2 + 0.15 : swing * 0.4;
    arm.rotation.z = state.aim ? 0 : -0.12;
    body.visible = true;
  }

  function position() {
    // While driving, the player IS the car: every system that asks
    // where the player is (missions, wanted, minimap, contracts) must
    // get the car's position, not the frozen spot where they got in.
    if (state.inVehicle && state.vehicle) {
      return { x: state.vehicle.x, z: state.vehicle.z };
    }
    return { x: state.x, z: state.z };
  }

  function teleport(x, z, heading = 0) {
    // A teleport is absolute: cancel a pending enter/exit first. The
    // exit completes 0.4 s later and overwrites the position with the
    // car's location — without this, teleporting out of a moving car
    // silently puts the player back at the car, and a WASTED respawn
    // while driving never moved the player at all.
    state.entering = 0;
    state.pendingVehicle = null;
    state.exiting = 0;
    state.pendingExit = false;
    if (state.inVehicle) {
      state.inVehicle = false;
      state.vehicle = null;
      vehicles.setPlayerVehicle(null);
    }
    state.x = x;
    state.z = z;
    state.heading = heading;
    body.position.set(x, 0, z);
    body.rotation.y = heading;
  }

  return {
    state,
    body,
    update,
    tryEnter,
    exitVehicle,
    switchWeapon,
    giveWeapon,
    reload,
    tryFire,
    currentWeaponDef,
    position,
    teleport,
    syncWeaponMesh,
    heal,
    addArmor,
    setFireHandler(fn) { fireHandler = fn; },
    muzzleWorld(out) {
      hand.getWorldPosition(out || muzzleWorld);
      return out || muzzleWorld;
    },
  };
}
