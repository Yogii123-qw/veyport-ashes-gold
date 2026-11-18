// Vehicle roster as data: 8 civilian classes, 2 police classes, one
// mission-only armored truck, and 5 supercars. topSpeed in m/s, accel
// in m/s^2, grip is the lateral-velocity decay rate (higher holds the
// road, lower slides), and durability is the integrity pool. Numbers
// here are the only tuning knobs; physics.js reads them, never invents
// its own. Tuning target (measured 19 Nov 2026 with the power-curve
// model): every class reaches >=90% of its top speed within a few
// seconds at full throttle and cruises at ~95% of it; supercars sit
// far above the rest (230-281 km/h) with matching brakes and lower
// durability. All marques and model names are invented for this game.

export const VEHICLES = {
  pico: {
    id: 'pico', name: { en: 'Pico', id: 'Pico' }, cls: 'hatch', topSpeed: 30, accel: 11.0, brake: 18, grip: 6.5, steer: 2.4,
    durability: 60, mass: 900, sell: 200, length: 3.6, width: 1.7, height: 1.45, seatHeight: 0.55,
    colors: [0xd8d3c8, 0x7a8a99, 0xc23a2a, 0x3f8a5f, 0xe8b23c, 0x2a6ab8], engine: 'small',
  },
  komodo: {
    id: 'komodo', name: { en: 'Komodo', id: 'Komodo' }, cls: 'sedan', topSpeed: 36, accel: 13.0, brake: 19, grip: 5.5, steer: 2.2,
    durability: 80, mass: 1300, sell: 300, length: 4.4, width: 1.8, height: 1.45, seatHeight: 0.55,
    colors: [0x2e3a46, 0xc8c2b4, 0xa83232, 0x33475c, 0x2a7a5a, 0xc2702a], engine: 'mid',
  },
  swift: {
    id: 'swift', name: { en: 'Swift', id: 'Swift' }, cls: 'coupe', topSpeed: 48, accel: 18.0, brake: 22, grip: 6.0, steer: 2.6,
    durability: 55, mass: 1100, sell: 500, length: 4.2, width: 1.8, height: 1.25, seatHeight: 0.5,
    colors: [0xc22e2e, 0xeeeeee, 0x2244aa, 0xe8b23c, 0x222222, 0x2a9a6a], engine: 'sport',
  },
  bulldog: {
    id: 'bulldog', name: { en: 'Bulldog', id: 'Bulldog' }, cls: 'muscle', topSpeed: 52, accel: 20.0, brake: 20, grip: 4.2, steer: 2.0,
    durability: 75, mass: 1500, sell: 650, length: 4.6, width: 1.9, height: 1.4, seatHeight: 0.55,
    colors: [0x1c1c1c, 0x8a2020, 0x2f6a3a, 0xd8d3c8, 0x3a3a8a, 0xc2702a], engine: 'v8',
  },
  vagabond: {
    id: 'vagabond', name: { en: 'Vagabond', id: 'Vagabond' }, cls: 'suv', topSpeed: 38, accel: 14.0, brake: 18, grip: 5.0, steer: 2.1,
    durability: 110, mass: 1900, sell: 450, length: 4.5, width: 1.9, height: 1.8, seatHeight: 0.7,
    colors: [0x4a6a3a, 0xc2702a, 0x2e3a46, 0x3a6a8a, 0x8a2a3a, 0xd8d3c8], engine: 'mid',
  },
  hauler: {
    id: 'hauler', name: { en: 'Hauler', id: 'Hauler' }, cls: 'van', topSpeed: 30, accel: 10.0, brake: 16, grip: 4.5, steer: 1.9,
    durability: 120, mass: 2200, sell: 350, length: 4.8, width: 1.9, height: 2.0, seatHeight: 0.7,
    colors: [0xd8d3c8, 0x7a8a99, 0x2a6ab8, 0x555555, 0x3f8a5f, 0xc23a2a], engine: 'diesel',
  },
  longnose: {
    id: 'longnose', name: { en: 'Longnose', id: 'Longnose' }, cls: 'truck', topSpeed: 28, accel: 9.0, brake: 15, grip: 4.0, steer: 1.7,
    durability: 160, mass: 3200, sell: 550, length: 5.6, width: 2.0, height: 2.2, seatHeight: 0.8,
    colors: [0xc23a2a, 0x3a5a7a, 0xd9a441, 0x6a6a6a, 0x2f6a3a, 0xe8b23c], engine: 'diesel',
  },
  cab: {
    id: 'cab', name: { en: 'City Cab', id: 'Taksi Kota' }, cls: 'taxi', topSpeed: 36, accel: 13.0, brake: 19, grip: 5.5, steer: 2.2,
    durability: 80, mass: 1300, sell: 250, length: 4.4, width: 1.8, height: 1.5, seatHeight: 0.55,
    colors: [0xe8b23c], engine: 'mid', taxi: true,
  },
  interceptor: {
    id: 'interceptor', name: { en: 'CPD Interceptor', id: 'CPD Interceptor' }, cls: 'police', topSpeed: 54, accel: 19.0, brake: 24, grip: 6.2, steer: 2.5,
    durability: 120, mass: 1500, sell: 0, length: 4.5, width: 1.85, height: 1.45, seatHeight: 0.55,
    colors: [0x1a2330], engine: 'sport', police: true,
  },
  cpdvan: {
    id: 'cpdvan', name: { en: 'CPD Van', id: 'Van CPD' }, cls: 'police', topSpeed: 34, accel: 11.5, brake: 17, grip: 4.6, steer: 1.9,
    durability: 150, mass: 2400, sell: 0, length: 4.9, width: 1.95, height: 2.1, seatHeight: 0.7,
    colors: [0x1a2330], engine: 'diesel', police: true,
  },
  armored: {
    id: 'armored', name: { en: 'Gold Hauler', id: 'Truk Emas' }, cls: 'armored', topSpeed: 28, accel: 9.5, brake: 15, grip: 4.2, steer: 1.7,
    durability: 220, mass: 4200, sell: 0, length: 5.8, width: 2.1, height: 2.4, seatHeight: 0.8,
    colors: [0x4a4a48], engine: 'diesel', missionOnly: true,
  },
  // ---- Supercars: invented marques, each with its own silhouette. ----
  // obsidian: sharp angular wedge, scissor-door seams, big rear wing.
  obsidian: {
    id: 'obsidian', name: { en: 'Obsidian', id: 'Obsidian' }, cls: 'supercar', topSpeed: 68, accel: 26.0, brake: 26, grip: 6.8, steer: 2.8,
    durability: 45, mass: 1100, sell: 1400, length: 4.5, width: 2.0, height: 1.1, seatHeight: 0.45,
    colors: [0x1c1c22, 0xc22e2e, 0xe8b23c, 0x2a6ab8, 0xe8e8e8], engine: 'hyper',
    bodyStyle: { nose: 'wedge', spoiler: 'wing', doors: 'scissor', roof: 'coupe' },
  },
  // seraph: sleek mid-engine coupe, ducktail spoiler, side intakes.
  seraph: {
    id: 'seraph', name: { en: 'Seraph', id: 'Seraph' }, cls: 'supercar', topSpeed: 70, accel: 27.0, brake: 26, grip: 7.0, steer: 2.9,
    durability: 45, mass: 1050, sell: 1600, length: 4.4, width: 1.95, height: 1.15, seatHeight: 0.45,
    colors: [0xd8232a, 0xf2f2f2, 0x1a1a1a, 0xffd23c, 0x3a7ab8], engine: 'hyper',
    bodyStyle: { nose: 'smooth', spoiler: 'ducktail', doors: 'standard', roof: 'coupe' },
  },
  // osprey: low and curved, dihedral-door seams, low rear wing.
  osprey: {
    id: 'osprey', name: { en: 'Osprey', id: 'Osprey' }, cls: 'supercar', topSpeed: 72, accel: 28.0, brake: 27, grip: 7.2, steer: 3.0,
    durability: 40, mass: 1000, sell: 1800, length: 4.3, width: 1.9, height: 1.05, seatHeight: 0.42,
    colors: [0x2a7a9a, 0xe86a2a, 0x222222, 0xd8d8d8, 0x6a2a8a], engine: 'hyper',
    bodyStyle: { nose: 'smooth', spoiler: 'wing', doors: 'dihedral', roof: 'coupe' },
  },
  // quasar: the hypercar — lowest, longest, widest wing, fastest.
  quasar: {
    id: 'quasar', name: { en: 'Quasar', id: 'Quasar' }, cls: 'supercar', topSpeed: 78, accel: 30.0, brake: 28, grip: 7.2, steer: 2.9,
    durability: 38, mass: 1150, sell: 2500, length: 4.6, width: 2.05, height: 1.05, seatHeight: 0.42,
    colors: [0x111111, 0xb8b8c8, 0x20b868, 0xc22e2e, 0xf2a33c], engine: 'hyper',
    bodyStyle: { nose: 'wedge', spoiler: 'wing', doors: 'scissor', roof: 'coupe' },
  },
  // lumen: open-top roadster — low windshield, headrest humps, lip spoiler.
  lumen: {
    id: 'lumen', name: { en: 'Lumen', id: 'Lumen' }, cls: 'supercar', topSpeed: 64, accel: 23.0, brake: 25, grip: 6.5, steer: 2.7,
    durability: 42, mass: 950, sell: 1200, length: 4.2, width: 1.9, height: 1.0, seatHeight: 0.42,
    colors: [0xe8b23c, 0x3cd2ff, 0xf2f2f2, 0xff5a8a, 0x2f6b4f], engine: 'hyper',
    bodyStyle: { nose: 'smooth', spoiler: 'lip', doors: 'standard', roof: 'roadster' },
  },
};

export const CIVILIAN_TYPES = ['pico', 'komodo', 'swift', 'bulldog', 'vagabond', 'hauler', 'longnose', 'cab', 'obsidian', 'seraph', 'osprey', 'quasar', 'lumen'];
export const SUPERCAR_TYPES = ['obsidian', 'seraph', 'osprey', 'quasar', 'lumen'];
// Everyday traffic mix. Supercars are NOT in this bag: traffic spawns
// them through a separate rare roll in traffic.js, so they stay rare.
export const TRAFFIC_WEIGHTS = { pico: 3, komodo: 3, swift: 1, bulldog: 1, vagabond: 2, hauler: 2, longnose: 1, cab: 2 };

export function vehicleName(def, lang) {
  return def.name[lang] || def.name.en;
}
