/* Edición focalizada de recordatorios durables: autorización, snapshots y scheduler. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const userContext = require('../server/user-context');
const userStore = require('../server/user-store');
const jobs = require('../server/jobs');
const userA = `_test_jobedit_a_${process.pid}_${Date.now()}`;
const userB = `_test_jobedit_b_${process.pid}_${Date.now()}`;
let passed = 0;
let serial = 0;

function future(minutes = 20) { return new Date(Date.now() + minutes * 60_000).toISOString(); }
function create(overrides = {}) {
    const result = jobs.create({ type: 'reminder', title: `Recordatorio ${++serial}`, runAt: future(), ...overrides });
    assert.equal(result.ok, true);
    return result.job;
}
function edit(job, patch = { title: 'Título actualizado' }, overrides = {}) {
    return jobs.updateReminder({ id: job.id, ownerId: userA, expected: jobs.snapshot(job), patch, confirmed: true, ...overrides });
}
async function test(name, fn) {
    await userContext.runAs(userA, async () => { jobs.clear(); await fn(); });
    passed++;
    console.log(`  ✓ ${name}`);
}
function invokeApi(params, op = 'update_reminder') {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf("    if (parsedUrl.pathname === '/api/jobs'");
    const end = source.indexOf('\n    // ============================================', start);
    const route = `(async function () { ${source.slice(start, end)} })()`;
    const req = new EventEmitter(); req.method = 'POST';
    return new Promise((resolve, reject) => {
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, ...JSON.parse(body) }); } };
        Promise.resolve(vm.runInNewContext(route, { parsedUrl: { pathname: '/api/jobs' }, req, res, jobs, userContext, JSON }))
            .then(() => { req.emit('data', JSON.stringify({ op, params })); req.emit('end'); }).catch(reject);
    });
}

(async () => {
    console.log('GUNTER DURABLE REMINDER EDIT');
    await test('renombra sin perder identidad, creación, prioridad, payload ni datos de ejecución', () => {
        const job = create({ priority: 'high', payload: { message: 'Mensaje propio', extra: { keep: true } }, maxAttempts: 4 });
        const result = edit(job, { title: '  Revisar informe  ' });
        assert.equal(result.ok, true);
        assert.equal(result.job.title, 'Revisar informe');
        assert.equal(result.job.revision, job.revision + 1);
        for (const key of ['id', 'createdAt', 'runAt', 'priority', 'payload', 'attempts', 'maxAttempts', 'lastError', 'result', 'status']) {
            assert.deepStrictEqual(result.job[key], job[key], key);
        }
        assert.notEqual(result.job.dedupeKey, job.dedupeKey);
    });
    await test('reprograma con zona explícita y actualiza dedupe derivado', () => {
        const job = create();
        const runAt = future(40).replace('Z', '+00:00');
        const result = edit(job, { runAt });
        assert.equal(result.ok, true);
        assert.equal(result.job.runAt, new Date(runAt).toISOString());
        assert.equal(result.job.dedupeKey, jobs._validateCreate({ type: job.type, title: job.title, runAt }).value.dedupeKey);
        assert.equal(jobs.create({ type: job.type, title: job.title, runAt: job.runAt }).duplicate, false);
        assert.equal(jobs.create({ type: job.type, title: job.title, runAt: result.job.runAt }).duplicate, true);
    });
    await test('conserva un dedupe personalizado', () => {
        const job = create({ dedupeKey: 'recordatorio-personalizado' });
        const result = edit(job, { title: 'Título nuevo', runAt: future(50) });
        assert.equal(result.ok, true);
        assert.equal(result.job.dedupeKey, job.dedupeKey);
    });
    await test('rechaza duplicados por título/fecha aunque tengan claves personalizadas', () => {
        const target = create({ dedupeKey: 'uno' });
        const other = create({ dedupeKey: 'dos', runAt: future(50) });
        jobs._store.update(other.id, { runAt: other.runAt.replace('Z', '+00:00') });
        const result = edit(target, { title: other.title, runAt: other.runAt });
        assert.equal(result.error, 'job_duplicate');
        assert.deepStrictEqual(jobs.get(target.id), target);
    });
    await test('rechaza colisión de dedupe y conserva todos los registros', () => {
        const target = create();
        const intended = { type: target.type, title: 'Cambio colisiona', runAt: target.runAt };
        create({ title: 'Otro registro', dedupeKey: jobs._validateCreate(intended).value.dedupeKey });
        assert.equal(edit(target, { title: intended.title }).error, 'job_duplicate');
        assert.deepStrictEqual(jobs.get(target.id), target);
    });
    await test('exige confirmación explícita', () => {
        const job = create();
        for (const confirmed of [false, undefined, 'true', 1]) assert.equal(edit(job, undefined, { confirmed }).error, 'job_confirmation_required');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('exige identidad de sesión y rechaza fallback o cuenta diferente', () => {
        const job = create();
        assert.equal(edit(job, undefined, { ownerId: undefined }).error, 'job_owner_mismatch');
        assert.equal(edit(job, undefined, { ownerId: userB }).error, 'job_owner_mismatch');
        assert.equal(userContext.runAs(null, () => edit(job)).error, 'job_owner_mismatch');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('no consulta ni edita el recordatorio de otra cuenta', () => {
        const job = create();
        userContext.runAs(userB, () => {
            jobs.clear();
            assert.equal(jobs.get(job.id), null);
            assert.equal(edit(job, undefined, { ownerId: userB }).error, 'job_not_found');
        });
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('valida patch, título, fechas, zona y límite antes de modificar', () => {
        const job = create();
        for (const patch of [null, [], {}, { priority: 'low' }, { revision: 0 }, { payload: {} }]) {
            assert.equal(edit(job, patch).error, 'job_patch_invalid');
        }
        for (const title of ['', 'x', 42, 'x'.repeat(181)]) assert.equal(edit(job, { title }).error, 'job_title_invalid');
        for (const runAt of ['mañana', '2030-01-01T10:00:00', 42, '2027-02-30T10:00:00Z', '2027-01-01T10:00:00+14:30']) {
            assert.equal(edit(job, { runAt }).error, 'job_run_at_invalid');
        }
        assert.equal(edit(job, { runAt: future(-1) }).error, 'job_run_at_not_future');
        assert.equal(edit(job, { runAt: future(367 * 24 * 60) }).error, 'job_run_at_too_far');
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('snapshot obligatorio exacto, sin campos omitidos o adicionales', () => {
        const job = create();
        for (const expected of [undefined, {}, { ...jobs.snapshot(job), revision: -1 }, { ...jobs.snapshot(job), extra: true }]) {
            assert.equal(edit(job, undefined, { expected }).error, 'job_snapshot_required');
        }
        const expected = jobs.snapshot(job); delete expected.updatedAt;
        assert.equal(edit(job, undefined, { expected }).error, 'job_snapshot_required');
    });
    await test('cambios concurrentes no se sobrescriben y revision no se puede reiniciar', () => {
        const job = create();
        const changed = jobs._store.update(job.id, { title: 'Cambio de otra pestaña', revision: 0 });
        assert.equal(changed.revision, 2);
        assert.equal(edit(job).error, 'job_changed');
        assert.deepStrictEqual(jobs.get(job.id), changed);
        assert.equal(edit(changed).ok, true);
    });
    await test('registro legacy sin revisión se conserva y recibe revisión 1', () => {
        const job = create();
        const all = jobs._store._loadAll(); delete all[0].revision; jobs._store._saveAll(all);
        const legacy = jobs.get(job.id);
        assert.equal(jobs.snapshot(legacy).revision, 0);
        const result = edit(legacy);
        assert.equal(result.ok, true);
        assert.equal(result.job.revision, 1);
        assert.equal(result.job.createdAt, legacy.createdAt);
    });
    await test('no modifica jobs terminales, running, retry_wait, con intentos ni seguimientos', () => {
        for (const status of ['running', 'retry_wait', 'failed', 'completed', 'cancelled']) {
            const job = create();
            const changed = jobs._store.update(job.id, { status });
            assert.equal(edit(changed).error, 'job_not_editable', status);
            assert.deepStrictEqual(jobs.get(job.id), changed);
        }
        const followUp = create({ type: 'follow_up' });
        assert.equal(edit(followUp).error, 'job_not_editable');
        const attempted = jobs._store.update(create().id, { attempts: 1 });
        assert.equal(edit(attempted).error, 'job_not_editable');
    });
    await test('no desvincula ni edita recordatorios de eventos', () => {
        for (const payload of [{ eventLink: { eventId: 'evento' } }, { meta: { eventLink: { eventId: 'evento' } } }]) {
            const job = create({ payload });
            assert.equal(edit(job).error, 'job_not_editable');
            assert.deepStrictEqual(jobs.get(job.id), job);
        }
    });
    await test('fallo de persistencia no deja una edición parcial', () => {
        const job = create();
        const originalWrite = fs.writeFileSync;
        fs.writeFileSync = function (target, ...args) {
            if (String(target).includes('.jobs-')) throw new Error('fallo aislado de escritura');
            return originalWrite.call(fs, target, ...args);
        };
        try { assert.equal(edit(job).error, 'job_persist_failed'); }
        finally { fs.writeFileSync = originalWrite; }
        assert.deepStrictEqual(jobs.get(job.id), job);
    });
    await test('edición y revisión persisten tras recargar el módulo', () => {
        const result = edit(create(), { title: 'Persistido tras reinicio', runAt: future(60) });
        assert.equal(result.ok, true);
        const storePath = require.resolve('../server/jobs/store'); delete require.cache[storePath];
        assert.deepStrictEqual(require(storePath).get(result.job.id), result.job);
    });
    await test('fallo del reemplazo atómico conserva el archivo original y limpia el temporal', () => {
        const job = create();
        const target = userStore.userFile('jobs.json');
        const original = fs.readFileSync(target, 'utf8');
        const originalRename = fs.renameSync;
        fs.renameSync = function (from, to) {
            if (String(from).includes('.jobs-') && to === target) throw new Error('archivo bloqueado simulado');
            return originalRename.call(fs, from, to);
        };
        try { assert.equal(edit(job).error, 'job_persist_failed'); }
        finally { fs.renameSync = originalRename; }
        assert.equal(fs.readFileSync(target, 'utf8'), original);
        assert.deepStrictEqual(jobs.get(job.id), job);
        assert.equal(fs.readdirSync(path.dirname(target)).some(name => name.startsWith('.jobs-')), false);
    });
    await test('scheduler relee la cola después de esperar y no dispara el aviso reprogramado', async () => {
        const first = create({ runAt: future(1) });
        const second = create({ runAt: future(2) });
        const third = create({ runAt: future(3) });
        const clock = new Date(Date.now() + 10 * 60_000);
        let release; let entered;
        const reached = new Promise(resolve => { entered = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        const executed = [];
        const running = jobs.runDue({ _now: clock, _executor: async job => {
            executed.push(job.id);
            if (job.id === first.id) { entered(); await held; }
            return { test: true };
        } });
        await reached;
        assert.equal(edit(jobs.get(first.id)).error, 'job_not_editable');
        const moved = edit(second, { runAt: new Date(clock.getTime() + 60 * 60_000).toISOString() });
        assert.equal(moved.ok, true);
        assert.equal(jobs.cancel(third.id).ok, true);
        release();
        const outcome = await running;
        assert.deepStrictEqual(executed, [first.id]);
        assert.equal(outcome.processed, 1);
        assert.equal(jobs.get(second.id).status, 'scheduled');
        assert.equal(jobs.get(second.id).attempts, 0);
        assert.equal(jobs.get(third.id).status, 'cancelled');
    });
    await test('API aplica edición autorizada y rechaza owner distinto antes de operaciones', async () => {
        const job = create();
        const result = await invokeApi({ id: job.id, ownerId: userA, expected: jobs.snapshot(job), patch: { title: 'Editado vía API' }, confirmed: true });
        assert.equal(result.success, true);
        assert.equal(result.data.job.title, 'Editado vía API');
        for (const op of ['get', 'list', 'cancel', 'update_reminder', 'run_due', 'create']) {
            const refused = await invokeApi({ ownerId: userB, id: job.id }, op);
            assert.equal(refused.error, 'job_owner_mismatch', op);
            assert.equal(refused.status, 400);
        }
        assert.equal((await invokeApi({ id: job.id }, 'get')).success, true);
        assert.equal(jobs.get(job.id).status, 'scheduled');
    });
    console.log(`═══ DURABLE REMINDER EDIT: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => {
    console.error('  ✗', error.stack || error.message);
    process.exitCode = 1;
}).finally(() => {
    userStore.removeUserData(userA);
    userStore.removeUserData(userB);
});
