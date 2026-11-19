// missions.js — the six story missions of Veyport (SPEC §3.1).
//
// Each mission is data: a chain of stages, and each stage is one kind
// of work — go somewhere, talk, steal a car, deliver on a timer, defeat
// a group, defend a place, chase a moving target, break a truck, race
// checkpoints, or choose. Stages are checked every frame against real
// game state; nothing completes by a timer pretending to be progress.
// Failures are real too (timer out, target dead, truck destroyed) and
// restart from the last checkpoint stage. The M5 and M6 choices are
// recorded in the save and change the ending.

import { pickText } from './langData.js';
import { LANDMARKS } from './city.js';

const DIALOG = {
  ilex1: [
    { speaker: { id: 'Madame Ilex', en: 'Madame Ilex' }, portrait: 28, text: { id: 'Rook Calloway. Akhirnya pulang juga. Utang adikmu, Cole — $8.000 ke Harbormen. Mereka tidak lupa.', en: 'Rook Calloway. Home at last. Your brother Cole\'s debt — $8,000 to the Harbormen. They don\'t forget.' } },
    { speaker: { id: 'Madame Ilex', en: 'Madame Ilex' }, portrait: 28, text: { id: 'Kerja pertama: curi mobil di luar sana, antar ke safehouse-mu. Jangan buat keributan.', en: 'First job: steal a car out there, bring it to your safehouse. Don\'t make a scene.' } },
  ],
  drayke2: [
    { speaker: { id: 'Marlow Drayke', en: 'Marlow Drayke' }, portrait: 210, text: { id: 'Kargo panas di dok. Antar ke tiga titik sebelum dingin. Polisi sudah mengendus — jangan berhenti.', en: 'Hot cargo at the docks. Deliver to three points before it goes cold. The police are sniffing — don\'t stop.' } },
  ],
  ilex3: [
    { speaker: { id: 'Madame Ilex', en: 'Madame Ilex' }, portrait: 28, text: { id: 'Foundry Kings membajak kargo kita. Masuk chop-shop mereka, ambil mobil bertanda itu. Penjaganya tidak ramah.', en: 'The Foundry Kings hijacked our cargo. Get into their chop-shop and take the marked car. Its guards are not friendly.' } },
  ],
  drayke4: [
    { speaker: { id: 'Marlow Drayke', en: 'Marlow Drayke' }, portrait: 210, text: { id: 'Balapan malam ini, Neon Mile. Tiga checkpoint. Menang, dan KR-9 itu milikmu. Kalah, dan kamu milik mereka.', en: 'Tonight\'s race, Neon Mile. Three checkpoints. Win, and the KR-9 is yours. Lose, and you are theirs.' } },
  ],
  pell5: [
    { speaker: { id: 'Sersan Ada Pell', en: 'Sergeant Ada Pell' }, portrait: 150, text: { id: 'Aku tahu siapa kamu, Rook. Cole pernah menyelamatkan nyawaku. Utang itu direkayasa — Vex yang menulisnya.', en: 'I know who you are, Rook. Cole once saved my life. That debt was forged — Vex wrote it.' } },
  ],
  vex6: [
    { speaker: { id: 'Vex Kroll', en: 'Vex Kroll' }, portrait: 350, text: { id: 'Emas itu milikku, Rook. Adikmu hanya pion. Sekarang pilih: serahkan aku ke polisi, atau ambil emasnya dan pergi.', en: 'That gold is mine, Rook. Your brother was only a pawn. Now choose: hand me to the police, or take the gold and walk away.' } },
  ],
};

const MISSIONS = [
  {
    id: 'm1', title: { id: 'Homecoming Ash', en: 'Homecoming Ash' }, reward: 400,
    stages: [
      { id: 'walk-bar', kind: 'goto', x: 30, z: -180, r: 14, text: { id: 'Jalan kaki ke bar The Rusty Anchor', en: 'Walk to The Rusty Anchor bar' } },
      { id: 'talk-ilex', kind: 'dialog', lines: DIALOG.ilex1, text: { id: 'Bicara dengan Madame Ilex', en: 'Talk to Madame Ilex' } },
      { id: 'steal-car', kind: 'enterVehicle', text: { id: 'Curi mobil pertama', en: 'Steal your first car' } },
      { id: 'to-safehouse', kind: 'driveTo', x: -460, z: -380, r: 12, text: { id: 'Antar mobil ke safehouse', en: 'Deliver the car to the safehouse' } },
    ],
  },
  {
    id: 'm2', title: { id: 'Hot Cargo', en: 'Hot Cargo' }, reward: 600,
    stages: [
      { id: 'pickup', kind: 'goto', x: -520, z: -480, r: 9, text: { id: 'Ambil kargo di dok', en: 'Pick up the cargo at the docks' } },
      { id: 'talk-drayke', kind: 'dialog', lines: DIALOG.drayke2, text: { id: 'Dengar instruksi Drayke', en: 'Hear Drayke\'s instructions' } },
      { id: 'drop1', kind: 'deliver', x: 150, z: -300, r: 9, time: 150, text: { id: 'Antar kargo: titik 1 dari 3', en: 'Deliver the cargo: point 1 of 3' } },
      { id: 'drop2', kind: 'deliver', x: 420, z: 150, r: 9, time: 150, text: { id: 'Antar kargo: titik 2 dari 3', en: 'Deliver the cargo: point 2 of 3' } },
      { id: 'drop3', kind: 'deliver', x: -150, z: 450, r: 9, time: 150, text: { id: 'Antar kargo: titik 3 dari 3', en: 'Deliver the cargo: point 3 of 3' } },
      { id: 'escape', kind: 'driveTo', x: -460, z: -380, r: 12, text: { id: 'Kabur ke safehouse', en: 'Escape to the safehouse' } },
    ],
  },
  {
    id: 'm3', title: { id: 'The Foundry Cut', en: 'The Foundry Cut' }, reward: 900,
    stages: [
      { id: 'sneak', kind: 'goto', x: -400, z: 180, r: 16, text: { id: 'Susup ke chop-shop Foundry Kings', en: 'Sneak into the Foundry Kings chop-shop' } },
      { id: 'guards', kind: 'defeat', gang: 'foundry', count: 3, x: -400, z: 200, text: { id: 'Lumpuhkan 3 penjaga chop-shop', en: 'Take down the 3 chop-shop guards' } },
      { id: 'marked-car', kind: 'enterVehicleType', type: 'swift', x: -390, z: 200, text: { id: 'Curi mobil bertanda (Swift)', en: 'Steal the marked car (Swift)' } },
      { id: 'run', kind: 'driveTo', x: -460, z: -380, r: 12, text: { id: 'Kabur dari roadblock ke safehouse', en: 'Escape the roadblock to the safehouse' } },
    ],
  },
  {
    id: 'm4', title: { id: 'Neon Mile Run', en: 'Neon Mile Run' }, reward: 1200,
    stages: [
      { id: 'talk-drayke', kind: 'dialog', lines: DIALOG.drayke4, text: { id: 'Dengar instruksi Drayke', en: 'Hear Drayke\'s instructions' } },
      { id: 'race1', kind: 'race', x: -150, z: -150, r: 10, time: 150, text: { id: 'Balapan: checkpoint 1 dari 3', en: 'Race: checkpoint 1 of 3' } },
      { id: 'race2', kind: 'race', x: 150, z: -150, r: 10, time: 150, text: { id: 'Balapan: checkpoint 2 dari 3', en: 'Race: checkpoint 2 of 3' } },
      { id: 'race3', kind: 'race', x: 300, z: 150, r: 10, time: 150, text: { id: 'Balapan: checkpoint 3 dari 3', en: 'Race: checkpoint 3 of 3' } },
      { id: 'ambush', kind: 'defeat', gang: 'foundry', count: 4, x: 300, z: 150, text: { id: 'Hadapi penyergapan geng', en: 'Fight off the gang ambush' } },
      { id: 'to-palm', kind: 'driveTo', x: 420, z: -420, r: 12, text: { id: 'Kabur ke Palm Heights', en: 'Escape to Palm Heights' } },
    ],
  },
  {
    id: 'm5', title: { id: 'Harbor of Lies', en: 'Harbor of Lies' }, reward: 1500,
    stages: [
      { id: 'wave1', kind: 'defend', gang: 'foundry', count: 2, wave: 1, x: -460, z: -380, r: 30, text: { id: 'Pertahankan safehouse: gelombang 1 dari 3', en: 'Defend the safehouse: wave 1 of 3' } },
      { id: 'wave2', kind: 'defend', gang: 'foundry', count: 3, wave: 2, x: -460, z: -380, r: 30, text: { id: 'Pertahankan safehouse: gelombang 2 dari 3', en: 'Defend the safehouse: wave 2 of 3' } },
      { id: 'wave3', kind: 'defend', gang: 'foundry', count: 4, wave: 3, x: -460, z: -380, r: 30, text: { id: 'Pertahankan safehouse: gelombang 3 dari 3', en: 'Defend the safehouse: wave 3 of 3' } },
      { id: 'chase', kind: 'chase', gang: 'foundry', x: -300, z: -300, r: 7, text: { id: 'Kejar pengkhianat itu', en: 'Chase down the traitor' } },
      { id: 'choice', kind: 'choice', lines: DIALOG.pell5, choices: [
        { label: { id: 'Tangkap dia — serahkan ke Pell', en: 'Capture him — hand him to Pell' }, value: 'capture', default: true },
        { label: { id: 'Lepaskan dia — biarkan lari', en: 'Let him go' }, value: 'release' },
      ], text: { id: 'Putuskan nasib pengkhianat', en: 'Decide the traitor\'s fate' } },
    ],
  },
  {
    id: 'm6', title: { id: 'Ashes & Gold', en: 'Ashes & Gold' }, reward: 2500,
    stages: [
      { id: 'intercept', kind: 'damageVehicle', type: 'armored', x: -100, z: -100, below: 0.4, text: { id: 'Cegat truk lapis baja Vex — hancurkan sampai berhenti', en: 'Intercept Vex\'s armored truck — wreck it until it stops' } },
      { id: 'to-lighthouse', kind: 'driveTo', x: 480, z: 520, r: 16, text: { id: 'Kejar ke mercusuar Ember Sands', en: 'Chase it to the Ember Sands lighthouse' } },
      { id: 'showdown', kind: 'defeat', gang: 'foundry', count: 5, x: 480, z: 520, boss: true, text: { id: 'Hadapi Vex dan pengawalnya', en: 'Face Vex and his guards' } },
      { id: 'final', kind: 'choice', lines: DIALOG.vex6, choices: [
        { label: { id: 'Serahkan Vex ke Pell (Abu)', en: 'Hand Vex to Pell (Ashes)' }, value: 'ashes', default: true },
        { label: { id: 'Ambil emasnya dan pergi (Emas)', en: 'Take the gold and walk away (Gold)' }, value: 'gold' },
      ], text: { id: 'Pilihan akhir: Abu atau Emas', en: 'Final choice: Ashes or Gold' } },
    ],
  },
];

export function createMissions(deps) {
  const { player, vehicles, city, economy, bus, dialogs, wanted, weather, pedestrians } = deps;
  const lang = () => (deps.getLang ? deps.getLang() : 'id');
  const notify = (msg) => { if (deps.notify) deps.notify(msg); };

  const state = {
    activeIndex: -1, // index into MISSIONS, -1 = none
    stageIdx: 0,
    stageState: {},
    completed: [],
    choices: {},
    storyComplete: false,
    ending: null,
    nextDelay: 0,
    failed: 0,
    elapsed: 0, // seconds spent on the active mission (result screen)
  };

  let spawned = []; // entities this stage owns (peds, vehicles)

  function cleanupSpawned() {
    for (const s of spawned) {
      if (s.kind === 'ped' && s.obj.alive) {
        // Despawn quietly: remove the mesh, drop the ped.
        s.obj.alive = false;
        s.obj.mesh.visible = false;
      }
      if (s.kind === 'vehicle' && !s.obj.wrecked) {
        vehicles.removeVehicle(s.obj);
      }
    }
    spawned = [];
  }

  function currentMission() {
    return state.activeIndex >= 0 ? MISSIONS[state.activeIndex] : null;
  }
  function currentStage() {
    const m = currentMission();
    return m ? m.stages[state.stageIdx] : null;
  }

  function startMission(i) {
    if (i < 0 || i >= MISSIONS.length) return false;
    state.activeIndex = i;
    state.stageIdx = 0;
    state.stageState = {};
    state.elapsed = 0;
    cleanupSpawned();
    const m = MISSIONS[i];
    bus.emit('mission-start', { mission: m.id, title: m.title });
    if (i === 3) {
      // M4 is a night race: the clock jumps to 21:00, honestly.
      weather.setTime(21);
      notify('Misi 4 dimulai malam hari — jam melompat ke 21:00.');
    }
    enterStage();
    return true;
  }

  function enterStage() {
    const st = currentStage();
    if (!st) return;
    state.stageState = { timeLeft: st.time || 0, kills: 0, target: null, dialogShown: false, raceNext: null };
    const S = state.stageState;
    if (st.kind === 'defeat' || st.kind === 'defend') {
      const list = pedestrians.spawnGang(st.gang, st.x, st.z, st.count, { hostile: true });
      for (const p of list) spawned.push({ kind: 'ped', obj: p });
      S.need = st.count;
      S.alive = list;
    }
    if (st.kind === 'chase') {
      const list = pedestrians.spawnGang(st.gang, st.x, st.z, 1, { hostile: false });
      S.target = list[0];
      spawned.push({ kind: 'ped', obj: S.target });
      // The traitor runs a route away from the player.
      S.target.route = city.route(S.target.x, S.target.z, 300, 300);
      S.target.routeIdx = 0;
      S.target.state = 'walk';
    }
    if (st.kind === 'damageVehicle') {
      // Spawn on the road, not on the stage point: the M6 point
      // (-100,-100) sits inside a 30 m block in Neon Mile, so the truck
      // was born trapped in the building — speed ~0, route stuck, and
      // every shot died on the wall between muzzle and truck. The
      // waypoint follows the live truck (waypoint() below), so the
      // player still finds it; the truck then drives its route.
      const spot = city.nearestRoadPoint(st.x, st.z) || { x: st.x, z: st.z };
      const v = vehicles.makeVehicle(st.type, spot.x, spot.z, 0.8, { traffic: false });
      v.cruise = v.def.topSpeed * 0.5;
      v.route = city.route(v.x, v.z, 480, 520);
      v.routeIdx = 0;
      // Aim down the route from the start: a fixed spawn heading
      // forces a ~120-degree turn in the first metres, and the turning
      // arc carries the truck into the block on the inside of the
      // corner, where it wedges forever (no turn authority at speed
      // ~0, no reverse in traffic). Remember the mission destination
      // so a wedge anywhere on the route re-routes back to it instead
      // of to a random point (traffic.js).
      if (v.route && v.route.length > 0) {
        v.heading = Math.atan2(v.route[0].x - v.x, v.route[0].z - v.z);
      }
      v.missionDest = { x: 480, z: 520 };
      v.traffic = true; // drive it along the route like traffic
      spawned.push({ kind: 'vehicle', obj: v });
      S.target = v;
    }
    if (st.kind === 'enterVehicleType') {
      const v = vehicles.makeVehicle(st.type, st.x, st.z, 0.4, { parked: true });
      // The marked car is mission-critical: the police converging on
      // the player ram it (55 integrity = two hits) and the stage can
      // never complete. It is invulnerable until the player gets in.
      v.missionProtected = true;
      spawned.push({ kind: 'vehicle', obj: v });
      S.target = v;
    }
    if (st.kind === 'race') {
      S.raceNext = { x: st.x, z: st.z, r: st.r };
    }
    if (st.kind === 'dialog' || st.kind === 'choice') {
      if (!S.dialogShown) {
        S.dialogShown = true;
        dialogs.show({
          lines: st.lines,
          choices: st.choices || null,
          onChoice: (value) => {
            state.choices[st.id] = value;
            advanceStage();
          },
          onDone: () => {
            if (st.kind === 'dialog') advanceStage();
          },
        });
      }
    }
    // Each drop stage has its own 150 s timer (M2): generous, but the
    // clock is real and failing it restarts the mission.
    if (st.id === 'pickup') {
      // First wanted star of the story: the pickup is watched.
      wanted.setStars(Math.max(wanted.stars, 1));
    }
    if (st.id === 'run') {
      wanted.setStars(3);
    }
  }

  function advanceStage() {
    const m = currentMission();
    if (!m) return;
    state.stageIdx += 1;
    if (state.stageIdx >= m.stages.length) {
      completeMission();
    } else {
      enterStage();
    }
  }

  function completeMission() {
    const m = currentMission();
    economy.earn(m.reward, `Misi selesai: ${m.title.en}`);
    state.completed.push(m.id);
    bus.emit('mission-complete', { mission: m.id, reward: m.reward, time: Math.round(state.elapsed) });
    if (m.id === 'm3') economy.grantFreeRespray();
    if (m.id === 'm4') {
      player.giveWeapon('kr9', 60);
      notify('KR-9 Ripper didapat!');
    }
    if (m.id === 'm5') player.state.armor = 100;
    if (m.id === 'm6') {
      state.storyComplete = true;
      state.ending = state.choices.final || 'ashes';
      bus.emit('story-complete', { ending: state.ending });
    }
    cleanupSpawned();
    state.activeIndex = -1;
    state.stageIdx = 0;
    state.nextDelay = 3;
  }

  function failMission(reason) {
    const m = currentMission();
    if (!m) return;
    state.failed += 1;
    bus.emit('mission-failed', { mission: m.id, reason });
    cleanupSpawned();
    // Restart from the last checkpoint stage (a stage marked `checkpoint`,
    // else the mission start). None are marked yet, so missions restart
    // from stage 0 — honest, and stated in the fail notice.
    state.stageIdx = 0;
    state.stageState = {};
    enterStage();
  }

  // Kills of mission targets advance defeat/defend stages.
  bus.on('ped-down', ({ ped }) => {
    const st = currentStage();
    if (!st || (st.kind !== 'defeat' && st.kind !== 'defend')) return;
    if (spawned.some((s) => s.kind === 'ped' && s.obj === ped)) {
      state.stageState.kills = (state.stageState.kills || 0) + 1;
      if (state.stageState.kills >= st.count) advanceStage();
    }
  });

  function update(dt, ctx) {
    // Auto-start the next mission a few seconds after the last one.
    if (state.activeIndex < 0 && !state.storyComplete) {
      const next = state.completed.length;
      if (next < MISSIONS.length) {
        state.nextDelay -= dt;
        if (state.nextDelay <= 0) startMission(next);
      }
      return;
    }
    const m = currentMission();
    const st = currentStage();
    if (!m || !st) return;
    state.elapsed += dt; // mission clock: the result screen shows real time
    const S = state.stageState;
    const ps = player.state;
    const p = player.position();

    // Shared delivery timer (M2): runs across drop1..drop3.
    if (st.kind === 'deliver') {
      S.timeLeft -= dt;
      if (S.timeLeft <= 0) { failMission('time'); return; }
    }
    if (st.kind === 'race') {
      S.timeLeft -= dt;
      if (S.timeLeft <= 0) { failMission('time'); return; }
    }

    const distTo = (x, z) => Math.hypot(p.x - x, p.z - z);
    switch (st.kind) {
      case 'goto':
        if (distTo(st.x, st.z) < st.r) advanceStage();
        break;
      case 'driveTo':
        if (ps.inVehicle && distTo(st.x, st.z) < st.r) advanceStage();
        else if (!ps.inVehicle && distTo(st.x, st.z) < st.r * 0.5) advanceStage();
        break;
      case 'deliver':
        if (distTo(st.x, st.z) < st.r) advanceStage();
        break;
      case 'race':
        if (distTo(st.x, st.z) < st.r) advanceStage();
        break;
      case 'enterVehicle':
        if (ps.inVehicle) advanceStage();
        break;
      case 'enterVehicleType': {
        const v = S.target;
        if (v && ps.inVehicle && ps.vehicle === v) {
          v.missionProtected = false; // the player's car now, normal rules
          advanceStage();
        }
        break;
      }
      case 'chase': {
        const t = S.target;
        if (t && t.alive && distTo(t.x, t.z) < st.r) advanceStage();
        else if (t && !t.alive) failMission('target-dead');
        break;
      }
      case 'damageVehicle': {
        const v = S.target;
        if (!v) { failMission('target-gone'); break; }
        if (v.wrecked) { failMission('truck-destroyed'); break; }
        if (v.integrity / v.maxIntegrity < st.below) {
          v.traffic = false;
          v.speed = 0;
          advanceStage();
        }
        break;
      }
      case 'defeat':
      case 'defend':
        // Completion is driven by the ped-down handler above.
        break;
      case 'dialog':
      case 'choice':
        // Completion is driven by the dialog callbacks.
        break;
      default:
        break;
    }
    void ctx;
  }

  function waypoint() {
    const st = currentStage();
    if (!st) return null;
    // Moving targets first: the marker follows the live target, not
    // the stage's spawn point. The truck spawns on the nearest road
    // (tens of metres from the stage point) and then drives away; a
    // static marker would send the player to an empty building.
    if ((st.kind === 'chase' || st.kind === 'damageVehicle') && state.stageState.target) {
      return { x: state.stageState.target.x, z: state.stageState.target.z };
    }
    if (st.x !== undefined && st.z !== undefined) return { x: st.x, z: st.z };
    return null;
  }

  function objectiveText() {
    const m = currentMission();
    const st = currentStage();
    if (!m || !st) return null;
    let text = pickText(st.text, lang());
    if (st.kind === 'deliver' || st.kind === 'race') {
      text += ` — ${Math.max(0, Math.ceil(state.stageState.timeLeft))}s`;
    }
    if (st.kind === 'defeat' || st.kind === 'defend') {
      const left = st.count - (state.stageState.kills || 0);
      text += ` (${Math.max(0, left)} tersisa)`;
    }
    return { mission: pickText(m.title, lang()), text };
  }

  return {
    state,
    missions: MISSIONS,
    update,
    startMission,
    currentMission,
    currentStage,
    waypoint,
    objectiveText,
    failMission,
    get active() { return currentMission(); },
    get progress() {
      return { completed: state.completed.length, total: MISSIONS.length, storyComplete: state.storyComplete, ending: state.ending };
    },
  };
}
