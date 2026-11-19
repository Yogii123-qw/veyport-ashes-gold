// vehiclesData.js - the fleet of Veyport, as pure data.
// Every number lives here; the driving code reads it, never hardcodes it.
// Acceleration uses a power curve: a(v) = pull * (1 - (v/top)^2).
// pull is tuned per class so 0 to 90% of top speed lands in 3.73-4.52 s
// (the F7 feel target). For that curve, v(t) = top * tanh(pull * t / top),
// so t90 = atanh(0.9) * top / pull = 1.472 * top / pull.

export const T90_FLOOR = 3.73;
export const T90_CEIL = 4.52;

// pull from a target t90: pull = 1.472 * top / t90
function pullFor(top, t90) {
  return +(1.472 * top / t90).toFixed(2);
}

function cls(o) {
  return {
    id: o.id, name: o.name, kind: o.kind, top: o.top,
    pull: pullFor(o.top, o.t90), t90: o.t90,
    brake: o.brake, grip: o.grip, steer: o.steer,
    durability: o.durability, mass: o.mass, price: o.price,
    len: o.len, wid: o.wid, hei: o.hei,
    colors: o.colors, engine: o.engine, note: o.note || '',
    spoiler: !!o.spoiler, police: !!o.police, taxi: !!o.taxi,
  };
}

export const VEHICLE_CLASSES = [
  cls({ id: 'pico', name: 'Pico', kind: 'hatchback', top: 32, t90: 4.40, brake: 14, grip: 0.95, steer: 2.6, durability: 45, mass: 950, price: 3200, len: 3.6, wid: 1.7, hei: 1.45, colors: [0x3a7bd5, 0xd8d8d8, 0xe0a030, 0x7a4a8a], engine: '1.2L buzz', note: 'city hatchback' }),
  cls({ id: 'komodo', name: 'Komodo', kind: 'sedan', top: 38, t90: 4.30, brake: 15, grip: 0.9, steer: 2.5, durability: 60, mass: 1350, price: 6800, len: 4.4, wid: 1.85, hei: 1.42, colors: [0x2e4a6b, 0x8a8f96, 0x5a2e2e, 0xd8d8d8], engine: '2.0L hum', note: 'everyday sedan' }),
  cls({ id: 'swift', name: 'Swift', kind: 'coupe', top: 48, t90: 4.10, brake: 17, grip: 1.0, steer: 2.8, durability: 50, mass: 1250, price: 14500, len: 4.3, wid: 1.9, hei: 1.28, colors: [0xc03028, 0x1e5cb8, 0xe8e8e8, 0x222222], engine: '2.4L snarl', note: 'sport coupe' }),
  cls({ id: 'bulldog', name: 'Bulldog', kind: 'muscle', top: 46, t90: 3.90, brake: 15, grip: 0.72, steer: 2.3, durability: 65, mass: 1650, price: 18900, len: 4.7, wid: 1.95, hei: 1.38, colors: [0x1a1a1a, 0x8a1a1a, 0x2a4a2a, 0xd8b030], engine: '5.7L V8 roar', note: 'muscle, loose tail' }),
  cls({ id: 'vagabond', name: 'Vagabond', kind: 'suv', top: 40, t90: 4.40, brake: 14, grip: 0.85, steer: 2.2, durability: 80, mass: 1900, price: 12400, len: 4.6, wid: 2.0, hei: 1.78, colors: [0x4a5a3a, 0x6b5a3a, 0x3a3a3a, 0x9ab8c8], engine: '3.0L grunt', note: 'tough SUV' }),
  cls({ id: 'hauler', name: 'Hauler', kind: 'van', top: 30, t90: 4.50, brake: 12, grip: 0.7, steer: 1.9, durability: 90, mass: 2400, price: 9200, len: 5.0, wid: 2.05, hei: 2.1, colors: [0xd8d8d8, 0x5a6b7a, 0x8a7a4a, 0x3a3a3a], engine: 'diesel clatter', note: 'work van' }),
  cls({ id: 'longnose', name: 'Longnose', kind: 'truck', top: 28, t90: 4.52, brake: 11, grip: 0.65, steer: 1.7, durability: 100, mass: 3200, price: 15000, len: 5.6, wid: 2.2, hei: 2.3, colors: [0x7a4a2a, 0x4a6b8a, 0x8a8a8a], engine: 'big diesel', note: 'flatbed truck' }),
  cls({ id: 'cab', name: 'City Cab', kind: 'taxi', top: 38, t90: 4.30, brake: 15, grip: 0.88, steer: 2.5, durability: 60, mass: 1400, price: 7500, len: 4.4, wid: 1.85, hei: 1.45, colors: [0xe8c020], engine: '2.0L hum', note: 'taxi', taxi: true }),
  cls({ id: 'interceptor', name: 'CPD Interceptor', kind: 'police', top: 55, t90: 3.80, brake: 18, grip: 1.02, steer: 2.9, durability: 85, mass: 1600, price: 0, len: 4.6, wid: 1.95, hei: 1.4, colors: [0x1a2a3a], engine: 'police tune', note: 'police pursuit', police: true, spoiler: true }),
  cls({ id: 'cpdvan', name: 'CPD Van', kind: 'police', top: 36, t90: 4.40, brake: 13, grip: 0.7, steer: 1.9, durability: 95, mass: 2500, price: 0, len: 5.1, wid: 2.1, hei: 2.2, colors: [0x1a2a3a], engine: 'police diesel', note: 'police transport', police: true }),
  // Fictional supercars (F4). Fastest in the game, fragile, expensive.
  cls({ id: 'obsidian', name: 'Obsidian', kind: 'supercar', top: 62, t90: 3.85, brake: 19, grip: 1.05, steer: 3.0, durability: 45, mass: 1400, price: 86000, len: 4.5, wid: 2.0, hei: 1.15, colors: [0x0d0d0d, 0x2a2a3a, 0x4a0a0a], engine: 'V10 shriek', note: 'sharp angular wedge', spoiler: true }),
  cls({ id: 'seraph', name: 'Seraph', kind: 'supercar', top: 70, t90: 3.77, brake: 20, grip: 1.08, steer: 3.1, durability: 42, mass: 1350, price: 120000, len: 4.4, wid: 1.95, hei: 1.12, colors: [0xe8e8e8, 0xc03028, 0x1e5cb8, 0xd8b030], engine: 'V12 howl', note: 'sleek mid-engine, fastest', spoiler: true }),
  cls({ id: 'osprey', name: 'Osprey', kind: 'supercar', top: 64, t90: 3.80, brake: 19, grip: 1.06, steer: 3.0, durability: 44, mass: 1380, price: 94000, len: 4.5, wid: 2.02, hei: 1.18, colors: [0x1a4a6b, 0x222222, 0x8a8a8a], engine: 'twin-turbo V8', note: 'low curved GT', spoiler: true }),
  cls({ id: 'quasar', name: 'Quasar', kind: 'supercar', top: 66, t90: 3.75, brake: 20, grip: 1.1, steer: 3.2, durability: 40, mass: 1300, price: 150000, len: 4.3, wid: 2.05, hei: 1.1, colors: [0x3a0a4a, 0x0d0d0d, 0xb8b8b8], engine: 'hybrid scream', note: 'hypercar, quickest launch', spoiler: true }),
  cls({ id: 'lumen', name: 'Lumen', kind: 'supercar', top: 60, t90: 3.90, brake: 18, grip: 1.04, steer: 3.0, durability: 46, mass: 1320, price: 78000, len: 4.4, wid: 1.98, hei: 1.2, colors: [0xe8d8a0, 0x4a8a8a, 0xc06030], engine: 'V8 burble', note: 'open-top roadster', spoiler: true }),
  cls({ id: 'marlin', name: 'Marlin', kind: 'roadster', top: 52, t90: 4.00, brake: 17, grip: 0.98, steer: 2.9, durability: 52, mass: 1200, price: 42000, len: 4.2, wid: 1.9, hei: 1.22, colors: [0x2a6b8a, 0x8a2a4a, 0xe8e8e8], engine: 'flat-six wail', note: 'light roadster' }),
];

export const CLASS_BY_ID = new Map(VEHICLE_CLASSES.map((c) => [c.id, c]));

// Power-curve acceleration at a given speed (m/s^2). Pure function.
export function accelAt(def, speed) {
  const s = Math.min(Math.abs(speed), def.top);
  return def.pull * (1 - (s / def.top) * (s / def.top));
}

// Simulate 0 to 90% of top speed at 60 Hz; returns seconds. Pure, node-testable.
export function timeTo90(def) {
  let v = 0;
  const target = def.top * 0.9;
  const dt = 1 / 60;
  let t = 0;
  while (v < target && t < 30) {
    v += accelAt(def, v) * dt;
    t += dt;
  }
  return +t.toFixed(2);
}

// Steering rate at a speed, after the high-speed cut (P6): full lock stays
// calm at 250 km/h. Returns radians per second at full deflection.
export function steerRateAt(def, speed, steerIn) {
  const s = Math.abs(speed);
  const speedFactor = Math.min(1, s / 7);
  const cut = 1 - 0.65 * Math.min(1, s / def.top);
  return steerIn * def.steer * speedFactor * cut * (speed < 0 ? -1 : 1);
}

export function kmh(ms) {
  return Math.round(ms * 3.6);
}
