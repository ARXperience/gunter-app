/* =============================================
   PREMIUM INTEL - Facade + dispatcher
   -------------------------------------------------
   Punto único de entrada para todos los módulos.
   Usado por:
     - server.js  → endpoint /api/premium-intel
     - server/whatsapp/handler.js → require directo
   ============================================= */

const planner    = require('./planner');
const followUp   = require('./follow-up');
const summary    = require('./summary');
const urgency    = require('./urgency');
const project360 = require('./project360');
const decisions  = require('./decisions');
const alerts     = require('./alerts');
const delegation = require('./delegation');

// Mapa action → handler. Keys exactas que cliente y handler WA usarán.
const ACTIONS = {
    'daily_plan':                  (p) => planner.getDailyPlan(p),
    'weekly_plan':                 (p) => planner.getWeeklyPlan(p),
    'project_followups':           (p) => followUp.getProjectFollowUps(p),
    'meeting_followup':            (p) => followUp.getMeetingFollowUp(p),
    'project_executive_summary':   (p) => summary.getProjectExecutiveSummary(p),
    'urgency_ranking':             (p) => urgency.getUrgencyRanking(p),
    'project_360':                 (p) => project360.getProject360(p),
    'decisions_list':              (p) => decisions.getDecisions(p),
    'decisions_detect':            (p) => decisions.detectDecisionsFromText(p),
    'wa_alerts':                   (p) => alerts.getSmartWhatsappAlerts(p),
    'delegation_draft':            (p) => delegation.createDelegationDraft(p)
};

async function dispatch(action, payload = {}) {
    const handler = ACTIONS[action];
    if (!handler) {
        return {
            success: false,
            data: null,
            warnings: [`unknown-action:${action}`],
            naturalResponse: `No conozco la acción premium "${action}".`,
            generatedAt: new Date().toISOString()
        };
    }
    try {
        return await handler(payload || {});
    } catch (e) {
        console.error(`[premium-intel] action ${action} threw:`, e);
        return {
            success: false,
            data: null,
            warnings: [e.message || String(e)],
            naturalResponse: 'No pude completar la operación.',
            generatedAt: new Date().toISOString()
        };
    }
}

function listActions() {
    return Object.keys(ACTIONS);
}

module.exports = {
    dispatch,
    listActions,
    // Re-export por si algún módulo quiere acceso directo (sin dispatch)
    planner, followUp, summary, urgency, project360, decisions, alerts, delegation
};
