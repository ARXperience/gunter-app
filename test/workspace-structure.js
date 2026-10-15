'use strict';

// Focused, offline presentation checks. Browser verification covers the layout;
// this tiny DOM fixture verifies that existing nodes and listeners are moved,
// never replaced or duplicated by the structural shell.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/services/gunter-command-center.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/gunter-workspace-layout.css'), 'utf8');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`✓ ${name}`); }
const apiWindow = {};
vm.runInNewContext(source, {
    window: apiWindow, location: { pathname: '/day.html', hash: '' },
    document: { readyState: 'loading', addEventListener() {} }
});
const describe = apiWindow.GunterCommandCenter.workspaceDescriptor;

check('five sectors retain true destinations, with no simulated capability data', () => {
    const nav = source.slice(source.indexOf('<div class="gunter-command-nav__links">'), source.indexOf('<time class="gw-local-time"'));
    assert.equal((nav.match(/\$\{sectorLink\(/g) || []).length, 5);
    for (const label of ['Núcleo', 'Organización', 'Conversaciones', 'Reuniones', 'Configuración']) assert.ok(nav.includes(label));
    assert.equal(describe('day.html', 'tasks').sector, 'day.html#events');
    assert.equal(describe('day.html', 'conversations').sector, 'day.html#conversations');
    assert.equal(describe('day.html', 'overview').sector, 'day.html');
    for (const page of ['dashboard.html', 'new-project.html', 'meeting.html', 'results.html']) assert.equal(describe(page).sector, 'dashboard.html');
    assert.equal(describe('config.html').sector, 'config.html#preferences');
    assert.doesNotMatch(source.slice(source.indexOf('function workspaceDescriptor'), source.indexOf('function setupWorkspace')), /Math\.random|99\.9|quantum|qu[aá]ntic|fetch\s*\(|getUserMedia|\.execute\s*\(/i);
});

class Node {
    constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; this.parentElement = null; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { node.detach(); node.parentElement = this; this.children.push(node); } }
    detach() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    before(node) { const parent = this.parentElement; node.detach(); node.parentElement = parent; parent.children.splice(parent.children.indexOf(this), 0, node); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    matches(selector) { return selector.startsWith('.') ? String(this.attrs.class || '').split(' ').includes(selector.slice(1)) : selector.startsWith('#') ? this.attrs.id === selector.slice(1) : selector.startsWith('[') ? Object.hasOwn(this.attrs, selector.slice(1, -1)) : this.tag === selector; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const nested = child.querySelector(selector); if (nested) return nested; } return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
}
function element(tag, className, html = '') {
    const rootNode = new Node(tag, { class: className });
    const stack = [rootNode];
    for (const token of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)) {
        if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        const attrs = {};
        for (const attr of token[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] || '';
        const child = new Node(token[1], attrs); stack.at(-1).append(child);
        if (!['img', 'input', 'br', 'path', 'circle', 'ellipse'].includes(token[1]) && !token[0].endsWith('/>')) stack.push(child);
    }
    return rootNode;
}
const decorator = source.slice(source.indexOf('function decorateWorkspace('), source.indexOf('function setupWorkspace('));
function fixture(page) {
    const host = new Node('div');
    const container = new Node('main'); host.append(container);
    const tabs = new Node('nav', { id: 'gday-tabs' });
    const realButton = new Node('button', { id: 'gday-tab-tutor' });
    const listener = () => 'original-controller'; realButton.addEventListener('click', listener); tabs.append(realButton);
    if (page === 'day.html') container.append(tabs);
    const stats = new Node('div', { class: 'stats-row' });
    const total = new Node('span', { id: 'stat-total' }); stats.append(total);
    if (page === 'dashboard.html') container.append(stats);
    const features = new Node('ul', { class: 'env-card__features' });
    if (page === 'new-project.html') container.append(features);
    const script = new vm.Script(`(${decorator.trim()})(container, nav)`);
    const context = { PAGE: page, container, nav: { querySelector: () => ({ click() {} }) }, el: element,
        icon: () => '<svg></svg>', document: { getElementById: id => host.querySelector(`#${id}`) } };
    return { host, container, tabs, realButton, listener, stats, total, features, context, mount: () => script.runInNewContext(context) };
}

check('day shell moves the original tablist exactly once and preserves handlers', () => {
    const f = fixture('day.html'), deck = f.mount();
    assert.equal(f.container.parentElement, deck);
    assert.equal(deck.querySelector('#gday-tabs'), f.tabs);
    assert.equal(f.tabs.querySelector('#gday-tab-tutor'), f.realButton);
    assert.equal(f.realButton.listeners.click, f.listener);
    assert.equal(f.tabs.parentElement.attrs.class, 'gw-tools-disclosure');
    assert.equal(f.mount(), deck, 'repeated mounting reuses the shell');
    assert.equal(f.host.children.length, 1);
    assert.equal(deck.children.length, 3);
});

check('meeting statistics retain their actual data nodes after moving to the rail', () => {
    const f = fixture('dashboard.html'), deck = f.mount();
    assert.equal(deck.querySelector('[data-workspace-summary]').children[0], f.stats);
    assert.equal(deck.querySelector('#stat-total'), f.total);
    assert.equal(f.mount(), deck);
});

check('meeting history uses the full central workspace after moving its stats rail', () => {
    assert.match(css, /\.gw-workspace-grid > \.dashboard-main \{ display: block !important; \}/);
    assert.match(css, /\.dashboard-main > \.orbital-projects-section \{ width: 100%; grid-column: auto !important; grid-row: auto !important; \}/);
});

check('configuration keeps its own composition and the approved home stays unmounted', () => {
    const f = fixture('config.html');
    assert.equal(f.mount(), null);
    assert.equal(f.container.parentElement, f.host);
    assert.match(source, /PAGE !== 'day\.html' \|\| view !== 'overview' \? decorateWorkspace/);
    assert.match(css, /body\.gunter-orbit-home-active \.gw-workspace-grid \{ display: contents !important; \}/);
    assert.match(css, /body\.gunter-orbit-home-active :is\(\.gw-workspace-rail, \.gw-workspace-inspector\) \{ display: none !important; \}/);
});

check('meeting setup keeps its original explanations in an accessible disclosure', () => {
    const f = fixture('new-project.html'), deck = f.mount();
    assert.equal(f.features.parentElement.attrs.class, 'gw-environment-details');
    assert.equal(deck.querySelector('.env-card__features'), f.features);
    assert.equal(f.mount(), deck);
    let stopped = false;
    f.features.parentElement.listeners.click({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, 'opening explanatory text cannot select an environment');
});

check('context map is lightweight, useful and does not add a renderer or fake metrics', () => {
    assert.match(decorator, /assets\/gunter\/gunter-core\.svg/);
    assert.match(decorator, /aria-label="Rutas relacionadas"/);
    assert.doesNotMatch(decorator, /canvas|WebGL|THREE|requestAnimationFrame|\.cloneNode|\.innerHTML\s*=|getUserMedia|fetch\s*\(/);
    assert.match(source, /slice\(0, 3\)/);
    assert.match(source, /runtime\?\.loaded === true/);
    assert.match(css, /@media \(max-width: 820px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
});

check('mobile sector labels remain concise without losing accessible names', () => {
    assert.match(source, /data-workspace-sector aria-label="\$\{label\}"/);
    for (const compact of ['Tu día', 'Chats', 'Ajustes']) assert.ok(source.includes(compact));
    assert.match(css, /\.gw-sector-compact \{ display: block; \}/);
    assert.match(css, /min-height: 46px/);
    const beforeInit = source.slice(source.indexOf('function workspaceDescriptor'), source.indexOf('function init()'));
    assert.doesNotMatch(beforeInit, /\.(?:start|execute|dispatch)\s*\(|\b(?:getUserMedia|fetch)\s*\(/);
});

console.log(`WORKSPACE STRUCTURE: ${checks} focused checks passed.`);
