// game.js — pure match-3 logic (ES module, named exports)
// A board is rows×cols array of arrays of integers in 0..types-1.

function clone(board) {
  return board.map((row) => row.slice());
}

export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const seen = new Set();
  const out = [];
  const add = (r, c) => {
    const k = r * cols + c;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ r, c });
    }
  };
  // horizontal
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        run++;
      } else {
        if (run >= 3) for (let k = c - run; k < c; k++) add(r, k);
        run = 1;
      }
    }
  }
  // vertical
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[r - 1][c]) {
        run++;
      } else {
        if (run >= 3) for (let k = r - run; k < r; k++) add(k, c);
        run = 1;
      }
    }
  }
  return out;
}

export function applySwap(board, a, b) {
  const out = clone(board);
  const t = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = t;
  return out;
}

function adjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
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
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  if (cols === 0) return 0;
  let best = 1;
  // horizontal
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  // vertical
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Fill a single cell avoiding immediate matches with already-set neighbours.
function pickColor(board, r, c, types, rng) {
  const cols = board[0].length;
  for (let attempt = 0; attempt < 100; attempt++) {
    const v = Math.floor(rng() * types) % types;
    // horizontal: avoid two same to the left
    if (c >= 2 && board[r][c - 1] === v && board[r][c - 2] === v) continue;
    // vertical: avoid two same above
    if (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v) continue;
    return v;
  }
  // fallback: any value not colliding, else 0
  for (let v = 0; v < types; v++) {
    if (c >= 2 && board[r][c - 1] === v && board[r][c - 2] === v) continue;
    if (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v) continue;
    return v;
  }
  return 0;
}

export function createBoard(rows, cols, types, rng) {
  for (let tries = 0; tries < 500; tries++) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(-1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickColor(board, r, c, types, rng);
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // Extremely unlikely fallback: return a valid checkerboard-ish attempt anyway
  const board = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) board[r][c] = pickColor(board, r, c, types, rng);
  return board;
}

// Drop surviving gems and refill empties (null = empty) avoiding new matches.
function dropAndRefill(board, types, rng) {
  const rows = board.length;
  const cols = board[0].length;
  for (let c = 0; c < cols; c++) {
    // collect survivors bottom-up
    const col = [];
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c] !== null && board[r][c] !== undefined) col.push(board[r][c]);
    }
    // write survivors from bottom
    let idx = 0;
    for (let r = rows - 1; r >= 0; r--) {
      if (idx < col.length) {
        board[r][c] = col[idx++];
      } else {
        board[r][c] = null; // to be refilled
      }
    }
  }
  // refill empties from top avoiding matches
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) {
        board[r][c] = pickColor(board, r, c, types, rng);
      }
    }
  }
  return board;
}

export function collapse(board, rng, types) {
  if (types === undefined) {
    let mx = 0;
    for (const row of board) for (const v of row) if (v > mx) mx = v;
    types = mx + 1;
  }
  let cur = clone(board);
  const steps = [];
  while (true) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    // clear
    for (const { r, c } of matches) cur[r][c] = null;
    dropAndRefill(cur, types, rng);
    steps.push({ matches, board: clone(cur) });
  }
  return { board: cur, steps };
}
