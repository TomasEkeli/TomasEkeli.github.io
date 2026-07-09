// render.js — Sky Orchard: a bright, sunlit match-3 played on a floating
// orchard terrace in the clouds. WebGL (vendored three.js) with a DOM
// fallback when no GL context is available. All logic comes from game.js.

import * as THREE from './three.module.js';
import {
  createBoard, findMatches, isValidSwap, hasValidMove, applySwap, collapse,
  longestRun, matchMultiplier, stageForScore, cascadeFactor, refillQueue,
} from './game.js';

/* ================================================================== *
 * Constants & gem/stage definitions
 * ================================================================== */

const ROWS = 8, COLS = 8, TYPES = 6;
const SPACING = 1.06;
const GEM_Y = 0.42;
const FEATURED_MULT = 3;
const DEVIATION_BONUS = 100;
const PEEK_LEN = 6;
const BEST_KEY = 'sky-orchard-best-v1';

const GEMS = [
  { name: 'Citrine', color: 0xffc93c, css: '#ffc93c', note: 'doubles each match' },
  { name: 'Coral',   color: 0xff6f61, css: '#ff6f61', note: 'flat 50, never scales' },
  { name: 'Leaf',    color: 0x47c869, css: '#47c869', note: 'grows +6 per match' },
  { name: 'Sky',     color: 0x3ec6ff, css: '#3ec6ff', note: 'rarer = richer' },
  { name: 'Plum',    color: 0xb06ef7, css: '#b06ef7', note: 'rises each stage' },
  { name: 'Pearl',   color: 0xff9ad5, css: '#ff9ad5', note: 'loves company' },
];

const STAGES = [
  { name: 'Morning Bloom', featured: 3,
    sky: ['#7ec8ff', '#ffd9a0', '#fff0d6'], fog: 0xffe6c2, sun: 0xfff1d6,
    hemiSky: 0xcfe9ff, hemiGround: 0xffe2b8, base: 0xf9ead0, baseAlt: 0xf3d9ae,
    rim: 0xd9a05b, island: 0x94c973, petals: 0xffb7d0, ground: 0xffe9cd,
    css: 'linear-gradient(#7ec8ff,#ffd9a0 60%,#fff0d6)' },
  { name: 'Sapphire Noon', featured: 0,
    sky: ['#3f9fff', '#9fdcff', '#eafaff'], fog: 0xd6f1ff, sun: 0xffffff,
    hemiSky: 0xbfe8ff, hemiGround: 0xfff3d0, base: 0xf3f7ff, baseAlt: 0xdceaf8,
    rim: 0x7fb2e0, island: 0x7fc96e, petals: 0xffffff, ground: 0xe8f7ff,
    css: 'linear-gradient(#3f9fff,#9fdcff 60%,#eafaff)' },
  { name: 'Honey Sunset', featured: 1,
    sky: ['#ff9e5e', '#ffcf86', '#ffe9b8'], fog: 0xffd9a3, sun: 0xffd9a0,
    hemiSky: 0xffd9a8, hemiGround: 0xffbf8a, base: 0xffe9c8, baseAlt: 0xf8d6a2,
    rim: 0xd98d4b, island: 0xa8b45e, petals: 0xffd27a, ground: 0xffdcae,
    css: 'linear-gradient(#ff9e5e,#ffcf86 60%,#ffe9b8)' },
  { name: 'Lilac Twilight', featured: 4,
    sky: ['#b78bff', '#ffb3e2', '#ffe4f2'], fog: 0xf2d5f7, sun: 0xffe6ff,
    hemiSky: 0xd9c2ff, hemiGround: 0xffd6ec, base: 0xf7ebff, baseAlt: 0xe8d6f8,
    rim: 0xa87fd0, island: 0x7fbf8e, petals: 0xffc2ea, ground: 0xf4dcff,
    css: 'linear-gradient(#b78bff,#ffb3e2 60%,#ffe4f2)' },
  { name: 'Firefly Eve', featured: 5,
    sky: ['#2fb7a8', '#8fe8c9', '#f2ffe0'], fog: 0xcdf5df, sun: 0xf4ffd8,
    hemiSky: 0xa8f0d8, hemiGround: 0xf7ffd0, base: 0xeafbe8, baseAlt: 0xcdeecb,
    rim: 0x5faf7f, island: 0x6fbf6f, petals: 0xf7ffa8, ground: 0xdcf8e4,
    css: 'linear-gradient(#2fb7a8,#8fe8c9 60%,#f2ffe0)' },
];
const stageTheme = (i) => STAGES[i % STAGES.length];

/* ================================================================== *
 * Seedable rng with snapshotable state (for the honest refill peek)
 * ================================================================== */

function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a;
  return rng;
}
const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
const peekRng = () => makeRng(rng.getState());

/* ================================================================== *
 * Game state
 * ================================================================== */

function loadBest() {
  try { const v = Number(localStorage.getItem(BEST_KEY)); return Number.isFinite(v) && v > 0 ? v : 0; }
  catch { return 0; }
}
function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* private mode */ } }

const state = {
  board: null,
  score: 0, lastGain: 0, lastBonus: 0, mult: 1,
  stage: 0, favoured: null, peek: [],
  matchCounts: new Array(TYPES).fill(0),
  best: loadBest(),
  gameOver: false, animating: false, hint: null,
};
let moveToken = 0; // bumped on New Game to abort in-flight animations

function countOnBoard(board, t) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === t) n++;
  return n;
}

// Per-colour, per-gem CURRENT value — the candidate-designed colour economy.
function gemValue(t, board) {
  switch (t) {
    case 0: return Math.min(5 * 2 ** state.matchCounts[0], 320);      // cheap, exponential
    case 1: return 50;                                                 // expensive, flat
    case 2: return 10 + 6 * state.matchCounts[2];                      // grows each match
    case 3: return Math.max(12, Math.round(240 / Math.max(1, countOnBoard(board, 3)))); // rarity
    case 4: return 12 + 10 * state.stage;                              // rises each stage
    case 5: return Math.min(96, 4 * Math.max(1, countOnBoard(board, 5))); // abundance
    default: return 10;
  }
}
const gemValuesNow = () => GEMS.map((_, t) => gemValue(t, state.board));
const featuredTypeNow = () => stageTheme(state.stage).featured;

function findFirstMove(board) {
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
const cellEq = (p, q) => p.r === q.r && p.c === q.c;
const samePair = (m, n) =>
  (cellEq(m.a, n.a) && cellEq(m.b, n.b)) || (cellEq(m.a, n.b) && cellEq(m.b, n.a));

/* ================================================================== *
 * Tween engine (wall-clock, promise-based)
 * ================================================================== */

const tweens = new Set();
function tween(dur, onUpdate, ease = (t) => t) {
  return new Promise((res) => {
    tweens.add({ t0: performance.now(), dur, onUpdate, ease, res });
  });
}
function tickTweens(now) {
  for (const tw of [...tweens]) {
    let t = (now - tw.t0) / tw.dur;
    if (t >= 1) t = 1;
    try { tw.onUpdate(tw.ease(t)); } catch { /* gem may be gone after New Game */ }
    if (t === 1) { tweens.delete(tw); tw.res(); }
  }
}
const easeInQuad = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The gravity plan for one wave, matching collapse()'s bottom-up gravity.
function planWave(pre, matches, post) {
  const clearedSet = new Set(matches.map((m) => m.r * COLS + m.c));
  const moves = [], spawns = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!clearedSet.has(r * COLS + c)) {
        if (write !== r) moves.push({ from: { r, c }, to: { r: write, c } });
        write--;
      }
    }
    const m = write + 1; // refills in this column
    for (let r = write; r >= 0; r--) {
      spawns.push({ to: { r, c }, fromRow: r - m, value: post[r][c] });
    }
  }
  return { cleared: matches, moves, spawns };
}

/* ================================================================== *
 * DOM references
 * ================================================================== */

const $ = (id) => document.getElementById(id);
const stageWrap = $('stage-wrap');
const canvas = $('scene');
const gemLayer = $('gem-layer');
const hitLayer = $('hit-layer');
const fxLayer = $('fx-layer');
const bannerLayer = $('banner-layer');

document.body.style.userSelect = 'none';
document.body.style.webkitUserSelect = 'none';
stageWrap.addEventListener('contextmenu', (e) => e.preventDefault());

/* ================================================================== *
 * Swatch icons (shape + colour — colour-blind safe, matches 3D forms)
 * ================================================================== */

function swatchSVG(t, cls = 'swatch') {
  const col = GEMS[t].css;
  const shapes = [
    `<polygon points="50,4 96,50 50,96 4,50" fill="${col}" stroke="#00000022" stroke-width="4"/>`,   // diamond (octahedron)
    `<circle cx="50" cy="50" r="33" fill="none" stroke="${col}" stroke-width="22"/>`,                 // ring (torus)
    `<polygon points="50,3 92,27 92,73 50,97 8,73 8,27" fill="${col}" stroke="#00000022" stroke-width="4"/>`, // hexagon (prism)
    `<polygon points="50,6 95,92 5,92" fill="${col}" stroke="#00000022" stroke-width="4"/>`,          // triangle (icosahedron)
    `<polygon points="50,3 96,38 79,95 21,95 4,38" fill="${col}" stroke="#00000022" stroke-width="4"/>`, // pentagon (dodecahedron)
    `<circle cx="50" cy="50" r="44" fill="${col}" stroke="#00000022" stroke-width="4"/>`,             // circle (pearl)
  ];
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${shapes[t]}</svg>`;
}

/* ================================================================== *
 * Renderer: WebGL 3D world
 * ================================================================== */

function gradientTexture(colors) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.42, colors[0]);
  g.addColorStop(0.72, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function radialTexture(inner, mid, outer) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.08, inner);
  g.addColorStop(0.3, mid);
  g.addColorStop(0.62, outer);
  g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function softDotTexture(rgb = '255,255,255') {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.55, `rgba(${rgb},0.55)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function checkerTexture(c1, c2) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext('2d');
  const n = 8, s = 256 / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      ctx.fillStyle = (r + c) % 2 ? c1 : c2;
      ctx.fillRect(c * s, r * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const colX = (c) => (c - (COLS - 1) / 2) * SPACING;
const rowZ = (r) => (r - (ROWS - 1) / 2) * SPACING;

class GLRenderer {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const gl = this.renderer.getContext();
    if (!gl) throw new Error('no webgl context');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3(0, 0.1, 0);
    this.theta = 0; this.phi = 0.52; this.zoom = 1;
    this.defaultView = { theta: 0, phi: 0.52, zoom: 1 };
    this.fitR = 14;

    // lights
    this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0xffe2b8, 1.15);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sun.position.set(7, 12, 5);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.55);
    this.fill.position.set(-6, 6, -6);
    this.scene.add(this.hemi, this.sun, this.fill);

    // sky dome
    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(70, 20, 14), this.skyMat);
    this.scene.add(this.sky);

    // the air below: a radial sky-gradient disc far under the island
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(46, 36), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -11;
    this.scene.add(ground);

    // drifting mini-islands peeking around the terrace (depth & character)
    this.isleTopMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.islandMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.isleGroup = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const isle = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.6, 7), this.islandMat);
      rock.rotation.x = Math.PI; rock.position.y = -1.3;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.55, 0.55, 7), this.isleTopMat);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), this.isleTopMat);
      puff.position.y = 0.9; puff.scale.set(1.2, 0.8, 1.2);
      isle.add(rock, top, puff);
      const ang = i * 1.35 + 0.55, rad = 8.5 + i * 2.3;
      isle.position.set(Math.cos(ang) * rad, -4.6 + i * 0.7, Math.sin(ang) * rad);
      isle.userData.phase = i * 1.9;
      this.isleGroup.add(isle);
    }
    this.scene.add(this.isleGroup);

    // a sea of cloud puffs floating below/around the terrace (in frame at default view)
    this.cloudTex = softDotTexture('255,255,255');
    this.lowClouds = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.cloudTex, opacity: 0.55 + Math.random() * 0.4, depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(mat);
      const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.6;
      const rad = 5.5 + Math.random() * 17;
      s.position.set(Math.cos(ang) * rad, -6.5 + Math.random() * 3, Math.sin(ang) * rad);
      const sc = 6 + Math.random() * 10;
      s.scale.set(sc, sc * 0.5, 1);
      this.lowClouds.add(s);
    }
    this.scene.add(this.lowClouds);

    // floating island terrace
    this.baseTopMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const baseBox = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.55, 9.1), this.baseTopMat);
    baseBox.position.y = -0.29;
    this.rimMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
    const rim = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.4, 9.7), this.rimMat);
    rim.position.y = -0.68;
    this.checkerMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const checker = new THREE.Mesh(new THREE.PlaneGeometry(8.55, 8.55), this.checkerMat);
    checker.rotation.x = -Math.PI / 2; checker.position.y = 0.002;
    const island = new THREE.Mesh(new THREE.ConeGeometry(4.8, 3.6, 8), this.islandMat);
    island.rotation.x = Math.PI; island.position.y = -2.7;
    this.scene.add(baseBox, rim, checker, island);

    // drifting clouds
    this.cloudTex = softDotTexture('255,255,255');
    this.cloudGroup = new THREE.Group();
    for (let i = 0; i < 11; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.cloudTex, opacity: 0.9, depthWrite: false, fog: false });
      const s = new THREE.Sprite(mat);
      const ang = (i / 11) * Math.PI * 2 + Math.random();
      const rad = 18 + Math.random() * 22;
      s.position.set(Math.cos(ang) * rad, -3 + Math.random() * 12, Math.sin(ang) * rad);
      const sc = 8 + Math.random() * 9;
      s.scale.set(sc, sc * 0.55, 1);
      this.cloudGroup.add(s);
    }
    this.scene.add(this.cloudGroup);

    // drifting petals / motes
    const petalCount = 80;
    const pos = new Float32Array(petalCount * 3);
    for (let i = 0; i < petalCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = Math.random() * 12 - 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 26;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.petalMat = new THREE.PointsMaterial({
      size: 0.22, map: softDotTexture('255,200,220'), transparent: true,
      opacity: 0.9, depthWrite: false,
    });
    this.petals = new THREE.Points(pGeo, this.petalMat);
    this.scene.add(this.petals);

    // gem geometries & materials
    this.geos = [
      new THREE.OctahedronGeometry(0.44),
      new THREE.TorusGeometry(0.3, 0.135, 10, 20),
      new THREE.CylinderGeometry(0.36, 0.36, 0.5, 6),
      new THREE.IcosahedronGeometry(0.42),
      new THREE.DodecahedronGeometry(0.42),
      new THREE.SphereGeometry(0.4, 20, 16),
    ];
    this.mats = GEMS.map((g, t) => new THREE.MeshStandardMaterial({
      color: g.color,
      roughness: t === 5 ? 0.12 : 0.26,
      metalness: t === 5 ? 0.05 : 0.2,
      flatShading: t !== 5 && t !== 1,
      emissive: g.color,
      emissiveIntensity: 0.15,
    }));

    this.gemGroup = new THREE.Group();
    this.scene.add(this.gemGroup);
    this.grid = null;         // grid[r][c] -> mesh
    this.featured = 0;
    this.hint = null;
    this.grabbed = null;
    this._v = new THREE.Vector3();

    this.resize();
    this.updateCamera();
  }

  makeGem(t) {
    const mesh = new THREE.Mesh(this.geos[t], this.mats[t]);
    mesh.userData.type = t;
    mesh.userData.spin = 0.25 + Math.random() * 0.4;
    mesh.rotation.y = Math.random() * Math.PI * 2;
    if (t === 1) mesh.rotation.x = Math.PI / 2 - 0.35; // ring lies mostly flat
    this.gemGroup.add(mesh);
    return mesh;
  }
  disposeGem(mesh) { this.gemGroup.remove(mesh); }

  buildBoard(board) {
    if (this.grid) for (const row of this.grid) for (const m of row) if (m) this.disposeGem(m);
    this.grid = board.map((row, r) => row.map((t, c) => {
      const m = this.makeGem(t);
      m.position.set(colX(c), GEM_Y, rowZ(r));
      return m;
    }));
    this.hint = null; this.grabbed = null;
  }

  applyStage(idx) {
    const th = stageTheme(idx);
    if (this.skyMat.map) this.skyMat.map.dispose();
    this.skyMat.map = gradientTexture(th.sky);
    this.skyMat.needsUpdate = true;
    this.scene.fog = new THREE.Fog(th.fog, 46, 95);
    this.isleTopMat.color.set(th.island).offsetHSL(0, 0.04, 0.1);
    this.hemi.color.set(th.hemiSky); this.hemi.groundColor.set(th.hemiGround);
    this.sun.color.set(th.sun);
    this.baseTopMat.color.set(th.base);
    if (this.checkerMat.map) this.checkerMat.map.dispose();
    this.checkerMat.map = checkerTexture(
      '#' + new THREE.Color(th.base).getHexString(),
      '#' + new THREE.Color(th.baseAlt).getHexString());
    this.checkerMat.needsUpdate = true;
    this.rimMat.color.set(th.rim);
    this.islandMat.color.set(th.island);
    if (this.groundMat.map) this.groundMat.map.dispose();
    this.groundMat.map = radialTexture(
      '#' + new THREE.Color(th.ground).getHexString(), th.sky[1], th.sky[0]);
    this.groundMat.needsUpdate = true;
    this.petalMat.color.set(th.petals);
    this.featured = th.featured;
  }

  setHint(pair) { this.hint = pair; if (!pair && this.grid) this.grid.forEach((row) => row.forEach((m) => { if (m && !this._isBusy(m)) m.scale.setScalar(1); })); }
  _isBusy() { return false; }

  grabGem(r, c) {
    const m = this.grid[r][c];
    if (!m) return;
    this.grabbed = m;
    tween(110, (t) => { m.position.y = GEM_Y + 0.28 * t; m.scale.setScalar(1 + 0.1 * t); });
  }
  releaseGem(r, c) {
    const m = this.grid[r] && this.grid[r][c];
    this.grabbed = null;
    if (!m) return;
    const y0 = m.position.y, s0 = m.scale.x;
    tween(110, (t) => { m.position.y = y0 + (GEM_Y - y0) * t; m.scale.setScalar(s0 + (1 - s0) * t); });
  }

  async animateSwap(a, b) {
    const ma = this.grid[a.r][a.c], mb = this.grid[b.r][b.c];
    const pa = { x: colX(a.c), z: rowZ(a.r) }, pb = { x: colX(b.c), z: rowZ(b.r) };
    await tween(150, (t) => {
      ma.position.x = pa.x + (pb.x - pa.x) * t; ma.position.z = pa.z + (pb.z - pa.z) * t;
      ma.position.y = GEM_Y + Math.sin(t * Math.PI) * 0.35;
      mb.position.x = pb.x + (pa.x - pb.x) * t; mb.position.z = pb.z + (pa.z - pb.z) * t;
      ma.scale.setScalar(1); mb.scale.setScalar(1);
    }, easeInOut);
    ma.position.set(pb.x, GEM_Y, pb.z); mb.position.set(pa.x, GEM_Y, pa.z);
    this.grid[a.r][a.c] = mb; this.grid[b.r][b.c] = ma;
  }

  async animateSwapFail(a, b) {
    const ma = this.grid[a.r][a.c], mb = this.grid[b.r][b.c];
    const pa = { x: colX(a.c), z: rowZ(a.r) }, pb = { x: colX(b.c), z: rowZ(b.r) };
    await tween(210, (t) => {
      const k = Math.sin(t * Math.PI) * 0.32;
      ma.position.x = pa.x + (pb.x - pa.x) * k; ma.position.z = pa.z + (pb.z - pa.z) * k;
      mb.position.x = pb.x + (pa.x - pb.x) * k; mb.position.z = pb.z + (pa.z - pb.z) * k;
    });
    ma.position.set(pa.x, GEM_Y, pa.z); mb.position.set(pb.x, GEM_Y, pb.z);
  }

  spawnBurst(r, c, t) {
    const bits = [];
    for (let i = 0; i < 5; i++) {
      const bit = new THREE.Mesh(this.geos[0], this.mats[t]);
      bit.scale.setScalar(0.22);
      bit.position.set(colX(c), GEM_Y, rowZ(r));
      const ang = Math.random() * Math.PI * 2;
      bit.userData.vel = { x: Math.cos(ang) * 1.6, y: 2 + Math.random() * 1.6, z: Math.sin(ang) * 1.6 };
      this.gemGroup.add(bit);
      bits.push(bit);
    }
    tween(380, (t2) => {
      for (const bit of bits) {
        bit.position.x += bit.userData.vel.x * 0.016;
        bit.position.z += bit.userData.vel.z * 0.016;
        bit.position.y += (bit.userData.vel.y - 6 * t2) * 0.016;
        bit.scale.setScalar(0.22 * (1 - t2));
      }
    }).then(() => bits.forEach((b) => this.gemGroup.remove(b)));
  }

  async animateWave(pre, matches, post) {
    const plan = planWave(pre, matches, post);
    // 1. clear — shrink & spin with a burst, then vanish
    await Promise.all(plan.cleared.map(({ r, c }) => {
      const m = this.grid[r][c];
      this.spawnBurst(r, c, pre[r][c]);
      return tween(190, (t) => {
        m.scale.setScalar(Math.max(0.001, 1 - t));
        m.rotation.y += 0.35;
        m.position.y = GEM_Y + 0.3 * t;
      }).then(() => this.disposeGem(m));
    }));
    for (const { r, c } of plan.cleared) this.grid[r][c] = null;
    // 2. drop — survivors accelerate down the board; refills drop in from the top edge
    const jobs = [];
    const movers = plan.moves.map((mv) => ({ mesh: this.grid[mv.from.r][mv.from.c], mv }));
    for (const mv of plan.moves) this.grid[mv.from.r][mv.from.c] = null;
    for (const { mesh, mv } of movers) {
      this.grid[mv.to.r][mv.to.c] = mesh;
      jobs.push(this._fall(mesh, mv.from.r, mv.to.r, mv.to.c, false));
    }
    for (const sp of plan.spawns) {
      const mesh = this.makeGem(sp.value);
      mesh.position.set(colX(sp.to.c), GEM_Y + 1.1, rowZ(sp.fromRow));
      this.grid[sp.to.r][sp.to.c] = mesh;
      jobs.push(this._fall(mesh, sp.fromRow, sp.to.r, sp.to.c, true));
    }
    await Promise.all(jobs);
  }

  _fall(mesh, fromRow, toRow, col, isSpawn) {
    const dist = toRow - fromRow;
    const dur = Math.min(250, 85 + 52 * dist);
    const z0 = rowZ(fromRow), z1 = rowZ(toRow);
    const y0 = isSpawn ? GEM_Y + 1.1 : GEM_Y;
    return tween(dur, (t) => {
      mesh.position.z = z0 + (z1 - z0) * t;
      mesh.position.y = y0 + (GEM_Y - y0) * t;
      mesh.position.x = colX(col);
    }, easeInQuad).then(() => { mesh.position.set(colX(col), GEM_Y, rowZ(toRow)); });
  }

  // --- camera -----------------------------------------------------
  orbit(dTheta, dPhi) {
    this.theta += dTheta;
    this.phi = Math.min(1.28, Math.max(0.18, this.phi + dPhi));
    this.updateCamera();
  }
  zoomBy(f) { this.zoom = Math.min(1.9, Math.max(0.55, this.zoom * f)); this.updateCamera(); }
  resetView() {
    const from = { theta: this.theta, phi: this.phi, zoom: this.zoom };
    const to = this.defaultView;
    tween(280, (t) => {
      this.theta = from.theta + (to.theta - from.theta) * t;
      this.phi = from.phi + (to.phi - from.phi) * t;
      this.zoom = from.zoom + (to.zoom - from.zoom) * t;
      this.updateCamera();
    }, easeInOut);
  }
  updateCamera() {
    const R = this.fitR / this.zoom;
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.camera.position.set(
      this.camTarget.x + R * sp * Math.sin(this.theta),
      this.camTarget.y + R * cp,
      this.camTarget.z + R * sp * Math.cos(this.theta));
    this.camera.lookAt(this.camTarget);
  }
  resize() {
    const w = stageWrap.clientWidth || 1, h = stageWrap.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const bound = 5.15; // board bounding-sphere radius incl. base
    this.fitR = Math.min(46, Math.max(8, bound / Math.sin(Math.min(vHalf, hHalf))));
    this.updateCamera();
  }

  projectCell(r, c) {
    const w = stageWrap.clientWidth, h = stageWrap.clientHeight;
    this._v.set(colX(c), GEM_Y, rowZ(r)).project(this.camera);
    return { x: (this._v.x * 0.5 + 0.5) * w, y: (-this._v.y * 0.5 + 0.5) * h };
  }

  update(dt, t) {
    // gem idle life: slow spin; featured type glows in waves; hint pulses
    for (let ty = 0; ty < TYPES; ty++) {
      this.mats[ty].emissiveIntensity = ty === this.featured ? 0.32 + 0.22 * Math.sin(t * 4) : 0.15;
    }
    if (this.grid) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const m = this.grid[r][c];
          if (!m) continue;
          m.rotation.y += m.userData.spin * dt;
          if (this.hint && !state.animating && !this.grabbed &&
              ((this.hint.a.r === r && this.hint.a.c === c) || (this.hint.b.r === r && this.hint.b.c === c))) {
            m.scale.setScalar(1 + 0.07 * Math.sin(t * 5.5));
          }
        }
      }
    }
    this.cloudGroup.rotation.y += 0.008 * dt;
    this.lowClouds.rotation.y -= 0.006 * dt;
    this.isleGroup.rotation.y += 0.005 * dt;
    for (const isle of this.isleGroup.children) {
      isle.position.y += Math.sin(t * 0.5 + isle.userData.phase) * dt * 0.12;
    }
    const pos = this.petals.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * (0.35 + (i % 5) * 0.06);
      let x = pos.getX(i) + Math.sin(t * 0.6 + i) * dt * 0.18;
      if (y < -3) { y = 10; x = (Math.random() - 0.5) * 26; }
      pos.setY(i, y); pos.setX(i, x);
    }
    pos.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}

/* ================================================================== *
 * Renderer: DOM fallback (no WebGL) — flat, bright, fully playable
 * ================================================================== */

class DomRenderer {
  constructor() {
    canvas.style.display = 'none';
    this.zoom = 1;
    this.grid = null;
    this.hint = null;
    this.featured = 0;
    this.origin = { x: 0, y: 0 };
    this.cellPx = 48;
    const style = document.createElement('style');
    style.textContent = `
      .gem2d { position: absolute; left: 0; top: 0; will-change: transform; }
      .gem2d .shape { position: absolute; inset: 8%;
        box-shadow: inset -4px -6px 10px rgba(0,0,0,0.18), inset 4px 6px 10px rgba(255,255,255,0.55); }
      .gem2d .shine { position: absolute; left: 18%; top: 12%; width: 30%; height: 22%;
        background: radial-gradient(ellipse at center, rgba(255,255,255,0.95), rgba(255,255,255,0)); border-radius: 50%; }
      .gem2d.t0 .shape { background: ${GEMS[0].css}; transform: rotate(45deg) scale(0.74); border-radius: 12%; }
      .gem2d.t1 .shape { background: none; border: 0.55em solid ${GEMS[1].css}; border-radius: 50%; box-shadow: none; font-size: 16px; }
      .gem2d.t2 .shape { background: ${GEMS[2].css}; clip-path: polygon(50% 2%, 95% 26%, 95% 74%, 50% 98%, 5% 74%, 5% 26%); }
      .gem2d.t3 .shape { background: ${GEMS[3].css}; clip-path: polygon(50% 4%, 96% 94%, 4% 94%); }
      .gem2d.t4 .shape { background: ${GEMS[4].css}; clip-path: polygon(50% 2%, 97% 38%, 80% 96%, 20% 96%, 3% 38%); }
      .gem2d.t5 .shape { background: radial-gradient(circle at 35% 30%, #fff5fb, ${GEMS[5].css} 60%); border-radius: 50%; }
      .gem2d.featured2d { filter: drop-shadow(0 0 8px #ffb04d); animation: feat2d 1s ease-in-out infinite; }
      @keyframes feat2d { 0%,100% { filter: drop-shadow(0 0 4px #ffb04d); } 50% { filter: drop-shadow(0 0 12px #ff8a00); } }
      .gem2d.hint2d { animation: hint2d 0.9s ease-in-out infinite; }
      @keyframes hint2d { 0%,100% { transform: var(--tf) scale(1); } 50% { transform: var(--tf) scale(1.12); } }
    `;
    document.head.appendChild(style);
    this.resize();
  }

  _place(el, r, c, lift = 0) {
    const x = this.origin.x + c * this.cellPx;
    const y = this.origin.y + r * this.cellPx - lift;
    el.style.width = el.style.height = `${this.cellPx}px`;
    el.style.setProperty('--tf', `translate(${x}px, ${y}px)`);
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.dataset.gr = r; el.dataset.gc = c;
  }
  makeGem(t) {
    const el = document.createElement('div');
    el.className = `gem2d t${t}`;
    el.innerHTML = '<div class="shape"></div><div class="shine"></div>';
    if (t === this.featured) el.classList.add('featured2d');
    gemLayer.appendChild(el);
    el.userType = t;
    return el;
  }
  disposeGem(el) { el.remove(); }

  buildBoard(board) {
    gemLayer.innerHTML = '';
    this.grid = board.map((row, r) => row.map((t, c) => {
      const el = this.makeGem(t);
      this._place(el, r, c);
      return el;
    }));
    this.hint = null;
  }

  applyStage(idx) {
    const th = stageTheme(idx);
    stageWrap.style.background = th.css;
    this.featured = th.featured;
    if (this.grid) {
      for (const row of this.grid) for (const el of row) if (el) {
        el.classList.toggle('featured2d', el.userType === this.featured);
      }
    }
  }

  setHint(pair) {
    this.hint = pair;
    if (!this.grid) return;
    for (const row of this.grid) for (const el of row) if (el) el.classList.remove('hint2d');
    if (pair) {
      const ea = this.grid[pair.a.r][pair.a.c], eb = this.grid[pair.b.r][pair.b.c];
      if (ea) ea.classList.add('hint2d');
      if (eb) eb.classList.add('hint2d');
    }
  }
  grabGem(r, c) { const el = this.grid[r][c]; if (el) el.style.zIndex = 5; }
  releaseGem(r, c) { const el = this.grid[r] && this.grid[r][c]; if (el) el.style.zIndex = ''; }

  async animateSwap(a, b) {
    const ea = this.grid[a.r][a.c], eb = this.grid[b.r][b.c];
    await tween(150, (t) => {
      this._place(ea, a.r + (b.r - a.r) * t, a.c + (b.c - a.c) * t, Math.sin(t * Math.PI) * 6);
      this._place(eb, b.r + (a.r - b.r) * t, b.c + (a.c - b.c) * t);
    }, easeInOut);
    this._place(ea, b.r, b.c); this._place(eb, a.r, a.c);
    this.grid[a.r][a.c] = eb; this.grid[b.r][b.c] = ea;
  }
  async animateSwapFail(a, b) {
    const ea = this.grid[a.r][a.c], eb = this.grid[b.r][b.c];
    await tween(210, (t) => {
      const k = Math.sin(t * Math.PI) * 0.32;
      this._place(ea, a.r + (b.r - a.r) * k, a.c + (b.c - a.c) * k);
      this._place(eb, b.r + (a.r - b.r) * k, b.c + (a.c - b.c) * k);
    });
    this._place(ea, a.r, a.c); this._place(eb, b.r, b.c);
  }

  async animateWave(pre, matches, post) {
    const plan = planWave(pre, matches, post);
    await Promise.all(plan.cleared.map(({ r, c }) => {
      const el = this.grid[r][c];
      return tween(190, (t) => {
        el.style.opacity = String(1 - t);
        el.style.transform = `${el.style.getPropertyValue('--tf')} scale(${1 - t}) rotate(${t * 160}deg)`;
      }).then(() => this.disposeGem(el));
    }));
    for (const { r, c } of plan.cleared) this.grid[r][c] = null;
    const jobs = [];
    const movers = plan.moves.map((mv) => ({ el: this.grid[mv.from.r][mv.from.c], mv }));
    for (const mv of plan.moves) this.grid[mv.from.r][mv.from.c] = null;
    for (const { el, mv } of movers) {
      this.grid[mv.to.r][mv.to.c] = el;
      jobs.push(this._fall(el, mv.from.r, mv.to.r, mv.to.c));
    }
    for (const sp of plan.spawns) {
      const el = this.makeGem(sp.value);
      this._place(el, sp.fromRow, sp.to.c);
      this.grid[sp.to.r][sp.to.c] = el;
      jobs.push(this._fall(el, sp.fromRow, sp.to.r, sp.to.c));
    }
    await Promise.all(jobs);
  }
  _fall(el, fromRow, toRow, col) {
    const dist = toRow - fromRow;
    const dur = Math.min(250, 85 + 52 * dist);
    return tween(dur, (t) => {
      this._place(el, fromRow + (toRow - fromRow) * t, col);
    }, easeInQuad).then(() => this._place(el, toRow, col));
  }

  orbit() { /* flat fallback: no orbit */ }
  zoomBy(f) { this.zoom = Math.min(1.6, Math.max(0.7, this.zoom * f)); this.resize(); }
  resetView() { this.zoom = 1; this.resize(); }
  resize() {
    const w = stageWrap.clientWidth || 1, h = stageWrap.clientHeight || 1;
    this.cellPx = Math.max(30, Math.floor(Math.min((w - 16) / COLS, (h - 16) / ROWS) * this.zoom));
    this.origin = { x: (w - this.cellPx * COLS) / 2, y: (h - this.cellPx * ROWS) / 2 };
    if (this.grid) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const el = this.grid[r][c];
        if (el) this._place(el, r, c);
      }
    }
  }
  projectCell(r, c) {
    return {
      x: this.origin.x + c * this.cellPx + this.cellPx / 2,
      y: this.origin.y + r * this.cellPx + this.cellPx / 2,
    };
  }
  update() { /* CSS animations carry the idle life */ }
}

let renderer;
try {
  const probe = document.createElement('canvas');
  const ok = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!ok) throw new Error('no webgl');
  renderer = new GLRenderer();
} catch {
  renderer = new DomRenderer();
}

/* ================================================================== *
 * Hit cells — 64 stable, pointer-receiving handles over the scene
 * ================================================================== */

const hitCells = [];
let cellSizePx = 48;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.setAttribute('data-testid', 'cell');
    el.dataset.r = r; el.dataset.c = c;
    hitLayer.appendChild(el);
    hitCells.push({ el, r, c, last: '' });
  }
}

function updateHitCells() {
  const pts = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) pts.push(renderer.projectCell(r, c));
  const at = (r, c) => pts[r * COLS + c];
  let sum = 0;
  for (const hc of hitCells) {
    const p = at(hc.r, hc.c);
    const ph = at(hc.r, hc.c + 1 < COLS ? hc.c + 1 : hc.c - 1);
    const pv = at(hc.r + 1 < ROWS ? hc.r + 1 : hc.r - 1, hc.c);
    // per-cell size: near rows get bigger touch targets than far rows
    const size = Math.max(22, Math.min(
      Math.hypot(ph.x - p.x, ph.y - p.y),
      Math.hypot(pv.x - p.x, pv.y - p.y)) * 0.94);
    hc.size = size;
    sum += size;
    const key = `${p.x.toFixed(1)}|${p.y.toFixed(1)}|${size.toFixed(1)}`;
    if (key === hc.last) continue;
    hc.last = key;
    hc.el.style.width = hc.el.style.height = `${size}px`;
    hc.el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
  }
  cellSizePx = sum / hitCells.length;
}

/* ================================================================== *
 * Input: slide gesture (decided at release), camera orbit, pinch zoom
 * ================================================================== */

let drag = null;       // active gem drag
const activePts = new Map(); // all pointers over the stage (pinch tracking)
let pinch = null;

stageWrap.addEventListener('pointerdown', (e) => {
  activePts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePts.size === 2) {
    // second finger: this is a pinch — cancel any gem drag, start zooming
    if (drag) { renderer.releaseGem(drag.r, drag.c); drag = null; }
    const [p1, p2] = [...activePts.values()];
    pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
  }
}, true);
stageWrap.addEventListener('pointermove', (e) => {
  const p = activePts.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (pinch && activePts.size >= 2) {
    const [p1, p2] = [...activePts.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (pinch.d0 > 0 && d > 0) {
      renderer.zoomBy(d / pinch.d0);
      pinch.d0 = d;
    }
  }
}, true);
function dropPointer(e) {
  activePts.delete(e.pointerId);
  if (activePts.size < 2) pinch = null;
}
stageWrap.addEventListener('pointerup', dropPointer, true);
stageWrap.addEventListener('pointercancel', dropPointer, true);
stageWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
}, { passive: false });

// gem slide — pointer capture on the hit cell so the drag survives leaving it
for (const hc of hitCells) {
  hc.el.addEventListener('pointerdown', (e) => {
    if (state.animating || state.gameOver || drag || pinch) return;
    e.preventDefault();
    try { hc.el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    drag = {
      id: e.pointerId, r: hc.r, c: hc.c,
      x0: e.clientX, y0: e.clientY,
      hintSnap: state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null,
    };
    renderer.grabGem(hc.r, hc.c);
  });
  hc.el.addEventListener('pointerup', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    renderer.releaseGem(d.r, d.c);
    finishSlide(d, e.clientX - d.x0, e.clientY - d.y0);
  });
  hc.el.addEventListener('pointercancel', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    renderer.releaseGem(drag.r, drag.c);
    drag = null;
  });
}

function finishSlide(d, dx, dy) {
  // The move is decided by where the gesture ENDS: a release back on the
  // origin cell (below the slide threshold) is a cancel, not a move.
  const threshold = (hitCells[d.r * COLS + d.c].size || cellSizePx) * 0.35;
  if (Math.hypot(dx, dy) < threshold) return;
  const p0 = renderer.projectCell(d.r, d.c);
  let best = null, bestDot = 0;
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const r2 = d.r + dr, c2 = d.c + dc;
    if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) continue;
    const p1 = renderer.projectCell(r2, c2);
    const vx = p1.x - p0.x, vy = p1.y - p0.y;
    const len = Math.hypot(vx, vy) || 1;
    const dot = (dx * vx + dy * vy) / len; // displacement along that neighbour
    if (dot > bestDot) { bestDot = dot; best = { r: r2, c: c2 }; }
  }
  if (!best || bestDot < threshold) return;
  attemptMove({ r: d.r, c: d.c }, best, d.hintSnap);
}

/* ================================================================== *
 * The move — logic first (hooks stay truthful), then the show
 * ================================================================== */

async function attemptMove(a, b, hintSnap) {
  if (state.animating || state.gameOver) return;
  clearHint();
  if (!isValidSwap(state.board, a, b)) {
    state.animating = true;
    const token = moveToken;
    await renderer.animateSwapFail(a, b);
    if (token !== moveToken) return;
    state.animating = false;
    restartIdle();
    return;
  }
  await commitMove(a, b, hintSnap);
}

function dominantColour(swapped, cells, a, b) {
  const has = (p) => cells.some((m) => m.r === p.r && m.c === p.c);
  if (has(b)) return swapped[b.r][b.c];
  if (has(a)) return swapped[a.r][a.c];
  const counts = new Map();
  for (const m of cells) {
    const t = swapped[m.r][m.c];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
}

async function commitMove(a, b, hintSnap) {
  state.animating = true;
  const token = moveToken;

  const swapped = applySwap(state.board, a, b);
  const wave0 = findMatches(swapped);

  // This move's refills draw under the favour the player was shown in the
  // peek (the previous "last actively cleared" colour); the colour this swap
  // clears becomes the favour — and the peek — for what falls next.
  const res = collapse(swapped, rng, TYPES, state.favoured);
  state.favoured = dominantColour(swapped, wave0, a, b);

  // ---- score the move ------------------------------------------------
  let raw = 0, maxRun = 1;
  let pre = swapped;
  const featured = featuredTypeNow();
  for (let i = 0; i < res.steps.length; i++) {
    const st = res.steps[i];
    maxRun = Math.max(maxRun, longestRun(pre)); // incoming board of wave i
    let waveRaw = 0;
    const coloursSeen = new Set();
    for (const cell of st.matches) {
      const t = pre[cell.r][cell.c];
      coloursSeen.add(t);
      let v = gemValue(t, pre);
      if (t === featured) v *= FEATURED_MULT;
      waveRaw += v;
    }
    for (const t of coloursSeen) state.matchCounts[t]++;
    raw += waveRaw * cascadeFactor(i);
    pre = st.board;
  }

  state.mult = matchMultiplier(state.mult, maxRun);
  let gain = raw * state.mult;
  const bonus = hintSnap && !samePair(hintSnap, { a, b }) ? DEVIATION_BONUS : 0;
  gain += bonus;

  // ---- update the logical state up-front (hooks read live) -----------
  state.board = res.board;
  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = bonus;
  const prevStage = state.stage;
  state.stage = stageForScore(state.score);
  if (state.score > state.best) { state.best = state.score; saveBest(state.best); }
  state.peek = refillQueue(peekRng(), TYPES, state.favoured, PEEK_LEN);
  updateHud();

  // ---- play it out ----------------------------------------------------
  await renderer.animateSwap(a, b);
  if (token !== moveToken) return;
  let preB = swapped;
  for (let i = 0; i < res.steps.length; i++) {
    if (i > 0) showCascadePop(i);
    await renderer.animateWave(preB, res.steps[i].matches, res.steps[i].board);
    if (token !== moveToken) return;
    preB = res.steps[i].board;
  }
  showGainPop(gain, bonus, b);

  if (state.stage !== prevStage) {
    renderer.applyStage(state.stage);
    showStageBanner(state.stage);
    updateHud();
  }

  if (!hasValidMove(state.board)) {
    state.gameOver = true;
    showGameOver();
  } else {
    restartIdle();
  }
  state.animating = false;
  updateHud();
}

/* ================================================================== *
 * Idle hint
 * ================================================================== */

let idleTimer = 0;
function restartIdle() {
  clearTimeout(idleTimer);
  if (state.gameOver) return;
  idleTimer = setTimeout(() => {
    if (state.animating || state.gameOver || drag) { restartIdle(); return; }
    const mv = findFirstMove(state.board);
    if (mv) { state.hint = mv; renderer.setHint(mv); }
  }, 10000);
}
function clearHint() {
  state.hint = null;
  renderer.setHint(null);
}

/* ================================================================== *
 * HUD & feedback
 * ================================================================== */

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function updateHud() {
  $('score-num').textContent = fmt(state.score);
  $('best-num').textContent = fmt(state.best);
  $('lastgain-num').textContent = state.lastGain
    ? `+${fmt(state.lastGain)}${state.lastBonus ? ` (incl. +${state.lastBonus} bonus)` : ''}`
    : '0';
  const badge = $('mult-badge');
  const mTxt = `×${state.mult}`;
  if (badge.textContent !== mTxt) {
    badge.textContent = mTxt;
    badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop');
  }
  $('mult-detail').textContent = mTxt;
  const th = stageTheme(state.stage);
  $('stage-name').textContent = `${state.stage + 1} — ${th.name}`;

  const featured = featuredTypeNow();
  $('featured-swatch').innerHTML = swatchSVG(featured);
  $('featured-text').innerHTML = `HOT this stage: <b>${GEMS[featured].name}</b> pays`;
  $('featured-mult').textContent = `×${FEATURED_MULT}`;

  const values = gemValuesNow();
  $('ledger').innerHTML = GEMS.map((g, t) => {
    const cls = ['ledger-row', t === featured ? 'featured' : '', t === state.favoured ? 'lucky' : ''].join(' ');
    const hot = t === featured ? ` <span class="note">HOT ×${FEATURED_MULT}</span>` : '';
    const lucky = t === state.favoured ? ' <span class="note lucky-tag">LUCKY</span>' : '';
    return `<div class="${cls}">${swatchSVG(t)}<span class="nm">${g.name}${hot}${lucky}<br>
      <span class="note">${g.note}</span></span><span class="val">${fmt(values[t])}</span></div>`;
  }).join('');

  $('peek-rail').innerHTML = state.peek.map((t) => swatchSVG(t)).join('');
  $('lucky-swatch').innerHTML = state.favoured === null ? '' : swatchSVG(state.favoured);
  $('lucky-name').textContent = state.favoured === null ? '—' : GEMS[state.favoured].name;
}

function boardCenterPx() {
  const p1 = renderer.projectCell(3, 3), p2 = renderer.projectCell(4, 4);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function showGainPop(gain, bonus, cell) {
  const p = renderer.projectCell(cell.r, cell.c);
  const el = document.createElement('div');
  el.className = 'float-gain';
  const size = Math.min(3.4, 1.5 + Math.log10(Math.max(10, gain)) * 0.45);
  el.style.fontSize = `${size}rem`;
  el.style.left = `${p.x}px`;
  el.style.top = `${Math.max(40, p.y - cellSizePx)}px`;
  el.innerHTML = `+${fmt(gain)}${bonus ? `<span class="bonus-tag">+${bonus} deviation bonus!</span>` : ''}`;
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function showCascadePop(waveIdx) {
  const c = boardCenterPx();
  const el = document.createElement('div');
  el.className = 'cascade-pop';
  el.style.fontSize = `${Math.min(3, 1.1 + waveIdx * 0.35)}rem`;
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y - cellSizePx * 2 - waveIdx * 8}px`;
  el.textContent = `CASCADE ×${cascadeFactor(waveIdx)}!`;
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function showStageBanner(stage) {
  const th = stageTheme(stage);
  const el = document.createElement('div');
  el.className = 'stage-banner';
  el.innerHTML = `<h3>Stage ${stage + 1} — ${th.name}</h3>
    <p>${swatchSVG(th.featured)} ${GEMS[th.featured].name} is HOT: ×${FEATURED_MULT} value!</p>`;
  bannerLayer.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function showGameOver() {
  $('gameover-score').textContent = `Final score: ${fmt(state.score)}${state.score >= state.best ? ' — new best!' : ''}`;
  $('gameover-banner').classList.add('show');
  $('new-game').classList.add('urge');
}
function hideGameOver() {
  $('gameover-banner').classList.remove('show');
  $('new-game').classList.remove('urge');
}

/* ================================================================== *
 * New game, HUD toggle, camera buttons
 * ================================================================== */

function newGame() {
  moveToken++;
  state.board = createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0; state.lastGain = 0; state.lastBonus = 0;
  state.mult = 1; state.stage = 0; state.favoured = null;
  state.matchCounts = new Array(TYPES).fill(0);
  state.gameOver = false; state.animating = false;
  state.peek = refillQueue(peekRng(), TYPES, null, PEEK_LEN);
  clearHint();
  hideGameOver();
  renderer.applyStage(0);
  renderer.buildBoard(state.board);
  updateHud();
  restartIdle();
}

$('new-game').addEventListener('click', newGame);

$('hud-toggle').addEventListener('click', () => {
  const hud = $('hud');
  const collapsed = hud.classList.toggle('collapsed');
  const btn = $('hud-toggle');
  btn.textContent = collapsed ? 'Show HUD' : 'Hide HUD';
  btn.setAttribute('aria-expanded', String(!collapsed));
});

$('cam-reset').addEventListener('click', () => renderer.resetView());
$('zoom-in').addEventListener('click', () => renderer.zoomBy(1.18));
$('zoom-out').addEventListener('click', () => renderer.zoomBy(1 / 1.18));

// orbit by dragging the sky (the canvas — hit cells swallow board drags)
{
  let orbiting = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (pinch) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
    orbiting = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!orbiting || orbiting.id !== e.pointerId || pinch) return;
    renderer.orbit((e.clientX - orbiting.x) * -0.005, (e.clientY - orbiting.y) * -0.004);
    orbiting.x = e.clientX; orbiting.y = e.clientY;
  });
  const end = (e) => { if (orbiting && orbiting.id === e.pointerId) orbiting = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

new ResizeObserver(() => renderer.resize()).observe(stageWrap);
window.addEventListener('resize', () => renderer.resize());

/* ================================================================== *
 * Observation hooks (the gate reads these; it never drives through them)
 * ================================================================== */

window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.mult,
  gemValues: () => gemValuesNow(),
  stage: () => stageForScore(state.score),
  featuredType: () => featuredTypeNow(),
  featuredMultiplier: () => FEATURED_MULT,
  favouredType: () => state.favoured,
  nextColours: () => state.peek.slice(),
  bestScore: () => state.best,
  validMove: () => findFirstMove(state.board),
  board: () => state.board.map((row) => [...row]),
  gameOver: () => state.gameOver,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
};

/* ================================================================== *
 * Boot & main loop
 * ================================================================== */

state.board = createBoard(ROWS, COLS, TYPES, rng);
state.peek = refillQueue(peekRng(), TYPES, null, PEEK_LEN);
renderer.applyStage(0);
renderer.buildBoard(state.board);
updateHud();
restartIdle();

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tickTweens(now);
  renderer.update(dt, now / 1000);
  updateHitCells();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
