'use strict';

// Bridge policy never grants access to the bridge owner's private data.
const auth = require('../auth/store');
const userContext = require('../user-context');
const settings = require('../control-plane/settings');
const flags = require('../control-plane/feature-flags');
const router = require('../control-plane/model-router');

function approved(user) { return user?.id && user.status === 'approved' ? user : null; }
function resolveSender(ctx = {}) {
    const jid = String(ctx.jid || ctx.from || '');
    const parts = jid.split('@');
    if (parts.length > 2 || (parts.length === 2 && !['s.whatsapp.net', 'lid'].includes(parts[1])))
        return { allowed: false, reason: 'unsupported_chat' };
    const isLid = parts[1] === 'lid';
    if (!(isLid ? /^\d{6,24}$/ : /^\d{8,15}$/).test(parts[0])) return { allowed:false, reason:'invalid_sender' };
    // A LID alone is not a phone. Only Baileys' authenticated alternate JID
    // or its local LID mapping may resolve it to the account's linked number.
    const mapped = isLid && /^\d{8,15}@s\.whatsapp\.net$/.test(String(ctx.phoneJid || '')) ? ctx.phoneJid.split('@')[0] : null;
    const rawPhone = mapped || parts[0];
    const matched = !isLid || mapped ? auth.findByPhone(rawPhone) : null;
    if (matched && !approved(matched)) return { allowed: false, reason: 'account_not_approved' };
    const user = approved(matched);
    const owner = approved(auth.findById(ctx.policyUserId || userContext.ownerId()));
    return {
        allowed: true, phone: rawPhone, jid, userId: user?.id || null,
        user: user ? { id: user.id, role: user.role, status: user.status } : null,
        policyUserId: user?.id || owner?.id || null,
        bridgePolicyUserId: owner?.id || null
    };
}

function policyFor(access, kind = 'chat') {
    if (!access.allowed || !access.policyUserId) return { ok: false, ignored: true, code: 'bridge_policy_unavailable' };
    const actor = access.user ? { ...access.user, userId: access.userId, kind: 'user' } : { kind: 'public' };
    if (!flags.evaluate('gunter.chat', actor).enabled || !flags.evaluate('integrations.core', actor).enabled)
        return { ok: false, ignored: true, code: 'feature_disabled' };
    const entries = settings.list(access.policyUserId, actor);
    const integrations = entries.find(item => item.key === 'integrations');
    if (!integrations?.enabled || (integrations.advanced?.allowedProviders?.length &&
        !integrations.advanced.allowedProviders.includes('whatsapp')))
        return { ok: false, ignored: true, code: 'integration_disabled' };
    let preferences = settings.hybridStatus(access.policyUserId);
    let hostEntries = entries;
    if (access.bridgePolicyUserId && access.bridgePolicyUserId !== access.policyUserId) {
        const hostPreferences = settings.hybridStatus(access.bridgePolicyUserId);
        hostEntries = settings.list(access.bridgePolicyUserId, { kind: 'public' });
        const hostIntegration = hostEntries.find(item => item.key === 'integrations');
        if (!hostIntegration?.enabled || (hostIntegration.advanced?.allowedProviders?.length &&
            !hostIntegration.advanced.allowedProviders.includes('whatsapp')))
            return { ok: false, ignored: true, code: 'integration_disabled' };
        if (hostPreferences.privacy === 'LOCAL_ONLY' || hostPreferences.mode === 'LOCAL')
            preferences = { ...preferences, ...hostPreferences };
    }
    const cloud = entries.find(item => item.key === 'ai.cloud');
    const hostCloud = hostEntries.find(item => item.key === 'ai.cloud');
    if ([cloud, hostCloud].some(item => ['LOCAL_ONLY', 'never_cloud'].includes(item?.advanced?.privacyMode)))
        preferences = { ...preferences, privacy: 'LOCAL_ONLY' };
    const decision = router.resolveHybrid(kind, preferences, actor);
    if (!decision.ok) return { ...decision, ignored: false };
    if (decision.provider === 'cloud' && (!cloud?.enabled || !hostCloud?.enabled))
        return { ok: false, ignored: true, code: 'cloud_disabled' };
    const memory = entries.find(item => item.key === 'memory.cortex');
    return { ...decision, actor, preferences, cloud: cloud?.advanced || {}, hostCloud: hostCloud?.advanced || {},
        memoryAllowed: !!access.userId && memory?.enabled === true,
        logAllowed: !!access.userId && memory?.enabled === true };
}

function inSenderContext(access, callback) {
    // Never runAs(null): that API intentionally falls back to owner elsewhere.
    return userContext.runAs(access.userId || '_whatsapp_public', callback);
}

module.exports = { resolveSender, policyFor, inSenderContext };
