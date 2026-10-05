/* Explicit opt-in integration test: uses installed Brave with a disposable profile. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { executeBrowser, resolveBrowser } = require('../gunter-node/lib/browser-control');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-brave-live-'));
const artifact = path.resolve(__dirname, '..', 'output', 'brave-live.png');
let session;
(async () => {
    const browser = resolveBrowser('brave');
    session = await chromium.launchPersistentContext(profile, { executablePath: browser.executablePath, headless: false, viewport: { width: 1100, height: 780 }, ignoreDefaultArgs: ['--mute-audio'], timeout: 15000 });
    try {
        const output = await executeBrowser('desktop.browser.youtube.play', { browser: 'brave', query: 'ACDC', mix: true }, { browserSession: session });
        assert.equal(output.result.playing, true);
        assert.equal(output.evidence.mediaAdvanced, true);
        console.log(JSON.stringify({ success: true, title: output.result.title, url: output.result.url, evidence: output.evidence }));
    } finally {
        const page = session.pages().at(-1);
        if (page) { fs.mkdirSync(path.dirname(artifact), { recursive: true }); await page.screenshot({ path: artifact }).catch(() => {}); }
    }
})().catch(error => { console.error('Real Brave test:', error.code || error.message); process.exitCode = 1; }).finally(async () => {
    await session?.close();
    const resolved = path.resolve(profile), allowed = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(allowed) && path.basename(resolved).startsWith('gunter-brave-live-')) fs.rmSync(resolved, { recursive: true, force: true });
});
