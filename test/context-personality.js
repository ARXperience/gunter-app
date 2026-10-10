'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../js/core/assistant-presence');
const source = fs.readFileSync(path.join(__dirname, '../js/services/nlp-llm-service.js'), 'utf8');
function environment() {
    let privateCalls = 0;
    const bodies = [];
    const flags = { personalMemoryContext: true, contextualHumor: true, contextualRecommendations: true, conversationMemory: false };
    const window = {
        PremiumFeaturesService: { isEnabled: key => flags[key] !== false, get: key => ({ personalityMode: 'warm', voiceStyle: 'warm', humorIntensity: 'soft' })[key] },
        GunterAuth: { canAccessLocalData: () => true, getUser: () => ({ id: 'u1', displayName: 'Carlos Ruiz', preferredName: 'Charlie' }) },
        localStorage: { getItem: () => null },
        GunterRuntimeState: { getState: () => ({ mode: 'LOCAL', privacy: 'LOCAL_ONLY' }) },
        GunterPersonalMemory: { contextFor: async () => { privateCalls++; return 'PRIVATE LOCAL FACT'; } },
        GunterMemory: { search: async () => [] }
    };
    window.GunterPresence = create(window);
    const context = { window, navigator: { language: 'es-CO' }, location: { pathname: '/day.html' }, sessionStorage: { getItem: () => null },
        console, DOMException, TextDecoder, fetch: async (_url, options) => {
            const body = JSON.parse(options.body); bodies.push(body);
            if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Respuesta"}}]}\n\ndata: [DONE]\n\n');
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'Respuesta' } }] }) };
        } };
    vm.runInNewContext(source, context);
    return { window, flags, bodies, privateCalls: () => privateCalls };
}
(async () => {
    const env = environment();
    await env.window.GunterNlpLlm.complete('Tengo un error técnico');
    let text = '';
    for await (const delta of env.window.GunterNlpLlm.stream('Tengo un error técnico')) text += delta;
    assert.equal(text, 'Respuesta');
    for (const body of env.bodies) {
        const system = body.messages[0].content;
        assert.equal((system.match(/Eres Gunter:/g) || []).length, 1, 'one personality policy per request');
        assert.match(system, /Charlie/); assert.match(system, /No uses bromas/);
        assert.match(system, /PRIVATE LOCAL FACT/);
        assert.doesNotMatch(system, /Ya quedó, genio|El universo sobrevive|VOICE_JERGA/);
    }
    env.flags.personalMemoryContext = false;
    await env.window.GunterNlpLlm.complete('Otra consulta');
    assert.equal(env.privateCalls(), 2, 'off means no memory lookup');
    assert.doesNotMatch(env.bodies.at(-1).messages[0].content, /PRIVATE LOCAL FACT/);
    env.flags.personalMemoryContext = true;
    env.window.GunterRuntimeState.getState = () => ({ mode: 'CLOUD', privacy: 'STANDARD' });
    await env.window.GunterNlpLlm.complete('Consulta general');
    assert.equal(env.privateCalls(), 2);
    assert.doesNotMatch(env.bodies.at(-1).messages[0].content, /PRIVATE LOCAL FACT/, 'no local personal memory sent to cloud');

    const listeners = new Map();
    const elements = Object.fromEntries(['account-profile-form', 'account-registration-name', 'account-preferred-name', 'account-profile-save', 'account-profile-status', 'account-login-name']
        .map(id => [id, { value: '', addEventListener: (event, fn) => listeners.set(id + ':' + event, fn) }]));
    const profileWindow = { GunterAuth: { isVerified: () => true, getUser: () => ({ displayName: 'Carlos Ruiz', preferredName: 'Charlie', username: 'carlos' }),
        updateProfile: async patch => { assert.deepEqual({ ...patch }, { displayName: 'Carlos Ruiz', preferredName: 'Carlitos' }); } } };
    const configSource = fs.readFileSync(path.join(__dirname, '../js/config-settings.js'), 'utf8');
    vm.runInNewContext(configSource.slice(configSource.indexOf('function initAccount()'), configSource.indexOf('// ---------- Data & Privacy')) + '\ninitAccount();',
        { window: profileWindow, document: { getElementById: id => elements[id], addEventListener() {} } });
    assert.equal(elements['account-preferred-name'].value, 'Charlie');
    elements['account-preferred-name'].value = 'Carlitos';
    await listeners.get('account-profile-form:submit')({ preventDefault() {} });
    assert.match(elements['account-profile-status'].textContent, /Nombres guardados/);
    const { create: createTools } = require('../js/core/assistant-tools');
    let externalWrites = 0;
    const tools = createTools({ root: { GunterControlPlane: { queueCommand: async () => { externalWrites++; } } } });
    assert.equal(tools.detect('abre mi cuenta').toolId, 'app.navigate');
    assert.equal((await tools.dispatch('activa el control completo del PC')).status, 'awaiting_confirmation');
    assert.equal(externalWrites, 0, 'context/personality never authorize effects on their own');
    assert.equal((await tools.dispatch('no')).status, 'cancelled');
    assert.equal(externalWrites, 0);
    console.log('CONTEXT PERSONALITY: unified complete/stream, contextual seriousness, local-only memories, preferred identity, account UI save and Permission Gate ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
