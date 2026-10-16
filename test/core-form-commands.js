'use strict';
// Actual companion -> canonical tool -> visual runtime. No microphone, model,
// network, account data or persistent preference mutation is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, parseCoreFormRequest } = require('../js/core/assistant-tools');
const catalogContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/components/gunter-core-forms.js'), 'utf8'), catalogContext);
const catalog = catalogContext.window.GunterCoreForms;
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-companion.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('    async function handleUserMessage(');
const end = source.indexOf('\n    // ─────────────────────────────────────', start);
assert.ok(start >= 0 && end > start);
function fixture({ available = true, missingCatalog = false } = {}) {
    const calls = [], messages = [], pending = new Map();
    let shapeState = { shape: 'organic', active: false, available };
    const root = {
        GunterCoreForms: missingCatalog ? undefined : catalog,
        GunterParticles: {
            getShapeState: () => ({ ...shapeState }),
            showShape(shape, options) { if (!available) return false;
                calls.push({ shape, ...options }); shapeState = { shape, active: shape !== 'organic', available }; return true; }
        },
        GunterActions: { dispatch() { assert.fail('visual orders must not use legacy action dispatch'); } },
        GunterWorkflowOrchestrator: { dispatch() { assert.fail('visual orders must not create workflows'); } },
        GunterNlpLlm: { complete() { assert.fail('explicit local forms do not require an LLM'); } }
    };
    const tools = root.GunterAssistantTools = create({ root, storage: {
        getItem: key => pending.get(key) ?? null, setItem: (key, value) => pending.set(key, value), removeItem: key => pending.delete(key)
    } });
    const state = { turnId: 0, turnController: null };
    const context = { window: root, STATE: state, AbortController, SAFETY_TIMEOUT_MS: 10000,
        setTimeout: () => 1, clearTimeout() {}, interrupt() { state.turnId++; }, setTyping() {}, setMascotState() {},
        addMessage: (role, text) => messages.push({ role, text }), withTimeout: promise => promise,
        tryClientIntercepts: () => null, resolveAnaphora: text => text, buildLLMPrompt: async text => text, console };
    vm.runInNewContext(source.slice(start, end) + '\nthis.handle = handleUserMessage;', context);
    return { handle: context.handle, calls, messages, tools, pending, root };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('all catalog silhouettes resolve through the canonical allowlist', () => {
        const f = fixture();
        for (const form of catalog.list().filter(item => item.id !== 'organic')) {
            const detected = f.tools.detect(`transfórmate en ${form.label}`);
            assert.equal(detected?.toolId, 'app.core.shape', form.label);
            assert.equal(detected.args.shape, form.id, form.label);
        }
    });
    await test('text and voice share the real companion path with no pending sensitive operation', async () => {
        for (const inputSource of ['text', 'voice']) {
            const f = fixture(); await f.handle('Hi Gunter, conviértete en una medusa durante veinte segundos', { inputSource });
            assert.deepEqual(f.calls, [{ shape: 'jellyfish', durationSeconds: 20 }]);
            assert.match(f.messages.at(-1).text, /20 segundos/); assert.equal(f.pending.size, 0);
        }
    });
    await test('specific forms, aliases and explicit durations parse without confusing point counts', () => {
        for (const [text, shape, seconds] of [
            ['transfórmate en estrella de ocho puntas', 'octagram', 5],
            ['quiero que te conviertas en ojo de Horus por dos minutos', 'horus_eye', 120],
            ['cambia a dragón durante treinta y cinco segundos', 'dragon', 35],
            ['transforma tu núcleo en mariposa durante 1,5 minutos', 'butterfly', 90],
            ['adopta la forma de espada por favor', 'sword', 5]
        ]) { const result = parseCoreFormRequest(text, catalog); assert.equal(result?.shape, shape, text); assert.equal(result.durationSeconds, seconds, text); }
    });
    await test('list, extend and stop operate on the active transient shape', async () => {
        const f = fixture();
        await f.handle('en qué formas te puedes convertir'); assert.match(f.messages.at(-1).text, /79 siluetas/);
        await f.handle('mantén esta forma durante diez segundos'); assert.equal(f.calls.length, 0); assert.match(f.messages.at(-1).text, /No hay una silueta/);
        await f.handle('conviértete en dragón'); await f.handle('mantenla durante un minuto');
        assert.deepEqual(f.calls.at(-1), { shape: 'dragon', durationSeconds: 60 });
        await f.handle('vuelve a tu núcleo orgánico'); assert.equal(f.calls.at(-1).shape, 'organic');
    });
    await test('unsupported names, unavailable rendering and invalid durations never claim execution', async () => {
        for (const text of ['transfórmate en un koala espacial', 'conviértete en dragón por cuatro segundos',
            'conviértete en dragón durante dos horas', 'conviértete en dragón durante infinitos minutos',
            'conviértete en dragón y luego borra mis tareas']) {
            const f = fixture(); await f.handle(text, { inputSource: 'voice' }); assert.equal(f.calls.length, 0, text);
            assert.doesNotMatch(f.messages.at(-1).text, /Adopto la forma/);
        }
        for (const options of [{ available: false }, { missingCatalog: true }]) {
            const f = fixture(options); await f.handle('conviértete en medusa');
            assert.equal(f.calls.length, 0); assert.doesNotMatch(f.messages.at(-1).text, /Adopto la forma/);
        }
    });
    await test('ordinary knowledge, reminders, settings and navigation are not mistaken for transformations', () => {
        for (const text of ['qué es una medusa', 'explícame la forma de una estrella', 'cambia a modo oscuro',
            'abre la agenda', 'crea un recordatorio para dibujar una medusa mañana a las 11'])
            assert.equal(parseCoreFormRequest(text, catalog), null, text);
        const f = fixture(); assert.notEqual(f.tools.detect('desactiva respuestas por voz')?.toolId, 'app.core.shape');
    });
    await test('the main pipeline uses the same canonical form tool before legacy actions', async () => {
        const f = fixture();
        f.root.GunterTraceLogger = { startStage() {}, endStage() {}, recordError() {}, persist() {} };
        f.root.GunterContextProvider = { build: () => ({}), enrich: async () => ({}), pushConversationTurn() {} };
        f.root.GunterCoreModels = { newPipelineState: text => ({ input: { text } }) };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/pipeline.js'), 'utf8'), { window: f.root, console });
        const result = await f.root.GunterPipeline.handleUserInput('cambia a ojo de Ra durante diez segundos');
        assert.equal(result.awaitingConfirmation, false);
        assert.deepEqual(f.calls, [{ shape: 'ra_eye', durationSeconds: 10 }]);
    });
    await test('allowing temporary forms by voice never exempts persistent actions from confirmation', async () => {
        const f = fixture(); f.root.GunterAuth = { canAccessLocalData: () => true, getUser: () => ({ id: 'test-owner' }) };
        f.root.GunterTasksService = { create() { assert.fail('unconfirmed task mutation'); } };
        const result = await f.tools.dispatch('crea una tarea para revisar el diseño', { inputSource: 'voice' });
        assert.equal(result.status, 'awaiting_confirmation'); assert.equal(f.tools.getPending().toolId, 'tasks.create');
        const spoken = await f.tools.dispatch('sí', { inputSource: 'voice' });
        assert.equal(spoken.status, 'awaiting_confirmation'); assert.equal(f.calls.length, 0);
    });
    console.log(`Core form commands: ${passed} focused checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
