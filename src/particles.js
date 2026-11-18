// Particles, skid marks and shockwaves — all pooled, no allocation per
// frame, every effect born from a real event (a crash, a shot, an
// explosion, rain). One THREE.Points cloud of 2,000 slots serves smoke,
// fire, sparks, glass, splashes and dust; skid marks are pooled ground
// decals that fade; shockwaves are pooled expanding rings.

import * as THREE from 'three';

const MAX_PARTICLES = 2000;
const MAX_SKIDS = 240;
const MAX_RINGS = 12;

export function createParticles(game) {
  const scene = game.scene;
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const gravity = new Float32Array(MAX_PARTICLES);
  const drag = new Float32Array(MAX_PARTICLES);
  const baseSize = new Float32Array(MAX_PARTICLES);
  const baseColor = new Float32Array(MAX_PARTICLES * 3);
  let cursor = 0;
  let activeCount = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('psize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({
    size: 1, vertexColors: true, transparent: true, opacity: 0.9,
    depthWrite: false, sizeAttenuation: false,
  });
  // Per-particle size needs a shader tweak: encode size in a custom chunk.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float psize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = psize * (300.0 / -mvPosition.z);');
  };
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    positions[i * 3 + 1] = -100;
    sizes[i] = 0;
  }

  const tmpColor = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, seconds, size, hex, grav, dragK) {
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    life[i] = seconds;
    maxLife[i] = seconds;
    baseSize[i] = size;
    sizes[i] = size;
    gravity[i] = grav;
    drag[i] = dragK;
    tmpColor.set(hex);
    baseColor[i * 3] = tmpColor.r;
    baseColor[i * 3 + 1] = tmpColor.g;
    baseColor[i * 3 + 2] = tmpColor.b;
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  function burst(x, y, z, count, opt) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = opt.speed * (0.4 + Math.random() * 0.8);
      spawn(
        x + (Math.random() - 0.5) * (opt.spread || 0.4),
        y + (Math.random() - 0.5) * (opt.spread || 0.4),
        z + (Math.random() - 0.5) * (opt.spread || 0.4),
        Math.cos(angle) * speed + (opt.vx || 0),
        (opt.vy || 0) + Math.random() * opt.speed * 0.6,
        Math.sin(angle) * speed + (opt.vz || 0),
        opt.life * (0.6 + Math.random() * 0.7),
        opt.size * (0.7 + Math.random() * 0.6),
        opt.color,
        opt.gravity ?? -4,
        opt.drag ?? 1.5,
      );
    }
  }

  // Skid marks: pooled dark quads laid flat on the asphalt.
  const skidGeo = new THREE.PlaneGeometry(0.35, 1.4);
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false });
  const skids = [];
  for (let i = 0; i < MAX_SKIDS; i += 1) {
    const mesh = new THREE.Mesh(skidGeo, skidMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    skids.push({ mesh, age: 0 });
  }
  let skidCursor = 0;

  // Shockwave rings.
  const rings = [];
  for (let i = 0; i < MAX_RINGS; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.12, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc35c, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, age: 0, max: 1 });
  }
  let ringCursor = 0;

  // Muzzle flash: pooled additive sprites (one shared radial texture)
  // plus ONE shared point light that jumps to the latest shot and dies
  // in 80 ms. One light, not one per shot, keeps phones fast.
  const flashTexture = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.35, 'rgba(255,220,140,0.9)');
    grad.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();
  const flashes = [];
  for (let i = 0; i < 8; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: flashTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    flashes.push({ sprite, life: 0, maxLife: 0.07 });
  }
  let flashCursor = 0;
  const flashLight = new THREE.PointLight(0xffc35c, 0, 10, 2);
  scene.add(flashLight);
  let flashLightLife = 0;
  let flashCount = 0;

  // Shell casings: pooled brass boxes that eject, bounce once, and fade.
  const casingGeo = new THREE.BoxGeometry(0.05, 0.12, 0.05);
  const casings = [];
  for (let i = 0; i < 12; i += 1) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a848, roughness: 0.35, metalness: 0.8, transparent: true });
    const mesh = new THREE.Mesh(casingGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    casings.push({ mesh, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, life: 0 });
  }
  let casingCursor = 0;
  let casingCount = 0;

  // Rain: its own Points cloud, recycled above the player.
  const RAIN_COUNT = 900;
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    rainPos[i * 3] = (Math.random() - 0.5) * 90;
    rainPos[i * 3 + 1] = Math.random() * 40;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 90;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0xaac4d8, size: 0.14, transparent: true, opacity: 0, depthWrite: false });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  return {
    smoke(x, y, z, count) { burst(x, y, z, count || 6, { speed: 1.6, life: 1.1, size: 1.6, color: 0x8a8a8a, gravity: 2.2, drag: 1.2, vy: 1.4 }); },
    tireSmoke(x, y, z, vx, vz) { burst(x, y, z, 3, { speed: 1.2, life: 0.8, size: 1.3, color: 0xbbbbbb, gravity: 1.5, drag: 2, vx: vx * 0.2, vz: vz * 0.2, vy: 0.6 }); },
    fire(x, y, z, count) { burst(x, y, z, count || 8, { speed: 1.4, life: 0.6, size: 1.5, color: 0xff7a2a, gravity: 3.5, drag: 1, vy: 2.4 }); },
    explosion(x, y, z) {
      burst(x, y, z, 60, { speed: 9, life: 0.7, size: 2.6, color: 0xffa03c, gravity: 1, drag: 2.2, spread: 1.2, vy: 3 });
      burst(x, y, z, 40, { speed: 5, life: 1.6, size: 2.8, color: 0x555555, gravity: 2.5, drag: 1.4, spread: 1, vy: 3 });
      burst(x, y, z, 24, { speed: 14, life: 0.5, size: 0.7, color: 0xffe9a8, gravity: -12, drag: 0.6, spread: 0.6 });
      const ring = rings[ringCursor];
      ringCursor = (ringCursor + 1) % MAX_RINGS;
      ring.mesh.position.set(x, Math.max(0.4, y), z);
      ring.mesh.scale.setScalar(0.5);
      ring.mesh.material.opacity = 0.85;
      ring.mesh.visible = true;
      ring.age = 0;
      ring.max = 0.55;
    },
    sparks(x, y, z, count) { burst(x, y, z, count || 10, { speed: 7, life: 0.4, size: 0.55, color: 0xffd98a, gravity: -14, drag: 0.8 }); },
    glass(x, y, z) { burst(x, y, z, 14, { speed: 4, life: 0.7, size: 0.5, color: 0xbfe0f0, gravity: -12, drag: 1 }); },
    muzzle(x, y, z) { burst(x, y, z, 3, { speed: 1, life: 0.09, size: 1.1, color: 0xffe9a8, gravity: 0, drag: 0 }); },
    flash(x, y, z, dx, dy, dz, scale) {
      const f = flashes[flashCursor];
      flashCursor = (flashCursor + 1) % flashes.length;
      const s = 0.85 * (scale || 1) * (0.85 + Math.random() * 0.3);
      f.sprite.position.set(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2);
      f.sprite.scale.set(s, s, 1);
      f.sprite.material.rotation = Math.random() * Math.PI;
      f.sprite.material.opacity = 1;
      f.sprite.visible = true;
      f.life = f.maxLife;
      flashLight.position.set(x, y, z);
      flashLight.intensity = 16;
      flashLightLife = 0.08;
      flashCount += 1;
    },
    casing(x, y, z, rx, rz, power) {
      const c = casings[casingCursor];
      casingCursor = (casingCursor + 1) % casings.length;
      const p = power || 1;
      c.mesh.position.set(x, y, z);
      c.vx = rx * (1.2 + Math.random() * 1.2) * p;
      c.vy = (2 + Math.random() * 1.5) * p;
      c.vz = rz * (1.2 + Math.random() * 1.2) * p;
      c.rx = (Math.random() - 0.5) * 18;
      c.rz = (Math.random() - 0.5) * 18;
      c.mesh.material.opacity = 1;
      c.mesh.visible = true;
      c.life = 1.4;
      casingCount += 1;
    },
    groundHit(x, y, z) {
      burst(x, y, z, 8, { speed: 2.2, life: 0.7, size: 1.2, color: 0xa89a80, gravity: 0.6, drag: 1.6, vy: 1.2 });
      burst(x, y, z, 3, { speed: 5, life: 0.25, size: 0.5, color: 0xffd98a, gravity: -12, drag: 0.8 });
    },
    swing(x, y, z, heading) {
      // A melee arc: fast pale streaks along the swing in front.
      for (let i = 0; i < 6; i += 1) {
        const a = heading + (i / 5 - 0.5) * 1.1;
        const px = x + Math.sin(a) * 1.0;
        const pz = z + Math.cos(a) * 1.0;
        spawn(px, y, pz, Math.cos(a) * 5, 0.4, -Math.sin(a) * 5, 0.18, 0.9, 0xfff2d8, 0, 0.5);
      }
    },
    dust(x, y, z) { burst(x, y, z, 4, { speed: 1.8, life: 0.9, size: 1.4, color: 0xa89a80, gravity: 0.6, drag: 1.6 }); },
    splash(x, y, z) { burst(x, y, z, 8, { speed: 2.4, life: 0.5, size: 0.6, color: 0x9fc4e8, gravity: -10, drag: 1 }); },
    heal(x, y, z) { burst(x, y, z, 12, { speed: 1, life: 0.9, size: 0.8, color: 0x7fc97f, gravity: 2.5, drag: 1 }); },
    skid(x, z, heading) {
      const s = skids[skidCursor];
      skidCursor = (skidCursor + 1) % MAX_SKIDS;
      s.mesh.position.set(x, 0.06, z);
      s.mesh.rotation.z = -heading;
      s.mesh.material.opacity = 0.55;
      s.mesh.visible = true;
      s.age = 0;
    },
    setRain(intensity) {
      rain.visible = intensity > 0.01;
      rainMat.opacity = 0.55 * intensity;
    },
    update(dt) {
      activeCount = 0;
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          sizes[i] = 0;
          positions[i * 3 + 1] = -100;
          continue;
        }
        activeCount += 1;
        const dragK = Math.exp(-drag[i] * dt);
        velocities[i * 3] *= dragK;
        velocities[i * 3 + 1] = velocities[i * 3 + 1] * dragK + gravity[i] * dt;
        velocities[i * 3 + 2] *= dragK;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (positions[i * 3 + 1] < 0.05) {
          positions[i * 3 + 1] = 0.05;
          velocities[i * 3 + 1] = 0;
        }
        const t = life[i] / maxLife[i];
        sizes[i] = baseSize[i] * (0.5 + t * 0.5);
        colors[i * 3] = baseColor[i * 3] * t;
        colors[i * 3 + 1] = baseColor[i * 3 + 1] * t;
        colors[i * 3 + 2] = baseColor[i * 3 + 2] * t;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.psize.needsUpdate = true;
      for (const s of skids) {
        if (!s.mesh.visible) continue;
        s.age += dt;
        if (s.age > 45) {
          s.mesh.material.opacity -= dt * 0.1;
          if (s.mesh.material.opacity <= 0.02) s.mesh.visible = false;
        }
      }
      for (const ring of rings) {
        if (!ring.mesh.visible) continue;
        ring.age += dt;
        const t = ring.age / ring.max;
        if (t >= 1) { ring.mesh.visible = false; continue; }
        ring.mesh.scale.setScalar(0.5 + t * 9);
        ring.mesh.material.opacity = 0.85 * (1 - t);
      }
      // Muzzle flashes fade in 70 ms; the shared light dies with them.
      for (const f of flashes) {
        if (!f.sprite.visible) continue;
        f.life -= dt;
        if (f.life <= 0) { f.sprite.visible = false; continue; }
        f.sprite.material.opacity = f.life / f.maxLife;
      }
      if (flashLightLife > 0) {
        flashLightLife -= dt;
        flashLight.intensity = Math.max(0, flashLightLife / 0.08) * 16;
      } else {
        flashLight.intensity = 0;
      }
      // Casings arc, bounce once on the ground, then fade out.
      for (const c of casings) {
        if (!c.mesh.visible) continue;
        c.life -= dt;
        if (c.life <= 0) { c.mesh.visible = false; continue; }
        c.vy -= 12 * dt;
        c.mesh.position.x += c.vx * dt;
        c.mesh.position.y += c.vy * dt;
        c.mesh.position.z += c.vz * dt;
        if (c.mesh.position.y < 0.06) {
          c.mesh.position.y = 0.06;
          c.vy *= -0.35;
          c.vx *= 0.6;
          c.vz *= 0.6;
        }
        c.mesh.rotation.x += c.rx * dt;
        c.mesh.rotation.z += c.rz * dt;
        if (c.life < 0.3) c.mesh.material.opacity = c.life / 0.3;
      }
      if (rain.visible && game.player) {
        rain.position.set(game.player.x, 0, game.player.z);
        const fall = 34 * dt;
        for (let i = 0; i < RAIN_COUNT; i += 1) {
          rainPos[i * 3 + 1] -= fall;
          if (rainPos[i * 3 + 1] < 0) rainPos[i * 3 + 1] = 40;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
    },
    get activeCount() { return activeCount; },
    get flashCount() { return flashCount; },
    get casingCount() { return casingCount; },
    get flashActive() { return flashLightLife > 0; },
  };
}
