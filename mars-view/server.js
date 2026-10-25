/* Project AL-G server: serves the site and keeps every farm in one SQLite database, so everyone
   sees the same farms. The server runs each farm's simulation (sim/farm-sim.js).
   Run: node server.js   (Node 22.13 or newer; no packages to install). Then open http://localhost:8000
   Demo: TIME_SPEED=600 DB=data/demo.db BUILD_EVERY_HOURS=0 node server.js   (time runs 600x faster)
   Add STORM=-4.6,137.4 to start a dust storm over that spot when the server starts. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Sim = require('./sim/farm-sim'), Wx = require('./sim/weather');

const PORT = +process.env.PORT || 8000, ROOT = __dirname;
const FARM_TILES = 10, SESSION_DAYS = 30;
const BUILD_EVERY_MS = +(process.env.BUILD_EVERY_HOURS ?? 24) * 3600e3;   // one new farm per player per day (BUILD_EVERY_HOURS=0 for testing)
const TIME_SPEED = +(process.env.TIME_SPEED || 1);                       // farm time runs this many times faster (demos)
const STARTED = Date.now();
const simNow = () => STARTED + (Date.now() - STARTED) * TIME_SPEED;   // the farms' clock
if (process.env.STORM) {                                              // demo: a dust storm over a chosen spot, starting now
  const [lat, lon] = process.env.STORM.split(',').map(Number);
  Wx.addStorm({ start: simNow(), sols: 6, peak: 3, lat, lon, km: 2500 });
}
const weather = Wx.prepare(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/weather/rems_gale.json'), 'utf8')));

/* ---------------- Database ---------------- */
const db = new DatabaseSync(path.resolve(ROOT, process.env.DB || 'data/algae.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, salt TEXT, hash TEXT, created INTEGER);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
  CREATE TABLE IF NOT EXISTS farms (key TEXT PRIMARY KEY, row INTEGER, col INTEGER, facing INTEGER, owner_id INTEGER, state TEXT);
  CREATE TABLE IF NOT EXISTS trust (owner_id INTEGER, helper_id INTEGER, PRIMARY KEY (owner_id, helper_id));   -- caretakers
`);
// columns added later: when you may build again, and how many starter cultures you hold (new players get one)
const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!cols.includes('last_build')) db.exec('ALTER TABLE users ADD COLUMN last_build INTEGER DEFAULT 0');
if (!cols.includes('starters')) db.exec('ALTER TABLE users ADD COLUMN starters INTEGER DEFAULT 1');
if (!cols.includes('asks_help')) db.exec('ALTER TABLE users ADD COLUMN asks_help INTEGER DEFAULT 0');   // asking others for starters
if (!cols.includes('helped')) db.exec('ALTER TABLE users ADD COLUMN helped INTEGER DEFAULT 0');         // starters given to others
if (!cols.includes('tutorial')) db.exec('ALTER TABLE users ADD COLUMN tutorial INTEGER DEFAULT -1');     // tutorial step; -1 = done (accounts made before the tutorial)
const q = {
  userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  addUser: db.prepare('INSERT INTO users (name, salt, hash, created, tutorial) VALUES (?, ?, ?, ?, 0)'),   // new players get the tutorial
  session: db.prepare('SELECT users.id, users.name, users.last_build, users.starters, users.asks_help, users.helped, users.tutorial FROM sessions JOIN users ON users.id = sessions.user_id WHERE token = ? AND expires > ?'),
  addSession: db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)'),
  dropSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  farms: db.prepare('SELECT farms.*, users.name AS owner, users.asks_help FROM farms JOIN users ON users.id = farms.owner_id'),
  farm: db.prepare('SELECT farms.*, users.name AS owner, users.asks_help FROM farms JOIN users ON users.id = farms.owner_id WHERE key = ?'),
  addFarm: db.prepare('INSERT INTO farms (key, row, col, facing, owner_id, state) VALUES (?, ?, ?, ?, ?, ?)'),
  saveFarm: db.prepare('UPDATE farms SET state = ?, facing = ? WHERE key = ?'),
  dropFarm: db.prepare('DELETE FROM farms WHERE key = ?'),
  built: db.prepare('UPDATE users SET last_build = ? WHERE id = ?'),
  starters: db.prepare('UPDATE users SET starters = starters + ? WHERE id = ?'),
  helped: db.prepare('UPDATE users SET helped = helped + 1 WHERE id = ?'),
  asksHelp: db.prepare('UPDATE users SET asks_help = ? WHERE id = ?'),
  tutorial: db.prepare('UPDATE users SET tutorial = ? WHERE id = ?'),
  trusts: db.prepare('SELECT 1 FROM trust WHERE owner_id = ? AND helper_id = ?'),
  myCaretakers: db.prepare('SELECT users.name FROM trust JOIN users ON users.id = trust.helper_id WHERE owner_id = ? ORDER BY users.name'),
  caretakerFor: db.prepare('SELECT users.name FROM trust JOIN users ON users.id = trust.owner_id WHERE helper_id = ? ORDER BY users.name'),
  addTrust: db.prepare('INSERT OR IGNORE INTO trust (owner_id, helper_id) VALUES (?, ?)'),
  dropTrust: db.prepare('DELETE FROM trust WHERE owner_id = ? AND helper_id = ?'),
};

/* ---------------- Tile grid (same maths as main.js) ---------------- */
const COLS = Math.round(2 * Math.PI * 3389.5 * 1000), ROWS = COLS, STEP = 2 * Math.PI / COLS;
const mod = (a, n) => ((a % n) + n) % n;
const farmCenter = (row, col) => ({
  lat: (2 * Math.atan(Math.exp(Math.PI - (row + FARM_TILES / 2) * STEP)) - Math.PI / 2) * 180 / Math.PI,
  lon: -180 + mod(col + FARM_TILES / 2, COLS) / COLS * 360,
});
const overlaps = (a, b) => Math.abs(a.row - b.row) < FARM_TILES && Math.min(mod(a.col - b.col, COLS), mod(b.col - a.col, COLS)) < FARM_TILES;

/* ---------------- Farms ---------------- */
const GALE = { lat: -4.6, lon: 137.4 };
const envs = new Map();
function envFor(f) {                     // measured at Gale crater; the same record, labelled estimated, elsewhere
  if (!envs.has(f.key)) {
    const c = farmCenter(f.row, f.col), far = Math.hypot(c.lat - GALE.lat, (c.lon - GALE.lon) * Math.cos(c.lat * Math.PI / 180)) > 2;
    envs.set(f.key, Wx.makeEnv(weather, { lat: c.lat, lon: c.lon, estimated: far }));
  }
  return envs.get(f.key);
}
// Load a farm row and bring its simulation up to now
function live(f) {
  const s = JSON.parse(f.state);
  if (Sim.advance(s, simNow(), envFor(f))) q.saveFarm.run(JSON.stringify(s), f.facing, f.key);
  return s;
}
// What the map shows for every farm
// What you may do on a farm: owner (everything), caretaker (settings and nutrients), anyone logged in (give a starter)
const roleOn = (f, me) => !me ? 'guest' : f.owner_id === me.id ? 'owner' : q.trusts.get(f.owner_id, me.id) ? 'caretaker' : 'visitor';
function summary(f, s, me) {
  const lim = Sim.limiting(s), L = s.last || {}, active = s.panels.filter(Boolean), role = roleOn(f, me);
  return {
    key: f.key, row: f.row, col: f.col, facing: f.facing, owner: f.owner, mine: role === 'owner', role,
    asksHelp: !!f.asks_help && s.panels.some(p => !p),                      // the owner asked for starters and has an empty panel
    tau: L.tau || Wx.CLEAR_TAU,
    panels: s.panels.map(Sim.stage),                                        // empty / new / growing / muddy / dead
    health: active.length ? Math.min(...active.map(p => p.health)) : 1,
    o2Rate: L.o2CollectRate || 0, o2Total: s.totals.o2Collected, limiting: lim.key, stress: !!lim.stress,
  };
}

/* ---------------- Accounts ---------------- */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function cookie(req, name) { const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return m && m[1]; }
const whoIs = req => { const t = cookie(req, 'alg_session'); return t ? q.session.get(t, Date.now()) || null : null; };
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex'), days = SESSION_DAYS * 86400;
  q.addSession.run(token, userId, Date.now() + days * 1000);
  res.setHeader('Set-Cookie', `alg_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days}`);
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const me = whoIs(req), body = req.method === 'POST' ? await readJson(req) : {};
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/register') {
    const name = String(body.name || '').trim(), pw = String(body.password || '');
    if (!/^[\w.-]{2,24}$/.test(name)) return send(res, 400, { error: 'Use 2–24 letters, numbers, dots, dashes or underscores.' });
    if (pw.length < 6) return send(res, 400, { error: 'Use a password of at least 6 characters.' });
    if (q.userByName.get(name)) return send(res, 409, { error: 'That username is taken.' });
    const salt = crypto.randomBytes(16).toString('hex');
    q.addUser.run(name, salt, hashPw(pw, salt), Date.now());
    return send(res, 201, { ok: true });
  }
  if (route === 'POST /api/login') {
    const u = q.userByName.get(String(body.name || '').trim());
    if (!u || !crypto.timingSafeEqual(Buffer.from(hashPw(String(body.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex')))
      return send(res, 401, { error: 'Wrong username or password.' });
    startSession(res, u.id);
    return send(res, 200, { me: u.name });
  }
  if (route === 'POST /api/logout') {
    const t = cookie(req, 'alg_session'); if (t) q.dropSession.run(t);
    res.setHeader('Set-Cookie', 'alg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }

  // every farm with how it's doing, and the oxygen collected by all of them
  if (route === 'GET /api/farms') {
    let total = 0;
    const farms = q.farms.all().map(f => { const s = live(f); total += s.totals.o2Collected; return summary(f, s, me); });
    const storms = Wx.stormsAt(simNow()).filter(st => st.tau > 0.2).map(st => ({ lat: st.lat, lon: st.lon, km: st.km, tau: st.tau, global: st.global }));
    return send(res, 200, { me: me && me.name, starters: me ? me.starters : 0, tutorial: me ? me.tutorial : -1, nextBuildAt: me ? me.last_build + BUILD_EVERY_MS : null, now: Date.now(), farms, o2Total: total, storms });
  }

  // you: starters, help given, asking for help, and caretakers (people you let look after your domes)
  if (route === 'GET /api/me') {
    if (!me) return send(res, 401, { error: 'Not logged in.' });
    return send(res, 200, { name: me.name, starters: me.starters, helped: me.helped, asksHelp: !!me.asks_help,
      caretakers: q.myCaretakers.all(me.id).map(r => r.name), caretakerFor: q.caretakerFor.all(me.id).map(r => r.name) });
  }
  if (route === 'POST /api/me') {
    if (!me) return send(res, 401, { error: 'Not logged in.' });
    if ('asksHelp' in body) q.asksHelp.run(body.asksHelp ? 1 : 0, me.id);
    if (Number.isInteger(body.tutorial)) q.tutorial.run(body.tutorial, me.id);
    if (body.addCaretaker) {
      const u = q.userByName.get(String(body.addCaretaker).trim());
      if (!u) return send(res, 404, { error: 'No player with that name.' });
      if (u.id === me.id) return send(res, 400, { error: 'That is you.' });
      q.addTrust.run(me.id, u.id);
    }
    if (body.removeCaretaker) { const u = q.userByName.get(String(body.removeCaretaker)); if (u) q.dropTrust.run(me.id, u.id); }
    return send(res, 200, { ok: true });
  }

  const m = url.pathname.match(/^\/api\/farms\/(\d+),(\d+)(\/action)?$/);
  if (route === 'POST /api/farms') {
    if (!me) return send(res, 401, { error: 'Log in to build a farm.' });
    const row = body.row, col = mod(body.col, COLS);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row + FARM_TILES > ROWS) return send(res, 400, { error: 'Not a valid plot.' });
    const wait = me.last_build + BUILD_EVERY_MS - Date.now();
    if (wait > 0) return send(res, 429, { error: `You can build one farm a day. Next one in ${Math.floor(Math.ceil(wait / 60e3) / 60)} h ${Math.ceil(wait / 60e3) % 60} min.` });
    if (q.farms.all().some(f => overlaps(f, { row, col }))) return send(res, 409, { error: 'That plot overlaps another farm.' });
    const c = farmCenter(row, col), key = `${row},${col}`;
    const s = Sim.createFarm({ t: simNow() - Sim.STEP_S * 1000, lat: c.lat, lon: c.lon });   // an empty dome; one step back so it has readings right away
    q.addFarm.run(key, row, col, mod(body.facing | 0, 4), me.id, JSON.stringify(s));
    q.built.run(Date.now(), me.id);
    return send(res, 201, { key });
  }
  if (m) {
    const f = q.farm.get(`${m[1]},${m[2]}`);
    if (!f) return send(res, 404, { error: 'No farm there.' });
    const role = roleOn(f, me);
    if (req.method === 'GET' && !m[3]) { const s = live(f); return send(res, 200, { ...summary(f, s, me), starters: me ? me.starters : 0, state: s }); }   // anyone can look
    if (req.method === 'DELETE' && !m[3]) {
      if (role !== 'owner') return send(res, 403, { error: 'Only the owner can remove a dome.' });
      q.dropFarm.run(f.key); envs.delete(f.key); return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && m[3]) {
      if (!me) return send(res, 401, { error: 'Log in first.' });
      // helpful actions are shared; anything that removes culture or changes the dome stays with the owner
      const ALLOWED = { owner: ['settings', 'dose-nitrate', 'harvest', 'inoculate', 'take-starter', 'empty', 'turn'], caretaker: ['settings', 'dose-nitrate', 'inoculate'], visitor: ['inoculate'] };
      if (!ALLOWED[role].includes(body.type)) return send(res, 403, { error: role === 'visitor' ? 'You can give this dome a starter. To change settings, ask the owner to make you a caretaker.' : 'Only the owner can do that.' });
      const s = live(f);
      let facing = f.facing, starters = me.starters;
      if (body.type === 'turn') facing = (facing + 1) % 4;
      else {
        if (body.type === 'inoculate' && starters < 1) return send(res, 400, { error: 'You have no starter culture. Take one from a muddy panel.' });
        if (!Sim.applyAction(s, body, simNow())) return send(res, 400, { error: body.type === 'take-starter' ? 'This panel is not muddy enough yet.' : 'That action did not work.' });
        const ev = s.events[s.events.length - 1];
        if (role !== 'owner') ev.by = me.name;                                // credit helpers in the dome's log
        if (body.type === 'inoculate') {
          q.starters.run(-1, me.id); starters--;
          if (role !== 'owner') { ev.kind = 'help'; ev.detail = `${me.name} gave a starter for panel ${(body.panel | 0) + 1}`; q.helped.run(me.id); }
        }
        if (body.type === 'take-starter') { q.starters.run(1, me.id); starters++; }
      }
      q.saveFarm.run(JSON.stringify(s), facing, f.key);
      return send(res, 200, { ...summary({ ...f, facing }, s, me), starters, state: s });
    }
  }
  send(res, 404, { error: 'Not found' });
}

/* ---------------- HTTP ---------------- */
function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function readJson(req) {
  return new Promise(resolve => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}
const PUBLIC = ['/index.html', '/styles.css', '/main.js', '/panel.js', '/login.js', '/microscope.js', '/lab.js', '/tutorial.js', '/sim/', '/assets/', '/fonts/'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function file(req, res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const p = path.join(ROOT, rel);
  // only the files the page needs (never the database or this file)
  if (!p.startsWith(ROOT + path.sep) || !PUBLIC.some(x => rel === x || (x.endsWith('/') && rel.startsWith(x)))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) api(req, res, url).catch(e => { console.error(e); send(res, 500, { error: 'Server error' }); });
  else if (req.method === 'GET') file(req, res, url);
  else { res.writeHead(405); res.end(); }
}).listen(PORT, () => console.log(`Project AL-G running at http://localhost:${PORT}`));
