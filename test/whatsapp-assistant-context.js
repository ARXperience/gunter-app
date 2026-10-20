'use strict';
const assert = require('node:assert/strict');
const { create } = require('../server/whatsapp/query-context');
const NOW = '2026-10-19T15:00:00.000Z';
function harness(overrides = {}) {
    const state = { userId: 'u_alice', kind: 'session', reads: 0, snapshot: {
        version: 2, ownerId: 'u_alice', source: 'browser', syncedAt: NOW, receivedAt: NOW,
        projects: [{ id: 'p1', ownerId: 'u_alice', name: 'Proyecto azafrán',
            meetings: [{ id: 'm1', transcriptionExcerpt: 'Acordamos entregar el diseño el viernes.', timestamp: NOW }],
            documents: [{ id: 'd1', title: 'Factura del diseño', resumen: 'Factura por servicios.', valor: 1200, moneda: 'COP' }],
            analyses: [{ id: 'a1', title: 'Análisis diseño', payloadSummary: 'La entrega requiere revisión.' }],
            decisions: [{ id: 'dc1', text: 'Se aprobó el prototipo.', at: NOW }] }],
        globalTasks: [{ id: 't1', ownerId: 'u_alice', title: 'Comprar café', status: 'done', dueAt: NOW }],
        globalEvents: [{ id: 'e1', ownerId: 'u_alice', title: 'Revisión', status: 'cancelled', startAt: NOW }],
        globalNotes: [{ id: 'n1', title: 'Nota propia', text: 'Investigar la propuesta.' }]
    }, jobs: [{ id: 'j1', type: 'reminder', title: 'Tomar agua', runAt: NOW, status: 'failed', attempts: 3, updatedAt: NOW }],
    commitments: [{ id: 'c1', ownerId: 'u_alice', action: 'Enviar contrato', status: 'pending', dueAt: NOW, updatedAt: NOW }], ...overrides };
    const read = value => { state.reads++; return value; };
    const service = create({ now: () => NOW, context: { currentUserId: () => state.userId, contextKind: () => state.kind },
        knowledge: { getSnapshot: () => read(state.snapshot) }, jobs: { list: () => read(state.jobs) },
        commitments: { list: () => read(state.commitments) }, settings: { list: () => read([{ key: 'voice.continuous', label: 'Voz continua', enabled: true,
            available: true, advanced: { password: 'never-export-secret' }, updatedAt: NOW }]) } });
    return { state, build: query => service.build(query, { userId: 'u_alice', provider: 'local' }), service };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
    await test('explicit authenticated owner is mandatory before reading stores', async () => {
        for (const overrides of [{ userId: 'u_bob' }, { kind: 'owner-fallback' }, { kind: 'local' }]) {
            const h = harness(overrides); await assert.rejects(h.build('mis tareas'), /WA_CONTEXT_OWNER_REQUIRED/); assert.equal(h.state.reads, 0);
        }
        const h = harness(); await assert.rejects(h.service.build('hola', { userId: '_local', provider: 'local' }), /WA_CONTEXT_OWNER_REQUIRED/);
        await assert.rejects(h.service.build('hola', { userId: 'u_alice', provider: 'unknown' }), /WA_CONTEXT_PROVIDER_REQUIRED/);
        assert.equal(h.state.reads, 0);
    });
    await test('safe snapshot includes all available record kinds and explicit status', async () => {
        const result = await harness().build('¿Qué acordamos en el proyecto y cómo están mis tareas?');
        for (const text of ['Comprar café', '"status":"done"', '"status":"cancelled"', 'Acordamos entregar', 'Factura del diseño',
            'Se aprobó el prototipo', 'Nota propia', 'Enviar contrato', '"status":"failed"', 'no está entregado']) assert.ok(result.text.includes(text), text);
        assert.ok(result.sources.some(source => source.id === 'jobs' && source.updatedAt === NOW));
    });
    await test('wrong-account snapshot and individual records are not disclosed', async () => {
        const h = harness(); h.state.snapshot.ownerId = 'u_bob';
        const result = await h.build('mis proyectos'); assert.ok(!result.text.includes('Proyecto azafrán'));
        assert.ok(result.limitations.some(item => item.includes('no acredita')));
        const own = harness(); own.state.snapshot.globalTasks.push({ id: 't2', ownerId: 'u_bob', title: 'Foreign private task' });
        own.state.jobs.push({ id: 'j2', ownerId: 'u_bob', type: 'reminder', title: 'Foreign reminder' });
        assert.ok(!(await own.build('tareas recordatorios')).text.includes('Foreign'));
    });
    await test('legacy snapshots do not provide private details or receive reassigned ownership', async () => {
        const h = harness(); h.state.snapshot.version = 1; delete h.state.snapshot.ownerId;
        const result = await h.build('dime todo'); assert.ok(!result.text.includes('Comprar café')); assert.ok(!result.text.includes('Proyecto azafrán'));
        assert.ok(result.limitations.some(item => item.includes('sincronizar')));
    });
    await test('missing snapshot is explicitly unavailable, not invented empty collections', async () => {
        const result = await harness({ snapshot: null }).build('mis reuniones');
        assert.equal(result.sources.find(source => source.id === 'knowledge').available, false);
        assert.ok(result.limitations.some(item => item.includes('No hay copia verificada')));
    });
    await test('stale browser data has source dates and warning', async () => {
        const h = harness(); h.state.snapshot.syncedAt = '2026-10-18T15:00:00Z';
        const result = await h.build('mi agenda'); assert.equal(result.sources[0].stale, true);
        assert.ok(result.limitations.some(item => item.includes('más de 15 minutos')));
    });
    await test('failed collection coverage is disclosed', async () => {
        const h = harness(); h.state.snapshot.coverage = { documents: { available: false } };
        assert.ok((await h.build('mis documentos')).limitations.some(item => item.includes('documents no estuvo disponible')));
    });
    await test('LOCAL and sensitive local-only personal memory are never exported', async () => {
        const h = harness(); h.state.snapshot.personalMemory = [{ content: 'private personal memory' }];
        h.state.snapshot.globalTasks.push({ id: 'secret', title: 'private local task', privacy: 'SENSITIVE_LOCAL_ONLY' });
        const result = await h.service.build('mis tareas', { userId: 'u_alice', provider: 'cloud' });
        assert.ok(!result.text.includes('private personal memory')); assert.ok(!result.text.includes('private local task'));
        assert.ok(result.limitations.some(item => item.includes('memoria personal LOCAL')));
        assert.ok(!(await h.build('mis recuerdos')).text.includes('private personal memory'));
    });
    await test('payloads, credentials, tokens and arbitrary fields are excluded', async () => {
        const h = harness(); h.state.jobs[0].payload = { token: 'hidden-job-token' };
        h.state.snapshot.globalTasks[0].password = 'hidden-password';
        h.state.snapshot.globalNotes.push({ id: 'n2', title: 'Token', text: 'access_token=hidden-secret-value' });
        h.state.snapshot.projects[0].analyses.push({ id:'a2',payloadSummary:JSON.stringify({api_key:'quoted-json-secret'}) });
        const result = await h.build('mis configuraciones');
        for (const secret of ['hidden-job-token', 'hidden-password', 'hidden-secret-value', 'never-export-secret','quoted-json-secret']) assert.ok(!result.text.includes(secret));
        assert.ok(result.text.includes('Voz continua'));
    });
    await test('any local privacy marker overrides a conflicting public marker for cloud context',async()=>{
        const h=harness();
        h.state.snapshot.globalTasks.push({id:'c1',privacy:'PUBLIC',sensitivity:'SENSITIVE_LOCAL_ONLY',title:'conflicting sensitivity secret'},
            {id:'c2',privacy:'PUBLIC',meta:{privacy:'NEVER_CLOUD'},title:'conflicting metadata secret'});
        const result=await h.service.build('mis tareas',{userId:'u_alice',provider:'cloud'});
        assert.ok(!result.text.includes('conflicting sensitivity secret'));assert.ok(!result.text.includes('conflicting metadata secret'));
    });
    await test('server read failures remain unavailable and do not erase other sources', async () => {
        const service = create({ now: () => NOW, context: { currentUserId: () => 'u_alice', contextKind: () => 'session' },
            knowledge: { getSnapshot: () => null }, jobs: { list: () => { throw new Error('unavailable'); } },
            commitments: { list: () => [{ id: 'c1', action: 'Entrega comprobada', status: 'pending' }] } });
        const result = await service.build('compromisos', { userId: 'u_alice', provider: 'local' });
        assert.equal(result.sources.find(source => source.id === 'jobs').available, false); assert.ok(result.text.includes('Entrega comprobada'));
    });
    await test('owner switch after asynchronous read aborts before returning context', async () => {
        let uid = 'u_alice';
        const service = create({ context: { currentUserId: () => uid, contextKind: () => 'session' },
            knowledge: { getSnapshot: async () => { uid = 'u_bob'; return null; } } });
        await assert.rejects(service.build('dime todo', { userId: 'u_alice', provider: 'local' }), /WA_CONTEXT_OWNER_REQUIRED/);
    });
    await test('query relevance wins bounded local/cloud context budgets', async () => {
        const h = harness(); h.state.snapshot.globalTasks = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, title: `Elemento ${i}`, description: 'x'.repeat(450) }));
        h.state.snapshot.globalTasks[199].title = 'Proyecto quetzal especial';
        for (const provider of ['local', 'cloud']) {
            const result = await h.service.build('quetzal', { userId: 'u_alice', provider });
            assert.ok(result.text.length <= (provider === 'local' ? 6000 : 12000)); assert.ok(result.text.includes('quetzal'));
            assert.ok(result.limitations.some(item => item.includes('recortado')));
        }
    });
    await test('no delivery, acknowledgement or execution success inferred for scheduled/running jobs', async () => {
        const h = harness({ jobs: ['scheduled', 'running', 'completed', 'cancelled', 'retry_wait'].map((status, i) => ({ id: `j${i}`, title: status, type: 'reminder', status })) });
        const result = await h.build('mis recordatorios');
        for (const phrase of ['no acredita lectura humana', 'no acredita entrega', 'cancelado; no se ejecutará']) assert.ok(result.text.includes(phrase));
    });
    await test('notes legacy user aliases are never read', async () => {
        const h = harness(); delete h.state.snapshot.globalNotes; h.state.snapshot.users = { default: { notes: [{ text: 'Legacy alias private note' }] } };
        const result = await h.build('mis notas'); assert.ok(!result.text.includes('Legacy alias private note'));
        assert.ok(result.limitations.some(item => item.includes('legacy no se atribuyen')));
    });
    console.log(`${passed} comprobaciones de contexto WhatsApp aprobadas.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
