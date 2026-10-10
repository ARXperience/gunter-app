'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function waitFor(predicate) {
    const deadline = Date.now() + 2500;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(predicate(), 'expected asynchronous capture state before timeout');
}

function captureHarness(service) {
    const calls = { microphone: 0, stopped: 0, recorderStarted: 0, vadStopped: 0, transcribed: 0, reviewed: 0, commanded: 0 };
    const states = [];
    const listeners = new Map();
    const controls = { enabled: true, mediaPending: null, vadPending: null, transcribePending: null, transcribeError: null, vadListener: null, recorder: null };
    const stream = { getTracks: () => [{ stop() { calls.stopped++; } }] };
    class Recorder {
        static isTypeSupported() { return true; }
        constructor() { this.mimeType = 'audio/webm;codecs=opus'; this.state = 'inactive'; controls.recorder = this; }
        start() { calls.recorderStarted++; this.state = 'recording'; }
        stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
        requestData() { this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }); }
    }
    const context = { console, Blob, FormData, setTimeout, clearTimeout, setInterval, clearInterval, performance,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        MediaRecorder: Recorder,
        navigator: { userAgent: 'Test', mediaDevices: { getUserMedia() {
            calls.microphone++;
            return controls.mediaPending?.promise || Promise.resolve(stream);
        } } },
        location: { search: '' }, document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } },
        localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; }, setItem() {} },
        addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
        dispatchEvent(event) {
            if (event.type === 'wake-word-state' || event.type === 'gunter-push-to-talk-state') states.push(event.detail);
            for (const listener of listeners.get(event.type) || []) listener(event);
        },
        PremiumFeaturesService: {
            isEnabled: () => controls.enabled,
            getWakeWordConfig: () => ({ enabled: controls.enabled, wakeWord: 'Hi Gunter', responseMode: 'text' })
        },
        GunterRuntimeState: { getState: () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true,
            flags: { 'stt.local': true } }) },
        GunterVoiceActivity: { supported: true,
            onChange(fn) { controls.vadListener = fn; return () => { controls.vadListener = null; }; },
            start() { return controls.vadPending?.promise || Promise.resolve({ active: true }); },
            stop() { calls.vadStopped++; }
        },
        GunterVoice: { isLikelyEcho: () => false, isSpeaking: () => false, cancel() {} },
        GunterCompanion: { reviewTranscript() { calls.reviewed++; }, expand() {}, interrupt() {}, async __handleFromWake() { calls.commanded++; } },
        GunterSTT: { async transcribe() {
            calls.transcribed++;
            if (controls.transcribeError) throw controls.transcribeError;
            return controls.transcribePending?.promise || 'Hola Gunter';
        } }
    };
    context.window = context;
    if (service === 'stt-provider') delete context.GunterSTT;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core/wake-invocation.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'services', `${service}.js`), 'utf8'), context);
    if (service === 'stt-provider') context.GunterSTT.transcribe = async () => {
        calls.transcribed++;
        return controls.transcribePending?.promise || 'Revisa mis tareas';
    };
    const disable = key => {
        controls.enabled = false;
        context.dispatchEvent(new context.CustomEvent('gunterPremiumFeaturesChange', { detail: { key, value: false } }));
    };
    return { context, controls, calls, states, stream, disable };
}

(async () => {
    let micCalls = 0, stopped = 0, vadStarts = 0, transcriptCalls = 0;
    const commands = [], states = [];
    let vadListener;
    let recorder;
    class Recorder {
        static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
        constructor() { this.mimeType = 'audio/webm;codecs=opus'; recorder = this; }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; }
        requestData() { this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }); }
    }
    const context = { console, Blob, FormData, setTimeout, clearTimeout, CustomEvent: class {
        constructor(type, options) { this.type = type; this.detail = options?.detail; }
    }, MediaRecorder: Recorder,
    navigator: { userAgent: 'Test', mediaDevices: { getUserMedia: async () => {
        micCalls++;
        return { getTracks: () => [{ stop: () => stopped++ }] };
    } } },
    location: { search: '' },
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {}, dispatchEvent(event) { if (event.type === 'wake-word-state') states.push(event.detail.phase); },
    PremiumFeaturesService: { getWakeWordConfig: () => ({ enabled: true, wakeWord: 'Hi Gunter', autoStopSeconds: 5, responseMode: 'text' }) },
    GunterRuntimeState: { getState: () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTInstalled: true,
        localSTTReady: true, localSTTRuntimeAvailable: true, flags: { 'stt.local': true } }) },
    GunterVoiceActivity: { supported: true, onChange(fn) { vadListener = fn; return () => { vadListener = null; }; },
        async start(shared) { assert.ok(shared); vadStarts++; return { active: true }; }, stop() {} },
    GunterSTT: { async transcribe() { transcriptCalls++; return 'Hola Gunter, revisa mis tareas'; } },
    GunterVoice: { isLikelyEcho: () => false, isSpeaking: () => false },
    GunterCompanion: { expand() {}, interrupt() {}, async __handleFromWake(text) { commands.push(text); } }
    };
    context.window = context;
    vm.createContext(context);
    const base = path.join(__dirname, '..', 'js');
    vm.runInContext(fs.readFileSync(path.join(base, 'core/wake-invocation.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(base, 'services/wake-word-service.js'), 'utf8'), context);
    context.GunterWakeWord.refresh();
    assert.equal(context.GunterWakeWord.getState().phase, 'permission_pending');
    assert.equal(micCalls, 0, 'enabled by default must not open the microphone without a gesture');
    await context.GunterWakeWord.start(false);
    assert.equal(micCalls, 0, 'background startup must not request permission');
    await context.GunterWakeWord.start(true);
    assert.equal(context.GunterWakeWord.getState().phase, 'waiting_activation');
    assert.equal(micCalls, 1);
    assert.equal(vadStarts, 1);
    vadListener({ reason: 'speech-started' });
    recorder.requestData();
    vadListener({ reason: 'speech-ended' });
    await waitFor(() => commands.length === 1);
    assert.equal(transcriptCalls, 1);
    assert.deepEqual(commands, ['revisa mis tareas']);
    assert.ok(states.includes('recording') && states.includes('transcribing') && states.includes('processing'));
    context.GunterWakeWord.suspendForCapture();
    assert.equal(stopped, 1, 'push-to-talk releases the wake microphone');
    context.GunterWakeWord.resumeAfterCapture();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(micCalls, 2, 'wake resumes after manual dictation');
    context.GunterWakeWord.stop();
    assert.equal(stopped, 2);
    assert.equal(context.GunterWakeWord.getState().active, false);
    context.GunterRuntimeState.getState = () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: false, flags: { 'stt.local': true } });
    await context.GunterWakeWord.start(true);
    assert.equal(micCalls, 2, 'missing Moonshine must not open the microphone or use cloud');
    assert.match(context.GunterWakeWord.getState().error, /Moonshine/);

    for (const stage of ['permission', 'vad']) {
        const wake = captureHarness('wake-word-service');
        const pending = deferred();
        if (stage === 'permission') wake.controls.mediaPending = pending;
        else wake.controls.vadPending = pending;
        const operation = wake.context.GunterWakeWord.start(true);
        await Promise.resolve();
        wake.disable('wakeWordEnabled');
        pending.resolve(stage === 'permission' ? wake.stream : { active: true });
        await operation;
        assert.equal(wake.context.GunterWakeWord.getState().active, false, `wake cancellation while ${stage} pending`);
        assert.equal(wake.context.GunterWakeWord.getState().phase, 'off');
        assert.equal(wake.calls.recorderStarted, 0, 'cancelled wake startup never starts MediaRecorder');
        assert.ok(wake.calls.stopped >= 1, 'late microphone tracks are released');
        assert.ok(!wake.states.some(state => state.active), 'cancelled wake never announces listening');
        wake.controls.enabled = true;
        wake.controls.mediaPending = null; wake.controls.vadPending = null;
        await wake.context.GunterWakeWord.start(true);
        assert.equal(wake.context.GunterWakeWord.getState().active, true, 'wake can restart after cancellation');
        wake.context.GunterWakeWord.stop();

        const dictation = captureHarness('stt-provider');
        const dictationPending = deferred();
        if (stage === 'permission') dictation.controls.mediaPending = dictationPending;
        else dictation.controls.vadPending = dictationPending;
        const dictationOperation = dictation.context.GunterSTT.pushToTalk.start();
        await Promise.resolve();
        dictation.disable('dictationEnabled');
        dictationPending.resolve(stage === 'permission' ? dictation.stream : { active: true });
        await dictationOperation;
        assert.equal(dictation.context.GunterSTT.pushToTalk.getState().active, false);
        assert.equal(dictation.context.GunterSTT.pushToTalk.getState().phase, 'off');
        assert.equal(dictation.calls.recorderStarted, 0, 'cancelled dictation never starts MediaRecorder');
        assert.ok(dictation.calls.stopped >= 1, 'dictation releases late microphone tracks');
        assert.ok(!dictation.states.some(state => state.active), 'cancelled dictation never announces recording');
        dictation.controls.enabled = true;
        dictation.controls.mediaPending = null; dictation.controls.vadPending = null;
        await dictation.context.GunterSTT.pushToTalk.start();
        assert.equal(dictation.context.GunterSTT.pushToTalk.isActive(), true, 'dictation can restart after cancellation');
        dictation.disable('dictationEnabled');
        await Promise.resolve();
        assert.equal(dictation.calls.transcribed, 0, 'disabled dictation never sends a cancelled clip for transcription');
    }

    const failingWake = captureHarness('wake-word-service');
    failingWake.controls.transcribeError = Object.assign(new Error('Moonshine runtime unavailable'), { code: 'LOCAL_STT_UNAVAILABLE' });
    await failingWake.context.GunterWakeWord.start(true);
    failingWake.controls.vadListener({ reason: 'speech-started' });
    failingWake.controls.recorder.requestData();
    failingWake.controls.vadListener({ reason: 'speech-ended' });
    await waitFor(() => failingWake.context.GunterWakeWord.getState().phase === 'error');
    assert.equal(failingWake.calls.transcribed, 1);
    assert.equal(failingWake.context.GunterWakeWord.getState().phase, 'error', 'Moonshine error survives finally');
    assert.equal(failingWake.context.GunterWakeWord.getState().error, 'LOCAL_STT_UNAVAILABLE');
    failingWake.context.GunterWakeWord.refresh();
    assert.equal(failingWake.context.GunterWakeWord.getState().phase, 'error', 'refresh preserves diagnosis');
    failingWake.context.GunterWakeWord.stop();
    failingWake.controls.transcribeError = null;
    await failingWake.context.GunterWakeWord.start(true);
    assert.equal(failingWake.context.GunterWakeWord.getState().error, null, 'successful restart clears the recovered error');
    failingWake.context.GunterWakeWord.stop();

    const normalDictation = captureHarness('stt-provider');
    await normalDictation.context.GunterSTT.pushToTalk.start();
    normalDictation.controls.recorder.requestData();
    normalDictation.context.GunterSTT.pushToTalk.stop();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(normalDictation.calls.transcribed, 1, 'ordinary manual stop still transcribes the clip');
    assert.equal(normalDictation.calls.reviewed, 1, 'ordinary dictation still opens review');

    const lateDictation = captureHarness('stt-provider');
    const transcription = deferred();
    lateDictation.controls.transcribePending = transcription;
    await lateDictation.context.GunterSTT.pushToTalk.start();
    lateDictation.controls.recorder.requestData();
    lateDictation.context.GunterSTT.pushToTalk.stop();
    await Promise.resolve();
    assert.equal(lateDictation.calls.transcribed, 1);
    lateDictation.disable('dictationEnabled');
    lateDictation.controls.enabled = true;
    transcription.resolve('Esta transcripción ya fue cancelada');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(lateDictation.calls.reviewed, 0, 'reenabling dictation cannot restore a cancelled late transcript');
    console.log('LOCAL WAKE BROWSER: one microphone, Moonshine segment, invocation, full command, release ✓');
    console.log('CAPTURE CANCELLATION: late permissions/VAD, explicit disable, restart and retained Moonshine errors ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
