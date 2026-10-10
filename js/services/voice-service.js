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

    // Queue de reproducción
    let queue = [];
    let currentAudio = null;
    let currentAudioUrl = null;
    let currentUtterance = null;
    let speaking = false;
    let lastSpokenText = '';
    let speechStartedAt = 0;
    let generation = 0;
    let synthesisController = null;
    let prefetched = null;
    let warnedFallback = false;

    function voiceMetric(name, detail = {}) {
        try { window.dispatchEvent(new CustomEvent('gunter-voice-metric', {
            detail: { name, at: performance.now(), ...detail }
        })); } catch { /* optional telemetry */ }
    }

    function notifyVoiceState(state, detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('gunter-voice-state', {
                detail: { state, speaking, text: lastSpokenText, startedAt: speechStartedAt, ...detail }
            }));
        } catch { /* entorno sin CustomEvent */ }
    }

    // ---------- Detector global de reunión activa (Fase E.E2) ----------
    // Cualquier código puede marcar/desmarcar:
    //   GunterVoice.setMeetingActive(true)  / .setMeetingActive(false)
    // Esto es la fuente de verdad. Si está activo, shouldSpeak considera
    // implícitamente que el contexto es 'meeting' aunque el caller no lo declare.
    let _meetingActive = false;
    function setMeetingActive(active) {
        _meetingActive = !!active;
        try { window.dispatchEvent(new CustomEvent('gunter-voice-meeting-state', { detail: { meetingActive: _meetingActive } })); } catch {}
    }
    function isMeetingActive() {
        return _meetingActive;
    }

    // ---------- Filter: should we speak in this context? ----------
    function shouldSpeak(context = 'chat') {
        if (!window.PremiumFeaturesService) return false;
        if (context === 'entry' && window.PremiumFeaturesService.isEnabled?.('entryVoiceGreeting') === false) return false;
        const cfg = window.PremiumFeaturesService.getVoiceConfig();
        if (!cfg.enabled) return false;

        // Fase E.E2: si hay reunión activa, ELEVAR el contexto a 'meeting'
        // automáticamente (caller puede no saberlo). Excepción: notification
        // siempre debe poder sonar (recordatorios urgentes).
        const effectiveContext = (_meetingActive && context !== 'notification') ? 'meeting' : context;
        if (cfg.onlyAfterWakeWord && !['wake-word-response', 'wake-word-feedback', 'notification'].includes(effectiveContext)) return false;

        switch (cfg.mode) {
            case 'text_only':          return false;
            case 'notifications_only': return effectiveContext === 'notification';
            case 'wake_word_only':     return effectiveContext === 'wake-word-response' || effectiveContext === 'meeting' && cfg.inMeetings;
            case 'live_voice':
                if (effectiveContext === 'meeting' && !cfg.inMeetings) return false;
                return true;
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
            if (resp.status === 503) {
                const data = await resp.clone().json().catch(() => ({}));
                if (data.code)
                    throw Object.assign(new Error(data.code), { code: data.code });
            }
            throw new Error(`TTS HTTP ${resp.status}`);
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
        if (!('speechSynthesis' in window)) { speaking = false; processQueue(); return; }
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
        u.onend = u.onerror = () => {
            if (token !== generation) return;
            currentUtterance = null;
            speaking = false;
            processQueue();
        };
        speechSynthesis.speak(u);
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

    function prefetchNext() {
        if (!queue.length || prefetched) return;
        const item = queue[0];
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 5000);
        const entry = { item, controller, promise: null, claimed: false };
        entry.promise = synthesizeTts(item.text, item.sv, controller.signal)
            .then(url => {
                if (prefetched !== entry && !entry.claimed) releaseAudioUrl(url);
                return { url };
            })
            .catch(error => ({ error }))
            .finally(() => clearTimeout(deadline));
        prefetched = entry;
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
        if (!opts.force && !shouldSpeak(context)) return;

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

        // Fase E.E3 — truncation context-aware con shortenForSpeech
        const skipTruncation = context === 'notification' || opts.full === true;
        if (!skipTruncation) {
            const max = getMaxCharsFor(context);
            if (stripped.length > max) stripped = _truncate(stripped, max);
        }

        for (const part of splitForPlayback(stripped)) queue.push({ text: part, sv, opts });
        if (!speaking) processQueue();
    }

    // Feed complete words from a streaming LLM into the existing ordered audio
    // queue. A punctuation boundary wins; if none arrives, use a word boundary
    // before 120 characters. No artificial acknowledgement is inserted.
    function beginStream(opts = {}) {
        const token = generation;
        const context = opts.context || 'chat';
        const enabled = opts.force || shouldSpeak(context);
        const sv = getStyleConfig();
        let pending = '';
        let closed = false;
        function enqueue(text) {
            const cleaned = stripMarkdown(text);
            if (!cleaned || token !== generation || !enabled) return;
            queue.push({ text: cleaned, sv, opts });
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
                if (closed || token !== generation || !enabled) return;
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
        speaking = true;
        const token = generation;
        lastSpokenText = next.text;
        speechStartedAt = Date.now();
        notifyVoiceState('preparing', { context: next.opts.context || 'chat' });

        const ready = prefetched?.item === next ? prefetched : null;
        if (ready) { ready.claimed = true; prefetched = null; }
        const controller = ready?.controller || new AbortController();
        synthesisController = controller;
        const synthesisDeadline = ready ? null : setTimeout(() => controller.abort(), 5000);

        try {
            if (token !== generation) return;
            voiceMetric('ttsStart', { chars: next.text.length });
            const prepared = ready ? await ready.promise : { url: await synthesizeTts(next.text, next.sv, controller.signal) };
            if (prepared.error) throw prepared.error;
            const url = prepared.url;
            clearTimeout(synthesisDeadline);
            if (token !== generation) { releaseAudioUrl(url); return; }
            voiceMetric('audioReady', { chars: next.text.length });
            const audio = new Audio(url);
            audio.volume = next.opts.volume ?? 1;
            currentAudio = audio;
            currentAudioUrl = url;
            audio.addEventListener('playing', () => {
                if (token === generation) voiceMetric('playbackStart', { chars: next.text.length });
            }, { once: true });
            audio.onended = audio.onerror = () => {
                if (token !== generation) return;
                currentAudio = null;
                currentAudioUrl = null;
                releaseAudioUrl(url);
                speaking = false;
                processQueue();
            };
            let played = false;
            await audio.play().then(() => { played = true; }).catch(err => {
                if (token !== generation) return;
                audio.onended = audio.onerror = null;
                currentAudio = null;
                currentAudioUrl = null;
                releaseAudioUrl(url);
                console.warn('[voice] audio.play() failed, fallback:', err);
                const hybrid = window.GunterRuntimeState?.getState?.();
                if (hybrid?.privacy === 'LOCAL_ONLY' || hybrid?.mode === 'LOCAL') {
                    speaking = false;
                    notifyVoiceState('unavailable', { code: 'LOCAL_TTS_PLAYBACK_FAILED' });
                    window.GunterNotificationsService?.showToast?.('No pude reproducir la voz local; la respuesta sigue escrita en pantalla.', { variant: 'warn', silent: true });
                    processQueue();
                } else speakFallback(next.text, next.sv, token);
            });
            if (played && token === generation) {
                notifyVoiceState('speaking', { context: next.opts.context || 'chat' });
                prefetchNext();
            }
        } catch (err) {
            if (token !== generation) return;
            const hybrid = window.GunterRuntimeState?.getState?.();
            if (hybrid?.privacy === 'LOCAL_ONLY' || hybrid?.mode === 'LOCAL') {
                speaking = false;
                notifyVoiceState('unavailable', { code: err.code || 'LOCAL_TTS_UNAVAILABLE' });
                window.GunterErrors?.toast?.(err, { context: 'audio', silent: true });
                processQueue();
                return;
            }
            // Fallback al synthesizer del navegador
            console.warn('[voice] TTS failed, browser fallback:', err.message);
            if (!warnedFallback) {
                warnedFallback = true;
                window.GunterNotificationsService?.showToast?.('La voz local no respondió; usaré temporalmente la voz del navegador.', { variant: 'warn', silent: true });
            }
            speakFallback(next.text, next.sv, token);
            notifyVoiceState('fallback', { context: next.opts.context || 'chat', code: err.code || 'TTS_UNAVAILABLE' });
        } finally {
            clearTimeout(synthesisDeadline);
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
        if (currentAudio) {
            currentAudio.onended = currentAudio.onerror = null;
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
            currentAudio = null;
            releaseAudioUrl(currentAudioUrl);
            currentAudioUrl = null;
        }
        if (currentUtterance) currentUtterance.onend = currentUtterance.onerror = null;
        currentUtterance = null;
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
        if (!speaking || (!currentAudio && !currentUtterance) || !transcript || !lastSpokenText) return false;
        if (Date.now() - speechStartedAt > 60_000) return false;
        const clean = value => String(value || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9ñ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const heard = clean(transcript);
        const spoken = clean(lastSpokenText);
        if (heard.length >= 10 && (spoken.includes(heard) || heard.includes(spoken))) return true;
        const heardTokens = new Set(heard.split(' ').filter(token => token.length > 2));
        const spokenTokens = new Set(spoken.split(' ').filter(token => token.length > 2));
        if (!heardTokens.size || !spokenTokens.size) return false;
        let overlap = 0;
        heardTokens.forEach(token => { if (spokenTokens.has(token)) overlap += 1; });
        return overlap / heardTokens.size >= 0.7;
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
        getPlaybackState: () => ({ speaking, text: lastSpokenText, startedAt: speechStartedAt, queued: queue.length })
    };

    // Event shortcut
    window.addEventListener('gunter-speak', (e) => {
        const d = e.detail || {};
        speak(d.text, d);
    });

    // Cancel on disable
    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        if (e.detail?.key === 'voiceEnabled' && !e.detail.value) cancel();
    });

    // Pause on tab hide
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && currentAudio) {
            try { currentAudio.pause(); } catch {}
        } else if (!document.hidden && currentAudio && currentAudio.paused) {
            try { currentAudio.play(); } catch {}
        }
    });
})();
