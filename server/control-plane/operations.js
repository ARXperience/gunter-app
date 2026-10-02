/* Incident correlation and operational overview. */
const crypto = require('crypto');
const store = require('./persistence');
const observability = require('./observability');

const FILE = 'incidents.json';

function load() {
    const data = store.loadJson(FILE, { incidents: [], savedAt: null });
    if (!Array.isArray(data.incidents)) data.incidents = [];
    return data;
}

function fingerprint(input) {
    return crypto.createHash('sha256')
        .update([input.code, input.service, input.nodeId || '', input.provider || ''].join('|'))
        .digest('hex').slice(0, 24);
}

function report(input = {}) {
    const data = load();
    const fp = input.fingerprint || fingerprint(input);
    const active = data.incidents.find(item => item.fingerprint === fp && item.status !== 'RECOVERED');
    const now = new Date().toISOString();
    if (active) {
        active.lastSeenAt = now;
        active.occurrences = Number(active.occurrences || 1) + 1;
        active.affectedTasks = unique([...(active.affectedTasks || []), ...(input.affectedTasks || [])]);
        active.affectedNodes = unique([...(active.affectedNodes || []), ...(input.affectedNodes || []), input.nodeId].filter(Boolean));
        save(data);
        return active;
    }
    const incident = {
        id: `inc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        fingerprint: fp,
        code: String(input.code || 'UNKNOWN').slice(0, 80),
        severity: ['INFO', 'WARN', 'HIGH', 'CRITICAL'].includes(input.severity) ? input.severity : 'WARN',
        service: String(input.service || 'gunter').slice(0, 80),
        summary: String(input.summary || input.code || 'Incidente operativo').slice(0, 240),
        impact: String(input.impact || '').slice(0, 500),
        suggestedAction: String(input.suggestedAction || '').slice(0, 500),
        traceId: input.traceId || null,
        affectedNodes: unique([...(input.affectedNodes || []), input.nodeId].filter(Boolean)),
        affectedTasks: unique(input.affectedTasks || []),
        status: 'OPEN',
        occurrences: 1,
        createdAt: now,
        lastSeenAt: now,
        acknowledgedAt: null,
        recoveredAt: null,
        silencedUntil: null
    };
    data.incidents.push(incident);
    if (data.incidents.length > 1000) data.incidents.splice(0, data.incidents.length - 1000);
    save(data);
    observability.record({
        severity: incident.severity, service: 'operations', trace_id: incident.traceId || undefined,
        event_type: 'incident.opened', action: incident.code, status: incident.status,
        error_code: incident.code, error_fingerprint: incident.fingerprint,
        metadata_redacted: { incidentId: incident.id, occurrences: incident.occurrences }
    });
    return incident;
}

function transition(id, action, meta = {}) {
    const data = load();
    const incident = data.incidents.find(item => item.id === id);
    if (!incident) return { ok: false, error: 'incident_not_found' };
    const now = new Date().toISOString();
    if (action === 'acknowledge') { incident.status = 'ACKNOWLEDGED'; incident.acknowledgedAt = now; }
    else if (action === 'recover') { incident.status = 'RECOVERED'; incident.recoveredAt = now; }
    else if (action === 'silence') {
        incident.status = 'SILENCED';
        const minutes = Math.max(1, Math.min(Number(meta.minutes) || 60, 1440));
        incident.silencedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    } else return { ok: false, error: 'invalid_transition' };
    save(data);
    observability.record({
        severity: 'INFO', service: 'operations', trace_id: meta.traceId || undefined,
        event_type: `incident.${action}`, action: incident.code, status: incident.status,
        metadata_redacted: { incidentId: incident.id, actor: String(meta.actor || 'admin').slice(0, 80) }
    });
    return { ok: true, incident };
}

function list({ status = null, severity = null, limit = 100 } = {}) {
    let items = load().incidents;
    if (status) items = items.filter(item => item.status === status);
    if (severity) items = items.filter(item => item.severity === severity);
    return items.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
        .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
}

function stats() {
    const items = load().incidents;
    const active = items.filter(item => item.status !== 'RECOVERED');
    return {
        total: items.length,
        active: active.length,
        critical: active.filter(item => item.severity === 'CRITICAL').length,
        high: active.filter(item => item.severity === 'HIGH').length,
        recovered: items.filter(item => item.status === 'RECOVERED').length
    };
}

function save(data) {
    data.savedAt = new Date().toISOString();
    store.saveJson(FILE, data);
}

function unique(values) { return [...new Set(values.map(String))].slice(0, 200); }

module.exports = { report, transition, list, stats, fingerprint };
