/* Arranca GUNTER para los smoke tests si no hay una instancia disponible. */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const base = process.env.GUNTER_URL || 'http://localhost:3001';
let server = null;

async function isUp() {
    try {
        const resp = await fetch(base + '/api/health');
        return resp.ok;
    } catch { return false; }
}

async function waitUntilUp() {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (await isUp()) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`El servidor no respondió en ${base} después de 30 segundos`);
}

function stopServer() {
    if (!server || server.killed) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        timer.unref?.();
        server.once('exit', () => { clearTimeout(timer); resolve(); });
        server.kill();
    });
}

(async () => {
    if (!(await isUp())) {
        server = spawn(process.execPath, ['server.js'], {
            cwd: root,
            env: { ...process.env, GUNTER_DISABLE_BACKUPS: 'true' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        server.stdout.on('data', chunk => process.stdout.write('[server] ' + chunk));
        server.stderr.on('data', chunk => process.stderr.write('[server] ' + chunk));
        await waitUntilUp();
    }

    const smoke = spawn(process.execPath, [path.join('test', 'smoke.js')], {
        cwd: root,
        env: process.env,
        stdio: 'inherit'
    });
    smoke.on('exit', async code => {
        await stopServer();
        process.exit(code ?? 1);
    });
})().catch(error => {
    console.error(error.message);
    void stopServer();
    process.exit(1);
});

process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });
