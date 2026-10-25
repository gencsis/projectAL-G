/* The lab inside a dome. Clicking a dome on the map opens it.
   - Room view: four flat-panel reactors. Hovering one makes it glow; clicking it opens the close-up.
   - Close-up view: one panel fills the screen. Readings, controls, microscope and graphs slide in from
     the side (the info button); the one thing to do next, if any, is a single button at the bottom.
   - Each panel shows green while it holds a living culture and clear when it is empty (or has died off).
     A new dome starts empty: fill panels with starter cultures, one at a time.
   The art is 3:2. On wide screens (16:9 and wider) it fills the screen, trimming a little off the top
   and bottom; on narrower screens it fits the width and a blurred copy of the room fills the rest. */
(() => {
'use strict';
const G = window.marsGrid, P = window.farmPanel, $ = s => document.querySelector(s);
const ART_W = 422, ART_H = 281;              // the art's shape and the grid the panel positions below use (any size, same 3:2 shape)
const PANELS = 4, FRONT_TO_BACK = [0, 1, 2, 3];   // panel 1 is nearest, so it wins when panels overlap
const TAG_AT = [[82, 150], [186, 150], [264, 140], [361, 132]];   // where each panel's dot sits in the art (on the lower glass), px

const lab = $('#lab'), scene = $('#labScene'), closeup = $('#labCloseup');
let farm = null, stages = ['empty', 'empty', 'empty', 'empty'], density = [0, 0, 0, 0], hover = -1, chosen = -1;
const green = i => stages[i] !== 'empty' && stages[i] !== 'dead';
const STAGE_TAG = { empty: 'Empty', new: 'Thin', growing: 'Turning green', muddy: 'Muddy: ready', dead: 'Died off' };
// a dot on each panel for its stage; the words show only while the pointer is over it
const tags = TAG_AT.map(([x, y]) => {
  const t = document.createElement('div'); t.className = 'panelTag';
  t.style.left = `${x / ART_W * 100}%`; t.style.top = `${y / ART_H * 100}%`;
  scene.appendChild(t); return t;
});

// Images: room, and for each panel: clear, clear + glow, green, green + glow
const img = src => { const i = new Image(); i.src = src; i.className = 'layer'; i.alt = ''; i.draggable = false; return i; };
const layers = [];
for (let n = 1; n <= PANELS; n++) {
  const L = { empty: img(`assets/lab/panel-${n}-empty.png`), emptyGlow: img(`assets/lab/panel-${n}-empty-glow.png`),
              green: img(`assets/lab/panel-${n}-green.png`), greenGlow: img(`assets/lab/panel-${n}-green-glow.png`) };
  Object.values(L).forEach(i => scene.appendChild(i));
  layers.push(L);
}
// Which panel is under a point: test the panel pictures' own pixels, nearest panel first
const hitCv = document.createElement('canvas'); hitCv.width = ART_W; hitCv.height = ART_H;
const hitCtx = hitCv.getContext('2d', { willReadFrequently: true });
let hitMaps = null;
function buildHitMaps() {
  hitMaps = layers.map(L => {
    const i = L.emptyGlow; if (!i.complete || !i.naturalWidth) return null;
    hitCtx.clearRect(0, 0, ART_W, ART_H); hitCtx.drawImage(i, 0, 0, ART_W, ART_H);
    return hitCtx.getImageData(0, 0, ART_W, ART_H).data;
  });
}
function panelAt(clientX, clientY) {
  if (!hitMaps || hitMaps.includes(null)) buildHitMaps();
  const r = scene.getBoundingClientRect(), x = Math.floor((clientX - r.left) / r.width * ART_W), y = Math.floor((clientY - r.top) / r.height * ART_H);
  if (x < 0 || y < 0 || x >= ART_W || y >= ART_H) return -1;
  for (const i of FRONT_TO_BACK) if (hitMaps[i] && hitMaps[i][(y * ART_W + x) * 4 + 3] > 40) return i;
  return -1;
}

// Show the right picture for each panel
function show() {
  layers.forEach((L, i) => {
    const want = i === hover ? (green(i) ? L.greenGlow : L.emptyGlow) : (green(i) ? L.green : L.empty);
    for (const k in L) if (L[k]) L[k].hidden = L[k] !== want;
    tags[i].classList.toggle('open', i === hover);
  });
  // close-up: the green picture fades in with density, so a thin culture looks pale and a muddy one deep green
  $('#closeupGreen').hidden = chosen < 0 || !green(chosen);
  if (chosen >= 0) $('#closeupGreen').style.opacity = 0.25 + 0.75 * Math.min(1, density[chosen] / window.FarmSim.CULTURE.muddyX.v);
  scene.style.cursor = hover >= 0 ? 'pointer' : 'default';
  showAction();
}

// The one thing to do next for the panel in the close-up (owner only)
let action = null;
function showAction() {
  const b = $('#labAction'), starters = farm && farm.starters || 0;
  action = null;
  if (chosen >= 0 && farm && farm.mine) {
    const st = stages[chosen];
    if (st === 'empty' && starters) action = { type: 'inoculate', label: `Fill with starter · ${starters}` };
    if (st === 'muddy') action = { type: 'take-starter', label: 'Take a starter' };
    if (st === 'dead') action = { type: 'empty', label: 'Drain' };
  } else if (chosen >= 0 && farm && farm.role && farm.role !== 'guest' && stages[chosen] === 'empty' && starters) {
    action = { type: 'inoculate', label: `Give a starter · ${starters}` };    // help another player
  }
  b.hidden = !action; if (action) b.textContent = action.label;
}

// Size the 3:2 art to the screen width; when trimming, take more from the top (ceiling) than the bottom (floor).
// Taller screens show the blurred backdrop above and below.
function fit() {
  for (const el of [scene, closeup]) {
    const w = innerWidth, h = w * ART_H / ART_W;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
    el.style.left = '0px'; el.style.top = `${(innerHeight - h) * 0.85}px`;
  }
}

const drawer = open => document.body.classList.toggle('panel-open', open);
function open(f) {
  farm = f; chosen = -1; hover = -1;
  lab.hidden = false; document.body.classList.add('in-lab'); document.body.classList.remove('lab-closeup');
  $('#labSide').hidden = true; drawer(false);
  P.open(f); fit(); show();
}
function leave() { lab.hidden = true; document.body.classList.remove('in-lab', 'lab-closeup'); drawer(false); farm = null; P.close(); }
function toRoom() { chosen = -1; document.body.classList.remove('lab-closeup'); drawer(false); show(); }
function toPanel(i) {
  chosen = i; hover = -1; document.body.classList.add('lab-closeup'); $('#labSide').hidden = true;
  show(); P.showPanel(i);
}

P.onUpdate((info, s) => {
  if (!s.last) return;
  farm = info; stages = s.panels.map(window.FarmSim.stage); density = s.panels.map(p => p ? p.X : 0);
  s.panels.forEach((p, i) => {
    tags[i].dataset.text = STAGE_TAG[stages[i]] + (p && stages[i] !== 'dead' ? ` · ${p.X.toFixed(2)} g/L` : '');
    tags[i].className = `panelTag ${stages[i]}${i === hover ? ' open' : ''}`;
  });
  show();
  // the room's details drawer: whose dome, how it's doing, what to do next
  const lim = window.FarmSim.limiting(s), filled = s.panels.filter(Boolean).length, starters = info.starters || 0;
  let next = 'Click a panel to look closer.';
  if (!info.mine && info.role !== 'guest' && stages.includes('empty')) next = starters ? `${info.asksHelp ? `${info.owner} asked for starters. ` : ''}Open an empty panel to give one of your ${starters} starter${starters > 1 ? 's' : ''}.` : 'You have no spare starter to give.';
  if (info.mine) {
    const muddy = stages.indexOf('muddy'), empty = stages.indexOf('empty');
    if (empty >= 0 && starters) next = `You have ${starters} starter${starters > 1 ? 's' : ''}: click a clear panel to start a culture.`;
    else if (muddy >= 0) next = `Panel ${muddy + 1} is muddy: open it and take a starter to grow more.`;
    else if (filled && !starters) next = 'Wait for a panel to turn muddy, then take a starter from it.';
    else if (!filled && !starters) next = 'No culture and no starter: take a starter from a muddy panel in another dome.';
  }
  $('#labTitle').textContent = info.mine ? 'Your dome' : `${info.owner}'s dome`;
  $('#labStatus').innerHTML =
    `<p><b>${filled} of ${PANELS}</b> panels growing Spirulina</p>` +
    (filled ? `<p>O₂ ${s.last.o2CollectRate.toFixed(1)} g/h · ${lim.stress ? 'stress' : 'held back by'}: ${lim.key}</p>` : '') +
    (info.mine ? `<p>Starter cultures in hand: ${starters}</p>` : '') +
    (s.last.tau > 1 ? `<p class="storm">Dust storm over this dome: less sunlight. Turn up the lamps.</p>` : '') +
    `<p class="sub">${next}</p>` +
    (helpers(s) ? `<p class="sub">Helped by ${helpers(s)}. Thank you!</p>` : '');
});
// who has given this dome starters, from its log
const helpers = s => { const c = {}; for (const e of s.events) if (e.kind === 'help' && e.by) c[e.by] = (c[e.by] || 0) + 1; return Object.entries(c).map(([n, k]) => k > 1 ? `${n} (${k})` : n).join(', '); };
P.onClosed(() => { if (farm) { lab.hidden = true; document.body.classList.remove('in-lab', 'lab-closeup'); drawer(false); farm = null; } });
P.setCloseButton(() => drawer(false));

G.onInspect(open);
scene.addEventListener('pointermove', e => { const i = panelAt(e.clientX, e.clientY); if (i !== hover) { hover = i; show(); } });
scene.addEventListener('pointerleave', () => { hover = -1; show(); });
scene.addEventListener('click', e => { const i = panelAt(e.clientX, e.clientY); if (i >= 0) toPanel(i); });
$('#labBack').onclick = () => (chosen >= 0 ? toRoom() : leave());
$('#labInfo').onclick = () => {
  if (chosen >= 0) { const open = !document.body.classList.contains('panel-open'); drawer(open); if (open) P.redraw(); }
  else $('#labSide').hidden = !$('#labSide').hidden;
};
$('#labAction').onclick = () => { if (action) P.act({ type: action.type, panel: chosen }); };
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !farm) return;
  if (document.body.classList.contains('panel-open')) drawer(false);
  else if (!$('#labSide').hidden) $('#labSide').hidden = true;
  else if (chosen >= 0) toRoom(); else leave();
});
addEventListener('resize', () => { if (farm) fit(); });
})();
