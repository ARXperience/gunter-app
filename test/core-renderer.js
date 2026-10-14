'use strict';
// Public renderer/lifecycle checks. No browser, model, microphone or network.
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
        addEventListener(type, callback, options) {
            if (!listeners.has(type)) listeners.set(type, new Map());
            listeners.get(type).set(callback, options);
        },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
        fire(type, event = {}) { [...(listeners.get(type)?.keys() || [])].forEach(callback => callback(event)); },
        listenerCount(type) { return listeners.get(type)?.size || 0; },
        listenerOptions(type) { return [...(listeners.get(type)?.values() || [])]; },
        dispatchEvent(event) { this.fire(event.type, event); return true; }
    });
}
function classes() {
    const values = new Set();
    return { contains: value => values.has(value), add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)) };
}
function environment(options = {}) {
    const nodes = [], frames = new Map(), observers = [], analysis = { assistant: [], microphone: [] };
    const storage = new Map([['gunter_prefs', JSON.stringify(options.prefs || {})]]), writes = [];
    let sequence = 0, now = 0, playback = options.speaking === true, conversation = 'idle';
    let ptt = 'idle', vad = false, wake = { active: false, mode: 'idle' };
    function element(tag = 'span') {
        const properties = new Map();
        const node = emitter({ tagName: tag.toUpperCase(), nodeType: 1, dataset: {}, classList: classes(),
            style: { setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) || '' },
            children: [], attributes: {}, isConnected: true, width: 400, height: 400, hidden: false,
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; },
            getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
            querySelectorAll(selector) { return this.children.flatMap(child => [
                ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
            ]); },
            matches(selector) { return selector === '[data-gunter-particles]' && this.dataset.gunterParticles != null; },
            appendChild(child) { this.children.push(child); child.parent = this; return child; },
            replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
        });
        if (tag === 'video') Object.assign(node, { paused: true, plays: 0, pauses: 0, loads: 0,
            play() { this.paused = false; this.plays++; this.fire('playing'); return Promise.resolve(); },
            pause() { this.paused = true; this.pauses++; }, load() { this.loads++; }
        });
        nodes.push(node); return node;
    }
    const art = element(); art.dataset.gunterParticles = options.variant || 'hero';
    if (options.width) art.width = options.width;
    const body = element('body'); body.appendChild(art);
    const document = emitter({ body, documentElement: element('html'), currentScript: { src: 'http://localhost/js/services/gunter-particles.js' },
        readyState: 'complete', hidden: false, querySelectorAll: selector => body.querySelectorAll(selector),
        createElement: element, createElementNS: (namespace, tag) => element(tag) });
    const motion = emitter({ matches: options.reducedOS === true });
    const window = emitter({ document, matchMedia: () => motion,
        requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame(id) { frames.delete(id); },
        localStorage: { getItem: key => storage.get(key) || null, setItem(key, value) { storage.set(key, value); writes.push({ key, value }); } },
        GunterConversationState: { getState: () => ({ value: conversation }) },
        GunterVoice: { getPlaybackState: () => ({ speaking: playback }), setAudioAnalysisEnabled: enabled => analysis.assistant.push(enabled) },
        GunterVoiceActivity: { getState: () => ({ active: vad }), setVisualLevelsEnabled: enabled => analysis.microphone.push(enabled) },
        GunterSTT: { pushToTalk: { getState: () => ({ phase: ptt }) } },
        GunterWakeWord: { getState: () => wake },
        MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        IntersectionObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} unobserve() {} disconnect() { this.disconnected = true; } },
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
    });
    const context = vm.createContext({ window, document, URL, location: { href: 'http://localhost/day.html' }, console,
        performance: { now: () => now }, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } } });
    vm.runInContext(source, context, { filename: 'gunter-particles.js' });
    const step = (milliseconds = 34) => { now += milliseconds; const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback(now)); };
    const visibility = (visible, target = art) => observers.find(observer => observer instanceof window.IntersectionObserver)
        .callback([{ target, isIntersecting: visible }]);
    visibility(true);
    return { art, body, window, document, nodes, frames, observers, motion, analysis, writes, step, visibility,
        api: window.GunterParticles, videos: () => nodes.filter(node => node.tagName === 'VIDEO'),
        prefs: () => JSON.parse(storage.get('gunter_prefs')),
        setPrefs(value) { storage.set('gunter_prefs', JSON.stringify(value)); },
        setPlayback(value) { playback = value; window.fire('gunter-voice-state', { detail: { speaking: value } }); },
        setConversation(value) { conversation = value; window.fire('gunter-conversation-state', { detail: { value } }); },
        setCapture(value) { ptt = value; window.fire('gunter-push-to-talk-state'); },
        setVAD(value) { vad = value; window.fire('gunter-vad-state'); },
        setWake(value) { wake = value; window.fire('wake-word-state'); },
        level(value) { window.fire('gunter-audio-level', { detail: value }); },
        mutate(entry) { observers.find(observer => observer instanceof window.MutationObserver).callback([entry]); },
        append(variant, width = 400) {
            const next = element(); next.dataset.gunterParticles = variant; next.width = width; next.height = width;
            body.appendChild(next); window.GunterParticles.mount(next); visibility(true, next); return next;
        }
    };
}
const local = environment(); local.step();
check('Existing mount API and editable configuration remain available', () => {
    for (const method of ['mount', 'configure', 'getConfig', 'getDefaults']) assert.equal(typeof local.api[method], 'function');
    assert.equal(local.art.dataset.particlesRenderer, 'html-video'); assert.equal(local.art.dataset.coreState, 'idle');
    assert.equal(local.api.getDefaults().geometry, 'flower'); assert.equal(local.api.getConfig().color, '#8b6cff');
});
check('Video is local, silent, inline, autoplaying and looped', () => {
    const video = local.videos()[0];
    assert.equal(video.src, 'http://localhost/assets/gunter/gunter-core-video.mp4');
    assert.equal(video.poster, 'http://localhost/assets/gunter/gunter-core-video-poster.jpg');
    for (const flag of ['muted', 'defaultMuted', 'loop', 'autoplay', 'playsInline', 'disablePictureInPicture']) assert.equal(video[flag], true);
    assert.equal(video.preload, 'metadata'); assert.equal(video.paused, false); assert.equal(local.art.dataset.videoPlayback, 'playing');
    assert.equal(local.art.children[0].children[0].children[0].hidden, true);
});
check('Repeated mounting retains exactly one video and original DOM nodes', () => {
    const first = local.art.children[0], video = local.videos()[0]; local.api.mount(); local.api.mount(local.art);
    assert.equal(local.videos().length, 1); assert.equal(local.art.children[0], first); assert.equal(local.videos()[0], video);
});
check('Configuration clamps ranges and rejects malformed values', () => {
    const config = local.api.configure({ color: '#29D1FF', size: 7, mouseSensitivity: -9, voiceIntensity: 8, geometryOpacity: .9, geometry: 'metatron' });
    assert.deepEqual(JSON.parse(JSON.stringify(config)), { color: '#29d1ff', size: 1.3, mouseSensitivity: 0, voiceIntensity: 2, geometry: 'metatron', geometryOpacity: .4 });
    const fallback = local.api.configure({ color: 'red;background:url(remote)', size: NaN, mouseSensitivity: Infinity, voiceIntensity: '2', geometry: 'other' });
    assert.equal(fallback.color, local.api.getDefaults().color); assert.equal(fallback.size, 1);
    assert.equal(fallback.mouseSensitivity, .65); assert.equal(fallback.voiceIntensity, 1); assert.equal(fallback.geometry, 'flower');
});
check('Explicit preference writes merge and restore settings without replacing unrelated fields', () => {
    const env = environment({ prefs: { reduceMotion: false, theme: 'light', voice: { enabled: false }, coreVisual: { color: '#22ddaa', size: .9 } } });
    assert.equal(env.api.getConfig().color, '#22ddaa'); assert.equal(env.api.getConfig().size, .9);
    env.api.configure({ size: 1.1 }); assert.equal(env.writes.length, 0);
    env.api.configure({ voiceIntensity: .5 }, { persist: true });
    assert.equal(env.writes.length, 1); assert.deepEqual(env.prefs().voice, { enabled: false });
    assert.equal(env.prefs().theme, 'light'); assert.equal(env.prefs().reduceMotion, false);
    assert.equal(env.prefs().coreVisual.size, 1.1); assert.equal(env.prefs().coreVisual.color, '#22ddaa');
    const restored = environment({ prefs: env.prefs() }); assert.equal(restored.api.getConfig().voiceIntensity, .5); assert.equal(restored.api.getConfig().size, 1.1);
});
check('Configuration getters return copies, not mutable shared state', () => {
    const copy = local.api.getConfig(); copy.color = '#000000'; const defaults = local.api.getDefaults(); defaults.geometry = 'none';
    assert.notEqual(local.api.getConfig().color, '#000000'); assert.equal(local.api.getDefaults().geometry, 'flower');
});
check('Sacred geometry switches between flower, Metatron and disabled in the same renderer', () => {
    const geometry = local.art.children[0].children[1];
    local.api.configure({ geometry: 'flower' }); assert.equal((geometry.innerHTML.match(/<circle /g) || []).length, 19); assert.doesNotMatch(geometry.innerHTML, /<path /);
    local.api.configure({ geometry: 'metatron' }); assert.equal((geometry.innerHTML.match(/<circle /g) || []).length, 13); assert.equal((geometry.innerHTML.match(/<path /g) || []).length, 78);
    local.api.configure({ geometry: 'none' }); assert.equal(geometry.innerHTML, ''); assert.equal(local.videos().length, 1);
});
check('Thumbnails remain static local posters, even during actual speech', () => {
    const thumb = environment({ variant: 'thumb', width: 44, speaking: true }); thumb.step();
    assert.equal(thumb.videos().length, 0); assert.equal(thumb.art.dataset.videoPlayback, 'poster');
    assert.equal(thumb.art.children[0].children[0].children[0].src, 'http://localhost/assets/gunter/gunter-core-video-poster.jpg'); assert.equal(thumb.frames.size, 0);
});
check('At most two large visible cores decode video', () => {
    const env = environment(); env.append('chat', 250); const third = env.append('hero', 180);
    assert.equal(env.videos().filter(video => !video.paused).length, 2); assert.equal(third.dataset.videoPlayback, 'poster');
});
check('Offscreen and hidden pages pause video and analysis; restoration reuses the decoder', () => {
    const env = environment(); env.visibility(false); env.step(); assert.equal(env.videos()[0].paused, true);
    assert.equal(env.analysis.assistant.at(-1), false); assert.equal(env.analysis.microphone.at(-1), false);
    env.visibility(true); assert.equal(env.videos()[0].paused, false);
    env.document.hidden = true; env.document.fire('visibilitychange'); assert.equal(env.videos()[0].paused, true); assert.equal(env.frames.size, 0);
    assert.equal(env.analysis.assistant.at(-1), false);
    env.document.hidden = false; env.document.fire('visibilitychange'); env.step(); assert.equal(env.videos()[0].paused, false); assert.equal(env.videos().length, 1);
});
check('Saved and OS reduced motion display a poster without decoding video', () => {
    for (const options of [{ prefs: { reduceMotion: true } }, { reducedOS: true }]) {
        const env = environment(options); env.step(); assert.equal(env.videos().length, 0); assert.equal(env.art.dataset.videoPlayback, 'reduced-motion');
        assert.equal(env.frames.size, 0); assert.equal(env.analysis.assistant.at(-1), false); assert.equal(env.analysis.microphone.at(-1), false);
    }
});
check('Cross-tab reduced-motion preference pauses existing video without writing settings', () => {
    const env = environment(); env.setPrefs({ reduceMotion: true, theme: 'light' }); env.window.fire('storage', { key: 'gunter_prefs' }); env.step();
    assert.equal(env.videos()[0].paused, true); assert.equal(env.art.dataset.videoPlayback, 'reduced-motion'); assert.equal(env.writes.length, 0);
    env.setPrefs({ reduceMotion: false }); env.window.fire('storage', { key: 'gunter_prefs' }); env.step(); assert.equal(env.videos()[0].paused, false);
});
check('Mouse response is bounded and smooth; passive listeners ignore touch', () => {
    const env = environment(); env.step(); const motion = env.art.children[0];
    env.art.fire('pointermove', { pointerType: 'touch', clientX: 400, clientY: 0 }); env.step(); assert.equal(parseFloat(motion.style.getPropertyValue('--core-x')), 0);
    env.art.fire('pointermove', { pointerType: 'mouse', clientX: 800, clientY: 0 }); env.step();
    const first = parseFloat(motion.style.getPropertyValue('--core-x')); assert.ok(first > 0 && first < 7.8);
    for (let n = 0; n < 20; n++) env.step(); assert.ok(parseFloat(motion.style.getPropertyValue('--core-x')) <= 7.8);
    for (const type of ['pointermove', 'pointerleave', 'pointercancel']) assert.equal(env.art.listenerOptions(type)[0].passive, true);
    env.art.fire('pointerleave'); for (let n = 0; n < 30; n++) env.step(); assert.ok(Math.abs(parseFloat(motion.style.getPropertyValue('--core-x'))) < .02);
});
check('Conversation readiness is processing, never fabricated playback or microphone capture', () => {
    const env = environment(); env.setConversation('speaking'); env.step(); assert.equal(env.art.dataset.coreState, 'thinking'); assert.equal(env.art.dataset.audioLevel, '0.000');
    env.window.fire('gunter-voice-state', { detail: { speaking: true } }); env.step(); assert.equal(env.art.dataset.coreState, 'thinking');
    env.setConversation('listening_query'); env.step(); assert.equal(env.art.dataset.coreState, 'idle');
    env.setConversation('error'); env.step(); assert.equal(env.art.dataset.coreState, 'error');
    env.setConversation('awaiting_confirmation'); env.step(); assert.equal(env.art.dataset.coreState, 'awaiting_confirmation');
});
check('Assistant amplitude requires actual playback and an available measured signal', () => {
    const env = environment(); env.level({ source: 'assistant', level: 1, active: true, available: true }); env.step(); assert.equal(env.art.dataset.audioSignal, 'none');
    env.setPlayback(true); env.level({ source: 'assistant', level: .7, active: true, available: false }); env.step();
    assert.equal(env.art.dataset.coreState, 'speaking'); assert.equal(env.art.dataset.audioSignal, 'unavailable'); assert.equal(parseFloat(env.art.children[0].style.getPropertyValue('--core-react-scale')), 1);
    env.level({ source: 'assistant', level: .7, active: true, available: true }); env.step();
    assert.equal(env.art.dataset.audioSignal, 'assistant'); assert.equal(env.art.dataset.audioLevel, '0.700');
    assert.ok(parseFloat(env.art.children[0].style.getPropertyValue('--core-react-scale')) > 1); assert.ok(parseFloat(env.art.children[0].style.getPropertyValue('--core-brightness')) > 1);
    env.setPlayback(false); env.step(); assert.equal(env.art.dataset.coreState, 'idle'); assert.equal(env.art.dataset.audioLevel, '0.000');
});
check('Microphone amplitude requires an already active capture; renderer never opens a stream', () => {
    const env = environment(); env.level({ source: 'microphone', level: .6, active: true, available: true }); env.step(); assert.equal(env.art.dataset.audioSignal, 'none');
    env.setCapture('recording'); env.step(); assert.equal(env.art.dataset.coreState, 'listening'); assert.equal(env.art.dataset.audioLevel, '0.600');
    env.setCapture('idle'); env.setVAD(true); env.step(); assert.equal(env.art.dataset.coreState, 'listening');
    env.setVAD(false); env.setWake({ active: true, mode: 'wake' }); env.step(); assert.equal(env.art.dataset.coreState, 'listening');
    env.setWake({ active: false, mode: 'wake' }); env.step(); assert.equal(env.art.dataset.coreState, 'idle');
    assert.doesNotMatch(source, /getUserMedia|new\s+(?:window\.)?(?:AudioContext|Audio|WebGLRenderer)|\.fetch\(/);
});
check('Measured amplitude expires after 250 ms without samples; no fake periodic amplitude', () => {
    const env = environment({ speaking: true }); env.level({ source: 'assistant', level: .8, active: true, available: true }); env.step();
    for (let n = 0; n < 9; n++) env.step(); assert.equal(env.art.dataset.audioSignal, 'unavailable'); assert.equal(env.art.dataset.audioLevel, '0.000');
    assert.doesNotMatch(source.slice(source.indexOf('function render('), source.indexOf('function schedule(')), /Math\.(?:random|sin|cos)\(/);
});
check('A silent measured sample also expires instead of retaining a stale available status', () => {
    const env = environment({ speaking: true }); env.level({ source: 'assistant', level: 0, active: true, available: true }); env.step();
    assert.equal(env.art.dataset.audioSignal, 'assistant');
    for (let n = 0; n < 10; n++) env.step();
    assert.equal(env.art.dataset.audioSignal, 'unavailable'); assert.equal(env.art.dataset.audioLevel, '0.000');
});
check('Unknown, inactive or invalid samples cannot create amplitude; intensity zero disables analysis', () => {
    const env = environment({ speaking: true });
    for (const sample of [{ source: 'remote', level: 1, available: true, active: true }, { source: 'assistant', level: 1, available: true, active: false }, { source: 'assistant', level: NaN, available: true, active: true }]) {
        env.level(sample); env.step(); assert.equal(env.art.dataset.audioLevel, '0.000');
    }
    env.api.configure({ voiceIntensity: 0 }); env.level({ source: 'assistant', level: 1, available: true, active: true }); env.step();
    assert.equal(env.analysis.assistant.at(-1), false); assert.equal(parseFloat(env.art.children[0].style.getPropertyValue('--core-react-scale')), 1);
});
check('Video error preserves poster and does not create decoder retry loops', () => {
    const env = environment(); const video = env.videos()[0]; video.fire('error'); assert.equal(env.art.dataset.videoPlayback, 'error'); assert.equal(video.hidden, true);
    assert.equal(env.art.children[0].children[0].children[0].hidden, false);
    env.visibility(false); env.visibility(true); assert.equal(env.videos().length, 1); assert.equal(video.plays, 1);
});
check('Unmount releases decoder, observers and pointer listeners', () => {
    const env = environment(), video = env.videos()[0]; env.art.isConnected = false; env.mutate({ type: 'childList', addedNodes: [] });
    assert.equal(env.art.children.length, 0); assert.equal(video.paused, true); assert.equal(video.src, ''); assert.equal(video.loads, 1); assert.equal(env.art.listenerCount('pointermove'), 0);
    assert.equal(env.observers.find(observer => observer instanceof env.window.ResizeObserver).disconnected, true);
    assert.equal(env.analysis.assistant.at(-1), false); assert.equal(env.analysis.microphone.at(-1), false);
});
check('BFCache page hide pauses and page show restores the same video', () => {
    const env = environment(); env.window.fire('pagehide', { persisted: true }); assert.equal(env.videos()[0].paused, true); assert.equal(env.analysis.assistant.at(-1), false);
    env.window.fire('pageshow', { persisted: true }); env.step(); assert.equal(env.videos()[0].paused, false); assert.equal(env.videos().length, 1);
});
check('Final page exit cleans resources and listeners and prevents remount', () => {
    const env = environment(); env.window.fire('pagehide', { persisted: false }); assert.equal(env.frames.size, 0); assert.equal(env.art.children.length, 0);
    assert.equal(env.window.listenerCount('gunter-audio-level'), 0); assert.equal(env.window.listenerCount('gunter-voice-state'), 0); assert.equal(env.document.listenerCount('pointerdown'), 0);
    assert.equal(env.observers.every(observer => observer.disconnected), true); env.api.mount(env.art); assert.equal(env.art.children.length, 0); assert.equal(env.videos().length, 1);
});
console.log(`${checks} core renderer checks passed.`);
