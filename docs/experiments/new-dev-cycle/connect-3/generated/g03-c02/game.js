// game.js — pure match-3 logic (ES module).
// A board is rows × cols array of arrays of integers in 0..types-1.
// Coordinates are { r, c }. rng() returns a float in [0, 1).

const EMPTY = -1;

function clone(board) {
  return board.map((row) => row.slice());
}

// --- core queries -----------------------------------------------------------

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const seen = new Set();
  const out = [];
  const mark = (r, c) => {
    const key = r * cols + c;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ r, c });
    }
  };

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] >= 0 && board[r][c] === board[r][c - 1];
      if (same) {
        run++;
      } else {
        if (run >= 3) for (let k = c - run; k < c; k++) mark(r, k);
        run = 1;
      }
    }
  }

  // vertical runs
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] >= 0 && board[r][c] === board[r - 1][c];
      if (same) {
        run++;
      } else {
        if (run >= 3) for (let k = r - run; k < r; k++) mark(k, c);
        run = 1;
      }
    }
  }

  return out;
}

function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function applySwap(board, a, b) {
  const out = clone(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

export function isValidSwap(board, a, b) {
  if (!adjacent(a, b)) return false;
  return findMatches(applySwap(board, a, b)).length > 0;
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

// --- generation helpers ------------------------------------------------------

function pickColor(rng, types, forbidden) {
  const allowed = [];
  for (let v = 0; v < types; v++) if (!forbidden.has(v)) allowed.push(v);
  const pool = allowed.length ? allowed : Array.from({ length: types }, (_, i) => i);
  return pool[Math.floor(rng() * pool.length)];
}

// Fill a fresh, match-free board choosing each cell so it never completes a run
// with its already-placed left/up neighbours.
function fillMatchFree(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () => new Array(cols).fill(EMPTY));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const forbidden = new Set();
      if (c >= 2 && board[r][c - 1] === board[r][c - 2]) forbidden.add(board[r][c - 1]);
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) forbidden.add(board[r - 1][c]);
      board[r][c] = pickColor(rng, types, forbidden);
    }
  }
  return board;
}

export function createBoard(rows, cols, types, rng) {
  // A starting board must be match-free AND offer at least one legal move.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = fillMatchFree(rows, cols, types, rng);
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // Extremely unlikely fallback: keep the last match-free board even if strict.
  return fillMatchFree(rows, cols, types, rng);
}

// Gravity + refill: surviving gems fall to the bottom of each column; empty
// cells refill from the top with colours that do not themselves create a match.
function gravityRefill(cleared, rng, types) {
  const rows = cleared.length;
  const cols = rows ? cleared[0].length : 0;
  const next = Array.from({ length: rows }, () => new Array(cols).fill(EMPTY));

  for (let c = 0; c < cols; c++) {
    // Collect survivors top→bottom, then let them fall to the bottom.
    const survivors = [];
    for (let r = 0; r < rows; r++) if (cleared[r][c] !== EMPTY) survivors.push(cleared[r][c]);
    let write = rows - 1;
    for (let i = survivors.length - 1; i >= 0; i--) next[write--][c] = survivors[i];
    // Remaining top cells (0..write) are empties to refill.
    // Fill bottom-up so the two cells below are already known.
    for (let r = write; r >= 0; r--) {
      const forbidden = new Set();
      if (r + 2 < rows && next[r + 1][c] !== EMPTY && next[r + 1][c] === next[r + 2][c]) {
        forbidden.add(next[r + 1][c]);
      }
      if (c >= 2 && next[r][c - 1] !== EMPTY && next[r][c - 1] === next[r][c - 2]) {
        forbidden.add(next[r][c - 1]);
      }
      next[r][c] = pickColor(rng, types, forbidden);
    }
  }
  return next;
}

// Reshuffle the existing multiset of gems into a match-free, playable board.
function reshuffle(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const flat = [];
  for (const row of board) for (const v of row) flat.push(v);
  for (let attempt = 0; attempt < 500; attempt++) {
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    const cand = [];
    let k = 0;
    for (let r = 0; r < rows; r++) {
      cand.push(flat.slice(k, k + cols));
      k += cols;
    }
    if (findMatches(cand).length === 0 && hasValidMove(cand)) return cand;
  }
  // Fallback: build a guaranteed-good board from scratch.
  return createBoard(rows, cols, types, rng);
}

export function collapse(board, rng, types) {
  if (typeof types !== 'number') {
    // Caller should always pass this per the contract; fall back to inferring
    // from the board's current contents only for robustness.
    types = Math.max(0, ...board.flat()) + 1;
  }
  const steps = [];
  let cur = clone(board);

  while (true) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    const cleared = clone(cur);
    for (const { r, c } of matches) cleared[r][c] = EMPTY;
    const next = gravityRefill(cleared, rng, types);
    steps.push({ matches, board: clone(next) });
    cur = next;
  }

  // No-deadlock guarantee applies only after an actual settle. A match-free
  // input is a no-op (steps empty, board is a copy). The reshuffle rewrites
  // only the returned board, never the recorded steps.
  let settled = cur;
  if (steps.length > 0 && !hasValidMove(settled)) {
    settled = reshuffle(settled, rng, types);
  }

  return { board: settled, steps };
}

// --- scoring -----------------------------------------------------------------

export function score(matches) {
  const n = matches.length;
  return n < 3 ? 0 : 3 + (n * (n - 3)) / 2;
}

export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}
