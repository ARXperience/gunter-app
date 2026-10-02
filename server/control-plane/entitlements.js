/* Plans, subscriptions, entitlement snapshots and signed offline leases. */
const crypto = require('crypto');
const store = require('./persistence');
const flags = require('./feature-flags');

const PLANS_FILE = 'plans.json';
const SUBSCRIPTIONS_FILE = 'subscriptions.json';
const BILLING_FILE = 'billing-events.json';
const LEASES_FILE = 'license-leases.json';
const SUBSCRIPTION_STATES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'CANCELED'];
const ALLOWED_STATES = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE']);

const LEGACY_FEATURES = Object.freeze({
    'gunter.now': true,
    'gunter.chat': true,
    'gunter.voice': true,
    'gunter.tasks': true,
    'gunter.calendar': true,
    'gunter.meetings': true,
    'gunter.documents': true,
    'gunter.inbox': true,
    'gunter.settings': true,
    'core.context': true,
    'core.brain': true,
    'core.skills': true,
    'core.policy': true,
    'core.verify': true,
    'desktop.node': true,
    'desktop.apps': true,
    'desktop.files': true,
    'desktop.commands': true,
    'mobile.node': true,
    'mobile.media': true,
    'mobile.messaging': true,
    'cortex.basic': true,
    'automation.basic': true,
    'automation.commitments': true,
    'automation.procedures': true,
    'automation.proactive': true,
    'ai.cloud.standard': true,
    'core.connection': true,
    'integrations.core': true,
    'core.entitlements': true,
    'core.observability': true,
    'security.core': true,
    'quality.gate': true,
    'admin.accounts': true,
    'admin.operations': true,
    'admin.devices': true,
    'admin.billing': true
});

function seedCatalog() {
    const data = store.loadJson(PLANS_FILE, { plans: [], savedAt: null });
    if (!Array.isArray(data.plans)) data.plans = [];
    const legacy = data.plans.find(plan => plan.id === 'legacy_compat');
    if (!legacy) {
        data.plans.unshift({
            id: 'legacy_compat', name: 'Compatibilidad actual', description: 'Preserva las funciones existentes durante la migración.',
            system: true, active: true, currency: null, monthlyPrice: null, trialDays: 0, graceDays: 7,
            limits: { nodes: 5 }, features: { ...LEGACY_FEATURES }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        savePlans(data);
    } else {
        const merged = { ...LEGACY_FEATURES, ...(legacy.features || {}) };
        const limits = { ...(legacy.limits || {}), nodes: Math.max(5, Number(legacy.limits?.nodes) || 0) };
        if (JSON.stringify(merged) !== JSON.stringify(legacy.features || {}) || JSON.stringify(limits) !== JSON.stringify(legacy.limits || {})) {
            legacy.features = merged;
            legacy.limits = limits;
            legacy.updatedAt = new Date().toISOString();
            savePlans(data);
        }
    }
    return data;
}

function listPlans({ includeInactive = false } = {}) {
    return seedCatalog().plans.filter(plan => includeInactive || plan.active !== false).map(safePlan);
}

function getPlan(id) {
    return seedCatalog().plans.find(plan => plan.id === id) || null;
}

function upsertPlan(input = {}, actor = 'admin') {
    const id = slug(input.id || input.name);
    if (!id || id === 'legacy_compat') return { ok: false, error: 'plan_id_invalid' };
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) return { ok: false, error: 'plan_name_invalid' };
    const catalog = seedCatalog();
    const current = catalog.plans.find(plan => plan.id === id);
    const now = new Date().toISOString();
    const knownKeys = new Set(flags.DEFINITIONS.map(item => item.key));
    const features = {};
    for (const [key, raw] of Object.entries(input.features || {})) {
        if (!knownKeys.has(key)) return { ok: false, error: `unknown_feature:${key}` };
        features[key] = normalizeFeatureValue(raw);
    }
    const plan = {
        id, name, description: String(input.description || '').slice(0, 240), system: false,
        active: input.active !== false, currency: input.currency ? String(input.currency).toUpperCase().slice(0, 3) : null,
        monthlyPrice: input.monthlyPrice === null || input.monthlyPrice === undefined ? null : Math.max(0, Number(input.monthlyPrice) || 0),
        trialDays: clamp(input.trialDays, 0, 365, 0), graceDays: clamp(input.graceDays, 0, 90, 7),
        limits: normalizeLimits(input.limits), features,
        createdAt: current?.createdAt || now, updatedAt: now, updatedBy: String(actor)
    };
    if (current) Object.assign(current, plan); else catalog.plans.push(plan);
    savePlans(catalog);
    return { ok: true, plan: safePlan(plan) };
}

function loadSubscriptions() {
    const data = store.loadJson(SUBSCRIPTIONS_FILE, { subscriptions: [], savedAt: null });
    if (!Array.isArray(data.subscriptions)) data.subscriptions = [];
    return data;
}

function getSubscription(userId) {
    const found = loadSubscriptions().subscriptions.find(item => item.userId === userId);
    if (found) return { ...found };
    return {
        id: `sub_legacy_${userId}`, userId, planId: 'legacy_compat', state: 'ACTIVE',
        provider: null, providerCustomerId: null, providerSubscriptionId: null,
        billingAnchor: null, currentPeriodStart: null, currentPeriodEnd: null,
        trialEndsAt: null, graceEndsAt: null, nextRenewalAt: null, virtual: true
    };
}

function listSubscriptions() {
    return loadSubscriptions().subscriptions.map(item => ({ ...item }));
}

function setSubscription(input = {}, actor = 'admin') {
    const userId = String(input.userId || '');
    const plan = getPlan(input.planId);
    const state = String(input.state || 'ACTIVE').toUpperCase();
    if (!userId) return { ok: false, error: 'user_id_required' };
    if (!plan || plan.active === false) return { ok: false, error: 'plan_not_found' };
    if (!SUBSCRIPTION_STATES.includes(state)) return { ok: false, error: 'subscription_state_invalid' };
    const data = loadSubscriptions();
    let subscription = data.subscriptions.find(item => item.userId === userId);
    const now = new Date().toISOString();
    if (!subscription) {
        subscription = { id: `sub_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, userId, createdAt: now };
        data.subscriptions.push(subscription);
    }
    Object.assign(subscription, {
        planId: plan.id, state, provider: input.provider || subscription.provider || null,
        providerCustomerId: input.providerCustomerId || subscription.providerCustomerId || null,
        providerSubscriptionId: input.providerSubscriptionId || subscription.providerSubscriptionId || null,
        billingAnchor: normalizeDay(input.billingAnchor ?? subscription.billingAnchor),
        currentPeriodStart: dateOrNull(input.currentPeriodStart ?? subscription.currentPeriodStart),
        currentPeriodEnd: dateOrNull(input.currentPeriodEnd ?? subscription.currentPeriodEnd),
        trialEndsAt: dateOrNull(input.trialEndsAt ?? subscription.trialEndsAt),
        graceEndsAt: dateOrNull(input.graceEndsAt ?? subscription.graceEndsAt),
        nextRenewalAt: dateOrNull(input.nextRenewalAt ?? subscription.nextRenewalAt),
        updatedAt: now, updatedBy: String(actor)
    });
    data.savedAt = now;
    store.saveJson(SUBSCRIPTIONS_FILE, data);
    return { ok: true, subscription: { ...subscription }, snapshot: snapshot(userId) };
}

function snapshot(userId) {
    const subscription = getSubscription(userId);
    const plan = getPlan(subscription.planId) || getPlan('legacy_compat');
    const commercialAccess = ALLOWED_STATES.has(subscription.state);
    const features = {};
    for (const definition of flags.DEFINITIONS) {
        const configured = plan?.features?.[definition.key];
        const normalized = normalizeFeatureValue(configured);
        const planAllows = typeof normalized === 'object' ? normalized.allowed !== false : normalized === true;
        const allowed = commercialAccess && planAllows;
        features[definition.key] = {
            allowed,
            limit: typeof normalized === 'object' && Number.isFinite(normalized.limit) ? normalized.limit : null,
            scope: typeof normalized === 'object' && normalized.scope && typeof normalized.scope === 'object' ? normalized.scope : {},
            reason: allowed ? 'plan_allows' : commercialAccess ? 'not_in_plan' : `subscription_${subscription.state.toLowerCase()}`
        };
    }
    const generatedAt = new Date().toISOString();
    const result = {
        userId, plan: safePlan(plan), subscription, features, generatedAt,
        hash: store.hash(JSON.stringify({ userId, planId: plan?.id, state: subscription.state, features })).slice(0, 48)
    };
    return result;
}

function check(userId, featureKey) {
    const snap = snapshot(userId);
    return snap.features[featureKey] || { allowed: false, limit: null, scope: {}, reason: 'unknown_feature' };
}

function issueLease(userId, nodeId, options = {}) {
    const snap = snapshot(userId);
    const now = Date.now();
    const ttlHours = clamp(options.ttlHours, 1, 24 * 30, 24 * 7);
    const payload = {
        lease_id: `lease_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        user_id: userId, node_id: nodeId, entitlements_hash: snap.hash,
        issued_at: new Date(now).toISOString(), expires_at: new Date(now + ttlHours * 3600000).toISOString(),
        protocol_version: options.protocolVersion || '1.0.0', features: snap.features
    };
    payload.signature = signLease(payload);
    const data = store.loadJson(LEASES_FILE, { leases: [], savedAt: null });
    if (!Array.isArray(data.leases)) data.leases = [];
    data.leases = data.leases.filter(lease => new Date(lease.expires_at).getTime() > now - 7 * 86400000);
    data.leases.push(payload);
    data.savedAt = payload.issued_at;
    store.saveJson(LEASES_FILE, data);
    return payload;
}

function verifyLease(lease) {
    if (!lease || typeof lease !== 'object') return { ok: false, error: 'lease_required' };
    const expected = signLease(lease);
    const a = Buffer.from(String(lease.signature || ''));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'lease_signature_invalid' };
    if (new Date(lease.expires_at).getTime() <= Date.now()) return { ok: false, error: 'lease_expired' };
    return { ok: true };
}

function recordBillingEvent(input = {}) {
    const providerEventId = String(input.providerEventId || '');
    if (!providerEventId) return { ok: false, error: 'provider_event_id_required' };
    const data = store.loadJson(BILLING_FILE, { events: [], savedAt: null });
    if (!Array.isArray(data.events)) data.events = [];
    const duplicate = data.events.find(event => event.providerEventId === providerEventId && event.provider === input.provider);
    if (duplicate) return { ok: true, duplicate: true, event: duplicate };
    const event = {
        id: `bill_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        subscriptionId: input.subscriptionId || null, providerEventId, provider: String(input.provider || 'manual'),
        type: String(input.type || 'unknown'), amount: input.amount == null ? null : Number(input.amount),
        currency: input.currency ? String(input.currency).toUpperCase().slice(0, 3) : null,
        status: String(input.status || 'received'), occurredAt: dateOrNull(input.occurredAt) || new Date().toISOString(),
        receivedAt: new Date().toISOString()
    };
    data.events.push(event);
    data.savedAt = event.receivedAt;
    store.saveJson(BILLING_FILE, data);
    return { ok: true, duplicate: false, event };
}

function listBillingEvents({ limit = 100 } = {}) {
    const data = store.loadJson(BILLING_FILE, { events: [] });
    return (Array.isArray(data.events) ? data.events : []).slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse();
}

function purgeUser(userId) {
    const subscriptions = loadSubscriptions();
    const removedIds = new Set(subscriptions.subscriptions.filter(item => item.userId === userId).map(item => item.id));
    const beforeSubscriptions = subscriptions.subscriptions.length;
    subscriptions.subscriptions = subscriptions.subscriptions.filter(item => item.userId !== userId);
    subscriptions.savedAt = new Date().toISOString();
    store.saveJson(SUBSCRIPTIONS_FILE, subscriptions);
    const leases = store.loadJson(LEASES_FILE, { leases: [] });
    if (!Array.isArray(leases.leases)) leases.leases = [];
    const beforeLeases = leases.leases.length;
    leases.leases = leases.leases.filter(item => item.user_id !== userId);
    leases.savedAt = new Date().toISOString();
    store.saveJson(LEASES_FILE, leases);
    const billing = store.loadJson(BILLING_FILE, { events: [] });
    if (!Array.isArray(billing.events)) billing.events = [];
    const beforeBilling = billing.events.length;
    billing.events = billing.events.filter(item => !removedIds.has(item.subscriptionId));
    billing.savedAt = new Date().toISOString();
    store.saveJson(BILLING_FILE, billing);
    return { subscriptions: beforeSubscriptions - subscriptions.subscriptions.length, leases: beforeLeases - leases.leases.length, billingEvents: beforeBilling - billing.events.length };
}

function signLease(lease) {
    const copy = { ...lease };
    delete copy.signature;
    return crypto.createHmac('sha256', store.getOrCreateSecret('license-signing.key')).update(stableStringify(copy)).digest('base64url');
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function savePlans(data) { data.savedAt = new Date().toISOString(); store.saveJson(PLANS_FILE, data); }
function safePlan(plan) { if (!plan) return null; const { updatedBy, ...safe } = plan; return { ...safe }; }
function normalizeFeatureValue(value) {
    if (value === true || value === false) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return { allowed: value.allowed !== false, limit: Number.isFinite(Number(value.limit)) ? Number(value.limit) : null, scope: value.scope && typeof value.scope === 'object' ? value.scope : {} };
}
function normalizeLimits(value) { const out = {}; for (const [k, v] of Object.entries(value || {})) if (Number.isFinite(Number(v)) && Number(v) >= 0) out[String(k).slice(0, 80)] = Number(v); return out; }
function slug(value) { return String(value || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64); }
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback; }
function normalizeDay(value) { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null; }
function dateOrNull(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }

module.exports = {
    SUBSCRIPTION_STATES, listPlans, getPlan, upsertPlan, getSubscription, listSubscriptions, setSubscription,
    snapshot, check, issueLease, verifyLease, recordBillingEvent, listBillingEvents, purgeUser, _seedCatalog: seedCatalog
};
