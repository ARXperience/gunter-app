/* Per-user knowledge graph with explicit provenance. Similar entities are never auto-merged. */
const crypto = require('crypto');
const fs = require('fs');
const store = require('./persistence');

function upsertEntity(userId, input = {}, traceId = null) {
    if (!input.source || typeof input.source !== 'object') return { ok: false, error: 'source_required' };
    const label = String(input.label || '').trim().slice(0, 240);
    const type = token(input.type || 'concept', 60);
    if (!label) return { ok: false, error: 'label_required' };
    const data = load(userId);
    const id = input.entityId ? token(input.entityId, 120) : `ent_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    let entity = data.entities.find(item => item.entityId === id);
    const now = new Date().toISOString();
    const next = {
        entityId: id, type, label,
        attributes: sanitizeObject(input.attributes),
        source: sanitizeSource(input.source), confidence: clamp(input.confidence, 0, 1, 0.7),
        traceId: traceId || null, createdAt: entity?.createdAt || now, updatedAt: now
    };
    if (entity) Object.assign(entity, next); else data.entities.push(next);
    save(userId, data);
    return { ok: true, entity: next, merged: false };
}

function link(userId, input = {}, traceId = null) {
    if (!input.source || typeof input.source !== 'object') return { ok: false, error: 'source_required' };
    const data = load(userId);
    const from = token(input.from, 120), to = token(input.to, 120), relation = token(input.relation, 80);
    if (!data.entities.some(item => item.entityId === from) || !data.entities.some(item => item.entityId === to)) return { ok: false, error: 'entity_not_found' };
    if (!relation) return { ok: false, error: 'relation_required' };
    const existing = data.edges.find(item => item.from === from && item.to === to && item.relation === relation);
    if (existing) return { ok: true, edge: existing, duplicate: true };
    const edge = { edgeId: `edge_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, from, to, relation, source: sanitizeSource(input.source), confidence: clamp(input.confidence, 0, 1, 0.7), traceId: traceId || null, createdAt: new Date().toISOString() };
    data.edges.push(edge); save(userId, data); return { ok: true, edge, duplicate: false };
}

function search(userId, query = {}) {
    const data = load(userId); const q = normalize(query.q); const type = query.type ? token(query.type, 60) : null;
    const entities = data.entities.filter(item => (!q || normalize(`${item.label} ${JSON.stringify(item.attributes)}`).includes(q)) && (!type || item.type === type)).slice(0, clamp(query.limit, 1, 200, 50));
    const ids = new Set(entities.map(item => item.entityId));
    return { entities, edges: data.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)).slice(0, 300), stats: { entities: data.entities.length, edges: data.edges.length } };
}

function forget(userId, entityId) {
    const data = load(userId); const before = data.entities.length;
    data.entities = data.entities.filter(item => item.entityId !== entityId);
    if (data.entities.length === before) return { ok: false, error: 'entity_not_found' };
    data.edges = data.edges.filter(edge => edge.from !== entityId && edge.to !== entityId); save(userId, data);
    return { ok: true, entityId };
}

function stats(userId) { const data = load(userId); return { entities: data.entities.length, edges: data.edges.length }; }
function purge(userId) { const file = store.target(fileFor(userId)); if (fs.existsSync(file)) fs.unlinkSync(file); return true; }
function fileFor(userId) { return `knowledge-graph-${store.hash(userId).slice(0, 20)}.json`; }
function load(userId) { const data = store.loadJson(fileFor(userId), { version: 1, entities: [], edges: [] }); if (!Array.isArray(data.entities)) data.entities = []; if (!Array.isArray(data.edges)) data.edges = []; return data; }
function save(userId, data) { data.savedAt = new Date().toISOString(); store.saveJson(fileFor(userId), data); }
function sanitizeSource(value) { return { type: token(value.type || 'user', 40), id: token(value.id || 'manual', 120), observedAt: validDate(value.observedAt) || new Date().toISOString() }; }
function sanitizeObject(value) { const out = {}; for (const [key, raw] of Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})) if (['string','number','boolean'].includes(typeof raw) || raw === null) out[token(key, 80)] = typeof raw === 'string' ? raw.slice(0, 500) : raw; return out; }
function validDate(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null; }
function token(value, max) { return String(value || '').replace(/[^\p{L}\p{N}_.:@/-]/gu, '_').slice(0, max); }
function normalize(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback; }

module.exports = { upsertEntity, link, search, forget, stats, purge, _load: load };
