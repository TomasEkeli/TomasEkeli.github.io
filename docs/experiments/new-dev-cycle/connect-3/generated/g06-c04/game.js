// game.js — pure, deterministic match-3 logic. No Math.random in here; the
// caller injects `rng` (a () => float in [0,1) function).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(r, c, rows, cols) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

/** Every cell that is part of a horizontal or vertical run of length >= 3. */
export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const marked = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][runStart]) continue;
      const runLen = c - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < c; k++) marked.add(r + ',' + k);
      }
      runStart = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[runStart][c]) continue;
      const runLen = r - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < r; k++) marked.add(k + ',' + c);
      }
      runStart = r;
    }
  }

  return [...marked].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

export function isValidSwap(board, a, b) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  if (!inBounds(a.r, a.c, rows, cols) || !inBounds(b.r, b.c, rows, cols)) return false;
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
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

function pickAvoiding(rng, types, avoid) {
  const candidates = [];
  for (let t = 0; t < types; t++) if (!avoid.has(t)) candidates.push(t);
  const pool = candidates.length ? candidates : Array.from({ length: types }, (_, i) => i);
  const idx = Math.floor(rng() * pool.length);
  return pool[idx];
}

function generateNoMatchBoard(rows, cols, types, rng) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const avoid = new Set();
      if (c >= 2 && row[c - 1] === row[c - 2]) avoid.add(row[c - 1]);
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) avoid.add(board[r - 1][c]);
      row.push(pickAvoiding(rng, types, avoid));
    }
    board.push(row);
  }
  return board;
}

export function createBoard(rows, cols, types, rng) {
  let board;
  let tries = 0;
  do {
    board = generateNoMatchBoard(rows, cols, types, rng);
    tries++;
  } while (!hasValidMove(board) && tries < 500);
  return board;
}

export function collapse(board, rng, types) {
  let cur = cloneBoard(board);
  const rows = cur.length;
  const cols = rows ? cur[0].length : 0;
  const steps = [];

  while (true) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;

    const matchKeys = new Set(matches.map((m) => m.r + ',' + m.c));

    // Clear matched cells.
    const cleared = cur.map((row, r) => row.map((v, c) => (matchKeys.has(r + ',' + c) ? null : v)));

    // Gravity: survivors fall to the bottom of each column, preserving order.
    const next = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
      }
      const startRow = rows - survivors.length;
      for (let i = 0; i < survivors.length; i++) {
        next[startRow + i][c] = survivors[i];
      }
    }

    // Refill empties from the top, column-major left-to-right so neighbours
    // used for the "no new match" check are already finalised. Refills must
    // not themselves create a run of 3 (genuine cascades still happen next
    // loop iteration, from survivors closing gaps).
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (next[r][c] !== null) continue;
        const avoid = new Set();
        if (c >= 2 && next[r][c - 1] === next[r][c - 2]) avoid.add(next[r][c - 1]);
        if (r >= 2 && next[r - 1][c] === next[r - 2][c]) avoid.add(next[r - 1][c]);
        next[r][c] = pickAvoiding(rng, types, avoid);
      }
    }

    steps.push({ matches, board: next.map((row) => row.slice()) });
    cur = next;
  }

  return { board: cur, steps };
}

export function longestRun(board) {
  const rows = board.length;
  if (!rows) return 0;
  const cols = board[0].length;
  if (!cols) return 0;
  let max = 1;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c < cols; c++) {
      runLen = board[r][c] === board[r][c - 1] ? runLen + 1 : 1;
      if (runLen > max) max = runLen;
    }
  }
  for (let c = 0; c < cols; c++) {
    let runLen = 1;
    for (let r = 1; r < rows; r++) {
      runLen = board[r][c] === board[r - 1][c] ? runLen + 1 : 1;
      if (runLen > max) max = runLen;
    }
  }
  return max;
}

export function matchMultiplier(prev, longestRunLen) {
  if (longestRunLen < 4) return 1;
  return Math.max(prev, 1) * Math.pow(2, longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
