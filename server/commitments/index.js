/* =============================================
   COMMITMENTS — Facade (v2 — F2)
   -------------------------------------------------
   Punto de entrada para server.js y otros módulos
   (whatsapp/handler, premium-intel).
   ============================================= */

const store = require('./store');
const extractor = require('./extractor');
const userContext = require('../user-context');
const settings = require('../control-plane/settings');
const openai = require('../openai-client');

/**
 * Procesa texto entrante: extrae compromisos y los persiste.
 */
async function ingestText(opts = {}) {
    const preferences = settings.hybridStatus(userContext.currentUserId());
    if (preferences.privacy === 'LOCAL_ONLY' || preferences.mode === 'LOCAL') {
        return { ok: false, error: 'LOCAL_ONLY_MODE', detected: 0, created: [] };
    }
    if (settings._load(userContext.currentUserId()).values['ai.cloud']?.enabled === false || !openai.hasKey()) {
        return { ok: false, error: 'commitment_provider_unavailable', detected: 0, created: [] };
    }
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
 * El cumplimiento solo se marca con una confirmación explícita y snapshot.
 */
async function reconcile(event = {}) {
    return { matched: [], updated: 0, items: [], reviewRequired: true };
}

function listAll(opts) {
    return store.list(opts);
}

function statsAll() {
    return store.stats();
}

function markFulfilled(input) { return store.markFulfilled(input); }

function markCancelled(input) { return store.markCancelled(input); }

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
    get: store.get,
    snapshot: store.snapshot,
    markFulfilled,
    markCancelled,
    addManual,
    remove: store.remove,
    clear: store.clear,
    _store: store,
    _extractor: extractor
};
