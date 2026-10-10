/* =============================================
   GUNTER AUTH — Sessions
   ---------------------------------------------
   Tokens opacos (crypto.randomBytes 32) persistidos en
   data/sessions.json. TTL 30 días con sliding refresh.

   Service token: token de nivel admin generado una sola vez en
   data/service-token.json (gitignored) para herramientas locales
   (smoke tests, scripts de mantenimiento). Solo existe en el disco
   del servidor — mismo dominio de confianza que .env.
   ============================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.GUNTER_AUTH_DATA_DIR || process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SERVICE_TOKEN_FILE = path.join(DATA_DIR, 'service-token.json');

const TTL_MS = 30 * 24 * 60 * 60 * 1000;          // 30 días
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;      // sliding: renueva si pasó >1 día

let _sessions = null;       // { token: { userId, createdAt, expiresAt, lastSeenAt, ua } }
let _serviceToken = null;
let _saveTimer = null;

function _load() {
    if (_sessions) return _sessions;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        _sessions = fs.existsSync(SESSIONS_FILE)
            ? (JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')).sessions || {})
            : {};
    } catch (e) {
        console.error('❌ [auth] No se pudo leer sessions.json:', e.message);
        _sessions = {};
    }
    _purgeExpired();
    return _sessions;
}

function _save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: _sessions, savedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch (e) {
            console.error('❌ [auth] No se pudo guardar sessions.json:', e.message);
        }
    }, 150);
}

function _purgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [tok, s] of Object.entries(_sessions || {})) {
        if (!s || new Date(s.expiresAt).getTime() < now) { delete _sessions[tok]; purged++; }
    }
    if (purged) _save();
}

// ---------- Service token (herramientas locales) ----------
function getServiceToken() {
    if (_serviceToken) return _serviceToken;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(SERVICE_TOKEN_FILE)) {
            _serviceToken = JSON.parse(fs.readFileSync(SERVICE_TOKEN_FILE, 'utf8')).token || null;
        }
        if (!_serviceToken) {
            _serviceToken = 'svc_' + crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(SERVICE_TOKEN_FILE, JSON.stringify({
                token: _serviceToken,
                note: 'Token de servicio para herramientas locales (smoke tests). NO compartir ni commitear.',
                createdAt: new Date().toISOString()
            }, null, 2), { encoding: 'utf8', mode: 0o600 });
            console.log('🔑 [auth] Service token generado en data/service-token.json');
        }
    } catch (e) {
        console.error('❌ [auth] Service token error:', e.message);
    }
    return _serviceToken;
}

function isServiceToken(token) {
    if (!token) return false;
    const expected = getServiceToken();
    if (!expected) return false;
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function rotateServiceToken() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        _serviceToken = 'svc_' + crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(SERVICE_TOKEN_FILE, JSON.stringify({
            token: _serviceToken,
            note: 'Token de servicio para herramientas locales (smoke tests). NO compartir ni commitear.',
            createdAt: new Date().toISOString(),
            rotatedAt: new Date().toISOString()
        }, null, 2), { encoding: 'utf8', mode: 0o600 });
        return true;
    } catch (e) {
        console.error('❌ [auth] No se pudo rotar el service token:', e.message);
        return false;
    }
}

// ---------- Sesiones de usuario ----------
function create(userId, ua) {
    const sessions = _load();
    const token = 's_' + crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions[token] = {
        userId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TTL_MS).toISOString(),
        lastSeenAt: new Date(now).toISOString(),
        ua: String(ua || '').slice(0, 160)
    };
    _save();
    return token;
}

function get(token) {
    if (!token) return null;
    const sessions = _load();
    const s = sessions[token];
    if (!s) return null;
    const now = Date.now();
    if (new Date(s.expiresAt).getTime() < now) {
        delete sessions[token];
        _save();
        return null;
    }
    // Sliding refresh (máx una vez al día para no escribir en cada request)
    if (now - new Date(s.lastSeenAt).getTime() > REFRESH_AFTER_MS) {
        s.lastSeenAt = new Date(now).toISOString();
        s.expiresAt = new Date(now + TTL_MS).toISOString();
        _save();
    }
    return s;
}

function destroy(token) {
    const sessions = _load();
    if (sessions[token]) { delete sessions[token]; _save(); return true; }
    return false;
}

function destroyAllForUser(userId) {
    const sessions = _load();
    let n = 0;
    for (const [tok, s] of Object.entries(sessions)) {
        if (s.userId === userId) { delete sessions[tok]; n++; }
    }
    if (n) _save();
    return n;
}

function destroyAll() {
    const sessions = _load();
    const count = Object.keys(sessions).length;
    _sessions = {};
    clearTimeout(_saveTimer);
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify({
            sessions: {},
            savedAt: new Date().toISOString(),
            invalidatedAt: new Date().toISOString()
        }, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
        console.error('❌ [auth] No se pudieron invalidar las sesiones:', e.message);
        return -1;
    }
    return count;
}

function activeCount() {
    _load();
    _purgeExpired();
    return Object.keys(_sessions).length;
}

function listActive() {
    _load();
    _purgeExpired();
    return Object.values(_sessions).map(s => ({
        userId: s.userId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ua: s.ua
    }));
}

// Entry coordination lives in the existing authenticated session. Synchronous
// claims serialize concurrent tabs without a second store or client-side lock.
function visit(token, input = {}) {
    const session = get(token);
    if (!session) return { ok: false, error: 'invalid_session' };
    if (input.userId && input.userId !== session.userId) return { ok: false, error: 'account_changed' };
    const { op = 'enter', tabId, pageId, entryId, continuation = false } = input;
    if (!['enter', 'pulse', 'leave'].includes(op) ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(tabId || '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(pageId || '')) {
        return { ok: false, error: 'invalid_entry' };
    }
    const now = Date.now();
    let entry = session.appEntry;
    if (op !== 'enter') {
        const member = entry?.tabs?.[pageId];
        if (!entry || entry.id !== entryId || member?.tabId !== tabId) return { ok: true, active: false };
        member.seenAt = now;
        member.departed = op === 'leave';
        _save();
        return { ok: true, active: !member.departed, entryId: entry.id };
    }
    const members = Object.values(entry?.tabs || {});
    const alive = members.some(member => !member.departed && now - member.seenAt < 120000);
    const continuing = continuation === true && entry?.id === entryId && members.some(member => member.tabId === tabId);
    if (!entry || (!alive && !continuing)) {
        entry = session.appEntry = { id: 'entry_' + crypto.randomBytes(12).toString('hex'), claimed: false, tabs: {} };
    }
    for (const [id, member] of Object.entries(entry.tabs)) {
        if ((member.departed || now - member.seenAt >= 120000) && id !== pageId) delete entry.tabs[id];
    }
    // Avoid unlimited tab metadata in the session file.
    if (!entry.tabs[pageId] && Object.keys(entry.tabs).length >= 64) return { ok: false, error: 'too_many_tabs' };
    entry.tabs[pageId] = { tabId, seenAt: now, departed: false };
    const shouldGreet = !entry.claimed;
    entry.claimed = true;
    _save();
    return { ok: true, entryId: entry.id, shouldGreet };
}

module.exports = { create, get, destroy, destroyAll, destroyAllForUser, activeCount, listActive, getServiceToken, rotateServiceToken, isServiceToken, visit };
