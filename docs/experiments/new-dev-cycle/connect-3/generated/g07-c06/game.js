// Pure match-3 logic. No DOM, no Math.random — rng is always injected.

export function createBoard(rows, cols, types, rng) {
  const MAX_ATTEMPTS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const board = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let value;
        for (let tries = 0; tries < 30; tries++) {
          value = Math.floor(rng() * types);
          const horizBad = c >= 2 && board[r][c - 1] === value && board[r][c - 2] === value;
          const vertBad = r >= 2 && board[r - 1][c] === value && board[r - 2][c] === value;
          if (!horizBad && !vertBad) break;
        }
        board[r][c] = value;
      }
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) {
      return board;
    }
  }
  // Extremely unlikely fallback: return whatever the last attempt produced
  // rather than loop forever; findMatches/hasValidMove already re-checked above.
  const board = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) board[r][c] = Math.floor(rng() * types);
  }
  return board;
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
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

export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

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

export function applySwap(board, a, b) {
  const next = board.map((row) => row.slice());
  const tmp = next[a.r][a.c];
  next[a.r][a.c] = next[b.r][b.c];
  next[b.r][b.c] = tmp;
  return next;
}

export function collapse(board, rng, types) {
  const resolvedTypes = types ?? (Math.max(0, ...board.flat()) + 1);
  let current = board.map((row) => row.slice());
  const steps = [];

  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const rows = current.length;
    const cols = rows ? current[0].length : 0;
    const cleared = current.map((row) => row.slice());
    for (const { r, c } of matches) cleared[r][c] = null;

    const next = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = 0; r < rows; r++) {
        if (cleared[r][c] !== null) survivors.push(cleared[r][c]);
      }
      const startRow = rows - survivors.length;
      for (let i = 0; i < survivors.length; i++) next[startRow + i][c] = survivors[i];

      for (let r = 0; r < startRow; r++) {
        let candidate = 0;
        for (let tries = 0; tries < 20; tries++) {
          candidate = Math.floor(rng() * resolvedTypes);
          const leftBad = c >= 2 && next[r][c - 1] === candidate && next[r][c - 2] === candidate;
          const upBad = r >= 2 && next[r - 1][c] === candidate && next[r - 2][c] === candidate;
          if (!leftBad && !upBad) break;
        }
        next[r][c] = candidate;
      }
    }

    steps.push({ matches: matches.map(({ r, c }) => ({ r, c })), board: next });
    current = next;
  }

  return { board: current, steps };
}

export function longestRun(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  if (rows === 0 || cols === 0) return 0;

  let max = 1;

  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][runStart]) continue;
      max = Math.max(max, c - runStart);
      runStart = c;
    }
  }

  for (let c = 0; c < cols; c++) {
    let runStart = 0;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[runStart][c]) continue;
      max = Math.max(max, r - runStart);
      runStart = r;
    }
  }

  return max;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
