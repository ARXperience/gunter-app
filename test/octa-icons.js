/* Small DOM contract fixture: no browser, dependencies, network or application data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-icon-system.js'), 'utf8');
const emblem = fs.readFileSync(path.join(__dirname, '../assets/gunter/gunter-core.svg'), 'utf8');
let observerCallback;
let observerCount = 0;
let observedOptions;
let checks = 0;

class Element {
    constructor(tag, attrs = {}, text = '') {
        this.tag = tag;
        this.attrs = { ...attrs };
        this.textContent = text;
        this.children = [];
        this.parentElement = null;
        this.nodeType = 1;
        this.contentWrites = 0;
        this.attrWrites = 0;
        this._html = '';
        this.classes = new Set();
        this.classList = { add: (...values) => values.forEach(value => this.classes.add(value)) };
    }
    add(child) { this.children.push(child); child.parentElement = this; return child; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { this.attrs[key] = value; this.attrWrites++; }
    get innerHTML() { return this._html; }
    set innerHTML(value) { this._html = value; this.contentWrites++; }
    matches(selector) {
        if (selector === 'svg') return this.tag === 'svg';
        if (selector.includes('button, a, summary')) return ['button', 'a', 'summary', 'label'].includes(this.tag) || this.attrs.role === 'tab';
        return false;
    }
    closest(selector) {
        if (selector.includes('[data-preserve-icon]')) {
            for (let node = this; node; node = node.parentElement) {
                if (node.attrs['data-preserve-icon'] !== undefined || node.attrs['data-chart'] !== undefined || node.attrs['data-diagram'] !== undefined || node.tag === 'code') return node;
            }
            return null;
        }
        if (selector === '[data-gunter-icon]') {
            for (let node = this; node; node = node.parentElement) if (node.attrs['data-gunter-icon']) return node;
            return null;
        }
        for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
}
const body = new Element('body');
const doc = {
    body, readyState: 'loading', addEventListener() {},
    querySelectorAll: selector => body.querySelectorAll(selector),
    createTreeWalker: () => ({ nextNode: () => false })
};
const runtime = {
    window: {}, document: doc, NodeFilter: { SHOW_TEXT: 4 }, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    MutationObserver: class {
        constructor(callback) { observerCount++; observerCallback = callback; }
        observe(target, options) { assert.equal(target, body); observedOptions = options; }
    }
};
vm.runInNewContext(source, runtime);
const api = runtime.window.GunterIconSystem;
function check(name, fn) { fn(); checks++; console.log(`ok ${checks} - ${name}`); }
function svg(name, attrs = {}) { return new Element('svg', { viewBox: '0 0 24 24', ...(name ? { 'data-gunter-icon': name } : {}), ...attrs }); }

check('every existing catalog entry uses the fine-line language', () => {
    assert.ok(api.paths.length >= 65);
    for (const name of api.paths) {
        const icon = api.markup(name);
        assert.match(icon, /stroke-width="1\.55"/);
        assert.match(icon, /viewBox="0 0 24 24"/);
        assert.match(icon, /data-gunter-icon-revision="octa-1:/);
        assert.match(icon, /aria-hidden="true"/);
    }
});
check('assistant identity is an eight-point interwoven emblem, not a character or disk', () => {
    const core = api.markup('core');
    assert.match(core, /M12 2\.5 21\.5 12 12 21\.5 2\.5 12Z/);
    assert.match(core, /M5\.3 5\.3h13\.4v13\.4H5\.3Z/);
    assert.doesNotMatch(core, /circle|ellipse|image/);
    assert.equal(api.markup('assistant').split('>')[1], core.split('>')[1]);
});
check('standalone SVG preserves transparency and the octagram/filament palette', () => {
    assert.match(emblem, /ocho puntas/);
    assert.match(emblem, /M160 36 284 160 160 284 36 160Z/);
    assert.match(emblem, /M72\.3 72\.3h175\.4v175\.4H72\.3Z/);
    assert.match(emblem, /#78dbe0/);
    assert.match(emblem, /#9761dd/);
    assert.doesNotMatch(emblem, /<rect|<image|<ellipse/);
});
check('old named SVG is redrawn without replacing its parent control or label', () => {
    const button = body.add(new Element('button', { 'aria-label': 'Eliminar tarea' }, 'Eliminar tarea'));
    const icon = button.add(svg('trash'));
    api.refresh(button);
    assert.equal(icon.getAttribute('data-gunter-icon-revision'), 'octa-1:trash');
    assert.match(icon.innerHTML, /M5 6l1 14\.5h12/);
    assert.equal(button.textContent, 'Eliminar tarea');
    assert.equal(button.contentWrites, 0);
});
check('refresh converges without repeated markup/attribute writes', () => {
    const icon = svg('core');
    api.refresh(icon);
    const before = [icon.contentWrites, icon.attrWrites];
    api.refresh(icon);
    api.refresh(icon);
    assert.deepEqual([icon.contentWrites, icon.attrWrites], before);
});
check('changing a named icon redraws it despite having the same family revision', () => {
    const icon = svg('play');
    api.refresh(icon);
    const old = icon.innerHTML;
    icon.setAttribute('data-gunter-icon', 'pause');
    api.refresh(icon);
    assert.notEqual(icon.innerHTML, old);
    assert.equal(icon.getAttribute('data-gunter-icon-revision'), 'octa-1:pause');
});
check('verified action semantics update legacy inline SVG while keeping its label', () => {
    const button = new Element('button', { 'aria-label': 'Enviar mensaje' }, 'Enviar');
    const icon = button.add(svg());
    api.refresh(button);
    assert.equal(icon.getAttribute('data-gunter-icon'), 'send');
    assert.equal(button.textContent, 'Enviar');
    assert.equal(button.contentWrites, 0);
});
check('unknown semantic controls are not assigned a misleading icon', () => {
    const button = new Element('button', { 'aria-label': 'Instagram' });
    const icon = button.add(svg());
    api.refresh(button);
    assert.equal(icon.contentWrites, 0);
    assert.ok(icon.classes.has('gunter-icon-inline'));
});
check('preservation applies to SVG and all ancestor containers', () => {
    const button = new Element('button', { 'data-preserve-icon': '', 'aria-label': 'Eliminar' });
    const logo = button.add(svg('trash'));
    api.refresh(button);
    assert.equal(logo.contentWrites, 0);
    const standalone = svg('core', { 'data-preserve-icon': '' });
    api.refresh(standalone);
    assert.equal(standalone.contentWrites, 0);
});
check('graphs and large illustrations cannot be overwritten by control inference', () => {
    const button = new Element('button', { 'aria-label': 'Resultados' });
    const graph = button.add(svg(null, { viewBox: '0 0 600 300' }));
    api.refresh(button);
    assert.equal(graph.contentWrites, 0);
    const chart = new Element('div', { 'data-chart': '' });
    const diagram = chart.add(svg('chart'));
    api.refresh(chart);
    assert.equal(diagram.contentWrites, 0);
});
check('icon names cannot inject SVG markup', () => {
    assert.doesNotMatch(api.markup('"><script>alert(1)</script>'), /<script|alert\(/);
    assert.match(api.markup('__proto__'), /data-gunter-icon="sparkle"/);
});
check('action semantics preserve logout and back meanings', () => {
    assert.equal(api.semanticIcon(new Element('button', {}, 'Cerrar sesión')), 'logout');
    assert.equal(api.semanticIcon(new Element('a', {}, 'Volver')), 'back');
    assert.equal(api.semanticIcon(new Element('button', {}, 'Cambiar algo desconocido')), null);
});
check('init is idempotent and observer is scoped to the icon attribute only', () => {
    api.init(); api.init();
    assert.equal(observerCount, 1);
    assert.deepEqual(Array.from(observedOptions.attributeFilter), ['data-gunter-icon']);
});
check('direct dynamically appended SVG is normalized and its mutation settles', () => {
    const icon = svg('assistant');
    observerCallback([{ type: 'childList', addedNodes: [icon] }]);
    assert.equal(icon.getAttribute('data-gunter-icon-revision'), 'octa-1:assistant');
    const before = [icon.contentWrites, icon.attrWrites];
    observerCallback([{ type: 'attributes', target: icon }]);
    observerCallback([{ type: 'childList', addedNodes: [new Element('path')] }]);
    assert.deepEqual([icon.contentWrites, icon.attrWrites], before);
});
console.log(`${checks} octagram/icon checks passed.`);
