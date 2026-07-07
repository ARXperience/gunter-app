/* =============================================
   GUNTER � Service Worker Updater (auto-refresh)
   -------------------------------------------------
   Detecta cuando hay una nueva versión del SW y
   fuerza el update + reload. Evita que el usuario
   se quede con CSS viejo cacheado.
   ============================================= */
(function () {
    if (!('serviceWorker' in navigator)) return;

    const CURRENT_APP_VERSION = "v50-tutorgate-1783400000000";

    // Al cargar la página, verifica si hay update del SW
    navigator.serviceWorker.getRegistration()
        .then(reg => {
            if (!reg) return;
            // Forzar check de update
            reg.update().catch(() => {});

            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[sw-updater] Nueva versión detectada, forzando skip waiting');
                        nw.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });
        })
        .catch(() => {});

    // Cuando el nuevo SW toma control, recargar para que aplique
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('[sw-updater] SW cambió, recargando⬦');
        location.reload();
    });

    // Fix agresivo: si el usuario tiene un SW viejo (versión < v6),
    // desregistrarlo forzosamente para que la app cargue fresh
    const KEY = 'gunter_app_version';
    try {
        const savedVer = localStorage.getItem(KEY);
        if (savedVer !== CURRENT_APP_VERSION) {
            console.log('[sw-updater] Versión app cambió:', savedVer, '� ', CURRENT_APP_VERSION);
            navigator.serviceWorker.getRegistrations().then(regs => {
                for (const r of regs) r.unregister().catch(() => {});
            }).finally(() => {
                // Vaciar caches manualmente también
                if ('caches' in window) {
                    caches.keys().then(names => {
                        Promise.all(names.map(n => caches.delete(n))).finally(() => {
                            localStorage.setItem(KEY, CURRENT_APP_VERSION);
                            // Reload SIN cache
                            setTimeout(() => location.reload(), 200);
                        });
                    });
                } else {
                    localStorage.setItem(KEY, CURRENT_APP_VERSION);
                    setTimeout(() => location.reload(), 200);
                }
            });
        }
    } catch (e) {
        console.warn('[sw-updater] error:', e);
    }
})();
