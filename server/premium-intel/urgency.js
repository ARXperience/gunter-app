/* =============================================
   PREMIUM INTEL - Urgency Ranking
   -------------------------------------------------
   Score explicable sobre tareas (y opcionalmente
   pagos/eventos) considerando vencimiento, dinero,
   impacto del proyecto, prioridad manual y antigüedad.
   ============================================= */

const U = require('./_util');

const W = {
    overdue: 30,
    dueSoon: 18,
    priorityUrgent: 22,
    priorityHigh: 12,
    money: 15,
    projectActive: 6,
    blocking: 8,
    age: 4
};

async function getUrgencyRanking({ scope = 'today', tz = 'America/Bogota', projectId = null, limit = 12 } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const today = U.todayString(tz);
    const horizonEnd = scope === 'week'
        ? U.addDays(today, 6)
        : scope === 'project' || scope === 'all'
            ? null
            : today;

    const projects = projectId
        ? snap.projects.filter(p => p.id === projectId)
        : snap.projects;

    const itemsTask = [];
    for (const p of projects) {
        for (const t of p.tasks || []) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (horizonEnd && t.dueAt && t.dueAt.slice(0, 10) > horizonEnd) continue;
            itemsTask.push(scoreTask(t, p));
        }
    }
    if (!projectId) {
        for (const t of snap.globalTasks || []) {
            if (t.status === 'done' || t.status === 'cancelled') continue;
            if (horizonEnd && t.dueAt && t.dueAt.slice(0, 10) > horizonEnd) continue;
            itemsTask.push(scoreTask(t, null));
        }
    }

    // Pagos próximos (tipo recibo/factura con fechaVencimiento)
    const itemsPayment = [];
    const allDocs = [
        ...snap.globalDocuments || [],
        ...projects.flatMap(p => (p.documents || []).map(d => ({ ...d, _project: p })))
    ];
    for (const d of allDocs) {
        if (!d.fechaVencimiento) continue;
        if ((d.tipo || '') !== 'recibo' && (d.tipo || '') !== 'factura' && (d.tipo || '') !== 'pago') continue;
        if (horizonEnd && d.fechaVencimiento.slice(0, 10) > horizonEnd) continue;
        itemsPayment.push(scorePayment(d));
    }

    const ranked = [...itemsTask, ...itemsPayment]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    const summary = ranked.length
        ? `${ranked.length} pendientes priorizados — top: ${ranked[0].title}.`
        : 'No detecté pendientes urgentes.';

    let naturalResponse = summary;
    if (ranked.length && U.openai.hasKey()) {
        const llm = await U.safeLLM({
            prompt: `Estos son los pendientes ordenados por urgencia (top 5):
${ranked.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} (score ${r.score}) — ${r.reason}${r.projectName ? ' — proyecto ' + r.projectName : ''}`).join('\n')}

Devuelve JSON estricto:
{
  "naturalResponse": "1-2 frases en español latino diciendo qué hacer primero y por qué"
}`,
            jsonMode: true, maxTokens: 180
        });
        if (llm?.naturalResponse) naturalResponse = llm.naturalResponse;
    }

    return U.ok({ scope, ranked, total: itemsTask.length + itemsPayment.length }, {
        summary, naturalResponse, sources: ['knowledge.snapshot']
    });
}

function scoreTask(t, project) {
    const reasons = [];
    let score = 50;

    if (t.dueAt) {
        const diffH = (new Date(t.dueAt) - Date.now()) / 3_600_000;
        if (diffH < 0)        { score += W.overdue; reasons.push('vencida'); }
        else if (diffH < 24)  { score += W.dueSoon; reasons.push('vence hoy'); }
        else if (diffH < 72)  { score += W.dueSoon * 0.5; reasons.push('vence pronto'); }
    }

    if (t.priority === 'urgent') { score += W.priorityUrgent; reasons.push('marcada urgente'); }
    else if (t.priority === 'high') { score += W.priorityHigh; reasons.push('alta prioridad'); }

    if (project) {
        if (project.lastActivityAt && (Date.now() - new Date(project.lastActivityAt).getTime()) < 7 * 86400000) {
            score += W.projectActive;
            reasons.push('proyecto activo');
        }
    }

    // Tareas viejas que siguen pending — algo de penalización al "no urgente" ya sería confuso;
    // mejor: pequeño boost de antigüedad si llevan >5 días pendientes.
    if (t.createdAt) {
        const ageDays = (Date.now() - new Date(t.createdAt).getTime()) / 86400000;
        if (ageDays > 5) { score += W.age; reasons.push('lleva días pendiente'); }
    }

    return {
        type: 'task',
        id: t.id, title: t.title,
        projectName: project?.name || t.projectName || null,
        projectId: project?.id || t.projectId || null,
        dueAt: t.dueAt || null,
        priority: t.priority || 'normal',
        score,
        reason: reasons.join('; ') || 'pendiente'
    };
}

function scorePayment(d) {
    let score = 60;
    const reasons = ['pago'];
    if (d.fechaVencimiento) {
        const dueDate = new Date(d.fechaVencimiento);
        const diffH = (dueDate - Date.now()) / 3_600_000;
        if (diffH < 0)       { score += W.overdue; reasons.push('vencido'); }
        else if (diffH < 24) { score += W.dueSoon; reasons.push('vence hoy'); }
        else if (diffH < 72) { score += W.dueSoon * 0.5; reasons.push('vence pronto'); }
    }
    if (d.valor && Number(d.valor) > 0) { score += W.money; reasons.push('dinero involucrado'); }

    return {
        type: 'payment',
        id: d.id,
        title: `Pagar ${d.title || d.empresa || 'recibo'}`,
        projectName: d._project?.name || null,
        projectId: d._project?.id || null,
        dueAt: d.fechaVencimiento,
        valor: d.valor || null,
        moneda: d.moneda || null,
        score,
        reason: reasons.join('; ')
    };
}

module.exports = { getUrgencyRanking };
