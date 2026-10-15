const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tick = () => new Promise(resolve => setImmediate(resolve));
const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};
const timer = (fn, ms) => { const id = setTimeout(fn, ms); id.unref(); return id; };

function harness(overrides = {}, options = {}) {
    const config = { enabled: true, mode: 'live_voice', style: 'warm', speed: 'normal', inMeetings: false,
        onlyAfterWakeWord: false, wakeWordResponseMode: 'voice', ...overrides };
    const events = [], handlers = new Map(), audios = [], requests = [], utterances = [], blobs = new Map(), nodes = new Map();
    const classList = () => ({ add() {}, remove() {}, contains: () => false });
    function element() {
        return { classList: classList(), innerHTML: '', value: '', hidden: false, textContent: '', scrollHeight: 0,
            addEventListener() {}, setAttribute() {}, appendChild() {}, remove() {}, focus() {},
            querySelector: selector => selector === '.gn-comp__typing' ? null : node(selector.replace(/^#/, '')),
            querySelectorAll: () => [] };
    }
    function node(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
    const localStorage = storage();
    const root = {
        PremiumFeaturesService: {
            getVoiceConfig: () => config,
            getWakeWordConfig: () => ({ responseMode: config.wakeWordResponseMode ?? options.legacyWakeMode ?? 'voice' }),
            isEnabled: key => key === 'entryVoiceGreeting' ? options.entryGreeting !== false : false
        },
        GunterRuntimeState: { getState: () => ({ mode: 'LOCAL', privacy: 'LOCAL_ONLY', ...options.runtime }) },
        dispatchEvent(event) { events.push(event); (handlers.get(event.type) || []).forEach(listener => listener(event)); },
        addEventListener(type, listener) { handlers.set(type, [...(handlers.get(type) || []), listener]); },
        location: { pathname: '/dashboard.html', assign() {} }
    };
    const speechSynthesis = { getVoices: () => [], speak: value => utterances.push(value), cancel() {} };
    root.speechSynthesis = speechSynthesis;
    class Audio {
        constructor(url) { this.text = blobs.get(url).text; this.paused = true; this.ended = false; audios.push(this); }
        addEventListener() {}
        async play() { if (options.playError) throw options.playError; this.paused = false; }
        pause() { this.paused = true; }
        finish() { this.ended = true; this.paused = true; this.onended?.(); }
    }
    const document = { readyState: 'loading', body: { classList: classList(), appendChild() {} }, hidden: false,
        createElement: element, addEventListener() {}, querySelectorAll: () => [], getElementById: node };
    const sandbox = {
        window: root, document, navigator: {}, location: root.location, localStorage,
        fetch: async (url, init) => {
            if (url !== '/api/tts') return { ok: true, json: async () => ({ data: { hits: [] } }) };
            const body = JSON.parse(init.body); requests.push({ ...body, signal: init.signal });
            if (options.fetcher) return options.fetcher(url, init);
            return { ok: true, blob: async () => ({ text: body.text }) };
        },
        Audio, speechSynthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        URL: { createObjectURL(blob) { const url = 'blob:' + blobs.size; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        AbortController, setTimeout: timer, clearTimeout,
        setInterval(fn, ms) { const id = setInterval(fn, ms); id.unref(); return id; },
        performance, console: { warn() {}, info() {} }
    };
    const context = vm.createContext(sandbox);
    function load(file) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/services', file), 'utf8'), context); }
    const features = root.PremiumFeaturesService;
    if (options.lateFeatures) delete root.PremiumFeaturesService;
    load('voice-service.js');
    if (options.lateFeatures) root.PremiumFeaturesService = features;
    return { config, root, voice: root.GunterVoice, events, audios, requests, utterances, localStorage, nodes,
        companion() { load('gunter-companion.js'); return root.GunterCompanion; },
        change(key, value) {
            config[key === 'voiceEnabled' ? 'enabled' : key === 'voiceMode' ? 'mode' : key] = value;
            root.dispatchEvent({ type: 'gunterPremiumFeaturesChange', detail: { key, value } });
        } };
}

async function finishPlayback(h) {
    for (let attempts = 0; h.voice.isSpeaking() && attempts < 200; attempts++) {
        await tick(); await tick();
        h.audios.find(audio => !audio.ended && !audio.paused)?.finish();
    }
    assert.equal(h.voice.isSpeaking(), false, 'the complete audio queue drains');
    return h.audios.map(audio => audio.text).join(' ');
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
(async () => {
    await test('one policy applies voice, wake-word, meeting and greeting preferences', () => {
        const h = harness();
        assert.equal(h.voice.shouldSpeak('chat'), true);
        h.config.mode = 'notifications_only';
        assert.equal(h.voice.shouldSpeak('chat'), false);
        assert.equal(h.voice.shouldSpeak('notification'), true);
        h.config.mode = 'wake_word_only';
        assert.equal(h.voice.shouldSpeak('chat'), false);
        assert.equal(h.voice.shouldSpeak('wake-word-response'), true);
        assert.equal(h.voice.shouldSpeak('wake-word-feedback'), true);
        h.config.wakeWordResponseMode = 'text';
        assert.equal(h.voice.shouldSpeak('wake-word-response'), false);
        assert.equal(h.voice.shouldSpeak('wake-word-feedback'), false);
        h.config.mode = 'live_voice';
        assert.equal(h.voice.shouldSpeak('chat'), true);
        h.voice.setMeetingActive(true);
        assert.equal(h.voice.shouldSpeak('chat'), false);
        assert.equal(h.voice.shouldSpeak('notification'), true);
        h.config.inMeetings = true;
        assert.equal(h.voice.shouldSpeak('chat'), true);
        assert.equal(harness({}, { entryGreeting: false }).voice.shouldSpeak('entry'), false);
        assert.equal(harness({ wakeWordResponseMode: undefined }, { legacyWakeMode: 'text' }).voice.shouldSpeak('wake-word-response'), false);
    });
    await test('force and streaming cannot override explicit voice-off or text-only wake replies', async () => {
        for (const config of [{ enabled: false }, { mode: 'text_only' }, { wakeWordResponseMode: 'text' }]) {
            const h = harness(config);
            await h.voice.speak('Debe conservarse solamente como texto.', { context: 'wake-word-response', force: true });
            const stream = h.voice.beginStream({ context: 'wake-word-response', force: true });
            stream.append('Una respuesta por streaming que debe quedar escrita.'); stream.finish();
            await tick();
            assert.equal(stream.enabled, false);
            assert.equal(h.requests.length, 0);
            assert.equal(h.utterances.length, 0);
        }
    });
    await test('long complete chat and wake replies are spoken through their final sentence', async () => {
        const text = Array.from({ length: 12 }, (_, i) => `La explicación número ${i + 1} contiene el detalle solicitado y conserva toda la respuesta.`).join(' ');
        for (const context of ['chat', 'wake-word-response']) {
            const h = harness();
            await h.voice.speak(text, { context });
            assert.equal(await finishPlayback(h), text);
            assert.ok(h.requests.every(request => request.text.length <= 90));
        }
    });
    await test('streaming and completed answers share the same complete spoken content', async () => {
        const h = harness(), text = 'Primera parte de la respuesta que explica la decisión. ' + 'El resto del contenido conserva todos sus detalles. '.repeat(15);
        const stream = h.voice.beginStream({ context: 'chat' });
        for (let start = 0; start < text.length; start += 17) stream.append(text.slice(start, start + 17));
        stream.finish();
        assert.equal(await finishPlayback(h), text.trim());
    });
    await test('disabling voice cancels synthesis and pending stream segments without late playback', async () => {
        let resolveFetch;
        const h = harness({}, { fetcher: () => new Promise(resolve => { resolveFetch = resolve; }) });
        const stream = h.voice.beginStream();
        stream.append('Esta respuesta ya estaba generando un segmento por voz.');
        h.change('voiceEnabled', false);
        assert.equal(h.requests[0].signal.aborted, true);
        stream.append('Este contenido posterior no debe sintetizarse.'); stream.finish();
        resolveFetch({ ok: true, blob: async () => ({ text: 'audio anterior' }) });
        await tick(); await tick();
        assert.equal(h.requests.length, 1); assert.equal(h.audios.length, 0);
        assert.equal(h.voice.isSpeaking(), false);
    });
    await test('unrelated bulk preferences and unchanged voice settings preserve the complete ongoing reply', async () => {
        const h = harness(), stream = h.voice.beginStream();
        const first = 'La primera parte ya está sonando y debe continuar.';
        const rest = 'El resto de la respuesta también debe reproducirse completo.';
        stream.append(first + ' '); await tick();
        const audio = h.audios[0];
        h.config.style = 'professional';
        h.config.conversationMemory = true;
        h.config.coreVisualIntensity = 0.4;
        h.root.dispatchEvent({ type: 'gunterPremiumFeaturesChange', detail: { key: null } });
        h.change('voiceEnabled', true);
        assert.equal(audio.paused, false);
        assert.equal(h.requests[0].signal.aborted, false);
        stream.append(rest); stream.finish();
        assert.equal(await finishPlayback(h), first + ' ' + rest);
    });
    await test('a bulk change to the actual voice policy still cancels playback and the remaining stream', async () => {
        const h = harness(), stream = h.voice.beginStream();
        stream.append('Una respuesta que ya estaba sonando antes del cambio.'); await tick();
        h.config.mode = 'text_only';
        h.root.dispatchEvent({ type: 'gunterPremiumFeaturesChange', detail: { key: null } });
        stream.append('Este segmento ya no debe sonar.'); stream.finish();
        assert.equal(h.audios[0].paused, true);
        assert.equal(h.voice.isSpeaking(), false);
        assert.equal(h.voice.getPlaybackState().queued, 0);
    });
    await test('features loaded after the voice service establish a fresh baseline for direct and streamed replies', async () => {
        for (const streamed of [false, true]) {
            const h = harness({}, { lateFeatures: true });
            const text = 'La respuesta continúa aunque las preferencias se hayan cargado después del servicio de voz.';
            let stream;
            if (streamed) stream = h.voice.beginStream();
            else await h.voice.speak(text);
            h.config.style = 'professional';
            h.root.dispatchEvent({ type: 'gunterPremiumFeaturesChange', detail: { key: null } });
            if (streamed) { stream.append(text); stream.finish(); }
            assert.equal(await finishPlayback(h), text);
        }
    });
    await test('text-only wake streaming still stores and displays the complete assistant answer', async () => {
        const h = harness({ wakeWordResponseMode: 'text' });
        const text = 'Esta respuesta queda en el chat, aunque la petición haya llegado por voz.';
        h.root.GunterNlpLlm = { complete: async () => text, async *stream() { yield text.slice(0, 27); yield text.slice(27); } };
        await h.companion().__handleFromWake('Explícame cómo trabajas');
        await tick();
        const log = JSON.parse(h.localStorage.getItem('gunter_companion_log'));
        assert.equal(log.at(-1).role, 'assistant'); assert.equal(log.at(-1).text, text);
        assert.match(h.nodes.get('gn-comp-log').innerHTML, /Esta respuesta queda en el chat/);
        assert.equal(h.nodes.get('gn-comp-status').textContent, 'Tu asistente');
        assert.equal(h.requests.length, 0); assert.equal(h.utterances.length, 0);
    });
    await test('local TTS failure retains a visible error and does not retry every segment or fall back', async () => {
        const h = harness({}, { fetcher: async () => { throw Object.assign(new Error('offline'), { code: 'LOCAL_TTS_UNAVAILABLE' }); } });
        const companion = h.companion();
        companion.say('La respuesta completa sigue disponible en pantalla. '.repeat(15));
        await tick(); await tick();
        assert.equal(h.requests.length, 1); assert.equal(h.utterances.length, 0);
        assert.equal(h.voice.getPlaybackState().error.code, 'LOCAL_TTS_UNAVAILABLE');
        assert.equal(h.voice.getPlaybackState().queued, 0);
        assert.match(h.localStorage.getItem('gunter_companion_log'), /respuesta completa/);
        assert.equal(h.events.filter(event => event.type === 'gunter-voice-state').at(-1).detail.state, 'unavailable');
    });
    await test('autoplay failure is explicit and a successful user retry clears its status', async () => {
        const playError = Object.assign(new Error('gesture required'), { name: 'NotAllowedError' });
        const options = { playError }, h = harness({}, options);
        await h.voice.speak('Respuesta pendiente de permiso para reproducir.'); await tick(); await tick();
        assert.equal(h.voice.getPlaybackState().error.code, 'VOICE_PLAYBACK_BLOCKED');
        assert.equal(h.utterances.length, 0); assert.equal(h.voice.isSpeaking(), false);
        options.playError = null;
        await h.voice.speak('Nuevo intento explícito.'); await tick();
        assert.equal(h.voice.getPlaybackState().error, null);
        await finishPlayback(h);
    });
    await test('a media decoding error is reported and starting a muted meeting cancels existing playback', async () => {
        const h = harness();
        await h.voice.speak('Respuesta con un audio que no se puede decodificar.'); await tick();
        h.audios[0].onerror();
        assert.equal(h.voice.getPlaybackState().error.code, 'LOCAL_TTS_PLAYBACK_FAILED');
        assert.equal(h.voice.isSpeaking(), false); assert.equal(h.utterances.length, 0);
        await h.voice.speak('Esta conversación se detiene al iniciar una reunión.'); await tick();
        h.voice.setMeetingActive(true);
        assert.equal(h.voice.isSpeaking(), false); assert.equal(h.audios.at(-1).paused, true);
    });
    console.log(`VOICE REPLY POLICY: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
