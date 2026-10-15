'use strict';
// Preference/UI contracts only: no microphone, model or network is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const premium = read('js/premium-features-service.js');
const ui = read('js/advanced-settings.js');
function section(start, end) {
    const a = ui.indexOf(start), b = ui.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return ui.slice(a, b);
}
function setup(saved = {}) {
    const values = new Map([['gunter_premium_features', JSON.stringify(saved)]]);
    const events = [];
    const window = { MediaRecorder: class {}, GunterVoiceActivity: { supported: true },
        GunterRuntimeState: { getState: () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localTTSAvailable: true, localSTTReady: true }) },
        GunterVoice: { getPlaybackState: () => ({ error: window.playbackError || null }) },
        dispatchEvent: event => events.push(event) };
    const context = vm.createContext({ window, navigator: { mediaDevices: { getUserMedia() { throw Error('no capture'); } } },
        localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
        location: { search: '' }, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
    vm.runInContext(premium, context);
    vm.runInContext('const S = () => window.PremiumFeaturesService; const VOICE_STYLES = [];\n'
        + section('    function voiceGuidance()', '    // ---------- Wake Word')
        + section('    function onEnumPick(', '    function onAction(')
        + section('    function badge(', '    window.GunterAdvancedSettings =')
        + '\nwindow.ui = {onEnumPick, voiceGuidance, renderVoiceCard};', context);
    return { window, service: window.PremiumFeaturesService, values, events, pick(key, value) {
        window.ui.onEnumPick({ dataset: { enumValue: value }, closest: () => ({ dataset: { enum: key } }) });
    } };
}
let passed = 0;
function check(name, fn) { fn(); console.log(`ok ${++passed} - ${name}`); }
check('loading preserves saved text-only, manual listening and wake reply choices', () => {
    const env = setup({ voiceMode: 'text_only', wakeWordListeningMode: 'manual', wakeWordResponseMode: 'text' });
    assert.equal(env.service.getVoiceConfig().enabled, false);
    assert.equal(env.service.getVoiceConfig().wakeWordResponseMode, 'text');
    assert.equal(env.service.getWakeWordConfig().listeningMode, 'manual');
    assert.equal(env.events.length, 0);
    assert.deepEqual(JSON.parse(env.values.get('gunter_premium_features')), { voiceMode: 'text_only', wakeWordListeningMode: 'manual', wakeWordResponseMode: 'text' });
});
check('explicit all-replies choice removes conflicting voice restrictions in one update', () => {
    const env = setup({ voiceEnabled: false, voiceMode: 'text_only', voiceOnlyAfterWakeWord: true, wakeWordResponseMode: 'text', wakeWordEnabled: false });
    env.pick('voiceMode', 'live_voice');
    const cfg = env.service.getVoiceConfig();
    assert.equal(cfg.enabled, true); assert.equal(cfg.mode, 'live_voice');
    assert.equal(cfg.onlyAfterWakeWord, false); assert.equal(cfg.wakeWordResponseMode, 'voice');
    assert.equal(env.service.isEnabled('wakeWordEnabled'), false, 'reply choice never opens listening');
    assert.equal(env.events.length, 1, 'one coherent preference notification');
});
check('text-only output does not disable granted listening or dictation', () => {
    const env = setup(); env.pick('voiceMode', 'text_only');
    assert.equal(env.service.getFeatureStatus('voiceEnabled'), 'inactive');
    assert.equal(env.service.isEnabled('wakeWordEnabled'), true);
    assert.equal(env.service.isEnabled('dictationEnabled'), true);
    assert.match(env.window.ui.voiceGuidance(), /solo por texto/);
});
check('wake-only mode and its text override survive persistence', () => {
    const env = setup(); env.pick('voiceMode', 'wake_word_only'); env.pick('wakeWordResponseMode', 'text');
    const copy = setup(JSON.parse(env.values.get('gunter_premium_features')));
    const cfg = copy.service.getVoiceConfig();
    assert.equal(cfg.enabled, true); assert.equal(cfg.onlyAfterWakeWord, true);
    assert.equal(cfg.wakeWordResponseMode, 'text');
    assert.match(copy.window.ui.voiceGuidance(), /mensajes escritos responden por texto/);
});
check('reply modes are visible outside advanced details and accessible without duplicates', () => {
    const env = setup(), card = env.window.ui.renderVoiceCard({ id: 'voiceEnabled', title: 'Respuestas por voz', icon: '', description: '' });
    assert.equal((card.match(/data-enum="voiceMode"/g) || []).length, 1);
    assert.ok(card.indexOf('data-enum="voiceMode"') < card.indexOf('data-details='));
    assert.match(card, /Todas las respuestas con voz/);
    assert.match(card, /role="group" aria-label="Cómo responde Gunter"/);
    assert.equal((card.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(card, /data-voice-guidance role="status" aria-live="polite"/);
});
check('blocked audio and failures remain visible without pretending voice is available', () => {
    const env = setup();
    env.window.playbackError = { code: 'VOICE_PLAYBACK_BLOCKED', message: 'Habilita el audio con una interacción.' };
    assert.equal(env.service.getFeatureStatus('voiceEnabled'), 'pending_interaction');
    assert.match(env.window.ui.voiceGuidance(), /Habilita el audio/);
    env.window.playbackError = { code: 'LOCAL_TTS_UNAVAILABLE', message: '<motor no disponible>' };
    assert.equal(env.service.getFeatureStatus('voiceEnabled'), 'error');
    const card = env.window.ui.renderVoiceCard({ id: 'voiceEnabled', title: '', description: '', icon: '' });
    assert.match(card, /&lt;motor no disponible&gt;/);
    env.window.playbackError = null;
    assert.equal(env.service.getFeatureStatus('voiceEnabled'), 'active');
});
check('invalid modes cannot turn voice on or rewrite saved preferences', () => {
    const env = setup({ voiceEnabled: false, voiceMode: 'text_only' });
    env.pick('voiceMode', 'unknown');
    assert.equal(env.service.isEnabled('voiceEnabled'), false);
    assert.equal(env.service.get('voiceMode'), 'text_only');
    assert.equal(env.events.length, 0);
});
console.log(`VOICE SETTINGS: ${passed} passed`);
