// game.js — pure, deterministic match-3 logic. No DOM, no globals.
// A board is a rows x cols array of arrays of ints in [0, types).
// A cell coordinate is { r, c }. `rng` is a function returning a float in [0,1).

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// Every cell that belongs to a horizontal or vertical run of length >= 3.
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const marked = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][start]) continue;
      if (c - start >= 3) {
        for (let k = start; k < c; k++) marked.add(r * cols + k);
      }
      start = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[start][c]) continue;
      if (r - start >= 3) {
        for (let k = start; k < r; k++) marked.add(k * cols + c);
      }
      start = r;
    }
  }

  return [...marked].map((idx) => ({ r: Math.floor(idx / cols), c: idx % cols }));
}

// A new board with the values at a and b exchanged. Pure — does not mutate.
export function applySwap(board, a, b) {
  const out = board.map((row) => row.slice());
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// true iff a and b are orthogonally adjacent AND swapping them yields >= 1 match.
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

// true iff some orthogonally-adjacent swap on `board` would create a match.
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

// Points for one wave of matched cells.
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

// Total points across a full move's cascade waves; every wave after the
// first (the swap's own match) exists only because gems dropped and scores double.
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}

// Compute the set of values forbidden at (r, c) because placing them would
// immediately complete a run of 3 with already-determined neighbours
// (grid cells holding `null` are not yet decided and are ignored).
function forbiddenValues(grid, r, c, rows, cols) {
  const forbidden = new Set();

  const hOffsets = [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ];
  for (const [o1, o2] of hOffsets) {
    const c1 = c + o1;
    const c2 = c + o2;
    if (c1 >= 0 && c1 < cols && c2 >= 0 && c2 < cols) {
      const v1 = grid[r][c1];
      const v2 = grid[r][c2];
      if (v1 !== null && v2 !== null && v1 === v2) forbidden.add(v1);
    }
  }

  const vOffsets = [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ];
  for (const [o1, o2] of vOffsets) {
    const r1 = r + o1;
    const r2 = r + o2;
    if (r1 >= 0 && r1 < rows && r2 >= 0 && r2 < rows) {
      const v1 = grid[r1][c];
      const v2 = grid[r2][c];
      if (v1 !== null && v2 !== null && v1 === v2) forbidden.add(v1);
    }
  }

  return forbidden;
}

function pickValue(grid, r, c, rows, cols, types, rng) {
  const forbidden = forbiddenValues(grid, r, c, rows, cols);
  const allowed = [];
  for (let v = 0; v < types; v++) if (!forbidden.has(v)) allowed.push(v);
  const pool = allowed.length ? allowed : Array.from({ length: types }, (_, v) => v);
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx];
}

// A full board with no matches and at least one valid move. A starting board
// must never be a deadlock; reshuffle internally until both hold.
export function createBoard(rows, cols, types, rng) {
  let board;
  let attempts = 0;
  do {
    board = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickValue(board, r, c, rows, cols, types, rng);
      }
    }
    attempts++;
  } while ((findMatches(board).length > 0 || !hasValidMove(board)) && attempts < 1000);
  return board;
}

// Repeatedly clear matches, drop survivors, refill from the top, until the
// board is full and match-free. Returns { board, steps }. `types` is used
// explicitly for refills — never inferred from the board's current contents.
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  let current = board.map((row) => row.slice());
  const steps = [];

  let matches = findMatches(current);
  while (matches.length > 0) {
    const grid = current.map((row) => row.slice());
    for (const { r, c } of matches) grid[r][c] = null;

    // Gravity: compact survivors to the bottom of each column, in order.
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) if (grid[r][c] !== null) survivors.push(grid[r][c]);
      const nullCount = rows - survivors.length;
      for (let r = 0; r < rows; r++) {
        grid[r][c] = r < nullCount ? null : survivors[r - nullCount];
      }
    }

    // Refill empties from the top, avoiding self-created matches.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === null) grid[r][c] = pickValue(grid, r, c, rows, cols, types, rng);
      }
    }

    steps.push({ matches, board: grid.map((row) => row.slice()) });
    current = grid;
    matches = findMatches(current);
  }

  return { board: current, steps };
}
