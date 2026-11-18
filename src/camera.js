// The third-person camera: behind the player on foot, behind the car in
// a vehicle, with speed look-ahead, a field-of-view kick, and shake that
// scales with impact. The regression rule lives here and is enforced by
// construction: on entering a vehicle the camera yaw snaps to the
// vehicle's heading, so the camera sits behind the car and forward driving
// moves away from the camera. On foot, forward input moves along the
// camera's forward, so walking forward always moves away from the camera.
//
// Framing adapts to the viewport: on a narrow (portrait phone) screen the
// vertical FOV widens and the camera pulls back, so the view never
// collapses into tunnel vision. Look input steers a target yaw/pitch that
// the camera damps toward, so touch drags feel smooth instead of jittery.
// Aiming shifts to an over-shoulder offset. In a vehicle the camera
// chases the car's heading faster the faster and harder the car turns,
// but never fights an active look drag. The WASTED crane shot is a
// separate mode: a slow rise and orbit that ends looking at the police
// helicopter.

import * as THREE from 'three';
import { clamp, damp, dampAngle, easeInOutCubic, forwardOf, smoothstep } from './utils.js';
import { MENU_CAMERA } from '../data/cityData.js';

export function createCameraRig(game) {
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
  let yaw = Math.PI;
  let pitch = 0.32;
  let targetYaw = Math.PI;
  let targetPitch = 0.32;
  let distance = 8;
  let trauma = 0;
  let fov = 62;
  let menuAngle = 0;
  let shakeTime = 0;
  let aspect = 1;
  let lookIdleTimer = 0;
  let shoulder = 0;
  let speedShakeTime = 0;
  // WASTED crane state.
  let wastedYaw = 0;
  const tmpFocus = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();

  function addTrauma(amount) {
    trauma = clamp(trauma + amount, 0, 1);
  }

  /** Snap the camera behind a heading: used on vehicle entry, no lerp. */
  function snapBehind(heading) {
    yaw = heading;
    targetYaw = heading;
    pitch = 0.3;
    targetPitch = 0.3;
    lookIdleTimer = 0;
  }

  /**
   * Aspect compensation for the vertical FOV: a narrow screen keeps a
   * readable horizontal view by widening the vertical angle (capped, so
   * a portrait phone never gets a fisheye) instead of cropping the
   * world into a slit.
   */
  function fovFor(base) {
    const widen = clamp(1.35 / aspect, 1, 1.5);
    const vertical = 2 * Math.atan(Math.tan((base * Math.PI) / 360) * widen) * (180 / Math.PI);
    return clamp(vertical, base, 86);
  }

  /** Portrait screens also pull the camera back so the subject stays framed. */
  function distanceScale() {
    return clamp(1.15 / aspect, 1, 1.35);
  }

  function applyFov(target, dt) {
    fov = damp(fov, target, 5, dt);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function updateMenu(dt) {
    menuAngle += dt * 0.045;
    const cx = MENU_CAMERA.x + Math.cos(menuAngle) * MENU_CAMERA.radius;
    const cz = MENU_CAMERA.z + Math.sin(menuAngle) * MENU_CAMERA.radius;
    camera.position.set(cx, MENU_CAMERA.height, cz);
    camera.lookAt(MENU_CAMERA.x, 8, MENU_CAMERA.z);
    applyFov(fovFor(55), dt);
  }

  function updateFollow(dt, focus, heading, speed, inVehicle, aiming) {
    const look = game.input.takeLookDelta();
    // Look input steers a target; the camera damps toward it. Total
    // rotation is preserved exactly, but per-frame jitter from touch
    // drags is smoothed out instead of applied raw.
    if (look.dx !== 0 || look.dy !== 0) {
      targetYaw -= look.dx;
      targetPitch = clamp(targetPitch + look.dy, -0.05, 1.0);
      lookIdleTimer = 1.0;
    } else {
      lookIdleTimer = Math.max(0, lookIdleTimer - dt);
    }

    const vehicle = inVehicle ? game.player.vehicle : null;
    const topSpeed = vehicle ? vehicle.def.topSpeed : 40;
    const speedFactor = clamp(Math.abs(speed) / topSpeed, 0, 1);

    if (inVehicle && lookIdleTimer <= 0) {
      // The camera chases the car's heading: driving forward always
      // carries the car away from the lens. Reversing keeps the same
      // side. The chase quickens with speed and steering so the car
      // never drives sideways across the screen in a fast turn.
      const steerAmount = vehicle ? Math.abs(vehicle.steer) : 0;
      const rate = clamp(1.4 + speedFactor * 3.2 + steerAmount * 1.2, 1.4, 6.5);
      targetYaw = dampAngle(targetYaw, heading, rate, dt);
    }
    yaw = dampAngle(yaw, targetYaw, 22, dt);
    pitch = damp(pitch, targetPitch, 22, dt);

    const distScale = distanceScale();
    const targetDist = (inVehicle ? 9.5 + speedFactor * 5.5 : aiming ? 5.2 : 7.6) * distScale;
    distance = damp(distance, targetDist, 4, dt);
    // Speed feedback: a strong FOV kick at speed, normalized by the
    // car's own top speed so a supercar at full chat feels faster
    // than a hatchback at full chat.
    const targetFov = fovFor(aiming ? 45 : 62 + speedFactor * 18);
    applyFov(targetFov, dt);

    // Over-shoulder offset when aiming on foot: the focus shifts to
    // the character's right so the character sits left of frame and
    // the aim line runs past the shoulder, not through the head.
    const shoulderTarget = aiming && !inVehicle ? 1 : 0;
    shoulder = damp(shoulder, shoulderTarget, 8, dt);

    const fwd = forwardOf(yaw);
    const right = { x: -fwd.z, z: fwd.x };
    const lookAhead = inVehicle ? speed * 0.28 : speed * 0.12;
    tmpFocus.set(
      focus.x + fwd.x * lookAhead + right.x * 0.55 * shoulder,
      focus.y + (inVehicle ? 1.4 : 1.7),
      focus.z + fwd.z * lookAhead + right.z * 0.55 * shoulder,
    );
    const height = distance * Math.sin(pitch) + (inVehicle ? 1.6 : 1.8);
    const back = distance * Math.cos(pitch);
    tmpPos.set(
      tmpFocus.x - fwd.x * back,
      tmpFocus.y + height - (inVehicle ? 1.4 : 1.7),
      tmpFocus.z - fwd.z * back,
    );
    if (tmpPos.y < 0.7) tmpPos.y = 0.7;

    // Pull the camera in when a building stands between lens and focus.
    const pulled = game.physics.shortenCameraRay(tmpFocus, tmpPos);
    camera.position.copy(pulled);

    // Shake: trauma squared, smooth pseudo-noise from summed sines.
    trauma = Math.max(0, trauma - dt * 1.6);
    shakeTime += dt * 22;
    const shake = game.settings.reduceShake ? trauma * trauma * 0.25 : trauma * trauma * 0.9;
    if (shake > 0.001) {
      camera.position.x += Math.sin(shakeTime * 1.3) * shake * 0.4;
      camera.position.y += Math.sin(shakeTime * 1.7 + 2) * shake * 0.35;
      camera.position.z += Math.cos(shakeTime * 1.1) * shake * 0.4;
    }
    // High-speed vibration: a fine tremble that grows past 75% of top
    // speed, so velocity reads in the camera as well as the speedo.
    if (inVehicle && speedFactor > 0.75) {
      speedShakeTime += dt * 41;
      const tremble = (speedFactor - 0.75) * 0.16;
      camera.position.x += Math.sin(speedShakeTime * 1.9) * tremble * 0.4;
      camera.position.y += Math.sin(speedShakeTime * 2.3 + 1) * tremble * 0.3;
    }
    // The lens never ends up under the ground, whatever shake did.
    if (camera.position.y < 0.6) camera.position.y = 0.6;
    camera.lookAt(tmpFocus);
  }

  /** Begin the WASTED crane shot from the current camera yaw. */
  function beginWasted() {
    wastedYaw = yaw;
  }

  /**
   * The WASTED crane: a slow rise from street level to a high vista
   * while orbiting the body, the look target blending from the body to
   * the police helicopter over the second half — so the shot ends with
   * the helicopter centred in frame. Runs on game time (t01 0..1).
   */
  function updateWasted(dt, focus, heliPos, t01) {
    wastedYaw += dt * 0.14;
    const ease = easeInOutCubic(t01);
    const height = 3 + ease * 35;
    const radius = 9 + ease * 17;
    camera.position.set(
      focus.x + Math.sin(wastedYaw) * radius,
      height,
      focus.z + Math.cos(wastedYaw) * radius,
    );
    const lookT = smoothstep(0.45, 1, t01);
    const tx = heliPos ? focus.x + (heliPos.x - focus.x) * lookT : focus.x;
    const ty = heliPos ? 1.5 + (heliPos.y - 1.5) * lookT : 1.5;
    const tz = heliPos ? focus.z + (heliPos.z - focus.z) * lookT : focus.z;
    camera.lookAt(tx, ty, tz);
    applyFov(fovFor(62 + ease * 6), dt);
    if (camera.position.y < 0.6) camera.position.y = 0.6;
  }

  return {
    camera,
    get yaw() { return yaw; },
    set yaw(value) { yaw = value; targetYaw = value; },
    get pitch() { return pitch; },
    get trauma() { return trauma; },
    get shoulder() { return shoulder; },
    get aspect() { return aspect; },
    get distance() { return distance; },
    addTrauma,
    snapBehind,
    updateMenu,
    updateFollow,
    beginWasted,
    updateWasted,
    resize(width, height) {
      aspect = width / Math.max(1, height);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    /** Unit forward of the camera on the ground plane. */
    forward() {
      return forwardOf(yaw);
    },
    /** Regression probe: is the camera behind the given heading? */
    isBehind(heading, px, pz) {
      const fwd = forwardOf(heading);
      const dx = camera.position.x - px;
      const dz = camera.position.z - pz;
      const len = Math.hypot(dx, dz) || 1;
      return (dx / len) * fwd.x + (dz / len) * fwd.z;
    },
  };
}
