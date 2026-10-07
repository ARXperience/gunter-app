/* Unified social connections and conversation metadata. Tokens never live here. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('../user-store');

const PROVIDERS = Object.freeze({
    whatsapp: { label: 'WhatsApp', env: [], runtime: 'whatsapp_bridge' },
    instagram: { label: 'Instagram', env: [], runtime: 'beeper_node' },
    messenger: { label: 'Messenger', env: [], runtime: 'beeper_node' }
});
const SEND_SOURCES = new Set(['user_click', 'manual', 'user_voice_confirmed', 'user_text_confirmed']);
const STOPWORDS = new Set('para como esta este esto eso con por una uno unos unas que del las los quien donde cuando pero porque desde hasta sobre hola buenas gracias mensaje tengo tiene hacer puede puedes quiero queremos'.split(' '));

function fileFor(userId) { return path.join(userStore.userDir(userId), 'social-hub.json'); }
function defaults() {
    return {
        connections: Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, { enabled: false, accountLabel: null, connectedAt: null }])),
        messages: [], savedAt: null
    };
}
function load(userId) {
    try {
        const file = fileFor(userId);
        if (!fs.existsSync(file)) return defaults();
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const base = defaults();
        data.connections = { ...base.connections, ...(data.connections || {}) };
        data.messages = Array.isArray(data.messages) ? data.messages : [];
        return data;
    } catch { return defaults(); }
}
function save(userId, data) {
    const file = fileFor(userId);
    const temp = path.join(path.dirname(file), `.social-${process.pid}-${Date.now()}.tmp`);
    data.savedAt = new Date().toISOString();
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.unlinkSync(temp); }
}

function listConnections(userId, runtime = {}) {
    const data = load(userId);
    return Object.entries(PROVIDERS).map(([id, definition]) => {
        const stored = data.connections[id] || {};
        const runtimeState = runtime.whatsappStatus || {};
        const beeper = runtime.beeper || { paired: false, reachable: false, live: false, accounts: [] };
        const account = id === 'whatsapp' ? null : (beeper.accounts || []).find(item => item.provider === id);
        const accountReady = account && ['connected', 'backfilling'].includes(account.status);
        const connected = id === 'whatsapp' ? runtimeState.state === 'connected' : Boolean(beeper.reachable && accountReady);
        let state = connected ? (account?.status === 'backfilling' ? 'syncing' : 'connected') : stored.enabled ? 'disconnected' : 'disabled';
        if (stored.enabled && id !== 'whatsapp') {
            if (!beeper.paired) state = 'node_required';
            else if (beeper.state === 'token_invalid') state = 'token_invalid';
            else if (!beeper.reachable) state = 'node_offline';
            else if (!account) state = 'account_required';
            else if (['reconnect_required', 'connection_required', 'attention_required'].includes(account.status)) state = account.status;
            else if (!accountReady) state = account.status || 'disconnected';
        }
        return {
            id, label: definition.label, enabled: Boolean(stored.enabled), state, connected,
            accountLabel: id === 'whatsapp' ? (connected ? runtimeState.phone || null : null) : (account?.label || null),
            missingConfiguration: [], canConnect: true,
            connectionMode: id === 'whatsapp' ? 'whatsapp_bridge' : (beeper.nodeId ? 'beeper_desktop_node' : 'beeper_local'),
            node: id === 'whatsapp' ? null : { paired: Boolean(beeper.paired), reachable: Boolean(beeper.reachable), live: Boolean(beeper.live), lastCheckedAt: beeper.lastCheckedAt || null },
            privacy: id === 'whatsapp'
                ? 'Gunter no guarda credenciales de WhatsApp en el historial ni en rutas aprendidas.'
                : (beeper.nodeId
                    ? 'El token de Beeper permanece en el PC emparejado; Gunter recibe solo estado y mensajes autorizados.'
                    : 'El token de Beeper se cifra en el servidor local y nunca se envía al navegador después de guardarlo.')
        };
    });
}

function setEnabled(userId, provider, enabled) {
    if (!PROVIDERS[provider]) return { ok: false, error: 'social_provider_invalid' };
    const data = load(userId);
    data.connections[provider] = { ...(data.connections[provider] || {}), enabled: enabled === true };
    if (!enabled) data.connections[provider].connectedAt = null;
    save(userId, data);
    return { ok: true, connection: data.connections[provider] };
}

function connectionReadiness(userId, provider, runtime = {}) {
    if (!PROVIDERS[provider]) return { ok: false, error: 'social_provider_invalid' };
    const current = listConnections(userId, runtime).find(item => item.id === provider);
    if (!current.enabled) return { ok: false, error: 'social_provider_disabled' };
    if (provider !== 'whatsapp' && !current.connected) {
        const errors = {
            node_required: 'beeper_node_required', node_offline: 'beeper_node_offline', token_invalid: 'beeper_token_invalid',
            account_required: 'beeper_account_required', reconnect_required: 'beeper_reconnect_required',
            connection_required: 'beeper_reconnect_required', attention_required: 'beeper_attention_required'
        };
        return { ok: false, error: errors[current.state] || 'social_provider_disconnected' };
    }
    return { ok: true, connection: current };
}

function appendMessage(userId, input = {}) {
    if (!PROVIDERS[input.provider]) return { ok: false, error: 'social_provider_invalid' };
    const peerId = clean(input.peerId, 180);
    const text = clean(input.text, 4000);
    if (!peerId || !text) return { ok: false, error: 'social_message_fields_required' };
    const data = load(userId);
    const message = {
        id: clean(input.id, 180) || `soc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        provider: input.provider, peerId, peerName: clean(input.peerName, 180) || peerId,
        direction: input.direction === 'out' ? 'out' : 'in', text,
        timestamp: validDate(input.timestamp) || new Date().toISOString(), status: clean(input.status || 'delivered', 30)
    };
    if (!data.messages.some(item => item.id === message.id && item.provider === message.provider)) data.messages.push(message);
    if (data.messages.length > 2000) data.messages.splice(0, data.messages.length - 2000);
    save(userId, data);
    return { ok: true, message };
}

function listConversations(userId, options = {}) {
    const internal = load(userId).messages;
    const whatsapp = (Array.isArray(options.whatsappMessages) ? options.whatsappMessages : []).map(message => ({
        id: message.id, provider: 'whatsapp',
        peerId: clean(message.direction === 'out' ? message.to : message.from, 180),
        peerName: clean(message.direction === 'out' ? message.to : message.from, 180),
        direction: message.direction === 'out' ? 'out' : 'in', text: clean(message.text, 4000),
        timestamp: validDate(message.timestamp) || new Date().toISOString(), status: clean(message.status || 'delivered', 30)
    }));
    const byId = new Map();
    [...internal, ...whatsapp].forEach(message => {
        if (!message.peerId || !message.text) return;
        byId.set(`${message.provider}:${message.id}`, message);
    });
    const grouped = new Map();
    [...byId.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).forEach(message => {
        const key = `${message.provider}:${message.peerId}`;
        if (!grouped.has(key)) grouped.set(key, { id: key, provider: message.provider, peerId: message.peerId, peerName: message.peerName || message.peerId, messages: [] });
        grouped.get(key).messages.push(message);
    });
    const items = [...grouped.values()].map(thread => {
        const last = thread.messages[thread.messages.length - 1];
        const lastOut = [...thread.messages].reverse().findIndex(item => item.direction === 'out');
        const unread = lastOut < 0 ? thread.messages.filter(item => item.direction === 'in').length : thread.messages.slice(thread.messages.length - lastOut).filter(item => item.direction === 'in').length;
        return { ...thread, lastMessage: last, snippet: last.text.slice(0, 140), updatedAt: last.timestamp, unread };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 250));
    return { items: items.slice(0, limit), stats: { conversations: items.length, messages: byId.size, unread: items.reduce((sum, item) => sum + item.unread, 0) } };
}

function insight(userId, threadId, options = {}) {
    const thread = listConversations(userId, options).items.find(item => item.id === threadId);
    if (!thread) return { ok: false, error: 'conversation_not_found' };
    const recent = thread.messages.slice(-12);
    const terms = topTerms(recent.map(item => item.text).join(' '));
    const last = recent[recent.length - 1];
    const awaitingReply = last?.direction === 'in';
    const topic = terms.length ? terms.slice(0, 3).join(', ') : 'el intercambio reciente';
    const summary = `Conversación con ${thread.peerName} sobre ${topic}. ${awaitingReply ? 'La otra persona envió el último mensaje.' : 'Tu mensaje es el más reciente.'}`;
    return { ok: true, insight: { threadId, summary, topics: terms, awaitingReply, suggestions: replySuggestions(last?.text || '', thread.peerName) } };
}

function validateSend(userId, input = {}, runtime = {}) {
    const provider = clean(input.provider, 30).toLowerCase();
    const ready = connectionReadiness(userId, provider, runtime);
    if (!ready.ok) return ready;
    if (input.confirmed !== true || !SEND_SOURCES.has(input.source)) return { ok: false, error: 'explicit_send_confirmation_required' };
    const peerId = clean(input.peerId, 180), text = clean(input.text, 4000);
    const attachmentPath = cleanLocalPath(input.attachmentPath);
    if (!peerId || (!text && !attachmentPath)) return { ok: false, error: 'social_message_fields_required' };
    if (attachmentPath && provider === 'whatsapp') return { ok: false, error: 'social_attachment_provider_unsupported' };
    return { ok: true, provider, peerId, text, attachmentPath };
}

function topTerms(text) {
    const counts = new Map();
    String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{4,}/g)?.forEach(term => {
        if (!STOPWORDS.has(term)) counts.set(term, (counts.get(term) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([term]) => term);
}
function replySuggestions(text, name) {
    const value = String(text || '');
    if (/\?|cuando|puedes|podr[ií]as/i.test(value)) return [`Hola ${name}, sí. Déjame confirmarte el detalle y te respondo enseguida.`, `Gracias por escribir. ¿Te parece si lo coordinamos hoy?`, `Lo reviso y te confirmo una hora concreta.`];
    if (/gracias|perfecto|listo|genial/i.test(value)) return ['¡Con gusto! Quedo atento.', 'Perfecto, seguimos entonces.', 'Gracias a ti.'];
    return [`Hola ${name}, gracias por contarme. Lo reviso y te respondo.`, 'Entendido. ¿Hay algún plazo que deba tener en cuenta?', 'Recibido; te confirmo el siguiente paso en breve.'];
}
function clean(value, max) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max); }
function cleanLocalPath(value) {
    const candidate = String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 4096);
    return candidate && path.isAbsolute(candidate) ? path.resolve(candidate) : '';
}
function validDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

module.exports = { PROVIDERS, listConnections, setEnabled, connectionReadiness, appendMessage, listConversations, insight, validateSend, _load: load };
