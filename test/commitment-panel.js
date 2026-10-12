'use strict';
// Focused VM/DOM checks: no browser, network, model or permission activation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/controllers/commitments-panel.js'), 'utf8');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        async fire(name, event = {}) {
            event.target ||= this; event.preventDefault ||= () => {};
            await Promise.all((listeners.get(name) || []).map(fn => fn(event)));
        }, dispatchEvent(event) { void this.fire(event.type, event); }
    });
}
const unescape = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (attributes.length) return attributes.every(([, name, value]) => name in node.attributes
        && (value === undefined || node.attributes[name] === value));
    return selector.toUpperCase() === node.tagName;
}
function element(id = '') {
    const node = emitter({ id, value: '', hidden: false, disabled: false, children: [], dataset: {}, attributes: {},
        classList: { add() {}, remove() {} }, focus() {},
        querySelectorAll(selector) {
            return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }, querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    });
    let markup = '', text = '';
    Object.defineProperties(node, {
        innerHTML: { get: () => markup, set(value) {
            markup = String(value); text = ''; node.children = [];
            for (const match of markup.matchAll(/<(\w+)\b([^>]*)>/g)) {
                if (!/\bid="|\bdata-act="/.test(match[2])) continue;
                const child = element(); child.tagName = match[1].toUpperCase();
                for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
                    const name = attr[1], value = unescape(attr[2] || ''); child.attributes[name] = value;
                    if (name === 'id') child.id = value;
                    if (name === 'hidden') child.hidden = true;
                    if (name === 'disabled') child.disabled = true;
                    if (name.startsWith('data-')) child.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
                }
                node.children.push(child);
            }
        } },
        textContent: { get: () => text || unescape(markup.replace(/<[^>]*>/g, '')),
            set(value) { text = String(value); markup = ''; node.children = []; } }
    });
    return node;
}
const commitment = (id = 'cmt_1', extra = {}) => ({ id, ownerId: 'alice', owner: 'yo', beneficiary: 'cliente',
    action: `Entregar informe ${id}`, context: 'Promesa revisada', status: 'pending',
    dueAt: '2026-10-15T15:00:00Z', createdAt: '2026-10-12T12:00:00Z',
    source: { type: 'meeting', refId: 'meeting_1' }, ...extra });
const task = (commitmentId = 'cmt_1', extra = {}) => ({ id: `task_${commitmentId}`, ownerId: 'alice',
    title: `Seguimiento ${commitmentId}`, status: 'pending', source: 'commitment', meta: { commitmentId }, ...extra });
function environment(options = {}) {
    const host = element('commitments');
    const state = { owner: options.owner === undefined ? 'alice' : options.owner, flag: options.flag !== false,
        items: clone(options.items || [commitment()]), tasks: clone(options.tasks || []), reads: 0, gets: [],
        pending: null, dispatches: [], writes: [], ingests: [] };
    const scopedItems = () => clone(state.items.filter(item => item.ownerId === state.owner));
    const document = emitter({ querySelector: selector => selector === '#commitments' ? host : null });
    const window = emitter({ PremiumFeaturesService: { isEnabled: () => state.flag } });
    const snapshot = item => clone(Object.fromEntries(['id', 'ownerId', 'action', 'status', 'dueAt', 'createdAt'].map(key => [key, item[key] ?? null])));
    async function statusWrite(op, id, guard) {
        assert.equal(guard.confirmed, true); assert.equal(guard.ownerId, state.owner);
        const item = state.items.find(item => item.id === id && item.ownerId === state.owner);
        assert.ok(item); assert.deepEqual(clone(guard.expected), snapshot(item));
        state.writes.push({ op, id, guard: clone(guard) });
        if (op === 'remove') state.items = state.items.filter(item => item !== state.items.find(c => c.id === id));
        else item.status = op === 'fulfill' ? 'fulfilled' : 'cancelled';
    }
    window.GunterCommitmentsService = {
        currentOwner: () => state.owner,
        async list() { state.reads++; return options.list ? options.list(state) : scopedItems(); },
        async stats() { return { byStatus: { pending: scopedItems().filter(item => item.status === 'pending').length } }; },
        async get(id) { state.gets.push(id); return options.get ? options.get(id, state) : clone(scopedItems().find(item => item.id === id)); },
        snapshot,
        markFulfilled: async (id, note, guard) => { assert.equal(note, 'Confirmado por el usuario'); await statusWrite('fulfill', id, guard); },
        markCancelled: async (id, note, guard) => { assert.equal(note, 'Confirmado por el usuario'); await statusWrite('cancel', id, guard); },
        remove: (id, guard) => statusWrite('remove', id, guard),
        async ingestText(input) { state.ingests.push(clone(input)); return { detected: 1, created: [commitment()] }; },
        async addManual() { assert.fail('not expected in these tests'); }
    };
    if (!options.noTasks) window.GunterTasksService = { async list() {
        if (options.tasksUnavailable) throw new Error('Tasks unavailable'); return clone(state.tasks);
    } };
    window.GunterAssistantTools = {
        getPending: () => clone(state.pending), clearPending: () => { state.pending = null; },
        async dispatch(text, settings) {
            state.dispatches.push({ text, settings: clone(settings) });
            if (options.dispatch) return options.dispatch(text, settings, state);
            assert.equal(settings.inputSource, 'text');
            if (text === 'confirmo') {
                assert.ok(state.pending); assert.equal(state.pending.toolId, 'commitments.task');
                assert.equal(state.pending.args.ownerId, state.owner);
                const id = state.pending.args.targetId;
                state.writes.push({ op: 'task', id }); state.tasks.push(task(id, { ownerId: state.owner })); state.pending = null;
                return { status: 'completed', reply: 'Tarea guardada y verificada.' };
            }
            const selected = scopedItems().find(item => text === `Convierte el compromiso "${item.id}" en tarea`);
            assert.ok(selected, 'selects exact commitment ID, never an untrusted action string');
            state.pending = { toolId: 'commitments.task', actorId: state.owner, createdAt: Date.now(), args: {
                ownerId: state.owner, targetId: selected.id, viewRequestId: settings.viewRequestId, expected: snapshot(selected)
            } };
            return { status: 'awaiting_confirmation', reply: `¿Confirmas crear tarea para ${selected.action}?` };
        }
    };
    if (options.transcript !== undefined) window.GunterTranscriptStore = { async getLatest() { return clone(options.transcript); } };
    vm.runInNewContext(source, { window, document, Date, Math, Promise, Map, Number, JSON, console });
    const api = window.GunterCommitmentsPanel;
    const node = id => { const result = host.querySelector(`#${id}`); assert.ok(result, `missing element ${id}`); return result; };
    const button = (action, id = 'cmt_1') => {
        const result = node('gpi-cmt-body').querySelector(`[data-act="${action}"][data-id="${id}"]`);
        assert.ok(result, `missing action ${action} for ${id}`); return result;
    };
    return { state, host, api, window, document, node, button,
        init: async () => { await api.mount('#commitments'); await turn(); },
        click: async id => { await node(id).fire('click'); await turn(); },
        action: async (action, id) => { await button(action, id).fire('click'); await turn(); },
        markup: () => node('gpi-cmt-body').innerHTML,
        notice: () => node('gpi-cmt-notice').textContent,
        switchAccount: async ownerId => { state.owner = ownerId; await window.fire('storage', { key: 'gunter_device_user' }); await turn(); }
    };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
    await check('shows task linkage and terminal task status without offering duplicate creation', async () => {
        for (const status of ['pending', 'doing', 'done', 'cancelled']) {
            const f = environment({ tasks: [task('cmt_1', { status })] }); await f.init();
            assert.match(f.markup(), /Tarea vinculada: Seguimiento cmt_1/); assert.match(f.markup(), /day\.html#tasks/);
            assert.doesNotMatch(f.markup(), /data-act="task"/);
            if (status === 'done') assert.match(f.markup(), /completada/);
            if (status === 'cancelled') assert.match(f.markup(), /cancelada/);
            assert.equal(f.state.writes.length, 0);
        }
    });
    await check('task link map rejects foreign, ownerless, legacy and unrelated source rows', async () => {
        const f = environment({ tasks: [task('cmt_1', { ownerId: 'bob', title: 'BOB_PRIVATE' }),
            task('cmt_1', { ownerId: undefined, title: 'UNOWNED_PRIVATE' }),
            task('cmt_1', { ownerId: 'local-user', title: 'LEGACY_PRIVATE' }),
            task('cmt_1', { source: 'manual', title: 'MANUAL_UNRELATED' })] });
        await f.init(); assert.match(f.markup(), /data-act="task"/);
        assert.doesNotMatch(f.markup(), /BOB_PRIVATE|UNOWNED_PRIVATE|LEGACY_PRIVATE|MANUAL_UNRELATED/);
        assert.equal(f.state.tasks[0].ownerId, 'bob'); assert.equal(f.state.writes.length, 0);
    });
    await check('task creation goes through the existing tool gate and requires visible confirmation', async () => {
        const f = environment(); await f.init(); await f.action('task');
        assert.equal(f.state.writes.length, 0); assert.equal(f.node('gpi-cmt-confirm').hidden, false);
        assert.equal(f.state.pending.toolId, 'commitments.task'); assert.equal(f.state.pending.args.targetId, 'cmt_1');
        await f.click('gpi-cmt-confirm-yes'); assert.equal(f.state.writes.length, 1);
        assert.equal(f.state.writes[0].op, 'task'); assert.equal(f.state.dispatches.at(-1).text, 'confirmo');
        assert.match(f.markup(), /Tarea vinculada/); assert.doesNotMatch(f.markup(), /data-act="task"/);
    });
    await check('rejecting task creation clears only its matching pending proposal and performs no write', async () => {
        const f = environment(); await f.init(); await f.action('task'); await f.click('gpi-cmt-confirm-no');
        assert.equal(f.state.writes.length, 0); assert.equal(f.state.pending, null);
        assert.equal(f.node('gpi-cmt-confirm').hidden, true); assert.match(f.notice(), /No hice cambios/);
    });
    await check('manual fulfill, cancel and removal require their exact confirmed snapshots and preserve tasks', async () => {
        for (const action of ['fulfill', 'cancel', 'remove']) {
            const f = environment({ tasks: [task()] }); await f.init(); const originalTask = clone(f.state.tasks[0]);
            await f.action(action); assert.equal(f.state.writes.length, 0); assert.equal(f.node('gpi-cmt-confirm').hidden, false);
            assert.match(f.node('gpi-cmt-confirm-text').textContent, /no modifica ni elimina su tarea/);
            await f.click('gpi-cmt-confirm-yes'); assert.equal(f.state.writes.length, 1);
            assert.equal(f.state.writes[0].op, action); assert.equal(f.state.writes[0].guard.confirmed, true);
            assert.deepEqual(f.state.tasks[0], originalTask); assert.equal(f.state.dispatches.length, 0);
        }
    });
    await check('rejecting a manual status proposal changes neither commitment nor linked task', async () => {
        const f = environment({ tasks: [task()] }); await f.init(); const before = clone(f.state.items);
        await f.action('fulfill'); await f.click('gpi-cmt-confirm-no');
        assert.deepEqual(f.state.items, before); assert.equal(f.state.writes.length, 0);
    });
    await check('a replaced chat fingerprint cannot authorize a different action or clear its proposal', async () => {
        const f = environment(); await f.init(); await f.action('task');
        const replacement = { toolId: 'tasks.cancel', actorId: 'alice', args: { id: 'task_other' }, createdAt: Date.now() };
        f.state.pending = clone(replacement); await f.click('gpi-cmt-confirm-yes');
        assert.equal(f.state.writes.length, 0); assert.deepEqual(f.state.pending, replacement);
        assert.equal(f.state.dispatches.length, 1); assert.match(f.notice(), /No autoricé cambios/);
    });
    await check('an existing chat confirmation blocks a panel proposal instead of replacing it', async () => {
        const f = environment(); await f.init(); f.state.pending = { toolId: 'tasks.complete', args: { id: 'task_other' } };
        const pending = clone(f.state.pending); await f.action('task');
        assert.deepEqual(f.state.pending, pending); assert.equal(f.state.gets.length, 0); assert.equal(f.state.dispatches.length, 0);
        assert.match(f.notice(), /confirmación pendiente/);
    });
    await check('changing accounts invalidates private proposals and prevents stale confirmation', async () => {
        const f = environment(); await f.init(); await f.action('task'); await f.switchAccount('bob');
        await f.click('gpi-cmt-confirm-yes');
        assert.equal(f.state.writes.length, 0); assert.equal(f.state.pending, null);
        assert.equal(f.node('gpi-cmt-confirm').hidden, true); assert.doesNotMatch(f.markup(), /Entregar informe cmt_1/);
    });
    await check('ABA account transitions reject a late action read from the previous owner epoch', async () => {
        const late = deferred(); const f = environment({ get: () => late.promise }); await f.init();
        const acting = f.button('task').fire('click'); await turn();
        await f.switchAccount('bob'); await f.switchAccount('alice'); late.resolve(commitment()); await acting; await turn();
        assert.equal(f.state.dispatches.length, 0); assert.equal(f.state.pending, null); assert.equal(f.state.writes.length, 0);
        assert.equal(f.node('gpi-cmt-confirm').hidden, true);
    });
    await check('ABA account transitions ignore stale refresh data even after returning to the same account', async () => {
        const late = deferred(); let reads = 0;
        const f = environment({ list: state => (++reads === 2 ? late.promise : clone(state.items.filter(item => item.ownerId === state.owner))) });
        await f.init(); const refreshing = f.api.refresh(); await turn();
        await f.switchAccount('bob'); await f.switchAccount('alice');
        late.resolve([commitment('cmt_old', { action: 'STALE_PRIVATE_RESPONSE' })]); await refreshing; await turn();
        assert.doesNotMatch(f.markup(), /STALE_PRIVATE_RESPONSE/); assert.match(f.markup(), /Entregar informe cmt_1/);
    });
    await check('unavailable task storage is disclosed and never offers unsafe duplicate task creation', async () => {
        for (const option of [{ tasksUnavailable: true }, { noTasks: true }]) {
            const f = environment(option); await f.init();
            assert.match(f.node('gpi-cmt-stats').textContent, /No pude consultar las tareas vinculadas/);
            assert.doesNotMatch(f.markup(), /data-act="task"/); assert.match(f.markup(), /data-act="fulfill"/);
            assert.equal(f.state.writes.length, 0);
        }
    });
    await check('action, context, names and linked task text are escaped rather than executed as markup', async () => {
        const f = environment({ items: [commitment('cmt_1', { owner: '<b>Owner</b>', beneficiary: '"<script>steal()</script>',
            action: '<img src=x onerror=steal()> & "title"', context: '<iframe src=secret></iframe>' })],
            tasks: [task('cmt_1', { title: '<svg onload=steal()>' })] }); await f.init();
        assert.doesNotMatch(f.markup(), /<img|<script|<iframe|<svg|<b>Owner/);
        assert.match(f.markup(), /&lt;img/); assert.match(f.markup(), /&amp;/); assert.match(f.markup(), /&lt;svg/);
    });
    await check('disabled tracking respects the preference, does not read data and invalidates pending actions', async () => {
        const off = environment({ flag: false }); await off.init(); assert.equal(off.state.reads, 0);
        assert.match(off.markup(), /está desactivado/); await off.click('gpi-cmt-add'); assert.equal(off.state.writes.length, 0);
        const f = environment(); await f.init(); await f.action('task'); f.state.flag = false;
        await f.window.fire('gunterPremiumFeaturesChange', { detail: { key: 'commitmentTracker' } }); await turn();
        await f.click('gpi-cmt-confirm-yes'); assert.equal(f.state.pending, null); assert.equal(f.state.writes.length, 0);
        assert.match(f.markup(), /está desactivado/);
    });
    await check('refresh failure reports an error instead of falsely reporting no commitments', async () => {
        const f = environment({ list: () => Promise.reject(new Error('Servidor local no disponible <retry>')) }); await f.init();
        assert.match(f.markup(), /Servidor local no disponible/); assert.match(f.markup(), /&lt;retry&gt;/);
        assert.doesNotMatch(f.markup(), /Sin compromisos por ahora|data-act=/); assert.equal(f.state.writes.length, 0);
    });
    await check('detect never attributes global, unowned or foreign transcripts to the authenticated account', async () => {
        for (const transcript of [undefined, { id: 'legacy', text: 'Me encargo de entregar el informe la próxima semana.' },
            { id: 'other', ownerId: 'bob', text: 'Me encargo de entregar el informe la próxima semana.' }]) {
            const f = environment({ transcript }); await f.init(); await f.click('gpi-cmt-detect');
            assert.equal(f.state.ingests.length, 0); assert.match(f.notice(), /propietario verificable|atribuir esta transcripción/);
        }
        const f = environment({ transcript: { id: 'meeting_own', ownerId: 'alice', text: 'Me encargo de entregar el informe la próxima semana.' } });
        await f.init(); await f.click('gpi-cmt-detect'); assert.equal(f.state.ingests.length, 1);
        assert.equal(f.state.ingests[0].sourceRefId, 'meeting_own'); assert.equal(f.state.ingests[0].sourceType, 'meeting');
        assert.equal(f.state.writes.length, 0); assert.match(f.notice(), /Revísalos antes de actuar/);
    });
    await check('mine filter recognizes authorized preferred names without assuming third-party ownership', async () => {
        const f = environment({ items: [commitment('cmt_me', { owner: 'Carlos Andrés' }), commitment('cmt_other', { owner: 'María' })] });
        f.window.GunterAuth = { getUser: () => ({ id: 'alice', displayName: 'Carlos Andrés Pérez', preferredName: 'Carlos Andrés' }) };
        await f.init();
        const filter = f.node('gpi-cmt-owner'); filter.value = 'me'; await filter.fire('change');
        assert.match(f.markup(), /cmt_me/); assert.doesNotMatch(f.markup(), /cmt_other/);
    });
    await check('account change erases old action prompts and notices', async () => {
        const f = environment(); await f.init(); await f.action('fulfill');
        assert.match(f.node('gpi-cmt-confirm-text').textContent, /Entregar informe/);
        f.node('gpi-cmt-notice').textContent = 'Privado de alice';
        await f.switchAccount('bob');
        assert.equal(f.node('gpi-cmt-confirm-text').textContent, ''); assert.equal(f.notice(), '');
    });
    console.log(`commitment-panel: ${passed} focused linkage/confirmation/account/UI cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
