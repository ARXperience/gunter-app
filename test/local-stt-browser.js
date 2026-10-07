/* Browser push-to-talk contract without microphone, cloud API or real messages. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
    const requests = [], turns = [], events = [];
    let tracksStopped = 0;
    class Recorder {
        static isTypeSupported(value) { return value === 'audio/webm;codecs=opus'; }
        constructor() { this.mimeType = 'audio/webm;codecs=opus'; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.ondataavailable?.({ data: new Blob(['fake microphone bytes'], { type: 'audio/webm' }) });
            this.onstop?.();
        }
    }
    const context = { console, Blob, FormData, setTimeout, clearTimeout, CustomEvent: class {
        constructor(name, options) { this.type = name; this.detail = options.detail; }
    }, MediaRecorder: Recorder,
        navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { tracksStopped++; } }] }) } },
        GunterRuntimeState: { getState: () => ({ mode: 'LOCAL', privacy: 'LOCAL_ONLY' }) },
        GunterCompanion: { __handleFromWake: async value => turns.push(value) },
        dispatchEvent: event => events.push(event),
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, text: async () => JSON.stringify({ text: 'Crea una tarea para revisar seguridad', provider: 'moonshine.local' }) };
        } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/services/stt-provider.js'), 'utf8'), context);
    await context.GunterSTT.pushToTalk.start();
    assert.equal(context.GunterSTT.pushToTalk.isActive(), true);
    context.GunterSTT.pushToTalk.stop();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(context.GunterSTT.pushToTalk.isActive(), false);
    assert.equal(tracksStopped, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/transcribe');
    assert.deepEqual(turns, ['Crea una tarea para revisar seguridad']);
    assert.deepEqual(events.map(event => event.detail.active), [true, false]);
    console.log('LOCAL STT BROWSER: push-to-talk → shared route → voice companion ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
