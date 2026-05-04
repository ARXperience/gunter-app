/* =============================================
   GUNTER CORE - Intent Engine
   -------------------------------------------------
   Clasifica la intención del usuario en:
     task | meeting | reminder | document_analysis
     query | note | modify | cancel | greeting
   Capa 1 (reglas 0ms) → Capa 2 (LLM) si ambiguo.
   ============================================= */

(function () {
    const RULES = [
        // Saludo / control
        { intent: 'greeting',          re: /^(hola|hey|buenas|buenos d[ií]as|buenas tardes|buenas noches|qu[eé] tal)\b/i,     weight: 0.95 },
        // Fix Validación E2E #4: cancel debe ganar a meeting cuando ambos matchean
        // ("cancela esa reunión" → cancel, no meeting). Subo el peso a 0.93.
        { intent: 'cancel',            re: /\b(cancelar|cancela|elimina|borra|quita|remover|cancela(?:lo|la)?)\b/i,           weight: 0.93 },
        // Fix Validación E2E #3: añadir verbos "pásalo/pásala/pasa/muévelo" al regex modify.
        { intent: 'modify',            re: /\b(modificar|modifica|cambia|cambiar|mover|mueve|mu[eé]vel[oa]|reagenda|reprograma|actualiza|p[aá]sa(?:l[oa])?|pasa\s+(?:la|el|esa|ese|eso))\b/i, weight: 0.85 },

        // ========== Premium intents (Sprint B) ==========
        // Pesos > 0.93 para ganar a meeting/task/query cuando el comando es claro.
        { intent: 'daily_plan',        re: /\b(planif[ií]ca(?:me)?\s+(?:el\s+)?d[ií]a|organiza\s+(?:mi\s+)?d[ií]a|qu[eé]\s+(?:tengo|hago|debo\s+hacer)\s+hoy|brief\s+(?:de\s+)?hoy|plan\s+(?:de\s+)?hoy|qu[eé]\s+es\s+lo\s+m[aá]s\s+importante\s+hoy)\b/i, weight: 0.97 },
        { intent: 'weekly_plan',       re: /\b(organ[ií]za(?:me)?\s+(?:la\s+)?semana|planea\s+(?:mi\s+)?semana|plan\s+semanal|distribuye\s+(?:mis\s+)?tareas|qu[eé]\s+(?:tengo|debo\s+hacer)\s+(?:esta\s+)?semana)\b/i, weight: 0.97 },
        { intent: 'project_followup',  re: /\b(qu[eé]\s+proyectos?\s+(?:est[aá]n?\s+(?:quietos?|inactivos?|en\s+riesgo)|necesitan?\s+seguimiento)|haz\s+seguimiento|seguimiento\s+(?:de|del)|proyectos?\s+atrasados?)\b/i, weight: 0.95 },
        // Fix Validación E2E #1: "Resume X" cuando X es nombre capitalizado (probable proyecto)
        // o cuando se nombra un proyecto explícitamente.
        { intent: 'project_summary',   re: /\b(resume(?:me)?(?:\s+el)?\s+proyecto|resume(?:me)?\s+[A-ZÁÉÍÓÚÑ]\w+|res[uú]men\s+(?:de|del)|c[oó]mo\s+va\s+(?:el\s+proyecto)?|d(?:a|i)me\s+(?:el\s+)?estado\s+(?:de|del)|qu[eé]\s+(?:sabes|hay)\s+(?:de|del|sobre)\s+(?!hoy|ayer|ma[nñ]ana)\w)/i, weight: 0.92 },
        // Fix Validación E2E #2: "Dame X 360", "X 360", patrones más amplios
        { intent: 'project_360',       re: /\b(360|trescientos\s+sesenta|vista\s+completa|vista\s+general)\b|(?:abre|dame|d[ií]me|muestra|mu[eé]strame)\s+\w+\s+360\b/i, weight: 0.95 },
        { intent: 'meeting_followup',  re: /\b(follow[\-\s]?up|qu[eé]\s+(?:tareas|compromisos|decisiones)\s+(?:salieron|quedaron)|qu[eé]\s+sali[oó]\s+de\s+(?:la|esa)\s+reuni[oó]n|haz\s+follow[\-\s]?up)\b/i, weight: 0.95 },
        { intent: 'urgency_query',     re: /\b(qu[eé]\s+es\s+lo\s+m[aá]s\s+urgente|qu[eé]\s+debo\s+hacer\s+primero|ordena\s+(?:mis\s+)?pendientes|qu[eé]\s+desbloquea|qu[eé]\s+est[aá]\s+atrasado|prioridad(?:es)?)\b/i, weight: 0.96 },
        { intent: 'decision_query',    re: /\b(qu[eé]\s+decisiones?\s+(?:tomamos|hay|tenemos)|qu[eé]\s+se\s+decid[ií][oó]\s+sobre|cu[aá]ndo\s+se\s+(?:aprob[oó]|decidi[oó])|busca\s+(?:la\s+)?decisi[oó]n)\b/i, weight: 0.93 },
        { intent: 'decision_create',   re: /\b(guarda\s+(?:esta|esa)\s+decisi[oó]n|registr[ao]\s+(?:esta|la)\s+decisi[oó]n|decid(?:imos|í)\s+(?:que|cobrar|aprobar))/i, weight: 0.90 },
        { intent: 'smart_alerts',      re: /\b(alertas?\s+(?:inteligente|de\s+whatsapp|por\s+whatsapp)|env[ií]a\s+alertas?|preview\s+(?:de\s+)?alertas?|generar?\s+alertas?)\b/i, weight: 0.93 },
        { intent: 'delegation',        re: /\b(delegar?|delega(?:me)?|redact(?:a|ar)\s+mensaje\s+para|hazme\s+un\s+mensaje\s+para|escribe\s+(?:a|para)\s+\w+\s+(?:pidi[eé]ndole|para\s+que))\b/i, weight: 0.94 },

        // Existentes
        { intent: 'reminder',          re: /\b(recu[eé]rdame|recordar|avisame|av[ií]same|alarma|ponme un recordatorio)\b/i,    weight: 0.92 },
        { intent: 'meeting',           re: /\b(reuni[oó]n|junta|meeting|agendar|agenda|llamada|call|videollamada|zoom|meet|teams)\b/i, weight: 0.90 },
        { intent: 'task',              re: /\b(tarea|to\s?do|pendiente|hay que|tengo que|por hacer|apuntar|apunta|anota|toma nota|agrega a mi lista)\b/i, weight: 0.86 },
        { intent: 'document_analysis', re: /\b(analiza|resume|res[uú]meme|extrae|procesa|qu[eé] dice|de qu[eé] trata|transcribe|an[aá]lisis del documento)\b/i, weight: 0.88 },
        { intent: 'note',              re: /\b(nota|apunte|anotaci[oó]n|para acordarme|no lo olvides)\b/i,                      weight: 0.75 },
        { intent: 'query',             re: /\b(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|por qu[eé]|cu[aá]nto|qui[eé]n|cu[aá]l|muestra|mu[eé]strame|dime|dame|ens[eé]ñame)\b.*\?*$/i, weight: 0.65 },
        { intent: 'query',             re: /\?\s*$/,                                                                            weight: 0.75 }
    ];

    const SPLIT_CONNECTORS = /(?:\s+y\s+tambi[eé]n\s+|\s+adem[aá]s\s+|\s*;\s*|\s+y luego\s+|\s+y despu[eé]s\s+)/i;

    function scoreRules(text) {
        const scores = {};
        for (const r of RULES) {
            if (r.re.test(text)) {
                scores[r.intent] = Math.max(scores[r.intent] || 0, r.weight);
            }
        }
        return scores;
    }

    function pickPrimary(scores) {
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) return { type: 'query', confidence: 0.3 };
        return { type: entries[0][0], confidence: entries[0][1] };
    }

    function topAlternatives(scores, excludeType, n = 2) {
        return Object.entries(scores)
            .filter(([t]) => t !== excludeType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([type, confidence]) => ({ type, confidence }));
    }

    function detectMultiIntent(text) {
        if (text.length < 30) return null;
        if (!SPLIT_CONNECTORS.test(text)) return null;
        const parts = text.split(SPLIT_CONNECTORS).map(s => s.trim()).filter(s => s.length > 3);
        if (parts.length < 2) return null;
        return parts;
    }

    async function classifyIntent(text, userContext) {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return { primary: { type: 'query', confidence: 0 }, alternatives: [], multiIntent: false, method: 'rules' };
        }

        // Multi-intent
        const parts = detectMultiIntent(trimmed);
        if (parts) {
            const subIntents = [];
            for (const p of parts) {
                subIntents.push(await classifyIntent(p, userContext));
            }
            const primaryType = subIntents[0].primary.type;
            return {
                primary: { type: primaryType, confidence: subIntents[0].primary.confidence },
                alternatives: [],
                multiIntent: true,
                subIntents,
                method: 'rules'
            };
        }

        // Capa 1 — reglas
        const scores = scoreRules(trimmed);
        const primary = pickPrimary(scores);
        const alternatives = topAlternatives(scores, primary.type);

        if (primary.confidence >= 0.80) {
            return { primary, alternatives, multiIntent: false, method: 'rules' };
        }

        // Capa 2 — LLM
        if (window.GunterNlpLlm) {
            try {
                const llm = await classifyWithLlm(trimmed, userContext);
                if (llm && llm.primary && llm.primary.confidence >= primary.confidence) {
                    return { ...llm, method: 'llm' };
                }
            } catch { /* fallback below */ }
        }

        return { primary, alternatives, multiIntent: false, method: 'rules' };
    }

    async function classifyWithLlm(text, ctx) {
        const valid = window.GunterCoreModels?.INTENTS || [];
        const prompt = `Eres un clasificador de intenciones para un asistente en español.
Categorías válidas: ${valid.join(', ')}.
Frase: "${text}"
Contexto: timezone=${ctx.timezone}, hora=${ctx.now}, proyecto=${ctx.currentProject?.name || 'ninguno'}.

Responde SOLO con JSON:
{"primary": {"type":"<categoria>", "confidence": 0.0}, "alternatives":[{"type":"...","confidence":0.0}]}`;
        const raw = await window.GunterNlpLlm.complete(prompt, { temperature: 0, maxTokens: 200, jsonMode: true });
        const parsed = JSON.parse(raw);
        if (!valid.includes(parsed?.primary?.type)) parsed.primary.type = 'query';
        return {
            primary: parsed.primary,
            alternatives: parsed.alternatives || [],
            multiIntent: false
        };
    }

    function listSupportedIntents() {
        return window.GunterCoreModels?.INTENTS || [];
    }

    window.GunterIntentEngine = { classifyIntent, listSupportedIntents };
})();
