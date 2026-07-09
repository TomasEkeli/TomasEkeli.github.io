import {
  createBoard,
  findMatches,
  isValidSwap,
  hasValidMove,
  applySwap,
  collapse,
  longestRun,
  matchMultiplier,
  stageForScore,
} from './game.js';

// ---------------------------------------------------------------------------
// Constants & gem design
// ---------------------------------------------------------------------------

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const BEST_KEY = 'crystalCavern.bestScore.v1';
const IDLE_MS = 10000;
const DEVIATION_BONUS = 100;
const FEATURE_BONUS_PER_GEM = 25;

// Each gem type: a name, a shape class (colour-blind-safe silhouette), and a
// scoring rule that reads current game state and returns this gem's current
// per-matched-gem value. Deliberately varied, per the spec.
const GEM_TYPES = [
  {
    name: 'Teal Quartz',
    shape: 'shape-circle',
    value(state) {
      // cheap, but exponential with repeated matches — capped so it can't run away.
      return Math.min(320, 5 * Math.pow(2, state.timesMatched[0]));
    },
  },
  {
    name: 'Sunstone',
    shape: 'shape-hexagon',
    value() {
      // expensive, flat — never scales.
      return 55;
    },
  },
  {
    name: 'Rose Spinel',
    shape: 'shape-diamond',
    value(state) {
      // grows a little every time it's matched this playthrough.
      return Math.min(400, 10 + 6 * state.timesMatched[2]);
    },
  },
  {
    name: 'Amethyst Shard',
    shape: 'shape-pentagon',
    value(state, board) {
      // worth more the rarer it currently is on the board.
      let count = 0;
      for (const row of board) for (const v of row) if (v === 3) count++;
      count = Math.max(1, count);
      return Math.min(300, Math.max(20, Math.round(300 / count)));
    },
  },
  {
    name: 'Citrine Blaze',
    shape: 'shape-triangle',
    value(state) {
      // steps up every few matches rather than every single one.
      return 18 + 6 * Math.floor(state.timesMatched[4] / 3);
    },
  },
  {
    name: 'Frost Sapphire',
    shape: 'shape-star',
    value(state) {
      // scales with how deep into the cavern (stage) the player has gone.
      return 12 * (1 + state.stage);
    },
  },
];

// Themed stage sequence — a descent through the cavern. Cycles once past the
// end. `featured` (or null) names the gem type spotlighted for bonus points.
const STAGES = [
  { name: 'Cave Mouth', featured: null,
    bg: 'radial-gradient(120% 90% at 50% -10%, #3a4550 0%, #1c232b 45%, #0a0d10 100%)' },
  { name: 'Quartz Gallery', featured: 0,
    bg: 'radial-gradient(120% 90% at 30% -10%, #103d3a 0%, #0b2320 50%, #050a0a 100%)' },
  { name: 'Ember Vein', featured: 4,
    bg: 'radial-gradient(120% 90% at 70% -10%, #4a2410 0%, #24130a 50%, #0a0704 100%)' },
  { name: 'Rose Grotto', featured: 2,
    bg: 'radial-gradient(120% 90% at 40% -10%, #3d1626 0%, #240d18 50%, #0a0508 100%)' },
  { name: 'Amethyst Deep', featured: 3,
    bg: 'radial-gradient(120% 90% at 60% -10%, #2c1650 0%, #180b30 50%, #070414 100%)' },
  { name: 'Frostlight Hollow', featured: 5,
    bg: 'radial-gradient(120% 90% at 35% -10%, #123145 0%, #0a1c28 50%, #030a10 100%)' },
  { name: 'Golden Reliquary', featured: 1,
    bg: 'radial-gradient(120% 90% at 65% -10%, #4a3a0c 0%, #2a2008 50%, #0c0902 100%)' },
  { name: 'Starlit Abyss', featured: null,
    bg: 'radial-gradient(120% 90% at 50% -10%, #10101c 0%, #05050c 55%, #000000 100%)' },
];

function stageFor(stage) {
  return STAGES[stage % STAGES.length];
}

// ---------------------------------------------------------------------------
// Mutable game state
// ---------------------------------------------------------------------------

const S = {
  board: null,
  score: 0,
  bestScore: 0,
  multiplier: 1,
  lastGain: 0,
  lastBonus: 0,
  timesMatched: new Array(TYPES).fill(0),
  stage: 0,
  gameOver: false,
  animating: false,
  hint: null, // { a, b } | null — currently displayed hint
  hintTimer: null,
};

function rng() {
  return Math.random();
}

function loadBest() {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* ignore (private mode, etc.) */
  }
}

// ---------------------------------------------------------------------------
// DOM references (built once)
// ---------------------------------------------------------------------------

const boardEl = document.getElementById('board');
const fxLayer = document.getElementById('fxLayer');
const popupLayer = document.getElementById('popupLayer');
const gameOverPanel = document.getElementById('gameOverPanel');
const finalScoreEl = document.getElementById('finalScore');
const newGameBtn = document.getElementById('newGameBtn');
const scoreVal = document.getElementById('scoreVal');
const bestVal = document.getElementById('bestVal');
const multVal = document.getElementById('multVal');
const stageNameEl = document.getElementById('stageName');
const strataEl = document.getElementById('strata');

const cellEls = []; // 64 fixed <div data-testid="cell"> elements, row-major

function buildBoardDom() {
  boardEl.innerHTML = '';
  cellEls.length = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      const wrap = document.createElement('div');
      wrap.className = 'gem-wrap';
      cell.appendChild(wrap);

      cell.addEventListener('pointerdown', onPointerDown);
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }
  }
}

function cellEl(r, c) {
  return cellEls[r * COLS + c];
}

function gemFragment(type, extraClass) {
  const def = GEM_TYPES[type];
  const shape = document.createElement('div');
  shape.className = `gem-shape ${def.shape} type-${type}${extraClass ? ' ' + extraClass : ''}`;
  shape.style.setProperty('--float-delay', `${(type * 0.37) % 2}s`);
  const face = document.createElement('div');
  face.className = 'gem-face';
  shape.appendChild(face);
  return shape;
}

function renderBoardStatic(board) {
  const featured = stageFor(S.stage).featured;
  const hintKeys = S.hint ? new Set([key(S.hint.a), key(S.hint.b)]) : null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = cellEl(r, c);
      const wrap = cell.firstChild;
      wrap.innerHTML = '';
      const type = board[r][c];
      const extra = [];
      if (featured === type) extra.push('featured');
      if (hintKeys && hintKeys.has(r + ',' + c)) extra.push('hint');
      const gem = gemFragment(type, extra.join(' '));
      wrap.appendChild(gem);
    }
  }
}

function key(cell) {
  return cell.r + ',' + cell.c;
}

function pairKey(a, b) {
  const ka = key(a), kb = key(b);
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
}

function pairsEqual(p1, p2) {
  if (!p1 || !p2) return false;
  return pairKey(p1.a, p1.b) === pairKey(p2.a, p2.b);
}

// ---------------------------------------------------------------------------
// Scoring composition (per contract §"Scoring — colour values...")
// ---------------------------------------------------------------------------

function gemValuesNow(board) {
  return GEM_TYPES.map((def) => Math.round(def.value(S, board)));
}

function featuredType() {
  const f = stageFor(S.stage).featured;
  return f === null || f === undefined ? null : f;
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHUD() {
  scoreVal.textContent = Math.round(S.score).toLocaleString();
  bestVal.textContent = Math.round(S.bestScore).toLocaleString();
  multVal.textContent = '×' + S.multiplier;
  stageNameEl.textContent = stageFor(S.stage).name;
}

function applyStageTheme() {
  strataEl.style.background = stageFor(S.stage).bg;
}

// ---------------------------------------------------------------------------
// Idle hint
// ---------------------------------------------------------------------------

function findAnyValidMove(board) {
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

function clearHint() {
  if (!S.hint) return;
  S.hint = null;
  renderBoardStatic(S.board);
}

function resetIdleTimer() {
  if (S.hintTimer) clearTimeout(S.hintTimer);
  clearHint();
  if (S.gameOver) return;
  S.hintTimer = setTimeout(() => {
    if (S.gameOver || S.animating) return;
    const mv = findAnyValidMove(S.board);
    if (mv) {
      S.hint = mv;
      renderBoardStatic(S.board);
    }
  }, IDLE_MS);
}

// ---------------------------------------------------------------------------
// Geometry helpers for FX animation
// ---------------------------------------------------------------------------

function rectFor(r, c) {
  const cellRect = cellEl(r, c).getBoundingClientRect();
  const fxRect = fxLayer.getBoundingClientRect();
  return {
    x: cellRect.left - fxRect.left,
    y: cellRect.top - fxRect.top,
    w: cellRect.width,
    h: cellRect.height,
  };
}

function makeClone(type, rect) {
  const div = document.createElement('div');
  div.className = 'fx-gem-clone';
  div.style.left = rect.x + 'px';
  div.style.top = rect.y + 'px';
  div.style.width = rect.w + 'px';
  div.style.height = rect.h + 'px';
  div.appendChild(gemFragment(type));
  fxLayer.appendChild(div);
  return div;
}

function setCellHidden(r, c, hidden) {
  const shape = cellEl(r, c).firstChild.firstChild;
  if (shape) shape.classList.toggle('gem-hidden', hidden);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Wave animation: clear, then accelerating gravity drop.
// ---------------------------------------------------------------------------

async function animateClear(incoming, matches) {
  for (const { r, c } of matches) {
    const shape = cellEl(r, c).firstChild.firstChild;
    if (shape) shape.classList.add('clearing');
  }
  await wait(220);
}

async function animateGravity(incoming, outgoing, matches) {
  const matchKeys = new Set(matches.map((m) => m.r + ',' + m.c));
  const rowH = rectFor(0, 0).h;
  const clones = [];
  let maxDuration = 0;

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchKeys.has(r + ',' + c)) survivors.push({ fromRow: r, value: incoming[r][c] });
    }
    const k = ROWS - survivors.length; // number of refills landing in this column

    survivors.forEach((s, idx) => {
      const toRow = k + idx;
      setCellHidden(s.fromRow, c, true);
      setCellHidden(toRow, c, true);
      const fromRect = rectFor(s.fromRow, c);
      const toRect = rectFor(toRow, c);
      const clone = makeClone(s.value, fromRect);
      clones.push(clone);
      const dist = toRow - s.fromRow;
      if (dist === 0) return;
      const duration = 260 + dist * 70;
      maxDuration = Math.max(maxDuration, duration);
      requestAnimationFrame(() => {
        clone.style.transition = `transform ${duration}ms cubic-bezier(.55,.09,.68,.3)`;
        clone.style.transform = `translate(${toRect.x - fromRect.x}px, ${toRect.y - fromRect.y}px)`;
      });
    });

    for (let idx = 0; idx < k; idx++) {
      const toRow = idx;
      const value = outgoing[toRow][c];
      setCellHidden(toRow, c, true);
      const toRect = rectFor(toRow, c);
      const dist = k - idx;
      const fromRect = { x: toRect.x, y: toRect.y - dist * rowH - 10, w: toRect.w, h: toRect.h };
      const clone = makeClone(value, fromRect);
      clones.push(clone);
      const duration = 260 + dist * 70;
      maxDuration = Math.max(maxDuration, duration);
      requestAnimationFrame(() => {
        clone.style.transition = `transform ${duration}ms cubic-bezier(.55,.09,.68,.3)`;
        clone.style.transform = `translate(0px, ${toRect.y - fromRect.y}px)`;
      });
    }
  }

  await wait(maxDuration + 40);
  for (const clone of clones) clone.remove();
  renderBoardStatic(outgoing);
}

async function animateWave(incoming, step) {
  await animateClear(incoming, step.matches);
  await animateGravity(incoming, step.board, step.matches);
}

// ---------------------------------------------------------------------------
// Swap animation (the drag-driven move)
// ---------------------------------------------------------------------------

function offsetBetween(a, b) {
  const ra = cellEl(a.r, a.c).getBoundingClientRect();
  const rb = cellEl(b.r, b.c).getBoundingClientRect();
  return { dx: rb.left - ra.left, dy: rb.top - ra.top };
}

async function animateSwapTo(aShape, bShape, offAB, offBA, duration) {
  aShape.style.transition = `transform ${duration}ms ease-out`;
  bShape.style.transition = `transform ${duration}ms ease-out`;
  aShape.style.transform = `translate(${offAB.dx}px, ${offAB.dy}px)`;
  bShape.style.transform = `translate(${offBA.dx}px, ${offBA.dy}px)`;
  await wait(duration);
}

// ---------------------------------------------------------------------------
// Floating gain popup
// ---------------------------------------------------------------------------

function showGainPopup(gain, multiplier, bonus, featureBonus) {
  const pop = document.createElement('div');
  pop.className = 'gain-pop';
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = '+' + Math.round(gain).toLocaleString();
  pop.appendChild(big);

  const tags = document.createElement('div');
  const multTag = document.createElement('span');
  multTag.className = 'tag mult';
  multTag.textContent = '×' + multiplier + ' combo';
  tags.appendChild(multTag);

  if (featureBonus > 0) {
    const fTag = document.createElement('span');
    fTag.className = 'tag feature';
    fTag.textContent = '+' + featureBonus + ' featured';
    tags.appendChild(fTag);
  }

  if (bonus > 0) {
    const bTag = document.createElement('span');
    bTag.className = 'tag bonus';
    bTag.textContent = '+' + bonus + ' bonus!';
    tags.appendChild(bTag);
  }
  pop.appendChild(tags);
  popupLayer.appendChild(pop);
  setTimeout(() => pop.remove(), 1650);
}

// ---------------------------------------------------------------------------
// Core move pipeline
// ---------------------------------------------------------------------------

async function attemptMove(a, b, hintSnapshot, shapeA) {
  S.animating = true;
  boardEl.classList.add('locked');

  const valid = isValidSwap(S.board, a, b);
  const off = offsetBetween(a, b);
  const back = { dx: -off.dx, dy: -off.dy };
  const shapeB = cellEl(b.r, b.c).firstChild.firstChild;

  if (!valid) {
    await animateSwapTo(shapeA, shapeB, off, back, 150);
    await wait(90);
    await animateSwapTo(shapeA, shapeB, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, 150);
    shapeA.style.transition = '';
    shapeB.style.transition = '';
    shapeA.style.transform = '';
    shapeB.style.transform = '';
    S.animating = false;
    boardEl.classList.remove('locked');
    resetIdleTimer();
    return;
  }

  await animateSwapTo(shapeA, shapeB, off, back, 150);

  const swappedBoard = applySwap(S.board, a, b);
  shapeA.style.transition = '';
  shapeB.style.transition = '';
  shapeA.style.transform = '';
  shapeB.style.transform = '';
  S.board = swappedBoard;
  renderBoardStatic(swappedBoard);

  const { board: settled, steps } = collapse(swappedBoard, rng, TYPES);

  let incoming = swappedBoard;
  let totalRaw = 0;
  let maxRun = 0;
  let featureCount = 0;
  const featured = featuredType();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const runLen = longestRun(incoming);
    if (runLen > maxRun) maxRun = runLen;

    const values = gemValuesNow(incoming);
    let waveRaw = 0;
    const seenTypes = new Set();
    for (const cell of step.matches) {
      const t = incoming[cell.r][cell.c];
      waveRaw += values[t];
      seenTypes.add(t);
      if (featured !== null && t === featured) featureCount++;
    }
    const cascadeFactor = i === 0 ? 1 : 2;
    totalRaw += waveRaw * cascadeFactor;
    for (const t of seenTypes) S.timesMatched[t]++;

    await animateWave(incoming, step);
    incoming = step.board;
  }

  const newMultiplier = matchMultiplier(S.multiplier, maxRun || 0);
  const stageFeatureBonus = featureCount * FEATURE_BONUS_PER_GEM;
  const deviation = hintSnapshot && !pairsEqual(hintSnapshot, { a, b }) ? DEVIATION_BONUS : 0;
  const gain = totalRaw * newMultiplier + stageFeatureBonus + deviation;

  S.multiplier = newMultiplier;
  S.score += gain;
  S.lastGain = gain;
  S.lastBonus = deviation;
  S.board = settled;
  if (S.score > S.bestScore) {
    S.bestScore = S.score;
    saveBest(S.bestScore);
  }
  S.stage = stageForScore(S.score);

  renderBoardStatic(S.board);
  updateHUD();
  applyStageTheme();
  showGainPopup(gain, newMultiplier, deviation, stageFeatureBonus);

  S.animating = false;
  boardEl.classList.remove('locked');

  if (!hasValidMove(S.board)) {
    enterGameOver();
  } else {
    resetIdleTimer();
  }
}

function enterGameOver() {
  S.gameOver = true;
  if (S.hintTimer) clearTimeout(S.hintTimer);
  S.hint = null;
  finalScoreEl.textContent = Math.round(S.score).toLocaleString();
  gameOverPanel.classList.add('show');
  newGameBtn.classList.add('urge');
}

// ---------------------------------------------------------------------------
// Drag / slide gesture
// ---------------------------------------------------------------------------

let drag = null; // { origin, startX, startY, lastX, lastY, hintSnapshot, shape }

function onPointerDown(ev) {
  if (S.animating || S.gameOver) return;
  const cell = ev.currentTarget;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const shape = cell.firstChild.firstChild;
  if (!shape) return;

  drag = {
    origin: { r, c },
    startX: ev.clientX,
    startY: ev.clientY,
    lastX: ev.clientX,
    lastY: ev.clientY,
    hintSnapshot: S.hint,
    shape,
  };
  shape.classList.add('dragging');
  clearHint();

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!drag) return;
  drag.lastX = ev.clientX;
  drag.lastY = ev.clientY;
  const cellSize = cellEl(0, 0).getBoundingClientRect().width;
  let dx = ev.clientX - drag.startX;
  let dy = ev.clientY - drag.startY;
  const max = cellSize * 0.9;
  dx = Math.max(-max, Math.min(max, dx));
  dy = Math.max(-max, Math.min(max, dy));
  drag.shape.style.transform = `translate(${dx}px, ${dy}px)`;
}

function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  if (!drag) return;

  const { origin, startX, startY, lastX, lastY, hintSnapshot, shape } = drag;
  drag = null;
  shape.classList.remove('dragging');

  const cellSize = cellEl(0, 0).getBoundingClientRect().width;
  const dx = lastX - startX;
  const dy = lastY - startY;
  const threshold = cellSize * 0.3;

  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) {
    shape.style.transition = 'transform 160ms ease-out';
    shape.style.transform = 'translate(0px, 0px)';
    setTimeout(() => {
      shape.style.transition = '';
    }, 180);
    resetIdleTimer();
    return;
  }

  let target;
  if (Math.abs(dx) > Math.abs(dy)) {
    target = { r: origin.r, c: origin.c + (dx > 0 ? 1 : -1) };
  } else {
    target = { r: origin.r + (dy > 0 ? 1 : -1), c: origin.c };
  }

  if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    shape.style.transition = 'transform 160ms ease-out';
    shape.style.transform = 'translate(0px, 0px)';
    setTimeout(() => {
      shape.style.transition = '';
    }, 180);
    resetIdleTimer();
    return;
  }

  shape.style.transform = 'translate(0px, 0px)';
  attemptMove(origin, target, hintSnapshot, shape);
}

// ---------------------------------------------------------------------------
// New game / init
// ---------------------------------------------------------------------------

function startNewGame() {
  if (S.hintTimer) clearTimeout(S.hintTimer);
  S.board = createBoard(ROWS, COLS, TYPES, rng);
  S.score = 0;
  S.multiplier = 1;
  S.lastGain = 0;
  S.lastBonus = 0;
  S.timesMatched = new Array(TYPES).fill(0);
  S.stage = 0;
  S.gameOver = false;
  S.animating = false;
  S.hint = null;
  gameOverPanel.classList.remove('show');
  newGameBtn.classList.remove('urge');
  boardEl.classList.remove('locked');

  renderBoardStatic(S.board);
  updateHUD();
  applyStageTheme();
  resetIdleTimer();
}

newGameBtn.addEventListener('click', startNewGame);

// ---------------------------------------------------------------------------
// Public test hooks (observation only — see contract.md)
// ---------------------------------------------------------------------------

window.__test = {
  score: () => S.score,
  lastGain: () => S.lastGain,
  lastBonus: () => S.lastBonus,
  multiplier: () => S.multiplier,
  gemValues: () => gemValuesNow(S.board),
  stage: () => S.stage,
  featuredType: () => featuredType(),
  bestScore: () => S.bestScore,
  validMove: () => findAnyValidMove(S.board),
  board: () => S.board.map((row) => row.slice()),
  gameOver: () => S.gameOver,
  hint: () => (S.hint ? { a: { ...S.hint.a }, b: { ...S.hint.b } } : null),
  slide: (r, c, dir) => {
    const origin = { r, c };
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const d = deltas[dir];
    if (!d) return Promise.resolve();
    const target = { r: r + d[0], c: c + d[1] };
    if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) return Promise.resolve();
    if (S.animating || S.gameOver) return Promise.resolve();
    const shape = cellEl(origin.r, origin.c).firstChild.firstChild;
    if (!shape) return Promise.resolve();
    const hintSnapshot = S.hint;
    clearHint();
    return attemptMove(origin, target, hintSnapshot, shape);
  },
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

S.bestScore = loadBest();
buildBoardDom();
startNewGame();
