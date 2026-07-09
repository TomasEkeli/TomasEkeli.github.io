/**
 * Pure game logic module - no Math.random, no mutations
 */

export function createBoard(rows, cols, types, rng) {
  let board = generateMatchFree(rows, cols, types, rng);

  // No deadlock: a starting board must be match-free AND have at least one
  // valid move. Reshuffle (bounded) until both hold.
  for (let tries = 0; !hasValidMove(board) && tries < 100; tries++) {
    board = generateMatchFree(rows, cols, types, rng);
  }

  return board;
}

function generateMatchFree(rows, cols, types, rng) {
  const board = Array.from({ length: rows }, () => new Array(cols));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let v;
      do {
        v = Math.floor(rng() * types);
      } while (
        (c >= 2 && board[r][c - 1] === v && board[r][c - 2] === v) ||
        (r >= 2 && board[r - 1][c] === v && board[r - 2][c] === v)
      );
      board[r][c] = v;
    }
  }

  return board;
}

export function findMatches(board) {
  const rows = board.length;
  if (!rows) return [];

  const cols = board[0].length;
  const matched = new Set();
  const key = (r, c) => r * cols + c;

  // Horizontal runs
  for (let r = 0; r < rows; r++) {
    let run = 1;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && board[r][c] === board[r][c - 1]) {
        run++;
      } else {
        if (run >= 3) {
          for (let k = c - run; k < c; k++) {
            matched.add(key(r, k));
          }
        }
        run = 1;
      }
    }
  }

  // Vertical runs
  for (let c = 0; c < cols; c++) {
    let run = 1;
    for (let r = 1; r <= rows; r++) {
      if (r < rows && board[r][c] === board[r - 1][c]) {
        run++;
      } else {
        if (run >= 3) {
          for (let k = r - run; k < r; k++) {
            matched.add(key(k, c));
          }
        }
        run = 1;
      }
    }
  }

  return [...matched].map((n) => ({ r: Math.floor(n / cols), c: n % cols }));
}

export function isValidSwap(board, a, b) {
  const adjacent = Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  if (!adjacent) return false;
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

export function applySwap(board, a, b) {
  const out = board.map((row) => [...row]);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

export function collapse(board, rng, types) {
  const rows = board.length;
  if (!rows) return { board, steps: [] };

  const cols = board[0].length;
  const t = types ?? maxType(board) + 1;
  let cur = board.map((row) => [...row]);
  const steps = [];

  while (true) {
    const matches = findMatches(cur);
    if (matches.length === 0) break;

    // Clear matched cells
    for (const { r, c } of matches) {
      cur[r][c] = null;
    }

    // Gravity + refill, per column, without creating new matches
    for (let c = 0; c < cols; c++) {
      const survivors = [];
      for (let r = rows - 1; r >= 0; r--) {
        if (cur[r][c] !== null) {
          survivors.push(cur[r][c]);
        }
      }

      for (let r = rows - 1; r >= 0; r--) {
        if (survivors.length) {
          cur[r][c] = survivors.shift();
        } else {
          let v;
          do {
            v = Math.floor(rng() * t);
          } while (
            (c >= 2 && cur[r][c - 1] === v && cur[r][c - 2] === v) ||
            (r <= rows - 3 && cur[r + 1][c] === v && cur[r + 2][c] === v)
          );
          cur[r][c] = v;
        }
      }
    }

    // Record the wave
    steps.push({ matches, board: cur.map((row) => [...row]) });
  }

  return { board: cur, steps };
}

function maxType(board) {
  let m = 0;
  for (const row of board) {
    for (const v of row) {
      if (v !== null && v > m) m = v;
    }
  }
  return m;
}

export function longestRun(board) {
  const rows = board.length;
  if (!rows) return 0;

  const cols = board[0].length;
  let best = 0;

  const scan = (get, outer, inner) => {
    for (let o = 0; o < outer; o++) {
      let run = 0;
      let prev = NaN;
      for (let i = 0; i < inner; i++) {
        const v = get(o, i);
        if (v !== null && v === prev) {
          run++;
        } else {
          if (run > best) best = run;
          run = 1;
          prev = v;
        }
      }
      if (run > best) best = run;
    }
  };

  scan((r, c) => board[r][c], rows, cols); // horizontal
  scan((c, r) => board[r][c], cols, rows); // vertical

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
