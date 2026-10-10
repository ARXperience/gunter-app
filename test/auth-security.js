const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-auth-security-'));
process.env.GUNTER_AUTH_DATA_DIR = dataDir;

const auth = require('../server/auth');
const store = require('../server/auth/store');
const sessions = require('../server/auth/sessions');

function request(cookie = '') {
    return {
        headers: { cookie, 'user-agent': 'auth-security-test' },
        socket: { remoteAddress: '127.0.0.1' }
    };
}

function tokenFrom(response) {
    const value = response.headers?.['Set-Cookie'] || '';
    return value.match(/^gunter_session=([^;]+)/)?.[1] || null;
}

async function run() {
try {
    const registration = auth.handle('register', 'POST', {
        username: 'security-test', password: 'initial-pass-123', displayName: 'Security Test'
    }, request());
    assert.equal(registration.status, 200);
    const oldToken = tokenFrom(registration);
    assert.ok(oldToken, 'register creates an HttpOnly session cookie');
    assert.equal(registration.body.sessionStartedAt, sessions.get(oldToken).createdAt);
    assert.equal(auth.handle('me', 'GET', {}, request(`gunter_session=${oldToken}`)).body.sessionStartedAt,
        registration.body.sessionStartedAt, 'welcome marker is stable across authenticated page loads');
    const otherDeviceToken = sessions.create(registration.body.user.id, 'other-device-test');

    const rejected = auth.handle('change-password', 'POST', {
        current: 'incorrect-pass', next: 'rotated-pass-456'
    }, request(`gunter_session=${oldToken}`));
    assert.equal(rejected.status, 401);
    assert.equal(auth.handle('me', 'GET', {}, request(`gunter_session=${oldToken}`)).status, 200);

    const changed = auth.handle('change-password', 'POST', {
        current: 'initial-pass-123', next: 'rotated-pass-456'
    }, request(`gunter_session=${oldToken}`));
    assert.equal(changed.status, 200);
    const newToken = tokenFrom(changed);
    assert.ok(newToken && newToken !== oldToken, 'password change issues a distinct session token');
    assert.equal(auth.handle('me', 'GET', {}, request(`gunter_session=${oldToken}`)).status, 401);
    assert.equal(auth.handle('me', 'GET', {}, request(`gunter_session=${otherDeviceToken}`)).status, 401);
    assert.equal(auth.handle('me', 'GET', {}, request(`gunter_session=${newToken}`)).status, 200);
    assert.equal(store.checkCredentials('security-test', 'initial-pass-123').ok, false);
    assert.equal(store.checkCredentials('security-test', 'rotated-pass-456').ok, true);

    console.log('Auth security: password change rotates the active session, revokes old sessions, and invalidates the old password.');
} finally {
    // Let the stores' debounced writes flush before removing this isolated test directory.
    await new Promise(resolve => setTimeout(resolve, 200));
    sessions.destroyAll();
    fs.rmSync(dataDir, { recursive: true, force: true });
}
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
