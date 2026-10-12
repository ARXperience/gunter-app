/* =============================================
   GUNTER CORE - Assistant Tool Registry
   -------------------------------------------------
   Registro allowlist para acciones locales verificables.
   Nunca ejecuta un nombre de herramienta proveniente de un
   modelo: primero detecta, valida y confirma según política.
   ============================================= */

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterAssistantTools = api.create();
})(typeof window !== 'undefined' ? window : null, function (root) {
    const PENDING_KEY = 'gunter_pending_tool_v1';
    const PENDING_TTL_MS = 5 * 60 * 1000;
    const REFERENCE_TTL_MS = 10 * 60 * 1000;
    const VOICE_READ_ONLY_TOOLS = new Set(['app.navigate', 'settings.list', 'agenda.list', 'jobs.list', 'reminder.inspect',
        'desktop.files.list', 'desktop.files.search', 'desktop.ui.inspect', 'mobile.files.list', 'mobile.files.search']);

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    const NAVIGATION_TARGETS = Object.freeze({
        home: 'day.html', conversations: 'day.html#conversations', meetings: 'dashboard.html',
        'new meeting': 'new-project.html', meeting: 'dashboard.html', results: 'results.html',
        capture: 'day.html#capture', tasks: 'day.html#tasks', agenda: 'day.html#events',
        reminders: 'day.html#reminders', activity: 'day.html#activity',
        settings: 'config.html#preferences', preferences: 'config.html#preferences', account: 'config.html#account',
        connections: 'config.html#connections', data: 'config.html#data', assistant: 'config.html#premium',
        'ai assistant': 'config.html#premium', trash: 'config.html#trash',
        'advanced settings': 'config.html#premium', administration: 'admin.html'
    });
    const NAVIGATION_LABELS = Object.freeze(Object.fromEntries(Object.entries(NAVIGATION_TARGETS).map(([label, target]) => [target, label])));

    function parseNavigationTarget(text) {
        const aliases = {
            home: ['inicio', 'principal', 'dia', 'hoy'], conversations: ['conversaciones', 'mensajes', 'chats', 'inbox', 'bandeja'],
            meetings: ['reuniones', 'reunion', 'dashboard', 'panel de reuniones'], 'new meeting': ['nueva reunion', 'preparar reunion'],
            results: ['resultados', 'transcripciones', 'analisis de reunion'], capture: ['captura rapida', 'captura'],
            tasks: ['tareas', 'pendientes'], agenda: ['agenda', 'calendario', 'eventos'], reminders: ['recordatorios'],
            activity: ['actividad', 'historial'], settings: ['configuracion', 'ajustes'], preferences: ['preferencias'], account: ['mi cuenta', 'mi perfil', 'nombre preferido'],
            connections: ['conexiones', 'datos y conexiones', 'redes sociales'], assistant: ['asistente ia', 'funciones del asistente', 'configuracion avanzada', 'opciones avanzadas', 'ajustes avanzados', 'configuracion de voz'],
            trash: ['papelera'], administration: ['administracion', 'panel administrativo']
        };
        const normalized = normalize(text);
        const ordered = Object.entries(aliases).flatMap(([destination, phrases]) => phrases.map(phrase => ({ destination, phrase })))
            .sort((a, b) => b.phrase.length - a.phrase.length);
        for (const { destination, phrase } of ordered) {
            if (new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(normalized)) return destination;
        }
        return null;
    }

    function resolveSettingChange(text, items) {
        const normalized = normalize(text);
        const settingAliases = {
            'voice.continuous': ['voz continua', 'escucha continua', 'escucha de voz', 'voz'],
            'memory.cortex': ['memoria general', 'memoria personal', 'memoria cortex'],
            'memory.semantic': ['memoria semantica'], 'memory.graph': ['mapa de conocimiento', 'memoria grafica', 'grafo de memoria'],
            'memory.learning': ['aprendizaje de errores', 'aprendizaje'], 'documents.search': ['documentos y archivos', 'busqueda de archivos', 'busqueda en documentos'],
            'inbox.universal': ['bandeja universal', 'bandeja de entrada'], 'desktop.control': ['control del pc', 'control de computador', 'control de computadora'],
            'mobile.control': ['control del movil', 'control del celular', 'control del telefono'], 'desktop.screen': ['pantalla', 'captura de pantalla'],
            'mobile.camera': ['camara del movil', 'camara del celular'], 'automation.proactive': ['proactividad', 'avisos proactivos'],
            'automation.missions': ['misiones', 'objetivos'], 'automation.procedures': ['automatizaciones', 'procedimientos', 'rutas'],
            'ai.local': ['ia local', 'inteligencia artificial local'], 'ai.cloud': ['cloud ai', 'ia en la nube', 'ia cloud'],
            'connection.sync': ['conexion y sincronizacion', 'sincronizacion', 'conexion'], integrations: ['integraciones', 'servicios conectados']
        };
        const setting = items.map(item => {
            const aliases = [item.key, item.label, ...(settingAliases[item.key] || [])].map(normalize)
                .filter(alias => alias && new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized));
            return { item, score: aliases.reduce((max, alias) => Math.max(max, alias.length), 0) };
        }).filter(match => match.score > 0).sort((a, b) => b.score - a.score)[0]?.item;
        if (!setting) return { rawText: text, unavailable: false };
        const toggleMatch = normalized.match(/\b(activa|activar|habilita|habilitar|desactiva|desactivar|inhabilita|inhabilitar)\b/);
        const fieldAliases = {
            wakeWord: ['palabra de activacion', 'palabra de llamada'], microphone: ['microfono', 'entrada de audio'],
            vad: ['deteccion de voz', 'deteccion de actividad de voz'], bargeIn: ['interrupcion por voz', 'interrumpir a gunter'],
            ttsVoice: ['voz de respuesta', 'voz sintetica'], privacyMode: ['modo de privacidad', 'privacidad'],
            memoryTypes: ['tipos de memoria'], retentionDays: ['retencion', 'dias de retencion', 'retencion en dias'],
            syncEnabled: ['sincronizacion activada'], sources: ['fuentes'], confidenceThreshold: ['umbral de confianza', 'confianza minima'],
            localOnly: ['solo local', 'local solamente'], reviewRequired: ['requiere revision', 'revision obligatoria'],
            allowedFolders: ['carpetas permitidas', 'carpetas autorizadas'], allowedTypes: ['tipos permitidos', 'tipos de archivo'],
            allowedProviders: ['proveedores permitidos', 'proveedores'], priorityContacts: ['contactos prioritarios'], quietHours: ['horas de silencio'],
            healthAlerts: ['alertas de salud', 'alertas de estado'], allowedApps: ['aplicaciones permitidas', 'programas permitidos'],
            filesystemScope: ['alcance de archivos', 'acceso a archivos'], programScope: ['alcance de programas', 'acceso a programas'],
            confirmationLevel: ['nivel de confirmacion'], autonomyLevel: ['nivel de autonomia'], storageScope: ['alcance de almacenamiento'],
            media: ['multimedia'], messaging: ['mensajeria'], files: ['archivos'], location: ['ubicacion'], camera: ['camara'],
            captureMode: ['modo de captura'], retentionMinutes: ['minutos de retencion'], channels: ['canales'],
            interruptThreshold: ['umbral de interrupcion'], priorityContexts: ['contextos prioritarios'], planningHorizon: ['horizonte de planificacion'],
            reviewCadence: ['frecuencia de revision'], budgetLimit: ['limite de presupuesto'], triggers: ['disparadores'], limits: ['limites'],
            schedules: ['horarios'], model: ['modelo'], cpuLimit: ['limite de cpu'], gpuEnabled: ['gpu', 'aceleracion grafica'],
            ramLimitMb: ['limite de ram', 'memoria ram'], storageLimitMb: ['limite de almacenamiento'], providers: ['proveedores cloud'],
            monthlyBudget: ['presupuesto mensual'], fallback: ['respaldo automatico', 'alternativa automatica'], offlineQueueLimit: ['limite de cola offline'],
            reconnectPolicy: ['politica de reconexion']
        };
        const field = (setting.advancedFields || []).find(key => [normalize(key.replace(/[A-Z]/g, c => ` ${c}`)), ...(fieldAliases[key] || []).map(normalize)]
            .some(alias => alias && new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized)));
        if (toggleMatch && !field) {
            const enabled = !/desactiva|desactivar|inhabilita|inhabilitar/.test(toggleMatch[1]);
            return { rawText: text, setting, enabled };
        }
        if (!field) return { rawText: text, setting, missingField: true };
        const valueMatch = String(text).match(/\b(?:a|en|como|por)\s+([“"'])(.+?)\1\s*$/i)
            || String(text).match(/\b(?:a|en|como|por)\s+(.+?)\s*$/i);
        if (!valueMatch && !toggleMatch) return { rawText: text, setting, field, missingValue: true };
        let rawValue = valueMatch ? String(valueMatch[2] || valueMatch[1] || '').trim().replace(/[.!?]+$/, '') : '';
        const existing = setting.advanced?.[field];
        let value;
        if (typeof existing === 'boolean' || /^(enabled|localOnly|sessionOnly|bargeIn|vad|media|messaging|location|camera|gpuEnabled|fallback|healthAlerts|syncEnabled|reviewRequired)$/i.test(field)) {
            if (toggleMatch) value = !/desactiva|desactivar|inhabilita|inhabilitar/.test(toggleMatch[1]);
            else if (/^(si|sí|true|verdadero|on|activado|activada|habilitado|habilitada)$/i.test(rawValue)) value = true;
            else if (/^(no|false|falso|off|desactivado|desactivada|deshabilitado|deshabilitada)$/i.test(rawValue)) value = false;
            else return { rawText: text, setting, field, invalidValue: true };
        } else if (typeof existing === 'number' || /days|minutes|limit|budget|threshold|ram|storage/i.test(field)) {
            const number = Number(rawValue.replace(/\s*(d[ií]as?|minutos?|mb|gb|%|por ciento)$/i, '').replace(',', '.'));
            if (!Number.isFinite(number) || number < 0) return { rawText: text, setting, field, invalidValue: true };
            value = number;
        } else if (Array.isArray(existing) || /^(sources|memoryTypes|allowedFolders|allowedTypes|allowedProviders|priorityContacts|allowedApps|channels|priorityContexts|providers)$/i.test(field)) {
            value = rawValue.split(/[,;]/).map(item => item.trim()).filter(Boolean);
        } else if (/^(quietHours|triggers|limits|schedules)$/i.test(field)) {
            try { value = JSON.parse(rawValue); } catch { return { rawText: text, setting, field, invalidValue: true, jsonRequired: true }; }
        } else value = rawValue;
        return { rawText: text, setting, field, value };
    }

    function displaySettingValue(value) { return value === undefined ? 'sin definir' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
    function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function parsePreferenceChange(normalized, rawText) {
        const negated = /\b(desactiva|desactivar|quita|quitar|reduce menos|no uses)\b/.test(normalized);
        if (/\b(saludo al entrar|saludar al entrar|saludo de entrada|bienvenida)\b/.test(normalized)) return { rawText, key: 'entryGreeting', value: !negated };
        if (/\b(mi ciudad|ciudad del saludo|ciudad a)\b/.test(normalized)) return { rawText, key: 'city', value: String(rawText).match(/\b(?:es|a|en)\s+(.+)$/i)?.[1]?.trim().replace(/[.!]+$/, '').slice(0, 100) };
        if (/\bzona horaria\b/.test(normalized)) return { rawText, key: 'timezone', value: String(rawText).match(/\b(?:es|a|en)\s+([\w/+_-]+)\s*$/i)?.[1] };
        if (/\b(idioma)\b/.test(normalized)) {
            if (/\b(ingles|english)\b/.test(normalized)) return { rawText, key: 'language', value: 'en-US' };
            if (/\b(espanol|español|spanish)\b/.test(normalized)) return { rawText, key: 'language', value: 'es-MX' };
            return { rawText, key: 'language' };
        }
        if (/\b(movimiento reducido|reducir movimiento)\b/.test(normalized)) return { rawText, key: 'reduceMotion', value: !negated };
        if (/\b(efectos? de clic)\b/.test(normalized)) return { rawText, key: 'clickFx', value: !negated };
        if (/\b(modo oscuro|tema oscuro|modo claro|tema claro)\b/.test(normalized)) {
            const light = /\b(claro)\b/.test(normalized) || (negated && /\b(oscuro)\b/.test(normalized));
            return { rawText, key: 'colorMode', value: light ? 'light' : 'dark' };
        }
        return { rawText };
    }

    function parseCalendarPlanningChange(text) {
        const value = normalize(text), patch = {};
        if (/\b(?:y|luego|despues|ademas|pero)\s+(?:activa|desactiva|cambia|configura|ajusta|deja|quita|pon)\b/.test(value))
            return { rawText: text, key: 'calendarPlanning', planningError: 'Pídeme un ajuste de agenda a la vez para mostrar y confirmar exactamente cada cambio.' };
        const disabled = /\b(desactiva|desactivar|quita|quitar|no uses)\b/.test(value);
        if (/\b(margen|pausa|descanso|separacion)\b.*\breuniones\b|\bminutos? entre reuniones\b/.test(value)) {
            if (disabled) patch.bufferMinutes = 0;
            else {
                const minutes = String(text).match(/(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*minutos?\b/i);
                if (!minutes) return { rawText: text, key: 'calendarPlanning', planningError: 'Dime un margen entero de 0 a 120 minutos entre reuniones.' };
                patch.bufferMinutes = Number(minutes[1].replace(',', '.'));
            }
        } else {
            if (/\b(activa|activar|habilita|habilitar|usa)\b/.test(value) || disabled) patch.respectWorkingHours = !disabled;
            const hours = String(text).match(/\b(\d{1,2}:\d{2})\s*(?:a|hasta|[-–])\s*(\d{1,2}:\d{2})\b/i);
            if (hours) {
                patch.workStart = hours[1].padStart(5, '0'); patch.workEnd = hours[2].padStart(5, '0');
            }
            if (/\bdias (?:laborales|de trabajo)\b/.test(value)) {
                const input = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[.!?]+$/, '').trim().replace(/^.*?\bdias (?:laborales|de trabajo)\b\s*(?:(?:a|son|como|en|de)\b)?\s*/, '');
                const days = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
                const range = input.match(/^(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)$/);
                if (range) {
                    patch.workingDays = [days[range[1]]];
                    while (patch.workingDays.at(-1) !== days[range[2]]) patch.workingDays.push((patch.workingDays.at(-1) + 1) % 7);
                } else {
                    const words = input.split(/\s*(?:,|;|\by\b)\s*|\s+/).filter(Boolean);
                    if (!words.length || words.some(word => !Object.hasOwn(days, word)))
                        return { rawText: text, key: 'calendarPlanning', planningError: 'Dime los días, por ejemplo lunes, martes y viernes, o de lunes a viernes.' };
                    patch.workingDays = [...new Set(words.map(word => days[word]))];
                }
            }
        }
        if (/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value) && !patch.workingDays)
            return { rawText: text, key: 'calendarPlanning', planningError: 'Para cambiar los días, dime «configura mis días laborales de lunes a viernes», o indica una lista de días. No apliqué parcialmente la orden.' };
        if (!Object.keys(patch).length) return { rawText: text, key: 'calendarPlanning', planningError: 'Indica qué quieres cambiar: activar la jornada, horario 09:00 a 18:00, días laborales o margen entre reuniones.' };
        return { rawText: text, key: 'calendarPlanning', value: patch };
    }

    function calendarPlanningLabel(policy = {}) {
        const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        return `Jornada ${policy.respectWorkingHours ? 'activada' : 'desactivada'}: ${(policy.workingDays || []).map(day => weekdays[day]).join(', ')}, ${policy.workStart}–${policy.workEnd}. Margen entre reuniones: ${policy.bufferMinutes} minutos. Zona horaria de tu agenda. No mueve eventos ni concede permisos.`;
    }

    function planningErrorMessage(error) {
        return ({
            EVENT_PLANNING_INVALID: 'Usa días válidos, horas HH:mm con inicio anterior al fin y un margen entero de 0 a 120 minutos. No guardé cambios.',
            EVENT_PLANNING_CORRUPT: 'Los ajustes de agenda guardados no son válidos. No los sobrescribí; revisa tu respaldo antes de corregirlos.',
            EVENT_PLANNING_STORAGE: 'No pude acceder o guardar las preferencias locales. Revisa el almacenamiento del navegador antes de repetirlo.',
            EVENT_PLANNING_CHANGED: 'La planificación cambió después de la propuesta. Solicita de nuevo el cambio; no sobrescribí los ajustes actuales.',
            EVENT_AUTH_REQUIRED: 'Inicia sesión con una cuenta verificada para configurar tu agenda.',
            EVENT_OWNER_MISMATCH: 'La cuenta cambió. Vuelve a solicitar los ajustes desde tu propia sesión.'
        })[error?.code || error?.message] || String(error?.message || 'No pude comprobar los ajustes de agenda.');
    }

    function accountPendingTool(pending) {
        return pending && (pending.toolId?.startsWith('tasks.') || pending.toolId?.startsWith('calendar.')
            || pending.toolId === 'reminder.update' || pending.toolId === 'reminder.retry' || pending.toolId === 'jobs.cancel'
            || !!pending.args?.eventLink || !!pending.args?.target?.meta?.eventLink
            || (pending.toolId === 'preferences.update' && pending.args?.key === 'calendarPlanning'));
    }

    function create(options = {}) {
        const registry = new Map();
        let referenceContext = null;
        let referenceOwner = null;
        let pendingReminderReference = null;
        let pendingEventSelection = null;
        const runtime = options.root || root || {};
        const memoryStorage = new Map();
        const storage = options.storage || safeStorage(runtime.sessionStorage, memoryStorage);
        const now = options.now || (() => new Date());
        const timezone = options.timezone || (() => {
            try { return runtime.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
            catch { return 'UTC'; }
        });
        function taskOwnerId() {
            const auth = runtime.GunterAuth;
            const trusted = auth?.canAccessLocalData?.() ?? auth?.isVerified?.();
            const id = trusted && auth.getUser?.()?.id;
            if (typeof id !== 'string' || !id || id === 'local-user') return null;
            // A verified but stale tab must not query jobs through the session
            // cookie of an account that signed in elsewhere on this device.
            try {
                const deviceOwner = runtime.localStorage?.getItem('gunter_device_user');
                if (deviceOwner && deviceOwner !== id) return null;
            } catch { return null; }
            return id;
        }

        function referenceNow() { return new Date(now()).getTime(); }
        function continuityEnabled() { return runtime.PremiumFeaturesService?.isEnabled?.('conversationContinuity') !== false; }
        function syncReferenceScope() {
            const ownerId = taskOwnerId();
            if (!ownerId || ownerId !== referenceOwner) {
                referenceContext = pendingReminderReference = pendingEventSelection = null;
                referenceOwner = ownerId;
            }
            const pending = getPending();
            if (accountPendingTool(pending)
                && (pending.actorId || pending.args?.ownerId) !== ownerId) savePending(null);
            if (!continuityEnabled()) {
                referenceContext = pendingReminderReference = null;
                if (pendingEventSelection?.request) pendingEventSelection = null;
            }
            if (referenceContext && referenceNow() - referenceContext.at > REFERENCE_TTL_MS) referenceContext = null;
            return ownerId;
        }
        function rememberReferences(candidates) {
            const ownerId = taskOwnerId();
            referenceOwner = ownerId;
            referenceContext = ownerId && continuityEnabled() && candidates.length
                ? { ownerId, at: referenceNow(), candidates } : null;
        }
        function rememberToolResult(toolId, result) {
            const ownerId = taskOwnerId();
            if (toolId === 'agenda.list') {
                rememberReferences([
                    ...(result.events || []).filter(row => row.ownerId === ownerId).map(row => ({ id: row.id, kind: 'event', title: row.title })),
                    ...(result.tasks || []).filter(row => row.ownerId === ownerId).map(row => ({ id: row.id, kind: 'task', title: row.title }))
                ]);
            } else if (toolId === 'jobs.list') {
                rememberReferences((result.items || []).map(row => ({ id: row.id, kind: 'reminder', title: row.title })));
            } else if (['reminder.update', 'reminder.retry', 'reminder.inspect'].includes(toolId)) {
                rememberReferences(result?.id ? [{ id: result.id, kind: 'reminder', title: result.title }] : []);
            } else if (toolId.startsWith('tasks.') || toolId.startsWith('calendar.')) {
                rememberReferences(result?.id && result.ownerId === ownerId
                    ? [{ id: result.id, kind: toolId.startsWith('tasks.') ? 'task' : 'event', title: result.title }] : []);
            }
        }
        async function referencedRow(reference) {
            const ownerId = syncReferenceScope();
            if (reference.kind === 'reminder') {
                if (!ownerId) return null;
                const { items } = await reminderItems();
                if (taskOwnerId() !== ownerId) return null;
                return items.find(row => row.id === reference.id) || null;
            }
            const service = reference.kind === 'event' ? options.eventsService || runtime.GunterEventsService
                : options.tasksService || runtime.GunterTasksService;
            const rows = ownerId && service?.list ? await service.list({ includeCancelled: true }) : [];
            if (taskOwnerId() !== ownerId) return null;
            return rows.find(row => row.id === reference.id && row.ownerId === ownerId) || null;
        }
        async function eventReminderArgs(row, timeText) {
            const ownerId = taskOwnerId();
            const before = normalize(timeText).match(/^(\d+)\s*(minutos?|min|horas?|h)\s+antes(?:\s+de\s+(?:la\s+reunion|el\s+(?:evento|inicio)))?$/);
            const atStart = /^(?:al inicio|al empezar|cuando empiece)$/.test(normalize(timeText));
            const resolved = before || atStart ? null : timeText ? await resolveTime(timeText) : null;
            const offset = before ? Number(before[1]) * (/^(hora|h)/.test(before[2]) ? 3600000 : 60000) : 0;
            const start = Date.parse(row.startAt);
            const runAt = (before || atStart) && Number.isFinite(start) && Number.isSafeInteger(offset)
                && Math.abs(start - offset) <= 8640000000000000
                ? new Date(start - offset).toISOString() : resolved?.iso || null;
            return { title: row.title, ownerId, runAt,
                eventLink: { eventId: row.id, ownerId, expected: eventSnapshot(row) },
                restricted: eventRestriction(row) || (row.kind === 'allDay' ? 'Este aviso necesita una reunión local con hora exacta, no un evento de todo el día.' : null),
                temporalAmbiguity: resolved?.ambiguity && (resolved.ambiguity.reason?.trim() || resolved.ambiguity.options?.length > 1)
                    ? resolved.ambiguity : null };
        }
        function reminderTimeQuestion(row) {
            return `Puedo vincular un aviso a “${row.title}”. ¿Cuándo quieres que te avise? Puedes decir “15 minutos antes” o una fecha y hora anterior al inicio. Se ajustará si la reunión cambia y requiere Gunter abierto.`;
        }
        async function reminderItems(filters = {}) {
            const ownerId = taskOwnerId();
            if (runtime.GunterAuth && !ownerId) return { items: [], durableUnavailable: true };
            const jobs = options.jobsService || runtime.GunterJobs;
            const notifications = options.notificationsService || runtime.GunterNotificationsService;
            let durable = [], durableUnavailable = !jobs?.list;
            if (jobs?.list) {
                try { durable = await jobs.list({ ...filters, limit: 200 }); }
                catch { durableUnavailable = true; }
            }
            const local = ownerId && notifications?.list ? (await notifications.list()).filter(row =>
                row.ownerId === ownerId && row.meta?.eventLink?.version === 1) : [];
            if (taskOwnerId() !== ownerId) return { items: [], durableUnavailable: true };
            return { items: [...new Map([...durable.filter(row => row.ownerId == null || row.ownerId === ownerId), ...local.map(row => ({ ...row, runAt: row.fireAt, type: 'reminder' }))]
                .map(row => [row.id, row])).values()], durableUnavailable };
        }
        function referenceQuestion() {
            return { handled: true, status: 'needs_input', reply: continuityEnabled()
                ? '¿A qué tarea, evento o recordatorio te refieres? Dime su nombre y el cambio para evitar modificar otro registro.'
                : 'La continuidad de conversación está desactivada. Dime el nombre de la tarea, evento o recordatorio y el cambio que quieres hacer.' };
        }
        async function prepareReferenceRequest(reference, request, text, dispatchOptions, originalPending = null) {
            const row = await referencedRow(reference);
            if (!row || !continuityEnabled()) return referenceQuestion();
            if (reference.kind === 'reminder' && !['move', 'rename', 'cancel', 'retry', 'inspect'].includes(request.action))
                return { handled: true, status: 'needs_input', reply: 'Ese registro ya es un aviso. Puedo reprogramarlo, cambiar su nombre o cancelarlo; no lo duplicaré ni lo marcaré como tarea completada.' };
            if (reference.kind === 'event' && !['move', 'rename', 'cancel', 'remind'].includes(request.action))
                return { handled: true, status: 'needs_input', reply: 'No tengo una herramienta para completar o reactivar eventos. Puedo cambiar su nombre, reprogramarlos o cancelarlos.' };
            if (reference.kind === 'task' && ['retry', 'inspect'].includes(request.action))
                return { handled: true, status: 'needs_input', reply: 'Ese registro es una tarea, no un aviso fallido. Dime el recordatorio concreto para consultar o reintentar su entrega.' };
            if (request.action === 'remind') {
                const active = reference.kind === 'event' ? (row.status || 'scheduled') === 'scheduled' : ['pending', 'doing'].includes(row.status);
                if (!active) return { handled: true, status: 'needs_input', reply: 'Ese registro ya no está activo. Dime qué quieres recordar.' };
                if (reference.kind === 'event' && request.value) {
                    return execute({ toolId: 'reminder.schedule', args: { ...await eventReminderArgs(row, request.value), rawText: text,
                        ...(dispatchOptions.inputSource === 'voice' ? { inputSource: 'voice', voiceTranscript: text } : {}) } }, false);
                }
                pendingReminderReference = { ...reference, title: row.title, ownerId: taskOwnerId(), at: referenceNow() };
                return { handled: true, status: 'needs_input', reply: reference.kind === 'event' ? reminderTimeQuestion(row)
                    : `Puedo crear un recordatorio para “${row.title}”. ¿Cuándo quieres que te avise?` };
            }
            let value = request.value || '';
            if (request.action === 'move') {
                const previousTime = originalPending?.args?.startAt || originalPending?.args?.dueAt || originalPending?.args?.runAt
                    || (reference.kind === 'event' ? row.startAt : reference.kind === 'reminder' ? row.runAt : row.dueAt);
                if (/^(?:a las?|las?|\d{1,2}[:.]\d{2})\b/i.test(normalize(value)) && previousTime) {
                    const [year, month, day] = dateKey(previousTime, timezone()).split('-');
                    value = `${day}/${month}/${year} ${value}`;
                } else if (!/\ba las?\b|\b(?:am|pm|mediodia|medianoche)\b|\d{1,2}[:.]\d{2}/i.test(value)) {
                    const resolved = value ? await resolveTime(value) : null;
                    if (resolved?.kind === 'allDay' && !resolved.ambiguity && previousTime) {
                        const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone(), hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(previousTime));
                        value = `${value} a las ${clock}`;
                    }
                }
            }
            const noun = reference.kind === 'event' ? 'evento' : reference.kind === 'reminder' ? 'recordatorio' : 'tarea';
            const id = String(reference.id).replace(/[“”"']/g, '');
            const verb = { move: 'Reprograma', rename: 'Renombra', cancel: 'Cancela', complete: 'Completa', reopen: 'Reabre', retry: 'Reintenta', inspect: 'Estado del' }[request.action];
            const rawText = `${verb} ${noun} "${id}"${request.action === 'move' ? ` para ${value}` : request.action === 'rename' ? ` a "${value.replace(/"/g, '')}"` : ''}`;
            const match = detect(rawText);
            if (!match) return referenceQuestion();
            const prepared = await prepare({ ...match, args: { ...match.args, selectedTargetId: reference.id } });
            if (originalPending?.args?.snapshot && JSON.stringify(originalPending.args.snapshot) !== JSON.stringify(prepared.args.snapshot))
                return { handled: true, status: 'needs_input', reply: 'El registro cambió después de la propuesta. Selecciónalo otra vez y confirma sus datos actuales.' };
            prepared.args = { ...prepared.args, rawText: text,
                referenceRequest: true,
                ...(dispatchOptions.inputSource === 'voice' ? { inputSource: 'voice', voiceTranscript: text } : {}) };
            return execute(prepared, false);
        }

        function isContextualFollowUp(text) {
            syncReferenceScope();
            const pending = getPending();
            const domainConfirmation = accountPendingTool(pending)
                && (isAffirmative(normalize(text)) || isNegative(normalize(text)));
            const scheduleChoice = usesCalendarSchedule(pending) && pending.args?.scheduleCheck?.suggestions?.length
                && calendarSuggestionChoice(text) !== null;
            return Boolean(domainConfirmation || scheduleChoice || parseReferenceRequest(text) || ((pendingEventSelection || referenceContext) && referenceChoice(text) !== null)
                || (pendingReminderReference && isTimeReply(text)));
        }
        runtime.addEventListener?.('gunterPremiumFeaturesChange', syncReferenceScope);

        function usesCalendarSchedule(match) {
            return match?.toolId === 'calendar.create' || (match?.toolId === 'calendar.update' && match.args?.editMode === 'start');
        }

        async function inspectCalendarMatch(match) {
            if (!usesCalendarSchedule(match)) return match;
            const args = { ...match.args };
            const start = Date.parse(args.startAt);
            if (!args.endAt && Number.isFinite(start)) args.endAt = new Date(start + 60 * 60000).toISOString();
            if (!args.ownerId || !Number.isFinite(start) || !Number.isFinite(Date.parse(args.endAt))
                || Date.parse(args.endAt) <= start || args.temporalAmbiguity
                || (match.toolId === 'calendar.update' && (!args.targetId || args.restricted))) return { ...match, args };
            const service = options.eventsService || runtime.GunterEventsService;
            try {
                if (!service?.checkSchedule) throw new Error('El servicio de agenda no permite comprobar horarios en esta vista. Recarga la aplicación.');
                const tz = timezone();
                const check = await service.checkSchedule({ ownerId: args.ownerId, startAt: args.startAt,
                    endAt: args.endAt, excludeId: args.targetId || null, timezone: tz });
                if (runtime.GunterAuth && taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió durante la consulta de agenda.');
                if (!check || typeof check.fingerprint !== 'string' || !Array.isArray(check.conflicts)
                    || !Array.isArray(check.suggestions) || !Array.isArray(check.warnings) || typeof check.complete !== 'boolean')
                    throw new Error('El servicio de agenda no devolvió una comprobación válida.');
                args.scheduleCheck = { ...check, timezone: tz };
                if (args.rrule || args.kind === 'recurring') args.scheduleCheck = { ...args.scheduleCheck,
                    complete: false, suggestions: [], warnings: [...check.warnings,
                        'La comprobación cubre solo la primera ocurrencia; no verifica toda la serie recurrente.'] };
                delete args.scheduleUnavailable;
            } catch (error) {
                delete args.scheduleCheck;
                args.scheduleUnavailable = String(error.message || 'No pude consultar los horarios.');
            }
            return { ...match, args };
        }

        function scheduleSummary(args, showSuggestions = true) {
            const check = args.scheduleCheck;
            if (!check) return '';
            const lines = ['Comprobé únicamente los eventos registrados en tu agenda local; no otros calendarios sin sincronizar.'];
            if (check.conflicts.length) {
                lines.push('Este horario se cruza con:');
                check.conflicts.forEach(item => lines.push(`• “${item.title}” — ${formatDateTime(item.startAt, check.timezone)}, hasta ${formatDateTime(item.endAt, check.timezone)}.`));
            } else if (check.complete) lines.push('No encontré cruces en los registros comprobados.');
            if (check.bufferConflicts?.length) {
                lines.push(`No se cumple tu margen de ${check.planningPreferences?.bufferMinutes || 0} minutos con:`);
                check.bufferConflicts.forEach(item => lines.push(`• “${item.title}” — ${formatDateTime(item.startAt, check.timezone)}.`));
            }
            check.warnings.forEach(warning => lines.push(warning));
            if (showSuggestions && check.suggestions.length) {
                lines.push('Alternativas de la misma duración, sin cruces registrados, en ese día:');
                check.suggestions.forEach((slot, index) => lines.push(`Opción ${index + 1}: ${formatDateTime(slot.startAt, check.timezone)}, hasta ${formatTime(slot.endAt, check.timezone)}.`));
                lines.push('Dime «opción 1» (o el número de opción) para preparar otro horario; después tendrás que confirmarlo.');
            }
            if (check.conflicts.length || check.bufferConflicts?.length || check.outsideWorkingHours || !check.complete)
                lines.push('Si confirmas este horario, aceptarás los cruces, márgenes o límites indicados. No moveré otros eventos.');
            return `\n${lines.join('\n')}`;
        }

        async function assertScheduleUnchanged(args) {
            const service = options.eventsService || runtime.GunterEventsService;
            if (!service?.checkSchedule || !args.scheduleCheck) throw new Error('EVENT_SCHEDULE_UNAVAILABLE');
            const check = await service.checkSchedule({ ownerId: args.ownerId, startAt: args.startAt, endAt: args.endAt,
                excludeId: args.targetId || null, timezone: args.scheduleCheck.timezone });
            if (runtime.GunterAuth && taskOwnerId() !== args.ownerId) throw new Error('EVENT_OWNER_MISMATCH');
            if (check?.fingerprint !== args.scheduleCheck.fingerprint) throw new Error('EVENT_SCHEDULE_CHANGED');
            return { fingerprint: args.scheduleCheck.fingerprint, timezone: args.scheduleCheck.timezone };
        }

        function state(next, reason, meta = {}) {
            try { runtime.GunterConversationState?.transition?.(next, { reason, ...meta }); } catch { /* opcional */ }
        }

        function notify(detail) {
            if (!runtime.dispatchEvent || !runtime.CustomEvent) return;
            try { runtime.dispatchEvent(new runtime.CustomEvent('gunter-tool-execution', { detail })); } catch { /* opcional */ }
        }

        async function executeDesktopSkill(skill, payload = {}, inputSource = 'text') {
            const control = runtime.GunterControlPlane;
            if (!control?.nodes || !control?.queueCommand || !control?.waitForCommand) throw new Error('Gunter Node no está disponible en esta pantalla.');
            const nodeData = await control.nodes();
            const node = (nodeData.items || []).find(item => item.nodeType === 'DESKTOP' && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
            if (!node) throw new Error('No hay un PC con Gunter Node conectado. Vincúlalo desde Configuración.');
            const queued = await control.queueCommand({
                nodeId: node.nodeId, skill, payload, autonomy: 'L3', confirmed: true, inputSource,
                idempotencyKey: `assistant:${skill}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
                ttlMs: 120000
            });
            const command = await control.waitForCommand(queued.command.id, { timeoutMs: skill.startsWith('desktop.browser.') ? 90000 : 60000 });
            if (command.state !== 'VERIFIED') {
                const code = command.error || command.result?.error;
                const error = new Error(desktopErrorMessage(code));
                error.code = code;
                throw error;
            }
            return { ...(command.result || {}), commandId: command.id, evidence: command.evidence || {} };
        }

        async function executeMobileSkill(skill, payload = {}, inputSource = 'text') {
            const control = runtime.GunterControlPlane;
            if (!control?.nodes || !control?.queueCommand || !control?.waitForCommand) throw new Error('Gunter móvil no está disponible en esta pantalla.');
            const nodeData = await control.nodes();
            const node = (nodeData.items || []).find(item => ['ANDROID', 'IOS'].includes(item.nodeType) && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
            if (!node) throw new Error('No hay un móvil con Gunter conectado. Vincúlalo desde Configuración y abre su acompañante.');
            const queued = await control.queueCommand({
                nodeId: node.nodeId, skill, payload, autonomy: 'L3', confirmed: true, inputSource,
                idempotencyKey: `assistant:${skill}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
                ttlMs: 120000
            });
            const command = await control.waitForCommand(queued.command.id, { timeoutMs: 45000 });
            if (command.state !== 'VERIFIED') {
                const code = command.error || command.result?.error;
                const error = new Error(mobileErrorMessage(code));
                error.code = code;
                throw error;
            }
            return { ...(command.result || {}), commandId: command.id, evidence: command.evidence || {} };
        }

        async function controlPlan(tool, match, confirmed) {
            // Las rutas locales deterministas no son tareas persistentes ni deben
            // pasar por un planificador temporal que pueda pedir fecha/hora.
            if (['app.navigate', 'preferences.update', 'desktop.permissions.update', 'settings.list', 'settings.update'].includes(tool.id)) return null;
            // Node adapters already create, authorize and audit their canonical
            // command. A second legacy plan would use a different autonomy level.
            if (tool.id.startsWith('desktop.') || tool.id.startsWith('mobile.')) return null;
            const control = runtime.GunterControlPlane;
            if (!control?.planTask) return null;
            try {
                const planned = await control.planTask({
                    skill: tool.id,
                    intent: match.args?.rawText || tool.id,
                    priority: match.args?.priority || 'normal',
                    autonomy: tool.confirm === 'never' && match.args?.inputSource !== 'voice' ? 'L4' : 'L3',
                    confirmed: confirmed || (tool.confirm === 'never' && match.args?.inputSource !== 'voice'),
                    inputSource: match.args?.inputSource || 'text'
                });
                return planned?.run || null;
            } catch (error) {
                if (['entitlement_required', 'feature_flag_disabled', 'autonomy_exceeds_skill_policy'].includes(error.code)) throw error;
                // Local-first: si el Control Plane no está disponible, la skill
                // existente continúa y se notifica como ejecución degradada.
                notify({ phase: 'control_degraded', toolId: tool.id, error: error.message });
                return null;
            }
        }

        async function controlTransition(run, nextState, payload = {}) {
            if (!run?.taskId || !runtime.GunterControlPlane?.transitionTask) return null;
            try { return await runtime.GunterControlPlane.transitionTask({ taskId: run.taskId, state: nextState, ...payload }); }
            catch { return null; }
        }

        function register(definition) {
            if (!definition?.id || typeof definition.execute !== 'function') throw new Error('Herramienta inválida');
            if (registry.has(definition.id)) throw new Error(`Herramienta duplicada: ${definition.id}`);
            registry.set(definition.id, Object.freeze({ confirm: 'never', ...definition }));
        }

        function listTools() {
            return [...registry.values()].map(tool => ({
                id: tool.id,
                description: tool.description || '',
                confirm: tool.confirm,
                reversible: !!tool.reversible
            }));
        }

        function savePending(value) {
            if (!value) storage.removeItem(PENDING_KEY);
            else storage.setItem(PENDING_KEY, JSON.stringify({ ...value, createdAt: Date.now(), referenceAt: referenceNow(), actorId: taskOwnerId() }));
        }

        function getPending() {
            try {
                const raw = storage.getItem(PENDING_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed?.toolId || Date.now() - Number(parsed.createdAt || 0) > PENDING_TTL_MS) {
                    savePending(null);
                    return null;
                }
                if (!registry.has(parsed.toolId)) {
                    savePending(null);
                    return null;
                }
                return parsed;
            } catch {
                savePending(null);
                return null;
            }
        }

        async function resolveTime(text) {
            const parser = options.timeParser || runtime.GunterTimeParser;
            if (!parser?.parse) return null;
            return parser.parse(text, now(), timezone());
        }

        function detect(text) {
            const t = normalize(text);
            if (!t) return null;
            const mobileTarget = /\b(en|desde|a|mi)\b.*\b(movil|celular|telefono|iphone|ipad|android)\b/.test(t);
            const questionText = t.replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*/, '');
            // A literal reminder title can contain commands or feature names;
            // its anchored operation must win over broad application routing.
            const reminderOperation = parseReminderOperation(text);
            if (reminderOperation) return { toolId: reminderOperation.mode === 'retry' ? 'reminder.retry' : 'reminder.inspect', args: { rawText: text } };
            if (/^(?:por favor )?(?:reintenta|reintentar|vuelve a intentar)\b.*\b(?:todos|varios|recordatorios|avisos)\b/.test(questionText))
                return { toolId: 'reminder.retry', args: { rawText: text, compound: true } };
            if (/^(?:por favor )?(?:mis|los|que|cuales|lista|muestra|muestrame|ver|revisa)\b.*\b(recordatorios|avisos|seguimientos|procesos)\b.*\b(fallidos|fallaron|fallan|errores|fallos)\b/.test(questionText))
                return { toolId: 'jobs.list', args: { status: 'failed' } };
            // Describing a browser or asking how playback works is not permission to act.
            const browserExplanation = /^(?:que (?:es|son|significa)|como (?:funciona|puedo|se)|por que|para que|explica(?:me)?|dime que)\b/.test(questionText);

            const planningMention = /\b(horario laboral|horario de trabajo|jornada(?: laboral)?|dias laborales|dias de trabajo|preferencias de agenda|planificacion de agenda|(?:margen|pausa|descanso|separacion) (?:entre|de) reuniones|minutos? entre reuniones)\b/.test(t);
            if (planningMention) {
                if (/^(?:que|cual|cuales|cuanto|como|por que)\b/.test(questionText)
                    || /\b(muestra|muestrame|consulta|dime|revisa)\b/.test(t)
                    || /^(?:mis preferencias de agenda|mi horario laboral|mi jornada)$/.test(questionText))
                    return { toolId: 'settings.list', args: { rawText: text, calendarPlanning: true } };
                if (/\b(activa|activar|habilita|habilitar|desactiva|desactivar|quita|quitar|cambia|cambiar|ajusta|configura|establece|pon|deja|usa|no uses)\b/.test(t)
                    || /^mi jornada (?:laboral )?es\b/.test(questionText))
                    return { toolId: 'preferences.update', args: parseCalendarPlanningChange(text) };
            }

            if (!mobileTarget && !browserExplanation && /\byoutube\b/.test(t) && /\b(pon|ponme|por|reproduce|reproducir|busca|buscar|mix|mezcla)\b/.test(t)) {
                const args = parseBrowserRequest(text);
                return { toolId: /\b(pon|ponme|por|reproduce|reproducir|mix|mezcla)\b/.test(t) ? 'desktop.browser.youtube.play' : 'desktop.browser.search', args: { ...args, provider: 'youtube' } };
            }
            if (!mobileTarget && !browserExplanation && /\b(abre|abrir|entra|ve)\b/.test(t) && /https?:\/\//i.test(text)) return { toolId: 'desktop.browser.open', args: { ...parseBrowserRequest(text), url: String(text).match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[.,!?]+$/, '') } };
            if (!mobileTarget && !browserExplanation && /\b(busca|buscar)\b/.test(t) && /\b(brave|chrome|edge|google|internet|navegador)\b/.test(t)) return { toolId: 'desktop.browser.search', args: { ...parseBrowserRequest(text), provider: 'google' } };

            if (/\b(ve a|ir a|lleva(me)? a|abre|abrir|muestra(me)?|navega(r)? a|entra a)\b/.test(t)) {
                const destination = parseNavigationTarget(t);
                if (destination) return { toolId: 'app.navigate', args: { destination, rawText: text } };
            }

            if (/\b(acceso general|acceso amplio|acceso completo|control total|control completo|todos los archivos|cualquier carpeta|cualquier programa|acceso estandar|acceso estándar|acceso limitado|limita el acceso)\b/.test(t)
                && /\b(pc|computador|computadora|equipo|archivos|carpetas|programas|permisos)\b/.test(t)
                && !mobileTarget && !browserExplanation && !/^(?:tienes|puedes|tiene)\b/.test(questionText)) {
                const limited = /\b(estandar|estándar|limitado|limita|desactiva|desactivar|quita|quitar|revoca|revocar|retira|retirar)\b/.test(t) || /\bno (?:des|concedas|actives|permitas)\b/.test(t);
                return { toolId: 'desktop.permissions.update', args: { scope: limited ? 'standard' : 'all', rawText: text } };
            }

            if (/\b(modo oscuro|modo claro|tema oscuro|tema claro|movimiento reducido|reducir movimiento|efectos? de clic|idioma|mi ciudad|ciudad del saludo|ciudad a|zona horaria|saludo al entrar|saludar al entrar|saludo de entrada|bienvenida)\b/.test(t)
                && (/\b(activa|activar|desactiva|desactivar|cambia|cambiar|ajusta|ajustar|establece|configura|habilita|quita|quitar|pon|usa|no uses|reduce)\b/.test(t) || /^(mi ciudad es|zona horaria es|modo oscuro$|modo claro$|tema oscuro$|tema claro$)/.test(t))
                && !/^(que|como|por que|para que)\b/.test(t)) {
                return { toolId: 'preferences.update', args: parsePreferenceChange(t, text) };
            }

            if (/\b(configura|configurar|cambia|cambiar|ajusta|ajustar|activa|activar|desactiva|desactivar|habilita|habilitar|inhabilita|inhabilitar|pon|establece|usa)\b/.test(t)
                && /\b(configuracion|ajuste|opcion|voz|microfono|memoria|documentos|archivos|bandeja|control del pc|control del movil|pantalla|camara|proactividad|misiones|automatizaciones|ia local|cloud ai|sincronizacion|integraciones|umbral|retencion|privacidad|autonomia|confirmacion|carpetas|proveedores|modelo|presupuesto|horas de silencio|escucha continua|multimedia|mensajeria|gpu|cpu|almacenamiento|ram|fuentes|canales|disparadores|horarios|reconexion|ubicacion|palabra de activacion|interrupcion por voz|tipos de memoria|contactos prioritarios|alcance|solo local|respaldo automatico)\b/.test(t)) {
                return { toolId: 'settings.update', args: { rawText: text } };
            }
            if (/\b(que|cuales|lista|muestra|dime|consulta|ver)\b/.test(t)
                && /\b(configuracion|ajustes|opciones avanzadas|voz continua|memoria semantica|control del pc|integraciones)\b/.test(t)) {
                return { toolId: 'settings.list', args: { rawText: text } };
            }

            const mediaAction = detectMediaAction(t);
            if (mediaAction) {
                if (mobileTarget && ['play_pause', 'next'].includes(mediaAction)) return { toolId: `mobile.media.${mediaAction}`, args: { rawText: text } };
                if (mobileTarget) return { toolId: 'mobile.media.play_pause', args: { rawText: text } };
                return { toolId: `desktop.media.${mediaAction}`, args: { rawText: text } };
            }

            if (/\b(ejecuta|ejecutar|repite|repetir|corre|correr|inicia|iniciar)\b.*\b(ruta|rutina|procedimiento)\b/.test(t)) {
                return { toolId: 'procedure.execute', args: parseProcedureRequest(text) };
            }

            if (/\b(que|cuales|muestra|mostrar|revisa|revisar|lista|listar)\b.*\b(campos|botones|controles)\b.*\b(en|de)\b/.test(t)) {
                return { toolId: 'desktop.ui.inspect', args: parseUiRequest(text, 'inspect') };
            }
            if (/\b(haz clic|clic|pulsa|pulsar|presiona|presionar|selecciona|seleccionar)\b.*\b(boton|control|opcion)\b/.test(t)) {
                return { toolId: 'desktop.ui.click', args: parseUiRequest(text, 'click') };
            }
            if (/\b(escribe|escribir|ingresa|ingresar|introduce|introducir)\b.*\b(campo|apartado|cuadro|entrada)\b/.test(t)) {
                return { toolId: 'desktop.ui.type', args: parseUiRequest(text, 'type') };
            }
            if (/\b(enfoca|enfocar|activa|activar|ve a|cambia a)\b.*\b(ventana|programa|aplicacion|app)\b/.test(t)) {
                return { toolId: 'desktop.ui.focus', args: parseUiRequest(text, 'focus') };
            }
            if (/\b(espera|esperar)\b.*\b(aparezca|visible|disponible)\b.*\b(boton|control|campo|opcion)\b/.test(t)) {
                return { toolId: 'desktop.ui.wait', args: parseUiRequest(text, 'wait') };
            }
            if (/\b(desplaza|desplazar|scroll)\b.*\b(arriba|abajo|izquierda|derecha)\b/.test(t)) {
                return { toolId: 'desktop.ui.scroll', args: parseUiRequest(text, 'scroll') };
            }
            if (/\b(usa|usar|presiona|presionar|ejecuta|ejecutar)\b.*\b(atajo|ctrl|alt|enter|escape|tab)\b/.test(t)) {
                return { toolId: 'desktop.ui.hotkey', args: parseUiRequest(text, 'hotkey') };
            }
            if (/\b(selecciona|seleccionar|elige|elegir)\b.*\b(archivo|fichero)\b.*(?:[a-z]:[\\/]|\b(en|de)\b.*\b(aplicacion|app|programa|ventana)\b)/i.test(text)) {
                return { toolId: 'desktop.ui.select_file', args: parseUiRequest(text, 'select_file') };
            }

            if (/\b(envia|enviar|manda|mandar|responde|responder|contesta|contestar)\b/.test(t)
                && (/\b(whatsapp|instagram|messenger)\b/.test(t) || /\b(mensaje|conversacion|chat)\b/.test(t))) {
                return { toolId: 'social.send', args: { rawText: text } };
            }

            if (/\b(busca|buscar|encuentra|encontrar|localiza|localizar)\b.*\b(archivo|carpeta|documento)\b/.test(t)) {
                if (mobileTarget) return { toolId: 'mobile.files.search', args: { query: parseMobileFileQuery(text) } };
                return { toolId: 'desktop.files.search', args: parseDesktopRequest(text, 'search') };
            }
            if (/\b(lista|listar|muestra|mostrar|revisa|revisar)\b.*\b(archivos|carpetas|contenido)\b/.test(t)) {
                if (mobileTarget) return { toolId: 'mobile.files.list', args: {} };
                return { toolId: 'desktop.files.list', args: parseDesktopRequest(text, 'list') };
            }
            if (/\b(abre|abrir|explora|explorar)\b.*\b(archivo|carpeta|directorio)\b/.test(t) || /\b(abre|abrir|explora|explorar)\b\s+[a-z]:[\\/]/i.test(text)) {
                if (mobileTarget && /\barchivo\b/.test(t)) return { toolId: 'mobile.files.open', args: { fileName: parseMobileFileName(text) } };
                return { toolId: 'desktop.files.open', args: parseDesktopRequest(text, 'open_file') };
            }
            if (/\b(abre|abrir|inicia|iniciar|ejecuta|ejecutar|entra|ingresa)\b.*\b(programa|aplicacion|app|navegador)\b/.test(t)
                || /\b(abre|inicia|ejecuta|entra)\s+(?:a\s+|en\s+|la\s+|el\s+)?(?:calculadora|bloc de notas|notepad|paint|explorador|spotify|brave|chrome|edge|firefox|word|excel|powerpoint|outlook|discord|telegram|whatsapp|visual studio code|vscode)\b/.test(t)) {
                const args = parseDesktopRequest(text, 'open_app');
                if (mobileTarget && args.app) args.app = args.app.replace(/\s+(?:en|desde)\s+(?:(?:mi|el|la)\s+)?(?:m[oó]vil|celular|tel[eé]fono|iphone|ipad|android).*$/i, '').trim();
                return mobileTarget ? { toolId: 'mobile.open_app', args } : { toolId: 'desktop.apps.open', args };
            }


            if (/\b(mis|los|que|lista|muestra|ver)\b.*\b(recordatorios|seguimientos|procesos)\s+(?:programados|pendientes|activos)\b/.test(t)
                || /^(mis recordatorios|procesos programados|seguimientos programados)$/.test(t)) {
                return { toolId: 'jobs.list', args: {} };
            }

            if (/\b(cancela|cancelar|elimina|quita)\b.*\b(recordatorio|seguimiento|proceso)\b/.test(t)) {
                return { toolId: 'jobs.cancel', args: { rawText: text } };
            }

            if (parseReminderEdit(text).mode && !/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)) {
                return { toolId: 'reminder.update', args: { rawText: text } };
            }

            if (!/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)
                && /\b(reabre|reabrir|reactiva|reactivar|vuelve a abrir)\b.*\b(tarea|pendiente)\b/.test(t)) {
                return { toolId: 'tasks.reopen', args: { rawText: text } };
            }
            if (!/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)
                && /\b(completa|completar|termina|terminar|finaliza|finalizar|marca|marcar)\b.*\b(tarea|pendiente)\b/.test(t)) {
                return { toolId: 'tasks.complete', args: { rawText: text } };
            }
            if (!/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)
                && /\b(cancela|cancelar)\b.*\b(tarea|pendiente)\b/.test(t)) {
                return { toolId: 'tasks.cancel', args: { rawText: text } };
            }
            if (!/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)
                && /\b(reprograma|reprogramar|reagenda|reagendar|mueve|mover|pospone|posponer|renombra|renombrar|edita|editar|cambia|cambiar)\b.*\b(tarea|pendiente)\b/.test(t)) {
                return { toolId: 'tasks.update', args: { rawText: text } };
            }

            if (!browserExplanation && !/^(que|como|por que|para que|puedo|podria)\b/.test(questionText)) {
                if (/\b(cancela|cancelar|elimina|eliminar)\b.*\b(reunion|evento|cita)\b/.test(t))
                    return { toolId: 'calendar.cancel', args: { rawText: text } };
                if (/\b(reprograma|reprogramar|reagenda|reagendar|mueve|mover|pospone|posponer|renombra|renombrar|edita|editar|cambia|cambiar)\b.*\b(reunion|evento|cita)\b/.test(t))
                    return { toolId: 'calendar.update', args: { rawText: text } };
            }

            if (/\b(programa|programame|crea|haz|hacer)\b.*\b(seguimiento|follow up|follow-up)\b/.test(t)) {
                return { toolId: 'follow_up.schedule', args: { rawText: text } };
            }

            if (/\b(recuerdame|recordarme|avisame)\b/.test(t)
                || /\b(ponme|crea|programa)\b.*\b(recordatorio|aviso)\b/.test(t)) {
                return { toolId: 'reminder.schedule', args: { rawText: text,
                    ...(parseEventReminder(text) ? { eventReminderRequest: true } : {}) } };
            }

            if (/\b(que tengo|muestrame|dime|revisa|consulta|ver)\b.*\b(hoy|manana|agenda|calendario|pendientes?|eventos?|reuniones?)\b/.test(t)
                || /^(mi agenda|agenda de hoy|agenda de manana|proximos eventos|mis pendientes)$/.test(t)) {
                const scope = /\bmanana\b/.test(t) ? 'tomorrow' : /\bproxim/.test(t) ? 'upcoming' : 'today';
                return { toolId: 'agenda.list', args: { scope } };
            }

            if (/\b(agenda|agendame|programa|programame|crea|crear|anade|agrega)\b.*\b(reunion|evento|cita)\b/.test(t)
                || /^(reunion|evento|cita)\b/.test(t)) {
                return { toolId: 'calendar.create', args: { rawText: text } };
            }

            if (/\b(crea|crear|anade|agrega|anota)\b.*\b(tarea|pendiente)\b/.test(t)) {
                return { toolId: 'tasks.create', args: { rawText: text } };
            }
            return null;
        }

        function clarifyRequest(text) {
            const normalized = normalize(text);
            const actionRequest = /\b(quiero|necesito|puedes|podrias|ayudame|haz|hacer|abre|busca|mueve|sube|publica|edita|instala|envia|manda|automatiza|configura|cambia|activa|desactiva|descarga|organiza|resuelve|quiero que|necesito que)\b/.test(normalized);
            const toolDiscovery = /\b(herramienta|funcion|opcion)\b/.test(normalized)
                && (/\b(para|busco|necesito|sirve|permite|no se|no conozco)\b/.test(normalized)
                    || /\b(cual|que)\s+(?:herramienta|funcion|opcion)\b/.test(normalized))
                && !/\bque es\b/.test(normalized);
            if (!normalized || (!actionRequest && !toolDiscovery)) return null;

            const available = id => registry.has(id);
            const suggestions = [];
            const add = (ids, label) => { if (ids.some(available)) suggestions.push(label); };
            const isSocial = /\b(instagram|messenger|whatsapp|redes sociales|red social|publicacion|publicar|subir una foto|subir un video)\b/.test(normalized);
            const isFile = /\b(archivo|documento|carpeta|descarga|descargado|fichero)\b/.test(normalized);
            const isApp = /\b(programa|aplicacion|app|software|spotify|chrome|word|excel)\b/.test(normalized);
            const isAutomation = /\b(ruta|rutina|automatizacion|automatizar|procedimiento)\b/.test(normalized);
            const isSettings = /\b(ajuste|configuracion|opcion|preferencia|activar|desactivar|modo)\b/.test(normalized);

            if (isSocial) add(['social.send'], 'Conversaciones: consultar o responder mensajes en canales conectados (el envío pide confirmación).');
            if (isFile) add(['desktop.files.list', 'desktop.files.search', 'desktop.files.open', 'mobile.files.list', 'mobile.files.search', 'mobile.files.open'], 'Archivos: buscar, listar o abrir archivos en un dispositivo conectado.');
            if (isApp) add(['desktop.apps.open', 'mobile.open_app'], 'Aplicaciones: abrir una aplicación en un dispositivo conectado.');
            if (isAutomation) add(['procedure.execute'], 'Rutas guardadas: ejecutar procedimientos disponibles y aprobados.');
            if (isSettings) add(['settings.list', 'settings.update', 'preferences.update'], 'Configuración: consultar opciones y cambiar ajustes permitidos.');
            if (/\b(reunion|evento|cita|agenda|recordatorio|tarea)\b/.test(normalized)) add(['calendar.create', 'calendar.update', 'calendar.cancel', 'agenda.list', 'jobs.list', 'reminder.inspect', 'reminder.retry', 'reminder.schedule', 'reminder.update', 'tasks.create', 'tasks.complete', 'tasks.reopen', 'tasks.cancel', 'tasks.update'], 'Organización: agenda, reuniones, recordatorios y tareas; estado y reintento confirmado de avisos fallidos.');
            if (!suggestions.length) {
                add(['app.navigate'], 'Navegación por las secciones de Gunter.');
                add(['desktop.apps.open', 'mobile.open_app'], 'Abrir aplicaciones conectadas.');
                add(['desktop.files.search', 'mobile.files.search'], 'Buscar archivos en dispositivos conectados.');
            }

            if (!suggestions.length) return null;
            const context = isSocial && /\b(publica|publicar|sube|subir|post|historia|story|foto|video|archivo)\b/.test(normalized)
                ? ' No tengo una herramienta de publicación/subida a redes registrada; la herramienta de conversaciones no publica contenido.'
                : '';
            return {
                status: 'needs_input',
                reply: `No reconocí con suficiente seguridad qué acción o herramienta buscas.${context}\n\nPuedo ofrecerte: ${suggestions.join(' ')}\n\n¿Qué resultado buscas exactamente y en qué aplicación o dispositivo? Si te refieres a otra herramienta, descríbeme para qué sirve y cómo esperas usarla; comprobaré si existe antes de afirmar que puedo ejecutarla.`
            };
        }

        async function prepare(match) {
            if (match.toolId === 'agenda.list' || match.toolId === 'jobs.list') return match;
            if ((match.toolId === 'preferences.update' && match.args.key === 'calendarPlanning')
                || (match.toolId === 'settings.list' && match.args.calendarPlanning)) {
                const ownerId = taskOwnerId();
                const service = options.eventsService || runtime.GunterEventsService;
                try {
                    if (!ownerId || !service?.getPlanningPreferences) throw new Error('Inicia sesión y recarga la aplicación para consultar la planificación local.');
                    const planningPreferences = await service.getPlanningPreferences(ownerId);
                    const newPlanningPreferences = match.toolId === 'preferences.update' && match.args.value && service.validatePlanningPreferences
                        ? await service.validatePlanningPreferences(match.args.value, ownerId) : null;
                    if (taskOwnerId() !== ownerId) throw new Error('La cuenta cambió durante la consulta.');
                    return { ...match, args: { ...match.args, ownerId, planningPreferences, newPlanningPreferences } };
                } catch (error) {
                    return { ...match, args: { ...match.args, ownerId, planningUnavailable: planningErrorMessage(error) } };
                }
            }
            if (match.toolId === 'settings.update' || match.toolId === 'settings.list') {
                const control = runtime.GunterControlPlane;
                if (!control?.settings) return { ...match, args: { ...match.args, unavailable: true } };
                const snapshot = await control.settings();
                const items = snapshot.items || [];
                if (match.toolId === 'settings.list') return { ...match, args: { ...match.args, items } };
                return { ...match, args: resolveSettingChange(match.args.rawText, items) };
            }
            if (match.toolId.startsWith('desktop.')) return match;
            if (match.toolId === 'procedure.execute') {
                const control = runtime.GunterControlPlane;
                let procedures = [];
                try { procedures = control?.procedures ? (await control.procedures({ limit: 200 })).items || [] : []; } catch { /* validation explains */ }
                const needle = normalize(match.args.name);
                const runnable = procedures.filter(item => ['APPROVED', 'ASSISTED', 'TRUSTED'].includes(item.state));
                const target = runnable.find(item => normalize(item.name) === needle)
                    || runnable.find(item => normalize(item.name).includes(needle) || needle.includes(normalize(item.name)))
                    || (!needle && runnable.length === 1 ? runnable[0] : null);
                return { ...match, args: { ...match.args, target } };
            }
            if (match.toolId === 'social.send') {
                const parsed = parseSocialSend(match.args.rawText);
                const control = runtime.GunterControlPlane;
                let threads = [];
                try { threads = control?.conversations ? (await control.conversations({ limit: 120 })).items || [] : []; } catch { /* validation explains */ }
                const recipient = normalize(parsed.recipient);
                const candidates = threads.filter(thread => !parsed.provider || thread.provider === parsed.provider);
                const target = candidates.find(thread => normalize(thread.peerName) === recipient || normalize(thread.peerId) === recipient)
                    || candidates.find(thread => normalize(thread.peerName).includes(recipient) || recipient.includes(normalize(thread.peerName)))
                    || (!recipient && candidates.length === 1 ? candidates[0] : null);
                return { ...match, args: { ...match.args, ...parsed, target } };
            }
            if (match.toolId === 'jobs.cancel') {
                const title = String(match.args.rawText || '').match(/[“"'](.+?)[”"']/)?.[1]
                    || extractTitle(match.args.rawText, match.toolId);
                const { items: candidates } = await reminderItems();
                const active = candidates.filter(job => !['completed', 'fired', 'failed', 'cancelled'].includes(job.status));
                const needle = normalize(title);
                const exact = active.filter(job => job.id === title || normalize(job.title) === needle);
                const matching = match.args.selectedTargetId ? active.filter(job => job.id === match.args.selectedTargetId)
                    : exact.length ? exact : needle.length >= 3 ? active.filter(job =>
                    normalize(job.title).includes(needle) || needle.includes(normalize(job.title))) : [];
                const target = matching.length === 1 ? matching[0] : null;
                return { ...match, args: { ...match.args, title, ownerId: taskOwnerId(), ambiguous: matching.length > 1,
                    targetId: target?.id || null, target: target || null } };
            }
            if (['reminder.inspect', 'reminder.retry'].includes(match.toolId)) {
                const ownerId = taskOwnerId();
                const operation = parseReminderOperation(match.args.rawText) || {};
                const { items, durableUnavailable } = await reminderItems();
                let exactById = null;
                if (ownerId && taskOwnerId() === ownerId && /^job_[\w-]{1,100}$/.test(operation.reference || '')) {
                    try {
                        const row = await (options.jobsService || runtime.GunterJobs)?.get?.(operation.reference);
                        if (taskOwnerId() === ownerId && row?.id === operation.reference && (row.ownerId == null || row.ownerId === ownerId)) exactById = row;
                    } catch { /* The unavailable state is explained without inventing a cause. */ }
                }
                const needle = normalize(operation.reference);
                const candidates = (exactById ? [exactById] : items).filter(row => match.args.selectedTargetId
                    ? row.id === match.args.selectedTargetId : needle && (row.id === operation.reference || normalize(row.title) === needle));
                const target = candidates.length === 1 ? candidates[0] : null;
                return { ...match, args: { ...match.args, ownerId, compound: match.args.compound || operation.compound,
                    unavailable: durableUnavailable && !exactById, targetId: target?.id || null,
                    targetTitle: target?.title || null, snapshot: target ? reminderSnapshot(target) : null,
                    restricted: target && match.toolId === 'reminder.retry' ? reminderRetryRestriction(target) : null,
                    ambiguous: candidates.length > 1,
                    candidates: candidates.map(row => ({ id: row.id, title: row.title, runAt: row.runAt, status: row.status })) } };
            }
            if (match.toolId === 'reminder.update') {
                const ownerId = taskOwnerId();
                const edit = parseReminderEdit(match.args.rawText);
                const { items, durableUnavailable } = await reminderItems();
                let exactById = null;
                if (ownerId && taskOwnerId() === ownerId && /^job_[\w-]{1,100}$/.test(edit.reference)) {
                    const service = options.jobsService || runtime.GunterJobs;
                    try {
                        const row = await service?.get?.(edit.reference);
                        if (taskOwnerId() === ownerId && row?.id === edit.reference && (row.ownerId == null || row.ownerId === ownerId))
                            exactById = row;
                    } catch { /* Preserve the existing unavailable/no-target explanation. */ }
                }
                const needle = normalize(edit.reference);
                const candidates = (exactById ? [exactById] : items).filter(row => !['completed', 'failed', 'cancelled', 'fired'].includes(row.status)
                    && (match.args.selectedTargetId ? row.id === match.args.selectedTargetId
                        : needle && (row.id === edit.reference || normalize(row.title) === needle)));
                const target = candidates.length === 1 ? candidates[0] : null;
                const resolved = edit.mode === 'time' && edit.value ? await resolveTime(edit.value) : null;
                return { ...match, args: { ...match.args, ownerId, targetId: target?.id || null,
                    targetTitle: target?.title || null, snapshot: target ? reminderSnapshot(target) : null,
                    unavailable: durableUnavailable && !exactById, restricted: target ? reminderRestriction(target) : null,
                    compound: edit.compound,
                    editMode: edit.mode, newTitle: edit.mode === 'title' ? edit.value : null,
                    runAt: edit.mode === 'time' ? resolved?.iso || null : null, timeKind: resolved?.kind || null,
                    invalidTime: resolved?.invalid === true,
                    newRecurrence: resolved?.rrule || null, temporalAmbiguity: resolved?.ambiguity &&
                        (resolved.ambiguity.reason?.trim() || resolved.ambiguity.options?.length > 1) ? resolved.ambiguity : null,
                    ambiguous: candidates.length > 1,
                    candidates: candidates.map(row => ({ id: row.id, title: row.title, runAt: row.runAt })) } };
            }
            if (match.toolId === 'reminder.schedule' && match.args.eventReminderRequest) {
                const parsed = parseEventReminder(match.args.rawText);
                const ownerId = taskOwnerId();
                const service = options.eventsService || runtime.GunterEventsService;
                const rows = ownerId && service?.list ? await service.list() : [];
                const candidates = rows.filter(row => row.ownerId === ownerId && (row.status || 'scheduled') === 'scheduled'
                    && (match.args.selectedTargetId ? row.id === match.args.selectedTargetId
                        : parsed?.reference && (row.id === parsed.reference || normalize(row.title) === normalize(parsed.reference))));
                const row = candidates.length === 1 ? candidates[0] : null;
                return { ...match, args: { ...match.args, ownerId, ambiguous: candidates.length > 1,
                    candidates: candidates.map(row => ({ id: row.id, title: row.title, startAt: row.startAt })),
                    ...(row ? await eventReminderArgs(row, parsed?.timeText || '') : {}) } };
            }
            if (['tasks.complete', 'tasks.reopen', 'tasks.cancel', 'tasks.update'].includes(match.toolId)) {
                const service = options.tasksService || runtime.GunterTasksService;
                const ownerId = taskOwnerId();
                const edit = match.toolId === 'tasks.update' ? parseTaskEdit(match.args.rawText) : null;
                const reference = edit ? edit.reference : extractTaskReference(match.args.rawText);
                const all = ownerId && service?.list ? await service.list() : [];
                const eligible = all.filter(item => item.ownerId === ownerId &&
                    (match.toolId === 'tasks.reopen' ? ['done', 'cancelled'].includes(item.status) : ['pending', 'doing'].includes(item.status)));
                const needle = normalize(reference);
                const exact = needle ? eligible.filter(item => normalize(item.title) === needle || item.id === reference) : [];
                const candidates = match.args.selectedTargetId ? eligible.filter(item => item.id === match.args.selectedTargetId)
                    : exact.length ? exact : match.toolId === 'tasks.update' ? [] : needle.length >= 3
                    ? eligible.filter(item => normalize(item.title).includes(needle)) : [];
                const target = candidates.length === 1 ? candidates[0] : null;
                const resolved = edit?.mode === 'due' && edit.value ? await resolveTime(edit.value) : null;
                return { ...match, args: { ...match.args, reference, ownerId,
                    targetId: target?.id || null, targetTitle: target?.title || null,
                    ambiguous: candidates.length > 1,
                    snapshot: target ? { title: target.title, dueAt: target.dueAt || null,
                        status: target.status, updatedAt: target.updatedAt } : null,
                    ...(edit ? { editMode: edit.mode, newTitle: edit.mode === 'title' ? edit.value : null,
                        dueAt: edit.mode === 'due' ? resolved?.iso || null : null,
                        dueKind: resolved?.kind || null,
                        temporalAmbiguity: resolved?.ambiguity || null } : {}) } };
            }
            if (['calendar.update', 'calendar.cancel'].includes(match.toolId)) {
                const service = options.eventsService || runtime.GunterEventsService;
                const ownerId = taskOwnerId();
                const edit = parseEventEdit(match.args.rawText, match.toolId === 'calendar.cancel');
                const all = ownerId && service?.list ? await service.list() : [];
                const active = all.filter(item => item.ownerId === ownerId && (item.status || 'scheduled') === 'scheduled');
                const needle = normalize(edit.reference);
                const candidates = match.args.selectedTargetId
                    ? active.filter(item => item.id === match.args.selectedTargetId)
                    : needle ? active.filter(item => normalize(item.title) === needle || item.id === edit.reference) : [];
                const target = candidates.length === 1 ? candidates[0] : null;
                const resolved = edit.mode === 'start' && edit.value ? await resolveTime(edit.value) : null;
                const duration = target ? Date.parse(target.endAt) - Date.parse(target.startAt) : NaN;
                const endAt = resolved?.end || (Number.isFinite(Date.parse(resolved?.iso)) && Number.isFinite(duration) && duration > 0
                    ? new Date(Date.parse(resolved.iso) + duration).toISOString() : null);
                return inspectCalendarMatch({ ...match, args: { ...match.args, reference: edit.reference, ownerId,
                    editMode: edit.mode, newTitle: edit.mode === 'title' ? edit.value : null,
                    startAt: resolved?.iso || null, endAt, dueKind: resolved?.kind || null,
                    temporalAmbiguity: resolved?.ambiguity || null, newRecurrence: resolved?.rrule || null,
                    targetId: target?.id || null, targetTitle: target?.title || null,
                    snapshot: target ? eventSnapshot(target) : null,
                    restricted: target ? eventRestriction(target) : null,
                    candidates: candidates.length > 1 ? candidates.map(item => ({ id: item.id, title: item.title, startAt: item.startAt })) : [],
                    ambiguous: candidates.length > 1 } });
            }
            if (!['tasks.create', 'calendar.create', 'reminder.schedule', 'follow_up.schedule'].includes(match.toolId)) return match;
            // An undated task must not send its title to the temporal LLM, which
            // can invent ambiguity and block an otherwise valid capture command.
            const hasTime = /\b(hoy|mañana|manana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|horas?|minutos?|segundos?|semanas?|mes|meses|año|mediod[ií]a|medianoche|a las?|a la)\b|\b\d{1,2}[:/]\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i.test(match.args.rawText || '');
            const resolved = match.toolId === 'tasks.create' && !hasTime ? null : await resolveTime(match.args.rawText);
            const title = extractTitle(match.args.rawText, match.toolId);
            return inspectCalendarMatch({
                ...match,
                args: {
                    ...match.args,
                    title,
                    ...(match.toolId === 'calendar.create' ? { ownerId: runtime.GunterAuth ? taskOwnerId() : 'local-user' } : {}),
                    ...(['tasks.create', 'reminder.schedule', 'follow_up.schedule'].includes(match.toolId) ? {
                        ...(match.toolId === 'tasks.create' ? { dueAt: resolved?.iso || null } : { runAt: resolved?.iso || null })
                    } : {
                        startAt: resolved?.iso || null,
                        endAt: resolved?.end || null,
                        kind: resolved?.kind || 'instant',
                        rrule: resolved?.rrule || null,
                        pushToGoogle: /\b(google|calendar)\b/i.test(match.args.rawText)
                    }),
                    temporalAmbiguity: resolved?.ambiguity && (resolved.ambiguity.reason?.trim() || resolved.ambiguity.options?.length > 1) ? resolved.ambiguity : null
                }
            });
        }

        async function execute(match, confirmed = false) {
            const tool = registry.get(match.toolId);
            if (!tool) return { handled: false };
            const validation = tool.validate ? await tool.validate(match.args) : { ok: true };
            if (!validation?.ok) {
                if (['calendar.update', 'calendar.cancel', 'calendar.create', 'reminder.update', 'reminder.retry', 'reminder.inspect'].includes(tool.id) || match.args.eventReminderRequest) {
                    savePending(null);
                    pendingEventSelection = match.args.ambiguous && match.args.ownerId ? {
                        match, ownerId: match.args.ownerId, at: referenceNow()
                    } : null;
                }
                state('idle', 'tool-validation-failed', { toolId: tool.id });
                return { handled: true, intent: tool.id, status: 'needs_input', reply: validation.reply || 'Me faltan datos para hacerlo.' };
            }

            if (match.args.temporalAmbiguity) {
                const ambiguity = match.args.temporalAmbiguity;
                state('idle', 'tool-time-ambiguous', { toolId: tool.id });
                return {
                    handled: true,
                    intent: tool.id,
                    status: 'needs_input',
                    reply: `${ambiguity.reason} Dime la fecha u hora exacta antes de ejecutarlo.`
                };
            }

            const voiceSideEffect = match.args?.inputSource === 'voice' && !VOICE_READ_ONLY_TOOLS.has(tool.id);
            if ((tool.confirm === 'always' || voiceSideEffect || !!match.args.eventLink || (tool.id === 'preferences.update' && match.args.key === 'calendarPlanning')) && !confirmed) {
                const prompt = tool.confirmation?.(match.args) || `¿Confirmas que realice ${tool.description || tool.id}?`;
                const visiblePrompt = voiceSideEffect
                    ? `He entendido: “${String(match.args.voiceTranscript || match.args.rawText || '').slice(0, 500)}”.\n${prompt}\nConfirma por escrito o en pantalla; una respuesta de voz no autoriza esta acción.`
                    : prompt;
                savePending({ toolId: tool.id, args: match.args, prompt: visiblePrompt, inputSource: match.args.inputSource || 'text' });
                state('awaiting_confirmation', 'tool-confirmation-required', { toolId: tool.id });
                notify({ phase: 'awaiting_confirmation', toolId: tool.id, args: match.args });
                return { handled: true, intent: tool.id, status: 'awaiting_confirmation', requiresConfirmation: true, reply: visiblePrompt };
            }

            state('thinking', 'tool-executing', { toolId: tool.id });
            notify({ phase: 'executing', toolId: tool.id, args: match.args });
            let controlRun = null;
            let controlStage = null;
            try {
                controlRun = await controlPlan(tool, match, confirmed);
                controlStage = controlRun?.state || null;
                await controlTransition(controlRun, 'started', { reason: 'legacy_adapter_execute' });
                if (controlRun) controlStage = 'started';
                const result = await tool.execute(match.args);
                await controlTransition(controlRun, 'result_received', { result, reason: 'legacy_adapter_result' });
                if (controlRun) controlStage = 'result_received';
                await controlTransition(controlRun, 'verifying', { reason: 'legacy_adapter_verify' });
                if (controlRun) controlStage = 'verifying';
                const verified = tool.verify ? await tool.verify(result, match.args) : true;
                if (!verified) throw new Error('La acción respondió, pero no pude verificar el resultado guardado.');
                await controlTransition(controlRun, 'verified', { evidence: { verified: true, source: 'legacy_adapter',
                    ...(['reminder.update', 'reminder.retry'].includes(tool.id) ? { persistedId: result.id, reconsulted: true, revision: result.revision } : {}),
                    ...(tool.id === 'reminder.inspect' ? { persistedId: result.id, reconsulted: true } : {}) }, reason: 'legacy_adapter_verified' });
                if (controlRun) controlStage = 'verified';
                await controlTransition(controlRun, 'completed', { reason: 'legacy_adapter_complete' });
                const reply = tool.formatResult ? await tool.formatResult(result, match.args) : 'Listo.';
                rememberToolResult(tool.id, result);
                savePending(null);
                state('idle', 'tool-complete', { toolId: tool.id, verified: true });
                notify({ phase: 'complete', toolId: tool.id, result, verified: true });
                return { handled: true, intent: tool.id, status: 'complete', verified: true, result, reply };
            } catch (error) {
                const failureState = controlStage === 'verifying' ? 'verification_failed' : 'failed';
                await controlTransition(controlRun, failureState, { error: error.code || error.message, reason: 'legacy_adapter_error' });
                state('error', 'tool-error', { toolId: tool.id, error: error.message });
                notify({ phase: 'error', toolId: tool.id, error: error.message });
                if (usesCalendarSchedule(match) && (error.code || error.message) === 'EVENT_SCHEDULE_CHANGED') {
                    savePending(null);
                    const proposal = await execute(await inspectCalendarMatch(match), false);
                    return { ...proposal, reply: `La agenda cambió antes de guardar; no se aplicó este cambio. Revisa y confirma la nueva propuesta.\n${proposal.reply}` };
                }
                return {
                    handled: true, intent: tool.id, status: 'error', verified: false,
                    reply: explainFailure(error, tool)
                };
            }
        }

        async function validatePrepared(match) {
            const tool = registry.get(match?.toolId);
            if (!tool) return { ok: false, error: 'tool_not_allowlisted', reply: 'Ese paso no está disponible.' };
            const validation = tool.validate ? await tool.validate(match.args || {}) : { ok: true };
            if (!validation?.ok) return { ok: false, error: 'tool_input_invalid', reply: validation.reply || 'Me faltan datos para ese paso.' };
            if (match.args?.temporalAmbiguity) {
                return { ok: false, error: 'temporal_ambiguity', reply: `${match.args.temporalAmbiguity.reason} Dime la fecha u hora exacta antes de crear el plan.` };
            }
            if (usesCalendarSchedule(match) && match.args?.scheduleCheck
                && (match.args.scheduleCheck.conflicts.length || match.args.scheduleCheck.bufferConflicts?.length
                    || match.args.scheduleCheck.outsideWorkingHours || !match.args.scheduleCheck.complete)) {
                return { ok: false, error: 'calendar_schedule_attention',
                    reply: `Ese evento necesita revisar el horario antes de incluirlo en un plan multipaso.${scheduleSummary(match.args, false)}\nPídeme agendarlo como acción individual para elegir otro horario o confirmar esos límites.` };
            }
            return { ok: true, tool: { id: tool.id, description: tool.description, confirm: tool.confirm, reversible: !!tool.reversible } };
        }

        async function executeWorkflowStep(step) {
            const tool = registry.get(step?.skill);
            if (!tool) throw new Error('El paso no pertenece al registro permitido.');
            const match = { toolId: tool.id, args: step.input || {} };
            const validation = await validatePrepared(match);
            if (!validation.ok) throw new Error(validation.reply);
            state('thinking', 'workflow-step-executing', { toolId: tool.id, workflowStepId: step.stepId });
            notify({ phase: 'workflow_step_executing', toolId: tool.id, stepId: step.stepId });
            const result = await tool.execute(match.args);
            const verified = tool.verify ? await tool.verify(result, match.args) : true;
            if (!verified) throw new Error('La acción respondió, pero no pude verificar el resultado guardado.');
            const evidence = workflowEvidence(tool.id, result);
            const reply = tool.formatResult ? await tool.formatResult(result, match.args) : 'Paso verificado.';
            rememberToolResult(tool.id, result);
            notify({ phase: 'workflow_step_complete', toolId: tool.id, stepId: step.stepId, verified: true });
            return { result, evidence, reply };
        }

        async function dispatch(text, options = {}) {
            const ownerId = syncReferenceScope();
            try { await runtime.GunterContextProvider?.enrich?.(text, { channel: 'tool' }); } catch { /* local-first */ }
            const normalized = normalize(text);
            const pending = getPending();
            const slotChoice = calendarSuggestionChoice(text);
            if (usesCalendarSchedule(pending) && pending.args?.scheduleCheck?.suggestions?.length && slotChoice !== null) {
                const slot = pending.args.scheduleCheck.suggestions[slotChoice - 1];
                if (!slot) return { handled: true, status: 'needs_input', reply: `Elige una de las opciones de horario mostradas.\n${pending.prompt}` };
                savePending(null);
                const match = { toolId: pending.toolId, args: { ...pending.args, ...slot,
                    inputSource: options.inputSource || 'text', voiceTranscript: String(text),
                    temporalAmbiguity: null, dueKind: 'instant', rawText: String(text) } };
                return execute(await inspectCalendarMatch(match), false);
            }
            if (pending && isAffirmative(normalized)) {
                if (options.inputSource === 'voice') return { handled: true, intent: pending.toolId,
                    status: 'awaiting_confirmation', requiresConfirmation: true,
                    reply: 'He oído una confirmación, pero por seguridad confirma por escrito o en pantalla.' };
                savePending(null);
                return execute({ toolId: pending.toolId, args: pending.args }, true);
            }
            if (pending && isNegative(normalized)) {
                savePending(null);
                state('idle', 'tool-cancelled', { toolId: pending.toolId });
                notify({ phase: 'cancelled', toolId: pending.toolId });
                return { handled: true, intent: pending.toolId, status: 'cancelled', reply: 'Cancelado. No hice ningún cambio.' };
            }
            // New domain requests replace the earlier proposal, never authorize it.
            if (accountPendingTool(pending)) savePending(null);

            const selection = pendingEventSelection;
            pendingEventSelection = null;
            if (selection && selection.ownerId === ownerId && referenceNow() - selection.at < PENDING_TTL_MS) {
                if (isNegative(normalized)) return { handled: true, status: 'cancelled', reply: 'Cancelado. No hice ningún cambio.' };
                const choice = referenceChoice(text);
                if (choice !== null) {
                    const candidate = (selection.candidates || selection.match.args.candidates)[choice - 1];
                    if (!candidate) {
                        pendingEventSelection = selection;
                        return { handled: true, status: 'needs_input', reply: 'Elige uno de los números de la lista.' };
                    }
                    if (selection.request) return prepareReferenceRequest(candidate, selection.request, text, options);
                    const prepared = await prepare({ toolId: selection.match.toolId,
                        args: { rawText: selection.match.args.rawText, selectedTargetId: candidate.id,
                            ...(selection.match.args.eventReminderRequest ? { eventReminderRequest: true } : {}) } });
                    if (options.inputSource === 'voice') prepared.args = { ...prepared.args, inputSource: 'voice', voiceTranscript: text };
                    return execute(prepared, false);
                }
            }

            const request = parseReferenceRequest(text);
            const pendingReminder = pendingReminderReference;
            pendingReminderReference = null;
            if (pendingReminder?.ownerId === ownerId && referenceNow() - pendingReminder.at < REFERENCE_TTL_MS
                && isTimeReply(text) && !request && continuityEnabled()) {
                const row = await referencedRow(pendingReminder);
                const active = row && (pendingReminder.kind === 'event' ? (row.status || 'scheduled') === 'scheduled' : ['pending', 'doing'].includes(row.status));
                if (!active) return { handled: true, status: 'needs_input', reply: 'El registro del recordatorio cambió o ya no está activo. Dime qué quieres recordar.' };
                // Resolve only the newly supplied time; titles can contain
                // words such as "Tarea" or dates and must not be reparsed.
                const prepared = pendingReminder.kind === 'event'
                    ? { toolId: 'reminder.schedule', args: { ...await eventReminderArgs(row, text), rawText: text } }
                    : await prepare({ toolId: 'reminder.schedule', args: { rawText: text } });
                prepared.args = { ...prepared.args, title: row.title,
                    ...(options.inputSource === 'voice' ? { inputSource: 'voice', voiceTranscript: text } : {}) };
                return execute(prepared, false);
            }
            const choice = referenceChoice(text);
            if (request || (choice !== null && referenceContext)) {
                if (!ownerId || !continuityEnabled()) return referenceQuestion();
                const pendingDomain = pending?.args?.ownerId === ownerId && pending.args.targetId
                    && referenceNow() - (pending.referenceAt || 0) < REFERENCE_TTL_MS
                    && (pending.toolId.startsWith('tasks.') || pending.toolId.startsWith('calendar.') || ['reminder.update', 'reminder.retry'].includes(pending.toolId)) ? pending : null;
                const candidates = pendingDomain ? [{ id: pendingDomain.args.targetId, title: pendingDomain.args.targetTitle,
                    kind: pendingDomain.toolId.startsWith('calendar.') ? 'event' : ['reminder.update', 'reminder.retry'].includes(pendingDomain.toolId) ? 'reminder' : 'task' }]
                    : referenceContext?.ownerId === ownerId ? referenceContext.candidates : [];
                const requestedChoice = request?.choice ?? choice;
                const candidate = requestedChoice !== null && requestedChoice !== undefined ? candidates[requestedChoice - 1]
                    : candidates.length === 1 ? candidates[0] : null;
                if (!candidate && candidates.length > 1 && requestedChoice == null && request) {
                    pendingEventSelection = { request, candidates, ownerId, at: referenceNow() };
                    return { handled: true, status: 'needs_input', reply: `¿Cuál quieres cambiar?\n${candidates.map((row, index) => `${index + 1}. ${row.kind === 'event' ? 'Evento' : row.kind === 'reminder' ? 'Aviso' : 'Tarea'}: ${row.title}`).join('\n')}\nDime el número; después pediré confirmación.` };
                }
                if (!candidate) return referenceQuestion();
                if (!request) {
                    const row = await referencedRow(candidate);
                    if (!row) return referenceQuestion();
                    rememberReferences([{ ...candidate, title: row.title }]);
                    return { handled: true, status: 'needs_input', reply: `Te refieres a ${candidate.kind === 'event' ? 'el evento' : candidate.kind === 'reminder' ? 'el aviso' : 'la tarea'} “${row.title}”. ¿Qué cambio quieres hacer?` };
                }
                return prepareReferenceRequest(candidate, request, text, options, pendingDomain);
            }
            const detected = detect(text);
            if (!detected) { referenceContext = null; return { handled: false }; }
            if (detected.toolId.startsWith('calendar.') || detected.toolId.startsWith('tasks.')) {
                referenceContext = null;
                pendingReminderReference = null;
            } else if (!['agenda.list', 'reminder.schedule'].includes(detected.toolId)) referenceContext = null;
            const prepared = await prepare(detected);
            if (options.inputSource === 'voice') prepared.args = { ...prepared.args, inputSource: 'voice', voiceTranscript: String(text || '') };
            return execute(prepared, false);
        }

        register({
            id: 'social.send',
            description: 'Envía un mensaje a una conversación conectada con confirmación explícita.',
            confirm: 'always',
            reversible: false,
            validate(args) {
                if (!args.message) return { ok: false, reply: '¿Qué mensaje quieres enviar?' };
                if (!args.target) return { ok: false, reply: 'No encontré esa conversación en la bandeja de Gunter. Ábrela o dime el canal y el contacto exactos.' };
                return { ok: true };
            },
            confirmation(args) {
                const provider = ({ whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' })[args.target.provider] || args.target.provider;
                return `¿Confirmas que envíe por ${provider} a ${args.target.peerName}: “${args.message}”?`;
            },
            async execute(args) {
                const control = runtime.GunterControlPlane;
                if (!control?.sendConversationMessage) throw new Error('El centro de conversaciones no está disponible.');
                return control.sendConversationMessage({ provider: args.target.provider, peerId: args.target.peerId, text: args.message, confirmed: true,
                    source: args.inputSource === 'voice' ? 'user_voice_confirmed' : 'user_text_confirmed', inputSource: args.inputSource || 'text' });
            },
            verify(result) { return result?.ok === true && Boolean(result.sentAt); },
            formatResult(result, args) { return `Mensaje enviado y verificado a ${args.target.peerName} por ${args.target.provider}.`; }
        });

        register({
            id: 'app.navigate', description: 'Navega a un apartado permitido de Gunter.', confirm: 'never', reversible: true,
            validate(args) { return args.destination ? { ok: true } : { ok: false, reply: 'No identifiqué el apartado. Puedes decir Inicio, Conversaciones, Reuniones, Tareas, Agenda, Resultados o Configuración.' }; },
            execute(args) {
                const target = NAVIGATION_TARGETS[args.destination];
                if (!target) throw new Error('Ese destino no pertenece a las rutas permitidas de Gunter.');
                if (runtime.location?.assign) runtime.location.assign(target);
                else if (runtime.location) runtime.location.href = target;
                else throw new Error('La navegación solo está disponible desde la app web.');
                return { target };
            },
            verify(result) { return !!result?.target; },
            formatResult(result) { return `Abriendo ${NAVIGATION_LABELS[result.target] || 'el apartado solicitado'}.`; }
        });

        register({
            id: 'preferences.update', description: 'Cambia apariencia, accesibilidad, bienvenida, ubicación y planificación de agenda.', confirm: 'never', reversible: true,
            validate(args) {
                if (args.key === 'calendarPlanning') {
                    if (!args.ownerId || taskOwnerId() !== args.ownerId) return { ok: false, reply: 'Inicia sesión para cambiar la planificación de tu cuenta.' };
                    if (args.planningError || args.planningUnavailable) return { ok: false, reply: args.planningError || args.planningUnavailable };
                    if (!args.newPlanningPreferences) return { ok: false, reply: 'No pude validar este ajuste de agenda. Recarga la aplicación antes de guardarlo.' };
                }
                return args.key && args.value !== undefined ? { ok: true } : { ok: false, reply: 'Puedo cambiar apariencia, idioma, bienvenida, ubicación y planificación de agenda. Dime el valor que quieres.' };
            },
            confirmation(args) { return args.key === 'calendarPlanning'
                ? `¿Confirmas cambiar la planificación de tu cuenta? ${calendarPlanningLabel(args.newPlanningPreferences)}` : null; },
            async execute(args) {
                if (args.key === 'calendarPlanning') {
                    const service = options.eventsService || runtime.GunterEventsService;
                    if (!service?.updatePlanningPreferences || taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la planificación.');
                    const current = await service.getPlanningPreferences(args.ownerId);
                    if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la planificación.');
                    if (JSON.stringify(current) !== JSON.stringify(args.planningPreferences)) throw new Error('Los ajustes de agenda cambiaron después de la propuesta. Revísalos y solicita de nuevo el cambio.');
                    try {
                        const value = await service.updatePlanningPreferences(args.value, args.ownerId, { expected: args.planningPreferences });
                        return { key: args.key, value, ownerId: args.ownerId };
                    } catch (error) { throw new Error(planningErrorMessage(error)); }
                }
                if (!runtime.localStorage) throw new Error('Las preferencias locales no están disponibles en esta pantalla.');
                let prefs = {};
                try { prefs = JSON.parse(runtime.localStorage.getItem('gunter_prefs') || '{}'); } catch { prefs = {}; }
                if (args.key === 'colorMode') {
                    if (!['dark', 'light'].includes(args.value)) throw new Error('El modo de color debe ser claro u oscuro.');
                    runtime.GunterThemeToggle?.apply?.(args.value);
                    if (!runtime.GunterThemeToggle?.apply) {
                        runtime.localStorage.setItem('gunter_color_mode', args.value);
                        runtime.localStorage.setItem('gunter_dark_mode', String(args.value === 'dark'));
                        runtime.document?.body?.classList?.remove?.('at-light', 'at-dark');
                        runtime.document?.body?.classList?.add?.(`at-${args.value}`);
                    }
                } else if (args.key === 'reduceMotion') {
                    prefs.reduceMotion = !!args.value;
                    runtime.document?.documentElement?.classList?.toggle?.('reduce-motion', prefs.reduceMotion);
                } else if (args.key === 'clickFx') prefs.clickFx = !!args.value;
                else if (args.key === 'language' && ['es-MX', 'en-US'].includes(args.value)) prefs.language = args.value;
                else if (args.key === 'entryGreeting') prefs.entryGreeting = !!args.value;
                else if (args.key === 'city' && String(args.value).trim()) { prefs.city = args.value; prefs.locationSource = 'manual'; prefs.useDeviceLocation = false; }
                else if (args.key === 'timezone') { try { new Intl.DateTimeFormat('es', { timeZone: args.value }).format(); prefs.timezone = args.value; } catch { throw new Error('Esa zona horaria no es válida. Usa, por ejemplo, America/Bogota.'); } }
                else throw new Error('Esa preferencia no está permitida.');
                runtime.localStorage.setItem('gunter_prefs', JSON.stringify(prefs));
                if (['city', 'timezone', 'entryGreeting'].includes(args.key)) runtime.GunterPresence?.savePreferences?.(prefs);
                const controlId = { reduceMotion: 'pref-reduce-motion', clickFx: 'pref-click-fx', language: 'pref-language', colorMode: 'pref-dark-mode', entryGreeting: 'pref-entry-greeting', city: 'pref-city', timezone: 'pref-timezone' }[args.key];
                const control = controlId && runtime.document?.getElementById?.(controlId);
                if (control) ['language', 'city', 'timezone'].includes(args.key) ? control.value = args.value : control.checked = args.key === 'colorMode' ? args.value === 'dark' : !!args.value;
                return { key: args.key, value: args.value };
            },
            async verify(result, args) {
                if (args.key === 'calendarPlanning') {
                    if (taskOwnerId() !== args.ownerId) return false;
                    const service = options.eventsService || runtime.GunterEventsService;
                    const saved = await service?.getPlanningPreferences?.(args.ownerId);
                    return taskOwnerId() === args.ownerId && JSON.stringify(saved) === JSON.stringify(args.newPlanningPreferences)
                        && JSON.stringify(result.value) === JSON.stringify(saved);
                }
                if (args.key === 'colorMode') return runtime.localStorage?.getItem('gunter_color_mode') === args.value;
                try { return JSON.parse(runtime.localStorage?.getItem('gunter_prefs') || '{}')[args.key] === args.value; } catch { return false; }
            },
            formatResult(result) { return result.key === 'calendarPlanning'
                ? `Planificación guardada y verificada para tu cuenta. ${calendarPlanningLabel(result.value)}`
                : `Preferencia actualizada: ${{ colorMode: 'modo de color', reduceMotion: 'movimiento reducido', clickFx: 'efectos de clic', language: 'idioma', city: 'ciudad', timezone: 'zona horaria', entryGreeting: 'saludo al entrar' }[result.key]} quedó en ${displaySettingValue(result.value)}.`; }
        });

        register({
            id: 'desktop.permissions.update', description: 'Cambia el alcance real de archivos y programas del PC vinculado.', confirm: 'always', reversible: true,
            validate(args) { return ['all', 'standard'].includes(args.scope) ? { ok: true } : { ok: false, reply: 'Dime si quieres acceso general o limitado para el PC.' }; },
            confirmation(args) {
                return args.scope === 'all'
                    ? '¿Confirmas conceder a este PC acceso amplio a archivos, carpetas y programas permitidos por Windows? No concede permisos de administrador ni garantiza controlar aplicaciones incompatibles. Las acciones externas o destructivas seguirán pidiendo confirmación.'
                    : '¿Confirmas volver al acceso limitado del PC (carpetas estándar y lista segura de programas)?';
            },
            async execute(args) {
                const control = runtime.GunterControlPlane;
                if (!control?.nodes || !control?.queueCommand || !control?.waitForCommand) throw new Error('El servicio de permisos del PC no está disponible.');
                const data = await control.nodes();
                const node = (data.items || []).find(item => item.nodeType === 'DESKTOP' && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
                if (!node) throw new Error('No hay un PC de escritorio vinculado y conectado. Abre Configuración → Asistente IA → Dispositivos para vincularlo.');
                const queued = await control.queueCommand({ nodeId: node.nodeId, skill: 'desktop.permissions.update',
                    payload: { filesystemScope: args.scope, programScope: args.scope, confirmed: true }, autonomy: 'L2', confirmed: true,
                    inputSource: args.inputSource || 'text',
                    idempotencyKey: `assistant:permissions:${node.nodeId}:${args.scope}:${Date.now()}`, ttlMs: 120000 });
                const command = await control.waitForCommand(queued.command.id, { timeoutMs: 60000 });
                if (command.state !== 'VERIFIED') throw new Error(command.error || command.result?.error || 'El PC no verificó el cambio de permisos.');
                return { scope: args.scope, node: node.deviceName, evidence: command.evidence || {} };
            },
            verify(result, args) { return result?.scope === args.scope && result.evidence?.permissionsUpdated === true; },
            formatResult(result) { return `Permisos actualizados y verificados en ${result.node}: alcance ${result.scope === 'all' ? 'general' : 'limitado'}.`; }
        });

        register({
            id: 'settings.list', description: 'Consulta ajustes del asistente, incluidos sus campos avanzados.', confirm: 'never', reversible: true,
            validate(args) {
                if (args.calendarPlanning && (!args.ownerId || taskOwnerId() !== args.ownerId || args.planningUnavailable))
                    return { ok: false, reply: args.planningUnavailable || 'Inicia sesión para consultar la planificación de tu cuenta.' };
                return args.unavailable ? { ok: false, reply: 'El panel de configuración no está disponible en esta sesión.' } : { ok: true };
            },
            execute(args) {
                if (args.calendarPlanning) {
                    if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió durante la consulta de planificación.');
                    return { planningPreferences: args.planningPreferences };
                }
                const items = args.items || [];
                if (!items.length) throw new Error('No pude leer el catálogo de configuración.');
                const setting = resolveSettingChange(args.rawText, items).setting;
                if (setting) return { setting };
                return { items };
            },
            verify(result, args) { return args.calendarPlanning
                ? taskOwnerId() === args.ownerId && !!result.planningPreferences : !!(result.setting || result.items?.length); },
            formatResult(result) {
                if (result.planningPreferences) return calendarPlanningLabel(result.planningPreferences);
                if (result.setting) {
                    const fields = (result.setting.advancedFields || []).map(field => `${field}: ${displaySettingValue(result.setting.advanced?.[field])}`).join('; ');
                    return `${result.setting.label}: ${result.setting.enabled ? 'activado' : 'desactivado'}${fields ? `. Opciones avanzadas: ${fields}` : '. No tiene campos avanzados.'}${result.setting.available ? '' : ` (No disponible: ${result.setting.lockedReason || 'plan o despliegue'})`}`;
                }
                return `Puedo consultar y configurar ${result.items.length} áreas: ${result.items.map(item => item.label).join(', ')}. Dime el área y el valor que quieres cambiar.`;
            }
        });

        register({
            id: 'settings.update', description: 'Activa, desactiva o modifica un campo avanzado permitido en la configuración.', confirm: 'always', reversible: true,
            validate(args) {
                if (args.unavailable || !args.setting) return { ok: false, reply: args.unavailable ? 'El panel de configuración no está disponible en esta sesión.' : 'No identifiqué qué configuración quieres cambiar. Dime su nombre, por ejemplo: “activa voz continua” o “cambia retención de memoria a 30 días”.' };
                if (args.field && !(args.setting.advancedFields || []).includes(args.field)) return { ok: false, reply: `“${args.field}” no es un campo configurable de ${args.setting.label}.` };
                if ((args.enabled === true || args.field) && !args.setting.available) return { ok: false, reply: `No puedo cambiar ${args.setting.label}: no está disponible (${args.setting.lockedReason || 'plan o despliegue'}).` };
                if (args.missingField) return { ok: false, reply: `¿Qué opción de ${args.setting.label} quieres cambiar? Dime el campo avanzado y su valor.` };
                if (args.missingValue) return { ok: false, reply: `¿Qué valor quieres poner en ${args.field} de ${args.setting.label}?` };
                if (args.jsonRequired) return { ok: false, reply: `Ese campo requiere un objeto JSON válido. Puedes consultar su formato desde Configuración → Asistente IA.` };
                if (args.invalidValue) return { ok: false, reply: `Ese valor no es válido para ${args.field}. ${/days|minutes|limit|budget|threshold|ram|storage/i.test(args.field || '') ? 'Indica un número igual o mayor que cero.' : 'Indica sí/no o un valor compatible.'}` };
                if (args.enabled === undefined && (!args.field || args.value === undefined)) return { ok: false, reply: 'Dime qué campo avanzado y qué valor quieres aplicar.' };
                return { ok: true };
            },
            confirmation(args) {
                const change = args.enabled !== undefined
                    ? `${args.enabled ? 'activar' : 'desactivar'} ${args.setting.label}`
                    : `cambiar ${args.setting.label} → ${args.field} a ${displaySettingValue(args.value)}`;
                return `¿Confirmas que aplique este cambio de configuración: ${change}?`;
            },
            async execute(args) {
                const control = runtime.GunterControlPlane;
                const update = args.enabled !== undefined
                    ? { key: args.setting.key, enabled: args.enabled, baseUpdatedAt: args.setting.updatedAt || null }
                    : { key: args.setting.key, advanced: { ...(args.setting.advanced || {}), [args.field]: args.value }, baseUpdatedAt: args.setting.updatedAt || null };
                const result = await control.updateSetting(update);
                if (result.queued) return { queued: true, setting: result.setting || { ...args.setting, ...update } };
                const fresh = await control.settings();
                const setting = (fresh.items || []).find(item => item.key === args.setting.key);
                return { setting, queued: false };
            },
            verify(result, args) {
                if (result.queued) return true;
                if (!result.setting) return false;
                return args.enabled !== undefined ? result.setting.requestedEnabled === args.enabled || result.setting.enabled === args.enabled
                    : JSON.stringify(result.setting.advanced?.[args.field]) === JSON.stringify(args.value);
            },
            formatResult(result, args) {
                const change = args.enabled !== undefined ? `${args.setting.label} quedó ${args.enabled ? 'activado' : 'desactivado'}` : `${args.field} de ${args.setting.label} quedó en ${displaySettingValue(args.value)}`;
                return result.queued ? `${change}; el cambio está en cola y se sincronizará cuando vuelva la conexión.` : `${change} y verificado en la configuración.`;
            }
        });

        register({
            id: 'procedure.execute',
            description: 'Ejecuta una ruta aprendida y aprobada bajo supervisión.',
            confirm: 'always', reversible: false,
            validate(args) {
                if (!args.name) return { ok: false, reply: '¿Qué ruta quieres ejecutar?' };
                return args.target ? { ok: true } : { ok: false, reply: 'No encontré una ruta aprobada con ese nombre. Revísala en Configuración → Datos y conexiones.' };
            },
            confirmation(args) { return `¿Confirmas que ejecute la ruta “${args.target.name}”? Los pasos que escriben o pulsan volverán a pedir autorización.`; },
            async execute(args) {
                const recorder = runtime.GunterProcedureRecorder;
                if (!recorder?.execute) throw new Error('El ejecutor de rutas no está disponible en esta pantalla.');
                return recorder.execute(args.target.id);
            },
            verify(result) { return result?.ok === true && Array.isArray(result.executed); },
            formatResult(result, args) { return `Completé la ruta “${args.target.name}” con ${result.executed.length} paso(s) verificado(s).`; }
        });

        register({
            id: 'desktop.apps.open',
            description: 'Abre una aplicación permitida en el PC conectado.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.programPath ? { ok: true } : { ok: false, reply: '¿Qué programa quieres abrir?' }; },
            execute(args) { return executeDesktopSkill('desktop.apps.open', { app: args.app, programPath: args.programPath }, args.inputSource); },
            verify(result) { return result?.evidence?.processStarted === true; },
            formatResult(result, args) { return `Abrí ${args.app || args.programPath} en tu PC.`; }
        });

        for (const id of ['desktop.browser.open', 'desktop.browser.search', 'desktop.browser.youtube.play']) register({
            id, description: id.endsWith('youtube.play') ? 'Busca y reproduce un video o mix de YouTube en el navegador del PC.' : id.endsWith('search') ? 'Busca contenido en el navegador del PC.' : 'Abre una dirección web en el navegador del PC.',
            confirm: 'never', reversible: true,
            validate(args) {
                if (!args.url && !args.query) return { ok: false, reply: '¿Qué dirección o contenido quieres abrir en el navegador?' };
                if (args.url) { try { const url = new URL(args.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { return { ok: false, reply: 'Necesito una dirección HTTP o HTTPS válida.' }; } }
                return { ok: true };
            },
            execute(args) { return executeDesktopSkill(id, args, args.inputSource); },
            verify(result) { return result.evidence?.pageObserved === true && (id !== 'desktop.browser.youtube.play' || result.evidence?.playbackObserved === true && result.evidence?.mediaAdvanced === true); },
            formatResult(result) { return id === 'desktop.browser.youtube.play' ? `Está reproduciéndose en ${result.browser === 'default' ? 'el navegador' : result.browser}: ${result.title || result.query}.` : `Abrí ${result.url} en ${result.browser === 'default' ? 'el navegador' : result.browser}.`; }
        });

        register({
            id: 'mobile.open_app',
            description: 'Abre una aplicación o enlace permitido en el móvil conectado.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.programPath ? { ok: true } : { ok: false, reply: '¿Qué aplicación quieres abrir en el móvil?' }; },
            execute(args) { return executeMobileSkill('mobile.open_app', { app: args.app, deepLink: args.deepLink }, args.inputSource); },
            verify(result) { return result?.evidence?.appOpened === true; },
            formatResult(result, args) { return `Abrí ${args.app || result.opened || 'la aplicación solicitada'} en el móvil.`; }
        });

        register({
            id: 'mobile.files.list', description: 'Lista la carpeta autorizada en el móvil conectado.', confirm: 'never', reversible: true,
            execute(args) { return executeMobileSkill('mobile.files.list', {}, args.inputSource); },
            verify(result) { return result?.evidence?.folderRead === true; },
            formatResult(result) {
                const items = result.items || [];
                if (!items.length) return 'La carpeta autorizada está vacía.';
                return `En el móvil encontré ${items.length} elemento(s):\n${items.slice(0, 12).map(item => `• ${item.name}${item.directory ? ' (carpeta)' : ''}`).join('\n')}${items.length > 12 ? '\n• …' : ''}`;
            }
        });

        register({
            id: 'mobile.files.search', description: 'Busca nombres dentro de la carpeta autorizada del móvil.', confirm: 'never', reversible: true,
            validate(args) { return args.query ? { ok: true } : { ok: false, reply: '¿Qué nombre debo buscar en la carpeta autorizada del móvil?' }; },
            execute(args) { return executeMobileSkill('mobile.files.search', { query: args.query }, args.inputSource); },
            verify(result) { return result?.evidence?.searchCompleted === true; },
            formatResult(result, args) {
                const items = result.items || [];
                if (!items.length) return `No encontré “${args.query}” en la carpeta autorizada del móvil.`;
                return `Encontré ${items.length} coincidencia(s) en el móvil:\n${items.slice(0, 10).map(item => `• ${item.name}`).join('\n')}`;
            }
        });

        register({
            id: 'mobile.files.open', description: 'Abre un archivo por nombre dentro de la carpeta autorizada del móvil.', confirm: 'never', reversible: true,
            validate(args) { return args.fileName ? { ok: true } : { ok: false, reply: '¿Qué archivo debo abrir dentro de la carpeta autorizada del móvil?' }; },
            execute(args) { return executeMobileSkill('mobile.files.open', { fileName: args.fileName }, args.inputSource); },
            verify(result) { return result?.evidence?.fileOpened === true; },
            formatResult(result) { return `Abrí ${result.file || 'el archivo solicitado'} en el móvil.`; }
        });

        [['play_pause', 'Actualiza la reproducción del móvil.', 'Actualicé la reproducción del móvil.'], ['next', 'Avanza a la siguiente pista en el móvil.', 'Pasé a la siguiente pista en el móvil.']].forEach(([action, description, reply]) => register({
            id: `mobile.media.${action}`, description, confirm: 'never', reversible: true,
            execute(args) { return executeMobileSkill(`mobile.media.${action}`, {}, args.inputSource); },
            verify(result) { return result?.evidence?.playbackStateChanged === true || result?.evidence?.playbackStateObserved === true; },
            formatResult() { return reply; }
        }));

        register({
            id: 'desktop.files.open',
            description: 'Abre un archivo o carpeta por su ruta completa en el PC conectado.',
            confirm: 'never', reversible: true,
            validate(args) { return args.path ? { ok: true } : { ok: false, reply: 'Dime la ruta completa del archivo o carpeta.' }; },
            execute(args) { return executeDesktopSkill('desktop.files.open', { path: args.path }, args.inputSource); },
            verify(result) { return result?.evidence?.pathOpened === true; },
            formatResult(result) { return `Abrí ${result.name || 'la ruta solicitada'} en tu PC.`; }
        });

        register({
            id: 'desktop.files.list',
            description: 'Lista el contenido de cualquier carpeta autorizada del PC.',
            confirm: 'never', reversible: true,
            validate(args) { return args.path ? { ok: true } : { ok: false, reply: 'Dime qué carpeta quieres revisar usando su ruta completa.' }; },
            execute(args) { return executeDesktopSkill('desktop.files.list', { path: args.path, limit: 100 }, args.inputSource); },
            verify(result) { return result?.evidence?.pathRead === true; },
            formatResult(result) {
                const items = result.items || [];
                if (!items.length) return 'La carpeta está vacía.';
                return `Encontré ${items.length} elemento(s):\n${items.slice(0, 12).map(item => `• ${item.name}${item.kind === 'folder' ? ' (carpeta)' : ''}`).join('\n')}${items.length > 12 ? '\n• …' : ''}`;
            }
        });

        register({
            id: 'desktop.files.search',
            description: 'Busca archivos o carpetas por nombre desde una ruta autorizada.',
            confirm: 'never', reversible: true,
            validate(args) {
                if (!args.query) return { ok: false, reply: '¿Qué archivo o carpeta debo buscar?' };
                if (!args.root) return { ok: false, reply: '¿Desde qué carpeta o disco debo buscar? Dime la ruta completa.' };
                return { ok: true };
            },
            execute(args) { return executeDesktopSkill('desktop.files.search', { root: args.root, query: args.query, limit: 50, maxDepth: 8 }, args.inputSource); },
            verify(result) { return result?.evidence?.searchCompleted === true; },
            formatResult(result, args) {
                const items = result.items || [];
                if (!items.length) return `No encontré “${args.query}” dentro de ${args.root}.`;
                return `Encontré ${items.length} coincidencia(s):\n${items.slice(0, 10).map(item => `• ${item.path}`).join('\n')}`;
            }
        });

        [
            ['play_pause', 'Controla la reproducción multimedia del PC.', 'Reproducción actualizada.'],
            ['next', 'Avanza a la siguiente pista multimedia.', 'Pasé a la siguiente pista.'],
            ['previous', 'Regresa a la pista multimedia anterior.', 'Volví a la pista anterior.'],
            ['stop', 'Detiene la reproducción multimedia.', 'Detuve la reproducción.'],
            ['volume_up', 'Sube el volumen multimedia.', 'Subí el volumen.'],
            ['volume_down', 'Baja el volumen multimedia.', 'Bajé el volumen.'],
            ['mute', 'Activa o desactiva el silencio multimedia.', 'Cambié el estado de silencio.']
        ].forEach(([action, description, reply]) => register({
            id: `desktop.media.${action}`,
            description,
            confirm: 'never', reversible: true,
            execute(args) { return executeDesktopSkill(`desktop.media.${action}`, {}, args.inputSource); },
            verify(result) { return result?.evidence?.mediaCommandSent === true; },
            formatResult() { return reply; }
        }));

        register({
            id: 'desktop.ui.inspect',
            description: 'Enumera controles accesibles de una aplicación sin leer el contenido escrito.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.window ? { ok: true } : { ok: false, reply: '¿Qué aplicación o ventana quieres revisar?' }; },
            execute(args) { return executeDesktopSkill('desktop.ui.inspect', { app: args.app, window: args.window, limit: 120 }, args.inputSource); },
            verify(result) { return result?.evidence?.controlsInspected === true; },
            formatResult(result) {
                const controls = result.controls || [];
                if (!controls.length) return `No encontré controles accesibles en ${result.window || 'esa aplicación'}.`;
                return `En ${result.window || 'la aplicación'} encontré ${controls.length} controles accesibles:\n${controls.slice(0, 15).map(item => `• ${item.name || item.automationId} (${item.controlType})`).join('\n')}${controls.length > 15 ? '\n• …' : ''}`;
            }
        });

        register({
            id: 'desktop.ui.focus',
            description: 'Lleva una aplicación o control accesible al frente.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.window ? { ok: true } : { ok: false, reply: '¿Qué aplicación o ventana quieres enfocar?' }; },
            execute(args) { return executeDesktopSkill('desktop.ui.focus', { app: args.app, window: args.window, target: args.target }, args.inputSource); },
            verify(result) { return result?.evidence?.windowFocused === true; },
            formatResult(result) { return `Enfoqué ${result.window || 'la aplicación solicitada'}.`; }
        });

        register({
            id: 'desktop.ui.click',
            description: 'Pulsa un control accesible de otra aplicación con confirmación explícita.',
            confirm: 'always', reversible: false,
            validate(args) {
                if (!args.app && !args.window) return { ok: false, reply: '¿En qué aplicación o ventana está el control?' };
                return args.target?.name || args.target?.automationId ? { ok: true } : { ok: false, reply: '¿Qué botón o control debo pulsar?' };
            },
            confirmation(args) { return `¿Confirmas que pulse “${args.target.name || args.target.automationId}” en ${args.app || args.window}?`; },
            execute(args) { return executeDesktopSkill('desktop.ui.click', { app: args.app, window: args.window, target: args.target }, args.inputSource); },
            verify(result) { return result?.evidence?.controlInvoked === true; },
            formatResult(result) { return `Pulsé “${result.target || 'el control solicitado'}” y el PC confirmó la acción.`; }
        });

        register({
            id: 'desktop.ui.type',
            description: 'Establece texto en un campo accesible de otra aplicación con confirmación explícita.',
            confirm: 'always', reversible: false,
            validate(args) {
                if (!args.text) return { ok: false, reply: '¿Qué texto quieres escribir?' };
                if (!args.app && !args.window) return { ok: false, reply: '¿En qué aplicación o ventana debo escribir?' };
                if (isSensitiveUiTarget(args.target)) return { ok: false, reply: 'Por seguridad no escribo contraseñas, códigos, tokens, PIN ni OTP.' };
                return args.target?.name || args.target?.automationId ? { ok: true } : { ok: false, reply: '¿En qué campo debo escribir?' };
            },
            confirmation(args) { return `¿Confirmas que escriba “${args.text}” en el campo “${args.target.name || args.target.automationId}” de ${args.app || args.window}?`; },
            execute(args) { return executeDesktopSkill('desktop.ui.type', { app: args.app, window: args.window, target: args.target, text: args.text }, args.inputSource); },
            verify(result) { return result?.evidence?.valueSet === true; },
            formatResult(result) { return `Escribí en “${result.target || 'el campo solicitado'}” y el PC verificó el cambio.`; }
        });

        register({
            id: 'desktop.ui.wait',
            description: 'Espera de forma acotada hasta que aparezca un control accesible.',
            confirm: 'never', reversible: true,
            validate(args) {
                if (!args.app && !args.window) return { ok: false, reply: '¿En qué aplicación debo esperar?' };
                return args.target?.name || args.target?.automationId ? { ok: true } : { ok: false, reply: '¿Qué control debe aparecer?' };
            },
            execute(args) { return executeDesktopSkill('desktop.ui.wait', { app: args.app, window: args.window, target: args.target, timeoutMs: args.timeoutMs || 10000 }, args.inputSource); },
            verify(result) { return result?.evidence?.targetObserved === true; },
            formatResult(result) { return `Ya está disponible “${result.target || 'el control solicitado'}”.`; }
        });

        register({
            id: 'desktop.ui.scroll',
            description: 'Desplaza un panel accesible en una dirección y verifica el cambio.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.window ? { ok: true } : { ok: false, reply: '¿En qué aplicación debo desplazarme?' }; },
            execute(args) { return executeDesktopSkill('desktop.ui.scroll', { app: args.app, window: args.window, target: args.target, direction: args.direction, amount: args.amount || 3 }, args.inputSource); },
            verify(result) { return result?.evidence?.scrollChanged === true; },
            formatResult(result) { return `Desplacé ${result.direction || 'el contenido'} y verifiqué el movimiento.`; }
        });

        register({
            id: 'desktop.ui.hotkey',
            description: 'Ejecuta únicamente un atajo de teclado incluido en la lista segura.',
            confirm: 'always', reversible: false,
            validate(args) {
                if (!args.shortcut) return { ok: false, reply: '¿Qué atajo seguro quieres usar?' };
                return args.app || args.window ? { ok: true } : { ok: false, reply: '¿En qué aplicación debo usar el atajo?' };
            },
            confirmation(args) { return `¿Confirmas que use ${args.shortcut} en ${args.app || args.window}?`; },
            execute(args) { return executeDesktopSkill('desktop.ui.hotkey', { app: args.app, window: args.window, shortcut: args.shortcut }, args.inputSource); },
            verify(result) { return result?.evidence?.shortcutSent === true; },
            formatResult(result) { return `Usé ${result.shortcut || 'el atajo'} en ${result.window || 'la aplicación'} y el PC confirmó el envío.`; }
        });

        register({
            id: 'desktop.ui.select_file',
            description: 'Selecciona un archivo permitido dentro de un diálogo nativo, con confirmación.',
            confirm: 'always', reversible: false,
            validate(args) {
                if (!args.filePath) return { ok: false, reply: '¿Cuál es la ruta completa del archivo?' };
                return args.app || args.window ? { ok: true } : { ok: false, reply: '¿En qué aplicación está abierto el selector de archivos?' };
            },
            confirmation(args) { return `¿Confirmas que seleccione “${args.filePath}” en ${args.app || args.window}? La aplicación podría comenzar a subirlo.`; },
            execute(args) { return executeDesktopSkill('desktop.ui.select_file', { app: args.app, window: args.window, filePath: args.filePath }, args.inputSource); },
            verify(result) { return result?.evidence?.fileSelected === true; },
            formatResult(result) { return `Seleccioné “${result.fileName || 'el archivo'}” y el diálogo confirmó la acción.`; }
        });

        register({
            id: 'agenda.list',
            description: 'Consulta tareas y eventos locales.',
            confirm: 'never',
            reversible: true,
            async execute(args) {
                const tasksService = options.tasksService || runtime.GunterTasksService;
                const eventsService = options.eventsService || runtime.GunterEventsService;
                if (!tasksService?.list || !eventsService?.list) throw new Error('Los servicios de agenda no están disponibles en esta pantalla.');
                const ownerId = taskOwnerId();
                if (runtime.GunterAuth && !ownerId) throw new Error('Inicia sesión para consultar tu agenda local.');
                const allTasks = (await tasksService.list()).filter(item => !runtime.GunterAuth || item.ownerId === ownerId);
                const allEvents = (await eventsService.list()).filter(item => !runtime.GunterAuth || item.ownerId === ownerId);
                const target = new Date(now());
                if (args.scope === 'tomorrow') target.setDate(target.getDate() + 1);
                const targetKey = dateKey(target, timezone());
                const activeTasks = allTasks.filter(item => item.status !== 'done' && item.status !== 'cancelled');
                const tasks = args.scope === 'upcoming'
                    ? activeTasks.filter(item => !item.dueAt || new Date(item.dueAt) >= now()).slice(0, 8)
                    : activeTasks.filter(item => !item.dueAt || dateKey(item.dueAt, timezone()) === targetKey);
                const activeEvents = allEvents.filter(item => (item.status || 'scheduled') === 'scheduled');
                const events = args.scope === 'upcoming'
                    ? activeEvents.filter(item => item.startAt && new Date(item.startAt) >= now()).slice(0, 8)
                    : activeEvents.filter(item => item.startAt && dateKey(item.startAt, timezone()) === targetKey);
                return { scope: args.scope, tasks, events };
            },
            formatResult(result) {
                const label = result.scope === 'tomorrow' ? 'mañana' : result.scope === 'upcoming' ? 'próximamente' : 'hoy';
                if (!result.tasks.length && !result.events.length) return `No tienes tareas ni eventos ${label}.`;
                const lines = [`Esto tienes ${label}:`];
                result.events.forEach(event => lines.push(`${lines.length}. Evento: ${formatTime(event.startAt, timezone())} — ${event.title}`));
                result.tasks.forEach(task => lines.push(`${lines.length}. Tarea: ${task.title}${task.dueAt ? ` (${formatTime(task.dueAt, timezone())})` : ''}`));
                return lines.join('\n');
            }
        });

        register({
            id: 'jobs.list',
            description: 'Lista recordatorios y seguimientos persistentes.',
            confirm: 'never',
            reversible: true,
            async execute(args) {
                const result = await reminderItems(args.status === 'failed' ? { status: 'failed' } : {});
                const items = result.items.filter(job => args.status === 'failed' ? job.status === 'failed'
                    : !['completed', 'fired', 'failed', 'cancelled'].includes(job.status))
                    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt)).slice(0, 12);
                return { ...result, failed: args.status === 'failed', items: args.status === 'failed' ? items.map(reminderPublicRecord) : items };
            },
            formatResult(result) {
                const warning = result.durableUnavailable ? '\nNo pude consultar los avisos del servidor; los vinculados locales requieren Gunter abierto.' : '';
                if (!result.items.length) return (result.failed ? 'No encontré avisos fallidos en los registros consultados.' : result.durableUnavailable ? 'No hay avisos locales vinculados activos.' : 'No tienes recordatorios ni seguimientos programados.') + warning;
                const lines = [result.failed ? 'Avisos fallidos registrados:' : 'Procesos programados:'];
                result.items.forEach((job, index) => {
                    const kind = job.type === 'follow_up' ? 'Seguimiento' : 'Recordatorio';
                    lines.push(`${index + 1}. ${kind}: ${job.title} — ${withoutFinalPeriod(formatDateTime(job.runAt, timezone()))}${job.meta?.eventLink ? ' · vinculado a reunión, requiere Gunter abierto' : ''}`);
                });
                if (result.failed) lines.push('Puedes preguntar “por qué falló el primero” o solicitar “reintenta el primero”. Cada reintento necesita confirmación; no reactivaré todos los avisos.');
                return lines.join('\n') + warning;
            }
        });

        function validateReminderOperation(args, retry = false) {
            if (!args.ownerId || taskOwnerId() !== args.ownerId) return { ok: false, reply: 'Inicia sesión con tu cuenta antes de consultar o reintentar tus recordatorios.' };
            if (args.compound) return { ok: false, reply: 'Dime un aviso y una acción por orden. No reintentaré todos los avisos ni aplicaré solo una parte de una solicitud compuesta.' };
            const service = options.jobsService || runtime.GunterJobs;
            if (args.unavailable || !service?.get || (retry && !service?.retryReminder))
                return { ok: false, reply: 'No pude consultar el servicio local de recordatorios. Comprueba que el servidor de Gunter esté disponible; no deduciré la causa ni crearé otro aviso.' };
            if (args.ambiguous) return { ok: false, reply: `Hay varios avisos con ese nombre. Elige el número:\n${args.candidates.map((row, i) => `${i + 1}. ${row.title} — ${reminderStateLabel(row.status)}, ${formatDateTime(row.runAt, timezone())}`).join('\n')}` };
            if (!args.targetId || !args.snapshot) return { ok: false, reply: 'No encontré un aviso con ese nombre exacto. Consulta “mis recordatorios fallidos” o indica su identificador; no escogeré otro por aproximación.' };
            if (retry && args.restricted) return { ok: false, reply: args.restricted };
            return { ok: true };
        }

        register({
            id: 'reminder.inspect',
            description: 'Consulta el estado registrado de un aviso y explica sus límites sin inventar causas.',
            confirm: 'never', reversible: true,
            validate: args => validateReminderOperation(args),
            async execute(args) {
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                const row = await referencedRow({ id: args.targetId, kind: 'reminder' });
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                // IDs can be outside the bounded list; a direct account-scoped
                // lookup is still read-only and must be rechecked after await.
                const current = row || (/^job_[\w-]{1,100}$/.test(args.targetId)
                    ? await (options.jobsService || runtime.GunterJobs).get(args.targetId) : null);
                if (taskOwnerId() !== args.ownerId || (current?.ownerId != null && current.ownerId !== args.ownerId)) throw new Error('job_owner_mismatch');
                if (!current) throw new Error('job_not_found');
                return { ...reminderPublicRecord(current), diagnosis: reminderDiagnosis(current, timezone()) };
            },
            verify(result, args) { return taskOwnerId() === args.ownerId && result?.id === args.targetId && typeof result.diagnosis === 'string'; },
            formatResult: result => `“${result.title}” — ${reminderStateLabel(result.status)}.\n${result.diagnosis}`
        });

        register({
            id: 'reminder.retry',
            description: 'Vuelve a programar un recordatorio independiente fallido, con confirmación y verificación.',
            confirm: 'always', reversible: false,
            validate: args => validateReminderOperation(args, true),
            confirmation(args) {
                return `¿Confirmas reintentar ahora “${args.targetTitle}”? Conservaré el mismo aviso y reiniciaré sus intentos. El servidor local debe seguir funcionando; esto no garantiza la entrega al teléfono y, si ya recibiste el aviso por otro canal, podrías verlo otra vez.`;
            },
            async execute(args) {
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                const service = options.jobsService || runtime.GunterJobs;
                const current = await service.get(args.targetId);
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                if (!current || (current.ownerId != null && current.ownerId !== args.ownerId)
                    || reminderRetryRestriction(current) || JSON.stringify(reminderSnapshot(current)) !== JSON.stringify(args.snapshot))
                    throw new Error('job_changed');
                const result = await service.retryReminder(args.targetId, { ownerId: args.ownerId, expected: args.snapshot, confirmed: true });
                if (taskOwnerId() !== args.ownerId || (result?.ownerId != null && result.ownerId !== args.ownerId)) throw new Error('job_owner_mismatch');
                if (!result || result.id !== args.targetId || result.type !== 'reminder' || result.status !== 'scheduled'
                    || result.attempts !== 0 || result.lastError != null || result.result != null || result.nextAttemptAt != null)
                    throw new Error('REMINDER_RETRY_NOT_VERIFIED');
                return { ...reminderPublicRecord(result), lastError: null, result: null };
            },
            async verify(result, args) {
                if (taskOwnerId() !== args.ownerId || result?.id !== args.targetId || result.type !== 'reminder'
                    || result.status !== 'scheduled' || result.attempts !== 0 || result.lastError != null
                    || result.result != null || result.nextAttemptAt != null) return false;
                const stored = await (options.jobsService || runtime.GunterJobs).get(args.targetId);
                if (taskOwnerId() !== args.ownerId || !stored || (stored.ownerId != null && stored.ownerId !== args.ownerId)) return false;
                return stored.type === 'reminder' && stored.status === 'scheduled' && stored.attempts === 0
                    && stored.lastError == null && stored.result == null && stored.nextAttemptAt == null
                    && stored.title === args.snapshot.title && (stored.priority || 'normal') === args.snapshot.priority
                    && Number.isSafeInteger(stored.revision) && stored.revision > args.snapshot.revision
                    && Number.isFinite(Date.parse(stored.runAt))
                    && JSON.stringify(reminderSnapshot(stored)) === JSON.stringify(reminderSnapshot(result));
            },
            formatResult: result => `Reintento programado y guardado para “${result.title}”. Conservé el mismo aviso. Aún no puedo afirmar que se haya entregado; consulta su estado después de que lo procese el servidor local.`
        });

        register({
            id: 'reminder.update',
            description: 'Edita o reprograma un recordatorio independiente guardado, con confirmación.',
            confirm: 'always', reversible: true,
            validate(args) {
                if (!args.ownerId || taskOwnerId() !== args.ownerId) return { ok: false, reply: 'Inicia sesión con tu cuenta antes de editar tus recordatorios.' };
                if (args.compound) return { ok: false, reply: 'Dime un cambio por orden: el nombre o la fecha y hora. No aplicaré solo una parte de una solicitud compuesta.' };
                const service = options.jobsService || runtime.GunterJobs;
                if (args.unavailable || !service?.get || !service?.updateReminder)
                    return { ok: false, reply: 'No pude consultar el servicio local de recordatorios persistentes. Comprueba que el servidor de Gunter esté disponible; no cambié ni creé otro aviso.' };
                if (args.ambiguous) return { ok: false, reply: `Hay varios avisos con ese nombre. Elige el número:\n${args.candidates.map((row, i) => `${i + 1}. ${row.title} — ${formatDateTime(row.runAt, timezone())}`).join('\n')}` };
                if (!args.targetId || !args.snapshot) return { ok: false, reply: 'No encontré un recordatorio activo con ese nombre exacto. Puedes consultar “mis recordatorios” o indicar su identificador.' };
                if (args.restricted) return { ok: false, reply: args.restricted };
                if (args.editMode === 'title') {
                    if (typeof args.newTitle !== 'string' || args.newTitle.trim().length < 2 || args.newTitle.length > 180)
                        return { ok: false, reply: 'Dime un nombre de 2 a 180 caracteres para el recordatorio.' };
                } else if (args.editMode === 'time') {
                    if (args.invalidTime) return { ok: false, reply: 'Esa fecha no existe en el calendario. Dime una fecha válida; no cambié el aviso.' };
                    const instant = Date.parse(args.runAt);
                    if (!Number.isFinite(instant) || args.timeKind === 'allDay' || args.newRecurrence)
                        return { ok: false, reply: 'Dime una fecha y hora exactas para el aviso, sin recurrencia. No inventaré un horario.' };
                    if (instant <= referenceNow() || instant > referenceNow() + 366 * 86400000)
                        return { ok: false, reply: 'La nueva fecha debe ser futura y estar dentro de los próximos 366 días.' };
                } else return { ok: false, reply: 'Puedo cambiar el nombre o la fecha y hora del recordatorio. Indica qué quieres modificar.' };
                return { ok: true };
            },
            confirmation(args) {
                const current = `“${args.targetTitle}”, programado para ${formatDateTime(args.snapshot.runAt, timezone())}`;
                return args.editMode === 'title'
                    ? `¿Confirmas renombrar el recordatorio ${current} como “${args.newTitle}”? Conservaré su horario y los demás datos.`
                    : `¿Confirmas reprogramar el recordatorio ${current} para ${formatDateTime(args.runAt, timezone())}? Actualizaré el mismo aviso, sin crear otro.`;
            },
            async execute(args) {
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                const service = options.jobsService || runtime.GunterJobs;
                const current = await service.get(args.targetId);
                if (taskOwnerId() !== args.ownerId) throw new Error('job_owner_mismatch');
                if (!current || (current.ownerId != null && current.ownerId !== args.ownerId)
                    || reminderRestriction(current) || JSON.stringify(reminderSnapshot(current)) !== JSON.stringify(args.snapshot))
                    throw new Error('job_changed');
                const patch = args.editMode === 'title' ? { title: args.newTitle.trim() } : { runAt: args.runAt };
                return service.updateReminder(args.targetId, patch, { ownerId: args.ownerId, expected: args.snapshot, confirmed: true });
            },
            async verify(result, args) {
                if (taskOwnerId() !== args.ownerId || result?.id !== args.targetId) return false;
                const service = options.jobsService || runtime.GunterJobs;
                const stored = await service.get(args.targetId);
                if (taskOwnerId() !== args.ownerId || !stored || (stored.ownerId != null && stored.ownerId !== args.ownerId)
                    || stored.type !== 'reminder' || stored.status !== 'scheduled'
                    || !Number.isSafeInteger(stored.revision) || stored.revision <= args.snapshot.revision
                    || (stored.priority || 'normal') !== args.snapshot.priority) return false;
                return stored.title === (args.editMode === 'title' ? args.newTitle.trim() : args.snapshot.title)
                    && Date.parse(stored.runAt) === Date.parse(args.editMode === 'time' ? args.runAt : args.snapshot.runAt)
                    && JSON.stringify(reminderSnapshot(stored)) === JSON.stringify(reminderSnapshot(result));
            },
            formatResult(result, args) {
                return args.editMode === 'title' ? `Nombre del recordatorio actualizado y verificado: “${result.title}”. Conservé su horario.`
                    : `Recordatorio reprogramado y verificado: “${result.title}”, ${withoutFinalPeriod(formatDateTime(result.runAt, timezone()))}. Conservé el mismo aviso y no se entregará a la hora anterior.`;
            }
        });

        register({
            id: 'reminder.schedule',
            description: 'Programa un recordatorio independiente persistente o un aviso local vinculado a una reunión.',
            confirm: 'never',
            reversible: true,
            async validate(args) {
                if (args.eventReminderRequest && !args.eventLink) {
                    return { ok: false, reply: args.ambiguous
                        ? `Hay varias reuniones con ese nombre. Elige el número:\n${args.candidates.map((row, i) => `${i + 1}. ${row.title} — ${formatDateTime(row.startAt, timezone())}`).join('\n')}`
                        : 'No encontré una reunión local activa con ese nombre exacto. Consulta tu agenda o dime su nombre registrado.' };
                }
                if (args.eventLink) {
                    if (!args.ownerId || taskOwnerId() !== args.ownerId || args.eventLink.ownerId !== args.ownerId)
                        return { ok: false, reply: 'La cuenta cambió. Solicita el aviso desde tu propia sesión.' };
                    if (args.restricted) return { ok: false, reply: args.restricted };
                    const service = options.eventsService || runtime.GunterEventsService;
                    const notifications = options.notificationsService || runtime.GunterNotificationsService;
                    if (!service?.scheduleReminder || !service?.getReminder || !notifications?.schedule)
                        return { ok: false, reply: 'El servicio de avisos vinculados no está disponible en esta página. Recarga Gunter y solicita el aviso otra vez.' };
                    const row = await referencedRow({ id: args.eventLink.eventId, kind: 'event' });
                    if (!row || eventRestriction(row) || JSON.stringify(eventSnapshot(row)) !== JSON.stringify(args.eventLink.expected))
                        return { ok: false, reply: 'La reunión cambió después de la propuesta. Revisa su horario y vuelve a solicitar el aviso.' };
                    if (!Number.isFinite(Date.parse(row.startAt)) || Date.parse(row.startAt) <= referenceNow())
                        return { ok: false, reply: 'Esa reunión ya empezó o no tiene una hora válida. Elige una reunión futura para vincular un aviso.' };
                    if (!args.runAt) {
                        pendingReminderReference = { id: row.id, kind: 'event', title: row.title, ownerId: args.ownerId, at: referenceNow() };
                        return { ok: false, reply: reminderTimeQuestion(row) };
                    }
                    const fireAt = Date.parse(args.runAt), startAt = Date.parse(row.startAt);
                    if (!Number.isFinite(fireAt) || !Number.isFinite(startAt) || fireAt <= referenceNow() || fireAt > startAt)
                        return { ok: false, reply: 'El aviso debe ser futuro y anterior o igual al inicio de la reunión. No programé nada.' };
                }
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Qué quieres que te recuerde?' };
                if (!args.runAt) return { ok: false, reply: '¿Cuándo quieres que te lo recuerde?' };
                return { ok: true };
            },
            confirmation(args) {
                if (!args.eventLink) return `¿Confirmas el recordatorio “${args.title}”?`;
                const minutes = Math.round((Date.parse(args.eventLink.expected.startAt) - Date.parse(args.runAt)) / 60000);
                return `¿Confirmas vincular un aviso a “${args.title}”, ${minutes} minutos antes (${formatDateTime(args.runAt, timezone())})? Se ajustará al reprogramarla y se cancelará si la cancelas. Requiere Gunter abierto en este navegador; no es un aviso con la app cerrada.`;
            },
            async execute(args) {
                if (args.eventLink) {
                    if (taskOwnerId() !== args.ownerId) throw new Error('EVENT_OWNER_MISMATCH');
                    const service = options.notificationsService || runtime.GunterNotificationsService;
                    return service.schedule({ title: args.title, fireAt: args.runAt,
                        meta: { eventLink: args.eventLink } });
                }
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.scheduleReminder) throw new Error('El servicio de procesos durables no está disponible.');
                return service.scheduleReminder({ title: args.title, runAt: args.runAt, priority: args.priority || 'normal' });
            },
            async verify(result, args) {
                if (args.eventLink) {
                    if (taskOwnerId() !== args.ownerId) return false;
                    const service = options.eventsService || runtime.GunterEventsService;
                    const persisted = await service.getReminder(result.id);
                    return persisted?.ownerId === args.ownerId && persisted.status === 'scheduled'
                        && persisted.meta?.eventLink?.eventId === args.eventLink.eventId
                        && Date.parse(persisted.fireAt) === Date.parse(args.runAt);
                }
                const service = options.jobsService || runtime.GunterJobs;
                const persisted = await service.get(result.id);
                return persisted?.status === 'scheduled' || persisted?.status === 'retry_wait';
            },
            formatResult(result) {
                if (result.meta?.eventLink) return `Aviso vinculado y verificado: “${result.title}”, ${withoutFinalPeriod(formatDateTime(result.fireAt, timezone()))}. Mantendrá la antelación si reprogramas la reunión; requiere Gunter abierto en este navegador.`;
                return `Recordatorio persistente programado y verificado: “${result.title}”, ${withoutFinalPeriod(formatDateTime(result.runAt, timezone()))}. Funcionará aunque cierres esta página.`;
            }
        });

        register({
            id: 'follow_up.schedule',
            description: 'Programa un seguimiento persistente en el servidor.',
            confirm: 'never',
            reversible: true,
            validate(args) {
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Sobre qué asunto quieres programar el seguimiento?' };
                if (!args.runAt) return { ok: false, reply: '¿Cuándo debo hacer el seguimiento?' };
                return { ok: true };
            },
            async execute(args) {
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.scheduleFollowUp) throw new Error('El servicio de procesos durables no está disponible.');
                return service.scheduleFollowUp({ title: args.title, runAt: args.runAt, priority: args.priority || 'normal' });
            },
            async verify(result) {
                const service = options.jobsService || runtime.GunterJobs;
                const persisted = await service.get(result.id);
                return persisted?.status === 'scheduled' || persisted?.status === 'retry_wait';
            },
            formatResult(result) {
                return `Seguimiento persistente programado y verificado: “${result.title}”, ${withoutFinalPeriod(formatDateTime(result.runAt, timezone()))}.`;
            }
        });

        register({
            id: 'jobs.cancel',
            description: 'Cancela un proceso persistente; requiere confirmación.',
            confirm: 'always',
            reversible: false,
            validate(args) {
                if (args.ambiguous) return { ok: false, reply: 'Hay varios avisos con ese nombre. No elegí uno por ti: cancela el aviso concreto desde Recordatorios o indica su identificador.' };
                if (!args.targetId || !args.target) return { ok: false, reply: 'No encontré un proceso activo con ese nombre. Puedes decir “mis recordatorios programados”.' };
                if (args.target.meta?.eventLink && (!args.ownerId || taskOwnerId() !== args.ownerId || args.target.ownerId !== args.ownerId))
                    return { ok: false, reply: 'La cuenta cambió; solicita el aviso desde tu propia sesión.' };
                return { ok: true };
            },
            confirmation(args) {
                return `¿Confirmas que cancele “${args.target.title}”, programado para ${formatDateTime(args.target.runAt, timezone())}?`;
            },
            async execute(args) {
                if (args.target.meta?.eventLink) {
                    if (taskOwnerId() !== args.ownerId) throw new Error('EVENT_OWNER_MISMATCH');
                    const service = options.notificationsService || runtime.GunterNotificationsService;
                    return service.cancel(args.targetId);
                }
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.cancel) throw new Error('El servicio de procesos durables no está disponible.');
                return service.cancel(args.targetId);
            },
            async verify(result, args) {
                if (args.target.meta?.eventLink) {
                    if (taskOwnerId() !== args.ownerId) return false;
                    const service = options.eventsService || runtime.GunterEventsService;
                    const persisted = await service.getReminder(args.targetId);
                    return persisted?.ownerId === args.ownerId && persisted.status === 'cancelled' && result?.status === 'cancelled';
                }
                const service = options.jobsService || runtime.GunterJobs;
                const persisted = await service.get(args.targetId);
                return persisted?.status === 'cancelled' && result?.status === 'cancelled';
            },
            formatResult(result) {
                return `Proceso cancelado y verificado: “${result.title}”.`;
            }
        });

        register({
            id: 'tasks.create',
            description: 'Crea una tarea local y verifica su persistencia.',
            confirm: 'never',
            reversible: true,
            validate(args) {
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Qué tarea quieres que cree?' };
                if (args.title.length > 180) return { ok: false, reply: 'El título de la tarea es demasiado largo; resúmelo en menos de 180 caracteres.' };
                return { ok: true };
            },
            async execute(args) {
                const service = options.tasksService || runtime.GunterTasksService;
                if (!service?.create) throw new Error('El servicio de tareas no está disponible.');
                const ownerId = taskOwnerId();
                if (runtime.GunterAuth && !ownerId) throw new Error('Inicia sesión para guardar tareas en tu cuenta.');
                return service.create({ title: args.title, dueAt: args.dueAt,
                    ownerId: ownerId || 'local-user', source: 'gunter-assistant' });
            },
            async verify(result) {
                const service = options.tasksService || runtime.GunterTasksService;
                const items = await service.list();
                return items.some(item => item.id === result.id);
            },
            formatResult(result) {
                return `Tarea creada y verificada: “${result.title}”${result.dueAt ? ` para ${withoutFinalPeriod(formatDateTime(result.dueAt, timezone()))}` : ''}.`;
            }
        });

        [['tasks.complete', 'done', 'complete'], ['tasks.reopen', 'pending', 'reopen'],
            ['tasks.cancel', 'cancelled', 'cancel']].forEach(([id, status, action]) => register({
            id,
            description: action === 'complete' ? 'Marca una tarea existente como completada.'
                : action === 'cancel' ? 'Cancela una tarea sin borrarla.' : 'Reactiva una tarea completada o cancelada.',
            confirm: 'always', reversible: true,
            validate(args) {
                if (!args.ownerId || taskOwnerId() !== args.ownerId)
                    return { ok: false, reply: 'Inicia sesión para cambiar tareas de tu cuenta.' };
                if (!args.reference) return { ok: false, reply: 'Dime el nombre de la tarea.' };
                if (args.ambiguous) return { ok: false, reply: 'Hay varias tareas con ese nombre. Abre Tareas y elige la correcta, o dime su identificador.' };
                if (!args.targetId) return { ok: false, reply: action === 'reopen'
                    ? `No encontré una tarea completada o cancelada de esta cuenta que coincida con “${args.reference}”.`
                    : `No encontré una tarea activa de esta cuenta que coincida con “${args.reference}”.` };
                return { ok: true };
            },
            confirmation(args) { return `¿Confirmas que ${action === 'complete' ? 'marque como completada' : action === 'cancel' ? 'cancele' : 'reactive'} la tarea “${args.targetTitle}”?${action === 'cancel' ? ' No la borraré; podrás reactivarla.' : ''}`; },
            async execute(args) {
                const service = options.tasksService || runtime.GunterTasksService;
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la tarea.');
                if (!service?.list || !service[action]) throw new Error('El servicio de tareas no está disponible.');
                const current = (await service.list()).find(item => item.id === args.targetId && item.ownerId === args.ownerId);
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la tarea.');
                if (!current || (action === 'reopen' ? !['done', 'cancelled'].includes(current.status) : !['pending', 'doing'].includes(current.status)))
                    throw new Error('La tarea cambió o ya no pertenece a esta cuenta. Revísala antes de repetir la orden.');
                if (args.referenceRequest) {
                    if (!args.snapshot || Object.entries(args.snapshot).some(([key, value]) => (current[key] || null) !== (value || null)))
                        throw new Error('La tarea cambió después de la propuesta. Selecciónala otra vez y confirma sus datos actuales.');
                    return service[action](args.targetId, args.ownerId, args.snapshot);
                }
                return service[action](args.targetId, args.ownerId);
            },
            async verify(result, args) {
                const service = options.tasksService || runtime.GunterTasksService;
                const stored = (await service.list()).find(item => item.id === args.targetId);
                return result?.id === args.targetId && stored?.ownerId === args.ownerId && stored.status === status;
            },
            formatResult(result) { return action === 'complete'
                ? `Tarea completada y verificada: “${result.title}”.`
                : action === 'cancel' ? `Tarea cancelada y verificada: “${result.title}”. Puedes reactivarla cuando quieras.`
                    : `Tarea reactivada y verificada: “${result.title}”.`; }
        }));

        register({
            id: 'tasks.update',
            description: 'Corrige el nombre o reprograma el vencimiento de una tarea local existente.',
            confirm: 'always', reversible: true,
            validate(args) {
                if (!args.ownerId || taskOwnerId() !== args.ownerId)
                    return { ok: false, reply: 'Inicia sesión para editar tareas de tu cuenta.' };
                if (!args.editMode || !args.reference)
                    return { ok: false, reply: 'Dime qué tarea quieres cambiar y el nuevo nombre o la fecha. Por ejemplo: reprograma la tarea “Informe” para mañana a las 10.' };
                if (args.ambiguous)
                    return { ok: false, reply: 'Hay varias tareas con ese nombre. Usa su identificador o edítala desde Tareas.' };
                if (!args.targetId)
                    return { ok: false, reply: `No encontré una tarea activa de esta cuenta que coincida con “${args.reference}”.` };
                if (args.editMode === 'title') {
                    if (!args.newTitle || args.newTitle.length < 2 || args.newTitle.length > 180)
                        return { ok: false, reply: 'Indica un nuevo nombre de 2 a 180 caracteres.' };
                    if (normalize(args.newTitle) === normalize(args.targetTitle))
                        return { ok: false, reply: 'La tarea ya tiene ese nombre; no hice cambios.' };
                } else if (args.editMode === 'due') {
                    if (!args.dueAt || !Number.isFinite(Date.parse(args.dueAt)) || !['instant', 'allDay'].includes(args.dueKind))
                        return { ok: false, reply: 'Indica una fecha y hora concretas para reprogramar la tarea.' };
                    if (Date.parse(args.dueAt) <= now().getTime())
                        return { ok: false, reply: 'La nueva fecha ya pasó. Dime una fecha futura.' };
                    if (args.dueAt === args.snapshot?.dueAt)
                        return { ok: false, reply: 'La tarea ya tiene ese vencimiento; no hice cambios.' };
                } else return { ok: false, reply: 'Solo puedo cambiar el nombre o el vencimiento de esa tarea.' };
                return { ok: true };
            },
            confirmation(args) {
                return args.editMode === 'title'
                    ? `¿Confirmas cambiar el nombre de “${args.targetTitle}” a “${args.newTitle}”?`
                    : `¿Confirmas mover “${args.targetTitle}” a ${formatDateTime(args.dueAt, timezone())}?`;
            },
            async execute(args) {
                const service = options.tasksService || runtime.GunterTasksService;
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la tarea.');
                if (!service?.list || !service?.update) throw new Error('El servicio de tareas no está disponible.');
                const current = (await service.list()).find(item => item.id === args.targetId && item.ownerId === args.ownerId);
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué la tarea.');
                if (!current || !['pending', 'doing'].includes(current.status)
                    || Object.entries(args.snapshot || {}).some(([key, value]) => (current[key] || null) !== (value || null)))
                    throw new Error('La tarea cambió desde la confirmación. Revísala y vuelve a pedir el cambio.');
                const patch = args.editMode === 'title' ? { title: args.newTitle } : { dueAt: args.dueAt };
                return service.update(args.targetId, patch, { ownerId: args.ownerId,
                    statuses: ['pending', 'doing'], expected: args.snapshot });
            },
            async verify(result, args) {
                const service = options.tasksService || runtime.GunterTasksService;
                const stored = (await service.list()).find(item => item.id === args.targetId && item.ownerId === args.ownerId);
                return result?.id === args.targetId && !!stored &&
                    (args.editMode === 'title' ? stored.title === args.newTitle : stored.dueAt === args.dueAt);
            },
            formatResult(result, args) {
                return args.editMode === 'title' ? `Nombre actualizado y verificado: “${result.title}”.`
                    : `Vencimiento actualizado y verificado: “${result.title}” para ${formatDateTime(result.dueAt, timezone())}.`;
            }
        });

        ['calendar.update', 'calendar.cancel'].forEach(id => register({
            id,
            description: id === 'calendar.cancel' ? 'Cancela un evento local de la cuenta, sin borrarlo.' : 'Cambia el nombre o reprograma un evento local de la cuenta.',
            confirm: 'always', reversible: id === 'calendar.update',
            validate(args) {
                if (!args.ownerId || taskOwnerId() !== args.ownerId)
                    return { ok: false, reply: 'Inicia sesión para cambiar eventos de tu cuenta.' };
                if (!args.reference || (id === 'calendar.update' && !args.editMode))
                    return { ok: false, reply: 'Indica el nombre del evento y el cambio. Por ejemplo: reprograma la reunión “Equipo” para mañana a las 10, o renombra la cita “Control” a “Control médico”.' };
                if (args.ambiguous) return { ok: false, reply: `Hay varios eventos con ese nombre. ¿Cuál quieres cambiar?\n${args.candidates.map((item, index) => `${index + 1}. ${item.title} — ${formatDateTime(item.startAt, timezone())}`).join('\n')}\nDime el número; después pediré confirmación.` };
                if (!args.targetId || !args.snapshot)
                    return { ok: false, reply: `No encontré un evento activo de esta cuenta con el nombre o identificador “${args.reference}”.` };
                if (args.restricted) return { ok: false, reply: args.restricted };
                if (id === 'calendar.cancel') return { ok: true };
                if (args.editMode === 'title') {
                    if (!args.newTitle || args.newTitle.length < 2 || args.newTitle.length > 180)
                        return { ok: false, reply: 'Indica un nuevo nombre de 2 a 180 caracteres.' };
                    if (normalize(args.newTitle) === normalize(args.targetTitle))
                        return { ok: false, reply: 'El evento ya tiene ese nombre; no hice cambios.' };
                } else if (args.editMode === 'start') {
                    if (!Number.isFinite(Date.parse(args.startAt)) || !Number.isFinite(Date.parse(args.endAt))
                        || Date.parse(args.endAt) <= Date.parse(args.startAt) || args.dueKind !== 'instant' || args.newRecurrence)
                        return { ok: false, reply: 'Dime una fecha y hora concretas para el evento. Debe terminar después de comenzar; este cambio no crea series recurrentes.' };
                    if (Date.parse(args.startAt) <= now().getTime())
                        return { ok: false, reply: 'La nueva fecha ya pasó. Dime una fecha y hora futuras.' };
                    if (Date.parse(args.startAt) === Date.parse(args.snapshot.startAt) && Date.parse(args.endAt) === Date.parse(args.snapshot.endAt))
                        return { ok: false, reply: 'El evento ya tiene ese horario; no hice cambios.' };
                    if (args.scheduleUnavailable || !args.scheduleCheck)
                        return { ok: false, reply: `No pude comprobar tu agenda; no modificaré el horario sin esa comprobación. ${args.scheduleUnavailable || 'Vuelve a preparar el cambio.'}` };
                } else return { ok: false, reply: 'Puedo cambiar el nombre o la fecha y hora del evento. Dime cuál quieres modificar.' };
                return { ok: true };
            },
            confirmation(args) {
                const current = `“${args.targetTitle}”, ${formatDateTime(args.snapshot.startAt, timezone())}`;
                if (id === 'calendar.cancel') return `¿Confirmas cancelar ${current}? Conservaré el registro, pero dejará de aparecer entre los eventos activos.`;
                if (args.editMode === 'title') return `¿Confirmas renombrar ${current} como “${args.newTitle}”?`;
                return `¿Confirmas mover ${current} a ${formatDateTime(args.startAt, timezone())}, hasta ${formatTime(args.endAt, timezone())}?${scheduleSummary(args)}`;
            },
            async execute(args) {
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué el evento.');
                const service = options.eventsService || runtime.GunterEventsService;
                if (!service?.list || !service?.update) throw new Error('El servicio de eventos no está disponible.');
                const current = (await service.list({ includeCancelled: true })).find(item => item.id === args.targetId && item.ownerId === args.ownerId);
                if (!current || (current.status || 'scheduled') !== 'scheduled' || eventRestriction(current)
                    || JSON.stringify(eventSnapshot(current)) !== JSON.stringify(args.snapshot))
                    throw new Error('El evento cambió desde la propuesta o ya no está disponible. Revísalo y vuelve a pedir el cambio.');
                if (taskOwnerId() !== args.ownerId) throw new Error('La cuenta cambió; no modifiqué el evento.');
                const patch = id === 'calendar.cancel' ? { status: 'cancelled', cancelledAt: now().toISOString() }
                    : args.editMode === 'title' ? { title: args.newTitle } : { startAt: args.startAt, endAt: args.endAt };
                const scheduleExpected = id === 'calendar.update' && args.editMode === 'start' ? await assertScheduleUnchanged(args) : null;
                return service.update(args.targetId, patch, { ownerId: args.ownerId, statuses: ['scheduled'], expected: args.snapshot, skipSync: true,
                    ...(scheduleExpected ? { scheduleExpected } : {}) });
            },
            async verify(result, args) {
                if (taskOwnerId() !== args.ownerId) return false;
                const service = options.eventsService || runtime.GunterEventsService;
                const stored = (await service.list({ includeCancelled: true })).find(item => item.id === args.targetId && item.ownerId === args.ownerId);
                return result?.id === args.targetId && result?.ownerId === args.ownerId && !!stored
                    && (id === 'calendar.cancel' ? stored.status === 'cancelled' && Boolean(stored.cancelledAt)
                        : (stored.status || 'scheduled') === 'scheduled' && (args.editMode === 'title' ? stored.title === args.newTitle
                            : Date.parse(stored.startAt) === Date.parse(args.startAt) && Date.parse(stored.endAt) === Date.parse(args.endAt)));
            },
            formatResult(result, args) {
                if (id === 'calendar.cancel') return `Evento cancelado y verificado: “${result.title}”. Conservé el registro.`;
                return args.editMode === 'title' ? `Nombre del evento actualizado y verificado: “${result.title}”.`
                    : `Evento reprogramado y verificado: “${result.title}”, ${formatDateTime(result.startAt, timezone())}.`;
            }
        }));

        register({
            id: 'calendar.create',
            description: 'Crea un evento local; siempre requiere confirmación.',
            confirm: 'always',
            reversible: true,
            validate(args) {
                if (runtime.GunterAuth && (!args.ownerId || taskOwnerId() !== args.ownerId))
                    return { ok: false, reply: 'Inicia sesión para crear eventos de tu cuenta.' };
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Qué nombre tendrá el evento?' };
                if (!args.startAt) return { ok: false, reply: '¿Para qué fecha y hora quieres agendarlo?' };
                if (!Number.isFinite(Date.parse(args.startAt)) || (args.endAt && (!Number.isFinite(Date.parse(args.endAt)) || Date.parse(args.endAt) <= Date.parse(args.startAt))))
                    return { ok: false, reply: 'El horario no es válido. Indica una fecha y una hora de finalización posterior al inicio.' };
                if (args.title.length > 180) return { ok: false, reply: 'El nombre del evento es demasiado largo; resúmelo en menos de 180 caracteres.' };
                if (Date.parse(args.startAt) <= now().getTime()) return { ok: false, reply: 'Ese horario ya pasó. Dime una fecha y hora futuras.' };
                if (args.kind === 'allDay') return { ok: false, reply: 'Dime una hora concreta para la reunión; una fecha sin hora no basta para comprobar cruces.' };
                if (args.scheduleUnavailable || !args.scheduleCheck)
                    return { ok: false, reply: `No pude comprobar tu agenda; no crearé el evento sin esa comprobación. ${args.scheduleUnavailable || 'Vuelve a preparar el evento.'}` };
                return { ok: true };
            },
            confirmation(args) {
                const destination = args.pushToGoogle ? ' Lo guardaré localmente e intentaré sincronizarlo con Google Calendar.' : '';
                return `¿Confirmas que agende “${args.title}” para ${formatDateTime(args.startAt, timezone())}, hasta ${formatTime(args.endAt, timezone())}?${destination}${scheduleSummary(args)}`;
            },
            async execute(args) {
                const service = options.eventsService || runtime.GunterEventsService;
                if (!service?.create) throw new Error('El servicio de eventos no está disponible.');
                const scheduleExpected = await assertScheduleUnchanged(args);
                return service.create({
                    ownerId: args.ownerId || 'local-user',
                    title: args.title,
                    startAt: args.startAt,
                    endAt: args.endAt,
                    kind: args.kind,
                    rrule: args.rrule,
                    pushToGoogle: !!args.pushToGoogle,
                    source: 'gunter-assistant'
                }, { scheduleExpected });
            },
            async verify(result, args) {
                if (runtime.GunterAuth && taskOwnerId() !== args.ownerId) return false;
                const service = options.eventsService || runtime.GunterEventsService;
                const items = await service.list();
                return items.some(item => item.id === result.id && item.ownerId === (args.ownerId || 'local-user'));
            },
            async formatResult(result, args) {
                const service = options.eventsService || runtime.GunterEventsService;
                const persisted = (await service.list()).find(item => item.id === result.id) || result;
                const sync = args.pushToGoogle
                    ? persisted.syncStatus === 'synced' ? ' También quedó sincronizado con Google Calendar.'
                        : persisted.syncStatus === 'pending' ? ' Quedó local y pendiente de sincronizar con Google Calendar.'
                            : persisted.syncStatus === 'error' ? ' Quedó local, pero falló la sincronización con Google Calendar.'
                                : ' Quedó guardado localmente; Google Calendar no está conectado.'
                    : '';
                return `Evento creado y verificado: “${persisted.title}”, ${withoutFinalPeriod(formatDateTime(persisted.startAt, timezone()))}.${sync}`;
            }
        });

        return {
            dispatch, detect, clarifyRequest, register, listTools, getPending, isContextualFollowUp,
            prepareMatch: prepare,
            validatePrepared,
            executeWorkflowStep,
            clearPending: () => { savePending(null); referenceContext = pendingReminderReference = pendingEventSelection = null; }, normalize
        };
    }

    function safeStorage(candidate, memory) {
        if (candidate?.getItem && candidate?.setItem && candidate?.removeItem) return candidate;
        return {
            getItem: key => memory.has(key) ? memory.get(key) : null,
            setItem: (key, value) => memory.set(key, String(value)),
            removeItem: key => memory.delete(key)
        };
    }

    function isAffirmative(text) {
        return /^(si|confirmo|confirmado|hazlo|adelante|de acuerdo|correcto|procede|dale|listo)$/.test(text);
    }

    function isNegative(text) {
        return /^(no|cancela|cancelar|olvidalo|dejalo|mejor no|rechazo)$/.test(text);
    }

    function workflowEvidence(toolId, result = {}) {
        if (toolId.startsWith('calendar.')) return { eventId: result.id || result.eventId, reconsulted: true };
        if (toolId === 'tasks.create' || toolId === 'reminder.schedule' || toolId === 'follow_up.schedule') return { persistedId: result.id };
        return { verified: true };
    }

    function extractTitle(text, toolId) {
        let title = String(text || '').trim();
        title = title.replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i,
            ''
        ).trim();
        let prefix;
        if (toolId === 'calendar.create') {
            prefix = /^(?:por favor\s+)?(?:agenda(?:me)?|programa(?:me)?|crea(?:r)?|añade|anade|agrega)\s+(?:(?:una?|el)\s+)?(?:reunión|reunion|evento|cita)(?:\s+(?:para|de|sobre|que))?\s*/i;
        } else if (toolId === 'follow_up.schedule') {
            prefix = /^(?:por favor\s+)?(?:programa(?:me)?|crea|haz|hacer)\s+(?:(?:una?|el)\s+)?(?:seguimiento|follow[\s-]?up)(?:\s+(?:para|de|sobre|que))?\s*/i;
        } else if (toolId === 'jobs.cancel') {
            prefix = /^(?:por favor\s+)?(?:cancela|cancelar|elimina|quita)\s+(?:(?:el|la|un|una)\s+)?(?:recordatorio|seguimiento|proceso)(?:\s+(?:para|de|sobre|que))?\s*/i;
        } else {
            prefix = /^(?:por favor\s+)?(?:crea(?:r)?|programa|ponme|avísame|avisame|añade|anade|agrega|anota|recuérdame|recuerdame|recordarme)\s+(?:(?:una?|la|un)\s+)?(?:tarea|pendiente|recordatorio)?(?:\s+(?:para|de|que))?\s*/i;
        }
        title = title.replace(prefix, '').trim();
        title = title.replace(/\s+\b(?:pasado\s+mañana|pasado\s+manana|mañana|manana|hoy|el\s+(?:próximo\s+|proximo\s+|este\s+)?(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)|\d{1,2}\s+de\s+[a-záéíóúñ]+|\d{1,2}\/\d{1,2})(?:\s+.*)?$/i, '').trim();
        title = title.replace(/\s+\b(?:a\s+las?|a\s+la|en)\s+(?:\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce).*/i, '').trim();
        title = title.replace(/^[,;:\-]+|[,;:\-]+$/g, '').trim();
        return toolId === 'calendar.create' ? title.replace(/^[“"']|[”"']$/g, '').trim() : title;
    }

    function extractTaskReference(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '');
        const quoted = raw.match(/[“"']([^”"']+)[”"']/)?.[1]?.trim();
        if (quoted) return quoted.slice(0, 180);
        return raw
            .replace(/^(?:por favor\s+)?(?:marca|marcar|pon|poner)\s+(?:como\s+)?(?:hecha|terminada|completada)\s+(?:(?:la|el)\s+)?(?:tarea|pendiente)\s*(?:de\s+)?/i, '')
            .replace(/^(?:por favor\s+)?(?:completa|completar|termina|terminar|finaliza|finalizar|reabre|reabrir|reactiva|reactivar|vuelve a abrir|marca|marcar|cancela|cancelar)\s+(?:(?:la|el|una|un)\s+)?(?:tarea|pendiente)\s*(?:de\s+)?/i, '')
            .replace(/\s+como\s+(?:hecha|terminada|completada)\s*$/i, '')
            .replace(/[.!?]+$/, '').trim().slice(0, 180);
    }

    function referenceChoice(text) {
        const value = normalize(text).replace(/^(?:la|el|opcion|numero)\s+/, '');
        if (/^\d+$/.test(value)) return Number(value);
        return ({ primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3,
            cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6,
            septima: 7, septimo: 7, octava: 8, octavo: 8, novena: 9, noveno: 9, decima: 10, decimo: 10 })[value] ?? null;
    }

    function isTimeReply(text) {
        return /^(?:hoy|manana|pasado manana|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|a las?|en \d+|dentro de)\b/.test(normalize(text))
            || /^\d+\s*(?:minutos?|min|horas?|h)\s+antes\b|^(?:al inicio|al empezar|cuando empiece)$/.test(normalize(text))
            || /^\d{1,2}[:.]\d{2}\b/.test(String(text).trim());
    }

    function parseEventReminder(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '')
            .replace(/^(?:y\s+|por favor\s+)/i, '').replace(/[.!?]+$/, '').trim();
        const named = raw.match(/^(?:recu[eé]rdame|av[ií]same de)\s+(?:(?:la|el)\s+)?(?:reuni[oó]n|evento|cita)\s+(.+)$/i);
        if (!named) return null;
        const body = named[1].trim();
        const quoted = body.match(/^[“"'](.+?)[”"'](?:\s+(.+))?$/);
        const timed = body.match(/^(.+?)\s+((?:\d+\s*(?:minutos?|min|horas?|h)\s+antes|al inicio|al empezar|cuando empiece|hoy|ma[ñn]ana|pasado ma[ñn]ana|a las?\b|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)).*)$/i);
        return { reference: (quoted?.[1] || timed?.[1] || body).trim(), timeText: (quoted?.[2] || timed?.[2] || '').trim() };
    }

    function calendarSuggestionChoice(text) {
        const value = normalize(text).replace(/^(?:elige|usa|prefiero|selecciona)\s+(?:la\s+)?/, '').replace(/^(?:la|el)\s+/, '');
        const numeric = value.match(/^opcion\s+(\d+)$/);
        if (numeric) return Number(numeric[1]);
        const ordinal = value.match(/^(primera|segunda|tercera)\s+opcion$/);
        return ordinal ? { primera: 1, segunda: 2, tercera: 3 }[ordinal[1]] : null;
    }

    function parseReferenceRequest(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '')
            .replace(/^(?:y\s+|por favor\s+)/i, '').replace(/[.!?]+$/, '').trim();
        const normalized = normalize(raw);
        if (/^(?:reintentalo|reintentala|vuelve a intentarlo|vuelve a intentarla)$/.test(normalized)) return { action: 'retry' };
        if (/^(?:por que fallo|que paso con|estado de)\s+(?:eso|ese|esa|esto|esta)$/.test(normalized)) return { action: 'inspect' };
        const indexedRetry = /^(?:reintenta|reintentar|vuelve a intentar)\s+(.+)$/.exec(normalized);
        if (indexedRetry && referenceChoice(indexedRetry[1]) !== null) return { action: 'retry', choice: referenceChoice(indexedRetry[1]) };
        const indexedInspect = /^(?:por que fallo|que paso con|estado de|revisa)\s+(.+)$/.exec(normalized);
        if (indexedInspect && referenceChoice(indexedInspect[1]) !== null) return { action: 'inspect', choice: referenceChoice(indexedInspect[1]) };
        const remind = raw.match(/^(?:recu[eé]rdame|av[ií]same)\s+(?:eso|esa(?:\s+reuni[oó]n)?|ese(?:\s+evento)?|esto|esta(?:\s+reuni[oó]n)?)(?:\s+tambi[eé]n)?(?:\s+(.+))?$/i);
        if (remind) return { action: 'remind', value: remind[1] || '' };
        const indexedRemind = raw.match(/^(?:recu[eé]rdame|av[ií]same)\s+((?:(?:la|el)\s+)?(?:primera|primero|segunda|segundo|tercera|tercero|\d+))(?:\s+(.+))?$/i);
        if (indexedRemind) return { action: 'remind', choice: referenceChoice(indexedRemind[1]), value: indexedRemind[2] || '' };
        const status = /^(cancelala|cancelalo|cancela (?:eso|esa|ese|esto|esta)|completala|completalo|terminala|terminalo|reabrela|reabrelo|reactivala|reactivalo)$/.exec(normalized);
        if (status) return { action: /^(cancel)/.test(status[1]) ? 'cancel' : /^(reabre|reactiva)/.test(status[1]) ? 'reopen' : 'complete' };
        if (/^(muevela|muevelo|reprogramala|reprogramalo|cambiala|cambialo|posponla|posponlo)$/.test(normalized)) return { action: 'move', value: '' };
        const move = raw.match(/^(?:mu[eé]vela|mu[eé]velo|reprogr[aá]mala|reprogr[aá]malo|c[aá]mbiala|c[aá]mbialo|ponla|ponlo|hazlo|posponla|posponlo|mejor)\s+(?:para\s+|a\s+(?!las?\b))?(.+)$/i);
        if (move) return { action: 'move', value: move[1].replace(/^las?\s+/i, 'a las ') };
        const rename = raw.match(/^(?:ren[oó]mbrala|ren[oó]mbralo|ll[aá]mala|ll[aá]malo)\s+(?:(?:a|como)\s+)?(.+)$/i);
        if (rename) return { action: 'rename', value: rename[1].replace(/^[“"']|[”"']$/g, '').trim() };
        const indexedStatus = /^(cancela|completa|reabre|reactiva)\s+(.+)$/.exec(normalized);
        const choice = indexedStatus ? referenceChoice(indexedStatus[2]) : null;
        if (choice !== null) return { action: indexedStatus[1] === 'cancela' ? 'cancel' : indexedStatus[1] === 'completa' ? 'complete' : 'reopen', choice };
        const indexedMove = raw.match(/^(?:mueve|reprograma|pospone)\s+(.+?)\s+(?:para\s+|a\s+(?!las?\b))(.+)$/i);
        if (indexedMove && referenceChoice(indexedMove[1]) !== null)
            return { action: 'move', choice: referenceChoice(indexedMove[1]), value: indexedMove[2] };
        return null;
    }

    function eventSnapshot(item) {
        return { title: item.title, startAt: item.startAt, endAt: item.endAt,
            status: item.status || 'scheduled', updatedAt: item.updatedAt || null,
            rrule: item.rrule || null, externalIds: JSON.parse(JSON.stringify(item.externalIds || {})) };
    }

    function reminderSnapshot(item) {
        return { id: item.id, type: item.type, title: item.title, runAt: item.runAt,
            priority: item.priority || 'normal', status: item.status, updatedAt: item.updatedAt || null,
            revision: Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : 0 };
    }

    function reminderPublicRecord(item) {
        // Only account-scoped identity/state, never payload, tokens, raw errors
        // or push results that may carry provider credentials or local paths.
        return { ...reminderSnapshot(item), attempts: Number.isSafeInteger(item.attempts) ? item.attempts : 0,
            maxAttempts: Number.isSafeInteger(item.maxAttempts) ? item.maxAttempts : null,
            nextAttemptAt: Number.isFinite(Date.parse(item.nextAttemptAt)) ? item.nextAttemptAt : null };
    }

    function reminderStateLabel(status) {
        return ({ scheduled: 'programado', running: 'en ejecución', retry_wait: 'esperando reintento automático',
            failed: 'fallido', completed: 'procesado por el servidor', fired: 'disparado en este navegador', cancelled: 'cancelado' })[status] || 'estado no reconocido';
    }

    function reminderRetryRestriction(item) {
        if (item.meta?.eventLink || item.payload?.eventLink || item.payload?.meta?.eventLink || !String(item.id || '').startsWith('job_'))
            return 'Este aviso está vinculado a una reunión local. Revisa la reunión y sus permisos en Agenda; no lo reactivaré como recordatorio independiente.';
        if (item.type !== 'reminder') return 'Ese proceso es un seguimiento, no un recordatorio independiente. No reactivaré otro tipo de proceso con esta orden.';
        if (item.status === 'retry_wait') return 'Este aviso ya tiene un reintento automático pendiente. No crearé uno paralelo. Puedes consultar su estado para ver cuándo se intentará de nuevo.';
        if (item.status !== 'failed') return 'Solo puedo reintentar avisos fallidos. Ese recordatorio está programado, en ejecución, procesado o cancelado; no lo volveré a enviar como si hubiera fallado.';
        return null;
    }

    function reminderDiagnosis(item, tz) {
        const linked = item.meta?.eventLink || item.payload?.eventLink || item.payload?.meta?.eventLink || !String(item.id || '').startsWith('job_');
        const advice = reminderRetryRestriction(item);
        const state = item.status;
        const attempts = Number.isSafeInteger(item.attempts) && item.attempts >= 0 ? item.attempts : 0;
        let detail;
        if (state === 'scheduled') detail = linked
            ? `Este navegador tiene un aviso para ${formatDateTime(item.runAt, tz)}. Necesita Gunter abierto y los permisos de notificaciones; no hay una entrega registrada todavía.`
            : `Está programado para ${formatDateTime(item.runAt, tz)}. No hay una entrega registrada todavía. El servidor local debe estar funcionando para procesarlo.`;
        else if (state === 'running') detail = 'El servidor está procesando el aviso. Todavía no hay un resultado final; no lanzaré otro intento mientras sigue en ejecución.';
        else if (state === 'retry_wait') detail = `El intento anterior no terminó correctamente; hay un reintento automático${Number.isFinite(Date.parse(item.nextAttemptAt)) ? ` previsto para ${formatDateTime(item.nextAttemptAt, tz)}` : ' pendiente, sin una fecha válida registrada'}. El servidor local debe seguir funcionando; no programaré un intento paralelo.`;
        else if (state === 'failed') detail = `Se registró un fallo${attempts > 0 ? ` tras ${attempts} intento${attempts === 1 ? '' : 's'}` : ', sin un número de intentos verificable'}. ${!advice ? 'Puedo reintentarlo ahora si lo solicitas y confirmas.' : advice}`;
        else if (state === 'completed') {
            if (item.result?.interventionId) {
                detail = 'El servidor registró el aviso en la bandeja de Gunter.';
                const push = item.result?.push;
                if (Number(push?.delivered) > 0) detail += ' El proveedor aceptó una notificación push; eso no demuestra que la hayas recibido o leído.';
                else detail += ' No hay una notificación push aceptada registrada; comprueba Conexiones y los permisos de notificaciones si quieres avisos en el teléfono.';
            } else detail = 'El servidor marcó el proceso como completado, pero no hay evidencia suficiente para afirmar que llegó a la bandeja o al teléfono.';
            detail += ' No lo reintentaré como un fallo; podría duplicar un aviso ya procesado.';
        } else if (state === 'fired') detail = 'El navegador registró el disparo del aviso. Esto no demuestra que lo hayas oído o leído.';
        else if (state === 'cancelled') detail = 'El aviso está cancelado. No lo reactivaré mediante un reintento; puedes crear uno nuevo si todavía lo necesitas.';
        else detail = 'No tengo un estado reconocido suficiente para deducir qué ocurrió. Revisa Actividad; no ejecutaré acciones basándome en una suposición.';
        if (['failed', 'retry_wait'].includes(state)) {
            const error = String(item.lastError || '');
            const cause = /^ENOSPC\b/.test(error) ? 'El error registrado indica falta de espacio de almacenamiento. Libera espacio y revisa el servidor local antes de reintentar.'
                : /^(?:EACCES|EPERM)\b/.test(error) ? 'El error registrado indica un problema de permisos de almacenamiento. Revisa los permisos del servidor local antes de reintentar.'
                : error === 'No se pudo crear la intervención persistente.' ? 'No se pudo guardar el aviso en la bandeja persistente. Revisa el almacenamiento del servidor local antes de reintentar.'
                : error === 'recovered_after_restart' ? 'El proceso se recuperó después de un reinicio del servidor.'
                : 'La causa registrada no está clasificada con suficiente precisión. Revisa los registros locales del servidor; no inventaré un diagnóstico ni mostraré datos sensibles del error.';
            detail += `\n${cause}`;
        }
        if (linked) detail += '\nEste aviso está vinculado a una reunión y requiere Gunter abierto en este navegador; se gestiona desde Agenda, no como proceso independiente.';
        return detail;
    }

    function parseReminderOperation(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '')
            .replace(/^[¿¡]+|[.!?]+$/g, '').trim();
        const retry = raw.match(/^(?:por favor\s+)?(?:reintenta(?:r)?|vuelve a intentar)\s+(?:(?:el|un)\s+)?(?:recordatorio|aviso|seguimiento|proceso)(?:\s+fallido)?(?:\s+(?:de|para))?\s*(.*)$/i);
        const inspect = raw.match(/^(?:por qu[eé] fall[oó]|qu[eé] pas[oó] con|estado (?:de|del)|(?:consulta|revisa|diagnostica) (?:el )?estado (?:de|del))\s+(?:(?:el|un)\s+)?(?:recordatorio|aviso|seguimiento|proceso)\s*(.*)$/i);
        if (!retry && !inspect) return null;
        const body = (retry || inspect)[1].trim();
        const quoted = body.match(/^[“"']([^”"']+)[”"']\s*$/);
        const unquoted = normalize(raw.replace(/[“"'][^”"']*[”"']/g, ''));
        const compound = /\b(?:y|tambien|luego|ademas)\s+(?:reintenta\w*|reprograma\w*|renombra\w*|cambia\w*|cancela\w*|elimina\w*|mueve|abre|envia|crea)\b/.test(unquoted);
        return { mode: retry ? 'retry' : 'inspect', reference: (quoted?.[1] || body).trim().slice(0, 180), compound };
    }

    function reminderRestriction(item) {
        if (item.meta?.eventLink || item.payload?.eventLink || !String(item.id || '').startsWith('job_'))
            return 'Este aviso está vinculado a una reunión local. Reprograma la reunión en Agenda para conservar la antelación del aviso; no editaré otro recordatorio en su lugar.';
        if (item.type !== 'reminder') return 'Ese proceso es un seguimiento, no un recordatorio independiente. Esta edición no cambia seguimientos.';
        if (item.status !== 'scheduled' || Number(item.attempts || 0) !== 0)
            return 'Ese aviso ya se está ejecutando, está esperando un reintento o ya fue atendido. No puedo reprogramarlo como si su entrega no hubiera empezado; revisa su estado en Recordatorios.';
        return null;
    }

    // Reuse the event edit grammar; only the target noun and time mode differ.
    // Replace its first command noun, never words inside the quoted title.
    function parseReminderEdit(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '');
        const translated = raw.replace(/^(.+?\s)(?:recordatorio|aviso)\s+/i, '$1evento ');
        if (translated === raw) return { mode: null, reference: '', value: '' };
        const parsed = parseEventEdit(translated);
        const unquoted = normalize(raw.replace(/[“"'][^”"']*[”"']/g, ''));
        const compound = /\b(?:y|tambien|luego|ademas)\s+(?:reprograma(?:r|lo|la)?|reagenda(?:r|lo|la)?|mueve|pospone|renombra(?:r|lo|la)?|cambia(?:r|lo|la)?|edita(?:r|lo|la)?|ponlo|ponla)\b/.test(unquoted);
        return { ...parsed, mode: parsed.mode === 'start' ? 'time' : parsed.mode, compound };
    }

    function eventRestriction(item) {
        if (item.rrule || item.kind === 'recurring')
            return 'Este evento pertenece a una serie recurrente. No cambiaré toda la serie por una orden individual; gestiona la recurrencia desde Agenda.';
        if (Object.values(item.externalIds || {}).some(Boolean) || (item.syncStatus && item.syncStatus !== 'local'))
            return 'Este evento está vinculado a un calendario externo o tiene sincronización pendiente. Este cambio conversacional solo modifica eventos locales; usa el calendario conectado para mantener ambos consistentes.';
        return null;
    }

    function parseEventEdit(text, cancel = false) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '');
        const event = '(?:reuni[oó]n|evento|cita)';
        if (cancel) {
            const body = raw.replace(new RegExp(`^(?:por favor\\s+)?(?:cancela(?:r)?|elimina(?:r)?)\\s+(?:(?:la|el)\\s+)?${event}\\s*`, 'i'), '').trim();
            const quoted = body.match(/^[“"'](.+?)[”"']\s*[.!?]*$/);
            return { mode: 'cancel', reference: (quoted?.[1] || body).replace(/[.!?]+$/, '').trim().slice(0, 180), value: '' };
        }
        const title = raw.match(new RegExp(`^(?:por favor\\s+)?(?:renombra(?:r)?|cambia(?:r)? el nombre de|edita(?:r)? el nombre de)\\s+(?:(?:la|el)\\s+)?${event}\\s+(.+)$`, 'i'));
        const start = raw.match(new RegExp(`^(?:por favor\\s+)?(?:reprograma(?:r)?|reagenda(?:r)?|mueve|mover|pospone(?:r)?|cambia(?:r)? (?:la fecha|la hora|el horario) de)\\s+(?:(?:la|el)\\s+)?${event}\\s+(.+)$`, 'i'));
        const mode = title ? 'title' : start ? 'start' : null;
        const body = (title || start)?.[1] || '';
        const split = body.match(/^[“"'](.+?)[”"']\s+(?:a|al|por|para)\s+(.+)$/i)
            || body.match(/^(.+?)\s+(?:a|al|por|para)\s+(.+)$/i);
        if (!split) return { mode, reference: '', value: '' };
        const reference = split[1].trim().slice(0, 180);
        const value = split[2].trim().replace(/^[“"']|[”"']$/g, '').replace(/[.!?]+$/, '').trim();
        return { mode, reference, value: mode === 'title' ? value.slice(0, 181) : value };
    }

    function parseTaskEdit(text) {
        const raw = String(text || '').trim().replace(
            /^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '');
        const title = raw.match(/^(?:por favor\s+)?(?:renombra(?:r)?|cambia(?:r)? el nombre de|edita(?:r)? el nombre de)\s+(?:(?:la|el)\s+)?(?:tarea|pendiente)\s+(.+)$/i);
        const due = raw.match(/^(?:por favor\s+)?(?:reprograma(?:r)?|reagenda(?:r)?|mueve|mover|pospone(?:r)?|cambia(?:r)? la fecha de|cambia(?:r)? el vencimiento de)\s+(?:(?:la|el)\s+)?(?:tarea|pendiente)\s+(.+)$/i);
        const mode = title ? 'title' : due ? 'due' : null;
        if (!mode) return { mode: null, reference: '', value: '' };
        const body = (title || due)[1].trim();
        const quoted = body.match(/^[“"'](.+?)[”"']\s+(?:a|al|por|para)\s+(.+)$/i);
        const split = quoted || body.match(/^(.+?)\s+(?:a|al|por|para)\s+(.+)$/i);
        if (!split) return { mode, reference: '', value: '' };
        const reference = String(split[1]).trim().slice(0, 180);
        const value = String(split[2]).trim().replace(/^[“"']|[”"']$/g, '').replace(/[.!?]+$/, '').trim();
        return { mode, reference, value: mode === 'title' ? value.slice(0, 181) : value };
    }

    function parseSocialSend(text) {
        const raw = String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '').trim();
        const providerMatch = raw.match(/\b(whatsapp|instagram|messenger)\b/i);
        const provider = providerMatch ? providerMatch[1].toLowerCase() : null;
        const messageMatch = raw.match(/(?:\b(?:el\s+)?mensaje\b|\bdiciendo\b|\bque\b|:)\s*[“"']?(.+?)[”"']?$/i);
        const message = String(messageMatch?.[1] || '').trim().replace(/^[“"']|[”"']$/g, '').slice(0, 4000);
        let head = messageMatch ? raw.slice(0, messageMatch.index) : raw;
        head = head.replace(/\b(?:por|en)\s+(?:whatsapp|instagram|messenger)\b/ig, ' ');
        head = head.replace(/\s+\b(?:el|un)\s*$/i, ' ');
        const recipientMatch = head.match(/\ba\s+(.+)$/i);
        const recipient = String(recipientMatch?.[1] || '').replace(/\b(?:por|en)\s+(?:whatsapp|instagram|messenger)\b/ig, '').trim().slice(0, 180);
        return { provider, recipient, message };
    }

    function parseDesktopRequest(text, kind) {
        const raw = String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '').trim();
        const quoted = raw.match(/[“"']([^”"']+)[”"']/)?.[1]?.trim();
        const windowsPath = raw.match(/([a-zA-Z]:[\\/][^\n]+)/)?.[1]?.trim().replace(/[.?!]+$/, '');
        if (kind === 'open_app') {
            let target = quoted || raw.replace(/^(?:abre|abrir|inicia|iniciar|ejecuta|ejecutar|entra|ingresa)\s+(?:(?:a|al|en)\s+)?(?:(?:el|la|un)\s+)?(?:(?:programa|aplicaci[oó]n|app|navegador)\s+)?(?:de\s+)?/i, '').trim();
            const programPath = windowsPath && /\.(?:exe|com|lnk)$/i.test(windowsPath) ? windowsPath : null;
            return { rawText: text, app: programPath ? null : target, programPath };
        }
        if (kind === 'open_file' || kind === 'list') return { rawText: text, path: quoted || windowsPath || null };
        const body = raw.replace(/^(?:busca|buscar|encuentra|encontrar|localiza|localizar)\s+(?:(?:el|la|un|una)\s+)?(?:(?:archivo|carpeta|documento)\s+)?/i, '');
        const split = body.match(/^(.+?)\s+en\s+([a-zA-Z]:[\\/].+)$/i);
        return { rawText: text, query: quoted || split?.[1]?.trim() || (!windowsPath ? body.trim() : null), root: split?.[2]?.trim() || windowsPath || null };
    }

    function parseBrowserRequest(text) {
        const raw = String(text || '').replace(/^(?:(?:hi|hey|hola|oye)\s+)?gunter\s*[,;:!\-]*\s*/i, '').trim();
        const browser = raw.match(/\b(brave|chrome|edge)\b/i)?.[1]?.toLowerCase() || 'default';
        const mix = /\b(mix|mezcla)\b/i.test(raw);
        let query = raw.match(/[“"]([^”"]+)[”"]/)?.[1];
        if (!query) {
            const clean = raw.replace(/\b(?:en|con|usando|desde)\s+(?:(?:el|mi)\s+)?(?:navegador\s+)?(?:brave|chrome|edge)\b/ig, '').trim();
            query = clean.match(/\b(?:mix|mezcla)\s+(?:en\s+youtube\s+)?(?:de|con|para)\s+(.+)$/i)?.[1]
                || clean.match(/\b(?:pon|ponme|por|reproduce|reproducir|busca|buscar)\s+(.+?)\s+en\s+(?:youtube|google|internet)/i)?.[1]
                || clean.match(/\b(?:youtube|google|internet)\s+(?:un\s+mix\s+)?(?:de\s+)?(.+)$/i)?.[1]
                || clean.replace(/^.*?\b(?:pon|ponme|por|reproduce|reproducir|busca|buscar)\s+/i, '');
        }
        query = String(query || '').replace(/\s+en\s+youtube.*$/i, '').replace(/^(?:un\s+)?(?:mix|mezcla)\s+(?:de\s+)?/i, '').replace(/[.!?]+$/, '').trim().slice(0, 220);
        return { rawText: text, browser, query, mix };
    }

    function parseMobileFileQuery(text) {
        return String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '')
            .replace(/^(?:busca|buscar|encuentra|encontrar|localiza|localizar)\s+(?:(?:el|la|un|una)\s+)?(?:(?:archivo|carpeta|documento)\s+)?/i, '')
            .replace(/\s+(?:en|dentro\s+de)\s+(?:(?:mi|el|la)\s+)?(?:m[oó]vil|celular|tel[eé]fono|iphone|ipad|android).*$/i, '')
            .replace(/[“”"']/g, '').trim().slice(0, 180);
    }

    function parseMobileFileName(text) {
        return String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '')
            .replace(/^(?:abre|abrir|explora|explorar)\s+(?:(?:el|la|un|una)\s+)?(?:archivo)\s+/i, '')
            .replace(/\s+(?:en|desde)\s+(?:(?:mi|el|la)\s+)?(?:m[oó]vil|celular|tel[eé]fono|iphone|ipad|android).*$/i, '')
            .replace(/[“”"']/g, '').trim().slice(0, 240);
    }

    function parseProcedureRequest(text) {
        const raw = String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '').trim();
        const quoted = raw.match(/[“"']([^”"']+)[”"']/)?.[1]?.trim();
        const name = quoted || raw.replace(/^(?:ejecuta|ejecutar|repite|repetir|corre|correr|inicia|iniciar)\s+(?:(?:la|el|una?)\s+)?(?:ruta|rutina|procedimiento)\s*/i, '').trim();
        return { rawText: text, name: name.slice(0, 160) };
    }

    function detectMediaAction(text) {
        if (/\b(silencia|silenciar|mute|quitar silencio|activa el silencio)\b/.test(text)) return 'mute';
        if (/\b(sube|subir|aumenta|aumentar)\b.*\b(volumen|audio)\b/.test(text)) return 'volume_up';
        if (/\b(baja|bajar|reduce|reducir)\b.*\b(volumen|audio)\b/.test(text)) return 'volume_down';
        if (/\b(siguiente|proxima)\b.*\b(cancion|pista|tema|musica)\b/.test(text)) return 'next';
        if (/\b(anterior|previa)\b.*\b(cancion|pista|tema|musica)\b/.test(text)) return 'previous';
        if (/\b(detiene|detener|para|parar)\b.*\b(musica|cancion|audio|reproduccion)\b/.test(text)) return 'stop';
        if (/\b(reproduce|reproducir|pausa|pausar|continua|continuar|reanuda|reanudar)\b.*\b(musica|cancion|audio|reproduccion)\b/.test(text)) return 'play_pause';
        return null;
    }

    function desktopErrorMessage(code) {
        return ({
            desktop_app_not_allowed: 'Ese programa no está en la lista de aplicaciones permitidas.',
            desktop_browser_not_installed: 'No encontré instalado el navegador solicitado en este PC.',
            desktop_browser_not_supported: 'Puedo automatizar Brave, Chrome o Edge; ese navegador aún no tiene un controlador.',
            desktop_youtube_manual_step_required: 'YouTube requiere un paso manual, como consentimiento o inicio de sesión. La pestaña quedó abierta en el PC.',
            desktop_youtube_playback_not_confirmed: 'La pestaña de YouTube quedó abierta, pero no pude confirmar que la música esté reproduciéndose. Revisa consentimiento, acceso o reproducción en el PC.',
            desktop_youtube_result_not_found: 'No encontré un resultado de YouTube que pueda abrir y verificar.',
            desktop_browser_page_unavailable: 'El navegador no pudo cargar la página solicitada.',
            desktop_app_ambiguous: 'Encontré varios programas con ese nombre y no puedo elegir uno sin arriesgarme a abrir el equivocado.',
            desktop_program_full_access_required: 'El PC tiene el acceso a programas limitado; esa aplicación queda fuera de la lista permitida.',
            desktop_program_not_found: 'No encontré el ejecutable indicado en esa ruta.',
            desktop_program_type_not_allowed: 'Solo puedo abrir ejecutables o accesos directos compatibles (.exe, .com o .lnk).',
            desktop_platform_not_supported: 'El control de programas de Gunter Node está disponible actualmente en Windows.',
            desktop_path_not_allowed: 'Esa ruta está fuera de las carpetas autorizadas para Gunter.',
            desktop_path_not_found: 'No existe la ruta indicada o ya no está disponible.',
            desktop_absolute_path_required: 'Necesito la ruta absoluta del archivo o carpeta para localizarlo.',
            desktop_search_root_invalid: 'La ubicación de búsqueda no existe o no es una carpeta.',
            desktop_search_query_required: 'Necesito el nombre o una parte del nombre que debo buscar.',
            desktop_ui_window_not_found: 'No encontré esa aplicación abierta en el PC.',
            desktop_ui_runtime_missing: 'Falta el componente local de accesibilidad que permite controlar ventanas y campos.',
            desktop_ui_runtime_failed: 'El componente de accesibilidad del PC falló al controlar la aplicación.',
            desktop_ui_control_not_found: 'La aplicación no expone un control accesible con ese nombre.',
            desktop_ui_control_not_invokable: 'Encontré el control, pero la aplicación no permite accionarlo mediante accesibilidad.',
            desktop_ui_control_not_editable: 'Encontré el campo, pero la aplicación no permite editarlo mediante accesibilidad.',
            desktop_ui_control_read_only: 'Ese campo es de solo lectura.',
            desktop_ui_control_not_identifiable: 'No pude identificar ese control de forma estable.',
            desktop_ui_control_not_scrollable: 'Ese panel no expone desplazamiento accesible.',
            desktop_ui_scroll_not_changed: 'El panel no cambió de posición; puede estar en el límite del contenido.',
            desktop_ui_shortcut_not_allowed: 'Ese atajo no está incluido en la lista segura de Gunter.',
            desktop_ui_wait_timeout: 'El control solicitado no apareció antes de que venciera el tiempo de espera.',
            desktop_ui_target_required: 'No pude determinar el botón o campo objetivo.',
            desktop_ui_window_required: 'No pude determinar en qué aplicación o ventana actuar.',
            desktop_ui_text_required: 'No recibí el texto que debía escribir.',
            desktop_ui_sensitive_field_not_allowed: 'Por seguridad no escribo contraseñas, códigos, tokens, PIN ni OTP.',
            desktop_file_picker_not_found: 'No encontré un selector de archivos abierto en esa aplicación.',
            desktop_file_picker_confirm_not_found: 'Encontré el archivo, pero no pude identificar el botón para seleccionarlo.',
            desktop_file_not_found: 'No encontré el archivo solicitado dentro del alcance autorizado.',
            desktop_file_path_required: 'Necesito la ruta del archivo que debo abrir.',
            desktop_ui_action_not_allowed: 'Ese tipo de interacción no forma parte de las acciones seguras disponibles.',
            desktop_ui_not_verified: 'La aplicación respondió, pero no pude comprobar que el cambio ocurriera.',
            desktop_ui_timeout: 'La aplicación tardó demasiado en responder; el resultado puede ser incierto.',
            desktop_media_action_not_allowed: 'Ese control multimedia no está disponible.',
            desktop_media_not_verified: 'No recibí evidencia de que el estado multimedia cambiara.',
            downloads_folder_not_found: 'No encontré una carpeta de Descargas accesible en este PC.',
            download_not_found: 'No hay archivos que coincidan en la carpeta de Descargas autorizada.',
            skill_not_supported_by_runtime: 'La versión de Gunter Node conectada todavía no implementa esa acción.'
        })[code] || (code ? 'Gunter Node devolvió un error que todavía no tengo clasificado.' : 'El PC no pudo verificar la acción.');
    }

    function mobileErrorMessage(code) {
        return ({
            mobile_app_not_found: 'No encontré esa aplicación en el móvil. Indícame su enlace de apertura o revisa que esté instalada.',
            mobile_app_not_opened: 'El sistema del móvil no abrió esa aplicación o enlace.',
            mobile_media_permission_required: 'Activa el permiso de control multimedia en los ajustes del teléfono.',
            mobile_notifications_not_allowed: 'Activa las notificaciones de Gunter en los ajustes del teléfono.',
            mobile_files_read_permission_required: 'Abre el acompañante móvil y autoriza una carpeta con el selector del sistema.',
            mobile_folder_not_authorized: 'Esa carpeta no está autorizada en el móvil. Selecciónala desde el acompañante.',
            node_not_found: 'El móvil ya no está vinculado. Revísalo en Configuración.',
            confirmation_required: 'Esta acción necesita confirmación explícita.',
            mobile_platform_not_supported: 'El sistema del teléfono no permite esta función en el dispositivo actual.',
            mobile_permission_denied: 'El permiso necesario fue denegado en los ajustes del teléfono.',
            mobile_app_open_failed: 'El sistema no pudo iniciar esa aplicación; comprueba que esté instalada y habilitada.'
        })[code] || (code ? 'El acompañante móvil devolvió un error que todavía no tengo clasificado.' : 'El móvil no pudo verificar la acción.');
    }

    function explainFailure(error, tool) {
        const code = error?.code || '';
        const message = String(error?.message || 'No recibí un resultado verificable.');
        if (['reminder.schedule', 'reminder.update', 'reminder.retry', 'reminder.inspect', 'jobs.cancel'].includes(tool?.id)) {
            const detail = ({
                job_confirmation_required: 'El cambio requiere tu confirmación explícita.',
                REMINDER_CONFIRMATION_REQUIRED: 'Confirma el cambio por escrito o en pantalla.',
                job_owner_mismatch: 'La cuenta cambió. Solicita el cambio desde la sesión correcta.',
                JOBS_AUTH_REQUIRED: 'Inicia sesión con una cuenta verificada.',
                JOBS_OWNER_MISMATCH: 'El aviso no pertenece a la cuenta actual.',
                JOBS_ACCOUNT_CHANGED: 'La cuenta cambió durante la operación. Revisa tus avisos antes de repetirla.',
                job_changed: 'El recordatorio cambió después de la propuesta. Consulta su estado y confirma una nueva propuesta; no sobrescribí el cambio anterior.',
                job_duplicate: 'Ya existe un aviso activo equivalente. Conservé ambos registros sin crear ni sustituir otro.',
                job_not_found: 'No encontré ese aviso en los datos de esta cuenta.',
                job_not_editable: 'El aviso no es un recordatorio independiente pendiente, o su entrega ya empezó. No lo reactivé ni lo reprogramé.',
                job_not_retryable: 'Solo se pueden reintentar recordatorios independientes fallidos. Consulta el estado actual; no reactivé avisos procesados o cancelados.',
                job_params_invalid: 'La solicitud no contiene una propuesta válida de reintento. Recarga Gunter y vuelve a seleccionar el aviso.',
                job_id_invalid: 'El identificador del aviso no es válido. Selecciona un aviso de esta cuenta.',
                REMINDER_RETRY_NOT_VERIFIED: 'No recibí un reintento verificable. Consulta el estado del aviso antes de repetir la orden; podría haber quedado programado.',
                job_patch_invalid: 'Esta edición solo permite el nombre o la fecha y hora del recordatorio.',
                job_title_invalid: 'El nombre necesita entre 2 y 180 caracteres.',
                job_run_at_invalid: 'Indica una fecha y hora exactas con zona horaria.',
                job_run_at_not_future: 'La hora indicada ya pasó. Pide una fecha futura.',
                job_run_at_too_far: 'La nueva fecha debe estar dentro de los próximos 366 días.',
                job_snapshot_required: 'No tengo una propuesta verificable. Vuelve a seleccionar el aviso y confirma el cambio.',
                job_persist_failed: 'No pude guardar el cambio. El archivo anterior se conservó; revisa el almacenamiento del servidor local.',
                EVENT_AUTH_REQUIRED: 'Necesitas una sesión verificada para acceder a tus avisos.',
                EVENT_OWNER_MISMATCH: 'La cuenta cambió; no puedo usar la reunión de otra cuenta.',
                EVENT_CHANGED: 'La reunión cambió desde la propuesta. Solicita el aviso otra vez con el horario actual.',
                EVENT_REMINDER_INVALID: 'El aviso necesita una hora futura, anterior o igual al inicio de la reunión.',
                EVENT_REMINDER_UNSUPPORTED: 'Solo puedo vincular avisos a reuniones locales con hora exacta, sin recurrencia ni calendario externo.',
                EVENT_REMINDER_NOT_FOUND: 'Ese aviso o reunión ya no está disponible para esta cuenta.',
                LINKED_REMINDER_SERVICE_UNAVAILABLE: 'Recarga Gunter para cargar los avisos vinculados locales.',
                REMINDER_AUTH_REQUIRED: 'Inicia sesión antes de programar o consultar tus avisos.',
                REMINDER_ACCOUNT_CHANGED: 'La cuenta cambió durante la operación. Revisa los avisos desde la sesión correcta.',
                REMINDER_OWNER_MISMATCH: 'El aviso no pertenece a la cuenta actual.'
            })[code || message] || (['reminder.retry', 'reminder.inspect'].includes(tool?.id)
                ? 'El servicio local no devolvió un resultado verificable. No tengo una causa clasificada; consulta el estado antes de repetir la orden, porque el cambio podría haberse guardado. No mostraré datos sensibles del error.' : message);
            return `No pude verificar el recordatorio: ${detail}\nRevisa Recordatorios antes de repetir la orden.${['reminder.update', 'reminder.retry', 'reminder.inspect'].includes(tool?.id) ? '' : ' Los avisos vinculados necesitan Gunter abierto en este navegador.'}`;
        }
        if (tool?.id?.startsWith('calendar.')) {
            const detail = ({
                EVENT_AUTH_REQUIRED: 'La sesión ya no está verificada.',
                EVENT_OWNER_MISMATCH: 'La cuenta cambió o el evento no pertenece a esta cuenta.',
                EVENT_STATUS_CHANGED: 'El evento ya no está activo.',
                EVENT_CHANGED: 'Los datos del evento cambiaron después de la propuesta.',
                EVENT_INVALID_TITLE: 'El nombre del evento no es válido.',
                EVENT_INVALID_DATES: 'La fecha de fin debe ser válida y posterior al inicio.',
                EVENT_SCHEDULE_CHANGED: 'Los eventos del horario cambiaron después de la propuesta; prepara y confirma el horario otra vez.',
                EVENT_SCHEDULE_UNAVAILABLE: 'No pude comprobar los cruces de tu agenda. No guardé el cambio.',
                EVENT_PATCH_FORBIDDEN: 'El cambio incluye campos que este flujo no permite modificar.'
            })[code || message] || message;
            return `No pude verificar la acción en tu agenda: ${detail}\nRevisa el evento en Agenda antes de repetir la orden; si cambió, selecciona sus datos actuales y confirma de nuevo.`;
        }
        const advice = ({
            desktop_program_full_access_required: 'Puedes permitir el acceso general a programas desde Configuración → Centro de control → Dispositivos activos. Ese cambio amplía permisos y requiere tu confirmación; también puedes mantener el acceso limitado y elegir un programa permitido.',
            desktop_app_not_allowed: 'Mantén el acceso limitado y abre una aplicación de la lista permitida, o concede acceso general al PC desde Configuración si realmente lo necesitas.',
            desktop_app_ambiguous: 'Dime el nombre exacto o la ruta del ejecutable para evitar abrir la aplicación equivocada.',
            desktop_program_not_found: 'Comprueba la ruta en el Explorador o dime el nombre exacto de la aplicación instalada.',
            desktop_program_type_not_allowed: 'Indícame el acceso directo o ejecutable compatible de esa aplicación.',
            desktop_path_not_allowed: 'Autoriza esa carpeta en Gunter Node o limita la acción a Descargas, Documentos o Escritorio.',
            desktop_path_not_found: 'Comprueba que la ruta esté escrita correctamente y que la unidad esté conectada.',
            desktop_absolute_path_required: 'Dime la ruta completa, por ejemplo C:\\Users\\tu-usuario\\Documents.',
            desktop_ui_runtime_missing: 'Revisa la instalación de Gunter Node y sus componentes de accesibilidad; mientras tanto puedes realizar ese paso manualmente.',
            desktop_ui_runtime_failed: 'Comprueba que la ventana siga abierta y que Gunter Node esté en línea; luego puedo volver a inspeccionar sus controles.',
            desktop_ui_window_not_found: 'Abre la aplicación y dime su nombre de ventana; después puedo inspeccionar los controles disponibles.',
            desktop_ui_control_not_found: 'Pídeme primero “revisa los botones de [aplicación]” para ver qué controles accesibles reconoce.',
            desktop_ui_control_not_identifiable: 'Enfoca el control en pantalla y usa la opción de capturar/identificar objetivo; también puedes indicar otro botón con nombre visible.',
            desktop_ui_control_not_invokable: 'Ese control no ofrece una acción de accesibilidad compatible; prueba a usar la interfaz manualmente o un flujo aprobado distinto.',
            desktop_ui_control_not_editable: 'Ese campo no acepta escritura automatizada; comprueba si la aplicación ofrece otro campo editable.',
            desktop_ui_sensitive_field_not_allowed: 'Introduce ese dato sensible manualmente en la aplicación; Gunter puede continuar con el siguiente paso no sensible después.',
            desktop_ui_shortcut_not_allowed: 'Usa uno de los atajos permitidos o indícame una acción equivalente mediante un botón accesible.',
            desktop_ui_timeout: 'Revisa el PC y la aplicación antes de reintentar: el paso pudo haber ocurrido sin que recibiera confirmación, así evitamos duplicarlo.',
            desktop_ui_not_verified: 'Revisa la aplicación antes de repetirlo. Si el cambio no ocurrió, vuelve a pedírmelo y confirmaré la acción.',
            desktop_media_not_verified: 'Comprueba si hay un reproductor activo y si Gunter Node sigue conectado.',
            node_not_found: 'Vuelve a vincular el dispositivo desde Configuración y confirma que Gunter Node esté abierto y en línea.',
            node_unavailable: 'Comprueba la conexión del dispositivo y actualiza su estado en Configuración → Dispositivos activos.',
            desktop_platform_not_supported: 'Puedes pedir esta acción desde el Gunter Node de Windows o usar los controles del dispositivo directamente.',
            desktop_ui_action_not_allowed: 'Dime qué resultado buscas; puedo proponer una secuencia compatible y pedir autorización antes de ejecutarla.',
            skill_not_supported_by_runtime: 'Actualiza Gunter Node o dime el objetivo para que revise una alternativa compatible.'
        })[code];
        const fallback = /tiempo|timeout|tardó|tardo/i.test(message)
            ? 'Revisa la aplicación antes de repetirlo; no quiero duplicar una acción que quizá sí ocurrió.'
            : 'Comprueba que el dispositivo esté vinculado y en línea. Si me dices qué ves, te indico el siguiente paso.';
        const location = tool?.id?.startsWith('desktop.') ? 'el PC' : tool?.id?.startsWith('mobile.') ? 'el móvil' : 'el servicio';
        return `No pude completar la acción en ${location}: ${message}\nQué puedes hacer: ${advice || fallback}`;
    }

    function parseUiRequest(text, action) {
        const raw = String(text || '').replace(/^(?:(?:hi|hey|hola|oye|ok|okay)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/i, '').trim();
        const quotedValues = [...raw.matchAll(/[“"']([^”"']+)[”"']/g)].map(match => match[1].trim()).filter(Boolean);
        if (action === 'type') {
            let matched = raw.match(/^(?:escribe|escribir|ingresa|ingresar|introduce|introducir)\s+(.+?)\s+en\s+(?:(?:el|la)\s+)?(?:campo|apartado|cuadro|entrada)\s+(.+?)\s+(?:de|en)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
            const textValue = quotedValues[0] || matched?.[1]?.trim().replace(/^[“"']|[”"']$/g, '');
            const targetName = quotedValues[1] || matched?.[2]?.trim().replace(/^[“"']|[”"']$/g, '');
            const app = matched?.[3]?.trim();
            return { rawText: text, text: textValue?.slice(0, 4000) || null, target: targetName ? { name: targetName.slice(0, 180) } : null, app: app?.slice(0, 180) || null };
        }
        if (action === 'click') {
            const matched = raw.match(/(?:haz\s+clic(?:\s+en)?|clic(?:\s+en)?|pulsa|pulsar|presiona|presionar|selecciona|seleccionar)\s+(?:(?:el|la)\s+)?(?:bot[oó]n|control|opci[oó]n)\s+[“"']?(.+?)[”"']?\s+(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
            return { rawText: text, target: matched?.[1] ? { name: matched[1].trim().slice(0, 180) } : null, app: matched?.[2]?.trim().slice(0, 180) || null };
        }
        if (action === 'focus') {
            const app = raw.replace(/^(?:enfoca|enfocar|activa|activar|ve\s+a|cambia\s+a)\s+(?:(?:la|el)\s+)?(?:ventana|programa|aplicaci[oó]n|app)\s+/i, '').trim();
            return { rawText: text, app: app || quotedValues[0] || null };
        }
        if (action === 'wait') {
            const matched = raw.match(/(?:espera|esperar).*?(?:bot[oó]n|control|campo|opci[oó]n)\s+[“"']?(.+?)[”"']?\s+(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
            return { rawText: text, target: matched?.[1] ? { name: matched[1].trim().slice(0, 180) } : null, app: matched?.[2]?.trim().slice(0, 180) || null, timeoutMs: 10000 };
        }
        if (action === 'scroll') {
            const direction = /\barriba\b/i.test(raw) ? 'up' : /\bizquierda\b/i.test(raw) ? 'left' : /\bderecha\b/i.test(raw) ? 'right' : 'down';
            const matched = raw.match(/\b(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
            return { rawText: text, app: matched?.[1]?.trim().slice(0, 180) || quotedValues[0] || null, direction, amount: /\b(mucho|larga|bastante)\b/i.test(raw) ? 6 : 3 };
        }
        if (action === 'hotkey') {
            const shortcutMatch = normalize(raw).match(/\b(ctrl\s*\+\s*[scvaf]|alt\s*\+\s*f4|shift\s*\+\s*tab|enter|escape|tab|delete|backspace|arrow(?:up|down|left|right))\b/i);
            const matched = raw.match(/\b(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
            return { rawText: text, shortcut: shortcutMatch?.[1]?.replace(/\s+/g, '').toLowerCase() || null, app: matched?.[1]?.trim().slice(0, 180) || quotedValues[0] || null };
        }
        if (action === 'select_file') {
            const pathMatch = raw.match(/([a-zA-Z]:[\\/][^“”"']+?)(?=\s+(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)|$)/);
            const appMatch = raw.match(/\s+(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)\s+(.+)$/i);
            return { rawText: text, filePath: quotedValues[0] || pathMatch?.[1]?.trim() || null, app: appMatch?.[1]?.trim().slice(0, 180) || quotedValues[1] || null };
        }
        const matched = raw.match(/\b(?:en|de)\s+(?:(?:la|el)\s+)?(?:aplicaci[oó]n|app|programa|ventana)?\s*(.+)$/i);
        return { rawText: text, app: matched?.[1]?.trim() || quotedValues[0] || null };
    }

    function isSensitiveUiTarget(target) {
        return /password|passcode|contrase(?:n|ñ)a|clave|token|secret|otp|pin/i.test(`${target?.name || ''} ${target?.automationId || ''}`);
    }

    function dateKey(value, tz) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const get = type => parts.find(part => part.type === type)?.value || '';
        return `${get('year')}-${get('month')}-${get('day')}`;
    }

    function formatTime(iso, tz) {
        if (!iso) return 'sin hora';
        return new Intl.DateTimeFormat('es-CO', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    }

    function formatDateTime(iso, tz) {
        if (!iso) return 'fecha por definir';
        return new Intl.DateTimeFormat('es-CO', {
            timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit'
        }).format(new Date(iso));
    }

    function withoutFinalPeriod(value) {
        return String(value || '').replace(/\.$/, '');
    }

    return { create, normalize, extractTitle, parseSocialSend, parseDesktopRequest, parseProcedureRequest, parseUiRequest, detectMediaAction, desktopErrorMessage, mobileErrorMessage, explainFailure };
});
