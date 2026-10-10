/* =============================================
   GUNTER AUTH — Facade
   ---------------------------------------------
   Endpoints (montados en server.js bajo /api/auth/*):
     POST /api/auth/register      { username, password, displayName?, email? }
     POST /api/auth/login         { username, password }
     POST /api/auth/logout
     GET  /api/auth/me
     GET  /api/auth/setup-status  → { needsSetup } (público: ¿existe algún usuario?)
     POST /api/auth/change-password { current, next }
     ── Admin ──
     GET  /api/auth/admin/users
     POST /api/auth/admin/approve   { userId }
     POST /api/auth/admin/block     { userId }
     POST /api/auth/admin/unblock   { userId }
     POST /api/auth/admin/remove    { userId }
     POST /api/auth/admin/role      { userId, role }
     POST /api/auth/admin/reset-password { userId, next }
     GET  /api/auth/admin/stats
     GET  /api/auth/admin/logs?limit=&level=&search=

   guard(req): protege el resto de /api/*. Acepta:
     - Cookie gunter_session=<token>
     - Authorization: Bearer <token>  (sesión o service token)
   ============================================= */

const store = require('./store');
const sessions = require('./sessions');
const logRing = require('../log-ring');

// ---------- Rate limit de login (en memoria, por IP+usuario) ----------
const attempts = new Map();   // key → { count, firstAt }
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60 * 1000;

function _rateKey(req, username) {
    const forwarded = process.env.TRUST_PROXY === 'true'
        ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        : '';
    const ip = forwarded || req.socket?.remoteAddress || 'unknown';
    return ip + '|' + String(username || '').toLowerCase();
}
function _rateCheck(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || now - rec.firstAt > WINDOW_MS) return { blocked: false };
    if (rec.count >= MAX_ATTEMPTS) {
        const waitMin = Math.ceil((rec.firstAt + WINDOW_MS - now) / 60000);
        return { blocked: true, waitMin };
    }
    return { blocked: false };
}
function _rateHit(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || now - rec.firstAt > WINDOW_MS) attempts.set(key, { count: 1, firstAt: now });
    else rec.count++;
    // higiene: no dejar crecer el mapa sin límite
    if (attempts.size > 5000) attempts.clear();
}
function _rateClear(key) { attempts.delete(key); }

// ---------- Extracción de token ----------
function _parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    raw.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}

function _extractToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return _parseCookies(req)['gunter_session'] || null;
}

// ---------- Autenticación de requests ----------
// Devuelve: { kind: 'service' } | { kind: 'user', user, token } | null
function authenticate(req) {
    const token = _extractToken(req);
    if (!token) return null;
    if (sessions.isServiceToken(token)) return { kind: 'service' };
    const s = sessions.get(token);
    if (!s) return null;
    const user = store.findById(s.userId);
    if (!user) { sessions.destroy(token); return null; }
    return { kind: 'user', user, token };
}

// Guard para el resto de /api/*.
// Devuelve null si puede pasar, o { code, error } si hay que cortar.
function guard(req) {
    const who = authenticate(req);
    if (!who) return { code: 401, error: 'auth_required', message: 'Inicia sesión para usar Gunter.' };
    if (who.kind === 'service') return null;
    if (who.user.status === 'pending') return { code: 403, error: 'pending_approval', message: 'Tu cuenta está esperando la aprobación del administrador.' };
    if (who.user.status === 'blocked') return { code: 403, error: 'blocked', message: 'Tu cuenta fue bloqueada. Contacta al administrador.' };
    req.gunterUser = store.publicUser(who.user);   // disponible para endpoints que quieran filtrar por usuario
    return null;
}

function _requireAdmin(req) {
    const who = authenticate(req);
    if (!who) return { code: 401, error: 'auth_required' };
    if (who.kind === 'service') return null;   // service token = nivel admin (solo disco local)
    if (who.user.role !== 'admin' || who.user.status !== 'approved') {
        return { code: 403, error: 'admin_only', message: 'Solo el administrador puede hacer esto.' };
    }
    return null;
}

function _adminActor(req) {
    const who = authenticate(req);
    return who?.kind === 'user' ? who.user.id : 'service';
}

// ---------- Cookie helpers ----------
function _cookieHeader(token, req, destroy = false) {
    const proto = (req.headers['x-forwarded-proto'] || '').toLowerCase();
    const secure = proto === 'https' || process.env.AUTH_COOKIE_SECURE === 'true';
    const maxAge = destroy ? 0 : 30 * 24 * 60 * 60;
    return `gunter_session=${destroy ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// ---------- Handler HTTP ----------
// sub: path después de /api/auth/ (ej. 'login', 'admin/users')
// Devuelve { status, headers?, body } — server.js lo serializa.
function handle(sub, method, body, req) {
    body = body || {};

    // ── Público ──
    if (sub === 'setup-status' && method === 'GET') {
        return { status: 200, body: { success: true, needsSetup: store.count() === 0 } };
    }

    if (sub === 'register' && method === 'POST') {
        // El service token (herramientas locales) no consume rate limit
        const isService = sessions.isServiceToken(_extractToken(req));
        if (!isService) {
            const rl = _rateKey(req, 'register');
            const rc = _rateCheck(rl);
            if (rc.blocked) return { status: 429, body: { success: false, error: `Demasiados intentos. Espera ${rc.waitMin} min.` } };
            _rateHit(rl);
        }
        const r = store.createUser(body);
        if (!r.ok) return { status: 400, body: { success: false, error: r.error } };
        console.log(`👤 [auth] Registro: ${r.user.username} (${r.isFirst ? 'ADMIN bootstrap' : 'pendiente de aprobación'})`);
        // El primer registro define al dueño del sistema — refrescar el cache
        if (r.isFirst) { try { require('../user-context').invalidateOwnerCache(); } catch { } }
        // Login inmediato (aunque esté pending — el guard limita lo que puede hacer)
        const token = sessions.create(r.user.id, req.headers['user-agent']);
        store.recordLogin(r.user.id);
        return {
            status: 200,
            headers: { 'Set-Cookie': _cookieHeader(token, req) },
            body: { success: true, user: store.publicUser(r.user), isFirst: r.isFirst, sessionStartedAt: sessions.get(token)?.createdAt }
        };
    }

    if (sub === 'login' && method === 'POST') {
        const key = _rateKey(req, body.username);
        const rc = _rateCheck(key);
        if (rc.blocked) return { status: 429, body: { success: false, error: `Demasiados intentos fallidos. Espera ${rc.waitMin} min.` } };
        const r = store.checkCredentials(body.username, body.password);
        if (!r.ok) {
            _rateHit(key);
            return { status: 401, body: { success: false, error: r.error } };
        }
        _rateClear(key);
        const token = sessions.create(r.user.id, req.headers['user-agent']);
        store.recordLogin(r.user.id);
        console.log(`🔓 [auth] Login: ${r.user.username} (${r.user.role}/${r.user.status})`);
        return {
            status: 200,
            headers: { 'Set-Cookie': _cookieHeader(token, req) },
            body: { success: true, user: store.publicUser(r.user), sessionStartedAt: sessions.get(token)?.createdAt }
        };
    }

    if (sub === 'logout' && method === 'POST') {
        const token = _extractToken(req);
        if (token) sessions.destroy(token);
        return { status: 200, headers: { 'Set-Cookie': _cookieHeader('', req, true) }, body: { success: true } };
    }

    if (sub === 'me' && method === 'GET') {
        const who = authenticate(req);
        if (!who) return { status: 401, body: { success: false, error: 'auth_required' } };
        if (who.kind === 'service') return { status: 200, body: { success: true, user: { id: 'service', username: 'service', displayName: 'Service', role: 'admin', status: 'approved' }, service: true } };
        return { status: 200, body: { success: true, user: store.publicUser(who.user), sessionStartedAt: sessions.get(who.token)?.createdAt } };
    }

    // Vincular / desvincular el WhatsApp propio (phone vacío = desvincular).
    // Con esto Gunter identifica al usuario cuando le escribe al número puente.
    if (sub === 'set-phone' && method === 'POST') {
        const who = authenticate(req);
        if (!who || who.kind !== 'user') return { status: 401, body: { success: false, error: 'auth_required' } };
        const r = store.setPhone(who.user.id, body.phone);
        if (!r.ok) return { status: 400, body: { success: false, error: r.error } };
        console.log(`📱 [auth] ${who.user.username} ${r.unlinked ? 'desvinculó su WhatsApp' : 'vinculó WhatsApp: ' + r.user.waPhone}`);
        return { status: 200, body: { success: true, user: store.publicUser(r.user) } };
    }

    if (sub === 'change-password' && method === 'POST') {
        const who = authenticate(req);
        if (!who || who.kind !== 'user') return { status: 401, body: { success: false, error: 'auth_required' } };
        const check = store.checkCredentials(who.user.username, body.current);
        if (!check.ok) return { status: 401, body: { success: false, error: 'La contraseña actual no es correcta.' } };
        const r = store.changePassword(who.user.id, body.next);
        if (!r.ok) return { status: 400, body: { success: false, error: r.error } };
        // Cambiar credenciales invalida todas las sesiones previas y rota la actual.
        // Así se cierran otros dispositivos sin expulsar al usuario del que inició el cambio.
        sessions.destroyAllForUser(who.user.id);
        const token = sessions.create(who.user.id, req.headers['user-agent']);
        return {
            status: 200,
            headers: { 'Set-Cookie': _cookieHeader(token, req) },
            body: { success: true, user: store.publicUser(store.findById(who.user.id)) }
        };
    }

    // ── Admin ──
    if (sub.startsWith('admin/')) {
        const deny = _requireAdmin(req);
        if (deny) return { status: deny.code, body: { success: false, error: deny.error, message: deny.message } };
        const op = sub.slice('admin/'.length);

        if (op === 'users' && method === 'GET') {
            return { status: 200, body: { success: true, users: store.listUsers(), activeSessions: sessions.listActive() } };
        }
        if (op === 'approve' && method === 'POST') {
            const r = store.setStatus(body.userId, 'approved', _adminActor(req));
            if (r.ok) console.log(`✅ [auth] Usuario aprobado: ${r.user.username}`);
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error, user: r.ok ? store.publicUser(r.user) : undefined } };
        }
        if (op === 'block' && method === 'POST') {
            const target = store.findById(body.userId);
            if (target?.role === 'admin') {
                const admins = store.listUsers().filter(u => u.role === 'admin' && u.status === 'approved');
                if (admins.length <= 1) return { status: 400, body: { success: false, error: 'No puedes bloquear al último admin.' } };
            }
            const r = store.setStatus(body.userId, 'blocked', _adminActor(req));
            if (r.ok) {
                sessions.destroyAllForUser(body.userId);
                console.log(`🚫 [auth] Usuario bloqueado: ${r.user.username}`);
            }
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error, user: r.ok ? store.publicUser(r.user) : undefined } };
        }
        if (op === 'unblock' && method === 'POST') {
            const r = store.setStatus(body.userId, 'approved', _adminActor(req));
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error, user: r.ok ? store.publicUser(r.user) : undefined } };
        }
        if (op === 'remove' && method === 'POST') {
            const r = store.removeUser(body.userId);
            if (r.ok) {
                sessions.destroyAllForUser(body.userId);
                // Privacidad: al eliminar el usuario se borran TODOS sus datos
                try { require('../control-plane/privacy').purgeUser(body.userId); } catch (e) { console.warn('[auth] limpieza de Control Plane falló:', e.message); }
                try { require('../user-store').removeUserData(body.userId); } catch (e) { console.warn('[auth] limpieza de datos falló:', e.message); }
                try { require('../user-context').invalidateOwnerCache(); } catch { }
                console.log(`🗑️ [auth] Usuario eliminado: ${r.user.username}`);
            }
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error } };
        }
        if (op === 'role' && method === 'POST') {
            const r = store.setRole(body.userId, body.role);
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error, user: r.ok ? store.publicUser(r.user) : undefined } };
        }
        // Conceder / quitar acceso al Tutor 📚 (biblioteca del Sabio)
        if (op === 'tutor-access' && method === 'POST') {
            const r = store.setTutorAccess(body.userId, body.allow);
            if (r.ok) console.log(`📚 [auth] Tutor ${body.allow ? 'concedido a' : 'retirado de'}: ${r.user.username}`);
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error, user: r.ok ? store.publicUser(r.user) : undefined } };
        }
        if (op === 'reset-password' && method === 'POST') {
            const r = store.changePassword(body.userId, body.next);
            if (r.ok) sessions.destroyAllForUser(body.userId);
            return { status: r.ok ? 200 : 400, body: { success: r.ok, error: r.error } };
        }
        if (op === 'stats' && method === 'GET') {
            const users = store.listUsers();
            return {
                status: 200,
                body: {
                    success: true,
                    users: {
                        total: users.length,
                        pending: users.filter(u => u.status === 'pending').length,
                        approved: users.filter(u => u.status === 'approved').length,
                        blocked: users.filter(u => u.status === 'blocked').length,
                        admins: users.filter(u => u.role === 'admin').length
                    },
                    sessions: { active: sessions.activeCount() },
                    logs: logRing.stats(),
                    system: {
                        uptime: process.uptime(),
                        memoryMB: Math.round(process.memoryUsage().rss / 1048576),
                        node: process.version,
                        platform: process.platform,
                        pid: process.pid
                    }
                }
            };
        }
        if (op === 'logs' && method === 'GET') {
            return { status: 200, body: { success: true, entries: logRing.getRecent(body) } };
        }
        return { status: 404, body: { success: false, error: 'Operación admin desconocida: ' + op } };
    }

    return { status: 404, body: { success: false, error: 'Ruta auth desconocida: ' + sub } };
}

// Generar el service token al arranque — las herramientas locales
// (smoke tests) lo leen del disco antes del primer request.
sessions.getServiceToken();

module.exports = { handle, guard, authenticate };
