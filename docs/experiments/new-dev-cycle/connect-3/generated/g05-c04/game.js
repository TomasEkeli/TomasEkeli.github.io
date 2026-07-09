// game.js — pure, deterministic match-3 logic. No DOM, no globals.
// A board is rows x cols array-of-arrays of ints in [0, types).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, cell) {
  return cell.r >= 0 && cell.r < board.length && cell.c >= 0 && cell.c < board[0].length;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/** Every cell that is part of any horizontal or vertical run of length >= 3. */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const matched = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const boundary = c === cols || board[r][c] !== board[r][runStart];
      if (boundary) {
        if (c - runStart >= 3) {
          for (let k = runStart; k < c; k++) matched.add(r + ',' + k);
        }
        runStart = c;
      }
    }
  }

  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const boundary = r === rows || board[r][c] !== board[runStart][c];
      if (boundary) {
        if (r - runStart >= 3) {
          for (let k = runStart; k < r; k++) matched.add(k + ',' + c);
        }
        runStart = r;
      }
    }
  }

  return [...matched].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

/** A new board with the values at a and b exchanged. Pure. */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/** true iff a/b are orthogonally adjacent and swapping them yields >= 1 match. */
export function isValidSwap(board, a, b) {
  if (!inBounds(board, a) || !inBounds(board, b)) return false;
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/** true iff some orthogonally-adjacent swap on board would create a match. */
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

function causesSeedMatch(board, r, c, value) {
  if (c >= 2 && board[r][c - 1] === value && board[r][c - 2] === value) return true;
  if (r >= 2 && board[r - 1][c] === value && board[r - 2][c] === value) return true;
  return false;
}

function buildMatchFreeBoard(rows, cols, types, rng) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    board.push(new Array(cols).fill(0));
    for (let c = 0; c < cols; c++) {
      let value = 0;
      let attempts = 0;
      do {
        value = Math.floor(rng() * types);
        attempts++;
      } while (attempts < 40 && causesSeedMatch(board, r, c, value));
      board[r][c] = value;
    }
  }
  return board;
}

/** A full rows x cols board, no matches, and at least one valid move. */
export function createBoard(rows, cols, types, rng) {
  let board = buildMatchFreeBoard(rows, cols, types, rng);
  let guard = 0;
  while (!hasValidMove(board) && guard < 200) {
    board = buildMatchFreeBoard(rows, cols, types, rng);
    guard++;
  }
  return board;
}

function refillWouldMatch(committed, newCol, survivors, i, c, missing, value) {
  // Horizontal: two already-committed neighbours to the left.
  if (c >= 2 && committed[i][c - 1] === value && committed[i][c - 2] === value) return true;
  // Vertical: two refills already placed above (within this column, top-down).
  if (i >= 2 && newCol[i - 1] === value && newCol[i - 2] === value) return true;
  // Boundary with the surviving stack directly below the last refill.
  if (i === missing - 1) {
    if (survivors.length >= 2 && survivors[0] === value && survivors[1] === value) return true;
    if (i >= 1 && newCol[i - 1] === value && survivors.length >= 1 && survivors[0] === value) {
      return true;
    }
  }
  return false;
}

/**
 * Repeatedly clear matches, drop survivors, refill from the top, until the
 * board is full and match-free. Returns { board, steps }.
 */
export function collapse(board, rng, types) {
  let current = cloneBoard(board);
  const rows = current.length;
  const cols = current[0].length;
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const cleared = cloneBoard(current);
    for (const { r, c } of matches) cleared[r][c] = null;

    const next = cleared.map((row) => row.slice());

    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
      }
      const missing = rows - survivors.length;
      const newCol = new Array(rows);

      for (let i = 0; i < missing; i++) {
        let value = 0;
        let attempts = 0;
        do {
          value = Math.floor(rng() * types);
          attempts++;
        } while (
          attempts < 40 &&
          refillWouldMatch(next, newCol, survivors, i, c, missing, value)
        );
        newCol[i] = value;
      }
      for (let k = 0; k < survivors.length; k++) newCol[missing + k] = survivors[k];
      for (let r = 0; r < rows; r++) next[r][c] = newCol[r];
    }

    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  return { board: current, steps };
}

/** Points for one wave of matched cells. */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

/** Total points for a move: first wave face value, later waves doubled. */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) total += 2 * score(waves[i]);
  return total;
}
