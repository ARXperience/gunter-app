/* =============================================
   COMMITMENTS — LLM Extractor (v2 — F2)
   -------------------------------------------------
   Recibe texto (transcript de reunión, mensaje, chat)
   y devuelve array de promesas detectadas estructuradas.
   ============================================= */

const openai = require('../openai-client');

const SYSTEM = `Eres un detector de compromisos en español.
Lees texto y extraes SOLO promesas concretas con un responsable, una acción y opcionalmente un destinatario y un plazo.
Ignora:
- frases hipotéticas ("podríamos hacer X")
- aspiraciones vagas ("hay que mejorar")
- decisiones sin acción ("decidimos esperar")
Acepta:
- promesas explícitas ("yo te envío el reporte el viernes")
- compromisos de terceros ("Marta enviará la propuesta mañana")
- recordatorios accionables ("recuérdame llamar a Pedro la próxima semana")

Responde SOLO con JSON válido:
{
  "commitments": [
    {
      "owner": "<nombre o 'yo' o 'el cliente' o 'el equipo'>",
      "beneficiary": "<nombre o 'mí' o null>",
      "action": "<verbo + objeto, ej: 'enviar reporte trimestral'>",
      "context": "<frase original literal, ≤180 chars>",
      "dueAt": "<ISO 8601 o null si no hay plazo claro>",
      "confidence": <0.0–1.0>
    }
  ]
}

Si no hay compromisos claros, devuelve {"commitments": []}.
Sé conservador: prefiere omitir a inventar.`;

/**
 * Extrae compromisos de un texto. Devuelve array (puede ser vacío).
 * @param {Object} opts
 * @param {string} opts.text — texto a analizar (transcript, mensaje, etc.)
 * @param {string} [opts.sourceType] — 'meeting' | 'chat' | 'whatsapp' | 'manual'
 * @param {string} [opts.sourceRefId] — id de la transcripción/mensaje
 * @param {string} [opts.sourceTs] — ISO timestamp del origen (para resolver plazos relativos)
 * @param {string} [opts.userName] — nombre del usuario, para mapear "yo" → owner real
 * @param {string} [opts.timezone] — para resolver plazos relativos correctamente
 */
async function extractCommitments({ text, sourceType = 'manual', sourceRefId = null, sourceTs = null, userName = 'yo', timezone = 'America/Bogota' } = {}) {
    if (!openai.hasKey()) return [];
    const t = String(text || '').trim();
    if (t.length < 20) return [];

    const truncated = t.length > 6000 ? t.slice(0, 6000) + '…' : t;

    const promptCtx = `Origen: ${sourceType}${sourceRefId ? ` (#${sourceRefId})` : ''}${sourceTs ? ` el ${sourceTs}` : ''}.
Usuario actual: "${userName}". Cuando el texto diga "yo", "te", "me", el responsable es "${userName}" salvo contexto contrario.
Timezone para plazos relativos: ${timezone}.
Hoy es ${new Date().toISOString()}.

Texto a analizar:
"""
${truncated}
"""`;

    try {
        const raw = await openai.chatComplete({
            messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: promptCtx }
            ],
            temperature: 0.1,
            maxTokens: 800,
            jsonMode: true
        });
        if (!raw) return [];
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch {
            const m = raw.match(/\{[\s\S]*\}/);
            parsed = m ? JSON.parse(m[0]) : null;
        }
        const arr = parsed?.commitments;
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(c => c && c.action && (c.confidence == null || c.confidence >= 0.5))
            .map(c => ({
                owner: String(c.owner || 'unknown').trim(),
                beneficiary: c.beneficiary ? String(c.beneficiary).trim() : 'unknown',
                action: String(c.action).trim(),
                context: String(c.context || '').slice(0, 600),
                dueAt: c.dueAt || null,
                source: { type: sourceType, refId: sourceRefId, ts: sourceTs || new Date().toISOString() }
            }));
    } catch (e) {
        console.warn('[commitments/extractor] failed:', e.message);
        return [];
    }
}

/**
 * Verifica si un nuevo evento (tarea creada, doc subido, mensaje enviado) cumple algún
 * commitment pendiente. Devuelve array de IDs cumplidos.
 */
async function checkFulfillmentLLM({ pendingCommitments = [], event = {} }) {
    if (!openai.hasKey() || !pendingCommitments.length) return [];
    const eventText = [event.title, event.description, event.content].filter(Boolean).join(' — ').slice(0, 500);
    if (!eventText) return [];

    const list = pendingCommitments.slice(0, 30).map((c, i) =>
        `${i + 1}. [${c.id}] (${c.owner}) ${c.action}${c.dueAt ? ' — antes de ' + c.dueAt : ''}`
    ).join('\n');

    const prompt = `Lista de compromisos pendientes:
${list}

Nuevo evento:
"""
${eventText}
"""

¿Cuáles compromisos de la lista quedan cumplidos por este evento? Sé estricto: solo si la acción claramente coincide.

Responde SOLO con JSON: {"fulfilledIds": ["cmt_xxx", ...]}`;

    try {
        const raw = await openai.chatComplete({
            messages: [
                { role: 'system', content: 'Eres un verificador estricto de cumplimiento de compromisos. Devuelves SOLO JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0,
            maxTokens: 200,
            jsonMode: true
        });
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.fulfilledIds) ? parsed.fulfilledIds : [];
    } catch (e) {
        console.warn('[commitments/checkFulfillmentLLM] failed:', e.message);
        return [];
    }
}

module.exports = { extractCommitments, checkFulfillmentLLM };
