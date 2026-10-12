'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const seed = { id: 'rem_local', title: 'Consultar resultados', fireAt: '2026-10-14T15:00:00Z',
    status: 'scheduled', ownerId: 'alice', priority: 'normal', meta: { message: 'Detalle autorizado' },
    createdAt: '2026-10-12T12:00:00Z', updatedAt: '2026-10-12T12:00:00Z' };
const snapshot = row => Object.fromEntries(['id', 'title', 'fireAt', 'status', 'updatedAt'].map(key => [key, row[key]]));
function fixture(extras = {}) {
    const session = { ownerId: 'alice', trusted: true }, storage = new Map(), events = [];
    const state = { rows: new Map([['rem_local', { ...clone(seed), ...extras }]]), beforeGet: null, failWrite: false, writes: 0 };
    const db = { close() {}, transaction(name, mode = 'readonly') {
        assert.equal(name, 'reminders'); const staged = new Map([...state.rows].map(([id, row]) => [id, clone(row)]));
        let aborted = false;
        const tx = { error: null, abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() {
            return { get(id) {
                const req = {};
                queueMicrotask(() => {
                    state.beforeGet?.(mode, id, staged); req.result = clone(staged.get(id)); req.onsuccess?.();
                    queueMicrotask(() => {
                        if (aborted) return;
                        if (mode === 'readwrite') state.rows = staged;
                        tx.oncomplete?.();
                    });
                }); return req;
            }, put(row) {
                if (state.failWrite) { tx.error = new Error('FAKE_WRITE_FAILED'); tx.abort(); return; }
                assert.equal(mode, 'readwrite'); staged.set(row.id, clone(row)); state.writes++;
            } };
        } }; return tx;
    } };
    const indexedDB = { open() {
        const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req;
    } };
    const window = { GunterAuth: { getUser: () => ({ id: session.ownerId }), canAccessLocalData: () => session.trusted },
        localStorage: { getItem: key => storage.get(key) ?? null }, addEventListener() {},
        dispatchEvent: event => events.push(event) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/notifications-service.js'), 'utf8'),
        { window, document: { readyState: 'loading', addEventListener() {} }, indexedDB,
            CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
            Date, setTimeout, clearTimeout, navigator: {}, console });
    return { window, session, storage, events, state, service: window.GunterNotificationsService,
        row: () => state.rows.get('rem_local'), opts: () => ({ ownerId: 'alice', expected: snapshot(state.rows.get('rem_local')) }) };
}
let cases = 0;
async function check(name, run) { await run(); cases++; console.log(`PASS ${name}`); }
(async () => {
    await check('guarded cancellation preserves the record and persists before emitting', async () => {
        const f = fixture(); const old = clone(f.row());
        const result = await f.service.cancel('rem_local', f.opts());
        assert.equal(result.status, 'cancelled'); assert.equal(f.row().status, 'cancelled');
        assert.equal(result.id, old.id); assert.equal(result.createdAt, old.createdAt);
        assert.equal(result.priority, old.priority); assert.deepEqual(clone(result.meta), old.meta);
        assert.equal(result.updatedAt, result.cancelledAt); assert.equal(f.state.writes, 1);
        assert.equal(f.events.length, 1); assert.equal(f.events[0].detail.ownerId, 'alice');
    });
    await check('snapshot field changes never cancel the revised reminder', async () => {
        for (const key of ['title', 'fireAt', 'updatedAt']) {
            const f = fixture(); const opts = f.opts(); f.row()[key] = `different-${key}`;
            await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_CHANGED/);
            assert.equal(f.row().status, 'scheduled'); assert.equal(f.state.writes, 0); assert.equal(f.events.length, 0);
        }
    });
    await check('fired and cancelled reminders cannot be cancelled again through guarded calls', async () => {
        for (const status of ['fired', 'cancelled']) {
            const f = fixture({ status });
            await assert.rejects(f.service.cancel('rem_local', f.opts()), /REMINDER_NOT_CANCELLABLE/);
            assert.equal(f.state.writes, 0); assert.equal(f.row().status, status);
        }
    });
    await check('missing or unrelated snapshots reject before writing', async () => {
        for (const expected of [undefined, {}, { ...snapshot(seed), id: 'different' }, { ...snapshot(seed), status: 'fired' }]) {
            const f = fixture(); await assert.rejects(f.service.cancel('rem_local', { ownerId: 'alice', expected }), /REMINDER_CHANGED/);
            assert.equal(f.state.writes, 0);
        }
    });
    await check('wrong owner and stale device block cancellation', async () => {
        const f = fixture(); await assert.rejects(f.service.cancel('rem_local', { ...f.opts(), ownerId: 'bob' }), /REMINDER_ACCOUNT_CHANGED/);
        f.storage.set('gunter_device_user', 'bob');
        await assert.rejects(f.service.cancel('rem_local', f.opts()), /REMINDER_ACCOUNT_CHANGED/);
        assert.equal(f.state.writes, 0);
    });
    await check('a race after the first read is detected atomically at mutation', async () => {
        const f = fixture(), opts = f.opts();
        f.state.beforeGet = (mode, id, staged) => {
            if (mode === 'readwrite') { staged.get(id).title = 'Título cambiado por otra pestaña'; f.row().title = staged.get(id).title; }
        };
        await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_CHANGED/);
        assert.equal(f.row().status, 'scheduled'); assert.equal(f.state.writes, 0); assert.equal(f.events.length, 0);
    });
    await check('a timer firing after selection cannot be overwritten as cancelled', async () => {
        const f = fixture(), opts = f.opts();
        f.state.beforeGet = (mode, id, staged) => {
            if (mode === 'readwrite') { staged.get(id).status = 'fired'; f.row().status = 'fired'; }
        };
        await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_NOT_CANCELLABLE/);
        assert.equal(f.row().status, 'fired'); assert.equal(f.state.writes, 0); assert.equal(f.events.length, 0);
    });
    await check('account changes while the transaction reads fail closed', async () => {
        const f = fixture(), opts = f.opts();
        f.state.beforeGet = mode => { if (mode === 'readwrite') f.session.ownerId = 'bob'; };
        await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_ACCOUNT_CHANGED/);
        assert.equal(f.row().status, 'scheduled'); assert.equal(f.state.writes, 0);
    });
    await check('a deleted or foreign selection is rejected as changed without mutation', async () => {
        for (const mode of ['deleted', 'foreign']) {
            const f = fixture(), opts = f.opts();
            if (mode === 'deleted') f.state.rows.clear(); else f.row().ownerId = 'bob';
            await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_CHANGED/);
            assert.equal(f.state.writes, 0); assert.equal(f.events.length, 0);
        }
    });
    await check('account changes during the initial read get a scoped account error', async () => {
        const f = fixture(), opts = f.opts();
        f.state.beforeGet = mode => { if (mode === 'readonly') f.session.ownerId = 'bob'; };
        await assert.rejects(f.service.cancel('rem_local', opts), /REMINDER_ACCOUNT_CHANGED/);
        assert.equal(f.row().status, 'scheduled'); assert.equal(f.state.writes, 0);
    });
    await check('failed persistence leaves status unchanged and emits no success', async () => {
        const f = fixture(); f.state.failWrite = true;
        await assert.rejects(f.service.cancel('rem_local', f.opts()), /FAKE_WRITE_FAILED/);
        assert.equal(f.row().status, 'scheduled'); assert.equal(f.events.length, 0);
    });
    await check('legacy no-options cancellation remains compatible', async () => {
        const f = fixture(); const result = await f.service.cancel('rem_local');
        assert.equal(result.status, 'cancelled'); assert.equal(f.state.writes, 1);
    });
    await check('owned legacy local reminders without updatedAt accept the same null snapshot without migration', async () => {
        const f = fixture(); delete f.row().updatedAt;
        const expected = { ...snapshot(f.row()), updatedAt: null };
        const result = await f.service.cancel('rem_local', { ownerId: 'alice', expected });
        assert.equal(result.status, 'cancelled');
        assert.equal(result.ownerId, 'alice');
        assert.equal(f.state.writes, 1);
    });
    await check('guarded local API does not downgrade durable requests to unguarded jobs cancel', async () => {
        const f = fixture(); let calls = 0; f.window.GunterJobs = { cancel() { calls++; } };
        await assert.rejects(f.service.cancel('job_example', { ownerId: 'alice', expected: snapshot(seed) }), /REMINDER_DURABLE_CANCEL_REQUIRES_JOB/);
        assert.equal(calls, 0); assert.equal(f.state.writes, 0);
    });
    console.log(`reminders-cancel-local: ${cases} focused confirmation-snapshot/atomic/privacy cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
