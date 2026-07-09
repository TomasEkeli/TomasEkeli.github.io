import * as game from './game.js';

/* ---------------------------------------------------------------------- */
/* Constants                                                               */
/* ---------------------------------------------------------------------- */

const ROWS = 8, COLS = 8, TYPES = 6;
const DEVIATION_BONUS = 100;
const FEATURE_BONUS_PER_GEM = 30;
const IDLE_MS = 10000;
const BEST_KEY = 'midnight-tempest-best-score';

const TYPE_NAMES = ['Droplet', 'Shell', 'Starfish', 'Pearl', 'Anchor', 'Bolt'];

const TYPE_COLORS = [
  { light: '#e7fbff', base: '#4fd8f0', dark: '#0f8aa8' }, // Droplet - cyan
  { light: '#ffe3d2', base: '#ff8a65', dark: '#c9502a' }, // Shell - coral
  { light: '#fff3cf', base: '#ffc94d', dark: '#c9860a' }, // Starfish - amber
  { light: '#ffffff', base: '#f2ecff', dark: '#a89ccf' }, // Pearl - pale lavender
  { light: '#eaf3ff', base: '#7fa8ff', dark: '#3457b8' }, // Anchor - periwinkle
  { light: '#fbffe0', base: '#e8ff5e', dark: '#a7c516' }, // Bolt - electric lime
];

const STAGES = [
  { name: 'Calm Waters', featured: null, sky: ['#0b1622', '#13283a'], sea: ['#0e2f3a', '#124455'], rain: .18, boltMin: 20000, boltMax: 34000 },
  { name: 'Squall', featured: 3, sky: ['#0a121c', '#1a2f42'], sea: ['#0c2e3a', '#155066'], rain: .42, boltMin: 14000, boltMax: 24000 },
  { name: 'Gale', featured: 4, sky: ['#070d16', '#152233'], sea: ['#082530', '#0f4658'], rain: .62, boltMin: 8000, boltMax: 15000 },
  { name: 'Tempest', featured: 5, sky: ['#04070d', '#0c1826'], sea: ['#051c26', '#0a3242'], rain: .88, boltMin: 2600, boltMax: 6000 },
  { name: 'Eye of the Storm', featured: 1, sky: ['#140b1c', '#2a1830'], sea: ['#141826', '#241832'], rain: .12, boltMin: 18000, boltMax: 30000 },
];
const CYCLE_SUFFIX = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/* ---------------------------------------------------------------------- */
/* Shape definitions (SVG, 0..100 viewBox)                                 */
/* ---------------------------------------------------------------------- */

function starPath(cx, cy, outerR, innerR, points, rotationDeg) {
  const step = Math.PI / points;
  const rot = (rotationDeg * Math.PI) / 180;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step + rot;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
  }
  return d + 'Z';
}

const SHAPE_OUTLINES = [
  // 0 Droplet
  () => [{ tag: 'path', d: 'M50 5 C73 34 89 55 89 71 A39 39 0 1 1 11 71 C11 55 27 34 50 5 Z' }],
  // 1 Shell (fan)
  () => [{ tag: 'path', d: 'M6 80 A44 48 0 0 1 94 80 L94 90 Q50 99 6 90 Z' }],
  // 2 Starfish
  () => [{ tag: 'path', d: starPath(50, 50, 45, 19, 5, -90) }],
  // 3 Pearl
  () => [{ tag: 'circle', cx: 50, cy: 50, r: 42 }],
  // 4 Anchor
  () => [
    { tag: 'circle', cx: 50, cy: 19, r: 11 },
    { tag: 'rect', x: 44, y: 16, width: 12, height: 62, rx: 5 },
    { tag: 'rect', x: 25, y: 40, width: 50, height: 9, rx: 4 },
    { tag: 'path', d: 'M50 78 C30 78 19 90 17 88 Q30 100 50 90 Q70 100 83 88 C81 90 70 78 50 78 Z' },
  ],
  // 5 Lightning bolt
  () => [{ tag: 'path', d: 'M60 2 L26 56 L46 56 L36 98 L84 40 L56 40 Z' }],
];

const SHAPE_DETAILS = [
  null,
  () => [
    { d: 'M50 34 L50 84' }, { d: 'M30 42 L39 84' }, { d: 'M70 42 L61 84' },
    { d: 'M16 60 L27 88' }, { d: 'M84 60 L73 88' },
  ],
  () => [{ d: starPath(50, 50, 22, 9, 5, -90) }],
  () => [{ d: 'M26 34 A28 28 0 0 1 70 26' }, { d: 'M30 66 A24 24 0 0 0 62 74' }],
  null,
  null,
];

function shapeMarkup(list, extraAttrs = '') {
  return list.map((s) => {
    if (s.tag === 'circle') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${extraAttrs}/>`;
    if (s.tag === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.rx}" ${extraAttrs}/>`;
    return `<path d="${s.d}" ${extraAttrs}/>`;
  }).join('');
}

let gemUidCounter = 0;

function renderGemSVG(type) {
  const uid = `g${gemUidCounter++}`;
  const col = TYPE_COLORS[type];
  const outline = SHAPE_OUTLINES[type]();
  const detailFn = SHAPE_DETAILS[type];
  const detail = detailFn ? detailFn() : null;

  const sparkles = [
    { cx: 30, cy: 28, r: 3, delay: 0 },
    { cx: 68, cy: 62, r: 2.2, delay: 0.9 },
    { cx: 62, cy: 30, r: 1.8, delay: 1.7 },
  ];

  return `
  <svg viewBox="0 0 100 100">
    <defs>
      <linearGradient id="fill-${uid}" x1="15%" y1="8%" x2="85%" y2="95%">
        <stop offset="0%" stop-color="${col.light}"/>
        <stop offset="45%" stop-color="${col.base}"/>
        <stop offset="100%" stop-color="${col.dark}"/>
      </linearGradient>
      <radialGradient id="hl-${uid}" cx="32%" cy="24%" r="60%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="55%" stop-color="#ffffff" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="clip-${uid}">
        ${shapeMarkup(outline)}
      </clipPath>
    </defs>
    <g clip-path="url(#clip-${uid})">
      ${shapeMarkup(outline, `fill="url(#fill-${uid})" stroke="${col.dark}" stroke-width="3"`)}
      <rect x="0" y="0" width="100" height="100" fill="url(#hl-${uid})"/>
      ${detail ? shapeMarkup(detail, `fill="none" stroke="${col.dark}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"`) : ''}
      ${sparkles.map((s) => `<circle class="sparkle" cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="#ffffff" style="animation-delay:${s.delay}s"/>`).join('')}
    </g>
    <g clip-path="url(#clip-${uid})">
      ${shapeMarkup(outline, `fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2"`)}
    </g>
  </svg>`;
}

/* ---------------------------------------------------------------------- */
/* State                                                                   */
/* ---------------------------------------------------------------------- */

const rng = () => Math.random();

let board = game.createBoard(ROWS, COLS, TYPES, rng);
let score = 0;
let bestScore = Number(localStorage.getItem(BEST_KEY)) || 0;
let multiplier = 1;
let lastGain = 0;
let lastBonus = 0;
let matchCounts = new Array(TYPES).fill(0);
let animating = false;
let gameOver = false;
let hintPair = null;
let currentStage = 0;
let shownStage = -1;

let idleTimer = null;
let boltTimer = null;

/* ---------------------------------------------------------------------- */
/* DOM refs                                                                */
/* ---------------------------------------------------------------------- */

const boardEl = document.getElementById('board');
const popupLayer = document.getElementById('popup-layer');
const scoreValEl = document.getElementById('scoreVal');
const bestValEl = document.getElementById('bestVal');
const multValEl = document.getElementById('multVal');
const featuredEl = document.getElementById('featured');
const featIconEl = document.getElementById('featIcon');
const featNameEl = document.getElementById('featName');
const featBonusEl = document.getElementById('featBonus');
const stageBanner = document.getElementById('stage-banner');
const stageNumEl = document.getElementById('stage-num');
const stageNameEl = document.getElementById('stage-name');
const gameOverEl = document.getElementById('game-over');
const finalScoreEl = document.getElementById('finalScore');
const newGameBtn = document.getElementById('new-game-hud');
const hudActions = document.getElementById('hud-actions');
const overActions = document.getElementById('over-actions');
const legendEl = document.getElementById('legend');
const lightningFlashEl = document.getElementById('lightning-flash');
const bolt1 = document.getElementById('bolt1');
const bolt2 = document.getElementById('bolt2');

/* cells[r][c] = { cellEl, gemEl, gemInnerEl, type } */
const cells = Array.from({ length: ROWS }, () => new Array(COLS));

/* ---------------------------------------------------------------------- */
/* Building the board DOM                                                  */
/* ---------------------------------------------------------------------- */

function buildBoardDOM() {
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'cell' + ((r + c) % 2 ? ' dark-tile' : '');
      cellEl.dataset.testid = 'cell';
      cellEl.setAttribute('data-testid', 'cell');
      cellEl.dataset.r = String(r);
      cellEl.dataset.c = String(c);

      const gemEl = document.createElement('div');
      gemEl.className = 'gem';

      const gemInner = document.createElement('div');
      gemInner.className = 'gem-inner idle-float';
      gemInner.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s`;

      gemEl.appendChild(gemInner);
      cellEl.appendChild(gemEl);
      boardEl.appendChild(cellEl);

      cells[r][c] = { cellEl, gemEl, gemInnerEl: gemInner, type: -1 };
      attachDragHandlers(cellEl, r, c);
    }
  }
  syncAllCellsToBoard();
}

function setCellType(r, c, type) {
  const cell = cells[r][c];
  cell.type = type;
  cell.gemInnerEl.innerHTML = renderGemSVG(type);
  const featured = STAGES[currentStage % STAGES.length].featured;
  cell.gemInnerEl.classList.toggle('featured-glow', featured === type);
}

function syncAllCellsToBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) setCellType(r, c, board[r][c]);
  }
}

function refreshFeaturedHighlights() {
  const featured = STAGES[currentStage % STAGES.length].featured;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells[r][c].gemInnerEl.classList.toggle('featured-glow', featured === cells[r][c].type);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Gem value economy                                                       */
/* ---------------------------------------------------------------------- */

function countOnBoard(boardSnapshot, type) {
  let n = 0;
  for (const row of boardSnapshot) for (const v of row) if (v === type) n++;
  return n;
}

function valueOfType(type, boardSnapshot, stageIdx) {
  switch (type) {
    case 0: return Math.min(5 * Math.pow(2, matchCounts[0] || 0), 320);
    case 1: return 60;
    case 2: return 12 + 4 * (matchCounts[2] || 0);
    case 3: {
      const n = countOnBoard(boardSnapshot, 3);
      if (n <= 0) return 480;
      return Math.max(24, Math.min(480, Math.round(480 / n)));
    }
    case 4: return 20;
    case 5: return 10 * (1 + stageIdx);
    default: return 10;
  }
}

function currentGemValues() {
  return Array.from({ length: TYPES }, (_, t) => valueOfType(t, board, currentStage));
}

/* ---------------------------------------------------------------------- */
/* HUD                                                                     */
/* ---------------------------------------------------------------------- */

function updateHUD() {
  scoreValEl.textContent = Math.round(score).toLocaleString();
  bestValEl.textContent = Math.round(bestScore).toLocaleString();
  multValEl.textContent = `×${multiplier}`;

  const stageTheme = STAGES[currentStage % STAGES.length];
  if (stageTheme.featured != null) {
    featuredEl.classList.remove('none');
    featIconEl.innerHTML = renderGemSVG(stageTheme.featured);
    featNameEl.textContent = TYPE_NAMES[stageTheme.featured];
    featBonusEl.textContent = `+${FEATURE_BONUS_PER_GEM}/gem this stage`;
  } else {
    featuredEl.classList.add('none');
    featIconEl.innerHTML = '';
    featNameEl.textContent = '—';
    featBonusEl.textContent = 'calm seas, no bonus';
  }
}

function buildLegend() {
  legendEl.innerHTML = '';
  for (let t = 0; t < TYPES; t++) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const sw = document.createElement('div');
    sw.className = 'legend-swatch';
    sw.innerHTML = renderGemSVG(t);
    const label = document.createElement('span');
    label.textContent = TYPE_NAMES[t];
    item.appendChild(sw);
    item.appendChild(label);
    legendEl.appendChild(item);
  }
}

/* ---------------------------------------------------------------------- */
/* Stage backdrop + banner                                                 */
/* ---------------------------------------------------------------------- */

function applyStagePalette(stageIdx) {
  const theme = STAGES[stageIdx % STAGES.length];
  const root = document.documentElement;
  root.style.setProperty('--sky-top', theme.sky[0]);
  root.style.setProperty('--sky-mid', theme.sky[1]);
  root.style.setProperty('--sea-1', theme.sea[0]);
  root.style.setProperty('--sea-2', theme.sea[1]);
  document.querySelector('.rain').style.opacity = String(theme.rain);
  scheduleLightning();
}

function stageDisplayName(stageIdx) {
  const theme = STAGES[stageIdx % STAGES.length];
  const cycle = Math.floor(stageIdx / STAGES.length);
  const suffix = cycle > 0 ? ` ${CYCLE_SUFFIX[Math.min(cycle, CYCLE_SUFFIX.length - 1)]}` : '';
  return theme.name + suffix;
}

function announceStage(stageIdx) {
  stageNumEl.textContent = String(stageIdx);
  stageNameEl.textContent = stageDisplayName(stageIdx);
  stageBanner.classList.add('show');
  strikeLightning(true);
  setTimeout(() => stageBanner.classList.remove('show'), 2600);
}

function updateStage() {
  const newStage = game.stageForScore(score);
  if (newStage !== currentStage) {
    currentStage = newStage;
    applyStagePalette(currentStage);
    refreshFeaturedHighlights();
    if (currentStage !== shownStage) {
      shownStage = currentStage;
      announceStage(currentStage);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Lightning                                                                */
/* ---------------------------------------------------------------------- */

function strikeLightning(big) {
  lightningFlashEl.classList.remove('strike');
  void lightningFlashEl.offsetWidth;
  lightningFlashEl.classList.add('strike');

  const bolt = Math.random() < 0.5 ? bolt1 : bolt2;
  bolt.style.left = `${8 + Math.random() * 80}%`;
  bolt.style.transform = `scaleY(${big ? 1.3 : 0.8 + Math.random() * 0.6})`;
  bolt.classList.remove('strike');
  void bolt.offsetWidth;
  bolt.classList.add('strike');
}

function scheduleLightning() {
  if (boltTimer) clearTimeout(boltTimer);
  const theme = STAGES[currentStage % STAGES.length];
  const delay = theme.boltMin + Math.random() * (theme.boltMax - theme.boltMin);
  boltTimer = setTimeout(() => {
    strikeLightning(false);
    scheduleLightning();
  }, delay);
}

/* ---------------------------------------------------------------------- */
/* Idle hint                                                                */
/* ---------------------------------------------------------------------- */

function findAnyValidMove(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && game.isValidSwap(b, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && game.isValidSwap(b, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

function clearHint() {
  if (hintPair) {
    const { a, b } = hintPair;
    cells[a.r][a.c].gemInnerEl.classList.remove('hint-pulse');
    cells[b.r][b.c].gemInnerEl.classList.remove('hint-pulse');
  }
  hintPair = null;
}

function resetIdleTimer() {
  clearHint();
  if (idleTimer) clearTimeout(idleTimer);
  if (gameOver) return;
  idleTimer = setTimeout(() => {
    if (animating || gameOver) return;
    const mv = findAnyValidMove(board);
    if (!mv) return;
    hintPair = mv;
    cells[mv.a.r][mv.a.c].gemInnerEl.classList.add('hint-pulse');
    cells[mv.b.r][mv.b.c].gemInnerEl.classList.add('hint-pulse');
  }, IDLE_MS);
}

function samePair(p1, p2) {
  if (!p1 || !p2) return false;
  const k = (p) => `${p.r},${p.c}`;
  const s1 = new Set([k(p1.a), k(p1.b)]);
  return s1.has(k(p2.a)) && s1.has(k(p2.b));
}

/* ---------------------------------------------------------------------- */
/* Score popup                                                             */
/* ---------------------------------------------------------------------- */

function showGainPopup(gain, mult, bonus) {
  const pop = document.createElement('div');
  pop.className = 'gain-pop';
  pop.textContent = `+${Math.round(gain).toLocaleString()}`;
  popupLayer.appendChild(pop);
  setTimeout(() => pop.remove(), 1600);

  if (mult > 1) {
    const mtag = document.createElement('div');
    mtag.className = 'mult-tag';
    mtag.textContent = `×${mult} multiplier`;
    popupLayer.appendChild(mtag);
    setTimeout(() => mtag.remove(), 1600);
  }

  if (bonus > 0) {
    const btag = document.createElement('div');
    btag.className = 'bonus-tag';
    btag.textContent = `+${bonus} defied the storm's hint!`;
    popupLayer.appendChild(btag);
    setTimeout(() => btag.remove(), 1800);
  }
}

/* ---------------------------------------------------------------------- */
/* Animation helpers                                                       */
/* ---------------------------------------------------------------------- */

function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

function computeFallPlan(prevBoard, matches) {
  const matchedSet = new Set(matches.map((m) => `${m.r},${m.c}`));
  const plan = [];
  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(`${r},${c}`)) survivorRows.push(r);
    }
    const missing = ROWS - survivorRows.length;
    for (let r = 0; r < ROWS; r++) {
      if (r < missing) {
        plan.push({ r, c, fall: r + 1 });
      } else {
        const origRow = survivorRows[r - missing];
        plan.push({ r, c, fall: r - origRow });
      }
    }
  }
  return plan;
}

async function playClearPhase(matches) {
  for (const { r, c } of matches) {
    cells[r][c].gemInnerEl.classList.remove('idle-float', 'hint-pulse');
    cells[r][c].gemInnerEl.classList.add('matched-glow');
  }
  await wait(210);
  for (const { r, c } of matches) {
    cells[r][c].gemInnerEl.classList.remove('matched-glow');
    cells[r][c].gemInnerEl.classList.add('clearing');
  }
  await wait(300);
}

async function playDropPhase(prevBoard, matches, nextBoard) {
  const plan = computeFallPlan(prevBoard, matches);
  const cellSize = boardEl.getBoundingClientRect().width / COLS;
  let maxDuration = 0;

  for (const { r, c, fall } of plan) {
    if (fall === 0) continue;
    const gemEl = cells[r][c].gemEl;
    const newType = nextBoard[r][c];
    setCellType(r, c, newType);
    cells[r][c].gemInnerEl.classList.remove('matched-glow', 'clearing');
    cells[r][c].gemInnerEl.classList.add('idle-float');
    cells[r][c].gemInnerEl.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s`;

    const duration = Math.min(620, 200 + fall * 65);
    if (duration > maxDuration) maxDuration = duration;

    gemEl.classList.remove('falling');
    gemEl.style.transition = 'none';
    gemEl.style.transform = `translateY(${-fall * cellSize}px)`;
    // force reflow so the browser registers the start position
    void gemEl.offsetHeight;
    gemEl.style.transition = `transform ${duration}ms cubic-bezier(.55,0,1,.45)`;
    gemEl.style.transform = 'translateY(0px)';
  }

  await wait(maxDuration + 40);

  for (const { r, c } of plan) {
    cells[r][c].gemEl.style.transition = '';
  }
}

/* ---------------------------------------------------------------------- */
/* Move handling                                                           */
/* ---------------------------------------------------------------------- */

function pairKey(a, b) {
  return [`${a.r},${a.c}`, `${b.r},${b.c}`].sort().join('|');
}

async function commitMove(a, b) {
  animating = true;
  if (idleTimer) clearTimeout(idleTimer);
  const hintAtMoveStart = hintPair;
  clearHint();

  // Slide the two gems into each other's places quickly.
  const cellSize = boardEl.getBoundingClientRect().width / COLS;
  const dr = (b.r - a.r) * cellSize;
  const dc = (b.c - a.c) * cellSize;
  cells[a.r][a.c].gemEl.style.transition = 'transform .16s ease-in';
  cells[b.r][b.c].gemEl.style.transition = 'transform .16s ease-in';
  cells[a.r][a.c].gemEl.style.transform = `translate(${dc}px, ${dr}px)`;
  cells[b.r][b.c].gemEl.style.transform = `translate(${-dc}px, ${-dr}px)`;
  await wait(170);

  const stageAtMoveStart = currentStage;
  const swappedBoard = game.applySwap(board, a, b);

  cells[a.r][a.c].gemEl.style.transition = 'none';
  cells[b.r][b.c].gemEl.style.transition = 'none';
  cells[a.r][a.c].gemEl.style.transform = 'translate(0,0)';
  cells[b.r][b.c].gemEl.style.transform = 'translate(0,0)';
  setCellType(a.r, a.c, swappedBoard[a.r][a.c]);
  setCellType(b.r, b.c, swappedBoard[b.r][b.c]);

  const { board: settled, steps } = game.collapse(swappedBoard, rng, TYPES);

  // Compute the whole move's score up front from pure snapshots.
  const waveInputs = [swappedBoard, ...steps.slice(0, -1).map((s) => s.board)];
  const featuredType = STAGES[stageAtMoveStart % STAGES.length].featured;
  let baseRaw = 0;
  let maxRun = 0;
  let featuredBonus = 0;
  for (let i = 0; i < steps.length; i++) {
    const inputBoard = waveInputs[i];
    const matches = steps[i].matches;
    const cascadeFactor = i === 0 ? 1 : 2;
    let waveRaw = 0;
    for (const { r, c } of matches) {
      const type = inputBoard[r][c];
      waveRaw += valueOfType(type, inputBoard, stageAtMoveStart);
      if (type === featuredType) featuredBonus += FEATURE_BONUS_PER_GEM;
    }
    baseRaw += waveRaw * cascadeFactor;
    const runLen = game.longestRun(inputBoard);
    if (runLen > maxRun) maxRun = runLen;
    for (const { r, c } of matches) {
      const t = inputBoard[r][c];
      matchCounts[t] = (matchCounts[t] || 0) + 1;
    }
  }
  const newMultiplier = game.matchMultiplier(multiplier, maxRun);
  const deviationBonus = hintAtMoveStart && !samePair(hintAtMoveStart, { a, b }) ? DEVIATION_BONUS : 0;
  const gain = Math.round(baseRaw * newMultiplier) + featuredBonus + deviationBonus;

  // Play the animated settle sequence.
  for (let i = 0; i < steps.length; i++) {
    const inputBoard = waveInputs[i];
    await playClearPhase(steps[i].matches);
    await playDropPhase(inputBoard, steps[i].matches, steps[i].board);
  }

  board = settled;
  multiplier = newMultiplier;
  score += gain;
  lastGain = gain;
  lastBonus = deviationBonus;

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_KEY, String(Math.round(bestScore)));
  }

  updateStage();
  updateHUD();
  showGainPopup(gain, newMultiplier, deviationBonus);

  animating = false;

  if (!game.hasValidMove(board)) {
    enterGameOver();
  } else {
    resetIdleTimer();
  }
}

async function rejectMove(a, b) {
  animating = true;
  const cellSize = boardEl.getBoundingClientRect().width / COLS;
  const dr = (b.r - a.r) * cellSize * 0.4;
  const dc = (b.c - a.c) * cellSize * 0.4;
  cells[a.r][a.c].gemEl.style.transition = 'transform .12s ease-out';
  cells[a.r][a.c].gemEl.style.transform = `translate(${dc}px, ${dr}px)`;
  await wait(130);
  cells[a.r][a.c].gemEl.style.transition = 'transform .22s cubic-bezier(.34,1.4,.64,1)';
  cells[a.r][a.c].gemEl.style.transform = 'translate(0,0)';
  await wait(230);
  animating = false;
  resetIdleTimer();
}

function enterGameOver() {
  gameOver = true;
  finalScoreEl.textContent = Math.round(score).toLocaleString();
  gameOverEl.classList.add('show');
  overActions.appendChild(newGameBtn);
  if (idleTimer) clearTimeout(idleTimer);
  clearHint();
}

function newGame() {
  if (idleTimer) clearTimeout(idleTimer);
  clearHint();
  board = game.createBoard(ROWS, COLS, TYPES, rng);
  score = 0;
  multiplier = 1;
  lastGain = 0;
  lastBonus = 0;
  matchCounts = new Array(TYPES).fill(0);
  gameOver = false;
  animating = false;
  currentStage = 0;
  shownStage = -1;
  gameOverEl.classList.remove('show');
  hudActions.appendChild(newGameBtn);
  syncAllCellsToBoard();
  applyStagePalette(currentStage);
  updateHUD();
  resetIdleTimer();
}

/* ---------------------------------------------------------------------- */
/* Drag / slide gesture                                                    */
/* ---------------------------------------------------------------------- */

function attachDragHandlers(cellEl, r, c) {
  let dragging = false;
  let startX = 0, startY = 0;
  let cellSize = 0;

  cellEl.addEventListener('pointerdown', (e) => {
    if (animating || gameOver) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cellSize = boardEl.getBoundingClientRect().width / COLS;
    cellEl.setPointerCapture(e.pointerId);
    cells[r][c].gemEl.classList.add('grabbing');
    cells[r][c].gemInnerEl.classList.remove('idle-float');
  });

  cellEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let dx = e.clientX - startX;
    let dy = e.clientY - startY;
    const max = cellSize * 1.05;
    dx = Math.max(-max, Math.min(max, dx));
    dy = Math.max(-max, Math.min(max, dy));
    cells[r][c].gemEl.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    cells[r][c].gemEl.classList.remove('grabbing');
    cells[r][c].gemInnerEl.classList.add('idle-float');
    try { cellEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const threshold = cellSize * 0.32;
    const absX = Math.abs(dx), absY = Math.abs(dy);

    if (Math.max(absX, absY) < threshold) {
      // Net displacement below threshold at release: cancel, no move.
      cells[r][c].gemEl.style.transition = 'transform .18s cubic-bezier(.34,1.3,.64,1)';
      cells[r][c].gemEl.style.transform = 'translate(0,0)';
      return;
    }

    let target = null;
    if (absX > absY) {
      const nc = c + (dx > 0 ? 1 : -1);
      if (nc >= 0 && nc < COLS) target = { r, c: nc };
    } else {
      const nr = r + (dy > 0 ? 1 : -1);
      if (nr >= 0 && nr < ROWS) target = { r: nr, c };
    }

    if (!target) {
      // Off the board edge: reject.
      cells[r][c].gemEl.style.transition = 'transform .18s cubic-bezier(.34,1.3,.64,1)';
      cells[r][c].gemEl.style.transform = 'translate(0,0)';
      resetIdleTimer();
      return;
    }

    cells[r][c].gemEl.style.transition = 'transform .1s ease-out';
    cells[r][c].gemEl.style.transform = 'translate(0,0)';

    const a = { r, c };
    if (game.isValidSwap(board, a, target)) {
      commitMove(a, target);
    } else {
      rejectMove(a, target);
    }
  }

  cellEl.addEventListener('pointerup', endDrag);
  cellEl.addEventListener('pointercancel', endDrag);
}

/* ---------------------------------------------------------------------- */
/* Wire up static controls                                                 */
/* ---------------------------------------------------------------------- */

newGameBtn.addEventListener('click', newGame);

/* ---------------------------------------------------------------------- */
/* Test hooks (observation-only)                                           */
/* ---------------------------------------------------------------------- */

window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => multiplier,
  gemValues: () => currentGemValues(),
  stage: () => currentStage,
  featuredType: () => {
    const f = STAGES[currentStage % STAGES.length].featured;
    return f == null ? null : f;
  },
  bestScore: () => bestScore,
  validMove: () => findAnyValidMove(board),
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => hintPair ? { a: { ...hintPair.a }, b: { ...hintPair.b } } : null,
  slide: (r, c, dir) => {
    const deltas = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const [ddr, ddc] = deltas[dir] || [0, 0];
    const a = { r, c };
    const b = { r: r + ddr, c: c + ddc };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return Promise.resolve();
    if (animating || gameOver) return Promise.resolve();
    if (game.isValidSwap(board, a, b)) return commitMove(a, b);
    return rejectMove(a, b);
  },
};

/* ---------------------------------------------------------------------- */
/* Boot                                                                     */
/* ---------------------------------------------------------------------- */

buildBoardDOM();
buildLegend();
applyStagePalette(currentStage);
updateHUD();
resetIdleTimer();
