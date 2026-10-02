/* Persistent structured traces with redacted metadata only. */
const crypto = require('crypto');
const store = require('./persistence');
const contracts = require('./contracts');

const FILE = 'log-events.jsonl';

function newTraceId() {
    return `tr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function beginRequest(req, res, pathname) {
    if (!String(pathname || '').startsWith('/api/')) return null;
    const traceId = newTraceId();
    const started = process.hrtime.bigint();
    req.gunterTraceId = traceId;
    res.setHeader('X-Gunter-Trace-Id', traceId);
    res.once('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        record({
            trace_id: traceId,
            severity: res.statusCode >= 500 ? 'HIGH' : res.statusCode >= 400 ? 'WARN' : 'INFO',
            service: 'http',
            event_type: 'http.request',
            action: `${req.method} ${pathname}`,
            duration_ms: Math.round(durationMs),
            status: String(res.statusCode),
            user_id_hash: req.gunterUser?.id ? store.hash(req.gunterUser.id).slice(0, 16) : null,
            node_id: req.gunterNode?.nodeId || null,
            error_code: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null,
            metadata_redacted: { method: req.method, pathname: String(pathname).slice(0, 180) }
        });
    });
    return traceId;
}

function record(event = {}) {
    const normalized = {
        timestamp: event.timestamp || new Date().toISOString(),
        severity: event.severity || 'INFO',
        environment: process.env.NODE_ENV || 'development',
        service: String(event.service || 'gunter').slice(0, 80),
        trace_id: event.trace_id || newTraceId(),
        span_id: event.span_id || null,
        task_id: event.task_id || null,
        mission_id: event.mission_id || null,
        user_id_hash: event.user_id_hash || null,
        node_id: event.node_id || null,
        event_type: String(event.event_type || 'event').slice(0, 120),
        action: event.action ? String(event.action).slice(0, 180) : null,
        skill: event.skill || null,
        skill_version: event.skill_version || null,
        provider: event.provider || null,
        model: event.model || null,
        duration_ms: Number.isFinite(event.duration_ms) ? event.duration_ms : null,
        status: String(event.status || 'recorded').slice(0, 60),
        error_code: event.error_code || null,
        error_fingerprint: event.error_fingerprint || null,
        retry_count: Number(event.retry_count || 0),
        evidence_ref: event.evidence_ref || null,
        metadata_redacted: sanitizeMetadata(event.metadata_redacted)
    };
    const validation = contracts.validate('log_event', normalized);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    store.appendJsonl(FILE, normalized);
    return { ok: true, event: normalized };
}

function sanitizeMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, raw] of Object.entries(value).slice(0, 30)) {
        if (/token|secret|password|authorization|cookie|content|payload/i.test(key)) continue;
        if (['string', 'number', 'boolean'].includes(typeof raw) || raw === null) out[key] = typeof raw === 'string' ? raw.slice(0, 240) : raw;
    }
    return out;
}

function list({ limit = 200, traceId = null, severity = null, service = null } = {}) {
    let rows = store.readJsonl(FILE, { limit: Math.max(Number(limit) || 200, 200), filter: traceId || null });
    if (traceId) rows = rows.filter(row => row.trace_id === traceId);
    if (severity) rows = rows.filter(row => row.severity === severity);
    if (service) rows = rows.filter(row => row.service === service);
    return rows.slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)));
}

function stats() {
    const rows = list({ limit: 1000 });
    return {
        sampled: rows.length,
        errors: rows.filter(row => row.severity === 'HIGH' || row.severity === 'CRITICAL').length,
        warnings: rows.filter(row => row.severity === 'WARN').length,
        latestAt: rows.at(-1)?.timestamp || null
    };
}

module.exports = { newTraceId, beginRequest, record, list, stats };
