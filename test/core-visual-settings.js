'use strict';
// Settings bindings only: no renderer, browser, voice or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const controller = fs.readFileSync(path.join(__dirname, '../js/config-settings.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../config.html'), 'utf8');
const start = controller.indexOf('    function initCoreVisualSettings()');
const end = controller.indexOf('    function loadPreferences()', start);
assert.ok(start >= 0 && end > start, 'the core settings initializer must exist');
const source = `const PREF_KEY = 'gunter_prefs';\n${controller.slice(start, end)}\ninitCoreVisualSettings();`;
const fields = { color: 'core-color', glowColor: 'core-glow-color', brightness: 'core-brightness',
    density: 'core-density', speed: 'core-speed', size: 'core-size' };
const defaults = { color: '#ff452b', glowColor: '#ff6d35', brightness: 1, density: 1, speed: 1, size: 1 };
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(callback);
        },
        fire(type, event = {}) { (listeners.get(type) || []).forEach(callback => callback(event)); }
    });
}
function environment(saved = {}, unavailable = false) {
    const elements = Object.fromEntries(['core-visual-settings', 'core-visual-status', 'core-visual-reset',
        ...Object.values(fields), ...Object.values(fields).slice(2).map(id => id + '-value')].map(id => [id,
        emitter({ value: '', textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })]));
    const state = { config: { ...defaults, ...saved }, calls: [], fail: false };
    const window = emitter();
    if (!unavailable) window.GunterParticles = {
        getConfig: () => ({ ...state.config }),
        getDefaults: () => ({ ...defaults }),
        configure(patch, options) {
            state.calls.push({ patch: { ...patch }, options: { ...options } });
            if (state.fail) throw new Error('storage unavailable');
            state.config = { ...state.config, ...patch };
            window.fire('gunter-core-config-changed');
            return { ...state.config };
        }
    };
    vm.runInNewContext(source, { window, document: { getElementById: id => elements[id] || null } });
    return { elements, state, window, input(key, value) {
        const element = elements[fields[key]];
        element.value = value;
        element.fire('input', { target: element });
    } };
}
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
check('the card exposes exactly the six idle settings with their public defaults and ranges', () => {
    const card = html.match(/<section[^>]+id="core-visual-settings"[\s\S]*?<\/section>/)?.[0];
    assert.ok(card);
    assert.match(card, /Núcleo generado/);
    assert.match(card, /en reposo/);
    assert.match(card, /Sin interacción con el mouse ni el audio/);
    const inputs = [...card.matchAll(/<input\b[^>]*>/g)].map(match =>
        Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
    assert.deepEqual(inputs.map(input => input.id), Object.values(fields));
    assert.deepEqual(inputs.slice(0, 2).map(input => [input.type, input.value]), [['color', '#ff452b'], ['color', '#ff6d35']]);
    assert.deepEqual(inputs.slice(2).map(input => [input.type, input.min, input.max, input.value]),
        [['range', '0.2', '2.5', '1'], ['range', '0.35', '1.8', '1'], ['range', '0', '2', '1'], ['range', '0.7', '1.3', '1']]);
});
check('initialization reads saved values through the API without overwriting them', () => {
    const env = environment({ color: '#abcdef', glowColor: '#123456', brightness: 1.6, density: .65, speed: .45, size: 1.2 });
    assert.equal(env.state.calls.length, 0);
    assert.equal(env.elements['core-color'].value, '#abcdef');
    assert.equal(env.elements['core-glow-color'].value, '#123456');
    assert.equal(env.elements['core-brightness-value'].textContent, '160 %');
    assert.equal(env.elements['core-density-value'].textContent, '65 %');
    assert.equal(env.elements['core-speed-value'].textContent, '0,45 ×');
    assert.equal(env.elements['core-size-value'].textContent, '120 %');
    assert.equal(env.elements['core-speed'].attributes['aria-valuetext'], '0,45 ×');
});
check('all controls persist their matching API field with the correct value type', () => {
    const env = environment();
    for (const [key, value] of Object.entries({ color: '#112233', glowColor: '#445566', brightness: '2.5', density: '.35', speed: '0', size: '1.3' })) {
        env.input(key, value);
        const call = env.state.calls.at(-1);
        assert.deepEqual(call.patch, { [key]: key.endsWith('Color') || key === 'color' ? value : Number(value) });
        assert.deepEqual(call.options, { persist: true });
    }
    assert.equal(env.elements['core-speed-value'].textContent, '0,00 ×');
    assert.match(env.elements['core-visual-status'].textContent, /guardada/);
});
check('reset persists the public defaults and refreshes all six controls', () => {
    const env = environment({ brightness: 2, speed: 0, glowColor: '#ffffff' });
    env.elements['core-visual-reset'].fire('click');
    assert.deepEqual(env.state.calls, [{ patch: defaults, options: { persist: true } }]);
    assert.equal(env.elements['core-glow-color'].value, defaults.glowColor);
    assert.equal(env.elements['core-brightness-value'].textContent, '100 %');
    assert.equal(env.elements['core-speed-value'].textContent, '1,00 ×');
});
check('shared config and preference storage events refresh values without another save', () => {
    const env = environment();
    env.state.config.density = 1.8;
    env.window.fire('gunter-core-config-changed');
    assert.equal(env.elements['core-density-value'].textContent, '180 %');
    env.state.config.density = .5;
    env.window.fire('storage', { key: 'gunter_env' });
    assert.equal(env.elements['core-density-value'].textContent, '180 %');
    env.window.fire('storage', { key: 'gunter_prefs' });
    assert.equal(env.elements['core-density-value'].textContent, '50 %');
    env.state.config.density = .8;
    env.window.fire('storage', { key: null });
    assert.equal(env.elements['core-density-value'].textContent, '80 %');
    assert.equal(env.state.calls.length, 0);
});
check('a rejected save restores the saved value and reports the storage problem', () => {
    const env = environment({ size: 1.1 });
    env.state.fail = true;
    env.input('size', '1.3');
    assert.equal(env.elements['core-size'].value, '1.1');
    assert.equal(env.elements['core-size-value'].textContent, '110 %');
    assert.match(env.elements['core-visual-status'].textContent, /No pude guardar/);
    assert.doesNotThrow(() => environment({}, true));
});
console.log(`${passed} core visual settings checks passed.`);
