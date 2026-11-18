// Menus, modals and overlays: the main menu over the live city, the
// pause screen with map, stats, ledger, inventory, dialog log and
// saves, the mission results card, and every shop and board. Every
// button here does the thing it says — a disabled button says why.

import { ARMOR, ITEMS, WEAPONS, weaponById, weaponName } from '../data/weaponsData.js';
import { PRICES } from './economy.js';
import { MISSIONS } from '../data/missionsData.js';
import { CACHES } from '../data/cityData.js';
import { dist2, formatClock, formatDuration, formatMoney } from './utils.js';

const RESPRAY_COLORS = [0xc0392b, 0x2e5f8a, 0x3a7a4a, 0xd8a83c, 0xe8e4da, 0x222222, 0x7a4a8a, 0x4a8a7a];

export function createMenus(game) {
  const $ = (id) => document.getElementById(id);
  let menuOpen = true;
  let paused = false;
  let modalOpen = false;
  let settingsOpen = false;
  let creditsOpen = false;
  let slotsOpen = false;
  let resultsOpen = false;
  let confirmResolve = null;
  let currentTab = 'map';

  function lang() { return game.settings.language; }

  // ---------- generic overlays ----------
  function confirm(text, yesLabel) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $('confirmText').textContent = text;
      $('confirmYes').textContent = yesLabel;
      $('confirmOverlay').classList.remove('hidden');
    });
  }

  $('confirmYes').addEventListener('click', () => {
    $('confirmOverlay').classList.add('hidden');
    if (confirmResolve) confirmResolve(true);
    confirmResolve = null;
  });
  $('confirmNo').addEventListener('click', () => {
    $('confirmOverlay').classList.add('hidden');
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
  });

  // ---------- settings ----------
  function syncSettingsUI() {
    $('setLang').value = game.settings.language;
    $('setMaster').value = game.settings.master;
    $('setSfx').value = game.settings.sfx;
    $('setMusic').value = game.settings.music;
    $('setAmbient').value = game.settings.ambient;
    $('setSens').value = game.settings.sensitivity;
    $('setQuality').value = game.settings.quality;
    $('setTouch').value = game.settings.touch;
    $('setShake').checked = game.settings.reduceShake;
    $('setColorblind').checked = game.settings.colorblind;
    $('valMaster').textContent = `${game.settings.master}%`;
    $('valSfx').textContent = `${game.settings.sfx}%`;
    $('valMusic').textContent = `${game.settings.music}%`;
    $('valAmbient').textContent = `${game.settings.ambient}%`;
    $('valSens').textContent = `${game.settings.sensitivity}%`;
  }

  function openSettings() {
    syncSettingsUI();
    settingsOpen = true;
    $('settings').classList.remove('hidden');
  }

  function closeSettings() {
    settingsOpen = false;
    $('settings').classList.add('hidden');
    game.save.saveSettings();
  }

  $('setLang').addEventListener('change', (e) => {
    game.settings.language = e.target.value;
    game.hud.applyI18n();
    game.save.saveSettings();
  });
  const volumeBindings = [['setMaster', 'master', 'valMaster'], ['setSfx', 'sfx', 'valSfx'], ['setMusic', 'music', 'valMusic'], ['setAmbient', 'ambient', 'valAmbient']];
  for (const [inputId, key, valId] of volumeBindings) {
    $(inputId).addEventListener('input', (e) => {
      game.settings[key] = Number(e.target.value);
      $(valId).textContent = `${e.target.value}%`;
      game.audio.applyVolumes();
    });
  }
  $('setSens').addEventListener('input', (e) => {
    game.settings.sensitivity = Number(e.target.value);
    $('valSens').textContent = `${e.target.value}%`;
  });
  $('setQuality').addEventListener('change', (e) => {
    game.settings.quality = e.target.value;
    game.quality.apply(game.settings.quality);
  });
  $('setTouch').addEventListener('change', (e) => {
    game.settings.touch = e.target.value;
    game.main.applyTouchVisibility();
  });
  $('setShake').addEventListener('change', (e) => { game.settings.reduceShake = e.target.checked; });
  $('setColorblind').addEventListener('change', (e) => { game.settings.colorblind = e.target.checked; });
  $('btnSettingsDefaults').addEventListener('click', () => {
    Object.assign(game.settings, { language: 'en', master: 80, sfx: 80, music: 60, ambient: 60, sensitivity: 100, quality: 'auto', touch: 'auto', reduceShake: false, colorblind: false });
    game.audio.applyVolumes();
    game.quality.apply('auto');
    game.hud.applyI18n();
    syncSettingsUI();
  });
  $('settingsClose').addEventListener('click', closeSettings);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnPauseSettings').addEventListener('click', openSettings);

  // ---------- credits ----------
  function openCredits() {
    creditsOpen = true;
    $('creditsControls').textContent = lang() === 'id'
      ? 'Kontrol: WASD gerak/setir, Shift lari, Spasi drift/lompat, E masuk kendaraan, F interaksi, klik kiri tembak, klik kanan bidik, R isi ulang, Q medkit, 1–5 senjata, M peta, Esc jeda, H klakson, L lampu. Sentuh: joystick gerak, tahan LARI untuk lari, seret layar untuk melihat, TEMBAK untuk menembak.'
      : 'Controls: WASD move/steer, Shift run, Space drift/jump, E enter vehicle, F interact, left click fire, right click aim, R reload, Q medkit, 1–5 weapons, M map, Esc pause, H horn, L lights. Touch: joystick to move, hold RUN to run, drag to look, FIRE to shoot.';
    $('creditsBox').classList.remove('hidden');
  }
  $('btnCredits').addEventListener('click', openCredits);
  $('btnCreditsClose').addEventListener('click', () => {
    creditsOpen = false;
    $('creditsBox').classList.add('hidden');
  });

  // ---------- slots overlay ----------
  function renderSlots(mode, onPick) {
    const list = $('slotList');
    list.innerHTML = '';
    $('slotsMsg').textContent = '';
    for (let slot = 1; slot <= 3; slot += 1) {
      const info = game.save.slotInfo(slot);
      const row = document.createElement('div');
      row.className = 'slotRow';
      if (!info.exists) {
        row.innerHTML = `<span class="slotName">${game.lang('emptySlot')} ${slot}</span><span></span>`;
        if (mode === 'save' || mode === 'import') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mBtn small';
          btn.textContent = mode === 'save' ? game.lang('save') : game.lang('importSave');
          btn.addEventListener('click', () => onPick(slot));
          row.appendChild(btn);
        }
      } else if (info.corrupted) {
        row.innerHTML = `<span class="slotName">Slot ${slot} · ${game.lang('importBad')}</span>`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mBtn small danger';
        del.textContent = game.lang('delete');
        del.addEventListener('click', async () => {
          if (await confirm(game.lang('deleteWarn'), game.lang('delete'))) {
            game.save.deleteSlot(slot);
            renderSlots(mode, onPick);
          }
        });
        row.appendChild(del);
      } else {
        const date = new Date(info.savedAt).toLocaleString(lang() === 'id' ? 'id-ID' : 'en-US');
        row.innerHTML = `<span class="slotName">Slot ${slot} · ${formatMoney(info.money)} · ${info.missions}/6 ${game.lang('mission')} · ${formatClock(info.clock)} · ${date}</span>`;
        const actions = document.createElement('span');
        actions.className = 'slotActions';
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'mBtn small primary';
        loadBtn.textContent = mode === 'save' ? game.lang('overwrite') : game.lang('load');
        loadBtn.addEventListener('click', () => onPick(slot));
        actions.appendChild(loadBtn);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mBtn small danger';
        del.textContent = game.lang('delete');
        del.addEventListener('click', async () => {
          if (await confirm(game.lang('deleteWarn'), game.lang('delete'))) {
            game.save.deleteSlot(slot);
            renderSlots(mode, onPick);
          }
        });
        actions.appendChild(del);
        row.appendChild(actions);
      }
      list.appendChild(row);
    }
  }

  function openSlots(mode, onPick) {
    slotsOpen = true;
    $('slotsTitle').textContent = mode === 'save' ? game.lang('saveLoad') : game.lang('loadGame');
    renderSlots(mode, (slot) => {
      slotsOpen = false;
      $('slotsOverlay').classList.add('hidden');
      onPick(slot);
    });
    $('slotsOverlay').classList.remove('hidden');
  }

  $('slotsClose').addEventListener('click', () => {
    slotsOpen = false;
    $('slotsOverlay').classList.add('hidden');
  });

  // ---------- main menu ----------
  function refreshMenu() {
    const info = game.save.slotInfo(game.save.lastSlot);
    const hasSave = info.exists && !info.corrupted;
    $('btnContinue').disabled = !hasSave;
    $('menuSaveInfo').textContent = hasSave
      ? `${formatMoney(info.money)} · ${info.missions}/6 · ${formatClock(info.clock)}`
      : '';
  }

  function showMenu() {
    menuOpen = true;
    paused = false;
    $('menu').classList.remove('hidden');
    $('pause').classList.add('hidden');
    game.hud.setVisible(false);
    game.main.setTouchVisible(false);
    refreshMenu();
  }

  function hideMenu() {
    menuOpen = false;
    $('menu').classList.add('hidden');
    game.hud.setVisible(true);
    game.main.applyTouchVisibility();
  }

  $('btnContinue').addEventListener('click', async () => {
    game.audio.init();
    const result = game.save.loadSlot(game.save.lastSlot);
    if (result.ok) {
      game.main.startPlaying();
      hideMenu();
    } else {
      openSlots('load', (slot) => {
        const loaded = game.save.loadSlot(slot);
        if (loaded.ok) {
          game.main.startPlaying();
          hideMenu();
        }
      });
    }
  });

  $('btnNew').addEventListener('click', async () => {
    game.audio.init();
    const hasProgress = game.progress.stats.playSeconds > 60 || game.progress.missionsCompleted.size > 0;
    if (hasProgress && !(await confirm(game.lang('newGameWarn'), game.lang('newGame')))) return;
    game.main.newGame();
    hideMenu();
  });

  $('btnLoad').addEventListener('click', () => {
    game.audio.init();
    openSlots('load', (slot) => {
      const loaded = game.save.loadSlot(slot);
      if (loaded.ok) {
        game.main.startPlaying();
        hideMenu();
      } else {
        $('slotsMsg').textContent = game.lang('importBad');
      }
    });
  });

  // ---------- pause ----------
  function renderStats() {
    const s = game.progress.stats;
    const rows = [
      [game.lang('time'), formatDuration(s.playSeconds)],
      [game.lang('mission'), `${game.progress.missionsCompleted.size} / 6`],
      [game.lang('contract'), String(s.contractsCompleted)],
      [game.lang('cacheFound'), `${game.progress.cachesTaken.size} / ${CACHES.length}`],
      [lang() === 'id' ? 'Stunt' : 'Stunts', String(Object.keys(game.progress.stunts).length)],
      [lang() === 'id' ? 'Uang didapat' : 'Money earned', formatMoney(s.moneyEarned)],
      [lang() === 'id' ? 'Uang keluar' : 'Money spent', formatMoney(s.moneySpent)],
      [lang() === 'id' ? 'Jarak jalan' : 'Walked', `${(s.distanceWalked / 1000).toFixed(1)} km`],
      [lang() === 'id' ? 'Jarak berkendara' : 'Driven', `${(s.distanceDriven / 1000).toFixed(1)} km`],
      [lang() === 'id' ? 'Mobil dicuri' : 'Cars stolen', String(s.carsStolen)],
      [lang() === 'id' ? 'Tembakan' : 'Shots fired', String(s.shots)],
      [lang() === 'id' ? 'Akurasi' : 'Accuracy', s.shots > 0 ? `${Math.round(s.hits / s.shots * 100)}%` : '—'],
    ];
    $('statsGrid').innerHTML = rows.map(([k, v]) => `<div class="statRow"><span>${k}</span><b>${v}</b></div>`).join('');
    const rep = game.progress.reputation;
    $('repGrid').innerHTML = [
      ['Harbormen', rep.harbormen],
      ['Foundry Kings', rep.foundry],
      [lang() === 'id' ? 'Reputasi kontrak' : 'Contract reputation', game.progress.contractRep],
      [lang() === 'id' ? 'Utang Cole' : "Cole's debt", game.progress.flags.debtResolved ? (lang() === 'id' ? 'Lunas — dipalsukan Vex' : 'Resolved — forged by Vex') : '$8,000'],
      [lang() === 'id' ? 'Akhir' : 'Ending', game.progress.ending ? (game.progress.ending === 'ashes' ? 'Ashes' : 'Gold') : '—'],
    ].map(([k, v]) => `<div class="statRow"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  function renderLedger() {
    $('ledgerHead').innerHTML = `<b>${formatMoney(game.progress.money)}</b><span>${game.lang('ledger')}</span>`;
    $('ledgerList').innerHTML = game.progress.ledger.length === 0
      ? `<div class="ledgerEmpty">${lang() === 'id' ? 'Belum ada transaksi.' : 'No transactions yet.'}</div>`
      : game.progress.ledger.map((e) => `<div class="ledgerRow"><span>${e.time}</span><span>${e.label}</span><b class="${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${formatMoney(e.amount)}</b><span>${formatMoney(e.balance)}</span></div>`).join('');
  }

  function renderInventory() {
    const weaponsHtml = WEAPONS.map((def) => {
      const slot = game.player.weapons[def.id];
      if (!slot) return '';
      return `<div class="invRow"><span>${weaponName(def, lang())}</span><span>${def.magSize > 0 ? `${slot.mag} / ${slot.reserve}` : '—'}</span></div>`;
    }).join('');
    $('invWeapons').innerHTML = `<h3>${game.lang('inventory')}</h3>${weaponsHtml}`;
    $('invItems').innerHTML = [
      [`${ITEMS.medkit.name[lang()] || ITEMS.medkit.name.en}`, String(game.player.medkits)],
      [game.lang('armor'), `${Math.round(game.player.armor)} (${game.player.armorTier})`],
      [lang() === 'id' ? 'Kunci respray gratis' : 'Free resprays', String(game.progress.flags.freeRespray || 0)],
    ].map(([k, v]) => `<div class="invRow"><span>${k}</span><b>${v}</b></div>`).join('');
    const nearSafehouse = dist2(game.player.x, game.player.z, -420, 60) < 40;
    $('invGarage').innerHTML = `<h3>${lang() === 'id' ? 'Garasi' : 'Garage'} (${game.progress.garage.length}/${game.economy.garageCapacity()})</h3>`
      + (game.progress.garage.length === 0 ? `<div class="ledgerEmpty">${lang() === 'id' ? 'Garasi kosong.' : 'Garage is empty.'}</div>` : '');
    game.progress.garage.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'invRow';
      row.innerHTML = `<span>${entry.defId} · ${entry.plate}</span><span>${Math.round(entry.integrity)}%</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mBtn small';
      btn.textContent = lang() === 'id' ? 'Keluarkan' : 'Retrieve';
      btn.disabled = !nearSafehouse;
      btn.title = nearSafehouse ? '' : (lang() === 'id' ? 'Harus di dekat safehouse' : 'Must be near the safehouse');
      btn.addEventListener('click', () => {
        const vehicle = game.economy.retrieveVehicle(i, -400, 60, Math.PI / 2);
        if (vehicle) {
          togglePause(false);
          game.hud.notify(game.lang('vehicleStored').replace(game.lang('vehicleStored'), lang() === 'id' ? 'Kendaraan dikeluarkan dari garasi.' : 'Vehicle retrieved from the garage.'), 'good');
        }
      });
      row.appendChild(btn);
      $('invGarage').appendChild(row);
    });
  }

  function renderLog() {
    $('logList').innerHTML = game.dialogs.entries.length === 0
      ? `<div class="ledgerEmpty">${lang() === 'id' ? 'Belum ada percakapan.' : 'No conversations yet.'}</div>`
      : game.dialogs.entries.map((e) => `<div class="logRow"><span>${e.time}</span><b>${(game.missions.characters[e.who]?.name[lang()] || e.who)}</b><span>${e.text}</span></div>`).join('');
  }

  function renderSaveTab() {
    const slots = $('saveSlots');
    slots.innerHTML = '';
    for (let slot = 1; slot <= 3; slot += 1) {
      const info = game.save.slotInfo(slot);
      const row = document.createElement('div');
      row.className = 'slotRow';
      const label = !info.exists ? game.lang('emptySlot') : info.corrupted ? game.lang('importBad') : `${formatMoney(info.money)} · ${info.missions}/6 · ${formatClock(info.clock)}`;
      row.innerHTML = `<span class="slotName">Slot ${slot} · ${label}</span>`;
      const actions = document.createElement('span');
      actions.className = 'slotActions';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'mBtn small';
      saveBtn.textContent = game.lang('save');
      saveBtn.addEventListener('click', async () => {
        if (info.exists && !info.corrupted && !(await confirm(game.lang('newGameWarn'), game.lang('overwrite')))) return;
        game.save.saveSlot(slot);
        renderSaveTab();
      });
      actions.appendChild(saveBtn);
      if (info.exists && !info.corrupted) {
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'mBtn small primary';
        loadBtn.textContent = game.lang('load');
        loadBtn.addEventListener('click', () => {
          if (game.save.loadSlot(slot).ok) {
            togglePause(false);
            game.hud.notify(game.lang('gameSaved'), 'good');
          }
        });
        actions.appendChild(loadBtn);
        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'mBtn small';
        exportBtn.textContent = game.lang('exportSave');
        exportBtn.addEventListener('click', () => {
          game.save.exportSlot(slot);
          $('saveMsg').textContent = game.lang('exportDone');
        });
        actions.appendChild(exportBtn);
      }
      row.appendChild(actions);
      slots.appendChild(row);
    }
  }

  function renderForecast() {
    $('forecastText').textContent = game.weather.forecast()
      .map((f) => `${String(f.hour).padStart(2, '0')}:00 ${game.lang(f.weather)}`).join(' · ');
  }

  function showTab(tab) {
    currentTab = tab;
    for (const button of document.querySelectorAll('.pTab')) {
      button.classList.toggle('active', button.dataset.tab === tab);
    }
    const panels = { map: 'panelMap', stats: 'panelStats', ledger: 'panelLedger', inventory: 'panelInventory', log: 'panelLog', save: 'panelSave' };
    for (const [key, id] of Object.entries(panels)) {
      $(id).classList.toggle('hidden', key !== tab);
    }
    if (tab === 'map') {
      game.minimap.drawFullMap();
      renderForecast();
    }
    if (tab === 'stats') renderStats();
    if (tab === 'ledger') renderLedger();
    if (tab === 'inventory') renderInventory();
    if (tab === 'log') renderLog();
    if (tab === 'save') renderSaveTab();
  }

  for (const button of document.querySelectorAll('.pTab')) {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  }

  // Map filters.
  const filterDefs = [['shops', 'Shops', 'Toko'], ['caches', 'Caches', 'Cache'], ['missions', 'Missions', 'Misi'], ['contracts', 'Contracts', 'Kontrak'], ['police', 'Police', 'Polisi']];
  const filtersEl = $('mapFilters');
  for (const [key, en, id] of filterDefs) {
    const label = document.createElement('label');
    label.className = 'filterLabel';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      game.minimap.setFilter(key, box.checked);
      game.minimap.drawFullMap();
    });
    label.appendChild(box);
    label.appendChild(document.createTextNode(lang() === 'id' ? id : en));
    filtersEl.appendChild(label);
  }

  function togglePause(force) {
    const next = force !== undefined ? force : !paused;
    if (menuOpen || resultsOpen) return;
    paused = next;
    $('pause').classList.toggle('hidden', !paused);
    if (paused) showTab(currentTab);
  }

  $('btnResume').addEventListener('click', () => togglePause(false));
  $('btnQuitMenu').addEventListener('click', async () => {
    game.save.autosave('quit');
    togglePause(false);
    game.main.quitToMenu();
    showMenu();
  });

  $('btnExport').addEventListener('click', () => {
    game.save.exportSlot(game.save.lastSlot);
    $('saveMsg').textContent = game.lang('exportDone');
  });
  $('btnImport').addEventListener('click', () => {
    $('importFile').click();
  });
  $('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    const check = game.save.validateFile(text);
    if (!check.ok) {
      $('saveMsg').textContent = game.lang('importBad');
      return;
    }
    openSlots('import', (slot) => {
      const result = game.save.importText(text, slot);
      $('saveMsg').textContent = result.ok ? game.lang('importOk') : game.lang('importBad');
      renderSaveTab();
    });
  });

  // ---------- results ----------
  function showResults(data) {
    resultsOpen = true;
    const mission = MISSIONS.find((m) => m.id === data.missionId);
    const title = mission ? (mission.title[lang()] || mission.title.en) : '';
    $('resultKicker').textContent = data.failed ? game.lang('missionFailed') : game.lang('missionComplete');
    $('resultTitle').textContent = title;
    $('resultRank').textContent = data.failed ? '' : data.rank;
    $('resultRank').className = data.failed ? '' : `rank ${data.rank.toLowerCase()}`;
    const rows = [];
    if (data.failed) {
      rows.push([lang() === 'id' ? 'Alasan' : 'Reason', game.lang(data.reason) || data.reason]);
    } else {
      rows.push([game.lang('time'), formatDuration(data.time)]);
      rows.push([game.lang('accuracy'), `${Math.round(data.accuracy * 100)}%`]);
      rows.push([game.lang('damageTaken'), String(Math.round(data.damage))]);
      rows.push([game.lang('reward'), formatMoney(data.reward)]);
      if (data.cleanBonus) rows.push([game.lang('cleanBonus'), formatMoney(data.cleanBonus)]);
    }
    $('resultRows').innerHTML = rows.map(([k, v]) => `<div class="resultRow"><span>${k}</span><b>${v}</b></div>`).join('');
    const replayBtn = $('btnResultReplay');
    replayBtn.textContent = data.failed ? (lang() === 'id' ? 'Coba lagi' : 'Retry') : game.lang('replayMission');
    replayBtn.onclick = () => {
      resultsOpen = false;
      $('results').classList.add('hidden');
      if (data.failed && data.onRetry) data.onRetry();
      else if (data.onReplay) data.onReplay();
    };
    $('btnResultContinue').onclick = () => {
      resultsOpen = false;
      $('results').classList.add('hidden');
    };
    $('results').classList.remove('hidden');
  }

  // ---------- shop / board modal ----------
  function openModal(title, sub) {
    modalOpen = true;
    $('modalTitle').textContent = title;
    $('modalSub').textContent = sub;
    $('modalMsg').textContent = '';
    $('modal').classList.remove('hidden');
    refreshModalCash();
  }

  function refreshModalCash() {
    $('modalCash').textContent = formatMoney(game.progress.money);
  }

  function closeModal() {
    modalOpen = false;
    $('modal').classList.add('hidden');
  }

  $('modalClose').addEventListener('click', closeModal);

  function modalRow(name, desc, priceText, actionLabel, onAction, disabledReason) {
    const row = document.createElement('div');
    row.className = 'modalRow';
    row.innerHTML = `<span class="modalName">${name}</span><span class="modalDesc">${desc}</span><span class="modalPrice">${priceText}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mBtn small';
    btn.textContent = actionLabel;
    if (disabledReason) {
      btn.disabled = true;
      btn.title = disabledReason;
    }
    btn.addEventListener('click', () => {
      onAction();
      refreshModalCash();
    });
    row.appendChild(btn);
    $('modalItems').appendChild(row);
    return btn;
  }

  function setModalMsg(text) {
    $('modalMsg').textContent = text;
  }

  function openGunshop() {
    openModal(lang() === 'id' ? 'Toko Senjata' : 'Gun Shop', lang() === 'id' ? 'Ilex tidak bertanya. Kamu juga jangan.' : 'Ilex does not ask. Neither should you.');
    $('modalItems').innerHTML = '';
    for (const def of WEAPONS) {
      if (def.id === 'fists') continue;
      const owned = !!game.player.weapons[def.id];
      modalRow(
        weaponName(def, lang()),
        `${def.damage} ${lang() === 'id' ? 'damage' : 'dmg'} · ${def.magSize} ${lang() === 'id' ? 'peluru' : 'rounds'}`,
        owned ? game.lang('alreadyOwned') : formatMoney(def.price),
        owned ? game.lang('bought') : (lang() === 'id' ? 'Beli' : 'Buy'),
        () => {
          const result = game.economy.buyWeapon(def.id);
          setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'alreadyOwned'));
          openGunshop();
        },
        owned ? game.lang('alreadyOwned') : null,
      );
      modalRow(
        `${lang() === 'id' ? 'Amunisi' : 'Ammo'} · ${weaponName(def, lang())}`,
        `+${def.ammoPack} ${lang() === 'id' ? 'peluru' : 'rounds'}`,
        formatMoney(def.ammoPrice),
        lang() === 'id' ? 'Beli' : 'Buy',
        () => {
          const result = game.economy.buyAmmo(def.id);
          setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'alreadyOwned'));
          refreshModalCash();
        },
        owned ? null : (lang() === 'id' ? 'Beli senjatanya dulu' : 'Buy the weapon first'),
      );
    }
    for (const tier of ['standard', 'heavy']) {
      const info = ARMOR[tier];
      modalRow(
        info.name[lang()] || info.name.en,
        `${lang() === 'id' ? 'Serap' : 'Absorbs'} ${Math.round(info.absorb * 100)}%`,
        formatMoney(info.price),
        lang() === 'id' ? 'Beli' : 'Buy',
        () => {
          const result = game.economy.buyArmor(tier);
          setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'missionLocked'));
          refreshModalCash();
        },
        tier === 'heavy' && !game.progress.flags.heavyArmor ? game.lang('missionLocked') : null,
      );
    }
    modalRow(
      ITEMS.medkit.name[lang()] || ITEMS.medkit.name.en,
      `+${ITEMS.medkit.heal} HP · ${game.player.medkits}/3`,
      formatMoney(ITEMS.medkit.price),
      lang() === 'id' ? 'Beli' : 'Buy',
      () => {
        const result = game.economy.buyMedkit();
        setModalMsg(result.ok ? game.lang('bought') : game.lang('noMoney'));
        refreshModalCash();
      },
      game.player.medkits >= 3 ? (lang() === 'id' ? 'Penuh' : 'Full') : null,
    );
  }

  function openRespray() {
    openModal(lang() === 'id' ? 'Bengkel Cat' : 'Respray Shop', game.lang('resprayHere'));
    $('modalItems').innerHTML = '';
    const vehicle = game.player.vehicle;
    if (!vehicle) {
      $('modalItems').innerHTML = `<div class="ledgerEmpty">${lang() === 'id' ? 'Bawa kendaraan ke sini.' : 'Bring a vehicle here.'}</div>`;
      return;
    }
    for (const color of RESPRAY_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
      swatch.setAttribute('aria-label', `#${color.toString(16).padStart(6, '0')}`);
      swatch.addEventListener('click', () => {
        const result = game.economy.respray(vehicle, color);
        setModalMsg(result.ok ? game.lang('resprayDone') : game.lang('noMoney'));
        refreshModalCash();
      });
      $('modalItems').appendChild(swatch);
    }
  }

  function openFood() {
    openModal(lang() === 'id' ? 'Warung' : 'Street Food', ITEMS.food.name[lang()] || ITEMS.food.name.en);
    $('modalItems').innerHTML = '';
    modalRow(
      ITEMS.food.name[lang()] || ITEMS.food.name.en,
      `+${ITEMS.food.heal} HP`,
      formatMoney(ITEMS.food.price),
      game.lang('eatFood'),
      () => {
        const result = game.economy.buyFood();
        setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'bought'));
        refreshModalCash();
      },
      game.player.hp >= game.player.maxHp ? (lang() === 'id' ? 'Darah penuh' : 'Full health') : null,
    );
  }

  function openChopshop() {
    openModal(lang() === 'id' ? 'Yard' : 'Chop Shop', game.lang('sellVehicle'));
    $('modalItems').innerHTML = '';
    const vehicle = game.player.vehicle;
    if (!vehicle) {
      $('modalItems').innerHTML = `<div class="ledgerEmpty">${lang() === 'id' ? 'Bawa kendaraan curian ke sini.' : 'Bring a stolen vehicle here.'}</div>`;
      return;
    }
    const value = game.vehicles.sellValue(vehicle);
    modalRow(
      `${vehicle.def.name[lang()] || vehicle.def.name.en} · ${vehicle.plate}`,
      `${lang() === 'id' ? 'Kondisi' : 'Condition'} ${Math.round(vehicle.integrity)}%`,
      value > 0 ? formatMoney(value) : '—',
      lang() === 'id' ? 'Jual' : 'Sell',
      () => {
        const result = game.economy.sellVehicle(vehicle);
        setModalMsg(result.ok ? game.lang('soldVehicle') : game.lang('noMoney'));
        closeModal();
      },
      value <= 0 ? (lang() === 'id' ? 'Tidak bisa dijual' : 'Cannot sell') : null,
    );
  }

  function openBribe() {
    openModal(lang() === 'id' ? 'Kontak Drayke' : "Drayke's Contact", game.lang('bribeHere'));
    $('modalItems').innerHTML = '';
    modalRow(
      game.lang('bribeHere'),
      `${lang() === 'id' ? 'Hanya' : 'Only'} ★1–2 · ${lang() === 'id' ? 'sekarang' : 'now'} ★${game.wanted.stars}`,
      formatMoney(PRICES.bribe),
      lang() === 'id' ? 'Suap' : 'Bribe',
      () => {
        const result = game.economy.bribe();
        setModalMsg(result.ok ? game.lang('bribeDone') : game.lang('noMoney'));
        refreshModalCash();
      },
      game.wanted.stars < 1 || game.wanted.stars > 2 ? (lang() === 'id' ? 'Wanted harus ★1–2' : 'Wanted must be ★1–2') : null,
    );
  }

  function openSafehouse() {
    openModal(lang() === 'id' ? 'Safehouse' : 'Safehouse', lang() === 'id' ? 'Gudang Cole. Bau solar, tapi milikmu.' : "Cole's warehouse. Smells of diesel, but it is yours.");
    $('modalItems').innerHTML = '';
    modalRow(
      game.lang('sleep'),
      lang() === 'id' ? 'Darah penuh, jam maju 8 jam' : 'Full health, clock advances 8 hours',
      lang() === 'id' ? 'Gratis' : 'Free',
      game.lang('sleep'),
      () => {
        game.economy.sleep();
        closeModal();
      },
    );
    const vehicle = game.player.vehicle;
    modalRow(
      game.lang('storeVehicle'),
      vehicle ? `${vehicle.def.name[lang()] || vehicle.def.name.en} · ${vehicle.plate}` : (lang() === 'id' ? 'Tidak ada kendaraan' : 'No vehicle'),
      `${game.progress.garage.length}/${game.economy.garageCapacity()}`,
      lang() === 'id' ? 'Simpan' : 'Store',
      () => {
        if (vehicle && game.economy.storeVehicle(vehicle)) closeModal();
        refreshModalCash();
      },
      !vehicle ? (lang() === 'id' ? 'Bawa kendaraan' : 'Bring a vehicle') : null,
    );
    modalRow(
      lang() === 'id' ? 'Upgrade garasi' : 'Garage upgrade',
      `2 → 4 ${lang() === 'id' ? 'slot' : 'slots'}`,
      formatMoney(PRICES.garageUpgrade),
      lang() === 'id' ? 'Beli' : 'Buy',
      () => {
        const result = game.economy.buyGarageUpgrade();
        setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'alreadyOwned'));
        openSafehouse();
      },
      game.progress.flags.garageUpgraded ? game.lang('alreadyOwned') : null,
    );
    modalRow(
      lang() === 'id' ? 'Gudang senjata' : 'Armory',
      lang() === 'id' ? 'Isi ulang amunisi gratis sekali sehari' : 'Free ammo refill once a day',
      formatMoney(PRICES.armoryUpgrade),
      lang() === 'id' ? 'Beli' : 'Buy',
      () => {
        const result = game.economy.buyArmoryUpgrade();
        setModalMsg(result.ok ? game.lang('bought') : game.lang(result.reason === 'money' ? 'noMoney' : 'alreadyOwned'));
        openSafehouse();
      },
      game.progress.flags.armoryUpgraded ? game.lang('alreadyOwned') : null,
    );
    if (game.progress.flags.armoryUpgraded) {
      modalRow(
        lang() === 'id' ? 'Isi ulang amunisi' : 'Refill ammo',
        lang() === 'id' ? 'Sekali per hari game' : 'Once per game day',
        lang() === 'id' ? 'Gratis' : 'Free',
        lang() === 'id' ? 'Isi ulang' : 'Refill',
        () => {
          const ok = game.economy.armoryRefill();
          setModalMsg(ok ? game.lang('bought') : (lang() === 'id' ? 'Sudah dipakai hari ini' : 'Already used today'));
        },
      );
    }
  }

  function openBoard() {
    openModal(lang() === 'id' ? 'Papan Kontrak' : 'Contract Board', `${lang() === 'id' ? 'Reputasi' : 'Reputation'}: ${game.progress.contractRep}/100`);
    $('modalItems').innerHTML = '';
    for (const offer of game.contracts.offered()) {
      modalRow(
        `${offer.name[lang()] || offer.name.en} · ${formatMoney(offer.reward)}`,
        `${offer.desc[lang()] || offer.desc.en} — ${offer.client[lang()] || offer.client.en} · ${offer.distance} m${offer.timeLimit ? ` · ${offer.timeLimit}s` : ''}`,
        formatMoney(offer.reward),
        lang() === 'id' ? 'Terima' : 'Accept',
        () => {
          if (game.contracts.accept(offer.index)) closeModal();
        },
        game.contracts.active || game.missions.active ? (lang() === 'id' ? 'Selesaikan pekerjaan aktif dulu' : 'Finish the active job first') : null,
      );
    }
  }

  function openShop(kind) {
    if (kind === 'gunshop') openGunshop();
    else if (kind === 'respray') openRespray();
    else if (kind === 'food') openFood();
    else if (kind === 'chopshop') openChopshop();
    else if (kind === 'bribe') openBribe();
    else if (kind === 'safehouse') openSafehouse();
    else if (kind === 'board') openBoard();
  }

  return {
    showMenu, hideMenu, refreshMenu, togglePause, showTab, showResults,
    openShop, openModal, closeModal, confirm, openSlots, openSettings,
    get menuOpen() { return menuOpen; },
    get paused() { return paused; },
    get modalOpen() { return modalOpen; },
    get resultsOpen() { return resultsOpen; },
    get settingsOpen() { return settingsOpen; },
    get creditsOpen() { return creditsOpen; },
    get slotsOpen() { return slotsOpen; },
    isMenuOpen: () => menuOpen,
    isOverlayOpen: () => menuOpen || paused || modalOpen || settingsOpen || creditsOpen || slotsOpen || resultsOpen || game.dialogOpen,
    isOverMinimap: (x, y) => game.minimap.isOverCanvas(x, y),
  };
}
