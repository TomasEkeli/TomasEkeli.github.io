// Zephyr Gardens — 3D sky-island match-3.
// Logic is the pure 8x8 grid in game.js; this file renders it as a 3D world
// (three.js, vendored) with a DOM/CSS fallback when WebGL is unavailable,
// and wires input, sound, scoring, HUD and the window.__test hooks.

import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap, collapse,
  longestRun, matchMultiplier, stageForScore, typesForStage, cascadeFactor,
  refillQueue,
} from './game.js';

const ROWS = 8, COLS = 8;
const CELL = 1.12;
const GEM_Y = 0.46;
const CLEAR_MS = 180;

// ---------------------------------------------------------------------------
// Gem + theme definitions
// ---------------------------------------------------------------------------

const GEMS = [
  { name: 'Topaz',    colour: '#ffc93c' }, // sphere-ish icosahedron
  { name: 'Sapphire', colour: '#3d9bff' }, // octahedron (diamond)
  { name: 'Rose',     colour: '#ff5d8f' }, // cone (spire)
  { name: 'Jade',     colour: '#35d461' }, // torus (ring)
  { name: 'Amethyst', colour: '#a86bff' }, // cube
  { name: 'Coral',    colour: '#ff7a2f' }, // hex prism
];

const THEMES = [
  { name: 'Dawn Bloom',    skyTop: '#57c7f2', skyBot: '#dff6ff', ground: '#6fd18b',
    frame: '#ffb238', inlayA: '#d94f8e', inlayB: '#b83a76', sun: '#fff3c9' },
  { name: 'Noon Zenith',   skyTop: '#2f9fe8', skyBot: '#c8ecff', ground: '#52c979',
    frame: '#ff8a3d', inlayA: '#14b8a6', inlayB: '#0d9488', sun: '#ffffff' },
  { name: 'Golden Hour',   skyTop: '#ff9e5e', skyBot: '#ffe8bd', ground: '#e3a34f',
    frame: '#7c3aed', inlayA: '#2f6fed', inlayB: '#2358cc', sun: '#ffd27a' },
  { name: 'Blossom Winds', skyTop: '#ff8fb8', skyBot: '#ffe4ee', ground: '#7fdd9a',
    frame: '#0aa06c', inlayA: '#f43f5e', inlayB: '#d22646', sun: '#fff0f4' },
  { name: 'Emerald Vale',  skyTop: '#34d399', skyBot: '#d9fbe9', ground: '#3ba55c',
    frame: '#f59e0b', inlayA: '#7c3aed', inlayB: '#6527c9', sun: '#f8ffe0' },
  { name: 'Aurora Crown',  skyTop: '#60a5fa', skyBot: '#e3f2fe', ground: '#86efac',
    frame: '#ec4899', inlayA: '#f59e0b', inlayB: '#d47f06', sun: '#ffffff' },
];

const themeFor = (stage) => THEMES[stage % THEMES.length];

// ---------------------------------------------------------------------------
// Seedable rng with a previewable state (the peek must honestly forecast the
// exact colours collapse will draw next).
// ---------------------------------------------------------------------------

let rngState = ((Date.now() & 0xffffffff) ^ (Math.random() * 0xffffffff)) >>> 0;
function stepRng(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}
const rng = () => { const [s, v] = stepRng(rngState); rngState = s; return v; };
function previewRng() {
  let s = rngState;
  return () => { const [s2, v] = stepRng(s); s = s2; return v; };
}

// ---------------------------------------------------------------------------
// Sound — Web Audio, generated locally, created only after a user gesture.
// ---------------------------------------------------------------------------

const sound = {
  on: localStorage.getItem('zephyr-gardens-sound') !== 'off',
  ctx: null, master: null,
  ensure() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.on ? 0.55 : 0;
        this.master.connect(this.ctx.destination);
      } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  setOn(v) {
    this.on = v;
    localStorage.setItem('zephyr-gardens-sound', v ? 'on' : 'off');
    if (this.master) this.master.gain.value = v ? 0.55 : 0;
  },
  tone(freq, dur, { type = 'sine', gain = 0.16, when = 0, glide = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  swap()   { this.tone(300, 0.07, { type: 'triangle', gain: 0.08 }); },
  reject() { this.tone(120, 0.14, { type: 'sawtooth', gain: 0.08, glide: -50 }); },
  match(wave, cells) {
    // escalates: higher, brighter and louder as the cascade deepens
    const base = 320 * Math.pow(1.24, Math.min(wave, 9));
    const g = Math.min(0.3, 0.13 + wave * 0.035 + cells * 0.004);
    this.tone(base, 0.16, { type: 'triangle', gain: g });
    this.tone(base * 1.335, 0.16, { type: 'triangle', gain: g * 0.8, when: 0.05 });
    this.tone(base * 2, 0.2, { type: 'sine', gain: g * 0.6, when: 0.1 });
  },
  bonus() {
    this.tone(880, 0.1, { gain: 0.14 });
    this.tone(1174, 0.12, { gain: 0.14, when: 0.07 });
    this.tone(1568, 0.18, { gain: 0.12, when: 0.14 });
  },
  stageUp() {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this.tone(f, 0.28, { type: 'triangle', gain: 0.18, when: i * 0.09 }));
  },
  over() {
    this.tone(392, 0.3, { type: 'triangle', gain: 0.14 });
    this.tone(311, 0.4, { type: 'triangle', gain: 0.14, when: 0.22 });
    this.tone(233, 0.6, { type: 'triangle', gain: 0.14, when: 0.46 });
  },
};

// ---------------------------------------------------------------------------
// Game state + scoring
// ---------------------------------------------------------------------------

const state = {
  board: null,
  score: 0,
  best: Number(localStorage.getItem('zephyr-gardens-best') || 0) || 0,
  lastGain: 0,
  lastBonus: 0,
  multiplier: 1,
  stage: 0,
  favoured: null,
  peek: [],
  gameOver: false,
  animating: false,
  hint: null,
  matchCounts: [0, 0, 0, 0, 0, 0],
  gen: 0, // new-game generation; aborts in-flight moves
};

const featuredType = () => state.stage % typesForStage(state.stage);
const FEATURED_X = 3;

function countOnBoard(t) {
  let n = 0;
  for (const row of state.board) for (const v of row) if (v === t) n++;
  return n;
}

function gemValue(t, rarityCount) {
  switch (t) {
    case 0: return 5 * 2 ** Math.min(state.matchCounts[0], 7);       // cheap, exponential
    case 1: return 50;                                               // expensive, flat
    case 2: return 12 + 6 * state.matchCounts[2];                    // grows each match
    case 3: return Math.max(12, Math.round(400 / Math.max(1, rarityCount))); // rarer = richer
    case 4: return 15;                                               // steady
    case 5: return 10 * (state.stage + 1);                           // stage-scaled
    default: return 10;
  }
}

function currentGemValues() {
  const types = typesForStage(state.stage);
  return Array.from({ length: types }, (_, t) => gemValue(t, countOnBoard(t)));
}

function firstValidMove(board) {
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

const pairKey = (a, b) => {
  const k1 = `${a.r},${a.c}`, k2 = `${b.r},${b.c}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
};

function refreshPeek() {
  state.peek = refillQueue(previewRng(), typesForStage(state.stage), state.favoured, 6);
}

// ---------------------------------------------------------------------------
// Wave motion helper (shared by both renderers): who falls where, what spawns
// ---------------------------------------------------------------------------

function waveMotion(matches, afterBoard) {
  const cleared = new Set(matches.map((m) => m.r * COLS + m.c));
  const moves = [], spawns = [];
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = 0; r < ROWS; r++) if (!cleared.has(r * COLS + c)) survivors.push(r);
    const spawnCount = ROWS - survivors.length;
    survivors.forEach((rSrc, i) => {
      const rDst = spawnCount + i;
      if (rDst !== rSrc) moves.push({ c, from: rSrc, to: rDst });
    });
    for (let r = 0; r < spawnCount; r++) {
      spawns.push({ c, to: r, type: afterBoard[r][c], depth: spawnCount - r });
    }
  }
  return { moves, spawns };
}

const dropDur = (dist) => Math.min(300, 130 + 55 * dist);

// ---------------------------------------------------------------------------
// WebGL renderer (three.js)
// ---------------------------------------------------------------------------

function createGLRenderer(host, onView) {
  let gl;
  try {
    gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    if (!gl.getContext()) throw new Error('no context');
  } catch {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
  const cam = { yaw: 0, phi: 0.68, zoom: 1, base: 14 };
  const DEFAULTS = { yaw: 0, phi: 0.68, zoom: 1 };
  let dirty = true;

  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(gl.domElement);

  // --- lights
  const hemi = new THREE.HemisphereLight(0xbfe8ff, 0x7a9a5a, 0.9);
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.1);
  sun.position.set(7, 12, 5);
  const rim = new THREE.DirectionalLight(0xcfeaff, 0.8); // cool glint from the front
  rim.position.set(-5, 6, 9);
  const amb = new THREE.AmbientLight(0xffffff, 0.32);
  scene.add(hemi, sun, rim, amb);

  // --- sky dome (vertex-coloured gradient)
  const skyGeo = new THREE.SphereGeometry(120, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  function paintSky(top, bot) {
    const pos = skyGeo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(top), cBot = new THREE.Color(bot), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 120 * 0.5 + 0.5, 0, 1);
      tmp.copy(cBot).lerp(cTop, Math.pow(t, 0.75));
      cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }

  // --- sun disc
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff3c9 }));
  sunBall.position.set(34, 42, -70);
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff3c9, transparent: true, opacity: 0.28 }));
  sunGlow.position.copy(sunBall.position);
  scene.add(sunBall, sunGlow);

  // --- the board floats on its own sky island (small, so the sky stays visible)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x6fd18b, roughness: 0.9, flatShading: true });
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 7.6, 1.6, 18), groundMat);
  ground.position.y = -1.55;
  scene.add(ground);
  const islandRock = new THREE.Mesh(
    new THREE.ConeGeometry(7.4, 7.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x8d6b47, roughness: 0.95, flatShading: true }));
  islandRock.rotation.x = Math.PI;
  islandRock.position.y = -6.1;
  scene.add(islandRock);
  // a ring of little trees around the island edge (clearly trees, not gems)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f9e50, roughness: 0.85, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 6), trunkMat);
    trunk.position.y = 0.25;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0 + (i % 3) * 0.25, 7), leafMat);
    crown.position.y = 0.95;
    tree.add(trunk, crown);
    tree.position.set(Math.cos(a) * 7.5, -0.85, Math.sin(a) * 7.5);
    scene.add(tree);
  }

  // --- drifting clouds
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.6, 10, 8), cloudMat);
      puff.position.set(k * 2.1 - 2 + Math.random(), Math.random() * 0.7, Math.random() * 1.4);
      puff.scale.y = 0.55;
      g.add(puff);
    }
    g.position.set(-60 + Math.random() * 120,
      i < 4 ? 3 + Math.random() * 6 : 10 + Math.random() * 20,   // a few low, behind the island
      i < 4 ? -34 + Math.random() * 12 : -55 + Math.random() * 70);
    g.userData.speed = 0.6 + Math.random() * 0.9;
    clouds.push(g); scene.add(g);
  }

  // --- floating islands
  const islands = [];
  function island(x, y, z, s) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(2.4 * s, 3.4 * s, 7),
      new THREE.MeshStandardMaterial({ color: 0x9c7a54, roughness: 0.9, flatShading: true }));
    rock.rotation.x = Math.PI;
    rock.position.y = -1.7 * s;
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5 * s, 2.2 * s, 0.7 * s, 9),
      new THREE.MeshStandardMaterial({ color: 0x58c96b, roughness: 0.85, flatShading: true }));
    const tree = new THREE.Mesh(
      new THREE.ConeGeometry(0.7 * s, 1.6 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f9e50, roughness: 0.8, flatShading: true }));
    tree.position.set(0.9 * s, 1.1 * s, 0.3 * s);
    g.add(rock, grass, tree);
    g.position.set(x, y, z);
    g.userData = { y0: y, phase: Math.random() * 6.28 };
    islands.push(g); scene.add(g);
  }
  island(-27, 1, -30, 2.0); island(24, 5, -34, 1.5); island(-32, 8, -10, 1.1);
  island(33, 0, -14, 1.3); island(12, 11, -46, 1.8);

  // --- the board: gold frame + vivid lacquer inlays
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xffb238, metalness: 0.45, roughness: 0.28,
    emissive: 0x5a3a00, emissiveIntensity: 0.55,
  });
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(COLS * CELL + 1.0, 0.72, ROWS * CELL + 1.0), frameMat);
  frame.position.y = -0.38;
  boardGroup.add(frame);
  const inlayMatA = new THREE.MeshStandardMaterial({ color: 0xd94f8e, roughness: 0.35, metalness: 0.1 });
  const inlayMatB = new THREE.MeshStandardMaterial({ color: 0xb83a76, roughness: 0.35, metalness: 0.1 });
  const inlayGeo = new THREE.BoxGeometry(CELL * 0.96, 0.14, CELL * 0.96);
  const X = (c) => (c - (COLS - 1) / 2) * CELL;
  const Z = (r) => (r - (ROWS - 1) / 2) * CELL;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = new THREE.Mesh(inlayGeo, (r + c) % 2 ? inlayMatB : inlayMatA);
      m.position.set(X(c), 0.02, Z(r));
      boardGroup.add(m);
    }
  }

  // --- gem geometry + materials
  const geos = [
    new THREE.IcosahedronGeometry(0.46, 0),
    new THREE.OctahedronGeometry(0.52, 0),
    new THREE.ConeGeometry(0.4, 0.86, 6),
    new THREE.TorusGeometry(0.34, 0.155, 8, 14),
    new THREE.BoxGeometry(0.64, 0.64, 0.64),
    new THREE.CylinderGeometry(0.45, 0.45, 0.5, 6),
  ];
  const mats = GEMS.map((g) => new THREE.MeshPhysicalMaterial({
    color: g.colour, roughness: 0.16, metalness: 0.15,
    clearcoat: 0.9, clearcoatRoughness: 0.25,
    emissive: new THREE.Color(g.colour).multiplyScalar(0.28),
    flatShading: true,
  }));

  let gems = grid(null);
  function grid(v) { return Array.from({ length: ROWS }, () => new Array(COLS).fill(v)); }

  function makeGem(type, r, c) {
    const m = new THREE.Mesh(geos[type], mats[type]);
    if (type === 3) m.rotation.x = Math.PI / 2; // ring lies flat
    m.position.set(X(c), GEM_Y, Z(r));
    m.userData = {
      type, r, c, busy: false, lift: 0, nx: 0, nz: 0,
      spin: 0.35 + Math.random() * 0.5, phase: Math.random() * 6.28,
    };
    boardGroup.add(m);
    return m;
  }

  // --- particles
  const P_MAX = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(P_MAX * 3);
  const pCol = new Float32Array(P_MAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pVel = new Float32Array(P_MAX * 3);
  const pLife = new Float32Array(P_MAX);
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  let pNext = 0;
  function burst(x, y, z, colour, n, spread = 2.6) {
    const col = new THREE.Color(colour);
    for (let i = 0; i < n; i++) {
      const j = pNext = (pNext + 1) % P_MAX;
      pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z;
      pVel[j * 3] = (Math.random() - 0.5) * spread;
      pVel[j * 3 + 1] = Math.random() * spread * 0.9 + 0.6;
      pVel[j * 3 + 2] = (Math.random() - 0.5) * spread;
      pCol[j * 3] = col.r; pCol[j * 3 + 1] = col.g; pCol[j * 3 + 2] = col.b;
      pLife[j] = 0.7 + Math.random() * 0.4;
    }
    // Upload the new particle colours to the GPU — without this the colour
    // buffer keeps its initial all-zero (black) values and sparks render black.
    pGeo.attributes.color.needsUpdate = true;
  }
  // ambient drifting motes
  for (let i = 0; i < 40; i++) {
    const j = pNext = (pNext + 1) % P_MAX;
    pPos[j * 3] = (Math.random() - 0.5) * 18;
    pPos[j * 3 + 1] = Math.random() * 6;
    pPos[j * 3 + 2] = (Math.random() - 0.5) * 18;
    pVel[j * 3] = 0; pVel[j * 3 + 1] = 0.25; pVel[j * 3 + 2] = 0;
    pCol[j * 3] = 1; pCol[j * 3 + 1] = 1; pCol[j * 3 + 2] = 0.85;
    pLife[j] = 3 + Math.random() * 5;
  }

  // --- tweens
  const tweens = new Set();
  function tween(dur, fn) {
    return new Promise((res) => {
      const tw = { t0: performance.now(), dur, fn, res };
      tweens.add(tw);
    });
  }
  const easeInQuad = (t) => t * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2);

  // --- camera
  function fitBase() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    const aspect = w / h;
    const half = Math.tan((46 * Math.PI) / 360);
    const dv = 5.3 / half;
    const dh = 6.0 / (half * aspect);
    cam.base = Math.min(34, Math.max(dv, dh) * 1.1);
  }
  function applyCamera() {
    const d = cam.base * cam.zoom;
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    camera.position.set(d * sp * Math.sin(cam.yaw), d * cp, d * sp * Math.cos(cam.yaw));
    camera.position.y = Math.max(camera.position.y, 1.2); // never dip under the world
    camera.lookAt(0, 0.1, 0);
  }
  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    gl.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitBase();
    dirty = true;
  }
  window.addEventListener('resize', resize);
  resize();
  applyCamera();

  function cellRects() {
    const w2 = gl.domElement.clientWidth / 2, h2 = gl.domElement.clientHeight / 2;
    const v = new THREE.Vector3();
    const px = [];
    for (let r = 0; r < ROWS; r++) {
      px.push([]);
      for (let c = 0; c < COLS; c++) {
        v.set(X(c), GEM_Y, Z(r)).project(camera);
        px[r].push({ x: v.x * w2 + w2, y: -v.y * h2 + h2 });
      }
    }
    const rects = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = px[r][c];
        const nH = px[r][c < COLS - 1 ? c + 1 : c - 1];
        const nV = px[r < ROWS - 1 ? r + 1 : r - 1][c];
        rects.push({
          cx: p.x, cy: p.y,
          w: Math.hypot(nH.x - p.x, nH.y - p.y) * 0.92,
          h: Math.hypot(nV.x - p.x, nV.y - p.y) * 0.92,
        });
      }
    }
    return rects;
  }

  // --- render loop
  let last = performance.now();
  let viewTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    for (const tw of tweens) {
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(k);
      if (k >= 1) { tweens.delete(tw); tw.res(); }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = gems[r][c];
        if (!m) continue;
        const u = m.userData;
        if (u.type !== 3) u.spinAngle = (m.rotation.y += u.spin * dt);
        else m.rotation.z += u.spin * dt;
        if (!u.busy) {
          m.position.x = X(c) + u.nx * CELL;
          m.position.z = Z(r) + u.nz * CELL;
          m.position.y = GEM_Y + Math.sin(t * 1.7 + u.phase) * 0.05 + u.lift;
        }
      }
    }

    for (const g of clouds) {
      g.position.x += g.userData.speed * dt;
      if (g.position.x > 70) g.position.x = -70;
    }
    for (const g of islands) {
      g.position.y = g.userData.y0 + Math.sin(t * 0.5 + g.userData.phase) * 0.5;
    }

    // particles
    let any = false;
    for (let j = 0; j < P_MAX; j++) {
      if (pLife[j] <= 0) continue;
      any = true;
      pLife[j] -= dt;
      pVel[j * 3 + 1] -= 2.2 * dt;
      pPos[j * 3] += pVel[j * 3] * dt;
      pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt;
      pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
      if (pLife[j] <= 0) pPos[j * 3 + 1] = -999;
    }
    if (any) pGeo.attributes.position.needsUpdate = true;

    applyCamera();
    viewTimer += dt;
    if (dirty || viewTimer > 0.4) {
      dirty = false; viewTimer = 0;
      onView(cellRects());
    }
    gl.render(scene, camera);
  }
  requestAnimationFrame(loop);

  // --- renderer interface
  return {
    kind: 'webgl',
    setTheme(stage) {
      const th = themeFor(stage);
      paintSky(th.skyTop, th.skyBot);
      groundMat.color.set(th.ground);
      frameMat.color.set(th.frame);
      inlayMatA.color.set(th.inlayA);
      inlayMatB.color.set(th.inlayB);
      sunBall.material.color.set(th.sun);
      sunGlow.material.color.set(th.sun);
      hemi.color.set(th.skyTop).lerp(new THREE.Color('#ffffff'), 0.5);
    },
    setBoard(board) {
      for (const row of gems) for (const m of row) if (m) boardGroup.remove(m);
      gems = grid(null);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) gems[r][c] = makeGem(board[r][c], r, c);
      dirty = true;
    },
    setGrab(cell, on) {
      const m = cell && gems[cell.r][cell.c];
      if (m) m.userData.lift = on ? 0.28 : 0;
    },
    setNudge(cell, fx, fz) {
      if (!cell) {
        for (const row of gems) for (const m of row) if (m) { m.userData.nx = 0; m.userData.nz = 0; m.userData.lift = 0; }
        return;
      }
      const m = gems[cell.r][cell.c];
      if (m) { m.userData.nx = fx; m.userData.nz = fz; }
    },
    async animateSwap(a, b) {
      const ma = gems[a.r][a.c], mb = gems[b.r][b.c];
      if (!ma || !mb) return;
      ma.userData.busy = mb.userData.busy = true;
      ma.userData.nx = ma.userData.nz = mb.userData.nx = mb.userData.nz = 0;
      const A = { x: X(a.c), z: Z(a.r) }, B = { x: X(b.c), z: Z(b.r) };
      await tween(140, (k) => {
        const e = easeInOut(k);
        ma.position.x = A.x + (B.x - A.x) * e; ma.position.z = A.z + (B.z - A.z) * e;
        ma.position.y = GEM_Y + Math.sin(e * Math.PI) * 0.35;
        mb.position.x = B.x + (A.x - B.x) * e; mb.position.z = B.z + (A.z - B.z) * e;
      });
      gems[a.r][a.c] = mb; gems[b.r][b.c] = ma;
      ma.userData.r = b.r; ma.userData.c = b.c;
      mb.userData.r = a.r; mb.userData.c = a.c;
      ma.userData.busy = mb.userData.busy = false;
    },
    async animateReject(a, b) {
      const ma = gems[a.r][a.c], mb = gems[b.r][b.c];
      if (!ma || !mb) return;
      ma.userData.busy = mb.userData.busy = true;
      const A = { x: X(a.c), z: Z(a.r) }, B = { x: X(b.c), z: Z(b.r) };
      await tween(200, (k) => {
        const e = Math.sin(k * Math.PI) * 0.38;
        ma.position.x = A.x + (B.x - A.x) * e; ma.position.z = A.z + (B.z - A.z) * e;
        mb.position.x = B.x + (A.x - B.x) * e; mb.position.z = B.z + (A.z - B.z) * e;
      });
      ma.userData.busy = mb.userData.busy = false;
    },
    async animateWave(matches, afterBoard, waveIndex) {
      // 1) clear: pop + burst
      const clearing = [];
      for (const { r, c } of matches) {
        const m = gems[r][c];
        if (!m) continue;
        m.userData.busy = true;
        clearing.push(m);
        burst(m.position.x, m.position.y + 0.2, m.position.z,
          GEMS[m.userData.type].colour, 10 + waveIndex * 4);
        gems[r][c] = null;
      }
      await tween(CLEAR_MS, (k) => {
        const s = k < 0.35 ? 1 + k * 1.1 : Math.max(0.001, 1.38 * (1 - (k - 0.35) / 0.65));
        for (const m of clearing) { m.scale.setScalar(s); m.rotation.y += 0.25; }
      });
      for (const m of clearing) boardGroup.remove(m);

      // 2) drop: survivors slide down the board; refills fall from the sky
      const { moves, spawns } = waveMotion(matches, afterBoard);
      const newGems = grid(null);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (gems[r][c]) newGems[r][c] = gems[r][c];
      const jobs = [];
      // stage all movers first (read sources before any destination is written)
      const staged = moves.map((mv) => ({ mv, m: gems[mv.from][mv.c] }));
      for (const { mv } of staged) newGems[mv.from][mv.c] = null;
      for (const { mv, m } of staged) {
        newGems[mv.to][mv.c] = m;
        m.userData.busy = true;
        m.userData.r = mv.to;
        const z0 = Z(mv.from), z1 = Z(mv.to);
        jobs.push(tween(dropDur(mv.to - mv.from), (k) => {
          m.position.z = z0 + (z1 - z0) * easeInQuad(k);
        }).then(() => { m.userData.busy = false; }));
      }
      for (const sp of spawns) {
        const m = makeGem(sp.type, sp.to, sp.c);
        newGems[sp.to][sp.c] = m;
        m.userData.busy = true;
        const y0 = GEM_Y + 2.6 + sp.depth * 1.0;
        m.position.y = y0;
        jobs.push(tween(dropDur(sp.depth + 1), (k) => {
          m.position.y = y0 + (GEM_Y - y0) * easeInQuad(k);
        }).then(() => { m.userData.busy = false; }));
      }
      gems = newGems;
      await Promise.all(jobs);
      // small landing sparkle for deep cascades
      if (waveIndex >= 1) burst(0, GEM_Y + 0.4, 0, '#ffffff', 12 + waveIndex * 6, 4);
    },
    setHintGem() { /* hint is drawn on the DOM hit-cell */ },
    orbit(dYaw, dPhi) {
      cam.yaw += dYaw;
      cam.phi = THREE.MathUtils.clamp(cam.phi + dPhi, 0.07, 1.42);
      dirty = true;
    },
    zoom(f) {
      cam.zoom = THREE.MathUtils.clamp(cam.zoom * f, 0.55, 1.9);
      dirty = true;
    },
    resetView() {
      Object.assign(cam, DEFAULTS);
      dirty = true;
    },
    refreshView() { dirty = true; },
  };
}

// ---------------------------------------------------------------------------
// DOM/CSS fallback renderer (same interface; used when WebGL can't start)
// ---------------------------------------------------------------------------

function createDOMRenderer(onView) {
  const host = document.getElementById('fallback');
  host.classList.add('active');
  host.querySelectorAll('*').forEach((el) => { el.style.pointerEvents = 'none'; });
  const boardEl = document.getElementById('fbBoard');
  const view = { tilt: 24, yaw: 0, zoom: 1 };
  let size = 0, cell = 0, pad = 0;
  let gems = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));

  // clouds
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('div');
    c.className = 'fbCloud';
    c.style.cssText = `top:${4 + i * 9}%; left:${(i * 23) % 90}%; width:${90 + i * 30}px; height:${26 + i * 6}px;
      animation-duration:${46 + i * 17}s; animation-delay:-${i * 9}s; pointer-events:none;`;
    host.appendChild(c);
  }

  function layout() {
    size = Math.min(innerWidth * 0.9, innerHeight * 0.6);
    cell = size / COLS;
    pad = Math.max(8, cell * 0.16);
    boardEl.style.width = `${size + pad * 2}px`;
    boardEl.style.height = `${size + pad * 2}px`;
    boardEl.innerHTML = '';
    const th = themeFor(state.stage);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const s = document.createElement('div');
        s.className = 'fbSlot';
        s.style.cssText = `left:${pad + c * cell + cell * 0.02}px; top:${pad + r * cell + cell * 0.02}px;
          width:${cell * 0.96}px; height:${cell * 0.96}px;
          background:${(r + c) % 2 ? th.inlayB : th.inlayA}; pointer-events:none;`;
        boardEl.appendChild(s);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const g = gems[r][c];
        if (!g) continue;
        g.style.width = `${cell * 0.84}px`;
        g.style.height = `${cell * 0.84}px`;
        boardEl.appendChild(g); // layout wiped the board's children
        place(g, r, c, true);
      }
    }
    queueView();
  }

  function applyView() {
    boardEl.style.setProperty('--fbTilt', `${view.tilt}deg`);
    boardEl.style.transform =
      `rotateX(${view.tilt}deg) rotateY(${view.yaw}deg) scale(${view.zoom})`;
    queueView();
  }

  let viewQueued = false;
  function queueView() {
    if (viewQueued) return;
    viewQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      viewQueued = false;
      const rects = [];
      const slots = boardEl.querySelectorAll('.fbSlot');
      slots.forEach((s) => {
        const b = s.getBoundingClientRect();
        rects.push({ cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width * 0.94, h: b.height * 0.94 });
      });
      if (rects.length === ROWS * COLS) onView(rects);
    }));
  }

  function gemEl(type) {
    const g = document.createElement('div');
    g.className = 'fbGem';
    const body = document.createElement('div');
    body.className = `body shape-${type}`;
    body.style.setProperty('--gc', GEMS[type].colour);
    body.style.filter = 'drop-shadow(0 3px 4px rgba(20,40,70,.4))';
    g.appendChild(body);
    g.dataset.type = String(type);
    g.style.width = `${cell * 0.84}px`;
    g.style.height = `${cell * 0.84}px`;
    g.style.pointerEvents = 'none';
    boardEl.appendChild(g);
    return g;
  }
  function place(g, r, c, instant) {
    if (instant) g.style.transition = 'none';
    g.style.left = `${pad + c * cell + cell * 0.08}px`;
    g.style.top = `${pad + r * cell + cell * 0.08}px`;
    if (instant) requestAnimationFrame(() => { g.style.transition = ''; });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.addEventListener('resize', layout);
  layout();
  applyView();

  return {
    kind: 'dom',
    setTheme(stage) {
      const th = themeFor(stage);
      host.style.setProperty('--skyTop', th.skyTop);
      host.style.setProperty('--skyBot', th.skyBot);
      host.style.setProperty('--ground', th.ground);
      host.style.setProperty('--boardFrame', th.frame);
      layout();
    },
    setBoard(board) {
      for (const row of gems) for (const g of row) if (g) g.remove();
      gems = gems.map(() => new Array(COLS).fill(null));
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const g = gemEl(board[r][c]);
          place(g, r, c, true);
          gems[r][c] = g;
        }
      }
      queueView();
    },
    setGrab(cell, on) {
      const g = cell && gems[cell.r][cell.c];
      if (g) g.style.zIndex = on ? '3' : '';
    },
    setNudge(cell, fx, fz) {
      if (!cell) {
        for (const row of gems) for (const g of row) if (g) g.style.transform = '';
        return;
      }
      const g = gems[cell.r][cell.c];
      if (g) g.style.transform = `translate(${fx * cell}px, ${fz * cell}px) scale(1.08)`;
    },
    async animateSwap(a, b) {
      const ga = gems[a.r][a.c], gb = gems[b.r][b.c];
      if (!ga || !gb) return;
      ga.style.transform = gb.style.transform = '';
      ga.style.transition = gb.style.transition = 'left 140ms ease, top 140ms ease';
      place(ga, b.r, b.c); place(gb, a.r, a.c);
      await sleep(150);
      ga.style.transition = gb.style.transition = '';
      gems[a.r][a.c] = gb; gems[b.r][b.c] = ga;
    },
    async animateReject(a, b) {
      const ga = gems[a.r][a.c], gb = gems[b.r][b.c];
      if (!ga || !gb) return;
      const dx = (b.c - a.c) * cell * 0.35, dy = (b.r - a.r) * cell * 0.35;
      ga.style.transition = gb.style.transition = 'transform 100ms ease';
      ga.style.transform = `translate(${dx}px, ${dy}px)`;
      gb.style.transform = `translate(${-dx}px, ${-dy}px)`;
      await sleep(105);
      ga.style.transform = gb.style.transform = '';
      await sleep(105);
      ga.style.transition = gb.style.transition = '';
    },
    async animateWave(matches, afterBoard, waveIndex) {
      for (const { r, c } of matches) {
        const g = gems[r][c];
        if (g) g.classList.add('clearing');
      }
      await sleep(CLEAR_MS);
      for (const { r, c } of matches) {
        const g = gems[r][c];
        if (g) { g.remove(); gems[r][c] = null; }
      }
      const { moves, spawns } = waveMotion(matches, afterBoard);
      const newGems = gems.map((row) => [...row]);
      let maxDur = 0;
      // stage all movers first (read sources before any destination is written)
      const staged = moves.map((mv) => ({ mv, g: gems[mv.from][mv.c] }));
      for (const { mv } of staged) newGems[mv.from][mv.c] = null;
      for (const { mv, g } of staged) {
        newGems[mv.to][mv.c] = g;
        const dur = dropDur(mv.to - mv.from);
        maxDur = Math.max(maxDur, dur);
        g.style.transition = `top ${dur}ms cubic-bezier(.55,0,1,.45)`;
        place(g, mv.to, mv.c);
      }
      for (const sp of spawns) {
        const g = gemEl(sp.type);
        g.style.transition = 'none';
        g.style.left = `${pad + sp.c * cell + cell * 0.08}px`;
        g.style.top = `${pad - (sp.depth) * cell}px`;
        newGems[sp.to][sp.c] = g;
        const dur = dropDur(sp.depth + 1);
        maxDur = Math.max(maxDur, dur);
        requestAnimationFrame(() => {
          g.style.transition = `top ${dur}ms cubic-bezier(.55,0,1,.45)`;
          place(g, sp.to, sp.c);
        });
      }
      gems = newGems;
      await sleep(maxDur + 40);
      for (const row of gems) for (const g of row) if (g) g.style.transition = '';
    },
    setHintGem() {},
    orbit(dYaw, dPhi) {
      view.yaw = Math.max(-30, Math.min(30, view.yaw + dYaw * 57.3));
      view.tilt = Math.max(-28, Math.min(62, view.tilt + dPhi * 57.3));
      applyView();
    },
    zoom(f) {
      view.zoom = Math.max(0.6, Math.min(1.7, view.zoom * f));
      applyView();
    },
    resetView() {
      view.tilt = 24; view.yaw = 0; view.zoom = 1;
      applyView();
    },
    refreshView() { queueView(); },
  };
}

// ---------------------------------------------------------------------------
// Hit cells (the 64 data-testid="cell" handles the gate drags)
// ---------------------------------------------------------------------------

const cellsHost = document.getElementById('cells');
const hitcells = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.className = 'hitcell';
    d.dataset.testid = 'cell';
    d.setAttribute('data-testid', 'cell');
    d.dataset.r = String(r);
    d.dataset.c = String(c);
    const ring = document.createElement('div');
    ring.className = 'hintring';
    d.appendChild(ring);
    cellsHost.appendChild(d);
    hitcells.push(d);
  }
}
let lastRects = null;
function applyRects(rects) {
  // Snap near-equal rows/columns to exact alignment so a strict sort by
  // (screen y, then x) always yields clean row-major order at the default view.
  for (let r = 0; r < ROWS; r++) {
    const row = rects.slice(r * COLS, r * COLS + COLS);
    const ys = row.map((b) => b.cy);
    if (Math.max(...ys) - Math.min(...ys) < 3) {
      const mean = ys.reduce((a, b) => a + b, 0) / COLS;
      const meanH = row.reduce((a, b) => a + b.h, 0) / COLS;
      for (const b of row) { b.cy = mean; b.h = meanH; }
    }
  }
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = 0; r < ROWS; r++) col.push(rects[r * COLS + c]);
    const xs = col.map((b) => b.cx);
    if (Math.max(...xs) - Math.min(...xs) < 3) {
      const mean = xs.reduce((a, b) => a + b, 0) / ROWS;
      for (const b of col) b.cx = mean;
    }
  }
  lastRects = rects;
  for (let i = 0; i < rects.length; i++) {
    const { cx, cy, w, h } = rects[i];
    const el = hitcells[i];
    el.style.left = `${cx - w / 2}px`;
    el.style.top = `${cy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }
}

// ---------------------------------------------------------------------------
// Renderer boot (WebGL, falling back to DOM/CSS)
// ---------------------------------------------------------------------------

let renderer = createGLRenderer(document.getElementById('scene'), applyRects);
if (!renderer) renderer = createDOMRenderer(applyRects);

// ---------------------------------------------------------------------------
// HUD / readout / fx
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const scoreEl = $('score'), bestTopEl = $('bestTop');
const multPill = $('multPill'), hotPill = $('hotPill'), luckyPill = $('luckyPill'), peekPill = $('peekPill');
const fx = $('fx'), banner = $('banner'), flash = $('flash'), gameoverEl = $('gameover');
const newGameBtn = $('newGame'), soundBtn = $('soundToggle'), resetViewBtn = $('resetView');
const hud = $('hud'), hudToggle = $('hudToggle');

function chipHTML(t, size = 13) {
  return `<i class="chip shape-${t}" style="--gc:${GEMS[t].colour}; width:${size}px; height:${size}px"></i>`;
}

function updateReadout() {
  scoreEl.textContent = state.score.toLocaleString('en-US');
  bestTopEl.textContent = `BEST ${state.best.toLocaleString('en-US')}`;
  multPill.textContent = `×${state.multiplier}`;
  const f = featuredType();
  hotPill.innerHTML = `${chipHTML(f)} HOT ×${FEATURED_X}`;
  luckyPill.innerHTML = state.favoured == null
    ? 'LUCKY —' : `LUCKY ${chipHTML(state.favoured)}`;
  peekPill.innerHTML = `NEXT ${state.peek.slice(0, 4).map((t) => chipHTML(t, 11)).join('')}`;
}

function updateHud() {
  const types = typesForStage(state.stage);
  const values = currentGemValues();
  const f = featuredType();
  const th = themeFor(state.stage);
  const schemes = [
    'doubles each match', 'flat & fancy', 'grows each match',
    'rarer = richer', 'steady', 'scales with stage',
  ];
  $('ledger').innerHTML = Array.from({ length: types }, (_, t) => `
    <div class="ledger-row">${chipHTML(t, 17)}
      <span>${GEMS[t].name}</span>
      ${t === f ? '<span class="tag hot">HOT ×' + FEATURED_X + '</span>' : ''}
      ${t === state.favoured ? '<span class="tag lucky">LUCKY</span>' : ''}
      <span class="val">${values[t]}${t === f ? ' <small>→ ' + values[t] * FEATURED_X + '</small>' : ''}</span>
    </div>
    <div class="note">${schemes[t]}</div>`).join('');
  $('peekRow').innerHTML = state.peek.map((t) => chipHTML(t, 18)).join('');
  $('multLine').innerHTML = `<span>Current multiplier</span><span class="val">×${state.multiplier}</span>`;
  $('stageLine').innerHTML =
    `<span>Stage ${state.stage} — ${th.name}</span><span class="val">${(state.stage + 1) * 100000 - state.score} to next</span>`;
  $('bestLine').innerHTML = `<span>Best score</span><span class="val">${state.best.toLocaleString('en-US')}</span>`;
  updateReadout();
}

function showGain(gain, bonus) {
  const d = document.createElement('div');
  d.className = 'gainpop';
  d.innerHTML = `<span class="n">+${gain.toLocaleString('en-US')}</span>` +
    (bonus ? `<span class="b">+${bonus} free spirit bonus!</span>` : '');
  fx.appendChild(d);
  setTimeout(() => d.remove(), 1600);
}

function showCascade(waveIndex) {
  const d = document.createElement('div');
  d.className = 'cascadetag';
  d.textContent = `CASCADE ×${cascadeFactor(waveIndex)}`;
  d.style.top = `${52 + waveIndex * 4}%`;
  fx.appendChild(d);
  setTimeout(() => d.remove(), 750);
}

function showBanner(big, sub) {
  banner.querySelector('.big').textContent = big;
  banner.querySelector('.sub').textContent = sub;
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  flash.classList.remove('show');
  void flash.offsetWidth;
  flash.classList.add('show');
}

function setGameOver(on) {
  state.gameOver = on;
  gameoverEl.classList.toggle('show', on);
  newGameBtn.classList.toggle('urge', on);
  if (on) {
    gameoverEl.querySelector('.s').textContent =
      `Final score ${state.score.toLocaleString('en-US')} — tap New Game to float again`;
    sound.over();
  }
}

// ---------------------------------------------------------------------------
// Hint
// ---------------------------------------------------------------------------

let idleTimer = null;
function clearHintVisual() {
  for (const el of hitcells) el.classList.remove('hinted');
}
function showHint() {
  if (state.animating || state.gameOver || state.hint) return;
  const mv = firstValidMove(state.board);
  if (!mv) return;
  state.hint = mv;
  hitcells[mv.a.r * COLS + mv.a.c].classList.add('hinted');
  hitcells[mv.b.r * COLS + mv.b.c].classList.add('hinted');
}
function clearHint() {
  state.hint = null;
  clearHintVisual();
}
function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (state.gameOver) return;
  idleTimer = setTimeout(showHint, 10000);
}

// ---------------------------------------------------------------------------
// The move pipeline
// ---------------------------------------------------------------------------

function dominantColour(matches, board) {
  const counts = new Map();
  for (const { r, c } of matches) {
    const t = board[r][c];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  return best;
}

async function tryMove(a, b, hintSnap) {
  if (state.animating || state.gameOver) return;
  const gen = state.gen;
  if (!isValidSwap(state.board, a, b)) {
    state.animating = true;
    sound.reject();
    await renderer.animateReject(a, b);
    if (gen === state.gen) state.animating = false;
    resetIdleTimer();
    return;
  }
  state.animating = true;
  clearHint();
  sound.swap();

  const swapped = applySwap(state.board, a, b);
  await renderer.animateSwap(a, b);
  if (gen !== state.gen) return;
  state.board = swapped;

  const firstMatches = findMatches(swapped);
  state.favoured = dominantColour(firstMatches, swapped);

  const types = typesForStage(state.stage);
  const { board: settled, steps } = collapse(swapped, rng, types, state.favoured);

  // ---- score the whole move (pinned primitives compose the gain)
  let raw = 0, L = 0, prev = swapped;
  const waveScores = [];
  for (let i = 0; i < steps.length; i++) {
    L = Math.max(L, longestRun(prev));
    let sum = 0;
    const colours = new Set();
    const rarity = new Map();
    for (const { r, c } of steps[i].matches) {
      const t = prev[r][c];
      if (!rarity.has(t)) {
        let n = 0;
        for (const row of prev) for (const v of row) if (v === t) n++;
        rarity.set(t, n);
      }
      let v = gemValue(t, rarity.get(t));
      if (t === featuredType()) v *= FEATURED_X;
      sum += v;
      colours.add(t);
    }
    for (const t of colours) state.matchCounts[t]++;
    raw += sum * cascadeFactor(i);
    waveScores.push(sum);
    prev = steps[i].board;
  }
  state.multiplier = matchMultiplier(state.multiplier, L);
  const bonus = hintSnap && pairKey(a, b) !== pairKey(hintSnap.a, hintSnap.b) ? 100 : 0;
  const gain = raw * state.multiplier + bonus;

  // ---- animate the waves, sequentially
  prev = swapped;
  for (let i = 0; i < steps.length; i++) {
    if (i >= 1) showCascade(i);
    sound.match(i, steps[i].matches.length);
    await renderer.animateWave(steps[i].matches, steps[i].board, i);
    if (gen !== state.gen) return;
    state.board = steps[i].board;
    prev = steps[i].board;
  }
  state.board = settled;

  // ---- commit score, stage, best
  state.lastBonus = bonus;
  state.lastGain = gain;
  state.score += gain;
  if (bonus) sound.bonus();
  showGain(gain, bonus);

  const newStage = stageForScore(state.score);
  if (newStage !== state.stage) {
    state.stage = newStage;
    const th = themeFor(newStage);
    renderer.setTheme(newStage);
    showBanner(`Stage ${newStage}`, `${th.name} — ${GEMS[featuredType()].name} is HOT ×${FEATURED_X}` +
      (typesForStage(newStage) > types ? ` · ${GEMS[typesForStage(newStage) - 1].name} joins the sky!` : ''));
    sound.stageUp();
  }
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('zephyr-gardens-best', String(state.best));
  }

  refreshPeek();
  updateHud();

  if (!hasValidMove(state.board)) setGameOver(true);
  state.animating = false;
  resetIdleTimer();
}

function newGame() {
  state.gen++;
  state.board = createBoard(ROWS, COLS, typesForStage(0), rng);
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.multiplier = 1;
  state.stage = 0;
  state.favoured = null;
  state.matchCounts = [0, 0, 0, 0, 0, 0];
  state.animating = false;
  clearHint();
  setGameOver(false);
  gameoverEl.classList.remove('show');
  renderer.setTheme(0);
  renderer.setBoard(state.board);
  refreshPeek();
  updateHud();
  resetIdleTimer();
}

// ---------------------------------------------------------------------------
// Input: slide-to-swap on hit cells, orbit on the backdrop, pinch to zoom
// ---------------------------------------------------------------------------

const pointers = new Map(); // pointerId -> {x, y}
let drag = null;   // {r, c, x0, y0, id, hintSnap}
let orbitDrag = null; // {x, y}
let pinch = null;  // {d0}

function rectAt(r, c) { return lastRects && lastRects[r * COLS + c]; }

function decideTarget(origin, dx, dy) {
  const o = rectAt(origin.r, origin.c);
  if (!o) return null;
  let best = null;
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const r = origin.r + dr, c = origin.c + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const n = rectAt(r, c);
    if (!n) continue;
    const vx = n.cx - o.cx, vy = n.cy - o.cy;
    const len = Math.hypot(vx, vy) || 1;
    const proj = (dx * vx + dy * vy) / len;
    if (proj >= len * 0.42 && (!best || proj > best.proj)) best = { r, c, proj };
  }
  return best ? { r: best.r, c: best.c } : null;
}

function boardFractions(origin, dx, dy) {
  // express a screen displacement in board-cell fractions (for the drag nudge)
  const o = rectAt(origin.r, origin.c);
  if (!o) return { fx: 0, fz: 0 };
  const hSign = origin.c + 1 < COLS ? 1 : -1;
  const vSign = origin.r + 1 < ROWS ? 1 : -1;
  const rH = rectAt(origin.r, origin.c + hSign);
  const rV = rectAt(origin.r + vSign, origin.c);
  if (!rH || !rV) return { fx: 0, fz: 0 };
  const Rx = (rH.cx - o.cx) * hSign, Ry = (rH.cy - o.cy) * hSign;
  const Dx = (rV.cx - o.cx) * vSign, Dy = (rV.cy - o.cy) * vSign;
  const det = Rx * Dy - Ry * Dx;
  if (Math.abs(det) < 1e-6) return { fx: 0, fz: 0 };
  let fx = (dx * Dy - dy * Dx) / det;
  let fz = (Rx * dy - Ry * dx) / det;
  // dominant axis only, capped just short of a full cell
  if (Math.abs(fx) > Math.abs(fz)) fz = 0; else fx = 0;
  fx = Math.max(-0.55, Math.min(0.55, fx));
  fz = Math.max(-0.55, Math.min(0.55, fz));
  return { fx, fz };
}

window.addEventListener('pointerdown', (e) => {
  sound.ensure();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    // second finger: switch to pinch, abandon any drag/orbit
    if (drag) { renderer.setNudge(null); renderer.setGrab({ r: drag.r, c: drag.c }, false); drag = null; }
    orbitDrag = null;
    const [p1, p2] = [...pointers.values()];
    pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
    return;
  }
  const cellEl = e.target.closest && e.target.closest('.hitcell');
  if (cellEl) {
    const r = Number(cellEl.dataset.r), c = Number(cellEl.dataset.c);
    drag = {
      r, c, x0: e.clientX, y0: e.clientY, id: e.pointerId,
      hintSnap: state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null,
    };
    renderer.setGrab({ r, c }, true);
    return;
  }
  if (e.target.closest && e.target.closest('button, #hud')) return;
  orbitDrag = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; }
  if (pinch && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (d > 0 && pinch.d0 > 0) {
      renderer.zoom(d / pinch.d0);
      pinch.d0 = d;
    }
    return;
  }
  if (drag && e.pointerId === drag.id) {
    const { fx, fz } = boardFractions({ r: drag.r, c: drag.c }, e.clientX - drag.x0, e.clientY - drag.y0);
    renderer.setNudge({ r: drag.r, c: drag.c }, fx, fz);
    return;
  }
  if (orbitDrag) {
    renderer.orbit((e.clientX - orbitDrag.x) * -0.005, (e.clientY - orbitDrag.y) * -0.005);
    orbitDrag = { x: e.clientX, y: e.clientY };
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && e.pointerId === drag.id) {
    const d = drag;
    drag = null;
    renderer.setNudge(null);
    renderer.setGrab({ r: d.r, c: d.c }, false);
    if (e.type === 'pointerup') {
      const target = decideTarget({ r: d.r, c: d.c }, e.clientX - d.x0, e.clientY - d.y0);
      if (target) tryMove({ r: d.r, c: d.c }, target, d.hintSnap);
      // released on/near the origin: an out-and-back cancel — no move
    }
  }
  if (orbitDrag) orbitDrag = null;
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

window.addEventListener('wheel', (e) => {
  renderer.zoom(e.deltaY < 0 ? 1.07 : 0.93);
}, { passive: true });

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

newGameBtn.addEventListener('click', () => { sound.ensure(); newGame(); });
resetViewBtn.addEventListener('click', () => { sound.ensure(); renderer.resetView(); });
hudToggle.addEventListener('click', () => {
  hud.classList.toggle('open');
  renderer.refreshView();
});
soundBtn.addEventListener('click', () => {
  sound.ensure();
  sound.setOn(!sound.on);
  soundBtn.setAttribute('aria-pressed', String(sound.on));
  soundBtn.textContent = sound.on ? '🔊' : '🔇';
  if (sound.on) sound.swap();
});
soundBtn.setAttribute('aria-pressed', String(sound.on));
soundBtn.textContent = sound.on ? '🔊' : '🔇';

// ---------------------------------------------------------------------------
// Test hooks (observation only)
// ---------------------------------------------------------------------------

window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.multiplier,
  gemValues: () => currentGemValues(),
  stage: () => state.stage,
  featuredType: () => featuredType(),
  featuredMultiplier: () => (featuredType() == null ? 1 : FEATURED_X),
  favouredType: () => state.favoured,
  nextColours: () => state.peek.slice(),
  bestScore: () => state.best,
  validMove: () => firstValidMove(state.board),
  board: () => state.board.map((row) => [...row]),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

state.board = createBoard(ROWS, COLS, typesForStage(0), rng);
renderer.setTheme(0);
renderer.setBoard(state.board);
refreshPeek();
updateHud();
resetIdleTimer();
