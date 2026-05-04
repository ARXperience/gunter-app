/* =============================================
   GUNTER SERVICE - Error Mapper
   -------------------------------------------------
   Traduce errores técnicos a mensajes humanos en
   español. Cualquier módulo que reciba un Error o
   un objeto con .message debería pasarlo por
   GunterErrors.format() antes de mostrarlo.
   ============================================= */

(function () {
    // Catálogo: clave → { user, hint? }
    // Match orden: primero código exacto (network/openai/quota), luego regex sobre el mensaje.
    const CATALOG = {
        // Network / connectivity
        offline:           { user: 'Sin conexión a internet. Verifica tu red.', hint: 'Tus datos locales siguen seguros.' },
        timeout:           { user: 'La operación está tardando más de lo normal. Intenta otra vez.' },
        network_error:     { user: 'No pude alcanzar el servidor. Revisa tu conexión.' },

        // OpenAI
        openai_no_key:     { user: 'No tengo configurada la clave de OpenAI en el servidor.', hint: 'Añade OPENAI_API_KEY a tu archivo .env y reinicia.' },
        openai_quota:      { user: 'Se agotó la cuota de OpenAI por ahora.', hint: 'Espera unos minutos o revisa tu plan.' },
        openai_rate:       { user: 'Demasiadas peticiones a OpenAI muy rápido.', hint: 'Espera un momento y reintenta.' },
        openai_invalid:    { user: 'OpenAI rechazó la petición.', hint: 'Suele pasar con audios muy largos o imágenes corruptas.' },
        openai_generic:    { user: 'OpenAI tuvo un problema procesando esto.' },

        // Gemini
        gemini_no_key:     { user: 'Gemini no está configurado en el servidor.', hint: 'Añade GEMINI_API_KEY a .env y reinicia.' },
        gemini_invalid:    { user: 'Gemini no pudo procesar la imagen o el texto.', hint: 'Intenta con otra imagen o reduce el tamaño.' },
        gemini_rate:       { user: 'Gemini está saturado. Espera un momento.' },

        // Whisper
        whisper_failed:    { user: 'No pude transcribir el audio.', hint: 'Verifica que se haya grabado correctamente.' },
        audio_too_large:   { user: 'El audio es demasiado grande.', hint: 'Reuniones de más de 2 h se procesan en chunks; espera más.' },

        // Document extraction
        doc_unreadable:    { user: 'No pude leer este documento. Intenta con una foto más nítida.', hint: 'Asegúrate de que el texto esté enfocado y bien iluminado.' },
        doc_too_large:     { user: 'La imagen es muy pesada (máx 12 MB).', hint: 'Comprime la imagen antes de subirla.' },

        // Calendar
        gcal_no_session:   { user: 'Tu sesión de Google Calendar expiró.', hint: 'Conéctate de nuevo en Configuración → Premium.' },
        gcal_no_scope:     { user: 'Falta el permiso de Calendar.', hint: 'Reconecta y acepta el permiso completo.' },
        gcal_offline:      { user: 'Sin conexión a Google Calendar.', hint: 'Tu evento se sincronizará cuando vuelva la red.' },
        gcal_not_found:    { user: 'Ese evento ya no existe en Google Calendar.', hint: 'Lo desvinculé localmente.' },

        // Microphone / browser permissions
        mic_denied:        { user: 'Bloqueaste el micrófono.', hint: 'Actívalo en los ajustes del navegador (candado en la barra de URL).' },
        mic_unsupported:   { user: 'Tu navegador no soporta el micrófono.', hint: 'Usa Chrome, Edge o Safari recientes.' },
        speech_unsupported:{ user: 'Tu navegador no soporta reconocimiento de voz.', hint: 'Necesario para Wake Word.' },
        synth_unsupported: { user: 'Tu navegador no soporta síntesis de voz.', hint: 'Gunter responderá solo por texto.' },

        // WhatsApp
        wa_not_loaded:     { user: 'WhatsApp no está disponible en el servidor.', hint: 'Instala las dependencias y reinicia npm run dev.' },
        wa_disconnected:   { user: 'WhatsApp no está conectado.', hint: 'Escanea el QR en Configuración → Premium.' },
        wa_send_failed:    { user: 'No se pudo enviar el mensaje a WhatsApp.', hint: 'Verifica que el número sea válido (con código de país).' },

        // Storage
        storage_full:      { user: 'Tu navegador está casi lleno.', hint: 'Configuración → Datos → exporta y limpia datos antiguos.' },
        idb_failed:        { user: 'No pude guardar localmente. El navegador rechazó el almacenamiento.' },

        // Generic fallbacks
        not_found:         { user: 'No encontré lo que buscabas.' },
        forbidden:         { user: 'No tienes permiso para esto.' },
        unknown:           { user: 'Algo salió mal.', hint: 'Si se repite, abre la consola (F12) para más detalles.' }
    };

    // Detectores: regex sobre mensaje técnico → clave del catálogo
    const DETECTORS = [
        // Network
        { rx: /failed to fetch|network ?error|err_internet|offline/i,                    key: 'network_error' },
        { rx: /timeout|timed out|abort/i,                                                key: 'timeout' },

        // OpenAI specific
        { rx: /OPENAI_API_KEY missing|api[_ ]?key/i,                                     key: 'openai_no_key' },
        { rx: /quota|insufficient[_ ]quota|billing/i,                                    key: 'openai_quota' },
        { rx: /rate.?limit|429/i,                                                        key: 'openai_rate' },
        { rx: /invalid request|400/i,                                                    key: 'openai_invalid' },
        { rx: /OpenAI HTTP 5\d\d/i,                                                      key: 'openai_generic' },
        { rx: /OpenAI HTTP/i,                                                            key: 'openai_generic' },
        { rx: /Whisper HTTP/i,                                                           key: 'whisper_failed' },

        // Gemini
        { rx: /GEMINI_API_KEY (missing|not configured)/i,                                key: 'gemini_no_key' },
        { rx: /Gemini HTTP 4\d\d/i,                                                      key: 'gemini_invalid' },
        { rx: /Gemini HTTP 429/i,                                                        key: 'gemini_rate' },
        { rx: /Gemini HTTP/i,                                                            key: 'gemini_invalid' },

        // Documents
        { rx: /Imagen demasiado grande|too large|>12 MB|413/i,                           key: 'doc_too_large' },
        { rx: /no se pudo extraer|JSON inv[aá]lido|no es parseable/i,                    key: 'doc_unreadable' },

        // Calendar
        { rx: /google[: ]not found|404/i,                                                key: 'gcal_not_found' },
        { rx: /google[: ]conflict|409/i,                                                 key: 'gcal_not_found' },
        { rx: /sesi[oó]n.+expir|reconecta|401/i,                                         key: 'gcal_no_session' },
        { rx: /scope|insufficient.*scope|permission_denied|403/i,                        key: 'gcal_no_scope' },

        // Mic / browsers
        { rx: /not[- ]allowed|permission.+denied|micr[oó]fono.+(denegad|rechaz)/i,       key: 'mic_denied' },
        { rx: /SpeechRecognition.+(soportado|supported)|no SR/i,                         key: 'speech_unsupported' },
        { rx: /speechSynthesis|síntesis de voz/i,                                        key: 'synth_unsupported' },

        // WhatsApp
        { rx: /WhatsApp.+no.+disponible|wa not loaded|baileys/i,                         key: 'wa_not_loaded' },
        { rx: /WhatsApp no est[aá] conectado|not connected/i,                            key: 'wa_disconnected' },

        // Storage
        { rx: /quotaexceeded|quota.+exceeded|disk.*full/i,                               key: 'storage_full' },
        { rx: /indexeddb|idb.+(failed|error)/i,                                          key: 'idb_failed' },

        // HTTP generic
        { rx: /\b404\b/,                                                                 key: 'not_found' },
        { rx: /\b403\b|forbidden/i,                                                      key: 'forbidden' }
    ];

    /**
     * Convierte un Error/string/Response/objeto en un mensaje humano.
     * @param {Error|string|Response|object} error
     * @param {object} [opts]
     * @param {string} [opts.context] - 'audio' | 'document' | 'calendar' | 'whatsapp' | etc.
     * @param {boolean} [opts.includeHint=true]
     * @returns {{ user: string, hint?: string, technical: string, key: string }}
     */
    function format(error, opts = {}) {
        const technical = extractTechnical(error);
        const key = detectKey(technical, opts.context);
        const entry = CATALOG[key] || CATALOG.unknown;
        // Special-case: si el technical menciona algo como `HTTP 500: ...`, intentar
        // pasar el resto como hint adicional para debugging.
        return {
            user: entry.user,
            hint: opts.includeHint === false ? undefined : entry.hint,
            technical,
            key
        };
    }

    /** Solo el texto humano combinado (user + hint). Útil para alerts. */
    function format1(error, opts = {}) {
        const f = format(error, opts);
        return f.hint ? `${f.user}\n${f.hint}` : f.user;
    }

    function extractTechnical(error) {
        if (!error) return '';
        if (typeof error === 'string') return error;
        if (error.message) return error.message;
        if (error.error) return typeof error.error === 'string' ? error.error : (error.error.message || JSON.stringify(error.error));
        if (error.status && error.statusText) return `HTTP ${error.status} ${error.statusText}`;
        try { return JSON.stringify(error); } catch { return String(error); }
    }

    function detectKey(message, context) {
        if (!message) return 'unknown';

        // Context-prioritized detection
        if (context === 'document' && /imagen|recibo|factura/i.test(message)) {
            for (const d of DETECTORS) {
                if (d.rx.test(message) && /doc_/.test(d.key)) return d.key;
            }
        }
        if (context === 'audio' && /whisper|audio|transcripci/i.test(message)) {
            for (const d of DETECTORS) {
                if (d.rx.test(message) && (/whisper|audio/.test(d.key))) return d.key;
            }
        }

        for (const d of DETECTORS) {
            if (d.rx.test(message)) return d.key;
        }
        if (!navigator.onLine) return 'offline';
        return 'unknown';
    }

    /**
     * Helper para mostrar un toast humano dado cualquier error.
     * Si NotificationsService está disponible, muestra el toast.
     * Siempre loguea el technical en consola.
     */
    function toast(error, opts = {}) {
        const f = format(error, opts);
        console.warn('[gunter-error]', f.key, '·', f.technical);
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(
                `⚠️ ${f.user}${f.hint ? ' · ' + f.hint : ''}`,
                { priority: 'high', duration: 6500, silent: opts.silent !== false }
            );
        }
        return f;
    }

    window.GunterErrors = { format, format1, toast, CATALOG, DETECTORS };
})();
