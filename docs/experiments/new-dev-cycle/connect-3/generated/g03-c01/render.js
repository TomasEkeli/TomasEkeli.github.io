import * as Game from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const rng = Math.random;

const boardEl = document.getElementById('board');
const scoreBadgeEl = document.getElementById('score-badge');
const boardWrapEl = document.querySelector('.board-wrap');

let board = Game.createBoard(ROWS, COLS, TYPES, rng);
let scoreTotal = 0;
let lastGain = 0;
let busy = false;
let chain = Promise.resolve();

/** cellsGrid[r][c] -> the static .cell DOM element (never replaced). */
const cellsGrid = [];
/** gemGrid[r][c] -> the .gem DOM element currently occupying that cell. */
let gemGrid = [];

let colStep = 0;
let rowStep = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function createGemEl(value) {
  const el = document.createElement('div');
  el.className = `gem gem-${value}`;
  el.dataset.type = String(value);
  return el;
}

function buildBoardDom() {
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      boardEl.appendChild(cell);
      row.push(cell);
      attachPointerHandlers(cell, r, c);
    }
    cellsGrid.push(row);
  }
}

function populateGems() {
  gemGrid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const el = createGemEl(board[r][c]);
      cellsGrid[r][c].appendChild(el);
      row.push(el);
    }
    gemGrid.push(row);
  }
}

function measureSteps() {
  const cs = getComputedStyle(boardEl);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  const rect = cellsGrid[0][0].getBoundingClientRect();
  if (rect.width > 0) {
    rowStep = rect.height + gap;
    colStep = rect.width + gap;
  }
}

function updateHud() {
  scoreBadgeEl.textContent = `${scoreTotal} pts`;
}

function showFloatGain(n) {
  const el = document.createElement('div');
  el.className = 'float-gain';
  el.textContent = `+${n}`;
  boardWrapEl.appendChild(el);
  const cleanup = () => el.remove();
  el.addEventListener('animationend', cleanup);
  setTimeout(cleanup, 1600);
}

/**
 * Reparents `el` into cellsGrid[toR][toC], visually preserving its previous
 * on-screen position via a FLIP-style transform, then animates it to rest.
 * `fromR`/`fromC` may be synthetic (e.g. negative row) for freshly-created
 * gems that never actually occupied a cell.
 */
function reparentWithFlip(el, fromR, fromC, toR, toC, duration) {
  cellsGrid[toR][toC].appendChild(el);
  const dRow = fromR - toR;
  const dCol = fromC - toC;
  el.style.transition = 'none';
  el.style.transform = `translate(${dCol * colStep}px, ${dRow * rowStep}px)`;
  // Force reflow so the browser registers the start position before we
  // animate away from it.
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  el.style.transition = `transform ${duration}ms cubic-bezier(.3,0,.2,1)`;
  requestAnimationFrame(() => {
    el.style.transform = 'translate(0px, 0px)';
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      resolve();
    }, duration + 30);
  });
}

async function clearWave(matches) {
  for (const { r, c } of matches) {
    const el = gemGrid[r][c];
    if (el) el.classList.add('matched');
  }
  await sleep(220);
  for (const { r, c } of matches) {
    const el = gemGrid[r][c];
    if (el) {
      el.remove();
      gemGrid[r][c] = null;
    }
  }
}

async function dropWave(newBoard) {
  const promises = [];
  for (let c = 0; c < COLS; c++) {
    const survivorRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (gemGrid[r][c] !== null) survivorRows.push(r);
    }
    const k = survivorRows.length;
    const newCount = ROWS - k;
    const newCol = new Array(ROWS).fill(null);

    for (let i = 0; i < k; i++) {
      const srcRow = survivorRows[i];
      const destRow = newCount + i;
      const el = gemGrid[srcRow][c];
      newCol[destRow] = el;
      if (destRow !== srcRow) {
        promises.push(reparentWithFlip(el, srcRow, c, destRow, c, 260));
      }
    }

    for (let r = 0; r < newCount; r++) {
      const value = newBoard[r][c];
      const el = createGemEl(value);
      newCol[r] = el;
      const offsetRows = newCount - r;
      promises.push(reparentWithFlip(el, r - offsetRows, c, r, c, 260));
    }

    for (let r = 0; r < ROWS; r++) gemGrid[r][c] = newCol[r];
  }
  await Promise.all(promises);
}

async function playSteps(steps) {
  for (const step of steps) {
    await clearWave(step.matches);
    await dropWave(step.board);
  }
}

async function swapGems(a, b) {
  const elA = gemGrid[a.r][a.c];
  const elB = gemGrid[b.r][b.c];
  const pA = reparentWithFlip(elA, a.r, a.c, b.r, b.c, 190);
  const pB = reparentWithFlip(elB, b.r, b.c, a.r, a.c, 190);
  gemGrid[a.r][a.c] = elB;
  gemGrid[b.r][b.c] = elA;
  await Promise.all([pA, pB]);
}

async function rejectSlide(a, b) {
  const el = gemGrid[a.r][a.c];
  if (!el) return;
  const dRow = b ? b.r - a.r : 0;
  const dCol = b ? b.c - a.c : 0;
  const bumpX = dCol * colStep * 0.3;
  const bumpY = dRow * rowStep * 0.3;
  el.style.transition = 'transform 0.11s ease-out';
  el.style.transform = `translate(${bumpX}px, ${bumpY}px)`;
  await sleep(120);
  el.style.transition = 'transform 0.14s ease-in';
  el.style.transform = 'translate(0px, 0px)';
  await sleep(150);
  el.style.transition = '';
  el.style.transform = '';
}

function neighbourFor({ r, c }, dir) {
  switch (dir) {
    case 'up': return { r: r - 1, c };
    case 'down': return { r: r + 1, c };
    case 'left': return { r, c: c - 1 };
    case 'right': return { r, c: c + 1 };
    default: return null;
  }
}

function inBounds({ r, c }) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function findValidMove(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && Game.isValidSwap(b, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && Game.isValidSwap(b, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}

async function doSlide(r, c, dir) {
  busy = true;
  try {
    const a = { r, c };
    const target = neighbourFor(a, dir);

    if (!target || !inBounds(target)) {
      await rejectSlide(a, null);
      return;
    }

    if (!Game.isValidSwap(board, a, target)) {
      await rejectSlide(a, target);
      return;
    }

    await swapGems(a, target);

    const postSwap = Game.applySwap(board, a, target);
    const { board: settled, steps } = Game.collapse(postSwap, rng, TYPES);
    const gain = Game.scoreCascade(steps.map((s) => s.matches));

    if (steps.length > 0) {
      await playSteps(steps);
    }

    board = settled;
    scoreTotal += gain;
    lastGain = gain;
    updateHud();
    if (gain > 0) showFloatGain(gain);
  } finally {
    busy = false;
  }
}

function queueSlide(r, c, dir) {
  const result = chain.then(() => doSlide(r, c, dir));
  chain = result.catch(() => {});
  return result;
}

function attachPointerHandlers(cellEl, r, c) {
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;

  cellEl.addEventListener('pointerdown', (e) => {
    if (busy) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    try { cellEl.setPointerCapture(pointerId); } catch { /* ignore */ }
  });

  cellEl.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = clamp(e.clientX - startX, -colStep, colStep);
    const dy = clamp(e.clientY - startY, -rowStep, rowStep);
    const el = gemGrid[r][c];
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });

  const finish = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const el = gemGrid[r][c];
    if (el) {
      el.style.transition = 'transform 0.15s ease';
      el.style.transform = 'translate(0px, 0px)';
    }

    const threshold = Math.min(colStep, rowStep) * 0.25 || 15;
    let dir = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > threshold) dir = 'right';
      else if (dx < -threshold) dir = 'left';
    } else {
      if (dy > threshold) dir = 'down';
      else if (dy < -threshold) dir = 'up';
    }

    if (dir) queueSlide(r, c, dir);
  };

  cellEl.addEventListener('pointerup', finish);
  cellEl.addEventListener('pointercancel', finish);
}

function init() {
  buildBoardDom();
  populateGems();
  measureSteps();
  requestAnimationFrame(() => {
    measureSteps();
  });
  updateHud();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => measureSteps());
    ro.observe(boardEl);
  } else {
    window.addEventListener('resize', measureSteps);
  }

  window.__test = {
    score: () => scoreTotal,
    lastGain: () => lastGain,
    validMove: () => findValidMove(board),
    slide: (r, c, dir) => queueSlide(r, c, dir),
  };
}

init();
