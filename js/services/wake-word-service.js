/* =============================================
   GUNTER SERVICE - Wake Word ("Hi Gunter") v3
   -------------------------------------------------
   Detector más tolerante + diagnóstico en vivo.
   Requiere gesto de usuario para pedir micro.
   Auto-restart robusto ante InvalidStateError.
   ============================================= */

(function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    // Fase E.E8 — Mensajes humanos
    const HUMAN_ERRORS = {
        unsupported: 'Tu navegador no soporta activación por voz.',
        denied:      'No pude activar el micrófono. Revisa los permisos del navegador.',
        no_mic:      'No detecté micrófono disponible.',
        rejected:    'Permiso de micrófono rechazado. Para activar la voz, autoriza el micrófono y vuelve a intentar.',
        unknown:     'No pude iniciar la activación por voz. Inténtalo de nuevo en un momento.',
        in_meeting:  'Durante reuniones, Gunter está configurado para responder solo por texto.'
    };
    function humanError(code) { return HUMAN_ERRORS[code] || HUMAN_ERRORS.unknown; }

    if (!SR) {
        window.GunterWakeWord = {
            supported: false,
            isActive: () => false,
            start: () => { /* no throw — degradación silenciosa con mensaje humano */
                console.info('[wake-word]', humanError('unsupported'));
                if (window.GunterNotificationsService?.showToast) {
                    window.GunterNotificationsService.showToast(humanError('unsupported'), { variant: 'warn', duration: 4500, silent: true });
                }
            },
            stop: () => {},
            refresh: () => {},
            requestPermission: async () => 'unsupported',
            getState: () => ({ active: false, mode: 'off', supported: false, humanError: humanError('unsupported') }),
            getLastHeard: () => '',
            humanError
        };
        return;
    }

    let recognition = null;
    let running = false;
    let mode = 'off';
    let queryTimeout = null;
    let indicator = null;
    let permissionGranted = false;
    let lastError = null;
    let lastHeard = '';
    let restartTimer = null;
    let userWantsRunning = false;   // persistente: si el user lo apagó, no reiniciamos

    function buildIndicator() {
        if (indicator) return indicator;
        indicator = document.createElement('div');
        indicator.id = 'gunter-wake-ind';
        indicator.style.cssText = `
            position: fixed; bottom: 14px; left: 14px; z-index: 9998;
            display: none; align-items: center; gap: 10px;
            padding: 8px 14px; background: color-mix(in srgb, var(--bg-deep-navy, #0b0f16) 90%, transparent);
            border: 1px solid var(--accent-primary, #00d4ff); border-radius: 999px;
            font-family: 'Inter', sans-serif; font-size: 12px; color: var(--text-primary, #fff);
            backdrop-filter: blur(14px); cursor: pointer;
            user-select: none;
        `;
        indicator.innerHTML = `
            <span class="gww-dot" style="width:8px; height:8px; border-radius:50%; background: var(--accent-primary, #00d4ff); box-shadow: 0 0 8px currentColor;"></span>
            <span class="gww-label">Escuchando…</span>
        `;
        document.body.appendChild(indicator);
        const style = document.createElement('style');
        style.textContent = `
            @keyframes gwwPulse { 0%,100% { opacity:0.5; transform:scale(1); } 50% { opacity:1; transform:scale(1.3); } }
            #gunter-wake-ind.is-active { display:inline-flex; }
            #gunter-wake-ind .gww-dot { animation: gwwPulse 1.4s ease-in-out infinite; }
            #gunter-wake-ind.is-query { border-color: #22c55e; }
            #gunter-wake-ind.is-query .gww-dot { background: #22c55e; }
            #gunter-wake-ind.is-error { border-color: #ef4444; }
            #gunter-wake-ind.is-error .gww-dot { background: #ef4444; animation: none; }
        `;
        document.head.appendChild(style);
        indicator.addEventListener('click', () => {
            if (running) { userWantsRunning = false; stop(); }
            else { userWantsRunning = true; start(true); }
        });
        return indicator;
    }

    function setIndicator(state, label) {
        const el = buildIndicator();
        el.classList.toggle('is-active', state !== 'off');
        el.classList.toggle('is-query', state === 'query');
        el.classList.toggle('is-error', state === 'error');
        el.querySelector('.gww-label').textContent = label;
        el.title = (state === 'off') ? 'Click para activar' : 'Click para pausar';
    }

    function getConfig() {
        if (!window.PremiumFeaturesService) {
            return { enabled: false, wakeWord: 'Hi Gunter', autoStopSeconds: 20, responseMode: 'text' };
        }
        return window.PremiumFeaturesService.getWakeWordConfig();
    }

    async function requestPermission() {
        if (permissionGranted) return 'granted';
        if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            permissionGranted = true;
            console.log('[wake-word] ✅ Permiso de micrófono concedido');
            return 'granted';
        } catch (e) {
            lastError = e.message || String(e);
            console.warn('[wake-word] ❌ Permiso denegado:', e.name);
            permissionGranted = false;
            return e.name === 'NotAllowedError' ? 'denied' : 'error';
        }
    }

    /**
     * Detector MUY tolerante: busca "gunter" en CUALQUIER parte del texto.
     * El resto de la frase se toma como comando. Así "hi gunter", "hey gunter",
     * "oye gunter", "hola gunter", e incluso solo "gunter" activan.
     */
    function extractAfterWake(raw) {
        if (!raw) return null;
        const norm = raw.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[.,!?¿¡]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        // Formas comunes que Speech API puede transcribir
        const WAKE_PATTERNS = [
            /\b(hi|hey|ok|okey|oye|hola|escucha)\s+gunter\b/i,
            /\bgunter\b/i,
            /\bgonter\b/i,    // phonetic fallback
            /\bgunt[ae]r\b/i,
            /\bcuanter\b/i    // spanish mis-transcription
        ];
        for (const re of WAKE_PATTERNS) {
            const m = norm.match(re);
            if (m) {
                const afterIdx = m.index + m[0].length;
                return norm.slice(afterIdx).trim(); // puede ser "" si solo dijo "Hi Gunter"
            }
        }
        return null;
    }

    // Fase 3 (Android-ready): SpeechRecognition tiene limitaciones serias en Android.
    // - En Chrome Android funciona pero NO en background (la pantalla apagada lo mata).
    // - En WebView puro de Android (TWA con Chrome Custom Tab no aplica) está deshabilitado.
    // - En PWA instalada en Android funciona solo mientras la app esté en primer plano.
    // Detectamos y avisamos al usuario una sola vez por sesión.
    let androidWarningShown = false;
    function isAndroid() {
        return /Android/i.test(navigator.userAgent || '');
    }
    function maybeShowAndroidWarning() {
        if (androidWarningShown || !isAndroid()) return;
        androidWarningShown = true;
        const msg = 'En Android, "Hi Gunter" solo funciona con la app en pantalla. Si bloqueas el teléfono o sales de la app, dejará de escuchar.';
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, {
                variant: 'info',
                duration: 7000,
                silent: true
            });
        } else {
            console.info('[wake-word] Android limitation:', msg);
        }
    }

    async function start(fromUserGesture = false) {
        const cfg = getConfig();
        if (!cfg.enabled) { setIndicator('off', ''); return; }
        if (running) return;

        // Aviso Android una vez por sesión (no bloquea, solo informa)
        maybeShowAndroidWarning();

        if (!permissionGranted) {
            if (!fromUserGesture) {
                setIndicator('error', '🎤 Click para activar micrófono');
                return;
            }
            const p = await requestPermission();
            if (p !== 'granted') {
                // Fase E.E8 — mensaje humano + toast
                const code = p === 'denied' ? 'rejected' : 'no_mic';
                setIndicator('error', p === 'denied' ? 'Micrófono denegado' : 'Sin micrófono');
                if (window.GunterNotificationsService?.showToast) {
                    window.GunterNotificationsService.showToast(humanError(code), { variant: 'warn', duration: 5000, silent: true });
                }
                return;
            }
        }

        userWantsRunning = true;
        lastError = null;

        try {
            recognition = new SR();
            recognition.lang = 'es-MX';
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 3;  // más alternativas = más chance de match

            recognition.onstart = () => {
                running = true;
                mode = 'wake';
                setIndicator('wake', `Di "${cfg.wakeWord}"`);
                notifyState();
                console.log('[wake-word] 🎙 Escuchando');
            };

            recognition.onresult = (event) => {
                const last = event.results[event.results.length - 1];
                // Iterar todas las alternativas para aumentar la captura
                let bestText = '';
                for (let i = 0; i < last.length; i++) {
                    const t = last[i].transcript || '';
                    if (t.length > bestText.length) bestText = t;
                }
                if (!bestText) return;
                lastHeard = bestText;
                notifyState();

                if (window.__GUNTER_DEBUG_WAKE__) {
                    console.log('[wake-word]', mode, last.isFinal ? 'FINAL' : 'interim', ':', bestText);
                }

                if (mode === 'wake') {
                    // Intentar detectar en interim Y final
                    const after = extractAfterWake(bestText);
                    if (after !== null) {
                        enterQueryMode(after);
                    }
                } else if (mode === 'query' && last.isFinal) {
                    handleQuery(bestText);
                }
            };

            recognition.onerror = (e) => {
                lastError = e.error;
                console.warn('[wake-word] error:', e.error, e.message);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    permissionGranted = false;
                    userWantsRunning = false;
                    setIndicator('error', 'Permiso de micrófono rechazado');
                    stop();
                    return;
                }
                // no-speech / aborted → no-op, onend se encarga
            };

            recognition.onend = () => {
                running = false;
                notifyState();
                console.log('[wake-word] onend (user quiere corriendo?', userWantsRunning, ')');
                // Reconnect aggressively if user hasn't disabled it
                if (userWantsRunning && getConfig().enabled && permissionGranted) {
                    clearTimeout(restartTimer);
                    restartTimer = setTimeout(() => {
                        if (!running && userWantsRunning) start();
                    }, 600);
                } else {
                    setIndicator('off', '');
                }
            };

            try {
                recognition.start();
            } catch (e) {
                if (e.name === 'InvalidStateError') {
                    // Reintentar con más delay
                    try { recognition.abort(); } catch {}
                    setTimeout(() => { if (userWantsRunning) start(fromUserGesture); }, 800);
                    return;
                }
                throw e;
            }
        } catch (e) {
            console.error('[wake-word] start failed:', e);
            lastError = e.message;
            setIndicator('error', 'Error al iniciar micrófono');
        }
    }

    function stop() {
        userWantsRunning = false;
        if (queryTimeout) { clearTimeout(queryTimeout); queryTimeout = null; }
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        try { recognition?.abort(); } catch {}
        recognition = null;
        running = false;
        mode = 'off';
        setIndicator('off', '');
        notifyState();
    }

    // Feedback variado por estilo cuando Gunter despierta.
    function pickWakeFeedback() {
        const style = window.PremiumFeaturesService?.get?.('voiceStyle') || 'professional';
        const FEEDBACK = {
            professional:      ['¿Sí?', 'Dime.', 'Te escucho.'],
            warm:              ['¿Sí, dime?', 'Aquí estoy.', 'Cuéntame.'],
            chaotic_scientist: ['¿Qué pasó?', 'Sorpréndeme.', 'Aquí, ¿qué crisis?', 'Dime, genio.'],
            energetic_cartoon: ['¡Aquí!', '¡Dale, dime!', '¡Te escucho!'],
            minimal_penguin:   ['Sí.', 'Dime.', 'Aquí.'],
            executive:         ['A la orden.', 'Dime.', 'Te escucho.'],
            focus_coach:       ['Va.', 'Dale, dime.', '¿Cuál es la siguiente?']
        };
        const arr = FEEDBACK[style] || FEEDBACK.professional;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function enterQueryMode(preText = '') {
        mode = 'query';
        const cfg = getConfig();
        setIndicator('query', '🎤 Te escucho…');
        notifyState();

        // Feedback hablado por estilo (preferimos GunterVoice → TTS humano)
        // Fase E.E5: si hay reunión activa, NO interrumpimos con feedback hablado;
        // sólo cambia el indicador visual.
        try {
            const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
            if (meetingActive) {
                // Solo visual; no hablar feedback durante grabación
            } else {
                const feedback = pickWakeFeedback();
                if (window.GunterVoice?.speak) {
                    // 'wake-word-feedback' tiene límite ultra-corto (80 chars)
                    window.GunterVoice.speak(feedback, { context: 'wake-word-feedback', force: true, volume: 0.85 });
                } else if ('speechSynthesis' in window) {
                    const u = new SpeechSynthesisUtterance(feedback);
                    u.lang = 'es-MX'; u.volume = 0.4; u.rate = 1.15;
                    speechSynthesis.speak(u);
                }
            }
        } catch {}

        if (queryTimeout) clearTimeout(queryTimeout);
        queryTimeout = setTimeout(() => {
            mode = 'wake';
            setIndicator('wake', `Di "${cfg.wakeWord}"`);
            notifyState();
        }, (cfg.autoStopSeconds || 20) * 1000);

        // Si la wake word vino con texto después ("gunter crea una tarea"), procesar ya
        if (preText && preText.length > 3) {
            // Pequeño delay para no pisar el beep
            setTimeout(() => handleQuery(preText), 300);
        }

        try { ensureAssistantOpen(); } catch {}
    }

    function ensureAssistantOpen() {
        if (!window.GunterAssistantController) return;
        if (!document.querySelector('.gn-assistant')) {
            window.GunterAssistantController.mount();
        } else {
            document.querySelector('.gn-assistant')?.classList.remove('is-collapsed');
        }
    }

    async function handleQuery(transcript) {
        const cfg = getConfig();
        if (queryTimeout) { clearTimeout(queryTimeout); queryTimeout = null; }
        mode = 'wake';
        setIndicator('wake', `Di "${cfg.wakeWord}"`);
        notifyState();

        const text = (transcript || '').trim();
        if (!text) return;
        console.log('[wake-word] 💬 Procesando:', text);

        // v2 (F1) — registrar lo dicho al wake en LTM (canal 'wake')
        if (window.GunterConversationMemory?.remember) {
            try {
                window.GunterConversationMemory.remember({
                    role: 'user',
                    text,
                    channel: 'wake',
                    projectId: window.GunterCurrentProject?.id || null
                }).catch(() => {});
            } catch { /* noop */ }
        }

        // Fase E.E5/E2 — contexto correcto:
        // si hay reunión activa, pasamos context: 'meeting' (que respeta voiceInMeetings).
        const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
        const speechContext = meetingActive ? 'meeting' : 'wake-word-response';

        if (window.GunterPipeline?.handleUserInput) {
            try {
                const result = await window.GunterPipeline.handleUserInput(text);
                const reply = result?.response?.speech || 'Listo.';
                // Hablar la respuesta. shouldSpeak() respeta voiceInMeetings y voiceMode.
                // Si está bloqueado, GunterVoice.speak() simplemente no hace nada (silent).
                if (window.GunterVoice?.speak) {
                    // En reunión NUNCA forzamos: respetamos config del usuario.
                    const force = !meetingActive;
                    window.GunterVoice.speak(reply, { context: speechContext, force });
                }
                // En reunión, abrir el assistant siempre (respuesta visible aunque la voz esté off)
                ensureAssistantOpen();
                await window.GunterAssistantController?.send?.(text);
            } catch (e) {
                console.error('[wake-word] pipeline error:', e);
            }
        }
    }

    const listeners = new Set();
    function notifyState() {
        const s = getState();
        listeners.forEach(fn => { try { fn(s); } catch {} });
        window.dispatchEvent(new CustomEvent('wake-word-state', { detail: s }));
    }
    function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    function getState() {
        return {
            active: running,
            mode,
            supported: true,
            permission: permissionGranted ? 'granted' : 'unknown',
            error: lastError,
            lastHeard
        };
    }
    function isActive() { return running; }
    function getLastHeard() { return lastHeard; }

    function refresh() {
        const cfg = getConfig();
        if (cfg.enabled && !running && permissionGranted && userWantsRunning !== false) {
            start();
        } else if (!cfg.enabled && running) {
            stop();
        }
    }

    // Toggle debug mode with ?debug=wake
    if (location.search.includes('debug=wake')) {
        window.__GUNTER_DEBUG_WAKE__ = true;
        console.log('[wake-word] DEBUG MODE ACTIVE');
    }

    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        if (e.detail?.key === 'wakeWordEnabled' || e.detail?.key === null) refresh();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refresh);
    } else {
        refresh();
    }

    window.GunterWakeWord = {
        supported: true,
        isActive,
        start,
        stop,
        refresh,
        requestPermission,
        getState,
        getLastHeard,
        onStateChange,
        humanError       // Fase E.E8 — códigos de error con mensajes humanos
    };
})();
