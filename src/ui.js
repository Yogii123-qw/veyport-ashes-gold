// ui.js — the game's face: notices, objectives, results, overlays.
//
// This module owns everything the player reads that is not the raw HUD
// bars (those live in hud.js): the objective panel, the notice stack,
// mission result screens with a real grade, the WASTED / BUSTED
// overlays, the ending screen, the contract board and the save slots.
// Every number shown comes from real state; a result screen only
// appears when a mission actually ended.

import { t, pickText } from './langData.js';

export function createUI(deps) {
  const { bus, economy, missions, contracts, wanted, save } = deps;
  const lang = () => (deps.getLang ? deps.getLang() : 'id');
  const $ = (id) => document.getElementById(id);
  const noticeEl = $('notice');
  const objectiveEl = $('objective');
  const resultEl = $('missionResult');
  const wastedEl = $('wastedOverlay');
  const bustedEl = $('bustedOverlay');
  const endingEl = $('endingOverlay');

  let noticeCount = 0;

  function announce(msg) {
    const s = $('status');
    if (s) s.textContent = msg;
  }

  /** A notice is either a lang key or a plain string. */
  function notify(keyOrText, ms = 3500) {
    if (!noticeEl) return;
    const text = t(keyOrText, lang()) !== keyOrText ? t(keyOrText, lang()) : keyOrText;
    const div = document.createElement('div');
    div.textContent = text;
    noticeEl.appendChild(div);
    noticeCount += 1;
    window.setTimeout(() => div.remove(), ms);
    announce(text);
  }

  function setObjective(obj) {
    if (!objectiveEl) return;
    if (!obj) {
      objectiveEl.classList.add('hidden');
      return;
    }
    objectiveEl.classList.remove('hidden');
    objectiveEl.innerHTML = '';
    const mission = document.createElement('div');
    mission.className = 'objMission';
    mission.textContent = obj.mission;
    const text = document.createElement('div');
    text.className = 'objText';
    text.textContent = obj.text;
    objectiveEl.append(mission, text);
    if (obj.sub) {
      const sub = document.createElement('div');
      sub.className = 'objSub';
      sub.textContent = obj.sub;
      objectiveEl.append(sub);
    }
  }

  function gradeFor(mission, stats) {
    // Gold: no wanted stars gained during the mission and under par time.
    // Silver: finished clean-ish. Bronze: finished.
    if (stats.wantedPeak <= 0 && stats.time < (stats.par || 600)) return 'Emas';
    if (stats.wantedPeak <= 2) return 'Perak';
    return 'Perunggu';
  }

  function showMissionResult(res) {
    if (!resultEl) return;
    const grade = gradeFor(res.mission, res.stats || {});
    resultEl.classList.remove('hidden');
    $('resultTitle').textContent = t('missionComplete', lang());
    $('resultMission').textContent = pickText(res.title, lang());
    $('resultGrade').textContent = grade;
    $('resultStats').innerHTML = [
      `${t('time', lang())}: ${Math.round(res.stats?.time || 0)}s`,
      `${t('reward', lang())}: $${res.reward}`,
      `${t('wanted', lang())}: ${'★'.repeat(res.stats?.wantedPeak || 0)}${'☆'.repeat(5 - (res.stats?.wantedPeak || 0))}`,
    ].join('<br>');
    const btn = $('btnResultContinue');
    btn.onclick = () => {
      resultEl.classList.add('hidden');
      if (deps.onResultClosed) deps.onResultClosed();
    };
  }

  function showWasted(bill) {
    if (!wastedEl) return;
    wastedEl.classList.remove('hidden');
    $('wastedBill').textContent = `${t('hospitalBill', lang())}: $${bill}`;
    window.setTimeout(() => wastedEl.classList.add('hidden'), 2600);
  }

  function showBusted(fine) {
    if (!bustedEl) return;
    bustedEl.classList.remove('hidden');
    $('bustedFine').textContent = `${t('fine', lang())}: $${fine}`;
    window.setTimeout(() => bustedEl.classList.add('hidden'), 2600);
  }

  function showEnding(ending) {
    if (!endingEl) return;
    endingEl.classList.remove('hidden');
    $('endingTitle').textContent = ending === 'gold' ? t('endingGold', lang()) : t('endingAsh', lang());
    $('endingText').textContent = t('freeRoamAfter', lang());
    const btn = $('btnEndingContinue');
    btn.onclick = () => endingEl.classList.add('hidden');
  }

  function showMissionFailed(reason) {
    notify(`${t('missionFailed', lang())} ${reason || ''}`, 4000);
  }

  // ---------- Contract board (pause menu) ----------
  function renderContracts() {
    const el = $('contractList');
    if (!el) return;
    el.innerHTML = '';
    const active = contracts.active;
    if (active) {
      const d = document.createElement('div');
      d.className = 'contractRow active';
      d.textContent = `${t(active.type, lang())} — $${active.payout}${active.timeLeft > 0 ? ` — ${Math.ceil(active.timeLeft)}s` : ''}`;
      el.appendChild(d);
    }
    for (const o of contracts.offers) {
      const row = document.createElement('div');
      row.className = 'contractRow';
      const span = document.createElement('span');
      span.textContent = `${t(o.type, lang())} — ${o.dist}m — $${o.payout}`;
      const btn = document.createElement('button');
      btn.textContent = t('accept', lang());
      btn.disabled = !!active;
      btn.addEventListener('click', () => { contracts.accept(o.id); renderContracts(); });
      row.append(span, btn);
      el.appendChild(row);
    }
    const rep = $('contractRep');
    if (rep) rep.textContent = `${t('reputation', lang())}: ${contracts.reputation}`;
  }

  // ---------- Save slots (pause menu) ----------
  function renderSaveSlots() {
    const el = $('saveSlots');
    if (!el) return;
    el.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const info = save.slotInfo(i);
      const row = document.createElement('div');
      row.className = 'saveRow';
      const span = document.createElement('span');
      span.textContent = info.empty
        ? `Slot ${i} — ${t('slotEmpty', lang())}`
        : `Slot ${i} — $${info.cash} — ${info.missions}/6 ${t('mission', lang())}${info.corrupt ? ' (rusak)' : ''}`;
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Simpan';
      saveBtn.addEventListener('click', () => {
        const r = save.saveSlot(i);
        notify(r.ok ? 'saveDone' : 'saveCorrupt');
        renderSaveSlots();
      });
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Muat';
      loadBtn.disabled = info.empty || info.corrupt;
      loadBtn.addEventListener('click', () => {
        const r = save.loadSlot(i);
        notify(r.ok ? 'saveDone' : 'saveCorrupt');
        if (r.ok && deps.onLoad) deps.onLoad();
      });
      const expBtn = document.createElement('button');
      expBtn.textContent = 'Ekspor';
      expBtn.disabled = info.empty;
      expBtn.addEventListener('click', () => {
        const r = save.exportSave(i);
        if (!r.ok) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([r.json], { type: 'application/json' }));
        a.download = r.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        notify('saveExported');
      });
      row.append(span, saveBtn, loadBtn, expBtn);
      el.appendChild(row);
    }
    const imp = $('importSave');
    if (imp) {
      imp.onchange = () => {
        const f = imp.files && imp.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const r = save.importSave(String(reader.result));
          notify(r.ok ? 'saveImported' : 'saveCorrupt');
          if (r.ok && deps.onLoad) deps.onLoad();
          renderSaveSlots();
        };
        reader.readAsText(f);
      };
    }
  }

  // ---------- Bus reactions ----------
  bus.on('mission-complete', ({ mission, reward, time }) => {
    const m = missions.missions.find((x) => x.id === mission);
    showMissionResult({ mission, title: m ? m.title : { id: mission, en: mission }, reward, stats: { time: time || 0, wantedPeak: wanted.stars } });
  });
  bus.on('mission-failed', ({ reason }) => showMissionFailed(reason));
  bus.on('wasted-done', ({ bill }) => showWasted(bill));
  bus.on('busted-done', ({ fine }) => showBusted(fine));
  bus.on('story-complete', ({ ending }) => showEnding(ending));
  bus.on('wanted-up', () => notify('wantedUp'));
  bus.on('wanted-down', () => notify('wantedDown'));
  bus.on('witness', () => notify('witnessCall'));

  function update(dt) {
    void dt;
    // Objective panel follows the mission or the active contract.
    const obj = missions.objectiveText();
    if (obj) {
      setObjective({ mission: obj.mission, text: obj.text });
    } else if (contracts.active) {
      const c = contracts.active;
      setObjective({
        mission: t('contract', lang()),
        text: `${t(c.type, lang())} — $${c.payout}`,
        sub: c.timeLeft > 0 ? `${Math.ceil(c.timeLeft)}s` : undefined,
      });
    } else if (missions.state.storyComplete) {
      setObjective({ mission: t('freeRoam', lang()), text: t('freeRoamAfter', lang()) });
    } else {
      setObjective(null);
    }
  }

  return {
    update,
    notify,
    setObjective,
    showMissionResult,
    showMissionFailed,
    showWasted,
    showBusted,
    showEnding,
    renderContracts,
    renderSaveSlots,
    announce,
    get noticeCount() { return noticeCount; },
  };
}
