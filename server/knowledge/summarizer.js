/* =============================================
   GUNTER KNOWLEDGE SUMMARIZER (Fase 11.4)
   -------------------------------------------------
   Genera resúmenes ejecutivos de proyectos.
   Cache invalidado por updatedAt del proyecto.

   Si OpenAI no está disponible, usa una versión
   determinística que arma el resumen con los
   campos del snapshot.
   ============================================= */

const store = require('./store');
const openai = require('../openai-client');

const MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6h

async function summarizeProject(projectId, { force = false } = {}) {
    const p = store.getProject(projectId);
    if (!p) return null;

    if (!force) {
        const cached = store.getSummary(projectId);
        if (cached && cached.basedOnUpdatedAt === p.updatedAt) {
            const age = Date.now() - new Date(cached.cachedAt).getTime();
            if (age < MAX_AGE_MS) return cached;
        }
    }

    let executive;
    if (openai.hasKey()) {
        try {
            executive = await llmSummary(p);
        } catch (e) {
            console.warn('[summarizer] LLM failed, fallback:', e.message);
            executive = deterministicSummary(p);
        }
    } else {
        executive = deterministicSummary(p);
    }

    const summary = {
        projectId,
        projectName: p.name,
        basedOnUpdatedAt: p.updatedAt,
        ...executive
    };
    return store.setSummary(projectId, summary);
}

async function llmSummary(p) {
    const ctxLines = [
        `Proyecto: ${p.name}`,
        p.market ? `Mercado: ${p.market}` : '',
        p.environment ? `Entorno: ${p.environment}` : '',
        p.summary ? `Resumen previo: ${p.summary}` : '',
        '',
        `Reuniones (${p.meetings?.length || 0}):`,
        ...((p.meetings || []).slice(-3).map(m => `- "${(m.transcriptionExcerpt || '').slice(0, 600)}"`)),
        '',
        `Análisis (${p.analyses?.length || 0}):`,
        ...((p.analyses || []).slice(-4).map(a => `- ${a.title}: ${(a.payloadSummary || '').slice(0, 400)}`)),
        '',
        `Tareas activas: ${(p.tasks || []).filter(t => t.status !== 'done').length}`,
        ...((p.tasks || []).filter(t => t.status !== 'done').slice(0, 6).map(t => `  · ${t.title}`)),
        '',
        `Documentos: ${(p.documents || []).length}`
    ].filter(Boolean).join('\n');

    const prompt = `Eres un asistente que produce resúmenes ejecutivos de proyectos.
DATA:
"""
${ctxLines}
"""

Devuelve JSON ESTRICTO con esta forma (sin markdown, sin texto fuera):
{
  "headline": "≤ 90 caracteres en español latino",
  "focus": "qué es y de qué se trata, 2 frases",
  "highlights": ["punto 1", "punto 2", "punto 3"],
  "pendings": ["pendiente 1", "pendiente 2"],
  "risks": ["riesgo 1"],
  "nextStep": "el siguiente paso recomendado, 1 frase"
}
Si falta información, usa "—" en el campo. NO inventes datos.`;

    const raw = await openai.chatComplete({
        messages: [
            { role: 'system', content: 'Respondes solo con JSON válido en español latino. Cero invención.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        maxTokens: 600,
        jsonMode: true
    });
    try { return JSON.parse(raw); }
    catch {
        const m = raw.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : deterministicSummary(p);
    }
}

function deterministicSummary(p) {
    const pendings = (p.tasks || [])
        .filter(t => t.status !== 'done' && t.status !== 'cancelled')
        .slice(0, 5)
        .map(t => t.title);

    const headline = p.market
        ? `${p.name} — ${p.market}`
        : p.name;

    const focus = p.summary || (p.market ? `Proyecto enfocado en ${p.market}.` : 'Sin descripción extendida.');

    const highlights = [];
    if (p.meetings?.length) highlights.push(`${p.meetings.length} reuniones registradas.`);
    if (p.analyses?.length) highlights.push(`${p.analyses.length} análisis estratégicos generados.`);
    if (p.documents?.length) highlights.push(`${p.documents.length} documentos asociados.`);
    if (highlights.length === 0) highlights.push('Aún sin actividad significativa registrada.');

    const risks = [];
    const overdue = (p.tasks || []).filter(t => t.dueAt && new Date(t.dueAt) < new Date() && t.status !== 'done');
    if (overdue.length) risks.push(`${overdue.length} tarea(s) vencida(s).`);

    const nextStep = pendings.length
        ? `Avanzar: ${pendings[0]}.`
        : 'Definir próximos pasos en la siguiente reunión.';

    return {
        headline,
        focus,
        highlights,
        pendings: pendings.length ? pendings : ['—'],
        risks: risks.length ? risks : ['—'],
        nextStep
    };
}

module.exports = { summarizeProject };
