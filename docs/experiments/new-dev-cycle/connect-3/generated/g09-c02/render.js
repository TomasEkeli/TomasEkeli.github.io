// render.js — "Skylark Rise": a sunlit hot-air-balloon festival match-3.
// Three.js (vendored) scene; game.js holds all pure logic.

import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap, collapse,
  longestRun, matchMultiplier, stageForScore, cascadeFactor, refillQueue,
} from './game.js';

const ROWS = 8, COLS = 8, TYPES = 6;
const S = 1.05;                 // world units per cell
const GEM_Z = 0.55;             // gems float proud of the board panel
const FEATURED_MULT = 3;        // the stage's hot colour pays triple
const DEVIATION_BONUS = 100;
const BEST_KEY = 'skylark-rise-best-v1';

// ---------- seedable rng (mulberry32) with cloneable state ----------
function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.state = () => a >>> 0;
  return f;
}

// ---------- gem + stage definitions ----------
const GEMS = [
  { name: 'Coral', color: 0xff5d73, css: '#ff5d73', glyph: 'shape-diamond', rule: 'doubles each match' },
  { name: 'Amber', color: 0xffa62b, css: '#ffa62b', glyph: 'shape-cube',    rule: 'flat, never scales' },
  { name: 'Sun',   color: 0xffd937, css: '#ffd937', glyph: 'shape-orb',     rule: '+6 each match' },
  { name: 'Leaf',  color: 0x59d868, css: '#59d868', glyph: 'shape-prism',   rule: 'rarer = richer' },
  { name: 'Sky',   color: 0x3fb7ff, css: '#3fb7ff', glyph: 'shape-pyramid', rule: 'flat' },
  { name: 'Plum',  color: 0xb57bff, css: '#b57bff', glyph: 'shape-ring',    rule: 'grows with stage' },
];

const STAGES = [
  { name: 'Sunrise Meadow',   top: '#8fd3ff', bot: '#ffd9a0', ground: '#79c96e', panel: '#fff2dc', rim: '#ff9a5c', hemi: '#fff2dc', sun: '#fff6e0', featured: 2 },
  { name: 'Citrus Coast',     top: '#5fcdff', bot: '#eafcff', ground: '#f2d98a', panel: '#eafcff', rim: '#ffb347', hemi: '#eaf8ff', sun: '#fff8e8', featured: 1 },
  { name: 'Lavender Uplands', top: '#b39bff', bot: '#ffe3f2', ground: '#9f8fd8', panel: '#f6efff', rim: '#b57bff', hemi: '#f3ecff', sun: '#fff0ff', featured: 5 },
  { name: 'Cloud Sea',        top: '#6fbfff', bot: '#ffffff', ground: '#cfe8ff', panel: '#f2f9ff', rim: '#3fb7ff', hemi: '#ffffff', sun: '#ffffff', featured: 4 },
  { name: 'Golden Hour',      top: '#ffb75e', bot: '#ffe9c4', ground: '#d8b56a', panel: '#fff1d6', rim: '#ffd937', hemi: '#fff0d0', sun: '#fff3c8', featured: 0 },
  { name: 'Firefly Meadow',   top: '#66d9b8', bot: '#fdfad2', ground: '#6cc98b', panel: '#eefff2', rim: '#59d868', hemi: '#f0fff0', sun: '#fbffe8', featured: 3 },
];
const stageDef = (i) => STAGES[i % STAGES.length];

// ---------- game state ----------
const state = {
  board: null,
  score: 0,
  best: 0,
  mult: 1,
  lastGain: 0,
  lastBonus: 0,
  favoured: null,          // colour the refill is biased toward (last actively cleared)
  matchCounts: new Array(TYPES).fill(0), // per-colour "times matched this playthrough"
  peek: [],
  gameOver: false,
  animating: false,
  hint: null,
  lastActionTime: performance.now(),
  multTrend: '',
};
try { state.best = Math.max(0, parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0); } catch { /* private mode */ }

let refillRng = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);
let boardRng = makeRng((Date.now() * 2654435761) >>> 0);

function curStage() { return stageForScore(state.score); }
function featuredType() { return stageDef(curStage()).featured; }

function countColour(brd, t) {
  let n = 0;
  for (const row of brd) for (const v of row) if (v === t) n++;
  return n;
}

/** The CURRENT per-gem value of a colour (before any featured boost). */
function gemValue(t, brd = state.board) {
  switch (t) {
    case 0: return Math.min(320, 5 * 2 ** state.matchCounts[0]);      // cheap but exponential
    case 1: return 50;                                                // expensive, flat
    case 2: return 12 + 6 * state.matchCounts[2];                     // grows each match
    case 3: {                                                         // rarer = richer
      const n = countColour(brd, 3);
      return Math.max(16, Math.min(320, Math.round(320 / Math.max(1, n))));
    }
    case 4: return 15;                                                // modest, flat
    case 5: return 10 * (1 + curStage());                             // scales with stage
    default: return 1;
  }
}

function findFirstValidMove(brd) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isValidSwap(brd, { r, c }, { r, c: c + 1 }))
        return { a: { r, c }, b: { r, c: c + 1 } };
      if (r + 1 < ROWS && isValidSwap(brd, { r, c }, { r: r + 1, c }))
        return { a: { r, c }, b: { r: r + 1, c } };
    }
  }
  return null;
}

// ---------- three.js scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfeaff, 42, 110);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 260);

// orbit state (player camera)
const ORBIT_DEFAULT = { theta: 0, phi: 1.30, zoom: 1 };
const orbit = {
  theta: ORBIT_DEFAULT.theta, phi: ORBIT_DEFAULT.phi, zoom: ORBIT_DEFAULT.zoom,
  baseRadius: 16, target: new THREE.Vector3(0, 0.15, 0),
};
let cellsDirty = true;

function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const half = 4.7; // board half-extent incl. rim
  const dH = half / (0.66 * t);
  const dW = half / (0.80 * t * camera.aspect);
  orbit.baseRadius = Math.max(dH, dW, 10);
  cellsDirty = true;
}

function applyCamera() {
  const r = orbit.baseRadius * orbit.zoom;
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    orbit.target.x + r * sp * Math.sin(orbit.theta),
    orbit.target.y + r * cp,
    orbit.target.z + r * sp * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
}

// lights
const hemi = new THREE.HemisphereLight(0xfff2dc, 0xa8d8a0, 1.2);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff6e0, 2.1);
sunLight.position.set(9, 14, 8);
scene.add(sunLight);
const fill = new THREE.DirectionalLight(0xbfe4ff, 0.65);
fill.position.set(-8, 4, 10);
scene.add(fill);

// sky dome (gradient shader)
const skyUniforms = {
  top: { value: new THREE.Color('#8fd3ff') },
  bot: { value: new THREE.Color('#ffd9a0') },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(120, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, smoothstep(0.08, 0.75, h)), 1.0); }',
  }),
);
sky.frustumCulled = false;
scene.add(sky);

// sun disc + glow sprite
const sunGroup = new THREE.Group();
const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(4.2, 32),
  new THREE.MeshBasicMaterial({ color: 0xfffbe8, fog: false }),
);
sunGroup.add(sunDisc);
(function addSunGlow() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,250,220,0.9)');
  grad.addColorStop(0.4, 'rgba(255,235,170,0.35)');
  grad.addColorStop(1, 'rgba(255,235,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false,
  }));
  sp.scale.set(26, 26, 1);
  sunGroup.add(sp);
})();
sunGroup.position.set(38, 42, -78);
sunGroup.lookAt(0, 0, 0);
scene.add(sunGroup);

// ground + hills
const groundMat = new THREE.MeshLambertMaterial({ color: 0x79c96e });
const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7.5;
scene.add(ground);
const hillMat = new THREE.MeshLambertMaterial({ color: 0x8fd67f, flatShading: true });
for (let i = 0; i < 9; i++) {
  const hill = new THREE.Mesh(new THREE.SphereGeometry(7 + (i % 4) * 3.4, 10, 8), hillMat);
  const ang = (i / 9) * Math.PI * 2 + 0.4;
  hill.position.set(Math.sin(ang) * (26 + (i % 3) * 12), -8.2, Math.cos(ang) * (30 + (i % 4) * 10) - 8);
  hill.scale.y = 0.42;
  scene.add(hill);
}

// drifting clouds (puffball clusters)
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const clouds = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  const puffs = 3 + (i % 3);
  for (let p = 0; p < puffs; p++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 + (p % 3) * 0.9, 0), cloudMat);
    m.position.set(p * 1.8 - puffs, (p % 2) * 0.7, (p % 3) * 0.5);
    m.scale.y = 0.55;
    g.add(m);
  }
  g.position.set(-46 + i * 11, 8 + (i % 4) * 5, -30 - (i % 5) * 9);
  g.userData.speed = 0.35 + (i % 3) * 0.18;
  clouds.push(g);
  scene.add(g);
}

// festival balloons
const balloons = [];
(function addBalloons() {
  const basketMat = new THREE.MeshLambertMaterial({ color: 0x9a6b3f });
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const col = GEMS[i % TYPES].color;
    const env = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 12, 10),
      new THREE.MeshLambertMaterial({ color: col, flatShading: true }),
    );
    env.scale.y = 1.18;
    g.add(env);
    const stripe = new THREE.Mesh(
      new THREE.SphereGeometry(2.24, 12, 10, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.24),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    );
    stripe.scale.y = 1.18;
    g.add(stripe);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), basketMat);
    basket.position.y = -3.2;
    g.add(basket);
    const ang = (i / 7) * Math.PI * 2;
    g.position.set(Math.sin(ang) * (17 + (i % 3) * 8), 2 + (i % 4) * 4.5, -14 - Math.abs(Math.cos(ang)) * 26);
    g.userData = { phase: i * 1.7, rise: 0.25 + (i % 3) * 0.12, x0: g.position.x, y0: g.position.y };
    balloons.push(g);
    scene.add(g);
  }
})();

// gentle petal/confetti drift
let petals;
(function addPetals() {
  const N = 90;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = Math.random() * 22 - 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 4;
    c.set(GEMS[i % TYPES].color).offsetHSL(0, 0, 0.18);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  petals = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false,
  }));
  petals.userData.seed = pos.slice();
  scene.add(petals);
})();

// ---------- the board: tilted easel with a grid panel ----------
const boardGroup = new THREE.Group();
boardGroup.rotation.x = -0.40; // top leans gently away — depth without row interleave
boardGroup.position.y = 0.15;
scene.add(boardGroup);

const panelCanvas = document.createElement('canvas');
panelCanvas.width = panelCanvas.height = 512;
const panelTexture = new THREE.CanvasTexture(panelCanvas);
panelTexture.colorSpace = THREE.SRGBColorSpace;
function drawPanel(hex) {
  const g = panelCanvas.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, 512, 512);
  const cs = 512 / 8;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      g.fillStyle = (r + c) % 2 ? 'rgba(70,110,180,0.10)' : 'rgba(70,110,180,0.045)';
      const pad = 3;
      g.beginPath();
      g.roundRect(c * cs + pad, r * cs + pad, cs - pad * 2, cs - pad * 2, 10);
      g.fill();
    }
  }
  panelTexture.needsUpdate = true;
}
drawPanel(STAGES[0].panel);
const panelMat = new THREE.MeshLambertMaterial({ map: panelTexture });
const panelSide = new THREE.MeshLambertMaterial({ color: 0xffffff });
const panel = new THREE.Mesh(
  new THREE.BoxGeometry(COLS * S + 0.5, ROWS * S + 0.5, 0.34),
  [panelSide, panelSide, panelSide, panelSide, panelMat, panelSide],
);
boardGroup.add(panel);
const rimMat = new THREE.MeshLambertMaterial({ color: 0xff9a5c });
const rim = new THREE.Mesh(new THREE.BoxGeometry(COLS * S + 1.1, ROWS * S + 1.1, 0.22), rimMat);
rim.position.z = -0.12;
boardGroup.add(rim);
// easel legs so the board lives in the world
const legMat = new THREE.MeshLambertMaterial({ color: 0xc98d55 });
for (const sx of [-1, 1]) {
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 8.5, 8), legMat);
  leg.position.set(sx * (COLS * S / 2 + 0.2), -5.4, -1.4);
  leg.rotation.x = 0.22;
  scene.add(leg);
}

// ---------- gem meshes ----------
const GEOMS = [
  new THREE.OctahedronGeometry(0.47),
  new THREE.BoxGeometry(0.64, 0.64, 0.64),
  new THREE.IcosahedronGeometry(0.45, 0),
  new THREE.CylinderGeometry(0.42, 0.42, 0.5, 6),
  new THREE.ConeGeometry(0.46, 0.74, 4),
  new THREE.TorusGeometry(0.33, 0.15, 10, 22),
];
const BASE_EMISSIVE = 0.08;
const MATS = GEMS.map((g) => new THREE.MeshStandardMaterial({
  color: g.color, flatShading: true, metalness: 0.05, roughness: 0.32,
  emissive: g.color, emissiveIntensity: BASE_EMISSIVE,
}));
const haloGeom = new THREE.TorusGeometry(0.5, 0.045, 8, 36);
const haloMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85 });

const cellX = (c) => (c - (COLS - 1) / 2) * S;
const cellY = (r) => ((ROWS - 1) / 2 - r) * S;

function makeGem(type) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  const mesh = new THREE.Mesh(GEOMS[type], MATS[type]);
  if (type === 3) mesh.rotation.x = Math.PI / 2;      // hexagon face forward
  if (type === 4) { mesh.rotation.y = Math.PI / 4; mesh.position.y = -0.05; }
  spin.add(mesh);
  const halo = new THREE.Mesh(haloGeom, haloMat);
  halo.position.z = -0.2; // an aura ring in the board plane, behind the gem
  halo.visible = type === featuredType();
  group.add(spin);
  group.add(halo);
  group.userData = { type, spin, halo, phase: Math.random() * Math.PI * 2 };
  return group;
}

let meshGrid = [];
function buildMeshes() {
  for (const row of meshGrid) for (const g of row) if (g) boardGroup.remove(g);
  meshGrid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const g = makeGem(state.board[r][c]);
      g.position.set(cellX(c), cellY(r), GEM_Z);
      boardGroup.add(g);
      row.push(g);
    }
    meshGrid.push(row);
  }
}

function applyFeaturedHalos() {
  const ft = featuredType();
  for (const row of meshGrid) {
    for (const g of row) {
      if (g) g.userData.halo.visible = g.userData.type === ft;
    }
  }
}

// ---------- burst particles ----------
const PMAX = 420;
const pPos = new Float32Array(PMAX * 3);
const pCol = new Float32Array(PMAX * 3);
const pVel = new Float32Array(PMAX * 3);
const pLife = new Float32Array(PMAX);
pPos.fill(9999);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const bursts = new THREE.Points(pGeo, new THREE.PointsMaterial({
  size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
}));
bursts.frustumCulled = false;
scene.add(bursts);
let pNext = 0;
const tmpColor = new THREE.Color();
function spawnBurst(worldPos, colorHex, count, speed) {
  tmpColor.set(colorHex);
  for (let i = 0; i < count; i++) {
    const k = pNext; pNext = (pNext + 1) % PMAX;
    pPos[k * 3] = worldPos.x; pPos[k * 3 + 1] = worldPos.y; pPos[k * 3 + 2] = worldPos.z;
    const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
    const v = speed * (0.5 + Math.random());
    pVel[k * 3] = Math.sin(ph) * Math.cos(th) * v;
    pVel[k * 3 + 1] = Math.cos(ph) * v + speed * 0.6;
    pVel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * v;
    pCol[k * 3] = tmpColor.r; pCol[k * 3 + 1] = tmpColor.g; pCol[k * 3 + 2] = tmpColor.b;
    pLife[k] = 0.7 + Math.random() * 0.4;
  }
  pGeo.attributes.color.needsUpdate = true;
}
function updateBursts(dt) {
  let any = false;
  for (let k = 0; k < PMAX; k++) {
    if (pLife[k] <= 0) continue;
    any = true;
    pLife[k] -= dt;
    pVel[k * 3 + 1] -= 7.5 * dt;
    pPos[k * 3] += pVel[k * 3] * dt;
    pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt;
    pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
    if (pLife[k] <= 0) { pPos[k * 3] = 9999; pPos[k * 3 + 1] = 9999; }
  }
  if (any) pGeo.attributes.position.needsUpdate = true;
}

// camera shake for deep cascades (subtle)
let shake = 0;

// ---------- hit-cells (the gate's 64 handles) ----------
const cellsEl = document.getElementById('cells');
const hitCells = [];
const projCache = [];
for (let r = 0; r < ROWS; r++) {
  projCache.push([]);
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.className = 'hitcell';
    d.setAttribute('data-testid', 'cell');
    d.dataset.r = String(r);
    d.dataset.c = String(c);
    cellsEl.appendChild(d);
    hitCells.push(d);
    projCache[r].push({ x: 0, y: 0, size: 40 });
  }
}
const projVec = new THREE.Vector3();
function updateCells() {
  // project with the camera as it is NOW (render() only refreshes the inverse
  // matrix afterwards, which left cells one stale frame behind after a tween)
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  boardGroup.updateMatrixWorld();
  const w = window.innerWidth, h = window.innerHeight;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      projVec.set(cellX(c), cellY(r), GEM_Z);
      boardGroup.localToWorld(projVec);
      projVec.project(camera);
      projCache[r][c].x = (projVec.x * 0.5 + 0.5) * w;
      projCache[r][c].y = (-projVec.y * 0.5 + 0.5) * h;
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = projCache[r][c];
      let d = Infinity;
      if (c > 0) d = Math.min(d, Math.hypot(p.x - projCache[r][c - 1].x, p.y - projCache[r][c - 1].y));
      if (c + 1 < COLS) d = Math.min(d, Math.hypot(p.x - projCache[r][c + 1].x, p.y - projCache[r][c + 1].y));
      if (r > 0) d = Math.min(d, Math.hypot(p.x - projCache[r - 1][c].x, p.y - projCache[r - 1][c].y));
      if (r + 1 < ROWS) d = Math.min(d, Math.hypot(p.x - projCache[r + 1][c].x, p.y - projCache[r + 1][c].y));
      const size = Math.max(18, d * 0.92);
      p.size = size;
      const el = hitCells[r * COLS + c];
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
    }
  }
}

// ---------- audio (tiny, self-contained) ----------
const audio = { ctx: null, muted: false };
function ac() {
  if (audio.muted) return null;
  if (!audio.ctx) {
    try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio.ctx;
}
function tone(freq, dur = 0.14, type = 'sine', gain = 0.045, when = 0) {
  const ctx = ac();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
  swap: () => tone(360, 0.08, 'sine', 0.03),
  pop: (wave) => {
    tone(430 + wave * 160, 0.16, 'triangle', 0.05 + Math.min(0.05, wave * 0.015));
    if (wave >= 1) tone(650 + wave * 200, 0.2, 'sine', 0.04, 0.05);
  },
  invalid: () => tone(130, 0.12, 'square', 0.03),
  land: () => tone(190, 0.05, 'sine', 0.018),
  stage: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.05, i * 0.1)); },
  over: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.34, 'sine', 0.045, i * 0.16)); },
  bonus: () => { tone(880, 0.14, 'triangle', 0.05); tone(1175, 0.2, 'triangle', 0.05, 0.08); },
};

// ---------- tween helper ----------
function tween(dur, onUpdate) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      onUpdate(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t; // accelerating — gems gather speed as they fall

// ---------- HUD ----------
const el = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  mult: document.getElementById('mult'),
  stageChip: document.getElementById('stage-chip'),
  ledgerRows: document.getElementById('ledger-rows'),
  featuredCallout: document.getElementById('featured-callout'),
  multNote: document.getElementById('mult-note'),
  peek: document.getElementById('peek'),
  favouredNote: document.getElementById('favoured-note'),
  fx: document.getElementById('fx'),
  banner: document.getElementById('banner'),
  flash: document.getElementById('flash'),
  gameover: document.getElementById('gameover'),
};

function glyphHTML(t, size = 18) {
  return `<span class="glyph ${GEMS[t].glyph}" style="--g:${GEMS[t].css}; width:${size}px; height:${size}px"></span>`;
}

function updateLedger() {
  const ft = featuredType();
  const rows = [];
  for (let t = 0; t < TYPES; t++) {
    const v = gemValue(t);
    const isFeat = t === ft;
    const isFav = t === state.favoured;
    rows.push(
      `<li class="${isFeat ? 'featured' : ''}">${glyphHTML(t)}<span class="gname">${GEMS[t].name}` +
      `${isFav ? ' <span class="favbadge">drops ▲</span>' : ''}</span>` +
      `<span class="gval">${isFeat ? `<small>${v}·3=</small>${v * FEATURED_MULT}` : v}</span>` +
      `${isFeat ? ' <span class="hotbadge">×3 HOT</span>' : ''}</li>`,
    );
  }
  el.ledgerRows.innerHTML = rows.join('');
  el.featuredCallout.innerHTML =
    `${glyphHTML(ft, 20)} <span class="big">${GEMS[ft].name} is HOT — ×${FEATURED_MULT}!</span>` +
    `every matched ${GEMS[ft].name} pays triple this stage`;
  el.multNote.innerHTML =
    `Streak multiplier <strong>×${state.mult}</strong>${state.multTrend} — ` +
    `4+ matches compound it, a plain 3-match halves it.`;
}

function updatePeek() {
  el.peek.innerHTML = state.peek.map((t, i) =>
    `<div class="peek-chip"><span class="ord">${i + 1}</span>${glyphHTML(t, 16)}<span>${GEMS[t].name}</span></div>`,
  ).join('');
  el.favouredNote.innerHTML = state.favoured == null
    ? 'No tailwind yet — clear a colour and the winds will favour it.'
    : `Winds favour ${glyphHTML(state.favoured, 14)} <strong>${GEMS[state.favoured].name}</strong> — your last clear steers the drops.`;
}

function updateStats(bumpMult = false) {
  el.score.textContent = state.score.toLocaleString('en-US');
  el.best.textContent = state.best.toLocaleString('en-US');
  el.mult.innerHTML = `×${state.mult}<span class="trend">${state.multTrend}</span>`;
  el.stageChip.textContent = `Stage ${curStage() + 1} · ${stageDef(curStage()).name}`;
  if (bumpMult) {
    el.mult.classList.remove('stat-bump');
    void el.mult.offsetWidth;
    el.mult.classList.add('stat-bump');
  }
}

function refreshPeek() {
  const clone = makeRng(refillRng.state());
  state.peek = refillQueue(clone, TYPES, state.favoured, 6);
  updatePeek();
}

function boardCenterPx() {
  const a = projCache[3][3], b = projCache[4][4];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function showGainPop(gain, bonus) {
  const p = boardCenterPx();
  const d = document.createElement('div');
  d.className = 'gain-pop';
  d.style.left = `${p.x}px`;
  d.style.top = `${p.y}px`;
  d.innerHTML = `+${gain.toLocaleString('en-US')}` +
    (bonus > 0 ? `<span class="bonus-tag">+${bonus} free-spirit bonus ✦</span>` : '');
  el.fx.appendChild(d);
  setTimeout(() => d.remove(), 1700);
}

function showWavePop(step, incoming, waveIndex, pts) {
  let sx = 0, sy = 0;
  for (const m of step.matches) { sx += projCache[m.r][m.c].x; sy += projCache[m.r][m.c].y; }
  const d = document.createElement('div');
  d.className = 'wave-pop';
  d.style.left = `${sx / step.matches.length}px`;
  d.style.top = `${sy / step.matches.length}px`;
  d.style.fontSize = `${Math.min(46, 20 + waveIndex * 7)}px`;
  d.textContent = waveIndex === 0 ? `+${pts.toLocaleString('en-US')}`
    : `CHAIN ×${cascadeFactor(waveIndex)}! +${pts.toLocaleString('en-US')}`;
  el.fx.appendChild(d);
  setTimeout(() => d.remove(), 1200);
}

function showBanner(title, sub) {
  el.banner.innerHTML = `<div class="stage-name">${title}</div><div class="stage-sub">${sub}</div>`;
  el.banner.hidden = false;
  el.banner.classList.remove('show');
  void el.banner.offsetWidth;
  el.banner.classList.add('show');
  setTimeout(() => { el.banner.hidden = true; el.banner.classList.remove('show'); }, 2700);
}

// ---------- stage dressing ----------
let worldTween = null;
function dressStage(idx, instant = false) {
  const def = stageDef(idx);
  const targets = {
    top: new THREE.Color(def.top), bot: new THREE.Color(def.bot),
    ground: new THREE.Color(def.ground), rim: new THREE.Color(def.rim),
    hemi: new THREE.Color(def.hemi), sun: new THREE.Color(def.sun),
    fog: new THREE.Color(def.top).lerp(new THREE.Color('#ffffff'), 0.55),
  };
  drawPanel(def.panel);
  if (instant) {
    skyUniforms.top.value.copy(targets.top);
    skyUniforms.bot.value.copy(targets.bot);
    groundMat.color.copy(targets.ground);
    rimMat.color.copy(targets.rim);
    hemi.color.copy(targets.hemi);
    sunLight.color.copy(targets.sun);
    scene.fog.color.copy(targets.fog);
    worldTween = null;
  } else {
    worldTween = {
      t: 0,
      from: {
        top: skyUniforms.top.value.clone(), bot: skyUniforms.bot.value.clone(),
        ground: groundMat.color.clone(), rim: rimMat.color.clone(),
        hemi: hemi.color.clone(), sun: sunLight.color.clone(), fog: scene.fog.color.clone(),
      },
      to: targets,
    };
  }
  applyFeaturedHalos();
}

async function stageTransition(newStage) {
  const def = stageDef(newStage);
  sfx.stage();
  el.flash.classList.remove('show');
  void el.flash.offsetWidth;
  el.flash.classList.add('show');
  showBanner(`Stage ${newStage + 1} — ${def.name}`,
    `${GEMS[def.featured].name} is HOT: ×${FEATURED_MULT} all stage!`);
  dressStage(newStage);
  updateLedger();
  await tween(900, () => {});
}

// ---------- move pipeline ----------
function dominantColour(matches, brd, moved) {
  const counts = new Map();
  for (const m of matches) {
    const t = brd[m.r][m.c];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  const movedT = brd[moved.r][moved.c];
  if (counts.get(movedT) === bestN) best = movedT;
  return best;
}

async function animateSwapMeshes(a, b) {
  const ga = meshGrid[a.r][a.c], gb = meshGrid[b.r][b.c];
  const pa = { x: cellX(a.c), y: cellY(a.r) }, pb = { x: cellX(b.c), y: cellY(b.r) };
  sfx.swap();
  await tween(160, (t) => {
    const e = easeInOut(t);
    ga.position.set(pa.x + (pb.x - pa.x) * e, pa.y + (pb.y - pa.y) * e, GEM_Z + Math.sin(e * Math.PI) * 0.45);
    gb.position.set(pb.x + (pa.x - pb.x) * e, pb.y + (pa.y - pb.y) * e, GEM_Z - Math.sin(e * Math.PI) * 0.2);
  });
  ga.position.set(pb.x, pb.y, GEM_Z);
  gb.position.set(pa.x, pa.y, GEM_Z);
  meshGrid[a.r][a.c] = gb;
  meshGrid[b.r][b.c] = ga;
}

// The rejected-swap wobble is non-blocking (the gate may fire a valid drag
// immediately after an invalid one); a token lets a real move cancel it cold.
let wobbleToken = 0;
let activeWobble = null;
function killWobble() {
  wobbleToken++;
  if (activeWobble) {
    for (const cell of [activeWobble.a, activeWobble.b]) {
      const g = meshGrid[cell.r]?.[cell.c];
      if (g) g.position.set(cellX(cell.c), cellY(cell.r), GEM_Z);
    }
    activeWobble = null;
  }
}
async function animateInvalid(a, b) {
  killWobble();
  const my = ++wobbleToken;
  activeWobble = { a, b };
  const ga = meshGrid[a.r][a.c], gb = meshGrid[b.r][b.c];
  const pa = { x: cellX(a.c), y: cellY(a.r) }, pb = { x: cellX(b.c), y: cellY(b.r) };
  sfx.invalid();
  await tween(240, (t) => {
    if (wobbleToken !== my) return;
    const e = Math.sin(t * Math.PI) * 0.42; // out and back home
    ga.position.set(pa.x + (pb.x - pa.x) * e, pa.y + (pb.y - pa.y) * e, GEM_Z + e * 0.3);
    gb.position.set(pb.x + (pa.x - pb.x) * e, pb.y + (pa.y - pb.y) * e, GEM_Z);
  });
  if (wobbleToken !== my) return;
  activeWobble = null;
  ga.position.set(pa.x, pa.y, GEM_Z);
  gb.position.set(pb.x, pb.y, GEM_Z);
}

async function animateClear(step, incoming, waveIndex) {
  const groups = step.matches.map((m) => meshGrid[m.r][m.c]).filter(Boolean);
  sfx.pop(waveIndex);
  if (waveIndex >= 2) shake = Math.min(0.35, 0.1 + waveIndex * 0.07);
  const wp = new THREE.Vector3();
  for (const m of step.matches) {
    const g = meshGrid[m.r][m.c];
    if (!g) continue;
    wp.setFromMatrixPosition(g.matrixWorld);
    // louder feedback the deeper the chain
    spawnBurst(wp, GEMS[incoming[m.r][m.c]].color, 5 + waveIndex * 5, 2.2 + waveIndex * 1.1);
  }
  await tween(220, (t) => {
    const s = t < 0.4 ? 1 + t * 1.1 : Math.max(0.001, (1 - t) / 0.6) * 1.44;
    for (const g of groups) {
      g.scale.setScalar(s);
      g.userData.spin.rotation.y += 0.25;
    }
  });
  for (const m of step.matches) {
    const g = meshGrid[m.r][m.c];
    if (g) { boardGroup.remove(g); meshGrid[m.r][m.c] = null; }
  }
}

async function animateDrop(step) {
  const falls = [];
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = ROWS - 1; r >= 0; r--) if (meshGrid[r][c]) survivors.push(meshGrid[r][c]);
    for (let r = 0; r < ROWS; r++) meshGrid[r][c] = null;
    // survivors settle to the bottom
    let r = ROWS - 1;
    for (const g of survivors) {
      meshGrid[r][c] = g;
      const targetY = cellY(r);
      if (Math.abs(g.position.y - targetY) > 1e-4) {
        falls.push({ g, fromY: g.position.y, toY: targetY });
      }
      r--;
    }
    // refills drop in from above the frame
    for (let rr = r; rr >= 0; rr--) {
      const g = makeGem(step.board[rr][c]);
      const startY = cellY(-1) + (r - rr + 1) * S;
      g.position.set(cellX(c), startY, GEM_Z);
      boardGroup.add(g);
      meshGrid[rr][c] = g;
      falls.push({ g, fromY: startY, toY: cellY(rr) });
    }
  }
  if (!falls.length) return;
  const jobs = falls.map(async (f) => {
    const dCells = Math.abs(f.fromY - f.toY) / S;
    const dur = Math.max(150, 165 * Math.sqrt(dCells)); // accelerating: t^2 per travel
    await tween(dur, (t) => {
      const e = easeIn(t);
      f.g.position.y = f.fromY + (f.toY - f.fromY) * e;
    });
    f.g.position.y = f.toY;
    // landing squash
    await tween(95, (t) => {
      const s = 1 - Math.sin(t * Math.PI) * 0.16;
      f.g.scale.set(1 + (1 - s) * 0.6, s, 1);
    });
    f.g.scale.set(1, 1, 1);
  });
  sfx.land();
  await Promise.all(jobs);
}

let moveEpoch = 0;
async function doMove(a, b, hintSnap) {
  const epoch = moveEpoch;
  state.animating = true;
  killWobble();
  clearHint();
  const swapped = applySwap(state.board, a, b);
  await animateSwapMeshes(a, b);
  if (epoch !== moveEpoch) return; // a New Game reset this move

  // the colour the player just actively cleared steers the winds (refill bias)
  const wave0 = findMatches(swapped);
  state.favoured = dominantColour(wave0, swapped, b);

  const { board: settled, steps } = collapse(swapped, refillRng, TYPES, state.favoured);

  // move tier: longest run across each wave's incoming board
  let maxRun = longestRun(swapped);
  for (let i = 0; i + 1 < steps.length; i++) maxRun = Math.max(maxRun, longestRun(steps[i].board));
  const prevMult = state.mult;
  state.mult = matchMultiplier(prevMult, maxRun);
  state.multTrend = state.mult > prevMult ? ' ↑' : state.mult < prevMult ? ' ↓' : '';

  // score + animate each wave in sequence
  const ft = featuredType();
  let total = 0;
  let incoming = swapped;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let raw = 0;
    const colours = new Set();
    for (const m of step.matches) {
      const t = incoming[m.r][m.c];
      colours.add(t);
      let v = gemValue(t, incoming);
      if (t === ft) v *= FEATURED_MULT;
      raw += v;
    }
    const pts = raw * cascadeFactor(i);
    total += pts;
    for (const t of colours) state.matchCounts[t]++;
    showWavePop(step, incoming, i, pts);
    await animateClear(step, incoming, i);
    if (epoch !== moveEpoch) return;
    await animateDrop(step);
    if (epoch !== moveEpoch) return;
    incoming = step.board;
  }
  state.board = settled;
  applyFeaturedHalos();

  const bonus = hintSnap && !samePair(hintSnap, { a, b }) ? DEVIATION_BONUS : 0;
  if (bonus) sfx.bonus();
  const gain = total * state.mult + bonus;
  state.lastBonus = bonus;
  state.lastGain = gain;
  const prevStage = curStage();
  state.score += gain;
  if (state.score > state.best) {
    state.best = state.score;
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* ok */ }
  }
  showGainPop(gain, bonus);
  updateStats(true);
  updateLedger();
  refreshPeek();

  const newStage = curStage();
  if (newStage !== prevStage) await stageTransition(newStage);

  if (!hasValidMove(state.board)) {
    state.gameOver = true;
    el.gameover.hidden = false;
    sfx.over();
  }
  state.lastActionTime = performance.now();
  state.animating = false;
}

function samePair(p, q) {
  const k = (m) => `${m.r},${m.c}`;
  const ps = [k(p.a), k(p.b)].sort().join('|');
  const qs = [k(q.a), k(q.b)].sort().join('|');
  return ps === qs;
}

// ---------- hint / idle ----------
function clearHint() {
  if (state.hint) {
    const g = meshGrid[state.hint.a.r]?.[state.hint.a.c];
    if (g) { g.userData.hintPulse = false; g.userData.spin.rotation.z = 0; }
  }
  state.hint = null;
}
setInterval(() => {
  if (state.hint || state.animating || state.gameOver) return;
  if (performance.now() - state.lastActionTime < 10000) return;
  const mv = findFirstValidMove(state.board);
  if (!mv) return;
  state.hint = mv;
  const g = meshGrid[mv.a.r]?.[mv.a.c];
  if (g) g.userData.hintPulse = true;
}, 400);

// ---------- pointer input ----------
let drag = null; // { mode: 'gem'|'cam', ... }

cellsEl.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.hitcell');
  if (!cell || state.animating || state.gameOver || drag) return;
  e.preventDefault();
  ac(); // warm audio on a user gesture
  const r = +cell.dataset.r, c = +cell.dataset.c;
  drag = {
    mode: 'gem', r, c, x0: e.clientX, y0: e.clientY, id: e.pointerId,
    hintSnap: state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null,
  };
  const g = meshGrid[r][c];
  if (g) g.scale.setScalar(1.14);
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
});

canvas.addEventListener('pointerdown', (e) => {
  if (drag) return;
  e.preventDefault();
  ac();
  drag = { mode: 'cam', x0: e.clientX, y0: e.clientY, th0: orbit.theta, ph0: orbit.phi, id: e.pointerId };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
});

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (drag.mode === 'cam') {
    orbit.theta = THREE.MathUtils.clamp(drag.th0 - dx * 0.005, -1.15, 1.15);
    orbit.phi = THREE.MathUtils.clamp(drag.ph0 - dy * 0.004, 0.62, 1.52);
    cellsDirty = true;
    return;
  }
  // nudge the grabbed gem toward the pointer (visual feel only)
  const g = meshGrid[drag.r][drag.c];
  if (!g) return;
  const cellPx = projCache[drag.r][drag.c].size || 50;
  const nx = THREE.MathUtils.clamp(dx / cellPx, -0.45, 0.45) * S;
  const ny = THREE.MathUtils.clamp(-dy / cellPx, -0.45, 0.45) * S;
  g.position.set(cellX(drag.c) + nx, cellY(drag.r) + ny, GEM_Z + 0.25);
}

function onDragEnd(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  if (d.mode === 'cam') return;

  const g = meshGrid[d.r][d.c];
  if (g) {
    g.scale.setScalar(1);
    g.position.set(cellX(d.c), cellY(d.r), GEM_Z);
  }
  if (state.animating || state.gameOver) return;

  // the gesture is decided by where it ENDS: released back home = no move
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  const len = Math.hypot(dx, dy);
  const threshold = (projCache[d.r][d.c].size || 50) * 0.35;
  if (len < threshold) return; // cancelled — out-and-back to origin

  // pick the orthogonal neighbour whose on-screen direction best matches the drag
  const origin = projCache[d.r][d.c];
  let best = null, bestDot = 0.35; // must clearly point at a neighbour
  for (const [nr, nc] of [[d.r - 1, d.c], [d.r + 1, d.c], [d.r, d.c - 1], [d.r, d.c + 1]]) {
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    const p = projCache[nr][nc];
    const vx = p.x - origin.x, vy = p.y - origin.y;
    const vlen = Math.hypot(vx, vy) || 1;
    const dot = (vx * dx + vy * dy) / (vlen * len);
    if (dot > bestDot) { bestDot = dot; best = { r: nr, c: nc }; }
  }
  if (!best) return;

  const a = { r: d.r, c: d.c }, b = best;
  if (isValidSwap(state.board, a, b)) {
    doMove(a, b, d.hintSnap);
  } else {
    animateInvalid(a, b); // non-blocking: a follow-up drag is never swallowed
  }
}

document.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * (e.deltaY > 0 ? 1.07 : 0.935), 0.62, 1.6);
  cellsDirty = true;
}, { passive: false });

// ---------- buttons ----------
document.getElementById('new-game').addEventListener('click', () => {
  newGame();
});
document.getElementById('reset-view').addEventListener('click', () => {
  const from = { th: orbit.theta, ph: orbit.phi, z: orbit.zoom };
  tween(350, (t) => {
    const e = easeInOut(t);
    orbit.theta = from.th + (ORBIT_DEFAULT.theta - from.th) * e;
    orbit.phi = from.ph + (ORBIT_DEFAULT.phi - from.ph) * e;
    orbit.zoom = from.z + (ORBIT_DEFAULT.zoom - from.z) * e;
    cellsDirty = true;
  });
});
document.getElementById('mute').addEventListener('click', (e) => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '🔇' : '🔊';
});

// ---------- game lifecycle ----------
function newGame() {
  moveEpoch++;   // abandon any in-flight move coroutine
  killWobble();
  clearHint();
  state.board = createBoard(ROWS, COLS, TYPES, boardRng);
  state.score = 0;
  state.mult = 1;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.favoured = null;
  state.matchCounts.fill(0);
  state.gameOver = false;
  state.animating = false;
  state.multTrend = '';
  state.lastActionTime = performance.now();
  el.gameover.hidden = true;
  refillRng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  buildMeshes();
  dressStage(0, true);
  refreshPeek();
  updateStats();
  updateLedger();
  cellsDirty = true;
}

// ---------- render loop ----------
let lastT = performance.now();
let warmupFrames = 12;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;

  // idle life: gems wobble-turn and bob, never leaving their slot
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const g = meshGrid[r]?.[c];
      if (!g) continue;
      const u = g.userData;
      u.spin.rotation.y = 0.42 * Math.sin(t * 0.9 + u.phase);
      u.spin.position.y = 0.045 * Math.sin(t * 1.6 + u.phase);
      if (u.type === 5) u.spin.rotation.z = t * 0.5 + u.phase;
      const hp = 1 + 0.1 * Math.sin(t * 4 + u.phase);
      u.halo.scale.setScalar(u.halo.visible ? hp : 1);
      if (u.hintPulse) {
        u.spin.rotation.z = 0.16 * Math.sin(t * 9);
        const s = 1 + 0.05 * Math.sin(t * 6);
        g.scale.setScalar(s);
      } else if (!drag || drag.mode !== 'gem' || drag.r !== r || drag.c !== c) {
        if (g.scale.x !== 1 && !state.animating) g.scale.setScalar(1);
      }
    }
  }

  // featured material pulse — the hot colour visibly glows
  const ft = featuredType();
  MATS.forEach((m, i) => {
    m.emissiveIntensity = i === ft ? 0.2 + 0.16 * Math.sin(t * 4) : BASE_EMISSIVE;
  });

  // environment life
  for (const cl of clouds) {
    cl.position.x += cl.userData.speed * dt;
    if (cl.position.x > 58) cl.position.x = -58;
  }
  for (const b of balloons) {
    const u = b.userData;
    b.position.y = u.y0 + Math.sin(t * u.rise + u.phase) * 1.6;
    b.position.x = u.x0 + Math.sin(t * 0.22 + u.phase) * 2.2;
    b.rotation.y = Math.sin(t * 0.3 + u.phase) * 0.2;
  }
  if (petals) {
    const pos = petals.geometry.attributes.position.array;
    const seed = petals.userData.seed;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3] = seed[i * 3] + Math.sin(t * 0.4 + i) * 1.4;
      pos[i * 3 + 1] = seed[i * 3 + 1] + Math.sin(t * 0.55 + i * 2.1) * 0.9;
    }
    petals.geometry.attributes.position.needsUpdate = true;
  }
  updateBursts(dt);

  // stage colour lerp
  if (worldTween) {
    worldTween.t = Math.min(1, worldTween.t + dt / 1.3);
    const e = easeInOut(worldTween.t);
    const { from, to } = worldTween;
    skyUniforms.top.value.lerpColors(from.top, to.top, e);
    skyUniforms.bot.value.lerpColors(from.bot, to.bot, e);
    groundMat.color.lerpColors(from.ground, to.ground, e);
    rimMat.color.lerpColors(from.rim, to.rim, e);
    hemi.color.lerpColors(from.hemi, to.hemi, e);
    sunLight.color.lerpColors(from.sun, to.sun, e);
    scene.fog.color.lerpColors(from.fog, to.fog, e);
    if (worldTween.t >= 1) worldTween = null;
  }

  applyCamera();
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 6);
  } else shake = 0;

  if (cellsDirty || warmupFrames > 0) {
    updateCells();
    cellsDirty = false;
    if (warmupFrames > 0) warmupFrames--;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
window.addEventListener('resize', fitCamera);
fitCamera();
newGame();
applyCamera();
boardGroup.updateMatrixWorld(true);
updateCells();
renderer.render(scene, camera);
requestAnimationFrame(frame);

// ---------- observation hooks for the gate ----------
window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.mult,
  gemValues: () => Array.from({ length: TYPES }, (_, t) => gemValue(t)),
  stage: () => stageForScore(state.score),
  featuredType: () => featuredType(),
  featuredMultiplier: () => FEATURED_MULT,
  favouredType: () => state.favoured,
  nextColours: () => state.peek.slice(),
  bestScore: () => state.best,
  validMove: () => findFirstValidMove(state.board),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
};
