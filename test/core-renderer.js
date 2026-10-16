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
        listenerOptions(type) { return [...(listeners.get(type)?.values() || [])]; },
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
    const nodes = [], frames = new Map(), observers = [], engines = [], renders = [], writes = [], inputs = [];
    const storage = new Map([['gunter_prefs', JSON.stringify(options.prefs || {})]]), metering = [];
    let voiceSignal = { source: 'assistant', level: 0, active: false, available: false, enabled: false, at: 0 };
    let sequence = 0, now = 0, renderFailure = options.renderFailure === true;
    function element(tag = 'span') {
        const properties = new Map();
        const node = emitter({ tagName: tag.toUpperCase(), nodeType: 1, dataset: {}, classList: classes(),
            style: { setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) || '' },
            children: [], attributes: {}, isConnected: true, left: 0, top: 0, width: 400, height: 400, hidden: false,
            setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name] ?? null; },
            removeAttribute(name) { delete this.attributes[name]; },
            getBoundingClientRect() { return { left: this.left, top: this.top, width: this.width, height: this.height }; },
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
        constructor() {
            this.available = options.webgl !== false; this.error = this.available ? '' : 'WebGL disabled'; this.disposes = 0;
            this.pointerTarget = { x: 0, y: 0, active: false }; this.pointerDirty = false; engines.push(this);
        }
        setPointer(x, y, active = true) {
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
            this.pointerTarget = { x, y, active }; this.pointerDirty ||= active;
            inputs.push({ engine: this, kind: 'pointer', x, y, active });
        }
        resetPointer() {
            const changed = this.pointerDirty;
            this.pointerTarget = { x: 0, y: 0, active: false }; this.pointerDirty = false;
            inputs.push({ engine: this, kind: 'reset', changed }); return changed;
        }
        setAudioLevel(level, available) {
            assert.ok(Number.isFinite(level));this.audio = { level, available };
            inputs.push({engine:this,kind:'audio',level,available});
        }
        renderTo(canvas, width, height, time, config) {
            assert.equal(canvas.tagName, 'CANVAS');
            if (renderFailure) throw new Error('draw failed');
            canvas.width = width; canvas.height = height;
            renders.push({ engine: this, canvas, width, height, time, config: plain(config) }); return true;
        }
        dispose() { this.disposes++; this.available = false; }
    };
    if (!options.missingVoice) window.GunterVoice = {
        setAudioAnalysisEnabled(enabled) { metering.push(enabled); voiceSignal = { ...voiceSignal, enabled, level:0, active:false, available:false, at:now }; },
        getAudioAnalysisState() { return { ...voiceSignal }; }
    };
    for (const name of ['GunterVoiceActivity', 'GunterConversationState', 'GunterSTT', 'GunterWakeWord']) {
        Object.defineProperty(window, name, { get() { throw new Error(`Idle renderer accessed ${name}`); } });
    }
    const context = vm.createContext({ window, document, console, Date:{now:()=>now},
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } });
    vm.runInContext(source, context, { filename: 'gunter-particles.js' });
    const visibility = (visible, target = art) => observers.find(observer => observer instanceof window.IntersectionObserver)
        .callback([{ target, isIntersecting: visible }]);
    if (!options.loading && options.autoVisible !== false) visibility(true);
    return { art, body, window, document, nodes, frames, observers, motion, engines, renders, writes, inputs, metering,
        signal(patch = {}) {
            voiceSignal = { source:'assistant',enabled:true,active:true,available:true,level:0,at:now,...patch };
            window.fire('gunter-audio-level',{detail:{...voiceSignal}});
        },
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
function pointerInputs(env) { return env.inputs.filter(input => input.kind === 'pointer'); }
function pointerAt(env, x, y, pointerType = 'mouse', extras = {}) {
    env.window.fire('pointermove', { clientX: x, clientY: y, pointerType, ...extras });
}
function lastPointer(env) {
    const input = pointerInputs(env).at(-1);
    assert.ok(input, 'the wrapper forwarded a pointer target');
    return { x: input.x, y: input.y, active: input.active };
}
function assertReset(env) {
    assert.equal(env.inputs.filter(input=>input.kind!=='audio').at(-1)?.kind, 'reset');
    const active = env.inputs.findLastIndex(input => input.kind === 'pointer' && input.active);
    assert.ok(active >= 0);
    assert.ok(env.inputs.slice(active + 1).some(input => input.kind === 'reset' && input.changed),
        'the active shared interaction was cleared');
    assert.deepEqual(env.engines[0].pointerTarget, { x: 0, y: 0, active: false });
}

check('Existing API mounts an idle canvas while preserving the host layout', () => {
    const env = environment();
    for (const method of ['mount', 'configure', 'getConfig', 'getDefaults']) assert.equal(typeof env.api[method], 'function');
    assert.equal(env.art.dataset.particlesRenderer, 'webgl-filaments'); assert.equal(env.art.dataset.coreState, 'idle');
    assert.equal(env.canvas().className, 'gunter-idle-core-canvas'); assert.equal(env.canvas().attributes.role, 'img');
    assert.match(env.canvas().attributes['aria-label'], /Gunter/);
    assert.equal(env.art.classList.contains('gunter-video-core'), false); assert.equal(env.art.classList.contains('gunter-idle-core'), true);
    assert.equal(env.art.classList.contains('existing-layout'), true); assert.equal(env.art.dataset.particlesReady, 'true');
    assert.equal(env.nodes.some(node => ['VIDEO', 'IMG', 'SVG'].includes(node.tagName)), false);
});
check('Presence transitions use layout resolution, not the temporarily scaled FLIP rectangle', () => {
    const env = environment();
    env.art.clientWidth = 500; env.art.clientHeight = 500;
    env.art.width = 112; env.art.height = 112;
    const resize = env.observers.find(observer => observer instanceof env.window.ResizeObserver && observer.targets.has(env.art));
    resize.callback();
    assert.equal(env.canvas().width, 500); assert.equal(env.canvas().height, 500);
    assert.equal(env.engines.length, 1, 'moving the visual never recreates its GPU compositor');
});
check('The visual defaults and energy color alias are exact and getters cannot mutate shared state', () => {
    const env = environment();
    const defaults = { particleColor: '#b8bec9', energyColor: '#ff452b', color: '#ff452b', glowColor: '#ff6d35',
        brightness: 1, density: 1, speed: 1, size: 1 };
    assert.deepEqual(plain(env.api.getDefaults()), defaults); assert.deepEqual(plain(env.api.getConfig()), defaults);
    env.api.getDefaults().particleColor = '#000000'; env.api.getConfig().energyColor = '#000000'; env.api.getConfig().speed = 0;
    assert.deepEqual(plain(env.api.getDefaults()), defaults); assert.equal(env.api.getConfig().speed, 1);
});
check('Configuration clamps all supported ranges and rejects malformed input', () => {
    const env = environment();
    assert.deepEqual(plain(env.api.configure({ particleColor: '#AABBCD', color: '#29D1FF', glowColor: '#FFAA00',
        brightness: 9, density: -2, speed: 3, size: 7 })),
        { particleColor: '#aabbcd', energyColor: '#29d1ff', color: '#29d1ff', glowColor: '#ffaa00',
            brightness: 2.5, density: .25, speed: 2, size: 1.3 });
    assert.deepEqual(plain(env.api.configure({ particleColor: '#fff', color: 'red;background:url(remote)', glowColor: null,
        brightness: NaN, density: Infinity, speed: '2', size: null })), plain(env.api.getDefaults()));
    const low = env.api.configure({ brightness: -1, density: 9, speed: -1, size: -1 });
    assert.equal(low.brightness, .2); assert.equal(low.density, 2); assert.equal(low.speed, 0); assert.equal(low.size, .7);
    assert.equal(env.api.configure({ density: .25 }).density, .25); assert.equal(env.api.configure({ density: 2 }).density, 2);
});
check('Particle, energy and glow colors stay independent while legacy color patches target energy', () => {
    const env = environment();
    env.api.configure({ energyColor: '#22AAFF', glowColor: '#ee9911' });
    const before = plain(env.api.getConfig());
    const next = plain(env.api.configure({ particleColor: '#CCDDEE' }));
    assert.deepEqual(next, { ...before, particleColor: '#ccddee' });
    assert.equal(env.renders.at(-1).config.particleColor, '#ccddee');
    assert.equal(env.renders.at(-1).config.energyColor, '#22aaff');
    const legacy = env.api.configure({ color: '#DD2200' });
    assert.equal(legacy.energyColor, '#dd2200'); assert.equal(legacy.color, legacy.energyColor);
    assert.equal(legacy.particleColor, '#ccddee'); assert.equal(legacy.glowColor, '#ee9911');
    const explicit = env.api.configure({ color: '#000000', energyColor: '#0077EE' });
    assert.equal(explicit.energyColor, '#0077ee'); assert.equal(explicit.color, explicit.energyColor);
});
check('Preference persistence preserves legacy core fields and all other user preferences', () => {
    const prefs = { reduceMotion: false, theme: 'light', voice: { enabled: false }, future: [1, 2],
        coreVisual: { color: '#22ddaa', size: .9, geometry: 'metatron', mouseSensitivity: .7, nestedLegacy: { keep: true } } };
    const env = environment({ prefs });
    assert.equal(env.api.getConfig().color, '#22ddaa'); assert.equal(env.api.getConfig().size, .9);
    assert.equal(env.api.getConfig().energyColor, '#22ddaa'); assert.equal(env.api.getConfig().particleColor, '#b8bec9');
    assert.equal(env.writes.length, 0); assert.deepEqual(env.prefs(), prefs);
    env.api.configure({ size: 1.1 }); assert.equal(env.writes.length, 0);
    env.api.configure({ density: .8 }, { persist: true });
    assert.equal(env.writes.length, 1); assert.deepEqual(env.prefs().voice, prefs.voice); assert.deepEqual(env.prefs().future, prefs.future);
    assert.equal(env.prefs().theme, 'light'); assert.equal(env.prefs().reduceMotion, false);
    assert.equal(env.prefs().coreVisual.geometry, 'metatron'); assert.equal(env.prefs().coreVisual.mouseSensitivity, .7);
    assert.deepEqual(env.prefs().coreVisual.nestedLegacy, { keep: true });
    const restored = environment({ prefs: env.prefs() });
    assert.equal(restored.api.getConfig().density, .8); assert.equal(restored.api.getConfig().size, 1.1);
});
check('Explicit saved colors take precedence over legacy energy color without an automatic migration', () => {
    const prefs = { theme: 'dark', coreVisual: { particleColor: '#ABCDEF', energyColor: '#00AAEE',
        glowColor: '#CC6600', color: '#ff0000', futureColorMode: 'keep' } };
    const env = environment({ prefs }), current = env.api.getConfig();
    assert.equal(current.particleColor, '#abcdef'); assert.equal(current.energyColor, '#00aaee');
    assert.equal(current.color, '#00aaee'); assert.equal(current.glowColor, '#cc6600');
    assert.deepEqual(env.prefs(), prefs); assert.equal(env.writes.length, 0);
    env.api.configure({ density: .25 }, { persist: true });
    assert.equal(env.prefs().coreVisual.particleColor, '#abcdef'); assert.equal(env.prefs().coreVisual.energyColor, '#00aaee');
    assert.equal(env.prefs().coreVisual.glowColor, '#cc6600'); assert.equal(env.prefs().coreVisual.futureColorMode, 'keep');
    assert.equal(env.prefs().theme, 'dark'); assert.equal(env.prefs().coreVisual.color, '#00aaee');
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
check('Initial thumbnails capture phase eight without a frame loop', () => {
    const env = environment({ variant: 'thumb', width: 44 });
    assert.equal(env.engines.length, 1); assert.equal(env.renders.length, 1); assert.equal(env.frames.size, 0);
    assert.equal(env.art.dataset.particlesStatus, 'static'); const time = env.renders[0].time; assert.equal(time, 8);
    env.step(); env.step(); assert.equal(env.renders.length, 1);
    env.api.configure({ glowColor: '#dd2200' }); assert.equal(env.renders.length, 2); assert.equal(env.renders.at(-1).time, time);
    env.resize(60); assert.equal(env.renders.length, 3); assert.equal(env.renders.at(-1).time, time);
    env.resize(60); assert.equal(env.renders.length, 3); assert.equal(env.frames.size, 0);
    env.api.configure({ speed: 0 }); assert.equal(env.renders.at(-1).time, time); assert.equal(env.renders.at(-1).config.speed, 1);
    env.api.configure({ speed: 2 }); assert.equal(env.renders.at(-1).time, time); assert.equal(env.frames.size, 0);
});
check('New and refreshed thumbnail snapshots use the current shared phase without rewinding or animating', () => {
    const env = environment(); env.step(); env.step(40);
    const current = env.renders.at(-1).time, thumb = env.append('thumb', 44), canvas = env.canvas(thumb);
    assert.ok(current > 8); assert.equal(env.renders.at(-1).canvas, canvas); assert.equal(env.renders.at(-1).time, current);
    assert.equal(thumb.dataset.particlesStatus, 'static');
    const count = env.renders.filter(render => render.canvas === canvas).length;
    env.step(40); assert.equal(env.renders.filter(render => render.canvas === canvas).length, count);
    const advanced = env.renders.at(-1).time;
    env.api.configure({ particleColor: '#ddeeff' });
    assert.equal(env.renders.at(-1).canvas, canvas); assert.equal(env.renders.at(-1).time, advanced);
    env.resize(60, 60, thumb); assert.equal(env.renders.at(-1).time, advanced);
    assert.ok(env.renders.every((render, index) => !index || render.time >= env.renders[index - 1].time));
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
check('Speed changes preserve phase and scale only subsequent animation progress', () => {
    const env = environment(); env.step(); env.step(40);
    const initial = env.renders.at(-1).time;
    env.api.configure({ speed: 2 }); assert.equal(env.renders.at(-1).time, initial);
    assert.equal(env.api.getConfig().speed, 2); env.step(40);
    assert.ok(Math.abs(env.renders.at(-1).time - initial - .08) < 1e-9);
    const fast = env.renders.at(-1).time;
    env.api.configure({ speed: .5 }); assert.equal(env.renders.at(-1).time, fast); env.step(40);
    assert.ok(Math.abs(env.renders.at(-1).time - fast - .02) < 1e-9);
    assert.ok(env.renders.every(render => render.config.speed === 1));
});
check('Zero speed, hidden pages and reduced motion freeze the phase through resume', () => {
    for (const pause of ['speed', 'hidden', 'reduced']) {
        const env = environment(); env.step(); env.step(40);
        const frozen = env.renders.at(-1).time;
        if (pause === 'speed') env.api.configure({ speed: 0 });
        if (pause === 'hidden') { env.document.hidden = true; env.document.fire('visibilitychange'); }
        if (pause === 'reduced') { env.motion.matches = true; env.motion.fire('change'); }
        env.step(10000); assert.equal(env.renders.at(-1).time, frozen);
        if (pause === 'speed') env.api.configure({ speed: 1 });
        if (pause === 'hidden') { env.document.hidden = false; env.document.fire('visibilitychange'); }
        if (pause === 'reduced') { env.motion.matches = false; env.motion.fire('change'); }
        assert.equal(env.renders.at(-1).time, frozen); env.step();
        assert.equal(env.renders.at(-1).time, frozen); env.step(40);
        assert.ok(Math.abs(env.renders.at(-1).time - frozen - .04) < 1e-9);
    }
});
check('OS and cross-tab preference changes freeze and resume without writing settings', () => {
    const env = environment(); env.motion.matches = true; env.motion.fire('change'); assert.equal(env.frames.size, 0);
    env.motion.matches = false; env.motion.fire('change'); assert.equal(env.frames.size, 1);
    env.setPrefs({ reduceMotion: true, coreVisual: { color: '#00bbff' } }); env.window.fire('storage', { key: 'gunter_prefs' });
    assert.equal(env.frames.size, 0); assert.equal(env.api.getConfig().color, '#00bbff'); assert.equal(env.writes.length, 0);
    env.setPrefs({ reduceMotion: false }); env.window.fire('storage', { key: 'gunter_prefs' }); assert.equal(env.frames.size, 1);
});
check('Pointer targets use the displayed host rectangle, its short dimension and an upward positive Y axis', () => {
    const env = environment({ width: 400, height: 200, dpr: 2 });
    env.art.left = 120; env.art.top = 80; env.art.style.transform = 'scale(1)';
    const config = plain(env.api.getConfig()), renders = env.renders.length;
    pointerAt(env, 320, 180); assert.deepEqual(lastPointer(env), { x: 0, y: 0, active: true });
    pointerAt(env, 420, 130); assert.deepEqual(lastPointer(env), { x: 1, y: .5, active: true });
    pointerAt(env, 120, 280, 'pen'); assert.deepEqual(lastPointer(env), { x: -2, y: -1, active: true });
    assert.ok(pointerInputs(env).every(input => input.engine === env.engines[0]), 'input uses the shared compositor');
    assert.equal(env.renders.length, renders, 'observing input does not create an extra render loop');
    assert.deepEqual(plain(env.api.getConfig()), config); assert.equal(env.writes.length, 0);
    assert.equal(env.art.style.transform, 'scale(1)'); assert.equal(env.art.dataset.coreState, 'idle');
});
check('Overlapping hosts select the smallest eligible animated rectangle and ignore thumbnails and static cores', () => {
    const env = environment(), chat = env.append('chat', 200), third = env.append('hero', 180), thumb = env.append('thumb', 44);
    chat.left = chat.top = 100; third.left = third.top = 110; thumb.left = thumb.top = 175;
    assert.equal(third.dataset.particlesStatus, 'static');
    pointerAt(env, 210, 190); assert.deepEqual(lastPointer(env), { x: .1, y: .1, active: true });
    env.visibility(false, chat); assertReset(env);
    assert.equal(third.dataset.particlesStatus, 'animated');
    pointerAt(env, 210, 190); assert.deepEqual(lastPointer(env), { x: 1 / 9, y: 1 / 9, active: true });
    env.visibility(false, third); assertReset(env);
    pointerAt(env, 210, 190); assert.deepEqual(lastPointer(env), { x: .05, y: .05, active: true });
    third.isConnected = false; chat.isConnected = false;
    pointerAt(env, 210, 190); assert.deepEqual(lastPointer(env), { x: .05, y: .05, active: true });
    assert.equal(env.engines.length, 1);
});
check('Thumbnails, small hosts, invisible hosts and unavailable compositors do not accept pointer input', () => {
    for (const options of [{ variant: 'thumb', width: 200 }, { width: 80 }, { autoVisible: false },
        { webgl: false }, { missingEngine: true }]) {
        const env = environment(options);
        pointerAt(env, 30, 30); pointerAt(env, 35, 35, 'pen');
        assert.equal(pointerInputs(env).length, 0);
    }
    const env = environment(); env.art.isConnected = false;
    pointerAt(env, 100, 100); assert.equal(pointerInputs(env).length, 0, 'detached records are ignored before mutation delivery');
});
check('Pointer observation leaves native touch and click behavior intact and sends each soft exit once', () => {
    for (const exit of ['outside', 'pointerout', 'pointercancel', 'blur', 'touch']) {
        const env = environment(); let intercepted = 0;
        const event = { preventDefault() { intercepted++; }, stopPropagation() { intercepted++; },
            stopImmediatePropagation() { intercepted++; } };
        pointerAt(env, 250, 150, 'mouse', event);
        const count = pointerInputs(env).length;
        env.window.fire('pointerout', { relatedTarget: env.body });
        assert.equal(pointerInputs(env).length, count, 'moving between page descendants keeps interaction active');
        const leave = () => {
            if (exit === 'outside') pointerAt(env, 500, 500, 'mouse', event);
            else if (exit === 'touch') pointerAt(env, 200, 200, 'touch', event);
            else env.window.fire(exit, { ...event, relatedTarget: null });
        };
        leave(); assert.deepEqual(lastPointer(env), { x: 0, y: 0, active: false });
        assert.equal(pointerInputs(env).length, count + 1, exit + ' sends one neutral target');
        leave(); assert.equal(pointerInputs(env).length, count + 1, 'repeated exits do not resubmit targets');
        assert.equal(env.inputs.filter(input => input.kind === 'reset' && input.changed).length, 0, 'normal exits retain core inertia');
        assert.equal(intercepted, 0); assert.equal(env.frames.size, 1);
        pointerAt(env, 250, 150); assert.equal(lastPointer(env).active, true, 'mouse can return after an exit');
    }
    const env = environment(); pointerAt(env, 250, 150);
    const count = pointerInputs(env).length;
    pointerAt(env, NaN, 150); pointerAt(env, 250, Infinity);
    assert.equal(pointerInputs(env).length, count, 'nonfinite browser coordinates never reach the core');
});
check('Pausing, reduced motion and a hidden page reset interaction immediately and block new targets until resume', () => {
    for (const pause of ['speed', 'hidden', 'os', 'class', 'saved']) {
        const env = environment(); pointerAt(env, 250, 150);
        if (pause === 'speed') env.api.configure({ speed: 0 });
        if (pause === 'hidden') { env.document.hidden = true; env.document.fire('visibilitychange'); }
        if (pause === 'os') { env.motion.matches = true; env.motion.fire('change'); }
        if (pause === 'class') {
            env.document.documentElement.classList.add('reduce-motion');
            env.mutate({ type: 'attributes', target: env.document.documentElement });
        }
        if (pause === 'saved') { env.setPrefs({ reduceMotion: true }); env.window.fire('storage', { key: 'gunter_prefs' }); }
        assertReset(env);
        const count = pointerInputs(env).length; pointerAt(env, 100, 100);
        assert.equal(pointerInputs(env).length, count); assert.equal(env.frames.size, 0);
        if (pause === 'speed') env.api.configure({ speed: 1 });
        if (pause === 'hidden') { env.document.hidden = false; env.document.fire('visibilitychange'); }
        if (pause === 'os') { env.motion.matches = false; env.motion.fire('change'); }
        if (pause === 'class') {
            env.document.documentElement.classList.remove('reduce-motion');
            env.mutate({ type: 'attributes', target: env.document.documentElement });
        }
        if (pause === 'saved') { env.setPrefs({ reduceMotion: false }); env.window.fire('storage', { key: 'gunter_prefs' }); }
        assert.equal(pointerInputs(env).length, count, 'resume does not restore a stale pointer target');
        assert.deepEqual(env.engines[0].pointerTarget, { x: 0, y: 0, active: false });
        pointerAt(env, 100, 100); assert.equal(pointerInputs(env).length, count + 1); assert.equal(lastPointer(env).active, true);
    }
});
check('Removing the pointer owner clears shared interaction while preserving another animated host', () => {
    const env = environment(), chat = env.append('chat', 200); chat.left = 500;
    pointerAt(env, 600, 100); assert.equal(lastPointer(env).active, true);
    chat.isConnected = false; env.mutate({ type: 'childList', addedNodes: [] });
    assertReset(env); assert.equal(env.engines[0].disposes, 0); assert.equal(env.frames.size, 1);
    const count = pointerInputs(env).length; pointerAt(env, 600, 100);
    assert.equal(pointerInputs(env).length, count, 'removed owner cannot acquire input');
    pointerAt(env, 200, 200); assert.equal(lastPointer(env).active, true);
});
check('BFCache clears interaction before suspension and resumes without a stale target', () => {
    const env = environment(); pointerAt(env, 250, 150);
    env.window.fire('pagehide', { persisted: true }); assertReset(env);
    const count = pointerInputs(env).length; pointerAt(env, 250, 150);
    assert.equal(pointerInputs(env).length, count); assert.equal(env.engines[0].disposes, 0);
    env.window.fire('pageshow', { persisted: true });
    assert.deepEqual(env.engines[0].pointerTarget, { x: 0, y: 0, active: false });
    assert.equal(pointerInputs(env).length, count); assert.equal(env.engines.length, 1);
    pointerAt(env, 250, 150); assert.equal(pointerInputs(env).length, count + 1);
});
check('Rendering observes passive pointers and the assistant meter, without microphone or synthetic state triggers', () => {
    const env = environment();
    for (const type of ['pointermove', 'pointerout', 'pointercancel']) {
        assert.equal(env.window.listenerCount(type), 1);
        assert.deepEqual(env.window.listenerOptions(type).map(option => option.passive), [true]);
        assert.equal(env.document.listenerCount(type), 0); assert.equal(env.art.listenerCount(type), 0);
    }
    assert.equal(env.window.listenerCount('blur'), 1);
    assert.equal(env.document.listenerCount('blur'), 0); assert.equal(env.art.listenerCount('blur'), 0);
    assert.equal(env.window.listenerCount('gunter-audio-level'),1);
    const types = ['pointerleave', 'pointerdown', 'pointerup', 'click', 'touchstart', 'touchmove', 'mousemove', 'gunter-voice-state',
        'gunter-conversation-state', 'gunter-push-to-talk-state', 'wake-word-state', 'gunter-vad-state'];
    for (const type of types) {
        assert.equal(env.window.listenerCount(type), 0); assert.equal(env.document.listenerCount(type), 0); assert.equal(env.art.listenerCount(type), 0);
        env.window.fire(type, { detail: { speaking: true, value: 'thinking', active: true, source: 'microphone', level: 1 } });
    }
    env.step(); assert.equal(env.art.dataset.coreState, 'idle'); assert.equal(env.art.dataset.audioLevel, undefined);
    assert.doesNotMatch(source, /getUserMedia|AudioContext|WebAudio|GunterSTT|GunterWakeWord|\.fetch\(/);
    assert.doesNotMatch(source, /createElement\(['"](?:video|img)['"]\)|\.mp4|\.jpg/);
    assert.doesNotMatch(source, /preventDefault|stopPropagation|stopImmediatePropagation|setPointerCapture|style\.transform/);
});
check('Only fresh real assistant RMS drives a smoothed level; event payloads and microphone are ignored',()=>{
    const e=environment();assert.deepEqual(e.metering,[true]);
    e.window.fire('gunter-audio-level',{detail:{source:'assistant',active:true,available:true,level:1}});
    e.step();assert.equal(e.engines[0].audio.level,0);
    e.signal({level:.25});e.step();const measured=e.engines[0].audio.level;
    assert.ok(measured>0&&measured<.25);assert.equal(e.engines[0].audio.available,true);
    e.window.fire('gunter-audio-level',{detail:{source:'microphone',level:1}});
    e.step();assert.ok(e.engines[0].audio.level<.25);
    e.step(300);assert.equal(e.engines[0].audio.level,0);assert.equal(e.engines[0].audio.available,false);
    for(const patch of [{active:false},{available:false},{enabled:false},{source:'microphone'},{level:NaN},{at:undefined}]){
        e.signal({level:1,...patch});e.step();assert.equal(e.engines[0].audio.level,0);
    }
});
check('Audio loss and interruptions clear immediately, while measured silence releases without a fabricated pulse',()=>{
    const e=environment();e.signal({level:.4});e.step();const high=e.engines[0].audio.level;
    e.signal({level:0});e.step();assert.ok(e.engines[0].audio.level<high);
    e.signal({level:1,active:false,available:false});assert.equal(e.engines[0].audio.level,0);
    e.step();assert.equal(e.engines[0].audio.available,false);
});
check('Small chat cores react only during actual audio; thumbnails never start a metering loop',()=>{
    const e=environment({variant:'chat',width:68});assert.equal(e.frames.size,0);assert.deepEqual(e.metering,[true]);
    e.signal({level:.25});assert.equal(e.frames.size,1);e.step();assert.ok(e.engines[0].audio.level>0);
    e.signal({active:false,available:false});assert.equal(e.frames.size,0);assert.equal(e.engines[0].audio.level,0);
    const thumb=environment({variant:'thumb',width:48});assert.deepEqual(thumb.metering,[]);thumb.signal({level:1});assert.equal(thumb.frames.size,0);
});
check('Hidden, reduced, paused and exited views release metering without stopping speech',()=>{
    for(const mode of ['hidden','reduced','paused','exit']){
        const e=environment();e.signal({level:.3});e.step();
        if(mode==='hidden'){e.document.hidden=true;e.document.fire('visibilitychange');}
        if(mode==='reduced'){e.motion.matches=true;e.motion.fire('change');}
        if(mode==='paused')e.api.configure({speed:0});
        if(mode==='exit')e.window.fire('pagehide',{persisted:true});
        assert.equal(e.metering.at(-1),false);assert.equal(e.engines[0].audio.level,0);assert.equal(e.frames.size,0);
    }
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
    const env = environment(); env.append('thumb', 44); pointerAt(env, 250, 150);
    env.window.fire('pagehide', { persisted: false }); assertReset(env);
    assert.equal(env.frames.size, 0); assert.equal(env.art.children.length, 0); assert.equal(env.engines[0].disposes, 1);
    assert.ok(env.observers.every(observer => observer.disconnected)); assert.deepEqual(env.window.allListeners(), []);
    assert.deepEqual(env.document.allListeners(), []); assert.deepEqual(env.motion.allListeners(), []);
    const inputs = env.inputs.length;
    pointerAt(env, 250, 150); env.window.fire('pointerout', { relatedTarget: null });
    env.window.fire('pointercancel'); env.window.fire('blur'); assert.equal(env.inputs.length, inputs);
    env.api.mount(env.art); assert.equal(env.art.children.length, 0); assert.equal(env.engines.length, 1);
});
check('Deferred DOM initialization mounts once after the document is ready', () => {
    const env = environment({ loading: true }); assert.equal(env.art.children.length, 0); assert.equal(env.engines.length, 0);
    env.document.fire('DOMContentLoaded'); env.visibility(true); assert.equal(env.art.children.length, 2);
    assert.equal(env.document.listenerCount('DOMContentLoaded'), 0); assert.equal(env.engines.length, 1);
});
console.log(`${checks} core renderer checks passed.`);
