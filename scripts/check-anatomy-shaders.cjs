'use strict';
// No browser automation. Each shader pair runs in a disposable, CPU-only
// ANGLE/SwiftShader process; a watchdog terminates only that owned child.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function collectSources() {
    const context = vm.createContext({ window: {}, document: {
        createElement() { throw new Error('Shader export must never initialize a renderer.'); }
    } });
    for (const file of ['js/dev/gunter-anatomy-cache.js', 'js/dev/gunter-idle-core-anatomy.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file, timeout: 1500 });
    }
    const programs = context.window.GunterIdleCoreAnatomy.shaderSources();
    return Object.entries(programs).map(([name, pair]) => {
        if (!/^[a-z]+$/.test(name) || typeof pair.vertex !== 'string' || typeof pair.fragment !== 'string'
            || !pair.vertex.startsWith('#version 300 es') || !pair.fragment.startsWith('#version 300 es')
            || pair.vertex.length > 1024 * 1024 || pair.fragment.length > 1024 * 1024) {
            throw new Error('Invalid or oversized exported shader pair: ' + name);
        }
        return { name, vertex: pair.vertex, fragment: pair.fragment };
    });
}

function runProgram(program, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 20000) throw new RangeError('Bounded watchdog required.');
    if (!program || !/^[a-z]+$/.test(program.name) || typeof program.vertex !== 'string' || typeof program.fragment !== 'string') {
        throw new TypeError('A named shader pair is required.');
    }
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-shader-check-'));
    const manifest = path.join(folder, 'manifest.json');
    // Generated test input, not a source edit. The two exact files/directories
    // below are owned by this invocation and are removed without recursion.
    fs.writeFileSync(manifest, JSON.stringify({ programs: [program] }));
    return new Promise(resolve => {
        let child, output = '', errors = '', timedOut = false, overflow = false, done = false, timer;
        function finish(result) {
            if (done) return;
            done = true; clearTimeout(timer);
            fs.unlinkSync(manifest); fs.rmdirSync(folder);
            resolve({ name: program.name, timeoutMs,
                sourceSha256: { vertex: createHash('sha256').update(program.vertex).digest('hex'),
                    fragment: createHash('sha256').update(program.fragment).digest('hex') }, ...result });
        }
        const args = ['-NoLogo', '-NoProfile', '-File', path.join(__dirname, 'validate-anatomy-shaders.ps1'), '-ManifestPath', manifest];
        if (options.probeDraw) args.push('-ProbeDraw');
        if (options.libraryDirectory) args.push('-LibraryDirectory', options.libraryDirectory);
        try {
            child = (options.spawn || spawn)('pwsh.exe', args, {
                cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (error) { finish({ status: 'ERROR', log: error.message }); return; }
        const append = (field, data) => {
            if (field === 'output') output += data.toString(); else errors += data.toString();
            if (output.length + errors.length > 2 * 1024 * 1024 && !overflow) {
                overflow = true; child.kill('SIGKILL');
            }
        };
        child.stdout.on('data', data => append('output', data));
        child.stderr.on('data', data => append('errors', data));
        child.once('error', error => finish({ status: 'ERROR', log: error.message }));
        child.once('close', (code, signal) => {
            if (timedOut || overflow) {
                finish({ status: timedOut ? 'TIMEOUT' : 'OUTPUT_LIMIT', code, signal,
                    log: 'Only the owned compiler child was terminated; no browser process was touched.' }); return;
            }
            try {
                const report = JSON.parse(output.trim());
                const row = report.programs?.[0];
                const probe = options.probeDraw === true;
                const okay = code === 0 && report.status === 'PASS' && report.noDraw === !probe
                    && report.programs?.length === 1 && row?.name === program.name && row?.status === 'PASS'
                    && (!probe || (report.pipelineProbe === true && row.pipelineProbe === true && row.probeDraw === true && row.probeStatus === 'PASS'))
                    && /SwiftShader/i.test(row?.renderer || '');
                finish({ status: okay ? 'PASS' : 'FAIL', code, report, stderr: errors });
            } catch { finish({ status: 'ERROR', code, log: 'Compiler returned no valid JSON report.', stderr: errors, output }); }
        });
        timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    });
}

async function main(args = process.argv.slice(2)) {
    if (process.platform !== 'win32') throw new Error('This native compiler check requires Windows; no alternate hardware fallback.');
    const programs = collectSources();
    const probeDraw = args.includes('--probe');
    const selectors = args.filter(arg => arg !== '--probe');
    const selected = selectors[0] ? selectors[0].split(',') : programs.map(program => program.name);
    if (new Set(selected).size !== selected.length || selected.some(name => !programs.some(program => program.name === name))) {
        throw new Error('Unknown or duplicate shader selection.');
    }
    const rows = [];
    for (const name of selected) {
        process.stdout.write('Checking ' + name + ' in an isolated CPU compiler process…\n');
        const result = await runProgram(programs.find(program => program.name === name), { probeDraw });
        rows.push(result); process.stdout.write(JSON.stringify(result) + '\n');
        // Fail closed. Do not keep submitting programs after timeout/setup failure.
        if (result.status !== 'PASS') break;
    }
    const report = { checkedAt: new Date().toISOString(), noBrowser: true, noDraw: !probeDraw, pipelineProbe: probeDraw,
        watchdogMsPerProcess: 15000, requestedPrograms: selected, results: rows,
        status: rows.length === selected.length && rows.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL',
        limitation: probeDraw ? 'Synthetic 1x1 pipeline probes on CPU SwiftShader; not a complete renderer frame or performance/visual-fidelity certification.'
            : 'Compilation/link only on CPU SwiftShader; not a frame, GPU performance, or visual-fidelity certification.' };
    fs.mkdirSync(path.join(root, 'output'), { recursive: true });
    fs.writeFileSync(path.join(root, probeDraw ? 'output/anatomy-shader-probes.json' : 'output/anatomy-shader-validation.json'), JSON.stringify(report, null, 2));
    process.stdout.write(report.status + ': ' + rows.length + '/' + selected.length + ' native shader pairs checked.\n');
    return report.status === 'PASS' ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
});
module.exports = { collectSources, runProgram, main };
