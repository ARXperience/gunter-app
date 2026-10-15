/* =============================================
   GUNTER - Premium Features Service
   -------------------------------------------------
   Registry central de funciones premium:
   - flags booleanos + enums
   - defaults, descripciones, estados
   - persistencia en localStorage
   - subscribe + event global para reactividad
   - import/export JSON
   - lectura desde cualquier página con
     PremiumFeaturesService.isEnabled(key)
   ============================================= */

(function () {
    const STORAGE_KEY = 'gunter_premium_features';
    const LEGACY_PREFS_KEY = 'gunter_prefs';   // no se borra; se coexiste

    // Shared UI/tool metadata: one catalog on every authenticated page.
    const FEATURE_MAP = [
        {
            id: 'productivityPanel',
            icon: '📊',
            title: 'Panel de productividad avanzada',
            description: 'Mide tu rendimiento con datos de tareas, tiempo trabajado, objetivos cumplidos y ROI del tiempo.',
            subs: [
                { key: 'productivityTimeByTask',           label: 'Tiempo por tipo de tarea' },
                { key: 'productivityWeeklyEfficiency',     label: 'Eficiencia semanal' },
                { key: 'productivityGoalCompletion',       label: 'Cumplimiento de objetivos' },
                { key: 'productivityRealProductiveHours',  label: 'Horas productivas reales' },
                { key: 'productivityTimeROI',              label: 'ROI del tiempo' }
            ]
        },
        {
            id: 'meetingMemory',
            icon: '🧠',
            title: 'Memoria total de reuniones',
            description: 'Busca en reuniones pasadas, recuerda decisiones y conecta conversaciones entre proyectos.',
            subs: [
                { key: 'meetingSemanticSearch',    label: 'Búsqueda semántica en transcripciones',
                  subStatus: 'included_in_parent',
                  hint: 'Ya activa con embeddings reales cuando el módulo está ON.' },
                { key: 'meetingDecisionTimeline',  label: 'Timeline de decisiones',
                  subStatus: 'included_in_parent',
                  hint: 'El centro de decisiones tiene su propio timeline configurable.' },
                { key: 'meetingCrossProjectLinks', label: 'Conectar reuniones entre proyectos',
                  subStatus: 'coming_soon',
                  hint: 'Cross-project link automático llegará en una próxima versión.' }
            ]
        },
        {
            id: 'smartDocuments',
            icon: '📄',
            title: 'Gestión inteligente de documentos',
            description: 'Analiza recibos, contratos, facturas e imágenes para detectar vencimientos, valores y pagos.',
            subs: [
                { key: 'smartReceiptReading',        label: 'Leer recibos automáticamente',
                  subStatus: 'included_in_parent',
                  hint: 'Activa por defecto cuando el módulo está ON (Gemini Vision).' },
                { key: 'smartDueDateDetection',      label: 'Detectar vencimientos',
                  subStatus: 'included_in_parent',
                  hint: 'Extracción incluida en el análisis de cada documento.' },
                { key: 'smartExpenseClassification', label: 'Clasificar gastos',
                  subStatus: 'coming_soon',
                  hint: 'Categorías personalizables llegarán en una próxima versión.' },
                { key: 'smartPaymentAlerts',         label: 'Alertar pagos pendientes',
                  subStatus: 'included_in_parent',
                  hint: 'Las alertas se generan automáticamente para recibos con vencimiento.' },
                { key: 'smartFinancialHistory',      label: 'Historial financiero básico',
                  subStatus: 'coming_soon',
                  hint: 'Reportes de gasto agregados llegarán en una próxima versión.' }
            ]
        },
        {
            id: 'googleCalendarSync',
            icon: '🗓️',
            title: 'Google Calendar',
            description: 'Crea, edita y recibe recordatorios automáticos en tu Google Calendar desde lenguaje natural.',
            action: 'google-connect',
            subs: [
                { key: 'googleCalendarNaturalLanguage', label: 'Crear eventos desde lenguaje natural' },
                { key: 'googleCalendarAutoReminders',   label: 'Recordatorios automáticos (1 día antes + 30 min antes)' }
            ]
        },
        {
            id: 'whatsappAssistant',
            icon: '💬',
            title: 'WhatsApp Assistant',
            description: 'Conversa con Gunter desde WhatsApp: crea tareas, agenda citas, recibe resúmenes y recordatorios.',
            action: 'whatsapp-qr',
            subs: [
                { key: 'whatsappCommands',           label: 'Recibir comandos desde WhatsApp',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto cuando WhatsApp está conectado.' },
                { key: 'whatsappNotifications',      label: 'Recibir notificaciones',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto.' },
                { key: 'whatsappMeetingScheduling',  label: 'Agendar reuniones desde WhatsApp',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto. Si tienes Google Calendar conectado, va al calendario también.' }
            ]
        },
        {
            id: 'documentSync',
            icon: '📚',
            title: 'Notion / Google Drive',
            description: 'Conecta documentos, notas y archivos como memoria de trabajo de Gunter.',
            subs: [
                { key: 'notionSync',       label: 'Sincronizar Notion',
                  subStatus: 'coming_soon',
                  hint: 'Integración con Notion API llegará en una próxima versión.' },
                { key: 'googleDriveSync',  label: 'Sincronizar Google Drive',
                  subStatus: 'coming_soon',
                  hint: 'Integración con Drive API llegará en una próxima versión.' }
            ]
        },
        {
            id: 'adaptivePersonality',
            icon: '🎭',
            title: 'Personalidad adaptativa de Gunter',
            description: 'Gunter ajusta tono, estilo y comportamiento según el contexto.',
            custom: 'personality'
        },
        {
            id: 'voiceEnabled',
            icon: '🗣️',
            title: 'Respuestas por voz',
            description: 'Elige si Gunter responde con voz al escribirle o hablarle. El texto permanece en el chat.',
            custom: 'voice'
        },
        { id: 'dictationEnabled', icon: '🎤', title: 'Reconocimiento y dictado',
          description: 'Transcribe al pulsar Hablar y muestra el texto para revisarlo. El micrófono requiere permiso.', section: 'core' },
        {
            id: 'wakeWordEnabled',
            icon: '🎙️',
            title: 'Activación por voz "Hi Gunter"',
            description: 'Gunter te escucha cuando lo llamas y activa una conversación natural.',
            custom: 'wake-word'
        },

        // ================ Premium Intelligence (Sprint A) ================
        {
            id: 'dailyPlanner',
            icon: '🌅',
            title: 'Planificador del día',
            description: 'Organiza tus tareas, reuniones, pagos y proyectos en un plan diario priorizado con IA.',
            section: 'intelligence',
            subs: [
                { key: 'dailyPlannerMorningBrief',     label: 'Brief matutino',
                  subStatus: 'included_in_parent',
                  hint: 'El plan del día siempre incluye un resumen ejecutivo en la parte superior.' },
                { key: 'dailyPlannerTimeBlocks',       label: 'Sugerir bloques de tiempo',
                  subStatus: 'included_in_parent',
                  hint: 'El plan ya propone bloques 9-12, 14-17 y 17-19 con cada prioridad.' },
                { key: 'dailyPlannerWhatsappSummary',  label: 'Enviar el plan por WhatsApp',
                  subStatus: 'included_in_parent',
                  hint: 'El botón "📋 Copiar para WhatsApp" del panel ya genera el brief listo.' }
            ]
        },
        {
            id: 'weeklyPlanner',
            icon: '📅',
            title: 'Organiza mi semana',
            description: 'Distribuye tareas, reuniones y prioridades en la semana, equilibrando carga y proyectos.',
            section: 'intelligence',
            subs: [
                { key: 'weeklyPlannerAutoDistribution', label: 'Distribuir tareas automáticamente',
                  subStatus: 'included_in_parent',
                  hint: 'El plan ya asigna foco por día según prioridad y vencimientos.' },
                { key: 'weeklyPlannerCalendarBlocks',   label: 'Crear bloques en Calendar',
                  subStatus: 'coming_soon',
                  hint: 'Creación masiva de eventos en Google Calendar (con confirmación obligatoria) llegará en una próxima versión.' },
                { key: 'weeklyPlannerProjectBalance',   label: 'Balancear carga entre proyectos',
                  subStatus: 'included_in_parent',
                  hint: 'El plan ya muestra carga por proyecto con barras visuales.' }
            ]
        },
        {
            id: 'projectAutoFollowUp',
            icon: '🎯',
            title: 'Seguimiento automático de proyectos',
            description: 'Detecta proyectos sin actividad, tareas vencidas, reuniones sin próximos pasos y riesgos de retraso.',
            section: 'intelligence',
            subs: [
                { key: 'projectAutoFollowUpInactiveProjects', label: 'Avisar proyectos inactivos',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto. Detecta proyectos >7 días sin actividad.' },
                { key: 'projectAutoFollowUpOverdueTasks',     label: 'Avisar tareas vencidas por proyecto',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto.' },
                { key: 'projectAutoFollowUpNoNextStep',       label: 'Avisar reuniones sin próximos pasos',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto.' }
            ]
        },
        {
            id: 'projectExecutiveSummary',
            icon: '📊',
            title: 'Resumen ejecutivo por proyecto',
            description: 'Genera un estado claro del proyecto con avances, pendientes, riesgos, decisiones y próximos pasos.',
            section: 'intelligence',
            subs: [
                { key: 'projectExecutiveSummaryRisks',     label: 'Incluir riesgos detectados',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto.' },
                { key: 'projectExecutiveSummaryNextSteps', label: 'Incluir próximos pasos sugeridos',
                  subStatus: 'included_in_parent',
                  hint: 'Activo por defecto.' },
                { key: 'projectExecutiveSummaryExport',    label: 'Exportar resumen como PDF',
                  subStatus: 'coming_soon',
                  hint: 'Export PDF dedicado del resumen ejecutivo llegará en una próxima versión. (Las presentaciones sí se exportan a PDF/PPTX desde results.html.)' }
            ]
        },
        {
            id: 'meetingSmartFollowUp',
            icon: '✅',
            title: 'Follow-up inteligente después de reuniones',
            description: 'Detecta compromisos, tareas, responsables y decisiones al terminar una reunión.',
            section: 'intelligence',
            subs: [
                { key: 'meetingSmartFollowUpTasks',     label: 'Sugerir tareas detectadas' },
                { key: 'meetingSmartFollowUpDecisions', label: 'Guardar decisiones detectadas' },
                { key: 'meetingSmartFollowUpWhatsapp',  label: 'Enviar resumen por WhatsApp',
                  hint: 'Requiere WhatsApp Assistant conectado.' }
            ]
        },
        {
            id: 'urgencyRanking',
            icon: '🔥',
            title: 'Ranking de urgencia',
            description: 'Ordena tareas y proyectos según vencimiento, impacto, dinero, riesgo y prioridad.',
            section: 'intelligence',
            subs: [
                { key: 'urgencyRankingByDueDate',       label: 'Ponderar por fecha de vencimiento',
                  subStatus: 'included_in_parent',
                  hint: 'Peso 30 puntos para vencidas, 18 para vence hoy. Siempre activo.' },
                { key: 'urgencyRankingByProjectImpact', label: 'Ponderar por impacto del proyecto',
                  subStatus: 'included_in_parent',
                  hint: 'Peso 6 puntos por proyecto activo. Siempre activo.' },
                { key: 'urgencyRankingByMoney',         label: 'Ponderar por dinero involucrado',
                  subStatus: 'included_in_parent',
                  hint: 'Peso 15 puntos por monto. Siempre activo en pagos pendientes.' }
            ]
        },
        {
            id: 'project360',
            icon: '🛰️',
            title: 'Cliente / Proyecto 360',
            description: 'Vista completa de cada proyecto: tareas, reuniones, documentos, decisiones, pagos, riesgos y próximos pasos.',
            section: 'intelligence',
            subs: [
                { key: 'project360Tasks',     label: 'Mostrar tareas' },
                { key: 'project360Meetings',  label: 'Mostrar reuniones' },
                { key: 'project360Documents', label: 'Mostrar documentos' },
                { key: 'project360Decisions', label: 'Mostrar decisiones' },
                { key: 'project360Calendar',  label: 'Mostrar próximos eventos' }
            ]
        },
        {
            id: 'decisionCenter',
            icon: '🧭',
            title: 'Centro de decisiones',
            description: 'Guarda, organiza y permite consultar decisiones importantes tomadas en reuniones o conversaciones.',
            section: 'intelligence',
            subs: [
                { key: 'decisionCenterAutoDetect', label: 'Detectar decisiones automáticamente' },
                { key: 'decisionCenterTimeline',   label: 'Mostrar timeline de decisiones' },
                { key: 'decisionCenterSearch',     label: 'Buscar decisiones por palabra clave' }
            ]
        },
        {
            id: 'smartWhatsappAlerts',
            icon: '🔔',
            title: 'Alertas inteligentes por WhatsApp',
            description: 'Envía alertas con contexto sobre pagos, reuniones, tareas vencidas, proyectos quietos y riesgos.',
            section: 'intelligence',
            subs: [
                { key: 'smartWhatsappAlertsMorning',     label: 'Resumen matutino' },
                { key: 'smartWhatsappAlertsDuePayments', label: 'Pagos próximos a vencer' },
                { key: 'smartWhatsappAlertsProjectRisk', label: 'Proyectos en riesgo' }
            ]
        },
        {
            id: 'delegationMode',
            icon: '🤝',
            title: 'Modo delegación',
            description: 'Convierte tareas en mensajes claros para delegar por WhatsApp o copiar y enviar.',
            section: 'intelligence',
            subs: [
                { key: 'delegationModeMessageDrafts',  label: 'Generar borradores de mensaje' },
                { key: 'delegationModeWhatsappDrafts', label: 'Sugerir envío por WhatsApp' },
                { key: 'delegationModeFollowUp',       label: 'Crear recordatorio de seguimiento' }
            ]
        },

        // ================ v2 — Funciones avanzadas ================
        { id: 'conversationMemory', icon: '🧬', title: 'Memoria conversacional',
          description: 'Gunter recuerda lo que hablan en sesiones anteriores y lo trae cuando es relevante.',
          section: 'advanced' },
        { id: 'conversationContinuity', icon: '💬', title: 'Continuidad de conversación',
          description: 'Usa el diálogo reciente para seguir el hilo y entender referencias como «eso».', section: 'core' },
        { id: 'personalMemoryContext', icon: '🧠', title: 'Recuerdos autorizados',
          description: 'Consulta recuerdos que guardaste explícitamente, solo en modo local. No guarda conversaciones por sí solo.', section: 'core' },
        { id: 'contextualRecommendations', icon: '🧭', title: 'Recomendaciones de herramientas',
          description: 'Sugiere acciones disponibles cuando vienen al caso; ejecutarlas requiere tu autorización.', section: 'core' },
        { id: 'contextualHumor', icon: '💬', title: 'Humor contextual',
          description: 'Ingenio breve cuando aporta, con seriedad ante errores y situaciones delicadas.', section: 'core' },
        { id: 'entryVoiceGreeting', icon: '🔊', title: 'Bienvenida por voz',
          description: 'Habla al ingresar con tu voz configurada, si el entorno permite audio. El saludo escrito tiene su propio control.', section: 'core' },
        { id: 'commitmentTracker', icon: '📋', title: 'Rastreador de compromisos',
          description: 'Detecta promesas en reuniones, WhatsApp y mensajes. Avisa cuando te deben algo o se te olvida algo prometido.',
          section: 'advanced' },
        { id: 'proactivePulse', icon: '🫀', title: 'Pulso proactivo',
          description: 'Gunter actúa por iniciativa propia: detecta riesgos, oportunidades y propone acciones sin esperar tu pregunta. Confirmación obligatoria.',
          section: 'advanced' },
        { id: 'meetingClimate', icon: '🌡️', title: 'Clima de reunión',
          description: 'Analiza tensión, consenso, monólogos e indecisión durante reuniones. El avatar reacciona en vivo.',
          section: 'advanced' },
        { id: 'mirrorStyle', icon: '🪞', title: 'Modo espejo',
          description: 'Aprende tu estilo de escritura por contacto. Las redacciones de delegación suenan a ti.',
          section: 'advanced' },
        { id: 'projectForecast', icon: '🔮', title: 'Forecast de proyectos',
          description: 'Predice cuándo cierra realmente cada proyecto basado en velocidad histórica. Alerta de puntos de no-retorno.',
          section: 'advanced' },
        { id: 'tutorMode', icon: '📚', title: 'Modo tutor / sabio',
          description: 'Gunter enseña sobre la biblioteca curada (33 obras de Grinberg): explica conceptos citando obra y página, sesiones guiadas capítulo por capítulo, repaso espaciado y trivia. Al desactivarlo, el tab Tutor desaparece y las conversaciones vuelven al modo asistente normal.',
          section: 'advanced' }
    ];

    // Estilos de voz descriptivos
    const FEATURE_CATEGORIES = {
        voiceEnabled: 'voice', dictationEnabled: 'voice', wakeWordEnabled: 'voice', entryVoiceGreeting: 'voice',
        conversationMemory: 'conversations', conversationContinuity: 'conversations',
        personalMemoryContext: 'conversations', contextualRecommendations: 'premium', contextualHumor: 'premium',
        meetingMemory: 'conversations', googleCalendarSync: 'connections', whatsappAssistant: 'connections',
        documentSync: 'connections', productivityPanel: 'actions', smartDocuments: 'actions',
        dailyPlanner: 'actions', weeklyPlanner: 'actions', projectAutoFollowUp: 'actions',
        meetingSmartFollowUp: 'actions', urgencyRanking: 'actions', smartWhatsappAlerts: 'actions',
        delegationMode: 'actions', commitmentTracker: 'actions', proactivePulse: 'premium'
    };

    // ---------- Defaults ----------
    const DEFAULTS = Object.freeze({
        // 1. Productivity
        productivityPanel: false,
        productivityTimeByTask: false,
        productivityWeeklyEfficiency: false,
        productivityGoalCompletion: false,
        productivityRealProductiveHours: false,
        productivityTimeROI: false,

        // 2. Meeting memory
        meetingMemory: false,
        meetingSemanticSearch: false,
        meetingDecisionTimeline: false,
        meetingCrossProjectLinks: false,

        // 3. Smart documents
        smartDocuments: false,
        smartReceiptReading: false,
        smartDueDateDetection: false,
        smartExpenseClassification: false,
        smartPaymentAlerts: false,
        smartFinancialHistory: false,

        // 4.1 Google Calendar
        googleCalendarSync: false,
        googleCalendarNaturalLanguage: false,
        googleCalendarAutoReminders: false,

        // 4.2 WhatsApp
        whatsappAssistant: false,
        whatsappCommands: false,
        whatsappNotifications: false,
        whatsappMeetingScheduling: false,

        // 4.3 Notion / Drive
        documentSync: false,
        notionSync: false,
        googleDriveSync: false,

        // 5. Personality
        adaptivePersonality: false,
        personalityMode: 'professional',       // 'professional'|'direct'|'coach'|'fun'|'strategic'
        personalityIntensity: 'normal',        // 'soft'|'normal'|'intense'
        focusCoachEnabled: false,
        distractionBlocker: false,
        smartTimer: false,

        // 6. Voice
        voiceEnabled: true,
        voiceMode: 'live_voice',                // 'text_only'|'notifications_only'|'live_voice'|'wake_word_only'
        dictationEnabled: true,
        voiceStyle: 'professional',            // 'professional'|'warm'|'chaotic_scientist'|'energetic_cartoon'|'minimal_penguin'|'executive'|'focus_coach'
        voiceSpeed: 'normal',                  // 'slow'|'normal'|'fast'
        voiceTone: 'neutral',                  // 'calm'|'neutral'|'expressive'|'intense'
        voiceInMeetings: false,
        voiceOnlyAfterWakeWord: false,

        // 7. Wake word
        wakeWordEnabled: true,
        wakeWord: 'Hi Gunter',
        wakeWordListeningMode: 'continuous',   // 'manual'|'continuous'
        wakeWordResponseMode: 'voice',         // 'voice'|'text'
        wakeWordAutoStopSeconds: 20,

        // 8. Premium Intelligence (Sprint A — Fase 11.B)
        // Cada padre booleano gobierna su feature; los subflags afinan comportamiento.
        dailyPlanner: false,
        dailyPlannerMorningBrief: false,
        dailyPlannerTimeBlocks: false,
        dailyPlannerWhatsappSummary: false,

        weeklyPlanner: false,
        weeklyPlannerAutoDistribution: false,
        weeklyPlannerCalendarBlocks: false,
        weeklyPlannerProjectBalance: false,

        projectAutoFollowUp: false,
        projectAutoFollowUpInactiveProjects: false,
        projectAutoFollowUpOverdueTasks: false,
        projectAutoFollowUpNoNextStep: false,

        projectExecutiveSummary: false,
        projectExecutiveSummaryRisks: false,
        projectExecutiveSummaryNextSteps: false,
        projectExecutiveSummaryExport: false,

        meetingSmartFollowUp: false,
        meetingSmartFollowUpTasks: false,
        meetingSmartFollowUpDecisions: false,
        meetingSmartFollowUpWhatsapp: false,

        urgencyRanking: false,
        urgencyRankingByDueDate: false,
        urgencyRankingByProjectImpact: false,
        urgencyRankingByMoney: false,

        project360: false,
        project360Tasks: false,
        project360Meetings: false,
        project360Documents: false,
        project360Decisions: false,
        project360Calendar: false,

        decisionCenter: false,
        decisionCenterAutoDetect: false,
        decisionCenterTimeline: false,
        decisionCenterSearch: false,

        smartWhatsappAlerts: false,
        smartWhatsappAlertsMorning: false,
        smartWhatsappAlertsDuePayments: false,
        smartWhatsappAlertsProjectRisk: false,

        delegationMode: false,
        delegationModeMessageDrafts: false,
        delegationModeWhatsappDrafts: false,
        delegationModeFollowUp: false,

        // 9. v2 — Funciones avanzadas (LTM, Compromisos, Proactivo, Clima, Espejo, Forecast)
        conversationMemory: false,            // conservación automática: requiere activación explícita
        conversationContinuity: true,
        personalMemoryContext: true,          // solo recuerdos explícitos/autorizados
        contextualRecommendations: true,
        diagnosticsEnabled: true,
        contextualHumor: true,
        humorIntensity: 'soft',
        entryVoiceGreeting: true,
        commitmentTracker: false,
        proactivePulse: false,
        proactivePulseAggression: 'normal',   // 'soft' | 'normal' | 'high'
        meetingClimate: false,
        mirrorStyle: false,
        projectForecast: false,
        tutorMode: false,
        tutorLibrary: 'grinberg-obra-completa'
    });

    const ENUMS = Object.freeze({
        personalityMode:        ['professional', 'direct', 'coach', 'fun', 'strategic'],
        personalityIntensity:   ['soft', 'normal', 'intense'],
        proactivePulseAggression: ['soft', 'normal', 'high'],
        voiceMode:              ['text_only', 'notifications_only', 'live_voice', 'wake_word_only'],
        voiceStyle:             ['professional', 'warm', 'chaotic_scientist', 'energetic_cartoon', 'minimal_penguin', 'executive', 'focus_coach'],
        voiceSpeed:             ['slow', 'normal', 'fast'],
        voiceTone:              ['calm', 'neutral', 'expressive', 'intense'],
        wakeWordListeningMode:  ['manual', 'continuous'],
        wakeWordResponseMode:   ['voice', 'text'],
        humorIntensity:        ['soft', 'normal']
    });

    // ---------- Descriptions + parent/child map ----------
    const DESCRIPTIONS = Object.freeze({
        productivityPanel: 'Mide tu rendimiento diario y semanal con datos de tareas, tiempo y objetivos.',
        meetingMemory: 'Busca dentro de reuniones pasadas, recuerda decisiones y conecta conversaciones.',
        smartDocuments: 'Analiza recibos, contratos, facturas e imágenes para extraer vencimientos y gastos.',
        googleCalendarSync: 'Crea, edita y recibe recordatorios en tu Google Calendar desde lenguaje natural.',
        whatsappAssistant: 'Conversa con Gunter desde WhatsApp: crea tareas, agenda citas, recibe resúmenes.',
        documentSync: 'Lee tus documentos de Notion y Google Drive como memoria de trabajo.',
        adaptivePersonality: 'Gunter ajusta tono, estilo y comportamiento según el contexto.',
        voiceEnabled: 'Gunter habla con voz natural y expresiva configurable.',
        dictationEnabled: 'Transcribe el micrófono cuando pulsas Hablar; no lo abre sin permiso.',
        wakeWordEnabled: 'Gunter reconoce cuando dices su nombre y activa una conversación natural.',
        conversationContinuity: 'Mantiene el hilo de la conversación actual para entender referencias.',
        personalMemoryContext: 'Consulta recuerdos personales guardados explícitamente en modo local.',
        contextualRecommendations: 'Sugiere herramientas disponibles cuando son pertinentes; no ejecuta sin autorización.',
        diagnosticsEnabled: 'Explica fallos y estado real del asistente cuando lo consultas.',
        contextualHumor: 'Ingenio ocasional adaptado al tema; seriedad en situaciones delicadas y errores.',
        entryVoiceGreeting: 'Reproduce la bienvenida con la voz configurada cuando el entorno permite audio.',

        // Premium Intelligence (Sprint A)
        dailyPlanner:            'Organiza tus tareas, reuniones, pagos y proyectos en un plan diario priorizado.',
        weeklyPlanner:           'Distribuye tareas, reuniones y prioridades en la semana, equilibrando carga y proyectos.',
        projectAutoFollowUp:     'Detecta proyectos sin actividad, tareas vencidas, reuniones sin próximos pasos y riesgos de retraso.',
        projectExecutiveSummary: 'Genera un estado claro del proyecto con avances, pendientes, riesgos, decisiones y próximos pasos.',
        meetingSmartFollowUp:    'Detecta compromisos, tareas, responsables y decisiones al terminar una reunión.',
        urgencyRanking:          'Ordena tareas y proyectos según vencimiento, impacto, dinero, riesgo y prioridad.',
        project360:              'Vista completa de cada proyecto: tareas, reuniones, documentos, decisiones, pagos, riesgos y próximos pasos.',
        decisionCenter:          'Guarda, organiza y permite consultar decisiones importantes tomadas en reuniones o conversaciones.',
        smartWhatsappAlerts:     'Envía alertas con contexto sobre pagos, reuniones, tareas vencidas, proyectos quietos y riesgos.',
        delegationMode:          'Convierte tareas en mensajes claros para delegar por WhatsApp o copiar y enviar.',

        // v2
        conversationMemory:      'Gunter recuerda lo que hablan en sesiones anteriores y lo trae cuando es relevante.',
        commitmentTracker:       'Detecta promesas hechas en reuniones, WhatsApp y mensajes, y avisa cuando vencen sin cumplirse.',
        proactivePulse:          'Gunter actúa por iniciativa propia: detecta riesgos y propone acciones, sin esperar tu pregunta.',
        meetingClimate:          'Analiza el clima emocional de cada reunión en vivo: tensión, consenso, monólogos y momentos clave.',
        mirrorStyle:             'Aprende cómo escribes tú a cada contacto y redacta mensajes que suenan a ti, no a una IA.',
        projectForecast:         'Predice cuándo cierra realmente cada proyecto y alerta sobre puntos de no-retorno.'
    });

    // Relación padre→hijos para propagar desactivación
    const CHILDREN = Object.freeze({
        productivityPanel: ['productivityTimeByTask', 'productivityWeeklyEfficiency', 'productivityGoalCompletion', 'productivityRealProductiveHours', 'productivityTimeROI'],
        meetingMemory: ['meetingSemanticSearch', 'meetingDecisionTimeline', 'meetingCrossProjectLinks'],
        smartDocuments: ['smartReceiptReading', 'smartDueDateDetection', 'smartExpenseClassification', 'smartPaymentAlerts', 'smartFinancialHistory'],
        googleCalendarSync: ['googleCalendarNaturalLanguage', 'googleCalendarAutoReminders'],
        whatsappAssistant: ['whatsappCommands', 'whatsappNotifications', 'whatsappMeetingScheduling'],
        documentSync: ['notionSync', 'googleDriveSync'],
        adaptivePersonality: ['focusCoachEnabled', 'distractionBlocker', 'smartTimer'],
        voiceEnabled: ['voiceInMeetings'],
        wakeWordEnabled: [],

        // Premium Intelligence
        dailyPlanner:            ['dailyPlannerMorningBrief', 'dailyPlannerTimeBlocks', 'dailyPlannerWhatsappSummary'],
        weeklyPlanner:           ['weeklyPlannerAutoDistribution', 'weeklyPlannerCalendarBlocks', 'weeklyPlannerProjectBalance'],
        projectAutoFollowUp:     ['projectAutoFollowUpInactiveProjects', 'projectAutoFollowUpOverdueTasks', 'projectAutoFollowUpNoNextStep'],
        projectExecutiveSummary: ['projectExecutiveSummaryRisks', 'projectExecutiveSummaryNextSteps', 'projectExecutiveSummaryExport'],
        meetingSmartFollowUp:    ['meetingSmartFollowUpTasks', 'meetingSmartFollowUpDecisions', 'meetingSmartFollowUpWhatsapp'],
        urgencyRanking:          ['urgencyRankingByDueDate', 'urgencyRankingByProjectImpact', 'urgencyRankingByMoney'],
        project360:              ['project360Tasks', 'project360Meetings', 'project360Documents', 'project360Decisions', 'project360Calendar'],
        decisionCenter:          ['decisionCenterAutoDetect', 'decisionCenterTimeline', 'decisionCenterSearch'],
        smartWhatsappAlerts:     ['smartWhatsappAlertsMorning', 'smartWhatsappAlertsDuePayments', 'smartWhatsappAlertsProjectRisk'],
        delegationMode:          ['delegationModeMessageDrafts', 'delegationModeWhatsappDrafts', 'delegationModeFollowUp'],
        // v2 — sin subflags por ahora
        conversationMemory: [],
        conversationContinuity: [],
        personalMemoryContext: [],
        contextualRecommendations: [],
        diagnosticsEnabled: [],
        contextualHumor: [],
        entryVoiceGreeting: [],
        dictationEnabled: [],
        commitmentTracker: [],
        proactivePulse: [],
        meetingClimate: [],
        mirrorStyle: [],
        projectForecast: []
    });

    // ---------- State ----------
    let state = load();
    const subscribers = new Set();
    let microphonePermission = 'prompt';
    try {
        navigator.permissions?.query?.({ name: 'microphone' }).then(permission => {
            microphonePermission = permission.state;
            const changed = () => {
                microphonePermission = permission.state;
                window.dispatchEvent(new CustomEvent('gunter-microphone-permission-state', { detail: { state: microphonePermission } }));
            };
            permission.addEventListener?.('change', changed);
            changed();
        }).catch(() => {});
    } catch { /* permission query is not implemented in every browser */ }

    function load(fallback = DEFAULTS) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULTS };
            const parsed = JSON.parse(raw);
            // Merge with DEFAULTS so new flags added later are respected
            const saved = sanitize(parsed);
            // A saved text-only mode is an explicit voice choice, even when a
            // legacy partial export omitted the old voiceEnabled flag.
            if (saved.voiceMode === 'text_only' && !Object.hasOwn(saved, 'voiceEnabled')) saved.voiceEnabled = false;
            return { ...DEFAULTS, ...saved };
        } catch {
            return { ...fallback };
        }
    }

    function sanitize(obj) {
        const out = {};
        for (const [k, def] of Object.entries(DEFAULTS)) {
            if (k in obj) {
                const v = obj[k];
                if (typeof def === 'boolean') out[k] = !!v;
                else if (ENUMS[k]) out[k] = ENUMS[k].includes(v) ? v : def;
                else if (typeof def === 'number') out[k] = Number.isFinite(+v) ? +v : def;
                else if (typeof def === 'string') out[k] = String(v || def);
                else out[k] = v;
            }
        }
        return out;
    }

    function persist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    }

    // ---------- Public API ----------
    function getAll() { return { ...state }; }

    function get(key) { return state[key]; }

    function isEnabled(key) {
        const v = state[key];
        return v === true;
    }

    function set(key, value) {
        if (!(key in DEFAULTS)) {
            console.warn('[premium] Unknown flag:', key);
            return false;
        }
        return applyUpdates({ [key]: value }, key);
    }

    function updateMany(partial) {
        return applyUpdates(partial);
    }

    function applyUpdates(partial, eventKey = null) {
        // A different open tab may have saved a newer voice policy before its
        // storage event reaches this tab. Merge the patch into that snapshot.
        const latest = load(state);
        const synchronized = Object.keys(latest).some(key => latest[key] !== state[key]);
        const patch = {};
        for (const [k, v] of Object.entries(partial || {})) {
            if (!(k in DEFAULTS)) continue;
            const def = DEFAULTS[k];
            if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
            if (typeof def === 'number' && !Number.isFinite(+v)) continue;
            patch[k] = typeof def === 'boolean' ? !!v : typeof def === 'number' ? +v : v;
        }
        const next = { ...latest, ...patch };
        const has = key => Object.hasOwn(patch, key);

        // Reconcile explicit choices in one transaction. Loading and importing
        // old preferences intentionally do not take this user-action path.
        if (has('voiceMode')) {
            const mode = patch.voiceMode;
            next.voiceEnabled = mode !== 'text_only' && !(has('voiceEnabled') && patch.voiceEnabled === false);
            next.voiceOnlyAfterWakeWord = mode === 'wake_word_only';
            if ((mode === 'live_voice' || mode === 'wake_word_only') && !has('wakeWordResponseMode')) {
                next.wakeWordResponseMode = 'voice';
            }
        } else if (has('voiceOnlyAfterWakeWord')) {
            if (latest.voiceMode === 'text_only' && !has('voiceEnabled')) next.voiceEnabled = false;
            if (patch.voiceOnlyAfterWakeWord) next.voiceMode = 'wake_word_only';
            else if (next.voiceMode === 'wake_word_only') next.voiceMode = 'live_voice';
        }

        // Enabling the master switch revives the saved conversational scope.
        if (has('voiceEnabled') && patch.voiceEnabled && !has('voiceMode') && next.voiceMode === 'text_only') {
            next.voiceMode = next.voiceOnlyAfterWakeWord ? 'wake_word_only' : 'live_voice';
        }

        for (const [key, children] of Object.entries(CHILDREN)) {
            if (next[key] === false && (has(key) || (key === 'voiceEnabled' && has('voiceMode')))) {
                children.forEach(child => { next[child] = false; });
            }
        }

        const changed = Object.keys(next).some(key => next[key] !== latest[key]);
        if (!changed && !synchronized) return false;
        state = next;
        if (changed) persist();
        const changedKey = synchronized ? null : eventKey;
        notifyChange(changedKey, changedKey === null ? null : state[changedKey]);
        return true;
    }

    function reset() {
        state = { ...DEFAULTS };
        persist();
        notifyChange(null, null);
    }

    function exportJson() {
        return JSON.stringify(state, null, 2);
    }

    function importJson(json) {
        try {
            const parsed = typeof json === 'string' ? JSON.parse(json) : json;
            state = { ...DEFAULTS, ...sanitize(parsed) };
            persist();
            notifyChange(null, null);
            return true;
        } catch (e) {
            console.error('[premium] import failed:', e);
            return false;
        }
    }

    function subscribe(callback) {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
    }

    function notifyChange(key, value) {
        window.GUNTER_PREMIUM_FEATURES = state;
        const detail = { key, value, features: { ...state } };
        subscribers.forEach(cb => { try { cb(detail); } catch {} });
        window.dispatchEvent(new CustomEvent('gunterPremiumFeaturesChange', { detail }));
    }

    window.addEventListener?.('storage', event => {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        if (event.storageArea && event.storageArea !== localStorage) return;
        const latest = load(state);
        if (!Object.keys(latest).some(key => latest[key] !== state[key])) return;
        state = latest;
        notifyChange(null, null);
    });

    // ---------- Feature metadata ----------
    function getFeatureDescription(key) {
        return DESCRIPTIONS[key] || '';
    }

    /**
     * Devuelve uno de: 'active' | 'inactive' | 'requires_connection'
     *                 | 'coming_soon' | 'error' | 'unsupported'
     */
    function getFeatureStatus(key) {
        const v = state[key];

        // Grupos que requieren conexión externa real
        const needsConnection = new Set([
            'googleCalendarSync', 'googleCalendarNaturalLanguage', 'googleCalendarAutoReminders',
            'whatsappAssistant', 'whatsappCommands', 'whatsappNotifications', 'whatsappMeetingScheduling',
            'documentSync', 'notionSync', 'googleDriveSync'
        ]);
        // Grupos aún sin implementación real = coming_soon cuando están OFF
        const comingSoon = new Set([
            'whatsappCommands', 'whatsappMeetingScheduling',
            'notionSync', 'googleDriveSync'
        ]);

        if (v === true) {
            if (needsConnection.has(key) && !hasExternalConnection(key)) {
                return 'requires_connection';
            }
            if (key === 'voiceEnabled') {
                if (state.voiceMode === 'text_only') return 'inactive';
                const runtime = window.GunterRuntimeState?.getState?.() || {};
                const localOnly = runtime.mode === 'LOCAL' || runtime.privacy === 'LOCAL_ONLY';
                if (localOnly && (runtime.loaded !== true || !runtime.localTTSAvailable)) return 'unavailable';
                if (!localOnly && !voiceSupported() && !runtime.localTTSAvailable) return 'unavailable';
                const playbackError = window.GunterVoice?.getPlaybackState?.()?.error;
                if (playbackError?.code === 'VOICE_PLAYBACK_BLOCKED') return 'pending_interaction';
                if (playbackError) return 'error';
            }
            if (key === 'wakeWordEnabled' || key === 'dictationEnabled') {
                if (!navigator.mediaDevices?.getUserMedia ||
                    (key === 'dictationEnabled' && !window.MediaRecorder) ||
                    (key === 'wakeWordEnabled' && !speechRecognitionSupported())) return 'unavailable';
                const runtime = window.GunterRuntimeState?.getState?.() || {};
                const localOnly = runtime.mode === 'LOCAL' || runtime.privacy === 'LOCAL_ONLY';
                if (localOnly && !window.MediaRecorder) return 'unavailable';
                if (localOnly && (runtime.flags?.['stt.local'] === false || runtime.loaded !== true || !runtime.localSTTReady)) return 'unavailable';
                const capture = key === 'wakeWordEnabled' ? window.GunterWakeWord?.getState?.() : window.GunterSTT?.pushToTalk?.getState?.();
                if (capture?.phase === 'error' || capture?.error) return 'error';
                if (microphonePermission === 'denied') return 'error';
                if (key === 'wakeWordEnabled' && capture?.active) return 'active';
                if (key === 'dictationEnabled' && ['recording', 'transcribing', 'review'].includes(capture?.phase)) return 'active';
                if (capture?.permission === 'granted' || microphonePermission === 'granted') return 'active';
                return 'pending_permission';
            }
            return 'active';
        }

        if (comingSoon.has(key)) return 'coming_soon';
        return 'inactive';
    }

    function hasExternalConnection(key) {
        if (key.startsWith('googleCalendar')) {
            return !!(window.GunterGoogleAuth && window.GunterGoogleAuth.isConnected && window.GunterGoogleAuth.isConnected());
        }
        if (key.startsWith('whatsapp')) return false;  // sin backend todavía
        if (key === 'notionSync' || key === 'googleDriveSync' || key === 'documentSync') return false;
        return true;
    }

    // ---------- Capability detection ----------
    function voiceSupported() {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }
    function speechRecognitionSupported() {
        return typeof window !== 'undefined'
            && (('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
                || !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.GunterVoiceActivity?.supported));
    }

    // ---------- Composite getters ----------
    function getVoiceConfig() {
        const effectiveMode = !state.voiceEnabled || state.voiceMode === 'text_only' ? 'text_only'
            : state.voiceMode === 'notifications_only' ? 'notifications_only'
                : state.voiceMode === 'wake_word_only' || state.voiceOnlyAfterWakeWord ? 'wake_word_only'
                    : 'live_voice';
        return {
            enabled: state.voiceEnabled,
            mode: state.voiceMode,
            effectiveMode,
            style: state.voiceStyle,
            speed: state.voiceSpeed,
            tone: state.voiceTone,
            inMeetings: state.voiceInMeetings,
            onlyAfterWakeWord: state.voiceOnlyAfterWakeWord,
            wakeWordResponseMode: state.wakeWordResponseMode,
            supported: voiceSupported() || !!window.GunterRuntimeState?.getState?.()?.localTTSAvailable
        };
    }
    function getPersonalityConfig() {
        return {
            enabled: state.adaptivePersonality,
            mode: state.personalityMode,
            intensity: state.personalityIntensity,
            focusCoach: state.focusCoachEnabled,
            distractionBlocker: state.distractionBlocker,
            smartTimer: state.smartTimer
        };
    }
    function getWakeWordConfig() {
        return {
            enabled: state.wakeWordEnabled,
            wakeWord: state.wakeWord,
            listeningMode: state.wakeWordListeningMode,
            responseMode: state.wakeWordResponseMode,
            autoStopSeconds: state.wakeWordAutoStopSeconds,
            supported: speechRecognitionSupported()
        };
    }

    // ---------- Export to window ----------
    const api = {
        // CRUD
        getAll, get, set, updateMany, isEnabled, reset,
        // Persistence
        export: exportJson,
        import: importJson,
        // Events
        subscribe, notifyChange,
        // Metadata
        getFeatureStatus, getFeatureDescription,
        // Composites
        getVoiceConfig, getPersonalityConfig, getWakeWordConfig,
        // Capability probing
        isVoiceSupported: voiceSupported,
        isSpeechRecognitionSupported: speechRecognitionSupported,
        // Introspection
        DEFAULTS, ENUMS, CHILDREN, FEATURE_MAP, FEATURE_CATEGORIES
    };

    window.PremiumFeaturesService = api;
    window.GUNTER_PREMIUM_FEATURES = state;   // alias solo-lectura para consumidores cómodos

    // Debug hatch
    if (location.search.includes('debug=1')) {
        window.__gpfDump = () => console.table(state);
    }
})();
