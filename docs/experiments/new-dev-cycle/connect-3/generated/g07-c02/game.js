// Pure, deterministic match-3 core logic. No DOM, no Math.random.
// A board is a rows x cols array of arrays of ints in [0, types).

function inBounds(board, r, c) {
  return r >= 0 && r < board.length && c >= 0 && c < board[0].length;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const hit = new Set();

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] === board[r][runStart];
      if (!same) {
        const len = c - runStart;
        if (len >= 3) {
          for (let k = runStart; k < c; k++) hit.add(`${r},${k}`);
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
          for (let k = runStart; k < r; k++) hit.add(`${k},${c}`);
        }
        runStart = r;
      }
    }
  }

  return [...hit].map((key) => {
    const [r, c] = key.split(',').map(Number);
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
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// Choose a value for (r, c) that does not create an immediate horizontal or
// vertical triple, given that cells to the left (same row) and above (same
// column) are already finalised in the current fill order.
function pickNoImmediateMatch(board, r, c, types, rng) {
  const bad = new Set();
  if (c >= 2 && board[r][c - 1] !== null && board[r][c - 1] === board[r][c - 2]) {
    bad.add(board[r][c - 1]);
  }
  if (r >= 2 && board[r - 1][c] !== null && board[r - 1][c] === board[r - 2][c]) {
    bad.add(board[r - 1][c]);
  }
  const options = [];
  for (let t = 0; t < types; t++) if (!bad.has(t)) options.push(t);
  const pool = options.length ? options : Array.from({ length: types }, (_, i) => i);
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)];
}

export function createBoard(rows, cols, types, rng) {
  let board;
  let guard = 0;
  do {
    board = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = pickNoImmediateMatch(board, r, c, types, rng);
      }
    }
    guard++;
  } while (!hasValidMove(board) && guard < 5000);
  return board;
}

function applyGravity(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (let c = 0; c < cols; c++) {
    const survivors = [];
    for (let r = 0; r < rows; r++) {
      if (board[r][c] !== null) survivors.push(board[r][c]);
    }
    const missing = rows - survivors.length;
    for (let i = 0; i < survivors.length; i++) {
      out[missing + i][c] = survivors[i];
    }
  }
  return out;
}

function refill(board, rng, types) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const out = board.map((row) => row.slice());
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (out[r][c] === null) {
        out[r][c] = pickNoImmediateMatch(out, r, c, types, rng);
      }
    }
  }
  return out;
}

export function collapse(board, rng, types) {
  const resolvedTypes = types ?? (Math.max(0, ...board.flat()) + 1);
  let current = cloneBoard(board);
  const steps = [];

  for (;;) {
    const matches = findMatches(current);
    if (matches.length === 0) break;

    const cleared = current.map((row) => row.slice());
    for (const { r, c } of matches) cleared[r][c] = null;

    const dropped = applyGravity(cleared);
    const refilled = refill(dropped, rng, resolvedTypes);

    steps.push({ matches, board: refilled });
    current = refilled;
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
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }

  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }

  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(base / 2));
  return base * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
