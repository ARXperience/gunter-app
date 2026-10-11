const assert = require('node:assert/strict');
const assistant = require('../js/core/assistant-tools.js');

const NOW = new Date('2026-10-08T15:00:00.000Z');
const START = '2026-10-09T10:00:00-05:00';
const ZONE = 'America/Bogota';
const CREATE = 'agenda una reunión "Revisión semanal" mañana a las 10';
const MOVE = 'reprograma la reunión "Equipo" para mañana a las 10';
const clone = value => JSON.parse(JSON.stringify(value));
const millis = value => Date.parse(value);
const snapshot = row => ({ title: row.title, startAt: row.startAt || null,
    endAt: row.endAt || null, status: row.status || 'scheduled', updatedAt: row.updatedAt || null,
    rrule: row.rrule || null, externalIds: row.externalIds || {} });

function makeHarness(options = {}) {
    let userId = 'alice';
    let trusted = true;
    let revision = 1;
    let failInspection = false;
    let complete = true;
    let reportHook = null;
    const stored = new Map();
    const checks = [];
    const creates = [];
    const writes = [];
    const taskWrites = [];
    const rows = [{ id: 'own-event', title: 'Equipo', ownerId: 'alice', status: 'scheduled',
        startAt: '2026-10-08T16:00:00-05:00', endAt: '2026-10-08T17:30:00-05:00',
        updatedAt: 'original-rev', rrule: null, externalIds: {}, tags: ['trabajo'], location: 'Sala principal' },
    { id: 'foreign-event', title: 'BOB_PRIVATE_EVENT', ownerId: 'bob', status: 'scheduled',
        startAt: START, endAt: '2026-10-09T11:00:00-05:00', updatedAt: 'bob-rev' }].map(clone);
    const tasks = [{ id: 'own-task', title: 'Informe', ownerId: 'alice', status: 'pending',
        dueAt: '2026-10-08T16:00:00-05:00', updatedAt: 'task-rev' }];
    const service = {
        list: async () => clone(rows),
        checkSchedule: async args => {
            checks.push(clone(args));
            assert.equal(args.ownerId, 'alice', 'schedule inspection must use the verified account');
            assert.equal(args.timezone, ZONE);
            assert.ok(Number.isFinite(millis(args.startAt)));
            assert.ok(millis(args.endAt) > millis(args.startAt));
            if (reportHook) await reportHook(args);
            if (failInspection) throw new Error('SCHEDULE_UNAVAILABLE');
            const duration = millis(args.endAt) - millis(args.startAt);
            const conflict = millis(args.startAt) === millis(START) || revision > 1;
            const suggestions = complete && conflict ? ['2026-10-09T13:00:00-05:00', '2026-10-09T15:00:00-05:00']
                .map(startAt => ({ startAt, endAt: new Date(millis(startAt) + duration).toISOString() })) : [];
            return { conflicts: conflict ? [{ id: 'busy-event', title: revision > 1 ? 'Cita agregada' : 'Consulta médica',
                startAt: START, endAt: '2026-10-09T11:00:00-05:00' }] : [], suggestions, complete,
                warnings: complete ? ['Revisión limitada a los eventos locales de tu cuenta.'] : ['No pude comprobar las series recurrentes.'],
                fingerprint: `schedule-rev-${revision}-${args.startAt}-${args.endAt}` };
        },
        create: async (data, guard) => {
            assert.equal(data.ownerId, 'alice');
            assert.ok(guard?.scheduleExpected, 'create must carry the inspected schedule to the atomic write guard');
            assert.equal(guard.scheduleExpected.timezone, ZONE);
            assert.match(guard.scheduleExpected.fingerprint, /^schedule-rev-/);
            assert.equal(data.pushToGoogle, false, 'local scheduling must not enable cloud synchronization');
            creates.push({ data: clone(data), guard: clone(guard) });
            const row = { id: `created-${creates.length}`, status: 'scheduled', updatedAt: 'new-rev',
                externalIds: {}, ...data };
            if (!row.endAt) row.endAt = new Date(millis(row.startAt) + 60 * 60 * 1000).toISOString();
            rows.push(clone(row));
            return clone(row);
        },
        update: async (id, patch, guard) => {
            const row = rows.find(item => item.id === id);
            assert.equal(guard.ownerId, 'alice');
            assert.equal(row.ownerId, guard.ownerId);
            assert.deepEqual(guard.expected, snapshot(row));
            assert.equal(guard.skipSync, true);
            if (patch.startAt) {
                assert.ok(guard.scheduleExpected);
                assert.equal(guard.scheduleExpected.timezone, ZONE);
            }
            writes.push({ id, patch: clone(patch), guard: clone(guard) });
            Object.assign(row, patch, { updatedAt: `edit-${writes.length}` });
            return clone(row);
        }
    };
    if (options.noInspection) delete service.checkSchedule;
    const taskService = { list: async () => clone(tasks), update: async (id, patch, guard) => {
        const row = tasks.find(item => item.id === id);
        assert.equal(guard.ownerId, 'alice');
        taskWrites.push({ id, patch: clone(patch) });
        Object.assign(row, patch, { updatedAt: 'task-edited' });
        return clone(row);
    } };
    const toolset = assistant.create({ root: {
        GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null },
        PremiumFeaturesService: { isEnabled: () => true }
    }, eventsService: service, tasksService: taskService,
    storage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key) }, now: () => NOW, timezone: () => ZONE,
    timeParser: { parse: async text => {
        if (assistant.normalize(text).includes('manana a las 10')) return { iso: START, kind: 'instant' };
        return { iso: null };
    } } });
    return { toolset, rows, checks, creates, writes, taskWrites, stored,
        setUser: id => { userId = id; }, setTrusted: value => { trusted = value; },
        changeSchedule: () => { revision += 1; }, setUnavailable: value => { failInspection = value; },
        setComplete: value => { complete = value; }, setInspectionHook: hook => { reportHook = hook; } };
}

const totalWrites = h => h.creates.length + h.writes.length + h.taskWrites.length;
async function propose(h, text = CREATE, options) {
    const result = await h.toolset.dispatch(text, options);
    assert.equal(result.status, 'awaiting_confirmation', text);
    assert.equal(totalWrites(h), 0, 'inspection and proposals must be read-only');
    return result;
}
function pendingReport(h) {
    const pending = h.toolset.getPending();
    assert.ok(pending?.args?.scheduleCheck, 'the pending proposal must retain its inspected schedule');
    return pending;
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('create inspects account-local schedule and explains conflicts, options and scope before confirmation', async () => {
    const h = makeHarness();
    const proposal = await propose(h);
    assert.equal(h.checks.length, 1);
    assert.match(proposal.reply, /Consulta médica/);
    assert.match(proposal.reply, /opci[oó]n\s*1/i);
    assert.match(proposal.reply, /opci[oó]n\s*2/i);
    assert.match(proposal.reply, /local/i);
    assert.doesNotMatch(proposal.reply, /BOB_PRIVATE_EVENT/);
    const pending = pendingReport(h);
    assert.equal(pending.args.ownerId, 'alice');
    assert.equal(pending.args.scheduleCheck.timezone, ZONE);
    assert.ok(pending.args.scheduleCheck.fingerprint);
    assert.equal(pending.args.scheduleCheck.conflicts[0].id, 'busy-event');
});

test('confirming the requested occupied slot explicitly rechecks and passes an atomic schedule guard', async () => {
    const h = makeHarness();
    await propose(h);
    const report = pendingReport(h).args.scheduleCheck;
    const result = await h.toolset.dispatch('sí');
    assert.equal(result.status, 'complete');
    assert.equal(result.verified, true);
    assert.equal(h.checks.length, 2);
    assert.equal(h.creates.length, 1);
    assert.equal(millis(h.creates[0].data.startAt), millis(START));
    assert.equal(h.creates[0].guard.scheduleExpected.fingerprint, report.fingerprint);
});

test('explicit option selectors produce a new guarded proposal, preserve duration and never authorize a write', async () => {
    for (const [text, index] of [['opción 1', 0], ['opcion 2', 1], ['la segunda opción', 1]]) {
        const h = makeHarness();
        await propose(h);
        const original = pendingReport(h);
        const selected = original.args.scheduleCheck.suggestions[index];
        assert.equal(h.toolset.isContextualFollowUp(text), true);
        const next = await h.toolset.dispatch(text);
        assert.equal(next.status, 'awaiting_confirmation', text);
        assert.equal(totalWrites(h), 0);
        const pending = pendingReport(h);
        assert.equal(millis(pending.args.startAt), millis(selected.startAt));
        assert.equal(millis(pending.args.endAt), millis(selected.endAt));
        assert.equal(millis(pending.args.endAt) - millis(pending.args.startAt),
            millis(original.args.endAt) - millis(original.args.startAt));
        const result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'complete');
        assert.equal(h.creates.length, 1);
        assert.equal(millis(h.creates[0].data.startAt), millis(selected.startAt));
    }
});

test('bare numbers do not ambiguously select a schedule alternative', async () => {
    const h = makeHarness();
    await propose(h);
    assert.equal(h.toolset.isContextualFollowUp('1'), false);
    const result = await h.toolset.dispatch('1');
    assert.notEqual(result.status, 'complete');
    assert.notEqual(millis(h.toolset.getPending()?.args?.startAt), millis('2026-10-09T13:00:00-05:00'));
    assert.equal(totalWrites(h), 0);
});

test('nonexistent alternative keeps the original proposal unexecuted and asks for valid selection', async () => {
    const h = makeHarness();
    await propose(h);
    const original = clone(h.toolset.getPending());
    const result = await h.toolset.dispatch('opción 9');
    assert.ok(['needs_input', 'awaiting_confirmation'].includes(result.status));
    assert.deepEqual(h.toolset.getPending().args, original.args);
    assert.equal(totalWrites(h), 0);
});

test('moving an existing event excludes itself, preserves its ninety-minute duration and retains snapshot guards', async () => {
    const h = makeHarness();
    await propose(h, MOVE);
    assert.equal(h.checks[0].excludeId, 'own-event');
    const originalSnapshot = clone(pendingReport(h).args.snapshot);
    const selected = pendingReport(h).args.scheduleCheck.suggestions[1];
    assert.equal((await h.toolset.dispatch('opción 2')).status, 'awaiting_confirmation');
    const next = pendingReport(h);
    assert.equal(next.args.targetId, 'own-event');
    assert.deepEqual(next.args.snapshot, originalSnapshot);
    assert.equal(millis(next.args.endAt) - millis(next.args.startAt), 90 * 60 * 1000);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 1);
    assert.equal(millis(h.writes[0].patch.startAt), millis(selected.startAt));
    assert.deepEqual(h.writes[0].guard.expected, originalSnapshot);
    assert.equal(h.writes[0].guard.scheduleExpected.fingerprint, next.args.scheduleCheck.fingerprint);
    assert.deepEqual(h.rows[0].tags, ['trabajo']);
    assert.equal(h.rows[0].location, 'Sala principal');
});

test('new schedule information invalidates approval and requires another informed confirmation without writing', async () => {
    const h = makeHarness();
    await propose(h);
    const oldFingerprint = pendingReport(h).args.scheduleCheck.fingerprint;
    h.changeSchedule();
    const result = await h.toolset.dispatch('sí');
    assert.ok(['needs_input', 'awaiting_confirmation'].includes(result.status), result.reply);
    assert.equal(totalWrites(h), 0);
    if (h.toolset.getPending()) assert.notEqual(pendingReport(h).args.scheduleCheck.fingerprint, oldFingerprint);
    assert.match(result.reply, /cambi|actualiz|Cita agregada|confirm/i);
});

test('inspection failure before a proposal never claims a free slot or writes', async () => {
    for (const unavailable of ['missing', 'throwing']) {
        const h = makeHarness({ noInspection: unavailable === 'missing' });
        if (unavailable === 'throwing') h.setUnavailable(true);
        const result = await h.toolset.dispatch(CREATE);
        assert.ok(['needs_input', 'error'].includes(result.status), result.reply);
        assert.equal(totalWrites(h), 0);
        assert.doesNotMatch(result.reply, /horario libre|sin conflictos|sin cruces/i);
        assert.equal(h.toolset.getPending(), null);
    }
});

test('inspection failure after approval blocks persistence without success wording', async () => {
    const h = makeHarness();
    await propose(h);
    h.setUnavailable(true);
    const result = await h.toolset.dispatch('sí');
    assert.ok(['needs_input', 'error'].includes(result.status), result.reply);
    assert.equal(totalWrites(h), 0);
    assert.equal(h.toolset.getPending(), null);
    assert.doesNotMatch(result.reply, /creado y verificado|reprogramado y verificado/i);
});

test('partial inspection shows its limitation and never promises unsupported free-slot alternatives', async () => {
    const h = makeHarness();
    h.setComplete(false);
    const proposal = await propose(h);
    assert.match(proposal.reply, /series recurrentes/);
    assert.doesNotMatch(proposal.reply, /opci[oó]n\s*[12]|sin conflictos|sin cruces|horario libre/i);
    assert.equal(pendingReport(h).args.scheduleCheck.complete, false);
    assert.equal(h.toolset.isContextualFollowUp('opción 1'), false);
});

test('voice requests and option selections continue to require written or on-screen approval', async () => {
    const h = makeHarness();
    await propose(h, CREATE, { inputSource: 'voice' });
    assert.equal((await h.toolset.dispatch('opción 1', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    const result = await h.toolset.dispatch('sí', { inputSource: 'voice' });
    assert.equal(result.status, 'awaiting_confirmation');
    assert.match(result.reply, /por escrito|en pantalla/i);
    assert.equal(totalWrites(h), 0);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
});

test('account switch, logout and trust revocation cannot approve a previous account proposal', async () => {
    for (const revoke of [h => h.setUser('bob'), h => h.setUser(null), h => h.setTrusted(false)]) {
        const h = makeHarness();
        await propose(h);
        revoke(h);
        const result = await h.toolset.dispatch('sí');
        assert.notEqual(result.status, 'complete');
        assert.equal(totalWrites(h), 0);
        assert.equal(h.toolset.getPending(), null);
        assert.equal(h.toolset.isContextualFollowUp('opción 1'), false);
    }
});

test('account change while asynchronous schedule inspection is pending cannot expose or persist a proposal', async () => {
    const h = makeHarness();
    h.setInspectionHook(() => { h.setUser('bob'); });
    const result = await h.toolset.dispatch(CREATE);
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.notEqual(result.status, 'complete');
    assert.doesNotMatch(result.reply, /Consulta médica/);
    assert.equal(totalWrites(h), 0);
    assert.equal(h.toolset.getPending(), null);
});

test('event snapshot changes remain protected even when the schedule fingerprint itself is unchanged', async () => {
    const h = makeHarness();
    await propose(h, MOVE);
    h.rows[0].title = 'Equipo modificado en otra pestaña';
    h.rows[0].updatedAt = 'changed-elsewhere';
    const result = await h.toolset.dispatch('sí');
    assert.notEqual(result.status, 'complete');
    assert.equal(totalWrites(h), 0);
});

test('renaming, cancellation and tasks reuse their existing flows without schedule inspection', async () => {
    for (const text of ['renombra la reunión "Equipo" a "Equipo central"', 'cancela la reunión "Equipo"',
        'reprograma la tarea "Informe" para mañana a las 10']) {
        const h = makeHarness({ noInspection: true });
        const proposal = await h.toolset.dispatch(text);
        assert.equal(proposal.status, 'awaiting_confirmation', text);
        assert.equal(h.checks.length, 0);
        assert.equal(totalWrites(h), 0);
        assert.equal((await h.toolset.dispatch('sí')).status, 'complete', text);
        assert.equal(totalWrites(h), 1);
    }
});

test('multi-step validation never approves a hidden overlap or incomplete coverage', async () => {
    for (const complete of [true, false]) {
        const h = makeHarness();
        h.setComplete(complete);
        const prepared = await h.toolset.prepareMatch(h.toolset.detect(CREATE));
        const result = await h.toolset.validatePrepared(prepared);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'calendar_schedule_attention');
        assert.match(result.reply, /Consulta médica|recurrentes/);
        assert.match(result.reply, /individual/);
        assert.equal(totalWrites(h), 0);
        await assert.rejects(h.toolset.executeWorkflowStep({ skill: 'calendar.create', input: prepared.args }), /multipaso/);
        assert.equal(totalWrites(h), 0);
    }
});

test('negative cancellation and expired proposals clear alternatives without a write', async () => {
    const cancelled = makeHarness();
    await propose(cancelled);
    assert.equal((await cancelled.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(cancelled.toolset.getPending(), null);
    assert.equal(cancelled.toolset.isContextualFollowUp('opción 1'), false);
    assert.equal(totalWrites(cancelled), 0);
    const expired = makeHarness();
    await propose(expired);
    const pending = expired.toolset.getPending();
    pending.createdAt = Date.now() - 6 * 60 * 1000;
    expired.stored.set('gunter_pending_tool_v1', JSON.stringify(pending));
    assert.equal(expired.toolset.isContextualFollowUp('opción 1'), false);
    assert.notEqual((await expired.toolset.dispatch('opción 1')).status, 'awaiting_confirmation');
    assert.equal(expired.toolset.getPending(), null);
    assert.equal(totalWrites(expired), 0);
});

(async () => {
    let failures = 0;
    for (const { name, run } of tests) {
        try { await run(); }
        catch (error) {
            failures += 1;
            console.error(`calendar-schedule-tools: FAIL: ${name}`);
            console.error(error);
        }
    }
    if (failures) process.exitCode = 1;
    else console.log(`calendar-schedule-tools: PASS (${tests.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
