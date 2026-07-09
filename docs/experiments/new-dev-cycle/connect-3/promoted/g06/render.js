import * as game from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const STORAGE_BEST = 'aurora-match3:bestScore';
const DEVIATION_BONUS = 100;
const STAGE_FEATURE_BONUS_PER_GEM = 20;
const IDLE_MS = 10000;

const rngFn = () => Math.random();

// ---------------------------------------------------------------- gem defs
const GEM_DEFS = [
  { name: 'Glacier Shard', shape: 'diamond', color: '#33d6f5', glow: 'rgba(51,214,245,.55)' },
  { name: 'Moon Pearl', shape: 'circle', color: '#eef8ff', glow: 'rgba(238,248,255,.5)' },
  { name: 'Aurora Frond', shape: 'hexagon', color: '#39e6ab', glow: 'rgba(57,230,171,.55)' },
  { name: 'Sapphire Drop', shape: 'triangle', color: '#3b74f0', glow: 'rgba(59,116,240,.55)' },
  { name: 'Frost Star', shape: 'star', color: '#ff9fd6', glow: 'rgba(255,159,214,.55)' },
  { name: 'Polaris Gem', shape: 'pentagon', color: '#5b7fe8', glow: 'rgba(91,127,232,.55)' },
];

const STAGE_THEMES = [
  { name: 'Clear Polar Night' },
  { name: 'Drifting Fog' },
  { name: 'Snowfall' },
  { name: 'Blizzard' },
  { name: 'Aurora Veil' },
  { name: 'Aurora Storm' },
];

// ---------------------------------------------------------- colour economy
function makeColourState() {
  return [
    { kind: 'exp', base: 5, count: 0, cap: 2560 },      // cheap, doubles each time it matches
    { kind: 'flat', value: 50 },                         // expensive, never scales
    { kind: 'grow', value: 10, step: 8 },                // grows a bit each time it matches
    { kind: 'rarity', k: 320, min: 12 },                 // worth more the rarer it is on the board
    { kind: 'flat', value: 15 },                         // cheap and flat
    { kind: 'stage', base: 8 },                          // worth more in later stages
  ];
}

let colourState = makeColourState();

function colourValue(type, board, stage) {
  const s = colourState[type];
  switch (s.kind) {
    case 'exp': return Math.min(Math.round(s.base * Math.pow(2, s.count)), s.cap);
    case 'flat': return s.value;
    case 'grow': return s.value;
    case 'rarity': {
      let cnt = 0;
      for (const row of board) for (const v of row) if (v === type) cnt++;
      return Math.max(s.min, Math.round(s.k / Math.max(1, cnt)));
    }
    case 'stage': return s.base * (1 + stage);
    default: return 0;
  }
}

function allColourValues(board, stage) {
  return GEM_DEFS.map((_, i) => colourValue(i, board, stage));
}

// --------------------------------------------------------------- app state
const state = {
  board: null,
  score: 0,
  bestScore: 0,
  lastGain: 0,
  lastBonus: 0,
  multiplier: 1,
  stage: 0,
  featuredType: 0,
  gameOver: false,
  animating: false,
  hint: null,
};

// ------------------------------------------------------------------ DOM
const boardEl = document.getElementById('board');
const boardWrapEl = document.getElementById('boardWrap');
const backdropEl = document.getElementById('backdrop');
const legendEl = document.getElementById('legend');
const scoreValEl = document.getElementById('scoreVal');
const bestValEl = document.getElementById('bestVal');
const multValEl = document.getElementById('multVal');
const stageValEl = document.getElementById('stageVal');
const newGameBtn = document.getElementById('newGameBtn');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const goScoreEl = gameOverOverlay.querySelector('.go-score');

let cellEls = [];
let gemEls = [];
let cellSize = 0;
let dragState = null;
let idleTimer = null;

function keyOf(r, c) { return r + ',' + c; }
function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function samePairUnordered(pair, a, b) {
  if (!pair) return false;
  const p1 = pair.a, p2 = pair.b;
  const match1 = p1.r === a.r && p1.c === a.c && p2.r === b.r && p2.c === b.c;
  const match2 = p1.r === b.r && p1.c === b.c && p2.r === a.r && p2.c === a.c;
  return match1 || match2;
}

// ------------------------------------------------------------- board DOM
function buildBoardDOM() {
  boardEl.innerHTML = '';
  cellEls = [];
  gemEls = [];
  for (let r = 0; r < ROWS; r++) {
    const rowCells = [];
    const rowGems = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.style.gridRowStart = String(r + 1);
      cell.style.gridColumnStart = String(c + 1);

      const gem = document.createElement('div');
      gem.className = 'gem';
      gem.style.setProperty('--pulse-delay', ((r + c) * 0.12) + 's');
      const hi = document.createElement('span');
      hi.className = 'facet hi';
      const sh = document.createElement('span');
      sh.className = 'facet sh';
      const glint = document.createElement('span');
      glint.className = 'facet glint';
      gem.appendChild(hi);
      gem.appendChild(sh);
      gem.appendChild(glint);

      cell.appendChild(gem);
      boardEl.appendChild(cell);
      rowCells.push(cell);
      rowGems.push(gem);
      attachDrag(cell, r, c);
    }
    cellEls.push(rowCells);
    gemEls.push(rowGems);
  }
}

function updateCellSize() {
  cellSize = boardEl.clientWidth / COLS;
}
window.addEventListener('resize', updateCellSize);

function setGemVisual(gemEl, type) {
  const def = GEM_DEFS[type];
  gemEl.className = 'gem shape-' + def.shape + (type === state.featuredType ? ' featured' : '');
  gemEl.style.setProperty('--gem-color', def.color);
  gemEl.style.setProperty('--gem-glow', def.glow);
  gemEl.dataset.type = String(type);
  gemEl.style.opacity = '1';
}

function renderBoardFull(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = gemEls[r][c];
      el.style.transition = 'none';
      el.style.transform = '';
      // preserve facet children while resetting shape/type classes
      const facets = [...el.children];
      setGemVisual(el, board[r][c]);
      facets.forEach((f) => el.appendChild(f));
      cellEls[r][c].classList.remove('hint');
    }
  }
}

// ------------------------------------------------------------- dragging
function attachDrag(cell, r, c) {
  cell.addEventListener('pointerdown', (e) => {
    if (state.animating || state.gameOver) return;
    e.preventDefault();
    try { cell.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    dragState = { r, c, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, cell };
    gemEls[r][c].style.cursor = 'grabbing';
  });

  cell.addEventListener('pointermove', (e) => {
    if (!dragState || dragState.cell !== cell || e.pointerId !== dragState.pointerId) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const maxOffset = cellSize * 0.45;
    let ox = 0, oy = 0;
    if (Math.abs(dx) > Math.abs(dy)) ox = clamp(dx, -maxOffset, maxOffset);
    else oy = clamp(dy, -maxOffset, maxOffset);
    const gem = gemEls[r][c];
    gem.style.transition = 'none';
    gem.style.transform = `translate(${ox}px, ${oy}px)`;
  });

  const endDrag = (e) => {
    if (!dragState || dragState.cell !== cell || e.pointerId !== dragState.pointerId) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    dragState = null;
    gemEls[r][c].style.cursor = 'grab';
    finishDrag(r, c, dx, dy);
  };
  cell.addEventListener('pointerup', endDrag);
  cell.addEventListener('pointercancel', () => {
    if (dragState && dragState.cell === cell) {
      dragState = null;
      snapBack(r, c);
    }
  });
}

function snapBack(r, c) {
  const el = gemEls[r][c];
  el.style.transition = 'transform 160ms ease-out';
  el.style.transform = 'translate(0px, 0px)';
}

function finishDrag(r, c, dx, dy) {
  const threshold = cellSize * 0.32;
  const absx = Math.abs(dx), absy = Math.abs(dy);
  let target = null;
  if (Math.max(absx, absy) >= threshold) {
    if (absx > absy) target = { r, c: c + (dx > 0 ? 1 : -1) };
    else target = { r: r + (dy > 0 ? 1 : -1), c };
  }
  if (!target || target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    snapBack(r, c);
    return;
  }
  attemptMove({ r, c }, target);
}

// ------------------------------------------------------------- movement
async function attemptMove(a, b) {
  if (state.animating || state.gameOver) {
    snapBack(a.r, a.c);
    return;
  }
  const valid = game.isValidSwap(state.board, a, b);
  if (!valid) {
    await animateRejectSwap(a, b);
    return;
  }

  state.animating = true;
  const hintShownBefore = !!state.hint;
  const hintPair = state.hint;
  clearIdleTimer();
  hideHint();

  await animateCommitSwap(a, b);

  const swappedBoard = game.applySwap(state.board, a, b);
  const { board: settled, steps } = game.collapse(swappedBoard, rngFn, TYPES);
  const gainInfo = computeGain(swappedBoard, steps, hintShownBefore, hintPair, a, b);

  await playSteps(swappedBoard, steps);

  state.board = settled;
  applyGain(gainInfo);
  renderBoardFull(state.board);

  state.animating = false;
  checkGameOver();
  scheduleIdle();
}

async function animateRejectSwap(a, b) {
  const gemA = gemEls[a.r][a.c];
  const dx = (b.c - a.c) * cellSize;
  const dy = (b.r - a.r) * cellSize;
  gemA.style.transition = 'transform 110ms ease-out';
  gemA.style.transform = `translate(${dx * 0.32}px, ${dy * 0.32}px)`;
  await wait(120);
  gemA.style.transition = 'transform 200ms cubic-bezier(.36,1.4,.4,1)';
  gemA.style.transform = 'translate(0px, 0px)';
  await wait(200);
}

async function animateCommitSwap(a, b) {
  const gemA = gemEls[a.r][a.c];
  const gemB = gemEls[b.r][b.c];
  const dx = (b.c - a.c) * cellSize;
  const dy = (b.r - a.r) * cellSize;
  gemA.style.transition = 'transform 160ms ease-in-out';
  gemB.style.transition = 'transform 160ms ease-in-out';
  gemA.style.transform = `translate(${dx}px, ${dy}px)`;
  gemB.style.transform = `translate(${-dx}px, ${-dy}px)`;
  await wait(170);
  gemA.style.transition = 'none';
  gemB.style.transition = 'none';
  const typeA = Number(gemA.dataset.type);
  const typeB = Number(gemB.dataset.type);
  const facetsA = [...gemA.children];
  const facetsB = [...gemB.children];
  setGemVisual(gemA, typeB);
  setGemVisual(gemB, typeA);
  facetsA.forEach((f) => gemA.appendChild(f));
  facetsB.forEach((f) => gemB.appendChild(f));
  gemA.style.transform = 'translate(0px, 0px)';
  gemB.style.transform = 'translate(0px, 0px)';
}

async function playSteps(startBoard, steps) {
  let incoming = startBoard;
  for (let i = 0; i < steps.length; i++) {
    const { matches, board: outgoing } = steps[i];
    await animateClear(matches);
    await animateDrop(incoming, matches, outgoing);
    incoming = outgoing;
  }
}

async function animateClear(matches) {
  for (const { r, c } of matches) {
    gemEls[r][c].classList.add('clearing');
  }
  await wait(220);
  for (const { r, c } of matches) {
    const el = gemEls[r][c];
    el.classList.remove('clearing');
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.4)';
  }
}

async function animateDrop(incoming, matches, outgoing) {
  const matchedSet = new Set(matches.map((m) => keyOf(m.r, m.c)));
  const moves = [];

  for (let c = 0; c < COLS; c++) {
    const survivorOldRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(keyOf(r, c))) survivorOldRows.push(r);
    }
    const n = survivorOldRows.length;
    for (let i = 0; i < n; i++) {
      const oldRow = survivorOldRows[i];
      const newRow = ROWS - n + i;
      if (newRow !== oldRow) {
        moves.push({ r: newRow, c, type: incoming[oldRow][c], fromOffsetRows: oldRow - newRow });
      }
    }
    for (let newRow = 0; newRow < ROWS - n; newRow++) {
      const type = outgoing[newRow][c];
      const fromOffsetRows = newRow - (ROWS - n);
      moves.push({ r: newRow, c, type, fromOffsetRows });
    }
  }

  let maxDistance = 0;
  for (const m of moves) {
    const el = gemEls[m.r][m.c];
    el.style.transition = 'none';
    const facets = [...el.children];
    setGemVisual(el, m.type);
    facets.forEach((f) => el.appendChild(f));
    el.style.transform = `translateY(${m.fromOffsetRows * cellSize}px)`;
    maxDistance = Math.max(maxDistance, Math.abs(m.fromOffsetRows));
  }

  void boardEl.offsetHeight; // force reflow so the start transform is committed

  const dur = Math.min(700, 190 + maxDistance * 95);
  for (const m of moves) {
    const el = gemEls[m.r][m.c];
    el.style.transition = `transform ${dur}ms cubic-bezier(0.55,0.06,0.9,0.44)`;
    el.style.transform = 'translateY(0px)';
  }

  await wait(dur + 40);

  for (const m of moves) {
    const el = gemEls[m.r][m.c];
    el.style.transition = 'none';
    el.style.transform = '';
  }
}

// -------------------------------------------------------------- scoring
function computeGain(preBoard, steps, hintShownBefore, hintPair, a, b) {
  const startValues = allColourValues(preBoard, state.stage);
  let rawTotal = 0;
  const typeAppearedInWave = {};
  let featuredCount = 0;
  let maxRun = 0;

  for (let i = 0; i < steps.length; i++) {
    const incoming = i === 0 ? preBoard : steps[i - 1].board;
    maxRun = Math.max(maxRun, game.longestRun(incoming));
    const cascadeFactor = i === 0 ? 1 : 2;
    let waveRaw = 0;
    for (const { r, c } of steps[i].matches) {
      const type = incoming[r][c];
      waveRaw += startValues[type];
      (typeAppearedInWave[type] ||= new Set()).add(i);
      if (type === state.featuredType) featuredCount++;
    }
    rawTotal += waveRaw * cascadeFactor;
  }

  const newMultiplier = game.matchMultiplier(state.multiplier, maxRun);
  const afterMultiplier = rawTotal * newMultiplier;
  const stageBonus = featuredCount * STAGE_FEATURE_BONUS_PER_GEM;

  let deviationBonus = 0;
  if (hintShownBefore && hintPair && !samePairUnordered(hintPair, a, b)) {
    deviationBonus = DEVIATION_BONUS;
  }

  const gain = Math.round(afterMultiplier + stageBonus + deviationBonus);
  return { gain, deviationBonus, newMultiplier, typeAppearedInWave };
}

function applyGain(info) {
  if (!info) return;
  for (const [typeStr, waveSet] of Object.entries(info.typeAppearedInWave)) {
    const type = Number(typeStr);
    const s = colourState[type];
    const times = waveSet.size;
    if (s.kind === 'exp') s.count += times;
    if (s.kind === 'grow') s.value += s.step * times;
  }

  state.multiplier = info.newMultiplier;
  state.score += info.gain;
  state.lastGain = info.gain;
  state.lastBonus = info.deviationBonus;
  state.stage = game.stageForScore(state.score);
  state.featuredType = state.stage % GEM_DEFS.length;

  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    try { localStorage.setItem(STORAGE_BEST, String(state.bestScore)); } catch (_) { /* ignore */ }
  }

  updateHUD();
  showFloatingGain(info.gain, info.newMultiplier, info.deviationBonus);
}

function showFloatingGain(gain, multiplier, bonus) {
  const el = document.createElement('div');
  el.className = 'floatgain';
  let html = `<span class="fg-amount">+${gain}</span>`;
  if (multiplier > 1) html += `<span class="fg-mult">×${multiplier}</span>`;
  if (bonus > 0) html += `<span class="fg-bonus">+${bonus} deviation bonus!</span>`;
  el.innerHTML = html;
  boardWrapEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.remove(), 1700);
}

// -------------------------------------------------------------- hud/ui
function updateHUD() {
  scoreValEl.textContent = String(state.score);
  bestValEl.textContent = String(state.bestScore);
  multValEl.textContent = '×' + state.multiplier;
  const theme = STAGE_THEMES[state.stage % STAGE_THEMES.length];
  stageValEl.textContent = `${state.stage + 1}. ${theme.name}`;
  backdropEl.className = 'stage-' + (state.stage % STAGE_THEMES.length);
  renderLegend();
}

function renderLegend() {
  legendEl.innerHTML = '';
  const values = allColourValues(state.board || [], state.stage);
  GEM_DEFS.forEach((def, i) => {
    const item = document.createElement('div');
    item.className = 'legend-item' + (i === state.featuredType ? ' featured' : '');
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch gem shape-' + def.shape;
    swatch.style.setProperty('--gem-color', def.color);
    swatch.style.setProperty('--gem-glow', def.glow);
    swatch.style.position = 'relative';
    swatch.style.inset = 'auto';
    swatch.style.animation = 'none';
    item.appendChild(swatch);
    const label = document.createElement('span');
    label.textContent = def.name + ' ';
    const lv = document.createElement('span');
    lv.className = 'lv';
    lv.textContent = String(values[i]);
    label.appendChild(lv);
    item.appendChild(label);
    if (i === state.featuredType) {
      const tag = document.createElement('span');
      tag.textContent = ' ★featured';
      item.appendChild(tag);
    }
    legendEl.appendChild(item);
  });
}

function checkGameOver() {
  if (!game.hasValidMove(state.board)) {
    state.gameOver = true;
    goScoreEl.textContent = `Final score: ${state.score}`;
    gameOverOverlay.classList.add('visible');
    clearIdleTimer();
    hideHint();
  } else {
    state.gameOver = false;
    gameOverOverlay.classList.remove('visible');
  }
}

// -------------------------------------------------------------- idle hint
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

function scheduleIdle() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    if (state.animating || state.gameOver) return;
    const pair = findAnyValidMove(state.board);
    if (!pair) return;
    state.hint = pair;
    cellEls[pair.a.r][pair.a.c].classList.add('hint');
    cellEls[pair.b.r][pair.b.c].classList.add('hint');
  }, IDLE_MS);
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function hideHint() {
  if (state.hint) {
    const { a, b } = state.hint;
    cellEls[a.r][a.c].classList.remove('hint');
    cellEls[b.r][b.c].classList.remove('hint');
  }
  state.hint = null;
}

// -------------------------------------------------------------- new game
function startNewGame() {
  clearIdleTimer();
  hideHint();
  colourState = makeColourState();
  state.board = game.createBoard(ROWS, COLS, TYPES, rngFn);
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.multiplier = 1;
  state.stage = 0;
  state.featuredType = 0;
  state.gameOver = false;
  state.animating = false;
  state.hint = null;
  renderBoardFull(state.board);
  updateHUD();
  gameOverOverlay.classList.remove('visible');
  scheduleIdle();
}

newGameBtn.addEventListener('click', startNewGame);

// ------------------------------------------------------------- backdrop fx
function buildBackdropFx() {
  const starsLayer = document.querySelector('.stars');
  for (let i = 0; i < 70; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 60 + '%';
    star.style.animationDelay = (Math.random() * 4) + 's';
    star.style.opacity = String(0.3 + Math.random() * 0.7);
    starsLayer.appendChild(star);
  }

  const snowLayer = document.querySelector('.snowlayer');
  for (let i = 0; i < 46; i++) {
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    const size = 2 + Math.random() * 4;
    flake.style.width = size + 'px';
    flake.style.height = size + 'px';
    flake.style.left = Math.random() * 100 + '%';
    flake.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
    const dur = 8 + Math.random() * 14;
    flake.style.animationDuration = dur + 's';
    flake.style.animationDelay = (-Math.random() * dur) + 's';
    snowLayer.appendChild(flake);
  }
}

// ------------------------------------------------------------------ slide
function slide(r, c, dir) {
  const map = {
    up: { r: -1, c: 0 }, down: { r: 1, c: 0 },
    left: { r: 0, c: -1 }, right: { r: 0, c: 1 },
  };
  const d = map[dir];
  if (!d) return Promise.resolve(false);
  return attemptMove({ r, c }, { r: r + d.r, c: c + d.c });
}

// -------------------------------------------------------------------- init
function loadBestScore() {
  try {
    const raw = localStorage.getItem(STORAGE_BEST);
    state.bestScore = raw ? Number(raw) || 0 : 0;
  } catch (_) {
    state.bestScore = 0;
  }
}

function init() {
  buildBoardDOM();
  updateCellSize();
  buildBackdropFx();
  loadBestScore();
  state.board = game.createBoard(ROWS, COLS, TYPES, rngFn);
  renderBoardFull(state.board);
  updateHUD();
  scheduleIdle();
}

init();

// -------------------------------------------------------------- test hooks
window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => allColourValues(state.board, state.stage),
  stage: () => state.stage,
  featuredType: () => state.featuredType,
  bestScore: () => state.bestScore,
  validMove: () => findAnyValidMove(state.board),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
  slide,
};
