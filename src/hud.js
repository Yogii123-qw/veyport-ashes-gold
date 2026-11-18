// Every pixel of the heads-up display, bound to live state: health,
// armor, cash, wanted stars, weapon and ammo, clock and weather, the
// active objective with real distance, a compass strip, and the
// self-clearing notices. Nothing here is decorative — each number is
// read from the systems every frame.

import { districtAt } from '../data/cityData.js';
import { weaponById, weaponName } from '../data/weaponsData.js';
import { clamp, dist2, formatClock, formatMoney } from './utils.js';

export function createHud(game) {
  const $ = (id) => document.getElementById(id);
  const root = $('hud');
  const hpFill = $('hpFill');
  const hpNum = $('hpNum');
  const armorFill = $('armorFill');
  const armorNum = $('armorNum');
  const cashEl = $('cash');
  const starsEl = $('stars');
  const compass = $('compassCanvas').getContext('2d');
  const districtEl = $('district');
  const clockEl = $('clock');
  const weatherEl = $('weatherLabel');
  const objectiveEl = $('objective');
  const objKind = $('objKind');
  const objTitle = $('objTitle');
  const objText = $('objText');
  const objDist = $('objDist');
  const objTimer = $('objTimer');
  const weaponSlotsEl = $('weaponSlots');
  const weaponNameEl = $('weaponName');
  const ammoMag = $('ammoMag');
  const ammoReserve = $('ammoReserve');
  const speedo = $('speedo');
  const speedVal = $('speedVal');
  const carHealthFill = $('carHealthFill');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const noticesEl = $('notices');
  const promptEl = $('prompt');
  const promptText = $('promptText');
  const promptKey = $('promptKey');
  const savingInd = $('savingInd');
  const centerMsg = $('centerMsg');
  const wantedBanner = $('wantedBanner');
  const vignette = $('vignette');
  const flashEl = $('flash');

  let objective = null;
  let timerSeconds = null;
  let counter = null;
  let lastStars = 0;
  let flashAmount = 0;
  let hitmarkerUntil = 0;
  let centerUntil = 0;
  let bannerUntil = 0;
  let slotsSignature = '';
  let lastDistrict = '';

  function notify(text, kind = 'info') {
    const div = document.createElement('div');
    div.className = `notice ${kind}`;
    div.textContent = text;
    noticesEl.appendChild(div);
    while (noticesEl.children.length > 4) noticesEl.firstChild.remove();
    setTimeout(() => div.remove(), 4200);
  }

  function flashDamage() {
    flashAmount = 0.55;
  }

  function showWantedBanner(stars) {
    wantedBanner.textContent = `${game.lang(stars > lastStars ? 'wantedUp' : 'wantedDown')} · ${'★'.repeat(stars)}`;
    wantedBanner.classList.remove('hidden');
    bannerUntil = game.time + 2.5;
  }

  function centerMessage(text, seconds) {
    centerMsg.textContent = text;
    centerMsg.classList.remove('hidden');
    centerUntil = game.time + seconds;
  }

  function showHitmarker(kill) {
    hitmarker.classList.toggle('kill', !!kill);
    hitmarker.classList.add('on');
    hitmarkerUntil = game.time + 0.22;
  }

  function setObjective(text, x, z) {
    objective = { text, x, z };
    objText.textContent = text;
    objKind.textContent = game.missions.active ? game.lang('mission') : game.contracts.active ? game.lang('contract') : game.lang('activity');
    objTitle.textContent = game.missions.active
      ? (game.missions.active.mission.title[game.settings.language] || game.missions.active.mission.title.en)
      : game.contracts.active ? (game.contracts.active.name[game.settings.language] || game.contracts.active.name.en) : '';
    objectiveEl.classList.remove('hidden');
  }

  function clearObjective() {
    objective = null;
    timerSeconds = null;
    counter = null;
    objectiveEl.classList.add('hidden');
  }

  function setTimer(seconds) {
    timerSeconds = seconds;
  }

  function setCounter(n) {
    counter = n;
  }

  function setSaving(on) {
    savingInd.classList.toggle('hidden', !on);
  }

  function showPrompt(text, key = 'F') {
    promptText.textContent = text;
    promptKey.textContent = key;
    promptEl.classList.remove('hidden');
  }

  function hidePrompt() {
    promptEl.classList.add('hidden');
  }

  function drawCompass() {
    const width = 360;
    const height = 26;
    compass.clearRect(0, 0, width, height);
    compass.font = '11px system-ui, sans-serif';
    compass.textAlign = 'center';
    compass.textBaseline = 'middle';
    const heading = game.cameraRig.yaw;
    const points = [
      { label: 'N', angle: Math.PI },
      { label: 'E', angle: Math.PI / 2 },
      { label: 'S', angle: 0 },
      { label: 'W', angle: -Math.PI / 2 },
    ];
    for (const point of points) {
      let offset = point.angle - heading;
      while (offset > Math.PI) offset -= Math.PI * 2;
      while (offset < -Math.PI) offset += Math.PI * 2;
      const x = width / 2 + offset * (width / Math.PI);
      if (x < 8 || x > width - 8) continue;
      compass.fillStyle = point.label === 'N' ? '#ffc35c' : '#f4efe6';
      compass.fillText(point.label, x, height / 2);
    }
    // Waypoint diamond on the strip.
    if (objective && objective.x !== null) {
      const bearing = Math.atan2(objective.x - game.player.x, objective.z - game.player.z);
      let offset = bearing - heading;
      while (offset > Math.PI) offset -= Math.PI * 2;
      while (offset < -Math.PI) offset += Math.PI * 2;
      const x = width / 2 + offset * (width / Math.PI);
      if (x >= 6 && x <= width - 6) {
        compass.fillStyle = '#ffc35c';
        compass.beginPath();
        compass.moveTo(x, 3);
        compass.lineTo(x + 5, 9);
        compass.lineTo(x, 15);
        compass.lineTo(x - 5, 9);
        compass.closePath();
        compass.fill();
      }
    }
    compass.fillStyle = '#f4efe6';
    compass.fillRect(width / 2 - 1, height - 4, 2, 4);
  }

  function renderWeaponSlots() {
    const owned = Object.keys(game.player.weapons);
    const signature = `${owned.join(',')}|${game.player.currentWeapon}`;
    if (signature === slotsSignature) return;
    slotsSignature = signature;
    weaponSlotsEl.innerHTML = '';
    const order = ['fists', 'p9', 'kr9', 'iron12', 'vk7'];
    order.forEach((id, i) => {
      const def = weaponById(id);
      const slot = document.createElement('span');
      slot.className = 'wSlot';
      if (game.player.weapons[id]) slot.classList.add('owned');
      if (game.player.currentWeapon === id) slot.classList.add('current');
      slot.textContent = String(i + 1);
      slot.title = weaponName(def, game.settings.language);
      weaponSlotsEl.appendChild(slot);
    });
  }

  function update() {
    const player = game.player;
    hpFill.style.width = `${clamp(player.hp / player.maxHp * 100, 0, 100)}%`;
    hpNum.textContent = String(Math.max(0, Math.ceil(player.hp)));
    armorFill.style.width = `${clamp(player.armor, 0, 100)}%`;
    armorNum.textContent = String(Math.max(0, Math.ceil(player.armor)));
    cashEl.textContent = formatMoney(game.progress.money);
    const stars = game.wanted.stars;
    if (stars !== lastStars) {
      if (stars > lastStars && stars > 0) showWantedBanner(stars);
      starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      starsEl.classList.toggle('hot', stars > 0);
      lastStars = stars;
    }
    if (game.time > bannerUntil) wantedBanner.classList.add('hidden');
    clockEl.textContent = formatClock(game.weather.hours);
    weatherEl.textContent = game.lang(game.weather.current);
    const district = districtAt(player.x, player.z);
    if (district.id !== lastDistrict) {
      lastDistrict = district.id;
      districtEl.textContent = district.name[game.settings.language] || district.name.en;
    }
    drawCompass();
    // Objective distance, timer, counter.
    if (objective) {
      if (objective.x !== null) {
        const d = Math.round(dist2(player.x, player.z, objective.x, objective.z));
        objDist.textContent = `${d} m`;
      } else {
        objDist.textContent = '';
      }
      if (timerSeconds !== null) {
        const t = Math.max(0, timerSeconds);
        objTimer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      } else if (counter !== null) {
        objTimer.textContent = `× ${counter}`;
      } else {
        objTimer.textContent = '';
      }
    }
    // Weapon + ammo.
    renderWeaponSlots();
    const def = weaponById(player.currentWeapon);
    weaponNameEl.textContent = weaponName(def, game.settings.language);
    const slot = player.weapons[player.currentWeapon];
    if (def.magSize > 0 && slot) {
      ammoMag.textContent = game.combat.reloading ? game.lang('reloading') : String(slot.mag);
      ammoReserve.textContent = `/ ${slot.reserve}`;
    } else {
      ammoMag.textContent = '—';
      ammoReserve.textContent = '';
    }
    // Vehicle speed + integrity.
    if (player.vehicle) {
      speedo.classList.remove('hidden');
      const speed = Math.hypot(player.vehicle.vx, player.vehicle.vz) * 3.6;
      speedVal.textContent = String(Math.round(speed));
      carHealthFill.style.width = `${clamp(player.vehicle.integrity, 0, 100)}%`;
    } else {
      speedo.classList.add('hidden');
    }
    // Crosshair: spread follows bloom and movement.
    const axis = game.input.axis();
    const moving = player.vehicle ? Math.min(1, Math.abs(player.vehicle.speed) / 30) : (axis.x !== 0 || axis.y !== 0 ? 0.6 : 0);
    const gap = 7 + game.combat.bloom * 26 + moving * 5 + (player.aiming ? -3 : 0);
    crosshair.style.setProperty('--gap', `${clamp(gap, 4, 34)}px`);
    crosshair.classList.toggle('hidden', player.currentWeapon === 'fists' && !player.vehicle);
    if (game.time > hitmarkerUntil) hitmarker.classList.remove('on');
    // Damage vignette + flash decay.
    const lowHp = clamp(1 - player.hp / player.maxHp, 0, 1);
    vignette.style.opacity = String(lowHp > 0.55 ? (lowHp - 0.55) * 1.4 : 0);
    if (flashAmount > 0) {
      flashAmount = Math.max(0, flashAmount - 0.03);
      flashEl.style.opacity = String(flashAmount);
    }
    if (game.time > centerUntil) centerMsg.classList.add('hidden');
  }

  function applyI18n() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      el.textContent = game.lang(key);
    }
    document.documentElement.lang = game.settings.language;
  }

  return {
    update, notify, flashDamage, showWantedBanner, centerMessage, showHitmarker,
    setObjective, clearObjective, setTimer, setCounter, setSaving,
    showPrompt, hidePrompt, applyI18n,
    setVisible(on) {
      root.classList.toggle('hidden', !on);
      root.setAttribute('aria-hidden', String(!on));
    },
  };
}
