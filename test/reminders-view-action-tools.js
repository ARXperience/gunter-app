'use strict';
// Only the new guarded screen-to-tool integration; no model, audio or network.
const assert = require('node:assert/strict');
const tools = require('../js/core/assistant-tools');
const skills = require('../server/control-plane/skills');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const jobSnapshot = row => ({ id: row.id, type: row.type, title: row.title, runAt: row.runAt,
    priority: row.priority, status: row.status, updatedAt: row.updatedAt, revision: row.revision });
const localSnapshot = row => ({ id: row.id, title: row.title, fireAt: row.fireAt, status: row.status, updatedAt: row.updatedAt || null });
function fixture(local = false, extras = {}) {
    let owner = 'alice', trusted = true, readHook = null, backendError = null;
    const row = local ? { id: 'rem_local', ownerId: 'alice', title: 'Local con nombre propio', fireAt: '2026-12-12T15:00:00Z',
        status: 'scheduled', meta: { message: 'PRIVATE_PAYLOAD' }, createdAt: '2026-10-12T10:00:00Z', ...extras }
        : { id: 'job_one', type: 'reminder', title: 'Persistente con nombre propio', runAt: '2026-12-12T15:00:00Z', priority: 'normal',
            status: 'scheduled', attempts: 0, revision: 2, updatedAt: '2026-10-12T10:00:00Z', payload: { secret: 'PRIVATE_PAYLOAD' }, ...extras };
    const writes = [], storage = new Map(), plans = [], transitions = [];
    const get = async id => { if (readHook) await readHook(); return id === row.id ? clone(row) : null; };
    const jobs = { list: async () => local ? [] : [clone(row)], get,
        cancel: async () => { throw new Error('UNSAFE_LEGACY_FALLBACK'); },
        cancelReminder: async (id, guard) => {
            assert.equal(id, row.id); assert.equal(guard.ownerId, owner); assert.equal(guard.confirmed, true);
            assert.deepEqual(guard.expected, jobSnapshot(row));
            if (backendError) throw Object.assign(new Error(backendError), { code: backendError });
            writes.push(clone(guard)); Object.assign(row, { status: 'cancelled', revision: row.revision + 1, cancelledAt: new Date().toISOString() });
            return clone(row);
        } };
    const notifications = { list: async () => local ? [clone(row)] : [], get,
        cancel: async (id, guard) => {
            assert.equal(id, row.id); assert.equal(guard.ownerId, owner); assert.deepEqual(guard.expected, localSnapshot(row));
            if (backendError) throw Object.assign(new Error(backendError), { code: backendError });
            writes.push(clone(guard)); Object.assign(row, { status: 'cancelled', updatedAt: new Date().toISOString() }); return clone(row);
        } };
    const root = { GunterAuth: { canAccessLocalData: () => trusted, getUser: () => ({ id: owner }) },
        localStorage: { getItem: () => owner }, GunterControlPlane: {
            planTask: async input => { plans.push(clone(input)); return { run: { taskId: 'guarded_cancel', state: 'authorized' } }; },
            transitionTask: async input => { transitions.push(clone(input)); return {}; }
        } };
    const api = tools.create({ root, jobsService: jobs, notificationsService: notifications,
        storage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    return { api, row, jobs, notifications, root, writes, plans, transitions,
        setOwner: value => { owner = value; }, setTrusted: value => { trusted = value; },
        setReadHook: fn => { readHook = fn; }, setError: value => { backendError = value; } };
}
const strict = { inputSource: 'text', requireReminderGuard: true, viewRequestId: 'view:1' };
async function propose(f) {
    const result = await f.api.dispatch(`Cancela el recordatorio "${f.row.id}"`, strict);
    assert.equal(result.status, 'awaiting_confirmation', result.reply);
    assert.equal(result.intent, 'jobs.cancel'); assert.equal(f.writes.length, 0);
    const pending = f.api.getPending();
    assert.equal(pending.args.requireReminderGuard, true); assert.equal(pending.args.viewRequestId, 'view:1');
    assert.equal(pending.args.ownerId, 'alice'); assert.equal(pending.args.targetId, f.row.id);
    assert.doesNotMatch(JSON.stringify(pending), /PRIVATE_PAYLOAD/);
    return pending;
}
let count = 0;
async function check(name, run) { await run(); console.log(`PASS ${name}`); count++; }
(async () => {
    for (const local of [false, true]) {
        await check(`${local ? 'local' : 'durable'} screen cancellation uses only the guarded existing tool after confirmation`, async () => {
            const f = fixture(local); await propose(f);
            const result = await f.api.dispatch('confirmo');
            assert.equal(result.status, 'complete', result.reply); assert.equal(result.verified, true);
            assert.equal(f.writes.length, 1); assert.equal(f.row.status, 'cancelled');
            assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PAYLOAD/);
            assert.equal(f.plans[0].skill, 'jobs.cancel'); assert.equal(f.plans[0].autonomy, 'L3'); assert.equal(f.plans[0].confirmed, true);
            const evidence = f.transitions.find(item => item.state === 'verified').evidence;
            assert.equal(evidence.persistedId, f.row.id); assert.equal(evidence.reconsulted, true);
            assert.equal(skills.verify('jobs.cancel', { evidence }).verified, true);
        });
        await check(`${local ? 'local' : 'durable'} changed reminder proposal is rejected without mutation`, async () => {
            const f = fixture(local); await propose(f); f.row.title = 'Changed in another tab';
            const result = await f.api.dispatch('confirmo'); assert.notEqual(result.status, 'complete');
            assert.match(result.reply, /cambi[oó]|actualiza/i); assert.equal(f.writes.length, 0);
        });
        await check(`${local ? 'local' : 'durable'} switched account cannot confirm the previous screen action`, async () => {
            const f = fixture(local); await propose(f); f.setOwner('bob');
            const result = await f.api.dispatch('confirmo'); assert.notEqual(result.status, 'complete'); assert.equal(f.writes.length, 0);
            assert.equal(f.api.getPending(), null);
        });
    }
    await check('screen requires protected durable operation and never silently uses legacy cancel', async () => {
        const f = fixture(); delete f.jobs.cancelReminder;
        const result = await f.api.dispatch('Cancela el recordatorio "job_one"', strict);
        assert.equal(result.status, 'needs_input'); assert.match(result.reply, /protecci[oó]n|protegida/i); assert.equal(f.writes.length, 0);
    });
    await check('running, completed, failed, cancelled and linked reminders are not independently cancellable from this screen', async () => {
        for (const extras of [{ status: 'running' }, { status: 'completed' }, { status: 'failed' }, { status: 'cancelled' }, { payload: { eventLink: { eventId: 'event_own' } } }]) {
            const f = fixture(false, extras);
            const result = await f.api.dispatch('Cancela el recordatorio "job_one"', strict);
            assert.notEqual(result.status, 'awaiting_confirmation'); assert.equal(f.writes.length, 0);
        }
    });
    await check('voice confirmation cannot authorize screen cancellation', async () => {
        const f = fixture(); await propose(f);
        const result = await f.api.dispatch('sí', { inputSource: 'voice' });
        assert.equal(result.status, 'awaiting_confirmation'); assert.equal(f.writes.length, 0);
    });
    await check('an unknown sensitive service error is never echoed by the cancel tool', async () => {
        const f = fixture(); await propose(f); f.setError('Authorization=Bearer PRIVATE_PAYLOAD');
        const result = await f.api.dispatch('confirmo'); assert.notEqual(result.status, 'complete');
        assert.doesNotMatch(JSON.stringify(result), /Authorization=|PRIVATE_PAYLOAD/); assert.equal(f.writes.length, 0);
    });
    await check('Permission Gate failure prevents a confirmed screen request from mutating a reminder', async () => {
        const f = fixture(); f.root.GunterControlPlane.planTask = async () => { throw Object.assign(new Error('flag denied'), { code: 'feature_flag_disabled' }); };
        await propose(f); const result = await f.api.dispatch('confirmo');
        assert.notEqual(result.status, 'complete'); assert.equal(f.writes.length, 0);
    });
    await check('cancel skill is canonical L3, and its evidence must include a reread', () => {
        const entry = skills.get('jobs.cancel');
        assert.equal(entry.entitlement, 'automation.basic'); assert.equal(entry.autonomyMax, 'L3');
        assert.equal(entry.risk, 'external_write'); assert.deepEqual(entry.permissions, ['jobs.write']);
        assert.equal(skills.verify('jobs.cancel', { evidence: { persistedId: 'job_one' } }).verified, false);
    });
    await check('chat list reuses the same status-scoped snapshot as the view and only queries follow-ups separately', async () => {
        const f = fixture(); const calls = [];
        f.notifications.listSnapshot = async options => {
            assert.deepEqual(options.statuses, ['scheduled', 'running', 'retry_wait']);
            return { ownerId: 'alice', items: [{ ...clone(f.row), ownerId: 'alice', durable: true }], sources: { durable: { available: true } } };
        };
        f.jobs.list = async options => { assert.equal(options.type, 'follow_up'); calls.push(options.status); return []; };
        const result = await f.api.dispatch('mis recordatorios');
        assert.equal(result.status, 'complete'); assert.equal(result.result.items.length, 1);
        assert.equal(result.result.items[0].id, 'job_one');
        assert.deepEqual(calls, ['scheduled', 'running', 'retry_wait']);
    });
    await check('chat also discloses a failed local source instead of claiming a complete empty collection', async () => {
        const f = fixture(); f.jobs.list = async () => [];
        f.notifications.listSnapshot = async () => ({ ownerId: 'alice', items: [], sources: {
            durable: { available: true }, local: { available: false } }, limited: true });
        const result = await f.api.dispatch('mis recordatorios');
        assert.match(result.reply, /navegador|incompleta/i); assert.match(result.reply, /l[ií]mite/i);
        assert.equal(f.writes.length, 0);
    });
    console.log(`REMINDERS VIEW ACTION TOOLS: ${count} focused checks PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
