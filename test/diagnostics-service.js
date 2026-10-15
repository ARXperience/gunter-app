'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
    const privateText = 'TOKEN_PRIVADO_123';
    let fetches = 0;
    const context = {
        navigator: {
            mediaDevices: { getUserMedia() {} },
            permissions: { async query() { return { state: 'granted' }; } }
        },
        fetch: async () => { fetches++; return { ok: true, json: async () => ({ logs: { errors: 2, warnings: 1 } }) }; },
        GunterAuth: { getUser: () => ({ id: 'ordinary-user', role: 'user' }) },
        GunterRuntimeState: { getState: () => ({ loaded: true, privacy: 'LOCAL_ONLY', mode: 'LOCAL',
            backendAvailable: true, localSTTAvailable: true, localBrainAvailable: false,
            localBrainInstalled: false, localTTSAvailable: true }) },
        GunterLogBuffer: { getDiagnosticSummary: () => ({ available: true, byLevel: { error: 1, warn: 0 }, evidence: [{ at: new Date().toISOString(), codes: ['LOCAL_TTS_BUSY'] }] }) },
        GunterTraceLogger: { getDiagnosticSummary: () => ({ available: true, total: 1, errors: 1 }), getAll: () => { throw new Error('Do not read raw traces'); } },
        GunterAssistantTools: { listTools: () => [{ name: 'test' }] },
        GunterWakeWord: { getState: () => ({ active: false }) }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/services/diagnostics-service.js'), 'utf8'), context);
    for (const phrase of ['Revisa tus errores', '¿Qué pasó?', 'Muéstrame el log', '¿Qué está pasando?']) {
        assert.equal(context.GunterDiagnostics.recognizes(phrase), true, phrase);
        const answer = await context.GunterDiagnostics.answer(phrase);
        assert.ok(answer.includes('LOCAL_ONLY/LOCAL'));
        assert.ok(answer.includes('NO DISPONIBLE'));
        assert.ok(!answer.includes(privateText), 'diagnostic must never expose raw log or trace text');
    }
    assert.equal(fetches, 0, 'ordinary user must not request global server logs');
    context.GunterAuth.getUser = () => ({ id: 'admin-user', role: 'admin' });
    const adminAnswer = await context.GunterDiagnostics.answer('diagnóstico');
    assert.ok(adminAnswer.includes('2 errores y 1 advertencias'));
    assert.equal(fetches, 1);

    context.PremiumFeaturesService = {
        getVoiceConfig: () => ({ enabled: true, mode: 'live_voice', effectiveMode: 'wake_word_only', onlyAfterWakeWord: true, wakeWordResponseMode: 'text' }),
        getWakeWordConfig: () => ({ enabled: true, listeningMode: 'manual' })
    };
    context.GunterVoice = { getPlaybackState: () => ({ speaking: false, pending: false, text: privateText, error: { code: 'VOICE_PLAYBACK_BLOCKED', message: privateText } }) };
    const voiceAnswer = await context.GunterDiagnostics.answer('¿Por qué no me hablas?');
    assert.match(voiceAnswer, /activación por nombre.*solo con texto/);
    assert.match(voiceAnswer, /navegador bloqueó/);
    assert.match(voiceAnswer, /Probar voz/);
    assert.ok(!voiceAnswer.includes(privateText));
    const micAnswer = await context.GunterDiagnostics.answer('¿Por qué no me escuchas?');
    assert.match(micAnswer, /Manual/);
    assert.match(micAnswer, /selecciona Continuo/);
    assert.ok(!micAnswer.includes('Micrófono: FUNCIONANDO'), 'permission is not actual capture');
    for (const text of ['la herramiena te que gunter me escucha no esta funcionando a que se debe?', 'no me oye', 'no me está escuchando', 'el micrófono dejó de funcionar']) {
        assert.equal(context.GunterDiagnostics.recognizes(text), true, text);
        const reply = await context.GunterDiagnostics.answer(text);
        assert.match(reply, /Micrófono: INACTIVO.*Manual/, text);
        assert.ok(!reply.includes('Preferencia de voz:'), 'listening failures must focus on input, not voice output');
    }
    for (const text of ['no me está hablando', 'no se oye', 'la voz no está funcionando']) {
        assert.equal(context.GunterDiagnostics.recognizes(text), true, text);
        assert.match(await context.GunterDiagnostics.answer(text), /Preferencia de voz: RESTRINGIDO/, text);
    }
    for (const text of ['no me responde', 'Gunter dejó de funcionar']) {
        assert.equal(context.GunterDiagnostics.recognizes(text), true, text);
        assert.match(await context.GunterDiagnostics.answer(text), /Conexión al servidor:/, text);
    }
    context.GunterVoice.getPlaybackState = () => ({ error: { code: privateText, message: privateText } });
    assert.match(await context.GunterDiagnostics.answer('voz no funciona'), /sin un código reconocido/);
    assert.ok(!(await context.GunterDiagnostics.answer('voz no funciona')).includes(privateText));
    context.PremiumFeaturesService.getVoiceConfig = () => ({ enabled: false, effectiveMode: 'text_only' });
    assert.match(await context.GunterDiagnostics.answer('no me hablas'), /configuración responde solo con texto/);
    assert.equal(context.GunterDiagnostics.recognizes('¿Para qué sirve la voz?'), false, 'settings explanations are not failures');
    for (const text of ['activa diagnóstico', 'Desactiva diagnóstico de Gunter', 'Configura logs', 'Por favor habilita diagnóstico',
        'Hi Gunter, activa diagnóstico', 'crea una tarea llamada el micrófono no está funcionando', 'envía el mensaje no se oye'])
        assert.equal(context.GunterDiagnostics.recognizes(text), false, 'settings mutations are not read-only diagnostics');
    context.navigator.permissions.query = async () => {
        context.GunterAuth.getUser = () => ({ id: 'new-account', role: 'user' });
        return { state: 'granted' };
    };
    assert.match(await context.GunterDiagnostics.answer('Revisa tus errores'), /cuenta cambió durante el diagnóstico/);

    // Exercise the real log/trace buffers with two accounts plus unowned legacy rows.
    let user = null;
    const stored = new Map();
    const logged = [];
    const buffers = {
        console: Object.fromEntries(['error', 'warn', 'info', 'log'].map(level => [level, (...args) => logged.push(args)])),
        GunterAuth: { getUser: () => user },
        location: { pathname: '/config.html', search: '' },
        performance: { now: () => 1 },
        addEventListener() {},
        localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }
    };
    buffers.window = buffers;
    vm.createContext(buffers);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/services/log-buffer.js'), 'utf8'), buffers);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/core/trace-logger.js'), 'utf8'), buffers);
    buffers.console.error('LOCAL_TTS_UNAVAILABLE unowned ' + privateText);
    user = { id: 'first' };
    buffers.console.error('LOCAL_TTS_UNAVAILABLE https://private.example/' + privateText);
    buffers.GunterTraceLogger.persist({ input: { text: privateText, userContext: { identity: { userId: 'first' } } }, trace: [], errors: [privateText] });
    user = { id: 'second' };
    buffers.console.warn('VOICE_PLAYBACK_BLOCKED ' + privateText);
    buffers.GunterTraceLogger.persist({ input: { text: privateText, userContext: { identity: { userId: 'second' } } }, trace: [], errors: [] });
    buffers.GunterTraceLogger.persist({ input: { text: privateText, userContext: { identity: { userId: 'first' } } }, trace: [], errors: [privateText] });
    const safe = buffers.GunterLogBuffer.getDiagnosticSummary({ codes: ['LOCAL_TTS_UNAVAILABLE', 'VOICE_PLAYBACK_BLOCKED'] });
    assert.equal(safe.byLevel.error, 0);
    assert.equal(safe.byLevel.warn, 1);
    assert.equal(safe.evidence[0].codes[0], 'VOICE_PLAYBACK_BLOCKED');
    assert.ok(!JSON.stringify(safe).includes(privateText));
    assert.ok(!JSON.stringify(safe).includes('https://'));
    assert.equal(buffers.GunterTraceLogger.getDiagnosticSummary().total, 1);
    assert.equal(buffers.GunterTraceLogger.getDiagnosticSummary().errors, 0);
    stored.set('gunter_device_user', 'first');
    assert.equal(buffers.GunterLogBuffer.getDiagnosticSummary().available, false, 'stale tab cannot inspect another active device account');
    assert.equal(buffers.GunterTraceLogger.getDiagnosticSummary().available, false);
    stored.delete('gunter_device_user');
    user = null;
    assert.equal(buffers.GunterLogBuffer.getDiagnosticSummary().available, false);
    assert.equal(buffers.GunterTraceLogger.getDiagnosticSummary().total, 0);
    console.log('DIAGNOSTICS: grounded voice/mic causes, local privacy, owner-scoped safe log/trace evidence ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
