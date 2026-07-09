// game.js — pure, deterministic match-3 logic (ES module).
//
// A `board` is a rows×cols array of arrays of integers in 0..types-1.
// A coordinate is { r, c }. `rng` returns a float in [0, 1).
// No Math.random here — all randomness comes from the injected rng.

const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
];

function clone(board) {
  return board.map((row) => row.slice());
}

function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// Would placing `v` at (r,c) create a run of >= 3 through that cell?
// Cells holding `undefined`/`null` are treated as "not equal" so partially
// built or partially refilled boards are handled cleanly.
function wouldRun(board, r, c, v) {
  const rows = board.length;
  const cols = board[0].length;
  // horizontal
  let run = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) run++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) run++;
  if (run >= 3) return true;
  // vertical
  run = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) run++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) run++;
  return run >= 3;
}

// Pick a colour for (r,c) that does not complete a run with already-set
// neighbours. Falls back to a plain draw if every colour is blocked (rare;
// any resulting match is simply cleared by the next collapse wave).
function pickColour(board, r, c, types, rng) {
  const start = Math.floor(rng() * types) % types;
  for (let i = 0; i < types; i++) {
    const v = (start + i) % types;
    if (!wouldRun(board, r, c, v)) return v;
  }
  return start;
}

export function createBoard(rows, cols, types, rng) {
  // Rebuild until the board is match-free AND has at least one legal move.
  // The match-free property is guaranteed by construction; the playability
  // check is the one that can occasionally force a rebuild.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(undefined));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickColour(board, r, c, types, rng);
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // Extremely defensive fallback: return a freshly built board regardless.
  const board = Array.from({ length: rows }, () => new Array(cols).fill(undefined));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) board[r][c] = pickColour(board, r, c, types, rng);
  return board;
}

export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) continue;
      const len = c - runStart;
      if (len >= 3) for (let k = runStart; k < c; k++) hit[r][k] = true;
      runStart = c;
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[r - 1][c]) continue;
      const len = r - runStart;
      if (len >= 3) for (let k = runStart; k < r; k++) hit[k][c] = true;
      runStart = r;
    }
  }

  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (hit[r][c]) out.push({ r, c });
  return out;
}

export function isValidSwap(board, a, b) {
  if (!adjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function hasValidMove(board) {
  const rows = board.length;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const { dr, dc } of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < rows && nc < cols && isValidSwap(board, { r, c }, { r: nr, c: nc }))
          return true;
      }
    }
  }
  return false;
}

export function applySwap(board, a, b) {
  const next = clone(board);
  const tmp = next[a.r][a.c];
  next[a.r][a.c] = next[b.r][b.c];
  next[b.r][b.c] = tmp;
  return next;
}

// Apply gravity in place: surviving gems fall to the bottom of each column,
// cleared cells (null) rise to the top.
function applyGravity(board) {
  const rows = board.length;
  const cols = board[0].length;
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] !== null) {
        board[write][c] = board[r][c];
        write--;
      }
    }
    for (let r = write; r >= 0; r--) board[r][c] = null;
  }
}

// Fill the empty (null) cells — always at the top of their columns after
// gravity — with fresh colours that do not themselves create a match.
// Filled bottom-up, left-to-right so each placement only needs to consider
// already-settled neighbours.
function refill(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  for (let c = 0; c < cols; c++) {
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] === null) board[r][c] = pickColour(board, r, c, types, rng);
    }
  }
}

export function collapse(board, rng, types) {
  const colourCount =
    typeof types === 'number'
      ? types
      : Math.max(1, ...board.flat().map((v) => v + 1));
  let current = clone(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const next = clone(current);
    for (const { r, c } of matches) next[r][c] = null;
    applyGravity(next);
    refill(next, rng, colourCount);

    steps.push({ matches, board: clone(next) });
    current = next;
  }

  return { board: current, steps };
}

export function longestRun(board) {
  if (!board || board.length === 0) return 0;
  const rows = board.length;
  let max = 0;

  for (let r = 0; r < rows; r++) {
    const row = board[r];
    if (!row || row.length === 0) continue;
    let run = 1;
    if (run > max) max = run;
    for (let c = 1; c < row.length; c++) {
      run = row[c] === row[c - 1] ? run + 1 : 1;
      if (run > max) max = run;
    }
  }

  const cols = Math.max(...board.map((r) => (r ? r.length : 0)));
  for (let c = 0; c < cols; c++) {
    let run = 0;
    let prev;
    for (let r = 0; r < rows; r++) {
      const v = board[r] ? board[r][c] : undefined;
      if (v === undefined) {
        run = 0;
        prev = undefined;
        continue;
      }
      run = v === prev ? run + 1 : 1;
      prev = v;
      if (run > max) max = run;
    }
  }
  return max;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  return longestRunLen < 4
    ? Math.max(1, Math.floor(p / 2))
    : p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
