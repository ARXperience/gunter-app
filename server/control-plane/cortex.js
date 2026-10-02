/* Governed cross-surface memory with provenance, confidence and deletion controls. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('../user-store');
const observability = require('./observability');
const persistence = require('./persistence');

const TYPES = ['working', 'episodic', 'semantic', 'procedural', 'decision', 'relationship', 'error_learning', 'skill'];
const SENSITIVITY = ['normal', 'private', 'sensitive', 'never_cloud'];

function fileFor(userId) { return path.join(userStore.userDir(userId), 'cortex.json'); }
function load(userId) {
    try {
        const file = fileFor(userId);
        if (!fs.existsSync(file)) return { version: 1, memories: [], savedAt: null };
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(data.memories)) data.memories = [];
        return data;
    } catch { return { version: 1, memories: [], savedAt: null }; }
}
function save(userId, data) {
    const file = fileFor(userId);
    const temp = path.join(path.dirname(file), `.cortex-${process.pid}-${Date.now()}.tmp`);
    data.savedAt = new Date().toISOString();
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, file); } catch { fs.copyFileSync(temp, file); fs.unlinkSync(temp); }
}

function remember(userId, input = {}, traceId) {
    const content = String(input.content || '').trim();
    const type = TYPES.includes(input.type) ? input.type : 'episodic';
    const source = String(input.source || '').trim();
    if (content.length < 2 || content.length > 4000) return { ok: false, error: 'memory_content_invalid' };
    if (!source || source.length > 240) return { ok: false, error: 'memory_source_required' };
    const data = load(userId);
    const contentHash = persistence.hash(`${type}|${normalize(content)}`);
    const existing = data.memories.find(item => item.contentHash === contentHash && !item.forgottenAt);
    if (existing) {
        existing.lastVerifiedAt = new Date().toISOString();
        existing.confidence = Math.max(existing.confidence, confidence(input.confidence));
        save(userId, data);
        return { ok: true, duplicate: true, memory: publicMemory(existing) };
    }
    const now = new Date().toISOString();
    const memory = {
        id: `mem_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        type, content, contentHash, source, sourceRef: clean(input.sourceRef, 240) || null,
        confidence: confidence(input.confidence), sensitivity: SENSITIVITY.includes(input.sensitivity) ? input.sensitivity : 'normal',
        tags: unique(input.tags, 30, 80), entities: unique(input.entities, 50, 120),
        createdAt: now, updatedAt: now, lastVerifiedAt: now, expiresAt: dateOrNull(input.expiresAt),
        correctedAt: null, forgottenAt: null, correctionHistory: []
    };
    data.memories.push(memory);
    if (data.memories.length > 10000) data.memories.splice(0, data.memories.length - 10000);
    save(userId, data);
    audit(userId, traceId, 'cortex.remember', memory, 'stored');
    return { ok: true, duplicate: false, memory: publicMemory(memory) };
}

function search(userId, input = {}) {
    const query = normalize(input.query || '');
    const terms = query.split(' ').filter(term => term.length > 2);
    const now = Date.now();
    let items = load(userId).memories.filter(item => !item.forgottenAt && (!item.expiresAt || new Date(item.expiresAt).getTime() > now));
    if (input.type && TYPES.includes(input.type)) items = items.filter(item => item.type === input.type);
    if (terms.length) items = items.map(item => ({ item, score: score(item, terms) })).filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || String(b.item.updatedAt).localeCompare(String(a.item.updatedAt))).map(hit => ({ ...publicMemory(hit.item), relevance: hit.score }));
    else items = items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(publicMemory);
    return items.slice(0, Math.max(1, Math.min(Number(input.limit) || 50, 200)));
}

function correct(userId, id, input = {}, traceId) {
    const data = load(userId);
    const memory = data.memories.find(item => item.id === id && !item.forgottenAt);
    if (!memory) return { ok: false, error: 'memory_not_found' };
    const content = String(input.content || '').trim();
    if (content.length < 2 || content.length > 4000) return { ok: false, error: 'memory_content_invalid' };
    memory.correctionHistory.push({ contentHash: memory.contentHash, correctedAt: new Date().toISOString(), reason: clean(input.reason, 240) || null });
    memory.content = content;
    memory.contentHash = persistence.hash(`${memory.type}|${normalize(content)}`);
    memory.confidence = confidence(input.confidence ?? 1);
    memory.correctedAt = new Date().toISOString(); memory.updatedAt = memory.correctedAt; memory.lastVerifiedAt = memory.correctedAt;
    save(userId, data);
    audit(userId, traceId, 'cortex.correct', memory, 'corrected');
    return { ok: true, memory: publicMemory(memory) };
}

function forget(userId, id, traceId) {
    const data = load(userId);
    const memory = data.memories.find(item => item.id === id && !item.forgottenAt);
    if (!memory) return { ok: false, error: 'memory_not_found' };
    memory.content = '[forgotten]'; memory.forgottenAt = new Date().toISOString(); memory.updatedAt = memory.forgottenAt;
    save(userId, data);
    audit(userId, traceId, 'cortex.forget', memory, 'forgotten');
    return { ok: true, id, forgottenAt: memory.forgottenAt };
}

function exportAll(userId) {
    return { version: 1, exportedAt: new Date().toISOString(), userId, memories: load(userId).memories.filter(item => !item.forgottenAt).map(publicMemory) };
}

function stats(userId) {
    const items = load(userId).memories;
    const active = items.filter(item => !item.forgottenAt);
    return { total: items.length, active: active.length, forgotten: items.length - active.length, byType: active.reduce((acc, item) => (acc[item.type] = (acc[item.type] || 0) + 1, acc), {}) };
}

function audit(userId, traceId, eventType, memory, status) {
    observability.record({ trace_id: traceId, severity: 'INFO', service: 'cortex', event_type: eventType, action: memory.type, status, user_id_hash: persistence.hash(userId).slice(0, 16), metadata_redacted: { memoryId: memory.id, sensitivity: memory.sensitivity, source: memory.source.slice(0, 80) } });
}
function publicMemory(memory) { const { contentHash, ...safe } = memory; return { ...safe }; }
function score(item, terms) { const haystack = normalize([item.content, item.source, ...(item.tags || []), ...(item.entities || [])].join(' ')); return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) * Number(item.confidence || .5); }
function normalize(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function unique(value, max, length) { return [...new Set((Array.isArray(value) ? value : []).map(item => clean(item, length)).filter(Boolean))].slice(0, max); }
function clean(value, max) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max); }
function confidence(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(n, 1)) : .7; }
function dateOrNull(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

module.exports = { TYPES, SENSITIVITY, remember, search, correct, forget, exportAll, stats, _load: load };
