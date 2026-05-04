/* =============================================
   PREMIUM INTEL - Smart WhatsApp Alerts
   -------------------------------------------------
   Genera PREVIEWS de alertas (no envía sin
   confirmación). Tipos:
     - morning  : resumen del día
     - payments : pagos próximos a vencer
     - risk     : proyectos quietos / con riesgos
   ============================================= */

const U = require('./_util');
const { getDailyPlan }        = require('./planner');
const { getProjectFollowUps } = require('./follow-up');

async function getSmartWhatsappAlerts({ types = ['morning', 'payments', 'risk'], tz = 'America/Bogota' } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const alerts = [];
    const today = U.todayString(tz);

    if (types.includes('morning')) {
        const dp = await getDailyPlan({ date: today, tz });
        if (dp.success) {
            alerts.push({
                id: `morning-${today}`,
                type: 'morning',
                title: '🌅 Resumen matutino',
                preview: dp.data.whatsappBrief,
                priority: 'normal',
                requiresConfirmation: true
            });
        }
    }

    if (types.includes('payments')) {
        const allDocs = [
            ...snap.globalDocuments || [],
            ...snap.projects.flatMap(p => (p.documents || []).map(d => ({ ...d, _project: p })))
        ];
        const upcoming = allDocs
            .filter(d => (d.tipo === 'recibo' || d.tipo === 'factura' || d.tipo === 'pago') && d.fechaVencimiento)
            .filter(d => {
                const diff = (new Date(d.fechaVencimiento) - Date.now()) / 86400000;
                return diff >= 0 && diff <= 5;
            })
            .sort((a, b) => new Date(a.fechaVencimiento) - new Date(b.fechaVencimiento));
        if (upcoming.length) {
            const lines = [`💸 *Pagos próximos:*`];
            upcoming.slice(0, 5).forEach(d => {
                const days = Math.round((new Date(d.fechaVencimiento) - Date.now()) / 86400000);
                const when = days === 0 ? 'HOY' : days === 1 ? 'MAÑANA' : `en ${days} días`;
                lines.push(`• ${d.title || d.empresa || 'Recibo'}${d.valor ? ' — ' + d.valor + (d.moneda || '') : ''} (${when})`);
            });
            alerts.push({
                id: `payments-${today}`,
                type: 'payments',
                title: '💸 Pagos próximos',
                preview: lines.join('\n'),
                priority: upcoming.some(d => Math.round((new Date(d.fechaVencimiento) - Date.now()) / 86400000) <= 0) ? 'high' : 'normal',
                requiresConfirmation: true
            });
        }
    }

    if (types.includes('risk')) {
        const fu = await getProjectFollowUps({});
        if (fu.success) {
            const inactive = fu.data.inactiveProjects || [];
            const atRisk = fu.data.projectsAtRisk || [];
            if (inactive.length || atRisk.length) {
                const lines = [`⚠️ *Proyectos en alerta:*`];
                inactive.slice(0, 4).forEach(p => lines.push(`• ${p.projectName}: sin actividad hace ${p.daysSinceActivity} días`));
                if (atRisk.length) lines.push('\n*Riesgo alto:* ' + atRisk.map(p => p.projectName).slice(0, 3).join(', '));
                alerts.push({
                    id: `risk-${today}`,
                    type: 'risk',
                    title: '⚠️ Proyectos en alerta',
                    preview: lines.join('\n'),
                    priority: atRisk.length ? 'high' : 'normal',
                    requiresConfirmation: true
                });
            }
        }
    }

    return U.ok({ alerts, total: alerts.length }, {
        summary: `${alerts.length} alerta${alerts.length === 1 ? '' : 's'} preparada${alerts.length === 1 ? '' : 's'} (preview).`,
        naturalResponse: alerts.length
            ? `Te preparé ${alerts.length} alerta${alerts.length === 1 ? '' : 's'} para WhatsApp. Confírmame cuáles enviar.`
            : 'No detecté nada urgente para alertar por WhatsApp ahora mismo.',
        requiresConfirmation: alerts.length > 0,
        confirmationQuestion: alerts.length > 0 ? '¿Las envío todas o eliges cuáles?' : null,
        sources: ['knowledge.snapshot']
    });
}

module.exports = { getSmartWhatsappAlerts };
