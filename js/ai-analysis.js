/* =============================================
   GUNTER APP - AI Analysis Service
   OpenAI GPT-4o-mini Integration
   ============================================= */

class GunterAnalysisService {
  constructor(options = {}) {
    // Use config.js values or fallback to options
    const config = window.GUNTER_CONFIG || {};
    // Fase 1 (blindaje): API keys NUNCA viven en cliente. Esta variable
    // queda en null para producción y los métodos que requerían key directa
    // ahora siempre usan el proxy. Mantenemos la variable solo para
    // compatibilidad con código que la consulta (== null evita ramas).
    this.apiKey = null;
    this.model = options.model || config.CHAT_MODEL || 'gpt-4o-mini';

    // Forzado: SIEMPRE proxy. La opción de hablar con OpenAI directo se
    // eliminó porque expone la API key al decompilar el APK / inspeccionar JS.
    this.useProxy = true;
    this.baseUrl = config.PROXY_CHAT_URL;

    this.onProgress = options.onProgress || (() => { });
    this.onError = options.onError || console.error;
  }

  // Set API key
  setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('gunter_api_key', key);
  }

  // Check if API key is configured
  hasApiKey() {
    return !!this.apiKey;
  }

  // Build the analysis prompt with specialized strategy per project type
  buildPrompt(projectInfo, transcription) {
    const env = (projectInfo.environment || 'empresarial').toLowerCase();

    // Common base instructions
    const baseInstructions = `
      Eres GUNTER 🐧, un consultor estratégico de ÉLITE y experto en metodologías de gestión (PMBOK 8, Agile, Creative Direction).
      Tu misión es analizar la TRANSCRIPCIÓN de una reunión y generar un informe ESTRATÉGICO PROFESIONAL.
      
      REGLAS CRÍTICAS:
      1. Extrae datos reales de la conversación (fechas, montos, riesgos, nombres).
      2. No inventes si no hay datos, pero haz inferencias lógicas profesionales.
      3. El tono debe ser adecuado para un entorno: ${env.toUpperCase()}.
      4. Responde EXCLUSIVAMENTE con el JSON solicitado.
    `;

    // Specialized Prompts per Environment
    if (env === 'empresarial') {
      return `${baseInstructions}
      
      === METODOLOGÍA: PMBOK 8va Edición, PESTEL, VRIO & Eisenhower ===
      
      === CONTEXTO ===
      Proyecto: ${projectInfo.name} | Mercado: ${projectInfo.market}
      
      TRANSCRIPCIÓN:
      """${transcription}"""
      
      Genera un JSON con esta estructura exacta:
      {
        "viability": {
          "status": "green|yellow|red", 
          "label": "VIABLE|EN REVISIÓN|RIESGO CRÍTICO", 
          "pmbok_assessment": "Evaluación profesional profunda (PMBOK 8). Analiza alineación estratégica, justificación comercial y capacidad del equipo."
        },
        "diagnosis": {
          "budget": "Análisis financiero detallado o estimación",
          "goal": "Objetivo SMART (Específico, Medible, Alcanzable, Relevante, Temporal)",
          "urgency": "Análisis PESTEL (solo factores relevantes: Político, Económico, Social, Tecnológico, Ecológico, Legal)",
          "maturity": "Capacidad VRIO (Valioso, Raro, Inimitable, Organizado)"
        },
        "project_charter": {
          "business_case": "Análisis de rentabilidad y necesidad del negocio",
          "objectives": ["Objetivo Estratégico 1", "Objetivo Estratégico 2"],
          "success_criteria": ["KPI 1 (Métrica)", "KPI 2 (Métrica)"]
        },
        "risks": [
          {"title": "Identificación de Riesgo", "description": "Impacto potencial", "mitigation": "Estrategia de respuesta (PMBOK)", "severity": "high|medium|low"}
        ],
        "decisions": {
          "immediate": ["Acción crítica según Matriz de Eisenhower (Cuadrante 1)"],
          "later": ["Planificación estratégica (Cuadrante 2)"],
          "critical": ["Factor bloqueador de alta severidad"]
        },
        "priority_matrix": {
          "must_have": ["Funcionalidad de alto impacto/bajo esfuerzo (Quick Wins)"],
          "should_have": ["Importante para la propuesta de valor"],
          "could_have": ["Mejoras de experiencia (Nice to have)"],
          "wont_have": ["Fuera de los límites del alcance actual"]
        },
        "roadmap": [
          {"phase": "Fase Estratégica", "duration": "Tiempo estimado", "key_activities": ["Actividad 1"], "deliverables": ["Entregable 1 (Tangible)"]}
        ],
        "swot_analysis": {
          "scores": {"strengths": 0-100, "weaknesses": 0-100, "opportunities": 0-100, "threats": 0-100},
          "details": {"strengths": "Ventajas competitivas", "weaknesses": "Vulnerabilidades internas", "opportunities": "Tendencias externas a explotar", "threats": "Amenazas del mercado"}
        },
        "gunter_summary": {
            "overall_assessment": "Resumen ejecutivo para nivel C-Suite",
            "recommendation": "Decisión estratégica recomendada por Gunter",
            "next_steps": ["Próximos hitos críticos"]
        }
      }`;
    }

    else if (env === 'artistico') {
      return `${baseInstructions}
      
      === METODOLOGÍA: CREATIVE DIRECTION, SEMIOTICS & NARRATIVE BALANCE ===
      
      === CONTEXTO ===
      Proyecto: ${projectInfo.name} | Visión: ${projectInfo.market}
      
      TRANSCRIPCIÓN:
      """${transcription}"""
      
      Genera un JSON con esta estructura exacta:
      {
        "viability": {
          "status": "green|yellow|red", 
          "label": "SUBRELISTA|TRANSICIÓN|DISONANCIA", 
          "pmbok_assessment": "Evaluación de coherencia semiótica, viabilidad técnica de la visión y balance emocional."
        },
        "diagnosis": {
          "budget": "Capital artístico y recursos materiales",
          "goal": "Tesis o 'Statement' de la obra a través de análisis de intención",
          "urgency": "Análisis de tendencias artísticas actuales y relevancia temporal",
          "maturity": "Grado de cohesión formal del concepto"
        },
        "creative_board": {
          "concept": "La dualidad narrativa central",
          "visual_direction": "Referentes estéticos, texturas y lenguajes visuales",
          "audience_emotion": "Impacto psicológico y fenomenológico buscado"
        },
        "risks": [
          {"title": "Factor de Riesgo Artístico", "description": "Posible pérdida de significado o bloqueo técnico", "mitigation": "Estrategia de replanteamiento creativo"}
        ],
        "decisions": {
          "immediate": ["Acción crítica para la integridad de la obra"],
          "critical": ["Conflicto conceptual clave que requiere definición"]
        },
        "priority_matrix": {
          "must_have": ["Elemento fundacional del lenguaje visual"],
          "should_have": ["Detalle de refinamiento profesional"]
        },
        "roadmap": [
          {"phase": "Exploración Concepto", "duration": "Tiempo", "key_activities": ["Investigación Semiótica"], "deliverables": ["Manifiesto/Moodboard"]}
        ],
        "aesthetic_balance": {
          "experimental": 0-100, "technical": 0-100, "emotional": 0-100, "commercial": 0-100
        },
        "gunter_summary": {
            "overall_assessment": "Análisis crítico de la propuesta de valor estética",
            "recommendation": "Cómo trascender e innovar en el nicho",
            "next_steps": ["Hitos de materialización artística"]
        }
      }`;
    }

    else if (env === 'podcast') {
      return `${baseInstructions}
      
      === METODOLOGÍA: AUDIENCE ATTENTION ECONOMY & VIRAL NARRATIVES ===
      
      === CONTEXTO ===
      Podcast: ${projectInfo.name} | Tema: ${projectInfo.market}
      
      TRANSCRIPCIÓN:
      """${transcription}"""
      
      Genera un JSON con esta estructura exacta:
      {
        "viability": {
          "status": "green|yellow|red", 
          "label": "VIRALIZABLE|CONSISTENTE|NHO (No hay Oyentes)", 
          "pmbok_assessment": "Evaluación del potencial de retención, valor educativo/entretenimiento y capacidad de monetización."
        },
        "diagnosis": {
          "budget": "CPU (Coste por Usuario) y esfuerzo técnico",
          "goal": "Nicho específico y propuesta de valor única (UVP)",
          "urgency": "Análisis de estacionalidad y relevancia del tema",
          "maturity": "Calidad del ritmo narrativo y técnica vocal/sonora"
        },
        "episode_structure": {
          "hook": "Análisis del gancho (The Hook) - Segundos 0-30",
          "main_points": ["Bloque de Contenido 1", "Punto de Inflexión 2"],
          "cta": "Call to action estratégico (Conversión)"
        },
        "risks": [
          {"title": "Factor de Drop-off", "description": "Punto donde la audiencia se pierde", "mitigation": "Dinámica de re-enganche"}
        ],
        "decisions": {
          "immediate": ["Cambio de edición/ritmo"],
          "critical": ["Validación de la narrativa central"]
        },
        "priority_matrix": {
          "must_have": ["Calidad de audio/script"],
          "should_have": ["Segmentos dinámicos"]
        },
        "roadmap": [
          {"phase": "Pre-Producción", "duration": "Tiempo", "key_activities": ["Búsqueda de Datos Curiosos"], "deliverables": ["Guion Maestro"]}
        ],
        "audience_retention_forecast": [95, 90, 85, 88, 92, 75, 85],
        "gunter_summary": {
            "overall_assessment": "Evaluación del 'Spark' (chispa) y valor del contenido",
            "recommendation": "Táctica para maximizar la retención",
            "next_steps": ["Pasos de post-producción estratégica"]
        }
      }`;
    }

    // Default fallback
    return baseInstructions + transcription;
  }

  // Call OpenAI API
  async analyze(projectInfo, transcription) {
    if (!this.useProxy && !this.apiKey) {
      throw new Error('API key no configurada. Configura tu API key de OpenAI en js/config.js');
    }

    if (!transcription || transcription.trim().length < 50) {
      // If no real transcription, generate demo analysis
      return this.generateDemoAnalysis(projectInfo);
    }

    this.onProgress('Conectando con IA...');

    try {
      // Build headers - Proxy doesn't need Authorization header (added by server)
      const headers = {
        'Content-Type': 'application/json'
      };

      if (!this.useProxy) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'Eres un experto consultor estratégico. Siempre respondes en JSON válido y estructurado.'
            },
            {
              role: 'user',
              content: this.buildPrompt(projectInfo, transcription)
            }
          ],
          temperature: 0.7,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Error en la API');
      }

      this.onProgress('Analizando transcripción...');

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Respuesta vacía de la IA');
      }

      // Parse JSON response
      this.onProgress('Procesando análisis...');

      // Clean the response (remove markdown code blocks if present)
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.slice(7);
      }
      if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.slice(3);
      }
      if (jsonContent.endsWith('```')) {
        jsonContent = jsonContent.slice(0, -3);
      }

      const analysis = JSON.parse(jsonContent.trim());

      // Store in localStorage
      localStorage.setItem('gunter_analysis', JSON.stringify(analysis));
      localStorage.setItem('gunter_analysis_timestamp', new Date().toISOString());

      this.onProgress('¡Análisis completo!');

      return analysis;

    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  // Get real-time insight during meeting
  async getRealTimeInsight(transcript, environment, personality) {
    if (!this.useProxy && !this.apiKey) return null;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (!this.useProxy) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `Eres Gunter 🐧, un consultor con personalidad de pingüino. Estás escuchando una reunión en TIEMPO REAL.
              CONTEXTO: Proyecto tipo "${environment.toUpperCase()}"
              TONO: ${personality.tone}
              EXPERTISE: ${personality.expertise}
              STYLE: ${personality.style}
              
              COMPORTAMIENTO:
              - Solo comenta si hay algo valioso (ideas, riesgos, aclaraciones).
              - Si no hay nada interesante, responde exactamente: "[SILENCIO]"
              - Sé breve (máximo 40 palabras).
              - Usa emojis: ${personality.emojis}`
            },
            {
              role: 'user',
              content: `Conversación reciente:\n"${transcript}"\n\n¿Algún insight valioso? Si no, [SILENCIO].`
            }
          ],
          temperature: 0.8,
          max_tokens: 100
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (content && !content.includes('[SILENCIO]') && content.trim().length > 5) {
        return content.trim();
      }
      return null;
    } catch (e) {
      console.error('Insight error:', e);
      return null;
    }
  }

  // Generate demo analysis when no transcription
  generateDemoAnalysis(projectInfo) {
    const env = projectInfo.environment || 'empresarial';

    return {
      viability: {
        status: 'yellow',
        label: 'EN REVISIÓN',
        score: 65,
        justification: 'No se detectó transcripción suficiente para un análisis completo. Se requiere más información del proyecto para determinar viabilidad.'
      },
      diagnosis: {
        budget: projectInfo.budget || 'Por definir',
        budget_assessment: 'Pendiente de evaluación',
        retention_goal: 'Por definir en próxima sesión',
        urgency: 'Media',
        urgency_reason: 'Sin información suficiente para determinar urgencia',
        maturity: 'Etapa Inicial',
        team_size: 'Por confirmar'
      },
      project_board: {
        objective: projectInfo.name ? `Desarrollar ${projectInfo.name}` : 'Objetivo pendiente de definición',
        proposed_solution: 'Requiere sesión de discovery para definir solución técnica',
        key_deliverables: ['Documento de alcance', 'Wireframes iniciales', 'Estimación detallada'],
        estimated_cost: projectInfo.budget || 'Pendiente de cotización',
        success_metrics: ['Por definir con stakeholders']
      },
      risks: [
        {
          title: 'Falta de información',
          description: 'La transcripción no contiene suficientes detalles del proyecto',
          mitigation: 'Programar sesión de discovery completa',
          severity: 'medium',
          probability: 'high'
        }
      ],
      decisions: {
        immediate: [
          { decision: 'Programar reunión de discovery', owner: 'Product Owner', deadline: 'Esta semana' }
        ],
        later: [],
        critical: [
          { decision: 'Definir alcance completo', impact: 'Sin esto no se puede estimar ni planificar' }
        ]
      },
      priority_matrix: {
        high_impact_low_effort: ['Reunión de discovery'],
        high_impact_high_effort: ['Definición de arquitectura'],
        low_impact_low_effort: ['Setup de herramientas'],
        low_impact_high_effort: []
      },
      roadmap: [
        {
          phase: 'Discovery',
          duration: 'Semana 1',
          key_activities: ['Reuniones con stakeholders', 'Análisis de requerimientos'],
          deliverables: ['Documento de alcance'],
          risks: 'Disponibilidad de stakeholders'
        }
      ],
      gunter_summary: {
        overall_assessment: 'Se requiere una sesión de grabación más extensa para generar un análisis completo. La información actual es insuficiente.',
        strengths: ['Iniciativa de usar IA para análisis'],
        weaknesses: ['Poca información capturada'],
        opportunities: ['Realizar sesión de discovery completa'],
        threats: ['Decisiones sin suficiente contexto'],
        recommendation: 'Recomiendo grabar una reunión de al menos 1-2 minutos discutiendo los objetivos principales y el contexto del proyecto.',
        follow_up_questions: ['¿Cuál es el objetivo principal del proyecto?', '¿Cuál es el presupuesto disponible?', '¿Cuál es la fecha límite?'],
        next_meeting_agenda: ['Definir objetivos', 'Discutir presupuesto', 'Identificar stakeholders']
      }
    };
  }
}

// Export
window.GunterAnalysisService = GunterAnalysisService;
