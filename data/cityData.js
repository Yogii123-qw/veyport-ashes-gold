// Veyport's geography as data: districts, roads, points of interest,
// collectibles, stunt jumps and time trials. Code reads this file; no
// gameplay number hides in logic. Coordinates: x east, z south, metres,
// city spans -600..600 on both axes. Heading 0 faces +z (south).

export const WORLD = {
  half: 600,
  roadHalfWidth: 7,
  sidewalk: 4,
  blockInset: 13,
};

export const GRID_LINES = [-450, -300, -150, 0, 150, 300, 450];
export const RING = 540;

export const DISTRICTS = [
  { id: 'foundry', name: { en: 'Foundry Row', id: 'Foundry Row' }, rect: [-600, -600, -150, -150], tint: '#8a7a5a', building: [0.42, 0.38, 0.33], height: [14, 34], density: 0.9 },
  { id: 'palm', name: { en: 'Palm Heights', id: 'Palm Heights' }, rect: [150, -600, 600, -150], tint: '#7a9a6a', building: [0.82, 0.78, 0.7], height: [8, 20], density: 0.55 },
  { id: 'neon', name: { en: 'Neon Mile', id: 'Neon Mile' }, rect: [-150, -600, 150, 150], tint: '#b0708a', building: [0.55, 0.5, 0.58], height: [20, 52], density: 1.0 },
  { id: 'docks', name: { en: 'The Docks', id: 'The Docks' }, rect: [-600, -150, -150, 300], tint: '#6a7a8a', building: [0.45, 0.44, 0.4], height: [10, 26], density: 0.7 },
  { id: 'ember', name: { en: 'Ember Sands', id: 'Ember Sands' }, rect: [-600, 300, 150, 600], tint: '#c2a06a', building: [0.85, 0.76, 0.6], height: [6, 16], density: 0.5 },
  { id: 'bazaar', name: { en: 'Little Bazaar', id: 'Little Bazaar' }, rect: [150, -150, 600, 600], tint: '#a08a5a', building: [0.62, 0.52, 0.4], height: [8, 22], density: 1.0 },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    const [x0, z0, x1, z1] = d.rect;
    if (x >= x0 && x < x1 && z >= z0 && z < z1) return d;
  }
  return DISTRICTS[2];
}

// Water the player cannot cross except on a bridge deck (road segments).
export const WATER_RECTS = [
  { rect: [-600, 306, -290, 330], name: 'harborChannel' },
  { rect: [-660, -660, -600, 660], name: 'westHarbor' },
  { rect: [-660, 600, 660, 660], name: 'southBay' },
  { rect: [600, -660, 660, 660], name: 'eastReach' },
];

export const TUNNEL = { rect: [520, -330, 560, -210], roadX: 540, name: 'Palm Tunnel' };
export const BRIDGES = [
  { x: -450, z0: 300, z1: 336 },
  { x: -300, z0: 300, z1: 336 },
];

export const POIS = [
  { id: 'safehouse', kind: 'safehouse', name: { en: 'Rook\u2019s Safehouse', id: 'Safehouse Rook' }, x: -420, z: 60, district: 'docks' },
  { id: 'bar', kind: 'bar', name: { en: 'The Rusty Anchor', id: 'The Rusty Anchor' }, x: 60, z: -60, district: 'neon' },
  { id: 'chopshop', kind: 'chopshop', name: { en: 'Foundry Chop-Shop', id: 'Chop-Shop Foundry' }, x: -180, z: -300, district: 'foundry' },
  { id: 'gunshop', kind: 'gunshop', name: { en: 'Harbor Arms', id: 'Harbor Arms' }, x: 90, z: 90, district: 'neon' },
  { id: 'respray', kind: 'respray', name: { en: 'Cut & Coat Respray', id: 'Cut & Coat Respray' }, x: -240, z: -240, district: 'foundry' },
  { id: 'hospital', kind: 'hospital', name: { en: 'St. Anselm Hospital', id: 'RS St. Anselm' }, x: 300, z: 30, district: 'bazaar' },
  { id: 'police', kind: 'police', name: { en: 'CPD Central', id: 'CPD Central' }, x: 0, z: -300, district: 'neon' },
  { id: 'harborHq', kind: 'gangHq', faction: 'harbormen', name: { en: 'Harbormen Hall', id: 'Balai Harbormen' }, x: -460, z: -60, district: 'docks' },
  { id: 'foundryHq', kind: 'gangHq', faction: 'foundry', name: { en: 'Kings\u2019 Furnace', id: 'Tungku Kings' }, x: -225, z: -375, district: 'foundry' },
  { id: 'food1', kind: 'food', name: { en: 'Bazaar Noodle Cart', id: 'Gerobak Mi Bazaar' }, x: 180, z: 210, district: 'bazaar' },
  { id: 'food2', kind: 'food', name: { en: 'Neon Taco Stand', id: 'Warung Taco Neon' }, x: -60, z: 120, district: 'neon' },
  { id: 'food3', kind: 'food', name: { en: 'Boardwalk Fry Shack', id: 'Warung Gorengan Boardwalk' }, x: -380, z: 380, district: 'ember' },
  { id: 'marina', kind: 'landmark', name: { en: 'Palm Marina', id: 'Marina Palm' }, x: 520, z: -300, district: 'palm' },
  { id: 'lighthouse', kind: 'landmark', name: { en: 'Ember Light', id: 'Mercusuar Ember' }, x: -500, z: 540, district: 'ember' },
  { id: 'targetHouse', kind: 'landmark', name: { en: 'Villa Marisol', id: 'Vila Marisol' }, x: 420, z: -380, district: 'palm' },
];

export function poiById(id) {
  return POIS.find((p) => p.id === id) || null;
}

// 24 Ember Caches: hidden pickups, $100 each, $1,000 bonus when complete.
export const CACHES = [
  [-470, -120], [-360, 240], [-520, 40], [-280, 120], [-90, -420], [-210, -480],
  [-30, -240], [60, -360], [120, -60], [30, 60], [-120, 90], [210, -240],
  [360, -330], [480, -120], [300, -480], [540, -420], [240, 120], [420, 240],
  [540, 60], [300, 420], [480, 480], [-120, 420], [-300, 520], [-540, 480],
].map(([x, z], i) => ({ id: `cache${i + 1}`, x, z }));

// 5 stunt jumps: ramps. Air time + distance are measured from real physics.
export const STUNT_JUMPS = [
  { id: 'jumpBeach', name: { en: 'Boardwalk Launch', id: 'Lompatan Boardwalk' }, x: -300, z: 500, heading: Math.PI / 2, ramp: 1.1 },
  { id: 'jumpDocks', name: { en: 'Crane Gap', id: 'Loncatan Derek' }, x: -480, z: 200, heading: 0, ramp: 1.2 },
  { id: 'jumpFoundry', name: { en: 'Furnace Flyer', id: 'Terbang Tungku' }, x: -200, z: -450, heading: Math.PI, ramp: 1.0 },
  { id: 'jumpPalm', name: { en: 'Marina Air', id: 'Lompatan Marina' }, x: 400, z: -400, heading: -Math.PI / 2, ramp: 1.15 },
  { id: 'jumpBazaar', name: { en: 'Bazaar Rooftop', id: 'Atap Bazaar' }, x: 350, z: 350, heading: Math.PI, ramp: 1.05 },
];

// 3 time trials: checkpoint rings in order, best time kept per trial.
export const TIME_TRIALS = [
  { id: 'trialRing', name: { en: 'Ring Road Sprint', id: 'Sprint Ring Road' }, start: [-540, -540], checkpoints: [[540, -540], [540, 540], [-540, 540], [-540, -540]] },
  { id: 'trialNeon', name: { en: 'Neon Mile Slalom', id: 'Slalom Neon Mile' }, start: [0, -450], checkpoints: [[0, -150], [150, 0], [0, 150], [-150, 0], [0, -150]] },
  { id: 'trialHarbor', name: { en: 'Harbor Run', id: 'Lari Pelabuhan' }, start: [-540, 300], checkpoints: [[-300, 300], [-150, 150], [150, 150], [300, 300], [540, 300]] },
];

export const PLAYER_SPAWN = { x: -360, z: 40, heading: Math.PI / 2 };

// Points the city generator must keep clear of buildings and props:
// the spawn, mission vehicle spawns, and mission-critical open ground.
// A building on any of these would soft-lock a stage.
export const CLEAR_POINTS = [
  { x: -360, z: 40 },   // player spawn
  { x: 78, z: -44 },    // M1: Ilex's Pico
  { x: -480, z: 120 },  // M2: cargo pickup at Pier 4
  { x: -210, z: -270 }, // M3: chop-shop approach
  { x: -175, z: -272 }, // M3: marked Bulldog
  { x: -380, z: 20 },   // M5: traitor spawn
];
export const MENU_CAMERA = { x: 0, z: -120, radius: 320, height: 90 };
