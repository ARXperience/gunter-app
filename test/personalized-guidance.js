'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../js/core/assistant-tools');
const { create: createPresence } = require('../js/core/assistant-presence');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function fixture() {
    const data = new Map(), requests = [];
    let memoryCalls = 0;
    const root = {
        location: { pathname: '/day.html', hash: '#chat', search: '' }, addEventListener() {}, dispatchEvent() {},
        localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)) },
        GunterAuth: { canAccessLocalData: () => true, getUser: () => ({ id: 'alice', preferredName: 'Ana' }) },
        GunterRuntimeState: { getState: () => ({ mode: 'LOCAL', privacy: 'LOCAL_ONLY' }) },
        GunterPersonalMemory: { contextFor: async () => { memoryCalls++; return 'ACTIVIDAD AUTORIZADA: diseña experiencias educativas'; } }
    };
    const sandbox = { window: root, localStorage: root.localStorage, location: root.location,
        navigator: { language: 'es-CO' }, console, CustomEvent: class {}, DOMException, TextDecoder,
        sessionStorage: { getItem: () => null }, fetch: async (_url, options) => {
            const body = JSON.parse(options.body); requests.push(body);
            if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Respuesta"}}]}\n\ndata: [DONE]\n\n');
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'Respuesta' } }] }) };
        } };
    vm.createContext(sandbox);
    vm.runInContext(read('js/premium-features-service.js'), sandbox);
    root.GunterAssistantTools = create({ root }); root.GunterPresence = createPresence(root);
    vm.runInContext(read('js/services/nlp-llm-service.js'), sandbox);
    return { root, data, requests, memoryCalls: () => memoryCalls };
}
(async () => {
    const h = fixture(), tools = h.root.GunterAssistantTools;
    const before = [...h.data];
    for (const query of [
        '¿Qué configuración recomiendas para mi trabajo?',
        'Soy médico, ¿qué funciones debo activar para organizar mis consultas?',
        'Me dedico a la cerámica, ¿cómo me puedes ayudar?',
        '¿Cómo puedo aprovechar Gunter?',
        'Soy profesor y músico, recomiéndame herramientas de Gunter para preparar clases'
    ]) {
        assert.equal(tools.isUsageGuidanceRequest(query), true, query);
        assert.equal(tools.detect(query), null, 'a recommendation is not a write');
        assert.equal(tools.clarifyRequest(query), null, 'guidance must reach reasoning, not a generic tool list');
        assert.equal((await tools.dispatch(query)).handled, false);
        assert.match(tools.getRecommendationContext(query), /config.html#actions/);
    }
    assert.deepEqual([...h.data], before); assert.equal(tools.getPending(), null);
    assert.equal(tools.detect('activa el planificador diario').toolId, 'settings.update');
    assert.equal((await tools.dispatch('activa el planificador diario')).status, 'awaiting_confirmation');
    assert.equal(h.root.PremiumFeaturesService.get('dailyPlanner'), false);
    tools.clearPending();
    console.log('PASS advice is read-only, supports different/multiple activities, and real activation still requests confirmation');

    const query = 'Soy docente, ¿qué funciones me recomiendas de Gunter?';
    await h.root.GunterNlpLlm.complete(query);
    let answer = ''; for await (const delta of h.root.GunterNlpLlm.stream(query)) answer += delta;
    assert.equal(answer, 'Respuesta');
    for (const body of h.requests) {
        const system = body.messages[0].content;
        assert.match(system, /USO PERSONALIZADO DE GUNTER/);
        assert.match(system, /ACTIVIDAD AUTORIZADA/);
        assert.match(system, /No asignes una profesión/);
        assert.match(system, /sin activar ajustes ni guardar inferencias/);
        assert.match(system, /activado no significa disponible/);
        assert.equal(body.gunter_context?.profession, undefined);
    }
    assert.equal(h.memoryCalls(), 2);
    h.root.PremiumFeaturesService.set('personalMemoryContext', false);
    await h.root.GunterNlpLlm.complete(query);
    assert.equal(h.memoryCalls(), 2);
    assert.doesNotMatch(h.requests.at(-1).messages[0].content, /ACTIVIDAD AUTORIZADA/);
    h.root.GunterRuntimeState.getState = () => ({ mode: 'CLOUD', privacy: 'STANDARD' });
    await h.root.GunterNlpLlm.complete(query);
    assert.equal(h.memoryCalls(), 2);
    assert.doesNotMatch(h.requests.at(-1).messages[0].content, /ACTIVIDAD AUTORIZADA/);
    assert.match(h.requests.at(-1).messages[0].content, /USO PERSONALIZADO/);
    h.root.PremiumFeaturesService.set('dailyPlanner', true);
    const requestCount = h.requests.length;
    await h.root.GunterNlpLlm.complete(query);
    assert.equal(h.requests.length, requestCount + 1, 'current preferences invalidate cached guidance');
    assert.match(h.requests.at(-1).messages[0].content, /"key":"dailyPlanner"[^}]*"enabled":true/);
    await h.root.GunterNlpLlm.complete('¿Qué es la fotosíntesis?');
    assert.doesNotMatch(h.requests.at(-1).messages[0].content, /USO PERSONALIZADO/);
    console.log('PASS complete/stream share actual catalog, no inferred profile storage, local-only memory and current settings');
    assert.match(read('js/services/gunter-companion.js'), /!guidanceRequest && !voiceInput && window\.GunterActions/);
    assert.match(read('js/core/pipeline.js'), /!window\.GunterAssistantTools\?\.isUsageGuidanceRequest\?\.\(text\)/);
    console.log('PASS chat/voice pipelines do not rewrite advisory questions into executable actions');
})().catch(error => { console.error(error); process.exitCode = 1; });
