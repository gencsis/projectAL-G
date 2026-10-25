/* Farm panel: shows a farm's simulation (from the server) to anyone. The owner also gets the controls.
   Opened by the lab screen (lab.js); updates every 5 s while open. */
(() => {
'use strict';
const G = window.marsGrid, Sim = window.FarmSim;
const $ = s => document.querySelector(s);
let open = null, openInfo = null, current = null;   // key, map info and simulation state of the farm shown

const updated = new Set(), closed = new Set();
async function load(full) {
  const k = open;
  try { const d = await G.call('GET', `/api/farms/${k}`); if (k !== open) return; openInfo = d; current = d.state; render(full); updated.forEach(fn => fn(openInfo, current)); }
  catch (e) { if (k === open) close(); }
}
async function act(action) {
  try { const d = await G.call('POST', `/api/farms/${open}/action`, action); openInfo = d; current = d.state; render(); updated.forEach(fn => fn(openInfo, current)); G.refresh(); }
  catch (e) { G.toast(e.message); }
}

/* ---------------- Panel ---------------- */
const panel = document.createElement('aside');
panel.id = 'farmPanel'; panel.className = 'card'; panel.hidden = true;
panel.setAttribute('aria-label', 'Farm details');
document.body.appendChild(panel);

function openFarm(f) { open = f.key; openInfo = f; current = null; panel.hidden = false; panel.innerHTML = '<p class="sub">Loading…</p>'; load(true); }
function close() { if (!open) return; open = null; openInfo = current = null; panel.hidden = true; closed.forEach(fn => fn()); }
let closeButton = close;
window.farmPanel = {
  open: openFarm, close,
  onUpdate: fn => updated.add(fn),         // new data for the open farm: fn(info, state)
  onClosed: fn => closed.add(fn),
  setCloseButton: fn => { closeButton = fn; },
  redraw: () => render(),                  // after the panel becomes visible (charts need its size)
  showPanel: i => { sel = i; render(true); },   // which reactor panel the close-up is about
  act: a => act(a),
};

const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
function status(v, lo, hi, warn = 0) { return v < lo - warn || v > hi + warn ? 'bad' : v < lo || v > hi ? 'warn' : 'ok'; }
function row(label, value, unit, range, st) {
  return `<div class="rd ${st || ''}"><span>${label}</span><b>${value}<small> ${unit}</small></b><em>${range || ''}</em></div>`;
}

let chartSols = 3, sel = 0;                          // sel: which reactor panel is shown
const STAGE = {
  empty: ['Empty panel', 'No culture in this panel yet.'],
  new: ['Thin culture', 'Just started. It has to grow until the water turns muddy before you can take a starter from it.'],
  growing: ['Turning green', 'Growing. Once the water is muddy you can take a starter from it to fill another panel.'],
  muddy: ['Muddy: ready', 'Thick enough to take a starter. Use it to fill another panel, here or in another dome.'],
  dead: ['Died off', 'Too few cells are left to recover. Drain the panel and start it again with a starter.'],
};
// What the culture needs, in plain words (from the limiting factor)
const NEEDS = {
  temperature: s => s.Tw < 30 ? 'Too cold: raise the temperature.' : 'Too hot: lower the temperature.',
  light: s => s.last.tau > 1 ? 'Dust storm: little sunlight gets through. Turn up the lamps.' : s.last.I0 < 1 ? 'It is dark: the colony is resting until light returns.' : 'Light is the limit, which is normal as the water gets darker.',
  nitrogen: () => 'Running out of food (nitrate): dose nutrients under More.',
  carbon: () => 'Running out of CO₂ to feed on: the robot needs to bring more.',
  pH: () => 'The water chemistry is off: check CO₂ under More.',
  oxygen: () => 'Oxygen is building up in the water: turn mixing on under More.',
  health: () => 'Recovering from stress. Give it time.',
};
function render(full) {
  const s = current; if (!s || !s.last) return;
  const L = s.last, set = s.settings, sp = Sim.SPECIES, C = Sim.CULTURE;
  const p = s.panels[sel], PL = L.panels && L.panels[sel], stage = Sim.stage(p), lim = Sim.limiting(s, sel);
  const mine = openInfo.mine, starters = openInfo.starters || 0;
  const role = openInfo.role || (mine ? 'owner' : 'guest'), canCare = role === 'owner' || role === 'caretaker';
  if (full || !panel.querySelector('.controls')) {
    panel.innerHTML = `
      <header class="titlebar"><i class="appicon"></i><div><h2 id="fpTitle"></h2><div class="sub" id="fpOwner"></div></div><button id="fpClose" class="icon close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
      <div class="mon">
      <section class="tile"><div class="th">Culture Status</div><div id="fpStage" class="stage"></div></section>
      <section class="tile storm" id="fpStorm" hidden><div class="th">Dust Storm</div><div class="tb"><span id="stormText"></span>
        <label id="stormLamps">Lamps <output id="oLight2"></output><input id="cLight2" type="range" min="0" max="100" step="5"></label></div></section>
      <section class="big" id="fpBig"></section>
      <section class="tile tempTile"><div class="th">Water Temperature</div><canvas id="gTemp" height="170"></canvas>
        <label class="tempCtl">Heater set to <output id="oTemp"></output><input id="cTemp" type="range" min="10" max="40" step="0.5"></label>
        <div class="tf" id="tempStats"></div></section>
      <section class="tile lifeChart"><div class="th">Biomass · Since It Was Started</div><canvas id="chLife" height="130"></canvas><div class="tf" id="lifeStats"></div></section>
      <section class="tile micro"><div class="th">Microscope</div><canvas id="micro"></canvas>
        <div class="tf">Simulated from the model, not a camera: more filaments and murkier water as it grows.</div></section>
      <details id="fpMore" class="tile">
        <summary class="th">More Readings And Controls</summary>
        <section class="readings" id="fpPanelRead"></section>
        <section class="readings" id="fpRead"></section>
        <section class="controls">
          <label>Lamps <output id="oLight"></output><input id="cLight" type="range" min="0" max="100" step="5"></label>
          <div class="two"><label>Lamps on <input id="cOn" type="number" min="0" max="23.5" step="0.5"></label><label>off <input id="cOff" type="number" min="0" max="23.5" step="0.5"></label></div>
          <div class="two">
            <label class="chk"><input id="cMix" type="checkbox"> Mixing</label>
            <label>CO₂ <select id="cCo2Mode"><option value="auto">Auto (pH)</option><option value="manual">Manual</option></select></label>
          </div>
          <label id="lPh">pH target <output id="oPh"></output><input id="cPh" type="range" min="8.5" max="10.5" step="0.1"></label>
          <label id="lCo2" hidden>CO₂ rate per panel <output id="oCo2"></output><input id="cCo2" type="range" min="0" max="40" step="1"></label>
          <div class="two"><button id="bDose">Dose nitrate</button><button id="bHarvest">Harvest half</button></div>
          <div class="two"><button id="bDrain">Drain panel</button><button id="bTurn">Turn dome</button></div>
          <div class="sub" id="fpSupplies"></div>
        </section>
        <section class="charts">
          <div class="row between"><h3>Last sols</h3><div class="row"><button class="tiny" data-sols="1">1</button><button class="tiny" data-sols="3">3</button><button class="tiny" data-sols="7">7</button></div></div>
          <canvas id="chT" height="90"></canvas><canvas id="chX" height="80"></canvas><canvas id="chO" height="70"></canvas><canvas id="chP" height="70"></canvas>
          <div class="sub">Dashed lines mark your changes.</div>
        </section>
        <p class="sub" id="fpFoot"></p>
      </details>
      </div>`;
    $('#fpClose').onclick = () => closeButton();
    const send = settings => act({ type: 'settings', settings });
    $('#cLight').value = set.lightPct; $('#cOn').value = set.lightOn; $('#cOff').value = set.lightOff; $('#cTemp').value = set.tempTarget;
    $('#cMix').checked = set.mixing; $('#cCo2Mode').value = set.co2Mode; $('#cPh').value = set.phTarget; $('#cCo2').value = set.co2Rate;
    $('#cLight').oninput = e => $('#oLight').textContent = `${e.target.value}%`;
    $('#cLight').onchange = e => send({ lightPct: +e.target.value });
    $('#cLight2').value = set.lightPct;                 // the same lamp control, shown up front during a dust storm
    $('#cLight2').oninput = e => $('#oLight2').textContent = `${e.target.value}%`;
    $('#cLight2').onchange = e => send({ lightPct: +e.target.value });
    $('#cOn').onchange = e => send({ lightOn: +e.target.value }); $('#cOff').onchange = e => send({ lightOff: +e.target.value });
    $('#cTemp').oninput = e => $('#oTemp').textContent = `${e.target.value} °C`;
    $('#cTemp').onchange = e => send({ tempTarget: +e.target.value });
    $('#cMix').onchange = e => send({ mixing: e.target.checked });
    $('#cCo2Mode').onchange = e => send({ co2Mode: e.target.value });
    $('#cPh').oninput = e => $('#oPh').textContent = e.target.value; $('#cPh').onchange = e => send({ phTarget: +e.target.value });
    $('#cCo2').oninput = e => $('#oCo2').textContent = `${e.target.value} g/h`; $('#cCo2').onchange = e => send({ co2Rate: +e.target.value });
    $('#bDose').onclick = () => act({ type: 'dose-nitrate', panel: sel });
    $('#bHarvest').onclick = () => act({ type: 'harvest', panel: sel });
    $('#bDrain').onclick = () => act({ type: 'empty', panel: sel });
    $('#bTurn').onclick = () => act({ type: 'turn' });
    $('#fpMore').ontoggle = () => { if ($('#fpMore').open) drawCharts(current); };
    panel.querySelectorAll('[data-sols]').forEach(b => b.onclick = () => { chartSols = +b.dataset.sols; render(); });
    // owners and caretakers can change settings; harvesting, draining and turning the dome stay with the owner
    if (!canCare) panel.querySelectorAll('input, select, .controls button').forEach(el => el.disabled = true);
    if (!mine) ['#bHarvest', '#bDrain', '#bTurn'].forEach(id => { $(id).disabled = true; $(id).title = 'Owner only'; });
  }
  $('#oLight').textContent = `${set.lightPct}%`; $('#oTemp').textContent = `${set.tempTarget} °C`; $('#oPh').textContent = set.phTarget; $('#oCo2').textContent = `${set.co2Rate} g/h`;
  $('#lPh').hidden = set.co2Mode !== 'auto'; $('#lCo2').hidden = set.co2Mode !== 'manual';
  $('#fpTitle').textContent = `Vitals · Panel ${sel + 1}`;
  $('#fpOwner').textContent = mine ? 'Your dome' : role === 'caretaker' ? `${openInfo.owner}'s dome · you're a caretaker` : `${openInfo.owner}'s dome · view only`;
  // dust storm: how much sunlight is left (a typical sun height), with the lamps right there
  const sunLeft = tau => { const mu = 0.7, ex = Math.exp(-tau / mu); return ex + 0.6 * (1 - ex); };
  const storm = (L.tau || 0.6) > 1;
  $('#fpStorm').hidden = !storm;
  if (storm) { $('#stormText').textContent = `Sunlight is down to about ${Math.round(sunLeft(L.tau) / sunLeft(0.6) * 100)}% of a clear day, for the panels and the solar power.`; $('#oLight2').textContent = `${set.lightPct}%`; }
  $('#stormLamps').hidden = !canCare;

  // 1. how it's doing, in words
  const [name, text] = STAGE[stage];
  const need = p && (lim.stress || lim.key !== 'light') && NEEDS[lim.key] ? NEEDS[lim.key](s) : '';
  $('#fpStage').className = `stage ${stage}${lim.stress ? ' bad' : ''}`;
  $('#fpStage').innerHTML = `<b>${name}</b><span>${need || text}</span>` +
    (p ? `<div class="meter" title="${fmt(p.X, 2)} of ${C.muddyX.v} g/L"><i style="width:${Math.min(1, p.X / C.muddyX.v) * 100}%"></i></div><span class="sub">${Math.round(Math.min(1, p.X / C.muddyX.v) * 100)}% of the way to muddy</span>` : '');

  // 2. the three numbers that matter: oxygen made, CO2 taken in (negative = giving it off, the colony is shrinking), water temperature
  // CO2 from O2: 1 mol CO2 is fixed per C-mol of biomass, which releases 1.389 mol O2 (Cornet)
  const o2 = PL ? PL.o2Rate : 0, co2 = o2 / 32 / 1.389 * 44;
  const co2Word = !p ? '' : co2 > 0.05 ? 'taking in: growing' : co2 < -0.05 ? (L.I0 < 1 ? 'giving off: resting in the dark' : 'giving off: shrinking') : 'about even';
  const day = s.history.filter(h => h.t >= s.t - 88775244), o2s = stats(day.map(h => h.o2));
  $('#fpBig').innerHTML =
    big('Oxygen Made', p ? fmt(Math.max(0, o2), 1) : '—', 'g/h', o2 > 0 ? 'ok' : '', o2s ? `Dome, last sol · Min ${fmt(o2s.min)} · Avg ${fmt(o2s.avg)} · Max ${fmt(o2s.max)}` : 'Empty panel') +
    big('CO₂ Exchange', p ? fmt(Math.abs(co2), 1) : '—', 'g/h', co2 > 0.05 ? 'ok' : co2 < -0.05 && L.I0 >= 1 ? 'bad' : '', co2Word || 'Empty panel');
  const best = [sp.Topt.v - 5, sp.Topt.v + 2], ts = stats(day.map(h => h.Tw));
  gauge($('#gTemp'), s.Tw, set.tempTarget, best);
  $('#tempStats').textContent = ts ? `Last sol · Min ${fmt(ts.min)} · Avg ${fmt(ts.avg)} · Max ${fmt(ts.max)} °C · best ${best[0]}–${best[1]} °C` : `Best ${best[0]}–${best[1]} °C`;
  const life = p && p.life ? stats([...p.life.map(q => q.X), p.X]) : null;
  $('#lifeStats').textContent = life ? `Now ${fmt(p.X, 2)} g/L · Max ${fmt(life.max, 2)} · muddy at ${C.muddyX.v} g/L` : 'Not started yet';

  // 3. More: everything else
  $('#fpPanelRead').innerHTML = !p ? '' :
    row('Biomass', fmt(p.X, 2), 'g/L', `muddy at ${C.muddyX.v}`, p.X >= C.muddyX.v ? 'ok' : '') +
    row('Growth', fmt(PL && PL.mu, 2), '/day', PL && PL.mu > 0.005 ? `doubles in ${fmt(Math.LN2 / PL.mu, 1)} days` : '', '') +
    row('pH', fmt(PL && PL.pH, 2), '', sp.pHOk.v.join('–'), PL ? status(PL.pH, sp.pHOk.v[0], sp.pHOk.v[1], 0.5) : '') +
    row('Nitrate', fmt(p.N * 1000, 0), 'mg N/L', '> 50', status(p.N * 1000, 50, 1e9, 30)) +
    row('Dissolved O₂', fmt(p.DO, 1), 'mg/L', '< 15', status(p.DO, 0, 15, 5)) +
    row('Health', fmt(p.health * 100, 0), '%', '', status(p.health * 100, 90, 100, 40)) +
    row('Cell density', fmt(Microscope.perMl(p.X) / 1000, 0), 'k filaments/mL', 'estimate', '') +
    row('Water looks', Microscope.murk(p.X), '', '', '');
  const pw = L.power, o2perSol = L.o2CollectRate * 24.66 / 1000;
  $('#fpRead').innerHTML =
    row('Dome air', fmt(s.Te), '°C', '', '') +
    row('Outside', fmt(L.Tout), '°C', L.weatherLabel.startsWith('measured') ? 'Curiosity, measured' : 'estimated', '') +
    row('Light', fmt(L.I0, 0), 'µmol/m²/s', `sun ${fmt(L.sunPAR, 0)} · lamps ${fmt(L.lampPAR, 0)}`, '') +
    row('O₂ to the tank', fmt(L.o2CollectRate, 1), 'g/h', `≈ ${fmt(o2perSol * 1000, 0)} g/sol, whole dome`, '') +
    row('O₂ tank', fmt(s.tank, 2), 'kg', `of ${Sim.FARM.tankMax.v}`, '') +
    row('Power', fmt(pw.used / 1000, 2), 'kW', pw.short ? `short ${fmt((pw.want - pw.used) / 1000, 2)} kW` : `of ${fmt(pw.gen / 1000, 1)} + battery`, pw.short ? 'bad' : 'ok') +
    row('Battery', fmt(s.battery, 1), 'kWh', `of ${Sim.FARM.battery.v}`, status(s.battery, 5, 1e9, 4));
  $('#fpSupplies').textContent = `On site: ${fmt(s.supplies.nano3, 1)} kg nitrate · ${fmt(s.supplies.co2, 1)} kg CO₂ · harvested ${fmt(s.totals.harvested, 2)} kg biomass (not verified as food)`;
  $('#fpFoot').textContent = `Weather: ${L.weatherLabel} (sol ${L.sol}). Spirulina parameters from published experiments (sim/farm-sim.js). Simulated, not measured.`;
  if (canCare) $('#bDose').disabled = !p;
  if (mine) $('#bHarvest').disabled = $('#bDrain').disabled = !p;

  lifeChart($('#chLife'), p, s.t);
  Microscope.show($('#micro'), { id: `${open}/${sel}`, X: p ? p.X : 0, mu: PL ? PL.mu : 0, mixing: set.mixing });
  if ($('#fpMore').open) drawCharts(s);
}
function big(label, value, unit, st, note = '') {
  return `<div class="tile bg ${st || ''}"><div class="th">${label}</div><b>${value}<small> ${unit}</small></b><div class="tf">${note}</div></div>`;
}
const stats = v => { v = v.filter(x => x != null && isFinite(x)); return v.length ? { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length } : null; };

// A dial like an old system monitor: red and yellow at the ends, green where Spirulina is happy; ▲ = heater setting
function gauge(cv, v, target, [lo, hi]) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cssHeight(cv);
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const MIN = 10, MAX = 45, cx = W / 2, cy = H * 0.5, r = Math.min(W * 0.3, H * 0.34);
  const A0 = Math.PI * 0.8, A1 = Math.PI * 2.2, ang = t => A0 + (Math.max(MIN, Math.min(MAX, t)) - MIN) / (MAX - MIN) * (A1 - A0);
  const band = (a, b, c) => { x.strokeStyle = c; x.lineWidth = 9; x.beginPath(); x.arc(cx, cy, r, ang(a), ang(b)); x.stroke(); };
  band(MIN, lo - 5, '#d9534f'); band(lo - 5, lo, '#f0c419'); band(lo, hi, '#8fd36b'); band(hi, hi + 2, '#f0c419'); band(hi + 2, MAX, '#d9534f');
  x.fillStyle = '#2b3f63'; x.strokeStyle = '#2b3f63'; x.lineWidth = 1.5; x.font = '11px Tahoma, Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let t = MIN; t <= MAX; t += 5) {
    const a = ang(t), c = Math.cos(a), s = Math.sin(a);
    x.beginPath(); x.moveTo(cx + c * (r - 7), cy + s * (r - 7)); x.lineTo(cx + c * (r + 6), cy + s * (r + 6)); x.stroke();
    x.fillText(t, cx + c * (r + 18), cy + s * (r + 18));
  }
  const ta = ang(target); x.fillStyle = '#2f6fd6';                    // heater setting
  x.beginPath(); x.moveTo(cx + Math.cos(ta) * (r - 8), cy + Math.sin(ta) * (r - 8));
  x.lineTo(cx + Math.cos(ta - .07) * (r - 18), cy + Math.sin(ta - .07) * (r - 18)); x.lineTo(cx + Math.cos(ta + .07) * (r - 18), cy + Math.sin(ta + .07) * (r - 18)); x.fill();
  const a = ang(v); x.strokeStyle = '#2b3f63'; x.lineWidth = 3; x.lineCap = 'round';   // needle
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); x.stroke();
  x.fillStyle = '#5b6b85'; x.beginPath(); x.arc(cx, cy, 6, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#2b3f63'; x.font = 'bold 18px Tahoma, Verdana, sans-serif'; x.fillText(`${fmt(v, 1)} °C`, cx, H - 14);
}

/* ---------------- Charts ---------------- */
// A canvas's display height: its height attribute as first written. Drawing changes the attribute
// (sharp pixels on high-density screens), so remember the original or the chart grows every redraw.
const cssHeight = cv => +(cv.dataset.h ||= cv.getAttribute('height'));
// one line chart of history values `series` from time `from` to now
const CSS = n => getComputedStyle(panel).getPropertyValue(n).trim();   // the monitor's own colours
function chart(cv, s, series, unit, from) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cssHeight(cv);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const pts = s.history.filter(h => h.t >= from); if (pts.length < 2) { x.fillStyle = CSS('--muted'); x.font = '11px Tahoma, Verdana, sans-serif'; x.fillText('Collecting data…', 6, H / 2); return; }
  const t0 = from, t1 = s.t, L = 34, R = W - 4, T = 12, B = H - 4;
  const val = (se, p) => se.v ? se.v(p) : p[se.k];
  let lo = Infinity, hi = -Infinity; for (const se of series) for (const p of pts) { const v = val(se, p); if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = t => L + (t - t0) / (t1 - t0) * (R - L), Y = v => B - (v - lo) / (hi - lo) * (B - T);
  grid(x, L, R, T, B);
  x.strokeStyle = CSS('--line'); x.globalAlpha = .5; x.lineWidth = 1; x.beginPath();   // one line per sol
  for (let sol = 1; ; sol++) { const t = t1 - sol * 88775244; if (t < t0) break; x.moveTo(X(t) + .5, T); x.lineTo(X(t) + .5, B); } x.stroke(); x.globalAlpha = 1;
  if (lo < 0 && hi > 0) { x.setLineDash([2, 3]); x.strokeStyle = CSS('--muted'); x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(R, Y(0)); x.stroke(); x.setLineDash([]); }
  for (const ev of s.events) if (ev.t >= t0 && ev.kind !== 'created') {   // your changes
    x.setLineDash([3, 3]); x.strokeStyle = '#e0663a'; x.beginPath(); x.moveTo(X(ev.t) + .5, T); x.lineTo(X(ev.t) + .5, B); x.stroke(); x.setLineDash([]);
  }
  for (const se of series) {
    x.strokeStyle = se.c; x.lineWidth = se.w || 2; x.beginPath();
    let pen = false;                                 // gaps where a panel was empty
    for (const p of pts) { const v = val(se, p); if (v == null) { pen = false; continue; } pen ? x.lineTo(X(p.t), Y(v)) : x.moveTo(X(p.t), Y(v)); pen = true; }
    x.stroke();
  }
  x.fillStyle = CSS('--fg'); x.font = '11px Tahoma, Verdana, sans-serif';
  x.fillText(fmt(hi, Math.abs(hi) < 10 ? 2 : 0), 2, T + 8); x.fillText(fmt(lo, Math.abs(lo) < 10 ? 2 : 0), 2, B);
  let lx = L + 4; for (const se of series) { x.fillStyle = se.c; x.fillRect(lx, 2, 8, 8); x.fillStyle = CSS('--fg'); x.fillText(se.label, lx + 11, 10); lx += x.measureText(se.label).width + 24; }
  x.fillStyle = CSS('--muted'); x.textAlign = 'right'; x.fillText(unit, R, 10); x.textAlign = 'left';
}
// light grid lines, like an old monitoring program
function grid(x, L, R, T, B) {
  x.strokeStyle = '#dfe6f0'; x.lineWidth = 1; x.beginPath();
  for (let i = 0; i <= 4; i++) { const y = Math.round(T + (B - T) * i / 4) + .5; x.moveTo(L, y); x.lineTo(R, y); }
  for (let i = 0; i <= 8; i++) { const xx = Math.round(L + (R - L) * i / 8) + .5; x.moveTo(xx, T); x.lineTo(xx, B); }
  x.stroke();
}
// The panel's whole life: density since it was started, with the "muddy" line
function lifeChart(cv, p, now) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cssHeight(cv);
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  x.font = '11px Tahoma, Verdana, sans-serif'; x.fillStyle = CSS('--muted');
  if (!p || !p.life || !p.life.length) { x.fillText(p ? 'Collecting data…' : 'Not started yet.', 6, H / 2); return; }
  const SOL = 88775244, pts = [...p.life, { t: now, X: p.X }], t0 = pts[0].t, t1 = Math.max(now, t0 + SOL);
  const muddy = Sim.CULTURE.muddyX.v, hi = Math.max(muddy * 1.25, ...pts.map(q => q.X) ) * 1.05;
  const L = 30, R = W - 6, T = 8, B = H - 18;
  const X = t => L + (t - t0) / (t1 - t0) * (R - L), Y = v => B - v / hi * (B - T);
  grid(x, L, R, T, B);
  // muddy line
  x.strokeStyle = '#4c9a2a'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(L, Y(muddy)); x.lineTo(R, Y(muddy)); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#4c9a2a'; x.fillText('muddy', L + 4, Y(muddy) - 4);
  // the colony's growth, filled
  x.beginPath(); x.moveTo(X(pts[0].t), B); for (const q of pts) x.lineTo(X(q.t), Y(q.X)); x.lineTo(X(pts.at(-1).t), B); x.closePath();
  x.fillStyle = 'rgba(120, 160, 215, .35)'; x.fill();
  x.beginPath(); pts.forEach((q, i) => i ? x.lineTo(X(q.t), Y(q.X)) : x.moveTo(X(q.t), Y(q.X))); x.strokeStyle = '#2b3f63'; x.lineWidth = 1.5; x.stroke();
  x.fillStyle = '#2f6fd6'; x.beginPath(); x.arc(X(now), Y(p.X), 4, 0, Math.PI * 2); x.fill();   // now
  // axes: g/L on the left, sols since it started underneath
  x.fillStyle = CSS('--muted'); x.fillText(fmt(hi, 1), 2, T + 8); x.fillText('0', 2, B);
  x.fillText('started', L, H - 3); x.textAlign = 'right'; x.fillText(`now · ${fmt(Math.max(0, (now - t0) / SOL), 1)} sols`, R, H - 3); x.textAlign = 'left';
  x.save(); x.translate(10, (T + B) / 2 + 10); x.rotate(-Math.PI / 2); x.fillText('g/L', 0, 0); x.restore();
}
function drawCharts(s) {
  const from = s.t - chartSols * 88775244;
  chart($('#chT'), s, [{ k: 'Tw', c: '#e0663a', label: 'Culture' }, { k: 'Te', c: '#d6a24a', label: 'Dome' }, { k: 'Tout', c: '#4d7fd0', label: 'Outside' }], '°C', from);
  // biomass of each panel (older history has one number for panel 1); the panel shown is drawn thicker
  const xOf = i => h => Array.isArray(h.X) ? h.X[i] : i === 0 ? h.X : null;
  const colors = ['#8fc65a', '#5fb0d0', '#d6a24a', '#c88ae0'];
  chart($('#chX'), s, s.panels.map((_, i) => ({ v: xOf(i), c: colors[i], label: `P${i + 1}`, w: i === sel ? 3 : 1.5 }))
    .filter((se, i) => s.panels[i] || s.history.some(h => se.v(h) != null)), 'g/L', from);
  chart($('#chO'), s, [{ k: 'o2', c: '#1fb5a3', label: 'O₂ net' }, { k: 'o2c', c: '#2b3f63', label: 'Collected' }], 'g/h', from);
  chart($('#chP'), s, [{ k: 'pw', c: '#9d8ef0', label: 'Power used' }, { k: 'pwWant', c: '#dc5d89', label: 'Wanted' }], 'kW', from);
}

/* ---------------- Start ---------------- */
G.onChange(list => {
  if (!open) return;
  const f = list.find(x => x.key === open);
  if (!f) close();                                   // removed
  else if (f.mine !== openInfo.mine) load(true);     // logged in or out: show or hide the controls
});
setInterval(() => { if (open) load(false); }, 5000);
})();
