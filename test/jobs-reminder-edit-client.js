'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/services/jobs-service.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
    const storage = new Map(), requests = [], events = [], toasts = [], listeners = {};
    let ownerId = 'account-a', trusted = true;
    const f = { requests, events, toasts, storage, handler: async () => ({ job: { id: 'job_one', title: 'Llamar', status: 'scheduled' } }) };
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const document = { hidden: true, readyState: 'loading', addEventListener: (name, fn) => { listeners[name] = fn; } };
    const window = {
        localStorage,
        GunterAuth: {
            getUser: () => ownerId ? { id: ownerId } : null,
            canAccessLocalData: () => trusted
        },
        GunterNotificationsService: { showToast: (...args) => { toasts.push(args); f.onToast?.(); } },
        dispatchEvent(event) { events.push({ type: event.type, detail: clone(event.detail) }); f.onEvent?.(event); }
    };
    const context = vm.createContext({
        window, document,
        localStorage,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        fetch: async (url, options) => {
            const request = { url, ...clone(JSON.parse(options.body)) }; requests.push(request);
            const result = await f.handler(request);
            return { ok: result.ok !== false, status: result.status || 200,
                json: async () => {
                    await f.beforeJson?.();
                    return result.success === false
                        ? result : { success: true, data: result.data || result };
                }
            };
        },
        setInterval: () => 1, clearInterval() {},
        console: { warn() {} }
    });
    vm.runInContext(source, context);
    f.service = window.GunterJobs; f.window = window; f.document = document;
    f.switchTo = id => { ownerId = id; };
    f.trust = value => { trusted = value; };
    return f;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

const snapshot = { id: 'job_one', type: 'reminder', title: 'Llamar', runAt: '2030-01-01T15:00:00.000Z',
    priority: 'normal', status: 'scheduled', updatedAt: '2026-10-12T12:00:00.000Z', revision: 0 };
const guard = { ownerId: 'account-a', expected: snapshot, confirmed: true };
let passed = 0;

async function test(name, fn) {
    await fn(); passed++; console.log(`  ✓ ${name}`);
}

(async () => {
    console.log('GUNTER REMINDER EDIT CLIENT');
    await test('actualiza con confirmación, propietario y snapshot exactos', async () => {
        const f = fixture();
        const job = await f.service.updateReminder('job_one', { title: 'Llamar a mamá' }, guard);
        assert.equal(job.id, 'job_one');
        assert.deepEqual(f.requests[0], { url: '/api/jobs', op: 'update_reminder', params: {
            id: 'job_one', ownerId: 'account-a', expected: snapshot, patch: { title: 'Llamar a mamá' }, confirmed: true
        } });
        assert.deepEqual(f.events.map(event => event.type), ['reminders-changed', 'gunter-jobs-changed']);
        assert.ok(f.events.every(event => event.detail.ownerId === 'account-a'));
    });
    await test('rechaza cambios sin confirmación explícita sin contactar al servidor', async () => {
        for (const confirmed of [undefined, false, 'true', 1]) {
            const f = fixture();
            await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, { ...guard, confirmed }),
                error => error.code === 'REMINDER_CONFIRMATION_REQUIRED');
            assert.equal(f.requests.length, 0);
        }
    });
    await test('rechaza un cambio atribuido a otra cuenta o sin propietario', async () => {
        for (const ownerId of [undefined, '', 'account-b']) {
            const f = fixture();
            await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, { ...guard, ownerId }),
                error => error.code === 'JOBS_OWNER_MISMATCH');
            assert.equal(f.requests.length, 0);
        }
    });
    await test('todas las lecturas y mutaciones envían la cuenta verificada', async () => {
        const f = fixture();
        await f.service.scheduleReminder({ title: 'Uno', runAt: snapshot.runAt });
        await f.service.scheduleFollowUp({ title: 'Dos', runAt: snapshot.runAt });
        await f.service.list(); await f.service.get('job_one'); await f.service.cancel('job_one');
        await f.service.retry('job_one'); await f.service.runDue(); await f.service.stats();
        assert.equal(f.requests.length, 8);
        assert.ok(f.requests.every(request => request.params.ownerId === 'account-a'));
    });
    await test('no accede a datos ni muta con cuenta sin verificar o sin autenticación', async () => {
        for (const setup of [f => f.trust(false), f => f.switchTo(null), f => { delete f.window.GunterAuth; }, f => f.switchTo('local-user')]) {
            const f = fixture(); setup(f);
            await assert.rejects(f.service.list(), error => error.code === 'JOBS_AUTH_REQUIRED');
            await assert.rejects(f.service.cancel('job_one'), error => error.code === 'JOBS_AUTH_REQUIRED');
            await assert.rejects(f.service.scheduleReminder({ title: 'Uno', runAt: snapshot.runAt }), error => error.code === 'JOBS_AUTH_REQUIRED');
            assert.equal(f.requests.length, 0);
        }
    });
    await test('no acepta filtros que atribuyan datos a otra cuenta', async () => {
        const f = fixture();
        await assert.rejects(f.service.list({ ownerId: 'account-b' }), error => error.code === 'JOBS_OWNER_MISMATCH');
        assert.equal(f.requests.length, 0);
    });
    await test('una pestaña obsoleta con otro propietario del dispositivo no consulta ni avisa', async () => {
        const f = fixture(); f.storage.set('gunter_device_user', 'account-b');
        f.document.hidden = false;
        await assert.rejects(f.service.list(), error => error.code === 'JOBS_AUTH_REQUIRED');
        await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, guard),
            error => error.code === 'JOBS_AUTH_REQUIRED');
        await f.service.pollCompleted();
        assert.equal(f.requests.length, 0); assert.equal(f.toasts.length, 0); assert.equal(f.events.length, 0);
        assert.deepEqual([...f.storage], [['gunter_device_user', 'account-b']]);
    });
    await test('si no puede comprobar al propietario del dispositivo, falla sin acceder a datos', async () => {
        const f = fixture();
        f.window.localStorage = { getItem() { throw new Error('storage denied'); } };
        await assert.rejects(f.service.get('job_one'), error => error.code === 'JOBS_AUTH_REQUIRED');
        assert.equal(f.requests.length, 0);
    });
    await test('conserva el código de error del servidor y no emite éxito', async () => {
        const f = fixture();
        f.handler = async () => ({ ok: false, success: false, status: 409, error: 'Cambió el recordatorio', code: 'job_changed' });
        await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, guard),
            error => error.code === 'job_changed' && error.message === 'Cambió el recordatorio');
        assert.equal(f.events.length, 0);
    });
    await test('conserva códigos de conflicto del cuerpo real del servidor, sin campo code', async () => {
        for (const code of ['job_changed', 'job_duplicate']) {
            const f = fixture();
            f.handler = async () => ({ ok: false, success: false, status: 409, error: code,
                data: { ok: false, error: code } });
            await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, guard),
                error => error.code === code && error.message === code);
            assert.equal(f.events.length, 0);
        }
    });
    await test('no anuncia actualización si el servidor no devuelve el registro', async () => {
        const f = fixture(); f.handler = async () => ({ data: {} });
        await assert.rejects(f.service.updateReminder('job_one', { title: 'Otra' }, guard),
            error => error.code === 'REMINDER_UPDATE_NOT_VERIFIED');
        assert.equal(f.events.length, 0);
    });
    await test('descarta resultados de lectura y edición si cambia la cuenta durante fetch', async () => {
        for (const action of [f => f.service.list(), f => f.service.updateReminder('job_one', { title: 'Otra' }, guard)]) {
            const f = fixture(), wait = deferred();
            f.handler = async () => { await wait.promise; return { items: [], job: { id: 'job_one' } }; };
            const request = action(f); f.switchTo('account-b'); wait.resolve();
            await assert.rejects(request, error => error.code === 'JOBS_ACCOUNT_CHANGED');
            assert.equal(f.events.length, 0);
        }
    });
    await test('descarta resultados si cambia la cuenta mientras procesa JSON', async () => {
        const f = fixture(); f.beforeJson = async () => { f.switchTo('account-b'); };
        await assert.rejects(f.service.get('job_one'), error => error.code === 'JOBS_ACCOUNT_CHANGED');
    });
    await test('los avisos y el historial de vistos están aislados por cuenta; no migra el legacy', async () => {
        const f = fixture(); f.document.hidden = false;
        f.storage.set('gunter_seen_completed_jobs_v1', JSON.stringify(['job_shared_id']));
        f.handler = async () => ({ items: [{ id: 'job_shared_id', type: 'reminder', title: 'Mi aviso', priority: 'normal' }] });
        await f.service.pollCompleted(); await f.service.pollCompleted();
        assert.equal(f.toasts.length, 1);
        assert.equal(f.storage.get('gunter_seen_completed_jobs_v1:account-a'), '["job_shared_id"]');
        f.switchTo('account-b'); await f.service.pollCompleted();
        assert.equal(f.toasts.length, 2);
        assert.equal(f.storage.get('gunter_seen_completed_jobs_v1:account-b'), '["job_shared_id"]');
        assert.deepEqual(f.events.map(event => event.detail.ownerId), ['account-a', 'account-b']);
    });
    await test('una respuesta de polling de la cuenta anterior no muestra ni guarda avisos', async () => {
        const f = fixture(), wait = deferred(); f.document.hidden = false;
        f.handler = async () => { await wait.promise; return { items: [{ id: 'job_old', type: 'reminder', title: 'Privado' }] }; };
        const poll = f.service.pollCompleted(); f.switchTo('account-b'); wait.resolve(); await poll;
        assert.equal(f.toasts.length, 0); assert.equal(f.events.length, 0); assert.equal(f.storage.size, 0);
    });
    await test('no entrega otros avisos si un componente cambia de cuenta durante el primer aviso', async () => {
        const f = fixture(); f.document.hidden = false;
        f.handler = async () => ({ items: [{ id: 'job_one', title: 'Uno' }, { id: 'job_two', title: 'Dos' }] });
        f.onToast = () => f.switchTo('account-b'); await f.service.pollCompleted();
        assert.equal(f.toasts.length, 1); assert.equal(f.events.length, 0); assert.equal(f.storage.size, 0);
    });
    await test('evita polling simultáneo de la misma cuenta y no consulta en segundo plano', async () => {
        const f = fixture(), wait = deferred();
        await f.service.pollCompleted(); assert.equal(f.requests.length, 0);
        f.document.hidden = false;
        f.handler = async () => { await wait.promise; return { items: [] }; };
        const poll = f.service.pollCompleted(); await f.service.pollCompleted();
        assert.equal(f.requests.length, 1); wait.resolve(); await poll;
    });
    console.log(`═══ REMINDER EDIT CLIENT: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
