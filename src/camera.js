// camera.js — the third-person camera (F8 + P7 architecture).
//
// P7 architecture (Monch 16:25 WIB — jitter is architectural, not lerp
// values). The five rules, as built:
//  1. Update order: the camera updates ONCE per render frame, LAST in the
//     rAF loop (main.js frame()), after the physics accumulator and
//     before renderer.render — never inside step(), never once per
//     physics step.
//  2. Delta time: the camera's dt is the render frame dt clamped to
//     0.05 s; every camera interpolation is exponential
//     1 - Math.exp(-rate * dt). No static lerp factor anywhere on the
//     camera path (FOV and trauma decay included).
//  3. Decoupling: the camera reads ONLY a CameraTarget proxy, never raw
//     physics state and never a vehicle/character mesh. The proxy
//     smooths XZ (25/s), Y (6/s, separately) and yaw (shortest arc,
//     20/s); a velocity feed-forward cancels its steady-state trail at
//     speed, so framing does not drift with velocity.
//  4. Physics vs render: main.js interpolates the focus between the
//     previous and current physics states (alpha = accumulator / STEP,
//     shortest-arc heading) and hands the interpolated focus to the
//     proxy — the camera never sees a raw stepped state, so 90/120 Hz
//     renders no longer stair-step. STEP and the physics are untouched.
//  5. Collision: a 5-ray spherecast (centre + 4 offsets, r = 0.6 m)
//     replaces the single ray; the camera distance eases toward the hit
//     (fast in at 12/s so it never clips, slow out at 5/s with a
//     3-frame clearance hysteresis so it never pops against a grazing
//     edge), with a 2.0 m minimum distance. The ground clamp stays a
//     hard floor at 1.25 — it is a rarely-engaged safety net whose value
//     is continuous, so it cannot pop.
// Shake (trauma) is gated by main.js: only crashes involving the focus
// (or near it) shake the camera — distant traffic scraping walls used
// to shake the player's camera (measured: trauma 0.16-0.25 spikes while
// just walking).
//
// Modes: 'menu' (slow cinematic sweep over the city), 'foot', 'aim',
// 'drive', 'wasted' (F5 crane shot — wanted.js drives it, the camera
// move itself lives here). The regression rule from SPEC §2.4 is kept
// as law: on vehicle entry the camera is BEHIND the car, and walking
// forward always moves the player AWAY from the camera.

import * as THREE from '../vendor/three.min.js';

const BASE_FOV = 62;
const MAX_FOV_KICK = 14;
const CAM_DT_MAX = 0.05; // rule 2: camera dt clamp (exported for main.js)
const PROXY_RATE_XZ = 25; // proxy position follow rate (/s)
const PROXY_RATE_Y = 6; // proxy height follow rate (/s, separate)
const PROXY_RATE_YAW = 20; // proxy yaw follow rate (/s, shortest arc)
const PROXY_RATE_VEL = 6; // feed-forward velocity smoothing (/s)
const COLLIDE_IN_RATE = 12; // distance shorten rate (/s)
const COLLIDE_OUT_RATE = 5; // distance lengthen rate (/s)
const COLLIDE_CLEAR_FRAMES = 3; // hysteresis: clear frames before lengthening
const COLLIDE_RADIUS = 0.6; // spherecast radius (m)
const MIN_CAM_DIST = 2.0; // minimum camera distance (m)

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
    // P7 rule 3: the CameraTarget proxy. The camera reads ONLY this.
    proxy: { x: 0, z: 0, y: 0, yaw: 0.6, velX: 0, velZ: 0 },
    // P7 rule 5: damped collision distance (along the eye->camera ray).
    smoothDist: 6.6,
    clearFrames: 0,
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
      // The proxy must snap with the camera, or its damped yaw would
      // drag the camera back off the car's heading on the next frame.
      rig.proxy.yaw = rig.targetYaw;
      if (Number.isFinite(data.x) && Number.isFinite(data.z)) {
        rig.proxy.x = data.x;
        rig.proxy.z = data.z;
        rig.proxy.y = data.y ?? 0;
        rig.proxy.velX = 0;
        rig.proxy.velZ = 0;
      }
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

  /**
   * P7 rule 3 — move the CameraTarget proxy toward the (render-
   * interpolated) focus. Called once per render frame, before update().
   * The focus is already smooth (interpolated); the proxy adds a second
   * pole that absorbs physics snaps (collision pushes, car-car bumps)
   * without ever trailing the focus at speed, thanks to the velocity
   * feed-forward read back in update().
   */
  function updateTarget(focus, dt) {
    const p = rig.proxy;
    const dx = focus.x - p.x;
    const dz = focus.z - p.z;
    if (dx * dx + dz * dz > 25) {
      // > 5 m gap: a teleport / first frame / respawn, not motion.
      // Snap the proxy; a glide across the map would be worse.
      p.x = focus.x;
      p.z = focus.z;
      p.y = focus.y ?? 0;
      p.yaw = focus.heading;
      p.velX = 0;
      p.velZ = 0;
      return;
    }
    const kx = 1 - Math.exp(-PROXY_RATE_XZ * dt);
    p.x += dx * kx;
    p.z += dz * kx;
    const ky = 1 - Math.exp(-PROXY_RATE_Y * dt);
    p.y += ((focus.y ?? 0) - p.y) * ky;
    let dy = focus.heading - p.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    p.yaw += dy * (1 - Math.exp(-PROXY_RATE_YAW * dt));
    // Smoothed travel velocity, built from the focus speed + heading
    // (never from raw position deltas, so a collision snap cannot
    // spike it). The feed-forward term in update() is vel / 25.
    const sp = focus.speed || 0;
    const tvx = Math.sin(focus.heading) * sp;
    const tvz = Math.cos(focus.heading) * sp;
    const kv = 1 - Math.exp(-PROXY_RATE_VEL * dt);
    p.velX += (tvx - p.velX) * kv;
    p.velZ += (tvz - p.velZ) * kv;
  }

  /**
   * Point-in-building test, same filter as city.raycastBuildings (only
   * colliders with height >= 3 occlude). Used by the collision guard:
   * a ray whose origin sits inside an AABB returns 0, which is an
   * artifact of the origin being inside, not a hit on a wall.
   */
  function isInsideBuilding(x, y, z) {
    for (const b of city.colliders) {
      if (b.height < 3) continue;
      if (y >= b.height) continue;
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
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
    // dt here is SIM time (main.js passes steps * STEP), so the rise
    // follows the game clock, not the render clock.
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

    // --- the camera reads ONLY the proxy (P7 rule 3) ---
    // The feed-forward term cancels the proxy's steady-state trail:
    // at constant speed the camera sits the same distance behind the
    // focus as it does at rest (lag would otherwise be speed / 25).
    const px = rig.proxy.x + rig.proxy.velX / PROXY_RATE_XZ;
    const pz = rig.proxy.z + rig.proxy.velZ / PROXY_RATE_XZ;
    const py = rig.proxy.y;

    // --- yaw / pitch targets per mode ---
    const sens = 0.0032 * (ctx.sensitivity || 1);
    if (rig.mode === 'drive') {
      // In the car the drag is a temporary offset that yields back.
      // The heading comes from the proxy (already yaw-smoothed), so a
      // physics snap in the car's heading never reaches the camera raw.
      rig.dragYaw -= look.dx * sens;
      rig.dragYaw = Math.max(-1.1, Math.min(1.1, rig.dragYaw));
      rig.targetYaw = rig.proxy.yaw + rig.dragYaw;
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
    // P7: the rates are unchanged — the proxy in front adds the second
    // pole; the total response stays P6's.
    const yawRate = rig.mode === 'drive' ? 8 : 11;
    const damp = 1 - Math.exp(-yawRate * dt);
    rig.yaw += (rig.targetYaw - rig.yaw) * damp;
    rig.pitch += (rig.targetPitch - rig.pitch) * (1 - Math.exp(-9 * dt));
    rig.dragYaw *= Math.exp(-2.0 * dt); // look-drag yield
    rig.recoil *= Math.exp(-7 * dt); // recoil decays fast

    // --- desired camera position ---
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

    // --- collision: 5-ray spherecast + damped distance (P7 rule 5) ---
    // The ray runs from the focus eye to the ideal spot. Five rays
    // (centre + 4 offsets, r = 0.6 m) approximate a swept sphere; the
    // nearest hit wins, so a thin wall cannot be missed for one frame
    // and let the camera through. The distance then eases toward the
    // hit: fast in (12/s) so the camera never clips, slow out (5/s)
    // with a 3-frame clearance hysteresis so it never pops back and
    // forth against a grazing edge. Minimum 2.0 m from the focus.
    const eyeX = px;
    const eyeY = py + 1.7;
    const eyeZ = pz;
    const dirX = camX - eyeX;
    const dirY = camY - eyeY;
    const dirZ = camZ - eyeZ;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    const ux = dirX / len;
    const uy = dirY / len;
    const uz = dirZ / len;
    // Perpendicular basis for the sphere offsets.
    let ax = -uz;
    let ay = 0;
    let az = ux;
    const aLen = Math.hypot(ax, ay, az) || 1;
    ax /= aLen; ay /= aLen; az /= aLen;
    const bx = uy * az - uz * ay;
    const by = uz * ax - ux * az;
    const bz = ux * ay - uy * ax;
    // P10: the eye can end up INSIDE a building when the car wedges into
    // a wall on impact (measured: eye 1.03 m past the face). A ray cast
    // from inside an AABB returns 0, so the spherecast would collapse
    // the desired distance to MIN_CAM_DIST and yank the camera to the
    // bumper in one frame (measured 4.3-5.4 m/frame). That is an artifact,
    // not an occlusion: the ideal spot is in open air. Skip the
    // shortening when the eye is inside a collider and the ideal spot is
    // not; fall back to the spherecast when the ideal spot is itself
    // inside a building (genuine occlusion).
    const eyeInside = isInsideBuilding(eyeX, eyeY, eyeZ);
    const spotInside = eyeInside && isInsideBuilding(camX, camY, camZ);
    let desired = len;
    if (!eyeInside || spotInside) {
      let nearest = Infinity;
      const offsets = [[0, 0], [COLLIDE_RADIUS, 0], [-COLLIDE_RADIUS, 0], [0, COLLIDE_RADIUS], [0, -COLLIDE_RADIUS]];
      for (const [oa, ob] of offsets) {
        const ox = eyeX + ax * oa + bx * ob;
        const oy = eyeY + ay * oa + by * ob;
        const oz = eyeZ + az * oa + bz * ob;
        const hit = city.raycastBuildings(ox, oy, oz, ux, uy, uz, len);
        if (hit < nearest) nearest = hit;
      }
      if (nearest < Infinity) desired = Math.max(MIN_CAM_DIST, Math.min(len, nearest - 0.45));
    }
    if (desired < rig.smoothDist) {
      rig.smoothDist += (desired - rig.smoothDist) * (1 - Math.exp(-COLLIDE_IN_RATE * dt));
      rig.clearFrames = 0;
    } else if (desired > rig.smoothDist + 0.01) {
      rig.clearFrames += 1;
      if (rig.clearFrames >= COLLIDE_CLEAR_FRAMES) {
        rig.smoothDist += (desired - rig.smoothDist) * (1 - Math.exp(-COLLIDE_OUT_RATE * dt));
      }
    } else {
      rig.clearFrames = 0;
    }
    // P10: NO hard clamp of smoothDist to len. The old clamp snapped the
    // camera 4.3 m in one frame when the car was destroyed on impact:
    // the mode flips drive -> foot, the ideal distance drops 10.8 -> 6.6
    // m, and the clamp set smoothDist = len instantly (measured: 10.981
    // -> 6.67 in a single frame). The easing above already owns the
    // motion (12/s in, 5/s out with hysteresis); a mode/speed change is
    // just a new desired distance, and it eases there like any other.
    // smoothDist may sit slightly beyond len for a fraction of a second
    // after a mode change — a slightly wider shot, not a clip.
    if (rig.smoothDist < MIN_CAM_DIST) rig.smoothDist = MIN_CAM_DIST;
    const s = rig.smoothDist / len;
    camX = eyeX + dirX * s;
    camY = eyeY + dirY * s;
    camZ = eyeZ + dirZ * s;

    // --- ground clamp: the camera never goes under the street ---
    if (camY < 1.25) camY = 1.25;

    // --- trauma shake (crashes / explosions), decays fast ---
    // P7 rule 2: exponential decay, not a linear ramp.
    rig.trauma *= Math.exp(-1.4 * dt);
    if (rig.trauma < 0.01) rig.trauma = 0;
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
    // P7 rule 2: exponential, not a static 6*dt factor.
    const wantFov = aspectFov(aspect, rig.mode === 'drive' ? speedFrac : 0);
    camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-6 * dt));
    camera.updateProjectionMatrix();
  }

  return {
    rig,
    setMode,
    update,
    updateTarget,
    addTrauma,
    addRecoil,
    get yaw() { return rig.yaw; },
    get mode() { return rig.mode; },
    get wastedT() { return rig.wastedT; },
    /** Read-only proxy snapshot for the automated playtest. */
    get proxy() {
      return {
        x: +rig.proxy.x.toFixed(3), z: +rig.proxy.z.toFixed(3),
        y: +rig.proxy.y.toFixed(3), yaw: +rig.proxy.yaw.toFixed(4),
        smoothDist: +rig.smoothDist.toFixed(3),
      };
    },
  };
}

export { CAM_DT_MAX };
