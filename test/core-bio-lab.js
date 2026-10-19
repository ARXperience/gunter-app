'use strict';
// Lab contract only: no GPU, browser, microphone, network, or real-time waits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/dev/core-bio-lab.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../js/dev/core-bio-lab.html'), 'utf8');
let checks = 0;
function check(description, fn) { fn(); console.log(`ok ${++checks} - ${description}`); }

function emitter(values = {}) {
    const listeners = new Map();
    return Object.assign(values, {
        addEventListener(type, callback, options) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push({ callback, once: options?.once });
        },
        fire(type, event = {}) {
            for (const listener of [...(listeners.get(type) || [])]) {
                if (listener.once) listeners.set(type, listeners.get(type).filter(item => item !== listener));
                listener.callback({ target: this, ...event });
            }
        }
    });
}

function harness(options = {}) {
    const nodes = new Map(), frames = new Map(), timers = new Map(), pendingStops = [];
    const renders = [], recordings = [], streams = [], blobs = [], revoked = [], forbidden = [];
    let now = 1000, sequence = 0, engine;
    // Read the actual IDs and layer buttons, so markup/JS disagreement fails here.
    for (const tag of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
        const id = /\bid="([^"]+)"/.exec(tag[2])?.[1];
        const view = /\bdata-view="([^"]+)"/.exec(tag[2])?.[1];
        if (!id && !view) continue;
        const node = emitter({ tagName: tag[1], dataset: view ? { view } : {}, attributes: {},
            hidden: /\bhidden\b/.test(tag[2]), disabled: false, textContent: '',
            value: /\bvalue="([^"]+)"/.exec(tag[2])?.[1] || '',
            setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name] ?? null; },
            removeAttribute(name) { delete this.attributes[name]; delete this[name]; } });
        nodes.set(id || `view:${view}`, node);
    }
    for (const select of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
        const node = nodes.get(select[1]);
        node.options = [...select[2].matchAll(/<option\b[^>]*\bvalue="([^"]+)"[^>]*>([^<]*)<\/option>/g)]
            .map(match => ({ value: match[1], textContent: match[2] }));
        node.value = node.options[0]?.value || '';
    }
    const canvas = nodes.get('core'), views = [...nodes.values()].filter(node => node.dataset.view);
    const controls = [...nodes.values()].filter(node => ['button', 'select', 'input'].includes(node.tagName));
    canvas.getContext = type => {
        assert.equal(type, '2d');
        return { getImageData: () => ({ data: [0, 0, 0, 0] }) };
    };
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 620, height: 620 });
    if (!options.noCapture) canvas.captureStream = fps => {
        const track = { stops: 0, stop() { this.stops++; } };
        const stream = { fps, getTracks: () => [track], track };
        streams.push(stream); return stream;
    };
    const document = emitter({ hidden: false, getElementById: id => nodes.get(id),
        querySelectorAll: selector => {
            if (selector === '[data-view]') return views;
            assert.equal(selector, 'button, select, input'); return controls;
        } });
    class Renderer {
        constructor() { engine = this; this.available = options.available !== false; this.error = 'WebGL2 no disponible'; this.resets = 0; this.disposals = 0; }
        renderTo(target, width, height, phase, config) { renders.push({ target, width, height, phase, config: { ...config } }); }
        setPointer() {}
        resetPointer() { this.resets++; }
        dispose() { this.disposals++; }
    }
    class Recorder {
        static isTypeSupported(type) { return options.noCodec ? false : type === 'video/webm;codecs=vp8'; }
        constructor(stream, config) {
            if (options.constructorFailure) throw new Error('Encoder unavailable');
            Object.assign(this, emitter(), { stream, config, state: 'inactive', stops: 0 });
            recordings.push(this);
        }
        start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
        stop() {
            assert.equal(this.state, 'recording'); this.state = 'inactive'; this.stops++;
            // Real MediaRecorder delivers its final data/stop events asynchronously.
            pendingStops.push(() => { this.fire('dataavailable', { data: { size: 42 } }); this.fire('stop'); });
        }
    }
    const window = emitter({ GunterIdleCore: Renderer });
    if (!options.noRecorder) window.MediaRecorder = Recorder;
    const context = {
        window, document, MediaRecorder: options.noRecorder ? undefined : Recorder,
        performance: { now: () => now },
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: (callback, delay) => { timers.set(++sequence, { callback, delay, due: now + delay }); return sequence; },
        clearTimeout: id => timers.delete(id),
        Blob: class { constructor(chunks, config) { this.chunks = [...chunks]; this.type = config.type; } },
        URL: { createObjectURL: blob => { blobs.push(blob); return `blob:lab-${blobs.length}`; }, revokeObjectURL: url => revoked.push(url) }
    };
    const deny = name => { forbidden.push(name); throw new Error(`Unexpected external capability: ${name}`); };
    // Trap reads too: the lab must not inspect or update application preferences.
    for (const name of ['localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'AudioContext', 'webkitAudioContext']) {
        for (const target of [context, window]) Object.defineProperty(target, name, { get: () => deny(name) });
    }
    const navigator = { mediaDevices: { getUserMedia: () => deny('microphone'), getDisplayMedia: () => deny('screen capture') } };
    context.navigator = window.navigator = navigator;
    vm.runInNewContext(source, context, { filename: 'core-bio-lab.js', timeout: 1000 });
    return { nodes, canvas, views, controls, document, window, engine, frames, timers, renders, recordings, streams, blobs, revoked, forbidden,
        click: id => nodes.get(id).fire('click'),
        frame(ms = 40) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); },
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
        },
        flushStops() { while (pendingStops.length) pendingStops.shift()(); },
        hide() { document.hidden = true; document.fire('visibilitychange'); },
        show() { document.hidden = false; document.fire('visibilitychange'); }
    };
}

check('HTML loads only the shared renderer and exposes its four debug layers', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1].split('?')[0]);
    assert.deepEqual(scripts, ['../components/gunter-core-forms.js', '../components/gunter-idle-core.js', 'core-bio-lab.js']);
    assert.equal((html.match(/<script\b/g) || []).length, scripts.length, 'no inline or external application bootstrap');
    const h = harness();
    assert.deepEqual(h.views.map(node => node.dataset.view), ['energy', 'matter', 'filaments', 'composite']);
    for (const button of h.views) {
        button.fire('click'); h.frame(1000);
        const render = h.renders.at(-1);
        assert.equal(render.target, h.canvas);
        assert.equal(render.width, 620); assert.equal(render.height, 620);
        assert.equal(render.config.debugView, button.dataset.view);
        assert.equal(h.canvas.dataset.debugView, button.dataset.view);
        assert.equal(h.canvas.dataset.alphaCorner, '0');
        assert.equal(h.views.filter(node => node.getAttribute('aria-pressed') === 'true').length, 1);
    }
    assert.deepEqual(h.forbidden, []);
});

check('density reaches the renderer and pause freezes simulation phase', () => {
    const h = harness(); h.frame(); h.frame();
    for (const density of ['.25', '2']) {
        const node = h.nodes.get('density'); node.value = density; node.fire('input'); h.frame();
        assert.equal(h.renders.at(-1).config.density, Number(density));
    }
    const phase = h.renders.at(-1).phase;
    h.click('pause'); h.frame(80); h.frame(80);
    assert.equal(h.renders.at(-1).phase, phase);
    assert.equal(h.renders.at(-1).config.static, true);
    assert.equal(h.nodes.get('pause').getAttribute('aria-pressed'), 'true');
    h.click('pause'); h.frame();
    assert.ok(h.renders.at(-1).phase > phase);
    assert.equal(h.renders.at(-1).config.static, false);
    assert.deepEqual(h.forbidden, []);
});

check('representative shapes apply on the next frame with continuous phase and immediate DOM verification', () => {
    const h = harness(); h.frame(); h.frame();
    const shape = h.nodes.get('shape');
    assert.deepEqual(shape.options.map(option => option.value), ['organic', 'hand', 'eye', 'sword', 'jellyfish', 'butterfly', 'pentagram', 'dragon']);
    for (const option of shape.options) {
        const phase = h.renders.at(-1).phase;
        shape.value = option.value; shape.fire('change');
        assert.equal(h.canvas.dataset.shape, option.value);
        assert.ok(h.nodes.get('verification').textContent.includes(`Forma ${option.value}`));
        h.frame();
        assert.equal(h.renders.at(-1).config.shape, option.value);
        assert.ok(Math.abs(h.renders.at(-1).phase - phase - .04) < .000001, 'shape changes preserve simulation phase');
    }
    shape.value = 'unknown-shape'; shape.fire('change'); h.frame();
    assert.equal(h.renders.at(-1).config.shape, 'dragon', 'only known renderer IDs are accepted');
    assert.equal(h.engine.resets, 0);
    assert.deepEqual(h.forbidden, []);
});

check('HEX material controls validate before applying and retain changes while paused without persistence', () => {
    const h = harness(); h.frame(); h.frame(); h.click('pause');
    const phase = h.renders.at(-1).phase;
    for (const [index, name] of ['particleColor', 'shadowColor', 'energyColor', 'glowColor'].entries()) {
        const node = h.nodes.get(name);
        assert.equal(h.renders.at(-1).config[name], node.value, 'markup and renderer defaults agree');
        const color = ['#A1b2C3', '#123456', '#abcdef', '#012345'][index];
        node.value = color; node.fire('input'); h.frame();
        assert.equal(h.renders.at(-1).config[name], color);
        assert.equal(node.getAttribute('aria-invalid'), 'false');
        for (const invalid of ['#fff', '#gg0011', 'red', '#1234567', '']) {
            node.value = invalid; node.fire('input'); h.frame();
            assert.equal(h.renders.at(-1).config[name], color, 'invalid input retains the last valid color');
            assert.equal(node.getAttribute('aria-invalid'), 'true');
        }
        node.value = color; node.fire('input');
        assert.equal(node.getAttribute('aria-invalid'), 'false');
    }
    const shape = h.nodes.get('shape'); shape.value = 'eye'; shape.fire('change'); h.frame();
    assert.equal(h.renders.at(-1).config.shape, 'eye');
    assert.equal(h.renders.at(-1).phase, phase);
    assert.equal(h.engine.resets, 0);
    assert.deepEqual(h.forbidden, []);
});

check('brightness, speed and size reuse renderer config with bounded numeric values', () => {
    const h = harness(); h.frame();
    for (const [name, values] of [['brightness', [.2, 2.5]], ['speed', [0, 2]], ['size', [.7, 1.3]]]) {
        const node = h.nodes.get(name);
        for (const value of values) {
            node.value = String(value); node.fire('input'); h.frame();
            assert.equal(h.renders.at(-1).config[name], value);
        }
        for (const invalid of ['NaN', '-1', '100']) {
            node.value = invalid; node.fire('input'); h.frame();
            assert.equal(h.renders.at(-1).config[name], values.at(-1));
        }
    }
    assert.equal(h.engine.resets, 0);
    assert.deepEqual(h.forbidden, []);
});

check('recording captures 30 fps for 19 seconds and publishes actual elapsed duration', () => {
    const h = harness(); h.click('pause'); h.click('record');
    const recorder = h.recordings[0];
    assert.equal(h.streams[0].fps, 30);
    assert.equal(recorder.config.mimeType, 'video/webm;codecs=vp8');
    assert.equal(recorder.config.videoBitsPerSecond, 4000000);
    assert.equal(recorder.timeslice, 1000);
    assert.equal([...h.timers.values()][0].delay, 19000);
    assert.ok(h.controls.every(control => control.disabled));
    assert.equal(h.nodes.get('pause').getAttribute('aria-pressed'), 'false');
    assert.equal(h.engine.resets, 1);
    h.advance(18999); assert.equal(recorder.state, 'recording');
    h.advance(1); assert.equal(recorder.stops, 1);
    h.flushStops();
    assert.equal(h.streams[0].track.stops, 1);
    assert.equal(h.blobs[0].type, recorder.config.mimeType);
    assert.equal(h.blobs[0].chunks.length, 1, 'include final dataavailable chunk');
    assert.equal(h.nodes.get('download').download, 'gunter-bio-organic-energy-19.0s.webm');
    assert.match(h.nodes.get('status').textContent, /19\.0 segundos/);
    assert.equal(h.nodes.get('recording').src, h.nodes.get('download').href);
    assert.equal(h.nodes.get('recording').hidden, false);
    assert.equal(h.nodes.get('download').hidden, false);
    assert.ok(h.controls.every(control => !control.disabled));
    assert.equal(h.timers.size, 0);
    h.click('record');
    assert.deepEqual(h.revoked, ['blob:lab-1'], 'replacement revokes old preview');
    assert.equal(h.nodes.get('recording').hidden, true);
    assert.equal(h.nodes.get('download').hidden, true);
    h.window.fire('pagehide'); h.flushStops();
    assert.deepEqual(h.forbidden, []);
});

check('recording filenames identify the selected shape and layer', () => {
    const h = harness();
    const shape = h.nodes.get('shape'); shape.value = 'jellyfish'; shape.fire('change');
    h.views.find(node => node.dataset.view === 'composite').fire('click');
    h.click('record'); h.advance(19000); h.flushStops();
    assert.equal(h.nodes.get('download').download, 'gunter-bio-jellyfish-composite-19.0s.webm');
    assert.deepEqual(h.forbidden, []);
});

check('hiding stops capture, releases tracks and reports an honest shorter duration', () => {
    const h = harness(); h.frame(); h.click('record'); h.advance(3200); h.hide();
    assert.equal(h.recordings[0].stops, 1);
    assert.equal(h.frames.size, 0);
    h.flushStops();
    assert.equal(h.streams[0].track.stops, 1);
    assert.match(h.nodes.get('download').download, /-3\.2s\.webm$/);
    assert.match(h.nodes.get('status').textContent, /3\.2 segundos/);
    assert.equal(h.timers.size, 0);
    const count = h.renders.length; h.frame(); assert.equal(h.renders.length, count);
    h.show(); assert.equal(h.frames.size, 1); h.frame(); assert.equal(h.renders.length, count + 1);
    assert.equal(h.engine.disposals, 0);
});

check('pagehide immediately frees capture and disposes once without publishing late data', () => {
    const h = harness(); h.click('record'); h.advance(2300); h.window.fire('pagehide');
    assert.equal(h.recordings[0].stops, 1);
    assert.ok(h.streams[0].track.stops >= 1, 'release before asynchronous recorder stop');
    assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.engine.disposals, 1);
    h.flushStops(); assert.equal(h.blobs.length, 0);
    h.window.fire('pagehide'); assert.equal(h.engine.disposals, 1);
    const count = h.renders.length; h.show(); h.frame(); assert.equal(h.renders.length, count);
    const completed = harness(); completed.click('record'); completed.advance(19000); completed.flushStops();
    completed.window.fire('pagehide');
    assert.deepEqual(completed.revoked, ['blob:lab-1']);
});

check('unsupported rendering, capture, codecs and encoder construction fail gracefully', () => {
    const unavailable = harness({ available: false });
    assert.equal(unavailable.frames.size, 0);
    assert.equal(unavailable.nodes.get('status').textContent, 'WebGL2 no disponible');
    unavailable.window.fire('pagehide'); assert.equal(unavailable.engine.disposals, 1);
    for (const options of [{ noRecorder: true }, { noCapture: true }, { noCodec: true }, { constructorFailure: true }]) {
        const h = harness(options); h.click('record');
        assert.match(h.nodes.get('status').textContent, /no permite|códec|Encoder unavailable/);
        assert.equal(h.recordings.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.blobs.length, 0);
        assert.ok(h.controls.every(control => !control.disabled));
        if (options.constructorFailure) assert.equal(h.streams[0].track.stops, 1);
        else assert.equal(h.streams.length, 0);
        assert.deepEqual(h.forbidden, []);
    }
});

console.log(`core-bio-lab: ${checks} contract checks passed`);
