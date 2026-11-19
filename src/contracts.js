// contracts.js - procedural side contracts: Delivery, Getaway, Repo,
// Vigilante. Generated from the road graph and the landmark registry,
// priced by distance and risk, and bounded by reputation: fail one and
// the next pays less. A contract is a real job with a real waypoint, a
// real timer where the job needs one, and a real payout in the ledger.

const CONTRACT_POINTS = [
  { name: 'Dermaga Docks', x: -520, z: -480 },
  { name: 'Gudang Safehouse', x: -450, z: -375 },
  { name: 'Bar Rusty Anchor', x: 300, z: -150 },
  { name: 'Toko Senjata', x: 450, z: 0 },
  { name: 'Pasar Bazaar', x: -75, z: 375 },
  { name: 'Mercusuar', x: 450, z: 525 },
  { name: 'Marina', x: 375, z: -450 },
  { name: 'Bengkel Respray', x: -450, z: 75 },
  { name: 'Chop-shop', x: -375, z: 75 },
  { name: 'Stasiun CPD', x: 150, z: -450 },
];

const REPO_CLASSES = ['swift', 'bulldog', 'komodo', 'vagabond', 'marlin'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class ContractSys {
  constructor(w) {
    this.w = w;
    this.offers = [];
    this.active = null;
    this.done = 0;
    this.failed = 0;
    this.rep = 50;
    this.amnestyTarget = null;
    this.offerTimer = 0;
    this.generateOffers();
  }

  get repMultiplier() {
    return 0.8 + this.rep / 250;
  }

  // Price: base 150 + distance * 0.35 + risk, scaled by reputation,
  // clamped to the SPEC band $150-600.
  price(distanceM, risk) {
    const raw = (150 + distanceM * 0.35 + risk) * this.repMultiplier;
    return Math.max(150, Math.min(600, Math.round(raw / 10) * 10));
  }

  _routeDistance(ax, az, bx, bz) {
    const g = this.w.graph;
    const from = g.nearestNode(ax, az);
    const to = g.nearestNode(bx, bz);
    const path = g.shortestPath(from, to);
    let d = 0;
    for (let i = 1; i < path.length; i++) {
      const a = g.nodePos(path[i - 1]), b = g.nodePos(path[i]);
      d += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return Math.max(150, d);
  }

  _make(type) {
    const w = this.w;
    const a = pick(CONTRACT_POINTS);
    let b = pick(CONTRACT_POINTS);
    let guard = 0;
    while (b === a && guard++ < 10) b = pick(CONTRACT_POINTS);
    const dist = this._routeDistance(a.x, a.z, b.x, b.z);
    if (type === 'delivery') {
      return {
        type, from: a, to: b, distance: dist,
        reward: this.price(dist, 0), timer: Math.max(120, dist / 6),
        text: `Antar paket ${a.name} ke ${b.name}`,
      };
    }
    if (type === 'getaway') {
      return {
        type, from: a, to: b, distance: dist,
        reward: this.price(dist, 120), timer: Math.max(150, dist / 5),
        text: `Jemput klien di ${a.name}, kabur ke ${b.name} (polisi akan mengejar)`,
      };
    }
    if (type === 'repo') {
      const cls = pick(REPO_CLASSES);
      return {
        type, from: a, to: { name: 'Chop-shop', x: -375, z: 75 }, distance: dist,
        reward: this.price(dist, 80), timer: 0, classId: cls,
        text: `Curi ${cls} di ${a.name}, bawa ke Chop-shop`,
      };
    }
    // vigilante
    return {
      type, from: a, to: b, distance: dist,
      reward: this.price(dist, 100), timer: 180,
      text: `Hentikan penjahat di ${a.name} tanpa menarik wanted`,
    };
  }

  generateOffers() {
    const types = ['delivery', 'getaway', 'repo', 'vigilante'];
    // Shuffle and take three distinct types.
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    this.offers = types.slice(0, 3).map((t) => this._make(t));
  }

  accept(index) {
    if (this.active) return false;
    const offer = this.offers[index];
    if (!offer) return false;
    const c = { ...offer, startedAt: this.w.stats ? this.w.stats.playSeconds : 0, timerLeft: offer.timer, starsAtAccept: this.w.wanted.stars };
    this.active = c;
    if (c.type === 'getaway') {
      this.w.wanted.addHeat(20, 'getaway');
    }
    if (c.type === 'repo') {
      const car = this.w.cars.find((x) => x.def.id === c.classId && !x.wrecked && x !== this.w.player.vehicle);
      if (car) {
        c.targetCar = car;
        car.marked = true;
      }
    }
    if (c.type === 'vigilante') {
      const criminal = this.w.peds.spawnHostile(c.from.x + 8, c.from.z + 8, 100, 'criminal');
      c.target = criminal;
      this.amnestyTarget = criminal;
    }
    this.offers.splice(index, 1);
    if (this.w.ui) this.w.ui.notify(c.text, 'info');
    return true;
  }

  abandon() {
    if (!this.active) return;
    this._failContract('Kontrak dibatalkan');
  }

  _completeContract() {
    const c = this.active;
    const paid = this.w.economy.payout(c.reward, 1, `Kontrak ${c.type}`);
    this.done += 1;
    this.rep = Math.min(100, this.rep + 3);
    this.active = null;
    this.amnestyTarget = null;
    if (this.w.ui) {
      this.w.ui.notify(`${this.w.lang.t('contractDone')}: +$${paid}`, 'good');
      this.w.ui.banner(this.w.lang.t('contractDone'), `+$${paid}`);
    }
    if (this.w.save) this.w.save.autosave(this.w);
  }

  _failContract(reason) {
    this.failed += 1;
    this.rep = Math.max(0, this.rep - 8);
    if (this.active && this.active.target) {
      this.w.peds.remove(this.active.target);
    }
    this.active = null;
    this.amnestyTarget = null;
    if (this.w.ui) this.w.ui.notify(`${this.w.lang.t('contractFailed')}: ${reason}`, 'bad');
  }

  update(dt) {
    const w = this.w;
    // Fresh offers trickle in while the player roams.
    this.offerTimer -= dt;
    if (this.offerTimer <= 0) {
      this.offerTimer = 90;
      if (this.offers.length < 3) this.offers.push(this._make(pick(['delivery', 'getaway', 'repo', 'vigilante'])));
      else this.generateOffers();
    }
    if (!this.active) return;
    const c = this.active;
    const p = w.player;
    const px = p.onFoot ? p.x : (p.vehicle ? p.vehicle.x : p.x);
    const pz = p.onFoot ? p.z : (p.vehicle ? p.vehicle.z : p.z);
    if (c.timer > 0) {
      c.timerLeft -= dt;
      if (c.timerLeft <= 0) {
        this._failContract('Waktu habis');
        return;
      }
    }
    if (c.type === 'delivery') {
      if (Math.hypot(c.to.x - px, c.to.z - pz) < 12) this._completeContract();
    } else if (c.type === 'getaway') {
      // Pickup first, then the drop.
      if (!c.pickedUp) {
        if (Math.hypot(c.from.x - px, c.from.z - pz) < 12) {
          c.pickedUp = true;
          if (w.ui) w.ui.notify('Klien naik. Kabur sekarang!', 'info');
        }
      } else if (Math.hypot(c.to.x - px, c.to.z - pz) < 12) {
        this._completeContract();
      }
    } else if (c.type === 'repo') {
      if (c.targetCar && p.vehicle === c.targetCar && Math.hypot(c.to.x - px, c.to.z - pz) < 12) {
        this._completeContract();
      } else if (c.targetCar && c.targetCar.wrecked) {
        this._failContract('Mobil target hancur');
      }
    } else if (c.type === 'vigilante') {
      if (c.target && !c.target.alive) {
        // No wanted gained while the amnesty target was the victim.
        this._completeContract();
      } else if (w.wanted.stars > c.starsAtAccept) {
        this._failContract('Polisi terlibat');
      }
    }
  }

  // The active contract's waypoint for the HUD/minimap.
  waypoint() {
    const c = this.active;
    if (!c) return null;
    if (c.type === 'getaway' && !c.pickedUp) return { x: c.from.x, z: c.from.z };
    if (c.type === 'repo' && c.targetCar) return { x: c.targetCar.x, z: c.targetCar.z };
    if (c.type === 'vigilante' && c.target) return { x: c.target.x, z: c.target.z };
    return { x: c.to.x, z: c.to.z };
  }

  saveState() {
    return { done: this.done, failed: this.failed, rep: this.rep };
  }

  loadState(s) {
    this.done = s.done || 0;
    this.failed = s.failed || 0;
    this.rep = s.rep === undefined ? 50 : s.rep;
  }
}
