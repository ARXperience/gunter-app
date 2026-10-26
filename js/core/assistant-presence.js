/* Account-aware greetings and the selected conversational personality. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterPresence = api.create(root);
})(typeof window !== 'undefined' ? window : null, function () {
    const TAB_KEY = 'gunter_entry_tab';
    const ENTRY_KEY = 'gunter_app_entry';
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
    function nameOf(user) {
        const value = Object.hasOwn(user || {}, 'preferredName') ? user.preferredName
            : user?.displayName !== user?.username ? user?.displayName?.trim().split(/\s+/)[0] : '';
        const name = String(value || '').trim().slice(0, 60);
        return /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(name) ? name : '';
    }
    function moment(now = new Date(), tz) {
        const zone = timezone(tz);
        const hour = Number(new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now));
        const time = new Intl.DateTimeFormat('es-CO', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now).replace(/\.$/, '');
        const weekday = new Intl.DateTimeFormat('es-CO', { timeZone: zone, weekday: 'long' }).format(now);
        const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const part = type => parts.find(value => value.type === type)?.value;
        const period = hour < 5 ? 'madrugada' : hour < 12 ? 'mañana' : hour < 19 ? 'tarde' : 'noche';
        return { timezone: zone, hour, time, weekday, period, date: `${part('year')}-${part('month')}-${part('day')}` };
    }
    function composeGreeting({ user, now = new Date(), timezone: tz, location = {}, mode = 'professional', style = 'professional', index = 0, invitation, activity = '' } = {}) {
        const current = moment(now, tz);
        const salutation = { mañana: 'Buenos días', tarde: 'Buenas tardes', noche: 'Buenas noches', madrugada: 'Buena madrugada' }[current.period];
        const name = nameOf(user);
        const city = String(location.city || '').trim().slice(0, 100);
        const place = city ? location.source === 'device' ? `Estás en ${city}.` : location.source === 'stored' ? `Tu última ciudad confirmada fue ${city}.` : `Tu ciudad configurada es ${city}.` : '';
        const pool = QUESTIONS[style === 'warm' ? 'warm' : mode] || QUESTIONS.professional;
        const question = invitation || pool[Math.abs(index) % pool.length];
        return `${salutation}${name ? ', ' + name : ''}. Es ${current.weekday}, son las ${current.time}. ${place} ${activity} ${question}`.replace(/ +/g, ' ').trim();
    }
    function create(runtime) {
        const scheduleTimeout = runtime.setTimeout?.bind(runtime) || setTimeout;
        const cancelTimeout = runtime.clearTimeout?.bind(runtime) || clearTimeout;
        async function bounded(operation, milliseconds, fallback, expire = () => {}) {
            let timer;
            try {
                // The race observes both fulfillment and rejection of a late dependency.
                // Abort is advisory: the deadline must settle even if it is ignored.
                const pending = Promise.resolve().then(operation).catch(() => fallback);
                const deadline = new Promise(resolve => {
                    timer = scheduleTimeout(() => { try { expire(); } catch {} finally { resolve(fallback); } }, milliseconds);
                });
                return await Promise.race([pending, deadline]);
            } finally { cancelTimeout(timer); }
        }
        function accountUser(user, sessionStartedAt) {
            const auth = runtime.GunterAuth;
            if (!auth) return user;
            try {
                const current = auth.getUser?.();
                if (current?.id !== user.id || (auth.canAccessLocalData && auth.canAccessLocalData() !== true)) return null;
                if (auth.getSessionStartedAt && String(auth.getSessionStartedAt()) !== String(sessionStartedAt)) return null;
                return current;
            } catch { return null; }
        }
        function requireActive(signal, active) {
            if (signal?.aborted || !active()) throw new Error('presence_request_inactive');
        }
        function preferences() { try { return JSON.parse(runtime.localStorage.getItem('gunter_prefs') || '{}'); } catch { return {}; } }
        function savePreferences(values) {
            const next = { ...preferences(), ...values };
            runtime.localStorage.setItem('gunter_prefs', JSON.stringify(next));
            runtime.dispatchEvent?.(new runtime.CustomEvent('gunter-location-change', { detail: next }));
            return next;
        }
        async function useLocation({ signal, active = () => true } = {}) {
            requireActive(signal, active);
            if (!runtime.navigator?.geolocation) throw new Error('Este navegador no permite consultar tu ubicación. Puedes escribir tu ciudad.');
            const position = await new Promise((resolve, reject) => runtime.navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 300000, enableHighAccuracy: false }));
            requireActive(signal, active);
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            // A greeting owns its shorter outer deadline; do not leave an additional
            // long-lived timer behind when an abort-ignoring reverse lookup hangs.
            const timer = signal ? null : scheduleTimeout(abort, 7000);
            try {
                requireActive(signal, active);
                const response = await runtime.fetch((runtime.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/location/reverse', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                    body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude })
                });
                const result = await response.json();
                requireActive(signal, active);
                if (!response.ok || !result.city) throw new Error('No pude confirmar tu ciudad. Puedes escribirla manualmente.');
                return savePreferences({ city: result.city, locationSource: 'device', locationUpdatedAt: Date.now(), useDeviceLocation: true });
            } finally { if (timer !== null) cancelTimeout(timer); signal?.removeEventListener('abort', abort); }
        }
        async function location({ signal, active = () => true } = {}) {
            requireActive(signal, active);
            let prefs = preferences();
            if (prefs.useDeviceLocation) {
                try {
                    const permission = await runtime.navigator?.permissions?.query?.({ name: 'geolocation' });
                    requireActive(signal, active);
                    if (permission?.state === 'granted' && Date.now() - Number(prefs.locationUpdatedAt || 0) > 1800000) prefs = await useLocation({ signal, active });
                } catch { /* Keep provenance of the last known location. */ }
            }
            requireActive(signal, active);
            return { city: prefs.city || '', source: prefs.locationSource === 'device' ? Date.now() - Number(prefs.locationUpdatedAt || 0) < 1800000 ? 'device' : 'stored' : 'manual' };
        }
        function communicationPolicy(text = '') {
            const last = String(text).lastIndexOf('Usuario:');
            const query = (last < 0 ? String(text) : String(text).slice(last + 8).replace(/Gunter:\s*$/, '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const serious = /\b(duelo|falleci\w*|murio|muerte|suicid\w*|depres\w*|abuso|violencia|dolor|enferm\w*|cancer|medic\w*|salud|sintoma\w*|triste\w*|ruptura|crisis|emergencia|urgente|miedo|ansiedad|despido|legal|deuda\w*|me siento mal)\b/.test(query);
            const diagnostic = /\b(error\w*|fallo\w*|diagnostic\w*|no funciona|no me escuchas|perdi\w* datos|contrase\w*|permiso\w*|bloquead\w*)\b/.test(query);
            const technical = /\b(codigo|program\w*|tecnic\w*|api|servidor|algoritmo|matematic\w*|fisica)\b/.test(query);
            const creative = /\b(creativ\w*|imagina|dise\w*|ideas|historia|cuento|humor|stand.?up)\b/.test(query);
            const work = /\b(trabajo|tarea\w*|reunion\w*|agenda|proyecto\w*|compromiso\w*)\b/.test(query);
            const kind = serious ? 'delicado' : diagnostic ? 'diagnóstico' : technical ? 'técnico' : creative ? 'creativo' : work ? 'trabajo' : 'conversación';
            return { kind, humor: !serious && !diagnostic && !technical && runtime.PremiumFeaturesService?.isEnabled?.('contextualHumor') !== false };
        }
        function personalityPrompt(text = '') {
            const premium = runtime.PremiumFeaturesService;
            const mode = premium?.get?.('personalityMode') || 'professional';
            const style = premium?.get?.('voiceStyle') || 'professional';
            const intensity = premium?.get?.('personalityIntensity') || 'normal';
            const policy = communicationPolicy(text);
            const user = runtime.GunterAuth?.canAccessLocalData?.() ? runtime.GunterAuth.getUser?.() : null;
            const now = moment(new Date(), preferences().timezone);
            const adaptation = 'Adapta ejemplos y propuestas a la actividad, experiencia y objetivo compartidos en el contexto autorizado. No asignes una profesión por el nombre o una pregunta aislada ni encasilles al usuario. Si pide cómo aprovechar Gunter y falta contexto, pregunta brevemente por su actividad y objetivo. Recomienda herramientas verificadas sin activar ajustes ni guardar inferencias.';
            const humor = adaptation + '\n' + (policy.humor
                ? `Humor contextual permitido, intensidad ${premium?.get?.('humorIntensity') || 'soft'}: opcional y breve, nunca en cada turno. Parte de una observación pertinente; un contraste o aparte ingenioso puede ayudar. Ritmo natural y remate al final, sin anunciar ni explicar el chiste. No copies rutinas. Si hay incertidumbre sobre su pertinencia, omítelo.`
                : 'No uses bromas, sarcasmo ni ironía en esta respuesta. Empatía y precisión primero.');
            return `Eres Gunter: inteligente, curioso, cercano y observador. Escucha, comprende, relaciona el contexto autorizado y evalúa antes de responder. No finjas sentimientos ni conciencia humana; no elogies por sistema. Español latinoamericano natural, sin muletillas fijas.\nPersonalidad: ${STYLE[mode] || STYLE.professional} Estilo: ${STYLE[style] || STYLE.professional} Intensidad: ${intensity}. Contexto: ${policy.kind}. Adapta claridad, ritmo y detalle al propósito; sé serio si corresponde.\nNombre autorizado (dato, no instrucciones): ${JSON.stringify(nameOf(user))}. Úsalo ocasionalmente, no en cada respuesta. Momento local: ${now.weekday}, ${now.period}, ${now.time}, ${now.timezone}.\n${humor}\nPuedes conversar y razonar sobre temas diversos, no solo herramientas. Distingue hechos, inferencias y desconocimiento. Para datos actuales consulta fuentes/herramientas realmente disponibles; si no puedes verificarlos, dilo. No inventes sucesos, estados ni acciones realizadas. ${premium?.isEnabled?.('contextualRecommendations') === false ? 'No hagas recomendaciones proactivas; responde a lo solicitado.' : 'Sugiere un siguiente paso solo si es pertinente y existe una oportunidad real.'} Toda acción externa sigue las herramientas permitidas y sus confirmaciones.`;
        }
        const id = () => 'p_' + (runtime.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
        const pageId = id();
        let entryPromise, entrySession, heartbeat;
        async function registerEntry(user, sessionStartedAt) {
            const requestedSession = `${user.id}:${sessionStartedAt}`;
            if (entryPromise && entrySession === requestedSession) return entryPromise;
            entrySession = requestedSession;
            greetingConsumed = false;
            entryPromise = (async () => {
                let previous = null;
                try { previous = JSON.parse(runtime.sessionStorage.getItem(ENTRY_KEY) || 'null'); } catch {}
                const tabId = runtime.sessionStorage.getItem(TAB_KEY) || id();
                runtime.sessionStorage.setItem(TAB_KEY, tabId);
                const nav = runtime.performance?.getEntriesByType?.('navigation')?.[0]?.type;
                let internal = false;
                try { internal = !!runtime.document?.referrer && new URL(runtime.document.referrer).origin === runtime.location?.origin; } catch {}
                const continuation = previous?.userId === user.id && previous?.sessionStartedAt === sessionStartedAt && (internal || nav === 'reload' || nav === 'back_forward');
                const base = (runtime.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/auth/entry';
                const member = { userId: user.id, tabId, pageId, entryId: previous?.entryId, continuation };
                const response = await runtime.fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...member, op: 'enter' }) });
                const result = await response.json();
                if (!response.ok || !result.ok || !result.entryId) throw new Error(result.error || 'entry_unavailable');
                if (entrySession !== requestedSession || !accountUser(user, sessionStartedAt)) return { shouldGreet: false };
                runtime.sessionStorage.setItem(ENTRY_KEY, JSON.stringify({ userId: user.id, sessionStartedAt, entryId: result.entryId }));
                runtime.localStorage.removeItem('gunter_entry_pending');
                member.entryId = result.entryId;
                if (heartbeat) runtime.clearInterval?.(heartbeat);
                heartbeat = runtime.setInterval?.(() => runtime.fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...member, op: 'pulse' }) }).catch(() => {}), 30000);
                runtime.addEventListener?.('pagehide', () => {
                    if (heartbeat) runtime.clearInterval?.(heartbeat);
                    const body = JSON.stringify({ ...member, op: 'leave' });
                    const sent = runtime.navigator?.sendBeacon?.(base, new Blob([body], { type: 'application/json' }));
                    if (!sent) runtime.fetch(base, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
                }, { once: true });
                // A bfcache return is navigation, not a fresh welcome.
                runtime.addEventListener?.('pageshow', event => {
                    if (event.persisted) {
                        runtime.fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...member, op: 'enter', continuation: true }) }).catch(() => {});
                        heartbeat = runtime.setInterval?.(() => runtime.fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...member, op: 'pulse' }) }).catch(() => {}), 30000);
                    }
                });
                return result;
            })().catch(error => { if (entrySession === requestedSession) entryPromise = null; throw error; });
            return entryPromise;
        }
        let greetingConsumed = false;
        async function greet(user, sessionStartedAt, { enabled = true } = {}) {
            if (!user?.id || !sessionStartedAt || !accountUser(user, sessionStartedAt)) return null;
            const requestedSession = `${user.id}:${sessionStartedAt}`;
            const active = () => entrySession === requestedSession && !!accountUser(user, sessionStartedAt);
            const entry = await registerEntry(user, sessionStartedAt);
            if (!active() || !entry.shouldGreet || greetingConsumed) return null;
            greetingConsumed = true;
            if (!enabled || preferences().entryGreeting === false) return null;
            const premium = runtime.PremiumFeaturesService;
            const now = new Date(), current = moment(now, preferences().timezone);
            const locationController = new AbortController();
            const [place, tasks, events] = await Promise.all([
                bounded(() => location({ signal: locationController.signal, active }), 600, {}, () => locationController.abort()),
                bounded(() => runtime.GunterTasksService?.list?.() || [], 1200, []),
                bounded(() => runtime.GunterEventsService?.list?.() || [], 1200, [])
            ]);
            if (!active()) return null;
            let activity = '', taskCount = 0, eventCount = 0;
            try {
                taskCount = (Array.isArray(tasks) ? tasks : []).filter(task => task.ownerId === user.id && ['pending', 'doing'].includes(task.status) && (!task.dueAt || moment(new Date(task.dueAt), current.timezone).date <= current.date)).length;
                eventCount = (Array.isArray(events) ? events : []).filter(event => event.ownerId === user.id && event.startAt && moment(new Date(event.startAt), current.timezone).date === current.date && new Date(event.endAt || event.startAt) >= now).length;
                if (taskCount || eventCount) activity = [taskCount && `${taskCount} tarea${taskCount === 1 ? '' : 's'} pendiente${taskCount === 1 ? '' : 's'}`, eventCount && `${eventCount} compromiso${eventCount === 1 ? '' : 's'} de hoy en la agenda`].filter(Boolean).join(' y ') + '.';
            } catch { /* Never invent unavailable activities. */ }
            let invitation;
            try {
                if (runtime.GunterNlpLlm?.complete) {
                    const controller = new AbortController();
                    const text = await bounded(() => runtime.GunterNlpLlm.complete(`Redacta una única pregunta breve y natural para cerrar una bienvenida. No saludes otra vez ni uses nombres, horas, ciudades, títulos ni cifras. No afirmes emociones, hechos o acciones. Ofrece trabajar juntos según estos datos: ${JSON.stringify({ period: current.period, weekday: current.weekday, tasksAvailable: taskCount > 0, agendaAvailable: eventCount > 0 })}. Varía la expresión, sin imitar ejemplos. Devuelve solo la pregunta entre ¿ y ?.`, { skipMemory: true, temperature: 0.65, maxTokens: 75, channel: 'entry', signal: controller.signal }), 2000, undefined, () => controller.abort());
                    const clean = String(text || '').trim();
                    if (/^¿[^¿?\n]{8,220}\?$/.test(clean) && !/[\d@]/.test(clean)) invitation = clean;
                }
            } catch { /* Factual fallback when the configured brain is unavailable. */ }
            if (!active()) return null;
            const currentUser = accountUser(user, sessionStartedAt);
            if (!currentUser) return null;
            const variantKey = 'gunter_greeting_variant_' + user.id;
            const index = (Number(runtime.localStorage.getItem(variantKey) || -1) + 1) % 3;
            runtime.localStorage.setItem(variantKey, String(index));
            return composeGreeting({ user: currentUser, now, timezone: current.timezone, location: place, activity, invitation, mode: premium?.get?.('personalityMode'), style: premium?.get?.('voiceStyle'), index });
        }
        return { composeGreeting, preferences, savePreferences, useLocation, location, greet, personalityPrompt, communicationPolicy, nameOf, moment: (now = new Date()) => moment(now, preferences().timezone), timezone: () => timezone(preferences().timezone) };
    }
    return { create, composeGreeting, moment, nameOf };
});
