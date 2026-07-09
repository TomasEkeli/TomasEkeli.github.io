// game.js — pure, deterministic match-3 core. No Math.random, no DOM.

function range(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr + dc) === 1;
}

/** Every cell that participates in a horizontal or vertical run of length >= 3. */
export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();
  const out = [];
  const mark = (r, c) => {
    const k = `${r},${c}`;
    if (!hit.has(k)) {
      hit.add(k);
      out.push({ r, c });
    }
  };

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const len = c - runStart;
        if (len >= 3) {
          for (let k = runStart; k < c; k++) mark(r, k);
        }
        runStart = c;
      }
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] === board[runStart][c];
      if (!same) {
        const len = r - runStart;
        if (len >= 3) {
          for (let k = runStart; k < r; k++) mark(k, c);
        }
        runStart = r;
      }
    }
  }
  return out;
}

export function isValidSwap(board, a, b) {
  if (!isAdjacent(a, b)) return false;
  if (!inBounds(board, a.r, a.c) || !inBounds(board, b.r, b.c)) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

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

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function pickAvoiding(avoidSet, types, rng) {
  const candidates = range(types).filter((t) => !avoidSet.has(t));
  const pool = candidates.length ? candidates : range(types);
  return pool[Math.floor(rng() * pool.length)];
}

export function createBoard(rows, cols, types, rng) {
  let board;
  let guard = 0;
  do {
    board = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const avoid = new Set();
        if (c >= 2 && board[r][c - 1] === board[r][c - 2]) avoid.add(board[r][c - 1]);
        if (r >= 2 && board[r - 1][c] === board[r - 2][c]) avoid.add(board[r - 1][c]);
        board[r][c] = pickAvoiding(avoid, types, rng);
      }
    }
    guard++;
  } while ((findMatches(board).length > 0 || !hasValidMove(board)) && guard < 200);
  return board;
}

/**
 * Repeatedly clear matches, drop survivors, refill from the top, until the
 * board is full and match-free. Returns { board, steps }.
 */
export function collapse(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const effectiveTypes = (typeof types === 'number' && types > 0)
    ? types
    : 1 + board.reduce((m, row) => row.reduce((mm, v) => Math.max(mm, v), m), 0);

  let current = cloneBoard(board);
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const matchedSet = new Set(matches.map(({ r, c }) => `${r},${c}`));
    const next = Array.from({ length: rows }, () => new Array(cols).fill(null));

    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (!matchedSet.has(`${r},${c}`)) survivors.push(current[r][c]);
      }
      const numSurvivors = survivors.length;
      const startRow = rows - numSurvivors;
      for (let i = 0; i < numSurvivors; i++) {
        next[startRow + i][c] = survivors[i];
      }
      for (let r = startRow - 1; r >= 0; r--) {
        const avoid = new Set();
        if (c >= 2 && next[r][c - 1] != null && next[r][c - 1] === next[r][c - 2]) {
          avoid.add(next[r][c - 1]);
        }
        if (r + 2 < rows && next[r + 1][c] != null && next[r + 1][c] === next[r + 2][c]) {
          avoid.add(next[r + 1][c]);
        }
        next[r][c] = pickAvoiding(avoid, effectiveTypes, rng);
      }
    }

    steps.push({
      matches: matches.map(({ r, c }) => ({ r, c })),
      board: next.map((row) => row.slice()),
    });
    current = next;
  }

  return { board: current, steps };
}

export function longestRun(board) {
  const rows = board.length;
  if (rows === 0) return 0;
  const cols = board[0].length;
  if (cols === 0) return 0;
  let best = 1;

  for (let r = 0; r < rows; r++) {
    let runLen = 1;
    for (let c = 1; c < cols; c++) {
      if (board[r][c] === board[r][c - 1]) {
        runLen++;
      } else {
        runLen = 1;
      }
      if (runLen > best) best = runLen;
    }
  }
  for (let c = 0; c < cols; c++) {
    let runLen = 1;
    for (let r = 1; r < rows; r++) {
      if (board[r][c] === board[r - 1][c]) {
        runLen++;
      } else {
        runLen = 1;
      }
      if (runLen > best) best = runLen;
    }
  }
  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  if (longestRunLen < 4) {
    return Math.max(1, Math.floor(base / 2));
  }
  return base * (2 ** (longestRunLen - 3));
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
