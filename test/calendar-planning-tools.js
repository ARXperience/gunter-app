const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
    let ownerId = 'alice', trusted = true, reads = 0;
    const values = new Map([['gunter_prefs', JSON.stringify({ language: 'es-MX', unrelated: 'preserved' })]]);
    const writes = [], events = [], pending = new Map(), calendarRows = [];
    const auth = { canAccessLocalData: () => trusted, getUser: () => ({ id: ownerId }) };
    const window = { GunterAuth: auth, localStorage: {
        getItem: key => { reads++; return values.get(key) || null; },
        setItem: (key, value) => { values.set(key, value); writes.push({ key, value }); }
    }, dispatchEvent: event => events.push(event) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/events-service.js'), 'utf8'), {
        window, Date, Intl, Math, Promise, Number,
        indexedDB: { open: () => assert.fail('changing preferences must not open another database') },
        CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts.detail; } }
    });
    const service = window.GunterEventsService;
    const root = { GunterAuth: auth, localStorage: window.localStorage };
    const tools = assistant.create({ root, eventsService: service, storage: {
        getItem: key => pending.get(key) || null, setItem: (key, value) => pending.set(key, value),
        removeItem: key => pending.delete(key)
    }, now: () => new Date('2026-10-11T15:00:00Z'), timezone: () => 'America/Bogota',
    timeParser: { parse: async () => ({ iso: '2026-10-12T10:00:00-05:00', kind: 'instant' }) } });
    return { tools, service, root, window, writes, values, events, pending,
        calendarRows, setOwner: id => { ownerId = id; }, setTrusted: value => { trusted = value; }, reads: () => reads };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('planning queries reuse settings.list without contacting the server or writing defaults', async () => {
    const h = fixture();
    for (const text of ['mis preferencias de agenda', '¿Qué horario laboral tengo?', 'dime mi jornada']) {
        assert.equal(h.tools.detect(text).toolId, 'settings.list');
        const response = await h.tools.dispatch(text);
        assert.equal(response.status, 'complete');
        assert.match(response.reply, /desactivada/);
        assert.match(response.reply, /0 minutos/);
    }
    assert.equal(h.writes.length, 0);
});

test('text configuration always proposes before writing and verifies the account policy', async () => {
    for (const [text, patch] of [
        ['activa mi horario laboral', { respectWorkingHours: true }],
        ['desactiva el horario de trabajo', { respectWorkingHours: false }],
        ['cambia mi jornada de 9:00 a 17:30', { workStart: '09:00', workEnd: '17:30' }],
        ['configura mis días laborales a lunes, miércoles y viernes', { workingDays: [1, 3, 5] }],
        ['configura mis días laborales de lunes a viernes', { workingDays: [1, 2, 3, 4, 5] }],
        ['deja 15 minutos entre reuniones', { bufferMinutes: 15 }],
        ['quita el margen entre reuniones', { bufferMinutes: 0 }]
    ]) {
        const h = fixture();
        assert.equal(h.tools.detect(text).toolId, 'preferences.update');
        const response = await h.tools.dispatch(text);
        assert.equal(response.status, 'awaiting_confirmation', text);
        assert.equal(h.writes.length, 0);
        assert.equal(h.tools.isContextualFollowUp('sí'), true);
        assert.equal((await h.tools.dispatch('sí')).status, 'complete');
        const saved = clone(h.service.getPlanningPreferences('alice'));
        for (const [key, value] of Object.entries(patch)) assert.deepEqual(saved[key], value, text);
        const data = JSON.parse(h.values.get('gunter_prefs'));
        assert.equal(data.unrelated, 'preserved');
        assert.equal(Object.hasOwn(data.calendarPlanningByAccount, 'bob'), false);
    }
});

test('a spoken setting request never treats spoken yes as authorization', async () => {
    const h = fixture();
    const proposed = await h.tools.dispatch('deja 20 minutos entre reuniones', { inputSource: 'voice' });
    assert.equal(proposed.status, 'awaiting_confirmation');
    assert.match(proposed.reply, /por escrito|en pantalla/);
    assert.equal((await h.tools.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.tools.dispatch('confirmo')).status, 'complete');
    assert.equal(h.service.getPlanningPreferences('alice').bufferMinutes, 20);
});

test('invalid or ambiguous policy values fail before confirmation without partial changes', async () => {
    for (const text of ['deja 121 minutos entre reuniones', 'deja -15 minutos entre reuniones',
        'deja 15,5 minutos entre reuniones', 'deja 1.5 minutos entre reuniones',
        'cambia mi jornada de 18:00 a 09:00', 'cambia mi jornada de 09:99 a 18:00',
        'configura mis días laborales a lunes y festivo', 'configura mi horario laboral',
        'activa mi horario laboral y deja 15 minutos entre reuniones',
        'cambia mi jornada de lunes a jueves de 09:00 a 16:00']) {
        const h = fixture();
        const before = h.values.get('gunter_prefs');
        const response = await h.tools.dispatch(text);
        assert.equal(response.status, 'needs_input', text);
        assert.equal(h.writes.length, 0);
        assert.equal(h.values.get('gunter_prefs'), before);
    }
});

test('turning working hours off preserves the configured hours, days and buffer', async () => {
    const h = fixture();
    h.service.updatePlanningPreferences({ respectWorkingHours: true, workStart: '10:00', workEnd: '16:00', workingDays: [2, 4], bufferMinutes: 30 }, 'alice');
    assert.equal((await h.tools.dispatch('desactiva mi horario laboral')).status, 'awaiting_confirmation');
    assert.equal((await h.tools.dispatch('sí')).status, 'complete');
    assert.deepEqual(clone(h.service.getPlanningPreferences('alice')), {
        respectWorkingHours: false, workingDays: [2, 4], workStart: '10:00', workEnd: '16:00', bufferMinutes: 30
    });
});

test('account changes or loss of trust invalidate pending configuration and keep other data', async () => {
    for (const change of [h => h.setOwner('bob'), h => h.setTrusted(false)]) {
        const h = fixture();
        await h.tools.dispatch('activa mi horario laboral');
        change(h);
        assert.notEqual((await h.tools.dispatch('sí')).status, 'complete');
        assert.equal(h.writes.length, 0);
        assert.equal(h.tools.getPending(), null);
    }
    const h = fixture();
    h.service.updatePlanningPreferences({ bufferMinutes: 10 }, 'alice');
    h.setOwner('bob');
    assert.equal((await h.tools.dispatch('mis preferencias de agenda')).result.planningPreferences.bufferMinutes, 0);
    await h.tools.dispatch('deja 25 minutos entre reuniones');
    await h.tools.dispatch('sí');
    h.setOwner('alice');
    assert.equal(h.service.getPlanningPreferences('alice').bufferMinutes, 10);
    assert.equal(JSON.parse(h.values.get('gunter_prefs')).calendarPlanningByAccount.bob.bufferMinutes, 25);
});

test('an account switch during asynchronous inspection never produces another account proposal', async () => {
    const h = fixture(), getter = h.service.getPlanningPreferences;
    h.service.getPlanningPreferences = async owner => {
        const result = getter(owner); h.setOwner('bob'); return result;
    };
    assert.equal((await h.tools.dispatch('deja 15 minutos entre reuniones')).status, 'needs_input');
    assert.equal(h.writes.length, 0);
    assert.equal(h.tools.getPending(), null);
});

test('changes in another tab require a fresh request rather than overwriting its decisions', async () => {
    const h = fixture();
    await h.tools.dispatch('deja 15 minutos entre reuniones');
    h.service.updatePlanningPreferences({ workEnd: '16:00' }, 'alice');
    const writes = h.writes.length;
    const response = await h.tools.dispatch('sí');
    assert.equal(response.status, 'error');
    assert.match(response.reply, /cambiaron/);
    assert.equal(h.writes.length, writes);
    assert.equal(h.service.getPlanningPreferences('alice').bufferMinutes, 0);
    assert.equal(h.service.getPlanningPreferences('alice').workEnd, '16:00');
});

test('corrupt storage is explained and preserved instead of overwritten', async () => {
    const h = fixture();
    h.values.set('gunter_prefs', '{ broken');
    const response = await h.tools.dispatch('activa mi horario laboral');
    assert.equal(response.status, 'needs_input');
    assert.match(response.reply, /no son válidos|no.*sobrescrib/i);
    assert.equal(h.writes.length, 0);
    assert.equal(h.values.get('gunter_prefs'), '{ broken');
});

test('negative and expired approvals never save preference changes', async () => {
    for (const expired of [false, true]) {
        const h = fixture();
        await h.tools.dispatch('deja 15 minutos entre reuniones');
        if (expired) {
            const saved = h.tools.getPending(); saved.createdAt = Date.now() - 360000;
            h.pending.set('gunter_pending_tool_v1', JSON.stringify(saved));
        }
        assert.notEqual((await h.tools.dispatch(expired ? 'sí' : 'no')).status, 'complete');
        assert.equal(h.writes.length, 0);
    }
});

test('buffer and working-hours warnings require explicit approval and cannot hide inside a workflow', async () => {
    for (const bufferOnly of [true, false]) {
        const h = fixture();
        h.service.updatePlanningPreferences(bufferOnly ? { bufferMinutes: 15 } : { respectWorkingHours: true }, 'alice');
        h.service.list = async () => clone(h.calendarRows);
        h.service.checkSchedule = async args => ({
            conflicts: [], complete: true, suggestions: [{ startAt: '2026-10-12T11:00:00-05:00', endAt: '2026-10-12T12:00:00-05:00' }],
            bufferConflicts: bufferOnly ? [{ id: 'busy', title: 'Equipo', startAt: '2026-10-12T09:00:00-05:00', endAt: '2026-10-12T10:00:00-05:00' }] : [],
            outsideWorkingHours: !bufferOnly, planningPreferences: h.service.getPlanningPreferences('alice'),
            warnings: [bufferOnly ? 'No se cumple tu margen de 15 minutos.' : 'El horario queda fuera de tu jornada.'],
            fingerprint: JSON.stringify(h.service.getPlanningPreferences('alice'))
        });
        h.service.create = async (data, opts) => {
            assert.equal(opts.scheduleExpected.fingerprint, JSON.stringify(h.service.getPlanningPreferences('alice')));
            const row = { id: 'new-event', ...data }; h.calendarRows.push(row); return row;
        };
        const response = await h.tools.dispatch('agenda una reunión "Revisión" mañana a las 10');
        assert.equal(response.status, 'awaiting_confirmation');
        assert.match(response.reply, bufferOnly ? /margen.*15|15.*minutos/ : /fuera de tu jornada/);
        assert.match(response.reply, /aceptarás/);
        assert.equal(h.calendarRows.length, 0);
        assert.equal((await h.tools.validatePrepared({ toolId: 'calendar.create', args: h.tools.getPending().args })).error, 'calendar_schedule_attention');
        assert.equal((await h.tools.dispatch('sí')).status, 'complete');
        assert.equal(h.calendarRows.length, 1);
    }
});

test('an unrelated turn discards an old planning proposal rather than letting a later yes apply it', async () => {
    const h = fixture();
    await h.tools.dispatch('activa mi horario laboral');
    await h.tools.dispatch('hablemos de otra cosa');
    assert.equal(h.tools.getPending(), null);
    assert.notEqual((await h.tools.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
});

(async () => {
    for (const { name, run } of tests) {
        try { await run(); }
        catch (error) { console.error(`calendar-planning-tools: FAIL ${name}`); throw error; }
    }
    console.log(`calendar-planning-tools: PASS (${tests.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
