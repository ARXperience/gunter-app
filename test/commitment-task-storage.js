'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Transactions serialize and stage writes until commit. Abort discards the
// staged add, including when authentication changes during its success event.
function fixture({ verifiedOnly = false } = {}) {
    const state = { rows: new Map(), failAdd: false, beforeRequest: null, beforeComplete: null,
        transactions: [], closed: 0 };
    const session = { ownerId: 'alice', trusted: true };
    const stored = new Map();
    const events = [], names = new Set(), pending = [];
    let active = false, upgraded = false;
    function nextTransaction() {
        if (active || !pending.length) return;
        active = true;
        setTimeout(pending.shift(), 0);
    }
    const db = {
        objectStoreNames: { contains: name => names.has(name) },
        createObjectStore(name) { names.add(name); return { createIndex() {} }; },
        close() { state.closed++; },
        transaction(name, mode = 'readonly') {
            assert.equal(name, 'tasks');
            const operations = [], log = { mode, operations: [], committed: false, aborted: false };
            state.transactions.push(log);
            let staged, ended = false;
            const tx = { error: null, objectStore() {
                const request = (op, value) => {
                    const req = {}; operations.push({ op, value: clone(value), req }); log.operations.push(op); return req;
                };
                return { get: id => request('get', id), getAll: () => request('getAll'),
                    add: row => request('add', row), put: row => request('put', row) };
            }, abort() {
                if (ended) return;
                ended = true; log.aborted = true;
                setTimeout(() => { tx.onabort?.(); release(); }, 0);
            } };
            function release() { active = false; nextTransaction(); }
            function nextRequest() {
                if (ended) return;
                const item = operations.shift();
                if (!item) {
                    ended = true;
                    if (mode === 'readwrite') state.rows = staged;
                    log.committed = true; state.beforeComplete?.(); tx.oncomplete?.(); release(); return;
                }
                setTimeout(() => {
                    if (ended) return;
                    try {
                        state.beforeRequest?.(item.op, item.value);
                        if (item.op === 'getAll') item.req.result = clone([...staged.values()]);
                        else if (item.op === 'get') item.req.result = clone(staged.get(item.value));
                        else {
                            assert.equal(mode, 'readwrite');
                            if (item.op === 'add' && state.failAdd) throw new Error('FAKE_ADD_FAILED');
                            if (item.op === 'add' && staged.has(item.value.id)) throw new Error('DUPLICATE_ID');
                            staged.set(item.value.id, item.value);
                        }
                        item.req.onsuccess?.();
                    } catch (error) {
                        tx.error = item.req.error = error; item.req.onerror?.(); tx.onerror?.(); tx.abort();
                    }
                    nextRequest();
                }, 0);
            }
            pending.push(() => {
                staged = new Map([...state.rows].map(([id, row]) => [id, clone(row)])); nextRequest();
            });
            nextTransaction(); return tx;
        }
    };
    const indexedDB = { open(name, version) {
        assert.equal(name, 'gunter_daily'); assert.equal(version, 2);
        const request = { result: db };
        setTimeout(() => {
            if (!upgraded) { upgraded = true; request.onupgradeneeded?.({ oldVersion: 0 }); }
            request.onsuccess?.();
        }, 0); return request;
    } };
    const storage = { failRead: false, getItem(key) {
        if (this.failRead) throw new Error('STORAGE_FAILED'); return stored.get(key) ?? null;
    } };
    const window = { localStorage: storage, dispatchEvent: event => events.push(event), GunterAuth: {
        getUser: () => ({ id: session.ownerId }),
        [verifiedOnly ? 'isVerified' : 'canAccessLocalData']: () => session.trusted
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/tasks-service.js'), 'utf8'),
        { window, indexedDB, Date, Math, Promise, Number,
            CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } } });
    return { state, session, stored, storage, events, names, window, service: window.GunterTasksService };
}
const data = { title: ' Entregar informe ', notes: 'Revisar el presupuesto\nantes de enviarlo',
    dueAt: '2026-10-14T10:00:00-05:00', priority: 'high', projectId: 'project_1', projectName: 'Presupuesto',
    meta: { commitmentId: 'cmt_reviewed_1', sourceType: 'meeting', sourceRefId: 'project_1',
        sourceTs: '2026-10-12T12:00:00Z', excerpt: 'Me encargo de revisar el presupuesto',
        token: 'not-to-store', ownerId: 'bob' }, people: ['Carlos'], tags: ['reunión'] };
const guard = { ownerId: 'alice', confirmed: true };
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
(async () => {
    await check('creates one confirmed owned task using the existing IndexedDB schema', async () => {
        const f = fixture(); const result = await f.service.createFromCommitment(data, guard);
        assert.equal(result.created, true); assert.equal(result.task.ownerId, 'alice');
        assert.equal(result.task.title, 'Entregar informe'); assert.equal(result.task.source, 'commitment');
        assert.equal(result.task.status, 'pending'); assert.equal(result.task.dueAt, '2026-10-14T15:00:00.000Z');
        assert.deepEqual([...f.names].sort(), ['events', 'reminders', 'tasks']);
        assert.deepEqual(f.state.transactions[0].operations, ['getAll', 'add']);
        assert.equal(f.state.transactions[0].mode, 'readwrite'); assert.equal(f.state.rows.size, 1);
        assert.equal(f.events[0].type, 'tasks-changed'); assert.equal(f.events[0].detail.ownerId, 'alice');
        assert.equal(f.state.closed, 1);
        assert.equal('token' in result.task.meta, false); assert.equal('ownerId' in result.task.meta, false);
        assert.equal(result.task.meta.sourceRefId, 'project_1'); assert.equal(result.task.projectId, 'project_1');
    });
    await check('deduplicates concurrent tabs atomically', async () => {
        const f = fixture(); const results = await Promise.all([
            f.service.createFromCommitment(data, guard), f.service.createFromCommitment(data, guard)
        ]);
        assert.equal(f.state.rows.size, 1); assert.equal(results[0].task.id, results[1].task.id);
        assert.deepEqual(results.map(x => x.created).sort(), [false, true]); assert.equal(f.events.length, 1);
    });
    await check('completed and cancelled tasks remain linked instead of generating duplicates', async () => {
        for (const status of ['pending', 'doing', 'done', 'cancelled']) {
            const f = fixture(); const first = await f.service.createFromCommitment(data, guard);
            f.state.rows.get(first.task.id).status = status;
            const second = await f.service.createFromCommitment({ ...data, title: 'Otra descripción' }, guard);
            assert.equal(second.created, false); assert.equal(second.task.id, first.task.id);
            assert.equal(second.task.status, status); assert.equal(f.state.rows.size, 1);
        }
    });
    await check('foreign, ownerless and legacy tasks never become this account’s linked task', async () => {
        const f = fixture();
        for (const [id, ownerId] of [['foreign', 'bob'], ['legacy', 'local-user'], ['unowned', undefined]]) {
            f.state.rows.set(id, { id, ownerId, title: 'private foreign content', source: 'commitment', meta: { commitmentId: data.meta.commitmentId } });
        }
        const before = clone([...f.state.rows.values()]);
        const result = await f.service.createFromCommitment(data, guard);
        assert.equal(result.created, true); assert.equal(result.task.ownerId, 'alice'); assert.equal(f.state.rows.size, 4);
        assert.deepEqual(clone([...f.state.rows.values()].slice(0, 3)), before);
    });
    await check('requires an explicit confirmation and account-bound guard', async () => {
        const f = fixture();
        for (const bad of [undefined, null, [], {}, { ownerId: 'alice', confirmed: false }, { ownerId: 'alice', confirmed: 1 }]) {
            await assert.rejects(f.service.createFromCommitment(data, bad), /TASK_CONFIRM_REQUIRED/);
        }
        await assert.rejects(f.service.createFromCommitment(data, { confirmed: true }), /TASK_ACCOUNT_CHANGED/);
        await assert.rejects(f.service.createFromCommitment(data, { ownerId: 'bob', confirmed: true }), /TASK_ACCOUNT_CHANGED/);
        await assert.rejects(f.service.createFromCommitment({ ...data, ownerId: 'bob' }, guard), /TASK_ACCOUNT_CHANGED/);
        assert.equal(f.state.transactions.length, 0); assert.equal(f.events.length, 0);
    });
    await check('blocks unavailable authentication, invalid account and conflicting device identity', async () => {
        for (const mode of ['absent', 'untrusted', 'nonboolean-trust', 'legacy', 'device', 'empty-device', 'storage']) {
            const f = fixture();
            if (mode === 'absent') delete f.window.GunterAuth;
            if (mode === 'untrusted') f.session.trusted = false;
            if (mode === 'nonboolean-trust') f.session.trusted = 'yes';
            if (mode === 'legacy') f.session.ownerId = 'local-user';
            if (mode === 'device') f.stored.set('gunter_device_user', 'bob');
            if (mode === 'empty-device') f.stored.set('gunter_device_user', '');
            if (mode === 'storage') f.storage.failRead = true;
            await assert.rejects(f.service.createFromCommitment(data, guard), /TASK_(AUTH_REQUIRED|ACCOUNT_CHANGED)/);
            assert.equal(f.state.rows.size, 0); assert.equal(f.events.length, 0);
        }
    });
    await check('keeps the verified-session compatibility fallback', async () => {
        const f = fixture({ verifiedOnly: true }); const result = await f.service.createFromCommitment(data, guard);
        assert.equal(result.task.ownerId, 'alice');
    });
    await check('validates title, commitment ID, dates and bounded metadata before opening storage', async () => {
        const f = fixture();
        for (const patch of [
            { title: '' }, { title: ' '.repeat(3) }, { title: 1 }, { title: 'x'.repeat(501) }, { title: 'bad\u0000title' },
            { dueAt: 'invalid' }, { dueAt: '' }, { dueAt: 0 }, { meta: null }, { meta: {} },
            { meta: { commitmentId: 'task_1' } }, { meta: { commitmentId: 'cmt_' } },
            { meta: { commitmentId: 'cmt_1', sourceType: 'credentials' } },
            { meta: { commitmentId: 'cmt_1', sourceRefId: 'x'.repeat(161) } },
            { meta: { commitmentId: 'cmt_1', sourceTs: 'invalid' } },
            { notes: 'x'.repeat(5001) }, { tags: [{}] }, { priority: 'critical' }
        ]) await assert.rejects(f.service.createFromCommitment({ ...data, ...patch }, guard), /TASK_INVALID_/);
        assert.equal(f.state.transactions.length, 0); assert.equal(f.state.rows.size, 0);
        const result = await f.service.createFromCommitment({ ...data, dueAt: null, source: 'cloud', status: 'done', id: 'spoof' }, guard);
        assert.equal(result.task.dueAt, null); assert.equal(result.task.source, 'commitment'); assert.equal(result.task.status, 'pending');
        assert.notEqual(result.task.id, 'spoof');
    });
    await check('revalidates account after opening storage, before any transaction', async () => {
        const f = fixture(); const pending = f.service.createFromCommitment(data, guard); f.session.ownerId = 'bob';
        await assert.rejects(pending, /TASK_ACCOUNT_CHANGED/); assert.equal(f.state.rows.size, 0);
        assert.equal(f.state.transactions.length, 0); assert.equal(f.state.closed, 1);
    });
    await check('account changes during read or add abort the atomic transaction', async () => {
        for (const op of ['getAll', 'add']) {
            const f = fixture(); f.state.beforeRequest = current => { if (current === op) f.session.ownerId = 'bob'; };
            await assert.rejects(f.service.createFromCommitment(data, guard), /TASK_ACCOUNT_CHANGED/);
            assert.equal(f.state.rows.size, 0); assert.equal(f.state.transactions[0].aborted, true); assert.equal(f.events.length, 0);
        }
    });
    await check('a switch at completion never exposes another account’s result or emits success', async () => {
        const f = fixture(); f.state.beforeComplete = () => { f.session.ownerId = 'bob'; };
        await assert.rejects(f.service.createFromCommitment(data, guard), /TASK_ACCOUNT_CHANGED/);
        assert.equal(f.events.length, 0); assert.equal([...f.state.rows.values()][0].ownerId, 'alice');
    });
    await check('storage errors rollback additions and emit no success', async () => {
        const f = fixture(); f.state.failAdd = true;
        await assert.rejects(f.service.createFromCommitment(data, guard), /FAKE_ADD_FAILED/);
        assert.equal(f.state.rows.size, 0); assert.equal(f.events.length, 0); assert.equal(f.state.closed, 1);
    });
    await check('completing a task never triggers fuzzy server commitment reconciliation', async () => {
        const f = fixture(); let calls = 0;
        f.window.GunterCommitmentsService = { reconcile() { calls++; return Promise.resolve({ updated: 1 }); } };
        const result = await f.service.createFromCommitment(data, guard);
        const completed = await f.service.complete(result.task.id, 'alice');
        assert.equal(completed.status, 'done'); assert.equal(calls, 0);
        assert.equal(f.events.some(event => event.type === 'gunter-commitments-changed'), false);
    });
    console.log(`commitment-task-storage: ${checks} focused atomic/dedupe/privacy cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
