/* =============================================
   PREMIUM INTEL - Follow-up
   -------------------------------------------------
   - getProjectFollowUps: detecta proyectos quietos,
     tareas vencidas, próximas decisiones sin owner.
   - getMeetingFollowUp: extrae compromisos / tareas /
     decisiones de la última reunión de un proyecto.
   ============================================= */

const U = require('./_util');

const INACTIVE_DAYS = 7;
const RISKY_DAYS = 14;

async function getProjectFollowUps({ projectId = null } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const now = Date.now();
    const projects = projectId ? snap.projects.filter(p => p.id === projectId) : snap.projects;

    const inactiveProjects = [];
    const projectsAtRisk = [];
    const overdueByProject = [];
    const missingNextSteps = [];
    const suggestedActions = [];

    for (const p of projects) {
        const ageDays = p.lastActivityAt
            ? Math.floor((now - new Date(p.lastActivityAt).getTime()) / 86400000)
            : 999;

        if (ageDays >= INACTIVE_DAYS) {
            const entry = { projectId: p.id, projectName: p.name, daysSinceActivity: ageDays, lastActivityAt: p.lastActivityAt };
            inactiveProjects.push(entry);
            if (ageDays >= RISKY_DAYS) projectsAtRisk.push({ ...entry, risk: 'high' });
            suggestedActions.push({
                type: 'create_followup_task',
                projectId: p.id,
                projectName: p.name,
                title: `Hacer seguimiento de ${p.name}`,
                reason: `Sin actividad hace ${ageDays} días.`
            });
        }

        const overdue = (p.tasks || []).filter(t =>
            t.status !== 'done' && t.status !== 'cancelled' &&
            t.dueAt && new Date(t.dueAt) < new Date()
        );
        if (overdue.length) {
            overdueByProject.push({
                projectId: p.id, projectName: p.name,
                count: overdue.length,
                tasks: overdue.slice(0, 5).map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority }))
            });
        }

        // Reuniones recientes sin "next step" detectado en sus análisis
        const lastMeeting = (p.meetings || []).slice(-1)[0];
        if (lastMeeting && (!p.decisions || p.decisions.length === 0)) {
            missingNextSteps.push({
                projectId: p.id, projectName: p.name,
                lastMeetingAt: lastMeeting.timestamp,
                hint: 'No detecté decisiones ni próximos pasos en la última reunión.'
            });
            suggestedActions.push({
                type: 'add_next_step',
                projectId: p.id, projectName: p.name,
                title: `Definir próximos pasos para ${p.name}`,
                reason: 'Última reunión sin acción concreta.'
            });
        }
    }

    const data = {
        inactiveProjects: inactiveProjects.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity).slice(0, 10),
        projectsAtRisk: projectsAtRisk.slice(0, 6),
        overdueByProject: overdueByProject.sort((a, b) => b.count - a.count).slice(0, 8),
        missingNextSteps: missingNextSteps.slice(0, 6),
        suggestedActions: suggestedActions.slice(0, 12)
    };

    const summary = buildSummary(data);
    let naturalResponse = summary;

    if (U.openai.hasKey() && (data.inactiveProjects.length || data.projectsAtRisk.length)) {
        const llm = await U.safeLLM({
            prompt: `Estos son los hallazgos del seguimiento de proyectos:

PROYECTOS QUIETOS (>${INACTIVE_DAYS} días sin actividad):
${data.inactiveProjects.slice(0, 5).map(p => `- ${p.projectName}: ${p.daysSinceActivity} días`).join('\n') || '(ninguno)'}

PROYECTOS EN RIESGO (>${RISKY_DAYS} días):
${data.projectsAtRisk.slice(0, 4).map(p => `- ${p.projectName}: ${p.daysSinceActivity} días`).join('\n') || '(ninguno)'}

TAREAS VENCIDAS POR PROYECTO:
${data.overdueByProject.slice(0, 4).map(p => `- ${p.projectName}: ${p.count} vencidas`).join('\n') || '(ninguna)'}

Devuelve JSON estricto:
{
  "naturalResponse": "1-2 frases en español latino describiendo el estado",
  "topRecommendation": "1 frase con la acción más urgente"
}`,
            jsonMode: true, maxTokens: 220
        });
        if (llm?.naturalResponse) naturalResponse = llm.naturalResponse;
    }

    return U.ok(data, { summary, naturalResponse, sources: ['knowledge.snapshot'] });
}

async function getMeetingFollowUp({ projectId, meetingId = null } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const project = snap.projects.find(p => p.id === projectId);
    if (!project) return U.fail('project-not-found', 'No encontré ese proyecto.');

    const meeting = meetingId
        ? (project.meetings || []).find(m => m.id === meetingId)
        : (project.meetings || []).slice(-1)[0];
    if (!meeting) return U.fail('no-meetings', `${project.name} no tiene reuniones registradas.`);

    const transcript = (meeting.transcriptionExcerpt || '').trim();
    if (!transcript) {
        return U.ok({
            tasks: [], decisions: [], questions: [], risks: [], nextSteps: []
        }, {
            summary: `Reunión de ${project.name} sin transcripción.`,
            naturalResponse: `La reunión de ${project.name} no tiene transcripción para extraer follow-up.`
        });
    }

    // Extracción heurística + LLM si hay
    const heuristic = extractHeuristic(transcript);
    let llmResult = null;
    if (U.openai.hasKey()) {
        llmResult = await U.safeLLM({
            system: 'Eres un asistente que extrae información estructurada de transcripciones de reuniones. Cero invención.',
            prompt: `Transcripción de la reunión "${project.name}":
"""
${transcript.slice(0, 3500)}
"""

Devuelve JSON estricto en español latino:
{
  "tasks": [{ "title": "string corto", "responsible": "nombre o null", "when": "fecha aprox o null" }],
  "decisions": [{ "text": "decisión tomada", "responsible": "nombre o null" }],
  "questions": ["pregunta abierta sin respuesta"],
  "risks": ["riesgo o bloqueo identificado"],
  "nextSteps": ["próximo paso concreto"]
}
Máximo 5 items por lista. Si no hay nada de un tipo, lista vacía. NO inventes.`,
            jsonMode: true, maxTokens: 800, temperature: 0.2
        });
    }

    const merged = {
        tasks:     llmResult?.tasks?.length ? llmResult.tasks : heuristic.tasks,
        decisions: llmResult?.decisions?.length ? llmResult.decisions : heuristic.decisions,
        questions: llmResult?.questions || [],
        risks:     llmResult?.risks || [],
        nextSteps: llmResult?.nextSteps || []
    };

    const naturalResponse = buildMeetingNarrative(project.name, merged);

    return U.ok({
        projectId, projectName: project.name,
        meetingAt: meeting.timestamp,
        ...merged
    }, {
        summary: `Follow-up de reunión "${project.name}".`,
        naturalResponse,
        sources: ['knowledge.snapshot']
    });
}

// ---------- helpers ----------
function extractHeuristic(text) {
    const sents = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);

    const tasks = [];
    const decisions = [];

    for (const s of sents) {
        if (/(decid|acordamos|aprobado|conclui|definimos|resolvimos|el cliente aprob|se cambi[oó])/i.test(s) && s.length > 10) {
            decisions.push({ text: s.slice(0, 200), responsible: detectName(s) });
        } else if (/(hay que|tenemos que|debemos|pendiente|toca|quedó(\s+de|\s+en)|me\s+encargo|te\s+encargas|nos\s+toca|antes del?)/i.test(s) && s.length > 10) {
            tasks.push({ title: s.slice(0, 140), responsible: detectName(s), when: detectWhen(s) });
        }
    }
    return { tasks: tasks.slice(0, 6), decisions: decisions.slice(0, 5) };
}
function detectName(s) {
    const m = s.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/);
    return m ? m[1] : null;
}
function detectWhen(s) {
    const m = s.match(/\b(mañana|hoy|el\s+(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)|en\s+\d+\s+(?:día|semana)s?|antes\s+del?\s+\w+)/i);
    return m ? m[0] : null;
}
function buildMeetingNarrative(projectName, m) {
    const parts = [];
    if (m.tasks.length)     parts.push(`${m.tasks.length} ${m.tasks.length === 1 ? 'tarea detectada' : 'tareas detectadas'}`);
    if (m.decisions.length) parts.push(`${m.decisions.length} ${m.decisions.length === 1 ? 'decisión' : 'decisiones'}`);
    if (m.risks.length)     parts.push(`${m.risks.length} riesgo${m.risks.length === 1 ? '' : 's'}`);
    if (m.nextSteps.length) parts.push(`${m.nextSteps.length} próximo${m.nextSteps.length === 1 ? '' : 's'} paso${m.nextSteps.length === 1 ? '' : 's'}`);
    if (parts.length === 0) return `No detecté compromisos concretos en la última reunión de ${projectName}.`;
    return `De la reunión de ${projectName} salió: ${parts.join(', ')}.`;
}
function buildSummary(d) {
    const parts = [];
    if (d.inactiveProjects.length) parts.push(`${d.inactiveProjects.length} proyecto(s) quieto(s)`);
    if (d.overdueByProject.length) parts.push(`${d.overdueByProject.reduce((s, p) => s + p.count, 0)} tarea(s) vencida(s)`);
    if (d.missingNextSteps.length) parts.push(`${d.missingNextSteps.length} reunión(es) sin próximos pasos`);
    if (parts.length === 0) return 'Todos los proyectos están al día.';
    return 'Detecté ' + parts.join(', ') + '.';
}

module.exports = { getProjectFollowUps, getMeetingFollowUp };
