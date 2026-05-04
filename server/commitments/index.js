/* =============================================
   COMMITMENTS — Facade (v2 — F2)
   -------------------------------------------------
   Punto de entrada para server.js y otros módulos
   (whatsapp/handler, premium-intel).
   ============================================= */

const store = require('./store');
const extractor = require('./extractor');

/**
 * Procesa texto entrante: extrae compromisos y los persiste.
 */
async function ingestText(opts = {}) {
    const detected = await extractor.extractCommitments(opts);
    if (!detected.length) return { detected: 0, created: [] };
    const enriched = detected.map(c => ({
        ...c,
        channel: opts.sourceType || 'manual',
        projectId: opts.projectId || null
    }));
    const created = store.addBulk(enriched);
    return { detected: detected.length, created };
}

/**
 * Verifica si un evento (nuevo doc, nueva tarea, mensaje saliente) cumple commitments.
 * Marca como fulfilled los que el LLM identifique.
 */
async function reconcile(event = {}) {
    const pending = store.list({ status: 'pending' });
    if (!pending.length) return { matched: [], updated: 0 };
    const ids = await extractor.checkFulfillmentLLM({ pendingCommitments: pending, event });
    const updated = [];
    const now = new Date().toISOString();
    for (const id of ids) {
        const u = store.update(id, {
            status: 'fulfilled',
            fulfilledAt: now,
            fulfillmentNote: event.title || event.id || 'auto-detected'
        });
        if (u) updated.push(u);
    }
    return { matched: ids, updated: updated.length, items: updated };
}

function listAll(opts) {
    store.recomputeOverdue();
    return store.list(opts);
}

function statsAll() {
    store.recomputeOverdue();
    return store.stats();
}

function markFulfilled(id, note = '') {
    return store.update(id, {
        status: 'fulfilled',
        fulfilledAt: new Date().toISOString(),
        fulfillmentNote: note
    });
}

function markCancelled(id, reason = '') {
    return store.update(id, {
        status: 'cancelled',
        fulfillmentNote: reason
    });
}

function addManual(payload) {
    return store.add({
        ...payload,
        source: payload.source || { type: 'manual', ts: new Date().toISOString() }
    });
}

module.exports = {
    ingestText,
    reconcile,
    listAll,
    statsAll,
    markFulfilled,
    markCancelled,
    addManual,
    remove: store.remove,
    clear: store.clear,
    _store: store,
    _extractor: extractor
};
