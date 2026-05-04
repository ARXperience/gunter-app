/* =============================================
   GUNTER APP - Gunter Reactions (Contextual)
   -------------------------------------------------
   Observa el texto que va apareciendo en la
   transcripción (DOM mutations) y dispara
   animaciones en el avatar cuando detecta
   palabras clave. Cool-down de 3.5s entre
   reacciones para no saturar.
   ============================================= */

(function () {
    const KEYWORDS = {
        laugh:   /\b(ja+ja+|je+je+|ri(sa|endo)|gracioso|divertido|chistoso|lol|xd)\b/i,
        dance:   /\b(bailar|baile|fiesta|celebrar|celebraci[oó]n|m[uú]sica|rit?mo)\b/i,
        applaud: /\b(felicit|excelente|genial|espectacular|lo lograron|aplausos|brillante|maravillos[ao])\b/i,
        idea:    /\b(idea|se me ocurre|eureka|descubr|insight|inspir)\b/i,
        think:   /\b(anali?(za|cemos|zar)|pensar|considerar|reflexion|evaluar|estrategia|an[aá]lisis)\b/i,
        nod:     /\b(s[ií]|exact(o|amente)|correcto|claro|por supuesto|desde luego|obvio|confirmado)\b/i,
        shake:   /\b(no|nunca|jam[aá]s|imposible|cancelar|rechaz|descart)\b/i,
        wave:    /\b(hola|bienvenid[oa]s?|buenos d[ií]as|buenas tardes|buenas noches|hey|qu[eé] tal)\b/i,
        play:    /\b(jug(ar|uemos)|divertirse|probar|experimentar|explorar)\b/i,
        alert:   /\b(problema|riesgo|peligro|cuidado|alerta|grave|cr[ií]tico|urgente)\b/i
    };

    const COOLDOWN_MS = 3500;
    let lastTriggered = 0;
    let avatar = null;
    let observer = null;

    function reactTo(text) {
        if (!text || !avatar) return;
        const now = Date.now();
        if (now - lastTriggered < COOLDOWN_MS) return;

        // Check in priority order — strongest signals first
        const order = ['alert', 'applaud', 'idea', 'laugh', 'dance', 'wave', 'think', 'play', 'nod', 'shake'];
        for (const key of order) {
            if (KEYWORDS[key].test(text)) {
                try {
                    if (key === 'alert') {
                        avatar.setState && avatar.setState('alert');
                        setTimeout(() => avatar.setState && avatar.setState('listening'), 2400);
                    } else {
                        avatar.playAnimation && avatar.playAnimation(key);
                    }
                    lastTriggered = now;
                    return key;
                } catch (e) { /* swallow */ }
            }
        }
        return null;
    }

    /**
     * Hook to a live transcription list. Observes mutations
     * (new <p class="transcription-item__text">) and reacts.
     */
    function attachToTranscription({ avatar: av, listSelector = '#transcription-list' }) {
        avatar = av;
        const list = document.querySelector(listSelector);
        if (!list) return;

        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                // Reacts only to added text / characterData
                if (m.type === 'childList') {
                    m.addedNodes.forEach(n => {
                        const text = n.textContent || '';
                        if (text.trim().length > 2) reactTo(text);
                    });
                } else if (m.type === 'characterData') {
                    reactTo(m.target.textContent || '');
                }
            }
        });
        observer.observe(list, { childList: true, subtree: true, characterData: true });
    }

    function detach() {
        if (observer) { observer.disconnect(); observer = null; }
        avatar = null;
    }

    /**
     * Trigger a reaction manually from any text (e.g., a Gunter AI message).
     */
    function triggerFromText(av, text) {
        avatar = av;
        reactTo(text);
    }

    window.GunterReactions = {
        attachToTranscription,
        detach,
        triggerFromText
    };
})();
