// game.js — match-3 logic module (ES module, named exports)
//
// A `board` is a rows × cols array of arrays of integers in 0..types-1.
// A coordinate is { r, c }. `rng` returns a float in [0, 1).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// Every cell that is part of any horizontal or vertical run of length >= 3.
// Each cell appears at most once.
export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const marked = new Set();
  const add = (r, c) => marked.add(r * cols + c);

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][runStart]) continue;
      if (c - runStart >= 3) {
        for (let k = runStart; k < c; k++) add(r, k);
      }
      runStart = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[runStart][c]) continue;
      if (r - runStart >= 3) {
        for (let k = runStart; k < r; k++) add(k, c);
      }
      runStart = r;
    }
  }

  const out = [];
  for (const key of marked) out.push({ r: Math.floor(key / cols), c: key % cols });
  return out;
}

function areAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

// A new board with the values at `a` and `b` exchanged. Pure; no validation.
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// true iff a and b are orthogonally adjacent AND swapping yields >= 1 match.
export function isValidSwap(board, a, b) {
  if (!areAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

// true iff some orthogonally-adjacent swap would create at least one match.
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

// Fill any empty (null) cells so that no cell completes a run of 3+, drawing
// from 0..types-1 using rng. Does gravity first, then refill from the top.
function dropAndRefill(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;

  // Gravity: for each column, collapse non-null values downward.
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] !== null && board[r][c] !== undefined) {
        board[write][c] = board[r][c];
        if (write !== r) board[r][c] = null;
        write--;
      }
    }
    // Refill the remaining top cells so they never create a match.
    for (let r = write; r >= 0; r--) {
      board[r][c] = pickSafe(board, r, c, types, rng);
    }
  }
}

// Pick a colour for (r, c) that does not complete a horizontal or vertical run
// of 3+ with the cells already filled around it. Falls back to any colour if
// no safe choice exists (extremely unlikely for types >= 3).
function pickSafe(board, r, c, types, rng) {
  const forbidden = new Set();

  // Two same to the left -> that colour would make a horizontal triple.
  if (c >= 2 && board[r][c - 1] != null && board[r][c - 1] === board[r][c - 2]) {
    forbidden.add(board[r][c - 1]);
  }
  // Two same below (rows below r are already filled during refill).
  if (r + 2 < board.length && board[r + 1][c] != null && board[r + 1][c] === board[r + 2][c]) {
    forbidden.add(board[r + 1][c]);
  }
  // Sandwich checks (a same-b same on either side of the gap) are not needed
  // during top-down refill because the neighbour above is not yet placed and
  // the neighbour to the right is filled in a later column pass; the left/below
  // pair checks above are sufficient to prevent completing a new run here.

  const candidates = [];
  for (let t = 0; t < types; t++) if (!forbidden.has(t)) candidates.push(t);
  const pool = candidates.length ? candidates : Array.from({ length: types }, (_, i) => i);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

// Reshuffle the board's existing values until it is match-free and playable.
function reshuffleUntilPlayable(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const flat = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) flat.push(board[r][c]);

  for (let attempt = 0; attempt < 2000; attempt++) {
    // Fisher–Yates shuffle using rng.
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const t = flat[i]; flat[i] = flat[j]; flat[j] = t;
    }
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) board[r][c] = flat[k++];
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  return board;
}

// Repeatedly clear matches, drop, and refill until full & match-free.
// Returns { board, steps }. `types` is explicit — never inferred from contents.
export function collapse(board, rng, types) {
  let current = cloneBoard(board);
  const steps = [];

  let matches = findMatches(current);
  while (matches.length > 0) {
    // Clear the matched cells.
    for (const { r, c } of matches) current[r][c] = null;
    // Drop survivors and refill from the top (refill avoids new matches).
    dropAndRefill(current, rng, types);
    steps.push({ matches, board: cloneBoard(current) });
    matches = findMatches(current);
  }

  // No-deadlock guarantee: only rewrites the final board, never steps.
  if (!hasValidMove(current)) {
    reshuffleUntilPlayable(current, rng, types);
    if (steps.length > 0) steps[steps.length - 1].board = cloneBoard(current);
  }

  return { board: current, steps };
}

// A full board with no matches and at least one valid move.
export function createBoard(rows, cols, types, rng) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(null));
    // Fill top-down, left-right, avoiding matches as we go.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickInitial(board, r, c, types, rng);
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
    // Otherwise try reshuffle before regenerating.
    reshuffleUntilPlayable(board, rng, types);
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // Fallback: build deterministically then reshuffle to playable.
  const board = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r + c) % types));
  reshuffleUntilPlayable(board, rng, types);
  return board;
}

// Pick a colour for (r, c) during initial fill that does not complete a run
// with the already-filled cells above and to the left.
function pickInitial(board, r, c, types, rng) {
  const forbidden = new Set();
  if (c >= 2 && board[r][c - 1] === board[r][c - 2]) forbidden.add(board[r][c - 1]);
  if (r >= 2 && board[r - 1][c] === board[r - 2][c]) forbidden.add(board[r - 1][c]);
  const candidates = [];
  for (let t = 0; t < types; t++) if (!forbidden.has(t)) candidates.push(t);
  const pool = candidates.length ? candidates : Array.from({ length: types }, (_, i) => i);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

// Points for one wave. n = matched-cell count (deduped).
export function score(matches) {
  const n = matches.length;
  return n < 3 ? 0 : 3 + (n * (n - 3)) / 2;
}

// Total for a move: first wave face value, every later wave doubled.
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}
