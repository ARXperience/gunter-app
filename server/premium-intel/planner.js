/* =============================================
   PREMIUM INTEL - Planner (daily + weekly)
   -------------------------------------------------
   Planificador del día y de la semana.

   Estrategia:
     1) Determinístico siempre: arma la lista de
        tareas/eventos/pagos que tocan ese día/semana.
     2) Si hay LLM, lo usamos para el resumen
        humano + recomendación final.
   ============================================= */

const U = require('./_util');

const dailyCache  = U.makeTtlCache(30 * 60 * 1000);  // 30 min
const weeklyCache = U.makeTtlCache(60 * 60 * 1000);  // 1 h

async function getDailyPlan({ date, tz = 'America/Bogota', force = false } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const dateStr = date || U.todayString(tz);
    const cacheKey = `daily:${dateStr}:${tz}`;
    if (!force) {
        const cached = dailyCache.get(cacheKey);
        if (cached) return cached;
    }

    // === Recolectar datos de TODOS los proyectos + globales ===
    const allTasks = [
        ...snap.globalTasks || [],
        ...snap.projects.flatMap(p => (p.tasks || []).map(t => ({ ...t, projectName: p.name, projectId: p.id })))
    ];
    const allEvents = [
        ...snap.globalEvents || [],
        ...snap.projects.flatMap(p => (p.events || []).map(e => ({ ...e, projectName: p.name, projectId: p.id })))
    ];
    const allDocuments = [
        ...snap.globalDocuments || [],
        ...snap.projects.flatMap(p => (p.documents || []).map(d => ({ ...d, projectName: p.name, projectId: p.id })))
    ];

    // === Filtrar por día ===
    const tasksToday = allTasks.filter(t => t.dueAt && U.isSameLocalDay(t.dueAt, dateStr, tz));
    const tasksOverdue = allTasks.filter(t =>
        t.status !== 'done' && t.status !== 'cancelled' &&
        t.dueAt && new Date(t.dueAt) < new Date(dateStr + 'T00:00:00')
    );
    const eventsToday = allEvents.filter(e => U.isSameLocalDay(e.startAt, dateStr, tz));
    const paymentsToday = allDocuments.filter(d =>
        (d.tipo === 'recibo' || d.tipo === 'factura') &&
        d.fechaVencimiento && d.fechaVencimiento.slice(0, 10) === dateStr
    );

    // === Top priorities (tareas vencidas + tareas hoy + pagos hoy) ===
    const topPriorities = [
        ...paymentsToday.map(p => ({
            kind: 'payment', title: `Pagar ${p.title || p.empresa || 'recibo'}`,
            project: p.projectName, score: 95, reason: `Vence hoy${p.valor ? ' (' + p.valor + (p.moneda || '') + ')' : ''}.`
        })),
        ...tasksOverdue.slice(0, 3).map(t => ({
            kind: 'task', title: t.title, project: t.projectName,
            score: 88, reason: 'Vencida.', taskId: t.id
        })),
        ...tasksToday
            .filter(t => t.status !== 'done')
            .sort(byPriorityDesc)
            .slice(0, 4)
            .map(t => ({
                kind: 'task', title: t.title, project: t.projectName,
                score: scoreTaskPriority(t), reason: t.priority === 'urgent' ? 'Marcada urgente.' : 'Vence hoy.',
                taskId: t.id
            }))
    ].sort((a, b) => b.score - a.score).slice(0, 6);

    // === Time blocks (sugerencia simple) ===
    const timeBlocks = buildTimeBlocks(eventsToday, topPriorities, tz);

    // === Risks ===
    const risks = [];
    if (tasksOverdue.length >= 3) risks.push(`${tasksOverdue.length} tareas vencidas acumuladas.`);
    const inactiveProjects = snap.projects.filter(p => {
        if (!p.lastActivityAt) return false;
        const ageDays = (Date.now() - new Date(p.lastActivityAt).getTime()) / 86400000;
        return ageDays > 7;
    });
    if (inactiveProjects.length) risks.push(`${inactiveProjects.length} proyecto(s) sin actividad reciente: ${inactiveProjects.map(p => p.name).slice(0, 3).join(', ')}.`);
    if (eventsToday.length >= 4) risks.push('Día con muchas reuniones — bloquea tiempo de ejecución.');

    // === Resumen humano (LLM si hay key, fallback determinístico) ===
    const baseSummary = buildBaseSummary({ tasksToday: tasksToday.length, eventsToday: eventsToday.length, paymentsToday: paymentsToday.length, overdue: tasksOverdue.length });

    let naturalResponse = baseSummary;
    let recommendation = null;
    if (U.openai.hasKey() && (topPriorities.length > 0 || risks.length > 0)) {
        const llm = await U.safeLLM({
            system: 'Eres Gunter, asistente personal en español latino. Responde breve, concreto, sin inventar.',
            prompt: `Es ${dateStr}. Estos son los datos del día:
PRIORIDADES (top ${topPriorities.length}):
${topPriorities.map(p => `- ${p.title} [${p.kind}, score ${p.score}, ${p.reason}]${p.project ? ' — proyecto ' + p.project : ''}`).join('\n')}

EVENTOS (${eventsToday.length}):
${eventsToday.slice(0, 5).map(e => `- ${e.title} @ ${e.startAt}${e.projectName ? ' — ' + e.projectName : ''}`).join('\n')}

RIESGOS:
${risks.map(r => '- ' + r).join('\n') || '(ninguno)'}

Devuelve JSON ESTRICTO (sin markdown):
{
  "naturalResponse": "1-2 frases en español latino con tono asistente, mencionando lo más importante del día",
  "recommendation": "1 frase con la recomendación principal (qué hacer primero o por qué)"
}
NO inventes datos no listados.`,
            jsonMode: true, maxTokens: 280, temperature: 0.3
        });
        if (llm?.naturalResponse) {
            naturalResponse = llm.naturalResponse;
            recommendation = llm.recommendation || null;
        }
    }

    const data = {
        date: dateStr,
        topPriorities,
        timeBlocks,
        eventsToday: eventsToday.slice(0, 8).map(compactEvent),
        tasksToday: tasksToday.slice(0, 12).map(compactTask),
        tasksOverdue: tasksOverdue.slice(0, 8).map(compactTask),
        paymentsToday: paymentsToday.slice(0, 6),
        risks,
        recommendations: recommendation ? [recommendation] : [],
        whatsappBrief: buildWhatsappBrief({ topPriorities, eventsToday, paymentsToday, risks })
    };

    const result = U.ok(data, {
        summary: baseSummary,
        naturalResponse,
        sources: ['knowledge.snapshot']
    });
    dailyCache.set(cacheKey, result);
    return result;
}

async function getWeeklyPlan({ startDate, tz = 'America/Bogota', force = false } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const start = startDate || U.todayString(tz);
    const cacheKey = `weekly:${start}:${tz}`;
    if (!force) {
        const cached = weeklyCache.get(cacheKey);
        if (cached) return cached;
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = U.addDays(start, i);
        const dayPlan = await getDailyPlan({ date: d, tz, force: true });
        if (!dayPlan.success) continue;
        days.push({
            date: d,
            focus: dayPlan.data.topPriorities[0]?.title || '—',
            tasks: dayPlan.data.tasksToday,
            events: dayPlan.data.eventsToday,
            risks: dayPlan.data.risks,
            taskCount: dayPlan.data.tasksToday.length,
            eventCount: dayPlan.data.eventsToday.length
        });
    }

    // Carga total + balance entre proyectos
    const projectLoad = {};
    for (const day of days) {
        for (const t of day.tasks) {
            const k = t.projectName || '(sin proyecto)';
            projectLoad[k] = (projectLoad[k] || 0) + 1;
        }
    }

    const risks = [];
    const heaviestDay = [...days].sort((a, b) => (b.taskCount + b.eventCount) - (a.taskCount + a.eventCount))[0];
    if (heaviestDay && (heaviestDay.taskCount + heaviestDay.eventCount) >= 6) {
        risks.push(`${heaviestDay.date} concentra ${heaviestDay.taskCount + heaviestDay.eventCount} compromisos — considera redistribuir.`);
    }
    const ignored = Object.entries(projectLoad).filter(([_, c]) => c === 0).map(([n]) => n);
    if (ignored.length === 0 && Object.keys(projectLoad).length >= 2) {
        const max = Math.max(...Object.values(projectLoad));
        const min = Math.min(...Object.values(projectLoad));
        if (max - min >= 4) risks.push('Carga desbalanceada entre proyectos.');
    }

    const baseSummary = `Semana del ${start}: ${days.reduce((s, d) => s + d.taskCount, 0)} tareas, ${days.reduce((s, d) => s + d.eventCount, 0)} eventos.`;

    let naturalResponse = baseSummary;
    if (U.openai.hasKey()) {
        const llm = await U.safeLLM({
            prompt: `Resumen de la semana ${start} a ${U.addDays(start, 6)}:
${days.map(d => `- ${d.date}: foco "${d.focus}" (${d.taskCount}t/${d.eventCount}e)`).join('\n')}

Carga por proyecto:
${Object.entries(projectLoad).map(([p, c]) => `  ${p}: ${c}`).join('\n')}

RIESGOS:
${risks.map(r => '- ' + r).join('\n') || '(ninguno)'}

Devuelve JSON estricto:
{
  "naturalResponse": "1-2 frases en español latino con visión de la semana",
  "recommendation": "1 frase recomendando qué cambiar/priorizar"
}`,
            jsonMode: true, maxTokens: 250
        });
        if (llm?.naturalResponse) naturalResponse = llm.naturalResponse;
    }

    const data = {
        weekStart: start,
        weekEnd: U.addDays(start, 6),
        days,
        projectLoad,
        risks,
        recommendations: []
    };

    const result = U.ok(data, {
        summary: baseSummary,
        naturalResponse,
        sources: ['knowledge.snapshot'],
        requiresConfirmation: false
    });
    weeklyCache.set(cacheKey, result);
    return result;
}

// ---------- helpers ----------
function scoreTaskPriority(t) {
    let s = 50;
    if (t.priority === 'urgent') s += 30;
    else if (t.priority === 'high') s += 15;
    if (t.dueAt) {
        const diffH = (new Date(t.dueAt) - Date.now()) / 3_600_000;
        if (diffH < 0) s += 20;
        else if (diffH < 6) s += 10;
    }
    return s;
}
function byPriorityDesc(a, b) {
    return scoreTaskPriority(b) - scoreTaskPriority(a);
}

function buildTimeBlocks(events, priorities, tz) {
    // Sugerencia naive: 3 bloques de 90 min entre 9-12, 14-17 y 17-19, evitando colisión con eventos.
    const slots = [
        { from: '09:00', to: '10:30' },
        { from: '11:00', to: '12:30' },
        { from: '14:30', to: '16:00' },
        { from: '16:30', to: '18:00' }
    ];
    const blocks = [];
    let pIdx = 0;
    for (const s of slots) {
        if (pIdx >= priorities.length) break;
        const p = priorities[pIdx++];
        blocks.push({ ...s, focus: p.title, project: p.project || null, taskId: p.taskId || null });
    }
    return blocks;
}

function buildBaseSummary({ tasksToday, eventsToday, paymentsToday, overdue }) {
    const parts = [];
    if (tasksToday)    parts.push(`${tasksToday} ${tasksToday === 1 ? 'tarea' : 'tareas'} hoy`);
    if (eventsToday)   parts.push(`${eventsToday} ${eventsToday === 1 ? 'reunión' : 'reuniones'}`);
    if (paymentsToday) parts.push(`${paymentsToday} ${paymentsToday === 1 ? 'pago' : 'pagos'} pendiente${paymentsToday === 1 ? '' : 's'}`);
    if (overdue)       parts.push(`${overdue} vencida${overdue === 1 ? '' : 's'}`);
    if (parts.length === 0) return 'Hoy no tienes pendientes registrados.';
    return 'Hoy tienes ' + parts.join(', ') + '.';
}

function buildWhatsappBrief({ topPriorities, eventsToday, paymentsToday, risks }) {
    const lines = ['🌅 *Brief de hoy*'];
    if (topPriorities.length) {
        lines.push('\n*Lo más importante:*');
        topPriorities.slice(0, 4).forEach(p => lines.push(`• ${p.title}${p.project ? ' _(' + p.project + ')_' : ''}`));
    }
    if (eventsToday.length) {
        lines.push('\n*Reuniones:*');
        eventsToday.slice(0, 4).forEach(e => lines.push(`• ${e.title} @ ${formatTime(e.startAt)}`));
    }
    if (paymentsToday.length) {
        lines.push('\n*Pagos hoy:*');
        paymentsToday.slice(0, 3).forEach(p => lines.push(`• ${p.title || p.empresa || 'Pago'}${p.valor ? ' — ' + p.valor + (p.moneda || '') : ''}`));
    }
    if (risks.length) {
        lines.push('\n⚠️ *Riesgos:*');
        risks.slice(0, 2).forEach(r => lines.push(`• ${r}`));
    }
    return lines.join('\n');
}

function formatTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

function compactTask(t) { return { id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, projectName: t.projectName || null }; }
function compactEvent(e) { return { id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, projectName: e.projectName || null }; }

module.exports = { getDailyPlan, getWeeklyPlan };
