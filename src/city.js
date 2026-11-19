// city.js - Veyport, built procedurally from the SPEC.
// Six districts on a 1200 m grid, a canal with two bridges and a tunnel,
// a lighthouse at Ember Sands, and a landmark registry the game systems use.
// Buildings are merged per district (one draw call each); roads, markings,
// containers, lamps and stalls are merged the same way.

import { box, cyl, sph, plane, groupAt, mergeBoxes, glowMat, mat, rng, pick } from './geo.js';
import { CITY_HALF, GRID_STEP, districtAt } from './roadgraph.js';

const THREE = window.THREE;

export const DISTRICTS = [
  { name: 'The Docks', x0: -600, z0: -600, x1: -300, z1: 0, palette: [0x6b5a4a, 0x7a6a55, 0x5a4a3a, 0x8a7a62], hMin: 8, hMax: 22, kind: 'docks' },
  { name: 'Foundry Row', x0: -600, z0: 0, x1: -300, z1: 150, palette: [0x5a4a44, 0x6b5550, 0x4a3a3a, 0x7a5a44], hMin: 10, hMax: 30, kind: 'factory' },
  { name: 'Neon Mile', x0: 150, z0: -300, x1: 600, z1: 150, palette: [0x3a3a5a, 0x4a3a5a, 0x2a3a4a, 0x5a2a4a], hMin: 14, hMax: 42, kind: 'neon' },
  { name: 'Palm Heights', x0: -300, z0: -600, x1: 600, z1: -300, palette: [0xd8c8a8, 0xc8b898, 0xe8d8b8, 0xb8a888], hMin: 7, hMax: 18, kind: 'villa' },
  { name: 'Little Bazaar', x0: -300, z0: 150, x1: 150, z1: 600, palette: [0x8a6a4a, 0x9a7a52, 0x7a5a3a, 0xa8885a], hMin: 6, hMax: 16, kind: 'market' },
  { name: 'Ember Sands', x0: -300, z0: 300, x1: 600, z1: 600, palette: [0xc8b898, 0xd8c8a8, 0xb8a888, 0xe0d0b0], hMin: 5, hMax: 14, kind: 'beach' },
];

export const CANAL_Z = 150;
export const CANAL_HALF_W = 30;

export const LANDMARKS = {
  safehouse: { x: -450, z: -375, name: 'Safehouse Rook' },
  bar: { x: 300, z: -150, name: 'The Rusty Anchor' },
  gunShop: { x: 450, z: 0, name: 'Toko Senjata Ironworks' },
  respray: { x: -450, z: 75, name: 'Bengkel Respray' },
  market: { x: -75, z: 375, name: 'Pasar Little Bazaar' },
  lighthouse: { x: 450, z: 525, name: 'Mercusuar Ember Sands' },
  hq: { x: -450, z: 75, name: 'Markas Foundry Kings' },
  marina: { x: 375, z: -450, name: 'Marina Palm Heights' },
  chopShop: { x: -375, z: 75, name: 'Chop-shop Vex' },
};

export function buildCity(scene, graph) {
  const colliders = []; // { x0, z0, x1, z1 } axis-aligned
  const rand = rng(20261119);
  const root = groupAt(0, 0, 0);
  scene.add(root);

  // Ground: one big slab, sand at the south edge, concrete elsewhere.
  const ground = plane(2 * CITY_HALF + 200, 2 * CITY_HALF + 200, 0x5a6b52, 0, -0.1, 0);
  root.add(ground);
  const beach = plane(900, 300, 0xd8c89a, 150, -0.05, 450);
  root.add(beach);

  // Roads: asphalt strips along every grid avenue + ring, merged into one mesh.
  const roadBoxes = [];
  const avenues = [];
  for (let v = -CITY_HALF; v <= CITY_HALF; v += GRID_STEP) avenues.push(v);
  for (const v of avenues) {
    roadBoxes.push({ w: 14, h: 0.1, d: 2 * CITY_HALF, x: v, y: 0.02, z: 0, color: 0x2a2a2e });
    if (v !== CANAL_Z) roadBoxes.push({ w: 2 * CITY_HALF, h: 0.1, d: 14, x: 0, y: 0.02, z: v, color: 0x2a2a2e });
  }
  // Ring road.
  roadBoxes.push({ w: 14, h: 0.1, d: 1170, x: -585, y: 0.02, z: 0, color: 0x2a2a2e });
  roadBoxes.push({ w: 14, h: 0.1, d: 1170, x: 585, y: 0.02, z: 0, color: 0x2a2a2e });
  roadBoxes.push({ w: 1170, h: 0.1, d: 14, x: 0, y: 0.02, z: -585, color: 0x2a2a2e });
  roadBoxes.push({ w: 1170, h: 0.1, d: 14, x: 0, y: 0.02, z: 585, color: 0x2a2a2e });
  // Center dashes (white, short) along the main avenues.
  for (const v of avenues) {
    for (let t = -540; t <= 540; t += 30) {
      if (Math.abs(t - CANAL_Z) < 45) continue;
      roadBoxes.push({ w: 0.6, h: 0.12, d: 4, x: v, y: 0.03, z: t, color: 0xd8d8d8 });
    }
  }
  root.add(mergeBoxes(roadBoxes));

  // Canal: water band + stone walls.
  const water = plane(1200, CANAL_HALF_W * 2, 0x2a5a7a, 0, 0.05, CANAL_Z);
  water.material = new THREE.MeshLambertMaterial({ color: 0x2a5a7a, transparent: true, opacity: 0.9 });
  root.add(water);
  const wallN = box(1200, 1.2, 2, 0x8a8a8a, 0, 0.6, CANAL_Z - CANAL_HALF_W, { shadow: false });
  const wallS = box(1200, 1.2, 2, 0x8a8a8a, 0, 0.6, CANAL_Z + CANAL_HALF_W, { shadow: false });
  root.add(wallN, wallS);

  // Bridges at x = -300 and x = +300 (deck + rails), tunnel cover at x = 0.
  for (const bx of [-300, 300]) {
    const deck = box(16, 0.8, CANAL_HALF_W * 2 + 16, 0x4a4a4e, bx, 0.4, CANAL_Z, { shadow: false });
    const railL = box(0.6, 1.1, CANAL_HALF_W * 2 + 16, 0x8a2a2a, bx - 7.5, 1.2, CANAL_Z, { shadow: false });
    const railR = box(0.6, 1.1, CANAL_HALF_W * 2 + 16, 0x8a2a2a, bx + 7.5, 1.2, CANAL_Z, { shadow: false });
    root.add(deck, railL, railR);
  }
  const tunnelRoof = box(18, 1, 70, 0x3a3a3a, 0, 4.5, CANAL_Z, { shadow: false });
  const tunnelWallL = box(1, 5, 70, 0x3a3a3a, -8.5, 2.5, CANAL_Z, { shadow: false });
  const tunnelWallR = box(1, 5, 70, 0x3a3a3a, 8.5, 2.5, CANAL_Z, { shadow: false });
  root.add(tunnelRoof, tunnelWallL, tunnelWallR);
  colliders.push({ x0: -9, z0: CANAL_Z - 35, x1: -7, z1: CANAL_Z + 35 });
  colliders.push({ x0: 7, z0: CANAL_Z - 35, x1: 9, z1: CANAL_Z + 35 });

  // Buildings, merged per district. Blocks sit between avenues; each block
  // holds 1-4 buildings. Landmark plots stay clear for their own meshes.
  const keepClear = Object.values(LANDMARKS).map((l) => ({ x: l.x, z: l.z, r: 42 }));
  const clearAt = (x, z) => keepClear.some((k) => Math.abs(x - k.x) < k.r && Math.abs(z - k.z) < k.r);
  for (const d of DISTRICTS) {
    const list = [];
    for (let bx = d.x0 + 75; bx < d.x1; bx += GRID_STEP) {
      for (let bz = d.z0 + 75; bz < d.z1; bz += GRID_STEP) {
        if (Math.abs(bz - CANAL_Z) < 90) continue;
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const w = 22 + rand() * 34;
          const dep = 22 + rand() * 34;
          const h = d.hMin + rand() * (d.hMax - d.hMin);
          const x = bx + (rand() - 0.5) * (GRID_STEP - w - 24);
          const z = bz + (rand() - 0.5) * (GRID_STEP - dep - 24);
          if (clearAt(x, z)) continue;
          const color = pick(rand, d.palette);
          list.push({ w, h, d: dep, x, y: h / 2, z, color });
          colliders.push({ x0: x - w / 2, z0: z - dep / 2, x1: x + w / 2, z1: z + dep / 2 });
          // Roof box, slightly smaller and lighter, for silhouette variety.
          if (rand() < 0.5) {
            list.push({ w: w * 0.55, h: 2.5, d: dep * 0.55, x, y: h + 1.25, z, color: 0x9a9a9a });
          }
        }
      }
    }
    root.add(mergeBoxes(list));
  }

  // Landmark meshes (distinct, so they read as places, not boxes).
  const lm = (x, z, build) => { const g = groupAt(x, 0, z); build(g); root.add(g); return g; };
  // Safehouse: old warehouse with a big door and a rusty roof. The
  // building sits 24 m west of the landmark point: the landmark itself
  // is on the x=-450 avenue, and a building centered on it blocked the
  // avenue and wedged any car routed south through it (M2 drive).
  lm(LANDMARKS.safehouse.x - 24, LANDMARKS.safehouse.z, (g) => {
    g.add(box(30, 10, 20, 0x7a5a3a, 0, 5, 0));
    g.add(box(32, 1.5, 22, 0x5a3a2a, 0, 10.5, 0));
    g.add(box(8, 7, 0.5, 0x2a2a2a, 0, 3.5, 10.2));
    g.add(box(4, 2, 0.5, 0x8a2a2a, -10, 7, 10.2, { mat: glowMat(0x8a2a2a) }));
  });
  colliders.push({ x0: LANDMARKS.safehouse.x - 39, z0: LANDMARKS.safehouse.z - 10, x1: LANDMARKS.safehouse.x - 9, z1: LANDMARKS.safehouse.z + 10 });
  // The Rusty Anchor bar: two floors, neon sign. The building sits
  // 24 m northwest of the landmark point: the landmark itself is the
  // road intersection (300,-150), and a building centered on it would
  // block the road-graph node and wedge any car routed through it.
  // Northwest (not southeast): the southeast block is where the M1
  // stolen car spawns and maneuvers.
  lm(LANDMARKS.bar.x - 24, LANDMARKS.bar.z - 24, (g) => {
    g.add(box(22, 12, 16, 0x4a2a3a, 0, 6, 0));
    g.add(box(24, 1, 18, 0x2a2a2a, 0, 12.5, 0));
    const sign = box(14, 2, 0.6, 0xff2a6b, 0, 9, 8.3, { mat: glowMat(0xff2a6b) });
    g.add(sign);
  });
  colliders.push({ x0: LANDMARKS.bar.x - 35, z0: LANDMARKS.bar.z - 32, x1: LANDMARKS.bar.x - 13, z1: LANDMARKS.bar.z - 16 });
  // Gun shop: low block with a yellow sign. Same offset rule: the
  // landmark (450,0) is a road intersection and must stay drivable.
  lm(LANDMARKS.gunShop.x + 24, LANDMARKS.gunShop.z + 24, (g) => {
    g.add(box(18, 7, 14, 0x3a3a3a, 0, 3.5, 0));
    g.add(box(10, 1.6, 0.6, 0xe8c020, 0, 5.5, 7.2, { mat: glowMat(0xe8c020) }));
  });
  colliders.push({ x0: LANDMARKS.gunShop.x + 15, z0: LANDMARKS.gunShop.z + 17, x1: LANDMARKS.gunShop.x + 33, z1: LANDMARKS.gunShop.z + 31 });
  // Lighthouse: tapered tower + lamp room + beam (beam ref returned).
  let beam = null;
  lm(LANDMARKS.lighthouse.x, LANDMARKS.lighthouse.z, (g) => {
    g.add(cyl(3.2, 4.5, 26, 10, 0xe8e0d0, 0, 13, 0));
    g.add(cyl(3.6, 3.6, 2, 10, 0x8a2a2a, 0, 8, 0));
    g.add(cyl(3.6, 3.6, 2, 10, 0x8a2a2a, 0, 18, 0));
    g.add(cyl(2.6, 2.6, 3, 10, 0x222222, 0, 27, 0));
    const lamp = sph(1.4, 0xfff2a0, 0, 28.5, 0, { mat: glowMat(0xfff2a0) });
    g.add(lamp);
    beam = cyl(0.1, 14, 60, 8, 0xfff2a0, 0, 28.5, 30, { mat: new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.12 }), shadow: false });
    beam.rotation.x = Math.PI / 2;
    g.add(beam);
  });
  colliders.push({ x0: LANDMARKS.lighthouse.x - 5, z0: LANDMARKS.lighthouse.z - 5, x1: LANDMARKS.lighthouse.x + 5, z1: LANDMARKS.lighthouse.z + 5 });

  // Docks: container stacks (merged) + cranes (simple frames).
  const containers = [];
  const craneParts = [];
  for (let i = 0; i < 26; i++) {
    const cx = -540 + (i % 6) * 26 + rand() * 8;
    const cz = -480 + Math.floor(i / 6) * 30 + rand() * 8;
    const h = 2.6 * (1 + Math.floor(rand() * 3));
    containers.push({ w: 12, h, d: 2.6, x: cx, y: h / 2, z: cz, color: pick(rand, [0x8a2a2a, 0x2a5a8a, 0x2a7a3a, 0xc07a20, 0x6a6a6a]) });
    colliders.push({ x0: cx - 6, z0: cz - 1.3, x1: cx + 6, z1: cz + 1.3 });
  }
  root.add(mergeBoxes(containers));
  for (const cx of [-480, -360]) {
    const crane = groupAt(cx, 0, -540);
    crane.add(box(3, 34, 3, 0xc07a20, 0, 17, 0));
    crane.add(box(3, 34, 3, 0xc07a20, 18, 17, 0));
    crane.add(box(24, 3, 3, 0xc07a20, 9, 33, 0));
    crane.add(box(6, 4, 4, 0x2a2a2a, 9, 30, 0));
    root.add(crane);
    colliders.push({ x0: cx - 2, z0: -542, x1: cx + 20, z1: -538 });
  }

  // Street lamps along the main avenues (merged posts + emissive heads).
  const lampBoxes = [];
  const lampHeads = [];
  for (const v of [-450, -150, 150, 450]) {
    for (let t = -540; t <= 540; t += 90) {
      if (Math.abs(t - CANAL_Z) < 45) continue;
      lampBoxes.push({ w: 0.5, h: 7, d: 0.5, x: v + 8, y: 3.5, z: t, color: 0x3a3a3a });
      lampHeads.push({ w: 1.2, h: 0.5, d: 1.2, x: v + 8, y: 7.1, z: t, color: 0xffe8a0 });
    }
  }
  root.add(mergeBoxes(lampBoxes));
  root.add(mergeBoxes(lampHeads));

  // Neon Mile signs: emissive slabs on building faces.
  const neonColors = [0xff2a6b, 0x2affd8, 0xffe82a, 0x7a5aff, 0xff6a2a];
  for (let i = 0; i < 10; i++) {
    const sx = 180 + rand() * 380;
    const sz = -270 + rand() * 380;
    const sign = box(10 + rand() * 8, 1.6, 0.5, neonColors[i % neonColors.length], sx, 10 + rand() * 14, sz, { mat: glowMat(neonColors[i % neonColors.length]) });
    root.add(sign);
  }

  // Palm trees on the beach (merged trunks + merged crowns).
  const trunks = [];
  const crowns = [];
  for (let i = 0; i < 30; i++) {
    const px = -240 + rand() * 800;
    const pz = 330 + rand() * 240;
    trunks.push({ w: 0.8, h: 7, d: 0.8, x: px, y: 3.5, z: pz, color: 0x6a4a2a });
    crowns.push({ w: 5, h: 2.2, d: 5, x: px, y: 7.8, z: pz, color: 0x2a6b2a });
  }
  root.add(mergeBoxes(trunks));
  root.add(mergeBoxes(crowns));

  // Market stalls in Little Bazaar.
  const stalls = [];
  for (let i = 0; i < 12; i++) {
    const sx = -240 + (i % 4) * 42 + rand() * 10;
    const sz = 240 + Math.floor(i / 4) * 42 + rand() * 10;
    stalls.push({ w: 6, h: 2.4, d: 4, x: sx, y: 1.2, z: sz, color: pick(rand, [0xc07a20, 0x8a2a2a, 0x2a5a8a, 0xd8c020]) });
    colliders.push({ x0: sx - 3, z0: sz - 2, x1: sx + 3, z1: sz + 2 });
  }
  root.add(mergeBoxes(stalls));

  return {
    root,
    colliders,
    beam,
    landmarks: LANDMARKS,
    playerStart: { x: LANDMARKS.safehouse.x, z: LANDMARKS.safehouse.z + 26, heading: 0 },
    // Parked cars the player can take (early supercar included, F4).
    parkedSpots: [
      { x: LANDMARKS.safehouse.x + 12, z: LANDMARKS.safehouse.z + 30, heading: 0, classId: 'seraph' },
      { x: -420, z: -420, heading: Math.PI / 2, classId: 'komodo' },
      { x: 330, z: -180, heading: 0, classId: 'swift' },
      { x: 180, z: 60, heading: Math.PI, classId: 'pico' },
      { x: -180, z: 420, heading: Math.PI / 2, classId: 'vagabond' },
      { x: 480, z: 330, heading: 0, classId: 'bulldog' },
      { x: 60, z: -420, heading: Math.PI, classId: 'marlin' },
      { x: -60, z: 480, heading: 0, classId: 'hauler' },
    ],
    districtAt,
  };
}
