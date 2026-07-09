// game.js — pure logic module for the "Forgefall" candidate.
// No Math.random anywhere in this file: all randomness comes from the
// injected `rng` (a function returning a float in [0, 1)).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

// --- findMatches -----------------------------------------------------------

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const hit = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) hit.add(`${r},${k}`);
        }
        runStart = c;
      }
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] === board[runStart][c];
      if (!same) {
        const runLen = r - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < r; k++) hit.add(`${k},${c}`);
        }
        runStart = r;
      }
    }
  }

  return [...hit].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

// --- isValidSwap / applySwap / hasValidMove --------------------------------

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
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

// --- longestRun / matchMultiplier / stageForScore --------------------------

export function longestRun(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  if (rows === 0 || cols === 0) return 0;
  let best = 1;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c < cols; c++) {
      if (board[r][c] === board[r][c - 1]) {
        runLen++;
        if (runLen > best) best = runLen;
      } else {
        runLen = 1;
      }
    }
  }

  for (let c = 0; c < cols; c++) {
    let runLen = 1;
    for (let r = 1; r < rows; r++) {
      if (board[r][c] === board[r - 1][c]) {
        runLen++;
        if (runLen > best) best = runLen;
      } else {
        runLen = 1;
      }
    }
  }

  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  if (longestRunLen < 4) return 1;
  return Math.max(prev, 1) * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// --- createBoard / collapse --------------------------------------------------

function pickValue(rng, types, excluded) {
  // Try random draws first (fast path), fall back to a linear scan so we
  // always terminate even if `excluded` covers most of the palette.
  for (let attempt = 0; attempt < 20; attempt++) {
    const v = Math.floor(rng() * types);
    if (!excluded.has(v)) return v;
  }
  for (let v = 0; v < types; v++) {
    if (!excluded.has(v)) return v;
  }
  return Math.floor(rng() * types);
}

function fillNoMatchBoard(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const excluded = new Set();
      if (c >= 2 && board[r][c - 1] === board[r][c - 2]) excluded.add(board[r][c - 1]);
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) excluded.add(board[r - 1][c]);
      board[r][c] = pickValue(rng, types, excluded);
    }
  }
  return board;
}

export function createBoard(rows, cols, types, rng) {
  let board = fillNoMatchBoard(rows, cols, types, rng);
  let attempts = 0;
  while (!hasValidMove(board) && attempts < 200) {
    board = fillNoMatchBoard(rows, cols, types, rng);
    attempts++;
  }
  return board;
}

// One clear+gravity+refill pass over `board`, given the cells to clear.
function settleOnce(board, cellsToClear, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const work = cloneBoard(board);

  for (const { r, c } of cellsToClear) work[r][c] = null;

  // Gravity: compact each column's survivors to the bottom.
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (work[r][c] !== null) survivors.push(work[r][c]);
    }
    const emptyCount = rows - survivors.length;
    for (let r = 0; r < rows; r++) {
      work[r][c] = r < emptyCount ? null : survivors[r - emptyCount];
    }
  }

  // Refill empty cells (always the top of each column at this point),
  // top-to-bottom, left-to-right, avoiding creating a fresh match from the
  // refill itself.
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (work[r][c] !== null) continue;
      const excluded = new Set();
      if (c >= 2 && work[r][c - 1] !== null && work[r][c - 1] === work[r][c - 2]) {
        excluded.add(work[r][c - 1]);
      }
      if (r >= 2 && work[r - 1][c] !== null && work[r - 1][c] === work[r - 2][c]) {
        excluded.add(work[r - 1][c]);
      }
      work[r][c] = pickValue(rng, types, excluded);
    }
  }

  return work;
}

export function collapse(board, rng, types) {
  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const next = settleOnce(current, matches, rng, types);
    steps.push({ matches, board: next });
    current = next;
  }

  return { board: current, steps };
}
