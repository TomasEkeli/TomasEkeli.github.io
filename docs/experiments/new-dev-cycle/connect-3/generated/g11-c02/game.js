// game.js — pure match-3 logic (ES module, named exports).
// A board is rows × cols of ints in 0..types-1. Cells are {r, c}. rng() -> [0,1).

export const FAVOUR_WEIGHT = 2;

// One colour in 0..types-1. Biased toward `favour` (weight FAVOUR_WEIGHT vs 1)
// when it is a valid type; uniform otherwise. Exactly ONE rng() call either way,
// so the no-favour path is byte-for-byte the classic uniform draw.
export function nextColour(rng, types, favour) {
  const biased = Number.isInteger(favour) && favour >= 0 && favour < types;
  if (!biased) return Math.floor(rng() * types);
  const total = types - 1 + FAVOUR_WEIGHT;
  let x = rng() * total;
  for (let c = 0; c < types; c++) {
    const w = c === favour ? FAVOUR_WEIGHT : 1;
    if (x < w) return c;
    x -= w;
  }
  return types - 1;
}

// The next n refill colours — the biased forecast the UI shows as the peek.
export function refillQueue(rng, types, favour, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(nextColour(rng, types, favour));
  return out;
}

function copyBoard(b) {
  return b.map((row) => row.slice());
}

// Every cell in any horizontal/vertical run of length >= 3, deduped.
export function findMatches(board) {
  const rows = board.length;
  if (rows === 0) return [];
  const cols = board[0].length;
  const hit = new Set();
  // Horizontal runs.
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c === cols || board[r][c] !== board[r][start]) {
        if (c - start >= 3) for (let k = start; k < c; k++) hit.add(r * cols + k);
        start = c;
      }
    }
  }
  // Vertical runs.
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      if (r === rows || board[r][c] !== board[start][c]) {
        if (r - start >= 3) for (let k = start; k < r; k++) hit.add(k * cols + c);
        start = r;
      }
    }
  }
  return [...hit].map((i) => ({ r: Math.floor(i / cols), c: i % cols }));
}

// New board with a and b exchanged. Pure; does not validate.
export function applySwap(board, a, b) {
  const out = copyBoard(board);
  const tmp = out[a.r][a.c];
  out[a.r][a.c] = out[b.r][b.c];
  out[b.r][b.c] = tmp;
  return out;
}

// true iff a/b are orthogonally adjacent AND the swap yields >= 1 match.
export function isValidSwap(board, a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  if (dr + dc !== 1) return false;
  const rows = board.length, cols = board[0].length;
  const inside = (p) => p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols;
  if (!inside(a) || !inside(b)) return false;
  return findMatches(applySwap(board, a, b)).length > 0;
}

// true iff some orthogonally-adjacent swap would create a match (game-over detector).
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

// Would placing v at (r,c) complete a run of 3 with already-present neighbours?
function makesInstantMatch(b, r, c, v) {
  const rows = b.length, cols = b[0].length;
  const at = (rr, cc) => (rr >= 0 && rr < rows && cc >= 0 && cc < cols ? b[rr][cc] : undefined);
  return (
    (at(r, c - 1) === v && at(r, c - 2) === v) ||
    (at(r, c + 1) === v && at(r, c + 2) === v) ||
    (at(r, c - 1) === v && at(r, c + 1) === v) ||
    (at(r - 1, c) === v && at(r - 2, c) === v) ||
    (at(r + 1, c) === v && at(r + 2, c) === v) ||
    (at(r - 1, c) === v && at(r + 1, c) === v)
  );
}

function drawSafe(b, r, c, rng, types, favour) {
  for (let i = 0; i < 60; i++) {
    const v = nextColour(rng, types, favour);
    if (!makesInstantMatch(b, r, c, v)) return v;
  }
  for (let v = 0; v < types; v++) if (!makesInstantMatch(b, r, c, v)) return v;
  return Math.floor(rng() * types); // pathological corner; the collapse loop will clear it
}

// Full board, no matches, and at least one valid move (a fresh game must be playable).
export function createBoard(rows, cols, types, rng) {
  for (;;) {
    const b = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      b.push(row);
      for (let c = 0; c < cols; c++) {
        row.push(0);
        let v = Math.floor(rng() * types);
        let guard = 0;
        while (guard++ < 80 && makesInstantMatch(b, r, c, v)) v = Math.floor(rng() * types);
        if (makesInstantMatch(b, r, c, v)) {
          for (let alt = 0; alt < types; alt++) if (!makesInstantMatch(b, r, c, alt)) { v = alt; break; }
        }
        row[c] = v;
      }
    }
    if (findMatches(b).length === 0 && hasValidMove(b)) return b;
  }
}

// Clear -> gravity -> refill until full & match-free. Refills draw through
// nextColour (biased when favour is a valid type) and avoid instant matches.
// Returns { board, steps: [{ matches, board }, ...] }.
export function collapse(board, rng, types, favour) {
  const rows = board.length, cols = board[0].length;
  let b = copyBoard(board);
  const steps = [];
  let guard = 0;
  for (;;) {
    const matches = findMatches(b);
    if (matches.length === 0 || guard++ > 400) break;
    const next = copyBoard(b);
    for (const { r, c } of matches) next[r][c] = null;
    // Gravity: survivors fall to the bottom of their column.
    for (let c = 0; c < cols; c++) {
      let w = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (next[r][c] !== null) next[w--][c] = next[r][c];
      }
      for (; w >= 0; w--) next[w][c] = null;
    }
    // Refill top-down, avoiding instant matches.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] === null) next[r][c] = drawSafe(next, r, c, rng, types, favour);
      }
    }
    b = next;
    steps.push({ matches, board: copyBoard(b) });
  }
  return { board: b, steps };
}

// Longest straight run of identical values (horizontal or vertical).
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

// Persistent multiplier: a 3-match halves (floored, never below 1); L>=4 compounds.
export function matchMultiplier(prev, longestRunLen) {
  const base = Math.max(prev, 1);
  if (longestRunLen < 4) return Math.max(1, Math.floor(base / 2));
  return base * 2 ** (longestRunLen - 3);
}

// A new stage every 100k points.
export function stageForScore(score) {
  return Math.max(0, Math.floor(score / 100000));
}

// Difficulty ramp: 4 colours at stage 0, +1 per stage, capped at 6.
export function typesForStage(stage) {
  return Math.min(4 + Math.max(0, stage), 6);
}

// Escalating cascade payoff: wave 0 face value, wave 1 x2, wave 2 x3, ...
export function cascadeFactor(waveIndex) {
  return waveIndex + 1;
}
