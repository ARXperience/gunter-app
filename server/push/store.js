/* Web Push subscriptions are private, per-user runtime data. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('../user-store');

function filePath() { return userStore.userFile('push-subscriptions.json'); }
function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
        return Array.isArray(parsed.items) ? parsed.items : [];
    } catch { return []; }
}
function save(items) {
    const target = filePath();
    const temp = path.join(path.dirname(target), `.push-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify({ items, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    try { fs.renameSync(temp, target); }
    catch { fs.copyFileSync(temp, target); fs.unlinkSync(temp); }
}
function idFor(endpoint) { return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24); }
function upsert(subscription, metadata = {}) {
    const items = load();
    const id = idFor(subscription.endpoint);
    const current = items.find(item => item.id === id);
    const value = {
        id, subscription,
        deviceLabel: String(metadata.deviceLabel || current?.deviceLabel || 'Este dispositivo').trim().slice(0, 100),
        userAgent: String(metadata.userAgent || current?.userAgent || '').slice(0, 300),
        createdAt: current?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        lastDeliveredAt: current?.lastDeliveredAt || null, failures: 0
    };
    const next = items.filter(item => item.id !== id); next.push(value); save(next.slice(-20));
    return publicItem(value);
}
function remove(endpointOrId) {
    const items = load();
    const id = String(endpointOrId || '').startsWith('http') ? idFor(String(endpointOrId)) : String(endpointOrId || '');
    const next = items.filter(item => item.id !== id);
    if (next.length !== items.length) save(next);
    return next.length !== items.length;
}
function update(id, patch) {
    const items = load(); const index = items.findIndex(item => item.id === id);
    if (index < 0) return null;
    items[index] = { ...items[index], ...patch, id: items[index].id, updatedAt: new Date().toISOString() };
    save(items); return items[index];
}
function publicItem(item) { return { id: item.id, deviceLabel: item.deviceLabel, createdAt: item.createdAt, updatedAt: item.updatedAt, lastDeliveredAt: item.lastDeliveredAt, failures: item.failures || 0 }; }

module.exports = { load, upsert, remove, update, publicItem, _save: save, _idFor: idFor };
