// game.js — pure logic module for the match-3 game.
// Board = rows x cols array of arrays of integers in [0, types).
// Cell = { r, c }. rng = () => float in [0, 1).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * findMatches(board) -> Array<{r, c}>
 * Every cell that is part of any horizontal or vertical run of length >= 3.
 * Each cell appears at most once.
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const matched = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) matched.add(`${r},${k}`);
        }
        runStart = c;
      }
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] === board[runStart][c];
      if (!same) {
        const runLen = r - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < r; k++) matched.add(`${k},${c}`);
        }
        runStart = r;
      }
    }
  }

  return [...matched].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

/**
 * isValidSwap(board, a, b) -> boolean
 */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * hasValidMove(board) -> boolean
 */
export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/**
 * applySwap(board, a, b) -> board (new board, does not mutate, does not validate)
 */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/**
 * createBoard(rows, cols, types, rng) -> board
 * Full board, no matches, at least one valid move. Reshuffle until both hold.
 */
export function createBoard(rows, cols, types, rng) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        // Pick a value that doesn't create an immediate match with cells
        // already placed (left / up), to keep this fast and mostly match-free
        // without needing a post-hoc scan-and-fix loop.
        let value;
        let attempts = 0;
        do {
          value = Math.floor(rng() * types);
          attempts++;
        } while (
          attempts < 50 &&
          ((c >= 2 && row[c - 1] === value && row[c - 2] === value) ||
            (r >= 2 && board[r - 1][c] === value && board[r - 2][c] === value))
        );
        row.push(value);
      }
      board.push(row);
    }

    if (findMatches(board).length === 0 && hasValidMove(board)) {
      return board;
    }
    // Otherwise loop and try a fresh board.
  }
}

/**
 * collapse(board, rng, types) -> { board, steps }
 */
export function collapse(board, rng, types) {
  const effectiveTypes = types ?? (Math.max(0, ...board.flat()) + 1);
  const steps = [];
  let current = cloneBoard(board);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const rows = current.length;
    const cols = current[0].length;
    const cleared = cloneBoard(current);
    for (const { r, c } of matches) {
      cleared[r][c] = null;
    }

    // Apply gravity: for each column, compact non-null values downward,
    // then fill remaining top cells with new random values that don't
    // create an immediate match with already-settled neighbours.
    const next = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
      }
      // Place survivors at the bottom of the column.
      let writeRow = rows - 1;
      for (let i = survivors.length - 1; i >= 0; i--) {
        next[writeRow][c] = survivors[i];
        writeRow--;
      }
      // Fill remaining cells above with refills that avoid creating matches.
      for (let r = writeRow; r >= 0; r--) {
        let value;
        let attempts = 0;
        do {
          value = Math.floor(rng() * effectiveTypes);
          attempts++;
        } while (
          attempts < 50 &&
          ((r + 1 < rows && r + 2 < rows && next[r + 1][c] === value && next[r + 2][c] === value) ||
            (c >= 2 && next[r][c - 1] === value && next[r][c - 2] === value))
        );
        next[r][c] = value;
      }
    }

    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  // No-deadlock guarantee: reshuffle the final board only, never steps.
  let finalBoard = current;
  if (!hasValidMove(finalBoard)) {
    finalBoard = reshuffleUntilPlayable(finalBoard, rng, effectiveTypes);
  }

  return { board: finalBoard, steps };
}

function reshuffleUntilPlayable(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  let candidate = cloneBoard(board);
  let attempts = 0;
  while (
    (findMatches(candidate).length > 0 || !hasValidMove(candidate)) &&
    attempts < 200
  ) {
    // Fisher-Yates shuffle the flat values, then retry.
    const flat = candidate.flat();
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    candidate = [];
    for (let r = 0; r < rows; r++) {
      candidate.push(flat.slice(r * cols, r * cols + cols));
    }
    attempts++;
  }
  if (findMatches(candidate).length > 0 || !hasValidMove(candidate)) {
    // Fallback: generate a brand-new clean, playable board.
    candidate = createBoard(rows, cols, types, rng);
  }
  return candidate;
}

/**
 * score(matches) -> number
 * n = matches.length; n < 3 ? 0 : 3 + n*(n-3)/2
 */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 3 + (n * (n - 3)) / 2;
}

/**
 * scoreCascade(waves) -> number
 * First wave face value; every later wave doubled.
 */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) {
    total += 2 * score(waves[i]);
  }
  return total;
}
