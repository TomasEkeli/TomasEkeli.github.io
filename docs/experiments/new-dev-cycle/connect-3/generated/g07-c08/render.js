import * as game from './game.js';

// Seeded RNG (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gem colors and shapes
const GEM_TYPES = {
  0: { name: 'Ruby', color: '#E63946', rgb: [230, 57, 70], symbol: '◆' },
  1: { name: 'Emerald', color: '#06A77D', rgb: [6, 168, 125], symbol: '●' },
  2: { name: 'Sapphire', color: '#1B9FDB', rgb: [27, 159, 219], symbol: '■' },
  3: { name: 'Topaz', color: '#FFD60A', rgb: [255, 214, 10], symbol: '★' },
  4: { name: 'Amethyst', color: '#B5179E', rgb: [181, 23, 158], symbol: '●' },
  5: { name: 'Citrine', color: '#FF9F1C', rgb: [255, 159, 28], symbol: '◆' },
};

// Stage themes (day progression through wildflower meadow)
const STAGES = [
  { name: 'Dawn', sky: 'linear-gradient(to bottom, #FFE5B4 0%, #87CEEB 50%, #E0F6FF 100%)', featured: null },
  { name: 'Midday', sky: 'linear-gradient(to bottom, #87CEEB 0%, #E0F6FF 100%)', featured: 1 }, // Emerald
  { name: 'Golden Hour', sky: 'linear-gradient(to bottom, #FFA500 0%, #FFD700 50%, #FF6B6B 100%)', featured: 5 }, // Citrine
  { name: 'Dusk', sky: 'linear-gradient(to bottom, #663399 0%, #4B0082 50%, #1a1a2e 100%)', featured: 4 }, // Amethyst
  { name: 'Night', sky: 'linear-gradient(to bottom, #1a1a2e 0%, #16213e 100%)', featured: 2 }, // Sapphire
];

export async function initGame(container) {
  const ROWS = 8, COLS = 8, TYPES = 6;

  // State
  let board = game.createBoard(ROWS, COLS, TYPES, mulberry32(Date.now()));
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('bestScore') || '0');
  let multiplier = 1;
  let gameOver = false;
  let lastGain = 0;
  let lastBonus = 0;
  let animating = false;
  let lastMoveTime = Date.now();
  let hintShowing = false;
  let hintPair = null;
  let gemMatchCounts = Array(TYPES).fill(0); // For scaling values

  // Gem value functions - reference schemes with stage bonuses
  const getGemValue = (type, count) => {
    const stage = game.stageForScore(score);
    const featured = STAGES[Math.min(stage, STAGES.length - 1)].featured;
    const baseBonus = featured === type ? 50 : 0;

    switch (type) {
      case 0: // Ruby - cheap exponential (5*2^count, capped)
        return (5 * Math.pow(2, Math.min(gemMatchCounts[type], 5))) + baseBonus;
      case 1: // Emerald - flat 50
        return 50 + baseBonus;
      case 2: // Sapphire - linear growth (+5/match)
        return (10 + 5 * gemMatchCounts[type]) + baseBonus;
      case 3: // Topaz - rarity based (400/count-on-board)
        return Math.max(40, Math.floor(400 / Math.max(count, 1))) + baseBonus;
      case 4: // Amethyst - flat 15
        return 15 + baseBonus;
      case 5: // Citrine - stage-scaled (8*(1+stage))
        return (8 * (1 + stage)) + baseBonus;
    }
  };

  // DOM setup
  const boardDiv = document.createElement('div');
  boardDiv.id = 'board';
  boardDiv.style.cssText = `
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    gap: 0;
    width: 100%;
    aspect-ratio: 1;
    max-width: 500px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    padding: 2px;
  `;

  const scoreDiv = document.createElement('div');
  scoreDiv.style.cssText = `
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 20px;
    color: white;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
  `;

  const bestScoreDiv = document.createElement('div');
  bestScoreDiv.style.cssText = `
    font-size: 14px;
    color: #ddd;
    margin-bottom: 10px;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
  `;

  const stageDiv = document.createElement('div');
  stageDiv.style.cssText = `
    font-size: 12px;
    color: #aaa;
    margin-bottom: 10px;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
    min-height: 20px;
  `;

  const newGameBtn = document.createElement('button');
  newGameBtn.textContent = 'New Game';
  newGameBtn.setAttribute('data-testid', 'new-game');
  newGameBtn.style.cssText = `
    padding: 10px 20px;
    font-size: 16px;
    margin-bottom: 20px;
    background: linear-gradient(to bottom, #FFD700, #FFA500);
    border: 2px solid #FF8C00;
    border-radius: 8px;
    cursor: pointer;
    font-weight: bold;
    color: #333;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    transition: transform 0.1s;
  `;
  newGameBtn.addEventListener('click', () => resetGame());

  const gameOverDiv = document.createElement('div');
  gameOverDiv.style.cssText = `
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 40px;
    border-radius: 12px;
    text-align: center;
    z-index: 1000;
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.8);
  `;
  gameOverDiv.innerHTML = `
    <h2 style="font-size: 32px; margin-bottom: 20px;">Game Over!</h2>
    <p style="font-size: 18px; margin-bottom: 20px;">Final Score: <span id="final-score">0</span></p>
  `;

  const floatingScoreContainer = document.createElement('div');
  floatingScoreContainer.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 999;
  `;

  const stageFlashDiv = document.createElement('div');
  stageFlashDiv.style.cssText = `
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 48px;
    font-weight: bold;
    color: white;
    text-shadow: 0 0 20px rgba(0, 0, 0, 0.8), 2px 2px 4px rgba(0, 0, 0, 0.8);
    z-index: 998;
    pointer-events: none;
  `;

  container.appendChild(bestScoreDiv);
  container.appendChild(stageDiv);
  container.appendChild(scoreDiv);
  container.appendChild(newGameBtn);
  container.appendChild(boardDiv);
  container.appendChild(gameOverDiv);
  container.appendChild(floatingScoreContainer);
  container.appendChild(stageFlashDiv);

  // Initialize cells
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.setAttribute('data-testid', 'cell');
      cell.style.cssText = `
        position: relative;
        aspect-ratio: 1;
        cursor: grab;
        user-select: none;
      `;
      cell.dataset.r = r;
      cell.dataset.c = c;
      boardDiv.appendChild(cell);
      cells.push({ elem: cell, r, c });
    }
  }

  // Update UI
  function updateStage() {
    const stage = game.stageForScore(score);
    const stageData = STAGES[Math.min(stage, STAGES.length - 1)];
    document.body.style.background = stageData.sky;
    stageDiv.textContent = `Stage ${stage}: ${stageData.name}`;
  }

  function updateScore() {
    scoreDiv.innerHTML = `Score: <strong>${score}</strong>`;
    bestScoreDiv.textContent = `Best: ${bestScore}`;
  }

  function showGem(cell, type) {
    cell.innerHTML = '';
    const gem = document.createElement('div');
    gem.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 60px;
      font-weight: bold;
      color: ${GEM_TYPES[type].color};
      text-shadow: 0 0 10px rgba(0, 0, 0, 0.3), inset 0 -2px 4px rgba(0, 0, 0, 0.2);
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2)) drop-shadow(inset 0 2px 4px rgba(255, 255, 255, 0.3));
      position: relative;
      animation: gemPulse 0.3s ease-out;
    `;
    gem.textContent = GEM_TYPES[type].symbol;

    // Add shine effect
    const shine = document.createElement('div');
    shine.style.cssText = `
      position: absolute;
      top: 20%;
      left: 20%;
      width: 40%;
      height: 40%;
      background: radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 70%);
      border-radius: 50%;
      filter: blur(2px);
    `;
    gem.appendChild(shine);

    cell.appendChild(gem);

    // Subtle idle animation
    if (!animating) {
      gem.style.animation = `gemFloat 3s ease-in-out infinite`;
    }
  }

  function renderBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = cells[r * COLS + c].elem;
        showGem(cell, board[r][c]);
      }
    }
  }

  function showFloatingScore(gain, bonus, x, y) {
    const floatDiv = document.createElement('div');
    floatDiv.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      font-size: 32px;
      font-weight: bold;
      color: #FFD700;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
      pointer-events: none;
      z-index: 999;
      animation: floatUp 1.5s ease-out forwards;
    `;
    floatDiv.textContent = `+${gain}`;

    if (bonus > 0) {
      const bonusDiv = document.createElement('div');
      bonusDiv.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y + 40}px;
        font-size: 18px;
        font-weight: bold;
        color: #FF6B6B;
        text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.8);
        pointer-events: none;
        animation: floatUp 1.5s ease-out forwards;
      `;
      bonusDiv.textContent = `+${bonus} bonus`;
      floatingScoreContainer.appendChild(bonusDiv);
    }

    floatingScoreContainer.appendChild(floatDiv);
    setTimeout(() => floatDiv.remove(), 1500);
    if (bonus > 0) setTimeout(() => floatingScoreContainer.lastChild?.remove?.(), 1500);
  }

  function showStageTransition(stage) {
    const stageData = STAGES[Math.min(stage, STAGES.length - 1)];
    stageFlashDiv.innerHTML = `Stage ${stage}<br>${stageData.name}`;
    stageFlashDiv.style.display = 'block';
    stageFlashDiv.style.animation = 'none';
    setTimeout(() => {
      stageFlashDiv.style.animation = 'stageFlash 2s ease-out forwards';
    }, 10);
    setTimeout(() => {
      stageFlashDiv.style.display = 'none';
    }, 2000);
  }

  async function performMove(a, b) {
    if (animating || gameOver) return;

    // Check if valid
    if (!game.isValidSwap(board, a, b)) {
      return;
    }

    animating = true;
    lastMoveTime = Date.now();
    hintShowing = false;
    hintPair = null;
    clearAllHints();

    // Apply swap
    board = game.applySwap(board, a, b);
    renderBoard();

    // Get collapse steps
    const rng = mulberry32(Math.random() * 1e9);
    const { board: settled, steps } = game.collapse(board, rng, TYPES);

    // Animate each step
    let totalGain = 0;
    let stageChanged = false;
    const oldStage = game.stageForScore(score);
    let boardBeforeCollapse = board.map(row => [...row]);

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];

      // Show clear animation
      for (const { r, c } of step.matches) {
        const cell = cells[r * COLS + c].elem;
        cell.style.animation = 'gemClear 0.2s ease-out';
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Calculate score for this wave BEFORE updating board display
      const isCascade = stepIdx > 0 ? 2 : 1;
      let waveGain = 0;

      // Get the gem types that were matched from the pre-collapse board
      const matchedTypes = {};
      for (const { r, c } of step.matches) {
        const type = boardBeforeCollapse[r][c];
        matchedTypes[type] = (matchedTypes[type] || 0) + 1;
      }

      // Count colors on the board BEFORE this clear for rarity calculation
      const colorCounts = Array(TYPES).fill(0);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          colorCounts[boardBeforeCollapse[r][c]]++;
        }
      }

      // Calculate raw points from matched gems
      for (const { r, c } of step.matches) {
        const type = boardBeforeCollapse[r][c];
        waveGain += getGemValue(type, colorCounts[type]);
        gemMatchCounts[type]++;
      }

      waveGain *= isCascade;

      // Longest run multiplier - use the matched types to calculate
      const longest = game.longestRun(boardBeforeCollapse);
      multiplier = game.matchMultiplier(multiplier, longest);

      // Apply multiplier
      const gainThisWave = Math.floor(waveGain * multiplier);
      totalGain += gainThisWave;

      const newStage = game.stageForScore(score + gainThisWave);
      if (newStage > oldStage && !stageChanged) {
        stageChanged = true;
        showStageTransition(newStage);
      }

      // Update board after this cascade step
      board = step.board;
      boardBeforeCollapse = step.board.map(row => [...row]);
      renderBoard();

      // Drop animation
      await animateDrops(step.matches.length > 0 ? 0.4 : 0);
    }

    // Check for hint bonus
    let bonusEarned = 0;
    if (hintPair && (a.r !== hintPair.a.r || a.c !== hintPair.a.c || b.r !== hintPair.b.r || b.c !== hintPair.b.c)) {
      bonusEarned = 100;
    }

    score += totalGain;
    lastGain = totalGain;
    lastBonus = bonusEarned;
    score += bonusEarned;

    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('bestScore', bestScore);
    }

    updateScore();
    updateStage();

    // Show floating score
    const centerX = boardDiv.getBoundingClientRect().left + boardDiv.offsetWidth / 2;
    const centerY = boardDiv.getBoundingClientRect().top + boardDiv.offsetHeight / 2;
    showFloatingScore(totalGain + bonusEarned, bonusEarned, centerX, centerY);

    // Check game over
    if (!game.hasValidMove(board)) {
      gameOver = true;
      document.getElementById('final-score').textContent = score;
      gameOverDiv.style.display = 'block';
    }

    animating = false;
  }

  async function animateDrops(duration) {
    if (duration > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.max(200, duration)));
    }
  }

  // Gesture handling - decide move at release based on final position
  let dragging = false;
  let dragStart = null;

  document.addEventListener('pointerdown', (e) => {
    if (gameOver || animating) return;
    const cell = e.target.closest('[data-testid="cell"]');
    if (!cell) return;

    dragging = true;
    dragStart = {
      r: parseInt(cell.dataset.r),
      c: parseInt(cell.dataset.c),
      x: e.clientX,
      y: e.clientY,
    };

    e.target.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointerup', (e) => {
    if (!dragging || !dragStart) return;

    dragging = false;

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Decision: if released near origin (below threshold), no move
    if (dist < 25) {
      dragStart = null;
      return;
    }

    // Determine target cell based on final position
    const boardRect = boardDiv.getBoundingClientRect();
    const cellSize = boardDiv.offsetWidth / COLS;

    // Get the cell at the release position
    const relX = e.clientX - boardRect.left;
    const relY = e.clientY - boardRect.top;

    const targetC = Math.floor(relX / cellSize);
    const targetR = Math.floor(relY / cellSize);

    // Clamp to board bounds
    if (targetR >= 0 && targetR < ROWS && targetC >= 0 && targetC < COLS) {
      // Only perform move if it's adjacent
      const distR = Math.abs(targetR - dragStart.r);
      const distC = Math.abs(targetC - dragStart.c);
      if (distR + distC === 1) {
        performMove(dragStart, { r: targetR, c: targetC });
      }
    }

    dragStart = null;
  });

  // Idle hint system
  function clearAllHints() {
    for (let i = 0; i < cells.length; i++) {
      cells[i].elem.style.animation = 'none';
    }
  }

  async function showIdleHint() {
    if (gameOver || animating || hintShowing) return;

    const move = game.__test?.validMove?.();
    if (!move) {
      // Try to find one ourselves
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (c + 1 < COLS && game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
            hintPair = { a: { r, c }, b: { r, c: c + 1 } };
            break;
          }
          if (r + 1 < ROWS && game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
            hintPair = { a: { r, c }, b: { r: r + 1, c } };
            break;
          }
        }
        if (hintPair) break;
      }
    } else {
      hintPair = move;
    }

    if (hintPair) {
      hintShowing = true;
      const cell = cells[hintPair.a.r * COLS + hintPair.a.c].elem;
      cell.style.animation = 'hintPulse 0.6s ease-in-out infinite';
    }
  }

  setInterval(() => {
    if (!animating && !gameOver && !hintShowing && Date.now() - lastMoveTime > 10000) {
      showIdleHint();
    }
  }, 100);

  function resetGame() {
    board = game.createBoard(ROWS, COLS, TYPES, mulberry32(Date.now()));
    score = 0;
    multiplier = 1;
    gameOver = false;
    lastGain = 0;
    lastBonus = 0;
    hintShowing = false;
    hintPair = null;
    gemMatchCounts = Array(TYPES).fill(0);
    gameOverDiv.style.display = 'none';
    lastMoveTime = Date.now();
    renderBoard();
    updateScore();
    updateStage();
    clearAllHints();
  }

  // Observation hooks
  window.__test = {
    score: () => score,
    lastGain: () => lastGain,
    lastBonus: () => lastBonus,
    multiplier: () => multiplier,
    gemValues: () => {
      const colorCounts = Array(TYPES).fill(0);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          colorCounts[board[r][c]]++;
        }
      }
      return Array.from({ length: TYPES }, (_, type) => getGemValue(type, colorCounts[type]));
    },
    stage: () => game.stageForScore(score),
    featuredType: () => {
      const stage = game.stageForScore(score);
      return STAGES[Math.min(stage, STAGES.length - 1)].featured;
    },
    bestScore: () => bestScore,
    validMove: () => {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (c + 1 < COLS && game.isValidSwap(board, { r, c }, { r, c: c + 1 })) {
            return { a: { r, c }, b: { r, c: c + 1 } };
          }
          if (r + 1 < ROWS && game.isValidSwap(board, { r, c }, { r: r + 1, c })) {
            return { a: { r, c }, b: { r: r + 1, c } };
          }
        }
      }
      return null;
    },
    board: () => board.map(row => [...row]),
    gameOver: () => gameOver,
    hint: () => hintShowing ? hintPair : null,
  };

  // Initial render
  updateStage();
  renderBoard();
  updateScore();

  // Add CSS animations to document
  const style = document.createElement('style');
  style.textContent = `
    @keyframes gemPulse {
      0% { transform: scale(0.8); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes gemFloat {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-3px); }
    }
    @keyframes gemClear {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1) rotate(5deg); }
      100% { transform: scale(0.8); opacity: 0; }
    }
    @keyframes floatUp {
      0% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-60px); opacity: 0; }
    }
    @keyframes hintPulse {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.5); }
    }
    @keyframes stageFlash {
      0% { opacity: 1; transform: translate(-50%, -50%) scale(0.8); }
      50% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
    }
  `;
  document.head.appendChild(style);
}
