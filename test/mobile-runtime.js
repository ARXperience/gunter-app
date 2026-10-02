const assert = require('assert');
const { execute, sanitize } = require('../gunter-mobile/lib/executors');
const { GunterMobileRuntime } = require('../gunter-mobile/runtime');

(async () => {
    let passed = 0; const test = async (name, fn) => { await fn(); passed += 1; console.log(`  ✓ ${name}`); };
    console.log('GUNTER MOBILE RUNTIME CORE');
    await test('solo permite deep links declarados', async () => {
        assert.equal(sanitize('mobile.open_app', { app: 'Spotify', deepLink: 'spotify:track:123' }).deepLink, 'spotify:track:123');
        assert.throws(() => sanitize('mobile.open_app', { deepLink: 'javascript:alert(1)' }), /mobile_deep_link_not_allowed/);
    });
    await test('acota la búsqueda móvil y sanea nombres y tokens de archivo', async () => {
        const search = sanitize('mobile.files.search', { folderToken: 'content://selected', query: ' contrato\n2026 ', limit: 999 });
        assert.equal(search.query, 'contrato2026'); assert.equal(search.limit, 100);
        const file = sanitize('mobile.files.open', { fileName: ' contrato.pdf ', folderToken: 'content://selected', fileToken: 'content://selected/item' });
        assert.equal(file.fileName, 'contrato.pdf'); assert.equal(file.folderToken, 'content://selected');
        assert.equal(sanitize('mobile.files.open', { fileName: 'x'.repeat(241) }).fileName.length, 240);
    });
    await test('verifica acciones nativas antes de reportarlas', async () => {
        const result = await execute({ skill: 'mobile.open_app', payload: { app: 'Spotify' } }, { openApp: async () => ({ result: { app: 'Spotify' }, evidence: { appOpened: true } }) });
        assert.equal(result.evidence.appOpened, true);
        await assert.rejects(() => execute({ skill: 'mobile.message.send', payload: { recipient: 'Ana', text: 'Hola' } }, { sendMessage: async () => ({ evidence: {} }) }), /mobile_result_not_verified/);
    });
    await test('runtime reporta capacidades y resultados al Control Plane', async () => {
        const calls = { result: [] }; let first = true;
        const api = { heartbeat: async () => ({ ok: true }), pull: async () => ({ items: first ? (first = false, [{ id: 'm1', skill: 'mobile.media.play_pause', payload: {} }]) : [] }), result: async value => { calls.result.push(value); return value; } };
        const adapter = { capabilities: ['mobile.media.control'], permissionState: () => 'granted', media: async () => ({ result: {}, evidence: { playbackStateChanged: true } }) };
        const runtime = new GunterMobileRuntime({ serverUrl: 'https://gunter.test', nodeId: 'mobile_1', nodeToken: 'gn_test', nodeType: 'ANDROID' }, adapter, { api });
        await runtime.start(); await runtime.stop();
        assert.equal(calls.result[0].evidence.playbackStateChanged, true);
    });
    console.log(`═══ MOBILE RUNTIME: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error); process.exitCode = 1; });
