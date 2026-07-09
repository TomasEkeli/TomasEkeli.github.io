import * as game from './game.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROWS = 8, COLS = 8, TYPES = 6;
const BEST_KEY = 'amber-hollow:best-score';
const FEATURE_BONUS_PER_GEM = 30;
const DEVIATION_BONUS = 100;
const IDLE_MS = 10000;
const SLIDE_THRESHOLD_PX = 20; // minimum net displacement to count as a move
const CLEAR_MS = 260;
const DROP_BASE_MS = 140;
const DROP_PER_ROW_MS = 70;
const SWAP_MS = 170;

const GEMS = [
  { key: 'amber', name: 'Amber Bead', shape: 'shape-circle', c1: '#ffdf9b', c2: '#c9791b' },
  { key: 'garnet', name: 'Garnet Shard', shape: 'shape-diamond', c1: '#f08a9c', c2: '#7d1128' },
  { key: 'maple', name: 'Maple Star', shape: 'shape-star', c1: '#ffa869', c2: '#b8380f' },
  { key: 'acorn', name: 'Acorn Hex', shape: 'shape-hex', c1: '#e6a95c', c2: '#5e3312' },
  { key: 'thistle', name: 'Thistle Bloom', shape: 'shape-pentagon', c1: '#d6a6e2', c2: '#5b2f66' },
  { key: 'moonstone', name: 'Moonstone', shape: 'shape-octagon', c1: '#f3fbf6', c2: '#8fb8ad' },
];

const STAGE_THEMES = [
  { name: 'Early Gold', sky: ['#ffe3a0', '#f7ad55', '#a95a26'], board: ['#5a3c22', '#2a1608'], leaf: ['#d2691e', '#c23b2b'] },
  { name: 'Deep Russet', sky: ['#f0b45a', '#c05a1e', '#5c1c0a'], board: ['#4a2510', '#200e04'], leaf: ['#b8350f', '#7c1c0c'] },
  { name: 'First Frost', sky: ['#cfe6ea', '#8fb2bd', '#425a68'], board: ['#37424a', '#151b1f'], leaf: ['#cfe6ea', '#e0a83a'] },
  { name: 'Harvest Moon', sky: ['#4a2b55', '#241033', '#100616'], board: ['#3a2440', '#160b1c'], leaf: ['#e6c76a', '#8a4fae'] },
];

function stageTheme(stageIdx) {
  const idx = stageIdx % STAGE_THEMES.length;
  const cycle = Math.floor(stageIdx / STAGE_THEMES.length);
  return { ...STAGE_THEMES[idx], cycle, themeIdx: idx };
}

function featuredForStage(stageIdx) {
  if (stageIdx === 0) return null;
  return (stageIdx - 1) % TYPES;
}

const rng = () => Math.random();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  board: null,
  score: 0,
  best: 0,
  lastGain: 0,
  lastBonus: 0,
  multiplier: 1,
  stage: 0,
  featuredType: null,
  gameOver: false,
  animating: false,
  hint: null,
  matchCounts: new Array(TYPES).fill(0),
};

// ---------------------------------------------------------------------------
// Per-colour value schemes (candidate-designed; UI concern only)
// ---------------------------------------------------------------------------
function countOnBoard(board, type) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === type) n++;
  return n;
}

function currentGemValue(type, board, stageIdx) {
  switch (type) {
    case 0: // Amber: cheap but exponential — doubles each time it matches (capped)
      return Math.round(5 * 2 ** Math.min(state.matchCounts[0], 10));
    case 1: // Garnet: expensive but flat — never scales
      return 50;
    case 2: // Maple: grows a little every time it matches this playthrough
      return 10 + 4 * Math.min(state.matchCounts[2], 60);
    case 3: { // Acorn: worth more the rarer it currently is on the board
      const n = Math.max(1, countOnBoard(board, 3));
      return Math.round(360 / n);
    }
    case 4: // Thistle: precious early, fades as the season (stages) turn
      return Math.max(10, 60 - stageIdx * 8);
    case 5: // Moonstone: gains worth as the game progresses through stages
      return Math.round(8 * (1 + stageIdx));
    default:
      return 10;
  }
}

function allGemValues(board, stageIdx) {
  return GEMS.map((_, i) => currentGemValue(i, board, stageIdx));
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const boardEl = document.getElementById('board');
const floatersEl = document.getElementById('floaters');
const gameOverEl = document.getElementById('game-over');
const newGameBtn = document.getElementById('new-game-btn');
const sceneEl = document.getElementById('scene');
const bodyEl = document.body;
const stageBannerEl = document.getElementById('stage-banner');
const bannerIndexEl = document.getElementById('banner-index');
const bannerTitleEl = document.getElementById('banner-title');
const flashEl = document.getElementById('flash');
const featuredChipEl = document.getElementById('featured-chip');
const featuredNameEl = document.getElementById('featured-name');
const hudScoreEl = document.getElementById('hud-score');
const hudBestEl = document.getElementById('hud-best');
const hudMultEl = document.getElementById('hud-mult');
const multStatEl = document.getElementById('mult-stat');
const hudStageEl = document.getElementById('hud-stage');
const leavesEl = document.getElementById('leaves');

let cellEls = []; // [r][c] -> .cell element
let gemSlots = []; // [r][c] -> .gem-slot element

// ---------------------------------------------------------------------------
// Board DOM construction (built once; 64 fixed cells, contents refreshed)
// ---------------------------------------------------------------------------
function buildBoardDom() {
  boardEl.innerHTML = '';
  cellEls = Array.from({ length: ROWS }, () => new Array(COLS));
  gemSlots = Array.from({ length: ROWS }, () => new Array(COLS));

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      const slot = document.createElement('div');
      slot.className = 'gem-slot';

      const face = document.createElement('div');
      face.className = 'gem-face';
      face.style.setProperty('--idle-delay', `${((r * COLS + c) % 9) * 0.18}s`);

      const highlight = document.createElement('div');
      highlight.className = 'gem-mask gem-highlight';
      const shadow = document.createElement('div');
      shadow.className = 'gem-mask gem-shadow';
      const rim = document.createElement('div');
      rim.className = 'gem-mask gem-rim';

      face.appendChild(highlight);
      face.appendChild(shadow);
      face.appendChild(rim);
      slot.appendChild(face);
      cell.appendChild(slot);
      boardEl.appendChild(cell);

      cellEls[r][c] = cell;
      gemSlots[r][c] = slot;

      attachDragHandlers(cell, r, c);
    }
  }
}

function paintGem(r, c, type) {
  const slot = gemSlots[r][c];
  const face = slot.firstChild;
  const def = GEMS[type];
  face.className = `gem-face ${def.shape}`;
  face.style.setProperty('--c1', def.c1);
  face.style.setProperty('--c2', def.c2);
  slot.dataset.type = String(type);
}

function renderBoardStatic() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      paintGem(r, c, state.board[r][c]);
      const slot = gemSlots[r][c];
      slot.style.transition = 'none';
      slot.style.transform = 'translate(0px, 0px)';
      slot.classList.remove('clearing');
    }
  }
  refreshFeaturedHighlights();
  refreshHintHighlights();
}

function refreshFeaturedHighlights() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const on = state.featuredType !== null && state.board[r][c] === state.featuredType;
      gemSlots[r][c].classList.toggle('featured', on);
    }
  }
}

function refreshHintHighlights() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) gemSlots[r][c].classList.remove('hint');
  }
  if (state.hint) {
    const { a, b } = state.hint;
    gemSlots[a.r][a.c].classList.add('hint');
    gemSlots[b.r][b.c].classList.add('hint');
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function cellPitch() {
  const r0 = cellEls[0][0].getBoundingClientRect();
  const r1 = cellEls[1][0].getBoundingClientRect();
  return r1.top - r0.top;
}

function setImmediateTransform(el, x, y) {
  el.style.transition = 'none';
  el.style.transform = `translate(${x}px, ${y}px)`;
  // force reflow so the next transition actually animates from this state
  void el.offsetHeight;
}

function animateTransform(el, x, y, durMs, easing) {
  return new Promise((resolve) => {
    el.style.transition = `transform ${durMs}ms ${easing}`;
    requestAnimationFrame(() => {
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    setTimeout(resolve, durMs + 20);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Drag / slide interaction
// ---------------------------------------------------------------------------
function attachDragHandlers(cell, r, c) {
  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0;
  let pitch = 64;

  cell.addEventListener('pointerdown', (e) => {
    if (state.animating || state.gameOver) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    pitch = cellPitch() || 64;
    cell.setPointerCapture(pointerId);
    gemSlots[r][c].classList.add('dragging');
    e.preventDefault();
  });

  cell.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const max = pitch * 0.6;
    const cx = Math.max(-max, Math.min(max, dx));
    const cy = Math.max(-max, Math.min(max, dy));
    setImmediateTransform(gemSlots[r][c], cx, cy);
  });

  const finish = async (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { cell.releasePointerCapture(pointerId); } catch { /* noop */ }
    gemSlots[r][c].classList.remove('dragging');

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const dominant = absX >= absY ? absX : absY;

    if (dominant < SLIDE_THRESHOLD_PX) {
      // net displacement below threshold at release: cancel, no move.
      await animateTransform(gemSlots[r][c], 0, 0, 140, 'ease-out');
      gemSlots[r][c].style.transition = 'none';
      return;
    }

    let target = null;
    if (absX >= absY) {
      target = { r, c: c + (dx > 0 ? 1 : -1) };
    } else {
      target = { r: r + (dy > 0 ? 1 : -1), c };
    }

    if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
      await animateTransform(gemSlots[r][c], 0, 0, 140, 'ease-out');
      gemSlots[r][c].style.transition = 'none';
      return;
    }

    await attemptMove({ r, c }, target, pitch);
  };

  cell.addEventListener('pointerup', finish);
  cell.addEventListener('pointercancel', async (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { cell.releasePointerCapture(pointerId); } catch { /* noop */ }
    gemSlots[r][c].classList.remove('dragging');
    await animateTransform(gemSlots[r][c], 0, 0, 140, 'ease-out');
    gemSlots[r][c].style.transition = 'none';
  });
}

function pairsEqual(p1, p2) {
  if (!p1 || !p2) return false;
  const key = (p) => [`${p.a.r},${p.a.c}`, `${p.b.r},${p.b.c}`].sort().join('|');
  return key(p1) === key(p2);
}

async function attemptMove(a, b, pitch) {
  if (state.animating || state.gameOver) return;
  state.animating = true;

  const dr = b.r - a.r, dc = b.c - a.c;
  const offX = dc * pitch, offY = dr * pitch;

  const slotA = gemSlots[a.r][a.c];
  const slotB = gemSlots[b.r][b.c];

  const valid = game.isValidSwap(state.board, a, b);
  const preHint = state.hint;

  // Visually commit the swap gesture (A already partway via drag-follow).
  await Promise.all([
    animateTransform(slotA, offX, offY, SWAP_MS, 'ease-out'),
    animateTransform(slotB, -offX, -offY, SWAP_MS, 'ease-out'),
  ]);

  if (!valid) {
    await Promise.all([
      animateTransform(slotA, 0, 0, SWAP_MS, 'ease-in'),
      animateTransform(slotB, 0, 0, SWAP_MS, 'ease-in'),
    ]);
    slotA.style.transition = 'none';
    slotB.style.transition = 'none';
    state.animating = false;
    resetIdleTimer();
    return;
  }

  // Commit the swap into logical state, then snap DOM to the swapped layout.
  const swapped = game.applySwap(state.board, a, b);
  state.board = swapped;
  slotA.style.transition = 'none';
  slotB.style.transition = 'none';
  renderBoardStatic();

  clearHint();

  const { board: settled, steps } = game.collapse(swapped, rng, TYPES);

  let waveSum = 0;
  let maxRun = 0;
  let featuredCount = 0;
  let incoming = swapped;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    maxRun = Math.max(maxRun, game.longestRun(incoming));
    const cascadeFactor = i === 0 ? 1 : 2;

    let waveRaw = 0;
    for (const cell of step.matches) {
      const type = incoming[cell.r][cell.c];
      waveRaw += currentGemValue(type, incoming, state.stage);
      if (state.featuredType === type) featuredCount++;
    }
    waveSum += waveRaw * cascadeFactor;

    await animateClearWave(step.matches);
    await animateDropWave(incoming, step.matches, step.board);

    for (const cell of step.matches) {
      const type = incoming[cell.r][cell.c];
      if (type === 0 || type === 2) state.matchCounts[type]++;
    }

    incoming = step.board;
    state.board = step.board;
  }

  const prevMult = state.multiplier;
  if (steps.length > 0) {
    state.multiplier = game.matchMultiplier(prevMult, maxRun);
  }

  const stageBonus = featuredCount * FEATURE_BONUS_PER_GEM;
  const deviationBonus = (preHint && !pairsEqual(preHint, { a, b })) ? DEVIATION_BONUS : 0;
  const gain = Math.round(waveSum * state.multiplier + stageBonus + deviationBonus);

  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = deviationBonus;
  persistBest();

  const newStage = game.stageForScore(state.score);
  const stageChanged = newStage !== state.stage;
  state.stage = newStage;
  state.featuredType = featuredForStage(newStage);

  renderBoardStatic();
  updateHud();
  showGainFloat(gain, deviationBonus, state.multiplier);

  if (stageChanged) {
    await announceStage(newStage);
  }

  state.gameOver = !game.hasValidMove(state.board);
  if (state.gameOver) showGameOver(); else hideGameOver();

  state.animating = false;
  resetIdleTimer();
}

// ---------------------------------------------------------------------------
// Wave animation
// ---------------------------------------------------------------------------
function animateClearWave(matches) {
  for (const { r, c } of matches) {
    gemSlots[r][c].classList.add('clearing');
  }
  return wait(CLEAR_MS);
}

function animateDropWave(beforeBoard, matches, afterBoard) {
  const matched = new Set(matches.map((m) => `${m.r},${m.c}`));
  const pitch = cellPitch() || 64;
  let maxDistance = 0;
  const plan = [];

  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matched.has(`${r},${c}`)) survivorRows.push(r);
    }
    const missing = ROWS - survivorRows.length;

    for (let k = 0; k < survivorRows.length; k++) {
      const fromRow = survivorRows[k];
      const toRow = missing + k;
      plan.push({ c, fromRow, toRow, type: beforeBoard[fromRow][c] });
      maxDistance = Math.max(maxDistance, toRow - fromRow);
    }
    for (let k = 0; k < missing; k++) {
      const toRow = k;
      const fromRow = k - missing;
      plan.push({ c, fromRow, toRow, type: afterBoard[toRow][c] });
      maxDistance = Math.max(maxDistance, toRow - fromRow);
    }
  }

  // Paint every cell to its final content, offset to its "from" position.
  for (const entry of plan) {
    const slot = gemSlots[entry.toRow][entry.c];
    slot.classList.remove('clearing');
    paintGem(entry.toRow, entry.c, entry.type);
    const offsetY = (entry.fromRow - entry.toRow) * pitch;
    setImmediateTransform(slot, 0, offsetY);
  }

  const durMs = DROP_BASE_MS + Math.max(0, maxDistance) * DROP_PER_ROW_MS;
  const easing = 'cubic-bezier(.55,.06,.9,.44)'; // accelerating, physical drop

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      for (const entry of plan) {
        const slot = gemSlots[entry.toRow][entry.c];
        slot.style.transition = `transform ${durMs}ms ${easing}`;
        slot.style.transform = 'translate(0px, 0px)';
      }
      setTimeout(() => {
        for (const entry of plan) {
          const slot = gemSlots[entry.toRow][entry.c];
          slot.style.transition = 'none';
        }
        resolve();
      }, durMs + 20);
    });
  });
}

// ---------------------------------------------------------------------------
// HUD / feedback
// ---------------------------------------------------------------------------
function updateHud() {
  hudScoreEl.textContent = state.score.toLocaleString();
  hudBestEl.textContent = state.best.toLocaleString();
  hudMultEl.textContent = `×${state.multiplier}`;
  multStatEl.classList.toggle('hot', state.multiplier >= 4);
  const theme = stageTheme(state.stage);
  hudStageEl.textContent = `${state.stage + 1} · ${theme.name}`;

  if (state.featuredType !== null) {
    featuredChipEl.classList.add('show');
    featuredNameEl.textContent = GEMS[state.featuredType].name;
    const svg = featuredChipEl.querySelector('.fc-icon');
    svg.innerHTML = shapeSvgMarkup(GEMS[state.featuredType]);
  } else {
    featuredChipEl.classList.remove('show');
  }
}

function shapeSvgMarkup(def) {
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${def.c1}"/><stop offset="1" stop-color="${def.c2}"/>
    </linearGradient></defs>`;
  const shapes = {
    'shape-circle': '<circle cx="16" cy="16" r="14" fill="url(#g)"/>',
    'shape-diamond': '<polygon points="16,1 31,16 16,31 1,16" fill="url(#g)"/>',
    'shape-star': '<polygon points="16,0 20,11 32,12 23,19 26,31 16,24 6,31 9,19 0,12 12,11" fill="url(#g)"/>',
    'shape-hex': '<polygon points="8,1 24,1 31,16 24,31 8,31 1,16" fill="url(#g)"/>',
    'shape-pentagon': '<polygon points="16,1 31,12 25,31 7,31 1,12" fill="url(#g)"/>',
    'shape-octagon': '<polygon points="10,1 22,1 31,10 31,22 22,31 10,31 1,22 1,10" fill="url(#g)"/>',
  };
  return grad + (shapes[def.shape] || shapes['shape-circle']);
}

function showGainFloat(gain, bonus, mult) {
  const pop = document.createElement('div');
  pop.className = 'gain-pop';
  let html = `<span class="gain-num">+${gain.toLocaleString()}</span>`;
  html += `<span class="gain-mult">×${mult} streak</span>`;
  if (bonus > 0) html += `<span class="gain-bonus">+${bonus} off-hint bonus</span>`;
  pop.innerHTML = html;
  floatersEl.appendChild(pop);
  setTimeout(() => pop.remove(), 1700);
}

function applyStageVisual(stageIdx, { announce }) {
  const theme = stageTheme(stageIdx);
  const hueShift = theme.cycle * 30;
  sceneEl.style.filter = hueShift ? `hue-rotate(${hueShift}deg)` : '';
  sceneEl.style.setProperty('--sky-top', theme.sky[0]);
  document.documentElement.style.setProperty('--sky-top', theme.sky[0]);
  document.documentElement.style.setProperty('--sky-mid', theme.sky[1]);
  document.documentElement.style.setProperty('--sky-bottom', theme.sky[2]);
  document.documentElement.style.setProperty('--board-top', theme.board[0]);
  document.documentElement.style.setProperty('--board-bottom', theme.board[1]);
  document.documentElement.style.setProperty('--leaf-a', theme.leaf[0]);
  document.documentElement.style.setProperty('--leaf-b', theme.leaf[1]);
  bodyEl.dataset.stageTheme = String(theme.themeIdx);

  if (announce) {
    bannerIndexEl.textContent = String(stageIdx + 1);
    bannerTitleEl.textContent = theme.cycle > 0 ? `${theme.name} — again, deeper` : theme.name;
  }
}

function announceStage(stageIdx) {
  applyStageVisual(stageIdx, { announce: true });
  flashEl.classList.remove('burst');
  void flashEl.offsetHeight;
  flashEl.classList.add('burst');
  stageBannerEl.classList.add('show');
  return new Promise((resolve) => {
    setTimeout(() => {
      stageBannerEl.classList.remove('show');
      resolve();
    }, 2000);
  });
}

function showGameOver() {
  gameOverEl.classList.add('show');
  newGameBtn.classList.add('urge');
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cellEls[r][c].classList.add('game-over-locked');
}
function hideGameOver() {
  gameOverEl.classList.remove('show');
  newGameBtn.classList.remove('urge');
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cellEls[r][c].classList.remove('game-over-locked');
}

// ---------------------------------------------------------------------------
// Idle hint
// ---------------------------------------------------------------------------
let idleTimer = null;

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
  state.hint = null;
  refreshHintHighlights();
}

function resetIdleTimer() {
  clearHint();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state.animating || state.gameOver) return;
    const move = findAnyValidMove(state.board);
    if (!move) return;
    state.hint = move;
    refreshHintHighlights();
  }, IDLE_MS);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    state.best = raw ? Number(raw) || 0 : 0;
  } catch {
    state.best = 0;
  }
}

function persistBest() {
  if (state.score > state.best) {
    state.best = state.score;
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
// Falling leaves (decorative)
// ---------------------------------------------------------------------------
function spawnLeaves() {
  leavesEl.innerHTML = '';
  const n = 16;
  for (let i = 0; i < n; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.style.left = `${Math.random() * 100}%`;
    const dur = 10 + Math.random() * 10;
    leaf.style.animationDuration = `${dur}s`;
    leaf.style.animationDelay = `${-Math.random() * dur}s`;
    const scale = 0.6 + Math.random() * 0.9;
    leaf.style.transform = `scale(${scale})`;
    leavesEl.appendChild(leaf);
  }
}

// ---------------------------------------------------------------------------
// New game / init
// ---------------------------------------------------------------------------
function newGame() {
  state.board = game.createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.multiplier = 1;
  state.matchCounts.fill(0);
  state.gameOver = false;
  state.animating = false;
  state.hint = null;
  state.stage = game.stageForScore(0);
  state.featuredType = featuredForStage(state.stage);

  applyStageVisual(state.stage, { announce: false });
  renderBoardStatic();
  hideGameOver();
  updateHud();
  resetIdleTimer();
}

function init() {
  loadBest();
  buildBoardDom();
  spawnLeaves();
  newGame();

  newGameBtn.addEventListener('click', () => {
    newGame();
  });

  window.addEventListener('resize', () => {
    // no persistent layout cache to invalidate; geometry is read live.
  });

  window.__test = {
    score: () => state.score,
    lastGain: () => state.lastGain,
    lastBonus: () => state.lastBonus,
    multiplier: () => state.multiplier,
    gemValues: () => allGemValues(state.board, state.stage),
    stage: () => state.stage,
    featuredType: () => state.featuredType,
    bestScore: () => state.best,
    validMove: () => findAnyValidMove(state.board),
    board: () => state.board.map((row) => row.slice()),
    gameOver: () => state.gameOver,
    hint: () => state.hint,
    slide: (r, c, dir) => {
      const deltas = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };
      const d = deltas[dir];
      if (!d) return Promise.resolve(false);
      const a = { r, c };
      const b = { r: r + d.r, c: c + d.c };
      if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return Promise.resolve(false);
      const pitch = cellPitch() || 64;
      return attemptMove(a, b, pitch).then(() => true);
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
