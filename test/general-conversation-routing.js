'use strict';

// Routing only: no model, network, device access or real persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../js/core/assistant-tools');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const QUESTIONS = [
    'Quiero aprender sobre agujeros negros',
    '¿Puedes explicarme la fotosíntesis?',
    'Necesito entender por qué sube la inflación',
    'Explícame qué cambia cuando se activa la memoria RAM',
    '¿Cómo se abre una aplicación en Windows?',
    '¿Qué ocurre cuando se activa una cámara?',
    '¿Cómo cambia el clima en Colombia?',
    '¿Cómo se organiza una reunión?',
    'Explícame cómo se completa una tarea',
    'Quiero una receta de arroz con pollo',
    'Ayúdame a escribir un cuento de ciencia ficción',
    'Resuelve la ecuación 2x + 3 = 7',
    '¿Cuál es el autor de Cien años de soledad?'
];

function pipelineFixture() {
    const data = new Map(), answers = [], errors = [], history = [];
    const root = {
        location: { pathname: '/day.html', hash: '', search: '' },
        addEventListener() {}, dispatchEvent() {},
        localStorage: { getItem: key => data.get(key) || null,
            setItem: (key, value) => data.set(key, String(value)) },
        GunterTraceLogger: { startStage() {}, endStage() {}, persist() {},
            recordError(_state, _stage, error) { errors.push(error); } },
        GunterContextProvider: {
            build: () => ({ userId: 'alice', preferences: {}, timezone: 'America/Bogota', now: '2026-10-15T14:00:00.000Z' }),
            pushConversationTurn: (role, text) => history.push({ role, text })
        },
        GunterActions: { dispatch() { assert.fail('an explanation must not use the legacy settings dispatcher'); } },
        GunterWorkflowOrchestrator: { dispatch() { assert.fail('an explanation must not start a workflow'); } },
        GunterIntentEngine: { classifyIntent() { assert.fail('informative requests must bypass action-keyword classification'); } },
        GunterEntityExtractor: { extractEntities: async (_text, intent) => {
            assert.equal(intent.primary.type, 'query');
            return { missing: [], datetimeExpr: [], people: [] };
        } },
        GunterTimeParser: { parseMany: async expressions => {
            assert.equal(expressions.length, 0);
            return [];
        } },
        GunterNlpLlm: { answerQuery: async (question, context) => {
            assert.equal(context.userId, 'alice');
            answers.push(question);
            return `Respuesta general de prueba: ${question}`;
        } }
    };
    const sandbox = { window: root, location: root.location, navigator: { language: 'es-CO' }, console, Date, Intl, performance,
        localStorage: root.localStorage };
    vm.createContext(sandbox);
    vm.runInContext(read('js/premium-features-service.js'), sandbox, { filename: 'js/premium-features-service.js' });
    root.GunterAssistantTools = create({ root });
    for (const file of ['js/core/models.js', 'js/core/decision-engine.js', 'js/core/action-engine.js', 'js/core/pipeline.js']) {
        vm.runInContext(read(file), sandbox, { filename: file });
    }
    return { root, answers, errors, history, data, sandbox };
}

function companionFixture() {
    const h = pipelineFixture(), messages = [], requests = [], timers = new Set();
    const { root, sandbox } = h;
    root.GunterLogBuffer = {};
    root.GunterTutor = { isEnabled: () => false,
        catalog() { assert.fail('disabled Sabio must never read its catalog'); } };
    root.GunterNlpLlm = { complete: async (prompt, options) => {
        requests.push({ prompt, options });
        return `Respuesta general de prueba: ${prompt}`;
    } };
    Object.assign(sandbox, { STATE: { turnId: 0 }, AbortController,
        SAFETY_TIMEOUT_MS: 45000,
        interrupt: () => { sandbox.STATE.turnId++; },
        addMessage: (role, text) => messages.push({ role, text }),
        setTyping() {}, setMascotState() {}, renderQuick() {}, updateLastTopic() {},
        resolveAnaphora: text => text,
        buildLLMPrompt: async text => text,
        withTimeout: promise => Promise.resolve(promise),
        _classifyWithLLM() { assert.fail('general knowledge must not be rewritten into a setting command'); },
        setTimeout: () => { const id = {}; timers.add(id); return id; },
        clearTimeout: id => timers.delete(id)
    });
    const source = read('js/services/gunter-companion.js').replace(/\r\n/g, '\n');
    for (const name of ['tryClientIntercepts', 'handleUserMessage']) {
        const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
        assert.notEqual(start, -1, `real companion function ${name} exists`);
        const end = source.indexOf('\n    }', start);
        assert.ok(end > start, `real companion function ${name} closes`);
        vm.runInContext(source.slice(start, end + '\n    }'.length), sandbox,
            { filename: `gunter-companion.js:${name}` });
    }
    return { ...h, messages, requests, timers,
        intercept: text => sandbox.tryClientIntercepts(text),
        handle: (text, options) => sandbox.handleUserMessage(text, options) };
}

(async () => {
    const initial = pipelineFixture(), tools = initial.root.GunterAssistantTools;
    const preferencesBefore = [...initial.data];
    for (const text of QUESTIONS) {
        assert.equal(tools.isInformationalRequest(text), true, text);
        assert.equal(tools.detect(text), null, `general knowledge is not an executable tool: ${text}`);
        assert.equal(tools.clarifyRequest(text), null, `general knowledge must reach reasoning: ${text}`);
        assert.equal((await tools.dispatch(text)).handled, false, text);
        assert.equal(tools.getPending(), null, 'knowledge questions cannot create a pending mutation');
    }
    assert.deepEqual([...initial.data], preferencesBefore, 'real preferences are read without changing the user configuration');
    console.log(`PASS ${QUESTIONS.length} knowledge/creative requests are not tool commands or generic clarification`);

    for (const [text, expected] of [
        ['¿Puedes abrir Configuración?', 'app.navigate'],
        ['Llévame a mis tareas', 'app.navigate'],
        ['Abre la calculadora', 'desktop.apps.open'],
        ['Activa la escucha continua', 'settings.update'],
        ['Activa una alarma para hacer ejercicio a las 11 de la mañana', 'reminder.schedule'],
        ['¿Para qué sirve voz continua?', 'settings.list'],
        ['¿Qué velocidad de voz tienes?', 'settings.list'],
        ['¿Está activada la escucha continua?', 'settings.list']
    ]) {
        assert.equal(tools.detect(text)?.toolId, expected, `real operations and app explanations retain their tools: ${text}`);
    }
    assert.ok(tools.clarifyRequest('Publica esta foto en Instagram'), 'unsupported external actions must still clarify');
    console.log('PASS navigation, actual actions, app-setting explanations and unavailable-action clarification remain intact');

    const h = pipelineFixture();
    for (const text of QUESTIONS) {
        const result = await h.root.GunterPipeline.handleUserInput(text);
        assert.equal(h.errors.length, 0, h.errors.at(-1)?.message || text);
        assert.equal(result.state.intent.primary.type, 'query', text);
        assert.equal(result.awaitingConfirmation, false, text);
        assert.equal(result.state.execution.failed.length, 0, text);
        assert.equal(result.state.execution.sideEffects.length, 0, 'general conversation has no external side effects');
        assert.equal(result.response.speech, `Respuesta general de prueba: ${text}`, text);
    }
    assert.deepEqual(h.answers, QUESTIONS, 'the existing query-answer path receives the original question exactly once');
    assert.equal(h.history.filter(turn => turn.role === 'assistant').length, QUESTIONS.length);
    console.log('PASS main pipeline reaches its existing query LLM path without legacy dispatch, workflows or mutations');

    const companion = companionFixture();
    const ordinaryStudy = [
        '¿Cuál es el autor de Cien años de soledad?',
        '¿Qué es una biblioteca pública?',
        'Ayúdame a preparar mi curriculum para buscar trabajo',
        'Qué libros recomiendas sobre astronomía',
        'Explícame qué es un catálogo de productos'
    ];
    for (const text of ordinaryStudy) assert.equal(companion.intercept(text), null,
        `ordinary knowledge must not require Sabio: ${text}`);
    for (const text of ['qué libros tienes', 'tu biblioteca']) {
        assert.equal(companion.intercept(text)?.intent, 'tutor-disabled',
            `explicit Sabio library requests must respect disabled access: ${text}`);
    }
    console.log('PASS real companion intercept keeps ordinary authors/library/curriculum questions outside disabled Sabio');

    const companionPreferences = [...companion.data];
    for (const inputSource of ['text', 'voice']) {
        for (const text of QUESTIONS) {
            const previous = companion.messages.length;
            await companion.handle(text, { inputSource });
            assert.deepEqual(companion.messages.slice(previous), [
                { role: 'user', text }, { role: 'assistant', text: `Respuesta general de prueba: ${text}` }
            ], `real companion handler reaches its existing LLM fallback (${inputSource}): ${text}`);
            assert.equal(companion.timers.size, 0, 'each completed response clears its safety timer');
        }
    }
    assert.equal(companion.requests.length, QUESTIONS.length * 2);
    assert.deepEqual([...companion.data], companionPreferences, 'conversation cannot alter real preferences');
    console.log('PASS real floating-chat handler routes text/voice knowledge requests to the LLM without action rewriting');

    const capabilities = pipelineFixture(), registered = capabilities.root.GunterAssistantTools;
    const privateSentinel = 'PRIVATE_RECORD_MUST_NOT_BE_READ_OR_RETURNED';
    let executions = 0;
    capabilities.root.GunterAuth = { getUser: () => ({ id: 'alice', email: privateSentinel, token: privateSentinel }) };
    for (const service of ['GunterTasksService', 'GunterEventsService', 'GunterJobsService', 'GunterPersonalMemory']) {
        capabilities.root[service] = new Proxy({}, { get() { assert.fail('capability inventory must not inspect personal records'); } });
    }
    registered.register({ id: 'test.catalog_only', description: 'Herramienta temporal de catálogo para esta prueba.',
        confirm: 'always', execute() { executions++; return { secret: privateSentinel }; } });
    const beforeCatalog = [...capabilities.data];
    const inventory = await registered.dispatch('¿Qué puedes hacer?');
    assert.equal(inventory.intent, 'app.inspect');
    assert.equal(inventory.status, 'complete');
    assert.equal(executions, 0, 'capability explanations never execute listed tools');
    for (const tool of registered.listTools()) assert.ok(inventory.reply.includes(tool.description),
        `inventory descriptions come from the actual registry: ${tool.id}`);
    assert.match(inventory.reply, /no garantiza|disponibilidad/i);
    assert.doesNotMatch(inventory.reply, new RegExp(privateSentinel));
    assert.deepEqual([...capabilities.data], beforeCatalog, 'catalog queries do not write preferences or personal data');
    console.log('PASS capabilities use the real tool registry without executing actions or exposing private records');
})().catch(error => { console.error(error); process.exitCode = 1; });
