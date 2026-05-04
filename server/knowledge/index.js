/* =============================================
   GUNTER KNOWLEDGE — Facade (Fase 11)
   -------------------------------------------------
   Re-exporta los 3 módulos del backend de
   conocimiento para un import único.
   ============================================= */

const store = require('./store');
const search = require('./search');
const summarizer = require('./summarizer');

module.exports = {
    store,
    search,
    summarizer,
    // Convenience passthroughs más usados
    putSnapshot: store.putSnapshot,
    getSnapshot: store.getSnapshot,
    listProjects: store.listProjects,
    getProject: store.getProject,
    stats: store.stats,
    resolveProject: search.resolveProject,
    runSearch: search.search,
    projectContextBundle: search.projectContextBundle,
    globalContextSummary: search.globalContextSummary,
    summarizeProject: summarizer.summarizeProject,
    touchAlias: store.touchAlias,
    getAliases: store.getAliases
};
