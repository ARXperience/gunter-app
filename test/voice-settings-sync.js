'use strict';
// Real preference/action clients with a controlled endpoint: no audio or models.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const premium = read('js/premium-features-service.js');
const actions = read('js/services/actions-service.js');
const ui = read('js/advanced-settings.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const legacy = { voiceEnabled: true, voiceMode: 'live_voice', voiceOnlyAfterWakeWord: true,
    wakeWordResponseMode: 'text', voiceInMeetings: false, wakeWordListeningMode: 'manual' };

function setup(saved = legacy, options = {}) {
    const requests = [], events = [], handlers = new Map(), intervals = [];
    const server = { ...saved }, values = new Map([['gunter_premium_features', JSON.stringify(saved)]]);
    const window = {
        addEventListener(type, handler) { handlers.set(type, [...(handlers.get(type) || []), handler]); },
        dispatchEvent(event) { events.push(event); for (const handler of handlers.get(event.type) || []) handler(event); }
    };
    const context = vm.createContext({ window, navigator: {}, location: { search: '' },
        document: { hidden: false, readyState: 'loading', addEventListener() {} },
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        console: { warn() {}, log() {}, error() {} },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        setTimeout() { return 1; }, setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {},
        fetch: async (_url, init) => {
            const body = JSON.parse(init.body); requests.push(body);
            let data = { ok: true };
            if (['set', 'sync_from_browser'].includes(body.op) && options.failWrites > 0) {
                options.failWrites--; return { ok: false, status: 503 };
            }
            if (body.op === 'set') server[body.flag] = body.value;
            if (body.op === 'sync_from_browser') Object.assign(server, body.flags);
            if (body.op === 'get_state') data = options.onGet ? await options.onGet(server) : { state: { ...server } };
            if (body.op === 'dispatch') {
                data = { intent: 'applied', feature: 'voiceMode', value: 'live_voice', reply: 'Listo.' };
                server.voiceMode = 'live_voice';
            }
            return { ok: true, json: async () => ({ success: true, data }) };
        }
    });
    vm.runInContext(premium, context);
    vm.runInContext(actions, context);
    const start = ui.indexOf('    function onEnumPick('), end = ui.indexOf('    function onAction(', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext('const S = () => window.PremiumFeaturesService;\n' + ui.slice(start, end)
        + '\nwindow.pickMode = value => onEnumPick({ dataset: {enumValue: value}, closest: () => ({dataset:{enum:"voiceMode"}}) });', context);
    window.GunterActions.startSync();
    return { window, service: window.PremiumFeaturesService, actions: window.GunterActions, server, requests, events,
        poll: () => intervals[0](), pick: value => window.pickMode(value) };
}

function assertAllVoice(h) {
    const cfg = h.service.getVoiceConfig();
    assert.equal(cfg.enabled, true); assert.equal(cfg.mode, 'live_voice');
    assert.equal(cfg.onlyAfterWakeWord, false); assert.equal(cfg.wakeWordResponseMode, 'voice');
}
let passed = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++passed} - ${name}`); }

(async () => {
    await check('all-voice UI selection mirrors its coupled policy once and survives the next server poll', async () => {
        const h = setup(); h.pick('live_voice'); await tick();
        assert.equal(h.requests.length, 1); assert.equal(h.requests[0].op, 'sync_from_browser');
        const flags = h.requests[0].flags;
        assert.equal(flags.voiceEnabled, true); assert.equal(flags.voiceMode, 'live_voice');
        assert.equal(flags.voiceOnlyAfterWakeWord, false); assert.equal(flags.wakeWordResponseMode, 'voice');
        assert.equal(flags.voiceInMeetings, false); assert.equal(flags.wakeWordListeningMode, 'manual');
        assert.equal(Object.hasOwn(flags, 'contextualHumor'), false);
        assert.equal(Object.hasOwn(flags, 'conversationMemory'), false);
        assert.equal(h.server.voiceOnlyAfterWakeWord, false); assert.equal(h.server.wakeWordResponseMode, 'voice');
        await h.poll(); assertAllVoice(h);
        assert.equal(h.requests.filter(request => request.op === 'sync_from_browser').length, 1);
    });

    await check('bulk null-key preference events also mirror the changed voice bundle', async () => {
        const h = setup(); h.service.updateMany({ voiceMode: 'wake_word_only', voiceSpeed: 'fast' }); await tick();
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].flags.voiceMode, 'wake_word_only');
        assert.equal(h.requests[0].flags.voiceOnlyAfterWakeWord, true);
        assert.equal(h.requests[0].flags.wakeWordResponseMode, 'voice');
        assert.equal(h.requests[0].flags.voiceSpeed, 'fast');
    });

    await check('a delayed server snapshot cannot roll back a newer local mode selection', async () => {
        let release;
        const options = { onGet: server => new Promise(resolve => { const old = { ...server }; release = () => resolve({ state: old }); }) };
        const h = setup(legacy, options), poll = h.poll(); await tick();
        assert.equal(typeof release, 'function');
        h.pick('live_voice'); await tick();
        release(); await poll; assertAllVoice(h);
        assert.equal(h.events.filter(event => event.type === 'gunter-actions-synced').length, 0);
    });

    await check('failed voice writes remain protected from polling and retry as one policy bundle', async () => {
        const h = setup(legacy, { failWrites: 2 }); h.pick('live_voice'); await tick();
        assert.equal(h.server.voiceOnlyAfterWakeWord, true);
        await h.poll(); assertAllVoice(h);
        assert.equal(h.server.voiceOnlyAfterWakeWord, true);
        await h.poll(); assertAllVoice(h);
        assert.equal(h.server.voiceOnlyAfterWakeWord, false); assert.equal(h.server.wakeWordResponseMode, 'voice');
        assert.ok(h.requests.filter(request => request.op === 'sync_from_browser')
            .every(request => request.flags.voiceMode === 'live_voice' && request.flags.voiceOnlyAfterWakeWord === false));
    });

    await check('remote replicas import atomically without normalizing saved wake/text choices or echoing writes', async () => {
        const h = setup({ voiceMode: 'notifications_only' });
        Object.assign(h.server, legacy, { voiceMode: 'wake_word_only', voiceOnlyAfterWakeWord: false, wakeWordResponseMode: 'text' });
        const seen = []; h.service.subscribe(event => seen.push(event.features));
        await h.poll();
        assert.equal(seen.length, 1);
        assert.equal(h.service.get('voiceMode'), 'wake_word_only');
        assert.equal(h.service.get('voiceOnlyAfterWakeWord'), false);
        assert.equal(h.service.get('wakeWordResponseMode'), 'text');
        assert.equal(h.service.get('wakeWordListeningMode'), 'manual');
        assert.equal(h.requests.filter(request => request.op !== 'get_state').length, 0);
        h.service.set('contextualHumor', false); await tick();
        assert.equal(h.requests.filter(request => request.op === 'sync_from_browser').length, 0);
    });

    await check('unrelated preferences retain boolean mirroring without new voice writes', async () => {
        const h = setup();
        h.service.set('contextualHumor', false); h.service.updateMany({ personalityMode: 'coach' }); await tick();
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].op, 'set'); assert.equal(h.requests[0].flag, 'contextualHumor');
        assert.equal(h.requests[0].value, false);
    });

    await check('explicit setFlag and dispatched mode changes mirror all locally reconciled fields', async () => {
        for (const viaDispatch of [false, true]) {
            const h = setup();
            if (viaDispatch) assert.equal((await h.actions.dispatch('modo de voz live_voice')).__localOk, true);
            else await h.actions.setFlag('voiceMode', 'live_voice');
            await tick(); assertAllVoice(h);
            const writes = h.requests.filter(request => request.op === 'sync_from_browser');
            assert.equal(writes.length, 1);
            assert.equal(writes[0].flags.voiceOnlyAfterWakeWord, false);
            assert.equal(writes[0].flags.wakeWordResponseMode, 'voice');
            await h.poll(); assertAllVoice(h);
        }
    });

    console.log(`VOICE SETTINGS SYNC: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
