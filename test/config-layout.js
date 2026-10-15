'use strict';
// Layout/navigation contracts only. No model, microphone, server or private data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('js/config-settings.js');
const html = read('config.html');
const ui = read('js/advanced-settings.js');
const css = read('styles/pages/config-layout.css');
const categories = ['account', 'schedule', 'premium', 'voice', 'conversations', 'actions', 'connections', 'preferences', 'data', 'diagnostics'];
function element(id = '', extra = {}) {
    const events = new Map();
    return Object.assign({ id, hidden: false, textContent: '', dataset: {}, attrs: {}, children: [],
        classList: { toggle() {}, add() {} }, setAttribute(k, v) { this.attrs[k] = v; if (k === 'data-config-section') this.dataset.configSection = v; },
        querySelector: () => null, querySelectorAll: () => [], replaceChildren(...items) { this.children = items; },
        appendChild(node) { this.children.push(node); node.parentElement = this; },
        prepend(node) { node.parentElement = this; }, focus() { this.focused = true; },
        addEventListener(name, callback) { events.set(name, callback); },
        fire(name, event = {}) { events.get(name)?.(event); },
        dispatchEvent(event) { events.get(event.type)?.(event); }
    }, extra);
}
function environment() {
    const ids = new Map();
    const byId = id => ids.get(id) || null;
    const tabs = categories.map(name => element(`config-tab-${name}`, { dataset: { tab: name }, textContent: name }));
    const panels = categories.map(name => element(`config-panel-${name}`, { hidden: true, dataset: { panel: name } }));
    [...tabs, ...panels].forEach(node => ids.set(node.id, node));
    for (const id of ['config-header-title', 'config-header-subtitle', 'config-section-path', 'config-context-title', 'config-context-description', 'config-context-hint', 'main-content', 'config-panel-index', 'config-section-search', 'config-search-status', 'config-context-state', 'config-context-orbit']) ids.set(id, element(id));
    const catalog = element('premium-panel'); ids.set(catalog.id, catalog);
    let mounts = 0, runtimeMounts = 0;
    const eventHandlers = {};
    const window = {
        GunterAdvancedSettings: { mount() { mounts++; }, setCategory(name) { catalog.dataset.category = name; } },
        GunterControlPlaneSettings: { mount(target) { runtimeMounts++; assert.equal(target, '#config-runtime-content'); } },
        addEventListener(name, fn) { eventHandlers[name] = fn; },
        GunterVoice: { getPlaybackState: () => ({ speaking: false, pending: false }) },
        GunterWakeWord: { getState: () => ({ active: false }) },
        GunterSTT: { pushToTalk: { getState: () => ({ phase: 'off' }) } }
    };
    const header = element('header', { top: 200, scrolled: 0, getBoundingClientRect() { return { top: this.top }; }, scrollIntoView(options) { this.scrolled++; this.scrollOptions = options; } });
    const navigation = { getBoundingClientRect: () => ({ bottom: 157 }) };
    const document = { getElementById: byId, querySelector: selector => selector === '.config-header' ? header : selector === '.gunter-command-nav' ? navigation : null, createElement: () => element(),
        querySelectorAll(selector) { return selector === '.config-tab' ? tabs : selector === '.config-tab-panel' ? panels : []; } };
    const location = { hash: '#premium' };
    const prefix = source.slice(0, source.indexOf('    // ---------- Boot ----------'));
    vm.runInNewContext(prefix + '\nwindow.test = { activateTab, initTabs, initSectionSearch, initContextState };})();', {
        window, document, location, history: { replaceState(_a, _b, hash) { location.hash = hash; } },
        localStorage: { getItem: () => '{}', setItem: () => assert.fail('navigation must not write preferences') },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        Event: class { constructor(type) { this.type = type; } }, console
    });
    return { ids, byId, tabs, panels, catalog, header, window, events: eventHandlers, location, api: window.test,
        mounts: () => mounts, runtimeMounts: () => runtimeMounts };
}
let passed = 0;
function check(name, fn) { fn(); console.log(`ok ${++passed} - ${name}`); }
check('all ten accessible destinations exist once, with one workspace and one advanced runtime host', () => {
    for (const category of categories) {
        assert.equal((html.match(new RegExp(`id="config-tab-${category}"`, 'g')) || []).length, 1);
        assert.equal((html.match(new RegExp(`id="config-panel-${category}"`, 'g')) || []).length, 1);
    }
    for (const id of ['premium-panel', 'config-runtime-content', 'account-profile-form', 'personal-memory-export', 'voice-test-button', 'calendar-planning-form']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
    assert.match(html, /aria-orientation="vertical"/);
});
check('active panels reuse a single advanced catalog rather than clone controls or reset preferences', () => {
    const env = environment();
    for (const category of ['premium', 'voice', 'conversations', 'actions', 'connections', 'premium']) {
        env.api.activateTab(category);
        assert.equal(env.catalog.parentElement, env.byId(`config-panel-${category}`));
        assert.equal(env.catalog.dataset.category, category);
        assert.equal(env.panels.filter(panel => !panel.hidden).length, 1);
        assert.equal(env.byId('config-context-title').textContent, env.byId('config-header-title').textContent);
    }
    assert.equal(env.mounts(), 1);
    assert.equal(env.runtimeMounts(), 0);
});
check('agenda aliases resolve to the real schedule destination; runtime mounts only in diagnostics', () => {
    const env = environment();
    env.api.activateTab('agenda'); assert.equal(env.location.hash, '#schedule');
    env.api.activateTab('calendar'); assert.equal(env.location.hash, '#schedule');
    env.api.activateTab('diagnostics'); assert.equal(env.runtimeMounts(), 1);
    assert.equal(env.byId('config-panel-diagnostics').hidden, false);
    assert.match(source, /move\('#calendar-planning-form', 'schedule'\)/);
    assert.match(source, /move\('#pref-city', 'schedule'\)/);
    assert.match(source, /storageHeading\.before\(memoryBackup\)/);
});
check('section finder supports ordinary terms and accents without discarding the active panel', () => {
    const env = environment(); env.api.activateTab('premium'); env.api.initSectionSearch();
    const input = env.byId('config-section-search'); input.value = 'micrófono'; input.fire('input');
    assert.deepEqual(env.tabs.filter(tab => !tab.hidden).map(tab => tab.dataset.tab), ['voice']);
    assert.equal(env.byId('config-panel-premium').hidden, false);
    input.fire('keydown', { key: 'Enter', preventDefault() {} }); assert.equal(env.location.hash, '#voice');
    input.value = 'xyz-sin-resultados'; input.fire('input'); assert.match(env.byId('config-search-status').textContent, /Sin coincidencias/);
    input.fire('keydown', { key: 'Escape' }); assert.equal(env.tabs.filter(tab => !tab.hidden).length, categories.length);
});
check('vertical keyboard navigation skips filtered sections and preserves one selected tab', () => {
    const env = environment(); env.api.initTabs(); env.api.initSectionSearch();
    const input = env.byId('config-section-search'); input.value = 'voz'; input.fire('input');
    env.byId('config-tab-premium').fire('keydown', { key: 'ArrowDown', preventDefault() {} });
    assert.equal(env.location.hash, '#voice');
    assert.equal(env.tabs.filter(tab => tab.attrs['aria-selected'] === 'true').length, 1);
});
check('tab changes reveal an obscured heading without resetting visible headings or same-panel edits', () => {
    const env = environment(); env.api.activateTab('premium');
    assert.equal(env.header.scrolled, 0, 'initialization never changes scroll');
    env.api.activateTab('voice'); assert.equal(env.header.scrolled, 0, 'heading already visible');
    env.header.top = -200; env.api.activateTab('premium');
    assert.equal(env.header.scrolled, 1); assert.equal(env.header.scrollOptions.block, 'start');
    env.api.activateTab('premium'); assert.equal(env.header.scrolled, 1, 'same-category refresh does not jump');
    assert.match(css, /top: calc\(var\(--gl-nav-height, 157px\) \+ 12px\)/);
    assert.match(css, /scroll-margin-top: calc\(var\(--gl-nav-height, 157px\) \+ 12px\)/);
});
check('inspector state comes from actual playback and capture rather than a fictional online badge', () => {
    const env = environment(); env.api.initContextState();
    assert.equal(env.byId('config-context-orbit').dataset.state, 'idle');
    env.window.GunterVoice.getPlaybackState = () => ({ pending: true }); env.events['gunter-voice-state']();
    assert.equal(env.byId('config-context-orbit').dataset.state, 'processing');
    env.window.GunterVoice.getPlaybackState = () => ({ speaking: true }); env.events['gunter-voice-state']();
    assert.equal(env.byId('config-context-state').textContent, 'Reproduciendo voz');
    env.window.GunterVoice.getPlaybackState = () => ({}); env.window.GunterSTT.pushToTalk.getState = () => ({ phase: 'recording' }); env.events['gunter-push-to-talk-state']();
    assert.equal(env.byId('config-context-orbit').dataset.state, 'listening');
});
check('settings begin with actionable controls, preserve advanced detail and scope style away from Inicio', () => {
    assert.match(ui, /gps__grid gps__grid--settings/);
    assert.doesNotMatch(ui.slice(ui.indexOf('rootEl.innerHTML = `'), ui.indexOf('wireMaster();')), /renderStatusBoard\(\)|renderActiveSummary\(\)|gps__catalog/);
    assert.match(ui, /data-toggle-cfg=/);
    assert.match(css, /body\.gunter-config-page\.gunter-workspace/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /max-width: 759px/);
    assert.match(css, /\.config-tab\[hidden\]/);
});
console.log(`CONFIG WORKSPACE: ${passed} passed`);
