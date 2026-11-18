// Collision and vehicle dynamics. A spatial hash (16 m cells) holds the
// static colliders so every query only tests its neighbours. Vehicles run
// an arcade bicycle model: forward speed, steering that bites with speed,
// lateral grip that the handbrake breaks for drifts, and damage that
// bends the steering and caps the top speed. On-foot movement slides
// along walls instead of sticking to them.

import * as THREE from 'three';
import { BRIDGES, TUNNEL, WATER_RECTS, WORLD } from '../data/cityData.js';
import { clamp, dist2, forwardOf } from './utils.js';

const CELL = 16;

export function createSpatialHash() {
  const cells = new Map();
  function key(cx, cz) {
    return `${cx},${cz}`;
  }
  return {
    clear() {
      cells.clear();
    },
    insert(aabb, value) {
      const x0 = Math.floor(aabb.x0 / CELL);
      const x1 = Math.floor(aabb.x1 / CELL);
      const z0 = Math.floor(aabb.z0 / CELL);
      const z1 = Math.floor(aabb.z1 / CELL);
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cz = z0; cz <= z1; cz += 1) {
          const k = key(cx, cz);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push({ aabb, value });
        }
      }
    },
    query(x0, z0, x1, z1, out) {
      const seen = new Set();
      const cx0 = Math.floor(x0 / CELL);
      const cx1 = Math.floor(x1 / CELL);
      const cz0 = Math.floor(z0 / CELL);
      const cz1 = Math.floor(z1 / CELL);
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cz = cz0; cz <= cz1; cz += 1) {
          const list = cells.get(key(cx, cz));
          if (!list) continue;
          for (const entry of list) {
            if (seen.has(entry)) continue;
            seen.add(entry);
            out.push(entry);
          }
        }
      }
      return out;
    },
  };
}

export function createPhysics(game) {
  const statics = createSpatialHash();
  const colliderList = [];
  const scratch = [];

  function addCollider(x0, z0, x1, z1, kind, height) {
    const aabb = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), kind: kind || 'building', height: height ?? Infinity };
    colliderList.push(aabb);
    statics.insert(aabb, aabb);
    return aabb;
  }

  function inWater(x, z) {
    for (const w of WATER_RECTS) {
      const [x0, z0, x1, z1] = w.rect;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) {
        // Bridge decks are dry road over the channel.
        for (const b of BRIDGES) {
          if (x >= b.x - 8 && x <= b.x + 8 && z >= b.z0 - 4 && z <= b.z1 + 4) return false;
        }
        return true;
      }
    }
    return false;
  }

  function inTunnel(x, z) {
    const [x0, z0, x1, z1] = TUNNEL.rect;
    return x >= x0 && x <= x1 && z >= z0 && z <= z1;
  }

  /** Resolve a circle against static colliders. Returns push-out + hit info. */
  function resolveCircle(x, z, radius, out) {
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    out.pen = 0;
    scratch.length = 0;
    statics.query(x - radius, z - radius, x + radius, z + radius, scratch);
    for (const entry of scratch) {
      const a = entry.aabb;
      const cx = clamp(x, a.x0, a.x1);
      const cz = clamp(z, a.z0, a.z1);
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      let d = Math.sqrt(d2);
      let nx;
      let nz;
      let pen;
      if (d > 0.0001) {
        nx = dx / d;
        nz = dz / d;
        pen = radius - d;
      } else {
        // Centre inside the box: push out along the smallest overlap.
        const left = x - a.x0;
        const right = a.x1 - x;
        const top = z - a.z0;
        const bottom = a.z1 - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) { nx = -1; nz = 0; pen = left + radius; }
        else if (m === right) { nx = 1; nz = 0; pen = right + radius; }
        else if (m === top) { nx = 0; nz = -1; pen = top + radius; }
        else { nx = 0; nz = 1; pen = bottom + radius; }
        d = 0;
      }
      out.hit = true;
      out.nx = nx;
      out.nz = nz;
      out.pen = pen;
      out.kind = a.kind;
      return out;
    }
    return out;
  }

  /** Does the segment (x0,z0)->(x1,z1) cross any static collider? */
  function segmentBlocked(x0, z0, x1, z1) {
    scratch.length = 0;
    statics.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), scratch);
    for (const entry of scratch) {
      const a = entry.aabb;
      if (segmentIntersectsAABB(x0, z0, x1, z1, a)) return true;
    }
    return false;
  }

  function segmentIntersectsAABB(x0, z0, x1, z1, a) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < a.x0 || x0 > a.x1) return false;
    } else {
      let t1 = (a.x0 - x0) / dx;
      let t2 = (a.x1 - x0) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    if (Math.abs(dz) < 1e-9) {
      if (z0 < a.z0 || z0 > a.z1) return false;
    } else {
      let t1 = (a.z0 - z0) / dz;
      let t2 = (a.z1 - z0) / dz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
    return true;
  }

  /** Is the lens position (px,pz) at height camY inside a collider tall enough to reach it? */
  function cameraBlockedAt(px, pz, camY) {
    scratch.length = 0;
    statics.query(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, scratch);
    for (const entry of scratch) {
      const a = entry.aabb;
      // A low prop (market stall, bridge rail, container) never blocks
      // a camera flying above it — only colliders that reach the lens
      // height count. Unspecified heights block everything, as before.
      if (a.height < camY - 0.3) continue;
      const cx = clamp(px, a.x0, a.x1);
      const cz = clamp(pz, a.z0, a.z1);
      const dx = px - cx;
      const dz = pz - cz;
      if (dx * dx + dz * dz < 0.25) return true;
    }
    return false;
  }

  /** Shorten a camera ray so the lens never sits inside a building. */
  function shortenCameraRay(focus, desired) {
    const dx = desired.x - focus.x;
    const dz = desired.z - focus.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return desired;
    const pointAt = (t) => ({
      x: focus.x + dx * t,
      y: focus.y + (desired.y - focus.y) * t,
      z: focus.z + dz * t,
    });
    const blocked = (t) => {
      const p = pointAt(t);
      return cameraBlockedAt(p.x, p.z, p.y) || inWater(p.x, p.z);
    };
    if (!blocked(1)) return desired;
    // Binary-search the farthest unblocked point along the ray: exact
    // to ~10 cm instead of snapping to coarse eighths.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 7; i += 1) {
      const mid = (lo + hi) / 2;
      if (blocked(mid)) hi = mid;
      else lo = mid;
    }
    if (lo > 0.12) {
      const p = pointAt(lo);
      return new THREE.Vector3(p.x, p.y, p.z);
    }
    // Every sample blocked: rise above the focus instead of collapsing
    // onto the player's head.
    return new THREE.Vector3(focus.x + dx * 0.15, focus.y + 2.4, focus.z + dz * 0.15);
  }

  const circleOut = { hit: false, nx: 0, nz: 0, pen: 0, kind: '' };

  /**
   * One arcade vehicle step. `body` holds x, z, heading, vx, vz, vy, y,
   * steer, integrity, tireBurst, steerPull. `drive` holds throttle
   * (-1..1), steer (-1..1), handbrake. Returns collision info.
   */
  function stepVehicle(body, def, drive, dt, gripScale) {
    const speed = Math.hypot(body.vx, body.vz);
    // Damage caps the top speed RELATIVE to the car's own integrity
    // pool: the old absolute "< 60" test permanently crippled
    // low-durability cars (a full-health 38-durability supercar ran at
    // 87% of its top speed forever). Full health is always full speed.
    const healthFrac = clamp(body.integrity / Math.max(1, body.maxIntegrity || def.durability), 0, 1);
    const damaged = healthFrac < 0.6 ? 1 - ((0.6 - healthFrac) / 0.6) * 0.35 : 1;
    const topSpeed = def.topSpeed * damaged * (healthFrac < 0.3 ? 0.75 : 1);
    const onRoad = game.roadgraph.onRoad(body.x, body.z);
    const surfaceGrip = (onRoad ? 1 : 0.62) * gripScale;

    // Steering rotates the heading only; the velocity vector is untouched
    // by the turn, so re-decomposing it against the NEW heading below is
    // what creates lateral velocity. Grip then bleeds that lateral
    // velocity away — the handbrake cuts grip, which is what a drift is.
    const fwd0 = forwardOf(body.heading);
    const vForward0 = body.vx * fwd0.x + body.vz * fwd0.z;
    const steerAuthority = clamp(1 - Math.abs(vForward0) / (topSpeed * 1.6), 0.25, 1);
    const steerTarget = drive.steer * def.steer * steerAuthority + body.steerPull;
    body.steer += (steerTarget - body.steer) * Math.min(1, dt * 8);
    if (Math.abs(vForward0) > 0.3) {
      const turnRate = body.steer * clamp(Math.abs(vForward0) / 6, 0, 1.6);
      body.heading += turnRate * dt * (vForward0 >= 0 ? 1 : -1);
    }

    // Re-decompose the unchanged velocity against the new heading.
    const nfwd = forwardOf(body.heading);
    const nright = { x: nfwd.z, z: -nfwd.x };
    let vForward = body.vx * nfwd.x + body.vz * nfwd.z;
    let vLateral = body.vx * nright.x + body.vz * nright.z;

    // Longitudinal: throttle, brake/reverse, drag, rolling resistance.
    // The power curve stays strong through the mid-range and eases off
    // only near the top, so a car actually reaches its top speed: the
    // old linear taper (1 - 0.85r) plus heavy drag stalled every car at
    // 33-52% of its top speed (measured 19 Nov 2026). Cruise now sits
    // at ~95% of topSpeed and 0-90% takes a few seconds per class.
    if (drive.throttle > 0) {
      const r = clamp(vForward / topSpeed, 0, 1);
      const accel = def.accel * Math.pow(1 - r, 0.45);
      vForward += accel * drive.throttle * dt;
      // Soft limiter: bleed off any overshoot above the top speed
      // instead of letting the curve push past it.
      if (vForward > topSpeed) vForward -= (vForward - topSpeed) * 1.5 * dt;
    } else if (drive.throttle < 0) {
      if (vForward > 0.5) vForward += def.brake * drive.throttle * dt;
      else vForward = Math.max(vForward + def.accel * 0.55 * drive.throttle * dt, -topSpeed * 0.35);
    }
    vForward -= vForward * (onRoad ? 0.06 : 0.35) * dt;
    vForward -= Math.sign(vForward) * Math.min(Math.abs(vForward), 0.8 * dt);

    // Lateral grip: the handbrake breaks it, which is what a drift is.
    const drifting = drive.handbrake && Math.abs(vForward) > 6;
    let grip = def.grip * surfaceGrip;
    if (drifting) grip *= 0.22;
    if (body.tireBurst) grip *= 0.6;
    vLateral *= Math.exp(-grip * dt);
    if (drifting) vForward -= vForward * 0.35 * dt;
    body.drifting = drifting && Math.abs(vLateral) > 2.5;
    body.slip = Math.abs(vLateral);

    body.vx = nfwd.x * vForward + nright.x * vLateral;
    body.vz = nfwd.z * vForward + nright.z * vLateral;

    // Air time: ramps launch the car; gravity brings it back.
    if (body.y > 0 || body.vy !== 0) {
      body.vy -= 22 * dt;
      body.y += body.vy * dt;
      if (body.y <= 0) {
        body.y = 0;
        if (body.vy < -8) {
          game.events.emit('crash', { x: body.x, z: body.z, speed: -body.vy, vehicle: body, other: null, landing: true });
        }
        body.vy = 0;
        body.airTime = 0;
      } else {
        body.airTime = (body.airTime || 0) + dt;
      }
    }

    const nx = body.x + body.vx * dt;
    const nz = body.z + body.vz * dt;
    const radius = Math.max(def.length, def.width) * 0.42;
    let collision = null;
    if (body.y <= 0.01) {
      if (inWater(nx, nz)) {
        body.vx *= -0.3;
        body.vz *= -0.3;
        collision = { speed, kind: 'water' };
      } else {
        const hit = resolveCircle(nx, nz, radius, circleOut);
        if (hit.hit) {
          const intoWall = -(body.vx * hit.nx + body.vz * hit.nz);
          if (intoWall > 0) {
            body.vx += hit.nx * intoWall * 1.35;
            body.vz += hit.nz * intoWall * 1.35;
            collision = { speed: intoWall, kind: hit.kind, nx: hit.nx, nz: hit.nz };
          }
          body.x = nx + hit.nx * hit.pen;
          body.z = nz + hit.nz * hit.pen;
        } else {
          body.x = nx;
          body.z = nz;
        }
      }
    } else {
      body.x = nx;
      body.z = nz;
    }

    body.x = clamp(body.x, -WORLD.half + 4, WORLD.half - 4);
    body.z = clamp(body.z, -WORLD.half + 4, WORLD.half - 4);
    body.speed = Math.hypot(body.vx, body.vz);
    return collision;
  }

  /** On-foot movement with wall sliding (axis-separated) and water block. */
  function moveWalker(body, wishX, wishZ, speed, dt) {
    const radius = 0.55;
    const oldX = body.x;
    const oldZ = body.z;
    let nx = body.x + wishX * speed * dt;
    let nz = body.z + wishZ * speed * dt;
    const hitX = resolveCircle(nx, body.z, radius, circleOut);
    if (hitX.hit || inWater(nx, body.z)) nx = body.x;
    const hitZ = resolveCircle(nx, nz, radius, circleOut);
    if (hitZ.hit || inWater(nx, nz)) nz = body.z;
    body.x = clamp(nx, -WORLD.half + 2, WORLD.half - 2);
    body.z = clamp(nz, -WORLD.half + 2, WORLD.half - 2);
    return { moved: dist2(oldX, oldZ, body.x, body.z) > 0.001 };
  }

  return {
    addCollider,
    colliderList,
    inWater,
    inTunnel,
    resolveCircle,
    segmentBlocked,
    cameraBlockedAt,
    shortenCameraRay,
    stepVehicle,
    moveWalker,
  };
}
