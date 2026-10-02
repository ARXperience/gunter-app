/* Pruebas deterministas del núcleo de invocación y tiempo de Gunter. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const invocation = require(path.join(root, 'js', 'core', 'wake-invocation.js'));
const temporal = require(path.join(root, 'js', 'core', 'temporal-context.js'));
const conversationState = require(path.join(root, 'js', 'core', 'conversation-state.js'));
const assistantToolsModule = require(path.join(root, 'js', 'core', 'assistant-tools.js'));
const workflowOrchestratorModule = require(path.join(root, 'js', 'core', 'workflow-orchestrator.js'));
const voiceActivity = require(path.join(root, 'js', 'services', 'voice-activity-service.js'));

let passed = 0;
function test(name, fn) {
    return Promise.resolve().then(fn).then(() => {
        passed += 1;
        console.log(`  ✓ ${name}`);
    });
}

function browserModule(relativePath, windowOverrides = {}) {
    const window = { ...windowOverrides };
    const context = vm.createContext({
        window, console, Intl, Date, Math, JSON, Promise,
        setTimeout, clearTimeout
    });
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
    return window;
}

(async () => {
    console.log('GUNTER ASSISTANT CORE');

    await test('"Hi Gunter" conserva la orden', () => {
        const result = invocation.detect('Hi Gunter, ¿qué hora es?');
        assert.equal(result.type, 'hi_gunter');
        assert.equal(result.command, 'que hora es');
    });
    await test('"Hola Gunter" tiene identidad propia', () => {
        assert.equal(invocation.detect('Hola Gunter agenda una reunión').type, 'hola_gunter');
    });
    await test('"Oye Gunter" tiene identidad propia', () => {
        assert.equal(invocation.detect('Oye Gunter, escucha esto').type, 'oye_gunter');
    });
    await test('"Gunter" solo activa sin inventar una orden', () => {
        const result = invocation.detect('Gunter');
        assert.equal(result.type, 'solo_gunter');
        assert.equal(result.command, '');
    });
    await test('tolera transcripción fonética "Gonter"', () => {
        assert.equal(invocation.detect('Hey Gonter crea una tarea').type, 'hi_gunter');
    });
    await test('cada familia de llamado responde distinto', () => {
        const hi = invocation.responseFor('hi_gunter', { index: 0 });
        const hola = invocation.responseFor('hola_gunter', { index: 0 });
        const solo = invocation.responseFor('solo_gunter', { index: 0 });
        assert.equal(new Set([hi, hola, solo]).size, 3);
        assert.notEqual(invocation.responseFor('hi_gunter', { index: 0 }), invocation.responseFor('hi_gunter', { index: 1 }));
    });

    const fixedNow = new Date('2026-08-28T15:45:30.000Z');
    await test('hora actual usa America/Bogota y el reloj suministrado', () => {
        const answer = temporal.answer('¿Qué hora es?', { now: fixedNow, timezone: 'America/Bogota', locale: 'es-CO' });
        assert.equal(answer.source, 'device-clock');
        assert.match(answer.timeText, /10:45/);
    });
    await test('fecha actual es real y localizada', () => {
        const answer = temporal.answer('¿Qué día es hoy?', { now: fixedNow, timezone: 'America/Bogota', locale: 'es-CO' });
        assert.match(answer.dateText.toLowerCase(), /viernes/);
        assert.match(answer.dateText.toLowerCase(), /28 de agosto de 2026/);
    });
    await test('fecha y hora combinadas se resuelven sin LLM', () => {
        const answer = temporal.answer('¿Qué fecha y hora es?', { now: fixedNow, timezone: 'America/Bogota', locale: 'es-CO' });
        assert.equal(answer.intent, 'datetime');
        assert.match(answer.reply, /28 de agosto de 2026/);
        assert.match(answer.reply, /10:45/);
    });
    await test('una orden con hora futura no se confunde con consulta del reloj', () => {
        assert.equal(temporal.answer('agenda una reunión mañana a las diez', { now: fixedNow }), null);
    });

    const timeWindow = browserModule(path.join('js', 'core', 'time-parser.js'));
    await test('"pasado mañana" no se reduce a mañana', async () => {
        const result = await timeWindow.GunterTimeParser.parse('pasado mañana a las diez', fixedNow, 'America/Bogota');
        assert.match(result.iso, /^2026-08-30T10:00:00-05:00$/);
    });
    await test('reconoce horas pronunciadas y "y media"', async () => {
        const result = await timeWindow.GunterTimeParser.parse('mañana a las diez y media', fixedNow, 'America/Bogota');
        assert.match(result.iso, /^2026-08-29T10:30:00-05:00$/);
    });
    await test('"ahora" conserva el instante local real', async () => {
        const result = await timeWindow.GunterTimeParser.parse('ahora', fixedNow, 'America/Bogota');
        assert.match(result.iso, /^2026-08-28T10:45:30-05:00$/);
    });

    const entityWindow = browserModule(path.join('js', 'core', 'entity-extractor.js'), {
        GunterCoreModels: { emptyEntityMap: rawText => ({ rawText, missing: [] }) }
    });
    await test('fecha y hora contiguas forman una sola expresión', async () => {
        const result = await entityWindow.GunterEntityExtractor.extractEntities(
            'Agenda reunión mañana a las diez',
            { primary: { type: 'meeting' } },
            { recentEntities: { people: [], projects: [] } }
        );
        assert.equal(result.datetimeExpr.length, 1);
        assert.match(result.datetimeExpr[0].raw, /mañana a las diez/i);
    });
    await test('limpia el prefijo al crear una tarea con lenguaje natural', async () => {
        const result = await entityWindow.GunterEntityExtractor.extractEntities(
            'Crea una tarea para revisar el flujo de pruebas',
            { primary: { type: 'task' } },
            { recentEntities: { people: [], projects: [] } }
        );
        assert.equal(result.title.value, 'revisar el flujo de pruebas');
    });

    await test('máquina conversacional conserva transiciones explícitas', () => {
        const machine = conversationState.create({ bindBrowserEvents: false });
        assert.equal(machine.getState().value, 'idle');
        assert.equal(machine.transition('listening_wake', { reason: 'test' }).ok, true);
        assert.equal(machine.transition('listening_query', { reason: 'invocation' }).ok, true);
        assert.equal(machine.transition('thinking', { reason: 'query' }).ok, true);
        assert.equal(machine.transition('awaiting_confirmation', { reason: 'confirm' }).ok, true);
        assert.equal(machine.getState().value, 'awaiting_confirmation');
        assert.equal(machine.transition('estado_inventado').ok, false);
        machine.reset('direct-confirm-test');
        assert.equal(machine.transition('awaiting_confirmation', { reason: 'tool-proposal' }).ok, true);
    });

    await test('VAD local distingue silencio de voz sin enviar audio', () => {
        const silence = voiceActivity.analyzeSamples(new Float32Array(1024), 0.008);
        const speech = voiceActivity.analyzeSamples(new Float32Array(1024).fill(0.12), 0.008);
        assert.equal(silence.speech, false);
        assert.equal(speech.speech, true);
        assert.ok(speech.rms > speech.threshold);
    });

    function makeAssistantTools() {
        const tasks = [];
        const events = [];
        const jobs = [];
        const sentMessages = [];
        const desktopCommands = [];
        const executedProcedures = [];
        const stateTransitions = [];
        const state = { transition: (value, meta) => stateTransitions.push({ value, meta }) };
        const tasksService = {
            create: async data => {
                const item = { id: `task_${tasks.length + 1}`, status: 'pending', ...data };
                tasks.push(item);
                return item;
            },
            list: async () => [...tasks]
        };
        const eventsService = {
            create: async data => {
                const item = { id: `event_${events.length + 1}`, syncStatus: 'local', ...data };
                events.push(item);
                return item;
            },
            list: async () => [...events]
        };
        const jobsService = {
            scheduleReminder: async data => {
                const item = { id: `job_${jobs.length + 1}`, type: 'reminder', status: 'scheduled', ...data };
                jobs.push(item);
                return item;
            },
            scheduleFollowUp: async data => {
                const item = { id: `job_${jobs.length + 1}`, type: 'follow_up', status: 'scheduled', ...data };
                jobs.push(item);
                return item;
            },
            list: async () => [...jobs],
            get: async id => jobs.find(item => item.id === id) || null,
            cancel: async id => {
                const item = jobs.find(job => job.id === id);
                if (item) item.status = 'cancelled';
                return item || null;
            }
        };
        const toolset = assistantToolsModule.create({
            root: {
                GunterConversationState: state,
                GunterControlPlane: {
                    procedures: async () => ({ items: [{ id: 'proc_weekly', name: 'Completar reporte semanal', state: 'APPROVED', steps: [{ order: 1 }] }] }),
                    conversations: async () => ({ items: [{ id: 'whatsapp:ana', provider: 'whatsapp', peerId: '57300123', peerName: 'Ana' }] }),
                    sendConversationMessage: async value => { sentMessages.push(value); return { ok: true, sentAt: '2026-08-30T18:00:00.000Z' }; },
                    nodes: async () => ({ items: [
                        { nodeId: 'node_pc', nodeType: 'DESKTOP', state: 'ONLINE' },
                        { nodeId: 'node_android', nodeType: 'ANDROID', state: 'ONLINE' }
                    ] }),
                    queueCommand: async value => { desktopCommands.push(value); return { command: { id: `cmd_${desktopCommands.length}` } }; },
                    waitForCommand: async id => {
                        const request = desktopCommands[Number(id.split('_')[1]) - 1];
                        const evidence = request.skill === 'mobile.open_app' ? { appOpened: true }
                            : request.skill.startsWith('mobile.media.') ? { playbackStateObserved: true }
                                : request.skill === 'mobile.files.list' ? { folderRead: true }
                                    : request.skill === 'mobile.files.search' ? { searchCompleted: true }
                                        : request.skill === 'mobile.files.open' ? { fileOpened: true }
                                : request.skill === 'desktop.apps.open' ? { processStarted: true }
                            : request.skill === 'desktop.files.open' ? { pathOpened: true }
                                : request.skill === 'desktop.files.list' ? { pathRead: true }
                                    : request.skill === 'desktop.files.search' ? { searchCompleted: true }
                                        : request.skill.startsWith('desktop.media.') ? { mediaCommandSent: true }
                                            : request.skill === 'desktop.ui.inspect' ? { controlsInspected: true }
                                                : request.skill === 'desktop.ui.focus' ? { windowFocused: true }
                                                    : request.skill === 'desktop.ui.click' ? { controlInvoked: true }
                                                        : request.skill === 'desktop.ui.wait' ? { targetObserved: true }
                                                            : request.skill === 'desktop.ui.scroll' ? { scrollChanged: true }
                                                                : request.skill === 'desktop.ui.hotkey' ? { shortcutSent: true }
                                                                    : request.skill === 'desktop.ui.select_file' ? { fileSelected: true }
                                                                        : { valueSet: true };
                        const result = request.skill === 'desktop.files.list' ? { items: [{ name: 'Informe.pdf', kind: 'file' }] }
                            : request.skill === 'desktop.files.search' ? { items: [{ path: 'C:\\Datos\\Informe.pdf' }] }
                                : request.skill === 'desktop.ui.inspect' ? { window: request.payload.app, controls: [{ name: 'Guardar', controlType: 'Button' }] }
                                    : request.skill.startsWith('desktop.ui.') ? { window: request.payload.app, target: request.payload.target?.name }
                                        : { name: request.payload.app || request.payload.path };
                        return { id, state: 'VERIFIED', result, evidence };
                    }
                },
                GunterProcedureRecorder: { execute: async id => { executedProcedures.push(id); return { ok: true, executed: [1] }; } }
            },
            tasksService,
            eventsService,
            jobsService,
            now: () => fixedNow,
            timezone: () => 'America/Bogota',
            timeParser: {
                parse: async text => /mañana|manana/i.test(text)
                    ? { iso: '2026-08-29T10:00:00-05:00', kind: 'instant' }
                    : null
            }
        });
        return { toolset, tasks, events, jobs, sentMessages, desktopCommands, executedProcedures, stateTransitions };
    }

    await test('registro expone solo herramientas allowlist', () => {
        const { toolset } = makeAssistantTools();
        assert.deepEqual(toolset.listTools().map(tool => tool.id), [
            'social.send', 'procedure.execute', 'desktop.apps.open', 'mobile.open_app', 'mobile.files.list', 'mobile.files.search', 'mobile.files.open', 'mobile.media.play_pause', 'mobile.media.next',
            'desktop.files.open', 'desktop.files.list', 'desktop.files.search',
            'desktop.media.play_pause', 'desktop.media.next', 'desktop.media.previous', 'desktop.media.stop',
            'desktop.media.volume_up', 'desktop.media.volume_down', 'desktop.media.mute',
            'desktop.ui.inspect', 'desktop.ui.focus', 'desktop.ui.click', 'desktop.ui.type',
            'desktop.ui.wait', 'desktop.ui.scroll', 'desktop.ui.hotkey', 'desktop.ui.select_file',
            'agenda.list', 'jobs.list', 'reminder.schedule', 'follow_up.schedule',
            'jobs.cancel', 'tasks.create', 'calendar.create'
        ]);
    });

    await test('una ruta aprobada se localiza por nombre y exige confirmación', async () => {
        const { toolset, executedProcedures } = makeAssistantTools();
        const proposed = await toolset.dispatch('Gunter, ejecuta la ruta completar reporte semanal');
        assert.equal(proposed.status, 'awaiting_confirmation');
        assert.equal(executedProcedures.length, 0);
        assert.match(proposed.reply, /Completar reporte semanal/);
        const completed = await toolset.dispatch('sí');
        assert.equal(completed.status, 'complete');
        assert.deepEqual(executedProcedures, ['proc_weekly']);
    });

    await test('Gunter controla música sin aceptar comandos arbitrarios', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const play = await toolset.dispatch('Gunter, reproduce la música');
        assert.equal(play.status, 'complete');
        assert.equal(desktopCommands[0].skill, 'desktop.media.play_pause');
        assert.equal(desktopCommands[0].payload.constructor, Object);
        const next = await toolset.dispatch('siguiente canción');
        assert.equal(next.status, 'complete');
        assert.equal(desktopCommands[1].skill, 'desktop.media.next');
    });

    await test('Gunter dirige al móvil las órdenes que mencionan el teléfono', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const app = await toolset.dispatch('Gunter, entra a Spotify en mi móvil');
        assert.equal(app.status, 'complete');
        assert.equal(desktopCommands[0].nodeId, 'node_android');
        assert.equal(desktopCommands[0].skill, 'mobile.open_app');
        assert.equal(desktopCommands[0].payload.app, 'Spotify');
        const next = await toolset.dispatch('Gunter, siguiente canción en mi celular');
        assert.equal(next.status, 'complete');
        assert.equal(desktopCommands[1].skill, 'mobile.media.next');
    });

    await test('Gunter consulta archivos solo en la carpeta elegida del móvil', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const listing = await toolset.dispatch('Gunter, muestra los archivos en mi celular');
        assert.equal(listing.status, 'complete');
        assert.equal(desktopCommands[0].skill, 'mobile.files.list');
        const search = await toolset.dispatch('Gunter, busca el documento contrato en mi móvil');
        assert.equal(search.status, 'complete');
        assert.equal(desktopCommands[1].skill, 'mobile.files.search');
        assert.equal(desktopCommands[1].payload.query, 'contrato');
        const opened = await toolset.dispatch('Gunter, abre el archivo contrato.pdf en mi celular');
        assert.equal(opened.status, 'complete');
        assert.equal(desktopCommands[2].skill, 'mobile.files.open');
        assert.equal(desktopCommands[2].payload.fileName, 'contrato.pdf');
    });

    await test('escribir en otra aplicación exige confirmación y usa un destino semántico', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const proposed = await toolset.dispatch('Gunter, escribe "Hola mundo" en el campo "Contenido" de Bloc de notas');
        assert.equal(proposed.status, 'awaiting_confirmation');
        assert.equal(desktopCommands.length, 0);
        assert.match(proposed.reply, /Contenido/);
        const confirmed = await toolset.dispatch('sí');
        assert.equal(confirmed.status, 'complete');
        assert.equal(desktopCommands.length, 1);
        assert.equal(desktopCommands[0].skill, 'desktop.ui.type');
        assert.equal(desktopCommands[0].payload.target.name, 'Contenido');
        assert.equal(desktopCommands[0].payload.text, 'Hola mundo');
    });

    await test('Gunter espera, desplaza y limita atajos y archivos a órdenes confirmadas', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const waited = await toolset.dispatch('Gunter, espera hasta que aparezca el botón Guardar en la aplicación Bloc de notas');
        assert.equal(waited.status, 'complete');
        assert.equal(desktopCommands[0].skill, 'desktop.ui.wait');
        const scrolled = await toolset.dispatch('Gunter, desplaza hacia abajo en la aplicación Bloc de notas');
        assert.equal(scrolled.status, 'complete');
        assert.equal(desktopCommands[1].skill, 'desktop.ui.scroll');

        const shortcut = await toolset.dispatch('Gunter, usa el atajo Ctrl+S en la aplicación Bloc de notas');
        assert.equal(shortcut.status, 'awaiting_confirmation');
        await toolset.dispatch('sí');
        assert.equal(desktopCommands[2].skill, 'desktop.ui.hotkey');
        assert.equal(desktopCommands[2].payload.shortcut, 'ctrl+s');

        const file = await toolset.dispatch('Gunter, selecciona el archivo "C:\\Datos\\informe.pdf" en la aplicación Bloc de notas');
        assert.equal(file.status, 'awaiting_confirmation');
        await toolset.dispatch('sí');
        assert.equal(desktopCommands[3].skill, 'desktop.ui.select_file');
        assert.equal(desktopCommands[3].payload.filePath, 'C:\\Datos\\informe.pdf');
    });

    await test('Gunter abre programas y rutas generales mediante el PC conectado', async () => {
        const { toolset, desktopCommands } = makeAssistantTools();
        const app = await toolset.dispatch('Gunter, abre la calculadora');
        assert.equal(app.status, 'complete');
        assert.equal(desktopCommands[0].skill, 'desktop.apps.open');
        assert.equal(desktopCommands[0].payload.app, 'calculadora');
        const spotify = await toolset.dispatch('Gunter, entra a Spotify');
        assert.equal(spotify.status, 'complete');
        assert.equal(desktopCommands[1].payload.app, 'Spotify');
        const folder = await toolset.dispatch('Gunter, lista los archivos de la carpeta C:\\Datos');
        assert.equal(folder.status, 'complete');
        assert.equal(desktopCommands[2].skill, 'desktop.files.list');
        assert.equal(desktopCommands[2].payload.path, 'C:\\Datos');
    });

    await test('mensaje social se prepara y solo se envía tras confirmación', async () => {
        const { toolset, sentMessages } = makeAssistantTools();
        const proposed = await toolset.dispatch('Gunter, envía por WhatsApp a Ana el mensaje llego a las cinco');
        assert.equal(proposed.status, 'awaiting_confirmation');
        assert.equal(sentMessages.length, 0);
        assert.match(proposed.reply, /Ana/);
        const confirmed = await toolset.dispatch('sí');
        assert.equal(confirmed.status, 'complete');
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].text, 'llego a las cinco');
        assert.equal(sentMessages[0].source, 'user_voice_confirmed');
    });

    await test('programa un recordatorio durable y verifica su persistencia', async () => {
        const { toolset, jobs } = makeAssistantTools();
        const result = await toolset.dispatch('Hola Gunter, recuérdame llamar a mamá mañana a las diez');
        assert.equal(result.status, 'complete');
        assert.equal(result.verified, true);
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].type, 'reminder');
        assert.equal(jobs[0].title, 'llamar a mamá');
        assert.equal(jobs[0].runAt, '2026-08-29T10:00:00-05:00');
    });

    await test('cancelar un recordatorio exige confirmación y verifica el resultado', async () => {
        const { toolset, jobs } = makeAssistantTools();
        await toolset.dispatch('Recuérdame llamar a mamá mañana a las diez');
        const proposed = await toolset.dispatch('Cancela el recordatorio de llamar a mamá');
        assert.equal(proposed.status, 'awaiting_confirmation');
        assert.equal(jobs[0].status, 'scheduled');
        const confirmed = await toolset.dispatch('sí');
        assert.equal(confirmed.status, 'complete');
        assert.equal(confirmed.verified, true);
        assert.equal(jobs[0].status, 'cancelled');
    });

    await test('crea una tarea y verifica que quedó persistida', async () => {
        const { toolset, tasks } = makeAssistantTools();
        const result = await toolset.dispatch('Crea una tarea para comprar leche mañana a las diez');
        assert.equal(result.handled, true);
        assert.equal(result.status, 'complete');
        assert.equal(result.verified, true);
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].title, 'comprar leche');
        assert.equal(tasks[0].dueAt, '2026-08-29T10:00:00-05:00');
    });

    await test('evento espera confirmación y solo se crea después de “sí”', async () => {
        const { toolset, events } = makeAssistantTools();
        const proposed = await toolset.dispatch('Agenda una reunión de producto mañana a las diez');
        assert.equal(proposed.status, 'awaiting_confirmation');
        assert.equal(events.length, 0);
        const confirmed = await toolset.dispatch('sí');
        assert.equal(confirmed.status, 'complete');
        assert.equal(confirmed.verified, true);
        assert.equal(events.length, 1);
        assert.equal(events[0].title, 'producto');
    });

    await test('rechazar una confirmación no produce efectos', async () => {
        const { toolset, events } = makeAssistantTools();
        await toolset.dispatch('Agenda una cita médica mañana a las diez');
        const rejected = await toolset.dispatch('no');
        assert.equal(rejected.status, 'cancelled');
        assert.equal(events.length, 0);
        assert.equal(toolset.getPending(), null);
    });

    function makeWorkflowHarness() {
        const local = makeAssistantTools();
        const flows = new Map();
        const submissions = [];
        const riskNeedsConfirmation = skill => ['tasks.create', 'calendar.create', 'reminder.schedule', 'follow_up.schedule'].includes(skill);
        const control = {
            async createWorkflow(input) {
                const steps = input.steps.map((step, index) => ({
                    stepId: `ws_${index + 1}`, index, skill: step.skill, input: step.input,
                    state: riskNeedsConfirmation(step.skill) ? 'WAITING_CONFIRMATION' : 'AUTHORIZED',
                    lease: null
                }));
                const workflow = {
                    workflowId: `wf_${flows.size + 1}`, title: input.title, objective: input.objective,
                    status: steps[0].state === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'READY',
                    currentStepIndex: 0, steps
                };
                flows.set(workflow.workflowId, workflow);
                return { workflow };
            },
            async workflowAction({ workflowId, action, confirmed }) {
                const flow = flows.get(workflowId);
                const step = flow.steps[flow.currentStepIndex];
                if (action === 'pause') { flow.resumeStatus = flow.status; flow.status = 'PAUSED'; }
                if (action === 'resume') flow.status = step.state === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'READY';
                if (action === 'authorize' && confirmed) { step.state = 'AUTHORIZED'; flow.status = 'READY'; }
                if (action === 'cancel') flow.status = 'CANCELLED';
                return { workflow: flow };
            },
            async claimWorkflowStep({ workflowId }) {
                const flow = flows.get(workflowId);
                const step = flow.steps[flow.currentStepIndex];
                step.state = 'STARTED'; step.lease = { leaseId: `wl_${step.index + 1}` };
                flow.status = 'RUNNING';
                return { workflow: flow, step: JSON.parse(JSON.stringify(step)) };
            },
            async submitWorkflowResult(value) {
                submissions.push(value);
                const flow = flows.get(value.workflowId);
                const step = flow.steps[flow.currentStepIndex];
                if (value.error) { step.state = 'FAILED'; flow.status = 'BLOCKED'; return { workflow: flow, executionFailed: true }; }
                step.state = 'VERIFIED';
                flow.currentStepIndex += 1;
                if (flow.currentStepIndex >= flow.steps.length) flow.status = 'COMPLETED';
                else {
                    const next = flow.steps[flow.currentStepIndex];
                    flow.status = next.state === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'READY';
                }
                return { workflow: flow };
            }
        };
        const orchestrator = workflowOrchestratorModule.create({
            tools: local.toolset, control, now: () => fixedNow.getTime()
        });
        return { ...local, control, flows, submissions, orchestrator };
    }

    await test('petición natural multipaso propone antes de ejecutar', async () => {
        const { orchestrator, tasks, submissions } = makeWorkflowHarness();
        const proposal = await orchestrator.dispatch('Hola Gunter, consulta mi agenda de hoy y luego crea una tarea para comprar leche mañana a las diez');
        assert.equal(proposal.handled, true);
        assert.equal(proposal.status, 'awaiting_confirmation');
        assert.equal(proposal.plan.length, 2);
        assert.equal(tasks.length, 0);
        assert.match(proposal.reply, /1\. Consultar tu agenda/i);
        assert.match(proposal.reply, /2\. Crear la tarea/i);
        const completed = await orchestrator.confirm(proposal.workflowId, true);
        assert.equal(completed.status, 'complete');
        assert.equal(completed.verified, true);
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].title, 'comprar leche');
        assert.equal(submissions.length, 2);
        assert.equal(submissions[0].evidence.verified, true);
        assert.equal(submissions[1].evidence.persistedId, tasks[0].id);
    });

    await test('rechazar un plan multipaso cancela todo sin efectos', async () => {
        const { orchestrator, tasks, jobs, flows } = makeWorkflowHarness();
        const proposal = await orchestrator.dispatch('Crea una tarea para revisar contrato y después recuérdame enviar el contrato mañana a las diez');
        assert.equal(proposal.status, 'awaiting_confirmation');
        const rejected = await orchestrator.confirm(proposal.workflowId, false);
        assert.equal(rejected.status, 'cancelled');
        assert.equal(flows.get(proposal.workflowId).status, 'CANCELLED');
        assert.equal(tasks.length, 0);
        assert.equal(jobs.length, 0);
    });

    await test('explica el resultado incierto sin sugerir repetir una acción a ciegas', async () => {
        const { orchestrator, control, tasks } = makeWorkflowHarness();
        const proposal = await orchestrator.dispatch('Consulta mi agenda de hoy y luego crea una tarea para revisar contrato');
        control.claimWorkflowStep = async () => {
            const error = new Error('step_outcome_unknown');
            error.code = 'step_outcome_unknown';
            throw error;
        };
        const result = await orchestrator.confirm(proposal.workflowId, true);
        assert.equal(result.status, 'error');
        assert.match(result.reply, /revisa la aplicación o servicio antes de intentar repetirlo/i);
        assert.equal(tasks.length, 0);
    });

    await test('una orden individual conserva el flujo de herramienta existente', async () => {
        const { orchestrator } = makeWorkflowHarness();
        const result = await orchestrator.dispatch('Crea una tarea para comprar pan');
        assert.equal(result.handled, false);
    });

    console.log(`═══ GUNTER CORE: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => {
    console.error('  ✗', error.stack || error.message);
    process.exit(1);
});
