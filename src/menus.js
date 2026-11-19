// menus.js — every screen that is not the game itself.
//
// Menu, settings, credits, pause, shop, full map. Each button does
// exactly what it says; the settings actually change the game and are
// saved; the shop lists only items the player can really buy (the
// catalog comes from the economy, extended by registerShopItem). The
// pause menu also hosts the ledger, the forecast, the contract board
// and the save slots — all of them live views of real state.

import { t } from './langData.js';
import { LANDMARKS } from './city.js';
import { vehicleName } from './vehiclesData.js';
import { WEATHERS } from './weather.js';

export function createMenus(deps) {
  const { economy, vehicles, weather, player, cameraRig } = deps;
  const lang = () => (deps.getLang ? deps.getLang() : 'id');
  const getSettings = () => (deps.getSettings ? deps.getSettings() : {});
  const saveSettings = () => { if (deps.saveSettings) deps.saveSettings(); };
  const applyQuality = () => { if (deps.applyQuality) deps.applyQuality(); };
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['menu', 'settings', 'credits', 'pauseMenu', 'shopMenu', 'mapOverlay'];

  let screen = 'menu';
  let shopId = null;

  function showOnly(id) {
    for (const el of SCREENS) {
      const node = $(el);
      if (node) node.classList.toggle('hidden', el !== id);
    }
  }

  function setScreen(s) {
    screen = s;
    showOnly(s === 'play' ? null : s === 'pause' ? 'pauseMenu' : s === 'shop' ? 'shopMenu' : s === 'map' ? 'mapOverlay' : s);
    if (s === 'pause') renderPauseExtras();
  }
  function getScreen() { return screen; }

  function renderForecast() {
    const f = weather.forecast();
    const { h } = weather.hourMinute();
    const el = $('forecast');
    if (!el) return;
    el.textContent =
      `${t('forecast', lang())} (${h}:00): ` +
      f.map((x) => `+${x.hoursAhead}h ${WEATHERS[x.weather].label[lang()] || WEATHERS[x.weather].label.en}`).join(' · ');
  }

  function renderLedger() {
    const el = $('ledger');
    if (!el) return;
    const rows = economy.ledger.slice(0, 12);
    el.innerHTML = rows.length
      ? rows.map((r) => `<div><span class="${r.amount < 0 ? 'neg' : 'pos'}">${r.amount >= 0 ? '+' : ''}$${r.amount}</span> ${r.label} — $${r.balance}</div>`).join('')
      : `<div>${t('noTransactions', lang())}</div>`;
    el.classList.remove('hidden');
  }

  function renderPauseExtras() {
    renderForecast();
    const ledger = $('ledger');
    if (ledger) ledger.classList.add('hidden');
    if (deps.ui) {
      deps.ui.renderContracts();
      deps.ui.renderSaveSlots();
    }
  }

  // ---------- Shops ----------
  const SHOP_OF_LANDMARK = { armory: 'armory', garage: 'garage', chopshop: 'chopshop', respray: 'garage' };

  function openShop(id) {
    shopId = id;
    setScreen('shop');
    const titles = { armory: t('armory', lang()), garage: t('garage', lang()), chopshop: t('chopshop', lang()) };
    $('shopTitle').textContent = titles[id] || t('shop', lang());
    renderShop();
  }

  function renderShop() {
    $('shopCash').textContent = `${t('money', lang())}: $${economy.cash}`;
    const list = $('shopList');
    list.innerHTML = '';
    const addRow = (label, priceText, disabled, onBuy) => {
      const row = document.createElement('div');
      row.className = 'shopItem';
      const span = document.createElement('span');
      span.textContent = label;
      const btn = document.createElement('button');
      btn.textContent = priceText;
      btn.disabled = !!disabled;
      btn.addEventListener('click', () => { onBuy(); renderShop(); });
      row.append(span, btn);
      list.appendChild(row);
    };
    if (shopId === 'armory' || shopId === 'garage') {
      for (const item of economy.shopItems(shopId)) {
        const name = item.name[lang()] || item.name.en;
        addRow(name, `$${item.price}`, economy.cash < item.price || (item.canBuy && !item.canBuy()), () => {
          const r = economy.buy(item.id);
          if (deps.notify) deps.notify(r.ok ? 'bought' : (r.reason === 'no-cash' ? 'noCash' : 'bought'));
        });
      }
    }
    if (shopId === 'garage') {
      const pv = vehicles.getPlayerVehicle();
      addRow(t('storeCar', lang()), pv ? t('store', lang()) : '—', !pv, () => {
        const r = economy.storeCurrentVehicle();
        if (deps.notify) deps.notify(r.ok ? 'stored' : 'garageFull');
        if (r.ok) cameraRig.setMode('foot');
      });
      economy.garage.forEach((rec, i) => {
        addRow(`${rec.name} (${Math.round(rec.integrity)}%)`, t('takeCar', lang()), false, () => {
          const v = economy.retrieveVehicle(i, LANDMARKS.garage.x + 6, LANDMARKS.garage.z, 0);
          if (v && deps.notify) deps.notify(v.def.name[lang()] || v.def.name.en);
        });
      });
    }
    if (shopId === 'chopshop') {
      const pv = vehicles.getPlayerVehicle();
      if (pv) {
        addRow(`${vehicleName(pv.def, lang())} (${Math.round(pv.integrity / pv.maxIntegrity * 100)}%)`,
          `$${economy.chopPrice(pv)}`, economy.chopPrice(pv) <= 0, () => {
            const r = economy.sellVehicle(pv);
            if (r.ok) {
              if (deps.notify) deps.notify(`${t('soldFor', lang())} $${r.price}`);
              cameraRig.setMode('foot');
            }
          });
      }
      economy.garage.forEach((rec, i) => {
        addRow(`${rec.name} (${Math.round(rec.integrity)}%) — garasi`, `$${Math.round(economy.garageChopPrice(rec))}`, false, () => {
          const v = economy.retrieveVehicle(i, LANDMARKS.chopshop.x + 6, LANDMARKS.chopshop.z, 0);
          if (v) economy.sellVehicle(v);
        });
      });
    }
  }

  function nearestShopLandmark() {
    const p = player.position();
    for (const [key, shop] of Object.entries(SHOP_OF_LANDMARK)) {
      const L = LANDMARKS[key];
      const d = Math.hypot(p.x - L.x, p.z - L.z);
      if (d < 7) return { key, shop, d };
    }
    return null;
  }

  // ---------- Settings UI ----------
  function syncSettingsUI() {
    const s = getSettings();
    $('sensitivity').value = String(s.sensitivity);
    $('sensVal').textContent = Number(s.sensitivity).toFixed(1);
    $('quality').value = s.quality;
    $('lang').value = s.lang;
    $('reduceShake').checked = !!s.reduceShake;
  }

  function bindButtons(callbacks) {
    $('btnNew').addEventListener('click', () => callbacks.newGame());
    $('btnContinue').addEventListener('click', () => callbacks.continueGame());
    $('btnSettings').addEventListener('click', () => { setScreen('settings'); syncSettingsUI(); });
    $('btnCredits').addEventListener('click', () => setScreen('credits'));
    $('btnSettingsBack').addEventListener('click', () => setScreen(screen === 'play' ? 'play' : 'menu'));
    $('btnCreditsBack').addEventListener('click', () => setScreen('menu'));
    $('btnResume').addEventListener('click', () => callbacks.resume());
    $('btnLedger').addEventListener('click', renderLedger);
    $('btnQuitMenu').addEventListener('click', () => callbacks.quitToMenu());
    $('btnCloseShop').addEventListener('click', () => callbacks.closeShop());
    $('btnPause').addEventListener('click', () => { if (screen === 'play') callbacks.pause(); });
    $('btnMap').addEventListener('click', () => { if (screen === 'play') setScreen('map'); });
    $('btnMapT').addEventListener('click', () => { if (screen === 'play') setScreen('map'); });
    $('btnPauseT').addEventListener('click', () => { if (screen === 'play') callbacks.pause(); });

    $('sensitivity').addEventListener('input', (e) => {
      getSettings().sensitivity = Number(e.target.value);
      $('sensVal').textContent = Number(e.target.value).toFixed(1);
      saveSettings();
    });
    $('quality').addEventListener('change', (e) => {
      getSettings().quality = e.target.value;
      applyQuality();
      saveSettings();
    });
    $('lang').addEventListener('change', (e) => {
      getSettings().lang = e.target.value;
      saveSettings();
      if (callbacks.onLangChange) callbacks.onLangChange();
    });
    $('reduceShake').addEventListener('change', (e) => {
      getSettings().reduceShake = e.target.checked;
      saveSettings();
    });
  }

  return {
    setScreen,
    getScreen,
    showOnly,
    openShop,
    renderShop,
    renderLedger,
    renderForecast,
    nearestShopLandmark,
    syncSettingsUI,
    bindButtons,
    get shopId() { return shopId; },
  };
}
