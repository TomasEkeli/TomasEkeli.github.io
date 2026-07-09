// game.js — pure match-3 logic (g09-c02 "Skylark Rise")
// ES module, no DOM, no globals. All randomness comes through the injected rng.

/** Strength of the refill bias toward the favoured colour (weight vs 1 each). */
export const FAVOUR_WEIGHT = 2;

// ---------- helpers ----------

function copyBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

/** True iff the cell (r, c) sits inside a straight run of >= 3 equal values. */
function hasMatchThrough(board, r, c) {
  const v = board[r][c];
  if (v < 0) return false;
  const rows = board.length, cols = board[0].length;
  // horizontal
  let len = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) len++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) len++;
  if (len >= 3) return true;
  // vertical
  len = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) len++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) len++;
  return len >= 3;
}

/** True iff placing value v at (r, c) would create a run of >= 3 with the
 * currently-known cells (negative values never match). */
function wouldMatchAt(board, r, c, v) {
  const rows = board.length, cols = board[0].length;
  let len = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) len++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) len++;
  if (len >= 3) return true;
  len = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) len++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) len++;
  return len >= 3;
}

// ---------- pinned API ----------

/**
 * One colour in 0..types-1 drawn from rng, biased toward `favour` when it is a
 * valid type (weight FAVOUR_WEIGHT vs 1 for each other colour). Uniform when
 * favour is null/undefined/out of range. Exactly one rng() call per draw, so
 * the stream is deterministic and the no-favour path is byte-for-byte the old
 * uniform draw.
 */
export function nextColour(rng, types, favour) {
  const valid = Number.isInteger(favour) && favour >= 0 && favour < types;
  if (!valid) return Math.floor(rng() * types);
  const total = types - 1 + FAVOUR_WEIGHT;
  const x = rng() * total;
  if (x < FAVOUR_WEIGHT) return favour;
  const idx = Math.floor(x - FAVOUR_WEIGHT); // 0 .. types-2
  return idx < favour ? idx : idx + 1;
}

/** The next n colours the refill would feed in — the biased forecast (peek). */
export function refillQueue(rng, types, favour, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = nextColour(rng, types, favour);
  return out;
}

/** A rows×cols board with no matches and at least one valid move. */
export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const banned = new Set();
        if (c >= 2 && row[c - 1] === row[c - 2]) banned.add(row[c - 1]);
        if (r >= 2 && board[r - 1][c] === board[r - 2][c]) banned.add(board[r - 1][c]);
        const allowed = [];
        for (let t = 0; t < types; t++) if (!banned.has(t)) allowed.push(t);
        row.push(allowed.length
          ? allowed[Math.floor(rng() * allowed.length)]
          : Math.floor(rng() * types));
      }
      board.push(row);
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
}

/** Every cell in any horizontal/vertical run of length >= 3, deduped. */
export function findMatches(board) {
  const rows = board.length;
  if (!rows) return [];
  const cols = board[0].length;
  const hit = new Set();
  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c === cols || board[r][c] !== board[r][start]) {
        if (c - start >= 3 && board[r][start] >= 0) {
          for (let cc = start; cc < c; cc++) hit.add(r * cols + cc);
        }
        start = c;
      }
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      if (r === rows || board[r][c] !== board[start][c]) {
        if (r - start >= 3 && board[start][c] >= 0) {
          for (let rr = start; rr < r; rr++) hit.add(rr * cols + c);
        }
        start = r;
      }
    }
  }
  return [...hit].map((k) => ({ r: Math.floor(k / cols), c: k % cols }));
}

/** True iff a and b are orthogonally adjacent AND swapping them makes a match. */
export function isValidSwap(board, a, b) {
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return false;
  if (board[a.r][a.c] === board[b.r][b.c]) return false; // no-op swap
  const swapped = applySwap(board, a, b);
  return hasMatchThrough(swapped, a.r, a.c) || hasMatchThrough(swapped, b.r, b.c);
}

/** True iff some orthogonally-adjacent swap would create a match (game-over detector). */
export function hasValidMove(board) {
  const rows = board.length;
  if (!rows) return false;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/** A new board with the values at a and b exchanged. Pure; does not validate. */
export function applySwap(board, a, b) {
  const out = copyBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/**
 * Repeatedly clear matches, drop survivors, refill from the top (drawing
 * through nextColour with the optional favour bias; re-drawing when a colour
 * would make an instant match) until the board is full and match-free.
 * Returns { board, steps } — steps[i] = { matches, board } per clear wave.
 */
export function collapse(board, rng, types, favour) {
  const rows = board.length, cols = rows ? board[0].length : 0;
  let cur = copyBoard(board);
  const steps = [];
  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    // clear
    for (const { r, c } of matches) cur[r][c] = -1;
    // gravity, per column
    for (let c = 0; c < cols; c++) {
      let w = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (cur[r][c] >= 0) {
          cur[w][c] = cur[r][c];
          w--;
        }
      }
      for (; w >= 0; w--) cur[w][c] = -1;
    }
    // refill, row-major from the top; avoid creating instant matches
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cur[r][c] !== -1) continue;
        let v = nextColour(rng, types, favour);
        let tries = 0;
        while (tries < 24 && wouldMatchAt(cur, r, c, v)) {
          v = nextColour(rng, types, favour);
          tries++;
        }
        if (wouldMatchAt(cur, r, c, v)) {
          for (let t = 0; t < types; t++) {
            if (!wouldMatchAt(cur, r, c, t)) { v = t; break; }
          }
        }
        cur[r][c] = v;
      }
    }
    steps.push({ matches, board: copyBoard(cur) });
  }
  return { board: cur, steps };
}

/** Longest straight run of identical values (0 for an empty board). */
export function longestRun(board) {
  if (!board || board.length === 0 || board[0].length === 0) return 0;
  const rows = board.length, cols = board[0].length;
  let best = 1;
  for (let r = 0; r < rows; r++) {
    let len = 1;
    for (let c = 1; c < cols; c++) {
      len = board[r][c] === board[r][c - 1] ? len + 1 : 1;
      if (len > best) best = len;
    }
  }
  for (let c = 0; c < cols; c++) {
    let len = 1;
    for (let r = 1; r < rows; r++) {
      len = board[r][c] === board[r - 1][c] ? len + 1 : 1;
      if (len > best) best = len;
    }
  }
  return best;
}

/** Persistent multiplier: L<4 halves (floored at 1); L>=4 compounds by 2^(L-3). */
export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(base / 2));
  return base * 2 ** (longestRunLen - 3);
}

/** 0-based stage index: a new stage every 100 000 points. */
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

/** Escalating cascade bump: wave 0 ×1, wave 1 ×2, wave 2 ×3, ... */
export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}
