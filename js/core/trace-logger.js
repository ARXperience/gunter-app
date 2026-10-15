/* =============================================
   GUNTER CORE - Trace Logger
   -------------------------------------------------
   Observa el pipeline. Guarda las últimas 100
   ejecuciones en localStorage para debug/replay.
   ============================================= */

(function () {
    const KEY = 'gunter_pipeline_traces';
    const MAX = 100;

    function now() { return performance.now(); }

    function startStage(state, stage) {
        state._stageStart = now();
        state._currentStage = stage;
    }

    function endStage(state, extra = {}) {
        const dur = Math.round(now() - (state._stageStart || now()));
        state.trace.push({
            stage: state._currentStage,
            at: new Date().toISOString(),
            durationMs: dur,
            ...extra
        });
        if (window.__GUNTER_DEBUG__) {
            console.log(`[pipeline ${state.pipelineId}] ${state._currentStage}  ${dur}ms`, extra);
        }
    }

    function recordError(state, stage, err) {
        state.errors.push({
            stage,
            at: new Date().toISOString(),
            message: err?.message || String(err),
            stack: err?.stack
        });
        console.error(`[pipeline ${state.pipelineId}] ${stage} error:`, err);
    }

    function persist(state) {
        try {
            const all = JSON.parse(localStorage.getItem(KEY) || '[]');
            const snapshot = {
                // Never attribute an in-flight trace to the next signed-in user.
                ownerId: state.input?.userContext?.identity?.userId === currentOwner() ? currentOwner() : null,
                pipelineId: state.pipelineId,
                input: state.input?.text,
                intent: state.intent?.primary,
                stages: state.trace,
                errors: state.errors,
                finishedAt: new Date().toISOString()
            };
            all.push(snapshot);
            if (all.length > MAX) all.splice(0, all.length - MAX);
            localStorage.setItem(KEY, JSON.stringify(all));
        } catch {}
    }

    function getAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
    }

    function clear() { localStorage.removeItem(KEY); }

    function currentOwner() {
        const auth = window.GunterAuth;
        if ((auth?.canAccessLocalData && !auth.canAccessLocalData()) || (auth?.isVerified && !auth.isVerified())) return null;
        const id = auth?.getUser?.()?.id;
        if (!id || id === 'local-user') return null;
        try {
            const deviceOwner = localStorage.getItem('gunter_device_user');
            if (deviceOwner && deviceOwner !== String(id)) return null;
        } catch { return null; }
        return String(id);
    }

    function getDiagnosticSummary() {
        const owner = currentOwner();
        const rows = owner ? getAll().filter(row => row.ownerId && String(row.ownerId) === String(owner)) : [];
        return { available: !!owner, total: rows.length,
            errors: rows.reduce((sum, row) => sum + (Array.isArray(row.errors) ? row.errors.length : 0), 0) };
    }

    window.GunterTraceLogger = { startStage, endStage, recordError, persist, getAll, clear, getDiagnosticSummary };

    // Enable debug via URL ?debug=1
    if (location.search.includes('debug=1')) window.__GUNTER_DEBUG__ = true;
})();
