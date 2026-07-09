import * as game from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

const FEATURE_BONUS_PER_GEM = 30;
const DEVIATION_BONUS = 100;
const BEST_KEY = 'forgefall.bestScore.v1';

const STAGE_THEMES = [
  { name: 'Ashfall Vents', featured: 4 },
  { name: 'Ember Fields', featured: 0 },
  { name: 'Magma Chamber', featured: 2 },
  { name: 'Obsidian Reach', featured: 1 },
  { name: 'Sulfur Caverns', featured: 3 },
  { name: 'The Molten Core', featured: 5 },
];

function rng() {
  return Math.random();
}

function idx(r, c) {
  return r * COLS + c;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cellsEqual(a, b) {
  return a.r === b.r && a.c === b.c;
}

function samePair(p1, a, b) {
  if (!p1) return false;
  return (
    (cellsEqual(p1.a, a) && cellsEqual(p1.b, b)) ||
    (cellsEqual(p1.a, b) && cellsEqual(p1.b, a))
  );
}

// --- persistence -------------------------------------------------------

function loadBest() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY), 10);
    return Number.isFinite(v) ? v : 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch (e) {
    /* ignore */
  }
}

// --- state ---------------------------------------------------------------

const state = {
  board: null,
  score: 0,
  bestScore: loadBest(),
  multiplier: 1,
  growth: [0, 0, 0, 0, 0, 0],
  stage: 0,
  featuredType: null,
  gameOver: false,
  animating: false,
  hint: null,
  lastGain: 0,
  lastBonus: 0,
};

let idleTimerId = null;
let drag = null;

const cellEls = [];
const gemEls = [];
const shapeEls = [];

// --- gem valuation -------------------------------------------------------

function countOnBoard(board, type) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === type) n++;
  return n;
}

function currentGemValue(type, boardForRarity) {
  switch (type) {
    case 0: // Ember — cheap, exponential growth per match
      return Math.min(320, 5 * 2 ** state.growth[0]);
    case 1: // Obsidian — expensive, flat
      return 60;
    case 2: // Magma — grows a fixed amount each time it matches
      return Math.min(200, 20 + 8 * state.growth[2]);
    case 3: { // Sulfur — worth more the rarer it is on the board
      const cnt = countOnBoard(boardForRarity, 3) || 1;
      return Math.round(360 / cnt);
    }
    case 4: // Ash — flat, low
      return 15;
    case 5: // Crystal — worth more in later stages
      return 10 * (1 + state.stage);
    default:
      return 10;
  }
}

// --- DOM construction ------------------------------------------------------

function buildBoardDom() {
  const boardEl = document.getElementById('board');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      const gem = document.createElement('div');
      gem.className = 'gem';

      const shape = document.createElement('div');
      shape.className = 'gem-shape t0';
      shape.style.setProperty('--idle-delay', `${(Math.random() * 3.4).toFixed(2)}s`);

      const facet = document.createElement('span');
      facet.className = 'facet';

      shape.appendChild(facet);
      gem.appendChild(shape);
      cell.appendChild(gem);
      boardEl.appendChild(cell);

      const i = idx(r, c);
      cellEls[i] = cell;
      gemEls[i] = gem;
      shapeEls[i] = shape;

      cell.addEventListener('pointerdown', (e) => onPointerDown(e, r, c));
    }
  }
}

function setCellType(r, c, type) {
  const i = idx(r, c);
  shapeEls[i].className = `gem-shape t${type}`;
  shapeEls[i].style.setProperty('--idle-delay', shapeEls[i].style.getPropertyValue('--idle-delay') || '0s');
  gemEls[i].classList.toggle('featured', state.featuredType != null && type === state.featuredType);
}

function renderFullBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      setCellType(r, c, state.board[r][c]);
      const gem = gemEls[idx(r, c)];
      gem.style.transition = '';
      gem.style.transform = '';
      gem.classList.remove('clearing', 'hinting', 'dragging');
    }
  }
}

function syncBoardVisuals(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      setCellType(r, c, board[r][c]);
      const gem = gemEls[idx(r, c)];
      gem.style.transition = '';
      gem.style.transform = '';
    }
  }
}

function gemWrapEl(r, c) {
  return gemEls[idx(r, c)];
}

function getCellStep() {
  const r0 = cellEls[idx(0, 0)].getBoundingClientRect();
  const r1 = cellEls[idx(0, 1)].getBoundingClientRect();
  return r1.left - r0.left;
}

// --- stage / backdrop ------------------------------------------------------

function applyStage(stageIdx) {
  const themeIdx = ((stageIdx % STAGE_THEMES.length) + STAGE_THEMES.length) % STAGE_THEMES.length;
  const theme = STAGE_THEMES[themeIdx];
  document.body.className = `stage-${themeIdx}`;
  const nameEl = document.getElementById('stageName');
  if (nameEl) nameEl.textContent = theme.name;
  state.featuredType = theme.featured;

  if (state.board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = state.board[r][c];
        gemWrapEl(r, c).classList.toggle('featured', t === state.featuredType);
      }
    }
  }
}

// --- hint / idle -------------------------------------------------------

function findValidMovePair(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

function addHintClasses(pair) {
  gemWrapEl(pair.a.r, pair.a.c).classList.add('hinting');
  gemWrapEl(pair.b.r, pair.b.c).classList.add('hinting');
}

function removeHintClasses(pair) {
  gemWrapEl(pair.a.r, pair.a.c).classList.remove('hinting');
  gemWrapEl(pair.b.r, pair.b.c).classList.remove('hinting');
}

function clearHint() {
  if (state.hint) removeHintClasses(state.hint);
  state.hint = null;
}

function scheduleIdle() {
  clearTimeout(idleTimerId);
  idleTimerId = setTimeout(() => {
    if (state.animating || state.gameOver) return;
    if (!game.hasValidMove(state.board)) return;
    const pair = findValidMovePair(state.board);
    if (!pair) return;
    state.hint = pair;
    addHintClasses(pair);
  }, 10000);
}

// --- HUD / feedback ------------------------------------------------------

function updateHud() {
  document.getElementById('score').textContent = String(state.score);
  document.getElementById('best').textContent = String(state.bestScore);
  const badge = document.getElementById('multBadge');
  badge.textContent = `×${state.multiplier}`;
  badge.classList.remove('pulse');
  void badge.offsetWidth;
  badge.classList.add('pulse');
}

function showFloatingGain(gain, multiplier, deviationBonus, featureBonus) {
  const layer = document.getElementById('floatLayer');
  const el = document.createElement('div');
  el.className = 'float-gain';
  let html = `+${gain}`;
  if (multiplier > 1) html += `<span class="tag">×${multiplier} combo</span>`;
  if (featureBonus > 0) html += `<span class="tag">featured +${featureBonus}</span>`;
  if (deviationBonus > 0) html += `<span class="bonus-tag">+${deviationBonus} off-hint bonus</span>`;
  el.innerHTML = html;
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function showGameOverOverlay() {
  document.getElementById('goScore').textContent = String(state.score);
  document.getElementById('gameOverOverlay').classList.remove('hidden');
}

function hideGameOverOverlay() {
  document.getElementById('gameOverOverlay').classList.add('hidden');
}

// --- animation: swap -------------------------------------------------------

async function animateSwapVisual(a, b) {
  const cellStep = getCellStep();
  const dx = (b.c - a.c) * cellStep;
  const dy = (b.r - a.r) * cellStep;

  const typeA = state.board[a.r][a.c];
  const typeB = state.board[b.r][b.c];

  const gemA = gemWrapEl(a.r, a.c);
  const gemB = gemWrapEl(b.r, b.c);

  // Swap displayed content immediately, then animate each element in from
  // the direction its new content "came from" (the classic fixed-slot trick).
  setCellType(a.r, a.c, typeB);
  setCellType(b.r, b.c, typeA);

  gemA.style.transition = 'none';
  gemB.style.transition = 'none';
  gemA.style.transform = `translate(${dx}px, ${dy}px)`;
  gemB.style.transform = `translate(${-dx}px, ${-dy}px)`;

  void gemA.offsetWidth;

  gemA.style.transition = 'transform 180ms cubic-bezier(.4,0,.2,1)';
  gemB.style.transition = 'transform 180ms cubic-bezier(.4,0,.2,1)';
  gemA.style.transform = 'translate(0,0)';
  gemB.style.transform = 'translate(0,0)';

  await sleep(200);

  gemA.style.transition = '';
  gemB.style.transition = '';
  gemA.style.transform = '';
  gemB.style.transform = '';
}

// --- animation: one cascade wave (clear then drop) --------------------------

async function animateWave(incomingBoard, step) {
  const matched = step.matches;

  for (const { r, c } of matched) gemWrapEl(r, c).classList.add('clearing');
  await sleep(260);
  for (const { r, c } of matched) gemWrapEl(r, c).classList.remove('clearing');

  const cellStep = getCellStep();
  const matchedByCol = new Map();
  for (const { r, c } of matched) {
    if (!matchedByCol.has(c)) matchedByCol.set(c, new Set());
    matchedByCol.get(c).add(r);
  }

  const finalBoard = step.board;
  const animations = [];

  for (const [c, clearedRows] of matchedByCol) {
    const emptyCount = clearedRows.size;
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) if (!clearedRows.has(r)) survivorRows.push(r);

    survivorRows.forEach((origRow, k) => {
      const finalRow = emptyCount + k;
      const displacement = finalRow - origRow;
      if (displacement > 0) {
        animations.push({ r: finalRow, c, type: finalBoard[finalRow][c], originRows: displacement });
      }
    });

    for (let r = 0; r < emptyCount; r++) {
      animations.push({ r, c, type: finalBoard[r][c], originRows: emptyCount });
    }
  }

  if (animations.length === 0) return;

  for (const a of animations) {
    const el = gemWrapEl(a.r, a.c);
    setCellType(a.r, a.c, a.type);
    el.style.transition = 'none';
    el.style.transform = `translateY(${-a.originRows * cellStep}px)`;
  }

  void gemWrapEl(animations[0].r, animations[0].c).offsetWidth;

  const maxDisplacement = animations.reduce((m, a) => Math.max(m, a.originRows), 0);
  const duration = 220 + maxDisplacement * 70;

  for (const a of animations) {
    const el = gemWrapEl(a.r, a.c);
    el.style.transition = `transform ${duration}ms cubic-bezier(.55,.06,.68,.19)`;
    el.style.transform = 'translateY(0)';
  }

  await sleep(duration + 30);

  for (const a of animations) {
    const el = gemWrapEl(a.r, a.c);
    el.style.transition = '';
    el.style.transform = '';
  }
}

// --- move handling ---------------------------------------------------------

async function performMove(a, b) {
  state.animating = true;

  const hintBefore = state.hint;
  clearHint();
  clearTimeout(idleTimerId);

  await animateSwapVisual(a, b);

  const swapped = game.applySwap(state.board, a, b);
  state.board = swapped;

  const { board: settled, steps } = game.collapse(swapped, rng, TYPES);

  // Expose the settled board as the logical state right away — the outcome
  // is decided synchronously; only the on-screen playback of it is paced.
  // `board()` must reflect the true logical state at all times, not lag
  // behind the animation.
  state.board = settled;

  const featuredType = state.featuredType;
  let totalRaw = 0;
  let maxRun = 0;
  let featuredCount = 0;
  let incoming = swapped;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const runLen = game.longestRun(incoming);
    if (runLen > maxRun) maxRun = runLen;

    let waveRaw = 0;
    const typesThisWave = new Set();
    for (const cell of step.matches) {
      const t = incoming[cell.r][cell.c];
      waveRaw += currentGemValue(t, incoming);
      typesThisWave.add(t);
      if (featuredType != null && t === featuredType) featuredCount++;
    }

    const cascadeFactor = i === 0 ? 1 : 2;
    totalRaw += waveRaw * cascadeFactor;

    for (const t of typesThisWave) state.growth[t] += 1;
    incoming = step.board;
  }

  const newMultiplier = steps.length > 0 ? game.matchMultiplier(state.multiplier, maxRun) : state.multiplier;
  const baseGain = Math.round(totalRaw * newMultiplier);
  const featureBonus = featuredCount * FEATURE_BONUS_PER_GEM;
  const deviationBonus = samePair(hintBefore, a, b) ? 0 : (hintBefore ? DEVIATION_BONUS : 0);
  const totalGain = baseGain + featureBonus + deviationBonus;

  state.multiplier = newMultiplier;
  state.score += totalGain;
  state.lastGain = totalGain;
  state.lastBonus = deviationBonus;
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    saveBest(state.bestScore);
  }

  incoming = swapped;
  for (const step of steps) {
    await animateWave(incoming, step);
    incoming = step.board;
  }

  syncBoardVisuals(settled);

  const newStage = game.stageForScore(state.score);
  if (newStage !== state.stage) {
    state.stage = newStage;
    applyStage(newStage);
  }

  updateHud();
  showFloatingGain(totalGain, newMultiplier, deviationBonus, featureBonus);

  state.animating = false;

  if (!game.hasValidMove(state.board)) {
    state.gameOver = true;
    showGameOverOverlay();
  } else {
    scheduleIdle();
  }
}

function rejectNudge(a, b) {
  const cellStep = getCellStep();
  const gemEl = gemWrapEl(a.r, a.c);
  const dx = (b.c - a.c) * cellStep * 0.28;
  const dy = (b.r - a.r) * cellStep * 0.28;
  gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
  setTimeout(() => {
    gemEl.style.transform = '';
  }, 120);
}

function attemptMove(a, b) {
  if (state.animating || state.gameOver) return;
  if (!game.isValidSwap(state.board, a, b)) {
    rejectNudge(a, b);
    return;
  }
  performMove(a, b);
}

// --- pointer / drag gesture --------------------------------------------
// Tracked on `document`, not per-cell, so the drag survives the pointer
// leaving the origin cell. The move is decided at release, from net
// displacement — a return-to-origin release commits nothing.

function onPointerDown(e, r, c) {
  if (state.animating || state.gameOver) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();

  const rect = cellEls[idx(r, c)].getBoundingClientRect();
  drag = {
    r, c,
    startX: e.clientX,
    startY: e.clientY,
    dx: 0,
    dy: 0,
    cellSize: rect.width,
  };

  const gemEl = gemWrapEl(r, c);
  gemEl.classList.add('dragging');

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  drag.dx = dx;
  drag.dy = dy;
  const max = drag.cellSize * 0.95;
  const cx = clamp(dx, -max, max);
  const cy = clamp(dy, -max, max);
  gemWrapEl(drag.r, drag.c).style.transform = `translate(${cx}px, ${cy}px)`;
}

function onPointerUp() {
  if (!drag) return;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);

  const { r, c, dx, dy, cellSize } = drag;
  drag = null;

  const gemEl = gemWrapEl(r, c);
  gemEl.classList.remove('dragging');
  gemEl.style.transform = '';

  const threshold = cellSize * 0.32;
  const mag = Math.max(Math.abs(dx), Math.abs(dy));
  if (mag < threshold) return; // released back near origin: cancel, no move

  let dr = 0, dc = 0;
  if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;

  const tr = r + dr, tc = c + dc;
  if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return; // off-board: cancel

  attemptMove({ r, c }, { r: tr, c: tc });
}

// --- embers decoration -------------------------------------------------

function spawnEmbers(n) {
  const layer = document.getElementById('embers');
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'ember';
    el.style.left = `${Math.random() * 100}%`;
    el.style.setProperty('--drift', `${(Math.random() * 60 - 30).toFixed(0)}px`);
    const duration = 7 + Math.random() * 9;
    el.style.animationDuration = `${duration.toFixed(2)}s`;
    el.style.animationDelay = `${(Math.random() * duration).toFixed(2)}s`;
    el.style.width = el.style.height = `${3 + Math.random() * 5}px`;
    layer.appendChild(el);
  }
}

// --- new game / init -------------------------------------------------------

function newGame() {
  clearHint();
  clearTimeout(idleTimerId);

  state.board = game.createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.multiplier = 1;
  state.growth = [0, 0, 0, 0, 0, 0];
  state.stage = 0;
  state.gameOver = false;
  state.lastGain = 0;
  state.lastBonus = 0;

  applyStage(0);
  renderFullBoard();
  updateHud();
  hideGameOverOverlay();
  scheduleIdle();
}

function slideHelper(r, c, dir) {
  return new Promise((resolve) => {
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const d = deltas[dir];
    if (!d) return resolve(false);
    const a = { r, c };
    const b = { r: r + d[0], c: c + d[1] };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return resolve(false);
    if (state.animating || state.gameOver) return resolve(false);
    if (!game.isValidSwap(state.board, a, b)) return resolve(false);
    performMove(a, b).then(() => resolve(true));
  });
}

function init() {
  buildBoardDom();
  spawnEmbers(22);
  newGame();
  document.getElementById('newGameBtn').addEventListener('click', newGame);

  window.__test = {
    score: () => state.score,
    lastGain: () => state.lastGain,
    lastBonus: () => state.lastBonus,
    multiplier: () => state.multiplier,
    gemValues: () => [0, 1, 2, 3, 4, 5].map((t) => currentGemValue(t, state.board)),
    stage: () => state.stage,
    featuredType: () => (state.featuredType == null ? null : state.featuredType),
    bestScore: () => state.bestScore,
    validMove: () => findValidMovePair(state.board),
    board: () => state.board.map((row) => row.slice()),
    gameOver: () => state.gameOver,
    hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
    slide: slideHelper,
  };
}

init();
