/* Idempotent Web outbox receiver. Only explicitly allowlisted operations can be replayed. */
const store = require('./persistence');
const settings = require('./settings');

const MAX_BATCH = 50;
const MAX_RECEIPTS = 1000;
const CONTRACT_VERSION = 1;
const ACTIVE_OPERATIONS = Object.freeze(['settings.patch']);

function applyBatch(userId, input = {}, actor = {}) {
    const items = Array.isArray(input.items) ? input.items.slice(0, MAX_BATCH) : [];
    if (!items.length) return { ok: false, error: 'sync_items_required' };
    const data = load(userId);
    const results = [];
    for (const raw of items) {
        const operationId = token(raw?.operationId, 120);
        const idempotencyKey = token(raw?.idempotencyKey || operationId, 160);
        if (!operationId || !idempotencyKey) {
            results.push({ operationId: operationId || null, status: 'REJECTED', error: 'operation_identity_required' });
            continue;
        }
        const duplicate = data.receipts.find(item => item.idempotencyKey === idempotencyKey);
        if (duplicate) {
            results.push({ ...duplicate.result, duplicate: true });
            continue;
        }
        const result = applyOne(userId, raw, actor);
        results.push(result);
        if (['APPLIED', 'CONFLICT', 'REJECTED'].includes(result.status)) {
            data.receipts.push({ idempotencyKey, operationId, receivedAt: new Date().toISOString(), result });
        }
    }
    data.receipts = data.receipts.slice(-MAX_RECEIPTS);
    data.savedAt = new Date().toISOString();
    store.saveJson(fileFor(userId), data);
    return {
        ok: true, results,
        cursor: data.savedAt,
        stats: countResults(results)
    };
}

function applyOne(userId, item, actor) {
    const operationId = token(item.operationId, 120);
    const type = token(item.type, 80);
    if (item.contractVersion !== undefined && item.contractVersion !== CONTRACT_VERSION)
        return { operationId, status: 'REJECTED', error: 'unsupported_sync_contract' };
    if (!ACTIVE_OPERATIONS.includes(type)) return { operationId, status: 'REJECTED', error: 'operation_not_allowlisted' };
    const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {};
    const current = settings.list(userId, actor).find(setting => setting.key === payload.key);
    if (!current) return { operationId, status: 'REJECTED', error: 'setting_not_found' };
    const baseUpdatedAt = item.baseUpdatedAt || null;
    const conflict = baseUpdatedAt && current.updatedAt && baseUpdatedAt !== current.updatedAt;
    if (conflict && item.conflictPolicy !== 'client_wins') {
        return { operationId, status: 'CONFLICT', error: 'server_version_changed', serverValue: { key: current.key, enabled: current.enabled, advanced: current.advanced, updatedAt: current.updatedAt } };
    }
    const applied = settings.patch(userId, payload, actor);
    if (applied.ok === false) return { operationId, status: 'REJECTED', error: applied.error, reason: applied.reason || null };
    return { operationId, status: 'APPLIED', setting: applied.setting };
}

function status(userId) {
    const data = load(userId);
    return { cursor: data.savedAt, receipts: data.receipts.length, lastReceiptAt: data.receipts.at(-1)?.receivedAt || null };
}
function purge(userId) { const fs = require('fs'); const file = store.target(fileFor(userId)); if (fs.existsSync(file)) fs.unlinkSync(file); return true; }
function fileFor(userId) { return `sync-receipts-${store.hash(userId).slice(0, 20)}.json`; }
function load(userId) { const data = store.loadJson(fileFor(userId), { version: 1, receipts: [], savedAt: null }); if (!Array.isArray(data.receipts)) data.receipts = []; return data; }
function token(value, max) { return String(value || '').replace(/[^\p{L}\p{N}_.:@/-]/gu, '_').slice(0, max); }
function countResults(items) { return { total: items.length, applied: items.filter(item => item.status === 'APPLIED').length, duplicate: items.filter(item => item.duplicate).length, conflict: items.filter(item => item.status === 'CONFLICT').length, rejected: items.filter(item => item.status === 'REJECTED').length }; }

module.exports = { MAX_BATCH, CONTRACT_VERSION, ACTIVE_OPERATIONS, applyBatch, status, purge, _load: load };
