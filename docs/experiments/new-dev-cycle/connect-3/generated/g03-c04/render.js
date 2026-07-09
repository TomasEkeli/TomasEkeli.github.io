import * as game from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const CLEAR_DURATION = 200;
const DROP_DURATION = 300;

// Gem colors - dark neon theme
const GEM_COLORS = [
  '#FF006E', // hot pink
  '#00F5FF', // cyan
  '#FFB700', // golden
  '#00D084', // neon green
  '#9D4EDD', // purple
  '#3A86FF', // electric blue
];

let gameState = {
  board: null,
  score: 0,
  lastGain: 0,
  lastMovePromise: null,
  lastMoveResolve: null,
};

export function initializeGame() {
  const rng = seededRNG(Math.random() * 1e9);
  gameState.board = game.createBoard(ROWS, COLS, TYPES, rng);
  gameState.score = 0;
  gameState.lastGain = 0;
  renderBoard();
}

function seededRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      const gemValue = gameState.board[r][c];
      const gem = document.createElement('div');
      gem.className = 'gem';
      gem.style.backgroundColor = GEM_COLORS[gemValue];
      gem.style.boxShadow = `0 0 20px ${GEM_COLORS[gemValue]}, inset 0 0 10px rgba(255,255,255,0.3)`;

      cell.appendChild(gem);
      boardEl.appendChild(cell);

      setupCellDragListeners(cell);
    }
  }

  updateScoreDisplay();
}

function setupCellDragListeners(cell) {
  let dragStart = null;
  let dragStartPos = null;

  cell.addEventListener('pointerdown', (e) => {
    dragStart = cell;
    dragStartPos = { x: e.clientX, y: e.clientY };
    cell.style.opacity = '0.8';
  });

  cell.addEventListener('pointermove', (e) => {
    if (!dragStart) return;

    const dx = e.clientX - dragStartPos.x;
    const dy = e.clientY - dragStartPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 20) {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const r = parseInt(dragStart.dataset.r);
      const c = parseInt(dragStart.dataset.c);
      let dir = null;

      if (angle > -45 && angle <= 45) {
        dir = 'right';
      } else if (angle > 45 && angle <= 135) {
        dir = 'down';
      } else if (angle > 135 || angle <= -135) {
        dir = 'left';
      } else if (angle > -135 && angle <= -45) {
        dir = 'up';
      }

      if (dir) {
        cell.removeEventListener('pointerdown', arguments.callee);
        handleSlide(r, c, dir);
        dragStart = null;
      }
    }
  });

  cell.addEventListener('pointerup', () => {
    if (dragStart) {
      dragStart.style.opacity = '1';
      dragStart = null;
    }
  });

  cell.addEventListener('pointerleave', () => {
    if (dragStart) {
      dragStart.style.opacity = '1';
      dragStart = null;
    }
  });
}

async function handleSlide(r, c, dir) {
  const target = getTargetPosition(r, c, dir);

  if (!target || !isValidPosition(target.r, target.c)) {
    return;
  }

  const a = { r, c };
  const b = target;

  if (!game.isValidSwap(gameState.board, a, b)) {
    return;
  }

  // Apply the swap
  gameState.board = game.applySwap(gameState.board, a, b);

  // Perform collapse and animate
  const rng = seededRNG(Math.random() * 1e9);
  const { board: settledBoard, steps } = game.collapse(gameState.board, rng, TYPES);

  // Calculate score
  const waves = steps.map(s => s.matches);
  const moveScore = game.scoreCascade(waves);
  gameState.lastGain = moveScore;
  gameState.score += moveScore;

  // Animate the collapse
  await animateCollapse(steps);

  // Update board to final settled state
  gameState.board = settledBoard;
  renderBoard();
}

function getTargetPosition(r, c, dir) {
  switch (dir) {
    case 'up': return { r: r - 1, c };
    case 'down': return { r: r + 1, c };
    case 'left': return { r, c: c - 1 };
    case 'right': return { r, c: c + 1 };
    default: return null;
  }
}

function isValidPosition(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

async function animateCollapse(steps) {
  for (const step of steps) {
    const matches = step.matches;
    const nextBoard = step.board;

    // Mark matched gems for clearing
    const matchSet = new Set(matches.map(m => `${m.r},${m.c}`));

    // Animate clear
    await animateClear(matchSet);

    // Update board to reflect gravity + refill
    gameState.board = nextBoard;
    renderBoard();

    // Animate drop (already in the board, just show it settling)
    await animateDrop();
  }
}

function animateClear(matchSet) {
  return new Promise((resolve) => {
    const cells = document.querySelectorAll('.cell');
    const animations = [];

    cells.forEach((cell) => {
      const r = parseInt(cell.dataset.r);
      const c = parseInt(cell.dataset.c);
      const key = `${r},${c}`;

      if (matchSet.has(key)) {
        const gem = cell.querySelector('.gem');
        gem.style.transition = `all ${CLEAR_DURATION}ms ease-out`;
        gem.style.transform = 'scale(0) rotate(360deg)';
        gem.style.opacity = '0';
        animations.push(new Promise(r => setTimeout(r, CLEAR_DURATION)));
      }
    });

    Promise.all(animations).then(resolve);
  });
}

function animateDrop() {
  return new Promise((resolve) => {
    const cells = document.querySelectorAll('.cell');

    cells.forEach((cell) => {
      const gem = cell.querySelector('.gem');
      gem.style.transition = `all ${DROP_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
    });

    setTimeout(resolve, DROP_DURATION);
  });
}

function updateScoreDisplay() {
  const scoreEl = document.getElementById('score');
  if (scoreEl) {
    scoreEl.textContent = gameState.score;
  }
}

export function getTestInterface() {
  return {
    score() {
      return gameState.score;
    },
    lastGain() {
      return gameState.lastGain;
    },
    validMove() {
      const rows = gameState.board.length;
      const cols = gameState.board[0].length;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c + 1 < cols && game.isValidSwap(gameState.board, { r, c }, { r, c: c + 1 })) {
            return { a: { r, c }, b: { r, c: c + 1 } };
          }
          if (r + 1 < rows && game.isValidSwap(gameState.board, { r, c }, { r: r + 1, c })) {
            return { a: { r, c }, b: { r: r + 1, c } };
          }
        }
      }

      return null;
    },
    slide(r, c, dir) {
      return new Promise((resolve) => {
        const target = getTargetPosition(r, c, dir);

        if (!target || !isValidPosition(target.r, target.c)) {
          resolve();
          return;
        }

        const a = { r, c };
        const b = target;

        if (!game.isValidSwap(gameState.board, a, b)) {
          resolve();
          return;
        }

        // Apply the swap
        gameState.board = game.applySwap(gameState.board, a, b);

        // Perform collapse
        const rng = seededRNG(Math.random() * 1e9);
        const { board: settledBoard, steps } = game.collapse(gameState.board, rng, TYPES);

        // Calculate score
        const waves = steps.map(s => s.matches);
        const moveScore = game.scoreCascade(waves);
        gameState.lastGain = moveScore;
        gameState.score += moveScore;

        // Animate and then resolve
        animateCollapse(steps).then(() => {
          gameState.board = settledBoard;
          renderBoard();
          resolve();
        });
      });
    }
  };
}
