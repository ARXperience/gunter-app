/* Account-aware greetings and the selected conversational personality. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterPresence = api.create(root);
})(typeof window !== 'undefined' ? window : null, function () {
    const SESSION_KEY = 'gunter_entry_greeting';
    const STYLE = {
        professional: 'Profesional, claro y amable; precisión sin lenguaje corporativo innecesario.',
        direct: 'Directo y breve, sin rodeos; respetuoso y cercano.',
        coach: 'Motivador y paciente; ayuda a elegir el siguiente paso sin presionar.',
        fun: 'Amigable y juguetón, con humor ligero ocasional; nunca burlas hacia el usuario.',
        strategic: 'Estratégico y sereno; conecta objetivos, alternativas y consecuencias.',
        warm: 'Cálido y cercano, con empatía y una mirada amable.',
        chaotic_scientist: 'Ingenioso, curioso y ligeramente irónico; el humor es opcional y no sustituye la precisión.',
        energetic_cartoon: 'Alegre y animado; entusiasmo moderado, sin infantilizar.',
        minimal_penguin: 'Conciso y tranquilo; pocas palabras, sin omitir datos necesarios.',
        executive: 'Sereno, organizado y orientado a resultados.',
        focus_coach: 'Firme, amable y paciente; una tarea a la vez.'
    };
    const QUESTIONS = {
        professional: ['¿En qué quieres que trabajemos hoy?', '¿Qué te gustaría resolver hoy?', '¿Por dónde empezamos hoy?'],
        direct: ['¿Qué hacemos primero?', '¿Qué quieres resolver?', '¿Con qué empezamos?'],
        coach: ['¿Qué paso te gustaría dar hoy?', '¿Qué objetivo trabajamos juntos hoy?', '¿Qué quieres avanzar hoy?'],
        fun: ['¿Qué hacemos hoy, equipo?', '¿Qué reto resolvemos juntos hoy?', '¿Por dónde empezamos nuestra misión de hoy?'],
        strategic: ['¿Qué objetivo priorizamos hoy?', '¿Qué te gustaría avanzar primero?', '¿En qué enfocamos el día?'],
        warm: ['¿En qué quieres que trabajemos juntos hoy?', '¿Cómo puedo acompañarte hoy?', '¿Qué te gustaría hacer hoy?']
    };
    function timezone(value) {
        const candidate = value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        try { new Intl.DateTimeFormat('es', { timeZone: candidate }).format(); return candidate; } catch { return 'UTC'; }
    }
    function composeGreeting({ user, now = new Date(), timezone: tz, location = {}, mode = 'professional', style = 'professional', index = 0 } = {}) {
        const zone = timezone(tz);
        const hour = Number(new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now));
        const salutation = hour >= 5 && hour < 12 ? 'Buenos días' : hour >= 12 && hour < 19 ? 'Buenas tardes' : 'Buenas noches';
        const name = String(user?.displayName || user?.username || '').trim().slice(0, 80);
        const time = new Intl.DateTimeFormat('es-CO', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now).replace(/\.$/, '');
        const city = String(location.city || '').trim().slice(0, 100);
        const place = city ? location.source === 'device' ? `Estás en ${city}.` : location.source === 'stored' ? `Tu última ciudad confirmada fue ${city}.` : `Tu ciudad configurada es ${city}.` : 'Aún no tengo tu ciudad confirmada; puedes indicarla en Preferencias.';
        const pool = QUESTIONS[style === 'warm' ? 'warm' : mode] || QUESTIONS.professional;
        const question = pool[Math.abs(index) % pool.length];
        return `${salutation}${name ? ', ' + name : ''}. Son las ${time}. ${place} ${question}`;
    }
    function create(runtime) {
        function preferences() { try { return JSON.parse(runtime.localStorage.getItem('gunter_prefs') || '{}'); } catch { return {}; } }
        function savePreferences(values) {
            const next = { ...preferences(), ...values };
            runtime.localStorage.setItem('gunter_prefs', JSON.stringify(next));
            runtime.dispatchEvent?.(new runtime.CustomEvent('gunter-location-change', { detail: next }));
            return next;
        }
        async function useLocation() {
            if (!runtime.navigator?.geolocation) throw new Error('Este navegador no permite consultar tu ubicación. Puedes escribir tu ciudad.');
            const position = await new Promise((resolve, reject) => runtime.navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 300000, enableHighAccuracy: false }));
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 7000);
            try {
                const response = await runtime.fetch((runtime.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/location/reverse', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                    body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude })
                });
                const result = await response.json();
                if (!response.ok || !result.city) throw new Error('No pude confirmar tu ciudad. Puedes escribirla manualmente.');
                return savePreferences({ city: result.city, locationSource: 'device', locationUpdatedAt: Date.now(), useDeviceLocation: true });
            } finally { clearTimeout(timer); }
        }
        async function location() {
            let prefs = preferences();
            if (prefs.useDeviceLocation) {
                try {
                    const permission = await runtime.navigator?.permissions?.query?.({ name: 'geolocation' });
                    if (permission?.state === 'granted' && Date.now() - Number(prefs.locationUpdatedAt || 0) > 1800000) prefs = await useLocation();
                } catch { /* Keep provenance of the last known location. */ }
            }
            return { city: prefs.city || '', source: prefs.locationSource === 'device' ? Date.now() - Number(prefs.locationUpdatedAt || 0) < 1800000 ? 'device' : 'stored' : 'manual' };
        }
        function personalityPrompt() {
            const premium = runtime.PremiumFeaturesService;
            const mode = premium?.get?.('personalityMode') || 'professional';
            const style = premium?.get?.('voiceStyle') || 'professional';
            const intensity = premium?.get?.('personalityIntensity') || 'normal';
            return `Eres Gunter, un asistente personal atento, amigable y coherente. Personalidad elegida: ${STYLE[mode] || STYLE.professional} Estilo de conversación: ${STYLE[style] || STYLE.professional} Intensidad: ${intensity}. Respeta estos estilos también en texto. El estado de ánimo adapta matices, nunca impone sarcasmo o cambia este carácter. La precisión y las decisiones del usuario siempre tienen prioridad.`;
        }
        async function greet(user) {
            if (!user?.id) return null;
            let previous;
            try { previous = JSON.parse(runtime.sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { }
            if (previous?.userId === user.id) return null;
            // Claim synchronously before location lookup, so navigation does not repeat it.
            runtime.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, at: Date.now() }));
            const variantKey = 'gunter_greeting_variant_' + user.id;
            const index = (Number(runtime.localStorage.getItem(variantKey) || -1) + 1) % 3;
            runtime.localStorage.setItem(variantKey, String(index));
            const place = await location();
            const premium = runtime.PremiumFeaturesService;
            return composeGreeting({ user, now: new Date(), timezone: preferences().timezone, location: place, mode: premium?.get?.('personalityMode'), style: premium?.get?.('voiceStyle'), index });
        }
        return { composeGreeting, preferences, savePreferences, useLocation, location, greet, personalityPrompt, timezone: () => timezone(preferences().timezone) };
    }
    return { create, composeGreeting };
});
