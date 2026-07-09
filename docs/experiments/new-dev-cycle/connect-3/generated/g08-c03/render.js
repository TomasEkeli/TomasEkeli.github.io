// render.js — "The Abyssal Lightwell": an 8x8 match-3 played on a stone
// plinth sunk in a bioluminescent deep-sea world. three.js (vendored),
// WebGL scene + an invisible DOM hit-grid for pointer drags.

import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap,
  collapse, longestRun, matchMultiplier, stageForScore,
} from './game.js';

// ---------------------------------------------------------------- constants

const ROWS = 8, COLS = 8, TYPES = 6;
const CELL = 1.18;              // world units per cell
const GEM = 0.46;               // base gem radius
const BEST_KEY = 'abyss-lightwell-best';

const rng = Math.random;

// Gem identities: distinct 3D silhouette per type (colour-blind safe).
const GEMS = [
  { name: 'Azure Prism', color: 0x3a9bff, emissive: 0x0a2a66 },  // octahedron
  { name: 'Gold Ingot',  color: 0xffc23d, emissive: 0x553300 },  // cut cube
  { name: 'Coral Bloom', color: 0xff5d8f, emissive: 0x551126 },  // icosahedron
  { name: 'Ghost Ring',  color: 0xbdf6ff, emissive: 0x1c4a55 },  // torus
  { name: 'Ember Spire', color: 0xff7a2f, emissive: 0x521c00 },  // cone
  { name: 'Jade Drop',   color: 0x3fe08a, emissive: 0x0b4426 },  // dodecahedron
];

// Stage themes: descending zones of the ocean; cycles past the trench.
const STAGES = [
  { name: 'Sunlit Shallows', bg: 0x1c6f9e, fog: 0x2a7fae, hemi: 0x9fd8ff, key: 0xfff2cc, plinth: 0x4b6a72, featured: 1 },
  { name: 'Twilight Zone',   bg: 0x0e3d63, fog: 0x123f66, hemi: 0x5aa0d0, key: 0xcfe8ff, plinth: 0x39505f, featured: 2 },
  { name: 'Midnight Zone',   bg: 0x061c38, fog: 0x08203c, hemi: 0x2c5a86, key: 0x9fc8ff, plinth: 0x2b3a4e, featured: 0 },
  { name: 'Abyssal Plain',   bg: 0x03101f, fog: 0x041224, hemi: 0x1d3d5e, key: 0x77e0d0, plinth: 0x203040, featured: 5 },
  { name: 'Hadal Trench',    bg: 0x02060f, fog: 0x030812, hemi: 0x132a44, key: 0xff9a5a, plinth: 0x181f2c, featured: 4 },
  { name: 'Lantern Garden',  bg: 0x0a1030, fog: 0x0c1236, hemi: 0x3a3f7e, key: 0xd8bfff, plinth: 0x262a48, featured: 3 },
];

// ------------------------------------------------------------ scoring state

// Per-colour value schemes (each scales DIFFERENTLY):
//  0 Azure Prism : cheap but exponential — 5/gem, doubles each match (cap 320)
//  1 Gold Ingot  : expensive but flat — 50/gem, never scales
//  2 Coral Bloom : grows — starts 10/gem, +5 every time it matches
//  3 Ghost Ring  : rarity — worth more the fewer are on the board
//  4 Ember Spire : compounding x1.5 per match (cap 240)
//  5 Jade Drop   : flat 20/gem
let azure = 5, coral = 10, ember = 15;

function gemValue(type, board) {
  switch (type) {
    case 0: return azure;
    case 1: return 50;
    case 2: return coral;
    case 3: {
      let n = 0;
      for (const row of board) for (const v of row) if (v === 3) n++;
      return Math.max(8, 80 - 4 * n);
    }
    case 4: return ember;
    case 5: return 20;
    default: return 10;
  }
}

function bumpGrowingValues(matchedTypes) {
  if (matchedTypes.has(0)) azure = Math.min(320, azure * 2);
  if (matchedTypes.has(2)) coral += 5;
  if (matchedTypes.has(4)) ember = Math.min(240, Math.round(ember * 1.5));
}

const FEATURED_BONUS_PER_GEM = 25;
const DEVIATION_BONUS = 100;

// ---------------------------------------------------------------- game state

let board = createBoard(ROWS, COLS, TYPES, rng);
let score = 0, lastGain = 0, lastBonus = 0, multiplier = 1;
let gameOver = false, busy = false;
let best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
let currentStage = 0;
let hint = null;            // {a,b} or null while shown
let hintTimer = null;

// ------------------------------------------------------------------- scene

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
camera.position.set(0, 13.2, 8.6);
camera.lookAt(0, 0, 0.4);

const hemi = new THREE.HemisphereLight(0x5aa0d0, 0x03111e, 0.9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xcfe8ff, 1.35);
key.position.set(-6, 12, 4);
scene.add(key);
const rim = new THREE.PointLight(0x66f0ff, 22, 30);
rim.position.set(6, 3.5, -6);
scene.add(rim);
const under = new THREE.PointLight(0x2255ff, 14, 18);
under.position.set(0, -2.5, 2);
scene.add(under);

// Stone plinth the board rests on.
const plinthMat = new THREE.MeshStandardMaterial({ color: 0x39505f, roughness: 0.85, metalness: 0.1 });
const plinth = new THREE.Mesh(new THREE.BoxGeometry(COLS * CELL + 1.4, 1.0, ROWS * CELL + 1.4), plinthMat);
plinth.position.y = -0.78;
scene.add(plinth);
const plinthBase = new THREE.Mesh(
  new THREE.CylinderGeometry(7.4, 9.2, 3.2, 10),
  new THREE.MeshStandardMaterial({ color: 0x1a2733, roughness: 0.95 }));
plinthBase.position.y = -2.9;
scene.add(plinthBase);

// Recessed sockets so each gem sits "in" the stage.
const socketMat = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.6, metalness: 0.25 });
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.44, 0.12, 24), socketMat);
    s.position.set(cx(c), -0.24, cz(r));
    scene.add(s);
  }
}

// Sea floor far below + drifting kelp spires around the plinth.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(90, 40),
  new THREE.MeshStandardMaterial({ color: 0x061421, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -8;
scene.add(floor);

const spires = [];
const spireMat = new THREE.MeshStandardMaterial({ color: 0x12303a, roughness: 0.9 });
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2 + 0.35;
  const rr = 14 + (i % 4) * 4;
  const h = 6 + ((i * 37) % 9);
  const sp = new THREE.Mesh(new THREE.ConeGeometry(1.1 + (i % 3) * 0.5, h, 6), spireMat);
  sp.position.set(Math.cos(a) * rr, -8 + h / 2, Math.sin(a) * rr - 4);
  sp.rotation.y = i;
  scene.add(sp);
  spires.push(sp);
}

// Light shafts from the surface (additive translucent cones).
const shafts = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(2.4 + i, 26, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x8fd8ff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }));
  m.position.set(-8 + i * 8, 6, -8 - i * 3);
  m.rotation.z = 0.12 * (i - 1);
  scene.add(m);
  shafts.push(m);
}

// Marine snow — slow drifting particles.
const SNOW_N = 500;
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) {
  snowPos[i * 3] = (Math.random() - 0.5) * 50;
  snowPos[i * 3 + 1] = Math.random() * 24 - 8;
  snowPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  color: 0xbfe8ff, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false,
}));
scene.add(snow);

scene.fog = new THREE.FogExp2(0x123f66, 0.028);

// ----------------------------------------------------------- gem geometry

function gemGeometry(type) {
  switch (type) {
    case 0: return new THREE.OctahedronGeometry(GEM * 1.15);
    case 1: { const g = new THREE.BoxGeometry(GEM * 1.5, GEM * 1.1, GEM * 1.5); return g; }
    case 2: return new THREE.IcosahedronGeometry(GEM * 1.08);
    case 3: return new THREE.TorusGeometry(GEM * 0.82, GEM * 0.34, 10, 22);
    case 4: return new THREE.ConeGeometry(GEM * 0.92, GEM * 2.1, 6);
    case 5: return new THREE.DodecahedronGeometry(GEM * 1.05);
    default: return new THREE.SphereGeometry(GEM);
  }
}
const geos = GEMS.map((_, t) => gemGeometry(t));

function makeGem(type) {
  const mat = new THREE.MeshStandardMaterial({
    color: GEMS[type].color,
    emissive: GEMS[type].emissive,
    roughness: 0.22,
    metalness: 0.35,
    flatShading: true,
    emissiveIntensity: 1.4,
  });
  const mesh = new THREE.Mesh(geos[type], mat);
  mesh.userData.type = type;
  mesh.userData.phase = Math.random() * Math.PI * 2;
  mesh.userData.spin = 0.25 + Math.random() * 0.3;
  if (type === 3) mesh.rotation.x = Math.PI / 2 - 0.35;
  if (type === 4) mesh.rotation.x = 0.55; // tilt the spire so its point reads
  return mesh;
}

function cx(c) { return (c - (COLS - 1) / 2) * CELL; }
function cz(r) { return (r - (ROWS - 1) / 2) * CELL; }

// meshAt[r][c] — the mesh currently occupying that slot.
let meshAt = [];
function buildMeshes() {
  for (const row of meshAt) for (const m of row) if (m) scene.remove(m);
  meshAt = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const m = makeGem(board[r][c]);
      m.position.set(cx(c), 0.42, cz(r));
      scene.add(m);
      row.push(m);
    }
    meshAt.push(row);
  }
}
buildMeshes();

// ------------------------------------------------------------------ tweens

const tweens = [];
function tween({ duration, ease = (t) => t, update, done }) {
  return new Promise((resolve) => {
    tweens.push({ t0: performance.now(), duration, ease, update, done, resolve });
  });
}
const easeIn = (t) => t * t;                 // accelerating (gravity)
const easeOut = (t) => 1 - (1 - t) * (1 - t);
function stepTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    let t = (now - tw.t0) / tw.duration;
    if (t >= 1) t = 1;
    tw.update(tw.ease(t));
    if (t === 1) {
      tweens.splice(i, 1);
      if (tw.done) tw.done();
      tw.resolve();
    }
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------- HUD

const $ = (id) => document.getElementById(id);
const scoreEl = $('score'), bestEl = $('best'), multEl = $('mult'),
  stageEl = $('stage-name'), featEl = $('featured'), popLayer = $('pops'),
  overEl = $('gameover'), hitLayer = $('hits'), legendEl = $('legend');

function fmtHUD() {
  scoreEl.textContent = score.toLocaleString('en-US');
  bestEl.textContent = best.toLocaleString('en-US');
  multEl.textContent = 'x' + multiplier;
  const st = STAGES[currentStage % STAGES.length];
  stageEl.textContent = `Zone ${currentStage + 1} — ${st.name}`;
  featEl.textContent = `featured: ${GEMS[st.featured].name} (+${FEATURED_BONUS_PER_GEM}/gem)`;
  legendEl.innerHTML = GEMS.map((g, t) =>
    `<span class="lg"><i style="background:#${g.color.toString(16).padStart(6, '0')}"></i>${gemValue(t, board)}</span>`
  ).join('');
}

function popGain(gain, bonus) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = '+' + gain.toLocaleString('en-US');
  if (bonus > 0) {
    const b = document.createElement('span');
    b.className = 'pop-bonus';
    b.textContent = `+${bonus} off-hint!`;
    el.appendChild(b);
  }
  popLayer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function applyStage(idx) {
  currentStage = idx;
  const st = STAGES[idx % STAGES.length];
  scene.background = new THREE.Color(st.bg);
  scene.fog.color.set(st.fog);
  hemi.color.set(st.hemi);
  key.color.set(st.key);
  plinthMat.color.set(st.plinth);
  document.body.dataset.stage = String(idx % STAGES.length);
  fmtHUD();
}
scene.background = new THREE.Color(STAGES[0].bg);
applyStage(0);

// -------------------------------------------------------------- hit grid

// One invisible pointer-receiving DOM cell per slot, positioned each frame
// at the slot's projected screen position.
const hitCells = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.className = 'hit';
    d.dataset.testid = 'cell';
    d.setAttribute('data-testid', 'cell');
    d.dataset.r = r; d.dataset.c = c;
    hitLayer.appendChild(d);
    hitCells.push(d);
  }
}

const v3 = new THREE.Vector3();
function projectToPx(x, y, z) {
  v3.set(x, y, z).project(camera);
  return {
    x: (v3.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v3.y * 0.5 + 0.5) * window.innerHeight,
  };
}
let cellPx = 60;
function layoutHitCells() {
  const p00 = projectToPx(cx(0), 0.35, cz(0));
  const p01 = projectToPx(cx(1), 0.35, cz(0));
  const p10 = projectToPx(cx(0), 0.35, cz(1));
  cellPx = Math.min(Math.abs(p01.x - p00.x), Math.abs(p10.y - p00.y)) * 0.96;
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = projectToPx(cx(c), 0.35, cz(r));
      const d = hitCells[i++];
      d.style.width = d.style.height = cellPx + 'px';
      d.style.left = (p.x - cellPx / 2) + 'px';
      d.style.top = (p.y - cellPx / 2) + 'px';
    }
  }
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  layoutHitCells();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ interaction

let drag = null; // { r, c, x0, y0, hintAtStart }

hitLayer.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.hit');
  if (!t || busy || gameOver) return;
  drag = {
    r: +t.dataset.r, c: +t.dataset.c,
    x0: e.clientX, y0: e.clientY,
    hintAtStart: hint ? { a: { ...hint.a }, b: { ...hint.b } } : null,
  };
  e.preventDefault();
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  // gentle visual nudge of the grabbed gem toward the pointer
  const m = meshAt[drag.r][drag.c];
  if (m && !busy) {
    const dx = THREE.MathUtils.clamp((e.clientX - drag.x0) / cellPx, -0.5, 0.5);
    const dy = THREE.MathUtils.clamp((e.clientY - drag.y0) / cellPx, -0.5, 0.5);
    m.position.x = cx(drag.c) + dx * CELL * 0.4;
    m.position.z = cz(drag.r) + dy * CELL * 0.4;
  }
});

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  const m = meshAt[d.r][d.c];
  if (m) { m.position.x = cx(d.c); m.position.z = cz(d.r); }
  if (busy || gameOver) return;
  // Move decided by NET displacement at release.
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  const thresh = cellPx * 0.35;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < thresh) return; // cancelled
  let dr = 0, dc = 0;
  if (Math.abs(dx) >= Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;
  const a = { r: d.r, c: d.c }, b = { r: d.r + dr, c: d.c + dc };
  if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) { rejectMove(a, b); return; }
  attemptMove(a, b, d.hintAtStart);
});

function samePair(p, a, b) {
  if (!p) return false;
  const k = (q) => q.r + ',' + q.c;
  return (k(p.a) === k(a) && k(p.b) === k(b)) || (k(p.a) === k(b) && k(p.b) === k(a));
}

async function rejectMove(a, b) {
  busy = true;
  clearHint(); resetIdle();
  const m = meshAt[a.r][a.c];
  const inBounds = b.r >= 0 && b.r < ROWS && b.c >= 0 && b.c < COLS;
  const m2 = inBounds ? meshAt[b.r][b.c] : null;
  const ox = m.position.x, oz = m.position.z;
  const tx = inBounds ? cx(b.c) : ox, tz = inBounds ? cz(b.r) : oz;
  await tween({
    duration: 260, ease: (t) => Math.sin(t * Math.PI),
    update: (t) => {
      m.position.x = ox + (tx - ox) * 0.4 * t;
      m.position.z = oz + (tz - oz) * 0.4 * t;
      if (m2) { m2.position.x = tx + (ox - tx) * 0.4 * t; m2.position.z = tz + (oz - tz) * 0.4 * t; }
    },
  });
  m.position.set(ox, m.position.y, oz);
  if (m2) m2.position.set(tx, m2.position.y, tz);
  busy = false;
}

async function attemptMove(a, b, hintSnapshot) {
  if (!isValidSwap(board, a, b)) { rejectMove(a, b); return; }
  busy = true;
  const deviated = hintSnapshot && !samePair(hintSnapshot, a, b);
  clearHint(); resetIdle();

  // 1. swap animation
  const ma = meshAt[a.r][a.c], mb = meshAt[b.r][b.c];
  const ax = cx(a.c), az = cz(a.r), bx = cx(b.c), bz = cz(b.r);
  await tween({
    duration: 170, ease: easeOut,
    update: (t) => {
      ma.position.x = ax + (bx - ax) * t; ma.position.z = az + (bz - az) * t;
      mb.position.x = bx + (ax - bx) * t; mb.position.z = bz + (az - bz) * t;
      ma.position.y = 0.42 + Math.sin(t * Math.PI) * 0.35;
    },
  });
  meshAt[a.r][a.c] = mb; meshAt[b.r][b.c] = ma;

  const swapped = applySwap(board, a, b);
  const { board: settled, steps } = collapse(swapped, rng, TYPES);

  // scoring — measured on the incoming board of each wave
  let runMax = longestRun(swapped);
  let moveRaw = 0, featuredCount = 0;
  const matchedTypes = new Set();
  const featured = STAGES[currentStage % STAGES.length].featured;
  let waveBoard = swapped;
  for (let i = 0; i < steps.length; i++) {
    const cf = i === 0 ? 1 : 2;
    let waveRaw = 0;
    for (const { r, c } of steps[i].matches) {
      const type = waveBoard[r][c];
      matchedTypes.add(type);
      waveRaw += gemValue(type, waveBoard);
      if (type === featured) featuredCount++;
    }
    runMax = Math.max(runMax, longestRun(waveBoard));
    moveRaw += waveRaw * cf;
    waveBoard = steps[i].board;
  }
  multiplier = matchMultiplier(multiplier, runMax);
  const bonus = deviated ? DEVIATION_BONUS : 0;
  const gain = moveRaw * multiplier + featuredCount * FEATURED_BONUS_PER_GEM + bonus;

  // 2. animate waves: clear then physical drop, per wave
  let animBoard = swapped;
  board = swapped;
  for (const step of steps) {
    await animateClear(step.matches);
    await animateDrop(animBoard, step);
    animBoard = step.board;
    board = step.board;
    fmtHUD();
  }
  board = settled;

  bumpGrowingValues(matchedTypes);
  score += gain;
  lastGain = gain;
  lastBonus = bonus;
  if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
  const st = stageForScore(score);
  if (st !== currentStage) applyStage(st);
  popGain(gain, bonus);
  fmtHUD();

  if (!hasValidMove(board)) {
    gameOver = true;
    overEl.classList.add('show');
  }
  busy = false;
  resetIdle();
}

async function animateClear(matches) {
  const marks = matches.map(({ r, c }) => meshAt[r][c]).filter(Boolean);
  await tween({
    duration: 230, ease: (t) => t,
    update: (t) => {
      for (const m of marks) {
        const s = 1 + Math.sin(t * Math.PI) * 0.45 - t;
        m.scale.setScalar(Math.max(0.001, s));
        m.material.emissiveIntensity = 1 + t * 6;
        m.rotation.y += 0.25;
      }
    },
  });
  for (const m of marks) scene.remove(m);
}

async function animateDrop(preBoard, step) {
  // Compute, per column, where each surviving mesh lands and which cells are
  // refills; animate an accelerating fall, duration scaled per cell of travel.
  const matched = new Set(step.matches.map(({ r, c }) => r + ',' + c));
  const next = step.board;
  const moves = []; // { mesh, fromZ, toZ, x }
  const newGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!matched.has(r + ',' + c)) survivors.push(meshAt[r][c]);
    }
    let i = 0;
    for (let r = ROWS - 1; r >= 0; r--, i++) {
      if (i < survivors.length) {
        const mesh = survivors[i];
        newGrid[r][c] = mesh;
        if (mesh.position.z !== cz(r)) {
          moves.push({ mesh, fromZ: mesh.position.z, toZ: cz(r), x: cx(c) });
        }
      } else {
        // refill: spawn K cells above its destination (K = refills in column),
        // so refills stack above the top edge and fall in in order.
        const K = ROWS - survivors.length;
        const mesh = makeGem(next[r][c]);
        mesh.position.set(cx(c), 0.42, cz(r) - CELL * K);
        scene.add(mesh);
        newGrid[r][c] = mesh;
        moves.push({ mesh, fromZ: mesh.position.z, toZ: cz(r), x: cx(c) });
      }
    }
  }
  meshAt = newGrid;
  if (moves.length === 0) return;
  const maxDist = Math.max(...moves.map((m) => Math.abs(m.toZ - m.fromZ)));
  const totalMs = 130 + 105 * (maxDist / CELL);
  await tween({
    duration: totalMs, ease: (t) => t,
    update: (t) => {
      for (const mv of moves) {
        const frac = Math.abs(mv.toZ - mv.fromZ) / maxDist;
        // each gem falls for a time proportional to its distance, accelerating
        const local = Math.min(1, frac === 0 ? 1 : t / frac);
        mv.mesh.position.z = mv.fromZ + (mv.toZ - mv.fromZ) * easeIn(local);
        mv.mesh.position.x = mv.x;
      }
    },
  });
  for (const mv of moves) { mv.mesh.position.z = mv.toZ; }
  // tiny landing squash
  await tween({
    duration: 90, ease: (t) => t,
    update: (t) => {
      for (const mv of moves) mv.mesh.scale.set(1 + 0.12 * Math.sin(t * Math.PI), 1 - 0.12 * Math.sin(t * Math.PI), 1 + 0.12 * Math.sin(t * Math.PI));
    },
  });
}

// ------------------------------------------------------------ hint / idle

function firstValidMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(board, { r, c }, { r, c: c + 1 }))
        return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < ROWS && isValidSwap(board, { r, c }, { r: r + 1, c }))
        return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}

function clearHint() { hint = null; }
function resetIdle() {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (busy || gameOver || hint) return;
    const mv = firstValidMove();
    if (mv) hint = mv;
  }, 10000);
}
resetIdle();

// ------------------------------------------------------------- new game

function newGame() {
  board = createBoard(ROWS, COLS, TYPES, rng);
  score = 0; lastGain = 0; lastBonus = 0; multiplier = 1;
  azure = 5; coral = 10; ember = 15;
  gameOver = false; busy = false;
  overEl.classList.remove('show');
  clearHint(); resetIdle();
  applyStage(0);
  buildMeshes();
  fmtHUD();
}
document.querySelectorAll('[data-testid="new-game"]').forEach((b) =>
  b.addEventListener('click', newGame));

// ------------------------------------------------------------- animation

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const t = clock.getElapsedTime();
  stepTweens(now);

  // idle life: bob + slow spin; hinted gems wiggle subtly
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = meshAt[r][c];
      if (!m) continue;
      m.position.y = 0.42 + Math.sin(t * 1.3 + m.userData.phase) * 0.05;
      m.rotation.y += m.userData.spin * 0.008;
      const hinted = hint && ((hint.a.r === r && hint.a.c === c) || (hint.b.r === r && hint.b.c === c));
      if (hinted) {
        m.position.y += Math.abs(Math.sin(t * 6)) * 0.14;
        m.rotation.z = Math.sin(t * 8) * 0.09;
      } else if (m.userData.type !== 3) {
        m.rotation.z *= 0.9;
      }
    }
  }
  // environment life
  const pos = snow.geometry.attributes.position;
  for (let i = 0; i < SNOW_N; i++) {
    let y = pos.getY(i) - 0.008;
    if (y < -8) y = 16;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + i) * 0.002);
  }
  pos.needsUpdate = true;
  for (let i = 0; i < shafts.length; i++) {
    shafts[i].material.opacity = 0.035 + Math.sin(t * 0.5 + i * 2) * 0.02;
  }
  rim.intensity = 20 + Math.sin(t * 0.8) * 5;
  for (let i = 0; i < spires.length; i++) spires[i].rotation.y += 0.0004;

  layoutHitCells();
  renderer.render(scene, camera);
}
fmtHUD();
frame();

// ------------------------------------------------------------- test hooks

window.__test = {
  score() { return score; },
  lastGain() { return lastGain; },
  lastBonus() { return lastBonus; },
  multiplier() { return multiplier; },
  gemValues() { return GEMS.map((_, t) => gemValue(t, board)); },
  stage() { return currentStage; },
  featuredType() { return STAGES[currentStage % STAGES.length].featured; },
  bestScore() { return best; },
  validMove() { return firstValidMove(); },
  board() { return board.map((row) => row.slice()); },
  gameOver() { return gameOver; },
  hint() { return hint ? { a: { ...hint.a }, b: { ...hint.b } } : null; },
  async slide(r, c, dir) {
    const d = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } }[dir];
    if (!d) return;
    const a = { r, c }, b = { r: r + d.r, c: c + d.c };
    if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return;
    const snap = hint ? { a: { ...hint.a }, b: { ...hint.b } } : null;
    await attemptMove(a, b, snap);
    while (busy) await wait(40);
  },
};
