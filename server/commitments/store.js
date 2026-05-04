/* =============================================
   COMMITMENTS — Persistent store (v2 — F2)
   -------------------------------------------------
   Simple JSON file-backed store con write-batch.
   Vive en data/commitments.json para sobrevivir restarts.
   Schema (un commitment):
     {
       id, owner, beneficiary, action, context,
       source: { type: 'meeting'|'chat'|'whatsapp'|'manual', refId, ts },
       dueAt, createdAt, status: 'pending'|'fulfilled'|'overdue'|'cancelled',
       fulfilledAt, fulfillmentNote, channel, projectId
     }
   ============================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'commitments.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE_PATH)) return [];
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.warn('[commitments] loadAll failed:', e.message);
        return [];
    }
}

function saveAll(items) {
    try {
        ensureDir();
        fs.writeFileSync(FILE_PATH, JSON.stringify(items, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('[commitments] saveAll failed:', e.message);
        return false;
    }
}

function newId() {
    return 'cmt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function add(commitment) {
    const items = loadAll();
    const c = {
        id: commitment.id || newId(),
        owner: commitment.owner || 'unknown',
        beneficiary: commitment.beneficiary || 'unknown',
        action: String(commitment.action || '').trim(),
        context: String(commitment.context || '').slice(0, 600),
        source: commitment.source || { type: 'manual', ts: Date.now() },
        dueAt: commitment.dueAt || null,
        createdAt: commitment.createdAt || new Date().toISOString(),
        status: commitment.status || 'pending',
        fulfilledAt: null,
        fulfillmentNote: '',
        channel: commitment.channel || null,
        projectId: commitment.projectId || null
    };
    if (!c.action) return null;
    // Dedupe simple: mismo owner + action + dueAt + projectId reciente (<24h)
    const dupe = items.find(x =>
        x.owner === c.owner &&
        x.action.toLowerCase() === c.action.toLowerCase() &&
        x.projectId === c.projectId &&
        Math.abs(new Date(x.createdAt).getTime() - new Date(c.createdAt).getTime()) < 86400000
    );
    if (dupe) return dupe;
    items.push(c);
    saveAll(items);
    return c;
}

function addBulk(arr) {
    if (!Array.isArray(arr) || !arr.length) return [];
    const created = [];
    for (const c of arr) {
        const r = add(c);
        if (r) created.push(r);
    }
    return created;
}

function get(id) {
    return loadAll().find(c => c.id === id) || null;
}

function update(id, patch = {}) {
    const items = loadAll();
    const idx = items.findIndex(c => c.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    saveAll(items);
    return items[idx];
}

function remove(id) {
    const items = loadAll();
    const next = items.filter(c => c.id !== id);
    if (next.length === items.length) return false;
    saveAll(next);
    return true;
}

function list({ status = null, owner = null, projectId = null, limit = 200 } = {}) {
    let items = loadAll();
    if (status)    items = items.filter(c => c.status === status);
    if (owner)     items = items.filter(c => c.owner === owner);
    if (projectId) items = items.filter(c => c.projectId === projectId);
    items.sort((a, b) => {
        // Prioridad: pending overdue first, fulfilled last
        const order = { overdue: 0, pending: 1, fulfilled: 2, cancelled: 3 };
        const oa = order[a.status] ?? 5, ob = order[b.status] ?? 5;
        if (oa !== ob) return oa - ob;
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return da - db;
    });
    return items.slice(0, limit);
}

function recomputeOverdue() {
    const items = loadAll();
    let changed = 0;
    const now = Date.now();
    for (const c of items) {
        if (c.status === 'pending' && c.dueAt) {
            const due = new Date(c.dueAt).getTime();
            if (!isNaN(due) && due < now) {
                c.status = 'overdue';
                changed++;
            }
        }
    }
    if (changed) saveAll(items);
    return changed;
}

function stats() {
    const items = loadAll();
    const by = { pending: 0, overdue: 0, fulfilled: 0, cancelled: 0 };
    for (const c of items) by[c.status] = (by[c.status] || 0) + 1;
    return {
        total: items.length,
        byStatus: by,
        oldestPendingAt: items
            .filter(c => c.status === 'pending')
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0]?.createdAt || null
    };
}

function clear() {
    saveAll([]);
    return true;
}

module.exports = {
    add, addBulk, get, update, remove, list,
    recomputeOverdue, stats, clear,
    _loadAll: loadAll
};
