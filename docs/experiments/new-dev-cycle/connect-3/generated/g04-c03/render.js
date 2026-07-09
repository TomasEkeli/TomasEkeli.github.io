// render.js — UI layer for the "cosmic crystal" match-3 candidate.
// Imports the pure logic module and drives DOM rendering + input + animation.

import {
  createBoard,
  findMatches,
  isValidSwap,
  hasValidMove,
  applySwap,
  collapse,
  score as scoreOf,
  scoreCascade,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

// Deterministic-enough RNG seeded from time; UI play doesn't need
// reproducibility (only the logic tests do), but we still inject an rng
// function per the contract's shape.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(Date.now() ^ 0x9e3779b9);

let board = createBoard(ROWS, COLS, TYPES, rng);
let runningScore = 0;
let lastGain = 0;
let busy = false; // true while an animation sequence is in flight

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score-value');
const gainLayer = document.getElementById('gain-layer');

// Per-type shape glyphs (colour-blind safe: shape carries identity, colour
// is a secondary cue). Rendered as inline SVG paths inside each gem.
const GEM_DEFS = [
  { name: 'diamond', color: '#5ad8ff', glow: '#bdf3ff' }, // 0
  { name: 'hex', color: '#ff5ac8', glow: '#ffc4ea' }, // 1
  { name: 'star', color: '#ffd24a', glow: '#fff2c2' }, // 2
  { name: 'triangle', color: '#59ff9a', glow: '#c6ffdd' }, // 3
  { name: 'circle', color: '#b06bff', glow: '#e4cbff' }, // 4
  { name: 'square', color: '#ff8a4a', glow: '#ffd7bc' }, // 5
];

function shapePath(name) {
  switch (name) {
    case 'diamond':
      return '<polygon points="50,6 94,50 50,94 6,50" />';
    case 'hex':
      return '<polygon points="50,4 90,27 90,73 50,96 10,73 10,27" />';
    case 'star':
      return '<polygon points="50,4 61,37 96,37 68,58 79,92 50,71 21,92 32,58 4,37 39,37" />';
    case 'triangle':
      return '<polygon points="50,8 92,90 8,90" />';
    case 'circle':
      return '<circle cx="50" cy="50" r="44" />';
    case 'square':
      return '<rect x="10" y="10" width="80" height="80" rx="14" />';
    default:
      return '<circle cx="50" cy="50" r="44" />';
  }
}

// --- Cell/gem DOM construction -------------------------------------------

const cellEls = []; // [r][c] -> cell element
const gemEls = []; // [r][c] -> gem element (child of cell), or null while empty

function buildBoardDom() {
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--rows', ROWS);
  boardEl.style.setProperty('--cols', COLS);
  for (let r = 0; r < ROWS; r++) {
    cellEls[r] = [];
    gemEls[r] = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      boardEl.appendChild(cell);
      cellEls[r][c] = cell;
      gemEls[r][c] = null;
    }
  }
}

function makeGemEl(type) {
  const def = GEM_DEFS[type % GEM_DEFS.length];
  const gem = document.createElement('div');
  gem.className = 'gem';
  gem.dataset.type = String(type);
  gem.style.setProperty('--gem-color', def.color);
  gem.style.setProperty('--gem-glow', def.glow);
  // idle pazzazz: randomize animation delay/duration slightly per gem so
  // the board doesn't pulse in unison
  gem.style.setProperty('--idle-delay', `${(Math.random() * 3).toFixed(2)}s`);
  gem.style.setProperty('--idle-dur', `${(2.6 + Math.random() * 1.8).toFixed(2)}s`);
  gem.innerHTML = `
    <svg viewBox="0 0 100 100" class="gem-shape">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${def.glow}" />
          <stop offset="55%" stop-color="${def.color}" />
          <stop offset="100%" stop-color="#0a0a1a" />
        </linearGradient>
      </defs>
      <g class="gem-facet" fill="url(#g)" stroke="rgba(255,255,255,0.55)" stroke-width="3">
        ${shapePath(def.name)}
      </g>
      <ellipse class="gem-highlight" cx="36" cy="30" rx="18" ry="10" />
    </svg>
  `;
  return gem;
}

function renderFull() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = cellEls[r][c];
      const existing = gemEls[r][c];
      if (existing) existing.remove();
      const gem = makeGemEl(board[r][c]);
      cell.appendChild(gem);
      gemEls[r][c] = gem;
    }
  }
}

// --- Score HUD -------------------------------------------------------------

function updateScoreHud() {
  scoreEl.textContent = String(runningScore);
}

function popGain(amount) {
  const tag = document.createElement('div');
  tag.className = 'gain-pop';
  tag.textContent = `+${amount}`;
  gainLayer.appendChild(tag);
  // force reflow then trigger animation via class
  requestAnimationFrame(() => {
    tag.classList.add('gain-pop-run');
  });
  setTimeout(() => {
    tag.remove();
  }, 1500);
}

// --- Animation helpers -------------------------------------------------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CLEAR_MS = 220;
const DROP_MS_PER_ROW = 90; // baseline; eased, so actual duration is scaled

// Animate clearing of a set of cells (shown briefly with an effect, then
// removed), then apply gravity+refill using the given post-clear board,
// with survivors dropping via an accelerating (ease-in) transform and
// refills falling in from above the board.
async function animateWave(preBoard, matches, postBoard) {
  // 1. CLEAR: flag matched gems, let CSS play a shimmer/explode, then vanish.
  for (const { r, c } of matches) {
    const gem = gemEls[r][c];
    if (gem) gem.classList.add('gem-clearing');
  }
  await wait(CLEAR_MS);

  const clearedSet = new Set(matches.map((m) => `${m.r},${m.c}`));
  for (const { r, c } of matches) {
    const gem = gemEls[r][c];
    if (gem) {
      gem.remove();
      gemEls[r][c] = null;
    }
  }

  // 2. DROP: compute, per column, how far each surviving gem must fall and
  // how many new gems refill from the top, then animate.
  const rows = preBoard.length;
  const cols = preBoard[0].length;

  // Build the list of (fromRow -> toRow) moves for survivors per column,
  // and new refill values to create at the top.
  const dropPromises = [];
  let maxDistance = 1;

  const columnPlans = [];
  for (let c = 0; c < cols; c++) {
    const survivorRows = [];
    for (let r = 0; r < rows; r++) {
      if (!clearedSet.has(`${r},${c}`)) survivorRows.push(r);
    }
    // Survivors keep relative order and land at the bottom-most available
    // rows in postBoard (gravity), matched against postBoard's values from
    // the bottom up for stability of assignment.
    const targetRows = [];
    for (let r = rows - 1; r >= 0; r--) targetRows.unshift(r);
    const landingRows = targetRows.slice(targetRows.length - survivorRows.length);
    columnPlans.push({ c, survivorRows, landingRows });
    for (let i = 0; i < survivorRows.length; i++) {
      const dist = Math.abs(landingRows[i] - survivorRows[i]);
      if (dist > maxDistance) maxDistance = dist;
    }
  }

  for (const { c, survivorRows, landingRows } of columnPlans) {
    for (let i = 0; i < survivorRows.length; i++) {
      const fromRow = survivorRows[i];
      const toRow = landingRows[i];
      const gem = gemEls[fromRow][c];
      if (!gem) continue;
      const distance = toRow - fromRow; // rows to move down
      if (distance === 0) continue;
      dropPromises.push(animateDrop(gem, fromRow, toRow, c, distance, maxDistance));
    }
  }

  // Refills: figure out, per column, how many cells are empty at the top
  // after survivors have been logically relocated, and fill with
  // postBoard's values (which already include the refill choices made by
  // collapse()).
  for (const { c, landingRows } of columnPlans) {
    const filledRows = new Set(landingRows);
    for (let r = 0; r < rows; r++) {
      if (!filledRows.has(r)) {
        // this row is a refill in the post-wave board
        const type = postBoard[r][c];
        const gem = makeGemEl(type);
        gem.classList.add('gem-refill');
        cellEls[r][c].appendChild(gem);
        gemEls[r][c] = gem;
        const startOffset = -(r + 1); // start above the board
        const distance = r - startOffset;
        dropPromises.push(animateDrop(gem, startOffset, r, c, distance, maxDistance, true));
      }
    }
  }

  await Promise.all(dropPromises);

  // 3. Re-sync DOM state to exactly match postBoard values (defensive —
  // in case of any indexing edge case, ensures visuals never drift from
  // logic state).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gem = gemEls[r][c];
      if (gem) {
        const wantType = postBoard[r][c];
        if (Number(gem.dataset.type) !== wantType) {
          const fresh = makeGemEl(wantType);
          gem.replaceWith(fresh);
          gemEls[r][c] = fresh;
        }
        gem.style.transform = '';
        gem.classList.remove('gem-dropping', 'gem-refill', 'gem-clearing');
      }
    }
  }
}

// Animate a single gem falling `distance` rows (physical: ease-in /
// accelerating). Uses the Web Animations API for a true acceleration curve.
function animateDrop(gem, fromRow, toRow, c, distance, maxDistance, isNewRefill) {
  return new Promise((resolve) => {
    if (distance <= 0) {
      resolve();
      return;
    }
    // Move the gem to its destination cell in the DOM immediately, but
    // visually offset it upward by `distance` cell-heights, then animate
    // the offset to zero with an ease-in (accelerating) curve — reads as
    // gravity: slow start, fast landing.
    cellEls[toRow][c].appendChild(gem);
    gemEls[toRow][c] = gem;

    const cellSize = cellEls[0][0].getBoundingClientRect().height || 1;
    const pixelOffset = distance * cellSize;
    gem.classList.add('gem-dropping');
    gem.style.transform = `translateY(${-pixelOffset}px)`;

    // Duration scales with distance so long falls take proportionally
    // longer, but capped so refills from far above the board don't lag.
    const baseDur = DROP_MS_PER_ROW * Math.min(distance, maxDistance + 2);
    const duration = Math.max(180, Math.min(baseDur, 650));

    const anim = gem.animate(
      [
        { transform: `translateY(${-pixelOffset}px)` },
        { transform: 'translateY(0px)' },
      ],
      {
        duration,
        easing: 'cubic-bezier(0.55, 0.06, 0.9, 0.35)', // ease-in: accelerate
        fill: 'forwards',
      },
    );
    anim.onfinish = () => {
      gem.style.transform = '';
      resolve();
    };
  });
}

// --- Move handling -------------------------------------------------------

async function attemptMove(a, b) {
  if (busy) return;
  if (!inBoard(a) || !inBoard(b)) return;
  busy = true;
  try {
    const valid = isValidSwap(board, a, b);
    if (!valid) {
      await animateRejectedSlide(a, b);
      return;
    }

    // Swap in the DOM immediately (feedback), then run the full collapse.
    board = applySwap(board, a, b);
    await animateSwapVisual(a, b);

    const { board: settled, steps } = collapse(board, rng, TYPES);
    let working = board;
    for (const step of steps) {
      await animateWave(working, step.matches, step.board);
      working = step.board;
    }
    board = settled;

    const gain = scoreCascade(steps.map((s) => s.matches));
    lastGain = gain;
    runningScore += gain;
    updateScoreHud();
    if (gain > 0) popGain(gain);

    // Final safety re-render in case settle triggered a reshuffle beyond
    // what steps captured (no-deadlock guarantee only rewrites `board`).
    syncBoardIfDrifted();
  } finally {
    busy = false;
  }
}

function inBoard(p) {
  return p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS;
}

function syncBoardIfDrifted() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gem = gemEls[r][c];
      const want = board[r][c];
      if (!gem || Number(gem.dataset.type) !== want) {
        if (gem) gem.remove();
        const fresh = makeGemEl(want);
        cellEls[r][c].appendChild(fresh);
        gemEls[r][c] = fresh;
      }
    }
  }
}

// Visually swap two gems' positions with a short tween (used both for the
// optimistic legal-swap animation and could be reused for reject/bounce).
function animateSwapVisual(a, b) {
  return new Promise((resolve) => {
    const gemA = gemEls[a.r][a.c];
    const gemB = gemEls[b.r][b.c];
    if (!gemA || !gemB) {
      resolve();
      return;
    }
    const cellSize = cellEls[0][0].getBoundingClientRect().width || 1;
    const dx = (b.c - a.c) * cellSize;
    const dy = (b.r - a.r) * cellSize;

    const animA = gemA.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, ${dy}px)` }],
      { duration: 160, easing: 'ease-out', fill: 'forwards' },
    );
    const animB = gemB.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${-dx}px, ${-dy}px)` }],
      { duration: 160, easing: 'ease-out', fill: 'forwards' },
    );

    Promise.all([animA.finished, animB.finished]).then(() => {
      // commit: place gems in their new cells, clear inline transforms
      gemA.style.transform = '';
      gemB.style.transform = '';
      cellEls[b.r][b.c].appendChild(gemA);
      cellEls[a.r][a.c].appendChild(gemB);
      gemEls[a.r][a.c] = gemB;
      gemEls[b.r][b.c] = gemA;
      resolve();
    });
  });
}

// Illegal slide: nudge toward target then bounce back.
function animateRejectedSlide(a, b) {
  return new Promise((resolve) => {
    const gemA = gemEls[a.r][a.c];
    if (!gemA) {
      resolve();
      return;
    }
    const cellSize = cellEls[0][0].getBoundingClientRect().width || 1;
    const dx = (b.c - a.c) * cellSize * 0.35;
    const dy = (b.r - a.r) * cellSize * 0.35;
    const anim = gemA.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0,0)' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
    anim.onfinish = () => resolve();
  });
}

// --- Pointer / drag input --------------------------------------------------
// Drag tracking lives on `document`, not on individual cells, so the
// gesture survives the pointer leaving the origin cell (a per-cell
// pointermove handler would stop receiving events the instant the pointer
// crosses into a neighbouring element's bounding box).

const DRAG_THRESHOLD_PX = 12;

let dragState = null; // { origin: {r,c}, startX, startY, pointerId, resolved }

function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cellEl = el.closest ? el.closest('.cell') : null;
  if (!cellEl) return null;
  const r = Number(cellEl.dataset.r);
  const c = Number(cellEl.dataset.c);
  if (Number.isNaN(r) || Number.isNaN(c)) return null;
  return { r, c };
}

function directionFromDelta(dx, dy) {
  if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { dr: 0, dc: 1 } : { dr: 0, dc: -1 };
  }
  return dy > 0 ? { dr: 1, dc: 0 } : { dr: -1, dc: 0 };
}

function onPointerDown(ev) {
  if (busy) return;
  const cell = cellFromPoint(ev.clientX, ev.clientY);
  if (!cell) return;
  dragState = {
    origin: cell,
    startX: ev.clientX,
    startY: ev.clientY,
    pointerId: ev.pointerId,
    resolved: false,
  };
  // Track everything on document so movement past the origin cell's
  // bounds still reaches this handler.
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
}

function onPointerMove(ev) {
  if (!dragState || dragState.resolved) return;
  if (dragState.pointerId !== ev.pointerId) return;
  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;
  const dir = directionFromDelta(dx, dy);
  if (!dir) return;
  dragState.resolved = true;
  const a = dragState.origin;
  const b = { r: a.r + dir.dr, c: a.c + dir.dc };
  cleanupDrag();
  attemptMove(a, b);
}

function onPointerUp() {
  cleanupDrag();
}

function onPointerCancel() {
  cleanupDrag();
}

function cleanupDrag() {
  dragState = null;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
}

function attachInput() {
  boardEl.addEventListener('pointerdown', onPointerDown);
  // Prevent the browser turning drags into text/image selection or
  // scrolling, which would otherwise fight the gesture on touch devices.
  boardEl.addEventListener('dragstart', (e) => e.preventDefault());
  boardEl.style.touchAction = 'none';
}

// --- Boot ------------------------------------------------------------------

function boot() {
  buildBoardDom();
  renderFull();
  updateScoreHud();
  attachInput();

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
    // Convenience only — the gate drives real drags, not this.
    async slide(r, c, dir) {
      const deltas = {
        up: { dr: -1, dc: 0 },
        down: { dr: 1, dc: 0 },
        left: { dr: 0, dc: -1 },
        right: { dr: 0, dc: 1 },
      };
      const d = deltas[dir];
      if (!d) throw new Error(`unknown direction: ${dir}`);
      const a = { r, c };
      const b = { r: r + d.dr, c: c + d.dc };
      await attemptMove(a, b);
    },
  };

  if (!hasValidMove(board)) {
    // Should not happen given createBoard's guarantee, but stay defensive.
    board = createBoard(ROWS, COLS, TYPES, rng);
    renderFull();
  }
}

boot();
