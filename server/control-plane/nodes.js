/* Device Registry + heartbeat + command/event channel with idempotency. */
const crypto = require('crypto');
const store = require('./persistence');
const flags = require('./feature-flags');
const entitlements = require('./entitlements');
const skills = require('./skills');
const observability = require('./observability');

const FILE = 'nodes.json';
const PROTOCOL_VERSION = '1.0.0';
const MIN_PROTOCOL_VERSION = '1.0.0';
const NODE_TYPES = ['WEB', 'DESKTOP', 'ANDROID', 'IOS'];
const NODE_TOKEN_PREFIX = 'gn_';
const PAIR_TOKEN_PREFIX = 'gp_';
const PAIRING_TTL_MS = 10 * 60 * 1000;

function load() {
    const data = store.loadJson(FILE, { version: 2, nodes: [], commands: [], pairings: [], savedAt: null });
    if (!Array.isArray(data.nodes)) data.nodes = [];
    if (!Array.isArray(data.commands)) data.commands = [];
    if (!Array.isArray(data.pairings)) data.pairings = [];
    return data;
}

function save(data) {
    data.savedAt = new Date().toISOString();
    store.saveJson(FILE, data);
}

function register(userId, input = {}, actor = {}) {
    const nodeType = String(input.nodeType || input.node_type || 'WEB').toUpperCase();
    if (!NODE_TYPES.includes(nodeType)) return { ok: false, error: 'node_type_invalid' };
    const featureKey = nodeType === 'WEB' ? 'gunter.chat' : nodeType === 'DESKTOP' ? 'desktop.node' : 'mobile.node';
    const flag = flags.evaluate(featureKey, actor);
    const entitlement = entitlements.check(userId, featureKey);
    if (!flag.enabled) return { ok: false, error: 'feature_flag_disabled', reason: flag.reason };
    if (!entitlement.allowed) return { ok: false, error: 'entitlement_required', reason: entitlement.reason };

    const data = load();
    const active = data.nodes.filter(node => node.userId === userId && node.nodeType !== 'WEB' && !node.revokedAt);
    const maxNodes = Number(entitlements.snapshot(userId).plan?.limits?.nodes || 1);
    if (nodeType !== 'WEB' && active.length >= maxNodes) return { ok: false, error: 'node_limit_reached', limit: maxNodes };
    if (nodeType === 'WEB' && data.nodes.filter(node => node.userId === userId && node.nodeType === 'WEB' && !node.revokedAt).length >= 5) {
        return { ok: false, error: 'web_node_limit_reached', limit: 5 };
    }

    const token = NODE_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const node = {
        nodeId: `node_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        userId, nodeType, deviceName: clean(input.deviceName || `${nodeType} node`, 80),
        os: clean(input.os || 'unknown', 60), osVersion: clean(input.osVersion || '', 40),
        appVersion: clean(input.appVersion || '0.0.0', 30),
        protocolVersion: clean(input.protocolVersion || PROTOCOL_VERSION, 20),
        capabilities: normalizeCapabilities(input.capabilities), trustState: 'TRUSTED', reportedState: 'REGISTERED',
        tokenHash: store.hash(token), createdAt: now, lastSeenAt: now, lastIpHash: null,
        approxCity: null, approxRegion: null, leaseExpiresAt: null, revokedAt: null,
        health: {}, integrations: {}, clockSkewMs: 0, syncCursor: null
    };
    data.nodes.push(node);
    save(data);
    observability.record({
        severity: 'INFO', service: 'nodes', event_type: 'node.registered', action: node.nodeType,
        status: 'REGISTERED', node_id: node.nodeId, user_id_hash: store.hash(userId).slice(0, 16),
        metadata_redacted: { protocolVersion: node.protocolVersion, capabilities: node.capabilities.length }
    });
    return { ok: true, node: publicNode(node), nodeToken: token, protocolVersion: PROTOCOL_VERSION };
}

function authenticateToken(token) {
    if (!String(token || '').startsWith(NODE_TOKEN_PREFIX)) return null;
    const hash = store.hash(token);
    const node = load().nodes.find(item => item.tokenHash === hash && !item.revokedAt);
    return node ? publicNode(node) : null;
}

function createPairing(userId, input = {}, actor = {}) {
    const nodeType = String(input.nodeType || 'DESKTOP').toUpperCase();
    if (!['DESKTOP', 'ANDROID', 'IOS'].includes(nodeType)) return { ok: false, error: 'pairing_node_type_invalid' };
    const featureKey = nodeType === 'DESKTOP' ? 'desktop.node' : 'mobile.node';
    const feature = flags.evaluate(featureKey, actor);
    if (!feature.enabled) return { ok: false, error: 'feature_flag_disabled', reason: feature.reason };
    const entitlement = entitlements.check(userId, featureKey);
    if (!entitlement.allowed) return { ok: false, error: 'entitlement_required', reason: entitlement.reason };

    const data = load();
    const now = Date.now();
    data.pairings = data.pairings.filter(item => item.userId !== userId || item.claimedAt || new Date(item.expiresAt).getTime() > now);
    const token = PAIR_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    const pairing = {
        pairingId: `pair_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        userId, nodeType, tokenHash: store.hash(token),
        deviceName: clean(input.deviceName || '', 80) || null,
        capabilities: normalizeCapabilities(input.capabilities || defaultCapabilities(nodeType)),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PAIRING_TTL_MS).toISOString(),
        claimedAt: null, nodeId: null
    };
    data.pairings.push(pairing);
    if (data.pairings.length > 500) data.pairings.splice(0, data.pairings.length - 500);
    save(data);
    observability.record({
        severity: 'INFO', service: 'nodes', event_type: 'node.pairing_created', action: nodeType,
        status: 'PENDING', user_id_hash: store.hash(userId).slice(0, 16), metadata_redacted: { pairingId: pairing.pairingId }
    });
    return { ok: true, pairing: publicPairing(pairing), pairingToken: token };
}

function authenticatePairingToken(token) {
    if (!String(token || '').startsWith(PAIR_TOKEN_PREFIX)) return null;
    const now = Date.now();
    const pairing = load().pairings.find(item => item.tokenHash === store.hash(token) && !item.claimedAt && new Date(item.expiresAt).getTime() > now);
    return pairing ? publicPairing(pairing) : null;
}

function claimPairing(pairingId, input = {}) {
    const data = load();
    const pairing = data.pairings.find(item => item.pairingId === pairingId);
    if (!pairing || pairing.claimedAt || new Date(pairing.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'pairing_invalid_or_expired' };
    const registered = register(pairing.userId, {
        nodeType: pairing.nodeType,
        deviceName: clean(input.deviceName || pairing.deviceName || `${pairing.nodeType} node`, 80),
        os: input.os, osVersion: input.osVersion, appVersion: input.appVersion,
        protocolVersion: input.protocolVersion, capabilities: pairing.capabilities
    }, { kind: 'user', role: 'user', userId: pairing.userId });
    if (!registered.ok) return registered;
    const fresh = load();
    const current = fresh.pairings.find(item => item.pairingId === pairingId);
    if (current) {
        current.claimedAt = new Date().toISOString();
        current.nodeId = registered.node.nodeId;
        current.tokenHash = null;
        save(fresh);
    }
    observability.record({
        severity: 'INFO', service: 'nodes', event_type: 'node.pairing_claimed', action: pairing.nodeType,
        status: 'TRUSTED', node_id: registered.node.nodeId, user_id_hash: store.hash(pairing.userId).slice(0, 16)
    });
    return registered;
}

function pairingStatus(userId, pairingId) {
    const pairing = load().pairings.find(item => item.pairingId === pairingId && item.userId === userId);
    if (!pairing) return { ok: false, error: 'pairing_not_found' };
    return { ok: true, pairing: publicPairing(pairing), node: pairing.nodeId ? get(pairing.nodeId) : null };
}

function authenticateRequest(req, pathname) {
    if (!nodeAuthPath(pathname)) return null;
    const authorization = String(req.headers.authorization || '');
    if (!authorization.startsWith('Bearer ')) return null;
    const token = authorization.slice(7).trim();
    if (pathname === '/api/control/nodes/claim') {
        const pairing = authenticatePairingToken(token);
        if (!pairing) return null;
        req.gunterPairing = pairing;
        return { kind: 'pairing', userId: pairing.userId, pairingId: pairing.pairingId };
    }
    const node = authenticateToken(token);
    if (!node) return null;
    req.gunterNode = node;
    return node;
}

function nodeAuthPath(pathname) {
    return [
        '/api/control/nodes/heartbeat', '/api/control/commands/pull',
        '/api/control/commands/result', '/api/control/events', '/api/control/nodes/claim',
        '/api/control/nodes/push-token'
    ].includes(pathname);
}

function heartbeat(nodeId, input = {}, context = {}) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId);
    if (!node || node.revokedAt) return { ok: false, error: 'node_not_found_or_revoked' };
    if (context.userId && context.userId !== node.userId) return { ok: false, error: 'node_owner_mismatch' };
    const now = new Date();
    node.lastSeenAt = now.toISOString();
    node.protocolVersion = clean(input.protocolVersion || node.protocolVersion, 20);
    node.capabilities = input.capabilities ? normalizeCapabilities(input.capabilities) : node.capabilities;
    node.reportedState = ['ONLINE', 'DEGRADED', 'SYNCING'].includes(input.state) ? input.state : 'ONLINE';
    node.health = sanitizeHealth(input.health);
    node.syncCursor = clean(input.syncCursor || node.syncCursor || '', 120) || null;
    node.clockSkewMs = Number.isFinite(Number(input.clientTime)) ? now.getTime() - Number(input.clientTime) : 0;
    node.lastIpHash = context.ip ? store.hash(context.ip).slice(0, 24) : node.lastIpHash;
    if (input.approxCity) node.approxCity = clean(input.approxCity, 80);
    if (input.approxRegion) node.approxRegion = clean(input.approxRegion, 80);
    if (input.leaseExpiresAt) node.leaseExpiresAt = dateOrNull(input.leaseExpiresAt);
    save(data);
    return { ok: true, node: publicNode(node), serverTime: now.toISOString(), state: computedState(node) };
}

function list({ userId = null, includeRevoked = false } = {}) {
    return load().nodes
        .filter(node => (!userId || node.userId === userId) && (includeRevoked || !node.revokedAt))
        .map(publicNode)
        .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function get(nodeId) {
    const node = load().nodes.find(item => item.nodeId === nodeId);
    return node ? publicNode(node) : null;
}

function rename(nodeId, userId, name) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId && item.userId === userId && !item.revokedAt);
    if (!node) return { ok: false, error: 'node_not_found' };
    node.deviceName = clean(name, 80);
    if (!node.deviceName) return { ok: false, error: 'device_name_required' };
    save(data);
    return { ok: true, node: publicNode(node) };
}

function revoke(nodeId, requester = {}) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId);
    if (!node) return { ok: false, error: 'node_not_found' };
    if (!requester.admin && requester.userId !== node.userId) return { ok: false, error: 'node_owner_mismatch' };
    node.revokedAt = new Date().toISOString();
    node.trustState = 'REVOKED';
    node.reportedState = 'REVOKED';
    node.tokenHash = null;
    node.mobilePush = null;
    data.commands.forEach(command => {
        if (command.nodeId === nodeId && ['QUEUED', 'RECEIVED', 'STARTED'].includes(command.state)) {
            command.state = 'CANCELLED'; command.updatedAt = node.revokedAt; command.error = 'node_revoked';
            if (command.pushWakeup) command.pushWakeup = { ...command.pushWakeup, state: 'CANCELLED', leaseUntil: null, lastError: 'node_revoked' };
        }
    });
    save(data);
    observability.record({ severity: 'WARN', service: 'nodes', event_type: 'node.revoked', action: node.nodeType, status: 'REVOKED', node_id: node.nodeId });
    return { ok: true, node: publicNode(node) };
}

function registerPushToken(nodeId, input = {}) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId && !item.revokedAt);
    if (!node) return { ok: false, error: 'node_not_found_or_revoked' };
    const provider = String(input.provider || '').toLowerCase();
    const token = clean(input.token, 4096);
    const providerAllowed = (node.nodeType === 'ANDROID' && provider === 'fcm' && token.length >= 40)
        || (node.nodeType === 'IOS' && provider === 'apns' && /^[a-f\d]{64}$/i.test(token));
    if (!providerAllowed) return { ok: false, error: 'push_token_invalid' };
    node.mobilePush = { provider, encryptedToken: encryptPushToken(token), updatedAt: new Date().toISOString() };
    for (const command of data.commands) {
        if (command.nodeId === nodeId && command.state === 'QUEUED' && (!command.pushWakeup || ['UNAVAILABLE', 'FAILED'].includes(command.pushWakeup.state))) {
            command.pushWakeup = newPushWakeup();
        }
    }
    save(data);
    return { ok: true, push: { enabled: true, provider, updatedAt: node.mobilePush.updatedAt } };
}

function clearPushToken(nodeId) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId && !item.revokedAt);
    if (!node) return { ok: false, error: 'node_not_found_or_revoked' };
    node.mobilePush = null;
    for (const command of data.commands) {
        if (command.nodeId === nodeId && command.state === 'QUEUED' && ['PENDING', 'RETRY', 'DISPATCHING'].includes(command.pushWakeup?.state)) {
            command.pushWakeup = { ...command.pushWakeup, state: 'UNAVAILABLE', leaseUntil: null, lastError: 'push_disabled' };
        }
    }
    save(data);
    return { ok: true, push: { enabled: false } };
}

function getPushRegistration(nodeId) {
    const node = load().nodes.find(item => item.nodeId === nodeId && !item.revokedAt && ['fcm', 'apns'].includes(item.mobilePush?.provider));
    if (!node?.mobilePush?.encryptedToken) return null;
    try { return { token: decryptPushToken(node.mobilePush.encryptedToken), provider: node.mobilePush.provider }; } catch { return null; }
}
function getPushToken(nodeId) { return getPushRegistration(nodeId)?.token || null; }

function encryptPushToken(value) {
    const key = pushEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptPushToken(value) {
    const [ivText, tagText, ciphertextText] = String(value).split('.');
    if (!ivText || !tagText || !ciphertextText) throw new Error('mobile_push_ciphertext_invalid');
    const key = pushEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

function pushEncryptionKey() {
    const raw = process.env.MOBILE_PUSH_ENCRYPTION_KEY || store.getOrCreateSecret('mobile-push-key', 32);
    const key = Buffer.from(raw, 'base64url');
    if (key.length !== 32) throw new Error('mobile_push_key_invalid');
    return key;
}

function updateIntegration(nodeId, name, snapshot = {}) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === nodeId && !item.revokedAt);
    if (!node) return { ok: false, error: 'node_not_found_or_revoked' };
    if (name !== 'beeper') return { ok: false, error: 'integration_invalid' };
    node.integrations = node.integrations || {};
    node.integrations.beeper = sanitizeBeeperSnapshot(snapshot);
    node.integrations.beeper.lastCheckedAt = new Date().toISOString();
    save(data);
    return { ok: true, integration: node.integrations.beeper };
}

function socialSnapshot(userId) {
    const candidates = load().nodes
        .filter(node => node.userId === userId && node.nodeType === 'DESKTOP' && !node.revokedAt && node.integrations?.beeper)
        .sort((a, b) => String(b.integrations.beeper.lastCheckedAt || '').localeCompare(String(a.integrations.beeper.lastCheckedAt || '')));
    const node = candidates[0];
    if (!node) return null;
    const snapshot = { ...node.integrations.beeper, nodeId: node.nodeId };
    const age = Date.now() - new Date(snapshot.lastCheckedAt || 0).getTime();
    if (age > 90_000 || computedState(node) === 'OFFLINE') {
        snapshot.reachable = false;
        snapshot.live = false;
        snapshot.state = snapshot.paired ? 'node_offline' : 'node_required';
    }
    return snapshot;
}

function queueCommand(userId, input = {}, actor = {}) {
    const data = load();
    const node = data.nodes.find(item => item.nodeId === input.nodeId && !item.revokedAt);
    if (!node) return { ok: false, error: 'node_not_found' };
    if (node.userId !== userId && actor.role !== 'admin' && actor.kind !== 'service') return { ok: false, error: 'node_owner_mismatch' };
    const idempotencyKey = clean(input.idempotencyKey || '', 160);
    if (!idempotencyKey) return { ok: false, error: 'idempotency_key_required' };
    const duplicate = data.commands.find(command => command.idempotencyKey === idempotencyKey && command.userId === userId);
    if (duplicate) return { ok: true, duplicate: true, command: publicCommand(duplicate) };
    const authorization = skills.authorize({
        userId, actor, skillName: input.skill, node: publicNode(node),
        autonomy: input.autonomy || 'L3', confirmed: input.confirmed === true
    });
    if (!authorization.ok) return authorization;
    const payload = sanitizePayload(input.payload);
    const now = new Date().toISOString();
    const command = {
        id: `cmd_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        traceId: input.traceId || observability.newTraceId(), userId, nodeId: node.nodeId,
        skill: authorization.skill.name, skillVersion: authorization.skill.version,
        payload, payloadHash: store.hash(JSON.stringify(payload)), idempotencyKey,
        autonomy: input.autonomy || 'L3', state: 'QUEUED', requestedAt: now, updatedAt: now,
        pushWakeup: ['ANDROID', 'IOS'].includes(node.nodeType) && node.mobilePush?.encryptedToken ? newPushWakeup(now) : null,
        expiresAt: new Date(Date.now() + Math.max(30_000, Math.min(Number(input.ttlMs) || 300_000, 86_400_000))).toISOString(),
        result: null, evidence: null, verification: null, error: null
    };
    data.commands.push(command);
    if (data.commands.length > 5000) data.commands.splice(0, data.commands.length - 5000);
    save(data);
    observability.record({
        trace_id: command.traceId, severity: 'INFO', service: 'commands', event_type: 'command.requested',
        action: command.skill, skill: command.skill, skill_version: command.skillVersion, node_id: node.nodeId, status: command.state,
        user_id_hash: store.hash(userId).slice(0, 16), metadata_redacted: { commandId: command.id, autonomy: command.autonomy }
    });
    return { ok: true, duplicate: false, command: publicCommand(command) };
}

function claimNextPushWakeup(options = {}) {
    const data = load();
    const nowMs = Number(options.nowMs) || Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const due = data.commands.filter(command => {
        if (command.state !== 'QUEUED' || !command.pushWakeup) return false;
        const node = data.nodes.find(item => item.nodeId === command.nodeId && !item.revokedAt);
        if (!node?.mobilePush?.encryptedToken || !['fcm', 'apns'].includes(node.mobilePush.provider)) return false;
        const wake = command.pushWakeup;
        if (!['PENDING', 'RETRY', 'DISPATCHING'].includes(wake.state)) return false;
        if (new Date(command.expiresAt).getTime() <= nowMs) return true;
        if (wake.state === 'DISPATCHING' && new Date(wake.leaseUntil || 0).getTime() > nowMs) return false;
        return !wake.nextAttemptAt || new Date(wake.nextAttemptAt).getTime() <= nowMs;
    }).sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)))[0];
    if (!due) return null;
    if (new Date(due.expiresAt).getTime() <= nowMs) {
        due.pushWakeup = { ...due.pushWakeup, state: 'EXPIRED', leaseUntil: null, lastError: 'command_expired' };
        save(data); return null;
    }
    due.pushWakeup = { ...due.pushWakeup, state: 'DISPATCHING', leaseUntil: new Date(nowMs + 30_000).toISOString(), lastError: null };
    due.updatedAt = nowIso; save(data);
    return { commandId: due.id, nodeId: due.nodeId };
}

function finishPushWakeup(commandId, outcome = {}, options = {}) {
    const data = load();
    const command = data.commands.find(item => item.id === commandId);
    if (!command?.pushWakeup) return { ok: false, error: 'push_wakeup_not_found' };
    if (!['DISPATCHING', 'PENDING', 'RETRY'].includes(command.pushWakeup.state)) return { ok: true, ignored: true, state: command.pushWakeup.state };
    const nowMs = Number(options.nowMs) || Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const attempts = Number(command.pushWakeup.attempts || 0) + 1;
    if (command.state !== 'QUEUED' || new Date(command.expiresAt).getTime() <= nowMs) {
        command.pushWakeup = { ...command.pushWakeup, state: command.state === 'QUEUED' ? 'EXPIRED' : 'CONSUMED', attempts, leaseUntil: null, lastAttemptAt: nowIso, lastError: null };
    } else if (outcome.delivered === true) {
        command.pushWakeup = { ...command.pushWakeup, state: 'SENT', attempts, sentAt: nowIso, lastAttemptAt: nowIso, leaseUntil: null, nextAttemptAt: null, lastError: null };
    } else {
        const reason = clean(outcome.reason || (outcome.status ? `fcm_http_${Number(outcome.status)}` : 'fcm_delivery_failed'), 80);
        if (['push_not_registered', 'push_disabled', 'fcm_token_invalid', 'apns_token_invalid'].includes(reason) || attempts >= 5) {
            command.pushWakeup = { ...command.pushWakeup, state: reason === 'push_disabled' ? 'UNAVAILABLE' : 'FAILED', attempts, lastAttemptAt: nowIso, leaseUntil: null, nextAttemptAt: null, lastError: reason };
        } else {
            const delays = [5_000, 30_000, 120_000, 300_000];
            command.pushWakeup = { ...command.pushWakeup, state: 'RETRY', attempts, lastAttemptAt: nowIso, leaseUntil: null, nextAttemptAt: new Date(nowMs + delays[Math.min(attempts - 1, delays.length - 1)]).toISOString(), lastError: reason };
        }
    }
    command.updatedAt = nowIso; save(data);
    return { ok: true, pushWakeup: publicPushWakeup(command.pushWakeup) };
}

function pullCommands(nodeId, { limit = 10 } = {}) {
    const data = load();
    const now = Date.now();
    const commands = data.commands.filter(command => command.nodeId === nodeId && command.state === 'QUEUED').slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
    for (const command of commands) {
        if (new Date(command.expiresAt).getTime() <= now) { command.state = 'EXPIRED'; command.error = 'command_expired'; }
        else { command.state = 'RECEIVED'; command.receivedAt = new Date().toISOString(); }
        if (command.pushWakeup && ['PENDING', 'DISPATCHING', 'RETRY'].includes(command.pushWakeup.state)) {
            command.pushWakeup = { ...command.pushWakeup, state: 'CONSUMED', leaseUntil: null, lastError: null };
        }
        command.updatedAt = new Date().toISOString();
    }
    save(data);
    return commands.filter(command => command.state === 'RECEIVED').map(publicCommand);
}

function submitResult(nodeId, input = {}) {
    const data = load();
    const command = data.commands.find(item => item.id === input.commandId && item.nodeId === nodeId);
    if (!command) return { ok: false, error: 'command_not_found' };
    if (!['RECEIVED', 'STARTED'].includes(command.state)) return { ok: false, error: 'command_state_invalid', state: command.state };
    command.result = sanitizePayload(input.result);
    command.evidence = sanitizePayload(input.evidence);
    command.state = 'RESULT_RECEIVED';
    command.updatedAt = new Date().toISOString();
    const verification = skills.verify(command.skill, { result: command.result, evidence: command.evidence, evidenceRef: input.evidenceRef });
    command.verification = verification;
    command.state = verification.verified ? 'VERIFIED' : 'VERIFICATION_FAILED';
    command.completedAt = new Date().toISOString();
    command.error = verification.verified ? null : 'verification_failed';
    save(data);
    observability.record({
        trace_id: command.traceId, severity: verification.verified ? 'INFO' : 'HIGH', service: 'commands',
        event_type: verification.verified ? 'command.verified' : 'command.failed', action: command.skill,
        skill: command.skill, skill_version: command.skillVersion, node_id: nodeId, status: command.state,
        error_code: command.error, evidence_ref: input.evidenceRef || null,
        metadata_redacted: { commandId: command.id, limitation: verification.limitation }
    });
    return { ok: verification.verified, command: publicCommand(command), verification };
}

function commandList({ userId = null, nodeId = null, limit = 100 } = {}) {
    return load().commands.filter(command => (!userId || command.userId === userId) && (!nodeId || command.nodeId === nodeId))
        .slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse().map(publicCommand);
}

function stats() {
    const data = load();
    const nodes = data.nodes.map(publicNode);
    const commands = data.commands;
    return {
        nodes: { total: nodes.length, byState: countBy(nodes, 'state'), byType: countBy(nodes, 'nodeType') },
        commands: { total: commands.length, byState: countBy(commands, 'state') },
        protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_PROTOCOL_VERSION
    };
}

function purgeUser(userId) {
    const data = load();
    const nodeIds = new Set(data.nodes.filter(node => node.userId === userId).map(node => node.nodeId));
    const before = { nodes: data.nodes.length, commands: data.commands.length };
    data.nodes = data.nodes.filter(node => node.userId !== userId);
    data.commands = data.commands.filter(command => command.userId !== userId && !nodeIds.has(command.nodeId));
    data.pairings = data.pairings.filter(pairing => pairing.userId !== userId);
    save(data);
    return { nodes: before.nodes - data.nodes.length, commands: before.commands - data.commands.length, nodeIds: [...nodeIds] };
}

function computedState(node) {
    if (node.revokedAt || node.trustState === 'REVOKED') return 'REVOKED';
    const age = Date.now() - new Date(node.lastSeenAt || 0).getTime();
    if (age > 60_000) return 'OFFLINE';
    if (node.reportedState === 'SYNCING') return 'SYNCING';
    if (node.reportedState === 'DEGRADED' || semverCompare(node.protocolVersion, MIN_PROTOCOL_VERSION) < 0 || Object.values(node.health || {}).some(value => value === false)) return 'DEGRADED';
    return 'ONLINE';
}

function publicNode(node) {
    return {
        nodeId: node.nodeId, userId: node.userId, nodeType: node.nodeType, deviceName: node.deviceName,
        os: node.os, osVersion: node.osVersion, appVersion: node.appVersion, protocolVersion: node.protocolVersion,
        capabilities: [...(node.capabilities || [])], trustState: node.trustState, state: computedState(node),
        createdAt: node.createdAt, lastSeenAt: node.lastSeenAt, lastIpHash: node.lastIpHash,
        approxCity: node.approxCity, approxRegion: node.approxRegion, leaseExpiresAt: node.leaseExpiresAt,
        revokedAt: node.revokedAt, clockSkewMs: node.clockSkewMs, health: { ...(node.health || {}) },
        push: { enabled: Boolean(node.mobilePush?.encryptedToken), provider: node.mobilePush?.provider || null },
        integrations: node.integrations ? JSON.parse(JSON.stringify(node.integrations)) : {}
    };
}

function publicPairing(pairing) {
    return {
        pairingId: pairing.pairingId, nodeType: pairing.nodeType, deviceName: pairing.deviceName,
        capabilities: [...(pairing.capabilities || [])], createdAt: pairing.createdAt, expiresAt: pairing.expiresAt,
        claimedAt: pairing.claimedAt || null, nodeId: pairing.nodeId || null,
        state: pairing.claimedAt ? 'CLAIMED' : new Date(pairing.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : 'PENDING'
    };
}

function defaultCapabilities(nodeType) {
    if (nodeType === 'DESKTOP') return [
        'desktop.apps.open', 'desktop.apps.discover', 'desktop.permissions.write',
        'desktop.browser.control',
        'desktop.files.read', 'desktop.files.open', 'desktop.files.latest', 'desktop.files.list', 'desktop.files.search',
        'desktop.media.control', 'desktop.ui.inspect', 'desktop.ui.capture_target', 'desktop.ui.focus', 'desktop.ui.click', 'desktop.ui.type',
        'desktop.ui.wait', 'desktop.ui.scroll', 'desktop.ui.hotkey', 'desktop.ui.select_file',
        'social.beeper.bridge'
    ];
    if (nodeType === 'ANDROID' || nodeType === 'IOS') return [
        'mobile.apps.open', 'mobile.media.control', 'mobile.files.read',
        'mobile.messaging.prepare', 'mobile.messaging.send', 'mobile.reminders.write'
    ];
    return [];
}

function sanitizeBeeperSnapshot(value = {}) {
    const accounts = (Array.isArray(value.accounts) ? value.accounts : []).slice(0, 20).map(account => ({
        id: clean(account.id, 180), provider: ['instagram', 'messenger'].includes(account.provider) ? account.provider : null,
        label: clean(account.label, 180), status: clean(account.status || 'disconnected', 40), network: clean(account.network, 80),
        local: account.local === true
    })).filter(account => account.id && account.provider);
    return {
        paired: value.paired === true, reachable: value.reachable === true, live: value.live === true,
        state: clean(value.state || 'node_required', 40), accounts,
        lastError: clean(value.lastError, 180) || null, lastCheckedAt: dateOrNull(value.lastCheckedAt) || new Date().toISOString()
    };
}

function publicCommand(command) {
    return {
        id: command.id, traceId: command.traceId, userId: command.userId, nodeId: command.nodeId,
        skill: command.skill, skillVersion: command.skillVersion, payload: command.payload,
        payloadHash: command.payloadHash, idempotencyKey: command.idempotencyKey, autonomy: command.autonomy,
        state: command.state, requestedAt: command.requestedAt, receivedAt: command.receivedAt || null,
        pushWakeup: command.pushWakeup ? publicPushWakeup(command.pushWakeup) : null,
        completedAt: command.completedAt || null, expiresAt: command.expiresAt,
        result: command.result, evidence: command.evidence, verification: command.verification, error: command.error
    };
}

function newPushWakeup(at = new Date().toISOString()) {
    return { state: 'PENDING', attempts: 0, nextAttemptAt: at, lastAttemptAt: null, sentAt: null, leaseUntil: null, lastError: null };
}

function publicPushWakeup(wakeup) {
    return {
        state: wakeup.state, attempts: Number(wakeup.attempts || 0), nextAttemptAt: wakeup.nextAttemptAt || null,
        lastAttemptAt: wakeup.lastAttemptAt || null, sentAt: wakeup.sentAt || null, lastError: wakeup.lastError || null
    };
}

function normalizeCapabilities(value) { return [...new Set((Array.isArray(value) ? value : []).map(item => clean(item, 120)).filter(Boolean))].slice(0, 300); }
function sanitizePayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new Error('command_payload_too_large');
    return JSON.parse(serialized);
}
function sanitizeHealth(value) { const out = {}; for (const [key, raw] of Object.entries(value || {}).slice(0, 50)) out[clean(key, 80)] = typeof raw === 'boolean' ? raw : clean(raw, 120); return out; }
function clean(value, max) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max); }
function dateOrNull(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function semverCompare(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; }
function countBy(items, key) { const out = {}; for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1; return out; }

module.exports = {
    PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, register, createPairing, authenticatePairingToken, claimPairing, pairingStatus,
    authenticateToken, authenticateRequest, nodeAuthPath, heartbeat, list, get, rename, revoke, updateIntegration, socialSnapshot,
    queueCommand, pullCommands, submitResult, commandList, stats, purgeUser, registerPushToken, clearPushToken, getPushToken, getPushRegistration,
    claimNextPushWakeup, finishPushWakeup,
    computedState, _load: load
};
