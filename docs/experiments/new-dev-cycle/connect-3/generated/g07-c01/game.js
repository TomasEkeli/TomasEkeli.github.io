// Pure game logic for the Midnight Tempest match-3 candidate.
// No Math.random anywhere in this file — rng is always injected.

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function areAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * Pick a value for cell (r,c) of `grid` that does not complete a run of 3
 * with the two cells above it or the two cells to its left (both of which
 * must already be settled at call time). Falls back to any colour if every
 * colour would form a run (can't happen with >=2 types, but stay safe).
 */
function pickNonMatchingValue(grid, r, c, types, rng) {
  const exclude = new Set();
  if (r >= 2 && grid[r - 1][c] != null && grid[r - 1][c] === grid[r - 2][c]) {
    exclude.add(grid[r - 1][c]);
  }
  if (c >= 2 && grid[r][c - 1] != null && grid[r][c - 1] === grid[r][c - 2]) {
    exclude.add(grid[r][c - 1]);
  }
  const options = [];
  for (let t = 0; t < types; t++) if (!exclude.has(t)) options.push(t);
  const pool = options.length ? options : Array.from({ length: types }, (_, i) => i);
  let idx = Math.floor(rng() * pool.length);
  if (idx >= pool.length) idx = pool.length - 1;
  if (idx < 0) idx = 0;
  return pool[idx];
}

function buildNoMatchBoard(rows, cols, types, rng) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c] = pickNonMatchingValue(grid, r, c, types, rng);
    }
  }
  return grid;
}

export function createBoard(rows, cols, types, rng) {
  let board = buildNoMatchBoard(rows, cols, types, rng);
  let tries = 0;
  while (!hasValidMove(board) && tries < 500) {
    board = buildNoMatchBoard(rows, cols, types, rng);
    tries++;
  }
  return board;
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const matched = new Set();

  // horizontal runs
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

  // vertical runs
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

  return [...matched].map((s) => {
    const [r, c] = s.split(',').map(Number);
    return { r, c };
  });
}

export function isValidSwap(board, a, b) {
  if (!areAdjacent(a, b)) return false;
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function hasValidMove(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function applyGravity(grid) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (grid[r][c] !== null) survivors.push(grid[r][c]);
    }
    const missing = rows - survivors.length;
    for (let r = 0; r < rows; r++) {
      grid[r][c] = r < missing ? null : survivors[r - missing];
    }
  }
}

function refill(grid, types, rng) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (grid[r][c] === null) {
        grid[r][c] = pickNonMatchingValue(grid, r, c, types, rng);
      }
    }
  }
}

export function collapse(board, rng, types) {
  const resolvedTypes = typeof types === 'number'
    ? types
    : Math.max(...board.flat()) + 1;
  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const next = cloneBoard(current);
    for (const { r, c } of matches) next[r][c] = null;
    applyGravity(next);
    refill(next, resolvedTypes, rng);

    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  return { board: current, steps };
}

export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  if (cols === 0) return 0;

  let max = 1;
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > max) max = run;
    }
  }
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > max) max = run;
    }
  }
  return max;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * (2 ** (longestRunLen - 3));
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
