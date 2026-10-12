'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/services/jobs-service.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = { id: 'job_one', type: 'reminder', title: 'Llamar', runAt: '2026-10-12T12:00:00.000Z',
    priority: 'normal', status: 'failed', updatedAt: '2026-10-12T12:01:00.000Z', revision: 3 };
const retried = { ...snapshot, status: 'scheduled', attempts: 0, revision: 4, runAt: '2026-10-12T13:00:00.000Z' };
const guard = { ownerId: 'account-a', expected: snapshot, confirmed: true };

function fixture() {
    const requests = [], events = [], storage = new Map();
    let ownerId = 'account-a', trusted = true;
    const f = { requests, events, storage, handler: async () => ({ job: retried }) };
    const localStorage = { getItem: key => storage.get(key) ?? null };
    const window = {
        localStorage,
        GunterAuth: { getUser: () => ownerId ? { id: ownerId } : null, canAccessLocalData: () => trusted },
        dispatchEvent(event) { events.push({ type: event.type, detail: clone(event.detail) }); f.onEvent?.(event); }
    };
    vm.runInNewContext(source, {
        window, localStorage,
        document: { hidden: true, readyState: 'loading', addEventListener() {} },
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

function deferred() {
    let resolve;
    return { promise: new Promise(done => { resolve = done; }), resolve: () => resolve() };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

(async () => {
    console.log('GUNTER REMINDER RETRY CLIENT');
    await test('envía identidad, snapshot y confirmación exactos al reintento protegido', async () => {
        const f = fixture();
        const job = await f.service.retryReminder('job_one', guard);
        assert.deepEqual(clone(job), retried);
        assert.deepEqual(f.requests, [{ url: '/api/jobs', op: 'retry_reminder', params: {
            id: 'job_one', ownerId: 'account-a', expected: snapshot, confirmed: true
        } }]);
        assert.deepEqual(f.events, [
            { type: 'reminders-changed', detail: { type: 'retried', id: 'job_one', ownerId: 'account-a', durable: true } },
            { type: 'gunter-jobs-changed', detail: { type: 'retried', id: 'job_one', ownerId: 'account-a' } }
        ]);
    });
    await test('no contacta al servidor sin confirmación explícita', async () => {
        for (const confirmed of [undefined, false, 'true', 1]) {
            const f = fixture();
            await assert.rejects(f.service.retryReminder('job_one', { ...guard, confirmed }),
                error => error.code === 'REMINDER_CONFIRMATION_REQUIRED');
            assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
        }
    });
    await test('rechaza propietario ausente, vacío o distinto de la cuenta actual', async () => {
        for (const ownerId of [undefined, '', 'account-b']) {
            const f = fixture();
            await assert.rejects(f.service.retryReminder('job_one', { ...guard, ownerId }),
                error => error.code === 'JOBS_OWNER_MISMATCH');
            assert.equal(f.requests.length, 0);
        }
    });
    await test('exige snapshot del mismo recordatorio antes de enviar la mutación', async () => {
        for (const expected of [undefined, null, [], 'job_one', {}, { ...snapshot, id: 'job_other' }]) {
            const f = fixture();
            await assert.rejects(f.service.retryReminder('job_one', { ...guard, expected }),
                error => error.code === 'job_snapshot_required');
            assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
        }
    });
    await test('rechaza sesiones no verificadas, inexistentes y legacy local-user', async () => {
        for (const setup of [f => f.trust(false), f => f.switchTo(null), f => f.switchTo('local-user'),
            f => { delete f.window.GunterAuth; }]) {
            const f = fixture(); setup(f);
            await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === 'JOBS_AUTH_REQUIRED');
            assert.equal(f.requests.length, 0);
        }
    });
    await test('una pestaña con propietario obsoleto no reintenta ni emite eventos', async () => {
        const f = fixture(); f.storage.set('gunter_device_user', 'account-b');
        await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === 'JOBS_AUTH_REQUIRED');
        assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
    });
    await test('falla cerrado si no puede verificar el propietario del dispositivo', async () => {
        const f = fixture(); f.window.localStorage = { getItem() { throw new Error('storage denied'); } };
        await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === 'JOBS_AUTH_REQUIRED');
        assert.equal(f.requests.length, 0);
    });
    await test('preserva el código de conflicto del servidor sin anunciar éxito', async () => {
        for (const code of ['job_changed', 'job_not_retryable', 'job_persist_failed']) {
            const f = fixture(); f.handler = async () => ({ ok: false, success: false, status: 409,
                error: code, data: { ok: false, error: code } });
            await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === code);
            assert.equal(f.events.length, 0);
        }
    });
    await test('preserva un error explícito del servidor con mensaje útil', async () => {
        const f = fixture(); f.handler = async () => ({ ok: false, success: false, status: 403,
            code: 'job_owner_mismatch', error: 'La sesión ya no coincide.' });
        await assert.rejects(f.service.retryReminder('job_one', guard),
            error => error.code === 'job_owner_mismatch' && error.message === 'La sesión ya no coincide.');
        assert.equal(f.events.length, 0);
    });
    await test('no anuncia reintento si falta el registro o su identidad/estado son incorrectos', async () => {
        for (const job of [undefined, null, {}, { ...retried, id: 'job_other' }, { ...retried, type: 'follow_up' },
            { ...retried, status: 'failed' }]) {
            const f = fixture(); f.handler = async () => ({ data: { job } });
            await assert.rejects(f.service.retryReminder('job_one', guard),
                error => error.code === 'REMINDER_RETRY_NOT_VERIFIED');
            assert.equal(f.events.length, 0);
        }
    });
    await test('descarta la respuesta si cambia la cuenta durante fetch', async () => {
        const f = fixture(), wait = deferred();
        f.handler = async () => { await wait.promise; return { job: retried }; };
        const request = f.service.retryReminder('job_one', guard); f.switchTo('account-b'); wait.resolve();
        await assert.rejects(request, error => error.code === 'JOBS_ACCOUNT_CHANGED');
        assert.equal(f.events.length, 0);
    });
    await test('descarta la respuesta si cambia la cuenta mientras procesa JSON', async () => {
        const f = fixture(); f.beforeJson = async () => f.switchTo('account-b');
        await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === 'JOBS_ACCOUNT_CHANGED');
        assert.equal(f.events.length, 0);
    });
    await test('no entrega el segundo evento a una cuenta cambiada por el primer listener', async () => {
        const f = fixture(); f.onEvent = () => f.switchTo('account-b');
        await assert.rejects(f.service.retryReminder('job_one', guard), error => error.code === 'JOBS_ACCOUNT_CHANGED');
        assert.equal(f.events.length, 1); assert.equal(f.events[0].detail.ownerId, 'account-a');
    });
    await test('conserva retry legacy con su operación original', async () => {
        const f = fixture(); const job = await f.service.retry('job_one');
        assert.equal(job.id, 'job_one');
        assert.deepEqual(f.requests, [{ url: '/api/jobs', op: 'retry', params: { id: 'job_one', ownerId: 'account-a' } }]);
        assert.equal(f.events.length, 0);
    });
    console.log(`═══ REMINDER RETRY CLIENT: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
