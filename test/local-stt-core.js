/* Deterministic Moonshine guard tests. No model, network or benchmark audio required. */
'use strict';
const assert = require('node:assert/strict');
const stt = require('../server/local-stt');
const router = require('../server/control-plane/model-router');
const flags = require('../server/control-plane/feature-flags');

(async () => {
    assert.equal(stt.manifest.modelArch, 4);
    assert.equal(stt.manifest.approval, 'APPROVED_FOR_TRANSCRIPTION_ONLY');
    assert.equal(stt.manifest.size, 121800392);
    await assert.rejects(stt.transcribeAudio(Buffer.alloc(0), 'audio/wav'), error => error.code === stt.CODE.INVALID);
    await assert.rejects(stt.transcribeAudio(Buffer.alloc(30 * 1024 * 1024 + 1), 'audio/wav'), error => error.code === stt.CODE.TOO_LARGE);
    await assert.rejects(stt.transcribeAudio(Buffer.from('abc'), 'application/octet-stream'), error => error.code === stt.CODE.INVALID);
    const prior = process.env.GUNTER_LOCAL_STT_MODEL_DIR;
    try {
        process.env.GUNTER_LOCAL_STT_MODEL_DIR = 'C:\\gunter-stt-model-definitely-missing';
        assert.equal(stt.installed(), false);
        await assert.rejects(stt.verify(), error => error.code === stt.CODE.MISSING);
        const local = router.resolveHybrid('stt', { mode: 'LOCAL', privacy: 'STANDARD' });
        const privateLocal = router.resolveHybrid('stt', { mode: 'AUTO', privacy: 'LOCAL_ONLY' });
        assert.equal(local.code, 'LOCAL_STT_NOT_INSTALLED');
        assert.equal(privateLocal.code, 'LOCAL_STT_NOT_INSTALLED');
        assert.equal(router.resolveHybrid('stt', { mode: 'CLOUD', privacy: 'STANDARD' }).provider, 'cloud');
        assert.equal(router.resolveHybrid('stt', { mode: 'AUTO', privacy: 'STANDARD' }).provider, 'cloud');
        assert.equal(flags.evaluate('stt.local').state, 'off');
    } finally {
        if (prior === undefined) delete process.env.GUNTER_LOCAL_STT_MODEL_DIR;
        else process.env.GUNTER_LOCAL_STT_MODEL_DIR = prior;
    }
    console.log('LOCAL STT CORE: guards, absent model, LOCAL/LOCAL_ONLY/CLOUD/AUTO, flag off ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
