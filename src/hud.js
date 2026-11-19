// hud.js — the heads-up display: bars, numbers, compass, speedometer.
//
// Every value here is bound to real state and cached so the DOM is only
// touched when a value actually changes. Nothing on the HUD is
// decorative: health, armor, cash, weapon, ammo, clock, weather,
// district, wanted stars, compass, speed and car health all come from
// the live simulation. The hitmarker only appears on a real 'hit' event.

import { WEAPONS, weaponName } from './player.js';
import { vehicleName } from './vehiclesData.js';

export function createHud(deps) {
  const { player, vehicles, economy, weather, city, cameraRig, bus } = deps;
  const lang = () => (deps.getLang ? deps.getLang() : 'id');
  const $ = (id) => document.getElementById(id);
  const cache = {};

  function setText(id, value) {
    if (cache[id] !== value) {
      cache[id] = value;
      const el = $(id);
      if (el) el.textContent = value;
    }
  }
  function setWidth(id, pct) {
    const key = `${id}:w`;
    const v = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (cache[key] !== v) {
      cache[key] = v;
      const el = $(id);
      if (el) el.style.width = v;
    }
  }

  function renderWeaponKeys() {
    const boxEl = $('weaponKeys');
    if (!boxEl) return;
    boxEl.innerHTML = '';
    const order = ['fists', 'p9', 'kr9', 'iron12', 'vk7'];
    order.forEach((id, i) => {
      if (!player.state.weapons[id]?.owned) return;
      const b = document.createElement('button');
      b.className = 'wKey' + (player.state.currentWeapon === id ? ' active' : '');
      b.textContent = String(i + 1);
      b.title = weaponName(WEAPONS[id], lang());
      b.addEventListener('click', () => {
        if (player.switchWeapon(id)) renderWeaponKeys();
      });
      boxEl.appendChild(b);
    });
  }

  function update() {
    const ps = player.state;
    setWidth('hpFill', ps.health);
    setWidth('armorFill', ps.armor);
    setText('cash', `$${economy.cash}`);
    const w = player.currentWeaponDef();
    const wState = ps.weapons[ps.currentWeapon];
    setText('weaponName', weaponName(w, lang()));
    setText('ammo', w.kind === 'melee' ? '—' : `${wState.ammo} / ${wState.reserve}`);
    const { h, m } = weather.hourMinute();
    setText('clock', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    setText('weatherLabel', weather.weatherLabel(lang()));
    const pp = player.position();
    setText('district', city.districtNameAt(pp.x, pp.z, lang()));
    const stars = deps.wanted ? deps.wanted.stars : 0;
    setText('stars', '★'.repeat(stars) + '☆'.repeat(5 - stars));
    const pts = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    const deg = (((cameraRig.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const idx = Math.round(deg / 45) % 8;
    setText('compass', `${pts[idx]}  ·  ${Math.round(deg)}°`);

    const pv = vehicles.getPlayerVehicle();
    const speedo = $('speedo');
    if (speedo) speedo.classList.toggle('hidden', !pv);
    if (pv) {
      const kmh = Math.round(Math.abs(pv.speed) * 3.6);
      setText('speedKmh', String(kmh));
      setWidth('speedFill', (Math.abs(pv.speed) / pv.def.topSpeed) * 100);
      setText('carName', vehicleName(pv.def, lang()));
      setWidth('carHealthFill', (pv.integrity / pv.maxIntegrity) * 100);
    }
    const crosshair = $('crosshair');
    if (crosshair) crosshair.classList.toggle('hidden', !(ps.aim && !ps.inVehicle));
    const weaponBox = $('weaponBox');
    if (weaponBox) weaponBox.style.opacity = ps.inVehicle ? '0.35' : '1';
  }

  function showHitmarker() {
    const hm = $('hitmarker');
    if (!hm) return;
    hm.classList.remove('hidden');
    window.setTimeout(() => hm.classList.add('hidden'), 120);
  }

  // The marker fires only on a real 'hit' event from combat/player —
  // it was previously defined but never wired, so it never appeared.
  if (bus) bus.on('hit', showHitmarker);

  function showInteractPrompt(text) {
    const prompt = $('interactPrompt');
    if (!prompt) return;
    if (!text) {
      prompt.classList.add('hidden');
      return;
    }
    prompt.textContent = text;
    prompt.classList.remove('hidden');
  }

  return {
    update,
    renderWeaponKeys,
    showHitmarker,
    showInteractPrompt,
    setText,
  };
}
