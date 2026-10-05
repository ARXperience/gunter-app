/* Optional live llama.cpp checks. Set GUNTER_LOCAL_MODEL_PATH and GUNTER_LLAMA_SERVER_PATH. */
const assert = require('node:assert/strict');
const net = require('node:net');
const local = require('../server/local-brain');
if (!process.env.GUNTER_LOCAL_MODEL_PATH || !process.env.GUNTER_LLAMA_SERVER_PATH) {
    console.log('LOCAL BRAIN LIVE: skipped (model/runtime paths not configured)');
    process.exit(0);
}
process.env.GUNTER_LOCAL_PORT ||= '18182';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const modelPath = process.env.GUNTER_LOCAL_MODEL_PATH;
    const runtimePath = process.env.GUNTER_LLAMA_SERVER_PATH;
    try {
        const started = Date.now();
        assert.equal((await local.start()).localBrainReady, true);
        assert.equal((await local.health()).localBrainModel, local.manifest.id);
        console.log(`load_ms=${Date.now() - started}`);
        const answer = await local.generate({ messages: [{ role: 'user', content: 'Responde solamente hola.' }], temperature: 0, max_tokens: 30 });
        assert.ok(answer.choices?.[0]?.message?.content);
        const controller = new AbortController();
        const cancelled = local.generate({ messages: [{ role: 'user', content: 'Escribe una novela larga de diez capítulos.' }], max_tokens: 2048 }, controller.signal);
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(cancelled, error => error.name === 'AbortError');
        console.log('cancel=ok');
        const pending = local.generate({ messages: [{ role: 'user', content: 'Cuenta de 1 a 2000 sin parar.' }], max_tokens: 2048 });
        setTimeout(() => process.kill(local.snapshot().pid), 500);
        await assert.rejects(pending);
        await delay(300);
        assert.equal((await local.health()).localBrainReady, false);
        assert.equal((await local.restart()).localBrainReady, true);
        console.log('crash_restart=ok');
        local.stop(); await delay(400);
        const occupied = net.createServer();
        await new Promise(resolve => occupied.listen(Number(process.env.GUNTER_LOCAL_PORT), '127.0.0.1', resolve));
        try { await assert.rejects(local.start(), error => error.code === 'LOCAL_PROVIDER_UNAVAILABLE' && error.cause === 'RUNTIME_PORT_BUSY'); }
        finally { await new Promise(resolve => occupied.close(resolve)); }
        console.log('port_busy=ok');
        process.env.GUNTER_LLAMA_SERVER_PATH = `${runtimePath}.missing`;
        await assert.rejects(local.start(), error => error.code === 'LOCAL_PROVIDER_UNAVAILABLE' && error.cause === 'RUNTIME_NOT_FOUND');
        process.env.GUNTER_LLAMA_SERVER_PATH = runtimePath;
        process.env.GUNTER_LOCAL_MODEL_PATH = `${modelPath}.missing`;
        await assert.rejects(local.start(), error => error.code === 'LOCAL_MODEL_NOT_INSTALLED');
        console.log('runtime_missing=ok model_missing=ok');
    } finally {
        process.env.GUNTER_LOCAL_MODEL_PATH = modelPath;
        process.env.GUNTER_LLAMA_SERVER_PATH = runtimePath;
        local.stop();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
