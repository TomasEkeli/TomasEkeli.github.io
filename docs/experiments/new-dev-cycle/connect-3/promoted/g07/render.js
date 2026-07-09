// render.js — The Jade Temple. UI, interaction, scoring composition, stages.
// Pure rules live in game.js; this file owns presentation and the colour economy.

import * as G from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const BEST_KEY = 'jade-temple-best-v1';
const SWAP_MS = 160, CLEAR_MS = 300, DROP_K = 132;
const FEATURE_BONUS = 30;    // per featured gem matched (flat, post-multiplier)
const DEVIATION_BONUS = 100; // flat, for moving off the shown hint
const HINT_IDLE_MS = 10000;

/* ---------------- rng (deterministic core gets an injected stream) -------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

/* ---------------- gem catalogue: shape + palette per type ----------------- */
const GEMS = [
  { name: 'Jade', light: '#b0ffce', mid: '#23c96a', dark: '#0a5c2e', glow: '#4dffa0',
    path: 'M28 8 H72 L92 28 V72 L72 92 H28 L8 72 V28 Z',
    facets: 'M28 8 L37 26 M72 8 L63 26 M92 28 L74 37 M92 72 L74 63 M72 92 L63 74 M28 92 L37 74 M8 72 L26 63 M8 28 L26 37' },
  { name: 'Sunstone', light: '#fff3c4', mid: '#ffb63d', dark: '#a85800', glow: '#ffd257',
    path: 'M50 10 A40 40 0 1 1 49.99 10 Z',
    facets: 'M50 10 L50 27 M78 22 L66 34 M90 50 L73 50 M78 78 L66 66 M50 90 L50 73 M22 78 L34 66 M10 50 L27 50 M22 22 L34 34' },
  { name: 'Sapphire', light: '#c9e8ff', mid: '#3fa2ff', dark: '#0b4ea6', glow: '#57b6ff',
    path: 'M50 6 C68 30 86 48 86 65 A36 33 0 1 1 14 65 C14 48 32 30 50 6 Z',
    facets: 'M50 6 L50 28 M14 65 L30 65 M86 65 L70 65 M50 98 L50 80' },
  { name: 'Amethyst', light: '#efd0ff', mid: '#b45dff', dark: '#54178f', glow: '#cd7bff',
    path: 'M50 5 L90 50 L50 95 L10 50 Z',
    facets: 'M50 5 L50 24 M90 50 L73 50 M50 95 L50 76 M10 50 L27 50' },
  { name: 'Ruby', light: '#ffc9c0', mid: '#ff4d4d', dark: '#870d20', glow: '#ff6b5e',
    path: 'M50 6 L92 38 L76 92 H24 L8 38 Z',
    facets: 'M50 6 L50 25 M92 38 L74 43 M76 92 L65 74 M24 92 L35 74 M8 38 L26 43' },
  { name: 'Moon Opal', light: '#ffffff', mid: '#d5e4f7', dark: '#8fa8cc', glow: '#e8f4ff',
    path: 'M50 4 L61 39 L96 50 L61 61 L50 96 L39 61 L4 50 L39 39 Z',
    facets: 'M50 4 L50 25 M96 50 L75 50 M50 96 L50 75 M4 50 L25 50' },
];

let svgUid = 0;
function gemSVG(t) {
  const g = GEMS[t];
  const id = 'gg' + (svgUid++);
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${g.light}"/>
        <stop offset=".45" stop-color="${g.mid}"/>
        <stop offset="1" stop-color="${g.dark}"/>
      </linearGradient>
      <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset=".55" stop-color="${g.light}"/>
        <stop offset="1" stop-color="${g.mid}"/>
      </linearGradient>
      <radialGradient id="${id}s" cx=".5" cy=".9" r=".75">
        <stop offset="0" stop-color="rgba(0,0,0,.4)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
      <clipPath id="${id}c"><path d="${g.path}"/></clipPath>
    </defs>
    <path d="${g.path}" fill="url(#${id}b)"/>
    <g clip-path="url(#${id}c)">
      <ellipse cx="50" cy="92" rx="48" ry="30" fill="url(#${id}s)"/>
      <g transform="translate(50 50) scale(.58) translate(-50 -50)">
        <path d="${g.path}" fill="url(#${id}t)" opacity=".92"/>
        <path d="${g.path}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="3"/>
      </g>
      <path d="${g.facets}" stroke="rgba(255,255,255,.3)" stroke-width="2" fill="none"/>
      <ellipse cx="34" cy="25" rx="15" ry="8" fill="#fff" opacity=".55" transform="rotate(-28 34 25)"/>
      <rect class="glintbar" x="-46" y="-10" width="22" height="130" fill="#fff" opacity=".3"/>
    </g>
    <path d="${g.path}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2.4"/>
  </svg>`;
}

/* ---------------- stages: deeper into the ruins every 100k ---------------- */
const STAGES = [
  { name: 'The Canopy',        feature: null, blurb: 'sunlight through the leaves' },
  { name: 'Temple Steps',      feature: 1,    blurb: 'the idol favours Sunstone' },
  { name: 'Vine Hall',         feature: 0,    blurb: 'the idol favours Jade' },
  { name: 'Inner Sanctum',     feature: 3,    blurb: 'the idol favours Amethyst' },
  { name: 'Sunken Vault',      feature: 2,    blurb: 'the idol favours Sapphire' },
  { name: 'The Moonwell',      feature: 5,    blurb: 'the idol favours Moon Opal' },
  { name: 'Heart of the Idol', feature: 4,    blurb: 'the idol favours Ruby' },
];
const themeOf = (idx) => STAGES[idx % STAGES.length];

/* ---------------- state ---------------- */
let board, score, best, lastGain, lastBonus, multiplier, stageIdx;
let over = false, busy = false, hint = null, hintTimer = null;
let matchCounts, movesMade;
let drag = null;

/* ---------------- per-colour value economy (candidate-designed) -----------
   0 Jade      — cheap but exponential: 5 · 2^(times matched), capped at 640
   1 Sunstone  — expensive but flat: always 50
   2 Sapphire  — grows each time it matches: 10 + 6/match
   3 Amethyst  — rarer-worth-more: ~480 / count currently on the board
   4 Ruby      — burns hotter the deeper you go: 12 · (stage + 1)
   5 Moon Opal — waxes with the expedition: 15 + moves-played / 2
--------------------------------------------------------------------------- */
function countOnBoard(t, brd) {
  let n = 0;
  for (const row of brd) for (const v of row) if (v === t) n++;
  return n;
}
function gemValue(t, brd = board) {
  switch (t) {
    case 0: return Math.min(5 * 2 ** matchCounts[0], 640);
    case 1: return 50;
    case 2: return 10 + 6 * matchCounts[2];
    case 3: { const n = countOnBoard(3, brd); return n === 0 ? 480 : Math.max(24, Math.round(480 / n)); }
    case 4: return 12 * (stageIdx + 1);
    case 5: return 15 + Math.floor(movesMade / 2);
    default: return 10;
  }
}
const gemValues = () => Array.from({ length: TYPES }, (_, t) => gemValue(t));

/* ---------------- dom ---------------- */
const $ = (id) => document.getElementById(id);
const boardEl = $('board'), popupsEl = $('popups');
const scoreEl = $('score'), bestEl = $('best'), multEl = $('mult'), multPanel = $('mult-panel');
const stageNumEl = $('stage-num'), stageNameEl = $('stage-name');
const featGemEl = $('featured-gem'), featInfoEl = $('featured-info');
const goEl = $('gameover'), goScoreEl = $('go-score');
const bannerEl = $('stage-banner'), flashEl = $('flash');

const cellEls = [];
for (let r = 0; r < ROWS; r++) {
  cellEls.push([]);
  for (let c = 0; c < COLS; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('data-testid', 'cell');
    cell.dataset.r = r;
    cell.dataset.c = c;
    cell.style.setProperty('--tw', String(((r * 29 + c * 13) % 23) / 23));
    const gem = document.createElement('div');
    gem.className = 'gem';
    cell.appendChild(gem);
    boardEl.appendChild(cell);
    cellEls[r].push(cell);
  }
}
const gemAt = (r, c) => cellEls[r][c].firstElementChild;

function setCellType(r, c, t, force = false) {
  const cell = cellEls[r][c];
  if (!force && cell._t === t) return;
  cell._t = t;
  cell.dataset.t = t;
  const gem = cell.firstElementChild;
  gem.className = 'gem t' + t;
  gem.style.transform = '';
  gem.innerHTML = gemSVG(t);
  cell.classList.toggle('feat', themeOf(stageIdx).feature === t);
}
function paint() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) setCellType(r, c, board[r][c]);
}
function refreshFeatured() {
  const f = themeOf(stageIdx).feature;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      cellEls[r][c].classList.toggle('feat', board[r][c] === f);
}
function cellStep() {
  const a = cellEls[0][0].getBoundingClientRect();
  const b = cellEls[1][0].getBoundingClientRect();
  return b.top - a.top;
}

/* ---------------- HUD ---------------- */
const fmt = (n) => n.toLocaleString('en-US');
function updateHud() {
  scoreEl.textContent = fmt(score);
  bestEl.textContent = fmt(best);
  multEl.textContent = '×' + multiplier;
  multPanel.classList.toggle('hot', multiplier > 1);
}
function updateStagePanel() {
  const th = themeOf(stageIdx);
  stageNumEl.textContent = stageIdx + 1;
  stageNameEl.textContent = th.name;
  if (th.feature === null) {
    featGemEl.innerHTML = '';
    featGemEl.style.display = 'none';
    featInfoEl.textContent = 'the idols are silent…';
  } else {
    featGemEl.style.display = '';
    featGemEl.innerHTML = gemSVG(th.feature);
    featInfoEl.textContent = `${GEMS[th.feature].name} +${FEATURE_BONUS}/gem`;
  }
}
function applyStage(withEvent) {
  document.body.dataset.theme = String(stageIdx % STAGES.length);
  updateStagePanel();
  refreshFeatured();
  if (withEvent) {
    const th = themeOf(stageIdx);
    $('banner-num').textContent = 'Stage ' + (stageIdx + 1);
    $('banner-name').textContent = th.name;
    $('banner-feat').textContent = th.blurb;
    flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
    bannerEl.classList.remove('show'); void bannerEl.offsetWidth; bannerEl.classList.add('show');
  }
}

/* ---------------- persistence ---------------- */
function loadBest() {
  try { return Math.max(0, parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0); }
  catch { return 0; }
}
function saveBest() {
  try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* private mode */ }
}

/* ---------------- move discovery / hints ---------------- */
function allValidMoves() {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && G.isValidSwap(board, { r, c }, { r, c: c + 1 }))
        out.push({ a: { r, c }, b: { r, c: c + 1 } });
      if (r + 1 < ROWS && G.isValidSwap(board, { r, c }, { r: r + 1, c }))
        out.push({ a: { r, c }, b: { r: r + 1, c } });
    }
  }
  return out;
}
function findValidMove() {
  const all = allValidMoves();
  return all.length ? all[0] : null;
}
function samePair(p, a, b) {
  const k = (m) => m.r + ',' + m.c;
  const s = new Set([k(p.a), k(p.b)]);
  return s.has(k(a)) && s.has(k(b));
}
function clearHintVisuals() {
  document.querySelectorAll('.hint-a, .hint-b').forEach((el) => el.classList.remove('hint-a', 'hint-b'));
}
function armHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(tryShowHint, HINT_IDLE_MS);
}
function tryShowHint() {
  if (over) return;
  if (busy || drag) { hintTimer = setTimeout(tryShowHint, 1200); return; }
  if (hint) return;
  const moves = allValidMoves();
  if (!moves.length) return;
  hint = moves[Math.floor(Math.random() * moves.length)];
  cellEls[hint.a.r][hint.a.c].classList.add('hint-a');
  cellEls[hint.b.r][hint.b.c].classList.add('hint-b');
}

/* ---------------- particles & popups ---------------- */
function boardPos(r, c) {
  // centre of cell (r,c) as % of the board-frame's popups layer
  const rect = popupsEl.getBoundingClientRect();
  const cr = cellEls[r][c].getBoundingClientRect();
  return {
    x: ((cr.left + cr.width / 2 - rect.left) / rect.width) * 100,
    y: ((cr.top + cr.height / 2 - rect.top) / rect.height) * 100,
  };
}
function spawnSparks(r, c, t) {
  const p = boardPos(r, c);
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = p.x + '%';
    s.style.top = p.y + '%';
    s.style.setProperty('--sc', GEMS[t].glow);
    const ang = Math.random() * Math.PI * 2, d = 26 + Math.random() * 40;
    s.style.setProperty('--sx', Math.cos(ang) * d + 'px');
    s.style.setProperty('--sy', Math.sin(ang) * d + 'px');
    popupsEl.appendChild(s);
    setTimeout(() => s.remove(), 750);
  }
}
function showPopup(centroid, gain, mult, featBonus, dev) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.style.left = Math.min(80, Math.max(20, centroid.x)) + '%';
  el.style.top = Math.min(80, Math.max(18, centroid.y)) + '%';
  let chips = '';
  if (mult > 1) chips += `<span class="chip mchip">×${mult} streak</span>`;
  if (featBonus > 0) chips += `<span class="chip ichip">✦ idol +${fmt(featBonus)}</span>`;
  if (dev > 0) chips += `<span class="chip dchip">✧ off the path +${dev}</span>`;
  el.innerHTML = `<span class="gain">+${fmt(gain)}</span>` +
    (chips ? `<span class="chips">${chips}</span>` : '');
  popupsEl.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

/* ---------------- animation ---------------- */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function animateSwap(a, b, fromTx, fromTy, invalid) {
  const gA = gemAt(a.r, a.c), gB = gemAt(b.r, b.c);
  const S = cellStep();
  const dx = (b.c - a.c) * S, dy = (b.r - a.r) * S;
  gA.style.transform = '';
  gB.style.transform = '';
  gA.parentElement.style.zIndex = 5;
  if (!invalid) {
    const a1 = gA.animate(
      [{ transform: `translate(${fromTx}px,${fromTy}px) scale(1.07)` }, { transform: `translate(${dx}px,${dy}px)` }],
      { duration: SWAP_MS, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
    const a2 = gB.animate(
      [{ transform: 'translate(0,0)' }, { transform: `translate(${-dx}px,${-dy}px)` }],
      { duration: SWAP_MS, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
    await Promise.all([a1.finished, a2.finished]);
    a1.cancel(); a2.cancel();
  } else {
    const a1 = gA.animate(
      [{ transform: `translate(${fromTx}px,${fromTy}px) scale(1.07)` },
       { transform: `translate(${dx * 0.45}px,${dy * 0.45}px)` },
       { transform: 'translate(0,0)' }],
      { duration: 300, easing: 'ease-in-out' });
    const a2 = gB.animate(
      [{ transform: 'translate(0,0)' },
       { transform: `translate(${-dx * 0.45}px,${-dy * 0.45}px)` },
       { transform: 'translate(0,0)' }],
      { duration: 300, easing: 'ease-in-out' });
    await Promise.all([a1.finished, a2.finished]);
  }
  gA.parentElement.style.zIndex = '';
}

async function animateWave(input, step) {
  // 1) CLEAR — matched gems flare and vanish; the drop must wait for this.
  for (const m of step.matches) {
    gemAt(m.r, m.c).classList.add('clearing');
    spawnSparks(m.r, m.c, input[m.r][m.c]);
  }
  await wait(CLEAR_MS);

  // 2) DROP — compute per-cell fall distances that reproduce game.js gravity.
  const matched = new Set(step.matches.map((m) => m.r * COLS + m.c));
  const fall = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!matched.has(r * COLS + c)) {
        fall[write][c] = write - r; // survivor falls from row r to row `write`
        write--;
      }
    }
    const refills = write + 1;            // rows 0..write refill from above
    for (let r = 0; r <= write; r++) fall[r][c] = refills;
  }

  // Repaint to the after-board, then animate every moved gem from where it was.
  for (const m of step.matches) {
    gemAt(m.r, m.c).classList.remove('clearing');
    setCellType(m.r, m.c, step.board[m.r][m.c], true);
  }
  const S = cellStep();
  const finishes = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      setCellType(r, c, step.board[r][c]);
      const d = fall[r][c];
      if (d > 0) {
        const gem = gemAt(r, c);
        const dur = Math.max(90, Math.round(DROP_K * Math.sqrt(d)));
        // Pure gravity: y = t^2 (cubic-bezier(.33,0,.67,.33)), duration ∝ √distance,
        // so gems in a column fall coherently and accelerate into the landing.
        const anim = gem.animate(
          [{ transform: `translateY(${-d * S}px)` }, { transform: 'translateY(0)' }],
          { duration: dur, easing: 'cubic-bezier(.33,0,.67,.33)' });
        finishes.push(anim.finished.then(() => {
          gem.animate(
            [{ transform: 'translateY(0) scale(1.06,.9)' }, { transform: 'translateY(0) scale(1,1)' }],
            { duration: 110, easing: 'ease-out' });
        }));
      }
    }
  }
  await Promise.all(finishes);
  await wait(70);
}

/* ---------------- the move ---------------- */
async function commitMove(a, b, hintSnap, fromTx, fromTy) {
  busy = true;
  hint = null;
  clearHintVisuals();

  if (!G.isValidSwap(board, a, b)) {
    await animateSwap(a, b, fromTx, fromTy, true);
    busy = false;
    armHint();
    return;
  }

  await animateSwap(a, b, fromTx, fromTy, false);
  board = G.applySwap(board, a, b);
  paint();

  const res = G.collapse(board, rng, TYPES);
  const stg = themeOf(stageIdx);
  let input = board;
  let L = 0, totalRaw = 0, featCount = 0;
  const centroid = (() => {
    const ms = res.steps[0].matches;
    let x = 0, y = 0;
    for (const m of ms) { const p = boardPos(m.r, m.c); x += p.x; y += p.y; }
    return { x: x / ms.length, y: y / ms.length };
  })();

  for (let i = 0; i < res.steps.length; i++) {
    const step = res.steps[i];
    L = Math.max(L, G.longestRun(input));
    let raw = 0;
    const colours = new Set();
    for (const m of step.matches) {
      const t = input[m.r][m.c];
      raw += gemValue(t, input);
      colours.add(t);
      if (stg.feature !== null && t === stg.feature) featCount++;
    }
    for (const t of colours) matchCounts[t]++;
    totalRaw += raw * (i === 0 ? 1 : 2); // cascades pay double
    await animateWave(input, step);
    board = step.board;
    input = step.board;
  }

  multiplier = G.matchMultiplier(multiplier, L);
  const featBonus = featCount * FEATURE_BONUS;
  const dev = hintSnap && !samePair(hintSnap, a, b) ? DEVIATION_BONUS : 0;
  const gain = totalRaw * multiplier + featBonus + dev;
  score += gain;
  lastGain = gain;
  lastBonus = dev;
  movesMade++;
  if (score > best) { best = score; saveBest(); }
  updateHud();
  showPopup(centroid, gain, multiplier, featBonus, dev);

  const newStage = G.stageForScore(score);
  if (newStage !== stageIdx) {
    stageIdx = newStage;
    applyStage(true);
  }

  if (!G.hasValidMove(board)) {
    over = true;
    busy = false;
    clearTimeout(hintTimer);
    goScoreEl.textContent = `Expedition score: ${fmt(score)}`;
    goEl.hidden = false;
  } else {
    busy = false;
    armHint();
  }
}

/* ---------------- drag input (decided at RELEASE, tracked on document) ---- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

boardEl.addEventListener('pointerdown', (e) => {
  if (busy || over || drag) return;
  const cell = e.target.closest('[data-testid="cell"]');
  if (!cell || !boardEl.contains(cell)) return;
  e.preventDefault();
  const r = +cell.dataset.r, c = +cell.dataset.c;
  drag = {
    r, c,
    x0: e.clientX, y0: e.clientY,
    id: e.pointerId,
    tx: 0, ty: 0, nb: null,
    // snapshot the hint SHOWING AT DRAG START — the deviation bonus is judged
    // against this, even though the hint clears when the move commits.
    hintSnap: hint ? { a: { ...hint.a }, b: { ...hint.b } } : null,
  };
  try { cell.setPointerCapture(e.pointerId); } catch { /* ok */ }
  cell.classList.add('grabbed');
  gemAt(r, c).parentElement.style.zIndex = 6;
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const S = cellStep();
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  let tx = 0, ty = 0;
  if (Math.abs(dx) >= Math.abs(dy)) tx = clamp(dx, -S, S);
  else ty = clamp(dy, -S, S);
  if (drag.c === 0) tx = Math.max(tx, 0);
  if (drag.c === COLS - 1) tx = Math.min(tx, 0);
  if (drag.r === 0) ty = Math.max(ty, 0);
  if (drag.r === ROWS - 1) ty = Math.min(ty, 0);
  drag.tx = tx; drag.ty = ty;
  gemAt(drag.r, drag.c).style.transform = `translate(${tx}px,${ty}px) scale(1.07)`;

  // counter-slide preview on the neighbour under the drag
  let nb = null;
  if (tx !== 0 || ty !== 0) {
    const nr = drag.r + (ty ? Math.sign(ty) : 0);
    const nc = drag.c + (tx ? Math.sign(tx) : 0);
    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) nb = cellEls[nr][nc];
  }
  if (drag.nb && drag.nb !== nb) drag.nb.firstElementChild.style.transform = '';
  drag.nb = nb;
  if (nb) {
    const f = Math.max(Math.abs(tx), Math.abs(ty)) / S;
    nb.firstElementChild.style.transform = `translate(${-tx * f}px,${-ty * f}px)`;
  }
});

function endDrag(e, cancelOnly) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  cellEls[d.r][d.c].classList.remove('grabbed');
  const gem = gemAt(d.r, d.c);
  gem.parentElement.style.zIndex = '';
  if (d.nb) {
    const ng = d.nb.firstElementChild;
    if (ng.style.transform) {
      ng.animate([{ transform: ng.style.transform }, { transform: 'translate(0,0)' }],
        { duration: 120, easing: 'ease-out' });
      ng.style.transform = '';
    }
  }

  const S = cellStep(), TH = S * 0.4;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  let nx = 0, ny = 0;
  if (Math.abs(dx) >= Math.abs(dy)) nx = dx; else ny = dy;

  // The move is decided by NET displacement at release: releasing back on the
  // origin cell (below threshold) is NO move — the out-and-back cancel.
  let target = null;
  if (!cancelOnly && Math.max(Math.abs(nx), Math.abs(ny)) >= TH) {
    const tr = d.r + (ny ? Math.sign(ny) : 0);
    const tc = d.c + (nx ? Math.sign(nx) : 0);
    if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) target = { r: tr, c: tc };
  }
  if (!target) {
    if (gem.style.transform) {
      gem.animate([{ transform: gem.style.transform }, { transform: 'translate(0,0) scale(1)' }],
        { duration: 140, easing: 'ease-out' });
      gem.style.transform = '';
    }
    return;
  }
  commitMove({ r: d.r, c: d.c }, target, d.hintSnap, d.tx, d.ty);
}
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

/* ---------------- new game ---------------- */
function newGame() {
  clearTimeout(hintTimer);
  board = G.createBoard(ROWS, COLS, TYPES, rng);
  score = 0; lastGain = 0; lastBonus = 0; multiplier = 1;
  stageIdx = 0; movesMade = 0;
  matchCounts = new Array(TYPES).fill(0);
  over = false; busy = false; hint = null;
  clearHintVisuals();
  goEl.hidden = true;
  applyStage(false);
  paint();
  updateHud();
  armHint();
}
$('new-game').addEventListener('click', newGame);
$('go-new').addEventListener('click', newGame);

/* ---------------- ambient fireflies ---------------- */
(function fireflies() {
  const host = $('fireflies');
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('span');
    f.className = 'fly';
    f.style.left = 3 + Math.random() * 94 + '%';
    f.style.top = 8 + Math.random() * 84 + '%';
    f.style.setProperty('--dx', (Math.random() * 90 - 45).toFixed(0) + 'px');
    f.style.setProperty('--dy', (Math.random() * 70 - 35).toFixed(0) + 'px');
    f.style.setProperty('--dur', (7 + Math.random() * 9).toFixed(1) + 's');
    f.style.setProperty('--tk', (-Math.random() * 3).toFixed(2) + 's');
    host.appendChild(f);
  }
})();

/* ---------------- boot + observation hooks ---------------- */
best = loadBest();
newGame();

window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => multiplier,
  gemValues: () => gemValues(),
  stage: () => G.stageForScore(score),
  featuredType: () => themeOf(stageIdx).feature,
  bestScore: () => best,
  validMove: () => {
    const m = findValidMove();
    return m ? { a: { ...m.a }, b: { ...m.b } } : null;
  },
  board: () => board.map((row) => [...row]),
  gameOver: () => over,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
};
