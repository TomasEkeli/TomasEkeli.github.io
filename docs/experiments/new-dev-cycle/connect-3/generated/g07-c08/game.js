// Pure game logic module - no side effects, deterministic with injected RNG
// Contract: https://github.com/...

export function createBoard(rows, cols, types, rng) {
  // Create a board with no matches and at least one valid move
  // Reshuffle internally until both conditions are met
  while (true) {
    const board = createRandomBoard(rows, cols, types, rng);
    if (findMatches(board).length === 0 && hasValidMove(board)) {
      return board;
    }
  }
}

function createRandomBoard(rows, cols, types, rng) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => Math.floor(rng() * types))
  );
}

export function findMatches(board) {
  if (!board.length || !board[0].length) return [];

  const rows = board.length;
  const cols = board[0].length;
  const matches = new Set();

  // Find horizontal matches
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = board[r][c];
      let runLen = 1;
      let lastC = c;

      while (lastC + 1 < cols && board[r][lastC + 1] === val) {
        runLen++;
        lastC++;
      }

      if (runLen >= 3) {
        for (let i = c; i <= lastC; i++) {
          matches.add(`${r},${i}`);
        }
        c = lastC; // Skip past this run
      }
    }
  }

  // Find vertical matches
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const val = board[r][c];
      let runLen = 1;
      let lastR = r;

      while (lastR + 1 < rows && board[lastR + 1][c] === val) {
        runLen++;
        lastR++;
      }

      if (runLen >= 3) {
        for (let i = r; i <= lastR; i++) {
          matches.add(`${i},${c}`);
        }
        r = lastR; // Skip past this run
      }
    }
  }

  // Convert to array of {r, c} objects
  return Array.from(matches).map(str => {
    const [r, c] = str.split(',').map(Number);
    return { r, c };
  });
}

export function isValidSwap(board, a, b) {
  // Adjacent cells only
  const dist = Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  if (dist !== 1) return false;

  // Check if swap creates at least one match
  const swapped = applySwap(board, a, b);
  const matches = findMatches(swapped);
  return matches.length > 0;
}

export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0].length;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Check right
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) {
        return true;
      }
      // Check down
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) {
        return true;
      }
    }
  }
  return false;
}

export function applySwap(board, a, b) {
  // Create a new board with cells a and b swapped
  const newBoard = board.map(row => [...row]);
  [newBoard[a.r][a.c], newBoard[b.r][b.c]] = [newBoard[b.r][b.c], newBoard[a.r][a.c]];
  return newBoard;
}

export function collapse(board, rng, types) {
  // Repeatedly clear matches, drop, refill until stable
  // Returns { board, steps } where steps is ordered cascade waves
  let currentBoard = board.map(row => [...row]);
  const steps = [];

  while (true) {
    const matches = findMatches(currentBoard);
    if (matches.length === 0) break;

    // Clear matched cells
    const clearedBoard = currentBoard.map(row => [...row]);
    for (const { r, c } of matches) {
      clearedBoard[r][c] = -1; // Mark as empty
    }

    // Drop (gravity)
    const droppedBoard = applyGravity(clearedBoard);

    // Refill empty cells from top with colors that don't create matches
    const filledBoard = refillBoard(droppedBoard, rng, types);

    // Record this wave
    steps.push({
      matches,
      board: filledBoard,
    });

    currentBoard = filledBoard;
  }

  return { board: currentBoard, steps };
}

function applyGravity(board) {
  const rows = board.length;
  const cols = board[0].length;
  const result = Array.from({ length: rows }, () => Array.from({ length: cols }, () => -1));

  // For each column, drop non-empty cells to the bottom
  for (let c = 0; c < cols; c++) {
    let writePos = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] !== -1) {
        result[writePos][c] = board[r][c];
        writePos--;
      }
    }
  }

  return result;
}

function refillBoard(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const result = board.map(row => [...row]);

  // Fill empty cells (-1) from the top
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (result[r][c] === -1) {
        // Find a color that doesn't create a match
        let color;
        let attempts = 0;
        do {
          color = Math.floor(rng() * types);
          attempts++;
        } while (attempts < 100 && wouldCreateMatch(result, r, c, color));

        result[r][c] = color;
      }
    }
  }

  return result;
}

function wouldCreateMatch(board, r, c, color) {
  // Temporarily place color and check if it creates a match
  const original = board[r][c];
  board[r][c] = color;

  // Check if this position is part of any 3-run
  let hasMatch = false;

  // Check horizontal
  let left = c;
  while (left > 0 && board[r][left - 1] === color) left--;
  let right = c;
  while (right < board[0].length - 1 && board[r][right + 1] === color) right++;
  if (right - left + 1 >= 3) hasMatch = true;

  // Check vertical
  let up = r;
  while (up > 0 && board[up - 1][c] === color) up--;
  let down = r;
  while (down < board.length - 1 && board[down + 1][c] === color) down++;
  if (down - up + 1 >= 3) hasMatch = true;

  board[r][c] = original;
  return hasMatch;
}

export function longestRun(board) {
  if (!board.length || !board[0].length) return 0;

  let maxRun = 1;
  const rows = board.length;
  const cols = board[0].length;

  // Check horizontal runs
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let run = 1;
      while (c + 1 < cols && board[r][c + 1] === board[r][c]) {
        run++;
        c++;
      }
      maxRun = Math.max(maxRun, run);
    }
  }

  // Check vertical runs
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let run = 1;
      while (r + 1 < rows && board[r + 1][c] === board[r][c]) {
        run++;
        r++;
      }
      maxRun = Math.max(maxRun, run);
    }
  }

  return maxRun;
}

export function matchMultiplier(prev, longestRunLen) {
  // L < 4: halve the multiplier (floored at 1)
  // L >= 4: multiply by 2^(L-3)
  if (longestRunLen < 4) {
    return Math.max(1, Math.floor(Math.max(prev, 1) / 2));
  } else {
    return Math.max(prev, 1) * (2 ** (longestRunLen - 3));
  }
}

export function stageForScore(score) {
  return Math.floor(score / 100000);
}
