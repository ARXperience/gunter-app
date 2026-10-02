const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://gunter.example.test',
    AUTH_COOKIE_SECURE: 'true',
    OPENAI_API_KEY: 'test-placeholder',
    GUNTER_REPLICAS: '1'
};
const ok = spawnSync(process.execPath, ['scripts/preflight.js'], { cwd: root, env: baseEnv, encoding: 'utf8' });
assert.equal(ok.status, 0, `single instance should pass preflight: ${ok.stderr}`);

const blocked = spawnSync(process.execPath, ['scripts/preflight.js'], {
    cwd: root, env: { ...baseEnv, GUNTER_REPLICAS: '2' }, encoding: 'utf8'
});
assert.equal(blocked.status, 1, 'multiple replicas must fail preflight until shared persistence is implemented');
assert.match(blocked.stderr, /solo admite una instancia/);

const partialApns = spawnSync(process.execPath, ['scripts/preflight.js'], {
    cwd: root,
    env: { ...baseEnv, GUNTER_REPLICAS: '1', APNS_KEY_ID: 'bad', APNS_TEAM_ID: '', APNS_PRIVATE_KEY: '' },
    encoding: 'utf8'
});
assert.equal(partialApns.status, 1, 'a partial APNs setup must not be reported ready');
assert.match(partialApns.stderr, /configuración APNs está incompleta/);

console.log('Preflight: safe replica limit and incomplete APNs configuration are enforced.');
