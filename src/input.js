// All input in one place: keyboard, mouse and touch. The loop reads held
// state every step and takes one-shot presses once, so a press between two
// frames is never lost and never counted twice. Touch controls are part of
// this same build: the joystick, action buttons and camera drag feed the
// same axes the keyboard does.

export function createInput(game) {
  const keys = new Set();
  const pressed = new Set();
  let lookDX = 0;
  let lookDY = 0;
  let wheelDelta = 0;
  let fireHeld = false;
  let aimHeld = false;
  let lastTouchAt = 0;
  let mouseX = 0;
  let mouseY = 0;
  let dragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  const joy = { x: 0, y: 0, active: false };
  const touchHeld = new Set();
  let touchSeen = false;

  const canvas = game.canvas;

  function isTypingTarget(event) {
    const tag = event.target && event.target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  function press(action) {
    pressed.add(action);
  }

  const KEY_ACTIONS = {
    KeyE: 'enter', KeyF: 'interact', KeyR: 'reload', KeyP: 'pause', Escape: 'pause',
    KeyM: 'map', KeyH: 'horn', KeyL: 'lights', KeyQ: 'medkit', Space: 'jump',
    Enter: 'dialogAdvance', Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3',
    Digit4: 'weapon4', Digit5: 'weapon5',
  };

  window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event)) return;
    keys.add(event.code);
    if (!event.repeat && KEY_ACTIONS[event.code]) {
      press(KEY_ACTIONS[event.code]);
      if (event.code === 'Space' || event.code === 'Enter') event.preventDefault();
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    fireHeld = false;
    aimHeld = false;
    touchHeld.clear();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.button === 0) fireHeld = true;
    if (event.button === 2) aimHeld = true;
    dragging = true;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
  });
  // Mouse buttons, per button: pointerdown fires only for the FIRST
  // button held, so aiming (right) and then pressing fire (left) never
  // produced a second pointerdown and the gun never fired while aiming.
  // mousedown fires for every button press, in either order. Touch
  // drags fire a compatibility mousedown afterwards; the guard below
  // (stamped by the touch look handler) swallows those.
  canvas.addEventListener('mousedown', (event) => {
    if (performance.now() - lastTouchAt < 500) return;
    if (event.button === 0) fireHeld = true;
    if (event.button === 2) aimHeld = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) fireHeld = false;
    if (event.button === 2) aimHeld = false;
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) fireHeld = false;
    if (event.button === 2) aimHeld = false;
    dragging = false;
  });
  window.addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (!dragging || event.pointerType === 'touch') return;
    const sens = game.settings.sensitivity;
    lookDX += (event.clientX - lastDragX) * 0.0032 * sens;
    lookDY += (event.clientY - lastDragY) * 0.0028 * sens;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    if (game.ui.isOverMinimap(event.clientX, event.clientY)) return;
    wheelDelta += event.deltaY > 0 ? 1 : -1;
    event.preventDefault();
  }, { passive: false });

  // ---- Touch: joystick, buttons, camera drag on empty space ----
  const joyEl = document.getElementById('joy');
  const knobEl = document.getElementById('joyKnob');
  let joyPointer = null;
  function joyMove(clientX, clientY) {
    const rect = joyEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (clientX - cx) / (rect.width / 2);
    let dy = (clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    joy.x = dx;
    joy.y = dy;
    knobEl.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
  }
  joyEl.addEventListener('pointerdown', (event) => {
    touchSeen = true;
    joyPointer = event.pointerId;
    joy.active = true;
    joyEl.setPointerCapture(event.pointerId);
    joyMove(event.clientX, event.clientY);
    event.preventDefault();
  });
  joyEl.addEventListener('pointermove', (event) => {
    if (event.pointerId === joyPointer) joyMove(event.clientX, event.clientY);
  });
  function joyEnd(event) {
    if (event.pointerId !== joyPointer) return;
    joyPointer = null;
    joy.active = false;
    joy.x = 0;
    joy.y = 0;
    knobEl.style.transform = 'translate(0px, 0px)';
  }
  joyEl.addEventListener('pointerup', joyEnd);
  joyEl.addEventListener('pointercancel', joyEnd);

  function bindTouchButton(id, down, up) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (event) => {
      touchSeen = true;
      el.classList.add('held');
      down();
      event.preventDefault();
    });
    const release = () => {
      el.classList.remove('held');
      if (up) up();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  }
  bindTouchButton('btnFire', () => { fireHeld = true; }, () => { fireHeld = false; });
  bindTouchButton('btnAction', () => press('enter'));
  bindTouchButton('btnInteract', () => press('interact'));
  bindTouchButton('btnBrake', () => { touchHeld.add('handbrake'); }, () => { touchHeld.delete('handbrake'); });
  bindTouchButton('btnRun', () => { touchHeld.add('sprint'); }, () => { touchHeld.delete('sprint'); });
  bindTouchButton('btnMapT', () => press('map'));
  bindTouchButton('btnPauseT', () => press('pause'));

  // Camera drag: a touch that starts on the canvas (not on a control)
  // orbits the camera, like dragging with the mouse.
  let camPointer = null;
  let camLastX = 0;
  let camLastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    touchSeen = true;
    lastTouchAt = performance.now();
    camPointer = event.pointerId;
    camLastX = event.clientX;
    camLastY = event.clientY;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || event.pointerId !== camPointer) return;
    const sens = game.settings.sensitivity;
    lookDX += (event.clientX - camLastX) * 0.005 * sens;
    lookDY += (event.clientY - camLastY) * 0.004 * sens;
    camLastX = event.clientX;
    camLastY = event.clientY;
  });
  function camEnd(event) {
    if (event.pointerId === camPointer) camPointer = null;
  }
  canvas.addEventListener('pointerup', camEnd);
  canvas.addEventListener('pointercancel', camEnd);

  return {
    /** Move axes: x = strafe right, y = forward. Keyboard + joystick merged. */
    axis() {
      let x = 0;
      let y = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      if (joy.active) {
        x += joy.x;
        y += -joy.y;
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return { x, y };
    },
    throttle() {
      let t = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) t += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) t -= 1;
      if (joy.active) {
        const forward = -joy.y;
        // Full-throttle detent: pushing the stick 75%+ forward counts
        // as full throttle, so touch drivers can actually reach a
        // car's top speed instead of hovering at partial throttle.
        t += forward >= 0.75 ? 1 : forward;
      }
      return Math.max(-1, Math.min(1, t));
    },
    steer() {
      let s = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
      if (joy.active) s += joy.x;
      return Math.max(-1, Math.min(1, s));
    },
    sprint() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight') || touchHeld.has('sprint');
    },
    handbrake() {
      return keys.has('Space') || touchHeld.has('handbrake');
    },
    fireHeld() { return fireHeld; },
    aimHeld() { return aimHeld; },
    mouse() { return { x: mouseX, y: mouseY }; },
    takeLookDelta() {
      const d = { dx: lookDX, dy: lookDY };
      lookDX = 0;
      lookDY = 0;
      return d;
    },
    takeWheel() {
      const w = wheelDelta;
      wheelDelta = 0;
      return w;
    },
    takePressed() {
      const taken = new Set(pressed);
      pressed.clear();
      return taken;
    },
    peekPressed(action) {
      return pressed.has(action);
    },
    clearPressed() {
      pressed.clear();
    },
    touchSeen() { return touchSeen; },
    resetTransient() {
      fireHeld = false;
      aimHeld = false;
      lookDX = 0;
      lookDY = 0;
      wheelDelta = 0;
      pressed.clear();
    },
  };
}
