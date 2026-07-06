/* =============================================
   GUNTER APP - Analyses Engine (Multi-type, On-Demand)
   -------------------------------------------------
   Genera análisis especializados basándose en la
   transcripción real de la reunión. Cada análisis
   aplica una metodología profesional reconocida:

     proyectual   → PMBOK 8 Project Charter + WBS
     estrategico  → SWOT + PESTEL + Porter 5F
     ideas        → Jobs-To-Be-Done + Idea Mining
     tecnico      → SDLC + Arquitectura + Backlog
     narrativo    → Story Arc + Retention Curve
     riesgos      → Risk Register (ISO 31000, P×I)
     plan_accion  → SMART Goals + OKRs + RACI

   Los prompts y schemas JSON están estrictamente
   tipados para que el renderer sepa qué dibujar.
   ============================================= */

(function () {
    const ANALYSIS_DEFINITIONS = {
        proyectual: {
            id: 'proyectual',
            title: 'Análisis Proyectual',
            icon: '📋',
            description: 'Carta de proyecto (PMBOK 8) + WBS + stakeholders.',
            methodology: 'PMBOK 8 — Project Charter, Work Breakdown Structure, Stakeholder Matrix'
        },
        estrategico: {
            id: 'estrategico',
            title: 'Análisis Estratégico',
            icon: '♟️',
            description: 'SWOT, PESTEL y las 5 Fuerzas de Porter.',
            methodology: 'Kenneth Andrews (SWOT) · Aguilar (PESTEL) · Porter (5 Forces)'
        },
        ideas: {
            id: 'ideas',
            title: 'Ideas Rescatadas',
            icon: '💡',
            description: 'Insights y oportunidades mencionadas + Jobs-To-Be-Done.',
            methodology: 'Idea Mining + JTBD (Clayton Christensen)'
        },
        tecnico: {
            id: 'tecnico',
            title: 'Guía Técnica de Desarrollo',
            icon: '🛠️',
            description: 'Para proyectos de software: arquitectura, stack, backlog paso a paso.',
            methodology: 'SDLC + Arquitectura en capas + Agile backlog'
        },
        narrativo: {
            id: 'narrativo',
            title: 'Análisis Narrativo',
            icon: '🎬',
            description: 'Arco narrativo, gancho, ritmo y curva de retención.',
            methodology: 'Three-Act Structure · Freytag Pyramid · Attention Economy'
        },
        riesgos: {
            id: 'riesgos',
            title: 'Registro de Riesgos',
            icon: '⚠️',
            description: 'Riesgos identificados con Probabilidad × Impacto y mitigación.',
            methodology: 'ISO 31000 · FMEA · Risk Register (P×I)'
        },
        plan_accion: {
            id: 'plan_accion',
            title: 'Plan de Acción',
            icon: '🎯',
            description: 'Objetivos SMART + OKRs + matriz RACI.',
            methodology: 'Doran (SMART) · Doerr/Grove (OKRs) · RACI'
        }
    };

    function getAvailableAnalyses(environment) {
        // Todos están siempre disponibles; el usuario elige.
        // Orden sugerido por modo para UX.
        const order = {
            empresarial: ['proyectual', 'estrategico', 'riesgos', 'plan_accion', 'ideas', 'tecnico', 'narrativo'],
            artistico: ['ideas', 'narrativo', 'estrategico', 'plan_accion', 'proyectual', 'riesgos', 'tecnico'],
            podcast: ['narrativo', 'ideas', 'estrategico', 'plan_accion', 'proyectual', 'riesgos', 'tecnico'],
            zen: ['ideas', 'estrategico', 'proyectual', 'plan_accion', 'narrativo', 'riesgos', 'tecnico']
        };
        const list = order[environment] || order.empresarial;
        return list.map(id => ANALYSIS_DEFINITIONS[id]);
    }

    // ------------------ Personality per mode ------------------
    function personalityPrefix(environment) {
        switch ((environment || '').toLowerCase()) {
            case 'artistico':
                return 'Registro creativo profesional (director de arte / editor). Referencias a movimientos, estética y semiótica cuando aporten. Metáforas visuales precisas, no ornamentales.';
            case 'podcast':
                return 'Registro editorial (productor senior). Combina rigor estratégico con oído para narrativa y attention economy. Datos verificables > opiniones.';
            case 'zen':
                return 'Registro sereno, cross-disciplinario, con síntesis. Prioriza conexiones no obvias entre dominios. Sin new-age vacío: cada afirmación se sustenta en la transcripción.';
            case 'empresarial':
            default:
                return 'Registro consultor senior (McKinsey/BCG-grade). Prioriza tesis clara, tradeoffs explícitos, cuantificación cuando exista base. Lenguaje ejecutivo, no académico.';
        }
    }

    // ------------------ Prompt builders ------------------
    function buildPrompt(analysisId, { projectInfo, transcription, environment }) {
        const personality = personalityPrefix(environment);
        const def = ANALYSIS_DEFINITIONS[analysisId];
        const base = `# ROL
Eres GUNTER, consultor estratégico senior. Estás escribiendo un análisis que leerá un decisor (fundador/PM/director) con poco tiempo. Cada frase debe ganar su lugar.

# ESTILO OBLIGATORIO
${personality}
- Español neutro latinoamericano (es-419). Nunca modismos de España.
- Estructura: **tesis primero, evidencia después**. Nada de rodeos ni disclaimers.
- Cuantificación siempre que haya base en la transcripción (montos, plazos, %, nombres).
- Cada recomendación debe traer implícito el **tradeoff** o el **por qué ahora**.
- Nunca "hay que ver", "podría ser interesante", "en teoría". Si no hay datos, dilo con nombre y apellido en "gaps".

# METODOLOGÍA APLICADA
${def.methodology}

# CONTEXTO DEL PROYECTO
- Nombre: ${projectInfo.name || 'Sin nombre'}
- Entorno de reunión: ${environment}
- Mercado/Tema: ${projectInfo.market || 'No especificado'}
${projectInfo.budget ? `- Presupuesto declarado: ${projectInfo.budget}` : ''}
${projectInfo.timeline ? `- Plazo declarado: ${projectInfo.timeline}` : ''}

# TRANSCRIPCIÓN (fuente única de verdad — NO inventes fuera de esto)
"""
${(transcription || '').slice(0, 12000)}
"""

# REGLAS DURAS
1. **Cero fabricación.** Cada dato debe rastrearse a la transcripción. Si no está, escribe "No mencionado" o déjalo en el array "gaps".
2. **Coherencia interna.** Ningún campo debe contradecir a otro. Si el riesgo es alto, la recomendación debe reflejarlo.
3. **Evidencia trazable.** Cuando un schema pida "evidence", cita 3-12 palabras textuales o parafrasea con precisión. NO inventes citas.
4. **Priorización.** Si un array acepta múltiples items, ordénalos por impacto estratégico descendente (el primero es el más importante).
5. **Executive summary primero.** Todo análisis debe abrir con un campo "executive_summary" de 2-4 frases: qué encontraste, qué implica, qué recomiendas.
6. Devuelve **exclusivamente JSON válido** que coincida con el esquema. Sin markdown, sin comentarios, sin texto envolvente.
`;

        const schemas = {
            proyectual: `
ESQUEMA JSON REQUERIDO:
{
  "executive_summary": "2-4 frases: qué es el proyecto, en qué fase está según la reunión, cuál es el mayor bloqueador/palanca, qué debe pasar en los próximos 14 días.",
  "project_charter": {
    "purpose": "Propósito del proyecto en 1 frase (por qué existe, no qué es).",
    "objectives": ["Objetivo SMART 1 (con métrica y plazo)", "Objetivo SMART 2", "Objetivo SMART 3"],
    "scope_in": ["Qué SÍ entra en alcance — explícito"],
    "scope_out": ["Qué NO entra en alcance — la parte incómoda es la más útil"],
    "success_criteria": ["Criterio medible con umbral concreto (ej: >85% CSAT, <2s p95)"]
  },
  "stakeholders": [
    {"name": "Persona/rol mencionado", "role": "Rol funcional", "influence": "alta|media|baja", "interest": "alto|medio|bajo", "engagement_strategy": "Cómo mantenerlo alineado (1 frase accionable)"}
  ],
  "wbs": [
    {"phase": "Fase (nombre + orden)", "deliverables": ["Entregable A", "Entregable B"], "estimated_effort": "bajo|medio|alto", "depends_on": "Fase previa o null", "critical_path": true}
  ],
  "constraints": [{"type": "tiempo|presupuesto|recursos|legal|técnico", "description": "Descripción con dato concreto", "severity": "alta|media|baja"}],
  "assumptions": [{"statement": "Supuesto explícito", "validate_by": "Cómo/cuándo se debe validar"}],
  "gaps": ["Información crítica que NO se mencionó en la reunión y debería definirse (ej: 'presupuesto real', 'PM responsable', 'criterio de éxito Q1')"],
  "gunter_note": "1-2 frases desde la personalidad del modo con la tesis principal del análisis."
}`,
            estrategico: `
ESQUEMA JSON REQUERIDO:
{
  "executive_summary": "2-4 frases con la tesis estratégica: dónde compite el proyecto, cuál es la ventaja defendible, cuál es el mayor riesgo externo, qué mover primero.",
  "swot": {
    "strengths": [{"point": "Fortaleza interna", "why_defensible": "Por qué es difícil de copiar"}],
    "weaknesses": [{"point": "Debilidad interna", "so_what": "Cómo se traduce en impacto de negocio"}],
    "opportunities": [{"point": "Oportunidad externa", "time_window": "Ventana estimada (meses/trimestres)"}],
    "threats": [{"point": "Amenaza externa", "trigger": "Qué evento haría que se materialice"}]
  },
  "pestel": {
    "political": "Factores políticos relevantes (o 'No mencionado')",
    "economic": "Factores económicos con dato si existe",
    "social": "Factores sociales/culturales",
    "technological": "Factores tecnológicos",
    "environmental": "Factores ambientales",
    "legal": "Factores legales/regulatorios"
  },
  "porter_five_forces": {
    "competitive_rivalry": {"level": "baja|media|alta", "rationale": "Por qué, con evidencia"},
    "supplier_power": {"level": "baja|media|alta", "rationale": "Por qué"},
    "buyer_power": {"level": "baja|media|alta", "rationale": "Por qué"},
    "threat_new_entrants": {"level": "baja|media|alta", "rationale": "Barrera de entrada real"},
    "threat_substitutes": {"level": "baja|media|alta", "rationale": "Qué podría reemplazar"}
  },
  "strategic_recommendation": {
    "thesis": "Tesis en 1 frase (dónde jugar y cómo ganar).",
    "priority_moves": ["Movimiento 1 (accionable en 30 días)", "Movimiento 2", "Movimiento 3"],
    "trade_off": "Qué se sacrifica al elegir esta ruta (ninguna estrategia es gratis)."
  },
  "gaps": ["Información competitiva/de mercado que faltó cubrir"],
  "gunter_note": "1-2 frases desde la personalidad"
}`,
            ideas: `
ESQUEMA JSON REQUERIDO:
{
  "executive_summary": "2-3 frases: cuál es la insight de mayor palanca de la reunión, y qué oportunidad concreta habilita.",
  "key_insights": [
    {"title": "Insight en 4-8 palabras", "quote": "Cita textual o paráfrasis fiel (3-15 palabras)", "why_matters": "Implicación estratégica (no obvia)", "confidence": "alta|media|baja"}
  ],
  "jobs_to_be_done": [
    {"when": "Cuando... (situación concreta)", "i_want_to": "Yo quiero... (verbo de acción)", "so_that": "Para que... (outcome emocional/funcional)", "current_solution": "Cómo lo resuelve hoy (o null)"}
  ],
  "opportunities": [
    {"idea": "Oportunidad concreta y accionable", "potential_impact": "alto|medio|bajo", "effort": "alto|medio|bajo", "impact_effort_ratio": "prioritaria|considerar|descartar", "validation_step": "1 experimento de bajo costo para validar"}
  ],
  "contrarian_takes": ["Idea contraintuitiva con base en la conversación (no ocurrencias)"],
  "curious_fact": "Dato curioso VERIFICABLE que ilumine el tema (o null si no hay uno honesto).",
  "gaps": ["Preguntas que quedaron sin responder y son estratégicas"],
  "gunter_note": "1-2 frases desde la personalidad con la insight más provocadora."
}`,
            tecnico: `
ESQUEMA JSON REQUERIDO (aplica solo si se habla de sistema/software/app/plataforma; si NO, devuelve {"applicable": false, "reason": "..."} y omite el resto):
{
  "applicable": true,
  "executive_summary": "2-3 frases: qué se está construyendo, cuál es el mayor reto técnico, qué stack/arquitectura recomiendas y por qué.",
  "problem_statement": "Problema técnico a resolver en 1 frase (incluye restricciones de calidad: escala, latencia, cumplimiento).",
  "non_functional_requirements": [
    {"attribute": "escalabilidad|latencia|disponibilidad|seguridad|cumplimiento|costo|mantenibilidad", "target": "Umbral concreto (ej: p95<300ms, 99.9% uptime)"}
  ],
  "recommended_architecture": {
    "pattern": "Ej: Monolito modular | Microservicios | Serverless | SPA+API",
    "rationale": "Por qué este patrón dado los NFR y contexto de equipo",
    "components": [
      {"name": "Nombre", "responsibility": "Qué hace (1 frase)", "tech_suggestion": "Stack específico + versión si aplica", "sync_or_async": "sync|async|both"}
    ],
    "diagram_hint": "Descripción textual del diagrama (3-5 nodos y sus conexiones)"
  },
  "tech_stack": {
    "frontend": [{"option": "Recomendada", "rationale": "Por qué"}, {"option": "Alternativa", "rationale": "Cuándo elegirla"}],
    "backend":  [{"option": "Recomendada", "rationale": "Por qué"}, {"option": "Alternativa", "rationale": "Cuándo elegirla"}],
    "database": [{"option": "Recomendada", "rationale": "Por qué"}],
    "infrastructure": [{"option": "Hosting/CI recomendados", "rationale": "Por qué"}]
  },
  "data_model": [
    {"entity": "Entidad", "fields": ["campo:tipo", "campo:tipo"], "relations": "Con quién y cardinalidad (1:N, N:M)"}
  ],
  "implementation_steps": [
    {"step": 1, "title": "Título accionable", "tasks": ["Tarea 1", "Tarea 2"], "definition_of_done": "Criterio observable de que quedó terminado", "estimated_days": 3}
  ],
  "risks_technical": [{"risk": "Riesgo con impacto explícito", "mitigation": "Cómo se mitiga hoy o se contiene"}],
  "trade_offs": [{"decision": "Decisión tomada (ej: SQL vs NoSQL)", "gained": "Qué gana", "lost": "Qué pierde"}],
  "next_actions_for_dev": ["Acción concreta hoy para la persona que va a desarrollarlo (1er día)"],
  "gaps": ["Info técnica crítica que faltó definir en la reunión"],
  "gunter_note": "1-2 frases"
}`,
            narrativo: `
ESQUEMA JSON REQUERIDO:
{
  "executive_summary": "2-3 frases: cómo funciona la narrativa hoy, dónde pierde audiencia, qué corte/cambio mueve la aguja.",
  "hook_analysis": {
    "has_hook": true,
    "description": "Qué hace al gancho funcionar o fallar (1-2 frases)",
    "first_30s_score": 0,
    "improvement_suggestion": "Cómo abrirlo mejor si aplica"
  },
  "story_arc": {
    "setup": "Cómo arranca (1 frase)",
    "rising_action": "Desarrollo principal",
    "climax": "Punto álgido",
    "resolution": "Cierre",
    "arc_verdict": "completo|incompleto|invertido — con nota"
  },
  "pacing": {
    "rating": "lento|equilibrado|acelerado",
    "notes": "Notas sobre el ritmo con timestamps aproximados si existen",
    "dead_zones": ["Segmento con caída de tensión que se puede cortar"]
  },
  "retention_curve": [
    {"segment": "0-2 min", "estimated_retention": 95, "reason": "Por qué en 1 frase"},
    {"segment": "2-5 min", "estimated_retention": 80, "reason": "Por qué"}
  ],
  "emotional_arc": [
    {"segment": "0-2 min", "dominant_emotion": "curiosidad|tensión|humor|nostalgia|revelación|calma", "shift_from_previous": "cómo cambió respecto al segmento anterior"}
  ],
  "recommended_edits": [{"edit": "Cambio sugerido", "why": "Efecto esperado en retención/impacto", "priority": "alta|media|baja"}],
  "one_line_pitch": "El pitch de 1 frase que resume la pieza para venderla",
  "gunter_note": "1-2 frases"
}`,
            riesgos: `
ESQUEMA JSON REQUERIDO (basado en ISO 31000):
{
  "executive_summary": "2-3 frases: nivel de exposición general, cuál es el riesgo top, qué debe pasar en los próximos 30 días para contenerlo.",
  "risk_register": [
    {
      "id": "R1",
      "title": "Nombre corto del riesgo",
      "category": "técnico|financiero|operativo|legal|reputacional|cronograma|dependencia",
      "description": "Descripción con el mecanismo de daño explícito",
      "evidence": "Cita o paráfrasis de la transcripción (3-15 palabras)",
      "probability": 1,
      "impact": 1,
      "score": 1,
      "leading_indicator": "Señal temprana que anunciaría que se está materializando",
      "mitigation": "Estrategia concreta (acción + responsable + plazo)",
      "contingency": "Qué hacer si el riesgo se materializa igual",
      "owner": "Rol/persona responsable"
    }
  ],
  "top_risk": "ID del riesgo más crítico",
  "residual_risk_level": "bajo|medio|alto",
  "risk_appetite_note": "1 frase sobre si el perfil de riesgo del proyecto es coherente con lo que se dijo en la reunión.",
  "gaps": ["Categorías de riesgo que no se cubrieron y deberían revisarse"],
  "gunter_note": "1-2 frases"
}
IMPORTANTE: probability e impact son 1-5. score = probability × impact. Ordena risk_register por score descendente.`,
            plan_accion: `
ESQUEMA JSON REQUERIDO:
{
  "executive_summary": "2-3 frases: cuál es el foco de los próximos 30 días, quién debe liderar, cuál es la métrica de éxito principal.",
  "smart_goals": [
    {
      "goal": "Objetivo SMART completo en 1 frase",
      "specific": "Qué exactamente",
      "measurable": "Métrica + umbral",
      "achievable": "Por qué es alcanzable dado el estado actual",
      "relevant": "Por qué importa ahora (link con estrategia)",
      "timebound": "Plazo concreto"
    }
  ],
  "okrs": [
    {
      "objective": "Objetivo cualitativo inspirador",
      "key_results": [
        {"kr": "KR medible con línea base y meta", "baseline": "estado hoy", "target": "meta", "due": "cuándo"}
      ]
    }
  ],
  "raci_matrix": [
    {"activity": "Actividad concreta", "responsible": "Quién ejecuta", "accountable": "Quién rinde cuentas (uno solo)", "consulted": "A quién se consulta", "informed": "A quién se informa"}
  ],
  "next_7_days":  [{"action": "Acción concreta", "owner": "Nombre/rol", "success_signal": "Cómo sabremos que salió bien"}],
  "next_30_days": [{"action": "Acción concreta", "owner": "Nombre/rol", "success_signal": "Métrica observable"}],
  "dependencies_critical": ["Dependencia externa que puede bloquear el plan (persona, decisión, insumo)"],
  "check_in_cadence": "Frecuencia sugerida de review (ej: semanal 20 min) con formato",
  "gaps": ["Elementos del plan que quedaron sin owner o sin plazo y deben resolverse"],
  "gunter_note": "1-2 frases"
}`
        };

        return base + '\n' + schemas[analysisId];
    }

    // ------------------ Caller ------------------
    async function generate(analysisId, { projectInfo, transcription, environment }) {
        if (!ANALYSIS_DEFINITIONS[analysisId]) {
            throw new Error(`Análisis desconocido: ${analysisId}`);
        }
        if (!transcription || transcription.trim().length < 40) {
            throw new Error('La transcripción es demasiado corta para generar un análisis útil.');
        }

        // Fase 1 (blindaje): siempre proxy, nunca OpenAI directo desde cliente.
        const cfg = window.GUNTER_CONFIG || {};
        const url = cfg.PROXY_CHAT_URL || (typeof window.getApiUrl === 'function' ? window.getApiUrl('chat') : '/api/chat');
        const headers = { 'Content-Type': 'application/json' };

        const prompt = buildPrompt(analysisId, { projectInfo, transcription, environment });

        const body = {
            model: cfg.CHAT_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Eres Gunter, consultor estratégico senior. Escribes para un decisor con poco tiempo: tesis primero, cuantificación cuando exista base, tradeoffs explícitos. Cero fabricación: si no está en la transcripción, va en "gaps". Devuelves ÚNICAMENTE JSON válido que cumpla el esquema pedido, sin markdown ni texto envolvente.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.25,
            max_tokens: 3600,
            response_format: { type: 'json_object' }
        };

        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`AI HTTP ${resp.status}: ${t.slice(0, 200)}`);
        }
        const data = await resp.json();
        const raw = data.choices?.[0]?.message?.content || '';
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            const m = raw.match(/\{[\s\S]*\}/);
            if (!m) throw new Error('La IA no devolvió JSON válido.');
            parsed = JSON.parse(m[0]);
        }
        return {
            analysisId,
            definition: ANALYSIS_DEFINITIONS[analysisId],
            payload: parsed,
            generatedAt: new Date().toISOString(),
            environment
        };
    }

    window.GunterAnalyses = {
        definitions: ANALYSIS_DEFINITIONS,
        listFor: getAvailableAnalyses,
        generate
    };
})();
