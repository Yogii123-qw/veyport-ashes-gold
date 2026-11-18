// Procedural contracts: four job types, generated from the city, with
// rewards that follow distance and risk. The generator lives in
// contracts.js; the shapes, label pools and reward math live here.

export const CONTRACT_TYPES = [
  {
    id: 'delivery', name: { en: 'Delivery', id: 'Pengiriman' },
    desc: { en: 'Pick up the package and deliver it before the clock runs out.', id: 'Ambil paket dan antar sebelum waktu habis.' },
    base: 150, perMetre: 0.22, timePerMetre: 0.55, risk: 1.0,
  },
  {
    id: 'getaway', name: { en: 'Getaway', id: 'Pelarian' },
    desc: { en: 'Pick up the client, then lose the police and reach the drop.', id: 'Jemput klien, lalu lepas dari polisi dan capai titik akhir.' },
    base: 220, perMetre: 0.28, timePerMetre: 0.0, risk: 1.35, startHeat: 30,
  },
  {
    id: 'repo', name: { en: 'Repo', id: 'Penarikan' },
    desc: { en: 'Steal the named vehicle and bring it to the yard in one piece.', id: 'Curi kendaraan yang disebut dan bawa ke yard dalam keadaan utuh.' },
    base: 200, perMetre: 0.18, timePerMetre: 0.0, risk: 1.15,
  },
  {
    id: 'vigilante', name: { en: 'Vigilante', id: 'Vigilante' },
    desc: { en: 'Stop the marked criminals. No wanted level for this one.', id: 'Hentikan penjahat yang ditandai. Tanpa wanted level.' },
    base: 180, perMetre: 0.12, timePerMetre: 0.0, risk: 1.25,
  },
];

export const CONTRACT_CLIENTS = [
  { en: 'A nervous dock clerk', id: 'Juru tulis dermaga yang gugup' },
  { en: 'A bazaar spice trader', id: 'Pedagang rempah bazaar' },
  { en: 'A retired ferry captain', id: 'Mantan kapten feri' },
  { en: 'A neon sign repairer', id: 'Tukang reparasi neon' },
  { en: 'A marina bookkeeper', id: 'Pembukuan marina' },
  { en: 'A foundry shift boss', id: 'Mandor shift foundry' },
];

export const REPUTATION = {
  start: 50, min: 0, max: 100, successGain: 4, failLoss: 8,
  rewardFloor: 0.7, rewardCeil: 1.3,
};

export function reputationMultiplier(reputation) {
  const t = (reputation - REPUTATION.min) / (REPUTATION.max - REPUTATION.min);
  return REPUTATION.rewardFloor + t * (REPUTATION.rewardCeil - REPUTATION.rewardFloor);
}

export const ACTIVITY_REWARDS = {
  cache: 100, cacheBonus: 1000,
  stuntBase: 50, stuntPerMetre: 6, stuntPerSecond: 40, stuntCap: 300,
  trialFirst: 300, trialBeat: 150,
};
