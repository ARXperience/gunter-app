/* =============================================
   GUNTER SERVICE - Voice v2 (Humanized TTS)
   -------------------------------------------------
   Motor principal: OpenAI TTS (tts-1-hd) — voces
   humanizadas con carácter real.
   Fallback: speechSynthesis del navegador.

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
    let currentUtterance = null;
    let speaking = false;
    let ttsAvailable = null;   // se detecta primera vez

    async function checkTtsAvailable() {
        if (ttsAvailable !== null) return ttsAvailable;
        // Probar llamando al endpoint con un ping mínimo no hace sentido porque gasta tokens.
        // Simplemente asumimos disponible si hay proxy configurado. El primer fallo caerá a fallback.
        ttsAvailable = !!(window.GUNTER_CONFIG?.PROXY_CHAT_URL || true);
        return ttsAvailable;
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
        const cfg = window.PremiumFeaturesService.getVoiceConfig();
        if (!cfg.enabled) return false;

        // Fase E.E2: si hay reunión activa, ELEVAR el contexto a 'meeting'
        // automáticamente (caller puede no saberlo). Excepción: notification
        // siempre debe poder sonar (recordatorios urgentes).
        const effectiveContext = (_meetingActive && context !== 'notification') ? 'meeting' : context;

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
            mode: cfg.mode
        };
    }

    // ---------- OpenAI TTS path ----------
    async function synthesizeOpenAI(text, { voice, speed }) {
        const cacheKey = `${voice}:${speed}:${text}`;
        if (audioCache.has(cacheKey)) {
            return audioCache.get(cacheKey);
        }
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice, speed, model: 'tts-1-hd' })
        });
        if (!resp.ok) {
            throw new Error(`TTS HTTP ${resp.status}`);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        // Guardar cacheado (limitar tamaño)
        if (audioCache.size >= MAX_CACHE) {
            const firstKey = audioCache.keys().next().value;
            const firstUrl = audioCache.get(firstKey);
            URL.revokeObjectURL(firstUrl);
            audioCache.delete(firstKey);
        }
        audioCache.set(cacheKey, url);
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

    function speakFallback(text, sv) {
        if (!('speechSynthesis' in window)) return;
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
            currentUtterance = null;
            speaking = false;
            processQueue();
        };
        speechSynthesis.speak(u);
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
        if (window.GunterConversationMemory?.remember && (context === 'chat' || context === 'wake')) {
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

        queue.push({ text: stripped, sv, opts });
        if (!speaking) processQueue();
    }

    async function processQueue() {
        const next = queue.shift();
        if (!next) { speaking = false; return; }
        speaking = true;

        try {
            await checkTtsAvailable();
            // Try OpenAI first
            const url = await synthesizeOpenAI(next.text, next.sv);
            const audio = new Audio(url);
            audio.volume = next.opts.volume ?? 1;
            currentAudio = audio;
            audio.onended = audio.onerror = () => {
                currentAudio = null;
                speaking = false;
                processQueue();
            };
            await audio.play().catch(err => {
                console.warn('[voice] audio.play() failed, fallback:', err);
                speakFallback(next.text, next.sv);
            });
        } catch (err) {
            // Fallback al synthesizer del navegador
            console.warn('[voice] OpenAI TTS failed, fallback:', err.message);
            speakFallback(next.text, next.sv);
        }
    }

    function cancel() {
        queue = [];
        speaking = false;
        if (currentAudio) {
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {}
            currentAudio = null;
        }
        try { speechSynthesis.cancel(); } catch {}
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
        speak, cancel, shouldSpeak, getStyleConfig,
        // Fase E.E2/E3
        setMeetingActive, isMeetingActive, shortenForSpeech
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
