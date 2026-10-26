#!/usr/bin/env node
'use strict';
// Static safety contracts only. These tests never execute ADB, invent a phone,
// contact a local server, grant permissions or claim a successful USB test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'connect-android-pc-test.ps1'), 'utf8');

test('default isolated port is bounded and the visual lab is rejected', () => {
    assert.match(source, /\[ValidateRange\(1024, 65535\)\]\[int\]\$Port = 3002/);
    assert.match(source, /if \(\$Port -eq 3013\) \{ throw/);
    assert.match(source, /if \(\$Connect -and \$Disconnect\) \{ throw/);
});
test('preflight returns before the first possible ADB invocation', () => {
    const preflight = source.indexOf("Mode = 'PREFLIGHT_ONLY'");
    const end = source.indexOf('\n    return\n}', preflight);
    const firstCall = source.indexOf('$deviceOutput = Invoke-ScopedAdb');
    assert.ok(preflight > 0 && end > preflight && firstCall > end);
    assert.match(source, /if \(-not \(\$Connect -or \$Disconnect\)\) \{ throw 'ADB requiere/);
    assert.match(source, /DeviceChecked = \$false/);
});
test('health check reads only local health headers without proxy or redirects', () => {
    assert.match(source, /http:\/\/127\.0\.0\.1:\$TestPort\/api\/health/);
    assert.match(source, /HttpCompletionOption\]::ResponseHeadersRead/);
    assert.match(source, /\$handler\.UseProxy = \$false/);
    assert.match(source, /\$handler\.AllowAutoRedirect = \$false/);
    assert.doesNotMatch(source, /ReadAsStringAsync|ReadAsByteArrayAsync|Invoke-WebRequest|Invoke-RestMethod/);
});
test('authorized selection is exact and multiple devices need an explicit selector', () => {
    assert.match(source, /\$devices\.Count -gt 1\) \{ throw/);
    assert.match(source, /\$_.DeviceSerial -ceq \$RequestedSerial/);
    assert.match(source, /\$selected\[0\]\.State -cne 'device'\) \{ throw/);
    assert.match(source, /\$Serial -notmatch '\^\[A-Za-z0-9_\.:-\]\+\$'/);
});
test('every device mapping call is scoped and cannot silently rebind', () => {
    const deviceCalls = source.match(/-AdbArguments @\('-s', \$[A-Za-z]+, 'reverse'[^\n]+/g) || [];
    assert.equal(deviceCalls.length, 3);
    assert.ok(deviceCalls.some(value => value.includes("'--no-rebind', $socket, $socket")));
    assert.ok(deviceCalls.some(value => value.includes("'--remove', $socket")));
    assert.match(source, /\$atPort\[0\]\.PcSocket -cne \$socket/);
    assert.doesNotMatch(source, /--remove-all/);
});
test('process execution is argument-vector only and stops only its owned client', () => {
    assert.match(source, /\$start\.UseShellExecute = \$false/);
    assert.match(source, /\$start\.CreateNoWindow = \$true/);
    assert.match(source, /\$start\.ArgumentList\.Add\(\$argument\)/);
    assert.match(source, /\$process\.WaitForExit\(10000\)/);
    assert.match(source, /\$process\.Kill\(\)/);
    assert.doesNotMatch(source, /Kill\(\$true\)|Invoke-Expression|cmd\.exe|Start-Process|Stop-Process/);
});
test('ADB host stays local and outputs never disclose identifiers or raw logs', () => {
    assert.match(source, /@\('-H', '127\.0\.0\.1', '-P', '5037'\)/);
    assert.match(source, /@\('ADB_TRACE', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_PORT', 'ANDROID_SERIAL'\)/);
    assert.doesNotMatch(source, /Write-(?:Output|Host|Error).*\$(?:Serial|selectedSerial|deviceOutput|text|errorText|listing)\b/);
    assert.doesNotMatch(source, /IdentifierPrinted = \$true/);
});
test('no APK installation, permissions, server lifecycle or broad device action exists', () => {
    assert.doesNotMatch(source, /'(?:install|install-multiple|uninstall|shell|push|pull|tcpip|reboot|root|keygen|kill-server|start-server|connect|disconnect|forward)'/);
    assert.doesNotMatch(source, /server\.js|\.env\b|Set-ExecutionPolicy|Set-NetFirewall|New-NetFirewall|--remove-all/);
    assert.match(source, /if \(\$Connect -and \$healthStatus -ne 200\) \{ throw/);
});
