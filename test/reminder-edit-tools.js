const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');

const NOW = new Date('2026-10-12T15:00:00.000Z');
const TOMORROW = '2026-10-13T10:00:00-05:00';
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = row => ({ id: row.id, type: row.type, title: row.title,
    runAt: row.runAt, priority: row.priority, status: row.status,
    updatedAt: row.updatedAt, revision: Number.isSafeInteger(row.revision) ? row.revision : 0 });

function makeHarness(options = {}) {
    let userId = 'alice', deviceOwner = 'alice', trusted = true;
    let continuity = options.continuity !== false, currentTime = new Date(NOW);
    let backendError = null, readHook = null;
    const base = { type: 'reminder', status: 'scheduled', attempts: 0, priority: 'normal',
        createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', revision: 1,
        payload: { message: 'Información personal autorizada', tags: ['personal'] }, dedupeKey: 'existing-key' };
    const own = [
        { ...base, id: 'job_vitamins', title: 'Tomar vitaminas', runAt: '2026-10-13T09:00:00-05:00' },
        { ...base, id: 'job_contract', title: 'Revisar contrato', runAt: '2026-10-13T11:00:00-05:00' }
    ].map(clone);
    if (options.duplicates) own.push(
        { ...clone(base), id: 'job_duplicate_1', title: 'Aviso repetido', runAt: '2026-10-13T14:00:00-05:00' },
        { ...clone(base), id: 'job_duplicate_2', title: 'Aviso repetido', runAt: '2026-10-13T15:00:00-05:00' }
    );
    const foreign = [{ ...clone(base), id: 'job_bob', title: 'BOB_PRIVATE_REMINDER', runAt: TOMORROW }];
    const linked = [{ id: 'linked_alice', ownerId: 'alice', title: 'Consulta médica',
        status: 'scheduled', fireAt: '2026-10-13T16:00:00-05:00', durable: false,
        meta: { eventLink: { version: 1, eventId: 'event_alice', offsetMs: 900000 } } },
    { id: 'linked_bob', ownerId: 'bob', title: 'BOB_PRIVATE_LINKED', status: 'scheduled',
        fireAt: TOMORROW, meta: { eventLink: { version: 1, eventId: 'event_bob', offsetMs: 900000 } } }];
    const writes = [], cancels = [], creates = [], calls = [];
    const stored = new Map();
    const currentRows = () => userId === 'alice' ? own : userId === 'bob' ? foreign : [];
    const jobs = {
        list: async () => { calls.push('list'); if (readHook) await readHook('list');
            return clone(currentRows().filter(row => row.id !== options.hiddenFromList)); },
        get: async id => { calls.push(`get:${id}`); if (readHook) await readHook('get');
            return clone(currentRows().find(row => row.id === id) || null); },
        updateReminder: async (id, patch, guard) => {
            if (backendError) throw Object.assign(new Error(backendError), { code: backendError });
            assert.equal(userId, 'alice');
            assert.equal(deviceOwner, userId);
            assert.equal(guard.ownerId, 'alice');
            assert.equal(guard.confirmed, true, 'the durable write must carry explicit authorization');
            const row = currentRows().find(item => item.id === id);
            assert.ok(row);
            assert.equal(row.type, 'reminder');
            assert.equal(row.status, 'scheduled');
            assert.equal(row.attempts, 0);
            assert.deepEqual(guard.expected, snapshot(row), 'the write must guard the fully confirmed job snapshot');
            assert.ok(Object.keys(patch).length > 0);
            assert.ok(Object.keys(patch).every(key => ['title', 'runAt', 'priority'].includes(key)),
                'editing must not replace identity, owner, payload or delivery state');
            writes.push({ id, patch: clone(patch), guard: clone(guard) });
            const next = { ...clone(row), ...clone(patch), updatedAt: new Date(NOW.getTime() + writes.length).toISOString(),
                revision: (Number.isSafeInteger(row.revision) ? row.revision : 0) + 1 };
            if (!options.skipPersistence) Object.assign(row, next);
            return clone(next);
        },
        cancel: async id => {
            const row = currentRows().find(item => item.id === id);
            assert.ok(row);
            cancels.push(id); row.status = 'cancelled'; return clone(row);
        },
        scheduleReminder: async data => {
            creates.push(clone(data));
            const row = { ...clone(base), ...data, id: `job_created_${creates.length}` };
            own.push(row); return clone(row);
        }
    };
    let parserModelCalls = 0;
    const browser = { window: { GunterNlpLlm: { complete: async () => { parserModelCalls += 1; return '{}'; } } }, Date, Intl };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/core/time-parser.js'), 'utf8'), browser,
        { filename: 'js/core/time-parser.js' });
    const toolset = assistant.create({ root: {
        GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null },
        localStorage: { getItem: key => key === 'gunter_device_user' ? deviceOwner : null },
        GunterControlPlane: options.controlPlane,
        PremiumFeaturesService: { isEnabled: key => key === 'conversationContinuity' ? continuity : true }
    }, jobsService: jobs, notificationsService: { list: async () => clone(linked) },
    storage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key) }, now: () => new Date(currentTime),
    timezone: () => 'America/Bogota', timeParser: browser.window.GunterTimeParser });
    return { toolset, own, foreign, linked, writes, cancels, creates, calls, stored,
        parser: browser.window.GunterTimeParser, parserModelCalls: () => parserModelCalls,
        setUser: value => { userId = value; deviceOwner = value; }, setDeviceOwner: value => { deviceOwner = value; },
        setTrusted: value => { trusted = value; }, setContinuity: value => { continuity = value; },
        advance: ms => { currentTime = new Date(currentTime.getTime() + ms); },
        setBackendError: value => { backendError = value; }, setReadHook: hook => { readHook = hook; } };
}

async function propose(h, text, inputOptions, targetId = 'job_vitamins') {
    const result = await h.toolset.dispatch(text, inputOptions);
    assert.equal(result.status, 'awaiting_confirmation', `${text}: ${result.reply}`);
    assert.equal(result.intent, 'reminder.update');
    assert.equal(result.requiresConfirmation, true);
    assert.equal(h.writes.length, 0, 'a proposal must never perform a write');
    const pending = h.toolset.getPending();
    assert.equal(pending.toolId, 'reminder.update');
    assert.equal(pending.args.targetId, targetId);
    assert.equal(pending.args.ownerId, 'alice');
    assert.doesNotMatch(JSON.stringify(result), /BOB_PRIVATE/);
    return pending;
}

async function approve(h, command) {
    await propose(h, command);
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'complete', result.reply);
    assert.equal(result.verified, true);
    assert.equal(h.writes.length, 1);
    return result;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('explicit impossible calendar dates are rejected locally without asking a model to reinterpret them', async () => {
    const h = makeHarness();
    for (const phrase of ['31/02/2027 a las 10', '29/02/2027 a las 10',
        '31 de febrero de 2027 a las 10', '31 de abril de 2027 a las 10']) {
        const result = await h.parser.parse(phrase, NOW, 'America/Bogota');
        assert.equal(result.iso, null, phrase);
    }
    assert.equal(h.parserModelCalls(), 0);
});

test('valid leap dates retain the requested day and time after calendar validation', async () => {
    const h = makeHarness();
    const result = await h.parser.parse('29/02/2028 a las 10', NOW, 'America/Bogota');
    assert.equal(Date.parse(result.iso), Date.parse('2028-02-29T10:00:00-05:00'));
    assert.equal(h.parserModelCalls(), 0);
});

test('rename preserves identity, creation date, payload and unrelated fields after explicit confirmation', async () => {
    const h = makeHarness();
    const original = clone(h.own[0]);
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas después del desayuno"');
    assert.equal(h.own[0].title, 'Vitaminas después del desayuno');
    for (const field of ['id', 'type', 'createdAt', 'runAt', 'payload'])
        assert.deepEqual(h.own[0][field], original[field], field);
    assert.equal(h.own[0].revision, original.revision + 1);
    assert.deepEqual(h.writes[0].patch, { title: 'Vitaminas después del desayuno' });
});

test('reschedule uses the existing job and exposes the new time before authorization', async () => {
    const h = makeHarness();
    const pending = await propose(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
    assert.equal(Date.parse(pending.args.runAt), Date.parse(TOMORROW));
    assert.equal(h.creates.length, 0);
    const result = await h.toolset.dispatch('sí');
    assert.equal(result.status, 'complete');
    assert.equal(Date.parse(h.own[0].runAt), Date.parse(TOMORROW));
    assert.equal(h.own[0].id, 'job_vitamins');
    assert.equal(h.own[1].title, 'Revisar contrato');
});

test('job snapshots without revision use zero without migrating or replacing the record', async () => {
    const h = makeHarness(); delete h.own[0].revision;
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    assert.equal(h.writes[0].guard.expected.revision, 0);
    assert.equal(h.own[0].revision, 1);
});

test('ambiguous exact titles request a numbered choice and never choose the first automatically', async () => {
    const h = makeHarness({ duplicates: true });
    const result = await h.toolset.dispatch('reprograma el recordatorio "Aviso repetido" para mañana a las 10');
    assert.equal(result.status, 'needs_input');
    assert.match(result.reply, /1\.|2\./);
    assert.equal(h.writes.length, 0);
    assert.equal(h.toolset.getPending(), null);
    await propose(h, '2', undefined, 'job_duplicate_2');
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.writes[0].id, 'job_duplicate_2');
    assert.equal(h.own.find(row => row.id === 'job_duplicate_1').runAt, '2026-10-13T14:00:00-05:00');
});

test('nonexistent or partial names are not fuzzy-matched to another reminder', async () => {
    for (const title of ['Vitaminas', 'No existe', 'BOB_PRIVATE_REMINDER']) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(`renombra el recordatorio "${title}" a "Nuevo"`);
        assert.notEqual(result.status, 'complete');
        assert.notEqual(result.status, 'awaiting_confirmation');
        assert.equal(h.writes.length, 0);
        assert.equal(h.toolset.getPending(), null);
        assert.doesNotMatch(JSON.stringify(result.result || {}), /BOB_PRIVATE/);
    }
});

test('missing changes and invalid, past or ambiguous dates never write or invent a timestamp', async () => {
    for (const command of [
        'renombra el recordatorio "Tomar vitaminas"',
        'reprograma el recordatorio "Tomar vitaminas"',
        'reprograma el recordatorio "Tomar vitaminas" para ayer a las 10',
        'reprograma el recordatorio "Tomar vitaminas" para mañana',
        'reprograma el recordatorio "Tomar vitaminas" para 31/02/2027 a las 10',
        'reprograma el recordatorio "Tomar vitaminas" para en algún momento'
    ]) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(command);
        assert.notEqual(result.status, 'complete', command);
        assert.equal(h.writes.length, 0);
        if (result.status === 'awaiting_confirmation') {
            const denied = await h.toolset.dispatch('confirmo');
            assert.notEqual(denied.status, 'complete', command);
            assert.equal(h.writes.length, 0);
        }
    }
});

test('scheduled reminders already attempted, retries, running, terminal and follow-ups are not editable', async () => {
    for (const patch of [{ attempts: 1 }, { status: 'retry_wait' }, { status: 'running' },
        { status: 'completed' }, { status: 'cancelled' }, { status: 'failed' }, { type: 'follow_up' }]) {
        const h = makeHarness(); Object.assign(h.own[0], patch);
        const result = await h.toolset.dispatch('renombra el recordatorio "Tomar vitaminas" a "Otro título"');
        assert.notEqual(result.status, 'awaiting_confirmation', JSON.stringify(patch));
        assert.notEqual(result.status, 'complete', JSON.stringify(patch));
        assert.equal(h.writes.length, 0);
    }
});

test('linked local notices cannot be independently edited and disclose their meeting-controlled schedule', async () => {
    const h = makeHarness();
    const result = await h.toolset.dispatch('reprograma el recordatorio "Consulta médica" para mañana a las 10');
    assert.notEqual(result.status, 'complete');
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.match(result.reply, /reuni[oó]n|vinculado|Agenda/i);
});

test('numbered listing permits typed reminder references without exposing other accounts', async () => {
    const h = makeHarness();
    const listed = await h.toolset.dispatch('mis recordatorios programados');
    assert.equal(listed.status, 'complete');
    assert.match(listed.reply, /1\.\s*Recordatorio/i);
    assert.match(listed.reply, /2\.\s*Recordatorio/i);
    assert.doesNotMatch(JSON.stringify(listed), /BOB_PRIVATE/);
    await propose(h, 'mueve el primero para mañana a las 10');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes[0].id, 'job_vitamins');
});

test('a listing with several reminders asks which record a bare pronoun means', async () => {
    const h = makeHarness();
    await h.toolset.dispatch('mis recordatorios programados');
    const question = await h.toolset.dispatch('muévelo para mañana a las 10');
    assert.equal(question.status, 'needs_input');
    assert.match(question.reply, /1\.|2\.|cu[aá]l|n[uú]mero/i);
    assert.equal(h.writes.length, 0);
    await propose(h, '1');
});

test('a verified edit establishes an exact ID reference for follow-up rename and move', async () => {
    const h = makeHarness();
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    h.writes.length = 0;
    h.own.push({ ...clone(h.own[0]), id: 'job_same_title_after_edit' });
    await propose(h, 'muévelo para mañana a las 10');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes[0].id, 'job_vitamins');
    h.writes.length = 0;
    await propose(h, 'renómbralo a "Después del desayuno"');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.own[0].title, 'Después del desayuno');
    assert.equal(h.own.find(row => row.id === 'job_same_title_after_edit').title, 'Vitaminas');
});

test('correcting only the hour preserves the pending reminder proposal day', async () => {
    const h = makeHarness();
    h.own[0].runAt = '2026-10-12T18:00:00-05:00';
    await propose(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
    const original = clone(h.toolset.getPending());
    await propose(h, 'mejor a las 11');
    const corrected = h.toolset.getPending();
    assert.equal(Date.parse(corrected.args.runAt), Date.parse('2026-10-13T11:00:00-05:00'));
    assert.equal(corrected.args.targetId, original.args.targetId);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(Date.parse(h.own[0].runAt), Date.parse('2026-10-13T11:00:00-05:00'));
});

test('hour-only follow-up on a verified edit preserves its reminder date, not today', async () => {
    const h = makeHarness();
    await approve(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
    h.writes.length = 0;
    await propose(h, 'muévelo a las 11');
    assert.equal(Date.parse(h.toolset.getPending().args.runAt), Date.parse('2026-10-13T11:00:00-05:00'));
});

test('cancel follow-up reuses the existing confirmed jobs cancellation instead of editing a delivery state', async () => {
    const h = makeHarness();
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    const proposal = await h.toolset.dispatch('cancélalo');
    assert.equal(proposal.intent, 'jobs.cancel');
    assert.equal(proposal.status, 'awaiting_confirmation');
    assert.equal(h.cancels.length, 0);
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.deepEqual(h.cancels, ['job_vitamins']);
});

test('a spoken command may prepare changes but spoken approval never authorizes a write', async () => {
    const h = makeHarness();
    await propose(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10', { inputSource: 'voice' });
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.writes.length, 1);
});

test('rejecting a proposal preserves all data and consumes its authorization', async () => {
    const h = makeHarness(); const before = clone(h.own);
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(h.toolset.getPending(), null);
    assert.deepEqual(h.own, before);
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
});

test('changed job snapshots are rechecked after approval and do not overwrite another edit', async () => {
    for (const patch of [{ title: 'Editado en otra pestaña' }, { revision: 4 }, { status: 'running', attempts: 1 },
        { updatedAt: '2026-10-12T15:00:01.000Z' }]) {
        const h = makeHarness();
        await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
        Object.assign(h.own[0], patch);
        const changed = clone(h.own[0]);
        const result = await h.toolset.dispatch('confirmo');
        assert.notEqual(result.status, 'complete');
        assert.equal(h.writes.length, 0);
        assert.deepEqual(h.own[0], changed);
        assert.match(result.reply, /cambi|actual|activo|ejec|nuevo|iniciado/i);
    }
});

test('account switches invalidate pending changes and exact-ID follow-up references', async () => {
    const h = makeHarness();
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    h.setUser('bob');
    assert.notEqual((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.toolset.getPending(), null);
    assert.equal(h.writes.length, 0);
    const result = await h.toolset.dispatch('muévelo para mañana a las 10');
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.doesNotMatch(JSON.stringify(result), /Tomar vitaminas/);
});

test('unverified, legacy and stale-device sessions cannot read, propose or confirm reminder edits', async () => {
    for (const block of [h => h.setTrusted(false), h => h.setUser(null),
        h => h.setUser('local-user'), h => h.setDeviceOwner('bob')]) {
        const h = makeHarness(); block(h);
        const result = await h.toolset.dispatch('renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
        assert.notEqual(result.status, 'awaiting_confirmation');
        assert.notEqual(result.status, 'complete');
        assert.equal(h.writes.length, 0);
        assert.equal(h.calls.length, 0, 'an untrusted account must not call the cookie-scoped job API');
    }
    const h = makeHarness();
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    h.setDeviceOwner('bob');
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
    assert.equal(h.toolset.getPending(), null);
});

test('a session change during an awaited read cannot produce an old-account proposal', async () => {
    const h = makeHarness();
    h.setReadHook(() => h.setUser('bob'));
    const result = await h.toolset.dispatch('renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(result.result || {}), /BOB_PRIVATE/);
});

test('an explicitly foreign owner returned by a malformed adapter is never adopted as the current account', async () => {
    const h = makeHarness(); h.own[0].ownerId = 'bob';
    const result = await h.toolset.dispatch('renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.notEqual(result.status, 'complete');
    assert.equal(h.writes.length, 0);
});

test('expired proposals and references never implicitly authorize or remember a target forever', async () => {
    const h = makeHarness();
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    // Pending authorization uses wall-clock Date.now; the injectable clock is
    // intentionally used only for scheduling and transient references.
    const pending = JSON.parse(h.stored.get('gunter_pending_tool_v1'));
    pending.createdAt = Date.now() - 6 * 60 * 1000;
    h.stored.set('gunter_pending_tool_v1', JSON.stringify(pending));
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes.length, 0);
    const other = makeHarness();
    await approve(other, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    other.writes.length = 0;
    other.advance(11 * 60 * 1000);
    assert.notEqual((await other.toolset.dispatch('muévelo para mañana a las 10')).status, 'awaiting_confirmation');
    assert.equal(other.writes.length, 0);
});

test('continuity-off retains direct edits but disables remembered reminder references', async () => {
    const h = makeHarness({ continuity: false });
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    h.writes.length = 0;
    assert.notEqual((await h.toolset.dispatch('muévelo para mañana a las 10')).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    await propose(h, 'reprograma el recordatorio "Vitaminas" para mañana a las 10');
});

test('switching continuity off clears previously remembered IDs without clearing stored reminders', async () => {
    const h = makeHarness();
    await approve(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    h.writes.length = 0; h.setContinuity(false);
    const result = await h.toolset.dispatch('renómbralo a "Después del desayuno"');
    assert.notEqual(result.status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal(h.own[0].title, 'Vitaminas');
});

test('backend stale and duplicate guards report failure without claiming persistence or falling back to creation', async () => {
    for (const code of ['job_changed', 'job_duplicate']) {
        const h = makeHarness();
        await propose(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
        h.setBackendError(code);
        const result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'error');
        assert.equal(result.verified, false);
        assert.equal(h.writes.length, 0);
        assert.equal(h.creates.length, 0);
        assert.doesNotMatch(result.reply, /actualizado y verificado|reprogramado y verificado/i);
        assert.doesNotMatch(result.reply, /job_changed|job_duplicate/);
    }
});

test('an adapter returning an edited row without saving it fails verification instead of reporting success', async () => {
    const h = makeHarness({ skipPersistence: true });
    const original = clone(h.own[0]);
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'error');
    assert.equal(result.verified, false);
    assert.deepEqual(h.own[0], original);
    assert.doesNotMatch(result.reply, /actualizado y verificado|reprogramado y verificado/i);
});

test('confirmed reminder edits use canonical L3 control planning and publish reconsulted persistence evidence', async () => {
    const plans = [], transitions = [];
    const h = makeHarness({ controlPlane: {
        planTask: async input => { plans.push(clone(input)); return { run: { taskId: 'controlled-reminder-edit' } }; },
        transitionTask: async input => { transitions.push(clone(input)); return {}; }
    } });
    await propose(h, 'renombra el recordatorio "Tomar vitaminas" a "Vitaminas"');
    assert.equal(plans.length, 0, 'a proposal must not authorize a control-plane run');
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(plans.length, 1);
    assert.equal(plans[0].skill, 'reminder.update');
    assert.equal(plans[0].autonomy, 'L3', 'editing must not elevate itself to automatic L4');
    assert.equal(plans[0].confirmed, true);
    assert.equal(plans[0].inputSource, 'text');
    const verified = transitions.find(entry => entry.state === 'verified');
    assert.ok(verified);
    assert.equal(verified.taskId, 'controlled-reminder-edit');
    assert.equal(verified.evidence.verified, true);
    assert.equal(verified.evidence.persistedId, 'job_vitamins');
    assert.equal(verified.evidence.reconsulted, true);
    assert.equal(verified.evidence.revision, h.own[0].revision);
    assert.ok(verified.evidence.revision > h.writes[0].guard.expected.revision);
    assert.deepEqual(transitions.map(entry => entry.state),
        ['started', 'result_received', 'verifying', 'verified', 'completed']);
});

test('a disabled control-plane feature is a hard rejection and cannot fall back to an unguarded edit', async () => {
    const plans = [];
    const h = makeHarness({ controlPlane: {
        planTask: async input => {
            plans.push(clone(input));
            throw Object.assign(new Error('feature_flag_disabled'), { code: 'feature_flag_disabled' });
        }
    } });
    const original = clone(h.own);
    await propose(h, 'reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'error');
    assert.equal(result.verified, false);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].skill, 'reminder.update');
    assert.equal(plans[0].confirmed, true);
    assert.equal(h.writes.length, 0);
    assert.equal(h.creates.length, 0);
    assert.deepEqual(h.own, original);
    assert.doesNotMatch(result.reply, /actualizado y verificado|reprogramado y verificado/i);
});

test('compound edits do not apply one half, while quoted titles containing action words remain literal', async () => {
    const h = makeHarness(); const original = clone(h.own);
    const result = await h.toolset.dispatch('renombra el recordatorio "Tomar vitaminas" a "Vitaminas" y reprograma el recordatorio "Tomar vitaminas" para mañana a las 10');
    assert.equal(result.status, 'needs_input');
    assert.match(result.reply, /un cambio|una parte|compuesta/i);
    assert.equal(h.writes.length, 0);
    assert.equal(h.creates.length, 0);
    assert.equal(h.toolset.getPending(), null);
    assert.deepEqual(h.own, original);
    const literal = makeHarness();
    literal.own[0].title = 'Vitaminas y reprograma mañana';
    await approve(literal, 'renombra el recordatorio "Vitaminas y reprograma mañana" a "Vitaminas y reprograma otro aviso"');
    assert.equal(literal.own[0].title, 'Vitaminas y reprograma otro aviso');
});

test('an explicit job ID reuses account-scoped get when absent from the bounded listing', async () => {
    const h = makeHarness({ hiddenFromList: 'job_vitamins' });
    await approve(h, 'reprograma el recordatorio "job_vitamins" para mañana a las 10');
    assert.ok(h.calls.includes('get:job_vitamins'));
    assert.equal(h.writes[0].id, 'job_vitamins');
    assert.equal(Date.parse(h.own[0].runAt), Date.parse(TOMORROW));
    const foreign = await h.toolset.dispatch('renombra el recordatorio "job_bob" a "Otro"');
    assert.notEqual(foreign.status, 'awaiting_confirmation');
    assert.notEqual(foreign.status, 'complete');
    assert.equal(h.writes.length, 1);
    assert.doesNotMatch(JSON.stringify(foreign), /BOB_PRIVATE/);
});

test('ordinary reminder creation continues to route to the existing persistent schedule tool', async () => {
    const h = makeHarness();
    const result = await h.toolset.dispatch('recuérdame "Llamar a Ana" mañana a las 10');
    assert.equal(result.intent, 'reminder.schedule');
    assert.equal(result.status, 'complete');
    assert.equal(h.creates.length, 1);
    assert.equal(h.writes.length, 0);
    assert.match(h.creates[0].title, /Llamar a Ana/);
});

(async () => {
    let failures = 0;
    for (const check of tests) {
        try { await check.run(); }
        catch (error) { failures += 1; console.error(`reminder-edit-tools: FAIL: ${check.name}`); console.error(error); }
    }
    if (failures) process.exitCode = 1;
    else console.log(`reminder-edit-tools: PASS (${tests.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
