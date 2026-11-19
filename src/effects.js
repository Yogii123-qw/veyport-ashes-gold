// effects.js - pooled particles and one-shot visual effects.
// Two THREE.Points clouds (additive for sparks/flash, normal for smoke,
// dust and glass) share one 2000-particle pool each, so effects never
// allocate per frame. Every effect is born from a real event: a shot,
// an impact, a crash, an explosion, a skid.

const THREE = window.THREE;
const MAX_PARTICLES = 2000;

function makeCloud(scene, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  const size = new Float32Array(MAX_PARTICLES);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.PointsMaterial({
    size: 1, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
  });
  // Per-particle size needs a shader patch: keep it simple and scale the
  // whole cloud by a fixed size, varying alpha through color darkness.
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);
  return { geo, pos, col, points };
}

export class FxSys {
  constructor(scene) {
    this.scene = scene;
    this.glow = makeCloud(scene, true);
    this.dust = makeCloud(scene, false);
    this.glowParts = [];
    this.dustParts = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.glowParts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, r: 0, g: 0, b: 0 });
      this.dustParts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, r: 0, g: 0, b: 0 });
    }
    this.glowCursor = 0;
    this.dustCursor = 0;
    this.muzzleSprite = null;
    this.muzzleTimer = 0;
    this.rings = [];
    this.spawned = { bursts: 0, explosions: 0, muzzle: 0 };
  }

  _spawn(pool, parts, cursor, x, y, z, vx, vy, vz, life, r, g, b, grav, drag) {
    const i = cursor;
    const p = parts[i];
    p.life = life; p.max = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.grav = grav; p.drag = drag;
    p.r = r; p.g = g; p.b = b;
    const pos = pool.pos;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const col = pool.col;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    return (i + 1) % MAX_PARTICLES;
  }

  burst(x, y, z, opts = {}) {
    const n = opts.count || 12;
    const speed = opts.speed || 6;
    const up = opts.up || 2;
    const life = opts.life || 0.6;
    const color = opts.color || [1, 0.8, 0.4];
    const grav = opts.grav !== undefined ? opts.grav : -9;
    const drag = opts.drag !== undefined ? opts.drag : 1.5;
    const pool = opts.smoke ? this.dust : this.glow;
    const parts = opts.smoke ? this.dustParts : this.glowParts;
    let cursor = opts.smoke ? this.dustCursor : this.glowCursor;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      cursor = this._spawn(pool, parts, cursor,
        x, y, z,
        Math.cos(a) * s, up * (0.3 + Math.random()), Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.8),
        color[0], color[1], color[2], grav, drag);
    }
    if (opts.smoke) this.dustCursor = cursor;
    else this.glowCursor = cursor;
    this.spawned.bursts += 1;
  }

  // Muzzle flash: a bright sprite at the barrel + a few sparks.
  muzzle(x, y, z, dirX, dirZ) {
    if (!this.muzzleSprite) {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const c2 = canvas.getContext('2d');
      const grad = c2.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, 'rgba(255,240,180,1)');
      grad.addColorStop(0.4, 'rgba(255,180,60,0.85)');
      grad.addColorStop(1, 'rgba(255,120,20,0)');
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(canvas);
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.muzzleSprite = new THREE.Sprite(sm);
      this.muzzleSprite.scale.set(1.4, 1.4, 1);
      this.scene.add(this.muzzleSprite);
    }
    this.muzzleSprite.position.set(x + dirX * 0.5, y, z + dirZ * 0.5);
    this.muzzleSprite.material.opacity = 1;
    this.muzzleTimer = 0.06;
    this.burst(x + dirX * 0.4, y, z + dirZ * 0.4, { count: 5, speed: 9, up: 1, life: 0.25, color: [1, 0.75, 0.3] });
    this.spawned.muzzle += 1;
  }

  // Impact dust / sparks where a bullet lands.
  impact(x, y, z, hard) {
    if (hard) {
      this.burst(x, y, z, { count: 10, speed: 7, up: 3, life: 0.5, color: [1, 0.85, 0.5] });
    } else {
      this.burst(x, y, z, { count: 8, speed: 3, up: 1.5, life: 0.7, color: [0.75, 0.7, 0.6], smoke: true });
    }
  }

  // Glass shatters into pale shards that fall fast.
  glass(x, y, z) {
    this.burst(x, y, z, { count: 18, speed: 4, up: 1, life: 0.9, color: [0.85, 0.95, 1], smoke: true, grav: -14 });
  }

  // Tire smoke while drifting or burning out.
  tireSmoke(x, y, z) {
    this.burst(x, y, z, { count: 3, speed: 1.2, up: 1.6, life: 1.4, color: [0.45, 0.45, 0.45], smoke: true, grav: 1.2, drag: 0.6 });
  }

  // A crash throws orange sparks and grey smoke.
  crashSparks(x, y, z, strength) {
    const n = Math.min(26, 6 + Math.floor(strength));
    this.burst(x, y + 0.6, z, { count: n, speed: 8, up: 3, life: 0.6, color: [1, 0.7, 0.25] });
    this.burst(x, y + 0.8, z, { count: 6, speed: 2, up: 2, life: 1.2, color: [0.4, 0.4, 0.4], smoke: true, grav: 1 });
  }

  // Full explosion: flash, fire, smoke column, shockwave ring, light.
  explosion(x, y, z) {
    this.burst(x, y + 0.5, z, { count: 40, speed: 11, up: 5, life: 0.7, color: [1, 0.6, 0.15] });
    this.burst(x, y + 1.5, z, { count: 26, speed: 4, up: 7, life: 1.8, color: [0.3, 0.3, 0.3], smoke: true, grav: 2.5 });
    this.burst(x, y + 0.3, z, { count: 14, speed: 14, up: 1, life: 0.4, color: [1, 0.95, 0.6] });
    // Shockwave ring: a flat torus that grows and fades.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.4, z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, dur: 0.6 });
    this.spawned.explosions += 1;
  }

  update(dt) {
    const stepPool = (pool, parts) => {
      const pos = pool.pos;
      const col = pool.col;
      let any = false;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = parts[i];
        if (p.life <= 0) continue;
        any = true;
        p.life -= dt;
        if (p.life <= 0) {
          pos[i * 3 + 1] = -100;
          col[i * 3] = 0; col[i * 3 + 1] = 0; col[i * 3 + 2] = 0;
          continue;
        }
        const dragK = Math.exp(-p.drag * dt);
        p.vx *= dragK; p.vz *= dragK;
        p.vy = p.vy * dragK + p.grav * dt;
        pos[i * 3] += p.vx * dt;
        pos[i * 3 + 1] += p.vy * dt;
        pos[i * 3 + 2] += p.vz * dt;
        if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; p.vy = Math.abs(p.vy) * 0.3; }
        const fade = p.life / p.max;
        col[i * 3] = p.r * fade;
        col[i * 3 + 1] = p.g * fade;
        col[i * 3 + 2] = p.b * fade;
      }
      if (any) {
        pool.geo.attributes.position.needsUpdate = true;
        pool.geo.attributes.color.needsUpdate = true;
      }
    };
    stepPool(this.glow, this.glowParts);
    stepPool(this.dust, this.dustParts);
    if (this.muzzleSprite && this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      this.muzzleSprite.material.opacity = Math.max(0, this.muzzleTimer / 0.06);
      if (this.muzzleTimer <= 0) this.muzzleSprite.material.opacity = 0;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = 1 + k * 22;
      r.mesh.scale.set(s, s, 1);
      r.mesh.material.opacity = 0.8 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
