// vehiclesData.js — the whole vehicle roster as data, rewritten in phase 2.
//
// The numbers are unchanged from the phase-1 tune (F7 verified every
// class on a straight line: t90 4.25–6.43 s, cruise 94.7–97.8%). What
// changed is the shape: one compact table drives the roster, so a new
// car is one row, and the class helpers the new systems need live here
// (police types for wanted.js, class lookup for missions, the F4
// supercar set). Physics reads these numbers; it never invents its own.
// Every marque and model name is invented for Veyport — no real car
// brands anywhere.
//
// Columns: id, name, class, topSpeed m/s, accel m/s^2, brake, grip,
// steer, durability, mass kg, sell $, length/width/height m,
// seatHeight m, paint colours, engine note, extras.

const ROWS = [
  // id,          name,            cls,       top, acc, brk, grip, str, dur, mass, sell, L,    W,    H,    seat, colors, engine, extras
  ['pico',        'Pico',          'hatch',   30, 11.0, 18, 6.5, 2.4, 60,  900,  200,  3.6, 1.7,  1.45, 0.55, [0xd8d3c8, 0x7a8a99, 0xc23a2a, 0x3f8a5f, 0xe8b23c, 0x2a6ab8], 'small', {}],
  ['komodo',      'Komodo',        'sedan',   36, 13.0, 19, 5.5, 2.2, 80,  1300, 300,  4.4, 1.8,  1.45, 0.55, [0x2e3a46, 0xc8c2b4, 0xa83232, 0x33475c, 0x2a7a5a, 0xc2702a], 'mid', {}],
  ['swift',       'Swift',         'coupe',   48, 18.0, 22, 6.0, 2.6, 55,  1100, 500,  4.2, 1.8,  1.25, 0.50, [0xc22e2e, 0xeeeeee, 0x2244aa, 0xe8b23c, 0x222222, 0x2a9a6a], 'sport', {}],
  ['bulldog',     'Bulldog',       'muscle',  52, 20.0, 20, 4.2, 2.0, 75,  1500, 650,  4.6, 1.9,  1.40, 0.55, [0x1c1c1c, 0x8a2020, 0x2f6a3a, 0xd8d3c8, 0x3a3a8a, 0xc2702a], 'v8', {}],
  ['vagabond',    'Vagabond',      'suv',     38, 14.0, 18, 5.0, 2.1, 110, 1900, 450,  4.5, 1.9,  1.80, 0.70, [0x4a6a3a, 0xc2702a, 0x2e3a46, 0x3a6a8a, 0x8a2a3a, 0xd8d3c8], 'mid', {}],
  ['hauler',      'Hauler',        'van',     30, 10.0, 16, 4.5, 1.9, 120, 2200, 350,  4.8, 1.9,  2.00, 0.70, [0xd8d3c8, 0x7a8a99, 0x2a6ab8, 0x555555, 0x3f8a5f, 0xc23a2a], 'diesel', {}],
  ['longnose',    'Longnose',      'truck',   28, 9.0,  15, 4.0, 1.7, 160, 3200, 550,  5.6, 2.0,  2.20, 0.80, [0xc23a2a, 0x3a5a7a, 0xd9a441, 0x6a6a6a, 0x2f6a3a, 0xe8b23c], 'diesel', {}],
  ['cab',         'City Cab',      'taxi',    36, 13.0, 19, 5.5, 2.2, 80,  1300, 250,  4.4, 1.8,  1.50, 0.55, [0xe8b23c], 'mid', { taxi: true }],
  ['interceptor', 'CPD Interceptor','police', 54, 19.0, 24, 6.2, 2.5, 120, 1500, 0,    4.5, 1.85, 1.45, 0.55, [0x1a2330], 'sport', { police: true }],
  ['cpdvan',      'CPD Van',       'police',  34, 11.5, 17, 4.6, 1.9, 150, 2400, 0,    4.9, 1.95, 2.10, 0.70, [0x1a2330], 'diesel', { police: true }],
  ['armored',     'Gold Hauler',   'armored', 28, 9.5,  15, 4.2, 1.7, 220, 4200, 0,    5.8, 2.1,  2.40, 0.80, [0x4a4a48], 'diesel', { missionOnly: true }],
  // Supercars: invented marques, each with its own silhouette.
  // Obsidian: sharp angular wedge, scissor-door seams, big rear wing.
  ['obsidian', 'Obsidian', 'supercar', 68, 26.0, 26, 6.8, 2.8, 45, 1100, 1400, 4.5, 2.0, 1.10, 0.45, [0x1c1c22, 0xc22e2e, 0xe8b23c, 0x2a6ab8, 0xe8e8e8], 'hyper', { bodyStyle: { nose: 'wedge', spoiler: 'wing', doors: 'scissor', roof: 'coupe' } }],
  // Seraph: sleek mid-engine coupe, ducktail spoiler, side intakes.
  ['seraph', 'Seraph', 'supercar', 70, 27.0, 26, 7.0, 2.9, 45, 1050, 1600, 4.4, 1.95, 1.15, 0.45, [0xd8232a, 0xf2f2f2, 0x1a1a1a, 0xffd23c, 0x3a7ab8], 'hyper', { bodyStyle: { nose: 'smooth', spoiler: 'ducktail', doors: 'standard', roof: 'coupe' } }],
  // Osprey: low and curved, dihedral-door seams, low rear wing.
  ['osprey', 'Osprey', 'supercar', 72, 28.0, 27, 7.2, 3.0, 40, 1000, 1800, 4.3, 1.9, 1.05, 0.42, [0x2a7a9a, 0xe86a2a, 0x222222, 0xd8d8d8, 0x6a2a8a], 'hyper', { bodyStyle: { nose: 'smooth', spoiler: 'wing', doors: 'dihedral', roof: 'coupe' } }],
  // Quasar: the hypercar — lowest, longest, widest wing, fastest in the game.
  ['quasar', 'Quasar', 'supercar', 78, 30.0, 28, 7.2, 2.9, 38, 1150, 2500, 4.6, 2.05, 1.05, 0.42, [0x111111, 0xb8b8c8, 0x20b868, 0xc22e2e, 0xf2a33c], 'hyper', { bodyStyle: { nose: 'wedge', spoiler: 'wing', doors: 'scissor', roof: 'coupe' } }],
  // Lumen: open-top roadster — low windshield, headrest humps, lip spoiler.
  ['lumen', 'Lumen', 'supercar', 64, 23.0, 25, 6.5, 2.7, 42, 950, 1200, 4.2, 1.9, 1.00, 0.42, [0xe8b23c, 0x3cd2ff, 0xf2f2f2, 0xff5a8a, 0x2f6b4f], 'hyper', { bodyStyle: { nose: 'smooth', spoiler: 'lip', doors: 'standard', roof: 'roadster' } }],
];

function rowToDef(r) {
  const [id, name, cls, topSpeed, accel, brake, grip, steer, durability, mass, sell, length, width, height, seatHeight, colors, engine, extras] = r;
  return {
    id, name: { en: name, id: name }, cls,
    topSpeed, accel, brake, grip, steer, durability, mass, sell,
    length, width, height, seatHeight, colors, engine,
    taxi: !!extras.taxi, police: !!extras.police, missionOnly: !!extras.missionOnly,
    bodyStyle: extras.bodyStyle || null,
  };
}

export const VEHICLES = {};
for (const r of ROWS) VEHICLES[r[0]] = rowToDef(r);

/** Every type the player can meet on the street or in a parking spot. */
export const CIVILIAN_TYPES = [
  'pico', 'komodo', 'swift', 'bulldog', 'vagabond', 'hauler', 'longnose', 'cab',
  'obsidian', 'seraph', 'osprey', 'quasar', 'lumen',
];

export const SUPERCAR_TYPES = ['obsidian', 'seraph', 'osprey', 'quasar', 'lumen'];
export const POLICE_TYPES = ['interceptor', 'cpdvan'];
export const DRIVABLE_TYPES = Object.keys(VEHICLES).filter((k) => !VEHICLES[k].missionOnly);

/**
 * Everyday traffic mix. Supercars are NOT in this bag: traffic spawns them
 * through a separate rare roll, so they stay rare on the road.
 */
export const TRAFFIC_WEIGHTS = {
  pico: 3, komodo: 3, swift: 1, bulldog: 1, vagabond: 2, hauler: 2, longnose: 1, cab: 2,
};

/** Traffic spawns a supercar on this fraction of spawns (rare, stealable). */
export const SUPERCAR_TRAFFIC_CHANCE = 0.04;

/** All vehicle defs of one class (e.g. 'supercar', 'police'). */
export function vehiclesByClass(cls) {
  return Object.values(VEHICLES).filter((v) => v.cls === cls);
}

export function vehicleName(def, lang) {
  return def.name[lang] || def.name.en;
}

/** Top speed in km/h, for the HUD speedometer. */
export function topSpeedKmh(def) {
  return Math.round(def.topSpeed * 3.6);
}
