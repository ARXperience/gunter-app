/* =============================================
   GUNTER ADAPTER - Voice (Fase 7)
   -------------------------------------------------
   Hoy: GunterVoice (OpenAI TTS-1-HD + speechSynthesis
   fallback). Mañana: ElevenLabs, Azure Neural,
   PlayHT — el consumidor llama igual.

   Interfaz:
     voice.speak(text, opts?): void
     voice.cancel(): void
     voice.shouldSpeak(context?): boolean
     voice.getStyle(): {style, voice, speed, mode}
     voice.use(name): void
     voice.register(name, impl): void
   ============================================= */

(function () {
    const impls = {};
    let active = null;

    function register(name, impl) {
        impls[name] = impl;
        if (!active) active = name;
    }
    function use(name) {
        if (!impls[name]) throw new Error(`Voice impl "${name}" no registrada`);
        active = name;
    }
    function current() {
        const i = impls[active];
        if (!i) throw new Error('No hay voice adapter activo');
        return i;
    }

    // ---------- Default: GunterVoice ----------
    const localImpl = {
        speak(text, opts = {}) {
            const v = window.GunterVoice;
            if (!v?.speak) return;
            v.speak(text, opts);
        },
        cancel() {
            try { window.GunterVoice?.cancel?.(); } catch {}
        },
        shouldSpeak(context = 'chat') {
            return !!window.GunterVoice?.shouldSpeak?.(context);
        },
        getStyle() {
            return window.GunterVoice?.getStyleConfig?.() || null;
        },
        get name() { return 'local'; }
    };

    register('local', localImpl);

    const surface = {
        register, use,
        get current() { return current(); },
        get activeName() { return active; },
        speak:       (...a) => current().speak(...a),
        cancel:      ()     => current().cancel(),
        shouldSpeak: (c)    => current().shouldSpeak(c),
        getStyle:    ()     => current().getStyle()
    };

    window.GunterAdapters = window.GunterAdapters || {};
    window.GunterAdapters.voice = surface;
})();
