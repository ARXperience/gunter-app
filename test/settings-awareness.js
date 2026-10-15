'use strict';
// Canonical settings only: no models, network, microphone or personal files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const toolsModule = require('../js/core/assistant-tools');
const controlSettings = require('../server/control-plane/settings');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
    let owner = 'alice';
    const values = new Map(), pending = new Map(), events = [], writes = [], assigned = [];
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => { values.set(key, value); writes.push(key); } };
    const root = { localStorage: storage, addEventListener() {}, dispatchEvent: event => events.push(event),
        location: { pathname: '/config.html', hash: '#voice', search: '', assign: route => assigned.push(route) },
        GunterAuth: { canAccessLocalData: () => true, getUser: () => ({ id: owner }) } };
    vm.runInNewContext(read('js/premium-features-service.js'), { window: root, localStorage: storage, location: root.location,
        navigator: {}, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
    const tools = toolsModule.create({ root, storage: { getItem: key => pending.get(key) || null,
        setItem: (key, value) => pending.set(key, value), removeItem: key => pending.delete(key) } });
    return { tools, root, values, writes, events, assigned, setOwner: id => { owner = id; } };
}
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('all actual defaults use shared metadata outside Configuración, without parallel storage', async () => {
    const h = fixture();
    assert.equal(h.root.GunterAdvancedSettings, undefined);
    const catalog = h.tools.getSettingsCatalog();
    const actual = catalog.filter(item => item.source === 'preference');
    assert.equal(actual.length, Object.keys(h.root.PremiumFeaturesService.DEFAULTS).length);
    assert.equal(new Set(catalog.map(item => item.key)).size, catalog.length);
    assert.match(actual.find(item => item.key === 'dailyPlanner').label, /Planificador/);
    assert.match(actual.find(item => item.key === 'voiceEnabled').location, /Voz y escucha/);
    assert.equal(h.writes.length, 0);
    const response = await h.tools.dispatch('¿Para qué sirve la continuidad de conversaciones?');
    assert.equal(response.status, 'complete');
    assert.match(response.reply, /hilo de la conversación|referencias/);
    assert.match(response.reply, /Conversaciones y memoria/);
});

test('activation and enums use canonical set after confirmation; voice settings reconcile together', async () => {
    const h = fixture();
    const svc = h.root.PremiumFeaturesService;
    svc.set('voiceMode', 'wake_word_only');
    svc.set('wakeWordResponseMode', 'text');
    assert.equal((await h.tools.dispatch('cambia el modo de respuesta por voz a todas las respuestas con voz')).status, 'awaiting_confirmation');
    assert.equal(svc.get('voiceMode'), 'wake_word_only');
    assert.equal((await h.tools.dispatch('sí')).status, 'complete');
    assert.equal(svc.get('voiceMode'), 'live_voice');
    assert.equal(svc.get('voiceOnlyAfterWakeWord'), false);
    assert.equal(svc.get('wakeWordResponseMode'), 'voice');
    assert.equal((await h.tools.dispatch('desactiva humor contextual')).status, 'awaiting_confirmation');
    assert.equal(svc.get('contextualHumor'), true);
    assert.equal((await h.tools.dispatch('confirmo')).status, 'complete');
    assert.equal(svc.get('contextualHumor'), false);
});

test('short tool descriptions produce useful candidates rather than guessing or requiring full labels', async () => {
    const h = fixture();
    const response = await h.tools.dispatch('activa el planificador');
    assert.equal(response.status, 'needs_input');
    assert.match(response.reply, /diario/i);
    assert.match(response.reply, /semanal/i);
    assert.equal(h.writes.length, 0);
    assert.equal(h.tools.getPending(), null);
    const chosen = await h.tools.dispatch('activa el planificador semanal');
    assert.equal(chosen.status, 'awaiting_confirmation');
    assert.equal(h.tools.getPending().args.setting.key, 'weeklyPlanner');
    await h.tools.dispatch('no');
    assert.equal((await h.tools.dispatch('abre planificador semanal')).status, 'complete');
    assert.equal(h.assigned.at(-1), 'config.html#actions');
    assert.equal((await h.tools.dispatch('activa el planificador semanal y desactiva humor contextual')).status, 'needs_input');
    assert.equal(h.tools.getPending(), null);
    assert.equal(h.writes.length, 0);
});

test('advanced options reject invalid values before proposing or changing anything', async () => {
    const h = fixture();
    for (const text of ['cambia velocidad de voz a supersónica', 'cambia segundos de silencio a 500 segundos',
        'cambia segundos de silencio a 2 segundos', 'cambia segundos de silencio a 10,5 segundos']) {
        assert.equal((await h.tools.dispatch(text)).status, 'needs_input', text);
        assert.equal(h.tools.getPending(), null);
    }
    assert.equal(h.writes.length, 0);
    assert.equal((await h.tools.dispatch('cambia segundos de silencio a 30 segundos')).status, 'awaiting_confirmation');
    assert.equal((await h.tools.dispatch('sí')).status, 'complete');
    assert.equal(h.root.PremiumFeaturesService.get('wakeWordAutoStopSeconds'), 30);
});

test('voice follows the same settings path and never treats a spoken yes as consent', async () => {
    const h = fixture();
    const proposal = await h.tools.dispatch('desactiva respuestas por voz', { inputSource: 'voice' });
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.match(proposal.reply, /por escrito o en pantalla/);
    assert.equal((await h.tools.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.tools.dispatch('confirmo')).status, 'complete');
    assert.equal(h.root.PremiumFeaturesService.get('voiceEnabled'), false);
});

test('account changes and changed preferences invalidate proposals instead of overwriting choices', async () => {
    const h = fixture();
    await h.tools.dispatch('desactiva humor contextual');
    h.setOwner('bob');
    assert.notEqual((await h.tools.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
    await h.tools.dispatch('desactiva humor contextual');
    h.root.PremiumFeaturesService.set('contextualHumor', false);
    const count = h.writes.length;
    assert.equal((await h.tools.dispatch('sí')).status, 'error');
    assert.equal(h.writes.length, count);
});

test('current location reflects route/hash; allowed navigation opens exact settings sections', async () => {
    const h = fixture();
    assert.match((await h.tools.dispatch('¿En qué apartado estoy?')).reply, /Configuración → Voz y escucha/);
    h.root.location.hash = '#data';
    assert.match((await h.tools.dispatch('¿Dónde estoy?')).reply, /Datos y privacidad/);
    for (const [text, expected] of [['llévame a configuración de voz', 'config.html#voice'],
        ['abre diagnóstico', 'config.html#diagnostics'], ['ve a conversaciones y memoria', 'config.html#conversations'],
        ['llévame a datos y privacidad', 'config.html#data'], ['abre acciones y permisos', 'config.html#actions']]) {
        assert.equal((await h.tools.dispatch(text)).status, 'complete', text);
        assert.equal(h.assigned.at(-1), expected, text);
    }
});

test('credential, permission, backup and appearance controls explain limits rather than fake arbitrary writes', async () => {
    const h = fixture();
    const question = await h.tools.dispatch('¿Para qué sirve el color del núcleo?');
    assert.equal(question.status, 'complete');
    assert.match(question.reply, /tres colores HEX/);
    assert.doesNotMatch(question.reply, /desactivado/);
    for (const text of ['cambia contraseña a secreto', 'activa permiso de micrófono', 'cambia color del núcleo a rojo']) {
        const response = await h.tools.dispatch(text);
        assert.equal(response.status, 'needs_input', text);
        assert.match(response.reply, /pantalla|permiso|chat/);
    }
    assert.equal(h.writes.length, 0);
    assert.equal(h.tools.getPending(), null);
});

test('server advanced schemas reject bad types, out-of-range values, unknown fields and unsafe JSON', () => {
    const definition = key => controlSettings.REGISTRY.find(row => row.key === key);
    for (const [key, patch, field] of [
        ['memory.semantic', { confidenceThreshold: 2 }, 'confidenceThreshold'],
        ['memory.cortex', { retentionDays: -1 }, 'retentionDays'],
        ['memory.cortex', { syncEnabled: 'false' }, 'syncEnabled'],
        ['desktop.control', { autonomyLevel: 'ADMIN' }, 'autonomyLevel'],
        ['desktop.control', { allowedFolders: ['a'.repeat(161)] }, 'allowedFolders'],
        ['ai.local', { cpuLimit: 101 }, 'cpuLimit'],
        ['ai.cloud', { token: 'secret' }, 'token'],
        ['automation.procedures', { triggers: JSON.parse('{"__proto__":{"evil":true}}') }, 'triggers']
    ]) assert.equal(controlSettings.validateAdvanced(definition(key), patch), field);
    assert.equal(controlSettings.validateAdvanced(definition('memory.semantic'), { confidenceThreshold: 0.8, retentionDays: 30, localOnly: true }), null);
    assert.equal(controlSettings.validateAdvanced(definition('memory.cortex'), { retentionDays: 'legacy', syncEnabled: false }, { retentionDays: 'legacy' }), null);
});

test('advanced-only server updates preserve defaults, reject stale revision and keep failure atomic', () => {
    const files = new Map();
    const fakeFs = { existsSync: name => files.has(name), readFileSync: name => files.get(name),
        writeFileSync: (name, value) => files.set(name, value), renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); } };
    const mod = { exports: {} };
    vm.runInNewContext(read('server/control-plane/settings.js'), { module: mod, exports: mod.exports, process, console,
        require: name => name === 'path' ? path : name === 'fs' ? fakeFs : name === '../user-store' ? { userDir: id => `test-${id}` }
            : name === './feature-flags' ? { evaluate: () => ({ enabled: true }) } : name === './entitlements'
                ? { check: () => ({ allowed: true }), snapshot: () => ({ features: { 'gunter.voice': { allowed: true } } }) } : {} });
    const api = mod.exports;
    let response = api.patch('alice', { key: 'voice.continuous', advanced: { vad: true }, baseUpdatedAt: null }, { userId: 'alice' });
    assert.equal(response.ok, true);
    assert.equal(response.setting.requestedEnabled, true);
    const before = clone(api._load('alice'));
    response = api.patch('alice', { key: 'voice.continuous', advanced: { vad: 'broken' }, baseUpdatedAt: before.values['voice.continuous'].updatedAt });
    assert.equal(response.error, 'setting_advanced_invalid');
    assert.deepEqual(clone(api._load('alice')), before);
    assert.equal(api.patch('alice', { key: 'voice.continuous', enabled: false, baseUpdatedAt: null }).error, 'setting_changed');
    assert.equal(api._load('bob').values['voice.continuous'], undefined);
});

test('pipeline and chat prioritize canonical settings over the legacy writer and preserve screen confirmation', async () => {
    const h = fixture(), history = [], persist = [];
    h.root.GunterAssistantTools = h.tools;
    h.root.GunterActions = { dispatch() { assert.fail('legacy writer must not intercept canonical settings'); } };
    h.root.GunterTraceLogger = { startStage() {}, endStage() {}, recordError() {}, persist: state => persist.push(state) };
    h.root.GunterContextProvider = { build: () => ({}), enrich: async () => ({}), pushConversationTurn: (role, text) => history.push({ role, text }) };
    h.root.GunterCoreModels = { newPipelineState: (text, context) => ({ input: { text, userContext: context } }) };
    vm.runInNewContext(read('js/core/pipeline.js'), { window: h.root, console, navigator: { language: 'es-CO' } });
    const pipeline = h.root.GunterPipeline;
    assert.ok(pipeline);
    const proposal = await pipeline.handleUserInput('desactiva humor contextual');
    assert.equal(proposal.awaitingConfirmation, true);
    assert.ok(proposal.state.assistantPending);
    assert.equal((await pipeline.handleUserInput('sí')).awaitingConfirmation, false);
    assert.equal(h.root.PremiumFeaturesService.get('contextualHumor'), false);
    const companion = read('js/services/gunter-companion.js');
    assert.match(companion, /if \(!earlyIntent && !voiceInput/);
    assert.match(companion, /'app\.navigate', 'app\.inspect', 'preferences\.update'/);
});

(async () => {
    let passed = 0;
    for (const { name, fn } of cases) {
        try { await fn(); console.log(`PASS ${name}`); passed++; }
        catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
    }
    console.log(`SETTINGS AWARENESS: ${passed}/${cases.length}`);
})();
