// Lagoon of Light — pure match-3 logic (ES module, no DOM, no globals).
//
// A board is rows × cols of integers in 0..types-1. Coordinates are {r, c}.
// `rng` is a function returning floats in [0, 1).

export const FAVOUR_WEIGHT = 2;

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, p) {
  return (
    p && Number.isInteger(p.r) && Number.isInteger(p.c) &&
    p.r >= 0 && p.r < board.length &&
    p.c >= 0 && board.length > 0 && p.c < board[0].length
  );
}

// Would placing value v at (r, c) complete a straight run of 3+?
// Cells holding null/undefined never match.
function makesMatchAt(board, r, c, v) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  let n = 1;
  for (let x = c - 1; x >= 0 && board[r][x] === v; x--) n++;
  for (let x = c + 1; x < cols && board[r][x] === v; x++) n++;
  if (n >= 3) return true;
  n = 1;
  for (let y = r - 1; y >= 0 && board[y][c] === v; y--) n++;
  for (let y = r + 1; y < rows && board[y][c] === v; y++) n++;
  return n >= 3;
}

// Does the cell (r, c) currently sit inside a run of 3+ on `board`?
function cellInMatch(board, r, c) {
  return makesMatchAt(board, r, c, board[r][c]);
}

function validFavour(favour, types) {
  return (
    typeof favour === 'number' && Number.isInteger(favour) &&
    favour >= 0 && favour < types
  );
}

// One colour draw. Uniform unless `favour` is a valid type, in which case the
// favoured colour carries weight FAVOUR_WEIGHT against 1 for each other.
// Exactly one rng() call either way (the uniform path is byte-for-byte the
// classic draw), so streams stay deterministic and backward-compatible.
export function nextColour(rng, types, favour) {
  if (!validFavour(favour, types)) return Math.floor(rng() * types);
  const total = types - 1 + FAVOUR_WEIGHT;
  let x = rng() * total;
  for (let c = 0; c < types; c++) {
    const w = c === favour ? FAVOUR_WEIGHT : 1;
    if (x < w) return c;
    x -= w;
  }
  return types - 1; // float-edge fallback
}

// The next n colours the refill would feed in — the player's "peek".
export function refillQueue(rng, types, favour, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = nextColour(rng, types, favour);
  return out;
}

export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      board.push(row);
      for (let c = 0; c < cols; c++) {
        let v = Math.floor(rng() * types);
        let tries = 0;
        while (tries++ < 64 && makesRunHere(board, row, r, c, v)) {
          v = Math.floor(rng() * types);
        }
        if (makesRunHere(board, row, r, c, v)) {
          for (let t = 0; t < types; t++) {
            if (!makesRunHere(board, row, r, c, t)) { v = t; break; }
          }
        }
        row.push(v);
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
}

function makesRunHere(board, row, r, c, v) {
  if (c >= 2 && row[c - 1] === v && row[c - 2] === v) return true;
  if (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v) return true;
  return false;
}

export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();
  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c === cols || board[r][c] !== board[r][start]) {
        if (board[r][start] != null && c - start >= 3) {
          for (let k = start; k < c; k++) hit.add(r * cols + k);
        }
        start = c;
      }
    }
  }
  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      if (r === rows || board[r][c] !== board[start][c]) {
        if (board[start][c] != null && r - start >= 3) {
          for (let k = start; k < r; k++) hit.add(k * cols + c);
        }
        start = r;
      }
    }
  }
  return [...hit].map((k) => ({ r: Math.floor(k / cols), c: k % cols }));
}

export function isValidSwap(board, a, b) {
  if (!inBounds(board, a) || !inBounds(board, b)) return false;
  if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return false;
  if (board[a.r][a.c] === board[b.r][b.c]) return false; // identity swap
  const sw = cloneBoard(board);
  const t = sw[a.r][a.c];
  sw[a.r][a.c] = sw[b.r][b.c];
  sw[b.r][b.c] = t;
  return cellInMatch(sw, a.r, a.c) || cellInMatch(sw, b.r, b.c);
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

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const t = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = t;
  return out;
}

// Clear → gravity → refill until full and match-free. Refills draw through the
// (possibly favour-biased) nextColour and re-draw rather than land an instant
// match. Does NOT reshuffle a deadlocked settle — game over is a real state.
export function collapse(board, rng, types, favour) {
  let cur = cloneBoard(board);
  const steps = [];
  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    const next = cloneBoard(cur);
    for (const { r, c } of matches) next[r][c] = null;
    const rows = next.length;
    const cols = next[0].length;
    // Gravity: survivors slide to the bottom of their column.
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (next[r][c] != null) {
          const v = next[r][c];
          if (write !== r) next[r][c] = null;
          next[write][c] = v;
          write--;
        }
      }
      for (let r = write; r >= 0; r--) next[r][c] = null;
    }
    // Refill from the top; never create an instant match.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] != null) continue;
        let v = nextColour(rng, types, favour);
        let tries = 0;
        while (tries++ < 64 && makesMatchAt(next, r, c, v)) {
          v = nextColour(rng, types, favour);
        }
        if (makesMatchAt(next, r, c, v)) {
          for (let t = 0; t < types; t++) {
            if (!makesMatchAt(next, r, c, t)) { v = t; break; }
          }
        }
        next[r][c] = v;
      }
    }
    steps.push({ matches, board: cloneBoard(next) });
    cur = next;
  }
  return { board: cur, steps };
}

export function longestRun(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  if (rows === 0 || cols === 0) return 0;
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

// A run of L >= 4 compounds the streak by 2^(L-3); a plain 3-match (or less)
// bleeds it off by half (floored, never below 1).
export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Escalating cascades: the swap's own wave (0) is face value; every later
// drop-wave is worth progressively more.
export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}
