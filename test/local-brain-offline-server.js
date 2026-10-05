/* Authenticated LOCAL_ONLY integration while Gunter's process has HTTP(S) egress denied. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
if (!process.env.GUNTER_LOCAL_MODEL_PATH || !process.env.GUNTER_LLAMA_SERVER_PATH) {
    console.log('LOCAL_ONLY OFFLINE SERVER: skipped (model/runtime paths not configured)');
    process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-local-only-'));
const port = 33184;
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), GUNTER_LOCAL_PORT: '18185', GUNTER_DISABLE_BACKUPS: 'true',
    GUNTER_DATA_DIR: path.join(temp, 'data'), GUNTER_CONTROL_DATA_DIR: path.join(temp, 'control'),
    GUNTER_BACKUP_DIR: path.join(temp, 'backup') };
const server = spawn(process.execPath, ['-r', path.join(__dirname, 'deny-external-egress.js'), path.join(__dirname, '..', 'server.js')],
    { cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', value => { output = (output + value).slice(-2000); });
server.stderr.on('data', value => { output = (output + value).slice(-2000); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url, method = 'GET', body, cookie) {
    const response = await fetch(`${base}${url}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() };
}
(async () => {
    try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
            if (server.exitCode !== null) throw new Error(`server exited: ${output}`);
            try { const result = await json('/api/auth/setup-status'); if (result.status === 200) { ready = true; break; } } catch {}
            await sleep(100);
        }
        assert.equal(ready, true, output);
        const registered = await json('/api/auth/register', 'POST', { username: 'offline-test', password: 'OfflineTest#2026' });
        assert.equal(registered.status, 200);
        const cookie = registered.cookie;
        assert.equal((await json('/api/control/flags', 'POST', { key: 'ai.local', state: 'on' }, cookie)).status, 200);
        assert.equal((await json('/api/control/hybrid/mode', 'POST', { mode: 'LOCAL', privacy: 'LOCAL_ONLY' }, cookie)).status, 200);
        const answer = await json('/api/chat', 'POST', { messages: [
            { role: 'user', content: 'Mi palabra clave es arándano.' },
            { role: 'assistant', content: 'Entendido.' },
            { role: 'user', content: '¿Cuál es mi palabra clave? Responde solo la palabra.' }
        ], temperature: 0, max_tokens: 40 }, cookie);
        assert.equal(answer.status, 200, JSON.stringify(answer.body));
        assert.equal(answer.body.model, 'ministral-3:3b');
        assert.match(answer.body.choices?.[0]?.message?.content || '', /arándano/i);
        for (const route of ['/api/gemini-text', '/api/gemini-image', '/api/document-extract',
            '/api/premium-intel', '/api/premium-intel/actions', '/api/style-mirror', '/api/forecast', '/api/tutor']) {
            const denied = await json(route, 'POST', {}, cookie);
            assert.equal(denied.status, 503, route);
            assert.equal(denied.body.code, 'LOCAL_ONLY_MODE', route);
        }
        for (const route of ['/api/transcribe', '/api/tts', '/api/embeddings']) {
            const denied = await json(route, 'POST', {}, cookie);
            assert.equal(denied.status, 503, route);
            assert.equal(denied.body.code, 'LOCAL_PROVIDER_NOT_INSTALLED', route);
        }
        const status = await json('/api/control/hybrid/status', 'GET', null, cookie);
        assert.equal(status.body.data.localBrainReady, true);
        console.log('LOCAL_ONLY OFFLINE SERVER: authenticated local text/context passed; 11 cloud routes denied; external HTTP(S) blocked');
    } finally {
        server.kill(); await sleep(500);
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
