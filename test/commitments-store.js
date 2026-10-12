'use strict';
/* Focused isolated checks; never read or modify application accounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-commitments-'));
process.env.GUNTER_DATA_DIR = directory;
process.env.GUNTER_WHATSAPP_DATA_DIR = path.join(directory, 'whatsapp');
const userContext = require('../server/user-context');
const store = require('../server/commitments/store');
const commitments = require('../server/commitments');
const settings = require('../server/control-plane/settings');
const openai = require('../server/openai-client');
const extractor = commitments._extractor;
const userA = 'commitment-user-a', userB = 'commitment-user-b';
let passed = 0, serial = 0;
const file = uid => path.join(directory, 'users', uid, 'commitments.json');
const clone = value => JSON.parse(JSON.stringify(value));
const make = overrides => store.add({ action: `Enviar propuesta ${++serial}`, owner: 'Ana', beneficiary: 'Cliente',
    dueAt: '2099-10-12T14:00:00.000Z', context: 'Ana enviará la propuesta',
    source: { type: 'meeting', refId: 'meeting-one', ts: '2026-10-12T13:00:00.000Z' }, projectId: 'project-one', ...overrides });
const guard = (item, overrides = {}) => ({ id: item.id, ownerId: userA, expected: store.snapshot(item), confirmed: true, ...overrides });
async function test(name, run) {
    await userContext.runAs(userA, run); passed++; console.log(`  ✓ ${name}`);
}
function invokeApi(op, params, raw) {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf("    if (parsedUrl.pathname === '/api/commitments'");
    const end = source.indexOf('\n    // ============================================', start);
    const req = new EventEmitter(); req.method = 'POST';
    return new Promise((resolve, reject) => {
        const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, ...JSON.parse(body) }); } };
        Promise.resolve(vm.runInNewContext(`(async function () { ${source.slice(start, end)} })()`, {
            parsedUrl: { pathname: '/api/commitments' }, req, res, commitments, userContext, JSON, Buffer
        })).then(() => { req.emit('data', raw || JSON.stringify({ op, params })); req.emit('end'); }).catch(reject);
    });
}
(async () => {
    console.log('GUNTER COMMITMENT FOLLOW-UP STORE');
    await test('global legacy queda intacto incluso para el dueño; cuenta nueva no lo hereda', () => {
        const global = path.join(directory, 'commitments.json');
        fs.writeFileSync(global, JSON.stringify([{ id: 'legacy-global', action: 'Privado', owner: 'unknown' }]));
        const originalOwner = userContext.ownerId; userContext.ownerId = () => userA;
        try { assert.deepEqual(store.list(), []); assert.equal(fs.existsSync(file(userA)), false); assert.ok(fs.existsSync(global)); }
        finally { userContext.ownerId = originalOwner; }
    });
    await test('creación asigna sesión y rechaza ownerId ajeno; no acepta estado o id inyectado', () => {
        assert.throws(() => make({ ownerId: userB }), /commitment_owner_mismatch/);
        const item = make({ id: 'other-id', status: 'fulfilled', revision: 42, createdAt: '2000-01-01' });
        assert.equal(item.ownerId, userA); assert.equal(item.status, 'pending'); assert.equal(item.revision, 1);
        assert.notEqual(item.id, 'other-id'); assert.notEqual(item.createdAt, '2000-01-01'); assert.deepEqual(store.get(item.id), item);
    });
    await test('cuentas aisladas y filas explícitamente extranjeras no se muestran ni modifican', () => {
        const item = make();
        userContext.runAs(userB, () => { assert.equal(store.get(item.id), null); assert.deepEqual(store.list(), []); assert.equal(store.stats().total, 0); });
        const foreign = { ...item, id: 'foreign-row', ownerId: userB };
        fs.writeFileSync(file(userA), JSON.stringify([...store._loadAll(), foreign]));
        assert.equal(store.get(foreign.id), null);
        const result = store.markFulfilled(guard(item, { id: foreign.id, expected: { ...store.snapshot(item), id: foreign.id } }));
        assert.equal(result.error, 'commitment_not_found');
        store.markFulfilled(guard(item));
        assert.deepEqual(store._loadAll().find(row => row.id === foreign.id), foreign);
    });
    await test('legacy en carpeta propia se lee con owner proyectado y revisión 0 sin reasignación de disco', () => {
        const legacy = { id: 'legacy-scoped', action: 'Entregar informe', owner: 'Ana', status: 'pending',
            context: 'Promesa original', dueAt: null, source: { type: 'meeting', refId: 'known' }, createdAt: '2026-10-10' };
        fs.writeFileSync(file(userA), JSON.stringify([...store._loadAll(), legacy]));
        const item = store.get(legacy.id); assert.equal(item.ownerId, userA); assert.equal(item.revision, 0);
        assert.equal(item.updatedAt, null); assert.equal(store._loadAll().find(row => row.id === legacy.id).ownerId, undefined);
        const result = store.markCancelled(guard(item)); assert.equal(result.ok, true); assert.equal(result.item.revision, 1);
    });
    await test('origen no publica objetos/tokens y creación limita campos compatibles con tareas', () => {
        const item = make({ owner: 'x'.repeat(200), beneficiary: 'y'.repeat(200), projectId: 'p'.repeat(200),
            source: { type: 'meeting', refId: 'r'.repeat(200), ts: { token: 'secret' } } });
        assert.equal(item.owner.length, 120); assert.equal(item.beneficiary.length, 120); assert.equal(item.projectId.length, 160);
        assert.equal(item.source.refId.length, 160); assert.equal(item.source.ts, null);
        assert.throws(() => make({ action: 'x'.repeat(181) }), /commitment_action_invalid/);
    });
    await test('vencimiento es derivado: lecturas no escriben ni alteran revisiones', () => {
        const item = make({ dueAt: '2020-01-01T00:00:00.000Z' });
        const before = fs.readFileSync(file(userA), 'utf8');
        assert.equal(item.status, 'overdue'); assert.equal(store.get(item.id).status, 'overdue');
        assert.ok(store.list({ status: 'overdue' }).some(row => row.id === item.id));
        store.stats(); assert.equal(fs.readFileSync(file(userA), 'utf8'), before);
        assert.equal(store.markFulfilled(guard(item)).ok, true);
    });
    await test('confirmación explícita, cuenta y snapshot completos son obligatorios', () => {
        const item = make();
        assert.equal(store.markFulfilled(guard(item, { confirmed: false })).error, 'commitment_confirmation_required');
        assert.equal(store.markCancelled(guard(item, { ownerId: userB })).error, 'commitment_owner_mismatch');
        assert.equal(store.remove(guard(item, { expected: { id: item.id } })).error, 'commitment_snapshot_invalid');
        assert.equal(commitments.markFulfilled(item.id, 'legacy-auto').ok, false);
        assert.equal(commitments.clear().ok, false); assert.equal(store.get(item.id).status, 'pending');
    });
    await test('snapshot detecta cambios de contenido, responsable, origen, plazo, proyecto y revisión', () => {
        for (const [key, value] of Object.entries({ action: 'Distinto', owner: 'Otro', beneficiary: 'Otra',
            context: 'Revisado', dueAt: '2098-01-01', projectId: 'another', channel: 'chat',
            source: { type: 'chat', refId: 'different', ts: 123 }, revision: 2, updatedAt: 'different' })) {
            const item = make(); const expected = guard(item);
            fs.writeFileSync(file(userA), JSON.stringify(store._loadAll().map(row => row.id === item.id ? { ...row, [key]: value } : row)));
            assert.equal(store.markFulfilled(expected).error, 'commitment_changed', key);
            assert.equal(store.get(item.id).status, 'pending');
        }
    });
    await test('cumplir y cancelar conservan evidencia original y avanzan revisión; no cambian terminales', () => {
        for (const operation of ['markFulfilled', 'markCancelled']) {
            const item = make(); const result = store[operation](guard(item, { note: 'Entregado', reason: 'Ya no aplica' }));
            assert.equal(result.ok, true); assert.equal(result.item.revision, item.revision + 1);
            for (const key of ['id', 'action', 'owner', 'beneficiary', 'source', 'projectId', 'dueAt', 'context', 'createdAt']) {
                assert.deepEqual(result.item[key], item[key], key);
            }
            assert.ok(result.item[operation === 'markFulfilled' ? 'fulfilledAt' : 'cancelledAt']);
            assert.equal(store.markFulfilled(guard(result.item)).error, 'commitment_not_pending');
            assert.equal(store.markCancelled(guard(item)).error, 'commitment_changed');
        }
    });
    await test('eliminación confirmada elimina solo el id vigente y rechaza repetición/stale', () => {
        const item = make(); const other = make();
        assert.equal(store.remove(guard(item)).ok, true); assert.equal(store.get(item.id), null); assert.ok(store.get(other.id));
        assert.equal(store.remove(guard(item)).error, 'commitment_not_found');
    });
    await test('dedupe incluye plazo/proyecto/responsable y devuelve registro persistido', () => {
        const item = make({ action: 'Una propuesta', context: 'Original' });
        const duplicate = make({ action: 'Una propuesta', context: 'Otro contexto' });
        assert.equal(duplicate.id, item.id); assert.equal(duplicate.context, 'Original');
        assert.notEqual(make({ action: 'Una propuesta', dueAt: '2099-11-01' }).id, item.id);
        assert.notEqual(make({ action: 'Una propuesta', projectId: 'different' }).id, item.id);
    });
    await test('validación completa de batch evita importaciones parciales y fechas inválidas', () => {
        const before = fs.readFileSync(file(userA), 'utf8');
        assert.throws(() => store.addBulk([{ action: 'Válida' }, { action: '' }]), /commitment_action_invalid/);
        assert.throws(() => make({ dueAt: 'invalid' }), /commitment_date_invalid/);
        assert.equal(fs.readFileSync(file(userA), 'utf8'), before);
    });
    await test('fallo de escritura no informa éxito ni destruye original; limpia temporal', () => {
        const item = make(); const before = fs.readFileSync(file(userA), 'utf8');
        const originalRename = fs.renameSync;
        fs.renameSync = (a, b) => { if (b === file(userA)) throw new Error('locked'); return originalRename(a, b); };
        try {
            assert.throws(() => store.markFulfilled(guard(item)), /commitment_persistence_failed/);
            assert.throws(() => make(), /commitment_persistence_failed/);
        } finally { fs.renameSync = originalRename; }
        assert.equal(fs.readFileSync(file(userA), 'utf8'), before);
        assert.equal(fs.readdirSync(path.dirname(file(userA))).some(name => name.endsWith('.tmp')), false);
    });
    await test('datos corruptos fallan cerrados y nunca se sustituyen por una lista vacía', () => {
        const before = fs.readFileSync(file(userA), 'utf8');
        try {
            for (const raw of ['{broken', '{}', '[null]']) {
                fs.writeFileSync(file(userA), raw);
                assert.throws(() => store.list(), /commitment_store_/);
                assert.throws(() => make(), /commitment_store_/);
                assert.equal(fs.readFileSync(file(userA), 'utf8'), raw);
            }
        } finally { fs.writeFileSync(file(userA), before); }
    });
    await test('reconcile nunca llama LLM ni completa por parecido textual', async () => {
        const item = make(); let calls = 0;
        const original = extractor.checkFulfillmentLLM; extractor.checkFulfillmentLLM = async () => { calls++; return [item.id]; };
        try {
            const result = await commitments.reconcile({ type: 'task_completed', title: item.action });
            assert.equal(result.updated, 0); assert.equal(result.reviewRequired, true); assert.equal(calls, 0);
            assert.equal(store.get(item.id).status, 'pending');
        } finally { extractor.checkFulfillmentLLM = original; }
    });
    await test('LOCAL_ONLY y LOCAL bloquean extracción antes de enviar texto; parámetros no lo eluden', async () => {
        const original = extractor.extractCommitments; let calls = 0;
        const originalHasKey = openai.hasKey; openai.hasKey = () => true;
        extractor.extractCommitments = async () => { calls++; return []; };
        try {
            for (const hybrid of [{ privacy: 'LOCAL_ONLY', mode: 'AUTO' }, { privacy: 'STANDARD', mode: 'LOCAL' }]) {
                settings.patchHybrid(userA, hybrid);
                const result = await commitments.ingestText({ text: 'Esto es información privada', mode: 'CLOUD', privacy: 'STANDARD' });
                assert.equal(result.error, 'LOCAL_ONLY_MODE'); assert.equal(calls, 0);
            }
            settings.patchHybrid(userA, { mode: 'CLOUD', privacy: 'STANDARD' });
            assert.equal((await commitments.ingestText({ text: 'Permitido explícitamente por ajustes' })).detected, 0);
            assert.equal(calls, 1);
        } finally { extractor.extractCommitments = original; openai.hasKey = originalHasKey; }
    });
    await test('sin proveedor o cloud desactivado no informa detección vacía ni envía texto', async () => {
        const original = extractor.extractCommitments, originalHasKey = openai.hasKey;
        let calls = 0; extractor.extractCommitments = async () => { calls++; return []; };
        try {
            openai.hasKey = () => false;
            assert.equal((await commitments.ingestText({ text: 'Privado' })).error, 'commitment_provider_unavailable');
            openai.hasKey = () => true;
            settings.patch(userA, { key: 'ai.cloud', enabled: false });
            assert.equal((await commitments.ingestText({ text: 'Privado' })).error, 'commitment_provider_unavailable');
            assert.equal(calls, 0);
        } finally { extractor.extractCommitments = original; openai.hasKey = originalHasKey; }
    });
    await test('respuesta de extracción inválida o fallo no se confunde con ausencia de compromisos', async () => {
        const originalHasKey = openai.hasKey, originalChat = openai.chatComplete;
        openai.hasKey = () => true;
        try {
            for (const response of ['', '{}', 'bad json']) {
                openai.chatComplete = async () => response;
                await assert.rejects(() => extractor.extractCommitments({ text: 'Enviaré mañana una propuesta al cliente.' }), /commitment_extraction_failed/);
            }
            openai.chatComplete = async () => '{"commitments":[]}';
            assert.deepEqual(await extractor.extractCommitments({ text: 'No hay una promesa concreta en este documento.' }), []);
        } finally { openai.hasKey = originalHasKey; openai.chatComplete = originalChat; }
    });
    await test('API get devuelve snapshot y mutaciones exigen guard; límite de cuerpo y owner', async () => {
        const item = make(); const fetched = await invokeApi('get', { id: item.id });
        assert.equal(fetched.success, true); assert.deepEqual(fetched.data.snapshot, store.snapshot(item));
        assert.equal((await invokeApi('mark_fulfilled', { id: item.id })).success, false);
        assert.equal((await invokeApi('get', { id: item.id, ownerId: userB })).status, 403);
        assert.equal((await invokeApi('list', [])).status, 400);
        assert.equal((await invokeApi('list', {}, 'x'.repeat(65537))).status, 413);
        const fulfilled = await invokeApi('mark_fulfilled', guard(item)); assert.equal(fulfilled.success, true);
        assert.equal(fulfilled.data.item.status, 'fulfilled');
        assert.equal((await invokeApi('mark_cancelled', guard(item))).status, 409);
    });
    await test('API sin sesión no usa fallback dueño ni acepta service-token implícito', async () => {
        const response = await userContext.runAs(null, () => invokeApi('list', {}));
        assert.equal(response.status, 401); assert.equal(response.error, 'commitment_auth_required');
    });
    console.log(`${passed} focused checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('gunter-commitments-')) {
        throw new Error('Unsafe test cleanup');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
});
