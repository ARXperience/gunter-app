/* =============================================
   GUNTER SERVICE - PWA Register (Fase 8)
   -------------------------------------------------
   Registra el service worker en cada HTML (idempotente)
   y captura el evento `beforeinstallprompt` para que la
   UI pueda ofrecer "Instalar Gunter" cuando el navegador
   lo permita.

   API:
     GunterPWA.isStandalone()        → bool
     GunterPWA.canInstall()          → bool
     GunterPWA.promptInstall()       → Promise<{outcome: 'accepted'|'dismissed'}>
     GunterPWA.update()              → fuerza skipWaiting + reload
     GunterPWA.clearCache()          → vacía caches del SW
     GunterPWA.onChange(fn)          → notifica cambios (canInstall, updateAvailable)
   ============================================= */

(function () {
    if (window.__GUNTER_PWA__) return;
    window.__GUNTER_PWA__ = true;

    const state = {
        registration: null,
        installPrompt: null,
        updateAvailable: false
    };
    const listeners = new Set();
    function emit() { listeners.forEach(fn => { try { fn(snapshot()); } catch {} }); }
    function snapshot() {
        return {
            canInstall: !!state.installPrompt,
            updateAvailable: state.updateAvailable,
            registered: !!state.registration,
            standalone: isStandalone()
        };
    }

    function isStandalone() {
        return window.matchMedia?.('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function canInstall() { return !!state.installPrompt; }

    async function promptInstall() {
        if (!state.installPrompt) return { outcome: 'unavailable' };
        const p = state.installPrompt;
        state.installPrompt = null;
        emit();
        try {
            p.prompt();
            const choice = await p.userChoice;
            return choice;   // { outcome: 'accepted'|'dismissed' }
        } catch (e) {
            return { outcome: 'error', error: e.message };
        }
    }

    async function update() {
        if (!state.registration) return false;
        try {
            await state.registration.update();
            const sw = state.registration.waiting;
            if (sw) sw.postMessage({ type: 'SKIP_WAITING' });
            return true;
        } catch { return false; }
    }

    async function clearCache() {
        if (!navigator.serviceWorker?.controller) return false;
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => {
                if (e.data?.type === 'CACHE_CLEARED') resolve(true);
            };
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
            setTimeout(() => resolve(false), 3000);
        });
    }

    function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // Capturar prompt de instalación (Chrome/Edge)
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.installPrompt = e;
        emit();
        // Notificación amigable al usuario (silent — no spam de voz)
        try {
            window.GunterNotificationsService?.showToast?.(
                '✨ Gunter se puede instalar como app — abre el menú del navegador.',
                { variant: 'info', duration: 5000, silent: true }
            );
        } catch {}
    });

    window.addEventListener('appinstalled', () => {
        state.installPrompt = null;
        emit();
    });

    // Registrar el SW
    if ('serviceWorker' in navigator) {
        // Esperar load para no competir con render inicial
        const start = () => {
            navigator.serviceWorker.register('/service-worker.js').then(reg => {
                state.registration = reg;
                emit();

                // Detectar nuevo SW esperando para activarse
                reg.addEventListener('updatefound', () => {
                    const sw = reg.installing;
                    if (!sw) return;
                    sw.addEventListener('statechange', () => {
                        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                            state.updateAvailable = true;
                            emit();
                            try {
                                window.GunterNotificationsService?.showToast?.(
                                    '🆕 Hay una nueva versión de Gunter — recarga para aplicarla.',
                                    { variant: 'info', duration: 6000, silent: true }
                                );
                            } catch {}
                        }
                    });
                });
            }).catch(err => {
                console.warn('[pwa] SW registration failed:', err);
            });

            // Si el SW activo cambia (skipWaiting), recarga una sola vez
            let reloaded = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloaded) return;
                reloaded = true;
                window.location.reload();
            });
        };
        if (document.readyState === 'complete') start();
        else window.addEventListener('load', start);
    }

    window.GunterPWA = {
        isStandalone, canInstall, promptInstall, update, clearCache, onChange,
        get state() { return snapshot(); }
    };
})();
