// game.js — pure, deterministic match-3 logic (no DOM, no Math.random).
// Board: rows x cols array of arrays of integers in 0..types-1.
// Cell: { r, c }. rng: () => float in [0, 1).

/** Full board with no matches and at least one valid move. */
export function createBoard(rows, cols, types, rng) {
  let board;
  let guard = 0;
  do {
    board = generateNoMatchBoard(rows, cols, types, rng);
    guard += 1;
  } while (!hasValidMove(board) && guard < 500);
  return board;
}

function generateNoMatchBoard(rows, cols, types, rng) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const forbidden = new Set();
      if (c >= 2 && row[c - 1] === row[c - 2]) forbidden.add(row[c - 1]);
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) forbidden.add(board[r - 1][c]);
      row.push(pickType(rng, types, forbidden));
    }
    board.push(row);
  }
  return board;
}

function pickType(rng, types, forbidden) {
  const options = [];
  for (let t = 0; t < types; t++) if (!forbidden.has(t)) options.push(t);
  const pool = options.length ? options : Array.from({ length: types }, (_, t) => t);
  return pool[Math.floor(rng() * pool.length)];
}

/** Every cell that is part of any horizontal or vertical run of length >= 3. */
export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const marked = new Set();

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

  const result = [];
  for (const key of marked) {
    const [r, c] = key.split(',').map(Number);
    result.push({ r, c });
  }
  return result;
}

/** true iff a/b are orthogonally adjacent AND swapping them yields >= 1 match. */
export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/** true iff some orthogonally-adjacent swap on board would create a match. */
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

/** A new board with the values at a and b exchanged. Pure. */
export function applySwap(board, a, b) {
  const out = board.map((row) => row.slice());
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/**
 * Repeatedly clear matches, drop survivors, refill from the top, until the
 * board is full and match-free. Returns { board, steps }.
 */
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const resolvedTypes = types ?? (Math.max(0, ...board.flat()) + 1);

  let current = board.map((row) => row.slice());
  const steps = [];
  let guard = 0;

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const cleared = current.map((row) => row.slice());
    for (const { r, c } of matches) cleared[r][c] = null;

    const next = gravityAndRefill(cleared, rows, cols, resolvedTypes, rng);
    steps.push({ matches, board: next.map((row) => row.slice()) });
    current = next;

    guard += 1;
    if (guard > 1000) break; // safety valve; should never trigger
  }

  return { board: current, steps };
}

function gravityAndRefill(cleared, rows, cols, types, rng) {
  const result = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
    }
    const numNew = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      result[numNew + i][c] = survivors[i];
    }
    for (let r = 0; r < numNew; r++) {
      const forbidden = forbiddenAt(result, r, c, rows);
      result[r][c] = pickType(rng, types, forbidden);
    }
  }

  return result;
}

function forbiddenAt(result, r, c, rows) {
  const forbidden = new Set();
  // vertical: two above already equal
  if (r >= 2 && result[r - 1][c] !== null && result[r - 1][c] === result[r - 2][c]) {
    forbidden.add(result[r - 1][c]);
  }
  // vertical: two below (survivors, already known) already equal
  if (r + 2 < rows && result[r + 1][c] !== null && result[r + 1][c] === result[r + 2][c]) {
    forbidden.add(result[r + 1][c]);
  }
  // vertical sandwich: one above and one below equal to each other
  if (r >= 1 && r + 1 < rows && result[r - 1][c] !== null && result[r + 1][c] !== null &&
      result[r - 1][c] === result[r + 1][c]) {
    forbidden.add(result[r - 1][c]);
  }
  // horizontal: two to the left already equal
  if (c >= 2 && result[r][c - 1] !== null && result[r][c - 1] === result[r][c - 2]) {
    forbidden.add(result[r][c - 1]);
  }
  return forbidden;
}

/** Length of the longest straight run of identical values, 0/1 for trivial boards. */
export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  if (cols === 0) return 0;

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

/** Persistent multiplier after a move: L<4 resets to 1; L>=4 compounds by 2^(L-3). */
export function matchMultiplier(prev, longestRunLen) {
  if (longestRunLen < 4) return 1;
  return Math.max(prev, 1) * 2 ** (longestRunLen - 3);
}

/** 0-based stage index: a new stage every 100,000 points. */
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
