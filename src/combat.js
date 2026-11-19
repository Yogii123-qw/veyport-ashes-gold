// combat.js - shooting, melee, and damage resolution (F6).
// Every shot is a real ray: origin at the player's hand, direction from
// the camera yaw, first hit wins. Muzzle flash (sprite + the player's
// light), tracers, impact dust/sparks, shell casings, glass shatter on
// shop fronts, hitmarkers, per-weapon fire rates, and headshots by
// geometry (a centered hit on an armed target counts double).

const THREE = window.THREE;

const FIRE_INTERVAL = {
  pistol: 0.28, smg: 0.09, scattergun: 0.9, rifle: 0.11, melee: 0.45,
};

const GLASS_FRONTS = [
  // Thin boxes on the street-facing side of the bar and the gun shop.
  // The bar sits 24 m northwest of its landmark point and the gun shop
  // 24 m southeast of its, so the glass follows them to their faces.
  { x0: 265, z0: -167, x1: 287, z1: -165, name: 'bar' },
  { x0: 465, z0: 30, x1: 483, z1: 32, name: 'gunshop' },
];

// Ray vs AABB (slab test) in 2D + height band. Returns distance or Infinity.
function rayHitBox(ox, oz, dx, dz, b) {
  let t0 = 0, t1 = Infinity;
  const axes = [[ox, dx, b.x0, b.x1], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export class CombatSys {
  constructor(w) {
    this.w = w;
    this.targets = [];
    this.cooldown = 0;
    this.meleeTimer = 0;
    this.casings = [];
    this.tracers = [];
    this.tracerTimer = [];
    if (w.scene) {
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.05, 0.12),
          new THREE.MeshLambertMaterial({ color: 0xd8b030 }),
        );
        m.visible = false;
        w.scene.add(m);
        this.casings.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
      }
      for (let i = 0; i < 4; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0 }));
        line.frustumCulled = false;
        w.scene.add(line);
        this.tracers.push(line);
        this.tracerTimer.push(0);
      }
    }
    this.tracerIdx = 0;
  }

  register(t) {
    if (!this.targets.includes(t)) this.targets.push(t);
  }

  unregister(t) {
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
  }

  // Aim direction: the camera yaw, horizontal. Aiming snaps the player
  // to face the same way, so the gun points where the camera looks.
  aimDir() {
    const yaw = this.w.rig ? this.w.rig.yaw : this.w.player.heading;
    return { x: Math.sin(yaw), z: Math.cos(yaw), yaw };
  }

  // Called every step while the fire button is held. Semi-auto weapons
  // fire once per press interval; autos fire while held.
  tryShoot() {
    const p = this.w.player;
    if (!p.onFoot || p.enterTimer > 0) return null;
    if (this.cooldown > 0) return null;
    const def = p.weaponDef();
    if (def.kind === 'melee') return this.melee();
    const res = p.fire();
    if (res !== 'fired') {
      if (res === 'dry' && this.w.ui) this.w.ui.notify(this.w.lang.t('noAmmo'), 'warn');
      return res;
    }
    this.cooldown = FIRE_INTERVAL[def.kind] || 0.25;
    this.resolveShot(def);
    return 'fired';
  }

  resolveShot(def) {
    const w = this.w;
    const p = w.player;
    const dir = this.aimDir();
    p.heading = dir.yaw;
    p.group.rotation.y = dir.yaw;
    const ox = p.x + dir.x * 0.5;
    const oz = p.z + dir.z * 0.5;
    const oy = 1.25;
    const range = def.range;
    // Muzzle flash + shot sound (pan by camera-relative direction).
    if (w.fx) w.fx.muzzle(ox, oy, oz, dir.x, dir.z);
    if (w.audio) w.audio.shot(def.kind, 0);
    this._ejectCasing(ox, oy, oz, dir);
    if (w.stats) w.stats.shots += 1;
    const pellets = def.pellets || 1;
    let anyHit = false;
    for (let i = 0; i < pellets; i++) {
      const spread = pellets > 1 ? (Math.random() - 0.5) * 0.09 : (Math.random() - 0.5) * 0.012;
      const a = dir.yaw + spread;
      const dx = Math.sin(a), dz = Math.cos(a);
      const hit = this._ray(ox, oy, oz, dx, dz, range, def, pellets);
      if (hit) anyHit = true;
    }
    // Camera kick: a small trauma bump on every shot (F6 recoil feel).
    if (w.rig) w.rig.addTrauma(0.045, 0, 2, true);
    return anyHit;
  }

  // One ray. Returns the hit record or null.
  _ray(ox, oy, oz, dx, dz, range, def, pellets) {
    const w = this.w;
    let best = null;
    let bestD = range;
    // Targets: nearest circle hit along the ray. Vehicles use their
    // damage pool (skip when wrecked); people use hp/alive.
    for (const t of this.targets) {
      if (t.wrecked) continue;
      if (t.hp !== undefined && (t.hp <= 0 || t.alive === false)) continue;
      const rx = t.x - ox, rz = t.z - oz;
      const along = rx * dx + rz * dz;
      if (along < 0 || along > bestD) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      const radius = t.radius || 0.6;
      if (perp > radius) continue;
      best = { kind: 'target', t, d: along, perp, radius };
      bestD = along;
    }
    // Buildings stop the ray (unless it is a glass front, which shatters).
    for (const b of this.w.colliders) {
      const d = rayHitBox(ox, oz, dx, dz, b);
      if (d < bestD) {
        best = { kind: 'wall', d };
        bestD = d;
      }
    }
    // Glass fronts: the ray passes through after shattering.
    for (const g of GLASS_FRONTS) {
      const d = rayHitBox(ox, oz, dx, dz, g);
      if (d < bestD && d < range) {
        if (w.fx) w.fx.glass(ox + dx * d, 1.3, oz + dz * d);
        if (w.audio) w.audio.glass();
        best = { kind: 'glass', d };
        bestD = d;
        break;
      }
    }
    const endX = ox + dx * bestD;
    const endZ = oz + dz * bestD;
    this._tracer(ox, oy, oz, endX, 1.1, endZ);
    if (!best) return null;
    if (best.kind === 'target') {
      const t = best.t;
      let dmg = def.damage;
      // Falloff: -35% at max range.
      dmg *= 1 - 0.35 * (best.d / def.range);
      // Headshot by geometry: a centered hit on an armed target doubles.
      let headshot = false;
      if (t.armed && best.perp < best.radius * 0.3) {
        dmg *= 2;
        headshot = true;
      }
      if (pellets > 1) dmg /= pellets;
      dmg = Math.max(1, Math.round(dmg));
      this._damageTarget(t, dmg, headshot);
      if (w.stats) w.stats.hits += 1;
      if (w.ui) w.ui.hitmarker(t.hp <= 0);
      if (w.audio) w.audio.hitmarker(t.hp <= 0);
      return { target: t, damage: dmg, headshot };
    }
    if (best.kind === 'wall') {
      if (w.fx) w.fx.impact(endX, 1.1, endZ, true);
      return { wall: true };
    }
    if (best.kind === 'glass') {
      if (w.fx) w.fx.impact(endX, 1.1, endZ, false);
      return { glass: true };
    }
    return null;
  }

  _damageTarget(t, dmg, headshot) {
    const w = this.w;
    if (t.truckHp !== undefined) {
      t.truckHp -= dmg;
      if (t.truckHp <= 0 && !t.wrecked) {
        t.wrecked = true;
        t.speed = 0;
        if (w.fx) w.fx.explosion(t.x, 1, t.z);
        if (w.audio) w.audio.explosion();
        if (w.ui) w.ui.notify(w.lang.t('truckStopped'), 'good');
      }
      if (t.onHit) t.onHit(dmg, headshot);
      return;
    }
    if (t.damage !== undefined && t.def) {
      // A vehicle: damage is its 0-100 integrity pool.
      t.damage -= dmg * 0.4;
      if (t.damage <= 0) {
        t.damage = 0;
        t.wrecked = true;
        t.speed = 0;
        if (w.fx) w.fx.explosion(t.x, 1, t.z);
        if (w.audio) w.audio.explosion();
        if (t.onDie) t.onDie(t);
      }
      if (t.onHit) t.onHit(dmg, headshot);
      return;
    }
    t.hp -= dmg;
    if (t.onHit) t.onHit(dmg, headshot);
    if (t.hp <= 0) {
      t.alive = false;
      if (t.onDie) t.onDie(t);
    }
  }

  // Melee swing: everything in a 2.2 m arc in front takes damage.
  melee() {
    if (this.meleeTimer > 0) return null;
    this.meleeTimer = FIRE_INTERVAL.melee;
    const w = this.w;
    const p = w.player;
    const dir = this.aimDir();
    p.heading = dir.yaw;
    p.group.rotation.y = dir.yaw;
    if (w.audio) w.audio.shot('melee', 0);
    let hitAny = false;
    for (const t of this.targets) {
      if (t.wrecked) continue;
      if (t.hp !== undefined && (t.hp <= 0 || t.alive === false)) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.2) continue;
      const dot = (dx * dir.x + dz * dir.z) / Math.max(0.01, d);
      if (dot < 0.5) continue;
      this._damageTarget(t, 15, false);
      hitAny = true;
      if (w.fx) w.fx.impact(t.x, 1.2, t.z, false);
      if (w.ui) w.ui.hitmarker(t.hp <= 0);
    }
    return hitAny ? 'melee-hit' : 'melee';
  }

  // An NPC shoots at a point (usually the player). Returns true on hit.
  npcShoot(shooter, tx, tz) {
    const w = this.w;
    const dx = tx - shooter.x, dz = tz - shooter.z;
    const d = Math.hypot(dx, dz);
    if (d > 45 || d < 0.5) return false;
    const a = Math.atan2(dx, dz);
    const ox = shooter.x + Math.sin(a) * 0.6;
    const oz = shooter.z + Math.cos(a) * 0.6;
    this._tracer(ox, 1.3, oz, tx + (Math.random() - 0.5) * 2, 1.2, tz + (Math.random() - 0.5) * 2);
    if (w.fx) w.fx.muzzle(ox, 1.3, oz, Math.sin(a), Math.cos(a));
    if (w.audio) w.audio.shot('pistol', 0);
    // Hit chance falls with distance; the player can dodge by moving.
    const p = w.player;
    const moving = p.onFoot ? p.speed : Math.abs(p.vehicle ? p.vehicle.speed : 0);
    let chance = 0.3 - d * 0.004 - moving * 0.008;
    if (Math.random() < Math.max(0.05, chance)) {
      this.damagePlayer(8 + Math.floor(Math.random() * 5));
      return true;
    }
    return false;
  }

  // Armor absorbs 60% of incoming damage, then health takes the rest.
  damagePlayer(amount) {
    const p = this.w.player;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, amount * 0.6);
      p.armor -= absorbed;
      p.hp -= (amount - absorbed);
    } else {
      p.hp -= amount;
    }
    if (this.w.rig) this.w.rig.addTrauma(0.12, 0, 3, true);
  }

  _ejectCasing(ox, oy, oz, dir) {
    const c = this.casings.find((x) => x.life <= 0);
    if (!c) return;
    const rightX = -dir.z, rightZ = dir.x;
    c.mesh.position.set(ox + rightX * 0.3, oy, oz + rightZ * 0.3);
    c.mesh.visible = true;
    c.vx = rightX * 1.6 + (Math.random() - 0.5);
    c.vy = 2.2 + Math.random();
    c.vz = rightZ * 1.6 + (Math.random() - 0.5);
    c.life = 1.4;
  }

  _tracer(x0, y0, z0, x1, y1, z1) {
    if (this.tracers.length === 0) return;
    const line = this.tracers[this.tracerIdx];
    const idx = this.tracerIdx;
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const pos = line.geometry.attributes.position.array;
    pos[0] = x0; pos[1] = y0; pos[2] = z0;
    pos[3] = x1; pos[4] = y1; pos[5] = z1;
    line.geometry.attributes.position.needsUpdate = true;
    line.material.opacity = 0.9;
    this.tracerTimer[idx] = 0.08;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.meleeTimer > 0) this.meleeTimer -= dt;
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.visible = false;
        continue;
      }
      c.vy -= 9.8 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      if (c.mesh.position.y < 0.05) {
        c.mesh.position.y = 0.05;
        c.vy = 0; c.vx *= 0.8; c.vz *= 0.8;
      }
      c.mesh.rotation.x += dt * 9;
      c.mesh.rotation.z += dt * 7;
    }
    for (let i = 0; i < this.tracers.length; i++) {
      if (this.tracerTimer[i] > 0) {
        this.tracerTimer[i] -= dt;
        if (this.tracerTimer[i] <= 0) this.tracers[i].material.opacity = 0;
      }
    }
  }
}
