// Match-3 core logic — pure, deterministic given an injected rng.
// Board = rows x cols array of arrays of ints in [0, types).

/**
 * Would placing `v` at (r, c) in `grid` complete a run of 3+ (horizontal or
 * vertical)? `grid` may contain `null` for undetermined cells — a null
 * neighbour never contributes to a match (it will be checked in its own
 * right once it's decided).
 */
function wouldMatch(grid, r, c, v, rows, cols) {
  for (let start = c - 2; start <= c; start++) {
    if (start < 0 || start + 2 >= cols) continue;
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const cc = start + k;
      const val = cc === c ? v : grid[r][cc];
      if (val !== v) { ok = false; break; }
    }
    if (ok) return true;
  }
  for (let start = r - 2; start <= r; start++) {
    if (start < 0 || start + 2 >= rows) continue;
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const rr = start + k;
      const val = rr === r ? v : grid[rr][c];
      if (val !== v) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function pickValue(grid, r, c, types, rng, rows, cols) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const v = Math.floor(rng() * types);
    if (!wouldMatch(grid, r, c, v, rows, cols)) return v;
  }
  for (let v = 0; v < types; v++) {
    if (!wouldMatch(grid, r, c, v, rows, cols)) return v;
  }
  return Math.floor(rng() * types);
}

function generateMatchFreeBoard(rows, cols, types, rng) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c] = pickValue(grid, r, c, types, rng, rows, cols);
    }
  }
  return grid;
}

export function createBoard(rows, cols, types, rng) {
  let board;
  do {
    board = generateMatchFreeBoard(rows, cols, types, rng);
  } while (!hasValidMove(board));
  return board;
}

export function findMatches(board) {
  const rows = board.length, cols = board[0].length;
  const matched = new Set();

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

export function applySwap(board, a, b) {
  const copy = board.map((row) => [...row]);
  const tmp = copy[a.r][a.c];
  copy[a.r][a.c] = copy[b.r][b.c];
  copy[b.r][b.c] = tmp;
  return copy;
}

export function isValidSwap(board, a, b) {
  if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function hasValidMove(board) {
  const rows = board.length, cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/** Clear `matches`, drop survivors down per column, leave `null` holes at top. */
function gravity(board, matches) {
  const rows = board.length, cols = board[0].length;
  const cleared = new Set(matches.map(({ r, c }) => r + ',' + c));
  const next = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (!cleared.has(r + ',' + c)) survivors.push(board[r][c]);
    }
    const holeCount = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      next[holeCount + i][c] = survivors[i];
    }
  }
  return next;
}

function refill(grid, types, rng) {
  const rows = grid.length, cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === null) {
        grid[r][c] = pickValue(grid, r, c, types, rng, rows, cols);
      }
    }
  }
  return grid;
}

export function collapse(board, rng, types) {
  const rows = board.length, cols = board[0].length;
  let current = board.map((row) => [...row]);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const dropped = refill(gravity(current, matches), types, rng);
    steps.push({ matches, board: dropped });
    current = dropped;
  }

  if (!hasValidMove(current)) {
    let reshuffled;
    do {
      reshuffled = generateMatchFreeBoard(rows, cols, types, rng);
    } while (!hasValidMove(reshuffled));
    current = reshuffled;
  }

  return { board: current, steps };
}

export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}
