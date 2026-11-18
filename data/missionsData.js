// The story as data: six missions, each a chain of stages the mission
// manager walks. Dialog lines are bilingual; objectives are bilingual;
// rewards, timers and spawn tables live here, not in the mission code.
// Stage types: goto, talk, dialog, enterVehicle, deliver, eliminate,
// defend, chase, race, choice, escape. A stage with checkpoint:true is a
// retry point when the mission fails.

export const CHARACTERS = {
  rook: { name: { en: 'Rook Calloway', id: 'Rook Calloway' }, coat: '#7a2f22', skin: '#d9a77c', hair: '#2a2018' },
  ilex: { name: { en: 'Madame Ilex', id: 'Madame Ilex' }, coat: '#2f4a5a', skin: '#c98d5e', hair: '#d8d3c8' },
  drayke: { name: { en: 'Marlow Drayke', id: 'Marlow Drayke' }, coat: '#3a4a2f', skin: '#8a5a3c', hair: '#1c1c1c' },
  vex: { name: { en: 'Vex Kroll', id: 'Vex Kroll' }, coat: '#4a2a4a', skin: '#d9b08c', hair: '#b8452f' },
  pell: { name: { en: 'Sgt. Ada Pell', id: 'Sersan Ada Pell' }, coat: '#22303f', skin: '#e0b58e', hair: '#6a4a2a' },
  cole: { name: { en: 'Cole Calloway', id: 'Cole Calloway' }, coat: '#5a5a5a', skin: '#d9a77c', hair: '#2a2018' },
};

function L(who, en, id) {
  return { who, en, id };
}

export const MISSIONS = [
  {
    id: 'm1', title: { en: 'Homecoming Ash', id: 'Abu Kepulangan' }, giver: 'ilex', startPoi: 'bar',
    reward: 400, unlocks: { safehouse: true },
    brief: { en: 'Ilex is waiting at The Rusty Anchor. Go and hear what Cole left behind.', id: 'Ilex menunggu di The Rusty Anchor. Dengar apa yang ditinggalkan Cole.' },
    stages: [
      { id: 'm1-go', type: 'goto', x: 60, z: -60, radius: 17, objective: { en: 'Go to The Rusty Anchor', id: 'Pergi ke The Rusty Anchor' } },
      {
        id: 'm1-talk', type: 'talk', poi: 'bar', objective: { en: 'Talk to Madame Ilex', id: 'Bicara dengan Madame Ilex' },
        lines: [
          L('ilex', 'Rook Calloway. The harbor heard you were dead.', 'Rook Calloway. Pelabuhan dengar kau sudah mati.'),
          L('rook', 'Not dead. Just gone. Cole\u2019s note said the debt dies with him. It doesn\u2019t, does it?', 'Belum mati. Cuma pergi. Surat Cole bilang utang mati bersamanya. Ternyata tidak, ya?'),
          L('ilex', 'Eight thousand, to the Harbormen. Drayke holds the paper. He is patient, but his patience has a clock.', 'Delapan ribu, ke Harbormen. Drayke pegang suratnya. Dia sabar, tapi kesabarannya ada batasnya.'),
          L('ilex', 'A Pico sits behind my bar. Keys in the sun visor, like always. Bring it to your brother\u2019s warehouse and we will call it a start.', 'Ada Pico di belakang barku. Kunci di pelindung matahari, seperti biasa. Bawa ke gudang adikmu, kita anggap itu awal.'),
          L('rook', 'And after that?', 'Lalu setelah itu?'),
          L('ilex', 'After that, Rook, you work. Veyport always collects.', 'Setelah itu, Rook, kau bekerja. Veyport selalu menagih.'),
        ],
      },
      {
        id: 'm1-car', type: 'enterVehicle', spawnType: 'pico', spawnAt: { x: 78, z: -44, heading: 0 }, targetName: { en: 'Ilex\u2019s Pico', id: 'Pico milik Ilex' },
        objective: { en: 'Take the Pico behind the bar', id: 'Ambil Pico di belakang bar' },
      },
      {
        id: 'm1-home', type: 'goto', x: -420, z: 60, radius: 20, inVehicle: true, checkpoint: true,
        objective: { en: 'Drive the Pico to the safehouse', id: 'Bawa Pico ke safehouse' },
      },
      {
        id: 'm1-end', type: 'dialog', objective: { en: 'Settle in', id: 'Bereskan dirimu' },
        lines: [
          L('rook', 'Cole\u2019s warehouse. Still smells of diesel and bad decisions.', 'Gudang Cole. Masih bau solar dan keputusan buruk.'),
          L('rook', 'Eight thousand. All right, little brother. I\u2019ll carry it.', 'Delapan ribu. Baiklah, adik kecil. Aku yang pikul.'),
        ],
      },
    ],
  },
  {
    id: 'm2', title: { en: 'Hot Cargo', id: 'Kargo Panas' }, giver: 'ilex', startPoi: 'bar',
    reward: 600, unlocks: { contactDrayke: true },
    brief: { en: 'Ilex has cargo that must move before the harbor wakes. Three drops, one clock.', id: 'Ilex punya kargo yang harus pindah sebelum pelabuhan bangun. Tiga titik, satu jam.' },
    stages: [
      {
        id: 'm2-talk', type: 'talk', poi: 'bar', objective: { en: 'Talk to Madame Ilex', id: 'Bicara dengan Madame Ilex' },
        lines: [
          L('ilex', 'Crates at Pier 4. No questions, no peeking. Three drops, and the clock is already running.', 'Peti di Dermaga 4. Tanpa pertanyaan, tanpa mengintip. Tiga titik, dan waktunya sudah berjalan.'),
          L('rook', 'What\u2019s in the crates?', 'Isi petinya apa?'),
          L('ilex', 'The less you know, the longer you drive. Drayke is watching this one. Don\u2019t make him wait.', 'Makin sedikit kau tahu, makin lama kau menyetir. Drayke mengawasi pekerjaan ini. Jangan buat dia menunggu.'),
        ],
      },
      {
        id: 'm2-pickup', type: 'goto', x: -480, z: 120, radius: 10, pickup: 'cargo',
        objective: { en: 'Collect the cargo at Pier 4', id: 'Ambil kargo di Dermaga 4' },
      },
      {
        id: 'm2-drops', type: 'deliver', timeLimit: 260, checkpoint: true, heatAtDrop: 2, heatAmount: 12,
        points: [
          { x: -150, z: -150, label: { en: 'Drop 1: Foundry gate', id: 'Titik 1: Gerbang Foundry' } },
          { x: 150, z: 0, label: { en: 'Drop 2: Neon backlot', id: 'Titik 2: Belakang Neon' } },
          { x: 300, z: 300, label: { en: 'Drop 3: Bazaar cellar', id: 'Titik 3: Gudang Bazaar' } },
        ],
        objective: { en: 'Deliver to all three drops', id: 'Antar ke tiga titik' },
      },
      {
        id: 'm2-end', type: 'dialog', objective: { en: 'Job done', id: 'Pekerjaan selesai' },
        lines: [
          L('ilex', 'Clean drops. Drayke noticed. That matters more than the money, Rook.', 'Pengiriman bersih. Drayke memperhatikan. Itu lebih penting dari uang, Rook.'),
        ],
      },
    ],
  },
  {
    id: 'm3', title: { en: 'The Foundry Cut', id: 'Potongan Foundry' }, giver: 'ilex', startPoi: 'bar',
    reward: 900, unlocks: { freeRespray: 1 },
    brief: { en: 'The Foundry Kings hijacked a Harbormen shipment. Take back the marked Bulldog from their chop-shop.', id: 'Foundry Kings membajak kiriman Harbormen. Rebut kembali Bulldog bertanda dari chop-shop mereka.' },
    stages: [
      {
        id: 'm3-talk', type: 'talk', poi: 'bar', objective: { en: 'Talk to Madame Ilex', id: 'Bicara dengan Madame Ilex' },
        lines: [
          L('ilex', 'Vex Kroll\u2019s people took a Harbormen shipment last night. The Bulldog they drove is parked inside the chop-shop, still wearing Harbormen plates.', 'Anak buah Vex Kroll merampas kiriman Harbormen semalam. Bulldog yang mereka pakai terparkir di dalam chop-shop, masih berpelat Harbormen.'),
          L('rook', 'You want me to walk into the Kings\u2019 furnace and drive it out.', 'Kau mau aku masuk ke tungku Kings dan mengendarainya keluar.'),
          L('ilex', 'I want you to be quiet about it. Four guards, maybe. The car is the message. Bring it home.', 'Aku mau kau diam-diam saja. Empat penjaga, mungkin. Mobil itu pesannya. Bawa pulang.'),
        ],
      },
      {
        id: 'm3-approach', type: 'goto', x: -210, z: -270, radius: 16, onFoot: true,
        objective: { en: 'Reach the chop-shop on foot', id: 'Capai chop-shop dengan berjalan kaki' },
      },
      {
        id: 'm3-fight', type: 'eliminate', checkpoint: true,
        spawn: [
          { faction: 'foundry', x: -210, z: -280, count: 2 },
          { faction: 'foundry', x: -150, z: -330, count: 2 },
        ],
        objective: { en: 'Clear the chop-shop guards', id: 'Habisi penjaga chop-shop' },
      },
      {
        id: 'm3-car', type: 'enterVehicle', spawnType: 'bulldog', spawnAt: { x: -175, z: -272, heading: Math.PI / 2 }, targetName: { en: 'Marked Bulldog', id: 'Bulldog Bertanda' }, marked: true,
        objective: { en: 'Take the marked Bulldog', id: 'Ambil Bulldog bertanda' },
      },
      {
        id: 'm3-escape', type: 'escape', x: -420, z: 60, radius: 14, roadblock: true, requireVehicleIntact: 20,
        objective: { en: 'Lose the heat and reach the safehouse', id: 'Lepas dari kejaran dan capai safehouse' },
      },
    ],
  },
  {
    id: 'm4', title: { en: 'Neon Mile Run', id: 'Balapan Neon Mile' }, giver: 'drayke', startPoi: 'harborHq',
    reward: 1200, unlocks: { weapon: 'kr9' }, nightLock: 21,
    brief: { en: 'Drayke wants a night race through Neon Mile. Win it, and the Harbormen owe you one.', id: 'Drayke ingin balapan malam melewati Neon Mile. Menang, dan Harbormen berutang budi padamu.' },
    stages: [
      {
        id: 'm4-talk', type: 'talk', poi: 'harborHq', objective: { en: 'Talk to Marlow Drayke', id: 'Bicara dengan Marlow Drayke' },
        lines: [
          L('drayke', 'Cole talked about you the way sailors talk about weather. You drive like a storm, he said.', 'Cole bicara tentangmu seperti pelaut bicara cuaca. Kau menyetir seperti badai, katanya.'),
          L('rook', 'Cole talked too much.', 'Cole terlalu banyak bicara.'),
          L('drayke', 'Tonight the Mile belongs to the fast. Three gates. The Kings will try to own the road. Show them whose harbor this is.', 'Malam ini Mile milik yang cepat. Tiga gerbang. Kings akan mencoba menguasai jalan. Tunjukkan pelabuhan ini milik siapa.'),
          L('drayke', 'Win, and your brother\u2019s paper burns a little lighter. Lose, and we never had this talk.', 'Menang, dan surat utang adikmu terbakar sedikit lebih ringan. Kalah, dan kita tak pernah bicara.'),
        ],
      },
      {
        id: 'm4-race', type: 'race', timeLimit: 170, checkpoint: true, inVehicle: true,
        checkpoints: [
          { x: 0, z: -150, label: { en: 'Gate 1', id: 'Gerbang 1' } },
          { x: 150, z: 0, label: { en: 'Gate 2', id: 'Gerbang 2' } },
          { x: 0, z: 150, label: { en: 'Gate 3', id: 'Gerbang 3' } },
        ],
        objective: { en: 'Hit all three gates before time runs out', id: 'Lewati tiga gerbang sebelum waktu habis' },
      },
      {
        id: 'm4-ambush', type: 'eliminate',
        spawn: [
          { faction: 'foundry', x: -60, z: 180, count: 3 },
          { faction: 'foundry', x: 60, z: 180, count: 2 },
        ],
        objective: { en: 'Survive the Kings\u2019 ambush', id: 'Selamat dari penyergapan Kings' },
      },
      {
        id: 'm4-escape', type: 'goto', x: 420, z: -380, radius: 16,
        objective: { en: 'Reach Villa Marisol in Palm Heights', id: 'Capai Vila Marisol di Palm Heights' },
      },
      {
        id: 'm4-end', type: 'dialog', objective: { en: 'Catch your breath', id: 'Tarik napas' },
        lines: [
          L('drayke', 'The Mile saw it. The Kings saw it. Take this KR-9. Nights in Veyport are getting louder.', 'Mile melihatnya. Kings melihatnya. Ambil KR-9 ini. Malam di Veyport makin berisik.'),
        ],
      },
    ],
  },
  {
    id: 'm5', title: { en: 'Harbor of Lies', id: 'Pelabuhan Kebohongan' }, giver: 'drayke', startPoi: 'harborHq',
    reward: 1500, unlocks: { heavyArmor: true },
    brief: { en: 'The truth about Cole\u2019s debt is coming for the safehouse. Hold the warehouse, then run down the traitor.', id: 'Kebenaran soal utang Cole mendatangi safehouse. Pertahankan gudang, lalu kejar pengkhianatnya.' },
    stages: [
      {
        id: 'm5-talk', type: 'talk', poi: 'harborHq', objective: { en: 'Talk to Marlow Drayke', id: 'Bicara dengan Marlow Drayke' },
        lines: [
          L('drayke', 'Vex forged Cole\u2019s debt. The paper I hold is a copy of a lie, and Cole died paying for ink.', 'Vex memalsukan utang Cole. Surat yang kupegang adalah salinan kebohongan, dan Cole mati membayar tinta.'),
          L('rook', 'Then the debt was never real.', 'Jadi utang itu tak pernah nyata.'),
          L('drayke', 'The debt was real enough to kill him. Vex knows I know. His people are coming for your warehouse tonight. Hold it, Rook.', 'Utang itu cukup nyata untuk membunuhnya. Vex tahu aku tahu. Anak buahnya mendatangi gudangmu malam ini. Pertahankan, Rook.'),
        ],
      },
      {
        id: 'm5-defend', type: 'defend', center: { x: -420, z: 60 }, checkpoint: true,
        waves: [
          { count: 3, spawnAt: [[-460, 20], [-380, 100], [-440, 110]] },
          { count: 4, spawnAt: [[-470, 60], [-370, 40], [-420, 120], [-390, 10]] },
          { count: 5, spawnAt: [[-480, 90], [-360, 80], [-430, 130], [-380, 20], [-450, 0]] },
        ],
        objective: { en: 'Defend the safehouse: survive all three waves', id: 'Pertahankan safehouse: selamat dari tiga gelombang' },
      },
      {
        id: 'm5-chase', type: 'chase', targetName: { en: 'The traitor', id: 'Si pengkhianat' },
        spawnAt: { x: -380, z: 20 }, fleeTo: { x: -150, z: -150 },
        objective: { en: 'Run down the fleeing traitor', id: 'Kejar pengkhianat yang melarikan diri' },
      },
      {
        id: 'm5-choice', type: 'choice', objective: { en: 'Decide the traitor\u2019s fate', id: 'Tentukan nasib pengkhianat' },
        lines: [
          L('rook', 'You sold Cole for a cut of the harbor. Why?', 'Kau menjual Cole demi bagian pelabuhan. Kenapa?'),
          L('vex', 'Not me, driver. I only carried the paper. Vex wrote it. Vex always writes it.', 'Bukan aku, pengemudi. Aku cuma membawa suratnya. Vex yang menulis. Vex selalu yang menulis.'),
        ],
        choices: [
          { id: 'capture', label: { en: 'Hand him to Drayke', id: 'Serahkan dia ke Drayke' }, effect: { reputation: { harbormen: 10 } }, result: { en: 'Drayke will get the whole story out of him.', id: 'Drayke akan menggali seluruh cerita darinya.' } },
          { id: 'release', label: { en: 'Let him run', id: 'Biarkan dia kabur' }, effect: { reputation: { foundry: 5 } }, result: { en: 'He runs. The harbor forgets runners, sometimes.', id: 'Dia kabur. Pelabuhan kadang melupakan pelari.' } },
        ],
      },
    ],
  },
  {
    id: 'm6', title: { en: 'Ashes & Gold', id: 'Abu & Emas' }, giver: 'drayke', startPoi: 'harborHq',
    reward: 2500,
    brief: { en: 'Vex is moving his gold out through Ember Sands. Stop the truck, take the lighthouse, and close the book.', id: 'Vex memindahkan emasnya lewat Ember Sands. Hentikan truknya, kuasai mercusuar, dan tutup bukunya.' },
    stages: [
      {
        id: 'm6-talk', type: 'talk', poi: 'harborHq', objective: { en: 'Talk to Marlow Drayke', id: 'Bicara dengan Marlow Drayke' },
        lines: [
          L('drayke', 'One truck. Vex\u2019s gold, rolling for the Ember shore at dawn. Stop it, and the Kings fall with it.', 'Satu truk. Emas Vex, bergulir ke pantai Ember saat fajar. Hentikan, dan Kings jatuh bersamanya.'),
          L('rook', 'And Vex?', 'Dan Vex?'),
          L('drayke', 'Vex will be at the light, waiting for a boat that is never coming. What you do there is yours, Rook. Ashes or gold.', 'Vex akan berada di mercusuar, menunggu perahu yang tak pernah datang. Apa yang kau lakukan di sana terserah kau, Rook. Abu atau emas.'),
        ],
      },
      {
        id: 'm6-intercept', type: 'chase', targetName: { en: 'Gold Hauler', id: 'Truk Emas' }, targetVehicle: 'armored', checkpoint: true,
        spawnAt: { x: 540, z: 300 }, fleeTo: { x: -300, z: 540 }, disableAt: 40,
        objective: { en: 'Stop the armored truck before it reaches Ember Sands', id: 'Hentikan truk lapis baja sebelum mencapai Ember Sands' },
      },
      {
        id: 'm6-light', type: 'goto', x: -500, z: 540, radius: 18,
        objective: { en: 'Reach the Ember Light', id: 'Capai Mercusuar Ember' },
      },
      {
        id: 'm6-fight', type: 'eliminate', checkpoint: true,
        spawn: [
          { faction: 'foundry', x: -480, z: 520, count: 3 },
          { faction: 'foundry', x: -520, z: 540, count: 2 },
          { faction: 'vex', x: -488, z: 528, count: 1 },
        ],
        objective: { en: 'Take the lighthouse', id: 'Kuasai mercusuar' },
      },
      {
        id: 'm6-choice', type: 'choice', objective: { en: 'Ashes or gold?', id: 'Abu atau emas?' },
        lines: [
          L('vex', 'The gold is real, Rook. Cole\u2019s debt was paper. This is weight. Take it and the harbor is yours.', 'Emasnya nyata, Rook. Utang Cole cuma kertas. Ini berat. Ambil, dan pelabuhan ini milikmu.'),
          L('pell', 'Rook! CPD! Stand down and he goes in cuffs. Cole deserves a clean ending, not a richer grave.', 'Rook! CPD! Menyerahlah dan dia diborgol. Cole pantas mendapat akhir yang bersih, bukan kuburan yang lebih kaya.'),
          L('rook', 'Cole\u2026 what would you have done?', 'Cole\u2026 apa yang akan kau lakukan?'),
        ],
        choices: [
          { id: 'ashes', label: { en: 'Hand Vex to Sergeant Pell', id: 'Serahkan Vex ke Sersan Pell' }, effect: { ending: 'ashes', reputation: { harbormen: 20 } }, result: { en: 'Pell takes Vex away. The debt burns with the paper. Ashes.', id: 'Pell membawa Vex pergi. Utang terbakar bersama kertasnya. Abu.' } },
          { id: 'gold', label: { en: 'Take the gold and walk away', id: 'Ambil emasnya dan pergi' }, effect: { ending: 'gold', money: 1500, reputation: { harbormen: -20 }, heat: 55 }, result: { en: 'The gold is heavy. The harbor watches you carry it. Gold.', id: 'Emas itu berat. Pelabuhan mengawasimu membawanya. Emas.' } },
        ],
      },
    ],
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}
