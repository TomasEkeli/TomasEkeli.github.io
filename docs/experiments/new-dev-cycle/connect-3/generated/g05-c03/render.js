import * as game from './game.js';

// ---- Config ---------------------------------------------------------------

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const HINT_DELAY_MS = 10000;
const DEVIATION_BONUS = 100;
const DRAG_THRESHOLD_PX = 16;
const SWAP_MS = 160;
const FALL_EASE = 'cubic-bezier(0.55, 0.055, 0.675, 0.19)'; // ease-in-cubic: slow then fast

const SHAPES = ['circle', 'diamond', 'hex', 'star', 'triangle', 'pentagon'];
const SHAPE_POINTS = {
  diamond: '50,4 92,50 50,96 8,50',
  hex: '50,4 90,27 90,73 50,96 10,73 10,27',
  star: '50,3 61,36 96,36 68,57 79,92 50,71 21,92 32,57 4,36 39,36',
  triangle: '50,8 92,88 8,88',
  pentagon: '50,4 92,38 76,92 24,92 8,38',
};
const GEM_COLORS = [
  { base: '#7fd4ff', deep: '#1c5f96', name: 'sapphire' },
  { base: '#cf9bff', deep: '#5f329e', name: 'amethyst' },
  { base: '#72f0b6', deep: '#12885f', name: 'emerald' },
  { base: '#ff8a97', deep: '#a8283f', name: 'ruby' },
  { base: '#ffd873', deep: '#b8790f', name: 'citrine' },
  { base: '#f5f7ff', deep: '#8d9ac2', name: 'moonstone' },
];

// ---- State ------------------------------------------------------------

let rng = Math.random;
let board = null;
let score = 0;
let lastGain = 0;
let lastBonus = 0;
let gameOver = false;
let hint = null; // { a, b } | null
let animating = false;
let idleTimer = null;
let cellPx = 60;
let cellsEls = null; // [r][c] -> DOM element (the .gem-cell wrapper) or null
let gemUid = 0;

// ---- DOM refs -----------------------------------------------------------

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const gainLayer = document.getElementById('gain-layer');
const overlayEl = document.getElementById('gameover-overlay');
const newGameBtn = document.getElementById('new-game');
const restartBtn = document.querySelector('[data-action="restart"]');
const starsLayer = document.getElementById('stars');

// ---- Starfield backdrop (purely decorative) ------------------------------

function buildStarfield() {
  const n = 90;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.4 + 0.6;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.setProperty('--tw-min', (0.08 + Math.random() * 0.2).toFixed(2));
    s.style.setProperty('--tw-max', (0.55 + Math.random() * 0.4).toFixed(2));
    s.style.animationDuration = (2 + Math.random() * 4.5).toFixed(2) + 's';
    s.style.animationDelay = (-Math.random() * 6).toFixed(2) + 's';
    starsLayer.appendChild(s);
  }
}

// ---- Helpers --------------------------------------------------------------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePair(p, q) {
  const key = ({ r, c }) => r + ',' + c;
  const s1 = [key(p.a), key(p.b)].sort().join('|');
  const s2 = [key(q.a), key(q.b)].sort().join('|');
  return s1 === s2;
}

function findAnyValidMove(b) {
  const rows = b.length;
  const cols = b[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && game.isValidSwap(b, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < rows && game.isValidSwap(b, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

function neighborFor(r, c, dir) {
  let nr = r, nc = c;
  if (dir === 'up') nr -= 1;
  else if (dir === 'down') nr += 1;
  else if (dir === 'left') nc -= 1;
  else if (dir === 'right') nc += 1;
  else return null;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return null;
  return { r: nr, c: nc };
}

// ---- Gem visuals ------------------------------------------------------

function gemSvgMarkup(shape, uid) {
  const gradId = 'grad-' + uid;
  const clipId = 'clip-' + uid;
  const pts = SHAPE_POINTS[shape];
  const shapeTag = shape === 'circle'
    ? `<circle cx="50" cy="50" r="42" fill="url(#${gradId})" stroke="rgba(255,255,255,.6)" stroke-width="2.5"/>`
    : `<polygon points="${pts}" fill="url(#${gradId})" stroke="rgba(255,255,255,.6)" stroke-width="2.5" stroke-linejoin="round"/>`;
  const clipShape = shape === 'circle'
    ? `<circle cx="50" cy="50" r="42"/>`
    : `<polygon points="${pts}"/>`;
  return `<svg viewBox="0 0 100 100" class="gem-svg">
    <defs>
      <radialGradient id="${gradId}" cx="34%" cy="28%" r="80%">
        <stop offset="0%" stop-color="var(--gem-base)"/>
        <stop offset="65%" stop-color="var(--gem-base)"/>
        <stop offset="100%" stop-color="var(--gem-deep)"/>
      </radialGradient>
      <clipPath id="${clipId}">${clipShape}</clipPath>
    </defs>
    ${shapeTag}
    <g clip-path="url(#${clipId})">
      <ellipse cx="33" cy="26" rx="20" ry="11" fill="white" opacity="0.6"/>
      <ellipse cx="68" cy="78" rx="24" ry="13" fill="black" opacity="0.25"/>
      <polygon points="50,4 58,50 50,96 42,50" fill="white" opacity="0.08"/>
    </g>
  </svg>`;
}

function buildGemVisual(type) {
  const shape = SHAPES[type % SHAPES.length];
  const colors = GEM_COLORS[type % GEM_COLORS.length];
  const holder = document.createElement('div');
  holder.className = 'gem';
  holder.dataset.type = String(type);
  holder.style.setProperty('--gem-base', colors.base);
  holder.style.setProperty('--gem-deep', colors.deep);
  holder.style.setProperty('--dur', (2.6 + Math.random() * 1.8).toFixed(2) + 's');
  holder.style.setProperty('--delay', (-Math.random() * 3).toFixed(2) + 's');
  holder.innerHTML = gemSvgMarkup(shape, gemUid++);
  return holder;
}

function positionEl(el, r, c) {
  el.style.width = cellPx + 'px';
  el.style.height = cellPx + 'px';
  el.style.transform = `translate(${c * cellPx}px, ${r * cellPx}px)`;
}

function createGemEl(type, r, c) {
  const wrap = document.createElement('div');
  wrap.className = 'gem-cell';
  wrap.dataset.testid = 'cell';
  wrap.dataset.r = String(r);
  wrap.dataset.c = String(c);
  wrap.style.transition = 'none';
  positionEl(wrap, r, c);
  wrap.appendChild(buildGemVisual(type));
  attachDrag(wrap);
  return wrap;
}

function spawnGemEl(type, r, c, startRow) {
  const wrap = document.createElement('div');
  wrap.className = 'gem-cell';
  wrap.dataset.testid = 'cell';
  wrap.dataset.r = String(r);
  wrap.dataset.c = String(c);
  wrap.style.transition = 'none';
  positionEl(wrap, startRow, c);
  wrap.appendChild(buildGemVisual(type));
  attachDrag(wrap);
  boardEl.appendChild(wrap);
  return wrap;
}

function moveGemTo(el, r, c, duration, easing) {
  return new Promise((resolve) => {
    if (duration <= 0) {
      el.style.transition = 'none';
      el.style.transform = `translate(${c * cellPx}px, ${r * cellPx}px)`;
      resolve();
      return;
    }
    el.style.transition = `transform ${duration}ms ${easing || 'ease'}`;
    requestAnimationFrame(() => {
      el.style.transform = `translate(${c * cellPx}px, ${r * cellPx}px)`;
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (ev) => {
      if (ev.propertyName === 'transform') finish();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, duration + 80);
  });
}

// ---- Board rendering --------------------------------------------------

function computeCellPx() {
  const rect = boardEl.getBoundingClientRect();
  cellPx = rect.width / COLS;
}

function buildSlots() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.width = cellPx + 'px';
      slot.style.height = cellPx + 'px';
      slot.style.transform = `translate(${c * cellPx}px, ${r * cellPx}px)`;
      boardEl.appendChild(slot);
    }
  }
}

function buildBoardDom() {
  boardEl.innerHTML = '';
  computeCellPx();
  buildSlots();
  cellsEls = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = createGemEl(board[r][c], r, c);
      boardEl.appendChild(el);
      cellsEls[r][c] = el;
    }
  }
}

function repositionAll() {
  computeCellPx();
  const slots = boardEl.querySelectorAll('.slot');
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++, i++) {
      const slot = slots[i];
      if (slot) {
        slot.style.width = cellPx + 'px';
        slot.style.height = cellPx + 'px';
        slot.style.transform = `translate(${c * cellPx}px, ${r * cellPx}px)`;
      }
      const el = cellsEls[r][c];
      if (el) {
        el.style.transition = 'none';
        positionEl(el, r, c);
      }
    }
  }
}

// ---- Drag / slide gesture -----------------------------------------------

function attachDrag(wrap) {
  let drag = null;

  wrap.addEventListener('pointerdown', (e) => {
    if (animating || gameOver) return;
    drag = {
      r: Number(wrap.dataset.r),
      c: Number(wrap.dataset.c),
      startX: e.clientX,
      startY: e.clientY,
      fired: false,
      pointerId: e.pointerId,
    };
    try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!drag || drag.fired) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD_PX) return;
    drag.fired = true;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const target = neighborFor(drag.r, drag.c, dir);
    if (target) performMove({ r: drag.r, c: drag.c }, target);
  });

  const endDrag = (e) => {
    if (drag) {
      try { wrap.releasePointerCapture(drag.pointerId); } catch (_) { /* ignore */ }
    }
    drag = null;
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
}

// ---- Move / animation pipeline -------------------------------------------

async function clearWave(matches) {
  const els = [];
  for (const { r, c } of matches) {
    const wrap = cellsEls[r][c];
    if (wrap) {
      const gem = wrap.querySelector('.gem');
      if (gem) gem.classList.add('clearing');
      els.push({ r, c });
    }
  }
  await wait(230);
  for (const { r, c } of els) {
    const wrap = cellsEls[r][c];
    if (wrap) {
      wrap.remove();
      cellsEls[r][c] = null;
    }
  }
}

async function dropWave(nextBoard) {
  const animPromises = [];
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (cellsEls[r][c]) survivors.push({ el: cellsEls[r][c], fromRow: r });
    }
    for (let r = 0; r < ROWS; r++) cellsEls[r][c] = null;

    const gap = ROWS - survivors.length;

    survivors.forEach((s, i) => {
      const targetRow = gap + i;
      cellsEls[targetRow][c] = s.el;
      s.el.dataset.r = String(targetRow);
      s.el.dataset.c = String(c);
      const distance = targetRow - s.fromRow;
      if (distance > 0) {
        const duration = Math.min(650, 150 + distance * 90);
        animPromises.push(moveGemTo(s.el, targetRow, c, duration, FALL_EASE));
      }
    });

    for (let r = 0; r < gap; r++) {
      const type = nextBoard[r][c];
      const startRow = r - gap;
      const el = spawnGemEl(type, r, c, startRow);
      cellsEls[r][c] = el;
      void el.offsetWidth; // force reflow before animating
      const distance = r - startRow;
      const duration = Math.min(650, 180 + distance * 90);
      animPromises.push(moveGemTo(el, r, c, duration, FALL_EASE));
    }
  }
  await Promise.all(animPromises);
}

async function animateSteps(steps) {
  for (const step of steps) {
    await clearWave(step.matches);
    await dropWave(step.board);
  }
}

function showGainPopup(gain, bonus) {
  const pop = document.createElement('div');
  pop.className = 'gain-pop';
  pop.style.left = '50%';
  pop.style.transform = 'translateX(-50%)';
  pop.textContent = '+' + gain;
  if (bonus > 0) {
    const tag = document.createElement('span');
    tag.className = 'bonus-tag';
    tag.textContent = 'off-hint bonus +' + bonus;
    pop.appendChild(tag);
  }
  gainLayer.appendChild(pop);
  setTimeout(() => pop.remove(), 1550);
}

function updateHud() {
  scoreEl.textContent = score.toLocaleString();
}

function clearHintVisual() {
  const els = boardEl.querySelectorAll('.gem-cell.hinted');
  els.forEach((el) => el.classList.remove('hinted'));
}

function showHintVisual(mv) {
  const a = cellsEls[mv.a.r][mv.a.c];
  const b = cellsEls[mv.b.r][mv.b.c];
  if (a) a.classList.add('hinted');
  if (b) b.classList.add('hinted');
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdle() {
  clearIdleTimer();
  if (gameOver) return;
  idleTimer = setTimeout(() => {
    if (animating || gameOver) return;
    const mv = findAnyValidMove(board);
    if (mv) {
      hint = mv;
      showHintVisual(mv);
    }
  }, HINT_DELAY_MS);
}

function showGameOver() {
  overlayEl.hidden = false;
}

async function performMove(a, b) {
  if (animating || gameOver) return false;
  animating = true;

  const valid = game.isValidSwap(board, a, b);
  const elA = cellsEls[a.r][a.c];
  const elB = cellsEls[b.r][b.c];

  await Promise.all([
    moveGemTo(elA, b.r, b.c, SWAP_MS, 'ease-out'),
    moveGemTo(elB, a.r, a.c, SWAP_MS, 'ease-out'),
  ]);

  if (!valid) {
    await Promise.all([
      moveGemTo(elA, a.r, a.c, SWAP_MS, 'ease-out'),
      moveGemTo(elB, b.r, b.c, SWAP_MS, 'ease-out'),
    ]);
    animating = false;
    return false;
  }

  // Commit the swap in the DOM map.
  cellsEls[a.r][a.c] = elB;
  elB.dataset.r = String(a.r);
  elB.dataset.c = String(a.c);
  cellsEls[b.r][b.c] = elA;
  elA.dataset.r = String(b.r);
  elA.dataset.c = String(b.c);

  clearIdleTimer();
  const hadHint = hint;
  hint = null;
  clearHintVisual();

  board = game.applySwap(board, a, b);
  const { board: settled, steps } = game.collapse(board, rng, TYPES);
  await animateSteps(steps);
  board = settled;

  const gain = game.scoreCascade(steps.map((s) => s.matches));
  let bonus = 0;
  if (hadHint && !samePair(hadHint, { a, b })) bonus = DEVIATION_BONUS;
  lastBonus = bonus;
  lastGain = gain + bonus;
  score += lastGain;
  updateHud();
  showGainPopup(lastGain, bonus);

  if (!game.hasValidMove(board)) {
    gameOver = true;
    showGameOver();
  } else {
    scheduleIdle();
  }

  animating = false;
  return true;
}

// ---- Lifecycle ------------------------------------------------------------

function initGame() {
  clearIdleTimer();
  board = game.createBoard(ROWS, COLS, TYPES, rng);
  score = 0;
  lastGain = 0;
  lastBonus = 0;
  gameOver = false;
  hint = null;
  animating = false;
  overlayEl.hidden = true;
  buildBoardDom();
  updateHud();
  scheduleIdle();
}

newGameBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', initGame);
window.addEventListener('resize', () => {
  if (!animating) repositionAll();
});

buildStarfield();
initGame();

// ---- Test hooks (observation only) -----------------------------------

window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  validMove: () => {
    const mv = findAnyValidMove(board);
    return mv ? { a: mv.a, b: mv.b } : null;
  },
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => (hint ? { a: hint.a, b: hint.b } : null),
  slide: (r, c, dir) => {
    const target = neighborFor(r, c, dir);
    if (!target) return Promise.resolve(false);
    return performMove({ r, c }, target);
  },
};
