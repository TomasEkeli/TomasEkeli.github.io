import * as G from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;

const FEATURED_BONUS_PER_GEM = 40;
const DEVIATION_BONUS = 100;
const IDLE_MS = 10000;
const BEST_KEY = 'neon-rain-best-score-v1';

const STAGES = [
  { name: 'Drizzle',      sky: ['#101c30', '#152443', '#0a0f1e'], accent: '#38e0ff', rainOpacity: 0.20, rainSpeed: '0.75s' },
  { name: 'Downpour',     sky: ['#0d1830', '#13223f', '#070c18'], accent: '#4fd6ff', rainOpacity: 0.36, rainSpeed: '0.45s' },
  { name: 'Neon Flood',   sky: ['#170f2e', '#2a1240', '#0a0616'], accent: '#ff4fc3', rainOpacity: 0.34, rainSpeed: '0.5s'  },
  { name: 'Midnight Calm',sky: ['#050810', '#0a0f1e', '#020306'], accent: '#8fb3ff', rainOpacity: 0.12, rainSpeed: '1.1s' },
  { name: 'Storm Surge',  sky: ['#140b26', '#1d0f38', '#05040c'], accent: '#c96bff', rainOpacity: 0.46, rainSpeed: '0.32s' },
  { name: 'Neon Eclipse', sky: ['#04060d', '#0a0a16', '#010102'], accent: '#ffb347', rainOpacity: 0.24, rainSpeed: '0.6s'  },
];

const SHAPE_CLASS = ['shape-diamond', 'shape-hex', 'shape-pentagon', 'shape-octagon', 'shape-star', 'shape-circle'];

// ---------- tiny deterministic-enough RNG for UI purposes ----------
function makeRng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = makeRng(Date.now() ^ 0xbadc0de);

// ---------- DOM refs ----------
const boardEl = document.getElementById('board');
const cellGridEl = document.getElementById('cell-grid');
const gemsLayerEl = document.getElementById('gems-layer');
const popupLayerEl = document.getElementById('popup-layer');
const gameOverEl = document.getElementById('game-over');
const newGameBtn = document.getElementById('new-game-btn');
const scoreValueEl = document.getElementById('score-value');
const bestValueEl = document.getElementById('best-value');
const multValueEl = document.getElementById('mult-value');
const stageValueEl = document.getElementById('stage-value');
const featValueEl = document.getElementById('feat-value');
const bodyEl = document.body;
const stageFlashEl = document.getElementById('stage-flash');
const stageBannerEl = document.getElementById('stage-banner');
const stageBannerNumEl = document.getElementById('stage-banner-num');
const stageBannerNameEl = document.getElementById('stage-banner-name');

// ---------- persistent game state ----------
const state = {
  board: null,
  score: 0,
  bestScore: Number(localStorage.getItem(BEST_KEY)) || 0,
  multiplier: 1,
  lastGain: 0,
  lastBonus: 0,
  gameOver: false,
  hint: null,
  animating: false,
  matchCounts: [0, 0, 0, 0, 0, 0],
  lastStageShown: -1,
  gen: 0,
};

let idleTimer = null;
let cellEls = []; // [r][c] -> interactive cell element
let gemEls = [];  // [r][c] -> gem-slot element (or null)
let metrics = { cellSize: 0 };

// ================= backdrop chrome =================

function buildBokeh() {
  const host = document.getElementById('bokeh');
  const colours = ['#38e0ff', '#ff4fc3', '#ffb347', '#8fb3ff'];
  for (let i = 0; i < 10; i++) {
    const d = document.createElement('div');
    d.className = 'bokeh-dot';
    const size = 40 + (i * 37) % 140;
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    d.style.left = ((i * 53) % 100) + '%';
    d.style.top = ((i * 29) % 70) + '%';
    d.style.background = `radial-gradient(circle, ${colours[i % colours.length]}, transparent 70%)`;
    d.style.animationDelay = (i * 0.7) + 's, ' + (i * 0.4) + 's';
    host.appendChild(d);
  }
}

function buildSkyline() {
  const host = document.getElementById('skyline');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'building';
    const h = 30 + ((i * 37) % 70);
    const w = 100 / n;
    b.style.width = `calc(${w}% + 2px)`;
    b.style.height = h + '%';
    const winColours = ['#ffcf7a', '#ffe4a3', '#a3e8ff'];
    const winCount = 3 + (i % 4);
    for (let w2 = 0; w2 < winCount; w2++) {
      const win = document.createElement('div');
      win.className = 'window';
      win.style.left = (10 + (w2 * 23) % 80) + '%';
      win.style.top = (10 + (w2 * 31) % 75) + '%';
      const c = winColours[(i + w2) % winColours.length];
      win.style.background = c;
      win.style.boxShadow = `0 0 4px ${c}`;
      win.style.animationDelay = ((i + w2) * 0.5) + 's';
      b.appendChild(win);
    }
    host.appendChild(b);
  }
}

function applyStageTheme(stageIdx, announce) {
  const theme = STAGES[stageIdx % STAGES.length];
  bodyEl.style.setProperty('--sky-top', theme.sky[0]);
  bodyEl.style.setProperty('--sky-mid', theme.sky[1]);
  bodyEl.style.setProperty('--sky-bottom', theme.sky[2]);
  bodyEl.style.setProperty('--accent', theme.accent);
  bodyEl.style.setProperty('--rain-opacity', theme.rainOpacity);
  bodyEl.style.setProperty('--rain-speed', theme.rainSpeed);
  bodyEl.setAttribute('data-stage', String(stageIdx));
  stageValueEl.textContent = `${stageIdx} · ${theme.name}`;

  if (announce) {
    stageBannerNumEl.textContent = String(stageIdx);
    stageBannerNameEl.textContent = theme.name;
    stageFlashEl.classList.remove('hit');
    // force reflow to restart animation
    void stageFlashEl.offsetWidth;
    stageFlashEl.classList.add('hit');
    stageBannerEl.classList.add('show');
    setTimeout(() => stageBannerEl.classList.remove('show'), 2400);
  }
}

// ================= gem visuals =================

function typeColourAccent(t) {
  return ['#ff2d63', '#1fb6ff', '#ffab2e', '#17d97a', '#c93bff', '#e8f7ff'][t];
}

function createGemEl(type) {
  const slot = document.createElement('div');
  slot.className = 'gem-slot';
  const gem = document.createElement('div');
  gem.className = `gem ${SHAPE_CLASS[type]} type-${type}`;
  gem.style.setProperty('--delay', (rng() * 3).toFixed(2) + 's');
  const body = document.createElement('div'); body.className = 'gem-body';
  const facet = document.createElement('div'); facet.className = 'gem-facet';
  const hi = document.createElement('div'); hi.className = 'gem-hi';
  const sh = document.createElement('div'); sh.className = 'gem-sh';
  const glint = document.createElement('div'); glint.className = 'gem-glint';
  glint.style.setProperty('--gdelay', (rng() * 3).toFixed(2) + 's');
  gem.append(body, facet, hi, sh, glint);
  slot.appendChild(gem);
  slot.dataset.type = String(type);
  return slot;
}

function measure() {
  const rect = boardEl.getBoundingClientRect();
  metrics.cellSize = rect.width / COLS;
}

function positionSlot(slot, r, c) {
  const cs = metrics.cellSize;
  slot.style.left = (c * cs) + 'px';
  slot.style.top = (r * cs) + 'px';
  slot.style.width = cs + 'px';
  slot.style.height = cs + 'px';
}

// ================= board build & full render =================

function buildInteractiveGrid() {
  cellGridEl.innerHTML = '';
  cellEls = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.testid = 'cell';
      cell.setAttribute('data-testid', 'cell');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      attachDrag(cell, r, c);
      cellGridEl.appendChild(cell);
      row.push(cell);
    }
    cellEls.push(row);
  }
}

function renderFullBoard(board) {
  gemsLayerEl.innerHTML = '';
  gemEls = [];
  measure();
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const slot = createGemEl(board[r][c]);
      positionSlot(slot, r, c);
      gemsLayerEl.appendChild(slot);
      row.push(slot);
    }
    gemEls.push(row);
  }
  applyFeaturedHighlighting();
}

function applyFeaturedHighlighting() {
  const featured = featuredType();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const slot = gemEls[r][c];
      if (!slot) continue;
      const t = Number(slot.dataset.type);
      slot.classList.toggle('featured', featured !== null && t === featured);
    }
  }
  featValueEl.innerHTML = featured === null ? '—' :
    `<span class="feat-icon-wrap" style="display:inline-flex;align-items:center;gap:6px;">
       <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${typeColourAccent(featured)};box-shadow:0 0 8px ${typeColourAccent(featured)};"></span>
       +${FEATURED_BONUS_PER_GEM}/gem
     </span>`;
}

// ================= scoring helpers =================

function countType(board, type) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === type) n++;
  return n;
}

function currentGemValue(type, board, stage) {
  switch (type) {
    case 0: return Math.min(640, 5 * (2 ** state.matchCounts[0]));
    case 1: return 60;
    case 2: return 20 + 8 * state.matchCounts[2];
    case 3: {
      const cnt = countType(board, 3);
      const v = cnt > 0 ? Math.round(400 / cnt) : 400;
      return Math.max(20, Math.min(400, v));
    }
    case 4: return 15;
    case 5: return 10 * (1 + stage);
    default: return 0;
  }
}

function gemValuesNow() {
  const stage = G.stageForScore(state.score);
  const board = state.board || [];
  return [0, 1, 2, 3, 4, 5].map((t) => currentGemValue(t, board, stage));
}

function featuredType() {
  const stage = G.stageForScore(state.score);
  return stage % TYPES;
}

// ================= HUD =================

function updateHud() {
  scoreValueEl.textContent = Math.round(state.score).toLocaleString();
  bestValueEl.textContent = Math.round(state.bestScore).toLocaleString();
  multValueEl.textContent = '×' + state.multiplier;
  applyFeaturedHighlighting();
}

function persistBest() {
  localStorage.setItem(BEST_KEY, String(state.bestScore));
}

function maybeAnnounceStage() {
  const stage = G.stageForScore(state.score);
  const announce = stage !== state.lastStageShown;
  applyStageTheme(stage, announce && state.lastStageShown !== -1);
  state.lastStageShown = stage;
}

// ================= floating popup =================

function showScorePopup(gain, multiplier, bonus) {
  const pop = document.createElement('div');
  pop.className = 'score-pop';
  pop.innerHTML = `
    <span class="gain">+${Math.round(gain).toLocaleString()}</span>
    <span class="mult">×${multiplier}</span>
    ${bonus > 0 ? `<span class="bonus">+${bonus} OFF-HINT BONUS</span>` : ''}
  `;
  popupLayerEl.appendChild(pop);
  setTimeout(() => pop.remove(), 1750);
}

// ================= animation utils =================

function frame() { return new Promise((res) => requestAnimationFrame(res)); }
function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

// ================= move pipeline =================

function pairKey(a, b) {
  const k1 = `${a.r},${a.c}`, k2 = `${b.r},${b.c}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

async function attemptMove(a, b) {
  if (state.animating || state.gameOver) return;
  if (a.r < 0 || a.r >= ROWS || a.c < 0 || a.c >= COLS) return;
  if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return;

  const myGen = state.gen;
  const hintWasShowing = state.hint;
  clearHint();
  restartIdleTimer();

  const valid = G.isValidSwap(state.board, a, b);
  const slotA = gemEls[a.r][a.c];
  const slotB = gemEls[b.r][b.c];

  state.animating = true;

  if (!valid) {
    await animateSwapVisual(slotA, b, slotB, a, 150);
    if (state.gen !== myGen) return;
    await animateSwapVisual(slotA, a, slotB, b, 150);
    // visual-only swap-and-back; logical grid/positions unchanged
    if (state.gen === myGen) state.animating = false;
    return;
  }

  const deviates = hintWasShowing != null &&
    pairKey(a, b) !== pairKey(hintWasShowing.a, hintWasShowing.b);

  await animateSwapVisual(slotA, b, slotB, a, 170);
  if (state.gen !== myGen) return;
  // commit logical swap of DOM registry
  gemEls[a.r][a.c] = slotB;
  gemEls[b.r][b.c] = slotA;
  slotA.dataset.row = String(b.r); slotA.dataset.col = String(b.c);
  slotB.dataset.row = String(a.r); slotB.dataset.col = String(a.c);

  const swappedBoard = G.applySwap(state.board, a, b);
  const { board: settled, steps } = G.collapse(swappedBoard, rng, TYPES);

  const stageAtStart = G.stageForScore(state.score);
  const featured = stageAtStart % TYPES;

  const incoming = [swappedBoard];
  for (let i = 0; i < steps.length - 1; i++) incoming.push(steps[i].board);

  let waveTotal = 0;
  let maxRun = 0;
  let featuredCount = 0;

  for (let i = 0; i < steps.length; i++) {
    const boardIn = incoming[i];
    const matches = steps[i].matches;
    maxRun = Math.max(maxRun, G.longestRun(boardIn));
    let raw = 0;
    const typesInWave = new Set();
    for (const { r, c } of matches) {
      const t = boardIn[r][c];
      typesInWave.add(t);
      raw += currentGemValue(t, boardIn, stageAtStart);
      if (t === featured) featuredCount++;
    }
    const factor = i === 0 ? 1 : 2;
    waveTotal += raw * factor;
    for (const t of typesInWave) {
      if (t === 0 || t === 2) state.matchCounts[t] += 1;
    }

    // animate this wave: clear then drop
    await animateWave(boardIn, matches, steps[i].board, myGen);
    if (state.gen !== myGen) return;
  }

  const newMultiplier = G.matchMultiplier(state.multiplier, maxRun || 3);
  const stageBonus = featuredCount * FEATURED_BONUS_PER_GEM;
  const deviationBonus = deviates ? DEVIATION_BONUS : 0;
  const gain = Math.round(waveTotal * newMultiplier) + stageBonus + deviationBonus;

  state.multiplier = newMultiplier;
  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = deviationBonus;
  state.board = settled;

  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    persistBest();
  }

  showScorePopup(gain, newMultiplier, deviationBonus);
  maybeAnnounceStage();
  updateHud();

  if (!G.hasValidMove(settled)) {
    enterGameOver();
  } else {
    restartIdleTimer();
  }

  state.animating = false;
}

function animateSwapVisual(slotA, targetPosA, slotB, targetPosB, duration) {
  measure();
  const cs = metrics.cellSize;
  const aRect = { x: Number(slotA.style.left.replace('px', '')), y: Number(slotA.style.top.replace('px', '')) };
  const bRect = { x: Number(slotB.style.left.replace('px', '')), y: Number(slotB.style.top.replace('px', '')) };
  const aTarget = { x: targetPosA.c * cs, y: targetPosA.r * cs };
  const bTarget = { x: targetPosB.c * cs, y: targetPosB.r * cs };
  const items = [
    { el: slotA, baseX: aRect.x, baseY: aRect.y, fromX: aRect.x, fromY: aRect.y, toX: aTarget.x, toY: aTarget.y },
    { el: slotB, baseX: bRect.x, baseY: bRect.y, fromX: bRect.x, fromY: bRect.y, toX: bTarget.x, toY: bTarget.y },
  ];
  return animateGroupLinear(items, duration).then(() => {
    slotA.style.left = aTarget.x + 'px'; slotA.style.top = aTarget.y + 'px';
    slotB.style.left = bTarget.x + 'px'; slotB.style.top = bTarget.y + 'px';
  });
}

function animateGroupLinear(items, duration) {
  return new Promise((resolve) => {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      for (const it of items) {
        const x = it.fromX + (it.toX - it.fromX) * t;
        const y = it.fromY + (it.toY - it.fromY) * t;
        it.el.style.transform = `translate(${x - it.baseX}px, ${y - it.baseY}px)`;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        for (const it of items) it.el.style.transform = '';
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

async function animateWave(incomingBoard, matches, nextBoard, myGen) {
  measure();
  const cs = metrics.cellSize;

  // 1) show matched gems throbbing briefly
  const matchedSlots = matches.map(({ r, c }) => gemEls[r][c]).filter(Boolean);
  for (const slot of matchedSlots) {
    const g = slot.querySelector('.gem');
    if (g) g.classList.add('matched');
  }
  await wait(220);
  if (state.gen !== myGen) return;
  // fade out
  for (const slot of matchedSlots) {
    const g = slot.querySelector('.gem');
    if (g) { g.classList.remove('matched'); g.classList.add('clearing'); g.style.opacity = '0'; g.style.transform = 'scale(0.4)'; }
  }
  await wait(130);
  if (state.gen !== myGen) return;
  for (const slot of matchedSlots) slot.remove();
  const clearedSet = new Set(matches.map((m) => `${m.r},${m.c}`));
  for (const { r, c } of matches) gemEls[r][c] = null;

  // 2) gravity mapping per column
  const dropItems = [];
  const newGemEls = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (!clearedSet.has(`${r},${c}`)) survivors.push({ r, el: gemEls[r][c] });
    }
    const missing = ROWS - survivors.length;
    // survivors land at the bottom rows, preserving order
    for (let i = 0; i < survivors.length; i++) {
      const newRow = missing + i;
      const slot = survivors[i].el;
      newGemEls[newRow][c] = slot;
      const fromY = survivors[i].r * cs;
      const toY = newRow * cs;
      if (fromY !== toY) {
        dropItems.push({ el: slot, col: c, fromRow: survivors[i].r, toRow: newRow, fromY, toY, isRefill: false });
      } else {
        // stays put; still register so index bookkeeping is right
      }
    }
    // refills fill rows 0..missing-1 using nextBoard's values, falling from above
    for (let i = 0; i < missing; i++) {
      const newRow = i;
      const type = nextBoard[newRow][c];
      const slot = createGemEl(type);
      slot.style.width = cs + 'px';
      slot.style.height = cs + 'px';
      slot.style.left = (c * cs) + 'px';
      const fromY = -(missing - i) * cs;
      const toY = newRow * cs;
      slot.style.top = toY + 'px';
      slot.style.transform = `translateY(${fromY - toY}px)`;
      gemsLayerEl.appendChild(slot);
      newGemEls[newRow][c] = slot;
      dropItems.push({ el: slot, col: c, fromRow: -(missing - i), toRow: newRow, fromY, toY, isRefill: true });
    }
  }

  gemEls = newGemEls;

  if (dropItems.length === 0) return;

  const maxFall = Math.max(...dropItems.map((d) => d.toRow - d.fromRow));
  const duration = Math.max(220, Math.min(680, 210 + maxFall * 55));

  await new Promise((resolve) => {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const e = t * t; // accelerating (ease-in) — slow start, fast landing
      for (const it of dropItems) {
        const y = it.fromY + (it.toY - it.fromY) * e;
        it.el.style.top = it.toY + 'px';
        it.el.style.transform = `translateY(${y - it.toY}px)`;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        for (const it of dropItems) it.el.style.transform = '';
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// ================= game over / new game =================

function enterGameOver() {
  state.gameOver = true;
  gameOverEl.classList.add('show');
  newGameBtn.classList.add('emphasize');
  clearHint();
  stopIdleTimer();
}

function startNewGame() {
  state.gen++; // invalidate any in-flight move animation/scoring
  state.animating = false;
  clearHint();
  stopIdleTimer();
  state.board = G.createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.multiplier = 1;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.gameOver = false;
  state.matchCounts = [0, 0, 0, 0, 0, 0];
  state.lastStageShown = -1;
  gameOverEl.classList.remove('show');
  newGameBtn.classList.remove('emphasize');
  renderFullBoard(state.board);
  maybeAnnounceStage();
  updateHud();
  restartIdleTimer();
}

newGameBtn.addEventListener('click', startNewGame);

// ================= idle hint =================

function findAnyValidMove(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && G.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && G.isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

function restartIdleTimer() {
  stopIdleTimer();
  idleTimer = setTimeout(() => {
    if (state.animating || state.gameOver) return;
    const mv = findAnyValidMove(state.board);
    if (!mv) return;
    showHint(mv);
  }, IDLE_MS);
}

function stopIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function showHint(pair) {
  state.hint = pair;
  const cellA = cellEls[pair.a.r][pair.a.c];
  const cellB = cellEls[pair.b.r][pair.b.c];
  cellA.classList.add('hint-cell');
  cellB.classList.add('hint-cell');
}

function clearHint() {
  if (state.hint) {
    const { a, b } = state.hint;
    cellEls[a.r][a.c].classList.remove('hint-cell');
    cellEls[b.r][b.c].classList.remove('hint-cell');
  }
  state.hint = null;
}

// ================= drag / slide interaction =================

function attachDrag(cell, r, c) {
  let dragging = false;
  let startX = 0, startY = 0, pointerId = null;
  let originSlot = null;

  cell.addEventListener('pointerdown', (e) => {
    if (state.animating || state.gameOver) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    try {
      cell.setPointerCapture(pointerId);
    } catch (err) {
      // Some browsers can reject capture in edge cases; the pointerup
      // listener below still works for the common case.
    }
    originSlot = gemEls[r][c];
    e.preventDefault();
  });

  cell.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    if (!originSlot) return;
    measure();
    const cs = metrics.cellSize;
    let dx = e.clientX - startX;
    let dy = e.clientY - startY;
    const maxOff = cs * 0.7;
    dx = Math.max(-maxOff, Math.min(maxOff, dx));
    dy = Math.max(-maxOff, Math.min(maxOff, dy));
    originSlot.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  function endDrag(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { cell.releasePointerCapture(pointerId); } catch (err) { /* noop */ }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    measure();
    const cs = metrics.cellSize;
    const threshold = cs * 0.3;
    const slot = originSlot;
    originSlot = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) {
      if (slot) slot.style.transform = '';
      return;
    }

    let dr = 0, dc = 0;
    if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
    else dr = dy > 0 ? 1 : -1;

    const target = { r: r + dr, c: c + dc };
    if (slot) slot.style.transform = '';

    if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
      return;
    }
    attemptMove({ r, c }, target);
  }

  cell.addEventListener('pointerup', endDrag);
  cell.addEventListener('pointercancel', endDrag);
}

// ================= convenience slide() hook =================

function dirToDelta(dir) {
  if (typeof dir === 'object' && dir) return dir;
  switch (dir) {
    case 'up': return { dr: -1, dc: 0 };
    case 'down': return { dr: 1, dc: 0 };
    case 'left': return { dr: 0, dc: -1 };
    case 'right': return { dr: 0, dc: 1 };
    default: return { dr: 0, dc: 0 };
  }
}

async function slide(r, c, dir) {
  const { dr, dc } = dirToDelta(dir);
  const target = { r: r + dr, c: c + dc };
  await attemptMove({ r, c }, target);
  while (state.animating) await frame();
}

// ================= window.__test hooks =================

window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => gemValuesNow(),
  stage: () => G.stageForScore(state.score),
  featuredType: () => featuredType(),
  bestScore: () => state.bestScore,
  validMove: () => findAnyValidMove(state.board),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null,
  slide,
};

// ================= boot =================

function boot() {
  buildBokeh();
  buildSkyline();
  buildInteractiveGrid();
  state.board = G.createBoard(ROWS, COLS, TYPES, rng);
  renderFullBoard(state.board);
  maybeAnnounceStage();
  updateHud();
  restartIdleTimer();

  window.addEventListener('resize', () => {
    measure();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const slot = gemEls[r][c];
        if (slot) positionSlot(slot, r, c);
      }
    }
  });
}

boot();
