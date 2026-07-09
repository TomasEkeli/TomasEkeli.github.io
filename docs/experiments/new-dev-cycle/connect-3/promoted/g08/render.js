// ABYSSAL LUMEN — a bioluminescent deep-sea dive.
// three.js (vendored) 3D world; logic stays the pure 2D grid in game.js.

import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove,
  applySwap, collapse, longestRun, matchMultiplier, stageForScore,
} from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const S = 1.16;               // world units per cell
const BEST_KEY = 'abyssal-lumen-best';
const rng = Math.random;

// ---------------------------------------------------------------- stage themes
const STAGES = [
  { name: 'Sunlit Shallows',  bg: 0x0b4f6c, fog: 0x0b4f6c, amb: 0x9fd8e8, key: 0xfff3d6, glow: 0x53d8fb, snow: 0xbfefff, featured: 4 },
  { name: 'Twilight Zone',    bg: 0x073352, fog: 0x073352, amb: 0x6fa8c9, key: 0xcfe8ff, glow: 0x2ec4b6, snow: 0x9fd0e8, featured: 0 },
  { name: 'Midnight Zone',    bg: 0x041c33, fog: 0x041c33, amb: 0x3f6a8f, key: 0x9db8d8, glow: 0x8a4fff, snow: 0x7f9fc0, featured: 3 },
  { name: 'Abyssal Plain',    bg: 0x02101f, fog: 0x02101f, amb: 0x2f4a66, key: 0x7f97b8, glow: 0xff5d8f, snow: 0x5f7f9f, featured: 2 },
  { name: 'Hadal Trench',     bg: 0x010810, fog: 0x010810, amb: 0x24384f, key: 0x6f87a8, glow: 0xffb703, snow: 0x4f6f8f, featured: 1 },
  { name: 'The Luminous Rift',bg: 0x0d0420, fog: 0x0d0420, amb: 0x4f3a7f, key: 0xb8a0e8, glow: 0xb8ffdd, snow: 0x9f8fd0, featured: 5 },
];
const stageAt = (i) => STAGES[i % STAGES.length];

// gem palette: [name, colour, shape] — distinct 3D silhouettes per type
const GEMS = [
  { name: 'Riftlight',  color: 0x2ec4b6 }, // octahedron  — cheap, exponential
  { name: 'Amberglass', color: 0xffb703 }, // hex prism   — expensive, flat
  { name: 'Anglerbloom',color: 0xff5d8f }, // tetrahedron — grows each match
  { name: 'Voidstone',  color: 0x8a4fff }, // cube        — worth more when rare
  { name: 'Kelpshard',  color: 0x9ef01a }, // icosahedron — deeper stages pay more
  { name: 'Ghostice',   color: 0x9be7ff }, // dodecahedron— fades as it is farmed
];

// ---------------------------------------------------------------- game state
let board, score = 0, lastGain = 0, lastBonus = 0, mult = 1;
let gameOver = false, animating = false;
let hint = null, hintTimer = null;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let matchedCount = new Array(TYPES).fill(0); // per-playthrough match counters

function gemValue(t) {
  switch (t) {
    case 0: return Math.min(320, 5 * 2 ** matchedCount[0]);            // exponential
    case 1: return 50;                                                  // flat
    case 2: return Math.min(200, 20 + 10 * matchedCount[2]);           // grows/match
    case 3: {                                                           // rarity
      let n = 0;
      for (const row of board) for (const v of row) if (v === 3) n++;
      return Math.max(5, (64 - n) * 2);
    }
    case 4: return 15 + 8 * stageForScore(score);                       // deeper = richer
    case 5: return Math.max(10, 100 - 10 * matchedCount[5]);            // fades
  }
}
const gemValues = () => GEMS.map((_, t) => gemValue(t));

function firstValidMove(b) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c + 1 < COLS && isValidSwap(b, { r, c }, { r, c: c + 1 }))
      return { a: { r, c }, b: { r, c: c + 1 } };
    if (r + 1 < ROWS && isValidSwap(b, { r, c }, { r: r + 1, c }))
      return { a: { r, c }, b: { r: r + 1, c } };
  }
  return null;
}

// ---------------------------------------------------------------- three scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
camera.position.set(0, 0.9, 14.5);
camera.lookAt(0, -0.2, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(4, 8, 6);
const glowA = new THREE.PointLight(0x53d8fb, 30, 30);
glowA.position.set(-6, 3, 3);
const glowB = new THREE.PointLight(0xff5d8f, 22, 26);
glowB.position.set(6, -3, 2);
scene.add(ambient, key, glowA, glowB);

// board wall: stone slab + recessed sockets
const world = new THREE.Group();
world.rotation.x = -0.17; // lean the wall back a touch — real perspective depth.
// (Rotation about X only: every board row keeps a single screen y, so the
// gate's sort-by-y-then-x cell mapping stays exact.)
world.updateMatrixWorld(true);
scene.add(world);
const slabMat = new THREE.MeshStandardMaterial({ color: 0x122438, roughness: 0.9, metalness: 0.1 });
const slab = new THREE.Mesh(new THREE.BoxGeometry(COLS * S + 1.1, ROWS * S + 1.1, 0.6), slabMat);
slab.position.z = -0.62;
world.add(slab);
const socketMat = new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 1 });
const socketGeo = new THREE.BoxGeometry(S * 0.94, S * 0.94, 0.18);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const s = new THREE.Mesh(socketGeo, socketMat);
  s.position.set(cx(c), cy(r), -0.3);
  world.add(s);
}

function cx(c) { return (c - (COLS - 1) / 2) * S; }
function cy(r) { return ((ROWS - 1) / 2 - r) * S; }

// environment: sea floor, trench pillars, kelp, marine snow, light shafts
const floorMat = new THREE.MeshStandardMaterial({ color: 0x0c2033, roughness: 1 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -7.2;
scene.add(floor);

const pillarMat = new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.95, flatShading: true });
const pillars = [];
for (let i = 0; i < 14; i++) {
  const h = 6 + Math.random() * 14;
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5 + Math.random() * 1.4, 1 + Math.random() * 2.2, h, 6), pillarMat);
  const side = i % 2 ? 1 : -1;
  p.position.set(side * (7 + Math.random() * 12), -7 + h / 2, -6 - Math.random() * 22);
  p.rotation.y = Math.random() * Math.PI;
  scene.add(p); pillars.push(p);
}
const kelpMat = new THREE.MeshStandardMaterial({ color: 0x1f5f3f, roughness: 0.9, flatShading: true });
const kelps = [];
for (let i = 0; i < 10; i++) {
  const h = 3 + Math.random() * 6;
  const k = new THREE.Mesh(new THREE.ConeGeometry(0.22, h, 5), kelpMat);
  k.position.set((Math.random() - 0.5) * 30, -7.2 + h / 2, -4 - Math.random() * 14);
  scene.add(k); kelps.push(k);
}
// marine snow particles
const SNOW_N = 500;
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) {
  snowPos[i * 3] = (Math.random() - 0.5) * 46;
  snowPos[i * 3 + 1] = (Math.random() - 0.5) * 26;
  snowPos[i * 3 + 2] = 6 - Math.random() * 30;
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({ color: 0xbfefff, size: 0.09, transparent: true, opacity: 0.65, depthWrite: false });
scene.add(new THREE.Points(snowGeo, snowMat));
// god-ray shafts
const shaftMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const shafts = [];
for (let i = 0; i < 5; i++) {
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + Math.random() * 2, 30), shaftMat);
  sh.position.set(-10 + i * 5 + Math.random() * 2, 6, -8 - Math.random() * 6);
  sh.rotation.z = 0.28 + Math.random() * 0.1;
  scene.add(sh); shafts.push(sh);
}
scene.fog = new THREE.Fog(0x073352, 10, 44);

// gem geometry per type — distinct silhouettes (colour-blind safe)
const GEOS = [
  new THREE.OctahedronGeometry(S * 0.42),
  new THREE.CylinderGeometry(S * 0.36, S * 0.36, S * 0.56, 6),
  new THREE.TetrahedronGeometry(S * 0.5),
  new THREE.BoxGeometry(S * 0.6, S * 0.6, S * 0.6),
  new THREE.IcosahedronGeometry(S * 0.42),
  new THREE.DodecahedronGeometry(S * 0.42),
];
const MATS = GEMS.map((g) => new THREE.MeshStandardMaterial({
  color: g.color, flatShading: true, metalness: 0.35, roughness: 0.22,
  emissive: g.color, emissiveIntensity: 0.22,
}));

let meshes = []; // meshes[r][c]
function makeGem(t, r, c) {
  const m = new THREE.Mesh(GEOS[t], MATS[t].clone());
  m.position.set(cx(c), cy(r), 0.28);
  m.userData = { t, spin: 0.2 + Math.random() * 0.5, phase: Math.random() * 6.28, baseZ: 0.28 };
  world.add(m);
  return m;
}
function buildMeshes() {
  for (const row of meshes) for (const m of row) world.remove(m);
  meshes = board.map((row, r) => row.map((t, c) => makeGem(t, r, c)));
}

// ---------------------------------------------------------------- tweens
const tweens = [];
function tween(ms, fn, ease = (x) => x) {
  return new Promise((res) => tweens.push({ t0: performance.now(), ms, fn, ease, res }));
}
const easeIn = (x) => x * x;         // accelerating fall
const easeOut = (x) => 1 - (1 - x) * (1 - x);
function stepTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const p = Math.min(1, (now - tw.t0) / tw.ms);
    tw.fn(tw.ease(p));
    if (p >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}

// ---------------------------------------------------------------- HUD / DOM
const $ = (id) => document.getElementById(id);
const hud = { score: $('score'), best: $('best'), mult: $('mult'), stage: $('stage'), feat: $('featured') };
const floatLayer = $('floats');
const hitLayer = $('hits');
const overEl = $('gameover');

function popFloat(text, cls) {
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.textContent = text;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

let currentStageIdx = -1;
function applyStage() {
  const idx = stageForScore(score);
  if (idx === currentStageIdx) return;
  currentStageIdx = idx;
  const th = stageAt(idx);
  scene.background = new THREE.Color(th.bg);
  scene.fog.color.set(th.fog);
  ambient.color.set(th.amb);
  key.color.set(th.key);
  glowA.color.set(th.glow);
  snowMat.color.set(th.snow);
  floorMat.color.set(th.bg).multiplyScalar(2.2);
  hud.stage.textContent = `Depth ${idx + 1} · ${th.name}`;
  hud.feat.textContent = `${GEMS[th.featured].name} pays extra here`;
  hud.feat.style.color = '#' + GEMS[th.featured].color.toString(16).padStart(6, '0');
  document.body.dataset.stage = idx % STAGES.length;
}
function refreshHud() {
  hud.score.textContent = score.toLocaleString();
  hud.best.textContent = best.toLocaleString();
  hud.mult.textContent = '×' + mult;
  applyStage();
}

// ---------------------------------------------------------------- hit cells
const hitCells = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const d = document.createElement('div');
  d.className = 'hitcell';
  d.dataset.testid = 'cell';
  d.setAttribute('data-testid', 'cell');
  d.dataset.r = r; d.dataset.c = c;
  hitLayer.appendChild(d);
  hitCells.push(d);
}
const proj = new THREE.Vector3();
function screenOf(x, y, z) {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  proj.set(x, y, z);
  world.localToWorld(proj);
  proj.project(camera);
  return { x: (proj.x + 1) / 2 * w, y: (1 - proj.y) / 2 * h };
}
function layoutHitCells() {
  // The board tilts only about X and the camera never rolls or leaves the
  // board's vertical axis, so each board row projects to one exact screen y —
  // compute one y per row and per-cell x, guaranteeing the 64 centres sort
  // row-major by screen y then x.
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    const y = screenOf(0, cy(r), 0.28).y;
    const px = Math.abs(screenOf(cx(1), cy(r), 0.28).x - screenOf(cx(0), cy(r), 0.28).x) * 0.94;
    for (let c = 0; c < COLS; c++) {
      const el = hitCells[i++];
      const sx = screenOf(cx(c), cy(r), 0.28).x;
      el.style.width = el.style.height = px + 'px';
      el.style.left = (sx - px / 2) + 'px';
      el.style.top = (y - px / 2) + 'px';
    }
  }
}

// ---------------------------------------------------------------- interaction
let drag = null;
hitLayer.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.hitcell');
  if (!cell || animating || gameOver) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  drag = { r, c, x0: e.clientX, y0: e.clientY, hintSnap: hint ? { a: { ...hint.a }, b: { ...hint.b } } : null };
  cell.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  // gem follows the finger a little (clamped), for feel
  const m = meshes[drag.r] && meshes[drag.r][drag.c];
  if (m) {
    const k = 0.004 * S;
    m.position.x = cx(drag.c) + clamp((e.clientX - drag.x0) * k, -S * 0.45, S * 0.45);
    m.position.y = cy(drag.r) - clamp((e.clientY - drag.y0) * k, -S * 0.45, S * 0.45);
  }
});
document.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  const m = meshes[d.r] && meshes[d.r][d.c];
  if (m) { m.position.x = cx(d.c); m.position.y = cy(d.r); }
  if (animating || gameOver) return;
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  const cellPx = hitCells[0].offsetWidth || 48;
  const th = cellPx * 0.45;
  // committed by where the gesture ENDS: below threshold => no move (cancel)
  if (Math.max(Math.abs(dx), Math.abs(dy)) < th) return;
  let dr = 0, dc = 0;
  if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;
  attemptMove({ r: d.r, c: d.c }, { r: d.r + dr, c: d.c + dc }, d.hintSnap);
});
document.addEventListener('pointercancel', () => {
  if (!drag) return;
  const m = meshes[drag.r] && meshes[drag.r][drag.c];
  if (m) { m.position.x = cx(drag.c); m.position.y = cy(drag.r); }
  drag = null;
});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function attemptMove(a, b, hintSnap) {
  if (b.r < 0 || b.r >= ROWS || b.c < 0 || b.c >= COLS) return rejectAnim(a);
  if (!isValidSwap(board, a, b)) return rejectAnim(a, b);
  clearHint();
  animating = true;
  const ma = meshes[a.r][a.c], mb = meshes[b.r][b.c];
  await tween(170, (p) => {
    ma.position.set(lerp(cx(a.c), cx(b.c), p), lerp(cy(a.r), cy(b.r), p), 0.28 + 0.35 * Math.sin(p * Math.PI));
    mb.position.set(lerp(cx(b.c), cx(a.c), p), lerp(cy(b.r), cy(a.r), p), 0.28);
  }, easeOut);
  meshes[a.r][a.c] = mb; meshes[b.r][b.c] = ma;

  const swapped = applySwap(board, a, b);
  const { board: settled, steps } = collapse(swapped, rng, TYPES);

  // multiplier: longest run over each wave's incoming board
  let L = longestRun(swapped);
  for (let i = 0; i + 1 < steps.length; i++) L = Math.max(L, longestRun(steps[i].board));
  mult = matchMultiplier(mult, L);

  // score the waves, animating each: clear -> accelerating drop
  const featured = stageAt(stageForScore(score)).featured;
  let raw = 0, featCount = 0;
  let cur = swapped;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    board = cur; // rarity values read the wave's incoming board
    let waveRaw = 0;
    const perWaveMatched = new Array(TYPES).fill(0);
    for (const { r, c } of step.matches) {
      const t = cur[r][c];
      waveRaw += gemValue(t);
      perWaveMatched[t] = 1;
      if (t === featured) featCount++;
    }
    for (let t = 0; t < TYPES; t++) matchedCount[t] += perWaveMatched[t];
    raw += waveRaw * (i === 0 ? 1 : 2); // cascade waves pay double
    await animateWave(cur, step);
    cur = step.board;
  }
  board = settled;

  const featBonus = featCount * 40;
  const deviated = hintSnap && !samePair(hintSnap, { a, b });
  lastBonus = deviated ? 100 : 0;
  lastGain = raw * mult + featBonus + lastBonus;
  score += lastGain;
  if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
  popFloat('+' + (lastGain - lastBonus).toLocaleString(), 'gain');
  if (featBonus) popFloat(`+${featBonus} featured ${GEMS[featured].name}`, 'feat');
  if (lastBonus) popFloat('+100 OFF THE CHART!', 'bonus');
  refreshHud();

  if (!hasValidMove(board)) enterGameOver();
  animating = false;
  armHint();
}

function samePair(p, q) {
  const k = (x) => x.r + ',' + x.c;
  const A = [k(p.a), k(p.b)].sort().join('|');
  const B = [k(q.a), k(q.b)].sort().join('|');
  return A === B;
}
const lerp = (a, b, p) => a + (b - a) * p;

async function rejectAnim(a, b) {
  animating = true;
  const m = meshes[a.r][a.c];
  const bx = b ? (cx(b.c) - cx(a.c)) * 0.2 : 0;
  const by = b ? (cy(b.r) - cy(a.r)) * 0.2 : 0;
  await tween(240, (p) => {
    const s = Math.sin(p * Math.PI * 3) * (1 - p);
    m.position.x = cx(a.c) + bx * Math.sin(p * Math.PI) + s * 0.08;
    m.position.y = cy(a.r) + by * Math.sin(p * Math.PI);
  });
  m.position.set(cx(a.c), cy(a.r), 0.28);
  animating = false;
  armHint();
}

async function animateWave(pre, step) {
  // 1) clear: matched gems throb bright, then vanish
  const doomed = step.matches.map(({ r, c }) => meshes[r][c]);
  await tween(230, (p) => {
    for (const m of doomed) {
      m.scale.setScalar(1 + 0.35 * Math.sin(p * Math.PI) - p);
      m.material.emissiveIntensity = 0.22 + p * 2.2;
      m.rotation.y += 0.2;
    }
  });
  for (const m of doomed) world.remove(m);
  for (const { r, c } of step.matches) meshes[r][c] = null;

  // 2) drop: survivors fall, refills drop in from above — accelerating per cell
  const falls = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (meshes[r][c]) {
        if (write !== r) {
          falls.push({ m: meshes[r][c], fromY: cy(r), toY: cy(write), cells: write - r });
          meshes[write][c] = meshes[r][c];
          meshes[r][c] = null;
        }
        write--;
      }
    }
    // refills: step.board's top cells of this column are the new gems
    let spawn = 1;
    for (let r = write; r >= 0; r--, spawn++) {
      const m = makeGem(step.board[r][c], r, c);
      const fromY = cy(-spawn) + S * 0.4;
      m.position.y = fromY;
      meshes[r][c] = m;
      falls.push({ m, fromY, toY: cy(r), cells: (fromY - cy(r)) / S });
    }
  }
  if (falls.length) {
    const maxCells = Math.max(...falls.map((f) => f.cells));
    const dur = 130 * Math.sqrt(maxCells) + 120;
    await tween(dur, (p) => {
      for (const f of falls) {
        // each gem accelerates over its own travel
        const own = Math.min(1, p * Math.sqrt(maxCells / f.cells));
        f.m.position.y = lerp(f.fromY, f.toY, easeIn(own));
      }
    });
    for (const f of falls) f.m.position.y = f.toY;
  }
}

// ---------------------------------------------------------------- hint
function armHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (animating || gameOver) return;
    const mv = firstValidMove(board);
    if (mv) hint = mv;
  }, 10000);
}
function clearHint() {
  if (hint) {
    const m = meshes[hint.a.r] && meshes[hint.a.r][hint.a.c];
    if (m) { m.rotation.z = 0; m.scale.setScalar(1); }
  }
  hint = null;
  clearTimeout(hintTimer);
}

// ---------------------------------------------------------------- game over / new game
function enterGameOver() {
  gameOver = true;
  overEl.classList.add('show');
}
function newGame() {
  clearHint();
  board = createBoard(ROWS, COLS, TYPES, rng);
  score = 0; lastGain = 0; lastBonus = 0; mult = 1;
  matchedCount = new Array(TYPES).fill(0);
  gameOver = false; animating = false;
  overEl.classList.remove('show');
  currentStageIdx = -1;
  buildMeshes();
  refreshHud();
  armHint();
}
document.querySelector('[data-testid="new-game"]').addEventListener('click', newGame);

// ---------------------------------------------------------------- loop
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // keep the whole board in frame on narrow screens
  camera.fov = w / h < 0.95 ? 58 : 42;
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => { resize(); layoutHitCells(); });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  stepTweens(now);
  // idle life: gems slowly turn and bob
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const m = meshes[r] && meshes[r][c];
    if (!m) continue;
    m.rotation.y += m.userData.spin * dt;
    m.position.z = m.userData.baseZ + 0.06 * Math.sin(t * 1.4 + m.userData.phase);
    if (hint && ((hint.a.r === r && hint.a.c === c) || (hint.b.r === r && hint.b.c === c))) {
      m.rotation.z = 0.14 * Math.sin(t * 9);           // subtle wiggle
      m.scale.setScalar(1 + 0.05 * Math.sin(t * 6));
    }
  }
  // environment life
  glowA.position.x = -6 + 2.5 * Math.sin(t * 0.3);
  glowB.position.y = -3 + 2 * Math.sin(t * 0.23 + 2);
  for (const k of kelps) k.rotation.z = 0.12 * Math.sin(t * 0.7 + k.position.x);
  for (const sh of shafts) sh.material.opacity = 0.045 + 0.025 * Math.sin(t * 0.4 + sh.position.x);
  const pos = snowGeo.attributes.position;
  for (let i = 0; i < SNOW_N; i++) {
    let y = pos.getY(i) - dt * (0.25 + (i % 5) * 0.06);
    if (y < -13) y = 13;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t * 0.5 + i) * dt * 0.08);
  }
  pos.needsUpdate = true;
  // gentle camera breathing (depth drift only — the camera stays on the
  // board's vertical axis so projected rows stay perfectly horizontal and
  // the hit-grid mapping stays row-major-safe)
  camera.position.x = 0;
  camera.position.y = 0.9 + 0.15 * Math.sin(t * 0.09);
  camera.position.z = 14.5 + 0.25 * Math.sin(t * 0.07);
  camera.lookAt(0, -0.2, 0);
  layoutHitCells(); // hit cells track the projection exactly, every frame
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- test hooks
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => mult,
  gemValues: () => gemValues(),
  stage: () => stageForScore(score),
  featuredType: () => stageAt(stageForScore(score)).featured,
  bestScore: () => best,
  validMove: () => firstValidMove(board),
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
  slide: (r, c, dir) => {
    const d = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } }[dir];
    return attemptMove({ r, c }, { r: r + d.r, c: c + d.c }, hint ? { a: { ...hint.a }, b: { ...hint.b } } : null);
  },
};

// ---------------------------------------------------------------- boot
board = createBoard(ROWS, COLS, TYPES, rng);
buildMeshes();
resize();
refreshHud();
layoutHitCells();
armHint();
requestAnimationFrame(frame);
