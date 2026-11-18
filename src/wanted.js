// The wanted system: heat from real crimes, five stars, fair decay.
// Heat rises when crimes are seen, falls when the player is not, and
// stars step down one at a time after 45 unseen seconds. Getting caught
// costs money and illegal guns; dying costs a hospital bill. Clearing
// the heat is possible three ways: outrun it, repaint the car, or pay
// the contact at the bar.

import { clamp, dist2 } from './utils.js';

export const HEAT_THRESHOLDS = [10, 30, 55, 80, 95];
export const STAR_DECAY_SECONDS = 45;

export function createWanted(game) {
  let heat = 0;
  let stars = 0;
  let unseenTimer = 0;
  let seen = false;
  let lastKnown = null;
  let arrestTimer = 0;
  let starFlash = 0;
  // WASTED cinematic: instead of an instant cut to the hospital, the
  // camera cranes up over the body until the police helicopter is in
  // frame, and only then does the respawn flow run.
  let wastedSeq = null;
  const WASTED_CRANE_SECONDS = 7;

  function starsForHeat(value) {
    let count = 0;
    for (const threshold of HEAT_THRESHOLDS) {
      if (value >= threshold) count += 1;
    }
    return count;
  }

  function setStars(next, reason) {
    const before = stars;
    stars = clamp(next, 0, 5);
    if (stars > before) {
      game.hud.notify(`${game.lang('wantedUp')}: ${'★'.repeat(stars)}`, 'bad');
      game.hud.showWantedBanner(stars);
      game.audio.playSfx('fail');
      starFlash = 1;
    } else if (stars < before && stars > 0) {
      game.hud.notify(`${game.lang('wantedDown')}: ${'★'.repeat(stars)}`, 'good');
    } else if (stars === 0 && before > 0) {
      game.hud.notify(game.lang('wantedClear'), 'good');
      game.audio.playSfx('success');
    }
    if (reason === 'decay' && stars === 0) heat = 0;
    game.events.emit('wantedChanged', { stars, heat });
  }

  function witnessedAt(x, z) {
    // A police unit with line of sight, or a civilian watching.
    for (const unit of game.police.units) {
      if (unit.vehicle && dist2(unit.vehicle.x, unit.vehicle.z, x, z) < 70 && !game.physics.segmentBlocked(unit.vehicle.x, unit.vehicle.z, x, z)) return true;
      if (unit.officer && dist2(unit.officer.x, unit.officer.z, x, z) < 40 && !game.physics.segmentBlocked(unit.officer.x, unit.officer.z, x, z)) return true;
    }
    for (const w of game.pedestrians.walkers) {
      if (w.state === 'dead') continue;
      if (dist2(w.x, w.z, x, z) < 30 && !game.physics.segmentBlocked(w.x, w.z, x, z)) return true;
    }
    return false;
  }

  function addHeat(amount, x, z, opts = {}) {
    if (game.missions && game.missions.suppressHeat) return;
    if (game.contracts && game.contracts.suppressHeat) return;
    let applied = amount;
    if ((opts.kind === 'carjack' || opts.kind === 'property') && !opts.forced) {
      applied = witnessedAt(x, z) ? amount : 3;
    }
    heat = clamp(heat + applied, 0, 100);
    if (applied > 0) {
      lastKnown = { x, z };
      unseenTimer = 0;
    }
    const next = starsForHeat(heat);
    if (next > stars) setStars(next);
  }

  game.events.on('crime', ({ kind, x, z, heat: amount, silent }) => {
    if (game.missions && game.missions.suppressHeat) return;
    if (game.contracts && game.contracts.suppressHeat) return;
    if (silent) {
      heat = clamp(heat + amount, 0, 100);
      const next = starsForHeat(heat);
      if (next > stars) setStars(next);
      return;
    }
    addHeat(amount, x, z, { kind });
  });

  function computeSeen(dt) {
    const vision = 60 * game.weather.visionMultiplier();
    let isSeen = false;
    for (const unit of game.police.units) {
      const vx = unit.officer ? unit.officer.x : unit.vehicle ? unit.vehicle.x : null;
      const vz = unit.officer ? unit.officer.z : unit.vehicle ? unit.vehicle.z : null;
      if (vx === null) continue;
      const d = dist2(vx, vz, game.player.x, game.player.z);
      if (d < vision && !game.physics.segmentBlocked(vx, vz, game.player.x, game.player.z)) {
        isSeen = true;
        break;
      }
    }
    if (!isSeen && game.police.heliActive && game.police.spotlightOnPlayer()) isSeen = true;
    if (isSeen) {
      seen = true;
      unseenTimer = 0;
      lastKnown = { x: game.player.x, z: game.player.z };
    } else {
      seen = false;
    }
    return seen;
  }

  function update(dt) {
    starFlash = Math.max(0, starFlash - dt);
    if (stars === 0 && heat <= 0) return;
    computeSeen(dt);
    if (!seen && stars > 0) {
      let rate = 3.2;
      if (game.weather.isNight()) rate *= 1.5;
      if (game.weather.current === 'rain') rate *= 1.4;
      if (game.weather.current === 'storm') rate *= 1.6;
      if (game.physics.inTunnel(game.player.x, game.player.z)) rate *= 2;
      heat = Math.max(0, heat - rate * dt);
      unseenTimer += dt;
      if (unseenTimer >= STAR_DECAY_SECONDS) {
        unseenTimer = 0;
        heat = stars > 1 ? HEAT_THRESHOLDS[stars - 2] - 1 : 0;
        setStars(stars - 1, 'decay');
      }
    }
    // Arrest: an officer standing on a stopped, wanted player.
    if (stars >= 1 && !game.player.vehicle && game.player.speed < 1) {
      const officerNear = game.police.units.some((u) => u.officer && dist2(u.officer.x, u.officer.z, game.player.x, game.player.z) < 2.8);
      if (officerNear) {
        arrestTimer += dt;
        if (arrestTimer >= 2) {
          arrestTimer = 0;
          onPlayerArrest();
        }
      } else {
        arrestTimer = 0;
      }
    } else {
      arrestTimer = 0;
    }
  }

  function clearWanted() {
    heat = 0;
    setStars(0);
    unseenTimer = 0;
    lastKnown = null;
  }

  function onPlayerArrest() {
    const fine = Math.min(200, game.economy.money);
    game.economy.spend(fine, game.settings.language === 'id' ? 'Denda tahanan' : 'Arrest fine');
    const seized = [];
    for (const id of ['kr9', 'iron12', 'vk7']) {
      if (game.player.weapons[id]) {
        delete game.player.weapons[id];
        seized.push(id);
      }
    }
    if (!game.player.weapons[game.player.currentWeapon]) game.player.currentWeapon = 'p9';
    clearWanted();
    game.player.teleport(14, -300, Math.PI);
    game.hud.centerMessage(game.lang('busted'), 2.4);
    game.hud.notify(game.lang('arrested'), 'bad');
    game.audio.playSfx('fail');
    game.events.emit('busted', { fine, seized });
    if (game.missions.active) game.missions.failActive('busted');
    if (game.contracts.active) game.contracts.failActive('busted');
  }

  function onPlayerDeath(source) {
    const bill = 200 + Math.floor(game.economy.money * 0.1);
    const paid = Math.min(bill, game.economy.money);
    game.economy.spend(paid, game.settings.language === 'id' ? 'Biaya rumah sakit' : 'Hospital bill');
    clearWanted();
    game.hud.notify(game.lang('hospital'), 'bad');
    game.audio.playSfx('fail');
    game.events.emit('wasted', { bill: paid, source });
    if (game.missions.active) game.missions.failActive('wasted');
    if (game.contracts.active) game.contracts.failActive('wasted');
    // The body stays where it fell; the crane shot runs first and the
    // hospital respawn happens when it ends (see updateWasted).
    wastedSeq = {
      t: 0,
      focus: { x: game.player.x, z: game.player.z },
    };
    game.police.ensureHeliOverhead();
    game.cameraRig.beginWasted();
  }

  /**
   * Advance the WASTED crane shot. Returns true while the shot is still
   * running; when it ends, the hospital respawn flow runs and the
   * player is alive again at St. Anselm.
   */
  function updateWasted(dt) {
    if (!wastedSeq) return false;
    wastedSeq.t += dt;
    const t01 = clamp(wastedSeq.t / WASTED_CRANE_SECONDS, 0, 1);
    game.cameraRig.updateWasted(dt, wastedSeq.focus, game.police.heliPos, t01);
    if (wastedSeq.t < WASTED_CRANE_SECONDS) return true;
    wastedSeq = null;
    game.player.hp = game.player.maxHp;
    game.player.dead = false;
    game.player.teleport(286, 30, -Math.PI / 2);
    game.cameraRig.snapBehind(game.player.heading);
    game.hud.centerMessage(game.lang('wasted'), 2.4);
    game.police.releaseHeli();
    return false;
  }

  return {
    get heat() { return heat; },
    set heat(v) { heat = clamp(v, 0, 100); },
    get stars() { return stars; },
    get seen() { return seen; },
    get lastKnown() { return lastKnown; },
    get starFlash() { return starFlash; },
    get wastedActive() { return !!wastedSeq; },
    get wastedProgress() { return wastedSeq ? clamp(wastedSeq.t / WASTED_CRANE_SECONDS, 0, 1) : 0; },
    addHeat,
    clearWanted,
    update,
    updateWasted,
    onPlayerArrest,
    onPlayerDeath,
    setState(nextHeat, nextStars) {
      heat = clamp(nextHeat, 0, 100);
      stars = clamp(nextStars, 0, 5);
      wastedSeq = null;
    },
  };
}
