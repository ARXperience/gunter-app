/* =============================================
   GUNTER SERVICE - Status Bus (Fase 6)
   -------------------------------------------------
   Pub/sub central de estados de operación. Cualquier
   módulo puede publicar un estado en curso (saving,
   syncing, processing, transcribing) y suscriptores
   (banner global, indicadores) reaccionan.

   API:
     GunterStatusBus.set(key, state, meta?)
       - key: string identificador único de la operación
              (ej: 'transcribe:s_123', 'embeddings:rebuild')
       - state: 'pending' | 'active' | 'success' | 'error' | 'idle'
       - meta: { label?, hint?, progress? (0-100) }

     GunterStatusBus.clear(key)        // = set(key, 'idle')
     GunterStatusBus.get(key)          // → { state, meta } | null
     GunterStatusBus.getAll()          // → Map snapshot
     GunterStatusBus.onChange(fn)      // suscripción → unsubscribe()
     GunterStatusBus.activeOps()       // → array de ops con state pending|active

   Eventos DOM emitidos:
     window 'gunter-status-change'  detail: { key, state, meta }
   ============================================= */

(function () {
    const VALID_STATES = new Set(['pending', 'active', 'success', 'error', 'idle']);
    const store = new Map();         // key → { state, meta, ts }
    const listeners = new Set();

    function set(key, state, meta = {}) {
        if (!key) return;
        if (!VALID_STATES.has(state)) {
            console.warn('[status-bus] invalid state:', state);
            return;
        }
        const prev = store.get(key);
        if (state === 'idle') {
            store.delete(key);
        } else {
            store.set(key, { state, meta: { ...(prev?.meta || {}), ...meta }, ts: Date.now() });
        }
        const detail = { key, state, meta };
        listeners.forEach(fn => { try { fn(detail); } catch (e) { console.warn('[status-bus] listener error:', e); } });
        try { window.dispatchEvent(new CustomEvent('gunter-status-change', { detail })); } catch {}
    }

    function clear(key) { set(key, 'idle'); }

    function get(key) {
        return store.get(key) || null;
    }

    function getAll() {
        return new Map(store);
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function activeOps() {
        const out = [];
        for (const [key, val] of store.entries()) {
            if (val.state === 'pending' || val.state === 'active') {
                out.push({ key, ...val });
            }
        }
        return out;
    }

    // Helper conveniente: envuelve una promesa con set/clear automáticos.
    async function track(key, label, asyncFn) {
        set(key, 'active', { label });
        try {
            const result = await asyncFn();
            set(key, 'success', { label });
            setTimeout(() => clear(key), 1800);
            return result;
        } catch (err) {
            set(key, 'error', { label, hint: err?.message || String(err) });
            setTimeout(() => clear(key), 4500);
            throw err;
        }
    }

    window.GunterStatusBus = { set, clear, get, getAll, onChange, activeOps, track };
})();
