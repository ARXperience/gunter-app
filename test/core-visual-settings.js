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
const fields = { particleColor: 'core-color', shadowColor: 'core-shadow-color', energyColor: 'core-energy-color', glowColor: 'core-glow-color', brightness: 'core-brightness',
    density: 'core-density', speed: 'core-speed', size: 'core-size' };
const colorKeys = ['particleColor', 'shadowColor', 'energyColor', 'glowColor'];
const defaults = { particleColor: '#3458c7', shadowColor: '#142642', energyColor: '#19bcd3', glowColor: '#8ebdff',
    brightness: 1, density: 1, speed: 1, size: 1, color: '#19bcd3', shape: 'organic', themeAdaptive: true };
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
    const element = () => emitter({ value: '', textContent: '', attributes: {}, hidden: true, validationMessage: '', checked: false,
        style: { properties: {}, setProperty(name, value) { this.properties[name] = value; } },
        setAttribute(name, value) { this.attributes[name] = value; },
        setCustomValidity(message) { this.validationMessage = message; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
        setPointerCapture() {} });
    const layers = colorKeys.map(key => Object.assign(element(), { dataset: { coreLayer: key },
        querySelector() { return this.label; }, label: element() }));
    const elements = Object.fromEntries(['core-visual-settings', 'core-visual-status', 'core-visual-reset',
        'core-theme-adaptive', 'core-color-plane', 'core-color-hue', 'core-color-saturation', 'core-color-light', 'core-color-layer-title', 'core-theme-state',
        ...Object.values(fields), ...Object.values(fields).slice(4).map(id => id + '-value'),
        ...colorKeys.flatMap(key => [fields[key] + '-hex', fields[key] + '-error', fields[key] + '-panel'])].map(id => [id, element()]));
    elements['core-visual-settings'].querySelectorAll = selector => {
        assert.equal(selector, '[data-core-layer]', 'settings must not query a permanent shape selector');
        return layers;
    };
    const state = { config: { ...defaults, ...saved }, calls: [], fail: false, palette: { theme: 'dark' } };
    const window = emitter();
    if (!unavailable) window.GunterParticles = {
        getConfig: () => ({ ...state.config }),
        getDefaults: () => ({ ...defaults }),
        getPalette: () => ({ ...state.config, ...state.palette }),
        configure(patch, options) {
            state.calls.push({ patch: { ...patch }, options: { ...options } });
            if (state.fail) throw new Error('storage unavailable');
            state.config = { ...state.config, ...patch };
            window.fire('gunter-core-config-changed');
            return { ...state.config };
        }
    };
    vm.runInNewContext(source, { window, document: { getElementById: id => elements[id] || null } });
    return { elements, state, window, layers, input(key, value, hex = false) {
        const element = elements[fields[key] + (hex ? '-hex' : '')];
        element.value = value;
        element.fire('input', { target: element });
    } };
}
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
check('the studio preserves four color layers and ranges, with only guidance for temporary shapes in Home', () => {
    const card = html.match(/<section[^>]+id="core-visual-settings"[\s\S]*?<\/section>/)?.[0];
    assert.ok(card);
    assert.match(card, /Núcleo y materia/);
    assert.match(card, /energía permanece entre las partículas/);
    assert.match(card, /reacciona al puntero y al audio real/);
    const inputs = [...card.matchAll(/<input\b[^>]*>/g)].map(match =>
        Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
    const fieldIds = Object.entries(fields).flatMap(([key, id]) => colorKeys.includes(key) ? [id, id + '-hex'] : [id]);
    assert.deepEqual(inputs.filter(input => fieldIds.includes(input.id)).map(input => input.id), fieldIds);
    assert.deepEqual(inputs.filter(input => input.type === 'color').map(input => input.value), colorKeys.map(key => defaults[key]));
    assert.deepEqual(inputs.filter(input => input.type === 'range' && Object.values(fields).includes(input.id)).map(input => [input.min, input.max, input.step, input.value]),
        [['0.2', '2.5', '0.05', '1'], ['0.25', '2', '0.05', '1'], ['0', '2', '0.05', '1'], ['0.7', '1.3', '0.05', '1']]);
    for (const key of colorKeys) {
        const hex = inputs.find(input => input.id === fields[key] + '-hex');
        assert.equal(hex.type, 'text');
        assert.equal(hex.value, defaults[key]);
        assert.equal(hex.pattern, '#[0-9a-fA-F]{6}');
        assert.equal(hex['aria-describedby'], fields[key] + '-error');
        assert.match(hex['aria-label'], /HEX/);
    }
    assert.match(card, /Color de partículas/);
    assert.match(card, /Color de energía/);
    assert.match(card, /Color de emisión/);
    assert.match(card, /Color de la materia oscura/);
    assert.deepEqual([...card.matchAll(/data-core-layer="([^"]+)"/g)].map(match => match[1]), colorKeys);
    assert.doesNotMatch(card, /data-core-shape|core-shapes|Forma de las partículas/);
    assert.match(card, /En Inicio, haz tres clics o toques sobre Gunter/);
    assert.match(card, /forma aleatoria por unos instantes y volverán al núcleo orgánico/);
    assert.match(card, /id="core-theme-adaptive"[^>]+checked/);
});
check('initialization reads saved values through the API without overwriting them', () => {
    const env = environment({ particleColor: '#abcdef', energyColor: '#654321', glowColor: '#123456', brightness: 1.6, density: .65, speed: .45, size: 1.2 });
    assert.equal(env.state.calls.length, 0);
    assert.equal(env.elements['core-color'].value, '#abcdef');
    assert.equal(env.elements['core-color-hex'].value, '#abcdef');
    assert.equal(env.elements['core-energy-color'].value, '#654321');
    assert.equal(env.elements['core-energy-color-hex'].value, '#654321');
    assert.equal(env.elements['core-glow-color'].value, '#123456');
    assert.equal(env.elements['core-glow-color-hex'].value, '#123456');
    assert.equal(env.elements['core-brightness-value'].textContent, '160 %');
    assert.equal(env.elements['core-density-value'].textContent, '65 %');
    assert.equal(env.elements['core-speed-value'].textContent, '0,45 ×');
    assert.equal(env.elements['core-size-value'].textContent, '120 %');
    assert.equal(env.elements['core-speed'].attributes['aria-valuetext'], '0,45 ×');
});
check('all controls persist their matching API field with the correct value type', () => {
    const env = environment();
    for (const [key, value] of Object.entries({ particleColor: '#112233', shadowColor: '#222233', energyColor: '#445566', glowColor: '#778899', brightness: '2.5', density: '.25', speed: '0', size: '1.3' })) {
        env.input(key, value);
        const call = env.state.calls.at(-1);
        assert.deepEqual(call.patch, { [key]: colorKeys.includes(key) ? value : Number(value) });
        assert.deepEqual(call.options, { persist: true });
        if (colorKeys.includes(key)) assert.equal(env.elements[fields[key] + '-hex'].value, value);
    }
    assert.equal(env.elements['core-speed-value'].textContent, '0,00 ×');
    assert.match(env.elements['core-visual-status'].textContent, /guardada/);
});
check('valid HEX edits immediately persist only their canonical color and synchronize the picker', () => {
    const env = environment();
    for (const key of colorKeys) {
        env.input(key, '#ABCDEF', true);
        assert.deepEqual(env.state.calls.at(-1), { patch: { [key]: '#abcdef' }, options: { persist: true } });
        assert.equal(env.elements[fields[key]].value, '#abcdef');
        assert.equal(env.elements[fields[key] + '-hex'].value, '#abcdef');
        assert.equal(env.elements[fields[key] + '-hex'].attributes['aria-invalid'], 'false');
        assert.equal(env.elements[fields[key] + '-hex'].validationMessage, '');
        assert.equal(env.elements[fields[key] + '-error'].hidden, true);
    }
});
check('invalid or incomplete HEX never writes and explains its accessible validation', () => {
    const env = environment();
    for (const key of colorKeys) {
        for (const value of ['', '#', '#abc', 'abcdef', '#12345g', '#1234567', ' #123456']) {
            env.input(key, value, true);
            const hex = env.elements[fields[key] + '-hex'];
            const error = env.elements[fields[key] + '-error'];
            assert.equal(env.state.calls.length, 0);
            assert.equal(env.state.config[key], defaults[key]);
            assert.equal(env.elements[fields[key]].value, defaults[key]);
            assert.equal(hex.value, value);
            assert.equal(hex.attributes['aria-invalid'], 'true');
            assert.match(hex.validationMessage, /HEX de seis dígitos/);
            assert.equal(error.hidden, false);
            assert.equal(error.textContent, hex.validationMessage);
            assert.equal(env.elements['core-visual-status'].textContent, hex.validationMessage);
        }
    }
    env.input('glowColor', '#fedcba', true);
    assert.equal(env.state.calls.length, 1);
    assert.equal(env.elements['core-glow-color-error'].hidden, true);
    assert.match(env.elements['core-visual-status'].textContent, /guardada/);
});
check('range endpoints preserve 25–200 percent density and zero speed feedback', () => {
    const env = environment();
    for (const [value, label] of [['.25', '25 %'], ['2', '200 %']]) {
        env.input('density', value);
        assert.equal(env.state.config.density, Number(value));
        assert.equal(env.elements['core-density-value'].textContent, label);
        assert.equal(env.elements['core-density'].attributes['aria-valuetext'], label);
    }
    env.input('speed', '0');
    assert.equal(env.state.config.speed, 0);
    assert.equal(env.elements['core-speed-value'].textContent, '0,00 ×');
});
check('reset refreshes appearance and theme defaults without modifying a legacy shape preference', () => {
    const env = environment({ brightness: 2, speed: 0, glowColor: '#ffffff', shape: 'sword' });
    env.input('particleColor', '#oops', true);
    env.elements['core-visual-reset'].fire('click');
    const appearanceDefaults = Object.fromEntries([...Object.keys(fields), 'themeAdaptive'].map(key => [key, defaults[key]]));
    assert.deepEqual(env.state.calls, [{ patch: appearanceDefaults, options: { persist: true } }]);
    assert.equal(env.state.config.shape, 'sword');
    assert.equal(env.elements['core-glow-color'].value, defaults.glowColor);
    assert.equal(env.elements['core-color-hex'].value, defaults.particleColor);
    assert.equal(env.elements['core-energy-color-hex'].value, defaults.energyColor);
    assert.equal(env.elements['core-glow-color-hex'].value, defaults.glowColor);
    assert.equal(env.elements['core-color-error'].hidden, true);
    assert.equal(env.elements['core-color-hex'].validationMessage, '');
    assert.equal(env.elements['core-brightness-value'].textContent, '100 %');
    assert.equal(env.elements['core-speed-value'].textContent, '1,00 ×');
});
check('shared config and preference storage events refresh values without another save', () => {
    const env = environment();
    env.state.config.density = 2;
    env.state.config.energyColor = '#111111';
    env.window.fire('gunter-core-config-changed');
    assert.equal(env.elements['core-density-value'].textContent, '200 %');
    assert.equal(env.elements['core-energy-color-hex'].value, '#111111');
    assert.equal(env.elements['core-energy-color'].value, '#111111');
    env.state.config.density = .5;
    env.window.fire('storage', { key: 'gunter_env' });
    assert.equal(env.elements['core-density-value'].textContent, '200 %');
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
    env.input('energyColor', '#eeeeee', true);
    assert.equal(env.elements['core-energy-color'].value, defaults.energyColor);
    assert.equal(env.elements['core-energy-color-hex'].value, defaults.energyColor);
    assert.match(env.elements['core-visual-status'].textContent, /No pude guardar/);
    assert.doesNotThrow(() => environment({}, true));
});
check('orbit selection edits only the selected layer without saving on selection', () => {
    const env = environment();
    env.layers[1].fire('click');
    assert.equal(env.state.calls.length, 0);
    assert.equal(env.layers[1].attributes['aria-pressed'], 'true');
    assert.equal(env.elements['core-shadow-color-panel'].hidden, false);
    assert.equal(env.elements['core-color-panel'].hidden, true);
    assert.equal(env.elements['core-color-layer-title'].textContent, 'Materia');
    env.elements['core-color-saturation'].value = '0';
    env.elements['core-color-saturation'].fire('input');
    assert.deepEqual(Object.keys(env.state.calls.at(-1).patch), ['shadowColor']);
    assert.equal(env.state.config.particleColor, defaults.particleColor);
});
check('adaptive theme remains configurable without selecting or overwriting a legacy shape', () => {
    const env = environment({ themeAdaptive: false, shape: 'sword' });
    assert.equal(env.elements['core-theme-adaptive'].checked, false);
    assert.equal(env.state.calls.length, 0);
    env.elements['core-theme-adaptive'].checked = true;
    env.elements['core-theme-adaptive'].fire('change');
    assert.deepEqual(env.state.calls.at(-1).patch, { themeAdaptive: true });
    assert.equal(env.state.config.shape, 'sword');
    colorKeys.forEach(key => assert.equal(env.state.config[key], defaults[key]));
});
check('theme events refresh effective swatches without overwriting exact HEX preferences', () => {
    const env = environment();
    env.state.palette = { theme: 'light', shadowColor: '#314466' };
    env.window.fire('gunter-theme-changed');
    assert.equal(env.layers[1].style.properties['--layer-color'], '#314466');
    assert.match(env.elements['core-theme-state'].textContent, /tema claro/);
    assert.equal(env.elements['core-shadow-color-hex'].value, defaults.shadowColor);
    assert.equal(env.state.calls.length, 0);
});
check('the custom spectrum supports keyboard and captured pointer edits, never hover writes', () => {
    const env = environment({ particleColor: '#ff0000' });
    const plane = env.elements['core-color-plane'];
    plane.fire('pointermove', { pointerId: 3, clientX: 50, clientY: 50 });
    assert.equal(env.state.calls.length, 0);
    plane.fire('pointerdown', { button: 0, pointerId: 3, clientX: 50, clientY: 50 });
    assert.equal(env.state.config.particleColor, '#804040');
    plane.fire('pointerup');
    const count = env.state.calls.length;
    plane.fire('pointermove', { pointerId: 3, clientX: 10, clientY: 10 });
    assert.equal(env.state.calls.length, count);
    let prevented = false;
    plane.fire('keydown', { key: 'ArrowUp', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(env.state.calls.length, count + 1);
    plane.fire('keydown', { key: 'Tab' });
    assert.equal(env.state.calls.length, count + 1);
});
console.log(`${passed} core visual settings checks passed.`);
