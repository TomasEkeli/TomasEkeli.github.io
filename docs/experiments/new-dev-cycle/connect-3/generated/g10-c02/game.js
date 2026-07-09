// game.js — pure match-3 logic. ES module, no DOM, no globals, deterministic
// given an injected rng (a function returning floats in [0,1)).
//
// A board is rows × cols of integers in 0..types-1. Coordinates are {r, c}.

export const FAVOUR_WEIGHT = 2;

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, p) {
  return (
    p && Number.isInteger(p.r) && Number.isInteger(p.c) &&
    p.r >= 0 && p.r < board.length &&
    p.c >= 0 && p.c < (board[p.r] ? board[p.r].length : 0)
  );
}

// One colour drawn from rng, biased toward `favour` (weight FAVOUR_WEIGHT vs 1
// for each other colour) when favour is a valid type; uniform otherwise.
// Exactly one rng() call either way, so the no-favour path is byte-for-byte the
// old uniform draw.
export function nextColour(rng, types, favour) {
  const biased = Number.isInteger(favour) && favour >= 0 && favour < types;
  if (!biased) return Math.floor(rng() * types);
  const total = types - 1 + FAVOUR_WEIGHT;
  const x = rng() * total;
  if (x < FAVOUR_WEIGHT) return favour;
  const idx = Math.floor(x - FAVOUR_WEIGHT); // 0..types-2 over the non-favoured
  return idx >= favour ? idx + 1 : idx;
}

// The next n colours the refill would feed in — the biased forecast the UI
// shows as the "peek". Just nextColour called n times.
export function refillQueue(rng, types, favour, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = nextColour(rng, types, favour);
  return out;
}

// Every cell that is part of any horizontal or vertical run of length >= 3.
// Each cell appears at most once.
export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const hit = new Set();

  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] !== null && board[r][c] === board[r][c - 1];
      if (same) run++;
      else {
        if (run >= 3 && board[r][c - 1] !== null) {
          for (let k = c - run; k < c; k++) hit.add(r * cols + k);
        }
        run = 1;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] !== null && board[r][c] === board[r - 1][c];
      if (same) run++;
      else {
        if (run >= 3 && board[r - 1][c] !== null) {
          for (let k = r - run; k < r; k++) hit.add(k * cols + c);
        }
        run = 1;
      }
    }
  }

  return [...hit].map((key) => ({ r: Math.floor(key / cols), c: key % cols }));
}

// A new board with the values at a and b exchanged. Pure; does not validate.
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// true iff a and b are orthogonally adjacent AND swapping them yields >= 1 match.
export function isValidSwap(board, a, b) {
  if (!inBounds(board, a) || !inBounds(board, b)) return false;
  if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return false;
  return findMatches(applySwap(board, a, b)).length > 0;
}

// true iff some orthogonally-adjacent swap would create at least one match.
// This is the game-over detector.
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

// Would placing value v at (r, c) complete a straight run of 3+ right now?
function wouldMatchAt(board, r, c, v) {
  const rows = board.length;
  const cols = board[0].length;
  let n = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) n++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) n++;
  if (n >= 3) return true;
  n = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) n++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) n++;
  return n >= 3;
}

// Repeatedly clear matches, drop survivors, refill from the top (drawing
// through nextColour so an optional `favour` biases the refill), until the
// board is full and match-free. Returns { board, steps } — steps[i] is
// { matches, board } for wave i. Does NOT reshuffle to dodge a deadlock.
export function collapse(board, rng, types, favour) {
  let cur = cloneBoard(board);
  const steps = [];

  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;

    const rows = cur.length;
    const cols = cur[0].length;
    const work = cloneBoard(cur);

    for (const { r, c } of matches) work[r][c] = null;

    // Gravity: survivors settle to the bottom of each column.
    for (let c = 0; c < cols; c++) {
      const stack = [];
      for (let r = rows - 1; r >= 0; r--) {
        if (work[r][c] !== null) stack.push(work[r][c]);
      }
      for (let r = rows - 1; r >= 0; r--) {
        const v = stack[rows - 1 - r];
        work[r][c] = v === undefined ? null : v;
      }
    }

    // Refill top-down through the (possibly biased) draw; re-draw when a
    // colour would make an instant match, so the settle stays match-free.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (work[r][c] !== null) continue;
        let v = nextColour(rng, types, favour);
        let guard = 0;
        while (wouldMatchAt(work, r, c, v) && guard++ < 300) {
          v = nextColour(rng, types, favour);
        }
        if (wouldMatchAt(work, r, c, v)) {
          for (let t = 0; t < types; t++) {
            if (!wouldMatchAt(work, r, c, t)) { v = t; break; }
          }
        }
        work[r][c] = v;
      }
    }

    steps.push({ matches, board: cloneBoard(work) });
    cur = work;
  }

  return { board: cur, steps };
}

// Would placing v at (r, c) during row-major generation seed a match with the
// two cells to the left / above (the only filled neighbours at that point)?
function seedsMatch(b, r, c, v) {
  const row = b[r];
  if (c >= 2 && row[c - 1] === v && row[c - 2] === v) return true;
  if (r >= 2 && b[r - 1][c] === v && b[r - 2][c] === v) return true;
  return false;
}

// A full board with no matches and at least one valid move; reshuffles
// internally until both hold (a fresh game must never open already over).
export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const b = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      b.push(row);
      for (let c = 0; c < cols; c++) {
        let v = Math.floor(rng() * types);
        let guard = 0;
        while (seedsMatch(b, r, c, v) && guard++ < 200) {
          v = Math.floor(rng() * types);
        }
        if (seedsMatch(b, r, c, v)) {
          for (let t = 0; t < types; t++) {
            if (!seedsMatch(b, r, c, t)) { v = t; break; }
          }
        }
        row.push(v);
      }
    }
    if (hasValidMove(b)) return b;
  }
}

// Length of the longest straight run of identical values (horizontal or
// vertical). 0 for an empty board; 1 when no two adjacent cells match.
export function longestRun(board) {
  const rows = board.length;
  const cols = rows ? (board[0] ? board[0].length : 0) : 0;
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

// The persistent score multiplier after a move. A run of L >= 4 multiplies the
// running value by 2^(L-3); a plain 3-match (or smaller) halves it, floored,
// never below 1.
export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

// 0-based stage index: a new stage every 100 000 points.
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Score multiplier a drop-wave earns by its 0-based position in the cascade:
// the swap's own wave x1, then x2, x3, x4, ...
export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}
