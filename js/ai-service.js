/* =============================================
   GUNTER APP - AI Service Module
   Web Speech API + AI Analysis Integration
   ============================================= */

class GunterAIService {
    constructor(options = {}) {
        this.options = {
            onTranscript: options.onTranscript || (() => { }),
            onInterimTranscript: options.onInterimTranscript || (() => { }),
            onAnalysis: options.onAnalysis || (() => { }),
            onGunterMessage: options.onGunterMessage || (() => { }),
            onError: options.onError || console.error,
            language: options.language || 'es-MX',
            apiKey: options.apiKey || null,
            apiProvider: options.apiProvider || 'webspeech', // webspeech, openai, gemini
            ...options
        };

        this.recognition = null;
        this.isListening = false;
        this.transcripts = [];
        this.fullTranscript = '';
        this.analysisCache = null;
    }

    // Check browser support for Web Speech API
    static isSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }

    // Initialize speech recognition
    init() {
        if (!GunterAIService.isSupported()) {
            console.warn('Web Speech API not supported. Using fallback mode.');
            return false;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.options.language;

        this.recognition.onstart = () => {
            this.isListening = true;
        };

        this.recognition.onend = () => {
            // Auto-restart if still supposed to be listening
            if (this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) {
                    // Ignore restart errors
                }
            }
        };

        this.recognition.onresult = (event) => {
            let interimTranscript = '';

            // Process results from current resultIndex to end
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;

                if (event.results[i].isFinal) {
                    const finalTranscript = transcript.trim();
                    if (finalTranscript) {
                        // Simple entry without speaker identification
                        const entry = {
                            text: finalTranscript,
                            timestamp: new Date().toISOString()
                        };

                        this.transcripts.push(entry);
                        this.fullTranscript += finalTranscript + ' ';
                        this.options.onTranscript(entry);

                        // Analyze periodically for insights
                        this.analyzeTranscriptPeriodically(finalTranscript);
                    }
                } else {
                    interimTranscript += transcript;
                }
            }

            // Immediately report interim transcript for low latency perception
            if (interimTranscript) {
                this.options.onInterimTranscript(interimTranscript);
            }
        };

        this.recognition.onerror = (event) => {
            if (event.error !== 'no-speech') {
                this.options.onError(event.error);
            }
        };

        return true;
    }

    // Start listening
    start() {
        if (this.recognition && !this.isListening) {
            try {
                this.recognition.start();
                this.isListening = true;
            } catch (e) {
                // Already started
            }
        }
    }

    // Stop listening
    stop() {
        if (this.recognition) {
            this.isListening = false;
            this.recognition.stop();
        }
    }

    // Analyze transcript periodically for Gunter insights
    analyzeTranscriptPeriodically(newText) {
        // Keywords that trigger Gunter interventions
        const triggerKeywords = {
            budget: ['presupuesto', 'costo', 'inversión', 'dinero', 'precio', 'budget'],
            timeline: ['tiempo', 'plazo', 'fecha', 'deadline', 'semanas', 'meses'],
            risk: ['riesgo', 'problema', 'dificultad', 'pero', 'sin embargo', 'preocupa'],
            goal: ['objetivo', 'meta', 'lograr', 'queremos', 'necesitamos'],
            unclear: ['no sé', 'tal vez', 'quizás', 'depende', 'veremos']
        };

        const lowerText = newText.toLowerCase();

        // Check for keywords and generate Gunter responses
        for (const [category, keywords] of Object.entries(triggerKeywords)) {
            if (keywords.some(k => lowerText.includes(k))) {
                this.generateGunterInsight(category, newText);
                break;
            }
        }
    }

    // Generate contextual Gunter insights
    generateGunterInsight(category, context) {
        const insights = {
            budget: [
                '💰 Detecté mención de presupuesto. ¿Han definido un rango específico?',
                '📊 Importante: Registrando información financiera para el análisis.',
                '💵 Punto clave: El presupuesto es un factor crítico. ¿Es flexible?'
            ],
            timeline: [
                '⏱️ Nota sobre tiempos detectada. ¿Es una fecha límite firme?',
                '📅 Registrando información de plazos para el roadmap.',
                '🗓️ Pregunta poderosa: ¿Qué pasa si el timeline se extiende?'
            ],
            risk: [
                '⚠️ Detecté una preocupación. Voy a registrar este riesgo potencial.',
                '🔍 Importante: Este punto podría ser un riesgo. ¿Cómo lo mitigan?',
                '❗ Alerta: Identificando posible bloqueador del proyecto.'
            ],
            goal: [
                '🎯 Excelente: Definiendo objetivos claros.',
                '✅ Registrando meta del proyecto.',
                '📌 Este objetivo va al tablero de estrategia.'
            ],
            unclear: [
                '❓ Detecto incertidumbre. ¿Necesitan más información para decidir?',
                '🤔 Pregunta poderosa: ¿Qué les ayudaría a tener más claridad?',
                '💡 Sugerencia: Transformemos esta duda en una decisión concreta.'
            ]
        };

        const messages = insights[category];
        const message = messages[Math.floor(Math.random() * messages.length)];

        this.options.onGunterMessage({
            type: category,
            message: message,
            context: context,
            timestamp: new Date().toISOString()
        });
    }

    // Get full transcript
    getFullTranscript() {
        return this.fullTranscript;
    }

    // Get all transcript entries
    getTranscripts() {
        return this.transcripts;
    }

    // Generate strategic analysis from transcript (Simplified)
    async generateAnalysis(projectInfo = {}) {
        const transcript = this.fullTranscript;

        // This is now primarily handled by GunterAnalysisService in ai-analysis.js
        // We keep it as a stub for compatibility if needed.
        const summary = {
            duration: this.transcripts.length > 0 ? 'Detectada' : '0 minutos',
            wordCount: transcript.split(/\s+/).length,
            timestamp: new Date().toISOString()
        };

        return summary;
    }

    // AI Analysis methods merged into GunterAnalysisService (ai-analysis.js)
    // Removed: analyzeViability, extractBudget, extractTimeline, extractObjectives, 
    // extractRisks, generateDecisions, generateSummary, extractKeyTopics, 
    // analyzeSentiment, generateDemoAnalysis

    // Clean up
    destroy() {
        this.stop();
        this.recognition = null;
        this.transcripts = [];
        this.fullTranscript = '';
    }
}

// Export
window.GunterAIService = GunterAIService;
