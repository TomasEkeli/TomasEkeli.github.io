// game.js — pure, deterministic match-3 logic. No Math.random anywhere; all
// randomness comes through the injected `rng` argument.

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function isAdjacent(a, b) {
  return (
    (a.r === b.r && Math.abs(a.c - b.c) === 1) ||
    (a.c === b.c && Math.abs(a.r - b.r) === 1)
  );
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const matched = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][runStart]) continue;
      const runLen = c - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
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
        for (let k = runStart; k < r; k++) matched.add(k + ',' + c);
      }
      runStart = r;
    }
  }

  return [...matched].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

export function applySwap(board, a, b) {
  const next = board.map((row) => row.slice());
  const tmp = next[a.r][a.c];
  next[a.r][a.c] = next[b.r][b.c];
  next[b.r][b.c] = tmp;
  return next;
}

export function isValidSwap(board, a, b) {
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  if (!isAdjacent(a, b)) return false;
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

function genFilledBoard(rows, cols, types, rng) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let v = 0;
      let attempts = 0;
      do {
        v = Math.floor(rng() * types);
        attempts++;
      } while (
        attempts < 60 &&
        ((c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
          (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v))
      );
      row.push(v);
    }
    board.push(row);
  }
  return board;
}

export function createBoard(rows, cols, types, rng) {
  let board;
  let tries = 0;
  do {
    board = genFilledBoard(rows, cols, types, rng);
    tries++;
  } while ((findMatches(board).length > 0 || !hasValidMove(board)) && tries < 500);
  return board;
}

function applyGravityAndRefill(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const next = board.map((row) => row.slice());

  for (let c = 0; c < cols; c++) {
    const surviving = [];
    for (let r = rows - 1; r >= 0; r--) {
      if (next[r][c] !== null) surviving.push(next[r][c]);
    }
    for (let r = rows - 1, i = 0; r >= 0; r--, i++) {
      next[r][c] = i < surviving.length ? surviving[i] : null;
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (next[r][c] !== null) continue;
      let v = 0;
      let attempts = 0;
      do {
        v = Math.floor(rng() * types);
        attempts++;
      } while (
        attempts < 60 &&
        ((c >= 2 && next[r][c - 1] === v && next[r][c - 2] === v) ||
          (r >= 2 && next[r - 1][c] === v && next[r - 2][c] === v))
      );
      next[r][c] = v;
    }
  }

  return next;
}

export function collapse(board, rng, types) {
  let current = board.map((row) => row.slice());
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const cleared = current.map((row) => row.slice());
    for (const { r, c } of matches) cleared[r][c] = null;
    const next = applyGravityAndRefill(cleared, rng, types);
    steps.push({ matches, board: next });
    current = next;
  }

  return { board: current, steps };
}

export function longestRun(board) {
  if (!board || board.length === 0) return 0;
  const rows = board.length;
  const cols = board[0].length;
  if (cols === 0) return 0;
  let best = 0;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        runLen++;
      } else {
        if (runLen > best) best = runLen;
        runLen = 1;
      }
    }
  }

  for (let c = 0; c < cols; c++) {
    let runLen = 1;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[r - 1][c]) {
        runLen++;
      } else {
        if (runLen > best) best = runLen;
        runLen = 1;
      }
    }
  }

  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  if (longestRunLen < 4) return 1;
  return Math.max(prev, 1) * Math.pow(2, longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.floor(Math.max(0, score) / 100000);
}
