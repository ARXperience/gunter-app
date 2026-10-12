const assert = require('node:assert/strict');
const assistant = require('../js/core/assistant-tools');
const skills = require('../server/control-plane/skills');

let checks = 0;
async function check(name, run) { await run(); checks++; }
const snapshotKeys = ['id', 'ownerId', 'owner', 'beneficiary', 'action', 'context', 'dueAt', 'projectId',
    'source', 'channel', 'status', 'createdAt', 'updatedAt', 'revision'];
function snapshot(row) { return Object.fromEntries(snapshotKeys.map(key => [key, row[key] ?? (key === 'revision' ? 0 : null)])); }
function fixture(extra = {}) {
    const state = { ownerId: 'alice', trusted: true, enabled: true, writes: 0, rows: [
        { id: 'cmt_a', ownerId: 'alice', owner: 'Ana', action: 'Enviar propuesta', status: 'pending',
            source: { excerpt: 'Prometí enviar propuesta', sourceRefId: 'meeting_1' }, revision: 0 },
        { id: 'cmt_b', ownerId: 'bob', action: 'Privado de Bob', status: 'pending', secret: 'do-not-output' },
        { id: 'cmt_legacy', action: 'Sin propietario', status: 'pending' }
    ], tasks: [] };
    const service = {
        flagOn: () => state.enabled,
        snapshot,
        list: async () => state.rows.map(row => ({ ...row })),
        get: async id => state.rows.find(row => row.id === id) || null,
        createTask: async (id, options) => {
            assert.equal(options.confirmed, true);
            assert.equal(options.ownerId, state.ownerId);
            assert.deepEqual(options.expected, snapshot(state.rows.find(row => row.id === id)));
            const existing = state.tasks.find(task => task.ownerId === options.ownerId && task.meta.commitmentId === id);
            if (existing) return { task: existing, created: false };
            state.writes++;
            const row = state.rows.find(row => row.id === id);
            const task = { id: `task_${state.writes}`, title: row.action.trim().slice(0, 180), ownerId: options.ownerId,
                status: 'pending', dueAt: row.dueAt || null, meta: { commitmentId: id }, credential: 'private' };
            state.tasks.push(task);
            return { task, created: true };
        }
    };
    const tasksService = { list: async () => state.tasks.map(row => ({ ...row })) };
    const root = { GunterAuth: { canAccessLocalData: () => state.trusted, getUser: () => ({ id: state.ownerId }) },
        localStorage: { getItem: () => state.ownerId } };
    const tools = assistant.create({ root, commitmentsService: service, tasksService, ...extra });
    return { state, service, tasksService, root, tools };
}
const request = 'convierte el compromiso "cmt_a" en tarea';

(async () => {
    await check('canonical read and L3 write policy', () => {
        assert.equal(skills.get('commitments.list').risk, 'read');
        const entry = skills.get('commitments.task');
        assert.equal(entry.entitlement, 'gunter.tasks');
        assert.equal(entry.autonomyMax, 'L3');
        assert.equal(entry.risk, 'external_write');
        assert.deepEqual(entry.permissions, ['tasks.write']);
        assert.equal(skills.verify('commitments.task', { evidence: { persistedId: 't' } }).verified, false);
        assert.equal(skills.verify('commitments.task', { evidence: { persistedId: 't', commitmentId: 'c', reconsulted: true } }).verified, true);
    });
    await check('natural command routes and explanations stay inert', () => {
        const { tools } = fixture();
        for (const text of ['mis compromisos', 'muestra mis compromisos', 'lista compromisos', 'consulta los compromisos'])
            assert.equal(tools.detect(text)?.toolId, 'commitments.list');
        for (const text of [request, 'crea una tarea del compromiso Enviar propuesta', 'Gunter, convierte el compromiso "abre configuración" en tarea'])
            assert.equal(tools.detect(text)?.toolId, 'commitments.task');
        for (const text of ['¿Cómo convierto un compromiso en tarea?', '¿Qué es un compromiso?', '¿Cómo puedo crear una tarea del compromiso Enviar propuesta?'])
            assert.equal(tools.detect(text), null);
    });
    await check('list filters account and legacy; no private metadata', async () => {
        const { tools } = fixture();
        const result = await tools.dispatch('mis compromisos', { inputSource: 'voice' });
        assert.equal(result.status, 'complete');
        assert.deepEqual(result.result.items.map(row => row.id), ['cmt_a']);
        assert.equal(JSON.stringify(result).includes('sourceRefId'), false);
        assert.equal(JSON.stringify(result).includes('Privado de Bob'), false);
    });
    await check('confirm then scoped stored task; public output only', async () => {
        const { tools, state } = fixture();
        const proposal = await tools.dispatch(request, { viewRequestId: 'view_1' });
        assert.equal(proposal.status, 'awaiting_confirmation');
        assert.equal(state.writes, 0);
        assert.equal(tools.getPending().args.viewRequestId, 'view_1');
        const result = await tools.dispatch('confirmo');
        assert.equal(result.status, 'complete');
        assert.equal(result.verified, true);
        assert.equal(state.writes, 1);
        assert.equal(result.result.task.meta.commitmentId, 'cmt_a');
        assert.equal(JSON.stringify(result).includes('credential'), false);
        assert.equal(state.rows[0].status, 'pending');
        assert.match(result.reply, /no demuestra su cumplimiento/i);
    });
    await check('refusal is non-mutating', async () => {
        const { tools, state } = fixture();
        await tools.dispatch(request);
        assert.equal((await tools.dispatch('no')).status, 'cancelled');
        assert.equal(state.writes, 0);
    });
    await check('voice affirmative cannot authorize mutation', async () => {
        const { tools, state } = fixture();
        assert.equal((await tools.dispatch(request, { inputSource: 'voice' })).status, 'awaiting_confirmation');
        assert.equal((await tools.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
        assert.equal(state.writes, 0);
        assert.equal((await tools.dispatch('sí')).status, 'complete');
    });
    await check('repeat returns existing linked task without duplication', async () => {
        const { tools, state } = fixture();
        await tools.dispatch(request); await tools.dispatch('sí');
        await tools.dispatch(request);
        const result = await tools.dispatch('sí');
        assert.equal(result.status, 'complete');
        assert.equal(result.result.created, false);
        assert.equal(state.writes, 1);
        assert.match(result.reply, /sin duplicarla/i);
    });
    await check('ambiguous action never guessed', async () => {
        const { tools, state } = fixture();
        state.rows.push({ ...state.rows[0], id: 'cmt_c' });
        assert.equal((await tools.dispatch('crea una tarea del compromiso Enviar propuesta')).status, 'needs_input');
        assert.equal(state.writes, 0);
        assert.equal(tools.getPending(), null);
    });
    await check('partial action is not fuzzy matched', async () => {
        const { tools, state } = fixture();
        assert.equal((await tools.dispatch('convierte el compromiso propuesta en tarea')).status, 'needs_input');
        assert.equal(state.writes, 0);
    });
    for (const status of ['fulfilled', 'cancelled']) await check(`closed ${status} rejected`, async () => {
        const { tools, state } = fixture(); state.rows[0].status = status;
        assert.equal((await tools.dispatch(request)).status, 'needs_input');
        assert.equal(state.writes, 0);
    });
    await check('cross-account id not accessible', async () => {
        const { tools, state } = fixture();
        assert.equal((await tools.dispatch('convierte el compromiso cmt_b en tarea')).status, 'needs_input');
        assert.equal(state.writes, 0);
    });
    await check('untrusted session rejected', async () => {
        const { tools, state } = fixture(); state.trusted = false;
        assert.equal((await tools.dispatch(request)).status, 'needs_input');
        assert.equal((await tools.dispatch('mis compromisos')).status, 'needs_input');
    });
    await check('changed account invalidates pending', async () => {
        const { tools, state } = fixture(); await tools.dispatch(request); state.ownerId = 'bob';
        assert.notEqual((await tools.dispatch('sí')).status, 'complete');
        assert.equal(state.writes, 0);
        assert.equal(tools.getPending(), null);
    });
    await check('changed commitment refuses stale confirmation', async () => {
        const { tools, state } = fixture(); await tools.dispatch(request); state.rows[0].context = 'Nuevo';
        assert.equal((await tools.dispatch('sí')).status, 'error');
        assert.equal(state.writes, 0);
    });
    await check('source key ordering does not invalidate identical snapshot', async () => {
        const { tools, state } = fixture(); await tools.dispatch(request);
        state.rows[0].source = { sourceRefId: 'meeting_1', excerpt: 'Prometí enviar propuesta' };
        assert.equal((await tools.dispatch('sí')).status, 'complete');
    });
    await check('disabled preference respected before and after proposal', async () => {
        const { tools, state } = fixture(); state.enabled = false;
        assert.equal((await tools.dispatch('mis compromisos')).status, 'needs_input');
        assert.equal((await tools.dispatch(request)).status, 'needs_input');
        state.enabled = true; await tools.dispatch(request); state.enabled = false;
        assert.notEqual((await tools.dispatch('sí')).status, 'complete');
        assert.equal(state.writes, 0);
    });
    await check('missing protected service fails closed', async () => {
        const { tools } = fixture({ commitmentsService: {} });
        assert.equal((await tools.dispatch(request)).status, 'needs_input');
        assert.equal((await tools.dispatch('mis compromisos')).status, 'needs_input');
    });
    await check('missing tasks reconsult blocks preparation', async () => {
        const { tools } = fixture({ tasksService: {} });
        assert.equal((await tools.dispatch(request)).status, 'needs_input');
    });
    await check('source is reconsulted immediately before creation', async () => {
        const { tools, service, state } = fixture(); await tools.dispatch(request);
        const originalGet = service.get; service.get = async id => { state.ownerId = 'bob'; return originalGet(id); };
        assert.equal((await tools.dispatch('sí')).status, 'error');
        assert.equal(state.writes, 0);
    });
    await check('false persistence never reported as success', async () => {
        const { tools, service } = fixture();
        service.createTask = async () => ({ created: true, task: { id: 'task_missing', title: 'Enviar propuesta',
            ownerId: 'alice', status: 'pending', dueAt: null, meta: { commitmentId: 'cmt_a' } } });
        await tools.dispatch(request);
        const result = await tools.dispatch('sí');
        assert.equal(result.status, 'error');
        assert.equal(result.verified, false);
        assert.match(result.reply, /podría haberse guardado/i);
    });
    await check('mismatched linked task is not verified', async () => {
        const { tools, service } = fixture();
        service.createTask = async () => ({ created: false, task: { id: 'task_foreign', title: 'Privado',
            ownerId: 'bob', status: 'pending', dueAt: null, meta: { commitmentId: 'cmt_a' } } });
        await tools.dispatch(request); assert.equal((await tools.dispatch('sí')).status, 'error');
    });
    await check('backend errors do not leak source or credentials', async () => {
        const { tools, service } = fixture();
        service.createTask = async () => { throw new Error('secret-token private-source'); };
        await tools.dispatch(request); const result = await tools.dispatch('sí');
        assert.equal(result.status, 'error');
        assert.equal(result.reply.includes('secret-token'), false);
    });
    await check('local Permission Gate denies canonical blocked write', async () => {
        const { tools, root, state } = fixture();
        root.GunterControlPlane = { planTask: async () => { const error = new Error('blocked'); error.code = 'entitlement_required'; throw error; } };
        await tools.dispatch(request); assert.equal((await tools.dispatch('sí')).status, 'error');
        assert.equal(state.writes, 0);
    });
    await check('navigation reuses the existing commitments section', async () => {
        const { tools, root } = fixture();
        let target;
        root.location = { assign: url => { target = url; } };
        assert.equal((await tools.dispatch('abre el apartado de compromisos')).status, 'complete');
        assert.equal(target, 'day.html#commitments');
    });
    console.log(`commitment-tools: PASS (${checks} focused checks)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
