/* Outside conditions for a farm, from Curiosity's REMS weather record (data/weather/rems_gale.json).
 *
 * - Daily low and high: the recorded sols at the same season (Ls), interpolated. Flagged readings are skipped.
 * - Through the day: a smooth curve from the low at sunrise to the high at 14:00 local time.
 * - Away from Gale crater the same record is used and labelled "estimated".
 * - Sunlight: calculated from the sun's position with dust optical depth 0.6 on a clear day.
 * - Dust storms (modelled): mostly regional, mostly in southern spring and summer (Ls 180-360), with a
 *   rare planet-wide storm. They raise the dust optical depth, which dims sunlight and narrows the gap
 *   between day and night temperatures. Storms come from a fixed pseudo-random pattern of Mars sols, so
 *   every player and every update sees the same storms.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./farm-sim'));
  else root.FarmWeather = factory(root.FarmSim);
}(typeof self !== 'undefined' ? self : this, function (Sim) {
'use strict';
const D = Math.PI / 180, mod = (a, n) => ((a % n) + n) % n;

// Turn the REMS file into a table of daily low/high by Ls (sols at the same Ls are averaged)
function prepare(rems) {
  const byLs = new Map();
  for (const s of rems.sols) {
    if (s.ls == null || s.airMin == null || s.airMax == null || s.flags.includes('air_min_outlier') || s.flags.includes('air_max_outlier')) continue;
    const g = byLs.get(s.ls) || { ls: s.ls, min: 0, max: 0, n: 0, sol: s.sol };
    g.min += s.airMin; g.max += s.airMax; g.n++; byLs.set(s.ls, g);
  }
  return [...byLs.values()].map(g => ({ ls: g.ls, min: g.min / g.n, max: g.max / g.n, sol: g.sol })).sort((a, b) => a.ls - b.ls);
}

// Daily low and high (°C) at a season, interpolated between the nearest recorded Ls values
function dailyAt(table, ls) {
  const n = table.length;
  let i = table.findIndex(r => r.ls > ls); if (i === -1) i = 0;
  const a = table[mod(i - 1, n)], b = table[i];
  const f = mod(ls - a.ls, 360) / (mod(b.ls - a.ls, 360) || 1);
  return { min: a.min + (b.min - a.min) * f, max: a.max + (b.max - a.max) * f, sol: a.sol };
}

// Local solar time of sunrise (null during polar night)
function sunriseLtst(lat, ls) {
  const dec = Math.asin(Math.sin(25.19 * D) * Math.sin(ls * D)), x = -Math.tan(lat * D) * Math.tan(dec);
  if (x >= 1) return null;
  if (x <= -1) return 0;
  return 12 - Math.acos(x) / D / 15;
}

// ---------------- Dust storms (modelled; gameplay rates) ----------------
// Clear-day dust optical depth 0.6. Regional storms reach about 1.2-3.5; planet-wide storms 4-6 (the
// 2018 global storm passed 10 at Opportunity's site, so this is on the mild side).
const CLEAR_TAU = 0.6, SOL_MS = 88775244, LOOKBACK = 70;
const hash = n => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const rnd = (n, k) => hash(n * 7919 + k * 104729 + 17);
const stormCache = new Map();
// The storm that starts on sol n, or null
function stormOn(n) {
  if (stormCache.has(n)) return stormCache.get(n);
  const ls = Sim.marsClock(n * SOL_MS).ls, season = ls >= 180;             // southern spring and summer
  let st = null;
  if (rnd(n, 0) < (season ? 0.08 : 0.015)) {
    const global = rnd(n, 1) < 0.03;
    st = {
      start: n * SOL_MS, global,
      sols: global ? 35 + rnd(n, 2) * 30 : 3 + rnd(n, 2) * 9,
      peak: global ? 4 + rnd(n, 3) * 2 : 1.2 + rnd(n, 3) * 2.3,
      lat: -55 + rnd(n, 4) * 80, lon: -180 + rnd(n, 5) * 360,              // most begin in the south
      km: global ? 1e5 : 1500 + rnd(n, 6) * 2000,                          // radius of the dusty area
    };
  }
  stormCache.set(n, st); if (stormCache.size > 5000) stormCache.clear();
  return st;
}
// Extra storms added by the server (for demos): { start, sols, peak, lat, lon, km }
const extra = [];
const addStorm = st => extra.push({ global: false, ...st });
// Storms going on at time tMs, each with its current strength (extra optical depth at its centre)
function stormsAt(tMs) {
  const now = Math.floor(tMs / SOL_MS), out = [];
  for (const st of extra) { const age = (tMs - st.start) / SOL_MS; if (age >= 0 && age <= st.sols) out.push({ ...st, tau: st.peak * Math.min(1, age * 4) * (age < st.sols * 0.6 ? 1 : Math.max(0, 1 - (age - st.sols * 0.6) / (st.sols * 0.4))) }); }
  for (let n = now - LOOKBACK; n <= now; n++) {
    const st = stormOn(n); if (!st) continue;
    const age = (tMs - st.start) / SOL_MS; if (age < 0 || age > st.sols) continue;
    const grow = Math.min(1, age), fade = age < st.sols * 0.4 ? 1 : Math.max(0, 1 - (age - st.sols * 0.4) / (st.sols * 0.6));
    out.push({ ...st, tau: st.peak * grow * fade });
  }
  return out;
}
const distKm = (a, b, c, d) => { const p = Math.sin(a * D) * Math.sin(c * D) + Math.cos(a * D) * Math.cos(c * D) * Math.cos((b - d) * D); return Math.acos(Math.max(-1, Math.min(1, p))) * 3389.5; };
// Dust optical depth at a place and time
function tauAt(tMs, lat, lon) {
  let tau = CLEAR_TAU;
  for (const st of stormsAt(tMs)) { const f = st.global ? 1 : 1 - (distKm(lat, lon, st.lat, st.lon) / st.km) ** 2; if (f > 0) tau += st.tau * f; }
  return tau;
}

// env(tMs) -> outside temperature, sunlight, dust and labels for one farm
function makeEnv(table, { lat, lon, estimated = false }) {
  return function env(tMs) {
    const c = Sim.marsClock(tMs), x = Sim.ltst(c, lon), day = dailyAt(table, c.ls);
    const tR = sunriseLtst(lat, c.ls) ?? 6, tP = 14;
    let T;
    if (x >= tR && x <= tP) T = day.min + (day.max - day.min) * (1 - Math.cos(Math.PI * (x - tR) / (tP - tR))) / 2;
    else { const u = mod(x - tP, 24) / mod(tR - tP, 24); T = day.min + (day.max - day.min) * (1 + Math.cos(Math.PI * u)) / 2; }
    // dust keeps days cooler and nights warmer: shrink the swing around the daily mean
    const tau = tauAt(tMs, lat, lon), mean = (day.min + day.max) / 2;
    T = mean + (T - mean) / (1 + 0.35 * (tau - CLEAR_TAU));
    return {
      tOutC: T, swWm2: Sim.surfaceSun(c, lat, lon, tau), tau, ltst: x, sol: day.sol,
      label: estimated ? 'estimated: Gale crater record used for this location' : 'measured: Curiosity REMS, Gale crater',
    };
  };
}
return { prepare, makeEnv, dailyAt, stormsAt, tauAt, addStorm, CLEAR_TAU };
}));
