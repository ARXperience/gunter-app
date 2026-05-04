/* =============================================
   PROACTIVE PULSE — Facade (v2 — F3)
   ============================================= */

const store = require('./store');
const engine = require('./engine');

let commitments = null;
try { commitments = require('../commitments'); } catch { /* opcional */ }

/**
 * Evalúa todos los triggers y agrega nuevas intervenciones a la queue.
 * Devuelve {generated, queueSize, items: nuevasItems}.
 */
async function runTick({ aggression = 'normal', tz = 'America/Bogota' } = {}) {
    const detected = await engine.evaluate({ aggression, tz });
    const created = [];
    for (const i of detected) {
        const r = store.add(i);
        if (r) created.push(r);
    }
    const queueSize = store.list({ status: 'queued' }).length;
    return { generated: created.length, queueSize, items: created, evaluated: detected.length };
}

function getQueue({ status = null, limit = 50 } = {}) {
    return { items: store.list({ status: status || null, limit }), stats: store.stats() };
}

function dismiss(id, reason = '') {
    return store.update(id, { status: 'dismissed', dismissReason: reason || null });
}

function snooze(id, untilTs) {
    const iso = untilTs ? new Date(untilTs).toISOString() : new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    return store.update(id, { status: 'snoozed', snoozedUntil: iso });
}

/**
 * Ejecuta una acción sugerida de una intervención (cuando el usuario click).
 * Actualmente solo registra y marca acted; las acciones que requieren
 * actuación real (commitment_fulfill) se hacen aquí también.
 */
async function act(id, action = {}) {
    const item = store.update(id, { status: 'acted', actedAt: new Date().toISOString(), actionTaken: action });
    if (!item) return null;

    // Acciones server-side
    if (action?.action === 'commitment_fulfill' && action?.payload?.id && commitments?.markFulfilled) {
        commitments.markFulfilled(action.payload.id, 'proactive-pulse');
    }
    if (action?.action === 'commitments_bulk_fulfill' && Array.isArray(action?.payload?.ids) && commitments?.markFulfilled) {
        for (const cid of action.payload.ids) commitments.markFulfilled(cid, 'proactive-pulse');
    }
    return item;
}

function stats() {
    return store.stats();
}

function clear() { return store.clear(); }

module.exports = {
    runTick, getQueue, dismiss, snooze, act, stats, clear,
    _store: store, _engine: engine
};
