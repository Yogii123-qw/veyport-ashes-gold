// The story engine: six missions as chains of typed stages, each
// stage a real check against the live world — distances, kills, timers,
// vehicles, choices. Failure is real too, with retry from the last
// checkpoint stage. Rewards and unlocks land through the economy, and
// the ending choice in M6 is recorded in the save.

import { CHARACTERS, MISSIONS, missionById } from '../data/missionsData.js';
import { POIS, poiById } from '../data/cityData.js';
import { clamp, dist2 } from './utils.js';
import { animateWalker, buildWalkerMesh } from './pedestrians.js';

export function createMissions(game) {
  let active = null;
  let beacon = null;
  let traitor = null;
  let targetVehicle = null;
  let dialogPlaying = false;
  let suppressHeat = false;

  function lang() { return game.settings.language; }
  function text(pair) { return pair[lang()] || pair.en; }

  function clearBeacon() {
    if (beacon) {
      game.scene.remove(beacon);
      beacon = null;
    }
  }

  function setBeacon(x, z, color = 0xffc35c) {
    clearBeacon();
    beacon = game.city.createBeacon(x, z, color);
    game.scene.add(beacon);
    game.minimap.setTarget(x, z);
  }

  function cleanupStageArtifacts() {
    clearBeacon();
    game.minimap.setTarget(null, null);
    if (traitor) {
      game.scene.remove(traitor.parts.group);
      traitor = null;
    }
  }

  function spawnStageSquads(stage) {
    const tag = active.tag;
    for (const group of stage.spawn) {
      game.gangs.spawnSquad(group.faction, group.x, group.z, group.count, { tag, hostile: true });
    }
  }

  function enterStage(index) {
    const stage = active.mission.stages[index];
    if (!stage) {
      completeMission();
      return;
    }
    active.stageIndex = index;
    active.data = {};
    if (stage.checkpoint) active.checkpointIndex = index;
    cleanupStageArtifacts();
    game.hud.setObjective(text(stage.objective), stage.x ?? null, stage.z ?? null);
    switch (stage.type) {
      case 'goto':
        setBeacon(stage.x, stage.z);
        break;
      case 'talk': {
        const poi = poiById(stage.poi);
        setBeacon(poi.x, poi.z, 0x7fd4ff);
        break;
      }
      case 'dialog':
        dialogPlaying = true;
        game.dialogs.play(stage.lines, () => {
          dialogPlaying = false;
          advance();
        });
        break;
      case 'enterVehicle': {
        targetVehicle = game.vehicles.spawn(stage.spawnType, stage.spawnAt.x, stage.spawnAt.z, stage.spawnAt.heading, { mission: true });
        setBeacon(stage.spawnAt.x, stage.spawnAt.z);
        game.hud.setObjective(text(stage.objective), stage.spawnAt.x, stage.spawnAt.z);
        break;
      }
      case 'deliver':
        active.data.dropIndex = 0;
        active.data.timer = stage.timeLimit;
        setBeacon(stage.points[0].x, stage.points[0].z);
        break;
      case 'eliminate':
        spawnStageSquads(stage);
        game.hud.setObjective(text(stage.objective), null, null);
        break;
      case 'defend':
        active.data.waveIndex = -1;
        active.data.waveGap = 0;
        setBeacon(stage.center.x, stage.center.z, 0xff5a4a);
        break;
      case 'chase':
        if (stage.targetVehicle) {
          targetVehicle = game.vehicles.spawn(stage.targetVehicle, stage.spawnAt.x, stage.spawnAt.z, 0, { mission: true, driver: 'mission' });
          active.data.route = game.roadgraph.route(stage.spawnAt.x, stage.spawnAt.z, stage.fleeTo.x, stage.fleeTo.z);
          active.data.leg = 1;
          active.data.blockTimer = 0;
          setBeacon(stage.spawnAt.x, stage.spawnAt.z, 0xff5a4a);
        } else {
          const parts = buildWalkerMesh(0x3a3a3a, 0xa8764a, 0x1c1c1c, 0x222222);
          parts.group.position.set(stage.spawnAt.x, 0, stage.spawnAt.z);
          game.scene.add(parts.group);
          traitor = {
            x: stage.spawnAt.x, z: stage.spawnAt.z, heading: 0, parts, walkPhase: 0,
            route: game.roadgraph.route(stage.spawnAt.x, stage.spawnAt.z, stage.fleeTo.x, stage.fleeTo.z),
            leg: 1,
          };
          setBeacon(stage.spawnAt.x, stage.spawnAt.z, 0xff5a4a);
        }
        break;
      case 'race':
        active.data.gateIndex = 0;
        active.data.timer = stage.timeLimit;
        setBeacon(stage.checkpoints[0].x, stage.checkpoints[0].z);
        break;
      case 'choice':
        dialogPlaying = true;
        game.dialogs.play(stage.lines, () => {
          dialogPlaying = false;
          game.dialogs.showChoices(stage.choices, (choice) => applyChoice(stage, choice));
        });
        break;
      case 'escape':
        game.wanted.addHeat(35, game.player.x, game.player.z, { kind: 'escape', forced: true });
        game.police.forceRoadblock();
        setBeacon(stage.x, stage.z);
        break;
      default:
        break;
    }
    game.hud.notify(`${text(active.mission.title)} · ${text(stage.objective)}`, 'info');
  }

  function advance() {
    enterStage(active.stageIndex + 1);
  }

  function applyChoice(stage, choice) {
    const effect = choice.effect || {};
    if (effect.reputation) {
      for (const [faction, delta] of Object.entries(effect.reputation)) {
        game.progress.reputation[faction] = clamp(game.progress.reputation[faction] + delta, -100, 100);
      }
    }
    if (effect.money) game.economy.earn(effect.money, text(choice.label));
    if (effect.heat) game.wanted.addHeat(effect.heat, game.player.x, game.player.z, { kind: 'choice', forced: true });
    if (effect.ending) {
      game.progress.ending = effect.ending;
      game.progress.flags.debtResolved = true;
    }
    game.dialogs.logLine('rook', text(choice.result));
    game.hud.notify(text(choice.result), 'info');
    advance();
  }

  function startMission(id, opts = {}) {
    const mission = missionById(id);
    if (!mission) return false;
    if (active) return false;
    if (game.contracts.active) {
      game.hud.notify(game.lang('finishContractFirst'), 'bad');
      return false;
    }
    if (mission.nightLock && !opts.replay) {
      game.weather.setTime(mission.nightLock);
      game.hud.notify(game.settings.language === 'id' ? 'Jam melompat ke 21:00 — balapan malam.' : 'The clock jumps to 21:00 — a night race.', 'info');
    }
    active = {
      mission, stageIndex: 0, checkpointIndex: opts.fromStage ?? 0,
      tag: `mission-${id}`, data: {},
      startStats: { ...game.progress.stats },
      startTime: game.time, maxStars: 0, replay: !!opts.replay,
    };
    game.audio.setMusicMode('mission');
    enterStage(opts.fromStage ?? 0);
    game.hud.centerMessage(text(mission.title), 3);
    return true;
  }

  function failActive(reason) {
    if (!active) return;
    const mission = active.mission;
    game.progress.stats.missionsFailed += 1;
    game.gangs.removeTag(active.tag);
    cleanupStageArtifacts();
    const failedId = mission.id;
    active = null;
    game.audio.setMusicMode('explore');
    game.menus.showResults({
      failed: true, reason, missionId: failedId,
      onRetry: () => startMission(failedId, { fromStage: 0, replay: true }),
    });
  }

  function completeMission() {
    const mission = active.mission;
    const elapsed = game.time - active.startTime;
    const shots = game.progress.stats.shots - (active.startStats.shots || 0);
    const hits = game.progress.stats.hits - (active.startStats.hits || 0);
    const accuracy = shots > 0 ? hits / shots : 1;
    const damageTaken = (game.progress.stats.hpLost || 0) - (active.startStats.hpLost || 0);
    const cleanBonus = active.maxStars === 0 ? 150 : 0;
    const reward = mission.reward + cleanBonus;
    game.economy.earn(reward, `${text(mission.title)}${cleanBonus ? ` (+${game.lang('cleanBonus')})` : ''}`);
    const unlocks = mission.unlocks || {};
    if (unlocks.safehouse) game.progress.flags.safehouse = true;
    if (unlocks.contactDrayke) game.progress.flags.contactDrayke = true;
    if (unlocks.freeRespray) game.progress.flags.freeRespray = (game.progress.flags.freeRespray || 0) + unlocks.freeRespray;
    if (unlocks.weapon) game.player.giveWeapon(unlocks.weapon, true);
    if (unlocks.heavyArmor) game.progress.flags.heavyArmor = true;
    game.progress.missionsCompleted.add(mission.id);
    game.progress.stats.missionsCompleted += 1;
    game.gangs.removeTag(active.tag);
    cleanupStageArtifacts();
    game.hud.clearObjective();
    const score = clamp(60 + accuracy * 30 - Math.min(30, elapsed / 30) - Math.min(20, damageTaken / 10) + (cleanBonus ? 10 : 0), 0, 100);
    const rank = score >= 85 ? 'Gold' : score >= 65 ? 'Silver' : 'Bronze';
    active = null;
    game.audio.setMusicMode('explore');
    game.save.autosave('mission');
    game.menus.showResults({
      failed: false, missionId: mission.id, time: elapsed, accuracy, damage: damageTaken,
      reward, cleanBonus, rank,
      onReplay: () => startMission(mission.id, { replay: true }),
    });
  }

  function cancelActive(cleanup = true) {
    if (active && cleanup) game.gangs.removeTag(active.tag);
    cleanupStageArtifacts();
    active = null;
    targetVehicle = null;
    game.hud.clearObjective();
    game.audio.setMusicMode('explore');
  }

  function nextMission() {
    return MISSIONS.find((m) => !game.progress.missionsCompleted.has(m.id)) || null;
  }

  function availableAt(poiId) {
    const next = nextMission();
    if (next && next.startPoi === poiId && !active && !game.contracts.active) return next;
    return null;
  }

  function onInteract(poiId) {
    if (active) {
      const stage = active.mission.stages[active.stageIndex];
      if (stage && stage.type === 'talk' && stage.poi === poiId && !dialogPlaying) {
        dialogPlaying = true;
        game.dialogs.play(stage.lines, () => {
          dialogPlaying = false;
          advance();
        });
        return true;
      }
      return false;
    }
    const mission = availableAt(poiId);
    if (mission) {
      startMission(mission.id);
      return true;
    }
    return false;
  }

  function updateTraitor(stage, dt) {
    if (!traitor) return;
    const node = traitor.route[traitor.leg];
    if (!node) {
      failActive('traitorEscaped');
      return;
    }
    const want = Math.atan2(node.x - traitor.x, node.z - traitor.z);
    traitor.heading += (((want - traitor.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
    const moved = game.physics.moveWalker(traitor, Math.sin(traitor.heading), Math.cos(traitor.heading), 6.5, dt);
    traitor.walkPhase += dt * 10 * (moved.moved ? 1 : 0);
    animateWalker(traitor.parts, traitor.walkPhase, moved.moved ? 1 : 0, false, false);
    traitor.parts.group.position.set(traitor.x, 0, traitor.z);
    traitor.parts.group.rotation.y = traitor.heading;
    if (beacon) beacon.position.set(traitor.x, 0, traitor.z);
    game.minimap.setTarget(traitor.x, traitor.z);
    if (dist2(traitor.x, traitor.z, node.x, node.z) < 8) traitor.leg += 1;
    if (dist2(traitor.x, traitor.z, game.player.x, game.player.z) < 9) {
      game.hud.notify(game.lang('traitorCaught'), 'good');
      advance();
    }
  }

  function updateTruck(stage, dt) {
    const truck = targetVehicle;
    if (!truck || truck.wrecked) {
      if (truck && truck.wrecked) advance();
      return;
    }
    const node = active.data.route[active.data.leg];
    if (!node) {
      failActive('truckEscaped');
      return;
    }
    const want = Math.atan2(node.x - truck.x, node.z - truck.z);
    const err = ((want - truck.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steer = clamp(err * 1.6, -1, 1);
    const collision = game.physics.stepVehicle(truck, truck.def, { throttle: truck.speed < truck.def.topSpeed * 0.6 ? 1 : 0.4, steer, handbrake: false }, dt, game.weather.gripMultiplier());
    if (collision && collision.speed > 5) game.vehicles.damage(truck, collision.speed, truck.x, truck.z);
    if (dist2(truck.x, truck.z, node.x, node.z) < 12) active.data.leg += 1;
    if (beacon) beacon.position.set(truck.x, 0, truck.z);
    game.minimap.setTarget(truck.x, truck.z);
    const dPlayer = dist2(truck.x, truck.z, game.player.x, game.player.z);
    if (truck.speed < 1 && dPlayer < 15) {
      active.data.blockTimer += dt;
      if (active.data.blockTimer > 3) {
        game.hud.notify(game.lang('truckBlocked'), 'good');
        advance();
        return;
      }
    } else {
      active.data.blockTimer = 0;
    }
    if (truck.integrity <= stage.disableAt) {
      game.hud.notify(game.lang('truckDisabled'), 'good');
      advance();
      return;
    }
    if (dist2(truck.x, truck.z, stage.fleeTo.x, stage.fleeTo.z) < 20) {
      failActive('truckEscaped');
    }
  }

  function update(dt) {
    if (!active) return;
    active.maxStars = Math.max(active.maxStars, game.wanted.stars);
    const stage = active.mission.stages[active.stageIndex];
    if (!stage) return;
    if (beacon) {
      beacon.rotation.y += dt * 1.5;
      beacon.position.y = 0.2 + Math.sin(game.time * 2) * 0.15;
    }
    const playerAt = (x, z, radius) => dist2(game.player.x, game.player.z, x, z) < radius;
    switch (stage.type) {
      case 'goto': {
        if (stage.inVehicle && !game.player.vehicle) break;
        if (stage.onFoot && game.player.vehicle) break;
        if (playerAt(stage.x, stage.z, stage.radius)) {
          if (stage.pickup) game.hud.notify(game.lang('cargoCollected'), 'good');
          advance();
        }
        break;
      }
      case 'deliver': {
        active.data.timer -= dt;
        game.hud.setTimer(active.data.timer);
        if (active.data.timer <= 0) {
          failActive('timeOut');
          return;
        }
        const point = stage.points[active.data.dropIndex];
        if (point && playerAt(point.x, point.z, 12)) {
          active.data.dropIndex += 1;
          game.audio.playSfx('cash', game.player.x, game.player.z);
          if (active.data.dropIndex === stage.heatAtDrop) {
            game.wanted.addHeat(stage.heatAmount, game.player.x, game.player.z, { kind: 'delivery', forced: true });
            game.hud.notify(game.lang('heatRising'), 'bad');
          }
          if (active.data.dropIndex >= stage.points.length) {
            game.hud.setTimer(null);
            advance();
          } else {
            const next = stage.points[active.data.dropIndex];
            setBeacon(next.x, next.z);
            game.hud.setObjective(text(stage.objective), next.x, next.z);
          }
        }
        break;
      }
      case 'eliminate': {
        const left = game.gangs.aliveWithTag(active.tag);
        game.hud.setCounter(left);
        if (left === 0) {
          game.hud.setCounter(null);
          advance();
        }
        break;
      }
      case 'defend': {
        if (active.data.waveIndex === -1 || (game.gangs.aliveWithTag(active.tag) === 0 && active.data.waveGap <= 0)) {
          active.data.waveIndex += 1;
          if (active.data.waveIndex >= stage.waves.length) {
            game.hud.setCounter(null);
            advance();
            break;
          }
          const wave = stage.waves[active.data.waveIndex];
          wave.spawnAt.forEach(([x, z]) => {
            game.gangs.spawnMember('foundry', x, z, { tag: active.tag, hostile: true });
          });
          active.data.waveGap = 3;
          game.hud.notify(`${game.lang('wave')} ${active.data.waveIndex + 1}/${stage.waves.length}`, 'bad');
          game.audio.playSfx('horn', stage.center.x, stage.center.z);
        } else {
          active.data.waveGap -= dt;
          game.hud.setCounter(game.gangs.aliveWithTag(active.tag));
        }
        break;
      }
      case 'chase': {
        if (stage.targetVehicle) updateTruck(stage, dt);
        else updateTraitor(stage, dt);
        break;
      }
      case 'race': {
        active.data.timer -= dt;
        game.hud.setTimer(active.data.timer);
        if (active.data.timer <= 0) {
          failActive('timeOut');
          return;
        }
        const gate = stage.checkpoints[active.data.gateIndex];
        if (gate && playerAt(gate.x, gate.z, 14) && (!stage.inVehicle || game.player.vehicle)) {
          active.data.gateIndex += 1;
          game.audio.playSfx('cash', game.player.x, game.player.z);
          if (active.data.gateIndex >= stage.checkpoints.length) {
            game.hud.setTimer(null);
            advance();
          } else {
            const next = stage.checkpoints[active.data.gateIndex];
            setBeacon(next.x, next.z);
            game.hud.setObjective(text(stage.objective), next.x, next.z);
          }
        }
        break;
      }
      case 'escape': {
        if (game.player.vehicle && game.player.vehicle.integrity < stage.requireVehicleIntact) {
          failActive('vehicleDestroyed');
          return;
        }
        if (playerAt(stage.x, stage.z, stage.radius)) {
          if (game.wanted.stars === 0) advance();
          else if (!active.data.warned) {
            active.data.warned = true;
            game.hud.notify(game.lang('losePoliceFirst'), 'bad');
          }
        }
        break;
      }
      case 'enterVehicle': {
        if (targetVehicle && targetVehicle.wrecked) {
          failActive('vehicleDestroyed');
          return;
        }
        if (game.player.vehicle === targetVehicle) advance();
        break;
      }
      default:
        break;
    }
  }

  // Busted/wasted failure is handled inside wanted.js, which calls
  // failActive directly — no duplicate listeners here.

  return {
    get active() { return active; },
    get suppressHeat() { return suppressHeat; },
    set suppressHeat(value) { suppressHeat = value; },
    startMission, failActive, cancelActive, nextMission, availableAt, onInteract, update,
    get characters() { return CHARACTERS; },
    pois: POIS,
  };
}
