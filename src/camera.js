// The third-person camera: behind the player on foot, behind the car in
// a vehicle, with speed look-ahead, a field-of-view kick, and shake that
// scales with impact. The regression rule lives here and is enforced by
// construction: on entering a vehicle the camera yaw snaps to the
// vehicle's heading, so the camera sits behind the car and forward driving
// moves away from the camera. On foot, forward input moves along the
// camera's forward, so walking forward always moves away from the camera.

import * as THREE from 'three';
import { clamp, damp, dampAngle, forwardOf } from './utils.js';
import { MENU_CAMERA } from '../data/cityData.js';

export function createCameraRig(game) {
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
  let yaw = Math.PI;
  let pitch = 0.32;
  let distance = 8;
  let trauma = 0;
  let fov = 62;
  let menuAngle = 0;
  let shakeTime = 0;
  const tmpFocus = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();

  function addTrauma(amount) {
    trauma = clamp(trauma + amount, 0, 1);
  }

  /** Snap the camera behind a heading: used on vehicle entry, no lerp. */
  function snapBehind(heading) {
    yaw = heading;
    pitch = 0.3;
  }

  function updateMenu(dt) {
    menuAngle += dt * 0.045;
    const cx = MENU_CAMERA.x + Math.cos(menuAngle) * MENU_CAMERA.radius;
    const cz = MENU_CAMERA.z + Math.sin(menuAngle) * MENU_CAMERA.radius;
    camera.position.set(cx, MENU_CAMERA.height, cz);
    camera.lookAt(MENU_CAMERA.x, 8, MENU_CAMERA.z);
    if (Math.abs(camera.fov - 55) > 0.1) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
  }

  function updateFollow(dt, focus, heading, speed, inVehicle, aiming) {
    const look = game.input.takeLookDelta();
    const sens = 1;
    yaw -= look.dx * sens;
    pitch = clamp(pitch + look.dy * sens, -0.05, 1.0);

    if (inVehicle) {
      // The camera chases the car's heading: driving forward always
      // carries the car away from the lens. Reversing keeps the same side.
      const rate = speed > 1 ? 2.6 : 1.4;
      yaw = dampAngle(yaw, heading, rate, dt);
    }

    const speedFactor = clamp(Math.abs(speed) / 40, 0, 1);
    const targetDist = inVehicle ? 9.5 + speedFactor * 3.5 : aiming ? 5.2 : 7.6;
    distance = damp(distance, targetDist, 4, dt);
    const targetFov = aiming ? 45 : 62 + speedFactor * 10;
    fov = damp(fov, targetFov, 5, dt);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const fwd = forwardOf(yaw);
    const lookAhead = inVehicle ? speed * 0.28 : speed * 0.12;
    tmpFocus.set(focus.x + fwd.x * lookAhead, focus.y + (inVehicle ? 1.4 : 1.7), focus.z + fwd.z * lookAhead);
    const height = distance * Math.sin(pitch) + (inVehicle ? 1.6 : 1.8);
    const back = distance * Math.cos(pitch);
    tmpPos.set(tmpFocus.x - fwd.x * back, tmpFocus.y + height - (inVehicle ? 1.4 : 1.7), tmpFocus.z - fwd.z * back);
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
    camera.lookAt(tmpFocus);
  }

  return {
    camera,
    get yaw() { return yaw; },
    set yaw(value) { yaw = value; },
    get pitch() { return pitch; },
    get trauma() { return trauma; },
    addTrauma,
    snapBehind,
    updateMenu,
    updateFollow,
    resize(width, height) {
      camera.aspect = width / height;
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
