// traffic.js - Veyport traffic that actually drives.
// Cars follow the shared RoadGraph in the right lane, stop at red lights,
// steer around wrecks, pull over when a police siren is near, and respawn
// when stuck. The driving itself is stepDrive; this module is the brain:
// route choice, lights, yielding, and recovery.

import { buildTrafficCar } from './vehicles.js';
import { applyDrive } from './physics.js';

const TRAFFIC_CLASSES = ['pico', 'swift', 'bulldog', 'komodo', 'longnose', 'cab', 'vagabond', 'hauler'];
const EXTRA_TRAFFIC = 6;
const MAX_SPEED_MPS = 13;

// Four light-controlled intersections (grid crossings). The cycle is
// 24 s: north-south green 0-11, yellow 11-13, east-west green 13-22,
// yellow 22-24. Cars read the phase for their direction of travel.
const LIGHT_NODES = [
  { x: 0, z: 0 }, { x: 0, z: -150 }, { x: -150, z: 0 }, { x: 150, z: 0 },
];
const CYCLE = 24;

export class TrafficSys {
  constructor(w) {
    this.w = w;
    this.cars = w.traffic;
    this.lightClock = 0;
    // Top the traffic up: the core ships 8, the city wants 14.
    for (let i = 0; i < EXTRA_TRAFFIC; i++) {
      const n = this._randomNodeNear((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800, 220);
      const cls = TRAFFIC_CLASSES[(i + 3) % TRAFFIC_CLASSES.length];
      const t = buildTrafficCar(w.scene, cls, n.x, n.z, Math.random() * Math.PI * 2);
      t.route = [];
      t.stuck = 0;
      w.cars.push(t);
      this.cars.push(t);
    }
  }

  _randomNodeNear(x, z, radius) {
    const g = this.w.graph;
    const near = g.nodes.filter((n) => Math.hypot(n.x - x, n.z - z) <= radius);
    if (near.length > 0) return near[Math.floor(Math.random() * near.length)];
    return g.nodePos(g.nearestNode(x, z));
  }

  // Light phase for a direction: 'ns' cars move along z, 'ew' along x.
  lightFor(dir) {
    const t = this.lightClock % CYCLE;
    if (dir === 'ns') {
      if (t < 11) return 'green';
      if (t < 13) return 'yellow';
      if (t < 22) return 'red';
      return 'yellow';
    }
    if (t < 11) return 'red';
    if (t < 13) return 'yellow';
    if (t < 22) return 'green';
    return 'yellow';
  }

  _nearestLight(x, z) {
    let best = null, bestD = 26;
    for (const l of LIGHT_NODES) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  update(dt) {
    const w = this.w;
    this.lightClock += dt;
    const sirenNear = w.wanted && w.wanted.stars >= 2;
    for (const t of this.cars) {
      if (t.wrecked) continue;
      // Pick a new route when the old one runs out.
      if (!t.route || t.route.length === 0) {
        const from = w.graph.nearestNode(t.x, t.z);
        const to = w.graph.nodes[Math.floor(Math.random() * w.graph.nodes.length)].id;
        t.route = w.graph.pathPoints(w.graph.shortestPath(from, to));
        t.nodeIdx = 0;
        t.pulledOver = false;
      }
      const node = t.route[t.nodeIdx];
      if (!node) {
        t.route = [];
        continue;
      }
      const dx = node.x - t.x, dz = node.z - t.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 6) {
        t.nodeIdx += 1;
        continue;
      }
      // Right-lane offset: 3 m to the right of the direction of travel.
      const wantHeading = Math.atan2(dx, dz);
      const rightX = -Math.cos(wantHeading), rightZ = Math.sin(wantHeading);
      const tx = node.x + rightX * 3, tz = node.z + rightZ * 3;
      const tdx = tx - t.x, tdz = tz - t.z;
      const tdist = Math.hypot(tdx, tdz);
      const steerTo = Math.atan2(tdx, tdz);
      let dh = steerTo - t.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      // Traffic light: stop before a red light on the next intersection.
      let throttle = 0.55;
      let brake = 0;
      const light = this._nearestLight(t.x, t.z);
      if (light) {
        const movingNs = Math.abs(dz) > Math.abs(dx);
        const phase = this.lightFor(movingNs ? 'ns' : 'ew');
        const lightDist = Math.hypot(light.x - t.x, light.z - t.z);
        if ((phase === 'red' || phase === 'yellow') && lightDist < 16 && lightDist > 4) {
          throttle = 0;
          brake = 1;
        }
      }
      // Yield: a wreck or a stopped car ahead means steer wide + slow.
      let avoid = 0;
      for (const other of this.cars) {
        if (other === t) continue;
        if (!other.wrecked && Math.abs(other.speed) > 0.5) continue;
        const odx = other.x - t.x, odz = other.z - t.z;
        const od = Math.hypot(odx, odz);
        if (od < 16 && od > 0.5) {
          const ahead = (odx * Math.sin(t.heading) + odz * Math.cos(t.heading)) / od;
          if (ahead > 0.5) {
            avoid = (odx * Math.cos(t.heading) - odz * Math.sin(t.heading)) > 0 ? -0.7 : 0.7;
            throttle = Math.min(throttle, 0.25);
          }
        }
      }
      // Siren: pull to the right edge and stop while police are active.
      if (sirenNear) {
        const px = w.player.x, pz = w.player.z;
        const pd = Math.hypot(px - t.x, pz - t.z);
        if (pd < 70) {
          t.pulledOver = true;
        }
      } else if (t.pulledOver && Math.abs(t.speed) < 0.5) {
        t.pulledOver = false;
      }
      if (t.pulledOver) {
        throttle = 0;
        brake = 1;
      }
      const steer = Math.max(-1, Math.min(1, dh * 1.4 + avoid));
      const speedCap = Math.min(MAX_SPEED_MPS, t.def.top * 0.45);
      if (Math.abs(t.speed) > speedCap) throttle = 0;
      applyDrive(t, { throttle, brake, steer, handbrake: false }, dt, w.colliders, w.weather.gripFactor());
      // Stuck: teleport to a fresh node after 5 s of no progress.
      if (Math.abs(t.speed) < 0.5 && throttle > 0) {
        t.stuck = (t.stuck || 0) + dt;
        if (t.stuck > 5) {
          const n = this._randomNodeNear(0, 0, 500);
          t.x = n.x; t.z = n.z;
          t.heading = Math.random() * Math.PI * 2;
          t.speed = 0; t.stuck = 0; t.route = [];
          t.group.position.set(t.x, 0, t.z);
        }
      } else {
        t.stuck = 0;
      }
    }
    // Gentle separation between the player's car and traffic.
    const pv = w.player.vehicle;
    if (!w.player.onFoot && pv) {
      for (const t of this.cars) {
        const dx = t.x - pv.x, dz = t.z - pv.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 4.4) {
          const push = (4.4 - d) / 2;
          const nx = dx / d, nz = dz / d;
          t.x += nx * push; t.z += nz * push;
          pv.x -= nx * push; pv.z -= nz * push;
        }
      }
    }
  }
}
