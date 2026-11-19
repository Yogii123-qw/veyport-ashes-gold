// contracts.js — side work: procedural contracts and world activities.
//
// Four contract types (SPEC §3.1), generated without limit: Delivery,
// Getaway, Repo, Vigilante. A contract board lives at the bar — walk up
// and press F, or take the nearest offer from the pause menu. Payouts
// follow distance + risk, and failing a contract costs reputation, which
// shrinks the next payout — the economy has consequences. The same
// module owns the three world activities: 24 Ember Caches ($100 each,
// $1,000 bonus for the set), 5 Stunt Jumps (air time + distance), and 3
// Time Trials (local best times). All of it is saved.

import { LANDMARKS } from './city.js';

const CONTRACT_SPOTS = [
  { x: 30, z: -180, name: 'bar' },
  { x: -460, z: -380, name: 'safehouse' },
  { x: 150, z: 300, name: 'market' },
  { x: 420, z: -420, name: 'marina' },
];

const CACHE_SPOTS = [
  [-560, -520], [-480, -300], [-380, -540], [-300, -420], [-520, 100], [-420, 300],
  [-300, 60], [-180, -420], [-60, -300], [60, -420], [180, -300], [300, -480],
  [480, -300], [540, -120], [420, 60], [300, 240], [120, 420], [-60, 480],
  [-240, 420], [-420, 480], [60, 120], [-120, 60], [240, -60], [480, 420],
];

const STUNT_JUMPS = [
  { x: 0, z: 545, dir: 0, name: { id: 'Lompatan Pantai', en: 'Beach Jump' } },
  { x: -300, z: 0, dir: Math.PI / 2, name: { id: 'Lompatan Terowongan', en: 'Tunnel Jump' } },
  { x: 150, z: -450, dir: 0, name: { id: 'Lompatan Marina', en: 'Marina Jump' } },
  { x: 450, z: 300, dir: -Math.PI / 2, name: { id: 'Lompatan Mercusuar', en: 'Lighthouse Jump' } },
  { x: -450, z: -150, dir: Math.PI, name: { id: 'Lompatan Dok', en: 'Docks Jump' } },
];

const TIME_TRIALS = [
  { id: 'tt1', name: { id: 'Putaran Neon', en: 'Neon Loop' }, points: [[-150, -150], [150, -150], [150, 150], [-150, 150]] },
  { id: 'tt2', name: { id: 'Pesisir Ember', en: 'Ember Coast' }, points: [[-450, 545], [0, 545], [450, 545], [480, 300]] },
  { id: 'tt3', name: { id: 'Ring Kota', en: 'City Ring' }, points: [[-450, -450], [450, -450], [450, 450], [-450, 450]] },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createContracts(deps) {
  const { player, vehicles, city, economy, bus, wanted } = deps;
  const rng = mulberry32(31337);
  const lang = () => (deps.getLang ? deps.getLang() : 'id');
  const notify = (msg) => { if (deps.notify) deps.notify(msg); };

  const state = {
    reputation: 0, // -100..100; failed contracts lower it, payouts scale with it
    active: null, // {id, type, ...}
    offers: [],
    done: 0,
    failed: 0,
    cachesFound: [],
    stuntBest: {},
    trialBest: {},
    contractSeq: 0,
  };

  // ---------- Contract generation ----------
  function randomDest(fromX, fromZ, minDist = 250) {
    for (let tries = 0; tries < 20; tries++) {
      const p = city.randomRoadPoint(rng);
      if (Math.hypot(p.x - fromX, p.z - fromZ) >= minDist) return p;
    }
    return { x: -fromX, z: -fromZ };
  }

  function payoutFor(dist, risk) {
    const base = 150 + Math.round(dist / 4) + risk * 60;
    const repMul = 1 + state.reputation / 200;
    return Math.max(80, Math.round((base * repMul) / 10) * 10);
  }

  function generateOffer() {
    const types = ['delivery', 'getaway', 'repo', 'vigilante'];
    const type = types[Math.floor(rng() * types.length)];
    const p = player.position();
    const dest = randomDest(p.x, p.z);
    const dist = Math.hypot(dest.x - p.x, dest.z - p.z);
    const risk = type === 'vigilante' ? 3 : type === 'getaway' ? 2 : type === 'repo' ? 2 : 1;
    const c = {
      id: `c${++state.contractSeq}`,
      type,
      dest,
      dist: Math.round(dist),
      payout: payoutFor(dist, risk),
      timeLeft: type === 'delivery' ? 150 + dist / 6 : type === 'getaway' ? 120 : 0,
      target: null,
    };
    if (type === 'repo') {
      const kinds = ['swift', 'bulldog', 'seraph', 'komodo'];
      c.targetType = kinds[Math.floor(rng() * kinds.length)];
    }
    if (type === 'vigilante') {
      c.targetPos = randomDest(p.x, p.z, 150);
    }
    return c;
  }

  function refreshOffers() {
    while (state.offers.length < 3) state.offers.push(generateOffer());
  }

  function accept(id) {
    const i = state.offers.findIndex((o) => o.id === id);
    if (i < 0 || state.active) return false;
    const c = state.offers.splice(i, 1)[0];
    state.active = { ...c, startedAt: 0 };
    if (c.type === 'getaway') wanted.setStars(Math.max(wanted.stars, 2));
    if (c.type === 'repo') {
      const v = vehicles.makeVehicle(c.targetType, c.dest.x, c.dest.z, rng() * 6, { parked: true });
      c.targetVehicle = v;
    }
    if (c.type === 'vigilante') {
      const list = deps.pedestrians ? deps.pedestrians.spawnGang('foundry', c.targetPos.x, c.targetPos.z, 2, { hostile: true }) : [];
      c.targets = list;
    }
    bus.emit('contract-accepted', { contract: c });
    notify('contractAccepted');
    refreshOffers();
    return true;
  }

  function completeActive() {
    const c = state.active;
    if (!c) return;
    economy.earn(c.payout, `Kontrak selesai: ${c.type}`);
    state.done += 1;
    state.reputation = Math.min(100, state.reputation + 4);
    bus.emit('contract-complete', { contract: c, payout: c.payout });
    notify('contractComplete');
    state.active = null;
  }

  function failActive(reason) {
    const c = state.active;
    if (!c) return;
    state.failed += 1;
    state.reputation = Math.max(-100, state.reputation - 8);
    bus.emit('contract-failed', { contract: c, reason });
    notify('contractFailed');
    if (c.targetVehicle && !c.targetVehicle.wrecked) vehicles.removeVehicle(c.targetVehicle);
    state.active = null;
  }

  bus.on('ped-down', ({ ped }) => {
    const c = state.active;
    if (!c || c.type !== 'vigilante' || !c.targets) return;
    if (c.targets.includes(ped) && c.targets.every((t) => !t.alive)) completeActive();
  });

  // ---------- World activities ----------
  let cacheMeshes = [];
  /** Build the visible gold cache boxes (called once, from main.js). */
  function buildCaches(THREE, scene) {
    const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8b23c, emissive: 0xa87810, emissiveIntensity: 0.9,
      metalness: 0.7, roughness: 0.3,
    });
    cacheMeshes = CACHE_SPOTS.map(([x, z]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0.9, z);
      m.rotation.y = Math.PI / 4;
      scene.add(m);
      return m;
    });
  }

  function checkCaches() {
    const p = player.position();
    for (let i = 0; i < CACHE_SPOTS.length; i++) {
      if (state.cachesFound.includes(i)) continue;
      const [x, z] = CACHE_SPOTS[i];
      if (Math.hypot(p.x - x, p.z - z) < 4) {
        state.cachesFound.push(i);
        if (cacheMeshes[i]) cacheMeshes[i].visible = false;
        economy.earn(100, 'Ember Cache');
        notify('cacheFound');
        bus.emit('cache-found', { index: i, total: state.cachesFound.length });
        if (state.cachesFound.length === CACHE_SPOTS.length) {
          economy.earn(1000, 'Ember Cache bonus (lengkap)');
          notify('cacheBonus');
        }
      }
    }
  }

  let airTime = 0;
  let lastY = 0;
  let stuntArmed = false;
  let stuntJump = null;
  function checkStunts(dt) {
    const ps = player.state;
    const v = ps.inVehicle ? ps.vehicle : null;
    if (!v) { airTime = 0; stuntArmed = false; return; }
    // A stunt jump starts when the car leaves the ground fast near a jump.
    const p = player.position();
    if (!stuntArmed) {
      for (const j of STUNT_JUMPS) {
        if (Math.hypot(p.x - j.x, p.z - j.z) < 12 && Math.abs(v.speed) > 18) {
          stuntArmed = true;
          stuntJump = j;
          airTime = 0;
          break;
        }
      }
    }
    // Airborne is approximated by speed + no wall contact: the arcade
    // model has no vertical axis, so air time is measured as the time
    // the car spends above 24 m/s after the lip without slowing.
    if (stuntArmed) {
      airTime += dt;
      if (Math.abs(v.speed) < 12 || airTime > 6) {
        const score = Math.round(airTime * 100 + Math.abs(v.speed) * 2);
        const key = stuntJump.name.en;
        if (score > (state.stuntBest[key] || 0)) {
          state.stuntBest[key] = score;
          economy.earn(50 + Math.min(250, score), `Stunt Jump: ${key}`);
          notify('stuntScore');
          bus.emit('stunt', { jump: key, score });
        }
        stuntArmed = false;
        airTime = 0;
      }
    }
    void lastY;
  }

  let trial = null;
  function startTrial(id) {
    const t = TIME_TRIALS.find((x) => x.id === id);
    if (!t || trial) return false;
    trial = { def: t, idx: 0, time: 0 };
    return true;
  }
  function checkTrials(dt) {
    if (!trial) return;
    trial.time += dt;
    const p = player.position();
    const target = trial.def.points[trial.idx];
    if (Math.hypot(p.x - target[0], p.z - target[1]) < 12) {
      trial.idx += 1;
      if (trial.idx >= trial.def.points.length) {
        const t = trial.time;
        const key = trial.def.id;
        if (!state.trialBest[key] || t < state.trialBest[key]) {
          state.trialBest[key] = Math.round(t * 10) / 10;
          economy.earn(150, `Time Trial: ${trial.def.name.en} — ${t.toFixed(1)}s`);
          notify('trialBest');
        }
        bus.emit('trial-done', { trial: key, time: t });
        trial = null;
      }
    }
  }

  function update(dt, ctx) {
    if (!state.active) refreshOffers();
    const c = state.active;
    if (c) {
      const p = player.position();
      if (c.timeLeft > 0) {
        c.timeLeft -= dt;
        if (c.timeLeft <= 0) { failActive('time'); return; }
      }
      switch (c.type) {
        case 'delivery':
          if (Math.hypot(p.x - c.dest.x, p.z - c.dest.z) < 9) completeActive();
          break;
        case 'getaway': {
          const d = Math.hypot(p.x - c.dest.x, p.z - c.dest.z);
          if (d < 9 && wanted.stars === 0) completeActive();
          break;
        }
        case 'repo': {
          const ps = player.state;
          if (ps.inVehicle && ps.vehicle === c.targetVehicle) completeActive();
          break;
        }
        case 'vigilante':
          break; // completed by the ped-down handler
        default:
          break;
      }
    }
    checkCaches();
    checkStunts(dt);
    checkTrials(dt);
    void ctx;
  }

  function waypoint() {
    const c = state.active;
    if (!c) return null;
    if (c.type === 'vigilante' && c.targetPos) return { x: c.targetPos.x, z: c.targetPos.z };
    if (c.type === 'repo' && c.targetVehicle) return { x: c.targetVehicle.x, z: c.targetVehicle.z };
    return { x: c.dest.x, z: c.dest.z };
  }

  refreshOffers();

  return {
    state,
    update,
    accept,
    refreshOffers,
    waypoint,
    startTrial,
    get active() { return state.active; },
    get offers() { return state.offers; },
    get caches() { return { found: state.cachesFound.length, total: CACHE_SPOTS.length, spots: CACHE_SPOTS }; },
    get stuntJumps() { return STUNT_JUMPS; },
    get timeTrials() { return TIME_TRIALS; },
    get reputation() { return state.reputation; },
    buildCaches,
    get trial() { return trial; },
  };
}
