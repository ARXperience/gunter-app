'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/services/wake-word-service.js'), 'utf8');
const invocationSource = fs.readFileSync(path.join(__dirname, '..', 'js/core/wake-invocation.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(options = {}) {
    const calls = { permissionQueries: 0, microphone: 0, starts: 0, stopped: 0, vadStopped: 0, commands: [], voices: [], feedback: [] };
    const config = { enabled: options.enabled !== false, wakeWord: 'Hi Gunter', autoStopSeconds: 20,
        responseMode: options.responseMode || 'text', listeningMode: options.listeningMode || 'continuous' };
    const runtime = { loaded: options.loaded !== false, mode: options.local ? 'LOCAL' : 'CLOUD',
        privacy: options.local ? 'LOCAL_ONLY' : 'CLOUD_ALLOWED', localSTTReady: options.model !== false,
        flags: { 'stt.local': true } };
    const listeners = new Map();
    const documentListeners = new Map();
    const permissionListeners = [];
    const timers = new Map();
    let timerId = 0;
    let recognizer = null;
    let recorder = null;
    let vadListener = null;
    const permission = { state: options.permission || 'granted', addEventListener(type, listener) { permissionListeners.push(listener); } };
    const stream = { getTracks: () => [{ stop() { calls.stopped++; } }] };
    class Recognition {
        constructor() { recognizer = this; }
        start() { calls.starts++; this.onstart?.(); }
        abort() { this.onend?.(); }
    }
    class Recorder {
        static isTypeSupported() { return true; }
        constructor() { recorder = this; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
        start() { calls.starts++; this.state = 'recording'; }
        stop() { this.state = 'inactive'; }
    }
    const context = {
        console, Blob, FormData,
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        CustomEvent: class { constructor(type, event) { this.type = type; this.detail = event?.detail; } },
        SpeechRecognition: Recognition, MediaRecorder: Recorder,
        navigator: { userAgent: 'test', permissions: { query: async () => {
            calls.permissionQueries++;
            if (options.permissionUnsupported) throw new TypeError('Unsupported permission');
            if (options.permissionPromise) return options.permissionPromise;
            return permission;
        } }, mediaDevices: { async getUserMedia() { calls.microphone++; return stream; } } },
        location: { search: '' },
        document: { readyState: 'loading', visibilityState: 'visible', querySelector: () => null,
            addEventListener(type, listener) { documentListeners.set(type, listener); } },
        sessionStorage: { getItem: () => null, setItem() {} },
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
        PremiumFeaturesService: { getWakeWordConfig: () => config },
        GunterRuntimeState: { getState: () => runtime },
        GunterSTT: { transcribe: async () => '' },
        GunterVoiceActivity: { supported: true, onChange(listener) { vadListener = listener; return () => { vadListener = null; }; },
            start: async () => ({ active: true }), stop() { calls.vadStopped++; } },
        GunterVoice: { isSpeaking: () => false, isLikelyEcho: () => false,
            isMeetingActive: () => options.meeting === true, shouldSpeak: () => options.speakAllowed === true },
        GunterCompanion: { expand() {}, interrupt() {}, async __handleFromWake(text) { calls.commands.push(text); },
            say(text, replyOptions) {
                calls.feedback.push({ text, ...replyOptions });
                if (!replyOptions.skipVoice) calls.voices.push({ text, ...replyOptions });
            } }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(invocationSource, context);
    vm.runInContext(source, context);
    const fire = (type, detail) => context.dispatchEvent(new context.CustomEvent(type, { detail }));
    return { calls, config, runtime, context, permission,
        wake: context.GunterWakeWord,
        fire,
        async load() { documentListeners.get('DOMContentLoaded')(); await settle(); },
        async changePermission(state) { permission.state = state; permissionListeners.forEach(listener => listener()); await settle(); },
        async timer(delay) {
            const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
            assert.ok(entry, `expected scheduled timer ${delay}`);
            timers.delete(entry[0]); entry[1].callback(); await settle();
        },
        async say(transcript) {
            const result = [{ transcript }]; result.isFinal = true;
            recognizer.onresult({ results: [result] }); await settle();
        },
        async endRecognition() { recognizer.onend(); await settle(); },
        async endLocalCapture() { recorder.state = 'inactive'; recorder.onstop?.(); await settle(); },
        async endVADCapture() { vadListener({ reason: 'capture-ended', active: false }); await settle(); }
    };
}

(async () => {
    const granted = harness();
    await granted.load();
    assert.equal(granted.calls.permissionQueries, 1);
    assert.equal(granted.calls.microphone, 0, 'restoring permission does not prompt or open an extra microphone');
    assert.equal(granted.wake.getState().active, true, 'a fresh page listens when permission was already granted');
    await granted.say('Hola Gunter, revisa mis tareas');
    assert.equal(granted.calls.feedback[0].voiceContext, 'wake-word-feedback');
    assert.equal(granted.calls.feedback[0].skipVoice, true, 'text response keeps a visible wake acknowledgement without audio');
    await granted.timer(300);
    assert.deepEqual(granted.calls.commands, ['revisa mis tareas']);
    assert.equal(granted.wake.getState().active, true, 'a completed command keeps wake listening');
    await granted.say('Hi Gunter, revisa mi agenda');
    await granted.timer(300);
    assert.deepEqual(granted.calls.commands, ['revisa mis tareas', 'revisa mi agenda']);
    await granted.endRecognition();
    assert.equal(granted.wake.getState().active, false, 'an ended recognizer never claims to be listening');
    await granted.timer(600);
    assert.equal(granted.calls.starts, 2, 'browser recognition rearms without another button press');
    granted.wake.stop();
    granted.fire('focus'); granted.fire('gunter-hybrid-state', granted.runtime);
    granted.fire('gunterPremiumFeaturesChange', { key: null });
    await settle();
    assert.equal(granted.calls.starts, 2, 'explicit stop survives foreground, runtime and unrelated bulk preference events');
    await granted.wake.start(true);
    assert.equal(granted.calls.starts, 3, 'an explicit start restores intent');
    granted.wake.stop();

    const delayed = harness({ loaded: false });
    await delayed.load();
    assert.equal(delayed.calls.starts, 0);
    delayed.runtime.loaded = true;
    delayed.fire('gunter-hybrid-state', delayed.runtime);
    await settle();
    assert.equal(delayed.wake.getState().active, true, 'runtime readiness starts an enabled wake listener');
    delayed.wake.stop();

    let resolvePermission;
    const permissionPromise = new Promise(resolve => { resolvePermission = resolve; });
    const cancelled = harness({ permissionPromise });
    await cancelled.load();
    cancelled.wake.stop();
    resolvePermission(cancelled.permission);
    await settle();
    assert.equal(cancelled.calls.starts, 0, 'stopping during permission restoration cancels late automatic capture');

    for (const state of ['prompt', 'denied']) {
        const pending = harness({ permission: state });
        await pending.load();
        assert.equal(pending.calls.microphone, 0, `${state} permission never prompts in background`);
        assert.equal(pending.calls.starts, 0);
        assert.equal(pending.wake.getState().active, false);
        assert.equal(pending.wake.getState().phase, state === 'denied' ? 'error' : 'permission_pending');
        await pending.changePermission('granted');
        assert.equal(pending.wake.getState().active, true, 'granting permission resumes enabled wake');
        await pending.changePermission('denied');
        assert.equal(pending.wake.getState().active, false, 'revoking permission releases listening');
        assert.equal(pending.wake.getState().permission, 'denied');
        pending.wake.stop();
    }

    const disabled = harness({ enabled: false });
    await disabled.load();
    assert.equal(disabled.calls.permissionQueries, 0);
    disabled.fire('gunter-hybrid-state', disabled.runtime);
    await settle();
    assert.equal(disabled.calls.starts, 0, 'explicit off prevents automatic capture');
    disabled.config.enabled = true;
    disabled.fire('gunterPremiumFeaturesChange', { key: 'wakeWordEnabled', value: true });
    await settle();
    assert.equal(disabled.wake.getState().active, true, 'enabling wake with granted permission needs no extra activation');
    disabled.wake.stop();
    disabled.config.enabled = false;
    disabled.fire('gunterPremiumFeaturesChange', { key: null });
    disabled.config.enabled = true;
    disabled.fire('gunterPremiumFeaturesChange', { key: null });
    await settle();
    assert.equal(disabled.calls.starts, 2, 'a bulk preference update that actually enables wake restores intent');
    disabled.wake.stop();

    const manual = harness({ listeningMode: 'manual' });
    await manual.load();
    manual.fire('focus'); manual.fire('gunter-hybrid-state', manual.runtime);
    manual.fire('gunterPremiumFeaturesChange', { key: null });
    await settle();
    assert.equal(manual.calls.starts, 0, 'saved manual mode never starts listening automatically');
    assert.equal(manual.calls.permissionQueries, 0, 'manual mode stays idle without a microphone authorization check');
    assert.equal(manual.wake.getState().phase, 'off');
    await manual.wake.start(true);
    assert.equal(manual.wake.getState().active, true, 'manual mode still responds to its activation button');
    await manual.say('Hola Gunter, revisa mis tareas');
    await manual.timer(300);
    assert.deepEqual(manual.calls.commands, ['revisa mis tareas']);
    assert.equal(manual.wake.getState().active, false, 'manual mode stops after its command');
    manual.fire('gunterPremiumFeaturesChange', { key: null }); manual.fire('focus');
    await settle();
    assert.equal(manual.calls.starts, 1, 'unrelated settings never rearm a finished manual session');
    manual.config.listeningMode = 'continuous';
    manual.fire('gunterPremiumFeaturesChange', { key: 'wakeWordListeningMode', value: 'continuous' });
    await settle();
    assert.equal(manual.calls.starts, 2, 'choosing continuous listening explicitly restores a paused session');
    assert.equal(manual.wake.getState().active, true);
    manual.config.listeningMode = 'manual';
    manual.fire('gunterPremiumFeaturesChange', { key: 'wakeWordListeningMode', value: 'manual' });
    assert.equal(manual.wake.getState().active, false, 'choosing manual stops continuous capture immediately');
    manual.fire('gunterPremiumFeaturesChange', { key: null }); manual.fire('focus');
    await settle();
    assert.equal(manual.calls.starts, 2, 'manual mode selection stays idle through unrelated bulk settings');
    await manual.wake.start(true);
    assert.equal(manual.wake.getState().active, true, 'manual mode still accepts an explicit start after changing modes');
    manual.wake.stop();

    const localManual = harness({ local: true, listeningMode: 'manual' });
    await localManual.load();
    assert.equal(localManual.calls.microphone, 0, 'saved manual mode also keeps local capture closed');
    await localManual.wake.start(true);
    assert.equal(localManual.wake.getState().active, true);
    localManual.wake.stop();

    const shared = harness();
    shared.wake.suspendForCapture();
    await shared.load();
    assert.equal(shared.calls.starts, 0, 'PTT owns the microphone even before wake starts');
    shared.wake.resumeAfterCapture();
    await settle();
    assert.equal(shared.calls.starts, 1);
    shared.wake.suspendForCapture();
    shared.fire('focus'); shared.fire('gunter-hybrid-state', shared.runtime);
    await settle();
    assert.equal(shared.calls.starts, 1, 'foreground and runtime events cannot interrupt PTT');
    assert.equal(shared.calls.vadStopped, 0, 'browser wake does not stop a separate VAD');
    shared.wake.resumeAfterCapture();
    await settle();
    assert.equal(shared.calls.starts, 2, 'PTT completion restores prior wake intent');
    shared.fire('gunter-recording-started');
    shared.fire('focus');
    await settle();
    assert.equal(shared.calls.starts, 2, 'meeting capture owns the microphone');
    shared.fire('gunter-recording-stopped');
    await settle();
    assert.equal(shared.calls.starts, 3, 'meeting completion restores wake intent');
    shared.wake.stop();

    const local = harness({ local: true });
    await local.load();
    assert.equal(local.calls.microphone, 1);
    assert.equal(local.wake.getState().active, true);
    assert.equal(local.wake.getState().provider, 'moonshine.local');
    await local.endLocalCapture();
    assert.equal(local.wake.getState().active, false);
    await local.timer(600);
    assert.equal(local.calls.microphone, 2, 'unexpected local recorder end rearms wake capture');
    await local.endVADCapture();
    await local.timer(600);
    assert.equal(local.calls.microphone, 3, 'lost VAD capture rearms without another button press');
    local.wake.stop();
    const unavailable = harness({ local: true, model: false });
    await unavailable.load();
    assert.equal(unavailable.calls.microphone, 0);
    assert.equal(unavailable.calls.starts, 0, 'LOCAL_ONLY never falls back to browser recognition');
    assert.equal(unavailable.wake.getState().provider, 'moonshine.local');
    assert.match(unavailable.wake.getState().error, /Moonshine/);
    unavailable.runtime.localSTTReady = true;
    unavailable.fire('gunter-hybrid-state', unavailable.runtime);
    await settle();
    assert.equal(unavailable.wake.getState().active, true, 'available local runtime restores wake without another activation');
    unavailable.wake.stop();

    const voiceFeedback = harness({ responseMode: 'voice', speakAllowed: true, meeting: true });
    await voiceFeedback.load();
    await voiceFeedback.say('Gunter');
    assert.equal(voiceFeedback.calls.voices.length, 1);
    assert.equal(voiceFeedback.calls.voices[0].voiceContext, 'wake-word-feedback', 'meeting state never erases wake provenance');
    voiceFeedback.config.responseMode = 'text';
    await voiceFeedback.say('Hola Gunter');
    assert.equal(voiceFeedback.calls.voices.length, 1, 'text wake responses override otherwise allowed meeting audio');
    assert.equal(voiceFeedback.calls.feedback.length, 2);
    voiceFeedback.wake.stop();

    const unsupportedPermission = harness({ permissionUnsupported: true });
    await unsupportedPermission.load();
    assert.equal(unsupportedPermission.calls.microphone, 0, 'an unsupported permission query never turns into an unsolicited prompt');
    assert.equal(unsupportedPermission.wake.getState().active, false);
    await unsupportedPermission.wake.start(true);
    assert.equal(unsupportedPermission.wake.getState().active, true, 'a user gesture still permits initial authorization');
    unsupportedPermission.wake.stop();
    console.log('WAKE AUTOSTART: granted permission, runtime readiness, repeated calls, rearm, explicit off, PTT/meeting ownership and local-only model gates ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
