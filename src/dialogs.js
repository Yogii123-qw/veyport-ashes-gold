// dialogs.js - story dialogs: typewriter text, speaker portraits, choices.
// The world freezes while a dialog is open (player, traffic, missions),
// but the wanted flow timer keeps running behind it (P5): the dialog
// system never blocks wanted.tickFlow, it only gates world motion.
// The box is created in code so boot.js does not need new HTML ids.

const TYPE_SPEED = 34; // chars per second
const SPEAKER_COLORS = {
  Ilex: '#ff2a6b',
  Rook: '#f5c542',
  Drayke: '#7ee081',
  Vex: '#c03028',
  Pell: '#7aa8ff',
  Cole: '#b8b8b8',
  System: '#9fb4c4',
};

export class DialogSys {
  constructor() {
    this.box = document.createElement('div');
    this.box.id = 'dialogBox';
    this.box.style.display = 'none';
    this.box.innerHTML = '<div id="dlgSpeaker"></div><div id="dlgText"></div><div id="dlgChoices"></div><div id="dlgHint"></div>';
    document.body.appendChild(this.box);
    this.speakerEl = this.box.querySelector('#dlgSpeaker');
    this.textEl = this.box.querySelector('#dlgText');
    this.choicesEl = this.box.querySelector('#dlgChoices');
    this.hintEl = this.box.querySelector('#dlgHint');
    this.queue = [];
    this.current = null;
    this.onDone = null;
    this.charIdx = 0;
    this.charAcc = 0;
    this.waitingChoice = false;
    this.log = [];
    this.box.addEventListener('click', () => this.advance());
  }

  get isOpen() {
    return this.current !== null || this.queue.length > 0;
  }

  // lines: [[speaker, text], ...] or [{speaker, text, choices:[{id,label}]}]
  open(lines, onDone) {
    if (!lines || lines.length === 0) {
      if (onDone) onDone(null);
      return;
    }
    this.queue = lines.slice();
    this.onDone = onDone || null;
    this.nextLine();
  }

  openSingle(speaker, text, onDone) {
    this.open([[speaker, text]], onDone);
  }

  nextLine() {
    this.current = this.queue.shift() || null;
    this.waitingChoice = false;
    if (!this.current) {
      this.box.style.display = 'none';
      const cb = this.onDone;
      this.onDone = null;
      if (cb) cb(null);
      return;
    }
    const [speaker, text, opts] = this.current;
    this.speakerEl.textContent = speaker;
    this.speakerEl.style.color = SPEAKER_COLORS[speaker] || '#f2ede4';
    this.textEl.textContent = '';
    this.choicesEl.innerHTML = '';
    this.hintEl.textContent = '';
    this.charIdx = 0;
    this.charAcc = 0;
    this.fullText = text;
    this.lineOpts = opts || null;
    this.box.style.display = 'block';
    this.log.push({ speaker, text });
    if (this.log.length > 40) this.log.shift();
  }

  // Click / tap: finish typing first, then go to the next line (or show
  // the choice buttons when the line carries choices).
  advance() {
    if (!this.current) return;
    if (this.waitingChoice) return;
    if (this.charIdx < this.fullText.length) {
      this.charIdx = this.fullText.length;
      this.textEl.textContent = this.fullText;
      this.showChoicesIfAny();
      return;
    }
    if (this.lineOpts && this.lineOpts.choices) return; // waiting on a button
    this.nextLine();
  }

  showChoicesIfAny() {
    const opts = this.lineOpts;
    if (!opts || !opts.choices) return;
    this.waitingChoice = true;
    this.hintEl.textContent = '';
    for (const c of opts.choices) {
      const b = document.createElement('button');
      b.className = 'dlgChoice';
      b.textContent = c.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = this.onDone;
        this.current = null;
        this.queue = [];
        this.box.style.display = 'none';
        this.onDone = null;
        if (cb) cb(c.id);
      });
      this.choicesEl.appendChild(b);
    }
  }

  update(dt) {
    if (!this.current) return;
    if (this.charIdx >= this.fullText.length) {
      if (this.lineOpts && this.lineOpts.choices && !this.waitingChoice) {
        this.showChoicesIfAny();
      } else if (!this.lineOpts) {
        this.hintEl.textContent = 'Ketuk untuk lanjut';
      }
      return;
    }
    this.charAcc += dt * TYPE_SPEED;
    const n = Math.floor(this.charAcc);
    if (n > 0) {
      this.charIdx = Math.min(this.fullText.length, this.charIdx + n);
      this.charAcc -= n;
      this.textEl.textContent = this.fullText.slice(0, this.charIdx);
      if (this.charIdx >= this.fullText.length) this.showChoicesIfAny();
    }
  }

  close() {
    this.current = null;
    this.queue = [];
    this.box.style.display = 'none';
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb(null);
  }
}
