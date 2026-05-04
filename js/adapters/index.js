/* =============================================
   GUNTER ADAPTERS - Registry & Bootstrap (Fase 7)
   -------------------------------------------------
   Hub central. Cargar este script DESPUÉS de los 5
   adapters individuales para tener un único punto de
   acceso `window.GunterAdapters` con helpers extra:

     GunterAdapters.list()         → ['storage','auth','notification','calendar','voice']
     GunterAdapters.statusReport() → diagnóstico para debug
     GunterAdapters.useDefaults()  → fija las impls "local/google" en todos

   Patrón de uso (consumidor):
     const tasks = await GunterAdapters.storage.getCollection('tasks');
     await GunterAdapters.calendar.create({ title, startAt });
     GunterAdapters.notification.toast('✓ Listo', { variant: 'success' });

   Patrón de extensión (futuro):
     GunterAdapters.storage.register('remote', myRemoteImpl);
     GunterAdapters.storage.use('remote');
   ============================================= */

(function () {
    const adapters = window.GunterAdapters || {};
    window.GunterAdapters = adapters;

    function list() {
        return Object.keys(adapters).filter(k => typeof adapters[k] === 'object' && adapters[k]?.activeName);
    }

    function statusReport() {
        const out = {};
        for (const name of list()) {
            try {
                out[name] = {
                    active: adapters[name].activeName,
                    healthy: !!adapters[name].current
                };
            } catch (e) {
                out[name] = { active: null, healthy: false, error: e.message };
            }
        }
        return out;
    }

    function useDefaults() {
        const defaults = { storage: 'local', auth: 'google', notification: 'local', calendar: 'google', voice: 'local' };
        for (const [k, v] of Object.entries(defaults)) {
            try { adapters[k]?.use?.(v); } catch (e) { console.warn(`[adapters] use(${k}, ${v}) failed:`, e.message); }
        }
    }

    adapters.list = list;
    adapters.statusReport = statusReport;
    adapters.useDefaults = useDefaults;

    // Log diagnóstico (solo si window.__GUNTER_ADAPTERS_DEBUG__ está activo)
    if (window.__GUNTER_ADAPTERS_DEBUG__) {
        console.log('[adapters] ready:', statusReport());
    }
})();
