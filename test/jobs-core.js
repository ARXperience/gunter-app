/* Pruebas aisladas de persistencia, recuperación y reintentos de procesos durables. */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const userContext = require(path.join(root, 'server', 'user-context.js'));
const userStore = require(path.join(root, 'server', 'user-store.js'));
const jobs = require(path.join(root, 'server', 'jobs', 'index.js'));
const push = require(path.join(root, 'server', 'push', 'index.js'));

const testUserId = `_test_jobs_${process.pid}_${Date.now()}`;
let passed = 0;

async function test(name, fn) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

(async () => {
    console.log('GUNTER DURABLE JOBS CORE');
    await userContext.runAs(testUserId, async () => {
        jobs.clear();

        await test('persiste un job y lo recupera tras recargar el store', async () => {
            const created = jobs.create({
                type: 'reminder', title: 'prueba de reinicio',
                runAt: new Date(Date.now() + 60_000).toISOString()
            });
            assert.equal(created.ok, true);
            const storePath = require.resolve(path.join(root, 'server', 'jobs', 'store.js'));
            delete require.cache[storePath];
            const reloadedStore = require(storePath);
            assert.equal(reloadedStore.get(created.job.id)?.title, 'prueba de reinicio');
        });

        await test('un fallo temporal entra en espera y luego agota sus reintentos', async () => {
            const created = jobs.create({
                type: 'follow_up', title: 'probar reintentos', maxAttempts: 2,
                runAt: new Date().toISOString()
            });
            const firstClock = new Date(Date.now() + 100);
            const first = await jobs.runDue({
                _now: firstClock, _retryBaseMs: 10,
                _executor: async job => {
                    if (job.id === created.job.id) throw new Error('fallo temporal simulado');
                    return { testEvidence: true };
                }
            });
            const firstOutcome = first.outcomes.find(item => item.id === created.job.id);
            assert.equal(firstOutcome?.status, 'retry_wait');
            const waiting = jobs.get(created.job.id);
            assert.equal(waiting.attempts, 1);
            assert.match(waiting.lastError, /fallo temporal/);

            const second = await jobs.runDue({
                _now: new Date(new Date(waiting.nextAttemptAt).getTime() + 1), _retryBaseMs: 10,
                _executor: async job => {
                    if (job.id === created.job.id) throw new Error('segundo fallo simulado');
                    return { testEvidence: true };
                }
            });
            const secondOutcome = second.outcomes.find(item => item.id === created.job.id);
            assert.equal(secondOutcome?.status, 'failed');
            assert.equal(jobs.get(created.job.id).attempts, 2);
        });

        await test('un job fallido puede reintentarse manualmente y guarda evidencia', async () => {
            const failed = jobs.list({ status: 'failed' }).find(item => item.title === 'probar reintentos');
            const retried = jobs.retry(failed.id);
            assert.equal(retried.ok, true);
            const execution = await jobs.runDue({
                _now: new Date(Date.now() + 100),
                _executor: async job => ({ testEvidence: `evidence:${job.id}` })
            });
            assert.equal(execution.outcomes.find(item => item.id === failed.id)?.status, 'completed');
            const completed = jobs.get(failed.id);
            assert.equal(completed.status, 'completed');
            assert.equal(completed.result.testEvidence, `evidence:${failed.id}`);
            assert.ok(completed.completedAt);
        });

        await test('recupera un proceso abandonado en running después de reiniciar', async () => {
            const created = jobs.create({
                type: 'reminder', title: 'recuperación tras caída',
                runAt: new Date(Date.now() - 1_000).toISOString()
            });
            const all = jobs._store._loadAll();
            const abandoned = all.find(item => item.id === created.job.id);
            abandoned.status = 'running';
            abandoned.startedAt = new Date(Date.now() - 90_000).toISOString();
            abandoned.updatedAt = new Date(Date.now() - 90_000).toISOString();
            jobs._store._saveAll(all);
            await jobs.runDue({
                _now: new Date(),
                _executor: async job => ({ recovered: job.id })
            });
            const recovered = jobs.get(created.job.id);
            assert.equal(recovered.status, 'completed');
            assert.equal(recovered.result.recovered, created.job.id);
        });

        await test('Web Push guarda dispositivos por usuario y elimina suscripciones vencidas', async () => {
            const subscription = { endpoint: 'https://push.example.test/subscription-1', keys: { p256dh: 'public-test-key', auth: 'auth-test-key' } };
            const saved = push.subscribe({ subscription, deviceLabel: 'PC de prueba' });
            assert.equal(saved.ok, true);
            assert.equal(push.status().devices.length, 1);
            const delivered = await push.deliver({ title: 'Prueba', body: 'Recordatorio' }, { _sender: async () => ({ statusCode: 201 }) });
            assert.equal(delivered.delivered, 1);
            const expired = await push.deliver({ title: 'Prueba', body: 'Recordatorio' }, { _sender: async () => { const error = new Error('expired'); error.statusCode = 410; throw error; } });
            assert.equal(expired.outcomes[0].expired, true);
            assert.equal(push.status().devices.length, 0);
        });
    });

    console.log(`═══ DURABLE JOBS: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => {
    console.error('  ✗', error.stack || error.message);
    process.exitCode = 1;
}).finally(() => {
    userStore.removeUserData(testUserId);
});
