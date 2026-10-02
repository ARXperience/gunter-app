/* Registers the current browser as a WEB node and maintains its heartbeat. */
(function () {
    let nodeId = null;
    let timer = null;
    let syncing = false;

    async function start(user) {
        if (!user || !window.GunterControlPlane || timer) return;
        try {
            const node = await window.GunterControlPlane.ensureWebNode();
            nodeId = node?.nodeId || null;
            if (!nodeId) return;
            timer = setInterval(() => beat('ONLINE'), 30000);
            window.addEventListener('online', onOnline);
            window.addEventListener('offline', onOffline);
            document.addEventListener('visibilitychange', onVisibility);
        } catch (error) {
            console.warn('[web-node] registro diferido:', error.message);
        }
    }

    async function beat(state) {
        if (!nodeId || navigator.onLine === false) return;
        try { await window.GunterControlPlane.heartbeat(nodeId, state); }
        catch (error) { console.warn('[web-node] heartbeat:', error.message); }
    }
    async function onOnline() {
        if (syncing) return;
        syncing = true;
        await beat('SYNCING');
        await window.GunterConnectionManager?.flush?.();
        await beat('ONLINE');
        syncing = false;
    }
    function onOffline() {
        window.dispatchEvent(new CustomEvent('gunter-node-state', { detail: { nodeId, state: 'OFFLINE', local: true } }));
    }
    function onVisibility() { if (document.visibilityState === 'visible') beat('ONLINE'); }

    function boot() {
        if (window.GunterAuth?.onReady) window.GunterAuth.onReady(start);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
