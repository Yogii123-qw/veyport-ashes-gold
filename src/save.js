// Three save slots, an autosave that fires only at real checkpoints,
// and export/import that round-trips through a checksummed, validated
// JSON file. A corrupted slot never deletes itself: the load screen
// offers the other slots and the import path instead.

import { canonicalStringify, fnv1a } from './utils.js';
import { PLAYER_SPAWN } from '../data/cityData.js';

export const SAVE_VERSION = 1;
const SLOT_KEY = (n) => `veyport.save.${n}`;
const SETTINGS_KEY = 'veyport.settings';
const LAST_SLOT_KEY = 'veyport.lastSlot';

export function createSave(game) {
  let lastSlot = 1;
  try {
    lastSlot = Number(localStorage.getItem(LAST_SLOT_KEY)) || 1;
  } catch { /* storage unavailable: saves stay in memory only */ }

  function collectState() {
    const p = game.progress;
    const parked = game.vehicles.serialize();
    const playerVehicle = game.player.vehicle
      ? parked.find((v) => v.plate === game.player.vehicle.plate) || null
      : null;
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: {
        x: game.player.x, z: game.player.z, heading: game.player.heading,
        hp: game.player.hp, armor: game.player.armor, armorTier: game.player.armorTier,
        medkits: game.player.medkits, weapon: game.player.currentWeapon,
        weapons: Object.fromEntries(Object.entries(game.player.weapons).map(([id, w]) => [id, { reserve: w.reserve, mag: w.mag }])),
      },
      vehicle: playerVehicle,
      parked,
      money: p.money,
      ledger: p.ledger.slice(0, 60),
      stats: { ...p.stats },
      reputation: { ...p.reputation },
      flags: { ...p.flags },
      garage: p.garage.map((g) => ({ ...g })),
      caches: [...p.cachesTaken],
      stunts: { ...p.stunts },
      trials: { ...p.trials },
      missionsCompleted: [...p.missionsCompleted],
      missionsActive: game.missions.active ? { id: game.missions.active.mission.id, stage: game.missions.active.checkpointIndex } : null,
      contractsCompleted: p.contractsCompleted,
      contractSeed: p.contractSeed,
      ending: p.ending,
      wanted: { heat: game.wanted.heat, stars: game.wanted.stars },
      clock: game.weather.hours,
      weather: game.weather.current,
      settings: { ...game.settings },
    };
  }

  function applyState(state) {
    const p = game.progress;
    game.missions.cancelActive(false);
    game.contracts.cancelActive(false);
    game.traffic.reset();
    // No vehicles.reset() here: restore() below clears the fleet itself
    // before rebuilding it from the save, so a reset would only spawn
    // parked cars that restore then duplicates.
    game.pedestrians.reset();
    game.gangs.reset();
    game.police.reset();
    game.combat.reset();
    p.money = state.money;
    p.ledger = state.ledger.map((e) => ({ ...e }));
    Object.assign(p.stats, state.stats);
    Object.assign(p.reputation, state.reputation);
    Object.assign(p.flags, state.flags);
    p.garage = state.garage.map((g) => ({ ...g }));
    p.cachesTaken = new Set(state.caches);
    p.stunts = { ...state.stunts };
    p.trials = { ...state.trials };
    p.missionsCompleted = new Set(state.missionsCompleted);
    p.contractsCompleted = state.contractsCompleted;
    p.contractSeed = state.contractSeed;
    p.ending = state.ending;
    // Vehicles first: the player's ride is restored by plate.
    const restored = game.vehicles.restore(state.parked);
    const playerVehicle = state.vehicle ? restored.find((v) => v.plate === state.vehicle.plate) || null : null;
    game.player.reset(PLAYER_SPAWN);
    game.player.teleport(state.player.x, state.player.z, state.player.heading);
    game.player.hp = state.player.hp;
    game.player.armor = state.player.armor;
    game.player.armorTier = state.player.armorTier;
    game.player.medkits = state.player.medkits;
    game.player.weapons = {};
    for (const [id, w] of Object.entries(state.player.weapons)) {
      game.player.weapons[id] = { reserve: w.reserve, mag: w.mag };
    }
    game.player.currentWeapon = state.player.weapon;
    if (playerVehicle) {
      game.player.vehicle = playerVehicle;
      playerVehicle.driver = 'player';
      game.player.parts.group.visible = false;
    }
    game.wanted.setState(state.wanted.heat, state.wanted.stars);
    game.weather.setState(state.clock, state.weather);
    Object.assign(game.settings, state.settings);
    game.audio.applyVolumes();
    if (state.missionsActive) {
      game.missions.startMission(state.missionsActive.id, { fromStage: state.missionsActive.stage, replay: true });
    }
  }

  function checksumOf(payload) {
    return fnv1a(canonicalStringify(payload));
  }

  function validateFile(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'invalid-json' };
    }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'not-object' };
    if (parsed.version !== SAVE_VERSION) return { ok: false, error: 'version' };
    if (typeof parsed.checksum !== 'string') return { ok: false, error: 'checksum-missing' };
    if (checksumOf(parsed.payload) !== parsed.checksum) return { ok: false, error: 'checksum' };
    const s = parsed.payload;
    const good = s
      && typeof s.money === 'number'
      && s.player && typeof s.player.x === 'number' && typeof s.player.z === 'number'
      && typeof s.player.hp === 'number'
      && s.player.weapons && typeof s.player.weapons === 'object'
      && Array.isArray(s.caches) && Array.isArray(s.missionsCompleted)
      && Array.isArray(s.parked) && s.settings && typeof s.settings === 'object'
      && typeof s.clock === 'number' && typeof s.weather === 'string';
    if (!good) return { ok: false, error: 'schema' };
    return { ok: true, state: s };
  }

  function wrap(payload) {
    return { version: SAVE_VERSION, checksum: checksumOf(payload), payload };
  }

  function writeSlot(slot) {
    const state = collectState();
    const text = JSON.stringify(wrap(state));
    try {
      localStorage.setItem(SLOT_KEY(slot), text);
      localStorage.setItem(LAST_SLOT_KEY, String(slot));
      lastSlot = slot;
    } catch {
      game.hud.notify(game.lang('saveFailed'), 'bad');
      return false;
    }
    return true;
  }

  function saveSlot(slot) {
    game.hud.setSaving(true);
    const ok = writeSlot(slot);
    setTimeout(() => game.hud.setSaving(false), 400);
    if (ok) game.hud.notify(game.lang('saved'), 'good');
    return ok;
  }

  function autosave(reason) {
    game.hud.setSaving(true);
    writeSlot(lastSlot);
    setTimeout(() => game.hud.setSaving(false), 400);
    game.hud.notify(`${game.lang('autosaved')} · ${reason}`, 'good');
  }

  function slotInfo(slot) {
    let text = null;
    try { text = localStorage.getItem(SLOT_KEY(slot)); } catch { /* no storage */ }
    if (!text) return { exists: false };
    const result = validateFile(text);
    if (!result.ok) return { exists: true, corrupted: true, error: result.error };
    const s = result.state;
    return {
      exists: true,
      savedAt: s.savedAt,
      money: s.money,
      missions: s.missionsCompleted.length,
      clock: s.clock,
      weather: s.weather,
      ending: s.ending,
    };
  }

  function loadSlot(slot) {
    let text = null;
    try { text = localStorage.getItem(SLOT_KEY(slot)); } catch { /* no storage */ }
    if (!text) return { ok: false, error: 'empty' };
    const result = validateFile(text);
    if (!result.ok) return { ok: false, error: result.error };
    applyState(result.state);
    lastSlot = slot;
    try { localStorage.setItem(LAST_SLOT_KEY, String(slot)); } catch { /* ignore */ }
    return { ok: true };
  }

  function deleteSlot(slot) {
    try { localStorage.removeItem(SLOT_KEY(slot)); } catch { /* ignore */ }
  }

  function exportSlot(slot) {
    let text = null;
    try { text = localStorage.getItem(SLOT_KEY(slot)); } catch { /* no storage */ }
    if (!text) {
      // No slot yet: export the live state so the file is never empty.
      text = JSON.stringify(wrap(collectState()));
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `veyport-save-slot${slot}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    game.hud.notify(game.lang('exported'), 'good');
  }

  function importText(text, slot) {
    const result = validateFile(text);
    if (!result.ok) return result;
    try {
      localStorage.setItem(SLOT_KEY(slot), JSON.stringify(wrap(result.state)));
    } catch {
      return { ok: false, error: 'storage' };
    }
    return { ok: true, state: result.state };
  }

  function loadSettings() {
    try {
      const text = localStorage.getItem(SETTINGS_KEY);
      if (!text) return;
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') Object.assign(game.settings, parsed);
    } catch { /* keep defaults */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.settings)); } catch { /* ignore */ }
  }

  return {
    saveSlot, loadSlot, deleteSlot, slotInfo, exportSlot, importText,
    autosave, loadSettings, saveSettings, validateFile, collectState, applyState,
    get lastSlot() { return lastSlot; },
  };
}
