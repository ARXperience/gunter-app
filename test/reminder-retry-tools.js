/* Focused conversation checks; fake account-scoped jobs, no model/network. */
const assert = require('node:assert/strict');
const assistant = require('../js/core/assistant-tools.js');

const NOW = new Date('2026-10-12T15:00:00.000Z');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const snapshot = row => ({ id: row.id, type: row.type, title: row.title,
    runAt: row.runAt, priority: row.priority || 'normal', status: row.status,
    updatedAt: row.updatedAt, revision: Number.isSafeInteger(row.revision) ? row.revision : 0 });

function makeHarness(options = {}) {
    let userId = 'alice', deviceOwner = 'alice', trusted = true;
    let continuity = options.continuity !== false, currentTime = new Date(NOW);
    let backendError = null, readHook = null;
    const base = { type: 'reminder', status: 'failed', attempts: 3, maxAttempts: 3,
        priority: 'normal', createdAt: '2026-10-10T10:00:00.000Z',
        updatedAt: '2026-10-12T13:01:00.000Z', runAt: '2026-10-12T13:00:00.000Z', revision: 4,
        payload: { message: 'Información personal autorizada', tags: ['personal'] },
        lastError: 'push_subscription_missing Authorization=Bearer PRIVATE_SECRET_TOKEN', dedupeKey: 'existing-key' };
    const own = [
        { ...clone(base), id: 'job_vitamins', title: 'Tomar vitaminas' },
        { ...clone(base), id: 'job_contract', title: 'Revisar contrato' }
    ];
    if (options.duplicates) own.push(
        { ...clone(base), id: 'job_duplicate_1', title: 'Aviso repetido' },
        { ...clone(base), id: 'job_duplicate_2', title: 'Aviso repetido', runAt: '2026-10-12T14:00:00.000Z' }
    );
    const foreign = [{ ...clone(base), id: 'job_bob', title: 'BOB_PRIVATE_REMINDER' }];
    const linked = [{ id: 'linked_alice', ownerId: 'alice', title: 'Consulta médica',
        status: 'failed', fireAt: base.runAt, durable: false,
        meta: { eventLink: { version: 1, eventId: 'event_alice', offsetMs: 900000 } } }];
    const writes = [], calls = [], stored = new Map();
    const currentRows = () => userId === 'alice' ? own : userId === 'bob' ? foreign : [];
    const jobs = {
        list: async () => {
            calls.push('list'); if (readHook) await readHook('list');
            return clone(currentRows().filter(row => row.id !== options.hiddenFromList));
        },
        get: async id => {
            calls.push(`get:${id}`); if (readHook) await readHook('get');
            return clone(currentRows().find(row => row.id === id) || null);
        },
        retryReminder: async (id, guard) => {
            if (backendError) throw Object.assign(new Error(backendError), { code: backendError });
            assert.equal(userId, 'alice'); assert.equal(deviceOwner, userId);
            assert.equal(guard.ownerId, 'alice'); assert.equal(guard.confirmed, true);
            const row = currentRows().find(item => item.id === id);
            assert.ok(row); assert.equal(row.type, 'reminder'); assert.equal(row.status, 'failed');
            assert.deepEqual(guard.expected, snapshot(row), 'retry must guard the confirmed job snapshot');
            writes.push({ id, guard: clone(guard) });
            const next = { ...clone(row), status: 'scheduled', attempts: 0, lastError: null,
                result: null, nextAttemptAt: null,
                lastFailure: { code: 'delivery_unavailable', failedAt: row.updatedAt },
                runAt: new Date(currentTime).toISOString(),
                updatedAt: new Date(currentTime.getTime() + writes.length).toISOString(), revision: row.revision + 1 };
            if (!options.skipPersistence) Object.assign(row, next);
            if (options.badReturn) Object.assign(next, options.badReturn);
            return clone(next);
        },
        retry: async () => { throw new Error('must_not_use_unconfirmed_generic_retry'); },
        cancel: async () => { throw new Error('must_not_cancel_when_asked_to_retry'); },
        scheduleReminder: async () => { throw new Error('must_not_duplicate_when_asked_to_retry'); }
    };
    const toolset = assistant.create({ root: {
        GunterAuth: { canAccessLocalData: () => trusted, getUser: () => userId ? { id: userId } : null },
        localStorage: { getItem: key => key === 'gunter_device_user' ? deviceOwner : null },
        GunterControlPlane: options.controlPlane,
        PremiumFeaturesService: { isEnabled: key => key === 'conversationContinuity' ? continuity : true }
    }, jobsService: jobs, notificationsService: { list: async () => clone(linked) },
    storage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key) }, now: () => new Date(currentTime),
    timezone: () => 'America/Bogota' });
    return { toolset, own, foreign, linked, writes, calls, stored,
        setUser: value => { userId = value; deviceOwner = value; },
        setDeviceOwner: value => { deviceOwner = value; }, setTrusted: value => { trusted = value; },
        setContinuity: value => { continuity = value; },
        advance: ms => { currentTime = new Date(currentTime.getTime() + ms); },
        setBackendError: value => { backendError = value; }, setReadHook: hook => { readHook = hook; } };
}

async function propose(h, text = 'reintenta el recordatorio "Tomar vitaminas"', inputOptions, id = 'job_vitamins') {
    const result = await h.toolset.dispatch(text, inputOptions);
    assert.equal(result.status, 'awaiting_confirmation', `${text}: ${result.reply}`);
    assert.equal(result.intent, 'reminder.retry'); assert.equal(result.requiresConfirmation, true);
    assert.equal(h.writes.length, 0, 'a proposal cannot write');
    const pending = h.toolset.getPending();
    assert.equal(pending.toolId, 'reminder.retry');
    assert.equal(pending.args.targetId, id); assert.equal(pending.args.ownerId, 'alice');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET_TOKEN|BOB_PRIVATE/);
    assert.doesNotMatch(JSON.stringify(pending), /PRIVATE_SECRET_TOKEN|Authorization=|Información personal autorizada/);
    return pending;
}

async function inspect(h, text = 'por qué falló el recordatorio "Tomar vitaminas"') {
    const before = clone(h.own);
    const result = await h.toolset.dispatch(text);
    assert.equal(result.status, 'complete', result.reply); assert.equal(result.intent, 'reminder.inspect');
    assert.equal(result.verified, true); assert.equal(h.writes.length, 0);
    assert.deepEqual(h.own, before); assert.equal(h.toolset.getPending(), null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET_TOKEN|Authorization=|BOB_PRIVATE/);
    return result;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('failed reminder diagnosis is read-only and never exposes raw delivery logs or tokens', async () => {
    const h = makeHarness();
    const result = await inspect(h);
    assert.match(result.reply, /fall[oó]|fallido|error/i);
    assert.match(result.reply, /reintent|reintentar|notific|conex|canal|entrega/i);
});

test('unknown failures report uncertainty rather than inventing a cause', async () => {
    const h = makeHarness(); h.own[0].lastError = 'Unclassified PRIVATE_SECRET_TOKEN custom adapter failure';
    const result = await inspect(h, 'estado del recordatorio "Tomar vitaminas"');
    assert.match(result.reply, /no (?:pude|puedo)|sin|desconoc|detalle|causa|motivo|no hay/i);
    assert.doesNotMatch(result.reply, /tu micr[oó]fono|contrase[nñ]a incorrecta|el navegador bloque[oó]/i);
});

test('scheduled, running and retry-wait diagnoses reflect actual state without scheduling again', async () => {
    for (const [status, wording] of [['scheduled', /programad|pendiente|cola/i],
        ['running', /ejec|proces|curso/i], ['retry_wait', /reintent|espera|autom[aá]tic/i]]) {
        const h = makeHarness(); h.own[0].status = status;
        const result = await inspect(h, 'estado del recordatorio "Tomar vitaminas"');
        assert.match(result.reply, wording, status);
        assert.doesNotMatch(result.reply, /entregado y verificado|ya (?:lo )?recibiste|se entreg[oó] correctamente/i);
    }
});

test('completed job is not treated as proof that the user received a notification', async () => {
    const h = makeHarness(); h.own[0].status = 'completed';
    h.own[0].result = { delivered: false, push: { sent: 0, failed: 1 } };
    const result = await inspect(h, 'estado del recordatorio "Tomar vitaminas"');
    assert.match(result.reply, /complet|proces|finaliz/i);
    assert.match(result.reply, /no (?:puedo|garantiza|confirma|hay evidencia)|no es|no demuestra|no implica|sin (?:confirmaci[oó]n|prueba)|recepci[oó]n/i);
    assert.doesNotMatch(result.reply, /ya (?:lo )?recibiste|entregado y verificado|se entreg[oó] correctamente/i);
    const stored = makeHarness(); stored.own[0].status = 'completed';
    stored.own[0].result = { interventionId: 'intervention_own', push: {
        delivered: 1, rawProviderResponse: 'PRIVATE_SECRET_TOKEN' } };
    const accepted = await inspect(stored, 'estado del recordatorio "Tomar vitaminas"');
    assert.match(accepted.reply, /bandeja|registr[oó]/i);
    assert.match(accepted.reply, /proveedor acept[oó]/i);
    assert.match(accepted.reply, /no demuestra/i);
});

test('scheduled linked notices truthfully describe this browser, not the durable server queue', async () => {
    const h = makeHarness(); h.linked[0].status = 'scheduled';
    const result = await inspect(h, 'estado del recordatorio "Consulta médica"');
    assert.match(result.reply, /navegador|Gunter abierto/i);
    assert.match(result.reply, /vinculad|reuni[oó]n|Agenda/i);
    assert.doesNotMatch(result.reply, /el servidor local debe estar funcionando para procesarlo/i);
});

test('failed legacy records without an attempt count do not fabricate attempts', async () => {
    const h = makeHarness(); delete h.own[0].attempts;
    const result = await inspect(h);
    assert.match(result.reply, /sin un n[uú]mero de intentos verificable/i);
    assert.doesNotMatch(result.reply, /tras \d+ intentos|agot[oó]|m[aá]ximo de intentos/i);
});

test('a retry keeps identity and payload and says queued, not delivered', async () => {
    const h = makeHarness(); const original = clone(h.own[0]);
    await propose(h);
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'complete', result.reply); assert.equal(result.verified, true);
    assert.equal(h.writes.length, 1); assert.equal(h.own[0].status, 'scheduled'); assert.equal(h.own[0].attempts, 0);
    assert.equal(h.own[0].lastError, null); assert.equal(h.own[0].revision, original.revision + 1);
    for (const field of ['id', 'type', 'title', 'createdAt', 'priority', 'payload'])
        assert.deepEqual(h.own[0][field], original[field], field);
    assert.match(result.reply, /reintent|programad|cola|pendiente/i);
    assert.doesNotMatch(result.reply, /entregado y verificado|ya (?:lo )?recibiste|se entreg[oó] correctamente/i);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET_TOKEN|Authorization=|Información personal autorizada/);
});

test('spoken request can propose but spoken approval cannot authorize a retry', async () => {
    const h = makeHarness(); await propose(h, undefined, { inputSource: 'voice' });
    assert.equal((await h.toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(h.writes.length, 0);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(h.writes.length, 1);
});

test('rejecting the retry leaves the failed record unchanged and consumes authorization', async () => {
    const h = makeHarness(); const before = clone(h.own); await propose(h);
    assert.equal((await h.toolset.dispatch('no')).status, 'cancelled');
    assert.equal(h.toolset.getPending(), null); assert.deepEqual(h.own, before);
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete'); assert.equal(h.writes.length, 0);
});

test('only failed independent reminders permit retries, never terminal or already queued work', async () => {
    for (const patch of [{ status: 'scheduled' }, { status: 'retry_wait' }, { status: 'running' },
        { status: 'completed' }, { status: 'cancelled' }, { type: 'follow_up' }]) {
        const h = makeHarness(); Object.assign(h.own[0], patch);
        const result = await h.toolset.dispatch('reintenta el recordatorio "Tomar vitaminas"');
        assert.notEqual(result.status, 'awaiting_confirmation', JSON.stringify(patch));
        assert.notEqual(result.status, 'complete', JSON.stringify(patch));
        assert.equal(h.writes.length, 0); assert.equal(h.toolset.getPending(), null);
    }
});

test('event-linked reminders cannot be retried independently', async () => {
    const h = makeHarness();
    const result = await h.toolset.dispatch('reintenta el recordatorio "Consulta médica"');
    assert.notEqual(result.status, 'awaiting_confirmation'); assert.notEqual(result.status, 'complete');
    assert.equal(h.writes.length, 0); assert.match(result.reply, /vinculad|reuni[oó]n|Agenda/i);
});

test('duplicate exact titles require a numbered choice and never choose automatically', async () => {
    const h = makeHarness({ duplicates: true });
    const result = await h.toolset.dispatch('reintenta el recordatorio "Aviso repetido"');
    assert.equal(result.status, 'needs_input'); assert.match(result.reply, /1\.|2\./);
    assert.equal(h.writes.length, 0); assert.equal(h.toolset.getPending(), null);
    await propose(h, '2', undefined, 'job_duplicate_2');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes[0].id, 'job_duplicate_2');
    assert.equal(h.own.find(row => row.id === 'job_duplicate_1').status, 'failed');
});

test('failed listing establishes typed ordinal references and excludes other states', async () => {
    const h = makeHarness(); h.own[1].status = 'scheduled';
    const listed = await h.toolset.dispatch('mis recordatorios fallidos');
    assert.equal(listed.status, 'complete', listed.reply); assert.equal(listed.intent, 'jobs.list');
    assert.match(listed.reply, /1\./); assert.match(listed.reply, /Tomar vitaminas/);
    assert.doesNotMatch(JSON.stringify(listed), /Revisar contrato|PRIVATE_SECRET_TOKEN|BOB_PRIVATE/);
    await propose(h, 'reintenta el primero');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete'); assert.equal(h.writes.length, 1);
});

test('failed-list ordinal diagnosis resolves the correct exact ID without a write', async () => {
    const h = makeHarness(); await h.toolset.dispatch('mis recordatorios fallidos');
    const result = await inspect(h, 'por qué falló el primero');
    assert.match(result.reply, /Tomar vitaminas/); assert.doesNotMatch(result.reply, /Revisar contrato/);
});

test('inspection establishes an exact target for retry pronouns even if another title duplicates later', async () => {
    const h = makeHarness(); await inspect(h);
    h.own.push({ ...clone(h.own[0]), id: 'job_new_duplicate' });
    await propose(h, 'reinténtalo');
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.writes[0].id, 'job_vitamins');
    assert.equal(h.own.find(row => row.id === 'job_new_duplicate').status, 'failed');
});

test('bare pronoun after listing several reminders asks which one to retry', async () => {
    const h = makeHarness(); await h.toolset.dispatch('mis recordatorios fallidos');
    const result = await h.toolset.dispatch('reinténtalo');
    assert.equal(result.status, 'needs_input'); assert.match(result.reply, /1\.|2\.|cu[aá]l|n[uú]mero/i);
    assert.equal(h.writes.length, 0); await propose(h, '1');
});

test('nonexistent and partial titles are not fuzzy-matched to another account or reminder', async () => {
    for (const title of ['Vitaminas', 'No existe', 'BOB_PRIVATE_REMINDER']) {
        const h = makeHarness();
        const result = await h.toolset.dispatch(`reintenta el recordatorio "${title}"`);
        assert.notEqual(result.status, 'awaiting_confirmation'); assert.notEqual(result.status, 'complete');
        assert.equal(h.writes.length, 0); assert.equal(h.toolset.getPending(), null);
        assert.doesNotMatch(JSON.stringify(result.result || {}), /BOB_PRIVATE/);
    }
});

test('explicit IDs absent from the bounded list use scoped get, not a duplicate creation', async () => {
    const h = makeHarness({ hiddenFromList: 'job_vitamins' });
    await propose(h, 'reintenta el recordatorio "job_vitamins"');
    assert.ok(h.calls.includes('get:job_vitamins'));
    assert.equal((await h.toolset.dispatch('sí')).status, 'complete'); assert.equal(h.writes.length, 1);
});

test('changes after proposal invalidate its snapshot instead of retrying stale state', async () => {
    for (const patch of [{ revision: 8 }, { status: 'scheduled', attempts: 0 },
        { title: 'Cambiado en otra pestaña' }, { updatedAt: '2026-10-12T15:00:01.000Z' }]) {
        const h = makeHarness(); await propose(h); Object.assign(h.own[0], patch);
        const before = clone(h.own[0]); const result = await h.toolset.dispatch('sí');
        assert.notEqual(result.status, 'complete'); assert.equal(h.writes.length, 0);
        assert.deepEqual(h.own[0], before); assert.match(result.reply, /cambi|actual|reintent|programad|ejec|nuevo/i);
    }
});

test('backend CAS and persistence errors do not claim success or create another reminder', async () => {
    for (const code of ['job_changed', 'job_persist_failed', 'job_not_retryable']) {
        const h = makeHarness(); const before = clone(h.own); await propose(h); h.setBackendError(code);
        const result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'error'); assert.equal(result.verified, false);
        assert.equal(h.writes.length, 0); assert.deepEqual(h.own, before);
        assert.doesNotMatch(result.reply, /reintento (?:guardado|programado) y verificado|job_changed|job_persist_failed/);
    }
});

test('unknown retry service failures disclose no raw credentials or logs and do not invent the cause', async () => {
    const h = makeHarness(); const before = clone(h.own); await propose(h);
    h.setBackendError('Authorization=Bearer PRIVATE_SECRET_TOKEN sensitive provider URL');
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'error'); assert.equal(result.verified, false);
    assert.equal(h.writes.length, 0); assert.deepEqual(h.own, before);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET_TOKEN|Authorization=|sensitive provider URL/);
    assert.doesNotMatch(result.reply, /tu micr[oó]fono|contrase[nñ]a incorrecta/i);
});

test('returned scheduled data without persisted retry fails reread verification', async () => {
    const h = makeHarness({ skipPersistence: true }); const before = clone(h.own); await propose(h);
    const result = await h.toolset.dispatch('sí');
    assert.equal(result.status, 'error'); assert.equal(result.verified, false);
    assert.deepEqual(h.own, before); assert.equal(h.writes.length, 1);
});

test('a result tampering with title, priority or delivery state cannot pass persisted verification', async () => {
    for (const badReturn of [{ title: 'Not the confirmed title' }, { priority: 'urgent' },
        { status: 'completed' }, { attempts: 1 }, { lastError: 'Still failed' }]) {
        const h = makeHarness({ badReturn }); await propose(h);
        const result = await h.toolset.dispatch('sí');
        assert.equal(result.status, 'error', JSON.stringify(badReturn)); assert.equal(result.verified, false);
    }
});

test('account switches clear pending retries and references without leaking either account', async () => {
    const h = makeHarness(); await propose(h); h.setUser('bob');
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete');
    assert.equal(h.toolset.getPending(), null); assert.equal(h.writes.length, 0);
    const result = await h.toolset.dispatch('reinténtalo');
    assert.notEqual(result.status, 'awaiting_confirmation'); assert.doesNotMatch(JSON.stringify(result), /Tomar vitaminas/);
});

test('untrusted, legacy and stale-device sessions cannot inspect or propose account-scoped jobs', async () => {
    for (const block of [h => h.setTrusted(false), h => h.setUser(null), h => h.setUser('local-user'),
        h => h.setDeviceOwner('bob')]) {
        for (const command of ['reintenta el recordatorio "Tomar vitaminas"', 'estado del recordatorio "Tomar vitaminas"']) {
            const h = makeHarness(); block(h);
            const result = await h.toolset.dispatch(command);
            assert.notEqual(result.status, 'complete'); assert.notEqual(result.status, 'awaiting_confirmation');
            assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 0);
        }
    }
});

test('account changes during awaited reads cannot produce a stale diagnosis or retry proposal', async () => {
    for (const command of ['reintenta el recordatorio "Tomar vitaminas"', 'estado del recordatorio "Tomar vitaminas"']) {
        const h = makeHarness(); h.setReadHook(() => h.setUser('bob'));
        const result = await h.toolset.dispatch(command);
        assert.notEqual(result.status, 'complete'); assert.notEqual(result.status, 'awaiting_confirmation');
        assert.equal(h.writes.length, 0); assert.doesNotMatch(JSON.stringify(result.result || {}), /BOB_PRIVATE/);
    }
});

test('an adapter explicitly returning a foreign owner is never adopted into the current account', async () => {
    for (const command of ['reintenta el recordatorio "Tomar vitaminas"', 'estado del recordatorio "Tomar vitaminas"']) {
        const h = makeHarness(); h.own[0].ownerId = 'bob';
        const result = await h.toolset.dispatch(command);
        assert.notEqual(result.status, 'complete'); assert.notEqual(result.status, 'awaiting_confirmation');
        assert.equal(h.writes.length, 0);
    }
});

test('expired proposals and references never implicitly authorize stale retries', async () => {
    const h = makeHarness(); await propose(h);
    const pending = JSON.parse(h.stored.get('gunter_pending_tool_v1'));
    pending.createdAt = Date.now() - 6 * 60 * 1000;
    h.stored.set('gunter_pending_tool_v1', JSON.stringify(pending));
    assert.notEqual((await h.toolset.dispatch('sí')).status, 'complete'); assert.equal(h.writes.length, 0);
    const other = makeHarness(); await inspect(other); other.advance(11 * 60 * 1000);
    assert.notEqual((await other.toolset.dispatch('reinténtalo')).status, 'awaiting_confirmation');
    assert.equal(other.writes.length, 0);
});

test('disabled continuity preserves direct operations but clears remembered reminder IDs', async () => {
    const h = makeHarness({ continuity: false }); await inspect(h);
    assert.notEqual((await h.toolset.dispatch('reinténtalo')).status, 'awaiting_confirmation');
    await propose(h);
    const other = makeHarness(); await inspect(other); other.setContinuity(false);
    assert.notEqual((await other.toolset.dispatch('reinténtalo')).status, 'awaiting_confirmation');
    assert.equal(other.writes.length, 0);
});

test('retry executes through canonical confirmed L3 and publishes only persisted reconsulted evidence', async () => {
    const plans = [], transitions = [];
    const h = makeHarness({ controlPlane: {
        planTask: async input => { plans.push(clone(input)); return { run: { taskId: 'controlled-reminder-retry' } }; },
        transitionTask: async input => { transitions.push(clone(input)); return {}; }
    } });
    await propose(h); assert.equal(plans.length, 0);
    assert.equal((await h.toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(plans.length, 1); assert.equal(plans[0].skill, 'reminder.retry');
    assert.equal(plans[0].autonomy, 'L3'); assert.equal(plans[0].confirmed, true); assert.equal(plans[0].inputSource, 'text');
    const verified = transitions.find(entry => entry.state === 'verified'); assert.ok(verified);
    assert.equal(verified.evidence.persistedId, 'job_vitamins'); assert.equal(verified.evidence.reconsulted, true);
    assert.equal(verified.evidence.revision, h.own[0].revision); assert.equal(verified.evidence.verified, true);
    assert.doesNotMatch(JSON.stringify(verified), /PRIVATE_SECRET_TOKEN/);
});

test('disabled entitlement/control-plane policy rejects before any write with no unguarded fallback', async () => {
    const h = makeHarness({ controlPlane: { planTask: async () => {
        throw Object.assign(new Error('entitlement_required'), { code: 'entitlement_required' });
    } } });
    const before = clone(h.own); await propose(h);
    const result = await h.toolset.dispatch('confirmo');
    assert.equal(result.status, 'error'); assert.equal(result.verified, false);
    assert.equal(h.writes.length, 0); assert.deepEqual(h.own, before);
});

test('blanket and compound requests never retry only a guessed record or half the command', async () => {
    for (const command of ['reintenta todos mis recordatorios fallidos',
        'reintenta el recordatorio "Tomar vitaminas" y cancela el recordatorio "Revisar contrato"']) {
        const h = makeHarness(); const before = clone(h.own);
        const result = await h.toolset.dispatch(command);
        assert.notEqual(result.status, 'awaiting_confirmation', command); assert.notEqual(result.status, 'complete', command);
        assert.equal(h.writes.length, 0); assert.equal(h.toolset.getPending(), null); assert.deepEqual(h.own, before);
    }
});

test('literal reminder titles containing settings or media orders never change operation routing', async () => {
    for (const title of ['Cambia la voz', 'Pon un mix en YouTube']) {
        const h = makeHarness(); h.own[0].title = title;
        const diagnosis = await inspect(h, `estado del recordatorio "${title}"`);
        assert.equal(diagnosis.intent, 'reminder.inspect');
        assert.equal(h.writes.length, 0);
        await propose(h, `reintenta el recordatorio "${title}"`);
        const result = await h.toolset.dispatch('confirmo');
        assert.equal(result.status, 'complete', result.reply);
        assert.equal(result.intent, 'reminder.retry'); assert.equal(h.writes.length, 1);
        assert.equal(h.own[0].title, title);
    }
});

(async () => {
    let failures = 0;
    for (const check of tests) {
        try { await check.run(); }
        catch (error) { failures += 1; console.error(`reminder-retry-tools: FAIL: ${check.name}`); console.error(error); }
    }
    if (failures) process.exitCode = 1;
    else console.log(`reminder-retry-tools: PASS (${tests.length} checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
