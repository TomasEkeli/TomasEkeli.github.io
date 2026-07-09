// render.js — UI for Gem Jubilee!
// Slide-to-swap input, sequenced clear/drop animation, cascade scoring,
// and the window.__test hooks required by the contract.

import {
  createBoard,
  applySwap,
  isValidSwap,
  collapse,
  scoreCascade,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const GAP = 6; // must match --cell-gap in the CSS

// Vivid, saturated gem palette (playful and bouncy personality).
const GEMS = [
  'radial-gradient(circle at 32% 28%, #ff8a8a, #e11d48)', // ruby red
  'radial-gradient(circle at 32% 28%, #ffd27a, #f97316)', // amber orange
  'radial-gradient(circle at 32% 28%, #b6ff8a, #22c55e)', // emerald green
  'radial-gradient(circle at 32% 28%, #8ad7ff, #2563eb)', // sapphire blue
  'radial-gradient(circle at 32% 28%, #d79bff, #9333ea)', // amethyst purple
  'radial-gradient(circle at 32% 28%, #ffb3e6, #ec4899)', // pink diamond
];

// Animation timings (ms).
const T_SWAP = 210;
const T_CLEAR = 230;
const T_DROP = 450;

const rng = () => Math.random();
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

let board = createBoard(ROWS, COLS, TYPES, rng);
let total = 0;
let lastGain = 0;
let busy = false;

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const badgeEl = document.getElementById('badge');

// cells[r][c] -> the DOM element currently at that coordinate.
let cells = [];

function render() {
  boardEl.innerHTML = '';
  cells = Array.from({ length: ROWS }, () => new Array(COLS));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.style.setProperty('--gem', GEMS[board[r][c] % GEMS.length]);
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      boardEl.appendChild(el);
      cells[r][c] = el;
    }
  }
}

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function neighborOf(r, c, dir) {
  switch (dir) {
    case 'up': return { r: r - 1, c };
    case 'down': return { r: r + 1, c };
    case 'left': return { r, c: c - 1 };
    case 'right': return { r, c: c + 1 };
    default: return null;
  }
}

// Animate the two gems sliding toward each other. Does not change state.
function animateSwapVisual(a, b) {
  const ca = cells[a.r][a.c];
  const cb = cells[b.r][b.c];
  const step = ca.offsetWidth + GAP;
  const dx = b.c - a.c;
  const dy = b.r - a.r;
  ca.style.transition = `transform ${T_SWAP}ms cubic-bezier(0.34,1.56,0.64,1)`;
  cb.style.transition = `transform ${T_SWAP}ms cubic-bezier(0.34,1.56,0.64,1)`;
  ca.style.zIndex = '6';
  cb.style.zIndex = '5';
  ca.style.transform = `translate(${dx * step}px, ${dy * step}px)`;
  cb.style.transform = `translate(${-dx * step}px, ${-dy * step}px)`;
  return wait(T_SWAP + 20);
}

// A rejected slide: slide out, then bounce back home.
async function animateReject(a, b) {
  await animateSwapVisual(a, b);
  const ca = cells[a.r] && cells[a.r][a.c];
  const cb = cells[b.r] && cells[b.r][b.c];
  if (ca) ca.style.transform = 'translate(0,0)';
  if (cb) cb.style.transform = 'translate(0,0)';
  await wait(T_SWAP + 20);
  if (ca) { ca.style.transition = ''; ca.style.zIndex = ''; }
  if (cb) { cb.style.transition = ''; cb.style.zIndex = ''; }
}

// Clear phase: throb + pop the matched cells, then they vanish.
async function clearPhase(matches) {
  for (const { r, c } of matches) {
    const el = cells[r] && cells[r][c];
    if (el) el.classList.add('clearing');
  }
  await wait(T_CLEAR);
}

// Drop phase: render the settled-after-this-wave board and spring the gems in.
async function dropPhase(nextBoard) {
  board = nextBoard;
  render();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = cells[r][c];
      el.style.setProperty('--fall', `-${120 + r * 22}%`);
      el.classList.add('dropping');
    }
  }
  await wait(T_DROP);
}

function floatGain(gain) {
  scoreEl.textContent = String(total);
  badgeEl.textContent = `+${gain}`;
  badgeEl.classList.remove('show');
  // force reflow so the transition replays
  void badgeEl.offsetWidth;
  badgeEl.classList.add('show');

  const f = document.createElement('div');
  f.className = 'float';
  f.textContent = `+${gain}`;
  document.getElementById('stage').appendChild(f);
  void f.offsetWidth;
  f.classList.add('go');
  setTimeout(() => f.remove(), 1500);
  setTimeout(() => badgeEl.classList.remove('show'), 1400);
}

// Perform a slide of gem (r,c) one step in dir. Resolves after every cascade
// wave's clear + drop has finished and score/lastGain are final.
async function slide(r, c, dir) {
  if (busy) return;
  if (!inBounds(r, c)) return;
  const b = neighborOf(r, c, dir);
  if (!b || !inBounds(b.r, b.c)) return; // off the board edge

  const a = { r, c };
  busy = true;
  try {
    if (!isValidSwap(board, a, b)) {
      await animateReject(a, b);
      return;
    }

    // Legal move: slide, commit the swap, then resolve the cascade.
    await animateSwapVisual(a, b);
    board = applySwap(board, a, b);
    render();

    const { steps } = collapse(board, rng, TYPES);
    const gain = scoreCascade(steps.map((s) => s.matches));

    for (const step of steps) {
      await clearPhase(step.matches);
      await dropPhase(step.board);
    }

    total += gain;
    lastGain = gain;
    floatGain(gain);
  } finally {
    busy = false;
  }
}

// ---- Pointer / touch slide input -------------------------------------------

let dragStart = null; // { r, c, x, y }

boardEl.addEventListener('pointerdown', (e) => {
  if (busy) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  dragStart = {
    r: Number(cell.dataset.r),
    c: Number(cell.dataset.c),
    x: e.clientX,
    y: e.clientY,
  };
  try { cell.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  e.preventDefault();
});

function finishDrag(e) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  const { r, c } = dragStart;
  dragStart = null;

  const cellPx = boardEl.querySelector('.cell');
  const threshold = cellPx ? cellPx.offsetWidth * 0.35 : 14;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

  let dir;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
  else dir = dy > 0 ? 'down' : 'up';

  slide(r, c, dir);
}

boardEl.addEventListener('pointerup', finishDrag);
boardEl.addEventListener('pointercancel', () => { dragStart = null; });

// ---- Boot & test hooks ------------------------------------------------------

render();
scoreEl.textContent = '0';

function findValidMove() {
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
  validMove() { return findValidMove(); },
  slide(r, c, dir) { return slide(r, c, dir); },
};
