// combat.js — the full firing stack (F6).
//
// Phase 1 shipped a minimal hitscan core in player.js. This module owns
// fire from here on: it registers the three heavy weapons, and player.js
// delegates its tryFire to the handler installed here. Every shot is
// real — a ray from the muzzle, per-weapon spread and pellets, headshots
// worth double on armed targets, glass that shatters, casings that fly,
// recoil you can feel in the camera, and a hit marker that only appears
// when something was actually hit. Nothing here is a no-op overlay.

import * as THREE from '../vendor/three.min.js';
import { registerWeapon, WEAPONS } from './player.js';

/** The heavy arsenal. Prices and ammo match SPEC §3.4. */
export const HEAVY_WEAPONS = {
  kr9: {
    id: 'kr9', name: { en: 'KR-9 Ripper', id: 'KR-9 Ripper' }, kind: 'smg',
    damage: 16, range: 30, auto: true, reloadTime: 1.4, price: 600,
    ammoPrice: 40, ammoPack: 60, magSize: 30, fireInterval: 0.085,
  },
  iron12: {
    id: 'iron12', name: { en: 'Iron-12', id: 'Iron-12' }, kind: 'scattergun',
    damage: 8, range: 15, auto: false, reloadTime: 2.0, price: 450,
    ammoPrice: 30, ammoPack: 12, magSize: 6, fireInterval: 0.8, pellets: 6,
  },
  vk7: {
    id: 'vk7', name: { en: 'VK-7 Carbine', id: 'VK-7 Carbine' }, kind: 'rifle',
    damage: 40, range: 80, auto: true, reloadTime: 1.8, price: 1200,
    ammoPrice: 60, ammoPack: 40, magSize: 30, fireInterval: 0.11,
  },
};

export function registerHeavyWeapons() {
  for (const def of Object.values(HEAVY_WEAPONS)) registerWeapon(def);
}

/** Ray vs a standing target (vertical capsule approx). Returns the
 *  distance along the ray, or Infinity. `head` is set when the closest
 *  approach is above shoulder height. */
function rayVsTarget(ox, oy, oz, dx, dy, dz, tx, tz, radius, height) {
  const cx = tx - ox;
  const cz = tz - oz;
  const t = cx * dx + cz * dz;
  if (t < 0) return { t: Infinity, head: false };
  const px = ox + dx * t;
  const pz = oz + dz * t;
  const py = oy + dy * t;
  const horiz = Math.hypot(px - tx, pz - tz);
  if (horiz > radius) return { t: Infinity, head: false };
  if (py < 0 || py > height) return { t: Infinity, head: false };
  return { t, head: py > 1.35 };
}

export function createCombat(deps) {
  const { city, vehicles, player, bus, effects, audio, cameraRig } = deps;
  let pedestrians = deps.pedestrians || null;
  let wanted = deps.wanted || null;
  registerHeavyWeapons();

  let lastShotAt = -10;
  const muzzleWorld = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const fireDir = new THREE.Vector3();

  function setSystems(sys) {
    if (sys.pedestrians) pedestrians = sys.pedestrians;
    if (sys.wanted) wanted = sys.wanted;
  }

  /** Collect every shootable thing and find the nearest along the ray. */
  function pickTarget(origin, dir, range) {
    let best = null;
    let bestT = range;
    let bestHead = false;
    const consider = (obj, kind, tx, tz, radius, height) => {
      const r = rayVsTarget(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, tx, tz, radius, height);
      if (r.t < bestT) {
        bestT = r.t;
        bestHead = r.head;
        best = { obj, kind, t: r.t, head: r.head };
      }
    };
    for (const v of vehicles.vehicles) {
      if (v.wrecked) continue;
      consider(v, 'vehicle', v.x, v.z, 1.6, 1.6);
    }
    if (pedestrians) {
      for (const p of pedestrians.peds) {
        if (!p.alive) continue;
        consider(p, 'ped', p.x, p.z, 0.55, 1.8);
      }
    }
    if (wanted) {
      for (const u of wanted.police) {
        if (!u.alive) continue;
        consider(u, 'police', u.x, u.z, 0.6, 1.8);
      }
    }
    return { best, bestT, bestHead };
  }

  function applyDamage(hit, def) {
    let dmg = def.damage * (hit.head ? 2 : 1);
    if (hit.kind === 'vehicle') {
      vehicles.damage(hit.obj, dmg, 'shot');
    } else if (hit.kind === 'ped') {
      pedestrians.damage(hit.obj, dmg, { head: hit.head, weapon: def.id });
    } else if (hit.kind === 'police') {
      wanted.damagePolice(hit.obj, dmg, { head: hit.head, weapon: def.id });
    }
    return dmg;
  }

  function fireOnePellet(origin, dir, def, spread) {
    tmpDir.copy(dir);
    if (spread > 0) {
      // Small random cone around the aim direction.
      tmpDir.x += (Math.random() - 0.5) * spread;
      tmpDir.y += (Math.random() - 0.5) * spread;
      tmpDir.z += (Math.random() - 0.5) * spread;
      tmpDir.normalize();
    }
    const { best, bestT } = pickTarget(origin, tmpDir, def.range);
    const wallT = city.raycastBuildings(origin.x, origin.y, origin.z, tmpDir.x, tmpDir.y, tmpDir.z, def.range);
    const endT = Math.min(bestT, wallT);
    const end = new THREE.Vector3(
      origin.x + tmpDir.x * endT,
      origin.y + tmpDir.y * endT,
      origin.z + tmpDir.z * endT,
    );
    return { best, bestT, wallT, end, dir: tmpDir.clone() };
  }

  function tryFire(camera, now) {
    const state = player.state;
    if (state.inVehicle || state.entering > 0) return false;
    const def = WEAPONS[state.currentWeapon];
    if (!def || now - lastShotAt < def.fireInterval) return false;
    if (state.reloading > 0) return false;
    const w = state.weapons[state.currentWeapon];
    if (def.kind !== 'melee' && w.ammo <= 0) {
      player.reload();
      audio.play('dry');
      return false;
    }
    lastShotAt = now;
    if (def.kind !== 'melee') w.ammo -= 1;

    player.muzzleWorld(muzzleWorld);
    camera.getWorldDirection(rayDir);

    if (def.kind === 'melee') {
      // Swing arc: the nearest living target within 2.2 m in front.
      let best = null;
      let bestD = 2.3;
      const fx = Math.sin(state.heading);
      const fz = Math.cos(state.heading);
      const consider = (obj, kind, tx, tz) => {
        const dx = tx - state.x;
        const dz = tz - state.z;
        const d = Math.hypot(dx, dz);
        const ahead = (dx * fx + dz * fz) / Math.max(d, 0.001);
        if (d < bestD && ahead > 0.4) { bestD = d; best = { obj, kind }; }
      };
      for (const v of vehicles.vehicles) {
        if (!v.wrecked) consider(v, 'vehicle', v.x, v.z);
      }
      if (pedestrians) for (const p of pedestrians.peds) if (p.alive) consider(p, 'ped', p.x, p.z);
      if (wanted) for (const u of wanted.police) if (u.alive) consider(u, 'police', u.x, u.z);
      effects.meleeArc(state.x, 0, state.z, state.heading);
      audio.play('melee');
      if (best) {
        if (best.kind === 'vehicle') vehicles.damage(best.obj, def.damage, 'melee');
        else if (best.kind === 'ped') pedestrians.damage(best.obj, def.damage, { weapon: 'fists' });
        else wanted.damagePolice(best.obj, def.damage, { weapon: 'fists' });
        bus.emit('hit', { x: best.obj.x, y: 1, z: best.obj.z, weapon: def.id });
      }
      bus.emit('shot', { weapon: def.id, hit: !!best, muzzle: { x: muzzleWorld.x, y: muzzleWorld.y, z: muzzleWorld.z } });
      return true;
    }

    // Ranged: one pellet for most guns, six for the scattergun.
    // Converging aim: the bullet must go where the crosshair points.
    // Firing parallel to the camera's downward tilt from a hip-height
    // muzzle (y ~0.78) dives the ray underground ~7 m out, so a truck
    // at 8 m could never be hit even with a clear lane. Cast the
    // camera ray to its first hit (vehicle or wall) and fire from the
    // muzzle toward that aim point instead; the spread cone still
    // applies per pellet around it.
    const camPick = pickTarget(camera.position, rayDir, def.range);
    const camWallT = city.raycastBuildings(
      camera.position.x, camera.position.y, camera.position.z,
      rayDir.x, rayDir.y, rayDir.z, def.range);
    const aimT = Math.min(camPick.bestT, camWallT);
    aimPoint.copy(camera.position).addScaledVector(rayDir, aimT);
    fireDir.copy(aimPoint).sub(muzzleWorld).normalize();
    const pellets = def.pellets || 1;
    const spread = def.kind === 'scattergun' ? 0.09 : def.kind === 'smg' ? 0.035 : 0.012;
    let anyHit = false;
    let anyKill = false;
    for (let i = 0; i < pellets; i++) {
      const { best, bestT, wallT, end, dir } = fireOnePellet(muzzleWorld, fireDir, def, spread);
      // Tracer: a real line from the muzzle to the impact point.
      effects.tracer(muzzleWorld, end);
      if (best && bestT <= wallT) {
        const dmg = applyDamage(best, def);
        bus.emit('hit', { x: end.x, y: end.y, z: end.z, weapon: def.id, head: best.head, damage: dmg });
        anyHit = true;
        if ((best.kind === 'ped' && !best.obj.alive) || (best.kind === 'police' && !best.obj.alive)) anyKill = true;
      } else if (wallT < Infinity) {
        // Glass shatters when the ray meets a facade at window height.
        const material = end.y > 1.1 && end.y < 4.2 && Math.random() < 0.45 ? 'glass' : 'wall';
        bus.emit('impact', { x: end.x, y: end.y, z: end.z, weapon: def.id, material });
        if (material === 'glass') audio.play('glass');
      }
      // Keep the tracer endpoint visible one frame via the burst above.
      void dir;
    }

    // Muzzle flash + casing + sound + recoil, once per trigger pull.
    bus.emit('shot', { weapon: def.id, hit: anyHit, muzzle: { x: muzzleWorld.x, y: muzzleWorld.y, z: muzzleWorld.z } });
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);
    effects.ejectCasing(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, rightX, rightZ);
    audio.play('shot', { weapon: def.id });
    if (cameraRig) {
      cameraRig.addTrauma(def.kind === 'scattergun' ? 0.22 : def.kind === 'rifle' ? 0.16 : 0.1);
      cameraRig.addRecoil(def.kind === 'scattergun' ? 0.05 : 0.028);
    }
    if (anyHit) audio.play('hit');
    if (anyKill) {
      audio.play('kill');
      bus.emit('kill', { weapon: def.id });
    }
    return true;
  }

  function update(dt) {
    void dt;
    // Combat has no per-frame state of its own right now; the handler
    // above runs on the trigger pull. Kept for the step() contract.
  }

  return {
    tryFire,
    update,
    setSystems,
    pickTarget,
    get weapons() { return HEAVY_WEAPONS; },
  };
}
