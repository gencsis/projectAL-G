/* Tutorial: Percy the rover walks a new player through the game, one step at a time.
   - Only for new accounts: the server keeps each player's step (-1 = done; older accounts start done).
   - Steps that wait for you to do something (build, go inside, fill a panel) move on by themselves once
     it's done; the others have a › button. Steps already done are skipped.
   - Each step brings what it talks about on screen (flies to it or opens it) and points at it.
   - ✕ puts Percy away; click the small rover to carry on. */
(() => {
'use strict';
const G = window.marsGrid, $ = s => document.querySelector(s), body = document.body;
const filled = s => s.mine.some(f => (f.panels || []).some(p => p !== 'empty'));
const has = c => body.classList.contains(c);
const GALE = [-4.6, 137.4];                                    // Gale crater: real weather from Curiosity
const details = () => { if (has('lab-closeup') && !has('panel-open')) $('#labInfo').click(); };
const reveal = sel => setTimeout(() => { const t = $(sel); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);

// title, tip: what Percy says. done(state): skip or leave the step once true. next: show a › button.
// at: the element to point at. show(state): bring it on screen when the step starts. leave(): undo show.
const STEPS = [
  { next: true, title: "Welcome To Mars! I'm Percy.", tip: 'This Mars is shared by every player. Each dome grows algae that makes oxygen.' },
  { next: true, at: '#o2', title: "This Is Everyone's Oxygen", tip: 'Top left: all the oxygen every farm has made. Your domes add to it.' },
  { next: true, done: s => s.mine.length, show: () => G.flyTo(GALE[0], GALE[1], 0.08),
    title: 'Pick A Spot', tip: "I'm taking you to Gale Crater, where the weather is real. Scroll to zoom anywhere you like." },
  { done: s => s.mine.length, title: 'Build Your Dome', tip: 'Click a tile to place it. You get one new dome a day. Press R to turn the door.' },
  { done: s => has('in-lab') || filled(s), show: s => { const f = s.mine[0]; if (f) G.flyTo(f.lat, f.lon, 0.06); },
    title: 'Go Inside', tip: 'Click your dome to open the lab.' },
  { done: s => has('lab-closeup') || filled(s), at: '#labScene .panelTag',
    title: 'Pick A Panel', tip: 'These four tanks grow your algae. Click one to look closer.' },
  { done: filled, at: '#labAction', title: 'Fill It With Your Starter', tip: 'Your starter is a small culture of Spirulina. Click the button at the bottom.' },
  { next: true, at: '#fpBig', show: details,
    title: 'Check The Vitals', tip: "Oxygen made, and CO₂ exchange: taking CO₂ in means it's growing." },
  { next: true, at: '.tempTile', show: () => { details(); reveal('.tempTile'); },
    title: 'Keep It Warm', tip: 'Spirulina likes 30–37 °C. Drag the heater slider to change it.' },
  { next: true, at: '.micro', show: () => { details(); reveal('.micro'); },
    title: 'Watch It Grow', tip: 'It takes days. When the water looks muddy, the panel is ready.' },
  { next: true, at: '#fpStage', show: () => { details(); reveal('#fpStage'); },
    title: 'Spread Your Culture', tip: 'This bar shows how close it is to muddy. Then take a starter from it and fill an empty panel.' },
  { next: true, at: '#dust', show: () => body.classList.add('guide-dust'), leave: () => body.classList.remove('guide-dust'),
    title: 'Watch For Dust Storms', tip: 'They dim the sun. When this icon shows up, turn up the lamps in the vitals.' },
  { next: true, at: '.team', show: () => { if (has('panel-open')) $('#fpClose').click(); if ($('#side').hidden) $('#meBtn').click(); },
    title: 'Work Together', tip: 'Give spare starters to domes with a green +. Add caretakers here so friends can help.' },
];

const el = document.createElement('div'); el.id = 'guide'; el.hidden = true;
el.innerHTML = `<button class="rover" aria-label="Percy, your guide" title="Percy, your guide"><img src="assets/ui/rover.png" alt=""></button>
  <div class="say" role="status"><small></small><h2></h2><p></p></div>
  <button class="next" aria-label="Next">›</button><button class="away" aria-label="Hide the guide">✕</button>`;
body.appendChild(el);
const next = el.querySelector('.next');
let user = null, i = -1, away = false, entered = -1, target = null;

const save = () => G.call('POST', '/api/me', { tutorial: i >= STEPS.length ? -1 : i }).catch(() => {});
function point(sel) {
  const t = sel && $(sel), visible = t && t.getClientRects().length > 0;
  if (target && target !== t) target.classList.remove('guide-at');
  target = visible ? t : null; if (target) target.classList.add('guide-at');
}
function render() {
  const s = G.state();
  if (s.me !== user) { user = s.me; i = s.me ? s.tutorial : -1; entered = -1; away = false; }   // a new login: start where this player left off
  const was = i;
  while (i >= 0 && i < STEPS.length && STEPS[i].done && STEPS[i].done(s)) i++;
  const on = i >= 0 && i < STEPS.length;
  if (i !== was) save();
  if (entered !== i) {                                      // a new step: undo the last one's extras, bring this one on screen
    const old = STEPS[entered]; if (old && old.leave) old.leave();
    entered = i; if (on && STEPS[i].show) STEPS[i].show(s);
  }
  el.hidden = !on || !$('#login').hidden;
  el.classList.toggle('away', away);
  body.classList.toggle('guide-on', !el.hidden && !away);   // lifts bottom buttons above the bar
  if (el.hidden || away) { point(null); return; }
  const step = STEPS[i], text = `${step.title}|${step.tip}`;
  if (el.dataset.text !== text) {
    el.dataset.text = text;
    el.querySelector('small').textContent = `Step ${i + 1} of ${STEPS.length}`;
    el.querySelector('h2').textContent = step.title;
    el.querySelector('p').textContent = `Tip: ${step.tip}`;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  next.hidden = !step.next;
  point(step.at);
}
next.onclick = () => { i++; save(); render(); };
el.querySelector('.away').onclick = () => { away = true; render(); };
el.querySelector('.rover').onclick = () => { away = !away; if (!away) entered = -1; render(); };   // coming back shows the step again
setInterval(render, 500);
})();
