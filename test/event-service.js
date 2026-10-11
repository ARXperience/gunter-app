'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Serialize transactions and stage writes until commit, like IndexedDB. A get
// callback can enqueue its put in the same transaction; abort discards all writes.
function fakeIndexedDB() {
    const rows = new Map();
    const names = new Set();
    const transactions = [];
    const pending = [];
    const fake = { rows, transactions, closes: 0, failPut: false, beforeRequest: null };
    let active = false, upgraded = false;
    const db = {
        objectStoreNames: { contains: name => names.has(name) },
        createObjectStore(name) { names.add(name); return { createIndex() {} }; },
        close() { fake.closes++; },
        transaction(name, mode = 'readonly') {
            assert.ok(names.has(name), `missing store ${name}`);
            const operations = [];
            const log = { mode, operations: [], committed: false, aborted: false };
            transactions.push(log);
            let staged, ended = false;
            const tx = {
                error: null,
                objectStore() {
                    const request = (op, input) => {
                        const result = {};
                        log.operations.push(op);
                        operations.push({ op, input, result });
                        return result;
                    };
                    return {
                        get: id => request('get', id), getAll: () => request('getAll'),
                        add: row => request('add', clone(row)), put: row => request('put', clone(row)),
                        delete: id => request('delete', id)
                    };
                },
                abort() {
                    if (ended) return;
                    ended = true;
                    log.aborted = true;
                    setTimeout(() => { tx.onabort?.(); release(); }, 0);
                }
            };
            function release() { active = false; nextTransaction(); }
            function nextRequest() {
                if (ended) return;
                const item = operations.shift();
                if (!item) {
                    ended = true;
                    if (mode === 'readwrite') {
                        rows.clear(); staged.forEach((row, id) => rows.set(id, row));
                    }
                    log.committed = true;
                    tx.oncomplete?.();
                    release();
                    return;
                }
                setTimeout(() => {
                    if (ended) return;
                    try {
                        fake.beforeRequest?.(item.op, item.input);
                        if (item.op === 'get') item.result.result = clone(staged.get(item.input));
                        else if (item.op === 'getAll') item.result.result = clone([...staged.values()]);
                        else {
                            assert.equal(mode, 'readwrite');
                            if (item.op === 'put' && fake.failPut) {
                                fake.failPut = false;
                                throw new Error('FAKE_PUT_FAILED');
                            }
                            if (item.op === 'delete') staged.delete(item.input);
                            else {
                                if (item.op === 'add' && staged.has(item.input.id)) throw new Error('DUPLICATE_ID');
                                staged.set(item.input.id, item.input);
                            }
                        }
                        item.result.onsuccess?.();
                    } catch (error) {
                        tx.error = item.result.error = error;
                        item.result.onerror?.();
                        tx.onerror?.();
                        tx.abort();
                    }
                    nextRequest();
                }, 0);
            }
            pending.push(() => {
                staged = new Map([...rows].map(([id, row]) => [id, clone(row)]));
                nextRequest();
            });
            nextTransaction();
            return tx;
        }
    };
    function nextTransaction() {
        if (active || !pending.length) return;
        active = true;
        setTimeout(pending.shift(), 0);
    }
    fake.indexedDB = { open(name, version) {
        assert.equal(name, 'gunter_daily'); assert.equal(version, 2);
        const request = { result: db };
        setTimeout(() => {
            if (!upgraded) { upgraded = true; request.onupgradeneeded?.(); }
            request.onsuccess?.();
        }, 0);
        return request;
    } };
    fake.storeNames = names;
    return fake;
}

function fixture({ authenticated = true, verifiedOnly = false, now = null, intl = Intl } = {}) {
    const fake = fakeIndexedDB();
    const emitted = [];
    const session = { ownerId: 'alice', trusted: true };
    const window = { dispatchEvent: event => emitted.push(event) };
    if (authenticated) window.GunterAuth = {
        getUser: () => ({ id: session.ownerId }),
        [verifiedOnly ? 'isVerified' : 'canAccessLocalData']: () => session.trusted
    };
    const Clock = now ? class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return Date.parse(now); }
    } : Date;
    const context = { window, indexedDB: fake.indexedDB, Date: Clock, Intl: intl, Math, Promise, Number,
        CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/events-service.js'), 'utf8'), context);
    return { fake, window, session, emitted, service: window.GunterEventsService };
}

const startAt = '2026-10-11T15:00:00.000Z';
const endAt = '2026-10-11T16:00:00.000Z';
const input = { title: 'Revisar informe', startAt, endAt };
function snapshot(row) {
    return { title: row.title, startAt: row.startAt, endAt: row.endAt,
        status: row.status || 'scheduled', updatedAt: row.updatedAt,
        rrule: row.rrule || null, externalIds: row.externalIds || {} };
}

(async () => {
    const { fake, window, session, emitted, service } = fixture();
    const saved = await service.create({ ...input, status: 'cancelled' });
    assert.equal(saved.ownerId, 'alice');
    assert.equal(saved.status, 'scheduled');
    assert.equal((await service.create({ title: 'Duración por defecto', startAt })).endAt, endAt);
    assert.deepEqual([...fake.storeNames].sort(), ['events', 'reminders', 'tasks']);
    const count = fake.rows.size;
    await assert.rejects(service.create({ ...input, ownerId: 'bob' }), /EVENT_OWNER_MISMATCH/);
    await assert.rejects(service.create({ ...input, ownerId: 'local-user' }), /EVENT_OWNER_MISMATCH/);
    session.trusted = false;
    await assert.rejects(service.create(input), /EVENT_AUTH_REQUIRED/);
    assert.deepEqual(clone(await service.list()), []);
    session.trusted = true;
    const switchingCreate = service.create(input);
    session.ownerId = 'bob';
    await assert.rejects(switchingCreate, /EVENT_OWNER_MISMATCH/);
    assert.equal(fake.rows.size, count, 'creation revalidates the owner after opening IndexedDB');
    session.ownerId = 'alice';
    for (const bad of [{ title: ' ' }, { title: 1 }, { startAt: 'invalid' },
        { endAt: startAt }, { endAt: '2026-10-11T14:59:59.000Z' }, { endAt: '' }]) {
        await assert.rejects(service.create({ ...input, ...bad }), /EVENT_INVALID_(TITLE|DATES)/);
    }
    assert.equal(fake.rows.size, count);
    fake.rows.set('other', { ...clone(saved), id: 'other', ownerId: 'bob' });
    fake.rows.set('legacy', { ...clone(saved), id: 'legacy', ownerId: 'local-user' });
    fake.rows.set('unowned', { ...clone(saved), id: 'unowned', ownerId: undefined });
    // Old callers without explicit guards still cannot edit foreign/legacy data.
    for (const id of ['other', 'legacy', 'unowned']) {
        const before = clone(fake.rows.get(id));
        await assert.rejects(service.update(id, { title: 'Caller sin guard' }), /EVENT_OWNER_MISMATCH/);
        assert.deepEqual(clone(fake.rows.get(id)), before);
    }
    for (const patch of [{ id: 'replace-id' }, { ownerId: 'bob' }]) {
        await assert.rejects(service.update(saved.id, patch), /EVENT_PATCH_FORBIDDEN/);
        assert.deepEqual(clone(fake.rows.get(saved.id)), clone(saved));
    }
    // The explicit remove API also isolates owners and never deletes legacy data.
    for (const id of ['other', 'legacy', 'unowned']) {
        const before = clone(fake.rows.get(id));
        await assert.rejects(service.remove(id), /EVENT_OWNER_MISMATCH/);
        assert.deepEqual(clone(fake.rows.get(id)), before);
    }
    // Account validation and delete share one transaction, so a switch aborts it.
    const removable = { ...clone(saved), id: 'own-remove', externalIds: { google: 'own-google-id' } };
    fake.rows.set(removable.id, removable);
    let deletes = 0;
    window.GunterCalendarService = { deleteEvent: async id => { assert.equal(id, 'own-google-id'); deletes++; } };
    fake.beforeRequest = op => { if (op === 'get') session.ownerId = 'bob'; };
    await assert.rejects(service.remove(removable.id), /EVENT_OWNER_MISMATCH/);
    assert.deepEqual(clone(fake.rows.get(removable.id)), removable);
    assert.equal(deletes, 0, 'an aborted local remove cannot call Google');
    assert.deepEqual(fake.transactions.at(-1).operations, ['get']);
    assert.equal(fake.transactions.at(-1).aborted, true);
    fake.beforeRequest = null;
    session.ownerId = 'alice';
    const removeTransactionCount = fake.transactions.length;
    await service.remove(removable.id);
    assert.equal(fake.transactions.length, removeTransactionCount + 1);
    assert.deepEqual(fake.transactions.at(-1).operations, ['get', 'delete']);
    assert.equal(fake.transactions.at(-1).mode, 'readwrite');
    assert.equal(fake.rows.has(removable.id), false);
    assert.equal(deletes, 1);
    for (const id of ['other', 'legacy', 'unowned']) {
        const before = clone(fake.rows.get(id));
        await assert.rejects(service.update(id, { title: 'No aplicar' }, { ownerId: 'alice' }), /EVENT_OWNER_MISMATCH/);
        assert.deepEqual(clone(fake.rows.get(id)), before);
    }
    await assert.rejects(service.update(saved.id, { title: 'Ajena' }, { ownerId: 'bob' }), /EVENT_OWNER_MISMATCH/);
    for (const patch of [{ ownerId: 'alice' }, { id: saved.id }, { externalIds: {} }, { rrule: null }, { notes: '' }]) {
        await assert.rejects(service.update(saved.id, patch, { ownerId: 'alice' }), /EVENT_PATCH_FORBIDDEN/);
    }
    const before = clone(fake.rows.get(saved.id));
    const emissionCount = emitted.length;
    for (const bad of [{ title: '' }, { title: null }, { startAt: 'not-a-date' },
        { startAt: endAt }, { endAt: startAt }, { endAt: null }]) {
        await assert.rejects(service.update(saved.id, { title: 'Cambio parcial', ...bad }, { ownerId: 'alice' }), /EVENT_INVALID_(TITLE|DATES)/);
        assert.deepEqual(clone(fake.rows.get(saved.id)), before, 'invalid merged record aborts the entire patch');
    }
    assert.equal(emitted.length, emissionCount, 'rejected patches do not emit success');
    await assert.rejects(service.update('missing', { title: 'No existe' }), /Event no encontrado/);
    const transactionCount = fake.transactions.length;
    const guard = { ownerId: 'alice', statuses: ['scheduled'], expected: snapshot(before), skipSync: true };
    const changed = await service.update(saved.id, { title: 'Informe final' }, guard);
    assert.equal(changed.title, 'Informe final');
    assert.equal(fake.transactions.length, transactionCount + 1);
    assert.deepEqual(fake.transactions.at(-1).operations, ['get', 'put']);
    assert.equal(fake.transactions.at(-1).mode, 'readwrite', 'read, comparison and put share one transaction');
    await assert.rejects(service.update(saved.id, { title: 'Stale' }, guard), /EVENT_CHANGED/);
    const raceGuard = { ...guard, expected: snapshot(changed) };
    const race = await Promise.allSettled([
        service.update(saved.id, { title: 'Primera edición' }, raceGuard),
        service.update(saved.id, { title: 'Segunda edición' }, raceGuard)
    ]);
    assert.deepEqual(race.map(result => result.status), ['fulfilled', 'rejected']);
    assert.match(race[1].reason.message, /EVENT_CHANGED/);
    assert.equal(fake.rows.get(saved.id).title, 'Primera edición');

    // Own old rows remain unmodified on read; missing status is effectively scheduled.
    const ownOld = { ...clone(before), id: 'own-old' };
    delete ownOld.status; delete ownOld.rrule; delete ownOld.externalIds;
    fake.rows.set(ownOld.id, ownOld);
    const editedOld = await service.update(ownOld.id, { title: 'Antiguo propio' },
        { ownerId: 'alice', statuses: ['scheduled'], expected: snapshot(ownOld), skipSync: true });
    assert.equal(editedOld.ownerId, 'alice');
    assert.equal(editedOld.status, undefined, 'effective status never migrates a legacy record');
    const linkedSnapshot = snapshot(editedOld);
    fake.rows.get(ownOld.id).externalIds = { google: 'externally-added' };
    await assert.rejects(service.update(ownOld.id, { title: 'No aplicar' },
        { ownerId: 'alice', expected: linkedSnapshot }), /EVENT_CHANGED/);
    fake.rows.get(ownOld.id).externalIds = { google: 'id', googleHtmlLink: 'link' };
    const linkedExpected = snapshot(fake.rows.get(ownOld.id));
    linkedExpected.externalIds = { googleHtmlLink: 'link', google: 'id' };
    assert.equal((await service.update(ownOld.id, { title: 'Igualdad estructural' },
        { ownerId: 'alice', expected: linkedExpected, skipSync: true })).title, 'Igualdad estructural');
    const recurrenceExpected = snapshot(fake.rows.get(ownOld.id));
    fake.rows.get(ownOld.id).rrule = { freq: 'DAILY' };
    await assert.rejects(service.update(ownOld.id, { title: 'No aplicar' },
        { ownerId: 'alice', expected: recurrenceExpected }), /EVENT_CHANGED/);

    const active = clone(fake.rows.get(saved.id));
    const cancelledAt = '2026-10-10T15:01:00.000Z';
    const cancelled = await service.update(saved.id, { status: 'cancelled', cancelledAt },
        { ownerId: 'alice', statuses: ['scheduled'], expected: snapshot(active), skipSync: true });
    assert.equal(cancelled.cancelledAt, cancelledAt);
    assert.equal(fake.rows.has(saved.id), true, 'cancellation preserves the row');
    assert.ok(!(await service.list()).some(row => row.id === saved.id));
    assert.ok((await service.list({ includeCancelled: true })).some(row => row.id === saved.id));
    assert.ok((await service.list({ includeCancelled: true })).every(row => row.ownerId === 'alice'));
    assert.deepEqual(clone(await service.list({ ownerId: 'bob', includeCancelled: true })), []);
    await assert.rejects(service.update(saved.id, { title: 'Ya cancelada' },
        { ownerId: 'alice', statuses: ['scheduled'] }), /EVENT_STATUS_CHANGED/);

    fake.failPut = true;
    const failedWriteBefore = clone(fake.rows.get(ownOld.id));
    await assert.rejects(service.update(ownOld.id, { title: 'Fallo de almacenamiento' },
        { ownerId: 'alice', skipSync: true }), /FAKE_PUT_FAILED/);
    assert.deepEqual(clone(fake.rows.get(ownOld.id)), failedWriteBefore);
    fake.beforeRequest = op => { if (op === 'get') session.ownerId = 'bob'; };
    await assert.rejects(service.update(ownOld.id, { title: 'Cambio de cuenta' },
        { ownerId: 'alice', skipSync: true }), /EVENT_OWNER_MISMATCH/);
    assert.deepEqual(clone(fake.rows.get(ownOld.id)), failedWriteBefore);
    session.ownerId = 'alice';
    fake.beforeRequest = op => { if (op === 'getAll') session.ownerId = 'bob'; };
    assert.deepEqual(clone(await service.list({ includeCancelled: true })), [], 'account switch cannot expose the previous account list');
    fake.beforeRequest = null;
    session.ownerId = 'alice';
    session.trusted = false;
    await assert.rejects(service.update(ownOld.id, { title: 'Sesión inválida' }, { ownerId: 'alice' }), /EVENT_AUTH_REQUIRED/);
    session.trusted = true;

    // Unguarded legacy callers retain sync metadata updates and existing hooks.
    let syncs = 0, pushes = 0;
    window.GunterCalendarService = {
        updateEvent: async () => { syncs++; return {}; },
        pushEvent: async () => { pushes++; return { id: 'pushed-google-id', htmlLink: 'https://calendar.example/event' }; }
    };
    await service.update(ownOld.id, { syncStatus: 'local', rrule: null });
    assert.equal(syncs, 1);
    await service.update(ownOld.id, { title: 'Sin sync' }, { ownerId: 'alice', skipSync: true });
    assert.equal(syncs, 1);
    const pushed = await service.create({ ...input, pushToGoogle: true });
    assert.equal(pushes, 1);
    assert.equal(fake.rows.get(pushed.id).externalIds.google, 'pushed-google-id');
    assert.equal(fake.rows.get(pushed.id).syncStatus, 'synced');
    window.GunterCalendarService.updateEvent = async () => ({ gone: true });
    await service.update(pushed.id, { title: 'Vínculo eliminado en Google' });
    assert.deepEqual(clone(fake.rows.get(pushed.id).externalIds), {});
    assert.equal(fake.rows.get(pushed.id).syncStatus, 'local');
    window.GunterCalendarService.updateEvent = async () => { throw new Error('Google offline'); };
    await service.update(ownOld.id, { title: 'Conservar cambio aunque falle sync' });
    assert.equal(fake.rows.get(ownOld.id).title, 'Conservar cambio aunque falle sync');
    assert.equal(fake.rows.get(ownOld.id).syncStatus, 'error');
    assert.equal(fake.rows.get(ownOld.id).syncError, 'Google offline');

    // Bounds, sorting and upcoming compare actual instants across ISO offsets.
    const instants = fixture({ now: '2026-10-11T15:00:00.000Z' });
    const early = await instants.service.create({ title: 'Temprano', startAt: '2026-10-11T10:00:00-04:00' });
    const middle = await instants.service.create({ title: 'Ahora', startAt: '2026-10-11T15:00:00Z' });
    const later = await instants.service.create({ title: 'Más tarde', startAt: '2026-10-11T11:00:00-05:00' });
    assert.deepEqual(clone((await instants.service.list()).map(row => row.id)), [early.id, middle.id, later.id]);
    assert.deepEqual(clone((await instants.service.list({ from: '2026-10-11T10:00:00-05:00',
        to: '2026-10-11T12:00:00-04:00' })).map(row => row.id)), [middle.id, later.id]);
    assert.deepEqual(clone((await instants.service.listUpcoming()).map(row => row.id)), [middle.id, later.id]);
    assert.deepEqual(clone((await instants.service.listUpcoming(1)).map(row => row.id)), [middle.id]);

    // At 02:00 UTC it is still the previous day in the configured Bogotá zone.
    const utcIntl = { DateTimeFormat: function (locale, options) {
        return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    } };
    const calendarDay = fixture({ now: '2026-10-11T02:00:00.000Z', intl: utcIntl });
    calendarDay.window.GunterPresence = { timezone: () => 'America/Bogota' };
    const previousUtcDay = await calendarDay.service.create({ title: 'Noche anterior', startAt: '2026-10-10T23:00:00Z' });
    const sameInstant = await calendarDay.service.create({ title: 'Todavía hoy en Bogotá', startAt: '2026-10-11T02:00:00Z' });
    const nextBogotaDay = await calendarDay.service.create({ title: 'Mañana en Bogotá', startAt: '2026-10-11T06:00:00Z' });
    assert.deepEqual(clone((await calendarDay.service.listForToday()).map(row => row.id)), [previousUtcDay.id, sameInstant.id]);
    delete calendarDay.window.GunterPresence;
    assert.deepEqual(clone((await calendarDay.service.listForToday()).map(row => row.id)), [sameInstant.id, nextBogotaDay.id]);

    // Conflict checks include previous-day spans, cached external records and
    // exact account ownership, with half-open boundaries rather than start filters.
    const schedule = fixture();
    const slot = { ownerId: 'alice', startAt: '2026-10-11T15:00:00Z',
        endAt: '2026-10-11T16:00:00Z', timezone: 'America/Bogota' };
    const scheduleRow = (id, first, last, extra = {}) => ({ id, title: id, ownerId: 'alice',
        startAt: first, endAt: last, status: 'scheduled', updatedAt: 'revision-1', ...extra });
    const scheduleRows = [
        scheduleRow('ends-at-start', '2026-10-11T14:00:00Z', slot.startAt),
        scheduleRow('overlap', '2026-10-11T09:30:00-05:00', '2026-10-11T10:30:00-05:00'),
        scheduleRow('cached-external', '2026-10-11T15:30:00Z', '2026-10-11T16:30:00Z', { externalIds: { google: 'cached' } }),
        scheduleRow('starts-at-end', slot.endAt, '2026-10-11T17:00:00Z'),
        scheduleRow('legacy', slot.startAt, slot.endAt, { ownerId: undefined }),
        scheduleRow('other-account', slot.startAt, slot.endAt, { ownerId: 'bob' }),
        scheduleRow('cancelled', slot.startAt, slot.endAt, { status: 'cancelled' }),
        scheduleRow('archived', slot.startAt, slot.endAt, { status: 'archived' })
    ];
    scheduleRows.forEach(row => schedule.fake.rows.set(row.id, row));
    const inspected = await schedule.service.checkSchedule(slot);
    assert.equal(inspected.complete, true);
    assert.deepEqual(clone(inspected.conflicts.map(row => row.id)), ['overlap', 'cached-external']);
    assert.deepEqual(clone(inspected.suggestions), [
        { startAt: '2026-10-11T17:00:00.000Z', endAt: '2026-10-11T18:00:00.000Z' },
        { startAt: '2026-10-11T18:00:00.000Z', endAt: '2026-10-11T19:00:00.000Z' },
        { startAt: '2026-10-11T19:00:00.000Z', endAt: '2026-10-11T20:00:00.000Z' }
    ]);
    assert.deepEqual(clone((await schedule.service.checkSchedule({ ...slot, excludeId: 'overlap' })).conflicts.map(row => row.id)), ['cached-external']);
    schedule.fake.rows.get('overlap').arbitraryProfileMetadata = { city: 'new-value' };
    schedule.fake.rows.get('other-account').title = 'Changed foreign title';
    schedule.fake.rows.get('starts-at-end').title = 'Changed irrelevant title';
    assert.equal((await schedule.service.checkSchedule(slot)).fingerprint, inspected.fingerprint,
        'only overlap and unresolved coverage contribute to the fingerprint');
    schedule.fake.rows.get('overlap').title = 'Changed actual blocker';
    assert.notEqual((await schedule.service.checkSchedule(slot)).fingerprint, inspected.fingerprint);
    schedule.fake.rows.set('previous-day-span', scheduleRow('previous-day-span',
        '2026-10-10T23:00:00-05:00', '2026-10-11T10:15:00-05:00', { status: undefined }));
    assert.ok((await schedule.service.checkSchedule(slot)).conflicts.some(row => row.id === 'previous-day-span'));
    await assert.rejects(schedule.service.checkSchedule({ ...slot, ownerId: 'bob' }), /EVENT_OWNER_MISMATCH/);
    await assert.rejects(schedule.service.checkSchedule({ ...slot, ownerId: undefined }), /EVENT_OWNER_MISMATCH/);
    await assert.rejects(schedule.service.checkSchedule({ ...slot, endAt: slot.startAt }), /EVENT_INVALID_DATES/);
    await assert.rejects(schedule.service.checkSchedule({ ...slot, timezone: 'Invalid/Timezone' }), /Invalid time zone/);
    schedule.fake.beforeRequest = op => { if (op === 'getAll') throw new Error('FAKE_QUERY_FAILED'); };
    await assert.rejects(schedule.service.checkSchedule(slot), /FAKE_QUERY_FAILED/);
    schedule.fake.beforeRequest = op => { if (op === 'getAll') schedule.session.ownerId = 'bob'; };
    await assert.rejects(schedule.service.checkSchedule(slot), /EVENT_OWNER_MISMATCH/);
    schedule.fake.beforeRequest = null; schedule.session.ownerId = 'alice';
    schedule.session.trusted = false;
    await assert.rejects(schedule.service.checkSchedule(slot), /EVENT_AUTH_REQUIRED/);
    schedule.session.trusted = true;

    for (const incomplete of [
        { id: 'unexpanded-recurrence', kind: 'recurring', rrule: { interval: 1, freq: 'WEEKLY' } },
        { id: 'unresolved-all-day', kind: 'allDay' },
        { id: 'invalid-own-dates', startAt: 'invalid' }
    ]) {
        const row = scheduleRow(incomplete.id, '2026-11-11T15:00:00Z', '2026-11-11T16:00:00Z', incomplete);
        schedule.fake.rows.set(row.id, row);
        const limited = await schedule.service.checkSchedule(slot);
        assert.equal(limited.complete, false);
        assert.equal(limited.suggestions.length, 0);
        assert.ok(limited.warnings.length);
        assert.notEqual(limited.fingerprint, (await schedule.service.checkSchedule({ ...slot, excludeId: row.id })).fingerprint);
        if (row.rrule) {
            row.rrule = { freq: 'WEEKLY', interval: 1 };
            assert.equal((await schedule.service.checkSchedule(slot)).fingerprint, limited.fingerprint,
                'rrule property order does not invalidate a proposal');
        }
        schedule.fake.rows.delete(row.id);
    }

    // Suggestions use the requested timezone, never crossing the local day;
    // the exact midnight boundary is safe because the interval is half-open.
    const late = fixture();
    const lateSlot = { ...slot, startAt: '2026-10-12T03:30:00Z', endAt: '2026-10-12T04:00:00Z' };
    late.fake.rows.set('late-blocker', scheduleRow('late-blocker', lateSlot.startAt, '2026-10-12T04:30:00Z'));
    const lateCheck = await late.service.checkSchedule(lateSlot);
    assert.deepEqual(clone(lateCheck.suggestions), [
        { startAt: '2026-10-12T04:30:00.000Z', endAt: '2026-10-12T05:00:00.000Z' }
    ]);
    assert.equal((await late.service.checkSchedule({ ...lateSlot, timezone: 'UTC' })).suggestions.length, 3);
    assert.equal((await late.service.checkSchedule({ ...lateSlot, endAt: '2026-10-12T04:30:00Z' })).suggestions.length, 0);

    // Schedule approval and write share one transaction. A competing create
    // invalidates the second proposal; no partial write, success event or sync.
    const atomicSchedule = fixture();
    const emptySchedule = await atomicSchedule.service.checkSchedule(slot);
    const scheduleExpected = { fingerprint: emptySchedule.fingerprint, timezone: slot.timezone };
    let schedulePushes = 0;
    atomicSchedule.window.GunterCalendarService = { pushEvent: async () => { schedulePushes++; return {}; } };
    const competing = await Promise.allSettled([
        atomicSchedule.service.create({ ...input, pushToGoogle: true }, { scheduleExpected }),
        atomicSchedule.service.create({ ...input, pushToGoogle: true }, { scheduleExpected })
    ]);
    assert.deepEqual(competing.map(result => result.status), ['fulfilled', 'rejected']);
    assert.match(competing[1].reason.message, /EVENT_SCHEDULE_CHANGED/);
    assert.equal(atomicSchedule.fake.rows.size, 1);
    assert.equal(atomicSchedule.emitted.length, 1);
    assert.equal(schedulePushes, 1);
    const atomicWrites = atomicSchedule.fake.transactions.filter(tx => tx.mode === 'readwrite');
    assert.deepEqual(atomicWrites.map(tx => tx.operations), [['getAll', 'add'], ['getAll']]);
    assert.equal(atomicWrites[1].aborted, true);
    const acceptedConflicts = await atomicSchedule.service.checkSchedule(slot);
    await atomicSchedule.service.create(input, {
        scheduleExpected: { fingerprint: acceptedConflicts.fingerprint, timezone: slot.timezone }
    });
    assert.equal(atomicSchedule.fake.rows.size, 2, 'an explicitly approved known overlap is not a hidden hard block');

    const atomicMove = fixture();
    const firstTarget = scheduleRow('first-target', '2026-10-11T20:00:00Z', '2026-10-11T21:00:00Z');
    const secondTarget = scheduleRow('second-target', '2026-10-11T21:00:00Z', '2026-10-11T22:00:00Z');
    atomicMove.fake.rows.set(firstTarget.id, firstTarget);
    atomicMove.fake.rows.set(secondTarget.id, secondTarget);
    const moveSchedule = await atomicMove.service.checkSchedule({ ...slot, excludeId: firstTarget.id });
    const moveOptions = { ownerId: 'alice', skipSync: true,
        scheduleExpected: { fingerprint: moveSchedule.fingerprint, timezone: slot.timezone } };
    const competingMoves = await Promise.allSettled([
        atomicMove.service.update(firstTarget.id, { startAt: slot.startAt, endAt: slot.endAt }, moveOptions),
        atomicMove.service.update(secondTarget.id, { startAt: slot.startAt, endAt: slot.endAt }, moveOptions)
    ]);
    assert.deepEqual(competingMoves.map(result => result.status), ['fulfilled', 'rejected']);
    assert.match(competingMoves[1].reason.message, /EVENT_SCHEDULE_CHANGED/);
    assert.deepEqual(clone(atomicMove.fake.rows.get(secondTarget.id)), secondTarget);
    assert.equal(atomicMove.emitted.length, 1);
    const moveWrites = atomicMove.fake.transactions.filter(tx => tx.mode === 'readwrite');
    assert.deepEqual(moveWrites.map(tx => tx.operations), [['get', 'getAll', 'put'], ['get', 'getAll']]);
    assert.equal(moveWrites[1].aborted, true);
    const currentSchedule = await atomicMove.service.checkSchedule({ ...slot, excludeId: secondTarget.id });
    const changedMoveOptions = { ...moveOptions, scheduleExpected: {
        fingerprint: currentSchedule.fingerprint, timezone: slot.timezone } };
    atomicMove.fake.beforeRequest = op => { if (op === 'getAll') atomicMove.session.ownerId = 'bob'; };
    await assert.rejects(atomicMove.service.update(secondTarget.id,
        { startAt: slot.startAt, endAt: slot.endAt }, changedMoveOptions), /EVENT_OWNER_MISMATCH/);
    assert.deepEqual(clone(atomicMove.fake.rows.get(secondTarget.id)), secondTarget);
    assert.equal(atomicMove.emitted.length, 1);
    atomicMove.fake.beforeRequest = null; atomicMove.session.ownerId = 'alice';
    atomicMove.fake.beforeRequest = op => { if (op === 'getAll') throw new Error('FAKE_QUERY_FAILED'); };
    await assert.rejects(atomicMove.service.update(secondTarget.id,
        { startAt: slot.startAt, endAt: slot.endAt }, changedMoveOptions), /FAKE_QUERY_FAILED/);
    assert.deepEqual(clone(atomicMove.fake.rows.get(secondTarget.id)), secondTarget);
    assert.equal(atomicMove.emitted.length, 1);

    const standalone = fixture({ authenticated: false });
    const localEvent = await standalone.service.create(input);
    assert.equal(localEvent.ownerId, 'local-user');
    await standalone.service.create({ ...input, ownerId: 'bob' });
    assert.equal((await standalone.service.list()).length, 2);
    assert.equal((await standalone.service.list({ ownerId: 'bob' })).length, 1);
    assert.equal((await fixture({ verifiedOnly: true }).service.create(input)).ownerId, 'alice');
    console.log('event-service: owner isolation, atomic guards, local conflicts, nearby slots, concurrency and sync compatibility PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
