/* Versioned, per-user context envelope. It resolves references but never executes actions. */
const crypto = require('crypto');
const fs = require('fs');
const store = require('./persistence');

const VERSION = '1.0.0';
const REFERENCE_RE = /\b(eso|esa|ese|esto|aquello|ah[ií]|all[ií]|hazlo|rep[ií]telo|mu[eé]velo|c[aá]mbialo)\b/i;

function build(userId, input = {}, actor = {}, traceId = null) {
    const safeUserId = String(userId || '');
    if (!safeUserId) return { ok: false, error: 'user_id_required' };
    const text = String(input.text || '').trim().slice(0, 4000);
    const sessionId = safeToken(input.sessionId || 'default', 100);
    const timezone = validTimezone(input.timezone) ? input.timezone : 'America/Bogota';
    const locale = safeToken(input.locale || 'es-CO', 24);
    const sessions = load(safeUserId);
    const previous = sessions.items.find(item => item.sessionId === sessionId) || null;
    const temporal = resolveTemporal(text, timezone);
    const hasReference = REFERENCE_RE.test(text);
    const explicitCurrent = sanitizeCurrent(input.current);
    const inheritedCurrent = hasReference && previous ? previous.current : {};
    const current = Object.keys(explicitCurrent).length ? explicitCurrent : inheritedCurrent;
    const needsClarification = hasReference && Object.keys(current).length === 0;
    const now = new Date().toISOString();
    const contextId = `ctx_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    const envelope = {
        context_id: contextId,
        trace_id: safeToken(traceId || input.traceId || contextId, 120),
        version: VERSION,
        user_id_hash: store.hash(safeUserId).slice(0, 24),
        channel: safeToken(input.channel || actor.kind || 'web', 24),
        session_id: sessionId,
        node_id: input.nodeId ? safeToken(input.nodeId, 120) : null,
        now,
        locale,
        timezone,
        input: { text, normalized: normalize(text) },
        references: {
            detected: hasReference,
            resolved_from: hasReference && previous && !needsClarification ? previous.contextId : null,
            temporal
        },
        current,
        sources: buildSources(input, previous, temporal),
        needs_clarification: needsClarification
    };
    remember(safeUserId, sessions, { sessionId, contextId, current, timestamp: now });
    return { ok: true, envelope };
}

function buildSources(input, previous, temporal) {
    const sources = [{ type: 'request', id: 'current_input', confidence: 1 }];
    if (previous) sources.push({ type: 'session_context', id: previous.contextId, confidence: 0.82 });
    if (temporal.length) sources.push({ type: 'system_clock', id: 'server_time', confidence: 1 });
    for (const source of Array.isArray(input.sources) ? input.sources.slice(0, 20) : []) {
        if (!source || typeof source !== 'object') continue;
        sources.push({ type: safeToken(source.type || 'external', 40), id: safeToken(source.id || 'unknown', 120), confidence: clamp(source.confidence, 0, 1, 0.5) });
    }
    return sources;
}

function resolveTemporal(text, timezone) {
    if (!text) return [];
    const lower = normalize(text);
    const result = [];
    const local = localDateParts(new Date(), timezone);
    if (/\bpasado manana\b/.test(lower)) result.push(relativeDate(local, 2, 'pasado mañana'));
    else if (/\bmanana\b/.test(lower)) result.push(relativeDate(local, 1, 'mañana'));
    else if (/\bhoy\b/.test(lower)) result.push(relativeDate(local, 0, 'hoy'));
    const iso = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) result.push({ expression: iso[0], date: iso[0], timezone, confidence: 1 });
    const time = lower.match(/\b(?:a\s+las\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/);
    if (time && (/\ba\s+las\b/.test(lower) || time[2] || time[3])) {
        let hour = Number(time[1]);
        if (time[3] === 'pm' && hour < 12) hour += 12;
        if (time[3] === 'am' && hour === 12) hour = 0;
        result.push({ expression: time[0], time: `${String(hour).padStart(2, '0')}:${time[2] || '00'}`, timezone, confidence: 0.96 });
    }
    return result;
}

function localDateParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return { year: Number(parts.find(p => p.type === 'year').value), month: Number(parts.find(p => p.type === 'month').value), day: Number(parts.find(p => p.type === 'day').value) };
}
function relativeDate(parts, days, expression) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { expression, date: date.toISOString().slice(0, 10), confidence: 1 };
}
function sanitizeCurrent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const key of ['app', 'document', 'project', 'person', 'meeting', 'task', 'route']) {
        if (value[key] != null) out[key] = String(value[key]).slice(0, 240);
    }
    return out;
}
function fileFor(userId) { return `context-sessions-${store.hash(userId).slice(0, 20)}.json`; }
function load(userId) { const data = store.loadJson(fileFor(userId), { version: 1, items: [] }); if (!Array.isArray(data.items)) data.items = []; return data; }
function remember(userId, data, item) {
    data.items = data.items.filter(existing => existing.sessionId !== item.sessionId);
    data.items.unshift(item);
    data.items = data.items.slice(0, 50);
    data.savedAt = item.timestamp;
    store.saveJson(fileFor(userId), data);
}
function purge(userId) { const file = store.target(fileFor(userId)); if (fs.existsSync(file)) fs.unlinkSync(file); return true; }
function validTimezone(value) { try { new Intl.DateTimeFormat('en', { timeZone: String(value || '') }); return !!value; } catch { return false; } }
function normalize(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
function safeToken(value, max) { return String(value || '').replace(/[^\p{L}\p{N}_.:@/-]/gu, '_').slice(0, max); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback; }

module.exports = { VERSION, build, resolveTemporal, purge, _load: load };
