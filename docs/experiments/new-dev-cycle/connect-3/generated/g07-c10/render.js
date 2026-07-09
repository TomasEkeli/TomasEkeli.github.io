// render.js — UI, interaction, animation, scoring, stages, high scores.
// Pure game logic is imported from ./game.js; this module owns everything
// visual and stateful (colour economy, stages, hint/idle, persistence).

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
// Configuration
// ---------------------------------------------------------------------------
const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const BEST_KEY = 'orrery-best-score-v1';

const CLEAR_MS = 200;      // clear beat before a drop
const SWAP_MS = 150;       // the slide of a committed / rejected swap
const DROP_UNIT_MS = 78;   // per-row-of-travel base (scaled by sqrt for gravity)
const IDLE_MS = 10000;     // idle time before a hint
const DEVIATION_BONUS = 100;

// The UI's own RNG (game.js stays pure/injected; Math.random is fine here).
const rng = Math.random;

// ---------------------------------------------------------------------------
// Gem identities — a distinct SHAPE + hue per colour (colour-blind safe),
// each rendered as a faceted, lit jewel that fills its cell.
// ---------------------------------------------------------------------------
const GEMS = [
  { name: 'Star',    shape: 'star',     hue: '#FFD54A', dark: '#B67F14', light: '#FFF3C2' },
  { name: 'Moon',    shape: 'crescent', hue: '#CFE3FF', dark: '#6E86B8', light: '#FFFFFF' },
  { name: 'Comet',   shape: 'comet',    hue: '#38E1D6', dark: '#0E7C77', light: '#CFFFF9' },
  { name: 'Planet',  shape: 'ringed',   hue: '#FF7BAC', dark: '#A63466', light: '#FFD6E6' },
  { name: 'Sun',     shape: 'sun',      hue: '#FF8A3D', dark: '#A64B12', light: '#FFDCA8' },
  { name: 'Nebula',  shape: 'nebula',   hue: '#B57BFF', dark: '#6234A6', light: '#E9D6FF' },
];

// ---------------------------------------------------------------------------
// Stage themes — a tour of the planets. Each restyles the whole sky and, on
// most planets, spotlights one colour for a bonus.
// ---------------------------------------------------------------------------
const STAGES = [
  { name: 'Mercury', sub: 'The scorched messenger',
    sky: ['#2b2622', '#4a3c30', '#100c09'], nebA: 'rgba(210,160,110,0.28)', nebB: 'rgba(120,120,140,0.20)',
    accent: '#ffcf8a', accent2: '#d9c2a6', featured: 4 },
  { name: 'Venus', sub: 'Veils of golden cloud',
    sky: ['#3a2a12', '#6b4d1c', '#160f05'], nebA: 'rgba(255,196,90,0.30)', nebB: 'rgba(200,120,40,0.24)',
    accent: '#ffd54a', accent2: '#ffe6a8', featured: 0 },
  { name: 'Earth', sub: 'The pale blue dot',
    sky: ['#0c2a45', '#12507a', '#04101f'], nebA: 'rgba(90,190,255,0.30)', nebB: 'rgba(90,230,170,0.24)',
    accent: '#8fe0ff', accent2: '#a9ffcf', featured: 2 },
  { name: 'Mars', sub: 'The rust-red plains',
    sky: ['#3a140e', '#7a2a18', '#170705'], nebA: 'rgba(255,110,70,0.30)', nebB: 'rgba(200,60,60,0.24)',
    accent: '#ff9d7a', accent2: '#ff7bac', featured: 3 },
  { name: 'Jupiter', sub: 'Storms in the great bands',
    sky: ['#3a2810', '#7a5322', '#1a1207'], nebA: 'rgba(255,180,90,0.30)', nebB: 'rgba(210,120,70,0.24)',
    accent: '#ffbf6a', accent2: '#ff8a3d', featured: 4 },
  { name: 'Saturn', sub: 'Lord of the rings',
    sky: ['#2c2a3f', '#4d4766', '#0f0e18'], nebA: 'rgba(220,200,150,0.26)', nebB: 'rgba(150,150,210,0.22)',
    accent: '#e8dca6', accent2: '#cfe3ff', featured: 1 },
  { name: 'Uranus', sub: 'The tilted ice giant',
    sky: ['#0c3540', '#137a7a', '#04161a'], nebA: 'rgba(90,230,220,0.30)', nebB: 'rgba(120,200,255,0.22)',
    accent: '#7ff0e6', accent2: '#a9ecff', featured: 2 },
  { name: 'Neptune', sub: 'The deep blue frontier',
    sky: ['#0a1440', '#1a2a86', '#03060f'], nebA: 'rgba(90,120,255,0.32)', nebB: 'rgba(150,90,255,0.24)',
    accent: '#9fb0ff', accent2: '#b57bff', featured: 5 },
];

function stageTheme(stage) {
  return STAGES[((stage % STAGES.length) + STAGES.length) % STAGES.length];
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let board = createBoard(ROWS, COLS, TYPES, rng);
let score = 0;
let best = loadBest();
let multiplier = 1;
let lastGain = 0;
let lastBonus = 0;
let currentStage = 0;
let gameOver = false;
let busy = false;
let hint = null;
let idleTimer = null;

// Per-colour scoring state (drives the colour economy).
let timesMatched = new Array(TYPES).fill(0); // for exponential / growing colours

// DOM handles
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const multEl = document.getElementById('mult-v');
const multBox = document.getElementById('mult');
const planetNameEl = document.getElementById('planet-name');
const featureBar = document.getElementById('feature-bar');
const gameOverEl = document.getElementById('gameover');
const hintNoteEl = document.getElementById('hintnote');
const bannerEl = document.getElementById('banner');

const cellEls = []; // cellEls[r][c] -> { cell, gem }

// ---------------------------------------------------------------------------
// Colour economy — each colour worth a different amount, scaling by its rule.
// gemValues() returns the CURRENT per-gem worth of every colour.
// ---------------------------------------------------------------------------
function countOnBoard(type, brd) {
  let n = 0;
  for (const row of brd) for (const v of row) if (v === type) n++;
  return n;
}

function colourValue(type, brd) {
  switch (type) {
    case 0: // Star — cheap but EXPONENTIAL (doubles each time it matches)
      return Math.min(5 * 2 ** Math.min(timesMatched[0], 10), 5120);
    case 1: // Moon — expensive but FLAT
      return 60;
    case 2: // Comet — GROWS a little each time it matches
      return 10 + 8 * timesMatched[2];
    case 3: { // Planet — worth more the RARER it currently is on the board
      const n = countOnBoard(3, brd);
      return Math.round(600 / Math.max(1, n));
    }
    case 4: // Sun — flat, modest
      return 20;
    case 5: // Nebula — scales with the STAGE you've reached
      return 12 * (1 + currentStage);
    default:
      return 10;
  }
}

function gemValuesNow() {
  return GEMS.map((_, t) => colourValue(t, board));
}

// ---------------------------------------------------------------------------
// Gem artwork — self-contained faceted SVGs with highlight + shadow.
// ---------------------------------------------------------------------------
function gemSVG(type, uid) {
  const g = GEMS[type];
  const gid = `grad-${type}-${uid}`;
  const fid = `fac-${type}-${uid}`;
  const hid = `hl-${type}-${uid}`;
  const defs = `
    <defs>
      <radialGradient id="${gid}" cx="38%" cy="32%" r="75%">
        <stop offset="0%" stop-color="${g.light}"/>
        <stop offset="42%" stop-color="${g.hue}"/>
        <stop offset="100%" stop-color="${g.dark}"/>
      </radialGradient>
      <linearGradient id="${fid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${hid}" cx="35%" cy="28%" r="40%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
  const fill = `url(#${gid})`;
  const stroke = g.dark;
  let body = '';

  switch (g.shape) {
    case 'star':
      body = `
        <polygon points="50,4 61,36 96,36 67,57 78,92 50,70 22,92 33,57 4,36 39,36"
          fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
        <polygon points="50,4 61,36 39,36" fill="url(#${fid})"/>
        <polygon points="50,70 50,50 67,57 78,92" fill="#000" opacity="0.12"/>
        <ellipse cx="42" cy="30" rx="13" ry="9" fill="url(#${hid})"/>`;
      break;
    case 'crescent':
      body = `
        <path d="M72,50 A34,34 0 1 1 44,17 A26,26 0 1 0 44,83 A34,34 0 0 1 72,50 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M60,50 A26,26 0 0 0 44,26 A20,20 0 0 1 44,26 Z" fill="url(#${fid})" opacity="0.6"/>
        <ellipse cx="40" cy="30" rx="10" ry="7" fill="url(#${hid})"/>`;
      break;
    case 'comet':
      body = `
        <path d="M50,92 C18,58 20,20 50,7 C80,20 82,58 50,92 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M50,7 C68,18 72,40 60,64 C56,42 54,22 50,7 Z" fill="url(#${fid})"/>
        <path d="M50,92 C40,72 36,58 40,50 C48,60 52,74 50,92 Z" fill="#000" opacity="0.12"/>
        <circle cx="41" cy="30" r="10" fill="url(#${hid})"/>`;
      break;
    case 'ringed':
      body = `
        <ellipse cx="50" cy="52" rx="46" ry="15" fill="none" stroke="${stroke}" stroke-width="5" opacity="0.85"/>
        <ellipse cx="50" cy="52" rx="46" ry="15" fill="none" stroke="${g.light}" stroke-width="2" opacity="0.7"/>
        <circle cx="50" cy="50" r="30" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <ellipse cx="42" cy="40" rx="12" ry="9" fill="url(#${hid})"/>
        <path d="M50,20 a30,30 0 0 1 26,15 l-52,0 a30,30 0 0 1 26,-15Z" fill="url(#${fid})" opacity="0.5"/>`;
      break;
    case 'sun':
      body = `
        <g stroke="${stroke}" stroke-width="2" fill="${fill}">
          <polygon points="50,2 58,20 42,20"/>
          <polygon points="98,50 80,58 80,42"/>
          <polygon points="50,98 42,80 58,80"/>
          <polygon points="2,50 20,42 20,58"/>
          <polygon points="84,16 74,32 68,26"/>
          <polygon points="84,84 68,74 74,68"/>
          <polygon points="16,84 26,68 32,74"/>
          <polygon points="16,16 32,26 26,32"/>
        </g>
        <circle cx="50" cy="50" r="30" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        <ellipse cx="42" cy="40" rx="13" ry="10" fill="url(#${hid})"/>`;
      break;
    case 'nebula':
    default:
      body = `
        <polygon points="50,4 90,28 90,72 50,96 10,72 10,28"
          fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>
        <polygon points="50,4 90,28 50,50 10,28" fill="url(#${fid})"/>
        <polygon points="50,50 90,72 50,96 10,72" fill="#000" opacity="0.14"/>
        <ellipse cx="42" cy="30" rx="12" ry="8" fill="url(#${hid})"/>`;
      break;
  }

  return `<svg viewBox="0 0 100 100" aria-hidden="true">${defs}${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function buildBoard() {
  boardEl.innerHTML = '';
  cellEls.length = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = r;
      cell.dataset.c = c;

      const gem = document.createElement('div');
      gem.className = 'gem';
      // per-gem idle phase so they don't pulse in lockstep
      gem.style.animationDelay = `${((r * COLS + c) % 11) * -0.5}s`;
      cell.appendChild(gem);

      // the orbiting spark lives on the gem for the "featured" cue
      const spark = document.createElement('span');
      spark.className = 'spark';
      gem.appendChild(spark);

      cell.addEventListener('pointerdown', onPointerDown);
      boardEl.appendChild(cell);
      row.push({ cell, gem });
    }
    cellEls.push(row);
  }
  paintGems();
}

function paintGems() {
  const featured = featuredType();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { gem } = cellEls[r][c];
      const type = board[r][c];
      gem.dataset.type = type;
      // preserve the spark element; rewrite the SVG
      gem.innerHTML = gemSVG(type, `${r}-${c}`);
      const spark = document.createElement('span');
      spark.className = 'spark';
      gem.appendChild(spark);
      gem.classList.toggle('featured', featured !== null && type === featured);
    }
  }
  applyHintClasses();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function fmt(n) { return n.toLocaleString('en-US'); }

function renderHUD() {
  scoreEl.textContent = fmt(score);
  bestEl.textContent = fmt(best);
  multEl.innerHTML = `&times;${multiplier}`;
  multBox.classList.toggle('hot', multiplier > 1);

  const theme = stageTheme(currentStage);
  planetNameEl.textContent = `Stage ${currentStage} · ${theme.name}`;

  const ft = featuredType();
  if (ft === null) {
    featureBar.classList.add('empty');
    featureBar.innerHTML = '<span>No colour spotlighted here</span>';
  } else {
    featureBar.classList.remove('empty');
    featureBar.innerHTML =
      `<span class="chip-gem"><svg viewBox="0 0 100 100" style="width:100%;height:100%">${gemSVG(ft, 'chip').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></span>` +
      `<span><b>${GEMS[ft].name}</b> pays extra this stage</span>` +
      `<span class="pulse-word">Featured</span>`;
  }
}

// ---------------------------------------------------------------------------
// Stage / theme application
// ---------------------------------------------------------------------------
function featuredType() {
  return stageTheme(currentStage).featured;
}

function applyTheme(stage, { flash = false } = {}) {
  const t = stageTheme(stage);
  const root = document.documentElement.style;
  root.setProperty('--sky-top', t.sky[0]);
  root.setProperty('--sky-mid', t.sky[1]);
  root.setProperty('--sky-bottom', t.sky[2]);
  root.setProperty('--nebula-a', t.nebA);
  root.setProperty('--nebula-b', t.nebB);
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2);
  if (flash) showBanner(stage);
}

function showBanner(stage) {
  const t = stageTheme(stage);
  document.getElementById('banner-n').textContent = `Stage ${stage}`;
  document.getElementById('banner-name').textContent = t.name;
  document.getElementById('banner-sub').textContent = t.sub;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth; // restart animation
  bannerEl.classList.add('show');
}

function maybeAdvanceStage() {
  const s = stageForScore(score);
  if (s !== currentStage) {
    currentStage = s;
    applyTheme(currentStage, { flash: true });
    paintGems(); // refresh featured cue
    renderHUD();
  }
}

// ---------------------------------------------------------------------------
// Interaction — a real pointer drag tracked on the document, decided by the
// pointer position AT RELEASE (return-to-origin cancels).
// ---------------------------------------------------------------------------
let drag = null;

function cellSize() {
  const rect = cellEls[0][0].cell.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(boardEl).gap) || 6;
  return rect.width + gap;
}

function onPointerDown(e) {
  if (busy || gameOver) return;
  const cell = e.currentTarget;
  const r = +cell.dataset.r;
  const c = +cell.dataset.c;
  const gem = cellEls[r][c].gem;

  drag = {
    r, c, gem,
    startX: e.clientX,
    startY: e.clientY,
    size: cellSize(),
  };
  gem.classList.add('dragging');
  // NB: do NOT clear the hint here — the deviation-bonus check in attemptMove
  // needs to know a hint was showing at the moment the move was made.
  // Track on the document so the gesture survives leaving the origin cell.
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drag) return;
  let dx = e.clientX - drag.startX;
  let dy = e.clientY - drag.startY;
  // Constrain the visual to a single axis (the dominant one), one cell max.
  const lim = drag.size;
  if (Math.abs(dx) > Math.abs(dy)) {
    dx = Math.max(-lim, Math.min(lim, dx));
    dy = 0;
  } else {
    dy = Math.max(-lim, Math.min(lim, dy));
    dx = 0;
  }
  drag.gem.style.transition = 'none';
  drag.gem.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
}

function onPointerUp(e) {
  if (!drag) return;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);

  const d = drag;
  drag = null;

  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const threshold = d.size * 0.4;
  const dist = Math.hypot(dx, dy);

  const snapBack = () => {
    d.gem.style.transition = `transform ${SWAP_MS}ms ease`;
    d.gem.style.transform = '';
    setTimeout(() => {
      d.gem.classList.remove('dragging');
      d.gem.style.transition = '';
      d.gem.style.transform = '';
    }, SWAP_MS);
    resetIdle();
  };

  // Decided by where the gesture ENDS: below threshold => no move.
  if (dist < threshold) { snapBack(); return; }

  // Direction from the release position, not a transient crossing.
  let dr = 0, dc = 0;
  if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;

  const nr = d.r + dr;
  const nc = d.c + dc;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) { snapBack(); return; }

  d.gem.classList.remove('dragging');
  d.gem.style.transform = '';
  d.gem.style.transition = '';
  attemptMove({ r: d.r, c: d.c }, { r: nr, c: nc });
}

// ---------------------------------------------------------------------------
// Move resolution
// ---------------------------------------------------------------------------
async function attemptMove(a, b) {
  if (busy || gameOver) return;
  const valid = isValidSwap(board, a, b);

  if (!valid) {
    await animateSwap(a, b, false);
    resetIdle();
    return;
  }

  const hadHint = hint;
  const isDeviation = !!hadHint && !samePair(hadHint, { a, b });

  busy = true;
  await animateSwap(a, b, true);
  board = applySwap(board, a, b);
  paintGems();
  clearHint();

  await resolveCascades(board, isDeviation);

  busy = false;
  checkGameOver();
  resetIdle();
}

// Visually slide two adjacent gems into each other (commit or reject).
function animateSwap(a, b, commit) {
  return new Promise((resolve) => {
    const ga = cellEls[a.r][a.c].gem;
    const gb = cellEls[b.r][b.c].gem;
    const size = cellSize();
    const dx = (b.c - a.c) * size;
    const dy = (b.r - a.r) * size;
    ga.classList.add('swapping');
    gb.classList.add('swapping');
    ga.style.transition = `transform ${SWAP_MS}ms ease`;
    gb.style.transition = `transform ${SWAP_MS}ms ease`;
    ga.style.transform = `translate(${dx}px, ${dy}px)`;
    gb.style.transform = `translate(${-dx}px, ${-dy}px)`;

    setTimeout(() => {
      if (commit) {
        finishSwapStyles(ga, gb);
        resolve();
      } else {
        // reject: slide back to origin, then clear styles
        ga.style.transform = '';
        gb.style.transform = '';
        setTimeout(() => { finishSwapStyles(ga, gb); resolve(); }, SWAP_MS);
      }
    }, SWAP_MS);
  });
}

function finishSwapStyles(ga, gb) {
  for (const g of [ga, gb]) {
    g.classList.remove('swapping');
    g.style.transition = '';
    g.style.transform = '';
  }
}

async function resolveCascades(swapped, isDeviation) {
  const { steps } = collapse(swapped, rng, TYPES);

  // --- Scoring (composed here from colour values + multiplier + bonuses) ---
  let moveSum = 0;
  let featuredMatched = 0;
  const featured = featuredType();

  let incoming = swapped;
  let L = 1;
  const waveWork = new Array(TYPES).fill(0);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    L = Math.max(L, longestRun(incoming));

    let raw = 0;
    for (const { r, c } of step.matches) {
      const type = incoming[r][c];
      raw += colourValue(type, incoming);
      waveWork[type]++;
      if (featured !== null && type === featured) featuredMatched++;
    }
    const cascadeFactor = i === 0 ? 1 : 2; // drop-induced waves worth double
    moveSum += raw * cascadeFactor;

    // grow stateful colours for the NEXT wave / move
    for (let t = 0; t < TYPES; t++) if (waveWork[t] > 0) timesMatched[t]++;
    waveWork.fill(0);

    incoming = step.board;
  }

  const newMult = matchMultiplier(multiplier, L);
  const featureBonus = featuredMatched * 50;
  const devBonus = isDeviation ? DEVIATION_BONUS : 0;
  const gain = moveSum * newMult + featureBonus + devBonus;

  // --- Animate the waves in order (clear fully, THEN accelerating drop) ---
  let prev = swapped;
  for (const step of steps) {
    await playClear(step.matches);
    await playDrop(prev, step.matches, step.board);
    board = step.board;
    prev = step.board;
  }
  board = steps.length ? steps[steps.length - 1].board : swapped;
  paintGems();

  // --- Commit observable state ATOMICALLY once the board has fully settled,
  //     so the moment score() rises, board() is already full & match-free. ---
  if (steps.length) {
    multiplier = newMult;
    score += gain;
    lastGain = gain;
    lastBonus = devBonus;
    if (score > best) { best = score; saveBest(best); }
    showGain(gain, newMult, featureBonus, devBonus);
    maybeAdvanceStage();
    renderHUD();
  }
}

// clear beat: shimmer/explode matched gems, then they vanish
function playClear(matches) {
  return new Promise((resolve) => {
    for (const { r, c } of matches) cellEls[r][c].gem.classList.add('clearing');
    setTimeout(() => {
      for (const { r, c } of matches) {
        const gem = cellEls[r][c].gem;
        gem.classList.remove('clearing');
      }
      resolve();
    }, CLEAR_MS);
  });
}

// accelerating drop: survivors fall, refills stream from above
function playDrop(prevBoard, matches, nextBoard) {
  return new Promise((resolve) => {
    const size = cellSize();
    const cleared = new Set(matches.map((m) => `${m.r},${m.c}`));

    // Repaint cells to the settled wave board, then animate each from an
    // above-offset down to place with a gravity (ease-in) curve.
    let maxDuration = 0;

    for (let c = 0; c < COLS; c++) {
      // survivors of this column, top -> bottom (their source rows)
      const survivors = [];
      for (let r = 0; r < ROWS; r++) {
        if (!cleared.has(`${r},${c}`)) survivors.push(r);
      }
      const k = survivors.length;
      const refillCount = ROWS - k;

      for (let r = 0; r < ROWS; r++) {
        const { gem } = cellEls[r][c];
        // repaint to the new value
        const type = nextBoard[r][c];
        gem.dataset.type = type;
        gem.innerHTML = gemSVG(type, `${r}-${c}`);
        const spark = document.createElement('span');
        spark.className = 'spark';
        gem.appendChild(spark);

        // compute fall distance (in rows)
        let offset;
        if (r >= refillCount) {
          const srcRow = survivors[r - refillCount];
          offset = r - srcRow;
        } else {
          // refill: streamed from above the top edge
          offset = refillCount - r + 1;
        }
        if (offset < 0) offset = 0;

        gem.classList.add('dropping');
        gem.style.transition = 'none';
        gem.style.transform = offset > 0 ? `translateY(${-offset * size}px)` : '';
        // duration ~ sqrt(distance): equal acceleration, further = longer
        const dur = offset > 0 ? Math.round(DROP_UNIT_MS * Math.sqrt(offset) * 2.2) : 0;
        maxDuration = Math.max(maxDuration, dur);
        gem._dropDur = dur;
      }
    }

    // force reflow, then release everything to fall
    void boardEl.offsetWidth;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const { gem } = cellEls[r][c];
        const dur = gem._dropDur || 0;
        if (dur > 0) {
          gem.style.transition = `transform ${dur}ms cubic-bezier(0.45, 0, 0.9, 0.4)`;
          gem.style.transform = '';
        }
      }
    }

    setTimeout(() => {
      const featured = featuredType();
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const { gem } = cellEls[r][c];
          gem.classList.remove('dropping');
          gem.style.transition = '';
          gem.style.transform = '';
          gem.classList.toggle('featured', featured !== null && +gem.dataset.type === featured);
        }
      }
      resolve();
    }, maxDuration + 20);
  });
}

// big floating "+N" with the multiplier and any bonus
function showGain(gain, mult, featureBonus, devBonus) {
  const el = document.createElement('div');
  el.className = 'gain-float';
  let tags = '';
  if (featureBonus > 0) tags += `<span class="tag feat">+${fmt(featureBonus)} featured</span>`;
  if (devBonus > 0) tags += `<span class="tag dev">+${fmt(devBonus)} off-hint</span>`;
  el.innerHTML =
    `<div class="n">+${fmt(gain)}</div>` +
    (mult > 1 ? `<div class="x">&times;${mult} multiplier</div>` : '') +
    (tags ? `<div class="tags">${tags}</div>` : '');
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 1750);
}

// ---------------------------------------------------------------------------
// Game over / new game
// ---------------------------------------------------------------------------
function checkGameOver() {
  if (!hasValidMove(board)) {
    gameOver = true;
    gameOverEl.classList.add('show');
    clearHint();
  }
}

function newGame() {
  board = createBoard(ROWS, COLS, TYPES, rng);
  score = 0;
  multiplier = 1;
  lastGain = 0;
  lastBonus = 0;
  timesMatched = new Array(TYPES).fill(0);
  currentStage = 0;
  gameOver = false;
  busy = false;
  clearHint();
  gameOverEl.classList.remove('show');
  applyTheme(0);
  paintGems();
  renderHUD();
  resetIdle();
}

// ---------------------------------------------------------------------------
// Idle hint + deviation bonus
// ---------------------------------------------------------------------------
function firstValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(board, { r, c }, { r, c: c + 1 }))
        return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < ROWS && isValidSwap(board, { r, c }, { r: r + 1, c }))
        return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}

function samePair(p, q) {
  const key = (m) => {
    const a = m.a, b = m.b;
    const s = [`${a.r},${a.c}`, `${b.r},${b.c}`].sort().join('|');
    return s;
  };
  return key(p) === key(q);
}

function resetIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(showHint, IDLE_MS);
}

function showHint() {
  if (busy || gameOver || drag) return;
  const mv = firstValidMove();
  if (!mv) return;
  hint = mv;
  applyHintClasses();
  hintNoteEl.textContent = 'A move glimmers… (find another for a bonus)';
}

function clearHint() {
  if (!hint) { hintNoteEl.textContent = ''; return; }
  hint = null;
  hintNoteEl.textContent = '';
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) cellEls[r][c].gem.classList.remove('hinted');
}

function applyHintClasses() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) cellEls[r][c].gem.classList.remove('hinted');
  if (hint) {
    cellEls[hint.a.r][hint.a.c].gem.classList.add('hinted');
    cellEls[hint.b.r][hint.b.c].gem.classList.add('hinted');
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function loadBest() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Background starfield
// ---------------------------------------------------------------------------
function initStars() {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let shooting = null;
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const count = Math.round((W * H) / 4200);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      z: Math.random() * 0.8 + 0.2, // depth -> size & drift & twinkle speed
      p: Math.random() * Math.PI * 2,
    }));
  }
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  function frame() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.y += s.z * 0.12; // gentle parallax drift downward
      if (s.y > H) s.y = 0;
      const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + s.z) + s.p);
      const rad = s.z * 1.6;
      ctx.globalAlpha = tw * s.z;
      ctx.fillStyle = s.z > 0.7 ? '#fff' : '#cdd8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // occasional shooting star
    if (!shooting && Math.random() < 0.004) {
      shooting = { x: Math.random() * W * 0.6, y: Math.random() * H * 0.4, life: 1 };
    }
    if (shooting) {
      const s = shooting;
      const len = 120;
      const dx = 3.2, dy = 1.6;
      s.x += dx * 6; s.y += dy * 6; s.life -= 0.03;
      const grad = ctx.createLinearGradient(s.x, s.y, s.x - len * (dx / 3.2), s.y - len * (dy / 1.6));
      grad.addColorStop(0, `rgba(255,255,255,${Math.max(0, s.life)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - len * (dx / 3.2), s.y - len * (dy / 1.6));
      ctx.stroke();
      if (s.life <= 0) shooting = null;
    }

    requestAnimationFrame(frame);
  }
  frame();
}

// ---------------------------------------------------------------------------
// Test hooks — OBSERVATION ONLY (the gate reads these; it never uses them to
// perform moves or restarts).
// ---------------------------------------------------------------------------
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => multiplier,
  gemValues: () => gemValuesNow(),
  stage: () => stageForScore(score),
  featuredType: () => featuredType(),
  bestScore: () => loadBest(),
  validMove: () => firstValidMove(),
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => hint,
};

// Convenience slide() (NOT how the gate drives moves — the real drag is).
window.__test.slide = (r, c, dir) => {
  const map = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const [dr, dc] = map[dir] || [0, 0];
  const nr = r + dr, nc = c + dc;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return Promise.resolve();
  return attemptMove({ r, c }, { r: nr, c: nc });
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.getElementById('new-game').addEventListener('click', newGame);
document.getElementById('new-game-over').addEventListener('click', newGame);

initStars();
applyTheme(0);
buildBoard();
renderHUD();
resetIdle();
