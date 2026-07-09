import * as Game from './game.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROWS = 8, COLS = 8, TYPES = 6;
const THRESHOLD_FRAC = 0.32;
const IDLE_MS = 10000;
const DEVIATION_BONUS = 100;
const FEATURE_BONUS_PER_GEM = 24;

// Gem colour indices
const RUBY = 0, SAPPHIRE = 1, EMERALD = 2, TOPAZ = 3, AMETHYST = 4, PEARL = 5;

// Per-colour scoring economy constants
const RUBY_BASE = 5, RUBY_CAP = 640;                 // cheap, exponential (doubles per wave matched)
const SAPPHIRE_VALUE = 50;                           // expensive, flat, never scales
const EMERALD_BASE = 10, EMERALD_STEP = 8, EMERALD_CAP = 400; // grows each time it matches
const TOPAZ_BASE = 280;                              // worth more the rarer it is on the board
const AMETHYST_BASE = 8;                             // scales with the current stage
const PEARL_BASE = 12, PEARL_STEP = 2, PEARL_EVERY = 4; // slow inflation with moves played

const GEMS = [
  { name: 'Ruby', shape: 'shape-diamond', fill: 'linear-gradient(135deg, #ffb3a0 0%, #e23b3b 45%, #7a0f16 100%)' },
  { name: 'Sapphire', shape: 'shape-hex', fill: 'linear-gradient(135deg, #a9e0ff 0%, #2b7fd6 45%, #0d2f66 100%)' },
  { name: 'Emerald', shape: 'shape-shield', fill: 'linear-gradient(135deg, #c3ffb8 0%, #2fae52 45%, #0c4f24 100%)' },
  { name: 'Topaz', shape: 'shape-circle', fill: 'linear-gradient(135deg, #fff2b0 0%, #f0a53a 45%, #8a4c05 100%)' },
  { name: 'Amethyst', shape: 'shape-octagon', fill: 'linear-gradient(135deg, #e8c4ff 0%, #9a3dd6 45%, #400c66 100%)' },
  { name: 'Pearl', shape: 'shape-drop', fill: 'linear-gradient(135deg, #ffffff 0%, #f3e7e0 40%, #d8c3d6 75%, #a68fae 100%)' },
];

// Six themed stages, cycling — a full day-to-night cycle over the dunes.
const STAGES = [
  {
    name: 'High Noon Bazaar', featured: TOPAZ,
    sky: 'linear-gradient(180deg, #3a7bd5 0%, #6fa8dc 30%, #f6d488 70%, #f0a94e 100%)',
    star: 0, sun: 1, sunTop: '18%',
    dune: '#caa15c', dune2: '#a97a3a', dune3: '#6b4a24',
  },
  {
    name: 'Golden Hour Caravan', featured: RUBY,
    sky: 'linear-gradient(180deg, #5a2f6b 0%, #b5486a 35%, #e8703f 65%, #f4b13a 100%)',
    star: 0.08, sun: 1, sunTop: '40%',
    dune: '#8a3f2c', dune2: '#5c2418', dune3: '#341019',
  },
  {
    name: 'Dusk Falls', featured: AMETHYST,
    sky: 'linear-gradient(180deg, #2b1750 0%, #6a2f6b 32%, #c9633f 62%, #e8a13a 82%, #f4c869 100%)',
    star: 0.3, sun: 0.85, sunTop: '58%',
    dune: '#3a1930', dune2: '#23102a', dune3: '#150a1c',
  },
  {
    name: 'Twilight Oasis', featured: SAPPHIRE,
    sky: 'linear-gradient(180deg, #0e0c33 0%, #251a52 35%, #4a2e6b 65%, #7a4a5e 100%)',
    star: 0.55, sun: 0.15, sunTop: '80%',
    dune: '#151233', dune2: '#0e0c2a', dune3: '#08071c',
  },
  {
    name: 'Starlit Dunes', featured: PEARL,
    sky: 'linear-gradient(180deg, #05040f 0%, #0c0e2c 40%, #171335 75%, #241a3d 100%)',
    star: 0.95, sun: 0, sunTop: '90%',
    dune: '#0a0a1c', dune2: '#070713', dune3: '#04040c',
  },
  {
    name: 'Blue Hour Mirage', featured: EMERALD,
    sky: 'linear-gradient(180deg, #0c2d4a 0%, #14506e 35%, #2f8a86 68%, #6fc7a8 100%)',
    star: 0.35, sun: 0.35, sunTop: '70%',
    dune: '#0e3b3f 0%', dune2: '#0a2b30', dune3: '#062024',
  },
];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const boardEl = document.getElementById('board');
const cellLayer = document.getElementById('cellLayer');
const gemLayer = document.getElementById('gemLayer');
const floatLayer = document.getElementById('floatLayer');
const scoreVal = document.getElementById('scoreVal');
const bestVal = document.getElementById('bestVal');
const multVal = document.getElementById('multVal');
const newGameBtn = document.getElementById('newGameBtn');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const stageNameEl = document.getElementById('stageName');
const legendEl = document.getElementById('legend');
const skyA = document.getElementById('skyA');
const skyB = document.getElementById('skyB');
const starsEl = document.getElementById('stars');
const sunEl = document.getElementById('sun');
const dunesEl = document.getElementById('dunes');
const dunes2El = document.getElementById('dunes2');

boardEl.style.setProperty('--rows', ROWS);
boardEl.style.setProperty('--cols', COLS);

const BEST_KEY = 'bazaarOfJewels.bestScore';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  board: null,
  rng: () => Math.random(),
  score: 0,
  lastGain: 0,
  lastBonus: 0,
  multiplier: 1,
  gameOver: false,
  animating: false,
  hint: null,
  lastActionTime: Date.now(),
  bestScore: Number(localStorage.getItem(BEST_KEY)) || 0,
  rubyValue: RUBY_BASE,
  emeraldValue: EMERALD_BASE,
  pearlValue: PEARL_BASE,
  movesMade: 0,
  gen: 0,
  skyOn: 'A',
  lastStageRendered: -1,
};

let sprites = [];  // sprites[r][c] = { el, type } | null
let cellEls = [];  // cellEls[r][c] = element

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getMetrics() {
  const cs = getComputedStyle(boardEl);
  return {
    cell: parseFloat(cs.getPropertyValue('--cell')),
    gap: parseFloat(cs.getPropertyValue('--gap')),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameCell(x, y) {
  return x.r === y.r && x.c === y.c;
}

function pairsEqual(p1, p2) {
  if (!p1 || !p2) return false;
  return (sameCell(p1.a, p2.a) && sameCell(p1.b, p2.b)) ||
         (sameCell(p1.a, p2.b) && sameCell(p1.b, p2.a));
}

function countType(board, type) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === type) n++;
  return n;
}

function findAnyValidMove(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && Game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && Game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

function computeGemValues(board) {
  const stageIdx = Game.stageForScore(state.score);
  return [
    state.rubyValue,
    SAPPHIRE_VALUE,
    state.emeraldValue,
    Math.round(TOPAZ_BASE / Math.max(1, countType(board, TOPAZ))),
    Math.round(AMETHYST_BASE * (1 + stageIdx)),
    state.pearlValue,
  ];
}

function currentFeatured() {
  const stageIdx = Game.stageForScore(state.score);
  return STAGES[stageIdx % STAGES.length].featured;
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------
function buildCellLayer() {
  cellLayer.innerHTML = '';
  cellEls = Array.from({ length: ROWS }, () => new Array(COLS));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      attachDragHandlers(cell, r, c);
      cellLayer.appendChild(cell);
      cellEls[r][c] = cell;
    }
  }
}

function createGemEl(type) {
  const def = GEMS[type];
  const gem = document.createElement('div');
  gem.className = 'gem';
  gem.dataset.type = String(type);

  const shape = document.createElement('div');
  shape.className = 'gem-shape ' + def.shape;
  shape.style.setProperty('--rot', (Math.random() * 10 - 5).toFixed(1) + 'deg');
  shape.style.setProperty('--bob-delay', (Math.random() * 3).toFixed(2) + 's');

  const face = document.createElement('div');
  face.className = 'gem-face';
  face.style.setProperty('--fill', def.fill);

  const shine = document.createElement('div');
  shine.className = 'gem-shine';

  const glint = document.createElement('div');
  glint.className = 'gem-glint';
  glint.style.setProperty('--glint-delay', (Math.random() * 4).toFixed(2) + 's');

  shape.append(face, shine, glint);
  gem.appendChild(shape);
  return gem;
}

function placeSprite(el, r, c) {
  const { cell, gap } = getMetrics();
  el.style.transform = `translate3d(${c * (cell + gap)}px, ${r * (cell + gap)}px, 0)`;
}

function rebuildSprites() {
  gemLayer.innerHTML = '';
  sprites = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const type = state.board[r][c];
      const el = createGemEl(type);
      el.style.transition = 'none';
      gemLayer.appendChild(el);
      placeSprite(el, r, c);
      sprites[r][c] = { el, type };
    }
  }
  updateFeaturedHighlights();
}

function updateFeaturedHighlights() {
  const featured = currentFeatured();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const s = sprites[r][c];
      if (!s) continue;
      s.el.classList.toggle('featured', s.type === featured);
    }
  }
}

function buildLegend() {
  legendEl.innerHTML = '';
  GEMS.forEach((def, i) => {
    const item = document.createElement('div');
    item.className = 'item';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = def.fill;
    const label = document.createElement('span');
    label.textContent = def.name;
    item.append(sw, label);
    legendEl.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Stage / backdrop visuals
// ---------------------------------------------------------------------------
function applyStageVisuals(force) {
  const stageIdx = Game.stageForScore(state.score);
  if (!force && stageIdx === state.lastStageRendered) return;
  state.lastStageRendered = stageIdx;
  const theme = STAGES[stageIdx % STAGES.length];

  const incoming = state.skyOn === 'A' ? skyB : skyA;
  const outgoing = state.skyOn === 'A' ? skyA : skyB;
  incoming.style.background = theme.sky;
  // force reflow so the opacity transition runs
  void incoming.offsetWidth;
  incoming.classList.add('on');
  outgoing.classList.remove('on');
  state.skyOn = state.skyOn === 'A' ? 'B' : 'A';

  starsEl.style.opacity = String(theme.star);
  sunEl.style.opacity = String(theme.sun);
  sunEl.style.top = theme.sunTop;
  dunesEl.style.setProperty('--dune-color', theme.dune);
  dunesEl.style.setProperty('--dune-color2', theme.dune2);
  dunesEl.style.setProperty('--dune-color3', theme.dune3);
  dunes2El.style.setProperty('--dune-color3', theme.dune3);

  stageNameEl.textContent = theme.name;
  updateFeaturedHighlights();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud() {
  scoreVal.textContent = String(Math.round(state.score));
  bestVal.textContent = String(Math.round(state.bestScore));
  multVal.textContent = '×' + state.multiplier;
  multVal.classList.toggle('hot', state.multiplier > 1);
}

// ---------------------------------------------------------------------------
// Hint / idle
// ---------------------------------------------------------------------------
function clearHintVisual() {
  if (state.hint) {
    const { a } = state.hint;
    if (cellEls[a.r] && cellEls[a.r][a.c]) cellEls[a.r][a.c].classList.remove('hinted');
  }
  state.hint = null;
}

function showHint(mv) {
  clearHintVisual();
  state.hint = mv;
  cellEls[mv.a.r][mv.a.c].classList.add('hinted');
}

function resetIdleTimer() {
  state.lastActionTime = Date.now();
  clearHintVisual();
}

let idleInterval = null;
function startIdleWatcher() {
  if (idleInterval) clearInterval(idleInterval);
  idleInterval = setInterval(() => {
    if (state.gameOver || state.animating || state.hint) return;
    if (Date.now() - state.lastActionTime < IDLE_MS) return;
    const mv = findAnyValidMove(state.board);
    if (mv) showHint(mv);
  }, 350);
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------
function checkGameOver() {
  state.gameOver = !Game.hasValidMove(state.board);
  gameOverOverlay.hidden = !state.gameOver;
}

// ---------------------------------------------------------------------------
// Floating score popup
// ---------------------------------------------------------------------------
function showPop(gain, multiplier, deviationBonus, featureBonus, a, b) {
  const { cell, gap } = getMetrics();
  const ax = a.c * (cell + gap) + cell / 2, ay = a.r * (cell + gap) + cell / 2;
  const bx = b.c * (cell + gap) + cell / 2, by = b.r * (cell + gap) + cell / 2;
  const x = (ax + bx) / 2, y = (ay + by) / 2;

  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';

  let html = `<div class="gain">+${Math.round(gain)}</div>`;
  if (multiplier > 1) html += `<span class="mult">×${multiplier} combo</span>`;
  if (featureBonus > 0) html += `<div class="bonus" style="color:#ffd97a;border-color:rgba(255,220,140,0.5);background:rgba(60,40,10,0.5);">+${featureBonus} featured</div>`;
  if (deviationBonus > 0) html += `<div class="bonus">+${deviationBonus} off-hint bonus</div>`;
  pop.innerHTML = html;

  floatLayer.appendChild(pop);
  setTimeout(() => pop.remove(), 1600);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function computeMoveScore(firstIncomingBoard, steps, hintBefore, a, b) {
  const featured = currentFeatured();
  let rawTotal = 0;
  let featuredCount = 0;
  let maxRun = 0;
  let incoming = firstIncomingBoard;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    maxRun = Math.max(maxRun, Game.longestRun(incoming));
    const values = computeGemValues(incoming);
    let waveRaw = 0;
    const seenTypes = new Set();
    for (const { r, c } of step.matches) {
      const t = incoming[r][c];
      waveRaw += values[t];
      seenTypes.add(t);
      if (t === featured) featuredCount++;
    }
    const cascadeFactor = i === 0 ? 1 : 2;
    rawTotal += waveRaw * cascadeFactor;

    for (const t of seenTypes) {
      if (t === RUBY) state.rubyValue = Math.min(RUBY_CAP, state.rubyValue * 2);
      if (t === EMERALD) state.emeraldValue = Math.min(EMERALD_CAP, state.emeraldValue + EMERALD_STEP);
    }
    incoming = step.board;
  }

  const newMultiplier = Game.matchMultiplier(state.multiplier, maxRun);
  const baseGain = rawTotal * newMultiplier;
  const featureBonus = featuredCount * FEATURE_BONUS_PER_GEM;
  const deviated = !!hintBefore && !pairsEqual(hintBefore, { a, b });
  const deviationBonus = deviated ? DEVIATION_BONUS : 0;
  const gain = baseGain + featureBonus + deviationBonus;

  return { gain, deviationBonus, featureBonus, newMultiplier };
}

// ---------------------------------------------------------------------------
// Animation: clear + drop per wave
// ---------------------------------------------------------------------------
async function animateWave(matches, nextBoard) {
  const matchedSet = new Set(matches.map((m) => m.r + ',' + m.c));

  for (const { r, c } of matches) {
    const s = sprites[r][c];
    if (s) s.el.classList.add('matched');
  }
  await wait(210);

  for (const { r, c } of matches) {
    const s = sprites[r][c];
    if (s) s.el.remove();
    sprites[r][c] = null;
  }

  const { cell, gap } = getMetrics();
  const step = cell + gap;
  let maxDur = 140;

  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(r + ',' + c)) survivorRows.push(r);
    }
    const numNew = ROWS - survivorRows.length;

    const moves = survivorRows.map((fromR, i) => ({
      spriteObj: sprites[fromR][c],
      fromR,
      toR: numNew + i,
    }));

    for (const { spriteObj, fromR, toR } of moves) {
      if (!spriteObj) continue;
      const dist = toR - fromR;
      const el = spriteObj.el;
      const dur = dist > 0 ? Math.round(150 + dist * 70) : 120;
      el.style.transition = dist > 0
        ? `transform ${dur}ms cubic-bezier(0.45,0,0.85,0.25)`
        : 'transform 120ms ease';
      el.style.transform = `translate3d(${c * step}px, ${toR * step}px, 0)`;
      maxDur = Math.max(maxDur, dur);
    }
    for (const { spriteObj, toR } of moves) {
      sprites[toR][c] = spriteObj;
    }

    for (let r = 0; r < numNew; r++) {
      const type = nextBoard[r][c];
      const el = createGemEl(type);
      gemLayer.appendChild(el);
      const startRow = -(numNew - r);
      el.style.transition = 'none';
      el.style.transform = `translate3d(${c * step}px, ${startRow * step}px, 0)`;
      void el.offsetWidth;
      const totalDrop = r - startRow;
      const dur = Math.round(150 + totalDrop * 70);
      el.style.transition = `transform ${dur}ms cubic-bezier(0.45,0,0.85,0.25)`;
      el.style.transform = `translate3d(${c * step}px, ${r * step}px, 0)`;
      maxDur = Math.max(maxDur, dur);
      sprites[r][c] = { el, type };
    }
  }

  updateFeaturedHighlights();
  await wait(maxDur + 30);
}

// ---------------------------------------------------------------------------
// Drag interaction
// ---------------------------------------------------------------------------
let drag = null;

function attachDragHandlers(cellEl, r, c) {
  cellEl.addEventListener('pointerdown', (e) => {
    if (state.gameOver || state.animating) return;
    cellEl.setPointerCapture(e.pointerId);
    drag = { r, c, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dx: 0, dy: 0 };
    cellEl.style.cursor = 'grabbing';
    const s = sprites[r][c];
    if (s) s.el.classList.add('dragging');
  });

  cellEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId || drag.r !== r || drag.c !== c) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag.dx = dx;
    drag.dy = dy;
    const { cell, gap } = getMetrics();
    const clampTo = cell;
    const cdx = Math.max(-clampTo, Math.min(clampTo, dx));
    const cdy = Math.max(-clampTo, Math.min(clampTo, dy));
    const s = sprites[r][c];
    if (!s) return;
    const baseX = c * (cell + gap), baseY = r * (cell + gap);
    s.el.style.transition = 'none';
    s.el.style.transform = `translate3d(${baseX + cdx}px, ${baseY + cdy}px, 0)`;
  });

  const finish = (e) => {
    if (!drag || e.pointerId !== drag.pointerId || drag.r !== r || drag.c !== c) return;
    const { dx, dy } = drag;
    drag = null;
    cellEl.style.cursor = 'grab';
    handleGestureEnd(r, c, dx, dy);
  };
  cellEl.addEventListener('pointerup', finish);
  cellEl.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.pointerId || drag.r !== r || drag.c !== c) return;
    drag = null;
    snapBack(r, c);
  });
}

function snapBack(r, c) {
  const { cell, gap } = getMetrics();
  const s = sprites[r][c];
  if (!s) return;
  s.el.style.transition = 'transform 170ms ease-out';
  s.el.style.transform = `translate3d(${c * (cell + gap)}px, ${r * (cell + gap)}px, 0)`;
  s.el.classList.remove('dragging');
}

function rejectSwap(a, b) {
  const { cell, gap } = getMetrics();
  const step = cell + gap;
  const sa = sprites[a.r][a.c], sb = sprites[b.r][b.c];
  if (!sa || !sb) return;
  const posA = { x: a.c * step, y: a.r * step };
  const posB = { x: b.c * step, y: b.r * step };
  const midA = { x: posA.x + (posB.x - posA.x) * 0.3, y: posA.y + (posB.y - posA.y) * 0.3 };
  const midB = { x: posB.x + (posA.x - posB.x) * 0.3, y: posB.y + (posA.y - posB.y) * 0.3 };

  sa.el.classList.remove('dragging');
  sb.el.classList.remove('dragging');
  sa.el.style.transition = 'transform 110ms ease-out';
  sb.el.style.transition = 'transform 110ms ease-out';
  sa.el.style.transform = `translate3d(${midA.x}px, ${midA.y}px, 0)`;
  sb.el.style.transform = `translate3d(${midB.x}px, ${midB.y}px, 0)`;

  setTimeout(() => {
    sa.el.style.transition = 'transform 160ms ease-in';
    sb.el.style.transition = 'transform 160ms ease-in';
    sa.el.style.transform = `translate3d(${posA.x}px, ${posA.y}px, 0)`;
    sb.el.style.transform = `translate3d(${posB.x}px, ${posB.y}px, 0)`;
  }, 120);
}

function handleGestureEnd(r, c, dx, dy) {
  const { cell } = getMetrics();
  const threshold = cell * THRESHOLD_FRAC;
  const absX = Math.abs(dx), absY = Math.abs(dy);

  const hintBefore = state.hint;
  clearHintVisual();

  if (Math.max(absX, absY) < threshold) {
    snapBack(r, c);
    return;
  }

  let target;
  if (absX > absY) target = { r, c: c + (dx > 0 ? 1 : -1) };
  else target = { r: r + (dy > 0 ? 1 : -1), c };

  if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    snapBack(r, c);
    return;
  }

  const a = { r, c }, b = target;
  if (!Game.isValidSwap(state.board, a, b)) {
    rejectSwap(a, b);
    return;
  }

  performMove(a, b, hintBefore);
}

// ---------------------------------------------------------------------------
// Move pipeline
// ---------------------------------------------------------------------------
async function animateSwap(a, b) {
  const { cell, gap } = getMetrics();
  const step = cell + gap;
  const sa = sprites[a.r][a.c], sb = sprites[b.r][b.c];
  sa.el.style.transition = 'transform 170ms ease-in-out';
  sb.el.style.transition = 'transform 170ms ease-in-out';
  sa.el.style.transform = `translate3d(${b.c * step}px, ${b.r * step}px, 0)`;
  sb.el.style.transform = `translate3d(${a.c * step}px, ${a.r * step}px, 0)`;
  await wait(180);
  sa.el.classList.remove('dragging');
  sb.el.classList.remove('dragging');
  sprites[a.r][a.c] = sb;
  sprites[b.r][b.c] = sa;
}

async function performMove(a, b, hintBefore) {
  state.animating = true;
  const localGen = state.gen;

  await animateSwap(a, b);
  if (localGen !== state.gen) return;

  const swappedBoard = Game.applySwap(state.board, a, b);
  const { board: settled, steps } = Game.collapse(swappedBoard, state.rng, TYPES);

  const { gain, deviationBonus, featureBonus, newMultiplier } =
    computeMoveScore(swappedBoard, steps, hintBefore, a, b);

  for (const step of steps) {
    await animateWave(step.matches, step.board);
    if (localGen !== state.gen) return;
  }

  state.movesMade += 1;
  state.pearlValue = PEARL_BASE + Math.floor(state.movesMade / PEARL_EVERY) * PEARL_STEP;

  state.board = settled;
  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = deviationBonus;
  state.multiplier = newMultiplier;
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    localStorage.setItem(BEST_KEY, String(Math.round(state.bestScore)));
  }

  showPop(gain, newMultiplier, deviationBonus, featureBonus, a, b);
  updateHud();
  applyStageVisuals(false);
  checkGameOver();
  updateFeaturedHighlights();

  state.animating = false;
  if (!state.gameOver) resetIdleTimer();
}

// ---------------------------------------------------------------------------
// New game / init
// ---------------------------------------------------------------------------
function newGame() {
  state.gen += 1;
  state.board = Game.createBoard(ROWS, COLS, TYPES, state.rng);
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.multiplier = 1;
  state.gameOver = false;
  state.animating = false;
  state.hint = null;
  state.rubyValue = RUBY_BASE;
  state.emeraldValue = EMERALD_BASE;
  state.pearlValue = PEARL_BASE;
  state.movesMade = 0;
  state.lastActionTime = Date.now();
  state.lastStageRendered = -1;

  rebuildSprites();
  updateHud();
  applyStageVisuals(true);
  gameOverOverlay.hidden = true;
}

newGameBtn.addEventListener('click', () => {
  newGame();
});

buildCellLayer();
buildLegend();
newGame();
startIdleWatcher();

window.addEventListener('resize', () => {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const s = sprites[r][c];
      if (s) {
        s.el.style.transition = 'none';
        placeSprite(s.el, r, c);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// window.__test — observation-only hooks
// ---------------------------------------------------------------------------
window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => computeGemValues(state.board),
  stage: () => Game.stageForScore(state.score),
  featuredType: () => currentFeatured(),
  bestScore: () => state.bestScore,
  validMove: () => findAnyValidMove(state.board),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
  slide: (r, c, dir) => {
    const deltas = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };
    const d = deltas[dir];
    if (!d) return Promise.resolve(false);
    const a = { r, c }, b = { r: r + d.r, c: c + d.c };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return Promise.resolve(false);
    if (state.gameOver || state.animating) return Promise.resolve(false);
    if (!Game.isValidSwap(state.board, a, b)) {
      rejectSwap(a, b);
      return Promise.resolve(false);
    }
    const hintBefore = state.hint;
    clearHintVisual();
    const p = performMove(a, b, hintBefore);
    return p.then(() => true);
  },
};
