// game.js — pure, deterministic match-3 logic. No Math.random here; all
// randomness comes from the injected `rng` (a function returning [0,1)).

function inBounds(rows, cols, r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * Find every cell that is part of a horizontal or vertical run of length >= 3.
 * Returns an array of {r,c}, each cell at most once.
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const matched = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const sameAsRunStart = c < cols && board[r][c] === board[r][runStart];
      if (sameAsRunStart) continue;
      const runLen = c - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
      }
      runStart = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const sameAsRunStart = r < rows && board[r][c] === board[runStart][c];
      if (sameAsRunStart) continue;
      const runLen = r - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < r; k++) matched.add(k + ',' + c);
      }
      runStart = r;
    }
  }

  const out = [];
  for (const key of matched) {
    const [r, c] = key.split(',').map(Number);
    out.push({ r, c });
  }
  return out;
}

/**
 * A new board with the values at a and b exchanged. Pure, no validation.
 */
export function applySwap(board, a, b) {
  const nb = cloneBoard(board);
  const tmp = nb[a.r][a.c];
  nb[a.r][a.c] = nb[b.r][b.c];
  nb[b.r][b.c] = tmp;
  return nb;
}

/**
 * true iff a,b are orthogonally adjacent AND swapping them yields >=1 match.
 */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * true iff some orthogonally-adjacent swap would create at least one match.
 */
export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) {
        const a = { r, c };
        const b = { r, c: c + 1 };
        const swapped = applySwap(board, a, b);
        if (findMatches(swapped).length > 0) return true;
      }
      if (r + 1 < rows) {
        const a = { r, c };
        const b = { r: r + 1, c };
        const swapped = applySwap(board, a, b);
        if (findMatches(swapped).length > 0) return true;
      }
    }
  }
  return false;
}

export function score(matches) {
  return matches.length * 10;
}

/**
 * Pick a colour for cell (r,c) that does not complete a horizontal or
 * vertical run of 3 with already-placed neighbours (up, left). Requires
 * b[r][c-1], b[r][c-2], b[r-1][c], b[r-2][c] to already be filled if they
 * exist within bounds.
 */
function pickNoMatchColour(b, r, c, rows, cols, types, rng) {
  const disallowed = new Set();
  if (c >= 2 && b[r][c - 1] !== null && b[r][c - 1] === b[r][c - 2]) {
    disallowed.add(b[r][c - 1]);
  }
  if (r >= 2 && b[r - 1][c] !== null && b[r - 1][c] === b[r - 2][c]) {
    disallowed.add(b[r - 1][c]);
  }
  const candidates = [];
  for (let t = 0; t < types; t++) {
    if (!disallowed.has(t)) candidates.push(t);
  }
  const pool = candidates.length > 0 ? candidates : allColours(types);
  const idx = Math.floor(rng() * pool.length) % pool.length;
  return pool[idx];
}

function allColours(types) {
  const out = [];
  for (let t = 0; t < types; t++) out.push(t);
  return out;
}

/**
 * Build a full rows x cols board, matches-free by construction, using rng
 * for colour choices.
 */
function buildFullBoard(rows, cols, types, rng) {
  const b = [];
  for (let r = 0; r < rows; r++) {
    b.push(new Array(cols).fill(null));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      b[r][c] = pickNoMatchColour(b, r, c, rows, cols, types, rng);
    }
  }
  return b;
}

const MAX_RESHUFFLE_ATTEMPTS = 200;

/**
 * A full board with no matches and at least one valid move. Reshuffles
 * internally (bounded) until both hold.
 */
export function createBoard(rows, cols, types, rng) {
  let b = buildFullBoard(rows, cols, types, rng);
  let attempts = 0;
  while (!hasValidMove(b) && attempts < MAX_RESHUFFLE_ATTEMPTS) {
    b = buildFullBoard(rows, cols, types, rng);
    attempts++;
  }
  return b;
}

/**
 * Repeatedly clear matches, apply gravity, and refill from the top using
 * `types` colours, until the board is full and match-free. Then ensure at
 * least one valid move exists, reshuffling the whole board if not.
 */
export function collapse(board, rng, types) {
  let b = cloneBoard(board);
  const rows = b.length;
  const cols = b[0].length;

  let iterations = 0;
  const MAX_ITERATIONS = 1000;
  while (iterations < MAX_ITERATIONS) {
    const matches = findMatches(b);
    if (matches.length === 0) break;

    for (const { r, c } of matches) b[r][c] = null;

    // Gravity: survivors fall to the bottom of each column, preserving order.
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (b[r][c] !== null) survivors.push(b[r][c]);
      }
      const missing = rows - survivors.length;
      for (let r = 0; r < rows; r++) {
        b[r][c] = r < missing ? null : survivors[r - missing];
      }
    }

    // Refill empty (top) cells column by column, top to bottom, avoiding
    // creating new matches with already-settled neighbours.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (b[r][c] === null) {
          b[r][c] = pickNoMatchColour(b, r, c, rows, cols, types, rng);
        }
      }
    }

    iterations++;
  }

  let attempts = 0;
  while (!hasValidMove(b) && attempts < MAX_RESHUFFLE_ATTEMPTS) {
    b = buildFullBoard(rows, cols, types, rng);
    attempts++;
  }

  return b;
}
