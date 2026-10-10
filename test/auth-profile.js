'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-auth-profile-'));
process.env.GUNTER_AUTH_DATA_DIR = dataDir;
const auth = require('../server/auth');
const store = require('../server/auth/store');
const sessions = require('../server/auth/sessions');
function request(token, expectedUserId) {
    return { headers: { cookie: token ? `gunter_session=${token}` : '', 'user-agent': 'profile-test',
        ...(expectedUserId ? { 'x-gunter-profile-user': expectedUserId } : {}) }, socket: { remoteAddress: '127.0.0.1' } };
}
function tokenFrom(response) { return response.headers['Set-Cookie'].match(/^gunter_session=([^;]+)/)[1]; }
const delay = () => new Promise(resolve => setImmediate(resolve));

async function run() {
    try {
        const first = auth.handle('register', 'POST', { username: 'carlos', password: 'password-123',
            displayName: 'Carlos Andrés Pérez' }, request());
        assert.equal(first.status, 200);
        assert.equal(first.body.user.preferredName, 'Carlos', 'registration uses the provided first name even when it matches username');
        const firstToken = tokenFrom(first), firstId = first.body.user.id;
        const second = auth.handle('register', 'POST', { username: 'maria', password: 'password-456',
            displayName: 'María José López' }, request());
        const secondToken = tokenFrom(second), secondId = second.body.user.id;
        assert.equal(second.body.user.preferredName, 'María');
        assert.equal(auth.handle('profile', 'POST', { preferredName: 'Majo' }, request(secondToken)).status, 403);
        store.setStatus(secondId, 'approved', firstId);

        const changed = auth.handle('profile', 'POST', { preferredName: 'Carlitos' }, request(firstToken, firstId));
        assert.equal(changed.status, 200);
        assert.equal(changed.body.user.preferredName, 'Carlitos');
        assert.equal(changed.body.user.displayName, 'Carlos Andrés Pérez');
        assert.equal(changed.body.sessionStartedAt, first.body.sessionStartedAt, 'profile changes retain session identity');
        assert.equal(store.checkCredentials('carlos', 'password-123').ok, true);
        assert.equal(changed.body.user.id, firstId);
        assert.equal(changed.body.user.username, 'carlos');
        assert.equal(store.publicUser(store.findById(secondId)).preferredName, 'María', 'other account stays unchanged');

        for (const patch of [{ userId: secondId, preferredName: 'Otro' }, { username: 'otro', preferredName: 'Otro' },
            { displayName: 'Cambio', preferredName: '<script>' }, { preferredName: 'correo@example.com' },
            { preferredName: 'a'.repeat(61) }, { preferredName: null }]) {
            assert.equal(auth.handle('profile', 'POST', patch, request(firstToken)).status, 400);
            assert.equal(store.publicUser(store.findById(firstId)).displayName, 'Carlos Andrés Pérez', 'invalid patch is atomic');
            assert.equal(store.publicUser(store.findById(firstId)).preferredName, 'Carlitos');
        }
        assert.equal(auth.handle('profile', 'POST', { preferredName: 'Intruso' }, request(firstToken, secondId)).status, 409,
            'a stale tab cannot edit the account now represented by the cookie');
        assert.equal(auth.handle('profile', 'POST', { preferredName: 'Intruso' }, request()).status, 401);
        assert.equal(auth.handle('profile', 'POST', { preferredName: 'Intruso' },
            { headers: { authorization: `Bearer ${sessions.getServiceToken()}` }, socket: {} }).status, 401);
        const unnamed = store.createUser({ username: 'legacy-handle', password: 'password-789' }).user;
        assert.equal(store.publicUser(unnamed).displayName, '');
        assert.equal(store.publicUser(unnamed).preferredName, '');
        delete unnamed.preferredName;
        unnamed.displayName = unnamed.username;
        assert.equal(store.publicUser(unnamed).preferredName, '', 'legacy handle is never turned into a greeting name');
        unnamed.displayName = 'correo@example.com';
        assert.equal(store.publicUser(unnamed).preferredName, '', 'legacy email never becomes a name');
        unnamed.displayName = 'Álvaro López';
        assert.equal(store.publicUser(unnamed).preferredName, 'Álvaro', 'legacy real registration name can derive safely');
        assert.equal(auth.handle('profile', 'POST', { preferredName: '' }, request(firstToken)).status, 200);
        assert.equal(auth.handle('profile', 'POST', { displayName: 'Carlos Pérez' }, request(firstToken)).body.user.preferredName, '',
            'explicitly cleared preferred name is preserved when editing registration name');
        auth.handle('profile', 'POST', { preferredName: 'Carlos' }, request(firstToken));
        await new Promise(resolve => setTimeout(resolve, 210));
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
        assert.equal(saved.users.find(user => user.id === firstId).preferredName, 'Carlos');
        delete require.cache[require.resolve('../server/auth/store')];
        const reloadedStore = require('../server/auth/store');
        assert.equal(reloadedStore.publicUser(reloadedStore.findById(firstId)).preferredName, 'Carlos', 'profile survives server restart');

        // Browser clients invalidate one another's caches and re-read the
        // authenticated server profile. Broadcast payloads contain no names.
        const channels = [];
        class BroadcastChannel {
            constructor(name) { this.name = name; channels.push(this); }
            addEventListener(_type, listener) { this.listener = listener; }
            postMessage(data) {
                assert.deepEqual(Object.keys(data).sort(), ['at', 'nonce', 'userId']);
                channels.filter(channel => channel !== this && channel.name === this.name)
                    .forEach(channel => channel.listener({ data }));
            }
        }
        function storage(values = new Map()) {
            return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
                removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; } };
        }
        const local = storage();
        local.setItem('gunter_device_user', firstId);
        const code = fs.readFileSync(path.join(__dirname, '../js/services/auth-service.js'), 'utf8');
        function browser(token, localStorage = local) {
            const events = [], windowListeners = new Map();
            const window = { BroadcastChannel, addEventListener(type, listener) { windowListeners.set(type, listener); } };
            let requests = 0;
            const document = { body: null, addEventListener() {}, getElementById: () => null,
                dispatchEvent(event) { events.push(event); } };
            const sessionStorage = storage();
            vm.runInNewContext(code, { window, document, sessionStorage, localStorage, console,
                location: { pathname: '/day.html', search: '', replace() {}, reload() {} },
                indexedDB: {}, setInterval() {}, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
                fetch: async (url, options = {}) => {
                    requests++;
                    const req = request(token, options.headers?.['X-Gunter-Profile-User']);
                    const response = auth.handle(url.replace('/api/auth/', ''), options.method || 'GET',
                        options.body ? JSON.parse(options.body) : {}, req);
                    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
                } });
            return { auth: window.GunterAuth, events, get requests() { return requests; }, listeners: windowListeners };
        }
        const tabA = browser(firstToken), tabB = browser(firstToken);
        const otherLocal = storage(); otherLocal.setItem('gunter_device_user', secondId);
        const otherAccount = browser(secondToken, otherLocal);
        await delay();
        assert.equal(tabA.auth.isVerified(), true);
        const otherRequestCount = otherAccount.requests;
        const sessionBefore = tabA.auth.getSessionStartedAt();
        await tabA.auth.updateProfile({ preferredName: 'Charlie' });
        await delay();
        assert.equal(tabA.auth.getPreferredName(), 'Charlie');
        assert.equal(tabB.auth.getPreferredName(), 'Charlie', 'other authenticated tab refreshes profile');
        assert.equal(otherAccount.auth.getPreferredName(), 'María');
        assert.equal(otherAccount.requests, otherRequestCount, 'profile notice for a different account is ignored');
        assert.equal(tabA.auth.getSessionStartedAt(), sessionBefore);
        assert.equal(tabB.auth.getSessionStartedAt(), sessionBefore);
        assert.ok(tabB.events.some(event => event.type === 'gunter-auth-profile-changed'));
        await assert.rejects(() => tabA.auth.updateProfile({ preferredName: '<script>' }));
        assert.equal(tabA.auth.getPreferredName(), 'Charlie');
        console.log('AUTH PROFILE: registration names, safe legacy derivation, per-account persistence, atomic validation, stable sessions, tab synchronization ✓');
    } finally {
        await new Promise(resolve => setTimeout(resolve, 210));
        sessions.destroyAll();
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
