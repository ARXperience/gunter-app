/* Existing per-account commitment store. Global legacy data remains unassigned. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('../user-store');
const userContext = require('../user-context');
const SNAPSHOT_KEYS = Object.freeze(['id', 'ownerId', 'owner', 'beneficiary', 'action', 'context',
    'dueAt', 'projectId', 'source', 'channel', 'status', 'createdAt', 'updatedAt', 'revision']);
function filePath() { return path.join(userStore.userDir(userContext.currentUserId()), 'commitments.json'); }
function failure(code) { const error = new Error(code); error.code = code; return error; }
function loadAll() {
    try {
        const fp = filePath();
        if (!fs.existsSync(fp)) return [];
        const items = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
            throw failure('commitment_store_invalid');
        }
        return items;
    } catch (error) { throw failure(error.code === 'commitment_store_invalid' ? error.code : 'commitment_store_unavailable'); }
}
function saveAll(items) {
    const fp = filePath();
    const temporary = path.join(path.dirname(fp), `.commitments-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, fp);
    } catch {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* original stays intact */ }
        throw failure('commitment_persistence_failed');
    }
}
function owned(item) { return item && (item.ownerId == null || item.ownerId === userContext.currentUserId()); }
function revision(item) { return Number.isSafeInteger(item?.revision) && item.revision >= 0 ? item.revision : 0; }
function source(value) {
    const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const timestamp = typeof item.ts === 'number' && Number.isFinite(item.ts) && Number.isFinite(new Date(item.ts).getTime())
        ? item.ts : typeof item.ts === 'string' && item.ts.length <= 64 && Number.isFinite(Date.parse(item.ts)) ? item.ts : null;
    return { type: String(item.type || 'manual').slice(0, 40), refId: typeof item.refId === 'string' ? item.refId.slice(0, 160) : null,
        ts: timestamp };
}
function view(item) {
    if (!owned(item)) return null;
    const status = item.status === 'pending' && item.dueAt && Date.parse(item.dueAt) < Date.now() ? 'overdue' : item.status || 'pending';
    return { id: item.id, ownerId: userContext.currentUserId(), owner: item.owner || 'unknown',
        beneficiary: item.beneficiary || 'unknown', action: item.action || '', context: item.context || '',
        dueAt: item.dueAt || null, projectId: item.projectId || null, source: source(item.source),
        channel: item.channel || null, status, createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null, revision: revision(item), fulfilledAt: item.fulfilledAt || null,
        cancelledAt: item.cancelledAt || null, fulfillmentNote: item.fulfillmentNote || '' };
}
function snapshot(item) {
    const current = view(item);
    if (!current) return null;
    return Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, current[key]]));
}
function snapshotValid(expected) {
    return Boolean(expected && typeof expected === 'object' && !Array.isArray(expected)
        && Object.keys(expected).length === SNAPSHOT_KEYS.length && SNAPSHOT_KEYS.every(key => Object.hasOwn(expected, key))
        && typeof expected.id === 'string' && typeof expected.ownerId === 'string'
        && typeof expected.action === 'string' && typeof expected.status === 'string'
        && Number.isSafeInteger(expected.revision) && expected.revision >= 0
        && expected.source && typeof expected.source === 'object' && !Array.isArray(expected.source)
        && Object.keys(expected.source).length === 3 && ['type', 'refId', 'ts'].every(key => Object.hasOwn(expected.source, key)));
}
function canonical(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('commitment_input_invalid');
    if (input.ownerId !== undefined && input.ownerId !== userContext.currentUserId()) throw failure('commitment_owner_mismatch');
    const action = typeof input.action === 'string' ? input.action.trim() : '';
    if (!action || action.length > 180) throw failure('commitment_action_invalid');
    if (input.dueAt != null && (typeof input.dueAt !== 'string' || !Number.isFinite(Date.parse(input.dueAt)))) throw failure('commitment_date_invalid');
    const now = new Date().toISOString();
    return { id: `cmt_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        ownerId: userContext.currentUserId(), owner: String(input.owner || 'unknown').slice(0, 120),
        beneficiary: String(input.beneficiary || 'unknown').slice(0, 120), action,
        context: String(input.context || '').slice(0, 600), source: source(input.source), dueAt: input.dueAt || null,
        createdAt: now, updatedAt: now, status: 'pending', revision: 1, fulfilledAt: null, cancelledAt: null,
        fulfillmentNote: '', channel: input.channel == null ? null : String(input.channel).slice(0, 40),
        projectId: input.projectId == null ? null : String(input.projectId).slice(0, 160) };
}
function addBulk(inputs) {
    if (!Array.isArray(inputs) || inputs.length > 100) throw failure('commitment_input_invalid');
    const incoming = inputs.map(normalize); // Validate the complete batch before reading/writing.
    const items = loadAll();
    const created = [];
    let changed = false;
    for (const item of incoming) {
        const duplicate = items.find(existing => owned(existing)
            && ['pending', 'overdue'].includes(existing.status || 'pending')
            && existing.owner === item.owner && String(existing.action || '').toLowerCase() === item.action.toLowerCase()
            && (existing.dueAt || null) === item.dueAt && (existing.projectId || null) === item.projectId
            && Math.abs(Date.parse(existing.createdAt) - Date.parse(item.createdAt)) < 86400000);
        if (duplicate) created.push(view(duplicate));
        else { items.push(item); created.push(view(item)); changed = true; }
    }
    if (changed) saveAll(items);
    return created;
}
function add(input) { return addBulk([input])[0]; }
function get(id) { return view(loadAll().find(item => item.id === id && owned(item))); }
function mutate(input, operation) {
    const { id, ownerId, expected, confirmed } = input || {};
    if (ownerId !== userContext.currentUserId()) return { ok: false, error: 'commitment_owner_mismatch' };
    if (confirmed !== true) return { ok: false, error: 'commitment_confirmation_required' };
    if (!snapshotValid(expected) || expected.id !== id || expected.ownerId !== ownerId) return { ok: false, error: 'commitment_snapshot_invalid' };
    const items = loadAll();
    const index = items.findIndex(item => item.id === id && owned(item));
    if (index < 0) return { ok: false, error: 'commitment_not_found' };
    if (canonical(snapshot(items[index])) !== canonical(expected)) return { ok: false, error: 'commitment_changed' };
    if (operation !== 'remove' && !['pending', 'overdue'].includes(view(items[index]).status)) return { ok: false, error: 'commitment_not_pending' };
    if (operation === 'remove') { items.splice(index, 1); saveAll(items); return { ok: true, id }; }
    const now = new Date().toISOString();
    items[index] = { ...items[index], ownerId, status: operation, updatedAt: now, revision: revision(items[index]) + 1,
        fulfillmentNote: String(operation === 'fulfilled' ? input.note || '' : input.reason || '').slice(0, 600),
        ...(operation === 'fulfilled' ? { fulfilledAt: now } : { cancelledAt: now }) };
    saveAll(items);
    return { ok: true, item: view(items[index]) };
}
function list({ status = null, owner = null, projectId = null, limit = 200 } = {}) {
    let items = loadAll().filter(owned).map(view);
    if (status) items = items.filter(item => item.status === status);
    if (owner) items = items.filter(item => item.owner === owner);
    if (projectId) items = items.filter(item => item.projectId === projectId);
    const order = { overdue: 0, pending: 1, fulfilled: 2, cancelled: 3 };
    items.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5)
        || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity));
    return items.slice(0, Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 200)));
}
function stats() {
    const items = loadAll().filter(owned).map(view);
    const byStatus = { pending: 0, overdue: 0, fulfilled: 0, cancelled: 0 };
    for (const item of items) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    return { total: items.length, byStatus, oldestPendingAt: items.filter(item => item.status === 'pending')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]?.createdAt || null };
}
module.exports = { add, addBulk, get, list, stats, snapshot,
    markFulfilled: input => mutate(input, 'fulfilled'), markCancelled: input => mutate(input, 'cancelled'),
    remove: input => mutate(input, 'remove'), clear: () => ({ ok: false, error: 'commitment_bulk_confirmation_required' }),
    recomputeOverdue: () => 0, _loadAll: loadAll };
