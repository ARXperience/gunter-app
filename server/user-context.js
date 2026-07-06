/* =============================================
   GUNTER — User context (multi-tenant)
   ---------------------------------------------
   AsyncLocalStorage propaga el usuario de la sesión HTTP a
   TODOS los módulos del server sin pasar userId por parámetro.

   Resolución de currentUserId():
     1. Sesión de usuario HTTP  → su id
     2. Sin contexto (WhatsApp, service token, procesos internos)
        → el DUEÑO del sistema (admin bootstrap) — el teléfono WA
          y las herramientas locales le pertenecen a él
     3. Sin usuarios registrados aún → '_local'
   ============================================= */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

let _ownerCache = { id: null, at: 0 };
const OWNER_TTL_MS = 60 * 1000;

function ownerId() {
    const now = Date.now();
    if (_ownerCache.id && now - _ownerCache.at < OWNER_TTL_MS) return _ownerCache.id;
    try {
        const store = require('./auth/store');
        // El dueño = el admin más antiguo (el bootstrap fue el primer registro)
        const admins = store.listUsers()
            .filter(u => u.role === 'admin')
            .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        _ownerCache = { id: admins[0]?.id || null, at: now };
    } catch {
        _ownerCache = { id: null, at: now };
    }
    return _ownerCache.id;
}

function runAs(userId, fn) {
    return als.run({ userId: userId || null }, fn);
}

function currentUserId() {
    const ctx = als.getStore();
    if (ctx?.userId) return ctx.userId;
    return ownerId() || '_local';
}

/** Solo para logging/debug: de dónde salió el uid actual. */
function contextKind() {
    const ctx = als.getStore();
    if (ctx?.userId) return 'session';
    return ownerId() ? 'owner-fallback' : 'local';
}

function invalidateOwnerCache() { _ownerCache = { id: null, at: 0 }; }

module.exports = { runAs, currentUserId, ownerId, contextKind, invalidateOwnerCache };
