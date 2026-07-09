// game.js — pure, deterministic match-3 logic. No Math.random here; all
// randomness comes through the injected `rng` (a () => float in [0,1)).

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function randInt(rng, n) {
  // rng() in [0,1) -> integer in [0, n)
  return Math.floor(rng() * n) % n;
}

/**
 * findMatches(board) -> Array<{r,c}>
 * Every cell in any horizontal or vertical run of length >= 3, each once.
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const matched = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) matched[r][k] = true;
        }
        runStart = c;
      }
    }
  }

  // Vertical runs
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] === board[runStart][c];
      if (!same) {
        const runLen = r - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < r; k++) matched[k][c] = true;
        }
        runStart = r;
      }
    }
  }

  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matched[r][c]) out.push({ r, c });
    }
  }
  return out;
}

/**
 * applySwap(board, a, b) -> new board with a,b values exchanged.
 * Pure: does not mutate input, does not validate adjacency or match outcome.
 */
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
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * isValidSwap(board, a, b) -> boolean
 * true iff a,b orthogonally adjacent AND the swap yields >=1 match.
 */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * hasValidMove(board) -> boolean
 * true iff some orthogonally-adjacent swap would create at least one match.
 */
export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Only need to check right and down neighbours; symmetry covers the rest.
      if (c + 1 < cols) {
        if (isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      }
      if (r + 1 < rows) {
        if (isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
      }
    }
  }
  return false;
}

/**
 * Fills a board with random values in [0,types), avoiding creating a
 * horizontal or vertical run of 3+ as it goes (checks only already-filled
 * neighbours to the left and above, which is sufficient for a left-to-right,
 * top-to-bottom fill).
 */
function fillNoMatch(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const banned = new Set();
      if (c >= 2 && board[r][c - 1] === board[r][c - 2]) {
        banned.add(board[r][c - 1]);
      }
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) {
        banned.add(board[r - 1][c]);
      }
      const options = [];
      for (let t = 0; t < types; t++) if (!banned.has(t)) options.push(t);
      const pool = options.length > 0 ? options : Array.from({ length: types }, (_, t) => t);
      board[r][c] = pool[randInt(rng, pool.length)];
    }
  }
  return board;
}

/**
 * createBoard(rows, cols, types, rng) -> board
 * Full board, no matches, at least one valid move. Reshuffles until both hold.
 */
export function createBoard(rows, cols, types, rng) {
  const MAX_ATTEMPTS = 200;
  let board = fillNoMatch(rows, cols, types, rng);
  let attempts = 0;
  while ((findMatches(board).length > 0 || !hasValidMove(board)) && attempts < MAX_ATTEMPTS) {
    board = fillNoMatch(rows, cols, types, rng);
    attempts++;
  }
  return board;
}

/**
 * Applies gravity (empty cells represented as null bubble to the top) and
 * refills from the top using rng, drawing from `types` colours, without
 * creating new matches with already-settled neighbours (checks left/above
 * within the same pass, top-to-bottom fill of new cells).
 */
function collapseOnce(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const matches = findMatches(board);
  if (matches.length === 0) return { board, cleared: 0 };

  const cleared = cloneBoard(board);
  for (const { r, c } of matches) cleared[r][c] = null;

  // Gravity: for each column, compact non-null values downward.
  const result = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
    }
    // Place survivors at the bottom of the column.
    const offset = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      result[offset + i][c] = survivors[i];
    }
    // Fill the remaining (top) cells with new random values, avoiding
    // immediate matches against already-placed neighbours.
    for (let r = offset - 1; r >= 0; r--) {
      const banned = new Set();
      // Vertical check: look at the two cells below (already filled).
      const below1 = result[r + 1] ? result[r + 1][c] : null;
      const below2 = result[r + 2] ? result[r + 2][c] : null;
      if (below1 !== null && below1 === below2) banned.add(below1);
      // Horizontal check: look at two cells to the left in this row, if
      // already filled (they will be, since we fill column by column and
      // earlier columns in this row are fully resolved).
      const left1 = c >= 1 ? result[r][c - 1] : null;
      const left2 = c >= 2 ? result[r][c - 2] : null;
      if (left1 !== null && left1 === left2) banned.add(left1);

      const options = [];
      for (let t = 0; t < types; t++) if (!banned.has(t)) options.push(t);
      const pool = options.length > 0 ? options : Array.from({ length: types }, (_, t) => t);
      result[r][c] = pool[randInt(rng, pool.length)];
    }
  }

  return { board: result, cleared: matches.length };
}

/**
 * collapse(board, rng, types) -> board
 * Repeatedly clears matches, applies gravity, and refills until the board is
 * full and match-free. Reshuffles (recreates via createBoard-style fill) if
 * the settled board has no valid move, to avoid ever returning a deadlock.
 */
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const MAX_CASCADE = 100;

  let current = board;
  let iterations = 0;
  while (iterations < MAX_CASCADE) {
    const { board: next, cleared } = collapseOnce(current, rng, types);
    current = next;
    iterations++;
    if (cleared === 0) break;
  }

  // Safety: ensure fully match-free (should already hold).
  let safety = 0;
  while (findMatches(current).length > 0 && safety < MAX_CASCADE) {
    const { board: next } = collapseOnce(current, rng, types);
    current = next;
    safety++;
  }

  // Deadlock guard: if settled board has no valid move, reshuffle.
  let reshuffles = 0;
  const MAX_RESHUFFLES = 200;
  while (!hasValidMove(current) && reshuffles < MAX_RESHUFFLES) {
    current = fillNoMatch(rows, cols, types, rng);
    reshuffles++;
  }

  return current;
}

/**
 * score(matches) -> number
 */
export function score(matches) {
  return matches.length * 10;
}
