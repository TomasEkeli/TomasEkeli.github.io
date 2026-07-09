// game.js — pure logic module for the match-3 candidate g04-c02.
// No DOM, no globals beyond the injected `rng`. All exports are named.

/** Deep-ish clone of a board (array of arrays of ints). */
function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/**
 * findMatches(board) -> Array<{r, c}>
 * Every cell that is part of any horizontal or vertical run of length >= 3.
 * Each cell appears at most once.
 */
export function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const hit = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) hit[r][k] = true;
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
          for (let k = runStart; k < r; k++) hit[k][c] = true;
        }
        runStart = r;
      }
    }
  }

  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (hit[r][c]) out.push({ r, c });
    }
  }
  return out;
}

/**
 * isValidSwap(board, a, b) -> boolean
 * true iff a and b are orthogonally adjacent AND swapping them yields >= 1 match.
 */
export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  const adjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  if (!adjacent) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * applySwap(board, a, b) -> board
 * A new board with the values at a and b exchanged. Does not mutate the input.
 */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/**
 * hasValidMove(board) -> boolean
 * true iff some orthogonally-adjacent swap would create at least one match.
 */
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

/**
 * createBoard(rows, cols, types, rng) -> board
 * A full board with no matches and at least one valid move.
 */
export function createBoard(rows, cols, types, rng) {
  let board;
  do {
    board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        // Avoid creating a run of 3 as we go, to keep the loop count low.
        let v;
        let attempts = 0;
        do {
          v = randInt(rng, types);
          attempts++;
        } while (
          attempts < 50 &&
          ((c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
            (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v))
        );
        row.push(v);
      }
      board.push(row);
    }
  } while (findMatches(board).length > 0 || !hasValidMove(board));
  return board;
}

/**
 * Apply gravity: within each column, surviving (non-null) gems fall to the
 * bottom, empties bubble to the top, then refill the empties from `types`
 * without creating a match against the settled neighbours below/beside.
 */
function dropAndRefill(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (board[r][c] !== null) survivors.push(board[r][c]);
    }
    const emptyCount = rows - survivors.length;
    // Place survivors at the bottom.
    for (let i = 0; i < survivors.length; i++) {
      out[emptyCount + i][c] = survivors[i];
    }
    // Refill from the top down, avoiding immediate matches where possible.
    for (let r = emptyCount - 1; r >= 0; r--) {
      let v;
      let attempts = 0;
      do {
        v = randInt(rng, types);
        attempts++;
      } while (
        attempts < 50 &&
        ((r + 1 < rows && r + 2 < rows && out[r + 1][c] === v && out[r + 2][c] === v) ||
          (c >= 2 && out[r][c - 1] === v && out[r][c - 2] === v))
      );
      out[r][c] = v;
    }
  }
  return out;
}

/**
 * collapse(board, rng, types) -> { board, steps }
 */
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const inferredTypes =
    typeof types === 'number'
      ? types
      : Math.max(...board.flat()) + 1;

  const steps = [];
  let current = cloneBoard(board);

  for (;;) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const cleared = cloneBoard(current);
    for (const { r, c } of matches) cleared[r][c] = null;

    const next = dropAndRefill(cleared, rng, inferredTypes);
    steps.push({ matches, board: next });
    current = next;
  }

  // No-deadlock guarantee: reshuffle the final board only (not steps) until
  // it has a valid move. Keep it match-free too.
  let finalBoard = current;
  let guard = 0;
  while (!hasValidMove(finalBoard) && guard < 1000) {
    finalBoard = reshuffle(finalBoard, rng, inferredTypes);
    guard++;
  }

  return { board: finalBoard, steps };
}

/** Reshuffle a board's existing values (or regenerate) until match-free + playable. */
function reshuffle(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const flat = board.flat();
  let attempt = 0;
  let candidate;
  do {
    // Fisher-Yates shuffle of the flat values.
    const arr = flat.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    candidate = [];
    for (let r = 0; r < rows; r++) {
      candidate.push(arr.slice(r * cols, (r + 1) * cols));
    }
    attempt++;
    if (attempt > 200) {
      // Give up shuffling existing values; generate a fresh board instead.
      return createBoard(rows, cols, types, rng);
    }
  } while (findMatches(candidate).length > 0 || !hasValidMove(candidate));
  return candidate;
}

/**
 * score(matches) -> number
 * n < 3 ? 0 : 100 * (3 + n*(n-3)/2)
 */
export function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

/**
 * scoreCascade(waves) -> number
 * First wave face value; every later wave doubled.
 */
export function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) {
    total += 2 * score(waves[i]);
  }
  return total;
}
