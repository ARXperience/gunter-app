'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/services/theme-bootstrap.js'), 'utf8');
const toggle = fs.readFileSync(path.join(root, 'js/services/theme-toggle.js'), 'utf8');

function node(...initial) {
    const tokens = new Set(initial), attrs = new Map();
    return { style: {}, classList: {
        contains: value => tokens.has(value), add: value => tokens.add(value),
        remove: (...values) => values.forEach(value => tokens.delete(value)),
        toggle(value, force) { if (force) tokens.add(value); else tokens.delete(value); }
    }, setAttribute(key, value) { attrs.set(key, value); }, getAttribute(key) { return attrs.get(key); },
    addEventListener() {}, appendChild() {} };
}
function fixture(values = {}, options = {}) {
    const saved = new Map(Object.entries(values)), writes = [], events = [], listeners = {}, observers = [];
    const html = node(), preference = { checked: false };
    const media = { matches: Boolean(options.dark), addEventListener(type, fn) { this.change = fn; } };
    const document = { documentElement: html, body: options.body ? node('at-dark', 'gunter-workspace') : null,
        readyState: 'loading', getElementById: id => id === 'pref-dark-mode' ? preference : null,
        querySelector: () => null, createElement: () => node(), addEventListener(type, fn) { (listeners[`doc:${type}`] ||= []).push(fn); } };
    const window = { matchMedia: () => media, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        dispatchEvent(event) { events.push(event); for (const fn of listeners[event.type] || []) fn(event); } };
    const context = vm.createContext({ window, document, localStorage: {
        getItem(key) { if (options.blocked) throw Error('Storage denied'); return saved.get(key) ?? null; },
        setItem(key, value) { if (options.blocked) throw Error('Storage denied'); writes.push([key, value]); saved.set(key, value); }
    }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } } });
    vm.runInContext(source, context);
    return { window, document, html, saved, writes, events, media, preference, context,
        parseBody() { document.body = node('at-dark', 'gunter-workspace'); observers.forEach(observer => observer.callback()); },
        fire(type, event = {}) { for (const fn of listeners[type] || []) fn(event); },
        changeSystem(dark) { media.matches = dark; media.change?.({ matches: dark }); } };
}
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('explicit light resolves in head and corrects parser body before deferred scripts', () => {
    const f = fixture({ gunter_color_mode: 'light', gunter_dark_mode: 'true', gunter_theme: 'dark' }, { dark: true });
    assert.equal(f.html.getAttribute('data-color-mode'), 'light');
    assert.equal(f.html.style.colorScheme, 'light');
    assert.equal(f.html.style.backgroundColor, '#dce8f7');
    assert.equal(f.writes.length, 0);
    f.parseBody();
    assert.ok(f.document.body.classList.contains('at-light'));
    assert.ok(!f.document.body.classList.contains('at-dark'));
    assert.ok(f.document.body.classList.contains('gunter-workspace'));
});
test('explicit dark wins over legacy light and light OS', () => {
    const f = fixture({ gunter_color_mode: 'dark', gunter_theme: 'light' }, { body: true });
    assert.equal(f.window.GunterThemeBootstrap.getPreferred(), 'dark');
    assert.ok(f.document.body.classList.contains('at-dark'));
});
test('legacy false is an explicit light preference, not the dark device default', () => {
    const f = fixture({ gunter_dark_mode: 'false' }, { dark: true });
    assert.equal(f.window.GunterThemeBootstrap.getPreferred(), 'light');
    f.changeSystem(false); f.changeSystem(true);
    assert.equal(f.window.GunterThemeBootstrap.getPreferred(), 'light');
});
test('meeting profile never becomes a color preference', () => {
    for (const profile of ['artistico', 'zen', 'podcast', 'empresarial']) {
        const f = fixture({ gunter_theme: profile }, { dark: true });
        assert.equal(f.window.GunterThemeBootstrap.getPreferred(), 'dark');
        assert.equal(f.window.GunterThemeBootstrap.hasExplicitPreference(), false);
        assert.equal(f.saved.get('gunter_theme'), profile);
        assert.equal(f.writes.length, 0);
    }
});
test('device preference changes apply without writing storage', () => {
    const f = fixture({}, { body: true });
    f.changeSystem(true);
    assert.equal(f.html.getAttribute('data-color-mode'), 'dark');
    assert.ok(f.document.body.classList.contains('at-dark'));
    assert.equal(f.writes.length, 0);
});
test('blocked storage keeps rendering and respects a selection in this document', () => {
    const f = fixture({}, { blocked: true, dark: true, body: true });
    f.window.GunterThemeBootstrap.apply('light');
    f.changeSystem(true);
    assert.equal(f.window.GunterThemeBootstrap.getPreferred(), 'light');
    assert.equal(f.html.style.colorScheme, 'light');
});
test('theme event fires once per effective change and exposes mode', () => {
    const f = fixture({ gunter_color_mode: 'light' }, { body: true });
    f.events.length = 0;
    f.window.GunterThemeBootstrap.apply('light', false);
    f.window.GunterThemeBootstrap.sync();
    assert.equal(f.events.length, 0);
    f.window.GunterThemeBootstrap.apply('dark');
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].type, 'gunter-theme-changed');
    assert.equal(f.events[0].detail.mode, 'dark');
    assert.equal(f.events[0].detail.previousMode, 'light');
    assert.equal(f.preference.checked, true);
});
test('cross-tab changes update head and body without echoing storage writes', () => {
    const f = fixture({ gunter_color_mode: 'light' }, { body: true });
    f.saved.set('gunter_color_mode', 'dark');
    f.fire('storage', { key: 'gunter_color_mode' });
    assert.equal(f.html.getAttribute('data-color-mode'), 'dark');
    assert.equal(f.writes.length, 0);
});
test('legacy mode remains stable when a meeting sets its profile before mount', () => {
    const f = fixture({ gunter_theme: 'light' }, { dark: true, body: true });
    f.saved.set('gunter_theme', 'artistico');
    vm.runInContext(toggle, f.context);
    f.fire('doc:DOMContentLoaded');
    assert.equal(f.window.GunterThemeToggle.getPreferred(), 'light');
    assert.equal(f.html.getAttribute('data-color-mode'), 'light');
    assert.equal(f.saved.get('gunter_theme'), 'artistico');
    assert.equal(f.saved.get('gunter_color_mode'), 'light');
});
test('invalid mode does not alter current preference or classes', () => {
    const f = fixture({ gunter_color_mode: 'light' }, { body: true });
    f.window.GunterThemeBootstrap.apply('artistico');
    assert.equal(f.html.getAttribute('data-color-mode'), 'light');
    assert.equal(f.writes.length, 0);
});
test('history restore follows current saved mode and duplicate load is idempotent', () => {
    const f = fixture({ gunter_color_mode: 'light' }, { body: true });
    f.saved.set('gunter_color_mode', 'dark');
    f.fire('pageshow', { persisted: true });
    assert.equal(f.html.getAttribute('data-color-mode'), 'dark');
    f.events.length = 0;
    vm.runInContext(source, f.context);
    assert.equal(f.events.length, 0);
});
test('all entry pages load the same blocking resolver before styles and services', () => {
    for (const page of ['day', 'dashboard', 'config', 'meeting', 'new-project', 'results', 'admin', 'login', 'index', 'reset']) {
        const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
        assert.match(html, /<head>\s*<script src="js\/services\/theme-bootstrap\.js\?[^" ]+"><\/script>/);
        assert.equal((html.match(/theme-bootstrap\.js/g) || []).length, 1, page);
        assert.ok(html.indexOf('theme-bootstrap.js') < html.indexOf('rel="stylesheet"'), page);
    }
});
console.log(`${passed} theme-first-paint tests passed`);
