/* =============================================
   GUNTER — User store (multi-tenant)
   ---------------------------------------------
   Cada usuario tiene su carpeta: data/users/<userId>/
     commitments.json, proactive-queue.json, style-mirror.json,
     forecast-history.json, features-state.json,
     personal-knowledge.json, tutor-notes.json, tutor-sessions.json,
     knowledge/ (snapshot + index + summaries + aliases)

   Migración: la primera vez que el DUEÑO (admin bootstrap) accede a
   un archivo, si existe la versión legacy global (data/<archivo> o
   whatsapp-data/knowledge/) se MUEVE a su carpeta. Así el dueño
   conserva todos sus datos previos al multi-tenant.

   userFile(name) resuelve el path según el usuario del contexto
   actual (ver user-context.js). Los módulos no conocen userId.
   ============================================= */

const fs = require('fs');
const path = require('path');
const ctx = require('./user-context');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.GUNTER_DATA_DIR || path.join(ROOT, 'data'));
const USERS_DIR = path.join(DATA_DIR, 'users');
const WHATSAPP_DATA_DIR = path.resolve(process.env.GUNTER_WHATSAPP_DATA_DIR || path.join(ROOT, 'whatsapp-data'));

// Archivos legacy globales → nombre dentro de la carpeta del usuario
const LEGACY_FILES = {
    'commitments.json':        path.join(DATA_DIR, 'commitments.json'),
    'proactive-queue.json':    path.join(DATA_DIR, 'proactive-queue.json'),
    'style-mirror.json':       path.join(DATA_DIR, 'style-mirror.json'),
    'forecast-history.json':   path.join(DATA_DIR, 'forecast-history.json'),
    'features-state.json':     path.join(DATA_DIR, 'features-state.json'),
    'personal-knowledge.json': path.join(DATA_DIR, 'personal-knowledge.json'),
    'tutor-notes.json':        path.join(DATA_DIR, 'tutor-notes.json'),
    'tutor-sessions.json':     path.join(DATA_DIR, 'tutor-sessions.json'),
    // WhatsApp — los archivos legacy globales pasan al dueño (su teléfono era el único)
    'wa-memory.json':          path.join(WHATSAPP_DATA_DIR, 'memory.json'),
    'wa-messages.json':        path.join(WHATSAPP_DATA_DIR, 'messages.json'),
    'wa-sync-queue.json':      path.join(WHATSAPP_DATA_DIR, 'sync-queue.json'),
    'wa-personality.json':     path.join(WHATSAPP_DATA_DIR, 'personality.json'),
    'wa-state-mirror.json':    path.join(WHATSAPP_DATA_DIR, 'state-mirror.json')
};
const LEGACY_KNOWLEDGE_DIR = path.join(WHATSAPP_DATA_DIR, 'knowledge');

function _sanitize(uid) {
    // ids internos: u_<hex> | _local — nunca path traversal
    return String(uid || '_local').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function userDir(uid) {
    const dir = path.join(USERS_DIR, _sanitize(uid || ctx.currentUserId()));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function _migrateIfOwner(uid, name, target) {
    if (uid !== ctx.ownerId()) return;
    try {
        if (fs.existsSync(target)) return;                       // ya migrado
        const legacy = LEGACY_FILES[name];
        if (legacy && fs.existsSync(legacy)) {
            fs.renameSync(legacy, target);
            console.log(`📦 [user-store] Migrado ${name} → carpeta del dueño`);
        }
    } catch (e) {
        console.warn(`⚠️ [user-store] Migración de ${name} falló:`, e.message);
    }
}

/** Path de un archivo de datos del usuario ACTUAL (por contexto). */
function userFile(name) {
    const uid = ctx.currentUserId();
    const dir = userDir(uid);
    const target = path.join(dir, name);
    _migrateIfOwner(uid, name, target);
    return target;
}

/** Directorio knowledge/ del usuario actual (con migración del legacy del dueño). */
function userKnowledgeDir() {
    const uid = ctx.currentUserId();
    const dir = path.join(userDir(uid), 'knowledge');
    if (!fs.existsSync(dir)) {
        if (uid === ctx.ownerId() && fs.existsSync(LEGACY_KNOWLEDGE_DIR)) {
            try {
                fs.renameSync(LEGACY_KNOWLEDGE_DIR, dir);
                console.log('📦 [user-store] Migrado knowledge/ → carpeta del dueño');
            } catch (e) {
                console.warn('⚠️ [user-store] Migración knowledge falló:', e.message);
                fs.mkdirSync(dir, { recursive: true });
            }
        } else {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    return dir;
}

/** Borra TODOS los datos de un usuario (al eliminarlo desde admin). */
function removeUserData(uid) {
    const safe = _sanitize(uid);
    if (!safe || safe === '_local') return false;
    const dir = path.join(USERS_DIR, safe);
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`🗑️ [user-store] Datos eliminados: data/users/${safe}`);
            return true;
        }
    } catch (e) {
        console.warn('⚠️ [user-store] removeUserData falló:', e.message);
    }
    return false;
}

/** Tamaño en bytes de la carpeta de un usuario (para stats admin). */
function userDataSize(uid) {
    const dir = path.join(USERS_DIR, _sanitize(uid));
    let total = 0;
    const walk = (d) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) walk(p);
            else total += fs.statSync(p).size;
        }
    };
    try { if (fs.existsSync(dir)) walk(dir); } catch { }
    return total;
}

module.exports = { userFile, userDir, userKnowledgeDir, removeUserData, userDataSize };
