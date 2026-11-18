// Rook Calloway: walking, running, jumping, driving, entering and
// leaving cars, carjacking, health and armor. Movement on foot is
// camera-relative by construction — forward input moves along the
// camera's forward, so walking forward always moves away from the lens.

import { ARMOR, WEAPONS, weaponById } from '../data/weaponsData.js';
import { clamp, dampAngle, dist2, forwardOf } from './utils.js';
import { animateWalker, buildWalkerMesh } from './pedestrians.js';

const WALK_SPEED = 5;
const RUN_SPEED = 8.5;

export function createPlayer(game) {
  const parts = buildWalkerMesh(0x7a2f22, 0xd9a77c, 0x2a2018, 0x2a2e35);
  parts.group.position.set(0, 0, 0);
  game.scene.add(parts.group);

  const player = {
    x: 0, z: 0, y: 0, vy: 0, heading: Math.PI, speed: 0,
    hp: 100, maxHp: 100, armor: 0, armorTier: 'none',
    vehicle: null, entering: null, exiting: false, enterTimer: 0,
    walkPhase: 0, moving: 0, aiming: false, stagger: 0,
    weapons: {}, currentWeapon: 'fists', medkits: 1,
    lastDamageAt: -99, lastCombatAt: -99, stepTimer: 0, skidTimer: 0,
    lightsOn: false, dead: false, parts,
  };

  function giveWeapon(id, withAmmo) {
    const def = weaponById(id);
    if (!player.weapons[id]) {
      player.weapons[id] = { mag: def.magSize, reserve: withAmmo ? def.ammoPack * 2 : 0 };
    } else if (withAmmo) {
      player.weapons[id].reserve += def.ammoPack * 2;
    }
    return player.weapons[id];
  }

  function resetWeapons() {
    player.weapons = { fists: { mag: 0, reserve: 0 } };
    giveWeapon('p9', true);
    player.currentWeapon = 'fists';
  }

  function hurt(amount, source) {
    if (player.dead || game.ui.isMenuOpen()) return;
    const absorb = ARMOR[player.armorTier] ? ARMOR[player.armorTier].absorb : 0;
    let remaining = amount;
    if (player.armor > 0 && absorb > 0) {
      const absorbed = Math.min(player.armor, amount * absorb);
      player.armor -= absorbed;
      remaining = amount - absorbed;
      if (player.armor <= 0) player.armorTier = 'none';
    }
    player.hp -= remaining;
    game.progress.stats.hpLost = (game.progress.stats.hpLost || 0) + remaining;
    player.lastDamageAt = game.time;
    player.lastCombatAt = game.time;
    game.hud.flashDamage();
    game.cameraRig.addTrauma(clamp(amount / 60, 0.15, 0.6));
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      game.wanted.onPlayerDeath(source);
    }
  }

  function heal(amount) {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    if (player.hp > before) game.particles.heal(player.x, 1.2, player.z);
    return player.hp - before;
  }

  function useMedkit() {
    if (player.medkits <= 0) {
      game.hud.notify(game.lang('noMedkit'), 'bad');
      return false;
    }
    if (game.time - player.lastCombatAt < 5) {
      game.hud.notify(game.lang('combatLock'), 'bad');
      return false;
    }
    if (player.hp >= player.maxHp) return false;
    player.medkits -= 1;
    heal(50);
    game.audio.playSfx('pickup', player.x, player.z);
    return true;
  }

  function nearestVehicle(radius) {
    return game.vehicles.nearest(player.x, player.z, radius, (v) => !v.burning);
  }

  function tryEnterVehicle() {
    if (player.vehicle || player.entering || player.exiting || player.dead) return false;
    const vehicle = nearestVehicle(4.2);
    if (!vehicle) return false;
    if (vehicle.driver === 'traffic') {
      // Carjack: the driver flees on foot, witnesses may call it in.
      vehicle.driver = null;
      vehicle.parked = false;
      const driver = game.pedestrians.spawnWalker(vehicle.x + 2, vehicle.z + 2);
      game.pedestrians.startFlee(driver, vehicle.x, vehicle.z);
      game.events.emit('crime', { kind: 'carjack', x: vehicle.x, z: vehicle.z, heat: 12 });
      game.progress.stats.carsStolen += 1;
      game.audio.playSfx('door', vehicle.x, vehicle.z);
    }
    player.entering = vehicle;
    player.enterTimer = 0.6;
    game.audio.playSfx('door', vehicle.x, vehicle.z);
    return true;
  }

  function completeEnter() {
    const vehicle = player.entering;
    player.entering = null;
    player.vehicle = vehicle;
    vehicle.driver = 'player';
    vehicle.parked = false;
    player.x = vehicle.x;
    player.z = vehicle.z;
    player.heading = vehicle.heading;
    parts.group.visible = false;
    // THE camera rule: snap behind the car's heading on entry.
    game.cameraRig.snapBehind(vehicle.heading);
    game.events.emit('enteredVehicle', { vehicle });
  }

  function exitVehicle() {
    const vehicle = player.vehicle;
    if (!vehicle || player.exiting) return;
    const speed = vehicle.speed;
    player.vehicle = null;
    vehicle.driver = null;
    const fwd = forwardOf(vehicle.heading);
    player.x = vehicle.x - fwd.z * 2.2;
    player.z = vehicle.z + fwd.x * 2.2;
    player.y = 0;
    player.vy = 0;
    player.heading = vehicle.heading;
    player.exiting = true;
    player.enterTimer = 0.4;
    parts.group.visible = true;
    game.audio.playSfx('door', player.x, player.z);
    if (speed > 8) {
      hurt(speed * 0.9, 'bail');
      player.stagger = 0.8;
    }
    game.events.emit('exitedVehicle', { vehicle });
  }

  function updateOnFoot(dt, input, pressed) {
    player.aiming = input.aimHeld() || input.fireHeld();
    if (player.stagger > 0) player.stagger -= dt;
    const axis = input.axis();
    const camFwd = game.cameraRig.forward();
    const camRight = { x: camFwd.z, z: -camFwd.x };
    let wishX = camFwd.x * axis.y + camRight.x * axis.x;
    let wishZ = camFwd.z * axis.y + camRight.z * axis.x;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.01) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }
    const speed = input.sprint() ? RUN_SPEED : WALK_SPEED;
    const slowed = player.stagger > 0 ? 0.4 : 1;
    const moving = wishLen > 0.1;
    if (moving) {
      game.physics.moveWalker(player, wishX, wishZ, speed * slowed, dt);
      const targetHeading = player.aiming ? game.cameraRig.yaw : Math.atan2(wishX, wishZ);
      player.heading = dampAngle(player.heading, targetHeading, player.aiming ? 14 : 9, dt);
      player.speed = speed * slowed;
      player.moving = 1;
    } else {
      player.speed = 0;
      player.moving = 0;
      if (player.aiming) player.heading = dampAngle(player.heading, game.cameraRig.yaw, 14, dt);
    }
    // Jump: real vertical velocity, gravity, landing thump. On foot,
    // Space jumps; in a vehicle the same key is the handbrake.
    if (pressed.has('jump') && player.y <= 0) {
      player.vy = 6.5;
    }
    if (player.y > 0 || player.vy !== 0) {
      player.vy -= 20 * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        game.particles.dust(player.x, 0.2, player.z);
      }
    }
    if (moving && player.y <= 0) {
      player.stepTimer -= dt * player.speed;
      if (player.stepTimer <= 0) {
        player.stepTimer = 2.4;
        game.audio.playSfx('step', player.x, player.z);
      }
    }
    player.walkPhase += dt * (moving ? (input.sprint() ? 11 : 7.5) : 0);
    animateWalker(parts, player.walkPhase, player.moving, player.aiming, false);
    parts.group.position.set(player.x, player.y, player.z);
    parts.group.rotation.y = player.heading;
    game.progress.stats.distanceWalked += player.speed * dt * (moving ? 1 : 0);
  }

  function updateDriving(dt, input, pressed) {
    const vehicle = player.vehicle;
    const drive = {
      throttle: input.throttle(),
      steer: input.steer(),
      handbrake: input.handbrake(),
    };
    const gripScale = game.weather.gripMultiplier();
    const collision = game.physics.stepVehicle(vehicle, vehicle.def, drive, dt, gripScale);
    player.x = vehicle.x;
    player.z = vehicle.z;
    player.y = vehicle.y;
    player.heading = vehicle.heading;
    player.speed = vehicle.speed;
    if (collision) {
      const dmg = collision.speed * 1.6;
      if (dmg > 4) {
        game.vehicles.damage(vehicle, dmg, vehicle.x, vehicle.z);
        game.cameraRig.addTrauma(clamp(collision.speed / 28, 0.15, 0.7));
        game.particles.sparks(vehicle.x, 0.8, vehicle.z, 10);
        game.audio.playSfx('crash', vehicle.x, vehicle.z);
        game.events.emit('crash', { x: vehicle.x, z: vehicle.z, speed: collision.speed, vehicle, other: null });
        if (collision.speed > 8) {
          game.events.emit('crime', { kind: 'property', x: vehicle.x, z: vehicle.z, heat: 8 });
        }
        if (vehicle.def && vehicle.integrity <= 0) {
          // Burning car: the player must get out before it blows.
          game.hud.notify(game.lang('wasted') === 'WASTED' ? 'Get out — the car is burning!' : 'Keluar — mobil terbakar!', 'bad');
        }
      }
    }
    // Stunt ramps launch the car.
    if (vehicle.y <= 0 && vehicle.vy === 0) {
      for (const jump of game.contracts.stuntJumps) {
        if (dist2(vehicle.x, vehicle.z, jump.x, jump.z) < 5 && vehicle.speed > 12) {
          const headingDiff = Math.abs(((vehicle.heading - jump.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (headingDiff < 0.7) {
            vehicle.vy = vehicle.speed * 0.42 * jump.ramp;
            vehicle.airStart = { x: vehicle.x, z: vehicle.z };
            vehicle.airTime = 0;
            game.audio.playSfx('crash', vehicle.x, vehicle.z);
          }
        }
      }
    }
    if (vehicle.airStart && vehicle.y <= 0 && vehicle.vy === 0 && vehicle.airTime > 0.3) {
      const airDist = dist2(vehicle.airStart.x, vehicle.airStart.z, vehicle.x, vehicle.z);
      game.contracts.recordStunt(vehicle.airTime, airDist, vehicle.x, vehicle.z);
      vehicle.airStart = null;
      vehicle.airTime = 0;
    }
    // Drift smoke + skid marks + skid audio.
    game.audio.setSkid(vehicle.drifting, vehicle.slip / 10);
    if (vehicle.drifting) {
      player.skidTimer -= dt;
      const fwd = forwardOf(vehicle.heading);
      const backX = vehicle.x - fwd.x * vehicle.def.length * 0.3;
      const backZ = vehicle.z - fwd.z * vehicle.def.length * 0.3;
      game.particles.tireSmoke(backX, 0.3, backZ, vehicle.vx, vehicle.vz);
      if (player.skidTimer <= 0) {
        player.skidTimer = 0.09;
        game.particles.skid(backX - fwd.z * 0.7, backZ + fwd.x * 0.7, vehicle.heading);
        game.particles.skid(backX + fwd.z * 0.7, backZ - fwd.x * 0.7, vehicle.heading);
      }
    }
    if (pressed.has('horn')) game.audio.playSfx('horn', vehicle.x, vehicle.z);
    if (pressed.has('lights')) {
      player.lightsOn = !player.lightsOn;
      game.hud.notify(player.lightsOn ? 'Headlights on' : 'Headlights off', 'good');
    }
    game.progress.stats.distanceDriven += vehicle.speed * dt;
    // A burning car ejects its driver with the explosion.
    if (vehicle.burning && vehicle.explodeTimer <= 0.4 && player.vehicle === vehicle) {
      exitVehicle();
    }
    if (vehicle.wrecked && player.vehicle === vehicle) {
      player.vehicle = null;
      parts.group.visible = true;
    }
  }

  function update(dt, input, pressed) {
    if (player.dead) return;
    if (player.entering) {
      player.enterTimer -= dt;
      if (player.enterTimer <= 0) completeEnter();
      return;
    }
    if (player.exiting) {
      player.enterTimer -= dt;
      if (player.enterTimer <= 0) player.exiting = false;
    }
    if (pressed.has('enter')) {
      if (player.vehicle) exitVehicle();
      else tryEnterVehicle();
    }
    if (player.vehicle) updateDriving(dt, input, pressed);
    else updateOnFoot(dt, input, pressed);
    if (pressed.has('medkit')) useMedkit();
    // Weapon switching.
    for (let slot = 1; slot <= 5; slot += 1) {
      if (pressed.has(`weapon${slot}`)) {
        const def = WEAPONS[slot - 1];
        if (player.weapons[def.id]) {
          player.currentWeapon = def.id;
          game.audio.playSfx('click');
        }
      }
    }
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const owned = WEAPONS.filter((w) => player.weapons[w.id]);
      if (owned.length > 1) {
        const idx = owned.findIndex((w) => w.id === player.currentWeapon);
        const next = owned[(idx + (wheel > 0 ? 1 : -1) + owned.length) % owned.length];
        player.currentWeapon = next.id;
        game.audio.playSfx('click');
      }
    }
  }

  function teleport(x, z, heading) {
    if (player.vehicle) {
      player.vehicle.x = x;
      player.vehicle.z = z;
      player.vehicle.heading = heading;
      player.vehicle.vx = 0;
      player.vehicle.vz = 0;
    }
    player.x = x;
    player.z = z;
    player.y = 0;
    player.vy = 0;
    player.heading = heading;
    parts.group.position.set(x, 0, z);
    parts.group.rotation.y = heading;
  }

  function reset(spawn) {
    player.hp = player.maxHp;
    player.armor = 0;
    player.armorTier = 'none';
    player.vehicle = null;
    player.entering = null;
    player.exiting = false;
    player.dead = false;
    player.medkits = 1;
    player.stagger = 0;
    resetWeapons();
    teleport(spawn.x, spawn.z, spawn.heading);
    parts.group.visible = true;
  }

  resetWeapons();

  return {
    ...player,
    get x() { return player.x; },
    set x(v) { player.x = v; },
    get z() { return player.z; },
    set z(v) { player.z = v; },
    get y() { return player.y; },
    set y(v) { player.y = v; },
    get heading() { return player.heading; },
    set heading(v) { player.heading = v; },
    get hp() { return player.hp; },
    set hp(v) { player.hp = v; },
    get armor() { return player.armor; },
    set armor(v) { player.armor = v; },
    get armorTier() { return player.armorTier; },
    set armorTier(v) { player.armorTier = v; },
    get vehicle() { return player.vehicle; },
    set vehicle(v) { player.vehicle = v; },
    get dead() { return player.dead; },
    set dead(v) { player.dead = v; },
    get speed() { return player.speed; },
    get currentWeapon() { return player.currentWeapon; },
    set currentWeapon(v) { player.currentWeapon = v; },
    get weapons() { return player.weapons; },
    set weapons(v) { player.weapons = v; },
    get medkits() { return player.medkits; },
    set medkits(v) { player.medkits = v; },
    get aiming() { return player.aiming; },
    get lightsOn() { return player.lightsOn; },
    set lightsOn(v) { player.lightsOn = v; },
    get parts() { return parts; },
    get lastCombatAt() { return player.lastCombatAt; },
    set lastCombatAt(v) { player.lastCombatAt = v; },
    get lastDamageAt() { return player.lastDamageAt; },
    giveWeapon, hurt, heal, useMedkit, tryEnterVehicle, exitVehicle,
    nearestVehicle, update, teleport, reset,
    state: player,
  };
}
