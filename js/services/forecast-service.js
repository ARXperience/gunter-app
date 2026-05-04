/* =============================================
   GUNTER SERVICE - Forecast (v2 — F6)
   ============================================= */

(function () {
    if (window.GunterForecastService) return;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('projectForecast')); }

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || 'http://localhost:3001') + '/api/forecast';
    }

    async function call(op, params = {}) {
        const resp = await fetch(url(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params })
        });
        if (!resp.ok) throw new Error('forecast HTTP ' + resp.status);
        const j = await resp.json();
        if (!j.success) throw new Error(j.warnings?.[0] || 'forecast fail');
        return j.data;
    }

    async function forecastProject(projectId) {
        if (!flagOn()) return { ok: false, reason: 'flag-off' };
        return call('project', { projectId });
    }

    async function forecastAll(topN = 10) {
        if (!flagOn()) return { items: [], totalEvaluated: 0 };
        return call('all', { topN });
    }

    async function history(projectId) {
        try { return await call('history', { projectId }); }
        catch { return []; }
    }

    async function clear() { return call('clear'); }

    window.GunterForecastService = { forecastProject, forecastAll, history, clear, flagOn };
})();
