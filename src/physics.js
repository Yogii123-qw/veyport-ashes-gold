// physics.js — the arcade driving model (SPEC §3.3), shared.
//
// One driver for every wheeled thing: the player's car, traffic, and
// police units all run the same power curve, soft limiter, steering and
// drift. A power curve that launches hard and tapers near the top speed;
// the data's topSpeed IS the cap (no throttle force at or above it, a
// firm limiter pulls overshoot back), so cruise sits at ~100%. The
// handbrake breaks rear grip into a real drift: lateral slip grows,
// smoke and skid marks follow. Damage, smoke and fire thresholds live
// here too (SPEC §3.3): smoke under 60% integrity, fire under 30%.

export function createPhysics(deps) {
  const { city, bus } = deps;

  /** Drive one vehicle for a step. `v` is the fleet's vehicle record;
   *  `ctl` is {throttle -1..1, steer -1..1, handbrake bool}.
   *  Returns the new speed in m/s. */
  function drive(v, ctl, dt, gripFactor, others) {
    const def = v.def;
    const top = def.topSpeed;
    const fwd = ctl.throttle;
    const steerIn = ctl.steer;
    const handbrake = ctl.handbrake ? 1 : 0;

    if (fwd > 0) {
      if (v.speed < top) {
        const taper = Math.max(0.18, 1 - 0.72 * (v.speed / top));
        v.speed += def.accel * taper * fwd * dt;
      }
      if (v.speed > top) v.speed += (top - v.speed) * Math.min(1, 6.0 * dt);
    } else if (fwd < 0) {
      if (v.speed > 0.5) {
        v.speed -= def.brake * dt;
      } else {
        v.speed += def.accel * 0.45 * fwd * dt;
        if (v.speed < -12) v.speed = -12;
      }
    } else {
      v.speed -= v.speed * Math.min(1, 0.9 * dt);
      if (Math.abs(v.speed) < 0.05) v.speed = 0;
    }

    const speedFactor = Math.min(1, Math.abs(v.speed) / 7);
    const highSpeedCut = 1 - 0.45 * Math.min(1, Math.abs(v.speed) / top);
    const turn = steerIn * def.steer * speedFactor * highSpeedCut * (v.speed < 0 ? -1 : 1);
    v.heading += turn * dt;
    v.steerVis += (steerIn * 0.5 - v.steerVis) * Math.min(1, 8 * dt);

    const grip = def.grip * gripFactor * (handbrake ? 0.35 : 1);
    if (handbrake && Math.abs(v.speed) > 6) {
      v.slip += steerIn * 1.4 * dt;
      v.slip = Math.max(-0.6, Math.min(0.6, v.slip));
      v.speed -= v.speed * Math.min(1, 0.35 * dt);
      if (Math.abs(v.slip) > 0.22) bus.emit('drift-smoke', { x: v.x, z: v.z, heading: v.heading });
    } else {
      v.slip -= v.slip * Math.min(1, grip * dt);
    }

    const travel = v.heading + v.slip;
    const nx = v.x + Math.sin(travel) * v.speed * dt;
    const nz = v.z + Math.cos(travel) * v.speed * dt;
    const res = city.resolveCircle(nx, nz, def.length * 0.42);
    if (res.hit) {
      const impact = Math.abs(v.speed);
      if (impact > 4) bus.emit('wall-hit', { vehicle: v, speed: impact });
      v.speed *= -0.25;
      v.x = res.x;
      v.z = res.z;
      bus.emit('crash', { vehicle: v, speed: impact, x: v.x, z: v.z });
    } else {
      v.x = nx;
      v.z = nz;
    }

    // Car-to-car bumps against the fleet passed in.
    if (others) {
      for (const o of others) {
        if (o === v || o.wrecked) continue;
        const dx = o.x - v.x;
        const dz = o.z - v.z;
        const d2 = dx * dx + dz * dz;
        const minD = (def.length + o.def.length) * 0.42;
        if (d2 < minD * minD && d2 > 0.001) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / 2;
          const ux = dx / d;
          const uz = dz / d;
          v.x -= ux * push;
          v.z -= uz * push;
          o.x += ux * push;
          o.z += uz * push;
          const rel = Math.abs(v.speed - o.speed);
          if (rel > 3) bus.emit('car-hit', { a: v, b: o, speed: rel });
          const tmp = v.speed;
          v.speed = o.speed * 0.4;
          o.speed = tmp * 0.4;
        }
      }
    }

    // Smoke / fire thresholds.
    const frac = v.integrity / v.maxIntegrity;
    v.smoke = frac < 0.6 ? (frac < 0.3 ? 2 : 1) : 0;

    // Visuals: body lean + wheel spin.
    v.wheelSpin += (v.speed / 0.36) * dt;
    if (v.wheels) v.wheels.rotation.x = v.wheelSpin;
    if (v.root) {
      v.root.position.set(v.x, 0, v.z);
      v.root.rotation.y = v.heading;
      v.root.rotation.z = -turn * 0.05;
      v.root.rotation.x = fwd > 0 ? -0.02 : 0;
    }
    return v.speed;
  }

  /** Pure-model 0-to-top measurement (no collisions, no city). Used by
   *  the F7 test: t90 = seconds to 90% of top speed, cruise = fraction
   *  of top speed held after settling. */
  function measureAccel(def) {
    const v = {
      def, speed: 0, heading: 0, x: 0, z: 0, slip: 0, steerVis: 0,
      integrity: def.durability, maxIntegrity: def.durability,
      root: null, wheels: null, wrecked: false, smoke: 0, wheelSpin: 0,
    };
    const fakeCity = { resolveCircle: (x, z) => ({ x, z, hit: null }) };
    const fakeBus = { emit() {} };
    const solo = createPhysics({ city: fakeCity, bus: fakeBus });
    let t = 0;
    let t90 = -1;
    const dt = 1 / 60;
    while (t < 30) {
      solo.drive(v, { throttle: 1, steer: 0, handbrake: false }, dt, 1, null);
      t += dt;
      if (t90 < 0 && v.speed >= def.topSpeed * 0.9) t90 = t;
      if (t > 12 && Math.abs(v.speed - def.topSpeed) < def.topSpeed * 0.03) break;
    }
    return { t90, cruise: v.speed / def.topSpeed, topKmh: Math.round(def.topSpeed * 3.6) };
  }

  return { drive, measureAccel };
}
