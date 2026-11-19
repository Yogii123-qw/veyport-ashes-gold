// city.js — Veyport, the city, rewritten in phase 2.
//
// One continuous 1.2 km x 1.2 km island built procedurally from three.js
// primitives, with runtime-painted canvas textures and zero asset files.
// Six districts, each with its own palette, building heights and props.
// Draw-call discipline: all buildings are ONE InstancedMesh, all road
// strips are ONE merged geometry, repeated props are instanced.
//
// The road graph now lives in roadgraph.js — the single source of truth
// for traffic, police and the minimap route line (SPEC §2.2); the city
// keeps the roads' geometry and delegates their topology. The build is
// split into named steps in the same order as phase 1, with the same
// deterministic seed (1337), so the city is byte-identical to the one
// phase 1 built: same buildings, same containers, same trees.

import * as THREE from '../vendor/three.min.js';
import { box, cyl, groundQuad, mergeGeoms, canvasTexture, stdMaterial, rayVsAABB } from './geo.js';
import { createRoadGraph, GRID_STEP, GRID_LINES } from './roadgraph.js';

export const WORLD_HALF = 600;
export { GRID_STEP, GRID_LINES };

export const DISTRICTS = [
  { id: 'docks', name: { en: 'The Docks', id: 'Dermaga' }, x: -420, z: -420, r: 210,
    palette: [0x6a6f75, 0x7a6a58, 0x5a5f66, 0x8a7a5a], hMin: 8, hMax: 22, density: 0.55 },
  { id: 'foundry', name: { en: 'Foundry Row', id: 'Foundry Row' }, x: -420, z: 150, r: 210,
    palette: [0x5a4a42, 0x6a5a4a, 0x4a4a48, 0x7a5a3a], hMin: 10, hMax: 30, density: 0.6 },
  { id: 'neon', name: { en: 'Neon Mile', id: 'Neon Mile' }, x: 0, z: -150, r: 200,
    palette: [0x3a3f4a, 0x5a3a4a, 0x2a2f3a, 0x6a4a5a], hMin: 14, hMax: 48, density: 0.85 },
  { id: 'palm', name: { en: 'Palm Heights', id: 'Palm Heights' }, x: 420, z: -420, r: 200,
    palette: [0xe8ddc8, 0xd8c8a8, 0xc8b898, 0xf2e8d8], hMin: 6, hMax: 16, density: 0.5 },
  { id: 'bazaar', name: { en: 'Little Bazaar', id: 'Little Bazaar' }, x: 150, z: 300, r: 200,
    palette: [0xa88a5a, 0x8a6a4a, 0xc8a86a, 0x7a5a3a], hMin: 5, hMax: 12, density: 0.9 },
  { id: 'ember', name: { en: 'Ember Sands', id: 'Ember Sands' }, x: 300, z: 480, r: 200,
    palette: [0xd8c8a8, 0xc8b898, 0xe8d8b8, 0xb8a888], hMin: 4, hMax: 10, density: 0.4 },
];

/** Named places the missions, shops and HUD all read from one place. */
export const LANDMARKS = {
  safehouse: { x: -460, z: -380, label: { en: 'Safehouse', id: 'Safehouse' } },
  bar: { x: 30, z: -180, label: { en: 'The Rusty Anchor', id: 'The Rusty Anchor' } },
  armory: { x: 60, z: -120, label: { en: 'Armory', id: 'Toko Senjata' } },
  chopshop: { x: -400, z: 180, label: { en: 'Chop Shop', id: 'Bengkel Potong' } },
  respray: { x: -380, z: 120, label: { en: 'Respray', id: 'Respray' } },
  garage: { x: -430, z: -350, label: { en: 'Garasi' } },
  lighthouse: { x: 480, z: 520, label: { en: 'Old Lighthouse', id: 'Mercusuar Tua' } },
  marina: { x: 420, z: -480, label: { en: 'Marina', id: 'Marina' } },
  market: { x: 150, z: 300, label: { en: 'Bazaar Market', id: 'Pasar Bazaar' } },
};

/** Deterministic RNG (mulberry32) so the city is identical every boot. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function districtAtPoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    const dx = x - d.x;
    const dz = z - d.z;
    const dd = dx * dx + dz * dz;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/** Facade texture: lit-window grid on a plain wall, drawn once at runtime. */
function facadeTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3f4a';
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 5; col++) {
        g.fillRect(8 + col * 24, 10 + row * 24, 14, 14);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, h - 18, w, 18);
  });
}

function facadeEmissiveTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);
    const lit = ['#ffd28a', '#ffb35a', '#ffe9b0', '#9ad2ff'];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 5; col++) {
        if (((row * 5 + col) * 7919) % 5 < 2) {
          g.fillStyle = lit[(row + col) % lit.length];
          g.fillRect(8 + col * 24, 10 + row * 24, 14, 14);
        }
      }
    }
  });
}

export function createCity(scene) {
  const rng = mulberry32(1337);
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();

  // ---------- Ground, sea, beach ----------
  function buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x5f6a58, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, 0);
    ground.receiveShadow = true;
    group.add(ground);

    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 260),
      new THREE.MeshStandardMaterial({ color: 0x1d4a66, roughness: 0.25, metalness: 0.35 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.4, 600 + 130);
    group.add(sea);

    const beach = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 44),
      new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 1 }),
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, 0.02, 600 - 22);
    beach.receiveShadow = true;
    group.add(beach);
  }

  // ---------- Roads: one merged geometry (asphalt + sidewalks + dashes) ----------
  function buildRoads() {
    const roadParts = [];
    const ASPHALT = 0x2b2e35;
    const SIDEWALK = 0x7a7d82;
    const DASH = 0xc8c8b8;
    for (const line of GRID_LINES) {
      // North-south road at x = line, east-west road at z = line.
      roadParts.push(groundQuad(line - 7, -600, line + 7, 600, 0.06, ASPHALT));
      roadParts.push(groundQuad(-600, line - 7, 600, line + 7, 0.06, ASPHALT));
      roadParts.push(groundQuad(line - 10, -600, line - 7, 600, 0.05, SIDEWALK));
      roadParts.push(groundQuad(line + 7, -600, line + 10, 600, 0.05, SIDEWALK));
      roadParts.push(groundQuad(-600, line - 10, 600, line - 7, 0.05, SIDEWALK));
      roadParts.push(groundQuad(-600, line + 7, 600, line + 10, 0.05, SIDEWALK));
      for (let s = -590; s < 590; s += 24) {
        roadParts.push(groundQuad(line - 0.4, s, line + 0.4, s + 8, 0.07, DASH));
        roadParts.push(groundQuad(s, line - 0.4, s + 8, line + 0.4, 0.07, DASH));
      }
    }
    // Coastal road along the beach.
    roadParts.push(groundQuad(-600, 545, 600, 559, 0.06, ASPHALT));
    roadParts.push(groundQuad(-600, 541, 600, 545, 0.05, SIDEWALK));
    const roads = new THREE.Mesh(mergeGeoms(roadParts), stdMaterial({ roughness: 0.95 }));
    roads.receiveShadow = true;
    group.add(roads);
  }

  // ---------- Drainage canal + two bridges (Ember Sands) ----------
  function buildCanal() {
    const canal = new THREE.Mesh(
      new THREE.BoxGeometry(10, 3, 300),
      new THREE.MeshStandardMaterial({ color: 0x24455a, roughness: 0.3 }),
    );
    canal.position.set(225, -1.2, 450);
    group.add(canal);
    for (const bz of [300, 450]) {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(20, 0.6, 18),
        new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.9 }),
      );
      deck.position.set(225, 0.3, bz);
      deck.receiveShadow = true;
      group.add(deck);
      colliders.push({ x0: 224, z0: bz - 9, x1: 226, z1: bz + 9, height: 0.6 });
    }
  }

  // ---------- Short tunnel (Foundry Row): covered road segment ----------
  // The tunnel covers the z=150 road: roof overhead, walls north and
  // south of the asphalt, STOPPING at the cross-roads — the old build
  // ran north-south with solid walls that sealed the z=150 road shut.
  function buildTunnel() {
    const tunnelRoof = new THREE.Mesh(
      new THREE.BoxGeometry(150, 1.2, 30),
      new THREE.MeshStandardMaterial({ color: 0x6a6d72, roughness: 0.95 }),
    );
    tunnelRoof.position.set(-375, 5.4, 150);
    group.add(tunnelRoof);
    for (const wz of [135, 165]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(136, 6, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x5a5d62, roughness: 0.95 }),
      );
      wall.position.set(-375, 3, wz);
      group.add(wall);
      colliders.push({ x0: -443, z0: wz - 0.75, x1: -307, z1: wz + 0.75, height: 6 });
    }
  }

  // ---------- Buildings: one InstancedMesh for the whole city ----------
  function buildBuildings() {
    const placements = [];
    for (let bx = 0; bx < GRID_LINES.length - 1; bx++) {
      for (let bz = 0; bz < GRID_LINES.length - 1; bz++) {
        const x0 = GRID_LINES[bx] + 14;
        const z0 = GRID_LINES[bz] + 14;
        const x1 = GRID_LINES[bx + 1] - 14;
        const z1 = GRID_LINES[bz + 1] - 14;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        if (cz > 520) continue; // beach, no buildings
        if (Math.abs(cx - 225) < 16 && cz > 290) continue; // canal
        const d = districtAtPoint(cx, cz);
        if (rng() > d.density) continue;
        const n = d.id === 'neon' || d.id === 'bazaar' ? 4 : (rng() < 0.5 ? 2 : 3);
        for (let i = 0; i < n; i++) {
          const w = 18 + rng() * 26;
          const dep = 14 + rng() * 18;
          const px = x0 + 8 + rng() * Math.max(1, (x1 - x0 - 16 - w));
          const pz = z0 + 8 + rng() * Math.max(1, (z1 - z0 - 16 - dep));
          const h = d.hMin + rng() * (d.hMax - d.hMin);
          const color = d.palette[Math.floor(rng() * d.palette.length)];
          placements.push({ x: px, z: pz, w, d: dep, h, color });
          colliders.push({ x0: px - w / 2, z0: pz - dep / 2, x1: px + w / 2, z1: pz + dep / 2, height: h });
        }
      }
    }
    // Landmark buildings (safehouse warehouse, bar, chop shop, armory).
    // NOTE: the safehouse warehouse sits at x=-482, not on the landmark
    // point (-460,-380): centred on the point its 34 m width covered
    // the whole x=-450 road (asphalt -457..-443), sealing the road shut
    // for cars and police routes. The mission point stays put.
    const landmarkDefs = [
      { x: -482, z: -380, w: 34, d: 22, h: 12, color: 0x8a6a4a },
      { x: 30, z: -180, w: 26, d: 18, h: 10, color: 0x5a3a4a },
      { x: -400, z: 180, w: 30, d: 24, h: 11, color: 0x4a4a48 },
      { x: 60, z: -120, w: 22, d: 16, h: 9, color: 0x3a3f4a },
    ];
    for (const L of landmarkDefs) {
      placements.push({ x: L.x, z: L.z, w: L.w, d: L.d, h: L.h, color: L.color });
      colliders.push({ x0: L.x - L.w / 2, z0: L.z - L.d / 2, x1: L.x + L.w / 2, z1: L.z + L.d / 2, height: L.h });
    }

    const facade = facadeTexture();
    const facadeEmissive = facadeEmissiveTexture();
    const buildingMat = new THREE.MeshStandardMaterial({
      map: facade, emissiveMap: facadeEmissive, emissive: new THREE.Color(0xffc27a),
      emissiveIntensity: 0, roughness: 0.9, metalness: 0.05,
    });
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMat, placements.length);
    placements.forEach((p, i) => {
      m4.compose(new THREE.Vector3(p.x, p.h / 2, p.z), q, new THREE.Vector3(p.w, p.h, p.d));
      buildings.setMatrixAt(i, m4);
      buildings.setColorAt(i, col.setHex(p.color));
    });
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    group.add(buildings);
    return buildingMat;
  }

  // ---------- Docks props: containers (instanced) + two gantry cranes ----------
  function buildDocks() {
    const containerColors = [0xc23a2a, 0x2a6ab8, 0x3f8a5f, 0xe8b23c, 0x8a2a3a, 0x7a8a99];
    // Roads are 14 m wide (+sidewalk to 10 m half-width); a container
    // is 12 x 3 m. Spots are rejected when the footprint (+2 m margin)
    // touches any road strip — the old code placed them anywhere in
    // the 180 m square, so several landed ON the roads and sealed
    // intersections shut (a police car wedged forever against one at
    // the (-450,-450) crossing).
    const roadClear = (x, z, hx, hz) => {
      for (const L of GRID_LINES) {
        if (Math.abs(x - L) < hx + 12) return false;
        if (Math.abs(z - L) < hz + 12) return false;
      }
      return true;
    };
    const containerSpots = [];
    for (let i = 0; i < 26; i++) {
      let spot = null;
      for (let t = 0; t < 40; t++) {
        const x = -560 + rng() * 180;
        const z = -560 + rng() * 180;
        if (Math.abs(x + 460) < 40 && Math.abs(z + 380) < 34) continue; // keep safehouse clear
        const alongZ = rng() < 0.5;
        const hx = alongZ ? 1.5 : 6;
        const hz = alongZ ? 6 : 1.5;
        if (!roadClear(x, z, hx, hz)) continue;
        spot = { x, z, ry: (alongZ ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.2, color: containerColors[i % containerColors.length], stack: rng() < 0.3 };
        break;
      }
      if (spot) containerSpots.push(spot);
    }
    const containers = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 2.6, 2.6), stdMaterial(), containerSpots.length * 2);
    let ci = 0;
    for (const s of containerSpots) {
      const e = new THREE.Euler(0, s.ry, 0);
      m4.compose(new THREE.Vector3(s.x, 1.3, s.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
      containers.setMatrixAt(ci, m4);
      containers.setColorAt(ci, col.setHex(s.color));
      ci += 1;
      if (s.stack) {
        m4.compose(new THREE.Vector3(s.x, 3.9, s.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
        containers.setMatrixAt(ci, m4);
        containers.setColorAt(ci, col.setHex(s.color));
        ci += 1;
      }
    }
    containers.count = ci;
    containers.instanceMatrix.needsUpdate = true;
    if (containers.instanceColor) containers.instanceColor.needsUpdate = true;
    containers.castShadow = true;
    group.add(containers);
    for (const s of containerSpots) {
      // Collider follows the rotation: a container turned 90 deg is
      // 3 m across the road, not 12 — the old axis-aligned box sealed
      // the road even when the visual left it open.
      const alongZ = Math.abs(Math.sin(s.ry)) > 0.7;
      const hx = alongZ ? 1.5 : 6;
      const hz = alongZ ? 6 : 1.5;
      colliders.push({ x0: s.x - hx, z0: s.z - hz, x1: s.x + hx, z1: s.z + hz, height: s.stack ? 5.2 : 2.6 });
    }

    const craneParts = [];
    for (const cx of [-520, -380]) {
      craneParts.push(box(4, 34, 4, 0xd8a03c, cx, 17, -520));
      craneParts.push(box(30, 3, 3, 0xd8a03c, cx + 12, 33, -520));
      craneParts.push(box(3, 8, 3, 0x8a5a1a, cx + 24, 28, -520));
      craneParts.push(box(6, 4, 6, 0x3a3f4a, cx, 1, -520));
      colliders.push({ x0: cx - 3, z0: -523, x1: cx + 3, z1: -517, height: 34 });
    }
    const cranes = new THREE.Mesh(mergeGeoms(craneParts), stdMaterial());
    cranes.castShadow = true;
    group.add(cranes);
  }

  // ---------- Streetlights: instanced poles + emissive heads ----------
  function buildLights() {
    const lightSpots = [];
    for (const gx of GRID_LINES) {
      for (const gz of GRID_LINES) {
        if (gz > 520) continue;
        lightSpots.push({ x: gx + 9, z: gz + 9 });
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 6);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.7, metalness: 0.5 }), lightSpots.length);
    const headGeo = new THREE.BoxGeometry(1.6, 0.25, 0.5);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xffd9a0, emissiveIntensity: 0 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
    lightSpots.forEach((s, i) => {
      m4.compose(new THREE.Vector3(s.x, 3, s.z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(s.x, 6, s.z), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(i, m4);
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    group.add(poles);
    group.add(heads);
    return headMat;
  }

  // ---------- Trees (Palm Heights + parks): instanced trunks + crowns ----------
  function buildTrees() {
    const treeSpots = [];
    for (let i = 0; i < 130; i++) {
      const x = -580 + rng() * 1160;
      const z = -580 + rng() * 1160;
      const d = districtAtPoint(x, z);
      if (d.id !== 'palm' && rng() < 0.7) continue;
      if (Math.abs(x % 150) < 12 || Math.abs(z % 150) < 12) continue; // not on roads
      if (z > 520) continue;
      treeSpots.push({ x, z, s: 0.8 + rng() * 0.7 });
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 3.4, 6), stdMaterial(), treeSpots.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 3.2, 7), stdMaterial(), treeSpots.length);
    treeSpots.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, 1.7 * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m4);
      trunks.setColorAt(i, col.setHex(0x6a4a2a));
      m4.compose(new THREE.Vector3(t.x, (3.4 + 1.4) * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      crowns.setMatrixAt(i, m4);
      crowns.setColorAt(i, col.setHex(0x2f6a3a));
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    group.add(trunks);
    group.add(crowns);
  }

  // ---------- Bazaar stalls: merged geometry, real awnings ----------
  function buildStalls() {
    const stallParts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = 150 + Math.cos(a) * 42;
      const z = 300 + Math.sin(a) * 42;
      const awn = [0xc23a2a, 0x2a6ab8, 0xe8b23c, 0x3f8a5f][i % 4];
      stallParts.push(box(4, 2.2, 0.3, 0x6a4a2a, x, 1.1, z));
      stallParts.push(box(4.4, 0.25, 3.4, awn, x, 2.5, z));
      stallParts.push(box(3.6, 0.9, 2.6, 0x8a7a5a, x, 0.45, z));
      colliders.push({ x0: x - 2.2, z0: z - 1.7, x1: x + 2.2, z1: z + 1.7, height: 2.6 });
    }
    const stalls = new THREE.Mesh(mergeGeoms(stallParts), stdMaterial());
    stalls.castShadow = true;
    group.add(stalls);
  }

  // ---------- Neon Mile signs: emissive boxes on the facades ----------
  function buildNeon() {
    const neonColors = [0xff2a7a, 0x2ad2ff, 0xffd23c, 0x7a2aff, 0x2aff8a];
    const signParts = [];
    for (let i = 0; i < 12; i++) {
      const x = -120 + (i % 4) * 80 + (rng() - 0.5) * 20;
      const z = -260 + Math.floor(i / 4) * 70 + (rng() - 0.5) * 20;
      const c = neonColors[i % neonColors.length];
      signParts.push(box(10, 1.6, 0.5, c, x, 8 + (i % 3) * 4, z));
    }
    const neonMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.4 });
    const neon = new THREE.Mesh(mergeGeoms(signParts), neonMat);
    group.add(neon);
    return neonMat;
  }

  // ---------- Lighthouse (Ember Sands) + rotating beam ----------
  function buildLighthouse() {
    const lhParts = [
      cyl(3.2, 4.2, 22, 10, 0xe8e0d0, 480, 11, 520),
      cyl(3.6, 3.6, 1.2, 10, 0x2a2f3a, 480, 22.6, 520),
      cyl(2.6, 2.6, 2.4, 10, 0xffd28a, 480, 24.2, 520),
      cyl(3.0, 3.0, 0.6, 10, 0x2a2f3a, 480, 25.6, 520),
    ];
    const lighthouse = new THREE.Mesh(mergeGeoms(lhParts), stdMaterial());
    lighthouse.castShadow = true;
    group.add(lighthouse);
    colliders.push({ x0: 476, z0: 516, x1: 484, z1: 524, height: 26 });
    const beam = new THREE.SpotLight(0xfff2c0, 0, 220, 0.32, 0.5, 1.2);
    beam.position.set(480, 24, 520);
    const beamTarget = new THREE.Object3D();
    beamTarget.position.set(480, 2, 420);
    scene.add(beamTarget);
    beam.target = beamTarget;
    scene.add(beam);
    return { beam, beamTarget };
  }

  buildGround();
  buildRoads();
  buildCanal();
  buildTunnel();
  const buildingMat = buildBuildings();
  buildDocks();
  const headMat = buildLights();
  buildTrees();
  buildStalls();
  const neonMat = buildNeon();
  const { beam, beamTarget } = buildLighthouse();

  // ---------- Road graph: delegated to roadgraph.js ----------
  const graph = createRoadGraph(rng);

  /** Circle (x, z, radius) vs building/prop AABBs: push-out resolution. */
  function resolveCircle(x, z, radius) {
    let px = x;
    let pz = z;
    let hit = null;
    for (const b of colliders) {
      // Low curbs (canal decks, 0.6 m) are stepped over, not walls:
      // the old code treated them as solid and they sealed roads shut.
      if (b.height < 1) continue;
      const cx = Math.max(b.x0, Math.min(px, b.x1));
      const cz = Math.max(b.z0, Math.min(pz, b.z1));
      const dx = px - cx;
      const dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.001;
        const push = radius - d;
        px += (dx / d) * push;
        pz += (dz / d) * push;
        hit = b;
      }
    }
    return { x: px, z: pz, hit };
  }

  /** Shortest ray hit against building AABBs (camera occlusion). */
  function raycastBuildings(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = Infinity;
    for (const b of colliders) {
      if (b.height < 3) continue;
      const t = rayVsAABB(ox, oy, oz, dx, dy, dz, b, maxDist);
      if (t < best) best = t;
    }
    return best;
  }

  function districtNameAt(x, z, lang) {
    return districtAtPoint(x, z).name[lang] || districtAtPoint(x, z).name.en;
  }

  let neonTime = 0;

  return {
    group,
    colliders,
    nodes: graph.nodes,
    adjacency: graph.adjacency,
    route: graph.route,
    nearestNode: graph.nearestNode,
    nearestRoadPoint: graph.nearestRoadPoint,
    randomRoadPoint: graph.randomRoadPoint,
    resolveCircle,
    raycastBuildings,
    districtAtPoint,
    districtNameAt,
    landmarks: LANDMARKS,
    /** Night lighting: windows + streetlights + neon come alive after dark. */
    update(dt, dayTime, nightFactor) {
      buildingMat.emissiveIntensity = nightFactor * 0.95;
      headMat.emissiveIntensity = nightFactor * 1.6;
      neonTime += dt;
      neonMat.emissiveIntensity = 0.15 + nightFactor * (1.1 + 0.35 * Math.sin(neonTime * 2.1));
      beam.intensity = nightFactor * 900;
      const a = neonTime * 0.5;
      beamTarget.position.set(480 + Math.cos(a) * 90, 2, 520 + Math.sin(a) * 90);
    },
  };
}
