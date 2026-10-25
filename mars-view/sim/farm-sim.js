/* Spirulina farm simulation: one farm = one dome with up to four flat-panel reactors (PBRs).
 * A new dome starts empty; panels are filled with a starter culture one at a time.
 *
 * Works in the browser (window.FarmSim) and in Node (require('./farm-sim')).
 * A farm is a plain JSON object. advance() moves it forward in fixed 120 s steps, so the result is
 * the same whether it is updated every second or once a week.
 *
 * Every number is tagged:
 *   measured - from a cited experiment or recipe
 *   derived  - calculated from measured values (working in the comment)
 *   design   - our engineering choice
 *   gameplay - a game rule
 *   assumed  - a reasonable guess with no direct source
 *
 * Sources (full list in docs/SIMULATION.md):
 *   cornet     - Cornet & Dussap / Farges et al. 2009: biomass formula, O2 yield, light absorption, light half-saturation
 *   chaiklahan - Chaiklahan et al. 2007: growth 0.59 /day at 35 C and 100 umol/m2/s; damage above 43 C
 *   torzillo   - Torzillo et al. 1991: 5 % of biomass lost per night at 35 C
 *   zarrouk    - Zarrouk 1966: standard medium (NaNO3 2.5 g/L, NaHCO3 16.8 g/L), run at pH ~9.5
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FarmSim = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------------- Species: Arthrospira (Spirulina) platensis ----------------
const SPECIES = {
  name: 'Spirulina (Arthrospira platensis)',
  // 0.59 1/d measured at 35 C, 100 umol/m2/s (chaiklahan) is a net rate. Add back the dark
  // respiration below and divide by the light term 100/(100+90): (0.59 + 0.098) / 0.526 = 1.31 1/d.
  muMax: { v: 1.31, unit: '1/d', tag: 'derived', src: 'chaiklahan, cornet, torzillo' },
  lightK: { v: 90, unit: 'umol/m2/s', tag: 'measured', src: 'cornet' },
  Tmin: { v: 15, unit: 'C', tag: 'assumed', note: 'no direct measurement for our strain; cold-tolerant mutant strains grow below 10 C (Guan et al. 2017)' },
  Topt: { v: 35, unit: 'C', tag: 'measured', src: 'chaiklahan, torzillo' },
  Tmax: { v: 44, unit: 'C', tag: 'derived', src: 'chaiklahan: critical at 43 C, decline at 45 C' },
  // 5% of dry weight lost over a ~12 h night at 35 C (torzillo) -> 0.05 / 12.3 h * 24.66 h/sol ~ 0.098 1/d
  respDark: { v: 0.098, unit: '1/d', tag: 'derived', src: 'torzillo' },
  absorb: { v: 0.2, unit: 'm2/g', tag: 'measured', src: 'cornet (200-225 m2/kg)' },
  o2Yield: { v: 1.875, unit: 'g O2 / g biomass', tag: 'derived', src: 'cornet: 1.389 mol O2 x 32 g / 23.7 g' },
  nFrac: { v: 0.102, unit: 'g N / g biomass', tag: 'derived', src: 'cornet: 0.173 x 14 / 23.7' },
  cFrac: { v: 0.506, unit: 'g C / g biomass', tag: 'derived', src: 'cornet: 12 / 23.7' },
  kN: { v: 0.005, unit: 'g N/L', tag: 'assumed' },
  kC: { v: 0.005, unit: 'mol/L', tag: 'assumed' },
  pHOk: { v: [8.5, 10.5], unit: 'pH', tag: 'assumed', note: 'cultures are run at pH 9.5 (zarrouk); tolerance band assumed' },
  doInhibit: { v: 2, unit: 'x saturation', tag: 'assumed', note: 'high dissolved O2 reduces Spirulina photosynthesis (reported qualitatively); threshold assumed' },
};

// ---------------- Farm design ----------------
const FARM = {
  panels: { v: 4, unit: '', tag: 'design', note: 'flat-panel reactors per dome' },
  area: { v: 5, unit: 'm2', tag: 'design', note: 'lit area of one panel' },
  depth: { v: 0.10, unit: 'm', tag: 'design', note: 'light path through a panel' },   // -> 0.5 m3 per panel
  uaDome: { v: 25, unit: 'W/K', tag: 'design', note: 'insulated dome with regolith berm' },
  uaWater: { v: 75, unit: 'W/K', tag: 'design', note: 'one panel of water <-> dome air' },
  cEnclosure: { v: 2.0e6, unit: 'J/K', tag: 'design', note: 'dome air + structure' },
  window: { v: 20, unit: 'm2', tag: 'design', note: 'sun window over the panels' },
  windowT: { v: 0.6, unit: '', tag: 'design', note: 'window transmittance' },
  lampMax: { v: 625, unit: 'W', tag: 'design', note: 'LEDs per panel' },
  lampEff: { v: 2.8, unit: 'umol/J', tag: 'assumed', note: 'typical modern horticultural LED efficacy' },
  heaterMax: { v: 4000, unit: 'W', tag: 'design' },
  coolMax: { v: 5000, unit: 'W', tag: 'design', note: 'radiator; fan uses 100 W at full' },
  pump: { v: 150, unit: 'W', tag: 'design' }, controls: { v: 50, unit: 'W', tag: 'design' },
  panelArea: { v: 40, unit: 'm2', tag: 'design', note: 'solar panels outside' }, panelEff: { v: 0.22, unit: '', tag: 'assumed' },
  grid: { v: 2000, unit: 'W', tag: 'gameplay', note: 'constant share of a colony power plant' },
  battery: { v: 30, unit: 'kWh', tag: 'design' },
  kLaOn: { v: 8, unit: '1/h', tag: 'assumed', note: 'O2 stripping with mixing on' },
  kLaOff: { v: 0.3, unit: '1/h', tag: 'assumed' },
  collectEff: { v: 0.9, unit: '', tag: 'assumed', note: 'share of released O2 captured into the tank' },
  compressor: { v: 0.5, unit: 'kWh/kg O2', tag: 'assumed' },
  tankMax: { v: 50, unit: 'kg O2', tag: 'design' },
  parPerW: { v: 0.45 * 4.57, unit: 'umol/J', tag: 'assumed', note: 'sunlight: 45% PAR at 4.57 umol/J' },
};
// Starting and splitting cultures (gameplay rules built on common practice: Spirulina is usually
// started with about 10 % of the volume as dense culture, and moved on once it is thick)
const CULTURE = {
  starterShare: { v: 0.10, unit: '', tag: 'gameplay', note: 'a starter is 10 % of a panel: 50 L of culture' },
  startX: { v: 0.06, unit: 'g/L', tag: 'gameplay', note: 'a new panel: 50 L of muddy culture in 500 L, so a tenth of muddy' },
  muddyX: { v: 0.6, unit: 'g/L', tag: 'gameplay', note: 'thick and dark enough to take a starter from (about half to two thirds of what the lamps can sustain)' },
  deadX: { v: 0.02, unit: 'g/L', tag: 'gameplay', note: 'below this the culture has died off' },
};
const V = FARM.area.v * FARM.depth.v;                   // m3 of culture in one panel (0.5)
const CW = V * 1000 * 4186;                             // J/K thermal mass of one panel of water
const STEP_S = 120;                                     // fixed step
const DO_SAT = 7.5;                                     // mg/L O2 saturation at ~30 C in air (approx.)
const K1 = 10 ** -6.3, K2 = 10 ** -10.0, KW = 1e-14;    // carbonate equilibria (assumed for the saline medium)
const NANO3_N = 14 / 85;                                // g N per g NaNO3
const FRESH = { N: 2.5 * NANO3_N, dic: 0.2, alk: 0.247 };   // Zarrouk medium: 0.41 g N/L, 0.2 M bicarbonate, pH ~9.5

// ---------------- Mars time (Mars24 algorithm, Allison & McEwen 2000) ----------------
const D = Math.PI / 180, mod = (a, n) => ((a % n) + n) % n, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function marsClock(ms) {
  const jdTT = ms / 86400000 + 2440587.5 + 69.184 / 86400, d = jdTT - 2451545.0;
  const M = (19.3871 + 0.52402073 * d) * D, aFMS = 270.3871 + 0.524038496 * d;
  const A = [.0071,.0057,.0039,.0037,.0021,.0020,.0018], T = [2.2353,2.7543,1.1177,15.7866,2.1354,2.4694,32.8493], F = [49.409,168.173,191.837,21.736,15.704,95.528,49.095];
  let pbs = 0; for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(((0.985626 * d / T[i]) + F[i]) * D);
  const vM = (10.691 + 3e-7 * d) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.050 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
  const ls = mod(aFMS + vM, 360), eot = 2.861 * Math.sin(2 * ls * D) - 0.071 * Math.sin(4 * ls * D) + 0.002 * Math.sin(6 * ls * D) - vM;
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const my = 39 + Math.round((jdTT - 2461313.8527) / 686.9725 - ls / 360);   // Mars Year 39 began 2026-09-30
  return { ls, eot, mtc: mod(24 * msd, 24), my };
}
// local true solar time (hours) at an east longitude
const ltst = (c, lon) => mod(c.mtc + (c.eot + lon) / 15, 24);
// Sunlight on the ground (W/m2) from the sun's height and distance, with dust optical depth tau
function surfaceSun(c, lat, lon, tau = 0.6) {
  const r = 1.5236 * (1 - 0.0934 ** 2) / (1 + 0.0934 * Math.cos((c.ls - 251) * D));
  const dec = Math.asin(Math.sin(25.19 * D) * Math.sin(c.ls * D)), h = (ltst(c, lon) - 12) * 15 * D;
  const mu = Math.sin(lat * D) * Math.sin(dec) + Math.cos(lat * D) * Math.cos(dec) * Math.cos(h);
  if (mu <= 0) return 0;
  const ex = Math.exp(-tau / Math.max(mu, 0.03));
  return 1361 / (r * r) * mu * (ex + 0.6 * (1 - ex));
}

// ---------------- Biology helpers ----------------
// growth vs temperature: 0 at Tmin and Tmax, 1 at Topt (Rosso et al. 1993)
function fTemp(T, sp = SPECIES) {
  const Tn = sp.Tmin.v, To = sp.Topt.v, Tx = sp.Tmax.v;
  if (T <= Tn || T >= Tx) return 0;
  return ((T - Tx) * (T - Tn) ** 2) / ((To - Tn) * ((To - Tn) * (T - To) - (To - Tx) * (To + Tn - 2 * T)));
}
// growth vs light, averaged over the culture depth (the culture shades itself)
function fLight(I0, X, sp = SPECIES) {
  const K = sp.lightK.v, kL = sp.absorb.v * X * 1000 * FARM.depth.v;
  if (I0 <= 0) return 0;
  if (kL < 1e-6) return I0 / (I0 + K);
  return Math.log((I0 + K) / (I0 * Math.exp(-kL) + K)) / kL;
}
const meanLight = (I0, X) => { const kL = SPECIES.absorb.v * X * 1000 * FARM.depth.v; return kL < 1e-6 ? I0 : I0 * (1 - Math.exp(-kL)) / kL; };
// pH from dissolved carbon (mol/L) and alkalinity (eq/L). Growth removes carbon (pH rises),
// CO2 adds it (pH falls). Solved by bisection on Alk = HCO3- + 2 CO3-- + OH- - H+.
function speciate(dic, alk) {
  let lo = 4, hi = 13.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, H = 10 ** -mid, den = H * H + K1 * H + K1 * K2;
    const a = dic * (K1 * H + 2 * K1 * K2) / den + KW / H - H;
    if (a > alk) hi = mid; else lo = mid;
  }
  const pHv = (lo + hi) / 2, H = 10 ** -pHv, den = H * H + K1 * H + K1 * K2;
  return { pH: pHv, co2: dic * H * H / den, hco3: dic * K1 * H / den, co3: dic * K1 * K2 / den };
}
function fPH(p) { const [lo, hi] = SPECIES.pHOk.v; return p < lo ? clamp((p - (lo - 1)) / 1, 0, 1) : p > hi ? clamp(((hi + 1) - p) / 1, 0, 1) : 1; }

// ---------------- State ----------------
const DEFAULT_SETTINGS = { lightPct: 50, lightOn: 17, lightOff: 7, tempTarget: 32, mixing: true, co2Mode: 'auto', phTarget: 9.5, co2Rate: 2 };
// One panel of fresh medium with culture at density X (g/L)
const newPanel = (X = CULTURE.startX.v, t = 0) => ({ X, ...FRESH, DO: DO_SAT, health: 1, started: t, life: [{ t, X }] });
// panels: densities to start with, e.g. [0.3] for one filled panel; a new dome is empty
function createFarm({ t = Date.now(), lat = 0, lon = 0, settings = {}, panels = [] } = {}) {
  const tt = Math.floor(t / (STEP_S * 1000)) * STEP_S * 1000;
  return {
    t: tt, lat, lon,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    Tw: 30, Te: 25,                         // panel water and dome air, C (all panels share one water temperature)
    panels: Array.from({ length: FARM.panels.v }, (_, i) => panels[i] != null ? newPanel(panels[i], tt) : null),
    battery: FARM.battery.v * 0.5,          // kWh
    tank: 0,                                // kg O2 collected (usable)
    supplies: { nano3: 5, co2: 20 },        // kg on site (refilled later by the robot)
    totals: { o2Gross: 0, o2Net: 0, o2Collected: 0, harvested: 0 },
    last: null,                             // readings from the latest step
    history: [], events: [{ t: tt, kind: 'created', detail: 'Dome built' }],
  };
}
// Farms saved before panels existed had one culture: it becomes panel 1
function upgrade(s) {
  if (s.panels) return s;
  s.panels = [{ X: s.X, N: s.N, dic: s.dic, alk: s.alk, DO: s.DO, health: s.health, started: s.t }, null, null, null];
  for (const k of ['X', 'N', 'dic', 'alk', 'DO', 'health']) delete s[k];
  return s;
}
const activePanels = s => s.panels.map((p, i) => p ? i : -1).filter(i => i >= 0);

// ---------------- One step ----------------
function step(s, env, dt) {
  const set = s.settings, h = dt / 3600, d = dt / 86400;
  const e = env(s.t + dt * 500);                  // conditions at the middle of the step
  const Tout = e.tOutC, sw = e.swWm2;
  const active = activePanels(s), n = active.length;
  const lampsOn = n > 0 && inWindow(e.ltst, set.lightOn, set.lightOff) && set.lightPct > 0;

  // ---- power: generation, requests by priority, battery ----
  const gen = sw * FARM.panelArea.v * FARM.panelEff.v + FARM.grid.v;
  const req = {
    base: FARM.controls.v,
    pump: n && set.mixing ? FARM.pump.v : 0,
    heater: n ? clamp((set.tempTarget - s.Tw) * 1500, 0, FARM.heaterMax.v) : 0,
    lamps: lampsOn ? FARM.lampMax.v * n * set.lightPct / 100 : 0,
    fan: n && s.Tw > set.tempTarget + 1 ? 100 : 0,
  };
  const order = ['base', 'pump', 'heater', 'fan', 'lamps'];           // what keeps running longest
  let avail = gen + Math.max(0, s.battery) * 3.6e6 / dt;               // W available this step
  const got = {};
  for (const k of order) { got[k] = Math.min(req[k], Math.max(0, avail)); avail -= got[k]; }
  const used = order.reduce((a, k) => a + got[k], 0), want = order.reduce((a, k) => a + req[k], 0);
  s.battery = clamp(s.battery + (gen - used) * (gen > used ? 0.9 : 1) * dt / 3.6e6, 0, FARM.battery.v);
  const short = want - used > 1;

  // ---- heat: dome air, and the water in the filled panels ----
  const qSun = sw * FARM.window.v * FARM.windowT.v * 0.85, share = n / FARM.panels.v;   // filled panels catch their share of the sun
  const qLoss = FARM.uaDome.v * (s.Te - Tout);
  if (n) {
    const qCool = got.fan > 0 ? clamp((s.Tw - set.tempTarget - 1) * 2000, 0, FARM.coolMax.v) * (got.fan / 100) : 0;
    const qCouple = FARM.uaWater.v * n * (s.Te - s.Tw);
    s.Te += (qSun * (1 - share / 2) + 0.3 * got.lamps + 0.3 * got.heater + got.base + got.pump - qLoss - qCouple) * dt / FARM.cEnclosure.v;
    s.Tw += (qSun * share / 2 + 0.7 * got.lamps + 0.7 * got.heater + qCouple - qCool) * dt / (CW * n);
  } else {
    s.Te += (qSun + got.base - qLoss) * dt / FARM.cEnclosure.v;
    s.Tw = s.Te;                                  // no water yet
  }

  // ---- light on each panel ----
  const sunPAR = sw * FARM.parPerW.v * FARM.windowT.v;
  const lampPAR = n ? got.lamps / n * FARM.lampEff.v / FARM.area.v : 0;
  const I0 = sunPAR + lampPAR;

  // ---- each panel: growth, chemistry, oxygen, health ----
  const kill = s.Tw < 0.5 ? 2.0 : s.Tw > SPECIES.Tmax.v ? 1.5 * (s.Tw - SPECIES.Tmax.v + 1) : 0;   // freezing or overheating kills cells
  const r = SPECIES.respDark.v * clamp((s.Tw - 5) / 30, 0.05, 1.2);
  const kLa = (set.mixing && got.pump > 0 ? FARM.kLaOn.v : FARM.kLaOff.v) * h;
  const gBio = V * 1000;                                              // grams of biomass per (g/L) in one panel
  let o2G = 0, o2R = 0, released = 0;
  const lastPanels = s.panels.map(() => null);
  for (const i of active) {
    const p = s.panels[i];
    const sp = speciate(p.dic, p.alk), cUse = sp.hco3 + sp.co2;
    const f = {
      temperature: fTemp(s.Tw), light: fLight(I0, p.X),
      nitrogen: p.N / (p.N + SPECIES.kN.v), carbon: cUse / (cUse + SPECIES.kC.v),
      pH: fPH(sp.pH), oxygen: 1 / (1 + Math.max(0, p.DO / DO_SAT - SPECIES.doInhibit.v)), health: p.health,
    };
    const muG = SPECIES.muMax.v * f.temperature * f.light * Math.min(f.nitrogen, f.carbon) * f.pH * f.oxygen * f.health;
    const Xg = Math.min(muG * p.X * d, p.N / SPECIES.nFrac.v, p.dic * 12 / SPECIES.cFrac.v);   // g/L grown, capped by N and C
    const Xr = Math.min(r * p.X * d, p.X * 0.5), Xk = Math.min(kill * p.X * d, p.X * 0.5);
    p.X = Math.max(0.005, p.X + Xg - Xr - Xk);     // a few cells always survive
    const nUsed = Xg * SPECIES.nFrac.v;
    p.N = Math.max(0, p.N - nUsed);
    p.alk += nUsed / 14;                           // nitrate uptake releases OH- (1 eq per mol N)
    // carbon: growth removes it, respiration returns it, CO2 delivery adds it
    const co2Want = set.co2Mode === 'auto' ? clamp((sp.pH - set.phTarget) * 100, 0, 40) : set.co2Rate;   // g/h per panel
    const co2In = Math.min(co2Want * h, s.supplies.co2 * 1000);
    s.supplies.co2 = Math.max(0, s.supplies.co2 - co2In / 1000);
    p.dic = Math.max(0, p.dic - Xg * SPECIES.cFrac.v / 12 + Xr * SPECIES.cFrac.v / 12 + co2In / 44 / (V * 1000));
    // oxygen made, respired, and stripped out by mixing
    const g = Xg * gBio * SPECIES.o2Yield.v, rr = Xr * gBio * SPECIES.o2Yield.v;
    p.DO = Math.max(0, p.DO + (g - rr) / V);
    const out = Math.max(0, (p.DO - DO_SAT) * (1 - Math.exp(-kLa))) * V;
    p.DO -= out / V; o2G += g; o2R += rr; released += out;
    // health (gameplay): temperature extremes hurt fast (1/sol); starvation and bad pH slowly (0.3/sol); recovers over ~3 sols
    const dmg = (s.Tw < 10 || s.Tw > SPECIES.Tmax.v - 1) ? 1.0 : (f.pH < 0.5 || f.nitrogen < 0.2) ? 0.3 : 0;
    p.health = clamp(p.health + (dmg ? -dmg : 0.3) * d, 0, 1);
    lastPanels[i] = { pH: speciate(p.dic, p.alk).pH, f, mu: muG - r - kill, Iavg: meanLight(I0, p.X), o2Rate: (g - rr) / h, co2Rate: co2In / h };
  }
  const collected = Math.min(released * FARM.collectEff.v / 1000, Math.max(0, FARM.tankMax.v - s.tank));   // kg
  s.tank += collected;
  s.battery = Math.max(0, s.battery - collected * FARM.compressor.v);

  s.totals.o2Gross += o2G / 1000; s.totals.o2Net += (o2G - o2R) / 1000; s.totals.o2Collected += collected;
  s.t += dt * 1000;
  s.last = {
    t: s.t, Tout, ltst: e.ltst, sol: e.sol, weatherLabel: e.label, tau: e.tau ?? 0.6, sw, I0, sunPAR, lampPAR,
    o2Rate: (o2G - o2R) / h, o2CollectRate: collected * 1000 / h, power: { gen, used, want, short, got }, panels: lastPanels,
  };
}
const inWindow = (x, on, off) => on === off ? false : on < off ? x >= on && x < off : x >= on || x < off;

// Run the farm up to time tMs. A partial step is left for next time. Saves a history point every 30 min.
function advance(s, tMs, env, { maxSteps = 30 * 24 * 30 } = {}) {
  upgrade(s);
  let n = 0;
  const lastHist = s.history.length ? s.history[s.history.length - 1].t : 0;
  let nextHist = lastHist + 30 * 60 * 1000;
  while (s.t + STEP_S * 1000 <= tMs && n < maxSteps) {
    step(s, env, STEP_S); n++;
    if (s.t >= nextHist) { s.history.push(snapshot(s)); nextHist = s.t + 30 * 60 * 1000; }
    for (const p of s.panels) if (p) recordLife(p, s.t);
  }
  const keep = 7 * 49;                              // ~7 sols at 30 min
  if (s.history.length > keep) s.history.splice(0, s.history.length - keep);
  return n;
}
const r2 = (v, k = 100) => Math.round(v * k) / k;
// Each panel's whole life: its density every 6 h since it was started. Long lives are thinned to stay small.
const LIFE_EVERY = 6 * 3600e3, LIFE_MAX = 240;
function recordLife(p, t) {
  if (!p.life) p.life = [];
  const last = p.life[p.life.length - 1];
  if (last && t - last.t < LIFE_EVERY) return;
  p.life.push({ t, X: r2(p.X, 1000) });
  if (p.life.length > LIFE_MAX) p.life = p.life.filter((_, i) => i % 2 === 0 || i === p.life.length - 1);
}
function snapshot(s) {
  const L = s.last;
  return { t: s.t, Tw: r2(s.Tw, 10), Te: r2(s.Te, 10), Tout: r2(L.Tout, 10), X: s.panels.map(p => p ? r2(p.X, 1000) : null),
           o2: r2(L.o2Rate, 10), o2c: r2(L.o2CollectRate, 10), pw: r2(L.power.used / 1000), pwWant: r2(L.power.want / 1000) };
}

// ---------------- What is holding a panel back ----------------
const LIMIT_TEXT = {
  temperature: s => s.Tw < SPECIES.Topt.v ? `Water is cold (${s.Tw.toFixed(1)} °C); Spirulina grows best near ${SPECIES.Topt.v} °C.` : `Water is too hot (${s.Tw.toFixed(1)} °C); above ${SPECIES.Tmax.v - 1} °C cells are damaged.`,
  light: (s, p, L) => s.last.I0 < 1 ? 'Dark: no sun and lamps off, so the culture only respires.' : `Light: cells get ${Math.round(L.Iavg)} µmol/m²/s on average (the culture shades itself as it gets denser).`,
  nitrogen: (s, p) => `Nitrate is running out (${(p.N * 1000).toFixed(0)} mg N/L): dose nutrients.`,
  carbon: s => s.supplies.co2 <= 0 ? 'Out of CO₂ on site: the robot needs to bring more.' : 'Carbon (bicarbonate/CO₂) is running out: raise CO₂ delivery.',
  pH: (s, p, L) => `pH ${L.pH.toFixed(2)} is outside the comfortable range (${SPECIES.pHOk.v.join('–')}): ${L.pH > 9.5 ? 'add more CO₂' : 'add less CO₂'}.`,
  oxygen: () => 'Dissolved O₂ is building up and slowing photosynthesis: turn mixing on.',
  health: (s, p) => `Recovering from stress (health ${Math.round(p.health * 100)}%).`,
};
function stressCause(s, p, L) {
  if (s.Tw < 10 || s.Tw > SPECIES.Tmax.v - 1) return 'temperature';
  if (L && L.f.pH < 0.5) return 'pH';
  if (L && L.f.nitrogen < 0.2) return 'nitrogen';
  return null;
}
// For one panel (i), or for the whole dome (the panel doing worst) when i is left out
function limiting(s, i) {
  if (i == null) {
    const act = activePanels(s);
    if (!act.length) return { key: 'empty', text: 'No culture yet: fill a panel with a starter.' };
    const all = act.map(j => limiting(s, j));
    return all.find(l => l.stress) || all.reduce((a, b) => (b.value ?? 1) < (a.value ?? 1) ? b : a);
  }
  const p = s.panels[i], L = s.last && s.last.panels && s.last.panels[i];
  if (!p) return { key: 'empty', text: 'This panel is empty.' };
  if (!L) return { key: 'none', text: 'Starting up…' };
  const f = L.f, cause = stressCause(s, p, L);
  if (cause) return { key: cause, value: f[cause], text: LIMIT_TEXT[cause](s, p, L), stress: true };   // the thing to fix first
  const cand = ['temperature', 'light', 'nitrogen', 'carbon', 'pH', 'oxygen', 'health'];
  let key = cand[0]; for (const k of cand) if (f[k] < f[key]) key = k;
  return { key, value: f[key], text: LIMIT_TEXT[key](s, p, L) };
}
// A panel's stage: empty, dead, new (thin), growing, muddy (ready to take a starter)
function stage(p) {
  if (!p) return 'empty';
  if (p.X < CULTURE.deadX.v) return 'dead';
  if (p.X >= CULTURE.muddyX.v) return 'muddy';
  return p.X < 0.2 ? 'new' : 'growing';
}

// ---------------- Player actions (each is logged so the graphs can mark it) ----------------
function applyAction(s, a, tMs = s.t) {
  upgrade(s);
  const log = (kind, detail) => s.events.push({ t: tMs, kind, detail });
  const i = a.panel | 0, p = s.panels[i];
  switch (a.type) {
    case 'settings': {
      const old = s.settings, nw = { ...old, ...a.settings };
      nw.lightPct = clamp(+nw.lightPct, 0, 100); nw.tempTarget = clamp(+nw.tempTarget, 10, 40); nw.co2Rate = clamp(+nw.co2Rate, 0, 40);
      nw.phTarget = clamp(+nw.phTarget, 8, 11); nw.co2Mode = nw.co2Mode === 'manual' ? 'manual' : 'auto';
      nw.lightOn = mod(+nw.lightOn, 24); nw.lightOff = mod(+nw.lightOff, 24); nw.mixing = !!nw.mixing;
      const changed = Object.keys(nw).filter(k => nw[k] !== old[k]);
      s.settings = nw; if (changed.length) log('settings', changed.map(k => `${k}: ${old[k]} → ${nw[k]}`).join(', '));
      return true;
    }
    case 'inoculate': {                           // fill an empty panel: a starter plus fresh medium
      if (p || i < 0 || i >= FARM.panels.v) return false;
      s.panels[i] = newPanel(CULTURE.startX.v, tMs);
      if (activePanels(s).length === 1) s.Tw = s.Te + 5;   // first water in the dome: warmed before it goes in
      log('inoculate', `Panel ${i + 1} started with a starter culture`); return true;
    }
    case 'take-starter': {                        // take 10 % of a muddy panel and top it up with fresh medium
      if (!p || p.X < CULTURE.muddyX.v) return false;
      const k = CULTURE.starterShare.v;
      p.X *= 1 - k; for (const f of ['N', 'dic', 'alk']) p[f] = p[f] * (1 - k) + FRESH[f] * k;
      log('starter', `Starter taken from panel ${i + 1}`); return true;
    }
    case 'empty': {                               // drain a panel so it can be started again
      if (!p) return false;
      s.panels[i] = null; log('empty', `Panel ${i + 1} drained`); return true;
    }
    case 'dose-nitrate': {                        // kg NaNO3 from on-site supply, into one panel
      const kg = clamp(a.kg ?? 0.25, 0, s.supplies.nano3); if (!p || kg <= 0) return false;
      s.supplies.nano3 -= kg; p.N += kg * 1000 * NANO3_N / (V * 1000);
      log('dose', `${kg} kg NaNO3 into panel ${i + 1}`); return true;
    }
    case 'harvest': {                             // take half the biomass; tracked as harvested (not verified food)
      if (!p) return false;
      const take = p.X * 0.5; if (take < 0.05) return false;
      p.X -= take; s.totals.harvested += take * V;       // kg dry biomass (g/L x m3 = kg)
      log('harvest', `${(take * V).toFixed(2)} kg dry biomass from panel ${i + 1}`); return true;
    }
  }
  return false;
}

return { SPECIES, FARM, CULTURE, STEP_S, V, marsClock, ltst, surfaceSun, fTemp, fLight, speciate,
         createFarm, upgrade, advance, step, applyAction, limiting, stage };
}));
