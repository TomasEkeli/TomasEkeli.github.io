// Lagoon of Light — 3D presentation + meta-game for the pure logic in game.js.
// A sunlit tropical lagoon: turquoise shallows, coral, dappled light.
// Rendered with a vendored three.js (no network at runtime).

import * as THREE from './three.module.js';
import * as G from './game.js';

// ---------------------------------------------------------------- constants

const ROWS = 8, COLS = 8, TYPES = 6;
const S = 1.16;          // world spacing between cell centres
const GEM_Y = 0.62;      // resting height of gems above the platform
const BEST_KEY = 'lagoon-of-light-best';
const PEEK_N = 7;        // upcoming refill colours shown to the player
const DEVIATION_BONUS = 100;
const HINT_IDLE_MS = 10000;

const GEMS = [
  { name: 'Coral',  colour: 0xff4a68, css: '#ff4a68', scheme: 'doubles every match' },
  { name: 'Amber',  colour: 0xffbe2e, css: '#ffbe2e', scheme: 'steady 50, never moves' },
  { name: 'Lagoon', colour: 0x17d8c6, css: '#17d8c6', scheme: '+6 every match' },
  { name: 'Orchid', colour: 0xa878ff, css: '#a878ff', scheme: 'rarer on board = richer' },
  { name: 'Palm',   colour: 0x5fd84a, css: '#5fd84a', scheme: 'steady 15' },
  { name: 'Mango',  colour: 0xff8f35, css: '#ff8f35', scheme: 'grows every stage' },
];

// Stage themes: sunlit lagoon moods that stay bright. Each stage features one
// colour whose gems pay featuredMult × their ledger value.
const STAGES = [
  { name: 'Sunrise Shallows', sky: ['#fff3cf', '#7ce8de', '#2cc7bb'], fog: '#3fcfc2', sand: '#f7dfa0', sun: 0xfff1cf, hemi: 0xcffcf5, featured: 2, mult: 3 },
  { name: 'Coral Garden',     sky: ['#ffd9e5', '#7fe8cf', '#25c9ae'], fog: '#3ecfb2', sand: '#fcd3ae', sun: 0xffe9dd, hemi: 0xffe3ec, featured: 0, mult: 3 },
  { name: 'Golden Hour',      sky: ['#ffc95e', '#ffe09a', '#3fc9b2'], fog: '#54c99d', sand: '#ffce8a', sun: 0xffdf9e, hemi: 0xfff0c8, featured: 5, mult: 3 },
  { name: 'Orchid Cove',      sky: ['#eec9ff', '#8fdfea', '#38c3c8'], fog: '#45c3cc', sand: '#ecd4f2', sun: 0xfbeaff, hemi: 0xe9dcff, featured: 3, mult: 4 },
  { name: 'Pearl Morning',    sky: ['#ffffff', '#b5eee6', '#54cfc2'], fog: '#6cd8cb', sand: '#fdedc4', sun: 0xffffff, hemi: 0xf3fffd, featured: 1, mult: 3 },
  { name: 'Palm Reef',        sky: ['#eaffb0', '#8ce8b4', '#27c496'], fog: '#3fcd92', sand: '#e9e296', sun: 0xfaffdc, hemi: 0xdcffe4, featured: 4, mult: 4 },
];

// ---------------------------------------------------------------- rng

let rngState = ((Date.now() & 0xffffffff) ^ ((Math.random() * 0xffffffff) | 0)) >>> 0;
function rng() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rngSnapshot = () => rngState;
const rngRestore = (s) => { rngState = s; };

// ---------------------------------------------------------------- state

const state = {
  board: null,          // live logical 8×8 grid of ints
  score: 0,
  best: 0,
  lastGain: 0,
  lastBonus: 0,
  mult: 1,
  stage: 0,
  featured: STAGES[0].featured,
  featuredMult: STAGES[0].mult,
  favoured: null,       // colour the refill bias currently leans toward
  peek: [],             // upcoming refill colours shown in the queue rail
  matchEvents: new Array(TYPES).fill(0), // per-colour "times matched" counters
  animating: false,
  over: false,
  hint: null,           // {a, b} currently shown, or null
};

try { state.best = Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { /* no storage */ }

// Per-colour CURRENT value (base, before the featured boost). Varied by design:
// exponential, flat, growing, rarity-driven, flat, stage-scaled.
function gemValueOn(type, board) {
  switch (type) {
    case 0: return Math.min(5 * 2 ** state.matchEvents[0], 320);
    case 1: return 50;
    case 2: return 10 + 6 * state.matchEvents[2];
    case 3: {
      let n = 0;
      for (const row of board) for (const v of row) if (v === 3) n++;
      if (n === 0) return 240;
      return Math.max(12, Math.min(240, Math.round(360 / n)));
    }
    case 4: return 15;
    case 5: return 12 * (state.stage + 1);
    default: return 10;
  }
}
const currentGemValues = () => GEMS.map((_, t) => gemValueOn(t, state.board));

// ---------------------------------------------------------------- three scene

// Keep it silky on real GPUs; go lean when WebGL is software-rasterised
// (headless/CI) so interaction stays snappy there too.
const softwareGL = (() => {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return /swiftshader|llvmpipe|software|basic render/i.test(String(r));
  } catch { return false; }
})();
// Create the WebGL renderer defensively. If a GL context can't be made (rare,
// but a hard failure would kill every hook and hit-cell), fall back to a static
// CSS grid so the game stays fully playable and the DOM handles stay honest.
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !softwareGL });
  renderer.setPixelRatio(softwareGL ? 0.6 : Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !softwareGL;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.domElement.classList.add('scene3d');
  document.body.prepend(renderer.domElement);
} catch (err) {
  renderer = null;
  document.body.classList.add('no-webgl');
}
const has3D = renderer !== null;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x3fcfc2, 14, 52); // sunlit water swallows the distance

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
const CAM_HOME = { yaw: 0, pitch: 0.98, dist: 16.8 };
const cam = { ...CAM_HOME, target: new THREE.Vector3(0, 0.1, 0) };

function framingDist() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return CAM_HOME.dist * Math.max(1, 1.25 / aspect);
}
cam.dist = framingDist();
CAM_HOME.dist = cam.dist;

function updateCamera() {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  camera.position.set(
    cam.target.x + cam.dist * cp * Math.sin(cam.yaw),
    cam.target.y + cam.dist * sp,
    cam.target.z + cam.dist * cp * Math.cos(cam.yaw),
  );
  camera.lookAt(cam.target);
}
updateCamera();

// -- lights
const hemi = new THREE.HemisphereLight(0xcffcf5, 0xf7e2ae, 0.85);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.26);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff1cf, 1.75);
sun.position.set(6, 18, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
sun.shadow.camera.far = 50;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbdf6ff, 0.5);
fill.position.set(-8, 6, -6);
scene.add(fill);

// -- sky/water dome (gradient repainted per stage)
const domeCanvas = document.createElement('canvas');
domeCanvas.width = 8; domeCanvas.height = 512;
const domeTex = new THREE.CanvasTexture(domeCanvas);
domeTex.colorSpace = THREE.SRGBColorSpace;
function paintDome(colours) {
  const ctx = domeCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, colours[0]);
  g.addColorStop(0.45, colours[1]);
  g.addColorStop(1, colours[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 512);
  domeTex.needsUpdate = true;
}
paintDome(STAGES[0].sky);
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(100, 32, 24),
  new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false }),
);
scene.add(dome);

// -- sandy sea floor
const sandMat = new THREE.MeshStandardMaterial({ color: 0xffe9b8, roughness: 1 });
const sand = new THREE.Mesh(new THREE.CircleGeometry(90, 48), sandMat);
sand.rotation.x = -Math.PI / 2;
sand.position.y = -2.6;
sand.receiveShadow = true;
scene.add(sand);

// -- dappled caustic light on the sand
function causticTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 8 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
const causticTex = causticTexture();
const caustics = new THREE.Mesh(
  new THREE.CircleGeometry(60, 40),
  new THREE.MeshBasicMaterial({
    map: causticTex, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }),
);
caustics.rotation.x = -Math.PI / 2;
caustics.position.y = -2.55;
scene.add(caustics);

// -- shafts of sunlight
function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,240,0.55)');
  g.addColorStop(1, 'rgba(255,255,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const shaftTex = shaftTexture();
const shafts = [];
for (let i = 0; i < 6; i++) {
  const w = 2.5 + Math.random() * 3.5;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 42),
    new THREE.MeshBasicMaterial({
      map: shaftTex, transparent: true, opacity: 0.1 + Math.random() * 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  const a = (i / 6) * Math.PI * 2 + Math.random();
  m.position.set(Math.cos(a) * (14 + Math.random() * 12), 14, Math.sin(a) * (14 + Math.random() * 12) - 6);
  m.rotation.y = Math.random() * Math.PI;
  m.rotation.z = -0.12 + Math.random() * 0.24;
  m.userData.baseZrot = m.rotation.z;
  m.userData.phase = Math.random() * Math.PI * 2;
  scene.add(m);
  shafts.push(m);
}

// -- rising bubbles
const BUBBLE_N = softwareGL ? 60 : 150;
const bubbleGeom = new THREE.BufferGeometry();
{
  const pos = new Float32Array(BUBBLE_N * 3);
  for (let i = 0; i < BUBBLE_N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 56;
    pos[i * 3 + 1] = -2 + Math.random() * 22;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 56;
  }
  bubbleGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const bubbleSpeeds = Array.from({ length: BUBBLE_N }, () => 0.5 + Math.random() * 1.4);
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(c);
}
const dotTex = dotTexture();
const bubbles = new THREE.Points(bubbleGeom, new THREE.PointsMaterial({
  size: 0.34, map: dotTex, transparent: true, opacity: 0.5,
  depthWrite: false, blending: THREE.AdditiveBlending, color: 0xdffcff,
}));
scene.add(bubbles);

// -- the board platform: a pale coral-stone table with a legible tile grid
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(COLS * S + 1.5, 0.75, ROWS * S + 1.5),
  new THREE.MeshStandardMaterial({ color: 0xfff2d2, roughness: 0.75 }),
);
platform.position.y = -0.38;
platform.receiveShadow = true;
scene.add(platform);
const rim = new THREE.Mesh(
  new THREE.BoxGeometry(COLS * S + 1.9, 0.3, ROWS * S + 1.9),
  new THREE.MeshStandardMaterial({ color: 0x39cdbd, roughness: 0.5 }),
);
rim.position.y = -0.72;
scene.add(rim);
// pillars grounding the table on the sand
const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf2ddb0, roughness: 1 });
for (const [px, pz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.1, 10), pillarMat);
  p.position.set(px, -1.7, pz);
  scene.add(p);
}
// alternating tiles so the grid reads clearly
{
  const tileG = new THREE.BoxGeometry(S * 0.96, 0.06, S * 0.96);
  const tileA = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const tileB = new THREE.MeshStandardMaterial({ color: 0xcdf6ef, roughness: 0.6 });
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = new THREE.Mesh(tileG, (r + c) % 2 ? tileA : tileB);
      t.position.set((c - 3.5) * S, 0.03, (r - 3.5) * S);
      t.receiveShadow = true;
      scene.add(t);
    }
  }
}

// -- coral clusters + seaweed around the stage
const swayers = [];
{
  const coralCols = [0xff7eb0, 0xff9f5f, 0xff5e78, 0xffd166, 0xc77dff, 0xff8fa3];
  for (let i = 0; i < 11; i++) {
    // back and side arcs only, so the reef never photobombs the default camera
    const a = Math.PI * (1.08 + (i / 10) * 0.84) + (Math.random() - 0.5) * 0.1;
    const rad = 15 + Math.random() * 11;
    const cluster = new THREE.Group();
    cluster.position.set(Math.cos(a) * rad, -2.6, Math.sin(a) * rad);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const col = coralCols[Math.floor(Math.random() * coralCols.length)];
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: 0.12 });
      const kind = Math.random();
      let m;
      if (kind < 0.45) {
        m = new THREE.Mesh(new THREE.ConeGeometry(0.24 + Math.random() * 0.22, 1.2 + Math.random() * 1.4, 7), mat);
        m.position.y = m.geometry.parameters.height / 2;
      } else if (kind < 0.8) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.45 + Math.random() * 0.4, 10, 8), mat);
        m.position.y = 0.35;
      } else {
        m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.16, 8, 14, Math.PI), mat);
        m.position.y = 0.15;
      }
      m.position.x = (Math.random() - 0.5) * 1.6;
      m.position.z = (Math.random() - 0.5) * 1.6;
      m.rotation.y = Math.random() * Math.PI;
      cluster.add(m);
    }
    scene.add(cluster);
  }
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x4fd68a, roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.08 + (i / 8) * 0.84) + (Math.random() - 0.5) * 0.12;
    const rad = 16 + Math.random() * 11;
    const h = 2.5 + Math.random() * 4;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, h, 6), weedMat);
    w.position.set(Math.cos(a) * rad, -2.6 + h / 2, Math.sin(a) * rad);
    w.userData.phase = Math.random() * Math.PI * 2;
    scene.add(w);
    swayers.push(w);
  }
}

// -- little fish circling in the distance
const fishes = [];
{
  const fishCols = [0xffb703, 0xff5e78, 0x59d4ff, 0xb98bff, 0x7ee060];
  for (let i = 0; i < 6; i++) {
    const col = fishCols[i % fishCols.length];
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, emissive: col, emissiveIntensity: 0.15 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.62, 8), mat);
    body.rotation.z = -Math.PI / 2; // point along +x
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 6), mat);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -0.42;
    g.add(body, tail);
    g.userData = {
      radius: 16 + Math.random() * 10,
      height: 2.5 + Math.random() * 4, // below the camera, behind the board mostly
      speed: (0.12 + Math.random() * 0.16) * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
    };
    scene.add(g);
    fishes.push(g);
  }
}

// ---------------------------------------------------------------- gems

const gemGeoms = [];
function starGeometry() {
  const shape = new THREE.Shape();
  const R = 0.44, r = 0.19;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
  });
  g.center();
  return g;
}
gemGeoms[0] = new THREE.OctahedronGeometry(0.46);                       // Coral — bipyramid jewel
gemGeoms[1] = new THREE.IcosahedronGeometry(0.42, 0);                   // Amber — faceted orb
gemGeoms[2] = new THREE.CylinderGeometry(0.37, 0.37, 0.55, 6);          // Lagoon — hex prism
gemGeoms[3] = new THREE.TorusGeometry(0.3, 0.14, 10, 24);               // Orchid — ring
gemGeoms[4] = new THREE.ConeGeometry(0.43, 0.68, 4);                    // Palm — pyramid
gemGeoms[5] = starGeometry();                                           // Mango — star

const gemMats = GEMS.map((g, i) => new THREE.MeshPhysicalMaterial({
  color: g.colour,
  roughness: 0.16,
  metalness: 0.08,
  clearcoat: 0.9,
  clearcoatRoughness: 0.18,
  emissive: g.colour,
  emissiveIntensity: 0.12,
  flatShading: i !== 3,
}));

const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));

function makeGem(type, r, c) {
  const m = new THREE.Mesh(gemGeoms[type], gemMats[type]);
  m.castShadow = true;
  m.position.set((c - 3.5) * S, GEM_Y, (r - 3.5) * S);
  m.userData = {
    type,
    home: { x: (c - 3.5) * S, y: GEM_Y, z: (r - 3.5) * S },
    phase: Math.random() * Math.PI * 2,
    spin: 0.35 + Math.random() * 0.5,
    busy: 0,
  };
  return m;
}

function buildGridMeshes() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) scene.remove(grid[r][c]);
      const m = makeGem(state.board[r][c], r, c);
      grid[r][c] = m;
      scene.add(m);
    }
  }
}

// ---------------------------------------------------------------- particles

const bursts = [];
function burst(pos, colour, count, size, speed) {
  const geom = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const vels = [];
  for (let i = 0; i < count; i++) {
    p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI;
    const sp = speed * (0.4 + Math.random() * 0.8);
    vels.push(new THREE.Vector3(
      Math.sin(ph) * Math.cos(th) * sp,
      Math.abs(Math.cos(ph)) * sp * 1.1,
      Math.sin(ph) * Math.sin(th) * sp,
    ));
  }
  geom.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({
    color: colour, size, map: dotTex, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geom, mat);
  scene.add(pts);
  bursts.push({ pts, vels, born: performance.now(), life: 650 });
}
function updateBursts(now, dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    const age = now - b.born;
    if (age > b.life) {
      scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const arr = b.pts.geometry.attributes.position.array;
    for (let k = 0; k < b.vels.length; k++) {
      b.vels[k].y -= 5.5 * dt;
      arr[k * 3] += b.vels[k].x * dt;
      arr[k * 3 + 1] += b.vels[k].y * dt;
      arr[k * 3 + 2] += b.vels[k].z * dt;
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.opacity = 0.95 * (1 - age / b.life);
  }
}

// ---------------------------------------------------------------- tweens

const tweens = new Set();
function tween(dur, fn) {
  return new Promise((resolve) => {
    tweens.add({ start: performance.now(), dur, fn, resolve });
  });
}
function updateTweens(now) {
  for (const tw of [...tweens]) {
    const p = Math.min(1, (now - tw.start) / tw.dur);
    tw.fn(p);
    if (p >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---------------------------------------------------------------- hit cells

const cellsRoot = document.getElementById('cells');
const cellEls = [];
const cellPts = new Array(64).fill(null).map(() => [0, 0]);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement('div');
    el.className = 'hitcell';
    el.setAttribute('data-testid', 'cell');
    el.addEventListener('pointerdown', (e) => onCellDown(e, r, c));
    cellsRoot.appendChild(el);
    cellEls.push(el);
  }
}
const projV = new THREE.Vector3();
function layoutCells() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!has3D) {
    // Static, perfectly grid-ordered fallback grid centred on screen.
    const span = Math.min(w * 0.6, h * 0.8);
    const step = span / COLS;
    const ox = w / 2 - span / 2 + step / 2;
    const oy = h / 2 - span / 2 + step / 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        cellPts[i][0] = ox + c * step;
        cellPts[i][1] = oy + r * step;
      }
    }
  } else {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        projV.set((c - 3.5) * S, GEM_Y * 0.7, (r - 3.5) * S).project(camera);
        cellPts[i][0] = (projV.x * 0.5 + 0.5) * w;
        cellPts[i][1] = (-projV.y * 0.5 + 0.5) * h;
      }
    }
  }
  for (let i = 0; i < 64; i++) {
    const r = i >> 3, c = i & 7;
    const right = cellPts[c < 7 ? i + 1 : i - 1];
    const down = cellPts[r < 7 ? i + 8 : i - 8];
    const dx = Math.hypot(cellPts[i][0] - right[0], cellPts[i][1] - right[1]);
    const dy = Math.hypot(cellPts[i][0] - down[0], cellPts[i][1] - down[1]);
    const size = Math.max(20, Math.min(dx, dy) * 0.97);
    const st = cellEls[i].style;
    st.left = `${cellPts[i][0]}px`;
    st.top = `${cellPts[i][1]}px`;
    st.width = `${size}px`;
    st.height = `${size}px`;
  }
}

// ---------------------------------------------------------------- gestures

let drag = null; // gem slide in progress
function onCellDown(e, r, c) {
  ensureAudio();
  if (state.animating || state.over || drag) return;
  e.preventDefault();
  e.stopPropagation();
  drag = {
    r, c,
    hintSnap: state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null,
    mesh: grid[r][c],
  };
  clearHintVisual();
  if (drag.mesh) drag.mesh.userData.busy = 1;
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragUp);
  window.addEventListener('pointercancel', onDragUp);
}

function nearestSlot(x, y, r, c) {
  const i0 = r * COLS + c;
  let best = { r, c };
  let bd = Math.hypot(x - cellPts[i0][0], y - cellPts[i0][1]);
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    const p = cellPts[nr * COLS + nc];
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bd) { bd = d; best = { r: nr, c: nc }; }
  }
  return best;
}

function onDragMove(e) {
  if (!drag || !drag.mesh) return;
  const t = nearestSlot(e.clientX, e.clientY, drag.r, drag.c);
  const home = drag.mesh.userData.home;
  const lean = 0.32;
  const tx = home.x + ((t.c - drag.c) * S) * lean;
  const tz = home.z + ((t.r - drag.r) * S) * lean;
  drag.mesh.position.x += (tx - drag.mesh.position.x) * 0.35;
  drag.mesh.position.z += (tz - drag.mesh.position.z) * 0.35;
  drag.mesh.position.y = home.y + 0.28;
}

function onDragUp(e) {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  window.removeEventListener('pointercancel', onDragUp);
  const d = drag;
  drag = null;
  // The move is decided by where the gesture ENDS: released nearest the origin
  // slot (out-and-back included) means no move at all.
  const target = e.type === 'pointercancel'
    ? { r: d.r, c: d.c }
    : nearestSlot(e.clientX, e.clientY, d.r, d.c);
  if (target.r === d.r && target.c === d.c) {
    settleBack(d.mesh);
    restartIdle();
    return;
  }
  attemptMove({ r: d.r, c: d.c }, target, d.hintSnap, d.mesh);
}

function settleBack(mesh) {
  if (!mesh) return;
  const home = mesh.userData.home;
  const from = mesh.position.clone();
  tween(110, (p) => {
    const q = easeInOut(p);
    mesh.position.set(
      from.x + (home.x - from.x) * q,
      from.y + (home.y - from.y) * q,
      from.z + (home.z - from.z) * q,
    );
  }).then(() => { mesh.userData.busy = 0; });
}

// camera orbit: drag the water (the canvas), scroll to zoom
let camDrag = null;
if (has3D) renderer.domElement.addEventListener('pointerdown', (e) => {
  ensureAudio();
  camDrag = { x: e.clientX, y: e.clientY };
  const move = (ev) => {
    if (!camDrag) return;
    cam.yaw -= (ev.clientX - camDrag.x) * 0.005;
    cam.pitch = Math.min(1.45, Math.max(0.32, cam.pitch + (ev.clientY - camDrag.y) * 0.004));
    camDrag = { x: ev.clientX, y: ev.clientY };
  };
  const up = () => {
    camDrag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
window.addEventListener('wheel', (e) => {
  cam.dist = Math.min(30, Math.max(11, cam.dist * (1 + e.deltaY * 0.0009)));
}, { passive: true });

function resetView() {
  const from = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
  const to = { yaw: 0, pitch: CAM_HOME.pitch, dist: framingDist() };
  // unwind whole turns so the tween takes the short way home
  from.yaw = ((from.yaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  tween(450, (p) => {
    const q = easeInOut(p);
    cam.yaw = from.yaw + (to.yaw - from.yaw) * q;
    cam.pitch = from.pitch + (to.pitch - from.pitch) * q;
    cam.dist = from.dist + (to.dist - from.dist) * q;
  });
}
document.getElementById('reset-view').addEventListener('click', resetView);

// ---------------------------------------------------------------- moves

function samePair(p, q) {
  const eq = (u, v) => u.r === v.r && u.c === v.c;
  return (eq(p.a, q.a) && eq(p.b, q.b)) || (eq(p.a, q.b) && eq(p.b, q.a));
}

function modalColour(board, cells) {
  const counts = new Map();
  for (const { r, c } of cells) {
    const t = board[r][c];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = null, bn = -1;
  for (const [t, n] of counts) if (n > bn) { bn = n; best = t; }
  return best;
}

async function attemptMove(a, b, hintSnap, mesh) {
  if (state.animating || state.over) { settleBack(mesh); return; }
  if (!G.isValidSwap(state.board, a, b)) {
    state.animating = true;
    playSound('invalid');
    await animateRejected(a, b);
    state.animating = false;
    restartIdle();
    return;
  }
  await performMove(a, b, hintSnap);
}

async function animateRejected(a, b) {
  const ma = grid[a.r][a.c], mb = grid[b.r][b.c];
  if (!ma || !mb) return;
  ma.userData.busy = 1; mb.userData.busy = 1;
  const ha = ma.userData.home, hb = mb.userData.home;
  const pa = ma.position.clone();
  await tween(220, (p) => {
    const q = Math.sin(p * Math.PI) * 0.38; // out and back
    const blend = Math.min(1, p * 4); // ease off any drag lean first
    const bx = pa.x + (ha.x - pa.x) * blend;
    const bz = pa.z + (ha.z - pa.z) * blend;
    ma.position.set(bx + (hb.x - ha.x) * q, ha.y + 0.2 * Math.sin(p * Math.PI), bz + (hb.z - ha.z) * q);
    mb.position.set(hb.x + (ha.x - hb.x) * q, hb.y, hb.z + (ha.z - hb.z) * q);
  });
  ma.position.set(ha.x, ha.y, ha.z);
  mb.position.set(hb.x, hb.y, hb.z);
  ma.userData.busy = 0; mb.userData.busy = 0;
}

async function animateSwap(a, b) {
  const ma = grid[a.r][a.c], mb = grid[b.r][b.c];
  ma.userData.busy = 1; mb.userData.busy = 1;
  const ha = { ...ma.userData.home }, hb = { ...mb.userData.home };
  const pa = ma.position.clone();
  await tween(140, (p) => {
    const q = easeInOut(p);
    ma.position.set(
      pa.x + (hb.x - pa.x) * q,
      ha.y + 0.35 * Math.sin(p * Math.PI),
      pa.z + (hb.z - pa.z) * q,
    );
    mb.position.set(hb.x + (ha.x - hb.x) * q, hb.y, hb.z + (ha.z - hb.z) * q);
  });
  ma.userData.home = hb; mb.userData.home = ha;
  ma.position.set(hb.x, hb.y, hb.z);
  mb.position.set(ha.x, ha.y, ha.z);
  ma.userData.busy = 0; mb.userData.busy = 0;
  grid[a.r][a.c] = mb;
  grid[b.r][b.c] = ma;
}

async function performMove(a, b, hintSnap) {
  state.animating = true;
  clearHintVisual();
  stopIdle();

  const swapped = G.applySwap(state.board, a, b);
  playSound('swap');
  await animateSwap(a, b);

  // The colour the player just actively cleared biases what drops next.
  const m0 = G.findMatches(swapped);
  const favour = modalColour(swapped, m0);
  const { board: settled, steps } = G.collapse(swapped, rng, TYPES, favour);
  state.board = settled.map((row) => row.slice());
  state.favoured = favour;

  // ---- score the move: Σ waveRaw_i × cascadeFactor(i), × multiplier
  let longest = 0;
  let base = 0;
  let incoming = swapped;
  const waves = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    longest = Math.max(longest, G.longestRun(incoming));
    let raw = 0;
    const typesHit = new Set();
    for (const { r, c } of step.matches) {
      const t = incoming[r][c];
      typesHit.add(t);
      let v = gemValueOn(t, incoming);
      if (t === state.featured) v *= state.featuredMult;
      raw += v;
    }
    for (const t of typesHit) state.matchEvents[t]++;
    base += raw * G.cascadeFactor(i);
    waves.push({ step, incoming, raw });
    incoming = step.board;
  }
  state.mult = G.matchMultiplier(state.mult, longest);
  const bonus = hintSnap && !samePair(hintSnap, { a, b }) ? DEVIATION_BONUS : 0;
  const gain = Math.round(base) * state.mult + bonus;

  // ---- play it out, wave by wave, escalating as the chain deepens
  for (let i = 0; i < waves.length; i++) {
    await playWave(waves[i], i);
  }

  // ---- commit
  state.score += gain;
  state.lastGain = gain;
  state.lastBonus = bonus;
  if (state.score > state.best) {
    state.best = state.score;
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* no storage */ }
  }
  const ns = G.stageForScore(state.score);
  if (ns !== state.stage) {
    state.stage = ns;
    applyStage(ns, true);
  }
  refreshPeek();
  updateHUD(true);
  showGain(gain, bonus, waves.length);
  if (bonus > 0) playSound('bonus');

  if (!G.hasValidMove(state.board)) enterGameOver();
  state.animating = false;
  restartIdle();
}

async function playWave({ step, incoming }, i) {
  const cells = step.matches;
  playSound('pop', i);
  if (i >= 1) showCascadeFloat(i);
  const doomed = [];
  for (const { r, c } of cells) {
    const m = grid[r][c];
    if (!m) continue;
    m.userData.busy = 1;
    doomed.push(m);
    burst(m.position, GEMS[incoming[r][c]].colour, 9 + i * 9, 0.15 + i * 0.05, 2.1 + i * 0.9);
  }
  // shimmer-and-pop: swell, spin, then vanish — bigger the deeper the chain
  const swell = 1.35 + i * 0.12;
  await tween(Math.min(200, 150 + i * 12), (p) => {
    const s = p < 0.45 ? 1 + (swell - 1) * (p / 0.45) : swell * (1 - (p - 0.45) / 0.55);
    for (const m of doomed) {
      m.scale.setScalar(Math.max(0.001, s));
      m.rotation.y += 0.22;
    }
  });
  for (const { r, c } of cells) {
    const m = grid[r][c];
    if (m) { scene.remove(m); grid[r][c] = null; }
  }

  // gravity drops + refills, sequential after the clear finishes
  const matched = new Set(cells.map(({ r, c }) => r * COLS + c));
  const drops = [];
  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (matched.has(r * COLS + c)) continue;
      if (grid[r][c]) survivors.push({ mesh: grid[r][c], from: r });
    }
    for (let r = 0; r < ROWS; r++) grid[r][c] = null;
    let target = ROWS - 1;
    for (const s of survivors) {
      grid[target][c] = s.mesh;
      if (target !== s.from) drops.push(dropMesh(s.mesh, s.from, target, c));
      target--;
    }
    const numNew = target + 1;
    for (let r = target; r >= 0; r--) {
      const mesh = makeGem(step.board[r][c], r, c);
      mesh.position.z = (r - numNew - 3.5) * S; // stacked above the board
      scene.add(mesh);
      grid[r][c] = mesh;
      drops.push(dropMesh(mesh, r - numNew, r, c));
    }
  }
  await Promise.all(drops);
  if (drops.length) playSound('land');
}

// A physical fall: accelerating (ease-in) toward the landing, then a squash.
function dropMesh(mesh, fromRow, toRow, c) {
  const cellsFallen = toRow - fromRow;
  const z0 = (fromRow - 3.5) * S;
  const z1 = (toRow - 3.5) * S;
  mesh.userData.busy = 1;
  mesh.userData.home = { x: (c - 3.5) * S, y: GEM_Y, z: z1 };
  const dur = Math.min(230, 80 + 70 * Math.sqrt(cellsFallen));
  return tween(dur, (p) => {
    mesh.position.z = z0 + (z1 - z0) * p * p; // gravity: slow start, fast landing
  }).then(() => tween(70, (p) => {
    const k = Math.sin(p * Math.PI);
    mesh.scale.set(1 + 0.1 * k, 1 - 0.16 * k, 1 + 0.1 * k);
  })).then(() => {
    mesh.scale.setScalar(1);
    mesh.position.z = z1;
    mesh.userData.busy = 0;
  });
}

// ---------------------------------------------------------------- peek + favour

function refreshPeek() {
  const snap = rngSnapshot();
  state.peek = G.refillQueue(rng, TYPES, state.favoured, PEEK_N);
  rngRestore(snap);
}

// ---------------------------------------------------------------- hint / idle

let idleTimer = null;
function stopIdle() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function restartIdle() {
  stopIdle();
  clearHintVisual();
  idleTimer = setTimeout(showHint, HINT_IDLE_MS);
}
function findAnyMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && G.isValidSwap(state.board, { r, c }, { r, c: c + 1 })) {
        return { a: { r, c }, b: { r, c: c + 1 } };
      }
      if (r + 1 < ROWS && G.isValidSwap(state.board, { r, c }, { r: r + 1, c })) {
        return { a: { r, c }, b: { r: r + 1, c } };
      }
    }
  }
  return null;
}
function showHint() {
  if (state.animating || state.over || drag) return;
  const mv = findAnyMove();
  if (!mv) return;
  state.hint = mv;
}
function clearHintVisual() {
  if (state.hint) {
    const m = grid[state.hint.a.r]?.[state.hint.a.c];
    if (m && !m.userData.busy) m.scale.setScalar(1);
  }
  state.hint = null;
}

// ---------------------------------------------------------------- stages

const stageChip = document.getElementById('stage-chip');
function applyStage(idx, fanfare) {
  const cfg = STAGES[idx % STAGES.length];
  state.featured = cfg.featured;
  state.featuredMult = cfg.mult;
  paintDome(cfg.sky);
  scene.fog.color.set(cfg.fog);
  sandMat.color.set(cfg.sand);
  sun.color.set(cfg.sun);
  hemi.color.set(cfg.hemi);
  stageChip.innerHTML =
    `Stage ${idx + 1} &middot; ${cfg.name} &nbsp;<span class="hotdot">&#9733; ` +
    `${GEMS[cfg.featured].name} pays &times;${cfg.mult}</span>`;
  if (fanfare) {
    playSound('stage');
    const banner = document.getElementById('banner');
    banner.hidden = false;
    banner.innerHTML =
      `Stage ${idx + 1} — ${cfg.name}` +
      `<span class="sub">&#9733; ${GEMS[cfg.featured].name} gems pay &times;${cfg.mult} here!</span>`;
    banner.classList.remove('show');
    void banner.offsetWidth; // restart the animation
    banner.classList.add('show');
    const flash = document.getElementById('flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    setTimeout(() => { banner.hidden = true; }, 2500);
  }
  buildLedger();
  updateHUD(false);
}

// ---------------------------------------------------------------- HUD

const els = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  mult: document.getElementById('mult'),
  lastgain: document.getElementById('lastgain'),
  multStat: document.getElementById('mult-stat'),
  lastStat: document.getElementById('last-stat'),
  ledgerList: document.getElementById('ledger-list'),
  multNote: document.getElementById('mult-note'),
  queueChips: document.getElementById('queue-chips'),
  favourNote: document.getElementById('favour-note'),
  fx: document.getElementById('fx'),
};

function shapeSVG(type, colour) {
  const c = colour || GEMS[type].css;
  switch (type) {
    case 0: return `<svg viewBox="0 0 24 24"><polygon points="12,1.5 22.5,12 12,22.5 1.5,12" fill="${c}"/></svg>`;
    case 1: return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${c}"/><path d="M12 2 L19 7 L19 17 L12 22 L5 17 L5 7 Z" fill="rgba(255,255,255,0.28)"/></svg>`;
    case 2: return `<svg viewBox="0 0 24 24"><polygon points="12,1.5 21.5,7 21.5,17 12,22.5 2.5,17 2.5,7" fill="${c}"/></svg>`;
    case 3: return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="${c}" stroke-width="6"/></svg>`;
    case 4: return `<svg viewBox="0 0 24 24"><polygon points="12,2 22.5,21.5 1.5,21.5" fill="${c}"/></svg>`;
    case 5: return `<svg viewBox="0 0 24 24"><polygon points="12,1 14.7,8.6 22.8,8.9 16.4,13.9 18.6,21.7 12,17.2 5.4,21.7 7.6,13.9 1.2,8.9 9.3,8.6" fill="${c}"/></svg>`;
    default: return '';
  }
}

function buildLedger() {
  els.ledgerList.innerHTML = GEMS.map((g, t) => `
    <li class="row" id="ledger-row-${t}">
      ${shapeSVG(t)}
      <span class="name">${g.name}</span>
      <span class="tags" id="ledger-tags-${t}"></span>
      <span class="scheme">${g.scheme}</span>
      <span class="val" id="ledger-val-${t}">0</span>
    </li>`).join('');
}

function updateHUD(bumpStats) {
  els.score.textContent = state.score.toLocaleString('en');
  els.best.textContent = state.best.toLocaleString('en');
  els.mult.textContent = `×${state.mult}`;
  els.lastgain.textContent = state.lastGain > 0 ? `+${state.lastGain.toLocaleString('en')}` : '—';
  if (bumpStats) {
    for (const el of [els.multStat, els.lastStat]) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }
  els.multNote.innerHTML =
    `Combo <b>×${state.mult}</b> multiplies every move &mdash; ` +
    `a 4-match doubles it, a plain 3 halves it. Deeper drop-chains pay ×2, ×3, ×4…`;
  const vals = currentGemValues();
  for (let t = 0; t < TYPES; t++) {
    const row = document.getElementById(`ledger-row-${t}`);
    const val = document.getElementById(`ledger-val-${t}`);
    const tags = document.getElementById(`ledger-tags-${t}`);
    if (!row) continue;
    const hot = t === state.featured;
    row.classList.toggle('hot', hot);
    val.textContent = hot ? `${vals[t]}×${state.featuredMult}` : `${vals[t]}`;
    tags.innerHTML =
      (hot ? `<span class="tag hot-tag">HOT ×${state.featuredMult}</span>` : '') +
      (t === state.favoured ? '<span class="tag lucky-tag">LUCKY</span>' : '');
  }
  els.queueChips.innerHTML = state.peek
    .map((t) => `<div class="chip" title="${GEMS[t].name}">${shapeSVG(t)}</div>`)
    .join('');
  els.favourNote.innerHTML = state.favoured == null
    ? 'clear a colour and more of it will drop'
    : `Lucky colour: <span class="lucky">${GEMS[state.favoured].name}</span><br>drops lean its way`;
}

function showGain(gain, bonus, waveCount) {
  const f = document.createElement('div');
  f.className = 'gainfloat';
  const size = Math.min(84, 30 + Math.log10(Math.max(10, gain)) * 14);
  f.style.fontSize = `${size}px`;
  f.textContent = `+${gain.toLocaleString('en')}`;
  if (waveCount >= 2) {
    const w = document.createElement('span');
    w.className = 'waves';
    w.textContent = `${waveCount}-wave chain!`;
    f.appendChild(w);
  }
  els.fx.appendChild(f);
  setTimeout(() => f.remove(), 1700);
  if (bonus > 0) {
    const b = document.createElement('div');
    b.className = 'bonusfloat';
    b.textContent = `+${bonus} free-spirit bonus!`;
    els.fx.appendChild(b);
    setTimeout(() => b.remove(), 2000);
  }
}

function showCascadeFloat(i) {
  const f = document.createElement('div');
  f.className = 'cascadefloat';
  f.style.fontSize = `${26 + i * 10}px`;
  f.textContent = `CASCADE ×${G.cascadeFactor(i)}!`;
  els.fx.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

// ---------------------------------------------------------------- game over / new game

function enterGameOver() {
  state.over = true;
  stopIdle();
  clearHintVisual();
  playSound('over');
  document.getElementById('go-score').textContent =
    `You scored ${state.score.toLocaleString('en')} · best ${state.best.toLocaleString('en')}`;
  document.getElementById('gameover').hidden = false;
}

function newGame() {
  ensureAudio();
  stopIdle();
  clearHintVisual();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) { scene.remove(grid[r][c]); grid[r][c] = null; }
    }
  }
  state.board = G.createBoard(ROWS, COLS, TYPES, rng);
  state.score = 0;
  state.lastGain = 0;
  state.lastBonus = 0;
  state.mult = 1;
  state.stage = 0;
  state.favoured = null;
  state.matchEvents = new Array(TYPES).fill(0);
  state.animating = false;
  state.over = false;
  state.hint = null;
  document.getElementById('gameover').hidden = true;
  buildGridMeshes();
  applyStage(0, false);
  refreshPeek();
  updateHUD(false);
  restartIdle();
}
document.getElementById('new-game').addEventListener('click', newGame);
document.getElementById('go-new').addEventListener('click', newGame);

// ---------------------------------------------------------------- audio (synthesized, offline)

let actx = null, master = null;
function ensureAudio() {
  if (actx) {
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return;
  }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = 0.55;
    master.connect(actx.destination);
  } catch { actx = null; }
}
function toneAt(freq, dur = 0.15, type = 'sine', vol = 0.07, when = 0, glideTo = 0) {
  if (!actx || !master) return;
  try {
    const t0 = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo > 0) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch { /* audio is a garnish */ }
}
function playSound(kind, i = 0) {
  switch (kind) {
    case 'swap': toneAt(540, 0.07, 'sine', 0.045); break;
    case 'pop': {
      const base = 400 * 1.23 ** Math.min(i, 8); // higher and louder as the chain deepens
      const v = Math.min(0.12, 0.06 + i * 0.015);
      toneAt(base, 0.14, 'triangle', v);
      toneAt(base * 1.5, 0.16, 'triangle', v * 0.7, 0.045);
      if (i >= 1) toneAt(base * 2, 0.22, 'sine', v * 0.7, 0.09);
      break;
    }
    case 'land': toneAt(170, 0.08, 'sine', 0.04, 0, 120); break;
    case 'invalid': toneAt(200, 0.18, 'sawtooth', 0.035, 0, 110); break;
    case 'bonus': toneAt(880, 0.16, 'sine', 0.06); toneAt(1318, 0.2, 'sine', 0.05, 0.09); break;
    case 'stage': [523, 659, 784, 1047].forEach((f, k) => toneAt(f, 0.4, 'sine', 0.06, k * 0.1)); break;
    case 'over': [392, 330, 262].forEach((f, k) => toneAt(f, 0.32, 'sine', 0.05, k * 0.2)); break;
    default: break;
  }
}

// ---------------------------------------------------------------- test hooks (observation only)

window.__test = {
  score: () => state.score,
  lastGain: () => state.lastGain,
  lastBonus: () => state.lastBonus,
  multiplier: () => state.mult,
  gemValues: () => currentGemValues(),
  stage: () => state.stage,
  featuredType: () => state.featured,
  featuredMultiplier: () => (state.featured == null ? 1 : state.featuredMult),
  favouredType: () => state.favoured,
  nextColours: () => state.peek.slice(),
  bestScore: () => state.best,
  validMove: () => findAnyMove(),
  board: () => state.board.map((row) => row.slice()),
  gameOver: () => state.over,
  hint: () => (state.hint ? { a: { ...state.hint.a }, b: { ...state.hint.b } } : null),
};

// ---------------------------------------------------------------- main loop

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  cam.dist = framingDist();
  CAM_HOME.dist = cam.dist;
  if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
});

// Colour the fallback hit-cells from the live board when 3D is unavailable.
function syncFallbackCells() {
  if (has3D) return;
  document.body.classList.add('no-webgl');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = cellEls[r * COLS + c];
      const t = state.board[r][c];
      if (el.dataset.type !== String(t)) {
        el.dataset.type = String(t);
        el.innerHTML = shapeSVG(t);
      }
    }
  }
}

let lastT = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;

  updateTweens(now);

  if (!has3D) {
    updateCamera();
    layoutCells();
    syncFallbackCells();
    return; // no scene to render
  }

  updateBursts(now, dt);

  // idle life on the gems: bob, slow spin, featured pulse, hint wiggle
  const featuredPulse = 1 + 0.06 * Math.sin(t * 4.2);
  gemMats.forEach((m, i) => {
    m.emissiveIntensity = i === state.featured ? 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(t * 5)) : 0.12;
  });
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = grid[r][c];
      if (!m || m.userData.busy) continue;
      const u = m.userData;
      m.position.y = u.home.y + 0.055 * Math.sin(t * 1.7 + u.phase);
      m.rotation.y += u.spin * dt;
      let sc = 1;
      if (u.type === state.featured) sc *= featuredPulse;
      if (state.hint && state.hint.a.r === r && state.hint.a.c === c) {
        sc *= 1 + 0.09 * Math.sin(t * 9); // the subtle idle nudge
      }
      m.scale.setScalar(sc);
    }
  }

  // environment life
  const bp = bubbleGeom.attributes.position.array;
  for (let i = 0; i < BUBBLE_N; i++) {
    bp[i * 3 + 1] += bubbleSpeeds[i] * dt;
    bp[i * 3] += Math.sin(t * 0.8 + i) * 0.15 * dt;
    if (bp[i * 3 + 1] > 20) bp[i * 3 + 1] = -2.4;
  }
  bubbleGeom.attributes.position.needsUpdate = true;
  causticTex.offset.x = t * 0.008;
  causticTex.offset.y = t * 0.005;
  for (const s of shafts) s.rotation.z = s.userData.baseZrot + 0.05 * Math.sin(t * 0.35 + s.userData.phase);
  for (const w of swayers) w.rotation.z = 0.09 * Math.sin(t * 0.7 + w.userData.phase);
  for (const f of fishes) {
    const u = f.userData;
    const a = t * u.speed + u.phase;
    f.position.set(Math.cos(a) * u.radius, u.height + 0.4 * Math.sin(t * 1.3 + u.phase), Math.sin(a) * u.radius);
    f.rotation.y = -a + (u.speed > 0 ? 0 : Math.PI);
  }

  updateCamera();
  layoutCells();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot

state.board = G.createBoard(ROWS, COLS, TYPES, rng);
buildGridMeshes();
buildLedger();
applyStage(0, false);
refreshPeek();
updateHUD(false);
restartIdle();
layoutCells();
requestAnimationFrame(tick);
