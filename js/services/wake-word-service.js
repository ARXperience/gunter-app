/* =============================================
   GUNTER SERVICE - Wake Word ("Hi Gunter") v3
   -------------------------------------------------
   Detector más tolerante + diagnóstico en vivo.
   Requiere gesto de usuario para pedir micro.
   Auto-restart robusto ante InvalidStateError.
   ============================================= */

(function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const localCaptureSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
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

    if (!SR && !localCaptureSupported) {
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
    let localStream = null;
    let localRecorder = null;
    let localUnsubscribe = null;
    let localClipTimer = null;
    let localEndTimer = null;
    let localBusy = false;
    let localSpeech = false;
    let localClip = [];
    let localPreRoll = [];
    let localProvider = false;
    let suspendedForCapture = false;
    let running = false;
    let mode = 'off';
    let phase = 'off';
    let indicatorLabel = '';
    let queryTimeout = null;
    let permissionGranted = false;
    let lastError = null;
    let lastHeard = '';
    let restartTimer = null;
    let userWantsRunning = false;   // persistente: si el user lo apagó, no reiniciamos
    let lastInvocation = null;

    function setIndicator(state, label) {
        // The navigation and settings panel are the sole visible status surfaces.
        // A second fixed badge used to overlap controls in the lower-left corner.
        indicatorLabel = label || '';
        if (state === 'error') phase = 'error';
        else if (state === 'off') phase = 'off';
        else if (!localBusy) phase = state === 'query' ? 'recording' : 'waiting_activation';
        notifyState();
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
    function detectInvocation(raw) {
        if (window.GunterWakeInvocation?.detect) {
            return window.GunterWakeInvocation.detect(raw, { wakeWord: getConfig().wakeWord });
        }
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
                return {
                    matched: true,
                    type: 'solo_gunter',
                    phrase: m[0],
                    command: norm.slice(afterIdx).trim(),
                    normalized: norm,
                    confidence: 0.8
                };
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

    function usesLocalAudio() {
        const hybrid = window.GunterRuntimeState?.getState?.() || {};
        return hybrid.mode === 'LOCAL' || hybrid.privacy === 'LOCAL_ONLY';
    }

    async function processLocalClip() {
        if (localBusy || !localClip.length || !running) return;
        const chunks = localClip.splice(0);
        localBusy = true;
        phase = 'transcribing';
        notifyState();
        try {
            const mime = localRecorder?.mimeType?.split(';')[0] || 'audio/webm';
            const blob = new Blob(chunks, { type: mime });
            if (!blob.size || blob.size > 30 * 1024 * 1024) return;
            const form = new FormData();
            form.append('file', blob, mime === 'audio/ogg' ? 'wake.ogg' : 'wake.webm');
            const transcript = String(await window.GunterSTT.transcribe(form)).trim();
            if (!running || !transcript || window.GunterVoice?.isLikelyEcho?.(transcript)) return;
            lastHeard = transcript;
            const invocation = detectInvocation(transcript);
            if (mode === 'wake' && invocation) enterQueryMode(invocation);
            else if (mode === 'query') {
                if (invocation && !invocation.command) enterQueryMode(invocation);
                else await handleQuery(invocation?.command || transcript);
            }
        } catch (error) {
            lastError = error.code || error.message;
            phase = 'error';
            notifyState();
            window.GunterNotificationsService?.showToast?.(`Activación local no disponible: ${lastError}`, { variant: 'warn' });
        } finally {
            localBusy = false;
            if (running) {
                phase = mode === 'query' ? 'recording' : 'waiting_activation';
                notifyState();
            }
        }
    }

    async function startLocal(fromUserGesture) {
        const hybrid = window.GunterRuntimeState?.getState?.() || {};
        if (!localCaptureSupported || !window.GunterVoiceActivity?.supported || !window.GunterSTT?.transcribe) {
            lastError = 'La activación local no está disponible en este navegador. Usa Hablar para dictar.';
            setIndicator('error', lastError);
            return;
        }
        if (!hybrid.localSTTReady || hybrid.flags?.['stt.local'] !== true) {
            lastError = 'Moonshine no está instalado o su runtime no está disponible. Usa texto hasta instalarlo.';
            setIndicator('error', lastError);
            return;
        }
        if (!permissionGranted && !fromUserGesture) {
            phase = 'permission_pending'; notifyState();
            return;
        }
        try {
            phase = 'permission_pending'; notifyState();
            localStream = await navigator.mediaDevices.getUserMedia({ audio: {
                echoCancellation: true, noiseSuppression: true, autoGainControl: true
            } });
            permissionGranted = true;
            userWantsRunning = true;
            localProvider = true;
            const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
                .find(value => window.MediaRecorder.isTypeSupported?.(value));
            localRecorder = mime ? new MediaRecorder(localStream, { mimeType: mime }) : new MediaRecorder(localStream);
            localRecorder.ondataavailable = event => {
                if (!event.data?.size) return;
                if (localSpeech) localClip.push(event.data);
                else {
                    localPreRoll.push(event.data);
                    if (localPreRoll.length > 6) localPreRoll.shift();
                }
            };
            localRecorder.onerror = event => {
                lastError = event?.error?.message || 'Error de captura local';
                stop(); setIndicator('error', lastError);
            };
            localRecorder.start(250);
            localUnsubscribe = window.GunterVoiceActivity.onChange(state => {
                if (!running || localBusy) return;
                if (state.reason === 'speech-started' && !window.GunterVoice?.isSpeaking?.()) {
                    clearTimeout(localEndTimer);
                    localSpeech = true;
                    localClip = localPreRoll.splice(0);
                    phase = 'recording'; notifyState();
                    clearTimeout(localClipTimer);
                    localClipTimer = setTimeout(() => {
                        localSpeech = false;
                        localRecorder?.requestData?.();
                        localEndTimer = setTimeout(processLocalClip, 150);
                    }, 12000);
                } else if (state.reason === 'speech-ended' && localSpeech) {
                    clearTimeout(localClipTimer);
                    localEndTimer = setTimeout(() => {
                        localSpeech = false;
                        localRecorder?.requestData?.();
                        setTimeout(processLocalClip, 150);
                    }, 650);
                }
            });
            const vad = await window.GunterVoiceActivity.start(localStream);
            if (!vad.active) throw new Error(vad.error || 'VAD_NO_DISPONIBLE');
            running = true;
            mode = 'wake';
            setIndicator('wake', `Di "${getConfig().wakeWord}"`);
            maybeShowAndroidWarning();
        } catch (error) {
            lastError = error.name === 'NotAllowedError' ? 'Permiso de micrófono rechazado' : error.message;
            stop(); setIndicator('error', lastError);
        }
    }

    async function start(fromUserGesture = false) {
        const hybrid = window.GunterRuntimeState?.getState?.() || {};
        if (hybrid.loaded !== true) return;
        const cfg = getConfig();
        if (!cfg.enabled) { setIndicator('off', ''); return; }
        if (running) return;
        if (usesLocalAudio()) return startLocal(fromUserGesture);
        if (!SR) { lastError = humanError('unsupported'); setIndicator('error', lastError); return; }

        // Aviso Android una vez por sesión (no bloquea, solo informa)
        maybeShowAndroidWarning();

        if (!permissionGranted) {
            if (!fromUserGesture) {
                phase = 'permission_pending';
                indicatorLabel = 'Activa el micrófono desde Voz y escucha para decir «Hi Gunter».';
                notifyState();
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

        // SpeechRecognition owns the microphone in this mode. Starting a
        // second VAD stream would compete with it on some devices.

        try {
            recognition = new SR();
            recognition.lang = 'es-MX';
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 3;  // más alternativas = más chance de match

            recognition.onstart = () => {
                running = true;
                localProvider = false;
                mode = 'wake';
                setIndicator('wake', `Di "${cfg.wakeWord}"`);
                notifyState();
                console.log('[wake-word] 🎙 Escuchando');
            };

            recognition.onresult = (event) => {
                const last = event.results[event.results.length - 1];
                // Iterar todas las alternativas: la más larga no siempre es la
                // que SpeechRecognition transcribió correctamente como "Gunter".
                let bestText = '';
                let invocation = null;
                for (let i = 0; i < last.length; i++) {
                    const t = last[i].transcript || '';
                    if (t.length > bestText.length) bestText = t;
                    const candidate = detectInvocation(t);
                    if (candidate && (!invocation || candidate.confidence > invocation.confidence)) {
                        invocation = candidate;
                    }
                }
                if (!bestText) return;
                lastHeard = bestText;
                notifyState();

                // Barge-in: si Gunter está hablando y entra voz humana que no
                // coincide con su propio TTS, detenemos la respuesta y damos
                // prioridad inmediata al usuario.
                if (window.GunterVoice?.isSpeaking?.() && (last.isFinal || invocation || bestText.trim().split(/\s+/).length >= 3 || /^(para|detente|silencio|espera)$/i.test(bestText))) {
                    if (window.GunterVoice.isLikelyEcho?.(bestText)) return;
                    window.GunterVoice.cancel?.('barge-in');
                    try {
                        window.dispatchEvent(new CustomEvent('gunter-barge-in', {
                            detail: { transcript: bestText, invocation }
                        }));
                    } catch {}
                    const interruptedCommand = invocation?.command || bestText;
                    mode = 'query';
                    setIndicator('query', '🎤 Interrupción detectada…');
                    notifyState();
                    if (!last.isFinal) return;
                    if (interruptedCommand) handleQuery(interruptedCommand);
                    else enterQueryMode(invocation);
                    return;
                }

                if (window.__GUNTER_DEBUG_WAKE__) {
                    console.log('[wake-word]', mode, last.isFinal ? 'FINAL' : 'interim', ':', bestText);
                }

                if (mode === 'wake') {
                    // Esperar el resultado final evita ejecutar dos veces la misma
                    // orden cuando el navegador emite interim + final.
                    if (invocation && last.isFinal) {
                        enterQueryMode(invocation);
                    }
                } else if (mode === 'query' && last.isFinal) {
                    const repeatedCall = invocation || detectInvocation(bestText);
                    if (repeatedCall) {
                        if (repeatedCall.command) handleQuery(repeatedCall.command);
                        return;
                    }
                    handleQuery(bestText);
                }
            };

            recognition.onerror = (e) => {
                lastError = e.error;
                console.warn('[wake-word] error:', e.error, e.message);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    permissionGranted = false;
                    userWantsRunning = false;
                    stop();
                    setIndicator('error', 'Permiso de micrófono rechazado');
                    return;
                }
                // no-speech / aborted → no-op, onend se encarga
            };

            recognition.onend = () => {
                running = false;
                phase = 'off';
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

    function stop(options = {}) {
        if (!options.preserveIntent) userWantsRunning = false;
        if (queryTimeout) { clearTimeout(queryTimeout); queryTimeout = null; }
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        clearTimeout(localClipTimer); clearTimeout(localEndTimer);
        localUnsubscribe?.(); localUnsubscribe = null;
        try { localRecorder?.stop?.(); } catch {}
        try { localStream?.getTracks?.().forEach(track => track.stop()); } catch {}
        localRecorder = null; localStream = null;
        localProvider = false;
        localClip = []; localPreRoll = []; localSpeech = false; localBusy = false;
        window.GunterVoiceActivity?.stop?.('wake-stopped');
        if (recognition) {
            recognition.onend = null;
            recognition.onresult = null;
            recognition.onerror = null;
            try { recognition.abort(); } catch {}
        }
        recognition = null;
        running = false;
        mode = 'off';
        setIndicator('off', '');
        notifyState();
    }

    // Feedback específico según cómo fue llamado. Dentro de cada familia rota
    // frases para que tampoco repita siempre exactamente el mismo acuse.
    function pickWakeFeedback(invocation) {
        if (window.GunterWakeInvocation?.responseFor && invocation?.type) {
            const key = `gunter_wake_response_${invocation.type}`;
            let index = 0;
            try { index = Number(sessionStorage.getItem(key) || 0); } catch {}
            const response = window.GunterWakeInvocation.responseFor(invocation, { index });
            try { sessionStorage.setItem(key, String(index + 1)); } catch {}
            return response;
        }
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

    function canSpeakWakeReply(context = 'wake-word-response') {
        const cfg = getConfig();
        return cfg.responseMode === 'voice' && !!window.GunterVoice?.shouldSpeak?.(context);
    }

    function enterQueryMode(invocation = null) {
        mode = 'query';
        lastInvocation = invocation;
        const cfg = getConfig();
        setIndicator('query', '🎤 Te escucho…');
        notifyState();

        // Feedback hablado por estilo (preferimos GunterVoice → TTS humano)
        // Fase E.E5: si hay reunión activa, NO interrumpimos con feedback hablado;
        // sólo cambia el indicador visual.
        try {
            const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
            const context = meetingActive ? 'meeting' : 'wake-word-feedback';
            if (!canSpeakWakeReply(context)) {
                // Solo visual; no hablar feedback durante grabación
            } else {
                const feedback = pickWakeFeedback(invocation);
                if (window.GunterVoice?.speak) {
                    // 'wake-word-feedback' tiene límite ultra-corto (80 chars)
                    window.GunterVoice.speak(feedback, { context: 'wake-word-feedback', volume: 0.85 });
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
        const preText = invocation?.command || '';
        if (preText && preText.length > 1) {
            // Pequeño delay para no pisar el beep
            setTimeout(() => handleQuery(preText), 300);
        }

        try { ensureAssistantOpen(); } catch {}
    }

    function ensureAssistantOpen() {
        if (window.GunterCompanion?.expand) {
            window.GunterCompanion.expand();
            return;
        }
        if (!window.GunterAssistantController) return;
        if (!document.querySelector('.gn-assistant')) {
            window.GunterAssistantController.mount();
        } else {
            document.querySelector('.gn-assistant')?.classList.remove('is-collapsed');
        }
    }

    async function handleQuery(transcript) {
        window.GunterCompanion?.interrupt?.();
        if (/^(para|detente|silencio|espera)[.!]?$/i.test(String(transcript).trim())) { setIndicator('query', 'Te escucho…'); return; }
        const cfg = getConfig();
        if (queryTimeout) { clearTimeout(queryTimeout); queryTimeout = null; }
        mode = 'wake';
        setIndicator('wake', `Di "${cfg.wakeWord}"`);
        notifyState();

        const text = (transcript || '').trim();
        if (!text) return;
        phase = 'processing'; notifyState();
        console.log('[wake-word] 💬 Procesando:', text);
        window.GunterConversationState?.transition?.('thinking', { reason: 'voice-query', transcript: text });

        // One shared conversational turn for both inputs: cancellation, tools,
        // confirmations and personality must not diverge between voice and text.
        if (window.GunterCompanion?.__handleFromWake) {
            ensureAssistantOpen();
            await window.GunterCompanion.__handleFromWake(text);
            if (cfg.listeningMode === 'manual') stop();
            else if (running && phase === 'processing') { phase = 'waiting_activation'; notifyState(); }
            return;
        }

        // Fail closed: legacy fallbacks below do not preserve voice provenance
        // through every settings/action path. They must never turn STT output
        // into an implicit authorization when the guarded companion is absent.
        ensureAssistantOpen();
        window.GunterVoice?.speak?.('El chat seguro no está disponible en esta página. Abre el asistente y vuelve a intentarlo.',
            { context: 'wake-word-response' });
        return;

        const voiceDestination = resolveVoiceNavigation(text);
        if (voiceDestination) {
            const context = window.GunterVoice?.isMeetingActive?.() ? 'meeting' : 'wake-word-response';
            ensureAssistantOpen();
            if (window.GunterCompanion?.say) window.GunterCompanion.say(`Abriendo ${voiceDestination.label}.`, { voiceContext: context, wakeWordResponse: true });
            window.location.assign(voiceDestination.href);
            return;
        }

        // Mantén idéntica la prioridad del chat de texto: settings y navegación
        // no deben quedar ocultos por el dispatcher legado de flags/features.
        const earlyIntent = window.GunterAssistantTools?.detect?.(text);
        if (/\b(personalidad|estilo de voz|modo de personalidad|intensidad|ponte|comportamiento)\b/i.test(text) && window.GunterCompanion?.__handleFromWake) {
            await window.GunterCompanion.__handleFromWake(text);
            return;
        }
        if (earlyIntent && ['app.navigate', 'preferences.update', 'desktop.permissions.update', 'settings.list', 'settings.update'].includes(earlyIntent.toolId)) {
            try {
                const result = await window.GunterAssistantTools.dispatch(text);
                if (result?.handled) {
                    const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
                    const context = meetingActive ? 'meeting' : 'wake-word-response';
                    ensureAssistantOpen();
                    if (window.GunterCompanion?.say) window.GunterCompanion.say(result.reply, { voiceContext: context, wakeWordResponse: true });
                    else if (canSpeakWakeReply(context)) window.GunterVoice?.speak?.(result.reply, { context });
                    return;
                }
            } catch (error) { console.warn('[wake-word] priority settings error:', error); }
        }

        // La misma matriz de ajustes conversacionales que usa el chat aplica
        // también a la ruta de voz del pipeline en Inicio.
        if (window.GunterActions?.dispatch) {
            try {
                const action = await window.GunterActions.dispatch(text);
                if (action?.reply) {
                    const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
                    const context = meetingActive ? 'meeting' : 'wake-word-response';
                    ensureAssistantOpen();
                    if (window.GunterCompanion?.say) {
                        window.GunterCompanion.say(action.reply, { voiceContext: context, wakeWordResponse: true });
                    } else if (canSpeakWakeReply(context)) {
                        window.GunterVoice?.speak?.(action.reply, { context });
                    }
                    return;
                }
            } catch (error) {
                console.warn('[wake-word] settings action error:', error);
            }
        }

        // Herramientas locales allowlist: agenda, tareas y eventos. Esta ruta
        // conserva confirmaciones entre turnos y verifica la persistencia real.
        if (window.GunterAssistantTools?.dispatch) {
            try {
                const toolResult = await window.GunterAssistantTools.dispatch(text);
                if (toolResult?.handled) {
                    const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
                    const speechContext = meetingActive ? 'meeting' : 'wake-word-response';
                    ensureAssistantOpen();
                    if (window.GunterCompanion?.say) {
                        window.GunterCompanion.say(toolResult.reply, { voiceContext: speechContext, wakeWordResponse: true });
                    } else if (canSpeakWakeReply(speechContext)) {
                        window.GunterVoice?.speak?.(toolResult.reply, { context: speechContext });
                    }
                    return;
                }
            } catch (error) {
                console.error('[wake-word] assistant tool error:', error);
            }
        }

        const clarification = window.GunterAssistantTools?.clarifyRequest?.(text);
        if (clarification) {
            const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
            const speechContext = meetingActive ? 'meeting' : 'wake-word-response';
            ensureAssistantOpen();
            if (window.GunterCompanion?.say) {
                window.GunterCompanion.say(clarification.reply, { voiceContext: speechContext, wakeWordResponse: true });
            } else if (canSpeakWakeReply(speechContext)) {
                window.GunterVoice?.speak?.(clarification.reply, { context: speechContext });
            }
            return;
        }

        // Fecha/hora nunca se delegan al LLM: salen del reloj y timezone reales.
        const temporal = window.GunterTemporalContext?.answer?.(text, {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language || 'es-CO'
        });
        if (temporal) {
            const meetingActive = !!window.GunterVoice?.isMeetingActive?.();
            const speechContext = meetingActive ? 'meeting' : 'wake-word-response';
            ensureAssistantOpen();
            if (window.GunterCompanion?.say) {
                window.GunterCompanion.say(temporal.reply, { voiceContext: speechContext, wakeWordResponse: true });
            } else if (canSpeakWakeReply(speechContext)) {
                window.GunterVoice?.speak?.(temporal.reply, { context: speechContext });
            }
            return;
        }

        // v2 (F1) — registrar lo dicho al wake en LTM (canal 'wake')
        if (window.PremiumFeaturesService?.isEnabled?.('conversationMemory') && window.GunterConversationMemory?.remember &&
            window.GunterPersonalMemory?.parseCommand?.(text)?.action !== 'save') {
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

        // Path 1: Pipeline completo (day.html)
        if (window.GunterPipeline?.handleUserInput) {
            try {
                const result = await window.GunterPipeline.handleUserInput(text);
                const reply = result?.response?.speech || 'Listo.';
                ensureAssistantOpen();
                if (window.GunterCompanion?.say) {
                    window.GunterCompanion.say(reply, { voiceContext: speechContext, wakeWordResponse: true });
                } else if (canSpeakWakeReply(speechContext)) {
                    window.GunterVoice?.speak?.(reply, { context: speechContext });
                }
                return;
            } catch (e) {
                console.error('[wake-word] pipeline error:', e);
            }
        }

        // Path 2: Fallback universal — usa el companion en cualquier página.
        // Así "Hi Gunter" funciona en dashboard, results, config, etc.
        if (window.GunterCompanion) {
            try {
                window.GunterCompanion.expand?.();
                // Feed el texto como si el usuario lo hubiera escrito
                if (window.GunterCompanion.__handleFromWake) {
                    window.GunterCompanion.__handleFromWake(text);
                } else {
                    // Fallback: escribir en el input y submit
                    const input = document.getElementById('gn-comp-input');
                    const form = document.getElementById('gn-comp-form');
                    if (input && form) {
                        input.value = text;
                        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    }
                }
            } catch (e) {
                console.error('[wake-word] companion route error:', e);
            }
        }
    }

    function resolveVoiceNavigation(text) {
        const normalized = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^(?:(?:hi|hey|hola|oye)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/, '').trim();
        if (!/^(?:ve a|ir a|lleva(?:me)? a|abre|abrir|navega(?:r)? a|entra a|muestrame)\b/.test(normalized)) return null;
        const routes = [
            { label: 'las opciones avanzadas', href: 'config.html#premium', aliases: ['opciones avanzadas', 'ajustes avanzados', 'configuracion avanzada', 'asistente ia', 'configuracion de voz'] },
            { label: 'Conversaciones', href: 'day.html#conversations', aliases: ['conversaciones', 'mensajes', 'chats', 'bandeja'] },
            { label: 'Nueva reunión', href: 'new-project.html', aliases: ['nueva reunion', 'preparar reunion'] },
            { label: 'Reuniones', href: 'dashboard.html', aliases: ['reuniones', 'reunion', 'panel de reuniones'] },
            { label: 'Resultados', href: 'results.html', aliases: ['resultados', 'transcripciones'] },
            { label: 'Captura rápida', href: 'day.html#capture', aliases: ['captura rapida', 'captura'] },
            { label: 'Tareas', href: 'day.html#tasks', aliases: ['tareas', 'pendientes'] },
            { label: 'Agenda', href: 'day.html#events', aliases: ['agenda', 'calendario', 'eventos'] },
            { label: 'Recordatorios', href: 'day.html#reminders', aliases: ['recordatorios'] },
            { label: 'Actividad', href: 'day.html#activity', aliases: ['actividad', 'historial'] },
            { label: 'Conexiones', href: 'config.html#connections', aliases: ['conexiones', 'redes sociales'] },
            { label: 'Preferencias', href: 'config.html#preferences', aliases: ['preferencias'] },
            { label: 'Configuración', href: 'config.html#preferences', aliases: ['configuracion', 'ajustes'] },
            { label: 'Inicio', href: 'day.html', aliases: ['inicio', 'principal', 'hoy'] }
        ];
        const target = normalized.replace(/^(?:ve a|ir a|lleva(?:me)? a|abre|abrir|navega(?:r)? a|entra a|muestrame)\s+/, '').trim();
        const matches = routes.flatMap(route => route.aliases.map(alias => ({ route, alias })).sort((a, b) => b.alias.length - a.alias.length));
        return matches.find(({ alias }) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(target))?.route || null;
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
            active: running && (localProvider ? !!localStream && localRecorder?.state === 'recording' : !!recognition),
            mode,
            phase,
            label: indicatorLabel,
            provider: localProvider ? 'moonshine.local' : SR ? 'browser.speech-recognition' : 'none',
            supported: !!(SR || localCaptureSupported),
            permission: permissionGranted ? 'granted' : phase === 'error' ? 'error' : 'pending',
            error: lastError,
            lastHeard,
            lastInvocation
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
        } else if (cfg.enabled && !permissionGranted && !running) {
            phase = 'permission_pending'; notifyState();
        }
    }

    function suspendForCapture() {
        // PTT debe ser el único dueño del micrófono, también cuando la
        // activación usa SpeechRecognition en vez de Moonshine local.
        suspendedForCapture = running;
        if (suspendedForCapture) stop();
    }

    function resumeAfterCapture() {
        if (!suspendedForCapture) return;
        suspendedForCapture = false;
        if (getConfig().enabled && permissionGranted) start();
    }

    // Toggle debug mode with ?debug=wake
    if (location.search.includes('debug=wake')) {
        window.__GUNTER_DEBUG_WAKE__ = true;
        console.log('[wake-word] DEBUG MODE ACTIVE');
    }

    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        if (e.detail?.key === 'wakeWordEnabled' || e.detail?.key === null) refresh();
    });
    window.addEventListener('gunter-hybrid-state', event => {
        const hybrid = event.detail || {};
        if (hybrid.loaded !== true || (running && localProvider !== (hybrid.mode === 'LOCAL' || hybrid.privacy === 'LOCAL_ONLY'))) stop();
    });

    window.addEventListener('gunter-voice-state', event => {
        if (!running) return;
        if (event.detail?.state === 'speaking') { phase = 'responding'; notifyState(); }
        else if (event.detail?.state === 'idle' && phase === 'responding') {
            phase = mode === 'query' ? 'recording' : 'waiting_activation'; notifyState();
        }
    });

    window.addEventListener('gunter-vad-state', event => {
        if (mode !== 'query') return;
        if (event.detail?.activity === 'speech') setIndicator('query', '🎤 Te oigo…');
        else if (event.detail?.reason === 'speech-ended') setIndicator('query', '🎤 Procesando voz…');
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
        suspendForCapture,
        resumeAfterCapture,
        getState,
        getLastHeard,
        onStateChange,
        humanError       // Fase E.E8 — códigos de error con mensajes humanos
    };
})();
