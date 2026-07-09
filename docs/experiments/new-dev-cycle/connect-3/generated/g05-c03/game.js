// Pure, deterministic match-3 logic. No DOM, no globals, no Math.random —
// every source of randomness is the injected `rng()` (float in [0, 1)).

const EMPTY = -1;

function inBounds(rows, cols, r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/** Every cell that is part of a horizontal or vertical run of length >= 3. */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const marked = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      let c2 = c + 1;
      while (c2 < cols && board[r][c2] === board[r][c]) c2++;
      if (c2 - c >= 3) {
        for (let k = c; k < c2; k++) marked[r][k] = true;
      }
      c = c2;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      let r2 = r + 1;
      while (r2 < rows && board[r2][c] === board[r][c]) r2++;
      if (r2 - r >= 3) {
        for (let k = r; k < r2; k++) marked[k][c] = true;
      }
      r = r2;
    }
  }

  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (marked[r][c]) out.push({ r, c });
    }
  }
  return out;
}

/** A new board with the values at `a` and `b` exchanged. Pure. */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/** true iff a/b are orthogonally adjacent and swapping them yields >= 1 match. */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/** true iff some orthogonally-adjacent swap would create at least one match. */
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

/** Points for one wave of matched cells. */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

/** Total points for a full move: first wave face value, later waves doubled. */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}

// --- Refill helpers -------------------------------------------------------

// Does placing value `v` at (r, c) create an immediate run of 3, given only
// the neighbours that are already determined (non-EMPTY)? EMPTY (-1) never
// equals a real type (0..types-1), so undetermined neighbours never trigger
// a false positive here.
function conflicts(board, r, c, v, rows, cols) {
  if (c >= 2 && board[r][c - 1] === v && board[r][c - 2] === v) return true;
  if (c >= 1 && c + 1 < cols && board[r][c - 1] === v && board[r][c + 1] === v) return true;
  if (c + 2 < cols && board[r][c + 1] === v && board[r][c + 2] === v) return true;
  if (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v) return true;
  if (r >= 1 && r + 1 < rows && board[r - 1][c] === v && board[r + 1][c] === v) return true;
  if (r + 2 < rows && board[r + 1][c] === v && board[r + 2][c] === v) return true;
  return false;
}

function pickValue(board, r, c, rows, cols, types, rng) {
  let v = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    v = Math.floor(rng() * types);
    if (v >= types) v = types - 1; // guard float edge case
    if (!conflicts(board, r, c, v, rows, cols)) return v;
  }
  return v;
}

/**
 * Repeatedly clear matches, drop survivors, refill from the top, until the
 * board is full and match-free. Returns { board, steps } where steps is the
 * ordered list of clear iterations ({ matches, board } per wave).
 */
export function collapse(board, rng, types) {
  let current = cloneBoard(board);
  const rows = current.length;
  const cols = current[0].length;
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const next = cloneBoard(current);
    for (const { r, c } of matches) next[r][c] = EMPTY;

    // Gravity: compact survivors to the bottom of each column.
    for (let c = 0; c < cols; c++) {
      const vals = [];
      for (let r = 0; r < rows; r++) {
        if (next[r][c] !== EMPTY) vals.push(next[r][c]);
      }
      const gap = rows - vals.length;
      for (let r = 0; r < rows; r++) {
        next[r][c] = r < gap ? EMPTY : vals[r - gap];
      }
    }

    // Refill empties from the top, avoiding creating new matches.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (next[r][c] === EMPTY) {
          next[r][c] = pickValue(next, r, c, rows, cols, types, rng);
        }
      }
    }

    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  return { board: current, steps };
}

// Only left (already-filled, since we scan left-to-right) and up neighbours
// exist when building a board from scratch cell by cell.
function initialConflicts(board, r, c, v) {
  if (c >= 2 && board[r][c - 1] === v && board[r][c - 2] === v) return true;
  if (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v) return true;
  return false;
}

/**
 * A full rows x cols board with no matches and at least one valid move.
 * Reshuffles internally until both hold (a starting board is never a
 * deadlock).
 */
export function createBoard(rows, cols, types, rng) {
  function buildOnce() {
    const b = Array.from({ length: rows }, () => new Array(cols).fill(EMPTY));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let v = 0;
        for (let attempt = 0; attempt < 50; attempt++) {
          v = Math.floor(rng() * types);
          if (v >= types) v = types - 1;
          if (!initialConflicts(b, r, c, v)) break;
        }
        b[r][c] = v;
      }
    }
    return b;
  }

  let board = buildOnce();
  let tries = 0;
  while (!hasValidMove(board) && tries < 500) {
    board = buildOnce();
    tries++;
  }
  return board;
}
