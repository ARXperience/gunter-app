'use strict';
// Preference/UI contracts only: no microphone, model or network is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const premium = read('js/premium-features-service.js');
const ui = read('js/advanced-settings.js');
const configUi = read('js/config-settings.js');
function section(start, end) {
    const a = ui.indexOf(start), b = ui.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return ui.slice(a, b);
}
function setup(saved = {}) {
    const values = new Map([['gunter_premium_features', JSON.stringify(saved)]]);
    const events = [], playbackCalls = [];
    const window = { MediaRecorder: class {}, GunterVoiceActivity: { supported: true },
        GunterRuntimeState: { getState: () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localTTSAvailable: true, localSTTReady: true }) },
        feedback: { textContent: '' },
        GunterVoice: { getPlaybackState: () => ({ error: window.playbackError || null }), shouldSpeak: () => true,
            cancel() {}, speak: (text, options) => playbackCalls.push({ text, options }) },
        dispatchEvent: event => events.push(event) };
    const context = vm.createContext({ window, navigator: { mediaDevices: { getUserMedia() { throw Error('no capture'); } } },
        document: { getElementById: () => window.feedback },
        localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
        location: { search: '' }, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
    vm.runInContext(premium, context);
    vm.runInContext('const S = () => window.PremiumFeaturesService; const VOICE_STYLES = [];\n'
        + 'let rootEl = {querySelector: () => window.feedback}, voiceTestMessage = "", voiceTestRunning = false, voiceTestPlayed = false;\n'
        + section('    function voiceGuidance()', '    // ---------- Wake Word')
        + section('    function renderWakeWordCard(', '    // ---------- Event wiring')
        + section('    function onEnumPick(', '    function onAction(')
        + section('    function showVoiceTest(', '    // Fase F.F4 — Test wake word')
        + section('    function badge(', '    window.GunterAdvancedSettings =')
        + configUi.slice(configUi.indexOf('    function updateVoiceDependencies()'), configUi.indexOf('    function initVoiceTest()'))
        + '\nwindow.ui = {onEnumPick, voiceGuidance, renderVoiceCard, renderWakeWordCard, testVoice, updateVoiceTest, updateVoiceDependencies};', context);
    return { window, service: window.PremiumFeaturesService, values, events, playbackCalls, pick(key, value) {
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
    assert.match(copy.window.ui.voiceGuidance(), /respuestas de conversación están silenciadas/);
});
check('reply modes are visible outside advanced details and accessible without duplicates', () => {
    const env = setup(), card = env.window.ui.renderVoiceCard({ id: 'voiceEnabled', title: 'Respuestas por voz', icon: '', description: '' });
    assert.equal((card.match(/data-enum="voiceMode"/g) || []).length, 1);
    assert.ok(card.indexOf('data-enum="voiceMode"') < card.indexOf('data-details='));
    assert.match(card, /Todas las respuestas con voz/);
    assert.match(card, /role="group" aria-label="Cómo responde Gunter"/);
    const modes = card.match(/data-enum="voiceMode"[\s\S]*?<\/div>/)[0];
    assert.equal((modes.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(card, /data-voice-guidance role="status" aria-live="polite"/);
    assert.doesNotMatch(card, /data-switch="voiceOnlyAfterWakeWord"/, 'no duplicate restriction switch');
    assert.equal((card.match(/data-enum="wakeWordResponseMode"/g) || []).length, 1);
    const wake = env.window.ui.renderWakeWordCard({ id: 'wakeWordEnabled', title: '', description: '', icon: '' });
    assert.doesNotMatch(wake, /data-enum="wakeWordResponseMode"/, 'one place controls output policy');
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
check('legacy restrictions are displayed as the effective mode rather than promising all replies', () => {
    const env = setup({ voiceEnabled: true, voiceMode: 'live_voice', voiceOnlyAfterWakeWord: true, wakeWordResponseMode: 'text' });
    const card = env.window.ui.renderVoiceCard({ id: 'voiceEnabled', title: '', description: '', icon: '' });
    assert.match(card, /aria-pressed="true" data-enum-value="wake_word_only"/);
    assert.match(card, /aria-pressed="false" data-enum-value="live_voice"/);
    assert.match(card, /Motor de voz disponible/);
    assert.match(env.window.ui.voiceGuidance(), /silenciadas/);
});
check('custom per-channel text overrides never mark all replies as selected', () => {
    const env = setup({ voiceMode: 'live_voice', voiceOnlyAfterWakeWord: false, wakeWordResponseMode: 'text' });
    const card = env.window.ui.renderVoiceCard({ id: 'voiceEnabled', title: '', description: '', icon: '' });
    assert.match(card, /aria-pressed="false" data-enum-value="live_voice"/);
    assert.match(env.window.ui.voiceGuidance(), /órdenes por nombre.*solo por texto/);
});
check('explicit voice preview shows real playback progress, completion and errors', () => {
    const env = setup({ voiceMode: 'wake_word_only', voiceOnlyAfterWakeWord: true });
    const event = (state, detail = {}) => env.window.ui.updateVoiceTest({ detail: { context: 'voice-preview', state, ...detail } });
    env.window.ui.testVoice();
    assert.equal(env.playbackCalls.length, 1);
    assert.equal(env.playbackCalls[0].options.context, 'voice-preview');
    assert.match(env.window.feedback.textContent, /Preparando/);
    event('speaking'); assert.match(env.window.feedback.textContent, /Reproduciendo/);
    event('idle', { reason: 'queue-empty' }); assert.match(env.window.feedback.textContent, /Prueba completada/);
    env.window.ui.testVoice(); event('idle', { reason: 'voice-unavailable' });
    event('unavailable', { message: 'El navegador bloqueó el audio.' });
    assert.equal(env.window.feedback.textContent, 'El navegador bloqueó el audio.');
});
check('preview respects disabled output and silent meetings without silently doing nothing', () => {
    const env = setup({ voiceEnabled: false });
    env.window.ui.testVoice(); assert.equal(env.playbackCalls.length, 0);
    assert.match(env.window.feedback.textContent, /desactivadas/);
    env.pick('voiceMode', 'live_voice');
    env.window.GunterVoice.shouldSpeak = () => false;
    env.window.ui.testVoice(); assert.equal(env.playbackCalls.length, 0);
    assert.match(env.window.feedback.textContent, /silenciada durante esta reunión/);
});
check('runtime controls cannot be hidden in every configuration category', () => {
    const css = read('styles/pages/config-settings.css');
    assert.match(css, /#premium-panel:not\(\[data-category="premium"\]\) > \.cp-settings/);
    const controller = read('js/advanced-settings.js');
    assert.match(controller, /controlPlanePanel\.hidden = activeCategory !== 'premium'/);
});
check('microphone dependency explains disabled local engine separately from missing model', () => {
    const env = setup();
    env.window.GunterRuntimeState.getState = () => ({ loaded: true, localSTTReady: true, localSTTAvailable: false, flags: { 'stt.local': false } });
    env.window.ui.updateVoiceDependencies(); assert.match(env.window.feedback.textContent, /motor Moonshine está desactivado/);
    env.window.GunterRuntimeState.getState = () => ({ loaded: true, localSTTReady: true, localSTTAvailable: true, flags: { 'stt.local': true } });
    env.window.ui.updateVoiceDependencies(); assert.match(env.window.feedback.textContent, /Moonshine local listo/);
});
console.log(`VOICE SETTINGS: ${passed} passed`);
