// Pure match-3 logic module. No Math.random — rng is always injected.

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const matched = new Set();

  // horizontal runs
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

  // vertical runs
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

  return [...matched].map((s) => {
    const [r, c] = s.split(',').map(Number);
    return { r, c };
  });
}

export function isValidSwap(board, a, b) {
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

export function applySwap(board, a, b) {
  const nb = cloneBoard(board);
  const tmp = nb[a.r][a.c];
  nb[a.r][a.c] = nb[b.r][b.c];
  nb[b.r][b.c] = tmp;
  return nb;
}

function wouldConflict(nb, r, c, v) {
  if (c >= 2 && nb[r][c - 1] === v && nb[r][c - 2] === v) return true;
  if (r >= 2 && nb[r - 1][c] === v && nb[r - 2][c] === v) return true;
  return false;
}

function randomBoard(rows, cols, types, rng) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    board.push(row);
    for (let c = 0; c < cols; c++) {
      let v;
      let attempts = 0;
      do {
        v = Math.floor(rng() * types);
        attempts++;
      } while (attempts < 100 && wouldConflict(board, r, c, v));
      row.push(v);
    }
  }
  return board;
}

export function createBoard(rows, cols, types, rng) {
  let board;
  let attempts = 0;
  do {
    board = randomBoard(rows, cols, types, rng);
    attempts++;
  } while (!hasValidMove(board) && attempts < 1000);
  return board;
}

function clearCells(board, matches) {
  const nb = cloneBoard(board);
  for (const { r, c } of matches) nb[r][c] = -1;
  return nb;
}

function applyGravity(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const nb = cloneBoard(board);
  for (let c = 0; c < cols; c++) {
    const colVals = [];
    for (let r = 0; r < rows; r++) {
      if (nb[r][c] !== -1) colVals.push(nb[r][c]);
    }
    const missing = rows - colVals.length;
    for (let r = 0; r < rows; r++) {
      nb[r][c] = r < missing ? -1 : colVals[r - missing];
    }
  }
  return nb;
}

function refill(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const nb = cloneBoard(board);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (nb[r][c] === -1) {
        let v;
        let attempts = 0;
        do {
          v = Math.floor(rng() * types);
          attempts++;
        } while (attempts < 100 && wouldConflict(nb, r, c, v));
        nb[r][c] = v;
      }
    }
  }
  return nb;
}

export function collapse(board, rng, types) {
  let current = cloneBoard(board);
  const steps = [];
  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const cleared = clearCells(current, matches);
    const dropped = applyGravity(cleared);
    const refilled = refill(dropped, rng, types);
    steps.push({ matches, board: refilled });
    current = refilled;
  }
  return { board: current, steps };
}

export function longestRun(board) {
  if (!board || board.length === 0) return 0;
  const rows = board.length;
  const cols = board[0].length;
  let max = 1;

  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > max) max = run;
    }
  }

  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > max) max = run;
    }
  }

  return max;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
