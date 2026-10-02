/* Minimal, user-visible native push wakeups. Never sends command contents. */
const crypto = require('crypto');
const http2 = require('http2');
const nodes = require('../control-plane/nodes');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let cachedAccess = null;
let cachedApns = null;

function credentials() {
    try {
        const value = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON || '{}');
        const projectId = String(value.project_id || '').trim();
        const clientEmail = String(value.client_email || '').trim();
        const privateKey = String(value.private_key || '').replace(/\\n/g, '\n');
        if (!/^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/.test(projectId) || !clientEmail.includes('@') || !privateKey.includes('PRIVATE KEY')) return null;
        return { projectId, clientEmail, privateKey };
    } catch { return null; }
}
function apnsCredentials() {
    const keyId = String(process.env.APNS_KEY_ID || '').trim();
    const teamId = String(process.env.APNS_TEAM_ID || '').trim();
    const topic = String(process.env.APNS_BUNDLE_ID || 'com.gunter.mobile').trim();
    const privateKey = String(process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const environment = String(process.env.APNS_ENVIRONMENT || 'production').toLowerCase();
    if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Za-z0-9.-]+$/.test(topic)
        || !privateKey.includes('PRIVATE KEY') || !['production', 'sandbox'].includes(environment)) return null;
    try {
        const parsedKey = crypto.createPrivateKey(privateKey);
        if (parsedKey.asymmetricKeyType !== 'ec' || parsedKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    } catch { return null; }
    return { keyId, teamId, topic, privateKey, environment };
}
function isConfigured(provider) {
    if (provider === 'apns') return Boolean(apnsCredentials());
    if (provider === 'fcm') return Boolean(credentials());
    return Boolean(credentials() || apnsCredentials());
}

function signServiceAssertion(creds, now = Math.floor(Date.now() / 1000)) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iss: creds.clientEmail, scope: FCM_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600
    })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), creds.privateKey).toString('base64url');
    return `${unsigned}.${signature}`;
}

async function accessToken(creds, fetcher, now = Date.now()) {
    if (cachedAccess && cachedAccess.expiresAt > now + 60_000) return cachedAccess.value;
    const assertion = signServiceAssertion(creds, Math.floor(now / 1000));
    const response = await fetcher(TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.access_token !== 'string') throw new Error('fcm_oauth_failed');
    cachedAccess = { value: body.access_token, expiresAt: now + Math.max(60, Number(body.expires_in) || 3600) * 1000 };
    return cachedAccess.value;
}

async function wakeNode(nodeId, commandId, options = {}) {
    const registration = options._deviceToken
        ? { token: options._deviceToken, provider: options._provider || 'fcm' }
        : nodes.getPushRegistration(nodeId);
    const token = registration?.token;
    if (!token) return { attempted: false, delivered: false, reason: 'push_not_registered' };
    if (registration.provider === 'apns') return wakeApns(token, commandId, { ...options, _nodeId: nodeId });
    const creds = options._credentials || credentials();
    if (!creds) return { attempted: false, delivered: false, reason: 'fcm_not_configured' };
    const fetcher = options._fetch || globalThis.fetch;
    if (typeof fetcher !== 'function') return { attempted: false, delivered: false, reason: 'fetch_unavailable' };
    try {
        const bearer = await accessToken(creds, fetcher, options._now || Date.now());
        const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/messages:send`;
        const response = await fetcher(endpoint, {
            method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
            body: JSON.stringify({ message: {
                token, data: { kind: 'GUNTER_COMMAND_READY', commandId: String(commandId || '').slice(0, 120) },
                notification: { title: 'Gunter', body: 'Abre la app para continuar con una acción autorizada.' },
                android: { priority: 'HIGH', ttl: '60s', notification: { channel_id: 'gunter_commands' } }
            } }), signal: AbortSignal.timeout(10_000)
        });
        if ([404, 410].includes(response.status)) nodes.clearPushToken(nodeId);
        return { attempted: true, delivered: response.ok, status: response.status,
            ...([404, 410].includes(response.status) ? { reason: 'fcm_token_invalid' } : {}) };
    } catch {
        return { attempted: true, delivered: false, reason: 'fcm_delivery_failed' };
    }
}

function apnsAssertion(creds, now = Math.floor(Date.now() / 1000)) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'ES256', kid: creds.keyId })}.${encode({ iss: creds.teamId, iat: now })}`;
    const signature = crypto.sign('sha256', Buffer.from(unsigned), {
        key: creds.privateKey, dsaEncoding: 'ieee-p1363'
    }).toString('base64url');
    return `${unsigned}.${signature}`;
}

async function wakeApns(token, commandId, options = {}) {
    const creds = options._apnsCredentials || apnsCredentials();
    if (!creds) return { attempted: false, delivered: false, reason: 'apns_not_configured' };
    if (!/^[a-f\d]{64}$/i.test(token)) return { attempted: false, delivered: false, reason: 'apns_token_invalid' };
    try {
        const now = Math.floor((options._now || Date.now()) / 1000);
        if (!cachedApns || cachedApns.expiresAt <= now - 60 || cachedApns.keyId !== creds.keyId || cachedApns.teamId !== creds.teamId) {
            cachedApns = { value: apnsAssertion(creds, now), expiresAt: now + 50 * 60, keyId: creds.keyId, teamId: creds.teamId };
        }
        const host = creds.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
        const response = await (options._sendApns || sendApns)(host, token, {
            authorization: `bearer ${cachedApns.value}`,
            'apns-topic': creds.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'content-type': 'application/json'
        }, JSON.stringify({
                aps: { alert: { title: 'Gunter', body: 'Abre la app para continuar con una acción autorizada.' }, sound: 'default' },
                kind: 'GUNTER_COMMAND_READY', commandId: String(commandId || '').slice(0, 120)
            }));
        if (response.status === 410) nodes.clearPushToken(options._nodeId);
        return { attempted: true, delivered: response.ok, status: response.status,
            ...(response.status === 410 ? { reason: 'apns_token_invalid' } : {}) };
    } catch {
        return { attempted: true, delivered: false, reason: 'apns_delivery_failed' };
    }
}

function sendApns(host, token, headers, body) {
    return new Promise((resolve, reject) => {
        let client;
        let stream;
        let settled = false;
        const timer = setTimeout(() => finish(new Error('apns_timeout')), 10_000);
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { stream?.close(); } catch { /* noop */ }
            try { client?.close(); } catch { /* noop */ }
            if (error) reject(error); else resolve(result);
        };
        try {
            client = http2.connect(host);
            client.once('error', error => finish(error));
            stream = client.request({
                ':method': 'POST', ':path': `/3/device/${token}`,
                ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
            });
            let status = 0;
            let responseBody = '';
            stream.on('response', value => { status = Number(value[':status']) || 0; });
            stream.on('data', chunk => { if (responseBody.length < 8192) responseBody += chunk.toString('utf8'); });
            stream.once('error', error => finish(error));
            stream.once('end', () => finish(null, { status, ok: status >= 200 && status < 300, body: responseBody }));
            stream.end(body);
        } catch (error) { finish(error); }
    });
}

module.exports = { wakeNode, credentials, apnsCredentials, isConfigured, signServiceAssertion, apnsAssertion,
    _sendApns: sendApns, _clearCache() { cachedAccess = null; cachedApns = null; } };
