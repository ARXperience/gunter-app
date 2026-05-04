/* =============================================
   PROACTIVE PULSE — Persistent Queue (v2 — F3)
   -------------------------------------------------
   Bandeja de "intervenciones" generadas por el engine.
   Persistido en data/proactive-queue.json.

   Schema (intervention):
     {
       id, type, severity ('low'|'mid'|'high'),
       title, message, suggestedActions: [{label, action, payload}],
       createdAt, status: 'queued'|'shown'|'acted'|'dismissed'|'snoozed',
       snoozedUntil, payload, projectId, dedupeKey
     }
   ============================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'proactive-queue.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE_PATH)) return [];
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) || [];
    } catch (e) {
        console.warn('[proactive/store] loadAll:', e.message);
        return [];
    }
}

function saveAll(items) {
    try {
        ensureDir();
        fs.writeFileSync(FILE_PATH, JSON.stringify(items, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('[proactive/store] saveAll:', e.message);
        return false;
    }
}

function newId() {
    return 'pulse_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function add(intervention) {
    const items = loadAll();
    // Dedupe por dedupeKey si existe (evita reñotar la misma alerta)
    if (intervention.dedupeKey) {
        const dup = items.find(i =>
            i.dedupeKey === intervention.dedupeKey &&
            i.status !== 'dismissed' &&
            (Date.now() - new Date(i.createdAt).getTime()) < 24 * 3600 * 1000
        );
        if (dup) return dup;
    }
    const it = {
        id: intervention.id || newId(),
        type: intervention.type || 'generic',
        severity: intervention.severity || 'mid',
        title: String(intervention.title || '').trim(),
        message: String(intervention.message || '').trim(),
        suggestedActions: Array.isArray(intervention.suggestedActions) ? intervention.suggestedActions : [],
        createdAt: new Date().toISOString(),
        status: 'queued',
        snoozedUntil: null,
        payload: intervention.payload || null,
        projectId: intervention.projectId || null,
        dedupeKey: intervention.dedupeKey || null
    };
    if (!it.title || !it.message) return null;
    items.push(it);
    saveAll(items);
    return it;
}

function update(id, patch = {}) {
    const items = loadAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    saveAll(items);
    return items[idx];
}

function remove(id) {
    const items = loadAll();
    const next = items.filter(i => i.id !== id);
    if (next.length === items.length) return false;
    saveAll(next);
    return true;
}

function list({ status = null, severity = null, limit = 100 } = {}) {
    let items = loadAll();
    // Auto-resucitar snoozed cuyo plazo ya pasó
    const now = Date.now();
    let changed = false;
    for (const i of items) {
        if (i.status === 'snoozed' && i.snoozedUntil && new Date(i.snoozedUntil).getTime() <= now) {
            i.status = 'queued';
            i.snoozedUntil = null;
            changed = true;
        }
    }
    if (changed) saveAll(items);

    if (status)   items = items.filter(i => i.status === status);
    if (severity) items = items.filter(i => i.severity === severity);
    items.sort((a, b) => {
        const sevOrder = { high: 0, mid: 1, low: 2 };
        const sa = sevOrder[a.severity] ?? 5, sb = sevOrder[b.severity] ?? 5;
        if (sa !== sb) return sa - sb;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return items.slice(0, limit);
}

function stats() {
    const items = loadAll();
    const by = { queued: 0, shown: 0, acted: 0, dismissed: 0, snoozed: 0 };
    for (const i of items) by[i.status] = (by[i.status] || 0) + 1;
    return { total: items.length, byStatus: by };
}

function clear() { saveAll([]); return true; }

module.exports = { add, update, remove, list, stats, clear, _loadAll: loadAll };
