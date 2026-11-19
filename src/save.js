// save.js — real progress, honestly stored (SPEC §3.6).
//
// Three slots in localStorage plus autosave at mission checkpoints and
// on safehouse entry (the "Menyimpan…" indicator only ever appears when
// a write actually happens). Export/import is a JSON file with a
// FNV-1a checksum: a corrupt file is refused with a clear message, never
// a crash, and never silently wipes the player's slot. Schema is
// versioned (`saveVersion: 1`); unknown versions are refused, old
// versions migrate through explicit per-version functions.

export const SAVE_VERSION = 1;
const SLOT_KEY = (i) => `veyport-save-slot${i}`;

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function checksumOf(payload) {
  return fnv1a(JSON.stringify(payload));
}

export function createSave(deps) {
  const { player, vehicles, economy, weather, missions, contracts, wanted } = deps;
  const settings = () => (deps.getSettings ? deps.getSettings() : {});

  function collect() {
    const ps = player.state;
    const pv = vehicles.getPlayerVehicle();
    return {
      saveVersion: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: {
        x: ps.x, z: ps.z, heading: ps.heading,
        health: ps.health, armor: ps.armor,
        currentWeapon: ps.currentWeapon,
        weapons: Object.fromEntries(Object.entries(ps.weapons).map(([k, w]) => [k, { owned: w.owned, ammo: w.ammo, reserve: w.reserve }])),
      },
      vehicle: pv ? {
        type: pv.type, x: pv.x, z: pv.z, heading: pv.heading,
        integrity: pv.integrity, color: pv.color,
      } : null,
      economy: {
        cash: economy.cash,
        ledger: economy.ledger.slice(0, 50),
        garage: economy.garage.slice(),
        freeResprays: economy.state.freeResprays || 0,
      },
      missions: {
        completed: missions.state.completed.slice(),
        choices: { ...missions.state.choices },
        storyComplete: missions.state.storyComplete,
        ending: missions.state.ending,
      },
      contracts: {
        reputation: contracts.state.reputation,
        done: contracts.state.done,
        failed: contracts.state.failed,
        cachesFound: contracts.state.cachesFound.slice(),
        stuntBest: { ...contracts.state.stuntBest },
        trialBest: { ...contracts.state.trialBest },
      },
      wanted: { stars: wanted.stars, heat: wanted.heat },
      world: {
        dayTime: weather.dayTime,
        weather: weather.weather,
      },
      settings: settings(),
    };
  }

  function apply(data) {
    const ps = player.state;
    ps.x = data.player.x;
    ps.z = data.player.z;
    ps.heading = data.player.heading;
    ps.health = data.player.health;
    ps.armor = data.player.armor;
    ps.currentWeapon = data.player.currentWeapon;
    for (const [id, w] of Object.entries(data.player.weapons)) {
      if (ps.weapons[id]) {
        ps.weapons[id].owned = w.owned;
        ps.weapons[id].ammo = w.ammo;
        ps.weapons[id].reserve = w.reserve;
      } else {
        ps.weapons[id] = { owned: w.owned, ammo: w.ammo, reserve: w.reserve, mag: 0 };
      }
    }
    player.syncWeaponMesh();
    player.teleport(data.player.x, data.player.z, data.player.heading);
    if (data.vehicle) {
      const v = vehicles.makeVehicle(data.vehicle.type, data.vehicle.x, data.vehicle.z, data.vehicle.heading, { color: data.vehicle.color });
      v.integrity = data.vehicle.integrity;
    }
    economy.state.cash = data.economy.cash;
    economy.state.ledger = data.economy.ledger.slice();
    economy.state.garage = data.economy.garage.slice();
    economy.state.freeResprays = data.economy.freeResprays || 0;
    missions.state.completed = data.missions.completed.slice();
    missions.state.choices = { ...data.missions.choices };
    missions.state.storyComplete = data.missions.storyComplete;
    missions.state.ending = data.missions.ending;
    missions.state.activeIndex = -1;
    contracts.state.reputation = data.contracts.reputation;
    contracts.state.done = data.contracts.done;
    contracts.state.failed = data.contracts.failed;
    contracts.state.cachesFound = data.contracts.cachesFound.slice();
    contracts.state.stuntBest = { ...data.contracts.stuntBest };
    contracts.state.trialBest = { ...data.contracts.trialBest };
    wanted.setStars(data.wanted.stars);
    weather.setTime(data.world.dayTime * 24);
    if (data.world.weather) weather.state.weather = data.world.weather;
  }

  function migrate(data) {
    // Version 1 is current; older versions would migrate here, one
    // explicit function per version. Unknown versions are refused.
    if (data.saveVersion !== SAVE_VERSION) {
      return { ok: false, reason: 'unknown-version', version: data.saveVersion };
    }
    return { ok: true, data };
  }

  function validate(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'bad-json' };
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.payload || !parsed.checksum) {
      return { ok: false, reason: 'bad-shape' };
    }
    if (checksumOf(parsed.payload) !== parsed.checksum) {
      return { ok: false, reason: 'checksum' };
    }
    return migrate(parsed.payload);
  }

  function wrap(payload) {
    return JSON.stringify({ payload, checksum: checksumOf(payload) });
  }

  function saveSlot(i) {
    if (i < 1 || i > 3) return { ok: false, reason: 'bad-slot' };
    try {
      window.localStorage.setItem(SLOT_KEY(i), wrap(collect()));
    } catch {
      return { ok: false, reason: 'storage-full' };
    }
    return { ok: true };
  }

  function loadSlot(i) {
    if (i < 1 || i > 3) return { ok: false, reason: 'bad-slot' };
    const raw = window.localStorage.getItem(SLOT_KEY(i));
    if (!raw) return { ok: false, reason: 'empty' };
    const v = validate(raw);
    if (!v.ok) return v;
    apply(v.data);
    return { ok: true, savedAt: v.data.savedAt };
  }

  function slotInfo(i) {
    const raw = window.localStorage.getItem(SLOT_KEY(i));
    if (!raw) return { empty: true };
    const v = validate(raw);
    if (!v.ok) return { empty: false, corrupt: true, reason: v.reason };
    return {
      empty: false,
      savedAt: v.data.savedAt,
      cash: v.data.economy.cash,
      missions: v.data.missions.completed.length,
      storyComplete: v.data.missions.storyComplete,
    };
  }

  function deleteSlot(i) {
    window.localStorage.removeItem(SLOT_KEY(i));
    return { ok: true };
  }

  function exportSave(i) {
    const raw = window.localStorage.getItem(SLOT_KEY(i));
    if (!raw) return { ok: false, reason: 'empty' };
    return { ok: true, json: raw, filename: `veyport-save-slot${i}.json` };
  }

  function importSave(text) {
    const v = validate(text);
    if (!v.ok) return v;
    apply(v.data);
    return { ok: true, savedAt: v.data.savedAt };
  }

  /** Autosave: writes the first slot only when asked, and says so. */
  function autosave() {
    const r = saveSlot(1);
    if (r.ok && deps.onAutosave) deps.onAutosave();
    return r;
  }

  return {
    collect,
    apply,
    saveSlot,
    loadSlot,
    slotInfo,
    deleteSlot,
    exportSave,
    importSave,
    autosave,
    validate,
    wrap,
    get version() { return SAVE_VERSION; },
  };
}
