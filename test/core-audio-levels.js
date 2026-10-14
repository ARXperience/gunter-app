const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(file, { failTTS = false } = {}) {
    const events = [], handlers = new Map(), frames = new Map(), contexts = [], audios = [];
    let frameId = 0, now = 0, permissions = 0, stoppedTracks = 0;
    class Node {
        constructor() { this.connections = []; this.disconnected = false; }
        connect(target) { this.connections.push(target); }
        disconnect() { this.disconnected = true; this.connections = []; }
    }
    class AudioContext {
        constructor() { this.state = 'running'; this.destination = {}; this.sources = []; contexts.push(this); }
        createAnalyser() { const node = new Node(); node.fftSize = 1024; node.getFloatTimeDomainData = data => data.fill(0.25); this.analyser = node; return node; }
        createMediaElementSource(audio) { const node = new Node(); node.audio = audio; this.sources.push(node); return node; }
        createMediaStreamSource(stream) { const node = new Node(); node.stream = stream; this.sources.push(node); return node; }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
    class Audio {
        constructor(url) { this.url = url; this.paused = true; this.listeners = {}; this.ended = false; audios.push(this); }
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
        emit(type) { (this.listeners[type] || []).forEach(listener => listener()); }
        async play() { this.paused = false; this.emit('playing'); }
        pause() { this.paused = true; this.emit('pause'); }
    }
    const stream = { getTracks: () => [{ stop() { stoppedTracks++; } }], getAudioTracks: () => [{}] };
    const root = {
        AudioContext, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        dispatchEvent(event) { events.push(event); (handlers.get(event.type) || []).forEach(listener => listener(event)); },
        addEventListener(type, listener) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(listener); },
        removeEventListener(type, listener) { handlers.set(type, (handlers.get(type) || []).filter(entry => entry !== listener)); },
        requestAnimationFrame(listener) { const id = ++frameId; frames.set(id, listener); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        navigator: { mediaDevices: { async getUserMedia() { permissions++; return stream; } } },
        PremiumFeaturesService: { getVoiceConfig: () => ({ enabled: true, mode: 'live_voice', speed: 'normal' }) }
    };
    const synthesis = { getVoices: () => [], speak() {}, cancel() {} };
    root.speechSynthesis = synthesis;
    const sandbox = {
        window: root, document: { addEventListener() {} }, CustomEvent: root.CustomEvent,
        Audio, speechSynthesis: synthesis, SpeechSynthesisUtterance: class {},
        fetch: async () => { if (failTTS) throw new Error('unavailable'); return { ok: true, blob: async () => ({}) }; },
        URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
        Date: { now: () => now }, performance: { now: () => now }, Float32Array,
        AbortController, setTimeout, clearTimeout, console: { warn() {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services', file), 'utf8'), sandbox);
    return {
        root, events, contexts, audios, stream, frames,
        permissions: () => permissions, stoppedTracks: () => stoppedTracks,
        gesture: () => root.dispatchEvent({ type: 'pointerdown' }),
        levels: source => events.filter(event => event.type === 'gunter-audio-level' && event.detail.source === source).map(event => event.detail),
        step(time) { now = time; const queued = [...frames.values()]; frames.clear(); queued.forEach(listener => listener(time)); }
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
(async () => {
    await test('assistant metering is opt-in and never requests microphone permission', async () => {
        const h = harness('voice-service.js');
        await h.root.GunterVoice.speak('Fixture'); await tick();
        assert.equal(h.contexts.length, 0); assert.equal(h.permissions(), 0);
        assert.equal(h.audios[0].paused, false);
        h.root.GunterVoice.cancel();
    });
    await test('real sample RMS is throttled and routed to exactly one audible destination', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.setAudioAnalysisEnabled(true); assert.equal(h.contexts.length, 0);
        h.gesture(); await voice.speak('Fixture'); await tick();
        const context = h.contexts[0];
        assert.equal(context.sources.length, 1);
        assert.equal(context.sources[0].connections[0], context.analyser);
        assert.equal(context.analyser.connections.length, 1);
        assert.equal(context.analyser.connections[0], context.destination);
        h.step(0); h.step(10); h.step(40);
        const samples = h.levels('assistant').filter(level => level.active);
        assert.equal(samples.length, 2); assert.equal(samples[0].level, 0.25);
        assert.equal(samples[0].available, true); assert.equal(h.permissions(), 0);
        voice.cancel('barge-in');
        assert.equal(h.frames.size, 0); assert.equal(h.levels('assistant').at(-1).level, 0);
        assert.equal(h.levels('assistant').at(-1).active, false);
        assert.equal(context.sources[0].disconnected, true);
    });
    await test('preparing audio is pending, not actual playback', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.speak('Fixture');
        assert.equal(voice.getPlaybackState().speaking, false);
        assert.equal(voice.getPlaybackState().pending, true);
        await tick();
        assert.equal(voice.getPlaybackState().speaking, true);
        assert.equal(voice.getPlaybackState().pending, false);
        voice.cancel();
        assert.equal(voice.getPlaybackState().speaking, false);
    });
    await test('page exit closes analysis; BFCache hide preserves the audible route', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.setAudioAnalysisEnabled(true); h.gesture(); await voice.speak('Fixture'); await tick();
        h.root.dispatchEvent({ type: 'pagehide', persisted: true });
        assert.notEqual(h.contexts[0].state, 'closed');
        h.root.dispatchEvent({ type: 'pagehide', persisted: false });
        assert.equal(h.contexts[0].state, 'closed');
        assert.equal(h.frames.size, 0);
        voice.cancel();
    });
    await test('disabling visuals does not silence or pause routed speech', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.setAudioAnalysisEnabled(true); h.gesture(); await voice.speak('Fixture'); await tick(); h.step(0);
        voice.setAudioAnalysisEnabled(false);
        assert.equal(h.audios[0].paused, false); assert.equal(h.frames.size, 0);
        assert.equal(h.contexts[0].sources[0].disconnected, false);
        assert.equal(h.levels('assistant').at(-1).available, false);
        voice.cancel();
    });
    await test('without an unlocked signal speech stays native and no intensity is invented', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.setAudioAnalysisEnabled(true); await voice.speak('Fixture'); await tick();
        assert.equal(h.contexts.length, 0); assert.equal(h.audios[0].paused, false);
        assert.equal(h.levels('assistant').at(-1).reason, 'signal-unavailable');
        assert.equal(h.levels('assistant').some(level => level.level > 0), false);
        voice.cancel();
    });
    await test('playback errors clear sampling and browser synthesis reports unavailable', async () => {
        const h = harness('voice-service.js'), voice = h.root.GunterVoice;
        voice.setAudioAnalysisEnabled(true); h.gesture(); await voice.speak('Fixture'); await tick(); h.step(0);
        h.audios[0].onerror(); assert.equal(h.frames.size, 0);
        assert.equal(h.levels('assistant').at(-1).active, false);
        const fallback = harness('voice-service.js', { failTTS: true });
        fallback.root.GunterVoice.setAudioAnalysisEnabled(true);
        await fallback.root.GunterVoice.speak('Fixture'); await tick();
        assert.equal(fallback.levels('assistant').at(-1).reason, 'browser-synthesis-signal-unavailable');
        assert.equal(fallback.levels('assistant').at(-1).available, false);
        fallback.root.GunterVoice.cancel();
    });
    await test('microphone metering reuses authorised stream and VAD analyser', async () => {
        const h = harness('voice-activity-service.js'), vad = h.root.GunterVoiceActivity;
        vad.setVisualLevelsEnabled(true); assert.equal(h.permissions(), 0); assert.equal(h.contexts.length, 0);
        await vad.start(h.stream);
        h.step(0); h.step(10); h.step(40);
        const measured = h.levels('microphone').filter(level => level.level > 0);
        assert.equal(measured.length, 2); assert.equal(measured[0].level, 0.25);
        assert.equal(h.contexts.length, 1); assert.equal(h.contexts[0].sources.length, 1);
        assert.equal(h.permissions(), 0); assert.equal(h.contexts[0].analyser.connections.length, 0, 'mic is never played back');
        vad.setVisualLevelsEnabled(false);
        assert.equal(h.stoppedTracks(), 0); assert.equal(vad.getState().active, true);
        assert.equal(h.levels('microphone').at(-1).level, 0);
        const count = h.levels('microphone').length; h.step(80);
        assert.equal(h.levels('microphone').length, count);
        vad.stop(); assert.equal(h.stoppedTracks(), 0, 'shared stream stays owned by capture controller');
    });
    await test('stopping active microphone clears real levels and the sampling frame', async () => {
        const h = harness('voice-activity-service.js'), vad = h.root.GunterVoiceActivity;
        vad.setVisualLevelsEnabled(true); await vad.start(h.stream); h.step(40);
        vad.stop('capture-ended');
        assert.equal(h.frames.size, 0); assert.equal(h.contexts[0].state, 'closed');
        assert.equal(h.levels('microphone').at(-1).active, false);
        assert.equal(h.levels('microphone').at(-1).available, false);
        assert.equal(h.levels('microphone').at(-1).level, 0);
    });
    await test('an ended shared microphone cannot leave a live visual signal', async () => {
        const h = harness('voice-activity-service.js'), vad = h.root.GunterVoiceActivity;
        vad.setVisualLevelsEnabled(true); await vad.start(h.stream); h.step(0);
        h.stream.active = false; h.step(40);
        assert.equal(vad.getState().active, false);
        assert.equal(h.levels('microphone').at(-1).available, false);
        assert.equal(h.frames.size, 0);
        assert.equal(h.stoppedTracks(), 0, 'the owner retains the shared stream');
    });
    console.log(`CORE AUDIO LEVELS: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
