// render.js — Sunmeadow: a bright, sunlit-meadow match-3 played in a real 3D
// scene (three.js, vendored). Logic lives in game.js; this file renders,
// animates, scores and wires the interaction + __test observation hooks.
//
// Falls back to a DOM-projected board (same camera math, CSS gem sprites) when
// a WebGL context cannot be created, so the game stays playable headless.

import * as G from './game.js';
import * as THREE from './three.module.js';

/* ---------------------------------------------------------------- constants */

const ROWS = 8, COLS = 8, TYPES = 6;
const CELL = 1.14;
const FEATURED_MULT = 3;
const DEVIATION_BONUS = 100;
const BEST_KEY = 'sunmeadow-g10c02-best';
const DEF_POLAR = 1.28;           // radians from +Y: a gentle look-down tilt
const PEEK_N = 6;

const COLOURS = [0xff5a5f, 0xff9f1c, 0xffd23f, 0x2ec46f, 0x3aa7ff, 0xe86af0];
const CSS_COLOURS = ['#e0353b', '#d97e00', '#b8950a', '#178a4c', '#1272c4', '#b63cbf'];
const NAMES = ['Sunstone', 'Honeygem', 'Citrine', 'Clover', 'Skydrop', 'Rosebloom'];
const GLYPHS = ['◆', '⬢', '◼', '⬟', '▲', '◎'];
// value rules (candidate-designed, per contract):
// 0 cheap but exponential · 1 expensive flat · 2 grows each match ·
// 3 rarer-is-worth-more · 4 stage-scaled · 5 steady flat
const VALUE_NOTES = ['doubles each match', 'flat 50', '+6 per match', 'rarer = richer', 'grows per stage', 'flat 25'];

const THEMES = [
  { name: 'Morning Meadow', featured: 3, skyTop: 0x8fd7ff, skyBot: 0xeafff2, ground: 0x74cd7c, plat: 0xf6e7c6, sun: 0xfff2cc, cssTop: '#8fd7ff', cssBot: '#eafff2' },
  { name: 'High Noon',      featured: 4, skyTop: 0x55bdff, skyBot: 0xd9f4ff, ground: 0x5cc465, plat: 0xfdf3d0, sun: 0xffffff, cssTop: '#55bdff', cssBot: '#d9f4ff' },
  { name: 'Golden Hour',    featured: 1, skyTop: 0xffc26b, skyBot: 0xfff0d2, ground: 0xa4c964, plat: 0xffe9bd, sun: 0xffd98a, cssTop: '#ffc26b', cssBot: '#fff0d2' },
  { name: 'Blossom Drift',  featured: 5, skyTop: 0xffb9dd, skyBot: 0xfff2f8, ground: 0x8ad49b, plat: 0xffe4ef, sun: 0xfff0f4, cssTop: '#ffb9dd', cssBot: '#fff2f8' },
  { name: 'Rainbow Rise',   featured: 2, skyTop: 0x8fe3ff, skyBot: 0xf1fff6, ground: 0x6fcf85, plat: 0xe8f7ff, sun: 0xfffbe0, cssTop: '#8fe3ff', cssBot: '#f1fff6' },
  { name: 'Sunberry Fields', featured: 0, skyTop: 0xffb49e, skyBot: 0xfff3e2, ground: 0x84cd76, plat: 0xffe3c8, sun: 0xffe2b0, cssTop: '#ffb49e', cssBot: '#fff3e2' },
];

/* --------------------------------------------------------------------- rng */

function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = () => a;
  return rng;
}
const rng = makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
const cloneRng = () => makeRng(rng.state());

/* ------------------------------------------------------------- game state */

let board = G.createBoard(ROWS, COLS, TYPES, rng);
let score = 0, lastGain = 0, lastBonus = 0, multiplier = 1, stage = 0;
let favoured = null, gameOver = false, hint = null, animating = false;
let matchCounts = new Array(TYPES).fill(0);
let peek = G.refillQueue(cloneRng(), TYPES, null, PEEK_N);
let epoch = 0; // bumped by New Game so in-flight move animations abort cleanly

let best = 0;
try { best = Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { /* storage unavailable */ }

const theme = () => THEMES[stage % THEMES.length];
const featuredType = () => theme().featured;

function countOnBoard(b, t) {
  let n = 0;
  for (const row of b) for (const v of row) if (v === t) n++;
  return n;
}

// Current per-gem value of a colour (base value; featured boost shown apart).
function valueOf(t, forBoard) {
  switch (t) {
    case 0: return Math.min(5 * 2 ** matchCounts[0], 1280);
    case 1: return 50;
    case 2: return 12 + 6 * matchCounts[2];
    case 3: {
      const n = countOnBoard(forBoard || board, 3);
      return n <= 0 ? 480 : Math.max(15, Math.min(480, Math.round(480 / n)));
    }
    case 4: return 10 * (stage + 1);
    case 5: return 25;
    default: return 1;
  }
}

function firstValidMove(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && G.isValidSwap(b, { r, c }, { r, c: c + 1 })) return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < ROWS && G.isValidSwap(b, { r, c }, { r: r + 1, c })) return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}

const samePair = (p, q) =>
  p && q && ((p.a.r === q.a.r && p.a.c === q.a.c && p.b.r === q.b.r && p.b.c === q.b.c) ||
             (p.a.r === q.b.r && p.a.c === q.b.c && p.b.r === q.a.r && p.b.c === q.a.c));

/* ------------------------------------------------------------ DOM handles */

const $ = (id) => document.getElementById(id);
const stageEl = $('stage'), cellsEl = $('cells'), fxEl = $('fx');
const domSceneEl = $('domScene'), domGemsEl = $('domGems'), domBoardEl = $('domBoard');
const scoreEl = $('score'), bestEl = $('best'), stageNameEl = $('stageName');
const hudEl = $('hud'), hudToggleEl = $('hud-toggle'), newGameEl = $('new-game');
const hotchipEl = $('hotchip'), multchipEl = $('multchip'), luckychipEl = $('luckychip');
const ledgerEl = $('ledger'), peekEl = $('peek'), gameoverEl = $('gameover');

/* ------------------------------------------------------------- 3D scene */

let webgl = true;
let renderer = null;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
  if (!renderer.getContext()) throw new Error('no context');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
} catch {
  webgl = false;
  renderer = null;
  $('gl').hidden = true;
  domSceneEl.hidden = false;
  domGemsEl.hidden = false;
}

const cellWorld = (r, c) => new THREE.Vector3((c - (COLS - 1) / 2) * CELL, ((ROWS - 1) / 2 - r) * CELL, 0);

let skyMat = null, groundMesh = null, platMesh = null, hemiLight = null, dirLight = null, sunSprite = null;
let pollen = null, clouds = [];
const gemGroup = new THREE.Group();

function buildEnvironment() {
  scene.add(gemGroup);

  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x8fd7ff) }, bot: { value: new THREE.Color(0xeafff2) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot;' +
      'void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);' +
      'gl_FragColor = vec4(mix(bot, top, smoothstep(0.08, 0.85, h)), 1.0); }',
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), skyMat));
  scene.fog = new THREE.Fog(0xdff4ff, 70, 200);

  hemiLight = new THREE.HemisphereLight(0xbfe8ff, 0x88c37a, 0.95);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0xfff2d0, 2.5);
  dirLight.position.set(10, 16, 12);
  scene.add(dirLight);
  const fill = new THREE.DirectionalLight(0xcfe9ff, 0.7);
  fill.position.set(-8, 4, 10);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  groundMesh = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    new THREE.MeshLambertMaterial({ color: 0x74cd7c }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -6.6;
  scene.add(groundMesh);

  // rolling hills
  for (const [x, z, rr, col] of [[-38, -60, 26, 0x86d98d], [30, -70, 32, 0x79cf82], [0, -95, 44, 0x8fdd96]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rr, 20, 14), new THREE.MeshLambertMaterial({ color: col }));
    hill.scale.set(1, 0.32, 1);
    hill.position.set(x, -6.6, z);
    scene.add(hill);
  }

  // scattered meadow flowers (coloured points on the ground)
  {
    const n = 260, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 90;
      pos[i * 3] = Math.cos(a) * d;
      pos[i * 3 + 1] = -6.35;
      pos[i * 3 + 2] = Math.sin(a) * d - 18;
      tmp.setHex(COLOURS[i % TYPES]).offsetHSL(0, 0, 0.12);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, sizeAttenuation: true })));
  }

  // soft clouds
  for (let i = 0; i < 5; i++) {
    const cloud = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdde9f2, emissiveIntensity: 0.35 });
    for (let j = 0; j < 3 + (i % 2); j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 2.4, 10, 8), mat);
      puff.position.set(j * 3.4 - 4, Math.random() * 1.2, Math.random() * 1.5);
      puff.scale.y = 0.62;
      cloud.add(puff);
    }
    cloud.position.set(-70 + i * 32, 16 + (i % 3) * 5, -70 - (i % 2) * 20);
    cloud.userData.speed = 0.5 + Math.random() * 0.6;
    clouds.push(cloud);
    scene.add(cloud);
  }

  // sun glow sprite
  {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.4, 'rgba(255,232,150,0.85)');
    grad.addColorStop(1, 'rgba(255,232,150,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    sunSprite.scale.setScalar(46);
    sunSprite.position.set(55, 60, -160);
    scene.add(sunSprite);
  }

  // board platform + tile inlay
  platMesh = new THREE.Mesh(
    new THREE.BoxGeometry(COLS * CELL + 1.0, ROWS * CELL + 1.0, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xf6e7c6, roughness: 0.85, metalness: 0 }),
  );
  platMesh.position.z = -0.72;
  scene.add(platMesh);
  {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const ctx = cv.getContext('2d');
    const s = 512 / 8;
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.beginPath();
        ctx.roundRect(c * s + 4, r * s + 4, s - 8, s - 8, 10);
        ctx.fill();
      }
    }
    const tiles = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.55 }),
    );
    tiles.position.z = -0.4;
    scene.add(tiles);
  }

  // drifting pollen sparkles
  {
    const n = 130, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 2] = -2 + Math.random() * 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pollen = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xfff2b0, size: 0.13, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    scene.add(pollen);
  }
}
if (webgl) buildEnvironment();

/* -------------------------------------------------------------- gem views */

const GEOS = [
  new THREE.OctahedronGeometry(0.54),                                   // 0 diamond
  new THREE.CylinderGeometry(0.44, 0.44, 0.5, 6).rotateX(Math.PI / 2),  // 1 hex prism
  new THREE.BoxGeometry(0.64, 0.64, 0.64),                              // 2 cube
  new THREE.IcosahedronGeometry(0.52, 0),                               // 3 icosa
  new THREE.ConeGeometry(0.44, 0.82, 7),                                // 4 spire
  new THREE.TorusGeometry(0.36, 0.16, 10, 22),                          // 5 ring
];
const baseMats = COLOURS.map((c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.22, metalness: 0.12, flatShading: true,
  emissive: c, emissiveIntensity: 0.14, transparent: true,
}));

class GemView {
  constructor(type) {
    this.type = type;
    this.pos = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.scale = 1;
    this.opacity = 1;
    this.hinted = false;
    this.phase = Math.random() * Math.PI * 2;
    this.spin = (0.25 + Math.random() * 0.35) * (Math.random() < 0.5 ? 1 : -1);
    if (webgl) {
      this.mat = baseMats[type].clone();
      this.mesh = new THREE.Mesh(GEOS[type], this.mat);
      gemGroup.add(this.mesh);
    } else {
      this.el = document.createElement('div');
      this.el.className = 'dgem t' + type;
      domGemsEl.appendChild(this.el);
    }
  }
  sync(t) {
    const bob = Math.sin(t * 1.35 + this.phase) * 0.045;
    const s = this.scale * (this.hinted ? 1 + 0.1 * Math.abs(Math.sin(t * 5.2)) : 1);
    if (webgl) {
      this.mesh.position.set(this.pos.x + this.offset.x, this.pos.y + bob + this.offset.y, this.pos.z + this.offset.z);
      this.mesh.rotation.y = t * this.spin + this.phase;
      this.mesh.rotation.x = Math.sin(t * 0.6 + this.phase) * 0.12;
      this.mesh.scale.setScalar(s);
      this.mat.opacity = this.opacity;
      this.mat.emissiveIntensity = this.type === featuredType()
        ? 0.26 + 0.18 * (0.5 + 0.5 * Math.sin(t * 3.2))
        : 0.14;
    } else {
      const p = projectWorld(this.pos.x + this.offset.x, this.pos.y + bob + this.offset.y, this.pos.z + this.offset.z);
      const size = Math.max(6, cellPix * 0.82 * s);
      this.el.style.width = size + 'px';
      this.el.style.height = size + 'px';
      this.el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
      this.el.style.opacity = String(this.opacity);
    }
  }
  dispose() {
    if (webgl) { gemGroup.remove(this.mesh); this.mat.dispose(); }
    else this.el.remove();
  }
}

let grid = [];
function buildGems() {
  for (const row of grid) for (const g of row) g && g.dispose();
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const gv = new GemView(board[r][c]);
      gv.pos.copy(cellWorld(r, c));
      row.push(gv);
    }
    grid.push(row);
  }
}

/* ---------------------------------------------------- camera + projection */

const camCtl = { az: 0, pol: DEF_POLAR, zoom: 1 };
let stageW = 1, stageH = 1, baseDist = 16, cellPix = 48, camDirty = true, warmFrames = 0;
const cellScreen = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ x: 0, y: 0 })));

function computeBaseDist() {
  const half = (Math.max(ROWS, COLS) * CELL) / 2 + 0.62;
  const vf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  baseDist = Math.max(half / vf, half / (vf * Math.max(camera.aspect, 0.01))) * 1.02 + 0.5;
}

function applyCamera() {
  const r = THREE.MathUtils.clamp(baseDist / camCtl.zoom, 5, 90);
  camera.position.set(
    r * Math.sin(camCtl.pol) * Math.sin(camCtl.az),
    r * Math.cos(camCtl.pol),
    r * Math.sin(camCtl.pol) * Math.cos(camCtl.az),
  );
  camera.lookAt(0, 0, 0);
  camDirty = true;
}

const _pv = new THREE.Vector3();
function projectWorld(x, y, z) {
  _pv.set(x, y, z).project(camera);
  return { x: (_pv.x * 0.5 + 0.5) * stageW, y: (0.5 - _pv.y * 0.5) * stageH };
}

const cellEls = [];
function buildCells() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'hitcell';
      el.setAttribute('data-testid', 'cell');
      el.dataset.r = r;
      el.dataset.c = c;
      cellsEl.appendChild(el);
      cellEls.push(el);
    }
  }
}

function updateCellBoxes() {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const a = projectWorld((3 - 3.5) * CELL, 0, 0);
  const b = projectWorld((4 - 3.5) * CELL, 0, 0);
  cellPix = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
  const s = cellPix * 0.94;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const w = cellWorld(r, c);
      const p = projectWorld(w.x, w.y, w.z);
      cellScreen[r][c].x = p.x;
      cellScreen[r][c].y = p.y;
      const el = cellEls[r * COLS + c];
      el.style.width = s + 'px';
      el.style.height = s + 'px';
      el.style.transform = `translate(${p.x - s / 2}px, ${p.y - s / 2}px)`;
    }
  }
  if (!webgl) {
    // position the fallback board backing from the projected corners
    const pad = cellPix * 0.55;
    const corners = [projectWorld(-4 * CELL, 4 * CELL, 0), projectWorld(4 * CELL, 4 * CELL, 0),
                     projectWorld(-4 * CELL, -4 * CELL, 0), projectWorld(4 * CELL, -4 * CELL, 0)];
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    domBoardEl.style.left = x0 + 'px';
    domBoardEl.style.top = y0 + 'px';
    domBoardEl.style.width = (Math.max(...xs) + pad - x0) + 'px';
    domBoardEl.style.height = (Math.max(...ys) + pad - y0) + 'px';
  }
}

function onResize() {
  const rect = stageEl.getBoundingClientRect();
  stageW = Math.max(1, rect.width);
  stageH = Math.max(1, rect.height);
  camera.aspect = stageW / stageH;
  camera.updateProjectionMatrix();
  if (renderer) renderer.setSize(stageW, stageH, false);
  computeBaseDist();
  applyCamera();
}
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe(stageEl);

/* ------------------------------------------------------------------ tweens */

const tweens = new Set();
const easeInQuad = (t) => t * t;
const easeOutQuad = (t) => t * (2 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);

function tween(dur, update, ease = easeInOut) {
  return new Promise((res) => {
    tweens.add({ t0: performance.now(), dur, update, ease, res });
  });
}

/* ------------------------------------------------------------- animations */

async function animateSwap(a, b) {
  const ga = grid[a.r][a.c], gb = grid[b.r][b.c];
  grid[a.r][a.c] = gb;
  grid[b.r][b.c] = ga;
  const pa = cellWorld(a.r, a.c), pb = cellWorld(b.r, b.c);
  ga.offset.set(0, 0, 0);
  await tween(160, (e) => {
    ga.pos.lerpVectors(pa, pb, e);
    ga.pos.z = Math.sin(e * Math.PI) * 0.5;
    gb.pos.lerpVectors(pb, pa, e);
    gb.pos.z = -Math.sin(e * Math.PI) * 0.25;
  });
  ga.pos.copy(pb); gb.pos.copy(pa);
}

async function animateClear(matches, waveIdx) {
  const views = [];
  for (const m of matches) {
    const v = grid[m.r][m.c];
    if (v) views.push(v);
    grid[m.r][m.c] = null;
  }
  if (waveIdx > 0) cascadePop(waveIdx);
  await tween(190, (e) => {
    for (const v of views) { v.scale = 1 + 0.55 * e; v.opacity = 1 - e; }
  }, easeOutQuad);
  for (const v of views) v.dispose();
}

function fall(view, to, cells) {
  const from = view.pos.clone();
  const dur = Math.min(250, 110 + 42 * Math.max(1, cells));
  return tween(dur, (e) => view.pos.lerpVectors(from, to, e), easeInQuad).then(() => {
    view.pos.copy(to);
    // tiny landing squash, fire-and-forget
    tween(90, (e) => { view.scale = 1 - 0.12 * Math.sin(e * Math.PI); }, easeOutQuad);
  });
}

async function animateDrop(step) {
  const proms = [];
  const topY = cellWorld(0, 0).y;
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][c]) survivors.push({ view: grid[r][c], from: r });
      grid[r][c] = null;
    }
    survivors.forEach((s, j) => {
      const tr = ROWS - 1 - j;
      grid[tr][c] = s.view;
      if (tr !== s.from) proms.push(fall(s.view, cellWorld(tr, c), tr - s.from));
    });
    const nNew = ROWS - survivors.length;
    for (let r = nNew - 1; r >= 0; r--) {
      const gv = new GemView(step.board[r][c]);
      const target = cellWorld(r, c);
      gv.pos.set(target.x, topY + (nNew - r) * CELL + 0.4, 0);
      grid[r][c] = gv;
      proms.push(fall(gv, target, nNew + 0.5));
    }
  }
  await Promise.all(proms);
}

async function animateInvalid(a, b) {
  animating = true;
  const ga = grid[a.r][a.c];
  const dir = cellWorld(b.r, b.c).sub(cellWorld(a.r, a.c)).multiplyScalar(0.32);
  await tween(110, (e) => ga.offset.copy(dir).multiplyScalar(e), easeOutQuad);
  await tween(130, (e) => ga.offset.copy(dir).multiplyScalar(1 - e));
  ga.offset.set(0, 0, 0);
  animating = false;
}

/* ----------------------------------------------------------------- popups */

function fmt(n) { return n.toLocaleString('en-US'); }

function scorePop(gain, bonus) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = '+' + fmt(gain);
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 1600);
  if (bonus > 0) {
    const be = document.createElement('div');
    be.className = 'pop bonus';
    be.textContent = `+${bonus} off-hint bonus!`;
    fxEl.appendChild(be);
    setTimeout(() => be.remove(), 2000);
  }
}

function cascadePop(waveIdx) {
  const el = document.createElement('div');
  el.className = 'cascadepop';
  el.textContent = `CASCADE ×${waveIdx + 1}!`;
  el.style.fontSize = `clamp(${18 + waveIdx * 4}px, ${4 + waveIdx}vw, ${34 + waveIdx * 8}px)`;
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function stageBanner(s) {
  const flash = document.createElement('div');
  flash.className = 'flash';
  fxEl.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
  const el = document.createElement('div');
  el.className = 'stagebanner';
  el.textContent = `☀ Stage ${s + 1} — ${THEMES[s % THEMES.length].name}`;
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

/* --------------------------------------------------------------- staging */

function applyStage() {
  const th = theme();
  document.documentElement.style.setProperty('--skytop', th.cssTop);
  document.documentElement.style.setProperty('--skybot', th.cssBot);
  if (webgl) {
    skyMat.uniforms.top.value.setHex(th.skyTop);
    skyMat.uniforms.bot.value.setHex(th.skyBot);
    scene.fog.color.setHex(th.skyBot);
    groundMesh.material.color.setHex(th.ground);
    platMesh.material.color.setHex(th.plat);
    dirLight.color.setHex(th.sun);
    hemiLight.color.setHex(th.skyTop);
    hemiLight.groundColor.setHex(th.ground);
  }
  stageNameEl.textContent = `Stage ${stage + 1} — ${th.name}`;
}

/* -------------------------------------------------------------------- HUD */

const ledgerRows = [];
function buildLedger() {
  for (let t = 0; t < TYPES; t++) {
    const row = document.createElement('div');
    row.className = 'lrow';
    row.innerHTML =
      `<span class="glyph" style="color:${CSS_COLOURS[t]}">${GLYPHS[t]}</span>` +
      `<span class="lname">${NAMES[t]}<span style="opacity:.55;font-weight:400;font-size:11px"> · ${VALUE_NOTES[t]}</span></span>` +
      `<span class="ltag hot" hidden>HOT ×${FEATURED_MULT}</span>` +
      `<span class="ltag lucky" hidden>LUCKY</span>` +
      `<span class="lval"></span>`;
    ledgerEl.appendChild(row);
    ledgerRows.push(row);
  }
}

function updateHud() {
  scoreEl.textContent = fmt(score);
  bestEl.textContent = 'best ' + fmt(best);
  multchipEl.textContent = `×${multiplier} multiplier`;
  const ft = featuredType();
  hotchipEl.innerHTML =
    `<span class="glyph" style="color:${CSS_COLOURS[ft]}">${GLYPHS[ft]}</span>` +
    `<span>HOT: ${NAMES[ft]} ×${FEATURED_MULT}</span>`;
  luckychipEl.innerHTML = favoured === null
    ? 'Lucky drops: —'
    : `<span class="glyph" style="color:${CSS_COLOURS[favoured]}">${GLYPHS[favoured]}</span><span>Lucky drops: ${NAMES[favoured]}</span>`;
  for (let t = 0; t < TYPES; t++) {
    const row = ledgerRows[t];
    row.querySelector('.lval').textContent = fmt(valueOf(t));
    row.querySelector('.ltag.hot').hidden = t !== ft;
    row.querySelector('.ltag.lucky').hidden = t !== favoured;
    row.classList.toggle('hotrow', t === ft);
    row.classList.toggle('luckyrow', t === favoured);
  }
  peekEl.innerHTML = '';
  for (const t of peek) {
    const chip = document.createElement('span');
    chip.className = 'peekchip';
    chip.style.color = CSS_COLOURS[t];
    chip.textContent = GLYPHS[t];
    peekEl.appendChild(chip);
  }
  const note = document.createElement('span');
  note.className = 'peeknote';
  note.textContent = favoured === null
    ? 'What the meadow feeds in next.'
    : `Biased toward ${NAMES[favoured]} — the colour you last cleared.`;
  peekEl.appendChild(note);
  gameoverEl.hidden = !gameOver;
}

/* --------------------------------------------------------------- the move */

async function commitMove(a, b, hintSnap) {
  const myEpoch = epoch;
  animating = true;
  clearHint();

  const swapped = G.applySwap(board, a, b);

  // favour = majority colour of the wave the swap itself created
  const wave0 = G.findMatches(swapped);
  const tally = new Array(TYPES).fill(0);
  for (const m of wave0) tally[swapped[m.r][m.c]]++;
  let fav = 0;
  for (let t = 1; t < TYPES; t++) if (tally[t] > tally[fav]) fav = t;

  const res = G.collapse(swapped, rng, TYPES, fav);

  // score the move wave by wave (values evolve as waves clear)
  const ft = featuredType();
  let totalRaw = 0, longest = 1, inc = swapped;
  const waves = [];
  for (let i = 0; i < res.steps.length; i++) {
    const s = res.steps[i];
    longest = Math.max(longest, G.longestRun(inc));
    let raw = 0;
    const clearedTypes = new Set();
    for (const m of s.matches) {
      const t = inc[m.r][m.c];
      clearedTypes.add(t);
      raw += valueOf(t, inc) * (t === ft ? FEATURED_MULT : 1);
    }
    for (const t of clearedTypes) matchCounts[t]++;
    totalRaw += raw * G.cascadeFactor(i);
    waves.push(s);
    inc = s.board;
  }
  const newMult = G.matchMultiplier(multiplier, longest);
  const bonus = hintSnap && !samePair(hintSnap, { a, b }) ? DEVIATION_BONUS : 0;
  const gain = totalRaw * newMult + bonus;

  // play it out: swap, then clear -> drop per wave, strictly in order
  await animateSwap(a, b);
  if (epoch !== myEpoch) return;
  for (let i = 0; i < waves.length; i++) {
    await animateClear(waves[i].matches, i);
    if (epoch !== myEpoch) return;
    await animateDrop(waves[i]);
    if (epoch !== myEpoch) return;
  }

  // apply state
  board = res.board;
  multiplier = newMult;
  favoured = fav;
  lastGain = gain;
  lastBonus = bonus;
  score += gain;
  if (score > best) {
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
  }
  const ns = G.stageForScore(score);
  if (ns !== stage) {
    stage = ns;
    applyStage();
    stageBanner(stage);
  }
  peek = G.refillQueue(cloneRng(), TYPES, favoured, PEEK_N);
  scorePop(gain, bonus);
  if (!G.hasValidMove(board)) gameOver = true;
  updateHud();
  animating = false;
  restartIdle();
}

/* ----------------------------------------------------------------- hint */

let idleTimer = null;
function restartIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showHint, 10000);
}
function showHint() {
  if (gameOver || animating) { idleTimer = setTimeout(showHint, 600); return; }
  const mv = firstValidMove(board);
  if (!mv) return;
  hint = mv;
  const g = grid[mv.a.r][mv.a.c];
  if (g) g.hinted = true;
}
function clearHint() {
  if (!hint) return;
  const g = grid[hint.a.r] && grid[hint.a.r][hint.a.c];
  if (g) g.hinted = false;
  hint = null;
}

/* ------------------------------------------------------------- new game */

function newGame() {
  epoch++;
  animating = false;
  clearHint();
  board = G.createBoard(ROWS, COLS, TYPES, rng);
  buildGems();
  score = 0; lastGain = 0; lastBonus = 0; multiplier = 1;
  favoured = null; gameOver = false;
  matchCounts.fill(0);
  if (stage !== 0) { stage = 0; applyStage(); }
  peek = G.refillQueue(cloneRng(), TYPES, null, PEEK_N);
  updateHud();
  restartIdle();
}
newGameEl.addEventListener('click', newGame);

hudToggleEl.addEventListener('click', () => {
  const hidden = hudEl.classList.toggle('hidden');
  hudToggleEl.textContent = hidden ? 'Show panel' : 'Hide panel';
  hudToggleEl.setAttribute('aria-expanded', String(!hidden));
});

/* ------------------------------------------------- pointer interaction */

const pointers = new Map();
let drag = null;   // { id, a, sx, sy, hintSnap }
let orbit = null;  // { id, x, y }
let pinch = null;  // { d0, zoom0 }

function pointerDist() {
  const [p1, p2] = [...pointers.values()];
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function cancelDragVisual() {
  if (!drag) return;
  const g = grid[drag.a.r][drag.a.c];
  if (g) {
    const from = g.offset.clone();
    tween(130, (e) => g.offset.lerpVectors(from, new THREE.Vector3(0, 0, 0), e), easeOutQuad);
  }
}

stageEl.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    cancelDragVisual();
    drag = null;
    orbit = null;
    pinch = { d0: Math.max(10, pointerDist()), zoom0: camCtl.zoom };
    return;
  }
  if (pointers.size > 2 || pinch) return;
  const cellEl = e.target && e.target.closest ? e.target.closest('[data-testid="cell"]') : null;
  if (cellEl && !animating && !gameOver) {
    drag = {
      id: e.pointerId,
      a: { r: Number(cellEl.dataset.r), c: Number(cellEl.dataset.c) },
      sx: e.clientX, sy: e.clientY,
      hintSnap: hint ? { a: { ...hint.a }, b: { ...hint.b } } : null,
    };
  } else if (!cellEl) {
    orbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
});

window.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; }
  if (pinch) {
    if (pointers.size >= 2) {
      camCtl.zoom = THREE.MathUtils.clamp(pinch.zoom0 * (pointerDist() / pinch.d0), 0.55, 2.6);
      applyCamera();
    }
    return;
  }
  if (orbit && e.pointerId === orbit.id) {
    camCtl.az -= (e.clientX - orbit.x) * 0.0045;
    camCtl.pol = THREE.MathUtils.clamp(camCtl.pol - (e.clientY - orbit.y) * 0.0035, 0.85, 1.55);
    orbit.x = e.clientX; orbit.y = e.clientY;
    applyCamera();
    return;
  }
  if (drag && e.pointerId === drag.id && !animating) {
    const g = grid[drag.a.r][drag.a.c];
    if (g) {
      const wpp = CELL / cellPix;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const off = right.multiplyScalar((e.clientX - drag.sx) * wpp)
        .add(up.multiplyScalar(-(e.clientY - drag.sy) * wpp));
      off.z = 0;
      off.clampLength(0, CELL * 0.62);
      g.offset.copy(off);
    }
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) drag = null;
    if (orbit && orbit.id === e.pointerId) orbit = null;
    return;
  }
  if (orbit && orbit.id === e.pointerId) orbit = null;
  if (drag && drag.id === e.pointerId) {
    const d = drag;
    drag = null;
    finishDrag(d, e.clientX, e.clientY);
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

// A move is decided by where the gesture ENDS: released back on the origin
// (below the slide threshold) means no move at all.
function finishDrag(d, ex, ey) {
  const g = grid[d.a.r][d.a.c];
  const dx = ex - d.sx, dy = ey - d.sy;
  const len = Math.hypot(dx, dy);
  if (animating || gameOver || len < cellPix * 0.3) {
    if (g) {
      const from = g.offset.clone();
      tween(130, (e2) => g.offset.lerpVectors(from, new THREE.Vector3(0, 0, 0), e2), easeOutQuad);
    }
    return;
  }
  const origin = cellScreen[d.a.r][d.a.c];
  let bestNb = null, bestProj = 0;
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const r = d.a.r + dr, c = d.a.c + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const v = { x: cellScreen[r][c].x - origin.x, y: cellScreen[r][c].y - origin.y };
    const vlen = Math.hypot(v.x, v.y);
    if (vlen < 1) continue;
    const proj = (dx * v.x + dy * v.y) / vlen;       // displacement along this neighbour
    const cos = proj / len;
    if (cos > 0.55 && proj > vlen * 0.34 && proj > bestProj) {
      bestProj = proj;
      bestNb = { r, c };
    }
  }
  if (!bestNb) {
    if (g) {
      const from = g.offset.clone();
      tween(130, (e2) => g.offset.lerpVectors(from, new THREE.Vector3(0, 0, 0), e2), easeOutQuad);
    }
    return;
  }
  if (g) g.offset.set(0, 0, 0);
  if (G.isValidSwap(board, d.a, bestNb)) commitMove(d.a, bestNb, d.hintSnap);
  else animateInvalid(d.a, bestNb);
}

/* --------------------------------------------------------- view controls */

$('reset-view').addEventListener('click', () => {
  const from = { az: camCtl.az, pol: camCtl.pol, zoom: camCtl.zoom };
  tween(260, (e) => {
    camCtl.az = from.az + (0 - from.az) * e;
    camCtl.pol = from.pol + (DEF_POLAR - from.pol) * e;
    camCtl.zoom = from.zoom + (1 - from.zoom) * e;
    applyCamera();
  }, easeOutQuad);
});
$('zoom-in').addEventListener('click', () => {
  camCtl.zoom = THREE.MathUtils.clamp(camCtl.zoom * 1.2, 0.55, 2.6);
  applyCamera();
});
$('zoom-out').addEventListener('click', () => {
  camCtl.zoom = THREE.MathUtils.clamp(camCtl.zoom / 1.2, 0.55, 2.6);
  applyCamera();
});
stageEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  camCtl.zoom = THREE.MathUtils.clamp(camCtl.zoom * (e.deltaY < 0 ? 1.08 : 0.925), 0.55, 2.6);
  applyCamera();
}, { passive: false });

/* ------------------------------------------------------------- main loop */

function frame(now) {
  const t = now / 1000;
  // tweens
  for (const tw of tweens) {
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    tw.update(tw.ease(k), k);
    if (k >= 1) { tweens.delete(tw); tw.res(); }
  }
  // hit-cell boxes track the camera (static once the camera settles)
  if (camDirty || warmFrames < 5) {
    updateCellBoxes();
    camDirty = false;
    warmFrames++;
  }
  // gem life
  for (const row of grid) for (const g of row) g && g.sync(t);
  if (webgl) {
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.speed * 0.016;
      if (cloud.position.x > 90) cloud.position.x = -90;
    }
    if (pollen) {
      const pos = pollen.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + 0.006;
        if (y > 8) y = -8;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(t * 0.7 + i) * 0.0012);
      }
      pos.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ test hooks */

window.__test = {
  score: () => score,
  lastGain: () => lastGain,
  lastBonus: () => lastBonus,
  multiplier: () => multiplier,
  gemValues: () => Array.from({ length: TYPES }, (_, t) => valueOf(t)),
  stage: () => stage,
  featuredType: () => featuredType(),
  featuredMultiplier: () => FEATURED_MULT,
  favouredType: () => favoured,
  nextColours: () => peek.slice(),
  bestScore: () => best,
  validMove: () => firstValidMove(board),
  board: () => board.map((row) => row.slice()),
  gameOver: () => gameOver,
  hint: () => (hint ? { a: { ...hint.a }, b: { ...hint.b } } : null),
};

/* ------------------------------------------------------------------ boot */

buildCells();
buildGems();
buildLedger();
applyStage();
updateHud();
onResize();
updateCellBoxes();
restartIdle();
requestAnimationFrame(frame);
