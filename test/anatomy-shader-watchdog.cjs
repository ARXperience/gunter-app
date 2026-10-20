'use strict';
// Watchdog contracts: never loads EGL, creates GL contexts or launches a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { runProgram } = require('../scripts/check-anatomy-shaders.cjs');
const program = { name: 'test', vertex: '#version 300 es\nvoid main(){}', fragment: '#version 300 es\nvoid main(){}' };

function processStub(mode) {
    const records = [];
    return { records, spawn(command, args, options) {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        const manifest = args[args.indexOf('-ManifestPath') + 1];
        records.push({ command, args, options, manifest, child, kills: [] });
        const row = records.at(-1);
        assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')), { programs: [program] });
        child.kill = signal => { row.kills.push(signal); setImmediate(() => child.emit('close', null, signal)); return true; };
        if (mode !== 'hang') setImmediate(() => {
            if (mode === 'error') { child.emit('error', new Error('no compiler')); return; }
            const renderer = mode === 'hardware' ? 'Hardware GPU' : 'ANGLE (SwiftShader Device)';
            const probe = mode === 'probe';
            const report = { status: 'PASS', noDraw: !probe, pipelineProbe: probe,
                programs: [{ name: 'test', status: 'PASS', renderer, pipelineProbe: probe, probeDraw: probe, probeStatus: probe ? 'PASS' : 'NOT_REQUESTED' }] };
            child.stdout.emit('data', JSON.stringify(report)); child.emit('close', 0, null);
        });
        return child;
    } };
}

(async () => {
    for (const [mode, expected] of [['pass', 'PASS'], ['hardware', 'FAIL'], ['error', 'ERROR'], ['hang', 'TIMEOUT']]) {
        const stub = processStub(mode);
        const result = await runProgram(program, { spawn: stub.spawn, timeoutMs: 30 });
        assert.equal(result.status, expected);
        const row = stub.records[0];
        assert.equal(row.command, 'pwsh.exe'); assert.equal(row.options.windowsHide, true);
        assert.equal(row.options.shell, false); assert.ok(row.args.includes('-NoProfile'));
        assert.deepEqual(row.kills, mode === 'hang' ? ['SIGKILL'] : []);
        assert.equal(fs.existsSync(row.manifest), false, 'owned generated manifest removed');
        assert.equal(fs.existsSync(require('node:path').dirname(row.manifest)), false, 'owned empty directory removed');
        console.log('ok - ' + mode + ': bounded isolated compiler contract');
    }
    assert.throws(() => runProgram(program, { timeoutMs: 60000 }), /watchdog/);
    assert.throws(() => runProgram({ ...program, name: '../unsafe' }), /named shader/);
    const probeStub = processStub('probe');
    assert.equal((await runProgram(program, { spawn: probeStub.spawn, timeoutMs: 100, probeDraw: true })).status, 'PASS');
    assert.ok(probeStub.records[0].args.includes('-ProbeDraw'));
    const { spawn } = require('node:child_process');
    let ownedChild;
    const live = await runProgram(program, { timeoutMs: 100, spawn() {
        ownedChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
            windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
        });
        return ownedChild;
    } });
    assert.equal(live.status, 'TIMEOUT');
    assert.ok(ownedChild.pid > 0 && (ownedChild.signalCode || ownedChild.exitCode !== null), 'the owned test child exited');
    console.log('ok - real watchdog terminates only its owned idle Node child');
    console.log('8 native-compiler watchdog contracts passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
