/* Skill Registry + policy + evidence-based verification. */
const entitlements = require('./entitlements');
const flags = require('./feature-flags');

const AUTONOMY = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const IMPACT = Object.freeze({ read: 'READ_ONLY', local_device_action: 'LOCAL_LOW_RISK',
    sensitive: 'LOCAL_SENSITIVE', security: 'LOCAL_SENSITIVE', external_write: 'EXTERNAL_SIDE_EFFECT',
    destructive: 'EXTERNAL_SIDE_EFFECT', financial: 'EXTERNAL_SIDE_EFFECT' });
const REGISTRY = Object.freeze([
    skill('agenda.list', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.calendar', 'read', 'L4', []),
    skill('tasks.create', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.tasks', 'external_write', 'L4', ['tasks.write']),
    skill('tasks.complete', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.tasks', 'external_write', 'L3', ['tasks.write']),
    skill('tasks.reopen', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.tasks', 'external_write', 'L3', ['tasks.write']),
    skill('tasks.update', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.tasks', 'external_write', 'L3', ['tasks.write']),
    skill('calendar.read', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.calendar', 'read', 'L4', ['calendar.read']),
    skill('calendar.create', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'gunter.calendar', 'external_write', 'L3', ['calendar.write']),
    skill('reminder.schedule', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'automation.basic', 'external_write', 'L4', ['jobs.write']),
    skill('follow_up.schedule', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'automation.basic', 'external_write', 'L4', ['jobs.write']),
    skill('procedure.execute', ['WEB'], 'automation.procedures', 'external_write', 'L3', ['procedures.execute']),
    skill('desktop.apps.open', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.apps.open']),
    skill('desktop.browser.open', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.browser.control']),
    skill('desktop.browser.search', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.browser.control']),
    skill('desktop.browser.youtube.play', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.browser.control']),
    skill('desktop.apps.discover', ['DESKTOP'], 'desktop.apps', 'read', 'L4', ['desktop.apps.read']),
    skill('desktop.permissions.update', ['DESKTOP'], 'desktop.node', 'security', 'L2', ['desktop.permissions.write']),
    skill('desktop.files.open', ['DESKTOP'], 'desktop.files', 'local_device_action', 'L3', ['desktop.files.read']),
    skill('desktop.files.latest', ['DESKTOP'], 'desktop.files', 'read', 'L4', ['desktop.files.read']),
    skill('desktop.files.list', ['DESKTOP'], 'desktop.files', 'read', 'L4', ['desktop.files.read']),
    skill('desktop.files.search', ['DESKTOP'], 'desktop.files', 'read', 'L4', ['desktop.files.read']),
    skill('desktop.media.play_pause', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.next', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.previous', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.stop', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.volume_up', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.volume_down', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.media.mute', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L4', ['desktop.media.control']),
    skill('desktop.ui.inspect', ['DESKTOP'], 'desktop.apps', 'read', 'L3', ['desktop.ui.inspect']),
    skill('desktop.ui.capture_target', ['DESKTOP'], 'desktop.apps', 'sensitive', 'L2', ['desktop.ui.capture_target']),
    skill('desktop.ui.focus', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.ui.focus']),
    skill('desktop.ui.click', ['DESKTOP'], 'desktop.apps', 'external_write', 'L3', ['desktop.ui.click']),
    skill('desktop.ui.type', ['DESKTOP'], 'desktop.apps', 'external_write', 'L3', ['desktop.ui.type']),
    skill('desktop.ui.wait', ['DESKTOP'], 'desktop.apps', 'read', 'L4', ['desktop.ui.inspect']),
    skill('desktop.ui.scroll', ['DESKTOP'], 'desktop.apps', 'local_device_action', 'L3', ['desktop.ui.scroll']),
    skill('desktop.ui.hotkey', ['DESKTOP'], 'desktop.apps', 'external_write', 'L3', ['desktop.ui.hotkey']),
    skill('desktop.ui.select_file', ['DESKTOP'], 'desktop.apps', 'external_write', 'L3', ['desktop.files.read', 'desktop.ui.click']),
    skill('desktop.screen.inspect', ['DESKTOP'], 'desktop.screen', 'sensitive', 'L3', ['desktop.screen.capture']),
    skill('social.beeper.sync', ['DESKTOP'], 'integrations.core', 'read', 'L4', ['social.messages.read']),
    skill('social.beeper.send', ['DESKTOP'], 'integrations.core', 'external_write', 'L3', ['social.messages.send']),
    skill('mobile.media.next', ['ANDROID', 'IOS'], 'mobile.media', 'local_device_action', 'L4', ['mobile.media.control']),
    skill('mobile.media.play_pause', ['ANDROID', 'IOS'], 'mobile.media', 'local_device_action', 'L4', ['mobile.media.control']),
    skill('mobile.message.prepare', ['ANDROID', 'IOS'], 'mobile.messaging', 'external_write', 'L2', ['mobile.messaging.prepare']),
    skill('mobile.message.send', ['ANDROID', 'IOS'], 'mobile.messaging', 'external_write', 'L3', ['mobile.messaging.send']),
    skill('mobile.open_app', ['ANDROID', 'IOS'], 'mobile.node', 'local_device_action', 'L3', ['mobile.apps.open']),
    skill('mobile.files.list', ['ANDROID', 'IOS'], 'mobile.node', 'read', 'L3', ['mobile.files.read']),
    skill('mobile.files.search', ['ANDROID', 'IOS'], 'mobile.node', 'read', 'L3', ['mobile.files.read']),
    skill('mobile.files.open', ['ANDROID', 'IOS'], 'mobile.node', 'local_device_action', 'L3', ['mobile.files.read']),
    skill('mobile.reminder', ['ANDROID', 'IOS'], 'automation.basic', 'external_write', 'L3', ['jobs.write'])
]);

function skill(name, supportedNodes, entitlement, risk, autonomyMax, permissions) {
    return {
        name, version: '1.0.0', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
        supportedNodes, entitlement, risk, impact: impactFor(name, risk), permissions, autonomyMax,
        timeoutMs: name.startsWith('desktop.browser.') ? 90000 : risk === 'read' ? 10000 : 30000, retryPolicy: { maxAttempts: risk === 'destructive' || name.startsWith('desktop.browser.') ? 1 : 3 }
    };
}

function list() { return REGISTRY.map(item => ({ ...item, supportedNodes: [...item.supportedNodes], permissions: [...item.permissions] })); }
function get(name) { return REGISTRY.find(item => item.name === name) || null; }

function impactFor(name, risk) {
    if (/^(calendar\.|social\.|mobile\.message\.)/.test(name) && risk === 'read') return 'CLOUD';
    if (/^(desktop\.ui\.|desktop\.files\.open)/.test(name) && risk === 'local_device_action') return 'LOCAL_SENSITIVE';
    return IMPACT[risk] || 'LOCAL_SENSITIVE';
}
function validateArguments(entry, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    let serialized;
    try { serialized = JSON.stringify(payload); } catch { return false; }
    if (!serialized || Buffer.byteLength(serialized) > 64 * 1024) return false;
    const walk = (value, depth = 0) => {
        if (depth > 12) return false;
        if (!value || typeof value !== 'object') return true;
        return Object.entries(value).every(([key, child]) =>
            !['__proto__', 'prototype', 'constructor'].includes(key) && walk(child, depth + 1));
    };
    return entry.inputSchema.type === 'object' && walk(payload);
}

// LLM proposals are inert until this deterministic gate accepts an allowlisted
// skill, user, target device, arguments and the existing confirmation policy.
function authorizeProposal(input = {}) {
    if (!input.userId || typeof input.userId !== 'string') return { ok: false, error: 'user_id_required' };
    if (!input.node || typeof input.node !== 'object') return { ok: false, error: 'device_required' };
    const result = authorize(input);
    if (!result.ok) return result;
    if (!validateArguments(result.skill, input.payload === undefined ? {} : input.payload)) return { ok: false, error: 'invalid_skill_arguments' };
    return { ...result, impact: result.skill.impact };
}

function authorize({ userId, actor = {}, skillName, node, autonomy = 'L3', confirmed = false, inputSource = 'text' } = {}) {
    const entry = get(skillName);
    if (!entry) return { ok: false, error: 'skill_not_found' };
    const nodeType = node?.nodeType || node?.node_type || 'WEB';
    if (!entry.supportedNodes.includes(nodeType)) return { ok: false, error: 'skill_not_supported_by_node' };
    const feature = flags.evaluate(entry.entitlement, actor);
    if (!feature.enabled) return { ok: false, error: 'feature_flag_disabled', reason: feature.reason };
    const entitlement = entitlements.check(userId, entry.entitlement);
    if (!entitlement.allowed) return { ok: false, error: 'entitlement_required', reason: entitlement.reason };
    const requestedIndex = AUTONOMY.indexOf(autonomy);
    const maxIndex = AUTONOMY.indexOf(entry.autonomyMax);
    if (requestedIndex < 0 || requestedIndex > maxIndex) return { ok: false, error: 'autonomy_exceeds_skill_policy' };
    if (inputSource === 'voice' && entry.risk !== 'read' && !confirmed)
        return { ok: false, error: 'confirmation_required', requiresConfirmation: true };
    const trustedRoutine = ['external_write', 'local_device_action'].includes(entry.risk) && requestedIndex >= AUTONOMY.indexOf('L4') && maxIndex >= AUTONOMY.indexOf('L4');
    if (['external_write', 'sensitive', 'destructive', 'financial', 'security'].includes(entry.risk) && autonomy !== 'L2' && !trustedRoutine && !confirmed) {
        return { ok: false, error: 'confirmation_required', requiresConfirmation: true };
    }
    return { ok: true, skill: entry, entitlement };
}

function verify(skillName, result = {}) {
    const evidence = result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
    let verified = false;
    let limitation = null;
    if (skillName.startsWith('mobile.media.')) verified = evidence.playbackStateChanged === true || evidence.playbackStateObserved === true;
    else if (skillName === 'desktop.browser.youtube.play') verified = evidence.pageObserved === true && evidence.playbackObserved === true && evidence.mediaAdvanced === true && !!evidence.urlHash;
    else if (skillName.startsWith('desktop.browser.')) verified = evidence.pageObserved === true && !!evidence.urlHash;
    else if (skillName === 'desktop.apps.open') verified = evidence.processVisible === true || evidence.windowVisible === true || (evidence.processStarted === true && evidence.executableAllowed === true && !!evidence.executableHash);
    else if (skillName === 'mobile.open_app') verified = evidence.appOpened === true;
    else if (skillName === 'desktop.files.open') verified = evidence.pathOpened === true && !!evidence.pathHash;
    else if (skillName === 'desktop.files.latest') verified = evidence.fileFound === true && !!evidence.pathHash;
    else if (skillName === 'desktop.files.list') verified = evidence.pathRead === true && !!evidence.pathHash;
    else if (skillName === 'desktop.files.search') verified = evidence.searchCompleted === true && !!evidence.rootHash;
    else if (skillName === 'mobile.files.list') verified = evidence.folderRead === true;
    else if (skillName === 'mobile.files.search') verified = evidence.searchCompleted === true;
    else if (skillName === 'mobile.files.open') verified = evidence.fileOpened === true;
    else if (skillName === 'desktop.apps.discover') verified = evidence.discoveryCompleted === true;
    else if (skillName.startsWith('desktop.media.')) verified = evidence.mediaCommandSent === true;
    else if (skillName === 'desktop.ui.inspect') verified = evidence.controlsInspected === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.capture_target') verified = evidence.targetCaptured === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.focus') verified = evidence.windowFocused === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.click') verified = evidence.controlInvoked === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.type') verified = evidence.valueSet === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.wait') verified = evidence.targetObserved === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.scroll') verified = evidence.scrollChanged === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.hotkey') verified = evidence.shortcutSent === true && !!evidence.targetHash;
    else if (skillName === 'desktop.ui.select_file') verified = evidence.fileSelected === true && !!evidence.pathHash;
    else if (skillName === 'desktop.permissions.update') verified = evidence.permissionsUpdated === true && ['standard', 'all'].includes(evidence.filesystemScope) && ['standard', 'all'].includes(evidence.programScope);
    else if (skillName === 'calendar.create') verified = !!evidence.eventId && evidence.reconsulted === true;
    else if (skillName === 'tasks.create' || skillName.includes('reminder') || skillName === 'follow_up.schedule') verified = !!evidence.persistedId;
    else if (skillName === 'mobile.message.send') {
        verified = evidence.channelAccepted === true;
        if (verified && evidence.delivered !== true) limitation = 'accepted_by_channel_not_delivery_confirmed';
    } else if (skillName === 'social.beeper.sync') verified = evidence.syncCompleted === true;
    else if (skillName === 'social.beeper.send') {
        verified = evidence.channelAccepted === true;
        if (verified && evidence.delivered !== true) limitation = 'accepted_by_channel_not_delivery_confirmed';
    } else if (skillName === 'mobile.message.prepare') verified = !!evidence.draftId || !!evidence.preparedText;
    else verified = evidence.verified === true || !!result.evidenceRef;
    return { verified, state: verified ? 'VERIFIED' : 'VERIFICATION_FAILED', limitation };
}

module.exports = { AUTONOMY, REGISTRY, IMPACT, list, get, authorize, authorizeProposal, verify };
