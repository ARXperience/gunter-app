/* =============================================
   PREMIUM INTEL - Decision Center
   -------------------------------------------------
   - getDecisions(filter): lista decisiones registradas
     en proyectos (extraídas heurísticamente o vía LLM
     en stages anteriores).
   - detectDecisionsFromText(text, context): extrae
     decisiones de un texto libre (transcripción,
     mensaje WA, nota), retornando lista normalizada.
   ============================================= */

const U = require('./_util');

const RX_DECISION = /(decid(?:i[oó]?|imos)|acord(?:amos|ado|ó)|aprob(?:amos|ado|ó)|conclui[óo]?|definimos|resolvimos|el cliente aprob[oó]|se cambi[oó] el alcance|se cobrar?[áa]|se descart[óo]|qued[óo] definido)/i;

async function getDecisions({ projectId = null, q = null, since = null, limit = 30 } = {}) {
    const { snap, error } = U.snapshotOrFail();
    if (error) return error;

    const projects = projectId ? snap.projects.filter(p => p.id === projectId) : snap.projects;
    const sinceTs = since ? new Date(since).getTime() : null;

    let all = [];
    for (const p of projects) {
        for (const d of p.decisions || []) {
            if (sinceTs && d.at && new Date(d.at).getTime() < sinceTs) continue;
            all.push({
                projectId: p.id,
                projectName: p.name,
                text: d.text,
                source: d.source || 'analysis',
                at: d.at || null,
                impact: 'medium',
                tags: []
            });
        }
    }
    if (q) {
        const needle = q.toLowerCase();
        all = all.filter(d => d.text.toLowerCase().includes(needle));
    }
    all.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    all = all.slice(0, limit);

    const summary = all.length
        ? `${all.length} decisión(es) encontradas.`
        : 'No encontré decisiones que coincidan.';
    const naturalResponse = all.length
        ? `Encontré ${all.length} decisión${all.length === 1 ? '' : 'es'}: la más reciente es "${all[0].text.slice(0, 100)}" en ${all[0].projectName}.`
        : 'No tengo decisiones registradas que coincidan con esa búsqueda.';

    return U.ok({ decisions: all, total: all.length }, { summary, naturalResponse, sources: ['knowledge.snapshot'] });
}

async function detectDecisionsFromText({ text, context = {} } = {}) {
    if (!text) return U.fail('text-required', 'Necesito el texto.');

    // Heurística primero
    const heuristic = [];
    const sents = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
    for (const s of sents) {
        if (RX_DECISION.test(s) && s.length > 12) {
            heuristic.push({
                decision: s.slice(0, 220),
                context: '',
                source: context.source || 'manual',
                date: context.date || new Date().toISOString(),
                responsible: detectResponsible(s),
                impact: 'medium',
                tags: []
            });
        }
    }

    // LLM enrichment opcional
    let llmDecisions = [];
    if (U.openai.hasKey() && text.length > 50) {
        const llm = await U.safeLLM({
            system: 'Eres un extractor de decisiones. Solo devuelves decisiones explícitamente presentes en el texto. Cero invención.',
            prompt: `Extrae las DECISIONES TOMADAS en este texto. Una decisión es una resolución, acuerdo o cambio explícito (no una propuesta).

TEXTO:
"""
${text.slice(0, 4000)}
"""

Devuelve JSON estricto:
{
  "decisions": [
    { "decision": "texto corto en español", "responsible": "nombre o null", "impact": "low|medium|high", "tags": [] }
  ]
}
Máximo 6. Si no hay decisiones reales, devuelve {"decisions":[]}.`,
            jsonMode: true, maxTokens: 600, temperature: 0.2
        });
        if (Array.isArray(llm?.decisions)) {
            llmDecisions = llm.decisions.map(d => ({
                decision: String(d.decision || '').slice(0, 240),
                context: '',
                source: context.source || 'llm-detection',
                date: context.date || new Date().toISOString(),
                responsible: d.responsible || null,
                impact: ['low', 'medium', 'high'].includes(d.impact) ? d.impact : 'medium',
                tags: Array.isArray(d.tags) ? d.tags.slice(0, 6) : []
            }));
        }
    }

    // Merge: prioriza LLM si trajo, fallback heurístico
    const decisions = llmDecisions.length ? llmDecisions : heuristic;

    return U.ok({
        decisions,
        method: llmDecisions.length ? 'llm' : 'heuristic'
    }, {
        summary: `${decisions.length} decisión${decisions.length === 1 ? '' : 'es'} detectada${decisions.length === 1 ? '' : 's'}.`,
        naturalResponse: decisions.length
            ? `Detecté ${decisions.length} decisión${decisions.length === 1 ? '' : 'es'} en el texto.`
            : 'No detecté decisiones explícitas en el texto.'
    });
}

function detectResponsible(s) {
    const m = s.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/);
    return m ? m[1] : null;
}

module.exports = { getDecisions, detectDecisionsFromText };
