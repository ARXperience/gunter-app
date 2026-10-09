/* Real route decision with a disposable flag store; never changes user settings. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-stt-routing-'));
process.env.GUNTER_CONTROL_DATA_DIR = temp;
const flags = require('../server/control-plane/feature-flags');
const router = require('../server/control-plane/model-router');
const stt = require('../server/local-stt');

(async () => {
    if (!process.env.GUNTER_LOCAL_STT_MODEL_DIR || !process.env.GUNTER_LOCAL_STT_TEST_AUDIO)
        throw new Error('Set external model and audio paths');
    assert.equal((await stt.health()).localSTTReady, true);
    assert.equal(router.resolveHybrid('stt', { mode: 'LOCAL' }).code, 'LOCAL_STT_UNAVAILABLE');
    assert.equal(flags.set('stt.local', { state: 'on' }, 'test').ok, true);
    for (const prefs of [{ mode: 'LOCAL', privacy: 'STANDARD' }, { mode: 'AUTO', privacy: 'LOCAL_ONLY' }]) {
        assert.equal(router.resolveHybrid('stt', prefs).provider, 'local');
        const output = await stt.transcribeAudio(fs.readFileSync(process.env.GUNTER_LOCAL_STT_TEST_AUDIO), 'audio/wav');
        assert.ok(output.length >= 10);
    }
    assert.equal(router.resolveHybrid('stt', { mode: 'CLOUD', privacy: 'STANDARD' }).provider, 'cloud');
    assert.equal(router.resolveHybrid('stt', { mode: 'AUTO', privacy: 'STANDARD' }).provider, 'cloud');
    console.log('LOCAL STT ROUTING: LOCAL, LOCAL_ONLY local-only; AUTO/CLOUD unchanged ✓');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    stt.stop();
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('gunter-stt-routing-'))
        fs.rmSync(temp, { recursive: true, force: true });
});
