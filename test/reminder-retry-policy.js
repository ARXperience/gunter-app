/* Focused Permission Gate checks using an isolated existing control-plane store. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-reminder-retry-policy-'));
process.env.GUNTER_CONTROL_DATA_DIR = testDir;
const skills = require('../server/control-plane/skills');
const brain = require('../server/control-plane/brain');
const entitlements = require('../server/control-plane/entitlements');
const userId = 'u_reminder_retry_policy_test';
const actor = { userId, role: 'user' };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

try {
    test('inspection is read-only and retry reuses jobs.write with maximum L3', () => {
        const read = skills.get('reminder.inspect'), write = skills.get('reminder.retry');
        assert.ok(read); assert.ok(write);
        assert.equal(read.entitlement, 'automation.basic'); assert.equal(read.risk, 'read');
        assert.equal(read.impact, 'READ_ONLY'); assert.equal(read.autonomyMax, 'L4');
        assert.deepEqual(read.permissions, []);
        assert.equal(write.entitlement, 'automation.basic'); assert.equal(write.risk, 'external_write');
        assert.equal(write.impact, 'EXTERNAL_SIDE_EFFECT'); assert.equal(write.autonomyMax, 'L3');
        assert.deepEqual(write.permissions, ['jobs.write']);
    });
    test('inspection can run without write confirmation even from voice', () => {
        const result = brain.plan(userId, { skill: 'reminder.inspect', autonomy: 'L4',
            confirmed: false, inputSource: 'voice' }, actor);
        assert.equal(result.ok, true); assert.equal(result.run.state, 'authorized');
        assert.equal(result.run.requiresConfirmation, false);
    });
    test('retry without confirmation is retained, and confirmed L3 is authorized', () => {
        const unconfirmed = brain.plan(userId, { skill: 'reminder.retry', autonomy: 'L3', confirmed: false }, actor);
        assert.equal(unconfirmed.ok, true); assert.equal(unconfirmed.authorization.error, 'confirmation_required');
        assert.equal(unconfirmed.run.state, 'waiting_confirmation'); assert.equal(unconfirmed.run.requiresConfirmation, true);
        const confirmed = brain.plan(userId, { skill: 'reminder.retry', autonomy: 'L3', confirmed: true }, actor);
        assert.equal(confirmed.ok, true); assert.equal(confirmed.run.state, 'authorized');
        assert.equal(confirmed.run.plan[0].skill, 'reminder.retry');
    });
    test('automatic L4 retry is rejected even when confirmed', () => {
        const result = brain.plan(userId, { skill: 'reminder.retry', autonomy: 'L4', confirmed: true }, actor);
        assert.equal(result.ok, false); assert.equal(result.error, 'autonomy_exceeds_skill_policy');
        assert.equal(result.run.state, 'failed');
    });
    test('verification requires reread evidence and a persisted revision, not an arbitrary success object', () => {
        for (const evidence of [{}, { persistedId: 'job_test' },
            { persistedId: 'job_test', reconsulted: false, revision: 5 },
            { persistedId: 'job_test', reconsulted: true, revision: 0 },
            { persistedId: 'job_test', reconsulted: true, revision: '5' }]) {
            assert.equal(skills.verify('reminder.retry', { evidence, evidenceRef: 'no-bypass' }).verified, false);
        }
        assert.equal(skills.verify('reminder.retry', { evidence: {
            persistedId: 'job_test', reconsulted: true, revision: 5 } }).verified, true);
        assert.equal(skills.verify('reminder.inspect', { evidence: { persistedId: 'job_test' } }).verified, false);
        assert.equal(skills.verify('reminder.inspect', { evidence: {
            persistedId: 'job_test', reconsulted: true } }).verified, true);
    });
    test('missing entitlement blocks inspection and confirmed retry without changing policy', () => {
        assert.equal(entitlements.upsertPlan({ id: 'reminder-retry-denied', name: 'Sin automatización',
            features: { 'automation.basic': false } }, 'test').ok, true);
        assert.equal(entitlements.setSubscription({ userId, planId: 'reminder-retry-denied', state: 'ACTIVE' }, 'test').ok, true);
        for (const skill of ['reminder.inspect', 'reminder.retry']) {
            const result = brain.plan(userId, { skill, autonomy: 'L3', confirmed: true }, actor);
            assert.equal(result.ok, false); assert.equal(result.error, 'entitlement_required');
            assert.equal(result.run.state, 'failed');
        }
    });
    console.log(`reminder-retry-policy: PASS (${passed} checks)`);
} catch (error) {
    console.error(error.stack || error); process.exitCode = 1;
} finally {
    const resolved = path.resolve(testDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gunter-reminder-retry-policy-'));
    fs.rmSync(resolved, { recursive: true, force: true });
}
