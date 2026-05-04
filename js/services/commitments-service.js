/* =============================================
   GUNTER SERVICE - Commitments (v2 — F2)
   -------------------------------------------------
   Wrapper sobre /api/commitments. Detecta promesas en
   transcripciones, mensajes y chat; trackea cumplimiento.
   ============================================= */

(function () {
    if (window.GunterCommitmentsService) return;

    function flagOn() {
        return !!(window.PremiumFeaturesService?.isEnabled?.('commitmentTracker'));
    }

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || 'http://localhost:3001') + '/api/commitments';
    }

    async function call(op, params = {}) {
        const resp = await fetch(url(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params })
        });
        if (!resp.ok) throw new Error(`commitments HTTP ${resp.status}`);
        const json = await resp.json();
        if (!json.success) throw new Error(json.warnings?.[0] || 'commitments fail');
        return json.data;
    }

    /**
     * Procesa un texto en busca de compromisos (silencioso si flag OFF).
     * @returns {Promise<{detected:number, created:Array}>}
     */
    async function ingestText({ text, sourceType = 'manual', sourceRefId = null, sourceTs = null, projectId = null } = {}) {
        if (!flagOn()) return { detected: 0, created: [] };
        if (!text || String(text).length < 20) return { detected: 0, created: [] };
        try {
            const ctx = window.GunterContextProvider?.get?.() || {};
            return await call('ingest', {
                text,
                sourceType,
                sourceRefId,
                sourceTs: sourceTs || new Date().toISOString(),
                projectId,
                userName: ctx.userName || 'yo',
                timezone: ctx.timezone || 'America/Bogota'
            });
        } catch (e) {
            console.warn('[commitments] ingest failed:', e.message);
            return { detected: 0, created: [] };
        }
    }

    async function reconcile(event) {
        if (!flagOn()) return { matched: [], updated: 0 };
        try { return await call('reconcile', { event }); }
        catch (e) { return { matched: [], updated: 0 }; }
    }

    async function list(params = {}) {
        try { const r = await call('list', params); return r?.items || []; }
        catch (e) { return []; }
    }

    async function stats() {
        try { return await call('stats'); }
        catch (e) { return { total: 0, byStatus: {}, oldestPendingAt: null }; }
    }

    async function markFulfilled(id, note = '') {
        return call('mark_fulfilled', { id, note });
    }

    async function markCancelled(id, reason = '') {
        return call('mark_cancelled', { id, reason });
    }

    async function addManual(payload) {
        return call('add_manual', payload);
    }

    async function remove(id) {
        return call('remove', { id });
    }

    async function clear() {
        return call('clear');
    }

    window.GunterCommitmentsService = {
        ingestText, reconcile, list, stats,
        markFulfilled, markCancelled, addManual, remove, clear,
        flagOn
    };
})();
