// game.js — pure match-3 logic (ES module, named exports).
// Logic stays a 2D rows x cols grid; matches run horizontally & vertically.

function clone(board) {
  return board.map((row) => row.slice());
}

export function findMatches(board) {
  const rows = board.length;
  const cols = rows ? board[0].length : 0;
  const hit = new Set();
  // horizontal
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        run++;
      } else {
        if (run >= 3) {
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
      if (r < rows && board[r][c] === board[r - 1][c]) {
        run++;
      } else {
        if (run >= 3) {
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
  const out = clone(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

function adjacent(a, b) {
  return (
    (a.r === b.r && Math.abs(a.c - b.c) === 1) ||
    (a.c === b.c && Math.abs(a.r - b.r) === 1)
  );
}

export function isValidSwap(board, a, b) {
  if (!adjacent(a, b)) return false;
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

export function longestRun(board) {
  const rows = board.length;
  if (!rows) return 0;
  const cols = board[0].length;
  let best = rows && cols ? 1 : 0;
  // horizontal
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c < cols; c++) {
      run = board[r][c] === board[r][c - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  // vertical
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
  const p = Math.max(prev, 1);
  return longestRunLen < 4
    ? Math.max(1, Math.floor(p / 2))
    : p * 2 ** (longestRunLen - 3);
}

export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Drop survivors and refill empties (null) from the top without creating matches.
function gravityAndRefill(board, rng, types) {
  const rows = board.length;
  const cols = board[0].length;
  const out = clone(board);
  for (let c = 0; c < cols; c++) {
    // compact non-null downward
    const col = [];
    for (let r = rows - 1; r >= 0; r--) {
      if (out[r][c] !== null && out[r][c] !== undefined) col.push(out[r][c]);
    }
    // col holds survivors bottom-up; fill remaining top slots with new gems
    let write = rows - 1;
    for (let i = 0; i < col.length; i++) {
      out[write][c] = col[i];
      write--;
    }
    for (let r = write; r >= 0; r--) {
      out[r][c] = pickRefill(out, r, c, types, rng);
    }
  }
  return out;
}

function pickRefill(board, r, c, types, rng) {
  // choose a colour that does not immediately form a run of 3 with already-set cells
  for (let attempt = 0; attempt < 40; attempt++) {
    const v = Math.floor(rng() * types);
    // check left two
    const l1 = c - 1 >= 0 ? board[r][c - 1] : -1;
    const l2 = c - 2 >= 0 ? board[r][c - 2] : -1;
    if (l1 === v && l2 === v) continue;
    // check above two (below are still empty during top-fill)
    const u1 = r - 1 >= 0 ? board[r - 1][c] : -1;
    const u2 = r - 2 >= 0 ? board[r - 2][c] : -1;
    if (u1 === v && u2 === v) continue;
    return v;
  }
  return Math.floor(rng() * types);
}

export function collapse(board, rng, types) {
  if (types === undefined) {
    let max = 0;
    for (const row of board) for (const v of row) if (v > max) max = v;
    types = max + 1;
  }
  let current = clone(board);
  const steps = [];
  while (true) {
    const matches = findMatches(current);
    if (matches.length === 0) break;
    const cleared = clone(current);
    for (const { r, c } of matches) cleared[r][c] = null;
    const settled = gravityAndRefill(cleared, rng, types);
    steps.push({ matches, board: clone(settled) });
    current = settled;
  }
  return { board: current, steps };
}

export function createBoard(rows, cols, types, rng) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push(pickCell(board, row, r, c, types, rng));
      }
      board.push(row);
    }
    if (findMatches(board).length === 0 && hasValidMove(board)) return board;
  }
  // fallback: brute simple board
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push((r + c) % types);
    board.push(row);
  }
  return board;
}

function pickCell(board, row, r, c, types, rng) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const v = Math.floor(rng() * types);
    const l1 = c - 1 >= 0 ? row[c - 1] : -1;
    const l2 = c - 2 >= 0 ? row[c - 2] : -1;
    if (l1 === v && l2 === v) continue;
    const u1 = r - 1 >= 0 ? board[r - 1][c] : -1;
    const u2 = r - 2 >= 0 ? board[r - 2][c] : -1;
    if (u1 === v && u2 === v) continue;
    return v;
  }
  return Math.floor(rng() * types);
}
