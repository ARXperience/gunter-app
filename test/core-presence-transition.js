'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-core-presence.js'), 'utf8');

class Events {
    constructor() { this.events = new Map(); }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    fire(type, values = {}) {
        const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
        for (const fn of [...(this.events.get(type) || [])]) fn(event);
        return event;
    }
}
class Element extends Events {
    constructor(tag, owner) {
        super(); this.tagName = tag; this.owner = owner; this.children = []; this.parentNode = null;
        this.style = { setProperty(key, value) { this[key] = value; } };
        this.dataset = {}; this.attrs = {}; this.hidden = false; this.className = ''; this.id = '';
        this.classList = { contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, on) => { if (on ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); } };
    }
    get isConnected() { return this === this.owner.documentElement || !!this.parentNode?.isConnected; }
    append(child) { child.remove(); this.children.push(child); child.parentNode = this; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    replaceWith(child) {
        const parent = this.parentNode, index = parent.children.indexOf(this);
        child.remove(); parent.children[index] = child; child.parentNode = parent; this.parentNode = null;
        if (child.classList.contains('gn-core-presence-anchor')) child.box = this.box;
    }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
    closest(selector) { return selector === 'a[href]' && this.tagName === 'a' && this.hasAttribute('href') ? this : this.parentNode?.closest(selector); }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    querySelector(selector) {
        const match = node => selector === '.gn-orbit-core[data-gunter-particles]'
            ? node.classList.contains('gn-orbit-core') && !!node.dataset.gunterParticles
            : selector === '.gn-core-presence' ? node.classList.contains('gn-core-presence') : false;
        for (const child of this.children) { if (match(child)) return child; const found = child.querySelector(selector); if (found) return found; }
        return null;
    }
    getBoundingClientRect() {
        return this.box || { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
            width: parseFloat(this.style.width) || 0, height: parseFloat(this.style.height) || 0 };
    }
    animate() { assert.fail('A rigid DOM animation must not replace the particle current'); }
}
function harness({ withHome = true, reduced = false, preference = false, speed = 1, mobile = false, handoff = null, available = true, pending = false } = {}) {
    const document = new Events();
    document.documentElement = new Element('html', document);
    document.body = new Element('body', document); document.documentElement.append(document.body);
    document.readyState = 'complete'; document.createElement = tag => new Element(tag, document);
    const companion = document.createElement('div'); companion.id = 'gunter-companion'; document.body.append(companion);
    const bubble = document.createElement('button'); bubble.className = 'gn-comp__bubble';
    bubble.box = mobile ? { left: 24, top: 730, width: 68, height: 68 } : { left: 24, top: 680, width: 68, height: 68 };
    companion.append(bubble);
    let home, hero, canvas;
    if (withHome) {
        home = document.createElement('section'); home.id = 'gunter-orbit-home'; document.body.append(home);
        document.body.classList.add('gunter-orbit-home-active');
        hero = document.createElement('div'); hero.className = 'gn-orbit-core gunter-idle-core'; hero.dataset.gunterParticles = 'hero';
        hero.box = mobile ? { left: 30, top: 170, width: 330, height: 330 } : { left: 350, top: 190, width: 420, height: 420 };
        canvas = document.createElement('canvas'); hero.append(canvas); home.append(hero);
    }
    document.getElementById = id => id === 'gunter-orbit-home' ? home : id === 'gunter-companion' ? companion : null;
    document.querySelector = selector => selector === '#gunter-companion .gn-comp__bubble' ? bubble : document.body.querySelector(selector);
    const window = new Events(), motion = new Events(), mutations = [], resizes = [], frames = new Map(), mounted = [], transports = [], assigned = [];
    const sessions = new Map(handoff ? [['gunter_core_visual_entry', JSON.stringify(handoff)]] : []);
    let frameId = 0, now = 1000, prefs = { reduceMotion: preference }, rendererAvailable = available && !pending;
    const config = { speed, glowColor: '#fa5638' };
    motion.matches = reduced;
    Object.assign(window, {
        innerWidth: mobile ? 390 : 1280, innerHeight: mobile ? 844 : 800,
        performance: { now: () => now }, matchMedia: () => motion,
        localStorage: { getItem: () => JSON.stringify(prefs) },
        sessionStorage: { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) },
        location: { href: withHome ? 'http://localhost:3001/day.html' : 'http://localhost:3001/config.html', assign: value => assigned.push(value) },
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        GunterParticles: { mount: node => { mounted.push(node); node.dataset.particlesReady = pending ? 'pending' : available ? 'true' : 'fallback'; }, getConfig: () => config,
            setTransport: (host, params) => { transports.push({ host, params: params ? JSON.parse(JSON.stringify(params)) : null }); return rendererAvailable; } },
        MutationObserver: class { constructor(fn) { this.fn = fn; mutations.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        ResizeObserver: class { constructor(fn) { this.fn = fn; resizes.push(this); } observe() {} unobserve() {} disconnect() { this.disconnected = true; } }
    });
    vm.runInNewContext(source, { window, document, URL, Date });
    const api = window.GunterCorePresence, portal = document.body.querySelector('.gn-core-presence');
    const anchor = home?.children.find(node => node.classList.contains('gn-core-presence-anchor'));
    const flush = (ms = 32) => { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); };
    const pump = ms => { for (let elapsed = 0; elapsed < ms; elapsed += 32) flush(Math.min(32, ms - elapsed)); };
    const finish = () => { let count = 0; while (frames.size && count++ < 1000) flush(); assert.ok(count < 1000, 'finite animation'); };
    const link = (href, extra = {}) => { const el = document.createElement('a'); el.setAttribute('href', href); for (const [key, value] of Object.entries(extra)) el.setAttribute(key, value); return el; };
    return { api, window, document, portal, home, hero, canvas, anchor, bubble, companion, motion, mounted, mutations, resizes, frames,
        config, transports, assigned, sessions, flush, pump, finish, link,
        ready: value => { rendererAvailable = value; mounted[0].dataset.particlesReady = value ? 'true' : 'fallback';
            mutations[0].fn([{ target: mounted[0], attributeName: 'data-particles-ready' }]); },
        setPreferences: value => { prefs = value; },
        leaveHome: () => { document.body.classList.remove('gunter-orbit-home-active'); if (home) home.hidden = true; api.sync(); },
        enterHome: () => { document.body.classList.add('gunter-orbit-home-active'); home.hidden = false; api.sync(); } };
}
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
(async () => {
    await check('the same connected renderer host and canvas survive both destinations', () => {
        const h = harness();
        assert.equal(h.portal.children[0], h.hero); assert.equal(h.hero.children[0], h.canvas);
        assert.equal(h.anchor.dataset.gunterParticles, undefined); assert.equal(h.mounted.length, 1);
        assert.equal(h.api.getState().mode, 'home'); assert.equal(h.portal.style.pointerEvents, 'none');
        h.leaveHome(); h.finish(); h.enterHome(); h.finish();
        assert.equal(h.portal.children[0], h.hero); assert.equal(h.mounted.length, 1);
    });
    await check('a stationary expanded canvas carries a finite GPU river, never a translated block', () => {
        const h = harness(); h.leaveHome();
        assert.equal(h.api.getState().mode, 'dock'); assert.equal(h.api.getState().target.width, 112);
        assert.equal(h.portal.dataset.flow, 'active');
        const box = JSON.stringify(h.portal.getBoundingClientRect()), initial = h.transports.at(-1).params;
        assert.equal(initial.progress, 0); assert.equal(initial.bend, -.18);
        assert.ok(initial.fromScale > initial.toScale); assert.ok(initial.from[1] > initial.to[1], 'NDC y points upward');
        h.pump(500);
        assert.equal(JSON.stringify(h.portal.getBoundingClientRect()), box);
        assert.ok(h.api.getState().progress > .25 && h.api.getState().progress < .3);
        h.finish();
        assert.equal(h.api.getState().animating, false); assert.equal(h.frames.size, 0);
        assert.equal(h.portal.dataset.flow, 'idle'); assert.equal(h.transports.at(-1).params, null);
        assert.equal(h.portal.getBoundingClientRect().width, 112);
    });
    await check('fast routing cancels old flow and starts at the current GPU curve center', () => {
        const h = harness(); h.leaveHome(); h.pump(480);
        const progress = h.api.getState().progress, box = h.portal.getBoundingClientRect();
        const first = h.transports.at(-1).params, a = first.from, b = first.to;
        const px = (a[0] + 1) * box.width / 2 + box.left, py = (1 - a[1]) * box.height / 2 + box.top;
        const dx = (b[0] - a[0]) * box.width / 2, dy = -(b[1] - a[1]) * box.height / 2;
        const bow = 4 * first.bend * progress * (1 - progress);
        const expected = [px + dx * progress + dy * bow, py + dy * progress - dx * bow];
        h.enterHome();
        const current = h.transports.at(-1).params, nextBox = h.portal.getBoundingClientRect();
        const actual = [(current.from[0] + 1) * nextBox.width / 2 + nextBox.left,
            (1 - current.from[1]) * nextBox.height / 2 + nextBox.top];
        assert.ok(Math.abs(actual[0] - expected[0]) < .001); assert.ok(Math.abs(actual[1] - expected[1]) < .001);
        assert.equal(h.frames.size, 1); h.finish(); assert.equal(h.portal.getBoundingClientRect().width, 420);
    });
    await check('both river directions arc above the straight endpoint chord and preserve exact endpoints', () => {
        const h = harness(); h.leaveHome();
        const departure = h.transports.at(-1).params;
        assert.equal(departure.bend, -.18);
        const checkArc = params => {
            const box = h.portal.getBoundingClientRect();
            const dx = (params.to[0] - params.from[0]) * box.width / 2;
            const screenOffsetY = -dx * params.bend;
            assert.ok(screenOffsetY < 0, 'middle of the curve bows upward in screen space');
            for (const p of [0, 1]) assert.equal(Math.abs(4 * params.bend * p * (1 - p)), 0, 'curve meets its original endpoint');
        };
        checkArc(departure); h.finish(); h.enterHome();
        const arrival = h.transports.at(-1).params; assert.equal(arrival.bend, .18); checkArc(arrival); h.finish();
    });
    await check('transport advances with the existing particle speed, including zero and live changes', () => {
        const normal = harness(), fast = harness({ speed: 2 });
        normal.leaveHome(); fast.leaveHome(); normal.pump(512); fast.pump(512);
        assert.ok(Math.abs(fast.api.getState().progress - normal.api.getState().progress * 2) < .0001);
        normal.config.speed = 0; normal.flush(); assert.equal(normal.api.getState().animating, false);
        const stopped = harness({ speed: 0 }); stopped.leaveHome(); assert.equal(stopped.frames.size, 0);
        assert.equal(stopped.portal.getBoundingClientRect().width, 112);
    });
    await check('OS and saved reduced-motion preferences settle immediately without rewriting preferences', () => {
        for (const options of [{ reduced: true }, { preference: true }, {}]) {
            const h = harness(options);
            if (!options.reduced && !options.preference) h.document.documentElement.classList.add('reduce-motion');
            h.leaveHome(); assert.equal(h.api.getState().animating, false); assert.equal(h.frames.size, 0);
        }
        const h = harness(); h.leaveHome(); h.setPreferences({ reduceMotion: true });
        h.window.fire('storage', { key: 'gunter_prefs' }); h.flush();
        assert.equal(h.api.getState().animating, false); assert.equal(h.portal.getBoundingClientRect().width, 112);
    });
    await check('mobile river bounds and the complete resting dock remain inside the viewport', () => {
        const h = harness({ mobile: true }); h.leaveHome();
        let box = h.portal.getBoundingClientRect();
        assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= 390 && box.top + box.height <= 844);
        h.finish(); box = h.portal.getBoundingClientRect();
        assert.ok(box.left >= 0 && box.left + box.width <= 390);
        assert.equal(h.portal.style['--core-geometry-color'], '#fa5638');
    });
    await check('hidden companion hides only the dock and a restored dock renders again', () => {
        const h = harness(); h.companion.classList.add('is-hidden'); h.api.sync(); assert.equal(h.portal.hidden, false);
        h.leaveHome(); assert.equal(h.portal.hidden, true); assert.equal(h.frames.size, 0);
        h.companion.classList.remove('is-hidden'); h.api.sync(); assert.equal(h.portal.hidden, false);
    });
    await check('interior pages mount just one core and keep an unobstructed accessible chat target', () => {
        const h = harness({ withHome: false }); assert.equal(h.api.getState().mode, 'dock');
        h.api.init(); h.api.sync(); assert.equal(h.mounted.length, 1);
        assert.equal(h.document.body.children.filter(node => node.classList.contains('gn-core-presence')).length, 1);
        assert.equal(h.portal.style.pointerEvents, 'none');
    });
    await check('BFCache and dispose cancel all flow frames and restore the borrowed host safely', () => {
        const h = harness(); h.leaveHome(); h.pump(200);
        h.window.fire('pagehide', { persisted: true }); assert.equal(h.frames.size, 0);
        h.window.fire('pageshow', { persisted: true }); assert.equal(h.portal.getBoundingClientRect().width, 112);
        h.enterHome(); h.api.dispose();
        assert.equal(h.hero.parentNode, h.home); assert.equal(h.hero.classList.contains('gn-orbit-core'), true);
        assert.equal(h.portal.isConnected, false); assert.equal(h.frames.size, 0);
        assert.equal(h.mutations[0].disconnected, true); assert.equal(h.resizes[0].disconnected, true);
    });
    await check('repeated layout events coalesce without an idle animation loop', () => {
        const h = harness(); h.window.fire('resize'); h.window.fire('hashchange'); h.window.fire('gunter-open-tab');
        assert.equal(h.frames.size, 1); h.flush(); assert.equal(h.frames.size, 0);
        h.mutations[0].fn([{ target: h.portal }]); assert.equal(h.frames.size, 0);
    });
    await check('cross-document departure finishes the current before assigning the existing route', async () => {
        const h = harness(), result = h.api.navigate('config.html#preferences');
        assert.equal(h.assigned.length, 0); assert.equal(h.api.getState().animating, true);
        h.finish(); assert.equal(await result, true);
        assert.deepEqual(h.assigned, ['http://localhost:3001/config.html#preferences']);
        assert.equal(h.sessions.size, 0, 'no state or user data for departure');
    });
    await check('home entry uses only a short-lived visual handoff and returns particles to center', async () => {
        const old = harness({ withHome: false }); assert.equal(await old.api.navigate('day.html'), true);
        const entry = JSON.parse(old.sessions.get('gunter_core_visual_entry'));
        assert.deepEqual(Object.keys(entry).sort(), ['at', 'kind']); assert.equal(entry.kind, 'home-entry');
        const h = harness({ handoff: entry }); assert.equal(h.api.getState().animating, true);
        assert.equal(h.api.getState().target.width, 420); assert.equal(h.sessions.size, 0); h.finish();
        const expired = harness({ handoff: { kind: 'home-entry', at: Date.now() - 6000 } });
        assert.equal(expired.api.getState().animating, false); assert.equal(expired.sessions.size, 0);
    });
    await check('same-document Núcleo links return through the existing hash router without reloading the canvas', async () => {
        const h = harness(); h.leaveHome(); h.finish();
        h.window.location.href = 'http://localhost:3001/day.html#tasks';
        assert.equal(await h.api.navigate('day.html'), true);
        assert.equal(h.window.location.hash, '#home'); assert.equal(h.assigned.length, 0);
        h.enterHome(); assert.equal(h.api.getState().animating, true); h.finish();
        assert.equal(h.portal.children[0], h.hero); assert.equal(h.mounted.length, 1);
        h.leaveHome(); h.finish();
        assert.equal(h.document.fire('click', { button: 0, target: h.link('day.html#home') }).defaultPrevented, true);
        assert.equal(h.assigned.length, 0);
        assert.equal(await h.api.navigate('day.html#events'), false, 'ordinary section hash belongs to its existing router');
        const reduced = harness({ reduced: true }); reduced.leaveHome();
        reduced.window.location.href = 'http://localhost:3001/day.html#tasks';
        assert.equal(reduced.document.fire('click', { button: 0, target: reduced.link('day.html') }).defaultPrevented, true);
        assert.equal(reduced.window.location.hash, '#home'); assert.equal(reduced.assigned.length, 0);
    });
    await check('cross-document entry waits for real compositor readiness with one event, not a polling loop', () => {
        const handoff = { kind: 'home-entry', at: Date.now() };
        const h = harness({ handoff, pending: true });
        assert.equal(h.api.getState().animating, false); assert.equal(h.api.getState().mode, 'dock');
        assert.equal(h.frames.size, 0); assert.equal(h.sessions.size, 0);
        h.ready(true); assert.equal(h.frames.size, 1); h.flush();
        assert.equal(h.api.getState().animating, true); assert.equal(h.api.getState().target.width, 420);
        h.finish(); h.ready(true); assert.equal(h.frames.size, 0, 'rendering ready repeatedly never replays the entry');
        const failed = harness({ handoff, pending: true }); failed.ready(false); failed.flush();
        assert.equal(failed.api.getState().animating, false); assert.equal(failed.portal.getBoundingClientRect().width, 420);
    });
    await check('external, admin/auth, downloads, new tabs, modifiers and same-page hashes are never intercepted', async () => {
        const h = harness();
        for (const href of ['https://example.com/config.html', 'admin.html', 'login.html', 'day.html#tasks', 'javascript:alert(1)', '../other/config.html']) {
            assert.equal(await h.api.navigate(href), false, href);
            assert.equal(h.document.fire('click', { button: 0, target: h.link(href) }).defaultPrevented, false, href);
        }
        for (const attrs of [{ download: '' }, { target: '_blank' }])
            assert.equal(h.document.fire('click', { button: 0, target: h.link('config.html', attrs) }).defaultPrevented, false);
        for (const flag of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])
            assert.equal(h.document.fire('click', { button: 0, target: h.link('config.html'), [flag]: true }).defaultPrevented, false);
        assert.equal(h.assigned.length, 0);
        assert.equal(h.document.fire('click', { button: 0, target: h.link('config.html') }).defaultPrevented, true);
        h.finish(); await Promise.resolve(); assert.equal(h.assigned.length, 1);
    });
    await check('reduced motion does not delay cross-document navigation and disposal never navigates later', async () => {
        const h = harness({ reduced: true }); assert.equal(await h.api.navigate('config.html'), true);
        assert.equal(h.frames.size, 0); assert.equal(h.sessions.size, 0);
        const active = harness(), pending = active.api.navigate('config.html'); active.api.dispose();
        await assert.rejects(pending, { name: 'AbortError' });
        assert.equal(active.assigned.length, 0); assert.equal(active.frames.size, 0);
        const racing = harness(), first = racing.api.navigate('config.html');
        assert.equal(await racing.api.navigate('results.html'), true);
        racing.finish();
        await assert.rejects(first, { name: 'AbortError' });
        assert.equal(racing.assigned.length, 1); assert.match(racing.assigned[0], /results\.html$/);
    });
    await check('a renderer that rejects transport never delays navigation or starts a flow loop', async () => {
        const h = harness({ available: false });
        assert.equal(await h.api.navigate('config.html'), true);
        assert.equal(h.api.getState().animating, false); assert.equal(h.frames.size, 0);
        assert.equal(h.assigned.length, 1); assert.equal(h.portal.getBoundingClientRect().width, 112);
    });
    await check('all shared pages retain one controller and the existing appearance preferences', () => {
        const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
        for (const page of ['day.html', 'dashboard.html', 'config.html', 'results.html', 'meeting.html', 'new-project.html', 'index.html']) {
            const html = read(page);
            assert.equal((html.match(/src="js\/services\/gunter-core-presence\.js\?/g) || []).length, 1, page);
            assert.ok(html.indexOf('js/services/gunter-core-presence.js') > html.indexOf('js/services/gunter-companion.js'), page);
            assert.match(html, /href="styles\/gunter-core-presence\.css\?/);
        }
        assert.doesNotMatch(source, /portal\.animate\(/);
        assert.match(read('service-worker.js'), /\/js\/services\/gunter-core-presence\.js\?/);
    });
    console.log('Core presence: ' + passed + ' focused checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
