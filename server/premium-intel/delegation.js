/* =============================================
   PREMIUM INTEL - Delegation drafts
   -------------------------------------------------
   Genera mensajes listos para delegar.
   Tonos:
     - formal       : usted, lenguaje pulido
     - cordial      : tú, calidez profesional (default)
     - direct       : sin rodeos, ejecutivo
     - urgent       : marca urgencia, plazo claro
     - whatsapp_short : 1-2 frases, WA-friendly
   ============================================= */

const U = require('./_util');

const TONES = {
    formal:          { label: 'Formal',         pronoun: 'usted', style: 'lenguaje pulido y profesional, frases completas' },
    cordial:         { label: 'Cordial',        pronoun: 'tú',    style: 'calidez profesional, claro y amable' },
    direct:          { label: 'Directo',        pronoun: 'tú',    style: 'sin rodeos, una idea por frase, ejecutivo' },
    urgent:          { label: 'Urgente',        pronoun: 'tú',    style: 'marca el plazo claramente y la importancia' },
    whatsapp_short:  { label: 'WhatsApp corto', pronoun: 'tú',    style: 'máximo 2 frases, tono WhatsApp natural latino' }
};

async function createDelegationDraft({ instruction, recipient = null, tone = 'cordial', projectMatch = null, dueAt = null } = {}) {
    if (!instruction) return U.fail('instruction-required', 'Necesito qué quieres delegar.');

    const toneDef = TONES[tone] || TONES.cordial;

    // Resolver proyecto si se mencionó
    let project = null;
    if (projectMatch) {
        const r = U.knowledge.resolveProject(projectMatch);
        if (r.exact) project = r.exact;
    }

    // Si no hay LLM, fallback determinístico
    if (!U.openai.hasKey()) {
        const draft = buildDeterministicDraft({ instruction, recipient, tone, project, dueAt });
        return U.ok({
            recipient, tone, toneLabel: toneDef.label,
            project: project ? { id: project.id, name: project.name } : null,
            dueAt,
            draft,
            alternatives: []
        }, {
            summary: 'Borrador generado.',
            naturalResponse: `Listo, te dejo el borrador (${toneDef.label}).`
        });
    }

    const llm = await U.safeLLM({
        system: 'Eres Gunter, asistente que redacta mensajes para delegar tareas. Español neutro latinoamericano. Cero invención de datos.',
        prompt: `Quiero delegar lo siguiente:
INSTRUCCIÓN: "${instruction}"
DESTINATARIO: ${recipient || '(no especificado, usa "Hola,")'}
TONO: ${toneDef.label} — ${toneDef.style}
PRONOMBRE: ${toneDef.pronoun}
${project ? 'PROYECTO ASOCIADO: ' + project.name : ''}
${dueAt ? 'FECHA LÍMITE: ' + dueAt : ''}

Devuelve JSON estricto:
{
  "draft": "el mensaje listo para enviar (texto plano sin emojis salvo whatsapp_short)",
  "alternatives": ["1 versión alternativa más corta o más larga"]
}
NO inventes contexto que no esté en la instrucción.`,
        jsonMode: true, maxTokens: 380, temperature: 0.5
    });

    let draft = llm?.draft;
    if (!draft) draft = buildDeterministicDraft({ instruction, recipient, tone, project, dueAt });

    return U.ok({
        recipient,
        tone, toneLabel: toneDef.label,
        project: project ? { id: project.id, name: project.name } : null,
        dueAt,
        draft,
        alternatives: Array.isArray(llm?.alternatives) ? llm.alternatives.slice(0, 2) : []
    }, {
        summary: 'Borrador de delegación generado.',
        naturalResponse: `Listo, te dejo el borrador (${toneDef.label}).`,
        sources: project ? ['knowledge.snapshot'] : []
    });
}

function buildDeterministicDraft({ instruction, recipient, tone, project, dueAt }) {
    const greeting = recipient ? `Hola ${recipient},` : 'Hola,';
    const projectClause = project ? ` (proyecto ${project.name})` : '';
    const dueClause = dueAt ? ` antes del ${dueAt}` : '';
    if (tone === 'whatsapp_short') {
        return `${recipient ? recipient + ', ' : ''}por favor ${instruction}${dueClause}. Gracias.`;
    }
    if (tone === 'urgent') {
        return `${greeting}\n\nNecesito tu ayuda con esto${projectClause}: ${instruction}.${dueClause ? ' Es importante completarlo' + dueClause + '.' : ''} Avísame cualquier cosa.\n\nGracias.`;
    }
    if (tone === 'direct') {
        return `${greeting} ${instruction}${projectClause}${dueClause}. Cualquier duda, me dices.`;
    }
    if (tone === 'formal') {
        return `${greeting}\n\nLe escribo para solicitarle lo siguiente${projectClause}: ${instruction}${dueClause}. Quedo atento a su respuesta.\n\nSaludos cordiales.`;
    }
    return `${greeting}\n\n¿Me ayudas con algo${projectClause}? ${instruction}${dueClause}. Si tienes alguna pregunta, me escribes.\n\nGracias.`;
}

module.exports = { createDelegationDraft, TONES };
