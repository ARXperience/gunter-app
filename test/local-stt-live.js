/* Optional local runtime verification. Paths point outside Git; no dataset is copied. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stt = require('../server/local-stt');

(async () => {
    if (!process.env.GUNTER_LOCAL_STT_MODEL_DIR || !process.env.GUNTER_LOCAL_STT_TEST_AUDIO)
        throw new Error('Set GUNTER_LOCAL_STT_MODEL_DIR and GUNTER_LOCAL_STT_TEST_AUDIO to external local paths');
    const before = Date.now();
    const health = await stt.health();
    assert.equal(health.localSTTReady, true, health.localSTTError || 'not ready');
    const modelDir = fs.realpathSync(process.env.GUNTER_LOCAL_STT_MODEL_DIR);
    const badModel = fs.mkdtempSync(path.join(path.dirname(modelDir), 'gunter-stt-hash-test-'));
    try {
        for (const name of Object.keys(stt.manifest.files)) {
            const source = path.join(modelDir, name), target = path.join(badModel, name);
            if (name === 'adapter.ort') fs.copyFileSync(source, target);
            else fs.linkSync(source, target); // never write through these links
        }
        const fd = fs.openSync(path.join(badModel, 'adapter.ort'), 'r+');
        try {
            const first = Buffer.alloc(1);
            fs.readSync(fd, first, 0, 1, 0);
            first[0] ^= 0xff;
            fs.writeSync(fd, first, 0, 1, 0);
        } finally { fs.closeSync(fd); }
        process.env.GUNTER_LOCAL_STT_MODEL_DIR = badModel;
        await assert.rejects(stt.verify(), error => error.code === stt.CODE.UNAVAILABLE && /MODEL_SHA256_MISMATCH/.test(error.cause));
    } finally {
        process.env.GUNTER_LOCAL_STT_MODEL_DIR = modelDir;
        if (path.dirname(badModel) === path.dirname(modelDir) && path.basename(badModel).startsWith('gunter-stt-hash-test-'))
            fs.rmSync(badModel, { recursive: true, force: true });
    }
    const audio = fs.readFileSync(process.env.GUNTER_LOCAL_STT_TEST_AUDIO);
    const text = await stt.transcribeAudio(audio, 'audio/wav');
    assert.ok(text.length >= 10, 'Human speech must be recognized');
    const silent = Buffer.alloc(44 + 16000 * 2);
    silent.write('RIFF', 0); silent.writeUInt32LE(silent.length - 8, 4); silent.write('WAVEfmt ', 8);
    silent.writeUInt32LE(16, 16); silent.writeUInt16LE(1, 20); silent.writeUInt16LE(1, 22);
    silent.writeUInt32LE(16000, 24); silent.writeUInt32LE(32000, 28); silent.writeUInt16LE(2, 32);
    silent.writeUInt16LE(16, 34); silent.write('data', 36); silent.writeUInt32LE(32000, 40);
    assert.equal(await stt.transcribeAudio(silent, 'audio/wav'), '');
    const tooLong = Buffer.alloc(44 + 121 * 32000);
    silent.copy(tooLong, 0, 0, 44);
    tooLong.writeUInt32LE(tooLong.length - 8, 4);
    tooLong.writeUInt32LE(tooLong.length - 44, 40);
    await assert.rejects(stt.transcribeAudio(tooLong, 'audio/wav'), error => error.code === stt.CODE.TOO_LARGE);
    await assert.rejects(stt.transcribeAudio(Buffer.from('not an audio file'), 'audio/wav'), error => error.code === stt.CODE.INVALID);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(stt.transcribeAudio(audio, 'audio/wav', { signal: aborted.signal }), error => error.name === 'AbortError');
    const interrupted = stt.transcribeAudio(audio, 'audio/wav');
    setTimeout(() => stt.stop(), 50);
    await assert.rejects(interrupted, error => error.code === stt.CODE.UNAVAILABLE);
    assert.equal((await stt.restart()).localSTTReady, true);
    console.log(`LOCAL STT LIVE: hash mismatch, human speech="${text}", VAD silence, invalid audio, cancel, stop/crash recovery, restart; total ${Date.now() - before} ms ✓`);
})().catch(error => { console.error(error); process.exitCode = 1; });
