// camera.js - Veyport chase camera, P7 architecture (Monch's 5 rules).
// (1) Updated LAST in the frame, once per rendered frame, after physics.
// (2) dt clamped to 0.05; every interpolation is exponential 1-exp(-rate*dt).
// (3) A separate CameraTarget proxy (XZ, Y and yaw smoothed apart) - the
//     camera NEVER reads raw physics state or a vehicle mesh.
// (4) The renderer draws interpolated state (prev/curr snapshots, alpha),
//     and the camera reads that interpolated focus.
// (5) Collision is a 5-ray spherecast with damped distance, hysteresis and
//     a 2.0 m minimum - no hard snaps. Trauma comes ONLY from the player's
//     own car (AI traffic scraping walls must never shake the player's view).

const THREE = window.THREE;

const DT_CLAMP = 0.05;
const MIN_DIST = 2.0;
const GROUND_MIN = 1.25;

function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

function shortArc(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Ray vs AABB (slab test). Returns the hit distance or Infinity.
function rayAabb(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity;
  const axes = [[ox, dx, b.x0, b.x1], [oy, dy, 0, b.h ?? 40], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

class ProxyTarget {
  constructor() {
    this.x = 0; this.y = 1.4; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0;
  }

  snap(f) {
    this.x = f.x; this.y = f.y; this.z = f.z;
    this.yaw = f.heading; this.pitch = f.pitch || 0;
    this.vx = 0; this.vz = 0;
  }

  // Chase an interpolated focus. XZ fast, Y slow, yaw shortest-arc.
  // Feed-forward: aim slightly ahead of the velocity so the proxy does
  // not lag behind a fast car.
  // Yaw: on foot the proxy chases the player's heading SLOWLY
  // (rate 2.5, hard cap 1.75 rad/s, gated on a firm stick deflection
  // above 0.5), so the camera swings gently behind the walking
  // direction and settles there (R4-E). The target is player.heading,
  // never rig.yaw: feeding rig.yaw back as the chase target would
  // amplify each look-drag several times over (R4-D). Aiming holds
  // its yaw (no chase): the aim camera must not swing while the
  // player turns to aim. Drive chases the car's heading slowly
  // (rate 6, was 20) so a turn never snaps the view; menu keeps 20.
  chase(f, dt, speed) {
    const kxz = damp(25, dt);
    const ky = damp(6, dt);
    const lead = Math.min(0.12, speed * 0.004);
    const lx = f.x + Math.sin(f.heading) * lead * speed * 0.1;
    const lz = f.z + Math.cos(f.heading) * lead * speed * 0.1;
    this.x += (lx - this.x) * kxz;
    this.z += (lz - this.z) * kxz;
    this.y += (f.y - this.y) * ky;
    const isFoot = f.mode === 'foot';
    // No yaw chase while aiming, and no foot chase for a small thumb
    // wobble: a 20% nudge must not swing the camera (R4-E d).
    if (!f.aiming && (!isFoot || (f.stickMag || 0) > 0.5)) {
      const kyaw = damp(f.mode === 'drive' ? 6 : isFoot ? 2.5 : 20, dt);
      let step = shortArc(this.yaw, f.heading) * kyaw;
      if (f.mode === 'drive' || isFoot) {
        // Hard cap on the chase rate: a sudden yaw of the car (a spin,
        // an impact) or of the player (a sharp turn) must never whip
        // the view. 1.75 rad/s is ~100 deg/s; an ordinary turn needs
        // far less, so the cap only binds on a spike (R4-D: uncapped,
        // full-lock steer from standstill peaked at 137 deg/s while
        // the car itself peaked at 121 deg/s; a 1.9 rad/s cap still
        // measured 111 deg/s, so the margin is set here, under the
        // ~120 deg/s bar with room for sample jitter).
        const cap = 1.75 * dt;
        step = Math.max(-cap, Math.min(cap, step));
      }
      this.yaw += step;
    }
    this.pitch += ((f.pitch || 0) - this.pitch) * damp(12, dt);
    this.vx = f.vx || 0;
    this.vz = f.vz || 0;
  }
}

export class CameraRig {
  constructor(camera, colliders) {
    this.cam = camera;
    this.colliders = colliders;
    this.proxy = new ProxyTarget();
    this.mode = 'foot';
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.smoothDist = 7;
    this.distFrames = 0;
    this.lastShort = Infinity;
    this.trauma = 0;
    this.crane = null; // { t, dur, from, heli }
    this.fovBase = 62;
    this.yaw = 0;
    this.pitch = 0;
    this.time = 0;
  }

  setMode(mode) {
    if (this.mode !== mode) {
      this.mode = mode;
      if (mode === 'drive') this.dragYaw = 0;
    }
  }

  snapTo(focus) {
    this.proxy.snap(focus);
    this.smoothDist = this.wantDist(focus);
    this.dragYaw = 0;
    this.dragPitch = 0;
  }

  wantDist(focus) {
    if (this.mode === 'drive') return 10.5;
    if (this.mode === 'aim') return 4.2;
    if (this.mode === 'menu') return 26;
    return 6.4;
  }

  wantHeight(focus) {
    if (this.mode === 'drive') return 3.4;
    if (this.mode === 'aim') return 2.0;
    if (this.mode === 'menu') return 12;
    return 2.3;
  }

  // Trauma: own car takes the full hit; other cars only when the impact
  // is hard AND close. Everything else is silent (P7 root cause: AI
  // traffic scraping walls pinned the player's trauma at ~0.98).
  addTrauma(amount, dist, impact, isOwn) {
    if (isOwn) {
      this.trauma = Math.min(1, this.trauma + amount);
      return;
    }
    if (impact > 4 && dist < 45) {
      const scaled = amount * (1 - dist / 45) * Math.min(1, impact / 12);
      this.trauma = Math.min(1, this.trauma + scaled);
    }
  }

  startCrane(heliPos) {
    this.crane = {
      t: 0, dur: 4.5,
      fromX: this.cam.position.x, fromY: this.cam.position.y, fromZ: this.cam.position.z,
      heli: heliPos,
    };
    this.mode = 'crane';
  }

  // 5-ray spherecast: center ray + 4 offset rays (r = 0.6). Returns the
  // nearest clear distance along the view direction.
  spherecast(fx, fy, fz, dx, dy, dz, maxDist) {
    let best = maxDist;
    const offsets = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]];
    for (const [ox, oy] of offsets) {
      // Offset perpendicular to the view dir (approx: right/up in world).
      const rx = -dz, rz = dx;
      const ox2 = fx + rx * ox, oy2 = fy + oy, oz2 = fz + rz * ox;
      for (const b of this.colliders) {
        const t = rayAabb(ox2, oy2, oz2, dx, dy, dz, b);
        if (t < best) best = t;
      }
    }
    return Math.max(MIN_DIST, best - 0.6);
  }

  update(dtRaw, focus, opts = {}) {
    const dt = Math.min(dtRaw, DT_CLAMP);
    this.time += dt;
    this.trauma *= Math.exp(-1.4 * dt);

    // Crane mode (F5): rise, orbit slowly, end looking at the helicopter.
    if (this.mode === 'crane' && this.crane) {
      const c = this.crane;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const ease = 1 - Math.pow(1 - k, 3);
      const ang = this.proxy.yaw + ease * 0.9;
      const cx = focus.x + Math.sin(ang) * 16;
      const cz = focus.z + Math.cos(ang) * 16;
      const cy = 4 + ease * 22;
      this.cam.position.set(
        c.fromX + (cx - c.fromX) * ease,
        c.fromY + (cy - c.fromY) * ease,
        c.fromZ + (cz - c.fromZ) * ease,
      );
      const look = c.heli || { x: focus.x, y: 30, z: focus.z };
      this.cam.lookAt(look.x, look.y, look.z);
      if (k >= 1) this.crane.done = true;
      return;
    }

    // Apply look deltas from input to the drag offsets (decay back to 0).
    const look = opts.look || { dx: 0, dy: 0 };
    this.dragYaw -= look.dx;
    this.dragPitch = Math.max(-0.55, Math.min(0.55, this.dragPitch - look.dy * 0.6));
    this.dragYaw *= Math.exp(-2.0 * dt);
    this.dragPitch *= Math.exp(-2.0 * dt);

    // Proxy chases the interpolated focus.
    this.proxy.chase(focus, dt, focus.speed || 0);
    this.yaw = this.proxy.yaw + this.dragYaw;
    this.pitch = this.proxy.pitch + this.dragPitch;

    // Desired eye: behind the proxy yaw, above the proxy, at mode distance.
    const dist = this.wantDist(focus);
    const height = this.wantHeight(focus);
    const backX = -Math.sin(this.yaw);
    const backZ = -Math.cos(this.yaw);
    const eyeX = this.proxy.x + backX * dist;
    const eyeZ = this.proxy.z + backZ * dist;
    const eyeY = this.proxy.y + height;
    const dirX = this.proxy.x - eyeX;
    const dirZ = this.proxy.z - eyeZ;
    const dirY = (this.proxy.y + 0.4) - eyeY;
    const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
    const ndx = dirX / dirLen, ndy = dirY / dirLen, ndz = dirZ / dirLen;

    // Collision: spherecast shortens the distance, damped (never a snap).
    const clear = this.spherecast(this.proxy.x, this.proxy.y + 0.4, this.proxy.z, ndx, ndy, ndz, dist);
    let target = Math.min(dist, clear);
    // Hysteresis: only react to a shortening after 3 consistent frames.
    if (target < this.smoothDist - 0.15) {
      this.distFrames += 1;
      if (this.distFrames < 3) target = this.smoothDist;
    } else {
      this.distFrames = 0;
    }
    const rate = target < this.smoothDist ? 12 : 5;
    this.smoothDist += (target - this.smoothDist) * damp(rate, dt);
    // Never closer than the minimum, and never inside a building: if the
    // eye itself sits inside a collider, hold the distance instead of
    // collapsing it (P7 wall regression).
    const eyeInside = this.colliders.some((b) => (
      eyeX > b.x0 && eyeX < b.x1 && eyeZ > b.z0 && eyeZ < b.z1 && eyeY < (b.h ?? 40)
    ));
    if (!eyeInside) this.smoothDist = Math.max(MIN_DIST, this.smoothDist);
    const finalDist = this.smoothDist;
    let px = this.proxy.x + backX * finalDist;
    let py = this.proxy.y + height * (finalDist / dist);
    let pz = this.proxy.z + backZ * finalDist;
    // Ground clamp, damped: keep the eye above the street.
    if (py < GROUND_MIN) py = GROUND_MIN + (py - GROUND_MIN) * 0.2;

    // Aim mode: shift the eye to the right shoulder.
    if (this.mode === 'aim') {
      px += Math.cos(this.yaw) * 0.9;
      pz += -Math.sin(this.yaw) * 0.9;
    }

    this.cam.position.set(px, py, pz);
    const lookX = this.proxy.x + Math.sin(this.yaw) * 4;
    const lookZ = this.proxy.z + Math.cos(this.yaw) * 4;
    const lookY = this.proxy.y + 0.6 + this.pitch * 6;
    this.cam.lookAt(lookX, lookY, lookZ);

    // Trauma shake: small rotational noise, scaled by trauma.
    if (this.trauma > 0.001) {
      const s = this.trauma * this.trauma * 0.05;
      this.cam.rotation.x += (Math.random() - 0.5) * s;
      this.cam.rotation.y += (Math.random() - 0.5) * s;
      this.cam.rotation.z += (Math.random() - 0.5) * s * 0.6;
    }

    // FOV: base + speed kick (drive only) + portrait compensation (F8).
    const aspect = this.cam.aspect || 1.6;
    let fov = this.fovBase;
    if (this.mode === 'drive') fov += Math.min(14, (focus.speed || 0) * 0.22);
    if (aspect < 1) fov += Math.min(18, (1 - aspect) * 22);
    if (Math.abs(this.cam.fov - fov) > 0.05) {
      this.cam.fov += (fov - this.cam.fov) * damp(4, dt);
      this.cam.updateProjectionMatrix();
    }
  }
}
