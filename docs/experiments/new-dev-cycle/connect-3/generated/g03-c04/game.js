// Match-3 game logic module

/**
 * Creates a full board with no matches and at least one valid move
 */
export function createBoard(rows, cols, types, rng) {
  while (true) {
    const board = generateRandomBoard(rows, cols, types, rng);
    if (findMatches(board).length === 0 && hasValidMove(board)) {
      return board;
    }
  }
}

function generateRandomBoard(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => Math.floor(rng() * types))
  );
  return board;
}

/**
 * Finds all cells that are part of a horizontal or vertical run of 3+
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0]?.length || 0;
  const matched = new Set();

  // Check horizontal matches
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = board[r][c];
      let runLength = 1;

      // Look right to find run length
      while (c + runLength < cols && board[r][c + runLength] === val) {
        runLength++;
      }

      if (runLength >= 3) {
        for (let i = 0; i < runLength; i++) {
          matched.add(JSON.stringify({ r, c: c + i }));
        }
      }
    }
  }

  // Check vertical matches
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const val = board[r][c];
      let runLength = 1;

      // Look down to find run length
      while (r + runLength < rows && board[r + runLength][c] === val) {
        runLength++;
      }

      if (runLength >= 3) {
        for (let i = 0; i < runLength; i++) {
          matched.add(JSON.stringify({ r: r + i, c }));
        }
      }
    }
  }

  // Convert set back to array of objects
  return Array.from(matched, (s) => JSON.parse(s));
}

/**
 * Checks if two cells are orthogonally adjacent and swapping them creates a match
 */
export function isValidSwap(board, a, b) {
  // Check adjacency
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  const adjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);

  if (!adjacent) return false;

  // Check if swap creates a match
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * Checks if there exists at least one valid move (no deadlock)
 */
export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0]?.length || 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const current = { r, c };

      // Check right neighbor
      if (c + 1 < cols && isValidSwap(board, current, { r, c: c + 1 })) {
        return true;
      }

      // Check down neighbor
      if (r + 1 < rows && isValidSwap(board, current, { r: r + 1, c })) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Swaps two cells and returns a new board (pure function, no validation)
 */
export function applySwap(board, a, b) {
  const newBoard = board.map((row) => [...row]);
  const temp = newBoard[a.r][a.c];
  newBoard[a.r][a.c] = newBoard[b.r][b.c];
  newBoard[b.r][b.c] = temp;
  return newBoard;
}

/**
 * Repeatedly clears matches, applies gravity, and refills until settled
 * Returns {board, steps} where steps is an array of {matches, board} for each wave
 */
export function collapse(board, rng, types) {
  let currentBoard = board.map((row) => [...row]);
  const steps = [];

  while (true) {
    const matches = findMatches(currentBoard);
    if (matches.length === 0) break;

    // Clear matched cells
    const clearedBoard = currentBoard.map((row) => [...row]);
    const matchSet = new Set(matches.map((m) => JSON.stringify(m)));
    for (let r = 0; r < clearedBoard.length; r++) {
      for (let c = 0; c < clearedBoard[r].length; c++) {
        if (matchSet.has(JSON.stringify({ r, c }))) {
          clearedBoard[r][c] = null;
        }
      }
    }

    // Apply gravity
    const gravityBoard = applyGravity(clearedBoard);

    // Refill empty cells from top
    currentBoard = refill(gravityBoard, rng, types);

    // Record step
    steps.push({ matches, board: currentBoard.map((row) => [...row]) });
  }

  // Ensure final board has at least one valid move
  while (hasValidMove(currentBoard) === false) {
    currentBoard = shuffleBoard(currentBoard, rng);
  }

  return { board: currentBoard, steps };
}

function applyGravity(board) {
  const rows = board.length;
  const cols = board[0].length;
  const result = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (let c = 0; c < cols; c++) {
    let writeRow = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] !== null) {
        result[writeRow][c] = board[r][c];
        writeRow--;
      }
    }
  }

  return result;
}

function refill(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const result = board.map((row) => [...row]);

  for (let c = 0; c < cols; c++) {
    let fillRow = 0;
    for (let r = 0; r < rows; r++) {
      if (result[r][c] === null) {
        // Find a valid value that doesn't create a match
        let value;
        while (true) {
          value = Math.floor(rng() * types);
          result[r][c] = value;
          const matches = findMatches(result);
          if (!matches.some((m) => m.r === r && m.c === c)) {
            break;
          }
        }
      }
    }
  }

  return result;
}

function shuffleBoard(board, rng) {
  const rows = board.length;
  const cols = board[0].length;
  const result = board.map((row) => [...row]);

  // Randomly swap pairs until we find a valid move
  for (let attempts = 0; attempts < 1000; attempts++) {
    const r1 = Math.floor(rng() * rows);
    const c1 = Math.floor(rng() * cols);
    const r2 = Math.floor(rng() * rows);
    const c2 = Math.floor(rng() * cols);

    if (r1 === r2 && c1 === c2) continue;

    const temp = result[r1][c1];
    result[r1][c1] = result[r2][c2];
    result[r2][c2] = temp;

    if (hasValidMove(result)) {
      return result;
    }

    // Undo swap
    result[r1][c1] = temp;
    result[r2][c2] = result[r1][c1];
  }

  return result;
}

/**
 * Scores a single set of matched cells: 3 + n*(n-3)/2 for n >= 3
 */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 3 + (n * (n - 3)) / 2;
}

/**
 * Scores a cascade: first wave at face value, later waves doubled
 */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;

  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) {
    total += 2 * score(waves[i]);
  }

  return total;
}
