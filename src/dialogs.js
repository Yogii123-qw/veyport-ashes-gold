// Story dialog: procedural portraits drawn from each character's
// colors, typewriter text with a tick, choices that change the world,
// and a log so any line can be re-read from the pause menu. While a
// conversation runs, the world waits — nobody shoots mid-sentence.

import { CHARACTERS } from '../data/missionsData.js';
import { formatClock } from './utils.js';

const CHARS_PER_SECOND = 45;

export function createDialogs(game) {
  const $ = (id) => document.getElementById(id);
  const root = $('dialog');
  const speakerEl = $('speaker');
  const textEl = $('dialogText');
  const choicesEl = $('dialogChoices');
  const portrait = $('portraitCanvas');
  const pctx = portrait.getContext('2d');

  let lines = [];
  let lineIndex = 0;
  let shown = 0;
  let typing = false;
  let onDone = null;
  let open = false;
  let choicesOpen = false;
  let choiceKeyListener = null;
  const log = [];

  function drawPortrait(who) {
    const character = CHARACTERS[who] || CHARACTERS.rook;
    const width = 96;
    const height = 96;
    pctx.clearRect(0, 0, width, height);
    const gradient = pctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, character.coat);
    gradient.addColorStop(1, '#101820');
    pctx.fillStyle = gradient;
    pctx.fillRect(0, 0, width, height);
    // Shoulders.
    pctx.fillStyle = character.coat;
    pctx.beginPath();
    pctx.moveTo(8, 96);
    pctx.quadraticCurveTo(48, 58, 88, 96);
    pctx.closePath();
    pctx.fill();
    // Neck + head.
    pctx.fillStyle = character.skin;
    pctx.fillRect(40, 52, 16, 14);
    pctx.beginPath();
    pctx.ellipse(48, 40, 19, 23, 0, 0, Math.PI * 2);
    pctx.fill();
    // Hair by character.
    pctx.fillStyle = character.hair;
    if (who === 'ilex') {
      pctx.beginPath();
      pctx.ellipse(48, 26, 21, 14, 0, Math.PI, Math.PI * 2);
      pctx.fill();
      pctx.fillRect(26, 26, 5, 34);
      pctx.fillRect(65, 26, 5, 34);
    } else if (who === 'pell') {
      // Police cap.
      pctx.fillStyle = '#22303f';
      pctx.fillRect(28, 16, 40, 10);
      pctx.fillRect(24, 24, 48, 5);
      pctx.fillStyle = '#ffc35c';
      pctx.fillRect(44, 18, 8, 6);
    } else if (who === 'vex') {
      pctx.beginPath();
      pctx.moveTo(29, 34);
      pctx.quadraticCurveTo(34, 12, 48, 16);
      pctx.quadraticCurveTo(64, 12, 67, 34);
      pctx.quadraticCurveTo(56, 22, 48, 24);
      pctx.quadraticCurveTo(40, 22, 29, 34);
      pctx.fill();
    } else if (who === 'drayke') {
      pctx.beginPath();
      pctx.ellipse(48, 22, 19, 10, 0, Math.PI, Math.PI * 2);
      pctx.fill();
      pctx.fillRect(30, 52, 36, 8);
    } else {
      pctx.beginPath();
      pctx.ellipse(48, 22, 19, 11, 0, Math.PI, Math.PI * 2);
      pctx.fill();
    }
    // Eyes.
    pctx.fillStyle = '#1c1c1c';
    pctx.fillRect(37, 38, 5, 3);
    pctx.fillRect(54, 38, 5, 3);
    // Mouth.
    pctx.strokeStyle = 'rgba(0,0,0,0.55)';
    pctx.lineWidth = 2;
    pctx.beginPath();
    pctx.moveTo(41, 53);
    pctx.lineTo(55, 53);
    pctx.stroke();
    if (who === 'vex') {
      // Scar over the left brow.
      pctx.strokeStyle = 'rgba(120,20,20,0.8)';
      pctx.beginPath();
      pctx.moveTo(36, 30);
      pctx.lineTo(42, 40);
      pctx.stroke();
    }
    if (who === 'ilex') {
      pctx.fillStyle = '#ffc35c';
      pctx.beginPath();
      pctx.arc(28, 48, 2.5, 0, Math.PI * 2);
      pctx.arc(68, 48, 2.5, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  function currentText() {
    const line = lines[lineIndex];
    return line[game.settings.language] || line.en;
  }

  function showLine() {
    const line = lines[lineIndex];
    const character = CHARACTERS[line.who] || CHARACTERS.rook;
    speakerEl.textContent = character.name[game.settings.language] || character.name.en;
    drawPortrait(line.who);
    shown = 0;
    typing = true;
    textEl.textContent = '';
    choicesEl.innerHTML = '';
  }

  function play(nextLines, done) {
    if (choiceKeyListener) {
      document.removeEventListener('keydown', choiceKeyListener);
      choiceKeyListener = null;
    }
    lines = nextLines;
    lineIndex = 0;
    onDone = done || null;
    open = true;
    choicesOpen = false;
    root.classList.remove('hidden');
    game.dialogOpen = true;
    showLine();
  }

  function close() {
    open = false;
    choicesOpen = false;
    root.classList.add('hidden');
    game.dialogOpen = false;
    const done = onDone;
    onDone = null;
    if (done) done();
  }

  function advance() {
    if (!open || choicesOpen) return;
    const full = currentText();
    if (typing) {
      shown = full.length;
      textEl.textContent = full;
      typing = false;
      return;
    }
    logLine(lines[lineIndex].who, full);
    lineIndex += 1;
    if (lineIndex >= lines.length) {
      close();
    } else {
      showLine();
    }
  }

  function showChoices(choices, onPick) {
    // Choices arrive after the lines finish, which closes the dialog:
    // re-open it, or the buttons render inside a hidden box and the
    // player is soft-locked with no visible way forward.
    open = true;
    game.dialogOpen = true;
    root.classList.remove('hidden');
    choicesOpen = true;
    choicesEl.innerHTML = '';
    const buttons = [];
    // Number keys 1-9 pick a choice, so keyboard players never need
    // the mouse mid-conversation. The listener removes itself the
    // moment the choice is made or the dialog closes.
    const onKey = (event) => {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < buttons.length) {
        event.preventDefault();
        buttons[index].click();
      }
    };
    choiceKeyListener = onKey;
    document.addEventListener('keydown', onKey);
    for (const [i, choice] of choices.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choiceBtn';
      button.textContent = `${i + 1}. ${choice.label[game.settings.language] || choice.label.en}`;
      button.addEventListener('click', () => {
        document.removeEventListener('keydown', onKey);
        choiceKeyListener = null;
        game.audio.playSfx('click', game.player.x, game.player.z);
        choicesEl.innerHTML = '';
        choicesOpen = false;
        close();
        onPick(choice);
      });
      buttons.push(button);
      choicesEl.appendChild(button);
    }
  }

  function logLine(who, text) {
    log.unshift({ who, text, time: formatClock(game.weather.hours) });
    if (log.length > 60) log.length = 60;
  }

  function update(dt) {
    if (!open || !typing) return;
    const full = currentText();
    const next = shown + CHARS_PER_SECOND * dt;
    if (Math.floor(next / 2) !== Math.floor(shown / 2)) {
      game.audio.playSfx('type', game.player.x, game.player.z);
    }
    shown = Math.min(full.length, next);
    textEl.textContent = full.slice(0, Math.floor(shown));
    if (shown >= full.length) typing = false;
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('.choiceBtn')) return;
    advance();
  });

  return {
    play, advance, showChoices, logLine, update,
    get isOpen() { return open; },
    get entries() { return log; },
    get typing() { return typing; },
  };
}
