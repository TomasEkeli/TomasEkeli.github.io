import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap, collapse,
  longestRun, matchMultiplier, stageForScore
} from './game.js';

const ROWS = 8;
const COLS = 8;
const TYPES = 6;
const CELL_SIZE = 60;
const CLEAR_DURATION = 200;
const DROP_DURATION = 400;
const FLOAT_DURATION = 1500;
const IDLE_HINT_DELAY = 10000;
const SLIDE_THRESHOLD = 20;

// Stage themes
const STAGE_THEMES = [
  { name: 'Golden Hour', backdrop: 'linear-gradient(135deg, #ff9e64 0%, #ffd89b 50%, #87ceeb 100%)', featured: null },
  { name: 'Sunset', backdrop: 'linear-gradient(135deg, #c1440e 0%, #ff6b35 50%, #f7b801 100%)', featured: 3 },
  { name: 'Twilight', backdrop: 'linear-gradient(135deg, #663399 0%, #4b0082 50%, #1e3c72 100%)', featured: 5 },
  { name: 'Starry Night', backdrop: 'radial-gradient(circle at 20% 50%, #1a1a2e 0%, #0f3460 50%, #16213e 100%)', featured: 4 },
];

// Gem color definitions
const GEM_COLORS = [
  { hue: 0, name: 'coral', shape: 'circle' },
  { hue: 30, name: 'orange', shape: 'square' },
  { hue: 60, name: 'yellow', shape: 'triangle' },
  { hue: 330, name: 'pink', shape: 'diamond' },
  { hue: 260, name: 'purple', shape: 'pentagon' },
  { hue: 200, name: 'blue', shape: 'star' },
];

class GameState {
  constructor() {
    this.rng = Math.random;
    this.board = createBoard(ROWS, COLS, TYPES, this.rng);
    this.score = 0;
    this.bestScore = parseInt(localStorage.getItem('bestScore') || '0', 10);
    this.lastGain = 0;
    this.lastBonus = 0;
    this.multiplier = 1;
    this.gameOver = false;
    this.animating = false;
    this.gemValues = [5, 40, 10, 35, 20, 15];
    this.gemMatchCounts = [0, 0, 0, 0, 0, 0];
    this.hint = null;
    this.idleTimer = null;
    this.dragStart = null;
    this.dragElement = null;
  }

  updateGemValues(stage) {
    const baseValues = [5, 40, 10, 35, 20, 15];
    this.gemValues = baseValues.map((val, i) => {
      if (i === 1) return 40; // Orange: flat
      if (i === 2) return 10 + this.gemMatchCounts[2] * 5; // Yellow: grows
      if (i === 4) return 20 * (1 + stage); // Purple: stage-scaled
      if (i === 0) return Math.min(5 * Math.pow(2, this.gemMatchCounts[0]), 80); // Coral: exponential
      if (i === 3 || i === 5) {
        // Pink and Blue: rarity-based
        let count = 0;
        for (let r = 0; r < this.board.length; r++) {
          for (let c = 0; c < this.board[0].length; c++) {
            if (this.board[r][c] === i) count++;
          }
        }
        return Math.max(10, Math.floor(400 / Math.max(count, 1)));
      }
      return val;
    });
  }

  reset() {
    this.board = createBoard(ROWS, COLS, TYPES, this.rng);
    this.score = 0;
    this.lastGain = 0;
    this.lastBonus = 0;
    this.multiplier = 1;
    this.gameOver = false;
    this.animating = false;
    this.gemMatchCounts = [0, 0, 0, 0, 0, 0];
    this.hint = null;
    this.updateGemValues(0);
  }
}

let gameState;

export function initializeGame() {
  gameState = new GameState();
  setupDOM();
  setupEventListeners();
  gameState.updateGemValues(0);
  renderBoard();
  resetIdleTimer();
  return gameState;
}

function setupDOM() {
  const container = document.querySelector('#game-container');
  container.innerHTML = `
    <div class="hud">
      <div class="score-info">
        <div class="score-label">Score</div>
        <div class="score-value" id="score">0</div>
        <div class="best-label">Best</div>
        <div class="best-value" id="best-score">${gameState.bestScore}</div>
      </div>
      <div class="stage-indicator">
        <div class="stage-number" id="stage">Stage 0</div>
        <div class="stage-name" id="stage-name">Golden Hour</div>
      </div>
    </div>
    <div class="board-container">
      <div class="board" id="board"></div>
      <div class="score-popup" id="score-popup"></div>
    </div>
    <div class="game-over-overlay" id="game-over" style="display: none;">
      <div class="game-over-content">
        <h2>Game Over!</h2>
        <p>Final Score: <span id="final-score">0</span></p>
        <button data-testid="new-game" class="new-game-btn">New Game</button>
      </div>
    </div>
    <button data-testid="new-game" class="new-game-btn" id="new-game-top" style="display: block;">New Game</button>
  `;
}

function setupEventListeners() {
  document.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('pointermove', handlePointerMove);
  document.addEventListener('pointerup', handlePointerUp);

  document.querySelectorAll('[data-testid="new-game"]').forEach(btn => {
    btn.addEventListener('click', () => {
      gameState.reset();
      gameState.gameOver = false;
      document.querySelector('#game-over').style.display = 'none';
      document.querySelector('#new-game-top').style.display = 'block';
      renderBoard();
      resetIdleTimer();
    });
  });
}

function handlePointerDown(e) {
  if (gameState.animating || gameState.gameOver) return;

  const cell = e.target.closest('[data-testid="cell"]');
  if (cell) {
    gameState.dragStart = { x: e.clientX, y: e.clientY };
    gameState.dragElement = cell;
    e.preventDefault();
  }
}

function handlePointerMove(e) {
  // Drag tracking on document
}

function handlePointerUp(e) {
  if (!gameState.dragStart || !gameState.dragElement) return;

  const dx = e.clientX - gameState.dragStart.x;
  const dy = e.clientY - gameState.dragStart.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < SLIDE_THRESHOLD) {
    gameState.dragStart = null;
    gameState.dragElement = null;
    return;
  }

  const fromCell = gameState.dragElement;
  const fromCoords = getCellCoords(fromCell);
  let toCoords = null;

  if (Math.abs(dx) > Math.abs(dy)) {
    const direction = dx > 0 ? 1 : -1;
    toCoords = { r: fromCoords.r, c: fromCoords.c + direction };
  } else {
    const direction = dy > 0 ? 1 : -1;
    toCoords = { r: fromCoords.r + direction, c: fromCoords.c };
  }

  gameState.dragStart = null;
  gameState.dragElement = null;

  if (!isWithinBounds(toCoords)) return;

  if (isValidSwap(gameState.board, fromCoords, toCoords)) {
    applyMove(fromCoords, toCoords);
  }
}

function getCellCoords(element) {
  const board = document.querySelector('#board');
  const cells = Array.from(board.querySelectorAll('[data-testid="cell"]'));
  const index = cells.indexOf(element);
  return { r: Math.floor(index / COLS), c: index % COLS };
}

function getCellElement(coords) {
  const board = document.querySelector('#board');
  const cells = Array.from(board.querySelectorAll('[data-testid="cell"]'));
  const index = coords.r * COLS + coords.c;
  return cells[index];
}

function isWithinBounds(coords) {
  return coords.r >= 0 && coords.r < ROWS && coords.c >= 0 && coords.c < COLS;
}

async function applyMove(a, b) {
  gameState.animating = true;

  gameState.board = applySwap(gameState.board, a, b);
  const { board: settledBoard, steps } = collapse(gameState.board, gameState.rng, TYPES);

  let totalWaveScore = 0;
  let totalBonus = 0;

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];

    // Calculate points for this wave
    let waveRaw = 0;
    const stage = stageForScore(gameState.score);
    const featured = STAGE_THEMES[Math.min(stage, STAGE_THEMES.length - 1)].featured;

    for (const { r, c } of step.matches) {
      const type = gameState.board[r][c];
      if (type !== null) {
        waveRaw += gameState.gemValues[type];
        gameState.gemMatchCounts[type]++;

        if (featured === type) {
          waveRaw += 50;
        }
      }
    }

    const cascadeFactor = stepIdx === 0 ? 1 : 2;
    const waveScore = Math.floor(waveRaw * cascadeFactor * gameState.multiplier);
    totalWaveScore += waveScore;

    const currentLongestRun = longestRun(gameState.board);
    const newMultiplier = matchMultiplier(gameState.multiplier, currentLongestRun);
    gameState.multiplier = newMultiplier;

    // Animate clear
    animateMatches(step.matches);
    await new Promise(r => setTimeout(r, CLEAR_DURATION));

    gameState.board = step.board;
    await animateDrop();
    renderBoard();
  }

  gameState.board = settledBoard;
  gameState.lastGain = totalWaveScore;
  gameState.lastBonus = totalBonus;
  gameState.score += totalWaveScore;

  if (gameState.score > gameState.bestScore) {
    gameState.bestScore = gameState.score;
    localStorage.setItem('bestScore', gameState.bestScore.toString());
  }

  showScorePopup(totalWaveScore, totalBonus);
  renderBoard();

  if (!hasValidMove(gameState.board)) {
    gameState.gameOver = true;
    document.querySelector('#game-over').style.display = 'flex';
    document.querySelector('#final-score').textContent = gameState.score;
    document.querySelector('#new-game-top').style.display = 'none';
  }

  if (gameState.hint) {
    const hintPair = gameState.hint;
    if (!((hintPair[0].r === a.r && hintPair[0].c === a.c && hintPair[1].r === b.r && hintPair[1].c === b.c) ||
          (hintPair[1].r === a.r && hintPair[1].c === a.c && hintPair[0].r === b.r && hintPair[0].c === b.c))) {
      gameState.lastBonus = 100;
      gameState.score += 100;
      gameState.lastGain += 100;
      if (gameState.score > gameState.bestScore) {
        gameState.bestScore = gameState.score;
        localStorage.setItem('bestScore', gameState.bestScore.toString());
      }
      showScorePopup(gameState.lastGain, 100);
    }
  }

  gameState.hint = null;
  gameState.animating = false;
  resetIdleTimer();
}

function animateMatches(matches) {
  const board = document.querySelector('#board');
  for (const { r, c } of matches) {
    const cell = getCellElement({ r, c });
    if (cell) {
      cell.classList.add('matched');
      setTimeout(() => cell.classList.remove('matched'), CLEAR_DURATION);
    }
  }
}

async function animateDrop() {
  const board = document.querySelector('#board');

  return new Promise(resolve => {
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / DROP_DURATION, 1);
      const easeIn = progress * progress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };
    animate();
  });
}

function showScorePopup(gain, bonus) {
  const popup = document.querySelector('#score-popup');
  const display = bonus > 0 ? `+${gain - bonus} (+${bonus})` : `+${gain}`;
  popup.textContent = display;
  popup.classList.add('show');
  popup.style.opacity = '1';

  setTimeout(() => {
    popup.classList.remove('show');
    popup.style.opacity = '0';
  }, FLOAT_DURATION);
}

function renderBoard() {
  const board = document.querySelector('#board');
  board.innerHTML = '';

  const stage = stageForScore(gameState.score);
  const theme = STAGE_THEMES[Math.min(stage, STAGE_THEMES.length - 1)];
  board.style.background = theme.backdrop;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const type = gameState.board[r][c];
      if (type !== null) {
        const cell = createGemElement(type);
        cell.style.gridColumn = c + 1;
        cell.style.gridRow = r + 1;
        board.appendChild(cell);
      }
    }
  }

  document.querySelector('#score').textContent = gameState.score;
  document.querySelector('#best-score').textContent = gameState.bestScore;
  document.querySelector('#stage').textContent = `Stage ${stage}`;
  document.querySelector('#stage-name').textContent = theme.name;
}

function createGemElement(type) {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'cell');
  div.className = `gem gem-${GEM_COLORS[type].name}`;
  div.style.background = `hsl(${GEM_COLORS[type].hue}, 70%, 50%)`;

  const facet = document.createElement('div');
  facet.className = 'gem-facet';
  div.appendChild(facet);

  const highlight = document.createElement('div');
  highlight.className = 'gem-highlight';
  div.appendChild(highlight);

  return div;
}

function resetIdleTimer() {
  if (gameState.idleTimer) clearTimeout(gameState.idleTimer);
  gameState.hint = null;

  if (!gameState.gameOver && !gameState.animating) {
    gameState.idleTimer = setTimeout(() => {
      if (!gameState.animating && !gameState.gameOver) {
        const validMove = findValidMove();
        if (validMove) {
          gameState.hint = validMove;
          showHint(validMove);
        }
      }
    }, IDLE_HINT_DELAY);
  }
}

function findValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(gameState.board, { r, c }, { r, c: c + 1 })) {
        return [{ r, c }, { r, c: c + 1 }];
      }
      if (r + 1 < ROWS && isValidSwap(gameState.board, { r, c }, { r: r + 1, c })) {
        return [{ r, c }, { r: r + 1, c }];
      }
    }
  }
  return null;
}

function showHint(move) {
  const cell = getCellElement(move[0]);
  if (cell) {
    cell.classList.add('hint');
  }
}

// Expose test hooks
window.__test = {
  score: () => gameState.score,
  lastGain: () => gameState.lastGain,
  lastBonus: () => gameState.lastBonus,
  multiplier: () => gameState.multiplier,
  gemValues: () => gameState.gemValues,
  stage: () => stageForScore(gameState.score),
  featuredType: () => {
    const stage = stageForScore(gameState.score);
    return STAGE_THEMES[Math.min(stage, STAGE_THEMES.length - 1)].featured;
  },
  bestScore: () => gameState.bestScore,
  validMove: () => findValidMove(),
  board: () => gameState.board,
  gameOver: () => gameState.gameOver,
  hint: () => gameState.hint,
};
