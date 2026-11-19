// input.js - keyboard, mouse and touch input for Veyport.
// Dead zones are the point: a resting thumb must not steer the car (P6) and
// a brushing thumb must not spin the camera (P4). Compat mouse events that
// phones synthesize from touches are blocked twice over (P6).

export const JOY_DEAD = 0.12;
export const JOY_RADIUS_PX = 59; // half the 118 px visible joyBase: the
// stick's deflection radius. The old code divided by half the ZONE width
// (82 px) on both axes although the zone is 164x354 px, so pressing the
// visible knob already read joy.y = +0.66 (hard reverse) and pushing up
// barely registered (R4-D, Monch's phone 01:27 WIB 20 Nov).
export const LOOK_DEAD_PX = 6;
export const LOOK_MIN_STEP_PX = 3;
export const LOOK_SENS_TOUCH = 0.007; // rad per px: 60 px drag = ~0.42 rad
export const LOOK_SENS_MOUSE = 0.0035;

function deadRescale(v, dead) {
  const a = Math.abs(v);
  if (a < dead) return 0;
  return Math.sign(v) * ((a - dead) / (1 - dead));
}

export class GameInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    // Touch hardware: show the stick + touch buttons from load (R4-D).
    // The old code only added .touch after a touch landed on the canvas
    // or the zone, so a first tap on MULAI left the stick hidden and the
    // next thumb press fell through to the canvas as a look-drag.
    this.isTouch = 'ontouchstart' in window
      || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (this.isTouch) document.body.classList.add('touch');
    window.addEventListener('touchstart', () => {
      this.isTouch = true;
      document.body.classList.add('touch');
    }, { passive: true });
    // Joystick (left thumb). Floating: its origin is the touchstart
    // point inside the zone (ox/oy), radius JOY_RADIUS_PX, so pressing
    // the visible knob reads exactly zero at rest (R4-D).
    this.joy = { active: false, id: -1, x: 0, y: 0, ox: 0, oy: 0 };
    // Look drag (right thumb / mouse drag on empty screen).
    this.look = { active: false, id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, engaged: false, dx: 0, dy: 0 };
    this.mouseLook = { active: false, lastX: 0, lastY: 0 };
    // Held buttons.
    this.runHeld = false;
    this.fireHeld = false;
    this.brakeHeld = false;
    this.actionQueued = false;
    this.pauseQueued = false;
    this.mapQueued = false;
    this.reloadQueued = false;
    this.weaponQueued = null;
    this._bindKeys();
    this._bindTouch(canvas);
    this._bindMouse(canvas);
    this._bindButtons();
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') this.actionQueued = true;
      if (e.code === 'KeyR') this.reloadQueued = true;
      if (e.code === 'KeyM') this.mapQueued = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseQueued = true;
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 5) this.weaponQueued = n;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _joyEl() {
    return document.getElementById('joyKnob');
  }

  _joyBaseEl() {
    return document.getElementById('joyBase');
  }

  // Move the visible base so its centre sits on the floating origin;
  // clear the inline style to send it back to its CSS home on release.
  _placeBase(x, y) {
    const base = this._joyBaseEl();
    if (!base) return;
    base.style.left = `${x - JOY_RADIUS_PX}px`;
    base.style.top = `${y - JOY_RADIUS_PX}px`;
    base.style.bottom = 'auto';
  }

  _resetBase() {
    const base = this._joyBaseEl();
    if (!base) return;
    base.style.left = '';
    base.style.top = '';
    base.style.bottom = '';
  }

  _bindTouch(canvas) {
    const zone = document.getElementById('joyZone');
    const onDown = (e) => {
      this.isTouch = true;
      document.body.classList.add('touch');
      for (const t of e.changedTouches) {
        const r = zone.getBoundingClientRect();
        if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom && !this.joy.active) {
          this.joy.active = true;
          this.joy.id = t.identifier;
          // Floating origin = where the thumb landed, clamped so the
          // 118 px base stays on screen.
          this.joy.ox = Math.max(JOY_RADIUS_PX, Math.min(window.innerWidth - JOY_RADIUS_PX, t.clientX));
          this.joy.oy = Math.max(JOY_RADIUS_PX, Math.min(window.innerHeight - JOY_RADIUS_PX, t.clientY));
          this._placeBase(this.joy.ox, this.joy.oy);
          this._joyMove(t);
          e.preventDefault();
        }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) {
          this._joyMove(t);
          e.preventDefault();
        }
      }
    };
    const onUp = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) {
          this.joy.active = false;
          this.joy.x = 0; this.joy.y = 0;
          const knob = this._joyEl();
          if (knob) knob.style.transform = 'translate(-50%, -50%)';
          this._resetBase();
        }
      }
    };
    zone.addEventListener('touchstart', onDown, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onUp);
    zone.addEventListener('touchcancel', onUp);

    // Look drag: touches on the canvas that are NOT on the joystick zone
    // and NOT on a button. Dead zone + engagement gate (P4).
    canvas.addEventListener('touchstart', (e) => {
      this.isTouch = true;
      document.body.classList.add('touch');
      for (const t of e.changedTouches) {
        if (this.look.active) continue;
        this.look.active = true;
        this.look.id = t.identifier;
        this.look.startX = t.clientX; this.look.startY = t.clientY;
        this.look.lastX = t.clientX; this.look.lastY = t.clientY;
        this.look.engaged = false;
      }
      // Layer 1 of the compat-mouse guard: non-passive + preventDefault
      // stops the platform synthesizing mouse events from this touch.
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (!this.look.active || t.identifier !== this.look.id) continue;
        const dx = t.clientX - this.look.lastX;
        const dy = t.clientY - this.look.lastY;
        this.look.lastX = t.clientX; this.look.lastY = t.clientY;
        const fromStart = Math.hypot(t.clientX - this.look.startX, t.clientY - this.look.startY);
        if (!this.look.engaged) {
          // Engagement gate: ignore until one step moves >= 3 px AND the
          // total drift passed the 6 px dead zone.
          if (fromStart < LOOK_DEAD_PX) continue;
          if (Math.hypot(dx, dy) < LOOK_MIN_STEP_PX) continue;
          this.look.engaged = true;
        }
        this.look.dx += dx * LOOK_SENS_TOUCH;
        this.look.dy += dy * LOOK_SENS_TOUCH;
      }
      e.preventDefault();
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this.look.active && t.identifier === this.look.id) {
          this.look.active = false;
          this.look.engaged = false;
        }
      }
    };
    canvas.addEventListener('touchend', lookEnd);
    canvas.addEventListener('touchcancel', lookEnd);
  }

  // Deflection from the floating origin (touchstart point), radius
  // JOY_RADIUS_PX on both axes. Pressing the knob still reads (0, 0).
  _joyMove(t) {
    const radius = JOY_RADIUS_PX;
    let dx = (t.clientX - this.joy.ox) / radius;
    let dy = (t.clientY - this.joy.oy) / radius;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.joy.x = dx;
    this.joy.y = dy;
    const knob = this._joyEl();
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
  }

  _bindMouse(canvas) {
    canvas.addEventListener('mousedown', (e) => {
      // Layer 2 of the compat-mouse guard: a mouse event synthesized from
      // a touch carries firesTouchEvents; never let it steer the camera.
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.mouseLook.active = true;
      this.mouseLook.lastX = e.clientX;
      this.mouseLook.lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseLook.active) return;
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.look.dx += (e.clientX - this.mouseLook.lastX) * LOOK_SENS_MOUSE;
      this.look.dy += (e.clientY - this.mouseLook.lastY) * LOOK_SENS_MOUSE;
      this.mouseLook.lastX = e.clientX;
      this.mouseLook.lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.mouseLook.active = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _holdButton(id, on, off) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = (e) => { e.preventDefault(); on(); };
    const end = (e) => { e.preventDefault(); off(); };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', off);
  }

  _bindButtons() {
    this._holdButton('btnRun', () => { this.runHeld = true; }, () => { this.runHeld = false; });
    this._holdButton('btnFire', () => { this.fireHeld = true; }, () => { this.fireHeld = false; });
    this._holdButton('btnBrake', () => { this.brakeHeld = true; }, () => { this.brakeHeld = false; });
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    };
    tap('btnAction', () => { this.actionQueued = true; });
    tap('btnMap', () => { this.mapQueued = true; });
    tap('btnPause', () => { this.pauseQueued = true; });
    document.querySelectorAll('[data-weapon]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.weaponQueued = Number(el.getAttribute('data-weapon'));
      });
    });
  }

  // Movement vector in screen space: x right, y up (joystick up = +y).
  // Keyboard (WASD/arrows) or joystick, per-axis dead zone + rescale.
  moveVector() {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.joy.active) {
      x += this.joy.x;
      y += -this.joy.y; // screen down is +y; up is forward
    }
    x = deadRescale(Math.max(-1, Math.min(1, x)), JOY_DEAD);
    y = deadRescale(Math.max(-1, Math.min(1, y)), JOY_DEAD);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  get run() {
    return this.runHeld || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  // Driving controls from the same stick: steer (shaped curve so small
  // inputs are gentle nudges) + throttle/brake. Steer sign: stick right
  // (mv.x > 0) must turn the car RIGHT on screen. With the chase camera
  // behind the car, a screen-right turn means heading DECREASES (nose
  // toward screen right = (-cos h, sin h)), while stepDrive adds
  // steer to heading, so the input is negated here. Measured before the
  // fix: holding D swung heading +68.9 deg (a LEFT turn on screen).
  driveControls() {
    const mv = this.moveVector();
    const steer = -Math.sign(mv.x) * Math.pow(Math.abs(mv.x), 1.35);
    let throttle = 0, brake = 0;
    if (mv.y > 0) throttle = mv.y;
    else brake = -mv.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle = 1;
    if (this.brakeHeld || this.keys.has('Space')) brake = 1;
    return { steer, throttle, brake, handbrake: this.keys.has('Space') || this.brakeHeld };
  }

  consumeLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return out;
  }

  takeAction() {
    const v = this.actionQueued;
    this.actionQueued = false;
    return v;
  }

  takePause() {
    const v = this.pauseQueued;
    this.pauseQueued = false;
    return v;
  }

  takeMap() {
    const v = this.mapQueued;
    this.mapQueued = false;
    return v;
  }

  takeReload() {
    const v = this.reloadQueued;
    this.reloadQueued = false;
    return v;
  }

  takeWeapon() {
    const v = this.weaponQueued;
    this.weaponQueued = null;
    return v;
  }
}
