// traffic.js — the city's traffic: cars that go somewhere.
//
// Traffic cars pick a far destination, follow the road graph, slow for
// the car ahead, and re-route when stuck. They never teleport into the
// player's view: a car that finishes its route far away gets a new one,
// and one that ends up too close to the player is respawned far away.
// Supercars stay rare: a separate 4% roll, never part of the everyday
// mix. Parked cars (including the early supercar by the safehouse, F4)
// live in the fleet module, not here.

import { CIVILIAN_TYPES, SUPERCAR_TYPES, TRAFFIC_WEIGHTS, SUPERCAR_TRAFFIC_CHANCE } from './vehiclesData.js';

const TRAFFIC_COUNT = 18;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, weights) {
  let total = 0;
  for (const k of Object.keys(weights)) total += weights[k];
  let r = rng() * total;
  for (const k of Object.keys(weights)) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

export function createTraffic(deps) {
  const { city, vehicles, physics } = deps;
  const rng = mulberry32(20261119);

  function assignRoute(v) {
    const dest = city.randomRoadPoint(rng);
    v.route = city.route(v.x, v.z, dest.x, dest.z);
    v.routeIdx = 0;
    v.cruise = v.def.topSpeed * (0.5 + rng() * 0.15);
  }

  function spawnAll() {
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const p = city.randomRoadPoint(rng);
      let type = pickWeighted(rng, TRAFFIC_WEIGHTS);
      if (rng() < SUPERCAR_TRAFFIC_CHANCE) type = SUPERCAR_TYPES[Math.floor(rng() * SUPERCAR_TYPES.length)];
      const v = vehicles.makeVehicle(type, p.x, p.z, rng() * Math.PI * 2, { traffic: true });
      assignRoute(v);
    }
  }

  /** One traffic car for one step: follow its route, yield ahead. */
  function driveOne(v, dt, playerPos) {
    if (!v.route || v.routeIdx >= v.route.length) {
      const dx = v.x - playerPos.x;
      const dz = v.z - playerPos.z;
      if (dx * dx + dz * dz < 120 * 120) {
        const p = city.randomRoadPoint(rng);
        v.x = p.x; v.z = p.z; v.speed = 0;
      }
      assignRoute(v);
      return;
    }
    const target = v.route[v.routeIdx];
    const dx = target.x - v.x;
    const dz = target.z - v.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 6) { v.routeIdx += 1; return; }
    const wantHeading = Math.atan2(dx, dz);
    let dh = wantHeading - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, dh * 1.6));
    // Slow down if a car is close ahead.
    let blocked = false;
    for (const o of vehicles.vehicles) {
      if (o === v || o.wrecked) continue;
      const ox = o.x - v.x;
      const oz = o.z - v.z;
      const od = Math.hypot(ox, oz);
      if (od < 12) {
        const ahead = (ox * Math.sin(v.heading) + oz * Math.cos(v.heading)) / Math.max(od, 0.001);
        if (ahead > 0.7) { blocked = true; break; }
      }
    }
    const before = { x: v.x, z: v.z };
    physics.drive(v, { throttle: blocked ? 0 : 1, steer, handbrake: false }, dt, 1, vehicles.vehicles);
    v.slip = 0; // traffic never drifts
    // A car wedged against a wall never recovers on its own: the wall
    // bounce pins its speed near 0 (so the old `speed > 1` test never
    // fired) and it has no turn authority standing still. Measure
    // progress, not speed: if full throttle moves it ~nowhere for 4 s,
    // re-route from here — to its mission destination when it has one —
    // and point it down the new route so it drives away from the wall
    // instead of back into it.
    const moved = Math.hypot(v.x - before.x, v.z - before.z);
    if (!blocked && moved < 0.005) {
      v.stuck += dt;
      if (v.stuck > 4) {
        if (v.missionDest) {
          const reroute = city.route(v.x, v.z, v.missionDest.x, v.missionDest.z);
          if (reroute && reroute.length > 0) { v.route = reroute; v.routeIdx = 0; }
        } else {
          assignRoute(v);
        }
        if (v.route && v.route.length > 0) {
          v.heading = Math.atan2(v.route[0].x - v.x, v.route[0].z - v.z);
        }
        v.stuck = 0;
      }
    } else {
      v.stuck = 0;
    }
  }

  function update(dt, playerPos) {
    for (const v of vehicles.vehicles) {
      if (v.traffic && !v.wrecked) driveOne(v, dt, playerPos);
    }
  }

  return {
    spawnAll,
    assignRoute,
    driveOne,
    update,
    get count() { return TRAFFIC_COUNT; },
  };
}
