const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { configuredHost } = require('../server/listen-host');
test('optional listen host preserves current deployment default and validates explicit bindings', () => {
    for (const value of [undefined, null, '']) assert.equal(configuredHost(value), undefined);
    for (const value of ['127.0.0.1', '0.0.0.0', '::1', '::']) assert.equal(configuredHost(value), value);
    for (const value of ['localhost', 'evil.example', '127.0.0.1\n', ' http://127.0.0.1', '192.168.1.1']) assert.throws(() => configuredHost(value), /GUNTER_LISTEN_HOST_INVALID/);
});
test('manual PC runner is opt-in, loopback-only and uses isolated ignored storage', () => {
    const source = fs.readFileSync(require.resolve('../gunter-mobile/scripts/start-android-pc-test.ps1'), 'utf8');
    for (const value of ['[int]$Port = 3002', '[switch]$Start', 'if (-not $Start)', '$Port -eq 3013', "GUNTER_LISTEN_HOST = '127.0.0.1'", 'data/android-pc-test', 'GUNTER_AUTH_DATA_DIR', 'GUNTER_CONTROL_DATA_DIR', 'GUNTER_WHATSAPP_SESSION_DIR', '$previousEnvironment', "'Process'", 'if ($occupied) { throw']) assert.ok(source.includes(value), value);
    assert.doesNotMatch(source, /Stop-Process|taskkill|netsh|New-NetFirewallRule|Set-Content|Remove-Item|Invoke-Expression/);
    const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    assert.ok(server.includes('server.listen(PORT, LISTEN_HOST, () =>'));
});
