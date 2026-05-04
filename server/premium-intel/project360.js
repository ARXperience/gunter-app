/* =============================================
   PREMIUM INTEL - Project 360
   -------------------------------------------------
   Vista consolidada del proyecto: tareas activas,
   próximos eventos, reuniones recientes, decisiones,
   documentos, riesgos y próximos pasos.
   ============================================= */

const U = require('./_util');

async function getProject360({ projectId } = {}) {
    if (!projectId) return U.fail('project-required', 'Necesito el id del proyecto.');
    const proj = U.knowledge.getProject(projectId);
    if (!proj) return U.fail('project-not-found', 'No encontré ese proyecto.');

    const now = Date.now();

    const activeTasks = (proj.tasks || []).filter(t => t.status !== 'done' && t.status !== 'cancelled');
    const overdueTasks = activeTasks.filter(t => t.dueAt && new Date(t.dueAt) < new Date());
    const upcomingEvents = (proj.events || [])
        .filter(e => e.startAt && new Date(e.startAt) >= new Date())
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
        .slice(0, 5);
    const recentMeetings = [...(proj.meetings || [])]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 3);
    const lastDecisions = [...(proj.decisions || [])]
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, 5);
    const documents = (proj.documents || []).slice(0, 8);
    const pendingPayments = documents.filter(d =>
        (d.tipo === 'recibo' || d.tipo === 'factura' || d.tipo === 'pago') &&
        d.fechaVencimiento && new Date(d.fechaVencimiento) >= new Date()
    );

    // Risks heurísticos
    const risks = [];
    if (overdueTasks.length) risks.push(`${overdueTasks.length} tarea(s) vencida(s).`);
    if (proj.lastActivityAt) {
        const ageDays = Math.floor((now - new Date(proj.lastActivityAt).getTime()) / 86400000);
        if (ageDays > 14) risks.push(`Sin actividad hace ${ageDays} días.`);
    }
    if (recentMeetings.length && (!proj.decisions || proj.decisions.length === 0)) {
        risks.push('Reuniones recientes sin decisiones registradas.');
    }
    if (pendingPayments.length) risks.push(`${pendingPayments.length} pago(s) pendiente(s).`);

    // Próximos pasos heurísticos
    const nextSteps = [];
    if (overdueTasks.length) nextSteps.push(`Cerrar ${overdueTasks[0].title}.`);
    if (upcomingEvents.length) nextSteps.push(`Preparar reunión: ${upcomingEvents[0].title}.`);
    if (activeTasks.length && !overdueTasks.length) nextSteps.push(`Continuar con: ${activeTasks[0].title}.`);
    if (nextSteps.length === 0 && proj.meetings?.length === 0) nextSteps.push('Agendar primera reunión.');

    const data = {
        projectId: proj.id,
        projectName: proj.name,
        market: proj.market,
        environment: proj.environment,
        status: proj.status || 'in_progress',
        lastActivityAt: proj.lastActivityAt,
        summary: proj.summary,
        // Sub-bloques
        tasks: {
            active: activeTasks.slice(0, 8),
            overdue: overdueTasks.slice(0, 5),
            total: activeTasks.length
        },
        events: { upcoming: upcomingEvents, total: (proj.events || []).length },
        meetings: { recent: recentMeetings, total: (proj.meetings || []).length },
        decisions: { latest: lastDecisions, total: (proj.decisions || []).length },
        documents: { all: documents, payments: pendingPayments, total: (proj.documents || []).length },
        risks,
        nextSteps,
        keywords: proj.keywords || []
    };

    const summary = `${proj.name}: ${activeTasks.length} tareas activas, ${upcomingEvents.length} eventos próximos, ${(proj.meetings || []).length} reuniones, ${(proj.documents || []).length} documentos.`;
    const naturalResponse = buildNarrative(proj.name, data);

    return U.ok(data, { summary, naturalResponse, sources: ['knowledge.snapshot'] });
}

function buildNarrative(name, d) {
    const parts = [`*${name}*: ${d.summary || d.market || 'sin descripción'}.`];
    if (d.tasks.overdue.length) parts.push(`${d.tasks.overdue.length} vencidas; cerrar primero "${d.tasks.overdue[0].title}".`);
    else if (d.tasks.active.length) parts.push(`${d.tasks.active.length} tareas en curso.`);
    if (d.events.upcoming.length) parts.push(`Próximo evento: ${d.events.upcoming[0].title}.`);
    if (d.decisions.latest.length) parts.push(`Última decisión: "${d.decisions.latest[0].text.slice(0, 80)}".`);
    if (d.risks.length) parts.push(`⚠️ ${d.risks[0]}`);
    return parts.join(' ');
}

module.exports = { getProject360 };
