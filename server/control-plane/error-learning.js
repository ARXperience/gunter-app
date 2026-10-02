/* Governed error-learning candidates. Suggestions never self-apply. */
const crypto = require('crypto');
const fs = require('fs');
const store = require('./persistence');

const STATES = ['CANDIDATE', 'VALIDATED', 'REJECTED', 'ARCHIVED'];
const PROTECTED_DOMAINS = new Set(['security', 'billing', 'policy', 'permissions', 'authentication', 'entitlements']);
const SECRET_RE = /(bearer\s+[\w.-]+|sk-[a-z0-9_-]+|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/gi;

function capture(userId, input = {}, traceId = null) {
    const domain = token(input.domain || 'general', 60).toLowerCase();
    const summary = redact(String(input.summary || '').trim()).slice(0, 500);
    if (!summary) return { ok: false, error: 'summary_required' };
    const data = load(userId); const now = new Date().toISOString();
    const fingerprint = store.hash(`${domain}|${normalize(summary)}|${token(input.errorCode, 80)}`).slice(0, 32);
    let candidate = data.items.find(item => item.fingerprint === fingerprint && !['REJECTED', 'ARCHIVED'].includes(item.state));
    const evidence = sanitizeEvidence(input.evidence);
    if (candidate) {
        candidate.occurrences += 1; candidate.lastSeenAt = now; candidate.evidence = [...candidate.evidence, ...evidence].slice(-20); candidate.traceIds = [...new Set([...candidate.traceIds, traceId].filter(Boolean))].slice(-20);
    } else {
        candidate = { candidateId: `learn_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, state: 'CANDIDATE', domain, summary, errorCode: token(input.errorCode, 80) || null, fingerprint, evidence, occurrences: 1, traceIds: traceId ? [traceId] : [], suggestion: null, autoApplicable: false, protected: PROTECTED_DOMAINS.has(domain), createdAt: now, lastSeenAt: now, updatedAt: now };
        data.items.push(candidate);
    }
    save(userId, data); return { ok: true, candidate };
}

function review(userId, input = {}) {
    const data = load(userId); const candidate = data.items.find(item => item.candidateId === input.candidateId);
    if (!candidate) return { ok: false, error: 'candidate_not_found' };
    const state = String(input.state || '').toUpperCase();
    if (!STATES.includes(state) || state === 'CANDIDATE') return { ok: false, error: 'invalid_state' };
    candidate.state = state;
    candidate.suggestion = input.suggestion ? redact(String(input.suggestion)).slice(0, 1000) : candidate.suggestion;
    candidate.autoApplicable = false;
    candidate.reviewedBy = token(input.reviewedBy || 'user', 120); candidate.updatedAt = new Date().toISOString();
    save(userId, data); return { ok: true, candidate };
}

function list(userId, query = {}) { const data = load(userId); const state = query.state ? String(query.state).toUpperCase() : null; return data.items.filter(item => !state || item.state === state).slice(-clamp(query.limit, 1, 300, 100)).reverse(); }
function forget(userId, candidateId) { const data = load(userId); const before = data.items.length; data.items = data.items.filter(item => item.candidateId !== candidateId); if (before === data.items.length) return { ok: false, error: 'candidate_not_found' }; save(userId, data); return { ok: true, candidateId }; }
function stats(userId) { const items = load(userId).items; return { total: items.length, byState: Object.fromEntries(STATES.map(state => [state, items.filter(item => item.state === state).length])), protected: items.filter(item => item.protected).length }; }
function purge(userId) { const file = store.target(fileFor(userId)); if (fs.existsSync(file)) fs.unlinkSync(file); return true; }
function sanitizeEvidence(items) { return (Array.isArray(items) ? items : []).slice(0, 20).map(item => ({ type: token(item?.type || 'observation', 40), ref: token(item?.ref || 'inline', 120), note: redact(String(item?.note || '')).slice(0, 500) })); }
function redact(value) { return String(value || '').replace(SECRET_RE, '[REDACTED]'); }
function fileFor(userId) { return `error-learning-${store.hash(userId).slice(0, 20)}.json`; }
function load(userId) { const data = store.loadJson(fileFor(userId), { version: 1, items: [] }); if (!Array.isArray(data.items)) data.items = []; return data; }
function save(userId, data) { data.savedAt = new Date().toISOString(); store.saveJson(fileFor(userId), data); }
function token(value, max) { return String(value || '').replace(/[^\p{L}\p{N}_.:@/-]/gu, '_').slice(0, max); }
function normalize(value) { return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback; }

module.exports = { STATES, PROTECTED_DOMAINS, capture, review, list, forget, stats, purge, _load: load };
