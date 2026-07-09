import {
  createBoard, findMatches, isValidSwap, hasValidMove,
  applySwap, collapse, longestRun, matchMultiplier, stageForScore,
} from './game.js';

// ---------------------------------------------------------------- constants

const ROWS = 8, COLS = 8, TYPES = 6;
const FEATURE_BONUS_PER_GEM = 30;
const DEVIATION_BONUS = 100;
const IDLE_MS = 10000;
const BEST_KEY = 'brassworks-match-g07c05-best-score';
const FEATURE_ORDER = [5, 1, 3, 0, 4, 2];
const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const rng = () => Math.random();

const NS = 'http://www.w3.org/2000/svg';

function polyPoints(sides, r, rotationDeg, cx = 50, cy = 50) {
  const pts = [];
  const rot = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < sides; i++) {
    const theta = rot + i * ((2 * Math.PI) / sides);
    pts.push(`${(cx + r * Math.cos(theta)).toFixed(2)},${(cy + r * Math.sin(theta)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function spikedPoints(outerR, innerR, spikes, cx = 50, cy = 50, rotationDeg = -90) {
  const pts = [];
  const rot = (rotationDeg * Math.PI) / 180;
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const theta = rot + i * step;
    pts.push(`${(cx + r * Math.cos(theta)).toFixed(2)},${(cy + r * Math.sin(theta)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// Flat-topped cog teeth -- reads as an actual gear, not a starburst.
function cogPoints(outerR, innerR, teeth, cx = 50, cy = 50, rotationDeg = -90) {
  const pts = [];
  const rot = (rotationDeg * Math.PI) / 180;
  const anglePerTooth = (2 * Math.PI) / teeth;
  const tipHalf = anglePerTooth * 0.24;
  const rootHalf = anglePerTooth * 0.46;
  const pt = (r, theta) => `${(cx + r * Math.cos(theta)).toFixed(2)},${(cy + r * Math.sin(theta)).toFixed(2)}`;
  for (let i = 0; i < teeth; i++) {
    const center = rot + i * anglePerTooth;
    pts.push(pt(innerR, center - rootHalf));
    pts.push(pt(outerR, center - tipHalf));
    pts.push(pt(outerR, center + tipHalf));
    pts.push(pt(innerR, center + rootHalf));
  }
  return pts.join(' ');
}

function facetOf(pointsStr, scale = 0.48, shiftX = -7, shiftY = -9) {
  return pointsStr.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number);
    const nx = 50 + (x - 50) * scale + shiftX;
    const ny = 50 + (y - 50) * scale + shiftY;
    return `${nx.toFixed(2)},${ny.toFixed(2)}`;
  }).join(' ');
}

// Six colour-blind-safe silhouettes: 10-tooth gear, hexagon, triangle,
// pentagon, diamond, 8-point star.
const TYPE_META = [
  {
    name: 'Gearcog', points: cogPoints(46, 31, 8), colors: ['#fff0c2', '#e0a83e', '#7a5015'], rim: '#3d2708',
    extra: '<circle cx="50" cy="50" r="13" fill="#3d2708" opacity="0.55"/><circle cx="50" cy="50" r="13" fill="none" stroke="#7a5015" stroke-width="2"/>',
  },
  {
    name: 'Rivet', points: polyPoints(6, 44, -90), colors: ['#ffc79a', '#c9713a', '#5e2f13'], rim: '#33170a',
    extra: '<circle cx="50" cy="50" r="10" fill="#5e2f13" opacity="0.5"/>',
  },
  { name: 'Piston', points: polyPoints(3, 48, -90), colors: ['#cdeed2', '#4f9e6a', '#1f4630'], rim: '#12291c' },
  {
    name: 'Pressure Gauge', points: polyPoints(5, 46, -90), colors: ['#ffc0ad', '#d9503a', '#6e2016'], rim: '#3a1009',
    extra: '<line x1="50" y1="50" x2="50" y2="28" stroke="#3a1009" stroke-width="3" stroke-linecap="round" transform="rotate(35 50 50)"/><circle cx="50" cy="50" r="5" fill="#3a1009"/>',
  },
  {
    name: 'Valve', points: polyPoints(4, 46, -90), colors: ['#d3eef8', '#4a8fae', '#1f3f4d'], rim: '#0f2027',
    extra: '<line x1="50" y1="34" x2="50" y2="66" stroke="#0f2027" stroke-width="4" stroke-linecap="round"/><line x1="34" y1="50" x2="66" y2="50" stroke="#0f2027" stroke-width="4" stroke-linecap="round"/>',
  },
  { name: 'Steam Vent', points: spikedPoints(46, 20, 8), colors: ['#fffdf3', '#e9dba0', '#8f7638'], rim: '#4a3c17' },
];

const STAGE_THEMES = [
  {
    name: 'Boiler Room',
    gradient: 'radial-gradient(ellipse at 50% 15%, rgba(255,120,60,0.25), transparent 55%), radial-gradient(ellipse at 50% 100%, #2a1206 0%, #0d0703 70%), linear-gradient(180deg,#150d06,#0a0603)',
  },
  {
    name: 'Gearworks',
    gradient: 'radial-gradient(ellipse at 50% 10%, rgba(230,180,90,0.28), transparent 60%), radial-gradient(circle at 20% 80%, #3a2610, transparent 60%), linear-gradient(160deg,#2a1c0c,#120b04)',
  },
  {
    name: 'Pressure Rising',
    gradient: 'radial-gradient(ellipse at 50% 20%, rgba(255,90,40,0.35), transparent 55%), radial-gradient(circle at 80% 85%, #4a1608, transparent 55%), linear-gradient(180deg,#2c0f06,#100603)',
  },
  {
    name: 'Overdrive',
    gradient: 'radial-gradient(ellipse at 50% 12%, rgba(255,210,120,0.4), transparent 58%), radial-gradient(circle at 25% 20%, rgba(255,170,80,0.2), transparent 50%), linear-gradient(180deg,#3a2408,#170e04)',
  },
  {
    name: 'Steam Cathedral',
    gradient: 'radial-gradient(ellipse at 50% 10%, rgba(120,230,200,0.22), transparent 60%), radial-gradient(circle at 75% 75%, #123028, transparent 55%), linear-gradient(180deg,#0d211c,#07120e)',
  },
  {
    name: 'Furnace Core',
    gradient: 'radial-gradient(ellipse at 50% 25%, rgba(255,110,40,0.5), transparent 55%), radial-gradient(circle at 50% 100%, #5a1404, transparent 60%), linear-gradient(180deg,#3a0d04,#150502)',
  },
];

function getStageTheme(stage) {
  const base = STAGE_THEMES[stage % STAGE_THEMES.length];
  const tier = Math.floor(stage / STAGE_THEMES.length);
  const name = tier > 0 ? `${base.name} ${ROMAN[tier] || `x${tier + 1}`}` : base.name;
  return { ...base, name };
}

function featureForStage(stage) {
  return FEATURE_ORDER[stage % FEATURE_ORDER.length];
}

// ---------------------------------------------------------------- DOM refs

const boardEl = document.getElementById('board');
const slotsLayerEl = document.getElementById('slots-layer');
const gemsLayerEl = document.getElementById('gems-layer');
const feedbackLayerEl = document.getElementById('feedback-layer');
const gameOverEl = document.getElementById('game-over');
const newGameBtn = document.getElementById('new-game-btn');
const scoreValueEl = document.getElementById('score-value');
const bestValueEl = document.getElementById('best-value');
const multValueEl = document.getElementById('mult-value');
const stageSubtitleEl = document.getElementById('stage-subtitle');
const featureLabelEl = document.getElementById('feature-label');
const featureSwatchEl = document.getElementById('feature-swatch');
const bg0El = document.getElementById('bg-0');
const bg1El = document.getElementById('bg-1');
const particlesEl = document.getElementById('particles');
const stageBannerEl = document.getElementById('stage-banner');
const bannerEyebrowEl = document.getElementById('banner-eyebrow');
const bannerNameEl = document.getElementById('banner-name');

// ---------------------------------------------------------------- state

const state = {
  board: null,
  sprites: null,
  cellEls: null,
  cellSize: 60,
  score: 0,
  bestScore: 0,
  multiplier: 1,
  lastGain: 0,
  lastBonus: 0,
  stage: 0,
  featuredType: null,
  colourState: { v0: 5, v2: 10 },
  gameOver: false,
  animating: false,
  hint: null,
  idleTimer: null,
  drag: null,
  activeBg: 'bg-0',
};

// ---------------------------------------------------------------- helpers

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function inBoundsRC(p) { return p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS; }
function keyOf(p) { return `${p.r},${p.c}`; }
function sameUnorderedPair(m1, m2) {
  if (!m1 || !m2) return false;
  const s = new Set([keyOf(m1.a), keyOf(m1.b)]);
  return s.has(keyOf(m2.a)) && s.has(keyOf(m2.b));
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function countByType(board, types) {
  const counts = new Array(types).fill(0);
  for (const row of board) for (const v of row) counts[v]++;
  return counts;
}

function findAllValidMoves(board) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        moves.push({ a: { r, c }, b: { r, c: c + 1 } });
      }
      if (r + 1 < ROWS && isValidSwap(board, { r, c }, { r: r + 1, c })) {
        moves.push({ a: { r, c }, b: { r: r + 1, c } });
      }
    }
  }
  return moves;
}
function findAnyValidMove(board) {
  const moves = findAllValidMoves(board);
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

// ---------------------------------------------------------------- scoring economy

function computeGemValues(board, stage, colourState) {
  const counts = countByType(board, TYPES);
  return [
    colourState.v0,                                              // 0 cheap, exponential (doubles when matched)
    50,                                                           // 1 expensive, flat
    colourState.v2,                                              // 2 grows a fixed amount each time it matches
    Math.round(clamp(420 / Math.max(1, counts[3]), 12, 420)),     // 3 worth more the rarer it currently is
    18,                                                           // 4 flat, modest
    8 * (1 + stage),                                              // 5 scales with the current stage
  ];
}

function applyGrowth(type, colourState) {
  if (type === 0) colourState.v0 = Math.min(2560, colourState.v0 * 2);
  if (type === 2) colourState.v2 = Math.min(600, colourState.v2 + 8);
}

// ---------------------------------------------------------------- shared SVG defs & gem sprites

function buildSharedDefs() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(NS, 'defs');
  let html = `<radialGradient id="gem-shine" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
    <stop offset="60%" stop-color="#ffffff" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>`;
  TYPE_META.forEach((t, i) => {
    html += `<linearGradient id="grad-${i}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${t.colors[0]}"/>
      <stop offset="55%" stop-color="${t.colors[1]}"/>
      <stop offset="100%" stop-color="${t.colors[2]}"/>
    </linearGradient>
    <clipPath id="clip-${i}" clipPathUnits="userSpaceOnUse">
      <polygon points="${t.points}"/>
    </clipPath>`;
  });
  defs.innerHTML = html;
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

function gemInnerMarkup(type) {
  const t = TYPE_META[type];
  const facet = facetOf(t.points);
  return `<svg viewBox="0 0 100 100">
    <g clip-path="url(#clip-${type})">
      <polygon points="${t.points}" fill="url(#grad-${type})"/>
      <polygon points="${facet}" fill="rgba(255,255,255,0.24)"/>
      <ellipse cx="34" cy="28" rx="24" ry="15" fill="url(#gem-shine)" transform="rotate(-15 34 28)"/>
      ${t.extra || ''}
      <polygon points="${t.points}" fill="none" stroke="${t.rim}" stroke-width="5" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

function createSpriteEl(type) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gem';
  wrapper.dataset.type = String(type);
  const inner = document.createElement('div');
  inner.className = 'gem-inner';
  inner.style.setProperty('--idle-delay', `${(Math.random() * 3).toFixed(2)}s`);
  inner.innerHTML = gemInnerMarkup(type);
  wrapper.appendChild(inner);
  wrapper.style.width = `${state.cellSize}px`;
  wrapper.style.height = `${state.cellSize}px`;
  if (type === state.featuredType) wrapper.classList.add('featured');
  return wrapper;
}

function setSpritePos(el, r, c) {
  el.style.transform = `translate(${c * state.cellSize}px, ${r * state.cellSize}px)`;
}
function setSpritePosInstant(el, r, c) {
  el.style.transition = 'none';
  setSpritePos(el, r, c);
}

function animateMoveTo(el, r, c, duration, easing = 'cubic-bezier(0.34,1.56,0.64,1)') {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${duration}ms ${easing}`;
      setSpritePos(el, r, c);
      let done = false;
      const onEnd = () => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', onEnd);
        resolve();
      };
      el.addEventListener('transitionend', onEnd);
      setTimeout(onEnd, duration + 80);
    });
  });
}

function syncFeaturedClasses() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = state.sprites[r][c];
      if (!el) continue;
      el.classList.toggle('featured', Number(el.dataset.type) === state.featuredType);
    }
  }
}

// ---------------------------------------------------------------- layout

function computeCellSize() {
  state.cellSize = boardEl.clientWidth / COLS;
}

function relayoutAllSprites() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = state.sprites[r][c];
      if (!el) continue;
      el.style.width = `${state.cellSize}px`;
      el.style.height = `${state.cellSize}px`;
      setSpritePosInstant(el, r, c);
    }
  }
}

function buildStaticGrid() {
  state.cellEls = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.addEventListener('pointerdown', (e) => onPointerDown(e, r, c));
      slotsLayerEl.appendChild(cell);
      state.cellEls[r][c] = cell;
    }
  }
}

function populateSprites(board) {
  gemsLayerEl.innerHTML = '';
  state.sprites = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = createSpriteEl(board[r][c]);
      setSpritePosInstant(el, r, c);
      gemsLayerEl.appendChild(el);
      state.sprites[r][c] = el;
    }
  }
}

// ---------------------------------------------------------------- hint

function applyHintVisual(mv) {
  state.cellEls[mv.a.r][mv.a.c].classList.add('hinted');
  state.cellEls[mv.b.r][mv.b.c].classList.add('hinted');
}
function removeHintVisual(mv) {
  if (!mv) return;
  state.cellEls[mv.a.r][mv.a.c].classList.remove('hinted');
  state.cellEls[mv.b.r][mv.b.c].classList.remove('hinted');
}
function clearHint() {
  if (state.hint) {
    removeHintVisual(state.hint);
    state.hint = null;
  }
}
function showIdleHint() {
  if (state.animating || state.gameOver) return;
  const mv = findAnyValidMove(state.board);
  if (!mv) return;
  state.hint = mv;
  applyHintVisual(mv);
}
function clearIdleTimer() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
}
function scheduleIdle() {
  clearIdleTimer();
  if (state.gameOver) return;
  state.idleTimer = setTimeout(showIdleHint, IDLE_MS);
}

// ---------------------------------------------------------------- feedback / hud

function showFeedback(gain, multiplier, bonus) {
  const pop = document.createElement('div');
  pop.className = 'pop';
  const gainSpan = document.createElement('span');
  gainSpan.className = 'gain';
  gainSpan.textContent = `+${gain}`;
  pop.appendChild(gainSpan);
  if (multiplier > 1) {
    const m = document.createElement('span');
    m.className = 'mult';
    m.textContent = `x${multiplier} pressure`;
    pop.appendChild(m);
  }
  if (bonus > 0) {
    const b = document.createElement('span');
    b.className = 'bonus';
    b.textContent = `+${bonus} off-hint bonus`;
    pop.appendChild(b);
  }
  feedbackLayerEl.appendChild(pop);
  setTimeout(() => pop.remove(), 1700);
}

function updateHud() {
  scoreValueEl.textContent = state.score.toLocaleString();
  bestValueEl.textContent = state.bestScore.toLocaleString();
  multValueEl.textContent = `x${state.multiplier}`;
}

function updateFeatureStrip() {
  const meta = TYPE_META[state.featuredType];
  featureLabelEl.textContent = meta ? meta.name : '—';
  featureSwatchEl.innerHTML = state.featuredType != null ? gemInnerMarkup(state.featuredType) : '';
}

function loadBestScore() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    state.bestScore = Number.isFinite(v) ? v : 0;
  } catch {
    state.bestScore = 0;
  }
}
function persistBestScore() {
  try { localStorage.setItem(BEST_KEY, String(state.bestScore)); } catch { /* ignore */ }
}
function updateBestScore() {
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    persistBestScore();
  }
}

// ---------------------------------------------------------------- backdrop / stages

function applyStageBackground(stage, { withBanner = true } = {}) {
  const theme = getStageTheme(stage);
  const nextEl = state.activeBg === 'bg-0' ? bg1El : bg0El;
  const prevEl = state.activeBg === 'bg-0' ? bg0El : bg1El;
  nextEl.style.background = theme.gradient;
  if (withBanner) {
    requestAnimationFrame(() => {
      nextEl.classList.add('active');
      prevEl.classList.remove('active');
    });
  } else {
    nextEl.style.transition = 'none';
    nextEl.classList.add('active');
    prevEl.classList.remove('active');
    requestAnimationFrame(() => { nextEl.style.transition = ''; });
  }
  state.activeBg = nextEl.id;
  stageSubtitleEl.textContent = theme.name;
  if (withBanner) {
    bannerEyebrowEl.textContent = `Stage ${stage + 1}`;
    bannerNameEl.textContent = theme.name;
    stageBannerEl.classList.remove('show');
    void stageBannerEl.offsetWidth;
    stageBannerEl.classList.add('show');
  }
}

function createParticles() {
  particlesEl.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('div');
    p.className = 'ember-particle';
    p.style.left = `${Math.random() * 100}%`;
    p.style.setProperty('--drift', `${(Math.random() * 60 - 30).toFixed(0)}px`);
    p.style.animationDuration = `${(6 + Math.random() * 7).toFixed(2)}s`;
    p.style.animationDelay = `${(Math.random() * 8).toFixed(2)}s`;
    particlesEl.appendChild(p);
  }
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('div');
    s.className = 'steam-puff';
    s.style.left = `${Math.random() * 90}%`;
    s.style.animationDuration = `${(10 + Math.random() * 8).toFixed(2)}s`;
    s.style.animationDelay = `${(Math.random() * 10).toFixed(2)}s`;
    particlesEl.appendChild(s);
  }
}

// ---------------------------------------------------------------- gesture

function onPointerDown(e, r, c) {
  if (state.animating || state.gameOver) return;
  if (typeof e.button === 'number' && e.button !== 0) return;
  const cell = state.cellEls[r][c];
  try { cell.setPointerCapture(e.pointerId); } catch { /* ignore */ }

  const hintSnapshot = state.hint;
  clearHint();

  state.drag = {
    pointerId: e.pointerId, r, c, startX: e.clientX, startY: e.clientY,
    lastDx: 0, lastDy: 0, cell, hintSnapshot,
  };

  const move = (ev) => onPointerMove(ev);
  const up = (ev) => onPointerUp(ev, move, up, cancel);
  const cancel = (ev) => onPointerCancel(ev, move, up, cancel);
  state.drag.move = move; state.drag.up = up; state.drag.cancel = cancel;

  cell.addEventListener('pointermove', move);
  cell.addEventListener('pointerup', up);
  cell.addEventListener('pointercancel', cancel);
}

function onPointerMove(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  d.lastDx = dx; d.lastDy = dy;
  const cs = state.cellSize;
  const cdx = clamp(dx, -cs, cs);
  const cdy = clamp(dy, -cs, cs);
  const sprite = state.sprites[d.r][d.c];
  sprite.style.transition = 'none';
  sprite.style.zIndex = '5';
  sprite.style.transform = `translate(${d.c * cs + cdx}px, ${d.r * cs + cdy}px)`;
}

function endDrag(d) {
  d.cell.removeEventListener('pointermove', d.move);
  d.cell.removeEventListener('pointerup', d.up);
  d.cell.removeEventListener('pointercancel', d.cancel);
  try { d.cell.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
  state.drag = null;
}

function onPointerCancel(e, move, up, cancel) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  endDrag(d);
  const sprite = state.sprites[d.r][d.c];
  sprite.style.zIndex = '';
  animateMoveTo(sprite, d.r, d.c, 140).then(() => scheduleIdle());
}

function onPointerUp(e, move, up, cancel) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  endDrag(d);
  const sprite = state.sprites[d.r][d.c];
  sprite.style.zIndex = '';

  const cs = state.cellSize;
  const dx = d.lastDx, dy = d.lastDy;
  const mag = Math.max(Math.abs(dx), Math.abs(dy));
  const threshold = cs * 0.32;

  if (mag < threshold) {
    animateMoveTo(sprite, d.r, d.c, 140).then(() => scheduleIdle());
    return;
  }

  let target;
  if (Math.abs(dx) > Math.abs(dy)) {
    target = { r: d.r, c: d.c + (dx > 0 ? 1 : -1) };
  } else {
    target = { r: d.r + (dy > 0 ? 1 : -1), c: d.c };
  }

  if (!inBoundsRC(target)) {
    animateMoveTo(sprite, d.r, d.c, 140).then(() => scheduleIdle());
    return;
  }

  attemptMove({ r: d.r, c: d.c }, target, d.hintSnapshot);
}

// ---------------------------------------------------------------- move resolution

async function animateRejectSwap(a, b) {
  const elA = state.sprites[a.r][a.c];
  elA.classList.add('invalid-shake');
  await animateMoveTo(elA, b.r, b.c, 120, 'ease-out');
  await animateMoveTo(elA, a.r, a.c, 150, 'ease-in');
  elA.classList.remove('invalid-shake');
}

async function animateConfirmSwap(a, b) {
  const elA = state.sprites[a.r][a.c];
  const elB = state.sprites[b.r][b.c];
  await Promise.all([
    animateMoveTo(elA, b.r, b.c, 170),
    animateMoveTo(elB, a.r, a.c, 170),
  ]);
  state.sprites[a.r][a.c] = elB;
  state.sprites[b.r][b.c] = elA;
  state.board = applySwap(state.board, a, b);
}

async function animateClearAndDrop(step) {
  const matchedCells = step.matches;
  for (const { r, c } of matchedCells) {
    const el = state.sprites[r][c];
    if (el) el.classList.add('clearing');
  }
  await wait(300);
  for (const { r, c } of matchedCells) {
    const el = state.sprites[r][c];
    if (el) el.remove();
    state.sprites[r][c] = null;
  }

  const matchedByCol = {};
  for (const { r, c } of matchedCells) (matchedByCol[c] ||= []).push(r);

  const newSprites = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  const anims = [];

  for (let c = 0; c < COLS; c++) {
    const matchedRows = new Set(matchedByCol[c] || []);
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) if (!matchedRows.has(r)) survivorRows.push(r);
    const numSurvivors = survivorRows.length;
    const startRow = ROWS - numSurvivors;

    for (let i = 0; i < numSurvivors; i++) {
      const oldR = survivorRows[i];
      const newR = startRow + i;
      const el = state.sprites[oldR][c];
      newSprites[newR][c] = el;
      if (newR !== oldR) {
        const dist = newR - oldR;
        const duration = Math.min(900, 130 + 90 * Math.sqrt(dist));
        anims.push(animateMoveTo(el, newR, c, duration, 'cubic-bezier(0.55,0,1,0.45)'));
      }
    }

    const numNew = startRow;
    for (let j = 0; j < numNew; j++) {
      const newR = j;
      const type = step.board[newR][c];
      const el = createSpriteEl(type);
      gemsLayerEl.appendChild(el);
      const startRowAbove = newR - numNew;
      setSpritePosInstant(el, startRowAbove, c);
      newSprites[newR][c] = el;
      const dist = newR - startRowAbove;
      const duration = Math.min(900, 130 + 90 * Math.sqrt(dist));
      anims.push(animateMoveTo(el, newR, c, duration, 'cubic-bezier(0.55,0,1,0.45)'));
    }
  }

  state.sprites = newSprites;
  state.board = step.board.map((row) => row.slice());
  syncFeaturedClasses();
  await Promise.all(anims);
}

async function attemptMove(a, b, hintSnapshot) {
  state.animating = true;
  clearIdleTimer();

  const valid = isValidSwap(state.board, a, b);
  if (!valid) {
    await animateRejectSwap(a, b);
    state.animating = false;
    scheduleIdle();
    return;
  }

  const swappedBoard = applySwap(state.board, a, b);
  await animateConfirmSwap(a, b);

  const { steps } = collapse(swappedBoard, rng, TYPES);

  let runningBoard = swappedBoard;
  let totalWeighted = 0;
  let featureBonusTotal = 0;
  let maxRunLen = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const waveInput = runningBoard;
    const L = longestRun(waveInput);
    if (L > maxRunLen) maxRunLen = L;

    const values = computeGemValues(waveInput, state.stage, state.colourState);
    let waveRaw = 0;
    const typesInWave = new Set();
    for (const { r, c } of step.matches) {
      const t = waveInput[r][c];
      waveRaw += values[t];
      typesInWave.add(t);
      if (t === state.featuredType) featureBonusTotal += FEATURE_BONUS_PER_GEM;
    }
    const cascadeFactor = i === 0 ? 1 : 2;
    totalWeighted += waveRaw * cascadeFactor;

    await animateClearAndDrop(step);

    for (const t of typesInWave) applyGrowth(t, state.colourState);
    runningBoard = step.board;
  }

  const newMultiplier = matchMultiplier(state.multiplier, maxRunLen || 3);
  const deviationBonus = (hintSnapshot && !sameUnorderedPair(hintSnapshot, { a, b })) ? DEVIATION_BONUS : 0;
  const gain = Math.round(totalWeighted) * newMultiplier + featureBonusTotal + deviationBonus;

  state.multiplier = newMultiplier;
  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = deviationBonus;

  showFeedback(gain, newMultiplier, deviationBonus);
  updateBestScore();

  const newStage = stageForScore(state.score);
  if (newStage !== state.stage) {
    state.stage = newStage;
    state.featuredType = featureForStage(newStage);
    applyStageBackground(newStage, { withBanner: true });
    updateFeatureStrip();
    syncFeaturedClasses();
  }
  updateHud();

  state.animating = false;

  if (!hasValidMove(state.board)) {
    enterGameOver();
  } else {
    scheduleIdle();
  }
}

// ---------------------------------------------------------------- game over / new game

function enterGameOver() {
  state.gameOver = true;
  clearIdleTimer();
  clearHint();
  gameOverEl.classList.add('visible');
  newGameBtn.classList.add('attention');
}

function exitGameOver() {
  state.gameOver = false;
  gameOverEl.classList.remove('visible');
  newGameBtn.classList.remove('attention');
}

function newGame() {
  clearIdleTimer();
  clearHint();
  exitGameOver();
  state.board = createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.multiplier = 1;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.stage = 0;
  state.colourState = { v0: 5, v2: 10 };
  state.featuredType = featureForStage(0);
  computeCellSize();
  populateSprites(state.board);
  applyStageBackground(0, { withBanner: false });
  updateFeatureStrip();
  updateHud();
  scheduleIdle();
}

// ---------------------------------------------------------------- test hooks

function exposeTestHooks() {
  window.__test = {
    score: () => state.score,
    lastGain: () => state.lastGain,
    lastBonus: () => state.lastBonus,
    multiplier: () => state.multiplier,
    gemValues: () => computeGemValues(state.board, state.stage, state.colourState),
    stage: () => state.stage,
    featuredType: () => state.featuredType,
    bestScore: () => state.bestScore,
    validMove: () => findAnyValidMove(state.board),
    board: () => state.board.map((row) => row.slice()),
    gameOver: () => state.gameOver,
    hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
    slide: (r, c, dir) => {
      const deltas = { up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 }, left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 } };
      const d = deltas[dir];
      if (!d || state.animating || state.gameOver) return Promise.resolve(false);
      const a = { r, c }, b = { r: r + d.dr, c: c + d.dc };
      if (!inBoundsRC(b)) return Promise.resolve(false);
      const hintSnapshot = state.hint;
      clearHint();
      return attemptMove(a, b, hintSnapshot).then(() => true);
    },
  };
}

// ---------------------------------------------------------------- init

function init() {
  buildSharedDefs();
  buildStaticGrid();
  computeCellSize();

  loadBestScore();
  state.board = createBoard(ROWS, COLS, TYPES, rng);
  state.featuredType = featureForStage(0);
  populateSprites(state.board);
  applyStageBackground(0, { withBanner: false });
  createParticles();
  updateFeatureStrip();
  updateHud();
  scheduleIdle();

  window.addEventListener('resize', () => {
    computeCellSize();
    relayoutAllSprites();
  });

  newGameBtn.addEventListener('click', () => newGame());

  exposeTestHooks();
}

init();
