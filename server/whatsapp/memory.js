/* =============================================
   WhatsApp - Per-contact Memory
   -------------------------------------------------
   Guarda historia de conversación + "facts"
   (preferencias, nombre, context) por cada contacto.
   JSON en disco. Ring buffer de 20 intercambios.
   ============================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'whatsapp-data');
const FILE = path.join(DATA_DIR, 'memory.json');
const MAX_HISTORY = 20;       // últimos N turnos por contacto
const MAX_FACTS_AGE_DAYS = 90;

function ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readAll() {
    try {
        ensure();
        if (!fs.existsSync(FILE)) return {};
        return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    } catch {
        return {};
    }
}
function writeAll(data) {
    ensure();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function ensureContact(all, phone) {
    if (!all[phone]) {
        all[phone] = {
            phone,
            name: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [],
            facts: {}       // key → { value, learnedAt }
        };
    }
    return all[phone];
}

function getContext(phone) {
    const all = readAll();
    return all[phone] || null;
}

/** Añade un turno al historial */
function appendTurn(phone, role, content, meta = {}) {
    const all = readAll();
    const c = ensureContact(all, phone);
    c.history.push({
        role, content, at: new Date().toISOString(),
        ...meta
    });
    if (c.history.length > MAX_HISTORY) c.history.splice(0, c.history.length - MAX_HISTORY);
    c.updatedAt = new Date().toISOString();
    writeAll(all);
}

/** Historial formateado para incluir en un system/user prompt del LLM */
function historyForPrompt(phone, limit = 12) {
    const c = getContext(phone);
    if (!c) return [];
    return c.history.slice(-limit).map(h => ({
        role: h.role,      // 'user' | 'assistant'
        content: h.content
    }));
}

/** Guarda un hecho/preferencia */
function setFact(phone, key, value) {
    const all = readAll();
    const c = ensureContact(all, phone);
    c.facts[key] = { value, learnedAt: new Date().toISOString() };
    c.updatedAt = new Date().toISOString();
    writeAll(all);
}

function setName(phone, name) {
    const all = readAll();
    const c = ensureContact(all, phone);
    c.name = name;
    c.updatedAt = new Date().toISOString();
    writeAll(all);
}

function factsSummary(phone) {
    const c = getContext(phone);
    if (!c) return '';
    const lines = [];
    if (c.name) lines.push(`Nombre del contacto: ${c.name}`);
    for (const [k, v] of Object.entries(c.facts || {})) {
        if (v && v.value != null) lines.push(`${k}: ${v.value}`);
    }
    return lines.join('\n');
}

function purgeOldFacts() {
    const all = readAll();
    const cutoff = Date.now() - MAX_FACTS_AGE_DAYS * 86_400_000;
    let touched = false;
    for (const c of Object.values(all)) {
        for (const [k, v] of Object.entries(c.facts || {})) {
            if (new Date(v.learnedAt).getTime() < cutoff) {
                delete c.facts[k];
                touched = true;
            }
        }
    }
    if (touched) writeAll(all);
}

function listContacts() {
    const all = readAll();
    return Object.values(all).map(c => ({
        phone: c.phone,
        name: c.name,
        turns: c.history.length,
        lastSeen: c.updatedAt,
        facts: Object.keys(c.facts || {}).length
    })).sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
}

function getFullContact(phone) {
    return getContext(phone);
}

function forget(phone) {
    const all = readAll();
    delete all[phone];
    writeAll(all);
}

module.exports = {
    appendTurn,
    historyForPrompt,
    setFact,
    setName,
    factsSummary,
    purgeOldFacts,
    listContacts,
    getFullContact,
    forget
};
