// Weapons as data: damage, range, fire rate, magazine, reload time, prices.
// combat.js reads these numbers; the feel (recoil, spread, sound recipe)
// is tuned here too. Headshots deal double damage; armor absorbs a share.

export const WEAPONS = [
  {
    id: 'fists', slot: 1, name: { en: 'Fists', id: 'Tinju' }, kind: 'melee',
    damage: 15, range: 2.2, fireInterval: 0.45, magSize: 0, reloadTime: 0,
    price: 0, ammoPrice: 0, ammoPack: 0, spread: 0, pellets: 1, auto: false,
    recoil: 0, bulletSpeed: 0, sound: 'punch', flash: 0, casing: 0, desc: { en: 'Close quarters. Always with you.', id: 'Jarak dekat. Selalu bersamamu.' },
  },
  {
    id: 'p9', slot: 2, name: { en: 'P9 Sidearm', id: 'P9 Sidearm' }, kind: 'pistol',
    damage: 25, range: 40, fireInterval: 0.28, magSize: 12, reloadTime: 1.4,
    price: 150, ammoPrice: 20, ammoPack: 24, spread: 0.012, pellets: 1, auto: false,
    recoil: 0.012, bulletSpeed: 120, sound: 'pistol', flash: 0.8, casing: 1.0, desc: { en: 'Reliable harbor-issue pistol.', id: 'Pistol andal standar pelabuhan.' },
  },
  {
    id: 'kr9', slot: 3, name: { en: 'KR-9 Ripper', id: 'KR-9 Ripper' }, kind: 'smg',
    damage: 16, range: 30, fireInterval: 0.09, magSize: 32, reloadTime: 1.8,
    price: 600, ammoPrice: 40, ammoPack: 60, spread: 0.035, pellets: 1, auto: true,
    recoil: 0.008, bulletSpeed: 110, sound: 'smg', flash: 0.7, casing: 0.9, desc: { en: 'Fast, hungry, close-range shredder.', id: 'Cepat, rakus, perobek jarak dekat.' },
  },
  {
    id: 'iron12', slot: 4, name: { en: 'Iron-12', id: 'Iron-12' }, kind: 'scattergun',
    damage: 8, range: 15, fireInterval: 0.85, magSize: 6, reloadTime: 2.4,
    price: 450, ammoPrice: 30, ammoPack: 12, spread: 0.09, pellets: 6, auto: false,
    recoil: 0.05, bulletSpeed: 90, sound: 'scatter', flash: 1.4, casing: 1.2, desc: { en: 'Six pellets. Ends arguments.', id: 'Enam peluru. Mengakhiri perdebatan.' },
  },
  {
    id: 'vk7', slot: 5, name: { en: 'VK-7 Carbine', id: 'VK-7 Carbine' }, kind: 'rifle',
    damage: 40, range: 80, fireInterval: 0.13, magSize: 30, reloadTime: 2.1,
    price: 1200, ammoPrice: 60, ammoPack: 40, spread: 0.016, pellets: 1, auto: true,
    recoil: 0.014, bulletSpeed: 180, sound: 'rifle', flash: 1.0, casing: 1.1, desc: { en: 'Long reach, heavy answer.', id: 'Jangkauan jauh, jawaban berat.' },
  },
];

export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id) || WEAPONS[0];
}

export function weaponName(def, lang) {
  return def.name[lang] || def.name.en;
}

export const ARMOR = {
  none: { absorb: 0, price: 0 },
  standard: { absorb: 0.6, price: 120, name: { en: 'Standard Vest', id: 'Rompi Standar' } },
  heavy: { absorb: 0.75, price: 250, name: { en: 'Heavy Vest', id: 'Rompi Berat' } },
};

export const ITEMS = {
  medkit: { price: 100, heal: 50, name: { en: 'Medkit', id: 'Medkit' } },
  food: { price: 25, heal: 30, name: { en: 'Street food', id: 'Makanan kaki lima' } },
};
