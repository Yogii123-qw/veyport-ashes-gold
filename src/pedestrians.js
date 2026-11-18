// Walkers: the shared low-poly person every human in Veyport is built
// from, plus the civilian crowd — sidewalk walkers who flee gunfire and
// call the police when they watch a crime happen. Gang members and
// officers reuse the walker factory with their own brains.

import * as THREE from 'three';
import { clamp, dampAngle, dist2 } from './utils.js';

const torsoGeo = new THREE.BoxGeometry(0.52, 0.62, 0.3);
const headGeo = new THREE.BoxGeometry(0.34, 0.36, 0.32);
const hairGeo = new THREE.BoxGeometry(0.36, 0.14, 0.34);
const limbGeo = new THREE.BoxGeometry(0.16, 0.62, 0.16);
const armGeo = new THREE.BoxGeometry(0.13, 0.56, 0.13);
const legGeo = new THREE.BoxGeometry(0.17, 0.7, 0.17);

export function buildWalkerMesh(coatColor, skinColor, hairColor, pantsColor) {
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor || 0x2a2e35, roughness: 0.9 });
  const torso = new THREE.Mesh(torsoGeo, coatMat);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 1.88;
  group.add(hair);
  const armL = new THREE.Group();
  armL.position.set(-0.33, 1.44, 0);
  const armLMesh = new THREE.Mesh(armGeo, coatMat);
  armLMesh.position.y = -0.26;
  armL.add(armLMesh);
  group.add(armL);
  const armR = new THREE.Group();
  armR.position.set(0.33, 1.44, 0);
  const armRMesh = new THREE.Mesh(armGeo, coatMat);
  armRMesh.position.y = -0.26;
  armR.add(armRMesh);
  group.add(armR);
  const legL = new THREE.Group();
  legL.position.set(-0.14, 0.86, 0);
  const legLMesh = new THREE.Mesh(legGeo, pantsMat);
  legLMesh.position.y = -0.36;
  legL.add(legLMesh);
  group.add(legL);
  const legR = new THREE.Group();
  legR.position.set(0.14, 0.86, 0);
  const legRMesh = new THREE.Mesh(legGeo, pantsMat);
  legRMesh.position.y = -0.36;
  legR.add(legRMesh);
  group.add(legR);
  return { group, torso, head, armL, armR, legL, legR, coatMat };
}

export function animateWalker(parts, phase, moveAmount, aiming, phoning) {
  const swing = Math.sin(phase) * 0.55 * moveAmount;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  if (phoning) {
    parts.armR.rotation.x = -2.4;
    parts.armL.rotation.x = -swing * 0.5;
  } else if (aiming) {
    parts.armR.rotation.x = -1.45;
    parts.armL.rotation.x = -1.2;
  } else {
    parts.armL.rotation.x = -swing;
    parts.armR.rotation.x = swing;
  }
}

export function createPedestrians(game) {
  const walkers = [];
  let spawnTimer = 0;
  const COATS = [0x7a4a3a, 0x3a5a7a, 0x5a6a3a, 0x8a7a5a, 0x4a4a5a, 0x9a8a6a, 0x2f4a4a, 0x6a3a4a];
  const SKINS = [0xd9a77c, 0xc98d5e, 0x8a5a3c, 0xe0b58e, 0xa8764a];
  const HAIRS = [0x2a2018, 0x1c1c1c, 0x6a4a2a, 0xd8d3c8, 0x4a2a1a];

  function spawnWalker(x, z) {
    const parts = buildWalkerMesh(
      COATS[Math.floor(Math.random() * COATS.length)],
      SKINS[Math.floor(Math.random() * SKINS.length)],
      HAIRS[Math.floor(Math.random() * HAIRS.length)],
    );
    parts.group.position.set(x, 0, z);
    game.scene.add(parts.group);
    const walker = {
      x, z, heading: Math.random() * Math.PI * 2, speed: 0, hp: 50, state: 'walk',
      parts, walkPhase: Math.random() * 6, target: null, retarget: 0,
      fleeTimer: 0, fleeFrom: null, witnessTimer: 0, deadTimer: 0, fallAngle: 0,
      stepTimer: 0, kind: 'civilian',
    };
    walkers.push(walker);
    return walker;
  }

  function pickSidewalkTarget(walker) {
    const rp = game.roadgraph.nearestRoadPoint(walker.x + (Math.random() - 0.5) * 120, walker.z + (Math.random() - 0.5) * 120);
    const side = Math.random() < 0.5 ? 1 : -1;
    const perpX = Math.cos(rp.heading) * side;
    const perpZ = -Math.sin(rp.heading) * side;
    const tx = rp.x + perpX * 10.5;
    const tz = rp.z + perpZ * 10.5;
    if (game.physics.inWater(tx, tz)) return;
    walker.target = { x: tx, z: tz };
  }

  function hurt(walker, amount, byPlayer, headshot) {
    if (walker.state === 'dead') return;
    walker.hp -= amount;
    if (walker.hp <= 0) {
      walker.state = 'dead';
      walker.deadTimer = 0;
      walker.fallAngle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      game.events.emit('killed', { victim: walker, killer: byPlayer ? 'player' : 'npc', x: walker.x, z: walker.z, kind: 'civilian' });
      if (byPlayer) {
        game.events.emit('crime', { kind: 'kill', x: walker.x, z: walker.z, heat: 35 });
        game.progress.stats.kills += 1;
      }
    } else if (byPlayer) {
      startFlee(walker, game.player.x, game.player.z);
    }
  }

  function startFlee(walker, fromX, fromZ) {
    if (walker.state === 'dead') return;
    walker.state = 'flee';
    walker.fleeTimer = 4 + Math.random() * 2;
    walker.fleeFrom = { x: fromX, z: fromZ };
    walker.witnessTimer = 0;
  }

  function startWitness(walker) {
    if (walker.state === 'dead' || walker.state === 'flee') return;
    if (walker.witnessTimer > 0) return;
    walker.state = 'witness';
    walker.witnessTimer = 5;
    game.hud.notify(game.lang('witness'), 'bad');
    game.audio.playSfx('click', walker.x, walker.z);
  }

  game.events.on('gunshot', ({ x, z, shooter }) => {
    for (const w of walkers) {
      if (w.state === 'dead') continue;
      const d = dist2(w.x, w.z, x, z);
      if (d < 32) startFlee(w, x, z);
      else if (d < 55 && shooter === 'player' && Math.random() < 0.5) startFlee(w, x, z);
    }
  });
  game.events.on('explosion', ({ x, z }) => {
    for (const w of walkers) {
      if (w.state === 'dead') continue;
      if (dist2(w.x, w.z, x, z) < 55) startFlee(w, x, z);
    }
  });
  game.events.on('crime', ({ kind, x, z }) => {
    if (kind === 'kill') return; // Killing is already loud; witnesses flee.
    for (const w of walkers) {
      if (w.state !== 'walk' && w.state !== 'idle') continue;
      const d = dist2(w.x, w.z, x, z);
      if (d < 25 && !game.physics.segmentBlocked(w.x, w.z, x, z)) startWitness(w);
    }
  });

  function update(dt) {
    // Density follows the clock: busy at midday, thin at 3 a.m.
    const hour = game.weather.hours;
    const dayFactor = hour >= 7 && hour <= 19 ? 1 : hour >= 5 && hour <= 22 ? 0.6 : 0.3;
    const weatherFactor = game.weather.current === 'storm' ? 0.4 : game.weather.current === 'rain' ? 0.6 : 1;
    const maxWalkers = Math.floor(game.quality.pedCap * dayFactor * weatherFactor);
    spawnTimer -= dt;
    if (walkers.length < maxWalkers && spawnTimer <= 0) {
      spawnTimer = 0.5;
      const angle = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * 60;
      const x = game.player.x + Math.cos(angle) * radius;
      const z = game.player.z + Math.sin(angle) * radius;
      if (Math.abs(x) < 580 && Math.abs(z) < 580 && !game.physics.inWater(x, z) && !game.roadgraph.onRoad(x, z)) {
        const w = spawnWalker(x, z);
        pickSidewalkTarget(w);
      }
    }
    for (let i = walkers.length - 1; i >= 0; i -= 1) {
      const w = walkers[i];
      if (w.state === 'dead') {
        w.deadTimer += dt;
        const target = w.fallAngle;
        w.parts.group.rotation.x += (target - w.parts.group.rotation.x) * Math.min(1, dt * 6);
        if (w.deadTimer > 20) {
          game.scene.remove(w.parts.group);
          walkers.splice(i, 1);
        }
        continue;
      }
      if (dist2(w.x, w.z, game.player.x, game.player.z) > 170) {
        game.scene.remove(w.parts.group);
        walkers.splice(i, 1);
        continue;
      }
      let moving = 0;
      if (w.state === 'flee') {
        w.fleeTimer -= dt;
        const away = Math.atan2(w.x - w.fleeFrom.x, w.z - w.fleeFrom.z);
        w.heading = dampAngle(w.heading, away, 6, dt);
        const moved = game.physics.moveWalker(w, Math.sin(w.heading), Math.cos(w.heading), 7.5, dt);
        moving = moved.moved ? 1 : 0.3;
        w.speed = 7.5;
        if (w.fleeTimer <= 0) {
          w.state = 'walk';
          pickSidewalkTarget(w);
        }
      } else if (w.state === 'witness') {
        w.witnessTimer -= dt;
        w.heading = dampAngle(w.heading, Math.atan2(game.player.x - w.x, game.player.z - w.z), 5, dt);
        w.speed = 0;
        const dPlayer = dist2(w.x, w.z, game.player.x, game.player.z);
        if (dPlayer > 40) {
          w.state = 'walk';
          w.witnessTimer = 0;
          pickSidewalkTarget(w);
        } else if (w.witnessTimer <= 0) {
          w.state = 'walk';
          w.witnessTimer = 0;
          game.events.emit('alarm', { x: w.x, z: w.z, radius: 60 });
          game.events.emit('crime', { kind: 'witnessed', x: game.player.x, z: game.player.z, heat: 14, silent: true });
          pickSidewalkTarget(w);
        }
      } else {
        w.retarget -= dt;
        if (!w.target || w.retarget <= 0 || dist2(w.x, w.z, w.target.x, w.target.z) < 3) {
          pickSidewalkTarget(w);
          w.retarget = 14 + Math.random() * 10;
        }
        if (w.target) {
          const want = Math.atan2(w.target.x - w.x, w.target.z - w.z);
          w.heading = dampAngle(w.heading, want, 4, dt);
          const moved = game.physics.moveWalker(w, Math.sin(w.heading), Math.cos(w.heading), 1.6, dt);
          moving = moved.moved ? 0.6 : 0;
          w.speed = 1.6;
          if (!moved.moved) pickSidewalkTarget(w);
        }
      }
      // Hit by a moving vehicle?
      for (const vehicle of game.vehicles.list) {
        if (vehicle.wrecked || vehicle.speed < 3) continue;
        if (dist2(w.x, w.z, vehicle.x, vehicle.z) < 2.2) {
          const byPlayer = vehicle === game.player.vehicle;
          hurt(w, 60 + vehicle.speed * 2, byPlayer, false);
          game.particles.dust(w.x, 1, w.z);
          if (byPlayer) {
            game.events.emit('crime', { kind: 'hitPed', x: w.x, z: w.z, heat: 25 });
            game.cameraRig.addTrauma(0.35);
          }
          game.audio.playSfx('crash', w.x, w.z);
          break;
        }
      }
      w.walkPhase += dt * (w.state === 'flee' ? 11 : 5) * (moving > 0 ? 1 : 0);
      animateWalker(w.parts, w.walkPhase, moving, false, w.state === 'witness');
      w.parts.group.position.set(w.x, 0, w.z);
      w.parts.group.rotation.y = w.heading;
    }
  }

  function nearest(x, z, radius) {
    let best = null;
    let bestD = radius;
    for (const w of walkers) {
      if (w.state === 'dead') continue;
      const d = dist2(x, z, w.x, w.z);
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  }

  function reset() {
    for (const w of walkers) game.scene.remove(w.parts.group);
    walkers.length = 0;
  }

  return {
    walkers, update, hurt, startFlee, startWitness, nearest, reset, spawnWalker,
  };
}
