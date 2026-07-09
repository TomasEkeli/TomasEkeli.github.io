// render.js — UI for the Ember Match match-3. Free-form rendering; the logic
// lives in game.js (pure). This module owns the DOM, the slide gesture, the
// sequenced clear->drop animation, scoring feedback, game-over, idle hint and
// the window.__test observation hooks.
import {
  createBoard,
  findMatches,
  applySwap,
  isValidSwap,
  hasValidMove,
  collapse,
  scoreCascade,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

const SWAP_MS = 150; // slide / revert
const CLEAR_MS = 260; // matched-gem clear beat
const DROP_BASE = 150; // per sqrt(cell) fall time -> accelerating, physical
const HINT_MS = 10000; // idle before hinting
const DEVIATION_BONUS = 100;

const rng = () => Math.random();

// ---- DOM handles -----------------------------------------------------------
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const floatLayer = document.getElementById('float-layer');
const overlayEl = document.getElementById('gameover');

// ---- state -----------------------------------------------------------------
let board = []; // logical board (array of rows of ints) — the true state
let gemEls = []; // gemEls[r][c] -> the DOM element currently at (r,c)
let cell = 0; // pixel size of one cell
let score = 0;
let lastGain = 0;
let lastBonus = 0;
let gameOver = false;
let hint = null; // {a,b} currently displayed, else null
let animating = false;
let drag = null;
let idleTimer = null;

// ---- geometry --------------------------------------------------------------
function measure() {
  cell = boardEl.clientWidth / COLS;
  boardEl.style.setProperty('--cell', cell + 'px');
}

function place(el, r, c) {
  el._r = r;
  el._c = c;
  el.style.transform = `translate(${c * cell}px, ${r * cell}px)`;
}

function repositionAll() {
  measure();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const el = gemEls[r][c];
      if (!el) continue;
      el.style.transition = 'none';
      place(el, r, c);
    }
}

// ---- gem elements ----------------------------------------------------------
function makeGem(type) {
  const gem = document.createElement('div');
  gem.className = 'gem';
  gem.dataset.testid = 'cell';
  const jewel = document.createElement('div');
  jewel.className = 'jewel';
  jewel.dataset.type = String(type);
  jewel.style.animationDelay = (-Math.random() * 5).toFixed(2) + 's';
  gem.appendChild(jewel);
  gem._type = type;
  gem._jewel = jewel;
  gem.addEventListener('pointerdown', (e) => onPointerDown(e, gem));
  return gem;
}

function buildBoard() {
  boardEl.querySelectorAll('.gem').forEach((n) => n.remove());
  gemEls = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  measure();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const el = makeGem(board[r][c]);
      el.style.transition = 'none';
      place(el, r, c);
      boardEl.appendChild(el);
      gemEls[r][c] = el;
    }
}

// ---- animation helpers -----------------------------------------------------
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const reflow = () => boardEl.offsetHeight;

function moveTo(el, r, c, ms, easing) {
  el.style.transition = `transform ${ms}ms ${easing}`;
  place(el, r, c);
}

// A move: animate the swap, then play each cascade wave (clear -> drop).
async function playMove(a, b, steps) {
  animating = true;
  // 1. slide the two gems into place.
  const ea = gemEls[a.r][a.c];
  const eb = gemEls[b.r][b.c];
  moveTo(ea, b.r, b.c, SWAP_MS, 'ease-out');
  moveTo(eb, a.r, a.c, SWAP_MS, 'ease-out');
  gemEls[a.r][a.c] = eb;
  gemEls[b.r][b.c] = ea;
  await wait(SWAP_MS + 20);

  // 2. resolve each cascade wave.
  for (const step of steps) {
    await clearWave(step.matches);
    await dropWave(step.board);
  }
  animating = false;
}

async function clearWave(matches) {
  for (const { r, c } of matches) {
    const el = gemEls[r][c];
    if (el) el._jewel.classList.add('clearing');
  }
  await wait(CLEAR_MS);
  for (const { r, c } of matches) {
    const el = gemEls[r][c];
    if (el) el.remove();
    gemEls[r][c] = null;
  }
}

// Move survivors down and drop in refills to match `target`. Fall accelerates
// (ease-in) and takes longer the farther a gem travels — physical gravity.
async function dropWave(target) {
  const moving = [];
  let maxMs = DROP_BASE;

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) if (gemEls[r][c]) survivors.push(gemEls[r][c]);
    const newCount = ROWS - survivors.length;
    const col = Array(ROWS).fill(null);

    survivors.forEach((el, i) => {
      col[newCount + i] = el;
    });
    for (let r = 0; r < newCount; r++) {
      const el = makeGem(target[r][c]);
      el.style.transition = 'none';
      place(el, r - newCount, c); // start above the board
      boardEl.appendChild(el);
      col[r] = el;
    }
    for (let r = 0; r < ROWS; r++) gemEls[r][c] = col[r];

    for (let r = 0; r < ROWS; r++) {
      const el = col[r];
      const dist = r - el._r; // cells this gem falls
      if (dist <= 0) continue;
      const ms = DROP_BASE * Math.sqrt(dist);
      maxMs = Math.max(maxMs, ms);
      moving.push({ el, r, c, ms });
    }
  }

  // Freeze starts, then release the fall next frame so transitions trigger.
  moving.forEach(({ el }) => (el.style.transition = 'none'));
  reflow();
  moving.forEach(({ el, r, c, ms }) => {
    el.style.transition = `transform ${ms}ms cubic-bezier(.4, 0, .9, .55)`;
    place(el, r, c);
  });
  await wait(maxMs + 40);
}

async function animateInvalid(a, b) {
  animating = true;
  const ea = gemEls[a.r][a.c];
  const eb = gemEls[b.r][b.c];
  moveTo(ea, b.r, b.c, SWAP_MS, 'ease-out');
  moveTo(eb, a.r, a.c, SWAP_MS, 'ease-out');
  await wait(SWAP_MS + 20);
  moveTo(ea, a.r, a.c, SWAP_MS, 'ease-in');
  moveTo(eb, b.r, b.c, SWAP_MS, 'ease-in');
  await wait(SWAP_MS + 20);
  animating = false;
}

// ---- floating "+N" ---------------------------------------------------------
function showFloat(n) {
  const tag = document.createElement('div');
  tag.className = 'float-gain';
  tag.textContent = '+' + n;
  floatLayer.appendChild(tag);
  setTimeout(() => tag.remove(), 1500);
}

// ---- move handling ---------------------------------------------------------
function samePair(p, a, b) {
  const k = (x, y) => `${x.r},${x.c}|${y.r},${y.c}`;
  const key = (o) =>
    o.a.r < o.b.r || (o.a.r === o.b.r && o.a.c <= o.b.c) ? k(o.a, o.b) : k(o.b, o.a);
  return key(p) === key({ a, b });
}

async function attemptMove(a, b) {
  if (animating || gameOver) return;

  if (!isValidSwap(board, a, b)) {
    await animateInvalid(a, b);
    resetIdle();
    return;
  }

  // deviation bonus: a hint is showing and this move differs from it.
  const bonus = hint && !samePair(hint, a, b) ? DEVIATION_BONUS : 0;
  clearHint();

  const swapped = applySwap(board, a, b);
  const { board: settled, steps } = collapse(swapped, rng, TYPES);
  const gain = scoreCascade(steps.map((s) => s.matches)) + bonus;

  score += gain;
  lastGain = gain;
  lastBonus = bonus;
  updateHud();
  showFloat(gain);

  await playMove(a, b, steps);

  board = settled.map((row) => row.slice());
  if (!hasValidMove(board)) enterGameOver();
  resetIdle();
}

// ---- slide gesture (tracked on document, survives leaving origin cell) -----
function onPointerDown(e, gem) {
  if (animating || gameOver) return;
  e.preventDefault();
  drag = {
    gem,
    r: gem._r,
    c: gem._c,
    x: e.clientX,
    y: e.clientY,
    dir: null,
    target: null,
  };
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.dir) {
    if (Math.hypot(dx, dy) < cell * 0.28) return;
    let tr = drag.r;
    let tc = drag.c;
    if (Math.abs(dx) > Math.abs(dy)) {
      drag.dir = dx > 0 ? 'R' : 'L';
      tc += dx > 0 ? 1 : -1;
    } else {
      drag.dir = dy > 0 ? 'D' : 'U';
      tr += dy > 0 ? 1 : -1;
    }
    drag.target =
      tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS ? { r: tr, c: tc } : null;
    drag.neighbor = drag.target ? gemEls[drag.target.r][drag.target.c] : null;
  }
  // live drag feedback: nudge along the chosen axis, clamped to one cell.
  const horiz = drag.dir === 'L' || drag.dir === 'R';
  let off = horiz ? dx : dy;
  off = Math.max(-cell, Math.min(cell, off));
  drag.gem.style.transition = 'none';
  drag.gem.style.transform = `translate(${drag.c * cell + (horiz ? off : 0)}px, ${
    drag.r * cell + (horiz ? 0 : off)
  }px)`;
  drag.gem._jewel.classList.add('grabbed');
  if (drag.neighbor) {
    drag.neighbor.style.transition = 'none';
    drag.neighbor.style.transform = `translate(${
      drag.target.c * cell - (horiz ? off : 0)
    }px, ${drag.target.r * cell - (horiz ? 0 : off)}px)`;
  }
}

function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  const d = drag;
  drag = null;
  if (!d) return;
  d.gem._jewel.classList.remove('grabbed');
  // snap both gems back to their base cells with no transition; the move
  // animation (if any) takes over from there.
  d.gem.style.transition = 'none';
  place(d.gem, d.r, d.c);
  if (d.neighbor) {
    d.neighbor.style.transition = 'none';
    place(d.neighbor, d.target.r, d.target.c);
  }
  if (!d.dir || !d.target) {
    resetIdle();
    return;
  }
  attemptMove({ r: d.r, c: d.c }, d.target);
}

// ---- hint / idle -----------------------------------------------------------
function firstValidMove(b) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(b, { r, c }, { r, c: c + 1 }))
        return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < ROWS && isValidSwap(b, { r, c }, { r: r + 1, c }))
        return { a: { r, c }, b: { r: r + 1, c } };
    }
  return null;
}

function clearHint() {
  if (hint) {
    boardEl.querySelectorAll('.jewel.hinting').forEach((n) =>
      n.classList.remove('hinting'),
    );
    hint = null;
  }
}

function showHint() {
  if (animating || gameOver || drag) return;
  const mv = firstValidMove(board);
  if (!mv) return;
  hint = mv;
  const el = gemEls[mv.a.r][mv.a.c];
  if (el) el._jewel.classList.add('hinting');
}

function resetIdle() {
  clearHint();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showHint, HINT_MS);
}

// ---- score / game-over -----------------------------------------------------
function updateHud() {
  scoreEl.textContent = score.toLocaleString('en-US');
}

function enterGameOver() {
  gameOver = true;
  overlayEl.classList.add('show');
}

function newGame() {
  clearTimeout(idleTimer);
  clearHint();
  drag = null;
  animating = false;
  gameOver = false;
  score = 0;
  lastGain = 0;
  lastBonus = 0;
  overlayEl.classList.remove('show');
  floatLayer.querySelectorAll('.float-gain').forEach((n) => n.remove());
  board = createBoard(ROWS, COLS, TYPES, rng);
  updateHud();
  buildBoard();
  resetIdle();
}

// ---- observation hooks (READ ONLY — the gate drives real input) ------------
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  validMove: () => firstValidMove(board),
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
};

// ---- boot ------------------------------------------------------------------
document.querySelectorAll('[data-testid="new-game"]').forEach((btn) =>
  btn.addEventListener('click', newGame),
);
overlayEl.querySelector('.over-restart').addEventListener('click', newGame);

let resizeRaf = null;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(repositionAll);
});

newGame();
