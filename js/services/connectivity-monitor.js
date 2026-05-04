/* =============================================
   GUNTER SERVICE - Connectivity Monitor (Fase 6)
   -------------------------------------------------
   Detecta:
     • Sin conexión (navigator.onLine + eventos online/offline)
     • Backend caído (3 fetches /api consecutivos fallidos
       con TypeError o 5xx → modo degradado)

   Renderiza un banner sticky arriba (no intrusivo)
   y publica al StatusBus para que otros módulos
   puedan adaptarse.

   Eventos:
     window 'gunter-connectivity-change' detail: { online, apiHealthy }
   ============================================= */

(function () {
    if (window.__GUNTER_CONN_MON__) return;
    window.__GUNTER_CONN_MON__ = true;

    const STATE = { online: navigator.onLine, apiHealthy: true };
    let consecutiveApiFails = 0;
    const FAIL_THRESHOLD = 3;

    // ---------- Banner ----------
    let banner = null;
    function ensureBanner() {
        if (banner) return banner;
        banner = document.createElement('div');
        banner.id = 'gunter-conn-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 99998;
            padding: 8px 16px;
            font-family: 'Inter', sans-serif;
            font-size: 13px;
            text-align: center;
            transform: translateY(-100%);
            transition: transform 280ms cubic-bezier(.22,.61,.36,1);
            pointer-events: auto;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border-bottom: 1px solid transparent;
        `;
        document.body.appendChild(banner);
        return banner;
    }

    function renderBanner() {
        const el = ensureBanner();
        let visible = false;
        if (!STATE.online) {
            el.textContent = '⚠ Sin conexión a internet — Gunter funciona en modo offline (acciones locales).';
            el.style.background = 'rgba(248,113,113,0.92)';
            el.style.color = '#fff';
            el.style.borderBottomColor = 'rgba(220,38,38,0.6)';
            visible = true;
        } else if (!STATE.apiHealthy) {
            el.textContent = '⚠ El servidor de Gunter no responde — reintentando…';
            el.style.background = 'rgba(251,191,36,0.92)';
            el.style.color = '#1f1408';
            el.style.borderBottomColor = 'rgba(217,119,6,0.6)';
            visible = true;
        }
        el.style.transform = visible ? 'translateY(0)' : 'translateY(-100%)';
    }

    function emitChange() {
        try {
            window.dispatchEvent(new CustomEvent('gunter-connectivity-change', { detail: { ...STATE } }));
        } catch {}
        if (window.GunterStatusBus) {
            if (!STATE.online) window.GunterStatusBus.set('connectivity:offline', 'active', { label: 'Sin conexión' });
            else window.GunterStatusBus.clear('connectivity:offline');

            if (!STATE.apiHealthy) window.GunterStatusBus.set('connectivity:api', 'error', { label: 'Servidor no responde' });
            else window.GunterStatusBus.clear('connectivity:api');
        }
        renderBanner();
    }

    // ---------- Online/offline events ----------
    window.addEventListener('online', () => {
        STATE.online = true;
        consecutiveApiFails = 0;
        STATE.apiHealthy = true;
        emitChange();
    });
    window.addEventListener('offline', () => {
        STATE.online = false;
        emitChange();
    });

    // ---------- Fetch interception ----------
    // Solo monitoreamos llamadas a /api/* (rutas locales del proxy de Gunter).
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = async function (resource, init) {
            const url = typeof resource === 'string' ? resource : (resource?.url || '');
            const isApi = /^(?:https?:\/\/[^/]+)?\/api\//.test(url);
            try {
                const resp = await originalFetch.call(this, resource, init);
                if (isApi) {
                    if (resp.status >= 500) {
                        consecutiveApiFails++;
                    } else {
                        consecutiveApiFails = 0;
                        if (!STATE.apiHealthy) {
                            STATE.apiHealthy = true;
                            emitChange();
                        }
                    }
                    if (consecutiveApiFails >= FAIL_THRESHOLD && STATE.apiHealthy) {
                        STATE.apiHealthy = false;
                        emitChange();
                    }
                }
                return resp;
            } catch (err) {
                if (isApi) {
                    consecutiveApiFails++;
                    if (consecutiveApiFails >= FAIL_THRESHOLD && STATE.apiHealthy) {
                        STATE.apiHealthy = false;
                        emitChange();
                    }
                }
                throw err;
            }
        };
    }

    // ---------- Active health probe (opt-in, lightweight) ----------
    // Cada 60s y solo si tenemos sospecha (apiHealthy=false), hacemos un HEAD a /api/chat.
    setInterval(async () => {
        if (!STATE.online) return;
        if (STATE.apiHealthy) return;
        try {
            // OPTIONS suele ser barato; si el endpoint no la soporta caemos a un POST mínimo no-op.
            const resp = await originalFetch('/api/chat', { method: 'OPTIONS' });
            if (resp.ok || resp.status === 405) {
                consecutiveApiFails = 0;
                STATE.apiHealthy = true;
                emitChange();
            }
        } catch { /* sigue caído */ }
    }, 60_000);

    // Render inicial silencioso (solo si offline desde el arranque)
    if (!STATE.online) emitChange();

    window.GunterConnectivity = {
        getState: () => ({ ...STATE }),
        forceCheck: () => { renderBanner(); }
    };
})();
