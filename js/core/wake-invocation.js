/* =============================================
   GUNTER CORE - Wake Invocation
   ---------------------------------------------
   Reconoce cómo fue llamado Gunter, separa el
   llamado de la orden y genera un acuse distinto
   para cada familia de invocación.
   ============================================= */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterWakeInvocation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const DEFINITIONS = [
        {
            type: 'hola_gunter',
            pattern: /\b(?:hola|holi|buenos\s+dias|buenas\s+tardes|buenas\s+noches)\s+(?:gunter|gonter|gunt[ae]r|cuanter)\b/i,
            responses: ['Hola. Aquí estoy.', 'Hola, te escucho.', 'Qué gusto escucharte. Dime.']
        },
        {
            type: 'hi_gunter',
            pattern: /\b(?:hi|hey|jai)\s+(?:gunter|gonter|gunt[ae]r|cuanter)\b/i,
            responses: ['Online. ¿Qué necesitas?', 'Sistemas listos. Te escucho.', 'Activo. Dime qué hacemos.']
        },
        {
            type: 'ok_gunter',
            pattern: /\b(?:ok|okay|okey)\s+(?:gunter|gonter|gunt[ae]r|cuanter)\b/i,
            responses: ['Confirmado. Te escucho.', 'Listo. Dame la instrucción.', 'Canal abierto. Adelante.']
        },
        {
            type: 'oye_gunter',
            pattern: /\b(?:oye|ey|escucha|escuchame)\s+(?:gunter|gonter|gunt[ae]r|cuanter)\b/i,
            responses: ['Te escucho. Dime.', 'Sí, tengo tu atención.', 'Adelante, estoy contigo.']
        },
        {
            type: 'solo_gunter',
            pattern: /\b(?:gunter|gonter|gunt[ae]r|cuanter)\b/i,
            responses: ['Aquí estoy.', '¿Sí?', 'Presente.']
        }
    ];

    function normalize(raw) {
        return String(raw || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function detect(raw, options = {}) {
        const normalized = normalize(raw);
        if (!normalized) return null;
        for (const def of DEFINITIONS) {
            const match = def.pattern.exec(normalized);
            if (!match) continue;
            const before = normalized.slice(0, match.index).trim();
            const after = normalized.slice(match.index + match[0].length).trim();
            const command = [before, after].filter(Boolean).join(' ').trim();
            return {
                matched: true,
                type: def.type,
                phrase: match[0],
                command,
                normalized,
                confidence: def.type === 'solo_gunter' ? 0.88 : 0.98
            };
        }

        // Permite una palabra/frase personalizable sin reemplazar los llamados
        // naturales de Gunter. La coincidencia se escapa para no interpretar
        // caracteres del ajuste como una expresión regular.
        const custom = normalize(options.wakeWord || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (custom && custom.toLowerCase() !== 'hi gunter') {
            const match = new RegExp(`(?:^|\\s)(${custom})(?=$|\\s)`, 'i').exec(normalized);
            if (match) {
                const phrase = match[1];
                const start = match.index + match[0].indexOf(phrase);
                const before = normalized.slice(0, start).trim();
                const after = normalized.slice(start + phrase.length).trim();
                return {
                    matched: true,
                    type: 'custom_wake_word',
                    phrase,
                    command: [before, after].filter(Boolean).join(' ').trim(),
                    normalized,
                    confidence: 0.98
                };
            }
        }
        return null;
    }

    function responseFor(invocation, options = {}) {
        const type = typeof invocation === 'string' ? invocation : invocation?.type;
        const def = DEFINITIONS.find(item => item.type === type) || DEFINITIONS[DEFINITIONS.length - 1];
        const previousIndex = Number(options.index ?? 0);
        const index = Number.isFinite(previousIndex)
            ? Math.abs(Math.trunc(previousIndex)) % def.responses.length
            : 0;
        return def.responses[index];
    }

    function supportedCalls() {
        return DEFINITIONS.map(def => def.type);
    }

    return { detect, normalize, responseFor, supportedCalls };
});
