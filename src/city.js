// Veyport itself, built procedurally at boot: merged and instanced
// geometry, runtime canvas textures, zero asset files. Buildings are one
// InstancedMesh, street props merge into one vertex-colored mesh, and
// every solid object registers a collider with physics. The city is
// deterministic: the same seed builds the same streets every load.

import * as THREE from 'three';
import { BRIDGES, CACHES, CLEAR_POINTS, DISTRICTS, GRID_LINES, POIS, RING, STUNT_JUMPS, TUNNEL, WORLD, districtAt, poiById } from '../data/cityData.js';
import { mulberry32 } from './utils.js';

const CITY_SEED = 1337;

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function mergeBoxes(parts) {
  // parts: {x,y,z, w,h,d, ry, color}. One geometry, vertex colors, one mesh.
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let base = 0;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  for (const part of parts) {
    const geo = new THREE.BoxGeometry(part.w, part.h, part.d);
    euler.set(part.rx || 0, part.ry || 0, part.rz || 0);
    quat.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(part.x, part.y, part.z), quat, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(matrix);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    color.set(part.color);
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    const idx = geo.index;
    for (let i = 0; i < idx.count; i += 1) indices.push(idx.getX(i) + base);
    base += pos.count;
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  return merged;
}

export function createCity(game) {
  const scene = game.scene;
  const random = mulberry32(CITY_SEED);
  const group = new THREE.Group();
  scene.add(group);
  const beacons = [];
  let waterTexture = null;
  let lighthouseBeam = null;
  let lighthouseLamp = null;
  let buildingMaterial = null;
  let lampMaterial = null;
  let neonMaterials = [];
  let elapsed = 0;

  // ---------- Ground ----------
  const groundTex = canvasTexture(2048, (ctx, size) => {
    const toPx = (v) => ((v + WORLD.half) / (WORLD.half * 2)) * size;
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(0, 0, size, size);
    // City blocks: sidewalk slabs with subtle variation.
    const bounds = [-WORLD.half, -RING, ...GRID_LINES, RING, WORLD.half];
    for (let i = 0; i < bounds.length - 1; i += 1) {
      for (let j = 0; j < bounds.length - 1; j += 1) {
        const x0 = toPx(bounds[i] + 11);
        const z0 = toPx(bounds[j] + 11);
        const w = toPx(bounds[i + 1] - 11) - x0;
        const h = toPx(bounds[j + 1] - 11) - z0;
        if (w <= 0 || h <= 0) continue;
        const shade = 104 + Math.floor(random() * 14);
        ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
        ctx.fillRect(x0, z0, w, h);
      }
    }
    // Parks: Palm Heights green + Ember boardwalk sand.
    ctx.fillStyle = '#5a7a4a';
    ctx.fillRect(toPx(330), toPx(-480), toPx(510) - toPx(330), toPx(-330) - toPx(-480));
    ctx.fillStyle = '#c2a878';
    ctx.fillRect(toPx(-600), toPx(480), toPx(150) - toPx(-600), toPx(600) - toPx(480));
    ctx.fillStyle = '#b89a68';
    ctx.fillRect(toPx(-600), toPx(560), toPx(150) - toPx(-600), toPx(600) - toPx(560));
    // Harbor channel bed.
    ctx.fillStyle = '#1c3a4a';
    ctx.fillRect(toPx(-600), toPx(306), toPx(-290) - toPx(-600), toPx(330) - toPx(306));
    // Roads: asphalt with edge lines.
    ctx.fillStyle = '#33363b';
    for (const g of GRID_LINES) {
      ctx.fillRect(toPx(g - 7), toPx(-RING), toPx(g + 7) - toPx(g - 7), toPx(RING) - toPx(-RING));
      ctx.fillRect(toPx(-RING), toPx(g - 7), toPx(RING) - toPx(-RING), toPx(g + 7) - toPx(g - 7));
    }
    ctx.fillRect(toPx(-RING - 7), toPx(-RING - 7), toPx(RING + 7) - toPx(-RING - 7), toPx(-RING + 7) - toPx(-RING - 7));
    ctx.fillRect(toPx(-RING - 7), toPx(RING - 7), toPx(RING + 7) - toPx(-RING - 7), toPx(RING + 7) - toPx(RING - 7));
    ctx.fillRect(toPx(-RING - 7), toPx(-RING - 7), toPx(-RING + 7) - toPx(-RING - 7), toPx(RING + 7) - toPx(-RING - 7));
    ctx.fillRect(toPx(RING - 7), toPx(-RING - 7), toPx(RING + 7) - toPx(RING - 7), toPx(RING + 7) - toPx(-RING - 7));
    // Centre dashes.
    ctx.fillStyle = '#c8b96a';
    for (const g of GRID_LINES) {
      for (let v = -RING + 10; v < RING - 10; v += 24) {
        ctx.fillRect(toPx(g) - 2, toPx(v), 4, 12);
        ctx.fillRect(toPx(v), toPx(g) - 2, 12, 4);
      }
    }
    // Crosswalks at grid intersections.
    ctx.fillStyle = 'rgba(220,220,220,0.75)';
    for (const gx of GRID_LINES) {
      for (const gz of GRID_LINES) {
        for (let k = -2; k <= 2; k += 1) {
          ctx.fillRect(toPx(gx - 6 + k * 2.6), toPx(gz - 9), 2, 5);
          ctx.fillRect(toPx(gx - 6 + k * 2.6), toPx(gz + 4), 2, 5);
        }
      }
    }
    // Plaza inlay at Neon Mile centre.
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 4;
    ctx.strokeRect(toPx(-60), toPx(-60), toPx(60) - toPx(-60), toPx(60) - toPx(-60));
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2, WORLD.half * 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---------- Water ----------
  waterTexture = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#1e4a5e';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i += 1) {
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(random() * size, y);
      ctx.lineTo(random() * size, y + 6);
      ctx.stroke();
    }
  });
  waterTexture.wrapS = THREE.RepeatWrapping;
  waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(6, 6);
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTexture, color: 0x2a6a8a, transparent: true, opacity: 0.88, roughness: 0.35, metalness: 0.1 });
  const channelWater = new THREE.Mesh(new THREE.PlaneGeometry(310, 24), waterMat);
  channelWater.rotation.x = -Math.PI / 2;
  channelWater.position.set(-445, 0.18, 318);
  group.add(channelWater);
  const outerWater = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), waterMat);
  outerWater.rotation.x = -Math.PI / 2;
  outerWater.position.y = -0.4;
  group.add(outerWater);

  // ---------- Buildings (instanced) ----------
  const facadeTex = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#3a4148';
    for (let y = 12; y < size - 10; y += 26) {
      for (let x = 10; x < size - 10; x += 24) {
        ctx.fillRect(x, y, 14, 16);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, size, 8);
  });
  const windowGlowTex = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    for (let y = 12; y < size - 10; y += 26) {
      for (let x = 10; x < size - 10; x += 24) {
        if (random() < 0.42) {
          ctx.fillStyle = random() < 0.7 ? '#ffb45c' : '#9fc4e8';
          ctx.fillRect(x, y, 14, 16);
        }
      }
    }
  });
  buildingMaterial = new THREE.MeshStandardMaterial({
    map: facadeTex, emissiveMap: windowGlowTex, emissive: 0xffffff, emissiveIntensity: 0,
    roughness: 0.9, metalness: 0.05,
  });

  const placements = [];
  const bounds = [-WORLD.half, -RING, ...GRID_LINES, RING, WORLD.half];
  const poiClear = (x, z) => POIS.every((p) => Math.hypot(p.x - x, p.z - z) > 26);
  const cacheClear = (x, z) => CACHES.every((c) => Math.hypot(c.x - x, c.z - z) > 10);
  const clearPointClear = (x, z) => CLEAR_POINTS.every((c) => Math.hypot(c.x - x, c.z - z) > 18);
  const openGround = (x, z) => poiClear(x, z) && cacheClear(x, z) && clearPointClear(x, z);
  for (let i = 0; i < bounds.length - 1; i += 1) {
    for (let j = 0; j < bounds.length - 1; j += 1) {
      const x0 = bounds[i] + WORLD.blockInset;
      const x1 = bounds[i + 1] - WORLD.blockInset;
      const z0 = bounds[j] + WORLD.blockInset;
      const z1 = bounds[j + 1] - WORLD.blockInset;
      const w = x1 - x0;
      const d = z1 - z0;
      if (w < 18 || d < 18) continue;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (cz > 300 && cz < 336 && cx < -280) continue; // channel
      if (cx > 500 && cz > -340 && cz < -200) continue; // tunnel hill
      if (!poiClear(cx, cz)) continue;
      const district = districtAt(cx, cz);
      if (random() > district.density) continue;
      const count = district.id === 'palm' || district.id === 'ember' ? 1 : 1 + Math.floor(random() * 3);
      for (let k = 0; k < count; k += 1) {
        const bw = Math.min(w * (count === 1 ? 0.62 : 0.4), 14 + random() * 22);
        const bd = Math.min(d * (count === 1 ? 0.62 : 0.4), 14 + random() * 22);
        const bx = x0 + bw / 2 + random() * Math.max(1, w - bw);
        const bz = z0 + bd / 2 + random() * Math.max(1, d - bd);
        if (!poiClear(bx, bz)) continue;
        if (!cacheClear(bx, bz)) continue;
        if (!clearPointClear(bx, bz)) continue;
        const [hMin, hMax] = district.height;
        const h = hMin + random() * (hMax - hMin);
        const [r, g, b] = district.building;
        const tint = 0.85 + random() * 0.3;
        placements.push({ x: bx, z: bz, w: bw, d: bd, h, color: new THREE.Color(r * tint, g * tint, b * tint) });
      }
    }
  }
  // Landmark buildings at POIs (fixed, distinct).
  const landmarks = [
    { poi: 'safehouse', w: 30, d: 20, h: 11, color: 0x7a5a3a },
    { poi: 'bar', w: 22, d: 16, h: 13, color: 0x4a3a52 },
    { poi: 'chopshop', w: 34, d: 24, h: 12, color: 0x5a4a3a },
    { poi: 'gunshop', w: 18, d: 14, h: 10, color: 0x3a4a3a },
    { poi: 'respray', w: 24, d: 18, h: 9, color: 0x6a5a2a },
    { poi: 'hospital', w: 30, d: 22, h: 20, color: 0xd8d8d0 },
    { poi: 'police', w: 28, d: 20, h: 16, color: 0x3a4a5a },
    { poi: 'harborHq', w: 26, d: 18, h: 14, color: 0x2f4a3f },
    { poi: 'foundryHq', w: 26, d: 18, h: 18, color: 0x4a2f2f },
    { poi: 'targetHouse', w: 24, d: 18, h: 10, color: 0xe0d8c0 },
  ];
  for (const lm of landmarks) {
    const p = poiById(lm.poi);
    placements.push({ x: p.x, z: p.z, w: lm.w, d: lm.d, h: lm.h, color: new THREE.Color(lm.color), landmark: lm.poi });
  }
  const buildingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMaterial, placements.length);
  const matrix = new THREE.Matrix4();
  placements.forEach((pl, idx) => {
    matrix.makeScale(pl.w, pl.h, pl.d);
    matrix.setPosition(pl.x, pl.h / 2, pl.z);
    buildingMesh.setMatrixAt(idx, matrix);
    buildingMesh.setColorAt(idx, pl.color);
    game.physics.addCollider(pl.x - pl.w / 2, pl.z - pl.d / 2, pl.x + pl.w / 2, pl.z + pl.d / 2, 'building', pl.h);
  });
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;
  buildingMesh.instanceMatrix.needsUpdate = true;
  if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
  group.add(buildingMesh);

  // Roof props.
  const roofCount = Math.floor(placements.length * 0.5);
  const roofMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 0.9 }), roofCount);
  for (let i = 0; i < roofCount; i += 1) {
    const pl = placements[i * 2];
    matrix.makeScale(2 + random() * 2, 1.5 + random(), 2 + random() * 2);
    matrix.setPosition(pl.x + (random() - 0.5) * pl.w * 0.4, pl.h + 0.8, pl.z + (random() - 0.5) * pl.d * 0.4);
    roofMesh.setMatrixAt(i, matrix);
  }
  roofMesh.instanceMatrix.needsUpdate = true;
  group.add(roofMesh);

  // ---------- Trees ----------
  const treeSpots = [];
  for (let i = 0; i < 150; i += 1) {
    const x = -560 + random() * 1120;
    const z = -560 + random() * 1120;
    if (game.roadgraph.onRoad(x, z)) continue;
    if (!openGround(x, z)) continue;
    if (z > 300 && z < 336 && x < -280) continue;
    treeSpots.push({ x, z, palm: districtAt(x, z).id === 'palm' || districtAt(x, z).id === 'ember' || random() < 0.25 });
  }
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 1 }), treeSpots.length);
  const crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1 }), treeSpots.length);
  treeSpots.forEach((t, idx) => {
    matrix.makeScale(1, t.palm ? 1.8 : 1, 1);
    matrix.setPosition(t.x, t.palm ? 2.7 : 1.5, t.z);
    trunkMesh.setMatrixAt(idx, matrix);
    matrix.makeScale(1, t.palm ? 0.6 : 1.15, 1);
    matrix.setPosition(t.x, t.palm ? 5.6 : 4.2, t.z);
    crownMesh.setMatrixAt(idx, matrix);
    game.physics.addCollider(t.x - 0.4, t.z - 0.4, t.x + 0.4, t.z + 0.4, 'tree', t.palm ? 6.5 : 4.5);
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  crownMesh.instanceMatrix.needsUpdate = true;
  crownMesh.castShadow = true;
  group.add(trunkMesh);
  group.add(crownMesh);

  // ---------- Streetlights ----------
  const lampSpots = [];
  for (const g of GRID_LINES) {
    for (let v = -RING + 40; v < RING; v += 75) {
      lampSpots.push({ x: g + 9, z: v });
      lampSpots.push({ x: v, z: g + 9 });
    }
  }
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 6, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.8 }), lampSpots.length);
  lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd98a, emissiveIntensity: 0 });
  const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), lampMaterial, lampSpots.length);
  lampSpots.forEach((s, idx) => {
    matrix.identity();
    matrix.setPosition(s.x, 3, s.z);
    poleMesh.setMatrixAt(idx, matrix);
    matrix.identity();
    matrix.setPosition(s.x, 6.1, s.z);
    headMesh.setMatrixAt(idx, matrix);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  group.add(poleMesh);
  group.add(headMesh);

  // ---------- Merged props: cranes, containers, bridges, tunnel, ramps ----------
  const props = [];
  // Dock cranes.
  for (const [cx, cz] of [[-540, -100], [-540, 40], [-540, 220]]) {
    props.push({ x: cx, y: 15, z: cz, w: 3, h: 30, d: 3, color: 0xc2702a });
    props.push({ x: cx + 8, y: 29, z: cz, w: 22, h: 2, d: 2, color: 0xc2702a });
    props.push({ x: cx - 6, y: 29, z: cz, w: 10, h: 2, d: 2, color: 0xc2702a });
    props.push({ x: cx + 16, y: 24, z: cz, w: 2, h: 8, d: 2, color: 0x333333 });
    props.push({ x: cx - 9, y: 26, z: cz, w: 4, h: 5, d: 4, color: 0x8a8a8a });
    game.physics.addCollider(cx - 2.5, cz - 2.5, cx + 2.5, cz + 2.5, 'crane', 30);
  }
  // Shipping containers at the docks.
  const containerColors = [0xb8452f, 0x2f6b8a, 0xd9a441, 0x3f6b4f, 0x8a8a8a];
  for (let i = 0; i < 26; i += 1) {
    const cx = -560 + random() * 90;
    const cz = -120 + random() * 340;
    if (game.roadgraph.onRoad(cx, cz)) continue;
    if (!cacheClear(cx, cz)) continue;
    if (!clearPointClear(cx, cz)) continue;
    const stacked = random() < 0.3;
    props.push({ x: cx, y: 1.3, z: cz, w: 6, h: 2.6, d: 2.5, ry: random() < 0.5 ? 0 : Math.PI / 2, color: containerColors[i % containerColors.length] });
    if (stacked) props.push({ x: cx, y: 3.9, z: cz, w: 6, h: 2.6, d: 2.5, ry: 0, color: containerColors[(i + 2) % containerColors.length] });
    game.physics.addCollider(cx - 3.2, cz - 3.2, cx + 3.2, cz + 3.2, 'container', stacked ? 5.2 : 2.6);
  }
  // Foundry chimneys.
  for (const [cx, cz] of [[-330, -330], [-270, -420], [-390, -480]]) {
    props.push({ x: cx, y: 20, z: cz, w: 5, h: 40, d: 5, color: 0x6a5a4a });
    props.push({ x: cx, y: 40.5, z: cz, w: 6, h: 1.5, d: 6, color: 0x4a3a2a });
    game.physics.addCollider(cx - 3, cz - 3, cx + 3, cz + 3, 'chimney', 40);
  }
  // Bridges over the channel.
  for (const b of BRIDGES) {
    props.push({ x: b.x, y: 0.35, z: (b.z0 + b.z1) / 2, w: 15, h: 0.7, d: b.z1 - b.z0 + 4, color: 0x4a4a4e });
    props.push({ x: b.x - 7.2, y: 1.1, z: (b.z0 + b.z1) / 2, w: 0.6, h: 1.4, d: b.z1 - b.z0 + 4, color: 0x8a2a2a });
    props.push({ x: b.x + 7.2, y: 1.1, z: (b.z0 + b.z1) / 2, w: 0.6, h: 1.4, d: b.z1 - b.z0 + 4, color: 0x8a2a2a });
    game.physics.addCollider(b.x - 7.6, b.z0 - 2, b.x - 6.8, b.z1 + 2, 'rail', 1.8);
    game.physics.addCollider(b.x + 6.8, b.z0 - 2, b.x + 7.6, b.z1 + 2, 'rail', 1.8);
  }
  // Tunnel hill over the east ring road.
  props.push({ x: 540, y: 8, z: -270, w: 42, h: 16, d: 122, color: 0x6a7a5a });
  props.push({ x: 540, y: 16.6, z: -270, w: 38, h: 1.5, d: 118, color: 0x5a6a4a });
  props.push({ x: 540, y: 6.4, z: -331, w: 20, h: 2.5, d: 2, color: 0x7a7a72 });
  props.push({ x: 540, y: 6.4, z: -209, w: 20, h: 2.5, d: 2, color: 0x7a7a72 });
  game.physics.addCollider(520, -330, 531, -210, 'tunnel', 16);
  game.physics.addCollider(549, -330, 560, -210, 'tunnel', 16);
  game.physics.addCollider(531, -331, 549, -330, 'tunnel', 16);
  game.physics.addCollider(531, -210, 549, -209, 'tunnel', 16);
  // Stunt ramps.
  for (const jump of STUNT_JUMPS) {
    props.push({ x: jump.x, y: 0.8, z: jump.z, w: 7, h: 1.6, d: 8, ry: jump.heading, rx: -0.32, color: 0xd9a441 });
  }
  // Boardwalk planks along Ember Sands.
  props.push({ x: -225, y: 0.25, z: 505, w: 740, h: 0.5, d: 10, color: 0x8a6a4a });
  // Market stalls in the Bazaar.
  for (let i = 0; i < 12; i += 1) {
    const sx = 200 + random() * 300;
    const sz = 200 + random() * 280;
    if (game.roadgraph.onRoad(sx, sz)) continue;
    if (!cacheClear(sx, sz)) continue;
    if (!clearPointClear(sx, sz)) continue;
    props.push({ x: sx, y: 1, z: sz, w: 4, h: 2, d: 3, color: 0x7a5a3a });
    props.push({ x: sx, y: 2.6, z: sz, w: 5, h: 0.3, d: 4, color: [0xb8452f, 0x2f6b8a, 0xd9a441][i % 3] });
    game.physics.addCollider(sx - 2.2, sz - 1.8, sx + 2.2, sz + 1.8, 'stall', 2.8);
  }
  const propMesh = new THREE.Mesh(mergeBoxes(props), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }));
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  group.add(propMesh);

  // ---------- Lighthouse ----------
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 26, 10), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8 }));
  tower.position.y = 13;
  tower.castShadow = true;
  lighthouse.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 4, 10), new THREE.MeshStandardMaterial({ color: 0xb8452f, roughness: 0.8 }));
  band.position.y = 18;
  lighthouse.add(band);
  lighthouseLamp = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe9a8, emissiveIntensity: 0.4 }));
  lighthouseLamp.position.y = 27;
  lighthouse.add(lighthouseLamp);
  lighthouseBeam = new THREE.Mesh(new THREE.ConeGeometry(6, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  lighthouseBeam.position.y = 27;
  lighthouseBeam.rotation.z = Math.PI / 2;
  lighthouseBeam.geometry.translate(30, 0, 0);
  lighthouse.add(lighthouseBeam);
  lighthouse.position.set(-500, 0, 540);
  group.add(lighthouse);
  game.physics.addCollider(-505, 535, -495, 545, 'lighthouse', 27);

  // ---------- Neon signs ----------
  const signs = [
    { text: 'RUSTY ANCHOR', x: 60, z: -71, color: '#ff5a3c', w: 20, h: 4 },
    { text: 'HARBOR ARMS', x: 90, z: 80, color: '#ffd23c', w: 16, h: 3.4 },
    { text: 'NEON MILE', x: -90, z: -90, color: '#3cd2ff', w: 18, h: 4 },
    { text: 'HOTEL VEY', x: 120, z: -120, color: '#ff3cd2', w: 14, h: 3.4 },
    { text: 'CUT & COAT', x: -240, z: -251, color: '#3cff8a', w: 16, h: 3.4 },
    { text: 'ST. ANSELM', x: 300, z: 19, color: '#ffffff', w: 16, h: 3.4 },
    { text: 'CPD', x: 0, z: -311, color: '#3c8aff', w: 8, h: 3.4 },
    { text: 'BAZAAR', x: 240, z: 180, color: '#ffb43c', w: 14, h: 3.4 },
    { text: 'EMBER LIGHT', x: -500, z: 528, color: '#ffe9a8', w: 18, h: 3.4 },
    { text: 'DANCE HALL', x: -60, z: 30, color: '#ff3c8a', w: 16, h: 3.4 },
    { text: 'NOODLE BAR', x: 180, z: 198, color: '#ffd23c', w: 14, h: 3 },
    { text: 'FERRY', x: -540, z: 300, color: '#3cd2ff', w: 10, h: 3 },
  ];
  for (const sign of signs) {
    const tex = canvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, size, size / 3);
      ctx.strokeStyle = sign.color;
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, size - 16, size / 3 - 16);
      ctx.fillStyle = sign.color;
      ctx.font = `bold ${Math.floor(size / 7)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sign.text, size / 2, size / 6);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false });
    neonMaterials.push(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sign.w, sign.h), mat);
    plane.position.set(sign.x, 7.5, sign.z);
    plane.rotation.y = Math.atan2(game.roadgraph.nearestRoadPoint(sign.x, sign.z).x - sign.x, game.roadgraph.nearestRoadPoint(sign.x, sign.z).z - sign.z);
    group.add(plane);
  }

  // ---------- Lights ----------
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5248, 0.9);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);
  scene.fog = new THREE.Fog(0xcfd8e0, 300, 1100);
  game.lights = { sun, hemi, ambient };

  // Ember Cache markers (small glowing octahedrons, hidden until near).
  const cacheMeshes = [];
  const cacheGeo = new THREE.OctahedronGeometry(0.55);
  const cacheMat = new THREE.MeshStandardMaterial({ color: 0xf2a33c, emissive: 0xf2a33c, emissiveIntensity: 1.2, roughness: 0.3 });
  for (const cache of CACHES) {
    const mesh = new THREE.Mesh(cacheGeo, cacheMat);
    mesh.position.set(cache.x, 1.1, cache.z);
    mesh.visible = false;
    group.add(mesh);
    cacheMeshes.push(mesh);
  }

  // A waypoint beacon: a light pillar plus a ground ring, positioned
  // by the caller. The update loop pulses every live beacon.
  function createBeacon(x, z, colorHex) {
    const group2 = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 12, 1, true), mat);
    pillar.position.y = 15;
    group2.add(pillar);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 24), new THREE.MeshBasicMaterial({ color: colorHex }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    group2.add(ring);
    group2.position.set(x, 0, z);
    group2.userData.beacon = { mat, ring };
    beacons.push(group2);
    return group2;
  }

  function update(dt, nightFactor, stormFlash) {
    elapsed += dt;
    if (waterTexture) waterTexture.offset.x = (elapsed * 0.008) % 1;
    if (lighthouseBeam) {
      lighthouseBeam.rotation.y = elapsed * 0.5;
      lighthouseBeam.material.opacity = 0.04 + nightFactor * 0.14 + (stormFlash ? 0.1 : 0);
    }
    if (lighthouseLamp) lighthouseLamp.material.emissiveIntensity = 0.3 + nightFactor * 1.4;
    if (buildingMaterial) buildingMaterial.emissiveIntensity = nightFactor * 0.85;
    if (lampMaterial) lampMaterial.emissiveIntensity = nightFactor * 2.2;
    for (const mat of neonMaterials) mat.color.setScalar(0.55 + nightFactor * 0.45);
    for (let i = beacons.length - 1; i >= 0; i -= 1) {
      const beacon = beacons[i];
      if (!beacon.parent) {
        beacons.splice(i, 1);
        continue;
      }
      const data = beacon.userData.beacon;
      const pulse = 0.45 + Math.sin(elapsed * 4) * 0.2;
      data.mat.opacity = pulse;
      data.ring.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.12);
      beacon.rotation.y = elapsed * 0.8;
    }
    // Cache markers reveal within 30 m and bob.
    const px = game.player ? game.player.x : 0;
    const pz = game.player ? game.player.z : 0;
    CACHES.forEach((cache, i) => {
      const mesh = cacheMeshes[i];
      const taken = game.progress && game.progress.cachesTaken.has(cache.id);
      const near = Math.hypot(cache.x - px, cache.z - pz) < 30;
      mesh.visible = !taken && near;
      if (mesh.visible) {
        mesh.position.y = 1.1 + Math.sin(elapsed * 2 + i) * 0.15;
        mesh.rotation.y = elapsed * 1.5;
      }
    });
    // The shadow frustum follows the player; weather.js owns the sun's
    // position and color, so this only moves the target.
    if (game.player) {
      sun.target.position.set(game.player.x, 0, game.player.z);
      sun.target.updateMatrixWorld();
    }
  }

  return {
    group,
    update,
    createBeacon,
    buildingCount: placements.length,
    treeCount: treeSpots.length,
    setShadowQuality(enabled, size) {
      sun.castShadow = enabled;
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.mapSize.set(size, size);
    },
  };
}
