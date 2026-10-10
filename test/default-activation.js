'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/premium-features-service.js'), 'utf8');
const values = new Map();
const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
};
function load({ runtime = {}, capture = {}, permission = 'prompt' } = {}) {
    const window = {
        MediaRecorder: class {},
        GunterVoiceActivity: { supported: true },
        GunterRuntimeState: { getState: () => runtime },
        GunterWakeWord: { getState: () => capture },
        GunterSTT: { pushToTalk: { getState: () => capture } },
        dispatchEvent() {}
    };
    const navigator = {
        mediaDevices: { getUserMedia() { throw new Error('must not request microphone during initialization'); } },
        permissions: { query: async () => ({ state: permission, addEventListener() {} }) }
    };
    const context = { window, navigator, localStorage: storage, location: { search: '' },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, console };
    vm.runInNewContext(source, context);
    return window.PremiumFeaturesService;
}

(async () => {
    const defaults = load({ runtime: { loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true, localTTSAvailable: true } });
    for (const key of ['voiceEnabled', 'dictationEnabled', 'wakeWordEnabled', 'conversationContinuity',
        'personalMemoryContext', 'contextualRecommendations', 'diagnosticsEnabled', 'contextualHumor', 'entryVoiceGreeting']) {
        assert.equal(defaults.isEnabled(key), true, `${key} defaults to enabled`);
    }
    assert.equal(defaults.get('voiceMode'), 'live_voice');
    assert.equal(defaults.get('wakeWordListeningMode'), 'continuous');
    assert.equal(defaults.get('wakeWordResponseMode'), 'voice');
    assert.equal(defaults.isEnabled('conversationMemory'), false, 'automatic conversation retention remains opt-in');
    assert.equal(defaults.isEnabled('googleCalendarSync'), false, 'sensitive integrations are not enabled');
    assert.equal(defaults.getFeatureStatus('wakeWordEnabled'), 'pending_permission');
    assert.equal(defaults.getFeatureStatus('dictationEnabled'), 'pending_permission');
    assert.equal(values.size, 0, 'loading defaults does not overwrite existing preferences');

    defaults.set('wakeWordEnabled', false);
    defaults.set('dictationEnabled', false);
    defaults.set('voiceEnabled', false);
    defaults.set('personalMemoryContext', false);
    defaults.set('contextualHumor', false);
    defaults.set('entryVoiceGreeting', false);
    const saved = load({ runtime: { loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true, localTTSAvailable: true } });
    for (const key of ['wakeWordEnabled', 'dictationEnabled', 'voiceEnabled', 'personalMemoryContext', 'contextualHumor', 'entryVoiceGreeting']) {
        assert.equal(saved.isEnabled(key), false, `${key} explicitly off survives reload`);
        assert.equal(saved.getFeatureStatus(key), 'inactive');
    }
    assert.equal(saved.isEnabled('contextualRecommendations'), true, 'unspecified new setting keeps its default');

    values.set('gunter_premium_features', JSON.stringify({ wakeWordEnabled: false, voiceMode: 'text_only' }));
    const legacy = load();
    assert.equal(legacy.isEnabled('wakeWordEnabled'), false);
    assert.equal(legacy.get('voiceMode'), 'text_only', 'old explicit voice mode is preserved');
    assert.equal(legacy.isEnabled('voiceEnabled'), false, 'explicit text-only legacy mode is preserved');

    values.clear();
    const unavailable = load({ runtime: { loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: false, localTTSAvailable: false } });
    assert.equal(unavailable.getFeatureStatus('wakeWordEnabled'), 'unavailable', 'LOCAL_ONLY never claims Moonshine is ready');
    assert.equal(unavailable.getFeatureStatus('voiceEnabled'), 'unavailable', 'LOCAL_ONLY never claims Supertonic is ready');
    const denied = load({ runtime: { loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true, localTTSAvailable: true }, permission: 'denied' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(denied.getFeatureStatus('wakeWordEnabled'), 'error');
    const failedCapture = load({ runtime: { loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true },
        capture: { phase: 'waiting_activation', active: true, permission: 'granted', error: 'LOCAL_STT_UNAVAILABLE' } });
    assert.equal(failedCapture.getFeatureStatus('wakeWordEnabled'), 'error', 'a retained Moonshine error cannot become available');

    const dictationWindow = { PremiumFeaturesService: { isEnabled: () => false }, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/stt-provider.js'), 'utf8'),
        { window: dictationWindow, navigator: { mediaDevices: {} }, console });
    await assert.rejects(() => dictationWindow.GunterSTT.pushToTalk.start(),
        error => error.code === 'DICTATION_DISABLED_BY_USER', 'explicitly disabled dictation cannot open capture');

    const vocabulary = require('../server/actions/vocabulary');
    for (const [command, flag] of [
        ['desactiva dictado', 'dictationEnabled'],
        ['desactiva continuidad de conversación', 'conversationContinuity'],
        ['desactiva recuerdos autorizados', 'personalMemoryContext'],
        ['desactiva recomendaciones contextuales', 'contextualRecommendations'],
        ['desactiva diagnóstico de Gunter', 'diagnosticsEnabled'],
        ['desactiva humor contextual', 'contextualHumor'],
        ['desactiva bienvenida por voz', 'entryVoiceGreeting']
    ]) {
        const intent = vocabulary.classifyActionIntent(command);
        assert.equal(intent?.feature?.flag, flag, `${command} maps to the correct setting`);
        assert.equal(intent?.intent, 'toggle_off');
    }

    const actionListeners = new Map();
    const actionState = { wakeWordEnabled: true };
    const actionWindow = {
        addEventListener(type, listener) { actionListeners.set(type, listener); },
        dispatchEvent(event) { actionListeners.get(event.type)?.(event); },
        PremiumFeaturesService: {
            getAll: () => ({ ...actionState }),
            get: key => actionState[key],
            set(key, value) {
                actionState[key] = value;
                actionWindow.dispatchEvent({ type: 'gunterPremiumFeaturesChange', detail: { key, value } });
            }
        }
    };
    let serverFlag = true;
    const actionContext = { window: actionWindow, document: { readyState: 'loading', addEventListener() {} },
        fetch: async (_url, options) => {
            const body = JSON.parse(options.body);
            if (body.op === 'set') serverFlag = body.value;
            return { ok: true, json: async () => ({ success: true, data: { ok: true } }) };
        }, console, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/actions-service.js'), 'utf8'), actionContext);
    actionWindow.PremiumFeaturesService.set('wakeWordEnabled', false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(serverFlag, false, 'turning off the switch is synchronized instead of being reverted by old server state');

    console.log('DEFAULT ACTIVATION: defaults, persistence, permissions, LOCAL_ONLY ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
