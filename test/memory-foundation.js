/* Local memory contract: owner isolation, legacy provenance and one turn store. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const records = new Map();
const turns = new Map();
const local = new Map([['gunter_device_user', 'alice'], ['gunter_memory_legacy_owner', 'alice']]);
let user = 'alice';
let verified = true;
let writes = 0;
const repo = {
    async get(key, store = 'records') { return (store === 'turns' ? turns : records).get(key); },
    async all(store = 'records') { return [...(store === 'turns' ? turns : records).values()]; },
    async put(record) { writes++; records.set(record.key, record); return record; },
    async delete(key, store = 'records') { (store === 'turns' ? turns : records).delete(key); return true; }
};
const context = { console, Date, Map, Set, Promise, crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
    GunterAuth: { isVerified: () => verified, getUser: () => ({ id: user }) },
    GunterDataRepository: { memory: repo } };
context.GunterConversationMemory = {
    async remember(input) {
        const turn = { ...input, id: `turn_${turns.size + 1}`, ts: Date.now(), ownerId: user };
        turns.set(turn.id, turn);
        return turn;
    },
    async recall() { return [...turns.values()]; }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/services/gunter-memory.js'), 'utf8'), context);

async function verifyAuthMarker(initialDeviceUser, incomingUser, outcome = 'ok') {
    const values = new Map(initialDeviceUser ? [['gunter_device_user', initialDeviceUser]] : []);
    const storage = { getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        key: index => [...values.keys()][index] || null,
        get length() { return values.size; } };
    let reloaded = false;
    const authContext = { console, localStorage: storage,
        sessionStorage: { getItem: () => outcome === 'offline' || outcome === 'denied'
            ? JSON.stringify({ id: incomingUser, username: incomingUser, status: 'approved' }) : null,
            setItem() {}, removeItem() {} },
        location: { pathname: '/login.html', search: '', reload: () => { reloaded = true; } },
        indexedDB: { databases: async () => [] },
        document: { dispatchEvent() {}, getElementById: () => null },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        fetch: async () => outcome === 'offline' ? Promise.reject(new Error('offline')) :
            ({ status: outcome === 'denied' ? 401 : 200, json: async () => ({ success: true,
            user: { id: incomingUser, username: incomingUser, role: 'user', status: 'approved' } }) }) };
    authContext.window = authContext;
    vm.createContext(authContext);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/services/auth-service.js'), 'utf8'), authContext);
    await authContext.GunterAuth.refresh();
    return { owner: values.get('gunter_memory_legacy_owner'), deviceUser: values.get('gunter_device_user'), reloaded,
        trusted: authContext.GunterAuth.canAccessLocalData(), verified: authContext.GunterAuth.isVerified() };
}

(async () => {
    const memory = context.GunterMemory;
    const saved = await memory.put({ type: 'preference', source: 'test', content: 'Prefiere respuestas breves' });
    assert.equal(saved.version, 1);
    assert.equal((await memory.get(saved.id)).content, saved.content);
    assert.equal((await memory.search('respuestas breves')).length, 1);
    assert.equal((await memory.put({ id: saved.id, type: 'preference', source: 'test', content: 'Prefiere respuestas precisas' })).version, 2);
    assert.equal(writes, 2);

    turns.set('turn_old', { id: 'turn_old', role: 'user', text: 'Conversación anterior de Alicia', ts: Date.now() });
    turns.set('turn_bob', { id: 'turn_bob', ownerId: 'bob', role: 'user', text: 'Secreto de Bob', ts: Date.now() });
    assert.ok(await memory.get('turn_old'));
    assert.equal(await memory.get('turn_bob'), null);
    assert.equal((await memory.list({ type: 'conversation' })).length, 1);

    const written = await memory.rememberConversation({ role: 'user', text: 'Mensaje nuevo de Alicia', channel: 'companion' });
    assert.equal(written.ownerId, 'alice');
    assert.equal(records.size, 1, 'the conversation adapter must not duplicate turns into records');
    assert.equal(turns.size, 3);
    assert.equal((await memory.recallConversation('mensaje')).length, 2);

    local.set('gunter_memory_legacy_owner', 'UNBOUND');
    assert.equal(await memory.get('turn_old'), null, 'unowned turns are quarantined');
    assert.ok(await memory.get(written.id), 'new owner-stamped turns remain readable');
    assert.equal((await memory.list({ type: 'conversation' })).length, 1);
    assert.equal(await memory.delete('turn_old'), false);

    user = 'bob';
    local.set('gunter_device_user', 'bob');
    assert.equal(await memory.get(saved.id), null);
    assert.equal(await memory.get(written.id), null);
    assert.ok(await memory.get('turn_bob'));
    assert.equal((await memory.search('Alicia')).length, 0);
    verified = false;
    await assert.rejects(memory.list(), /MEMORY_AUTH_REQUIRED/);
    await assert.rejects(memory.rememberConversation({ role: 'user', text: 'No autorizado' }), /MEMORY_AUTH_REQUIRED/);
    assert.equal((await verifyAuthMarker('alice', 'alice')).owner, 'alice');
    assert.equal((await verifyAuthMarker(null, 'alice')).owner, 'UNBOUND');
    const switched = await verifyAuthMarker('alice', 'bob');
    assert.equal(switched.owner, 'UNBOUND');
    assert.equal(switched.deviceUser, 'bob');
    assert.equal(switched.reloaded, true);
    const offline = await verifyAuthMarker('alice', 'alice', 'offline');
    assert.equal(offline.verified, false);
    assert.equal(offline.trusted, true);
    assert.equal((await verifyAuthMarker('bob', 'alice', 'offline')).trusted, false);
    assert.equal((await verifyAuthMarker('alice', 'alice', 'denied')).trusted, false);
    console.log('MEMORY FOUNDATION: owner isolation, legacy quarantine, persistence contract and no duplicate turns ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
