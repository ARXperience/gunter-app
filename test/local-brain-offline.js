/* Text-only offline proof: all HTTP(S) egress from this test process is denied except loopback. */
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const local = require('../server/local-brain');
if (!process.env.GUNTER_LOCAL_MODEL_PATH || !process.env.GUNTER_LLAMA_SERVER_PATH) {
    console.log('LOCAL BRAIN OFFLINE: skipped (model/runtime paths not configured)');
    process.exit(0);
}
process.env.GUNTER_LOCAL_PORT ||= '18184';
const nativeFetch = global.fetch;
const nativeHttp = http.request;
const nativeHttps = https.request;
let externalAttempts = 0;
function loopback(value) {
    try { return new URL(typeof value === 'string' ? value : value.url).hostname === '127.0.0.1'; }
    catch { return false; }
}
global.fetch = (input, init) => {
    if (!loopback(input)) { externalAttempts++; return Promise.reject(new Error('EGRESS_BLOCKED')); }
    return nativeFetch(input, init);
};
function blockedRequest() { externalAttempts++; throw new Error('EGRESS_BLOCKED'); }
http.request = function (url, ...args) { return loopback(url) ? nativeHttp.call(this, url, ...args) : blockedRequest(); };
https.request = blockedRequest;
(async () => {
    try {
        await assert.rejects(global.fetch('https://example.com'), /EGRESS_BLOCKED/);
        assert.equal((await local.start()).localBrainReady, true);
        const context = await local.generate({ messages: [
            { role: 'user', content: 'Mi palabra clave es arándano.' },
            { role: 'assistant', content: 'Entendido.' },
            { role: 'user', content: '¿Cuál es mi palabra clave? Responde solo la palabra.' }
        ], temperature: 0, max_tokens: 30 });
        assert.match(context.choices?.[0]?.message?.content || '', /arándano/i);
        const proposed = await local.propose([{ role: 'user', content: 'Crea una tarea llamada Comprar cuaderno.' }]);
        assert.equal(proposed.ok, true);
        assert.equal(proposed.proposal.tool, 'add_task');
        assert.equal(proposed.executed, false);
        console.log(`LOCAL BRAIN OFFLINE: text/context/proposal passed; external attempts blocked=${externalAttempts}`);
    } finally {
        local.stop(); global.fetch = nativeFetch; http.request = nativeHttp; https.request = nativeHttps;
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
