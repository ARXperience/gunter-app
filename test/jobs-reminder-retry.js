/* Reintento focalizado de recordatorios durables: permisos, CAS y persistencia. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const userContext = require('../server/user-context');
const userStore = require('../server/user-store');
const jobs = require('../server/jobs');
const userA = `_test_jobretry_a_${process.pid}_${Date.now()}`;
const userB = `_test_jobretry_b_${process.pid}_${Date.now()}`;
let passed = 0;
let serial = 0;

function create(overrides = {}) {
    const result = jobs.create({ type: 'reminder', title: `Recordatorio ${++serial}`,
        runAt: new Date(Date.now() - 30_000).toISOString(), ...overrides });
    assert.equal(result.ok, true);
    return result.job;
}
function failed(overrides = {}) {
    const job = create(overrides);
    return jobs._store.update(job.id, {
        status: 'failed', attempts: job.maxAttempts, lastError: 'No se pudo guardar el aviso',
        result: { stale: true }, startedAt: job.runAt, completedAt: job.runAt,
        cancelledAt: job.runAt, nextAttemptAt: job.runAt
    });
}
function retry(job, overrides = {}) {
    return jobs.retryReminder({ id: job.id, ownerId: userA, expected: jobs.snapshot(job), confirmed: true, ...overrides });
}
async function test(name, fn) {
    await userContext.runAs(userA, async () => { jobs.clear(); await fn(); });
    passed++;
    console.log(`  ✓ ${name}`);
}
function invokeApi(params, op = 'retry_reminder') {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
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

(async () => {
    console.log('GUNTER DURABLE REMINDER RETRY');
    await test('acepta el mismo registro para el scheduler sin afirmar entrega', () => {
        const job = failed({ priority: 'urgent', payload: { message: 'Mensaje personal', extra: { keep: true } }, maxAttempts: 4 });
        const before = Date.now();
        const result = retry(job);
        assert.equal(result.ok, true);
        assert.equal(result.job.status, 'scheduled');
        assert.equal(result.job.attempts, 0);
        assert.equal(result.job.revision, job.revision + 1);
        assert.ok(new Date(result.job.runAt).getTime() >= before);
        assert.ok(new Date(result.job.runAt).getTime() <= Date.now());
        for (const key of ['id', 'createdAt', 'priority', 'payload', 'maxAttempts', 'title']) {
            assert.deepStrictEqual(result.job[key], job[key], key);
        }
        for (const key of ['nextAttemptAt', 'lastError', 'result', 'startedAt', 'completedAt', 'cancelledAt']) assert.equal(result.job[key], null, key);
        assert.equal(jobs.list().length, 1);
        assert.deepStrictEqual(jobs.get(job.id), result.job);
    });
    await test('conserva el último fallo sin modificar el payload ni crear otra historia', () => {
        const job = failed({ payload: { meta: { caller: 'chat' } } });
        const result = retry(job);
        assert.deepStrictEqual(result.job.lastFailure, {
            attempts: job.attempts, lastError: job.lastError, runAt: job.runAt,
            failedAt: job.updatedAt, retriedAt: result.job.runAt
        });
        assert.deepStrictEqual(result.job.payload, job.payload);
    });
    await test('exige confirmación explícita, no coerción', () => {
        const job = failed();
        for (const confirmed of [undefined, false, 'true', 1]) {
            assert.equal(retry(job, { confirmed }).error, 'job_confirmation_required');
        }
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('exige cuenta de sesión real y rechaza fallback', () => {
        const job = failed();
        for (const ownerId of [undefined, null, '', userB]) assert.equal(retry(job, { ownerId }).error, 'job_owner_mismatch');
        assert.equal(userContext.runAs(null, () => retry(job)).error, 'job_owner_mismatch');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('rechaza parámetros o identificadores malformados antes de escribir', () => {
        const job = failed();
        for (const params of [null, [], 'retry', 42, { confirmed: true, ownerId: userA, id: job.id, expected: jobs.snapshot(job), patch: {} }]) {
            assert.equal(jobs.retryReminder(params).error, 'job_params_invalid');
        }
        for (const id of [undefined, '', 42, ` ${job.id}`, 'x'.repeat(201), `job\n${job.id}`]) {
            assert.equal(retry(job, { id }).error, 'job_id_invalid');
        }
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('snapshot exacto y del mismo ID/tipo, sin campos extra', () => {
        const job = failed();
        for (const expected of [undefined, {}, { ...jobs.snapshot(job), id: 'otro' },
            { ...jobs.snapshot(job), type: 'follow_up' }, { ...jobs.snapshot(job), revision: -1 },
            { ...jobs.snapshot(job), extra: true }]) assert.equal(retry(job, { expected }).error, 'job_snapshot_required');
        const expected = jobs.snapshot(job); delete expected.updatedAt;
        assert.equal(retry(job, { expected }).error, 'job_snapshot_required');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('solo permite failed; no reemplaza ejecución, espera o estado terminal', () => {
        for (const status of ['scheduled', 'running', 'retry_wait', 'completed', 'cancelled']) {
            const job = jobs._store.update(failed().id, { status });
            const expected = { ...jobs.snapshot(job), status: 'failed' };
            assert.equal(retry(job, { expected }).error, 'job_not_retryable', status);
            assert.deepStrictEqual(jobs.get(job.id), job);
        }
        const followUp = failed({ type: 'follow_up' });
        assert.equal(retry(followUp, { expected: { ...jobs.snapshot(followUp), type: 'reminder' } }).error, 'job_not_retryable');
    });
    await test('no reintenta avisos vinculados a eventos en ninguna ubicación', () => {
        for (const payload of [{ eventLink: { eventId: 'evento' } }, { meta: { eventLink: { eventId: 'evento' } } }]) {
            const job = failed({ payload });
            assert.equal(retry(job).error, 'job_not_retryable');
            assert.deepStrictEqual(jobs.get(job.id), job);
        }
    });
    await test('otra cuenta no puede consultar ni reintentar el registro', () => {
        const job = failed();
        userContext.runAs(userB, () => {
            jobs.clear();
            assert.equal(jobs.get(job.id), null);
            assert.equal(retry(job, { ownerId: userB }).error, 'job_not_found');
        });
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('CAS protege cambios concurrentes y un doble reintento', () => {
        const job = failed();
        const changed = jobs._store.update(job.id, { lastError: 'Otro fallo más reciente' });
        assert.equal(retry(job).error, 'job_changed');
        assert.deepStrictEqual(jobs.get(job.id), changed);
        assert.equal(retry(changed).ok, true);
        assert.equal(retry(changed).error, 'job_not_retryable');
        assert.equal(jobs.list().length, 1);
    });
    await test('legacy de la cuenta sin revisión recibe una revisión monotónica', () => {
        const job = failed();
        const all = jobs._store._loadAll(); delete all[0].revision; jobs._store._saveAll(all);
        const legacy = jobs.get(job.id);
        assert.equal(jobs.snapshot(legacy).revision, 0);
        const result = retry(legacy);
        assert.equal(result.ok, true);
        assert.equal(result.job.revision, 1);
        assert.equal(result.job.createdAt, job.createdAt);
    });
    await test('histórico con fecha corrupta falla explícitamente y no cambia datos', () => {
        const job = jobs._store.update(failed().id, { runAt: 'fecha-inválida' });
        assert.equal(retry(job).error, 'job_not_retryable');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('actualiza dedupe derivado al nuevo instante y conserva claves propias', () => {
        const derived = failed();
        const result = retry(derived);
        assert.notEqual(result.job.dedupeKey, derived.dedupeKey);
        assert.equal(result.job.dedupeKey, jobs._validateCreate({ type: derived.type, title: derived.title, runAt: result.job.runAt }).value.dedupeKey);
        const custom = failed({ dedupeKey: 'clave-explícita' });
        assert.equal(retry(custom).job.dedupeKey, custom.dedupeKey);
    });
    await test('rechaza duplicado activo por clave original, no solo por el nuevo instante', () => {
        for (const status of ['scheduled', 'retry_wait', 'running']) {
            jobs.clear();
            const job = failed();
            const active = create({ title: 'Otro título', dedupeKey: job.dedupeKey });
            jobs._store.update(active.id, { status });
            assert.equal(retry(job).error, 'job_duplicate', status);
            assert.deepStrictEqual(jobs.get(job.id), job);
            assert.equal(jobs.list().length, 2);
        }
    });
    await test('rechaza duplicado por título/fecha original con claves personalizadas distintas', () => {
        const job = failed({ dedupeKey: 'fallido' });
        create({ title: job.title.toUpperCase(), runAt: job.runAt, dedupeKey: 'activo' });
        assert.equal(retry(job).error, 'job_duplicate');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('rechaza colisión de la nueva clave derivada antes de persistir', () => {
        const RealDate = global.Date;
        const fixed = Date.now();
        global.Date = class extends RealDate {
            constructor(...args) { super(...(args.length ? args : [fixed])); }
            static now() { return fixed; }
        };
        try {
            const job = failed();
            const intended = jobs._validateCreate({ type: job.type, title: job.title, runAt: new Date().toISOString() }).value;
            create({ title: 'Otra tarea', dedupeKey: intended.dedupeKey });
            assert.equal(retry(job).error, 'job_duplicate');
            assert.deepStrictEqual(jobs.get(job.id), job);
        } finally { global.Date = RealDate; }
    });
    await test('fallo de escritura no devuelve éxito ni deja una restauración parcial', () => {
        const job = failed();
        const originalWrite = fs.writeFileSync;
        fs.writeFileSync = function (target, ...args) {
            if (String(target).includes('.jobs-')) throw new Error('escritura aislada denegada');
            return originalWrite.call(fs, target, ...args);
        };
        try { assert.equal(retry(job).error, 'job_persist_failed'); }
        finally { fs.writeFileSync = originalWrite; }
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('reemplazo atómico fallido conserva archivo original y limpia temporal', () => {
        const job = failed();
        const target = userStore.userFile('jobs.json');
        const originalBytes = fs.readFileSync(target, 'utf8');
        const originalRename = fs.renameSync;
        fs.renameSync = function (from, to) {
            if (String(from).includes('.jobs-') && to === target) throw new Error('archivo bloqueado');
            return originalRename.call(fs, from, to);
        };
        try { assert.equal(retry(job).error, 'job_persist_failed'); }
        finally { fs.renameSync = originalRename; }
        assert.equal(fs.readFileSync(target, 'utf8'), originalBytes);
        assert.deepStrictEqual(jobs.get(job.id), job);
        assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.startsWith('.jobs-')), false);
    });
    await test('reintento y procedencia sobreviven a recargar el store', () => {
        const result = retry(failed());
        assert.equal(result.ok, true);
        const storePath = require.resolve('../server/jobs/store'); delete require.cache[storePath];
        assert.deepStrictEqual(require(storePath).get(result.job.id), result.job);
    });
    await test('el scheduler ejecuta una vez el mismo ID con el presupuesto original', async () => {
        const job = failed({ maxAttempts: 1 });
        const result = retry(job);
        const executed = [];
        const outcome = await jobs.runDue({ _now: new Date(Date.now() + 1_000), _executor: async running => {
            executed.push(running.id);
            assert.equal(running.attempts, 1);
            assert.equal(running.maxAttempts, 1);
            return { test: true };
        } });
        assert.deepStrictEqual(executed, [job.id]);
        assert.equal(outcome.processed, 1);
        assert.equal(jobs.get(job.id).status, 'completed');
        assert.deepStrictEqual(jobs.get(job.id).lastFailure, result.job.lastFailure);
        assert.equal(jobs.list().length, 1);
    });
    await test('un nuevo fallo no borra el anterior y un segundo reintento conserva solo el último', async () => {
        const job = failed({ maxAttempts: 1 });
        retry(job);
        await jobs.runDue({ _now: new Date(Date.now() + 1_000), _executor: async () => { throw new Error('fallo nuevo'); } });
        const nextFailure = jobs.get(job.id);
        assert.equal(nextFailure.status, 'failed');
        assert.equal(nextFailure.lastError, 'fallo nuevo');
        assert.equal(nextFailure.lastFailure.lastError, job.lastError);
        const second = retry(nextFailure);
        assert.equal(second.ok, true);
        assert.equal(second.job.lastFailure.lastError, 'fallo nuevo');
        assert.equal(second.job.lastFailure.attempts, 1);
        assert.equal(jobs.list().length, 1);
    });
    await test('API exige sesión, confirmación y devuelve registro persistido', async () => {
        const job = failed();
        const params = { id: job.id, ownerId: userA, expected: jobs.snapshot(job), confirmed: true };
        assert.equal((await invokeApi({ ...params, ownerId: userB })).error, 'job_owner_mismatch');
        assert.equal((await invokeApi({ ...params, confirmed: false })).error, 'job_confirmation_required');
        const result = await invokeApi(params);
        assert.equal(result.status, 200);
        assert.equal(result.success, true);
        assert.deepStrictEqual(result.data.job, jobs.get(job.id));
        assert.equal(result.data.job.status, 'scheduled');
        const duplicate = await invokeApi(params);
        assert.equal(duplicate.status, 400);
        assert.equal(duplicate.success, false);
        assert.equal(duplicate.error, 'job_not_retryable');
    });
    await test('API rechaza cuerpos de parámetros inválidos con error 400 estable', async () => {
        for (const params of [null, [], 'retry', 42]) {
            const result = await invokeApi(params);
            assert.equal(result.status, 400);
            assert.equal(result.error, 'job_params_invalid');
        }
    });
    await test('operación retry legacy permanece compatible para sus usuarios existentes', async () => {
        const job = failed({ type: 'follow_up' });
        const result = await invokeApi({ id: job.id }, 'retry');
        assert.equal(result.success, true);
        assert.equal(result.data.job.status, 'scheduled');
        assert.equal(result.data.job.id, job.id);
    });
    console.log(`═══ DURABLE REMINDER RETRY: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => {
    console.error('  ✗', error.stack || error.message);
    process.exitCode = 1;
}).finally(() => {
    userStore.removeUserData(userA);
    userStore.removeUserData(userB);
});
