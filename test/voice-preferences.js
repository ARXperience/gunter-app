'use strict';
// Preference transactions only: no microphone, audio, model or network is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/premium-features-service.js'), 'utf8');

function setup(saved = {}, options = {}) {
    const shared = options.shared || { persisted: JSON.stringify(saved), writes: 0 };
    const events = [], handlers = new Map();
    const window = { dispatchEvent: event => events.push(event),
        addEventListener: (type, handler) => handlers.set(type, handler),
        MediaRecorder: class {}, GunterVoiceActivity: { supported: true },
        GunterRuntimeState: { getState: () => options.runtime || {} },
        GunterWakeWord: { getState: () => ({ active: true, permission: 'granted' }) },
        GunterSTT: { pushToTalk: { getState: () => ({ phase: 'recording', permission: 'granted' }) } } };
    vm.runInNewContext(source, {
        window, navigator: { mediaDevices: { getUserMedia() { throw Error('no capture'); } } },
        location: { search: '' }, console,
        localStorage: { getItem: () => shared.persisted,
            setItem: (key, value) => { shared.persisted = value; shared.writes++; } },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
    });
    return { service: window.PremiumFeaturesService, window, events,
        storageEvent: (key = 'gunter_premium_features') => handlers.get('storage')?.({ key }),
        saved: () => JSON.parse(shared.persisted), writes: () => shared.writes };
}

const legacy = { voiceEnabled: true, voiceMode: 'live_voice', voiceOnlyAfterWakeWord: true,
    wakeWordResponseMode: 'text', wakeWordListeningMode: 'manual', wakeWordEnabled: false };
const snapshot = service => JSON.parse(service.export());
let passed = 0;
function check(name, fn) { fn(); console.log(`ok ${++passed} - ${name}`); }

check('effective mode exposes saved wake restrictions without rewriting them', () => {
    const env = setup(legacy), cfg = env.service.getVoiceConfig();
    assert.equal(cfg.effectiveMode, 'wake_word_only');
    assert.equal(cfg.mode, 'live_voice');
    assert.equal(cfg.onlyAfterWakeWord, true);
    assert.equal(cfg.wakeWordResponseMode, 'text');
    assert.equal(env.service.getWakeWordConfig().listeningMode, 'manual');
    assert.equal(env.service.getWakeWordConfig().enabled, false);
    assert.deepEqual(env.saved(), legacy);
    assert.equal(env.writes(), 0); assert.equal(env.events.length, 0);
    const reload = setup(env.saved());
    assert.equal(reload.service.getVoiceConfig().effectiveMode, 'wake_word_only');
    assert.deepEqual(reload.saved(), legacy);
});

check('effective mode preserves global off, text-only and notification precedence', () => {
    for (const [saved, expected] of [
        [{ voiceEnabled: false, voiceMode: 'live_voice' }, 'text_only'],
        [{ voiceEnabled: true, voiceMode: 'text_only' }, 'text_only'],
        [{ voiceMode: 'notifications_only', voiceOnlyAfterWakeWord: true }, 'notifications_only'],
        [{ voiceMode: 'wake_word_only', voiceOnlyAfterWakeWord: false }, 'wake_word_only'],
        [{ voiceMode: 'live_voice', voiceOnlyAfterWakeWord: false }, 'live_voice']
    ]) assert.equal(setup(saved).service.getVoiceConfig().effectiveMode, expected);
});

check('set and updateMany reconcile each explicit mode identically, including same-value selections', () => {
    for (const mode of ['text_only', 'notifications_only', 'live_voice', 'wake_word_only']) {
        const single = setup(legacy), bulk = setup(legacy);
        assert.equal(single.service.set('voiceMode', mode), true);
        assert.equal(bulk.service.updateMany({ voiceMode: mode }), true);
        assert.deepEqual(snapshot(single.service), snapshot(bulk.service));
        const cfg = single.service.getVoiceConfig();
        assert.equal(cfg.enabled, mode !== 'text_only');
        assert.equal(cfg.effectiveMode, mode);
        assert.equal(cfg.onlyAfterWakeWord, mode === 'wake_word_only');
        if (mode === 'live_voice' || mode === 'wake_word_only') assert.equal(cfg.wakeWordResponseMode, 'voice');
        assert.equal(single.service.getWakeWordConfig().listeningMode, 'manual');
        assert.equal(single.service.getWakeWordConfig().enabled, false);
        assert.equal(single.events.length, 1); assert.equal(bulk.events.length, 1);
        assert.equal(single.writes(), 1); assert.equal(bulk.writes(), 1);
    }
});

check('a coherent mode selection persists and notifies subscribers exactly once', () => {
    const env = setup(legacy), observed = [];
    env.service.subscribe(event => observed.push(event.features));
    env.service.updateMany({ voiceMode: 'live_voice' });
    assert.equal(observed.length, 1); assert.equal(env.events.length, 1); assert.equal(env.writes(), 1);
    assert.equal(observed[0].voiceMode, 'live_voice');
    assert.equal(observed[0].voiceEnabled, true);
    assert.equal(observed[0].voiceOnlyAfterWakeWord, false);
    assert.equal(observed[0].wakeWordResponseMode, 'voice');
    assert.deepEqual(JSON.parse(JSON.stringify(observed[0])), env.saved());
    assert.equal(env.service.set('voiceMode', 'live_voice'), false);
    assert.equal(env.writes(), 1); assert.equal(observed.length, 1);
});

check('explicit off and wake text overrides win independently of bulk property order', () => {
    const patches = [
        { voiceMode: 'live_voice', voiceEnabled: false, wakeWordResponseMode: 'text', voiceOnlyAfterWakeWord: true },
        { voiceOnlyAfterWakeWord: true, wakeWordResponseMode: 'text', voiceEnabled: false, voiceMode: 'live_voice' }
    ];
    const outputs = patches.map(patch => {
        const env = setup(legacy); env.service.updateMany(patch);
        const cfg = env.service.getVoiceConfig();
        assert.equal(cfg.enabled, false); assert.equal(cfg.effectiveMode, 'text_only');
        assert.equal(cfg.mode, 'live_voice'); assert.equal(cfg.onlyAfterWakeWord, false);
        assert.equal(cfg.wakeWordResponseMode, 'text');
        return snapshot(env.service);
    });
    assert.deepEqual(outputs[0], outputs[1]);
    const wake = setup();
    wake.service.updateMany({ voiceMode: 'wake_word_only', wakeWordResponseMode: 'text' });
    assert.equal(wake.service.getVoiceConfig().wakeWordResponseMode, 'text');
    wake.service.updateMany({ voiceMode: 'text_only', voiceEnabled: true });
    assert.equal(wake.service.isEnabled('voiceEnabled'), false);
});

check('legacy wake restriction changes keep mode coherent without enabling muted voice', () => {
    for (const [bulk, enabled] of [[false, false], [true, false], [false, true], [true, true]]) {
        const env = setup({ ...legacy, voiceEnabled: enabled, voiceMode: 'text_only' });
        const change = value => bulk ? env.service.updateMany({ voiceOnlyAfterWakeWord: value })
            : env.service.set('voiceOnlyAfterWakeWord', value);
        change(true);
        assert.equal(env.service.get('voiceMode'), 'wake_word_only');
        assert.equal(env.service.isEnabled('voiceEnabled'), false);
        change(false);
        assert.equal(env.service.get('voiceMode'), 'live_voice');
        assert.equal(env.service.isEnabled('voiceEnabled'), false);
        assert.equal(env.service.get('wakeWordResponseMode'), 'text');
        assert.equal(env.events.length, 2);
    }
});

check('master activation and parent disabling share the same mutation rules', () => {
    const single = setup({ voiceEnabled: false, voiceMode: 'text_only' });
    const bulk = setup({ voiceEnabled: false, voiceMode: 'text_only' });
    single.service.set('voiceEnabled', true); bulk.service.updateMany({ voiceEnabled: true });
    assert.equal(single.service.getVoiceConfig().effectiveMode, 'live_voice');
    assert.deepEqual(snapshot(single.service), snapshot(bulk.service));
    single.service.set('voiceInMeetings', true); bulk.service.set('voiceInMeetings', true);
    single.service.set('voiceEnabled', false); bulk.service.updateMany({ voiceEnabled: false });
    assert.equal(single.service.get('voiceInMeetings'), false);
    assert.deepEqual(snapshot(single.service), snapshot(bulk.service));
});

check('imports and unrelated updates preserve saved explicit policy without treating it as a mode selection', () => {
    for (const saved of [legacy, { ...legacy, voiceEnabled: false },
        { ...legacy, voiceMode: 'wake_word_only', voiceOnlyAfterWakeWord: false }]) {
        const env = setup();
        assert.equal(env.service.import(JSON.stringify(saved)), true);
        for (const [key, value] of Object.entries(saved)) assert.equal(env.service.get(key), value);
        const before = env.service.getVoiceConfig();
        env.service.updateMany({ voiceStyle: 'warm', contextualHumor: false });
        const after = env.service.getVoiceConfig();
        for (const key of ['enabled', 'mode', 'effectiveMode', 'onlyAfterWakeWord', 'wakeWordResponseMode']) {
            assert.equal(after[key], before[key]);
        }
        const reload = setup(env.saved());
        for (const key of ['enabled', 'mode', 'effectiveMode', 'onlyAfterWakeWord', 'wakeWordResponseMode']) {
            assert.equal(reload.service.getVoiceConfig()[key], after[key]);
        }
    }
});

check('invalid mode selections cannot normalize legacy preferences or activate voice', () => {
    const env = setup({ ...legacy, voiceEnabled: false });
    const before = snapshot(env.service);
    assert.equal(env.service.set('voiceMode', 'unknown'), false);
    assert.equal(env.service.updateMany({ voiceMode: 'unknown' }), false);
    assert.deepEqual(snapshot(env.service), before);
    assert.equal(env.writes(), 0); assert.equal(env.events.length, 0);
});

check('storage events refresh another tab and its public alias without writing preferences back', () => {
    const shared = { persisted: JSON.stringify(legacy), writes: 0 };
    const first = setup({}, { shared }), second = setup({}, { shared }), observed = [];
    second.service.subscribe(event => observed.push(event.features));
    first.service.set('voiceMode', 'live_voice');
    assert.equal(first.window.GUNTER_PREMIUM_FEATURES.voiceOnlyAfterWakeWord, false);
    assert.equal(second.service.getVoiceConfig().effectiveMode, 'wake_word_only');
    second.storageEvent('unrelated-setting');
    assert.equal(second.events.length, 0);
    second.storageEvent();
    assert.equal(second.service.getVoiceConfig().effectiveMode, 'live_voice');
    assert.equal(second.window.GUNTER_PREMIUM_FEATURES.wakeWordResponseMode, 'voice');
    assert.equal(second.events.length, 1); assert.equal(observed.length, 1);
    assert.equal(shared.writes, 1, 'receiving a storage update never echoes it');
    second.storageEvent();
    assert.equal(second.events.length, 1, 'an unchanged storage snapshot does not notify again');
    first.service.import(JSON.stringify(legacy));
    assert.equal(first.window.GUNTER_PREMIUM_FEATURES.voiceOnlyAfterWakeWord, true);
    second.storageEvent();
    assert.equal(second.service.get('voiceMode'), 'live_voice');
    assert.equal(second.service.get('voiceOnlyAfterWakeWord'), true);
    assert.equal(second.service.get('wakeWordResponseMode'), 'text');
    assert.equal(shared.writes, 2);
    first.service.reset();
    assert.equal(first.window.GUNTER_PREMIUM_FEATURES.voiceOnlyAfterWakeWord, false);
    assert.equal(first.window.GUNTER_PREMIUM_FEATURES.wakeWordResponseMode, 'voice');
});

check('unrelated updates merge the newest saved policy even before a storage event arrives', () => {
    for (const bulk of [false, true]) {
        const shared = { persisted: JSON.stringify(legacy), writes: 0 };
        const first = setup({}, { shared }), second = setup({}, { shared }), observed = [];
        second.service.subscribe(event => observed.push(event.features));
        first.service.set('voiceMode', 'live_voice');
        if (bulk) second.service.updateMany({ voiceStyle: 'warm', voiceSpeed: 'fast' });
        else second.service.set('voiceStyle', 'warm');
        assert.equal(second.saved().voiceMode, 'live_voice');
        assert.equal(second.saved().voiceOnlyAfterWakeWord, false);
        assert.equal(second.saved().wakeWordResponseMode, 'voice');
        assert.equal(second.service.getVoiceConfig().effectiveMode, 'live_voice');
        assert.equal(second.window.GUNTER_PREMIUM_FEATURES.voiceOnlyAfterWakeWord, false);
        assert.equal(second.events.length, 1); assert.equal(observed.length, 1);
        assert.equal(second.events[0].detail.key, null, 'a merged remote policy notifies every affected consumer');
        assert.equal(shared.writes, 2);
        second.storageEvent();
        assert.equal(second.events.length, 1);
    }
});

check('explicitly disabled local STT remains unavailable even with ready models and granted capture', () => {
    const runtime = { mode: 'LOCAL', privacy: 'LOCAL_ONLY', loaded: true, localSTTReady: true,
        flags: { 'stt.local': false } };
    for (const key of ['wakeWordEnabled', 'dictationEnabled']) {
        assert.equal(setup({}, { runtime }).service.getFeatureStatus(key), 'unavailable');
        assert.equal(setup({}, { runtime: { ...runtime, flags: { 'stt.local': true } } }).service.getFeatureStatus(key), 'active');
        assert.equal(setup({}, { runtime: { ...runtime, flags: {} } }).service.getFeatureStatus(key), 'active');
    }
});

console.log(`VOICE PREFERENCES: ${passed} passed`);
