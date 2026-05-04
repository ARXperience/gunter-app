/* =============================================
   GUNTER SERVICE - Knowledge Sync (Fase 11.3)
   -------------------------------------------------
   Empuja al backend el ProjectKnowledgeSnapshot
   para que WhatsApp tenga acceso a los proyectos.

   Estrategia:
     - Debounce 2s (multiples cambios → un solo push)
     - Skip si hash no cambió desde el último push
     - Auto-trigger en eventos del sistema
     - Manual: GunterKnowledgeSync.syncNow()
     - Status visible en GunterStatusBus

   Eventos del browser que disparan sync:
     - page load (1s)
     - tasks-changed
     - events-changed
     - reminders-changed
     - documents-changed
     - gunter-data-changed (custom; emitido a mano)
     - gunterPremiumFeaturesChange (whatsappAssistant on)
     - storage events (otra pestaña)
   ============================================= */

(function () {
    if (window.__GUNTER_KNOW_SYNC__) return;
    window.__GUNTER_KNOW_SYNC__ = true;

    const ENDPOINT = (window.GUNTER_CONFIG?.PROXY_KNOWLEDGE_SYNC_URL) || '/api/knowledge/sync';
    const DEBOUNCE_MS = 2000;
    const MIN_INTERVAL_MS = 1500;        // entre pushes reales (post-debounce)

    let debounceTimer = null;
    let lastPushAt = 0;
    let lastHash = null;
    let inFlight = false;
    let listeners = new Set();

    function emit(state, detail = {}) {
        const payload = { state, ...detail, lastHash, lastPushAt };
        listeners.forEach(fn => { try { fn(payload); } catch {} });
        try { window.dispatchEvent(new CustomEvent('gunter-knowledge-sync', { detail: payload })); } catch {}
        if (window.GunterStatusBus) {
            if (state === 'pushing') window.GunterStatusBus.set('knowledge:sync', 'active', { label: 'Sincronizando memoria…' });
            else if (state === 'ok')   window.GunterStatusBus.set('knowledge:sync', 'success', { label: 'Memoria sincronizada' });
            else if (state === 'fail') window.GunterStatusBus.set('knowledge:sync', 'error', { label: detail.error || 'Falló sync de memoria' });
            else if (state === 'idle') window.GunterStatusBus.clear('knowledge:sync');
        }
    }

    async function syncNow({ force = false, silent = false } = {}) {
        if (inFlight) return { skipped: 'in-flight' };
        if (!window.GunterProjectKnowledge) {
            return { skipped: 'no-knowledge-service' };
        }

        // Throttle entre pushes consecutivos
        const since = Date.now() - lastPushAt;
        if (!force && since < MIN_INTERVAL_MS) {
            return { skipped: 'throttled', wait: MIN_INTERVAL_MS - since };
        }

        try {
            const snap = await window.GunterProjectKnowledge.build();
            const hash = window.GunterProjectKnowledge.hash(snap);
            if (!force && hash === lastHash) {
                if (!silent) emit('idle', { reason: 'no-changes' });
                return { skipped: 'no-changes' };
            }

            inFlight = true;
            emit('pushing', { hash });

            const resp = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snap)
            });

            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 140)}`);
            }
            const data = await resp.json();
            lastHash = hash;
            lastPushAt = Date.now();
            emit('ok', { metadata: data.metadata });
            return { ok: true, metadata: data.metadata };
        } catch (err) {
            // Mensaje humano via error-mapper si está disponible
            const human = window.GunterErrors?.format1?.(err) || (err.message || String(err));
            emit('fail', { error: human });
            // Toast solo si NO es silent (no spam en triggers automáticos)
            if (!silent && window.GunterNotificationsService?.showToast) {
                window.GunterNotificationsService.showToast(
                    'No pude sincronizar la memoria con WhatsApp, pero tus datos siguen guardados localmente.',
                    { variant: 'warn', duration: 5000, silent: true }
                );
            }
            return { ok: false, error: human };
        } finally {
            inFlight = false;
        }
    }

    function scheduleSync({ silent = true, reason = 'event' } = {}) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            syncNow({ silent }).catch(() => {});
        }, DEBOUNCE_MS);
    }

    // ---------- Triggers ----------
    function wireTriggers() {
        const evts = [
            'tasks-changed',
            'events-changed',
            'reminders-changed',
            'documents-changed',
            'gunter-data-changed'
        ];
        for (const e of evts) {
            window.addEventListener(e, () => scheduleSync({ reason: e }));
        }
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (e.detail?.key === 'whatsappAssistant' && e.detail?.value === true) {
                scheduleSync({ reason: 'whatsapp-on' });
            }
        });
        // Cambios desde otras pestañas: storage event en gunter_data o gunter_generated_analyses
        window.addEventListener('storage', (e) => {
            if (e.key === 'gunter_data' || e.key === 'gunter_generated_analyses') {
                scheduleSync({ reason: 'storage' });
            }
        });
        // Sync periódico defensivo (si la app está abierta) — cada 15 min
        setInterval(() => syncNow({ silent: true }).catch(() => {}), 15 * 60 * 1000);
    }

    function start() {
        wireTriggers();
        // Primera sync 1.5s después del load para no competir con render inicial
        setTimeout(() => syncNow({ silent: true }).catch(() => {}), 1500);
    }

    function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.GunterKnowledgeSync = {
        syncNow,
        scheduleSync,
        onStateChange,
        get state() {
            return { lastHash, lastPushAt, inFlight };
        }
    };
})();
