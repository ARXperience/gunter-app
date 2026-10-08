/* Optional live HTTP test: uses installed local model, isolated server data. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const localConfig = JSON.parse(fs.readFileSync(path.join(root, 'data', 'local-tts.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-tts-http-'));
let server;
function freePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
            const port = socket.address().port;
            socket.close(() => resolve(port));
        });
    });
}
async function waitForHealth(base, logs) {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (server.exitCode !== null) throw new Error('server_exited: ' + logs());
        try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('server_start_timeout: ' + logs());
}
(async () => {
    const port = await freePort();
    const dataDir = path.join(temp, 'data');
    const controlDir = path.join(temp, 'control');
    process.env.GUNTER_CONTROL_DATA_DIR = controlDir;
    const flags = require('../server/control-plane/feature-flags');
    assert.equal(flags.set('tts.local', { state: 'on' }, 'test').ok, true);
    let logTail = '';
    server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true,
        env: { ...process.env, PORT: String(port), GUNTER_DATA_DIR: dataDir, GUNTER_CONTROL_DATA_DIR: controlDir,
            GUNTER_BACKUP_DIR: path.join(temp, 'backups'),
            GUNTER_LOCAL_TTS_MODEL_DIR: localConfig.modelDir },
        stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = chunk => { logTail = (logTail + chunk.toString()).slice(-3000); };
    server.stdout.on('data', collect); server.stderr.on('data', collect);
    const base = `http://127.0.0.1:${port}`;
    await waitForHealth(base, () => logTail);
    const token = JSON.parse(fs.readFileSync(path.join(dataDir, 'service-token.json'), 'utf8')).token;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
        const status = await fetch(base + '/api/control/hybrid/status', { headers });
        assert.equal(status.status, 200);
        state = (await status.json()).data;
        if (state.providers.tts.local.status === 'READY') break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(state.providers.tts.local.status, 'READY');
    assert.equal(state.flags['tts.local'], true);

    const oversized = await fetch(base + '/api/tts', { method: 'POST', headers,
        body: JSON.stringify({ text: 'a'.repeat(5000) }) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'LOCAL_TTS_INVALID_TEXT');

    const started = Date.now();
    const response = await fetch(base + '/api/tts', { method: 'POST', headers,
        body: JSON.stringify({ text: 'Hola, soy Gunter. Revisé tus tareas y encontré algo importante que deberías ver.', localSpeed: 1.05 }) });
    const wav = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, wav.toString('utf8', 0, 300));
    assert.match(response.headers.get('content-type'), /^audio\/wav/);
    assert.equal(response.headers.get('x-gunter-tts-provider'), 'supertonic3.local');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.ok(wav.length > 10000);
    console.log(`LOCAL TTS HTTP: WAV ${wav.length} bytes; ${Date.now() - started} ms; provider local ✓`);

    const controller = new AbortController();
    const interrupted = fetch(base + '/api/tts', { method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ text: 'Voy a revisar cada asunto de tu agenda para organizar los próximos pasos con calma y explicarte lo que conviene hacer primero, sin perder ningún detalle importante de las tareas que siguen pendientes.' }) });
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(interrupted, error => error.name === 'AbortError');
    await new Promise(resolve => setTimeout(resolve, 400));
    const afterAbort = await fetch(base + '/api/tts', { method: 'POST', headers,
        body: JSON.stringify({ text: 'Listo.' }) });
    if (afterAbort.status !== 200) throw new Error(`after_abort_http_${afterAbort.status}: ${await afterAbort.text()}`);
    assert.equal(afterAbort.headers.get('x-gunter-tts-provider'), 'supertonic3.local');
    console.log('LOCAL TTS HTTP: interrupción cancela y la siguiente respuesta funciona ✓');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (server && server.exitCode === null) {
        server.kill();
        await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000); });
    }
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('gunter-tts-http-'))
        fs.rmSync(resolved, { recursive: true, force: true });
});
