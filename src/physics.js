// physics.js - the Veyport driving model, as pure functions plus one
// wrapper. The step itself lives in vehicles.js (stepDrive); this module
// owns the numbers around it: the power-curve simulation the F7 probe
// measures, braking distances, drift state, and impact damage. Nothing
// here duplicates stepDrive: applyDrive calls it once and adds the
// phase-B behaviours (drift smoke flags, skid, damage smoke) on top.
// Wheel spin stays where it belongs: only a detailed (player) car's four
// separate wheel meshes ever rotate; traffic wheels are merged and static.

import { accelAt, timeTo90, kmh } from './vehiclesData.js';
import { stepDrive } from './vehicles.js';

export { accelAt, timeTo90, kmh };

// Simulate 0 to 90% of top speed at 60 Hz with the real curve and the
// real drag terms stepDrive applies (rolling drag exp(-0.12 dt)).
// Returns { t90, reached, topKmh }. Pure, node-testable.
export function simulateLaunch(def) {
  let v = 0;
  const target = def.top * 0.9;
  const dt = 1 / 60;
  let t = 0;
  while (v < target && t < 30) {
    v += accelAt(def, v) * dt;
    v *= Math.exp(-0.12 * dt);
    t += dt;
  }
  return { t90: +t.toFixed(2), reached: v >= target, topKmh: kmh(def.top) };
}

// Stopping distance (m) from a speed, using the class brake value and
// the same rolling drag. Pure.
export function brakingDistance(def, speedMs, gripMul = 1) {
  const dec = def.brake * gripMul + 0.12 * Math.abs(speedMs);
  if (dec <= 0) return Infinity;
  return +(speedMs * speedMs / (2 * dec)).toFixed(1);
}

// Lateral slip estimate for a step: how much the car slides sideways
// relative to its heading. Returns 0..1 (1 = full slide). Used for
// tire smoke and skid audio.
export function slipFactor(v, ctrl) {
  if (!v || Math.abs(v.speed) < 4) return 0;
  const steerMag = Math.abs(ctrl.steer || 0);
  const hand = ctrl.handbrake ? 1 : 0;
  const grip = v.def.grip || 1;
  const raw = steerMag * Math.abs(v.speed) / v.def.top * (1.6 - grip * 0.7) + hand * 0.8;
  return Math.max(0, Math.min(1, raw));
}

// Damage from a wall hit of a given impact speed (m/s). Matches the
// stepDrive rule: nothing below 4 m/s, then (impact - 4) * 2.2.
export function damageFromImpact(impact) {
  if (impact <= 4) return 0;
  return +(impact - 4) * 2.2;
}

// Drive one vehicle a step, then report the phase-B extras. Returns
// { crash, drifting, skid, smoked } where crash is stepDrive's crash
// event (or null). The wrapper never changes the physics: it only
// observes it and sets the smoke flag the HUD/effects read.
export function applyDrive(v, ctrl, dt, colliders, gripMul = 1) {
  const crash = stepDrive(v, ctrl, dt, colliders, gripMul);
  const slip = slipFactor(v, ctrl);
  const drifting = slip > 0.55 && Math.abs(v.speed) > 6;
  const skid = slip > 0.35;
  const smoked = v.damage < 60 && !v.wrecked;
  if (crash && crash.impact > 4) v.smoking = true;
  return { crash, drifting, skid, smoked, slip };
}

// Turn radius (m) at a speed with full lock, from the steering model.
export function turnRadius(def, speedMs) {
  const rate = def.steer * Math.min(1, Math.abs(speedMs) / 7) * (1 - 0.65 * Math.min(1, Math.abs(speedMs) / def.top));
  if (rate <= 0.001) return Infinity;
  return +(Math.abs(speedMs) / rate).toFixed(1);
}

// How far a car coasts (m) from a speed with no input, rolling drag only.
export function coastDistance(speedMs) {
  if (speedMs <= 0) return 0;
  return +(speedMs / 0.12).toFixed(1);
}
