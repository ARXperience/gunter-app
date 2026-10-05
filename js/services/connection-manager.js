/* Gunter Web Connection Manager: explicit, persistent, idempotent outbox. */
(function (root) {
    if (root.GunterConnectionManager) return;
    const KEY = 'gunter_control_outbox_v1';
    const MAX_ITEMS = 200;
    let flushing = false;

    function read() { try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
    function write(items) { try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_ITEMS))); } catch { } emit('QUEUED'); }
    function operationId() { return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }

    function enqueue(type, payload, options = {}) {
        if (type !== 'settings.patch') throw new Error('Operación offline no permitida');
        const items = read();
        if (payload?.key) {
            const index = items.findIndex(item => item.type === type && item.payload?.key === payload.key);
            if (index >= 0) items.splice(index, 1);
        }
        const id = operationId();
        const item = {
            contractVersion: 1, operationId: id, idempotencyKey: options.idempotencyKey || id, type,
            payload: JSON.parse(JSON.stringify(payload || {})),
            baseUpdatedAt: options.baseUpdatedAt || null,
            conflictPolicy: options.conflictPolicy || 'client_wins',
            queuedAt: new Date().toISOString(), attempts: 0
        };
        items.push(item); write(items);
        return { queued: true, operation: item, pending: items.length };
    }

    async function flush() {
        if (flushing || navigator.onLine === false || root.GunterConnectivity?.getState?.().apiHealthy === false) return status();
        const items = read();
        if (!items.length || !root.GunterControlPlane?.sync) return status();
        flushing = true; emit('SYNCING');
        try {
            const batch = items.slice(0, 50).map(item => ({ ...item, attempts: Number(item.attempts || 0) + 1 }));
            const response = await root.GunterControlPlane.sync(batch);
            const terminal = new Set((response.results || []).filter(result => ['APPLIED', 'REJECTED'].includes(result.status) || result.duplicate).map(result => result.operationId));
            const conflicts = new Set((response.results || []).filter(result => result.status === 'CONFLICT').map(result => result.operationId));
            const remaining = read().filter(item => !terminal.has(item.operationId)).map(item => conflicts.has(item.operationId) ? { ...item, conflict: true } : item);
            write(remaining);
            root.dispatchEvent?.(new CustomEvent('gunter-sync-results', { detail: response }));
            emit(remaining.length ? (conflicts.size ? 'CONFLICT' : 'QUEUED') : 'ONLINE');
            return { ...status(), response };
        } catch (error) {
            const current = read().map(item => ({ ...item, attempts: Number(item.attempts || 0) + 1, lastError: String(error.message || error).slice(0, 180) }));
            write(current); emit('DEGRADED', error.message); return { ...status(), error: error.message };
        } finally { flushing = false; }
    }

    function discard(operationIdValue) { const next = read().filter(item => item.operationId !== operationIdValue); write(next); return status(); }
    function status() { const items = read(); return { state: flushing ? 'SYNCING' : navigator.onLine === false ? 'OFFLINE' : items.some(item => item.conflict) ? 'CONFLICT' : items.length ? 'QUEUED' : 'ONLINE', pending: items.length, conflicts: items.filter(item => item.conflict).length, items }; }
    function emit(forcedState, error = null) {
        const snapshot = status(); if (forcedState) snapshot.state = forcedState; if (error) snapshot.error = error;
        root.dispatchEvent?.(new CustomEvent('gunter-sync-state', { detail: snapshot }));
        if (root.GunterStatusBus) {
            if (snapshot.pending) root.GunterStatusBus.set('connection:outbox', snapshot.state === 'CONFLICT' ? 'error' : 'pending', { label: `${snapshot.pending} cambio(s) por sincronizar` });
            else root.GunterStatusBus.clear('connection:outbox');
        }
        return snapshot;
    }

    root.addEventListener?.('online', () => flush());
    root.addEventListener?.('gunter-connectivity-change', event => { if (event.detail?.online && event.detail?.apiHealthy) flush(); });
    root.GunterAuth?.onReady?.(() => flush());
    setInterval(() => { if (read().length) flush(); }, 30000);
    root.GunterConnectionManager = { enqueue, enqueueSetting: (payload, options) => enqueue('settings.patch', payload, options), flush, discard, status };
    queueMicrotask(() => { emit(); if (read().length) flush(); });
})(typeof window !== 'undefined' ? window : globalThis);
