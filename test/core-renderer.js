'use strict';
// Public wrapper/lifecycle checks. The generated GPU component is mocked at its shared compositor boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-particles.js'), 'utf8');
let checks = 0;
function check(description, fn) { fn(); checks++; console.log(`ok ${checks} - ${description}`); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(type, callback, options) {
            if (!listeners.has(type)) listeners.set(type, new Map());
            listeners.get(type).set(callback, options);
        },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        fire(type, event = {}) {
            [...(listeners.get(type)?.entries() || [])].forEach(([callback, options]) => {
                if (options?.once) listeners.get(type).delete(callback);
                callback(event);
            });
        },
        listenerCount(type) { return listeners.get(type)?.size || 0; },
        allListeners() { return [...listeners].flatMap(([type, callbacks]) => callbacks.size ? [type] : []); },
        dispatchEvent(event) { this.fire(event.type, event); return true; }
    });
}
function classes() {
    const values = new Set();
    return { contains: value => values.has(value), add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)) };
}
function environment(options = {}) {
    const nodes = [], frames = new Map(), observers = [], engines = [], renders = [], writes = [];
    const storage = new Map([['gunter_prefs', JSON.stringify(options.prefs || {})]]);
    let sequence = 0, now = 0, renderFailure = options.renderFailure === true;
    function element(tag = 'span') {
        const properties = new Map();
        const node = emitter({ tagName: tag.toUpperCase(), nodeType: 1, dataset: {}, classList: classes(),
            style: { setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) || '' },
            children: [], attributes: {}, isConnected: true, width: 400, height: 400, hidden: false,
            setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name] ?? null; },
            removeAttribute(name) { delete this.attributes[name]; },
            getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
            querySelectorAll(selector) { return this.children.flatMap(child => [
                ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
            ]); },
            matches(selector) { return selector === '[data-gunter-particles]' && this.dataset.gunterParticles != null; },
            appendChild(child) { this.children.push(child); child.parent = this; return child; },
            replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
        });
        nodes.push(node); return node;
    }
    const art = element(); art.dataset.gunterParticles = options.variant || 'hero';
    art.width = options.width ?? 400; art.height = options.height ?? art.width;
    art.classList.add('gunter-video-core', 'existing-layout');
    if (options.ariaHidden) art.setAttribute('aria-hidden', 'true');
    const body = element('body'); body.appendChild(art);
    const document = emitter({ body, documentElement: element('html'), readyState: options.loading ? 'loading' : 'complete',
        hidden: options.hidden === true, querySelectorAll: selector => body.querySelectorAll(selector), createElement: element });
    const motion = emitter({ matches: options.reducedOS === true });
    const window = emitter({ document, devicePixelRatio: options.dpr ?? 1, matchMedia: () => motion,
        requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame(id) { frames.delete(id); },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem(key, value) { if (options.storageBlocked) throw new Error('storage blocked'); storage.set(key, value); writes.push({ key, value }); }
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
            observe(target) { this.targets.add(target); } disconnect() { this.disconnected = true; this.targets.clear(); }
        },
        IntersectionObserver: class {
            constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
            observe(target) { this.targets.add(target); } unobserve(target) { this.targets.delete(target); }
            disconnect() { this.disconnected = true; this.targets.clear(); }
        },
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
            observe(target) { this.targets.add(target); } disconnect() { this.disconnected = true; this.targets.clear(); }
        }
    });
    if (!options.missingEngine) window.GunterIdleCore = class {
        constructor() { this.available = options.webgl !== false; this.error = this.available ? '' : 'WebGL disabled'; this.disposes = 0; engines.push(this); }
        renderTo(canvas, width, height, time, config) {
            assert.equal(canvas.tagName, 'CANVAS');
            if (renderFailure) throw new Error('draw failed');
            canvas.width = width; canvas.height = height;
            renders.push({ engine: this, canvas, width, height, time, config: plain(config) }); return true;
        }
        dispose() { this.disposes++; this.available = false; }
    };
    for (const name of ['GunterVoice', 'GunterVoiceActivity', 'GunterConversationState', 'GunterSTT', 'GunterWakeWord']) {
        Object.defineProperty(window, name, { get() { throw new Error(`Idle renderer accessed ${name}`); } });
    }
    const context = vm.createContext({ window, document, console,
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } });
    vm.runInContext(source, context, { filename: 'gunter-particles.js' });
    const visibility = (visible, target = art) => observers.find(observer => observer instanceof window.IntersectionObserver)
        .callback([{ target, isIntersecting: visible }]);
    if (!options.loading && options.autoVisible !== false) visibility(true);
    return { art, body, window, document, nodes, frames, observers, motion, engines, renders, writes,
        api: window.GunterParticles, visibility, canvas: target => (target || art).children[0],
        step(milliseconds = 34) {
            now += milliseconds; const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback(now));
        },
        prefs: () => JSON.parse(storage.get('gunter_prefs')),
        setPrefs(value) { storage.set('gunter_prefs', JSON.stringify(value)); },
        setRenderFailure(value) { renderFailure = value; },
        resize(width, height = width, target = art) {
            target.width = width; target.height = height;
            observers.find(observer => observer instanceof window.ResizeObserver && observer.targets.has(target)).callback();
        },
        mutate(entry) { observers.find(observer => observer instanceof window.MutationObserver).callback([entry]); },
        append(variant, width = 400, dynamic = false) {
            const next = element(); next.dataset.gunterParticles = variant; next.width = next.height = width;
            body.appendChild(next);
            if (dynamic) this.mutate({ type: 'childList', addedNodes: [next] }); else window.GunterParticles.mount(next);
            visibility(true, next); return next;
        }
    };
}

check('Existing API mounts an idle canvas while preserving the host layout', () => {
    const env = environment();
    for (const method of ['mount', 'configure', 'getConfig', 'getDefaults']) assert.equal(typeof env.api[method], 'function');
    assert.equal(env.art.dataset.particlesRenderer, 'webgl-filaments'); assert.equal(env.art.dataset.coreState, 'idle');
    assert.equal(env.canvas().className, 'gunter-idle-core-canvas'); assert.equal(env.canvas().attributes.role, 'img');
    assert.match(env.canvas().attributes['aria-label'], /reposo/);
    assert.equal(env.art.classList.contains('gunter-video-core'), false); assert.equal(env.art.classList.contains('gunter-idle-core'), true);
    assert.equal(env.art.classList.contains('existing-layout'), true); assert.equal(env.art.dataset.particlesReady, 'true');
    assert.equal(env.nodes.some(node => ['VIDEO', 'IMG', 'SVG'].includes(node.tagName)), false);
});
check('The six defaults are exact and getters cannot mutate shared state', () => {
    const env = environment();
    const defaults = { color: '#ff452b', glowColor: '#ff6d35', brightness: 1, density: 1, speed: 1, size: 1 };
    assert.deepEqual(plain(env.api.getDefaults()), defaults); assert.deepEqual(plain(env.api.getConfig()), defaults);
    env.api.getDefaults().color = '#000000'; env.api.getConfig().speed = 0;
    assert.deepEqual(plain(env.api.getDefaults()), defaults); assert.equal(env.api.getConfig().speed, 1);
});
check('Configuration clamps all supported ranges and rejects malformed input', () => {
    const env = environment();
    assert.deepEqual(plain(env.api.configure({ color: '#29D1FF', glowColor: '#FFAA00', brightness: 9, density: -2, speed: 3, size: 7 })),
        { color: '#29d1ff', glowColor: '#ffaa00', brightness: 2.5, density: .35, speed: 2, size: 1.3 });
    assert.deepEqual(plain(env.api.configure({ color: 'red;background:url(remote)', glowColor: null,
        brightness: NaN, density: Infinity, speed: '2', size: null })), plain(env.api.getDefaults()));
    const low = env.api.configure({ brightness: -1, density: 9, speed: -1, size: -1 });
    assert.equal(low.brightness, .2); assert.equal(low.density, 1.8); assert.equal(low.speed, 0); assert.equal(low.size, .7);
});
check('Preference persistence preserves legacy core fields and all other user preferences', () => {
    const prefs = { reduceMotion: false, theme: 'light', voice: { enabled: false }, future: [1, 2],
        coreVisual: { color: '#22ddaa', size: .9, geometry: 'metatron', mouseSensitivity: .7, nestedLegacy: { keep: true } } };
    const env = environment({ prefs });
    assert.equal(env.api.getConfig().color, '#22ddaa'); assert.equal(env.api.getConfig().size, .9);
    env.api.configure({ size: 1.1 }); assert.equal(env.writes.length, 0);
    env.api.configure({ density: .8 }, { persist: true });
    assert.equal(env.writes.length, 1); assert.deepEqual(env.prefs().voice, prefs.voice); assert.deepEqual(env.prefs().future, prefs.future);
    assert.equal(env.prefs().theme, 'light'); assert.equal(env.prefs().reduceMotion, false);
    assert.equal(env.prefs().coreVisual.geometry, 'metatron'); assert.equal(env.prefs().coreVisual.mouseSensitivity, .7);
    assert.deepEqual(env.prefs().coreVisual.nestedLegacy, { keep: true });
    const restored = environment({ prefs: env.prefs() });
    assert.equal(restored.api.getConfig().density, .8); assert.equal(restored.api.getConfig().size, 1.1);
});
check('Malformed preferences use defaults and failed persistence reports the error without changing configuration', () => {
    for (const coreVisual of [null, 'invalid', []]) {
        const env = environment({ prefs: { coreVisual } });
        assert.deepEqual(plain(env.api.getConfig()), plain(env.api.getDefaults()));
    }
    const env = environment({ storageBlocked: true });
    assert.throws(() => env.api.configure({ brightness: 1.4 }, { persist: true }), /storage blocked/);
    assert.equal(env.api.getConfig().brightness, 1); assert.equal(env.art.dataset.particlesReady, 'true');
    assert.deepEqual(env.prefs(), {}); assert.equal(env.writes.length, 0);
});
check('The compositor is lazy and repeated mounting reuses the same canvas and engine', () => {
    const env = environment({ autoVisible: false });
    assert.equal(env.engines.length, 0); assert.equal(env.frames.size, 0);
    env.visibility(true); const canvas = env.canvas(), engine = env.engines[0];
    env.api.mount(); env.api.mount(env.art); env.append('thumb', 44);
    assert.equal(env.canvas(), canvas); assert.equal(env.engines.length, 1); assert.equal(env.engines[0], engine);
    assert.ok(env.renders.every(render => render.engine === engine));
});
check('Thumbnails render the generated core at fixed time without a frame loop', () => {
    const env = environment({ variant: 'thumb', width: 44 });
    assert.equal(env.engines.length, 1); assert.equal(env.renders.length, 1); assert.equal(env.frames.size, 0);
    assert.equal(env.art.dataset.particlesStatus, 'static'); const time = env.renders[0].time;
    env.step(); env.step(); assert.equal(env.renders.length, 1);
    env.api.configure({ glowColor: '#dd2200' }); assert.equal(env.renders.length, 2); assert.equal(env.renders.at(-1).time, time);
    env.resize(60); assert.equal(env.renders.length, 3); assert.equal(env.renders.at(-1).time, time);
    env.resize(60); assert.equal(env.renders.length, 3); assert.equal(env.frames.size, 0);
});
check('At most two large visible cores animate through one compositor', () => {
    const env = environment(), chat = env.append('chat', 250), third = env.append('hero', 180), thumb = env.append('thumb', 44);
    assert.equal(env.engines.length, 1); assert.equal(third.dataset.particlesStatus, 'static');
    const before = env.renders.length; env.step();
    assert.equal(env.renders.length - before, 2);
    assert.deepEqual(env.renders.slice(before).map(render => render.canvas), [env.canvas(), env.canvas(chat)]);
    const thumbDraws = env.renders.filter(render => render.canvas === env.canvas(thumb)).length;
    env.step(); assert.equal(env.renders.filter(render => render.canvas === env.canvas(thumb)).length, thumbDraws);
    env.visibility(false); assert.equal(third.dataset.particlesStatus, 'animated');
});
check('Animation is throttled to 30 fps and backing resolutions are bounded', () => {
    const env = environment({ width: 900, height: 600, dpr: 3 });
    assert.equal(env.renders[0].width, 720); assert.equal(env.renders[0].height, 480);
    env.step(16); const count = env.renders.length;
    env.step(16); assert.equal(env.renders.length, count);
    env.step(18); assert.equal(env.renders.length, count + 1);
    assert.ok(env.renders.at(-1).time > env.renders[0].time);
});
check('Offscreen and hidden pages stop rendering and resume with the same engine', () => {
    const env = environment(); env.step(); env.visibility(false);
    const count = env.renders.length; assert.equal(env.frames.size, 0); env.step(); assert.equal(env.renders.length, count);
    assert.equal(env.art.dataset.particlesStatus, 'paused');
    env.visibility(true); assert.equal(env.frames.size, 1);
    env.document.hidden = true; env.document.fire('visibilitychange');
    const hiddenCount = env.renders.length; env.api.configure({ size: 1.1 }); env.step();
    assert.equal(env.frames.size, 0); assert.equal(env.renders.length, hiddenCount);
    env.document.hidden = false; env.document.fire('visibilitychange'); env.step();
    assert.equal(env.engines.length, 1); assert.ok(env.renders.length > hiddenCount);
});
check('Initially hidden and zero-size hosts allocate no GPU resources', () => {
    const hidden = environment({ hidden: true }); assert.equal(hidden.engines.length, 0); assert.equal(hidden.frames.size, 0);
    hidden.document.hidden = false; hidden.document.fire('visibilitychange'); assert.equal(hidden.engines.length, 1);
    const small = environment({ width: 0, height: 0 }); assert.equal(small.engines.length, 0); assert.equal(small.frames.size, 0);
    small.resize(400); assert.equal(small.engines.length, 1); assert.equal(small.frames.size, 1);
});
check('Saved, OS, and class reduced motion render a still core with no RAF loop', () => {
    for (const options of [{ prefs: { reduceMotion: true } }, { reducedOS: true }]) {
        const env = environment(options); assert.equal(env.renders.length, 1); assert.equal(env.frames.size, 0);
        assert.equal(env.art.dataset.particlesStatus, 'static'); env.api.configure({ density: 1.1 }); env.resize(360);
        assert.equal(env.frames.size, 0); assert.equal(env.renders.length, 3);
    }
    const env = environment(); env.document.documentElement.classList.add('reduce-motion');
    env.mutate({ type: 'attributes', target: env.document.documentElement }); assert.equal(env.frames.size, 0);
    env.document.documentElement.classList.remove('reduce-motion');
    env.mutate({ type: 'attributes', target: env.document.documentElement }); assert.equal(env.frames.size, 1);
});
check('Speed zero cancels the frame loop and resumes only when speed changes', () => {
    const env = environment(); env.api.configure({ speed: 0 });
    const count = env.renders.length; assert.equal(env.frames.size, 0); assert.equal(env.art.dataset.particlesStatus, 'static');
    env.step(); env.step(); assert.equal(env.renders.length, count);
    env.resize(300); assert.equal(env.frames.size, 0); env.api.configure({ speed: .5 }); assert.equal(env.frames.size, 1);
});
check('OS and cross-tab preference changes freeze and resume without writing settings', () => {
    const env = environment(); env.motion.matches = true; env.motion.fire('change'); assert.equal(env.frames.size, 0);
    env.motion.matches = false; env.motion.fire('change'); assert.equal(env.frames.size, 1);
    env.setPrefs({ reduceMotion: true, coreVisual: { color: '#00bbff' } }); env.window.fire('storage', { key: 'gunter_prefs' });
    assert.equal(env.frames.size, 0); assert.equal(env.api.getConfig().color, '#00bbff'); assert.equal(env.writes.length, 0);
    env.setPrefs({ reduceMotion: false }); env.window.fire('storage', { key: 'gunter_prefs' }); assert.equal(env.frames.size, 1);
});
check('Idle rendering installs no pointer, audio, microphone, or assistant state listeners', () => {
    const env = environment();
    const types = ['pointermove', 'pointerleave', 'pointercancel', 'pointerdown', 'gunter-audio-level', 'gunter-voice-state',
        'gunter-conversation-state', 'gunter-push-to-talk-state', 'wake-word-state', 'gunter-vad-state'];
    for (const type of types) {
        assert.equal(env.window.listenerCount(type), 0); assert.equal(env.document.listenerCount(type), 0); assert.equal(env.art.listenerCount(type), 0);
        env.window.fire(type, { detail: { speaking: true, value: 'thinking', active: true, source: 'microphone', level: 1 } });
    }
    env.step(); assert.equal(env.art.dataset.coreState, 'idle'); assert.equal(env.art.dataset.audioLevel, undefined);
    assert.doesNotMatch(source, /getUserMedia|AudioContext|WebAudio|GunterVoice|GunterSTT|GunterWakeWord|\.fetch\(/);
    assert.doesNotMatch(source, /createElement\(['"](?:video|img)['"]\)|\.mp4|\.jpg/);
});
check('Unavailable WebGL exposes accessible status without a retry loop', () => {
    for (const options of [{ webgl: false, ariaHidden: true }, { missingEngine: true, ariaHidden: true }]) {
        const env = environment(options); assert.equal(env.art.dataset.particlesReady, 'fallback');
        assert.equal(env.canvas().hidden, true); assert.equal(env.art.children[1].hidden, false);
        assert.equal(env.art.children[1].attributes.role, 'status'); assert.match(env.art.children[1].textContent, /Gunter sigue listo/);
        assert.equal(env.art.getAttribute('aria-hidden'), null);
        assert.equal(env.frames.size, 0); env.step(); env.step(); assert.equal(env.renders.length, 0);
        assert.equal(env.engines.length, options.missingEngine ? 0 : 1);
    }
});
check('Draw failures stop animation and a meaningful change can retry the same engine', () => {
    const env = environment({ renderFailure: true }); assert.equal(env.art.dataset.particlesReady, 'fallback'); assert.equal(env.frames.size, 0);
    env.setRenderFailure(false); env.api.configure({ brightness: 1.1 });
    assert.equal(env.engines.length, 1); assert.equal(env.art.dataset.particlesReady, 'true'); assert.equal(env.frames.size, 1);
});
check('Context loss and restoration recover the same compositor without idle polling', () => {
    const env = environment({ ariaHidden: true }), engine = env.engines[0];
    engine.available = false; engine.error = 'context lost'; env.window.fire('gunter-idle-core-availability');
    assert.equal(env.art.dataset.particlesReady, 'fallback'); assert.equal(env.frames.size, 0);
    assert.equal(env.art.getAttribute('aria-hidden'), null);
    engine.available = true; engine.error = ''; env.window.fire('gunter-idle-core-availability');
    assert.equal(env.art.dataset.particlesReady, 'true'); assert.equal(env.frames.size, 1); assert.equal(env.engines.length, 1);
    assert.equal(env.art.getAttribute('aria-hidden'), 'true');
});
check('Dynamic hosts mount and removal releases their observer and shared resources when empty', () => {
    const env = environment(), next = env.append('chat', 200, true), canvas = env.canvas(next);
    assert.equal(canvas.tagName, 'CANVAS'); assert.equal(env.engines.length, 1);
    const resize = env.observers.find(observer => observer instanceof env.window.ResizeObserver && observer.targets.has(next));
    next.isConnected = false; env.mutate({ type: 'childList', addedNodes: [] });
    assert.equal(next.children.length, 0); assert.equal(resize.disconnected, true); assert.equal(env.engines[0].disposes, 0);
    env.art.isConnected = false; env.mutate({ type: 'childList', addedNodes: [] });
    assert.equal(env.art.children.length, 0); assert.equal(env.engines[0].disposes, 1); assert.equal(env.frames.size, 0);
    env.append('hero', 400, true); assert.equal(env.engines.length, 2); assert.equal(env.engines[1].disposes, 0);
});
check('BFCache page hide freezes rendering and page show reuses existing canvas and compositor', () => {
    const env = environment(), canvas = env.canvas(), engine = env.engines[0];
    env.window.fire('pagehide', { persisted: true }); const count = env.renders.length;
    assert.equal(env.art.dataset.particlesStatus, 'paused');
    assert.equal(env.frames.size, 0); env.api.configure({ color: '#ffaa00' }); env.step(); assert.equal(env.renders.length, count);
    assert.equal(engine.disposes, 0); env.window.fire('pageshow', { persisted: true }); env.step();
    assert.equal(env.canvas(), canvas); assert.equal(env.engines.length, 1); assert.equal(env.art.dataset.particlesReady, 'true');
});
check('Final page exit disposes the compositor, observers and listeners and prevents remounting', () => {
    const env = environment(); env.append('thumb', 44); env.window.fire('pagehide', { persisted: false });
    assert.equal(env.frames.size, 0); assert.equal(env.art.children.length, 0); assert.equal(env.engines[0].disposes, 1);
    assert.ok(env.observers.every(observer => observer.disconnected)); assert.deepEqual(env.window.allListeners(), []);
    assert.deepEqual(env.document.allListeners(), []); assert.deepEqual(env.motion.allListeners(), []);
    env.api.mount(env.art); assert.equal(env.art.children.length, 0); assert.equal(env.engines.length, 1);
});
check('Deferred DOM initialization mounts once after the document is ready', () => {
    const env = environment({ loading: true }); assert.equal(env.art.children.length, 0); assert.equal(env.engines.length, 0);
    env.document.fire('DOMContentLoaded'); env.visibility(true); assert.equal(env.art.children.length, 2);
    assert.equal(env.document.listenerCount('DOMContentLoaded'), 0); assert.equal(env.engines.length, 1);
});
console.log(`${checks} core renderer checks passed.`);
