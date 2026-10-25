// Farm simulation checks. Run: node test/sim.test.js
const assert = require('assert');
const Sim = require('../sim/farm-sim');
const Wx = require('../sim/weather');
const rems = require('../data/weather/rems_gale.json');

const SOL = 88775.244e3;                               // ms
const t0 = Date.parse('2026-10-25T12:00:00Z');
const prep = Wx.prepare(rems);
const gale = Wx.makeEnv(prep, { lat: -4.6, lon: 137.4 });
const constEnv = (o = {}) => () => ({ tOutC: -60, swWm2: 0, ltst: 0, sol: 0, label: 'test', ...o });
const clone = o => JSON.parse(JSON.stringify(o));
const farm = (o = {}) => Sim.createFarm({ t: t0, lat: -4.6, lon: 137.4, panels: [0.3], ...o });
const allDay = s => { s.settings.lightOn = 0; s.settings.lightOff = 23.99; return s; };
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const nonNegative = s => {
  for (const p of s.panels.filter(Boolean)) for (const k of ['X', 'N', 'dic', 'alk', 'DO']) assert(p[k] >= 0, `${k} = ${p[k]}`);
  for (const k of ['battery', 'tank']) assert(s[k] >= 0, `${k} = ${s[k]}`);
  assert(s.supplies.nano3 >= 0 && s.supplies.co2 >= 0);
};

test('culture volume and units', () => {
  assert.strictEqual(Sim.V, 0.5);                                   // one panel: 5 m2 x 0.1 m
  assert(Math.abs(Sim.SPECIES.o2Yield.v - 1.389 * 32 / 23.7) < 0.01);
  assert(Math.abs(Sim.fTemp(35) - 1) < 1e-9 && Sim.fTemp(15) === 0 && Sim.fTemp(44) === 0);
  // net growth at 35 C, 100 umol/m2/s, thin culture reproduces the measured 0.59 1/d (Chaiklahan 2007)
  const net = Sim.SPECIES.muMax.v * Sim.fLight(100, 1e-9) - Sim.SPECIES.respDark.v;
  assert(Math.abs(net - 0.59) < 0.01, `net ${net}`);
});

test('a new dome is empty and uses almost no power', () => {
  const s = Sim.createFarm({ t: t0 });
  assert(s.panels.every(p => p === null));
  Sim.advance(s, t0 + SOL, gale);
  assert.strictEqual(s.last.power.want, Sim.FARM.controls.v);
  assert.strictEqual(Sim.limiting(s).key, 'empty'); nonNegative(s);
});

test('same result whatever the update interval', () => {
  const a = farm(), b = clone(a);
  Sim.advance(a, t0 + 3 * SOL, gale);                                // one big catch-up
  let t = t0; while (t < t0 + 3 * SOL) { t += 7 * 60e3 + (t % 13) * 1e3; Sim.advance(b, Math.min(t, t0 + 3 * SOL), gale); }
  for (const k of ['t', 'Tw', 'Te', 'battery', 'tank']) assert.strictEqual(a[k], b[k], k);
  assert.deepStrictEqual(a.panels, b.panels);
});

test('starter loop: thin panel turns muddy, gives a starter, starts another panel', () => {
  const s = farm({ panels: [Sim.CULTURE.startX.v] });
  assert.strictEqual(Sim.stage(s.panels[0]), 'new');
  assert(!Sim.applyAction(s, { type: 'take-starter', panel: 0 }), 'too thin to take a starter');
  let sols = 0; while (Sim.stage(s.panels[0]) !== 'muddy' && sols < 40) Sim.advance(s, t0 + ++sols * SOL, gale);
  assert(sols > 5 && sols < 30, `muddy after ${sols} sols`);
  const X = s.panels[0].X;
  assert(Sim.applyAction(s, { type: 'take-starter', panel: 0 }));
  assert(Math.abs(s.panels[0].X - X * 0.9) < 1e-9, 'a starter is 10 % of the panel');
  assert(Sim.applyAction(s, { type: 'inoculate', panel: 1 }) && Sim.stage(s.panels[1]) === 'new');
  assert(!Sim.applyAction(s, { type: 'inoculate', panel: 1 }), 'cannot start a full panel');
  const before = s.totals.o2Collected; Sim.advance(s, s.t + 2 * SOL, gale);
  assert(s.last.panels[1] && s.totals.o2Collected > before); nonNegative(s);
});

test('darkness: no growth, biomass and O2 slowly fall', () => {
  const s = farm({ settings: { lightPct: 0 } }); s.Tw = 33;
  const X0 = s.panels[0].X; Sim.advance(s, t0 + 2 * SOL, constEnv({ tOutC: 30 }));
  assert(s.panels[0].X < X0 && s.panels[0].X > 0.005, `X ${X0} -> ${s.panels[0].X}`);
  assert(s.totals.o2Net < 0, 'respiration should consume O2');
  assert.strictEqual(Sim.limiting(s, 0).key, 'light'); nonNegative(s);
});

test('more light saturates: O2 does not grow without limit', () => {
  const Is = [50, 200, 800, 3200, 12800], rates = Is.map(I => Sim.SPECIES.muMax.v * Sim.fLight(I, 0.5));
  for (let i = 1; i < rates.length; i++) {
    assert(rates[i] >= rates[i - 1]);                                   // more light never hurts here...
    assert(rates[i] / Is[i] < rates[i - 1] / Is[i - 1]);                // ...but each extra photon does less
  }
  assert(rates.at(-1) < Sim.SPECIES.muMax.v, 'growth is capped by the species maximum');
});

test('nitrogen runs out, growth stops, dosing brings it back', () => {
  const env = constEnv({ tOutC: 30, swWm2: 0 });
  const s = allDay(farm({ settings: { lightPct: 100 } })); s.Tw = 33; s.panels[0].N = 0.002;
  Sim.advance(s, t0 + 2 * SOL, env);
  assert(s.panels[0].N < 0.001, `N ${s.panels[0].N}`); assert.strictEqual(Sim.limiting(s, 0).key, 'nitrogen');
  const X1 = s.panels[0].X; Sim.applyAction(s, { type: 'dose-nitrate', panel: 0 }, s.t); Sim.advance(s, s.t + 3 * SOL, env);
  assert(s.panels[0].X > X1, `dosed culture should grow: ${X1} -> ${s.panels[0].X}`); nonNegative(s);
});

test('power failure: lamps shed first, heater keeps running', () => {
  const s = allDay(farm({ settings: { lightPct: 100, tempTarget: 35 }, panels: [0.3, 0.3, 0.3, 0.3] }));
  s.battery = 0; const saved = Sim.FARM.grid.v; Sim.FARM.grid.v = 3000;
  try { Sim.advance(s, t0 + 3600e3, constEnv({ tOutC: -80 })); } finally { Sim.FARM.grid.v = saved; }
  const g = s.last.power.got;
  assert(s.last.power.short, 'should report a shortfall');
  assert(g.heater > 0 && g.lamps < Sim.FARM.lampMax.v * 4, JSON.stringify(g));
});

test('cold stress lowers health; recovery takes ~3 sols, not instant', () => {
  const s = farm({ settings: { tempTarget: 5 } });
  Sim.advance(s, t0 + 2 * SOL, gale);
  assert(s.panels[0].health < 0.5, `health ${s.panels[0].health}`);
  Sim.applyAction(s, { type: 'settings', settings: { tempTarget: 33 } }, s.t);
  const h0 = s.panels[0].health; Sim.advance(s, s.t + 0.5 * SOL, gale);
  assert(s.panels[0].health < 1 && s.panels[0].health >= h0, `partial recovery after half a sol: ${s.panels[0].health}`);
  Sim.advance(s, s.t + 4 * SOL, gale); assert(s.panels[0].health > 0.95, `recovered: ${s.panels[0].health}`);
  assert(s.events.some(e => e.kind === 'settings'), 'change logged for graphs');
});

test('freezing kills most of the culture', () => {
  const s = farm({ settings: { tempTarget: 10 } }); s.Tw = -2; s.Te = -40; s.battery = 0;
  const saved = Sim.FARM.grid.v; Sim.FARM.grid.v = 0;
  try { Sim.advance(s, t0 + 1 * SOL, constEnv({ tOutC: -90 })); } finally { Sim.FARM.grid.v = saved; }
  assert(s.panels[0].X < 0.05 && s.panels[0].health < 0.1, `X ${s.panels[0].X} health ${s.panels[0].health}`); nonNegative(s);
});

test('materials balance: nitrate used = biomass grown x N content', () => {
  const s = farm(); const N0 = s.panels[0].N;
  for (let i = 0; i < 2000; i++) Sim.step(s, gale, Sim.STEP_S);
  const usedN = N0 - s.panels[0].N; assert(usedN > 0);
  const o2PerN = s.totals.o2Gross / (usedN * Sim.V);                 // kg O2 per kg N
  const expect = Sim.SPECIES.o2Yield.v / Sim.SPECIES.nFrac.v;
  assert(Math.abs(o2PerN - expect) / expect < 0.01, `${o2PerN} vs ${expect}`);
  assert(s.totals.o2Collected <= s.totals.o2Net + 1e-9, 'cannot collect more O2 than produced');
});

test('missing check-ins does not destroy a healthy farm', () => {
  const s = farm();
  Sim.advance(s, t0 + 5 * SOL, gale);
  assert(s.panels[0].health > 0.9 && s.panels[0].X > 0.2, `X ${s.panels[0].X} health ${s.panels[0].health}`); nonNegative(s);
  assert(s.history.length > 100, 'history recorded while away');
});

test('pH: growth pushes pH up, automatic CO2 holds it near target', () => {
  const sp0 = Sim.speciate(0.2, 0.247); assert(Math.abs(sp0.pH - 9.5) < 0.05, `start pH ${sp0.pH}`);
  assert(Sim.speciate(0.15, 0.247).pH > sp0.pH && Sim.speciate(0.25, 0.247).pH < sp0.pH);
  const s = farm(); Sim.advance(s, t0 + 6 * SOL, gale);
  assert(Math.abs(s.last.panels[0].pH - 9.5) < 0.3, `pH ${s.last.panels[0].pH}`);
  const m = farm({ settings: { co2Mode: 'manual', co2Rate: 0 } }); Sim.advance(m, t0 + 6 * SOL, gale);
  assert(m.last.panels[0].pH > s.last.panels[0].pH, 'without CO2, growth drives pH up');
});

test('old single-culture saves become panel 1', () => {
  const old = { t: t0, lat: 0, lon: 0, settings: farm().settings, Tw: 30, Te: 25, X: 0.4, N: 0.3, dic: 0.2, alk: 0.25, DO: 7.5, health: 1,
                battery: 10, tank: 0, supplies: { nano3: 5, co2: 20 }, totals: { o2Gross: 0, o2Net: 0, o2Collected: 0, harvested: 0 }, last: null, history: [], events: [] };
  Sim.advance(old, t0 + 3600e3, gale);
  assert(old.panels[0].X > 0.39 && old.panels.slice(1).every(p => p === null) && old.X === undefined);
});

test('dust storms: same for everyone, dim the sun, narrow the day-night swing', () => {
  // find a storm over Gale crater in the next three Mars years
  let t = null; for (let d = 0; d < 669 * 3 && !t; d++) { const tt = t0 + d * SOL + 0.4 * SOL; if (Wx.tauAt(tt, -4.6, 137.4) > 1.5) t = tt; }
  assert(t, 'no storm found');
  assert.strictEqual(Wx.tauAt(t, -4.6, 137.4), Wx.tauAt(t, -4.6, 137.4), 'deterministic');
  const day = (tt, f) => { let v = []; for (let h = 0; h < 25; h++) v.push(f(tt - (tt % SOL) + h * SOL / 25)); return v; };
  const clearDay = Array.from({ length: 669 }, (_, d) => t0 + d * SOL).find(tt => day(tt, x => Wx.tauAt(x, -4.6, 137.4)).every(v => v < 0.61));
  const sun = tt => Math.max(...day(tt, x => gale(x).swWm2)), swing = tt => { const T = day(tt, x => gale(x).tOutC); return Math.max(...T) - Math.min(...T); };
  assert(sun(t) < sun(clearDay) * 0.9, `storm sun ${sun(t)} vs clear ${sun(clearDay)}`);
  assert(swing(t) < swing(clearDay), 'smaller temperature swing in a storm');
  Wx.addStorm({ start: t0, sols: 5, peak: 3, lat: -4.6, lon: 137.4, km: 2000 });
  assert(Wx.tauAt(t0 + SOL, -4.6, 137.4) > 3, 'a demo storm can be added');
});

test('weather: measured daily range at Gale and sensible sunlight', () => {
  const d = Wx.dailyAt(prep, Sim.marsClock(t0).ls);
  assert(d.min < -50 && d.max > -40 && d.max < 20, JSON.stringify(d));
  let maxSw = 0; for (let h = 0; h < 25; h++) maxSw = Math.max(maxSw, gale(t0 + h * 3600e3).swWm2);
  assert(maxSw > 300 && maxSw < 600, `peak sunlight ${maxSw}`);
});

console.log(`\n${passed} passed`);
