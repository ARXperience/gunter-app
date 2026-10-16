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
    fire(type, values = {}) { for (const fn of [...(this.events.get(type) || [])]) fn({ type, ...values }); }
}
class Element extends Events {
    constructor(tag, owner) {
        super(); this.tagName = tag; this.owner = owner; this.children = []; this.parentNode = null;
        this.style = {}; this.dataset = {}; this.attrs = {}; this.hidden = false; this.className = ''; this.id = '';
        this.animations = [];
        this.classList = { contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, on) => { if (on ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); } };
    }
    get isConnected() { return this === this.owner.documentElement || !!this.parentNode?.isConnected; }
    append(child) { child.remove(); this.children.push(child); child.parentNode = this; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    replaceWith(child) { const parent = this.parentNode, index = parent.children.indexOf(this); child.remove(); parent.children[index] = child; child.parentNode = parent; this.parentNode = null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    querySelector(selector) {
        const match = node => selector === '.gn-orbit-core[data-gunter-particles]'
            ? node.classList.contains('gn-orbit-core') && !!node.dataset.gunterParticles
            : selector === '.gn-core-presence' ? node.classList.contains('gn-core-presence') : false;
        for (const child of this.children) { if (match(child)) return child; const found = child.querySelector(selector); if (found) return found; }
        return null;
    }
    getBoundingClientRect() {
        return this.liveRect || this.box || { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
            width: parseFloat(this.style.width) || 0, height: parseFloat(this.style.height) || 0 };
    }
    animate(keyframes, options) {
        const record = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
        this.animations.push(record); return record;
    }
}
function harness({ withHome = true, reduced = false, preference = false } = {}) {
    const document = new Events();
    document.documentElement = new Element('html', document);
    document.body = new Element('body', document); document.documentElement.append(document.body);
    document.readyState = 'complete';
    document.createElement = tag => new Element(tag, document);
    const companion = document.createElement('div'); companion.id = 'gunter-companion'; document.body.append(companion);
    const bubble = document.createElement('button'); bubble.className = 'gn-comp__bubble';
    bubble.box = { left: 24, top: 680, width: 68, height: 68 }; companion.append(bubble);
    let home, hero, canvas;
    if (withHome) {
        home = document.createElement('section'); home.id = 'gunter-orbit-home'; document.body.append(home);
        document.body.classList.add('gunter-orbit-home-active');
        hero = document.createElement('div'); hero.className = 'gn-orbit-core gunter-idle-core'; hero.dataset.gunterParticles = 'hero';
        hero.box = { left: 350, top: 190, width: 420, height: 420 };
        canvas = document.createElement('canvas'); hero.append(canvas); home.append(hero);
    }
    document.getElementById = id => id === 'gunter-orbit-home' ? home : id === 'gunter-companion' ? companion : null;
    document.querySelector = selector => selector === '#gunter-companion .gn-comp__bubble' ? bubble : document.body.querySelector(selector);
    const window = new Events(), motion = new Events(), mutations = [], resizes = [], frames = new Map(), mounted = [];
    let frameId = 0, prefs = { reduceMotion: preference };
    motion.matches = reduced;
    Object.assign(window, {
        matchMedia: () => motion,
        localStorage: { getItem: () => JSON.stringify(prefs) },
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        GunterParticles: { mount: node => mounted.push(node) },
        MutationObserver: class { constructor(fn) { this.fn = fn; mutations.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        ResizeObserver: class { constructor(fn) { this.fn = fn; resizes.push(this); } observe() {} unobserve() {} disconnect() { this.disconnected = true; } }
    });
    vm.runInNewContext(source, { window, document });
    const api = window.GunterCorePresence, portal = document.body.querySelector('.gn-core-presence');
    const anchor = home?.children.find(node => node.classList.contains('gn-core-presence-anchor'));
    if (anchor) { anchor.box = hero.box; api.sync(); portal.animations.length = 0; }
    return { api, window, document, portal, home, hero, canvas, anchor, bubble, companion, motion, mounted, mutations, resizes, frames,
        setPreferences: value => { prefs = value; },
        flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
        leaveHome: () => { document.body.classList.remove('gunter-orbit-home-active'); if (home) home.hidden = true; api.sync(); },
        enterHome: () => { document.body.classList.add('gunter-orbit-home-active'); home.hidden = false; api.sync(); } };
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`); }
check('same renderer host and canvas are reparented, anchor keeps home layout', () => {
    const h = harness();
    assert.equal(h.portal.children[0], h.hero);
    assert.equal(h.hero.children[0], h.canvas);
    assert.equal(h.anchor.dataset.gunterParticles, undefined);
    assert.equal(h.hero.classList.contains('gn-orbit-core'), false);
    assert.equal(h.mounted.length, 1);
    assert.equal(h.api.getState().mode, 'home');
    assert.equal(h.portal.style.pointerEvents, 'none');
});
check('navigation docks one host at the existing circle and returns to center', () => {
    const h = harness(); h.leaveHome();
    assert.equal(h.api.getState().mode, 'dock');
    assert.equal(h.api.getState().target.width, 112);
    assert.equal(h.api.getState().target.left, 2);
    assert.equal(h.api.getState().target.top, 658);
    assert.equal(h.portal.animations.length, 1);
    assert.equal(h.portal.animations[0].options.duration, 550);
    h.enterHome();
    assert.equal(h.api.getState().target.width, 420);
    assert.equal(h.portal.children[0], h.hero);
    assert.equal(h.mounted.length, 1);
});
check('fast navigation cancels old animation and begins from current visual rect', () => {
    const h = harness(); h.leaveHome(); const first = h.portal.animations[0];
    h.portal.liveRect = { left: 170, top: 400, width: 200, height: 200 };
    h.enterHome();
    assert.equal(first.cancelled, true);
    assert.match(h.portal.animations[1].keyframes[0].transform, /^translate\(-180px, 210px\) scale\(0\.476/);
});
check('hover and keyboard focus peek outside circle without swallowing clicks', () => {
    const h = harness(); h.leaveHome();
    h.bubble.fire('pointerenter'); assert.equal(h.portal.classList.contains('is-peeking'), true);
    h.bubble.fire('pointerleave'); assert.equal(h.portal.classList.contains('is-peeking'), false);
    h.bubble.fire('focusin'); assert.equal(h.portal.classList.contains('is-peeking'), true);
    h.enterHome(); assert.equal(h.portal.classList.contains('is-peeking'), false);
});
check('reduced motion from OS, saved preferences and html disables transport animation', () => {
    for (const options of [{ reduced: true }, { preference: true }, {}]) {
        const h = harness(options);
        if (!options.reduced && !options.preference) h.document.documentElement.classList.add('reduce-motion');
        h.leaveHome(); assert.equal(h.portal.animations.length, 0);
        assert.equal(h.api.getState().mode, 'dock');
    }
    const h = harness(); h.document.body.classList.add('reduce-motion'); h.leaveHome();
    assert.equal(h.portal.animations.length, 0);
});
check('hidden companion hides dock but never the home core; restored dock becomes visible', () => {
    const h = harness(); h.companion.classList.add('is-hidden'); h.api.sync();
    assert.equal(h.portal.hidden, false);
    h.leaveHome(); assert.equal(h.portal.hidden, true);
    h.companion.classList.remove('is-hidden'); h.api.sync();
    assert.equal(h.portal.hidden, false); assert.equal(h.api.getState().mode, 'dock');
});
check('new preference cancels an in-flight animation without rewriting preferences', () => {
    const h = harness(); h.leaveHome(); const active = h.portal.animations[0];
    h.setPreferences({ reduceMotion: true });
    h.window.fire('storage', { key: 'gunter_prefs' }); h.flush();
    assert.equal(active.cancelled, true);
    assert.equal(h.api.getState().animating, false);
});
check('interior page mounts a shared hero-sized dock, not a second renderer', () => {
    const h = harness({ withHome: false });
    assert.equal(h.api.getState().mode, 'dock');
    assert.equal(h.portal.children[0].dataset.gunterParticles, 'hero');
    assert.equal(h.mounted.length, 1);
    h.api.init(); h.api.sync(); assert.equal(h.mounted.length, 1);
    assert.equal(h.document.body.children.filter(node => node.classList.contains('gn-core-presence')).length, 1);
});
check('BFCache pause and resume reconcile layout; dispose restores original host', () => {
    const h = harness();
    h.window.fire('pagehide', { persisted: true }); h.leaveHome();
    assert.equal(h.api.getState().mode, 'home');
    h.window.fire('pageshow', { persisted: true }); assert.equal(h.api.getState().mode, 'dock');
    h.api.dispose();
    assert.equal(h.hero.parentNode, h.home);
    assert.equal(h.hero.classList.contains('gn-orbit-core'), true);
    assert.equal(h.portal.isConnected, false);
    assert.equal(h.mutations[0].disconnected, true);
    assert.equal(h.resizes[0].disconnected, true);
    assert.equal(h.frames.size, 0);
});
check('layout changes coalesce and never form a perpetual animation loop', () => {
    const h = harness();
    h.window.fire('resize'); h.window.fire('hashchange'); h.window.fire('gunter-open-tab');
    assert.equal(h.frames.size, 1); h.flush(); assert.equal(h.frames.size, 0);
    h.mutations[0].fn([{ target: h.portal }]); assert.equal(h.frames.size, 0);
});
check('all shared pages load one presence controller after chat and keep the existing appearance controls', () => {
    const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    for (const page of ['day.html', 'dashboard.html', 'config.html', 'results.html', 'meeting.html', 'new-project.html', 'index.html']) {
        const html = read(page);
        assert.equal((html.match(/src="js\/services\/gunter-core-presence\.js\?/g) || []).length, 1, page);
        assert.ok(html.indexOf('js/services/gunter-core-presence.js') > html.indexOf('js/services/gunter-companion.js'), page);
        assert.match(html, /href="styles\/gunter-core-presence\.css\?/);
    }
    const css = read('styles/gunter-core-presence.css');
    assert.match(css, /#gunter-companion\.gn-comp\s*\{\s*display: block !important/,
        'the old configuration-page rule must not hide the shared circle');
    assert.match(css, /--core-dock-left: max\(32px/, 'the mobile filament host fits completely inside the viewport');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /html\.reduce-motion::view-transition-group/);
    assert.match(read('service-worker.js'), /\/js\/services\/gunter-core-presence\.js\?/);
    assert.match(read('service-worker.js'), /\/styles\/gunter-core-presence\.css\?/);
});
console.log(`Core presence: ${passed} focused checks passed.`);
