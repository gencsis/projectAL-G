# Project AL-G: technical details

The main README covers what the project is and how to run it. This file has the details.

## Using it

The screen stays almost empty: icons only, and anything with words slides in from the side.
- Hover any icon or button to see what it is.
- **Map:** oxygen collected by everyone (top left; click it to see the server's total, its output right
  now and how many people that keeps breathing, at 0.818 kg O₂ per person per day from NASA's
  life-support baseline), your account (top right: log in, or your domes,
  starters, next dome, Mars date and log out). Up close: rotate view (Q / E), door side of your next
  dome (R) and erase. The go-to-your-dome button (bottom right) shows only when none of your domes is
  on screen. Hovering a dome shows a small tag: owner, panels filled, oxygen.
- **Lab:** back (Esc) and details. Each panel has a dot for its stage (empty, thin, turning green,
  muddy, died off); its name shows while you point at it. Click a panel for a full-screen close-up.
- **Close-up:** the panel fills the screen. The one thing to do next (fill with a starter, take a
  starter, drain) is a single button at the bottom. The details drawer shows only what matters: how
  far it is from muddy and what it needs, **oxygen made**, **CO₂ exchange** (taking CO₂ in = growing;
  giving it off in the light = shrinking), **water temperature** with its control, a graph of the
  colony **since it was started**, and the microscope. Everything else (pH, nitrate, power, lamps,
  CO₂ settings, recent graphs) is under **More**.
- Drag to move, scroll or pinch to zoom. You can build once a tile is 2+ screen pixels wide; the outline
  under the cursor shows where (white = fits, red = overlaps) and a see-through dome shows the door side.
- Zoomed out, every dome shows as a ring on the globe; yours are labelled "Your farm". Only the owner
  can erase a dome. Domes cast shadows from the real sun position on Mars.

## Farm art

Images are drawn unchanged, only scaled.
- Domes take up `DOME_SIZE` (0.68) of their plot, centred, with the base sitting on the front edges of
  that area. The gap between neighbours leaves room for tunnels.
- A dome's door points one of four ways. The page shows `dome.png` when the door is at the front left,
  `dome-right.png` at the front right, and `dome-back.png` when it faces away. Rotating the camera
  changes which one you see.
- Tunnels join domes on touching plots in the same row or column. `tunnel-a.png` runs up to the right on
  screen, `tunnel-b.png` up to the left. Each tunnel runs from the middle of the nearer dome (hidden
  behind it) to the wall of the farther one. `tunnelW` sets how far it sits toward the camera.
- `dome-right.png` and `dome-back.png` came from screenshots and are smaller than `dome.png` (648 px
  wide vs 1774 px); full-size exports with the same names will look sharper up close.

## Lab art

All lab layers have the same 3:2 size and line up on top of `room.png`; the page scales them together.
On 16:9 and wider screens the room fills the screen (a little is trimmed off the top and bottom); on
narrower screens it fills the width and a blurred copy fills the rest.
- `panel-N-green.png` / `panel-N-empty.png`: panel N with or without culture; `-glow` versions are
  shown while the mouse is over the panel. In the close-up the green picture fades in with density, so
  a thin culture looks pale and a muddy one deep green.
- `closeup-green.png` / `closeup-empty.png`: the close-up of a panel.
- The files are the 422 × 281 originals. The page scales them up without smoothing
  (`image-rendering: pixelated`), so they stay sharp and blocky instead of blurry. `panel-1-empty.png` was
  made from `panel-1-green.png` by showing the room through the glass. For more detail, export from
  Figma at 2× or 4× with the same names; no code changes needed.

## Server API

| Request | What it does |
|---|---|
| `POST /api/register` `{name, password}` | Create an account |
| `POST /api/login` `{name, password}` | Log in (sets a session cookie) |
| `POST /api/logout` | Log out |
| `GET /api/farms` | Every farm with owner, your role there, panel stages, health, oxygen, dust and whether the owner asks for starters, plus the oxygen total, your starters and the dust storms going on |
| `GET /api/farms/:row,:col` | One farm's full simulation state (anyone) |
| `POST /api/farms` `{row, col, facing}` | Build a farm (logged in; one per day; refused if it overlaps) |
| `DELETE /api/farms/:row,:col` | Remove your farm |
| `GET /api/me` / `POST /api/me` | Your starters, starters given, asking for help, caretakers; `{asksHelp}`, `{addCaretaker: name}`, `{removeCaretaker: name}`, `{tutorial: step}` |
| `POST /api/farms/:row,:col/action` | `{type: 'settings', settings}` and `'turn'` for the dome; `'inoculate'` (uses a starter), `'take-starter'` (muddy panels), `'dose-nitrate'`, `'harvest'`, `'empty'` with `panel: 0–3`. Owners can do all of them; caretakers settings, nitrate and inoculate; anyone logged in can inoculate (give a starter) |

## From the browser console (logged in)

```js
const c = marsGrid.cellAt(18.4, 77.5)   // { row, col } of the tile at a lat/lon
marsGrid.place(c.row, c.col)            // farm with its north-west tile at c (false if it overlaps)
marsGrid.place(c.row, c.col + 10, 1)    // the plot to the east, door facing south: a tunnel joins them (needs BUILD_EVERY_HOURS=0)
marsGrid.goTo(18.4, 77.5, 0.06)         // fly there, 60 m up
marsGrid.farmAt(c.row + 3, c.col + 3)   // the farm covering a tile
marsGrid.list()
marsGrid.remove(c.row, c.col)
```

Terrain: NASA/JPL-Caltech Mars Trek (Viking MDIM 2.1 colour mosaic). Weather: NASA/JPL-Caltech, CAB-INTA/CSIC (Curiosity REMS).
