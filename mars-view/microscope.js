/* Simulated microscopy of a Spirulina culture, drawn from the farm simulation (not a camera image).
   - Shape: Spirulina grows as blue-green filaments (trichomes) coiled into an open helix.
   - How many filaments are in view comes from the simulated biomass (g/L), and so does how murky the
     water looks: the denser the culture, the greener and darker the background ("muddy").
   - How fast they lengthen and break in two comes from the simulated growth rate. Spirulina multiplies by
     filaments growing and breaking into pieces.
   - Shown as a time-lapse: 1 second on screen = 4 hours in the culture.
   Sizes below are typical published ranges for Arthrospira platensis (Vonshak 1997); the mass of one
   filament is our assumption, so the count is an estimate. */
(() => {
'use strict';
const VIEW_W = 300, VIEW_H = 225, DEPTH = 1000;     // field of view and chamber depth, µm (a 1 mm-deep counting chamber)
const WIDTH = 8, COIL_R = 20, PITCH = 50;            // filament width, helix radius and pitch, µm
const BREAK_AT = 360;                                // a filament this long (along its axis, µm) breaks in two
const AXIAL_MEAN = 230;                              // average filament length along its axis, µm (assumed)
const DRY_FRACTION = 0.2, CELL_DENSITY = 1.05;       // dry mass share of wet cells, wet density g/cm³ (assumed)
const HOURS_PER_SECOND = 4;                          // time-lapse speed

// Average dry mass of one filament (g): its coiled length x cross-section x density x dry share
const coil = Math.hypot(1, 2 * Math.PI * COIL_R / PITCH);               // coiled length per µm of axis
const FILAMENT_G = AXIAL_MEAN * coil * Math.PI * (WIDTH / 2) ** 2 * 1e-12 * CELL_DENSITY * DRY_FRACTION;
const VIEW_ML = VIEW_W * VIEW_H * DEPTH * 1e-12;                         // volume in view, mL
// Filaments per mL for a biomass in g/L
const perMl = X => X / 1000 / FILAMENT_G;
// How murky the water looks (0 clear .. 1 dark), and a word for it
const MUDDY = window.FarmSim.CULTURE.muddyX.v;
const murkiness = X => 1 - Math.exp(-X / (MUDDY * 0.8));
const murk = X => X <= 0 ? 'no culture' : X < MUDDY * 0.15 ? 'clear' : X < MUDDY * 0.5 ? 'pale green' : X < MUDDY ? 'green' : 'muddy';
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

let cv = null, ctx = null, state = null, items = [], last = 0, running = false;
const rand = (a, b) => a + Math.random() * (b - a);
function spawn() {
  const len = rand(120, 320), a = rand(0, Math.PI), x = rand(0, VIEW_W), y = rand(0, VIEW_H);
  return { x, y, a, len, phase: rand(0, PITCH), vx: rand(-3, 3), vy: rand(-3, 3), va: rand(-.02, .02), shade: rand(.85, 1.1) };
}
const target = () => state ? perMl(state.X) * VIEW_ML : 0;

// Draw one filament: a helix seen from the side looks like a wave; darker edges, faint cross-walls
function drawFilament(f, k) {
  const pts = [], n = Math.ceil(f.len / 2), c = Math.cos(f.a), s = Math.sin(f.a);
  for (let i = 0; i <= n; i++) {
    const u = -f.len / 2 + i * f.len / n, w = COIL_R * Math.sin(2 * Math.PI * (u + f.phase) / PITCH);
    pts.push([(f.x + u * c - w * s) * k, (f.y + u * s + w * c) * k]);
  }
  const path = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = `rgba(20, 70, 55, ${0.9 * f.shade})`; ctx.lineWidth = WIDTH * k + 2; ctx.stroke();
  path(); ctx.strokeStyle = `rgb(${70 * f.shade | 0}, ${150 * f.shade | 0}, ${115 * f.shade | 0})`; ctx.lineWidth = WIDTH * k - 1.5; ctx.stroke();
  path(); ctx.strokeStyle = 'rgba(210, 255, 225, .25)'; ctx.lineWidth = WIDTH * k * .3; ctx.stroke();
  if (k > 1) {                                       // cross-walls between cells, every ~4 µm of filament
    ctx.strokeStyle = 'rgba(15, 55, 40, .35)'; ctx.lineWidth = 1;
    for (let i = 2; i < pts.length - 2; i += 2) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, h = WIDTH * k / 2 - 1;
      ctx.beginPath(); ctx.moveTo(pts[i][0] - dy / l * h, pts[i][1] + dx / l * h); ctx.lineTo(pts[i][0] + dy / l * h, pts[i][1] - dx / l * h); ctx.stroke();
    }
  }
}

function frame(now) {
  if (!running) return;
  if (!cv.isConnected || cv.offsetParent === null) { running = false; return; }   // panel closed
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  const hours = dt * HOURS_PER_SECOND;
  const mu = state ? state.mu : 0, mixing = state && state.mixing ? 1 : 0.25;
  const grow = Math.exp(Math.max(0, mu) / 24 * hours);   // filaments only lengthen while the culture grows
  // move, grow and break
  const out = [];
  for (const f of items) {
    f.x += f.vx * mixing * dt * 6; f.y += f.vy * mixing * dt * 6; f.a += f.va * mixing * dt; f.len *= grow;
    if (f.len > BREAK_AT) {
      const cut = rand(.35, .65), a = { ...f, len: f.len * cut }, b = { ...f, len: f.len * (1 - cut) };
      const c = Math.cos(f.a), s = Math.sin(f.a), off = f.len / 2;
      a.x -= c * (off - a.len / 2 + 2); a.y -= s * (off - a.len / 2 + 2); b.x += c * (off - b.len / 2 + 2); b.y += s * (off - b.len / 2 + 2);
      b.vx = -f.vx; b.vy = -f.vy; a.va = rand(-.02, .02); b.va = rand(-.02, .02);
      out.push(a, b);
    } else out.push(f);
  }
  // keep the simulated density: filaments wrap around the edges, new ones fade in, extras fade out
  const m = 120;
  for (const f of out) { f.x = (f.x + m) % (VIEW_W + 2 * m) - m; if (f.x < -m) f.x += VIEW_W + 2 * m; f.y = (f.y + m) % (VIEW_H + 2 * m) - m; if (f.y < -m) f.y += VIEW_H + 2 * m; }
  items = out;
  const want = Math.round(target()), alive = items.filter(f => !f.going);
  if (alive.length < want) items.push({ ...spawn(), fade: 0 });
  if (alive.length > want) alive[0].going = true;
  for (const f of items) f.fade = f.going ? (f.fade ?? 1) - dt : Math.min(1, (f.fade ?? 1) + dt);
  items = items.filter(f => f.fade > 0);

  // draw: background (clear to muddy with density), filaments, scale bar
  const k = cv.width / VIEW_W, t = murkiness(state ? state.X : 0);
  const g = ctx.createRadialGradient(cv.width / 2, cv.height / 2, 10, cv.width / 2, cv.height / 2, cv.width * .7);
  g.addColorStop(0, `rgb(${mix([244, 246, 234], [128, 150, 88], t)})`); g.addColorStop(1, `rgb(${mix([201, 207, 184], [78, 96, 52], t)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const f of items) { ctx.globalAlpha = f.fade ?? 1; drawFilament(f, k); } ctx.globalAlpha = 1;
  const bar = 50 * k, dpr = cv.width / cv.clientWidth;
  ctx.fillStyle = t > 0.5 ? '#f2ece4' : '#222'; ctx.fillRect(cv.width - bar - 12 * dpr, cv.height - 12 * dpr, bar, 3 * dpr);
  ctx.font = `${12 * dpr}px "Instrument Serif", serif`; ctx.textAlign = 'center'; ctx.fillText('50 µm', cv.width - bar / 2 - 12 * dpr, cv.height - 18 * dpr);
  ctx.textAlign = 'left'; ctx.fillText(`Time-lapse · 1 s = ${HOURS_PER_SECOND} h`, 8 * dpr, cv.height - 10 * dpr);
  requestAnimationFrame(frame);
}

window.Microscope = {
  perMl, murk,
  // Show a culture on this canvas: s = { id, X (g/L), mu (net growth /day), mixing }. Call again with new numbers.
  show(canvas, s) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas !== cv || !state || s.id !== state.id) {   // another canvas or another panel: start a fresh view
      cv = canvas; ctx = cv.getContext('2d');
      state = s; items = [];
      for (let i = 0, n = Math.round(target()); i < n; i++) items.push(spawn());
    }
    if (cv.clientWidth && cv.width !== Math.round(cv.clientWidth * dpr)) {   // size it once it is on screen
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientWidth * VIEW_H / VIEW_W * dpr);
      cv.style.height = `${cv.clientWidth * VIEW_H / VIEW_W}px`;
    }
    state = s;
    if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
  },
};
})();
