/* Supertonic 3 routing and safety contract; no weights or live synthesis needed. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-tts-core-'));
process.env.GUNTER_CONTROL_DATA_DIR = path.join(temp, 'control');
process.env.GUNTER_DATA_DIR = path.join(temp, 'data');
process.env.GUNTER_LOCAL_TTS_MODEL_DIR = path.join(temp, 'model');
const flags = require('../server/control-plane/feature-flags');
const router = require('../server/control-plane/model-router');
const tts = require('../server/local-tts');

(async () => {
    assert.equal(tts.installed(), false);
    assert.equal(router.resolveHybrid('tts', { mode: 'LOCAL' }).code, 'LOCAL_TTS_NOT_INSTALLED');
    assert.equal(router.resolveHybrid('tts', { mode: 'AUTO', privacy: 'LOCAL_ONLY' }).code, 'LOCAL_TTS_NOT_INSTALLED');
    assert.equal(router.resolveHybrid('tts', { mode: 'AUTO', privacy: 'STANDARD' }).provider, 'cloud');

    for (const name of ['onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx',
        'onnx/vocoder.onnx', 'onnx/tts.json', 'onnx/unicode_indexer.json', 'voice_styles/M1.json']) {
        const file = path.join(process.env.GUNTER_LOCAL_TTS_MODEL_DIR, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'fixture');
    }
    assert.equal(tts.installed(), true);
    assert.equal(router.resolveHybrid('tts', { mode: 'LOCAL' }).code, 'LOCAL_TTS_UNAVAILABLE');
    assert.equal(flags.set('tts.local', { state: 'on' }, 'test').ok, true);
    for (const prefs of [{ mode: 'LOCAL' }, { mode: 'AUTO', privacy: 'LOCAL_ONLY' }, { mode: 'AUTO', privacy: 'STANDARD' }])
        assert.equal(router.resolveHybrid('tts', prefs).provider, 'local');
    assert.equal(router.resolveHybrid('tts', { mode: 'CLOUD', privacy: 'STANDARD' }).provider, 'cloud');
    assert.equal(router.hybridInventory().tts.local.model, 'Supertone/supertonic-3 · M1 · es');
    await assert.rejects(tts.synthesizeSpeech({ text: '' }), error => error.code === 'LOCAL_TTS_INVALID_TEXT');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(tts.synthesizeSpeech({ text: 'Hola', signal: aborted.signal }), error => error.name === 'AbortError');
    console.log('LOCAL TTS CORE: installation, routing, privacy, validation and abort ✓');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('gunter-tts-core-'))
        fs.rmSync(resolved, { recursive: true, force: true });
});
