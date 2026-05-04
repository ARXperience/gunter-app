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

    window.GunterTraceLogger = { startStage, endStage, recordError, persist, getAll, clear };

    // Enable debug via URL ?debug=1
    if (location.search.includes('debug=1')) window.__GUNTER_DEBUG__ = true;
})();
