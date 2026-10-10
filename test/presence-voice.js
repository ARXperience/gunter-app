const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, composeGreeting } = require('../js/core/assistant-presence');
const { reverse } = require('../server/location');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function runtime() {
    const claims = new Set();
    const env = { localStorage: storage(), sessionStorage: storage(), navigator: {}, dispatchEvent() {}, mockSession: 1,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
    env.fetch = async (_url, options) => {
        const input = JSON.parse(options.body), claim = `${input.userId}:${env.mockSession}`;
        const shouldGreet = !claims.has(claim); claims.add(claim);
        return { ok: true, json: async () => ({ ok: true, entryId: 'entry_' + env.mockSession, shouldGreet }) };
    };
    return env;
}
function voiceRuntime(fetcher, hybrid = null) {
    const audios = [], utterances = [], events = [];
    const window = {
        PremiumFeaturesService: { getVoiceConfig: () => ({ enabled: true, mode: 'live_voice', style: 'warm', speed: 'normal' }) },
        dispatchEvent: event => events.push(event), addEventListener() {}
    };
    if (hybrid) window.GunterRuntimeState = { getState: () => hybrid };
    const speechSynthesis = { getVoices: () => [], speak: u => utterances.push(u), cancel() {} };
    window.speechSynthesis = speechSynthesis;
    class Audio {
        constructor(url) { this.url = url; this.played = false; this.paused = false; audios.push(this); }
        addEventListener() {}
        async play() { this.played = true; }
        pause() { this.paused = true; }
    }
    const sandbox = { window, document: { addEventListener() {} }, fetch: fetcher, Audio, speechSynthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, AbortController, setTimeout, clearTimeout, console: { warn() {} },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/voice-service.js'), 'utf8'), sandbox);
    return { voice: window.GunterVoice, window, audios, utterances, events };
}
(async () => {
    console.log('GUNTER PRESENCE AND VOICE');
    await test('saludo usa el nombre de la cuenta y límites reales de mañana, tarde y noche', () => {
        for (const [hour, salutation] of [[4, 'Buena madrugada'], [5, 'Buenos días'], [11, 'Buenos días'], [12, 'Buenas tardes'], [18, 'Buenas tardes'], [19, 'Buenas noches']]) {
            const text = composeGreeting({ user: { displayName: 'Andrea' }, now: new Date(`2026-10-04T${String(hour).padStart(2, '0')}:15:00Z`), timezone: 'UTC' });
            assert.ok(text.startsWith(salutation + ', Andrea.'));
        }
        assert.doesNotMatch(composeGreeting({ user: { username: 'ana' }, timezone: 'UTC' }), /, ana\./);
    });
    await test('la zona horaria cambia la hora y el saludo, no inventa la ciudad', () => {
        const text = composeGreeting({ user: { username: 'ana' }, now: new Date('2026-10-04T16:30:00Z'), timezone: 'America/Bogota' });
        assert.match(text, /^Buenos días/); assert.match(text, /11:30/);
        assert.doesNotMatch(text, /Estás en Bogotá/); assert.match(text, /domingo/);
    });
    await test('distingue ubicación actual, manual y desactualizada', () => {
        assert.match(composeGreeting({ location: { city: 'Cali', source: 'device' } }), /Estás en Cali/);
        assert.match(composeGreeting({ location: { city: 'Cali', source: 'manual' } }), /ciudad configurada es Cali/);
        assert.match(composeGreeting({ location: { city: 'Cali', source: 'stored' } }), /última ciudad confirmada fue Cali/);
    });
    await test('varía el cierre y respeta el modo elegido', () => {
        const variants = [0, 1, 2].map(index => composeGreeting({ mode: 'direct', index }));
        assert.equal(new Set(variants).size, 3); assert.match(variants[0], /Qué hacemos primero/);
        assert.match(composeGreeting({ mode: 'strategic' }), /objetivo priorizamos/);
    });
    await test('un solo saludo después de login real, no al recargar ni cambiar de página', async () => {
        const env = runtime(), service = create(env), user = { id: 'u1', displayName: 'Andrea' };
        const [first, duplicate] = await Promise.all([service.greet(user, 'session-1'), service.greet(user, 'session-1')]);
        assert.ok(first); assert.equal(duplicate, null);
        assert.equal(await create(env).greet(user, 'session-1'), null);
        env.mockSession = 2;
        assert.notEqual(await service.greet(user, 'session-2'), first);
        env.mockSession = 3;
        assert.match(await service.greet({ id: 'u2', displayName: 'Luis', preferredName: 'Luis' }, 'session-3'), /Luis/);
        env.mockSession = 4;
        assert.equal(await service.greet(user, 'session-4', { enabled: false }), null);
        assert.equal(await service.greet(user, 'session-4'), null, 'enabling greeting later must not replay the old login');
    });
    await test('no pide geolocalización sin permiso previo ni infiere residencia', async () => {
        const env = runtime(); let calls = 0;
        env.navigator.geolocation = { getCurrentPosition() { calls++; } };
        const service = create(env);
        await service.greet({ id: 'u1' }, 'session-1'); assert.equal(calls, 0);
        service.savePreferences({ city: 'Medellín', locationSource: 'device', locationUpdatedAt: 1, useDeviceLocation: true });
        assert.equal((await service.location()).source, 'stored'); assert.equal(calls, 0);
    });
    await test('ubicación autorizada guarda solo ciudad y no coordenadas', async () => {
        const env = runtime(); let request;
        env.navigator.geolocation = { getCurrentPosition: resolve => resolve({ coords: { latitude: 4.7, longitude: -74.1 } }) };
        env.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ city: 'Bogotá' }) }; };
        const service = create(env), prefs = await service.useLocation();
        assert.equal(prefs.city, 'Bogotá'); assert.equal((await service.location()).source, 'device');
        assert.ok(request.url.endsWith('/api/location/reverse'));
        assert.doesNotMatch(env.localStorage.getItem('gunter_prefs'), /latitude|longitude|4\.7/);
    });
    await test('la personalidad manual se aplica aun con voz y adaptación apagadas', () => {
        const env = runtime(); env.PremiumFeaturesService = { get: key => ({ personalityMode: 'coach', voiceStyle: 'warm', personalityIntensity: 'soft', voiceEnabled: false, adaptivePersonality: false })[key] };
        assert.match(create(env).personalityPrompt(), /Motivador y paciente/);
        assert.match(create(env).personalityPrompt(), /Cálido y cercano/);
    });
    await test('geocodificación valida, reduce precisión y cachea sin guardar direcciones', async () => {
        await assert.rejects(reverse({ latitude: 91, longitude: 0 }), /invalid_coordinates/);
        let calls = 0;
        const fetcher = async (url, options) => {
            calls++; assert.equal(url.searchParams.get('lat'), '4.712'); assert.match(options.headers['User-Agent'], /Gunter/);
            return { ok: true, json: async () => ({ address: { city: 'Bogotá', road: 'Privada', house_number: '99' } }) };
        };
        const result = await reverse({ latitude: 4.712345, longitude: -74.123456 }, fetcher);
        assert.equal(result.city, 'Bogotá'); assert.equal(result.road, undefined);
        await reverse({ latitude: 4.712345, longitude: -74.123456 }, fetcher); assert.equal(calls, 1);
    });
    await test('interrumpir cancela la síntesis pendiente y nunca reproduce audio tardío', async () => {
        let resolveFetch, signal;
        const setup = voiceRuntime((url, opts) => { signal = opts.signal; return new Promise(resolve => { resolveFetch = resolve; }); });
        setup.voice.speak('Respuesta antigua'); await tick();
        assert.equal(setup.voice.isLikelyEcho('Respuesta antigua'), false);
        setup.voice.cancel(); assert.equal(signal.aborted, true);
        resolveFetch({ ok: true, blob: async () => ({}) }); await tick(); await tick();
        assert.equal(setup.audios.length, 0); assert.equal(setup.utterances.length, 0); assert.equal(setup.voice.isSpeaking(), false);
    });
    await test('audio interrumpido y sus callbacks no avanzan la nueva cola', async () => {
        const setup = voiceRuntime(async () => ({ ok: true, blob: async () => ({}) }));
        setup.voice.speak('Anterior'); await tick();
        const previous = setup.audios[0], oldEnd = previous.onended;
        setup.voice.cancel(); setup.voice.speak('Nueva'); await tick(); oldEnd();
        assert.equal(previous.paused, true); assert.equal(setup.audios.length, 2); assert.equal(setup.voice.isSpeaking(), true);
        setup.voice.cancel();
    });
    await test('si TTS falla usa voz local y la interrupción cancela esa voz', async () => {
        const setup = voiceRuntime(async () => { throw new Error('offline'); });
        setup.voice.speak('Hola Andrea'); await tick(); assert.equal(setup.utterances[0].text, 'Hola Andrea');
        assert.equal(setup.voice.isLikelyEcho('Hola Andrea'), true);
        setup.voice.cancel(); assert.equal(setup.utterances[0].onend, null); assert.equal(setup.voice.isSpeaking(), false);
    });
    await test('respuesta larga inicia con un segmento breve y prepara el siguiente mientras habla', async () => {
        const requests = [];
        const setup = voiceRuntime(async (url, options) => {
            requests.push({ text: JSON.parse(options.body).text, signal: options.signal });
            return { ok: true, blob: async () => ({}) };
        });
        setup.voice.speak('Buenos días. Revisé tu agenda y encontré tres asuntos importantes para hoy. La reunión empieza a las diez y media. Después podemos organizar un plan breve para terminar las tareas prioritarias.');
        await tick(); await tick(); await tick();
        assert.ok(requests.length >= 2);
        assert.ok(requests[0].text.length <= 90);
        assert.equal(setup.audios.length, 1);
        setup.voice.cancel();
        assert.equal(requests[1].signal.aborted, true);
    });
    await test('LOCAL_ONLY no cambia en silencio a una voz de respaldo', async () => {
        const setup = voiceRuntime(async () => { throw new Error('offline'); }, { mode: 'AUTO', privacy: 'LOCAL_ONLY' });
        setup.voice.speak('Hola Andrea'); await tick();
        assert.equal(setup.utterances.length, 0);
        assert.equal(setup.voice.isSpeaking(), false);
    });
    await test('bienvenida por voz apagada no reproduce ni solicita síntesis', async () => {
        let calls = 0;
        const setup = voiceRuntime(async () => { calls++; throw new Error('unexpected'); });
        setup.window.PremiumFeaturesService.isEnabled = key => key !== 'entryVoiceGreeting';
        await setup.voice.speak('Buenos días, Carlos.', { context: 'entry' }); await tick();
        assert.equal(calls, 0);
        assert.equal(setup.audios.length, 0); assert.equal(setup.utterances.length, 0);
        await setup.voice.speak('Una respuesta del chat.', { context: 'chat' }); await tick();
        assert.equal(calls, 1, 'turning off welcome audio does not turn off conversation voice');
        setup.voice.cancel();
    });
    console.log(`═══ PRESENCE / VOICE: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error); process.exitCode = 1; });
