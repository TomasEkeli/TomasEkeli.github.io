import * as game from './game.js';

// ---------------------------------------------------------------- constants

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const IDLE_MS = 10000;
const DEVIATION_BONUS = 100;
const SWAP_MS = 150;
const CLEAR_MS = 220;
const DROP_MS_BASE = 160;
const DROP_MS_PER_ROW = 90;

const SHAPES = ['circle', 'diamond', 'hex', 'triangle', 'star', 'cross'];
const NAMES = ['Moonpearl', 'Sapphire', 'Emerald', 'Amberglow', 'Coral Spark', 'Abyssal Violet'];

// ------------------------------------------------------------------- state

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const state = {
  board: null,
  cells: null, // rows x cols of { el, r, c, type } | null
  score: 0,
  lastGain: 0,
  lastBonus: 0,
  gameOver: false,
  hint: null, // { a, b } | null
  animating: false,
  drag: null,
  idleTimer: null,
  rng: mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0),
  cellSize: 0,
};

// ------------------------------------------------------------------- DOM

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score-value');
const overlayEl = document.getElementById('game-over');
const newGameBtn = document.getElementById('new-game');
const floatLayer = document.getElementById('float-layer');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePair(p1, p2) {
  if (!p1 || !p2) return false;
  const k = (x) => `${x.r},${x.c}`;
  const s1 = new Set([k(p1.a), k(p1.b)]);
  return s1.has(k(p2.a)) && s1.has(k(p2.b));
}

function cellPos({ r, c }) {
  return { x: c * state.cellSize, y: r * state.cellSize };
}

function findAnyValidMove(board) {
  const rows = board.length, cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < rows && game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

// -------------------------------------------------------------- geometry

function computeCellSize() {
  const rect = boardEl.getBoundingClientRect();
  state.cellSize = rect.width / COLS;
}

window.addEventListener('resize', () => {
  computeCellSize();
  repositionAll();
});

function repositionAll() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gem = state.cells[r][c];
      if (!gem) continue;
      const { x, y } = cellPos({ r, c });
      gem.el.style.transitionDuration = '0ms';
      gem.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}

// -------------------------------------------------------------- gem DOM

function makeGemEl(type, r, c) {
  const el = document.createElement('div');
  el.className = 'gem';
  el.dataset.testid = 'cell';
  el.style.width = state.cellSize + 'px';
  el.style.height = state.cellSize + 'px';
  el.dataset.type = String(type);
  el.title = NAMES[type];

  const shape = document.createElement('div');
  shape.className = `gem-shape shape-${SHAPES[type]} c${type} idle-life`;
  shape.style.animationDelay = `${(r * COLS + c) % 13 * 0.23}s, ${(r * 3 + c * 7) % 11 * 0.31}s`;
  el.appendChild(shape);

  const { x, y } = cellPos({ r, c });
  el.style.transform = `translate(${x}px, ${y}px)`;

  attachDragHandlers(el);
  boardEl.appendChild(el);
  return el;
}

function attachDragHandlers(el) {
  el.addEventListener('pointerdown', onPointerDown);
}

function onPointerDown(e) {
  if (state.animating || state.gameOver) return;
  const el = e.currentTarget;
  const gem = findGemByEl(el);
  if (!gem) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  shapeEl(gem).classList.remove('idle-life');
  el.style.transitionDuration = '0ms';
  el.style.zIndex = '5';
  state.drag = {
    r: gem.r, c: gem.c, el,
    startX: e.clientX, startY: e.clientY,
    dx: 0, dy: 0, pointerId: e.pointerId,
  };
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  const drag = state.drag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.dx = e.clientX - drag.startX;
  drag.dy = e.clientY - drag.startY;
  const max = state.cellSize;
  let tx = 0, ty = 0;
  if (Math.abs(drag.dx) >= Math.abs(drag.dy)) {
    tx = Math.max(-max, Math.min(max, drag.dx));
  } else {
    ty = Math.max(-max, Math.min(max, drag.dy));
  }
  const base = cellPos({ r: drag.r, c: drag.c });
  drag.el.style.transform = `translate(${base.x + tx}px, ${base.y + ty}px)`;
}

function onPointerUp(e) {
  const drag = state.drag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.el.removeEventListener('pointermove', onPointerMove);
  drag.el.removeEventListener('pointerup', onPointerUp);
  drag.el.removeEventListener('pointercancel', onPointerUp);
  try { drag.el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  drag.el.style.zIndex = '';
  state.drag = null;

  const threshold = state.cellSize * 0.28;
  let dir = null;
  if (Math.abs(drag.dx) >= Math.abs(drag.dy)) {
    if (drag.dx > threshold) dir = 'right';
    else if (drag.dx < -threshold) dir = 'left';
  } else {
    if (drag.dy > threshold) dir = 'down';
    else if (drag.dy < -threshold) dir = 'up';
  }

  const a = { r: drag.r, c: drag.c };
  if (!dir) {
    snapTo(drag.el, a);
    return;
  }
  const b = neighborInDir(a, dir);
  if (!b) {
    snapTo(drag.el, a);
    return;
  }
  attemptMove(a, b);
}

function neighborInDir(a, dir) {
  const t = { r: a.r, c: a.c };
  if (dir === 'left') t.c -= 1;
  else if (dir === 'right') t.c += 1;
  else if (dir === 'up') t.r -= 1;
  else if (dir === 'down') t.r += 1;
  if (t.r < 0 || t.r >= ROWS || t.c < 0 || t.c >= COLS) return null;
  return t;
}

function snapTo(el, cell) {
  const { x, y } = cellPos(cell);
  animateTo(el, x, y, SWAP_MS, 'cubic-bezier(.34,1.56,.64,1)');
}

function shapeEl(gem) {
  return gem.el.querySelector('.gem-shape');
}

function findGemByEl(el) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const g = state.cells[r][c];
      if (g && g.el === el) return g;
    }
  }
  return null;
}

// ---------------------------------------------------------------- animate

function animateTo(el, x, y, duration, easing) {
  return new Promise((resolve) => {
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = duration + 'ms';
    el.style.transitionTimingFunction = easing;
    // eslint-disable-next-line no-void
    void el.offsetWidth; // force reflow so the transition applies
    requestAnimationFrame(() => {
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    setTimeout(resolve, duration + 20);
  });
}

async function attemptMove(a, b) {
  if (state.animating || state.gameOver) return;
  state.animating = true;
  hideHintVisual();

  const gemA = state.cells[a.r][a.c];
  const gemB = state.cells[b.r][b.c];
  const posA = cellPos(a);
  const posB = cellPos(b);

  await Promise.all([
    animateTo(gemA.el, posB.x, posB.y, SWAP_MS, 'ease-out'),
    animateTo(gemB.el, posA.x, posA.y, SWAP_MS, 'ease-out'),
  ]);

  const valid = game.isValidSwap(state.board, a, b);

  if (!valid) {
    shapeEl(gemA).classList.add('rejected');
    shapeEl(gemB).classList.add('rejected');
    await wait(130);
    await Promise.all([
      animateTo(gemA.el, posA.x, posA.y, SWAP_MS, 'cubic-bezier(.34,1.56,.64,1)'),
      animateTo(gemB.el, posB.x, posB.y, SWAP_MS, 'cubic-bezier(.34,1.56,.64,1)'),
    ]);
    shapeEl(gemA).classList.remove('rejected');
    shapeEl(gemB).classList.remove('rejected');
    state.animating = false;
    return;
  }

  // Commit the swap into the visual grid.
  state.cells[a.r][a.c] = gemB;
  state.cells[b.r][b.c] = gemA;
  gemA.r = b.r; gemA.c = b.c;
  gemB.r = a.r; gemB.c = a.c;

  const hintPair = state.hint;
  const deviated = !!hintPair && !samePair(hintPair, { a, b });
  state.hint = null;

  state.board = game.applySwap(state.board, a, b);
  const { board: settled, steps } = game.collapse(state.board, state.rng, TYPES);

  for (const step of steps) {
    await animateWave(step.matches, step.board);
  }

  state.board = settled;
  const gain = game.scoreCascade(steps.map((s) => s.matches));
  const bonus = deviated ? DEVIATION_BONUS : 0;
  state.lastBonus = bonus;
  state.lastGain = gain + bonus;
  state.score += state.lastGain;
  updateScoreUI();
  showFloatingScore(state.lastGain, bonus > 0);

  state.animating = false;

  if (!game.hasValidMove(state.board)) {
    setGameOver(true);
  } else {
    scheduleIdle();
  }
}

async function animateWave(matches, nextBoard) {
  // 1. Show the clear beat.
  const matchedGems = matches.map(({ r, c }) => state.cells[r][c]).filter(Boolean);
  for (const g of matchedGems) shapeEl(g).classList.add('clearing');
  await wait(CLEAR_MS);

  for (const g of matchedGems) {
    g.el.remove();
  }
  for (const { r, c } of matches) {
    state.cells[r][c] = null;
  }

  // 2. Gravity + refill, animated as an accelerating fall.
  const drops = [];
  let maxDistance = 0;

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      const g = state.cells[r][c];
      if (g) survivors.push(g);
    }
    const missing = ROWS - survivors.length;

    // Survivors settle at the bottom of the column, preserving order.
    survivors.forEach((g, i) => {
      const targetR = missing + i;
      const distance = targetR - g.r;
      if (distance > maxDistance) maxDistance = distance;
      drops.push({ gem: g, targetR, targetC: c, distance });
    });

    // New refills stack above the board and fall into the top slots.
    for (let i = 0; i < missing; i++) {
      const targetR = i;
      const type = nextBoard[targetR][c];
      const startR = -(missing - i);
      const el = makeGemEl(type, startR, c);
      const gem = { el, r: startR, c, type };
      const distance = targetR - startR;
      if (distance > maxDistance) maxDistance = distance;
      drops.push({ gem, targetR, targetC: c, distance });
    }
  }

  const fallPromises = drops.map(({ gem, targetR, targetC, distance }) => {
    const { x, y } = cellPos({ r: targetR, c: targetC });
    const duration = DROP_MS_BASE + Math.max(1, distance) * DROP_MS_PER_ROW;
    const p = animateTo(gem.el, x, y, duration, 'cubic-bezier(.55,.06,.68,.19)');
    gem.r = targetR;
    gem.c = targetC;
    return p;
  });

  for (const { gem, targetR, targetC } of drops) {
    state.cells[targetR][targetC] = gem;
  }

  await Promise.all(fallPromises);
}

// ------------------------------------------------------------------- UI

function updateScoreUI() {
  scoreEl.textContent = String(state.score);
}

function showFloatingScore(amount, bonus) {
  if (amount <= 0) return;
  const el = document.createElement('div');
  el.className = 'float-score';
  el.textContent = `+${amount}`;
  if (bonus) {
    const tag = document.createElement('span');
    tag.className = 'float-bonus';
    tag.textContent = 'deviation bonus!';
    el.appendChild(tag);
  }
  const left = 30 + Math.random() * 40;
  el.style.left = left + '%';
  floatLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function setGameOver(over) {
  state.gameOver = over;
  overlayEl.classList.toggle('visible', over);
  overlayEl.setAttribute('aria-hidden', over ? 'false' : 'true');
  newGameBtn.classList.toggle('urgent', over);
  if (over) {
    clearHintTimer();
    hideHintVisual();
  }
}

// ------------------------------------------------------------------ hint

function scheduleIdle() {
  clearHintTimer();
  state.idleTimer = setTimeout(onIdle, IDLE_MS);
}

function clearHintTimer() {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function onIdle() {
  if (state.animating || state.gameOver || state.drag) return;
  const move = findAnyValidMove(state.board);
  if (!move) return;
  state.hint = move;
  showHintVisual(move);
}

function showHintVisual(move) {
  hideHintVisual();
  for (const cell of [move.a, move.b]) {
    const g = state.cells[cell.r] && state.cells[cell.r][cell.c];
    if (g) shapeEl(g).classList.add('hinting');
  }
}

function hideHintVisual() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const g = state.cells[r][c];
      if (g) shapeEl(g).classList.remove('hinting');
    }
  }
}

// -------------------------------------------------------------- new game

function newGame() {
  clearHintTimer();
  state.hint = null;
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.animating = false;
  state.drag = null;

  boardEl.innerHTML = '';
  computeCellSize();

  state.board = game.createBoard(ROWS, COLS, TYPES, state.rng);
  state.cells = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const type = state.board[r][c];
      const el = makeGemEl(type, r, c);
      state.cells[r][c] = { el, r, c, type };
    }
  }

  updateScoreUI();
  setGameOver(false);
  scheduleIdle();
}

newGameBtn.addEventListener('click', newGame);

// ------------------------------------------------------------- bootstrap

computeCellSize();
newGame();

// --------------------------------------------------------------- __test

window.__test = {
  score() { return state.score; },
  lastGain() { return state.lastGain; },
  lastBonus() { return state.lastBonus; },
  validMove() { return findAnyValidMove(state.board); },
  board() { return state.board.map((row) => row.slice()); },
  gameOver() { return state.gameOver; },
  hint() { return state.hint ? { a: state.hint.a, b: state.hint.b } : null; },
  slide(r, c, dir) {
    return new Promise((resolve) => {
      const a = { r, c };
      const b = neighborInDir(a, dir);
      if (!b) { resolve(false); return; }
      const check = () => {
        if (!state.animating) {
          resolve(true);
        } else {
          setTimeout(check, 30);
        }
      };
      attemptMove(a, b);
      setTimeout(check, 30);
    });
  },
};
