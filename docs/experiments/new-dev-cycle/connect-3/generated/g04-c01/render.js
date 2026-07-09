import {
  createBoard,
  isValidSwap,
  applySwap,
  collapse,
  scoreCascade,
} from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const CELL = 56; // px, kept in sync with CSS custom property --cell

const rng = () => Math.random();

// Colour-blind-safe: every type is a distinct SILHOUETTE, colour is a bonus.
const GEM_DEFS = [
  { shape: 'circle', base: '#2fd0c9', edge: '#0c6e6a', name: 'orb' },
  { shape: 'diamond', base: '#4fb3ff', edge: '#0d4f8a', name: 'shard' },
  { shape: 'triangle', base: '#7cf29a', edge: '#137a3f', name: 'fin' },
  { shape: 'hex', base: '#ffd25a', edge: '#9a6a05', name: 'nautilus' },
  { shape: 'star', base: '#ff8fb0', edge: '#9a1f4c', name: 'coral' },
  { shape: 'cross', base: '#c79bff', edge: '#5a2a9e', name: 'anemone' },
];

let board = createBoard(ROWS, COLS, TYPES, rng);
let total = 0;
let lastGain = 0;
let busy = false; // true while an animation sequence is in flight

const boardEl = document.getElementById('board');
const gemLayer = document.getElementById('gem-layer');
const scoreEl = document.getElementById('score-value');
const popupHost = document.getElementById('popup-host');

/** @type {HTMLDivElement[][]} */
let gemEls = [];

function buildStaticCells() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      boardEl.appendChild(cell);
    }
  }
}

function makeGemEl(type, r, c) {
  const def = GEM_DEFS[type];
  const el = document.createElement('div');
  el.className = 'gem';
  el.dataset.type = String(type);
  placeGem(el, r, c);

  const body = document.createElement('div');
  body.className = `gem-body gem-${def.shape}`;
  body.style.setProperty('--base', def.base);
  body.style.setProperty('--edge', def.edge);
  body.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s, ${(Math.random() * 4.5).toFixed(2)}s`;

  const facet = document.createElement('div');
  facet.className = 'facet';
  const glint = document.createElement('div');
  glint.className = 'glint';
  body.appendChild(facet);
  body.appendChild(glint);
  el.appendChild(body);
  return el;
}

function placeGem(el, r, c) {
  el.style.transform = `translate(${c * CELL}px, ${r * CELL}px)`;
}

function buildGems() {
  gemLayer.innerHTML = '';
  gemEls = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = makeGemEl(board[r][c], r, c);
      gemLayer.appendChild(el);
      gemEls[r][c] = el;
    }
  }
}

function sizeBoard() {
  boardEl.style.setProperty('--cols', COLS);
  boardEl.style.setProperty('--rows', ROWS);
  boardEl.style.width = `${COLS * CELL}px`;
  boardEl.style.height = `${ROWS * CELL}px`;
  gemLayer.style.width = `${COLS * CELL}px`;
  gemLayer.style.height = `${ROWS * CELL}px`;
}

function updateScoreHud() {
  scoreEl.textContent = String(total);
}

function floatGain(n) {
  if (n <= 0) return;
  const tag = document.createElement('div');
  tag.className = 'gain-pop';
  tag.textContent = `+${n}`;
  popupHost.appendChild(tag);
  tag.addEventListener('animationend', () => tag.remove());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- animation sequencing ----------

async function playClear(matches) {
  for (const { r, c } of matches) {
    gemEls[r][c]?.classList.add('clearing');
  }
  await wait(220);
  for (const { r, c } of matches) {
    const el = gemEls[r][c];
    if (el) el.remove();
    gemEls[r][c] = null;
  }
}

async function playDrop(prevGemEls, matches, nextBoard) {
  const cleared = new Set(matches.map(({ r, c }) => r + ',' + c));
  const newGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let maxRows = 1;

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (!cleared.has(r + ',' + c) && prevGemEls[r][c]) {
        survivors.push(prevGemEls[r][c]);
      }
    }
    const holeCount = ROWS - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      const newRow = holeCount + i;
      const el = survivors[i];
      const travel = newRow - rowOf(el, c);
      maxRows = Math.max(maxRows, travel);
      newGrid[newRow][c] = el;
      dropTo(el, newRow, c, travel);
    }
    for (let i = 0; i < holeCount; i++) {
      const newRow = i;
      const type = nextBoard[newRow][c];
      const el = makeGemEl(type, -(holeCount - i), c);
      gemLayer.appendChild(el);
      newGrid[newRow][c] = el;
      const travel = newRow + (holeCount - i);
      maxRows = Math.max(maxRows, travel);
      requestAnimationFrame(() => dropTo(el, newRow, c, travel));
    }
  }

  gemEls = newGrid;
  const duration = Math.min(900, 130 * Math.sqrt(maxRows) + 90);
  await wait(duration + 40);
}

function rowOf(el, fallbackCol) {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
  return m ? Math.round(parseFloat(m[2]) / CELL) : 0;
}

function dropTo(el, r, c, travelRows) {
  const duration = Math.min(900, 130 * Math.sqrt(Math.max(travelRows, 1)) + 90);
  el.style.transition = `transform ${duration}ms cubic-bezier(0.55, 0.03, 0.9, 0.4)`;
  placeGem(el, r, c);
}

async function playSteps(steps) {
  for (const step of steps) {
    const snapshot = gemEls;
    await playClear(step.matches);
    await playDrop(snapshot, step.matches, step.board);
  }
}

function snapGemTransition(on) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = gemEls[r][c];
      if (el) el.style.transition = on ? 'transform 220ms ease' : 'none';
    }
  }
}

async function reconcileFinalBoard(finalBoard) {
  // After collapse's own no-deadlock reshuffle, the visual board may not
  // exactly equal the last animated step (rare). Snap-fade to match.
  let mismatch = false;
  for (let r = 0; r < ROWS && !mismatch; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = gemEls[r][c];
      if (!el || Number(el.dataset.type) !== finalBoard[r][c]) { mismatch = true; break; }
    }
  }
  if (!mismatch) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      gemEls[r][c]?.remove();
    }
  }
  board = finalBoard;
  buildGems();
}

// ---------- move handling ----------

async function attemptMove(a, b) {
  if (busy) return;
  if (!isValidSwap(board, a, b)) {
    await bounce(a, b);
    return;
  }
  busy = true;
  snapGemTransition(true);
  swapVisual(a, b);
  await wait(180);

  board = applySwap(board, a, b);
  const { board: settled, steps } = collapse(board, rng, TYPES);
  const waves = steps.map((s) => s.matches);
  const gain = scoreCascade(waves);

  await playSteps(steps);

  board = settled;
  await reconcileFinalBoard(settled);

  total += gain;
  lastGain = gain;
  updateScoreHud();
  floatGain(gain);
  busy = false;
}

function swapVisual(a, b) {
  const elA = gemEls[a.r][a.c];
  const elB = gemEls[b.r][b.c];
  if (elA) placeGem(elA, b.r, b.c);
  if (elB) placeGem(elB, a.r, a.c);
  gemEls[a.r][a.c] = elB;
  gemEls[b.r][b.c] = elA;
}

async function bounce(a, b) {
  busy = true;
  snapGemTransition(true);
  swapVisual(a, b);
  await wait(140);
  swapVisual(a, b);
  await wait(160);
  busy = false;
}

// ---------- pointer / drag input ----------
// Tracked on `document` so the gesture survives the pointer leaving the
// origin cell — a per-cell pointermove handler dies the instant the pointer
// crosses into the neighbouring element.

let drag = null; // { origin: {r,c}, startX, startY }
const DRAG_THRESHOLD = CELL * 0.28;

function cellFromClientPoint(x, y) {
  const rect = boardEl.getBoundingClientRect();
  const c = Math.floor((x - rect.left) / CELL);
  const r = Math.floor((y - rect.top) / CELL);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function onPointerDown(ev) {
  if (busy) return;
  const origin = cellFromClientPoint(ev.clientX, ev.clientY);
  if (!origin) return;
  drag = { origin, startX: ev.clientX, startY: ev.clientY, moved: false };
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!drag) return;
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  const el = gemEls[drag.origin.r]?.[drag.origin.c];
  if (!el) return;
  // Give a light live-follow feel, clamped to roughly one cell.
  const clampedX = Math.max(-CELL, Math.min(CELL, dx));
  const clampedY = Math.max(-CELL, Math.min(CELL, dy));
  const dominant = Math.abs(dx) > Math.abs(dy) ? { x: clampedX, y: 0 } : { x: 0, y: clampedY };
  el.style.transition = 'none';
  el.style.transform = `translate(${drag.origin.c * CELL + dominant.x}px, ${drag.origin.r * CELL + dominant.y}px)`;
  if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
}

function onPointerUp(ev) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  if (!drag) return;
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  const origin = drag.origin;
  drag = null;

  let target = null;
  if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
    if (Math.abs(dx) > Math.abs(dy)) {
      target = { r: origin.r, c: origin.c + (dx > 0 ? 1 : -1) };
    } else {
      target = { r: origin.r + (dy > 0 ? 1 : -1), c: origin.c };
    }
  }

  if (!target || target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    // snap back to home
    const el = gemEls[origin.r][origin.c];
    if (el) {
      el.style.transition = 'transform 200ms ease';
      placeGem(el, origin.r, origin.c);
    }
    return;
  }

  attemptMove(origin, target);
}

function findAnyValidMove(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(b, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && isValidSwap(b, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

// ---------- test / observation hooks ----------

window.__test = {
  score() { return total; },
  lastGain() { return lastGain; },
  validMove() { return findAnyValidMove(board); },
  slide(r, c, dir) {
    const deltas = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };
    const d = deltas[dir];
    if (!d) return Promise.resolve(false);
    const a = { r, c };
    const b = { r: r + d.r, c: c + d.c };
    return attemptMove(a, b).then(() => true);
  },
};

// ---------- boot ----------

function init() {
  sizeBoard();
  buildStaticCells();
  buildGems();
  updateScoreHud();
  gemLayer.addEventListener('pointerdown', onPointerDown);
}

init();
