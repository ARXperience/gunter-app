'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Transactions serialize and commit all selected stores together. An abort
// after an event put must also discard that put if a linked reminder put fails.
function fakeIndexedDB() {
    const stores = new Map(), pending = [], transactions = [];
    const fake = { stores, transactions, beforeRequest: null, failPutStore: null };
    let active = false, upgraded = false;
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { stores.set(name, new Map()); return { createIndex() {} }; },
        close() {},
        transaction(names, mode = 'readonly') {
            names = typeof names === 'string' ? [names] : [...names];
            names.forEach(name => assert.ok(stores.has(name), `missing store ${name}`));
            const operations = [], staged = new Map();
            const log = { names, mode, operations: [], committed: false, aborted: false };
            transactions.push(log);
            let ended = false;
            const tx = {
                error: null,
                objectStore(name) {
                    assert.ok(names.includes(name), `store ${name} outside transaction`);
                    const request = (op, input) => {
                        const result = {};
                        log.operations.push({ store: name, op });
                        operations.push({ store: name, op, input: clone(input), result });
                        return result;
                    };
                    return {
                        get: id => request('get', id), getAll: () => request('getAll'),
                        add: row => request('add', row), put: row => request('put', row),
                        delete: id => request('delete', id)
                    };
                },
                abort() {
                    if (ended) return;
                    ended = true; log.aborted = true;
                    setTimeout(() => { tx.onabort?.(); release(); }, 0);
                }
            };
            function release() { active = false; nextTransaction(); }
            function nextRequest() {
                if (ended) return;
                const item = operations.shift();
                if (!item) {
                    ended = true;
                    if (mode === 'readwrite') staged.forEach((rows, name) => {
                        stores.get(name).clear(); rows.forEach((row, id) => stores.get(name).set(id, row));
                    });
                    log.committed = true; tx.oncomplete?.(); release(); return;
                }
                setTimeout(() => {
                    if (ended) return;
                    try {
                        fake.beforeRequest?.(item.store, item.op, item.input);
                        const rows = staged.get(item.store);
                        if (item.op === 'get') item.result.result = clone(rows.get(item.input));
                        else if (item.op === 'getAll') item.result.result = clone([...rows.values()]);
                        else {
                            assert.equal(mode, 'readwrite');
                            if (item.op === 'put' && fake.failPutStore === item.store) {
                                fake.failPutStore = null; throw new Error('FAKE_REMINDER_PUT_FAILED');
                            }
                            if (item.op === 'delete') rows.delete(item.input);
                            else {
                                if (item.op === 'add' && rows.has(item.input.id)) throw new Error('DUPLICATE_ID');
                                rows.set(item.input.id, clone(item.input));
                            }
                        }
                        item.result.onsuccess?.();
                    } catch (error) {
                        tx.error = item.result.error = error;
                        item.result.onerror?.(); tx.onerror?.(); tx.abort();
                    }
                    nextRequest();
                }, 0);
            }
            pending.push(() => {
                names.forEach(name => staged.set(name,
                    new Map([...stores.get(name)].map(([id, row]) => [id, clone(row)]))));
                nextRequest();
            });
            nextTransaction(); return tx;
        }
    };
    function nextTransaction() {
        if (active || !pending.length) return;
        active = true; setTimeout(pending.shift(), 0);
    }
    fake.indexedDB = { open(name, version) {
        assert.equal(name, 'gunter_daily'); assert.ok(version === 2 || version === undefined);
        const request = { result: db };
        setTimeout(() => {
            if (!upgraded) { upgraded = true; request.onupgradeneeded?.(); }
            request.onsuccess?.();
        }, 0);
        return request;
    } };
    return fake;
}

function fixture({ authenticated = true } = {}) {
    const fake = fakeIndexedDB(), emitted = [], stored = new Map();
    const session = { ownerId: 'alice', trusted: true };
    let clock = Date.parse('2026-10-12T12:00:00Z');
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
    }
    const window = { dispatchEvent: event => emitted.push(event),
        localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } };
    if (authenticated) window.GunterAuth = {
        getUser: () => ({ id: session.ownerId }), canAccessLocalData: () => session.trusted
    };
    const context = { window, indexedDB: fake.indexedDB, Date: Clock, Intl, Math, Promise, Number,
        CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/events-service.js'), 'utf8'), context);
    return { fake, window, session, emitted, service: window.GunterEventsService,
        context,
        advance: instant => { clock = Date.parse(instant); },
        events: () => fake.stores.get('events'), reminders: () => fake.stores.get('reminders') };
}

const input = { title: 'Revisar informe', startAt: '2026-10-12T15:00:00.000Z', endAt: '2026-10-12T16:00:00.000Z' };
const fireAt = '2026-10-12T14:45:00.000Z';
function snapshot(row) {
    return { title: row.title, startAt: row.startAt, endAt: row.endAt,
        status: row.status || 'scheduled', updatedAt: row.updatedAt,
        rrule: row.rrule || null, externalIds: row.externalIds || {} };
}
async function scheduled(f, data = input, at = fireAt) {
    const event = await f.service.create(data);
    const reminder = await f.service.scheduleReminder(event.id,
        { fireAt: at, ownerId: 'alice', expected: snapshot(event) });
    return { event, reminder };
}
const updateOptions = row => ({ ownerId: 'alice', expected: snapshot(row), skipSync: true });
let cases = 0;
async function check(name, run) { await run(); cases++; console.log(`PASS ${name}`); }

if (require.main === module) (async () => {
    await check('explicit local linkage, offset, deduplication and no durable jobs', async () => {
        const f = fixture(); let jobCalls = 0;
        f.window.GunterJobs = { scheduleReminder() { jobCalls++; throw new Error('NOT_ALLOWED'); } };
        const { event, reminder } = await scheduled(f);
        assert.match(reminder.id, /^rem_evt_/);
        assert.equal(reminder.ownerId, 'alice'); assert.equal(reminder.title, event.title);
        assert.equal(reminder.status, 'scheduled'); assert.equal(reminder.durable, false);
        assert.equal(reminder.fireAt, fireAt);
        assert.deepEqual(clone(reminder.meta.eventLink),
            { version: 1, eventId: event.id, offsetMs: 15 * 60 * 1000, startAt: input.startAt });
        assert.equal(typeof reminder.createdAt, 'string'); assert.equal(typeof reminder.updatedAt, 'string');
        const duplicate = await f.service.scheduleReminder(event.id,
            { fireAt: '2026-10-12T09:45:00-05:00', ownerId: 'alice', expected: snapshot(event) });
        assert.equal(duplicate.id, reminder.id); assert.equal(f.reminders().size, 1);
        assert.equal((await f.service.getReminder(reminder.id)).id, reminder.id);
        assert.equal(jobCalls, 0, 'local event reminders must never use server/cloud jobs');
    });

    await check('only verified owner can create or read linked reminders', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        await assert.rejects(f.service.scheduleReminder(event.id,
            { fireAt, ownerId: 'bob', expected: snapshot(event) }), /EVENT_OWNER_MISMATCH/);
        f.session.trusted = false;
        await assert.rejects(f.service.scheduleReminder(event.id,
            { fireAt, ownerId: 'alice', expected: snapshot(event) }), /EVENT_AUTH_REQUIRED/);
        await assert.rejects(f.service.getReminder(reminder.id), /EVENT_AUTH_REQUIRED/);
        f.session.trusted = true; f.session.ownerId = 'bob';
        await assert.rejects(f.service.getReminder(reminder.id), /EVENT_OWNER_MISMATCH/);
        await assert.rejects(f.service.cancelReminder(reminder.id), /EVENT_OWNER_MISMATCH/);
        await assert.rejects(f.service.claimReminder(reminder.id), /EVENT_OWNER_MISMATCH/);
        assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
        const standalone = fixture({ authenticated: false });
        const local = await standalone.service.create(input);
        await assert.rejects(standalone.service.scheduleReminder(local.id,
            { fireAt, ownerId: 'local-user', expected: snapshot(local) }), /EVENT_AUTH_REQUIRED/);
    });

    await check('reject malformed time, stale snapshot, unsupported event and unowned legacy records', async () => {
        const f = fixture(); const event = await f.service.create(input);
        const opts = { fireAt, ownerId: 'alice', expected: snapshot(event) };
        for (const invalidAt of ['', 'not-a-date', '2026-10-12T11:59:59Z', '2026-10-12T15:01:00Z', null]) {
            await assert.rejects(f.service.scheduleReminder(event.id,
                { ...opts, fireAt: invalidAt }), /EVENT_REMINDER_INVALID/);
        }
        await assert.rejects(f.service.scheduleReminder(event.id,
            { ...opts, expected: { ...opts.expected, title: 'Stale' } }), /EVENT_CHANGED/);
        await assert.rejects(f.service.scheduleReminder('missing', opts), /EVENT_REMINDER_NOT_FOUND/);
        for (const patch of [{ rrule: { freq: 'DAILY' } }, { kind: 'recurring' },
            { kind: 'allDay' }, { externalIds: { google: 'remote' } }, { syncStatus: 'synced' }]) {
            const foreignType = { ...clone(event), ...patch, id: `unsupported-${JSON.stringify(patch)}` };
            f.events().set(foreignType.id, foreignType);
            await assert.rejects(f.service.scheduleReminder(foreignType.id,
                { ...opts, expected: snapshot(foreignType) }), /EVENT_REMINDER_UNSUPPORTED/);
        }
        for (const ownerId of ['bob', 'local-user', undefined]) {
            const legacy = { ...clone(event), id: `legacy-${ownerId}`, ownerId };
            f.events().set(legacy.id, legacy);
            await assert.rejects(f.service.scheduleReminder(legacy.id,
                { ...opts, expected: snapshot(legacy) }), /EVENT_OWNER_MISMATCH/);
        }
        assert.equal(f.reminders().size, 0);
    });

    await check('renaming and moving atomically preserve reminder lead time', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        const updated = await f.service.update(event.id,
            { title: 'Informe final', startAt: '2026-10-12T12:00:00-05:00', endAt: '2026-10-12T13:00:00-05:00' },
            updateOptions(event));
        const linked = await f.service.getReminder(reminder.id);
        assert.equal(updated.startAt, '2026-10-12T12:00:00-05:00');
        assert.equal(linked.title, 'Informe final'); assert.equal(linked.status, 'scheduled');
        assert.equal(linked.fireAt, '2026-10-12T16:45:00.000Z');
        assert.equal(Date.parse(linked.meta.eventLink.startAt), Date.parse('2026-10-12T17:00:00Z'));
        assert.equal(linked.meta.eventLink.offsetMs, 900000);
        const tx = f.fake.transactions.findLast(tx => tx.mode === 'readwrite');
        assert.deepEqual([...tx.names].sort(), ['events', 'reminders']);
        assert.ok(tx.operations.some(op => op.store === 'events' && op.op === 'put'));
        assert.ok(tx.operations.some(op => op.store === 'reminders' && op.op === 'put'));
        assert.equal(tx.committed, true);
    });

    await check('event cancellation and deletion disable linked notices only', async () => {
        for (const remove of [false, true]) {
            const f = fixture(); const { event, reminder } = await scheduled(f);
            if (remove) await f.service.remove(event.id);
            else await f.service.update(event.id,
                { status: 'cancelled', cancelledAt: '2026-10-12T12:01:00Z' }, updateOptions(event));
            const linked = f.reminders().get(reminder.id);
            assert.equal(linked.status, 'cancelled'); assert.equal(typeof linked.cancelledAt, 'string');
            assert.equal(f.events().has(event.id), !remove);
            f.advance('2026-10-12T14:45:00Z');
            const claim = await f.service.claimReminder(reminder.id);
            assert.equal(claim.fired, false);
        }
    });

    await check('moving an event past its notice time cancels instead of firing immediately', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        await f.service.update(event.id,
            { startAt: '2026-10-12T12:10:00Z', endAt: '2026-10-12T13:10:00Z' }, updateOptions(event));
        assert.equal(f.reminders().get(reminder.id).status, 'cancelled');
        assert.equal((await f.service.claimReminder(reminder.id)).fired, false);
    });

    await check('fired and cancelled reminders are never revived by later event changes', async () => {
        for (const fire of [false, true]) {
            const f = fixture(); const { event, reminder } = await scheduled(f);
            if (fire) { f.advance(fireAt); assert.equal((await f.service.claimReminder(reminder.id)).fired, true); }
            else await f.service.cancelReminder(reminder.id);
            const before = clone(f.reminders().get(reminder.id));
            await f.service.update(event.id,
                { title: 'Cambio posterior', startAt: '2026-10-12T18:00:00Z', endAt: '2026-10-12T19:00:00Z' },
                updateOptions(event));
            assert.deepEqual(clone(f.reminders().get(reminder.id)), before);
            assert.equal((await f.service.claimReminder(reminder.id)).fired, false);
        }
    });

    await check('independent, foreign and unowned reminders remain untouched', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        const extras = [
            { id: 'independent', ownerId: 'alice', title: 'Independiente', fireAt, status: 'scheduled', meta: {} },
            { ...clone(reminder), id: 'other-account', ownerId: 'bob' },
            { ...clone(reminder), id: 'unowned', ownerId: undefined },
            { ...clone(reminder), id: 'legacy', ownerId: 'local-user' }
        ];
        extras.forEach(row => f.reminders().set(row.id, clone(row)));
        await f.service.update(event.id,
            { title: 'Movida', startAt: '2026-10-12T18:00:00Z', endAt: '2026-10-12T19:00:00Z' }, updateOptions(event));
        await f.service.remove(event.id);
        extras.forEach(row => assert.deepEqual(clone(f.reminders().get(row.id)), clone(row)));
        assert.equal(f.reminders().get(reminder.id).status, 'cancelled');
    });

    await check('failed reminder write rolls back event and every linked write', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        const beforeEvent = clone(f.events().get(event.id));
        const beforeReminder = clone(f.reminders().get(reminder.id));
        const emissionCount = f.emitted.length;
        f.fake.failPutStore = 'reminders';
        await assert.rejects(f.service.update(event.id,
            { title: 'No persistir', startAt: '2026-10-12T18:00:00Z', endAt: '2026-10-12T19:00:00Z' },
            updateOptions(event)), /FAKE_REMINDER_PUT_FAILED/);
        assert.deepEqual(clone(f.events().get(event.id)), beforeEvent);
        assert.deepEqual(clone(f.reminders().get(reminder.id)), beforeReminder);
        assert.equal(f.emitted.length, emissionCount, 'aborted mutations must not announce success');
        assert.equal(f.fake.transactions.at(-1).aborted, true);
    });

    await check('account switching during creation, mutation and claim aborts all writes', async () => {
        const f = fixture(); const { event, reminder } = await scheduled(f);
        f.fake.beforeRequest = (store, op) => { if (store === 'events' && op === 'get') f.session.ownerId = 'bob'; };
        await assert.rejects(f.service.scheduleReminder(event.id,
            { fireAt: '2026-10-12T14:30:00Z', ownerId: 'alice', expected: snapshot(event) }), /EVENT_OWNER_MISMATCH/);
        assert.equal(f.reminders().size, 1);
        f.session.ownerId = 'alice';
        await assert.rejects(f.service.update(event.id, { title: 'Otra cuenta' }, updateOptions(event)), /EVENT_OWNER_MISMATCH/);
        assert.equal(f.events().get(event.id).title, input.title);
        f.session.ownerId = 'alice'; f.advance(fireAt);
        await assert.rejects(f.service.claimReminder(reminder.id), /EVENT_OWNER_MISMATCH/);
        assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
    });

    await check('claim rechecks due time and two tabs cannot fire the same notice twice', async () => {
        const f = fixture(); const { reminder } = await scheduled(f);
        assert.equal((await f.service.claimReminder(reminder.id)).waiting, true);
        assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
        f.advance(fireAt);
        const claims = await Promise.all([f.service.claimReminder(reminder.id), f.service.claimReminder(reminder.id)]);
        assert.equal(claims.filter(result => result.fired === true).length, 1);
        assert.equal(f.reminders().get(reminder.id).status, 'fired');
        assert.equal(typeof f.reminders().get(reminder.id).firedAt, 'string');
        assert.equal((await f.service.claimReminder(reminder.id)).fired, false);
        assert.deepEqual(clone(await f.service.claimReminder('missing')), { reminder: null, fired: false });
        assert.equal(await f.service.getReminder('missing'), null);
    });

    await check('late timer rechecks source event instead of notifying a cancelled or elapsed meeting', async () => {
        for (const mode of ['cancelled', 'elapsed', 'deleted', 'unsupported']) {
            const f = fixture(); const { event, reminder } = await scheduled(f);
            if (mode === 'cancelled') f.events().get(event.id).status = 'cancelled';
            if (mode === 'deleted') f.events().delete(event.id);
            if (mode === 'unsupported') f.events().get(event.id).externalIds = { google: 'new-external-link' };
            f.advance(mode === 'elapsed' ? '2026-10-12T16:01:00Z' : fireAt);
            const result = await f.service.claimReminder(reminder.id);
            assert.equal(result.fired, undefined);
            assert.equal(result.cancelled, true);
            assert.equal(f.reminders().get(reminder.id).status, 'cancelled');
        }
    });

    console.log(`event-reminders: ${cases} focused atomic/local/account/lifecycle cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { fixture, snapshot, clone, input, fireAt };
