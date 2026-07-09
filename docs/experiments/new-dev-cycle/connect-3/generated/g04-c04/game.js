// Pure match-3 logic. No DOM, no globals besides the injected `rng`.

// ---------- helpers ----------

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function dims(board) {
  return { rows: board.length, cols: board[0].length };
}

function isAdjacent(a, b) {
  return (
    (a.r === b.r && Math.abs(a.c - b.c) === 1) ||
    (a.c === b.c && Math.abs(a.r - b.r) === 1)
  );
}

// Pick a random type in [0, types) that avoids the given forbidden set when
// possible (falls back to any value if every type is forbidden, which can
// only happen for degenerate `types` counts).
function pickType(rng, types, forbidden) {
  if (forbidden.size >= types) return Math.floor(rng() * types);
  let v;
  let guard = 0;
  do {
    v = Math.floor(rng() * types);
    guard++;
  } while (forbidden.has(v) && guard < 1000);
  return v;
}

// ---------- core ----------

export function findMatches(board) {
  const { rows, cols } = dims(board);
  const matched = new Set();

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const sameAsStart = c < cols && board[r][c] === board[r][runStart];
      if (sameAsStart) continue;
      const runLen = c - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < c; k++) matched.add(`${r},${k}`);
      }
      runStart = c;
    }
  }

  // vertical runs
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const sameAsStart = r < rows && board[r][c] === board[runStart][c];
      if (sameAsStart) continue;
      const runLen = r - runStart;
      if (runLen >= 3) {
        for (let k = runStart; k < r; k++) matched.add(`${k},${c}`);
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
  const copy = cloneBoard(board);
  const tmp = copy[a.r][a.c];
  copy[a.r][a.c] = copy[b.r][b.c];
  copy[b.r][b.c] = tmp;
  return copy;
}

export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function hasValidMove(board) {
  const { rows, cols } = dims(board);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

// Build one full board, filled top-to-bottom / left-to-right, choosing each
// cell's value so it can't complete a horizontal or vertical triple with the
// two cells already placed to its left / above.
function generateMatchFreeBoard(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const forbidden = new Set();
      if (c >= 2 && board[r][c - 1] === board[r][c - 2]) {
        forbidden.add(board[r][c - 1]);
      }
      if (r >= 2 && board[r - 1][c] === board[r - 2][c]) {
        forbidden.add(board[r - 1][c]);
      }
      board[r][c] = pickType(rng, types, forbidden);
    }
  }
  return board;
}

function freshMatchFreePlayableBoard(rows, cols, types, rng) {
  let board;
  let guard = 0;
  do {
    board = generateMatchFreeBoard(rows, cols, types, rng);
    guard++;
  } while (!hasValidMove(board) && guard < 200);
  return board;
}

export function createBoard(rows, cols, types, rng) {
  return freshMatchFreePlayableBoard(rows, cols, types, rng);
}

// Clear `matches`, drop survivors down each column, and refill the vacated
// top cells from `rng`, choosing refill values that don't themselves create
// a new match (cascades still happen, but only from survivors landing next
// to each other — see thoughts.md).
function clearAndDrop(board, matches, types, rng) {
  const { rows, cols } = dims(board);
  const marked = cloneBoard(board);
  for (const { r, c } of matches) marked[r][c] = null;

  const result = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (marked[r][c] !== null) survivors.push(marked[r][c]);
    }
    const emptyCount = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      result[emptyCount + i][c] = survivors[i];
    }
    for (let r = emptyCount - 1; r >= 0; r--) {
      const forbidden = new Set();
      // horizontal: two already-resolved cells to the left in this row
      if (c >= 2 && result[r][c - 1] !== null && result[r][c - 2] !== null &&
          result[r][c - 1] === result[r][c - 2]) {
        forbidden.add(result[r][c - 1]);
      }
      // vertical: two already-resolved cells below in this column
      if (r + 2 < rows && result[r + 1][c] !== null && result[r + 2][c] !== null &&
          result[r + 1][c] === result[r + 2][c]) {
        forbidden.add(result[r + 1][c]);
      }
      result[r][c] = pickType(rng, types, forbidden);
    }
  }

  return result;
}

export function collapse(board, rng, types) {
  const { rows, cols } = dims(board);
  const resolvedTypes = types ?? (Math.max(0, ...board.flat()) + 1);
  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const next = clearAndDrop(current, matches, resolvedTypes, rng);
    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  if (!hasValidMove(current)) {
    current = freshMatchFreePlayableBoard(rows, cols, resolvedTypes, rng);
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
  for (let i = 1; i < waves.length; i++) {
    total += 2 * score(waves[i]);
  }
  return total;
}
