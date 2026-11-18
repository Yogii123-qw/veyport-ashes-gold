// The fleet: every car, van and truck in Veyport, its mesh, its damage
// and its explosion. Traffic, police and the player all drive vehicles
// from this one pool, so a car behaves the same whoever holds the wheel.
// Damage is real: smoke, fire, bent steering, burst tires, and a burning
// countdown that ends in a radius explosion with chain reactions.

import * as THREE from 'three';
import { CIVILIAN_TYPES, TRAFFIC_WEIGHTS, VEHICLES } from '../data/vehiclesData.js';
import { clamp, dist2, forwardOf } from './utils.js';

let nextVehicleId = 1;

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.15, metalness: 0.6 });
const glassBrokenMat = new THREE.MeshStandardMaterial({ color: 0x0e141c, roughness: 0.6, metalness: 0.2 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
const lightFrontMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffedb8, emissiveIntensity: 0.3 });
const lightRearMat = new THREE.MeshStandardMaterial({ color: 0xaa2222, emissive: 0xcc2222, emissiveIntensity: 0.4 });

// Merge a list of translated boxes into one non-indexed geometry so a
// vehicle spends one draw call on all of its bumpers / lamps instead
// of one per box.
function mergeBoxes(parts) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (const p of parts) {
    const geo = new THREE.BoxGeometry(p.w, p.h, p.d).toNonIndexed();
    geo.translate(p.x, p.y, p.z);
    positions.push(...geo.attributes.position.array);
    normals.push(...geo.attributes.normal.array);
    uvs.push(...geo.attributes.uv.array);
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return merged;
}

export function buildVehicleMesh(def, colorHex) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.35 });
  const L = def.length;
  const W = def.width;
  const isVan = def.cls === 'van' || def.cls === 'armored';
  const isTruck = def.cls === 'truck';
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.55, L), bodyMat);
  body.position.y = 0.58;
  body.castShadow = true;
  group.add(body);
  let cabin;
  if (isVan || def.cls === 'police' && def.id === 'cpdvan') {
    cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.85, L * 0.62), bodyMat);
    cabin.position.set(0, 1.28, -L * 0.12);
    cabin.castShadow = true;
    group.add(cabin);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.5, 0.08), glassMat);
    windshield.position.set(0, 1.3, L * 0.22);
    group.add(windshield);
  } else if (isTruck) {
    cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.9, L * 0.3), bodyMat);
    cabin.position.set(0, 1.25, L * 0.3);
    cabin.castShadow = true;
    group.add(cabin);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.7, L * 0.55), trimMat);
    bed.position.set(0, 1.2, -L * 0.18);
    group.add(bed);
  } else {
    cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 0.5, L * 0.45), glassMat);
    cabin.position.set(0, 1.08, -L * 0.05);
    cabin.castShadow = true;
    group.add(cabin);
  }
  // Bumpers and lights: one merged mesh per material.
  const bumpers = new THREE.Mesh(mergeBoxes([
    { w: W * 1.02, h: 0.22, d: 0.18, x: 0, y: 0.42, z: L / 2 },
    { w: W * 1.02, h: 0.22, d: 0.18, x: 0, y: 0.42, z: -L / 2 },
  ]), trimMat);
  group.add(bumpers);
  const headlights = new THREE.Mesh(mergeBoxes([
    { w: 0.34, h: 0.16, d: 0.06, x: -W * 0.32, y: 0.68, z: L / 2 + 0.02 },
    { w: 0.34, h: 0.16, d: 0.06, x: W * 0.32, y: 0.68, z: L / 2 + 0.02 },
  ]), lightFrontMat);
  group.add(headlights);
  const taillights = new THREE.Mesh(mergeBoxes([
    { w: 0.3, h: 0.16, d: 0.06, x: -W * 0.32, y: 0.68, z: -L / 2 - 0.02 },
    { w: 0.3, h: 0.16, d: 0.06, x: W * 0.32, y: 0.68, z: -L / 2 - 0.02 },
  ]), lightRearMat);
  group.add(taillights);
  // Wheels with steering pivots on the front pair.
  const wheels = [];
  for (const [wx, wz, front] of [[-W / 2, L * 0.32, true], [W / 2, L * 0.32, true], [-W / 2, -L * 0.32, false], [W / 2, -L * 0.32, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, front, spin: 0 });
  }
  let lightBar = null;
  if (def.police) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0xff2222, emissiveIntensity: 0 }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0x2244cc, emissive: 0x2244ff, emissiveIntensity: 0 }));
    blue.position.x = 0.3;
    bar.add(red);
    bar.add(blue);
    bar.position.set(0, def.id === 'cpdvan' ? 1.85 : 1.42, 0);
    group.add(bar);
    lightBar = { red: red.material, blue: blue.material };
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, 0.18, L * 0.6), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }));
    stripe.position.y = 0.62;
    group.add(stripe);
  }
  if (def.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf2a33c, emissiveIntensity: 0.7 }));
    sign.position.set(0, 1.42, 0);
    group.add(sign);
  }
  return { group, bodyMesh: body, bodyMat, cabinMesh: cabin, wheels, lightBar };
}

export function createVehicles(game) {
  const list = [];
  const byId = new Map();
  let flashTime = 0;

  function spawn(defId, x, z, heading, opts = {}) {
    const def = VEHICLES[defId];
    if (!def) return null;
    const colorHex = opts.color ?? def.colors[Math.floor(Math.random() * def.colors.length)];
    const built = buildVehicleMesh(def, colorHex);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = heading;
    game.scene.add(built.group);
    const vehicle = {
      id: nextVehicleId,
      plate: `VP-${1000 + ((nextVehicleId * 7919) % 9000)}`,
      def, defId,
      x, z, y: 0, heading,
      vx: 0, vz: 0, vy: 0, speed: 0, steer: 0, steerPull: 0, tireBurst: false,
      integrity: opts.integrity ?? def.durability,
      maxIntegrity: def.durability,
      color: colorHex,
      driver: opts.driver || null,
      wrecked: false, burning: false, explodeTimer: 0, wreckTimer: 0,
      brokenGlass: false, drifting: false, slip: 0, airTime: 0, airStart: null,
      group: built.group, bodyMesh: built.bodyMesh, bodyMat: built.bodyMat,
      cabinMesh: built.cabinMesh, wheels: built.wheels, lightBar: built.lightBar,
      smokeTimer: 0, fireTimer: 0, siren: false, target: !!opts.target, parked: !!opts.parked,
      respawnTimer: 0,
    };
    nextVehicleId += 1;
    list.push(vehicle);
    byId.set(vehicle.id, vehicle);
    return vehicle;
  }

  function remove(vehicle) {
    game.scene.remove(vehicle.group);
    const at = list.indexOf(vehicle);
    if (at >= 0) list.splice(at, 1);
    byId.delete(vehicle.id);
    game.audio.dropEngine(`veh${vehicle.id}`);
  }

  function damage(vehicle, amount, sourceX, sourceZ) {
    if (vehicle.wrecked || vehicle.burning) {
      if (vehicle.burning) vehicle.explodeTimer = Math.min(vehicle.explodeTimer, 0.8);
      return;
    }
    vehicle.integrity -= amount;
    if (vehicle.integrity <= vehicle.maxIntegrity * 0.6 && vehicle.steerPull === 0) {
      vehicle.steerPull = (Math.random() < 0.5 ? -1 : 1) * 0.12;
    }
    if (vehicle.integrity <= vehicle.maxIntegrity * 0.3 && !vehicle.tireBurst && Math.random() < 0.5) {
      vehicle.tireBurst = true;
    }
    if (vehicle.integrity <= 0) {
      vehicle.integrity = 0;
      vehicle.burning = true;
      vehicle.explodeTimer = 2.6;
      game.events.emit('vehicleBurning', { vehicle });
      game.audio.playSfx('crash', vehicle.x, vehicle.z);
    }
  }

  function explode(vehicle) {
    if (vehicle.wrecked) return;
    vehicle.wrecked = true;
    vehicle.burning = false;
    vehicle.vx = 0;
    vehicle.vz = 0;
    vehicle.driver = null;
    vehicle.wreckTimer = 0;
    vehicle.bodyMat.color.set(0x1c1c1c);
    vehicle.bodyMat.roughness = 0.95;
    game.particles.explosion(vehicle.x, 1, vehicle.z);
    game.audio.playSfx('explosion', vehicle.x, vehicle.z);
    game.events.emit('explosion', { x: vehicle.x, z: vehicle.z, radius: 9, vehicle });
    const nearPlayer = dist2(vehicle.x, vehicle.z, game.player.x, game.player.z);
    if (nearPlayer < 30) game.cameraRig.addTrauma(clamp(1 - nearPlayer / 30, 0.2, 0.9));
    // Radius damage with falloff, and chain reactions.
    for (const other of [...list]) {
      if (other === vehicle || other.wrecked) continue;
      const d = dist2(vehicle.x, vehicle.z, other.x, other.z);
      if (d < 10) damage(other, (1 - d / 10) * 90 + 20, vehicle.x, vehicle.z);
    }
    if (game.player.vehicle !== vehicle) {
      const pd = dist2(vehicle.x, vehicle.z, game.player.x, game.player.z);
      if (pd < 9) game.player.hurt((1 - pd / 9) * 70 + 15, 'explosion');
    }
    if (game.combat) game.combat.blastDamage(vehicle.x, vehicle.z, 9, 70);
  }

  function nearest(x, z, radius, filter) {
    let best = null;
    let bestD = radius;
    for (const v of list) {
      if (v.wrecked) continue;
      if (filter && !filter(v)) continue;
      const d = dist2(x, z, v.x, v.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function resolveCollisions() {
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      if (a.wrecked) continue;
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j];
        if (b.wrecked) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const minD = (a.def.length + b.def.length) * 0.28;
        if (d >= minD || d < 0.001) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = minD - d;
        const totalMass = a.def.mass + b.def.mass;
        a.x -= nx * overlap * (b.def.mass / totalMass);
        a.z -= nz * overlap * (b.def.mass / totalMass);
        b.x += nx * overlap * (a.def.mass / totalMass);
        b.z += nz * overlap * (a.def.mass / totalMass);
        const relVx = b.vx - a.vx;
        const relVz = b.vz - a.vz;
        const closing = -(relVx * nx + relVz * nz);
        if (closing > 1.5) {
          const impulse = closing * 0.9;
          a.vx -= nx * impulse * (b.def.mass / totalMass);
          a.vz -= nz * impulse * (b.def.mass / totalMass);
          b.vx += nx * impulse * (a.def.mass / totalMass);
          b.vz += nz * impulse * (a.def.mass / totalMass);
          const dmg = closing * 2.2;
          damage(a, dmg * 0.5, b.x, b.z);
          damage(b, dmg * 0.5, a.x, a.z);
          const mx = (a.x + b.x) / 2;
          const mz = (a.z + b.z) / 2;
          game.particles.sparks(mx, 0.8, mz, 8);
          game.audio.playSfx('crash', mx, mz);
          game.events.emit('crash', { x: mx, z: mz, speed: closing, vehicle: a, other: b });
          if (a === game.player.vehicle || b === game.player.vehicle) {
            game.cameraRig.addTrauma(clamp(closing / 30, 0.15, 0.7));
          }
        }
      }
    }
  }

  function sellValue(vehicle) {
    if (vehicle.def.police || vehicle.def.missionOnly) return 0;
    return Math.round(vehicle.def.sell * (vehicle.integrity / vehicle.maxIntegrity));
  }

  function spawnParked(random) {
    const spots = [];
    for (let tries = 0; tries < 60 && spots.length < 16; tries += 1) {
      const node = game.roadgraph.nodes[Math.floor(random() * game.roadgraph.nodes.length)];
      const rp = game.roadgraph.nearestRoadPoint(node.x + (random() - 0.5) * 60, node.z + (random() - 0.5) * 60);
      const side = random() < 0.5 ? 1 : -1;
      const perpX = Math.cos(rp.heading) * side;
      const perpZ = -Math.sin(rp.heading) * side;
      const x = rp.x + perpX * 5.2;
      const z = rp.z + perpZ * 5.2;
      if (game.physics.inWater(x, z)) continue;
      if (spots.some((s) => dist2(s.x, s.z, x, z) < 14)) continue;
      spots.push({ x, z, heading: rp.heading + (side < 0 ? Math.PI : 0) });
    }
    const weights = [];
    for (const [type, w] of Object.entries(TRAFFIC_WEIGHTS)) {
      for (let i = 0; i < w; i += 1) weights.push(type);
    }
    for (const spot of spots) {
      const type = weights[Math.floor(random() * weights.length)];
      spawn(type, spot.x, spot.z, spot.heading, { parked: true });
    }
  }

  function syncMesh(vehicle, dt) {
    const g = vehicle.group;
    g.position.set(vehicle.x, vehicle.y, vehicle.z);
    g.rotation.y = vehicle.heading;
    // Body lean: roll into corners, pitch under accel/brake.
    const targetRoll = clamp(-vehicle.steer * vehicle.speed * 0.004, -0.09, 0.09) + (vehicle.tireBurst ? Math.sin(performance.now() * 0.02) * 0.012 : 0);
    const targetPitch = clamp(-vehicle.vy * 0.01, -0.06, 0.12);
    g.rotation.z += (targetRoll - g.rotation.z) * Math.min(1, dt * 6);
    g.rotation.x += (targetPitch - g.rotation.x) * Math.min(1, dt * 6);
    const spin = (vehicle.speed / 0.36) * dt * (vehicle.vx * Math.sin(vehicle.heading) + vehicle.vz * Math.cos(vehicle.heading) >= 0 ? 1 : -1);
    for (const wheel of vehicle.wheels) {
      wheel.spin += spin;
      wheel.wheel.rotation.x = wheel.spin;
      if (wheel.front) wheel.pivot.rotation.y = vehicle.steer * 0.45;
    }
    if (vehicle.lightBar) {
      const on = vehicle.siren && flashTime % 0.5 < 0.25;
      vehicle.lightBar.red.emissiveIntensity = on ? 3 : 0.1;
      vehicle.lightBar.blue.emissiveIntensity = on ? 0.1 : 3;
    }
  }

  function update(dt) {
    flashTime += dt;
    for (const vehicle of [...list]) {
      if (vehicle.wrecked) {
        vehicle.wreckTimer += dt;
        if (vehicle.wreckTimer > 2 && vehicle.wreckTimer < 20 && Math.random() < dt * 2) {
          game.particles.smoke(vehicle.x, 1, vehicle.z, 2);
        }
        if (vehicle.wreckTimer > 90 && vehicle !== game.player.vehicle) remove(vehicle);
        syncMesh(vehicle, dt);
        continue;
      }
      if (vehicle.burning) {
        vehicle.explodeTimer -= dt;
        vehicle.fireTimer -= dt;
        if (vehicle.fireTimer <= 0) {
          vehicle.fireTimer = 0.08;
          game.particles.fire(vehicle.x, 1.2, vehicle.z, 3);
          game.particles.smoke(vehicle.x, 1.6, vehicle.z, 2);
        }
        if (vehicle.explodeTimer <= 0) explode(vehicle);
      } else if (vehicle.integrity < vehicle.maxIntegrity * 0.6) {
        vehicle.smokeTimer -= dt;
        if (vehicle.smokeTimer <= 0) {
          vehicle.smokeTimer = vehicle.integrity < vehicle.maxIntegrity * 0.3 ? 0.12 : 0.35;
          const fwd = forwardOf(vehicle.heading);
          game.particles.smoke(vehicle.x + fwd.x * vehicle.def.length * 0.3, 1.1, vehicle.z + fwd.z * vehicle.def.length * 0.3, 1);
          if (vehicle.integrity < vehicle.maxIntegrity * 0.3) game.particles.fire(vehicle.x, 1, vehicle.z, 1);
        }
      }
      // Engine audio: player vehicle + nearest two.
      const isPlayer = vehicle === game.player.vehicle;
      const dPlayer = dist2(vehicle.x, vehicle.z, game.player.x, game.player.z);
      if ((isPlayer || dPlayer < 40) && Math.abs(vehicle.speed) > 0.5) {
        const voice = game.audio.engineFor(`veh${vehicle.id}`, vehicle.def.engine);
        if (voice) voice.set(clamp(Math.abs(vehicle.speed) / vehicle.def.topSpeed, 0, 1), vehicle.x, vehicle.z, true);
      } else {
        const voice = game.audio.engineFor(`veh${vehicle.id}`, vehicle.def.engine);
        if (voice) voice.set(0, vehicle.x, vehicle.z, false);
      }
      syncMesh(vehicle, dt);
    }
  }

  function reset(random) {
    for (const vehicle of [...list]) remove(vehicle);
    nextVehicleId = 1;
    spawnParked(random);
  }

  function serialize() {
    return list.filter((v) => !v.wrecked).map((v) => ({
      defId: v.defId, x: v.x, z: v.z, heading: v.heading, integrity: v.integrity,
      color: v.color, plate: v.plate, parked: v.parked, driver: v.driver === 'traffic' ? 'traffic' : null,
    }));
  }

  function restore(entries) {
    for (const vehicle of [...list]) remove(vehicle);
    const restored = [];
    for (const entry of entries) {
      const v = spawn(entry.defId, entry.x, entry.z, entry.heading, { color: entry.color, integrity: entry.integrity, parked: entry.parked, driver: entry.driver });
      if (v) {
        v.plate = entry.plate;
        restored.push(v);
      }
    }
    return restored;
  }

  return {
    list,
    spawn,
    remove,
    damage,
    explode,
    nearest,
    resolveCollisions,
    sellValue,
    spawnParked,
    update,
    reset,
    serialize,
    restore,
    byId: (id) => byId.get(id) || null,
  };
}
