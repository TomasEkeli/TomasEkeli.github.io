import {
  createBoard,
  findMatches,
  hasValidMove,
  isValidSwap,
  applySwap,
  collapse,
  score as scoreMatches,
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;

const COLOURS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f1c40f', // yellow
  '#9b59b6', // purple
  '#e67e22', // orange
];

const rng = Math.random;

let board = createBoard(ROWS, COLS, TYPES, rng);
let score = 0;
let selected = null; // {r,c} or null

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const messageEl = document.getElementById('message');

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function findAnyValidMove(b) {
  const rows = b.length;
  const cols = b[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        const a = { r, c };
        const bb = { r, c: c + 1 };
        if (isValidSwap(b, a, bb)) return { a, b: bb };
      }
      if (r + 1 < rows) {
        const a = { r, c };
        const bb = { r: r + 1, c };
        if (isValidSwap(b, a, bb)) return { a, b: bb };
      }
    }
  }
  return null;
}

function setMessage(text) {
  if (messageEl) messageEl.textContent = text || '';
}

function render() {
  boardEl.style.setProperty('--cols', COLS);
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.style.background = COLOURS[board[r][c] % COLOURS.length];
      if (selected && selected.r === r && selected.c === c) {
        cell.classList.add('selected');
      }
      cell.addEventListener('click', () => clickCell(r, c));
      boardEl.appendChild(cell);
    }
  }
  scoreEl.textContent = String(score);
}

function clickCell(r, c) {
  const target = { r, c };

  if (!selected) {
    selected = target;
    render();
    return;
  }

  if (selected.r === target.r && selected.c === target.c) {
    // Clicking the already-selected cell deselects it.
    selected = null;
    render();
    return;
  }

  if (!isAdjacent(selected, target)) {
    // Not adjacent: treat as starting a new selection.
    selected = target;
    render();
    return;
  }

  const a = selected;
  const b = target;
  selected = null;

  if (isValidSwap(board, a, b)) {
    board = applySwap(board, a, b);
    const matches = findMatches(board);
    score += scoreMatches(matches);
    board = collapse(board, rng, TYPES);
    setMessage('');
  } else {
    setMessage('No match there.');
  }

  if (!hasValidMove(board)) {
    // Should not happen (collapse/createBoard guarantee a move), but guard
    // defensively by reshuffling via a fresh board if it ever does.
    board = createBoard(ROWS, COLS, TYPES, rng);
  }

  render();
}

window.__test = {
  score() {
    return score;
  },
  validMove() {
    return findAnyValidMove(board);
  },
  clickCell(r, c) {
    clickCell(r, c);
  },
};

render();
