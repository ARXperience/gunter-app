/* Gunter contracts v1 — stable shapes shared by Web, Desktop and Mobile. */
const VERSION = '1.0.0';

const schemas = Object.freeze({
    context_envelope: {
        required: ['context_id', 'trace_id', 'version', 'user_id_hash', 'channel', 'now', 'input', 'sources'],
        properties: {
            context_id: 'string', trace_id: 'string', version: 'semver', user_id_hash: 'string',
            channel: 'string', session_id: 'string|null', node_id: 'string|null', now: 'iso_date',
            locale: 'string', timezone: 'string', input: 'object', references: 'object',
            current: 'object', sources: 'array', needs_clarification: 'boolean'
        }
    },
    graph_entity: {
        required: ['entity_id', 'type', 'label', 'source', 'confidence'],
        properties: { entity_id: 'string', type: 'string', label: 'string', source: 'object', confidence: 'number', attributes: 'object' }
    },
    learning_candidate: {
        required: ['candidate_id', 'state', 'domain', 'fingerprint', 'created_at'],
        properties: { candidate_id: 'string', state: 'string', domain: 'string', fingerprint: 'string', evidence: 'array', created_at: 'iso_date' }
    },
    task_run: {
        required: ['task_id', 'trace_id', 'user_id', 'intent', 'state'],
        properties: {
            task_id: 'string', trace_id: 'string', user_id: 'string', node_id: 'string|null',
            intent: 'string', plan: 'array', state: 'task_state', priority: 'priority',
            evidence: 'array', errors: 'array', result: 'object|null'
        }
    },
    skill: {
        required: ['name', 'version', 'risk', 'permissions', 'supported_nodes'],
        properties: {
            name: 'skill_key', version: 'semver', input_schema: 'object', output_schema: 'object',
            risk: 'risk', permissions: 'array', entitlement: 'feature_key|null',
            supported_nodes: 'array', autonomy_max: 'autonomy', timeout_ms: 'number', retry_policy: 'object'
        }
    },
    node: {
        required: ['node_id', 'user_id', 'node_type', 'device_name', 'protocol_version', 'capabilities'],
        properties: {
            node_id: 'string', user_id: 'string', node_type: 'node_type', device_name: 'string',
            os: 'string', os_version: 'string', app_version: 'string', protocol_version: 'semver',
            capabilities: 'array', trust_state: 'trust_state', state: 'node_state', last_seen_at: 'iso_date|null'
        }
    },
    entitlement: {
        required: ['user_id', 'plan_id', 'feature_key', 'allowed', 'effective_at'],
        properties: {
            user_id: 'string', plan_id: 'string', feature_key: 'feature_key', allowed: 'boolean',
            limit: 'number|null', scope: 'object', effective_at: 'iso_date', expires_at: 'iso_date|null'
        }
    },
    license_lease: {
        required: ['lease_id', 'user_id', 'node_id', 'entitlements_hash', 'issued_at', 'expires_at', 'signature'],
        properties: {
            lease_id: 'string', user_id: 'string', node_id: 'string', entitlements_hash: 'string',
            issued_at: 'iso_date', expires_at: 'iso_date', signature: 'string', protocol_version: 'semver'
        }
    },
    log_event: {
        required: ['timestamp', 'severity', 'service', 'trace_id', 'event_type', 'status'],
        properties: {
            timestamp: 'iso_date', severity: 'severity', environment: 'string', service: 'string',
            trace_id: 'string', span_id: 'string|null', task_id: 'string|null', mission_id: 'string|null',
            user_id_hash: 'string|null', node_id: 'string|null', event_type: 'string', action: 'string|null',
            skill: 'string|null', skill_version: 'string|null', provider: 'string|null', model: 'string|null',
            duration_ms: 'number|null', status: 'string', error_code: 'string|null',
            error_fingerprint: 'string|null', retry_count: 'number', evidence_ref: 'string|null', metadata_redacted: 'object'
        }
    },
    alert_event: {
        required: ['incident_id', 'severity', 'code', 'status', 'created_at'],
        properties: {
            incident_id: 'string', severity: 'severity', code: 'string', service: 'string', status: 'incident_state',
            affected_nodes: 'array', affected_tasks: 'array', summary: 'string', created_at: 'iso_date', recovered_at: 'iso_date|null'
        }
    },
    billing_event: {
        required: ['subscription_id', 'provider_event_id', 'type', 'status', 'occurred_at'],
        properties: {
            subscription_id: 'string', provider_event_id: 'string', type: 'string', amount: 'number|null',
            currency: 'string|null', status: 'string', occurred_at: 'iso_date'
        }
    }
});

const enums = Object.freeze({
    task_state: ['requested', 'understanding', 'planning', 'waiting_confirmation', 'authorized', 'started', 'result_received', 'verifying', 'verified', 'verification_failed', 'paused', 'completed', 'failed', 'cancelled'],
    priority: ['low', 'normal', 'high', 'urgent'],
    risk: ['read', 'local_device_action', 'external_write', 'sensitive', 'destructive', 'financial', 'security'],
    autonomy: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'],
    node_type: ['WEB', 'DESKTOP', 'ANDROID', 'IOS'],
    node_state: ['REGISTERED', 'ONLINE', 'DEGRADED', 'OFFLINE', 'SYNCING', 'REVOKED'],
    trust_state: ['UNVERIFIED', 'TRUSTED', 'REVOKED'],
    severity: ['INFO', 'WARN', 'HIGH', 'CRITICAL'],
    incident_state: ['OPEN', 'ACKNOWLEDGED', 'SILENCED', 'RECOVERED']
});

function validate(name, value) {
    const schema = schemas[name];
    if (!schema) return { ok: false, errors: [`unknown_contract:${name}`] };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['object_required'] };
    const errors = [];
    for (const field of schema.required) {
        if (value[field] === undefined || value[field] === null || value[field] === '') errors.push(`required:${field}`);
    }
    for (const [field, type] of Object.entries(schema.properties)) {
        if (value[field] === undefined || value[field] === null) continue;
        if (enums[type] && !enums[type].includes(value[field])) errors.push(`enum:${field}`);
        if (type === 'array' && !Array.isArray(value[field])) errors.push(`array:${field}`);
        if (type === 'object' && (typeof value[field] !== 'object' || Array.isArray(value[field]))) errors.push(`object:${field}`);
        if (type === 'boolean' && typeof value[field] !== 'boolean') errors.push(`boolean:${field}`);
        if (type === 'number' && typeof value[field] !== 'number') errors.push(`number:${field}`);
    }
    return { ok: errors.length === 0, errors };
}

function catalog() {
    return { version: VERSION, schemas, enums };
}

module.exports = { VERSION, schemas, enums, validate, catalog };
