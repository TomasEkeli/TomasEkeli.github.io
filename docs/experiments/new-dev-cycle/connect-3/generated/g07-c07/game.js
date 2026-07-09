// game.js — pure logic module for the neon-noir rainy-night match-3.
// No Math.random anywhere; rng is always injected.

const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: -1, dc: 0 },
];

function inBounds(rows, cols, r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/**
 * findMatches(board) -> Array<{r,c}>
 * Every cell that is part of any horizontal or vertical run of length >= 3.
 */
export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const marked = new Set();

  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          for (let k = runStart; k < c; k++) marked.add(`${r},${k}`);
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
          for (let k = runStart; k < r; k++) marked.add(`${k},${c}`);
        }
        runStart = r;
      }
    }
  }

  return [...marked].map((key) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c };
  });
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/** applySwap(board, a, b) -> new board with a/b values exchanged. */
export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

/** isValidSwap(board, a, b) -> boolean */
export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

/** hasValidMove(board) -> boolean */
export function hasValidMove(board) {
  const rows = board.length;
  if (rows === 0) return false;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

/** longestRun(board) -> number */
export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  let best = 0;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        runLen++;
      } else {
        if (c > 0) best = Math.max(best, runLen);
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
        if (r > 0) best = Math.max(best, runLen);
        runLen = 1;
      }
    }
  }

  return best === 0 ? (rows * cols > 0 ? 1 : 0) : best;
}

/** matchMultiplier(prev, longestRunLen) -> number */
export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(base / 2));
  return base * 2 ** (longestRunLen - 3);
}

/** stageForScore(score) -> number */
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

function randInt(rng, n) {
  return Math.floor(rng() * n) % n;
}

function wouldMatchAt(board, r, c, value) {
  const rows = board.length;
  const cols = board[0].length;
  // Horizontal check: look left two.
  if (c >= 2 && board[r][c - 1] === value && board[r][c - 2] === value) return true;
  if (r >= 2 && board[r - 1][c] === value && board[r - 2][c] === value) return true;
  return false;
}

/** createBoard(rows, cols, types, rng) -> board, no matches, playable. */
export function createBoard(rows, cols, types, rng) {
  let board;
  let attempts = 0;
  do {
    board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let value;
        let tries = 0;
        do {
          value = randInt(rng, types);
          tries++;
        } while (wouldMatchAt(board.concat([row]), r, c, value) && tries < 50);
        row.push(value);
      }
      board.push(row);
    }
    attempts++;
  } while ((findMatches(board).length > 0 || !hasValidMove(board)) && attempts < 200);
  return board;
}

/**
 * collapse(board, rng, types) -> { board, steps }
 * Repeatedly clears matches, drops survivors, refills from top.
 */
export function collapse(board, rng, types) {
  const inferredTypes = types != null ? types : (() => {
    let max = 0;
    for (const row of board) for (const v of row) max = Math.max(max, v);
    return max + 1;
  })();

  let current = cloneBoard(board);
  const steps = [];

  for (;;) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const rows = current.length;
    const cols = current[0].length;
    const cleared = new Set(matches.map((m) => `${m.r},${m.c}`));

    // Clear + apply gravity per column; track which cells are fresh refills.
    const next = current.map((row) => row.slice());
    const refilled = new Set();
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (!cleared.has(`${r},${c}`)) survivors.push(next[r][c]);
      }
      const missing = rows - survivors.length;
      const refill = [];
      for (let i = 0; i < missing; i++) {
        refill.push(randInt(rng, inferredTypes));
        refilled.add(`${i},${c}`);
      }
      const newCol = refill.concat(survivors);
      for (let r = 0; r < rows; r++) {
        next[r][c] = newCol[r];
      }
    }

    // Refilled gems must not themselves create a match. Re-roll any refilled
    // cell that participates in a match (checking the full board in both
    // directions, since survivors below/around it are already final), bounded
    // so it always terminates.
    for (let guard = 0; guard < 200; guard++) {
      const badMatches = findMatches(next).filter((m) => refilled.has(`${m.r},${m.c}`));
      if (badMatches.length === 0) break;
      for (const { r, c } of badMatches) {
        next[r][c] = randInt(rng, inferredTypes);
      }
    }

    steps.push({ matches, board: cloneBoard(next) });
    current = next;
  }

  return { board: current, steps };
}
