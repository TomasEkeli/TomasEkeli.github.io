import {
  createBoard,
  findMatches,
  isValidSwap,
  applySwap,
  collapse,
  score,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#95a5a6'];

// Deterministic-enough RNG for play (UI doesn't need reproducibility across
// runs, just a valid rng function per the contract's shape).
function makeRng() {
  let a = (Date.now() ^ 0x9e3779b9) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng();

let board = createBoard(ROWS, COLS, TYPES, rng);
let currentScore = 0;
let selected = null; // {r,c} or null

const boardEl = document.getElementById('board');

function cellId(r, c) {
  return `cell-${r}-${c}`;
}

function render() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const div = document.createElement('div');
      div.className = 'cell';
      div.id = cellId(r, c);
      div.dataset.r = String(r);
      div.dataset.c = String(c);
      const val = board[r][c];
      div.style.backgroundColor = COLORS[val % COLORS.length];
      if (selected && selected.r === r && selected.c === c) {
        div.classList.add('selected');
      }
      div.addEventListener('click', () => onCellClick(r, c));
      boardEl.appendChild(div);
    }
  }
  const scoreEl = document.getElementById('score');
  if (scoreEl) scoreEl.textContent = String(currentScore);
}

function onCellClick(r, c) {
  const clicked = { r, c };
  if (!selected) {
    selected = clicked;
    render();
    return;
  }
  if (selected.r === clicked.r && selected.c === clicked.c) {
    selected = null;
    render();
    return;
  }
  const a = selected;
  const b = clicked;
  selected = null;

  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  const adjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);

  if (!adjacent) {
    render();
    return;
  }

  if (!isValidSwap(board, a, b)) {
    render();
    return;
  }

  board = applySwap(board, a, b);
  let matches = findMatches(board);
  currentScore += score(matches);
  board = collapse(board, rng, TYPES);

  render();
}

function findAnyValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) {
        const a = { r, c };
        const b = { r, c: c + 1 };
        if (isValidSwap(board, a, b)) return { a, b };
      }
      if (r + 1 < ROWS) {
        const a = { r, c };
        const b = { r: r + 1, c };
        if (isValidSwap(board, a, b)) return { a, b };
      }
    }
  }
  return null;
}

window.__test = {
  score() {
    return currentScore;
  },
  validMove() {
    return findAnyValidMove();
  },
  clickCell(r, c) {
    onCellClick(r, c);
  },
};

render();
