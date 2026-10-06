// Balance Reconciliation server v3
// Logins, API connections with account selection, sheet, recon, P&L, day-end closing, activity log.
// No dependencies. Node 18+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const seed = require('./seed');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const AUDIT_DIR = path.join(DATA, 'audit');
const F = {
  state: path.join(DATA, 'state.json'), users: path.join(DATA, 'users.json'), closings: path.join(DATA, 'closings.json'),
  conns: path.join(DATA, 'connections.json'), settings: path.join(DATA, 'settings.json'), pnl: path.join(DATA, 'pnl.json'),
};
for (const d of [DATA, AUDIT_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); };
const uid = () => crypto.randomBytes(6).toString('hex');
const config = readJSON(path.join(ROOT, 'config.json'), {});
const SECTIONS = ['payout', 'payin', 'other', 'banks', 'uses', 'recovery'];
const API_TARGETS = ['payout', 'payin', 'banks'];
const SECTION_NAMES = { payout: 'Payout wallets', payin: 'Payin wallets', other: 'Other party payments', banks: 'Bank accounts', uses: 'Other uses', recovery: 'Recovery' };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const toNumber = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const rowLabel = r => [r.bank, r.name, r.accountNo ? 'A/c ' + r.accountNo : ''].filter(Boolean).join(' – ');
const getPath = (o, p) => !p ? o : String(p).split('.').reduce((x, k) => (x == null ? x : x[k]), o);

/* ---------- Settings ---------- */
const DEFAULT_SETTINGS = {
  companyName: 'Balance Reconciliation', timezone: config.timezone || 'Asia/Kolkata',
  autoRefreshMinutes: config.autoRefreshMinutes || 0, alertThreshold: 1000000,
  incomeCategories: ['Commission', 'Service charges', 'Interest received', 'Other income'],
  expenseCategories: ['Bank charges', 'Gateway charges', 'Salary', 'Rent', 'Office expense', 'Interest paid', 'Write-off', 'Other expense'],
};
let settings = { ...DEFAULT_SETTINGS, ...readJSON(F.settings, {}) };
const saveSettings = () => writeJSON(F.settings, settings);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/* ---------- State ---------- */
let state = readJSON(F.state, null);
if (!state || !state.payout) state = { ...seed(), version: 1 };
state.version ??= 1;
// migrate rows from older versions: API rows without a connection become manual until re-linked
for (const k of SECTIONS) for (const r of state[k] || []) if (r.source === 'api' && !r.connId) { r.source = 'manual'; delete r.apiName; delete r.stale; }
delete state.apiNames; delete state.lastSync;
writeJSON(F.state, state);
const saveState = () => { state.version++; writeJSON(F.state, state); };
function totals(s = state) {
  const sum = k => (s[k] || []).reduce((a, r) => a + (+r.amount || 0), 0);
  const t = Object.fromEntries(SECTIONS.map(k => [k, sum(k)]));
  t.grand = t.payout + t.payin + t.other; t.diff = t.grand - t.banks - t.uses; return t;
}

/* ---------- API connections ---------- */
let conns = readJSON(F.conns, null);
if (!conns) { // migrate sources from config.json
  conns = Object.entries(config.sources || {}).filter(([k, v]) => v.enabled && API_TARGETS.includes(k)).map(([k, v]) => ({
    id: uid(), name: `${k} API`, target: k, url: v.url, method: v.method || 'GET', headers: v.headers || {}, body: v.body || null,
    listPath: v.listPath || '', nameField: v.nameField || 'name', balanceField: v.balanceField || 'balance', idField: '',
    enabled: true, autoIncludeNew: true, selected: {}, known: [], lastSync: null, lastError: null, lastCount: 0, createdAt: new Date().toISOString(),
  }));
  writeJSON(F.conns, conns);
}
const saveConns = () => writeJSON(F.conns, conns);
const MASK = '••••••';
const maskHeaders = h => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, String(v).length > 6 ? MASK + String(v).slice(-4) : MASK]));
const unmaskHeaders = (incoming, old) => Object.fromEntries(Object.entries(incoming || {}).filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), String(v).startsWith(MASK) ? (old?.[k] ?? '') : String(v)]));
const connPublic = c => ({ ...c, headers: maskHeaders(c.headers) });
const connSummary = c => ({
  id: c.id, name: c.name, target: c.target, enabled: c.enabled, lastSync: c.lastSync, lastError: c.lastError, lastCount: c.lastCount,
  selectedCount: Object.values(c.selected || {}).filter(Boolean).length, knownCount: (c.known || []).length,
  newCount: (c.known || []).filter(a => !(a.key in (c.selected || {}))).length,
  reviewCount: (c.known || []).filter(a => a.review).length, dupCount: (c.known || []).filter(a => a.dup).length,
});

function findArrays(obj, prefix = '', depth = 0, out = []) {
  if (Array.isArray(obj)) { if (obj.length && typeof obj[0] === 'object') out.push(prefix); return out; }
  if (obj && typeof obj === 'object' && depth < 4) for (const [k, v] of Object.entries(obj)) findArrays(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  return out;
}
function flatKeys(o, prefix = '', out = [], depth = 0) {
  if (o && typeof o === 'object' && !Array.isArray(o) && depth < 3) for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatKeys(v, p, out, depth + 1); else out.push(p);
  }
  return out;
}
async function callApi(c) {
  const opts = { method: c.method || 'GET', headers: { Accept: 'application/json', ...(c.headers || {}) }, signal: AbortSignal.timeout(25000) };
  if (c.body && opts.method !== 'GET') { opts.body = typeof c.body === 'string' ? c.body : JSON.stringify(c.body); opts.headers['Content-Type'] ??= 'application/json'; }
  let res;
  try { res = await fetch(c.url, opts); } catch (e) { throw new Error(`Could not reach ${c.url}: ${e.cause?.code || e.message}`); }
  const text = await res.text();
  if (!res.ok) throw new Error(`API returned HTTP ${res.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { throw new Error('API did not return JSON: ' + text.slice(0, 120)); }
}
function extract(c, json) {
  const list = getPath(json, c.listPath);
  if (!Array.isArray(list)) throw new Error(`"${c.listPath || '(whole response)'}" is not a list. Lists found: ${findArrays(json).map(p => p || '(whole response)').join(', ') || 'none'}`);
  const isBank = c.target === 'banks';
  const out = list.map(i => {
    const name = String(getPath(i, c.nameField) ?? '').trim();
    const bank = isBank ? String((c.bankNameField ? getPath(i, c.bankNameField) : null) ?? c.bankName ?? '').trim() : '';
    const accountNo = isBank && c.accountNoField ? String(getPath(i, c.accountNoField) ?? '').trim() : '';
    const id = c.idField ? String(getPath(i, c.idField) ?? '').trim() : '';
    const key = id || (accountNo ? `${norm(bank)}|${accountNo}` : name);
    return { key, name: name || accountNo || key, bank, accountNo, balance: toNumber(getPath(i, c.balanceField)) };
  }).filter(a => a.key);
  // Same key twice (e.g. two accounts with the same name and no account number): keep both, numbered in API order
  const seen = {};
  for (const a of out) { seen[a.key] = (seen[a.key] || 0) + 1; if (seen[a.key] > 1) { a.key += '#' + seen[a.key]; a.dup = true; } }
  return out;
}

// Put the selected accounts of a connection into the sheet.
// Matching order for rows not yet linked: account number, then bank + name, then name (only if exactly one row has it).
function applyConnection(c, present, req, user) {
  const target = state[c.target], now = new Date().toISOString(), changes = [], claimed = new Set();
  const knownKeys = new Set(c.known.map(a => a.key));
  const sameBank = (x, acc) => !acc.bank || !x.bank || norm(x.bank) === norm(acc.bank);
  for (const acc of c.known) {
    if (!c.selected[acc.key]) continue;
    let r = target.find(x => x.connId === c.id && x.extKey === acc.key && !claimed.has(x.id));
    if (!r) {
      const cands = target.filter(x => !claimed.has(x.id) && ((x.connId === c.id && !knownKeys.has(x.extKey)) || (!x.connId && x.source !== 'api')));
      r = (acc.accountNo && cands.find(x => x.accountNo && String(x.accountNo).trim() === acc.accountNo && sameBank(x, acc)))
        || (acc.bank && cands.find(x => !x.accountNo && x.bank && norm(x.bank) === norm(acc.bank) && norm(x.name) === norm(acc.name)))
        || (() => { const m = cands.filter(x => !x.accountNo && norm(x.name) === norm(acc.name) && sameBank(x, acc)); return m.length === 1 ? m[0] : null; })();
      if (r) { changes.push({ section: c.target, rowName: rowLabel({ ...r, bank: acc.bank || r.bank, accountNo: acc.accountNo || r.accountNo }), from: r.amount, to: acc.balance, what: 'linked' }); Object.assign(r, { source: 'api', connId: c.id, extKey: acc.key }); }
      else { r = { id: uid(), name: acc.name, amount: acc.balance, note: '', flag: false, source: 'api', connId: c.id, extKey: acc.key, createdBy: 'API', createdAt: now }; target.push(r); changes.push({ section: c.target, rowName: rowLabel(acc), from: null, to: acc.balance, what: 'added' }); }
    }
    claimed.add(r.id);
    if (c.target === 'banks') { if (acc.bank) r.bank = acc.bank; if (acc.accountNo) r.accountNo = acc.accountNo; }
    const isPresent = present.has(acc.key);
    if (isPresent && r.amount !== acc.balance) { if (!changes.some(x => x.rowName === rowLabel(r))) changes.push({ section: c.target, rowName: rowLabel(r), from: r.amount, to: acc.balance, what: 'balance' }); r.amount = acc.balance; r.updatedBy = 'API'; r.updatedAt = now; }
    r.stale = !isPresent;
  }
  state[c.target] = target.filter(r => {
    if (r.connId !== c.id || claimed.has(r.id)) return true;
    changes.push({ section: c.target, rowName: rowLabel(r), from: r.amount, to: null, what: 'removed' }); return false;
  });
  return changes;
}
// After a field-mapping change, re-tick accounts that were ticked before.
// Account number match is exact. Name-only matches are used only when they can't pick up an extra account.
function carryMatch(a, accounts, prev) {
  const bankOk = (x, y) => !x.bank || !y.bank || norm(x.bank) === norm(y.bank);
  if (a.accountNo) { const p = prev.find(p => p.accountNo && p.accountNo === a.accountNo && bankOk(p, a)); if (p) return p.selected; }
  const oldAll = prev.filter(p => !p.accountNo && norm(p.name) === norm(a.name) && bankOk(p, a));
  if (!oldAll.length) return false;
  const oldSel = oldAll.filter(p => p.selected).length;
  const newAll = accounts.filter(x => norm(x.name) === norm(a.name) && bankOk(x, a)).length;
  if (oldSel === 0) return false;
  if (oldSel === oldAll.length && newAll === oldAll.length) return true;   // all of them were ticked
  if (oldAll.length === 1 && newAll === 1) return true;                    // one-to-one
  (a.review = true);                                                       // ambiguous: leave unticked for the admin
  return false;
}
async function syncConnection(c, req, user) {
  try {
    const accounts = extract(c, await callApi(c));
    const now = new Date().toISOString(), byKey = new Map(c.known.map(a => [a.key, a]));
    let newOnes = 0;
    for (const a of accounts) {
      const k = byKey.get(a.key);
      if (k) Object.assign(k, { name: a.name, bank: a.bank, accountNo: a.accountNo, dup: !!a.dup, balance: a.balance, lastSeen: now });
      else {
        c.known.push({ ...a, lastSeen: now, firstSeen: now }); newOnes++;
        const carry = c.carrySelection ? carryMatch(a, accounts, c.carrySelection) : false;
        if (a.review) c.known[c.known.length - 1].review = true;
        if (c.autoIncludeNew || carry) c.selected[a.key] = true;
      }
    }
    c.lastSync = now; c.lastError = null; c.lastCount = accounts.length; delete c.carrySelection;
    const changes = applyConnection(c, new Set(accounts.map(a => a.key)), req, user);
    return { ok: true, changes, newOnes };
  } catch (e) { c.lastError = e.message; return { ok: false, error: e.message, changes: [] }; }
}
async function syncAll(req, user, onlyId) {
  if (isLocked()) throw new HttpErr(423, 'Today is closed. Ask an admin to reopen it before refreshing.');
  const list = conns.filter(c => c.enabled && (!onlyId || c.id === onlyId));
  const results = [];
  for (const c of list) results.push({ name: c.name, ...(await syncConnection(c, req, user)) });
  saveConns(); saveState();
  const changes = results.flatMap(r => r.changes), errors = results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`);
  audit(req, user, { action: 'API refresh', rowName: `${changes.length} change(s)${errors.length ? `, ${errors.length} failed` : ''}`, field: user ? 'manual' : 'automatic', details: changes.slice(0, 1000) });
  return { changed: changes.length, errors, newAccounts: results.reduce((a, r) => a + (r.newOnes || 0), 0) };
}
let lastAuto = Date.now();
setInterval(() => {
  const m = +settings.autoRefreshMinutes || 0;
  if (!m || Date.now() - lastAuto < m * 60e3 || isLocked() || !conns.some(c => c.enabled)) return;
  lastAuto = Date.now(); syncAll(null, null).catch(() => {});
}, 30e3);

/* ---------- Users & sessions ---------- */
let users = readJSON(F.users, []);
const saveUsers = () => writeJSON(F.users, users);
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPw = (u, pw) => crypto.timingSafeEqual(crypto.scryptSync(pw, u.salt, 64), Buffer.from(u.hash, 'hex'));
const publicUser = u => ({ username: u.username, name: u.name, role: u.role, active: u.active, lastLogin: u.lastLogin || null, createdAt: u.createdAt });
const sessions = new Map(), failures = new Map();
const SESSION_HOURS = 12;
function getUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  const s = m && sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { if (m) sessions.delete(m[1]); return null; }
  const u = users.find(x => x.username === s.username && x.active);
  if (u) s.exp = Date.now() + SESSION_HOURS * 3600e3;
  return u || null;
}

/* ---------- Activity log ---------- */
function clientInfo(req) {
  if (!req) return { ip: 'server', device: 'Automatic' };
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
  const ua = req.headers['user-agent'] || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { ip: ip === '::1' ? '127.0.0.1' : ip, device: `${br} on ${os}` };
}
function audit(req, user, entry) {
  const rec = { at: new Date().toISOString(), date: today(), user: user?.username || 'system', userName: user?.name || 'System', role: user?.role || '-', ...clientInfo(req), section: '', ...entry };
  fs.appendFileSync(path.join(AUDIT_DIR, rec.date + '.jsonl'), JSON.stringify(rec) + '\n');
}
const readAudit = date => { try { return fs.readFileSync(path.join(AUDIT_DIR, date + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };

/* ---------- P&L entries & closings ---------- */
let pnl = readJSON(F.pnl, []);
const savePnl = () => writeJSON(F.pnl, pnl);
const pnlTotals = date => { const d = pnl.filter(e => e.date === date); const income = d.filter(e => e.type === 'income').reduce((a, e) => a + e.amount, 0), expense = d.filter(e => e.type === 'expense').reduce((a, e) => a + e.amount, 0); return { income, expense, net: income - expense }; };
let closings = readJSON(F.closings, []);
const saveClosings = () => writeJSON(F.closings, closings);
const isClosed = d => closings.some(c => c.date === d);
const isLocked = () => isClosed(today());
const BACKUP_DIR = path.join(DATA, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

/* ---------- HTTP helpers ---------- */
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, code, msg) => { if (!cond) throw new HttpErr(code, msg); };
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
const readBody = req => new Promise((ok, fail) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 5e6) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new HttpErr(400, 'Bad JSON')); } });
});
const validUsername = u => /^[a-zA-Z0-9._-]{3,32}$/.test(u || '');
const validPw = p => typeof p === 'string' && p.length >= 6;
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const findRow = (sec, id) => { need(SECTIONS.includes(sec), 400, 'Unknown section'); const r = state[sec].find(x => x.id === id); need(r, 404, 'Row not found. Refresh the page.'); return r; };
function connInput(b, old = {}) {
  need(String(b.name || '').trim(), 400, 'Give the connection a name');
  need(API_TARGETS.includes(b.target), 400, 'Pick where the balances go');
  need(/^https?:\/\//.test(b.url || ''), 400, 'URL must start with http:// or https://');
  need(String(b.nameField || '').trim() && String(b.balanceField || '').trim(), 400, 'Name field and balance field are required');
  let body = b.body ?? null;
  if (typeof body === 'string' && body.trim()) { try { body = JSON.parse(body); } catch { need(false, 400, 'Request body must be valid JSON'); } } else if (typeof body === 'string') body = null;
  return {
    name: String(b.name).trim().slice(0, 80), target: b.target, url: String(b.url).trim(), method: ['GET', 'POST'].includes(b.method) ? b.method : 'GET',
    headers: unmaskHeaders(b.headers, old.headers), body, listPath: String(b.listPath || '').trim(), nameField: String(b.nameField).trim(),
    balanceField: String(b.balanceField).trim(), idField: String(b.idField || '').trim(), enabled: b.enabled !== false, autoIncludeNew: !!b.autoIncludeNew,
    bankName: String(b.bankName || '').trim().slice(0, 80), bankNameField: String(b.bankNameField || '').trim(), accountNoField: String(b.accountNoField || '').trim(),
  };
}

/* ---------- Routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, M = req.method, q = k => url.searchParams.get(k);
  try {
    if (M === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');

    /* auth */
    if (p === '/api/me' && M === 'GET') { const u = getUser(req); return send(res, 200, { setupNeeded: !users.length, user: u ? publicUser(u) : null, companyName: settings.companyName }); }
    if (p === '/api/setup' && M === 'POST') {
      need(!users.length, 403, 'Setup is already done');
      const b = await readBody(req);
      need(validUsername(b.username), 400, 'User ID: 3–32 letters, numbers, dot, dash or underscore');
      need(validPw(b.password), 400, 'Password must be at least 6 characters');
      users.push({ username: b.username.toLowerCase(), name: b.name || b.username, role: 'admin', active: true, createdAt: new Date().toISOString(), ...hashPw(b.password) });
      saveUsers(); audit(req, users[0], { action: 'Admin account created', rowName: b.username });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/login' && M === 'POST') {
      const { ip } = clientInfo(req), f = failures.get(ip);
      need(!(f && f.until > Date.now()), 429, 'Too many wrong attempts. Try again in 5 minutes.');
      const b = await readBody(req), u = users.find(x => x.username === String(b.username || '').toLowerCase());
      if (!u || !u.active || !checkPw(u, String(b.password || ''))) {
        const c = (f?.count || 0) + 1; failures.set(ip, { count: c, until: c >= 5 ? Date.now() + 5 * 60e3 : 0 });
        audit(req, null, { action: 'Failed login', rowName: String(b.username || '').slice(0, 40) });
        throw new HttpErr(401, u && !u.active ? 'This account is disabled' : 'Wrong user ID or password');
      }
      failures.delete(ip);
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { username: u.username, exp: Date.now() + SESSION_HOURS * 3600e3 });
      u.lastLogin = new Date().toISOString(); saveUsers(); audit(req, u, { action: 'Logged in' });
      return send(res, 200, { user: publicUser(u) }, 'application/json', { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}` });
    }

    const user = getUser(req);
    need(user, 401, 'Please log in');
    const isAdmin = user.role === 'admin';
    let m;

    if (p === '/api/logout' && M === 'POST') {
      const mm = (req.headers.cookie || '').match(/sid=([a-f0-9]+)/); if (mm) sessions.delete(mm[1]);
      audit(req, user, { action: 'Logged out' });
      return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
    }
    if (p === '/api/me/password' && M === 'POST') {
      const b = await readBody(req);
      need(checkPw(user, String(b.current || '')), 400, 'Current password is wrong');
      need(validPw(b.password), 400, 'New password must be at least 6 characters');
      Object.assign(user, hashPw(b.password)); saveUsers(); audit(req, user, { action: 'Changed own password' });
      return send(res, 200, { ok: true });
    }

    /* live state */
    if (p === '/api/state' && M === 'GET') {
      const t = today(), c = closings.find(x => x.date === t);
      const metaOut = { version: state.version, today: t, locked: !!c, closing: c ? { closedAt: c.closedAt, closedByName: c.closedByName } : null,
        connections: conns.map(connSummary), settings: { ...settings }, pnlToday: pnlTotals(t), activityToday: readAudit(t).filter(e => e.section).length };
      if (+q('since') && +q('since') === state.version) return send(res, 200, { unchanged: true, ...metaOut });
      return send(res, 200, { ...metaOut, state });
    }

    /* sheet rows */
    if (p === '/api/rows' && M === 'POST') {
      need(!isLocked(), 423, 'Today is closed. Ask an admin to reopen it.');
      const b = await readBody(req); need(SECTIONS.includes(b.section), 400, 'Unknown section');
      const now = new Date().toISOString();
      const row = { id: uid(), name: String(b.name || '').slice(0, 200), ...(b.section === 'banks' ? { bank: String(b.bank || '').slice(0, 80), accountNo: String(b.accountNo || '').trim().slice(0, 40) } : {}), amount: toNumber(b.amount), note: String(b.note || '').slice(0, 500), flag: false, source: 'manual', createdBy: user.username, createdAt: now, updatedBy: user.username, updatedAt: now };
      state[b.section].push(row); saveState();
      audit(req, user, { action: 'Added row', section: b.section, rowId: row.id, rowName: rowLabel(row), field: 'amount', from: null, to: row.amount });
      return send(res, 200, { row, version: state.version });
    }
    if ((m = p.match(/^\/api\/rows\/(\w+)\/(\w+)$/)) && M === 'PATCH') {
      need(!isLocked(), 423, 'Today is closed. Ask an admin to reopen it.');
      const [, sec, id] = m, r = findRow(sec, id), b = await readBody(req);
      const allowed = r.source === 'api' ? ['note', 'flag'] : ['name', 'amount', 'note', 'flag'];
      if (sec === 'banks' && r.source !== 'api') allowed.push('bank', 'accountNo');
      if (sec === 'banks' && r.source === 'api') { if (!r.bank) allowed.push('bank'); if (!r.accountNo) allowed.push('accountNo'); }
      for (const [k, v] of Object.entries(b)) {
        need(allowed.includes(k), 403, r.source === 'api' ? 'API balances can\'t be typed over. Change the selection in API connections.' : `"${k}" can't be changed`);
        const nv = k === 'amount' ? toNumber(v) : k === 'flag' ? !!v : String(v ?? '').trim().slice(0, 500);
        if (r[k] === nv) continue;
        audit(req, user, { action: 'Edited', section: sec, rowId: r.id, rowName: rowLabel(r), field: k, from: r[k] ?? null, to: nv });
        r[k] = nv;
      }
      r.updatedBy = user.username; r.updatedAt = new Date().toISOString(); saveState();
      return send(res, 200, { row: r, version: state.version });
    }
    if (m && M === 'DELETE') {
      need(isAdmin, 403, 'Only an admin can delete rows'); need(!isLocked(), 423, 'Today is closed. Reopen it first.');
      const [, sec, id] = m, r = findRow(sec, id);
      need(r.source !== 'api', 400, 'To remove an API account, untick it in API connections');
      state[sec] = state[sec].filter(x => x.id !== id); saveState();
      audit(req, user, { action: 'Deleted row', section: sec, rowId: id, rowName: rowLabel(r), field: 'amount', from: r.amount, to: null });
      return send(res, 200, { ok: true, version: state.version });
    }
    if (p === '/api/sync' && M === 'POST') return send(res, 200, await syncAll(req, user, q('id')));

    /* API connections (admin) */
    if (p.startsWith('/api/connections')) need(isAdmin, 403, 'Admins only');
    if (p === '/api/connections' && M === 'GET') return send(res, 200, conns.map(connPublic));
    if (p === '/api/connections/test' && M === 'POST') {
      const b = await readBody(req), old = conns.find(c => c.id === b.id) || {};
      const c = { ...connInput({ ...b, name: b.name || 'test', target: API_TARGETS.includes(b.target) ? b.target : 'payout', nameField: b.nameField || 'x', balanceField: b.balanceField || 'x' }, old), nameField: b.nameField || '', balanceField: b.balanceField || '' };
      const json = await callApi(c).catch(e => { throw new HttpErr(400, e.message); });
      const arrays = findArrays(json), list = getPath(json, c.listPath), first = Array.isArray(list) ? list[0] : getPath(json, arrays[0])?.[0];
      let accounts = [], mapError = null;
      if (c.nameField && c.balanceField) { try { accounts = extract(c, json).slice(0, 2000); } catch (e) { mapError = e.message; } }
      return send(res, 200, { arrays, fields: first ? flatKeys(first) : [], sample: first ? JSON.stringify(first, null, 2).slice(0, 2500) : null, accounts, mapError, duplicates: accounts.filter(a => a.dup).length });
    }
    if (p === '/api/connections' && M === 'POST') {
      const b = await readBody(req), c = { id: uid(), ...connInput(b), selected: {}, known: [], lastSync: null, lastError: null, lastCount: 0, createdAt: new Date().toISOString() };
      conns.push(c); saveConns(); audit(req, user, { action: 'API connection added', rowName: c.name, field: 'target', to: c.target });
      return send(res, 200, connPublic(c));
    }
    if ((m = p.match(/^\/api\/connections\/(\w+)$/))) {
      const c = conns.find(x => x.id === m[1]); need(c, 404, 'Connection not found');
      if (M === 'PUT') {
        const b = await readBody(req), next = connInput(b, c);
        need(next.target === c.target || !state[c.target].some(r => r.connId === c.id), 400, 'Untick all accounts before changing where this connection sends balances');
        const mapKeys = ['listPath', 'nameField', 'idField', 'bankName', 'bankNameField', 'accountNoField'];
        if (mapKeys.some(k => (next[k] || '') !== (c[k] || '')) && c.known.length) {
          // account keys change with the mapping: keep what was ticked and re-tick it on the next refresh
          c.carrySelection = c.known.map(a => ({ name: a.name, bank: a.bank || '', accountNo: a.accountNo || '', selected: !!c.selected[a.key] }));
          c.known = []; c.selected = {};
        }
        Object.assign(c, next); saveConns(); audit(req, user, { action: 'API connection edited', rowName: c.name });
        return send(res, 200, connPublic(c));
      }
      if (M === 'DELETE') {
        let n = 0; for (const r of state[c.target]) if (r.connId === c.id) { r.source = 'manual'; delete r.connId; delete r.extKey; delete r.stale; n++; }
        conns = conns.filter(x => x !== c); saveConns(); saveState();
        audit(req, user, { action: 'API connection deleted', rowName: c.name, field: 'rows kept as manual', to: n });
        return send(res, 200, { ok: true, keptAsManual: n });
      }
    }
    if ((m = p.match(/^\/api\/connections\/(\w+)\/selection$/)) && M === 'POST') {
      need(!isLocked(), 423, 'Today is closed. Reopen it before changing what is in the sheet.');
      const c = conns.find(x => x.id === m[1]); need(c, 404, 'Connection not found');
      const b = await readBody(req);
      for (const a of c.known) { c.selected[a.key] = b.selected?.[a.key] === true; delete a.review; }
      if ('autoIncludeNew' in b) c.autoIncludeNew = !!b.autoIncludeNew;
      const present = new Set(c.known.filter(a => a.lastSeen === c.lastSync).map(a => a.key));
      const changes = applyConnection(c, present, req, user); saveConns(); saveState();
      audit(req, user, { action: 'API selection changed', rowName: c.name, field: 'selected', to: Object.values(c.selected).filter(Boolean).length, details: changes });
      return send(res, 200, { ok: true, changes: changes.length });
    }

    /* activity log */
    if (p === '/api/audit' && M === 'GET') {
      if (q('rowId')) {
        const all = fs.readdirSync(AUDIT_DIR).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => readAudit(f.replace('.jsonl', '')));
        return send(res, 200, all.filter(e => e.rowId === q('rowId')).reverse());
      }
      return send(res, 200, readAudit(validDate(q('date')) ? q('date') : today()).reverse());
    }

    /* P&L */
    if (p === '/api/pnl' && M === 'GET') {
      const from = validDate(q('from')) ? q('from') : '0000', to = validDate(q('to')) ? q('to') : '9999';
      return send(res, 200, pnl.filter(e => e.date >= from && e.date <= to).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
    }
    if (p === '/api/pnl' && M === 'POST') {
      const b = await readBody(req), date = validDate(b.date) ? b.date : today();
      need(['income', 'expense'].includes(b.type), 400, 'Pick income or expense');
      need(toNumber(b.amount) > 0, 400, 'Enter an amount above zero');
      need(!isClosed(date) || isAdmin, 423, `${date} is closed. Only an admin can add entries to a closed day.`);
      const now = new Date().toISOString();
      const e = { id: uid(), date, type: b.type, category: String(b.category || 'Other').slice(0, 60), party: String(b.party || '').slice(0, 120), amount: toNumber(b.amount), note: String(b.note || '').slice(0, 500), createdBy: user.username, createdByName: user.name, createdAt: now };
      pnl.push(e); savePnl();
      audit(req, user, { action: `Added ${e.type}`, section: 'pnl', rowId: e.id, rowName: `${e.category}${e.party ? ' – ' + e.party : ''}`, field: 'amount', from: null, to: e.amount });
      return send(res, 200, e);
    }
    if ((m = p.match(/^\/api\/pnl\/(\w+)$/))) {
      const e = pnl.find(x => x.id === m[1]); need(e, 404, 'Entry not found');
      need(!isClosed(e.date) || isAdmin, 423, `${e.date} is closed. Only an admin can change it.`);
      if (M === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['type', 'category', 'party', 'amount', 'note', 'date']) if (k in b) {
          let v = k === 'amount' ? toNumber(b[k]) : String(b[k] ?? '').slice(0, 500);
          if (k === 'type') need(['income', 'expense'].includes(v), 400, 'Pick income or expense');
          if (k === 'date') need(validDate(v) && (!isClosed(v) || isAdmin), 400, 'That date is invalid or closed');
          if (e[k] === v) continue;
          audit(req, user, { action: `Edited ${e.type}`, section: 'pnl', rowId: e.id, rowName: e.category, field: k, from: e[k], to: v }); e[k] = v;
        }
        savePnl(); return send(res, 200, e);
      }
      if (M === 'DELETE') {
        need(isAdmin, 403, 'Only an admin can delete entries');
        pnl = pnl.filter(x => x !== e); savePnl();
        audit(req, user, { action: `Deleted ${e.type}`, section: 'pnl', rowId: e.id, rowName: e.category, field: 'amount', from: e.amount, to: null });
        return send(res, 200, { ok: true });
      }
    }

    /* clear today's data (admin) */
    if (p === '/api/clear-today' && M === 'POST') {
      need(isAdmin, 403, 'Only an admin can clear today\'s data');
      need(!isLocked(), 423, 'Today is closed. Reopen it first.');
      const b = await readBody(req), date = today();
      need(b.confirm === 'CLEAR', 400, 'Type CLEAR to confirm');
      need(['zero', 'restore'].includes(b.mode), 400, 'Pick how to clear');
      const secs = (b.sections || []).filter(k => SECTIONS.includes(k));
      need(secs.length || b.pnl, 400, 'Pick at least one section');
      const prev = closings.filter(c => c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
      need(b.mode !== 'restore' || prev, 400, 'There is no earlier closing to go back to');
      // backup first, so it can be undone
      const backup = { at: new Date().toISOString(), date, by: user.username, byName: user.name, mode: b.mode,
        sections: Object.fromEntries(secs.map(k => [k, JSON.parse(JSON.stringify(state[k]))])), pnl: b.pnl ? pnl.filter(e => e.date === date) : [] };
      const file = `clear-${date}-${Date.now()}.json`;
      writeJSON(path.join(BACKUP_DIR, file), backup);
      const before = totals(); let rowsChanged = 0;
      const now = new Date().toISOString();
      for (const k of secs) {
        if (b.mode === 'zero') {
          for (const r of state[k]) {
            if (r.source === 'api') continue; // API balances come from the API
            if (r.amount) { r.amount = 0; rowsChanged++; }
            if (b.notes && (r.note || r.flag)) { r.note = ''; r.flag = false; rowsChanged++; }
            r.updatedBy = user.username; r.updatedAt = now;
          }
        } else {
          rowsChanged += state[k].length;
          state[k] = JSON.parse(JSON.stringify(prev.state[k] || []));
        }
      }
      const removed = b.pnl ? pnl.filter(e => e.date === date).length : 0;
      if (b.pnl) { pnl = pnl.filter(e => e.date !== date); savePnl(); }
      state.lastClear = { date, at: backup.at, by: user.username, byName: user.name, file, mode: b.mode, sections: secs, pnlRemoved: removed, fromDate: b.mode === 'restore' ? prev.date : null };
      saveState();
      const after = totals();
      audit(req, user, { action: b.mode === 'zero' ? 'Cleared today\'s amounts' : `Went back to closing of ${prev.date}`, rowName: secs.map(k => SECTION_NAMES[k]).join(', ') + (removed ? ` + ${removed} P&L entries` : ''), field: 'difference', from: before.diff, to: after.diff });
      return send(res, 200, { ok: true, rowsChanged, pnlRemoved: removed, version: state.version });
    }
    if (p === '/api/clear-today/undo' && M === 'POST') {
      need(isAdmin, 403, 'Only an admin can undo');
      need(!isLocked(), 423, 'Today is closed. Reopen it first.');
      const lc = state.lastClear; need(lc && lc.date === today(), 400, 'Nothing to undo today');
      const backup = readJSON(path.join(BACKUP_DIR, lc.file), null); need(backup, 404, 'Backup file is missing');
      const before = totals();
      for (const [k, rows] of Object.entries(backup.sections)) state[k] = rows;
      if (backup.pnl.length) { const ids = new Set(pnl.map(e => e.id)); pnl.push(...backup.pnl.filter(e => !ids.has(e.id))); savePnl(); }
      delete state.lastClear; saveState();
      audit(req, user, { action: 'Undid clear of today\'s data', rowName: Object.keys(backup.sections).map(k => SECTION_NAMES[k]).join(', '), field: 'difference', from: before.diff, to: totals().diff });
      return send(res, 200, { ok: true, version: state.version });
    }

    /* day-end closing */
    if (p === '/api/closings' && M === 'GET') return send(res, 200, closings.map(({ state, ...c }) => c).sort((a, b) => b.date.localeCompare(a.date)));
    if ((m = p.match(/^\/api\/closings\/(\d{4}-\d{2}-\d{2})$/)) && M === 'GET') { const c = closings.find(x => x.date === m[1]); need(c, 404, 'No closing for that date'); return send(res, 200, c); }
    if (p === '/api/closings' && M === 'POST') {
      need(!isLocked(), 409, 'Today is already closed');
      const b = await readBody(req), date = today();
      const prev = closings.filter(c => c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
      const c = { date, closedAt: new Date().toISOString(), closedBy: user.username, closedByName: user.name, remarks: String(b.remarks || '').slice(0, 1000),
        totals: totals(), pnl: pnlTotals(date), prevDate: prev?.date || null, prevDiff: prev ? prev.totals.diff : null,
        entries: readAudit(date).filter(e => e.section).length, state: JSON.parse(JSON.stringify(Object.fromEntries(SECTIONS.map(k => [k, state[k]])))) };
      closings.push(c); saveClosings(); state.version++; writeJSON(F.state, state);
      audit(req, user, { action: 'Day closed', rowName: date, field: 'difference', from: null, to: c.totals.diff });
      const { state: _, ...out } = c; return send(res, 200, out);
    }
    if (m && M === 'DELETE') {
      need(isAdmin, 403, 'Only an admin can reopen a day');
      const c = closings.find(x => x.date === m[1]); need(c, 404, 'No closing for that date');
      closings = closings.filter(x => x !== c); saveClosings(); state.version++; writeJSON(F.state, state);
      audit(req, user, { action: 'Day reopened', rowName: m[1], field: 'difference', from: c.totals.diff, to: null });
      return send(res, 200, { ok: true });
    }

    /* settings */
    if (p === '/api/settings' && M === 'PUT') {
      need(isAdmin, 403, 'Admins only');
      const b = await readBody(req);
      if (b.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { need(false, 400, 'Unknown timezone'); } }
      const next = { ...settings };
      for (const k of ['companyName', 'timezone']) if (b[k]) next[k] = String(b[k]).slice(0, 80);
      for (const k of ['autoRefreshMinutes', 'alertThreshold']) if (k in b) next[k] = Math.max(0, toNumber(b[k]));
      for (const k of ['incomeCategories', 'expenseCategories']) if (Array.isArray(b[k])) next[k] = b[k].map(s => String(s).trim()).filter(Boolean).slice(0, 50);
      for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(settings[k])) audit(req, user, { action: 'Setting changed', rowName: k, from: JSON.stringify(settings[k]), to: JSON.stringify(next[k]) });
      settings = next; saveSettings(); lastAuto = Date.now();
      return send(res, 200, settings);
    }

    /* users */
    if (p.startsWith('/api/users')) need(isAdmin, 403, 'Admins only');
    if (p === '/api/users' && M === 'GET') return send(res, 200, users.map(publicUser));
    if (p === '/api/users' && M === 'POST') {
      const b = await readBody(req), un = String(b.username || '').toLowerCase();
      need(validUsername(un), 400, 'User ID: 3–32 letters, numbers, dot, dash or underscore');
      need(!users.some(u => u.username === un), 409, 'That user ID already exists');
      need(validPw(b.password), 400, 'Password must be at least 6 characters');
      const role = b.role === 'admin' ? 'admin' : 'staff';
      users.push({ username: un, name: String(b.name || un).slice(0, 80), role, active: true, createdAt: new Date().toISOString(), ...hashPw(b.password) }); saveUsers();
      audit(req, user, { action: 'User created', rowName: un, field: 'role', from: null, to: role });
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/users\/([\w.-]+)$/)) && M === 'PATCH') {
      const u = users.find(x => x.username === m[1]); need(u, 404, 'User not found');
      const b = await readBody(req), admins = users.filter(x => x.role === 'admin' && x.active);
      const losesAdmin = (b.role && b.role !== 'admin') || b.active === false;
      need(!(u.role === 'admin' && losesAdmin && admins.length <= 1), 400, 'Keep at least one active admin');
      if (b.password) { need(validPw(b.password), 400, 'Password must be at least 6 characters'); Object.assign(u, hashPw(b.password)); audit(req, user, { action: 'Password reset', rowName: u.username }); }
      if (b.role) { const r = b.role === 'admin' ? 'admin' : 'staff'; audit(req, user, { action: 'Role changed', rowName: u.username, field: 'role', from: u.role, to: r }); u.role = r; }
      if ('active' in b) { u.active = !!b.active; audit(req, user, { action: u.active ? 'User enabled' : 'User disabled', rowName: u.username }); if (!u.active) for (const [t, s] of sessions) if (s.username === u.username) sessions.delete(t); }
      saveUsers(); return send(res, 200, publicUser(u));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!(e instanceof HttpErr)) console.error(e);
    send(res, e instanceof HttpErr ? e.code : 500, { error: e.message });
  }
});

const port = process.env.PORT || config.port || 3000;
server.listen(port, () => console.log(`Reconciliation running at http://localhost:${port}  (business date ${today()}, ${settings.timezone})`));
