// Small pure helpers shared by every module: seeded randomness, angles,
// distances, checksums and formatting. No DOM, no three.js, no game state.

export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Frame-rate independent approach: rate 1/s, dt seconds. */
export function damp(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

export function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

export function angleLerp(from, to, t) {
  return from + angleDiff(from, to) * t;
}

export function dampAngle(current, target, rate, dt) {
  return current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/** FNV-1a 32-bit checksum, hex string, over a UTF-8 string. */
export function fnv1a(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** JSON with object keys sorted recursively: one spelling per value. */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function formatMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amount));
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

export function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}
