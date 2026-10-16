'use strict';
// Deterministic MediaRecorder containers, no device/model/network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const timers = new Map(), events = new Map(), clips = [], commands = [];
    let serial = 0, segment = 0, recorder, vad, nextText = '', failure = false, reply;
    const config = { enabled: true, wakeWord: 'Hi Gunter', listeningMode: 'continuous', responseMode: 'text', autoStopSeconds: 20 };
    const flags = { conversationContinuity: true };
    class Recorder {
        static isTypeSupported() { return true; }
        constructor() { recorder = this; this.mimeType = 'audio/webm'; }
        start() { this.state = 'recording'; this.first = true; segment++; }
        emit(value = 'data') {
            const data = new Blob([(this.first ? 'WEBM_HEADER_' + segment : '') + ':' + value]);
            this.first = false; this.ondataavailable?.({ data });
        }
        stop() { this.state = 'inactive'; queueMicrotask(() => { this.emit('FINAL_SYLLABLE'); this.onstop?.(); }); }
    }
    const root = {
        console: { log() {}, warn() {}, error() {}, info() {} }, Blob, FormData, AbortController,
        setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; }, clearTimeout(id) { timers.delete(id); },
        MediaRecorder: Recorder, navigator: { userAgent: 'test', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
        location: { search: '' }, document: { readyState: 'loading', addEventListener() {}, querySelector: () => null },
        sessionStorage: { getItem: () => null, setItem() {} },
        addEventListener(type, fn) { events.set(type, [...(events.get(type) || []), fn]); },
        dispatchEvent(event) { for (const fn of events.get(event.type) || []) fn(event); },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        PremiumFeaturesService: { getWakeWordConfig: () => config, isEnabled: key => flags[key] !== false },
        GunterRuntimeState: { getState: () => ({ loaded: true, mode: 'LOCAL', privacy: 'LOCAL_ONLY', localSTTReady: true, flags: { 'stt.local': true } }) },
        GunterVoiceActivity: { supported: true, onChange(fn) { vad = fn; return () => { vad = null; }; }, start: async () => ({ active: true }), stop() {} },
        GunterVoice: { isSpeaking: () => false, isLikelyEcho: () => false, shouldSpeak: () => false, cancel() {} },
        GunterCompanion: { expand() {}, interrupt() {}, say() {}, async __handleFromWake(text) { commands.push(text); if (reply) await reply; } },
        GunterSTT: { async transcribe(form) {
            clips.push(await form.get('file').text());
            assert.match(clips.at(-1), /^WEBM_HEADER_/, 'every phrase retains its own initialization header');
            assert.match(clips.at(-1), /FINAL_SYLLABLE$/, 'stop flush is included, not guessed with a delay');
            if (failure) throw Object.assign(new Error('temporary failure'), { code: 'LOCAL_STT_UNAVAILABLE' });
            return nextText;
        } }
    };
    root.window = root; vm.createContext(root);
    for (const file of ['core/wake-invocation.js', 'services/wake-word-service.js'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), root);
    async function timer(delay) {
        const entry = [...timers].find(([, item]) => item.delay === delay);
        assert.ok(entry, 'scheduled timer ' + delay); timers.delete(entry[0]); entry[1].fn(); await flush();
    }
    return { root, flags, config, clips, commands, timer,
        pendingReply(value) { reply = value; }, fail(value) { failure = value; },
        async silentRotation() { for (let i = 0; i < 8; i++) recorder.emit('silence'); await flush(); },
        async phrase(text) {
            nextText = text; vad({ reason: 'speech-started' }); recorder.emit('spoken words');
            vad({ reason: 'speech-ended' }); await timer(650); await flush();
        },
        async resumedPhrase(text) {
            nextText = text; vad({ reason: 'speech-started' }); recorder.emit('before pause');
            vad({ reason: 'speech-ended' }); vad({ reason: 'speech-started' }); recorder.emit('after pause');
            assert.equal([...timers.values()].some(item => item.delay === 650), false, 'resuming speech cancels the old silence timer');
            vad({ reason: 'speech-ended' }); await timer(650); await flush();
        } };
}
(async () => {
    const h = fixture(); await h.root.GunterWakeWord.start(true);
    for (let i = 0; i < 9; i++) {
        await h.silentRotation();
        await h.phrase(i ? 'consulta numero ' + i : 'Hola Gunter revisa mis tareas');
        if (!i) await h.timer(300);
    }
    assert.equal(h.clips.length, 9); assert.equal(h.commands.length, 9);
    assert.equal(h.root.GunterWakeWord.getState().mode, 'query');
    console.log('PASS nine continuous local turns with fresh container headers and final syllables');
    await h.resumedPhrase('continúo después de una pausa');
    assert.match(h.clips.at(-1), /before pause.*after pause/, 'a brief pause preserves both sides of the same phrase');
    let resolveReply; h.pendingReply(new Promise(resolve => { resolveReply = resolve; }));
    await h.phrase('esta respuesta tarda');
    await h.phrase('Hola Gunter otra pregunta');
    assert.equal(h.clips.length, 12, 'the LLM does not hold the STT busy lock');
    resolveReply(); h.pendingReply(null); await flush();
    h.fail(true); await h.phrase('fallo temporal');
    assert.equal(h.root.GunterWakeWord.getState().phase, 'error');
    h.fail(false); await h.phrase('Hola Gunter vuelve a escuchar'); await flush();
    assert.equal(h.root.GunterWakeWord.getState().error, null);
    console.log('PASS capture remains usable during a slow reply and after a transient STT error');
    h.flags.conversationContinuity = false;
    await h.phrase('Hola Gunter orden final');
    assert.equal(h.root.GunterWakeWord.getState().mode, 'wake');
    h.root.GunterWakeWord.stop();
    assert.equal(h.root.GunterWakeWord.getState().active, false);
    console.log('PASS disabled continuity and explicit microphone stop remain respected');
})().catch(error => { console.error(error); process.exitCode = 1; });
