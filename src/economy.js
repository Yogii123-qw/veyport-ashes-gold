// Money in, money out, every transaction on the books. The ledger in
// the pause menu is the audit trail: no cash appears from nowhere and
// no charge happens without a line saying why. Shops, fines, repairs
// and upgrades all pass through here.

import { ARMOR, ITEMS, WEAPONS, weaponById, weaponName } from '../data/weaponsData.js';
import { VEHICLES } from '../data/vehiclesData.js';
import { formatClock, formatMoney } from './utils.js';

export const PRICES = {
  respray: 300,
  bribe: 500,
  garageUpgrade: 1000,
  armoryUpgrade: 800,
};

export function createEconomy(game) {
  function ledger(label, amount) {
    const entry = {
      time: formatClock(game.weather.hours),
      label,
      amount,
      balance: game.progress.money,
    };
    game.progress.ledger.unshift(entry);
    if (game.progress.ledger.length > 200) game.progress.ledger.length = 200;
    game.events.emit('money', { amount, label });
  }

  function earn(amount, label) {
    if (amount <= 0) return;
    game.progress.money += amount;
    game.progress.stats.moneyEarned += amount;
    ledger(label, amount);
    game.hud.notify(`+${formatMoney(amount)} · ${label}`, 'good');
    game.audio.playSfx('cash', game.player.x, game.player.z);
  }

  function spend(amount, label) {
    if (amount <= 0) return true;
    if (game.progress.money < amount) {
      game.hud.notify(game.lang('noMoney'), 'bad');
      return false;
    }
    game.progress.money -= amount;
    game.progress.stats.moneySpent += amount;
    ledger(label, -amount);
    return true;
  }

  function spendForced(amount, label) {
    const paid = Math.min(amount, game.progress.money);
    game.progress.money -= paid;
    game.progress.stats.moneySpent += paid;
    ledger(label, -paid);
    return paid;
  }

  function buyWeapon(id) {
    const def = weaponById(id);
    if (game.player.weapons[id]) return { ok: false, reason: 'owned' };
    if (!spend(def.price, weaponName(def, game.settings.language))) return { ok: false, reason: 'money' };
    game.player.giveWeapon(id, true);
    return { ok: true };
  }

  function buyAmmo(id) {
    const def = weaponById(id);
    if (!game.player.weapons[id]) return { ok: false, reason: 'noweapon' };
    if (!spend(def.ammoPrice, `${game.settings.language === 'id' ? 'Amunisi' : 'Ammo'} ${weaponName(def, game.settings.language)}`)) return { ok: false, reason: 'money' };
    game.player.weapons[id].reserve += def.ammoPack;
    return { ok: true };
  }

  function buyArmor(tier) {
    const info = ARMOR[tier];
    if (!info || tier === 'none') return { ok: false, reason: 'bad' };
    if (tier === 'heavy' && !game.progress.flags.heavyArmor) return { ok: false, reason: 'locked' };
    if (!spend(info.price, info.name[game.settings.language] || info.name.en)) return { ok: false, reason: 'money' };
    game.player.armor = 100;
    game.player.armorTier = tier;
    return { ok: true };
  }

  function buyMedkit() {
    if (game.player.medkits >= 3) return { ok: false, reason: 'full' };
    if (!spend(ITEMS.medkit.price, ITEMS.medkit.name[game.settings.language] || ITEMS.medkit.name.en)) return { ok: false, reason: 'money' };
    game.player.medkits += 1;
    return { ok: true };
  }

  function buyFood() {
    if (game.player.hp >= game.player.maxHp) return { ok: false, reason: 'full' };
    if (!spend(ITEMS.food.price, ITEMS.food.name[game.settings.language] || ITEMS.food.name.en)) return { ok: false, reason: 'money' };
    game.player.heal(ITEMS.food.heal);
    return { ok: true };
  }

  function respray(vehicle, colorHex) {
    if (!vehicle) return { ok: false, reason: 'nocar' };
    if (game.progress.flags.freeRespray > 0) {
      game.progress.flags.freeRespray -= 1;
    } else if (!spend(PRICES.respray, game.settings.language === 'id' ? 'Cat ulang' : 'Respray')) {
      return { ok: false, reason: 'money' };
    }
    vehicle.color = colorHex;
    vehicle.bodyMat.color.set(colorHex);
    game.wanted.clearWanted();
    game.hud.notify(game.lang('resprayDone'), 'good');
    return { ok: true };
  }

  function bribe() {
    if (game.wanted.stars < 1 || game.wanted.stars > 2) return { ok: false, reason: 'stars' };
    if (!spend(PRICES.bribe, game.settings.language === 'id' ? 'Suap kontak' : 'Street bribe')) return { ok: false, reason: 'money' };
    game.wanted.clearWanted();
    game.hud.notify(game.lang('bribeDone'), 'good');
    return { ok: true };
  }

  function sellVehicle(vehicle) {
    const value = game.vehicles.sellValue(vehicle);
    if (value <= 0) return { ok: false, reason: 'nosale' };
    earn(value, `${game.settings.language === 'id' ? 'Jual' : 'Sold'} ${vehicle.def.name[game.settings.language] || vehicle.def.name.en} (${vehicle.plate})`);
    if (game.player.vehicle === vehicle) game.player.exitVehicle();
    game.vehicles.remove(vehicle);
    game.hud.notify(game.lang('soldVehicle'), 'good');
    return { ok: true, value };
  }

  function buyGarageUpgrade() {
    if (game.progress.flags.garageUpgraded) return { ok: false, reason: 'owned' };
    if (!spend(PRICES.garageUpgrade, game.settings.language === 'id' ? 'Upgrade garasi' : 'Garage upgrade')) return { ok: false, reason: 'money' };
    game.progress.flags.garageUpgraded = true;
    return { ok: true };
  }

  function buyArmoryUpgrade() {
    if (game.progress.flags.armoryUpgraded) return { ok: false, reason: 'owned' };
    if (!spend(PRICES.armoryUpgrade, game.settings.language === 'id' ? 'Gudang senjata' : 'Armory')) return { ok: false, reason: 'money' };
    game.progress.flags.armoryUpgraded = true;
    return { ok: true };
  }

  function garageCapacity() {
    return game.progress.flags.garageUpgraded ? 4 : 2;
  }

  function storeVehicle(vehicle) {
    if (game.progress.garage.length >= garageCapacity()) {
      game.hud.notify(game.lang('garageFull'), 'bad');
      return false;
    }
    if (vehicle.def.police || vehicle.def.missionOnly) return false;
    game.progress.garage.push({
      defId: vehicle.defId, color: vehicle.color, integrity: vehicle.integrity, plate: vehicle.plate,
    });
    if (game.player.vehicle === vehicle) game.player.exitVehicle();
    game.vehicles.remove(vehicle);
    game.hud.notify(game.lang('vehicleStored'), 'good');
    game.audio.playSfx('door', game.player.x, game.player.z);
    return true;
  }

  function retrieveVehicle(index, x, z, heading) {
    const entry = game.progress.garage[index];
    if (!entry) return null;
    // A stale entry (edited save, removed vehicle type) must never
    // crash the spawn: drop it and tell the player, instead of dying.
    if (!VEHICLES[entry.defId]) {
      game.progress.garage.splice(index, 1);
      game.hud.notify(game.lang('garageStale'), 'bad');
      return null;
    }
    game.progress.garage.splice(index, 1);
    return game.vehicles.spawn(entry.defId, x, z, heading, { color: entry.color, integrity: entry.integrity });
  }

  function armoryRefill() {
    if (!game.progress.flags.armoryUpgraded) return false;
    const day = Math.floor(game.progress.stats.playSeconds / (18 * 60));
    if (game.progress.flags.lastRefillDay === day) return false;
    game.progress.flags.lastRefillDay = day;
    for (const weapon of WEAPONS) {
      const slot = game.player.weapons[weapon.id];
      if (slot && weapon.magSize > 0) slot.reserve = Math.max(slot.reserve, weapon.ammoPack);
    }
    return true;
  }

  function sleep() {
    game.weather.advanceHours(8);
    game.player.hp = game.player.maxHp;
    game.player.armor = game.player.armorTier === 'none' ? 0 : 100;
    game.hud.notify(game.lang('safehouseSlept'), 'good');
    game.save.autosave('sleep');
  }

  return {
    get money() { return game.progress.money; },
    earn, spend, spendForced, ledger,
    buyWeapon, buyAmmo, buyArmor, buyMedkit, buyFood,
    respray, bribe, sellVehicle, buyGarageUpgrade, buyArmoryUpgrade,
    garageCapacity, storeVehicle, retrieveVehicle, armoryRefill, sleep,
  };
}
