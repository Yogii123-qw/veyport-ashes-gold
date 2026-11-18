// Traffic: cars that follow the road graph, stop at red lights, yield
// to trouble ahead, and pull over for sirens. Density follows the clock
// and the weather. Every traffic car is a real fleet vehicle — it can
// be carjacked, crashed and sold like any other.

import * as THREE from 'three';
import { CIVILIAN_TYPES, TRAFFIC_WEIGHTS } from '../data/vehiclesData.js';
import { clamp, dampAngle, dist2 } from './utils.js';

const LIGHT_CYCLE = 21;

export function createTraffic(game) {
  const managed = [];
  let spawnTimer = 0;
  let lightTime = 0;
  const lightHeads = [];

  // Traffic-light poles at every other grid intersection: three
  // InstancedMeshes (poles, red lamps, green lamps) for all 16 heads,
  // so the whole signal system costs 3 draw calls. Lamp brightness is
  // per-instance color on a basic material.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.8 });
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 5.4, 6);
  const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const GRID = [-450, -150, 150, 450];
  const headPositions = [];
  for (const gx of GRID) {
    for (const gz of GRID) {
      headPositions.push({ x: gx + 8.5, z: gz + 8.5, offset: ((gx + gz) / 150) % 2 === 0 ? 0 : LIGHT_CYCLE / 2, gx, gz });
    }
  }
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, headPositions.length);
  const redMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), headPositions.length);
  const greenMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), headPositions.length);
  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  headPositions.forEach((head, i) => {
    tmpMatrix.makeTranslation(head.x, 2.7, head.z);
    poleMesh.setMatrixAt(i, tmpMatrix);
    tmpMatrix.makeTranslation(head.x, 5.6, head.z);
    redMesh.setMatrixAt(i, tmpMatrix);
    tmpMatrix.makeTranslation(head.x, 5.0, head.z);
    greenMesh.setMatrixAt(i, tmpMatrix);
    lightHeads.push({ x: head.gx, z: head.gz, index: i, offset: head.offset });
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  redMesh.instanceMatrix.needsUpdate = true;
  greenMesh.instanceMatrix.needsUpdate = true;
  game.scene.add(poleMesh);
  game.scene.add(redMesh);
  game.scene.add(greenMesh);

  function lightIsGreen(x, z) {
    const head = lightHeads.reduce((best, h) => {
      const d = dist2(x, z, h.x, h.z);
      return !best || d < best.d ? { h, d } : best;
    }, null);
    if (!head || head.d > 60) return true;
    const phase = (lightTime + head.h.offset) % LIGHT_CYCLE;
    return phase < 12;
  }

  function pickType(random) {
    const bag = [];
    for (const [type, w] of Object.entries(TRAFFIC_WEIGHTS)) {
      for (let i = 0; i < w; i += 1) bag.push(type);
    }
    return bag[Math.floor(random() * bag.length)] || 'komodo';
  }

  function spawnCar() {
    const angle = Math.random() * Math.PI * 2;
    const radius = 70 + Math.random() * 70;
    const px = game.player.x + Math.cos(angle) * radius;
    const pz = game.player.z + Math.sin(angle) * radius;
    const rp = game.roadgraph.nearestRoadPoint(px, pz);
    if (game.physics.inWater(rp.x, rp.z)) return;
    const target = game.roadgraph.randomNode(Math.random, rp.x, rp.z, 200, 900);
    const route = game.roadgraph.route(rp.x, rp.z, target.x, target.z);
    if (route.length < 2) return;
    const vehicle = game.vehicles.spawn(pickType(Math.random), rp.x, rp.z, rp.heading, { driver: 'traffic' });
    if (!vehicle) return;
    managed.push({ vehicle, route, leg: 1, stuckTimer: 0, reverseTimer: 0, desiredSpeed: 9 + Math.random() * 4, pullover: false });
  }

  function obstacleAhead(car, lookAhead) {
    const v = car.vehicle;
    const fwd = { x: Math.sin(v.heading), z: Math.cos(v.heading) };
    for (const other of game.vehicles.list) {
      if (other === v || other.wrecked) continue;
      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const along = dx * fwd.x + dz * fwd.z;
      const side = Math.abs(dx * fwd.z - dz * fwd.x);
      if (along > 0 && along < lookAhead && side < 2.6) return true;
    }
    for (const w of game.pedestrians.walkers) {
      if (w.state === 'dead') continue;
      const dx = w.x - v.x;
      const dz = w.z - v.z;
      const along = dx * fwd.x + dz * fwd.z;
      const side = Math.abs(dx * fwd.z - dz * fwd.x);
      if (along > 0 && along < lookAhead * 0.7 && side < 2.2) return true;
    }
    if (!game.player.vehicle) {
      const dx = game.player.x - v.x;
      const dz = game.player.z - v.z;
      const along = dx * fwd.x + dz * fwd.z;
      const side = Math.abs(dx * fwd.z - dz * fwd.x);
      if (along > 0 && along < lookAhead * 0.7 && side < 2.2) return true;
    }
    return false;
  }

  function update(dt) {
    lightTime += dt;
    for (const head of lightHeads) {
      const phase = (lightTime + head.offset) % LIGHT_CYCLE;
      const green = phase < 12;
      redMesh.setColorAt(head.index, tmpColor.set(green ? 0x330d0d : 0xff2222));
      greenMesh.setColorAt(head.index, tmpColor.set(green ? 0x22cc44 : 0x0d330d));
    }
    if (redMesh.instanceColor) redMesh.instanceColor.needsUpdate = true;
    if (greenMesh.instanceColor) greenMesh.instanceColor.needsUpdate = true;
    const hour = game.weather.hours;
    const dayFactor = hour >= 7 && hour <= 19 ? 1 : hour >= 5 && hour <= 22 ? 0.6 : 0.3;
    const weatherFactor = game.weather.current === 'storm' ? 0.5 : game.weather.current === 'rain' ? 0.7 : 1;
    const cap = Math.floor(game.quality.trafficCap * dayFactor * weatherFactor);
    spawnTimer -= dt;
    if (managed.length < cap && spawnTimer <= 0) {
      spawnTimer = 0.6;
      spawnCar();
    }
    const sirenNear = game.wanted.stars >= 1;
    for (let i = managed.length - 1; i >= 0; i -= 1) {
      const car = managed[i];
      const v = car.vehicle;
      if (v.wrecked || v.driver !== 'traffic') {
        managed.splice(i, 1);
        continue;
      }
      if (dist2(v.x, v.z, game.player.x, game.player.z) > 180) {
        game.vehicles.remove(v);
        managed.splice(i, 1);
        continue;
      }
      // Route following: pure pursuit of the next route point.
      const target = car.route[car.leg];
      if (!target || dist2(v.x, v.z, target.x, target.z) < 8) {
        car.leg += 1;
        if (car.leg >= car.route.length) {
          const next = game.roadgraph.randomNode(Math.random, v.x, v.z, 200, 900);
          car.route = game.roadgraph.route(v.x, v.z, next.x, next.z);
          car.leg = 1;
        }
        continue;
      }
      const wantHeading = Math.atan2(target.x - v.x, target.z - v.z);
      const headingError = ((wantHeading - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      let throttle = 1;
      let brake = false;
      // Red light: stop at the intersection line when the light is red
      // and the next node is an intersection within reach.
      const nodeNear = game.roadgraph.nearestNode(v.x, v.z);
      const node = game.roadgraph.nodePosition(nodeNear);
      const nodeDist = dist2(v.x, v.z, node.x, node.z);
      const approachingNode = nodeDist < 14 && dist2(target.x, target.z, node.x, node.z) < 2;
      if (approachingNode && !lightIsGreen(node.x, node.z) && v.speed < 12) brake = true;
      if (obstacleAhead(car, 10 + v.speed * 0.7)) brake = true;
      // Sirens: pull to the edge and stop.
      const policeClose = sirenNear && game.police.units.some((u) => u.vehicle && dist2(u.vehicle.x, u.vehicle.z, v.x, v.z) < 45);
      car.pullover = policeClose;
      if (car.pullover) brake = true;
      if (car.reverseTimer > 0) {
        car.reverseTimer -= dt;
        throttle = -0.6;
      } else if (brake) {
        throttle = v.speed > 0.5 ? -1 : 0;
      } else if (v.speed > car.desiredSpeed) {
        throttle = 0;
      }
      const steer = clamp(headingError * 1.6, -1, 1);
      const gripScale = game.weather.gripMultiplier();
      const collision = game.physics.stepVehicle(v, v.def, { throttle, steer, handbrake: false }, dt, gripScale);
      if (collision && collision.speed > 4) {
        game.vehicles.damage(v, collision.speed * 1.2, v.x, v.z);
        game.particles.sparks(v.x, 0.8, v.z, 5);
      }
      // Stuck recovery: back up briefly, then reroute.
      if (Math.abs(v.speed) < 0.6 && throttle > 0 && !brake) {
        car.stuckTimer += dt;
        if (car.stuckTimer > 3.5) {
          car.stuckTimer = 0;
          car.reverseTimer = 1.2;
          const next = game.roadgraph.randomNode(Math.random, v.x, v.z, 150, 800);
          car.route = game.roadgraph.route(v.x, v.z, next.x, next.z);
          car.leg = 1;
        }
      } else {
        car.stuckTimer = 0;
      }
      if (car.pullover) {
        // Edge toward the roadside while stopped.
        const rp = game.roadgraph.nearestRoadPoint(v.x, v.z);
        const sideX = v.x - rp.x;
        const sideZ = v.z - rp.z;
        const sideLen = Math.hypot(sideX, sideZ) || 1;
        v.x += (sideX / sideLen) * dt * 1.2;
        v.z += (sideZ / sideLen) * dt * 1.2;
      }
    }
  }

  function reset() {
    for (const car of managed) {
      if (car.vehicle.driver === 'traffic') game.vehicles.remove(car.vehicle);
    }
    managed.length = 0;
  }

  return { update, reset, managed, lightIsGreen };
}
