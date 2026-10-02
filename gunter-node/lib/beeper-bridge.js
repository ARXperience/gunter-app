const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:23373';
const WS_URL = 'ws://127.0.0.1:23373/v1/ws';

class BeeperBridge {
    constructor(token, handlers = {}) {
        this.token = String(token || '').trim();
        this.onSnapshot = handlers.onSnapshot || (() => {});
        this.onMessage = handlers.onMessage || (() => {});
        this.socket = null;
        this.accounts = [];
        this.snapshot = emptySnapshot(Boolean(this.token));
        this.timer = null;
        this.stopped = false;
    }

    async start() {
        if (!this.token) { this.emit(emptySnapshot(false)); return this.snapshot; }
        this.stopped = false;
        await this.refresh();
        if (this.snapshot.reachable) this.connectSocket();
        this.timer = setInterval(() => this.refresh().catch(() => {}), 30000);
        this.timer.unref?.();
        return this.snapshot;
    }

    stop() {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.socket) { this.socket.removeAllListeners(); this.socket.close(); }
        this.socket = null;
    }

    async refresh() {
        try {
            const payload = await this.request('/v1/accounts');
            const rows = Array.isArray(payload) ? payload : (payload.items || []);
            this.accounts = rows.map(normalizeAccount).filter(Boolean);
            this.emit({ paired: true, reachable: true, live: this.socket?.readyState === WebSocket.OPEN, state: 'ready', accounts: this.accounts, lastError: null, lastCheckedAt: new Date().toISOString() });
            return this.snapshot;
        } catch (error) {
            this.emit({ ...this.snapshot, paired: true, reachable: false, live: false, state: error.code === 'beeper_token_invalid' ? 'token_invalid' : 'node_offline', lastError: error.code || error.message, lastCheckedAt: new Date().toISOString() });
            return this.snapshot;
        }
    }

    async syncRecent() {
        if (!this.snapshot.reachable) return [];
        const payload = await this.request('/v1/chats');
        const accountIds = new Set(this.accounts.map(item => item.id));
        return (payload.items || []).filter(chat => accountIds.has(String(chat.accountID || ''))).slice(0, 100)
            .map(chat => normalizeMessage(chat.preview, this.accounts, chat)).filter(Boolean);
    }

    async send(chatId, text, attachment = null) {
        if (!this.snapshot.reachable) throw coded('beeper_node_offline');
        const body = {};
        if (String(text || '').trim()) body.text = String(text).slice(0, 4000);
        if (attachment?.filePath) {
            const uploaded = await this.uploadFile(attachment.filePath);
            body.attachment = attachmentPayload(uploaded);
        }
        if (!body.text && !body.attachment) throw coded('beeper_message_content_required');
        return this.request(`/v1/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body });
    }

    async uploadFile(filePath) {
        const resolved = path.resolve(String(filePath || ''));
        const stat = await fs.promises.stat(resolved).catch(() => null);
        if (!stat?.isFile()) throw coded('desktop_file_not_found');
        if (stat.size > 100 * 1024 * 1024) throw coded('beeper_attachment_too_large');
        const mimeType = mimeFor(resolved);
        const bytes = await fs.promises.readFile(resolved);
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: mimeType }), path.basename(resolved));
        form.append('fileName', path.basename(resolved));
        form.append('mimeType', mimeType);
        const uploaded = await this.request('/v1/assets/upload', { method: 'POST', form, timeout: 120000 });
        if (!uploaded?.uploadID || uploaded.error) throw coded('beeper_attachment_upload_failed');
        return uploaded;
    }

    connectSocket() {
        if (this.stopped || this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) return;
        const socket = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${this.token}` } });
        this.socket = socket;
        socket.on('open', () => {
            this.emit({ ...this.snapshot, reachable: true, live: true, state: 'ready', lastError: null, lastCheckedAt: new Date().toISOString() });
            socket.send(JSON.stringify({ type: 'subscriptions.set', requestID: `gunter-node-${Date.now()}`, chatIDs: ['*'] }));
        });
        socket.on('message', raw => {
            try {
                const event = JSON.parse(String(raw));
                if (event.type !== 'message.upserted' || !Array.isArray(event.entries)) return;
                event.entries.map(entry => normalizeMessage(entry, this.accounts)).filter(Boolean).forEach(message => this.onMessage(message));
            } catch { /* Ignore malformed local events. */ }
        });
        socket.on('close', () => {
            if (this.socket === socket) this.socket = null;
            this.emit({ ...this.snapshot, live: false, state: this.snapshot.reachable ? 'reconnecting' : this.snapshot.state, lastCheckedAt: new Date().toISOString() });
            if (!this.stopped) setTimeout(() => this.refresh().then(() => this.connectSocket()).catch(() => {}), 15000).unref?.();
        });
        socket.on('error', () => {});
    }

    emit(value) { this.snapshot = value; this.onSnapshot({ ...value, accounts: [...(value.accounts || [])] }); }

    async request(route, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || 6000);
        try {
            const response = await fetch(`${BASE_URL}${route}`, {
                method: options.method || 'GET', signal: controller.signal,
                headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
                body: options.form || (options.body ? JSON.stringify(options.body) : undefined)
            });
            if ([401, 403].includes(response.status)) throw coded('beeper_token_invalid');
            if (!response.ok) throw coded('beeper_request_failed');
            return response.json();
        } catch (error) {
            if (error.name === 'AbortError' || /fetch failed|ECONNREFUSED/i.test(error.message || '')) throw coded('beeper_node_offline');
            throw error;
        } finally { clearTimeout(timer); }
    }
}

function providerForAccount(account) {
    const identity = `${account.accountID || ''} ${account.network || ''} ${account.bridge?.id || ''} ${account.bridge?.type || ''}`.toLowerCase();
    if (identity.includes('instagram')) return 'instagram';
    if (identity.includes('messenger') || identity.includes('facebook')) return 'messenger';
    return null;
}
function normalizeAccount(account) {
    const provider = providerForAccount(account); if (!provider) return null;
    const user = account.user || {};
    return { id: String(account.accountID || ''), provider, label: String(user.fullName || user.username || user.email || account.network || provider), status: String(account.status || 'disconnected'), network: String(account.network || account.bridge?.type || provider), local: account.bridge?.provider === 'local' };
}
function normalizeMessage(message, accounts, chat = {}) {
    if (!message || message.isDeleted || message.isHidden) return null;
    const account = accounts.find(item => item.id === String(message.accountID || chat.accountID || ''));
    if (!account) return null;
    const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
    const text = String(message.text || (attachment ? `Archivo: ${attachment.fileName || attachment.type || 'adjunto'}` : '')).trim();
    if (!text) return null;
    return { id: `beeper:${message.id}`, provider: account.provider, peerId: String(message.chatID || chat.id || ''), peerName: String(chat.title || message.senderName || account.label), direction: message.isSender ? 'out' : 'in', text, timestamp: message.timestamp || new Date().toISOString(), status: message.sendStatus?.status || 'delivered' };
}
function mimeFor(filePath) {
    return ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.zip': 'application/zip'
    })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
function attachmentPayload(uploaded) {
    const mimeType = String(uploaded.mimeType || 'application/octet-stream');
    const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'file';
    const value = { uploadID: uploaded.uploadID, fileName: uploaded.fileName || 'archivo', mimeType, type };
    if (Number(uploaded.duration) > 0) value.duration = Number(uploaded.duration);
    if (Number(uploaded.width) > 0 || Number(uploaded.height) > 0) value.size = { width: Number(uploaded.width) || 0, height: Number(uploaded.height) || 0 };
    return value;
}
function emptySnapshot(paired) { return { paired, reachable: false, live: false, state: paired ? 'node_offline' : 'node_required', accounts: [], lastError: null, lastCheckedAt: new Date().toISOString() }; }
function coded(code) { const error = new Error(code); error.code = code; return error; }

module.exports = { BeeperBridge, normalizeAccount, normalizeMessage, mimeFor, attachmentPayload };
