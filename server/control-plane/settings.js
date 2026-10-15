/* User-facing capability settings: one toggle plus progressive advanced config. */
const path = require('path');
const fs = require('fs');
const userStore = require('../user-store');
const persistence = require('./persistence');
const flags = require('./feature-flags');
const entitlements = require('./entitlements');

const REGISTRY = Object.freeze([
    setting('voice.continuous', 'Voz continua', 'gunter.voice', true, ['wakeWord', 'microphone', 'vad', 'bargeIn', 'ttsVoice', 'privacyMode']),
    setting('memory.cortex', 'Memoria', 'cortex.basic', false, ['memoryTypes', 'retentionDays', 'privacyMode', 'syncEnabled']),
    setting('memory.semantic', 'Memoria semántica', 'cortex.semantic', false, ['sources', 'confidenceThreshold', 'retentionDays', 'localOnly']),
    setting('memory.graph', 'Mapa de conocimiento', 'cortex.graph', false, ['sources', 'confidenceThreshold', 'retentionDays', 'localOnly']),
    setting('memory.learning', 'Aprendizaje de errores', 'cortex.learning', false, ['retentionDays', 'reviewRequired', 'localOnly']),
    setting('documents.search', 'Documentos y archivos', 'gunter.documents', true, ['allowedFolders', 'allowedTypes', 'retentionDays', 'localOnly']),
    setting('inbox.universal', 'Bandeja universal', 'gunter.inbox', true, ['allowedProviders', 'priorityContacts', 'quietHours', 'healthAlerts']),
    setting('desktop.control', 'Control del PC', 'desktop.node', false, ['allowedApps', 'allowedFolders', 'filesystemScope', 'programScope', 'confirmationLevel', 'autonomyLevel']),
    setting('mobile.control', 'Control del móvil', 'mobile.node', false, ['media', 'messaging', 'files', 'storageScope', 'location', 'camera', 'confirmationLevel']),
    setting('desktop.screen', 'Pantalla', 'desktop.screen', false, ['allowedApps', 'captureMode', 'retentionMinutes', 'localOnly']),
    setting('mobile.camera', 'Cámara', 'mobile.camera', false, ['sessionOnly', 'retentionMinutes', 'localOnly']),
    setting('automation.proactive', 'Proactividad', 'automation.proactive', true, ['quietHours', 'channels', 'interruptThreshold', 'priorityContexts']),
    setting('automation.missions', 'Misiones', 'automation.missions', false, ['planningHorizon', 'reviewCadence', 'budgetLimit', 'autonomyLevel']),
    setting('automation.procedures', 'Automatizaciones', 'automation.procedures', false, ['triggers', 'limits', 'schedules', 'autonomyLevel']),
    setting('ai.local', 'IA local', 'ai.local', false, ['model', 'cpuLimit', 'gpuEnabled', 'ramLimitMb', 'storageLimitMb']),
    setting('ai.cloud', 'Cloud AI', 'ai.cloud.standard', true, ['providers', 'privacyMode', 'monthlyBudget', 'fallback']),
    setting('connection.sync', 'Conexión y sincronización', 'core.connection', true, ['offlineQueueLimit', 'reconnectPolicy', 'syncEnabled', 'healthAlerts']),
    setting('integrations', 'Integraciones', 'integrations.core', true, ['allowedProviders', 'healthAlerts', 'reconnectPolicy'])
]);

function fileFor(userId) { return path.join(userStore.userDir(userId), 'control-settings.json'); }

function load(userId) {
    try {
        const file = fileFor(userId);
        if (!fs.existsSync(file)) return { version: 1, values: {}, savedAt: null };
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data.values || typeof data.values !== 'object') data.values = {};
        return data;
    } catch (error) {
        console.warn('[control/settings] read:', error.message);
        return { version: 1, values: {}, savedAt: null };
    }
}

function save(userId, data) {
    const file = fileFor(userId);
    const temp = path.join(path.dirname(file), `.control-settings-${process.pid}-${Date.now()}.tmp`);
    data.savedAt = new Date().toISOString();
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, file); }
    catch { fs.copyFileSync(temp, file); fs.unlinkSync(temp); }
}

function list(userId, actor = {}) {
    const data = load(userId);
    const snapshot = entitlements.snapshot(userId);
    return REGISTRY.map(definition => {
        const stored = data.values[definition.key] || {};
        const entitlement = snapshot.features[definition.entitlement] || { allowed: false, reason: 'unknown_entitlement' };
        const flag = flags.evaluate(definition.entitlement, actor);
        const available = entitlement.allowed && flag.enabled;
        return {
            ...definition,
            enabled: stored.enabled === undefined ? definition.defaultEnabled && available : !!stored.enabled && available,
            requestedEnabled: stored.enabled === undefined ? definition.defaultEnabled : !!stored.enabled,
            advanced: sanitizeAdvanced(definition, stored.advanced),
            available,
            lockedReason: !entitlement.allowed ? entitlement.reason : !flag.enabled ? flag.reason : null,
            planId: snapshot.plan?.id || null,
            updatedAt: stored.updatedAt || null
        };
    });
}

function patch(userId, input = {}, actor = {}) {
    const definition = REGISTRY.find(item => item.key === input.key);
    if (!definition) return { ok: false, error: 'setting_not_found' };
    const entitlement = entitlements.check(userId, definition.entitlement);
    const flag = flags.evaluate(definition.entitlement, actor);
    if (input.enabled === true && !entitlement.allowed) return { ok: false, error: 'entitlement_required', reason: entitlement.reason };
    if (input.enabled === true && !flag.enabled) return { ok: false, error: 'feature_not_available', reason: flag.reason };
    const data = load(userId);
    const current = data.values[definition.key] || {};
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return { ok: false, error: 'setting_value_invalid' };
    if (Object.hasOwn(input, 'baseUpdatedAt') && (input.baseUpdatedAt || null) !== (current.updatedAt || null))
        return { ok: false, error: 'setting_changed' };
    if (input.advanced !== undefined) {
        const invalid = validateAdvanced(definition, input.advanced, current.advanced);
        if (invalid) return { ok: false, error: 'setting_advanced_invalid', field: invalid };
    }
    const value = {
        enabled: input.enabled === undefined ? current.enabled === undefined ? definition.defaultEnabled : !!current.enabled : input.enabled,
        advanced: input.advanced === undefined ? sanitizeAdvanced(definition, current.advanced) : sanitizeAdvanced(definition, input.advanced),
        updatedAt: new Date().toISOString(), updatedBy: actor.userId || actor.kind || 'user'
    };
    data.values[definition.key] = value;
    save(userId, data);
    return { ok: true, setting: list(userId, actor).find(item => item.key === definition.key) };
}

function sanitizeAdvanced(definition, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const allowed = new Set(definition.advancedFields);
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!allowed.has(key)) continue;
        if (Array.isArray(raw)) out[key] = raw.map(item => String(item).slice(0, 160)).slice(0, 100);
        else if (raw && typeof raw === 'object') out[key] = JSON.parse(JSON.stringify(raw));
        else if (['string', 'number', 'boolean'].includes(typeof raw) || raw === null) out[key] = typeof raw === 'string' ? raw.slice(0, 500) : raw;
    }
    return out;
}

function setting(key, label, entitlement, defaultEnabled, advancedFields) {
    return { key, label, entitlement, defaultEnabled, advancedFields,
        advancedSchema: Object.fromEntries(advancedFields.map(field => [field, fieldSchema(field)])), description: descriptionFor(key) };
}
function fieldSchema(field) {
    if (/^(syncEnabled|localOnly|reviewRequired|healthAlerts|media|messaging|files|location|camera|sessionOnly|gpuEnabled|fallback|vad|bargeIn)$/.test(field)) return { type: 'boolean' };
    if (/^(memoryTypes|sources|allowedFolders|allowedTypes|allowedProviders|priorityContacts|allowedApps|channels|priorityContexts|providers)$/.test(field)) return { type: 'array', maxItems: 100, maxLength: 160 };
    if (/^(quietHours|triggers|limits|schedules)$/.test(field)) return { type: 'object', maxLength: 8192 };
    if (/^(filesystemScope|programScope)$/.test(field)) return { type: 'enum', values: ['standard', 'all'] };
    if (field === 'autonomyLevel') return { type: 'enum', values: ['L0', 'L1', 'L2', 'L3', 'L4'] };
    if (/^(confidenceThreshold|interruptThreshold)$/.test(field)) return { type: 'number', min: 0, max: 1, unit: 'fracción (0–1)' };
    if (field === 'cpuLimit') return { type: 'number', min: 0, max: 100, unit: '%' };
    if (/Days$/.test(field)) return { type: 'number', min: 0, max: 36500, integer: true, unit: 'días' };
    if (/Minutes$/.test(field)) return { type: 'number', min: 0, max: 525600, integer: true, unit: 'minutos' };
    if (/Mb$/.test(field)) return { type: 'number', min: 0, max: 2147483647, integer: true, unit: 'MB' };
    if (/Budget|budgetLimit/.test(field)) return { type: 'number', min: 0, max: 1000000000 };
    if (field === 'offlineQueueLimit') return { type: 'number', min: 0, max: 100000, integer: true };
    return { type: 'string', maxLength: 500 };
}
function validateAdvanced(definition, value, previous = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'advanced';
    for (const [field, input] of Object.entries(value)) {
        const rule = definition.advancedSchema[field];
        if (!rule) return field;
        // Existing snapshots remain readable/editable: an unrelated change
        // must not silently rewrite or reject a legacy field kept identical.
        if (Object.hasOwn(previous || {}, field) && JSON.stringify(previous[field]) === JSON.stringify(input)) continue;
        if (input === null || input === '') continue; // Optional fields may be cleared.
        if (rule.type === 'boolean' && typeof input !== 'boolean') return field;
        if (rule.type === 'enum' && !rule.values.includes(input)) return field;
        if (rule.type === 'number' && (typeof input !== 'number' || !Number.isFinite(input) || input < rule.min || input > rule.max || (rule.integer && !Number.isInteger(input)))) return field;
        if (rule.type === 'array' && (!Array.isArray(input) || input.length > rule.maxItems || input.some(item => typeof item !== 'string' || item.length > rule.maxLength))) return field;
        if (rule.type === 'string' && (typeof input !== 'string' || input.length > rule.maxLength)) return field;
        if (rule.type === 'object' && (typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > rule.maxLength || /"(?:__proto__|constructor|prototype)"\s*:/.test(JSON.stringify(input)))) return field;
    }
    return null;
}
// Hybrid preferences are stored with the existing per-user settings file. No
// data is migrated and AUTO is deliberately identical to the legacy route.
const HYBRID_MODES = Object.freeze(['AUTO', 'CLOUD', 'LOCAL']);
const PRIVACY_MODES = Object.freeze(['STANDARD', 'LOCAL_ONLY']);
function hybridStatus(userId) {
    const saved = load(userId).hybrid || {};
    return {
        mode: HYBRID_MODES.includes(saved.mode) ? saved.mode : 'AUTO',
        privacy: PRIVACY_MODES.includes(saved.privacy) ? saved.privacy : 'STANDARD',
        updatedAt: saved.updatedAt || null
    };
}
function patchHybrid(userId, input = {}) {
    if (input.mode !== undefined && !HYBRID_MODES.includes(input.mode)) return { ok: false, error: 'INVALID_HYBRID_MODE' };
    if (input.privacy !== undefined && !PRIVACY_MODES.includes(input.privacy)) return { ok: false, error: 'INVALID_PRIVACY_MODE' };
    const data = load(userId);
    data.hybrid = { ...hybridStatus(userId), ...(input.mode === undefined ? {} : { mode: input.mode }),
        ...(input.privacy === undefined ? {} : { privacy: input.privacy }), updatedAt: new Date().toISOString() };
    save(userId, data);
    return { ok: true, ...data.hybrid };
}
function descriptionFor(key) {
    return ({
        'voice.continuous': 'Escucha, interrupción y respuesta por voz con privacidad configurable.',
        'memory.cortex': 'Memoria gobernada con procedencia, retención y sincronización.',
        'memory.semantic': 'Recuerdos conectados por significado, siempre con fuente y confianza.',
        'memory.graph': 'Relaciones entre personas, proyectos y documentos sin fusiones automáticas.',
        'memory.learning': 'Candidatos de mejora revisables; nunca cambia seguridad ni permisos por sí solo.',
        'documents.search': 'Fuentes y límites para la búsqueda personal de documentos.',
        'inbox.universal': 'Prioriza comunicaciones conectadas sin enviar nada sin autorización.',
        'desktop.control': 'Aplicaciones, archivos, multimedia y controles accesibles del PC. Escribir o pulsar siempre requiere confirmación.',
        'mobile.control': 'Media, mensajes y capacidades compatibles del teléfono.',
        'desktop.screen': 'Percepción de pantalla solo con permisos e indicadores visibles.',
        'mobile.camera': 'Captura de cámara limitada a sesiones autorizadas.',
        'automation.proactive': 'Briefings y avisos según prioridad y horas de silencio.',
        'automation.missions': 'Objetivos persistentes con criterios, bloqueos y próximos pasos.',
        'automation.procedures': 'Rutinas aprendidas, simuladas y aprobadas antes de ejecutarse.',
        'ai.local': 'Modelos locales según hardware, almacenamiento y plan.',
        'ai.cloud': 'Modelos cloud con presupuesto, privacidad y fallback.',
        'connection.sync': 'Cola offline, reconexión y salud entre Web, Desktop y Mobile.',
        integrations: 'Conexiones externas, salud, permisos y reconexión.'
    })[key] || '';
}

module.exports = { REGISTRY, list, patch, hybridStatus, patchHybrid, HYBRID_MODES, PRIVACY_MODES, validateAdvanced, _load: load };
