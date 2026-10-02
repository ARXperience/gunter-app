/* Local Beeper Desktop bridge for personal Instagram and Messenger accounts. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const userStore = require('../user-store');
const persistence = require('./persistence');

const BASE_URL = 'http://127.0.0.1:23373';
const WS_URL = 'ws://127.0.0.1:23373/v1/ws';
const cache = new Map();
const sockets = new Map();
const reconnectTimers = new Map();
const syncTimes = new Map();

function credentialFile(userId) { return path.join(userStore.userDir(userId), 'beeper-connection.json'); }
function masterKey() {
    return crypto.createHash('sha256').update(persistence.getOrCreateSecret('beeper-credentials.key', 32)).digest();
}
function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), value: encrypted.toString('base64url') };
}
function decrypt(payload) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(payload.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64url')), decipher.final()]).toString('utf8');
}
function loadCredential(userId) {
    try {
        const file = credentialFile(userId);
        if (!fs.existsSync(file)) return null;
        const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { token: decrypt(stored.token), pairedAt: stored.pairedAt, consentVersion: stored.consentVersion };
    } catch { return null; }
}
function saveCredential(userId, token, consentVersion) {
    const file = credentialFile(userId);
    const temp = path.join(path.dirname(file), `.beeper-${process.pid}-${Date.now()}.tmp`);
    const stored = { token: encrypt(token), pairedAt: new Date().toISOString(), consentVersion };
    fs.writeFileSync(temp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.unlinkSync(temp); }
    return stored;
}

function emptySnapshot(userId, paired = false, state = paired ? 'node_offline' : 'node_required') {
    return { userId, paired, reachable: false, live: false, state, accounts: [], lastCheckedAt: null, lastError: null };
}
function snapshot(userId) {
    if (cache.has(userId)) return cache.get(userId);
    const value = emptySnapshot(userId, Boolean(loadCredential(userId)));
    cache.set(userId, value);
    return value;
}
function publicSnapshot(userId) {
    const value = snapshot(userId);
    return { ...value, userId: undefined, lastError: value.lastError ? friendlyError(value.lastError) : null };
}

async function apiRequest(token, route, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 4500);
    try {
        const response = await fetch(`${BASE_URL}${route}`, {
            method: options.method || 'GET', signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (response.status === 401 || response.status === 403) throw coded('beeper_token_invalid');
        if (!response.ok) throw coded('beeper_request_failed', response.status);
        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError' || /fetch failed|ECONNREFUSED/i.test(error.message || '')) throw coded('beeper_node_offline');
        throw error;
    } finally { clearTimeout(timer); }
}

function providerForAccount(account) {
    const identity = `${account.accountID || ''} ${account.network || ''} ${account.bridge?.id || ''} ${account.bridge?.type || ''}`.toLowerCase();
    if (identity.includes('instagram')) return 'instagram';
    if (identity.includes('messenger') || identity.includes('facebook')) return 'messenger';
    return null;
}
function normalizeAccount(account) {
    const provider = providerForAccount(account);
    if (!provider) return null;
    const user = account.user || {};
    return {
        id: String(account.accountID || ''), provider,
        label: String(user.fullName || user.username || user.email || account.network || account.accountID || provider),
        status: String(account.status || 'disconnected'), network: String(account.network || account.bridge?.type || provider),
        local: account.bridge?.provider === 'local'
    };
}
async function probeWithToken(userId, token) {
    const payload = await apiRequest(token, '/v1/accounts');
    const rows = Array.isArray(payload) ? payload : (payload.items || []);
    const accounts = rows.map(normalizeAccount).filter(Boolean);
    const value = {
        userId, paired: true, reachable: true, live: snapshot(userId).live,
        state: 'ready', accounts, lastCheckedAt: new Date().toISOString(), lastError: null
    };
    cache.set(userId, value);
    return value;
}
async function refresh(userId) {
    const credential = loadCredential(userId);
    if (!credential) {
        const value = emptySnapshot(userId);
        cache.set(userId, value);
        return value;
    }
    try { return await probeWithToken(userId, credential.token); }
    catch (error) {
        const previous = snapshot(userId);
        const value = { ...previous, paired: true, reachable: false, live: false, state: error.code === 'beeper_token_invalid' ? 'token_invalid' : 'node_offline', lastCheckedAt: new Date().toISOString(), lastError: error.code || error.message };
        cache.set(userId, value);
        return value;
    }
}
async function pair(userId, input = {}) {
    const token = String(input.token || '').trim();
    if (input.consent !== true || input.consentVersion !== '2026-08-30') throw coded('beeper_consent_required');
    if (token.length < 12 || token.length > 4096) throw coded('beeper_token_required');
    const value = await probeWithToken(userId, token);
    saveCredential(userId, token, input.consentVersion);
    return value;
}
function unpair(userId) {
    stopLive(userId);
    const file = credentialFile(userId);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* best effort */ }
    cache.set(userId, emptySnapshot(userId));
    return { ok: true };
}

function ensureLive(userId, onMessage) {
    const current = sockets.get(userId);
    if (current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(current.readyState)) return;
    const credential = loadCredential(userId);
    if (!credential || !snapshot(userId).reachable) return;
    const socket = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${credential.token}` } });
    sockets.set(userId, socket);
    socket.on('open', () => {
        const value = snapshot(userId); cache.set(userId, { ...value, live: true, state: 'ready', lastError: null });
        socket.send(JSON.stringify({ type: 'subscriptions.set', requestID: `gunter-${Date.now()}`, chatIDs: ['*'] }));
    });
    socket.on('message', raw => {
        try {
            const event = JSON.parse(String(raw));
            if (event.type !== 'message.upserted' || !Array.isArray(event.entries)) return;
            event.entries.map(entry => normalizeMessage(entry, snapshot(userId))).filter(Boolean).forEach(onMessage);
        } catch { /* ignore malformed bridge events */ }
    });
    socket.on('close', () => {
        sockets.delete(userId);
        const value = snapshot(userId); cache.set(userId, { ...value, live: false, state: value.reachable ? 'reconnecting' : value.state });
        scheduleReconnect(userId, onMessage);
    });
    socket.on('error', () => { /* close handles visible state and retry */ });
}
function scheduleReconnect(userId, onMessage) {
    if (reconnectTimers.has(userId) || !loadCredential(userId)) return;
    const timer = setTimeout(async () => {
        reconnectTimers.delete(userId);
        const value = await refresh(userId);
        if (value.reachable) ensureLive(userId, onMessage); else scheduleReconnect(userId, onMessage);
    }, 15000);
    timer.unref?.(); reconnectTimers.set(userId, timer);
}
function stopLive(userId) {
    const timer = reconnectTimers.get(userId); if (timer) clearTimeout(timer);
    reconnectTimers.delete(userId);
    const socket = sockets.get(userId); if (socket) { socket.removeAllListeners(); socket.close(); }
    sockets.delete(userId);
}

async function syncRecent(userId, { force = false } = {}) {
    const last = syncTimes.get(userId) || 0;
    if (!force && Date.now() - last < 8000) return [];
    const credential = loadCredential(userId);
    const current = snapshot(userId);
    if (!credential || !current.reachable) return [];
    syncTimes.set(userId, Date.now());
    const payload = await apiRequest(credential.token, '/v1/chats');
    const accountIds = new Set(current.accounts.map(item => item.id));
    const chats = (payload.items || []).filter(chat => accountIds.has(String(chat.accountID || ''))).slice(0, 80);
    return chats.map(chat => normalizeMessage(chat.preview, current, chat)).filter(Boolean);
}
function normalizeMessage(message, current, chat = {}) {
    if (!message || message.isDeleted || message.isHidden) return null;
    const account = current.accounts.find(item => item.id === String(message.accountID || chat.accountID || ''));
    if (!account) return null;
    const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
    const text = String(message.text || (attachment ? `Archivo: ${attachment.fileName || attachment.type || 'adjunto'}` : '')).trim();
    if (!text) return null;
    return {
        id: `beeper:${message.id}`, provider: account.provider,
        peerId: String(message.chatID || chat.id || ''), peerName: String(chat.title || message.senderName || account.label),
        direction: message.isSender ? 'out' : 'in', text,
        timestamp: message.timestamp || new Date().toISOString(), status: message.sendStatus?.status || 'delivered'
    };
}
async function sendMessage(userId, chatId, text) {
    const credential = loadCredential(userId);
    if (!credential || !snapshot(userId).reachable) throw coded('beeper_node_offline');
    return apiRequest(credential.token, `/v1/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: { text } });
}

function coded(code, detail) { const error = new Error(code); error.code = code; if (detail) error.detail = detail; return error; }
function friendlyError(code) { return ({ beeper_node_offline: 'Beeper Desktop no está disponible en este equipo.', beeper_token_invalid: 'El acceso fue revocado o el token dejó de ser válido.' })[code] || 'No se pudo comprobar el nodo local.'; }

module.exports = { pair, unpair, refresh, snapshot: publicSnapshot, ensureLive, stopLive, syncRecent, sendMessage, providerForAccount, normalizeAccount, _normalizeMessage: normalizeMessage };
