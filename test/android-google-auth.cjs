const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/services/google-auth-service.js'), 'utf8');
function load(userAgent) {
    const calls = { fetch: 0, scripts: 0, events: [] };
    const values = new Map();
    const window = { navigator: { userAgent }, dispatchEvent() {} };
    const context = {
        window, console,
        document: {
            readyState: 'loading', addEventListener(type, callback) { calls.events.push({ type, callback }); },
            createElement() { calls.scripts++; throw new Error('An embedded client must not load GIS'); }
        },
        fetch: async () => { calls.fetch++; return { ok: true, json: async () => ({ configured: false }) }; },
        sessionStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
        CustomEvent: function (type, init) { this.type = type; this.detail = init?.detail; },
        setTimeout, clearTimeout, setInterval, clearInterval
    };
    vm.runInNewContext(source, context, { filename: 'google-auth-service.js' });
    return { api: window.GunterGoogleAuth, calls, values };
}

(async () => {
    const native = load('Mozilla/5.0 Android; wv GunterAndroid/0.2');
    assert.equal(await native.api.init(), false);
    await assert.rejects(native.api.connect(), { code: 'GOOGLE_SYSTEM_BROWSER_REQUIRED' });
    await assert.rejects(native.api.getAccessToken(), { code: 'GOOGLE_SYSTEM_BROWSER_REQUIRED' });
    assert.equal(native.calls.fetch, 0);
    assert.equal(native.calls.scripts, 0);
    assert.equal(native.values.size, 0);
    assert.equal((await native.api.status()).requiresSystemBrowser, true);
    assert.equal(native.api.isConnected(), false);
    const browser = load('Mozilla/5.0 Android Chrome/140.0 Mobile Safari/537.36');
    assert.equal(await browser.api.init(), false);
    assert.equal(browser.calls.fetch, 1);
    assert.equal((await browser.api.status()).requiresSystemBrowser, false);
    await assert.rejects(browser.api.connect(), /Google no está configurado/);
    console.log('ANDROID GOOGLE AUTH: 12 assertions passed; no real OAuth request or token used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
