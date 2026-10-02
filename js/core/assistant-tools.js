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

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function create(options = {}) {
        const registry = new Map();
        const runtime = options.root || root || {};
        const memoryStorage = new Map();
        const storage = options.storage || safeStorage(runtime.sessionStorage, memoryStorage);
        const now = options.now || (() => new Date());
        const timezone = options.timezone || (() => {
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
            catch { return 'UTC'; }
        });

        function state(next, reason, meta = {}) {
            try { runtime.GunterConversationState?.transition?.(next, { reason, ...meta }); } catch { /* opcional */ }
        }

        function notify(detail) {
            if (!runtime.dispatchEvent || !runtime.CustomEvent) return;
            try { runtime.dispatchEvent(new runtime.CustomEvent('gunter-tool-execution', { detail })); } catch { /* opcional */ }
        }

        async function executeDesktopSkill(skill, payload = {}) {
            const control = runtime.GunterControlPlane;
            if (!control?.nodes || !control?.queueCommand || !control?.waitForCommand) throw new Error('Gunter Node no está disponible en esta pantalla.');
            const nodeData = await control.nodes();
            const node = (nodeData.items || []).find(item => item.nodeType === 'DESKTOP' && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
            if (!node) throw new Error('No hay un PC con Gunter Node conectado. Vincúlalo desde Configuración.');
            const queued = await control.queueCommand({
                nodeId: node.nodeId, skill, payload, autonomy: 'L3', confirmed: true,
                idempotencyKey: `assistant:${skill}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
                ttlMs: 120000
            });
            const command = await control.waitForCommand(queued.command.id, { timeoutMs: 60000 });
            if (command.state !== 'VERIFIED') {
                const code = command.error || command.result?.error;
                throw new Error(desktopErrorMessage(code));
            }
            return { ...(command.result || {}), commandId: command.id, evidence: command.evidence || {} };
        }

        async function executeMobileSkill(skill, payload = {}) {
            const control = runtime.GunterControlPlane;
            if (!control?.nodes || !control?.queueCommand || !control?.waitForCommand) throw new Error('Gunter móvil no está disponible en esta pantalla.');
            const nodeData = await control.nodes();
            const node = (nodeData.items || []).find(item => ['ANDROID', 'IOS'].includes(item.nodeType) && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
            if (!node) throw new Error('No hay un móvil con Gunter conectado. Vincúlalo desde Configuración y abre su acompañante.');
            const queued = await control.queueCommand({
                nodeId: node.nodeId, skill, payload, autonomy: 'L3', confirmed: true,
                idempotencyKey: `assistant:${skill}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
                ttlMs: 120000
            });
            const command = await control.waitForCommand(queued.command.id, { timeoutMs: 45000 });
            if (command.state !== 'VERIFIED') throw new Error(mobileErrorMessage(command.error || command.result?.error));
            return { ...(command.result || {}), commandId: command.id, evidence: command.evidence || {} };
        }

        async function controlPlan(tool, match, confirmed) {
            const control = runtime.GunterControlPlane;
            if (!control?.planTask) return null;
            try {
                const planned = await control.planTask({
                    skill: tool.id,
                    intent: match.args?.rawText || tool.id,
                    priority: match.args?.priority || 'normal',
                    autonomy: tool.confirm === 'never' ? 'L4' : 'L3',
                    confirmed: confirmed || tool.confirm === 'never'
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
            else storage.setItem(PENDING_KEY, JSON.stringify({ ...value, createdAt: Date.now() }));
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
            if (/\b(abre|abrir|inicia|iniciar|ejecuta|ejecutar|entra|ingresa)\b.*\b(programa|aplicacion|app)\b/.test(t)
                || /\b(abre|inicia|ejecuta|entra)\s+(?:a\s+|en\s+|la\s+|el\s+)?(?:calculadora|bloc de notas|notepad|paint|explorador|spotify|chrome|edge|firefox|word|excel|powerpoint|outlook|discord|telegram|whatsapp|visual studio code|vscode)\b/.test(t)) {
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

            if (/\b(programa|programame|crea|haz|hacer)\b.*\b(seguimiento|follow up|follow-up)\b/.test(t)) {
                return { toolId: 'follow_up.schedule', args: { rawText: text } };
            }

            if (/\b(recuerdame|recordarme|avisame)\b/.test(t)
                || /\b(ponme|crea|programa)\b.*\b(recordatorio|aviso)\b/.test(t)) {
                return { toolId: 'reminder.schedule', args: { rawText: text } };
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

        async function prepare(match) {
            if (match.toolId === 'agenda.list' || match.toolId === 'jobs.list') return match;
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
                const service = options.jobsService || runtime.GunterJobs;
                const title = extractTitle(match.args.rawText, match.toolId);
                const candidates = service?.list ? await service.list({ limit: 100 }) : [];
                const active = candidates.filter(job => !['completed', 'failed', 'cancelled'].includes(job.status));
                const needle = normalize(title);
                const target = active.find(job => normalize(job.title) === needle)
                    || active.find(job => normalize(job.title).includes(needle) || needle.includes(normalize(job.title)))
                    || (active.length === 1 ? active[0] : null);
                return { ...match, args: { ...match.args, title, targetId: target?.id || null, target: target || null } };
            }
            const resolved = await resolveTime(match.args.rawText);
            const title = extractTitle(match.args.rawText, match.toolId);
            return {
                ...match,
                args: {
                    ...match.args,
                    title,
                    ...(['tasks.create', 'reminder.schedule', 'follow_up.schedule'].includes(match.toolId) ? {
                        ...(match.toolId === 'tasks.create' ? { dueAt: resolved?.iso || null } : { runAt: resolved?.iso || null })
                    } : {
                        startAt: resolved?.iso || null,
                        endAt: resolved?.end || null,
                        kind: resolved?.kind || 'instant',
                        rrule: resolved?.rrule || null,
                        pushToGoogle: /\b(google|calendar)\b/i.test(match.args.rawText)
                    }),
                    temporalAmbiguity: resolved?.ambiguity || null
                }
            };
        }

        async function execute(match, confirmed = false) {
            const tool = registry.get(match.toolId);
            if (!tool) return { handled: false };
            const validation = tool.validate ? await tool.validate(match.args) : { ok: true };
            if (!validation?.ok) {
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

            if (tool.confirm === 'always' && !confirmed) {
                const prompt = tool.confirmation(match.args);
                savePending({ toolId: tool.id, args: match.args, prompt });
                state('awaiting_confirmation', 'tool-confirmation-required', { toolId: tool.id });
                notify({ phase: 'awaiting_confirmation', toolId: tool.id, args: match.args });
                return { handled: true, intent: tool.id, status: 'awaiting_confirmation', requiresConfirmation: true, reply: prompt };
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
                await controlTransition(controlRun, 'verified', { evidence: { verified: true, source: 'legacy_adapter' }, reason: 'legacy_adapter_verified' });
                if (controlRun) controlStage = 'verified';
                await controlTransition(controlRun, 'completed', { reason: 'legacy_adapter_complete' });
                const reply = tool.formatResult ? await tool.formatResult(result, match.args) : 'Listo.';
                savePending(null);
                state('idle', 'tool-complete', { toolId: tool.id, verified: true });
                notify({ phase: 'complete', toolId: tool.id, result, verified: true });
                return { handled: true, intent: tool.id, status: 'complete', verified: true, result, reply };
            } catch (error) {
                const failureState = controlStage === 'verifying' ? 'verification_failed' : 'failed';
                await controlTransition(controlRun, failureState, { error: error.code || error.message, reason: 'legacy_adapter_error' });
                state('error', 'tool-error', { toolId: tool.id, error: error.message });
                notify({ phase: 'error', toolId: tool.id, error: error.message });
                return { handled: true, intent: tool.id, status: 'error', verified: false, reply: `No pude completar la acción: ${error.message}` };
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
            notify({ phase: 'workflow_step_complete', toolId: tool.id, stepId: step.stepId, verified: true });
            return { result, evidence, reply };
        }

        async function dispatch(text) {
            try { await runtime.GunterContextProvider?.enrich?.(text, { channel: 'tool' }); } catch { /* local-first */ }
            const normalized = normalize(text);
            const pending = getPending();
            if (pending && isAffirmative(normalized)) {
                savePending(null);
                return execute({ toolId: pending.toolId, args: pending.args }, true);
            }
            if (pending && isNegative(normalized)) {
                savePending(null);
                state('idle', 'tool-cancelled', { toolId: pending.toolId });
                notify({ phase: 'cancelled', toolId: pending.toolId });
                return { handled: true, intent: pending.toolId, status: 'cancelled', reply: 'Cancelado. No hice ningún cambio.' };
            }

            const detected = detect(text);
            if (!detected) return { handled: false };
            const prepared = await prepare(detected);
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
                return control.sendConversationMessage({ provider: args.target.provider, peerId: args.target.peerId, text: args.message, confirmed: true, source: 'user_voice_confirmed' });
            },
            verify(result) { return result?.ok === true && Boolean(result.sentAt); },
            formatResult(result, args) { return `Mensaje enviado y verificado a ${args.target.peerName} por ${args.target.provider}.`; }
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
            execute(args) { return executeDesktopSkill('desktop.apps.open', { app: args.app, programPath: args.programPath }); },
            verify(result) { return result?.evidence?.processStarted === true; },
            formatResult(result, args) { return `Abrí ${args.app || args.programPath} en tu PC.`; }
        });

        register({
            id: 'mobile.open_app',
            description: 'Abre una aplicación o enlace permitido en el móvil conectado.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.programPath ? { ok: true } : { ok: false, reply: '¿Qué aplicación quieres abrir en el móvil?' }; },
            execute(args) { return executeMobileSkill('mobile.open_app', { app: args.app, deepLink: args.deepLink }); },
            verify(result) { return result?.evidence?.appOpened === true; },
            formatResult(result, args) { return `Abrí ${args.app || result.opened || 'la aplicación solicitada'} en el móvil.`; }
        });

        register({
            id: 'mobile.files.list', description: 'Lista la carpeta autorizada en el móvil conectado.', confirm: 'never', reversible: true,
            execute() { return executeMobileSkill('mobile.files.list'); },
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
            execute(args) { return executeMobileSkill('mobile.files.search', { query: args.query }); },
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
            execute(args) { return executeMobileSkill('mobile.files.open', { fileName: args.fileName }); },
            verify(result) { return result?.evidence?.fileOpened === true; },
            formatResult(result) { return `Abrí ${result.file || 'el archivo solicitado'} en el móvil.`; }
        });

        [['play_pause', 'Actualiza la reproducción del móvil.', 'Actualicé la reproducción del móvil.'], ['next', 'Avanza a la siguiente pista en el móvil.', 'Pasé a la siguiente pista en el móvil.']].forEach(([action, description, reply]) => register({
            id: `mobile.media.${action}`, description, confirm: 'never', reversible: true,
            execute() { return executeMobileSkill(`mobile.media.${action}`); },
            verify(result) { return result?.evidence?.playbackStateChanged === true || result?.evidence?.playbackStateObserved === true; },
            formatResult() { return reply; }
        }));

        register({
            id: 'desktop.files.open',
            description: 'Abre un archivo o carpeta por su ruta completa en el PC conectado.',
            confirm: 'never', reversible: true,
            validate(args) { return args.path ? { ok: true } : { ok: false, reply: 'Dime la ruta completa del archivo o carpeta.' }; },
            execute(args) { return executeDesktopSkill('desktop.files.open', { path: args.path }); },
            verify(result) { return result?.evidence?.pathOpened === true; },
            formatResult(result) { return `Abrí ${result.name || 'la ruta solicitada'} en tu PC.`; }
        });

        register({
            id: 'desktop.files.list',
            description: 'Lista el contenido de cualquier carpeta autorizada del PC.',
            confirm: 'never', reversible: true,
            validate(args) { return args.path ? { ok: true } : { ok: false, reply: 'Dime qué carpeta quieres revisar usando su ruta completa.' }; },
            execute(args) { return executeDesktopSkill('desktop.files.list', { path: args.path, limit: 100 }); },
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
            execute(args) { return executeDesktopSkill('desktop.files.search', { root: args.root, query: args.query, limit: 50, maxDepth: 8 }); },
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
            execute() { return executeDesktopSkill(`desktop.media.${action}`); },
            verify(result) { return result?.evidence?.mediaCommandSent === true; },
            formatResult() { return reply; }
        }));

        register({
            id: 'desktop.ui.inspect',
            description: 'Enumera controles accesibles de una aplicación sin leer el contenido escrito.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.window ? { ok: true } : { ok: false, reply: '¿Qué aplicación o ventana quieres revisar?' }; },
            execute(args) { return executeDesktopSkill('desktop.ui.inspect', { app: args.app, window: args.window, limit: 120 }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.focus', { app: args.app, window: args.window, target: args.target }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.click', { app: args.app, window: args.window, target: args.target }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.type', { app: args.app, window: args.window, target: args.target, text: args.text }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.wait', { app: args.app, window: args.window, target: args.target, timeoutMs: args.timeoutMs || 10000 }); },
            verify(result) { return result?.evidence?.targetObserved === true; },
            formatResult(result) { return `Ya está disponible “${result.target || 'el control solicitado'}”.`; }
        });

        register({
            id: 'desktop.ui.scroll',
            description: 'Desplaza un panel accesible en una dirección y verifica el cambio.',
            confirm: 'never', reversible: true,
            validate(args) { return args.app || args.window ? { ok: true } : { ok: false, reply: '¿En qué aplicación debo desplazarme?' }; },
            execute(args) { return executeDesktopSkill('desktop.ui.scroll', { app: args.app, window: args.window, target: args.target, direction: args.direction, amount: args.amount || 3 }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.hotkey', { app: args.app, window: args.window, shortcut: args.shortcut }); },
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
            execute(args) { return executeDesktopSkill('desktop.ui.select_file', { app: args.app, window: args.window, filePath: args.filePath }); },
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
                const allTasks = await tasksService.list();
                const allEvents = await eventsService.list();
                const target = new Date(now());
                if (args.scope === 'tomorrow') target.setDate(target.getDate() + 1);
                const targetKey = dateKey(target, timezone());
                const activeTasks = allTasks.filter(item => item.status !== 'done' && item.status !== 'cancelled');
                const tasks = args.scope === 'upcoming'
                    ? activeTasks.filter(item => !item.dueAt || new Date(item.dueAt) >= now()).slice(0, 8)
                    : activeTasks.filter(item => !item.dueAt || dateKey(item.dueAt, timezone()) === targetKey);
                const events = args.scope === 'upcoming'
                    ? allEvents.filter(item => item.startAt && new Date(item.startAt) >= now()).slice(0, 8)
                    : allEvents.filter(item => item.startAt && dateKey(item.startAt, timezone()) === targetKey);
                return { scope: args.scope, tasks, events };
            },
            formatResult(result) {
                const label = result.scope === 'tomorrow' ? 'mañana' : result.scope === 'upcoming' ? 'próximamente' : 'hoy';
                if (!result.tasks.length && !result.events.length) return `No tienes tareas ni eventos ${label}.`;
                const lines = [`Esto tienes ${label}:`];
                result.events.forEach(event => lines.push(`• ${formatTime(event.startAt, timezone())} — ${event.title}`));
                result.tasks.forEach(task => lines.push(`• Tarea: ${task.title}${task.dueAt ? ` (${formatTime(task.dueAt, timezone())})` : ''}`));
                return lines.join('\n');
            }
        });

        register({
            id: 'jobs.list',
            description: 'Lista recordatorios y seguimientos persistentes.',
            confirm: 'never',
            reversible: true,
            async execute() {
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.list) throw new Error('El servicio de procesos durables no está disponible.');
                const items = await service.list({ limit: 50 });
                return { items: items.filter(job => !['completed', 'failed', 'cancelled'].includes(job.status)).slice(0, 12) };
            },
            formatResult(result) {
                if (!result.items.length) return 'No tienes recordatorios ni seguimientos programados.';
                const lines = ['Procesos programados:'];
                result.items.forEach(job => {
                    const kind = job.type === 'follow_up' ? 'Seguimiento' : 'Recordatorio';
                    lines.push(`• ${kind}: ${job.title} — ${withoutFinalPeriod(formatDateTime(job.runAt, timezone()))}`);
                });
                return lines.join('\n');
            }
        });

        register({
            id: 'reminder.schedule',
            description: 'Programa un recordatorio persistente en el servidor.',
            confirm: 'never',
            reversible: true,
            validate(args) {
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Qué quieres que te recuerde?' };
                if (!args.runAt) return { ok: false, reply: '¿Cuándo quieres que te lo recuerde?' };
                return { ok: true };
            },
            async execute(args) {
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.scheduleReminder) throw new Error('El servicio de procesos durables no está disponible.');
                return service.scheduleReminder({ title: args.title, runAt: args.runAt, priority: args.priority || 'normal' });
            },
            async verify(result) {
                const service = options.jobsService || runtime.GunterJobs;
                const persisted = await service.get(result.id);
                return persisted?.status === 'scheduled' || persisted?.status === 'retry_wait';
            },
            formatResult(result) {
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
                if (!args.targetId || !args.target) return { ok: false, reply: 'No encontré un proceso activo con ese nombre. Puedes decir “mis recordatorios programados”.' };
                return { ok: true };
            },
            confirmation(args) {
                return `¿Confirmas que cancele “${args.target.title}”, programado para ${formatDateTime(args.target.runAt, timezone())}?`;
            },
            async execute(args) {
                const service = options.jobsService || runtime.GunterJobs;
                if (!service?.cancel) throw new Error('El servicio de procesos durables no está disponible.');
                return service.cancel(args.targetId);
            },
            async verify(result, args) {
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
                return service.create({ title: args.title, dueAt: args.dueAt, source: 'gunter-assistant' });
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

        register({
            id: 'calendar.create',
            description: 'Crea un evento local; siempre requiere confirmación.',
            confirm: 'always',
            reversible: true,
            validate(args) {
                if (!args.title || args.title.length < 2) return { ok: false, reply: '¿Qué nombre tendrá el evento?' };
                if (!args.startAt) return { ok: false, reply: '¿Para qué fecha y hora quieres agendarlo?' };
                if (args.title.length > 180) return { ok: false, reply: 'El nombre del evento es demasiado largo; resúmelo en menos de 180 caracteres.' };
                return { ok: true };
            },
            confirmation(args) {
                const destination = args.pushToGoogle ? ' Lo guardaré localmente e intentaré sincronizarlo con Google Calendar.' : '';
                return `¿Confirmas que agende “${args.title}” para ${formatDateTime(args.startAt, timezone())}?${destination}`;
            },
            async execute(args) {
                const service = options.eventsService || runtime.GunterEventsService;
                if (!service?.create) throw new Error('El servicio de eventos no está disponible.');
                return service.create({
                    title: args.title,
                    startAt: args.startAt,
                    endAt: args.endAt,
                    kind: args.kind,
                    rrule: args.rrule,
                    pushToGoogle: !!args.pushToGoogle,
                    source: 'gunter-assistant'
                });
            },
            async verify(result) {
                const service = options.eventsService || runtime.GunterEventsService;
                const items = await service.list();
                return items.some(item => item.id === result.id);
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
            dispatch, detect, register, listTools, getPending,
            prepareMatch: prepare,
            validatePrepared,
            executeWorkflowStep,
            clearPending: () => savePending(null), normalize
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
        if (toolId === 'calendar.create') return { eventId: result.id || result.eventId, reconsulted: true };
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
        return title.replace(/^[,;:\-]+|[,;:\-]+$/g, '').trim();
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
            let target = quoted || raw.replace(/^(?:abre|abrir|inicia|iniciar|ejecuta|ejecutar|entra|ingresa)\s+(?:(?:a|en|el|la|un)\s+)?(?:(?:programa|aplicaci[oó]n|app)\s+)?/i, '').trim();
            const programPath = windowsPath && /\.(?:exe|com|lnk)$/i.test(windowsPath) ? windowsPath : null;
            return { rawText: text, app: programPath ? null : target, programPath };
        }
        if (kind === 'open_file' || kind === 'list') return { rawText: text, path: quoted || windowsPath || null };
        const body = raw.replace(/^(?:busca|buscar|encuentra|encontrar|localiza|localizar)\s+(?:(?:el|la|un|una)\s+)?(?:(?:archivo|carpeta|documento)\s+)?/i, '');
        const split = body.match(/^(.+?)\s+en\s+([a-zA-Z]:[\\/].+)$/i);
        return { rawText: text, query: quoted || split?.[1]?.trim() || (!windowsPath ? body.trim() : null), root: split?.[2]?.trim() || windowsPath || null };
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
            desktop_app_not_allowed: 'Ese programa no está en la lista segura. Activa el acceso general del PC o indica la ruta exacta del ejecutable.',
            desktop_app_ambiguous: 'Encontré varios programas con ese nombre. Dime el nombre exacto o la ruta del ejecutable.',
            desktop_program_full_access_required: 'Para abrir ese programa debes activar el acceso general desde Configuración.',
            desktop_ui_window_not_found: 'No encontré esa aplicación abierta. Ábrela primero y vuelve a intentarlo.',
            desktop_ui_control_not_found: 'La aplicación no expone un control accesible con ese nombre. Pídeme que enumere sus botones y campos.',
            desktop_ui_control_not_invokable: 'Encontré el control, pero la aplicación no permite pulsarlo mediante accesibilidad.',
            desktop_ui_control_not_editable: 'Encontré el campo, pero la aplicación no permite modificarlo mediante accesibilidad.',
            desktop_ui_control_read_only: 'Ese campo es de solo lectura.',
            desktop_ui_control_not_identifiable: 'No pude identificar ese control de forma estable. Señala un botón o campo con nombre visible y vuelve a enseñarlo.',
            desktop_ui_control_not_scrollable: 'Ese panel no permite desplazamiento mediante accesibilidad. Señala directamente una lista desplazable.',
            desktop_ui_scroll_not_changed: 'El panel ya estaba en el límite o no cambió de posición.',
            desktop_ui_shortcut_not_allowed: 'Ese atajo no está incluido en la lista segura de Gunter.',
            desktop_ui_wait_timeout: 'El control no apareció dentro del tiempo máximo.',
            desktop_file_picker_not_found: 'No encontré un selector de archivos abierto en esa aplicación.',
            desktop_file_picker_confirm_not_found: 'Encontré el archivo, pero no pude identificar el botón para seleccionarlo.',
            desktop_ui_sensitive_field_not_allowed: 'Por seguridad no escribo contraseñas, códigos, tokens, PIN ni OTP.',
            desktop_ui_timeout: 'La aplicación tardó demasiado en responder.'
        })[code] || code || 'El PC no pudo verificar la acción.';
    }

    function mobileErrorMessage(code) {
        return ({
            mobile_app_not_found: 'No encontré esa aplicación en el móvil. Indícame su enlace de apertura o revisa que esté instalada.',
            mobile_app_not_opened: 'El sistema del móvil no abrió esa aplicación o enlace.',
            mobile_files_read_permission_required: 'Autoriza una carpeta desde el acompañante móvil y vuelve a intentarlo.',
            mobile_media_permission_required: 'Activa el permiso de control multimedia en los ajustes del teléfono.',
            mobile_notifications_not_allowed: 'Activa las notificaciones de Gunter en los ajustes del teléfono.',
            mobile_files_read_permission_required: 'Abre el acompañante móvil y autoriza una carpeta con el selector del sistema.',
            mobile_folder_not_authorized: 'Esa carpeta no está autorizada en el móvil. Selecciónala desde el acompañante.',
            node_not_found: 'El móvil ya no está vinculado. Revísalo en Configuración.',
            confirmation_required: 'Esta acción necesita confirmación explícita.'
        })[code] || code || 'El móvil no pudo verificar la acción.';
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

    return { create, normalize, extractTitle, parseSocialSend, parseDesktopRequest, parseProcedureRequest, parseUiRequest, detectMediaAction, desktopErrorMessage, mobileErrorMessage };
});
