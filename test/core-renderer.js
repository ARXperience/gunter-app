'use strict';
// Focused renderer lifecycle/privacy checks. No model, browser, microphone or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-particles.js'), 'utf8');
let checks = 0;
function check(description, fn) { fn(); checks++; console.log(`ok ${checks} - ${description}`); }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        fire(type, detail = {}) { [...(listeners.get(type) || [])].forEach(callback => callback(detail)); },
        listenerCount(type) { return listeners.get(type)?.size || 0; }
    });
}
function classes() {
    const values = new Set();
    return { contains: value => values.has(value), add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)) };
}
function environment(options = {}) {
    const contexts = [], nodes = [], frames = new Map(), observers = [];
    let sequence = 0, now = 0, prefs = options.reducedPreference ? '{"reduceMotion":true}' : '{}';
    let playback = options.speaking === true;
    function canvasContext() {
        const context = { arcs: 0, lines: 0, clears: 0, strokes: 0, compositeHistory: [], transforms: [], points: [],
            setTransform(...values) { this.transforms.push(values); },
            clearRect() { this.clears++; this.lines = 0; this.arcs = 0; this.points = []; },
            beginPath() {}, fill() {}, stroke() { this.strokes++; },
            arc(x, y, radius) { this.arcs++; this.points.push(x, y, radius); },
            moveTo(x, y) { this.points.push(x, y); }, lineTo(x, y) { this.lines++; this.points.push(x, y); },
            createRadialGradient() { return { addColorStop() {} }; }
        };
        Object.defineProperty(context, 'globalCompositeOperation', { get() { return this.compositeHistory.at(-1); }, set(value) { this.compositeHistory.push(value); } });
        contexts.push(context); return context;
    }
    function element(tag = 'span') {
        const node = emitter({ tagName: tag.toUpperCase(), nodeType: 1, dataset: {}, style: {}, classList: classes(), children: [], attributes: {},
            isConnected: true, width: 400, height: 400, hidden: false,
            setAttribute(name, value) { this.attributes[name] = value; },
            getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
            querySelectorAll(selector) { return this.children.flatMap(child => child.matches(selector) ? [child, ...child.querySelectorAll(selector)] : child.querySelectorAll(selector)); },
            matches(selector) { return selector === '[data-gunter-particles]' && this.dataset.gunterParticles != null; },
            appendChild(child) { this.children.push(child); child.parent = this; return child; },
            replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
        });
        if (tag === 'canvas') { const ctx = options.noCanvas ? null : canvasContext(); node.getContext = () => ctx; }
        nodes.push(node); return node;
    }
    const art = element(); art.dataset.gunterParticles = options.variant || 'hero';
    const body = element('body'); body.appendChild(art);
    if (options.light) body.classList.add('at-light');
    const document = emitter({ body, documentElement: element('html'), currentScript: { src: 'http://localhost/js/services/gunter-particles.js' },
        readyState: 'complete', hidden: false, querySelectorAll: selector => body.querySelectorAll(selector), createElement: element });
    const motion = emitter({ matches: options.reducedOS === true });
    const window = emitter({ document, devicePixelRatio: 3,
        matchMedia: query => query.includes('prefers-reduced-motion') ? motion : { matches: options.mobile === true },
        requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame(id) { frames.delete(id); },
        localStorage: { getItem(key) { assert.equal(key, 'gunter_prefs'); return prefs; }, setItem() { throw new Error('Renderer may not write preferences'); } },
        GunterConversationState: { getState: () => ({ value: options.conversation || 'idle' }) },
        GunterVoice: { getPlaybackState: () => ({ speaking: playback }) },
        MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        IntersectionObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} unobserve() {} disconnect() { this.disconnected = true; } },
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
    });
    const context = vm.createContext({ window, document, URL, location: { href: 'http://localhost/day.html' }, console });
    vm.runInContext(source, context, { filename: 'gunter-particles.js' });
    const step = () => { now += 34; const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback(now)); };
    return { art, body, window, document, contexts, nodes, frames, observers, motion, step,
        setPlayback(value) { playback = value; }, setPrefs(value) { prefs = JSON.stringify(value); },
        mutate(entry) { observers.find(observer => observer instanceof window.MutationObserver).callback([entry]); },
        visibility(visible) { observers.find(observer => observer instanceof window.IntersectionObserver).callback([{ target: art, isIntersecting: visible }]); }
    };
}

const idle = environment(); idle.step();
check('Existing mount API remains callable and paints local canvas', () => {
    assert.equal(typeof idle.window.GunterParticles.mount, 'function');
    assert.equal(idle.art.dataset.particlesRenderer, 'canvas-2d'); assert.equal(idle.art.dataset.coreState, 'idle');
    assert.ok(idle.contexts[0].clears > 0);
});
check('Hero uses bounded DPR and finite generated geometry', () => {
    const canvas = idle.art.children.find(child => child.tagName === 'CANVAS');
    assert.equal(canvas.width, 600); assert.equal(canvas.height, 600);
    assert.ok(idle.contexts[0].points.every(Number.isFinite));
});
check('No duplicated canvas on repeated mount', () => {
    idle.window.GunterParticles.mount(idle.art); assert.equal(idle.art.children.filter(child => child.tagName === 'CANVAS').length, 1);
});
check('Static fallback is local same-origin SVG and disappears after first paint', () => {
    const image = idle.art.children.find(child => child.tagName === 'IMG');
    assert.equal(image.src, 'http://localhost/assets/gunter/gunter-core.svg'); assert.equal(image.hidden, true);
});
check('Dark renderer uses luminous additive composition', () => assert.ok(idle.contexts[0].compositeHistory.includes('lighter')));

const speaking = environment({ speaking: true }); speaking.step();
check('Actual playback sets speaking state', () => assert.equal(speaking.art.dataset.coreState, 'speaking'));
check('Speaking morphs to branching tendrils, not simply faster idle orbits', () => assert.ok(speaking.contexts[0].lines > idle.contexts[0].lines * 2));
check('Audio end removes speaking state immediately', () => {
    speaking.setPlayback(false); speaking.window.fire('gunter-voice-state', { detail: { state: 'idle', speaking: false } });
    assert.equal(speaking.art.dataset.coreState, 'idle');
});
check('Conversational speech readiness never fabricates active audio', () => {
    idle.window.fire('gunter-conversation-state', { detail: { value: 'speaking' } });
    assert.equal(idle.art.dataset.coreState, 'thinking');
});
check('Playback truth overrides stale speaking events', () => {
    idle.window.fire('gunter-voice-state', { detail: { state: 'speaking', speaking: true } });
    assert.notEqual(idle.art.dataset.coreState, 'speaking');
});
check('Listening and error retain real semantic state without pretending to speak', () => {
    idle.window.fire('gunter-conversation-state', { detail: { value: 'listening_query' } });
    assert.equal(idle.art.dataset.coreState, 'listening_query');
    idle.window.fire('gunter-conversation-state', { detail: { value: 'error' } }); assert.equal(idle.art.dataset.coreState, 'error');
});

const small = environment({ mobile: true }); small.step();
check('Mobile reduces particle population without another renderer', () => assert.ok(small.contexts[0].arcs < idle.contexts[0].arcs * .65));
const thumb = environment({ variant: 'avatar' }); thumb.step();
check('Avatar/thumb shares identity and remains static at idle', () => {
    assert.equal(thumb.art.dataset.particlesRenderer, 'canvas-2d'); assert.equal(thumb.frames.size, 0);
    assert.ok(thumb.contexts[0].arcs < small.contexts[0].arcs);
});
check('Thumb starts motion only for real speaking', () => {
    thumb.setPlayback(true); thumb.window.fire('gunter-voice-state', { detail: { state: 'speaking', speaking: true } }); thumb.step();
    assert.equal(thumb.art.dataset.coreState, 'speaking'); assert.equal(thumb.frames.size, 1);
});

const saved = environment({ reducedPreference: true }); saved.step();
check('Saved reduceMotion is respected on initial load', () => { assert.equal(saved.frames.size, 0); assert.ok(saved.contexts[0].clears); });
const os = environment({ reducedOS: true, speaking: true }); os.step();
check('Operating-system reduced motion gives static speaking topology', () => {
    assert.equal(os.frames.size, 0); assert.equal(os.art.dataset.coreState, 'speaking'); assert.ok(os.contexts[0].lines > saved.contexts[0].lines);
});
check('Cross-tab preference update stops motion without writing settings', () => {
    idle.setPrefs({ reduceMotion: true }); idle.window.fire('storage', { key: 'gunter_prefs' }); idle.step(); assert.equal(idle.frames.size, 0);
});
check('Theme changes retain legibility in normal composition', () => {
    saved.body.classList.add('at-light'); saved.mutate({ type: 'attributes' }); saved.step();
    assert.ok(saved.contexts[0].compositeHistory.includes('source-over'));
});
check('Offscreen art suspends rendering', () => {
    small.visibility(false); small.step(); const renders = small.contexts[0].clears;
    assert.equal(small.frames.size, 0); small.step(); assert.equal(small.contexts[0].clears, renders);
});
check('Visibility restoration resumes existing canvas', () => { small.visibility(true); small.step(); assert.equal(small.frames.size, 1); });
check('Hidden browser page cancels animation', () => {
    small.document.hidden = true; small.document.fire('visibilitychange'); assert.equal(small.frames.size, 0);
});
check('Browser page restoration resumes state without rebuilding geometry', () => {
    small.document.hidden = false; small.document.fire('visibilitychange'); small.step(); assert.equal(small.frames.size, 1);
});
const fallback = environment({ noCanvas: true }); fallback.step();
check('Canvas unavailable leaves static core, no endless retry loop', () => {
    assert.equal(fallback.art.dataset.particlesRenderer, 'static-svg'); assert.equal(fallback.art.children.length, 1);
    assert.equal(fallback.art.children[0].hidden, false); assert.equal(fallback.frames.size, 0);
});
check('Unmount cleanup removes detached canvas and observers', () => {
    thumb.art.isConnected = false; thumb.mutate({ type: 'childList', addedNodes: [] });
    assert.equal(thumb.art.dataset.particlesReady, undefined); assert.equal(thumb.art.children.length, 0);
});
check('Page exit cleans renderer state/listeners and blocks remount', () => {
    idle.window.fire('pagehide', { persisted: false });
    assert.equal(idle.frames.size, 0); assert.equal(idle.window.listenerCount('gunter-voice-state'), 0);
    idle.window.GunterParticles.mount(idle.art); assert.equal(idle.art.dataset.particlesReady, undefined);
});
check('Renderer never requests microphone, audio, network or changes preferences', () => {
    assert.doesNotMatch(source, /getUserMedia|AudioContext|\.fetch\(|new Audio\(|localStorage\s*\.\s*setItem/);
    assert.doesNotMatch(source, /penguinCount|beak|flipper|belly/);
});
console.log(`${checks} core renderer checks passed.`);
