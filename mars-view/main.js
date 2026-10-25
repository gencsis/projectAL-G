/* Mars map: a true-scale globe that becomes a 1 m tile grid when you zoom in.
   Each Spirulina farm covers 10 x 10 tiles. Clicking a farm opens its panel (panel.js). */
(() => {
'use strict';

const CONFIG = {
  MARS_RADIUS_KM: 3389.5,
  PIXEL_M: 1,                      // tile size at the equator, metres
  FARM_TILES: 10,                  // a farm covers 10 x 10 tiles
  BASEMAP: 'assets/mars-basemap.jpg',
  TILES: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{row}/{col}.jpg',
  TILE_MAX_Z: 7,
  FOV_DEG: 40,
  MIN_ALT_KM: 0.02, MAX_ALT_KM: 16000, START_ALT_KM: 11000,
  PLACE_MIN_PX: 2,                 // a tile must be this many screen px wide before you can place
  GRID_FROM_PX: 5, GRID_FULL_PX: 10,
  GROUND_FROM_PX: 2.5, GROUND_FULL_PX: 7,
  ISO_FROM_PX: 3, ISO_FULL_PX: 12, // camera tilts between these tile sizes
  ISO_ELEVATION_DEG: 30,
  ISO_YAW_DEG: 45,
  DOME_SIZE: 0.68,                 // dome size as a share of its plot (leaves a gap for tunnels)
  SHADOW_ALPHA: 0.32,
};
const FARM = {
  // the dome seen with its door at front left, at front right, and from the back
  art: ['assets/farms/dome.png', 'assets/farms/dome-right.png', 'assets/farms/dome-back.png'],
  tunnel: ['assets/farms/tunnel-a.png', 'assets/farms/tunnel-b.png'], // tunnel running up-right (/), up-left (\)
  height: 4.5,                     // metres, for shadows
  tunnelW: 2.2,                    // tunnel width, metres (the picture is scaled to its length)
};

const Sim = window.FarmSim;
const R = CONFIG.MARS_RADIUS_KM, D = Math.PI / 180;
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (a, n) => ((a % n) + n) % n;
const key = (row, col) => `${row},${col}`;

/* ---------------- Tile grid (Web Mercator, like wplace) ---------------- */
const COLS = Math.round(2 * Math.PI * R * 1000 / CONFIG.PIXEL_M), ROWS = COLS;
const STEP = 2 * Math.PI / COLS;
const MAX_LAT = Math.atan(Math.sinh(Math.PI)) / D;     // 85.0511°
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * D / 2));
const latOfY = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D;
const rowF = lat => (Math.PI - mercY(lat)) / STEP;
const colF = lon => mod(lon + 180, 360) / 360 * COLS;
function cellAt(lat, lon) {
  if (Math.abs(lat) >= MAX_LAT) return null;
  return { row: clamp(Math.floor(rowF(lat)), 0, ROWS - 1), col: mod(Math.floor(colF(lon)), COLS) };
}
const cellCenter = (row, col) => ({ lat: latOfY(Math.PI - (row + 0.5) * STEP), lon: -180 + (col + 0.5) / COLS * 360 });
const cellSizeM = row => 2 * Math.PI * R * 1000 * Math.cos(cellCenter(row, 0).lat * D) / COLS;

/* ---------------- Mars time ---------------- */
const seasonName = ls => ({ north: ['spring', 'summer', 'autumn', 'winter'][Math.floor(ls / 90)], south: ['autumn', 'winter', 'spring', 'summer'][Math.floor(ls / 90)] });
const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

/* ---------------- WebGL ---------------- */
const cv = $('#map'), marks = $('#marks'), mctx = marks.getContext('2d');
const gl = cv.getContext('webgl2', { antialias: true, premultipliedAlpha: true });
if (!gl) { $('#toast').textContent = 'This browser has no WebGL2.'; $('#toast').hidden = false; throw new Error('WebGL2 required'); }

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp int;
uniform vec2 uRes; uniform vec3 uC, uE, uN; uniform float uDist, uTan, uDpr, uShade;
uniform sampler2D uBase, uDetail, uColorMap, uGround;
uniform vec4 uBox; uniform int uDetailOn, uLocal;
uniform ivec2 uCenterI, uHover; uniform int uHoverS; uniform float uHoverOk; uniform vec2 uCenterF;
uniform float uAltM, uCellM, uCellPx, uYaw, uSinT, uLatC, uLonC, uRm;
uniform int uGroundN; uniform float uGroundCdf[32]; uniform vec3 uGroundMean;
uniform vec4 uStorm[8]; uniform int uStormN;      // dust storms: lat, lon (deg), radius (km), strength 0..1
out vec4 o;
void main(){
  vec2 p = (gl_FragCoord.xy * 2. - uRes) / uRes.y;
  float lat, lon; vec3 P = vec3(0.), rd = vec3(0.); vec2 q = vec2(0.);
  if (uLocal == 1) {
    // close up: flat ground, orthographic camera tilted by uSinT and turned by uYaw.
    // q = metres east / north of the screen centre.
    vec2 sm = p * uTan * uAltM;
    vec2 fwd = vec2(sin(uYaw), cos(uYaw)), rgt = vec2(cos(uYaw), -sin(uYaw));
    q = sm.x * rgt + (sm.y / uSinT) * fwd;
    lat = uLatC + degrees(q.y / uRm); lon = uLonC + degrees(q.x / (uRm * cos(radians(uLatC))));
  } else {
    // far out: ray-trace the sphere
    vec3 ro = uC * uDist;
    rd = normalize(-uC + p.x * uTan * uE + p.y * uTan * uN);
    float b = dot(ro, rd), c = dot(ro, ro) - 1., disc = b * b - c;
    if (disc < 0.) {                                 // haze around the edge of the planet
      float closest = sqrt(max(0., c + 1. - b * b));
      float g = exp(-(closest - 1.) * 40.) * 0.55 * uShade;
      o = vec4(vec3(0.95, 0.66, 0.45) * g, g); return;
    }
    float t = c / (-b + sqrt(disc));
    P = normalize(ro + rd * t);
    lat = degrees(asin(clamp(P.z, -1., 1.))); lon = degrees(atan(P.y, P.x));
  }

  // terrain colour from the bundled map; NASA imagery adds the craters and ridges as brightness
  vec2 guv = vec2((lon + 180.) / 360., (90. - lat) / 180.);
  vec2 gdx = dFdx(guv), gdy = dFdy(guv);
  gdx.x -= round(gdx.x); gdy.x -= round(gdy.x);      // no seam at 180°
  vec3 g = textureGrad(uBase, guv, gdx, gdy).rgb;
  vec3 col = textureGrad(uColorMap, guv, gdx, gdy).rgb;
  const vec3 LW = vec3(.299, .587, .114);
  if (uDetailOn == 1) {
    vec2 uv = vec2(mod(lon - uBox.x + 360., 360.) / uBox.z, (uBox.y - lat) / uBox.w);
    if (uv.x >= 0. && uv.x <= 1. && uv.y >= 0. && uv.y <= 1.) {
      vec4 d = texture(uDetail, uv);
      if (d.a > 0.99) col *= clamp(dot(d.rgb, LW) / max(dot(g, LW), .03), .35, 1.9);
    }
  }

  // dust storms: a swirly tan haze, thickest at the centre
  for (int i = 0; i < 8; i++) {
    if (i >= uStormN) break;
    vec4 st = uStorm[i];
    float cd = sin(radians(lat)) * sin(radians(st.x)) + cos(radians(lat)) * cos(radians(st.x)) * cos(radians(lon - st.y));
    float dkm = acos(clamp(cd, -1., 1.)) * 3389.5, f = clamp(1. - (dkm / st.z) * (dkm / st.z), 0., 1.);
    float swirl = .75 + .25 * sin(lon * .35 + lat * .5 + sin(lat * .21) * 3.) * sin(lat * .3 - lon * .17);
    col = mix(col, vec3(.80, .60, .43), f * st.w * swirl * .85);
  }

  if (uLocal == 1 && abs(lat) < 85.05) {
    float cf = uCenterF.y + q.x / uCellM, rf = uCenterF.x - q.y / uCellM;
    ivec2 cell = uCenterI + ivec2(int(floor(rf)), int(floor(cf)));
    float fr = fract(rf), fc = fract(cf);
    // ground texture: a random (but fixed) tile per cell
    if (uGroundN > 0) {
      uint h = uint(cell.x) * 374761393u ^ uint(cell.y) * 668265263u;
      h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u;
      float r = float(h & 0xffffffu) / 16777216.;
      int gi = 0;
      for (int i = 0; i < 32; i++) { if (i >= uGroundN) break; gi = i; if (r < uGroundCdf[i]) break; }
      float gx = (h & 0x1000000u) != 0u ? 1. - fc : fc;            // random mirror
      vec4 gt = texture(uGround, vec2((float(gi) + clamp(gx, .001, .999)) / float(uGroundN), clamp(fr, .001, .999)));
      vec3 gc = col * clamp(gt.rgb / uGroundMean, 0., 2.5);
      col = mix(col, gc, gt.a * smoothstep(${CONFIG.GROUND_FROM_PX.toFixed(2)}, ${CONFIG.GROUND_FULL_PX.toFixed(2)}, uCellPx));
    }
    // grid lines
    float edge = min(min(fr, 1. - fr) / max(fwidth(rf), 1e-6), min(fc, 1. - fc) / max(fwidth(cf), 1e-6));
    float gridA = smoothstep(${CONFIG.GRID_FROM_PX}., ${CONFIG.GRID_FULL_PX}., uCellPx);
    col = mix(col, col * mix(0.78, 0.6, 1. - (uSinT - .5) * 2.), gridA * (1. - smoothstep(0., uDpr, edge)));
    // footprint under the cursor: white = fits, red = blocked
    if (uHoverS > 0) {
      float S = float(uHoverS), hr = rf - float(uHover.x - uCenterI.x), hc = cf - float(uHover.y - uCenterI.y);
      if (hr >= 0. && hc >= 0. && hr < S && hc < S) {
        float ed = min(min(hr, S - hr) / max(fwidth(rf), 1e-6), min(hc, S - hc) / max(fwidth(cf), 1e-6));
        vec3 oc = uHoverOk > .5 ? vec3(1.) : vec3(.92, .27, .2);
        col = mix(col, oc, .14);
        float hw = 2. * uDpr;
        if (ed < hw) col = oc; else if (ed < hw * 2.) col = vec3(0.1, 0.07, 0.06);
      }
    }
  }
  if (uLocal == 0) col *= mix(1., 0.55 + 0.45 * pow(dot(P, -rd), 0.6), uShade);   // globe shading
  o = vec4(col, 1.);
}`;

function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = n => gl.getUniformLocation(prog, n);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const pLoc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(pLoc); gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

const TEX = { base: 0, detail: 1, colorMap: 2, ground: 3 };
function makeTex(unit, filter, wrapS = gl.CLAMP_TO_EDGE) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([214, 132, 80, 255]));
  return t;
}
const texBase = makeTex(TEX.base, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
const texColorMap = makeTex(TEX.colorMap, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
const texDetail = makeTex(TEX.detail, gl.LINEAR);
const texGround = makeTex(TEX.ground, gl.NEAREST);
Object.entries({ uBase: TEX.base, uDetail: TEX.detail, uColorMap: TEX.colorMap, uGround: TEX.ground }).forEach(([n, u]) => gl.uniform1i(U(n), u));
function uploadImage(tex, unit, src, mips = true) {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D); dirty = true;
}

/* ---------------- NASA Mars Trek tiles ----------------
   Level z has 2^(z+1) x 2^z tiles of 256 px, each 180/2^z degrees; tile (0, 0) is at 90°N 180°W. */
const tileCache = new Map(), queue = []; let tilesOk = null, inflight = 0, lastFail = 0;
const tileUrl = (z, row, col) => CONFIG.TILES.replace('{z}', z).replace('{row}', row).replace('{col}', col);
function getTile(z, row, col) {
  const k = `${z}/${row}/${col}`;
  if (tilesOk === false && Date.now() - lastFail < 30000 && !tileCache.has(k)) return Promise.resolve(null);   // offline: retry every 30 s
  if (tileCache.has(k)) { const v = tileCache.get(k); tileCache.delete(k); tileCache.set(k, v); return v; }
  const p = new Promise(res => queue.push({ url: tileUrl(z, row, col), res })).then(bm => { if (!bm) tileCache.delete(k); return bm; });
  tileCache.set(k, p); pump();
  if (tileCache.size > 700) tileCache.delete(tileCache.keys().next().value);
  return p;
}
function pump() {
  while (inflight < 8 && queue.length) {
    const { url, res } = queue.pop(); inflight++;            // newest request first
    fetch(url).then(r => r.ok ? r.blob() : null).then(b => b && createImageBitmap(b))
      .then(bm => { if (bm) setTilesOk(true); res(bm || null); })
      .catch(() => { lastFail = Date.now(); setTilesOk(false); res(null); })
      .finally(() => { inflight--; pump(); });
  }
}
function setTilesOk(v) { if (tilesOk === v || (tilesOk && !v)) return; tilesOk = v; renderCredit(); }

// Whole planet at level 2 (2048 x 1024)
const globalCv = document.createElement('canvas'); globalCv.width = 2048; globalCv.height = 1024;
let bundled = null;
function buildGlobal() {
  const gx = globalCv.getContext('2d');
  if (bundled) { gx.drawImage(bundled, 0, 0, 2048, 1024); uploadImage(texBase, TEX.base, globalCv); }
  let n = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) getTile(2, r, c).then(bm => {
    if (bm) gx.drawImage(bm, c * 256, r * 256);
    if (++n % 8 === 0) uploadImage(texBase, TEX.base, globalCv);
  });
}

// Close-up patch: 8 x 8 tiles around the camera at the level that matches the zoom
const detailCv = document.createElement('canvas'); detailCv.width = detailCv.height = 2048;
let detail = null, detailGen = 0, detailUploadPending = false;
function updateDetail() {
  const level = Math.log2((180 / 256) / (kmPerPx() / (R * D)));
  if (level < 2.5) { if (detail) { detail = null; gl.uniform1i(U('uDetailOn'), 0); dirty = true; } return; }
  const z = clamp(Math.ceil(level), 3, CONFIG.TILE_MAX_Z);
  const span = 180 / 2 ** z, nc = 2 ** (z + 1), nr = 2 ** z;
  const cc = Math.floor((cam.lon + 180) / span), rc = Math.floor((90 - cam.lat) / span);
  if (detail && detail.z === z && Math.abs(mod(cc - detail.c0 - 3.5 + nc / 2, nc) - nc / 2) <= 2 && Math.abs(rc - detail.r0 - 3.5) <= 2) return;
  const r0 = clamp(rc - 3, 0, Math.max(0, nr - 8)), c0 = cc - 3, gen = ++detailGen;
  detail = { z, r0, c0 };
  const dx = detailCv.getContext('2d'); dx.clearRect(0, 0, 2048, 2048);
  const box = [-180 + c0 * span, 90 - r0 * span, 8 * span, 8 * span];
  const jobs = [];
  for (let r = 0; r < Math.min(8, nr); r++) for (let c = 0; c < 8; c++) jobs.push([r, c, Math.hypot(r0 + r + .5 - (90 - cam.lat) / span, c0 + c + .5 - (cam.lon + 180) / span)]);
  jobs.sort((a, b) => b[2] - a[2]);                       // far first, so the nearest load first
  for (const [r, c] of jobs) getTile(z, r0 + r, mod(c0 + c, nc)).then(bm => {
    if (gen !== detailGen || !bm) return;
    dx.drawImage(bm, c * 256, r * 256);
    if (!detailUploadPending) { detailUploadPending = true; requestAnimationFrame(() => {
      detailUploadPending = false; if (gen !== detailGen) return;
      uploadImage(texDetail, TEX.detail, detailCv, false);
      gl.uniform4f(U('uBox'), ...box); gl.uniform1i(U('uDetailOn'), 1);
    }); }
  });
}

/* ---------------- Ground tiles ----------------
   Close up, each 1 m tile gets one of these sand and rock tiles (random but fixed), drawn in code. */
const GROUND_CELL = 32;
function builtinGround() {
  let seed = 7; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 1013904223 | 0) >>> 0) / 4294967296;
  const N = 16, base = [206, 142, 96];
  const tile = draw => { const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const im = x.createImageData(N, N); draw(im.data); x.putImageData(im, 0, 0); return c; };
  const put = (d, i, j, rgb, k = 1) => { if (i < 0 || j < 0 || i >= N || j >= N) return; const o = (j * N + i) * 4; d[o] = clamp(rgb[0] * k, 0, 255); d[o + 1] = clamp(rgb[1] * k, 0, 255); d[o + 2] = clamp(rgb[2] * k, 0, 255); d[o + 3] = 255; };
  const sand = (d, tone = 1, grain = 0.07) => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(d, i, j, base, tone * (1 + (rnd() - .5) * grain * 2)); for (let s = 0; s < 4; s++) put(d, rnd() * N | 0, rnd() * N | 0, base, tone * 0.82); };
  // a stone lit from the top-left with a shadow to the bottom-right
  const stone = (d, cx, cy, r, grey = 0.25) => {
    const rgb = base.map(v => v * (1 - grey) + 150 * grey), wob = [0, 1, 2, 3, 4, 5].map(() => 0.75 + rnd() * 0.35);
    const rad = a => r * wob[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 6) % 6];
    for (let j = -r - 2; j <= r + 2; j++) for (let i = -r - 2; i <= r + 2; i++) {
      const a = Math.atan2(j - 1, i - 1), dd = Math.hypot(i - 1, j - 1);
      if (dd <= rad(a) + 0.3 && Math.hypot(i, j) > rad(Math.atan2(j, i))) put(d, cx + i, cy + j, base, 0.72);
    }
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const a = Math.atan2(j, i), dd = Math.hypot(i, j); if (dd > rad(a)) continue;
      const nx = i / Math.max(r, 1), ny = j / Math.max(r, 1), lit = 0.95 + 0.35 * (-nx * 0.7 - ny * 0.7) - 0.15 * (dd / r) ** 2;
      put(d, cx + i, cy + j, rgb, lit * (1 + (rnd() - .5) * 0.06));
    }
  };
  const tiles = [];
  for (let v = 0; v < 3; v++) tiles.push({ image: tile(d => sand(d, 1 + (v - 1) * 0.03)), weight: 20 });   // sand
  tiles.push({ image: tile(d => { sand(d, 1, 0.05); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const w = Math.sin((i * 0.35 + j) * 1.6); if (w > 0.75) put(d, i, j, base, 1.07); else if (w < -0.85) put(d, i, j, base, 0.9); } }), weight: 10 });   // ripples
  for (let v = 0; v < 4; v++) tiles.push({ image: tile(d => { sand(d); for (let k = 0, n = 2 + rnd() * 4 | 0; k < n; k++) stone(d, 2 + rnd() * 12 | 0, 2 + rnd() * 12 | 0, rnd() < .5 ? 1 : 2, 0.3); }), weight: 2.5 });   // pebbles
  for (let v = 0; v < 2; v++) tiles.push({ image: tile(d => { sand(d, 0.96, 0.09); for (let k = 0; k < 10; k++) put(d, rnd() * N | 0, rnd() * N | 0, base, 0.8 + rnd() * 0.3); }), weight: 4 });   // gravel
  for (let v = 0; v < 3; v++) tiles.push({ image: tile(d => { sand(d); stone(d, 5 + rnd() * 6 | 0, 5 + rnd() * 6 | 0, 2 + rnd() * 2 | 0); }), weight: 1.7 });   // rock
  for (let v = 0; v < 2; v++) tiles.push({ image: tile(d => { sand(d); stone(d, 7 + rnd() * 2 | 0, 7 + rnd() * 2 | 0, 5, 0.35); if (rnd() < .6) stone(d, 13, 12 + rnd() * 2 | 0, 1); }), weight: 0.75 });   // boulder
  return tiles;
}
// Pack the tiles into one texture, with their odds (weights) and average colour (used to tint them to the terrain)
function loadGround() {
  const tiles = builtinGround();
  const atlas = document.createElement('canvas'); atlas.width = GROUND_CELL * tiles.length; atlas.height = GROUND_CELL;
  const ax = atlas.getContext('2d'); ax.imageSmoothingEnabled = false;
  tiles.forEach((t, i) => ax.drawImage(t.image, i * GROUND_CELL, 0, GROUND_CELL, GROUND_CELL));
  const px = ax.getImageData(0, 0, atlas.width, GROUND_CELL).data, mean = [0, 0, 0]; let wsum = 0;
  tiles.forEach((t, i) => { for (let y = 0; y < GROUND_CELL; y++) for (let x = 0; x < GROUND_CELL; x++) { const o = (y * atlas.width + i * GROUND_CELL + x) * 4; mean[0] += px[o] * t.weight; mean[1] += px[o + 1] * t.weight; mean[2] += px[o + 2] * t.weight; wsum += t.weight; } });
  const total = tiles.reduce((a, t) => a + t.weight, 0); let acc = 0;
  const cdf = new Float32Array(32).fill(1); tiles.forEach((t, i) => { acc += t.weight / total; cdf[i] = acc; }); cdf[tiles.length - 1] = 1;
  gl.activeTexture(gl.TEXTURE0 + TEX.ground); gl.bindTexture(gl.TEXTURE_2D, texGround);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.uniform1i(U('uGroundN'), tiles.length); gl.uniform1fv(U('uGroundCdf'), cdf);
  gl.uniform3f(U('uGroundMean'), ...mean.map(v => Math.max(1, v / wsum) / 255));
  dirty = true;
}

/* ---------------- Farms ----------------
   Farms live on the server (server.js). A farm is stored by its north-west tile and covers
   FARM_TILES x FARM_TILES tiles. facing: which way the door points (0 west, 1 south, 2 east, 3 north),
   which is front left, front right, back right and back left in the starting view. */
const S = CONFIG.FARM_TILES;
const placed = new Map();          // key "row,col" -> farm from the server (owner, facing, health, oxygen, ...)
const occ = new Map();             // every covered tile -> its farm's key
const listeners = new Set(), inspectors = new Set();
let me = null, nextFacing = 0, o2Total = 0;   // logged-in username; door direction for the next farm
let nextBuildAt = 0, clockSkew = 0, starters = 0, storms = [], tutorial = -1;           // when you may build again (server time) and server minus local time
const valid = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < ROWS && col >= 0 && col < COLS;
const farmCenter = (row, col) => ({ lat: latOfY(Math.PI - (row + S / 2) * STEP), lon: -180 + mod(col + S / 2, COLS) / COLS * 360 });
const info = k => { const f = placed.get(k); return { ...f, ...farmCenter(f.row, f.col) }; };
function farmAt(row, col) { const a = occ.get(key(row, mod(col, COLS))); return a ? info(a) : null; }
const anchorFor = (row, col) => { const o = Math.floor((S - 1) / 2); return { row: row - o, col: mod(col - o, COLS) }; };   // farm centred on a tile
function canPlace(row, col) {
  if (row < 0 || row + S > ROWS) return false;
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) if (occ.has(key(row + i, mod(col + j, COLS)))) return false;
  return true;
}
function setOcc(row, col, val) { for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) { const k = key(row + i, mod(col + j, COLS)); if (val) occ.set(k, val); else occ.delete(k); } }
const list = () => [...placed.keys()].map(info);
const myFarms = () => list().filter(f => f.mine);
const buildWait = () => Math.max(0, nextBuildAt - (Date.now() + clockSkew));   // ms until you may build (the server decides)
const fmtWait = ms => { const m = Math.ceil(ms / 60e3); return `${Math.floor(m / 60)} h ${m % 60} min`; };
function emit() { dirty = true; renderCount(); updateHUD(); const l = list(); listeners.forEach(fn => fn(l)); }

// Talk to the server. Throws with the server's message when something is refused.
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `The server said no (${r.status}).`);
  return data;
}
// Get every farm and how it's doing (on start, after each change, and every 5 s)
let offline = false;
async function refresh() {
  try {
    const d = await call('GET', '/api/farms');
    nextBuildAt = d.nextBuildAt || 0; clockSkew = d.now - Date.now(); starters = d.starters || 0; tutorial = d.tutorial ?? -1;
    setUser(d.me);
    placed.clear(); occ.clear();
    for (const f of d.farms) { placed.set(f.key, f); setOcc(f.row, f.col, f.key); }
    o2Total = d.o2Total; storms = d.storms || []; uploadStorms();
    $('#o2Total').textContent = kg(o2Total);
    if (!$('#o2Info').hidden) renderO2();
    if (offline) { offline = false; toast('Connected to the server.'); }
    emit();
  } catch (e) {
    if (!offline) { offline = true; toast("Can't reach the server. Start it with: node server.js", 8000); }
  }
}
async function change(promise) { try { await promise; } catch (e) { toast(e.message); } refresh(); }
function place(row, col, facing = nextFacing) {
  col = mod(col, COLS);
  if (!me) { window.showLogin(); return false; }
  if (buildWait() > 0) { toast(`You can build one farm a day. Next one in ${fmtWait(buildWait())}.`); return false; }
  if (!valid(row, col) || !canPlace(row, col)) return false;
  const k = key(row, col);   // show it straight away; the next refresh brings the server's copy
  placed.set(k, { key: k, row, col, facing, owner: me, mine: true, health: 1, o2Rate: 0, limiting: 'none' }); setOcc(row, col, k); emit();
  change(call('POST', '/api/farms', { row, col, facing })); return true;
}
function remove(row, col) {
  const f = farmAt(row, col); if (!f || !f.mine) return false;
  placed.delete(f.key); setOcc(f.row, f.col, null); emit();
  change(call('DELETE', `/api/farms/${f.key}`)); return true;
}
const turn = k => change(call('POST', `/api/farms/${k}/action`, { type: 'turn' }));
// Dust storms for the shader, and the dust icon when one is over your domes
function uploadStorms() {
  const v = new Float32Array(32), n = Math.min(8, storms.length);
  storms.slice(0, 8).forEach((st, i) => v.set([st.lat, st.lon, st.global ? 1e5 : st.km, Math.min(1, st.tau / 2)], i * 4));
  gl.uniform4fv(U('uStorm'), v); gl.uniform1i(U('uStormN'), n); dirty = true;
  const dusty = myFarms().filter(f => f.tau > 1).length;
  $('#dust').hidden = !dusty; $('#dust').title = `Dust storm over ${dusty} of your domes: less sunlight, turn up the lamps`;
}
// A short message at the bottom of the screen
let toastTimer = 0;
function toast(text, ms = 3500) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------------- Camera ---------------- */
const cam = { lat: 12, lon: -70, alt: CONFIG.START_ALT_KM };
let W = 0, H = 0, dpr = 1, dirty = true, mode = 'place';
const TAN = Math.tan(CONFIG.FOV_DEG / 2 * D);
const RM = R * 1000;
const vec = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
function basis() {
  const c = vec(cam.lat, cam.lon), e = [-Math.sin(cam.lon * D), Math.cos(cam.lon * D), 0];
  return { c, e, n: [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]] };
}
const kmPerPx = () => cam.alt * TAN / (H / 2);           // ground km per screen pixel at the centre
const centerCellM = () => cellSizeM(clamp(Math.floor(rowF(clamp(cam.lat, -MAX_LAT + 1e-6, MAX_LAT - 1e-6))), 0, ROWS - 1));
const pixelPx = () => centerCellM() / 1000 / kmPerPx();  // tile size on screen
const LOCAL_ALT_KM = 3 * CONFIG.PIXEL_M;                 // below this the ground is drawn flat
const isLocal = () => cam.alt < LOCAL_ALT_KM && Math.abs(cam.lat) < MAX_LAT - 0.05;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let yawDeg = CONFIG.ISO_YAW_DEG;
const isoK = () => isLocal() ? smooth(CONFIG.ISO_FROM_PX, CONFIG.ISO_FULL_PX, pixelPx()) : 0;   // 0 = top-down, 1 = isometric
function localCam() {
  const k = isoK(), elev = (90 - k * (90 - CONFIG.ISO_ELEVATION_DEG)) * D, yaw = k * yawDeg * D;
  return { sinT: Math.sin(elev), cosT: Math.cos(elev), yaw, Hm: cam.alt * 1000 * TAN,
           fwd: [Math.sin(yaw), Math.cos(yaw)], rgt: [Math.cos(yaw), -Math.sin(yaw)] };
}
function screenToGround(sx, sy, L = localCam()) {     // -> metres [east, north] from the screen centre
  const u = (2 * sx - W) / H * L.Hm, v = -(2 * sy - H) / H * L.Hm / L.sinT;
  return [u * L.rgt[0] + v * L.fwd[0], u * L.rgt[1] + v * L.fwd[1]];
}
function groundToScreen(e, n, L = localCam()) {
  const u = e * L.rgt[0] + n * L.rgt[1], v = (e * L.fwd[0] + n * L.fwd[1]) * L.sinT;
  return [W / 2 + u / L.Hm * H / 2, H / 2 - v / L.Hm * H / 2];
}
// screen point -> lat/lon (same maths as the shader)
function pick(sx, sy) {
  if (isLocal()) { const g = screenToGround(sx, sy); return { lat: cam.lat + g[1] / RM / D, lon: cam.lon + g[0] / (RM * Math.cos(cam.lat * D)) / D }; }
  const { c, e, n } = basis(), dist = 1 + cam.alt / R;
  const px = (2 * sx - W) / H, py = -(2 * sy - H) / H;
  let rd = [0, 1, 2].map(i => -c[i] + px * TAN * e[i] + py * TAN * n[i]);
  const L = Math.hypot(...rd); rd = rd.map(v => v / L);
  const ro = c.map(v => v * dist);
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2], cc = dist * dist - 1, disc = b * b - cc;
  if (disc < 0) return null;
  const t = cc / (-b + Math.sqrt(disc));
  const P = [0, 1, 2].map(i => ro[i] + rd[i] * t), l = Math.hypot(...P);
  return { lat: Math.asin(clamp(P[2] / l, -1, 1)) / D, lon: Math.atan2(P[1], P[0]) / D };
}
// screen point -> tile. Up close this uses metre offsets like the shader, so clicks land exactly.
function cellFromScreen(sx, sy) {
  if (isLocal()) {
    const s = centerCellM(), q = screenToGround(sx, sy);
    const row = Math.floor(rowF(cam.lat) - q[1] / s), col = mod(Math.floor(colF(cam.lon) + q[0] / s), COLS);
    return valid(row, col) ? { row, col } : null;
  }
  const ll = pick(sx, sy); return ll && cellAt(ll.lat, ll.lon);
}
// lat/lon -> screen point on the globe (null if behind it)
function project(lat, lon) {
  const { c, e, n } = basis(), dist = 1 + cam.alt / R, v = vec(lat, lon);
  const d = v.map((x, i) => x - c[i] * dist), depth = -(d[0] * c[0] + d[1] * c[1] + d[2] * c[2]);
  if (v[0] * c[0] + v[1] * c[1] + v[2] * c[2] < 1 / dist) return null;
  return { x: W / 2 + (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / depth / TAN * H / 2, y: H / 2 - (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / depth / TAN * H / 2 };
}
function changed() {
  cam.alt = clamp(cam.alt, CONFIG.MIN_ALT_KM, CONFIG.MAX_ALT_KM); cam.lat = clamp(cam.lat, -89.5, 89.5); cam.lon = mod(cam.lon + 180, 360) - 180;
  dirty = true; updateHUD(); updateDetail();
}
function zoomAt(sx, sy, factor) {                     // keeps the point under the cursor fixed
  const before = pick(sx, sy);
  cam.alt = clamp(cam.alt / factor, CONFIG.MIN_ALT_KM, CONFIG.MAX_ALT_KM);
  const after = pick(sx, sy);
  if (before && after) { cam.lat += before.lat - after.lat; cam.lon += mod(before.lon - after.lon + 540, 360) - 180; }
  changed();
}
let anim = 0;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateZoom(factor, sx = W / 2, sy = H / 2) {
  if (reduceMotion()) return zoomAt(sx, sy, factor);
  const steps = Math.round(clamp(Math.abs(Math.log2(factor)) * 6, 8, 40)), f = Math.pow(factor, 1 / steps); let i = 0;
  cancelAnimationFrame(anim);
  const tick = () => { zoomAt(sx, sy, f); if (++i < steps) anim = requestAnimationFrame(tick); };
  tick();
}
function pan(dx, dy) {
  if (isLocal()) {
    const g = screenToGround(W / 2 + dx, H / 2 + dy);
    cam.lat -= g[1] / RM / D; cam.lon -= g[0] / (RM * Math.cos(cam.lat * D)) / D;
    return changed();
  }
  const k = Math.min(kmPerPx(), 2 * R / H * 1.2);      // cap the turn speed when far out
  cam.lat += dy * k / R / D;
  cam.lon -= dx * k / (R * Math.max(0.05, Math.cos(cam.lat * D))) / D;
  changed();
}
function rotate(dir) {                                // turn the close-up camera 90°
  const from = yawDeg, to = CONFIG.ISO_YAW_DEG + 90 * Math.round((yawDeg - CONFIG.ISO_YAW_DEG) / 90 + dir);
  const t0 = performance.now();
  const tick = now => { const t = reduceMotion() ? 1 : Math.min(1, (now - t0) / 350); yawDeg = from + (to - from) * (1 - (1 - t) ** 3); dirty = true; if (t < 1) requestAnimationFrame(tick); else renderDoor(); };
  requestAnimationFrame(tick);
}
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  marks.width = cv.width; marks.height = cv.height;
  gl.viewport(0, 0, cv.width, cv.height); changed();
}

/* ---------------- Drawing ---------------- */
let hoverCell = null;
function draw() {
  const { c, e, n } = basis(), local = isLocal();
  gl.uniform2f(U('uRes'), cv.width, cv.height);
  gl.uniform3fv(U('uC'), c); gl.uniform3fv(U('uE'), e); gl.uniform3fv(U('uN'), n);
  gl.uniform1f(U('uDist'), 1 + cam.alt / R); gl.uniform1f(U('uTan'), TAN); gl.uniform1f(U('uDpr'), dpr);
  gl.uniform1f(U('uShade'), clamp((cam.alt - 300) / 2500, 0, 1));
  gl.uniform1i(U('uLocal'), local ? 1 : 0);
  if (local) {
    const rF = rowF(cam.lat), cF = colF(cam.lon), rI = Math.floor(rF), cI = Math.floor(cF);
    gl.uniform2i(U('uCenterI'), rI, cI); gl.uniform2f(U('uCenterF'), rF - rI, cF - cI);
    gl.uniform1f(U('uAltM'), cam.alt * 1000); gl.uniform1f(U('uCellM'), centerCellM()); gl.uniform1f(U('uCellPx'), pixelPx());
    const pv = previewFor(hoverCell);
    gl.uniform2i(U('uHover'), pv ? pv.row : 0, pv ? pv.col : 0); gl.uniform1i(U('uHoverS'), pv ? S : 0); gl.uniform1f(U('uHoverOk'), pv && pv.ok ? 1 : 0);
    const L = localCam();
    gl.uniform1f(U('uYaw'), L.yaw); gl.uniform1f(U('uSinT'), L.sinT);
    gl.uniform1f(U('uLatC'), cam.lat); gl.uniform1f(U('uLonC'), cam.lon); gl.uniform1f(U('uRm'), RM);
  }
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, W, H);
  if (local && pixelPx() >= 2) drawDomes(); else drawDots();
}
// Load an image and measure its bottom outline once it arrives
function loadArt(src) {
  const i = new Image();
  i.onload = () => { i.profile = bottomProfile(i); i.line = bottomLine(i.profile); dirty = true; };
  i.src = src; return i;
}
const ready = i => i.complete && i.profile;
const domeArt = FARM.art.map(loadArt), tunnelArt = FARM.tunnel.map(loadArt);
const farmIcon = loadArt('assets/ui/your-farm.png');

// zoomed out: a ring for every farm, labelled "Your farm" on yours
function drawDots() {
  const seen = new Set();
  mctx.font = '15px "Instrument Serif", Georgia, serif'; mctx.textAlign = 'center';
  for (const f of list()) {
    const p = project(f.lat, f.lon);
    if (!p || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
    const g = `${f.mine}/${Math.round(p.x / 12)},${Math.round(p.y / 12)}`; if (seen.has(g)) continue; seen.add(g);
    if (ready(farmIcon)) mctx.drawImage(farmIcon, p.x - 12, p.y - 12, 24, 24);
    if (f.mine) { mctx.fillStyle = '#f2ece4'; mctx.shadowColor = '#000'; mctx.shadowBlur = 4; mctx.fillText('Your farm', p.x, p.y - 20); mctx.shadowBlur = 0; }
  }
}

// For each column of an image: how far down its lowest solid pixel is (0..1)
function bottomProfile(img) {
  const n = 200, hh = Math.max(1, Math.round(n * img.naturalHeight / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = n; c.height = hh; const x = c.getContext('2d');
  x.drawImage(img, 0, 0, n, hh); const d = x.getImageData(0, 0, n, hh).data, prof = [];
  for (let i = 0; i < n; i++) { let b = -1; for (let j = hh - 1; j >= 0; j--) if (d[(j * n + i) * 4 + 3] > 128) { b = j; break; } if (b >= 0) prof.push([(i + .5) / n, (b + 1) / hh]); }
  return prof;
}
// Straight line through the middle of the bottom outline: [height at left edge, height at right edge]. Used for tunnels.
function bottomLine(prof) {
  const pts = prof.filter(([u]) => u > .2 && u < .8); if (pts.length < 2) return null;
  const n = pts.length, mu = pts.reduce((a, p) => a + p[0], 0) / n, mb = pts.reduce((a, p) => a + p[1], 0) / n;
  const k = pts.reduce((a, p) => a + (p[0] - mu) * (p[1] - mb), 0) / pts.reduce((a, p) => a + (p[0] - mu) ** 2, 0);
  return [mb - k * mu, mb + k * (1 - mu)];
}
// Sun elevation (deg) and the ground direction it shines from [east, north]
function sunAt(lat, lon, clock) {
  const dec = Math.asin(Math.sin(25.19 * D) * Math.sin(clock.ls * D)), h = (Sim.ltst(clock, lon) - 12) * 15 * D, phi = lat * D;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  const az = Math.atan2(-Math.sin(h) * Math.cos(dec), Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h));
  return { el: el / D, dir: [Math.sin(az), Math.cos(az)] };
}
const shadowCv = document.createElement('canvas'), sctx = shadowCv.getContext('2d');
// zoomed in: domes, tunnels between touching domes, and shadows, drawn back to front
function drawDomes() {
  const L = localCam(), s = centerCellM(), rF = rowF(cam.lat), cF = colF(cam.lon), size = S * s, objs = [];
  const turns = camTurns();
  const corner = (r, c) => [(mod(c - cF + COLS / 2, COLS) - COLS / 2) * s, -(r - rF) * s];   // north-west corner, metres from the centre
  const depth = (e, n) => e * L.fwd[0] + n * L.fwd[1];
  const addDome = (r, c, facing, ghost, farm) => {
    const [e0, n0] = corner(r, c);
    const pts = [[e0, n0], [e0 + size, n0], [e0 + size, n0 - size], [e0, n0 - size]].map(([e, n]) => groundToScreen(e, n, L));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (box.x > W + 300 || box.x + box.w < -300 || box.y > H + 300 || box.y + box.h < -600) return;
    const ce = e0 + size / 2, cn = n0 - size / 2;
    objs.push({ kind: 'dome', img: domeArt[Math.min(2, mod(facing + turns, 4))], box, ce, cn, ghost, farm, depth: depth(ce, cn) });
  };
  // A tunnel from the middle of the nearer dome (hidden behind it) to the wall of the farther dome.
  // Drawn after the farther dome and before the nearer one, so it looks attached to both.
  const domeR = 0.636 * CONFIG.DOME_SIZE * size;          // dome radius on the ground, metres (art is 0.9 x the diamond's width)
  const addTunnel = (e, n, axis) => {                     // e, n: middle of the shared edge; axis: east [1, 0] or north [0, 1]
    const far = depth(e + axis[0], n + axis[1]) > depth(e - axis[0], n - axis[1]) ? 1 : -1;
    const dir = [axis[0] * far, axis[1] * far], from = -size / 2, to = size / 2 - domeR * 0.75;   // metres along dir from the edge
    // the picture's bottom edge is the tunnel's near side, so move the line half a tunnel width toward the camera
    const side = [-dir[1], dir[0]], toCam = side[0] * L.fwd[0] + side[1] * L.fwd[1] > 0 ? -FARM.tunnelW / 2 : FARM.tunnelW / 2;
    e += side[0] * toCam; n += side[1] * toCam;
    const a = groundToScreen(e + dir[0] * from, n + dir[1] * from, L), b = groundToScreen(e + dir[0] * to, n + dir[1] * to, L);
    const [p, q] = a[0] < b[0] ? [a, b] : [b, a];
    if (q[0] < -100 || p[0] > W + 100) return;
    objs.push({ kind: 'tunnel', img: tunnelArt[q[1] < p[1] ? 0 : 1], p, q, depth: depth(e, n) });
  };
  for (const [k, f] of placed) {
    const [r, c] = k.split(',').map(Number);
    addDome(r, c, f.facing, false, f);
    const [e0, n0] = corner(r, c);
    if (placed.has(key(r, mod(c + S, COLS)))) addTunnel(e0 + size, n0 - size / 2, [1, 0]);   // neighbour to the east
    if (placed.has(key(r + S, c))) addTunnel(e0 + size / 2, n0 - size, [0, 1]);             // neighbour to the south
  }
  const pv = mode === 'place' && previewFor(hoverCell);                      // see-through dome where the next farm would go
  if (pv && pv.ok && !farmAt(hoverCell.row, hoverCell.col)) addDome(pv.row, pv.col, nextFacing, true);
  objs.sort((a, b) => b.depth - a.depth);                // farthest first

  // shadows: each dome's base circle swept away from the sun by height / tan(sun elevation)
  const sun = sunAt(cam.lat, cam.lon, Sim.marsClock(Date.now()));
  if (sun.el > 0.5) {
    if (shadowCv.width !== marks.width || shadowCv.height !== marks.height) { shadowCv.width = marks.width; shadowCv.height = marks.height; }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, W, H); sctx.fillStyle = '#1a0d08';
    const ellipse = (e, n, rad) => { sctx.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, p = groundToScreen(e + Math.cos(a) * rad, n + Math.sin(a) * rad, L); i ? sctx.lineTo(...p) : sctx.moveTo(...p); } sctx.closePath(); sctx.fill(); };
    const rad = size / 2 * 0.85 * CONFIG.DOME_SIZE, len = Math.min(FARM.height / Math.tan(sun.el * D), size * 6);
    for (const o of objs) {
      if (o.kind !== 'dome' || o.ghost) continue;
      const se = o.ce - sun.dir[0] * len, sn = o.cn - sun.dir[1] * len, px = -sun.dir[1] * rad, py = sun.dir[0] * rad;
      ellipse(o.ce, o.cn, rad); ellipse(se, sn, rad * 0.75);
      const q = [[o.ce + px, o.cn + py], [se + px * .75, sn + py * .75], [se - px * .75, sn - py * .75], [o.ce - px, o.cn - py]].map(([e, n]) => groundToScreen(e, n, L));
      sctx.beginPath(); q.forEach((p, i) => i ? sctx.lineTo(...p) : sctx.moveTo(...p)); sctx.closePath(); sctx.fill();
    }
    mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalAlpha = CONFIG.SHADOW_ALPHA * Math.min(1, sun.el / 8);   // fade at sunrise and sunset
    mctx.drawImage(shadowCv, 0, 0); mctx.restore();
  }

  // art is only scaled, never edited
  mctx.imageSmoothingQuality = 'high';
  const labels = [], hf = hoverCell && farmAt(hoverCell.row, hoverCell.col), hoverKey = hf && hf.key;
  for (const o of objs) {
    const img = o.img; if (!ready(img)) continue;
    if (o.kind === 'dome') {
      // a smaller diamond in the middle of the plot; the art's base sits on its two front edges
      // and the top can rise over the tiles behind
      const k = CONFIG.DOME_SIZE, cx = o.box.x + o.box.w / 2, cy = o.box.y + o.box.h / 2;
      const w = o.box.w * k * 0.9, h = w * img.naturalHeight / img.naturalWidth;
      const bottom = cy + o.box.h * k / 2, slope = o.box.h / o.box.w;
      let y0 = Infinity;
      for (const [u, b] of img.profile) y0 = Math.min(y0, bottom - Math.abs((u - .5) * w) * slope - h * b);
      mctx.globalAlpha = o.ghost ? 0.5 : 1;
      mctx.imageSmoothingEnabled = w < img.naturalWidth / 2;
      mctx.drawImage(img, cx - w / 2, y0, w, h);
      if (o.farm && hoverKey === o.farm.key) labels.push([o.farm, cx, y0]);   // only the dome under the pointer gets a tag
      else if (o.farm && o.farm.asksHelp && !o.farm.mine) helpBadge(cx, y0 - 6);   // the owner asked for starters
    } else if (img.line) {
      // the image's bottom edge is stretched across the tunnel's ground line
      const w = o.q[0] - o.p[0], h = w * img.naturalHeight / img.naturalWidth;
      mctx.globalAlpha = 1; mctx.imageSmoothingEnabled = w < img.naturalWidth / 2;
      mctx.drawImage(img, o.p[0], o.p[1] - img.line[0] * h, w, h);
    }
  }
  mctx.globalAlpha = 1;
  for (const [f, x, y] of labels) farmLabel(f, x, y - 8);
}
// A small "+" above a dome whose owner asked for starters
function helpBadge(x, y) {
  mctx.fillStyle = '#1f3520'; mctx.strokeStyle = '#8fc65a'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.arc(x, y - 10, 10, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
  mctx.beginPath(); mctx.moveTo(x - 5, y - 10); mctx.lineTo(x + 5, y - 10); mctx.moveTo(x, y - 15); mctx.lineTo(x, y - 5); mctx.stroke();
}
// A tag above a farm: owner and oxygen. Dot: green = healthy, yellow = recovering, red = stressed.
function farmLabel(f, x, y) {
  const filled = (f.panels || []).filter(p => p !== 'empty' && p !== 'dead').length;
  const text = `${f.mine ? 'You' : f.owner} · ${filled}/4 panels · ${f.o2Rate.toFixed(1)} g/h O₂${f.asksHelp && !f.mine ? ' · wants a starter' : ''}${f.tau > 1 ? ' · dust storm' : ''}`;
  mctx.font = '15px "Instrument Serif", Georgia, serif';
  const w = mctx.measureText(text).width + 30, h = 22;
  mctx.fillStyle = 'rgba(34, 34, 34, .82)'; mctx.fillRect(x - w / 2, y - h, w, h);
  mctx.fillStyle = f.stress || f.health < 0.5 ? '#e0663a' : f.health < 0.9 ? '#e0b040' : '#8fc65a';
  mctx.beginPath(); mctx.arc(x - w / 2 + 11, y - h / 2, 4.5, 0, Math.PI * 2); mctx.fill();
  mctx.fillStyle = '#f2ece4'; mctx.textAlign = 'left'; mctx.textBaseline = 'middle'; mctx.fillText(text, x - w / 2 + 21, y - h / 2 + 1);
  mctx.textBaseline = 'alphabetic';
}

/* ---------------- Input ---------------- */
const ptrs = new Map(); let moved = 0, pinch = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  cv.classList.add('dragging'); cancelAnimationFrame(anim);
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (p) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1) pan(dx, dy);
    else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d); pinch.d = d;
    }
  }
  updateHover(e.clientX, e.clientY);
});
const endPtr = e => {
  if (ptrs.size === 1 && moved < 6 && e.type === 'pointerup') click(e.clientX, e.clientY);
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) cv.classList.remove('dragging');
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', () => { hoverCell = null; dirty = true; });
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022)); updateHover(e.clientX, e.clientY); }, { passive: false });
addEventListener('keydown', e => {
  if (e.target.closest('input, select')) return;
  if (e.key === '+' || e.key === '=') animateZoom(2); else if (e.key === '-') animateZoom(0.5);
  else if (e.key === 'ArrowLeft') pan(80, 0); else if (e.key === 'ArrowRight') pan(-80, 0);
  else if (e.key === 'ArrowUp') pan(0, 80); else if (e.key === 'ArrowDown') pan(0, -80);
  else if (e.key === 'q' || e.key === 'Q') rotate(-1); else if (e.key === 'e' || e.key === 'E') rotate(1);
  else if ((e.key === 'r' || e.key === 'R') && me) turnNext();
});

function click(sx, sy) {
  const c = cellFromScreen(sx, sy); if (!c) return;
  if (pixelPx() < CONFIG.PLACE_MIN_PX) { animateZoom(Math.min(40, CONFIG.PLACE_MIN_PX * 3 / pixelPx()), sx, sy); return; }   // too far: zoom in first
  const f = farmAt(c.row, c.col);
  if (f) {
    if (mode === 'erase') remove(c.row, c.col);
    else inspectors.forEach(fn => fn(f));
    return;
  }
  if (mode === 'place') { const a = anchorFor(c.row, c.col); place(a.row, a.col); }
}
// footprint outline for the hovered tile: the farm there, or where a new one would go
function previewFor(c) {
  if (!c || pixelPx() < CONFIG.PLACE_MIN_PX) return null;
  const f = farmAt(c.row, c.col); if (f) return { row: f.row, col: f.col, ok: mode !== 'erase' || f.mine };
  if (mode === 'erase' || !me) return null;
  const a = anchorFor(c.row, c.col);
  return { ...a, ok: canPlace(a.row, a.col) && buildWait() === 0 };
}
function updateHover(sx, sy) {
  const c = cellFromScreen(sx, sy);
  if (!c) { if (hoverCell) { hoverCell = null; dirty = true; } return; }
  if (!hoverCell || hoverCell.row !== c.row || hoverCell.col !== c.col) { hoverCell = c; dirty = true; }
}

/* ---------------- UI ---------------- */
function setMode(m) {
  mode = m;
  $('#erase').setAttribute('aria-pressed', m === 'erase');
  cv.classList.toggle('erasing', m === 'erase');
  dirty = true;
}
function renderCount() {
  const n = myFarms().length, wait = buildWait();
  $('#count').innerHTML = `${n} dome${n === 1 ? '' : 's'}<br>${starters} starter culture${starters === 1 ? '' : 's'}<br>${wait ? `Next dome in ${fmtWait(wait)}` : 'You can build a dome today'}`;
}
// Door side for your next farm, named for the current view: front left, front right, back right, back left
const SIDES = ['front left', 'front right', 'back right', 'back left'];
const camTurns = () => mod(Math.round((yawDeg - CONFIG.ISO_YAW_DEG) / 90), 4);
function turnNext() { nextFacing = mod(nextFacing + 1, 4); renderDoor(); dirty = true; }
function renderDoor() { const side = mod(nextFacing + camTurns(), 4); $('#turn').title = `Door: ${SIDES[side]} (R)`; $('#turn').dataset.side = side; }
// Fly the camera to a place: out, across, and back down
let flight = 0;
function flyTo(lat, lon, altKm) {
  cancelAnimationFrame(flight); cancelAnimationFrame(anim);
  const a = { ...cam }, dLon = mod(lon - a.lon + 540, 360) - 180, t0 = performance.now();
  const ms = reduceMotion() ? 0 : 2200, top = Math.max(a.alt, altKm, Math.hypot(lat - a.lat, dLon) * 60);   // climb higher for longer trips
  const tick = now => {
    const t = ms ? Math.min(1, (now - t0) / ms) : 1, k = t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    cam.lat = a.lat + (lat - a.lat) * k; cam.lon = a.lon + dLon * k;
    const up = Math.log(a.alt) + (Math.log(top) - Math.log(a.alt)) * Math.min(1, t * 2.5), down = Math.log(top) + (Math.log(altKm) - Math.log(top)) * Math.max(0, (t - .4) / .6);
    cam.alt = Math.exp(t < .4 ? up : down); changed();
    if (t < 1) flight = requestAnimationFrame(tick);
  };
  flight = requestAnimationFrame(tick);
}
// Teleport button: visit your farms one after another
let tpIndex = 0;
function teleport() {
  const mine = myFarms();
  if (!mine.length) return;
  const f = mine[tpIndex++ % mine.length]; flyTo(f.lat, f.lon, 0.06);
}
// Who is logged in (the server says, on every refresh). Anyone can look around; you need to log in to build.
function setUser(name) {
  if ((name || null) === me) return;
  me = name || null; document.body.classList.toggle('logged-out', !me);
  $('#who').textContent = me || '';
  if (!me) setMode('place');
  updateHUD();
}
// Show only the buttons that do something right now
function updateHUD() {
  if (!H) return;
  const near = pixelPx() >= CONFIG.PLACE_MIN_PX, iso = isoK() > 0.05;
  $('#rotL').hidden = $('#rotR').hidden = !iso;
  for (const b of document.querySelectorAll('#tools .build')) b.hidden = !me || !near;
  // the go-to-your-dome button only when one of your domes exists and none is on screen
  const mine = me ? myFarms() : [], viewKm = kmPerPx() * Math.max(W, H) / 2;
  const onScreen = mine.some(f => { const p = project(f.lat, f.lon); return p && p.x > 0 && p.y > 0 && p.x < W && p.y < H && (isLocal() || viewKm < 50); });
  $('#teleport').hidden = !mine.length || onScreen;
}
function renderClock() {
  const c = Sim.marsClock(Date.now()), sn = seasonName(c.ls);
  $('#clock').textContent = `Mars Year ${c.my} · ${sn.south} in the south, ${sn.north} in the north · ${hhmm(c.mtc)} MTC`;
  dirty = true;                                        // shadows follow the sun
}
function renderCredit() { $('#credit').textContent = tilesOk === false ? 'NASA tiles offline · bundled map' : 'Terrain: NASA Mars Trek · Viking MDIM 2.1'; }
$('#meBtn').onclick = () => { $('#side').hidden = !$('#side').hidden; if (!$('#side').hidden) loadTeam(); };
// Teamwork in your drawer: ask for starters, and choose caretakers
async function loadTeam() {
  try {
    const t = await call('GET', '/api/me');
    $('#asksHelp').checked = t.asksHelp;
    $('#helped').textContent = t.helped ? `You've given ${t.helped} starter${t.helped > 1 ? 's' : ''} to other players.` : 'Give a spare starter to someone who asks: open their dome and fill an empty panel.';
    $('#caretakers').innerHTML = t.caretakers.map(n => `<li>${n} <button class="tiny" data-remove="${n}" aria-label="Remove ${n}">✕</button></li>`).join('') || '<li class="sub">Nobody yet.</li>';
    $('#caretakers').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => team({ removeCaretaker: b.dataset.remove }));
    $('#caretakerFor').textContent = t.caretakerFor.length ? `You care for domes of: ${t.caretakerFor.join(', ')}` : '';
  } catch (e) { toast(e.message); }
}
async function team(change) { try { await call('POST', '/api/me', change); } catch (e) { toast(e.message); } loadTeam(); refresh(); }
$('#asksHelp').onchange = e => team({ asksHelp: e.target.checked });
$('#addCaretaker').onsubmit = e => { e.preventDefault(); const n = $('#caretakerName').value.trim(); if (n) { $('#caretakerName').value = ''; team({ addCaretaker: n }); } };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { $(`#${b.dataset.close}`).hidden = true; });
$('#rotL').onclick = () => rotate(-1);
$('#rotR').onclick = () => rotate(1);
$('#erase').onclick = () => setMode(mode === 'erase' ? 'place' : 'erase');
$('#turn').onclick = turnNext;
$('#teleport').onclick = teleport;

/* ---------------- Oxygen on this server (click the counter, top left) ---------------- */
// A person breathes about 0.818 kg of O₂ a day (NASA Life Support Baseline Values and Assumptions
// Document, Anderson et al. 2018).
const O2_PER_PERSON_DAY = 0.818;
const kg = v => v < 1 ? `${(v * 1000).toFixed(0)} g` : `${v.toFixed(2)} kg`;
function renderO2() {
  const farms = list(), rate = farms.reduce((a, f) => a + (f.o2Rate || 0), 0);             // g/h, every dome
  const panels = farms.reduce((a, f) => a + (f.panels || []).filter(p => p !== 'empty' && p !== 'dead').length, 0);
  const people = rate * 24 / 1000 / O2_PER_PERSON_DAY, days = o2Total / O2_PER_PERSON_DAY;
  const supports = people >= 1 ? `about <b>${people.toFixed(people < 10 ? 1 : 0)} people</b>`
    : people > 0 ? `<b>${(people * 100).toFixed(people < 0.01 ? 2 : 0)}%</b> of one person` : '<b>nobody</b> yet';
  $('#o2Info').innerHTML = `<h2>Oxygen On This Server</h2>
    <p><b>${kg(o2Total)}</b> made by everyone so far: enough air for one person for <b>${days < 1 ? `${(days * 24).toFixed(1)} hours` : `${days.toFixed(1)} days`}</b>.</p>
    <p>Right now <b>${rate.toFixed(1)} g/h</b> from ${farms.length} dome${farms.length === 1 ? '' : 's'} (${panels} growing panel${panels === 1 ? '' : 's'}). That keeps ${supports} breathing.</p>
    <p class="sub">One person breathes about ${O2_PER_PERSON_DAY} kg of oxygen a day (NASA life-support baseline).${people > 0 && people < 1 ? ` About ${Math.ceil(1 / people)}× the current output would keep one person alive.` : ''}</p>`;
}
$('#o2').onclick = () => { const open = $('#o2Info').hidden; $('#o2Info').hidden = !open; $('#o2').setAttribute('aria-expanded', open); if (open) renderO2(); };
addEventListener('pointerdown', e => { if (!$('#o2Info').hidden && !e.target.closest('#o2, #o2Info')) { $('#o2Info').hidden = true; $('#o2').setAttribute('aria-expanded', false); } });

/* ---------------- Hover labels: say what each icon or button is ---------------- */
// Uses the element's title (kept in data-tip so the browser's own slow tooltip doesn't show too), or
// for buttons that are only an icon or a symbol, their aria-label.
const tip = $('#tip');
function tipText(el) {
  if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }      // titles can change (dust, door side)
  if (el.dataset.tip) return el.dataset.tip;
  return el.textContent.trim().length <= 1 ? el.getAttribute('aria-label') : null;
}
addEventListener('pointerover', e => {
  const el = e.target.closest('button, .pill, [title], [data-tip]'), text = el && tipText(el);
  if (!text) { tip.hidden = true; return; }
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const below = r.bottom + 8 + h < innerHeight;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
});
addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('button, .pill, [data-tip]')) tip.hidden = true; });
addEventListener('pointerdown', () => { tip.hidden = true; });

/* ---------------- API (used by panel.js; also handy in the console) ---------------- */
window.marsGrid = {
  place, remove, turn, list, farmAt, cellAt, cellCenter, rotate, flyTo, refresh, call, toast,
  goTo: (lat, lon, altKm = 0.1) => { cam.lat = lat; cam.lon = lon; cam.alt = altKm; changed(); },
  state: () => ({ me, starters, tutorial, near: pixelPx() >= CONFIG.PLACE_MIN_PX, mine: me ? myFarms() : [] }),   // for the tutorial
  onInspect: fn => (inspectors.add(fn), () => inspectors.delete(fn)),   // a farm was clicked
  onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),      // farms were added or removed
};

/* ---------------- Start ---------------- */
addEventListener('resize', resize);
loadGround(); setMode('place'); renderClock(); renderCredit(); renderDoor();
resize(); refresh();
setInterval(refresh, 5000);
const baseImg = new Image();
baseImg.onload = () => { bundled = baseImg; uploadImage(texColorMap, TEX.colorMap, baseImg); buildGlobal(); };
baseImg.src = CONFIG.BASEMAP;
setInterval(renderClock, 15000);
(function frame() { if (dirty) { dirty = false; draw(); } requestAnimationFrame(frame); })();
})();
