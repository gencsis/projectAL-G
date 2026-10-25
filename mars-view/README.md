# Project AL-G

A wplace-style map of Mars that everyone shares. The planet is a true-scale globe; zoom in and it
becomes a grid of 1 m tiles. Anyone can look around and click any farm to see how it's running.
Register and log in (top right) to build your own Spirulina domes (each on a 10 × 10 tile plot),
one new dome per day.
Farms built side by side are joined by a tunnel. Each farm runs a simulation on the server
(temperature, light, growth, pH, oxygen and power, driven by real Curiosity weather), and the top bar
shows the oxygen collected by every farm.

## How to play

New accounts are walked through it by **Percy the rover** (a bar along the bottom), 13 steps with a
tip each. Each step brings what it talks about on screen: it flies you to Gale Crater, then to your
dome, opens the vitals, the microscope and the teamwork drawer, and points at the right button. Steps
that need you to do something move on once you've done it. The server remembers each player's step;
accounts made before the tutorial existed don't get it. ✕ hides Percy; click the small rover to carry on.

1. Register and log in. You start with **one starter culture**.
2. Build a dome. Inside are four reactor panels, all empty.
3. Click a clear panel and fill it with your starter. The culture starts thin (0.06 g/L).
4. Wait. It grows slowly, over days, and you can watch the water turn from clear to green to
   **muddy** (0.6 g/L) in the panel's microscope.
5. Once a panel is muddy, take a starter from it (10 % of the panel, topped back up with fresh
   medium) and use it to fill another panel, in the same dome or a new one. More panels, more oxygen.
6. Keep them healthy: lamps, temperature, CO₂, nitrate, and don't let them freeze.
7. Watch for **dust storms** (a dust icon under the oxygen total, and a tan haze on the globe). They
   dim the sun, which cuts both the light on your panels and your solar power: turn up the lamps.

## Teamwork

- **Give starters:** open anyone's dome and click an empty panel to fill it with one of your starters.
  Helpers are thanked in the dome's details, and your account drawer counts what you've given.
- **Ask for help:** in your account drawer, tick "Ask other players for starters". Your domes with an
  empty panel then show a green **+** to other players.
- **Caretakers:** add a player by name in your account drawer. Caretakers can change settings and add
  nutrients in all your domes (and give starters, like anyone). Harvesting, draining, taking starters,
  turning and removing a dome stay with the owner, so nobody can wreck your colony.

## Run

Start the server (Node 22.13 or newer, nothing to install), then open http://localhost:8000.

    node server.js                 # PORT=3000 node server.js for another port
    BUILD_EVERY_HOURS=0 node server.js   # no daily dome limit (for testing)

Demo mode (time runs 600 × faster, so a panel turns muddy in about half an hour; keep it in its own
database because farms run ahead of real time):

    TIME_SPEED=600 BUILD_EVERY_HOURS=0 DB=data/demo.db node server.js

Add `STORM=-4.6,137.4` (a latitude, longitude) to start a dust storm there when the server starts, to
show storms in a demo. Otherwise storms come by themselves: mostly regional, mostly in southern spring
and summer, the same for every player.

Tests: `node test/sim.test.js`

## Real-world data and the two APIs

The game uses exactly two outside APIs, both NASA's:

1. **NASA Mars Trek map tiles**, live while you play. The globe's terrain is streamed from
   `trek.nasa.gov` (layer `Mars_Viking_MDIM21_ClrMosaic_global_232m`: the Viking MDIM 2.1 colour
   mosaic, 232 m per pixel). If it can't be reached, the bundled `assets/mars-basemap.jpg` is shown.
2. **NASA's Curiosity (MSL) weather feed**, downloaded once:
   `mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` (REMS data from CAB-INTA/CSIC).
   `tools/prepare_weather.py` keeps one Mars year (sols 4270–4995, Aug 2024 – Aug 2026) as
   `data/weather/rems_gale.json`, so every player's farm runs on the same record.

Nothing else is fetched from outside: the font is bundled, and accounts and farms live on your server.

Other real-world data, from published work rather than APIs:
- **Mars clock** (Mars24 algorithm, Allison & McEwen 2000): the real date, season and local time on
  Mars. Sunlight, shadows and day and night follow it.
- **Spirulina biology** (Chaiklahan 2007, Torzillo 1991, Cornet / Farges 2009, Rosso 1993, Zarrouk
  1966, Vonshak 1997): growth rate, best temperature, night respiration, light use, oxygen per gram,
  medium recipe, filament shape.
- **Human oxygen need** (NASA BVAD, Anderson et al. 2018): 0.818 kg of O₂ per person per day, for the
  "people it keeps breathing" number.
- **Dust storms** follow the real dusty season on Mars (solar longitude 180–360).

Every value is tagged in `sim/farm-sim.js` as measured, derived, modelled, assumed or gameplay;
`docs/SIMULATION.md` lists them all with sources.

Settings are in `CONFIG` at the top of `main.js` (tile size, farm size, zoom limits, dome size,
shadow darkness). Art files, dome height and tunnel size are in `FARM`.

Terrain: NASA/JPL-Caltech Mars Trek (Viking MDIM 2.1 colour mosaic). Weather: NASA/JPL-Caltech, CAB-INTA/CSIC (Curiosity REMS).
