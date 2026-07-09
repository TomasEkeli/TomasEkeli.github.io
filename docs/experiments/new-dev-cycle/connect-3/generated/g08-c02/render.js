// render.js — 3D "Astral Facets" world (three.js, vendored) over 2D match-3 logic.
import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove,
  applySwap, collapse, longestRun, matchMultiplier, stageForScore,
} from './game.js';

// ---------------------------------------------------------------------------
// Config
const ROWS = 8, COLS = 8, TYPES = 6;
const GAP = 1.0;             // world spacing between cell centres
const OFF = (COLS - 1) / 2;  // centre offset

// Deterministic RNG for the UI board
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

// ---------------------------------------------------------------------------
// Gem type descriptors — distinct SHAPE + colour + scoring scheme per type.
// Shapes chosen for silhouette variety (colour-blind safe).
const GEM_DEFS = [
  { name: 'Ruby',    color: 0xff4d6d, emissive: 0x5a0d1c, shape: 'octahedron', scheme: 'exp' },
  { name: 'Topaz',   color: 0xffc857, emissive: 0x5a3d00, shape: 'cube',       scheme: 'flat' },
  { name: 'Emerald', color: 0x4dffb0, emissive: 0x004d33, shape: 'prism',      scheme: 'grow' },
  { name: 'Sapphire',color: 0x5a8bff, emissive: 0x0a1f5a, shape: 'diamond',    scheme: 'rarity' },
  { name: 'Amethyst',color: 0xc77dff, emissive: 0x3a1060, shape: 'dodeca',     scheme: 'stage' },
  { name: 'Moonstone',color:0xf5f7ff, emissive: 0x33384d, shape: 'sphere',     scheme: 'flat2' },
];

// Stage themes — re-dress world & feature a colour every 100k points.
const STAGES = [
  { name: 'The Veil Nebula',  sky: [0x1a1030, 0x05060f], fog: 0x0a0818, feature: 0 },
  { name: 'Orion’s Belt', sky: [0x0a2540, 0x03060f], fog: 0x061224, feature: 3 },
  { name: 'The Ember Cluster', sky: [0x3a1208, 0x0a0402], fog: 0x1a0803, feature: 1 },
  { name: 'Aurora Expanse',   sky: [0x083a2c, 0x03100a], fog: 0x06201a, feature: 2 },
  { name: 'The Violet Rift',  sky: [0x2a0a44, 0x080314], fog: 0x160828, feature: 4 },
  { name: 'Silver Halo',      sky: [0x2a3050, 0x0a0d18, ], fog: 0x141826, feature: 5 },
];
function stageTheme(i) { return STAGES[i % STAGES.length]; }

// ---------------------------------------------------------------------------
// Scoring state (UI-owned)
let baseGemValues;          // per-colour current value
let matchCounts;            // times each colour matched (for grow/exp)
function resetScoring() {
  baseGemValues = [5, 50, 20, 0, 24, 15];   // seed; index 3 rarity computed live
  matchCounts = [0, 0, 0, 0, 0, 0];
}
function currentGemValues() {
  // returns per-colour CURRENT per-gem value (not all equal)
  const counts = countOnBoard();
  return GEM_DEFS.map((d, t) => gemValue(t, counts));
}
function countOnBoard() {
  const c = [0, 0, 0, 0, 0, 0];
  for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) c[board[r][col]]++;
  return c;
}
function gemValue(t, counts) {
  const def = GEM_DEFS[t];
  switch (def.scheme) {
    case 'exp':   return Math.min(5 * 2 ** matchCounts[t], 5000);      // cheap, exponential
    case 'flat':  return 50;                                           // expensive, flat
    case 'grow':  return 20 + 5 * matchCounts[t];                      // grows per match
    case 'rarity': { const n = counts[t] || 1; return Math.round(400 / n); } // rarer = worth more
    case 'stage': return 8 * (1 + stage);                             // scales with stage
    case 'flat2': return 15;                                          // steady mid
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Game state
let board;                 // logical 8x8 grid of ints
let score = 0, best = 0, mult = 1, stage = 0, lastGain = 0, lastBonus = 0;
let over = false;
let busy = false;          // mid-animation lock
let hint = null;           // {a,b} currently displayed, or null
let hintTimer = 0;
let idleAt = 0;

const BEST_KEY = 'astral-facets-best';

// ---------------------------------------------------------------------------
// THREE setup
const sceneEl = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
// Gentle, mostly top-down-ish tilt so rows never interleave in screen space.
camera.position.set(0, 11.2, 7.4);
camera.lookAt(0, -0.4, 0.2);

// Lights
const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x0a0a1a, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(5, 12, 6);
scene.add(key);
const rim = new THREE.PointLight(0x88aaff, 1.1, 40);
rim.position.set(-6, 5, -4);
scene.add(rim);
const featureLight = new THREE.PointLight(0xffffff, 0.0, 30);
featureLight.position.set(0, 6, 2);
scene.add(featureLight);

// Starfield skybox
let starField, skyMat;
(function buildStars() {
  const N = 1400;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 40 + Math.random() * 30;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.85 });
  starField = new THREE.Points(g, m);
  scene.add(starField);
})();

// Gradient sky dome (big inverted sphere, vertex-coloured)
const skyGeo = new THREE.SphereGeometry(70, 32, 16);
skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true });
{
  const c = skyGeo.attributes.position.count;
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c * 3), 3));
}
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// Stage / board plinth — a polished obsidian slab
const plinth = new THREE.Mesh(
  new THREE.BoxGeometry(COLS + 1.4, 0.8, ROWS + 1.4),
  new THREE.MeshStandardMaterial({ color: 0x10121f, metalness: 0.6, roughness: 0.25 }),
);
plinth.position.set(0, -1.0, 0);
scene.add(plinth);
// inset frame glow
const frame = new THREE.Mesh(
  new THREE.BoxGeometry(COLS + 0.4, 0.12, ROWS + 0.4),
  new THREE.MeshStandardMaterial({ color: 0x2a3170, emissive: 0x1a2a80, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 }),
);
frame.position.set(0, -0.55, 0);
scene.add(frame);

// Ambient dust particles
let dust;
(function buildDust() {
  const N = 220;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 18;
    pos[i * 3 + 1] = Math.random() * 8 - 1;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0x9fb8ff, size: 0.09, transparent: true, opacity: 0.5 });
  dust = new THREE.Points(g, m);
  scene.add(dust);
})();

// ---------------------------------------------------------------------------
// Gem geometry per shape (sized to fill the slot ~0.9 units radius)
function makeGeometry(shape) {
  switch (shape) {
    case 'octahedron': return new THREE.OctahedronGeometry(0.52, 0);
    case 'cube':       return new THREE.BoxGeometry(0.72, 0.72, 0.72);
    case 'prism':      return new THREE.CylinderGeometry(0.0, 0.55, 0.9, 3, 1); // triangular spike
    case 'diamond':    return new THREE.ConeGeometry(0.5, 0.95, 4, 1);          // faceted 4-sided
    case 'dodeca':     return new THREE.DodecahedronGeometry(0.5, 0);
    case 'sphere':     return new THREE.IcosahedronGeometry(0.5, 1);
  }
  return new THREE.SphereGeometry(0.5, 12, 12);
}
const GEOS = GEM_DEFS.map((d) => makeGeometry(d.shape));
const MATS = GEM_DEFS.map((d) => new THREE.MeshStandardMaterial({
  color: d.color, emissive: d.emissive, emissiveIntensity: 0.55,
  metalness: 0.35, roughness: 0.15, flatShading: true,
}));

// gem mesh grid — meshes[r][c]
let meshes = [];
function worldX(c) { return (c - OFF) * GAP; }
function worldZ(r) { return (r - OFF) * GAP; }
const GEM_Y = 0.1;

function buildGems() {
  for (const row of meshes) for (const m of row) if (m) scene.remove(m);
  meshes = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const t = board[r][c];
      const mesh = new THREE.Mesh(GEOS[t], MATS[t]);
      mesh.position.set(worldX(c), GEM_Y, worldZ(r));
      mesh.userData = { t, spin: Math.random() * Math.PI * 2, bob: Math.random() * Math.PI * 2 };
      scene.add(mesh);
      row.push(mesh);
    }
    meshes.push(row);
  }
}
function setMeshType(mesh, t) {
  mesh.geometry = GEOS[t];
  mesh.material = MATS[t];
  mesh.userData.t = t;
}

// ---------------------------------------------------------------------------
// Hit-cell DOM overlay (the ONLY data-testid="cell" elements)
const hitgrid = document.getElementById('hitgrid');
const hitCells = [];   // [r][c] -> button
function buildHitCells() {
  hitgrid.innerHTML = '';
  hitCells.length = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'hit';
      el.setAttribute('data-testid', 'cell');
      el.dataset.r = r; el.dataset.c = c;
      hitgrid.appendChild(el);
      row.push(el);
    }
    hitCells.push(row);
  }
}
// project a world point to screen (CSS px)
function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
}
function layoutHitCells() {
  // size each hit-cell to roughly cover half the gap on each side, centred on
  // the projected gem centre. Grid-ordered by construction (modest tilt).
  const c0 = projectToScreen(worldX(0), GEM_Y, worldZ(0));
  const c1 = projectToScreen(worldX(1), GEM_Y, worldZ(0));
  const cr = projectToScreen(worldX(0), GEM_Y, worldZ(1));
  const dx = Math.abs(c1.x - c0.x) || 40;
  const dyRow = Math.abs(cr.y - c0.y) || 40;
  const cellW = dx * 0.96;
  const cellH = dyRow * 0.96;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = projectToScreen(worldX(c), GEM_Y, worldZ(r));
      const el = hitCells[r][c];
      el.style.width = cellW + 'px';
      el.style.height = cellH + 'px';
      el.style.left = (p.x - cellW / 2) + 'px';
      el.style.top = (p.y - cellH / 2) + 'px';
    }
  }
}

// ---------------------------------------------------------------------------
// Resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  layoutHitCells();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Render loop
let t0 = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - t0) / 1000; t0 = now;
  const time = now / 1000;

  // idle hint scheduling
  if (!over && !busy && hint === null && (now - idleAt) > 10000 && hasValidMove(board)) {
    showHint();
  }

  // gem life: slow spin + bob + featured pulse
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = meshes[r][c];
      if (!m || m.userData.dropping) continue;
      m.rotation.y += dt * (0.35 + (m.userData.t % 3) * 0.08);
      m.position.y = GEM_Y + Math.sin(time * 1.1 + m.userData.bob) * 0.05;
    }
  }
  // hint wiggle
  if (hint) {
    const m = meshes[hint.a.r][hint.a.c];
    if (m) { m.rotation.z = Math.sin(time * 9) * 0.22; m.scale.setScalar(1 + Math.sin(time * 9) * 0.06); }
  }
  // featured colour: gentle emissive pulse + a light
  const feat = stageTheme(stage).feature;
  const pulse = 0.55 + Math.sin(time * 2.2) * 0.35;
  for (let t = 0; t < TYPES; t++) MATS[t].emissiveIntensity = (t === feat) ? pulse : 0.5;
  featureLight.intensity = 0.3 + Math.sin(time * 2.2) * 0.15;
  featureLight.color.setHex(GEM_DEFS[feat].color);

  starField.rotation.y += dt * 0.01;
  dust.rotation.y -= dt * 0.02;
  // subtle camera drift
  camera.position.x = Math.sin(time * 0.18) * 0.5;
  camera.lookAt(0, -0.4, 0.2);

  runDrops(now);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Drop animation engine (physical, accelerating). Active tweens list.
let activeDrops = [];   // {mesh, fromY?, ...} we animate positions manually
function runDrops(now) {
  for (const d of activeDrops) {
    const p = Math.min(1, (now - d.start) / d.dur);
    const e = p * p;                 // ease-in (accelerate)
    d.mesh.position.y = d.y0 + (d.y1 - d.y0) * e;
    d.mesh.position.x = d.x;
    d.mesh.position.z = d.z;
    if (p >= 1) { d.mesh.userData.dropping = false; d.done = true; }
  }
  activeDrops = activeDrops.filter((d) => !d.done);
}

// ---------------------------------------------------------------------------
// Sky/stage dressing per stage
function applyStageTheme() {
  const th = stageTheme(stage);
  const top = new THREE.Color(th.sky[0]);
  const bot = new THREE.Color(th.sky[1]);
  const colors = skyGeo.attributes.color;
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 70;         // -1..1
    const mixc = top.clone().lerp(bot, (1 - y) / 2);
    colors.setXYZ(i, mixc.r, mixc.g, mixc.b);
  }
  colors.needsUpdate = true;
  scene.fog = new THREE.Fog(th.fog, 14, 55);
  renderer.setClearColor(th.fog, 1);
  document.getElementById('stageName').textContent = th.name;
}

// ---------------------------------------------------------------------------
// UI updates
function fmt(n) { return n.toLocaleString('en-US'); }
function updateHUD() {
  document.getElementById('score').textContent = fmt(score);
  document.getElementById('best').textContent = fmt(best);
  document.getElementById('multi').textContent = '×' + mult;
  const feat = stageTheme(stage).feature;
  document.getElementById('feature').textContent = 'Featured: ' + GEM_DEFS[feat].name + ' ★';
}

// stage banner
function showBanner() {
  const b = document.getElementById('banner');
  const th = stageTheme(stage);
  b.querySelector('.b-name').textContent = th.name;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

// floating +N pop over the board centre
function showPop(gain, bonus) {
  const pops = document.getElementById('pops');
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = '+' + fmt(gain) + (bonus > 0 ? '<span class="bonus">+' + bonus + ' off-hint!</span>' : '');
  const p = projectToScreen(0, 1.5, 0);
  el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
  pops.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------------------------------------------------------------------------
// Hint
function showHint() {
  const mv = findAnyMove();
  if (!mv) return;
  hint = mv;
}
function clearHint() {
  if (hint) {
    const m = meshes[hint.a.r] && meshes[hint.a.r][hint.a.c];
    if (m) { m.rotation.z = 0; m.scale.setScalar(1); }
  }
  hint = null;
}
function findAnyMove() {
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

// ---------------------------------------------------------------------------
// New game
function newGame() {
  rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  board = createBoard(ROWS, COLS, TYPES, rng);
  score = 0; mult = 1; stage = 0; lastGain = 0; lastBonus = 0; over = false; busy = false;
  resetScoring();
  clearHint();
  document.getElementById('over').classList.remove('show');
  buildGems();
  buildHitCells();
  resize();
  applyStageTheme();
  updateHUD();
  idleAt = performance.now();
}

// ---------------------------------------------------------------------------
// Applying a move: swap logic + animated cascades + scoring
async function attemptMove(a, b, hintAtStart) {
  if (over || busy) return;
  if (!isValidSwap(board, a, b)) {
    // invalid — bounce back (visual nudge), nothing changes
    await nudge(a, b);
    idleAt = performance.now();
    return;
  }
  busy = true;
  clearHint();

  // logical swap
  board = applySwap(board, a, b);
  // animate the swap visually (swap mesh positions)
  await swapMeshes(a, b);

  // resolve cascades
  const { board: settled, steps } = collapse(board, rng, TYPES);

  let gain = 0;
  let moveLongest = 1;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    // longest run on the board that PRODUCED this wave
    const incoming = i === 0 ? board : steps[i - 1].board;
    moveLongest = Math.max(moveLongest, longestRun(incoming));

    // clear animation
    await clearWave(st.matches);

    // score this wave (uses CURRENT colour values, before bumping counts)
    const counts = countOnBoard();
    let raw = 0;
    const feat = stageTheme(stage).feature;
    let featureBonus = 0;
    for (const { r, c } of st.matches) {
      const t = board[r][c];
      raw += gemValue(t, counts);
      if (t === feat) featureBonus += 40;
    }
    // bump per-colour match counters (exp/grow)
    const typesHit = new Set(st.matches.map(({ r, c }) => board[r][c]));
    for (const t of typesHit) matchCounts[t]++;

    const cascadeFactor = i === 0 ? 1 : 2;
    gain += raw * cascadeFactor + featureBonus;

    // apply this wave's settled board to logic + animate drop
    board = st.board;
    await dropWave(st.board);
  }

  // multiplier update from the move's longest run
  mult = matchMultiplier(mult, moveLongest);
  gain = gain * mult;

  // deviation bonus: hint was showing at drag start & player deviated
  let bonus = 0;
  if (hintAtStart) {
    const same = samePair(hintAtStart, { a, b });
    if (!same) bonus = 100;
  }
  lastBonus = bonus;
  gain += bonus;

  lastGain = gain;
  score += gain;

  // stage change?
  const newStage = stageForScore(score);
  if (newStage !== stage) {
    stage = newStage;
    applyStageTheme();
    showBanner();
  }

  if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }

  showPop(gain, bonus);
  updateHUD();

  // ensure board matches settled (safety)
  board = settled;
  syncMeshesToBoard();

  busy = false;
  idleAt = performance.now();

  // game over?
  if (!hasValidMove(board)) {
    over = true;
    document.getElementById('over').classList.add('show');
  }
}

function samePair(p, q) {
  const key = (m) => {
    const arr = [m.a.r + ',' + m.a.c, m.b.r + ',' + m.b.c].sort();
    return arr.join('|');
  };
  return key(p) === key(q);
}

// ---- animations (promise-based) ----
function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function swapMeshes(a, b) {
  const ma = meshes[a.r][a.c], mb = meshes[b.r][b.c];
  const dur = 160;
  const start = performance.now();
  const pa = ma.position.clone(), pb = mb.position.clone();
  await new Promise((res) => {
    function step() {
      const p = Math.min(1, (performance.now() - start) / dur);
      const e = p * (2 - p);
      ma.position.lerpVectors(pa, pb, e);
      mb.position.lerpVectors(pb, pa, e);
      if (p < 1) requestAnimationFrame(step); else res();
    }
    step();
  });
  // swap in the mesh grid array
  meshes[a.r][a.c] = mb; meshes[b.r][b.c] = ma;
}

async function nudge(a, b) {
  const ma = meshes[a.r][a.c];
  if (!ma) return;
  const home = ma.position.clone();
  const toward = meshes[b.r] && meshes[b.r][b.c] ? meshes[b.r][b.c].position.clone() : home;
  const dur = 220, start = performance.now();
  await new Promise((res) => {
    function step() {
      const p = Math.min(1, (performance.now() - start) / dur);
      const s = Math.sin(p * Math.PI) * 0.35;
      ma.position.lerpVectors(home, toward, s);
      if (p < 1) requestAnimationFrame(step); else { ma.position.copy(home); res(); }
    }
    step();
  });
}

async function clearWave(matches) {
  const set = matches.map(({ r, c }) => meshes[r][c]).filter(Boolean);
  const dur = 220, start = performance.now();
  await new Promise((res) => {
    function step() {
      const p = Math.min(1, (performance.now() - start) / dur);
      for (const m of set) {
        m.scale.setScalar(1 + p * 0.6);
        m.material = m.material; // keep
        m.rotation.y += 0.3;
        if (m.material.emissiveIntensity !== undefined) m.material.emissiveIntensity = 0.5 + p;
      }
      if (p < 1) requestAnimationFrame(step); else res();
    }
    step();
  });
  for (const m of set) m.scale.setScalar(1);
}

// After a wave's settled board is known, rebuild the mesh grid to match it,
// animating gems falling from above into place (accelerating).
async function dropWave(newBoard) {
  // Remove all current meshes; build fresh set matching newBoard, animate fall.
  for (const row of meshes) for (const m of row) if (m) scene.remove(m);
  const fresh = [];
  const drops = [];
  const dropStart = performance.now();
  let maxDur = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const t = newBoard[r][c];
      const mesh = new THREE.Mesh(GEOS[t], MATS[t]);
      mesh.userData = { t, spin: Math.random() * 6.28, bob: Math.random() * 6.28, dropping: true };
      const targetY = GEM_Y;
      const fallFrom = GEM_Y + (ROWS - r) * GAP + 3;   // start above
      mesh.position.set(worldX(c), fallFrom, worldZ(r));
      scene.add(mesh);
      const dist = fallFrom - targetY;
      const dur = 180 + Math.sqrt(dist) * 90;
      maxDur = Math.max(maxDur, dur);
      drops.push({ mesh, x: worldX(c), z: worldZ(r), y0: fallFrom, y1: targetY, start: dropStart, dur });
      row.push(mesh);
    }
    fresh.push(row);
  }
  meshes = fresh;
  activeDrops.push(...drops);
  await wait(maxDur + 30);
}

function syncMeshesToBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = meshes[r][c];
      if (!m) continue;
      if (m.userData.t !== board[r][c]) setMeshType(m, board[r][c]);
      m.position.set(worldX(c), GEM_Y, worldZ(r));
      m.userData.dropping = false;
      m.scale.setScalar(1); m.rotation.z = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Pointer drag gesture — tracked on document, decided by RELEASE position.
let drag = null;   // {r, c, startX, startY, hintSnapshot}
function cellSizePx() {
  const b0 = hitCells[0][0].getBoundingClientRect();
  return { w: b0.width, h: b0.height };
}
function onPointerDown(e) {
  if (over || busy) return;
  const el = e.target.closest('.hit');
  if (!el) return;
  const r = +el.dataset.r, c = +el.dataset.c;
  drag = { r, c, startX: e.clientX, startY: e.clientY, hintSnapshot: hint ? { a: { ...hint.a }, b: { ...hint.b } } : null };
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}
function onPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const { w, h } = cellSizePx();
  const thresh = Math.min(w, h) * 0.4;
  if (Math.abs(dx) < thresh && Math.abs(dy) < thresh) {
    // released on origin — cancel, no move
    idleAt = performance.now();
    return;
  }
  // decide direction by dominant axis of NET displacement at release
  let dr = 0, dc = 0;
  if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;
  const nr = d.r + dr, nc = d.c + dc;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) { idleAt = performance.now(); return; }
  attemptMove({ r: d.r, c: d.c }, { r: nr, c: nc }, d.hintSnapshot);
}
document.addEventListener('pointerdown', onPointerDown);
document.addEventListener('pointerup', onPointerUp);
document.addEventListener('pointercancel', () => { drag = null; });

// New game buttons
document.getElementById('newgame').addEventListener('click', newGame);
document.getElementById('over-new').addEventListener('click', newGame);

// ---------------------------------------------------------------------------
// __test observation hooks
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => mult,
  gemValues: () => currentGemValues(),
  stage: () => stage,
  featuredType: () => stageTheme(stage).feature,
  bestScore: () => best,
  validMove: () => findAnyMove(),
  board: () => board.map((row) => row.slice()),
  gameOver: () => over,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
  // convenience only — NOT how the gate drives moves
  slide: async (r, c, dir) => {
    const map = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
    const [dr, dc] = map[dir] || [0, 0];
    await attemptMove({ r, c }, { r: r + dr, c: c + dc }, hint ? { a: { ...hint.a }, b: { ...hint.b } } : null);
  },
};

// ---------------------------------------------------------------------------
// Boot
best = (() => { try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (_) { return 0; } })();
newGame();
resize();
animate();
