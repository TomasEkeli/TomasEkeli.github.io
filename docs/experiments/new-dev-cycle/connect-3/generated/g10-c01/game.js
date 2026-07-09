// game.js — pure match-3 logic (ES module, no DOM, no globals).
// The board is a rows x cols array of arrays of ints in 0..types-1.
// Cells are { r, c }. rng is a function returning floats in [0, 1).

export const FAVOUR_WEIGHT = 2;

/* ------------------------------------------------------------------ *
 * Colour draws
 * ------------------------------------------------------------------ */

// One colour in 0..types-1. Uniform unless `favour` is a valid type, in
// which case that colour carries weight FAVOUR_WEIGHT against 1 for each
// other colour. Exactly one rng() call either way, so the no-favour path
// is byte-for-byte the old uniform draw.
export function nextColour(rng, types, favour) {
  const biased = Number.isInteger(favour) && favour >= 0 && favour < types;
  if (!biased) return Math.floor(rng() * types);
  const total = types - 1 + FAVOUR_WEIGHT;
  let x = rng() * total;
  for (let t = 0; t < types; t++) {
    const w = t === favour ? FAVOUR_WEIGHT : 1;
    if (x < w) return t;
    x -= w;
  }
  return types - 1; // float-edge safety
}

// The next n colours the refill would feed in — the biased forecast the
// UI shows as the "peek".
export function refillQueue(rng, types, favour, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(nextColour(rng, types, favour));
  return out;
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

// Every cell that is part of a horizontal or vertical run of >= 3 equal
// values. Deduped: each cell appears at most once.
export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const hit = new Set();
  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const v = board[r][c];
      let end = c + 1;
      while (end < cols && board[r][end] === v) end++;
      if (v !== null && v !== undefined && end - c >= 3) {
        for (let k = c; k < end; k++) hit.add(r * cols + k);
      }
      c = end;
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const v = board[r][c];
      let end = r + 1;
      while (end < rows && board[end][c] === v) end++;
      if (v !== null && v !== undefined && end - r >= 3) {
        for (let k = r; k < end; k++) hit.add(k * cols + c);
      }
      r = end;
    }
  }
  return [...hit].map((i) => ({ r: Math.floor(i / cols), c: i % cols }));
}

// Length of the longest straight run of identical values (H or V).
// 0 for an empty board; 1 when no two adjacent cells match.
export function longestRun(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  if (!rows || !cols) return 0;
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

/* ------------------------------------------------------------------ *
 * Swaps & moves
 * ------------------------------------------------------------------ */

function inBounds(board, p) {
  return (
    p && Number.isInteger(p.r) && Number.isInteger(p.c) &&
    p.r >= 0 && p.r < board.length &&
    p.c >= 0 && board.length > 0 && p.c < board[0].length
  );
}

// New board with a and b exchanged. Pure; does not validate.
export function applySwap(board, a, b) {
  const out = board.map((row) => [...row]);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// True iff a and b are orthogonally adjacent AND swapping them yields a match.
export function isValidSwap(board, a, b) {
  if (!inBounds(board, a) || !inBounds(board, b)) return false;
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  return findMatches(applySwap(board, a, b)).length > 0;
}

// Game-over detector: does ANY orthogonally-adjacent swap create a match?
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

/* ------------------------------------------------------------------ *
 * Board creation & settling
 * ------------------------------------------------------------------ */

// Would placing value v at (r, c) complete a run of 3+ against already-set
// neighbours? null/undefined cells never match.
function makesMatchAt(board, r, c, v) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  // horizontal: count equal neighbours left and right of (r, c)
  let n = 1;
  for (let k = c - 1; k >= 0 && board[r][k] === v; k--) n++;
  for (let k = c + 1; k < cols && board[r][k] === v; k++) n++;
  if (v !== null && v !== undefined && n >= 3) return true;
  // vertical
  n = 1;
  for (let k = r - 1; k >= 0 && board[k][c] === v; k--) n++;
  for (let k = r + 1; k < rows && board[k][c] === v; k++) n++;
  return v !== null && v !== undefined && n >= 3;
}

// Draw a colour for (r, c) via nextColour, re-drawing while it would make an
// instant match. Bounded: after 40 draws fall back to the first safe colour.
function drawSafe(board, r, c, rng, types, favour) {
  for (let i = 0; i < 40; i++) {
    const v = nextColour(rng, types, favour);
    if (!makesMatchAt(board, r, c, v)) return v;
  }
  for (let v = 0; v < types; v++) {
    if (!makesMatchAt(board, r, c, v)) return v;
  }
  return nextColour(rng, types, favour); // >2 types always has a safe colour
}

// A full rows x cols board with no matches and at least one valid move.
export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = drawSafe(board, r, c, rng, types, null);
      }
    }
    if (hasValidMove(board)) return board;
  }
}

// Repeatedly clear matches, apply gravity, refill from the top (drawing
// through nextColour with `favour`, avoiding instant matches) until the
// board is full and match-free. Returns { board, steps }.
export function collapse(board, rng, types, favour) {
  let cur = board.map((row) => [...row]);
  const steps = [];
  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    // clear
    for (const { r, c } of matches) cur[r][c] = null;
    // gravity: per column, surviving gems fall to the bottom
    const rows = cur.length;
    const cols = rows ? cur[0].length : 0;
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (cur[r][c] !== null) {
          cur[write][c] = cur[r][c];
          if (write !== r) cur[r][c] = null;
          write--;
        }
      }
      for (let r = write; r >= 0; r--) cur[r][c] = null;
    }
    // refill row-major from the top, biased by favour, no instant matches
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cur[r][c] === null) cur[r][c] = drawSafe(cur, r, c, rng, types, favour);
      }
    }
    steps.push({ matches, board: cur.map((row) => [...row]) });
  }
  return { board: cur, steps };
}

/* ------------------------------------------------------------------ *
 * Scoring primitives
 * ------------------------------------------------------------------ */

// Persistent multiplier: a run of L >= 4 compounds by 2^(L-3); a plain
// 3-match (or less) halves the streak, floored at 1.
export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

// 0-based stage index: a new stage every 100 000 points. Never negative.
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Escalating cascade payoff: wave 0 x1, wave 1 x2, wave 2 x3, ...
export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}
