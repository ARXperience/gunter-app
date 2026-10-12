/* Política focalizada de edición de recordatorios; almacenamiento temporal aislado. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-reminder-policy-'));
process.env.GUNTER_CONTROL_DATA_DIR = testDir;
const skills = require('../server/control-plane/skills');
const brain = require('../server/control-plane/brain');
const entitlements = require('../server/control-plane/entitlements');
const userId = 'u_reminder_policy_test';
const actor = { userId, role: 'user' };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

try {
    console.log('GUNTER REMINDER UPDATE POLICY');
    test('skill registrada reutiliza automation.basic y jobs.write con máximo L3', () => {
        const entry = skills.get('reminder.update');
        assert.ok(entry);
        assert.equal(entry.entitlement, 'automation.basic');
        assert.deepStrictEqual(entry.permissions, ['jobs.write']);
        assert.equal(entry.risk, 'external_write');
        assert.equal(entry.impact, 'EXTERNAL_SIDE_EFFECT');
        assert.equal(entry.autonomyMax, 'L3');
        assert.ok(entry.supportedNodes.includes('WEB'));
    });
    test('plan sin confirmación queda retenido y no autorizado', () => {
        const result = brain.plan(userId, { skill: 'reminder.update', autonomy: 'L3', confirmed: false }, actor);
        assert.equal(result.ok, true);
        assert.equal(result.authorization.error, 'confirmation_required');
        assert.equal(result.run.state, 'waiting_confirmation');
        assert.equal(result.run.requiresConfirmation, true);
        assert.equal(result.run.plan[0].state, 'awaiting_confirmation');
    });
    test('plan confirmado L3 se autoriza sin fallback de skill desconocida', () => {
        const result = brain.plan(userId, { skill: 'reminder.update', autonomy: 'L3', confirmed: true }, actor);
        assert.equal(result.ok, true);
        assert.equal(result.run.state, 'authorized');
        assert.equal(result.run.plan[0].skill, 'reminder.update');
    });
    test('L4 se rechaza aunque esté confirmado', () => {
        const result = brain.plan(userId, { skill: 'reminder.update', autonomy: 'L4', confirmed: true }, actor);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'autonomy_exceeds_skill_policy');
        assert.equal(result.run.state, 'failed');
    });
    test('falta de entitlement bloquea edición incluso confirmada', () => {
        assert.equal(entitlements.upsertPlan({ id: 'reminder-denied', name: 'Sin automatización', features: { 'automation.basic': false } }, 'test').ok, true);
        assert.equal(entitlements.setSubscription({ userId, planId: 'reminder-denied', state: 'ACTIVE' }, 'test').ok, true);
        const result = brain.plan(userId, { skill: 'reminder.update', autonomy: 'L3', confirmed: true }, actor);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'entitlement_required');
        assert.equal(result.run.state, 'failed');
    });
    test('historial operativo muestra Editar recordatorio', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'control-plane', 'activity.js'), 'utf8');
        const moduleStub = { exports: {} };
        const dependencies = {
            './workflows': { list: () => [] }, './brain': { list: () => [] },
            './nodes': { commandList: () => [{ id: 'command-test', skill: 'reminder.update', state: 'AUTHORIZED', requestedAt: '2026-10-12T12:00:00Z' }] },
            '../user-context': { runAs: (id, fn) => fn() }, '../jobs': { list: () => [] }
        };
        vm.runInNewContext(source, { module: moduleStub, require: name => {
            assert.ok(dependencies[name], `Dependencia inesperada: ${name}`);
            return dependencies[name];
        } });
        const entry = moduleStub.exports.list(userId).items[0];
        assert.equal(entry.title, 'Editar recordatorio');
        assert.equal(entry.detail, 'reminder.update');
    });
    test('verificación exige ID persistido, reconsulta real y revisión de edición', () => {
        for (const evidence of [{}, { persistedId: 'job_test' },
            { persistedId: 'job_test', reconsulted: false, revision: 2 },
            { persistedId: 'job_test', reconsulted: true, revision: 0 },
            { persistedId: 'job_test', reconsulted: true, revision: '2' },
            { reconsulted: true, revision: 2 }]) {
            assert.equal(skills.verify('reminder.update', { evidence, evidenceRef: 'no-bypass' }).verified, false);
        }
        const result = skills.verify('reminder.update', { evidence: { persistedId: 'job_test', reconsulted: true, revision: 2 } });
        assert.equal(result.verified, true);
        assert.equal(result.state, 'VERIFIED');
    });
    console.log(`═══ REMINDER UPDATE POLICY: ${passed} ✓ · 0 ✗ ═══`);
} catch (error) {
    console.error('  ✗', error.stack || error.message);
    process.exitCode = 1;
} finally {
    const resolved = path.resolve(testDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gunter-reminder-policy-'));
    fs.rmSync(resolved, { recursive: true, force: true });
}
