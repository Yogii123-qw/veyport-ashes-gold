// camera.js — the third-person camera (F8), rewritten in phase 2.
//
// Damped yaw/pitch (no instant snaps from touch drags), aspect-adaptive
// FOV (portrait phones get a wider vertical FOV instead of tunnel
// vision), over-shoulder aim offset, vehicle chase with look-drag yield
// (drag to look around, the camera eases back behind the car),
// height-aware occlusion ray against the city, a ground clamp, and a
// recoil kick that combat feeds on every shot. The regression rule from
// SPEC §2.4 is kept as law: on vehicle entry the camera is BEHIND the
// car, and walking forward always moves the player AWAY from the camera.
//
// Modes: 'menu' (slow cinematic sweep over the city), 'foot', 'aim',
// 'drive', 'wasted' (F5 crane shot — wanted.js drives it, the camera
// move itself lives here).

import * as THREE from '../vendor/three.min.js';

const BASE_FOV = 62;
const MAX_FOV_KICK = 14;

export function createCameraRig(camera, city) {
  const rig = {
    yaw: 0.6,
    pitch: 0.32,
    targetYaw: 0.6,
    targetPitch: 0.32,
    distance: 6.5,
    mode: 'menu',
    trauma: 0,
    recoil: 0,
    dragYaw: 0, // temporary look offset while driving; decays to zero
    wastedT: 0,
    wastedHeli: null,
    wastedStart: new THREE.Vector3(),
    menuAngle: 0,
  };

  function aspectFov(aspect, speedFrac) {
    // Narrow screens (portrait phones) get a wider vertical FOV so the
    // world stays readable instead of collapsing into a tunnel.
    let fov = BASE_FOV;
    if (aspect < 1) fov += Math.min(18, (1 - aspect) * 26);
    else if (aspect > 1.8) fov -= 4;
    fov += speedFrac * MAX_FOV_KICK; // F7 speed feedback
    return fov;
  }

  function setMode(mode, data = {}) {
    if (rig.mode === mode) return;
    rig.mode = mode;
    if (mode === 'drive') {
      // Regression rule: the camera snaps BEHIND the vehicle on entry.
      rig.targetYaw = data.heading ?? rig.yaw;
      rig.yaw = rig.targetYaw;
      rig.dragYaw = 0;
    }
    if (mode === 'wasted') {
      rig.wastedT = 0;
      rig.wastedHeli = data.heliPos ?? null;
      rig.wastedStart.copy(camera.position);
    }
    if (mode === 'aim') {
      rig.targetPitch = 0.14;
    }
  }

  function addTrauma(amount) {
    rig.trauma = Math.min(1, rig.trauma + amount);
  }

  /** Recoil kick: the camera pitches up briefly on every shot. */
  function addRecoil(amount) {
    rig.recoil = Math.min(0.12, rig.recoil + amount);
  }

  function updateMenu(dt) {
    rig.menuAngle += dt * 0.045;
    const cx = Math.sin(rig.menuAngle) * 320;
    const cz = Math.cos(rig.menuAngle) * 320;
    camera.position.set(cx, 90 + Math.sin(rig.menuAngle * 0.5) * 12, cz);
    camera.lookAt(0, 10, -100);
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }

  function updateWasted(dt, ctx) {
    // F5: slow crane rise over 7 s, blending the look target from the
    // player toward the police helicopter, ending with the heli framed.
    rig.wastedT += dt;
    const t = Math.min(1, rig.wastedT / 7);
    const ease = t * t * (3 - 2 * t);
    const rise = 4 + ease * 34;
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;
    camera.position.set(px - Math.sin(rig.yaw) * 10, rise, pz - Math.cos(rig.yaw) * 10);
    const heli = rig.wastedHeli || { x: px + 20, y: 40, z: pz - 20 };
    const lookX = px + (heli.x - px) * ease;
    const lookY = 1.5 + (heli.y - 1.5) * ease;
    const lookZ = pz + (heli.z - pz) * ease;
    camera.lookAt(lookX, lookY, lookZ);
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }

  function update(dt, ctx) {
    const look = ctx.look || { dx: 0, dy: 0 };
    const aspect = ctx.aspect || 16 / 9;
    const speed = ctx.speed || 0;
    const topSpeed = ctx.topSpeed || 50;
    const speedFrac = Math.min(1, Math.abs(speed) / Math.max(1, topSpeed));

    if (rig.mode === 'menu') { updateMenu(dt); return; }
    if (rig.mode === 'wasted') { updateWasted(dt, ctx); return; }

    // --- yaw / pitch targets per mode ---
    const sens = 0.0032 * (ctx.sensitivity || 1);
    if (rig.mode === 'drive') {
      // In the car the drag is a temporary offset that yields back.
      rig.dragYaw -= look.dx * sens;
      rig.dragYaw = Math.max(-1.1, Math.min(1.1, rig.dragYaw));
      rig.targetYaw = ctx.heading + rig.dragYaw;
      rig.targetPitch = 0.24 - Math.min(0.1, speedFrac * 0.06);
    } else {
      rig.targetYaw -= look.dx * sens;
      rig.targetPitch += look.dy * sens * 0.8;
      rig.targetPitch = Math.max(-0.15, Math.min(0.75, rig.targetPitch));
      if (rig.mode === 'aim') rig.targetPitch = Math.max(0.02, Math.min(0.4, rig.targetPitch));
    }

    // Damped follow: critically smooth, never a snap.
    // P6: the drive camera follows tighter (was 5.5/s) so the car
    // stops looking diagonal while the heading changes, and a look
    // drag yields back behind the car faster (decay 1.1 -> 2.0).
    const yawRate = rig.mode === 'drive' ? 8 : 11;
    const damp = 1 - Math.exp(-yawRate * dt);
    rig.yaw += (rig.targetYaw - rig.yaw) * damp;
    rig.pitch += (rig.targetPitch - rig.pitch) * (1 - Math.exp(-9 * dt));
    rig.dragYaw *= Math.exp(-2.0 * dt); // look-drag yield
    rig.recoil *= Math.exp(-7 * dt); // recoil decays fast

    // --- desired camera position ---
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;
    const py = ctx.playerPos.y ?? 0;
    let dist = rig.mode === 'aim' ? 3.8 : rig.mode === 'drive' ? 8.6 + speedFrac * 2.2 : 6.6;
    let height = rig.mode === 'drive' ? 2.6 + speedFrac * 0.7 : 2.0;
    let side = 0;
    if (rig.mode === 'aim') {
      side = 0.95; // over-shoulder: Rook sits left of centre, not centred
      height = 1.9;
    }
    const cy = Math.cos(rig.yaw);
    const sy = Math.sin(rig.yaw);
    // Camera sits behind the target: pos = target - forward * dist.
    let camX = px - sy * dist + (-cy) * side;
    let camZ = pz - cy * dist + (sy) * side;
    let camY = py + height + Math.tan(rig.pitch + rig.recoil) * dist * 0.55;

    // --- occlusion: shorten the ray when a building stands in the way ---
    const dirX = camX - px;
    const dirY = camY - (py + 1.7);
    const dirZ = camZ - pz;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    const hit = city.raycastBuildings(px, py + 1.7, pz, dirX / len, dirY / len, dirZ / len, len);
    if (hit < Infinity && hit > 0.6) {
      const s = (hit - 0.45) / len;
      camX = px + dirX * s;
      camY = py + 1.7 + dirY * s;
      camZ = pz + dirZ * s;
    }

    // --- ground clamp: the camera never goes under the street ---
    if (camY < 1.25) camY = 1.25;

    // --- trauma shake (crashes / explosions), decays fast ---
    rig.trauma = Math.max(0, rig.trauma - dt * 1.4);
    const sh = rig.trauma * rig.trauma;
    const t = performance.now() / 1000;
    camX += Math.sin(t * 47.3) * sh * 0.35;
    camY += Math.sin(t * 39.7 + 1.3) * sh * 0.3;
    camZ += Math.cos(t * 43.1) * sh * 0.35;

    camera.position.set(camX, camY, camZ);
    const lookX = px + (rig.mode === 'aim' ? sy * 6 : 0);
    const lookZ = pz + (rig.mode === 'aim' ? cy * 6 : 0);
    camera.lookAt(lookX, py + 1.55, lookZ);

    // --- FOV: aspect-adaptive + speed kick (F7/F8) ---
    const wantFov = aspectFov(aspect, rig.mode === 'drive' ? speedFrac : 0);
    camera.fov += (wantFov - camera.fov) * Math.min(1, 6 * dt);
    camera.updateProjectionMatrix();
  }

  return {
    rig,
    setMode,
    update,
    addTrauma,
    addRecoil,
    get yaw() { return rig.yaw; },
    get mode() { return rig.mode; },
    get wastedT() { return rig.wastedT; },
  };
}
