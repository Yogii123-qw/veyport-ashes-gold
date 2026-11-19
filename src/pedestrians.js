// pedestrians.js — the people of Veyport.
//
// Walkers cross the sidewalks, cross at zebras, and run when they hear
// gunfire. A witness who watches a crime phones the police after five
// seconds — leave the area before the call completes and the heat never
// lands (SPEC §3.2). Gang members hold territory: Harbormen in the Docks,
// Foundry Kings in Foundry Row. They fight back when shot at or when a
// mission puts them in the player's way. Nobody here is decoration:
// every ped walks a real route, reacts to real events, and can be hurt.

import * as THREE from '../vendor/three.min.js';
import { box, mergeGeoms, stdMaterial } from './geo.js';

const WALKER_COUNT = 26;
const WALKER_SPEED = 1.4;
const FLEE_SPEED = 4.2;
const GANG_COLORS = {
  harbormen: { jacket: 0x2a4a6a, pants: 0x222222, skin: 0xc89878 },
  foundry: { jacket: 0x6a2a2a, pants: 0x2a2a2a, skin: 0xb88a68 },
};
const CIVILIAN_PALETTES = [
  { jacket: 0x5a6a3a, pants: 0x2a2d33, skin: 0xc89878 },
  { jacket: 0x8a5a2a, pants: 0x3a3f4a, skin: 0x8a5a3a },
  { jacket: 0x3a5a7a, pants: 0x222222, skin: 0xd8a888 },
  { jacket: 0x6a3a5a, pants: 0x2a2d33, skin: 0xc89878 },
  { jacket: 0x2a7a5a, pants: 0x4a4a48, skin: 0xa87a58 },
];

/** One low-poly person. Armed peds carry a visible gun in the hand. */
export function buildPersonMesh(opts = {}) {
  const c = opts.colors || CIVILIAN_PALETTES[0];
  const parts = [
    box(0.5, 0.62, 0.3, c.jacket, 0, 1.08, 0),
    box(0.3, 0.3, 0.28, c.skin, 0, 1.58, 0),
    box(0.32, 0.09, 0.3, 0x1a1a1a, 0, 1.74, 0),
    box(0.17, 0.55, 0.17, c.jacket, 0.32, 1.08, 0),
    box(0.17, 0.55, 0.17, c.jacket, -0.32, 1.08, 0),
    box(0.18, 0.55, 0.18, c.pants, -0.14, 0.38, 0),
    box(0.18, 0.55, 0.18, c.pants, 0.14, 0.38, 0),
  ];
  const group = new THREE.Group();
  const body = new THREE.Mesh(mergeGeoms(parts), stdMaterial());
  body.castShadow = true;
  group.add(body);
  if (opts.armed) {
    const gun = new THREE.Mesh(
      mergeGeoms([
        box(0.3, 0.07, 0.05, 0x1c1c20, 0.1, 0, 0),
        box(0.08, 0.14, 0.05, 0x6a4a2a, 0, -0.09, 0),
      ]),
      stdMaterial({ roughness: 0.4, metalness: 0.5 }),
    );
    gun.position.set(-0.32, 0.82, 0.12);
    group.add(gun);
  }
  return group;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPedestrians(scene, city, bus, deps = {}) {
  const rng = mulberry32(99173);
  const group = new THREE.Group();
  group.name = 'pedestrians';
  scene.add(group);
  const peds = [];
  let pedId = 1;
  const damagePlayer = deps.damagePlayer || (() => {});

  function makePed(kind, x, z, opts = {}) {
    const colors = opts.gang ? GANG_COLORS[opts.gang] : CIVILIAN_PALETTES[Math.floor(rng() * CIVILIAN_PALETTES.length)];
    const mesh = buildPersonMesh({ colors, armed: !!opts.armed });
    mesh.position.set(x, 0, z);
    group.add(mesh);
    const p = {
      id: pedId++,
      kind, // 'walker' | 'gang'
      gang: opts.gang || null,
      x, z,
      heading: rng() * Math.PI * 2,
      speed: 0,
      health: opts.health || 100,
      alive: true,
      armed: !!opts.armed,
      hostile: !!opts.hostile,
      state: 'walk',
      mesh,
      route: null,
      routeIdx: 0,
      walkPhase: rng() * 6,
      witnessTimer: -1,
      witnessPos: null,
      shootCooldown: 0,
      deadTimer: 0,
      despawn: 0,
    };
    peds.push(p);
    return p;
  }

  function assignWalkRoute(p) {
    const dest = city.randomRoadPoint(rng);
    p.route = city.route(p.x, p.z, dest.x, dest.z);
    p.routeIdx = 0;
  }

  function spawnWalkers() {
    for (let i = 0; i < WALKER_COUNT; i++) {
      const pt = city.randomRoadPoint(rng);
      const p = makePed('walker', pt.x, pt.z);
      assignWalkRoute(p);
    }
  }

  /** A spawn point on open ground: inside a building a ped is
   * unhittable (the wall blocks every shot while the ped inside can
   * still shoot out, chance-based) and the defeat stage soft-locks.
   * M3's guards spawned inside the chop shop and M6's inside the
   * lighthouse — both defeat stages could never complete. Walk a ring
   * of candidates out to 24 m and take the first point outside every
   * collider (low curbs under 1 m don't count, same as resolveCircle).
   * The guards end up in the forecourt, visible and hittable. */
  function clearSpawn(x, z) {
    const inside = (px, pz) => {
      for (const b of city.colliders) {
        if (b.height < 1) continue;
        if (px >= b.x0 - 0.6 && px <= b.x1 + 0.6 && pz >= b.z0 - 0.6 && pz <= b.z1 + 0.6) return true;
      }
      return false;
    };
    if (!inside(x, z)) return { x, z };
    for (const r of [4, 8, 12, 16, 20, 24]) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (!inside(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** Spawn armed gang members at a spot (missions + territory defence). */
  function spawnGang(gang, x, z, count, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const spot = clearSpawn(x + (rng() - 0.5) * 6, z + (rng() - 0.5) * 6);
      const p = makePed('gang', spot.x, spot.z, {
        gang, armed: true, hostile: opts.hostile !== false, health: opts.health || 100,
      });
      p.state = opts.hostile === false ? 'walk' : 'fight';
      out.push(p);
    }
    return out;
  }

  function nearestPed(x, z, maxDist, aliveOnly = true) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const p of peds) {
      if (aliveOnly && !p.alive) continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = p; }
    }
    return best;
  }

  function damage(p, amount, opts = {}) {
    if (!p.alive) return;
    p.health -= amount;
    if (opts.head) bus.emit('headshot', { ped: p });
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      p.state = 'dead';
      p.deadTimer = 12;
      // Fall flat: no gore, just a body on the ground.
      p.mesh.rotation.x = -Math.PI / 2;
      p.mesh.position.y = 0.25;
      bus.emit('ped-down', { ped: p, weapon: opts.weapon || null, head: !!opts.head });
    } else if (p.kind === 'gang') {
      p.hostile = true;
      p.state = 'fight';
    } else {
      p.state = 'flee';
    }
  }

  // ---------- Reactions to the event bus ----------
  function scareAt(x, z, radius) {
    for (const p of peds) {
      if (!p.alive || p.kind === 'gang') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) {
        p.state = 'flee';
        // A fleeing witness who saw the crime starts the 5-second call.
        if (p.witnessTimer < 0 && d < 26) {
          p.witnessTimer = 5;
          p.witnessPos = { x, z };
        }
      }
    }
  }
  bus.on('shot', ({ muzzle }) => { if (muzzle) scareAt(muzzle.x, muzzle.z, 30); });
  bus.on('crash', ({ x, z }) => { if (x !== undefined) scareAt(x, z, 18); });
  bus.on('vehicle-destroyed', ({ vehicle }) => { if (vehicle) scareAt(vehicle.x, vehicle.z, 35); });
  bus.on('kill', () => { /* witnesses are already scared by the shot */ });

  function update(dt, ctx) {
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      if (!p.alive) {
        p.deadTimer -= dt;
        if (p.deadTimer <= 0) {
          group.remove(p.mesh);
          peds.splice(i, 1);
        }
        continue;
      }
      // Witness call: 5 seconds, cancelled if the player gets far away.
      if (p.witnessTimer > 0) {
        p.witnessTimer -= dt;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > 45) {
          p.witnessTimer = -1; // escaped before the call went through
        } else if (p.witnessTimer <= 0) {
          p.witnessTimer = -1;
          bus.emit('witness', { x: p.witnessPos.x, z: p.witnessPos.z, ped: p });
        }
      }

      if (p.state === 'flee') {
        // Run directly away from the player, dodging buildings.
        const dx = p.x - px;
        const dz = p.z - pz;
        const d = Math.hypot(dx, dz) || 1;
        const nx = p.x + (dx / d) * FLEE_SPEED * dt;
        const nz = p.z + (dz / d) * FLEE_SPEED * dt;
        const res = city.resolveCircle(nx, nz, 0.5);
        p.x = res.x; p.z = res.z;
        p.heading = Math.atan2(dx, dz);
        p.speed = FLEE_SPEED;
        p.walkPhase += dt * 9;
        if (d > 55) {
          p.state = 'walk';
          assignWalkRoute(p);
        }
      } else if (p.state === 'fight') {
        // Hostile: close to 14 m, then shoot with real inaccuracy.
        const dx = px - p.x;
        const dz = pz - p.z;
        const d = Math.hypot(dx, dz);
        p.heading = Math.atan2(dx, dz);
        if (d > 14) {
          const nx = p.x + (dx / d) * 3.4 * dt;
          const nz = p.z + (dz / d) * 3.4 * dt;
          const res = city.resolveCircle(nx, nz, 0.5);
          p.x = res.x; p.z = res.z;
          p.speed = 3.4;
          p.walkPhase += dt * 7;
        } else {
          p.speed = 0;
          p.shootCooldown -= dt;
          if (p.shootCooldown <= 0) {
            p.shootCooldown = 0.9 + rng() * 0.7;
            bus.emit('shot', { weapon: 'p9', muzzle: { x: p.x, y: 1.3, z: p.z }, npc: true });
            // Inaccuracy grows with distance; point-blank still hurts.
            if (Math.random() < Math.max(0.12, 0.55 - d * 0.02)) {
              damagePlayer(6 + Math.floor(rng() * 6), 'gang');
            }
          }
        }
      } else {
        // Walk the route; pick a new destination at the end.
        if (!p.route || p.routeIdx >= p.route.length) {
          if (p.kind === 'walker') assignWalkRoute(p);
          else { p.speed = 0; }
        }
        if (p.route && p.routeIdx < p.route.length) {
          const t = p.route[p.routeIdx];
          const dx = t.x - p.x;
          const dz = t.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 3) { p.routeIdx += 1; }
          else {
            p.heading = Math.atan2(dx, dz);
            p.speed = WALKER_SPEED;
            const nx = p.x + (dx / d) * WALKER_SPEED * dt;
            const nz = p.z + (dz / d) * WALKER_SPEED * dt;
            const res = city.resolveCircle(nx, nz, 0.5);
            p.x = res.x; p.z = res.z;
            p.walkPhase += dt * 3.2;
          }
        }
      }

      // Density follows the hour: busy at 08:00 and 17:00, quiet at 03:00.
      // (Walkers already spawned stay; respawns refill the street.)
      p.mesh.position.set(p.x, 0, p.z);
      if (p.state !== 'dead') p.mesh.rotation.y = p.heading;
      const swing = Math.sin(p.walkPhase) * Math.min(1, p.speed / WALKER_SPEED) * 0.12;
      p.mesh.rotation.z = swing;
    }

    // Refill walkers if the street emptied (deaths, despawns).
    const walkers = peds.filter((p) => p.kind === 'walker' && p.alive).length;
    if (walkers < 14 && Math.random() < dt * 0.2) {
      const pt = city.randomRoadPoint(rng);
      // Spawn away from the player so nobody pops into view.
      if (Math.hypot(pt.x - px, pt.z - pz) > 60) {
        const p = makePed('walker', pt.x, pt.z);
        assignWalkRoute(p);
      }
    }
  }

  spawnWalkers();

  return {
    peds,
    update,
    damage,
    nearestPed,
    spawnGang,
    makePed,
    buildPersonMesh,
  };
}
