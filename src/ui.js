// ui.js - notifications, mission banners, hitmarkers, results screens,
// the two endings, and pause-menu settings. The UI never invents
// numbers: every figure on a results screen comes from the live run
// (time, accuracy, reward, rank).

export class UiSys {
  constructor(w) {
    this.w = w;
    // Notification feed (top center, stacked, self-expiring).
    this.feed = document.createElement('div');
    this.feed.id = 'notifyFeed';
    document.body.appendChild(this.feed);
    // Mission banner (big center text, fades after 3 s).
    this.bannerEl = document.createElement('div');
    this.bannerEl.id = 'missionBanner';
    this.bannerEl.style.display = 'none';
    document.body.appendChild(this.bannerEl);
    this.bannerTimer = 0;
    // Hitmarker (center crosshair flash).
    this.hitEl = document.createElement('div');
    this.hitEl.id = 'hitmarker';
    this.hitEl.style.display = 'none';
    this.hitEl.textContent = 'X';
    document.body.appendChild(this.hitEl);
    this.hitTimer = 0;
    // Results overlay (mission done / failed).
    this.resultsEl = document.createElement('div');
    this.resultsEl.id = 'resultsOverlay';
    this.resultsEl.className = 'overlay';
    this.resultsEl.style.display = 'none';
    document.body.appendChild(this.resultsEl);
    this.resultsAction = null;
    // Pause-menu settings (language + volumes), if the menu has them.
    const langSel = document.getElementById('setLang');
    if (langSel) {
      langSel.value = w.settings.lang;
      langSel.addEventListener('change', () => {
        w.settings.lang = langSel.value;
        w.lang.set(langSel.value);
        this.notify(langSel.value === 'id' ? 'Bahasa: Indonesia' : 'Language: English', 'info');
      });
    }
    const master = document.getElementById('setMaster');
    if (master) {
      master.value = Math.round(w.settings.master * 100);
      master.addEventListener('input', () => {
        w.settings.master = master.value / 100;
        if (w.audio) w.audio.setMaster(w.settings.master);
      });
    }
    const music = document.getElementById('setMusic');
    if (music) {
      music.value = Math.round(w.settings.music * 100);
      music.addEventListener('input', () => {
        w.settings.music = music.value / 100;
        if (w.audio) w.audio.setMusic(w.settings.music);
      });
    }
  }

  notify(text, kind = 'info') {
    const d = document.createElement('div');
    d.className = `notify ${kind}`;
    d.textContent = text;
    this.feed.appendChild(d);
    while (this.feed.children.length > 4) this.feed.removeChild(this.feed.firstChild);
    setTimeout(() => {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 4200);
  }

  banner(title, sub) {
    this.bannerEl.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'bannerTitle';
    t.textContent = title;
    this.bannerEl.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'bannerSub';
      s.textContent = sub;
      this.bannerEl.appendChild(s);
    }
    this.bannerEl.style.display = 'block';
    this.bannerTimer = 3;
  }

  hitmarker(kill) {
    this.hitEl.textContent = 'X';
    this.hitEl.style.color = kill ? '#ff4040' : '#ffffff';
    this.hitEl.style.display = 'block';
    this.hitTimer = 0.18;
  }

  _resultsHtml(o) {
    const rows = [];
    if (o.mission) rows.push(`<div class="resRow"><span>Misi</span><b>${o.mission}</b></div>`);
    if (o.reason) rows.push(`<div class="resRow"><span>Sebab</span><b>${o.reason}</b></div>`);
    if (o.time !== undefined) rows.push(`<div class="resRow"><span>${this.w.lang.t('time')}</span><b>${o.time} dtk</b></div>`);
    if (o.accuracy !== undefined) rows.push(`<div class="resRow"><span>${this.w.lang.t('accuracy')}</span><b>${o.accuracy}%</b></div>`);
    if (o.rank) rows.push(`<div class="resRow"><span>${this.w.lang.t('rank')}</span><b>${o.rank}</b></div>`);
    if (o.reward) rows.push(`<div class="resRow"><span>${this.w.lang.t('reward')}</span><b>$${o.reward}</b></div>`);
    return rows.join('');
  }

  showResults(o) {
    const w = this.w;
    let buttons = '';
    if (o.failed && o.onRetry) {
      buttons += `<button id="resRetry" class="bigBtn">${w.lang.t('retry')}</button>`;
    }
    if (o.next && o.onNext) {
      buttons += `<button id="resNext" class="bigBtn">${w.lang.t('nextMission')}: ${o.next}</button>`;
    }
    if (!buttons) {
      buttons = `<button id="resClose" class="bigBtn">${w.lang.t('keepGoing')}</button>`;
    }
    this.resultsEl.innerHTML = `<div class="panel"><h2>${o.title}</h2>${this._resultsHtml(o)}${buttons}</div>`;
    this.resultsEl.style.display = 'flex';
    const retry = this.resultsEl.querySelector('#resRetry');
    if (retry) retry.addEventListener('click', () => { this.resultsEl.style.display = 'none'; o.onRetry(); });
    const next = this.resultsEl.querySelector('#resNext');
    if (next) next.addEventListener('click', () => { this.resultsEl.style.display = 'none'; o.onNext(); });
    const close = this.resultsEl.querySelector('#resClose');
    if (close) close.addEventListener('click', () => { this.resultsEl.style.display = 'none'; });
  }

  showEnding(ending, reward) {
    const w = this.w;
    const isGold = ending === 'GOLD';
    const title = w.lang.t(isGold ? 'endingGold' : 'endingAsh');
    const text = w.lang.t(isGold ? 'goldText' : 'ashText');
    this.resultsEl.innerHTML = `<div class="panel"><h2>${title}</h2><p class="desc">${text}</p>` +
      `<div class="resRow"><span>${w.lang.t('reward')}</span><b>$${reward}</b></div>` +
      `<p class="desc">${w.lang.t('freeRoamAfter')}</p>` +
      `<button id="resClose" class="bigBtn">${w.lang.t('keepGoing')}</button></div>`;
    this.resultsEl.style.display = 'flex';
    const close = this.resultsEl.querySelector('#resClose');
    if (close) close.addEventListener('click', () => { this.resultsEl.style.display = 'none'; });
  }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.style.display = 'none';
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitEl.style.display = 'none';
    }
  }
}
