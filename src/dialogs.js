// dialogs.js — story dialogs with typewriter text and real choices.
//
// A dialog is a portrait, a name, and lines that type out letter by
// letter. Choices are real buttons AND keyboard-selectable, and a dialog
// can never soft-lock the game: every choice list has a marked default,
// Esc/Enter takes the default, and after 25 seconds the default is taken
// automatically with an honest notice. The log keeps every line so the
// player can re-read the story. Portraits are procedural canvas faces —
// no image files, no network.

import { pickText } from './langData.js';

const CHOICE_TIMEOUT = 25; // seconds before the default is auto-taken

/** A procedural portrait: coloured shoulders + a face + an initial. */
function drawPortrait(canvas, name, hue) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = `hsl(${hue}, 35%, 22%)`;
  g.fillRect(0, 0, w, h);
  // Shoulders.
  g.fillStyle = `hsl(${hue}, 45%, 38%)`;
  g.beginPath();
  g.moveTo(0, h);
  g.quadraticCurveTo(w / 2, h * 0.42, w, h);
  g.closePath();
  g.fill();
  // Face.
  g.fillStyle = '#c89878';
  g.beginPath();
  g.arc(w / 2, h * 0.42, w * 0.26, 0, Math.PI * 2);
  g.fill();
  // Hair.
  g.fillStyle = `hsl(${hue}, 30%, 14%)`;
  g.beginPath();
  g.arc(w / 2, h * 0.34, w * 0.26, Math.PI, 0);
  g.fill();
  // Eyes.
  g.fillStyle = '#111';
  g.beginPath(); g.arc(w / 2 - w * 0.1, h * 0.42, 3, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(w / 2 + w * 0.1, h * 0.42, 3, 0, Math.PI * 2); g.fill();
  // Initial.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `bold ${Math.round(w * 0.2)}px sans-serif`;
  g.textAlign = 'center';
  g.fillText((name || '?')[0].toUpperCase(), w / 2, h * 0.94);
}

export function createDialogs(deps = {}) {
  const boxEl = document.getElementById('dialogBox');
  const nameEl = document.getElementById('dialogName');
  const textEl = document.getElementById('dialogText');
  const choicesEl = document.getElementById('dialogChoices');
  const skipEl = document.getElementById('dialogSkip');
  const portraitEl = document.getElementById('dialogPortrait');
  const audio = deps.audio || null;
  const lang = () => deps.getLang ? deps.getLang() : 'id';

  const log = [];
  let open = false;
  let lines = [];
  let lineIdx = 0;
  let charIdx = 0;
  let typing = false;
  let typeTimer = 0;
  let currentChoices = null;
  let choiceTimer = 0;
  let onDone = null;
  let onChoice = null;

  function showLine() {
    const line = lines[lineIdx];
    nameEl.textContent = pickText(line.speaker, lang()) || line.speaker;
    if (line.portrait) drawPortrait(portraitEl, pickText(line.speaker, lang()), line.portrait);
    textEl.textContent = '';
    charIdx = 0;
    typing = true;
    typeTimer = 0;
  }

  /** Show a dialog. `opts.lines` is [{speaker, text, portrait}];
   *  `opts.choices` is [{label, value, default}] shown after the last
   *  line; `opts.onChoice(value)` fires for the picked value. */
  function show(opts) {
    lines = opts.lines || [];
    lineIdx = 0;
    onDone = opts.onDone || null;
    onChoice = opts.onChoice || null;
    currentChoices = null;
    choiceTimer = 0;
    pendingChoices = opts.choices || pendingChoices || null;
    choicesEl.innerHTML = '';
    choicesEl.classList.add('hidden');
    boxEl.classList.remove('hidden');
    open = true;
    if (lines.length) showLine();
    else finishLines();
  }

  function finishLines() {
    typing = false;
    if (currentChoices === null && pendingChoices) {
      showChoices(pendingChoices);
      pendingChoices = null;
      return;
    }
    close();
  }

  let pendingChoices = null;

  function showChoices(choices) {
    currentChoices = choices;
    choiceTimer = CHOICE_TIMEOUT;
    choicesEl.innerHTML = '';
    choicesEl.classList.remove('hidden');
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'choiceBtn' + (c.default ? ' default' : '');
      b.textContent = pickText(c.label, lang());
      b.addEventListener('click', () => pick(i));
      choicesEl.appendChild(b);
    });
  }

  function pick(i) {
    const c = currentChoices && currentChoices[i];
    if (!c) return;
    const value = c.value;
    currentChoices = null;
    choicesEl.classList.add('hidden');
    close();
    if (onChoice) onChoice(value);
  }

  function pickDefault() {
    if (!currentChoices) return;
    const idx = currentChoices.findIndex((c) => c.default);
    pick(idx >= 0 ? idx : 0);
  }

  function close() {
    open = false;
    boxEl.classList.add('hidden');
    if (onDone) {
      const fn = onDone;
      onDone = null;
      fn();
    }
  }

  /** Advance: finish typing the line, or move to the next one. */
  function advance() {
    if (!open) return;
    if (typing) {
      // Finish the line instantly.
      textEl.textContent = pickText(lines[lineIdx].text, lang());
      typing = false;
      return;
    }
    const line = lines[lineIdx];
    if (line) log.push({ speaker: pickText(line.speaker, lang()), text: pickText(line.text, lang()) });
    lineIdx += 1;
    if (lineIdx < lines.length) {
      showLine();
    } else {
      finishLines();
    }
  }

  function update(dt) {
    if (!open) return;
    if (typing) {
      typeTimer += dt;
      const line = lines[lineIdx];
      const full = pickText(line.text, lang());
      const want = Math.floor(typeTimer / 0.018);
      if (want > charIdx) {
        charIdx = Math.min(full.length, want);
        textEl.textContent = full.slice(0, charIdx);
        if (audio && charIdx % 3 === 0) audio.play('type');
        if (charIdx >= full.length) typing = false;
      }
    }
    if (currentChoices) {
      choiceTimer -= dt;
      if (choiceTimer <= 0) {
        // Anti-soft-lock: the default is taken, honestly announced.
        if (deps.notify) deps.notify('choiceTimeout');
        pickDefault();
      }
    }
  }

  // Click the box to advance; skip jumps past the typewriter.
  boxEl.addEventListener('click', (e) => {
    if (e.target.closest('#dialogChoices') || e.target.closest('button')) return;
    advance();
  });
  skipEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentChoices) { pickDefault(); return; }
    // Skip the rest of the lines, straight to the choices (if any).
    while (lineIdx < lines.length - 1) lineIdx += 1;
    if (lineIdx < lines.length) {
      const line = lines[lineIdx];
      log.push({ speaker: pickText(line.speaker, lang()), text: pickText(line.text, lang()) });
    }
    lineIdx = lines.length;
    finishLines();
  });
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.code === 'Escape' || e.code === 'Enter') {
      if (currentChoices) pickDefault();
      else advance();
    }
    if (currentChoices && e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5)) - 1;
      if (currentChoices[n]) pick(n);
    }
  });

  return {
    show,
    advance,
    close,
    update,
    pickDefault,
    get isOpen() { return open; },
    get log() { return log; },
    /** Queue choices to show after the lines finish. */
    withChoices(choices) {
      pendingChoices = choices;
    },
  };
}
