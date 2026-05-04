/* =============================================
   GUNTER SERVICE - Proactive Pulse (v2 — F3)
   -------------------------------------------------
   Cliente del agente proactivo. Hace tick periódico
   pidiendo al server que evalúe triggers y popula la
   queue. Notifica con toast + voz cuando hay nuevas
   intervenciones de severidad alta.
   ============================================= */

(function () {
    if (window.GunterProactiveService) return;

    const TICK_MS_DEFAULT = 15 * 60 * 1000; // 15 min
    let tickTimer = null;
    let lastTickAt = 0;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('proactivePulse')); }
    function aggression() {
        return window.PremiumFeaturesService?.get?.('proactivePulseAggression') || 'normal';
    }

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || 'http://localhost:3001') + '/api/proactive';
    }

    async function call(op, params = {}) {
        const resp = await fetch(url(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params })
        });
        if (!resp.ok) throw new Error('proactive HTTP ' + resp.status);
        const j = await resp.json();
        if (!j.success) throw new Error(j.warnings?.[0] || 'proactive fail');
        return j.data;
    }

    async function tick(force = false) {
        if (!flagOn()) return null;
        const now = Date.now();
        if (!force && (now - lastTickAt) < (TICK_MS_DEFAULT - 1000)) return null;
        lastTickAt = now;
        try {
            const ctx = window.GunterContextProvider?.get?.() || {};
            const r = await call('tick', { aggression: aggression(), tz: ctx.timezone || 'America/Bogota' });
            if (r.generated > 0) {
                announceNew(r.items || []);
                window.dispatchEvent(new CustomEvent('gunter-proactive-changed', { detail: r }));
            }
            return r;
        } catch (e) {
            console.warn('[proactive] tick failed:', e.message);
            return null;
        }
    }

    function announceNew(items) {
        const high = items.filter(i => i.severity === 'high');
        const mid  = items.filter(i => i.severity === 'mid');
        const lvl = aggression();

        const total = items.length;
        if (!total) return;

        // Toast siempre que la flag esté on
        if (window.GunterNotificationsService?.showToast) {
            const head = high.length ? `⚡ ${high.length} alerta${high.length > 1 ? 's' : ''} prioritaria${high.length > 1 ? 's' : ''}` : `💡 ${total} sugerencia${total > 1 ? 's' : ''} de Gunter`;
            window.GunterNotificationsService.showToast(head, {
                variant: high.length ? 'warn' : 'info',
                duration: 6000,
                action: { label: 'Ver', onClick: () => window.dispatchEvent(new CustomEvent('gunter-open-tab', { detail: { tab: 'proactive' } })) }
            });
        }

        // Voz si nivel high y voice on
        if (lvl === 'high' && high.length && window.GunterVoice?.speak) {
            try { window.GunterVoice.speak(`Tienes ${high.length} alerta${high.length > 1 ? 's' : ''} prioritaria${high.length > 1 ? 's' : ''}. ${high[0].title}.`, { context: 'proactive' }); } catch {}
        }
    }

    async function getQueue(status = null) {
        try { return await call('queue', { status }); }
        catch { return { items: [], stats: { total: 0, byStatus: {} } }; }
    }

    async function dismiss(id, reason = '')      { return call('dismiss', { id, reason }); }
    async function snooze(id, hours = 4)         {
        const untilTs = Date.now() + Math.max(1, hours) * 3600 * 1000;
        return call('snooze', { id, untilTs });
    }
    async function act(id, action)               { return call('act', { id, action }); }
    async function clear()                       { return call('clear'); }

    function start() {
        if (tickTimer) return;
        if (!flagOn()) return;
        // Tick inicial diferido (8s después de carga, no bloquear)
        setTimeout(() => tick(true), 8000);
        tickTimer = setInterval(() => tick(false), TICK_MS_DEFAULT);
    }

    function stop() {
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }

    // Auto-start si flag ya está on
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
        // Reaccionar a cambios de flag
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!e.detail?.key || e.detail.key === 'proactivePulse') {
                if (flagOn()) start();
                else stop();
            }
        });
    }

    window.GunterProactiveService = {
        tick, getQueue, dismiss, snooze, act, clear, start, stop, flagOn
    };
})();
