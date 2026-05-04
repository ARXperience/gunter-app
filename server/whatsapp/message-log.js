/* =============================================
   WhatsApp - Message Log + Sync Queue
   -------------------------------------------------
   Storage simple en disco JSON. Sin base de datos.
   Ring buffer de últimos N mensajes + cola de
   "pending items" (tareas/eventos) que el frontend
   consume cuando el usuario abre la app.
   ============================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'whatsapp-data');
const MSG_FILE = path.join(DATA_DIR, 'messages.json');
const QUEUE_FILE = path.join(DATA_DIR, 'sync-queue.json');
const MAX_MESSAGES = 500;

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.warn('[wa-log] read error:', e.message);
        return fallback;
    }
}
function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- Messages ----------
function appendMessage(msg) {
    ensureDir();
    const list = readJson(MSG_FILE, []);
    list.push({
        id: msg.id || `wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        direction: msg.direction,      // 'in' | 'out'
        from: msg.from,                // phone number (jid)
        to: msg.to || null,
        text: msg.text,
        timestamp: msg.timestamp || new Date().toISOString(),
        status: msg.status || 'delivered'
    });
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
    writeJson(MSG_FILE, list);
}

function getRecentMessages(limit = 50) {
    return readJson(MSG_FILE, []).slice(-limit).reverse();
}

function getMessagesByConversation(phone, limit = 100) {
    return readJson(MSG_FILE, [])
        .filter(m => m.from === phone || m.to === phone)
        .slice(-limit)
        .reverse();
}

function clearMessages() {
    if (fs.existsSync(MSG_FILE)) fs.unlinkSync(MSG_FILE);
}

// ---------- Sync queue ----------
// Items creados desde WhatsApp que la UI debe adoptar.
// Shape: { id, kind: 'task'|'event', payload, claimed:false, source:'whatsapp', from, createdAt }
function enqueueSync(item) {
    ensureDir();
    const list = readJson(QUEUE_FILE, []);
    list.push({
        id: `syn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        claimed: false,
        createdAt: new Date().toISOString(),
        ...item
    });
    writeJson(QUEUE_FILE, list);
}

function getPendingSync() {
    return readJson(QUEUE_FILE, []).filter(i => !i.claimed);
}

function claimSync(ids) {
    const list = readJson(QUEUE_FILE, []);
    const set = new Set(ids);
    list.forEach(i => { if (set.has(i.id)) i.claimed = true; });
    // Purge claimed items older than 24h
    const cutoff = Date.now() - 86400_000;
    const next = list.filter(i => !i.claimed || new Date(i.createdAt).getTime() > cutoff);
    writeJson(QUEUE_FILE, next);
    return set.size;
}

module.exports = {
    appendMessage,
    getRecentMessages,
    getMessagesByConversation,
    clearMessages,
    enqueueSync,
    getPendingSync,
    claimSync,
    DATA_DIR
};
