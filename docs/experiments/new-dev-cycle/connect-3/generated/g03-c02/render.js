// render.js — UI for the match-3 board.
// Slide-to-swap input, sequenced clear→drop animation per cascade wave,
// floating "+N" feedback, and the window.__test hooks the gate drives.

import {
  createBoard,
  findMatches,
  isValidSwap,
  hasValidMove,
  applySwap,
  collapse,
  scoreCascade,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

// Animation timings (ms). Short enough for the gate, long enough to read.
const CLEAR_MS = 200;
const DROP_MS = 220;

const PALETTE = [
  '#ff9eb5', // pastel rose
  '#ffbe86', // pastel peach
  '#f6e07a', // pastel gold
  '#8fd9a8', // pastel mint
  '#8ecae6', // pastel sky
  '#c3a8e8', // pastel lilac
];

const boardEl = document.getElementById('board');
const totalEl = document.getElementById('total');
const floatLayer = document.getElementById('float-layer');

let rng = Math.random;
let board = createBoard(ROWS, COLS, TYPES, rng);
let total = 0;
let lastGain = 0;
let busy = false;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// --- rendering ---------------------------------------------------------------

// Build a fresh grid of gem elements from `board`. `dropping` animates gems in
// from above (used after a clear); otherwise they appear settled.
function renderBoard(model, { dropping = false, cols = null } = {}) {
  boardEl.style.setProperty('--rows', ROWS);
  boardEl.style.setProperty('--cols', COLS);
  boardEl.textContent = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gem = document.createElement('div');
      gem.className = 'cell gem';
      gem.dataset.r = r;
      gem.dataset.c = c;
      gem.style.background = PALETTE[model[r][c] % PALETTE.length];
      if (dropping && (!cols || cols.has(c))) {
        gem.classList.add('dropping');
        gem.style.animationDelay = `${r * 12}ms`;
      }
      boardEl.appendChild(gem);
    }
  }
}

function gemAt(r, c) {
  return boardEl.querySelector(`.gem[data-r="${r}"][data-c="${c}"]`);
}

function updateTotal() {
  totalEl.textContent = String(total);
}

function floatGain(gain) {
  const el = document.createElement('div');
  el.className = 'float-gain';
  el.textContent = `+${gain}`;
  floatLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// --- move resolution ---------------------------------------------------------

// Highlight the matched cells (the clear beat), wait, then continue.
async function playClear(matches) {
  for (const { r, c } of matches) {
    const g = gemAt(r, c);
    if (g) g.classList.add('clearing');
  }
  await sleep(CLEAR_MS);
}

async function playDrop(nextModel, matches) {
  const cols = new Set(matches.map((m) => m.c));
  renderBoard(nextModel, { dropping: true, cols });
  await sleep(DROP_MS);
}

async function performSwap(a, b) {
  if (busy) return;
  busy = true;
  try {
    if (!isValidSwap(board, a, b)) {
      await playReject(a, b);
      return;
    }

    // Slide the two gems past each other, then commit the swap model.
    await playSwapMotion(a, b);
    board = applySwap(board, a, b);
    renderBoard(board);

    const { board: settled, steps } = collapse(board, rng, TYPES);

    // Score and surface feedback up front so the resolved Promise is final.
    const gain = scoreCascade(steps.map((s) => s.matches));
    lastGain = gain;
    total += gain;
    updateTotal();
    if (gain > 0) floatGain(gain);

    // Animate each wave in order: clear the matches, then drop into the
    // board that wave produced.
    for (const step of steps) {
      await playClear(step.matches);
      await playDrop(step.board, step.matches);
    }

    board = settled;
    renderBoard(board);
  } finally {
    busy = false;
  }
}

// Exact pixel offset between two gems' top-left corners, so a slide lands
// precisely on the neighbour's position regardless of the grid gap.
function pixelDelta(ga, gb) {
  const ra = ga.getBoundingClientRect();
  const rb = gb.getBoundingClientRect();
  return { dx: rb.left - ra.left, dy: rb.top - ra.top };
}

async function playSwapMotion(a, b) {
  const ga = gemAt(a.r, a.c);
  const gb = gemAt(b.r, b.c);
  if (ga && gb) {
    const { dx, dy } = pixelDelta(ga, gb);
    ga.style.transform = `translate(${dx}px, ${dy}px)`;
    gb.style.transform = `translate(${-dx}px, ${-dy}px)`;
  }
  await sleep(140);
}

async function playReject(a, b) {
  const ga = gemAt(a.r, a.c);
  const gb = gemAt(b.r, b.c);
  if (ga && gb) {
    const { dx, dy } = pixelDelta(ga, gb);
    // Nudge toward the target and spring back.
    ga.style.transform = `translate(${dx * 0.28}px, ${dy * 0.28}px)`;
    gb.style.transform = `translate(${-dx * 0.28}px, ${-dy * 0.28}px)`;
    await sleep(130);
    ga.style.transform = '';
    gb.style.transform = '';
    await sleep(130);
  } else {
    await sleep(130);
  }
}

// --- slide input -------------------------------------------------------------

let drag = null;

function cellFromEvent(e) {
  const g = e.target.closest('.gem');
  if (!g) return null;
  return { r: Number(g.dataset.r), c: Number(g.dataset.c) };
}

boardEl.addEventListener('pointerdown', (e) => {
  if (busy) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  drag = { cell, x: e.clientX, y: e.clientY };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const cell = drag.cell;
  drag = null;
  const threshold = 12;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
  let dir;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
  else dir = dy > 0 ? 'down' : 'up';
  slide(cell.r, cell.c, dir);
});

boardEl.addEventListener('pointercancel', () => { drag = null; });

// --- test / programmatic hooks ----------------------------------------------

const DIRS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

function slide(r, c, dir) {
  const d = DIRS[dir];
  if (!d) return Promise.resolve();
  const a = { r, c };
  const b = { r: r + d.dr, c: c + d.dc };
  if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return Promise.resolve();
  return performSwap(a, b);
}

function firstValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

window.__test = {
  score() { return total; },
  lastGain() { return lastGain; },
  validMove() { return firstValidMove(); },
  slide(r, c, dir) { return slide(r, c, dir); },
};

// --- boot --------------------------------------------------------------------

renderBoard(board);
updateTotal();
