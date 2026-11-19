// effects.js — the particle pool and every visible effect in the game.
//
// One pooled THREE.Points cloud (2,000 particles, zero allocation per
// frame) plus a small pool of muzzle-flash sprites, shell casings and
// skid decals. Every effect is born from a real event on the bus —
// shots, impacts, crashes, drifts, engine damage, explosions — never
// from a timer that pretends something happened.

import * as THREE from '../vendor/three.min.js';

const MAX_PARTICLES = 2000;
const MAX_FLASHES = 8;
const MAX_CASINGS = 24;
const MAX_SKIDS = 60;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEffects(scene, bus) {
  const rng = mulberry32(4242);

  // ---------- Pooled particle cloud ----------
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
    sizeAttenuation: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const vel = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  let cursor = 0;
  let activeCount = 0;

  function spawn(x, y, z, vx, vy, vz, r, g, b, ttl, gravity = 4) {
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    life[i] = ttl;
    maxLife[i] = ttl;
    grav[i] = gravity;
  }

  function burst(x, y, z, n, speed, r, g, b, ttl, gravity = 4, up = 0.5) {
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const s = speed * (0.4 + rng() * 0.6);
      spawn(
        x, y, z,
        Math.cos(a) * s, (rng() * up + 0.2) * speed, Math.sin(a) * s,
        r, g, b, ttl * (0.6 + rng() * 0.6), gravity,
      );
    }
  }

  // ---------- Muzzle flash: pooled sprite + shared point light ----------
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.4, 'rgba(255,180,60,0.85)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  })();
  const flashLight = new THREE.PointLight(0xffc27a, 0, 16, 1.6);
  scene.add(flashLight);
  const flashes = [];
  for (let i = 0; i < MAX_FLASHES; i++) {
    const sm = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.9);
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sprite: sp, ttl: 0 });
  }
  let flashIdx = 0;

  function muzzleFlash(x, y, z, scale = 1) {
    const f = flashes[flashIdx];
    flashIdx = (flashIdx + 1) % MAX_FLASHES;
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(0.9 * scale);
    f.sprite.material.opacity = 1;
    f.sprite.visible = true;
    f.ttl = 0.06;
    flashLight.position.set(x, y, z);
    flashLight.intensity = 30 * scale;
  }

  // ---------- Shell casings: small pooled boxes that tumble and fade ----------
  const casings = [];
  const casingGeo = new THREE.BoxGeometry(0.05, 0.05, 0.12);
  const casingMat = new THREE.MeshStandardMaterial({ color: 0xc8a83c, metalness: 0.8, roughness: 0.35 });
  for (let i = 0; i < MAX_CASINGS; i++) {
    const m = new THREE.Mesh(casingGeo, casingMat);
    m.visible = false;
    scene.add(m);
    casings.push({ mesh: m, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, ttl: 0 });
  }
  let casingIdx = 0;

  function ejectCasing(x, y, z, rightX, rightZ) {
    const c = casings[casingIdx];
    casingIdx = (casingIdx + 1) % MAX_CASINGS;
    c.mesh.position.set(x, y, z);
    c.mesh.visible = true;
    c.vx = rightX * (1.2 + rng()) + (rng() - 0.5) * 0.6;
    c.vy = 1.6 + rng() * 0.8;
    c.vz = rightZ * (1.2 + rng()) + (rng() - 0.5) * 0.6;
    c.rx = (rng() - 0.5) * 12;
    c.rz = (rng() - 0.5) * 12;
    c.ttl = 1.1;
  }

  // ---------- Skid decals: dark quads that stay on the asphalt ----------
  const skidGeo = new THREE.PlaneGeometry(0.5, 1.6);
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false });
  const skids = [];
  for (let i = 0; i < MAX_SKIDS; i++) {
    const m = new THREE.Mesh(skidGeo, skidMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.09;
    m.visible = false;
    scene.add(m);
    skids.push({ mesh: m, ttl: 0 });
  }
  let skidIdx = 0;

  function skidMark(x, z, heading) {
    const s = skids[skidIdx];
    skidIdx = (skidIdx + 1) % MAX_SKIDS;
    s.mesh.position.set(x, 0.09, z);
    s.mesh.rotation.z = -heading;
    s.mesh.visible = true;
    s.ttl = 14; // tyre marks outlive the drift by a while
  }

  // ---------- Tracers: pooled lines from muzzle to impact ----------
  const tracers = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, ttl: 0 });
  }
  let tracerIdx = 0;

  function tracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.ttl = 0.07;
  }

  // ---------- Named effect spawners (one per real event) ----------
  function impactDust(x, y, z) {
    burst(x, y, z, 10, 2.2, 0.72, 0.68, 0.6, 0.5, 3);
  }
  function impactSparks(x, y, z) {
    burst(x, y, z, 12, 4.5, 1.0, 0.8, 0.25, 0.35, 9);
  }
  function glassShatter(x, y, z) {
    burst(x, y, z, 16, 2.8, 0.75, 0.9, 1.0, 0.7, 7);
  }
  function crashDebris(x, y, z) {
    burst(x, y, z, 22, 5, 0.6, 0.6, 0.62, 0.8, 6);
    burst(x, y, z, 8, 2, 1.0, 0.75, 0.3, 0.5, 2);
  }
  function engineSmoke(x, y, z) {
    burst(x, y + 0.8, z, 3, 0.7, 0.45, 0.45, 0.45, 1.4, -1.2);
  }
  function engineFire(x, y, z) {
    burst(x, y + 0.8, z, 6, 1.4, 1.0, 0.45, 0.1, 0.6, -1.5);
  }
  function explosion(x, y, z) {
    burst(x, y + 1, z, 46, 8, 1.0, 0.55, 0.15, 0.9, 5);
    burst(x, y + 1, z, 20, 3, 0.35, 0.35, 0.35, 1.6, -0.8);
    burst(x, y + 0.5, z, 14, 5, 1.0, 0.85, 0.4, 0.5, 6);
    flashLight.position.set(x, y + 1.5, z);
    flashLight.intensity = 90;
  }
  function driftSmoke(x, y, z) {
    burst(x, y + 0.2, z, 5, 0.9, 0.8, 0.8, 0.8, 0.9, -0.6);
  }
  function rainSplash(x, y, z) {
    burst(x, y + 0.05, z, 2, 0.8, 0.7, 0.8, 0.9, 0.3, 6);
  }
  function meleeArc(x, y, z, heading) {
    // A short white arc: 8 particles swung through the facing direction.
    for (let k = 0; k < 8; k++) {
      const a = heading - 0.7 + (k / 7) * 1.4;
      spawn(x + Math.sin(a) * 1.1, y + 1.1, z + Math.cos(a) * 1.1, 0, 0.4, 0, 1, 1, 1, 0.16, 0);
    }
  }

  // ---------- Bus reactions: effects follow events, never timers ----------
  bus.on('shot', ({ muzzle, weapon }) => {
    if (muzzle) muzzleFlash(muzzle.x, muzzle.y, muzzle.z, weapon === 'iron12' ? 1.4 : weapon === 'vk7' ? 1.2 : 1);
  });
  bus.on('impact', ({ x, y, z, material }) => {
    if (material === 'glass') glassShatter(x, y, z);
    else if (material === 'metal') impactSparks(x, y, z);
    else impactDust(x, y, z);
  });
  bus.on('hit', ({ x, y, z }) => {
    if (x !== undefined) burst(x, (y ?? 1) , z, 6, 2, 1.0, 0.9, 0.4, 0.3, 5);
  });
  bus.on('crash', ({ x, z }) => { if (x !== undefined) crashDebris(x, 0.8, z); });
  bus.on('vehicle-destroyed', ({ vehicle }) => { if (vehicle) explosion(vehicle.x, 0.5, vehicle.z); });
  bus.on('drift-smoke', ({ x, z, heading }) => {
    driftSmoke(x, 0.3, z);
    skidMark(x, z, heading);
  });
  bus.on('engine-smoke', ({ x, z }) => engineSmoke(x, 0.5, z));
  bus.on('engine-fire', ({ x, z }) => engineFire(x, 0.5, z));

  function update(dt) {
    // Particles: integrate, fade, park the dead at y = -100.
    activeCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = -100;
        continue;
      }
      vel[i * 3 + 1] -= grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02 && grav[i] > 0) {
        pos[i * 3 + 1] = 0.02;
        vel[i * 3 + 1] = 0;
        vel[i * 3] *= 0.9;
        vel[i * 3 + 2] *= 0.9;
      }
      activeCount += 1;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;

    // Tracers decay in one frame.
    for (const t of tracers) {
      if (t.ttl > 0) {
        t.ttl -= dt;
        if (t.ttl <= 0) {
          t.line.visible = false;
          t.line.material.opacity = 0;
        }
      }
    }

    // Muzzle flashes decay in one frame; the shared light fades fast.
    for (const f of flashes) {
      if (f.ttl > 0) {
        f.ttl -= dt;
        if (f.ttl <= 0) {
          f.sprite.visible = false;
          f.sprite.material.opacity = 0;
        }
      }
    }
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 900);

    // Casings tumble, land, and vanish.
    for (const c of casings) {
      if (c.ttl <= 0) continue;
      c.ttl -= dt;
      if (c.ttl <= 0) { c.mesh.visible = false; continue; }
      c.vy -= 9.8 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y = Math.max(0.05, c.mesh.position.y + c.vy * dt);
      c.mesh.position.z += c.vz * dt;
      if (c.mesh.position.y <= 0.06) { c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; }
      c.mesh.rotation.x += c.rx * dt;
      c.mesh.rotation.z += c.rz * dt;
    }

    // Skid marks fade after their lifetime.
    for (const s of skids) {
      if (s.ttl > 0) {
        s.ttl -= dt;
        if (s.ttl <= 0) s.mesh.visible = false;
      }
    }
  }

  return {
    update,
    tracer,
    muzzleFlash,
    ejectCasing,
    skidMark,
    impactDust,
    impactSparks,
    glassShatter,
    crashDebris,
    engineSmoke,
    engineFire,
    explosion,
    driftSmoke,
    rainSplash,
    meleeArc,
    burst,
    get activeParticles() { return activeCount; },
  };
}
