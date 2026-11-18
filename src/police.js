// The CPD: patrol cars with a real state machine, officers on foot,
// roadblocks, and a search helicopter. Units drive the road graph to
// the player — they never teleport — and call each other by radio when
// one of them makes visual contact.

import * as THREE from 'three';
import { clamp, dampAngle, dist2 } from './utils.js';
import { animateWalker, buildWalkerMesh } from './pedestrians.js';

const DESIRED = [2, 1, 2, 4, 6, 8];

export function createPolice(game) {
  const units = [];
  let spawnTimer = 0;
  let roadblockTimer = 0;
  let sirenTimer = 0;
  let heli = null;
  let heliFireTimer = 0;
  let playerFiredAt = -99;

  game.events.on('gunshot', ({ shooter }) => {
    if (shooter === 'player') playerFiredAt = game.time;
  });

  function spawnOfficer(unit, x, z) {
    const parts = buildWalkerMesh(0x22303f, 0xe0b58e, 0x1c1c1c, 0x22303f);
    parts.group.position.set(x, 0, z);
    game.scene.add(parts.group);
    const officer = {
      x, z, heading: 0, hp: 100, maxHp: 100, state: 'chase', parts,
      walkPhase: 0, fireTimer: 1.5, burstLeft: 0, burstTimer: 0,
      kind: 'officer', unit, deadTimer: 0, fallAngle: 0,
    };
    unit.officer = officer;
    return officer;
  }

  function spawnUnit(state) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 90 + Math.random() * 60;
    const rp = game.roadgraph.nearestRoadPoint(
      game.player.x + Math.cos(angle) * radius,
      game.player.z + Math.sin(angle) * radius,
    );
    const defId = Math.random() < 0.75 ? 'interceptor' : 'cpdvan';
    const vehicle = game.vehicles.spawn(defId, rp.x, rp.z, rp.heading, { driver: 'police' });
    if (!vehicle) return null;
    const unit = {
      vehicle, state: state || 'patrol', route: [], leg: 1, officer: null,
      lastRouteAt: 0, searchTimer: 0, blockAt: null, stuckTimer: 0,
    };
    vehicle.siren = false;
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    if (unit.officer) game.scene.remove(unit.officer.parts.group);
    if (unit.vehicle) game.vehicles.remove(unit.vehicle);
    const at = units.indexOf(unit);
    if (at >= 0) units.splice(at, 1);
  }

  function reroute(unit, tx, tz) {
    unit.route = game.roadgraph.route(unit.vehicle.x, unit.vehicle.z, tx, tz);
    unit.leg = 1;
    unit.lastRouteAt = game.time;
  }

  function driveToward(unit, tx, tz, dt, fullSpeed) {
    const v = unit.vehicle;
    const wantHeading = Math.atan2(tx - v.x, tz - v.z);
    const headingError = ((wantHeading - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steer = clamp(headingError * 1.8, -1, 1);
    const desired = fullSpeed ? v.def.topSpeed * 0.95 : v.def.topSpeed * 0.55;
    let throttle = 1;
    if (v.speed > desired) throttle = 0;
    if (Math.abs(headingError) > 1.2 && v.speed > 8) throttle = -0.5;
    const collision = game.physics.stepVehicle(v, v.def, { throttle, steer, handbrake: false }, dt, game.weather.gripMultiplier());
    if (collision && collision.speed > 5) {
      game.vehicles.damage(v, collision.speed * 1.1, v.x, v.z);
    }
    return dist2(v.x, v.z, tx, tz);
  }

  function setRoadblock() {
    if (game.wanted.stars < 3) return;
    const fwd = { x: Math.sin(game.player.heading), z: Math.cos(game.player.heading) };
    const ahead = game.roadgraph.nearestRoadPoint(game.player.x + fwd.x * 85, game.player.z + fwd.z * 85);
    let placed = 0;
    for (const unit of units) {
      if (placed >= 2) break;
      if (unit.state === 'block' || unit.officer) continue;
      if (dist2(unit.vehicle.x, unit.vehicle.z, ahead.x, ahead.z) > 200) continue;
      unit.state = 'block';
      unit.blockAt = { x: ahead.x, z: ahead.z, heading: ahead.heading + Math.PI / 2 };
      placed += 1;
    }
    if (placed > 0) {
      game.hud.notify(game.settings.language === 'id' ? 'Blokade jalan di depan!' : 'Roadblock ahead!', 'bad');
      game.audio.playSfx('horn', ahead.x, ahead.z);
    }
  }

  function buildHeli() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 5), bodyMat);
    body.position.y = 0;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.2, metalness: 0.5 }));
    cabin.position.set(0, 0.4, 1.6);
    group.add(cabin);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.5), bodyMat);
    tail.position.set(0, 0.3, -4.2);
    group.add(tail);
    const rotor = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(9, 0.08, 0.4);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const b1 = new THREE.Mesh(bladeGeo, bladeMat);
    const b2 = new THREE.Mesh(bladeGeo, bladeMat);
    b2.rotation.y = Math.PI / 2;
    rotor.add(b1);
    rotor.add(b2);
    rotor.position.y = 1.1;
    group.add(rotor);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 55, 14, 1, true), coneMat);
    cone.position.y = -27.5;
    group.add(cone);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(9, 20), new THREE.MeshBasicMaterial({ color: 0xfff2b8, transparent: true, opacity: 0.22, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2;
    game.scene.add(spot);
    group.position.set(game.player.x, 55, game.player.z);
    game.scene.add(group);
    return { group, rotor, cone, spot, angle: 0 };
  }

  function spotlightOnPlayer() {
    if (!heli) return false;
    return dist2(heli.group.position.x, heli.group.position.z, game.player.x, game.player.z) < 14;
  }

  function hurtOfficer(officer, amount, byPlayer) {
    if (officer.state === 'dead') return;
    officer.hp -= amount;
    if (officer.hp <= 0) {
      officer.state = 'dead';
      officer.deadTimer = 0;
      officer.fallAngle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      game.events.emit('killed', { victim: officer, killer: byPlayer ? 'player' : 'npc', x: officer.x, z: officer.z, kind: 'officer' });
      if (byPlayer) {
        game.progress.stats.kills += 1;
        game.events.emit('crime', { kind: 'killCop', x: officer.x, z: officer.z, heat: 45 });
      }
    } else if (byPlayer) {
      officer.state = 'chase';
    }
  }

  function updateOfficer(unit, dt) {
    const officer = unit.officer;
    if (!officer) return;
    if (officer.state === 'dead') {
      officer.deadTimer += dt;
      officer.parts.group.rotation.x += (officer.fallAngle - officer.parts.group.rotation.x) * Math.min(1, dt * 6);
      if (officer.deadTimer > 20) {
        game.scene.remove(officer.parts.group);
        unit.officer = null;
      }
      return;
    }
    const dPlayer = dist2(officer.x, officer.z, game.player.x, game.player.z);
    // The player drove away: the officer returns to the car.
    if (game.player.vehicle && dPlayer > 40) {
      game.scene.remove(officer.parts.group);
      unit.officer = null;
      unit.state = 'pursue';
      return;
    }
    const want = Math.atan2(game.player.x - officer.x, game.player.z - officer.z);
    officer.heading = dampAngle(officer.heading, want, 8, dt);
    let moving = 0;
    if (dPlayer > 2.2) {
      const moved = game.physics.moveWalker(officer, Math.sin(officer.heading), Math.cos(officer.heading), 7.2, dt);
      moving = moved.moved ? 1 : 0.2;
    }
    // Officers shoot only when provoked or at 3+ stars.
    const mayShoot = (game.time - playerFiredAt < 20 || game.wanted.stars >= 3) && dPlayer < 40 && dPlayer > 3;
    let aiming = false;
    if (mayShoot && !game.physics.segmentBlocked(officer.x, officer.z, game.player.x, game.player.z)) {
      aiming = true;
      officer.fireTimer -= dt;
      if (officer.fireTimer <= 0 && officer.burstLeft <= 0) {
        officer.burstLeft = 3;
        officer.burstTimer = 0;
        officer.fireTimer = 1.6 + Math.random();
      }
    }
    if (officer.burstLeft > 0) {
      officer.burstTimer -= dt;
      if (officer.burstTimer <= 0) {
        officer.burstTimer = 0.32;
        officer.burstLeft -= 1;
        game.combat.npcShoot(officer, game.player.x, game.player.y + 1.2, game.player.z, 'p9', 0.35);
      }
    }
    officer.walkPhase += dt * 10 * (moving > 0 ? 1 : 0);
    animateWalker(officer.parts, officer.walkPhase, moving, aiming, false);
    officer.parts.group.position.set(officer.x, 0, officer.z);
    officer.parts.group.rotation.y = officer.heading;
  }

  function update(dt) {
    const stars = game.wanted.stars;
    const desired = DESIRED[stars];
    spawnTimer -= dt;
    if (units.length < desired && spawnTimer <= 0) {
      spawnTimer = 1.4;
      spawnUnit(stars > 0 ? 'pursue' : 'patrol');
    }
    roadblockTimer -= dt;
    if (stars >= 3 && roadblockTimer <= 0) {
      roadblockTimer = 50;
      setRoadblock();
    }
    // Helicopter at 4+ stars.
    if (stars >= 4 && !heli) {
      heli = buildHeli();
      game.hud.notify(game.settings.language === 'id' ? 'Helikopter polisi di udara!' : 'Police helicopter overhead!', 'bad');
    }
    if (stars < 4 && heli) {
      game.scene.remove(heli.group);
      game.scene.remove(heli.spot);
      heli = null;
      game.audio.setSiren(false);
    }
    if (heli) {
      heli.angle += dt * 0.35;
      const tx = game.player.x + Math.cos(heli.angle) * 16;
      const tz = game.player.z + Math.sin(heli.angle) * 16;
      heli.group.position.x += (tx - heli.group.position.x) * Math.min(1, dt * 1.6);
      heli.group.position.z += (tz - heli.group.position.z) * Math.min(1, dt * 1.6);
      heli.group.position.y = 55 + Math.sin(game.time * 0.8) * 1.5;
      heli.group.rotation.y = Math.atan2(game.player.x - heli.group.position.x, game.player.z - heli.group.position.z);
      heli.rotor.rotation.y += dt * 22;
      heli.spot.position.set(heli.group.position.x, 0.15, heli.group.position.z);
      heli.cone.material.opacity = game.weather.isNight() ? 0.2 : 0.1;
      if (stars >= 5) {
        heliFireTimer -= dt;
        if (heliFireTimer <= 0 && spotlightOnPlayer()) {
          heliFireTimer = 2.6;
          game.combat.npcShoot({ x: heli.group.position.x, z: heli.group.position.z, y: 52 }, game.player.x, game.player.y + 1, game.player.z, 'kr9', 0.3);
          game.hud.notify(game.settings.language === 'id' ? 'Helikopter menembak!' : 'The helicopter is firing!', 'bad');
        }
      }
    }
    // Siren: one voice, nearest pursuing unit, alternating tone.
    sirenTimer -= dt;
    if (sirenTimer <= 0) {
      sirenTimer = 0.45;
      const pursuing = units.find((u) => u.vehicle && u.state !== 'patrol' && !u.vehicle.wrecked);
      if (pursuing) {
        const approach = game.player.vehicle ? clamp(game.player.vehicle.speed / 40, 0, 1) : 0;
        game.audio.setSiren(true, pursuing.vehicle.x, pursuing.vehicle.z, approach);
      } else {
        game.audio.setSiren(false);
      }
    }

    for (let i = units.length - 1; i >= 0; i -= 1) {
      const unit = units[i];
      const v = unit.vehicle;
      if (v.wrecked) {
        // A wrecked unit stands down; its officer keeps chasing on foot.
        if (!unit.officer) {
          removeUnit(unit);
          continue;
        }
        updateOfficer(unit, dt);
        continue;
      }
      v.siren = unit.state !== 'patrol';
      // Stand down when the heat is gone: search, then leave.
      if (stars === 0 && unit.state !== 'patrol') {
        unit.state = 'search';
        unit.searchTimer = 25;
      }
      if (unit.state === 'search') {
        unit.searchTimer -= dt;
        const last = game.wanted.lastKnown || { x: game.player.x, z: game.player.z };
        if (game.time - unit.lastRouteAt > 4) reroute(unit, last.x + (Math.random() - 0.5) * 60, last.z + (Math.random() - 0.5) * 60);
        const target = unit.route[unit.leg];
        if (target) {
          driveToward(unit, target.x, target.z, dt, false);
          if (dist2(v.x, v.z, target.x, target.z) < 10) unit.leg += 1;
        }
        if (unit.searchTimer <= 0) {
          if (units.filter((u) => u.state === 'patrol').length < 2) {
            unit.state = 'patrol';
          } else {
            removeUnit(unit);
            continue;
          }
        }
      } else if (unit.state === 'patrol') {
        if (stars > 0) {
          unit.state = 'pursue';
        } else {
          if (unit.route.length === 0 || unit.leg >= unit.route.length) {
            const next = game.roadgraph.randomNode(Math.random, v.x, v.z, 150, 800);
            reroute(unit, next.x, next.z);
          }
          const target = unit.route[unit.leg];
          if (target) {
            driveToward(unit, target.x, target.z, dt, false);
            if (dist2(v.x, v.z, target.x, target.z) < 10) unit.leg += 1;
          }
        }
      } else if (unit.state === 'block') {
        if (stars < 3) {
          unit.state = 'pursue';
        } else if (unit.blockAt) {
          const d = driveToward(unit, unit.blockAt.x, unit.blockAt.z, dt, true);
          if (d < 6) {
            v.heading = dampAngle(v.heading, unit.blockAt.heading, 3, dt);
            v.vx *= 0.8;
            v.vz *= 0.8;
            if (dist2(v.x, v.z, game.player.x, game.player.z) > 130) unit.state = 'pursue';
          }
        }
      } else if (unit.state === 'investigate' || unit.state === 'pursue') {
        if (game.wanted.seen || stars >= 2) unit.state = 'pursue';
        // Recompute the route as the player moves; chase directly up close.
        const dPlayer = dist2(v.x, v.z, game.player.x, game.player.z);
        if (dPlayer < 28) {
          const predict = 0.8;
          const px = game.player.x + (game.player.vehicle ? game.player.vehicle.vx * predict : 0);
          const pz = game.player.z + (game.player.vehicle ? game.player.vehicle.vz * predict : 0);
          driveToward(unit, px, pz, dt, true);
        } else {
          if (game.time - unit.lastRouteAt > 2.5) {
            reroute(unit, game.player.x, game.player.z);
          }
          const target = unit.route[unit.leg];
          if (target) {
            driveToward(unit, target.x, target.z, dt, true);
            if (dist2(v.x, v.z, target.x, target.z) < 12) unit.leg += 1;
          } else {
            reroute(unit, game.player.x, game.player.z);
          }
        }
        // Deploy an officer against a player on foot.
        if (!game.player.vehicle && !unit.officer && dPlayer < 11 && v.speed < 3) {
          spawnOfficer(unit, v.x + 2, v.z + 2);
        }
        // Radio: a unit that sees the player tells the rest where to go.
        if (game.wanted.seen && game.wanted.lastKnown && Math.random() < dt * 0.5) {
          for (const other of units) {
            if (other !== unit && other.state === 'pursue' && dist2(other.vehicle.x, other.vehicle.z, v.x, v.z) < 160) {
              other.lastRouteAt = 0;
            }
          }
        }
      }
      updateOfficer(unit, dt);
    }
  }

  function reset() {
    for (const unit of [...units]) removeUnit(unit);
    if (heli) {
      game.scene.remove(heli.group);
      game.scene.remove(heli.spot);
      heli = null;
    }
    game.audio.setSiren(false);
  }

  return {
    units, update, reset, hurtOfficer, spotlightOnPlayer, forceRoadblock: setRoadblock,
    get heliActive() { return !!heli; },
  };
}
