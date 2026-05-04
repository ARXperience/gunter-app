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
        voiceEnabled: false,
        voiceMode: 'text_only',                // 'text_only'|'notifications_only'|'live_voice'|'wake_word_only'
        voiceStyle: 'professional',            // 'professional'|'warm'|'chaotic_scientist'|'energetic_cartoon'|'minimal_penguin'|'executive'|'focus_coach'
        voiceSpeed: 'normal',                  // 'slow'|'normal'|'fast'
        voiceTone: 'neutral',                  // 'calm'|'neutral'|'expressive'|'intense'
        voiceInMeetings: false,
        voiceOnlyAfterWakeWord: true,

        // 7. Wake word
        wakeWordEnabled: false,
        wakeWord: 'Hi Gunter',
        wakeWordListeningMode: 'manual',       // 'manual'|'continuous'
        wakeWordResponseMode: 'text',          // 'voice'|'text'
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
        conversationMemory: false,
        commitmentTracker: false,
        proactivePulse: false,
        proactivePulseAggression: 'normal',   // 'soft' | 'normal' | 'high'
        meetingClimate: false,
        mirrorStyle: false,
        projectForecast: false
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
        wakeWordResponseMode:   ['voice', 'text']
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
        wakeWordEnabled: 'Gunter reconoce cuando dices su nombre y activa una conversación natural.',

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
        commitmentTracker: [],
        proactivePulse: [],
        meetingClimate: [],
        mirrorStyle: [],
        projectForecast: []
    });

    // ---------- State ----------
    let state = load();
    const subscribers = new Set();

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULTS };
            const parsed = JSON.parse(raw);
            // Merge with DEFAULTS so new flags added later are respected
            return { ...DEFAULTS, ...sanitize(parsed) };
        } catch {
            return { ...DEFAULTS };
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
        // Coerce
        const def = DEFAULTS[key];
        let coerced = value;
        if (typeof def === 'boolean') coerced = !!value;
        else if (ENUMS[key]) coerced = ENUMS[key].includes(value) ? value : state[key];
        else if (typeof def === 'number') coerced = Number.isFinite(+value) ? +value : state[key];

        if (state[key] === coerced) return false;
        state[key] = coerced;

        // Cascade: si se desactiva un padre booleano → opcionalmente apagar hijos
        if (typeof def === 'boolean' && coerced === false && CHILDREN[key]) {
            CHILDREN[key].forEach(child => {
                if (state[child] === true) state[child] = false;
            });
        }

        // Auto-upgrade: al activar la voz por primera vez, no dejarla en "text_only"
        // (que significa no hablar nunca — causa confusión: "activé voz y no habla").
        if (key === 'voiceEnabled' && coerced === true && state.voiceMode === 'text_only') {
            state.voiceMode = 'live_voice';
        }
        // Al desactivar la voz, dejamos el modo intacto para recordar su preferencia.

        persist();
        notifyChange(key, coerced);
        return true;
    }

    function updateMany(partial) {
        let changed = false;
        for (const [k, v] of Object.entries(partial || {})) {
            if (!(k in DEFAULTS)) continue;
            const before = state[k];
            const def = DEFAULTS[k];
            let coerced = v;
            if (typeof def === 'boolean') coerced = !!v;
            else if (ENUMS[k]) coerced = ENUMS[k].includes(v) ? v : state[k];
            else if (typeof def === 'number') coerced = Number.isFinite(+v) ? +v : state[k];
            if (before !== coerced) {
                state[k] = coerced;
                changed = true;
            }
        }
        if (changed) {
            persist();
            notifyChange(null, null);
        }
        return changed;
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
        const detail = { key, value, features: { ...state } };
        subscribers.forEach(cb => { try { cb(detail); } catch {} });
        window.dispatchEvent(new CustomEvent('gunterPremiumFeaturesChange', { detail }));
    }

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
            if (key === 'voiceEnabled' && !voiceSupported()) return 'unsupported';
            if (key === 'wakeWordEnabled' && !speechRecognitionSupported()) return 'unsupported';
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
            && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    }

    // ---------- Composite getters ----------
    function getVoiceConfig() {
        return {
            enabled: state.voiceEnabled,
            mode: state.voiceMode,
            style: state.voiceStyle,
            speed: state.voiceSpeed,
            tone: state.voiceTone,
            inMeetings: state.voiceInMeetings,
            onlyAfterWakeWord: state.voiceOnlyAfterWakeWord,
            supported: voiceSupported()
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
        DEFAULTS, ENUMS, CHILDREN
    };

    window.PremiumFeaturesService = api;
    window.GUNTER_PREMIUM_FEATURES = state;   // alias solo-lectura para consumidores cómodos

    // Debug hatch
    if (location.search.includes('debug=1')) {
        window.__gpfDump = () => console.table(state);
    }
})();
