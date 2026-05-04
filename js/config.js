// =============================================
// GUNTER APP - Configuration
// =============================================
// SEGURIDAD (Fase 1 — blindaje pre-APK):
// 1. NUNCA hay API keys en este archivo. El cliente NO debe poder hablar
//    directamente con OpenAI/Gemini bajo ninguna circunstancia.
// 2. USE_PROXY siempre debe ser true en producción. La constante está
//    forzada y los helpers que devolvían URLs directas a OpenAI ya no
//    existen (lanzan error si alguien los llama).
// 3. PROXY_BASE_URL se resuelve dinámicamente:
//      - localhost:3001 si abres la app desde localhost (dev)
//      - el origin actual (https://...) si la app vive en cloud / TWA
//      - puede sobreescribirse con window.__GUNTER_API_BASE__ antes de
//        cargar este script (útil para overrides en build/APK).
// =============================================

(function () {
    // ----- Resolver base URL del API -----
    // Prioridad: 1) override explícito  2) origin actual  3) localhost dev
    let apiBase;
    if (typeof window.__GUNTER_API_BASE__ === 'string' && window.__GUNTER_API_BASE__) {
        apiBase = window.__GUNTER_API_BASE__.replace(/\/+$/, '');
    } else {
        const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
        if (isLocalhost) {
            // En dev local, el server vive en :3001 aunque la página la sirva otro proceso.
            apiBase = `${window.location.protocol}//${window.location.hostname}:3001`;
        } else {
            // En producción (PWA, TWA, dominio custom): mismo origin que el HTML.
            // El backend debe responder /api/* en el mismo dominio (vía proxy del hosting).
            apiBase = window.location.origin;
        }
    }

    window.GUNTER_CONFIG = Object.freeze({
        // ===== Modelos =====
        CHAT_MODEL: 'gpt-4o-mini',
        WHISPER_MODEL: 'whisper-1',

        // ===== URLs del proxy =====
        // Todas resueltas a partir de PROXY_BASE_URL. NO hay fallback a OpenAI directo.
        PROXY_BASE_URL:               apiBase,
        PROXY_TRANSCRIBE_URL:         apiBase + '/api/transcribe',
        PROXY_CHAT_URL:               apiBase + '/api/chat',
        PROXY_TTS_URL:                apiBase + '/api/tts',
        PROXY_EMBEDDINGS_URL:         apiBase + '/api/embeddings',
        PROXY_GEMINI_TEXT_URL:        apiBase + '/api/gemini-text',
        PROXY_GEMINI_IMAGE_URL:       apiBase + '/api/gemini-image',
        PROXY_GEMINI_STATUS_URL:      apiBase + '/api/gemini-status',
        PROXY_DOCUMENT_EXTRACT_URL:   apiBase + '/api/document-extract',
        PROXY_GOOGLE_STATUS_URL:      apiBase + '/api/google/status',
        PROXY_HEALTH_URL:             apiBase + '/api/health',

        // ===== Google OAuth =====
        // GOOGLE_CLIENT_ID lo inyecta el server cuando responde /api/google/status.
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CALENDAR_SCOPE: 'https://www.googleapis.com/auth/calendar',

        // ===== Calendar defaults =====
        CALENDAR_DEFAULT_CALENDAR_ID: 'primary',
        CALENDAR_DEFAULT_REMINDERS: [1440, 30],
        CALENDAR_URGENT_REMINDERS:  [2880, 60, 10],

        // ===== App settings =====
        MAX_TOKENS: 4096,
        TEMPERATURE: 0.7,

        // ===== Seguridad =====
        // Esta flag es VERDAD inmutable. Si algún módulo intenta poner false,
        // Object.freeze lo bloquea. Cualquier check `if (USE_PROXY)` siempre pasa.
        USE_PROXY: true,

        // ===== Storage keys =====
        PREMIUM_STORAGE_KEY: 'gunter_premium_features'
    });

    // ----- Helpers -----
    // Devuelve la URL del proxy para un tipo de operación.
    window.getApiUrl = function (type) {
        const c = window.GUNTER_CONFIG;
        switch (type) {
            case 'chat':           return c.PROXY_CHAT_URL;
            case 'transcribe':     return c.PROXY_TRANSCRIBE_URL;
            case 'tts':            return c.PROXY_TTS_URL;
            case 'embeddings':     return c.PROXY_EMBEDDINGS_URL;
            case 'gemini-text':    return c.PROXY_GEMINI_TEXT_URL;
            case 'gemini-image':   return c.PROXY_GEMINI_IMAGE_URL;
            case 'document':       return c.PROXY_DOCUMENT_EXTRACT_URL;
            case 'health':         return c.PROXY_HEALTH_URL;
            default:
                console.warn('[config] getApiUrl tipo desconocido:', type);
                return c.PROXY_BASE_URL + '/api/' + type;
        }
    };

    // ===== Helpers DEPRECATED =====
    // Lanzan error si alguien intenta llamar OpenAI directo desde el cliente.
    // Cualquier código viejo que dependa de esto fallará rápido y visible.
    window.getOpenAIHeaders = function () {
        throw new Error('[security] El cliente NO puede hablar con OpenAI directo. Usa el proxy: getApiUrl("chat").');
    };
    window.getOpenAIAuthHeader = function () {
        throw new Error('[security] El cliente NO puede hablar con OpenAI directo. Usa el proxy: getApiUrl("transcribe").');
    };

    console.log('[config] API base:', apiBase, '(proxy mode siempre ON)');
})();
