'use strict';

// Focused presentation checks. No browser, server, account or media device is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
function check(name, run) {
    run();
    checks++;
    console.log(`✓ ${name}`);
}

const commandSource = read('js/services/gunter-command-center.js');
const registrations = [];
const unexpected = name => () => { throw new Error(`Unexpected presentation side effect: ${name}`); };
const commandWindow = {};
const commandDocument = {
    readyState: 'loading',
    addEventListener(type, listener, options) { registrations.push({ type, listener, options }); },
    querySelector: unexpected('DOM lookup before DOMContentLoaded'),
    createElement: unexpected('DOM creation before DOMContentLoaded')
};
const context = vm.createContext({
    window: commandWindow,
    document: commandDocument,
    location: { pathname: '/app/DAY.HTML', hash: '#events' },
    navigator: { mediaDevices: { getUserMedia: unexpected('microphone') } },
    fetch: unexpected('network'),
    XMLHttpRequest: unexpected('network'),
    WebSocket: unexpected('network'),
    setTimeout: unexpected('timer'),
    setInterval: unexpected('timer'),
    requestAnimationFrame: unexpected('animation scheduling')
});
vm.runInContext(commandSource, context, { filename: 'gunter-command-center.js' });
const resolve = commandWindow.GunterCommandCenter?.resolveWorkspace;

check('command center exports routing while deferring all initialization', () => {
    assert.equal(typeof resolve, 'function');
    assert.equal(typeof commandWindow.GunterCommandCenter.init, 'function');
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].type, 'DOMContentLoaded');
    assert.equal(registrations[0].options.once, true);
    assert.equal(resolve(), 'events', 'default route follows the current filename and hash');
    const api = commandWindow.GunterCommandCenter;
    vm.runInContext(commandSource, context, { filename: 'gunter-command-center.js' });
    assert.equal(commandWindow.GunterCommandCenter, api, 'loading twice keeps the existing API');
    assert.equal(registrations.length, 1, 'loading twice does not register duplicate initialization');
});

check('day deep links resolve each working surface without replacing its controller', () => {
    for (const view of ['tasks', 'events', 'reminders', 'capture', 'chat']) {
        assert.equal(resolve('day.html', `#${view}`, 'today'), view);
        assert.equal(resolve('day.html', view, 'today'), view);
    }
    assert.equal(resolve('day.html', undefined, 'today'), 'events', 'omitted hash follows the current location');
    for (const hash of ['', null, '#unknown', '#', '#tasks-extra']) {
        assert.equal(resolve('day.html', hash, 'today'), 'overview', `unknown hash ${hash} uses the overview`);
    }
});

check('selected dynamic tabs take precedence over stale day hashes', () => {
    for (const tab of ['activity', 'conversations', 'tutor', 'custom-extension']) {
        for (const hash of ['', '#tasks', '#events', '#reminders', '#chat']) {
            assert.equal(resolve('day.html', hash, tab), tab, `${tab} remains the selected panel`);
        }
    }
    assert.equal(resolve('day.html', '#tasks', 'today'), 'tasks', 'returning to Today restores its hash surface');
});

check('non-day routes retain page identity regardless of hash or selected tab', () => {
    for (const [page, view] of Object.entries({
        'dashboard.html': 'dashboard', 'new-project.html': 'new-project',
        'meeting.html': 'meeting', 'results.html': 'results', 'config.html': 'config',
        'admin.html': 'admin', 'login.html': 'login', 'index.html': 'index'
    })) {
        assert.equal(resolve(page, '#tasks', 'today'), view);
        assert.equal(resolve(page, '#events', 'conversations'), view);
    }
});

// Read only markup, excluding scripts/styles so inline template strings cannot
// masquerade as controls. This is intentionally a small static contract reader.
function markup(file) {
    const source = read(file);
    const html = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const elements = [];
    for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^<>]*)>/gi)) {
        const attrs = {};
        for (const attr of match[2].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g)) {
            attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
        }
        elements.push({ tag: match[1].toLowerCase(), attrs, index: match.index });
    }
    function element(id, tag, attrs = {}) {
        const matches = elements.filter(node => node.attrs.id === id);
        assert.equal(matches.length, 1, `${file}: #${id} exists once`);
        const node = matches[0];
        assert.equal(node.tag, tag, `${file}: #${id} retains its native ${tag} semantics`);
        for (const [name, value] of Object.entries(attrs)) {
            if (value === true) assert.ok(Object.hasOwn(node.attrs, name), `${file}: #${id} retains ${name}`);
            else assert.equal(node.attrs[name], value, `${file}: #${id} retains ${name}`);
        }
        return node;
    }
    function label(id) {
        assert.ok(elements.some(node => node.tag === 'label' && node.attrs.for === id), `${file}: #${id} retains an explicit label`);
    }
    function formContains(formId, ids) {
        const form = element(formId, 'form');
        const end = html.indexOf('</form>', form.index);
        assert.ok(end > form.index, `${file}: #${formId} remains a form`);
        for (const id of ids) {
            const node = elements.find(item => item.attrs.id === id);
            assert.ok(node && node.index > form.index && node.index < end, `${file}: #${id} belongs to #${formId}`);
        }
    }
    return { source, html, elements, element, label, formContains };
}

check('configuration keeps nine linked accessible tabs and its guarded forms', () => {
    const config = markup('config.html');
    for (const tab of ['account', 'premium', 'voice', 'conversations', 'actions', 'connections', 'preferences', 'data', 'diagnostics']) {
        config.element(`config-tab-${tab}`, 'button', { role: 'tab', 'aria-controls': `config-panel-${tab}` });
        config.element(`config-panel-${tab}`, 'section', { role: 'tabpanel', 'aria-labelledby': `config-tab-${tab}`, hidden: true });
    }
    for (const id of ['account-registration-name', 'account-preferred-name']) {
        config.element(id, 'input', { disabled: true });
        config.label(id);
    }
    config.element('account-profile-save', 'button', { type: 'submit', disabled: true });
    config.element('account-profile-status', 'p', { role: 'status', 'aria-live': 'polite' });
    config.formContains('account-profile-form', ['account-registration-name', 'account-preferred-name', 'account-profile-save']);
    config.element('calendar-working-hours', 'input', { type: 'checkbox', disabled: true });
    for (let day = 0; day < 7; day++) {
        config.element(`calendar-working-day-${day}`, 'input', { type: 'checkbox', disabled: true });
        config.label(`calendar-working-day-${day}`);
    }
    for (const id of ['calendar-work-start', 'calendar-work-end']) {
        config.element(id, 'input', { type: 'time', required: true, disabled: true });
        config.label(id);
    }
    config.element('calendar-buffer-minutes', 'input', { type: 'number', min: '0', max: '120', required: true, disabled: true });
    config.element('calendar-planning-save', 'button', { type: 'submit', disabled: true });
    config.formContains('calendar-planning-form', ['calendar-working-hours', 'calendar-work-start', 'calendar-work-end', 'calendar-buffer-minutes', 'calendar-planning-save']);
    config.element('voice-test-button', 'button', { type: 'button' });
    config.element('voice-test-state', 'span', { role: 'status', 'aria-live': 'polite' });
    config.element('config-diagnostics-toggle', 'button', { type: 'button', role: 'switch' });
    config.element('config-diagnostics-result', 'pre', { role: 'status', 'aria-live': 'polite' });
    config.element('personal-memory-content', 'textarea', { required: true });
    config.label('personal-memory-content');
    config.formContains('personal-memory-form', ['personal-memory-type', 'personal-memory-content', 'personal-memory-save']);
});

check('access keeps native labelled credential forms and separate registration controls', () => {
    const login = markup('login.html');
    login.element('glogin-form-login', 'form', { method: 'post' });
    login.element('glogin-form-register', 'form', { method: 'post' });
    login.element('glogin-err', 'div', { role: 'alert' });
    for (const [id, attrs] of Object.entries({
        'gl-user': { name: 'username', autocomplete: 'username', required: true },
        'gl-pass': { name: 'password', type: 'password', autocomplete: 'current-password', required: true },
        'gr-name': { name: 'displayName', autocomplete: 'name', required: true },
        'gr-user': { name: 'username', autocomplete: 'username', required: true },
        'gr-email': { name: 'email', type: 'email', autocomplete: 'email' },
        'gr-pass': { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true },
        'gr-pass2': { name: 'confirmPassword', type: 'password', autocomplete: 'new-password', minlength: '8', required: true }
    })) {
        login.element(id, 'input', attrs);
        login.label(id);
    }
    login.element('gl-submit', 'button', { type: 'submit' });
    login.element('gr-submit', 'button', { type: 'submit' });
    for (const id of ['gl-to-register', 'gl-to-login', 'gl-pending-logout', 'gl-blocked-logout']) login.element(id, 'button', { type: 'button' });
    login.formContains('glogin-form-login', ['gl-user', 'gl-pass', 'gl-submit']);
    login.formContains('glogin-form-register', ['gr-name', 'gr-user', 'gr-email', 'gr-pass', 'gr-pass2', 'gr-submit']);
    for (const id of ['glogin-form-register', 'glogin-pending', 'glogin-blocked']) {
        const node = login.elements.find(item => item.attrs.id === id);
        assert.ok(node.attrs.class.split(/\s+/).includes('hidden'), `${id} stays hidden until the auth controller selects it`);
    }
});

check('meeting retains recording, transcript and conversation control identities', () => {
    const meeting = markup('meeting.html');
    meeting.element('project-title', 'h1');
    for (const id of ['record-btn', 'mute-btn', 'pause-btn', 'end-meeting-btn', 'send-message-btn', 'view-analysis-btn', 'download-btn']) meeting.element(id, 'button');
    meeting.element('pause-btn', 'button', { disabled: true });
    meeting.element('download-btn', 'button', { disabled: true });
    meeting.element('gunter-input', 'input', { type: 'text' });
    for (const id of ['transcription-list', 'gunter-messages']) meeting.element(id, 'div');
    for (const id of ['timer-display', 'audio-status-text', 'recording-status-text']) meeting.element(id, 'span');
});

check('new meeting retains required fields, optional audio and guarded submit', () => {
    const project = markup('new-project.html');
    project.element('project-name', 'input', { type: 'text', required: true });
    project.element('market', 'textarea', { required: true });
    project.label('project-name');
    project.label('market');
    const audio = project.element('audio-file', 'input', { type: 'file', hidden: true });
    assert.ok(audio.attrs.accept.includes('audio/'), 'audio import still accepts recordings');
    project.element('upload-audio-btn', 'button', { type: 'button' });
    project.element('start-meeting-btn', 'button', { type: 'submit', disabled: true });
    project.formContains('config-form', ['project-name', 'market', 'audio-file', 'upload-audio-btn', 'start-meeting-btn']);
    project.element('waveform-canvas', 'canvas');
});

check('cache reset retains its progress node and login destination without local data deletion', () => {
    const reset = markup('reset.html');
    reset.element('s', 'div');
    assert.match(reset.source, /getElementById\(['"]s['"]\)/);
    assert.match(reset.source, /location\.replace\(['"]\/login\.html['"]\)/);
    assert.doesNotMatch(reset.source, /(?:localStorage|sessionStorage)\s*\.\s*clear\s*\(|indexedDB\s*\.\s*deleteDatabase\s*\(/);
    assert.equal(reset.elements.filter(node => node.tag === 'form').length, 0, 'updating the cache does not introduce a credential form');
});

check('all ten entry and working pages load the shared workspace and their final page styles', () => {
    const pages = {
        'day.html': 'orbital-day.css',
        'dashboard.html': 'orbital-meetings.css',
        'new-project.html': 'orbital-meetings.css',
        'meeting.html': 'orbital-meetings.css',
        'results.html': 'orbital-meetings.css',
        'config.html': 'orbital-settings.css',
        'admin.html': 'orbital-settings.css',
        'login.html': 'orbital-settings.css',
        'index.html': 'orbital-settings.css',
        'reset.html': 'orbital-settings.css'
    };
    for (const [file, pageStyle] of Object.entries(pages)) {
        const page = markup(file);
        const body = page.elements.find(node => node.tag === 'body');
        assert.ok((body?.attrs.class || '').split(/\s+/).includes('gunter-workspace'), `${file}: the shared surface is enabled on the initial body`);
        const styles = page.elements.filter(node => node.tag === 'link' && (node.attrs.rel || '').split(/\s+/).includes('stylesheet'));
        const matches = href => styles.filter(node => (node.attrs.href || '').split('?')[0] === href);
        const shared = matches('styles/gunter-workspace.css');
        const specific = matches(`styles/pages/${pageStyle}`);
        assert.equal(shared.length, 1, `${file}: the workspace stylesheet loads once`);
        assert.equal(specific.length, 1, `${file}: its working-surface stylesheet loads once`);
        assert.ok(shared[0].index < specific[0].index, `${file}: page adjustments follow the shared foundation`);
        assert.equal(styles.at(-1), specific[0], `${file}: legacy styles cannot load after the orbital surface`);
        assert.ok(fs.existsSync(path.join(root, 'styles/gunter-workspace.css')));
        assert.ok(fs.existsSync(path.join(root, 'styles/pages', pageStyle)));
    }
});

const css = read('styles/gunter-workspace.css');
// Leaf rules work both at the top level and inside media queries. No assertion
// depends on whitespace, a particular radius, layout dimensions or color hex.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));
function declarations(body) {
    const result = {};
    for (const entry of body.split(';')) {
        const colon = entry.indexOf(':');
        if (colon >= 0) result[entry.slice(0, colon).trim()] = entry.slice(colon + 1).trim();
    }
    return result;
}
function ruleWith(selectorPart, property, value) {
    return rules.some(rule => rule.selector.includes(selectorPart) && value.test(declarations(rule.body)[property] || ''));
}
function blockAfter(marker) {
    const start = css.indexOf(marker);
    assert.ok(start >= 0, `CSS includes ${marker}`);
    const open = css.indexOf('{', start);
    let depth = 1;
    for (let index = open + 1; index < css.length; index++) {
        if (css[index] === '{') depth++;
        if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index);
    }
    assert.fail(`Unclosed CSS block: ${marker}`);
}

function rulesIn(block) {
    return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim(), values: declarations(body) }));
}
function ruleEndingIn(block, selector) {
    const matches = rulesIn(block).filter(rule => rule.selector.endsWith(selector));
    assert.equal(matches.length, 1, `one explicit responsive rule targets ${selector}`);
    return matches[0].values;
}
function pixels(value, name) {
    const match = /^(\d+(?:\.\d+)?)px(?:\s*!important)?$/.exec(value || '');
    assert.ok(match, `${name} has a measurable pixel minimum`);
    return Number(match[1]);
}

check('mobile navigation keeps a visible 44px disclosure and places its panel below the header', () => {
    assert.match(commandSource, /<details\b[^>]*class="gunter-command-nav__mobile"[^>]*>[\s\S]*?<summary\b[^>]*aria-label="[^"]+"/, 'mobile navigation retains a named native disclosure');
    const mobile = blockAfter('@media (max-width: 1080px)');
    const summary = ruleEndingIn(mobile, '.gunter-command-nav__mobile > summary');
    assert.match(summary.display || '', /^(?:inline-flex|flex|block|inline-block|grid)\s*!important$/, 'the mobile summary explicitly overrides legacy hidden styles');
    assert.ok(pixels(summary['min-width'], 'summary min-width') >= 44);
    assert.ok(pixels(summary['min-height'], 'summary min-height') >= 44);
    const panel = ruleEndingIn(mobile, '.gunter-command-nav__mobile-panel');
    assert.match(panel.position || '', /^absolute\s*!important$/, 'the panel is positioned relative to its header instead of the viewport');
    assert.match(panel.top || '', /^calc\(100%\s*\+\s*(?:\d+(?:\.\d+)?)px\)\s*!important$/, 'the panel opens below its header anchor');
    assert.match(panel.bottom || '', /^auto\s*!important$/, 'legacy bottom anchoring is reset');
    assert.match(panel.left || '', /^auto\s*!important$/, 'legacy left anchoring is reset');
    assert.match(panel.right || '', /^(?:\d+(?:\.\d+)?px|0)\s*!important$/, 'the panel keeps a nonnegative inset from the header edge');
    assert.equal(panel.inset, undefined, 'a legacy inset shorthand cannot override the four deliberate edges');
    assert.match(panel['overflow-y'] || '', /^auto$/, 'a long navigation panel can scroll');
});

check('the floating dock has viewport width limits and releases inherited mobile minimum width', () => {
    const dockRules = rules.filter(rule => rule.selector.endsWith('.gunter-command-nav__dock') && declarations(rule.body)['max-width']);
    assert.ok(dockRules.length >= 2, 'desktop and mobile both bound the dock width');
    for (const rule of dockRules) {
        const value = declarations(rule.body)['max-width'];
        const bound = /^calc\(100vw\s*-\s*(\d+(?:\.\d+)?)px\)(?:\s*!important)?$/.exec(value);
        assert.ok(bound, 'dock maximum width is based on the viewport with a nonnegative inset');
        for (const viewport of [320, 360, 390, 768, 1440]) {
            const maximum = viewport - Number(bound[1]);
            assert.ok(maximum > 0 && maximum <= viewport, `dock maximum ${maximum}px stays within a ${viewport}px viewport`);
        }
    }
    const mobileDock = ruleEndingIn(blockAfter('@media (max-width: 700px)'), '.gunter-command-nav__dock');
    assert.match(mobileDock['min-width'] || '', /^0(?:px)?\s*!important$/, 'legacy mobile min-width cannot defeat the viewport bound');
    assert.match(mobileDock['max-width'] || '', /!important$/, 'the mobile viewport bound wins over inherited dock styles');
});

check('global styles preserve hidden, keyboard focus and disabled control affordances', () => {
    assert.ok(ruleWith('[hidden]', 'display', /^none\s*!important$/), 'HTML hidden always suppresses the inactive surface');
    assert.ok(ruleWith(':focus-visible', 'outline', /\bsolid\b/), 'keyboard focus receives an outline');
    assert.ok(ruleWith(':focus-visible', 'outline-offset', /^[1-9]/), 'keyboard outline is separated from its control');
    assert.ok(ruleWith(':disabled', 'cursor', /^not-allowed\b/), 'disabled controls retain their native interaction state');
    assert.ok(ruleWith('[aria-disabled="true"]', 'opacity', /^(?:0?\.\d+|0)\b/), 'ARIA-disabled actions are visually distinguishable');
    const reduced = blockAfter('@media (prefers-reduced-motion: reduce)');
    for (const [property, value] of [['animation', 'none'], ['transition', 'none'], ['scroll-behavior', 'auto']]) {
        assert.match(reduced, new RegExp(`${property}\\s*:\\s*${value}\\s*!important`), `${property} follows the OS reduced-motion preference`);
    }
    assert.ok(ruleWith('.reduce-motion', 'animation', /^none\b/), 'the saved reduced-motion preference is also honored');
});

check('workspace presentation does not add network, microphone or action execution APIs', () => {
    assert.doesNotMatch(commandSource, /\bfetch\s*\(|\bgetUserMedia\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket)\b|['"`]\/api\//);
    const presentation = commandSource.slice(commandSource.indexOf('function resolveWorkspace('), commandSource.indexOf('function init()'));
    assert.ok(presentation.includes('function setupWorkspace('));
    assert.doesNotMatch(presentation, /\.(?:start|execute|dispatch)\s*\(|\b(?:getUserMedia|fetch)\s*\(/, 'routing and status rendering cannot initiate tools or capture');
    assert.doesNotMatch(css, /@import\b|url\(\s*['"]?https?:/i, 'the shared working surface does not load remote resources');
});

check('workspace click feedback is bounded and honors existing motion/effects preferences', () => {
    function fixture(prefs, reduced = false, savedReduced = false) {
        const frames = [], radii = [];
        const drawing = { setTransform() {}, clearRect() {}, beginPath() {}, stroke() {},
            arc(x, y, radius) { radii.push(radius); } };
        const canvas = { style: {}, setAttribute() {}, getContext: () => drawing };
        const clickWindow = { innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
            matchMedia: () => ({ matches: reduced }), addEventListener() {} };
        vm.runInNewContext(read('js/theme-backgrounds.js'), {
            window: clickWindow,
            document: { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [],
                createElement: () => canvas,
                body: { appendChild() {}, classList: { contains: name => name === 'gunter-workspace' } },
                documentElement: { classList: { contains: () => savedReduced } } },
            localStorage: { getItem: key => key === 'gunter_prefs' ? JSON.stringify(prefs) : null },
            performance: { now: () => 0 },
            getComputedStyle: () => ({ getPropertyValue: () => '#6edafa' }),
            requestAnimationFrame: frame => (frames.push(frame), frames.length), cancelAnimationFrame() {}
        });
        clickWindow.GunterThemeBackground.initAuto();
        clickWindow.GunterThemeBackground.spawnEffect(50, 60);
        return { frames, radii };
    }
    const enabled = fixture({});
    assert.equal(enabled.frames.length, 1);
    enabled.frames[0](110);
    assert.ok(enabled.radii.length > 0 && enabled.radii.every(radius => radius <= 22), 'feedback stays local to a small click target');
    for (const disabled of [fixture({ clickFx: false }), fixture({ reduceMotion: true }), fixture({}, true), fixture({}, false, true)]) {
        assert.equal(disabled.frames.length, 0, 'disabled effects or reduced motion schedule no animation');
    }
});

function luminance(hex) {
    const normalized = hex.length === 4 ? '#' + [...hex.slice(1)].map(char => char + char).join('') : hex;
    const channels = normalized.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
function contrast(first, second) {
    const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (high + .05) / (low + .05);
}
const baseTokens = declarations(rules.find(rule => rule.selector === 'html body.gunter-workspace')?.body || '');
const lightTokens = declarations(rules.find(rule => rule.selector === 'html body.gunter-workspace.at-light')?.body || '');
for (const [theme, overrides] of [['dark', {}], ['light', lightTokens]]) {
    check(`${theme} ink, muted copy and primary button tokens meet WCAG AA`, () => {
        const tokens = { ...baseTokens, ...overrides };
        for (const name of ['--gw-bg', '--gw-surface', '--gw-raised', '--gw-ink', '--gw-muted', '--gw-cyan', '--gw-on-accent']) {
            assert.match(tokens[name] || '', /^#(?:[\da-f]{3}|[\da-f]{6})$/i, `${theme}: ${name} is a measurable solid color`);
        }
        for (const foreground of ['--gw-ink', '--gw-muted']) {
            for (const background of ['--gw-bg', '--gw-surface', '--gw-raised']) {
                const ratio = contrast(tokens[foreground], tokens[background]);
                assert.ok(ratio >= 4.5, `${theme}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
            }
        }
        const buttonColors = [tokens['--gw-cyan'], ...(tokens['--gd-primary-grad'].match(/#[\da-f]{6}\b|#[\da-f]{3}\b/gi) || [])];
        assert.ok(buttonColors.length >= 2, `${theme}: primary gradient colors can be checked`);
        for (const background of buttonColors) {
            const ratio = contrast(tokens['--gw-on-accent'], background);
            assert.ok(ratio >= 4.5, `${theme}: button text on ${background} is ${ratio.toFixed(2)}:1`);
        }
    });
}

console.log(`ORBITAL WORKSPACES: ${checks} focused checks passed.`);
