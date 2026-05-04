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
                return 'Habla con sensibilidad creativa. Conecta con movimientos artísticos y estética. Usa metáforas visuales.';
            case 'podcast':
                return 'Tono divertido pero inteligente. Incluye 1-2 datos curiosos cuando sean relevantes. Referencia cultura pop si encaja.';
            case 'zen':
                return 'Tono sereno y sabio, adaptado al registro de la conversación. Señala conexiones no obvias entre disciplinas. Suelta un dato curioso y un chiste ligero cuando aporten.';
            case 'empresarial':
            default:
                return 'Tono profesional, directo y estratégico. Usa terminología de gestión. Enfócate en ROI, KPIs y stakeholders.';
        }
    }

    // ------------------ Prompt builders ------------------
    function buildPrompt(analysisId, { projectInfo, transcription, environment }) {
        const personality = personalityPrefix(environment);
        const def = ANALYSIS_DEFINITIONS[analysisId];
        const base = `Eres GUNTER 🐧, consultor estratégico de élite.
${personality}

METODOLOGÍA: ${def.methodology}.
Contexto del proyecto:
- Nombre: ${projectInfo.name || 'Sin nombre'}
- Entorno: ${environment}
- Mercado/Tema: ${projectInfo.market || 'No especificado'}
${projectInfo.budget ? `- Presupuesto: ${projectInfo.budget}` : ''}
${projectInfo.timeline ? `- Plazo: ${projectInfo.timeline}` : ''}

TRANSCRIPCIÓN COMPLETA DE LA REUNIÓN:
"""
${(transcription || '').slice(0, 12000)}
"""

REGLAS:
1. Extrae SIEMPRE del contenido real. No inventes datos.
2. Si un campo no se puede inferir, escribe "No mencionado" — NO inventes.
3. Responde EXCLUSIVAMENTE con un JSON válido que coincida con el esquema pedido.
4. No envuelvas el JSON en bloques de código ni añadas texto fuera del JSON.
`;

        const schemas = {
            proyectual: `
ESQUEMA JSON REQUERIDO:
{
  "project_charter": {
    "purpose": "Propósito del proyecto en una frase",
    "objectives": ["Objetivo SMART 1", "Objetivo SMART 2", "Objetivo SMART 3"],
    "scope_in": ["Qué SÍ entra en alcance"],
    "scope_out": ["Qué NO entra en alcance"],
    "success_criteria": ["Criterio medible 1", "Criterio medible 2"]
  },
  "stakeholders": [
    {"name": "Persona/rol mencionado", "role": "Rol", "influence": "alta|media|baja", "interest": "alto|medio|bajo"}
  ],
  "wbs": [
    {"phase": "Fase 1 (nombre)", "deliverables": ["Entregable A", "Entregable B"], "estimated_effort": "bajo|medio|alto"}
  ],
  "constraints": ["Restricción 1 (tiempo, presupuesto, recursos, legal)"],
  "assumptions": ["Supuesto que debe validarse"],
  "gunter_note": "1-2 frases desde la personalidad del modo"
}`,
            estrategico: `
ESQUEMA JSON REQUERIDO:
{
  "swot": {
    "strengths": ["Fortaleza interna 1"],
    "weaknesses": ["Debilidad interna 1"],
    "opportunities": ["Oportunidad externa 1"],
    "threats": ["Amenaza externa 1"]
  },
  "pestel": {
    "political": "Factores políticos relevantes (o 'No mencionado')",
    "economic": "Factores económicos",
    "social": "Factores sociales/culturales",
    "technological": "Factores tecnológicos",
    "environmental": "Factores ambientales",
    "legal": "Factores legales/regulatorios"
  },
  "porter_five_forces": {
    "competitive_rivalry": "baja|media|alta + explicación breve",
    "supplier_power": "baja|media|alta + explicación",
    "buyer_power": "baja|media|alta + explicación",
    "threat_new_entrants": "baja|media|alta + explicación",
    "threat_substitutes": "baja|media|alta + explicación"
  },
  "strategic_recommendation": "Recomendación estratégica de 2-3 frases",
  "gunter_note": "1-2 frases desde la personalidad"
}`,
            ideas: `
ESQUEMA JSON REQUERIDO:
{
  "key_insights": [
    {"title": "Insight", "quote": "Cita o paráfrasis de la reunión", "why_matters": "Por qué importa"}
  ],
  "jobs_to_be_done": [
    {"when": "Cuando...", "i_want_to": "Yo quiero...", "so_that": "Para que..."}
  ],
  "opportunities": [
    {"idea": "Oportunidad concreta", "potential_impact": "alto|medio|bajo", "effort": "alto|medio|bajo"}
  ],
  "contrarian_takes": ["Idea contraintuitiva o poco explorada"],
  "curious_fact": "Un dato curioso relacionado con el tema (opcional)",
  "gunter_note": "1-2 frases desde la personalidad"
}`,
            tecnico: `
ESQUEMA JSON REQUERIDO (aplica si se habla de sistema/software/app/plataforma; si NO es un proyecto técnico, devuelve "applicable": false con el motivo):
{
  "applicable": true,
  "problem_statement": "Problema técnico a resolver en 1 frase",
  "recommended_architecture": {
    "pattern": "Ej: Monolito modular | Microservicios | Serverless | SPA+API",
    "rationale": "Por qué encaja",
    "components": [
      {"name": "Nombre del componente", "responsibility": "Qué hace", "tech_suggestion": "Stack sugerido"}
    ]
  },
  "tech_stack": {
    "frontend": ["Opción recomendada + alternativa"],
    "backend": ["Opción recomendada + alternativa"],
    "database": ["Recomendada"],
    "infrastructure": ["Hosting/CI recomendados"]
  },
  "data_model": [
    {"entity": "Entidad", "fields": ["campo1:tipo", "campo2:tipo"], "relations": "Con quién se relaciona"}
  ],
  "implementation_steps": [
    {"step": 1, "title": "Setup base", "tasks": ["Tarea 1", "Tarea 2"], "definition_of_done": "Qué significa terminado"}
  ],
  "risks_technical": ["Riesgo técnico y cómo mitigarlo"],
  "next_actions_for_dev": ["Acción concreta para la persona que va a desarrollarlo"],
  "gunter_note": "1-2 frases"
}`,
            narrativo: `
ESQUEMA JSON REQUERIDO:
{
  "hook_analysis": {
    "has_hook": true,
    "description": "Qué hace al gancho funcionar o no",
    "first_30s_score": 0
  },
  "story_arc": {
    "setup": "Cómo arranca",
    "rising_action": "Desarrollo principal",
    "climax": "Punto álgido",
    "resolution": "Cierre"
  },
  "pacing": {
    "rating": "lento|equilibrado|acelerado",
    "notes": "Notas sobre el ritmo"
  },
  "retention_curve": [
    {"segment": "0-2 min", "estimated_retention": 95, "reason": "Por qué"},
    {"segment": "2-5 min", "estimated_retention": 80, "reason": "Por qué"}
  ],
  "recommended_edits": ["Edit/cambio sugerido para mejorar retención"],
  "gunter_note": "1-2 frases"
}`,
            riesgos: `
ESQUEMA JSON REQUERIDO (basado en ISO 31000):
{
  "risk_register": [
    {
      "id": "R1",
      "title": "Nombre del riesgo",
      "category": "técnico|financiero|operativo|legal|reputacional|cronograma",
      "description": "Descripción del riesgo",
      "probability": 1,
      "impact": 1,
      "score": 1,
      "mitigation": "Estrategia de mitigación concreta",
      "owner": "Responsable propuesto (rol)"
    }
  ],
  "top_risk": "ID del riesgo más crítico",
  "residual_risk_level": "bajo|medio|alto",
  "gunter_note": "1-2 frases"
}
IMPORTANTE: probability e impact son 1-5. score = probability × impact.`,
            plan_accion: `
ESQUEMA JSON REQUERIDO:
{
  "smart_goals": [
    {
      "goal": "Objetivo SMART completo",
      "specific": "Qué exactamente",
      "measurable": "Cómo se mide",
      "achievable": "Por qué es alcanzable",
      "relevant": "Por qué importa ahora",
      "timebound": "Plazo concreto"
    }
  ],
  "okrs": [
    {
      "objective": "Objetivo cualitativo inspirador",
      "key_results": ["KR medible 1", "KR medible 2", "KR medible 3"]
    }
  ],
  "raci_matrix": [
    {"activity": "Actividad concreta", "responsible": "Quién ejecuta", "accountable": "Quién rinde cuentas", "consulted": "A quién se consulta", "informed": "A quién se informa"}
  ],
  "next_7_days": ["Acción a hacer en los próximos 7 días"],
  "next_30_days": ["Acción a hacer en 30 días"],
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
                { role: 'system', content: 'Eres Gunter, consultor estratégico. Respondes ÚNICAMENTE con JSON válido que cumpla el esquema pedido.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.4,
            max_tokens: 2400,
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
