'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-entry-context-'));
process.env.GUNTER_AUTH_DATA_DIR = dataDir;
const auth = require('../server/auth');
const sessions = require('../server/auth/sessions');
const store = require('../server/auth/store');
const { create, moment, nameOf } = require('../js/core/assistant-presence');
const request = cookie => ({ headers: { cookie, 'user-agent': 'entry-test' }, socket: { remoteAddress: '127.0.0.1' } });
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }; };

(async () => {
    const registration = auth.handle('register', 'POST', { username: 'entry-user', password: 'entry-pass-123', displayName: 'Carlos Ruiz' }, request(''));
    const token = registration.headers['Set-Cookie'].match(/gunter_session=([^;]+)/)[1];
    const cookie = 'gunter_session=' + token, user = registration.body.user, session = registration.body.sessionStartedAt;
    const enter = (body, currentCookie = cookie) => auth.handle('entry', 'POST', body, request(currentCookie));
    const first = enter({ op: 'enter', userId: user.id, tabId: 'tab1', pageId: 'page1' }).body;
    assert.equal(first.shouldGreet, true);
    assert.equal(enter({ op: 'enter', tabId: 'tab2', pageId: 'page2' }).body.shouldGreet, false, 'another tab joins the same entry');
    enter({ op: 'leave', tabId: 'tab1', pageId: 'page1', entryId: first.entryId });
    assert.equal(enter({ op: 'enter', tabId: 'tab1', pageId: 'page1next', entryId: first.entryId, continuation: true }).body.shouldGreet, false, 'internal navigation/reload never welcomes again');
    enter({ op: 'leave', tabId: 'tab1', pageId: 'page1next', entryId: first.entryId });
    enter({ op: 'leave', tabId: 'tab2', pageId: 'page2', entryId: first.entryId });
    const returned = enter({ op: 'enter', tabId: 'returned', pageId: 'returned1' }).body;
    assert.equal(returned.shouldGreet, true, 'reopening with the same authentication starts a real entry');
    assert.notEqual(returned.entryId, first.entryId);
    assert.equal(enter({ op: 'pulse', tabId: 'returned', pageId: 'returned1', entryId: returned.entryId }).body.shouldGreet, undefined);
    assert.equal(enter({ op: 'enter', tabId: 'x', pageId: 'x', userId: 'other' }).status, 400);
    assert.equal(enter({ op: 'enter', tabId: 'x', pageId: 'x' }, '').status, 401);
    const pending = auth.handle('register', 'POST', { username: 'pending-entry', password: 'entry-pass-456', displayName: 'María Sol' }, request(''));
    const pendingCookie = pending.headers['Set-Cookie'].split(';')[0];
    assert.equal(enter({ tabId: 'p', pageId: 'p' }, pendingCookie).status, 403);
    store.setStatus(pending.body.user.id, 'approved', user.id);
    assert.equal(enter({ tabId: 'p', pageId: 'p' }, pendingCookie).body.shouldGreet, true, 'approval permits the first welcome');

    // Independent browser contexts share only the existing server session.
    const localStorage = storage();
    const events = new Map(); let generated = 0;
    const environment = (overrides = {}) => {
        const env = { localStorage, sessionStorage: storage(), navigator: {}, document: { referrer: '' }, location: { origin: 'http://gunter.local' },
            performance: { getEntriesByType: () => [{ type: 'navigate' }] },
            GunterAuth: { getUser: () => user, canAccessLocalData: () => true },
            PremiumFeaturesService: { get: key => ({ personalityMode: 'warm', voiceStyle: 'warm', contextualHumor: true })[key], isEnabled: () => true },
            GunterTasksService: { list: async () => [{ ownerId: user.id, status: 'pending' }, { ownerId: 'foreign', status: 'pending', title: 'PRIVATE FOREIGN TASK' }] },
            GunterEventsService: { list: async () => [] },
            GunterNlpLlm: { complete: async (prompt, opts) => { generated++; assert.equal(opts.skipMemory, true); assert.doesNotMatch(prompt, /PRIVATE FOREIGN TASK/); return '¿Te parece que elijamos juntos el siguiente paso?'; } },
            fetch: async (_url, options) => { const result = enter(JSON.parse(options.body)); return { ok: result.status === 200, json: async () => result.body }; },
            addEventListener: (type, fn) => events.set(type, fn), dispatchEvent() {}, CustomEvent: class {}, ...overrides };
        return env;
    };
    enter({ op: 'leave', tabId: 'returned', pageId: 'returned1', entryId: returned.entryId });
    const env1 = environment(), env2 = environment();
    const [welcome, duplicate] = await Promise.all([create(env1).greet(user, session), create(env2).greet(user, session)]);
    assert.ok(welcome.includes('Carlos'));
    assert.match(welcome, /1 tarea pendiente/); assert.doesNotMatch(welcome, /2 tareas/);
    assert.ok(welcome.endsWith('¿Te parece que elijamos juntos el siguiente paso?'));
    assert.equal(duplicate, null); assert.equal(generated, 1);
    assert.equal(await create(env1).greet(user, session), null, 'another component cannot claim an already consumed greeting');
    const nextLogin = auth.handle('login', 'POST', { username: 'entry-user', password: 'entry-pass-123' }, request(''));
    const nextCookie = nextLogin.headers['Set-Cookie'].split(';')[0];
    const disabledEnv = environment({ fetch: async (_url, options) => {
        const result = enter(JSON.parse(options.body), nextCookie);
        return { ok: result.status === 200, json: async () => result.body };
    } });
    disabledEnv.localStorage.setItem('gunter_prefs', JSON.stringify({ entryGreeting: false }));
    const disabledService = create(disabledEnv);
    assert.equal(await disabledService.greet(user, nextLogin.body.sessionStartedAt), null);
    disabledEnv.localStorage.setItem('gunter_prefs', JSON.stringify({ entryGreeting: true }));
    assert.equal(await disabledService.greet(user, nextLogin.body.sessionStartedAt), null, 'enabling later does not replay a suppressed welcome');
    assert.equal(generated, 1);

    const service = create(environment());
    for (const [hour, period] of [[0, 'madrugada'], [4, 'madrugada'], [5, 'mañana'], [12, 'tarde'], [19, 'noche']]) {
        assert.equal(moment(new Date(`2026-10-10T${String(hour).padStart(2, '0')}:00:00Z`), 'UTC').period, period);
    }
    assert.equal(moment(new Date('2026-10-10T15:00:00Z'), 'America/Bogota').hour, 10);
    assert.equal(nameOf({ username: 'someone@example.com', displayName: 'someone@example.com' }), '');
    assert.equal(nameOf({ displayName: 'Carlos Ruiz', preferredName: 'Charlie' }), 'Charlie');
    assert.equal(nameOf({ displayName: 'Carlos Ruiz', preferredName: '' }), '', 'an explicit empty preferred name stays empty');
    for (const text of ['Estoy pasando un duelo', 'Estoy triste por una ruptura', 'Necesito ayuda médica', 'Tengo una emergencia', 'Hay un error en el servidor', 'Explica este algoritmo']) {
        assert.equal(service.communicationPolicy(text).humor, false, text);
        assert.match(service.personalityPrompt(text), /No uses bromas/);
    }
    assert.equal(service.communicationPolicy('Imagina una idea creativa').humor, true);
    const humorOff = create(environment({ PremiumFeaturesService: { isEnabled: () => false, get: () => 'fun' } }));
    assert.match(humorOff.personalityPrompt('Hablemos de mi día'), /No uses bromas/);
    assert.match(humorOff.personalityPrompt('Hablemos de mi día'), /No hagas recomendaciones proactivas/);
    assert.match(service.personalityPrompt('Explícame la historia del teatro'), /temas diversos/);
    assert.match(service.personalityPrompt('¿Qué noticias hay hoy?'), /fuentes\/herramientas realmente disponibles/);
    const crashed = sessions.get(token).appEntry;
    for (const member of Object.values(crashed.tabs)) member.seenAt -= 120001;
    assert.equal(enter({ tabId: 'after_crash', pageId: 'after_crash' }).body.shouldGreet, true, 'expired crashed pages cannot block future entries');

    // Exercise actual companion code for controls missed by the former tests.
    const companion = fs.readFileSync(path.join(__dirname, '../js/services/gunter-companion.js'), 'utf8');
    const refs = companion.slice(companion.indexOf('const REF_PATTERNS ='), companion.indexOf('// Últimos N turnos'));
    const context = { STATE: { lastTopic: { feature: 'wakeWordEnabled' } }, window: { PremiumFeaturesService: { isEnabled: () => false } } };
    vm.runInNewContext(refs + '\nthis.output=resolveAnaphora("apagalo");', context);
    assert.equal(context.output, 'apagalo', 'disabled continuity does not resolve from old context');
    let scheduled = 0;
    const bubbleContext = { STATE: { currentPage: 'day' }, CONTEXTUAL_TIPS: { day: ['tip'] }, window: context.window,
        clearTimeout() {}, setTimeout() { scheduled++; }, showBubble() {} };
    vm.runInNewContext(companion.slice(companion.indexOf('function scheduleContextualBubble()'), companion.indexOf('function showBubble(')) + '\nscheduleContextualBubble();', bubbleContext);
    assert.equal(scheduled, 0, 'disabled recommendations schedule no bubble');
    console.log('ENTRY CONTEXT: persistent login return, reload/navigation, independent tabs, approval, ownership, grounded activities, contextual personality and disabled preferences ✓');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.rmSync(dataDir, { recursive: true, force: true });
});
