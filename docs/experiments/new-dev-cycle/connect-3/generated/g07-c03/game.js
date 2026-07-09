// game.js — pure, deterministic match-3 logic. No Math.random here; rng is injected.

function inBounds(rows, cols, r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * findMatches(board) -> Array<{r, c}>
 * Every cell that is part of any horizontal or vertical run of length >= 3.
 */
export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const len = c - runStart;
        if (len >= 3) {
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
        const len = r - runStart;
        if (len >= 3) {
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
 */
export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/**
 * hasValidMove(board) -> boolean
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
 * applySwap(board, a, b) -> new board
 */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function randInt(rng, n) {
  return Math.floor(rng() * n) % n;
}

/**
 * createBoard(rows, cols, types, rng) -> board
 * A full board with no matches and at least one valid move.
 */
export function createBoard(rows, cols, types, rng) {
  // Loop until we get a match-free, playable board (extremely likely on first try).
  for (let attempt = 0; attempt < 200; attempt++) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const banned = new Set();
        if (c >= 2 && board[r][c - 1] === board[r][c - 2]) banned.add(board[r][c - 1]);
        if (r >= 2 && board[r - 1][c] === board[r - 2][c]) banned.add(board[r - 1][c]);
        let v = randInt(rng, types);
        let guard = 0;
        while (banned.has(v) && banned.size < types && guard < 50) {
          v = randInt(rng, types);
          guard++;
        }
        board[r][c] = v;
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // Fallback: extremely unlikely to reach here with types >= 3.
  const board = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) board[r][c] = (r + c) % types;
  return board;
}

/**
 * longestRun(board) -> number
 */
export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  let max = 0;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        runLen++;
      } else {
        if (runLen > max) max = runLen;
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
        if (runLen > max) max = runLen;
        runLen = 1;
      }
    }
  }
  return max;
}

/**
 * matchMultiplier(prev, longestRunLen) -> number
 */
export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

/**
 * stageForScore(score) -> number
 */
export function stageForScore(score) {
  return Math.floor(Math.max(0, score) / 100000);
}

// --- collapse ---------------------------------------------------------

function dedupeMatches(cells) {
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    const key = `${cell.r},${cell.c}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cell);
    }
  }
  return out;
}

// Would placing `value` at (r, c) create an immediate run of 3? Columns to
// the left of `c` are fully resolved (columns fill left-to-right), and within
// a column the refill order runs from the gap's bottom upward, so rows below
// `r` are already decided while rows above are not — only left and below are
// meaningful checks at fill time.
function wouldMatch(board, rows, cols, r, c, value) {
  if (c >= 2 && board[r][c - 1] === value && board[r][c - 2] === value) return true;
  if (r <= rows - 3 && board[r + 1][c] === value && board[r + 2][c] === value) return true;
  return false;
}

function gravityAndRefill(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(null));

  // Gravity: compact surviving (non-null) values to the bottom of each column.
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (board[r][c] !== null && board[r][c] !== undefined) survivors.push(board[r][c]);
    }
    const gap = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      out[gap + i][c] = survivors[i];
    }
    // Refill the gap from the bottom of the gap upward (closest to the
    // survivors first), so the "already decided" neighbour below is known.
    for (let r = gap - 1; r >= 0; r--) {
      let v = randInt(rng, types);
      let guard = 0;
      while (wouldMatch(out, rows, cols, r, c, v) && guard < 50) {
        v = randInt(rng, types);
        guard++;
      }
      out[r][c] = v;
    }
  }

  // Safety pass: fix any accidental horizontal matches introduced by refills
  // sitting side-by-side in freshly-filled rows (columns were resolved
  // independently, so a horizontal triple across columns is possible).
  for (let pass = 0; pass < 10; pass++) {
    const matches = findMatches(out);
    if (matches.length === 0) break;
    for (const { r, c } of matches) {
      let v = randInt(rng, types);
      let guard = 0;
      while (guard < 50 && (
        (c >= 1 && out[r][c - 1] === v) ||
        (c <= cols - 2 && out[r][c + 1] === v) ||
        (r >= 1 && out[r - 1][c] === v) ||
        (r <= rows - 2 && out[r + 1][c] === v)
      )) {
        v = randInt(rng, types);
        guard++;
      }
      out[r][c] = v;
    }
  }

  return out;
}

/**
 * collapse(board, rng, types) -> { board, steps }
 */
export function collapse(board, rng, types) {
  const t = types ?? (Math.max(0, ...board.flat()) + 1);
  let current = cloneBoard(board);
  const steps = [];

  for (let guard = 0; guard < 200; guard++) {
    const matches = dedupeMatches(findMatches(current));
    if (matches.length === 0) break;
    const cleared = cloneBoard(current);
    for (const { r, c } of matches) cleared[r][c] = null;
    const next = gravityAndRefill(cleared, rng, t);
    steps.push({ matches, board: next });
    current = next;
  }

  return { board: current, steps };
}
