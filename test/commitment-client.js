'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/services/commitments-service.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const row = { id: 'cmt_a', ownerId: 'alice', owner: 'María', beneficiary: 'Cliente', action: 'Enviar propuesta',
    context: 'Enviaré la propuesta acordada.', dueAt: '2026-11-01T15:00:00.000Z', projectId: 'project_1',
    source: { type: 'meeting', refId: 'meeting_1', ts: '2026-10-12T12:00:00.000Z' }, channel: 'meeting',
    status: 'pending', createdAt: '2026-10-12T12:00:00.000Z', updatedAt: '2026-10-12T12:00:00.000Z', revision: 1 };
function fixture() {
    const f = { owner: 'alice', trusted: true, enabled: true, record: clone(row), requests: [], events: [], tasks: [], writes: 0 };
    const window = {
        PremiumFeaturesService: { isEnabled: () => f.enabled },
        GunterAuth: { canAccessLocalData: () => f.trusted, getUser: () => ({ id: f.owner }) },
        localStorage: { getItem: () => f.deviceOwner || null },
        dispatchEvent: event => f.events.push(event),
        GunterTasksService: {
            createFromCommitment: async (data, guard) => {
                await f.beforeWrite?.();
                const existing = f.tasks.find(task => task.ownerId === guard.ownerId && task.meta.commitmentId === data.meta.commitmentId);
                if (existing) return { task: clone(existing), created: false };
                f.writes++;
                const task = { ...clone(data), id: 'task_new', ownerId: guard.ownerId, source: 'commitment', status: 'pending' };
                if (!f.skipPersistence) f.tasks.push(task);
                return { task, created: true };
            },
            list: async () => { await f.beforeList?.(); return clone(f.tasks); }
        }
    };
    f.handle = async ({ op, params }) => {
        if (op === 'get') return { item: clone(f.record) };
        if (op === 'list') return { items: f.record ? [clone(f.record)] : [] };
        if (op === 'stats') return { total: 1, byStatus: { pending: 1 } };
        if (op === 'ingest') return { detected: 1, created: [clone(f.record)] };
        if (op === 'add_manual') return clone(f.record);
        if (op === 'remove') { f.record = null; return { ok: true, id: params.id }; }
        if (op.startsWith('mark_')) {
            f.record.status = op === 'mark_fulfilled' ? 'fulfilled' : 'cancelled';
            f.record.revision++;
            return { ok: true, item: clone(f.record) };
        }
        throw Error('unexpected op');
    };
    vm.runInNewContext(source, { window, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        fetch: async (url, options) => {
            const request = { url, ...JSON.parse(options.body) }; f.requests.push(request);
            const result = await f.handle(request);
            return { ok: !f.httpError, json: async () => { await f.beforeJson?.(); return f.httpError
                ? { success: false, code: f.httpError } : { success: true, data: result }; } };
        }
    });
    f.service = window.GunterCommitmentsService;
    f.guard = () => ({ ownerId: f.owner, expected: f.service.snapshot(f.record), confirmed: true });
    return f;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
(async () => {
    await test('account-scoped requests + provenance and verified local task', async () => {
        const f = fixture();
        const result = await f.service.createTask('cmt_a', f.guard());
        assert.equal(result.created, true); assert.equal(f.requests[0].params.ownerId, 'alice');
        assert.equal(result.task.title, row.action); assert.equal(result.task.dueAt, row.dueAt);
        assert.match(result.task.notes, /María/); assert.equal(result.task.meta.sourceRefId, 'meeting_1');
        assert.equal(f.record.status, 'pending');
        const again = await f.service.createTask('cmt_a', f.guard());
        assert.equal(again.created, false); assert.equal(f.writes, 1);
    });
    await test('confirmation and active feature required before requests', async () => {
        const f = fixture();
        await assert.rejects(f.service.createTask('cmt_a', { ...f.guard(), confirmed: false }), /Confirma/);
        f.enabled = false;
        await assert.rejects(f.service.createTask('cmt_a', f.guard()), /Activa/);
        assert.equal(f.requests.length, 0); assert.equal(f.writes, 0);
    });
    await test('untrusted account and mismatched device cannot read', async () => {
        const f = fixture(); f.trusted = false;
        await assert.rejects(f.service.list(), /sesión/);
        f.trusted = true; f.deviceOwner = 'bob';
        await assert.rejects(f.service.get('cmt_a'), /sesión/); assert.equal(f.requests.length, 0);
    });
    await test('foreign returned rows never exposed', async () => {
        const f = fixture(); f.record.ownerId = 'bob';
        await assert.rejects(f.service.list(), /cuenta cambió/);
        await assert.rejects(f.service.get('cmt_a'), /cuenta cambió/);
    });
    await test('account changes while response json resolves', async () => {
        const f = fixture(); f.beforeJson = () => { f.owner = 'bob'; };
        await assert.rejects(f.service.createTask('cmt_a', f.guard()), /cuenta cambió/);
        assert.equal(f.writes, 0);
    });
    await test('changed commitment or missing snapshot refuses writes', async () => {
        const f = fixture(), guard = f.guard(); f.record.action = 'Otra acción';
        await assert.rejects(f.service.createTask('cmt_a', guard), /compromiso cambió/);
        const incomplete = f.guard(); delete incomplete.expected.context;
        await assert.rejects(f.service.createTask('cmt_a', incomplete), /compromiso cambió/);
        assert.equal(f.writes, 0);
    });
    await test('same source structural order is valid', async () => {
        const f = fixture(), guard = f.guard();
        guard.expected.source = { ts: row.source.ts, refId: row.source.refId, type: row.source.type };
        assert.equal((await f.service.createTask('cmt_a', guard)).created, true);
    });
    await test('closed, malformed date and excessively long commitments refuse tasks', async () => {
        for (const patch of [{ status: 'fulfilled' }, { status: 'cancelled' }, { action: 'x'.repeat(181) }, { dueAt: 'not-date' }]) {
            const f = fixture(); Object.assign(f.record, patch);
            await assert.rejects(f.service.createTask('cmt_a', f.guard())); assert.equal(f.writes, 0);
        }
    });
    await test('missing task persistence never reported success', async () => {
        const f = fixture(); f.skipPersistence = true;
        await assert.rejects(f.service.createTask('cmt_a', f.guard()), /No pude/);
    });
    await test('manual fulfilled/cancelled changes confirm and reconsult stored revision', async () => {
        for (const method of ['markFulfilled', 'markCancelled']) {
            const f = fixture();
            await assert.rejects(f.service[method]('cmt_a', 'manual', { ...f.guard(), confirmed: false }));
            const result = await f.service[method]('cmt_a', 'manual', f.guard());
            assert.equal(result.revision, 2); assert.equal(f.requests.at(-1).op, 'get'); assert.equal(f.events.length, 1);
        }
    });
    await test('false success or altered content not reported as verified status', async () => {
        const f = fixture(), old = f.handle;
        f.handle = async request => { const result = await old(request); if (request.op === 'mark_fulfilled') f.record.action = 'Alterada'; return result; };
        await assert.rejects(f.service.markFulfilled('cmt_a', 'manual', f.guard()), /No pude/);
        assert.equal(f.events.length, 0);
    });
    await test('remove reconsults absence; linked task untouched', async () => {
        const f = fixture(); await f.service.createTask('cmt_a', f.guard());
        await f.service.remove('cmt_a', f.guard());
        assert.equal(f.record, null); assert.equal(f.tasks.length, 1); assert.equal(f.requests.at(-1).op, 'get');
    });
    await test('LOCAL_ONLY detection failure is truthful, not zero false detection', async () => {
        const f = fixture(); f.httpError = 'LOCAL_ONLY_MODE';
        await assert.rejects(f.service.ingestText({ text: 'Prometí enviar esta propuesta mañana.' }), /No envié tu texto/);
        assert.equal(f.events.length, 0);
    });
    await test('reconcile cannot mark commitments or call any provider', async () => {
        const f = fixture(); const result = await f.service.reconcile({ title: row.action });
        assert.equal(result.updated, 0); assert.equal(result.reviewRequired, true); assert.equal(f.requests.length, 0);
    });
    console.log(`COMMITMENT CLIENT: ${passed} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
