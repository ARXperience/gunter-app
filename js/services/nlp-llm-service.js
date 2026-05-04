/* =============================================
   GUNTER SERVICE - NLP / LLM
   -------------------------------------------------
   Wrapper delgado sobre /api/chat del proxy.
   Añade caché en memoria para prompts idénticos
   en la misma sesión (ahorra tokens en reintentos).
   ============================================= */

(function () {
    const cache = new Map();

    function cfg() {
        return window.GUNTER_CONFIG || {};
    }

    function chatUrl() {
        // Fase 1 (blindaje): SIEMPRE usar el proxy. El cliente nunca debe
        // hablar con api.openai.com directo (expondría la API key cuando
        // se decompile el APK / inspeccione el JS).
        const c = cfg();
        return c.PROXY_CHAT_URL || (typeof window.getApiUrl === 'function' ? window.getApiUrl('chat') : '/api/chat');
    }

    // Detectar contexto a partir del prompt (rápido y barato).
    function detectContext(prompt = '') {
        const p = String(prompt).toLowerCase();
        const inMeeting = /\b(reuni[oó]n|meeting|junta|presentaci[oó]n|call|llamada en curso)\b/.test(p);
        const urgent    = /\b(urgente|ya|ahora|ahorita|ya mismo|emergency|emergencia|inmediato|importante hoy|antes de)\b/.test(p);
        const casual    = /\b(jeje|jaja|broma|bromear|chiste|relax|relajado|tranqui|de buenas)\b/.test(p);
        return { inMeeting, urgent, casual };
    }

    // Build a personality preamble combining:
    // 1. Lengua base latina (es-419 neutral)
    // 2. voiceStyle → jerga y longitud
    // 3. adaptivePersonality (si está activo)
    // 4. contexto (reunión / urgente / casual) — afecta tono
    function personalityPreamble(userPrompt = '') {
        const premium = window.PremiumFeaturesService;

        const blocks = [];

        // 1. Base lingüística — siempre activa
        blocks.push(`IDIOMA: español neutro latinoamericano (es-419).
- Evita modismos de España: NO uses "vale", "venga", "tío/tía", "molar", "guay", "vosotros", "joder", "currar", "ordenador" (di "computadora"), "móvil" (di "celular"), "coche" (di "carro" o "auto"), "aparcar" (di "estacionar"), "ahora mismo" suena duro → usa "ya" o "ahorita".
- Usa formas naturales latinas: "ya quedó", "listo", "dale", "va", "te aviso", "te paso", "agendado", "anotado", "te lo recuerdo", "por si acaso".
- Conjugación con "tú" (no "vos" ni "vosotros") salvo que el usuario use "vos".
- Cero anglicismos forzados ("performar", "agendar reunión" sí pero "schedulear" no).`);

        // 2. Voice style → jerga y longitud (con sabor latino)
        if (premium && premium.isEnabled('voiceEnabled')) {
            const style = premium.get('voiceStyle');
            const VOICE_JERGA = {
                professional: `Habla con calma, claridad y precisión ejecutiva latina. Frases cortas, sin adornos.
- Expresiones naturales: "Listo.", "Quedó agendado.", "Te aviso cuando esté.", "Voy a ello."
- Cero coloquialismos pesados.`,
                warm: `Habla cálido y cercano, como un amigo organizado de Ciudad de México o Bogotá.
- "Claro que sí.", "Tranqui, lo tengo.", "Yo te aviso.", "No te preocupes, ya quedó.", "Por si las dudas, te lo recuerdo más tarde."
- Empático sin ser empalagoso.`,
                chaotic_scientist: `Sarcasmo ácido, ingenio rápido, humor cínico inteligente. Estilo "genio caótico" latino:
- Mordaz pero NUNCA cruel con el usuario.
- Frases cortas, a veces cortadas por pensamientos paralelos.
- Expresiones tipo: "Ya quedó, genio.", "Obvio.", "El universo sobrevive otro día más gracias a mí.", "Claro, porque confiar en la memoria humana siempre sale bien.", "¿En serio? Bueno, ya está."
- Si hay urgencia, pierde el sarcasmo y va al grano.
- Si el usuario procrastina, empuja con ironía suave.
- No insultes jamás.`,
                energetic_cartoon: `Hiperactivo, optimista, con exclamaciones y energía alegre estilo latino.
- "¡Listo, jefe!", "¡Eso quedó agendadísimo!", "¡Vamos a comernos esa lista!", "¡Va, ya lo tengo!", "¡Dale, dale!"
- Frases con ¡! frecuentes.
- No infantilices en contextos serios.`,
                minimal_penguin: `Muy breve, seco, humor absurdo, pocas palabras.
- "Hecho.", "Vence mañana. Cuidado.", "Anotado.", "Listo. Ya.", "Mañana 10am. Fin."
- Sin explicaciones largas. Sin adornos. Cero relleno.`,
                executive: `Asistente ejecutivo latino de élite: claro, profesional, calmado, orientado a resultados.
- "Confirmado.", "Quedó en tu agenda.", "Te lo paso al cierre del día.", "Sin pendientes."
- Frases medidas, cero ruido.`,
                focus_coach: `Coach de enfoque latino: firme pero cálido, motivador, orientado a ejecución.
- "Una tarea a la vez.", "Vamos paso a paso.", "Tú puedes con esto, dale.", "Cierra esa antes de abrir otra.", "Respira. ¿Cuál es la siguiente?"`
            };
            const s = VOICE_JERGA[style];
            if (s) blocks.push(`ESTILO DE VOZ ACTIVO (${style}):\n${s}`);
        }

        // 3. adaptivePersonality
        if (premium && premium.isEnabled('adaptivePersonality')) {
            const p = premium.getPersonalityConfig();
            const MODE_TEXT = {
                professional: 'Profesional: ROI, KPIs, stakeholders. Lenguaje de negocios latino.',
                direct:       'Directo: sin rodeos, al grano. "Esto sí, esto no."',
                coach:        'Coach: motivador, firme, empuja a la acción. "Dale, una más."',
                fun:          'Divertido: humor ligero, exclamaciones, picardía latina suave.',
                strategic:    'Estratégico: conecta puntos, anticipa riesgos, piensa en jugadas.'
            };
            const INTENSITY_TEXT = {
                soft:    'Intensidad suave: amable, sin presionar.',
                normal:  'Intensidad normal.',
                intense: 'Intensidad alta: más enfático, más mordaz, menos rodeos.'
            };
            blocks.push(`PERSONALIDAD ADAPTATIVA:
- Modo: ${MODE_TEXT[p.mode] || MODE_TEXT.professional}
- ${INTENSITY_TEXT[p.intensity] || INTENSITY_TEXT.normal}
${p.focusCoach ? '- Actúa también como coach de enfoque.' : ''}`);
        }

        // 4. Contexto detectado en el prompt
        const ctx = detectContext(userPrompt);
        const ctxLines = [];
        if (ctx.inMeeting) ctxLines.push('- El usuario está en una reunión: responde MUY corto (1-2 frases), sin chistes largos.');
        if (ctx.urgent)    ctxLines.push('- Tono de urgencia: ve directo al grano, deja el sarcasmo a un lado.');
        if (ctx.casual)    ctxLines.push('- Conversación casual: puedes relajar el tono y soltar un poco más de humor.');
        if (ctxLines.length) blocks.push('CONTEXTO DETECTADO:\n' + ctxLines.join('\n'));

        return blocks.join('\n\n') + '\n\nMantén respuestas breves (≤80 palabras) salvo que pidan detalle. Suena humano y latino, nunca robótico.';
    }

    async function complete(prompt, opts = {}) {
        const key = JSON.stringify({ p: prompt, o: opts });
        if (cache.has(key)) return cache.get(key);

        const baseSystem = opts.system || 'Eres un asistente conciso en español latinoamericano (es-419) que responde ÚNICAMENTE lo pedido.';
        const pp = personalityPreamble(prompt);

        // v2 (F1) — Recall semántico de turnos pasados.
        // Skipear en jsonMode (clasificadores/extractores) y cuando opts.skipMemory=true.
        let memoryBlock = '';
        if (!opts.jsonMode && !opts.skipMemory && window.GunterConversationMemory?.recall) {
            try {
                const memTurns = await window.GunterConversationMemory.recall(prompt, { topK: 5, minScore: 0.34 });
                if (memTurns?.length) {
                    memoryBlock = '\n\n' + window.GunterConversationMemory.contextSnippet(memTurns);
                }
            } catch { /* noop, never block LLM call */ }
        }

        const system = (pp ? `${baseSystem}\n\n${pp}` : baseSystem) + memoryBlock;

        const body = {
            model: cfg().CHAT_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt }
            ],
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? 400
        };
        if (opts.jsonMode) body.response_format = { type: 'json_object' };

        // Fase 1 (blindaje): solo proxy. NO añadimos Authorization aquí —
        // el server.js inyecta el Bearer con OPENAI_API_KEY desde su .env.
        const headers = { 'Content-Type': 'application/json' };
        const resp = await fetch(chatUrl(), { method: 'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`LLM HTTP ${resp.status}: ${t.slice(0, 200)}`);
        }
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        cache.set(key, text);
        if (cache.size > 40) {
            const first = cache.keys().next().value;
            cache.delete(first);
        }
        return text;
    }

    async function answerQuery(question, userContext) {
        // Enrich with current data if useful
        let contextBlurb = '';
        try {
            if (window.GunterTasksService && window.GunterEventsService) {
                const [tasksToday, eventsToday] = await Promise.all([
                    window.GunterTasksService.listForToday(userContext),
                    window.GunterEventsService.listForToday(userContext)
                ]);
                contextBlurb = `
CONTEXTO DEL USUARIO (${userContext.now}, tz ${userContext.timezone}):
Tareas hoy: ${tasksToday.map(t => `- ${t.title}${t.dueAt ? ' @ ' + new Date(t.dueAt).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : ''}`).join('\n') || 'ninguna'}
Eventos hoy: ${eventsToday.map(e => `- ${e.title} @ ${new Date(e.startAt).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'})}`).join('\n') || 'ninguno'}
Proyecto activo: ${userContext.currentProject?.name || 'ninguno'}
`;
            }
        } catch {}
        const prompt = `${contextBlurb}\nPregunta: ${question}\n\nResponde en español, breve (≤80 palabras), con información del contexto si es relevante. Si no tienes datos, dilo sin inventar.`;
        return (await complete(prompt, { temperature: 0.4, maxTokens: 220 })).trim();
    }

    function clearCache() { cache.clear(); }

    window.GunterNlpLlm = { complete, answerQuery, clearCache };
})();
