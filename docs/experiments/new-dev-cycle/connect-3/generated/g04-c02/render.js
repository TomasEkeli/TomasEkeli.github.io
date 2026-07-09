// render.js — UI for the match-3 candidate g04-c02.
// Warm sunset gemstones: amber -> magenta backdrop, glossy faceted jewels.

import {
  createBoard,
  findMatches,
  isValidSwap,
  applySwap,
  collapse,
  scoreCascade,
  hasValidMove,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

// Deterministic-ish default RNG (fine for play; not test-controlled).
function makeRng() {
  let a = (Date.now() ^ 0x9e3779b9) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng();

// --- Gem visual identity: each type gets a distinct SHAPE + colour family ---
// Shapes are drawn with clip-path so the silhouette itself differs per type
// (colour-blind safe). Colours ride a warm amber -> magenta sunset gradient.
const GEM_DEFS = [
  { name: 'round', clip: 'circle(46% at 50% 50%)', hue: 38 },  // amber sun
  { name: 'square', clip: 'polygon(12% 12%, 88% 12%, 88% 88%, 12% 88%)', hue: 18 }, // orange
  { name: 'diamond', clip: 'polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%)', hue: 350 }, // rose
  { name: 'triangle', clip: 'polygon(50% 6%, 94% 90%, 6% 90%)', hue: 330 }, // magenta-pink
  { name: 'star', clip: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)', hue: 300 }, // magenta
  { name: 'hex', clip: 'polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%)', hue: 265 }, // violet
];

let board = createBoard(ROWS, COLS, TYPES, rng);
let runningScore = 0;
let lastGain = 0;
let busy = false; // true while an animation sequence is playing

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score-value');
const gainLayer = document.getElementById('gain-layer');

let cellSize = 0;

function layoutMetrics() {
  const rect = boardEl.getBoundingClientRect();
  cellSize = rect.width / COLS;
  return rect;
}

// --- Cell / gem DOM ---------------------------------------------------

const cellEls = []; // [r][c] -> { wrap, gem }

function buildBoardDom() {
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--cols', COLS);
  boardEl.style.setProperty('--rows', ROWS);
  cellEls.length = 0;
  for (let r = 0; r < ROWS; r++) {
    const rowArr = [];
    for (let c = 0; c < COLS; c++) {
      const wrap = document.createElement('div');
      wrap.className = 'cell';
      wrap.dataset.r = String(r);
      wrap.dataset.c = String(c);
      wrap.style.gridRowStart = String(r + 1);
      wrap.style.gridColumnStart = String(c + 1);

      const gem = document.createElement('div');
      gem.className = 'gem';
      wrap.appendChild(gem);

      boardEl.appendChild(wrap);
      rowArr.push({ wrap, gem });
    }
    cellEls.push(rowArr);
  }
}

function paintGem(gemEl, type) {
  const def = GEM_DEFS[type];
  gemEl.dataset.type = String(type);
  gemEl.className = `gem shape-${def.name}`;
  const h = def.hue;
  gemEl.style.setProperty('--hue', String(h));
}

function renderStatic() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      paintGem(cellEls[r][c].gem, board[r][c]);
      cellEls[r][c].gem.style.transform = '';
      cellEls[r][c].gem.style.opacity = '1';
    }
  }
}

function updateScoreDom() {
  scoreEl.textContent = String(runningScore);
}

function popGain(amount) {
  if (amount <= 0) return;
  const tag = document.createElement('div');
  tag.className = 'gain-pop';
  tag.textContent = `+${amount}`;
  gainLayer.appendChild(tag);
  tag.addEventListener('animationend', () => tag.remove());
}

// --- Animation helpers --------------------------------------------------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CLEAR_MS = 220;
const DROP_MS_PER_ROW = 90; // base duration per row of fall, eased

function markCleared(matches) {
  for (const { r, c } of matches) {
    cellEls[r][c].gem.classList.add('clearing');
  }
}

function unmarkAll() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cellEls[r][c].gem.classList.remove('clearing');
    }
  }
}

/**
 * Animate the transition from `fromBoard` to `toBoard` given the cleared
 * cells of this wave. Survivors fall via gravity per column; cleared cells
 * vanish; empties are refilled from above (fall in from off-board top).
 */
async function animateWave(fromBoard, matches, toBoard) {
  // 1. Show the matched gems briefly, then let them vanish.
  markCleared(matches);
  await wait(CLEAR_MS);

  // Compute, per column, the mapping of surviving source rows -> dest rows,
  // matching the gravity rule used in game.js (bottom-heavy stacking).
  const clearedSet = new Set(matches.map(({ r, c }) => `${r},${c}`));

  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!clearedSet.has(`${r},${c}`)) survivorRows.push(r);
    }
    const destStart = ROWS - survivorRows.length;

    // Move survivors to their destination rows (visually), keep using the
    // SAME dom gem node so the fall is a continuous animated transform.
    for (let i = 0; i < survivorRows.length; i++) {
      const srcR = survivorRows[i];
      const destR = destStart + i;
      const gemEl = cellEls[srcR][c].gem;
      const dy = (destR - srcR) * cellSize;
      if (dy !== 0) {
        gemEl.style.transition = 'none';
        gemEl.style.zIndex = '5';
        // force reflow then animate
        void gemEl.offsetHeight;
        const rowSpan = destR - srcR;
        const dur = Math.max(180, Math.min(560, DROP_MS_PER_ROW * rowSpan + 120));
        gemEl.style.transition = `transform ${dur}ms cubic-bezier(.55,.06,.9,.7)`;
        gemEl.style.transform = `translateY(${dy}px)`;
        gemEl.dataset.fallDur = String(dur);
      }
    }

    // New refills: the top `destStart` rows of `toBoard` at this column are
    // fresh gems that fall in from above the board.
    for (let r = 0; r < destStart; r++) {
      const gemEl = cellEls[r][c].gem;
      paintGem(gemEl, toBoard[r][c]);
      const fallRows = destStart - r + r; // falls from above the top edge
      const dropFrom = -(destStart) * cellSize - (r * 0); // start above visible board
      gemEl.style.transition = 'none';
      gemEl.style.opacity = '1';
      gemEl.style.zIndex = '5';
      gemEl.style.transform = `translateY(${-(destStart - r + 1) * cellSize}px)`;
      void gemEl.offsetHeight;
      const dur = Math.max(220, Math.min(600, DROP_MS_PER_ROW * (destStart - r + 1) + 140));
      gemEl.style.transition = `transform ${dur}ms cubic-bezier(.55,.06,.9,.7)`;
      gemEl.style.transform = 'translateY(0px)';
    }
  }

  // Wait for the longest fall in this wave.
  await wait(600);

  // Snap DOM back to a clean 1:1 mapping of toBoard, clearing transforms.
  unmarkAll();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gemEl = cellEls[r][c].gem;
      gemEl.style.transition = 'none';
      gemEl.style.transform = '';
      gemEl.style.zIndex = '';
      paintGem(gemEl, toBoard[r][c]);
    }
  }
}

// --- Move execution -------------------------------------------------------

async function attemptMove(a, b) {
  if (busy) return false;
  if (!isValidSwap(board, a, b)) {
    await bounce(a, b);
    return false;
  }
  busy = true;
  try {
    const swapped = applySwap(board, a, b);
    board = swapped;

    const { board: settled, steps } = collapse(swapped, rng, TYPES);
    const waves = steps.map((s) => s.matches);
    const gain = scoreCascade(waves);

    // Render the immediate swap first (no cascade yet) so the player sees it.
    renderStatic();
    await wait(80);

    let current = swapped;
    for (const step of steps) {
      await animateWave(current, step.matches, step.board);
      current = step.board;
    }

    board = settled;
    if (!hasValidMove(board)) {
      // Shouldn't happen (collapse guarantees it), but stay safe.
    }
    renderStatic();

    if (gain > 0) {
      runningScore += gain;
      lastGain = gain;
      updateScoreDom();
      popGain(gain);
    }
    return true;
  } finally {
    busy = false;
  }
}

function bounce(a, b) {
  return new Promise((resolve) => {
    const ga = cellEls[a.r][a.c].gem;
    const gb = cellEls[b.r][b.c].gem;
    const dxA = (b.c - a.c) * cellSize * 0.35;
    const dyA = (b.r - a.r) * cellSize * 0.35;
    ga.style.transition = 'transform 120ms ease-out';
    gb.style.transition = 'transform 120ms ease-out';
    ga.style.transform = `translate(${dxA}px, ${dyA}px)`;
    gb.style.transform = `translate(${-dxA}px, ${-dyA}px)`;
    setTimeout(() => {
      ga.style.transition = 'transform 140ms ease-in';
      gb.style.transition = 'transform 140ms ease-in';
      ga.style.transform = '';
      gb.style.transform = '';
      setTimeout(resolve, 150);
    }, 120);
  });
}

// --- Real pointer-drag input ----------------------------------------------
// Tracked on `document` so the drag survives leaving the origin cell: once
// pointerdown fires on a gem, all subsequent pointermove/pointerup listening
// happens at the document level, not on the per-cell element.

let dragState = null; // { r, c, startX, startY, pointerId }
const DRAG_THRESHOLD = 10; // px before a direction is committed

function cellFromPoint(x, y) {
  const rect = boardEl.getBoundingClientRect();
  const localX = x - rect.left;
  const localY = y - rect.top;
  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return null;
  const c = Math.floor((localX / rect.width) * COLS);
  const r = Math.floor((localY / rect.height) * ROWS);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function onPointerDown(ev) {
  if (busy) return;
  const cell = cellFromPoint(ev.clientX, ev.clientY);
  if (!cell) return;
  layoutMetrics();
  dragState = {
    r: cell.r,
    c: cell.c,
    startX: ev.clientX,
    startY: ev.clientY,
    pointerId: ev.pointerId,
    resolved: false,
  };
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  ev.preventDefault();
}

function directionFromDelta(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return null;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { dr: 0, dc: 1 } : { dr: 0, dc: -1 };
  }
  return dy > 0 ? { dr: 1, dc: 0 } : { dr: -1, dc: 0 };
}

function onPointerMove(ev) {
  if (!dragState || dragState.resolved) return;
  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;
  const dir = directionFromDelta(dx, dy);
  if (dir) {
    dragState.resolved = true;
    const a = { r: dragState.r, c: dragState.c };
    const b = { r: a.r + dir.dr, c: a.c + dir.dc };
    endDrag();
    if (b.r >= 0 && b.r < ROWS && b.c >= 0 && b.c < COLS) {
      attemptMove(a, b);
    }
  }
}

function onPointerUp() {
  endDrag();
}

function onPointerCancel() {
  endDrag();
}

function endDrag() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  dragState = null;
}

boardEl.addEventListener('pointerdown', onPointerDown);

window.addEventListener('resize', layoutMetrics);

// --- Init -------------------------------------------------------------

buildBoardDom();
requestAnimationFrame(() => {
  layoutMetrics();
  renderStatic();
});

// --- Test hooks (observation only — the gate drives real drags) -----------

window.__test = {
  score() {
    return runningScore;
  },
  lastGain() {
    return lastGain;
  },
  validMove() {
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
  },
  // Convenience only — not how the gate performs a move.
  async slide(r, c, dir) {
    const dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const [dr, dc] = dirs[dir] || [0, 0];
    const a = { r, c };
    const b = { r: r + dr, c: c + dc };
    await attemptMove(a, b);
  },
};
