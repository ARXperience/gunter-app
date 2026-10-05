/* Deterministic LocalBrain boundaries; optional live tests are separate. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-local-brain-'));
process.env.GUNTER_CONTROL_DATA_DIR = path.join(temp, 'control');
process.env.GUNTER_LOCAL_MODEL_PATH = path.join(temp, 'missing.gguf');
process.env.GUNTER_LLAMA_SERVER_PATH = path.join(temp, 'missing.exe');
const local = require('../server/local-brain');
const router = require('../server/control-plane/model-router');
const flags = require('../server/control-plane/feature-flags');
(async () => {
    try {
        assert.equal(local.installed(), false);
        assert.equal(local.snapshot().localBrainReady, false);
        assert.equal(router.resolveHybrid('chat', { mode: 'AUTO' }).provider, 'cloud');
        assert.equal(router.resolveHybrid('chat', { mode: 'CLOUD', privacy: 'STANDARD' }).provider, 'cloud');
        assert.equal(router.resolveHybrid('chat', { mode: 'LOCAL' }).code, 'LOCAL_MODEL_NOT_INSTALLED');
        assert.equal(router.resolveHybrid('chat', { mode: 'AUTO', privacy: 'LOCAL_ONLY' }).ok, false);
        assert.equal(router.resolveHybrid('tts', { mode: 'AUTO', privacy: 'LOCAL_ONLY' }).ok, false);
        assert.equal(router.resolveHybrid('chat', { mode: 'LOCAL' }).provider, 'local');
        assert.equal(flags.set('ai.local', { state: 'on' }).ok, true);
        assert.equal(router.resolveHybrid('chat', { mode: 'LOCAL' }).code, 'LOCAL_MODEL_NOT_INSTALLED');
        await assert.rejects(local.start(), error => error.code === 'LOCAL_MODEL_NOT_INSTALLED');
        const safe = local.validateProposal({ intent: 'propose', tool: 'add_task', args: { title: 'Prueba' }, answer: 'Puedo crearla.' });
        assert.equal(safe.ok, true); assert.equal(safe.executed, false); assert.equal(safe.requiresPermissionGate, true);
        assert.equal(local.validateProposal({ intent: 'propose', tool: 'delete_file', args: {}, answer: '' }).ok, false);
        assert.equal(local.validateProposal({ intent: 'propose', tool: 'send_message', args: { recipient: 'Ana', text: 'Hola' }, answer: 'Enviado' }).ok, false);
        assert.equal(local.validateProposal({ intent: 'confirm', tool: 'send_message', args: { recipient: 'Ana', text: 'Hola' }, answer: '¿Confirmas?' }).executed, false);
        fs.writeFileSync(process.env.GUNTER_LOCAL_MODEL_PATH, 'corrupt');
        assert.equal(local.installed(), true);
        assert.equal(flags.set('ai.local', { state: 'off' }).ok, true);
        assert.equal(router.resolveHybrid('chat', { mode: 'AUTO', privacy: 'LOCAL_ONLY' }).code, 'LOCAL_PROVIDER_UNAVAILABLE');
        assert.equal(flags.set('ai.local', { state: 'on' }).ok, true);
        assert.equal(router.resolveHybrid('chat', { mode: 'LOCAL' }).provider, 'local');
        await assert.rejects(local.start(), error => error.code === 'LOCAL_PROVIDER_UNAVAILABLE');
        assert.equal(local.snapshot().localBrainReady, false);
        assert.equal(local.stop().localBrainReady, false);
        console.log('LOCAL BRAIN CORE: modes, absence, corrupt model, proposal gate ✓');
    } finally {
        local.stop();
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
