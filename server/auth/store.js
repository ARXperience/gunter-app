/* =============================================
   GUNTER AUTH — Users store
   ---------------------------------------------
   Persistencia: data/users.json (gitignored).
   Passwords: scrypt (crypto nativo) + salt aleatorio por usuario.
   Roles: 'admin' | 'user'
   Estados: 'pending' | 'approved' | 'blocked'

   Regla de arranque: el PRIMER usuario registrado se convierte
   automáticamente en admin aprobado (bootstrap del dueño del sistema).
   Todos los siguientes entran como 'pending' hasta que un admin apruebe.
   ============================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.GUNTER_AUTH_DATA_DIR || process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

let _users = null;          // Array<user>
let _saveTimer = null;

// ---------- Persistencia ----------
function _load() {
    if (_users) return _users;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(USERS_FILE)) {
            _users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || [];
        } else {
            _users = [];
        }
    } catch (e) {
        console.error('❌ [auth] No se pudo leer users.json:', e.message);
        _users = [];
    }
    return _users;
}

function _save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(USERS_FILE, JSON.stringify({ users: _users, savedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch (e) {
            console.error('❌ [auth] No se pudo guardar users.json:', e.message);
        }
    }, 100);
}

// ---------- Password hashing ----------
function hashPassword(password, salt) {
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), s, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
    return { salt: s, hash };
}

function verifyPassword(password, salt, expectedHash) {
    try {
        const { hash } = hashPassword(password, salt);
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch { return false; }
}

// ---------- Validación ----------
function validUsername(u) {
    return typeof u === 'string' && /^[a-z0-9_.-]{3,24}$/.test(u);
}
function validPassword(p) {
    return typeof p === 'string' && p.length >= 8 && p.length <= 128;
}

// ---------- API ----------
function count() { return _load().length; }

function findByUsername(username) {
    return _load().find(u => u.username === String(username || '').toLowerCase().trim()) || null;
}

function findByLogin(login) {
    const normalized = String(login || '').toLowerCase().trim();
    if (!normalized) return null;
    return _load().find(u =>
        u.username === normalized ||
        String(u.email || '').toLowerCase().trim() === normalized
    ) || null;
}

function findById(id) {
    return _load().find(u => u.id === id) || null;
}

function createUser({ username, password, displayName, email }) {
    const users = _load();
    const uname = String(username || '').toLowerCase().trim();

    if (!validUsername(uname)) {
        return { ok: false, error: 'Usuario inválido: 3-24 caracteres, solo letras minúsculas, números, puntos, guiones.' };
    }
    if (!validPassword(password)) {
        return { ok: false, error: 'La contraseña debe tener entre 8 y 128 caracteres.' };
    }
    if (findByUsername(uname)) {
        return { ok: false, error: 'Ese nombre de usuario ya existe.' };
    }

    const isFirst = users.length === 0;
    const { salt, hash } = hashPassword(password);
    const user = {
        id: 'u_' + crypto.randomBytes(8).toString('hex'),
        username: uname,
        displayName: String(displayName || uname).slice(0, 60),
        email: String(email || '').slice(0, 120) || null,
        passSalt: salt,
        passHash: hash,
        role: isFirst ? 'admin' : 'user',
        status: isFirst ? 'approved' : 'pending',
        createdAt: new Date().toISOString(),
        approvedAt: isFirst ? new Date().toISOString() : null,
        approvedBy: isFirst ? 'bootstrap' : null,
        lastLoginAt: null,
        loginCount: 0
    };
    users.push(user);
    _save();
    return { ok: true, user, isFirst };
}

function checkCredentials(username, password) {
    const user = findByLogin(username);
    if (!user) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    if (!verifyPassword(password, user.passSalt, user.passHash)) {
        return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }
    return { ok: true, user };
}

function recordLogin(id) {
    const user = findById(id);
    if (!user) return;
    user.lastLoginAt = new Date().toISOString();
    user.loginCount = (user.loginCount || 0) + 1;
    _save();
}

function setStatus(id, status, adminId) {
    if (!['pending', 'approved', 'blocked'].includes(status)) return { ok: false, error: 'Estado inválido.' };
    const user = findById(id);
    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    user.status = status;
    if (status === 'approved' && !user.approvedAt) {
        user.approvedAt = new Date().toISOString();
        user.approvedBy = adminId || 'admin';
    }
    _save();
    return { ok: true, user };
}

function setRole(id, role) {
    if (!['admin', 'user'].includes(role)) return { ok: false, error: 'Rol inválido.' };
    const user = findById(id);
    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    // Nunca dejar el sistema sin admins
    if (user.role === 'admin' && role === 'user') {
        const admins = _load().filter(u => u.role === 'admin' && u.status === 'approved');
        if (admins.length <= 1) return { ok: false, error: 'No puedes quitar el último admin del sistema.' };
    }
    user.role = role;
    _save();
    return { ok: true, user };
}

// ---------- WhatsApp: teléfono vinculado ----------
// Normaliza a solo dígitos (formato JID de WhatsApp: 573001234567)
function normalizePhone(phone) {
    return String(phone || '').replace(/[^0-9]/g, '');
}

function findByPhone(phone) {
    const p = normalizePhone(phone);
    if (!p || p.length < 8) return null;
    return _load().find(u => u.waPhone === p) || null;
}

function setPhone(id, phone) {
    const user = findById(id);
    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    const p = normalizePhone(phone);
    if (!p) {   // vacío = desvincular
        user.waPhone = null;
        _save();
        return { ok: true, user, unlinked: true };
    }
    if (p.length < 8 || p.length > 15) {
        return { ok: false, error: 'Número inválido. Usa el formato internacional con código de país (ej: 573001234567).' };
    }
    const taken = findByPhone(p);
    if (taken && taken.id !== id) {
        return { ok: false, error: 'Ese número ya está vinculado a otro usuario.' };
    }
    user.waPhone = p;
    _save();
    return { ok: true, user };
}

// ---------- Tutor 📚: permiso concedido por admin ----------
// El sistema Tutor/Sabio (biblioteca Grinberg) solo es visible para
// admins; a los demás usuarios se les concede explícitamente.
function setTutorAccess(id, allow) {
    const user = findById(id);
    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    user.tutorAccess = !!allow;
    _save();
    return { ok: true, user };
}

function changePassword(id, newPassword) {
    if (!validPassword(newPassword)) return { ok: false, error: 'La contraseña debe tener entre 8 y 128 caracteres.' };
    const user = findById(id);
    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    const { salt, hash } = hashPassword(newPassword);
    user.passSalt = salt;
    user.passHash = hash;
    _save();
    return { ok: true };
}

function removeUser(id) {
    const users = _load();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return { ok: false, error: 'Usuario no encontrado.' };
    // Nunca dejar el sistema sin admins
    if (users[idx].role === 'admin') {
        const admins = users.filter(u => u.role === 'admin');
        if (admins.length <= 1) return { ok: false, error: 'No puedes eliminar el último admin del sistema.' };
    }
    const [removed] = users.splice(idx, 1);
    _save();
    return { ok: true, user: removed };
}

// Versión pública de un usuario (sin hash ni salt)
function publicUser(u) {
    if (!u) return null;
    return {
        id: u.id, username: u.username, displayName: u.displayName, email: u.email,
        role: u.role, status: u.status, createdAt: u.createdAt,
        approvedAt: u.approvedAt, lastLoginAt: u.lastLoginAt, loginCount: u.loginCount || 0,
        waPhone: u.waPhone || null,
        tutorAccess: u.role === 'admin' || !!u.tutorAccess
    };
}

function listUsers() {
    return _load().map(publicUser)
        .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

module.exports = {
    count, findByUsername, findByLogin, findById, createUser, checkCredentials,
    recordLogin, setStatus, setRole, changePassword, removeUser,
    publicUser, listUsers,
    setPhone, findByPhone, normalizePhone, setTutorAccess
};
