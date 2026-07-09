import * as game from './game.js';

// ---------- config ----------

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const CLEAR_MS = 200;
const SWAP_MS = 160;
const BOUNCE_MS = 220;
const DRAG_THRESHOLD_RATIO = 0.28; // fraction of a cell needed to commit a slide

const SHAPES = ['shape-circle', 'shape-diamond', 'shape-hexagon', 'shape-triangle', 'shape-pentagon', 'shape-star'];

function rng() {
  return Math.random();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- state ----------

let board = game.createBoard(ROWS, COLS, TYPES, rng);
let score = 0;
let lastGain = 0;
let animating = false;

// ---------- DOM setup ----------

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const gainLayer = document.getElementById('gain-layer');

/** @type {{cellEl: HTMLElement, gemEl: HTMLElement, facetEl: HTMLElement}[][]} */
const cells = [];

function buildDom() {
  boardEl.innerHTML = '';
  cells.length = 0;
  for (let r = 0; r < ROWS; r++) {
    const rowCells = [];
    for (let c = 0; c < COLS; c++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.dataset.r = String(r);
      cellEl.dataset.c = String(c);

      const gemEl = document.createElement('div');
      gemEl.className = 'gem';
      gemEl.style.setProperty('--idle-delay', `${((r * COLS + c) % 11) * 0.27}s`);

      const facetEl = document.createElement('div');
      facetEl.className = 'facet';
      const shineEl = document.createElement('div');
      shineEl.className = 'shine';
      const glintEl = document.createElement('div');
      glintEl.className = 'glint';

      gemEl.appendChild(facetEl);
      gemEl.appendChild(shineEl);
      gemEl.appendChild(glintEl);
      cellEl.appendChild(gemEl);
      boardEl.appendChild(cellEl);

      rowCells.push({ cellEl, gemEl, facetEl });
    }
    cells.push(rowCells);
  }
}

function setGemType(r, c, type) {
  const { gemEl } = cells[r][c];
  gemEl.classList.remove(...SHAPES, 'type-0', 'type-1', 'type-2', 'type-3', 'type-4', 'type-5');
  gemEl.classList.add(SHAPES[type % SHAPES.length], `type-${type}`);
  gemEl.dataset.type = String(type);
}

function renderBoardState(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      setGemType(r, c, b[r][c]);
      const { gemEl } = cells[r][c];
      gemEl.classList.remove('matched', 'dragging');
      gemEl.style.transition = 'none';
      gemEl.style.transform = 'translate(0px, 0px)';
      gemEl.style.opacity = '1';
      // force reflow so the next transition (if any) starts clean
      void gemEl.offsetWidth;
      gemEl.style.transition = '';
    }
  }
}

buildDom();
renderBoardState(board);
updateScoreHud();

// ---------- geometry ----------

function cellSize() {
  const rect = boardEl.getBoundingClientRect();
  return { w: rect.width / COLS, h: rect.height / ROWS, rect };
}

function cellFromPoint(clientX, clientY) {
  const { w, h, rect } = cellSize();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const c = Math.floor(x / w);
  const r = Math.floor(y / h);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

// ---------- drag handling (tracked on document so it survives leaving the
// origin cell — see contract.md's warning about per-cell handlers) ----------

let drag = null; // { r, c, startX, startY, axis, pointerId }

boardEl.addEventListener('pointerdown', (e) => {
  if (animating) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;
  drag = {
    r: cell.r,
    c: cell.c,
    startX: e.clientX,
    startY: e.clientY,
    axis: null,
    pointerId: e.pointerId,
  };
  const { gemEl } = cells[cell.r][cell.c];
  gemEl.classList.add('dragging');
  gemEl.style.transition = 'none';
  boardEl.classList.add('no-idle');
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  e.preventDefault();
});

function onPointerMove(e) {
  if (!drag) return;
  const { w, h } = cellSize();
  let dx = e.clientX - drag.startX;
  let dy = e.clientY - drag.startY;

  if (!drag.axis) {
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
  }
  if (drag.axis === 'x') dy = 0;
  if (drag.axis === 'y') dx = 0;

  // clamp visual drag to one cell of travel
  dx = Math.max(-w, Math.min(w, dx));
  dy = Math.max(-h, Math.min(h, dy));

  const { gemEl } = cells[drag.r][drag.c];
  gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

function onPointerUp(e) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  if (!drag) return;

  const { r, c } = drag;
  const { w, h } = cellSize();
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  const { gemEl } = cells[r][c];
  gemEl.classList.remove('dragging');
  drag = null;

  let dir = null;
  if (Math.abs(dx) > w * DRAG_THRESHOLD_RATIO || Math.abs(dy) > h * DRAG_THRESHOLD_RATIO) {
    if (Math.abs(dx) > Math.abs(dy)) {
      dir = dx > 0 ? { dr: 0, dc: 1 } : { dr: 0, dc: -1 };
    } else {
      dir = dy > 0 ? { dr: 1, dc: 0 } : { dr: -1, dc: 0 };
    }
  }

  if (!dir) {
    springBack(gemEl);
    return;
  }

  const target = { r: r + dir.dr, c: c + dir.dc };
  if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    springBack(gemEl);
    return;
  }

  attemptMove({ r, c }, target);
}

function springBack(gemEl) {
  gemEl.style.transition = `transform ${BOUNCE_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  gemEl.style.transform = 'translate(0px, 0px)';
  setTimeout(() => {
    gemEl.style.transition = '';
    boardEl.classList.remove('no-idle');
  }, BOUNCE_MS + 20);
}

// ---------- move resolution ----------

async function attemptMove(a, b) {
  if (animating) return;
  if (!game.isValidSwap(board, a, b)) {
    await bounceInvalid(a, b);
    return;
  }

  animating = true;
  boardEl.classList.add('no-idle');
  try {
    await animateSwap(a, b);
    const swapped = game.applySwap(board, a, b);
    board = swapped;
    renderBoardState(board);

    const { board: settled, steps } = game.collapse(board, rng, TYPES);
    const waves = steps.map((s) => s.matches);
    const gain = game.scoreCascade(waves);

    for (const step of steps) {
      await playWave(step);
    }

    board = settled;
    renderBoardState(board);

    if (gain > 0) {
      score += gain;
      lastGain = gain;
      updateScoreHud();
      popGain(gain);
    }
  } finally {
    animating = false;
    boardEl.classList.remove('no-idle');
  }
}

async function bounceInvalid(a, b) {
  animating = true;
  boardEl.classList.add('no-idle');
  const { w, h } = cellSize();
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  const dx = dc * w * 0.35;
  const dy = dr * h * 0.35;
  const gemA = cells[a.r][a.c].gemEl;
  gemA.style.transition = `transform ${BOUNCE_MS / 2}ms ease-out`;
  gemA.style.transform = `translate(${dx}px, ${dy}px)`;
  await sleep(BOUNCE_MS / 2);
  gemA.style.transition = `transform ${BOUNCE_MS / 2}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  gemA.style.transform = 'translate(0px, 0px)';
  await sleep(BOUNCE_MS / 2 + 20);
  gemA.style.transition = '';
  animating = false;
  boardEl.classList.remove('no-idle');
}

function animateSwap(a, b) {
  return new Promise((resolve) => {
    const { w, h } = cellSize();
    const dr = b.r - a.r;
    const dc = b.c - a.c;
    const gemA = cells[a.r][a.c].gemEl;
    const gemB = cells[b.r][b.c].gemEl;

    gemA.style.transition = `transform ${SWAP_MS}ms ease-out`;
    gemB.style.transition = `transform ${SWAP_MS}ms ease-out`;
    // ensure starting from current drag offset (or 0) before animating to full cell
    requestAnimationFrame(() => {
      gemA.style.transform = `translate(${dc * w}px, ${dr * h}px)`;
      gemB.style.transform = `translate(${-dc * w}px, ${-dr * h}px)`;
    });

    setTimeout(() => {
      gemA.style.transition = '';
      gemB.style.transition = '';
      resolve();
    }, SWAP_MS + 20);
  });
}

// Compute, for every destination cell in `nextBoard`, where its gem is
// falling from: either a surviving gem's previous row in the same column, or
// above the board (a fresh refill).
function computeDropPlan(matches, nextBoard) {
  const matchedSet = new Set(matches.map((m) => `${m.r},${m.c}`));
  const plan = [];
  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(`${r},${c}`)) survivorRows.push(r);
    }
    const emptyCount = ROWS - survivorRows.length;
    for (let i = 0; i < survivorRows.length; i++) {
      const toR = emptyCount + i;
      plan.push({ toR, toC: c, fromR: survivorRows[i], value: nextBoard[toR][c] });
    }
    for (let r = 0; r < emptyCount; r++) {
      plan.push({ toR: r, toC: c, fromR: r - emptyCount, value: nextBoard[r][c] });
    }
  }
  return plan;
}

async function playWave(step) {
  const { matches, board: nextBoard } = step;

  // 1. clear: highlight matched gems briefly, then they vanish
  for (const { r, c } of matches) {
    cells[r][c].gemEl.classList.add('matched');
  }
  await sleep(CLEAR_MS);
  for (const { r, c } of matches) {
    cells[r][c].gemEl.style.opacity = '0';
  }

  // 2. drop: reposition every cell's gem to its resolved value, offset to its
  // "from" position with transitions disabled, then transition to rest with
  // an accelerating (ease-in) curve — a physical, gravity-like fall.
  const { h: cellH } = cellSize();
  const plan = computeDropPlan(matches, nextBoard);
  let maxDuration = 0;

  for (const { toR, toC, fromR, value } of plan) {
    const { gemEl } = cells[toR][toC];
    gemEl.classList.remove('matched');
    gemEl.style.transition = 'none';
    setGemType(toR, toC, value);
    const offsetRows = fromR - toR; // negative or zero: gem starts above its slot
    gemEl.style.transform = `translate(0px, ${offsetRows * cellH}px)`;
    gemEl.style.opacity = '1';
  }

  // force reflow before enabling transitions
  void boardEl.offsetHeight;

  for (const { toR, toC, fromR } of plan) {
    const dist = Math.abs(toR - fromR);
    const duration = 130 + dist * 85;
    maxDuration = Math.max(maxDuration, duration);
    const { gemEl } = cells[toR][toC];
    gemEl.style.transition = `transform ${duration}ms cubic-bezier(0.55, 0.06, 0.68, 0.19)`;
    gemEl.style.transform = 'translate(0px, 0px)';
  }

  await sleep(maxDuration + 30);

  for (const { toR, toC } of plan) {
    cells[toR][toC].gemEl.style.transition = '';
  }
}

// ---------- HUD ----------

function updateScoreHud() {
  scoreEl.textContent = String(score);
}

function popGain(gain) {
  const el = document.createElement('div');
  el.className = 'gain-pop';
  el.textContent = `+${gain}`;
  el.style.left = '50%';
  el.style.transform = 'translateX(-50%)';
  gainLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1600);
}

// ---------- observation hooks ----------

function findAnyValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) {
        const a = { r, c };
        const b = { r, c: c + 1 };
        if (game.isValidSwap(board, a, b)) return { a, b };
      }
      if (r + 1 < ROWS) {
        const a = { r, c };
        const b = { r: r + 1, c };
        if (game.isValidSwap(board, a, b)) return { a, b };
      }
    }
  }
  return null;
}

window.__test = {
  score() {
    return score;
  },
  lastGain() {
    return lastGain;
  },
  validMove() {
    return findAnyValidMove();
  },
  // Convenience only — the gate drives moves via a real drag, not this hook.
  async slide(r, c, dir) {
    const deltas = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };
    const d = deltas[dir];
    if (!d) return false;
    const a = { r, c };
    const b = { r: r + d.r, c: c + d.c };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return false;
    const before = score;
    await attemptMove(a, b);
    return score !== before;
  },
};
