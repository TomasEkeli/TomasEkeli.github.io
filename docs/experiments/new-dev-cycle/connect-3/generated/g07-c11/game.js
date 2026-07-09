// game.js — pure, deterministic match-3 logic (ES module).
// No DOM, no Math.random: all randomness comes from the injected `rng`
// (a function returning floats in [0, 1)).

/**
 * Build a rows×cols board of ints in 0..types-1 with no initial matches
 * and at least one valid move (a fresh game must never open already over).
 */
export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let v;
        let guard = 0;
        do {
          v = Math.floor(rng() * types);
          guard++;
        } while (
          guard < 100 &&
          ((c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
            (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v))
        );
        row.push(v);
      }
      board.push(row);
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
}

/**
 * Every cell that belongs to a horizontal or vertical run of length >= 3.
 * Deduped: each cell appears at most once.
 */
export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const v = board[r][c];
      let end = c + 1;
      while (end < cols && board[r][end] === v) end++;
      if (end - c >= 3) {
        for (let k = c; k < end; k++) hit.add(r * cols + k);
      }
      c = end;
    }
  }
  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const v = board[r][c];
      let end = r + 1;
      while (end < rows && board[end][c] === v) end++;
      if (end - r >= 3) {
        for (let k = r; k < end; k++) hit.add(k * cols + c);
      }
      r = end;
    }
  }

  const out = [];
  for (const key of hit) out.push({ r: Math.floor(key / cols), c: key % cols });
  return out;
}

/** True iff a and b are orthogonally adjacent AND swapping them makes a match. */
export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const inside = (p) => p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols;
  if (!inside(a) || !inside(b)) return false;
  if (board[a.r][a.c] === board[b.r][b.c]) return false;
  const swapped = applySwap(board, a, b);
  // Only runs through a or b can be new; a full scan is still cheap and safe.
  return findMatches(swapped).length > 0;
}

/** Game-over detector: does ANY adjacent swap create a match? */
export function hasValidMove(board) {
  const rows = board.length;
  if (rows === 0) return false;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/** New board with the values at a and b exchanged. Pure; no validation. */
export function applySwap(board, a, b) {
  const out = board.map((row) => [...row]);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/** Would placing value v at (r, c) create a straight run of 3+ through it? */
function makesRunAt(board, r, c, v) {
  const rows = board.length;
  const cols = board[0].length;
  // Horizontal.
  let n = 1;
  for (let k = c - 1; k >= 0 && board[r][k] === v; k--) n++;
  for (let k = c + 1; k < cols && board[r][k] === v; k++) n++;
  if (n >= 3) return true;
  // Vertical.
  n = 1;
  for (let k = r - 1; k >= 0 && board[k][c] === v; k--) n++;
  for (let k = r + 1; k < rows && board[k][c] === v; k++) n++;
  return n >= 3;
}

/**
 * Repeatedly: clear all matches, drop survivors (gravity), refill from the
 * top with rng-drawn types that do not themselves create matches — until the
 * board is full and match-free. Returns { board, steps } where each step is
 * { matches, board } (matches cleared that wave; board after that wave).
 * Does NOT reshuffle to avoid deadlocks — a settled board with no move is a
 * legitimate game-over state.
 */
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  let cur = board.map((row) => [...row]);
  const steps = [];

  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;

    const matched = new Set(matches.map((m) => m.r * cols + m.c));
    const next = [];
    for (let r = 0; r < rows; r++) next.push(new Array(cols).fill(null));

    // Gravity: survivors compact to the bottom of each column.
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (!matched.has(r * cols + c)) {
          next[write][c] = cur[r][c];
          write--;
        }
      }
    }

    // Refill the empty cells top-down; drawn gems must not create matches.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] !== null) continue;
        const start = Math.floor(rng() * types);
        let placed = false;
        for (let k = 0; k < types; k++) {
          const v = (start + k) % types;
          if (!makesRunAt(next, r, c, v)) {
            next[r][c] = v;
            placed = true;
            break;
          }
        }
        if (!placed) next[r][c] = start; // pathological corner; next wave clears it
      }
    }

    steps.push({ matches, board: next.map((row) => [...row]) });
    cur = next;
  }

  return { board: cur, steps };
}

/** Length of the longest straight run of identical values (h or v). */
export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  if (cols === 0) return 0;
  let best = 1;
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/**
 * Persistent multiplier after a move. A run of L >= 4 compounds the running
 * value by 2^(L-3); a plain 3-match (or smaller) halves it, floored at 1.
 */
export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  return longestRunLen < 4
    ? Math.max(1, Math.floor(base / 2))
    : base * 2 ** (longestRunLen - 3);
}

/** 0-based stage index: a new stage every 100 000 points. Never negative. */
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
