// save.js - real save/load for Veyport.
// Three localStorage slots plus an autosave slot, JSON export/import with
// schema validation and an FNV-1a checksum. A corrupt slot is reported,
// never silently deleted, and never crashes the game.

export const SAVE_VERSION = 1;
const SLOT_KEY = (n) => `veyport-r4-save-slot${n}`;
const AUTO_KEY = 'veyport-r4-autosave';

// FNV-1a 32-bit, hex string. Small, deterministic, good enough to catch
// a hand-edited or truncated save file.
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// The full save schema (version 1). collect() reads live objects,
// apply() writes them back. Nothing here invents state: every field
// comes from a system that owns it.
export class SaveSys {
  constructor() {
    this.lastError = '';
  }

  collect(w) {
    const p = w.player;
    const data = {
      saveVersion: SAVE_VERSION,
      savedAt: Date.now(),
      player: {
        x: p.x, z: p.z, heading: p.heading,
        hp: p.hp, armor: p.armor,
        weapon: p.weapon,
        owned: JSON.parse(JSON.stringify(p.owned)),
      },
      money: w.economy.balance,
      ledger: w.economy.ledger.slice(-20),
      missions: w.missions ? w.missions.saveState() : { completed: [], active: null, stage: 0, flags: {} },
      contracts: w.contracts ? w.contracts.saveState() : { done: 0, rep: 50 },
      wanted: w.wanted ? { heat: w.wanted.heat, stars: w.wanted.stars } : { heat: 0, stars: 0 },
      clock: w.weather.clock,
      weather: w.weather.state,
      stats: w.stats || { playSeconds: 0, distanceM: 0, carsStolen: 0, shots: 0, hits: 0, missionsFailed: 0 },
      settings: w.settings || { lang: 'id', master: 0.8, music: 0.5, sfx: 0.8 },
    };
    const body = JSON.stringify(data);
    return { ...data, checksum: checksum(body) };
  }

  validate(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      this.lastError = 'File bukan JSON yang valid';
      return null;
    }
    if (!parsed || typeof parsed !== 'object') {
      this.lastError = 'Struktur save tidak dikenal';
      return null;
    }
    if (parsed.saveVersion !== SAVE_VERSION) {
      this.lastError = `Versi save ${parsed.saveVersion} tidak didukung (game ini versi ${SAVE_VERSION})`;
      return null;
    }
    const { checksum: sum, ...rest } = parsed;
    if (checksum(JSON.stringify(rest)) !== sum) {
      this.lastError = 'Checksum tidak cocok, file mungkin rusak atau diubah';
      return null;
    }
    if (!parsed.player || !isNum(parsed.player.x) || !isNum(parsed.player.z)) {
      this.lastError = 'Data pemain hilang atau rusak';
      return null;
    }
    return parsed;
  }

  apply(parsed, w) {
    const p = w.player;
    const sp = parsed.player;
    p.x = sp.x; p.z = sp.z; p.heading = sp.heading;
    p.hp = Math.max(1, Math.min(100, sp.hp));
    p.armor = Math.max(0, Math.min(100, sp.armor || 0));
    p.owned = sp.owned || p.owned;
    if (sp.weapon && p.owned[sp.weapon]) p.switchWeapon(sp.weapon);
    p.group.position.set(p.x, 0, p.z);
    p.group.rotation.y = p.heading;
    if (typeof parsed.money === 'number') w.economy.balance = parsed.money;
    if (Array.isArray(parsed.ledger)) w.economy.ledger = parsed.ledger;
    if (parsed.missions && w.missions) w.missions.loadState(parsed.missions);
    if (parsed.contracts && w.contracts) w.contracts.loadState(parsed.contracts);
    if (parsed.wanted && w.wanted) {
      w.wanted.heat = parsed.wanted.heat || 0;
      w.wanted.stars = parsed.wanted.stars || 0;
    }
    if (isNum(parsed.clock)) w.weather.clock = parsed.clock;
    if (parsed.weather && w.weather) w.weather.state = parsed.weather;
    // Merge into the live objects, never replace them: boot.js and the
    // systems all hold the same stats/settings references, and replacing
    // the object would silently stop playSeconds from advancing.
    if (parsed.stats) Object.assign(w.stats, parsed.stats);
    if (parsed.settings) Object.assign(w.settings, parsed.settings);
  }

  writeSlot(n, w) {
    try {
      const data = this.collect(w);
      localStorage.setItem(SLOT_KEY(n), JSON.stringify(data));
      return true;
    } catch (e) {
      this.lastError = 'Gagal menulis slot: ' + (e.message || e);
      return false;
    }
  }

  readSlot(n) {
    const raw = localStorage.getItem(SLOT_KEY(n));
    if (!raw) {
      this.lastError = 'Slot kosong';
      return null;
    }
    return this.validate(raw);
  }

  autosave(w) {
    try {
      const data = this.collect(w);
      localStorage.setItem(AUTO_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      this.lastError = 'Autosave gagal: ' + (e.message || e);
      return false;
    }
  }

  readAutosave() {
    const raw = localStorage.getItem(AUTO_KEY);
    if (!raw) return null;
    return this.validate(raw);
  }

  // Export: returns the JSON text for a download button to save.
  exportText(w) {
    return JSON.stringify(this.collect(w), null, 2);
  }

  importText(raw) {
    return this.validate(raw);
  }

  hasSlot(n) {
    return localStorage.getItem(SLOT_KEY(n)) !== null;
  }

  hasAutosave() {
    return localStorage.getItem(AUTO_KEY) !== null;
  }
}
