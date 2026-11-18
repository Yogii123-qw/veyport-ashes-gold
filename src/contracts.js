// Procedural work: the contract board at the bar offers three jobs
// generated from the city itself, and the world pays for caches, stunt
// jumps and time trials. Rewards follow distance and risk, and the
// player's contract reputation moves them up or down — failure costs
// real standing, so the next board pays less.

import { ACTIVITY_REWARDS, CONTRACT_CLIENTS, CONTRACT_TYPES, REPO_SUPERCAR_BONUS, REPO_VEHICLE_TYPES, REPUTATION, reputationMultiplier } from '../data/contractsData.js';
import { CACHES, POIS, STUNT_JUMPS, TIME_TRIALS, poiById } from '../data/cityData.js';
import { dist2, mulberry32, pick } from './utils.js';
import { animateWalker, buildWalkerMesh } from './pedestrians.js';

export function createContracts(game) {
  let active = null;
  let beacon = null;
  let client = null;
  let targetVehicle = null;
  let trial = null;
  let suppressHeat = false;
  let offeredCache = null;
  let offeredSeed = -1;

  function lang() { return game.settings.language; }
  function text(pair) { return pair[lang()] || pair.en; }

  function clearBeacon() {
    if (beacon) {
      game.scene.remove(beacon);
      beacon = null;
    }
  }

  function setBeacon(x, z, color = 0x7fd4ff) {
    clearBeacon();
    beacon = game.city.createBeacon(x, z, color);
    game.scene.add(beacon);
    game.minimap.setTarget(x, z);
  }

  function randomPoint(random, nearX, nearZ, minDist, maxDist) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const node = game.roadgraph.randomNode(random, nearX, nearZ, minDist, maxDist);
      if (node) return { x: node.x, z: node.z };
    }
    const poi = pick(random, POIS);
    return { x: poi.x, z: poi.z };
  }

  function offered() {
    const seed = game.progress.contractSeed * 7919 + game.progress.contractsCompleted * 104729;
    if (offeredCache && offeredSeed === seed) return offeredCache;
    const random = mulberry32(seed);
    const types = [...CONTRACT_TYPES];
    for (let i = types.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    offeredSeed = seed;
    offeredCache = types.slice(0, 3).map((type, index) => {
      const pickup = randomPoint(random, game.player.x, game.player.z, 120, 500);
      const drop = randomPoint(random, pickup.x, pickup.z, 180, 620);
      const distance = dist2(pickup.x, pickup.z, drop.x, drop.z);
      const baseReward = Math.round((type.base + distance * type.perMetre) * type.risk);
      return {
        index,
        type: type.id,
        name: type.name,
        desc: type.desc,
        client: pick(random, CONTRACT_CLIENTS),
        pickup, drop, distance: Math.round(distance),
        reward: Math.round(baseReward * reputationMultiplier(game.progress.contractRep)),
        timeLimit: type.timePerMetre > 0 ? Math.round(distance * type.timePerMetre) + 45 : 0,
        startHeat: type.startHeat || 0,
      };
    });
    return offeredCache;
  }

  function accept(index) {
    const offer = offered()[index];
    if (!offer || active || game.missions.active) return false;
    active = { ...offer, stage: 'pickup', timer: offer.timeLimit, tag: 'contract-job' };
    game.audio.setMusicMode('mission');
    if (offer.type === 'vigilante') {
      suppressHeat = true;
      game.gangs.spawnSquad('rogue', offer.pickup.x, offer.pickup.z, 3, { tag: active.tag, hostile: true });
      active.stage = 'eliminate';
      setBeacon(offer.pickup.x, offer.pickup.z, 0xff5a4a);
      game.hud.setObjective(text(CONTRACT_TYPES.find((t) => t.id === 'vigilante').name), offer.pickup.x, offer.pickup.z);
    } else if (offer.type === 'repo') {
      const defId = REPO_VEHICLE_TYPES[Math.floor(Math.random() * REPO_VEHICLE_TYPES.length)];
      targetVehicle = game.vehicles.spawn(defId, offer.pickup.x, offer.pickup.z, 0, { mission: true });
      if (targetVehicle && targetVehicle.def.cls === 'supercar') {
        active.reward = Math.round(active.reward * REPO_SUPERCAR_BONUS);
      }
      const yard = poiById('chopshop');
      active.drop = { x: yard.x, z: yard.z };
      setBeacon(offer.pickup.x, offer.pickup.z);
      game.hud.setObjective(text(CONTRACT_TYPES.find((t) => t.id === 'repo').name), offer.pickup.x, offer.pickup.z);
    } else if (offer.type === 'getaway') {
      const parts = buildWalkerMesh(0x8a6a3a, 0xd9a77c, 0x1c1c1c, 0x222222);
      parts.group.position.set(offer.pickup.x, 0, offer.pickup.z);
      game.scene.add(parts.group);
      client = { x: offer.pickup.x, z: offer.pickup.z, parts, walkPhase: 0 };
      setBeacon(offer.pickup.x, offer.pickup.z);
      game.hud.setObjective(text(CONTRACT_TYPES.find((t) => t.id === 'getaway').name), offer.pickup.x, offer.pickup.z);
    } else {
      setBeacon(offer.pickup.x, offer.pickup.z);
      game.hud.setObjective(text(CONTRACT_TYPES.find((t) => t.id === 'delivery').name), offer.pickup.x, offer.pickup.z);
    }
    game.hud.notify(`${text(offer.name)} · ${text(offer.client)}`, 'info');
    return true;
  }

  function cleanup() {
    clearBeacon();
    game.minimap.setTarget(null, null);
    game.hud.clearObjective();
    game.hud.setTimer(null);
    game.hud.setCounter(null);
    if (client) {
      game.scene.remove(client.parts.group);
      client = null;
    }
    suppressHeat = false;
    game.audio.setMusicMode('explore');
  }

  function failActive(reason) {
    if (!active) return;
    game.progress.contractRep = Math.max(REPUTATION.min, game.progress.contractRep - REPUTATION.failLoss);
    game.gangs.removeTag(active.tag);
    cleanup();
    active = null;
    targetVehicle = null;
    game.hud.notify(game.lang(reason === 'timeOut' ? 'contractFailedTime' : 'contractFailed'), 'bad');
  }

  function completeActive() {
    let reward = active.reward;
    if (active.type === 'repo' && targetVehicle) {
      reward = Math.round(reward * (0.4 + 0.6 * (targetVehicle.integrity / 100)));
    }
    game.progress.contractRep = Math.min(REPUTATION.max, game.progress.contractRep + REPUTATION.successGain);
    game.progress.contractsCompleted += 1;
    game.progress.stats.contractsCompleted += 1;
    game.economy.earn(reward, text(active.name));
    game.gangs.removeTag(active.tag);
    cleanup();
    active = null;
    targetVehicle = null;
    offeredCache = null;
    game.save.autosave('contract');
  }

  function updateActive(dt) {
    const at = (x, z, radius) => dist2(game.player.x, game.player.z, x, z) < radius;
    if (active.timer > 0) {
      active.timer -= dt;
      game.hud.setTimer(active.timer);
      if (active.timer <= 0) {
        failActive('timeOut');
        return;
      }
    }
    if (active.type === 'delivery') {
      if (active.stage === 'pickup' && at(active.pickup.x, active.pickup.z, 10)) {
        active.stage = 'deliver';
        setBeacon(active.drop.x, active.drop.z);
        game.hud.setObjective(text(active.name), active.drop.x, active.drop.z);
        game.hud.notify(game.lang('cargoCollected'), 'good');
      } else if (active.stage === 'deliver' && at(active.drop.x, active.drop.z, 12)) {
        completeActive();
      }
    } else if (active.type === 'getaway') {
      if (active.stage === 'pickup' && at(active.pickup.x, active.pickup.z, 10)) {
        active.stage = 'escape';
        if (client) {
          game.scene.remove(client.parts.group);
          client = null;
        }
        game.wanted.addHeat(active.startHeat, game.player.x, game.player.z, { kind: 'getaway', forced: true });
        setBeacon(active.drop.x, active.drop.z);
        game.hud.setObjective(text(active.name), active.drop.x, active.drop.z);
        game.hud.notify(game.lang('heatRising'), 'bad');
      } else if (active.stage === 'escape' && at(active.drop.x, active.drop.z, 14)) {
        if (game.wanted.stars === 0) completeActive();
        else if (!active.warned) {
          active.warned = true;
          game.hud.notify(game.lang('losePoliceFirst'), 'bad');
        }
      }
    } else if (active.type === 'repo') {
      if (active.stage === 'pickup') {
        if (targetVehicle && targetVehicle.wrecked) {
          failActive('vehicleDestroyed');
          return;
        }
        if (targetVehicle && game.player.vehicle === targetVehicle) {
          active.stage = 'deliver';
          setBeacon(active.drop.x, active.drop.z);
          game.hud.setObjective(text(active.name), active.drop.x, active.drop.z);
        } else if (targetVehicle) {
          if (beacon) beacon.position.set(targetVehicle.x, 0, targetVehicle.z);
          game.minimap.setTarget(targetVehicle.x, targetVehicle.z);
        }
      } else if (active.stage === 'deliver' && game.player.vehicle === targetVehicle && at(active.drop.x, active.drop.z, 14)) {
        completeActive();
      }
    } else if (active.type === 'vigilante') {
      const left = game.gangs.aliveWithTag(active.tag);
      game.hud.setCounter(left);
      if (left === 0) {
        game.hud.setCounter(null);
        completeActive();
      }
    }
  }

  function updateCaches() {
    for (const cache of CACHES) {
      if (game.progress.cachesTaken.has(cache.id)) continue;
      if (dist2(game.player.x, game.player.z, cache.x, cache.z) < 4) {
        game.progress.cachesTaken.add(cache.id);
        game.economy.earn(ACTIVITY_REWARDS.cache, game.lang('cacheFound'));
        game.particles.heal(cache.x, 1.2, cache.z);
        if (game.progress.cachesTaken.size === CACHES.length) {
          game.economy.earn(ACTIVITY_REWARDS.cacheBonus, game.lang('cacheBonus'));
          game.hud.centerMessage(game.lang('allCaches'), 4);
        }
        break;
      }
    }
  }

  function recordStunt(airTime, airDist, x, z) {
    let best = null;
    let bestDist = 90;
    for (const jump of STUNT_JUMPS) {
      const d = dist2(x, z, jump.x, jump.z);
      if (d < bestDist) {
        bestDist = d;
        best = jump;
      }
    }
    if (!best) return;
    const score = Math.min(ACTIVITY_REWARDS.stuntCap, Math.round(ACTIVITY_REWARDS.stuntBase + airDist * ACTIVITY_REWARDS.stuntPerMetre + airTime * ACTIVITY_REWARDS.stuntPerSecond));
    const previous = game.progress.stunts[best.id];
    const isBest = !previous || score > previous.score;
    game.progress.stunts[best.id] = {
      score: Math.max(score, previous?.score || 0),
      dist: Math.max(airDist, previous?.dist || 0),
      time: Math.max(airTime, previous?.time || 0),
    };
    const reward = isBest ? score : ACTIVITY_REWARDS.stuntBase;
    game.economy.earn(reward, `${game.lang('stuntJump')} · ${Math.round(airDist)}m · ${airTime.toFixed(1)}s`);
    game.hud.centerMessage(`${game.lang('stuntJump')}! ${Math.round(airDist)}m`, 2.5);
  }

  function trialNear() {
    for (const trialDef of TIME_TRIALS) {
      if (dist2(game.player.x, game.player.z, trialDef.start[0], trialDef.start[1]) < 12) return trialDef;
    }
    return null;
  }

  function startTrial(trialDef) {
    if (trial || active || game.missions.active) return false;
    trial = { def: trialDef, gateIndex: 0, startTime: game.time };
    const first = trialDef.checkpoints[0];
    setBeacon(first[0], first[1], 0x9be07a);
    game.hud.setObjective(trialDef.name[lang()] || trialDef.name.en, first[0], first[1]);
    game.hud.notify(game.lang('trialStarted'), 'info');
    return true;
  }

  function updateTrial(dt) {
    if (!trial) return;
    const gate = trial.def.checkpoints[trial.gateIndex];
    if (gate && dist2(game.player.x, game.player.z, gate[0], gate[1]) < 14) {
      trial.gateIndex += 1;
      game.audio.playSfx('cash', game.player.x, game.player.z);
      if (trial.gateIndex >= trial.def.checkpoints.length) {
        const elapsed = game.time - trial.startTime;
        const previous = game.progress.trials[trial.def.id];
        const isBest = !previous || elapsed < previous;
        if (isBest) {
          game.progress.trials[trial.def.id] = elapsed;
          game.economy.earn(previous ? ACTIVITY_REWARDS.trialBeat : ACTIVITY_REWARDS.trialFirst, trial.def.name[lang()] || trial.def.name.en);
        }
        game.hud.centerMessage(`${trial.def.name[lang()] || trial.def.name.en} · ${elapsed.toFixed(1)}s${isBest ? ` · ${game.lang('newBest')}` : ''}`, 3);
        trial = null;
        clearBeacon();
        game.minimap.setTarget(null, null);
        game.hud.clearObjective();
      } else {
        const next = trial.def.checkpoints[trial.gateIndex];
        setBeacon(next[0], next[1], 0x9be07a);
        game.hud.setObjective(trial.def.name[lang()] || trial.def.name.en, next[0], next[1]);
      }
    }
    // Leaving the area abandons the trial.
    if (trial && dist2(game.player.x, game.player.z, trial.def.start[0], trial.def.start[1]) > 700) {
      trial = null;
      clearBeacon();
      game.minimap.setTarget(null, null);
      game.hud.clearObjective();
      game.hud.notify(game.lang('trialAbandoned'), 'bad');
    }
  }

  function cancelActive(cleanupWorld = true) {
    if (active) game.gangs.removeTag(active.tag);
    active = null;
    trial = null;
    if (cleanupWorld) cleanup();
  }

  function update(dt) {
    if (client) {
      client.walkPhase += dt * 2;
      animateWalker(client.parts, client.walkPhase, 0, false, false);
      client.parts.group.rotation.y += dt * 0.3;
    }
    if (beacon) {
      beacon.rotation.y += dt * 1.5;
      beacon.position.y = 0.2 + Math.sin(game.time * 2) * 0.15;
    }
    if (active) updateActive(dt);
    if (trial) updateTrial(dt);
    updateCaches();
  }

  return {
    get active() { return active; },
    get trial() { return trial; },
    get suppressHeat() { return suppressHeat; },
    offered, accept, failActive, cancelActive, update,
    stuntJumps: STUNT_JUMPS, recordStunt, trialNear, startTrial,
  };
}
