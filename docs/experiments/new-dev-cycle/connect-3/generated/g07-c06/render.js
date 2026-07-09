import * as game from './game.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const IDLE_MS = 10000;
const DEVIATION_BONUS = 100;
const BEST_KEY = 'tomb-of-radiant-match/bestScore';

const STAGE_THEMES = [
  { name: 'Antechamber', gradient: 'linear-gradient(180deg, #4a3620 0%, #2c2118 45%, #150f0a 100%)' },
  { name: 'Hall of Columns', gradient: 'linear-gradient(180deg, #233a52 0%, #17293c 45%, #0a141f 100%)' },
  { name: 'Treasury', gradient: 'linear-gradient(180deg, #5c4514 0%, #3a2b0c 45%, #1a1305 100%)' },
  { name: 'Burial Chamber', gradient: 'linear-gradient(180deg, #241236 0%, #170b26 45%, #090412 100%)' },
  { name: 'Hall of the Duat', gradient: 'linear-gradient(180deg, #4a1410 0%, #2c0b09 45%, #120303 100%)' },
  { name: 'Sanctuary of Ra', gradient: 'linear-gradient(180deg, #7a5a12 0%, #4a3608 45%, #1f1602 100%)' },
];

// Per-colour value schemes. Each returns the CURRENT value given live state.
// 0 Scarab      - cheap, exponential (doubles per match, capped)
// 1 Ankh        - expensive, flat
// 2 Eye of Horus- grows a little each time it matches
// 3 Pyramid     - worth more the rarer it currently is on the board
// 4 Lotus       - flat, cheap
// 5 Sun Disk    - scales with the current stage
function makeEconomy() {
  const matchCount = [0, 0, 0, 0, 0, 0]; // times each type has appeared in a cleared wave

  function valuesFor(board, stage) {
    const counts = new Array(TYPES).fill(0);
    for (const row of board) for (const v of row) counts[v]++;
    return [
      Math.min(5 * 2 ** matchCount[0], 640), // scarab: exponential, capped
      50, // ankh: flat & expensive
      10 + 5 * matchCount[2], // eye: grows each match
      Math.round(320 / Math.max(counts[3], 1)), // pyramid: rarer = pricier
      15, // lotus: flat & cheap
      8 * (1 + stage), // sun disk: scales with stage
    ];
  }

  function registerWaveTypes(types) {
    if (types.has(0)) matchCount[0] += 1;
    if (types.has(2)) matchCount[2] += 1;
  }

  function reset() {
    matchCount.fill(0);
  }

  return { valuesFor, registerWaveTypes, reset };
}

// ---------------------------------------------------------------------------
// RNG (UI-side only; game.js never touches Math.random itself)
// ---------------------------------------------------------------------------
function makeRng() {
  return () => Math.random();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  board: null,
  rng: makeRng(),
  score: 0,
  bestScore: Number(localStorage.getItem(BEST_KEY)) || 0,
  multiplier: 1,
  lastGain: 0,
  lastBonus: 0,
  stage: 0,
  featuredType: null,
  gameOver: false,
  hint: null,
  busy: false,
  lastMoveTime: Date.now(),
  economy: makeEconomy(),
};

function featureForStage(stage) {
  if (stage === 0) return null;
  return (stage - 1) % TYPES;
}

function persistBest() {
  localStorage.setItem(BEST_KEY, String(state.bestScore));
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const boardEl = document.getElementById('board');
const animLayer = document.getElementById('anim-layer');
const feedbackLayer = document.getElementById('feedback-layer');
const hudScore = document.getElementById('hud-score');
const hudBest = document.getElementById('hud-best');
const hudMult = document.getElementById('hud-mult');
const hudStage = document.getElementById('hud-stage');
const stageSubtitle = document.getElementById('stage-subtitle');
const featuredCallout = document.getElementById('featured-callout');
const featuredSwatch = document.getElementById('featured-swatch');
const featuredText = document.getElementById('featured-text');
const newGameBtn = document.getElementById('new-game');
const gameOverEl = document.getElementById('game-over');
const goScore = document.getElementById('go-score');
const bgA = document.getElementById('bg-a');
const bgB = document.getElementById('bg-b');
const stageBanner = document.getElementById('stage-banner');
const bannerNum = document.getElementById('banner-num');
const bannerName = document.getElementById('banner-name');
const stageFlash = document.getElementById('stage-flash');
const dustField = document.getElementById('dust-field');

let activeBg = bgA;

// A cache of the 64 cell DOM elements, row-major.
const cellEls = [];

// ---------------------------------------------------------------------------
// Gem markup
// ---------------------------------------------------------------------------
function gemFacetsHtml(type) {
  switch (type) {
    case 0:
      return '<div class="facet base"></div><div class="facet line"></div><div class="shine"></div>';
    case 1:
      return '<div class="facet loopOuter"></div><div class="facet loopHole"></div><div class="facet bar"></div><div class="facet crossbar"></div><div class="shine"></div>';
    case 2:
      return '<div class="facet base"></div><div class="facet pupil"></div><div class="facet tail"></div><div class="shine"></div>';
    case 3:
      return '<div class="facet base"></div><div class="facet line1"></div><div class="facet line2"></div><div class="shine"></div>';
    case 4:
      return '<div class="facet base"></div><div class="shine"></div>';
    case 5:
      return '<div class="facet rays"></div><div class="facet disc"></div><div class="shine"></div>';
    default:
      return '<div class="facet base"></div>';
  }
}

function makeGemEl(type) {
  const gem = document.createElement('div');
  gem.className = `gem t${type}`;
  gem.dataset.type = String(type);
  gem.innerHTML = gemFacetsHtml(type);
  if (state.featuredType === type) {
    const ring = document.createElement('div');
    ring.className = 'featured-ring';
    gem.appendChild(ring);
  }
  return gem;
}

function setCellGem(cellEl, type) {
  cellEl.innerHTML = '';
  if (type === null || type === undefined) return;
  cellEl.appendChild(makeGemEl(type));
}

// ---------------------------------------------------------------------------
// Board build / render
// ---------------------------------------------------------------------------
function buildBoardDom() {
  boardEl.innerHTML = '';
  cellEls.length = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      attachDrag(cell, r, c);
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }
  }
}

function cellAt(r, c) {
  return cellEls[r * COLS + c];
}

function renderFullBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      setCellGem(cellAt(r, c), state.board[r][c]);
    }
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud() {
  hudScore.textContent = Math.round(state.score).toLocaleString();
  hudBest.textContent = Math.round(state.bestScore).toLocaleString();
  hudMult.textContent = `×${state.multiplier}`;
  hudStage.textContent = String(state.stage);

  if (state.featuredType === null) {
    featuredCallout.classList.remove('on');
  } else {
    featuredCallout.classList.add('on');
    featuredSwatch.className = `gem swatch t${state.featuredType}`;
    featuredSwatch.innerHTML = gemFacetsHtml(state.featuredType);
    featuredText.textContent = 'Blessed by Ra — extra points this stage';
  }
}

function applyStageTheme(stage, { announce }) {
  const idx = stage % STAGE_THEMES.length;
  const depth = Math.floor(stage / STAGE_THEMES.length);
  const theme = STAGE_THEMES[idx];
  const hueShift = depth * 24;

  const nextBg = activeBg === bgA ? bgB : bgA;
  nextBg.style.setProperty('--stage-gradient', theme.gradient);
  nextBg.style.filter = hueShift ? `hue-rotate(${hueShift}deg)` : 'none';
  nextBg.classList.add('active');
  activeBg.classList.remove('active');
  activeBg = nextBg;

  const label = depth > 0 ? `${theme.name} (Descent ${depth + 1})` : theme.name;
  stageSubtitle.textContent = `${label} — stage ${stage}`;

  if (announce) {
    bannerNum.textContent = String(stage);
    bannerName.textContent = label;
    stageBanner.classList.add('show');
    stageFlash.classList.remove('flash');
    // force reflow so the animation can restart
    void stageFlash.offsetWidth;
    stageFlash.classList.add('flash');
    setTimeout(() => stageBanner.classList.remove('show'), 2600);
  }
}

// ---------------------------------------------------------------------------
// Dust motes (ambient tomb atmosphere)
// ---------------------------------------------------------------------------
function spawnMotes() {
  const count = 22;
  for (let i = 0; i < count; i++) {
    const mote = document.createElement('div');
    mote.className = 'mote';
    mote.style.left = `${Math.random() * 100}%`;
    mote.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    const duration = 9 + Math.random() * 10;
    mote.style.animationDuration = `${duration}s`;
    mote.style.animationDelay = `${-Math.random() * duration}s`;
    dustField.appendChild(mote);
  }
}

// ---------------------------------------------------------------------------
// Floating "+N" feedback
// ---------------------------------------------------------------------------
function showFloatingGain(gain, multiplier, bonus) {
  const tag = document.createElement('div');
  tag.className = 'float-gain';
  tag.innerHTML = `+${Math.round(gain).toLocaleString()}`
    + (multiplier > 1 ? `<span class="mult-tag">×${multiplier} streak</span>` : '')
    + (bonus > 0 ? `<span class="bonus-tag">+${bonus} off-hint bonus</span>` : '');
  tag.style.left = `${40 + Math.random() * 20}%`;
  feedbackLayer.appendChild(tag);
  setTimeout(() => tag.remove(), 1600);
}

// ---------------------------------------------------------------------------
// Drag / slide interaction
// ---------------------------------------------------------------------------
const DRAG_THRESHOLD_RATIO = 0.32;

function attachDrag(cell, r, c) {
  let dragState = null;

  cell.addEventListener('pointerdown', (ev) => {
    if (state.busy || state.gameOver) return;
    ev.preventDefault();
    // Snapshot whether a hint was showing BEFORE we clear it — the deviation
    // bonus must key off "was a hint showing when this move started", not the
    // (already-cleared) live state read later.
    const hintSnapshot = state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null;
    clearHint();
    const rect = cell.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      cellSize: rect.width,
      r,
      c,
      hintSnapshot,
      gemEl: cell.querySelector('.gem'),
    };
    try { cell.setPointerCapture(ev.pointerId); } catch (_e) { /* ignore */ }
    cell.style.cursor = 'grabbing';
  });

  cell.addEventListener('pointermove', (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    const clamp = dragState.cellSize * 0.6;
    const cdx = Math.max(-clamp, Math.min(clamp, dx));
    const cdy = Math.max(-clamp, Math.min(clamp, dy));
    if (dragState.gemEl) {
      dragState.gemEl.style.animation = 'none';
      dragState.gemEl.style.transform = `translate(calc(-50% + ${cdx}px), calc(-50% + ${cdy}px))`;
      dragState.gemEl.style.zIndex = '10';
    }
  });

  const finish = (ev) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    const { r: fr, c: fc, gemEl, cellSize, hintSnapshot } = dragState;
    dragState = null;
    cell.style.cursor = 'grab';

    const resetGem = () => {
      if (gemEl) {
        gemEl.style.transition = 'transform 0.18s ease';
        gemEl.style.transform = 'translate(-50%, -50%)';
        setTimeout(() => {
          if (gemEl) {
            gemEl.style.transition = '';
            gemEl.style.animation = '';
            gemEl.style.zIndex = '';
          }
        }, 190);
      }
    };

    const threshold = cellSize * DRAG_THRESHOLD_RATIO;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) {
      resetGem();
      return;
    }

    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';

    let tr = fr, tc = fc;
    if (dir === 'left') tc -= 1;
    else if (dir === 'right') tc += 1;
    else if (dir === 'up') tr -= 1;
    else tr += 1;

    resetGem();

    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) {
      playReject(fr, fc);
      return;
    }
    attemptMove({ r: fr, c: fc }, { r: tr, c: tc }, hintSnapshot);
  };

  cell.addEventListener('pointerup', finish);
  cell.addEventListener('pointercancel', finish);
}

function playReject(r, c) {
  const cell = cellAt(r, c);
  cell.classList.remove('rejected');
  void cell.offsetWidth;
  cell.classList.add('rejected');
  setTimeout(() => cell.classList.remove('rejected'), 350);
}

// ---------------------------------------------------------------------------
// Move handling
// ---------------------------------------------------------------------------
async function attemptMove(a, b, hintSnapshot = state.hint) {
  if (state.busy || state.gameOver) return;
  if (!game.isValidSwap(state.board, a, b)) {
    playReject(a.r, a.c);
    playReject(b.r, b.c);
    return;
  }

  state.busy = true;
  const isDeviation = hintSnapshot != null && !sameUnorderedPair(hintSnapshot, { a, b });
  clearHint();
  state.lastMoveTime = Date.now();

  await animateSwap(a, b);

  const swappedBoard = game.applySwap(state.board, a, b);
  const { board: settled, steps } = game.collapse(swappedBoard, state.rng, TYPES);

  const gain = await scoreAndAnimateMove(swappedBoard, steps, isDeviation);

  state.board = settled;
  renderFullBoard();

  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    persistBest();
  }

  updateHud();
  showFloatingGain(gain.total, state.multiplier, gain.bonus);

  if (!game.hasValidMove(state.board)) {
    enterGameOver();
  }

  state.busy = false;
}

function sameUnorderedPair(hintPair, movePair) {
  const key = (p) => `${p.r},${p.c}`;
  const h = [key(hintPair.a), key(hintPair.b)].sort();
  const m = [key(movePair.a), key(movePair.b)].sort();
  return h[0] === m[0] && h[1] === m[1];
}

// Animate the two-cell swap using the FLIP technique on the inner gem content;
// the outer .cell (data-testid="cell") element never moves.
function animateSwap(a, b) {
  return new Promise((resolve) => {
    const cellA = cellAt(a.r, a.c);
    const cellB = cellAt(b.r, b.c);
    const rectA = cellA.getBoundingClientRect();
    const rectB = cellB.getBoundingClientRect();
    const dx = rectB.left - rectA.left;
    const dy = rectB.top - rectA.top;

    const gemA = cellA.querySelector('.gem');
    const gemB = cellB.querySelector('.gem');
    const DURATION = 170;

    [gemA, gemB].forEach((g) => { if (g) { g.style.animation = 'none'; g.style.zIndex = '8'; } });
    if (gemA) {
      gemA.style.transition = `transform ${DURATION}ms ease-in-out`;
      requestAnimationFrame(() => {
        gemA.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      });
    }
    if (gemB) {
      gemB.style.transition = `transform ${DURATION}ms ease-in-out`;
      requestAnimationFrame(() => {
        gemB.style.transform = `translate(calc(-50% + ${-dx}px), calc(-50% + ${-dy}px))`;
      });
    }

    setTimeout(() => {
      const typeA = state.board[a.r][a.c];
      const typeB = state.board[b.r][b.c];
      setCellGem(cellA, typeB);
      setCellGem(cellB, typeA);
      resolve();
    }, DURATION + 20);
  });
}

// ---------------------------------------------------------------------------
// Cascade wave animation + scoring
// ---------------------------------------------------------------------------
async function scoreAndAnimateMove(swappedBoard, steps, isDeviation) {
  let incomingBoard = swappedBoard;
  let totalRaw = 0;
  let maxRun = 0;
  let featuredCleared = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    maxRun = Math.max(maxRun, game.longestRun(incomingBoard));

    const values = state.economy.valuesFor(incomingBoard, state.stage);
    const typesInWave = new Set();
    let waveRaw = 0;
    for (const { r, c } of step.matches) {
      const t = incomingBoard[r][c];
      waveRaw += values[t];
      typesInWave.add(t);
      if (state.featuredType === t) featuredCleared++;
    }
    state.economy.registerWaveTypes(typesInWave);

    const cascadeFactor = i === 0 ? 1 : 2;
    totalRaw += waveRaw * cascadeFactor;

    await animateWave(incomingBoard, step);
    incomingBoard = step.board;
  }

  const bonus = isDeviation && steps.length > 0 ? DEVIATION_BONUS : 0;

  if (steps.length > 0) {
    state.multiplier = game.matchMultiplier(state.multiplier, maxRun);
  }

  const stageFeatureBonus = state.featuredType !== null ? featuredCleared * 25 : 0;
  const moveScore = totalRaw * state.multiplier;
  const total = moveScore + stageFeatureBonus + bonus;

  state.score += total;
  state.lastGain = total;
  state.lastBonus = bonus;

  const newStage = game.stageForScore(state.score);
  const stageChanged = newStage !== state.stage;
  state.stage = newStage;
  state.featuredType = featureForStage(state.stage);

  if (stageChanged) {
    applyStageTheme(state.stage, { announce: true });
  }

  return { total, bonus };
}

function animateWave(incomingBoard, step) {
  return new Promise((resolve) => {
    const matchedCells = step.matches;
    const matchedSet = new Set(matchedCells.map(({ r, c }) => r + ',' + c));
    const matchedCols = new Set(matchedCells.map((m) => m.c));

    // 1. Clear beat: shimmer/flash the matched gems, then remove them.
    for (const { r, c } of matchedCells) {
      const cell = cellAt(r, c);
      const gem = cell.querySelector('.gem');
      if (gem) gem.classList.add('clearing-flash');
    }

    setTimeout(() => {
      for (const { r, c } of matchedCells) setCellGem(cellAt(r, c), null);
      dropColumns(incomingBoard, step.board, matchedCols, matchedSet, resolve);
    }, 220);
  });
}

function dropColumns(prevBoard, nextBoard, matchedCols, matchedSet, done) {
  // Measure real, rendered cell geometry (accounts for grid gap / padding /
  // border) rather than dividing the board's total box by ROWS/COLS, which
  // would drift from the true per-cell offsets once gaps are involved.
  const animRect = animLayer.getBoundingClientRect();
  const rect00 = cellAt(0, 0).getBoundingClientRect();
  const rect01 = cellAt(0, 1).getBoundingClientRect();
  const rect10 = cellAt(1, 0).getBoundingClientRect();
  const cellW = rect00.width;
  const cellH = rect00.height;
  const colStep = rect01.left - rect00.left;
  const rowStep = rect10.top - rect00.top;
  const originLeft = rect00.left - animRect.left;
  const originTop = rect00.top - animRect.top;

  const movements = [];

  for (const c of matchedCols) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(r + ',' + c)) {
        survivors.push({ type: prevBoard[r][c], fromRow: r });
      }
    }
    const startRow = ROWS - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      const toRow = startRow + i;
      if (survivors[i].fromRow !== toRow) {
        movements.push({ col: c, type: survivors[i].type, fromRow: survivors[i].fromRow, toRow });
      }
    }
    const numRefill = startRow;
    for (let j = 0; j < numRefill; j++) {
      const toRow = j;
      const fromRow = j - numRefill - 1;
      movements.push({ col: c, type: nextBoard[toRow][c], fromRow, toRow });
    }
  }

  if (movements.length === 0) {
    done();
    return;
  }

  // Blank out every cell in the touched columns while tiles fly.
  for (const c of matchedCols) {
    for (let r = 0; r < ROWS; r++) setCellGem(cellAt(r, c), null);
  }

  let maxDuration = 0;
  const tiles = movements.map((m) => {
    const distance = Math.max(1, m.toRow - m.fromRow);
    const duration = Math.min(620, 190 + distance * 65);
    maxDuration = Math.max(maxDuration, duration);
    const tile = document.createElement('div');
    tile.className = 'flying-tile';
    tile.style.setProperty('--cw', `${cellW}px`);
    tile.style.setProperty('--ch', `${cellH}px`);
    tile.style.left = `${originLeft + m.col * colStep}px`;
    tile.style.top = `${originTop + m.fromRow * rowStep}px`;
    tile.style.transition = `top ${duration}ms cubic-bezier(0.55, 0.06, 0.68, 0.19)`;
    const gem = makeGemEl(m.type);
    gem.style.animation = 'none';
    tile.appendChild(gem);
    animLayer.appendChild(tile);
    requestAnimationFrame(() => {
      tile.style.top = `${originTop + m.toRow * rowStep}px`;
    });
    return tile;
  });

  setTimeout(() => {
    for (const tile of tiles) tile.remove();
    for (const c of matchedCols) {
      for (let r = 0; r < ROWS; r++) setCellGem(cellAt(r, c), nextBoard[r][c]);
    }
    done();
  }, maxDuration + 30);
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------
function enterGameOver() {
  state.gameOver = true;
  goScore.textContent = Math.round(state.score).toLocaleString();
  gameOverEl.classList.add('show');
  newGameBtn.classList.add('urging');
  clearHint();
}

function startNewGame() {
  state.board = game.createBoard(ROWS, COLS, TYPES, state.rng);
  state.score = 0;
  state.multiplier = 1;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.stage = 0;
  state.featuredType = featureForStage(0);
  state.gameOver = false;
  state.busy = false;
  state.economy.reset();
  clearHint();
  state.lastMoveTime = Date.now();

  gameOverEl.classList.remove('show');
  newGameBtn.classList.remove('urging');

  applyStageTheme(0, { announce: false });
  renderFullBoard();
  updateHud();
}

newGameBtn.addEventListener('click', startNewGame);

// ---------------------------------------------------------------------------
// Idle hint
// ---------------------------------------------------------------------------
function findAnyValidMove(board) {
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

function clearHint() {
  if (state.hint) {
    cellAt(state.hint.a.r, state.hint.a.c)?.classList.remove('hint-pulse');
    cellAt(state.hint.b.r, state.hint.b.c)?.classList.remove('hint-pulse');
  }
  state.hint = null;
}

function checkIdleHint() {
  if (state.busy || state.gameOver || state.hint) return;
  if (Date.now() - state.lastMoveTime < IDLE_MS) return;
  const move = findAnyValidMove(state.board);
  if (!move) return;
  state.hint = move;
  cellAt(move.a.r, move.a.c)?.classList.add('hint-pulse');
  cellAt(move.b.r, move.b.c)?.classList.add('hint-pulse');
}

setInterval(checkIdleHint, 500);

// ---------------------------------------------------------------------------
// window.__test observation hooks
// ---------------------------------------------------------------------------
window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => state.economy.valuesFor(state.board, state.stage),
  stage: () => state.stage,
  featuredType: () => state.featuredType,
  bestScore: () => state.bestScore,
  validMove: () => findAnyValidMove(state.board),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
  slide: (r, c, dir) => {
    const target = { r, c };
    let tr = r, tc = c;
    if (dir === 'left') tc -= 1;
    else if (dir === 'right') tc += 1;
    else if (dir === 'up') tr -= 1;
    else if (dir === 'down') tr += 1;
    return attemptMove(target, { r: tr, c: tc });
  },
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
buildBoardDom();
spawnMotes();
startNewGame();
