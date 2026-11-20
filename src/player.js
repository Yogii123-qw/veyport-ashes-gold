// player.js - Rook Calloway on foot.
// Walk 5.0 m/s, run 8.5 m/s (F2 hold-to-run: Shift or the touch RUN button).
// Starts with fists AND a P9 Sidearm with ammo, and the gun is VISIBLE in his
// hand (F1). Entering a car takes 0.6 s, leaving 0.4 s. Exits at the car's
// side (local +X), never through the body.

const THREE = window.THREE;

export const WALK_SPEED = 5.0;
export const RUN_SPEED = 8.5;
export const ENTER_TIME = 0.6;
export const EXIT_TIME = 0.4;

export const WEAPONS = {
  fists: { name: 'Tinju', kind: 'melee', damage: 15, range: 2, mag: Infinity, reserve: Infinity, auto: false, reload: 0 },
  p9: { name: 'P9 Sidearm', kind: 'pistol', damage: 25, range: 40, mag: 12, reserve: 48, auto: false, reload: 1.1 },
  kr9: { name: 'KR-9 Ripper', kind: 'smg', damage: 16, range: 30, mag: 30, reserve: 60, auto: true, reload: 1.6 },
  iron12: { name: 'Iron-12', kind: 'scattergun', damage: 8, range: 15, mag: 6, reserve: 12, auto: false, reload: 2.2, pellets: 6 },
  vk7: { name: 'VK-7 Carbine', kind: 'rifle', damage: 40, range: 80, mag: 30, reserve: 40, auto: true, reload: 1.9 },
};

function weaponMesh(kind) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x555555 });
  if (kind === 'pistol') {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
    grip.position.set(0, -0.05, 0);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.3), steel);
    barrel.position.set(0, 0.04, 0.14);
    g.add(grip, barrel);
  } else if (kind === 'smg') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.5), dark);
    body.position.set(0, 0, 0.1);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), steel);
    mag.position.set(0, -0.12, 0.05);
    g.add(body, mag);
  } else if (kind === 'scattergun') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.02, 0.2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.3), dark);
    stock.position.set(0, -0.02, -0.15);
    g.add(tube, stock);
  } else if (kind === 'rifle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.75), dark);
    body.position.set(0, 0, 0.15);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), steel);
    scope.position.set(0, 0.09, 0.05);
    g.add(body, scope);
  }
  return g;
}

export function buildPlayerMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xc89878 });
  const jacket = new THREE.MeshLambertMaterial({ color: 0x3a4a3a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const boots = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), jacket);
  torso.position.y = 1.12;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  cap.position.y = 1.8;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), pants);
  legL.position.set(-0.14, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), jacket);
  armL.position.set(-0.36, 1.14, 0);
  const armR = armL.clone();
  armR.position.x = 0.36;
  // Right hand holds the weapon: the hand group sits at the arm's end and
  // points forward (+Z of the player) so the gun reads from the chase cam.
  const hand = new THREE.Group();
  hand.position.set(0.36, 0.86, 0.12);
  g.add(torso, head, cap, legL, legR, armL, armR, hand);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, legL, legR, armL, armR, hand };
}

export class Player {
  constructor(x, z, heading) {
    const mesh = buildPlayerMesh();
    this.group = mesh.group;
    this.parts = mesh;
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0;
    this.hp = 100;
    this.armor = 0;
    this.money = 800;
    this.onFoot = true;
    this.vehicle = null;
    this.enterTimer = 0;
    this.enterTarget = null;
    this.exitTimer = 0;
    this.walkPhase = 0;
    this.aiming = false;
    this.moveLock = null; // R4-E: locked walk direction, see step().
    // F1: starts armed - fists plus a P9 with ammo.
    this.owned = {
      fists: { mag: Infinity, reserve: Infinity },
      p9: { mag: 12, reserve: 48 },
    };
    this.weapon = 'p9';
    this.reloading = 0;
    this.flash = null;
    this.showWeapon();
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
  }

  weaponDef() {
    return WEAPONS[this.weapon];
  }

  showWeapon() {
    // Swap the visible in-hand mesh to match the equipped weapon.
    while (this.parts.hand.children.length > 0) {
      this.parts.hand.remove(this.parts.hand.children[0]);
    }
    const kind = this.weaponDef().kind;
    if (kind !== 'melee') {
      const wm = weaponMesh(kind);
      wm.rotation.x = -Math.PI / 2 + 0.35; // barrel forward, slightly raised
      this.parts.hand.add(wm);
    }
  }

  switchWeapon(id) {
    if (!this.owned[id] || this.weapon === id) return false;
    this.weapon = id;
    this.reloading = 0;
    this.showWeapon();
    return true;
  }

  giveWeapon(id, magAmmo, reserveAmmo) {
    this.owned[id] = { mag: magAmmo, reserve: reserveAmmo };
  }

  // Fire one shot (phase B combat resolves hits; here: ammo, flash, kick).
  // Returns 'fired' | 'dry' | 'reloading' | 'melee' | null.
  fire() {
    if (!this.onFoot || this.enterTimer > 0) return null;
    const def = this.weaponDef();
    if (this.reloading > 0) return 'reloading';
    if (def.kind === 'melee') return 'melee';
    const slot = this.owned[this.weapon];
    if (slot.mag <= 0) return 'dry';
    slot.mag -= 1;
    // Muzzle flash: a brief point light at the hand.
    if (!this.flash) {
      this.flash = new THREE.PointLight(0xffc860, 0, 7, 1.5);
      this.group.add(this.flash);
      this.flash.position.set(0.36, 1.0, 0.6);
    }
    this.flash.intensity = 3.2;
    return 'fired';
  }

  reload() {
    const def = this.weaponDef();
    if (def.kind === 'melee' || this.reloading > 0) return;
    const slot = this.owned[this.weapon];
    if (slot.mag >= def.mag || slot.reserve <= 0) return;
    this.reloading = def.reload;
  }

  tryEnter(cars) {
    if (!this.onFoot || this.enterTimer > 0) return null;
    let best = null, bestD = 3.6;
    for (const c of cars) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return null;
    this.enterTarget = best;
    this.enterTimer = ENTER_TIME;
    return best;
  }

  tryExit() {
    if (this.onFoot || !this.vehicle || this.exitTimer > 0) return false;
    this.exitTimer = EXIT_TIME;
    return true;
  }

  step(dt, ctrl, colliders, camYaw) {
    if (this.flash) {
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 22);
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const def = this.weaponDef();
        const slot = this.owned[this.weapon];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    // Entering a car: walk the timer, then attach.
    if (this.enterTimer > 0) {
      this.enterTimer -= dt;
      if (this.enterTimer <= 0) {
        this.enterTimer = 0;
        this.vehicle = this.enterTarget;
        this.enterTarget = null;
        this.onFoot = false;
        this.group.visible = false;
      }
      return;
    }
    if (this.exitTimer > 0) {
      this.exitTimer -= dt;
      if (this.exitTimer <= 0) {
        this.exitTimer = 0;
        const v = this.vehicle;
        this.vehicle = null;
        this.onFoot = true;
        this.group.visible = true;
        // Step out at the car's side (local +X).
        this.x = v.x + Math.cos(v.heading) * 2.2;
        this.z = v.z - Math.sin(v.heading) * 2.2;
        this.heading = v.heading;
      }
      return;
    }
    if (!this.onFoot) {
      this.moveLock = null;
      return;
    }
    // Camera-relative movement: joystick up = away from camera.
    // Forward on screen is (sin(camYaw), cos(camYaw)): the chase camera
    // sits behind the player at (-sin, -cos) * dist and looks along
    // (sin, cos), so pushing up must move the player along (sin, cos).
    // The old sign (-sin, -cos) walked the player INTO the camera and
    // spun heading/camera in a feedback loop (measured: 0.25 m in 3 s,
    // heading spinning ~1 rev/s).
    const mx = ctrl.moveX || 0, my = ctrl.moveY || 0;
    const mag = Math.hypot(mx, my);
    const running = ctrl.run === true;
    const target = running ? RUN_SPEED : WALK_SPEED;
    if (mag > 0.08) {
      const nx = mx / Math.max(1, mag), ny = my / Math.max(1, mag);
      // my>0 means joystick pushed up = forward on screen.
      const fwdX = Math.sin(camYaw), fwdZ = Math.cos(camYaw);
      const rightX = -fwdZ, rightZ = fwdX;
      const dx = rightX * nx + fwdX * ny;
      const dz = rightZ * nx + fwdZ * ny;
      // Movement-direction lock (R4-E): the walk direction is fixed
      // in world space while the stick is held. The thumb's own angle
      // (in camera space) re-locks it only when the thumb itself
      // moves (over ~30 deg) or the stick is re-centered. Without
      // this, the walk direction rotates with the camera as it swings
      // behind the player, the player keeps turning, and the camera
      // can never settle behind them: the pair would rotate together
      // at the chase cap forever. With the lock, the player's heading
      // is a stable target and the camera swings behind it and stops.
      const thumbAngle = Math.atan2(nx, ny);
      const dirLen = Math.hypot(dx, dz) || 1;
      if (!this.moveLock) {
        this.moveLock = { thumb: thumbAngle, dx: dx / dirLen, dz: dz / dirLen };
      } else {
        let dThumb = thumbAngle - this.moveLock.thumb;
        while (dThumb > Math.PI) dThumb -= 2 * Math.PI;
        while (dThumb < -Math.PI) dThumb += 2 * Math.PI;
        if (Math.abs(dThumb) > 0.5) {
          this.moveLock = { thumb: thumbAngle, dx: dx / dirLen, dz: dz / dirLen };
        }
      }
      const wdx = this.moveLock.dx, wdz = this.moveLock.dz;
      const want = Math.min(1, mag) * target;
      this.speed += (want - this.speed) * Math.min(1, dt * 10);
      const stepLen = this.speed * dt;
      let px = this.x + wdx * stepLen;
      let pz = this.z + wdz * stepLen;
      // Circle vs building AABB.
      const r = 0.5;
      for (const b of colliders) {
        const qx = Math.max(b.x0, Math.min(px, b.x1));
        const qz = Math.max(b.z0, Math.min(pz, b.z1));
        const ddx = px - qx, ddz = pz - qz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < r * r && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          px = qx + (ddx / d) * r;
          pz = qz + (ddz / d) * r;
        }
      }
      px = Math.max(-640, Math.min(640, px));
      pz = Math.max(-640, Math.min(640, pz));
      this.x = px; this.z = pz;
      const face = Math.atan2(wdx, wdz);
      let dh = face - this.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      this.heading += dh * Math.min(1, dt * 12);
    } else {
      this.speed += (0 - this.speed) * Math.min(1, dt * 10);
      this.moveLock = null;
    }
    // Walk cycle.
    this.walkPhase += dt * (2 + this.speed * 1.6);
    const swing = Math.min(1, this.speed / WALK_SPEED) * 0.55;
    const s = Math.sin(this.walkPhase);
    this.parts.legL.rotation.x = s * swing;
    this.parts.legR.rotation.x = -s * swing;
    this.parts.armL.rotation.x = -s * swing * 0.7;
    this.parts.armR.rotation.x = this.aiming ? -1.2 : s * swing * 0.7;
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }
}
