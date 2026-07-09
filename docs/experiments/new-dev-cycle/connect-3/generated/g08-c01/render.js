// render.js — 3D match-3 world using vendored three.js.
// Theme: "Celestial Vault" — floating gemstone altar under a rotating starfield,
// re-dressed per stage (Nebula, Aurora, Ember, Frost, Void...).
import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap,
  collapse, longestRun, matchMultiplier, stageForScore,
} from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const CELL = 1.0;           // world units per grid step
const GAP = 0.06;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

// ---------------------------------------------------------------------------
// Scoring model (UI-owned). Six colours, each scaling differently.
// ---------------------------------------------------------------------------
// value schemes: index = gem type
//  0 exponential (cheap, doubles each match)
//  1 flat (expensive, never scales)
//  2 grows-per-match (linear growth)
//  3 rarity (worth more the rarer on board)
//  4 exponential-slow (triples occasionally) -> we use *1.5 growth
//  5 flat-mid
const GEM_NAMES = ['Amethyst', 'Topaz', 'Emerald', 'Ruby', 'Sapphire', 'Opal'];

function initScoring() {
  return {
    expVal: 5,        // type 0
    flatVal: 50,      // type 1
    growVal: 10,      // type 2
    grow2Val: 8,      // type 4
  };
}

// current per-gem value of each colour (for gemValues hook & scoring)
function gemValueOf(type, sc, board) {
  switch (type) {
    case 0: return sc.expVal;
    case 1: return sc.flatVal;
    case 2: return sc.growVal;
    case 3: { // rarity: 200 / (count+1)
      let cnt = 0;
      for (const row of board) for (const v of row) if (v === 3) cnt++;
      return Math.round(300 / (cnt + 1)) + 10;
    }
    case 4: return sc.grow2Val;
    case 5: return 30;
    default: return 10;
  }
}

function allGemValues(sc, board) {
  return [0, 1, 2, 3, 4, 5].map((t) => gemValueOf(t, sc, board));
}

// mutate stateful values after a wave clears `count` of `type`
function bumpAfterMatch(type, sc, count) {
  if (type === 0) sc.expVal = Math.min(sc.expVal * 2, 100000);
  else if (type === 2) sc.growVal += 5 * count;
  else if (type === 4) sc.grow2Val = Math.round(sc.grow2Val * 1.5);
}

// ---------------------------------------------------------------------------
// Stage themes
// ---------------------------------------------------------------------------
const STAGES = [
  { name: 'Nebula',  sky: [0x1a0b2e, 0x3d1a5b], fog: 0x1a0b2e, key: 0xff9de2, rim: 0x6ad3ff, ground: 0x2a1550, star: 0xffd6ff, featured: null },
  { name: 'Aurora',  sky: [0x021b1a, 0x0a3d4a], fog: 0x021b1a, key: 0x7dffcf, rim: 0x8ab6ff, ground: 0x073b3a, star: 0xc9ffe8, featured: 4 },
  { name: 'Ember',   sky: [0x2a0a05, 0x5b1a0a], fog: 0x2a0a05, key: 0xffb066, rim: 0xff5a2c, ground: 0x3a1205, star: 0xffd9a8, featured: 3 },
  { name: 'Frost',   sky: [0x081826, 0x1e4a6b], fog: 0x0a1c2b, key: 0xbfe8ff, rim: 0x8fd0ff, ground: 0x123048, star: 0xeaffff, featured: 5 },
  { name: 'Verdant', sky: [0x07200a, 0x1c5b1f], fog: 0x07200a, key: 0xb6ff8a, rim: 0x6ad36a, ground: 0x123a12, star: 0xdfffca, featured: 2 },
  { name: 'Void',    sky: [0x050510, 0x1a1a3a], fog: 0x050510, key: 0xb0a8ff, rim: 0x9d7dff, ground: 0x14142e, star: 0xd8d0ff, featured: 0 },
];
function stageTheme(idx) { return STAGES[idx % STAGES.length]; }

// gem base colours
const GEM_COLORS = [0xb266ff, 0xffd24a, 0x36e07a, 0xff4d6d, 0x4d8bff, 0xf2e9d8];

// ===========================================================================
// three.js scene
// ===========================================================================
let renderer, scene, camera;
const container = document.getElementById('scene');

const gemGroup = new THREE.Group();     // holds all gem meshes
let starfield, groundMesh, hemi, keyLight, rimLight;

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.add(gemGroup);

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  // Head-on-ish on a vertical board, slightly raised for depth; rows never interleave.
  camera.position.set(0, 1.2, 12.6);
  camera.lookAt(0, 0, 0);

  hemi = new THREE.HemisphereLight(0xffffff, 0x223044, 0.55);
  scene.add(hemi);

  keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(6, 14, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 50;
  keyLight.shadow.camera.left = -8;
  keyLight.shadow.camera.right = 8;
  keyLight.shadow.camera.top = 8;
  keyLight.shadow.camera.bottom = -8;
  scene.add(keyLight);

  rimLight = new THREE.PointLight(0x6ad3ff, 1.2, 60);
  rimLight.position.set(-7, 6, -6);
  scene.add(rimLight);

  // back wall of the vault (behind the vertical board) — the world's depth cue
  const gGeo = new THREE.BoxGeometry(BOARD_W + 5, BOARD_H + 5, 0.6);
  const gMat = new THREE.MeshStandardMaterial({ color: 0x2a1550, roughness: 0.6, metalness: 0.35 });
  groundMesh = new THREE.Mesh(gGeo, gMat);
  groundMesh.position.set(0, 0, -1.6);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // recessed board frame just behind the gems
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x120a24, roughness: 0.85, metalness: 0.2 });
  const inset = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.6, BOARD_H + 0.6, 0.4), frameMat);
  inset.position.set(0, 0, -0.55);
  inset.receiveShadow = true;
  scene.add(inset);

  // a stone ledge/floor beneath the board for grounding
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W + 6, 0.8, 4),
    new THREE.MeshStandardMaterial({ color: 0x1a0f30, roughness: 0.9, metalness: 0.1 }),
  );
  floor.position.set(0, -(BOARD_H / 2) - 0.9, 0.2);
  floor.receiveShadow = true;
  scene.add(floor);

  // starfield
  const starGeo = new THREE.BufferGeometry();
  const N = 1400;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 40 + Math.random() * 50;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.6 + 4;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffd6ff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  starfield = new THREE.Points(starGeo, starMat);
  scene.add(starfield);

  scene.fog = new THREE.FogExp2(0x1a0b2e, 0.012);
}

// --- gem geometries: distinct silhouette per type (colour-blind safe) -------
function gemGeometry(type) {
  switch (type) {
    case 0: return new THREE.OctahedronGeometry(0.42, 0);          // diamond/octahedron
    case 1: return new THREE.BoxGeometry(0.62, 0.62, 0.62);        // cube
    case 2: return new THREE.IcosahedronGeometry(0.44, 0);         // faceted ball
    case 3: return new THREE.TetrahedronGeometry(0.5, 0);          // pyramid
    case 4: return new THREE.CylinderGeometry(0.34, 0.34, 0.6, 6); // hex prism
    case 5: return new THREE.TorusGeometry(0.3, 0.15, 12, 24);     // ring
    default: return new THREE.OctahedronGeometry(0.42, 0);
  }
}

function gemMaterial(type) {
  return new THREE.MeshStandardMaterial({
    color: GEM_COLORS[type],
    roughness: 0.15,
    metalness: 0.45,
    emissive: new THREE.Color(GEM_COLORS[type]).multiplyScalar(0.12),
    flatShading: type !== 2 && type !== 5,
  });
}

// grid (r,c) -> world x,y on a vertical board. row 0 at TOP (high y), gravity = -y.
function cellToWorld(r, c) {
  const x = (c - (COLS - 1) / 2) * CELL;
  const y = ((ROWS - 1) / 2 - r) * CELL;
  return { x, y };
}
const TOP_Y = ((ROWS - 1) / 2) * CELL;

// ===========================================================================
// Game state
// ===========================================================================
let rng = Math.random;
let board;
let meshes = [];      // meshes[r][c] = THREE.Mesh (or null during animation)
let score = 0, lastGain = 0, lastBonus = 0, multiplier = 1;
let scoring = initScoring();
let over = false;
let animating = false;
let currentHint = null;    // {a,b}
let hintTimer = null;
let bestScore = Number(localStorage.getItem('cv_best') || '0') || 0;

function makeGemMesh(type, r, c) {
  const mesh = new THREE.Mesh(gemGeometry(type), gemMaterial(type));
  const { x, y } = cellToWorld(r, c);
  mesh.position.set(x, y, 0);
  mesh.castShadow = true;
  mesh.userData = { type, restY: y, spin: (Math.random() - 0.5) * 0.6, bob: Math.random() * Math.PI * 2 };
  mesh.rotation.y = Math.random() * Math.PI;
  return mesh;
}

function rebuildMeshes() {
  for (const row of meshes) for (const m of row) if (m) gemGroup.remove(m);
  meshes = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const m = makeGemMesh(board[r][c], r, c);
      gemGroup.add(m);
      row.push(m);
    }
    meshes.push(row);
  }
}

// ===========================================================================
// DOM hit-cells overlay
// ===========================================================================
const hitLayer = document.getElementById('hitlayer');
let hitCells = [];  // hitCells[r][c] = div

function buildHitCells() {
  hitLayer.innerHTML = '';
  hitCells = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const d = document.createElement('div');
      d.className = 'hitcell';
      d.setAttribute('data-testid', 'cell');
      d.dataset.r = r; d.dataset.c = c;
      hitLayer.appendChild(d);
      row.push(d);
    }
    hitCells.push(row);
  }
}

// project a world point to screen pixel coords within container
function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
  };
}

// position hit-cells over projected gem centres; size ~ one cell projected
function layoutHitCells() {
  if (!hitCells.length) return;
  // estimate cell pixel size from two adjacent projected centres
  const p00 = projectToScreen(...worldXYZ(0, 0));
  const p01 = projectToScreen(...worldXYZ(0, 1));
  const p10 = projectToScreen(...worldXYZ(1, 0));
  const wCell = Math.abs(p01.x - p00.x) || 40;
  const hCell = Math.abs(p10.y - p00.y) || 40;
  lastCellPx = { w: wCell, h: hCell };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = projectToScreen(...worldXYZ(r, c));
      const d = hitCells[r][c];
      d.style.width = wCell + 'px';
      d.style.height = hCell + 'px';
      d.style.left = (p.x - wCell / 2) + 'px';
      d.style.top = (p.y - hCell / 2) + 'px';
    }
  }
}
function worldXYZ(r, c) { const { x, y } = cellToWorld(r, c); return [x, y, 0]; }

// ===========================================================================
// Stage / theme application
// ===========================================================================
let currentStage = -1;
function applyStage(idx) {
  if (idx === currentStage) return;
  currentStage = idx;
  const t = stageTheme(idx);
  scene.fog.color.setHex(t.fog);
  keyLight.color.setHex(t.key);
  rimLight.color.setHex(t.rim);
  groundMesh.material.color.setHex(t.ground);
  starfield.material.color.setHex(t.star);
  // vertical gradient sky via scene.background canvas
  scene.background = makeSkyTexture(t.sky[0], t.sky[1]);
  document.getElementById('stage-name').textContent = t.name;
  const feat = t.featured;
  document.getElementById('featured').textContent =
    feat == null ? 'none' : GEM_NAMES[feat];
}

function makeSkyTexture(top, bottom) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function featuredType() { return stageTheme(stageForScore(score)).featured; }

// ===========================================================================
// Animation helpers
// ===========================================================================
function delay(ms) { return new Promise((res) => setTimeout(res, ms)); }

// animate clearing meshes (throb + fade) then remove
function animateClear(cells) {
  return new Promise((resolve) => {
    const items = cells.map(({ r, c }) => meshes[r][c]).filter(Boolean);
    const dur = 260;
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / dur, 1);
      for (const m of items) {
        const s = 1 + 0.5 * Math.sin(t * Math.PI) - t * 0.9;
        m.scale.setScalar(Math.max(0.001, s));
        m.material.emissiveIntensity = 1;
        if (m.material.emissive) m.material.emissive.setScalar(0.6 * (1 - t) + 0.12);
        m.rotation.y += 0.4;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        for (const m of items) gemGroup.remove(m);
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// After a logical wave, sync meshes to the new board with an accelerating drop.
// prevBoard: board before this wave's clear/drop (meshes already cleared for matched).
// nextBoard: board after drop+refill.
function animateDrop(nextBoard) {
  return new Promise((resolve) => {
    // Build target mesh grid: reuse existing meshes where a column's survivors
    // fall; create new meshes (dropping from above) for refills.
    // Simplest robust approach: rebuild meshes from nextBoard, animating each
    // from an above-start Y to its resting Y.
    const newMeshes = [];
    const anims = [];
    // Track which existing meshes we can reuse per column by matching type from bottom.
    for (let r = 0; r < ROWS; r++) newMeshes.push(new Array(COLS).fill(null));

    let spawnAbove = 0; // stack new refills above the top so they cascade in
    for (let c = 0; c < COLS; c++) {
      // gather surviving meshes in this column (bottom-up = high r first), skip removed
      const survivors = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (meshes[r][c] && meshes[r][c].parent) survivors.push(meshes[r][c]);
      }
      let si = 0;
      let refillCount = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        const type = nextBoard[r][c];
        const { x, y } = cellToWorld(r, c);
        let mesh;
        let startY;
        if (si < survivors.length) {
          mesh = survivors[si++];
          startY = mesh.position.y; // its old resting Y — will fall to new lower Y
          if (mesh.userData.type !== type) {
            gemGroup.remove(mesh);
            mesh = makeGemMesh(type, r, c);
            gemGroup.add(mesh);
            startY = TOP_Y + 2 + refillCount++;
          }
        } else {
          mesh = makeGemMesh(type, r, c);
          gemGroup.add(mesh);
          startY = TOP_Y + 2 + refillCount++;
        }
        mesh.userData.restY = y;
        mesh.position.x = x; mesh.position.z = 0; mesh.position.y = startY;
        newMeshes[r][c] = mesh;
        anims.push({ mesh, fromY: startY, toY: y, dist: Math.abs(startY - y) });
      }
    }
    meshes = newMeshes;

    const maxDist = Math.max(1, ...anims.map((a) => a.dist));
    const baseDur = 520;
    const start = performance.now();
    function step(now) {
      const gt = (now - start);
      let done = true;
      for (const a of anims) {
        if (a.dist < 0.001) { a.mesh.position.y = a.toY; continue; }
        const dur = baseDur * Math.sqrt(a.dist / maxDist) + 120;
        const t = Math.min(gt / dur, 1);
        const e = t * t; // accelerating (ease-in) — gravity feel
        a.mesh.position.y = a.fromY + (a.toY - a.fromY) * e;
        if (t < 1) done = false;
      }
      if (!done) requestAnimationFrame(step);
      else { for (const a of anims) a.mesh.position.y = a.toY; resolve(); }
    }
    requestAnimationFrame(step);
  });
}

// ===========================================================================
// Move handling & scoring
// ===========================================================================
function scoreWave(matches, waveBoardBefore, cascadeFactor) {
  // count per type from matches on waveBoardBefore
  const counts = {};
  for (const { r, c } of matches) {
    const type = waveBoardBefore[r][c];
    counts[type] = (counts[type] || 0) + 1;
  }
  let raw = 0;
  const feat = stageTheme(stageForScore(score)).featured;
  let featBonus = 0;
  for (const t in counts) {
    const type = Number(t);
    const cnt = counts[t];
    const val = gemValueOf(type, scoring, waveBoardBefore);
    raw += val * cnt;
    if (feat != null && type === feat) featBonus += 25 * cnt;
  }
  // mutate stateful values AFTER computing this wave
  for (const t in counts) bumpAfterMatch(Number(t), scoring, counts[t]);
  return { raw: raw * cascadeFactor, featBonus };
}

async function performMove(a, b) {
  if (animating || over) return false;
  if (!isValidSwap(board, a, b)) {
    // reject: little shake handled by caller visuals; nothing changes
    return false;
  }
  animating = true;

  // snapshot hint for deviation bonus BEFORE clearing it
  const hintAtStart = currentHint;
  clearHint();

  // apply swap logically & visually (swap the two meshes' positions)
  const swapped = applySwap(board, a, b);
  await animateSwapVisual(a, b);
  board = swapped;

  const { steps } = collapse(board, rng, TYPES);
  // longest run across all incoming wave boards to measure tier
  let maxRun = 0;
  let waveInput = board;
  for (const s of steps) {
    maxRun = Math.max(maxRun, longestRun(waveInput));
    waveInput = s.board;
  }
  const prevMult = multiplier;
  multiplier = matchMultiplier(prevMult, maxRun);

  // score cascades: wave 0 face value, waves 1+ doubled
  let gain = 0, totalFeat = 0;
  let curBoard = board;
  for (let i = 0; i < steps.length; i++) {
    const cascadeFactor = i === 0 ? 1 : 2;
    const { raw, featBonus } = scoreWave(steps[i].matches, curBoard, cascadeFactor);
    gain += raw;
    totalFeat += featBonus;
    curBoard = steps[i].board;
  }
  gain = Math.round(gain * multiplier) + totalFeat;

  // deviation bonus
  let bonus = 0;
  if (hintAtStart) {
    const same = samePair(hintAtStart, { a, b });
    if (!same) bonus = 100;
  }
  lastBonus = bonus;
  gain += bonus;
  lastGain = gain;

  // Animate the waves
  let animBoard = board;
  for (let i = 0; i < steps.length; i++) {
    await animateClear(steps[i].matches);
    await animateDrop(steps[i].board);
    board = steps[i].board;
    animBoard = steps[i].board;
  }
  board = steps.length ? steps[steps.length - 1].board : board;

  score += gain;
  if (score > bestScore) { bestScore = score; localStorage.setItem('cv_best', String(bestScore)); }
  applyStage(stageForScore(score));
  showGainPopup(gain, bonus);
  updateHUD();

  animating = false;

  if (!hasValidMove(board)) {
    setGameOver(true);
  } else {
    restartIdleClock();
  }
  return true;
}

function samePair(p, q) {
  const key = (x) => {
    const a = `${x.a.r},${x.a.c}`, b = `${x.b.r},${x.b.c}`;
    return a < b ? a + '|' + b : b + '|' + a;
  };
  return key(p) === key(q);
}

// animate swapping two adjacent gems' positions (and swap in meshes[][])
function animateSwapVisual(a, b) {
  return new Promise((resolve) => {
    const ma = meshes[a.r][a.c], mb = meshes[b.r][b.c];
    if (!ma || !mb) { resolve(); return; }
    const pa = ma.position.clone(), pb = mb.position.clone();
    const dur = 180, start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / dur, 1);
      const e = t * t * (3 - 2 * t);
      ma.position.lerpVectors(pa, pb, e);
      mb.position.lerpVectors(pb, pa, e);
      if (t < 1) requestAnimationFrame(step);
      else {
        ma.position.copy(pb); mb.position.copy(pa);
        meshes[a.r][a.c] = mb; meshes[b.r][b.c] = ma;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// ===========================================================================
// Gain popup
// ===========================================================================
function showGainPopup(gain, bonus) {
  const el = document.getElementById('gainpop');
  el.innerHTML = `+${gain.toLocaleString()}` +
    (bonus > 0 ? `<span class="bonus">+${bonus} bold move!</span>` : '');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ===========================================================================
// HUD
// ===========================================================================
function updateHUD() {
  document.getElementById('score').textContent = score.toLocaleString();
  document.getElementById('best').textContent = bestScore.toLocaleString();
  document.getElementById('mult').textContent = '×' + multiplier;
  document.getElementById('lastgain').textContent = lastGain.toLocaleString();
}

function setGameOver(v) {
  over = v;
  document.getElementById('gameover').style.display = v ? 'flex' : 'none';
  if (v) clearHint();
}

// ===========================================================================
// Hint / idle
// ===========================================================================
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

function restartIdleClock() {
  clearHint();
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (animating || over) return;
    const mv = findAnyMove();
    if (mv) showHint(mv);
  }, 10000);
}

let hintPulse = null;
function showHint(mv) {
  currentHint = mv;
  hintPulse = mv;
}
function clearHint() {
  currentHint = null;
  hintPulse = null;
  if (meshes.length) {
    // reset scales possibly touched
  }
}

// ===========================================================================
// Pointer / slide gesture (document-level, decided by release position)
// ===========================================================================
let drag = null; // {r,c, startX, startY}
let lastCellPx = { w: 40, h: 40 };
const THRESH = 0.4; // fraction of a (projected) cell size to count as a slide

function cellPixelSize() {
  return { w: lastCellPx.w, h: lastCellPx.h };
}

function onPointerDown(e) {
  if (animating || over) return;
  const target = e.target.closest('[data-testid="cell"]');
  if (!target || !hitLayer.contains(target)) return;
  const r = Number(target.dataset.r), c = Number(target.dataset.c);
  drag = { r, c, startX: e.clientX, startY: e.clientY };
  try { target.setPointerCapture && target.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const { w, h } = cellPixelSize();
  const nx = dx / w, ny = dy / h;
  const mag = Math.max(Math.abs(nx), Math.abs(ny));
  if (mag < THRESH) return; // released on origin -> cancel, no move
  let dir;
  if (Math.abs(nx) >= Math.abs(ny)) dir = nx > 0 ? [0, 1] : [0, -1];
  else dir = ny > 0 ? [1, 0] : [-1, 0]; // screen down = +row (toward camera)
  const nr = d.r + dir[0], nc = d.c + dir[1];
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return; // off board
  performMove({ r: d.r, c: d.c }, { r: nr, c: nc });
}

// ===========================================================================
// New game
// ===========================================================================
function newGame() {
  board = createBoard(ROWS, COLS, TYPES, rng);
  score = 0; lastGain = 0; lastBonus = 0; multiplier = 1;
  scoring = initScoring();
  over = false;
  setGameOver(false);
  rebuildMeshes();
  applyStage(0);
  currentStage = -1; applyStage(0);
  updateHUD();
  restartIdleClock();
}

// ===========================================================================
// Render loop
// ===========================================================================
function resize() {
  const rect = container.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  layoutHitCells();
}

let clock = 0;
function tick() {
  clock += 0.016;
  // idle spin & bob of gems (paused during move animations so we don't fight them)
  if (!animating) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = meshes[r][c];
        if (!m) continue;
        m.rotation.y += 0.004 + m.userData.spin * 0.003;
        m.position.y = m.userData.restY + Math.sin(clock + m.userData.bob) * 0.035;
        m.scale.setScalar(1);
      }
    }
  }
  if (!animating && hintPulse) {
    const p = 1 + Math.sin(clock * 6) * 0.12;
    const ma = meshes[hintPulse.a.r]?.[hintPulse.a.c];
    const mb = meshes[hintPulse.b.r]?.[hintPulse.b.c];
    if (ma) ma.scale.setScalar(p);
    if (mb) mb.scale.setScalar(p);
  }
  // slow starfield drift (camera stays fixed so the hit-grid never shifts)
  starfield.rotation.y += 0.0004;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ===========================================================================
// Boot
// ===========================================================================
buildRenderer();
buildHitCells();
newGame();
resize();
window.addEventListener('resize', resize);
document.addEventListener('pointerdown', onPointerDown);
document.addEventListener('pointerup', onPointerUp);
document.getElementById('new-game').addEventListener('click', newGame);
requestAnimationFrame(tick);

// ===========================================================================
// Test hooks
// ===========================================================================
window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => multiplier,
  gemValues: () => allGemValues(scoring, board),
  stage: () => stageForScore(score),
  featuredType: () => featuredType(),
  bestScore: () => Number(localStorage.getItem('cv_best') || '0') || 0,
  validMove: () => findAnyMove(),
  board: () => board.map((row) => row.slice()),
  gameOver: () => over,
  hint: () => currentHint,
  slide: async (r, c, dir) => {
    const map = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const d = map[dir];
    if (!d) return false;
    return performMove({ r, c }, { r: r + d[0], c: c + d[1] });
  },
};
