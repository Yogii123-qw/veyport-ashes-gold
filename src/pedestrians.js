// pedestrians.js - Veyport's people: civilians and armed hostiles.
// Civilians walk the sidewalks, flee gunfire, and phone the police when
// they witness a crime (5 s call, cancelled if you leave the area).
// Hostiles (mission guards, gang members) stand their ground and shoot.
// Every pedestrian is ONE merged mesh (draw-call budget), animated by a
// walk bob, not by separate limbs.

import { mergeBoxes, groupAt } from './geo.js';

const THREE = window.THREE;
const MAX_CIVILIANS = 16;
const SHIRTS = [0xc03028, 0x2a5a8a, 0x2a7a3a, 0xd8b030, 0x7a4a8a, 0xd8d8d8, 0x222222, 0xc06030];
const SKINS = [0xc89878, 0x8a5a3a, 0xe8b898, 0x6a4a2a];
const PANTS = [0x2a2a3a, 0x3a3a3a, 0x4a3a2a, 0x2a3a4a];

function pedMesh(shirt, skin, pants, hostile) {
  const parts = [
    { w: 0.5, h: 0.6, d: 0.28, x: 0, y: 1.1, z: 0, color: shirt },
    { w: 0.3, h: 0.3, d: 0.3, x: 0, y: 1.58, z: 0, color: skin },
    { w: 0.2, h: 0.75, d: 0.22, x: -0.13, y: 0.38, z: 0, color: pants },
    { w: 0.2, h: 0.75, d: 0.22, x: 0.13, y: 0.38, z: 0, color: pants },
    { w: 0.14, h: 0.55, d: 0.16, x: -0.33, y: 1.12, z: 0, color: shirt },
    { w: 0.14, h: 0.55, d: 0.16, x: 0.33, y: 1.12, z: 0, color: shirt },
  ];
  if (hostile) {
    parts.push({ w: 0.08, h: 0.1, d: 0.45, x: 0.33, y: 1.15, z: 0.25, color: 0x1a1a1a });
  }
  const mesh = mergeBoxes(parts);
  mesh.castShadow = true;
  return mesh;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class PedSys {
  constructor(w) {
    this.w = w;
    this.peds = [];
    this.spawnTimer = 0;
  }

  get count() {
    return this.peds.length;
  }

  // A civilian near (x, z), walking a sidewalk lane.
  spawnCivilian(x, z) {
    const mesh = pedMesh(pick(SHIRTS), pick(SKINS), pick(PANTS), false);
    const g = groupAt(x, 0, z);
    g.add(mesh);
    this.w.scene.add(g);
    const ped = {
      kind: 'ped', x, z, heading: Math.random() * Math.PI * 2,
      speed: 1.1 + Math.random() * 0.7, state: 'walk',
      hp: 100, alive: true, radius: 0.6, armed: false, hostile: false,
      mesh: g, walkPhase: Math.random() * 6, fleeTimer: 0,
      witnessTimer: 0, witnessCrime: null, lane: this._pickLane(x, z),
      onHit: null,
      onDie: (t) => this._onCivilianDeath(t),
    };
    this.w.combat.register(ped);
    this.peds.push(ped);
    return ped;
  }

  // An armed hostile at (x, z): a mission guard or gang member.
  spawnHostile(x, z, hp = 100, name = 'guard') {
    const mesh = pedMesh(0x1a1a1a, pick(SKINS), 0x2a2a2a, true);
    const g = groupAt(x, 0, z);
    g.add(mesh);
    this.w.scene.add(g);
    const ped = {
      kind: 'hostile', name, x, z, heading: Math.random() * Math.PI * 2,
      speed: 3.0, state: 'fight',
      hp, alive: true, radius: 0.6, armed: true, hostile: true,
      mesh: g, walkPhase: Math.random() * 6, fleeTimer: 0,
      witnessTimer: 0, witnessCrime: null, lane: null,
      shootTimer: 0.8 + Math.random(),
      onHit: null,
      onDie: (t) => this._onHostileDeath(t),
    };
    this.w.combat.register(ped);
    this.peds.push(ped);
    return ped;
  }

  // A sidewalk lane: an avenue (multiple of 150) offset by 9 m, walking
  // along it. Lanes never cross buildings.
  _pickLane(x, z) {
    const avenue = (v) => Math.round(v / 150) * 150;
    const alongX = Math.random() < 0.5;
    if (alongX) {
      const zLane = avenue(z) + (Math.random() < 0.5 ? 9 : -9);
      return { axis: 'x', fixed: zLane, dir: Math.random() < 0.5 ? 1 : -1 };
    }
    const xLane = avenue(x) + (Math.random() < 0.5 ? 9 : -9);
    return { axis: 'z', fixed: xLane, dir: Math.random() < 0.5 ? 1 : -1 };
  }

  remove(ped) {
    this.w.combat.unregister(ped);
    this.w.scene.remove(ped.mesh);
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
  }

  _onCivilianDeath(t) {
    t.state = 'down';
    t.mesh.rotation.x = -Math.PI / 2;
    t.mesh.position.y = 0.25;
    this.w.combat.unregister(t);
    if (this.w.wanted) this.w.wanted.addHeat(15, 'kill-ped');
    setTimeout(() => this.remove(t), 15000);
  }

  _onHostileDeath(t) {
    t.state = 'down';
    t.mesh.rotation.x = -Math.PI / 2;
    t.mesh.position.y = 0.25;
    this.w.combat.unregister(t);
    if (this.w.wanted) this.w.wanted.addHeat(6, 'kill-hostile');
    setTimeout(() => this.remove(t), 15000);
  }

  // Gunfire / explosions nearby: civilians run, hostiles do not.
  onGunshot(x, z, radius = 55) {
    for (const p of this.peds) {
      if (!p.alive || p.hostile) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius && p.state === 'walk') {
        p.state = 'flee';
        p.fleeTimer = 4;
        p.heading = Math.atan2(p.x - x, p.z - z);
      }
    }
  }

  // A crime at (x, z): the nearest civilian who sees it starts phoning.
  onCrime(x, z, heatValue, kind) {
    let best = null, bestD = 40;
    for (const p of this.peds) {
      if (!p.alive || p.hostile || p.state !== 'walk') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return false;
    best.state = 'phone';
    best.witnessTimer = 5;
    best.witnessCrime = { heat: heatValue, kind };
    return true;
  }

  nearest(x, z, radius) {
    let best = null, bestD = radius;
    for (const p of this.peds) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  update(dt) {
    const w = this.w;
    const px = w.player.x, pz = w.player.z;
    // Maintain the civilian population near the player.
    this.spawnTimer -= dt;
    const civilians = this.peds.filter((p) => !p.hostile && p.alive).length;
    if (this.spawnTimer <= 0 && civilians < MAX_CIVILIANS) {
      this.spawnTimer = 0.8;
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 70;
      const x = Math.max(-600, Math.min(600, px + Math.cos(a) * r));
      const z = Math.max(-600, Math.min(600, pz + Math.sin(a) * r));
      this.spawnCivilian(x, z);
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (!p.alive) continue;
      // Despawn far civilians (never hostiles: missions own them).
      if (!p.hostile) {
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > 180) {
          this.remove(p);
          continue;
        }
      }
      if (p.state === 'phone') {
        p.witnessTimer -= dt;
        const playerFar = Math.hypot(p.x - px, p.z - pz) > 60;
        if (playerFar) {
          p.state = 'walk';
          p.witnessTimer = 0;
          p.witnessCrime = null;
        } else if (p.witnessTimer <= 0) {
          const crime = p.witnessCrime;
          p.state = 'walk';
          p.witnessCrime = null;
          if (crime && w.wanted) {
            w.wanted.addHeat(crime.heat, 'witness');
            if (w.ui) w.ui.notify(w.lang.t('witnessCall'), 'warn');
          }
        }
        continue;
      }
      if (p.state === 'flee') {
        p.fleeTimer -= dt;
        if (p.fleeTimer <= 0) {
          p.state = 'walk';
          p.lane = this._pickLane(p.x, p.z);
        }
      }
      if (p.state === 'fight') {
        this._fightStep(p, dt);
        continue;
      }
      // 'run' is owned by the mission system (the M5 traitor): its
      // position is set by missions.js, not by the walk logic.
      if (p.state === 'run') continue;
      // Walk the lane; at an intersection, sometimes turn onto a new lane.
      const speed = p.state === 'flee' ? 7 : p.speed;
      if (p.lane) {
        if (p.lane.axis === 'x') {
          p.z += (p.lane.fixed - p.z) * Math.min(1, dt * 3);
          p.x += p.lane.dir * speed * dt;
          p.heading = p.lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          if (Math.abs(p.x % 150) < 2 && Math.random() < 0.004) p.lane = this._pickLane(p.x, p.z);
        } else {
          p.x += (p.lane.fixed - p.x) * Math.min(1, dt * 3);
          p.z += p.lane.dir * speed * dt;
          p.heading = p.lane.dir > 0 ? 0 : Math.PI;
          if (Math.abs(p.z % 150) < 2 && Math.random() < 0.004) p.lane = this._pickLane(p.x, p.z);
        }
        p.x = Math.max(-610, Math.min(610, p.x));
        p.z = Math.max(-610, Math.min(610, p.z));
      }
      // Run over by the player's car.
      if (!w.player.onFoot && w.player.vehicle) {
        const v = w.player.vehicle;
        if (Math.hypot(p.x - v.x, p.z - v.z) < 1.8 && Math.abs(v.speed) > 3) {
          p.hp = 0;
          p.alive = false;
          p.onDie(p);
          if (w.wanted) w.wanted.addHeat(10, 'runover');
          continue;
        }
      }
      // Walk bob.
      p.walkPhase += dt * (2 + speed * 1.8);
      p.mesh.position.set(p.x, Math.abs(Math.sin(p.walkPhase)) * 0.06, p.z);
      p.mesh.rotation.y = p.heading;
    }
  }

  _fightStep(p, dt) {
    const w = this.w;
    const pl = w.player;
    const tx = pl.onFoot ? pl.x : (pl.vehicle ? pl.vehicle.x : pl.x);
    const tz = pl.onFoot ? pl.z : (pl.vehicle ? pl.vehicle.z : pl.z);
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    // Face the player, close distance if far, hold ground if close.
    p.heading = Math.atan2(dx, dz);
    if (d > 18) {
      p.x += (dx / d) * p.speed * dt;
      p.z += (dz / d) * p.speed * dt;
    } else if (d < 6) {
      p.x -= (dx / d) * p.speed * 0.5 * dt;
      p.z -= (dz / d) * p.speed * 0.5 * dt;
    }
    p.walkPhase += dt * 6;
    p.mesh.position.set(p.x, Math.abs(Math.sin(p.walkPhase)) * 0.04, p.z);
    p.mesh.rotation.y = p.heading;
    // Shoot on a timer when in range.
    p.shootTimer -= dt;
    if (p.shootTimer <= 0 && d < 42) {
      p.shootTimer = 1.3 + Math.random() * 0.9;
      if (w.combat) w.combat.npcShoot(p, tx, tz);
    }
  }
}
