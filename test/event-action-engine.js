/* Focalized checks for the legacy event dispatch path; no server or IndexedDB. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/core/action-engine.js'), 'utf8');
const snapshot = row => ({ title: row.title, startAt: row.startAt, endAt: row.endAt,
    status: row.status || 'scheduled', updatedAt: row.updatedAt,
    rrule: row.rrule || null, externalIds: row.externalIds || {} });

function fixture({ trusted = true, event = {}, accountId = 'account-a', storage = new Map() } = {}) {
    let row = { id: 'evt-owned', ownerId: 'account-a', title: 'Reunión',
        startAt: '2026-10-10T18:00:00.000Z', endAt: '2026-10-10T19:00:00.000Z',
        status: 'scheduled', updatedAt: '2026-10-10T12:00:00.000Z',
        rrule: null, externalIds: {}, ...event };
    const calls = { create: [], list: [], update: [], remove: 0, writes: 0, sync: 0 };
    const window = {
        GunterAuth: { canAccessLocalData: () => trusted, isVerified: () => true,
            getUser: () => ({ id: accountId }) },
        GunterEventsService: {
            create: async data => {
                calls.create.push(data);
                if (data.pushToGoogle) calls.sync += 1;
                return { ...data, id: 'evt-created' };
            },
            list: async options => { calls.list.push(options); return [row]; },
            update: async (id, patch, options) => {
                calls.update.push({ id, patch, options });
                // The service owns the atomic expected-snapshot guard. This stub
                // rejects stale data before mutating, so the test checks delegation.
                if (Object.entries(options.expected).some(([key, value]) =>
                    JSON.stringify(snapshot(row)[key]) !== JSON.stringify(value))) {
                    throw new Error('EVENT_CHANGED');
                }
                row = { ...row, ...patch };
                calls.writes += 1;
                if (!options.skipSync) calls.sync += 1;
                return row;
            },
            remove: async () => { calls.remove += 1; throw new Error('Do not delete cancelled events'); }
        }
    };
    vm.runInNewContext(source, { window, Date, performance: { now: () => 1 },
        localStorage: { getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value) } }, { filename: 'action-engine.js' });
    let step = 0;
    return { calls, storage, row: () => row,
        run: (type, payload, options = {}) => window.GunterActionEngine.execute({
            needsConfirmation: options.needsConfirmation ?? true,
            steps: [{ id: options.id || `step-${++step}`, type, payload }] },
        Object.prototype.hasOwnProperty.call(options, 'confirmation') ? options.confirmation : { accepted: true },
        { userId: 'legacy-user' }) };
}

function guarded(call, expected) {
    assert.equal(call.options.ownerId, 'account-a');
    assert.deepEqual(Array.from(call.options.statuses), ['scheduled']);
    assert.strictEqual(call.options.expected, expected);
    assert.equal(call.options.skipSync, true);
}

(async () => {
    for (const type of ['create_event', 'update_event', 'delete_event']) {
        for (const confirmation of [undefined, null, {}, { accepted: 'yes' }, { accepted: false }]) {
            const unconfirmed = fixture();
            const result = await unconfirmed.run(type, { id: unconfirmed.row().id,
                expected: snapshot(unconfirmed.row()), patch: { title: 'No aplicar' } },
            { needsConfirmation: false, confirmation });
            assert.equal(result.executed.length, 0, 'an event cannot bypass explicit confirmation through the plan flag');
            assert.equal(result.pending.length, confirmation?.accepted === false ? 0 : 1);
            assert.equal(unconfirmed.calls.create.length + unconfirmed.calls.list.length + unconfirmed.calls.update.length, 0);
            assert.equal(unconfirmed.storage.size, 0);
        }
    }
    const unaffected = fixture();
    const suggestion = await unaffected.run('suggest', { message: 'Sin escritura' },
        { needsConfirmation: false, confirmation: undefined });
    assert.equal(suggestion.executed.length, 1, 'the event confirmation gate does not change other step types');

    const create = fixture();
    const created = await create.run('create_event', { title: 'Nueva',
        startAt: create.row().startAt, ownerId: 'payload-owner', pushToGoogle: true }, { needsConfirmation: false });
    assert.equal(created.failed.length, 0);
    assert.equal(create.calls.create[0].ownerId, 'account-a', 'authenticated account overrides legacy/context/payload owners');
    assert.equal(create.calls.create[0].pushToGoogle, true, 'preserve existing explicit create sync');
    assert.equal(create.calls.sync, 1);

    const denied = fixture({ trusted: false });
    for (const type of ['create_event', 'update_event', 'delete_event']) {
        assert.equal((await denied.run(type, { id: denied.row().id, expected: snapshot(denied.row()) })).failed.length, 1);
    }
    assert.equal(denied.calls.create.length + denied.calls.list.length + denied.calls.update.length, 0);

    const local = fixture();
    const beforeEdit = snapshot(local.row());
    const edited = await local.run('update_event', { id: local.row().id,
        expected: beforeEdit, patch: { title: 'Reunión actualizada' } }, { needsConfirmation: false });
    assert.equal(edited.failed.length, 0);
    assert.equal(local.row().title, 'Reunión actualizada');
    guarded(local.calls.update[0], beforeEdit);
    assert.equal(local.calls.list[0].ownerId, 'account-a');
    assert.equal(local.calls.list[0].includeCancelled, true);
    const beforeCancel = snapshot(local.row());
    const cancelled = await local.run('delete_event', { id: local.row().id, expected: beforeCancel }, { needsConfirmation: false });
    assert.equal(cancelled.failed.length, 0);
    guarded(local.calls.update[1], beforeCancel);
    assert.equal(local.row().status, 'cancelled');
    assert(Number.isFinite(Date.parse(local.row().cancelledAt)));
    assert.equal(local.calls.remove, 0);
    assert.equal(local.calls.sync, 0, 'local edit and cancellation never sync');
    assert(cancelled.uiResponse.speech.includes('cancelado'));

    const stale = fixture();
    const staleExpected = { ...snapshot(stale.row()), updatedAt: '2026-10-09T12:00:00.000Z' };
    const staleResult = await stale.run('update_event', { id: stale.row().id,
        expected: staleExpected, patch: { title: 'No aplicar' } });
    assert.equal(stale.calls.update.length, 1, 'the atomic service guard receives the approved snapshot');
    guarded(stale.calls.update[0], staleExpected);
    assert.equal(staleResult.failed[0].error, 'EVENT_CHANGED');
    assert.equal(stale.calls.writes, 0);
    assert.equal(stale.row().title, 'Reunión');

    for (const expected of [undefined, { title: 'Reunión' }]) {
        const missing = fixture();
        assert.equal((await missing.run('update_event', { id: missing.row().id, expected,
            patch: { title: 'No aplicar' } })).failed.length, 1);
        assert.equal(missing.calls.list.length + missing.calls.update.length, 0);
    }
    for (const event of [{ externalIds: { google: 'linked' } }, { rrule: 'FREQ=WEEKLY' },
        { kind: 'recurring' }, { ownerId: 'other-account' }, { status: 'cancelled' },
        { syncStatus: 'pending' }, { syncStatus: 'synced' }, { syncStatus: 'error' }]) {
        for (const type of ['update_event', 'delete_event']) {
            const blocked = fixture({ event });
            assert.equal((await blocked.run(type, { id: blocked.row().id,
                expected: snapshot(blocked.row()), patch: { title: 'No aplicar' } })).failed.length, 1);
            assert.equal(blocked.calls.update.length + blocked.calls.remove + blocked.calls.sync, 0);
        }
    }
    const sharedStorage = new Map();
    const accountA = fixture({ storage: sharedStorage });
    const payloadA = { title: 'Cuenta A privado', startAt: accountA.row().startAt };
    await accountA.run('create_event', payloadA, { id: 'same-step' });
    const cachedA = await accountA.run('create_event', payloadA, { id: 'same-step' });
    assert.equal(accountA.calls.create.length, 1, 'a confirmed same-account step is idempotent');
    assert.equal(cachedA.executed[0].skipped, true);
    assert.equal(cachedA.executed[0].resultRef.ownerId, 'account-a');
    const accountB = fixture({ accountId: 'account-b', storage: sharedStorage });
    const resultB = await accountB.run('create_event', { title: 'Cuenta B',
        startAt: accountB.row().startAt }, { id: 'same-step' });
    assert.equal(accountB.calls.create.length, 1, 'the same step ID in another account has its own cache key');
    assert.equal(resultB.executed[0].resultRef.ownerId, 'account-b');
    assert(!JSON.stringify(resultB).includes('Cuenta A privado'));
    const loggedOut = fixture({ trusted: false, storage: sharedStorage });
    const deniedCache = await loggedOut.run('create_event', payloadA, { id: 'same-step' });
    assert.equal(deniedCache.executed.length, 0, 'authentication is checked before cache reuse');
    assert.equal(deniedCache.failed.length, 1);
    assert.equal(loggedOut.calls.create.length, 0);

    for (const log of [
        { 'same-step': { resultRef: { ownerId: 'account-a', title: 'Ajeno privado' } } },
        { 'event:account-b:same-step': { ownerId: 'account-b', resultRef: { ownerId: 'account-a', title: 'Ajeno privado' } } }
    ]) {
        const unsafeCache = fixture({ accountId: 'account-b',
            storage: new Map([['gunter_executions_log', JSON.stringify(log)]]) });
        const rejected = await unsafeCache.run('create_event', { title: 'Cuenta B',
            startAt: unsafeCache.row().startAt }, { id: 'same-step' });
        assert.equal(rejected.executed.length, 0);
        assert.equal(rejected.failed.length, 1);
        assert.equal(unsafeCache.calls.create.length, 0, 'foreign or unscoped cache never replays an ambiguous step');
        assert(!JSON.stringify(rejected).includes('Ajeno privado'));
    }
    console.log('EVENT ACTION ENGINE: explicit confirmation, auth owner, account-scoped cache, guarded local edit/cancel, stale snapshot and blocked linked/recurring/sync states ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
