#!/usr/bin/env python3
"""Prepare the bundled Curiosity (MSL) REMS weather record for the farm simulation.

Input : data/weather/rems_gale_my37-38.csv
        700 sols (4270-4995, 10 Aug 2024 - 25 Aug 2026, Ls 308 of MY 37 to Ls 341 of MY 38),
        copied from NASA's public MSL weather feed
        https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
        which republishes the Centro de Astrobiologia (CAB) REMS daily summaries.
Output: data/weather/rems_gale.json

What this does
- Keeps the original units: temperatures in degC, pressure in Pa, times as local mean solar time.
- Missing readings stay null (never zero). Sols absent from the feed are listed in `missingSols`.
- Flags suspicious values instead of deleting them:
    air_min_outlier  - night minimum >= 15 C colder than the median of the 7 sols around it
                       (the feed has isolated -98..-100 C readings)
    air_max_outlier  - daily maximum >= 25 C off that median
  The simulation skips flagged values and uses the neighbouring sols instead.
- CAB states these summaries are for outreach, influenced by the rover (position, shade, dust),
  and that REMS does not measure continuously; scientific data are on the PDS. That caveat is
  carried in the JSON so the app can show it.
"""
import csv, json, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data', 'weather')
src = os.path.join(DATA, 'rems_gale_my37-38.csv')

def num(v):
    v = v.strip()
    return None if v in ('', '--') else float(v)

rows = list(csv.DictReader(open(src)))
sols = []
for r in rows:
    sols.append({
        'sol': int(r['sol']), 'date': r['earth_date_utc'], 'ls': num(r['ls_deg']),
        'airMin': num(r['air_temp_min_C']), 'airMax': num(r['air_temp_max_C']),
        'groundMin': num(r['ground_temp_min_C']), 'groundMax': num(r['ground_temp_max_C']),
        'pressure': num(r['pressure_Pa']), 'opacity': r['atmo_opacity'] or None, 'uv': r['uv_index'] or None,
        'sunrise': r['sunrise_lmst'] or None, 'sunset': r['sunset_lmst'] or None, 'flags': [],
    })
sols.sort(key=lambda s: s['sol'])

def window_median(i, key):
    vals = [s[key] for s in sols[max(0, i - 3): i + 4] if s[key] is not None]
    return statistics.median(vals) if vals else None

for i, s in enumerate(sols):
    m = window_median(i, 'airMin')
    if s['airMin'] is not None and m is not None and s['airMin'] <= m - 15: s['flags'].append('air_min_outlier')
    m = window_median(i, 'airMax')
    if s['airMax'] is not None and m is not None and abs(s['airMax'] - m) >= 25: s['flags'].append('air_max_outlier')

present = {s['sol'] for s in sols}
missing = [n for n in range(sols[0]['sol'], sols[-1]['sol'] + 1) if n not in present]
out = {
    'dataset': 'Curiosity REMS daily weather summaries, Gale crater',
    'mission': 'Mars Science Laboratory (Curiosity)', 'instrument': 'REMS (Rover Environmental Monitoring Station)',
    'location': {'name': 'Gale crater (Curiosity rover)', 'lat': -4.6, 'lon': 137.4},
    'source': 'NASA MSL weather feed (https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json), data by Centro de Astrobiologia (CAB-INTA/CSIC)',
    'retrieved': '2026-10-25',
    'caveat': 'Outreach summaries from CAB: values are at the rover, influenced by the rover itself, and REMS does not measure continuously. For scientific use see the PDS.',
    'units': {'airMin': 'degC', 'airMax': 'degC', 'groundMin': 'degC', 'groundMax': 'degC', 'pressure': 'Pa', 'ls': 'deg', 'sunrise': 'LMST', 'sunset': 'LMST'},
    'solRange': [sols[0]['sol'], sols[-1]['sol']], 'missingSols': missing,
    'flagCounts': {f: sum(f in s['flags'] for s in sols) for f in ('air_min_outlier', 'air_max_outlier')},
    'sols': sols,
}
json.dump(out, open(os.path.join(DATA, 'rems_gale.json'), 'w'), separators=(',', ':'))
print(f"{len(sols)} sols {out['solRange']}, {len(missing)} missing, flags {out['flagCounts']}")
