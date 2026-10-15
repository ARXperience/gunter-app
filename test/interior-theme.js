'use strict';
// Presentation contracts only. No browser, private profile or model is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles/gunter-interior.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function splitSelectors(text) {
    let level = 0, start = 0, quote = null;
    const selectors = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') level++;
        else if (ch === ')' || ch === ']') level--;
        else if (ch === ',' && level === 0) { selectors.push(text.slice(start, i).trim()); start = i + 1; }
    }
    selectors.push(text.slice(start).trim());
    assert.equal(level, 0, 'balanced selector functions/attributes');
    return selectors;
}

let rules = 0;
function inspectRules(text) {
    let offset = 0;
    while (offset < text.length) {
        const open = text.indexOf('{', offset);
        if (open < 0) { assert.equal(text.slice(offset).trim(), '', 'no dangling CSS'); break; }
        const selector = text.slice(offset, open).trim();
        let depth = 1, end = open + 1, quote = null;
        for (; end < text.length && depth; end++) {
            const ch = text[end];
            if (quote) { if (ch === quote && text[end - 1] !== '\\') quote = null; continue; }
            if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        assert.equal(depth, 0, `balanced CSS block: ${selector}`);
        const content = text.slice(open + 1, end - 1);
        if (selector.startsWith('@media')) inspectRules(content);
        else {
            for (const branch of splitSelectors(selector)) {
                assert.ok(branch.startsWith('html body.gunter-workspace'), `workspace-only selector: ${branch}`);
                assert.ok(branch.includes(':not(.gunter-orbit-home-active)'), `approved home excluded: ${branch}`);
            }
            rules++;
        }
        offset = end;
    }
}
inspectRules(css);
assert.ok(rules >= 100, 'interior controls and workspaces are covered');
console.log(`PASS ${rules} CSS rules are balanced and exclude Inicio`);

assert.match(css, /\.gps-switch\[aria-checked='true'\]/);
assert.match(css, /input\[type='checkbox'\]:checked/);
assert.match(css, /\.cp-switch input:checked \+ span/);
assert.match(css, /height: 44px !important;\s*min-height: 44px !important/);
assert.match(css, /\.cp-switch:focus-within/);
assert.match(css, /@media \(forced-colors: active\)/);
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
assert.doesNotMatch(css, /\[hidden\][^{]*\{[^}]*display\s*:\s*(?:block|flex|grid)/);
assert.doesNotMatch(css, /pointer-events:\s*none[^}]*\.gps-switch/);
console.log('PASS native/ARIA checked state, touch area, keyboard and motion contracts');

assert.match(css, /\.config-tabs\s*\{[^}]*flex-wrap: wrap !important/s);
assert.match(css, /\.config-tabs \.config-tab\s*\{[^}]*white-space: normal !important/s);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(min-width: 1420px\)/);
assert.match(css, /\.gps\[data-category='premium'\] > \.cp-settings\s*\{[^}]*grid-column: 1 \/ -1/s);
assert.match(css, /\.config-header__copy\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto/s);
assert.match(css, /\.gps__intro\s*\{[^}]*display: grid !important;[^}]*min-height: 76px/s);
assert.match(css, /\.gunter-command-nav__links > a\s*\{[^}]*font-size: 10px !important/s);
assert.match(css, /\.gunter-command-nav__dock \.gw-write\s*\{[^}]*flex: 0 0 auto;[^}]*min-height: 44px !important;[^}]*white-space: nowrap/s);
assert.match(css, /\.gunter-command-nav__dock\s*\{[^}]*min-width: 0 !important/s);
assert.match(css, /\.gunter-command-nav__dock \.gunter-command-nav__voice\s*\{[^}]*flex: 1 1 auto;[^}]*min-width: 44px/s);
console.log('PASS accessible category rail, mobile layout and existing inspector placement');

function luminance(hex) {
    const rgb = hex.replace('#', '').match(/.{2}/g).map(n => parseInt(n, 16) / 255)
        .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
for (const [name, ink, muted, background, accent, onAccent] of [
    ['dark', '#f0f4ff', '#a0b1c8', '#0a0f1d', '#8aebff', '#042832'],
    ['light', '#172b42', '#4b627a', '#f9fcff', '#075e77', '#ffffff']
]) {
    assert.ok(contrast(ink, background) >= 4.5, `${name} primary text contrast`);
    assert.ok(contrast(muted, background) >= 4.5, `${name} supporting text contrast`);
    assert.ok(contrast(accent, onAccent) >= 4.5, `${name} action text contrast`);
}
console.log('PASS light/dark primary, supporting and action text contrast');

for (const page of ['day', 'dashboard', 'config', 'meeting', 'new-project', 'results', 'admin', 'login', 'index', 'reset']) {
    const html = fs.readFileSync(path.join(__dirname, '..', `${page}.html`), 'utf8');
    const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]);
    const theme = links.filter(href => href.startsWith('styles/gunter-interior.css?'));
    assert.equal(theme.length, 1, `${page}: exactly one interior theme`);
    assert.match(theme[0], /\?v155-unified-interior$/, `${page}: current asset revision`);
    const workspace = links.filter(href => href.startsWith('styles/gunter-workspace-layout.css?'));
    const settings = links.filter(href => href.startsWith('styles/pages/config-layout.css?'));
    if (['login', 'index', 'reset'].includes(page)) {
        assert.equal(workspace.length, 0, `${page}: no application layout on authentication`);
        assert.equal(links.at(-1), theme[0], `${page}: theme follows existing styles`);
    } else {
        assert.equal(workspace.length, 1, `${page}: single workspace layout`);
        assert.match(workspace[0], /\?v158-structured-workspaces$/);
        assert.ok(links.indexOf(workspace[0]) > links.indexOf(theme[0]), `${page}: structural layer follows theme`);
        const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
        assert.ok(head.includes(workspace[0]), `${page}: stylesheet is inside head`);
        assert.equal(settings.length, page === 'config' ? 1 : 0);
        assert.equal(links.at(-1), page === 'config' ? settings[0] : workspace[0]);
        if (page === 'config') assert.ok(head.includes(settings[0]));
    }
}
const offlineShell = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
assert.match(offlineShell, /\/styles\/gunter-interior\.css\?v155-unified-interior/);
assert.match(offlineShell, /\/styles\/gunter-workspace-layout\.css\?v158-structured-workspaces/);
assert.match(offlineShell, /\/styles\/pages\/config-layout\.css\?v157-section-navigation/);
console.log('PASS versioned theme, ordered structural layers and offline shell');
