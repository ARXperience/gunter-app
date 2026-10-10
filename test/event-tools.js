const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');
const skills = require('../server/control-plane/skills.js');

const now = new Date('2026-10-08T15:00:00.000Z');
const tomorrowAtTen = '2026-10-09T10:00:00-05:00';
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = row => ({
    title: row.title,
    startAt: row.startAt || null,
    endAt: row.endAt || null,
    status: row.status || 'scheduled',
    updatedAt: row.updatedAt || null,
    rrule: row.rrule || null,
    externalIds: row.externalIds || {}
});

function makeHarness(options = {}) {
    const base = {
        startAt: '2026-10-08T16:00:00-05:00',
        endAt: '2026-10-08T17:30:00-05:00',
        status: 'scheduled', ownerId: 'alice', updatedAt: 'rev1', rrule: null,
        externalIds: {}, source: 'manual', location: 'Sala principal', attendees: ['ana'],
        tags: ['trabajo'], projectId: 'project-one', priority: 'high'
    };
    const rows = [
        { ...base, id: 'own-event', title: 'Revisión de producto' },
        { ...base, id: 'other-same-title', title: 'Revisión de producto', ownerId: 'bob' },
        { ...base, id: 'other-private', title: 'Planeación privada de Bob', ownerId: 'bob', location: 'BOB_SECRET_METADATA' },
        { ...base, id: 'legacy-event', title: 'Evento antiguo', ownerId: 'local-user' },
        { ...base, id: 'unowned-event', title: 'Evento sin dueño', ownerId: undefined },
        { ...base, id: 'own-no-status', title: 'Evento sin estado', status: undefined },
        { ...base, id: 'dup-one', title: 'Cita con Ana', startAt: '2026-10-09T12:00:00-05:00', endAt: '2026-10-09T13:30:00-05:00' },
        { ...base, id: 'dup-two', title: 'Cita con Ana', startAt: '2026-10-10T12:00:00-05:00', endAt: '2026-10-10T13:30:00-05:00' },
        { ...base, id: 'other-duplicate', title: 'Cita con Ana', ownerId: 'bob', location: 'BOB_SECRET_METADATA' },
        { ...base, id: 'recurring-event', title: 'Reunión recurrente', rrule: 'FREQ=WEEKLY;BYDAY=TH' },
        { ...base, id: 'google-event', title: 'Evento de Google', externalIds: { google: 'google-private-id', googleHtmlLink: 'https://calendar.google.com/private' } },
        { ...base, id: 'cancelled-event', title: 'Reunión cancelada', status: 'cancelled', cancelledAt: '2026-10-07T15:00:00.000Z' }
    ].map(clone);
    let userId = 'alice';
    let trusted = true;
    const writes = [];
    const creates = [];
    const service = {
        list: async () => clone(rows),
        create: async data => {
            assert.equal(data.ownerId, 'alice', 'calendar.create must save the authenticated owner');
            const row = { id: `created-${creates.length + 1}`, status: 'scheduled', externalIds: {},
                updatedAt: 'created-rev', endAt: new Date(Date.parse(data.startAt) + 60 * 60 * 1000).toISOString(), ...data };
            if (!row.endAt) row.endAt = new Date(Date.parse(data.startAt) + 60 * 60 * 1000).toISOString();
            if (options.createdOwner) row.ownerId = options.createdOwner;
            creates.push(clone(data));
            rows.push(clone(row));
            return { ...clone(row), ownerId: data.ownerId };
        },
        update: async (id, patch, guard) => {
            const row = rows.find(item => item.id === id);
            assert.ok(row, 'the target must exist');
            assert.equal(row.ownerId, guard?.ownerId);
            assert.equal(guard.ownerId, 'alice');
            assert.deepEqual(guard.statuses, ['scheduled']);
            assert.equal(guard.skipSync, true, 'local edits must never invoke Google synchronization');
            assert.deepEqual(guard.expected, snapshot(row), 'the write guard must contain the full confirmed snapshot');
            assert.equal(Object.hasOwn(patch, 'ownerId'), false, 'editing must never reattribute an event');
            writes.push({ id, patch: clone(patch), guard: clone(guard) });
            if (!options.skipPersistence) Object.assign(row, clone(patch), { updatedAt: `rev${writes.length + 1}` });
            if (options.updatedOwner) row.ownerId = options.updatedOwner;
            if (options.corruptEnd) row.endAt = '2026-10-09T10:01:00-05:00';
            return { ...clone(row), ownerId: guard.ownerId, ...clone(patch) };
        },
        remove: async () => assert.fail('calendar.cancel must update status rather than remove the event')
    };
    const toolset = assistant.create({
        root: { GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null } },
        tasksService: options.tasksService || { list: async () => [] },
        eventsService: service,
        now: () => now,
        timezone: () => 'America/Bogota',
        timeParser: options.timeParser || { parse: async phrase => {
            if (phrase.includes('hasta las 11')) return { iso: tomorrowAtTen, end: '2026-10-09T11:00:00-05:00', kind: 'instant' };
            if (phrase.includes('sin fin válido')) return { iso: tomorrowAtTen, end: 'not-a-date', kind: 'instant' };
            if (phrase.includes('fin antes del inicio')) return { iso: tomorrowAtTen, end: '2026-10-09T09:00:00-05:00', kind: 'instant' };
            if (phrase.includes('ayer')) return { iso: '2026-10-07T10:00:00-05:00', kind: 'instant' };
            if (phrase.includes('el viernes')) return { iso: tomorrowAtTen, kind: 'instant', ambiguity: { reason: 'Viernes ambiguo', options: ['este viernes', 'el próximo viernes'] } };
            if (phrase.includes('cada viernes')) return { iso: tomorrowAtTen, kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=FR' };
            if (phrase.includes('fecha inválida')) return { iso: 'not-a-date', kind: 'instant' };
            if (phrase.includes('mañana a las 10')) return { iso: tomorrowAtTen, kind: 'instant' };
            return { iso: null };
        } }
    });
    return { rows, writes, creates, toolset, service,
        setUser: value => { userId = value; }, setTrusted: value => { trusted = value; } };
}

async function confirm(harness, command) {
    const proposal = await harness.toolset.dispatch(command);
    assert.equal(proposal.status, 'awaiting_confirmation', command);
    return harness.toolset.dispatch('confirmo');
}

const checks = [];
const test = (name, run) => checks.push({ name, run });

test('registry and action detection require confirmation without acting on explanations', async () => {
    const h = makeHarness();
    for (const id of ['calendar.create', 'calendar.update', 'calendar.cancel']) {
        assert.equal(h.toolset.listTools().find(tool => tool.id === id)?.confirm, 'always');
        assert.equal(skills.get(id)?.autonomyMax, 'L3');
        assert.equal(skills.get(id)?.risk, 'external_write');
    }
    for (const command of [
        'renombra la reunión "Revisión de producto" a "Revisión final"',
        'reprograma la cita "Revisión de producto" para mañana a las 10',
        'mueve el evento "Revisión de producto" para mañana a las 10',
        'cambia la fecha de la reunión "Revisión de producto" a mañana a las 10',
        'cambia la hora del evento "Revisión de producto" a mañana a las 10'
    ]) assert.equal(h.toolset.detect(command)?.toolId, 'calendar.update', command);
    for (const command of ['cancela la reunión "Revisión de producto"', 'elimina el evento "Revisión de producto"'])
        assert.equal(h.toolset.detect(command)?.toolId, 'calendar.cancel', command);
    for (const command of ['¿Cómo puedo cambiar una reunión?', '¿Cómo puedo cancelar una cita?', '¿Qué significa reprogramar un evento?']) {
        assert.equal(h.toolset.detect(command), null, command);
        assert.notEqual((await h.toolset.dispatch(command)).status, 'complete');
    }
    assert.equal(h.writes.length + h.creates.length, 0);
});

test('creation belongs to the authenticated account and preserves legacy owners', async () => {
    const h = makeHarness();
    const before = clone(h.rows);
    const proposal = await h.toolset.dispatch('agenda una reunión Nueva reunión mañana a las 10');
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.equal(h.creates.length, 0);
    const result = await h.toolset.dispatch('sí');
    assert.equal(result.status, 'complete');
    assert.equal(result.verified, true);
    assert.equal(result.result.ownerId, 'alice');
    assert.equal(h.creates[0].ownerId, 'alice');
    assert.equal(h.creates[0].source, 'gunter-assistant');
    assert.deepEqual(h.rows.slice(0, before.length), before);
});

test('creation requested by voice also requires written confirmation', async () => {
    const h = makeHarness();
    const proposal = await h.toolset.dispatch('agenda una reunión Nueva reunión mañana a las 10', { inputSource: 'voice' });
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.match(proposal.reply, /por escrito|en pantalla/i);
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.creates.length, 0);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.creates.length, 1);
    assert.equal(h.rows.at(-1).ownerId, 'alice');
});

test('creation rechecks account and trust after confirmation', async () => {
    for (const change of [h => h.setUser('bob'), h => h.setUser(null), h => h.setTrusted(false)]) {
        const h = makeHarness();
        assert.equal((await h.toolset.dispatch('agenda una reunión Nueva reunión mañana a las 10')).status, 'awaiting_confirmation');
        change(h);
        assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
        assert.equal(h.creates.length, 0);
    }
    const h = makeHarness();
    h.setTrusted(false);
    assert.equal((await h.toolset.dispatch('agenda una reunión Nueva reunión mañana a las 10')).status, 'needs_input');
    assert.equal(h.creates.length, 0);
});

test('creation verification requires a persisted event owned by this account', async () => {
    const h = makeHarness({ createdOwner: 'bob' });
    const result = await confirm(h, 'agenda una reunión Nueva reunión mañana a las 10');
    assert.equal(result.status, 'error');
    assert.equal(result.verified, false);
    assert.doesNotMatch(result.reply, /creado y verificado/i);
});

test('rename requires written confirmation and never changes another account with the same title', async () => {
    const h = makeHarness();
    const other = clone(h.rows[1]);
    const command = 'renombra la reunión "Revisión de producto" a "Revisión final"';
    assert.equal((await h.toolset.dispatch(command)).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(h.rows[0].title, 'Revisión de producto');
    const voice = await h.toolset.dispatch(command, { inputSource: 'voice' });
    assert.equal(voice.status, 'awaiting_confirmation');
    assert.match(voice.reply, /por escrito|en pantalla/i);
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.rows[0].title, 'Revisión final');
    assert.deepEqual(h.rows[1], other);
    assert.deepEqual(h.writes[0].patch, { title: 'Revisión final' });
});

test('reschedule preserves duration and presents the resolved date before writing', async () => {
    const h = makeHarness();
    const before = clone(h.rows[0]);
    const proposal = await h.toolset.dispatch('reprograma la reunión "Revisión de producto" para mañana a las 10');
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.match(proposal.reply, /9 de octubre/i);
    assert.equal(h.writes.length, 0);
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'complete');
    assert.equal(result.verified, true);
    assert.equal(Date.parse(h.rows[0].startAt), Date.parse(tomorrowAtTen));
    assert.equal(Date.parse(h.rows[0].endAt) - Date.parse(h.rows[0].startAt), Date.parse(before.endAt) - Date.parse(before.startAt));
    for (const key of ['title', 'ownerId', 'location', 'attendees', 'tags', 'projectId', 'rrule', 'externalIds', 'priority'])
        assert.deepEqual(h.rows[0][key], before[key], key);
    assert.deepEqual(Object.keys(h.writes[0].patch).sort(), ['endAt', 'startAt']);
    const alternate = await h.toolset.prepareMatch(h.toolset.detect('cambia la fecha de la cita Revisión de producto a mañana a las 10'));
    assert.equal(alternate.args.reference, 'Revisión de producto');
    assert.equal(Date.parse(alternate.args.startAt), Date.parse(tomorrowAtTen));
});

test('an explicit valid end takes precedence over the original duration', async () => {
    const h = makeHarness();
    assert.equal((await confirm(h, 'mueve el evento "Revisión de producto" para mañana a las 10 hasta las 11')).status, 'complete');
    assert.equal(Date.parse(h.rows[0].endAt), Date.parse('2026-10-09T11:00:00-05:00'));
});

test('real local parser reschedules with a fixed clock and quoted created titles remain addressable', async () => {
    const browser = { window: {}, Date, Intl };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/time-parser.js'), 'utf8'), browser,
        { filename: 'js/core/time-parser.js' });
    const h = makeHarness({ timeParser: browser.window.GunterTimeParser });
    const before = clone(h.rows[0]);
    const proposal = await h.toolset.dispatch('reprograma la reunión "Revisión de producto" para mañana a las 10');
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.match(proposal.reply, /9 de octubre/i);
    assert.match(proposal.reply, /10:00/);
    assert.equal(h.writes.length, 0);
    const rescheduled = await h.toolset.dispatch('confirmo');
    assert.equal(rescheduled.status, 'complete');
    assert.equal(rescheduled.verified, true);
    assert.equal(h.rows[0].startAt, tomorrowAtTen);
    assert.equal(Date.parse(h.rows[0].endAt) - Date.parse(h.rows[0].startAt), Date.parse(before.endAt) - Date.parse(before.startAt));
    const created = await confirm(h, 'agenda una reunión "Reunión de diseño" mañana a las 10');
    assert.equal(created.status, 'complete');
    assert.equal(created.result.title, 'Reunión de diseño');
    assert.equal(created.result.ownerId, 'alice');
    const renamed = await confirm(h, 'renombra la reunión "Reunión de diseño" a "Diseño final"');
    assert.equal(renamed.status, 'complete');
    assert.equal(renamed.result.id, created.result.id);
    assert.equal(h.rows.find(row => row.id === created.result.id).title, 'Diseño final');
});

test('invalid, past, ambiguous and recurring times produce no writes', async () => {
    for (const phrase of ['ayer', 'el viernes', 'un día cualquiera', 'fecha inválida', 'cada viernes', 'mañana a las 10 sin fin válido', 'mañana a las 10 con fin antes del inicio']) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(`reprograma la reunión "Revisión de producto" para ${phrase}`);
        assert.equal(result.status, 'needs_input', phrase);
        assert.equal(h.writes.length, 0, phrase);
        assert.equal(h.toolset.getPending(), null, phrase);
    }
});

test('missing targets, partial names, other owners and already cancelled events are not guessed', async () => {
    for (const command of [
        'renombra la reunión a "Nuevo nombre"', 'reprograma la reunión para mañana a las 10', 'cancela el evento',
        'renombra la reunión "Revisión" a "Nuevo nombre"', 'cancela el evento "other-private"',
        'renombra el evento "legacy-event" a "Nuevo nombre"', 'cancela el evento "unowned-event"',
        'renombra el evento "cancelled-event" a "Nuevo nombre"', 'cancela el evento "cancelled-event"'
    ]) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(command);
        assert.equal(result.status, 'needs_input', command);
        assert.equal(h.writes.length, 0, command);
        assert.doesNotMatch(JSON.stringify(result), /Planeación privada de Bob|BOB_SECRET_METADATA/);
    }
});

test('duplicate titles require selection and selection refreshes the event before confirmation', async () => {
    const h = makeHarness();
    let result = await h.toolset.dispatch('reprograma la reunión "Cita con Ana" para mañana a las 10');
    assert.equal(result.status, 'needs_input');
    assert.equal(h.writes.length, 0);
    assert.match(result.reply, /1[.)]/);
    assert.match(result.reply, /2[.)]/);
    assert.doesNotMatch(JSON.stringify(result), /other-duplicate|BOB_SECRET_METADATA/);
    const second = h.rows.find(row => row.id === 'dup-two');
    second.updatedAt = 'changed-before-selection';
    second.endAt = '2026-10-10T14:00:00-05:00';
    result = await h.toolset.dispatch('2');
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes[0].id, 'dup-two');
    assert.equal(h.writes[0].guard.expected.updatedAt, 'changed-before-selection');
    assert.equal(Date.parse(second.endAt) - Date.parse(second.startAt), 2 * 60 * 60 * 1000);
    assert.equal(h.rows.find(row => row.id === 'dup-one').startAt, '2026-10-09T12:00:00-05:00');
    const ordinal = makeHarness();
    assert.equal((await ordinal.toolset.dispatch('renombra la cita "Cita con Ana" a "Cita final"')).status, 'needs_input');
    assert.equal((await ordinal.toolset.dispatch('la segunda')).status, 'awaiting_confirmation');
    assert.equal((await ordinal.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(ordinal.writes.length, 0);
});

test('a unique event ID can disambiguate duplicate titles', async () => {
    const h = makeHarness();
    assert.equal((await confirm(h, 'renombra el evento "dup-one" a "Cita final"')).status, 'complete');
    assert.equal(h.rows.find(row => row.id === 'dup-one').title, 'Cita final');
    assert.equal(h.rows.find(row => row.id === 'dup-two').title, 'Cita con Ana');
});

test('cancellation keeps the record and its details and records cancellation time', async () => {
    const h = makeHarness();
    const before = clone(h.rows[0]);
    const count = h.rows.length;
    assert.equal((await h.toolset.dispatch('elimina el evento "Revisión de producto"')).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    assert.deepEqual(h.rows[0], before);
    const voice = await h.toolset.dispatch('cancela la reunión "Revisión de producto"', { inputSource: 'voice' });
    assert.equal(voice.status, 'awaiting_confirmation');
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    const result = await h.toolset.dispatch('sí');
    assert.equal(result.status, 'complete');
    assert.equal(result.verified, true);
    assert.equal(h.rows.length, count);
    assert.equal(h.rows[0].status, 'cancelled');
    assert.ok(Number.isFinite(Date.parse(h.rows[0].cancelledAt)));
    assert.equal(Date.parse(h.rows[0].cancelledAt), now.getTime());
    for (const key of Object.keys(before).filter(key => !['status', 'updatedAt'].includes(key)))
        assert.deepEqual(h.rows[0][key], before[key], key);
    assert.equal(h.rows[1].status, 'scheduled');
    assert.deepEqual(Object.keys(h.writes[0].patch).sort(), ['cancelledAt', 'status']);
});

test('legacy owned events without status are editable without reattributing legacy local-user rows', async () => {
    for (const command of ['renombra el evento "own-no-status" a "Evento actualizado"', 'cancela el evento "own-no-status"']) {
        const h = makeHarness();
        const legacy = clone(h.rows.find(row => row.id === 'legacy-event'));
        assert.equal((await confirm(h, command)).status, 'complete');
        assert.equal(h.writes[0].guard.expected.status, 'scheduled');
        assert.equal(h.rows.find(row => row.id === 'own-no-status').ownerId, 'alice');
        assert.deepEqual(h.rows.find(row => row.id === 'legacy-event'), legacy);
    }
});

test('recurring and Google linked events cannot be edited or cancelled locally', async () => {
    for (const id of ['recurring-event', 'google-event']) {
        for (const command of [`renombra el evento "${id}" a "Nuevo nombre"`, `reprograma el evento "${id}" para mañana a las 10`, `cancela el evento "${id}"`]) {
            const h = makeHarness();
            const before = clone(h.rows);
            assert.equal((await h.toolset.dispatch(command)).status, 'needs_input', command);
            assert.deepEqual(h.rows, before);
            assert.equal(h.writes.length, 0);
        }
    }
});

test('account changes and revoked trust block both pending writes and duplicate selection', async () => {
    for (const command of ['renombra la reunión "Revisión de producto" a "Nueva revisión"', 'cancela la reunión "Revisión de producto"']) {
        for (const change of [h => h.setUser('bob'), h => h.setUser(null), h => h.setTrusted(false)]) {
            const h = makeHarness();
            assert.equal((await h.toolset.dispatch(command)).status, 'awaiting_confirmation');
            change(h);
            const result = await h.toolset.dispatch('sí');
            assert.notEqual(result.status, 'complete');
            assert.equal(h.writes.length, 0);
            assert.doesNotMatch(JSON.stringify(result), /Planeación privada de Bob|BOB_SECRET_METADATA/);
        }
    }
    const h = makeHarness();
    assert.equal((await h.toolset.dispatch('renombra la reunión "Cita con Ana" a "Cita final"')).status, 'needs_input');
    h.setUser('bob');
    assert.notEqual((await h.toolset.dispatch('2')).status, 'awaiting_confirmation');
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
    const untrusted = makeHarness();
    untrusted.setTrusted(false);
    for (const command of ['renombra la reunión "Revisión de producto" a "Nueva revisión"', 'cancela la reunión "Revisión de producto"']) {
        const result = await untrusted.toolset.dispatch(command);
        assert.equal(result.status, 'needs_input');
        assert.doesNotMatch(JSON.stringify(result), /Planeación privada de Bob|BOB_SECRET_METADATA/);
    }
    assert.equal(untrusted.writes.length, 0);
});

test('every snapshot field prevents stale updates and cancellations before a write', async () => {
    const changes = {
        title: 'Nombre cambiado por otra pantalla', startAt: '2026-10-08T18:00:00-05:00',
        endAt: '2026-10-08T19:00:00-05:00', status: 'cancelled', updatedAt: 'changed-externally',
        rrule: 'FREQ=DAILY', externalIds: { google: 'linked-after-confirmation' }, ownerId: 'bob'
    };
    for (const command of ['renombra la reunión "Revisión de producto" a "Revisión final"', 'cancela la reunión "Revisión de producto"']) {
        for (const [key, value] of Object.entries(changes)) {
            const h = makeHarness();
            assert.equal((await h.toolset.dispatch(command)).status, 'awaiting_confirmation');
            h.rows[0][key] = clone(value);
            const result = await h.toolset.dispatch('confirmo');
            assert.equal(result.status, 'error', `${command}: ${key}`);
            assert.equal(h.writes.length, 0, key);
            assert.doesNotMatch(JSON.stringify(result), /Nombre cambiado por otra pantalla|linked-after-confirmation/);
        }
    }
});

test('verification rejects incorrect ownership or a write that did not persist', async () => {
    for (const options of [{ updatedOwner: 'bob' }, { skipPersistence: true }]) {
        for (const command of ['renombra la reunión "Revisión de producto" a "Revisión final"', 'cancela la reunión "Revisión de producto"']) {
            const h = makeHarness(options);
            const result = await confirm(h, command);
            assert.equal(result.status, 'error');
            assert.equal(result.verified, false);
        }
    }
    const h = makeHarness({ corruptEnd: true });
    const result = await confirm(h, 'reprograma la reunión "Revisión de producto" para mañana a las 10');
    assert.equal(result.status, 'error');
    assert.equal(result.verified, false);
});

test('agenda only exposes this account active events and excludes cancelled records', async () => {
    const h = makeHarness();
    assert.equal((await confirm(h, 'cancela la reunión "Revisión de producto"')).status, 'complete');
    for (const command of ['mi agenda', 'agenda de mañana', 'próximos eventos']) {
        const result = await h.toolset.dispatch(command);
        assert.equal(result.status, 'complete', command);
        assert.ok(result.result.events.every(row => row.ownerId === 'alice' && row.status !== 'cancelled'));
        assert.ok(!result.result.events.some(row => ['own-event', 'cancelled-event', 'legacy-event', 'unowned-event'].includes(row.id)));
        assert.doesNotMatch(result.reply, /Reunión cancelada|Evento antiguo|Evento sin dueño|Planeación privada de Bob|BOB_SECRET_METADATA/);
    }
    const today = await h.toolset.dispatch('mi agenda');
    assert.ok(today.result.events.some(row => row.id === 'own-no-status'), 'owned events without legacy status remain visible');
    h.setTrusted(false);
    const denied = await h.toolset.dispatch('mi agenda');
    assert.notEqual(denied.status, 'complete');
    assert.doesNotMatch(JSON.stringify(denied), /Evento sin estado|BOB_SECRET_METADATA/);
});

test('an event request cannot reuse an older task target or an obsolete event confirmation', async () => {
    let oldTask = null;
    const h = makeHarness({ tasksService: {
        create: async data => { oldTask = { id: 'old-task', status: 'pending', ...data }; return oldTask; },
        list: async () => oldTask ? [oldTask] : []
    } });
    assert.equal((await h.toolset.dispatch('crea la tarea Tarea anterior')).status, 'complete');
    assert.equal((await h.toolset.dispatch('cancela la reunión "Revisión de producto"')).status, 'awaiting_confirmation');
    const followUp = await h.toolset.dispatch('muévela para mañana a las 10');
    assert.equal(followUp.status, 'needs_input');
    assert.equal(followUp.intent, undefined, 'an event pronoun must not target the older task');
    assert.equal(h.toolset.getPending(), null);
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
    assert.equal(h.rows[0].status, 'scheduled');
});

(async () => {
    let failures = 0;
    for (const check of checks) {
        try { await check.run(); }
        catch (error) { failures += 1; console.error(`event-tools: FAIL: ${check.name}`); console.error(error); }
    }
    if (failures) process.exitCode = 1;
    else console.log(`event-tools: PASS (${checks.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
