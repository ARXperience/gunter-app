'use strict';
// Exercise the actual chat/voice entry with the canonical tool registry.
// No browser, model, network or real navigation is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../js/core/assistant-tools');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-companion.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('    async function handleUserMessage(');
const end = source.indexOf('\n    // ─────────────────────────────────────', start);
assert.ok(start >= 0 && end > start, 'locate the real companion message handler');
const handler = source.slice(start, end);

function fixture({ unavailable = false, failNavigation = false } = {}) {
    const assigned = [], messages = [], dispatched = [], questions = [];
    const pending = new Map();
    const root = {
        location: { pathname: '/day.html', hash: '', search: '', assign(route) {
            if (failNavigation) throw new Error('Navegación no disponible en este entorno');
            assigned.push(route);
        } },
        GunterAuth: { canAccessLocalData: () => true, getUser: () => ({ id: 'alice' }) },
        GunterActions: { dispatch() { assert.fail('legacy actions cannot intercept canonical navigation or explanations'); } },
        GunterWorkflowOrchestrator: { dispatch() { assert.fail('explanations cannot start workflows'); } },
        GunterNlpLlm: { async complete(prompt) { questions.push(prompt); return 'Puedes abrir Configuración desde el menú o pedirme que lo haga.'; } }
    };
    if (!unavailable) {
        root.GunterAssistantTools = create({ root, storage: {
            getItem: key => pending.get(key) || null,
            setItem: (key, value) => pending.set(key, value),
            removeItem: key => pending.delete(key)
        } });
        const dispatch = root.GunterAssistantTools.dispatch;
        root.GunterAssistantTools.dispatch = (text, options) => {
            dispatched.push({ text, inputSource: options.inputSource });
            return dispatch(text, options);
        };
    }
    const state = { turnId: 0, turnController: null };
    const context = {
        window: root, STATE: state, AbortController, SAFETY_TIMEOUT_MS: 10000,
        setTimeout: () => 1, clearTimeout() {},
        interrupt() { state.turnId++; },
        setTyping() {}, setMascotState() {},
        addMessage: (role, text) => messages.push({ role, text }),
        withTimeout: promise => promise,
        tryClientIntercepts: () => unavailable ? { reply: 'No se ejecutó una navegación no verificada.' } : null,
        resolveAnaphora: text => text, buildLLMPrompt: async text => text,
        console
    };
    vm.runInNewContext(handler + '\nthis.handle = handleUserMessage;', context);
    return { handle: context.handle, assigned, messages, dispatched, questions };
}

const destinations = [
    ['Inicio', 'day.html'], ['Conversaciones', 'day.html#conversations'],
    ['Reuniones', 'dashboard.html'], ['nueva reunión', 'new-project.html'],
    ['Resultados', 'results.html'], ['captura rápida', 'day.html#capture'],
    ['Tareas', 'day.html#tasks'], ['Agenda', 'day.html#events'],
    ['Recordatorios', 'day.html#reminders'], ['Compromisos', 'day.html#commitments'],
    ['Actividad', 'day.html#activity'], ['Configuración', 'config.html#preferences'],
    ['Mi cuenta', 'config.html#account'], ['Conexiones', 'config.html#connections'],
    ['Datos y privacidad', 'config.html#data'], ['asistente e IA', 'config.html#premium'],
    ['Papelera', 'config.html#trash'], ['opciones avanzadas', 'config.html#diagnostics'],
    ['configuración de agenda', 'config.html#schedule'], ['configuración de voz', 'config.html#voice'],
    ['conversaciones y memoria', 'config.html#conversations'], ['acciones y permisos', 'config.html#actions'],
    ['Administración', 'admin.html']
];
const naturalRequests = [
    ['llévame al apartado de voz', 'config.html#voice'],
    ['quiero ir a mi perfil', 'config.html#account'],
    ['ve al apartado de memoria', 'config.html#conversations'],
    ['puedes abrir configuraciones', 'config.html#preferences'],
    ['vuelve al inicio', 'day.html'],
    ['entra al apartado de datos y privacidad', 'config.html#data']
];

(async () => {
    for (const inputSource of ['text', 'voice']) {
        for (const [name, route] of destinations) {
            const h = fixture();
            await h.handle(`Abre ${name}`, { inputSource });
            assert.deepEqual(h.assigned, [route], `${inputSource}: ${name}`);
            assert.equal(h.dispatched.length, 1, 'one canonical dispatch, no direct shortcut');
            assert.equal(h.dispatched[0].inputSource, inputSource);
            assert.match(h.messages.at(-1).text, /Abriendo/);
        }
    }
    console.log(`PASS ${destinations.length} destinations use the same verified route through text and voice`);

    for (const inputSource of ['text', 'voice']) {
        for (const [text, route] of naturalRequests) {
            const h = fixture();
            await h.handle(text, { inputSource });
            assert.deepEqual(h.assigned, [route], `${inputSource}: ${text}`);
            assert.equal(h.dispatched.length, 1, 'natural phrasing still uses one canonical dispatch');
            assert.equal(h.dispatched[0].inputSource, inputSource);
        }
        const explanation = fixture();
        await explanation.handle('cómo se abre configuración', { inputSource });
        assert.deepEqual(explanation.assigned, [], 'explaining navigation is not authorization to navigate');
        assert.equal(explanation.questions.length, 1, 'the explanation reaches conversation, not actions or a workflow');
        assert.match(explanation.messages.at(-1).text, /Puedes abrir Configuración/);
    }
    console.log('PASS natural navigation variants work in text/voice; explaining how to open a section never opens it');

    const failed = fixture({ failNavigation: true });
    await failed.handle('abre configuración de voz');
    assert.equal(failed.dispatched.length, 1);
    assert.equal(failed.assigned.length, 0);
    assert.doesNotMatch(failed.messages.at(-1).text, /Abriendo/);
    assert.match(failed.messages.at(-1).text, /Navegación no disponible/);
    console.log('PASS a failed navigation cannot claim success');

    const unavailable = fixture({ unavailable: true });
    await unavailable.handle('abre configuración de voz');
    assert.equal(unavailable.assigned.length, 0);
    assert.doesNotMatch(source, /function resolveGunterNavigation\(/);
    console.log('PASS no duplicated fallback catalog or unchecked navigation when canonical tools are unavailable');
})().catch(error => { console.error(error); process.exitCode = 1; });
