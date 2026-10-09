/* Focused contract: explicit memory reaches local replies, never cloud prompts. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const rows = new Map();
let owner = 'alice';
let mode = 'LOCAL';
const requests = [];
let enriched = 0, persisted = 0, historyWrites = 0;
const context = { console, Date, Set, Map, Promise, Intl, navigator: { language: 'es-CO' },
    crypto: require('node:crypto').webcrypto,
    sessionStorage: { getItem: () => null }, location: { pathname: '/day.html' },
    localStorage: { getItem: () => null },
    GunterAuth: { isVerified: () => true, getUser: () => ({ id: owner }) },
    GunterRuntimeState: { getState: () => ({ mode, privacy: 'STANDARD' }) },
    PremiumFeaturesService: { get: () => null, isEnabled: () => false },
    GunterPresence: { personalityPrompt: () => 'Eres Gunter.' },
    GunterDataRepository: { memory: {
        get: async key => rows.get(key),
        all: async store => store === 'turns' ? [] : [...rows.values()],
        put: async row => { rows.set(row.key, row); return row; },
        delete: async key => rows.delete(key)
    } },
    fetch: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Respuesta comprobada.' } }] }) };
    }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/services/gunter-memory.js', 'js/services/personal-memory-service.js', 'js/services/nlp-llm-service.js'])
    vm.runInContext(read(file), context, { filename: file });

(async () => {
    const personal = context.GunterPersonalMemory;
    const pet = await personal.save({ content: 'Mi mascota es un gato llamado Milo' });
    await personal.save({ type: 'preference', content: 'Prefiero respuestas cortas' });
    await context.GunterMemory.put({ type: 'project', source: 'test', content: 'Mascota del proyecto Aurora' });
    await context.GunterMemory.put({ type: 'conversation', source: 'test', content: 'Mascota comentada en otra sesión' });
    rows.set('bob:private', { key: 'bob:private', ownerId: 'bob', id: 'private', type: 'personal_fact',
        content: 'El secreto de Bob es privado', source: 'personal.ui', metadata: {}, privacy: 'LOCAL',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 });
    const contextText = await personal.contextFor('¿Cuál es mi mascota?');
    assert.match(contextText, /Milo/);
    assert.match(contextText, /respuestas cortas/);
    assert.doesNotMatch(contextText, /Bob/);

    await context.GunterNlpLlm.answerQuery('¿Cuál es mi mascota?', { now: new Date().toISOString(), timezone: 'America/Bogota' });
    assert.match(requests.at(-1).messages[0].content, /Milo/);
    assert.match(requests.at(-1).messages[0].content, /respuestas cortas/);
    assert.match(requests.at(-1).messages[0].content, /proyecto Aurora/);
    assert.doesNotMatch(requests.at(-1).messages[0].content, /otra sesión/);
    assert.doesNotMatch(requests.at(-1).messages[0].content, /Bob/);
    mode = 'CLOUD';
    await context.GunterNlpLlm.answerQuery('¿Cuál es mi mascota?', { now: new Date().toISOString(), timezone: 'America/Bogota' });
    assert.doesNotMatch(requests.at(-1).messages[0].content, /Milo|respuestas cortas|proyecto Aurora|Bob/);
    mode = 'LOCAL';
    await context.GunterNlpLlm.complete('¿Cuál es mi mascota?', { skipMemory: true });
    assert.doesNotMatch(requests.at(-1).messages[0].content, /Milo/);
    await context.GunterNlpLlm.complete('¿Cuál es mi mascota?', { jsonMode: true });
    assert.doesNotMatch(requests.at(-1).messages[0].content, /Milo/);

    await personal.remove(pet.record.id);
    assert.doesNotMatch(await personal.contextFor('¿Cuál es mi mascota?'), /Milo/);
    owner = 'bob';
    assert.doesNotMatch(await personal.contextFor('¿Cuál es mi mascota?'), /Milo|respuestas cortas/);
    owner = 'alice';

    context.GunterContextProvider = { build: () => ({}), enrich: async () => { enriched++; throw new Error('NETWORK_CALLED'); },
        pushConversationTurn: () => { historyWrites++; } };
    context.GunterCoreModels = { newPipelineState: (text, userContext) => ({ input: { text, userContext } }) };
    context.GunterTraceLogger = { startStage() {}, endStage() {}, recordError() {}, persist() { persisted++; } };
    vm.runInContext(read('js/core/pipeline.js'), context, { filename: 'js/core/pipeline.js' });
    const saved = await context.GunterPipeline.handleUserInput('Gunter, guarda en memoria que vivo en Cali');
    assert.match(saved.response.speech, /guardé/i);
    assert.equal(saved.state.input.text, '[comando de memoria personal]');
    assert.equal(enriched, 0);
    assert.equal(persisted, 0);
    assert.equal(historyWrites, 0);
    assert.match(await personal.contextFor('¿Dónde vivo yo?'), /Cali/);
    const listed = await context.GunterPipeline.handleUserInput('¿Qué recuerdas de mí?');
    assert.match(listed.response.speech, /Cali/);
    assert.equal(enriched, 0);

    assert.match(read('js/controllers/assistant-controller.js'), /parseCommand\?\.\(text\)\?\.action === 'save'/);
    assert.match(read('js/services/gunter-companion.js'), /STATE\.log\.filter\(m =>/);
    console.log('PERSONAL MEMORY CONVERSATION: local prompt, cloud exclusion, deletion, account isolation and pipeline commands ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
