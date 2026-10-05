/* Hybrid foundation contract tests; all state lives in a disposable temp dir. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-hybrid-'));
process.env.GUNTER_DATA_DIR = path.join(temp, 'data');
process.env.GUNTER_CONTROL_DATA_DIR = path.join(temp, 'control');
process.env.GUNTER_BACKUP_DIR = path.join(temp, 'backups');
process.env.GUNTER_LOCAL_MODEL_URL = 'http://127.0.0.1:9999';
const settings = require('../server/control-plane/settings');
const router = require('../server/control-plane/model-router');
const flags = require('../server/control-plane/feature-flags');
const skills = require('../server/control-plane/skills');
const sync = require('../server/control-plane/sync');
const backup = require('../server/backup');
const user = 'u_hybrid_test';
try {
    assert.deepEqual(settings.hybridStatus(user), { mode: 'AUTO', privacy: 'STANDARD', updatedAt: null });
    assert.equal(router.resolveHybrid('chat', settings.hybridStatus(user)).provider, 'cloud');
    assert.equal(router.inventory().find(provider => provider.id === 'local.fast').available, false);
    assert.equal(settings.patchHybrid(user, { mode: 'LOCAL', privacy: 'LOCAL_ONLY' }).ok, true);
    for (const kind of router.HYBRID_CAPABILITIES) {
        assert.equal(router.resolveHybrid(kind, settings.hybridStatus(user)).code, 'LOCAL_PROVIDER_NOT_INSTALLED');
        assert.equal(router.hybridInventory()[kind].local.status, 'NOT_INSTALLED');
    }
    assert.equal(settings.patchHybrid(user, { mode: 'INVALID' }).error, 'INVALID_HYBRID_MODE');
    assert.equal(settings.patchHybrid(user, { mode: 'LOCAL', privacy: 'STANDARD' }).ok, true);
    assert.equal(router.resolveHybrid('chat', settings.hybridStatus(user)).code, 'LOCAL_MODEL_NOT_INSTALLED');
    assert.equal(settings.patchHybrid(user, { mode: 'AUTO', privacy: 'STANDARD' }).ok, true);
    for (const key of ['ai.local', 'stt.local', 'tts.local', 'embeddings.local', 'hybrid.routing'])
        assert.equal(flags.recordFor ? flags.recordFor(key).state : flags.evaluate(key).state, 'off');
    assert.equal(skills.authorizeProposal({ userId: user, skillName: 'not.a.skill', node: { nodeType: 'WEB' }, payload: {} }).error, 'skill_not_found');
    assert.equal(skills.authorizeProposal({ userId: user, skillName: 'agenda.list', node: { nodeType: 'WEB' }, payload: { constructor: { bad: true } } }).error, 'invalid_skill_arguments');
    assert.equal(skills.authorizeProposal({ userId: user, skillName: 'agenda.list', node: { nodeType: 'WEB' }, payload: [] }).error, 'invalid_skill_arguments');
    assert.equal(sync.CONTRACT_VERSION, 1);
    assert.deepEqual(sync.ACTIVE_OPERATIONS, ['settings.patch']);
    const rejected = sync.applyBatch(user, { items: [{ contractVersion: 2, operationId: 'v2', idempotencyKey: 'v2', type: 'settings.patch', payload: {} }] });
    assert.equal(rejected.results[0].error, 'unsupported_sync_contract');
    const manifest = backup.createTestManifest([{ name: 'fake.json', content: '{"ok":true}' }]);
    assert.equal(backup.validateTestManifest(manifest, [{ name: 'fake.json', content: '{"ok":true}' }]), true);
    assert.equal(backup.validateTestManifest(manifest, [{ name: 'fake.json', content: '{"ok":false}' }]), false);
    assert.equal(backup.inventory().browser.status, 'BROWSER_EXPORT_NOT_CONFIGURED');
    console.log('HYBRID FOUNDATION: 20+ assertions ✓');
} finally {
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('gunter-hybrid-'))
        fs.rmSync(resolved, { recursive: true, force: true });
}
