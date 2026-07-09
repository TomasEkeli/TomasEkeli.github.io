import * as Game from './game.js';

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const ROWS = 8, COLS = 8, TYPES = 6;
const FEATURE_BONUS_PER_GEM = 25;
const DEVIATION_BONUS = 100;
const IDLE_MS = 10000;
const CLEAR_MS = 420;
const SWAP_MS = 190;
const BEST_KEY = 'neon-horizon-best-score-v1';
const FEATURE_SEQUENCE = [0, 1, 2, 3, 4, 5];

const rng = () => Math.random();

// ---------------------------------------------------------------------
// Gem shapes (colour-blind-safe silhouettes) + colours
// ---------------------------------------------------------------------
const SHAPES = {
  diamond: {
    kind: 'polygon',
    points: [[50, 6], [84, 50], [50, 94], [16, 50]],
    cx: 50, cy: 50,
  },
  circle: { kind: 'circle', r: 44 },
  triangle: {
    kind: 'polygon',
    points: [[50, 8], [90, 86], [10, 86]],
    cx: 50, cy: 61,
  },
  hexagon: {
    kind: 'polygon',
    points: [[50, 6], [90, 28], [90, 72], [50, 94], [10, 72], [10, 28]],
    cx: 50, cy: 50,
  },
  star: {
    kind: 'polygon',
    points: [
      [50, 4], [61.17, 34.63], [93.75, 35.79], [68.07, 55.87], [77.04, 87.21],
      [50, 69], [22.96, 87.21], [31.93, 55.87], [6.25, 35.79], [38.83, 34.63],
    ],
    facetPoints: [[50, 4], [93.75, 35.79], [77.04, 87.21], [22.96, 87.21], [6.25, 35.79]],
    cx: 50, cy: 52,
  },
  pentagon: {
    kind: 'polygon',
    points: [[50, 6], [90, 38], [76, 92], [24, 92], [10, 38]],
    cx: 50, cy: 54,
  },
};

const GEM_TYPES = [
  { name: 'Ruby', shape: 'diamond', hue: '#ff2d95', huedark: '#6e0d3f', glow: '#ff2d95',
    describe: 'cheap, doubles each match' },
  { name: 'Sapphire', shape: 'circle', hue: '#22e8ff', huedark: '#014a58', glow: '#22e8ff',
    describe: 'expensive, always flat' },
  { name: 'Topaz', shape: 'triangle', hue: '#ffd23f', huedark: '#6e4f00', glow: '#ffd23f',
    describe: 'grows every match' },
  { name: 'Emerald', shape: 'hexagon', hue: '#39ff9e', huedark: '#075c34', glow: '#39ff9e',
    describe: 'worth more when rare' },
  { name: 'Amethyst', shape: 'star', hue: '#c07bff', huedark: '#3f1470', glow: '#c07bff',
    describe: 'cheap, always flat' },
  { name: 'Citrine', shape: 'pentagon', hue: '#ff9a4d', huedark: '#6e3300', glow: '#ff9a4d',
    describe: 'scales with the stage' },
];

function polyD(points) {
  return 'M' + points.map((p) => p.join(',')).join(' L') + ' Z';
}

function outlineMarkup(shape, fillUrl) {
  if (shape.kind === 'circle') {
    return `<circle cx="50" cy="50" r="${shape.r}" fill="${fillUrl}" stroke="rgba(255,255,255,.4)" stroke-width="2.2"/>`;
  }
  return `<path d="${polyD(shape.points)}" fill="${fillUrl}" stroke="rgba(255,255,255,.4)" stroke-width="2.2" stroke-linejoin="round"/>`;
}

function clipMarkup(id, shape) {
  if (shape.kind === 'circle') return `<clipPath id="${id}"><circle cx="50" cy="50" r="${shape.r}"/></clipPath>`;
  return `<clipPath id="${id}"><path d="${polyD(shape.points)}"/></clipPath>`;
}

function facetMarkup(shape) {
  if (shape.kind === 'circle') {
    let lines = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * 60) * Math.PI / 180;
      const x = (50 + 40 * Math.cos(a)).toFixed(1);
      const y = (50 + 40 * Math.sin(a)).toFixed(1);
      lines += `<line x1="50" y1="50" x2="${x}" y2="${y}" stroke="rgba(255,255,255,.28)" stroke-width="1.2"/>`;
    }
    return `<circle cx="50" cy="50" r="22" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/>${lines}`;
  }
  const pts = shape.facetPoints || shape.points;
  return pts.map((p) => `<line x1="${shape.cx}" y1="${shape.cy}" x2="${p[0]}" y2="${p[1]}" stroke="rgba(255,255,255,.26)" stroke-width="1.2"/>`).join('');
}

function gemInnerSVG(type) {
  const t = GEM_TYPES[type];
  const shape = SHAPES[t.shape];
  return (
    outlineMarkup(shape, `url(#grad-${type})`) +
    `<g clip-path="url(#clip-${type})">` +
    facetMarkup(shape) +
    `<ellipse cx="35" cy="30" rx="17" ry="9" fill="#fff" opacity=".55" transform="rotate(-18 35 30)"/>` +
    `<ellipse cx="67" cy="75" rx="20" ry="11" fill="#000" opacity=".18" transform="rotate(-14 67 75)"/>` +
    `</g>`
  );
}

function buildDefs() {
  const defs = document.getElementById('gem-defs');
  let html = '';
  GEM_TYPES.forEach((t, i) => {
    html += `<linearGradient id="grad-${i}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.hue}"/><stop offset="1" stop-color="${t.huedark}"/>
    </linearGradient>`;
    html += clipMarkup(`clip-${i}`, SHAPES[t.shape]);
  });
  defs.innerHTML = html;
}

// ---------------------------------------------------------------------
// Stage themes — synthwave night-drive sequence
// ---------------------------------------------------------------------
const THEMES = [
  { name: 'Neon Dusk', skyTop: '#170a2e', skyMid: '#3a1250', skyHorizon: '#ff2d95',
    horizonGlow: 'rgba(255,45,149,.55)', grid: '#22e8ff', sunA: '#ffd23f', sunB: '#ff2d95',
    skyline: '#2a1140', accent: '#22e8ff', accent2: '#ff2d95' },
  { name: 'Chrome Boulevard', skyTop: '#041b2d', skyMid: '#0c3a52', skyHorizon: '#22e8ff',
    horizonGlow: 'rgba(34,232,255,.5)', grid: '#ff2d95', sunA: '#eafcff', sunB: '#22e8ff',
    skyline: '#0d2c3d', accent: '#ff2d95', accent2: '#22e8ff' },
  { name: 'Neon District', skyTop: '#1a0b2e', skyMid: '#3a0b52', skyHorizon: '#c07bff',
    horizonGlow: 'rgba(192,123,255,.55)', grid: '#ff6ec7', sunA: '#ffb6f0', sunB: '#c07bff',
    skyline: '#3a1250', accent: '#ff6ec7', accent2: '#c07bff' },
  { name: 'Laser Highway', skyTop: '#210505', skyMid: '#4a0e0e', skyHorizon: '#ff5d3d',
    horizonGlow: 'rgba(255,93,61,.55)', grid: '#ff9a4d', sunA: '#ffcf3d', sunB: '#ff5d3d',
    skyline: '#3a0f0f', accent: '#ff9a4d', accent2: '#ff5d3d' },
  { name: 'Midnight Arcade', skyTop: '#04040f', skyMid: '#10102a', skyHorizon: '#39ff9e',
    horizonGlow: 'rgba(57,255,158,.32)', grid: '#39ff9e', sunA: '#c9ffe4', sunB: '#39ff9e',
    skyline: '#101034', accent: '#ff2d95', accent2: '#39ff9e' },
  { name: 'Ultraviolet Zone', skyTop: '#0a0014', skyMid: '#1a0033', skyHorizon: '#c07bff',
    horizonGlow: 'rgba(192,123,255,.6)', grid: '#d4ff3d', sunA: '#e6d1ff', sunB: '#c07bff',
    skyline: '#1a0033', accent: '#d4ff3d', accent2: '#c07bff' },
];
const CYCLE_SUFFIX = ['', ' II', ' III', ' IV', ' V', ' VI'];

function themeForStage(stage) {
  const idx = stage % THEMES.length;
  const cycle = Math.floor(stage / THEMES.length);
  const base = THEMES[idx];
  const suffix = CYCLE_SUFFIX[cycle] || ` ×${cycle + 1}`;
  return { ...base, name: base.name + suffix };
}

function applyTheme(stage) {
  const t = themeForStage(stage);
  const root = document.documentElement.style;
  root.setProperty('--stage-sky-top', t.skyTop);
  root.setProperty('--stage-sky-mid', t.skyMid);
  root.setProperty('--stage-sky-horizon', t.skyHorizon);
  root.setProperty('--stage-horizon-glow', t.horizonGlow);
  root.setProperty('--stage-grid', t.grid);
  root.setProperty('--stage-sun-a', t.sunA);
  root.setProperty('--stage-sun-b', t.sunB);
  root.setProperty('--stage-skyline', t.skyline);
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2);
}

// ---------------------------------------------------------------------
// Scoring — per-colour value schemes
// ---------------------------------------------------------------------
function countOnBoard(board, type) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === type) n++;
  return n;
}

function gemValue(type, board, matchCounts, stage) {
  switch (type) {
    case 0: return Math.min(320, 5 * Math.pow(2, Math.min(matchCounts[0], 6))); // cheap, exponential
    case 1: return 50; // expensive, flat
    case 2: return 10 + 5 * matchCounts[2]; // grows every match
    case 3: return Math.round(360 / Math.max(1, countOnBoard(board, 3))); // rarer = more
    case 4: return 15; // cheap, flat
    case 5: return 8 * (1 + stage); // stage-scaled
    default: return 10;
  }
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  board: null,
  score: 0,
  best: 0,
  multiplier: 1,
  lastGain: 0,
  lastBonus: 0,
  stage: 0,
  featuredType: 0,
  matchCounts: new Array(TYPES).fill(0),
  gameOver: false,
  hint: null,
  animating: false,
};

function loadBest() {
  try {
    const v = localStorage.getItem(BEST_KEY);
    return v ? (parseInt(v, 10) || 0) : 0;
  } catch { return 0; }
}
function persistBest() {
  try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------
const boardEl = document.getElementById('board');
const scoreVal = document.getElementById('scoreVal');
const bestVal = document.getElementById('bestVal');
const multVal = document.getElementById('multVal');
const stageVal = document.getElementById('stageVal');
const featureChip = document.getElementById('featureChip');
const featureName = document.getElementById('featureName');
const featureIcon = document.getElementById('featureIcon');
const newGameBtn = document.getElementById('newGameBtn');
const gainLayer = document.getElementById('gain-layer');
const finalScoreEl = document.getElementById('finalScore');
const stageFlash = document.getElementById('stage-flash');
const stageBanner = document.getElementById('stage-banner');
const stageBannerName = document.getElementById('stageBannerName');

let cellEls = [];
let gemEls = [];
let fxLayer;

function buildBoardDOM() {
  boardEl.innerHTML = '';
  cellEls = Array.from({ length: ROWS }, () => new Array(COLS));
  gemEls = Array.from({ length: ROWS }, () => new Array(COLS));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      const gem = document.createElement('div');
      gem.className = 'gem';
      gem.style.animationDelay = `-${(Math.random() * 3.4).toFixed(2)}s`;
      cell.appendChild(gem);
      cell.addEventListener('pointerdown', onPointerDown);
      boardEl.appendChild(cell);
      cellEls[r][c] = cell;
      gemEls[r][c] = gem;
    }
  }
  fxLayer = document.createElement('div');
  fxLayer.id = 'fx-layer';
  boardEl.appendChild(fxLayer);
}

function setGemContent(el, type) {
  el.dataset.type = String(type);
  el.classList.remove('matched', 'hidden-gem');
  el.style.transition = '';
  el.style.transform = '';
  el.style.zIndex = '';
  el.style.animation = '';
  el.innerHTML = `<svg viewBox="0 0 100 100">${gemInnerSVG(type)}</svg>`;
  if (type === state.featuredType) {
    el.classList.add('featured');
    el.style.setProperty('--feat-glow', GEM_TYPES[type].glow);
  } else {
    el.classList.remove('featured');
  }
}

function renderBoardValues() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) setGemContent(gemEls[r][c], state.board[r][c]);
  }
}

function renderHUD() {
  scoreVal.textContent = String(state.score);
  bestVal.textContent = String(state.best);
  multVal.textContent = `×${state.multiplier}`;
  const t = themeForStage(state.stage);
  stageVal.textContent = `${state.stage} — ${t.name}`;
  if (state.featuredType != null) {
    featureName.textContent = GEM_TYPES[state.featuredType].name;
    featureIcon.innerHTML = gemInnerSVG(state.featuredType);
    featureChip.style.setProperty('--feat-glow', GEM_TYPES[state.featuredType].glow);
  } else {
    featureName.textContent = '—';
    featureIcon.innerHTML = '';
  }
  finalScoreEl.textContent = String(state.score);
}

function generateStars() {
  const el = document.getElementById('stars');
  let html = '';
  for (let i = 0; i < 70; i++) {
    const x = (Math.random() * 100).toFixed(1);
    const y = (Math.random() * 100).toFixed(1);
    const delay = (Math.random() * 3.6).toFixed(2);
    html += `<div class="star" style="left:${x}%; top:${y}%; animation-delay:-${delay}s;"></div>`;
  }
  el.innerHTML = html;
}

function generateWindows() {
  const el = document.getElementById('skyline');
  let html = '';
  for (let i = 0; i < 24; i++) {
    const x = (Math.random() * 96 + 2).toFixed(1);
    const y = (20 + Math.random() * 62).toFixed(1);
    const delay = (Math.random() * 2.4).toFixed(2);
    html += `<div class="win" style="left:${x}%; top:${y}%; animation-delay:-${delay}s;"></div>`;
  }
  el.insertAdjacentHTML('beforeend', html);
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function inBounds(pos) { return pos.r >= 0 && pos.r < ROWS && pos.c >= 0 && pos.c < COLS; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function keyOf(p) { return `${p.r},${p.c}`; }
function samePair(p1, p2) {
  const s = new Set([keyOf(p1.a), keyOf(p1.b)]);
  return s.has(keyOf(p2.a)) && s.has(keyOf(p2.b));
}
function cellRect(r, c) {
  const el = cellEls[r][c];
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}
function findRandomValidPair() {
  const pairs = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && Game.isValidSwap(state.board, { r, c }, { r, c: c + 1 })) {
        pairs.push({ a: { r, c }, b: { r, c: c + 1 } });
      }
      if (r + 1 < ROWS && Game.isValidSwap(state.board, { r, c }, { r: r + 1, c })) {
        pairs.push({ a: { r, c }, b: { r: r + 1, c } });
      }
    }
  }
  if (pairs.length === 0) return null;
  return pairs[Math.floor(Math.random() * pairs.length)];
}

// ---------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------
function computeMove(a, b, hintSnapshot) {
  if (!Game.isValidSwap(state.board, a, b)) return null;
  const isDeviation = !!hintSnapshot && !samePair(hintSnapshot, { a, b });
  const swapped = Game.applySwap(state.board, a, b);
  const { board: settled, steps } = Game.collapse(swapped, rng, TYPES);

  let moveRaw = 0;
  let maxRun = 0;
  let featureCount = 0;
  let incoming = swapped;
  const matchCountsDelta = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const runLen = Game.longestRun(incoming);
    if (runLen > maxRun) maxRun = runLen;
    const cascadeFactor = i === 0 ? 1 : 2;
    let waveRaw = 0;
    const seenColours = new Set();
    for (const { r, c } of step.matches) {
      const type = incoming[r][c];
      waveRaw += gemValue(type, incoming, state.matchCounts, state.stage);
      seenColours.add(type);
      if (type === state.featuredType) featureCount++;
    }
    moveRaw += waveRaw * cascadeFactor;
    for (const t of seenColours) matchCountsDelta[t] = (matchCountsDelta[t] || 0) + 1;
    incoming = step.board;
  }

  const newMultiplier = Game.matchMultiplier(state.multiplier, maxRun || 3);
  const stageBonus = featureCount * FEATURE_BONUS_PER_GEM;
  const deviationBonus = isDeviation ? DEVIATION_BONUS : 0;
  const gain = Math.round(moveRaw * newMultiplier) + stageBonus + deviationBonus;

  return { a, b, swapped, steps, settled, newMultiplier, gain, stageBonus, deviationBonus, matchCountsDelta };
}

function commitMove(computed) {
  state.multiplier = computed.newMultiplier;
  state.score += computed.gain;
  state.lastGain = computed.gain;
  state.lastBonus = computed.deviationBonus;
  state.board = computed.settled;
  for (const [t, n] of Object.entries(computed.matchCountsDelta)) state.matchCounts[+t] += n;
  const newStage = Game.stageForScore(state.score);
  const stageChanged = newStage !== state.stage;
  state.stage = newStage;
  state.featuredType = FEATURE_SEQUENCE[state.stage % FEATURE_SEQUENCE.length];
  if (state.score > state.best) { state.best = state.score; persistBest(); }
  state.gameOver = !Game.hasValidMove(state.board);
  state.hint = null;
  return { stageChanged };
}

// ---------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------
function animateSwapCommit(a, b, swappedBoard) {
  return new Promise((resolve) => {
    const stepX = cellRect(0, 1).left - cellRect(0, 0).left;
    const stepY = cellRect(1, 0).top - cellRect(0, 0).top;
    const dR = b.r - a.r, dC = b.c - a.c;
    const gemA = gemEls[a.r][a.c], gemB = gemEls[b.r][b.c];
    gemA.style.zIndex = '20'; gemB.style.zIndex = '20';
    gemA.style.animation = 'none'; gemB.style.animation = 'none';
    gemA.style.transition = gemB.style.transition = `transform ${SWAP_MS}ms cubic-bezier(.4,0,.2,1)`;
    requestAnimationFrame(() => {
      gemA.style.transform = `translate(${dC * stepX}px, ${dR * stepY}px)`;
      gemB.style.transform = `translate(${-dC * stepX}px, ${-dR * stepY}px)`;
    });
    setTimeout(() => {
      setGemContent(gemA, swappedBoard[a.r][a.c]);
      setGemContent(gemB, swappedBoard[b.r][b.c]);
      resolve();
    }, SWAP_MS + 30);
  });
}

function animateClear(matches) {
  return new Promise((resolve) => {
    for (const { r, c } of matches) {
      const el = gemEls[r][c];
      el.style.animation = 'none';
      void el.offsetWidth;
      el.classList.add('matched');
    }
    setTimeout(() => {
      for (const { r, c } of matches) {
        gemEls[r][c].classList.remove('matched');
        gemEls[r][c].classList.add('hidden-gem');
      }
      resolve();
    }, CLEAR_MS);
  });
}

function makeGhost(type, rect) {
  const g = document.createElement('div');
  g.className = 'ghost';
  g.style.left = `${rect.left}px`;
  g.style.top = `${rect.top}px`;
  g.style.width = `${rect.width}px`;
  g.style.height = `${rect.height}px`;
  g.innerHTML = `<svg viewBox="0 0 100 100">${gemInnerSVG(type)}</svg>`;
  fxLayer.appendChild(g);
  return g;
}

function animateGhostFall(ghost, dx, dy, distanceRows) {
  return new Promise((resolve) => {
    const dur = clamp(220 + distanceRows * 90, 220, 900);
    // accelerating (ease-in) curve: slow start, fast landing.
    ghost.style.transition = `transform ${dur}ms cubic-bezier(.55,.06,.9,.35)`;
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    setTimeout(resolve, dur + 15);
  });
}

function animateDrop(prevBoard, matches, nextBoard) {
  const stepY = cellRect(1, 0).top - cellRect(0, 0).top;
  const colTasks = [];

  for (let c = 0; c < COLS; c++) {
    const matchedRows = new Set();
    for (const m of matches) if (m.c === c) matchedRows.add(m.r);
    if (matchedRows.size === 0) continue;

    const survivorsOld = [];
    for (let r = 0; r < ROWS; r++) if (!matchedRows.has(r)) survivorsOld.push(r);
    const gap = ROWS - survivorsOld.length;
    if (gap === 0) continue;

    for (let r = 0; r < ROWS; r++) gemEls[r][c].classList.add('hidden-gem');

    const tasks = [];
    for (let i = 0; i < survivorsOld.length; i++) {
      const oldR = survivorsOld[i];
      const newR = gap + i;
      const value = prevBoard[oldR][c];
      if (oldR === newR) {
        setGemContent(gemEls[newR][c], value);
        continue;
      }
      const fromRect = cellRect(oldR, c);
      const ghost = makeGhost(value, fromRect);
      const dy = (newR - oldR) * stepY;
      tasks.push(animateGhostFall(ghost, 0, dy, newR - oldR).then(() => {
        ghost.remove();
        setGemContent(gemEls[newR][c], value);
      }));
    }
    for (let newR = 0; newR < gap; newR++) {
      const value = nextBoard[newR][c];
      const toRect = cellRect(newR, c);
      const fromRect = { ...toRect, top: toRect.top - gap * stepY };
      const ghost = makeGhost(value, fromRect);
      tasks.push(animateGhostFall(ghost, 0, gap * stepY, gap).then(() => {
        ghost.remove();
        setGemContent(gemEls[newR][c], value);
      }));
    }
    colTasks.push(Promise.all(tasks));
  }
  return Promise.all(colTasks);
}

async function animateWaves(startBoard, steps) {
  let displayBoard = startBoard;
  for (const step of steps) {
    await animateClear(step.matches);
    await animateDrop(displayBoard, step.matches, step.board);
    displayBoard = step.board;
  }
}

function showGainPopup(gain, bonus, multiplier) {
  const pop = document.createElement('div');
  pop.className = 'gain-pop';
  pop.innerHTML = `+${gain}<span class="gain-mult">×${multiplier}</span>`;
  gainLayer.appendChild(pop);
  setTimeout(() => pop.remove(), 1600);
  if (bonus > 0) {
    const tag = document.createElement('div');
    tag.className = 'bonus-tag';
    tag.textContent = `+${bonus} OFF-HINT BONUS`;
    gainLayer.appendChild(tag);
    setTimeout(() => tag.remove(), 1750);
  }
}

function playStageTransition(stage) {
  const t = themeForStage(stage);
  stageBannerName.textContent = t.name;
  stageFlash.classList.remove('flash'); void stageFlash.offsetWidth; stageFlash.classList.add('flash');
  stageBanner.classList.remove('show'); void stageBanner.offsetWidth; stageBanner.classList.add('show');
  setTimeout(() => stageBanner.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------------
// Move pipeline
// ---------------------------------------------------------------------
function setInputEnabled(enabled) {
  boardEl.style.pointerEvents = enabled ? '' : 'none';
}

async function performMove(a, b, hintSnapshot) {
  const computed = computeMove(a, b, hintSnapshot);
  if (!computed) return false;

  state.animating = true;
  setInputEnabled(false);

  const { stageChanged } = commitMove(computed);
  renderHUD();
  showGainPopup(computed.gain, computed.deviationBonus, state.multiplier);
  if (stageChanged) { applyTheme(state.stage); playStageTransition(state.stage); }

  await animateSwapCommit(a, b, computed.swapped);
  await animateWaves(computed.swapped, computed.steps);
  renderBoardValues();

  state.animating = false;
  setInputEnabled(true);

  if (state.gameOver) enterGameOver();
  else restartIdleTimer();
  return true;
}

// ---------------------------------------------------------------------
// Idle hint
// ---------------------------------------------------------------------
let idleTimer = null;

function clearHintVisual() {
  if (state.hint) {
    const { a } = state.hint;
    if (cellEls[a.r] && cellEls[a.r][a.c]) cellEls[a.r][a.c].classList.remove('hint-active');
  }
}

function triggerHint() {
  if (state.animating || state.gameOver) { idleTimer = setTimeout(triggerHint, 1000); return; }
  const pair = findRandomValidPair();
  if (!pair) return;
  state.hint = pair;
  cellEls[pair.a.r][pair.a.c].classList.add('hint-active');
}

function restartIdleTimer() {
  clearTimeout(idleTimer);
  clearHintVisual();
  state.hint = null;
  idleTimer = setTimeout(triggerHint, IDLE_MS);
}

// ---------------------------------------------------------------------
// Drag / pointer input — tracked on the document so the gesture survives
// leaving the origin cell.
// ---------------------------------------------------------------------
const dragState = { active: false, pointerId: null, origin: null, startX: 0, startY: 0, hintSnapshot: null };

function onPointerDown(e) {
  if (state.animating || state.gameOver) return;
  const cell = e.currentTarget;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  dragState.active = true;
  dragState.pointerId = e.pointerId;
  dragState.origin = { r, c };
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.hintSnapshot = state.hint;
  clearHintVisual();
  state.hint = null;
  const gem = gemEls[r][c];
  gem.classList.add('dragging');
  gem.style.animation = 'none';
  e.preventDefault();
}

function onPointerMove(e) {
  if (!dragState.active || e.pointerId !== dragState.pointerId) return;
  const { r, c } = dragState.origin;
  const gem = gemEls[r][c];
  const cellPx = cellEls[r][c].offsetWidth;
  const dx = clamp(e.clientX - dragState.startX, -cellPx, cellPx);
  const dy = clamp(e.clientY - dragState.startY, -cellPx, cellPx);
  gem.style.transform = `translate(${dx}px, ${dy}px) scale(1.07)`;
}

function snapBack(gem) {
  gem.style.transition = 'transform .2s cubic-bezier(.34,1.56,.64,1)';
  gem.style.transform = '';
  setTimeout(() => { gem.style.transition = ''; gem.style.animation = ''; }, 220);
}

function bounceToward(gem, dr, dc, cellPx) {
  gem.style.transition = 'transform .11s ease-out';
  gem.style.transform = `translate(${dc * cellPx * 0.38}px, ${dr * cellPx * 0.38}px) scale(1.05)`;
  setTimeout(() => {
    gem.style.transition = 'transform .24s cubic-bezier(.34,1.56,.64,1)';
    gem.style.transform = '';
    setTimeout(() => { gem.style.transition = ''; gem.style.animation = ''; }, 250);
  }, 120);
}

function onPointerUp(e) {
  if (!dragState.active || e.pointerId !== dragState.pointerId) return;
  dragState.active = false;
  const { r, c } = dragState.origin;
  const gem = gemEls[r][c];
  gem.classList.remove('dragging');
  gem.style.zIndex = '';

  const cellPx = cellEls[r][c].offsetWidth;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const threshold = cellPx * 0.34;

  if (Math.max(adx, ady) < threshold) {
    // Released back on (or near) the origin cell — cancelled, no move.
    snapBack(gem);
    restartIdleTimer();
    return;
  }

  let dr = 0, dc = 0;
  if (adx > ady) dc = dx > 0 ? 1 : -1; else dr = dy > 0 ? 1 : -1;
  const target = { r: r + dr, c: c + dc };

  if (!inBounds(target)) {
    snapBack(gem);
    restartIdleTimer();
    return;
  }
  if (!Game.isValidSwap(state.board, { r, c }, target)) {
    bounceToward(gem, dr, dc, cellPx);
    restartIdleTimer();
    return;
  }

  gem.style.transition = '';
  gem.style.transform = '';
  performMove({ r, c }, target, dragState.hintSnapshot).then(() => {
    // idle timer is restarted inside performMove once the animation settles.
  });
}

document.addEventListener('pointermove', onPointerMove);
document.addEventListener('pointerup', onPointerUp);
document.addEventListener('pointercancel', onPointerUp);

// ---------------------------------------------------------------------
// Game over / new game
// ---------------------------------------------------------------------
function enterGameOver() {
  document.body.classList.add('game-over');
  finalScoreEl.textContent = String(state.score);
}
function exitGameOver() {
  document.body.classList.remove('game-over');
}

function startNewGame() {
  clearTimeout(idleTimer);
  clearHintVisual();
  state.board = Game.createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.multiplier = 1;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.gameOver = false;
  state.hint = null;
  state.matchCounts = new Array(TYPES).fill(0);
  state.stage = Game.stageForScore(0);
  state.featuredType = FEATURE_SEQUENCE[state.stage % FEATURE_SEQUENCE.length];
  exitGameOver();
  applyTheme(state.stage);
  renderBoardValues();
  renderHUD();
  restartIdleTimer();
}

newGameBtn.addEventListener('click', startNewGame);

// ---------------------------------------------------------------------
// Test hooks (observation-only)
// ---------------------------------------------------------------------
window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => GEM_TYPES.map((_, i) => Math.round(gemValue(i, state.board, state.matchCounts, state.stage))),
  stage: () => state.stage,
  featuredType: () => (state.featuredType == null ? null : state.featuredType),
  bestScore: () => state.best,
  validMove: () => findRandomValidPair(),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
  slide(r, c, dir) {
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const d = deltas[dir];
    if (!d) return Promise.resolve(false);
    const from = { r, c };
    const to = { r: r + d[0], c: c + d[1] };
    if (!inBounds(to) || state.animating || state.gameOver) return Promise.resolve(false);
    if (!Game.isValidSwap(state.board, from, to)) return Promise.resolve(false);
    const hintSnapshot = state.hint;
    clearHintVisual();
    state.hint = null;
    return performMove(from, to, hintSnapshot);
  },
};

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
function boot() {
  state.best = loadBest();
  buildDefs();
  buildBoardDOM();
  generateStars();
  generateWindows();
  startNewGame();
}

boot();
