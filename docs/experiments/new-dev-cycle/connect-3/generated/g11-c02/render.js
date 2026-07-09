// render.js — 3D world, input, scoring, HUD, sound.
// Theme: "Gem Fiesta" — a sunlit Mediterranean festival plaza. Bright turquoise
// sky, string-light bunting, a vivid cobalt-and-flame tiled board that pops.
import * as GAME from './game.js';

const ROWS = 8, COLS = 8;
const NTYPES_MAX = 6;

// ---- deterministic-ish RNG for the game (seeded from time; gate only needs a move) ----
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = makeRng((Date.now() ^ (Math.random() * 1e9)) | 0);

// ---- gem palette: 6 colours, distinct HUE and distinct SHAPE (colour-blind safe) ----
// name, hex, three-colour, css gradient, and a scoring scheme descriptor.
const GEMS = [
  { name: 'Ruby',    hex: 0xff3b5c, css: '#ff3b5c', shape: 'octa',   scheme: 'exp',    desc: 'cheap, DOUBLES each match' },
  { name: 'Amber',   hex: 0xffb01f, css: '#ffb01f', shape: 'diamond',scheme: 'flat',   desc: 'expensive, flat 50' },
  { name: 'Emerald', hex: 0x25d07a, css: '#25d07a', shape: 'cube',   scheme: 'grow',   desc: 'grows +6 every match' },
  { name: 'Sapphire',hex: 0x2f7bff, css: '#2f7bff', shape: 'sphere', scheme: 'rare',   desc: 'worth more when rare' },
  { name: 'Amethyst',hex: 0xb455ff, css: '#b455ff', shape: 'prism',  scheme: 'flat15', desc: 'steady 15' },
  { name: 'Citrine', hex: 0xf4e04a, css: '#f4e04a', shape: 'star',   scheme: 'stage',  desc: 'grows with the stage' },
];

// ---- stage themes ----
// featured index MUST be < typesForStage(stage) so the HOT colour is actually in
// play: stage 0 has 4 colours (0..3), stage 1 has 5 (0..4), stage 2+ all 6.
const STAGES = [
  { name: 'Plaza del Sol',   sky: [0x3aa7ff, 0xeafaff], ground: 0x18b2c9, featured: 2 }, // 4 colours: Emerald
  { name: 'Golden Terrace',  sky: [0xffa63d, 0xfff0c2], ground: 0xd98a2b, featured: 4 }, // 5 colours: Amethyst
  { name: 'Rosa Carnival',   sky: [0xff5fa2, 0xffe3f1], ground: 0xd83f8a, featured: 5 }, // 6: Citrine
  { name: 'Verde Fiesta',    sky: [0x2fd36f, 0xe7ffe9], ground: 0x1f9e56, featured: 0 },  // Ruby
  { name: 'Azure Nocturne',  sky: [0x1f4bd8, 0x9fd0ff], ground: 0x123e9e, featured: 3 },  // Sapphire
  { name: 'Amber Grand',     sky: [0xff7a2f, 0xffe0a8], ground: 0xd8641f, featured: 1 },  // Amber
];
const FEATURED_MULT = 3;

function stageInfo(stage) { return STAGES[Math.min(stage, STAGES.length - 1)]; }

// ================= GAME STATE =================
let board = null;
let score = 0, best = 0, lastGain = 0, lastBonus = 0, multiplier = 1;
let stage = 0, currentTypes = 4;
let favoured = null;                 // last actively-cleared colour
let gemLevels = null;                // per-colour dynamic state for scoring
let gameOver = false;
let busy = false;                    // mid-animation lock
let hint = null;                     // {a,b} currently shown
let hintDeadline = 0;
let peekRng, peekColours = [];

const BEST_KEY = 'gemfiesta.best.v1';

function loadBest() {
  try { const v = parseInt(localStorage.getItem(BEST_KEY) || '0', 10); return Number.isFinite(v) ? v : 0; }
  catch { return 0; }
}
function saveBest() { try { localStorage.setItem(BEST_KEY, String(best)); } catch {} }

// ---- per-colour value model (candidate designed; varied) ----
function resetGemLevels() {
  gemLevels = { exp: 5, grow: 20 };  // exp: doubles; grow: +6/match
}
function boardColourCount(colour) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c] === colour) n++;
  return n;
}
// current per-gem base value for a colour (before featured boost)
function baseValue(colour) {
  const g = GEMS[colour];
  switch (g.scheme) {
    case 'exp':   return Math.min(gemLevels.exp, 640);
    case 'flat':  return 50;
    case 'grow':  return gemLevels.grow;
    case 'rare': { const n = boardColourCount(colour); return Math.round(400 / Math.max(1, n)); }
    case 'flat15':return 15;
    case 'stage': return 12 * (1 + stage);
    default:      return 10;
  }
}
function featuredType() { return stageInfo(stage).featured; }
function isFeatured(colour) { return colour === featuredType(); }
function gemValueNow(colour) {
  return baseValue(colour) * (isFeatured(colour) ? FEATURED_MULT : 1);
}
function gemValuesArray() {
  const out = [];
  for (let c = 0; c < currentTypes; c++) out.push(gemValueNow(c));
  return out;
}

// ================= SOUND (Web Audio, generated locally) =================
const Sound = (() => {
  let ctx = null, master = null, muted = false;
  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.34;
      master.connect(ctx.destination);
    } catch { ctx = null; }
  }
  function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function tone(freq, t0, dur, type = 'sine', vol = 0.5) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  return {
    setMuted(m) { muted = m; },
    resume,
    // a warm marimba-ish match chime; pitch rises with cascade depth
    match(depth = 0, cells = 3) {
      ensure(); if (!ctx || muted) return;
      const t = ctx.currentTime;
      const root = 392 * Math.pow(2, depth / 12) * (1 + Math.min(cells - 3, 6) * 0.03);
      tone(root, t, 0.22, 'triangle', 0.5);
      tone(root * 1.5, t + 0.02, 0.18, 'sine', 0.3);
      if (depth > 0) tone(root * 2, t + 0.04, 0.16, 'sine', 0.22);
    },
    // a rising arpeggio flourish keyed to cascade depth
    cascade(depth) {
      ensure(); if (!ctx || muted) return;
      const t = ctx.currentTime;
      const base = 330 + depth * 70;
      [0, 4, 7, 12].forEach((semi, i) => tone(base * Math.pow(2, semi / 12), t + i * 0.05, 0.2, 'triangle', 0.34));
    },
    invalid() {
      ensure(); if (!ctx || muted) return;
      const t = ctx.currentTime;
      tone(180, t, 0.12, 'sawtooth', 0.25); tone(120, t + 0.06, 0.12, 'sawtooth', 0.22);
    },
    stageUp() {
      ensure(); if (!ctx || muted) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.11, 0.4, 'triangle', 0.42));
    },
  };
})();

// ================= RENDERER (WebGL via three.js, DOM fallback) =================
let three = null;   // { scene, camera, renderer, gemMeshes, ... } when WebGL
let domMode = false;
const sceneEl = document.getElementById('scene');
const hitsEl = document.getElementById('hits');

let camYaw = 0, camPitch = 0.62;      // pitch>0 leans board toward viewer / from above
const DEFAULT_YAW = 0, DEFAULT_PITCH = 0.62;
let camDist = 14.5;
let camDirty = true;                  // recompute hit-cell projection only when the view moves
const GAP = 1.12;                     // world spacing per cell
const HALF = (COLS - 1) / 2 * GAP;

function tryInitWebGL() {
  try {
    const THREE = three_ns;
    const canvasTest = document.createElement('canvas');
    const gl = canvasTest.getContext('webgl2') || canvasTest.getContext('webgl');
    if (!gl) return false;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    // software GL in the sandbox is fill-rate bound: render at reduced internal
    // resolution and let the browser upscale, so frames stay fast.
    renderer.setPixelRatio(0.67);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.shadowMap.enabled = false; // shadows are far too slow under swiftshader
    sceneEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 200);

    // lights: bright sunlit key + warm fill + sky ambient
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2f6ea0, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(6, 14, 8);
    scene.add(sun);
    const rim = new THREE.PointLight(0xffd27a, 0.8, 60);
    rim.position.set(-8, 6, 10); scene.add(rim);

    // sky dome (vertex-coloured gradient)
    const skyGeo = new THREE.SphereGeometry(90, 20, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0x3aa7ff) }, bot: { value: new THREE.Color(0xeafaff) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h = clamp((vP.y/90.0)*0.5+0.5,0.0,1.0); gl_FragColor = vec4(mix(bot, top, h),1.0);} ',
    });
    const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

    // ground plane (fades out at steep tilt so it never clips)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x14a3bd, roughness: 0.85, metalness: 0.05, transparent: true, opacity: 1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 40), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -4.2;
    scene.add(ground);

    // ---- the VIVID board: a cobalt tiled slab with a flame-orange rim ----
    const boardGroup = new THREE.Group();
    const slabW = COLS * GAP + 1.4;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(slabW, 0.8, slabW),
      new THREE.MeshStandardMaterial({ color: 0x1b46c9, roughness: 0.35, metalness: 0.5, emissive: 0x0a1f6e, emissiveIntensity: 0.35 }),
    );
    slab.position.y = -0.75; boardGroup.add(slab);
    const rimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(slabW + 0.7, 0.5, slabW + 0.7),
      new THREE.MeshStandardMaterial({ color: 0xff5a2c, roughness: 0.3, metalness: 0.4, emissive: 0xff3b0e, emissiveIntensity: 0.4 }),
    );
    rimMesh.position.y = -1.05; boardGroup.add(rimMesh);
    // checker inlay tiles on top of slab for vividness/contrast
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(GAP * 0.94, 0.12, GAP * 0.94),
        new THREE.MeshStandardMaterial({
          color: (r + c) % 2 ? 0x2f74ff : 0x123a9e,
          roughness: 0.4, metalness: 0.3,
          emissive: (r + c) % 2 ? 0x1440aa : 0x081f66, emissiveIntensity: 0.3,
        }),
      );
      tile.position.set(c * GAP - HALF, -0.32, r * GAP - HALF);
      boardGroup.add(tile);
    }
    scene.add(boardGroup);

    // The camera looks down, so the sky band visible above the board is the low
    // horizon. Dress it: a warm sun, soft clouds, and a festive pennant line.
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    );
    sunDisc.position.set(-7, 1.6, -9.5);
    scene.add(sunDisc);
    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.35 }),
    );
    sunGlow.position.copy(sunDisc.position);
    scene.add(sunGlow);

    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    for (const cp of [[6.5, 1.8, -10], [-2.5, 2.0, -11]]) {
      const cloud = new THREE.Group();
      for (const off of [[0, 0], [1.5, -0.25], [-1.5, -0.25]]) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), cloudMat);
        puff.position.set(cp[0] + off[0], cp[1] + off[1], cp[2]);
        cloud.add(puff);
      }
      scene.add(cloud);
    }

    // festive pennant line strung low across the sky behind the board
    const buntColors = [0xff3b5c, 0xffb01f, 0x25d07a, 0x2f7bff, 0xb455ff, 0xf4e04a];
    const buntGroup = new THREE.Group();
    for (let i = 0; i < 17; i++) {
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.55, 4),
        new THREE.MeshStandardMaterial({ color: buntColors[i % 6], emissive: buntColors[i % 6], emissiveIntensity: 0.75, roughness: 0.5 }),
      );
      const u = i / 16 - 0.5;
      flag.position.set(u * 15, 1.35 - Math.cos(u * Math.PI) * 0.4, -6.4);
      flag.rotation.x = Math.PI; // point down like a pennant
      buntGroup.add(flag);
    }
    scene.add(buntGroup);

    // gem meshes
    const gemMeshes = [];
    for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c < COLS; c++) row.push(null); gemMeshes.push(row); }

    three = { THREE, scene, camera, renderer, sun, hemi, boardGroup, ground, groundMat, sky, skyMat, gemMeshes, tiles: boardGroup, floating: [] };
    return true;
  } catch (e) {
    console.warn('WebGL init failed, using DOM fallback', e);
    if (three && three.renderer) { try { three.renderer.domElement.remove(); } catch {} }
    three = null;
    return false;
  }
}

// geometry per shape
function makeGemGeometry(THREE, shape) {
  switch (shape) {
    case 'octa':    return new THREE.OctahedronGeometry(0.5, 0);
    case 'diamond': return new THREE.OctahedronGeometry(0.52, 0);  // stretched below
    case 'cube':    return new THREE.BoxGeometry(0.72, 0.72, 0.72);
    case 'sphere':  return new THREE.SphereGeometry(0.5, 16, 12);
    case 'prism':   return new THREE.CylinderGeometry(0.5, 0.5, 0.7, 6);
    case 'star':    return new THREE.DodecahedronGeometry(0.52, 0);
    default:        return new THREE.IcosahedronGeometry(0.5, 0);
  }
}
function buildGemMesh(THREE, colour) {
  const g = GEMS[colour];
  const geo = makeGemGeometry(THREE, g.shape);
  // MeshStandardMaterial (no transmission): jewel-like via low roughness + glow,
  // but cheap enough for software WebGL to hit a smooth frame rate.
  const mat = new THREE.MeshStandardMaterial({
    color: g.hex, metalness: 0.35, roughness: 0.18,
    emissive: g.hex, emissiveIntensity: 0.28, flatShading: g.shape !== 'sphere',
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (g.shape === 'diamond') mesh.scale.set(1, 1.5, 1);
  mesh.userData.colour = colour;
  return mesh;
}

function worldPos(r, c, y = 0.2) {
  return [c * GAP - HALF, y, r * GAP - HALF];
}

// place / rebuild all gem meshes from board
function syncGemMeshes() {
  if (!three) return;
  const { THREE, scene, gemMeshes } = three;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const colour = board[r][c];
    let m = gemMeshes[r][c];
    if (!m || m.userData.colour !== colour) {
      if (m) scene.remove(m);
      m = buildGemMesh(THREE, colour);
      scene.add(m);
      gemMeshes[r][c] = m;
    }
    const [x, y, z] = worldPos(r, c);
    m.position.set(x, y, z);
    m.visible = true;
    m.userData.baseY = y;
  }
}

// Choose a camera distance so the whole board sits inside a safe on-screen box
// (below the top overlays, above the bottom HUD, inset from the sides). Keeps
// every one of the 64 cell centres inside the viewport on any aspect ratio.
function frameToFit() {
  if (!three) return;
  const { camera } = three;
  const topInset = 118, botInset = 44, sideInset = 8;
  const corners = [[0, 0], [0, COLS - 1], [ROWS - 1, 0], [ROWS - 1, COLS - 1]];
  const fits = (dist) => {
    const cx = Math.sin(camYaw) * Math.cos(camPitch) * dist;
    const cz = Math.cos(camYaw) * Math.cos(camPitch) * dist;
    const cy = Math.sin(camPitch) * dist;
    camera.position.set(cx, cy, cz);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const [r, c] of corners) {
      const p = projectToScreen(...worldPos(r, c));
      if (p.x < sideInset || p.x > window.innerWidth - sideInset) return false;
      if (p.y < topInset || p.y > window.innerHeight - botInset) return false;
    }
    return true;
  };
  let lo = 10, hi = 46;
  if (fits(lo)) { camDist = lo; }
  else {
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    camDist = hi;
  }
  camDirty = true;
}

function applyCamera() {
  if (!three) return;
  const { camera } = three;
  const cx = Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cz = Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  const cy = Math.sin(camPitch) * camDist;
  camera.position.set(cx, cy, cz);
  camera.lookAt(0, 0, 0);
  // fade the ground as we look from high above so it never clips the pieces
  if (three.groundMat) {
    const t = Math.max(0, (camPitch - 0.85) / 0.6);
    three.groundMat.opacity = Math.max(0, 1 - t);
    three.ground.visible = three.groundMat.opacity > 0.02;
  }
}

// ---- project a world point to screen px (for hit-cell placement) ----
function projectToScreen(x, y, z) {
  const { THREE, camera } = three;
  const v = new THREE.Vector3(x, y, z).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  };
}

// ================= HIT CELLS =================
const hitCells = [];        // hitCells[r][c] = element
function buildHitCells() {
  hitsEl.innerHTML = '';
  hitCells.length = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'hitcell';
      el.dataset.testid = 'cell';
      el.dataset.r = r; el.dataset.c = c;
      hitsEl.appendChild(el);
      row.push(el);
    }
    hitCells.push(row);
  }
  positionHitCells();
}

function positionHitCells() {
  if (domMode) return positionHitCellsDom();
  if (!three) return;
  // cell size in px: project two adjacent centres
  const p00 = projectToScreen(...worldPos(0, 0));
  const p01 = projectToScreen(...worldPos(0, 1));
  const p10 = projectToScreen(...worldPos(1, 0));
  const dx = Math.hypot(p01.x - p00.x, p01.y - p00.y);
  const dy = Math.hypot(p10.x - p00.x, p10.y - p00.y);
  const sizeX = Math.max(24, dx * 0.94);
  const sizeY = Math.max(24, dy * 0.94);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = projectToScreen(...worldPos(r, c));
    const el = hitCells[r][c];
    el.style.width = sizeX + 'px';
    el.style.height = sizeY + 'px';
    el.style.left = (p.x - sizeX / 2) + 'px';
    el.style.top = (p.y - sizeY / 2) + 'px';
  }
}

// ================= DOM FALLBACK WORLD =================
let domBoardEl = null, domCells = [];
function initDom() {
  domMode = true;
  sceneEl.classList.add('dom-mode');
  sceneEl.innerHTML = `
    <div id="dom-sun"></div>
    <div id="dom-flags"></div>
    <div id="dom-tilt"><div id="dom-board"></div></div>`;
  domBoardEl = document.getElementById('dom-board');
  layoutDomBoard();
  domCells = [];
  for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c < COLS; c++) row.push(null); domCells.push(row); }
}
function layoutDomBoard() {
  const bs = Math.min(window.innerWidth - 20, window.innerHeight - 190, 560);
  document.documentElement.style.setProperty('--bs', bs + 'px');
  document.getElementById('dom-tilt').style.transform = `rotateX(${(0.6 - camPitch) * 26}deg) rotateY(${camYaw * 22}deg)`;
}
function domCellSize() {
  const bs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bs')) || 480;
  return (bs - 20) / COLS; // minus border
}
function domGemEl(colour) {
  const g = GEMS[colour];
  const wrap = document.createElement('div');
  wrap.className = 'gem-body';
  const s = domCellSize();
  const shape = document.createElement('div');
  shape.className = 'gem-shape';
  shape.style.background = `radial-gradient(circle at 34% 30%, #fff 0%, ${g.css} 42%, ${shade(g.css, -0.35)} 100%)`;
  shape.style.width = shape.style.height = '84%';
  shape.style.margin = '8%';
  shape.style.boxShadow = `inset 0 -6px 12px ${shade(g.css,-0.4)}, 0 3px 8px rgba(0,0,0,.35)`;
  shape.style.clipPath = clipFor(g.shape);
  wrap.appendChild(shape);
  return wrap;
}
function clipFor(shape) {
  switch (shape) {
    case 'octa':    return 'polygon(50% 0,100% 50%,50% 100%,0 50%)';
    case 'diamond': return 'polygon(50% 0,80% 38%,50% 100%,20% 38%)';
    case 'cube':    return 'polygon(15% 15%,85% 15%,85% 85%,15% 85%)';
    case 'sphere':  return 'circle(48% at 50% 50%)';
    case 'prism':   return 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)';
    case 'star':    return 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)';
    default:        return 'circle(48% at 50% 50%)';
  }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt * 255));
  g = Math.max(0, Math.min(255, g + amt * 255));
  b = Math.max(0, Math.min(255, b + amt * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function syncDomGems() {
  const s = domCellSize();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const colour = board[r][c];
    let cell = domCells[r][c];
    if (!cell || cell.dataset.colour !== String(colour)) {
      if (cell) cell.remove();
      cell = document.createElement('div');
      cell.className = 'gem';
      cell.dataset.colour = colour;
      cell.style.width = cell.style.height = s + 'px';
      cell.appendChild(domGemEl(colour));
      domBoardEl.appendChild(cell);
      domCells[r][c] = cell;
    }
    cell.style.transform = `translate(${c * s}px, ${r * s}px)`;
  }
}
function positionHitCellsDom() {
  const rect = domBoardEl.getBoundingClientRect();
  const s = rect.width / COLS;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const el = hitCells[r][c];
    el.style.width = (s * 0.94) + 'px';
    el.style.height = (s * 0.94) + 'px';
    el.style.left = (rect.left + c * s + s * 0.03) + 'px';
    el.style.top = (rect.top + r * s + s * 0.03) + 'px';
  }
}

// ================= ANIMATION LOOP =================
let raf = 0, tPrev = 0, camAnim = null;
function loop(t) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - tPrev) / 1000 || 0); tPrev = t;
  if (camAnim) {
    camAnim.e += dt / camAnim.dur;
    const k = Math.min(1, camAnim.e);
    const ease = 1 - Math.pow(1 - k, 3);
    camYaw = camAnim.y0 + (camAnim.y1 - camAnim.y0) * ease;
    camPitch = camAnim.p0 + (camAnim.p1 - camAnim.p0) * ease;
    camDist = camAnim.d0 + (camAnim.d1 - camAnim.d0) * ease;
    if (k >= 1) camAnim = null;
  }
  if (three) {
    const { renderer, scene, camera, gemMeshes } = three;
    // gentle spin + bob for life (visual only; does not move hit cells)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const m = gemMeshes[r][c];
      if (m && m.visible && !m.userData.animating) {
        m.rotation.y += dt * 0.5;
        m.position.y = (m.userData.baseY ?? 0.2) + Math.sin(t / 600 + (r + c)) * 0.05;
      }
    }
    if (camDirty || camAnim) { applyCamera(); positionHitCells(); camDirty = false; }
    renderer.render(scene, camera);
  } else if (domMode) {
    if (camDirty) { layoutDomBoard(); positionHitCellsDom(); camDirty = false; }
  }
}

// ---- three.js module namespace (loaded dynamically so a load failure still gives DOM fallback) ----
let three_ns = null;

// ================= MOVE / SCORING =================
function neighbour(a, dir) {
  const map = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const [dr, dc] = map[dir];
  return { r: a.r + dr, c: a.c + dc };
}
function inBounds(p) { return p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS; }

function computeMoveScore(steps, hintedPair, movedPair) {
  // longest run across all incoming wave boards -> tier -> multiplier
  let longest = 1;
  let incoming = null;
  // step 0 incoming is the swapped board; we don't have it here, so measure each step board too
  for (const s of steps) {
    longest = Math.max(longest, GAME.longestRun(s.board));
  }
  // measure the pre-clear boards via matches count too — use step matches run length
  // (the swapped board's run is captured because step0.matches came from it; approximate with cells)
  // Better: reconstruct run from matches — use max contiguous. We already have wave boards after clear;
  // to get the move's tier reliably, also inspect the largest single-wave match group size.
  for (const s of steps) {
    // a wave clearing k cells in one straight line => run >= k for that line; approximate tier by group size
    longest = Math.max(longest, longestInMatchSet(s.matches));
  }
  multiplier = GAME.matchMultiplier(multiplier, longest);

  let raw = 0;
  const clearedColours = {};
  steps.forEach((s, i) => {
    const factor = GAME.cascadeFactor(i);
    // count cells per colour in this wave, using the wave's PRE-clear colours.
    // s.matches are coords on the pre-clear board; but s.board is post. We reconstruct
    // colours from the value model at time of clear via the colour we tracked on cells.
    let waveRaw = 0;
    for (const cell of s.matches) {
      const colour = cell.colour; // attached below in resolveMove
      waveRaw += gemValueNow(colour);
      clearedColours[colour] = (clearedColours[colour] || 0) + 1;
      bumpColour(colour);
    }
    raw += waveRaw * factor;
  });

  let gain = Math.round(raw * multiplier);

  // deviation bonus
  let bonus = 0;
  if (hintedPair && movedPair && !samePair(hintedPair, movedPair)) {
    bonus = 100;
  }
  gain += bonus;

  // favoured = most cleared colour this move
  let favColour = null, favN = -1;
  for (const k in clearedColours) if (clearedColours[k] > favN) { favN = clearedColours[k]; favColour = +k; }
  if (favColour !== null) favoured = favColour;

  return { gain, bonus, longest };
}
function longestInMatchSet(matches) {
  // approximate the run tier: the biggest straight line among matched cells
  const set = new Set(matches.map((m) => m.r * COLS + m.c));
  let best = matches.length ? 3 : 0;
  // horizontal
  for (let r = 0; r < ROWS; r++) {
    let run = 0;
    for (let c = 0; c < COLS; c++) { if (set.has(r * COLS + c)) { run++; best = Math.max(best, run); } else run = 0; }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 0;
    for (let r = 0; r < ROWS; r++) { if (set.has(r * COLS + c)) { run++; best = Math.max(best, run); } else run = 0; }
  }
  return best;
}
function bumpColour(colour) {
  const g = GEMS[colour];
  if (g.scheme === 'exp') gemLevels.exp = Math.min(gemLevels.exp * 2, 640);
  else if (g.scheme === 'grow') gemLevels.grow += 6;
}
function samePair(p, q) {
  const key = (x) => `${Math.min(x.a.r * 8 + x.a.c, x.b.r * 8 + x.b.c)}-${Math.max(x.a.r * 8 + x.a.c, x.b.r * 8 + x.b.c)}`;
  return key(p) === key(q);
}

// resolve a validated move: play animations wave by wave
async function resolveMove(a, b, hintedAtStart) {
  busy = true;
  clearHint();
  Sound.resume();

  const swapped = GAME.applySwap(board, a, b);
  // attach colours to matches per wave BEFORE clearing so scoring reads pre-clear colours.
  const { steps } = GAME.collapse(swapped, rng, currentTypes, favoured);
  // Re-derive per-wave colours: rebuild the wave incoming boards.
  const waveIncoming = [swapped];
  for (let i = 0; i < steps.length - 1; i++) waveIncoming.push(steps[i].board);
  steps.forEach((s, i) => {
    const inb = waveIncoming[i];
    s.matches = s.matches.map((m) => ({ ...m, colour: inb[m.r][m.c] }));
  });

  // animate the swap itself
  await animateSwap(a, b, swapped);
  board = swapped;

  // play each wave
  const movedPair = { a, b };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await animateClear(s.matches, i);
    Sound.match(i, s.matches.length);
    if (i > 0) { Sound.cascade(i); showCascade(i); }
    board = s.board.map((row) => row.slice());
    await animateDrop();
  }

  // scoring (uses colours attached to matches)
  const { gain, bonus } = computeMoveScore(steps, hintedAtStart, movedPair);
  lastGain = gain; lastBonus = bonus;
  const prevStage = stage;
  score += gain;
  if (score > best) { best = score; saveBest(); }
  stage = GAME.stageForScore(score);
  if (stage !== prevStage) onStageChange(prevStage);
  currentTypes = GAME.typesForStage(stage);

  showGain(gain, bonus);
  refreshPeek();
  updateHud();

  // game over?
  if (!GAME.hasValidMove(board)) enterGameOver();

  busy = false;
  restartIdle();
}

// swap animation (WebGL: slide the two meshes; DOM: reflow)
function animateSwap(a, b, swappedBoard) {
  return new Promise((res) => {
    if (three) {
      const ma = three.gemMeshes[a.r][a.c], mb = three.gemMeshes[b.r][b.c];
      const pa = worldPos(a.r, a.c), pb = worldPos(b.r, b.c);
      if (ma) ma.userData.animating = true;
      if (mb) mb.userData.animating = true;
      const dur = 180; let e = 0, last = performance.now();
      const step = (now) => {
        e += (now - last); last = now;
        const k = Math.min(1, e / dur); const ease = k * k * (3 - 2 * k);
        if (ma) ma.position.set(pa[0] + (pb[0] - pa[0]) * ease, pa[1], pa[2] + (pb[2] - pa[2]) * ease);
        if (mb) mb.position.set(pb[0] + (pa[0] - pb[0]) * ease, pb[1], pb[2] + (pa[2] - pb[2]) * ease);
        if (k < 1) requestAnimationFrame(step);
        else { if (ma) ma.userData.animating = false; if (mb) mb.userData.animating = false; syncGemMeshes(); res(); }
      };
      requestAnimationFrame(step);
    } else {
      // DOM: brief pause then resync
      setTimeout(() => { syncDomGems(); res(); }, 150);
    }
  });
}

function animateClear(matches, depth) {
  return new Promise((res) => {
    // sparks / flash
    for (const m of matches) {
      spawnSparks(m.r, m.c, GEMS[m.colour].css);
      if (three) {
        const mesh = three.gemMeshes[m.r][m.c];
        if (mesh) {
          mesh.userData.animating = true;
          const t0 = performance.now(), dur = 200;
          const anim = (now) => {
            const k = Math.min(1, (now - t0) / dur);
            const s = 1 + k * 0.6; mesh.scale.setScalar(s * (mesh.userData.colour === 1 ? 1 : 1));
            mesh.material.emissiveIntensity = 0.22 + k * 1.2;
            mesh.material.opacity = 1 - k; mesh.material.transparent = true;
            if (k < 1) requestAnimationFrame(anim);
          };
          requestAnimationFrame(anim);
        }
      } else if (domMode) {
        const cell = domCells[m.r][m.c];
        if (cell) { cell.style.transition = 'transform .2s, opacity .2s'; cell.style.opacity = '0'; cell.firstChild.style.transform = 'scale(1.5)'; }
      }
    }
    setTimeout(res, 210);
  });
}

function animateDrop() {
  return new Promise((res) => {
    if (three) {
      syncGemMeshes();
      // physical accelerating drop: start above target, ease-in downward
      const drops = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const m = three.gemMeshes[r][c];
        if (!m) continue;
        m.scale.setScalar(1); m.material.opacity = 1; m.material.transparent = false;
        const [, ty] = worldPos(r, c);
        m.position.y = ty + 3 + r * 0.15;
        m.userData.animating = true;
        drops.push({ m, ty, y0: m.position.y });
      }
      const dur = 240, t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const ease = k * k; // accelerate (ease-in)
        for (const d of drops) { d.m.position.y = d.y0 + (d.ty - d.y0) * ease; }
        if (k < 1) requestAnimationFrame(step);
        else { for (const d of drops) { d.m.position.y = d.ty; d.m.userData.animating = false; d.m.userData.baseY = d.ty; } res(); }
      };
      requestAnimationFrame(step);
    } else if (domMode) {
      // rebuild with a falling transition
      const s = domCellSize();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const colour = board[r][c];
        let cell = domCells[r][c];
        if (!cell || cell.dataset.colour !== String(colour)) {
          if (cell) cell.remove();
          cell = document.createElement('div'); cell.className = 'gem'; cell.dataset.colour = colour;
          cell.style.width = cell.style.height = s + 'px';
          cell.appendChild(domGemEl(colour));
          domBoardEl.appendChild(cell);
          domCells[r][c] = cell;
          cell.style.transform = `translate(${c * s}px, ${-(r + 2) * s}px)`;
          cell.style.opacity = '1';
          requestAnimationFrame(() => {
            cell.style.transition = 'transform .24s cubic-bezier(.55,0,.85,.5)';
            cell.style.transform = `translate(${c * s}px, ${r * s}px)`;
          });
        } else {
          cell.style.transition = 'transform .24s cubic-bezier(.55,0,.85,.5)';
          cell.style.opacity = '1';
          cell.firstChild.style.transform = '';
          cell.style.transform = `translate(${c * s}px, ${r * s}px)`;
        }
      }
      setTimeout(res, 250);
    } else res();
  });
}

function spawnSparks(r, c, css) {
  const p = domMode ? domCentre(r, c) : projectToScreen(...worldPos(r, c));
  const pop = document.getElementById('popups');
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = p.x + 'px'; s.style.top = p.y + 'px';
    s.style.background = css;
    const ang = Math.random() * Math.PI * 2, dist = 26 + Math.random() * 30;
    s.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--sy', Math.sin(ang) * dist + 'px');
    pop.appendChild(s);
    setTimeout(() => s.remove(), 560);
  }
}
function domCentre(r, c) {
  const el = hitCells[r] && hitCells[r][c];
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const rc = el.getBoundingClientRect();
  return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
}

// ================= FEEDBACK POPUPS =================
function showGain(gain, bonus) {
  const pop = document.getElementById('popups');
  const el = document.createElement('div'); el.className = 'gain-pop';
  el.style.fontSize = Math.min(72, 30 + Math.log2(Math.max(2, gain)) * 6) + 'px';
  el.textContent = '+' + gain.toLocaleString();
  pop.appendChild(el);
  setTimeout(() => el.remove(), 1650);
  if (bonus > 0) {
    const b = document.createElement('div'); b.className = 'bonus-pop';
    b.textContent = 'OFF-HINT +' + bonus + '!';
    pop.appendChild(b); setTimeout(() => b.remove(), 1850);
  }
}
function showCascade(depth) {
  const pop = document.getElementById('popups');
  const el = document.createElement('div'); el.className = 'cascade-pop';
  el.style.fontSize = (28 + depth * 10) + 'px';
  el.textContent = `CASCADE ×${GAME.cascadeFactor(depth)}!`;
  pop.appendChild(el); setTimeout(() => el.remove(), 900);
}
function onStageChange(prev) {
  Sound.stageUp();
  const info = stageInfo(stage);
  const banner = document.getElementById('stage-banner');
  banner.innerHTML = `<div class="big">STAGE ${stage + 1}</div><div class="sub">${info.name} — ${currentColoursMsg()}</div>`;
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
  applyStageTheme();
}
function currentColoursMsg() {
  const n = GAME.typesForStage(stage);
  return `${n} gems in play · HOT: ${GEMS[featuredType()].name}`;
}
function applyStageTheme() {
  const info = stageInfo(stage);
  if (three) {
    three.skyMat.uniforms.top.value.setHex(info.sky[0]);
    three.skyMat.uniforms.bot.value.setHex(info.sky[1]);
    three.groundMat.color.setHex(info.ground);
  }
  const [t, b] = info.sky.map((h) => '#' + h.toString(16).padStart(6, '0'));
  document.body.style.background = `linear-gradient(180deg, ${t} 0%, ${b} 62%, ${shade(b, -0.15)} 63%, ${shade(t, -0.4)} 100%)`;
  document.getElementById('stageChip').textContent = info.name.toUpperCase();
}

// ================= HINT / IDLE =================
let idleTimer = 0;
function restartIdle() {
  clearTimeout(idleTimer);
  clearHint();
  if (gameOver) return;
  idleTimer = setTimeout(showHint, 10000);
}
function showHint() {
  if (busy || gameOver) return;
  const mv = findValidMove();
  if (!mv) return;
  hint = mv;
  markHintVisual(mv, true);
}
function clearHint() {
  if (hint) markHintVisual(hint, false);
  hint = null;
}
function markHintVisual(mv, on) {
  const set = (p) => {
    if (three) {
      const m = three.gemMeshes[p.r][p.c];
      if (m) { m.userData.hint = on; m.material.emissiveIntensity = on ? 0.9 : 0.22; }
    } else if (domMode) {
      const cell = domCells[p.r][p.c];
      if (cell) cell.firstChild.classList.toggle('hinting', on);
    }
  };
  set(mv.a); set(mv.b);
}
function findValidMove() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c + 1 < COLS && GAME.isValidSwap(board, { r, c }, { r, c: c + 1 })) return { a: { r, c }, b: { r, c: c + 1 } };
    if (r + 1 < ROWS && GAME.isValidSwap(board, { r, c }, { r: r + 1, c })) return { a: { r, c }, b: { r: r + 1, c } };
  }
  return null;
}

// ================= INPUT: slide gesture on document =================
let drag = null;
function cellFromEvent(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.classList.contains('hitcell')) return { r: +el.dataset.r, c: +el.dataset.c };
  return null;
}
function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  Sound.resume();
  if (busy || gameOver) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  e.preventDefault();
  drag = { start: cell, x0: e.clientX, y0: e.clientY, id: e.pointerId };
  const hc = hitCells[cell.r][cell.c];
  if (hc && hc.setPointerCapture) { try { hc.setPointerCapture(e.pointerId); } catch {} }
}
function onPointerMove(e) {
  if (!drag) return;
  e.preventDefault();
}
function onPointerUp(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  const cell = drag.start;
  drag = null;
  const cellPx = currentCellPx();
  const thresh = Math.max(16, cellPx * 0.4);
  if (Math.hypot(dx, dy) < thresh) return; // released on origin -> no move (cancel)
  let dir;
  if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
  else dir = dy > 0 ? 'down' : 'up';
  const target = neighbour(cell, dir);
  if (!inBounds(target)) return;
  const hintedAtStart = hint ? { a: hint.a, b: hint.b } : null;
  if (GAME.isValidSwap(board, cell, target)) {
    resolveMove(cell, target, hintedAtStart);
  } else {
    Sound.invalid();
    wobble(cell, target);
  }
}
function currentCellPx() {
  const el = hitCells[0][0];
  if (!el) return 48;
  return el.getBoundingClientRect().width;
}
function wobble(a, b) {
  // brief invalid feedback: nudge and return
  const nudge = (p) => {
    const cell = three ? three.gemMeshes[p.r][p.c] : (domCells[p.r] && domCells[p.r][p.c]);
    if (!cell) return;
    if (three) {
      const base = cell.position.x;
      cell.position.x = base + 0.12;
      setTimeout(() => { cell.position.x = base - 0.12; }, 70);
      setTimeout(() => { cell.position.x = base; }, 140);
    } else {
      cell.firstChild.style.transition = 'transform .07s';
      cell.firstChild.style.transform = 'translateX(6px)';
      setTimeout(() => { cell.firstChild.style.transform = 'translateX(-6px)'; }, 70);
      setTimeout(() => { cell.firstChild.style.transform = ''; }, 140);
    }
  };
  nudge(a); nudge(b);
}

// ================= CAMERA CONTROLS (orbit on empty scene) =================
let camDrag = null;
function onScenePointerDown(e) {
  Sound.resume();
  // only when not on a hit cell
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.classList.contains('hitcell')) return;
  if (el && el.closest && el.closest('#controls, #hud, #gameover')) return;
  camDrag = { x: e.clientX, y: e.clientY };
}
function onSceneMove(e) {
  if (!camDrag) return;
  const dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
  camDrag.x = e.clientX; camDrag.y = e.clientY;
  camYaw += dx * 0.006;
  camYaw = Math.max(-0.9, Math.min(0.9, camYaw));
  camPitch += dy * 0.006;
  // symmetric, comfortable: allow from-slightly-below up to top-down
  camPitch = Math.max(0.12, Math.min(1.35, camPitch));
  camDirty = true;
}
function onSceneUp() { camDrag = null; }

// pinch to zoom (touch)
let pinch = null;
function onTouchStart(e) {
  if (e.touches.length === 2) {
    pinch = { d: touchDist(e), dist0: camDist };
  }
}
function onTouchMove(e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    const d = touchDist(e);
    const ratio = pinch.d / d;
    camDist = Math.max(8, Math.min(26, pinch.dist0 * ratio));
    camDirty = true;
  }
}
function onTouchEnd(e) { if (e.touches.length < 2) pinch = null; }
function touchDist(e) {
  const [a, b] = e.touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
function onWheel(e) {
  e.preventDefault();
  camDist = Math.max(8, Math.min(26, camDist + e.deltaY * 0.01));
  camDirty = true;
}

function resetView() {
  if (domMode) { camYaw = DEFAULT_YAW; camPitch = DEFAULT_PITCH; camDist = 14.5; camDirty = true; return; }
  // compute the fitted distance for the default framing, then animate to it
  const y0 = camYaw, p0 = camPitch, d0 = camDist;
  camYaw = DEFAULT_YAW; camPitch = DEFAULT_PITCH;
  frameToFit();
  const dTarget = camDist;
  camYaw = y0; camPitch = p0; camDist = d0;
  camAnim = { y0, y1: DEFAULT_YAW, p0, p1: DEFAULT_PITCH, d0, d1: dTarget, e: 0, dur: 0.5 };
  camDirty = true;
}

// ================= HUD =================
const hudEl = document.getElementById('hud');
const hudInner = document.getElementById('hud-inner');
function toggleHud() {
  const open = hudEl.classList.toggle('open');
  document.getElementById('hudBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) updateHud();
}
function updateHud() {
  // top mini readouts
  document.getElementById('scoreEl').textContent = score.toLocaleString();
  document.getElementById('bestEl').textContent = best.toLocaleString();
  document.getElementById('multChip').textContent = `×${multiplier} MULT`;
  const feat = featuredType();
  document.getElementById('hotChip').textContent = `HOT: ${GEMS[feat].name} ×${FEATURED_MULT}`;
  const luck = favoured === null ? '—' : GEMS[favoured].name;
  document.getElementById('luckyChip').textContent = `LUCKY: ${luck}`;

  // mini ledger row (always visible essentials, pointer-events none via #readout)
  const mini = document.getElementById('ledger-mini');
  mini.innerHTML = '<span class="lbl">VALUES</span>';
  for (let c = 0; c < currentTypes; c++) {
    const v = document.createElement('span');
    v.className = 'vchip' + (isFeatured(c) ? ' feat' : '');
    v.innerHTML = `<span class="swatch" style="background:${GEMS[c].css};clip-path:${clipFor(GEMS[c].shape)}"></span>${gemValueNow(c)}`;
    mini.appendChild(v);
  }

  // detailed HUD
  if (!hudEl.classList.contains('open')) return;
  let html = '<h3>VALUE LEDGER</h3>';
  for (let c = 0; c < currentTypes; c++) {
    const g = GEMS[c];
    const tags = [];
    if (isFeatured(c)) tags.push(`<span class="tag hot">HOT ×${FEATURED_MULT}</span>`);
    if (favoured === c) tags.push('<span class="tag lucky">LUCKY</span>');
    html += `<div class="ledger-row">
      <span class="swatch" style="background:${g.css};clip-path:${clipFor(g.shape)}"></span>
      <span class="name">${g.name}</span>
      <span class="val">${gemValueNow(c)}/gem</span>
      <span style="opacity:.7;font-size:11px">${g.desc}</span> ${tags.join(' ')}</div>`;
  }
  html += '<h3>NEXT DROPS (PEEK)</h3><div id="peek-rail"></div>';
  html += `<h3>STATUS</h3><div id="hud-stats">
    Stage ${stage + 1}: <b>${stageInfo(stage).name}</b> · ${currentTypes} colours in play<br>
    Multiplier ×${multiplier} (big matches compound, a 3-match halves it)<br>
    HOT colour <b>${GEMS[feat].name}</b> pays ×${FEATURED_MULT} · LUCKY (steering drops) <b>${luck}</b><br>
    Last move +${lastGain.toLocaleString()}${lastBonus ? ` (incl. +${lastBonus} off-hint bonus)` : ''}
  </div>`;
  html += `<div id="hud-help">Slide a gem into a neighbour to swap. Drag empty space to orbit; pinch or scroll to zoom. Clear the HOT colour to steer more of it back in and build a featured cascade.</div>`;
  hudInner.innerHTML = html;

  const rail = document.getElementById('peek-rail');
  for (const col of peekColours) {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.background = GEMS[col].css;
    s.style.clipPath = clipFor(GEMS[col].shape);
    s.title = GEMS[col].name;
    rail.appendChild(s);
  }
}

function refreshPeek() {
  // forecast the next drops using current favour bias, from a fresh peek rng
  peekRng = makeRng(((score + 1) * 2654435761) | 0);
  peekColours = GAME.refillQueue(peekRng, currentTypes, favoured, 8);
}

// ================= NEW GAME / GAME OVER =================
function newGame() {
  gameOver = false;
  document.getElementById('gameover').hidden = true;
  score = 0; lastGain = 0; lastBonus = 0; multiplier = 1; stage = 0;
  currentTypes = GAME.typesForStage(0);
  favoured = null;
  resetGemLevels();
  rng = makeRng((Date.now() ^ (Math.random() * 1e9)) | 0);
  board = GAME.createBoard(ROWS, COLS, currentTypes, rng);
  if (three) syncGemMeshes(); else if (domMode) syncDomGems();
  applyStageTheme();
  refreshPeek();
  updateHud();
  resetView();
  restartIdle();
}
function enterGameOver() {
  gameOver = true;
  clearHint();
  document.getElementById('finalScore').textContent = score.toLocaleString();
  document.getElementById('gameover').hidden = false;
}

// ================= WIRING =================
function wireEvents() {
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp, { passive: false });
  document.addEventListener('pointercancel', () => { drag = null; });

  // camera orbit: listen on scene layer beneath hit cells
  sceneEl.addEventListener('pointerdown', onScenePointerDown);
  window.addEventListener('pointermove', onSceneMove);
  window.addEventListener('pointerup', onSceneUp);
  sceneEl.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);

  document.getElementById('newGameBtn').addEventListener('click', newGame);
  document.getElementById('goNewGame').addEventListener('click', newGame);
  document.getElementById('resetViewBtn').addEventListener('click', resetView);
  document.getElementById('hudBtn').addEventListener('click', toggleHud);
  hudEl.querySelector('.grab').addEventListener('click', toggleHud);

  const soundBtn = document.getElementById('soundBtn');
  soundBtn.addEventListener('click', () => {
    const wasPressed = soundBtn.getAttribute('aria-pressed') === 'true';
    const nowOn = !wasPressed; // pressed==true means sound ON in our convention
    soundBtn.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
    Sound.setMuted(!nowOn);
    Sound.resume();
    soundBtn.innerHTML = nowOn ? '&#128266;' : '&#128263;';
  });

  window.addEventListener('resize', () => {
    if (three) {
      three.camera.aspect = window.innerWidth / window.innerHeight;
      three.camera.updateProjectionMatrix();
      three.renderer.setSize(window.innerWidth, window.innerHeight);
      frameToFit();
    }
    camDirty = true;
  });
}

// ================= TEST HOOKS =================
function installTestHooks() {
  window.__test = {
    score: () => score,
    lastGain: () => lastGain,
    lastBonus: () => lastBonus,
    multiplier: () => multiplier,
    gemValues: () => gemValuesArray(),
    stage: () => stage,
    featuredType: () => featuredType(),
    featuredMultiplier: () => (featuredType() === null ? 1 : FEATURED_MULT),
    favouredType: () => favoured,
    nextColours: () => peekColours.slice(),
    bestScore: () => best,
    validMove: () => findValidMove(),
    board: () => board.map((row) => row.slice()),
    gameOver: () => gameOver,
    hint: () => (hint ? { a: hint.a, b: hint.b } : null),
    slide: (r, c, dir) => {
      const a = { r, c }, b = neighbour(a, dir);
      if (!inBounds(b) || busy || gameOver || !GAME.isValidSwap(board, a, b)) return Promise.resolve(false);
      const hintedAtStart = hint ? { a: hint.a, b: hint.b } : null;
      return resolveMove(a, b, hintedAtStart).then(() => true);
    },
  };
}

// ================= BOOT =================
async function boot() {
  best = loadBest();
  resetGemLevels();
  currentTypes = GAME.typesForStage(0);
  rng = makeRng((Date.now() ^ (Math.random() * 1e9)) | 0);
  board = GAME.createBoard(ROWS, COLS, currentTypes, rng);

  // try to load three.js and init WebGL; fall back to DOM on any failure
  try {
    three_ns = await import('./three.module.js');
    if (!tryInitWebGL()) initDom();
  } catch (e) {
    console.warn('three.js load failed -> DOM fallback', e);
    initDom();
  }

  if (three) { syncGemMeshes(); frameToFit(); applyCamera(); }
  else syncDomGems();

  buildHitCells();
  applyStageTheme();
  refreshPeek();
  installTestHooks();
  wireEvents();
  updateHud();
  restartIdle();

  raf = requestAnimationFrame(loop);
  // settle camera to default (already default; do a tiny nudge so it "settles")
  if (three) { positionHitCells(); }
}

boot();
