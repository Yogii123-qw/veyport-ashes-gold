// economy.js — money in, money out, all of it audited, rewritten in phase 2.
//
// SPEC §3.4: no money appears from thin air. Every transaction is a
// ledger entry the player can audit in the pause menu. The core is the
// phase-1 set — cash, the ledger, the armory (ammo / medkit / armor),
// the garage (store / retrieve / respray), the chop shop (sell a stolen
// car for its condition-adjusted price) — plus the phase-2 additions:
// free resprays granted by mission M3, a chop price for a garaged
// record (the pause menu sells stored cars without spawning them), and
// the safehouse upgrade. Missions and contracts pay through earn();
// wanted fines pay through spend(). New shops register through
// registerShopItem() — nothing is hardcoded into the HUD.
//
// One real change from phase 1: the respray no longer disposes and
// rebuilds geometry. Vehicle body geometry is cached per (type, colour)
// in vehicles.js, so a repaint is a cache lookup — faster, and it can
// never free a geometry another car is still using.

import { WEAPONS } from './player.js';
import { VEHICLES, vehicleName } from './vehiclesData.js';

export const STARTING_CASH = 500;
const GARAGE_CAPACITY = 4;
const RESPRAY_PRICE = 300;

export function createEconomy(bus) {
  const state = {
    cash: STARTING_CASH,
    ledger: [],
    garage: [], // stored vehicle records {type, color, integrity, name}
    freeResprays: 0, // granted by mission M3; each one waives RESPRAY_PRICE
    safehouseLevel: 0,
  };

  let playerRef = null;
  let vehiclesRef = null;

  function bind(player, vehicles) {
    playerRef = player;
    vehiclesRef = vehicles;
  }

  function record(label, amount) {
    state.ledger.unshift({
      time: new Date().toISOString(),
      label,
      amount,
      balance: state.cash,
    });
    if (state.ledger.length > 200) state.ledger.length = 200;
    bus.emit('ledger', { label, amount, balance: state.cash });
  }

  function earn(amount, label) {
    if (amount <= 0) return false;
    state.cash += amount;
    record(label, amount);
    bus.emit('money', { delta: amount, cash: state.cash, label });
    return true;
  }

  function spend(amount, label) {
    if (amount <= 0) return true;
    if (state.cash < amount) return false;
    state.cash -= amount;
    record(label, -amount);
    bus.emit('money', { delta: -amount, cash: state.cash, label });
    return true;
  }

  // ---- Shop catalog (phase 2 extends it via registerShopItem) ----
  function buildCatalog() {
    const items = [];
    const add = (item) => items.push(item);
    // Armory: ammo, medkit, armor.
    add({
      id: 'ammo-p9', shop: 'armory', name: { en: 'P9 ammo ×24', id: 'Amunisi P9 ×24' },
      price: 20, canBuy: () => !!playerRef?.state.weapons.p9?.owned,
      apply: () => { playerRef.state.weapons.p9.reserve += 24; },
    });
    for (const wId of ['kr9', 'iron12', 'vk7']) {
      const def = WEAPONS[wId];
      if (!def) continue;
      add({
        id: `ammo-${wId}`, shop: 'armory',
        name: { en: `${def.name.en} ammo ×${def.ammoPack}`, id: `Amunisi ${def.name.en} ×${def.ammoPack}` },
        price: def.ammoPrice, canBuy: () => !!playerRef?.state.weapons[wId]?.owned,
        apply: () => { playerRef.state.weapons[wId].reserve += def.ammoPack; },
      });
    }
    add({
      id: 'medkit', shop: 'armory', name: { en: 'Medkit (+50 HP)', id: 'Medkit (+50 HP)' },
      price: 100, canBuy: () => playerRef && playerRef.state.health < 100,
      apply: () => { playerRef.state.health = Math.min(100, playerRef.state.health + 50); },
    });
    add({
      id: 'armor', shop: 'armory', name: { en: 'Body armor (+50)', id: 'Rompi antipeluru (+50)' },
      price: 150, canBuy: () => playerRef && playerRef.state.armor < 100,
      apply: () => { playerRef.state.armor = Math.min(100, playerRef.state.armor + 50); },
    });
    // Garage: respray — free while a granted respray is banked.
    add({
      id: 'respray', shop: 'garage', name: { en: 'Respray (new paint)', id: 'Respray (cat baru)' },
      price: RESPRAY_PRICE, canBuy: () => !!vehiclesRef?.getPlayerVehicle(),
      apply: () => {
        const v = vehiclesRef.getPlayerVehicle();
        const palette = v.def.colors;
        let next = palette[Math.floor(Math.random() * palette.length)];
        if (palette.length > 1) {
          while (next === v.color) next = palette[Math.floor(Math.random() * palette.length)];
        }
        v.color = next;
        // Colour lives in the merged vertices; the geometry cache makes
        // a repaint a swap to the cached geometry of the new colour.
        v.body.geometry = vehiclesRef.bodyGeometry(v.def, next);
      },
    });
    // Safehouse upgrade: +1 garage slot per level, up to 6 total.
    add({
      id: 'safehouse', shop: 'garage',
      name: { en: 'Safehouse upgrade (+1 slot)', id: 'Upgrade safehouse (+1 slot)' },
      price: 2000, canBuy: () => state.safehouseLevel < 2,
      apply: () => { state.safehouseLevel += 1; },
    });
    return items;
  }
  const catalog = buildCatalog();

  /** Mission M3 grants one free respray; the shop consumes it first. */
  function grantFreeRespray() {
    state.freeResprays += 1;
  }

  function registerShopItem(item) {
    catalog.push(item);
  }

  function shopItems(shop) {
    return catalog.filter((i) => i.shop === shop);
  }

  function buy(itemId) {
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return { ok: false, reason: 'no-such-item' };
    if (item.canBuy && !item.canBuy()) return { ok: false, reason: 'not-applicable' };
    if (itemId === 'respray' && state.freeResprays > 0) {
      state.freeResprays -= 1;
      item.apply();
      record('Free respray (mission reward)', 0);
      return { ok: true, free: true };
    }
    if (!spend(item.price, `Bought ${item.name.en}`)) return { ok: false, reason: 'no-cash' };
    item.apply();
    return { ok: true };
  }

  // ---- Garage: keep cars between sessions (4 + safehouse levels) ----
  function garageCapacity() {
    return GARAGE_CAPACITY + state.safehouseLevel;
  }

  function storeCurrentVehicle() {
    const v = vehiclesRef?.getPlayerVehicle();
    if (!v) return { ok: false, reason: 'no-vehicle' };
    if (state.garage.length >= garageCapacity()) return { ok: false, reason: 'garage-full' };
    state.garage.push({
      type: v.type, color: v.color,
      integrity: Math.round(v.integrity),
      name: vehicleName(v.def, 'en'),
    });
    vehiclesRef.removeVehicle(v);
    record(`Stored ${vehicleName(v.def, 'en')} in garage`, 0);
    return { ok: true };
  }

  function retrieveVehicle(index, x, z, heading) {
    const rec = state.garage[index];
    if (!rec) return null;
    state.garage.splice(index, 1);
    const v = vehiclesRef.makeVehicle(rec.type, x, z, heading, { color: rec.color });
    v.integrity = Math.max(10, rec.integrity);
    return v;
  }

  // ---- Chop shop: sell a car for its condition-adjusted price ----
  function conditionPrice(sell, integrity, maxIntegrity) {
    if (sell <= 0) return 0;
    return Math.round(sell * Math.max(0.15, integrity / maxIntegrity));
  }

  function sellVehicle(v) {
    if (!v || v.def.sell <= 0) return { ok: false, reason: 'not-sellable' };
    const price = conditionPrice(v.def.sell, v.integrity, v.maxIntegrity);
    earn(price, `Sold ${vehicleName(v.def, 'en')} to chop shop`);
    vehiclesRef.removeVehicle(v);
    return { ok: true, price };
  }

  function chopPrice(v) {
    if (!v) return 0;
    return conditionPrice(v.def.sell, v.integrity, v.maxIntegrity);
  }

  /** Chop price for a garaged record (no vehicle spawned to price it).
   *  Records store integrity in durability points, so the condition
   *  divisor is the vehicle's durability, not 100. */
  function garageChopPrice(rec) {
    if (!rec) return 0;
    const def = VEHICLES[rec.type];
    if (!def) return 0;
    return conditionPrice(def.sell, rec.integrity, def.durability);
  }

  return {
    state,
    bind,
    earn,
    spend,
    buy,
    shopItems,
    registerShopItem,
    grantFreeRespray,
    garageCapacity,
    storeCurrentVehicle,
    retrieveVehicle,
    sellVehicle,
    chopPrice,
    garageChopPrice,
    get cash() { return state.cash; },
    get ledger() { return state.ledger; },
    get garage() { return state.garage; },
  };
}
