/* Run browser E2E against a disposable Gunter server and isolated user data. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-e2e-'));
if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(tempRoot).startsWith('gunter-e2e-')) {
    throw new Error('Refusing to use an unexpected E2E data directory.');
}

function reservePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function waitForServer(baseUrl, child, getLogs) {
    const deadline = Date.now() + 45_000;
    return new Promise((resolve, reject) => {
        const check = async () => {
            if (child.exitCode !== null) return reject(new Error(`Gunter server exited (${child.exitCode}).\n${getLogs()}`));
            try {
                const response = await fetch(`${baseUrl}/api/health`);
                if (response.ok) return resolve();
            } catch { /* server is still starting */ }
            if (Date.now() >= deadline) return reject(new Error(`Gunter server did not become ready at ${baseUrl}.\n${getLogs()}`));
            setTimeout(check, 250).unref?.();
        };
        check();
    });
}

function stop(child) {
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 4000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
    });
}

async function main() {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const emptyEnvFile = path.join(tempRoot, 'empty.env');
    fs.writeFileSync(emptyEnvFile, '');
    const isolatedEnv = {
        ...process.env,
        DOTENV_CONFIG_PATH: emptyEnvFile,
        PORT: String(port),
        GUNTER_URL: baseUrl,
        GUNTER_DATA_DIR: path.join(tempRoot, 'data'),
        GUNTER_WHATSAPP_DATA_DIR: path.join(tempRoot, 'whatsapp-data'),
        GUNTER_WHATSAPP_SESSION_DIR: path.join(tempRoot, 'whatsapp-session'),
        GUNTER_BACKUP_DIR: path.join(tempRoot, 'backups'),
        GUNTER_CONTROL_DATA_DIR: path.join(tempRoot, 'data', 'control-plane'),
        GUNTER_DISABLE_BACKUPS: 'true',
        NODE_ENV: 'test'
    };
    // The E2E workflow must not contact configured AI, social, or push providers.
    for (const key of Object.keys(isolatedEnv)) {
        if (/(API_KEY|API_SECRET|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|VAPID|FCM|APNS|WHATSAPP_TOKEN)/i.test(key)) isolatedEnv[key] = '';
    }
    delete isolatedEnv.GUNTER_AUTH_DATA_DIR;

    let logs = '';
    const server = spawn(process.execPath, ['server.js'], { cwd: root, env: isolatedEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = chunk => { logs = (logs + chunk.toString()).slice(-12_000); };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
    let exitCode = 1;
    try {
        console.log(`Starting isolated Gunter server at ${baseUrl}`);
        await waitForServer(baseUrl, server, () => logs);
        const result = await new Promise((resolve, reject) => {
            const runner = spawn(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config=test/e2e/playwright.config.cjs'], {
                cwd: root,
                env: { ...isolatedEnv, GUNTER_BASE_URL: baseUrl, GUNTER_E2E_OUTPUT_DIR: path.join(tempRoot, 'playwright-results') },
                stdio: 'inherit'
            });
            runner.once('error', reject);
            runner.once('exit', code => resolve(code ?? 1));
        });
        exitCode = result;
        if (exitCode !== 0) {
            const artifacts = path.join(root, 'output', 'e2e-' + Date.now());
            fs.cpSync(path.join(tempRoot, 'playwright-results'), artifacts, { recursive: true });
            console.log('Failure artifacts preserved at ' + artifacts);
        }
    } finally {
        await stop(server);
        // This is the exact unique temp directory allocated above, never project/user data.
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    process.exitCode = exitCode;
}

main().catch(error => {
    console.error('E2E runner failed:', error);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* preserve the original error */ }
    process.exitCode = 1;
});
