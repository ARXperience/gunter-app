'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
    await new Promise(resolve => setTimeout(resolve, 1200));
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
    console.log('LOCAL WAKE BROWSER: one microphone, Moonshine segment, invocation, full command, release ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
