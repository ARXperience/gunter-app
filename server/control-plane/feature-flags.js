/* Versioned rollout flags. New capabilities remain OFF until explicitly promoted. */
const store = require('./persistence');

const STATES = ['off', 'admin_only', 'canary', 'on'];
const FILE = 'feature-flags.json';
const DEFINITIONS = Object.freeze([
    ['gunter.now', 'on'], ['gunter.chat', 'on'], ['gunter.voice', 'on'], ['gunter.tasks', 'on'], ['gunter.calendar', 'on'],
    ['gunter.meetings', 'on'], ['gunter.documents', 'on'], ['gunter.inbox', 'on'], ['gunter.settings', 'on'],
    ['core.context', 'on'], ['core.brain', 'on'], ['core.skills', 'on'], ['core.policy', 'on'], ['core.verify', 'on'],
    ['desktop.node', 'on'], ['desktop.apps', 'on'], ['desktop.files', 'on'], ['desktop.screen', 'off'], ['desktop.commands', 'on'],
    ['mobile.node', 'on'], ['mobile.media', 'on'], ['mobile.messaging', 'on'], ['mobile.location', 'off'], ['mobile.camera', 'off'], ['mobile.local_ai', 'off'],
    ['cortex.basic', 'on'], ['cortex.semantic', 'off'], ['cortex.graph', 'off'], ['cortex.learning', 'off'], ['cortex.export', 'admin_only'],
    ['automation.basic', 'on'], ['automation.commitments', 'on'], ['automation.procedures', 'on'], ['automation.missions', 'off'], ['automation.proactive', 'on'],
    ['ai.local', 'off'], ['ai.cloud.standard', 'on'], ['ai.cloud.reasoning', 'admin_only'], ['ai.vision', 'admin_only'],
    ['browser.agent', 'off'], ['core.connection', 'on'], ['integrations.core', 'on'], ['core.entitlements', 'on'], ['core.observability', 'admin_only'],
    ['admin.accounts', 'on'], ['admin.billing', 'admin_only'], ['admin.devices', 'admin_only'], ['admin.operations', 'admin_only'], ['admin.releases', 'admin_only'],
    ['billing.recurring', 'off'], ['security.core', 'on'], ['quality.gate', 'admin_only'], ['evolution.skill_forge', 'off']
].map(([key, defaultState]) => ({ key, defaultState })));

function load() {
    const saved = store.loadJson(FILE, { version: 1, flags: {}, updatedAt: null });
    if (!saved.flags || typeof saved.flags !== 'object') saved.flags = {};
    return saved;
}

function recordFor(key) {
    const definition = DEFINITIONS.find(item => item.key === key);
    if (!definition) return null;
    const saved = load().flags[key] || {};
    return {
        key,
        state: STATES.includes(saved.state) ? saved.state : definition.defaultState,
        canaryUsers: Array.isArray(saved.canaryUsers) ? saved.canaryUsers : [],
        updatedAt: saved.updatedAt || null,
        updatedBy: saved.updatedBy || null
    };
}

function evaluate(key, actor = {}) {
    const flag = recordFor(key);
    if (!flag) return { key, exists: false, enabled: false, reason: 'unknown_feature' };
    let enabled = false;
    let reason = flag.state;
    if (flag.state === 'on') enabled = true;
    if (flag.state === 'admin_only') enabled = actor.role === 'admin' || actor.kind === 'service';
    if (flag.state === 'canary') enabled = actor.role === 'admin' || actor.kind === 'service' || flag.canaryUsers.includes(actor.userId);
    if (!enabled && flag.state === 'admin_only') reason = 'admin_only';
    if (!enabled && flag.state === 'canary') reason = 'not_in_canary';
    return { ...flag, exists: true, enabled, reason };
}

function list(actor = {}) {
    return DEFINITIONS.map(({ key }) => evaluate(key, actor));
}

function set(key, patch = {}, actor = 'admin') {
    const definition = DEFINITIONS.find(item => item.key === key);
    if (!definition) return { ok: false, error: 'unknown_feature' };
    if (!STATES.includes(patch.state)) return { ok: false, error: 'invalid_state' };
    const data = load();
    data.flags[key] = {
        state: patch.state,
        canaryUsers: patch.state === 'canary' && Array.isArray(patch.canaryUsers)
            ? [...new Set(patch.canaryUsers.map(String))].slice(0, 500)
            : [],
        updatedAt: new Date().toISOString(),
        updatedBy: String(actor || 'admin')
    };
    data.updatedAt = data.flags[key].updatedAt;
    store.saveJson(FILE, data);
    return { ok: true, flag: recordFor(key) };
}

function stats(actor = {}) {
    const items = list(actor);
    return {
        total: items.length,
        enabled: items.filter(item => item.enabled).length,
        byState: Object.fromEntries(STATES.map(state => [state, items.filter(item => item.state === state).length]))
    };
}

module.exports = { STATES, DEFINITIONS, evaluate, list, set, stats, _load: load };
