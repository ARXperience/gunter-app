/* Run Gunter's tests against disposable storage and an isolated HTTP port. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-test-run-'));
const tempPath = path.resolve(tempRoot);
const allowedTempRoot = path.resolve(os.tmpdir()) + path.sep;
if (!tempPath.startsWith(allowedTempRoot) || !path.basename(tempPath).startsWith('gunter-test-run-')) {
    throw new Error('Refusing to use an unexpected test data directory.');
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

async function main() {
    const port = await reservePort();
    const env = {
        ...process.env,
        PORT: String(port),
        GUNTER_URL: `http://127.0.0.1:${port}`,
        GUNTER_DATA_DIR: path.join(tempRoot, 'data'),
        GUNTER_WHATSAPP_DATA_DIR: path.join(tempRoot, 'whatsapp-data'),
        GUNTER_WHATSAPP_SESSION_DIR: path.join(tempRoot, 'whatsapp-session'),
        GUNTER_BACKUP_DIR: path.join(tempRoot, 'backups'),
        GUNTER_CONTROL_DATA_DIR: path.join(tempRoot, 'data', 'control-plane'),
        GUNTER_DISABLE_BACKUPS: 'true'
    };
    delete env.GUNTER_AUTH_DATA_DIR;
    const all = [
        'auth-security.js', 'ui-contracts.js', 'api-base.js', 'preflight-guard.js', 'assistant-core.js', 'jobs-core.js', 'control-plane-core.js',
        'gunter-node.js', 'mobile-runtime.js', 'mobile-push.js', 'run-smoke.js'
    ];
    const suites = process.argv.includes('--smoke-only') ? ['run-smoke.js'] : all;

    try {
        for (const suite of suites) {
            const script = suite === 'run-smoke.js'
                ? path.join(root, 'test', suite)
                : path.join(root, 'test', suite);
            console.log(`\n── ${suite} (isolated data) ──`);
            const result = spawnSync(process.execPath, [script], { cwd: root, env, stdio: 'inherit' });
            if (result.error) throw result.error;
            if (result.status !== 0) {
                process.exitCode = result.status || 1;
                break;
            }
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error('Test runner failed:', error);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* retain the original failure */ }
    process.exitCode = 1;
});
