/* Conversational reminder capture: real local time parser, isolated in-memory jobs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');

const NOW = '2026-10-15T14:00:00.000Z'; // 09:00 in Bogotá.
const TODAY_ELEVEN = '2026-10-15T11:00:00-05:00';
const TOMORROW_ELEVEN = '2026-10-16T11:00:00-05:00';
const ALARM_REQUEST = 'activa una alarma para hacer ejercicio a las 11 de la mañana';
const DATE_FIRST_REQUEST = 'Quiero un recordatorio para mañana para hacer ejercicio un recordatorio';
const clone = value => JSON.parse(JSON.stringify(value));

function makeHarness(options = {}) {
    let userId = 'alice', deviceOwner = 'alice', trusted = true;
    let currentTime = new Date(options.now || NOW), continuity = options.continuity !== false;
    const stored = new Map(), rows = [], creates = [], reads = [];
    const parserRuntime = { window: {}, Date, Intl };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/time-parser.js'), 'utf8'),
        parserRuntime, { filename: 'js/core/time-parser.js' });
    // No NLP or network model is present: ordinary Spanish capture must work locally.
    const jobs = {
        scheduleReminder: async data => {
            assert.ok(trusted && userId && deviceOwner === userId, 'a write requires the verified current account');
            const row = { ...clone(data), id: `reminder_${rows.length + 1}`, ownerId: userId,
                type: 'reminder', status: 'scheduled', createdAt: currentTime.toISOString() };
            creates.push({ ...clone(data), actorId: userId });
            rows.push(row);
            return clone(row);
        },
        get: async id => {
            reads.push({ id, actorId: userId });
            return clone(rows.find(row => row.id === id && row.ownerId === userId) || null);
        },
        list: async () => clone(rows.filter(row => row.ownerId === userId))
    };
    const toolset = assistant.create({ root: {
        GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null },
        localStorage: { getItem: key => key === 'gunter_device_user' ? deviceOwner : null },
        PremiumFeaturesService: { isEnabled: key => key === 'conversationContinuity' ? continuity : true }
    }, jobsService: jobs, timeParser: options.timeParser || parserRuntime.window.GunterTimeParser,
    storage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key) },
    now: () => new Date(currentTime), timezone: () => 'America/Bogota' });
    return { toolset, creates, rows, reads, stored,
        setUser: value => { userId = value; deviceOwner = value; },
        setDeviceOwner: value => { deviceOwner = value; },
        setTrusted: value => { trusted = value; },
        setContinuity: value => { continuity = value; },
        advance: milliseconds => { currentTime = new Date(currentTime.getTime() + milliseconds); } };
}

function assertSaved(h, expectedTime, title = 'hacer ejercicio') {
    assert.equal(h.creates.length, 1);
    assert.equal(h.creates[0].title, title, 'only the requested activity is the reminder title');
    assert.equal(Date.parse(h.creates[0].runAt), Date.parse(expectedTime));
    assert.equal(h.creates[0].actorId, 'alice');
    assert.ok(h.reads.some(row => row.id === h.rows[0].id && row.actorId === 'alice'),
        'completion must verify the persisted job, not only acknowledge a proposal');
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('the exact alarm request becomes a verified Gunter reminder, not an operating-system alarm', async () => {
    const h = makeHarness();
    const detected = h.toolset.detect(ALARM_REQUEST);
    assert.equal(detected?.toolId, 'reminder.schedule');
    const result = await h.toolset.dispatch(ALARM_REQUEST);
    assert.equal(result.intent, 'reminder.schedule');
    assert.equal(result.status, 'complete', result.reply);
    assert.equal(result.verified, true);
    assertSaved(h, TODAY_ELEVEN);
    assert.match(result.reply, /recordatorio|aviso/i);
    assert.match(result.reply, /no (?:es|cre[ée]|activa|program[ée]).{0,40}alarma|alarma.{0,40}(?:nativa|sistema|dispositivo)/i,
        'alarm terminology must not imply that Gunter created a native alarm');
});

test('date-first dictation retains its activity, asks for time and completes in the next turn', async () => {
    const h = makeHarness();
    const requested = await h.toolset.dispatch(DATE_FIRST_REQUEST);
    assert.equal(requested.intent, 'reminder.schedule');
    assert.equal(requested.status, 'needs_input', requested.reply);
    assert.match(requested.reply, /hora|cu[aá]ndo/i);
    assert.equal(h.creates.length, 0, 'tomorrow without a time must not silently become 09:00');
    assert.equal(h.toolset.getPending()?.stage, 'collecting');
    assert.equal(h.toolset.isContextualFollowUp('a las 11 de la mañana'), true);
    const completed = await h.toolset.dispatch('a las 11 de la mañana');
    assert.equal(completed.status, 'complete', completed.reply);
    assert.equal(completed.verified, true);
    assertSaved(h, TOMORROW_ELEVEN);
    assert.equal(h.toolset.getPending(), null);
});

test('tomorrow plus a morning time is parsed locally as tomorrow, not today', async () => {
    const h = makeHarness();
    const result = await h.toolset.dispatch('pon una alarma para hacer ejercicio mañana a las 11 de la mañana');
    assert.equal(result.status, 'complete', result.reply);
    assertSaved(h, TOMORROW_ELEVEN);
});

test('voice capture and a spoken yes never bypass written confirmation', async () => {
    const h = makeHarness();
    const proposed = await h.toolset.dispatch(ALARM_REQUEST, { inputSource: 'voice' });
    assert.equal(proposed.intent, 'reminder.schedule');
    assert.equal(proposed.status, 'awaiting_confirmation', proposed.reply);
    assert.equal(proposed.requiresConfirmation, true);
    assert.match(proposed.reply, /por escrito|pantalla/i);
    assert.equal(h.creates.length, 0);
    const spokenYes = await h.toolset.dispatch('sí', { inputSource: 'voice' });
    assert.equal(spokenYes.status, 'awaiting_confirmation');
    assert.equal(h.creates.length, 0);
    const confirmed = await h.toolset.dispatch('confirmo', { inputSource: 'text' });
    assert.equal(confirmed.status, 'complete', confirmed.reply);
    assertSaved(h, TODAY_ELEVEN);
});

test('voice permission remains necessary after filling a missing reminder time', async () => {
    const h = makeHarness();
    const requested = await h.toolset.dispatch(DATE_FIRST_REQUEST, { inputSource: 'voice' });
    assert.equal(requested.status, 'needs_input', requested.reply);
    const proposed = await h.toolset.dispatch('a las 11 de la mañana', { inputSource: 'voice' });
    assert.equal(proposed.status, 'awaiting_confirmation', proposed.reply);
    assert.equal(h.creates.length, 0);
    await h.toolset.dispatch('sí', { inputSource: 'voice' });
    assert.equal(h.creates.length, 0);
    const confirmed = await h.toolset.dispatch('confirmo');
    assert.equal(confirmed.status, 'complete', confirmed.reply);
    assertSaved(h, TOMORROW_ELEVEN);
});

test('a passed clock time asks for the day instead of executing or silently shifting it', async () => {
    const h = makeHarness({ now: '2026-10-15T18:00:00.000Z' }); // 13:00 Bogotá.
    const requested = await h.toolset.dispatch(ALARM_REQUEST);
    assert.equal(requested.status, 'needs_input', requested.reply);
    assert.match(requested.reply, /d[ií]a|fecha|ma[nñ]ana|pas[oó]/i);
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.isContextualFollowUp('mañana'), true);
    const result = await h.toolset.dispatch('mañana');
    assert.equal(result.status, 'complete', result.reply);
    assertSaved(h, TOMORROW_ELEVEN);
});

test('a missing activity is collected without losing its requested day and time', async () => {
    const h = makeHarness();
    const requested = await h.toolset.dispatch('quiero un recordatorio mañana a las 11 de la mañana');
    assert.equal(requested.status, 'needs_input', requested.reply);
    assert.match(requested.reply, /qu[eé]|asunto|actividad/i);
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending()?.stage, 'collecting');
    assert.equal(h.toolset.isContextualFollowUp('hacer ejercicio'), true);
    const result = await h.toolset.dispatch('hacer ejercicio');
    assert.equal(result.status, 'complete', result.reply);
    assertSaved(h, TOMORROW_ELEVEN);
});

test('changing accounts discards a partial capture and never attributes it to the next user', async () => {
    const h = makeHarness();
    await h.toolset.dispatch(DATE_FIRST_REQUEST);
    h.setUser('bob');
    assert.equal(h.toolset.isContextualFollowUp('a las 11 de la mañana'), false);
    const result = await h.toolset.dispatch('a las 11 de la mañana');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('changing accounts also discards a ready voice proposal instead of authorizing another user', async () => {
    const h = makeHarness();
    const proposed = await h.toolset.dispatch(ALARM_REQUEST, { inputSource: 'voice' });
    assert.equal(proposed.status, 'awaiting_confirmation', proposed.reply);
    h.setUser('bob');
    const result = await h.toolset.dispatch('confirmo');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('a stale device session cannot schedule a reminder or retain another account draft', async () => {
    const h = makeHarness();
    h.setDeviceOwner('bob');
    const result = await h.toolset.dispatch(ALARM_REQUEST);
    assert.notEqual(result.status, 'complete');
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('disabling continuity prevents short replies from completing a previous capture', async () => {
    const h = makeHarness();
    await h.toolset.dispatch(DATE_FIRST_REQUEST);
    h.setContinuity(false);
    assert.equal(h.toolset.isContextualFollowUp('a las 11 de la mañana'), false);
    const result = await h.toolset.dispatch('a las 11 de la mañana');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('a partial capture expires instead of attaching a much later utterance to an old activity', async () => {
    const h = makeHarness();
    await h.toolset.dispatch(DATE_FIRST_REQUEST);
    h.advance(11 * 60 * 1000);
    assert.equal(h.toolset.isContextualFollowUp('a las 11 de la mañana'), false);
    const result = await h.toolset.dispatch('a las 11 de la mañana');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.creates.length, 0);
});

test('questions, quoted examples and negated commands never create alarms or reminders', async () => {
    for (const phrase of [
        '¿Qué es una alarma y para qué sirve?',
        '¿Cómo puedo activar una alarma para hacer ejercicio a las 11 de la mañana?',
        'Explícame la frase «activa una alarma para hacer ejercicio a las 11 de la mañana»',
        '«activa una alarma para hacer ejercicio a las 11 de la mañana»',
        'no actives una alarma para hacer ejercicio a las 11 de la mañana'
    ]) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(phrase);
        assert.notEqual(result.status, 'complete', phrase);
        assert.equal(h.creates.length, 0, phrase);
        assert.equal(h.toolset.getPending(), null, phrase);
    }
});

test('an account change during time parsing cannot attribute the request to the new account', async () => {
    let h;
    h = makeHarness({ timeParser: { parse: async () => {
        h.setUser('bob'); return { iso: TODAY_ELEVEN, kind: 'instant' };
    } } });
    const result = await h.toolset.dispatch(ALARM_REQUEST);
    assert.equal(result.status, 'needs_input');
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('main command pipeline routes reminder creation and its time follow-up before legacy actions', async () => {
    const h = makeHarness();
    const root = { GunterAssistantTools: h.toolset,
        GunterTraceLogger: { startStage() {}, endStage() {}, recordError() {}, persist() {} },
        GunterContextProvider: { build: () => ({}), enrich: async () => ({}), pushConversationTurn() {} },
        GunterCoreModels: { newPipelineState: (text, context) => ({ input: { text, userContext: context } }) },
        GunterActions: { dispatch() { assert.fail('a reminder must not be treated as a feature activation'); } },
        GunterWorkflowOrchestrator: { dispatch() { assert.fail('a single reminder is not a multi-step workflow'); } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/pipeline.js'), 'utf8'), { window: root, console, navigator: { language: 'es-CO' } });
    const partial = await root.GunterPipeline.handleUserInput(DATE_FIRST_REQUEST);
    assert.match(partial.response.speech, /hora/i);
    assert.equal(h.creates.length, 0);
    const completed = await root.GunterPipeline.handleUserInput('a las 11 de la mañana');
    assert.match(completed.response.speech, /programado y verificado/i);
    assert.equal(h.creates.length, 1);
    assert.equal(Date.parse(h.creates[0].runAt), Date.parse(TOMORROW_ELEVEN));
    const companion = fs.readFileSync(path.join(__dirname, '../js/services/gunter-companion.js'), 'utf8');
    assert.match(companion, /earlyIntent && \[[^\]]*'reminder.schedule'\]/);
});

(async () => {
    let failures = 0;
    for (const check of tests) {
        try { await check.run(); }
        catch (error) { failures += 1; console.error(`reminder-create-language: FAIL: ${check.name}`); console.error(error); }
    }
    if (failures) process.exitCode = 1;
    else console.log(`reminder-create-language: PASS (${tests.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
