// vehicles.js — the fleet: meshes, spawning, damage, the player car.
//
// Physics lives in physics.js now and traffic AI in traffic.js; this
// module owns the fleet itself: building the two-mesh cars (one merged
// body + one merged wheel set — the F3 detail pass: bumpers, grille,
// mirrors, trim, fenders, spoilers, all real geometry), spawning
// traffic and parked cars, damage and explosions, and the player's car.
// Draw-call discipline: body and wheel geometries are cached per
// (type, colour), so spawning the twentieth Pico costs no new geometry
// and a respray is a cache lookup, not a rebuild. Traffic cars spawn
// clean: full integrity, no smoke.

import * as THREE from '../vendor/three.min.js';
import { box, cyl, mergeGeoms, stdMaterial } from './geo.js';
import { VEHICLES, CIVILIAN_TYPES, SUPERCAR_TYPES } from './vehiclesData.js';
import { createPhysics } from './physics.js';
import { createTraffic } from './traffic.js';

const PARKED_COUNT = 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hull + hood + cabin, shaped per class and body style. */
function hullParts(def, paint) {
  const L = def.length;
  const W = def.width;
  const H = def.height;
  const style = def.bodyStyle || {};
  const hullH = H * 0.52;
  const out = [box(L, hullH, W, paint, 0, hullH / 2 + 0.28, 0)];
  const noseH = style.nose === 'wedge' ? hullH * 0.55 : hullH * 0.6;
  out.push(box(L * 0.21, noseH, W * 0.93, paint, L * 0.42, hullH * 0.44, 0));
  if (style.roof === 'roadster') {
    out.push(box(L * 0.3, H * 0.16, W * 0.8, paint, -L * 0.08, hullH + 0.28 + H * 0.08, 0));
    out.push(box(L * 0.34, 0.1, W * 0.86, 0x1a2530, -L * 0.1, hullH + 0.28 + H * 0.2, 0));
    out.push(box(0.5, 0.22, 0.5, paint, -L * 0.24, hullH + 0.4, W * 0.3));
    out.push(box(0.5, 0.22, 0.5, paint, -L * 0.24, hullH + 0.4, -W * 0.3));
  } else if (def.cls === 'van' || def.cls === 'truck' || def.id === 'cpdvan') {
    out.push(box(L * 0.62, H * 0.42, W * 0.96, paint, -L * 0.12, hullH + 0.28 + H * 0.21, 0));
    out.push(box(L * 0.6, H * 0.3, W * 0.98, 0x1a2530, -L * 0.12, hullH + 0.28 + H * 0.24, 0));
  } else {
    const cabL = L * 0.42;
    out.push(box(cabL, H * 0.4, W * 0.86, 0x1a2530, -L * 0.06, hullH + 0.28 + H * 0.2, 0));
    // Supercars: a smaller roof plate leaves a dark glass border visible
    // from above, and a dark rear-glass panel reads from the chase
    // camera — without them a white supercar is a plain box from
    // behind/above (P3). Other classes keep the full roof.
    const roofL = def.cls === 'supercar' ? cabL * 0.62 : cabL * 0.96;
    const roofW = def.cls === 'supercar' ? W * 0.62 : W * 0.88;
    out.push(box(roofL, H * 0.06, roofW, paint, -L * 0.06, hullH + 0.28 + H * 0.4, 0));
    if (def.cls === 'supercar') {
      out.push(box(0.06, H * 0.34, W * 0.8, 0x1a2530, -L * 0.06 - cabL / 2 - 0.01, hullH + 0.28 + H * 0.2, 0));
    }
  }
  return { out, hullH };
}

/** Bumpers, grille, lamps, mirrors, trim, shut-lines, fender flares. */
function trimParts(def, paint) {
  const L = def.length;
  const W = def.width;
  const H = def.height;
  const hullH = H * 0.52;
  const trim = 0x222222;
  const chrome = 0x9aa0a8;
  const out = [
    box(0.28, 0.22, W * 0.98, trim, L / 2 - 0.05, 0.42, 0),
    box(0.28, 0.22, W * 0.98, trim, -L / 2 + 0.05, 0.42, 0),
    box(0.12, 0.2, W * 0.5, trim, L / 2 + 0.01, 0.62, 0),
    box(0.1, 0.14, 0.34, 0xfff2b0, L / 2 + 0.02, 0.72, W * 0.32),
    box(0.1, 0.14, 0.34, 0xfff2b0, L / 2 + 0.02, 0.72, -W * 0.32),
    box(0.1, 0.12, 0.3, 0xc22e2e, -L / 2 - 0.02, 0.72, W * 0.32),
    box(0.1, 0.12, 0.3, 0xc22e2e, -L / 2 - 0.02, 0.72, -W * 0.32),
  ];
  for (const s of [1, -1]) {
    out.push(box(0.22, 0.12, 0.1, paint, L * 0.18, hullH + 0.35, s * (W / 2 + 0.06)));
    out.push(box(L * 0.7, 0.06, 0.04, chrome, 0, 0.62, s * (W / 2 + 0.01)));
    out.push(box(0.05, hullH * 0.7, 0.04, trim, L * 0.12, hullH * 0.6, s * (W / 2 + 0.01)));
    out.push(box(0.05, hullH * 0.7, 0.04, trim, -L * 0.18, hullH * 0.6, s * (W / 2 + 0.01)));
  }
  const wheelR = def.cls === 'supercar' ? 0.3 : 0.36;
  // Supercars: dark, protruding arch lips read as wheel arches from the
  // rear quarter; paint-coloured strips vanish on a light body (P3).
  const archColor = def.cls === 'supercar' ? trim : paint;
  const archH = def.cls === 'supercar' ? 0.16 : 0.12;
  const archZ = def.cls === 'supercar' ? W / 2 + 0.01 : W / 2 - 0.02;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      out.push(box(0.9, archH, 0.18, archColor, sx * L * 0.32, wheelR + 0.28, sz * archZ));
    }
  }
  // Supercars: one full-width red light bar across the rear — the rear
  // signature. It sits 0.02 proud of the small lamps, so no coplanar
  // faces fight; the lamps end up embedded inside it, invisible.
  if (def.cls === 'supercar') {
    out.push(box(0.08, 0.16, W * 0.92, 0xff2a2a, -L / 2 - 0.05, 0.72, 0));
  }
  return out;
}

/** Class extras: taxi sign, police livery, supercar aero, truck bed. */
function classParts(def, paint) {
  const L = def.length;
  const W = def.width;
  const H = def.height;
  const hullH = H * 0.52;
  const style = def.bodyStyle || {};
  const trim = 0x222222;
  const chrome = 0x9aa0a8;
  const out = [];
  if (def.taxi) out.push(box(0.7, 0.22, 0.4, 0x111111, -L * 0.06, hullH + 0.28 + H * 0.46, 0));
  if (def.police) {
    out.push(box(L * 0.7, 0.1, W * 0.5, 0xffffff, 0, hullH + 0.28 + H * 0.1, 0));
    out.push(box(0.5, 0.18, 0.3, 0xc22e2e, L * 0.05, hullH + 0.28 + H * 0.46, 0));
    out.push(box(0.5, 0.18, 0.3, 0x2244cc, -L * 0.12, hullH + 0.28 + H * 0.46, 0));
  }
  if (style.spoiler === 'wing') {
    out.push(box(0.1, 0.5, 0.06, trim, -L / 2 + 0.12, hullH + 0.5, W * 0.32));
    out.push(box(0.1, 0.5, 0.06, trim, -L / 2 + 0.12, hullH + 0.5, -W * 0.32));
    // Wing plane in dark trim, not paint: a paint wing on a light body
    // disappears from behind (P3).
    out.push(box(0.5, 0.08, W * 0.9, trim, -L / 2 + 0.05, hullH + 0.78, 0));
  } else if (style.spoiler === 'ducktail') {
    // Ducktail in dark trim and taller: the paint lip was invisible on
    // a white Seraph from the chase camera (P3).
    out.push(box(0.55, 0.14, W * 0.9, trim, -L / 2 + 0.08, hullH + 0.55, 0));
  } else if (style.spoiler === 'lip') {
    out.push(box(0.3, 0.07, W * 0.88, trim, -L / 2 + 0.02, hullH + 0.5, 0));
  }
  if (def.cls === 'supercar') {
    // Twin chrome exhaust tips under the rear bumper.
    for (const s of [1, -1]) {
      out.push(box(0.14, 0.12, 0.2, chrome, -L / 2 - 0.02, 0.32, s * W * 0.18));
    }
  }
  if (style.doors === 'scissor' || style.doors === 'dihedral') {
    for (const s of [1, -1]) {
      out.push(box(L * 0.3, 0.05, 0.04, trim, L * 0.05, hullH + 0.1, s * (W / 2 + 0.01)));
    }
  }
  if (def.cls === 'supercar') {
    for (const s of [1, -1]) {
      out.push(box(0.7, 0.3, 0.06, trim, -L * 0.22, hullH * 0.7, s * (W / 2 + 0.01)));
    }
  }
  if (def.cls === 'truck') out.push(box(L * 0.3, H * 0.3, W * 0.9, 0x6a4a2a, -L * 0.32, hullH + 0.3, 0));
  if (def.cls === 'armored') out.push(box(L * 0.5, H * 0.35, W * 0.95, 0x8a8a7a, -L * 0.2, hullH + 0.35, 0));
  return out;
}

/**
 * Build one car's body as a single merged geometry. Every part is real
 * geometry in the mesh — nothing is faked with a texture.
 */
export function buildVehicleBody(def, color) {
  const { out } = hullParts(def, color);
  return mergeGeoms([...out, ...trimParts(def, color), ...classParts(def, color)]);
}

/** Four wheels merged into one geometry; spins around the local X axis. */
export function buildVehicleWheels(def) {
  const L = def.length;
  const W = def.width;
  const r = def.cls === 'supercar' ? 0.3 : 0.36;
  const w = def.cls === 'supercar' ? 0.26 : 0.22;
  const parts = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      // Wheels are built around y = 0 (the axle line); the mesh itself
      // is lifted to axle height, so rotation.x spins every wheel in place.
      parts.push(cyl(r, r, w, 10, 0x141414, sx * L * 0.32, 0, sz * (W / 2 - 0.05), 0, 0, Math.PI / 2));
      parts.push(cyl(r * 0.55, r * 0.55, w + 0.02, 8, 0x9aa0a8, sx * L * 0.32, 0, sz * (W / 2 - 0.05), 0, 0, Math.PI / 2));
    }
  }
  return mergeGeoms(parts);
}

let vehicleIdCounter = 1;

export function createVehicles(scene, city, bus) {
  const rng = mulberry32(20261119);
  const group = new THREE.Group();
  group.name = 'vehicles';
  scene.add(group);
  const bodyMat = stdMaterial({ roughness: 0.35, metalness: 0.35 });
  const wheelMat = stdMaterial({ roughness: 0.9, metalness: 0.1 });
  const physics = createPhysics({ city, bus });

  // Geometry cache: one merged body per (type, colour), one wheel set
  // per type. Shared geometries are never disposed on removal.
  const bodyCache = new Map();
  const wheelCache = new Map();
  function bodyGeometry(def, color) {
    const key = `${def.id}:${color}`;
    if (!bodyCache.has(key)) bodyCache.set(key, buildVehicleBody(def, color));
    return bodyCache.get(key);
  }
  function wheelGeometry(def) {
    if (!wheelCache.has(def.id)) wheelCache.set(def.id, buildVehicleWheels(def));
    return wheelCache.get(def.id);
  }

  const vehicles = [];
  let playerVehicle = null;

  function makeVehicle(type, x, z, heading, opts = {}) {
    const def = VEHICLES[type];
    const color = opts.color ?? def.colors[Math.floor(rng() * def.colors.length)];
    const body = new THREE.Mesh(bodyGeometry(def, color), bodyMat);
    const wheels = new THREE.Mesh(wheelGeometry(def), wheelMat);
    wheels.position.y = def.cls === 'supercar' ? 0.3 : 0.36;
    body.castShadow = true;
    const root = new THREE.Group();
    root.add(body);
    root.add(wheels);
    root.position.set(x, 0, z);
    root.rotation.y = heading;
    group.add(root);
    const v = {
      id: vehicleIdCounter++,
      type,
      def,
      color,
      root,
      body,
      wheels,
      x, z,
      heading,
      speed: 0,
      slip: 0,
      steerVis: 0,
      integrity: def.durability,
      maxIntegrity: def.durability,
      traffic: !!opts.traffic,
      parked: !!opts.parked,
      route: null,
      routeIdx: 0,
      cruise: 0,
      stuck: 0,
      smoke: 0,
      wrecked: false,
      wheelSpin: 0,
    };
    vehicles.push(v);
    return v;
  }

  function removeVehicle(v) {
    group.remove(v.root);
    const i = vehicles.indexOf(v);
    if (i >= 0) vehicles.splice(i, 1);
    if (playerVehicle === v) playerVehicle = null;
  }

  function nearestVehicle(x, z, maxDist, excludeTraffic = false) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const v of vehicles) {
      if (v.wrecked) continue;
      if (excludeTraffic && v.traffic) continue;
      const dx = v.x - x;
      const dz = v.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = v; }
    }
    return best;
  }

  function damage(v, amount, cause) {
    if (v.wrecked) return;
    if (v.missionProtected) return; // mission-critical car, not yet taken
    v.integrity -= amount;
    if (v.integrity <= 0) {
      v.integrity = 0;
      v.wrecked = true;
      bus.emit('vehicle-destroyed', { vehicle: v, cause });
    }
  }

  // Damage arrives from the physics events, not from the physics itself.
  // Pursuit vehicles take half wall damage: the chase AI steers by
  // straight lines to route nodes and will clip the odd corner, and a
  // unit that wrecks itself in two hits ends the whole chase.
  bus.on('wall-hit', ({ vehicle, speed }) => {
    if (vehicle && speed > 4) damage(vehicle, speed * (vehicle.police ? 0.8 : 1.6), 'wall');
  });
  bus.on('car-hit', ({ a, b, speed }) => {
    if (speed > 3) {
      damage(a, speed * 0.9, 'car');
      damage(b, speed * 0.9, 'car');
    }
  });

  function spawnParked() {
    for (let i = 0; i < PARKED_COUNT; i++) {
      const p = city.randomRoadPoint(rng);
      const side = rng() < 0.5 ? 1 : -1;
      const type = CIVILIAN_TYPES[Math.floor(rng() * CIVILIAN_TYPES.length)];
      makeVehicle(type, p.x + side * 9.5, p.z + (rng() - 0.5) * 8, (rng() - 0.5) * 0.4, { parked: true });
    }
    // One supercar parked near the safehouse: obtainable early (F4).
    makeVehicle('seraph', -438, -352, 0.2, { parked: true });
  }

  // The fleet API is built first so traffic can spawn through it
  // (traffic.js calls api.makeVehicle and reads api.vehicles).
  const api = {
    vehicles,
    makeVehicle,
    removeVehicle,
    nearestVehicle,
    damage,
    update,
    setPlayerVehicle,
    getPlayerVehicle,
    driveUnit,
    buildVehicleBody,
    bodyGeometry,
    measureAccel(type) {
      return physics.measureAccel(VEHICLES[type]);
    },
  };

  const traffic = createTraffic({ city, vehicles: api, physics });

  function update(dt, ctl, playerPos, gripFactor) {
    if (playerVehicle && !playerVehicle.wrecked) {
      physics.drive(playerVehicle, ctl, dt, gripFactor, vehicles);
    }
    traffic.update(dt, playerPos);
    for (const v of vehicles) {
      // Smoke / fire plumes follow the integrity thresholds.
      if (v.smoke === 1 && rng() < dt * 4) bus.emit('engine-smoke', { x: v.x, z: v.z, heading: v.heading });
      if (v.smoke === 2 && rng() < dt * 2) bus.emit('engine-fire', { x: v.x, z: v.z });
    }
  }

  function setPlayerVehicle(v) {
    playerVehicle = v;
  }

  function getPlayerVehicle() {
    return playerVehicle;
  }

  /** Drive a non-player unit (a police car) with the shared physics. */
  function driveUnit(unit, ctl, dt, gripFactor) {
    const v = unit.vehicle;
    if (!v || v.wrecked) return;
    physics.drive(v, ctl, dt, gripFactor, vehicles);
  }

  traffic.spawnAll();
  spawnParked();

  return api;
}
