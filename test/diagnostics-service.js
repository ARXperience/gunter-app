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
        GunterLogBuffer: { getSummary: () => ({ byLevel: { error: 1, warn: 0 }, latestError: { msg: privateText } }) },
        GunterTraceLogger: { getAll: () => [{ input: privateText, errors: [privateText] }] },
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
    console.log('DIAGNOSTICS: read-only status, privacy, account gate and failure report ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
