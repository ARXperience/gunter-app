/* =============================================
   PREMIUM INTEL - Project Executive Summary
   -------------------------------------------------
   Reutiliza knowledge.summarizer (que ya tiene
   cache + LLM/fallback) y devuelve la respuesta
   en formato canónico premium-intel.
   ============================================= */

const U = require('./_util');

async function getProjectExecutiveSummary({ projectId, force = false } = {}) {
    if (!projectId) return U.fail('project-required', 'Necesito el id del proyecto.');

    const proj = U.knowledge.getProject(projectId);
    if (!proj) return U.fail('project-not-found', 'No encontré ese proyecto.');

    let s;
    try {
        s = await U.knowledge.summarizeProject(projectId, { force });
    } catch (e) {
        return U.fail('summarizer-error', e.message);
    }
    if (!s) return U.fail('no-summary', 'No pude generar resumen.');

    const naturalResponse = buildNarrative(proj.name, s);
    const summary = s.headline || `Resumen de ${proj.name}`;

    return U.ok({
        projectId,
        projectName: proj.name,
        headline: s.headline,
        focus: s.focus,
        highlights: s.highlights || [],
        pendings: s.pendings || [],
        risks: s.risks || [],
        nextStep: s.nextStep,
        cachedAt: s.cachedAt,
        basedOnUpdatedAt: s.basedOnUpdatedAt
    }, { summary, naturalResponse, sources: ['knowledge.summarizer'] });
}

function buildNarrative(projectName, s) {
    const parts = [`*${projectName}*: ${s.focus || s.headline}`];
    if (s.highlights?.length) parts.push(`Lo más relevante: ${s.highlights.slice(0, 2).join(' · ')}.`);
    if (s.pendings?.length && s.pendings[0] !== '—') parts.push(`Pendientes: ${s.pendings.slice(0, 3).join('; ')}.`);
    if (s.risks?.length && s.risks[0] !== '—') parts.push(`Riesgos: ${s.risks.slice(0, 2).join('; ')}.`);
    if (s.nextStep) parts.push(`Próximo paso: ${s.nextStep}`);
    return parts.join(' ');
}

module.exports = { getProjectExecutiveSummary };
