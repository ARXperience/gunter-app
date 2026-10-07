/* Audio -> Moonshine -> text -> Ministral, with every non-loopback fetch denied. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const stt = require('../server/local-stt');
const brain = require('../server/local-brain');
const nativeFetch = global.fetch;
let externalRequests = 0;
global.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        externalRequests++;
        throw new Error('EXTERNAL_EGRESS_BLOCKED');
    }
    return nativeFetch(input, init);
};

(async () => {
    if (!process.env.GUNTER_LOCAL_STT_MODEL_DIR || !process.env.GUNTER_LOCAL_STT_TEST_AUDIO)
        throw new Error('Set external GUNTER_LOCAL_STT_MODEL_DIR and GUNTER_LOCAL_STT_TEST_AUDIO');
    const started = Date.now();
    const wav = fs.readFileSync(process.env.GUNTER_LOCAL_STT_TEST_AUDIO);
    const transcript = await stt.transcribeAudio(wav, 'audio/wav');
    assert.ok(transcript.length >= 10);
    const result = await brain.generate({ messages: [
        { role: 'system', content: 'Eres Gunter. Responde en español y solo en texto. No ejecutes acciones.' },
        { role: 'user', content: `Escuché: "${transcript}". Responde brevemente sobre lo que dijo.` }
    ], temperature: 0, max_tokens: 100 });
    const reply = result.choices?.[0]?.message?.content || '';
    assert.ok(reply.length > 5);
    assert.equal(externalRequests, 0);
    console.log(`LOCAL STT OFFLINE: transcript="${transcript}"; reply="${reply.slice(0, 120)}"; external fetches=0; total ${Date.now() - started} ms ✓`);
})().catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => { brain.stop(); stt.stop(); global.fetch = nativeFetch; });
