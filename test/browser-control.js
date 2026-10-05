const assert = require('node:assert/strict');
const vm = require('node:vm');
const { executeBrowser, resolveBrowser, safeUrl } = require('../gunter-node/lib/browser-control');
const { verify, get } = require('../server/control-plane/skills');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }
function session({ paused = true, blocked = false, consent = false } = {}) {
    const visits = [], video = { paused, readyState: 4, currentTime: 1 };
    const page = {
        setDefaultTimeout() {}, bringToFront: async () => {},
        goto: async url => { visits.push(url); return { status: () => 200 }; },
        url: () => consent ? 'https://consent.google.com/' : visits.at(-1), title: async () => 'AC/DC mix',
        locator: selector => {
            const locator = { first: () => locator, count: async () => selector.includes('list=RD') ? 0 : 1,
                waitFor: async () => {}, getAttribute: async () => '/watch?v=abcdefghijk', innerText: async () => 'AC/DC mix',
                evaluate: async fn => fn(video), click: async () => { video.paused = false; } };
            return locator;
        },
        waitForFunction: async (fn, start) => {
            if (!blocked) video.currentTime += 1;
            const document = { querySelector: selector => selector === 'video' ? video : null };
            const result = vm.runInNewContext(`(${fn.toString()})(start)`, { document, start });
            if (!result) throw new Error('playback timeout');
        }
    };
    return { newPage: async () => page, visits, video };
}
(async () => {
    console.log('GUNTER BROWSER CONTROL');
    await test('URLs ejecutables, credenciales y navegadores arbitrarios se rechazan', async () => {
        for (const url of ['file:///C:/data', 'javascript:alert(1)', 'https://user:pass@example.org', 'invalid']) assert.throws(() => safeUrl(url), /desktop_browser_url_invalid/);
        assert.equal(safeUrl('https://example.org'), 'https://example.org/');
        assert.throws(() => resolveBrowser('powershell'), /desktop_browser_not_supported/);
        assert.throws(() => resolveBrowser('brave', { browserRoots: [] }), /desktop_browser_not_installed/);
        await assert.rejects(executeBrowser('desktop.browser.eval', {}), /desktop_browser_action_not_allowed/);
    });
    await test('abre una página y obtiene evidencia del navegador, no de un spawn', async () => {
        const browserSession = session();
        const output = await executeBrowser('desktop.browser.open', { browser: 'brave', url: 'https://example.org/' }, { browserSession });
        assert.deepEqual(browserSession.visits, ['https://example.org/']);
        assert.equal(output.evidence.pageObserved, true); assert.equal(verify('desktop.browser.open', output).verified, true);
    });
    await test('búsqueda codifica texto como datos, no como script ni URL arbitraria', async () => {
        const browserSession = session(), query = 'AC/DC & mix';
        await executeBrowser('desktop.browser.search', { provider: 'youtube', query }, { browserSession });
        assert.equal(new URL(browserSession.visits[0]).searchParams.get('search_query'), query);
    });
    await test('mix se origina en un vídeo observado y exige avance del reproductor', async () => {
        const browserSession = session();
        const output = await executeBrowser('desktop.browser.youtube.play', { browser: 'brave', query: 'ACDC', mix: true }, { browserSession });
        const url = new URL(browserSession.visits[1]);
        assert.equal(url.searchParams.get('list'), 'RDabcdefghijk');
        assert.equal(output.result.playing, true); assert.equal(browserSession.video.paused, false);
        assert.equal(verify('desktop.browser.youtube.play', output).verified, true);
    });
    await test('pestaña abierta o vídeo detenido nunca se confirman como reproducción', async () => {
        const evidence = { pageObserved: true, urlHash: 'observed' };
        assert.equal(verify('desktop.browser.youtube.play', { evidence }).verified, false);
        await assert.rejects(executeBrowser('desktop.browser.youtube.play', { query: 'ACDC' }, { browserSession: session({ blocked: true }) }), /desktop_youtube_playback_not_confirmed/);
    });
    await test('consentimiento o redirección a otro dominio requieren un paso manual', async () => {
        await assert.rejects(executeBrowser('desktop.browser.youtube.play', { query: 'ACDC' }, { browserSession: session({ consent: true }) }), /desktop_youtube_manual_step_required/);
    });
    await test('acciones del navegador no se reintentan automáticamente', () => {
        assert.equal(get('desktop.browser.youtube.play').retryPolicy.maxAttempts, 1);
        assert.equal(get('desktop.browser.youtube.play').timeoutMs, 90000);
    });
    console.log(`═══ BROWSER: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => { console.error(error); process.exitCode = 1; });
