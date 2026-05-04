/* =============================================
   GUNTER CORE - Entity Extractor
   -------------------------------------------------
   Extrae del texto: título, expresiones temporales
   (sin resolver todavía), personas, prioridad,
   proyecto, tags, ubicación, notas.

   Técnica: regex + matching contra contexto +
   LLM para títulos limpios y casos raros.
   ============================================= */

(function () {
    const TIME_WORDS = /\b(hoy|mañana|manana|pasado\s+mañana|pasado\s+manana|ayer|ahora|más tarde|mas tarde|esta\s+(mañana|manana|tarde|noche)|próxim[oa]\s+(semana|mes|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|este\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|en\s+\d+\s+(minutos?|horas?|d[ií]as?|semanas?|meses?)|a\s+las?\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|de\s+la\s+(mañana|manana|tarde|noche))?|\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|\d{1,2}h\b|\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|todos los (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)s?|cada (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\b/gi;

    const PRIORITY_HIGH     = /\b(urgente|urgentísim[oa]|asap|inmediat[oa]|ya|ahora mismo|sin falta|cr[ií]tic[oa]|importantísim[oa]|prioridad alta)\b/i;
    const PRIORITY_NORMAL_H = /\b(importante|prioridad)\b/i;
    const PRIORITY_LOW      = /\b(cuando puedas|sin prisa|cuando tengas tiempo|prioridad baja|no urge)\b/i;

    const TAG_RE            = /(?:^|\s)#([a-z0-9_\-áéíóúüñ]+)/gi;
    const MENTION_RE        = /(?:^|\s)@([a-záéíóúñ][a-záéíóúñ\s-]{0,40})/gi;
    const LOCATION_RE       = /\b(?:en|desde|hacia)\s+(la oficina|casa|el bar|el restaurante|zoom|meet|teams|la sala\s+\w+|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i;

    function findSpans(text, re) {
        const matches = [];
        let m;
        const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        while ((m = r.exec(text)) !== null) {
            matches.push({ value: m[1] || m[0], span: [m.index, m.index + m[0].length] });
        }
        return matches;
    }

    function extractDatetimeExpressions(text) {
        const expressions = [];
        let m;
        TIME_WORDS.lastIndex = 0;
        while ((m = TIME_WORDS.exec(text)) !== null) {
            expressions.push({
                raw: m[0].trim(),
                span: [m.index, m.index + m[0].length],
                kind: /todos los|cada/.test(m[0]) ? 'recurring' : 'relative'
            });
        }
        return expressions;
    }

    function extractPriority(text) {
        if (PRIORITY_HIGH.test(text)) return 'urgent';
        if (PRIORITY_NORMAL_H.test(text)) return 'high';
        if (PRIORITY_LOW.test(text)) return 'low';
        return 'normal';
    }

    function extractPeople(text, ctx) {
        const people = [];
        const mentions = findSpans(text, MENTION_RE);
        for (const m of mentions) {
            people.push({ name: m.value.trim(), span: m.span });
        }
        // Match known people by name from recent entities
        const known = ctx?.recentEntities?.people || [];
        for (const p of known) {
            const re = new RegExp(`\\b${p.name.split(' ')[0]}\\b`, 'i');
            const m = text.match(re);
            if (m) {
                people.push({
                    name: p.name,
                    matchedContactId: p.id,
                    span: [m.index, m.index + m[0].length]
                });
            }
        }
        // Generic "con <Nombre>" pattern
        const conRe = /\bcon\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/g;
        let m;
        while ((m = conRe.exec(text)) !== null) {
            const name = m[1].trim();
            if (!people.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                people.push({ name, span: [m.index + 4, m.index + m[0].length] });
            }
        }
        return people;
    }

    function extractProjectRef(text, ctx) {
        const projects = ctx?.recentEntities?.projects || [];
        for (const p of projects) {
            const re = new RegExp(`\\b${escapeRe(p.name)}\\b`, 'i');
            const m = text.match(re);
            if (m) return { name: p.name, matchedProjectId: p.id, span: [m.index, m.index + m[0].length] };
        }
        // "proyecto X" free form
        const free = text.match(/\bproyecto\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][a-záéíóúñ0-9_\- ]{1,40})/i);
        if (free) {
            return { name: free[1].trim(), span: [free.index, free.index + free[0].length] };
        }
        return null;
    }

    function extractTags(text) {
        return findSpans(text, TAG_RE).map(t => t.value.toLowerCase());
    }

    function extractLocation(text) {
        const m = text.match(LOCATION_RE);
        if (!m) return null;
        return { value: m[1], span: [m.index, m.index + m[0].length] };
    }

    /**
     * Construye un título limpio quitando las expresiones temporales y de contexto.
     * Si el título quedaría vacío o demasiado corto, se usa LLM como fallback.
     */
    function deriveTitle(text, entities) {
        let cleaned = text;
        const spans = [
            ...(entities.datetimeExpr || []),
            ...(entities.tags || []).map(t => ({ span: findSpans(text, new RegExp(`#${escapeRe(t)}`, 'gi'))[0]?.span })).filter(s => s.span)
        ].filter(Boolean).sort((a, b) => b.span[0] - a.span[0]);

        for (const s of spans) {
            if (s.span) cleaned = cleaned.slice(0, s.span[0]) + cleaned.slice(s.span[1]);
        }
        cleaned = cleaned
            .replace(/^(recu[eé]rdame|avisame|av[ií]same|agenda|crea una tarea de|hay que|tengo que|por favor)/i, '')
            .replace(/\b(el|la|los|las)\b\s*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/[,.\s]+$/g, '')
            .replace(/^[,.\s]+/g, '')
            .trim();
        return cleaned;
    }

    async function titleFromLlm(text, intent) {
        if (!window.GunterNlpLlm) return null;
        const prompt = `Extrae un título breve (máx. 8 palabras) para esta ${intent} en español. Solo responde con el texto del título, sin comillas ni explicaciones.\nFrase: "${text}"`;
        try {
            const res = await window.GunterNlpLlm.complete(prompt, { temperature: 0.2, maxTokens: 40 });
            return res.trim().replace(/^["'«]|["'»]$/g, '');
        } catch { return null; }
    }

    function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    async function extractEntities(text, intentResult, userContext) {
        const em = window.GunterCoreModels.emptyEntityMap(text);
        em.datetimeExpr = extractDatetimeExpressions(text);
        em.priority = extractPriority(text);
        em.people = extractPeople(text, userContext);
        em.projectRef = extractProjectRef(text, userContext);
        em.tags = extractTags(text);
        em.location = extractLocation(text);

        const intent = intentResult?.primary?.type;
        const needsTitle = ['task', 'reminder', 'meeting', 'note'].includes(intent);
        if (needsTitle) {
            let title = deriveTitle(text, em);
            if (!title || title.length < 3) {
                const llmTitle = await titleFromLlm(text, intent);
                if (llmTitle) title = llmTitle;
            }
            if (title) em.title = { value: title, span: [0, text.length], confidence: 0.75 };
        }

        // Detect missing required fields
        em.missing = requiredEntitiesFor(intent).filter(k => !em[k] || (Array.isArray(em[k]) && em[k].length === 0));
        return em;
    }

    function requiredEntitiesFor(intentType) {
        switch (intentType) {
            case 'task':        return ['title'];
            case 'reminder':    return ['title', 'datetimeExpr'];
            case 'meeting':     return ['title', 'datetimeExpr'];
            case 'note':        return ['title'];
            case 'document_analysis': return [];
            default: return [];
        }
    }

    window.GunterEntityExtractor = { extractEntities, requiredEntitiesFor };
})();
