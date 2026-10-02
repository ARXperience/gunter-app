/* Persistent Web Push delivery for reminders while the web app is closed. */
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const store = require('./store');

const MAX_PAYLOAD_BYTES = 3500;

function keysPath() { return path.join(process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'system-secrets', 'web-push-vapid.json'); }
function keys() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    const target = keysPath();
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { /* Generate once for this installation. */ }
    const generated = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(generated, null, 2), { mode: 0o600 });
    return generated;
}
function configure() {
    const vapid = keys();
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notifications@gunter.local', vapid.publicKey, vapid.privateKey);
    return vapid;
}
function publicKey() { return configure().publicKey; }
function validateSubscription(input) {
    const subscription = input?.subscription || input;
    const endpoint = String(subscription?.endpoint || '').trim();
    const p256dh = String(subscription?.keys?.p256dh || '').trim();
    const auth = String(subscription?.keys?.auth || '').trim();
    if (!endpoint.startsWith('https://') || !p256dh || !auth) return { ok: false, error: 'push_subscription_invalid' };
    if (endpoint.length > 2048 || p256dh.length > 512 || auth.length > 512) return { ok: false, error: 'push_subscription_invalid' };
    return { ok: true, subscription: { endpoint, expirationTime: Number.isFinite(subscription.expirationTime) ? subscription.expirationTime : null, keys: { p256dh, auth } } };
}
function subscribe(input, metadata = {}) {
    const checked = validateSubscription(input);
    if (!checked.ok) return checked;
    return { ok: true, device: store.upsert(checked.subscription, metadata) };
}
function unsubscribe(input = {}) {
    return { ok: true, removed: store.remove(input.endpoint || input.id) };
}
function status() { return { supported: true, configured: Boolean(publicKey()), devices: store.load().map(store.publicItem) }; }
async function deliver(payload = {}, options = {}) {
    configure();
    const body = JSON.stringify({
        title: String(payload.title || 'Gunter').slice(0, 100),
        body: String(payload.body || payload.message || '').slice(0, 500),
        tag: String(payload.tag || `gunter-${Date.now()}`).slice(0, 120),
        url: safeUrl(payload.url),
        priority: ['low', 'normal', 'high', 'urgent'].includes(payload.priority) ? payload.priority : 'normal',
        data: payload.data && typeof payload.data === 'object' ? payload.data : {}
    });
    if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) throw new Error('push_payload_too_large');
    const sender = options._sender || webpush.sendNotification;
    const devices = store.load(); const outcomes = [];
    for (const device of devices) {
        try {
            await sender(device.subscription, body, { TTL: 60 * 60, urgency: payload.priority === 'urgent' ? 'high' : 'normal' });
            store.update(device.id, { lastDeliveredAt: new Date().toISOString(), failures: 0 });
            outcomes.push({ id: device.id, delivered: true });
        } catch (error) {
            const statusCode = Number(error?.statusCode || 0);
            if ([404, 410].includes(statusCode)) store.remove(device.id);
            else store.update(device.id, { failures: Number(device.failures || 0) + 1 });
            outcomes.push({ id: device.id, delivered: false, expired: [404, 410].includes(statusCode), error: statusCode || 'push_delivery_failed' });
        }
    }
    return { attempted: devices.length, delivered: outcomes.filter(item => item.delivered).length, outcomes };
}
function safeUrl(value) {
    const raw = String(value || '/day.html#reminders');
    return raw.startsWith('/') && !raw.startsWith('//') ? raw.slice(0, 500) : '/day.html#reminders';
}

module.exports = { publicKey, subscribe, unsubscribe, status, deliver, validateSubscription, _store: store, _keys: keys };
