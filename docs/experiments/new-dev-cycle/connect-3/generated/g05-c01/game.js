// game.js — pure, deterministic match-3 logic. No DOM, no globals beyond
// what is passed in. `rng` is always an injected () => float in [0,1).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

/**
 * Every cell that is part of a horizontal or vertical run of length >= 3.
 * Each cell appears at most once even if it belongs to both a horizontal
 * and a vertical run.
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const marked = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const sameAsStart = c < cols && board[r][c] === board[r][runStart];
      if (sameAsStart) continue;
      const runLen = c - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < c; k++) marked[r][k] = true;
      }
      runStart = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const sameAsStart = r < rows && board[r][c] === board[runStart][c];
      if (sameAsStart) continue;
      const runLen = r - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < r; k++) marked[k][c] = true;
      }
      runStart = r;
    }
  }

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (marked[r][c]) cells.push({ r, c });
    }
  }
  return cells;
}

/** A new board with the values at a and b exchanged. Does not mutate input. */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return dr + dc === 1;
}

/** true iff a/b are orthogonally adjacent AND swapping them yields a match. */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/** true iff some orthogonally-adjacent swap on board would create a match. */
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
 * Choose a value for board[r][c] that avoids creating a run of 3+ with any
 * already-determined neighbour (cells still unset are `null` and ignored).
 * Used both for the initial fill (createBoard) and for refills (collapse) —
 * in both cases we fill in row-major (top-to-bottom, left-to-right) order,
 * so "already determined" neighbours are: left/above (always resolved by
 * that point) and right/below *only* when they happen to already hold a
 * fixed value (e.g. a gravity survivor placed ahead of time).
 */
function pickValue(board, r, c, types, rng) {
  const rows = board.length;
  const cols = board[0].length;
  const at = (rr, cc) => {
    if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return null;
    return board[rr][cc];
  };
  const forbidden = new Set();
  const forbidIfPair = (v1, v2) => {
    if (v1 != null && v2 != null && v1 === v2) forbidden.add(v1);
  };
  // Horizontal triples that would include (r, c).
  forbidIfPair(at(r, c - 2), at(r, c - 1));
  forbidIfPair(at(r, c - 1), at(r, c + 1));
  forbidIfPair(at(r, c + 1), at(r, c + 2));
  // Vertical triples that would include (r, c).
  forbidIfPair(at(r - 2, c), at(r - 1, c));
  forbidIfPair(at(r - 1, c), at(r + 1, c));
  forbidIfPair(at(r + 1, c), at(r + 2, c));

  const allowed = [];
  for (let t = 0; t < types; t++) if (!forbidden.has(t)) allowed.push(t);
  const pool = allowed.length ? allowed : Array.from({ length: types }, (_, i) => i);
  return pool[Math.floor(rng() * pool.length)] % types;
}

/**
 * A full board with no matches and at least one valid move. Reshuffles
 * internally (regenerates) until both hold — a starting board must never be
 * a deadlock.
 */
export function createBoard(rows, cols, types, rng) {
  let board;
  let guard = 0;
  do {
    board = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickValue(board, r, c, types, rng);
      }
    }
    guard++;
  } while (!hasValidMove(board) && guard < 200);
  return board;
}

/**
 * Repeatedly clears matches, drops survivors down, and refills from the top
 * until the board is full and match-free. Returns { board, steps }.
 */
export function collapse(board, rng, types) {
  const colourCount = types ?? (Math.max(0, ...board.flat()) + 1);
  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const rows = current.length;
    const cols = current[0].length;

    const cleared = cloneBoard(current);
    for (const { r, c } of matches) cleared[r][c] = null;

    // Gravity: compact survivors to the bottom of each column.
    const next = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (cleared[r][c] != null) survivors.push(cleared[r][c]);
      }
      const missing = rows - survivors.length;
      for (let i = 0; i < survivors.length; i++) {
        next[missing + i][c] = survivors[i];
      }
      // top `missing` cells of this column stay null for now, refilled below.
    }

    // Refill empties, top-to-bottom / left-to-right, avoiding new matches.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] == null) {
          next[r][c] = pickValue(next, r, c, colourCount, rng);
        }
      }
    }

    steps.push({ matches, board: next });
    current = next;
  }

  return { board: current, steps };
}

/** Points for one wave of matched cells. */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

/** Total points for a full move: first wave face value, later waves double. */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}
