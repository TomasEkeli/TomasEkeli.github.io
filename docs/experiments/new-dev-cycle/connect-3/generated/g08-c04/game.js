// Pure match-3 logic. ES module, no DOM, no globals.

export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const b = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        let t = Math.floor(rng() * types) % types;
        let guard = 0;
        while (guard++ < types + 2 && makesImmediateMatch(b, row, r, c, t)) {
          t = (t + 1) % types;
        }
        row.push(t);
      }
      b.push(row);
    }
    if (findMatches(b).length === 0 && hasValidMove(b)) return b;
  }
}

function makesImmediateMatch(b, row, r, c, t) {
  if (c >= 2 && row[c - 1] === t && row[c - 2] === t) return true;
  if (r >= 2 && b[r - 1][c] === t && b[r - 2][c] === t) return true;
  return false;
}

export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();
  // horizontal
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      const same = c < cols && board[r][c] != null && board[r][c] === board[r][c - 1];
      if (same) run++;
      else {
        if (run >= 3 && board[r][c - 1] != null) {
          for (let k = c - run; k < c; k++) hit.add(r + ',' + k);
        }
        run = 1;
      }
    }
  }
  // vertical
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r <= rows; r++) {
      const same = r < rows && board[r][c] != null && board[r][c] === board[r - 1][c];
      if (same) run++;
      else {
        if (run >= 3 && board[r - 1][c] != null) {
          for (let k = r - run; k < r; k++) hit.add(k + ',' + c);
        }
        run = 1;
      }
    }
  }
  return [...hit].map((s) => {
    const [r, c] = s.split(',').map(Number);
    return { r, c };
  });
}

export function applySwap(board, a, b) {
  const out = board.map((row) => row.slice());
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const rows = board.length, cols = board[0].length;
  for (const p of [a, b]) {
    if (p.r < 0 || p.r >= rows || p.c < 0 || p.c >= cols) return false;
  }
  return findMatches(applySwap(board, a, b)).length > 0;
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

export function collapse(board, rng, types) {
  if (types == null) {
    types = 1 + board.reduce((m, row) => Math.max(m, ...row.filter((v) => v != null)), 0);
  }
  let b = board.map((row) => row.slice());
  const steps = [];
  const rows = b.length, cols = b[0].length;
  for (;;) {
    const matches = findMatches(b);
    if (matches.length === 0) break;
    // clear
    for (const { r, c } of matches) b[r][c] = null;
    // gravity per column
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (b[r][c] != null) {
          b[write][c] = b[r][c];
          if (write !== r) b[r][c] = null;
          write--;
        }
      }
      for (let r = write; r >= 0; r--) b[r][c] = null;
    }
    // refill: empties are at the top of each column; fill lowest-first so the
    // cells below a candidate are already known, avoiding new matches.
    for (let c = 0; c < cols; c++) {
      for (let r = rows - 1; r >= 0; r--) {
        if (b[r][c] != null) continue;
        let t = Math.floor(rng() * types) % types;
        let guard = 0;
        while (guard++ < types + 2 && refillMakesMatch(b, r, c, t, rows, cols)) {
          t = (t + 1) % types;
        }
        b[r][c] = t;
      }
    }
    steps.push({ matches, board: b.map((row) => row.slice()) });
  }
  return { board: b, steps };
}

function refillMakesMatch(b, r, c, t, rows, cols) {
  const at = (rr, cc) =>
    rr >= 0 && rr < rows && cc >= 0 && cc < cols ? b[rr][cc] : undefined;
  // vertical (cells below are filled; above are still empty)
  if (at(r + 1, c) === t && at(r + 2, c) === t) return true;
  // horizontal: any run of 3 including (r,c)
  if (at(r, c - 1) === t && at(r, c - 2) === t) return true;
  if (at(r, c + 1) === t && at(r, c + 2) === t) return true;
  if (at(r, c - 1) === t && at(r, c + 1) === t) return true;
  return false;
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
      run = board[r][c] != null && board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r < rows; r++) {
      run = board[r][c] != null && board[r][c] === board[r - 1][c] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  return best;
}

export function matchMultiplier(prev, longestRunLen) {
  const p = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(p / 2));
  return p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}
