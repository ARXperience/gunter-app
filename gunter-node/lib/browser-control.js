const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rootDir } = require('./config-store');
const sessions = new Map();
let commandQueue = Promise.resolve();
const coded = code => Object.assign(new Error(code), { code });

function resolveBrowser(name = 'default', context = {}) {
    const browser = String(name).toLowerCase().replace(/\s+/g, '').replace(/browser|navegador/g, '');
    const paths = {
        brave: ['BraveSoftware/Brave-Browser/Application/brave.exe'],
        chrome: ['Google/Chrome/Application/chrome.exe'],
        edge: ['Microsoft/Edge/Application/msedge.exe']
    };
    if (browser !== 'default' && !paths[browser]) throw coded('desktop_browser_not_supported');
    const roots = context.browserRoots || [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const names = browser === 'default' ? ['brave', 'edge', 'chrome'] : [browser];
    for (const candidate of names) for (const root of roots) for (const suffix of paths[candidate]) {
        const executablePath = path.join(root, suffix);
        if (fs.existsSync(executablePath)) return { browser: candidate, executablePath };
    }
    throw coded('desktop_browser_not_installed');
}
function safeUrl(value) {
    let url;
    try { url = new URL(String(value)); } catch { throw coded('desktop_browser_url_invalid'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw coded('desktop_browser_url_invalid');
    return url.href;
}
async function getSession(browser, context) {
    if (context.browserSession) return context.browserSession;
    const resolved = resolveBrowser(browser, context);
    const key = path.join(rootDir(), 'browser-profiles', resolved.browser);
    if (!sessions.has(key)) {
        const launching = require('playwright-core').chromium.launchPersistentContext(key, {
            executablePath: resolved.executablePath, headless: false, viewport: null,
            ignoreDefaultArgs: ['--mute-audio'], timeout: 15000
        }).then(session => { session.on('close', () => sessions.delete(key)); return session; }).catch(error => { sessions.delete(key); throw error; });
        sessions.set(key, launching);
    }
    return sessions.get(key);
}
function executeBrowser(skill, payload, context = {}) {
    const task = commandQueue.catch(() => {}).then(() => run(skill, payload, context));
    commandQueue = task;
    return task;
}
async function run(skill, payload = {}, context = {}) {
    if (!['desktop.browser.open', 'desktop.browser.search', 'desktop.browser.youtube.play'].includes(skill)) throw coded('desktop_browser_action_not_allowed');
    const query = String(payload.query || '').trim().slice(0, 220);
    if (skill !== 'desktop.browser.open' && !query) throw coded('desktop_browser_query_required');
    const provider = payload.provider === 'youtube' || skill === 'desktop.browser.youtube.play' ? 'youtube' : 'google';
    const target = skill === 'desktop.browser.open' ? safeUrl(payload.url)
        : provider === 'youtube' ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query + (payload.mix ? ' mix' : ''))}`
            : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const session = await getSession(payload.browser || 'default', context);
    const page = await session.newPage();
    page.setDefaultTimeout(8000);
    await page.bringToFront();
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
    if (response && response.status() >= 400) throw coded('desktop_browser_page_unavailable');
    if (skill === 'desktop.browser.youtube.play') {
        if (!['youtube.com', 'www.youtube.com'].includes(new URL(page.url()).hostname)) throw coded('desktop_youtube_manual_step_required');
        try {
            // Prefer an observed mix result. If none exists, start radio from an observed video.
            await page.locator('ytd-search a[href*="/watch?v="]').first().waitFor({ state: 'visible', timeout: 10000 });
            let item = page.locator('ytd-search a[href*="/watch?v="][href*="list=RD"]').first();
            if (!payload.mix || !await item.count()) item = page.locator('ytd-search a#video-title[href*="/watch?v="]').first();
            const href = await item.getAttribute('href');
            const videoUrl = new URL(href, 'https://www.youtube.com');
            if (videoUrl.hostname !== 'www.youtube.com' || !/^[\w-]{11}$/.test(videoUrl.searchParams.get('v') || '')) throw coded('desktop_youtube_result_not_found');
            if (payload.mix && !videoUrl.searchParams.has('list')) { videoUrl.searchParams.set('list', 'RD' + videoUrl.searchParams.get('v')); videoUrl.searchParams.set('start_radio', '1'); }
            await page.goto(videoUrl.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.locator('video').first().waitFor({ state: 'attached', timeout: 8000 });
            const paused = await page.locator('video').first().evaluate(video => video.paused);
            if (paused) await page.locator('.ytp-play-button').click({ timeout: 5000 });
            const time = await page.locator('video').first().evaluate(video => video.currentTime);
            await page.waitForFunction(start => {
                const video = document.querySelector('video');
                return video && !video.paused && video.readyState >= 2 && video.currentTime > start + 0.5 && !document.querySelector('.html5-video-player.ad-showing');
            }, time, { timeout: 45000 });
            const title = await page.locator('h1.ytd-watch-metadata').innerText().catch(() => page.title());
            return { result: { browser: payload.browser || 'default', query, title, url: page.url(), playing: true, profile: 'Gunter' }, evidence: { pageObserved: true, playbackObserved: true, mediaAdvanced: true, urlHash: hash(page.url()) } };
        } catch (error) {
            if (error.code) throw error;
            // Keep the visible tab for a consent/login/autoplay step; report uncertainty.
            throw coded('desktop_youtube_playback_not_confirmed');
        }
    }
    return { result: { browser: payload.browser || 'default', query, url: page.url(), title: await page.title(), profile: 'Gunter' }, evidence: { pageObserved: true, urlHash: hash(page.url()) } };
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
module.exports = { executeBrowser, resolveBrowser, safeUrl };
