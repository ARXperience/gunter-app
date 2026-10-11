const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');

const initialNow = '2026-10-08T15:00:00.000Z';
const todayAtFour = '2026-10-08T16:00:00-05:00';
const tomorrowAtTen = '2026-10-09T10:00:00-05:00';
const laterAtEleven = '2026-10-10T11:00:00-05:00';
const clone = value => JSON.parse(JSON.stringify(value));
const taskSnapshot = row => ({ title: row.title, dueAt: row.dueAt || null,
    status: row.status, updatedAt: row.updatedAt || null });
const eventSnapshot = row => ({ title: row.title, startAt: row.startAt || null,
    endAt: row.endAt || null, status: row.status || 'scheduled', updatedAt: row.updatedAt || null,
    rrule: row.rrule || null, externalIds: row.externalIds || {} });

function makeHarness(options = {}) {
    let userId = 'alice';
    let trusted = true;
    let continuity = options.continuity !== false;
    let currentTime = new Date(initialNow);
    const taskBase = { ownerId: 'alice', status: 'pending', dueAt: todayAtFour, updatedAt: 'task-rev1' };
    const eventBase = { ownerId: 'alice', status: 'scheduled', startAt: todayAtFour,
        endAt: '2026-10-08T17:30:00-05:00', updatedAt: 'event-rev1', rrule: null, externalIds: {},
        source: 'manual', location: 'Sala principal', tags: ['trabajo'] };
    const tasks = [
        { ...taskBase, id: 'own-task', title: 'Revisar informe' },
        { ...taskBase, id: 'second-task', title: 'Elemento repetido' },
        { ...taskBase, id: 'foreign-task', title: 'BOB_SECRET_TASK', ownerId: 'bob' }
    ].map(clone);
    const events = [
        { ...eventBase, id: 'own-event', title: 'Revisión de producto' },
        { ...eventBase, id: 'second-event', title: 'Elemento repetido' },
        { ...eventBase, id: 'foreign-event', title: 'BOB_SECRET_EVENT', ownerId: 'bob', location: 'BOB_SECRET_METADATA' }
    ].map(clone);
    const taskCreates = [];
    const eventCreates = [];
    const taskWrites = [];
    const eventWrites = [];
    const reminders = [];
    const saved = new Map();
    const storage = { getItem: key => saved.get(key) || null,
        setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
    const tasksService = {
        list: async () => clone(tasks),
        create: async data => {
            taskCreates.push(clone(data));
            assert.equal(data.ownerId, 'alice');
            const row = { id: `created-task-${taskCreates.length}`, status: 'pending', updatedAt: 'created-task-rev', ...data };
            if (!options.skipTaskPersistence) tasks.push(clone(row));
            return clone(row);
        },
        update: async (id, patch, guard) => {
            taskWrites.push({ id, patch: clone(patch), guard: clone(guard) });
            const row = tasks.find(item => item.id === id);
            assert.ok(row, 'the exact task ID must exist');
            assert.equal(guard.ownerId, 'alice');
            assert.equal(row.ownerId, guard.ownerId);
            assert.deepEqual(guard.statuses, ['pending', 'doing']);
            assert.deepEqual(guard.expected, taskSnapshot(row), 'task writes must guard the confirmed snapshot');
            assert.equal(Object.hasOwn(patch, 'ownerId'), false);
            Object.assign(row, clone(patch), { updatedAt: `task-rev${taskWrites.length + 1}` });
            return clone(row);
        },
        cancel: async (id, ownerId) => {
            taskWrites.push({ id, patch: { status: 'cancelled' }, ownerId });
            const row = tasks.find(item => item.id === id);
            assert.ok(row);
            assert.equal(ownerId, 'alice');
            assert.equal(row.ownerId, ownerId);
            assert.ok(['pending', 'doing'].includes(row.status));
            row.status = 'cancelled';
            row.updatedAt = `task-rev${taskWrites.length + 1}`;
            return clone(row);
        },
        remove: async () => assert.fail('a conversational cancellation must retain the task')
    };
    const eventsService = {
        checkSchedule: async () => ({ conflicts: [], suggestions: [], complete: true, warnings: [], fingerprint: 'fixture-agenda' }),
        list: async () => clone(events),
        create: async data => {
            eventCreates.push(clone(data));
            assert.equal(data.ownerId, 'alice');
            const row = { id: `created-event-${eventCreates.length}`, status: 'scheduled',
                updatedAt: 'created-event-rev', externalIds: {}, ...data };
            if (!row.endAt) row.endAt = new Date(Date.parse(row.startAt) + 90 * 60 * 1000).toISOString();
            if (!options.skipEventPersistence) events.push(clone(row));
            return clone(row);
        },
        update: async (id, patch, guard) => {
            eventWrites.push({ id, patch: clone(patch), guard: clone(guard) });
            const row = events.find(item => item.id === id);
            assert.ok(row, 'the exact event ID must exist');
            assert.equal(guard.ownerId, 'alice');
            assert.equal(row.ownerId, guard.ownerId);
            assert.deepEqual(guard.statuses, ['scheduled']);
            assert.equal(guard.skipSync, true);
            assert.deepEqual(guard.expected, eventSnapshot(row), 'event writes must guard the confirmed snapshot');
            assert.equal(Object.hasOwn(patch, 'ownerId'), false);
            Object.assign(row, clone(patch), { updatedAt: `event-rev${eventWrites.length + 1}` });
            return clone(row);
        },
        remove: async () => assert.fail('a conversational cancellation must retain the event')
    };
    const jobsService = {
        scheduleReminder: async args => {
            const row = { id: `reminder-${reminders.length + 1}`, status: 'scheduled', ...args };
            reminders.push(clone(row));
            return clone(row);
        },
        get: async id => clone(reminders.find(row => row.id === id) || null)
    };
    const runtime = {
        GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null },
        PremiumFeaturesService: { isEnabled: key => key === 'conversationContinuity' ? continuity : true }
    };
    const toolset = assistant.create({
        root: runtime, tasksService, eventsService, jobsService, storage,
        now: () => new Date(currentTime), timezone: () => 'America/Bogota',
        timeParser: options.timeParser || { parse: async text => {
            const phrase = assistant.normalize(text);
            if (phrase.includes('pasado manana a las 11')) return { iso: laterAtEleven, kind: 'instant' };
            if (phrase.includes('manana a las 10')) return { iso: tomorrowAtTen, kind: 'instant' };
            if (phrase.includes('hoy a las 16')) return { iso: todayAtFour, kind: 'instant' };
            return { iso: null };
        } }
    });
    return { toolset, tasks, events, taskCreates, eventCreates, taskWrites, eventWrites, reminders, storage,
        setUser: value => { userId = value; }, setTrusted: value => { trusted = value; },
        setContinuity: value => { continuity = value; },
        advance: ms => { currentTime = new Date(currentTime.getTime() + ms); } };
}

async function confirm(h, command, inputOptions) {
    const proposal = await h.toolset.dispatch(command, inputOptions);
    assert.equal(proposal.status, 'awaiting_confirmation', command);
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'complete', command);
    assert.equal(result.verified, true, command);
    return result;
}

async function seed(h, kind, title = kind === 'event' ? 'Evento nuevo' : 'Tarea nueva') {
    if (kind === 'event') return (await confirm(h, `agenda una reunión "${title}" hoy a las 16`)).result;
    const result = await h.toolset.dispatch(`crea la tarea "${title}"`);
    assert.equal(result.status, 'complete');
    assert.equal(result.verified, true);
    return result.result;
}

function writeCount(h) { return h.taskWrites.length + h.eventWrites.length; }
function realTimeParser() {
    let modelCalls = 0;
    const browser = { window: { GunterNlpLlm: { complete: async () => { modelCalls += 1; return '{}'; } } }, Date, Intl };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/time-parser.js'), 'utf8'), browser,
        { filename: 'js/core/time-parser.js' });
    return { ...browser.window.GunterTimeParser, getModelCalls: () => modelCalls };
}
function noForeignData(result) { assert.doesNotMatch(JSON.stringify(result), /BOB_SECRET/); }
function assertProposal(h, result, toolId, targetId) {
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(result.intent, toolId);
    assert.equal(result.requiresConfirmation, true);
    const pending = h.toolset.getPending();
    assert.equal(pending.toolId, toolId);
    assert.equal(pending.args.targetId, targetId, 'the proposal must use the remembered ID');
    assert.equal(pending.args.ownerId, 'alice');
    noForeignData(result);
    return pending;
}

const checks = [];
const test = (name, run) => checks.push({ name, run });

for (const kind of ['event', 'task']) {
    const toolId = kind === 'event' ? 'calendar.update' : 'tasks.update';
    const writesKey = kind === 'event' ? 'eventWrites' : 'taskWrites';
    const rowsKey = kind === 'event' ? 'events' : 'tasks';

    test(`${kind}: verified creation resolves move and better aliases to the exact record`, async () => {
        for (const phrase of ['muévela para mañana a las 10', 'mejor a mañana a las 10', 'mejor para mañana a las 10']) {
            const h = makeHarness();
            const row = await seed(h, kind);
            const original = clone(h[rowsKey].find(item => item.id === row.id));
            // A duplicate title introduced after creation must not make an ID reference ambiguous.
            h[rowsKey].push({ ...clone(original), id: 'duplicate-created-title' });
            const proposal = await h.toolset.dispatch(phrase, { inputSource: 'voice' });
            assertProposal(h, proposal, toolId, row.id);
            assert.match(proposal.reply, /9 de octubre/i);
            assert.match(proposal.reply, /por escrito|en pantalla/i);
            assert.equal(writeCount(h), 0);
            assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
            assert.equal(writeCount(h), 0);
            assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
            assert.equal(h[writesKey].length, 1);
            assert.equal(h[writesKey][0].id, row.id);
            assert.equal(h[rowsKey].find(item => item.id === 'duplicate-created-title').updatedAt, original.updatedAt);
            const updated = h[rowsKey].find(item => item.id === row.id);
            assert.equal(Date.parse(kind === 'event' ? updated.startAt : updated.dueAt), Date.parse(tomorrowAtTen));
            if (kind === 'event') {
                assert.equal(Date.parse(updated.endAt) - Date.parse(updated.startAt), Date.parse(original.endAt) - Date.parse(original.startAt));
                assert.deepEqual(Object.keys(h[writesKey][0].patch).sort(), ['endAt', 'startAt']);
            } else assert.deepEqual(Object.keys(h[writesKey][0].patch), ['dueAt']);
        }
    });

    test(`${kind}: a verified rename remembers ID when the new title is duplicated`, async () => {
        const h = makeHarness();
        const id = kind === 'event' ? 'own-event' : 'own-task';
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        await confirm(h, `renombra ${noun} "${id}" a "Elemento repetido"`);
        const baseline = writeCount(h);
        const proposal = await h.toolset.dispatch('muévela para mañana a las 10');
        assertProposal(h, proposal, toolId, id);
        assert.equal(writeCount(h), baseline);
        assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
        assert.equal(h[writesKey].at(-1).id, id);
        assert.equal(h[rowsKey].find(item => item.id === `second-${kind}`).updatedAt, `${kind}-rev1`);
    });

    test(`${kind}: a verified reschedule becomes the target of the next correction`, async () => {
        const h = makeHarness();
        const id = kind === 'event' ? 'own-event' : 'own-task';
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        await confirm(h, `reprograma ${noun} "${id}" para pasado mañana a las 11`);
        const original = clone(h[rowsKey].find(item => item.id === id));
        const proposal = await h.toolset.dispatch('mejor a mañana a las 10');
        assertProposal(h, proposal, toolId, id);
        assert.equal(h[writesKey].length, 1);
        assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
        assert.equal(h[writesKey].length, 2);
        const updated = h[rowsKey].find(item => item.id === id);
        assert.equal(Date.parse(kind === 'event' ? updated.startAt : updated.dueAt), Date.parse(tomorrowAtTen));
        if (kind === 'event') assert.equal(Date.parse(updated.endAt) - Date.parse(updated.startAt), Date.parse(original.endAt) - Date.parse(original.startAt));
    });

    test(`${kind}: correcting a pending update replaces its time and retains its original snapshot`, async () => {
        for (const mode of ['time', 'title']) {
            const h = makeHarness();
            const id = kind === 'event' ? 'own-event' : 'own-task';
            const noun = kind === 'event' ? 'el evento' : 'la tarea';
            const command = mode === 'time' ? `reprograma ${noun} "${id}" para pasado mañana a las 11`
                : `renombra ${noun} "${id}" a "Nombre propuesto"`;
            assert.equal((await h.toolset.dispatch(command, { inputSource: 'voice' })).status, 'awaiting_confirmation');
            const original = clone(h.toolset.getPending().args.snapshot);
            const correction = await h.toolset.dispatch('mejor para mañana a las 10', { inputSource: 'voice' });
            const pending = assertProposal(h, correction, toolId, id);
            assert.deepEqual(pending.args.snapshot, original, 'a correction must not refresh the original confirmation guard');
            assert.equal(Date.parse(kind === 'event' ? pending.args.startAt : pending.args.dueAt), Date.parse(tomorrowAtTen));
            assert.match(correction.reply, /9 de octubre/i);
            assert.match(correction.reply, /por escrito|en pantalla/i);
            assert.equal(writeCount(h), 0);
            assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
            assert.equal(writeCount(h), 0);
            assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
            assert.equal(h[writesKey].length, 1);
            assert.deepEqual(h[writesKey][0].guard.expected, original);
            assert.equal(h[rowsKey].find(item => item.id === id).title, original.title, 'the replaced rename must never be applied');
        }
    });

    test(`${kind}: an external edit before a correction cannot be accepted by refreshing the snapshot`, async () => {
        const h = makeHarness();
        const id = kind === 'event' ? 'own-event' : 'own-task';
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        assert.equal((await h.toolset.dispatch(`reprograma ${noun} "${id}" para pasado mañana a las 11`)).status, 'awaiting_confirmation');
        const original = clone(h.toolset.getPending().args.snapshot);
        h[rowsKey].find(item => item.id === id).updatedAt = 'external-edit-before-correction';
        const corrected = await h.toolset.dispatch('mejor para mañana a las 10');
        if (corrected.status === 'awaiting_confirmation') {
            assert.deepEqual(h.toolset.getPending().args.snapshot, original);
            assert.equal((await h.toolset.dispatch('confirmo')).status, 'error');
        } else {
            assert.ok(['needs_input', 'error'].includes(corrected.status));
            assert.equal(h.toolset.getPending(), null);
            assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
        }
        assert.equal(writeCount(h), 0);
    });

    test(`${kind}: an external edit after correction invalidates the new confirmation`, async () => {
        const h = makeHarness();
        const id = kind === 'event' ? 'own-event' : 'own-task';
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        assert.equal((await h.toolset.dispatch(`reprograma ${noun} "${id}" para pasado mañana a las 11`)).status, 'awaiting_confirmation');
        assertProposal(h, await h.toolset.dispatch('mejor para mañana a las 10'), toolId, id);
        h[rowsKey].find(item => item.id === id).title = 'Nombre cambiado fuera del asistente';
        const result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'error');
        assert.equal(writeCount(h), 0);
        assert.equal(h.toolset.getPending(), null);
        assert.doesNotMatch(result.reply, /Nombre cambiado fuera del asistente/);
    });

    test(`${kind}: cancel pronoun proposes a tool cancellation and requires written confirmation`, async () => {
        const h = makeHarness();
        const row = await seed(h, kind);
        const count = h[rowsKey].length;
        const tool = kind === 'event' ? 'calendar.cancel' : 'tasks.cancel';
        const proposal = await h.toolset.dispatch('cancélala', { inputSource: 'voice' });
        assertProposal(h, proposal, tool, row.id);
        assert.match(proposal.reply, /por escrito|en pantalla/i);
        assert.equal(writeCount(h), 0);
        assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
        assert.equal(writeCount(h), 0);
        assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
        assert.equal(h[rowsKey].length, count);
        assert.equal(h[rowsKey].find(item => item.id === row.id).status, 'cancelled');
        assert.equal(h[writesKey].length, 1);
        assert.equal(h[writesKey][0].id, row.id);
    });

    test(`${kind}: reminder follow-up asks for a time then uses the existing jobs service`, async () => {
        const h = makeHarness();
        const row = await seed(h, kind);
        const request = await h.toolset.dispatch('Y recuérdame eso también');
        assert.equal(request.status, 'needs_input');
        assert.match(request.reply, /cu[aá]ndo|fecha|hora/i);
        assert.ok(request.reply.includes(row.title));
        assert.equal(h.reminders.length, 0);
        assert.equal(writeCount(h), 0);
        const result = await h.toolset.dispatch('mañana a las 10');
        assert.equal(result.status, 'complete');
        assert.equal(result.intent, 'reminder.schedule');
        assert.equal(result.verified, true);
        assert.equal(h.reminders.length, 1);
        assert.equal(h.reminders[0].title, row.title);
        assert.equal(Date.parse(h.reminders[0].runAt), Date.parse(tomorrowAtTen));
        assert.equal(writeCount(h), 0);
    });

    test(`${kind}: an unverified creation cannot become conversational context`, async () => {
        const h = makeHarness(kind === 'event' ? { skipEventPersistence: true } : { skipTaskPersistence: true });
        const command = kind === 'event' ? 'agenda una reunión "Creación fallida" hoy a las 16' : 'crea la tarea "Creación fallida"';
        let result = await h.toolset.dispatch(command);
        if (result.status === 'awaiting_confirmation') result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'error');
        assert.equal(result.verified, false);
        assert.equal((await h.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
        assert.equal(h.toolset.getPending(), null);
        assert.equal(writeCount(h), 0);
    });
}

test('the last verified reference changes event to task and task to event even when IDs collide', async () => {
    const h = makeHarness();
    h.tasks[0].id = 'shared-id';
    h.events[0].id = 'shared-id';
    await confirm(h, 'renombra el evento "shared-id" a "Evento compartido"');
    assertProposal(h, await h.toolset.dispatch('muévela para mañana a las 10'), 'calendar.update', 'shared-id');
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    await confirm(h, 'renombra la tarea "shared-id" a "Tarea compartida"');
    assertProposal(h, await h.toolset.dispatch('mejor a mañana a las 10'), 'tasks.update', 'shared-id');
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.taskWrites.at(-1).id, 'shared-id');
    assert.equal(h.eventWrites.length, 1);
    await confirm(h, 'renombra el evento "shared-id" a "Evento más reciente"');
    assertProposal(h, await h.toolset.dispatch('muévela para mañana a las 10'), 'calendar.update', 'shared-id');
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.eventWrites.at(-1).id, 'shared-id');
    assert.equal(h.taskWrites.length, 2);
});

test('agenda is numbered with events first and resolves the second event by ID', async () => {
    const h = makeHarness();
    h.events[1].title = h.events[0].title;
    const listed = await h.toolset.dispatch('mi agenda');
    assert.equal(listed.status, 'complete');
    assert.equal(listed.intent, 'agenda.list');
    assert.match(listed.reply, /(?:^|\n)\s*1[.)]\s/);
    assert.match(listed.reply, /(?:^|\n)\s*2[.)]\s/);
    assert.match(listed.reply, /(?:^|\n)\s*3[.)]\s.*Revisar informe/);
    noForeignData(listed);
    const followUp = await h.toolset.dispatch('muévela para mañana a las 10');
    assert.equal(followUp.status, 'needs_input');
    assert.match(followUp.reply, /n[uú]mero|elige|cu[aá]l/i);
    assert.equal(h.toolset.getPending(), null);
    assert.equal(writeCount(h), 0);
    const chosen = await h.toolset.dispatch('la segunda', { inputSource: 'voice' });
    assertProposal(h, chosen, 'calendar.update', 'second-event');
    assert.equal(writeCount(h), 0);
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(writeCount(h), 0);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.eventWrites[0].id, 'second-event');
    assert.equal(h.events[0].startAt, todayAtFour);
});

test('agenda ordinals continue from events into tasks and preserve the selected task ID', async () => {
    const h = makeHarness();
    h.events.splice(1, 1);
    h.tasks[1].title = h.tasks[0].title;
    const listed = await h.toolset.dispatch('mi agenda');
    assert.equal(listed.status, 'complete');
    assert.match(listed.reply, /(?:^|\n)\s*1[.)]\s.*Revisión de producto/);
    assert.match(listed.reply, /(?:^|\n)\s*2[.)]\s.*Revisar informe/);
    assert.equal((await h.toolset.dispatch('mejor a mañana a las 10')).status, 'needs_input');
    assert.equal((await h.toolset.dispatch('99')).status, 'needs_input');
    assert.equal(writeCount(h), 0);
    assertProposal(h, await h.toolset.dispatch('la segunda'), 'tasks.update', 'own-task');
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.taskWrites[0].id, 'own-task');
    assert.equal(h.tasks[1].dueAt, todayAtFour);
    assert.equal(h.eventWrites.length, 0);
});

test('an agenda list replaces an older single-record reference rather than silently reusing it', async () => {
    const h = makeHarness();
    await seed(h, 'task');
    assert.equal((await h.toolset.dispatch('mi agenda')).status, 'complete');
    assert.equal((await h.toolset.dispatch('cancélala')).status, 'needs_input');
    assert.equal(h.toolset.getPending(), null);
    assert.equal(writeCount(h), 0);
    assertProposal(h, await h.toolset.dispatch('la segunda'), 'calendar.cancel', 'second-event');
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(writeCount(h), 0);
});

test('follow-ups without context ask for a target and create no proposal or reminder', async () => {
    for (const phrase of ['muévela para mañana a las 10', 'mejor a mañana a las 10', 'cancélala', 'recuérdame eso también']) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(phrase);
        assert.equal(result.status, 'needs_input', phrase);
        assert.equal(h.toolset.getPending(), null);
        assert.equal(writeCount(h), 0);
        assert.equal(h.reminders.length, 0);
        noForeignData(result);
    }
});

test('the injected clock expires verified references and numbered selections', async () => {
    for (const kind of ['event', 'task']) {
        const h = makeHarness();
        await seed(h, kind);
        h.advance(24 * 60 * 60 * 1000);
        assert.equal((await h.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
        assert.equal(h.toolset.getPending(), null);
        assert.equal(writeCount(h), 0);
    }
    const selected = makeHarness();
    await selected.toolset.dispatch('mi agenda');
    assert.equal((await selected.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
    selected.advance(24 * 60 * 60 * 1000);
    assert.notEqual((await selected.toolset.dispatch('la segunda')).status, 'awaiting_confirmation');
    assert.equal(selected.toolset.getPending(), null);
    assert.equal(writeCount(selected), 0);
});

test('the existing pending-confirmation expiration still rejects an obsolete yes', async () => {
    const pending = makeHarness();
    assert.equal((await pending.toolset.dispatch('reprograma el evento "own-event" para mañana a las 10')).status, 'awaiting_confirmation');
    const saved = pending.toolset.getPending();
    pending.storage.setItem('gunter_pending_tool_v1', JSON.stringify({ ...saved, createdAt: Date.now() - 24 * 60 * 60 * 1000 }));
    assert.equal(pending.toolset.getPending(), null);
    assert.notEqual((await pending.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(writeCount(pending), 0);
});

test('the injected context clock expires an unconfirmed update before its correction', async () => {
    for (const kind of ['event', 'task']) {
        const h = makeHarness();
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        const id = kind === 'event' ? 'own-event' : 'own-task';
        assert.equal((await h.toolset.dispatch(`reprograma ${noun} "${id}" para pasado mañana a las 11`)).status, 'awaiting_confirmation');
        h.advance(11 * 60 * 1000);
        const result = await h.toolset.dispatch('mejor para mañana a las 10');
        assert.equal(result.status, 'needs_input');
        assert.equal(h.toolset.getPending(), null);
        assert.notEqual((await h.toolset.dispatch('confirmo')).status, 'complete');
        assert.equal(writeCount(h), 0);
    }
});

test('date-only event follow-ups preserve the event hour and duration with the real local parser', async () => {
    const parser = realTimeParser();
    const h = makeHarness({ timeParser: parser });
    const row = await seed(h, 'event');
    const before = clone(h.events.find(item => item.id === row.id));
    const proposal = await h.toolset.dispatch('muévela para mañana');
    const pending = assertProposal(h, proposal, 'calendar.update', row.id);
    assert.equal(Date.parse(pending.args.startAt), Date.parse('2026-10-09T16:00:00-05:00'));
    assert.equal(Date.parse(pending.args.endAt) - Date.parse(pending.args.startAt), Date.parse(before.endAt) - Date.parse(before.startAt));
    assert.equal(writeCount(h), 0);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.eventWrites[0].id, row.id);
    assert.equal(parser.getModelCalls(), 0, 'deterministic follow-ups must not call a model');
});

test('time-only corrections preserve the proposed day with the real local parser', async () => {
    for (const kind of ['event', 'task']) {
        const parser = realTimeParser();
        const h = makeHarness({ timeParser: parser });
        const id = kind === 'event' ? 'own-event' : 'own-task';
        const toolId = kind === 'event' ? 'calendar.update' : 'tasks.update';
        const noun = kind === 'event' ? 'el evento' : 'la tarea';
        assert.equal((await h.toolset.dispatch(`reprograma ${noun} "${id}" para pasado mañana a las 11`)).status, 'awaiting_confirmation');
        const original = clone(h.toolset.getPending().args.snapshot);
        const correction = await h.toolset.dispatch('mejor a las tres');
        const pending = assertProposal(h, correction, toolId, id);
        assert.deepEqual(pending.args.snapshot, original);
        assert.equal(Date.parse(kind === 'event' ? pending.args.startAt : pending.args.dueAt), Date.parse('2026-10-10T03:00:00-05:00'));
        assert.equal(writeCount(h), 0);
        assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
        assert.equal(parser.getModelCalls(), 0, 'deterministic follow-ups must not call a model');
    }
});

test('task completion and reopening pronouns cannot be applied to an event reference', async () => {
    for (const phrase of ['complétala', 'termínala', 'reábrela']) {
        const h = makeHarness();
        await seed(h, 'event');
        const result = await h.toolset.dispatch(phrase);
        assert.equal(result.status, 'needs_input', phrase);
        assert.equal(h.toolset.getPending(), null);
        assert.equal(writeCount(h), 0);
        assert.equal(h.events.at(-1).status, 'scheduled');
    }
});

test('account changes and revoked trust block references, corrections, selections and reminders', async () => {
    for (const change of [h => h.setUser('bob'), h => h.setUser(null), h => h.setTrusted(false)]) {
        for (const kind of ['event', 'task']) {
            const h = makeHarness();
            await seed(h, kind, 'ALICE_PRIVATE_CONTEXT');
            change(h);
            const result = await h.toolset.dispatch('muévela para mañana a las 10');
            assert.equal(result.status, 'needs_input');
            assert.doesNotMatch(JSON.stringify(result), /ALICE_PRIVATE_CONTEXT|BOB_SECRET/);
            assert.equal(h.toolset.getPending(), null);
            assert.equal(writeCount(h), 0);
            assert.equal(h.reminders.length, 0);
        }
        const corrected = makeHarness();
        assert.equal((await corrected.toolset.dispatch('reprograma el evento "own-event" para pasado mañana a las 11')).status, 'awaiting_confirmation');
        change(corrected);
        const result = await corrected.toolset.dispatch('mejor para mañana a las 10');
        assert.equal(result.status, 'needs_input');
        assert.equal(corrected.toolset.getPending(), null);
        assert.equal(writeCount(corrected), 0);
        noForeignData(result);
        const selected = makeHarness();
        await selected.toolset.dispatch('mi agenda');
        assert.equal((await selected.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
        change(selected);
        assert.notEqual((await selected.toolset.dispatch('la segunda')).status, 'awaiting_confirmation');
        assert.equal(selected.toolset.getPending(), null);
        assert.equal(writeCount(selected), 0);
        const reminder = makeHarness();
        await seed(reminder, 'task', 'ALICE_PRIVATE_CONTEXT');
        assert.equal((await reminder.toolset.dispatch('recuérdame eso también')).status, 'needs_input');
        change(reminder);
        const denied = await reminder.toolset.dispatch('mañana a las 10');
        assert.notEqual(denied.status, 'complete');
        assert.doesNotMatch(JSON.stringify(denied), /ALICE_PRIVATE_CONTEXT|BOB_SECRET/);
        assert.equal(reminder.reminders.length, 0);
    }
});

test('disabling continuity clears references so enabling it cannot revive them', async () => {
    for (const kind of ['event', 'task']) {
        const h = makeHarness();
        await seed(h, kind);
        h.setContinuity(false);
        assert.equal((await h.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
        assert.equal(h.toolset.getPending(), null);
        h.setContinuity(true);
        assert.equal((await h.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
        assert.equal(h.toolset.getPending(), null);
        assert.equal(writeCount(h), 0);
    }
    const disabled = makeHarness({ continuity: false });
    await seed(disabled, 'task');
    assert.equal((await disabled.toolset.dispatch('recuérdame eso también')).status, 'needs_input');
    disabled.setContinuity(true);
    assert.equal((await disabled.toolset.dispatch('cancélala')).status, 'needs_input');
    assert.equal(writeCount(disabled), 0);
    assert.equal(disabled.reminders.length, 0);
});

test('disabling continuity clears remembered numbered selections and reminder continuations', async () => {
    const selected = makeHarness();
    await selected.toolset.dispatch('mi agenda');
    assert.equal((await selected.toolset.dispatch('muévela para mañana a las 10')).status, 'needs_input');
    selected.setContinuity(false);
    assert.notEqual((await selected.toolset.dispatch('la segunda')).status, 'awaiting_confirmation');
    selected.setContinuity(true);
    assert.notEqual((await selected.toolset.dispatch('la segunda')).status, 'awaiting_confirmation');
    assert.equal(selected.toolset.getPending(), null);
    assert.equal(writeCount(selected), 0);
    const reminder = makeHarness();
    await seed(reminder, 'event');
    assert.equal((await reminder.toolset.dispatch('recuérdame eso también')).status, 'needs_input');
    reminder.setContinuity(false);
    assert.notEqual((await reminder.toolset.dispatch('mañana a las 10')).status, 'complete');
    reminder.setContinuity(true);
    assert.notEqual((await reminder.toolset.dispatch('mañana a las 10')).status, 'complete');
    assert.equal(reminder.reminders.length, 0);
});

(async () => {
    let failures = 0;
    for (const check of checks) {
        try { await check.run(); }
        catch (error) {
            failures += 1;
            console.error(`conversational-followups: FAIL: ${check.name}`);
            console.error(error);
        }
    }
    if (failures) process.exitCode = 1;
    else console.log(`conversational-followups: PASS (${checks.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
