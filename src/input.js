// input.js — keyboard + mouse + touch, one state object, rewritten in phase 2.
//
// Every control is per-button state (held / just-pressed), so the game
// never misses a tap and never double-fires one. Aim and fire are
// independent buttons: on a phone the player can drag-aim with one thumb
// and hold fire with the other at the same time (F2's twin requirement:
// aim + fire together, run + steer together). This rewrite keeps the
// exact phase-1 API, drives the touch buttons from one binding table
// instead of six copy-pasted calls, and adds edge-triggered horn and
// lights actions (H / L) that the audio and headlight code listen for.
//
// Desktop (SPEC §5.1): WASD move/drive, Shift run, Space handbrake,
// E enter/exit, F interact, left click fire, right click aim (hold),
// R reload, 1-5 weapons, M map, Esc/P pause, H horn, L lights.
// Touch (SPEC §5.2): left virtual joystick (move + steer), right buttons
// ACTION / FIRE / BRAKE / RUN (hold-to-run, F2), weapon picker, map,
// pause. Camera drag happens on empty screen space.

const KEY_ACTIONS = [
  ['KeyE', 'enter'],
  ['KeyR', 'reload'],
  ['KeyM', 'map'],
  ['KeyH', 'horn'],
  ['KeyL', 'lights'],
];

const TOUCH_HOLD = [
  ['btnRun', 'run'],
  ['btnFire', 'fire'],
  ['btnAim', 'aim'],
  ['btnBrake', 'brake'],
];

const TOUCH_TAP = [
  ['btnAction', 'action'],
  ['btnInteract', 'interact'],
];

// P4: a resting thumb must not steer the camera. A look-drag only
// engages after a deliberate flick: the touch must travel at least
// 6 px from where it landed, in a single move of at least 3 px.
// Before that, every move is dropped. Once engaged, the whole
// displacement since touch-down feeds through, so a deliberate 60 px
// drag still turns ~0.42 rad — exactly as measured before P4.
const LOOK_DEADZONE_PX = 6;
const LOOK_MIN_STEP_PX = 3;

// P6: a resting thumb must not steer the car either. A virtual
// joystick never sits exactly at zero — a thumb parked slightly
// off-centre reads 0.05–0.2 — and before this fix that raw value fed
// straight into steering (measured: dx=0.2 turns the Seraph 29 deg/s
// at 60 km/h, 18 deg/s at 250 km/h, so the car curves forever and the
// chase camera swings with it). Each axis gets a dead zone with
// rescale: below 0.12 reads as 0, full deflection still reads 1, so
// keyboard input (exactly 0 or 1) is untouched and deliberate
// steering keeps its full range.
const JOY_DEADZONE = 0.12;
function deadzone(v) {
  const a = Math.abs(v);
  if (a < JOY_DEADZONE) return 0;
  return Math.sign(v) * ((a - JOY_DEADZONE) / (1 - JOY_DEADZONE));
}

export function createInput() {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered: consumed by takeActions()
  const joy = { active: false, id: -1, x: 0, y: 0, mag: 0, lookId: -1, lastX: 0, lastY: 0, lookEngaged: false, lookStartX: 0, lookStartY: 0 };
  const touch = { run: false, fire: false, aim: false, brake: false, action: false, interact: false };
  const look = { dx: 0, dy: 0 }; // accumulated mouse/touch-drag look deltas
  let mouseDown = false;
  let mouseAim = false;
  let pointerLocked = false;
  let lookScale = 1;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const canvas = document.getElementById('game');
  // P6: ignore mouse events synthesised from a touch. On a real phone
  // the browser fires compat mousedown/mousemove after a touchstart
  // that was not preventDefaulted, and the mousemove handler below
  // used to feed look.dx from movementX ON TOP of the touch path
  // (measured: a 60 px drag turned 0.58 rad instead of 0.42). A real
  // mouse has no firesTouchEvents flag, so desktop play is untouched.
  const isCompatMouse = (e) => !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
  canvas.addEventListener('mousedown', (e) => {
    if (isCompatMouse(e)) return;
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) mouseAim = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) mouseAim = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousemove', (e) => {
    if (isCompatMouse(e)) return;
    if (pointerLocked || mouseDown) {
      look.dx += e.movementX;
      look.dy += e.movementY;
    }
  });
  canvas.addEventListener('click', () => {
    // Desktop aim uses pointer lock when the game is running; a click
    // re-locks after Esc released it. Failure is silent (not an error).
    if (!pointerLocked && !('ontouchstart' in window)) {
      canvas.requestPointerLock?.();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  // ---- Touch buttons, driven by the tables above ----
  function bindHold(id, name) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); touch[name] = true; el.classList.add('held'); };
    const off = (e) => { e.preventDefault(); touch[name] = false; el.classList.remove('held'); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
  function bindTap(id, name) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); touch[name] = true; }, { passive: false });
    el.addEventListener('click', () => { touch[name] = true; });
  }
  for (const [id, name] of TOUCH_HOLD) bindHold(id, name);
  for (const [id, name] of TOUCH_TAP) bindTap(id, name);

  // ---- Virtual joystick + camera drag ----
  const joyBase = document.getElementById('joy');
  const joyKnob = document.getElementById('joyKnob');

  function joyPos(t) {
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (t.clientX - cx) / (r.width / 2);
    let dy = (t.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    return { dx, dy, mag: Math.min(1, m) };
  }
  function onTouchStart(e) {
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (joyBase && joyBase.contains(el)) {
        // P6: preventDefault stops the browser synthesising compat
        // mouse events from this touch (the other half of the fix is
        // the isCompatMouse guard on the mouse handlers).
        e.preventDefault();
        joy.active = true;
        joy.id = t.identifier;
        const p = joyPos(t);
        joy.x = p.dx; joy.y = p.dy; joy.mag = p.mag;
        joyKnob.style.transform = `translate(${p.dx * 34}px, ${p.dy * 34}px)`;
      } else if (el === canvas) {
        // Drag on empty space looks the camera around.
        e.preventDefault();
        joy.lookId = t.identifier;
        joy.lastX = t.clientX;
        joy.lastY = t.clientY;
        // P4: the drag starts disengaged — see onTouchMove.
        joy.lookEngaged = false;
        joy.lookStartX = t.clientX;
        joy.lookStartY = t.clientY;
      }
      // Touches anywhere else (HUD buttons, dialogs, menus) are left
      // alone so their tap/click handling keeps working.
    }
  }
  function onTouchMove(e) {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        const p = joyPos(t);
        joy.x = p.dx; joy.y = p.dy; joy.mag = p.mag;
        joyKnob.style.transform = `translate(${p.dx * 34}px, ${p.dy * 34}px)`;
        e.preventDefault();
      } else if (t.identifier === joy.lookId) {
        // P4 dead zone: a resting thumb or slow drift must not steer
        // the camera. The drag only engages after a deliberate flick
        // (>= 6 px from touch-down, in a step of >= 3 px); once
        // engaged, the whole displacement since touch-down feeds
        // through, so a deliberate 60 px drag still turns ~0.42 rad.
        const stepX = t.clientX - joy.lastX;
        const stepY = t.clientY - joy.lastY;
        let feedX = 0;
        let feedY = 0;
        if (joy.lookEngaged) {
          feedX = stepX;
          feedY = stepY;
        } else {
          const fromStartX = t.clientX - joy.lookStartX;
          const fromStartY = t.clientY - joy.lookStartY;
          if (Math.hypot(fromStartX, fromStartY) >= LOOK_DEADZONE_PX
            && Math.hypot(stepX, stepY) >= LOOK_MIN_STEP_PX) {
            joy.lookEngaged = true;
            feedX = fromStartX;
            feedY = fromStartY;
          }
        }
        look.dx += feedX * 2.2 * lookScale;
        look.dy += feedY * 2.2 * lookScale;
        joy.lastX = t.clientX;
        joy.lastY = t.clientY;
        e.preventDefault();
      }
    }
  }
  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        joy.active = false; joy.id = -1; joy.x = 0; joy.y = 0; joy.mag = 0;
        joyKnob.style.transform = 'translate(0px, 0px)';
      }
      if (t.identifier === joy.lookId) {
        joy.lookId = -1;
        joy.lookEngaged = false;
      }
    }
  }
  // P6: non-passive so onTouchStart's preventDefault actually runs —
  // with a passive listener the browser ignores it and keeps firing
  // compat mouse events for every canvas/joystick touch.
  document.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);

  // ---- Per-frame state ----
  function moveVector() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (joy.active) {
      x += joy.x;
      y -= joy.y; // joystick up = forward
    }
    // P6 dead zone (per axis, after the keyboard + joystick sum):
    // a resting thumb reads 0.05–0.2, which used to creep the player
    // and steer the car. Full deflection still reads 1, so keyboard
    // and deliberate full pushes are unchanged.
    x = deadzone(x);
    y = deadzone(y);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  // P6: steering response curve (player only — traffic/police drive
  // physics directly, never through here). Small inputs near the dead
  // zone are gentle lane-keeping nudges; full lock is untouched.
  // dx=0.2 now steers ~4 deg/s at 150 km/h instead of 24.
  function shapeSteer(s) {
    const a = Math.abs(s);
    return Math.sign(s) * a * (0.4 + 0.6 * a);
  }

  function driveControls() {
    // Driving shares the same axes: joystick / WASD steer + throttle.
    const mv = moveVector();
    return {
      throttle: mv.y,
      steer: shapeSteer(mv.x),
      handbrake: keys.has('Space') || touch.brake,
      horn: keys.has('KeyH'),
      lights: keys.has('KeyL'),
    };
  }

  /** Edge-triggered actions, consumed once per call. */
  function takeActions() {
    const out = new Set();
    const take = (code) => {
      if (pressed.has(code)) { pressed.delete(code); return true; }
      return false;
    };
    for (const [code, name] of KEY_ACTIONS) {
      if (take(code)) out.add(name);
    }
    if (take('KeyF') || touch.interact) { out.add('interact'); touch.interact = false; }
    if (take('Escape') || take('KeyP')) out.add('pause');
    if (touch.action) { out.add('enter'); touch.action = false; }
    for (let i = 1; i <= 5; i++) {
      if (take(`Digit${i}`)) out.add(`weapon${i}`);
    }
    pressed.clear();
    return out;
  }

  return {
    keys,
    get moveX() { return moveVector().x; },
    get moveY() { return moveVector().y; },
    get sprint() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.run;
    },
    get fire() { return mouseDown || touch.fire; },
    get aim() { return mouseAim || touch.aim; },
    get handbrake() { return keys.has('Space') || touch.brake; },
    get horn() { return keys.has('KeyH'); },
    driveControls,
    takeActions,
    /** Consume accumulated look deltas (mouse / touch drag). */
    takeLook() {
      const d = { dx: look.dx, dy: look.dy };
      look.dx = 0;
      look.dy = 0;
      return d;
    },
    setLookScale(v) { lookScale = Math.max(0.3, Math.min(2.5, v)); },
    isTouch() {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },
  };
}
