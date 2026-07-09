import * as Game from './game.js';

// ---------------------------------------------------------------------------
// Constants & theme data
// ---------------------------------------------------------------------------

const ROWS = 8, COLS = 8, TYPES = 6;
const CLEAR_MS = 260;       // matched gems shown/shimmer before clearing (>= 0.2s)
const SNAP_MS = 150;        // swap-into-place duration
const IDLE_MS = 10000;      // idle hint delay
const DEVIATION_BONUS = 100;
const FEATURE_BONUS_PER_GEM = 30;
const BEST_KEY = 'sakura-cascade:best-score';

const GEM_META = [
  { name: 'Sakura Blossom' },
  { name: 'Koi Fish' },
  { name: 'Paper Lantern' },
  { name: 'Bamboo Leaf' },
  { name: 'Jade Stone' },
  { name: 'Moon Pearl' },
];

// Per-type silhouette markup, reused both as a <clipPath> definition and as a
// visible stroked outline drawn on top of each gem instance.
const SHAPE_MARKUP = [
  // 0 Sakura Blossom - five petals + a heart
  `<path d="M50,50 C38,36 38,12 50,4 C62,12 62,36 50,50 Z"/>
   <path d="M50,50 C38,36 38,12 50,4 C62,12 62,36 50,50 Z" transform="rotate(72 50 50)"/>
   <path d="M50,50 C38,36 38,12 50,4 C62,12 62,36 50,50 Z" transform="rotate(144 50 50)"/>
   <path d="M50,50 C38,36 38,12 50,4 C62,12 62,36 50,50 Z" transform="rotate(216 50 50)"/>
   <path d="M50,50 C38,36 38,12 50,4 C62,12 62,36 50,50 Z" transform="rotate(288 50 50)"/>
   <circle cx="50" cy="50" r="9"/>`,
  // 1 Koi Fish
  `<path d="M10,50 C10,29 33,14 58,14 C81,14 93,33 95,50 C93,67 81,86 58,86 C33,86 10,71 10,50 Z"/>
   <path d="M13,50 L0,30 L5,50 L0,70 Z"/>
   <path d="M44,16 L54,0 L64,16 Z"/>`,
  // 2 Paper Lantern
  `<path d="M37,2 L63,2 L63,11 L37,11 Z"/>
   <path d="M24,17 Q50,4 76,17 L82,34 L82,68 L76,85 Q50,98 24,85 L18,68 L18,34 Z"/>
   <path d="M39,89 L61,89 L61,98 L39,98 Z"/>`,
  // 3 Bamboo Leaf
  `<path d="M50,2 C75,27 84,52 50,98 C16,52 25,27 50,2 Z"/>`,
  // 4 Jade Stone (faceted hexagon)
  `<path d="M50,3 L89,26 L89,74 L50,97 L11,74 L11,26 Z"/>`,
  // 5 Moon Pearl (crescent: outer disc minus a fully-contained inner disc)
  `<path d="M50,6 A44,44 0 1,0 50,94 A44,44 0 1,0 50,6 Z M63,16 A28,28 0 1,0 63,72 A28,28 0 1,0 63,16 Z" fill-rule="evenodd" clip-rule="evenodd"/>`,
];

// Extra faceting flourish drawn only on the jade stone, for a cut-gem look.
const EXTRA_FACETS = {
  4: `<path d="M50,50 L50,3 M50,50 L89,74 M50,50 L11,74"/>`,
};

const GEM_GRADIENTS = [
  ['#ffc2dc', '#ff5fa0', '#b81f5c'],  // sakura pink
  ['#ffe19a', '#ffab35', '#c96a0d'],  // koi gold
  ['#ffc79a', '#ff7a45', '#a52e12'],  // lantern ember
  ['#c9f5ad', '#6bcf45', '#237a2c'],  // bamboo green
  ['#adf5df', '#3bc79c', '#0f7a60'],  // jade teal
  ['#ded2f5', '#b79ce8', '#6d51a8'],  // moon lavender
];

const STAGES = [
  { name: 'Dawn Mist', featured: 0,
    sky: ['#ffe8ef', '#ffd0dd'], accent: '#d6538f', glow: '#ffb7d1', mist: 0.55, waterA: '#cfe7e6', waterB: '#9fd0cf' },
  { name: 'Petal Fall', featured: 3,
    sky: ['#ffd9c2', '#ff9d7a'], accent: '#e4633a', glow: '#ffb37a', mist: 0.35, waterA: '#b9d9c9', waterB: '#6fae94' },
  { name: 'Lantern Dusk', featured: 2,
    sky: ['#4a3462', '#b1548a'], accent: '#ffb648', glow: '#ff8a3d', mist: 0.30, waterA: '#3c2d55', waterB: '#6b3f66' },
  { name: 'Moonlit Pond', featured: 5,
    sky: ['#0c1230', '#2a2f6b'], accent: '#b7c4ff', glow: '#dcd0ff', mist: 0.25, waterA: '#131a3a', waterB: '#24356e' },
  { name: 'Golden Koi Hour', featured: 1,
    sky: ['#2c1c12', '#a5591c'], accent: '#ffcf6b', glow: '#ffb02e', mist: 0.30, waterA: '#4a2f16', waterB: '#8a5a22' },
  { name: 'Jade Snow', featured: 4,
    sky: ['#eaf6f5', '#cfe9ea'], accent: '#3f9e8f', glow: '#bfe9df', mist: 0.60, waterA: '#d8f0ee', waterB: '#a9d8d2' },
];

// ---------------------------------------------------------------------------
// Mutable game state
// ---------------------------------------------------------------------------

let board = [];
let score = 0;
let best = 0;
let multiplier = 1;
let stage = 0;
let featuredType = STAGES[0].featured;
let gameOver = false;
let busy = false;
let hintPair = null;
let lastGain = 0;
let lastBonus = 0;
let growth = [0, 0, 0, 0, 0, 0];
let idleTimer = null;
let cachedCellSize = null;

const rngFn = () => Math.random();

let cells = []; // [r][c] -> { el, gemWrap }

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const multiplierEl = document.getElementById('multiplier');
const multiplierStatEl = document.getElementById('multiplierStat');
const stageNameEl = document.getElementById('stageName');
const newGameBtn = document.getElementById('newGameBtn');
const featuredGemEl = document.getElementById('featuredGem');
const featuredTextEl = document.getElementById('featuredText');
const popupLayer = document.getElementById('popupLayer');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const stageBanner = document.getElementById('stageBanner');
const stageBannerNum = document.getElementById('stageBannerNum');
const stageBannerName = document.getElementById('stageBannerName');
const stageFlash = document.getElementById('stageFlash');
const sceneEl = document.getElementById('scene');
const legendEl = document.getElementById('legend');
const petalsEl = document.getElementById('petals');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }
function nextFrame() {
  return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
}

function countOnBoard(b, t) {
  let n = 0;
  for (const row of b) for (const v of row) if (v === t) n++;
  return n;
}

function currentValue(t, b, stageIdx) {
  switch (t) {
    case 0: return Math.min(5 * (2 ** growth[0]), 320);          // cheap, exponential
    case 1: return 50;                                            // expensive, flat
    case 2: return 10 + 5 * growth[2];                            // grows each match
    case 3: {                                                     // rarer worth more
      const cnt = countOnBoard(b, 3);
      return cnt > 0 ? Math.max(20, Math.min(360, Math.round(360 / cnt))) : 360;
    }
    case 4: return 15;                                            // flat
    case 5: return 8 * (1 + stageIdx);                            // stage-scaled
    default: return 10;
  }
}

function samePair(p1, p2) {
  if (!p1 || !p2) return false;
  const k = (x) => `${x.r},${x.c}`;
  const s1 = [k(p1.a), k(p1.b)].sort().join('|');
  const s2 = [k(p2.a), k(p2.b)].sort().join('|');
  return s1 === s2;
}

function findAllValidMoves(b) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && Game.isValidSwap(b, { r, c }, { r, c: c + 1 })) {
        moves.push({ a: { r, c }, b: { r, c: c + 1 } });
      }
      if (r + 1 < ROWS && Game.isValidSwap(b, { r, c }, { r: r + 1, c })) {
        moves.push({ a: { r, c }, b: { r: r + 1, c } });
      }
    }
  }
  return moves;
}

function getCellSize() {
  if (cachedCellSize) return cachedCellSize;
  const r0 = cells[0][0].el.getBoundingClientRect();
  const r1 = cells[0][1].el.getBoundingClientRect();
  cachedCellSize = r1.left - r0.left || r0.width;
  return cachedCellSize;
}
window.addEventListener('resize', () => { cachedCellSize = null; });

function gemSVG(type) {
  return `<svg viewBox="0 0 100 100" class="gem-icon">
    <g clip-path="url(#clip-gem-${type})">
      <rect x="-6" y="-6" width="112" height="112" fill="url(#grad-gem-${type})"/>
      <rect x="-6" y="-6" width="112" height="112" fill="url(#gemShade)"/>
      <ellipse cx="34" cy="30" rx="22" ry="14" fill="url(#gemShine)"/>
    </g>
    <g class="gem-outline">${SHAPE_MARKUP[type]}</g>
    <g class="gem-edge">${SHAPE_MARKUP[type]}</g>
    <g class="gem-facet">${EXTRA_FACETS[type] || ''}</g>
  </svg>`;
}

function setGemContent(wrap, type) {
  wrap.innerHTML = gemSVG(type);
  wrap.dataset.type = String(type);
  wrap.classList.toggle('featured-gem', type === featuredType);
}

// ---------------------------------------------------------------------------
// Shared SVG defs (gradients + clip paths), built once
// ---------------------------------------------------------------------------

function buildDefs() {
  const gradients = GEM_GRADIENTS.map(([a, m, z], i) => `
    <linearGradient id="grad-gem-${i}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="45%" stop-color="${m}"/>
      <stop offset="100%" stop-color="${z}"/>
    </linearGradient>`).join('');
  const clips = SHAPE_MARKUP.map((markup, i) => `
    <clipPath id="clip-gem-${i}">${markup}</clipPath>`).join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>
    ${gradients}
    <radialGradient id="gemShine" cx="35%" cy="28%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gemShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </linearGradient>
    ${clips}
  </defs>`;
  document.body.appendChild(svg);
}

function buildLegend() {
  legendEl.innerHTML = GEM_META.map((meta, i) => `
    <span class="legend-item">${gemSVG(i)}<span>${meta.name}</span></span>
  `).join('');
}

function spawnPetals() {
  const n = 20;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    const left = Math.random() * 100;
    const duration = 9 + Math.random() * 8;
    const delay = -Math.random() * duration;
    const scale = 0.7 + Math.random() * 0.9;
    p.style.left = `${left}vw`;
    p.style.animationDuration = `${duration}s`;
    p.style.animationDelay = `${delay}s`;
    p.style.transform = `scale(${scale})`;
    p.style.opacity = String(0.5 + Math.random() * 0.4);
    petalsEl.appendChild(p);
  }
}

// ---------------------------------------------------------------------------
// Board DOM construction
// ---------------------------------------------------------------------------

function buildBoardDom() {
  boardEl.innerHTML = '';
  cells = [];
  for (let r = 0; r < ROWS; r++) {
    const rowArr = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('data-testid', 'cell');

      const wrap = document.createElement('div');
      wrap.className = 'gem-wrap';
      wrap.style.setProperty('--i', String(r * COLS + c));
      cell.appendChild(wrap);

      cell.addEventListener('pointerdown', (e) => onPointerDown(e, r, c));
      boardEl.appendChild(cell);
      rowArr.push({ el: cell, gemWrap: wrap });
    }
    cells.push(rowArr);
  }
}

function renderBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const wrap = cells[r][c].gemWrap;
      wrap.style.transition = 'none';
      wrap.style.transform = 'translate(0,0)';
      setGemContent(wrap, board[r][c]);
    }
  }
}

// ---------------------------------------------------------------------------
// Cascade fall-offset computation (for physical drop animation)
// ---------------------------------------------------------------------------

function computeFallOffsets(oldBoard, matches) {
  const matchedSet = new Set(matches.map((m) => `${m.r},${m.c}`));
  const fallFrom = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let c = 0; c < COLS; c++) {
    const survivorOldRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(`${r},${c}`)) survivorOldRows.push(r);
    }
    const removed = ROWS - survivorOldRows.length;
    for (let i = 0; i < survivorOldRows.length; i++) {
      const newRow = removed + i;
      const oldRow = survivorOldRows[i];
      fallFrom[newRow][c] = Math.max(0, newRow - oldRow);
    }
    for (let r = 0; r < removed; r++) {
      fallFrom[r][c] = removed - r + 1;
    }
  }
  return fallFrom;
}

async function playWave(step, incomingBoard) {
  for (const { r, c } of step.matches) {
    cells[r][c].gemWrap.classList.add('clearing');
  }
  await wait(CLEAR_MS);
  for (const { r, c } of step.matches) {
    cells[r][c].gemWrap.classList.remove('clearing');
  }

  const fallFrom = computeFallOffsets(incomingBoard, step.matches);
  const cellSize = getCellSize();
  board = step.board;

  let maxDist = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const wrap = cells[r][c].gemWrap;
      const dist = fallFrom[r][c];
      if (dist > maxDist) maxDist = dist;
      wrap.style.transition = 'none';
      wrap.style.transform = dist > 0 ? `translateY(${-dist * cellSize}px)` : 'translate(0,0)';
      setGemContent(wrap, step.board[r][c]);
    }
  }

  await nextFrame();
  const dropDuration = 260 + Math.min(maxDist, 7) * 65;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (fallFrom[r][c] > 0) {
        const wrap = cells[r][c].gemWrap;
        wrap.style.transition = `transform ${dropDuration}ms cubic-bezier(0.6, 0.04, 0.98, 0.34)`;
        wrap.style.transform = 'translate(0,0)';
      }
    }
  }
  await wait(dropDuration + 30);
}

// ---------------------------------------------------------------------------
// Drag / slide interaction
// ---------------------------------------------------------------------------

let dragState = null;

function onPointerDown(e, r, c) {
  if (busy || gameOver) return;
  e.preventDefault();
  dragState = { r, c, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, pointerId: e.pointerId };
  try { cells[r][c].el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  dragState.dx = dx;
  dragState.dy = dy;
  const cellSize = getCellSize();
  const cx = Math.max(-cellSize, Math.min(cellSize, dx));
  const cy = Math.max(-cellSize, Math.min(cellSize, dy));
  const wrap = cells[dragState.r][dragState.c].gemWrap;
  wrap.style.transition = 'none';
  wrap.style.transform = `translate(${cx}px, ${cy}px)`;
}

function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  if (!dragState) return;
  const { r, c, dx, dy } = dragState;
  dragState = null;
  const cellSize = getCellSize();
  const threshold = Math.max(14, cellSize * 0.28);
  const wrap = cells[r][c].gemWrap;
  const absX = Math.abs(dx), absY = Math.abs(dy);

  if (Math.max(absX, absY) < threshold) {
    snapBack(wrap);
    return;
  }

  let tr = r, tc = c;
  if (absX >= absY) tc = c + (dx > 0 ? 1 : -1);
  else tr = r + (dy > 0 ? 1 : -1);

  if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) {
    snapBack(wrap);
    return;
  }

  const origin = { r, c }, target = { r: tr, c: tc };
  if (!Game.isValidSwap(board, origin, target)) {
    snapBack(wrap, cells[r][c].el);
    return;
  }
  commitMove(origin, target);
}

function snapBack(wrap, shakeEl) {
  wrap.style.transition = `transform 220ms cubic-bezier(.34,1.56,.64,1)`;
  requestAnimationFrame(() => { wrap.style.transform = 'translate(0,0)'; });
  if (shakeEl) {
    shakeEl.classList.add('shake');
    setTimeout(() => shakeEl.classList.remove('shake'), 340);
  }
}

async function commitMove(origin, target) {
  busy = true;
  const hintAtMoveTime = hintPair;
  clearTimeout(idleTimer);

  const cellSize = getCellSize();
  const dxSign = target.c - origin.c;
  const dySign = target.r - origin.r;
  const originWrap = cells[origin.r][origin.c].gemWrap;
  const targetWrap = cells[target.r][target.c].gemWrap;
  originWrap.style.transition = `transform ${SNAP_MS}ms cubic-bezier(.3,.8,.4,1)`;
  targetWrap.style.transition = `transform ${SNAP_MS}ms cubic-bezier(.3,.8,.4,1)`;
  requestAnimationFrame(() => {
    originWrap.style.transform = `translate(${dxSign * cellSize}px, ${dySign * cellSize}px)`;
    targetWrap.style.transform = `translate(${-dxSign * cellSize}px, ${-dySign * cellSize}px)`;
  });
  await wait(SNAP_MS + 20);

  const swapped = Game.applySwap(board, origin, target);
  board = swapped;
  renderBoard();

  const { steps } = Game.collapse(swapped, rngFn, TYPES);

  const incomingBoards = [];
  let incoming = swapped;
  for (const step of steps) {
    incomingBoards.push(incoming);
    incoming = step.board;
  }

  let L = 0;
  for (const ib of incomingBoards) L = Math.max(L, Game.longestRun(ib));
  multiplier = Game.matchMultiplier(multiplier, L);

  let rawTotal = 0;
  let featuredCount = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const ib = incomingBoards[i];
    let waveRaw = 0;
    const typesSeenThisWave = new Set();
    for (const { r, c } of step.matches) {
      const t = ib[r][c];
      waveRaw += currentValue(t, ib, stage);
      typesSeenThisWave.add(t);
      if (t === featuredType) featuredCount++;
    }
    const factor = i === 0 ? 1 : 2;
    rawTotal += waveRaw * factor;

    for (const t of typesSeenThisWave) {
      if (t === 0) growth[0] = Math.min(growth[0] + 1, 6);
      if (t === 2) growth[2] += 1;
    }

    await playWave(step, ib);
  }

  const moveScore = rawTotal * multiplier;
  const stageFeatureBonus = featuredCount * FEATURE_BONUS_PER_GEM;
  const deviation = (hintAtMoveTime && !samePair(hintAtMoveTime, { a: origin, b: target })) ? DEVIATION_BONUS : 0;
  const gain = Math.round(moveScore + stageFeatureBonus + deviation);

  score += gain;
  lastGain = gain;
  lastBonus = deviation;

  if (score > best) {
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* ignore */ }
  }

  const newStage = Game.stageForScore(score);
  const stageChanged = newStage !== stage;
  stage = newStage;
  if (stageChanged) {
    featuredType = STAGES[stage % STAGES.length].featured;
    applyStageTheme(stage);
    showStageBanner(stage);
  }

  showScorePopup(gain, deviation, stageFeatureBonus, L);
  updateHud();
  clearHint();

  if (!Game.hasValidMove(board)) {
    enterGameOver();
  } else {
    resetIdleTimer();
  }

  busy = false;
}

// ---------------------------------------------------------------------------
// Idle hint
// ---------------------------------------------------------------------------

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (gameOver) return;
  idleTimer = setTimeout(() => {
    if (busy || gameOver) return;
    const moves = findAllValidMoves(board);
    if (moves.length === 0) return;
    hintPair = moves[Math.floor(Math.random() * moves.length)];
    cells[hintPair.a.r][hintPair.a.c].gemWrap.classList.add('hint');
    cells[hintPair.b.r][hintPair.b.c].gemWrap.classList.add('hint');
  }, IDLE_MS);
}

function clearHint() {
  if (hintPair) {
    const { a, b } = hintPair;
    cells[a.r][a.c].gemWrap.classList.remove('hint');
    cells[b.r][b.c].gemWrap.classList.remove('hint');
  }
  hintPair = null;
}

// ---------------------------------------------------------------------------
// HUD, popups, stage banner, theme
// ---------------------------------------------------------------------------

function updateHud() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  multiplierEl.textContent = `×${multiplier}`;
  multiplierStatEl.classList.remove('pulse');
  void multiplierStatEl.offsetWidth;
  multiplierStatEl.classList.add('pulse');
  stageNameEl.textContent = STAGES[stage % STAGES.length].name;
  featuredGemEl.innerHTML = gemSVG(featuredType);
  featuredTextEl.textContent = `${GEM_META[featuredType].name} earns a +${FEATURE_BONUS_PER_GEM}/gem blessing this stage`;
}

function showScorePopup(gain, deviation, featureBonus, longestRunLen) {
  const el = document.createElement('div');
  el.className = 'score-popup';
  let tags = '';
  if (multiplier > 1) tags += `<span class="tag mult">×${multiplier} streak</span>`;
  if (featureBonus > 0) tags += `<span class="tag mult">+${featureBonus} favour</span>`;
  if (deviation > 0) tags += `<span class="tag bonus">+${deviation} bonus ✦</span>`;
  el.innerHTML = `<div class="gain">+${gain}</div><div>${tags}</div>`;
  popupLayer.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

function showStageBanner(stageIdx) {
  const theme = STAGES[stageIdx % STAGES.length];
  stageBannerNum.textContent = String(stageIdx + 1);
  stageBannerName.textContent = theme.name;
  stageBanner.classList.remove('show');
  void stageBanner.offsetWidth;
  stageBanner.classList.add('show');
  stageFlash.classList.remove('flash');
  void stageFlash.offsetWidth;
  stageFlash.classList.add('flash');
}

function applyStageTheme(stageIdx) {
  const t = STAGES[stageIdx % STAGES.length];
  sceneEl.style.setProperty('--sky-a', t.sky[0]);
  sceneEl.style.setProperty('--sky-b', t.sky[1]);
  sceneEl.style.setProperty('--accent', t.accent);
  sceneEl.style.setProperty('--glow', t.glow);
  sceneEl.style.setProperty('--mist-o', String(t.mist));
  sceneEl.style.setProperty('--water-a', t.waterA);
  sceneEl.style.setProperty('--water-b', t.waterB);
  sceneEl.dataset.stage = String(stageIdx % STAGES.length);
}

function enterGameOver() {
  gameOver = true;
  clearTimeout(idleTimer);
  clearHint();
  gameOverOverlay.classList.remove('hidden');
  finalScoreEl.textContent = String(score);
  newGameBtn.classList.add('urgent');
}

// ---------------------------------------------------------------------------
// New game / boot
// ---------------------------------------------------------------------------

function newGame() {
  score = 0;
  multiplier = 1;
  stage = 0;
  featuredType = STAGES[0].featured;
  gameOver = false;
  busy = false;
  hintPair = null;
  lastGain = 0;
  lastBonus = 0;
  growth = [0, 0, 0, 0, 0, 0];
  cachedCellSize = null;

  board = Game.createBoard(ROWS, COLS, TYPES, rngFn);

  applyStageTheme(0);
  gameOverOverlay.classList.add('hidden');
  newGameBtn.classList.remove('urgent');
  renderBoard();
  updateHud();
  resetIdleTimer();
}

function slide(r, c, dir) {
  const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const d = deltas[dir];
  if (!d) return Promise.resolve(false);
  const tr = r + d[0], tc = c + d[1];
  if (busy || gameOver) return Promise.resolve(false);
  if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return Promise.resolve(false);
  const origin = { r, c }, target = { r: tr, c: tc };
  if (!Game.isValidSwap(board, origin, target)) return Promise.resolve(false);
  return commitMove(origin, target);
}

function init() {
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (err) { best = 0; }
  buildDefs();
  buildBoardDom();
  buildLegend();
  spawnPetals();
  newGameBtn.addEventListener('click', newGame);
  newGame();
  installTestHooks();
}

function installTestHooks() {
  window.__test = {
    score: () => score,
    lastGain: () => lastGain,
    lastBonus: () => lastBonus,
    multiplier: () => multiplier,
    gemValues: () => [0, 1, 2, 3, 4, 5].map((t) => currentValue(t, board, stage)),
    stage: () => stage,
    featuredType: () => featuredType,
    bestScore: () => best,
    validMove: () => findAllValidMoves(board)[0] || null,
    board: () => board.map((row) => row.slice()),
    gameOver: () => gameOver,
    hint: () => (hintPair ? { a: { ...hintPair.a }, b: { ...hintPair.b } } : null),
    slide,
  };
}

init();
