const assert = require('assert');
const crypto = require('crypto');
const http2 = require('http2');
const { EventEmitter } = require('events');
const mobilePush = require('../server/push/mobile');

(async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const credentials = { projectId: 'gunter-test-project', clientEmail: 'gunter-test@project.iam.gserviceaccount.com', privateKey };
    const calls = [];
    mobilePush._clearCache();
    const result = await mobilePush.wakeNode('node_test', 'cmd_test_123', {
        _deviceToken: `fcm-${'t'.repeat(90)}`, _credentials: credentials,
        _fetch: async (url, init) => {
            calls.push({ url, init });
            if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
            return { ok: true, status: 200, json: async () => ({ name: 'projects/gunter-test-project/messages/1' }) };
        }
    });
    assert.equal(result.delivered, true);
    assert.equal(calls.length, 2);
    const message = JSON.parse(calls[1].init.body).message;
    assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/gunter-test-project/messages:send');
    assert.equal(message.data.kind, 'GUNTER_COMMAND_READY');
    assert.equal(message.data.commandId, 'cmd_test_123');
    assert.equal(message.notification.title, 'Gunter');
    assert.equal(message.notification.body.includes('cmd_test_123'), false);
    assert.equal(JSON.stringify(message).includes('skill'), false);
    assert.equal(mobilePush.signServiceAssertion(credentials, 1000).split('.').length, 3);

    const apnsPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const apnsCredentials = {
        keyId: 'ABCDE12345', teamId: 'FGHIJ67890', topic: 'com.gunter.mobile',
        privateKey: apnsPair.privateKey.export({ type: 'pkcs8', format: 'pem' }), environment: 'sandbox'
    };
    const savedApnsEnv = Object.fromEntries(['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID', 'APNS_ENVIRONMENT'].map(key => [key, process.env[key]]));
    process.env.APNS_KEY_ID = apnsCredentials.keyId;
    process.env.APNS_TEAM_ID = apnsCredentials.teamId;
    process.env.APNS_PRIVATE_KEY = apnsCredentials.privateKey;
    process.env.APNS_BUNDLE_ID = apnsCredentials.topic;
    process.env.APNS_ENVIRONMENT = apnsCredentials.environment;
    assert.equal(mobilePush.isConfigured('apns'), true);
    process.env.APNS_TEAM_ID = '';
    assert.equal(mobilePush.isConfigured('apns'), false);
    for (const [key, value] of Object.entries(savedApnsEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const apnsCalls = [];
    const apnsResult = await mobilePush.wakeNode('node_ios_test', 'cmd_ios_123', {
        _deviceToken: 'a'.repeat(64), _provider: 'apns', _apnsCredentials: apnsCredentials,
        _sendApns: async (host, token, headers, body) => {
            apnsCalls.push({ url: `${host}/3/device/${token}`, init: { headers, body } });
            return { ok: true, status: 200 };
        }, _now: 1_700_000_000_000
    });
    assert.equal(apnsResult.delivered, true);
    assert.equal(apnsCalls[0].url, `https://api.sandbox.push.apple.com/3/device/${'a'.repeat(64)}`);
    assert.equal(apnsCalls[0].init.headers['apns-topic'], 'com.gunter.mobile');
    const apnsMessage = JSON.parse(apnsCalls[0].init.body);
    assert.equal(apnsMessage.commandId, 'cmd_ios_123');
    assert.equal(apnsMessage.aps.alert.title, 'Gunter');
    assert.equal(apnsMessage.aps.alert.body.includes('cmd_ios_123'), false);
    const jwt = apnsCalls[0].init.headers.authorization.slice('bearer '.length).split('.');
    assert.equal(jwt.length, 3);
    const unsigned = `${jwt[0]}.${jwt[1]}`;
    assert.equal(crypto.verify('sha256', Buffer.from(unsigned), {
        key: apnsPair.publicKey, dsaEncoding: 'ieee-p1363'
    }, Buffer.from(jwt[2], 'base64url')), true);

    const originalConnect = http2.connect;
    let h2Host;
    let h2Headers;
    let h2Body;
    http2.connect = host => {
        h2Host = host;
        const client = new EventEmitter();
        client.close = () => {};
        client.request = headers => {
            h2Headers = headers;
            const stream = new EventEmitter();
            stream.close = () => {};
            stream.end = body => {
                h2Body = body;
                queueMicrotask(() => {
                    stream.emit('response', { ':status': 200 });
                    stream.emit('data', Buffer.from('{}'));
                    stream.emit('end');
                });
            };
            return stream;
        };
        return client;
    };
    try {
        const h2Response = await mobilePush._sendApns('https://api.sandbox.push.apple.com', 'c'.repeat(64), {
            Authorization: 'bearer jwt', 'apns-topic': 'com.gunter.mobile'
        }, '{"aps":{}}');
        assert.equal(h2Response.ok, true);
        assert.equal(h2Host, 'https://api.sandbox.push.apple.com');
        assert.equal(h2Headers[':method'], 'POST');
        assert.equal(h2Headers[':path'], `/3/device/${'c'.repeat(64)}`);
        assert.equal(h2Headers.authorization, 'bearer jwt');
        assert.equal(h2Body, '{"aps":{}}');
    } finally { http2.connect = originalConnect; }
    mobilePush._clearCache();
    console.log('═══ MOBILE PUSH: FCM + APNs ✓ · 0 ✗ ═══');
})().catch(error => { console.error(error); process.exitCode = 1; });
