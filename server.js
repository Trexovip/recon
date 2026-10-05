// Balance Reconciliation server: logins, activity log, day-end closing. No dependencies, Node 18+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const seed = require('./seed');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const AUDIT_DIR = path.join(DATA, 'audit');
const F = { state: path.join(DATA, 'state.json'), users: path.join(DATA, 'users.json'), closings: path.join(DATA, 'closings.json') };
for (const d of [DATA, AUDIT_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const loadConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); };
const uid = () => crypto.randomBytes(5).toString('hex');
const SECTIONS = ['payout', 'payin', 'other', 'banks', 'uses', 'recovery'];
const SECTION_NAMES = { payout: 'Payout wallets', payin: 'Payin wallets', other: 'Other party payments', banks: 'Bank accounts', uses: 'Other uses', recovery: 'Recovery' };

/* ---------- Time (business timezone from config) ---------- */
const TZ = () => loadConfig().timezone || 'Asia/Kolkata';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/* ---------- State ---------- */
let state = readJSON(F.state, null);
if (!state || !state.payout) {
  state = { ...seed(), apiNames: { banks: [] }, lastSync: {}, version: 1 };
  writeJSON(F.state, state);
}
state.version ??= 1; state.apiNames ??= { banks: [] }; state.lastSync ??= {};
const saveState = () => { state.version++; writeJSON(F.state, state); };

function totals(s = state) {
  const sum = k => (s[k] || []).reduce((a, r) => a + (+r.amount || 0), 0);
  const t = Object.fromEntries(SECTIONS.map(k => [k, sum(k)]));
  t.grand = t.payout + t.payin + t.other; t.diff = t.grand - t.banks - t.uses; return t;
}

/* ---------- Users & sessions ---------- */
let users = readJSON(F.users, []);
const saveUsers = () => writeJSON(F.users, users);
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPw = (u, pw) => { const h = crypto.scryptSync(pw, u.salt, 64); return crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex')); };
const publicUser = u => ({ username: u.username, name: u.name, role: u.role, active: u.active, lastLogin: u.lastLogin || null, createdAt: u.createdAt });
const sessions = new Map(); // token -> {username, exp}
const SESSION_HOURS = 12;
const failures = new Map(); // ip -> {count, until}

function getUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m?.[1]); return null; }
  const u = users.find(x => x.username === s.username && x.active);
  if (!u) return null;
  s.exp = Date.now() + SESSION_HOURS * 3600e3;
  return u;
}

/* ---------- Activity log ---------- */
function clientInfo(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
  const ua = req.headers['user-agent'] || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { ip: ip === '::1' ? '127.0.0.1' : ip, device: `${br} on ${os}` };
}
function audit(req, user, entry) {
  const rec = { at: new Date().toISOString(), date: today(), user: user?.username || 'system', userName: user?.name || 'System', role: user?.role || '-', ...(req ? clientInfo(req) : { ip: 'server', device: 'Server' }), ...entry };
  fs.appendFileSync(path.join(AUDIT_DIR, rec.date + '.jsonl'), JSON.stringify(rec) + '\n');
}
function readAudit(date) {
  try { return fs.readFileSync(path.join(AUDIT_DIR, date + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}

/* ---------- Day-end closing ---------- */
let closings = readJSON(F.closings, []);
const saveClosings = () => writeJSON(F.closings, closings);
const isLocked = () => closings.some(c => c.date === today());

/* ---------- API sync ---------- */
const getPath = (o, p) => !p ? o : p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const toNumber = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function fetchSource(name) {
  const cfg = loadConfig().sources[name];
  const opts = { method: cfg.method || 'GET', headers: { Accept: 'application/json', ...(cfg.headers || {}) } };
  if (cfg.body) { opts.body = JSON.stringify(cfg.body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(cfg.url, { ...opts, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = getPath(await res.json(), cfg.listPath);
  if (!Array.isArray(list)) throw new Error(`"${cfg.listPath}" in the response is not a list`);
  return list.map(i => ({ name: String(getPath(i, cfg.nameField) ?? '').trim(), balance: toNumber(getPath(i, cfg.balanceField)) })).filter(r => r.name);
}

let lastBankRows = [];
function applyBankApi(r) {
  const hit = lastBankRows.find(b => b.name === r.apiName);
  if (hit) { r.amount = hit.balance; r.stale = false; } else if (r.apiName && lastBankRows.length) r.stale = true;
}
async function runSync(req, user) {
  if (isLocked()) throw new Error('Today is closed. Ask an admin to reopen it before refreshing.');
  const sources = loadConfig().sources, errors = [], changes = [];
  const now = new Date().toISOString(), by = user ? user.username : 'auto-refresh';
  for (const src of ['payout', 'payin', 'banks']) {
    if (!sources[src]?.enabled) continue;
    try {
      const rows = await fetchSource(src);
      if (src === 'banks') {
        lastBankRows = rows; state.apiNames.banks = rows.map(r => r.name);
        const linked = new Set();
        for (const r of state.banks) if (r.source === 'api') {
          const before = r.amount; applyBankApi(r); linked.add(r.apiName);
          if (before !== r.amount) { changes.push({ section: src, rowName: r.name, from: before, to: r.amount }); r.updatedBy = 'API'; r.updatedAt = now; }
        }
        for (const b of rows) if (!linked.has(b.name) && !state.banks.some(r => r.source !== 'api' && norm(r.name) === norm(b.name))) {
          state.banks.push({ id: uid(), name: b.name, amount: b.balance, note: '', flag: false, source: 'api', apiName: b.name, createdBy: 'API', updatedBy: 'API', updatedAt: now });
          changes.push({ section: src, rowName: b.name, from: null, to: b.balance });
        }
      } else {
        const old = state[src], byName = Object.fromEntries(old.map(r => [norm(r.name), r]));
        const fresh = rows.map(b => {
          const p = byName[norm(b.name)];
          if (!p || p.amount !== b.balance) changes.push({ section: src, rowName: b.name, from: p ? p.amount : null, to: b.balance });
          return { ...(p || { id: uid(), note: '', flag: false, createdBy: 'API' }), name: b.name, amount: b.balance, source: 'api', updatedBy: p && p.amount === b.balance ? p.updatedBy : 'API', updatedAt: p && p.amount === b.balance ? p.updatedAt : now };
        });
        state[src] = [...fresh, ...old.filter(r => r.source === 'manual')];
      }
      state.lastSync[src] = now;
    } catch (e) { errors.push(`${src}: ${e.message}`); }
  }
  saveState();
  audit(req, user, { action: 'API refresh', section: '', rowName: `${changes.length} balance(s) changed`, field: by === 'auto-refresh' ? 'automatic' : 'manual', from: null, to: null, details: changes.slice(0, 500) });
  return { errors, changed: changes.length };
}
const autoMin = loadConfig().autoRefreshMinutes || 0;
if (autoMin > 0) setInterval(() => runSync(null, null).catch(() => {}), autoMin * 60e3);

/* ---------- HTTP helpers ---------- */
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((ok, fail) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 5e6) req.destroy(); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(new Error('Bad JSON')); } });
  });
}
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, code, msg) => { if (!cond) throw new HttpErr(code, msg); };
const validUsername = u => /^[a-zA-Z0-9._-]{3,32}$/.test(u || '');
const validPw = p => typeof p === 'string' && p.length >= 6;
const findRow = (sec, id) => { need(SECTIONS.includes(sec), 400, 'Unknown section'); const r = state[sec].find(x => x.id === id); need(r, 404, 'Row not found. Refresh the page.'); return r; };

/* ---------- Routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, M = req.method;
  try {
    if (M === 'GET' && (p === '/' || p === '/index.html'))
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');

    /* --- auth --- */
    if (p === '/api/me' && M === 'GET') {
      const u = getUser(req);
      return send(res, 200, { setupNeeded: users.length === 0, user: u ? publicUser(u) : null });
    }
    if (p === '/api/setup' && M === 'POST') {
      need(users.length === 0, 403, 'Setup is already done');
      const b = await readBody(req);
      need(validUsername(b.username), 400, 'User ID: 3–32 letters, numbers, dot, dash or underscore');
      need(validPw(b.password), 400, 'Password must be at least 6 characters');
      users.push({ username: b.username.toLowerCase(), name: b.name || b.username, role: 'admin', active: true, createdAt: new Date().toISOString(), ...hashPw(b.password) });
      saveUsers(); audit(req, users[0], { action: 'Admin account created', section: '', rowName: b.username });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/login' && M === 'POST') {
      const { ip } = clientInfo(req), f = failures.get(ip);
      need(!(f && f.until > Date.now()), 429, 'Too many wrong attempts. Try again in 5 minutes.');
      const b = await readBody(req);
      const u = users.find(x => x.username === String(b.username || '').toLowerCase());
      if (!u || !u.active || !checkPw(u, String(b.password || ''))) {
        const c = (f?.count || 0) + 1; failures.set(ip, { count: c, until: c >= 5 ? Date.now() + 5 * 60e3 : 0 });
        audit(req, null, { action: 'Failed login', section: '', rowName: String(b.username || '').slice(0, 40) });
        throw new HttpErr(401, u && !u.active ? 'This account is disabled' : 'Wrong user ID or password');
      }
      failures.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { username: u.username, exp: Date.now() + SESSION_HOURS * 3600e3 });
      u.lastLogin = new Date().toISOString(); saveUsers();
      audit(req, u, { action: 'Logged in', section: '' });
      return send(res, 200, { user: publicUser(u) }, 'application/json', { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}` });
    }

    const user = getUser(req);
    need(user, 401, 'Please log in');
    const isAdmin = user.role === 'admin';

    if (p === '/api/logout' && M === 'POST') {
      const m = (req.headers.cookie || '').match(/sid=([a-f0-9]+)/); if (m) sessions.delete(m[1]);
      audit(req, user, { action: 'Logged out', section: '' });
      return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
    }
    if (p === '/api/me/password' && M === 'POST') {
      const b = await readBody(req);
      need(checkPw(user, String(b.current || '')), 400, 'Current password is wrong');
      need(validPw(b.password), 400, 'New password must be at least 6 characters');
      Object.assign(user, hashPw(b.password)); saveUsers();
      audit(req, user, { action: 'Changed own password', section: '' });
      return send(res, 200, { ok: true });
    }

    /* --- sheet --- */
    if (p === '/api/state' && M === 'GET') {
      const since = +url.searchParams.get('since') || 0;
      const todayClosing = closings.find(c => c.date === today());
      const sources = Object.fromEntries(Object.entries(loadConfig().sources).map(([k, v]) => [k, !!v.enabled]));
      const meta = { version: state.version, today: today(), locked: !!todayClosing, closing: todayClosing ? { closedAt: todayClosing.closedAt, closedByName: todayClosing.closedByName } : null, sources };
      if (since && since === state.version) return send(res, 200, { unchanged: true, ...meta });
      return send(res, 200, { ...meta, state });
    }
    if (p === '/api/rows' && M === 'POST') {
      need(!isLocked(), 423, 'Today is closed. Ask an admin to reopen it.');
      const b = await readBody(req); need(SECTIONS.includes(b.section), 400, 'Unknown section');
      const row = { id: uid(), name: String(b.name || '').slice(0, 200), amount: toNumber(b.amount), note: String(b.note || '').slice(0, 500), flag: false, source: 'manual', createdBy: user.username, createdAt: new Date().toISOString(), updatedBy: user.username, updatedAt: new Date().toISOString() };
      state[b.section].push(row); saveState();
      audit(req, user, { action: 'Added row', section: b.section, rowId: row.id, rowName: row.name, field: 'amount', from: null, to: row.amount });
      return send(res, 200, { row, version: state.version });
    }
    let m = p.match(/^\/api\/rows\/(\w+)\/(\w+)$/);
    if (m && M === 'PATCH') {
      need(!isLocked(), 423, 'Today is closed. Ask an admin to reopen it.');
      const [, sec, id] = m, r = findRow(sec, id), b = await readBody(req);
      const allowed = r.source === 'api' ? ['note', 'flag'] : ['name', 'amount', 'note', 'flag'];
      if (sec === 'banks') allowed.push('source', 'apiName');
      for (const [k, v] of Object.entries(b)) {
        need(allowed.includes(k), 403, `"${k}" can't be changed on this row`);
        let nv = k === 'amount' ? toNumber(v) : k === 'flag' ? !!v : k === 'source' ? (v === 'api' ? 'api' : 'manual') : String(v ?? '').slice(0, 500);
        if (r[k] === nv) continue;
        const old = r[k]; r[k] = nv;
        if (k === 'source' && nv === 'api') { r.apiName ||= (state.apiNames.banks || []).find(x => norm(x) === norm(r.name)) || ''; applyBankApi(r); }
        if (k === 'apiName') applyBankApi(r);
        audit(req, user, { action: 'Edited', section: sec, rowId: r.id, rowName: r.name, field: k, from: old ?? null, to: nv });
      }
      r.updatedBy = user.username; r.updatedAt = new Date().toISOString(); saveState();
      return send(res, 200, { row: r, version: state.version });
    }
    if (m && M === 'DELETE') {
      need(isAdmin, 403, 'Only an admin can delete rows');
      need(!isLocked(), 423, 'Today is closed. Reopen it first.');
      const [, sec, id] = m, r = findRow(sec, id);
      need(r.source !== 'api', 400, 'API rows come back on the next refresh and can\'t be deleted');
      state[sec] = state[sec].filter(x => x.id !== id); saveState();
      audit(req, user, { action: 'Deleted row', section: sec, rowId: id, rowName: r.name, field: 'amount', from: r.amount, to: null });
      return send(res, 200, { ok: true, version: state.version });
    }
    if (p === '/api/sync' && M === 'POST') return send(res, 200, await runSync(req, user).catch(e => { throw new HttpErr(400, e.message); }));

    /* --- activity log --- */
    if (p === '/api/audit' && M === 'GET') {
      const rowId = url.searchParams.get('rowId');
      if (rowId) {
        const all = fs.readdirSync(AUDIT_DIR).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => readAudit(f.replace('.jsonl', '')));
        return send(res, 200, all.filter(e => e.rowId === rowId).reverse());
      }
      return send(res, 200, readAudit(url.searchParams.get('date') || today()).reverse());
    }

    /* --- day-end closing --- */
    if (p === '/api/closings' && M === 'GET')
      return send(res, 200, closings.map(({ state, ...c }) => c).sort((a, b) => b.date.localeCompare(a.date)));
    m = p.match(/^\/api\/closings\/(\d{4}-\d{2}-\d{2})$/);
    if (m && M === 'GET') { const c = closings.find(x => x.date === m[1]); need(c, 404, 'No closing for that date'); return send(res, 200, c); }
    if (p === '/api/closings' && M === 'POST') {
      need(!isLocked(), 409, 'Today is already closed');
      const b = await readBody(req), date = today();
      const prev = closings.filter(c => c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
      const snap = Object.fromEntries(SECTIONS.map(k => [k, state[k]]));
      const c = { date, closedAt: new Date().toISOString(), closedBy: user.username, closedByName: user.name, remarks: String(b.remarks || '').slice(0, 1000), totals: totals(), prevDate: prev?.date || null, prevDiff: prev ? prev.totals.diff : null, entries: readAudit(date).filter(e => e.section).length, state: JSON.parse(JSON.stringify(snap)) };
      closings.push(c); saveClosings(); state.version++; writeJSON(F.state, state);
      audit(req, user, { action: 'Day closed', section: '', rowName: date, field: 'difference', from: null, to: c.totals.diff });
      const { state: _, ...out } = c; return send(res, 200, out);
    }
    if (m && M === 'DELETE') {
      need(isAdmin, 403, 'Only an admin can reopen a day');
      const c = closings.find(x => x.date === m[1]); need(c, 404, 'No closing for that date');
      closings = closings.filter(x => x.date !== m[1]); saveClosings(); state.version++; writeJSON(F.state, state);
      audit(req, user, { action: 'Day reopened', section: '', rowName: m[1], field: 'difference', from: c.totals.diff, to: null });
      return send(res, 200, { ok: true });
    }

    /* --- users (admin) --- */
    if (p.startsWith('/api/users')) need(isAdmin, 403, 'Admins only');
    if (p === '/api/users' && M === 'GET') return send(res, 200, users.map(publicUser));
    if (p === '/api/users' && M === 'POST') {
      const b = await readBody(req), un = String(b.username || '').toLowerCase();
      need(validUsername(un), 400, 'User ID: 3–32 letters, numbers, dot, dash or underscore');
      need(!users.some(u => u.username === un), 409, 'That user ID already exists');
      need(validPw(b.password), 400, 'Password must be at least 6 characters');
      const role = b.role === 'admin' ? 'admin' : 'staff';
      users.push({ username: un, name: String(b.name || un).slice(0, 80), role, active: true, createdAt: new Date().toISOString(), ...hashPw(b.password) }); saveUsers();
      audit(req, user, { action: 'User created', section: '', rowName: un, field: 'role', from: null, to: role });
      return send(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/users\/([\w.-]+)$/);
    if (m && M === 'PATCH') {
      const u = users.find(x => x.username === m[1]); need(u, 404, 'User not found');
      const b = await readBody(req), admins = users.filter(x => x.role === 'admin' && x.active);
      if ('role' in b || 'active' in b) {
        const losesAdmin = (b.role && b.role !== 'admin') || b.active === false;
        need(!(u.role === 'admin' && losesAdmin && admins.length <= 1), 400, 'Keep at least one active admin');
      }
      if (b.password) { need(validPw(b.password), 400, 'Password must be at least 6 characters'); Object.assign(u, hashPw(b.password)); audit(req, user, { action: 'Password reset', section: '', rowName: u.username }); }
      if (b.role) { const r = b.role === 'admin' ? 'admin' : 'staff'; audit(req, user, { action: 'Role changed', section: '', rowName: u.username, field: 'role', from: u.role, to: r }); u.role = r; }
      if ('active' in b) { u.active = !!b.active; audit(req, user, { action: u.active ? 'User enabled' : 'User disabled', section: '', rowName: u.username });
        if (!u.active) for (const [t, s] of sessions) if (s.username === u.username) sessions.delete(t); }
      if (b.name) u.name = String(b.name).slice(0, 80);
      saveUsers(); return send(res, 200, publicUser(u));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.code && e.code < 600 ? e.code : 500, { error: e.message });
  }
});

const port = process.env.PORT || loadConfig().port || 3000;
server.listen(port, () => console.log(`Reconciliation running at http://localhost:${port}  (business date ${today()}, ${TZ()})`));
