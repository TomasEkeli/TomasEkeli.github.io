// game.js — pure logic module for the match-3 candidate g04-c03.
// Named ES-module exports per context/spec/contract.md.

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * findMatches(board) -> Array<{r, c}>
 * Every cell that is part of any horizontal or vertical run of length >= 3.
 * Each cell appears at most once.
 */
function findMatches(board) {
  const rows = board.length;
  const cols = board[0].length;
  const matched = new Set();
  const key = (r, c) => `${r},${c}`;

  // Horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) matched.add(key(r, k));
        }
        runStart = c;
      }
    }
  }

  // Vertical runs
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] === board[runStart][c];
      if (!same) {
        const runLen = r - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < r; k++) matched.add(key(k, c));
        }
        runStart = r;
      }
    }
  }

  return [...matched].map((s) => {
    const [r, c] = s.split(',').map(Number);
    return { r, c };
  });
}

/**
 * isValidSwap(board, a, b) -> boolean
 */
function isValidSwap(board, a, b) {
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * hasValidMove(board) -> boolean
 */
function hasValidMove(board) {
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
 * applySwap(board, a, b) -> board (new board, pure)
 */
function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/**
 * createBoard(rows, cols, types, rng) -> board
 * No initial matches, and guaranteed at least one valid move.
 */
function createBoard(rows, cols, types, rng) {
  let board;
  do {
    board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let v;
        do {
          v = Math.floor(rng() * types);
          row[c] = v;
        } while (
          // avoid creating a horizontal run of 3
          (c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
          // avoid creating a vertical run of 3
          (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v)
        );
      }
      board.push(row);
    }
  } while (findMatches(board).length > 0 || !hasValidMove(board));
  return board;
}

/**
 * Fisher-Yates-ish reshuffle of a board's values (preserving multiset of
 * values), used to break deadlocks without changing overall colour counts.
 * Repeats until match-free and has a valid move.
 */
function reshuffleUntilPlayable(board, rng) {
  const rows = board.length;
  const cols = board[0].length;
  const flat = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) flat.push(board[r][c]);

  let attempts = 0;
  let candidate;
  do {
    // shuffle flat
    const arr = flat.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    candidate = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(arr[idx++]);
      candidate.push(row);
    }
    attempts++;
    // Safety valve: if pure shuffling struggles (e.g. degenerate colour
    // distribution), fall back to a fresh random board using the same types.
    if (attempts > 200) {
      const types = Math.max(...flat) + 1;
      candidate = createBoard(rows, cols, types, rng);
      break;
    }
  } while (findMatches(candidate).length > 0 || !hasValidMove(candidate));

  return candidate;
}

/**
 * collapse(board, rng, types) -> { board, steps }
 */
function collapse(board, rng, types) {
  const inferredTypes = types != null ? types : Math.max(...board.flat()) + 1;
  let current = cloneBoard(board);
  const steps = [];

  for (;;) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const rows = current.length;
    const cols = current[0].length;
    const cleared = new Set(matches.map((m) => `${m.r},${m.c}`));

    const next = [];
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (!cleared.has(`${r},${c}`)) survivors.push(current[r][c]);
      }
      const missing = rows - survivors.length;
      const refills = [];
      for (let i = 0; i < missing; i++) {
        refills.push(Math.floor(rng() * inferredTypes));
      }
      const column = refills.concat(survivors);
      for (let r = 0; r < rows; r++) {
        if (!next[r]) next[r] = [];
        next[r][c] = column[r];
      }
    }

    // Ensure refilled cells don't themselves create new matches: re-roll
    // any refilled cell (top rows that were newly filled) that participates
    // in a match, up to a bounded number of attempts per cell.
    for (let c = 0; c < cols; c++) {
      const missingCountForCol = (() => {
        let cnt = 0;
        for (let r = 0; r < rows; r++) {
          if (!cleared.has(`${r},${c}`)) continue;
          cnt++;
        }
        return cnt;
      })();
      for (let r = 0; r < missingCountForCol; r++) {
        let guard = 0;
        while (guard < 50 && cellCreatesMatch(next, r, c)) {
          next[r][c] = Math.floor(rng() * inferredTypes);
          guard++;
        }
      }
    }

    current = next;
    steps.push({ matches, board: cloneBoard(current) });
  }

  if (!hasValidMove(current)) {
    current = reshuffleUntilPlayable(current, rng);
  }

  return { board: current, steps };
}

// Helper: would board[r][c] (as currently set) be part of a match given
// its neighbours? Cheap local check used only to avoid refills creating
// immediate matches.
function cellCreatesMatch(board, r, c) {
  const v = board[r][c];
  const rows = board.length;
  const cols = board[0].length;

  // horizontal
  let run = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) run++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) run++;
  if (run >= 3) return true;

  // vertical
  run = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) run++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) run++;
  if (run >= 3) return true;

  return false;
}

/**
 * score(matches) -> number
 */
function score(matches) {
  const n = matches.length;
  if (n < 3) return 0;
  return 100 * (3 + (n * (n - 3)) / 2);
}

/**
 * scoreCascade(waves) -> number
 */
function scoreCascade(waves) {
  if (waves.length === 0) return 0;
  let total = score(waves[0]);
  for (let i = 1; i < waves.length; i++) {
    total += 2 * score(waves[i]);
  }
  return total;
}

export {
  createBoard,
  findMatches,
  isValidSwap,
  hasValidMove,
  applySwap,
  collapse,
  score,
  scoreCascade,
};
