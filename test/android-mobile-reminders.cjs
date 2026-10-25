/* Real pure-server policy and assistant routing, with no device or production stores. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const tools = require('../js/core/assistant-tools');
const context = { module: { exports: {} }, Buffer, require: name => name === './feature-flags'
    ? { evaluate: () => ({ enabled: true }) } : { check: () => ({ allowed: true }) } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/control-plane/skills.js'), 'utf8'), context);
const skills = context.module.exports;
const node = { nodeType: 'ANDROID', capabilities: ['mobile.reminders.read', 'mobile.reminders.write'] };
const permit = (skillName, payload, overrides = {}) => skills.authorizeProposal({ userId: 'fixture', node,
    skillName, payload, autonomy: 'L3', confirmed: true, ...overrides });

test('new local reminder skills are Android-only and capability-gated', () => {
    for (const suffix of ['list', 'update', 'cancel']) {
        const name = `mobile.reminders.${suffix}`;
        assert.equal(permit(name, {}, { node: { nodeType: 'IOS' } }).error, 'skill_not_supported_by_node');
        assert.equal(permit(name, {}, { node: { nodeType: 'ANDROID', capabilities: [] } }).error, 'skill_not_supported_by_runtime');
        assert.equal(permit(name, {}, { node: { nodeType: 'ANDROID', capabilities: ['mobile.reminders.write'] } }).error, 'skill_not_supported_by_runtime');
    }
});
test('list pagination is bounded to the report payload budget', () => {
    assert.equal(permit('mobile.reminders.list', {}).ok, true);
    assert.equal(permit('mobile.reminders.list', { offset: 20, limit: 20 }).ok, true);
    for (const payload of [{ limit: 21 }, { offset: -1 }, { offset: 0.5 }, { id: '' }, { id: 'bad\n' }])
        assert.equal(permit('mobile.reminders.list', payload).error, 'invalid_skill_arguments');
});
test('update and cancel require stable id and an integer expected revision', () => {
    const payload = { id: 'fixture-id', expectedRevision: 2, title: 'Prueba', runAt: '2027-01-01T15:00:00Z' };
    assert.equal(permit('mobile.reminders.update', payload).ok, true);
    assert.equal(permit('mobile.reminders.cancel', { id: payload.id, expectedRevision: 2 }).ok, true);
    for (const patch of [{ expectedRevision: 0 }, { expectedRevision: '2' }, { expectedRevision: 2.5 }, { title: '' }, { runAt: '2027-01-01T15:00:00' }])
        assert.equal(permit('mobile.reminders.update', { ...payload, ...patch }).error, 'invalid_skill_arguments');
});
test('mutations keep confirmation gates including voice; list is read-only', () => {
    assert.equal(permit('mobile.reminders.list', {}, { confirmed: false, inputSource: 'voice' }).ok, true);
    assert.equal(permit('mobile.reminders.cancel', { id: 'x', expectedRevision: 1 }, { confirmed: false }).error, 'confirmation_required');
    assert.equal(permit('mobile.reminders.cancel', { id: 'x', expectedRevision: 1 }, { confirmed: false, inputSource: 'voice' }).error, 'confirmation_required');
});
test('cancel verification demands real absence and both OS cancellation observations', () => {
    const evidence = { persistedId: 'fixture', absent: true, reconsulted: true, alarmCancelled: true, notificationCancelled: true };
    assert.equal(skills.verify('mobile.reminders.cancel', { evidence }).verified, true);
    assert.equal(skills.verify('mobile.reminders.cancel', { evidence }).limitation, 'absent_locally_not_delivery_history');
    for (const key of Object.keys(evidence)) assert.equal(skills.verify('mobile.reminders.cancel', { evidence: { ...evidence, [key]: false } }).verified, false);
    assert.equal(skills.verify('mobile.reminders.cancel', { evidence: { persistedId: 'legacy' } }).verified, false);
});
test('update verification is durable scheduling, never confirmed delivery', () => {
    const evidence = { persistedId: 'fixture', persisted: true, reconsulted: true, alarmScheduled: true, revision: 2 };
    assert.equal(skills.verify('mobile.reminders.update', { evidence }).verified, true);
    assert.equal(skills.verify('mobile.reminders.update', { evidence }).limitation, 'scheduled_locally_not_delivery_confirmed');
    for (const key of Object.keys(evidence)) assert.equal(skills.verify('mobile.reminders.update', { evidence: { ...evidence, [key]: false } }).verified, false);
    assert.equal(skills.verify('mobile.reminders.list', { evidence: { remindersRead: true, reconsulted: true } }).verified, true);
    assert.equal(skills.verify('mobile.reminders.list', { evidence: { remindersRead: true } }).verified, false);
});

function assistant(nodes) {
    const calls = [];
    const runtime = { GunterControlPlane: {
        nodes: async () => ({ items: nodes }),
        queueCommand: async input => { calls.push(input); return { command: { id: 'cmd-fixture' } }; },
        waitForCommand: async () => ({ state: 'VERIFIED', result: { items: [], nextOffset: null }, evidence: { remindersRead: true, reconsulted: true } })
    } };
    return { api: tools.create({ root: runtime }), calls };
}
test('explicit local-list request uses Android capability and reports only local scope', async () => {
    const { api, calls } = assistant([{ ...node, nodeId: 'fixture-android', state: 'ONLINE' }]);
    const response = await api.dispatch('muestra los recordatorios locales del celular');
    assert.equal(response.status, 'complete');
    assert.equal(calls[0].skill, 'mobile.reminders.list');
    assert.equal(calls[0].payload.limit, 20);
    assert.match(response.reply, /no certifica/i);
    assert.equal(api.detect('explícame qué son los recordatorios locales del celular'), null);
});
test('ambiguous devices and old runtimes do not get a guessed reminder target', async () => {
    for (const devices of [[{ ...node, nodeId: 'a', state: 'ONLINE' }, { ...node, nodeId: 'b', state: 'ONLINE' }], [{ nodeType: 'ANDROID', nodeId: 'old', state: 'ONLINE', capabilities: [] }]]) {
        const { api, calls } = assistant(devices);
        const response = await api.dispatch('lista los recordatorios locales del celular');
        assert.notEqual(response.status, 'complete');
        assert.equal(calls.length, 0);
    }
});

for (const action of ['update', 'cancel']) test(`${action} confirmation belongs to the initiating account and is cleared on account change`, () => {
    let account = 'account-a';
    const values = new Map([['gunter_pending_tool_v1', JSON.stringify({ toolId: `mobile.reminders.${action}`,
        actorId: account, createdAt: Date.now(), args: { id: 'fixture-private', title: 'Private fixture', expectedRevision: 1, nodeId: 'a' } })]]);
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const api = tools.create({ storage, root: { GunterAuth: { canAccessLocalData: () => true, getUser: () => ({ id: account }) } } });
    assert.equal(api.isContextualFollowUp('sí'), true);
    assert.equal(api.getPending().actorId, 'account-a');
    account = 'account-b';
    assert.equal(api.isContextualFollowUp('sí'), false);
    assert.equal(api.getPending(), null);
    assert.equal(storage.getItem('gunter_pending_tool_v1'), null);
});
