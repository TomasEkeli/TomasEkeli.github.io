// render.js — free-form UI over the pure game.js logic.
import * as game from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const CELL = 64;
const DEVIATION_BONUS = 100;
const IDLE_MS = 10000;

const GEM_NAMES = ['Emerald', 'Ruby', 'Sapphire', 'Topaz', 'Amethyst', 'Citrine'];

// ---------------------------------------------------------------- rng ----
function makeRng() {
  return () => Math.random();
}
const rng = makeRng();

// ---------------------------------------------------------------- dom ----
const boardEl = document.getElementById('board');
const slotsEl = document.getElementById('slots');
const gemsLayerEl = document.getElementById('gems-layer');
const gainLayerEl = document.getElementById('gain-layer');
const scoreEl = document.getElementById('score-value');
const lastGainEl = document.getElementById('last-gain-value');
const newGameBtn = document.getElementById('new-game');
const overlayEl = document.getElementById('game-over-overlay');
const hintNoteEl = document.getElementById('hint-note');

boardEl.style.width = COLS * CELL + 'px';
boardEl.style.height = ROWS * CELL + 'px';

// ---------------------------------------------------------- game state ----
let logicalBoard = game.createBoard(ROWS, COLS, TYPES, rng);
let score = 0;
let lastGain = 0;
let lastBonus = 0;
let gameOver = false;
let animating = false;
let hint = null; // { a, b }
let idleTimer = null;
let dragState = null;
let nextGemId = 1;

/** entities[r][c] = { id, value, r, c, el } — the visual gem occupying that
 * logical position. Kept in sync with logicalBoard between moves. */
let entities = [];

function buildSlots() {
  slotsEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (((r + c) % 2) ? ' slot-alt' : '');
      slot.style.transform = `translate(${c * CELL}px, ${r * CELL}px)`;
      slotsEl.appendChild(slot);
    }
  }
}

// A gem is two nested elements: an outer "slot" that carries the board
// position (translated/transitioned by JS — swap, drop, drag) and an inner
// "body" that carries the shape/colour/idle animation (rotate, pulse, glint).
// Keeping them separate means the CSS idle keyframes (which animate
// `transform`) never fight with the JS-driven positional transform.
function makeGemEl(value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gem-slot';
  wrapper.setAttribute('data-testid', 'cell');
  wrapper.style.width = CELL + 'px';
  wrapper.style.height = CELL + 'px';

  const body = document.createElement('div');
  body.className = `gem gem-type-${value}`;
  body.setAttribute('data-gem', GEM_NAMES[value] || '');
  body.style.setProperty('--idle-delay', `-${(Math.random() * 5).toFixed(2)}s`);
  body.style.setProperty('--glint-delay', `${(Math.random() * 6).toFixed(2)}s`);

  const facet = document.createElement('div');
  facet.className = 'gem-facet';
  const glint = document.createElement('div');
  glint.className = 'gem-glint';
  body.appendChild(facet);
  body.appendChild(glint);
  wrapper.appendChild(body);

  return { wrapper, body };
}

function placeEntity(entity, r, c, animate) {
  entity.r = r;
  entity.c = c;
  entity.el.style.transition = animate ? '' : 'none';
  entity.el.style.transform = `translate(${c * CELL}px, ${r * CELL}px)`;
  if (!animate) {
    // Force layout flush so the next transform change animates from here.
    void entity.el.offsetWidth;
    entity.el.style.transition = '';
  }
}

function buildEntitiesFromBoard(board) {
  gemsLayerEl.innerHTML = '';
  entities = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const value = board[r][c];
      const { wrapper, body } = makeGemEl(value);
      gemsLayerEl.appendChild(wrapper);
      const entity = { id: nextGemId++, value, r, c, el: wrapper, body };
      attachPointerHandlers(entity);
      placeEntity(entity, r, c, false);
      row.push(entity);
    }
    entities.push(row);
  }
}

// ------------------------------------------------------------ pointer ----
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Only pointerdown lives on the gem. The move/up handlers are bound to the
// DOCUMENT for the life of the drag, so the gesture keeps tracking even after
// the pointer leaves the origin cell (the per-cell-move trap the contract warns
// about). Pointer capture is also requested as a belt-and-suspenders.
function attachPointerHandlers(entity) {
  entity.el.addEventListener('pointerdown', (e) => onPointerDown(e, entity));
}

function onPointerDown(e, entity) {
  if (animating || gameOver || dragState) return;
  e.preventDefault();
  try { entity.el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  dragState = {
    entity,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originR: entity.r,
    originC: entity.c,
    dx: 0,
    dy: 0,
  };
  clearHint();
  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', onDocPointerUp);
  document.addEventListener('pointercancel', onDocPointerUp);
}

function onDocPointerMove(e) {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const entity = dragState.entity;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  dragState.dx = dx;
  dragState.dy = dy;
  let ox = 0, oy = 0;
  if (Math.abs(dx) > Math.abs(dy)) ox = clamp(dx, -CELL, CELL);
  else oy = clamp(dy, -CELL, CELL);
  const baseX = dragState.originC * CELL;
  const baseY = dragState.originR * CELL;
  entity.el.style.transition = 'none';
  entity.el.style.zIndex = '5';
  entity.el.style.transform = `translate(${baseX + ox}px, ${baseY + oy}px)`;
}

function onDocPointerUp(e) {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  document.removeEventListener('pointermove', onDocPointerMove);
  document.removeEventListener('pointerup', onDocPointerUp);
  document.removeEventListener('pointercancel', onDocPointerUp);
  const entity = dragState.entity;
  const { originR, originC, dx, dy } = dragState;
  dragState = null;
  entity.el.style.transition = '';
  entity.el.style.zIndex = '';

  const threshold = CELL * 0.28;
  let dir = null;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dx) > threshold) dir = { dr: 0, dc: dx > 0 ? 1 : -1 };
  } else {
    if (Math.abs(dy) > threshold) dir = { dr: dy > 0 ? 1 : -1, dc: 0 };
  }

  const origin = { r: originR, c: originC };
  if (!dir) {
    placeEntity(entity, origin.r, origin.c, true);
    return;
  }
  const target = { r: origin.r + dir.dr, c: origin.c + dir.dc };
  if (target.r < 0 || target.r >= ROWS || target.c < 0 || target.c >= COLS) {
    placeEntity(entity, origin.r, origin.c, true);
    return;
  }
  performMove(origin, target);
}

// -------------------------------------------------------------- timing ----
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transitionDuration(rowsFallen) {
  return Math.min(760, 220 + 55 * Math.max(0, rowsFallen));
}

// --------------------------------------------------------------- moves ----
function pairsEqual(p1, p2) {
  const same = (x, y) => x.r === y.r && x.c === y.c;
  return (same(p1.a, p2.a) && same(p1.b, p2.b)) || (same(p1.a, p2.b) && same(p1.b, p2.a));
}

function findValidMoves(board) {
  const moves = [];
  const rows = board.length, cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        moves.push({ a: { r, c }, b: { r, c: c + 1 } });
      }
      if (r + 1 < rows && game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
        moves.push({ a: { r, c }, b: { r: r + 1, c } });
      }
    }
  }
  return moves;
}

function findAnyValidMove(board) {
  const moves = findValidMoves(board);
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

async function performMove(a, b) {
  if (animating || gameOver) return;
  animating = true;
  const hintAtMoveTime = hint;
  clearHint();
  stopIdleTimer();

  const entityA = entities[a.r][a.c];
  const entityB = entities[b.r][b.c];

  // Visual swap.
  entities[a.r][a.c] = entityB;
  entities[b.r][b.c] = entityA;
  placeEntity(entityA, b.r, b.c, true);
  placeEntity(entityB, a.r, a.c, true);
  await wait(190);

  const valid = game.isValidSwap(logicalBoard, a, b);
  if (!valid) {
    await wait(90);
    // Swap back.
    entities[a.r][a.c] = entityA;
    entities[b.r][b.c] = entityB;
    placeEntity(entityA, a.r, a.c, true);
    placeEntity(entityB, b.r, b.c, true);
    await wait(260);
    animating = false;
    scheduleIdle();
    return;
  }

  const swappedBoard = game.applySwap(logicalBoard, a, b);
  const { board: settled, steps } = game.collapse(swappedBoard, rng, TYPES);

  for (const step of steps) {
    await runWave(step.matches, step.board);
  }

  logicalBoard = settled;

  const waves = steps.map((s) => s.matches);
  const gain = game.scoreCascade(waves);
  let bonus = 0;
  if (hintAtMoveTime && !pairsEqual(hintAtMoveTime, { a, b })) {
    bonus = DEVIATION_BONUS;
  }
  const total = gain + bonus;
  score += total;
  lastGain = total;
  lastBonus = bonus;
  updateHud();
  if (total > 0) showFloatingGain(total, bonus > 0);

  animating = false;

  if (!game.hasValidMove(logicalBoard)) {
    setGameOver(true);
  } else {
    scheduleIdle();
  }
}

/** Clear `matches` off the current visual grid, then drop/refill to `nextBoard`. */
async function runWave(matches, nextBoard) {
  // 1. Clear phase.
  const matchedEntities = matches.map(({ r, c }) => entities[r][c]);
  for (const ent of matchedEntities) ent.body.classList.add('clearing');
  await wait(220);
  for (const ent of matchedEntities) ent.el.remove();

  const matchedSet = new Set(matches.map(({ r, c }) => r + ',' + c));

  // 2. Drop + refill phase, column by column.
  let maxRowsFallen = 0;
  const newEntities = entities.map((row) => row.slice());

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) {
      if (!matchedSet.has(r + ',' + c)) survivors.push(entities[r][c]);
    }
    const missing = ROWS - survivors.length;

    // Survivors keep relative order, land on the bottom `survivors.length` rows.
    for (let k = 0; k < survivors.length; k++) {
      const targetRow = missing + k;
      const ent = survivors[k];
      const rowsFallen = targetRow - ent.r;
      maxRowsFallen = Math.max(maxRowsFallen, rowsFallen);
      newEntities[targetRow][c] = ent;
    }

    // Refills spawn above the board and fall into the top `missing` rows.
    for (let i = 0; i < missing; i++) {
      const value = nextBoard[i][c];
      const { wrapper, body } = makeGemEl(value);
      gemsLayerEl.appendChild(wrapper);
      const spawnRow = i - missing;
      const entity = { id: nextGemId++, value, r: spawnRow, c, el: wrapper, body };
      attachPointerHandlers(entity);
      placeEntity(entity, spawnRow, c, false);
      const rowsFallen = i - spawnRow;
      maxRowsFallen = Math.max(maxRowsFallen, rowsFallen);
      newEntities[i][c] = entity;
    }
  }

  entities = newEntities;
  const duration = transitionDuration(maxRowsFallen);
  // Gravity: slow to start, fastest as it lands — an accelerating ease-in.
  const dropEasing = 'cubic-bezier(0.55, 0.06, 0.68, 0.19)';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ent = entities[r][c];
      ent.el.style.transitionDuration = duration + 'ms';
      ent.el.style.transitionTimingFunction = dropEasing;
      placeEntity(ent, r, c, true);
    }
  }
  await wait(duration + 30);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      entities[r][c].el.style.transitionDuration = '';
      entities[r][c].el.style.transitionTimingFunction = '';
    }
  }
}

// -------------------------------------------------------------- hints ----
function clearHint() {
  if (!hint) return;
  const ent = entities[hint.a.r] && entities[hint.a.r][hint.a.c];
  if (ent) ent.body.classList.remove('hinting');
  hint = null;
  hintNoteEl.classList.remove('visible');
}

function showHint() {
  if (gameOver || animating) return;
  const mv = findAnyValidMove(logicalBoard);
  if (!mv) return;
  hint = mv;
  const ent = entities[mv.a.r][mv.a.c];
  ent.body.classList.add('hinting');
  hintNoteEl.classList.add('visible');
}

function scheduleIdle() {
  stopIdleTimer();
  if (gameOver) return;
  idleTimer = setTimeout(showHint, IDLE_MS);
}

function stopIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

// --------------------------------------------------------------- score ----
function updateHud() {
  scoreEl.textContent = String(score);
  lastGainEl.textContent = lastGain > 0 ? `+${lastGain}` : '0';
}

function showFloatingGain(amount, bonus) {
  const tag = document.createElement('div');
  tag.className = 'floating-gain' + (bonus ? ' floating-gain-bonus' : '');
  tag.textContent = `+${amount}`;
  if (bonus) {
    const sub = document.createElement('span');
    sub.className = 'floating-gain-sub';
    sub.textContent = 'deviation bonus!';
    tag.appendChild(sub);
  }
  const left = (COLS * CELL) / 2;
  const top = (ROWS * CELL) / 2;
  tag.style.left = left + 'px';
  tag.style.top = top + 'px';
  gainLayerEl.appendChild(tag);
  setTimeout(() => tag.remove(), 1500);
}

// ------------------------------------------------------------ game over ----
function setGameOver(value) {
  gameOver = value;
  overlayEl.classList.toggle('visible', value);
  stopIdleTimer();
}

function newGame() {
  stopIdleTimer();
  animating = false;
  dragState = null;
  clearHint();
  logicalBoard = game.createBoard(ROWS, COLS, TYPES, rng);
  score = 0;
  lastGain = 0;
  lastBonus = 0;
  setGameOver(false);
  buildEntitiesFromBoard(logicalBoard);
  updateHud();
  scheduleIdle();
}

newGameBtn.addEventListener('click', newGame);

// -------------------------------------------------------------- fireflies ----
function buildFireflies() {
  const layer = document.getElementById('fireflies');
  if (!layer) return;
  const count = 14;
  for (let i = 0; i < count; i++) {
    const f = document.createElement('div');
    f.className = 'firefly';
    f.style.left = `${Math.random() * 100}%`;
    f.style.top = `${Math.random() * 100}%`;
    f.style.setProperty('--drift-x', `${(Math.random() * 60 - 30).toFixed(0)}px`);
    f.style.setProperty('--drift-y', `${(Math.random() * 60 - 30).toFixed(0)}px`);
    f.style.animationDuration = `${(6 + Math.random() * 6).toFixed(2)}s`;
    f.style.animationDelay = `-${(Math.random() * 8).toFixed(2)}s`;
    layer.appendChild(f);
  }
}

// ------------------------------------------------------------------ init ----
buildFireflies();
buildSlots();
buildEntitiesFromBoard(logicalBoard);
updateHud();
scheduleIdle();

// -------------------------------------------------------------- __test ----
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  validMove: () => findAnyValidMove(logicalBoard),
  board: () => logicalBoard.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
  slide(r, c, dir) {
    const dirs = { up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 }, left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 } };
    const d = dirs[dir];
    if (!d) return Promise.resolve(false);
    const a = { r, c };
    const b = { r: r + d.dr, c: c + d.dc };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return Promise.resolve(false);
    const before = animating;
    if (before) return Promise.resolve(false);
    const p = performMove(a, b);
    return p.then(() => true);
  },
};
