# Project AL-G

A shared, true-scale Mars where everyone builds greenhouse domes and grows Spirulina algae to make oxygen
together. It runs on real Curiosity weather and published algae research, so if your colony dies, it's
for a real reason.

## Team

[Genesis](https://github.com/gencsis), [Stacey Nguyen](https://github.com/staceytyn)

## About

**What we built.** Project AL-G is a wplace-style multiplayer map of Mars. The whole planet is a
true-scale globe; zoom in and it becomes a grid of 1 m tiles where players build domes (one new dome a
day). Each dome holds four flat-panel photobioreactors. You start with one starter culture of Spirulina:
fill a panel, wait days for the water to turn "muddy", take a starter from it and fill the next panel.
A counter shows the oxygen made by every farm on the server and how many people that would keep
breathing.

**The problem.** Any plan for people beyond Earth has to answer where the air comes from. Algae can
make oxygen and food and help recycle waste, but it's fragile: temperature, light, pH and nutrients all
have to stay in range, and Mars fights every one of them. We wanted anyone to experience that, with
every number backed by real data.

**What it does**
- **Real simulation, running all the time.** The server runs every farm in real time on the real Mars
  clock: water and air temperature (from Curiosity's measured weather), sunlight from the sun's position,
  light that dims as the culture thickens, growth and night-time respiration, nitrate, carbon and pH,
  power and battery, oxygen made and collected. Farms keep running when nobody is watching.
- **Accurate vitals.** An old-system-monitor style panel shows oxygen made, CO₂ exchange (taking
  CO₂ in = growing), a water temperature dial with a heater control, a growth chart since the culture
  started, and a simulated microscope where you watch filaments multiply and the water get murkier.
- **Dust storms.** come mostly in Mars' real dusty season, dim the sun for panels and solar power, and
  make you turn up the lamps.
- **Teamwork.** Give a spare starter to someone's empty panel, ask for help (a green + on your dome), or
  let caretakers change your settings. Destructive actions stay with the owner.

**How it's built**
- **Front end:** plain HTML, CSS and JavaScript, no framework. WebGL2 draws the globe and tile grid; a 2D
  canvas draws the dome art, tunnels between neighbouring domes and shadows from the real sun. Artist drawn and edited sprites.
- **Server:** Node.js with its built-in SQLite (`node:sqlite`), no npm packages. Accounts, shared farms, permissions, and each farm's simulation in fixed
  120 s steps so results don't depend on how often anyone visits.
- **Simulation:** one JavaScript model shared by the server and the page, with a test suite (units,
  darkness, nutrients, power failure, temperature stress and recovery, mass balance, dust storms).
- **Art:** domes, tunnels, the lab inside the dome and the UI were designed by our team in Figma.

### External APIs (exactly two, both NASA)

1. **NASA Mars Trek map tiles** (live): the globe's terrain streams from `trek.nasa.gov`, layer
   `Mars_Viking_MDIM21_ClrMosaic_global_232m` (Viking MDIM 2.1 colour mosaic, 232 m per pixel).
   If it can't be reached, a bundled map (`assets/mars-basemap.jpg`) is used.
2. **NASA Curiosity (MSL) weather feed** (downloaded once):
   `mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`, REMS data by CAB-INTA/CSIC.
   `tools/prepare_weather.py` kept one Mars year of Gale Crater temperatures (sols 4270–4995,
   Aug 2024 – Aug 2026) as `data/weather/rems_gale.json`. Missing readings stay empty; suspect ones
   are flagged and skipped.

Nothing else is fetched from outside while you play: the font is bundled and everything else is served
by our own server.

### Research and real-world data (not APIs)

- **Mars clock:** Mars24 algorithm (Allison & McEwen 2000): real Mars date, season and local time.
- **Spirulina growth and temperature:** Chaiklahan et al. 2007; Torzillo et al. 1991; Rosso et al. 1993.
- **Light use and oxygen yield:** Cornet stoichiometry; Farges et al. 2009 (1.875 g O₂ per g biomass).
- **Growth medium:** Zarrouk 1966. **Microscope shape:** Vonshak 1997.
- **Human oxygen need:** NASA Life Support Baseline Values and Assumptions Document (Anderson et al.
  2018): 0.818 kg O₂ per person per day.
- **Dust storms:** modelled on Mars' dusty season (solar longitude 180–360).

Every value in `sim/farm-sim.js` is tagged measured, derived, modelled, assumed or gameplay, and
[docs/SIMULATION.md](docs/SIMULATION.md) lists each one with its source.

### Boilerplate and AI use

- **Boilerplate:** none. No starter template or framework; every file was written for this project.
- **Bundled third-party files:** Instrument Serif font (`fonts/`, SIL Open Font License, from the
  Fontsource package). Map imagery from NASA/JPL-Caltech; weather from NASA/JPL-Caltech and
  CAB-INTA/CSIC.
- **AI-assisted code:** server and simulation code was written with
  AI assistance from Claude (Anthropic), directed, reviewed and tested by our team. Design decisions and art are ours.

## Prerequisites

- [Node.js](https://nodejs.org) **22.13 or newer** (for the built-in SQLite). Nothing to install with npm.
- A browser with **WebGL2** (any current Chrome, Edge, Firefox or Safari).
- Internet for the live NASA terrain (optional: without it the bundled map is used).
- Optional, only to rebuild the data files in `tools/`: Python 3 (plus numpy, scipy and Pillow for the
  map).

```
# Check your Node version (22.13+)
node --version
```

## Build from source

There is no build step: the server serves the files as they are.

```
# Clone the project
git clone https://github.com/gencsis/projectALG-G.git && cd projectAL-G/mars-view

# Run it (no dependencies to install), then open http://localhost:8000
node server.js
```

Demo mode: time runs 600× faster (a panel turns muddy in about half an hour), no daily dome limit, its
own database, and a dust storm over Gale Crater:

```
TIME_SPEED=600 BUILD_EVERY_HOURS=0 DB=data/demo.db STORM=-4.6,137.4 node server.js
```

Other options: `PORT=3000` for another port. Node prints a warning that SQLite is experimental; that's
expected. Accounts and farms are saved in `data/algae.db` (delete it to start over). Friends on the same
network can join at `http://<your computer's IP>:8000`.

```
# Run the simulation tests
node test/sim.test.js
```

## Extras

### How to play

1. Register and log in. You get one starter culture.
2. Zoom in until the tile grid shows and click a tile to build a dome (one new dome a day).
3. Click your dome, pick a panel and fill it with your starter.
4. Wait. It grows over days; watch the microscope until the water looks muddy.
5. Take a starter from a muddy panel and fill an empty one. More panels, more oxygen.
6. Keep it healthy: heater, lamps, CO₂ and nitrate. Turn up the lamps in dust storms.
7. Help others: give starters to domes with a green +, and add caretakers in your account.
