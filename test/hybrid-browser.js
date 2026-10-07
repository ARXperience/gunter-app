/* Browser provider smoke tests with fake responses; no external services. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
let requests = [];
const state = { mode: 'AUTO', privacy: 'STANDARD' };
const context = {
    console, Map, Set, Float32Array, TextEncoder, FormData, Blob, URL,
    crypto: webcrypto, navigator: { language: 'es-CO', onLine: true },
    location: { pathname: '/day.html' },
    sessionStorage: { getItem: () => null },
    document: { addEventListener: () => {}, hidden: false },
    indexedDB: { open: () => { throw new Error('test_without_idb'); } },
    speechSynthesis: { cancel: () => {} },
    addEventListener: () => {}, dispatchEvent: () => {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    fetch: async (url) => {
        requests.push(url);
        if (url.includes('/api/chat') && state.mode === 'LOCAL') return { ok: false, status: 503,
            json: async () => ({ code: 'LOCAL_MODEL_NOT_INSTALLED' }) };
        if (url.includes('embeddings')) return { ok: true, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) };
        if (url.includes('transcribe')) return state.privacy === 'LOCAL_ONLY' || state.mode === 'LOCAL'
            ? { ok: false, status: 503, text: async () => JSON.stringify({ code: 'LOCAL_STT_NOT_INSTALLED' }) }
            : { ok: true, text: async () => 'voz transcrita' };
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'respuesta cloud' } }] }) };
    },
    GunterRuntimeState: { getState: () => ({ ...state }) }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
function load(file) { vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }); }
(async () => {
    load('js/services/nlp-llm-service.js');
    assert.equal(await context.GunterBrainRouter.generate('prueba'), 'respuesta cloud');
    assert.equal(context.GunterBrainRouter.health().local.status, 'NOT_INSTALLED');
    state.mode = 'LOCAL';
    await assert.rejects(context.GunterBrainRouter.generate('prueba'), error => error.code === 'LOCAL_MODEL_NOT_INSTALLED');
    state.mode = 'AUTO';
    load('js/services/stt-provider.js');
    assert.equal(await context.GunterSTT.transcribe(new FormData()), 'voz transcrita');
    state.privacy = 'LOCAL_ONLY';
    const before = requests.length;
    await assert.rejects(context.GunterSTT.transcribe(new FormData()), error => error.code === 'LOCAL_STT_NOT_INSTALLED');
    assert.equal(requests.length, before + 1); // server-authoritative route, never client cloud fallback
    state.privacy = 'STANDARD';
    load('js/services/embedding-service.js');
    const vector = await context.GunterEmbeddings.embed('texto de prueba');
    assert.equal(vector.length, 3);
    state.mode = 'LOCAL';
    await assert.rejects(context.GunterEmbeddings.embed('texto de prueba'), error => error.code === 'LOCAL_PROVIDER_NOT_INSTALLED');
    state.mode = 'AUTO';
    load('js/services/voice-service.js');
    load('js/adapters/voice-adapter.js');
    assert.equal(context.GunterAdapters.voice.providerStatus.cloud, 'CURRENT_PROVIDER');
    assert.equal(context.GunterAdapters.voice.providerStatus.browser, 'CURRENT_BROWSER_FALLBACK');
    assert.equal(context.GunterAdapters.voice.providerStatus.local, 'NOT_INSTALLED');
    console.log('HYBRID BROWSER PROVIDERS: cloud and local-proxy routing ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
