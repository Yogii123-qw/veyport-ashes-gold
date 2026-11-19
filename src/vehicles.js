// vehicles.js - Veyport's cars: mesh, wheels, driving.
// Body length runs along local +Z (nose at +Z); physics travels along +Z at
// heading 0, so the chase camera always sees the rear. Wheels are FOUR
// separate meshes, each spinning on its own axle (P9): a merged wheel mesh
// rotated from the car center would orbit the wheels over the roof.
// Traffic cars use a merged static wheel set (never rotated) to save calls.

import { CLASS_BY_ID, accelAt, steerRateAt, kmh } from './vehiclesData.js';

const THREE = window.THREE;

// Merge colored box/cylinder parts into one vertex-colored mesh.
function painted(parts) {
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  let base = 0;
  for (const p of parts) {
    let geo;
    if (p.shape === 'cyl') {
      geo = new THREE.CylinderGeometry(p.rt, p.rb, p.h, p.seg || 10);
    } else {
      geo = new THREE.BoxGeometry(p.w, p.h, p.d);
    }
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0);
    m.makeRotationFromEuler(e);
    m.setPosition(p.x || 0, p.y || 0, p.z || 0);
    geo.applyMatrix4(m);
    const pa = geo.attributes.position;
    const ia = geo.index;
    c.setHex(p.color);
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (ia) {
      for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + base);
    } else {
      for (let i = 0; i < pa.count; i++) idx.push(base + i);
    }
    base += pa.count;
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const GLASS = 0x141a22;
const DARK = 0x1a1a1a;
const TIRE = 0x111111;
const HUB = 0x9a9a9a;
const LIGHT_WARM = 0xffe8a0;
const LIGHT_RED = 0xc01818;

function bodyParts(def, color) {
  const L = def.len, W = def.wid;
  const tall = def.kind === 'van' || def.kind === 'truck' || def.kind === 'police' && def.id === 'cpdvan';
  const parts = [];
  // Hull: lower body + upper shoulder line.
  parts.push({ shape: 'box', w: W, h: 0.55, d: L * 0.94, x: 0, y: 0.55, z: 0, color });
  parts.push({ shape: 'box', w: W * 0.96, h: 0.22, d: L * 0.9, x: 0, y: 0.9, z: 0, color });
  // Cabin glass + roof (roof in body color, glass dark).
  const cabLen = tall ? L * 0.55 : L * 0.44;
  const cabZ = tall ? -L * 0.12 : -L * 0.06;
  const cabH = tall ? 0.95 : 0.5;
  parts.push({ shape: 'box', w: W * 0.84, h: cabH, d: cabLen, x: 0, y: 1.02 + (tall ? 0.3 : 0), z: cabZ, color: GLASS });
  parts.push({ shape: 'box', w: W * 0.86, h: 0.08, d: cabLen * 0.9, x: 0, y: 1.02 + cabH + (tall ? 0.3 : 0), z: cabZ, color });
  // Hood dip toward the nose.
  parts.push({ shape: 'box', w: W * 0.9, h: 0.16, d: L * 0.2, x: 0, y: 0.86, z: L * 0.38, color });
  // Bumpers, grille, trim, arches, mirrors, exhaust, door lines.
  parts.push({ shape: 'box', w: W * 0.98, h: 0.22, d: 0.2, x: 0, y: 0.34, z: L / 2 - 0.02, color: DARK });
  parts.push({ shape: 'box', w: W * 0.98, h: 0.22, d: 0.2, x: 0, y: 0.34, z: -L / 2 + 0.02, color: DARK });
  parts.push({ shape: 'box', w: W * 0.45, h: 0.16, d: 0.08, x: 0, y: 0.62, z: L / 2 + 0.01, color: DARK });
  parts.push({ shape: 'box', w: 0.5, h: 0.14, d: 0.08, x: -W * 0.32, y: 0.68, z: L / 2 + 0.01, color: LIGHT_WARM });
  parts.push({ shape: 'box', w: 0.5, h: 0.14, d: 0.08, x: W * 0.32, y: 0.68, z: L / 2 + 0.01, color: LIGHT_WARM });
  parts.push({ shape: 'box', w: W * 0.8, h: 0.12, d: 0.08, x: 0, y: 0.8, z: -L / 2 - 0.01, color: LIGHT_RED });
  for (const sx of [-1, 1]) {
    parts.push({ shape: 'box', w: 0.06, h: 0.1, d: L * 0.7, x: sx * (W / 2 + 0.01), y: 0.72, z: 0, color: DARK });
    parts.push({ shape: 'box', w: 0.16, h: 0.1, d: 0.3, x: sx * (W / 2 + 0.06), y: 1.0, z: L * 0.22, color: DARK });
    parts.push({ shape: 'box', w: 0.1, h: 0.42, d: 0.85, x: sx * (W / 2 - 0.02), y: 0.42, z: L * 0.32, color: 0x0a0a0a });
    parts.push({ shape: 'box', w: 0.1, h: 0.42, d: 0.85, x: sx * (W / 2 - 0.02), y: 0.42, z: -L * 0.32, color: 0x0a0a0a });
    parts.push({ shape: 'cyl', rt: 0.05, rb: 0.05, h: 0.3, seg: 8, x: sx * W * 0.28, y: 0.3, z: -L / 2 - 0.05, color: DARK, rx: Math.PI / 2 });
  }
  if (def.spoiler) {
    parts.push({ shape: 'box', w: W * 0.9, h: 0.07, d: 0.34, x: 0, y: 1.06, z: -L / 2 + 0.18, color: DARK });
    parts.push({ shape: 'box', w: 0.08, h: 0.2, d: 0.1, x: -W * 0.3, y: 0.94, z: -L / 2 + 0.18, color: DARK });
    parts.push({ shape: 'box', w: 0.08, h: 0.2, d: 0.1, x: W * 0.3, y: 0.94, z: -L / 2 + 0.18, color: DARK });
  }
  if (def.kind === 'truck') {
    parts.push({ shape: 'box', w: W * 0.96, h: 0.5, d: L * 0.4, x: 0, y: 1.15, z: -L * 0.22, color: 0x6a6a6a });
  }
  if (def.taxi) {
    parts.push({ shape: 'box', w: 0.7, h: 0.22, d: 0.4, x: 0, y: 1.42, z: -L * 0.06, color: 0xe8c020 });
  }
  if (def.police) {
    parts.push({ shape: 'box', w: 0.5, h: 0.14, d: 0.24, x: -W * 0.18, y: 1.34, z: -L * 0.06, color: 0xff2020 });
    parts.push({ shape: 'box', w: 0.5, h: 0.14, d: 0.24, x: W * 0.18, y: 1.34, z: -L * 0.06, color: 0x2040ff });
    parts.push({ shape: 'box', w: W * 0.9, h: 0.3, d: 0.06, x: 0, y: 0.62, z: L / 2 + 0.01, color: 0xd8d8d8 });
  }
  return parts;
}

function wheelRadius(def) {
  if (def.kind === 'truck' || def.kind === 'van') return 0.42;
  if (def.kind === 'supercar') return 0.31;
  return 0.33;
}

function buildWheel(def) {
  const r = wheelRadius(def);
  const w = def.kind === 'supercar' ? 0.3 : 0.24;
  const tire = painted([
    { shape: 'cyl', rt: r, rb: r, h: w, seg: 14, x: 0, y: 0, z: 0, color: TIRE, rz: Math.PI / 2 },
    { shape: 'cyl', rt: r * 0.55, rb: r * 0.55, h: w + 0.02, seg: 10, x: 0, y: 0, z: 0, color: HUB, rz: Math.PI / 2 },
  ]);
  tire.castShadow = true;
  return tire;
}

// One car: group + 4 wheel groups (spin on their own X axle) + state.
export function makeVehicle(def, color, x, z, heading, detailed) {
  const group = new THREE.Group();
  const body = painted(bodyParts(def, color));
  group.add(body);
  // Emissive lights only on the detailed (player) car.
  let headL = null, tailL = null;
  if (detailed) {
    headL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    headL.position.set(-def.wid * 0.32, 0.68, def.len / 2 + 0.03);
    const headR = headL.clone();
    headR.position.x = def.wid * 0.32;
    tailL = new THREE.Mesh(new THREE.BoxGeometry(def.wid * 0.8, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2828 }));
    tailL.position.set(0, 0.8, -def.len / 2 - 0.03);
    group.add(headL, headR, tailL);
  }
  const wheels = [];
  const axleY = wheelRadius(def);
  const wx = def.wid / 2 - 0.05;
  const wz = def.len * 0.32;
  const corners = [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]];
  if (detailed) {
    for (const [cx, cz] of corners) {
      const wg = new THREE.Group();
      wg.position.set(cx, axleY, cz);
      wg.rotation.order = 'YXZ';
      wg.add(buildWheel(def));
      group.add(wg);
      wheels.push(wg);
    }
  } else {
    // Traffic: one merged static wheel set, never rotated.
    const parts = [];
    for (const [cx, cz] of corners) {
      parts.push({ shape: 'cyl', rt: axleY, rb: axleY, h: 0.24, seg: 10, x: cx, y: axleY, z: cz, color: TIRE, rz: Math.PI / 2 });
      parts.push({ shape: 'cyl', rt: axleY * 0.55, rb: axleY * 0.55, h: 0.26, seg: 8, x: cx, y: axleY, z: cz, color: HUB, rz: Math.PI / 2 });
    }
    group.add(painted(parts));
  }
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  return {
    def, color, group, wheels, detailed,
    x, z, heading, speed: 0, steerVis: 0, spin: 0,
    damage: 100, wrecked: false, smoking: false,
    wheelR: axleY, cruise: 0,
  };
}

// A drivable car for the player: detailed mesh, spinning wheels, lights.
export function buildPlayerCar(scene, classId, x, z, heading) {
  const def = CLASS_BY_ID.get(classId);
  const car = makeVehicle(def, def.colors[0], x, z, heading, true);
  scene.add(car.group);
  return car;
}

// A traffic car: merged static wheels, random paint from the class palette.
export function buildTrafficCar(scene, classId, x, z, heading) {
  const def = CLASS_BY_ID.get(classId);
  const color = def.colors[Math.floor(Math.random() * def.colors.length)];
  const car = makeVehicle(def, color, x, z, heading, false);
  scene.add(car.group);
  return car;
}

// Drive one vehicle a step. ctrl: { throttle 0..1, brake 0..1, steer -1..1, handbrake }.
// Returns a crash event { impact } when a hard hit happened, else null.
export function stepDrive(v, ctrl, dt, colliders, gripMul = 1) {
  if (v.wrecked) return null;
  // Fail loudly on the classic arg-order slip (ctrl is an object, dt a number).
  if (typeof dt !== 'number' || !Number.isFinite(dt) || typeof ctrl !== 'object' || ctrl === null) {
    throw new Error('stepDrive: bad ctrl/dt - call as stepDrive(v, ctrl, dt, colliders, grip)');
  }
  const def = v.def;
  let crash = null;
  const fwd = v.speed >= 0 ? 1 : -1;
  if (ctrl.throttle > 0) {
    v.speed += accelAt(def, v.speed) * ctrl.throttle * dt;
  }
  if (ctrl.brake > 0) {
    const dec = def.brake * ctrl.brake;
    v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), dec * dt);
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
  }
  // Reverse: brake button while stopped backs up slowly.
  if (ctrl.brake > 0 && Math.abs(v.speed) < 0.5 && ctrl.throttle <= 0) {
    v.speed -= 6 * dt;
    if (v.speed < -8) v.speed = -8;
  }
  // Rolling drag + handbrake drag.
  v.speed *= Math.exp(-0.12 * dt);
  if (ctrl.handbrake) v.speed *= Math.exp(-0.9 * dt);
  if (Math.abs(v.speed) < 0.02 && ctrl.throttle <= 0) v.speed = 0;
  // Steering (P6 high-speed cut lives in steerRateAt).
  const turn = steerRateAt(def, v.speed, ctrl.steer) * gripMul * (ctrl.handbrake ? 1.5 : 1);
  v.heading += turn * dt;
  v.steerVis += ((ctrl.steer * 0.45) - v.steerVis) * Math.min(1, dt * 10);
  const nx = v.x + Math.sin(v.heading) * v.speed * dt;
  const nz = v.z + Math.cos(v.heading) * v.speed * dt;
  // Circle vs building AABB.
  const r = Math.max(def.len, def.wid) * 0.42;
  let cx = nx, cz = nz;
  for (const b of colliders) {
    const qx = Math.max(b.x0, Math.min(cx, b.x1));
    const qz = Math.max(b.z0, Math.min(cz, b.z1));
    const dx = cx - qx, dz = cz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const impact = Math.abs(v.speed);
      cx = qx + (dx / d) * r;
      cz = qz + (dz / d) * r;
      if (impact > 4) {
        v.damage -= (impact - 4) * 2.2;
        crash = { impact };
        if (v.damage <= 0) { v.damage = 0; v.wrecked = true; v.speed = 0; }
        v.smoking = v.damage < 60;
      }
      v.speed *= 0.45;
    }
  }
  // World bounds.
  cx = Math.max(-640, Math.min(640, cx));
  cz = Math.max(-640, Math.min(640, cz));
  v.x = cx; v.z = cz;
  v.spin += (v.speed / v.wheelR) * dt;
  // Visuals: body lean + wheel spin/steer.
  v.group.position.set(v.x, 0, v.z);
  v.group.rotation.y = v.heading;
  v.group.rotation.z = Math.max(-0.06, Math.min(0.06, -turn * 0.05));
  v.group.rotation.x = Math.max(-0.03, Math.min(0.03, -ctrl.throttle * 0.015));
  if (v.detailed) {
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      w.rotation.x = v.spin;
      w.rotation.y = i < 2 ? v.steerVis : 0;
    }
  }
  return crash;
}

export function vehicleKmh(v) {
  return kmh(v.speed);
}

// Police helicopter (F5): simple mesh with a spinning rotor + spotlight cone.
export function buildHeli(scene, x, y, z) {
  const g = new THREE.Group();
  const body = painted([
    { shape: 'box', w: 2.4, h: 1.8, d: 4.6, x: 0, y: 0, z: 0, color: 0x1a2a3a },
    { shape: 'box', w: 2.0, h: 1.0, d: 1.8, x: 0, y: 0.4, z: 2.6, color: 0x141a22 },
    { shape: 'box', w: 0.7, h: 0.7, d: 5.2, x: 0, y: 0.3, z: -4.2, color: 0x1a2a3a },
    { shape: 'box', w: 0.3, h: 2.2, d: 0.9, x: 0, y: 1.2, z: -6.4, color: 0x1a2a3a },
  ]);
  g.add(body);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.3, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  const blade2 = blade.clone();
  blade2.rotation.y = Math.PI / 2;
  rotor.add(blade, blade2);
  g.add(rotor);
  const coneGeo = new THREE.ConeGeometry(9, 34, 12, 1, true);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  cone.position.set(0, -17, 0);
  cone.rotation.x = Math.PI;
  g.add(cone);
  const lamp = new THREE.PointLight(0xfff2a0, 2.2, 55, 1.2);
  lamp.position.set(0, -2, 0);
  g.add(lamp);
  g.position.set(x, y, z);
  if (scene) scene.add(g);
  return { group: g, rotor, lamp };
}
