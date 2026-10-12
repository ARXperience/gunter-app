'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const local = (id, extras = {}) => ({ id, title: `Local ${id}`, ownerId: 'alice',
    status: 'scheduled', fireAt: '2026-10-12T16:00:00Z', ...extras });
const durable = (id, extras = {}) => ({ id, type: 'reminder', title: `Durable ${id}`,
    status: 'scheduled', runAt: '2026-10-12T15:00:00Z', payload: {}, ...extras });

// Read-only IndexedDB harness follows the notifications fixture contract; no
// imported test runner or real Gunter records are touched.
function fixture(rows = []) {
    const session = { ownerId: 'alice', trusted: true }, storage = new Map(), calls = [];
    const state = { rows: clone(rows), failOpen: false, failRead: false,
        beforeOpen: null, beforeRead: null, closed: 0 };
    const db = { close() { state.closed++; }, transaction(name, mode) {
        assert.equal(name, 'reminders'); assert.ok(!mode || mode === 'readonly');
        return { objectStore() { return { getAll() {
            const req = {};
            queueMicrotask(() => {
                state.beforeRead?.();
                if (state.failRead) { req.error = new Error('SECRET_LOCAL_ERROR'); req.onerror?.(); }
                else { req.result = clone(state.rows); req.onsuccess?.(); }
            });
            return req;
        } }; } };
    } };
    const indexedDB = { open(name) {
        assert.equal(name, 'gunter_daily'); const req = {};
        queueMicrotask(() => {
            state.beforeOpen?.();
            if (state.failOpen) { req.error = new Error('SECRET_OPEN_ERROR'); req.onerror?.(); }
            else { req.result = db; req.onsuccess?.(); }
        });
        return req;
    } };
    const window = {
        GunterAuth: { canAccessLocalData: () => session.trusted, getUser: () => ({ id: session.ownerId }) },
        localStorage: { getItem: key => storage.get(key) ?? null },
        addEventListener() {}, dispatchEvent() {},
        GunterJobs: { async list(options) { calls.push(clone(options)); return []; } }
    };
    const document = { readyState: 'loading', addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/notifications-service.js'), 'utf8'),
        { window, document, indexedDB, navigator: {}, setTimeout, clearTimeout, Date, Intl,
            CustomEvent: class {}, console });
    return { window, session, storage, state, calls, service: window.GunterNotificationsService };
}
function noAccountData(result, code) {
    assert.deepEqual(clone(result.items), []); assert.equal(result.ownerId, null);
    assert.equal(result.sources.local.available, false); assert.equal(result.sources.durable.available, false);
    assert.equal(result.sources.local.error, code); assert.equal(result.sources.durable.error, code);
    assert.equal(result.limited, false);
}
let cases = 0;
async function check(name, run) { await run(); cases++; console.log(`PASS ${name}`); }

(async () => {
    await check('empty successful sources are distinct from unavailable ones', async () => {
        const f = fixture(); const result = await f.service.listSnapshot();
        assert.deepEqual(clone(result), { items: [], ownerId: 'alice',
            sources: { local: { available: true }, durable: { available: true } }, limited: false });
        assert.deepEqual(f.calls, [{ type: 'reminder', limit: 200 }]);
    });
    await check('all states aggregate and sort without losing terminal reminders', async () => {
        const f = fixture([local('rem_cancelled', { status: 'cancelled' }), local('rem_fired', { status: 'fired' })]);
        f.window.GunterJobs.list = async () => [durable('job_failed', { status: 'failed' }), durable('job_done', { status: 'completed' })];
        const result = await f.service.listSnapshot();
        assert.equal(result.items.length, 4);
        assert.deepEqual(clone(result.items.map(row => row.status).sort()), ['cancelled', 'completed', 'failed', 'fired']);
        assert.equal(result.items[0].durable, true);
    });
    await check('unowned quarantine and other local accounts are not attributed', async () => {
        const f = fixture([local('mine'), local('foreign', { ownerId: 'bob' }),
            local('unowned', { ownerId: undefined }), local('legacy', { ownerId: 'local-user' })]);
        const before = clone(f.state.rows); const result = await f.service.listSnapshot();
        assert.deepEqual(clone(result.items.map(row => row.id)), ['mine']);
        assert.deepEqual(f.state.rows, before);
    });
    await check('explicit foreign durable rows are rejected and scoped server rows are runtime-only', async () => {
        const f = fixture(); const jobs = [durable('job_scoped'), durable('job_mine', { ownerId: 'alice' }),
            durable('job_foreign', { ownerId: 'bob', payload: { secret: 'FOREIGN_CONTENT' } }),
            durable('job_unowned', { ownerId: null }), durable('job_other_type', { type: 'follow_up' })];
        const before = clone(jobs); f.window.GunterJobs.list = async () => jobs;
        const result = await f.service.listSnapshot();
        assert.deepEqual(clone(result.items.map(row => row.id).sort()), ['job_mine', 'job_scoped']);
        assert.ok(result.items.every(row => row.ownerId === 'alice' && row.durable));
        assert.deepEqual(jobs, before); assert.ok(!JSON.stringify(result).includes('FOREIGN_CONTENT'));
    });
    await check('durable get uses the same scoped runtime owner projection without writing its source', async () => {
        const f = fixture(); const job = durable('job_scoped'), before = clone(job);
        f.window.GunterJobs.get = async id => { assert.equal(id, job.id); return job; };
        const result = await f.service.get(job.id);
        assert.equal(result.ownerId, 'alice'); assert.equal(result.durable, true); assert.equal(result.id, job.id);
        assert.deepEqual(job, before); assert.equal(f.state.closed, 0);
        for (const row of [durable(job.id, { ownerId: 'bob' }), durable(job.id, { ownerId: null }),
            durable(job.id, { type: 'follow_up' })]) {
            f.window.GunterJobs.get = async () => row;
            assert.equal(await f.service.get(job.id), null);
        }
    });
    await check('durable get rejects an account change during its await', async () => {
        const f = fixture(); f.window.GunterJobs.get = async () => {
            f.session.ownerId = 'bob'; return durable('job_scoped');
        };
        await assert.rejects(f.service.get('job_scoped'), /REMINDER_ACCOUNT_CHANGED/);
        assert.equal(f.state.closed, 0);
    });
    await check('durable status wins mirrored local ID and filtering happens after deduplication', async () => {
        const f = fixture([local('job_mirror')]);
        f.window.GunterJobs.list = async () => [durable('job_mirror', { status: 'completed' })];
        const all = await f.service.listSnapshot();
        assert.equal(all.items.length, 1); assert.equal(all.items[0].status, 'completed'); assert.equal(all.items[0].durable, true);
        assert.deepEqual(clone((await f.service.listSnapshot({ status: 'scheduled' })).items), []);
        assert.equal((await f.service.listSnapshot({ status: 'completed' })).items.length, 1);
    });
    await check('local unavailable still exposes scoped durable rows and a safe diagnostic', async () => {
        const f = fixture(); f.state.failRead = true;
        f.window.GunterJobs.list = async () => [durable('job_ok')];
        const result = await f.service.listSnapshot();
        assert.equal(result.items[0].id, 'job_ok'); assert.equal(result.sources.local.available, false);
        assert.equal(result.sources.local.error, 'REMINDER_LOCAL_UNAVAILABLE'); assert.equal(result.sources.durable.available, true);
        assert.ok(!JSON.stringify(result).includes('SECRET')); assert.equal(f.state.closed, 1);
    });
    await check('missing durable service is unavailable rather than a successful empty list', async () => {
        const f = fixture([local('mine')]); delete f.window.GunterJobs;
        const result = await f.service.listSnapshot();
        assert.equal(result.items.length, 1); assert.equal(result.sources.local.available, true);
        assert.deepEqual(clone(result.sources.durable), { available: false, error: 'REMINDER_DURABLE_UNAVAILABLE' });
    });
    await check('durable failure keeps only verified local records without raw errors', async () => {
        const f = fixture([local('mine')]);
        f.window.GunterJobs.list = async () => { throw new Error('SECRET_TOKEN_AND_USER'); };
        const result = await f.service.listSnapshot();
        assert.equal(result.items.length, 1); assert.equal(result.sources.durable.error, 'REMINDER_DURABLE_UNAVAILABLE');
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    });
    await check('malformed durable response is unavailable, never a false empty success', async () => {
        const f = fixture([local('mine')]); f.window.GunterJobs.list = async () => ({ items: [] });
        const result = await f.service.listSnapshot();
        assert.equal(result.items.length, 1); assert.equal(result.sources.durable.available, false);
    });
    await check('200 bound explicitly reports a limited collection', async () => {
        const f = fixture(); f.window.GunterJobs.list = async () => Array.from({ length: 200 }, (_, i) => durable(`job_${i}`));
        const result = await f.service.listSnapshot(); assert.equal(result.items.length, 200); assert.equal(result.limited, true);
        f.window.GunterJobs.list = async () => [durable('job_only')]; assert.equal((await f.service.listSnapshot()).limited, false);
    });
    await check('unauthenticated access does not read either source', async () => {
        const f = fixture([local('mine')]); f.session.trusted = false;
        noAccountData(await f.service.listSnapshot(), 'REMINDER_AUTH_REQUIRED');
        assert.equal(f.calls.length, 0); assert.equal(f.state.closed, 0);
    });
    await check('stale device owner and unreadable storage fail closed', async () => {
        for (const mode of ['stale', 'unreadable']) {
            const f = fixture([local('mine')]);
            if (mode === 'stale') f.storage.set('gunter_device_user', 'bob');
            else f.window.localStorage.getItem = () => { throw new Error('SECRET_STORAGE_ERROR'); };
            const result = await f.service.listSnapshot(); noAccountData(result, 'REMINDER_ACCOUNT_CHANGED');
            assert.equal(f.calls.length, 0); assert.equal(f.state.closed, 0); assert.ok(!JSON.stringify(result).includes('SECRET'));
        }
    });
    await check('account changes during opening IndexedDB abort snapshot before reading', async () => {
        const f = fixture([local('mine')]); f.state.beforeOpen = () => { f.session.ownerId = 'bob'; };
        noAccountData(await f.service.listSnapshot(), 'REMINDER_ACCOUNT_CHANGED'); assert.equal(f.calls.length, 0);
        assert.equal(f.state.closed, 1);
    });
    await check('account changes while reading local rows discard the full snapshot', async () => {
        const f = fixture([local('mine')]); f.state.beforeRead = () => { f.storage.set('gunter_device_user', 'bob'); };
        noAccountData(await f.service.listSnapshot(), 'REMINDER_ACCOUNT_CHANGED'); assert.equal(f.calls.length, 0);
    });
    await check('account changes while reading durable rows discard local fallback too', async () => {
        const f = fixture([local('mine')]); f.window.GunterJobs.list = async () => {
            f.session.ownerId = 'bob'; return [durable('job_other')];
        };
        noAccountData(await f.service.listSnapshot(), 'REMINDER_ACCOUNT_CHANGED');
    });
    await check('durable failure after sign-out never returns an old account fallback', async () => {
        const f = fixture([local('mine')]); f.window.GunterJobs.list = async () => {
            f.session.trusted = false; throw new Error('SECRET_NETWORK_ERROR');
        };
        noAccountData(await f.service.listSnapshot(), 'REMINDER_AUTH_REQUIRED');
    });
    await check('legacy list API remains a filtered array and unauthenticated returns no data', async () => {
        const f = fixture([local('active'), local('done', { status: 'fired' })]);
        assert.deepEqual(clone((await f.service.list({ status: 'scheduled' })).map(row => row.id)), ['active']);
        f.session.trusted = false; assert.deepEqual(clone(await f.service.list()), []);
    });
    await check('status-scoped queries preserve active legacy consumers when more than 200 history records exist', async () => {
        const f = fixture();
        const rows = [...Array.from({ length: 201 }, (_, i) => durable(`job_history_${i}`, { status: 'completed' })), durable('job_active')];
        f.window.GunterJobs.list = async params => rows.filter(row => !params.status || row.status === params.status).slice(0, params.limit);
        assert.deepEqual(clone((await f.service.list({ status: 'scheduled' })).map(row => row.id)), ['job_active']);
        const snapshot = await f.service.listSnapshot({ statuses: ['scheduled', 'running', 'retry_wait'] });
        assert.deepEqual(clone(snapshot.items.map(row => row.id)), ['job_active']);
        assert.equal(snapshot.limited, false);
        assert.equal((await f.service.listSnapshot()).limited, true);
    });
    await check('a local mirror never becomes a server-owned active fallback during a source outage', async () => {
        const f = fixture([local('job_mirror'), local('rem_real')]);
        f.window.GunterJobs.list = async () => { throw new Error('PRIVATE_NETWORK_ERROR'); };
        const snapshot = await f.service.listSnapshot({ status: 'scheduled' });
        assert.deepEqual(clone(snapshot.items.map(row => row.id)), ['rem_real']);
        assert.equal(snapshot.sources.durable.available, false);
    });
    console.log(`reminders-snapshot: ${cases} focused aggregation/availability/privacy cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
