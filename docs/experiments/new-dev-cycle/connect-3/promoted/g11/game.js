// Zephyr Gardens — pure match-3 logic (ES module, no DOM, no globals).
// A board is rows × cols of ints in 0..types-1. Coordinates are {r, c}.
// rng is a function returning floats in [0, 1).

export const FAVOUR_WEIGHT = 2;

// ---------------------------------------------------------------- primitives

export function typesForStage(stage) {
  return Math.min(4 + stage, 6);
}

export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  return longestRunLen < 4
    ? Math.max(1, Math.floor(p / 2))
    : p * 2 ** (longestRunLen - 3);
}

// ------------------------------------------------------------------- drawing

export function nextColour(rng, types, favour) {
  const valid = Number.isInteger(favour) && favour >= 0 && favour < types;
  if (!valid) return Math.floor(rng() * types); // single uniform draw
  const total = types - 1 + FAVOUR_WEIGHT;
  let x = rng() * total;
  for (let t = 0; t < types; t++) {
    const w = t === favour ? FAVOUR_WEIGHT : 1;
    if (x < w) return t;
    x -= w;
  }
  return types - 1; // float-edge guard
}

export function refillQueue(rng, types, favour, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = nextColour(rng, types, favour);
  return out;
}

// -------------------------------------------------------------------- board

function copyBoard(board) {
  return board.map((row) => [...row]);
}

export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const b = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let v;
        let guard = 0;
        do {
          v = Math.floor(rng() * types);
          guard++;
          if (guard > 100) {
            // deterministic fallback: first colour that avoids a run
            for (let t = 0; t < types; t++) {
              const bad =
                (c >= 2 && row[c - 1] === t && row[c - 2] === t) ||
                (r >= 2 && b[r - 1][c] === t && b[r - 2][c] === t);
              if (!bad) { v = t; break; }
            }
            break;
          }
        } while (
          (c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
          (r >= 2 && b[r - 1][c] === v && b[r - 2][c] === v)
        );
        row.push(v);
      }
      b.push(row);
    }
    if (findMatches(b).length === 0 && hasValidMove(b)) return b;
  }
}

export function findMatches(board) {
  const rows = board.length;
  if (!rows) return [];
  const cols = board[0].length;
  const hit = new Set();
  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c === cols || board[r][c] !== board[r][start] || board[r][start] == null) {
        if (board[r][start] != null && c - start >= 3) {
          for (let k = start; k < c; k++) hit.add(r * cols + k);
        }
        start = c;
      }
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      if (r === rows || board[r][c] !== board[start][c] || board[start][c] == null) {
        if (board[start][c] != null && r - start >= 3) {
          for (let k = start; k < r; k++) hit.add(k * cols + c);
        }
        start = r;
      }
    }
  }
  return [...hit].map((i) => ({ r: Math.floor(i / cols), c: i % cols }));
}

function inBounds(board, p) {
  return p.r >= 0 && p.r < board.length && p.c >= 0 && p.c < board[0].length;
}

function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function applySwap(board, a, b) {
  const out = copyBoard(board);
  const t = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = t;
  return out;
}

export function isValidSwap(board, a, b) {
  if (!inBounds(board, a) || !inBounds(board, b) || !adjacent(a, b)) return false;
  return findMatches(applySwap(board, a, b)).length > 0;
}

export function hasValidMove(board) {
  const rows = board.length;
  if (!rows) return false;
  const cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

export function longestRun(board) {
  const rows = board.length;
  if (!rows || !board[0].length) return 0;
  const cols = board[0].length;
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

// ------------------------------------------------------------------ collapse

function makesRun(board, r, c, v) {
  const rows = board.length, cols = board[0].length;
  let h = 1;
  for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) h++;
  for (let cc = c + 1; cc < cols && board[r][cc] === v; cc++) h++;
  if (h >= 3) return true;
  let vert = 1;
  for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) vert++;
  for (let rr = r + 1; rr < rows && board[rr][c] === v; rr++) vert++;
  return vert >= 3;
}

function drawRefill(board, r, c, rng, types, favour) {
  for (let i = 0; i < 60; i++) {
    const v = nextColour(rng, types, favour);
    if (!makesRun(board, r, c, v)) return v;
  }
  // exhaustive fallback (still rng-seeded so deterministic)
  const start = Math.floor(rng() * types);
  for (let i = 0; i < types; i++) {
    const v = (start + i) % types;
    if (!makesRun(board, r, c, v)) return v;
  }
  return start; // pathological; a later wave will clear it
}

export function collapse(board, rng, types, favour) {
  let cur = copyBoard(board);
  const steps = [];
  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    const rows = cur.length, cols = cur[0].length;
    const next = copyBoard(cur);
    for (const { r, c } of matches) next[r][c] = null;
    // gravity: survivors drop to the bottom of each column
    for (let c = 0; c < cols; c++) {
      const stack = [];
      for (let r = rows - 1; r >= 0; r--) {
        if (next[r][c] !== null) stack.push(next[r][c]);
      }
      for (let r = rows - 1; r >= 0; r--) {
        const v = stack[rows - 1 - r];
        next[r][c] = v === undefined ? null : v;
      }
    }
    // refill from the top, avoiding instant matches
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] === null) next[r][c] = drawRefill(next, r, c, rng, types, favour);
      }
    }
    steps.push({ matches, board: copyBoard(next) });
    cur = next;
  }
  return { board: cur, steps };
}
