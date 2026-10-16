/* =============================================
   GUNTER SERVICE - Voice v2 (Humanized TTS)
   -------------------------------------------------
   Motor preferido: Supertonic 3 M1 local (si está instalado).
   Fallback en AUTO/CLOUD: proveedor anterior y voz del navegador.

   Cada voiceStyle mapea a una voz OpenAI + ajustes
   de velocidad para emular la personalidad:

     professional      → alloy  (neutral, ejecutiva)
     warm              → nova   (cálida, cercana)
     chaotic_scientist → onyx   (grave, áspera)
     energetic_cartoon → shimmer (brillante, alegre)
     minimal_penguin   → echo   (seca, breve)
     executive         → alloy  (clara, profesional)
     focus_coach       → fable  (firme, motivadora)
   ============================================= */

(function () {
    const STYLE_VOICE = {
        professional:      { voice: 'alloy',   speed: 1.00 },
        warm:              { voice: 'nova',    speed: 0.96 },
        chaotic_scientist: { voice: 'onyx',    speed: 1.15 },
        energetic_cartoon: { voice: 'shimmer', speed: 1.18 },
        minimal_penguin:   { voice: 'echo',    speed: 0.92 },
        executive:         { voice: 'alloy',   speed: 0.98 },
        focus_coach:       { voice: 'fable',   speed: 0.94 }
    };
    const SPEED_MULT = { slow: 0.85, normal: 1.0, fast: 1.15 };

    // Cache de audio blobs por texto+voz para evitar re-generar lo mismo
    const audioCache = new Map();
    const MAX_CACHE = 30;
    // The existing local server allows 6s warm-up + 12s synthesis. A 5s
    // browser abort killed valid local work before that bounded server reply.
    const LOCAL_TTS_DEADLINE_MS = 20000;
    const LEGACY_TTS_DEADLINE_MS = 5000;
    const LOCAL_TTS_CODES = new Set(['LOCAL_TTS_NOT_INSTALLED', 'LOCAL_TTS_UNAVAILABLE', 'LOCAL_TTS_BUSY',
        'LOCAL_TTS_INVALID_TEXT', 'LOCAL_TTS_INVALID_SPEED', 'LOCAL_TTS_TIMEOUT']);

    // Queue de reproducción
    let queue = [];
    let currentAudio = null;
    let currentAudioUrl = null;
    let currentUtterance = null;
    let speaking = false;
    let lastSpokenText = '';
    let speechStartedAt = 0;
    const recentSpeech = [];
    const ECHO_TAIL_MS = 12000;
    function rememberAudibleText(text) {
        const at = Date.now();
        recentSpeech.push({ text, at, owner: window.GunterAuth?.getUser?.()?.id });
        while (recentSpeech.length > 8 || (recentSpeech[0] && at - recentSpeech[0].at > ECHO_TAIL_MS)) recentSpeech.shift();
    }
    let generation = 0;
    let synthesisController = null;
    let prefetched = null;
    let warnedFallback = false;
    let fallbackPlaying = false;
    let audioAnalysisEnabled = false;
    let analysisContext = null;
    let playbackAnalysis = null;
    let audioBuffering = false;
    let playbackContext = 'chat';
    let playbackError = null;
    let lastLocalSynthesisCancellationAt = 0;
    let audioSignal = { source: 'assistant', level: 0, active: false, available: false, at: Date.now() };

    // Optional visual metering. It never decodes a second audio file or opens a
    // microphone. A running context is primed only by a real user gesture.
    function emitAudioLevel(level = 0, active = false, available = false, reason = '') {
        audioSignal = { source: 'assistant', level: Math.max(0, Math.min(1, Number(level) || 0)), active, available, reason, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent('gunter-audio-level', { detail: audioSignal })); } catch {}
    }

    function hasAnalysisSignal(record) {
        if (!record?.analyser || record.failed || record.context.state !== 'running') return false;
        return !record.stream || (record.stream.active !== false &&
            record.stream.getAudioTracks?.().some(track => track.readyState !== 'ended'));
    }

    function pauseAudioAnalysis(reason = 'paused') {
        if (playbackAnalysis?.frame) window.cancelAnimationFrame?.(playbackAnalysis.frame);
        if (playbackAnalysis) playbackAnalysis.frame = 0;
        if (audioAnalysisEnabled || audioSignal.active) emitAudioLevel(0, false, hasAnalysisSignal(playbackAnalysis), reason);
    }

    function releaseAudioAnalysis(reason = 'stopped') {
        pauseAudioAnalysis(reason);
        const record = playbackAnalysis;
        playbackAnalysis = null;
        record?.removeStreamListeners?.();
        try { record?.source?.disconnect(); } catch {}
        try { record?.analyser?.disconnect(); } catch {}
        try { record?.stream?.getTracks?.().forEach(track => track.stop()); } catch {}
        if (audioAnalysisEnabled) emitAudioLevel(0, false, false, reason);
    }

    function failAudioAnalysis(record, reason) {
        if (record !== playbackAnalysis) return;
        record.failed = true;
        // A captured stream is only a tap. A routed element must keep its
        // existing audible graph even when optional sample reads fail.
        if (record.stream) releaseAudioAnalysis(reason);
        else pauseAudioAnalysis(reason);
    }

    function restartCurrentAudioAnalysis() {
        if (audioAnalysisEnabled && currentAudio && !currentAudio.paused && !currentAudio.ended && !audioBuffering) {
            startAudioAnalysis(currentAudio, generation);
        }
    }

    function primeAudioAnalysis() {
        if (!audioAnalysisEnabled) return;
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) { emitAudioLevel(0, false, false, 'web-audio-unavailable'); return; }
        try {
            if (!analysisContext) {
                analysisContext = new AudioContextCtor();
                analysisContext.addEventListener?.('statechange', () => {
                    if (!audioAnalysisEnabled) return;
                    if (analysisContext.state === 'running') restartCurrentAudioAnalysis();
                    else pauseAudioAnalysis('context-suspended');
                });
            }
            if (analysisContext.state === 'running') restartCurrentAudioAnalysis();
            else if (analysisContext.state !== 'closed') {
                const context = analysisContext;
                Promise.resolve(context.resume()).then(() => {
                    if (analysisContext === context) restartCurrentAudioAnalysis();
                }).catch(() => { if (audioAnalysisEnabled) pauseAudioAnalysis('context-suspended'); });
            } else emitAudioLevel(0, false, false, 'context-closed');
        } catch { emitAudioLevel(0, false, false, 'web-audio-unavailable'); }
    }

    function createPlaybackAnalysis(audio, token, capture = false) {
        if (!audioAnalysisEnabled || analysisContext?.state !== 'running') return null;
        const record = { audio, token, context: analysisContext, frame: 0, lastFrame: -Infinity, source: null, analyser: null, stream: null };
        try {
            record.analyser = analysisContext.createAnalyser();
            record.analyser.fftSize = 1024;
            record.samples = new Float32Array(record.analyser.fftSize);
            if (capture) {
                const captureStream = audio.captureStream || audio.mozCaptureStream;
                if (!captureStream) { record.analyser.disconnect(); return null; }
                record.stream = captureStream.call(audio);
                const tracks = record.stream.getAudioTracks?.() || [];
                if (record.stream.active === false || !tracks.some(track => track.readyState !== 'ended')) {
                    record.stream.getTracks?.().forEach(track => track.stop());
                    record.analyser.disconnect();
                    return null;
                }
                record.source = analysisContext.createMediaStreamSource(record.stream);
                record.source.connect(record.analyser); // Tap only: the element still owns playback.
                const ended = () => failAudioAnalysis(record, 'signal-ended');
                tracks.forEach(track => track.addEventListener?.('ended', ended));
                record.stream.addEventListener?.('inactive', ended);
                record.removeStreamListeners = () => {
                    tracks.forEach(track => track.removeEventListener?.('ended', ended));
                    record.stream.removeEventListener?.('inactive', ended);
                };
            } else {
                record.source = analysisContext.createMediaElementSource(audio);
                record.source.connect(record.analyser);
                record.analyser.connect(analysisContext.destination); // Exactly one audible route.
            }
            playbackAnalysis = record;
            return record;
        } catch {
            // If an element was already routed, preserve its sound even if the
            // optional analyser could not be connected. Never retry that node.
            if (!capture && record.source) {
                try { record.source.disconnect(); record.source.connect(analysisContext.destination); } catch {}
                record.analyser = null;
                playbackAnalysis = record;
            } else {
                try { record.source?.disconnect(); } catch {}
                try { record.analyser?.disconnect(); } catch {}
                try { record.stream?.getTracks?.().forEach(track => track.stop()); } catch {}
            }
            return null;
        }
    }

    function startAudioAnalysis(audio, token) {
        if (!audioAnalysisEnabled || token !== generation || currentAudio !== audio || audio.paused || audio.ended || audioBuffering) return;
        const record = playbackAnalysis || createPlaybackAnalysis(audio, token, true);
        if (!hasAnalysisSignal(record) || !window.requestAnimationFrame) {
            emitAudioLevel(0, false, false, 'signal-unavailable'); return;
        }
        if (record.frame) return;
        const sample = now => {
            record.frame = 0;
            if (record !== playbackAnalysis || token !== generation) return;
            if (!audioAnalysisEnabled || audio.paused || audio.ended || audioBuffering) {
                if (audio.ended) releaseAudioAnalysis('ended');
                else pauseAudioAnalysis(audioBuffering ? 'buffering' : 'paused');
                return;
            }
            if (!hasAnalysisSignal(record)) {
                if (record.context.state !== 'running') pauseAudioAnalysis('context-suspended');
                else failAudioAnalysis(record, 'signal-ended');
                return;
            }
            if (now - record.lastFrame >= 1000 / 30) {
                record.lastFrame = now;
                try {
                    record.analyser.getFloatTimeDomainData(record.samples);
                    let sum = 0;
                    for (let i = 0; i < record.samples.length; i++) sum += record.samples[i] * record.samples[i];
                    if (!Number.isFinite(sum)) { failAudioAnalysis(record, 'invalid-samples'); return; }
                    // MediaElementSource already reflects the element's gain.
                    // captureStream taps pre-output samples, so apply its gain once.
                    const gain = audio.muted ? 0 : record.stream ? audio.volume : 1;
                    const level = Math.sqrt(sum / record.samples.length) * gain;
                    emitAudioLevel(level, true, true);
                } catch { failAudioAnalysis(record, 'sampling-failed'); return; }
            }
            record.frame = window.requestAnimationFrame(sample);
        };
        record.frame = window.requestAnimationFrame(sample);
    }

    function setAudioAnalysisEnabled(enabled) {
        enabled = !!enabled;
        if (enabled === audioAnalysisEnabled) return;
        audioAnalysisEnabled = enabled;
        for (const type of ['pointerdown', 'keydown']) {
            if (enabled) window.addEventListener(type, primeAudioAnalysis, { capture: true, passive: true });
            else window.removeEventListener?.(type, primeAudioAnalysis, true);
        }
        if (!enabled) {
            if (playbackAnalysis?.stream) releaseAudioAnalysis('disabled');
            else pauseAudioAnalysis('disabled');
            emitAudioLevel(0, false, false, 'disabled');
        }
        else if (currentAudio && !currentAudio.paused && !currentAudio.ended && !audioBuffering) startAudioAnalysis(currentAudio, generation);
        else emitAudioLevel(0, false, false, 'idle');
    }

    function voiceMetric(name, detail = {}) {
        try { window.dispatchEvent(new CustomEvent('gunter-voice-metric', {
            detail: { name, at: performance.now(), ...detail }
        })); } catch { /* optional telemetry */ }
    }

    function notifyVoiceState(state, detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('gunter-voice-state', {
                detail: { state, speaking, context: playbackContext, text: lastSpokenText, startedAt: speechStartedAt, ...detail }
            }));
        } catch { /* entorno sin CustomEvent */ }
    }

    function failPlayback(code, message) {
        // A failed answer remains available as text. Do not retry every queued
        // segment or silently choose a different provider in local mode.
        cancel('voice-unavailable');
        playbackError = { code, message, at: Date.now() };
        notifyVoiceState('unavailable', { ...playbackError });
    }

    // ---------- Detector global de reunión activa (Fase E.E2) ----------
    // Cualquier código puede marcar/desmarcar:
    //   GunterVoice.setMeetingActive(true)  / .setMeetingActive(false)
    // Esto es la fuente de verdad. Si está activo, shouldSpeak considera
    // implícitamente que el contexto es 'meeting' aunque el caller no lo declare.
    let _meetingActive = false;
    function setMeetingActive(active) {
        _meetingActive = !!active;
        if (_meetingActive && !shouldSpeak(playbackContext)) cancel('meeting-voice-disabled');
        try { window.dispatchEvent(new CustomEvent('gunter-voice-meeting-state', { detail: { meetingActive: _meetingActive } })); } catch {}
    }
    function isMeetingActive() {
        return _meetingActive;
    }

    // ---------- Filter: should we speak in this context? ----------
    function shouldSpeak(context = 'chat') {
        const service = window.PremiumFeaturesService;
        const cfg = service?.getVoiceConfig?.();
        if (!cfg) return false;
        if (context === 'entry' && service.isEnabled?.('entryVoiceGreeting') === false) return false;
        if (!cfg.enabled) return false;

        const fromWakeWord = ['wake', 'wake-word-response', 'wake-word-feedback'].includes(context);
        const wakeResponseMode = cfg.wakeWordResponseMode ?? service.getWakeWordConfig?.()?.responseMode;
        if (fromWakeWord && wakeResponseMode === 'text') return false;

        // Fase E.E2: si hay reunión activa, ELEVAR el contexto a 'meeting'
        // automáticamente (caller puede no saberlo). Excepción: notification
        // siempre debe poder sonar (recordatorios urgentes).
        const effectiveContext = (_meetingActive && context !== 'notification') ? 'meeting' : context;
        if (effectiveContext === 'meeting' && !cfg.inMeetings) return false;
        // The settings preview is an explicit listening request, independent
        // of which conversation channels may reply aloud.
        if (context === 'voice-preview') return cfg.mode !== 'text_only';
        if (cfg.onlyAfterWakeWord && !fromWakeWord && effectiveContext !== 'notification') return false;

        switch (cfg.mode) {
            case 'text_only':          return false;
            case 'notifications_only': return effectiveContext === 'notification';
            case 'wake_word_only':     return fromWakeWord || effectiveContext === 'meeting' && cfg.inMeetings;
            case 'live_voice':        return true;
            default: return true;
        }
    }

    function getStyleConfig() {
        const cfg = window.PremiumFeaturesService?.getVoiceConfig?.() || {
            style: 'professional', speed: 'normal', tone: 'neutral'
        };
        const baseSv = STYLE_VOICE[cfg.style] || STYLE_VOICE.professional;
        const speedMult = SPEED_MULT[cfg.speed] ?? 1;
        // Clamp 0.25–4.0 per OpenAI TTS spec
        const speed = Math.max(0.25, Math.min(4.0, baseSv.speed * speedMult));
        return {
            style: cfg.style,
            voice: baseSv.voice,
            speed,
            localSpeed: { slow: 0.9, normal: 1.05, fast: 1.2 }[cfg.speed] || 1.05,
            mode: cfg.mode
        };
    }

    // ---------- Preferred TTS endpoint (server routes local before cloud) ----------
    async function synthesizeTts(text, { voice, speed, localSpeed }, signal) {
        const hybrid = window.GunterRuntimeState?.getState?.();
        const cacheKey = `${hybrid?.mode || 'AUTO'}:${hybrid?.privacy || 'STANDARD'}:${hybrid?.localTTSAvailable ? 'local' : 'legacy'}:${localSpeed}:${text}`;
        if (audioCache.has(cacheKey)) {
            return audioCache.get(cacheKey);
        }
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({ text, voice, speed, localSpeed, model: 'tts-1-hd' })
        });
        if (!resp.ok) {
            let code;
            try {
                const data = await (resp.clone ? resp.clone() : resp).json();
                if (LOCAL_TTS_CODES.has(data?.code)) code = data.code;
            } catch { /* Generic HTTP failures never expose raw response text. */ }
            throw Object.assign(new Error(code || `TTS HTTP ${resp.status}`), { ...(code ? { code } : {}), status: resp.status });
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        // Never replay a cloud voice from cache after switching to local mode.
        if (resp.headers?.get?.('X-Gunter-TTS-Provider') === 'supertonic3.local') {
            if (audioCache.size >= MAX_CACHE) {
                const firstKey = audioCache.keys().next().value;
                const firstUrl = audioCache.get(firstKey);
                URL.revokeObjectURL(firstUrl);
                audioCache.delete(firstKey);
            }
            audioCache.set(cacheKey, url);
        }
        return url;
    }

    // ---------- Fallback: speechSynthesis ----------
    // Prioridad: voces latinoamericanas (MX/CO/419/US-es) > resto del español.
    function pickLatinVoice(voices) {
        const isLatin   = (v) => /^es-(MX|CO|AR|CL|PE|VE|UY|EC|GT|US|419)/i.test(v.lang || '');
        const isQuality = (v) => /google|microsoft|premium|enhanced|hd|natural|neural/i.test(v.name || '');
        return (
            voices.find(v => isLatin(v) && isQuality(v)) ||
            voices.find(v => isLatin(v)) ||
            voices.find(v => v.lang?.startsWith('es') && isQuality(v)) ||
            voices.find(v => v.lang?.startsWith('es'))
        );
    }

    function speakFallback(text, sv, token = generation) {
        if (token !== generation) return;
        if (audioAnalysisEnabled) emitAudioLevel(0, false, false, 'browser-synthesis-signal-unavailable');
        if (!('speechSynthesis' in window)) {
            failPlayback('BROWSER_TTS_UNAVAILABLE', 'La voz del navegador no está disponible. La respuesta sigue escrita en pantalla.');
            return;
        }
        const u = new SpeechSynthesisUtterance(String(text).slice(0, 800));
        u.lang = 'es-MX';
        u.rate = sv.speed;
        const voices = speechSynthesis.getVoices() || [];
        const preferred = pickLatinVoice(voices);
        if (preferred) {
            u.voice = preferred;
            u.lang = preferred.lang || 'es-MX';
        }
        currentUtterance = u;
        u.onstart = () => { if (token === generation) { rememberAudibleText(text); fallbackPlaying = true; notifyVoiceState('speaking'); } };
        u.onend = () => {
            if (token !== generation) return;
            currentUtterance = null;
            fallbackPlaying = false;
            speaking = false;
            processQueue();
        };
        u.onerror = event => {
            if (token !== generation) return;
            const blocked = event?.error === 'not-allowed';
            failPlayback(blocked ? 'VOICE_PLAYBACK_BLOCKED' : 'BROWSER_TTS_FAILED', blocked
                ? 'El navegador bloqueó el audio. Pulsa Probar voz para volver a intentarlo.'
                : 'No pude reproducir la voz del navegador. La respuesta sigue escrita en pantalla.');
        };
        try { speechSynthesis.speak(u); }
        catch { failPlayback('BROWSER_TTS_FAILED', 'No pude reproducir la voz del navegador. La respuesta sigue escrita en pantalla.'); }
    }

    function releaseAudioUrl(url) {
        if (url && ![...audioCache.values()].includes(url)) URL.revokeObjectURL(url);
    }

    // Short utterances keep the first answer conversational. Later segments are
    // generated while the current one plays, without changing Gunter's M1 voice.
    function splitForPlayback(text) {
        const parts = [];
        let current = '';
        for (const word of String(text).split(/\s+/).filter(Boolean)) {
            const joined = current ? `${current} ${word}` : word;
            if (current && joined.length > 90) { parts.push(current); current = word; }
            else current = joined;
            if (current.length >= 40 && /[.!?…]["'»]?$/u.test(word)) {
                parts.push(current); current = '';
            }
        }
        if (current) parts.push(current);
        return parts;
    }

    function configuredLocalTts() {
        const state = window.GunterRuntimeState?.getState?.() || {};
        return state.privacy === 'LOCAL_ONLY' || state.mode === 'LOCAL' || state.localTTSAvailable === true || state.flags?.['tts.local'] === true;
    }

    function waitForLocalCancellation(signal) {
        return new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('TTS cancelled'), { name: 'AbortError' })); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 350);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        });
    }

    // One request lifecycle for playback and prefetch. A BUSY response may be
    // retried once only when this page just cancelled its own local synthesis.
    function prepareTts(item, claimed = false) {
        const controller = new AbortController(), token = generation;
        const entry = { item, controller, claimed, localRequested: configuredLocalTts(), settled: false, timedOut: false, promise: null };
        controller.signal.addEventListener('abort', () => {
            if (entry.localRequested && !entry.settled && !entry.timedOut) lastLocalSynthesisCancellationAt = Date.now();
        }, { once: true });
        const deadline = setTimeout(() => { entry.timedOut = true; controller.abort(); }, entry.localRequested ? LOCAL_TTS_DEADLINE_MS : LEGACY_TTS_DEADLINE_MS);
        entry.promise = (async () => {
            try { return await synthesizeTts(item.text, item.sv, controller.signal); }
            catch (error) {
                const cancellationRace = lastLocalSynthesisCancellationAt > 0 && Date.now() - lastLocalSynthesisCancellationAt <= 5000;
                if (error.code !== 'LOCAL_TTS_BUSY' || !cancellationRace || controller.signal.aborted || token !== generation || !shouldSpeak(item.opts.context || 'chat')) throw error;
                await waitForLocalCancellation(controller.signal);
                if (token !== generation || !shouldSpeak(item.opts.context || 'chat') || controller.signal.aborted) throw error;
                return synthesizeTts(item.text, item.sv, controller.signal);
            }
        })().then(url => {
            if (token !== generation || (!entry.claimed && prefetched !== entry)) releaseAudioUrl(url);
            return { url };
        }).catch(error => ({ error: entry.timedOut
            ? Object.assign(new Error(entry.localRequested ? 'LOCAL_TTS_TIMEOUT' : 'TTS_TIMEOUT'), { code: entry.localRequested ? 'LOCAL_TTS_TIMEOUT' : 'TTS_TIMEOUT' })
            : error })).finally(() => { entry.settled = true; clearTimeout(deadline); });
        return entry;
    }

    function prefetchNext() {
        if (!queue.length || prefetched) return;
        const item = queue[0];
        if (!shouldSpeak(item.opts.context || 'chat')) return;
        prefetched = prepareTts(item);
    }

    // ---------- Speak ----------
    // Fase E.E3 — Truncation context-aware:
    //   meeting       → 220 chars  (no leer transcripciones largas)
    //   notification  → 160 chars  (recordatorios concisos)
    //   wake-word-response / wake-word-feedback → 80 chars (acks brevísimos)
    //   chat / day    → 350 chars  (default)
    const MAX_CHARS_BY_CONTEXT = {
        'meeting':              220,
        'notification':         160,
        'wake-word-feedback':   80,
        'wake-word-response':   220,
        'chat':                 350,
        'day':                  350
    };

    function getMaxCharsFor(context) {
        // Si hay reunión activa, usamos siempre el límite de meeting (más estricto)
        if (_meetingActive && context !== 'notification') return MAX_CHARS_BY_CONTEXT.meeting;
        return MAX_CHARS_BY_CONTEXT[context] || MAX_CHARS_BY_CONTEXT.chat;
    }

    /**
     * Helper público — útil para callers que quieren ver el texto truncado
     * antes de hablar (ej: mostrar en pantalla la versión hablada).
     */
    function shortenForSpeech(text, context = 'chat') {
        const cleaned = stripMarkdown(text);
        const max = getMaxCharsFor(context);
        if (cleaned.length <= max) return cleaned;
        return _truncate(cleaned, max);
    }

    function _truncate(text, max) {
        const target = Math.max(80, Math.floor(max * 0.75));
        // Tomamos las primeras frases hasta llenar ~target chars
        const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [text];
        let head = '';
        for (const s of sentences) {
            if ((head + s).length > target) break;
            head += s + ' ';
        }
        head = head.trim();
        if (!head) head = text.slice(0, Math.floor(target * 0.85));
        const filler = pickFiller();
        return `${filler} ${head}`;
    }

    function pickFiller() {
        const fillers = [
            'Te dejé el resumen en pantalla. Lo más importante:',
            'Te dejé el detalle en pantalla. Esto es lo clave:',
            'Resumen rápido:',
            'Lo esencial:'
        ];
        return fillers[Math.floor(Math.random() * fillers.length)];
    }

    async function speak(text, opts = {}) {
        if (!text) return;
        const context = opts.context || 'chat';
        // Even explicit playback requests respect the user's voice, wake-word
        // and meeting preferences. All reply routes share this decision.
        if (!shouldSpeak(context)) return;
        voicePolicySnapshot = getVoicePolicySnapshot();

        // v2 (F1) — registrar respuestas habladas en la memoria conversacional cross-sesión.
        // Solo para contextos conversacionales (chat/wake), no notificaciones técnicas.
        if (window.PremiumFeaturesService?.isEnabled?.('conversationMemory') &&
            window.GunterConversationMemory?.remember && (context === 'chat' || context === 'wake')) {
            try {
                window.GunterConversationMemory.remember({
                    role: 'assistant',
                    text,
                    channel: 'voice',
                    projectId: window.GunterCurrentProject?.id || null
                }).catch(() => {});
            } catch { /* noop */ }
        }

        const sv = getStyleConfig();
        let stripped = stripMarkdown(text);

        // Conversation replies must include the complete answer, regardless of
        // whether they arrive at once or through beginStream(). Short summaries
        // remain available for meeting excerpts and explicit summary callers.
        const conversational = ['chat', 'day', 'wake', 'wake-word-response'].includes(context);
        const skipTruncation = opts.full === true || (opts.summary !== true && (conversational || context === 'notification'));
        if (!skipTruncation) {
            const max = getMaxCharsFor(context);
            if (stripped.length > max) stripped = _truncate(stripped, max);
        }

        if (!stripped) return;
        playbackError = null;
        for (const part of splitForPlayback(stripped)) queue.push({ text: part, sv, opts });
        if (!speaking) processQueue();
    }

    // Feed complete words from a streaming LLM into the existing ordered audio
    // queue. A punctuation boundary wins; if none arrives, use a word boundary
    // before 120 characters. No artificial acknowledgement is inserted.
    function beginStream(opts = {}) {
        const token = generation;
        const context = opts.context || 'chat';
        const enabled = shouldSpeak(context);
        if (enabled) voicePolicySnapshot = getVoicePolicySnapshot();
        const sv = getStyleConfig();
        let pending = '';
        let closed = false;
        function enqueue(text) {
            const cleaned = stripMarkdown(text);
            if (!cleaned || token !== generation || !enabled || !shouldSpeak(context)) return;
            playbackError = null;
            for (const part of splitForPlayback(cleaned)) queue.push({ text: part, sv, opts });
            if (!speaking) processQueue();
        }
        function drain(force = false) {
            while (pending) {
                const max = Math.min(pending.length, 120);
                const sample = pending.slice(0, max);
                const candidates = [...sample.matchAll(/[.!?;:,](?=\s|$)/g)]
                    .map(match => match.index + 1).filter(index => index >= 30);
                let end = candidates.length ? candidates[0] : 0;
                if (!end && pending.length >= 120) end = sample.lastIndexOf(' ', 119);
                if (!end && force) end = pending.length;
                if (!end) break;
                const part = pending.slice(0, end).trim();
                pending = pending.slice(end).trimStart();
                if (part) {
                    voiceMetric('firstSpeakable', { chars: part.length });
                    enqueue(part);
                }
            }
        }
        return {
            append(delta) {
                if (closed || token !== generation || !enabled || !shouldSpeak(context)) return;
                pending += String(delta || '');
                drain();
            },
            finish() {
                if (closed || token !== generation) return;
                closed = true;
                drain(true);
            },
            cancel() { closed = true; pending = ''; },
            get enabled() { return !!enabled; }
        };
    }

    async function processQueue() {
        const next = queue.shift();
        if (!next) {
            speaking = false;
            notifyVoiceState('idle', { reason: 'queue-empty' });
            return;
        }
        if (!shouldSpeak(next.opts.context || 'chat')) {
            if (prefetched?.item === next) {
                prefetched.controller.abort();
                prefetched = null;
            }
            return processQueue();
        }
        speaking = true;
        playbackContext = next.opts.context || 'chat';
        const token = generation;
        lastSpokenText = next.text;
        speechStartedAt = Date.now();
        notifyVoiceState('preparing', { context: next.opts.context || 'chat' });

        // A state listener can synchronously mute or interrupt the answer.
        // Do not start a new fetch after that cancellation.
        if (token !== generation) return;
        if (!shouldSpeak(next.opts.context || 'chat')) { speaking = false; return processQueue(); }

        const ready = prefetched?.item === next ? prefetched : null;
        if (ready) { ready.claimed = true; prefetched = null; }
        const request = ready || prepareTts(next, true);
        const controller = request.controller;
        synthesisController = controller;

        try {
            if (token !== generation) return;
            voiceMetric('ttsStart', { chars: next.text.length });
            const prepared = await request.promise;
            if (prepared.error) throw prepared.error;
            const url = prepared.url;
            if (token !== generation) { releaseAudioUrl(url); return; }
            if (!shouldSpeak(next.opts.context || 'chat')) {
                releaseAudioUrl(url);
                speaking = false;
                processQueue();
                return;
            }
            voiceMetric('audioReady', { chars: next.text.length });
            const audio = new Audio(url);
            audio.volume = next.opts.volume ?? 1;
            currentAudio = audio;
            currentAudioUrl = url;
            audioBuffering = false;
            // Do not reroute an element through a suspended context: that would
            // silence autoplay on mobile. In that case playback remains native.
            createPlaybackAnalysis(audio, token);
            audio.addEventListener('playing', () => {
                if (currentAudio !== audio) return;
                audioBuffering = false;
                startAudioAnalysis(audio, token);
            });
            audio.addEventListener('pause', () => { if (currentAudio === audio) pauseAudioAnalysis(); });
            audio.addEventListener('waiting', () => {
                if (currentAudio !== audio) return;
                audioBuffering = true;
                pauseAudioAnalysis('buffering');
            });
            audio.addEventListener('volumechange', () => {
                if (audioAnalysisEnabled && currentAudio === audio && (audio.muted || audio.volume === 0)) {
                    emitAudioLevel(0, false, hasAnalysisSignal(playbackAnalysis), 'muted');
                }
            });
            audio.addEventListener('playing', () => {
                if (token === generation) voiceMetric('playbackStart', { chars: next.text.length });
            }, { once: true });
            audio.onended = () => {
                if (token !== generation) return;
                releaseAudioAnalysis('ended');
                currentAudio = null;
                currentAudioUrl = null;
                releaseAudioUrl(url);
                speaking = false;
                processQueue();
            };
            audio.onerror = () => {
                if (token !== generation) return;
                const hybrid = window.GunterRuntimeState?.getState?.();
                failPlayback(request.localRequested || hybrid?.privacy === 'LOCAL_ONLY' || hybrid?.mode === 'LOCAL'
                    ? 'LOCAL_TTS_PLAYBACK_FAILED' : 'VOICE_PLAYBACK_FAILED',
                'No pude reproducir el audio de la respuesta. El texto sigue disponible en pantalla.');
            };
            let played = false;
            await audio.play().then(() => { played = true; }).catch(err => {
                if (token !== generation) return;
                releaseAudioAnalysis('playback-failed');
                audio.onended = audio.onerror = null;
                currentAudio = null;
                currentAudioUrl = null;
                releaseAudioUrl(url);
                console.warn('[voice] audio.play() failed, fallback:', err);
                const hybrid = window.GunterRuntimeState?.getState?.();
                if (err?.name === 'NotAllowedError') {
                    failPlayback('VOICE_PLAYBACK_BLOCKED', 'El navegador bloqueó el audio. Pulsa Probar voz para volver a intentarlo.');
                    return;
                }
                if (request.localRequested || hybrid?.privacy === 'LOCAL_ONLY' || hybrid?.mode === 'LOCAL') {
                    failPlayback('LOCAL_TTS_PLAYBACK_FAILED', 'No pude reproducir la voz local. La respuesta sigue escrita en pantalla.');
                    window.GunterNotificationsService?.showToast?.('No pude reproducir la voz local; la respuesta sigue escrita en pantalla.', { variant: 'warn', silent: true });
                } else speakFallback(next.text, next.sv, token);
            });
            if (played && token === generation) {
                rememberAudibleText(next.text);
                notifyVoiceState('speaking', { context: next.opts.context || 'chat' });
                prefetchNext();
            }
        } catch (err) {
            if (token !== generation) return;
            const hybrid = window.GunterRuntimeState?.getState?.();
            if (request.localRequested || LOCAL_TTS_CODES.has(err.code) || hybrid?.privacy === 'LOCAL_ONLY' || hybrid?.mode === 'LOCAL') {
                const code = LOCAL_TTS_CODES.has(err.code) ? err.code : 'LOCAL_TTS_UNAVAILABLE';
                const message = code === 'LOCAL_TTS_BUSY' ? 'El motor de voz local está ocupado con otra respuesta. La respuesta sigue escrita en pantalla.'
                    : code === 'LOCAL_TTS_TIMEOUT' ? 'La generación de voz local excedió el tiempo permitido. La respuesta sigue escrita en pantalla.'
                        : 'La voz local no está disponible. La respuesta sigue escrita en pantalla.';
                failPlayback(code, message);
                window.GunterErrors?.toast?.(err, { context: 'audio', silent: true });
                return;
            }
            // Fallback al synthesizer del navegador
            console.warn('[voice] TTS failed, browser fallback:', err.message);
            if (!warnedFallback) {
                warnedFallback = true;
                window.GunterNotificationsService?.showToast?.('La voz local no respondió; usaré temporalmente la voz del navegador.', { variant: 'warn', silent: true });
            }
            speakFallback(next.text, next.sv, token);
            if (token === generation) notifyVoiceState('fallback', { context: next.opts.context || 'chat', code: err.code || 'TTS_UNAVAILABLE' });
        } finally {
            if (synthesisController === controller) synthesisController = null;
        }
    }

    function cancel(reason = 'cancelled') {
        generation += 1;
        synthesisController?.abort();
        synthesisController = null;
        prefetched?.controller.abort();
        prefetched = null;
        queue = [];
        speaking = false;
        releaseAudioAnalysis(reason);
        if (currentAudio) {
            currentAudio.onended = currentAudio.onerror = null;
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
            currentAudio = null;
            releaseAudioUrl(currentAudioUrl);
            currentAudioUrl = null;
        }
        if (currentUtterance) currentUtterance.onend = currentUtterance.onerror = null;
        currentUtterance = null;
        fallbackPlaying = false;
        try { speechSynthesis.cancel(); } catch {}
        notifyVoiceState('idle', { reason });
    }

    function isSpeaking() {
        return speaking;
    }

    // Evita que la escucha continua confunda la propia voz de Gunter con
    // una interrupción del usuario. Se compara la transcripción reciente
    // con el texto que está reproduciendo el TTS.
    function isLikelyEcho(transcript) {
        if (!transcript) return false;
        const clean = value => String(value || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9ñ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const heard = clean(transcript);
        // Explicit calls and stop commands must still interrupt. A late STT
        // result can otherwise contain the previous, not the current TTS chunk.
        if (/^(?:(?:hi|hey|hola|oye|ok) )?(?:gunter|gonter|gunder)(?:\s|$)/.test(heard)
            || /^(?:para|detente|silencio|espera|basta)(?: (?:gunter|por favor))?$/.test(heard)) return false;
        const owner = window.GunterAuth?.getUser?.()?.id;
        const recent = recentSpeech.filter(row => row.owner === owner && Date.now() - row.at <= ECHO_TAIL_MS);
        if (!recent.length) return false;
        const spoken = clean(recent.map(row => row.text).join(' '));
        if (heard.length >= 4 && recent.some(row => clean(row.text) === heard)) return true;
        if (heard.length >= 12 && spoken.includes(heard)) return true;
        const heardTokens = new Set(heard.split(' ').filter(token => token.length > 2));
        const spokenTokens = new Set(spoken.split(' ').filter(token => token.length > 2));
        if (heardTokens.size < 3 || !spokenTokens.size) return false;
        let overlap = 0;
        heardTokens.forEach(token => { if (spokenTokens.has(token)) overlap += 1; });
        return overlap / heardTokens.size >= 0.85;
    }

    function stripMarkdown(s) {
        return String(s || '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ---------- Public ----------
    window.GunterVoice = {
        speak, beginStream, cancel, shouldSpeak, getStyleConfig,
        providers: {
            CloudTTS: { status: 'FALLBACK_PROVIDER', synthesize: synthesizeTts },
            BrowserFallback: { status: 'CURRENT_BROWSER_FALLBACK', speak: speakFallback },
            LocalTTS: { status: 'PREFERRED_WHEN_AVAILABLE', synthesize: synthesizeTts }
        },
        // Fase E.E2/E3
        setMeetingActive, isMeetingActive, shortenForSpeech,
        // Conversación continua / barge-in
        isSpeaking, isLikelyEcho,
        setAudioAnalysisEnabled,
        getAudioAnalysisState: () => ({ ...audioSignal, enabled: audioAnalysisEnabled }),
        getPlaybackState: () => {
            const playing = !!(currentAudio && !currentAudio.paused && !currentAudio.ended) || fallbackPlaying;
            return { speaking: playing, pending: speaking && !playing, text: lastSpokenText, startedAt: speechStartedAt, queued: queue.length,
                error: playbackError ? { ...playbackError } : null };
        }
    };

    // Event shortcut
    window.addEventListener('gunter-speak', (e) => {
        const d = e.detail || {};
        speak(d.text, d);
    });

    function getVoicePolicySnapshot() {
        const service = window.PremiumFeaturesService;
        const cfg = service?.getVoiceConfig?.();
        return JSON.stringify([
            !!cfg?.enabled, cfg?.mode, !!cfg?.onlyAfterWakeWord,
            cfg?.wakeWordResponseMode ?? service?.getWakeWordConfig?.()?.responseMode ?? 'voice',
            !!cfg?.inMeetings, service?.isEnabled?.('entryVoiceGreeting') !== false
        ]);
    }

    let voicePolicySnapshot = getVoicePolicySnapshot();
    // Bulk preference updates also include unrelated memory and visual changes.
    // Invalidate speech only when a preference governing replies really changed.
    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        const key = e.detail?.key;
        if (key == null || ['voiceEnabled', 'voiceMode', 'voiceOnlyAfterWakeWord', 'wakeWordResponseMode', 'voiceInMeetings', 'entryVoiceGreeting'].includes(key)) {
            const nextPolicy = getVoicePolicySnapshot();
            if (nextPolicy === voicePolicySnapshot) return;
            voicePolicySnapshot = nextPolicy;
            // Invalidate pending streams too, even when synthesis has not begun.
            cancel('voice-preference-changed');
        }
    });

    // Hiding a tab must not cut a spoken reply. Only the optional visual meter
    // is suspended; microphone privacy remains owned by the listening service.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pauseAudioAnalysis('page-hidden');
        else if (audioAnalysisEnabled && currentAudio && !currentAudio.paused && !currentAudio.ended)
            startAudioAnalysis(currentAudio, generation);
    });
    window.addEventListener('pagehide', event => {
        setAudioAnalysisEnabled(false);
        pauseAudioAnalysis('page-hidden');
        // A routed element must retain its audible path while a page is frozen.
        // Closing only on actual unload avoids muting a bfcache restoration.
        if (!event.persisted) {
            releaseAudioAnalysis('page-unload');
            try { analysisContext?.close()?.catch?.(() => {}); } catch {}
            analysisContext = null;
        }
    });
    try { window.dispatchEvent(new CustomEvent('gunter-voice-ready')); } catch {}
})();
