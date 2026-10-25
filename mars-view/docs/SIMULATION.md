# Farm simulation: design and sources

Checklist sections 1–4 (first pass). Code: `sim/farm-sim.js` (engine), `sim/weather.js` (outside
conditions), `server.js` (runs every farm), `panel.js` (farm panel), `test/sim.test.js` (checks). Run the tests with
`node test/sim.test.js`.

## 1. Decisions

| Question | Decision |
|---|---|
| Main goal | Maximise reliable, **usable** oxygen: O₂ actually collected into the farm's tank, not gross photosynthesis. |
| Farm | One 10 × 10 m farm = one insulated dome with up to **four flat-panel reactors**, each 5 m² lit, 10 cm light path, **0.5 m³** of culture. A new dome is empty; panels are filled one at a time with a starter culture. Sun window 20 m² (60 % transmittance), LED panels up to 2.5 kW, heater 4 kW, radiator 5 kW, 40 m² of solar panels, 30 kWh battery, plus a constant 2 kW share of a colony power plant. |
| Enclosure | Each reactor is **independently protected** by its own dome (matches the dome art). |
| Species | **Spirulina (*Arthrospira platensis*)** in Zarrouk medium. |
| Time | **Real time, 1:1.** The Mars date and local solar time come from the real clock (Mars24 algorithm). Each farm advances in fixed 120 s steps on its own clock, so results don't depend on how often anyone opens the site. A separate accelerated demo mode comes later. |
| Robot | The 12-hour Earth–Mars round trip stays labelled as a game simplification (not built yet). |

## Starting and growing cultures (gameplay)

| Rule | Value | Basis |
|---|---|---|
| New player | 1 starter culture | gameplay |
| Starter | 10 % of a panel (50 L of muddy culture) | Spirulina is commonly started with roughly a tenth of the volume as dense culture |
| New panel | 0.06 g/L (a starter in fresh Zarrouk medium) | follows from the two rules above |
| Muddy (ready to take a starter) | 0.6 g/L | gameplay; about two thirds of what the default lamps can sustain |
| Taking a starter | the panel loses 10 % of its culture and is topped up with fresh medium | |
| Dead | below 0.02 g/L; drain and restart | gameplay |

All panels in a dome share one water temperature, the lamps (625 W each), the heater, the pump and the
power supply. Each panel has its own biomass, nitrate, carbon, pH, dissolved O₂ and health. With the
default settings at Gale crater a fresh panel turns muddy in about 13 sols.

## 2. What is measured, modelled or assumed

Every parameter in `sim/farm-sim.js` carries a tag: `measured`, `derived` (computed from measured
values, with the working in a comment), `design`, `gameplay` or `assumed`.

**Measured / derived from experiments (Spirulina)**

| Value | Number | Source |
|---|---|---|
| Light half-saturation | 90 µmol/m²/s | Cornet; Farges et al. 2009 |
| Mass light absorption | 0.2 m²/g (200–225 m²/kg) | Farges et al. 2009 |
| O₂ yield | 1.875 g O₂ per g biomass (1.389 mol O₂ per C-mol of 23.7 g) | Cornet stoichiometry, CH₁.₅₇₅O₀.₄₅₉N₀.₁₇₃ |
| Nitrogen / carbon content | 10.2 % N, 50.6 % C | same formula |
| Optimum temperature | 35 °C | Chaiklahan et al. 2007; Torzillo et al. 1991 |
| Maximum temperature | 44 °C (43 °C critical, decline at 45 °C) | Chaiklahan et al. 2007 |
| Max growth rate | 1.31 /day, from a measured net 0.59 /day at 35 °C and 100 µmol/m²/s | Chaiklahan et al. 2007, corrected for light and dark respiration |
| Dark respiration | 0.098 /day, from 5 % of dry weight lost per night at 35 °C | Torzillo et al. 1991 |
| Medium | NaNO₃ 2.5 g/L, NaHCO₃ 16.8 g/L, run at pH ≈ 9.5 | Zarrouk 1966; Farges et al. 2009 |

**Measured weather.** Curiosity REMS daily air temperature minimum and maximum, Gale crater, sols
4270–4995 (Aug 2024 – Aug 2026, a full Mars year), from NASA's public MSL weather feed (CAB data).
`tools/prepare_weather.py` keeps units and sols, leaves missing readings `null`, lists 26 missing
sols and flags 21 suspect readings (isolated −98…−100 °C nights), which the simulation skips. The
feed is an outreach product influenced by the rover; the app says so.

**Modelled**
- Temperature through the day: a smooth curve from the measured minimum at local sunrise to the
  measured maximum at 14:00 local solar time.
- Sunlight: computed from the sun's position and Mars' orbit, with dust optical depth 0.6 (the REMS
  summaries only say "Sunny").
- Farms away from Gale crater use the same Gale record, shown as **estimated** in the panel.
- Light in the culture: Beer–Lambert, depth-averaged (the culture shades itself as it thickens).
- Temperature response: cardinal temperature model (Rosso et al. 1993) through 15 / 35 / 44 °C.
- pH: carbonate chemistry from total dissolved carbon and alkalinity. Growth removes carbon (pH
  rises), CO₂ adds it (pH falls), nitrate uptake adds alkalinity.
- Heat: two nodes (dome air, culture water) with the water's thermal mass (8.4 MJ/K), heat loss
  through the dome, solar gain, lamp and heater heat.

**Assumed (no direct source; disclosed)**
- 15 °C minimum growth temperature (strain-dependent; some strains grow below 10 °C).
- pH comfort band 8.5–10.5; dissolved-O₂ inhibition above 2× saturation; nutrient half-saturations.
- LED efficacy 2.8 µmol/J; solar panel efficiency 22 %; O₂ stripping and 90 % collection; 0.5 kWh
  per kg O₂ compression.

**Gameplay rules**
- Health (0–100 %) multiplies growth. Temperature extremes cut it by 100 %/sol; nitrogen starvation
  or bad pH by 30 %/sol. It recovers at 30 %/sol, so recovery takes about 3 sols.
- Freezing (< 0.5 °C) or overheating (> 44 °C) kills cells. A floor of 0.005 g/L keeps a few alive,
  so a neglected farm stops producing but can recover with care.
- Power priority when short: controls, pump, heater, fan, lamps (lamps are shed first).

## 3. What the simulation tracks

Outside, dome-air and culture temperatures; heating, cooling, solar and lamp heat, heat loss; power
generation, battery and each load; light at the surface and inside the culture; biomass, nitrate,
dissolved carbon, alkalinity, pH, dissolved O₂; growth and respiration; **net O₂** (made −
respired) and **collected O₂** (into the tank) separately; health; on-site supplies (nitrate and
CO₂ are used up and must be resupplied); harvested biomass (not counted as verified food).

## 4. Controls in the farm panel

Lamp intensity and on/off hours; temperature target; mixing on/off; CO₂ delivery (automatic pH
control with a target, or a fixed rate); dose 1 kg nitrate; harvest half. Readings show units and
good ranges, the panel names what is limiting growth right now, and the graphs (temperature,
biomass, O₂, power over 1, 3 or 7 sols) mark every change you made with a dashed line. Settings can
be changed from anywhere, at any time.

## Dust storms (sim/weather.js)

Modelled, not measured. Clear days have dust optical depth 0.6. Each Mars sol has a fixed
pseudo-random chance of a storm starting: 8 % in southern spring and summer (Ls 180–360, the dusty
season), 1.5 % otherwise. Most storms are regional (1,500–3,500 km across the dusty area, optical depth
+1.2 to +3.5, lasting 3–12 sols, mostly starting in the south); 3 % are planet-wide (+4 to +6, 35–65
sols). Real storms can be stronger: the 2018 planet-wide storm passed 10 at Opportunity's site.

Effects: sunlight through the dome window and onto the solar panels follows the optical depth (direct
light falls off fast, 60 % of what is scattered still arrives), and the day–night temperature swing
shrinks (dust warms nights and cools days). At Gale crater, storms cover roughly 8 % of sols.

## Teamwork rules

| Who | Can |
|---|---|
| Owner | everything |
| Caretaker (chosen by the owner) | change settings, dose nitrate, give starters |
| Any logged-in player | give a starter to an empty panel |

Taking starters, harvesting, draining, turning and removing a dome are the owner's alone, so help can't
turn into sabotage. Starters given by others are logged in the dome's history with the giver's name.

## What the panel shows first

- **Oxygen made**: the panel's net O₂ (photosynthesis minus respiration), g/h.
- **CO₂ exchange**: worked out from the same growth. Each C-mol of biomass fixes 1 mol CO₂ and releases
  1.389 mol O₂ (Cornet), so CO₂ (g/h) = O₂ (g/h) ÷ 32 ÷ 1.389 × 44. Taken in = growing; given off in
  the dark = resting; given off in the light = shrinking.
- **Water temperature** and its target.
- **Since it was started**: the panel's density every 6 hours from the day it was filled (long lives
  are thinned to 240 points), with the "muddy" line.

## Simulated microscopy (microscope.js)

The microscope in the farm panel is drawn from the model, not a picture of real cells.

| What | How | Basis |
|---|---|---|
| Shape | Helical filaments, 8 µm wide, coil radius 20 µm, pitch 50 µm, with cross-walls | Typical *A. platensis* ranges (Vonshak 1997: trichomes 6–12 µm wide, helix pitch ~43–57 µm) |
| Number in view | Biomass (g/L) ÷ dry mass of one filament × volume in view (300 × 225 µm field, 1 mm-deep counting chamber) | Filament mass **assumed**: 230 µm long along its axis, 20 % dry matter, density 1.05 g/cm³ (≈ 6.6 ng) |
| Lengthening | Each filament grows at the simulated net growth rate (only while it is positive) | Model |
| Breaking in two | A filament longer than 360 µm breaks at a random point near its middle | Spirulina multiplies by filaments breaking (fragmentation); the length is a gameplay choice |
| Speed | Time-lapse, 1 s on screen = 4 h in the culture | Display choice |

Not shown: fluorescence (no defensible relationship in our model). The look of the cells doesn't
change with health, so it can't be read as a diagnosis; the readings next to it are what count.

## Checks (test/sim.test.js)

Units and the 0.59 /day calibration; identical results whatever the update interval; darkness;
light saturation; nitrogen depletion and recovery after dosing; power failure (lamps shed first);
cold stress and ~3-sol recovery; freezing; nitrate used = biomass grown × N content and O₂ =
biomass × yield; missed check-ins; pH held by automatic CO₂; sensible weather and sunlight.

With the default settings at Gale crater, one muddy panel collects about **16 g of O₂ per sol** and a full dome of four about **63 g per sol**.

## Sources

- Vonshak A. (ed.) 1997, *Spirulina platensis (Arthrospira): Physiology, Cell-biology and Biotechnology*, Taylor & Francis (filament size and shape).

- Farges B. et al. 2009, *Spectral kinetic modeling and long-term behavior assessment of Arthrospira platensis growth in photobioreactor under red (620 nm) light illumination*, Biotechnology Progress (arXiv:2011.05321).
- Chaiklahan R. et al. 2007, *Response of Spirulina platensis C1 to high temperature and high light intensity*, Kasetsart J. (Nat. Sci.) 41:123–129.
- Torzillo G., Sacchi A., Materassi R. 1991, *Temperature as an important factor affecting productivity and night biomass loss in Spirulina platensis grown outdoors in tubular photobioreactors*, Bioresource Technology 38:95–100.
- Zarrouk C. 1966, PhD thesis, Université de Paris (Zarrouk medium).
- Rosso L. et al. 1993, cardinal temperature model with inflection, J. Theoretical Biology 162:447–463.
- Allison M., McEwen M. 2000, Mars24 time algorithm, Planetary and Space Science 48:215–235.
- Curiosity REMS daily summaries: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json (CAB-INTA/CSIC).
