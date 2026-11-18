// Combat: real projectiles with speed and drop, pooled tracers, muzzle
// flash, reload timers, spread that grows with movement and fire,
// headshots worth double, and damage routed to whoever was actually hit
// — civilians, gang members, officers, vehicles, or the player.

import * as THREE from 'three';
import { WEAPONS, weaponById } from '../data/weaponsData.js';
import { clamp, dist2 } from './utils.js';

const MAX_BULLETS = 120;
const GRAVITY_DROP = 2.5;

export function createCombat(game) {
  const bullets = [];
  for (let i = 0; i < MAX_BULLETS; i += 1) {
    bullets.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, left: 0, damage: 0, shooter: 'player', def: null });
  }
  let bulletCursor = 0;

  // Tracer pool: stretched additive boxes that live one frame-pair.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 40; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    game.scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerCursor = 0;

  let reloadTimer = 0;
  let reloadingWeapon = null;
  let fireCooldown = 0;
  let bloom = 0;
  let meleeCooldown = 0;
  let wasHeld = false;

  function spawnTracer(x0, y0, z0, x1, y1, z1) {
    const t = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    t.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(x1, y1, z1);
    t.mesh.visible = true;
    t.life = 0.06;
  }

  function fireBullet(origin, dir, def, shooter) {
    const b = bullets[bulletCursor];
    bulletCursor = (bulletCursor + 1) % bullets.length;
    b.active = true;
    b.x = origin.x;
    b.y = origin.y;
    b.z = origin.z;
    b.vx = dir.x * def.bulletSpeed;
    b.vy = dir.y * def.bulletSpeed;
    b.vz = dir.z * def.bulletSpeed;
    b.left = def.range;
    b.damage = def.damage;
    b.shooter = shooter;
    b.def = def;
  }

  function segmentBlockedAt(x0, y0, z0, x1, y1, z1) {
    // Buildings block shots; step along the segment for the impact point.
    if (!game.physics.segmentBlocked(x0, z0, x1, z1)) return null;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 5; i += 1) {
      const mid = (lo + hi) / 2;
      const mx = x0 + (x1 - x0) * mid;
      const mz = z0 + (z1 - z0) * mid;
      if (game.physics.segmentBlocked(x0, z0, mx, mz)) hi = mid;
      else lo = mid;
    }
    const t = hi;
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t };
  }

  function segmentHitsSphere(x0, y0, z0, x1, y1, z1, cx, cy, cz, radius) {
    // A bullet moves ~1.8 m per step at 110 m/s; a point test would tunnel
    // straight through a 1.2 m body sphere, so test the whole segment.
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const lenSq = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (lenSq > 0) {
      t = ((cx - x0) * dx + (cy - y0) * dy + (cz - z0) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const px = x0 + dx * t - cx;
    const py = y0 + dy * t - cy;
    const pz = z0 + dz * t - cz;
    return px * px + py * py + pz * pz < radius * radius;
  }

  function damageWalker(walker, amount, headshot, byPlayer) {
    const total = headshot ? amount * 2 : amount;
    if (walker.kind === 'civilian') game.pedestrians.hurt(walker, total, byPlayer, headshot);
    else if (walker.kind === 'gang' || walker.kind === 'rogue' || walker.kind === 'vex') game.gangs.hurt(walker, total, byPlayer, headshot);
    else if (walker.kind === 'officer') game.police.hurtOfficer(walker, total, byPlayer, headshot);
    if (byPlayer) {
      game.hud.showHitmarker(walker.hp <= 0);
      game.progress.stats.hits += 1;
    }
  }

  function vehicleHit(b, vehicle) {
    // Transform the bullet into the car's local frame and test the box.
    const dx = b.x - vehicle.x;
    const dz = b.z - vehicle.z;
    const cos = Math.cos(-vehicle.heading);
    const sin = Math.sin(-vehicle.heading);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const halfL = vehicle.def.length / 2 + 0.15;
    const halfW = vehicle.def.width / 2 + 0.15;
    if (Math.abs(lx) > halfW || Math.abs(lz) > halfL) return false;
    if (b.y < 0.2 || b.y > vehicle.def.height + 0.3) return false;
    return true;
  }

  function stepBullets(dt) {
    for (const b of bullets) {
      if (!b.active) continue;
      const stepLen = Math.hypot(b.vx, b.vy, b.vz) * dt;
      const nx = b.x + b.vx * dt;
      const ny = b.y + (b.vy - GRAVITY_DROP * dt) * dt;
      const nz = b.z + b.vz * dt;
      b.vy -= GRAVITY_DROP * dt;
      b.left -= stepLen;
      let consumed = b.left <= 0 || ny <= 0.02;

      // Buildings stop bullets.
      const wall = segmentBlockedAt(b.x, b.y, b.z, nx, ny, nz);
      if (wall) {
        game.particles.sparks(wall.x, wall.y, wall.z, 4);
        spawnTracer(b.x, b.y, b.z, wall.x, wall.y, wall.z);
        b.active = false;
        continue;
      }

      // Vehicles.
      if (!consumed) {
        for (const vehicle of game.vehicles.list) {
          if (vehicle.wrecked) continue;
          if (b.shooter === 'player' && vehicle === game.player.vehicle) continue;
          if (vehicleHit(b, vehicle)) {
            const wasGlass = !vehicle.brokenGlass && b.y > 1.0 && Math.random() < 0.4;
            game.vehicles.damage(vehicle, b.damage, b.x, b.z);
            if (wasGlass) {
              vehicle.brokenGlass = true;
              vehicle.cabinMesh.material = vehicle.cabinMesh.material;
              game.particles.glass(b.x, b.y, b.z);
              game.audio.playSfx('glass', b.x, b.z);
            }
            game.particles.sparks(b.x, b.y, b.z, 5);
            if (b.shooter === 'player') {
              game.hud.showHitmarker(false);
              game.progress.stats.hits += 1;
            }
            consumed = true;
            break;
          }
        }
      }

      // Walkers: body sphere + head sphere.
      if (!consumed) {
        const candidates = [];
        for (const w of game.pedestrians.walkers) if (w.state !== 'dead') candidates.push(w);
        for (const m of game.gangs.members) if (m.state !== 'dead') candidates.push(m);
        for (const u of game.police.units) if (u.officer && u.officer.state !== 'dead') candidates.push(u.officer);
        for (const w of candidates) {
          // NPC crossfire can hit civilians, never their own side's fighters.
          if (b.shooter === 'npc' && w.kind !== 'civilian') continue;
          const headshot = segmentHitsSphere(b.x, b.y, b.z, nx, ny, nz, w.x, 1.7, w.z, 0.32);
          const body = !headshot && segmentHitsSphere(b.x, b.y, b.z, nx, ny, nz, w.x, 1.1, w.z, 0.62);
          if (headshot || body) {
            damageWalker(w, b.damage, headshot, b.shooter === 'player');
            consumed = true;
            break;
          }
        }
      }

      // The player (NPC bullets only).
      if (!consumed && b.shooter === 'npc' && !game.player.vehicle) {
        const headshot = segmentHitsSphere(b.x, b.y, b.z, nx, ny, nz, game.player.x, game.player.y + 1.7, game.player.z, 0.32);
        const body = !headshot && segmentHitsSphere(b.x, b.y, b.z, nx, ny, nz, game.player.x, game.player.y + 1.1, game.player.z, 0.62);
        if (headshot || body) {
          game.player.hurt(b.damage * (headshot ? 2 : 1), 'shot');
          game.player.lastCombatAt = game.time;
          consumed = true;
        }
      }
      if (!consumed && b.shooter === 'npc' && game.player.vehicle) {
        if (vehicleHit(b, game.player.vehicle)) {
          game.vehicles.damage(game.player.vehicle, b.damage * 0.6, b.x, b.z);
          game.particles.sparks(b.x, b.y, b.z, 4);
          consumed = true;
        }
      }

      if (consumed) {
        spawnTracer(b.x, b.y, b.z, nx, ny, nz);
        b.active = false;
      } else {
        spawnTracer(b.x, b.y, b.z, nx, ny, nz);
        b.x = nx;
        b.y = ny;
        b.z = nz;
      }
    }
    for (const t of tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  function aimDirection() {
    // Through the crosshair: from the camera, far along its forward ray.
    const cam = game.cameraRig.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = new THREE.Vector3(game.player.x, game.player.y + 1.4, game.player.z);
    const far = new THREE.Vector3().copy(cam.position).add(dir.multiplyScalar(80));
    return far.sub(origin).normalize();
  }

  function playerShoot(dt) {
    const def = weaponById(game.player.currentWeapon);
    const slot = game.player.weapons[def.id];
    if (!slot) return;
    if (def.kind === 'melee') {
      if (meleeCooldown > 0) return;
      meleeCooldown = def.fireInterval;
      game.audio.playSfx('punch', game.player.x, game.player.z);
      game.progress.stats.shots += 1;
      const reach = def.range;
      const fwd = { x: Math.sin(game.player.heading), z: Math.cos(game.player.heading) };
      const candidates = [];
      for (const w of game.pedestrians.walkers) if (w.state !== 'dead') candidates.push(w);
      for (const m of game.gangs.members) if (m.state !== 'dead') candidates.push(m);
      for (const u of game.police.units) if (u.officer && u.officer.state !== 'dead') candidates.push(u.officer);
      for (const w of candidates) {
        const d = dist2(w.x, w.z, game.player.x, game.player.z);
        if (d > reach) continue;
        const dot = ((w.x - game.player.x) * fwd.x + (w.z - game.player.z) * fwd.z) / Math.max(d, 0.01);
        if (dot < 0.4) continue;
        damageWalker(w, def.damage, false, true);
        w.x += fwd.x * 0.8;
        w.z += fwd.z * 0.8;
      }
      return;
    }
    if (fireCooldown > 0 || reloadTimer > 0) return;
    if (slot.mag <= 0) {
      if (slot.reserve > 0) startReload();
      else game.hud.notify(game.lang('outOfAmmo'), 'bad');
      fireCooldown = 0.3;
      return;
    }
    fireCooldown = def.fireInterval;
    slot.mag -= 1;
    game.progress.stats.shots += 1;
    game.player.lastCombatAt = game.time;
    bloom = Math.min(0.04, bloom + def.recoil * 1.4);
    const baseDir = aimDirection();
    const spread = def.spread + bloom + (game.player.speed > 1 ? 0.012 : 0) + (game.player.vehicle ? 0.02 : 0);
    const origin = { x: game.player.x, y: game.player.y + 1.4, z: game.player.z };
    if (game.player.vehicle) {
      origin.y = 1.5;
      const fwd = { x: Math.sin(game.player.vehicle.heading), z: Math.cos(game.player.vehicle.heading) };
      origin.x += fwd.z * 0.9;
      origin.z -= fwd.x * 0.9;
    }
    for (let p = 0; p < def.pellets; p += 1) {
      const dir = {
        x: baseDir.x + (Math.random() - 0.5) * spread * 2,
        y: baseDir.y + (Math.random() - 0.5) * spread * 2,
        z: baseDir.z + (Math.random() - 0.5) * spread * 2,
      };
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dir.x /= len;
      dir.y /= len;
      dir.z /= len;
      fireBullet(origin, dir, def, 'player');
    }
    game.particles.muzzle(origin.x, origin.y, origin.z);
    game.audio.playSfx(def.sound, game.player.x, game.player.z);
    game.events.emit('gunshot', { x: game.player.x, z: game.player.z, loud: true, shooter: 'player' });
    game.events.emit('crime', { kind: 'gunshot', x: game.player.x, z: game.player.z, heat: 15 });
    game.cameraRig.addTrauma(def.recoil * 2.2);
  }

  function startReload() {
    const def = weaponById(game.player.currentWeapon);
    const slot = game.player.weapons[def.id];
    if (!slot || def.magSize === 0 || slot.mag >= def.magSize || slot.reserve <= 0 || reloadTimer > 0) return false;
    reloadTimer = def.reloadTime;
    reloadingWeapon = def.id;
    game.audio.playSfx('reload', game.player.x, game.player.z);
    game.hud.notify(game.lang('reloading'), 'good');
    return true;
  }

  function npcShoot(shooter, targetX, targetY, targetZ, weaponId, accuracy) {
    const def = weaponById(weaponId);
    const origin = { x: shooter.x, y: shooter.y ?? 1.4, z: shooter.z };
    const dx = targetX - origin.x;
    const dy = targetY - origin.y;
    const dz = targetZ - origin.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const spread = (1 - accuracy) * 0.14 + 0.01;
    const dir = {
      x: dx / len + (Math.random() - 0.5) * spread * 2,
      y: dy / len + (Math.random() - 0.5) * spread * 2,
      z: dz / len + (Math.random() - 0.5) * spread * 2,
    };
    const dLen = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= dLen;
    dir.y /= dLen;
    dir.z /= dLen;
    fireBullet(origin, dir, def, 'npc');
    game.particles.muzzle(origin.x, origin.y, origin.z);
    game.audio.playSfx(def.sound, shooter.x, shooter.z);
    game.events.emit('gunshot', { x: shooter.x, z: shooter.z, loud: true, shooter: 'npc' });
  }

  function blastDamage(x, z, radius, maxDamage) {
    const hurtList = [];
    for (const w of game.pedestrians.walkers) if (w.state !== 'dead') hurtList.push(w);
    for (const m of game.gangs.members) if (m.state !== 'dead') hurtList.push(m);
    for (const u of game.police.units) if (u.officer && u.officer.state !== 'dead') hurtList.push(u.officer);
    for (const w of hurtList) {
      const d = dist2(w.x, w.z, x, z);
      if (d < radius) {
        const dmg = (1 - d / radius) * maxDamage;
        if (w.kind === 'civilian') game.pedestrians.hurt(w, dmg, false, false);
        else if (w.kind === 'officer') game.police.hurtOfficer(w, dmg, false, false);
        else game.gangs.hurt(w, dmg, false, false);
      }
    }
  }

  function update(dt, input, pressed) {
    fireCooldown = Math.max(0, fireCooldown - dt);
    meleeCooldown = Math.max(0, meleeCooldown - dt);
    bloom = Math.max(0, bloom - dt * 0.09);
    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        const def = weaponById(reloadingWeapon);
        const slot = game.player.weapons[reloadingWeapon];
        if (slot) {
          const need = def.magSize - slot.mag;
          const take = Math.min(need, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
        }
        reloadingWeapon = null;
      }
    }
    if (pressed.has('reload')) startReload();
    const def = weaponById(game.player.currentWeapon);
    const wantFire = input.fireHeld() && !game.ui.isOverlayOpen();
    if (wantFire && !game.player.dead) {
      // Automatics fire while held; semi-autos fire on the press edge.
      if (def.auto || def.kind === 'melee' || !wasHeld) playerShoot(dt);
    }
    wasHeld = input.fireHeld();
    stepBullets(dt);
  }

  function reset() {
    for (const b of bullets) b.active = false;
    for (const t of tracers) t.mesh.visible = false;
    reloadTimer = 0;
    reloadingWeapon = null;
    bloom = 0;
  }

  return {
    update, reset, startReload, npcShoot, blastDamage,
    // Read-only debug view: live bullet positions, used by playtests to
    // verify trajectories. It exposes no control over the simulation.
    debugBullets() {
      return bullets.filter((b) => b.active).map((b) => ({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, shooter: b.shooter }));
    },
    get reloading() { return reloadTimer > 0; },
    get bloom() { return bloom; },
    accuracy() {
      const s = game.progress.stats;
      return s.shots > 0 ? s.hits / s.shots : 0;
    },
  };
}
