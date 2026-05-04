/* =============================================
   GUNTER SERVICE - Premium Intelligence (Sprint B)
   -------------------------------------------------
   Cliente del backend /api/premium-intel.
   Cada método respeta el flag premium correspondiente:
   si está OFF, devuelve respuesta humana en lugar de
   ejecutar.

   API:
     await GunterPremiumIntel.getDailyPlan(opts?)
     await GunterPremiumIntel.getWeeklyPlan(opts?)
     await GunterPremiumIntel.getProjectFollowUps(opts?)
     await GunterPremiumIntel.getProjectExecutiveSummary(projectId, opts?)
     await GunterPremiumIntel.getMeetingFollowUp(projectId, meetingId?)
     await GunterPremiumIntel.getUrgencyRanking(scope?, opts?)
     await GunterPremiumIntel.getProject360(projectId)
     await GunterPremiumIntel.getDecisions(filter?)
     await GunterPremiumIntel.detectDecisionsFromText(text, context?)
     await GunterPremiumIntel.getSmartWhatsappAlerts(opts?)
     await GunterPremiumIntel.createDelegationDraft(opts)
     await GunterPremiumIntel.handlePremiumIntent(intent, entities, context)

   Cada método retorna la respuesta canónica del backend:
     { success, data, summary, naturalResponse, warnings,
       sources, requiresConfirmation, confirmationQuestion,
       generatedAt }

   Cache cliente (TTL 90s) para evitar llamadas repetidas
   en el mismo render.
   ============================================= */

(function () {
    const ENDPOINT = (window.GUNTER_CONFIG?.PROXY_PREMIUM_INTEL_URL) || '/api/premium-intel';
    const CACHE_TTL_MS = 90 * 1000;
    const cache = new Map();

    // Mapa intent del usuario → action backend + flag premium requerido
    const INTENT_MAP = {
        daily_plan:                { action: 'daily_plan',                flag: 'dailyPlanner' },
        weekly_plan:               { action: 'weekly_plan',               flag: 'weeklyPlanner' },
        project_followup:          { action: 'project_followups',         flag: 'projectAutoFollowUp' },
        project_summary:           { action: 'project_executive_summary', flag: 'projectExecutiveSummary' },
        meeting_followup:          { action: 'meeting_followup',          flag: 'meetingSmartFollowUp' },
        urgency_query:             { action: 'urgency_ranking',           flag: 'urgencyRanking' },
        project_360:               { action: 'project_360',               flag: 'project360' },
        decision_query:            { action: 'decisions_list',            flag: 'decisionCenter' },
        decision_create:           { action: 'decisions_detect',          flag: 'decisionCenter' },
        smart_alerts:              { action: 'wa_alerts',                 flag: 'smartWhatsappAlerts' },
        delegation:                { action: 'delegation_draft',          flag: 'delegationMode' }
    };

    function flagOn(flag) {
        return !!(window.PremiumFeaturesService?.isEnabled?.(flag));
    }

    function offResponse(flagLabel) {
        return {
            success: false,
            data: null,
            summary: '',
            naturalResponse: `La función premium "${flagLabel}" está desactivada. Puedes activarla en Configuración de Funciones Premium.`,
            warnings: ['feature-off'],
            sources: [],
            requiresConfirmation: false,
            confirmationQuestion: null,
            generatedAt: new Date().toISOString()
        };
    }

    async function _call(action, params = {}, { cacheKey = null } = {}) {
        if (cacheKey) {
            const it = cache.get(cacheKey);
            if (it && (Date.now() - it.at) < CACHE_TTL_MS) return it.value;
        }
        try {
            const resp = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, params })
            });
            const json = await resp.json().catch(() => null);
            if (!resp.ok || !json) {
                return {
                    success: false,
                    naturalResponse: 'No pude conectar con el backend de Gunter.',
                    warnings: [`http-${resp.status}`],
                    generatedAt: new Date().toISOString()
                };
            }
            if (cacheKey && json.success) cache.set(cacheKey, { value: json, at: Date.now() });
            return json;
        } catch (err) {
            return {
                success: false,
                naturalResponse: 'No pude conectar con el backend de Gunter.',
                warnings: [err.message || String(err)],
                generatedAt: new Date().toISOString()
            };
        }
    }

    function clearCache() { cache.clear(); }

    // ---------- Public methods ----------
    async function getDailyPlan(opts = {}) {
        if (!flagOn('dailyPlanner')) return offResponse('Planificador del día');
        const date = opts.date || new Date().toISOString().slice(0, 10);
        return _call('daily_plan', { date, ...opts }, { cacheKey: `daily:${date}` });
    }

    async function getWeeklyPlan(opts = {}) {
        if (!flagOn('weeklyPlanner')) return offResponse('Organiza mi semana');
        const startDate = opts.startDate || new Date().toISOString().slice(0, 10);
        return _call('weekly_plan', { startDate, ...opts }, { cacheKey: `weekly:${startDate}` });
    }

    async function getProjectFollowUps(opts = {}) {
        if (!flagOn('projectAutoFollowUp')) return offResponse('Seguimiento automático de proyectos');
        return _call('project_followups', opts, { cacheKey: `followups:${opts.projectId || '*'}` });
    }

    async function getProjectExecutiveSummary(projectId, opts = {}) {
        if (!flagOn('projectExecutiveSummary')) return offResponse('Resumen ejecutivo por proyecto');
        if (!projectId) return offResponse('Resumen ejecutivo (proyecto requerido)');
        return _call('project_executive_summary', { projectId, ...opts },
            { cacheKey: opts.force ? null : `summary:${projectId}` });
    }

    async function getMeetingFollowUp(projectId, meetingId = null) {
        if (!flagOn('meetingSmartFollowUp')) return offResponse('Follow-up inteligente de reuniones');
        return _call('meeting_followup', { projectId, meetingId },
            { cacheKey: `meetingfu:${projectId}:${meetingId || 'last'}` });
    }

    async function getUrgencyRanking(scope = 'today', opts = {}) {
        if (!flagOn('urgencyRanking')) return offResponse('Ranking de urgencia');
        return _call('urgency_ranking', { scope, ...opts },
            { cacheKey: `urgency:${scope}:${opts.projectId || '*'}` });
    }

    async function getProject360(projectId) {
        if (!flagOn('project360')) return offResponse('Cliente / Proyecto 360');
        if (!projectId) return offResponse('Proyecto 360 (proyecto requerido)');
        return _call('project_360', { projectId }, { cacheKey: `360:${projectId}` });
    }

    async function getDecisions(filter = {}) {
        if (!flagOn('decisionCenter')) return offResponse('Centro de decisiones');
        return _call('decisions_list', filter, { cacheKey: `decisions:${JSON.stringify(filter)}` });
    }

    async function detectDecisionsFromText(text, context = {}) {
        if (!flagOn('decisionCenter')) return offResponse('Centro de decisiones');
        return _call('decisions_detect', { text, context });
    }

    async function getSmartWhatsappAlerts(opts = {}) {
        if (!flagOn('smartWhatsappAlerts')) return offResponse('Alertas inteligentes por WhatsApp');
        return _call('wa_alerts', opts);
    }

    async function createDelegationDraft(opts) {
        if (!flagOn('delegationMode')) return offResponse('Modo delegación');
        return _call('delegation_draft', opts);
    }

    /**
     * Punto único usado por el pipeline cognitivo. Recibe un intent
     * detectado y retorna la respuesta natural lista para mostrar.
     */
    async function handlePremiumIntent(intent, entities = {}, context = {}) {
        const map = INTENT_MAP[intent];
        if (!map) {
            return {
                success: false,
                naturalResponse: 'No reconozco esa intención premium.',
                warnings: [`unknown-intent:${intent}`],
                generatedAt: new Date().toISOString()
            };
        }
        if (!flagOn(map.flag)) return offResponse(map.flag);
        // Mapeo de entities → params de cada action
        const params = mapEntitiesToParams(intent, entities, context);
        return _call(map.action, params);
    }

    function mapEntitiesToParams(intent, e, ctx) {
        const today = new Date().toISOString().slice(0, 10);
        switch (intent) {
            case 'daily_plan':       return { date: e.date || today, tz: ctx.timezone };
            case 'weekly_plan':      return { startDate: e.startDate || e.date || today, tz: ctx.timezone };
            case 'project_followup': return { projectId: e.projectId || null };
            case 'project_summary':  return { projectId: e.projectId, force: !!e.force };
            case 'meeting_followup': return { projectId: e.projectId, meetingId: e.meetingId || null };
            case 'urgency_query':    return { scope: e.scope || 'today', projectId: e.projectId || null };
            case 'project_360':      return { projectId: e.projectId };
            case 'decision_query':   return { projectId: e.projectId || null, q: e.query || null, since: e.since || null };
            case 'decision_create':  return { text: e.text, context: { source: 'manual', date: e.date } };
            case 'smart_alerts':     return { types: e.types || ['morning', 'payments', 'risk'], tz: ctx.timezone };
            case 'delegation':       return {
                instruction: e.instruction || e.text,
                recipient: e.recipient || null,
                tone: e.tone || 'cordial',
                projectMatch: e.projectMatch || null,
                dueAt: e.dueAt || null
            };
            default: return e;
        }
    }

    window.GunterPremiumIntel = {
        getDailyPlan, getWeeklyPlan,
        getProjectFollowUps,
        getProjectExecutiveSummary,
        getMeetingFollowUp,
        getUrgencyRanking,
        getProject360,
        getDecisions, detectDecisionsFromText,
        getSmartWhatsappAlerts,
        createDelegationDraft,
        handlePremiumIntent,
        clearCache,
        INTENT_MAP
    };
})();
