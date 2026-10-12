'use strict';

/* Cancelación durable confirmada: mismo registro, CAS, scheduler y cuenta activa. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const userContext = require('../server/user-context');
const userStore = require('../server/user-store');
const jobs = require('../server/jobs');
const userA = `_test_jobcancel_a_${process.pid}_${Date.now()}`;
const userB = `_test_jobcancel_b_${process.pid}_${Date.now()}`;
let passed = 0, serial = 0;
const clone = value => JSON.parse(JSON.stringify(value));

function create(overrides = {}) {
    const result = jobs.create({ type: 'reminder', title: `Recordatorio ${++serial}`,
        runAt: new Date(Date.now() - 30_000).toISOString(), ...overrides });
    assert.equal(result.ok, true);
    return result.job;
}
function cancel(job, overrides = {}) {
    return jobs.cancelReminder({ id: job.id, ownerId: userA, expected: jobs.snapshot(job), confirmed: true, ...overrides });
}
async function test(name, fn) {
    await userContext.runAs(userA, async () => { jobs.clear(); await fn(); });
    passed++;
    console.log(`  ✓ ${name}`);
}
function invokeApi(params, op = 'cancel_reminder') {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf("    if (parsedUrl.pathname === '/api/jobs'");
    const end = source.indexOf('\n    // ============================================', start);
    const req = new EventEmitter(); req.method = 'POST';
    return new Promise((resolve, reject) => {
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, ...JSON.parse(body) }); } };
        Promise.resolve(vm.runInNewContext(`(async function () { ${source.slice(start, end)} })()`,
            { parsedUrl: { pathname: '/api/jobs' }, req, res, jobs, userContext, JSON }))
            .then(() => { req.emit('data', JSON.stringify({ op, params })); req.emit('end'); }).catch(reject);
    });
}

const clientSource = fs.readFileSync(path.join(__dirname, '../js/services/jobs-service.js'), 'utf8');
const clientSnapshot = { id: 'job_one', type: 'reminder', title: 'Llamar', runAt: '2026-10-12T12:00:00.000Z',
    priority: 'normal', status: 'retry_wait', updatedAt: '2026-10-12T12:01:00.000Z', revision: 3 };
const cancelled = { ...clientSnapshot, status: 'cancelled', attempts: 2, revision: 4, cancelledAt: '2026-10-12T13:00:00.000Z' };
const clientGuard = { ownerId: 'account-a', expected: clientSnapshot, confirmed: true };
function clientFixture() {
    const requests = [], events = [], storage = new Map();
    let ownerId = 'account-a', trusted = true;
    const f = { requests, events, storage, handler: async () => ({ job: cancelled }) };
    const localStorage = { getItem: key => storage.get(key) ?? null };
    const window = {
        localStorage,
        GunterAuth: { getUser: () => ownerId ? { id: ownerId } : null, canAccessLocalData: () => trusted },
        dispatchEvent(event) { events.push({ type: event.type, detail: clone(event.detail) }); f.onEvent?.(event); }
    };
    vm.runInNewContext(clientSource, {
        window, localStorage, document: { hidden: true, readyState: 'loading', addEventListener() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        fetch: async (url, options) => {
            const request = { url, ...JSON.parse(options.body) }; requests.push(request);
            const result = await f.handler(request);
            return { ok: result.ok !== false, status: result.status || 200, json: async () => {
                await f.beforeJson?.();
                return result.success === false ? result : { success: true, data: result.data || result };
            } };
        },
        setInterval: () => 1, clearInterval() {}, console: { warn() {} }
    });
    f.service = window.GunterJobs; f.window = window;
    f.switchTo = id => { ownerId = id; };
    f.trust = value => { trusted = value; };
    return f;
}

(async () => {
    console.log('GUNTER GUARDED DURABLE REMINDER CANCEL');
    await test('scheduled/retry_wait cancelan mismo registro conservando historial, payload y dedupe', () => {
        for (const status of ['scheduled', 'retry_wait']) {
            const created = create({ priority: 'urgent', payload: { message: 'Personal', extra: true }, dedupeKey: 'propia' });
            const job = jobs._store.update(created.id, { status, attempts: 2, lastError: 'fallo previo',
                result: { interventionId: 'historico' }, lastFailure: { attempts: 1 }, nextAttemptAt: created.runAt });
            const result = cancel(job);
            assert.equal(result.ok, true); assert.equal(result.job.status, 'cancelled');
            assert.equal(result.job.revision, job.revision + 1);
            assert.equal(result.job.updatedAt, result.job.cancelledAt);
            assert.ok(Number.isFinite(new Date(result.job.cancelledAt).getTime()));
            for (const key of Object.keys(job).filter(key => !['status', 'updatedAt', 'cancelledAt', 'revision'].includes(key))) {
                assert.deepEqual(result.job[key], job[key], key);
            }
            assert.deepEqual(jobs.get(job.id), result.job);
        }
        assert.equal(jobs.list().length, 2);
    });
    await test('rechaza confirmación coercitiva y propietario ajeno o no autenticado', () => {
        const job = create();
        for (const confirmed of [undefined, false, 'true', 1]) assert.equal(cancel(job, { confirmed }).error, 'job_confirmation_required');
        for (const ownerId of [undefined, null, '', userB]) assert.equal(cancel(job, { ownerId }).error, 'job_owner_mismatch');
        assert.equal(userContext.runAs(null, () => cancel(job)).error, 'job_owner_mismatch');
        assert.deepEqual(jobs.get(job.id), job);
    });
    await test('rechaza parámetros inválidos y snapshot incompleto antes de escribir', () => {
        const job = create();
        for (const params of [null, [], 'cancel', 42, { id: job.id, ownerId: userA, expected: jobs.snapshot(job), confirmed: true, patch: {} }]) {
            assert.equal(jobs.cancelReminder(params).error, 'job_params_invalid');
        }
        for (const id of [undefined, '', 42, ` ${job.id}`, 'x'.repeat(201), `job\n${job.id}`]) {
            assert.equal(cancel(job, { id }).error, 'job_params_invalid');
        }
        for (const expected of [undefined, {}, { ...jobs.snapshot(job), id: 'otro' },
            { ...jobs.snapshot(job), revision: -1 }, { ...jobs.snapshot(job), extra: true }]) {
            assert.equal(cancel(job, { expected }).error, 'job_snapshot_required');
        }
        assert.deepEqual(jobs.get(job.id), job);
    });
    await test('no cancela running, estados terminales ni seguimientos', () => {
        for (const status of ['running', 'completed', 'failed', 'cancelled']) {
            const job = jobs._store.update(create().id, { status });
            assert.equal(cancel(job).error, 'job_not_cancellable', status);
            assert.deepEqual(jobs.get(job.id), job);
        }
        const followUp = create({ type: 'follow_up' });
        assert.equal(cancel(followUp).error, 'job_not_cancellable');
        assert.deepEqual(jobs.get(followUp.id), followUp);
    });
    await test('rechaza avisos vinculados a eventos en ambas ubicaciones', () => {
        for (const payload of [{ eventLink: { eventId: 'e1' } }, { meta: { eventLink: { eventId: 'e1' } } }]) {
            const job = create({ payload });
            assert.equal(cancel(job).error, 'job_not_cancellable');
            assert.deepEqual(jobs.get(job.id), job);
        }
    });
    await test('CAS detecta cambios concurrentes incluso sin cambio visible de título/fecha', () => {
        const job = create();
        const changed = jobs._store.update(job.id, { attempts: 1 });
        assert.equal(cancel(job).error, 'job_changed'); assert.deepEqual(jobs.get(job.id), changed);
        assert.equal(cancel(changed).ok, true);
        assert.equal(cancel(changed).error, 'job_not_cancellable');
        assert.equal(jobs.list().length, 1);
    });
    await test('no busca ni modifica registros de otra cuenta', () => {
        const job = create();
        userContext.runAs(userB, () => {
            jobs.clear(); assert.equal(jobs.get(job.id), null);
            assert.equal(cancel(job, { ownerId: userB }).error, 'job_not_found');
        });
        assert.deepEqual(jobs.get(job.id), job);
    });
    await test('registros legacy verificables mantienen identidad y reciben revisión monotónica', () => {
        const job = create(); const all = jobs._store._loadAll(); delete all[0].revision; jobs._store._saveAll(all);
        const result = cancel(jobs.get(job.id));
        assert.equal(result.ok, true); assert.equal(result.job.revision, 1);
        assert.equal(result.job.id, job.id); assert.equal(result.job.createdAt, job.createdAt);
    });
    await test('fallo del reemplazo atómico no anuncia éxito ni cambia archivo original', () => {
        const job = create(), target = userStore.userFile('jobs.json');
        const originalBytes = fs.readFileSync(target, 'utf8'), originalRename = fs.renameSync;
        fs.renameSync = function (from, to) {
            if (String(from).includes('.jobs-') && to === target) throw new Error('archivo bloqueado');
            return originalRename.call(fs, from, to);
        };
        try { assert.equal(cancel(job).error, 'job_persist_failed'); }
        finally { fs.renameSync = originalRename; }
        assert.equal(fs.readFileSync(target, 'utf8'), originalBytes);
        assert.deepEqual(jobs.get(job.id), job);
        assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.startsWith('.jobs-')), false);
    });
    await test('más de 200 registros históricos no ocultan los avisos nuevos en el scheduler', async () => {
        const active = create();
        const history = Array.from({ length: 201 }, (_, i) => ({ ...active, id: `job_old_${i}`,
            runAt: '2025-10-12T12:00:00Z', status: 'completed', revision: 5 }));
        assert.equal(jobs._store._saveAll([...history, active]), true);
        const executed = [];
        const result = await jobs.runDue({ _now: new Date(Date.now() + 1_000), _executor: async job => {
            executed.push(job.id); return { test: true };
        } });
        assert.equal(result.processed, 1); assert.deepEqual(executed, [active.id]);
    });
    await test('scheduler omite cancelados, incluso cancelados durante espera del job anterior', async () => {
        const first = create(), second = create(), third = create();
        assert.equal(cancel(third).ok, true);
        const executed = [];
        const result = await jobs.runDue({ _now: new Date(Date.now() + 1_000), _executor: async job => {
            executed.push(job.id);
            if (job.id === first.id) assert.equal(cancel(second).ok, true);
            return { test: true };
        } });
        assert.deepEqual(executed, [first.id]); assert.equal(result.processed, 1);
        assert.equal(jobs.get(second.id).status, 'cancelled'); assert.equal(jobs.get(third.id).status, 'cancelled');
    });
    await test('API expone operación protegida y mantiene cancel legacy compatible', async () => {
        const job = create(), params = { id: job.id, ownerId: userA, expected: jobs.snapshot(job), confirmed: true };
        assert.equal((await invokeApi({ ...params, ownerId: userB })).error, 'job_owner_mismatch');
        assert.equal((await invokeApi({ ...params, confirmed: false })).error, 'job_confirmation_required');
        const result = await invokeApi(params);
        assert.equal(result.status, 200); assert.equal(result.success, true);
        assert.deepEqual(result.data.job, jobs.get(job.id)); assert.equal(result.data.job.status, 'cancelled');
        assert.equal((await invokeApi(params)).error, 'job_not_cancellable');
        const legacy = create({ type: 'follow_up' });
        assert.equal((await invokeApi({ id: legacy.id }, 'cancel')).data.job.status, 'cancelled');
    });
    await test('cliente envía cuenta/snapshot/confirmación y solo emite eventos de la cuenta autorizada', async () => {
        const f = clientFixture(); const job = await f.service.cancelReminder('job_one', clientGuard);
        assert.deepEqual(clone(job), cancelled);
        assert.deepEqual(f.requests, [{ url: '/api/jobs', op: 'cancel_reminder', params: {
            id: 'job_one', ownerId: 'account-a', expected: clientSnapshot, confirmed: true
        } }]);
        assert.deepEqual(f.events, [
            { type: 'reminders-changed', detail: { type: 'cancelled', id: 'job_one', ownerId: 'account-a', durable: true } },
            { type: 'gunter-jobs-changed', detail: { type: 'cancelled', id: 'job_one', ownerId: 'account-a' } }
        ]);
    });
    await test('cliente exige confirmación estricta, propietario y snapshot completo antes de red', async () => {
        const invalid = [
            [{ ...clientGuard, confirmed: false }, 'REMINDER_CONFIRMATION_REQUIRED'],
            [{ ...clientGuard, confirmed: 'true' }, 'REMINDER_CONFIRMATION_REQUIRED'],
            [{ ...clientGuard, ownerId: undefined }, 'JOBS_OWNER_MISMATCH'],
            [{ ...clientGuard, ownerId: 'account-b' }, 'JOBS_OWNER_MISMATCH'],
            [{ ...clientGuard, expected: {} }, 'job_snapshot_required'],
            [{ ...clientGuard, expected: { ...clientSnapshot, id: 'otro' } }, 'job_snapshot_required'],
            [{ ...clientGuard, expected: { ...clientSnapshot, extra: true } }, 'job_snapshot_required']
        ];
        for (const [guard, code] of invalid) {
            const f = clientFixture();
            await assert.rejects(f.service.cancelReminder('job_one', guard), error => error.code === code);
            assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
        }
    });
    await test('cliente falla cerrado sin sesión confiable, con cuenta obsoleta o almacenamiento inaccesible', async () => {
        for (const setup of [f => f.trust(false), f => f.switchTo(null), f => f.switchTo('local-user'),
            f => f.storage.set('gunter_device_user', 'account-b'),
            f => { f.window.localStorage = { getItem() { throw new Error('storage denied'); } }; }]) {
            const f = clientFixture(); setup(f);
            await assert.rejects(f.service.cancelReminder('job_one', clientGuard), error => error.code === 'JOBS_AUTH_REQUIRED');
            assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
        }
    });
    await test('cliente conserva conflictos y fallos del servidor sin emitir éxito', async () => {
        for (const code of ['job_changed', 'job_not_cancellable', 'job_persist_failed']) {
            const f = clientFixture(); f.handler = async () => ({ ok: false, success: false, status: 400, error: code, data: { ok: false, error: code } });
            await assert.rejects(f.service.cancelReminder('job_one', clientGuard), error => error.code === code);
            assert.equal(f.events.length, 0);
        }
    });
    await test('cliente no anuncia cancelación si resultado tiene identidad, estado o evidencia inválidos', async () => {
        for (const job of [undefined, null, {}, { ...cancelled, id: 'otro' }, { ...cancelled, type: 'follow_up' },
            { ...cancelled, status: 'running' }, { ...cancelled, revision: 3 }, { ...cancelled, title: 'Otra' },
            { ...cancelled, cancelledAt: 'invalido' }]) {
            const f = clientFixture(); f.handler = async () => ({ data: { job } });
            await assert.rejects(f.service.cancelReminder('job_one', clientGuard), error => error.code === 'REMINDER_CANCEL_NOT_VERIFIED');
            assert.equal(f.events.length, 0);
        }
    });
    await test('cliente descarta respuesta si cambia cuenta durante fetch o JSON', async () => {
        for (const stage of ['fetch', 'json']) {
            const f = clientFixture();
            if (stage === 'fetch') f.handler = async () => { f.switchTo('account-b'); return { job: cancelled }; };
            else f.beforeJson = async () => f.switchTo('account-b');
            await assert.rejects(f.service.cancelReminder('job_one', clientGuard), error => error.code === 'JOBS_ACCOUNT_CHANGED');
            assert.equal(f.events.length, 0);
        }
    });
    await test('cliente detiene segundo evento cuando primer listener cambia la cuenta y conserva cancel legacy', async () => {
        const f = clientFixture(); f.onEvent = () => f.switchTo('account-b');
        await assert.rejects(f.service.cancelReminder('job_one', clientGuard), error => error.code === 'JOBS_ACCOUNT_CHANGED');
        assert.equal(f.events.length, 1); assert.equal(f.events[0].detail.ownerId, 'account-a');
        const legacy = clientFixture(); await legacy.service.cancel('job_one');
        assert.equal(legacy.requests[0].op, 'cancel'); assert.equal(legacy.events.length, 0);
    });
    console.log(`═══ GUARDED REMINDER CANCEL: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => {
    userStore.removeUserData(userA); userStore.removeUserData(userB);
});
