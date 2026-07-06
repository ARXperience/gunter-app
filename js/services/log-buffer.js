/* =============================================
   GUNTER — Client Log Buffer (v1)
   -------------------------------------------------
   Ring buffer que captura console.error / warn / log / info.
   Gunter puede consultarlo para responder "¿qué salió mal?".

   Se instala como wrapper sobre los console.* originales,
   preservando el comportamiento nativo (sigue apareciendo
   en DevTools) pero agrega cada entrada al buffer.

   API pública:
     window.GunterLogBuffer.getEntries({ level?, limit? })
     window.GunterLogBuffer.getSummary()
     window.GunterLogBuffer.clear()
     window.GunterLogBuffer.getServiceStatus()   // qué services están cargados
   ============================================= */
(function () {
    if (window.GunterLogBuffer) return;

    const MAX = 300;              // capacidad del ring
    const ring = [];
    let counter = 0;

    // Levels de interés (info = console.log, no ruido)
    const LEVELS = ['error', 'warn', 'info', 'log'];

    // Guardar los console originales antes de wrapper
    const original = {};
    for (const lvl of LEVELS) {
        original[lvl] = console[lvl] ? console[lvl].bind(console) : (() => {});
    }

    function shorten(x, max = 400) {
        try {
            if (x === null || x === undefined) return String(x);
            if (typeof x === 'string') return x.length > max ? x.slice(0, max) + '…' : x;
            if (x instanceof Error) return x.name + ': ' + x.message;
            const s = JSON.stringify(x);
            return s.length > max ? s.slice(0, max) + '…' : s;
        } catch {
            try { return String(x).slice(0, max); } catch { return '<no-stringify>'; }
        }
    }

    function record(level, args) {
        const entry = {
            id: ++counter,
            level,
            at: new Date().toISOString(),
            page: (location.pathname || '').split('/').pop() || 'unknown',
            msg: Array.from(args).map(a => shorten(a)).join(' ')
        };
        ring.push(entry);
        if (ring.length > MAX) ring.shift();

        // Delegar al console original para que siga apareciendo en DevTools
        try { original[level](...args); } catch { /* noop */ }
    }

    // Wrapper: reemplaza los métodos console
    for (const lvl of LEVELS) {
        console[lvl] = function (...args) { record(lvl, args); };
    }

    // Captura window.onerror (errores no manejados)
    const prevOnError = window.onerror;
    window.onerror = function (msg, src, line, col, err) {
        record('error', ['[window.onerror]', msg, src + ':' + line + ':' + col, err && err.stack ? err.stack.split('\n')[0] : '']);
        if (typeof prevOnError === 'function') return prevOnError.apply(this, arguments);
        return false;
    };

    // Captura promesas no manejadas
    window.addEventListener('unhandledrejection', (ev) => {
        const reason = ev.reason;
        record('error', ['[unhandledrejection]', reason && reason.message ? reason.message : shorten(reason)]);
    });

    // ─────────────────────────────────────────────
    // Query API
    // ─────────────────────────────────────────────
    function getEntries({ level = null, limit = 20, since = null } = {}) {
        let out = ring;
        if (level) out = out.filter(e => e.level === level);
        if (since) {
            const t = new Date(since).getTime();
            out = out.filter(e => new Date(e.at).getTime() >= t);
        }
        return out.slice(-limit);
    }

    function getSummary() {
        const bylevel = { error: 0, warn: 0, info: 0, log: 0 };
        for (const e of ring) bylevel[e.level]++;
        return {
            total: ring.length,
            capacity: MAX,
            byLevel: bylevel,
            latestError: ring.slice().reverse().find(e => e.level === 'error') || null,
            latestWarn:  ring.slice().reverse().find(e => e.level === 'warn')  || null
        };
    }

    function clear() {
        ring.length = 0;
        counter = 0;
    }

    // ─────────────────────────────────────────────
    // Service status introspection
    // Lista qué services de Gunter están cargados en esta página.
    // Útil para que Gunter pueda decir "aquí no tengo acceso a X porque
    // el service Y no está cargado".
    // ─────────────────────────────────────────────
    const KNOWN_SERVICES = [
        // Core
        ['PremiumFeaturesService',   'js/premium-features-service.js'],
        ['GunterActions',             'js/services/actions-service.js'],
        ['GunterNlpLlm',              'js/services/nlp-llm-service.js'],
        ['GunterNotificationsService','js/services/notifications-service.js'],
        ['GunterErrorMapper',         'js/services/error-mapper.js'],
        ['GunterStatusBus',           'js/services/status-bus.js'],
        // Feature runtimes
        ['GunterConversationMemory',  'js/services/conversation-memory-service.js'],
        ['GunterCommitments',         'js/services/commitments-service.js'],
        ['GunterProactive',           'js/services/proactive-service.js'],
        ['GunterStyleMirror',         'js/services/style-mirror-service.js'],
        ['GunterForecast',            'js/services/forecast-service.js'],
        ['GunterMeetingClimate',      'js/services/meeting-climate-service.js'],
        ['GunterPremiumIntel',        'js/services/premium-intelligence-service.js'],
        // Otros
        ['GunterVoice',               'js/services/voice-service.js'],
        ['GunterWakeWord',            'js/services/wake-word-service.js'],
        ['GunterEvents',              'js/services/events-service.js'],
        ['GunterTasks',               'js/services/tasks-service.js'],
        ['GunterCalendar',            'js/services/calendar-service.js'],
        ['GunterDocuments',           'js/services/document-service.js'],
        ['GunterEmbeddings',          'js/services/embedding-service.js'],
        ['GunterSemanticIndex',       'js/services/semantic-index.js'],
        ['GunterWhatsapp',            'js/services/whatsapp-service.js'],
        ['GunterCompanion',           'js/services/gunter-companion.js']
    ];

    function getServiceStatus() {
        const loaded = [];
        const missing = [];
        for (const [globalName, filePath] of KNOWN_SERVICES) {
            if (window[globalName]) {
                loaded.push({ name: globalName, path: filePath });
            } else {
                missing.push({ name: globalName, path: filePath });
            }
        }
        return { loaded, missing, page: (location.pathname || '').split('/').pop() };
    }

    // ─────────────────────────────────────────────
    // Formato natural para el chat
    // ─────────────────────────────────────────────
    function formatForChat({ level = null, limit = 5 } = {}) {
        const entries = getEntries({ level, limit });
        if (!entries.length) return null;
        return entries
            .map(e => `[${e.level.toUpperCase()} · ${e.at.slice(11, 19)} · ${e.page}] ${shorten(e.msg, 180)}`)
            .join('\n');
    }

    window.GunterLogBuffer = {
        getEntries, getSummary, clear, getServiceStatus, formatForChat,
        MAX
    };

    // Marca de arranque
    record('info', ['[log-buffer] iniciado, capacidad=' + MAX]);
})();
