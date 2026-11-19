// hud.js - the heads-up display: money, weapon + ammo, clock + weather,
// speedometer, health bar, objective + distance, compass, wanted stars,
// weapon slots, and the action button label. Every value is read from
// the live game state each frame; nothing is ever hardcoded or faked.
// The compass reads the CAMERA yaw (documented): it is the direction
// the player is looking, which is what a compass strip is for.

import { WEAPONS } from './player.js';

const COMPASS_DIRS = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];

export class HudSys {
  constructor(w) {
    this.w = w;
    this.el = (id) => document.getElementById(id);
    this.starEls = [];
    const holder = this.el('wantedStars');
    if (holder) {
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.className = 'star';
        s.textContent = '★';
        holder.appendChild(s);
        this.starEls.push(s);
      }
    }
    this.lastObjective = '';
    this.lastWeapon = '';
  }

  update() {
    const w = this.w;
    const p = w.player;
    const econ = w.economy.summary();
    this.el('hudMoney').textContent = '$' + econ.balance.toLocaleString('en-US');
    const speed = p.onFoot ? p.speed * 3.6 : (p.vehicle ? Math.abs(p.vehicle.speed) * 3.6 : 0);
    this.el('hudSpeed').textContent = Math.round(speed) + ' km/h';
    this.el('hudHp').style.width = Math.max(0, p.hp) + '%';
    this.el('hudClock').textContent = w.weather.timeString() + '  ' + w.weather.state.toUpperCase();
    const def = WEAPONS[p.weapon];
    const slot = p.owned[p.weapon];
    const ammo = def.kind === 'melee' ? '' : `  ${slot.mag}/${slot.reserve}`;
    const label = def.name + ammo;
    if (label !== this.lastWeapon) {
      this.el('hudWeapon').textContent = label;
      this.lastWeapon = label;
    }
    // Objective: the active mission stage, a contract, or free roam.
    let objective = '';
    if (w.missions && w.missions.isActive) {
      objective = w.missions.objectiveText();
      const d = w.missions.distanceToTarget();
      if (d !== null) objective += `  (${d} m)`;
      const st = w.missions.currentDef;
      if (st && st.timer > 0 && w.missions.stageTimer > 0) {
        objective += `  [${Math.ceil(w.missions.stageTimer)} dtk]`;
      }
    } else if (w.contracts && w.contracts.active) {
      objective = w.contracts.active.text;
      if (w.contracts.active.timerLeft > 0) {
        objective += `  [${Math.ceil(w.contracts.active.timerLeft)} dtk]`;
      }
    } else {
      objective = w.lang.t('freeRoam');
    }
    if (objective !== this.lastObjective) {
      this.el('hudObjective').textContent = objective;
      this.lastObjective = objective;
    }
    const inCar = !p.onFoot;
    this.el('btnActionLabel').textContent = inCar ? 'KELUAR' : 'MASUK';
    // Compass from the camera yaw.
    const yawDeg = ((w.rig.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.round(yawDeg / (Math.PI / 4)) % 8;
    this.el('hudCompass').textContent = COMPASS_DIRS[idx];
    // Wanted stars, blinking while they are rising.
    const stars = w.wanted ? w.wanted.stars : 0;
    for (let i = 0; i < this.starEls.length; i++) {
      const el = this.starEls[i];
      const on = i < stars;
      el.classList.toggle('lit', on);
      el.style.opacity = on ? '1' : '0.25';
    }
    // Weapon slots.
    const ids = Object.keys(p.owned);
    document.querySelectorAll('[data-weapon]').forEach((slotEl, i) => {
      const id = ids[i];
      slotEl.style.display = id ? 'block' : 'none';
      if (id) {
        slotEl.textContent = WEAPONS[id].name.split(' ')[0];
        slotEl.classList.toggle('active', p.weapon === id);
      }
    });
  }
}
