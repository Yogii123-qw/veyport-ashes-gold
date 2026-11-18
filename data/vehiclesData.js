// Vehicle roster as data: 8 civilian classes, 2 police classes, and one
// mission-only armored truck. topSpeed in m/s, accel in m/s^2, grip is the
// lateral-velocity decay rate (higher holds the road, lower slides), and
// durability is the integrity pool. Numbers here are the only tuning knobs;
// physics.js reads them, never invents its own.

export const VEHICLES = {
  pico: {
    id: 'pico', name: { en: 'Pico', id: 'Pico' }, cls: 'hatch', topSpeed: 26, accel: 7.0, brake: 14, grip: 6.5, steer: 2.4,
    durability: 60, mass: 900, sell: 200, length: 3.6, width: 1.7, height: 1.45, seatHeight: 0.55,
    colors: [0xd8d3c8, 0x7a8a99, 0xb8452f, 0x3f6b4f, 0xd9a441], engine: 'small',
  },
  komodo: {
    id: 'komodo', name: { en: 'Komodo', id: 'Komodo' }, cls: 'sedan', topSpeed: 32, accel: 8.0, brake: 15, grip: 5.5, steer: 2.2,
    durability: 80, mass: 1300, sell: 300, length: 4.4, width: 1.8, height: 1.45, seatHeight: 0.55,
    colors: [0x2e3a46, 0xc8c2b4, 0x5a2f2f, 0x33475c, 0x777777], engine: 'mid',
  },
  swift: {
    id: 'swift', name: { en: 'Swift', id: 'Swift' }, cls: 'coupe', topSpeed: 42, accel: 11.0, brake: 17, grip: 6.0, steer: 2.6,
    durability: 55, mass: 1100, sell: 500, length: 4.2, width: 1.8, height: 1.25, seatHeight: 0.5,
    colors: [0xc22e2e, 0xeeeeee, 0x2244aa, 0xe8b23c, 0x222222], engine: 'sport',
  },
  bulldog: {
    id: 'bulldog', name: { en: 'Bulldog', id: 'Bulldog' }, cls: 'muscle', topSpeed: 46, accel: 13.0, brake: 13, grip: 4.2, steer: 2.0,
    durability: 75, mass: 1500, sell: 650, length: 4.6, width: 1.9, height: 1.4, seatHeight: 0.55,
    colors: [0x1c1c1c, 0x7a1f1f, 0x2f4a2f, 0xd8d3c8, 0x3a3a6a], engine: 'v8',
  },
  vagabond: {
    id: 'vagabond', name: { en: 'Vagabond', id: 'Vagabond' }, cls: 'suv', topSpeed: 33, accel: 8.5, brake: 14, grip: 5.0, steer: 2.1,
    durability: 110, mass: 1900, sell: 450, length: 4.5, width: 1.9, height: 1.8, seatHeight: 0.7,
    colors: [0x4a5a3a, 0x8a8578, 0x2e3a46, 0xa89a80, 0x5c3a2a], engine: 'mid',
  },
  hauler: {
    id: 'hauler', name: { en: 'Hauler', id: 'Hauler' }, cls: 'van', topSpeed: 26, accel: 5.5, brake: 12, grip: 4.5, steer: 1.9,
    durability: 120, mass: 2200, sell: 350, length: 4.8, width: 1.9, height: 2.0, seatHeight: 0.7,
    colors: [0xd8d3c8, 0x7a8a99, 0x8a6a3a, 0x555555, 0x3f6b4f], engine: 'diesel',
  },
  longnose: {
    id: 'longnose', name: { en: 'Longnose', id: 'Longnose' }, cls: 'truck', topSpeed: 24, accel: 4.5, brake: 11, grip: 4.0, steer: 1.7,
    durability: 160, mass: 3200, sell: 550, length: 5.6, width: 2.0, height: 2.2, seatHeight: 0.8,
    colors: [0xb8452f, 0x3a5a7a, 0xd9a441, 0x6a6a6a, 0x2f4a2f], engine: 'diesel',
  },
  cab: {
    id: 'cab', name: { en: 'City Cab', id: 'Taksi Kota' }, cls: 'taxi', topSpeed: 32, accel: 8.0, brake: 15, grip: 5.5, steer: 2.2,
    durability: 80, mass: 1300, sell: 250, length: 4.4, width: 1.8, height: 1.5, seatHeight: 0.55,
    colors: [0xe8b23c], engine: 'mid', taxi: true,
  },
  interceptor: {
    id: 'interceptor', name: { en: 'CPD Interceptor', id: 'CPD Interceptor' }, cls: 'police', topSpeed: 48, accel: 12.0, brake: 18, grip: 6.2, steer: 2.5,
    durability: 120, mass: 1500, sell: 0, length: 4.5, width: 1.85, height: 1.45, seatHeight: 0.55,
    colors: [0x1a2330], engine: 'sport', police: true,
  },
  cpdvan: {
    id: 'cpdvan', name: { en: 'CPD Van', id: 'Van CPD' }, cls: 'police', topSpeed: 30, accel: 7.0, brake: 13, grip: 4.6, steer: 1.9,
    durability: 150, mass: 2400, sell: 0, length: 4.9, width: 1.95, height: 2.1, seatHeight: 0.7,
    colors: [0x1a2330], engine: 'diesel', police: true,
  },
  armored: {
    id: 'armored', name: { en: 'Gold Hauler', id: 'Truk Emas' }, cls: 'armored', topSpeed: 26, accel: 5.0, brake: 11, grip: 4.2, steer: 1.7,
    durability: 220, mass: 4200, sell: 0, length: 5.8, width: 2.1, height: 2.4, seatHeight: 0.8,
    colors: [0x4a4a48], engine: 'diesel', missionOnly: true,
  },
};

export const CIVILIAN_TYPES = ['pico', 'komodo', 'swift', 'bulldog', 'vagabond', 'hauler', 'longnose', 'cab'];
export const TRAFFIC_WEIGHTS = { pico: 3, komodo: 3, swift: 1, bulldog: 1, vagabond: 2, hauler: 2, longnose: 1, cab: 2 };

export function vehicleName(def, lang) {
  return def.name[lang] || def.name.en;
}
