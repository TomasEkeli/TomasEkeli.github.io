// game.js — pure match-3 logic (ES module, no DOM, no state).

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();

  // horizontal runs
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const v = board[r][c];
      let end = c + 1;
      while (end < cols && board[r][end] === v) end++;
      if (end - c >= 3) {
        for (let k = c; k < end; k++) hit.add(r + ',' + k);
      }
      c = end;
    }
  }
  // vertical runs
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const v = board[r][c];
      let end = r + 1;
      while (end < rows && board[end][c] === v) end++;
      if (end - r >= 3) {
        for (let k = r; k < end; k++) hit.add(k + ',' + c);
      }
      r = end;
    }
  }
  return [...hit].map((s) => {
    const [r, c] = s.split(',').map(Number);
    return { r, c };
  });
}

export function applySwap(board, a, b) {
  const out = cloneBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function isValidSwap(board, a, b) {
  if (!adjacent(a, b)) return false;
  const rows = board.length, cols = board[0].length;
  for (const p of [a, b]) {
    if (p.r < 0 || p.r >= rows || p.c < 0 || p.c >= cols) return false;
  }
  const swapped = applySwap(board, a, b);
  return findMatches(swapped).length > 0;
}

export function hasValidMove(board) {
  const rows = board.length, cols = board[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && isValidSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < rows && isValidSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let v;
        do {
          v = Math.floor(rng() * types);
        } while (
          (c >= 2 && row[c - 1] === v && row[c - 2] === v) ||
          (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v)
        );
        row.push(v);
      }
      board.push(row);
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
}

export function collapse(board, rng, types) {
  let cur = cloneBoard(board);
  const steps = [];
  for (;;) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;
    const rows = cur.length, cols = cur[0].length;
    const cleared = cur.map((row) => row.slice());
    for (const { r, c } of matches) cleared[r][c] = null;
    // gravity + refill, column by column
    const next = Array.from({ length: rows }, () => new Array(cols));
    for (let c = 0; c < cols; c++) {
      const stack = [];
      for (let r = rows - 1; r >= 0; r--) {
        if (cleared[r][c] !== null) stack.push(cleared[r][c]);
      }
      for (let r = rows - 1, i = 0; r >= 0; r--, i++) {
        if (i < stack.length) {
          next[r][c] = stack[i];
        } else {
          // refill from the top; avoid creating an immediate match
          let v;
          let guard = 0;
          do {
            v = Math.floor(rng() * types);
            guard++;
          } while (
            guard < 50 &&
            wouldMatchAt(next, r, c, v, rows, cols)
          );
          next[r][c] = v;
        }
      }
    }
    cur = next;
    steps.push({ matches, board: cloneBoard(cur) });
  }
  return { board: cur, steps };
}

// Check whether placing v at (r,c) forms a run of 3+ with already-placed
// neighbours (cells may be undefined while filling).
function wouldMatchAt(b, r, c, v, rows, cols) {
  // horizontal: count placed equal neighbours left/right
  let h = 1;
  for (let k = c - 1; k >= 0 && b[r][k] === v; k--) h++;
  for (let k = c + 1; k < cols && b[r][k] === v; k++) h++;
  if (h >= 3) return true;
  let vert = 1;
  for (let k = r - 1; k >= 0 && b[k] && b[k][c] === v; k--) vert++;
  for (let k = r + 1; k < rows && b[k] && b[k][c] === v; k++) vert++;
  return vert >= 3;
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
